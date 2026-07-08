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

app.post('/api/bookings', (req, res) => {
  const {
    client_name, client_email, client_phone, client_sub,
    session_date, session_type, session_length, location,
  } = req.body;

  if (!client_email || !session_date || !session_type || !session_length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = db.prepare(`
    INSERT INTO bookings
      (client_name, client_email, client_phone, client_sub, session_date, session_type, session_length, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client_name, client_email, client_phone, client_sub, session_date, session_type, session_length, location);

  res.status(201).json({ id: result.lastInsertRowid });
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

  // Fire n8n webhook asynchronously if configured
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (webhookUrl) {
    const record = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'contract_signed', booking: record }),
    }).catch(e => console.error('n8n webhook error:', e.message));
  }

  res.json({ ok: true, signed_at: now, pdf_path: pdfPath });
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
