// ============================================================================
// shared/backend-mode.js — runtime-выбор бэкенда (C1).
// Один клиент в git раздаётся И на GitHub Pages (Firebase), И на свой
// сервер getools.netchess.ru (Postgres+/api). Чтобы git/Pages-версия
// продолжала работать с Firebase (его НЕ удаляем), режим определяется
// детерминированно по хосту, БЕЗ сети, fail-safe → 'firebase'.
//   'server'   — собственный сервер (Timeweb VPS, /api + Postgres+Auth)
//   'firebase' — GitHub Pages / прочее (как было; нулевая регрессия)
// Переопределение для отладки: ?backend=server|firebase или
// localStorage 'getools.backendMode' (sticky). API-базы: '/api'.
// ============================================================================

const SERVER_HOSTS = ['getools.netchess.ru'];

function _detect() {
  try {
    const u = new URLSearchParams(location.search).get('backend');
    if (u === 'server' || u === 'firebase') return u;
  } catch {}
  try {
    const ls = localStorage.getItem('getools.backendMode');
    if (ls === 'server' || ls === 'firebase') return ls;
  } catch {}
  try {
    if (SERVER_HOSTS.includes(location.hostname)) return 'server';
  } catch {}
  return 'firebase';
}

export const BACKEND_MODE = _detect();
export const IS_SERVER_BACKEND = BACKEND_MODE === 'server';
export const API_BASE = '/api';

try { window.__GE_BACKEND = BACKEND_MODE; } catch {}
