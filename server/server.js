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
const { OAuth2Client } = require('google-auth-library'); // вход через Google
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const _gclient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const PORT = process.env.PORT || 8090;
// Общий сервер: по умолчанию слушаем ТОЛЬКО localhost (nginx проксирует),
// чтобы не открывать лишний публичный порт рядом с чужими проектами.
const HOST = process.env.HOST || '127.0.0.1';
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

// --- public config (клиент узнаёт, показывать ли Google-вход) ---------------
app.get('/api/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || '' });
});

// --- Google вход (GIS ID-token flow): клиент шлёт credential (Google JWT),
//     сервер верифицирует подпись/audience, профиль (email/имя/фото) →
//     upsert по email (линкуем с email/пароль-аккаунтом того же email),
//     выдаём СВОЙ JWT. Client Secret НЕ нужен (только Client ID). ---------
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!_gclient) return res.status(503).json({ error: 'google не настроен (нет GOOGLE_CLIENT_ID)' });
    const credential = (req.body && req.body.credential) || '';
    if (!credential) return res.status(400).json({ error: 'no credential' });
    const ticket = await _gclient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || !p.email || p.email_verified === false) return res.status(401).json({ error: 'email не подтверждён Google' });
    const email = String(p.email).toLowerCase().trim();
    const r = await pool.query(
      `INSERT INTO users(email,name,photo,google_sub,last_login)
       VALUES($1,$2,$3,$4,now())
       ON CONFLICT (email) DO UPDATE SET
         name=COALESCE(EXCLUDED.name, users.name),
         photo=COALESCE(EXCLUDED.photo, users.photo),
         google_sub=COALESCE(users.google_sub, EXCLUDED.google_sub),
         last_login=now()
       RETURNING uid,email,name,photo,is_internal,role`,
      [email, p.name || null, p.picture || null, p.sub || null]);
    const u = r.rows[0];
    res.json({ token: sign(u), user: u });
  } catch (e) { res.status(401).json({ error: 'google verify failed: ' + String(e && e.message || e) }); }
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
// v0.60.773 (фикс прод-падения): node-pg НЕ сериализует JS-объект/массив
// в jsonb (массив превращается в PG-array-литерал → invalid json →
// необработанная ошибка → краш процесса). ВСЕГДА JSON.stringify для
// jsonb-параметров + try/catch в каждом маршруте (плохой payload =
// 400/500, НЕ падение сервера). Чтение jsonb node-pg отдаёт уже
// распарсенным (объект) — res.json как есть.
app.get('/api/kv', auth, async (req, res) => {           // ?prefix=getools.project.
  try {
    const prefix = String(req.query.prefix || '');
    const r = await pool.query(
      'SELECT k,v FROM kv WHERE owner_uid=$1 AND k LIKE $2 ORDER BY k',
      [req.user.uid, prefix.replace(/[%_]/g, '\\$&') + '%']);
    res.json(Object.fromEntries(r.rows.map(x => [x.k, x.v])));
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.get('/api/kv/:key', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT v FROM kv WHERE owner_uid=$1 AND k=$2', [req.user.uid, req.params.key]);
    res.json(r.rows[0] ? r.rows[0].v : null);
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.put('/api/kv/:key', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO kv(owner_uid,k,v,updated_at) VALUES($1,$2,$3::jsonb,now())
       ON CONFLICT (owner_uid,k) DO UPDATE SET v=EXCLUDED.v, updated_at=now()`,
      [req.user.uid, req.params.key, JSON.stringify(req.body ?? null)]);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});
app.delete('/api/kv/:key', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM kv WHERE owner_uid=$1 AND k=$2', [req.user.uid, req.params.key]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

// --- Projects (collab; финализация authz/members при миграции Firestore) ---
app.get('/api/projects', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,owner_uid,meta,members,visibility,updated_at FROM projects
       WHERE owner_uid=$1 OR members ? $1 ORDER BY updated_at DESC`,
      [req.user.uid]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.put('/api/projects/:id', auth, async (req, res) => {
  try {
    const { meta, members, visibility } = req.body || {};
    await pool.query(
      `INSERT INTO projects(id,owner_uid,meta,members,visibility,updated_at)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,now())
       ON CONFLICT (id) DO UPDATE SET meta=EXCLUDED.meta,
         members=EXCLUDED.members, visibility=EXCLUDED.visibility, updated_at=now()
       WHERE projects.owner_uid=$2`, // TODO: + members-admin authz при миграции
      [req.params.id, req.user.uid, JSON.stringify(meta || {}), JSON.stringify(members || {}), visibility || 'private']);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
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

// Crash-proof: одиночная ошибка/реджект НЕ должна ронять весь сервер
// (иначе 502 для всех при рестарте). Логируем, продолжаем работу.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
// express error-handler (на случай sync-throw в маршруте)
app.use((err, _req, res, _next) => {
  console.error('[express-error]', err);
  if (!res.headersSent) res.status(500).json({ error: String(err && err.message || err) });
});

app.listen(PORT, HOST, () => console.log(`[getools-server] listening on ${HOST}:${PORT}`));
