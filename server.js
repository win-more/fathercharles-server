const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Datastore = require('@seald-io/nedb');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'fc-ministry-secret-2025';

// ── DB setup ──────────────────────────────────────────────
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const prayers = new Datastore({ filename: path.join(dbDir, 'prayers.db'), autoload: true });
const admins  = new Datastore({ filename: path.join(dbDir, 'admins.db'),  autoload: true });

// Seed default admin on first run
admins.findOne({ username: 'fathercharles' }, (err, doc) => {
  if (!doc) {
    const hash = bcrypt.hashSync('Glory2God!', 10);
    admins.insert({ username: 'fathercharles', password: hash });
    console.log('✅ Default admin created → username: fathercharles  password: Glory2God!');
  }
});

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Routes ────────────────────────────────────────────────

// POST /api/prayer — submit a prayer request from the public form
app.post('/api/prayer', (req, res) => {
  const { name, email, category, duration, request, paid } = req.body;
  if (!name || !request) return res.status(400).json({ error: 'Name and request are required' });

  const doc = {
    name: name.trim(),
    email: (email || '').trim(),
    category: category || 'Other',
    duration: duration || 'Not specified',
    request: request.trim(),
    paid: paid === true || paid === 'true',
    createdAt: new Date().toISOString()
  };

  prayers.insert(doc, (err, newDoc) => {
    if (err) return res.status(500).json({ error: 'Could not save prayer' });
    res.json({ success: true, id: newDoc._id });
  });
});

// PATCH /api/prayer/:id/paid — update payment status
app.patch('/api/prayer/:id/paid', authRequired, (req, res) => {
  prayers.update({ _id: req.params.id }, { $set: { paid: req.body.paid } }, {}, (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });
    res.json({ success: true });
  });
});

// DELETE /api/prayer/:id
app.delete('/api/prayer/:id', authRequired, (req, res) => {
  prayers.remove({ _id: req.params.id }, {}, (err) => {
    if (err) return res.status(500).json({ error: 'Delete failed' });
    res.json({ success: true });
  });
});

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  admins.findOne({ username }, (err, doc) => {
    if (!doc || !bcrypt.compareSync(password, doc.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  });
});

// GET /api/prayers — all prayer requests (admin only)
app.get('/api/prayers', authRequired, (req, res) => {
  prayers.find({}).sort({ createdAt: -1 }).exec((err, docs) => {
    if (err) return res.status(500).json({ error: 'Could not load prayers' });
    res.json(docs);
  });
});

// GET /api/export — download as Excel (admin only)
app.get('/api/export', authRequired, (req, res) => {
  prayers.find({}).sort({ createdAt: -1 }).exec((err, docs) => {
    if (err) return res.status(500).json({ error: 'Export failed' });

    const rows = docs.map(d => ({
      'Name': d.name,
      'Email': d.email || '—',
      'Category': d.category,
      'Duration': d.duration,
      'Prayer Request': d.request,
      'Payment Status': d.paid ? 'PAID' : 'Skipped',
      'Date Submitted': new Date(d.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws['!cols'] = [
      { wch: 20 }, { wch: 28 }, { wch: 22 }, { wch: 14 },
      { wch: 60 }, { wch: 16 }, { wch: 22 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Prayer Requests');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="prayer-requests.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });
});

app.listen(PORT, () => {
  console.log(`\n🙏 Father Charles server running at http://localhost:${PORT}`);
  console.log(`📋 Admin dashboard → http://localhost:${PORT}/admin.html`);
  console.log(`🔑 Login → username: fathercharles  |  password: Glory2God!\n`);
});
