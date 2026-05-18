// ============================================================================
// shared/project-storage-sync.js — C3: облачная синхронизация данных в
// серверный Postgres (/api/kv) в server-режиме. Гейт строгий:
// IS_SERVER_BACKEND && наличие server-токена. На Pages/github.io — полный
// no-op (ни сети, ни hook) → нулевая регрессия (Firebase не трогаем,
// его НЕ удаляем; git-версия живёт как прежде).
//
// Модель: LS остаётся синхронным рабочим стором (клиент не переписываем);
// при логине в серверный бэкенд — pull всех ключей getools.* в LS
// (сервер = источник истины), далее write-through push по hook (debounce,
// fail-soft: оффлайн → остаётся в LS, доедет при следующем сохранении).
// ============================================================================
import { IS_SERVER_BACKEND, API_BASE } from './backend-mode.js';
import { setStorageWriteHook } from './project-storage.js';

const TOK_KEY = 'getools.srvToken';
const tok = () => { try { return localStorage.getItem(TOK_KEY) || ''; } catch { return ''; } };

async function api(path, opts = {}) {
  const h = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const t = tok(); if (t) h.Authorization = 'Bearer ' + t;
  const r = await fetch(API_BASE + path, { ...opts, headers: h });
  if (!r.ok) throw new Error('api ' + r.status);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : r.text();
}

// debounce-очередь push по ключу
const _pending = new Map();
let _timer = 0;
function _flush() {
  _timer = 0;
  const batch = [..._pending]; _pending.clear();
  for (const [k, v] of batch) {
    api('/kv/' + encodeURIComponent(k), { method: 'PUT', body: JSON.stringify(v) })
      .catch(() => { _pending.set(k, v); _schedule(2000); }); // retry позже
  }
}
function _schedule(ms = 600) { if (!_timer) _timer = setTimeout(_flush, ms); }

function _hook(key, value) {
  if (!tok()) return;                 // не залогинены на сервере — только LS
  if (!String(key).startsWith('getools.')) return;
  _pending.set(key, value); _schedule();
}

async function pullAll() {
  if (!tok()) return 0;
  const all = await api('/kv?prefix=' + encodeURIComponent('getools.'));
  let n = 0;
  for (const [k, v] of Object.entries(all || {})) {
    try { localStorage.setItem(k, JSON.stringify(v)); n++; } catch {}
  }
  return n;
}

async function login(email, password) {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!r || !r.token) throw new Error('no token');
  localStorage.setItem(TOK_KEY, r.token);
  await pullAll();
  return r.user;
}
async function register(email, password, name) {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  if (!r || !r.token) throw new Error(r && r.error || 'register failed');
  localStorage.setItem(TOK_KEY, r.token);
  return r.user;
}
function logout() { try { localStorage.removeItem(TOK_KEY); } catch {} }

// Глобальный доступ для UI/отладки (только server-режим).
function expose() {
  window.GEToolsServer = {
    mode: 'server', isAuthed: () => !!tok(),
    login, register, logout, pullAll,
    me: () => api('/auth/me').catch(() => null),
  };
}

// Минимальный неблокирующий вход в серверный бэкенд (только server-режим).
// App работает и без логина (LS-only); логин включает облачную синхронизацию.
function injectChip() {
  if (document.getElementById('ge-srv-chip')) return;
  const authed = !!tok();
  const chip = document.createElement('button');
  chip.id = 'ge-srv-chip';
  chip.textContent = authed ? '☁ Сервер ✓' : '☁ Войти на сервер';
  chip.title = authed ? 'Данные синхронизируются с сервером. Клик — выйти.' : 'Войти/регистрация — облачное хранение в серверной БД.';
  chip.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;padding:7px 12px;border-radius:18px;border:1px solid ' + (authed ? '#16a34a;background:#dcfce7;color:#15803d' : '#0ea5e9;background:#e0f2fe;color:#075985') + ';font:600 12px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)';
  chip.onclick = () => authed ? (logout(), location.reload()) : openModal();
  document.body.appendChild(chip);
}
function openModal() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:100000;display:flex;align-items:center;justify-content:center;font:14px system-ui';
  ov.innerHTML = '<div style="background:#fff;border-radius:10px;padding:20px;width:340px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,.3)">'
    + '<h3 style="margin:0 0 4px">Вход в GE Tools (сервер)</h3>'
    + '<p style="margin:0 0 12px;color:#64748b;font-size:12px">Облачное хранение данных в серверной БД. Без входа — локальный режим.</p>'
    + '<input id="ge-em" type="email" placeholder="email" style="width:100%;padding:8px;margin:4px 0;border:1px solid #cbd5e1;border-radius:5px;box-sizing:border-box">'
    + '<input id="ge-pw" type="password" placeholder="пароль" style="width:100%;padding:8px;margin:4px 0;border:1px solid #cbd5e1;border-radius:5px;box-sizing:border-box">'
    + '<div id="ge-err" style="color:#dc2626;font-size:12px;min-height:16px"></div>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button id="ge-login" style="flex:1;padding:9px;background:#0ea5e9;color:#fff;border:0;border-radius:6px;cursor:pointer;font:600 13px system-ui">Войти</button>'
    + '<button id="ge-reg" style="flex:1;padding:9px;background:#fff;color:#0ea5e9;border:1px solid #0ea5e9;border-radius:6px;cursor:pointer;font:600 13px system-ui">Регистрация</button>'
    + '<button id="ge-x" style="padding:9px 12px;background:#f1f5f9;border:0;border-radius:6px;cursor:pointer">✕</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s);
  const err = m => { q('#ge-err').textContent = m || ''; };
  const close = () => ov.remove();
  q('#ge-x').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  q('#ge-login').onclick = async () => {
    err(''); try { await login(q('#ge-em').value.trim(), q('#ge-pw').value); location.reload(); }
    catch (e) { err('Неверный email/пароль'); }
  };
  q('#ge-reg').onclick = async () => {
    err(''); try { await register(q('#ge-em').value.trim(), q('#ge-pw').value, ''); location.reload(); }
    catch (e) { err('Регистрация не удалась (email занят?)'); }
  };
}

(async function init() {
  if (!IS_SERVER_BACKEND) return;     // Pages/github.io → полный no-op
  expose();
  setStorageWriteHook(_hook);         // write-through (активен при наличии токена)
  if (tok()) { try { await pullAll(); } catch {} }  // server = источник истины
  try {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', injectChip, { once: true });
    else injectChip();
  } catch {}
})();
