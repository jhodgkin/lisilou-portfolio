const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bookings.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    client_name TEXT,
    client_email TEXT,
    client_phone TEXT,
    client_sub TEXT,
    session_date TEXT,
    session_type TEXT,
    session_length TEXT,
    location TEXT,
    contract_signed_at TEXT,
    contract_pdf_path TEXT,
    payment_status TEXT DEFAULT 'pending',
    payment_notified_at TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT
  )
`);

module.exports = db;
