require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

const CONTRACTS_DIR = path.join(__dirname, 'contracts');
const SIGNED_DIR = path.join(__dirname, 'signed-contracts');

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Fire-and-forget webhook to n8n — failures are logged but never block the booking flow
function notify(event, booking, extra = {}) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      booking,
      photographer_email: process.env.PHOTOGRAPHER_EMAIL || 'hello@lisilou.com',
      site_url: process.env.SITE_URL || '',
      ...extra,
    }),
  }).catch(e => console.error(`[notify] ${event} failed:`, e.message));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Serve the contract template PDF to the frontend PDF.js viewer
app.get('/api/contracts/template', (req, res) => {
  const contractPath = path.join(CONTRACTS_DIR, 'model-release.pdf');
  if (!fs.existsSync(contractPath)) {
    return res.status(404).json({ error: 'Contract template not available' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(contractPath);
});

// Serve a signed contract PDF (used by n8n email workflow)
app.get('/api/bookings/:id/contract', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const booking = db.prepare('SELECT contract_pdf_path FROM bookings WHERE id = ?').get(id);
  if (!booking || !booking.contract_pdf_path) {
    return res.status(404).json({ error: 'Signed contract not found' });
  }
  const pdfPath = path.join(__dirname, booking.contract_pdf_path);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'Contract file missing on disk' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="contract-booking-${id}.pdf"`);
  res.sendFile(pdfPath);
});

app.post('/api/bookings', (req, res) => {
  const {
    client_name, client_email, client_phone, client_sub,
    session_date, session_type, session_length, location,
    payment_status,
  } = req.body;

  if (!client_email || !session_date || !session_type || !session_length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = db.prepare(`
    INSERT INTO bookings
      (client_name, client_email, client_phone, client_sub, session_date, session_type, session_length, location, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client_name, client_email, client_phone, client_sub,
    session_date, session_type, session_length, location,
    payment_status || 'pending',
  );

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
  notify('booking_created', booking);

  res.status(201).json({ id: result.lastInsertRowid });
});

// Generate a QR code SVG for any URL — used by the Venmo payment step.
// Venmo username and amount come from the frontend (which reads site.json),
// so changing venmoUsername in config updates both the button and QR with
// no server restart needed.
app.get('/api/venmo-qr', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('https://venmo.com/')) {
    return res.status(400).json({ error: 'url must be a venmo.com URL' });
  }
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 220, color: { dark: '#2C2C2C', light: '#FDFBF9' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// Stamp the signature onto the contract PDF and record it
app.post('/api/bookings/:id/sign', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { signature_png, full_name } = req.body;

  if (!signature_png || !full_name) {
    return res.status(400).json({ error: 'signature_png and full_name are required' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const contractTemplate = path.join(CONTRACTS_DIR, 'model-release.pdf');
  let pdfPath = null;

  if (fs.existsSync(contractTemplate)) {
    try {
      const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

      const pdfBytes = fs.readFileSync(contractTemplate);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();

      const sigPageIndex = Math.max(0, parseInt(process.env.CONTRACT_SIG_PAGE || '1', 10) - 1);
      const sigX = parseFloat(process.env.CONTRACT_SIG_X || '100');
      const sigY = parseFloat(process.env.CONTRACT_SIG_Y || '100');
      const page = pages[Math.min(sigPageIndex, pages.length - 1)];

      // Embed the signature image
      const sigBase64 = signature_png.replace(/^data:image\/png;base64,/, '');
      const sigImage = await pdfDoc.embedPng(Buffer.from(sigBase64, 'base64'));
      const imgDims = sigImage.scaleToFit(200, 60);
      page.drawImage(sigImage, { x: sigX, y: sigY, width: imgDims.width, height: imgDims.height });

      // Print name, date, and booking ID below signature
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      page.drawText(`${full_name}  ·  ${dateStr}  ·  Booking #${id}`, {
        x: sigX,
        y: sigY - 14,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });

      fs.mkdirSync(SIGNED_DIR, { recursive: true });
      const outPath = path.join(SIGNED_DIR, `${id}.pdf`);
      fs.writeFileSync(outPath, await pdfDoc.save());
      pdfPath = `signed-contracts/${id}.pdf`;
    } catch (err) {
      console.error('PDF stamping failed:', err.message);
      // Non-fatal — still record the agreement
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE bookings SET contract_signed_at = ?, contract_pdf_path = ? WHERE id = ?
  `).run(now, pdfPath, id);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  const contractUrl = pdfPath
    ? `${process.env.SITE_URL || ''}/api/bookings/${id}/contract`
    : null;
  notify('contract_signed', updated, { contract_url: contractUrl });

  res.json({ ok: true, signed_at: now, pdf_path: pdfPath });
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
