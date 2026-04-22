// =========================================================================
// shared/configuration-catalog.js (v0.59.187)
// Универсальный каталог конфигураций для всех конфигуратор-подпрограмм
// Raschet: panel-config, rack-config, ups-config, mv-config, mdc-config,
// pdu-config, transformer-config, scs-config, suppression-config.
//
// Каждая запись (ConfigEntry):
//   {
//     id: 'YYMMDD-NN'      — обозначение (дата + порядковый номер в день);
//     id: 'PROJ-NN'        — альтернативно: код проекта + номер (если явно задан);
//     kind: 'panel'|'rack'|..., — вид конфигуратора;
//     label: string,       — короткое обозначение для отображения;
//     description: string, — что именно конфигурировали (текст для человека);
//     projectCode?: string,— код внутренний проекта (если привязана к проекту);
//     seqNo?: number,      — порядковый номер в рамках projectCode или даты;
//     payload: object,     — собственно данные конфигурации (формат зависит от kind);
//     createdAt: number,   — timestamp ms;
//     updatedAt: number,   — timestamp ms;
//   }
//
// Ключ localStorage: raschet.configurations.<kind>.v1 = ConfigEntry[]
// Подписка на изменения: onConfigsChange(kind, cb) → unsubscribe
// Генерация id: nextConfigId(kind, projectCode?) — если projectCode задан,
// возвращает 'PROJ-NN', иначе 'YYMMDD-NN'.
// =========================================================================

const SCHEMA_VERSION = 'v1';
const KEY_PREFIX = 'raschet.configurations.';

const listeners = new Map(); // kind → Set<cb>

function storageKey(kind) {
  return KEY_PREFIX + String(kind || 'misc') + '.' + SCHEMA_VERSION;
}

function readAll(kind) {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeAll(kind, arr) {
  try { localStorage.setItem(storageKey(kind), JSON.stringify(arr || [])); }
  catch (e) { console.warn('[configuration-catalog] write failed', e); }
  notify(kind);
}

function notify(kind) {
  const set = listeners.get(kind);
  if (!set) return;
  for (const cb of set) { try { cb(); } catch (e) { console.warn(e); } }
  // также уведомляем «всех» (undefined → любой kind)
  const any = listeners.get('*');
  if (any) for (const cb of any) { try { cb(kind); } catch {} }
}

export function listConfigs(kind, opts) {
  const items = readAll(kind);
  const o = opts || {};
  let out = items;
  if (o.projectCode) out = out.filter(x => x.projectCode === o.projectCode);
  if (o.search) {
    const q = String(o.search).toLowerCase();
    out = out.filter(x =>
      (x.id || '').toLowerCase().includes(q) ||
      (x.label || '').toLowerCase().includes(q) ||
      (x.description || '').toLowerCase().includes(q));
  }
  // По умолчанию — свежие сверху
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

export function getConfig(kind, id) {
  return readAll(kind).find(x => x.id === id) || null;
}

/**
 * Сохранить конфигурацию. Если entry.id задан — обновить существующую, иначе
 * создать новую (id будет сгенерирован через nextConfigId).
 * Возвращает сохранённую запись.
 */
export function saveConfig(kind, entry) {
  const now = Date.now();
  const all = readAll(kind);
  let e = { ...entry, kind: String(kind) };
  if (e.id) {
    const idx = all.findIndex(x => x.id === e.id);
    if (idx >= 0) {
      e = { ...all[idx], ...e, updatedAt: now };
      all[idx] = e;
    } else {
      e = { createdAt: now, updatedAt: now, ...e };
      all.push(e);
    }
  } else {
    e.id = nextConfigId(kind, e.projectCode);
    e.createdAt = now;
    e.updatedAt = now;
    all.push(e);
  }
  writeAll(kind, all);
  return e;
}

export function removeConfig(kind, id) {
  const all = readAll(kind);
  const next = all.filter(x => x.id !== id);
  if (next.length === all.length) return false;
  writeAll(kind, next);
  return true;
}

export function onConfigsChange(kind, cb) {
  const key = kind || '*';
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  return () => listeners.get(key)?.delete(cb);
}

/**
 * Генерация id:
 *   - projectCode задан → 'PROJ-NN' (NN — порядковый номер среди всех записей
 *     с этим projectCode, 01, 02, ..., 99, 100, 101, ...);
 *   - projectCode не задан → 'YYMMDD-NN' (NN — порядковый номер среди записей
 *     с такой же датой в id).
 */
export function nextConfigId(kind, projectCode) {
  const all = readAll(kind);
  if (projectCode) {
    const prefix = String(projectCode).toUpperCase() + '-';
    const nums = all
      .filter(x => (x.id || '').startsWith(prefix))
      .map(x => parseInt((x.id || '').slice(prefix.length), 10))
      .filter(Number.isFinite);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return prefix + String(next).padStart(2, '0');
  }
  const now = new Date();
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = yy + mm + dd + '-';
  const nums = all
    .filter(x => (x.id || '').startsWith(prefix))
    .map(x => parseInt((x.id || '').slice(prefix.length), 10))
    .filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return prefix + String(next).padStart(2, '0');
}

// =========================================================================
// Активный проект (для привязки конфигураций к коду проекта).
// Структура: localStorage['raschet.activeProject.v1'] = { name, code, ... }
// =========================================================================
export function getActiveProjectCode() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('raschet.activeProject.v1');
    if (!raw) return null;
    const p = JSON.parse(raw);
    const code = p && (p.code || p.projectCode || p.internalCode);
    return code ? String(code).trim().toUpperCase() : null;
  } catch { return null; }
}

// =========================================================================
// Детект режима: standalone vs embedded
// embedded = запуск из другой подпрограммы или из главной схемы
// Определяется по URL-параметру ?embedded=1 или ?mode=embedded, либо по
// window.name === 'raschet-embed'.
// =========================================================================
export function isEmbeddedMode() {
  if (typeof window === 'undefined') return false;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('embedded') === '1' || p.get('mode') === 'embedded') return true;
  } catch {}
  if (window.name === 'raschet-embed') return true;
  // opener-режим: если вызвано через window.open с флагом
  try {
    if (window.opener && window.__raschetEmbed === true) return true;
  } catch {}
  return false;
}

// =========================================================================
// Человекочитаемые подписи для списка. Отдельная функция, чтобы UI не
// дублировал логику.
// =========================================================================
export function formatConfigLine(entry) {
  if (!entry) return '';
  const id = entry.id || '??';
  const lab = entry.label || '';
  const desc = entry.description || '';
  if (lab && desc) return `${id} · ${lab} — ${desc}`;
  if (lab) return `${id} · ${lab}`;
  if (desc) return `${id} — ${desc}`;
  return id;
}
