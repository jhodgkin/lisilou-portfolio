require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
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

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
