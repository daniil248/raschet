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
  if (o.selectionName) out = out.filter(x => (x.selectionName || '') === o.selectionName);
  if (o.search) {
    const q = String(o.search).toLowerCase();
    out = out.filter(x =>
      (x.id || '').toLowerCase().includes(q) ||
      (x.label || '').toLowerCase().includes(q) ||
      (x.description || '').toLowerCase().includes(q) ||
      (x.selectionName || '').toLowerCase().includes(q));
  }
  // По умолчанию — свежие сверху
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

// v0.60.422 (по запросу Пользователя 2026-05-06: «Добавь конфигурации с
// вариантами как в модуле подбор холода»): группировка списка конфигураций
// по полю `selectionName` (Подбор). Записи без selectionName попадают в
// группу «— Без подбора —».
// Возвращает Map<selectionName, ConfigEntry[]>.
export function listConfigsGrouped(kind, opts) {
  const items = listConfigs(kind, opts);
  const groups = new Map();
  for (const e of items) {
    const sel = String(e.selectionName || '').trim() || '— Без подбора —';
    if (!groups.has(sel)) groups.set(sel, []);
    groups.get(sel).push(e);
  }
  return groups;
}

// v0.60.422: список уникальных selectionName для autocomplete в save-dialog.
export function listSelectionNames(kind, opts) {
  const items = listConfigs(kind, opts);
  const names = new Set();
  for (const e of items) {
    const sel = String(e.selectionName || '').trim();
    if (sel) names.add(sel);
  }
  return [...names].sort();
}

// v0.60.422: пометить вариант как ★ основной в своём подборе.
// В одном подборе только один вариант может быть ★.
export function setMainVariant(kind, selectionName, configId) {
  if (!selectionName || !configId) return false;
  const all = readAll(kind);
  let changed = false;
  for (const e of all) {
    const matchSel = (e.selectionName || '') === selectionName;
    if (!matchSel) continue;
    const shouldBeMain = e.id === configId;
    if (!!e.isMainVariant !== shouldBeMain) {
      e.isMainVariant = shouldBeMain;
      e.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) writeAll(kind, all);
  return changed;
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
// v0.60.427: ЗАПИСЬ ПОДБОРА (selection-level record).
// По запросу Пользователя 2026-05-15: «подбор ИБП и АКБ должен быть выполнен
// как подбор холодильных систем — в самом подборе все УСЛОВИЯ, а в вариантах
// конкретные решения, со сравнениями, TCO, CAPEX, OPEX».
//
// Раньше `selectionName` был просто строкой-тегом на каждом варианте.
// Теперь у подбора есть собственная запись с общими УСЛОВИЯМИ (requirements,
// формат задаёт модуль: kW, автономия, резерв, топология…) и ФИНАНСОВЫМИ
// параметрами (eco — форма DEFAULT_ECONOMICS из shared/calc/capex-tco.js:
// валюта, срок проекта, ставка дисконтирования, эскалации, costItems[]).
//
//   SelectionMeta = {
//     kind, projectCode|null, selectionName,
//     requirements: {},  — общие условия подбора (module-defined)
//     eco: {},           — общие фин. параметры (DEFAULT_ECONOMICS-shape)
//     createdAt, updatedAt,
//   }
//
// Ключ localStorage: raschet.selections.<kind>.v1 = SelectionMeta[]
// Идентификация записи — пара (projectCode||'', selectionName).
// =========================================================================
const SEL_KEY_PREFIX = 'raschet.selections.';

function selStorageKey(kind) {
  return SEL_KEY_PREFIX + String(kind || 'misc') + '.' + SCHEMA_VERSION;
}
function readAllSelections(kind) {
  try {
    const raw = localStorage.getItem(selStorageKey(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeAllSelections(kind, arr) {
  try { localStorage.setItem(selStorageKey(kind), JSON.stringify(arr || [])); }
  catch (e) { console.warn('[configuration-catalog] selection write failed', e); }
  notify(kind);
}
function _selMatch(s, projectCode, selectionName) {
  return String(s.selectionName || '') === String(selectionName || '')
      && String(s.projectCode || '') === String(projectCode || '');
}

/** Запись подбора по (projectCode, selectionName) или null. */
export function getSelectionMeta(kind, opts) {
  const o = opts || {};
  if (!o.selectionName) return null;
  return readAllSelections(kind)
    .find(s => _selMatch(s, o.projectCode || null, o.selectionName)) || null;
}

/** Все записи подборов (опц. фильтр по projectCode). */
export function listSelectionMetas(kind, opts) {
  const o = opts || {};
  let out = readAllSelections(kind);
  if (o.projectCode !== undefined) {
    out = out.filter(s => String(s.projectCode || '') === String(o.projectCode || ''));
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/** Upsert записи подбора по (projectCode, selectionName). */
export function saveSelectionMeta(kind, entry) {
  const e = entry || {};
  if (!e.selectionName) return null;
  const now = Date.now();
  const all = readAllSelections(kind);
  const idx = all.findIndex(s => _selMatch(s, e.projectCode || null, e.selectionName));
  let rec;
  if (idx >= 0) {
    rec = {
      ...all[idx],
      requirements: e.requirements !== undefined ? e.requirements : all[idx].requirements,
      eco: e.eco !== undefined ? e.eco : all[idx].eco,
      updatedAt: now,
    };
    all[idx] = rec;
  } else {
    rec = {
      kind: String(kind),
      projectCode: e.projectCode || null,
      selectionName: String(e.selectionName),
      requirements: e.requirements || {},
      eco: e.eco || {},
      createdAt: now,
      updatedAt: now,
    };
    all.push(rec);
  }
  writeAllSelections(kind, all);
  return rec;
}

/** Гарантировать существование записи подбора (lazy-create с дефолтами). */
export function ensureSelectionMeta(kind, opts, defaults) {
  const o = opts || {};
  if (!o.selectionName) return null;
  const existing = getSelectionMeta(kind, o);
  if (existing) return existing;
  const d = defaults || {};
  return saveSelectionMeta(kind, {
    projectCode: o.projectCode || null,
    selectionName: o.selectionName,
    requirements: d.requirements || {},
    eco: d.eco || {},
  });
}

/**
 * Переименовать подбор: меняем selectionName в записи подбора И во всех
 * вариантах с этим selectionName (чтобы тег оставался консистентным).
 */
export function renameSelection(kind, opts) {
  const o = opts || {};
  const pc = o.projectCode || null;
  if (!o.oldName || !o.newName || o.oldName === o.newName) return false;
  let changed = false;
  const sels = readAllSelections(kind);
  for (const s of sels) {
    if (_selMatch(s, pc, o.oldName)) { s.selectionName = String(o.newName); s.updatedAt = Date.now(); changed = true; }
  }
  if (changed) writeAllSelections(kind, sels);
  const all = readAll(kind);
  let cChanged = false;
  for (const e of all) {
    if ((e.selectionName || '') === o.oldName && String(e.projectCode || '') === String(pc || '')) {
      e.selectionName = String(o.newName); e.updatedAt = Date.now(); cChanged = true;
    }
  }
  if (cChanged) writeAll(kind, all);
  return changed || cChanged;
}

/** Удалить запись подбора. variantsToo=true → удалить и все варианты. */
export function deleteSelection(kind, opts) {
  const o = opts || {};
  const pc = o.projectCode || null;
  if (!o.selectionName) return false;
  const sels = readAllSelections(kind);
  const nextSels = sels.filter(s => !_selMatch(s, pc, o.selectionName));
  let changed = nextSels.length !== sels.length;
  if (changed) writeAllSelections(kind, nextSels);
  if (o.variantsToo) {
    const all = readAll(kind);
    const keep = all.filter(e => !((e.selectionName || '') === o.selectionName
      && String(e.projectCode || '') === String(pc || '')));
    if (keep.length !== all.length) { writeAll(kind, keep); changed = true; }
  }
  return changed;
}

// =========================================================================
// Активный проект (для привязки конфигураций к коду проекта).
//
// v0.60.439 (по замечанию Пользователя 2026-05-15: «не нужно в нескольких
// местах отображать разные проекты»): ЕДИНЫЙ источник активного проекта —
// тот же, что у бейджа проекта в шапке (`raschet.activeProjectId.v1` →
// `raschet.projects.v1`). Раньше этот код читал отдельный ключ
// `raschet.activeProject.v1` (его пишет только главная схема js/main.js),
// поэтому в ups/cooling/battery сайдбар показывал ДРУГОЙ проект (или
// «Разовый»), чем шапка. Теперь единый источник; старый ключ — fallback.
// =========================================================================

// Ссылка на активный проект из ЕДИНОГО источника (шапка): {id, code, name}.
export function getActiveProjectRef() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const aid = localStorage.getItem('raschet.activeProjectId.v1');
    if (aid) {
      const arr = JSON.parse(localStorage.getItem('raschet.projects.v1') || '[]');
      const p = Array.isArray(arr) ? arr.find(x => x && x.id === aid) : null;
      if (p) {
        const code = p.code || p.projectCode || p.internalCode || p.designation || p.id;
        return { id: p.id, code: code ? String(code).trim().toUpperCase() : null, name: p.name || p.designation || p.id };
      }
    }
  } catch {}
  // legacy fallback — отдельный ключ, который пишет только главная схема
  try {
    const raw = localStorage.getItem('raschet.activeProject.v1');
    if (!raw) return null;
    const p = JSON.parse(raw);
    const code = p && (p.code || p.projectCode || p.internalCode);
    return { id: p && p.id || null, code: code ? String(code).trim().toUpperCase() : null, name: (p && p.name) || (code || null) };
  } catch { return null; }
}

export function getActiveProjectCode() {
  const ref = getActiveProjectRef();
  return ref ? ref.code : null;
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
