// ============================================================================
// GE Tools backend — Timeweb VPS. Замена Firebase: Postgres + Auth + Email.
// Минимальный, но рабочий фундамент. Клиентский шов project-storage.js
// маппится на /kv (ключ→JSON). Финализируется при первом SSH-подключении
// (Google OAuth + импорт реального Firestore-экспорта + ужесточение authz
// проектов — отмечено TODO; не выдаём непроверенное за проверенное).
// Запуск: node server.js (env из server/.env через окружение systemd).
// ============================================================================
'use strict';
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 8090;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure';
const JWT_TTL = (Number(process.env.JWT_TTL_HOURS) || 720) + 'h';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' })); // проектные JSON бывают крупные

function sign(u) { return jwt.sign({ uid: u.uid, email: u.email }, JWT_SECRET, { expiresIn: JWT_TTL }); }
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'no token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'bad token' }); }
}

// --- health -----------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// --- Auth (замена Firebase Auth; email+пароль; Google OAuth — TODO) ---------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email/password' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users(email,name,pass_hash) VALUES($1,$2,$3)
       ON CONFLICT (email) DO NOTHING RETURNING uid,email,name`,
      [String(email).toLowerCase().trim(), name || null, hash]);
    if (!r.rows[0]) return res.status(409).json({ error: 'email exists' });
    res.json({ token: sign(r.rows[0]), user: r.rows[0] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()]);
    const u = r.rows[0];
    if (!u || !u.pass_hash || !(await bcrypt.compare(password || '', u.pass_hash)))
      return res.status(401).json({ error: 'invalid credentials' });
    await pool.query('UPDATE users SET last_login=now() WHERE uid=$1', [u.uid]);
    res.json({ token: sign(u), user: { uid: u.uid, email: u.email, name: u.name } });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.get('/api/auth/me', auth, async (req, res) => {
  const r = await pool.query('SELECT uid,email,name,is_internal,role FROM users WHERE uid=$1', [req.user.uid]);
  res.json(r.rows[0] || null);
});

// --- KV: зеркало project-storage (ключ → JSON), облачная синхронизация -----
app.get('/api/kv', auth, async (req, res) => {           // ?prefix=getools.project.
  const prefix = String(req.query.prefix || '');
  const r = await pool.query(
    'SELECT k,v FROM kv WHERE owner_uid=$1 AND k LIKE $2 ORDER BY k',
    [req.user.uid, prefix.replace(/[%_]/g, '\\$&') + '%']);
  res.json(Object.fromEntries(r.rows.map(x => [x.k, x.v])));
});
app.get('/api/kv/:key', auth, async (req, res) => {
  const r = await pool.query('SELECT v FROM kv WHERE owner_uid=$1 AND k=$2', [req.user.uid, req.params.key]);
  res.json(r.rows[0] ? r.rows[0].v : null);
});
app.put('/api/kv/:key', auth, async (req, res) => {
  await pool.query(
    `INSERT INTO kv(owner_uid,k,v,updated_at) VALUES($1,$2,$3,now())
     ON CONFLICT (owner_uid,k) DO UPDATE SET v=EXCLUDED.v, updated_at=now()`,
    [req.user.uid, req.params.key, req.body ?? null]);
  res.json({ ok: true });
});
app.delete('/api/kv/:key', auth, async (req, res) => {
  await pool.query('DELETE FROM kv WHERE owner_uid=$1 AND k=$2', [req.user.uid, req.params.key]);
  res.json({ ok: true });
});

// --- Projects (collab; финализация authz/members при миграции Firestore) ---
app.get('/api/projects', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT id,owner_uid,meta,members,visibility,updated_at FROM projects
     WHERE owner_uid=$1 OR members ? $1 ORDER BY updated_at DESC`,
    [req.user.uid]);
  res.json(r.rows);
});
app.put('/api/projects/:id', auth, async (req, res) => {
  const { meta, members, visibility } = req.body || {};
  await pool.query(
    `INSERT INTO projects(id,owner_uid,meta,members,visibility,updated_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT (id) DO UPDATE SET meta=EXCLUDED.meta,
       members=EXCLUDED.members, visibility=EXCLUDED.visibility, updated_at=now()
     WHERE projects.owner_uid=$2`, // TODO: + members-admin authz при миграции
    [req.params.id, req.user.uid, meta || {}, members || {}, visibility || 'private']);
  res.json({ ok: true });
});

// --- Mail (замена Cloud Functions Trigger Email) ---------------------------
app.post('/api/mail', auth, async (req, res) => {
  const { to, subject, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'to/subject' });
  await pool.query('INSERT INTO mail_queue(to_email,subject,body_html) VALUES($1,$2,$3)',
    [to, subject, html || '']);
  res.json({ ok: true });
});
let _tx = null;
function mailer() {
  if (_tx) return _tx;
  if (!process.env.SMTP_HOST) return null;
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return _tx;
}
async function mailWorker() {
  const tx = mailer(); if (!tx) return;
  try {
    const r = await pool.query("SELECT * FROM mail_queue WHERE status='pending' ORDER BY id LIMIT 10");
    for (const m of r.rows) {
      try {
        await tx.sendMail({ from: process.env.MAIL_FROM || 'GE Tools', to: m.to_email, subject: m.subject, html: m.body_html || '' });
        await pool.query("UPDATE mail_queue SET status='sent', sent_at=now() WHERE id=$1", [m.id]);
      } catch (e) {
        await pool.query("UPDATE mail_queue SET status='error', error=$2 WHERE id=$1", [m.id, String(e)]);
      }
    }
  } catch (e) { console.error('[mailWorker]', e); }
}
setInterval(mailWorker, 30000);

app.listen(PORT, () => console.log(`[getools-server] listening on :${PORT}`));
