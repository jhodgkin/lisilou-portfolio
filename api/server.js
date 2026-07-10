require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { getBusyDates } = require('./google-calendar');

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

// ── Admin auth ────────────────────────────────────────────────────────────────
// TODO (#10): swap this bearer-token check for Authentik OIDC session validation
// when issue #10 lands. The middleware signature stays the same; only the check changes.
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: 'Admin access not configured (set ADMIN_SECRET)' });
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Availability — returns busy dates for a given month from Google Calendar.
// Gracefully returns an empty busy list when Calendar is not configured.
app.get('/api/availability', async (req, res) => {
  const year  = parseInt(req.query.year,  10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month (1-12) are required' });
  }
  try {
    const result = await getBusyDates(year, month);
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min CDN cache
    res.json(result);
  } catch (err) {
    console.error('[availability]', err.message);
    // Don't expose internal error; return empty so the UI can still function
    res.json({ busy: [], configured: false, error: 'calendar_unavailable' });
  }
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

// Serve a signed contract PDF (used by n8n email workflow and admin dashboard)
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

  const ps = payment_status || 'pending';
  // Record when the client indicated they sent payment
  const paymentNotifiedAt = ps === 'pending_confirmation' ? new Date().toISOString() : null;

  const result = db.prepare(`
    INSERT INTO bookings
      (client_name, client_email, client_phone, client_sub, session_date, session_type,
       session_length, location, payment_status, payment_notified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client_name, client_email, client_phone, client_sub,
    session_date, session_type, session_length, location,
    ps, paymentNotifiedAt,
  );

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
  notify('booking_created', booking);

  res.status(201).json({ id: result.lastInsertRowid });
});

// Generate a QR code SVG for any URL — used by the Venmo payment step.
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

      const sigBase64 = signature_png.replace(/^data:image\/png;base64,/, '');
      const sigImage = await pdfDoc.embedPng(Buffer.from(sigBase64, 'base64'));
      const imgDims = sigImage.scaleToFit(200, 60);
      page.drawImage(sigImage, { x: sigX, y: sigY, width: imgDims.width, height: imgDims.height });

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

// ── Admin routes (require ADMIN_SECRET bearer token) ──────────────────────────

// Stats: counts + next upcoming bookings for the Overview panel
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  const monthEnd = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

  const counts = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE session_date >= ? AND session_date <= ? AND status != 'cancelled') AS upcoming,
      COUNT(*) FILTER (WHERE payment_status = 'pending_confirmation') AS pending_payment,
      COUNT(*) FILTER (WHERE payment_status = 'confirmed') AS confirmed_payment,
      COUNT(*) FILTER (WHERE session_length = 'mini' AND payment_status = 'confirmed') AS confirmed_mini,
      COUNT(*) FILTER (WHERE session_length = 'full' AND payment_status = 'confirmed') AS confirmed_full
    FROM bookings
  `).get(now, monthEnd);

  const nextUp = db.prepare(`
    SELECT id, client_name, client_email, session_date, session_type, session_length,
           location, payment_status, status, contract_signed_at
    FROM bookings
    WHERE session_date >= ? AND status != 'cancelled'
    ORDER BY session_date ASC LIMIT 5
  `).all(now);

  res.json({ ...counts, nextUpcoming: nextUp });
});

// List bookings with optional filters
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const { status, payment_status, from, to, search, sort = 'session_date', dir = 'asc' } = req.query;
  const allowed = ['session_date', 'created_at', 'client_name', 'payment_status', 'status'];
  const sortCol = allowed.includes(sort) ? sort : 'session_date';
  const sortDir = dir === 'desc' ? 'DESC' : 'ASC';

  const conditions = [];
  const params = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (payment_status) { conditions.push('payment_status = ?'); params.push(payment_status); }
  if (from) { conditions.push('session_date >= ?'); params.push(from); }
  if (to) { conditions.push('session_date <= ?'); params.push(to); }
  if (search) {
    conditions.push('(client_name LIKE ? OR client_email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const bookings = db.prepare(
    `SELECT * FROM bookings ${where} ORDER BY ${sortCol} ${sortDir}`
  ).all(...params);

  res.json(bookings);
});

// Single booking
app.get('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!booking) return res.status(404).json({ error: 'Not found' });
  res.json(booking);
});

// Update booking fields — payment confirm triggers n8n webhook
app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Not found' });

  const allowed = ['payment_status', 'status', 'notes', 'session_date', 'location'];
  const updates = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields' });

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE bookings SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

  if (updates.payment_status === 'confirmed' && booking.payment_status !== 'confirmed') {
    notify('payment_confirmed', updated);
  }

  res.json(updated);
});

// CSV export of all bookings
app.get('/api/admin/payments/export', requireAdmin, (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY session_date ASC').all();

  const cols = ['id', 'created_at', 'client_name', 'client_email', 'client_phone',
                'session_date', 'session_type', 'session_length', 'location',
                'contract_signed_at', 'payment_status', 'payment_notified_at', 'status', 'notes'];

  const escape = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const header = cols.join(',');
  const rows = bookings.map(b => cols.map(c => escape(b[c])).join(','));
  const csv = [header, ...rows].join('\r\n');

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="lisilou-bookings-${date}.csv"`);
  res.send(csv);
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
