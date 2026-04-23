/* ============================================================
   scs-design.js — Проектирование СКС (Подфаза 1.26)
   Вкладка «Связи» — мастер меж-шкафных связей:
   • выбор N стоек из проекта → карточки рядом,
   • клик по юниту A → клик по юниту B → создать связь,
   • список связей с типом кабеля и удалением.
   ============================================================ */

import {
  ensureDefaultProject, getActiveProjectId, setActiveProjectId, getProject, projectKey,
  listProjectsForModule, createSketchForModule
} from '../shared/project-storage.js';
// v0.59.278: project-scoped экземпляры стоек (см. shared/rack-storage.js).
import {
  loadAllRacksForActiveProject, saveAllRacksForActiveProject, migrateLegacyInstances,
  LS_TEMPLATES_GLOBAL
} from '../shared/rack-storage.js';

const LS_RACK      = LS_TEMPLATES_GLOBAL;              // для совместимости storage-listener
const LS_CATALOG   = 'scs-config.catalog.v1';          // глобальный каталог IT
// LS_CONTENTS / LS_RACKTAGS переведены на проектный неймспейс (1.27.3).
let LS_CONTENTS    = 'scs-config.contents.v1';
let LS_RACKTAGS    = 'scs-config.rackTags.v1';

// Проектные данные — в неймспейсе активного проекта.
// Ключи инициализируются в rescopeToActiveProject() один раз при запуске.
let LS_SELECTION = 'scs-design.selection.v1';
let LS_LINKS     = 'scs-design.links.v1';
let LS_PLAN      = 'scs-design.plan.v1';

// Старые (глобальные) ключи — для одноразовой миграции в активный проект.
const OLD_KEYS = {
  selection: 'scs-design.selection.v1',
  links:     'scs-design.links.v1',
  plan:      'scs-design.plan.v1',
};

function renderProjectBadge(pid) {
  const host = document.getElementById('sd-project-badge');
  if (!host) return;
  const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  const projects = listProjectsForModule('scs-design');
  const p = pid ? getProject(pid) : null;

  const opts = projects.map(x => {
    const label = (x.kind === 'sketch' ? '🧪 ' : '🏢 ') + (x.name || '(без имени)');
    return `<option value="${esc(x.id)}" ${x.id === pid ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');

  host.innerHTML = `
    <span class="muted">Контекст:</span>
    <select id="sd-project-switcher" title="Активный проект или мини-проект СКС">${opts}</select>
    <button type="button" class="sd-btn-sel" id="sd-project-new-sketch" title="Создать мини-проект СКС (автономный черновик без обязательного полноценного проекта)">＋ Мини-проект</button>
    ${p ? `<span class="muted">${p.kind === 'sketch' ? '· 🧪 черновик (мини-проект СКС)' : '· 🏢 полноценный проект'}</span>` : ''}
    <a href="../projects/" style="margin-left:auto">→ управлять проектами</a>
  `;

  document.getElementById('sd-project-switcher')?.addEventListener('change', e => {
    setActiveProjectId(e.target.value);
    location.reload();
  });
  document.getElementById('sd-project-new-sketch')?.addEventListener('click', async () => {
    const name = await sdPrompt('Создать мини-проект СКС', 'Имя черновика', 'Черновик СКС');
    if (!name) return;
    const sp = createSketchForModule('scs-design', name);
    setActiveProjectId(sp.id);
    location.reload();
  });
}

// Wizard создания стойки в проект: имя, высота U, опционально базовая
// комплектация (патч-панель + коммутатор 1U). Возвращает null при отмене.
function sdRackWizard() {
  return new Promise(res => {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-modal" style="min-width:360px">
        <h3 style="margin:0 0 10px">＋ Новая стойка в проект</h3>
        <label style="display:block;margin:8px 0 4px;color:#cbd5e1;font-size:13px">Имя</label>
        <input type="text" id="rw-name" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="Стойка A-01" autocomplete="off">
        <label style="display:block;margin:10px 0 4px;color:#cbd5e1;font-size:13px">Тег (A-01, RACK-A1…) — можно пусто</label>
        <input type="text" id="rw-tag" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="A-01" autocomplete="off">
        <label style="display:block;margin:10px 0 4px;color:#cbd5e1;font-size:13px">Высота, U</label>
        <select id="rw-u" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569">
          <option>12</option><option>18</option><option>24</option><option>32</option><option selected>42</option><option>47</option>
        </select>
        <label style="display:flex;align-items:center;gap:8px;margin:14px 0 4px;color:#cbd5e1;font-size:13px;cursor:pointer">
          <input type="checkbox" id="rw-basic" checked>
          <span>Базовая комплектация: 1× патч-панель 24 порта (U1) + 1× коммутатор 24 порта (U2) + 1× 1U-органайзер (U3)</span>
        </label>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="sd-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="sd-btn-export" data-act="yes">Создать</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rw-name').focus();
    overlay.querySelector('#rw-name').select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) return done(null);
      if (e.target.dataset?.act === 'no') return done(null);
      if (e.target.dataset?.act === 'yes') {
        const name = (overlay.querySelector('#rw-name').value || '').trim();
        if (!name) { overlay.querySelector('#rw-name').focus(); return; }
        done({
          name,
          tag: (overlay.querySelector('#rw-tag').value || '').trim(),
          u: +overlay.querySelector('#rw-u').value || 42,
          basic: overlay.querySelector('#rw-basic').checked,
        });
      }
    });
  });
}

// Создать стойку в проекте: добавить шаблон в библиотеку, создать запись
// в contents (с опциональной базовой комплектацией) и тег. Возвращает id.
function createProjectRack(opts) {
  // v0.59.278: новый экземпляр в проекте должен иметь префикс 'inst-',
  // чтобы попадать в project-scoped хранилище, а не глобальные шаблоны.
  const id = 'inst-' + Math.random().toString(36).slice(2, 10);
  const racks = getRacks();
  racks.push({
    id, name: opts.name, manufacturer: '', kitId: '',
    u: opts.u || 42, width: 600, depth: 1000,
    doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
    lock: 'key', sides: 'pair-sku', top: 'vent', base: 'feet',
    comboTopBase: false, entryTop: 2, entryBot: 2, entryType: 'brush',
    occupied: 0, blankType: '1U-solid',
    demandKw: 5, cosphi: 0.9, pduRedundancy: '2N', pdus: [],
  });
  try { saveAllRacksForActiveProject(racks); } catch (e) { saveJson(LS_RACK, racks); }

  // contents в проекте
  const all = loadJson(LS_CONTENTS, {});
  const devices = [];
  if (opts.basic) {
    const cat = getCatalog();
    const findByKind = k => cat.find(t => t.kind === k);
    const patch  = findByKind('patch-panel');
    const sw     = findByKind('switch');
    const cm     = findByKind('cable-manager');
    const mkDev = (typeId, label, uStart, heightU, ports) => ({
      id: 'd-' + Math.random().toString(36).slice(2, 9),
      typeId: typeId || '', label, uStart, heightU: heightU || 1,
      ports: ports || 0, powerW: 0,
    });
    devices.push(mkDev(patch?.id, 'Патч-панель 24', 1, 1, 24));
    devices.push(mkDev(sw?.id,    'Коммутатор 24', 2, 1, 24));
    devices.push(mkDev(cm?.id,    'Органайзер 1U', 3, 1, 0));
  }
  all[id] = devices;
  saveJson(LS_CONTENTS, all);

  // тег в проекте
  if (opts.tag) {
    const tags = loadJson(LS_RACKTAGS, {});
    tags[id] = opts.tag;
    saveJson(LS_RACKTAGS, tags);
  }
  return id;
}

// «В проекте» = либо есть запись в contents активного проекта, либо есть
// тег в racktags активного проекта (пустая стойка, но явно названа).
function getProjectRackIds() {
  // v0.59.281: источник истины — экземпляры активного проекта (inst-*)
  // из project-scoped хранилища + fallback на legacy-contents/tags (на случай
  // миграций). Глобальные шаблоны (tpl-*) никогда сюда не попадают.
  const ids = new Set();
  try { getProjectInstances().forEach(r => { if (r && r.id) ids.add(r.id); }); } catch {}
  const byContent = loadJson(LS_CONTENTS, {});
  const byTag     = loadJson(LS_RACKTAGS, {});
  Object.keys(byContent || {}).forEach(id => { if (String(id).startsWith('inst-')) ids.add(id); });
  Object.keys(byTag || {}).forEach(id => {
    if (String(id).startsWith('inst-') && (byTag[id] || '').trim()) ids.add(id);
  });
  return ids;
}

function sdPrompt(title, label, initial = '') {
  return new Promise(res => {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-modal">
        <h3 style="margin:0 0 8px">${esc(title)}</h3>
        <label style="display:block;margin:6px 0 4px;color:#cbd5e1;font-size:13px">${esc(label)}</label>
        <input type="text" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="${esc(initial)}">
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="sd-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="sd-btn-export" data-act="yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus(); input.select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      if (e.target.dataset?.act === 'yes') done((input.value || '').trim() || null);
      if (e.target.dataset?.act === 'no')  done(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  done((input.value || '').trim() || null);
      if (e.key === 'Escape') done(null);
    });
  });
}

function rescopeToActiveProject() {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  LS_SELECTION = projectKey(pid, 'scs-design', 'selection.v1');
  LS_LINKS     = projectKey(pid, 'scs-design', 'links.v1');
  LS_PLAN      = projectKey(pid, 'scs-design', 'plan.v1');
  // scs-config shared проектные ключи (1.27.3) — читаем уже из проектного неймспейса.
  LS_CONTENTS  = projectKey(pid, 'scs-config', 'contents.v1');
  LS_RACKTAGS  = projectKey(pid, 'scs-config', 'rackTags.v1');
  // Одноразовая миграция: если в новом ключе пусто, а в старом есть — копируем.
  const pairs = [
    [OLD_KEYS.selection, LS_SELECTION],
    [OLD_KEYS.links,     LS_LINKS],
    [OLD_KEYS.plan,      LS_PLAN],
  ];
  let migrated = 0;
  for (const [oldK, newK] of pairs) {
    if (oldK === newK) continue; // если проект ещё не создан и ключ совпал — пропустим
    try {
      const newExists = localStorage.getItem(newK) != null;
      const oldVal = localStorage.getItem(oldK);
      if (!newExists && oldVal != null) {
        localStorage.setItem(newK, oldVal);
        migrated++;
      }
    } catch {}
  }
  return { pid, migrated };
}

/* Типы оборудования, у которых нет портов — могут служить только каналом
   для трассировки сплайна, но не endpoint-ом связи. */
const NO_PORT_KINDS = new Set(['cable-manager']);

const CABLE_TYPES = [
  // maxGbps — практический потолок скорости кабеля (NULL = неприменимо).
  // diameterMm — внешний диаметр оболочки кабеля (для расчёта заполнения
  // кабельного канала). Типовые значения производителей.
  { id: 'cat6',      label: 'Cat.6 U/UTP',     color: '#1976d2', maxGbps: 1,    diameterMm: 6.2 },
  { id: 'cat6a',     label: 'Cat.6A F/UTP',    color: '#1565c0', maxGbps: 10,   diameterMm: 7.5 },
  { id: 'cat7',      label: 'Cat.7 S/FTP',     color: '#0d47a1', maxGbps: 10,   diameterMm: 8.0 },
  { id: 'om3',       label: 'OM3 LC-LC',       color: '#ea580c', maxGbps: 40,   diameterMm: 3.0 },
  { id: 'om4',       label: 'OM4 LC-LC',       color: '#c2410c', maxGbps: 100,  diameterMm: 3.0 },
  { id: 'os2',       label: 'OS2 LC-LC',       color: '#facc15', maxGbps: 400,  diameterMm: 3.0 },
  { id: 'coax',      label: 'Coax / RF',       color: '#7c3aed', maxGbps: null, diameterMm: 7.0 },
  { id: 'power-c13', label: 'Питание C13/C14', color: '#dc2626', maxGbps: null, diameterMm: 10.0 },
  { id: 'other',     label: 'Другое',          color: '#64748b', maxGbps: null, diameterMm: 8.0 },
];
const CABLE_DIAMETER = id => (CABLE_TYPES.find(c => c.id === id)?.diameterMm) || 8.0;
/* Разбор скорости устройства (portSpeed из каталога) в Гбит/с.
   Принимает: «1G», «10G», «40G», «100G», «400G», «1 Gbps», «100M»→0.1. */
function parseGbps(s) {
  if (!s) return null;
  const m = String(s).match(/([\d.]+)\s*(g|m|k)?/i);
  if (!m) return null;
  const v = +m[1]; if (!Number.isFinite(v)) return null;
  const u = (m[2] || 'g').toLowerCase();
  return u === 'k' ? v / 1e6 : u === 'm' ? v / 1000 : v;
}
const CABLE_COLOR = id => (CABLE_TYPES.find(c => c.id === id)?.color) || '#64748b';

/* v0.59.281: лёгкая модель типов портов для валидации меж-шкафных связей.
   Полноценное моделирование портов (RJ45/LC/SC/SFP/BNC/…) — тема Phase
   1.1.3 (element-library). Пока — эвристика по kind каталога + optional
   override в catalog[i].portType. */
const DEFAULT_PORT_BY_KIND = {
  'switch': 'rj45',
  'patch-panel': 'rj45',
  'server': 'rj45',
  'ups': 'power',
  'cable-manager': null,
  'kvm': 'rj45',
  'firewall': 'rj45',
  'router': 'rj45',
  'other': 'rj45',
};

/* Кабель → какие типы портов допустимы на обоих концах. */
const CABLE_PORT_COMPAT = {
  'cat6':  new Set(['rj45']),
  'cat6a': new Set(['rj45']),
  'cat7':  new Set(['rj45']),
  'om3':   new Set(['lc', 'sc', 'sfp']),
  'om4':   new Set(['lc', 'sc', 'sfp']),
  'os2':   new Set(['lc', 'sc', 'sfp']),
  'coax':  new Set(['bnc', 'f']),
  'power-c13': new Set(['c13', 'c14', 'power']),
  'other': null, // 'other' пропускаем — не валидируем
};

function inferPortType(dev) {
  if (!dev) return null;
  const t = catalogType(dev.typeId);
  if (!t) return null;
  if (t.portType) return String(t.portType).toLowerCase();
  const hint = ((t.label || '') + ' ' + (dev.label || '')).toLowerCase();
  if (/\bsfp|\bfib|оптик|lc[-\s]|\blc\b/.test(hint)) return 'lc';
  if (/\bкоакс|\bcoax|bnc/.test(hint)) return 'bnc';
  return DEFAULT_PORT_BY_KIND[t.kind] || 'rj45';
}

/* Возвращает { ok, reason } для меж-шкафной связи. */
function linkCompat(l) {
  if (!l) return { ok: true };
  const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
  const to   = getContents(l.toRackId  ).find(x => x.id === l.toDevId);
  const pa = inferPortType(from);
  const pb = inferPortType(to);
  const ct = l.cableType || '';
  const compat = CABLE_PORT_COMPAT[ct];
  const reasons = [];
  if (pa && pb && pa !== pb) reasons.push(`несовпадение типов портов (A: ${pa}, B: ${pb})`);
  if (compat) {
    if (pa && !compat.has(pa)) reasons.push(`порт A «${pa}» не подходит для «${ct}»`);
    if (pb && !compat.has(pb)) reasons.push(`порт B «${pb}» не подходит для «${ct}»`);
  }
  // Валидация скорости: кабель не должен быть «тоньше» чем порт устройства.
  const cable = CABLE_TYPES.find(c => c.id === ct);
  const maxG = cable?.maxGbps;
  if (maxG != null) {
    const fromT = from ? catalogType(from.typeId) : null;
    const toT   = to   ? catalogType(to.typeId)   : null;
    const sA = parseGbps(fromT?.portSpeed);
    const sB = parseGbps(toT?.portSpeed);
    if (sA != null && sA > maxG) reasons.push(`порт A ${sA}G > max кабеля ${maxG}G`);
    if (sB != null && sB > maxG) reasons.push(`порт B ${sB}G > max кабеля ${maxG}G`);
  }
  return { ok: reasons.length === 0, reason: reasons.join('; '), portA: pa, portB: pb };
}

/* ---------- storage ---------- */
function loadJson(key, fb) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; }
  catch { return fb; }
}
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function getRacks() {
  // v0.59.278: шаблоны глобальные + экземпляры активного проекта.
  try { migrateLegacyInstances(); return loadAllRacksForActiveProject(); }
  catch { const r = loadJson(LS_RACK, []); return Array.isArray(r) ? r : []; }
}
function getRackTag(id) { const t = loadJson(LS_RACKTAGS, {}); return (t && typeof t === 'object') ? (t[id] || '') : ''; }
function getContents(id) {
  const all = loadJson(LS_CONTENTS, {});
  const a = all && typeof all === 'object' ? all[id] : null;
  return Array.isArray(a) ? a : [];
}
function getLinks() { const l = loadJson(LS_LINKS, []); return Array.isArray(l) ? l : []; }
function setLinks(arr) { saveJson(LS_LINKS, arr); }
/* v0.59.283: фантомные связи (endpoint на tpl-*, на стойку чужого проекта
   или на удалённое устройство) НЕ показываются в UI Проектирования СКС —
   отображаются только «действующие» кабели. В storage исходные записи
   остаются: если стойка/устройство вернётся, связь снова станет видимой. */
function isLinkLive(l, instIds) {
  if (!instIds.has(l.fromRackId) || !instIds.has(l.toRackId)) return false;
  const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
  const to   = getContents(l.toRackId).find(x => x.id === l.toDevId);
  return !!from && !!to;
}
function getVisibleLinks() {
  const raw = getLinks();
  if (!raw.length) return raw;
  const instIds = new Set(getProjectInstances().map(r => r.id));
  return raw.filter(l => isLinkLive(l, instIds));
}
function rackById(id) { return getRacks().find(r => r.id === id); }

/* v0.59.281: строгий project-scope для модуля проектирования СКС.
   Плейсмент на план-зал, меж-шкафные связи и т.п. должны работать ТОЛЬКО
   с развёрнутыми стойками текущего проекта (id = inst-*). Глобальные
   шаблоны (tpl-*) — это дизайны корпусов, их не размещают в зал. */
function getProjectInstances() {
  return getRacks().filter(r => r && r.id && String(r.id).startsWith('inst-'));
}
function getCatalog() { const c = loadJson(LS_CATALOG, []); return Array.isArray(c) ? c : []; }
function catalogType(typeId) { return getCatalog().find(t => t.id === typeId) || null; }
function isOrganizer(dev) {
  if (!dev) return false;
  const t = catalogType(dev.typeId);
  return !!(t && NO_PORT_KINDS.has(t.kind));
}

/* Очистка некорректных связей: endpoint = безпортовое устройство (органайзер
   и т.п.). Запускается один раз при инициализации. Возвращает число удалённых. */
function sanitizeLinks() {
  const cur = getLinks();
  if (!cur.length) return 0;
  const keep = cur.filter(l => {
    const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
    const to = getContents(l.toRackId).find(x => x.id === l.toDevId);
    // Если устройство удалено (from/to === undefined) — оставляем, это отдельная
    // проблема «battle damaged» связи. Фильтруем только явные органайзеры.
    if (from && isOrganizer(from)) return false;
    if (to && isOrganizer(to)) return false;
    return true;
  });
  const removed = cur.length - keep.length;
  if (removed > 0) setLinks(keep);
  return removed;
}
function deviceLabel(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId);
  return d ? (d.label || d.typeId || devId) : '(удалено)';
}
function devicePorts(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId); if (!d) return 0;
  const t = catalogType(d.typeId);
  return (t && +t.ports) || 0;
}
function portsUsedOn(rackId, devId, excludeLinkId) {
  const used = new Set();
  getLinks().forEach(l => {
    if (excludeLinkId && l.id === excludeLinkId) return;
    if (l.fromRackId === rackId && l.fromDevId === devId && l.fromPort) used.add(+l.fromPort);
    if (l.toRackId === rackId && l.toDevId === devId && l.toPort) used.add(+l.toPort);
  });
  return used;
}
function rackLabel(r) {
  const tag = getRackTag(r.id);
  const name = r.name || 'Без имени';
  return tag ? `${tag} · ${name}` : name;
}
function newId() { return 'ln_' + Math.random().toString(36).slice(2, 10); }

/* ---------- UI state ---------- */
let linkStart = null; // { rackId, devId, label }
let lastLink = null;  // { fromRackId, fromDevId, toRackId, toDevId } — для batch wire

function promptBatchWire() {
  if (!lastLink) return;
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  if (pFrom <= 1 || pTo <= 1) return;
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const freeFrom = pFrom - usedFrom.size;
  const freeTo   = pTo   - usedTo.size;
  const maxCount = Math.min(freeFrom, freeTo);
  if (maxCount <= 0) { updateStatus(`⚠ Нет свободных портов для продолжения.`); return; }

  const st = document.getElementById('sd-status');
  if (!st) return;
  st.innerHTML = `
    <span>+ связей (1…${maxCount}):</span>
    <input id="sd-batch-n" type="number" min="1" max="${maxCount}" value="${maxCount}" style="width:60px;margin:0 6px;padding:2px 4px">
    <button id="sd-batch-ok" class="sd-btn-sel">Создать</button>
    <button id="sd-batch-cancel" class="sd-btn-sel" style="margin-left:4px">Отмена</button>
  `;
  st.style.display = '';
  document.getElementById('sd-batch-n').focus();
  document.getElementById('sd-batch-ok').addEventListener('click', () => {
    const n = Math.max(1, Math.min(maxCount, +document.getElementById('sd-batch-n').value || 1));
    createBatchLinks(n);
  });
  document.getElementById('sd-batch-cancel').addEventListener('click', () => updateStatus(''));
}

function createBatchLinks(n) {
  if (!lastLink || n <= 0) return;
  const links = getLinks();
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  const fromSeq = [];
  for (let p = 1; p <= pFrom && fromSeq.length < n; p++) if (!usedFrom.has(p)) fromSeq.push(p);
  const toSeq = [];
  for (let p = 1; p <= pTo && toSeq.length < n; p++) if (!usedTo.has(p)) toSeq.push(p);
  const count = Math.min(fromSeq.length, toSeq.length);
  const fromLabel = deviceLabel(lastLink.fromRackId, lastLink.fromDevId);
  const toLabel = deviceLabel(lastLink.toRackId, lastLink.toDevId);
  for (let i = 0; i < count; i++) {
    links.push({
      id: newId(),
      fromRackId: lastLink.fromRackId, fromDevId: lastLink.fromDevId, fromLabel,
      toRackId: lastLink.toRackId, toDevId: lastLink.toDevId, toLabel,
      fromPort: fromSeq[i], toPort: toSeq[i],
      cableType: 'cat6a', lengthM: null, note: '', createdAt: Date.now(),
    });
  }
  setLinks(links);
  updateStatus(`✔ Добавлено ${count} связей подряд (порты A:${fromSeq[0]}-${fromSeq[count-1]} ↔ B:${toSeq[0]}-${toSeq[count-1]}).`);
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
  renderLegend();
}

/* ---------- Tabs ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.sd-tab');
  const panels = document.querySelectorAll('.sd-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
      if (key === 'links') scheduleOverlay();
      if (key === 'racks') renderRacksSummary();
      if (key === 'plan')  renderPlan();
    });
  });
}

/* ---------- Links tab ---------- */
function renderLinksTab() {
  const picker = document.getElementById('sd-rack-picker');
  const row = document.getElementById('sd-racks-row');
  const empty = document.getElementById('sd-empty');
  const racks = getRacks();

  if (!racks.length) {
    picker.innerHTML = '';
    row.innerHTML = '';
    empty.style.display = '';
    empty.innerHTML = `
      <p>В проекте ещё нет шкафов. Сначала создайте их:</p>
      <p>→ <a href="../rack-config/">Конфигуратор шкафа — корпус</a> (шаблоны)<br>
      → <a href="../scs-config/">Шкафы проекта</a> (наполнение).</p>
    `;
    renderLinksList();
    return;
  }
  empty.style.display = 'none';

  const selected = new Set(loadJson(LS_SELECTION, []));
  const q = (pickerQuery || '').trim().toLowerCase();
  const matches = r => {
    if (!q) return true;
    const tag = (getRackTag(r.id) || '').toLowerCase();
    const name = (r.name || '').toLowerCase();
    return tag.includes(q) || name.includes(q) || r.id.toLowerCase().includes(q);
  };
  // Фаза 1.27.4+: разделение «стойки проекта» vs «библиотека шаблонов».
  // В проекте = есть запись в LS_CONTENTS или тег в LS_RACKTAGS (оба scope'ятся
  // по pid). Библиотечные шаблоны = всё остальное. Библиотеку показываем
  // свернутой — кликом она добавляется в проект (создаётся пустая запись
  // contents), и стойка всплывает наверх в «Стойки проекта».
  const projIds = getProjectRackIds();
  const inProject  = racks.filter(r => projIds.has(r.id)).filter(matches);
  const library    = []; // v0.59.295: библиотека шаблонов убрана из мастера связей
  const real       = inProject.filter(r => (getRackTag(r.id) || '').trim());
  const drafts     = inProject.filter(r => !(getRackTag(r.id) || '').trim());
  const chipHtml = r => {
    const on = selected.has(r.id);
    const label = rackLabel(r);
    return `<label class="sd-rack-chip ${on ? 'on' : ''}" data-id="${r.id}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`;
  };
  const parts = [];
  // поиск
  const totalAll = racks.length;
  const shown = [...real, ...drafts, ...library];
  const totalShown = shown.length;
  const allShownSelected = totalShown > 0 && shown.every(r => selected.has(r.id));
  parts.push(`<div class="sd-picker-search">
    <input type="search" id="sd-picker-q" placeholder="🔍 поиск по тегу / имени / id" value="${escapeHtml(pickerQuery || '')}" autocomplete="off">
    <span class="muted">${q ? `${totalShown}/${totalAll}` : `${totalAll} шт.`}</span>
    ${totalShown > 0 ? `<button type="button" class="sd-btn-sel" id="sd-picker-toggle-all" title="Выбрать/снять все ${q ? 'найденные' : ''}">${allShownSelected ? '☐ снять все' : '☑ выбрать все'}</button>` : ''}
    ${q ? '<button type="button" class="sd-btn-sel" id="sd-picker-clear">×</button>' : ''}
    <button type="button" class="sd-btn-export" id="sd-new-rack" title="Создать новую стойку в этом проекте (имя/тег/U, опционально — базовое оборудование)">＋ Новая стойка</button>
  </div>`);
  if (real.length) {
    parts.push(`<div class="sd-rack-group-h">🗄 Стойки проекта — с тегом (${real.length})</div>`);
    parts.push(`<div class="sd-rack-group">${real.map(chipHtml).join('')}</div>`);
  }
  if (drafts.length) {
    parts.push(`<div class="sd-rack-group-h draft">📐 Стойки проекта — без тега / черновики (${drafts.length})</div>`);
    parts.push(`<div class="sd-rack-group draft">${drafts.map(chipHtml).join('')}</div>`);
  }
  if (library.length) {
    parts.push(`<div class="sd-rack-group-h" style="opacity:.7">📚 Библиотека шаблонов (${library.length}) — клик добавит в проект</div>`);
    parts.push(`<div class="sd-rack-group" style="opacity:.75">${library.map(chipHtml).join('')}</div>`);
  }
  if (!real.length && !drafts.length && !library.length && q) {
    parts.push(`<div class="sd-empty-state" style="padding:8px">Ничего не найдено по «${escapeHtml(q)}». Проверьте раскладку или очистите поиск.</div>`);
  }
  picker.innerHTML = parts.join('');

  const qInput = document.getElementById('sd-picker-q');
  if (qInput) {
    qInput.addEventListener('input', e => {
      pickerQuery = e.target.value;
      renderLinksTab();
      // вернуть фокус в поле после re-render
      const q2 = document.getElementById('sd-picker-q');
      if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
    });
  }
  document.getElementById('sd-picker-clear')?.addEventListener('click', () => {
    pickerQuery = '';
    renderLinksTab();
  });
  document.getElementById('sd-picker-toggle-all')?.addEventListener('click', () => {
    if (allShownSelected) shown.forEach(r => selected.delete(r.id));
    else shown.forEach(r => selected.add(r.id));
    saveJson(LS_SELECTION, Array.from(selected));
    renderLinksTab();
  });

  // Кнопка «＋ Новая стойка»: создать и сразу выбрать в мастер
  document.getElementById('sd-new-rack')?.addEventListener('click', async () => {
    const opts = await sdRackWizard();
    if (!opts) return;
    const newId = createProjectRack(opts);
    const sel = new Set(loadJson(LS_SELECTION, []));
    sel.add(newId);
    saveJson(LS_SELECTION, Array.from(sel));
    renderLinksTab();
  });

  picker.querySelectorAll('.sd-rack-chip').forEach(chip => {
    const id = chip.dataset.id;
    const input = chip.querySelector('input');
    input.addEventListener('change', () => {
      // Если пользователь выбирает стойку из библиотеки — автоматически
      // добавляем её в проект (пустая запись contents), чтобы в следующий
      // раз она показалась в группе «Стойки проекта».
      if (input.checked && !projIds.has(id)) {
        const all = loadJson(LS_CONTENTS, {});
        if (!all[id]) { all[id] = []; saveJson(LS_CONTENTS, all); }
      }
      if (input.checked) selected.add(id); else selected.delete(id);
      saveJson(LS_SELECTION, Array.from(selected));
      chip.classList.toggle('on', input.checked);
      renderSelected(selected, racks);
    });
  });

  renderSelected(selected, racks);
  renderLinksList();
  renderLegend();
}

function renderLegend() {
  const host = document.getElementById('sd-legend'); if (!host) return;
  const used = new Set(getVisibleLinks().map(l => l.cableType || 'other'));
  if (!used.size) { host.innerHTML = ''; return; }
  host.innerHTML = '<span class="muted">Цвета кабелей:</span>' + CABLE_TYPES
    .filter(t => used.has(t.id))
    .map(t => `<span class="lg"><span class="lg-dot" style="background:${t.color}"></span>${escapeHtml(t.label)}</span>`)
    .join('');
}

function renderSelected(selected, racks) {
  const row = document.getElementById('sd-racks-row');
  const arr = racks.filter(r => selected.has(r.id));
  if (!arr.length) {
    row.innerHTML = `<div class="sd-empty-state">Выберите чекбоксами стойки выше — они появятся здесь рядом для проектирования связей.</div>`;
    drawLinkOverlay();
    return;
  }
  row.innerHTML = arr.map(r => renderRackCard(r)).join('');

  // клик по юниту — логика link-start / link-end
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    el.addEventListener('click', () => onUnitClick(el));
  });

  // подсветить устройства, участвующие в связях
  const links = getLinks();
  const involved = new Set();
  links.forEach(l => {
    involved.add(l.fromRackId + '|' + l.fromDevId);
    involved.add(l.toRackId + '|' + l.toDevId);
  });
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    const key = el.dataset.rackId + '|' + el.dataset.devId;
    el.classList.toggle('linked', involved.has(key));
  });

  drawLinkOverlay();
}

/* ---------- SVG overlay: кривые Безье между устройствами ---------- */
function drawLinkOverlay() {
  const svg = document.getElementById('sd-links-svg');
  const wrap = svg?.parentElement;
  const row = document.getElementById('sd-racks-row');
  if (!svg || !wrap || !row) return;
  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

  const getCenter = (rackId, devId, side) => {
    const el = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"][data-dev-id="${CSS.escape(devId)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const y = r.top - wrapRect.top + r.height / 2;
    const x = side === 'left' ? (r.left - wrapRect.left) : (r.right - wrapRect.left);
    return { x, y };
  };

  const cardXCenter = rackId => {
    const firstUnit = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"]`)
      || row.querySelector(`.sd-rack-card:has([data-rack-id="${CSS.escape(rackId)}"])`);
    if (!firstUnit) return null;
    const card = firstUnit.closest('.sd-rack-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return (r.left + r.right) / 2 - wrapRect.left;
  };

  const parts = [];
  const links = getVisibleLinks();
  links.forEach(l => {
    const fromCenter = cardXCenter(l.fromRackId);
    const toCenter = cardXCenter(l.toRackId);
    if (fromCenter == null || toCenter == null) return;
    const fromSide = fromCenter < toCenter ? 'right' : 'left';
    const toSide   = fromCenter < toCenter ? 'left'  : 'right';
    const A = getCenter(l.fromRackId, l.fromDevId, fromSide);
    const B = getCenter(l.toRackId, l.toDevId, toSide);
    if (!A || !B) return;
    const dx = Math.abs(B.x - A.x);
    const bend = Math.max(40, dx * 0.35);
    const c1x = A.x + (fromSide === 'right' ? bend : -bend);
    const c2x = B.x + (toSide === 'right' ? bend : -bend);
    const color = CABLE_COLOR(l.cableType);
    const fromTxt = getRackShortLabel(l.fromRackId) + ' · ' + deviceLabel(l.fromRackId, l.fromDevId) + (l.fromPort ? ` p${l.fromPort}` : '');
    const toTxt   = getRackShortLabel(l.toRackId)   + ' · ' + deviceLabel(l.toRackId,   l.toDevId)   + (l.toPort   ? ` p${l.toPort}`   : '');
    parts.push(`<path class="sd-link-path" d="M ${A.x} ${A.y} C ${c1x} ${A.y}, ${c2x} ${B.y}, ${B.x} ${B.y}" stroke="${color}"><title>${escapeAttr(fromTxt + ' ↔ ' + toTxt)}</title></path>`);
  });
  svg.innerHTML = parts.join('');
}

// Перерисовка линий при скролле/ресайзе
let overlayRaf = 0;
function scheduleOverlay() {
  if (overlayRaf) return;
  overlayRaf = requestAnimationFrame(() => { overlayRaf = 0; drawLinkOverlay(); });
}

function renderRackCard(r) {
  const u = +r.u || 42;
  const devices = getContents(r.id);
  const tag = getRackTag(r.id);
  const occupancy = Array.from({ length: u + 1 }, () => null);
  devices.forEach(d => {
    const top = +d.positionU || 1;
    const t = catalogType(d.typeId);
    const h = +d.heightU || (t && +t.heightU) || 1;
    for (let i = 0; i < h; i++) {
      const idx = top - i;
      if (idx >= 1 && idx <= u && !occupancy[idx]) {
        occupancy[idx] = { dev: d, isTop: i === 0 };
      }
    }
  });

  const units = [];
  for (let i = 1; i <= u; i++) {
    const cell = occupancy[i];
    if (cell && cell.isTop) {
      const d = cell.dev;
      const tc = catalogType(d.typeId);
      const h = +d.heightU || (tc && +tc.heightU) || 1;
      // занимаемый диапазон: от top (i) до bottom (i - h + 1)
      const bottom = i - h + 1;
      const uRange = h > 1 ? `${i}-${bottom}` : `${i}`;
      const hBadge = h > 1 ? `<span class="u-hbadge">${h}U</span>` : '';
      // multi-U: высота = h × unit-row-height + (h-1) × gap. Рассчитывается через CSS var.
      const style = h > 1 ? ` style="--u-span:${h}"` : '';
      const organizer = isOrganizer(d);
      if (organizer) {
        units.push(`<div class="sd-unit organizer${h>1?' multi':''}"${style} title="Кабельный органайзер — только трассировка, не endpoint">
          <span class="u-num">${uRange}</span>
          <span class="u-label">⇋ ${escapeHtml(d.label || d.typeId || 'Органайзер')}${hBadge}</span>
        </div>`);
      } else {
        const isStart = linkStart && linkStart.rackId === r.id && linkStart.devId === d.id;
        const ports = devicePorts(r.id, d.id);
        const used = ports ? portsUsedOn(r.id, d.id).size : 0;
        const portBadge = ports > 1
          ? `<span class="u-pbadge${used >= ports ? ' full' : used ? ' part' : ''}" title="${used} из ${ports} портов занято">${used}/${ports}</span>`
          : '';
        units.push(`<div class="sd-unit${h>1?' multi':''}${isStart ? ' sel' : ''}"${style} data-rack-id="${escapeAttr(r.id)}" data-dev-id="${escapeAttr(d.id)}" title="${escapeAttr(d.label || d.typeId || '')}">
          <span class="u-num">${uRange}</span>
          <span class="u-label">${escapeHtml(d.label || d.typeId || '—')}${hBadge}${portBadge}</span>
        </div>`);
      }
    } else if (!cell) {
      units.push(`<div class="sd-unit empty"><span class="u-num">${i}</span><span class="u-label">·</span></div>`);
    }
  }

  // v0.59.283: кнопка ✎ ведёт в Компоновщик шкафа (rack.html) с этим rackId.
  const editBtn = `<a class="sd-rack-edit" href="../scs-config/rack.html?rackId=${encodeURIComponent(r.id)}&from=scs-design" title="Редактировать стойку в Компоновщике (мастере)" onclick="event.stopPropagation()">✎</a>`;
  return `<div class="sd-rack-card" data-rack-card-id="${escapeAttr(r.id)}">
    <div class="sd-rack-head">
      <span style="display:flex;align-items:center;gap:4px;flex:1;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name || 'Без имени')}</span>${editBtn}</span>
      <span class="tag">${escapeHtml(tag || '—')}</span>
    </div>
    <div class="sd-units">${units.join('')}</div>
  </div>`;
}

function onUnitClick(el) {
  const rackId = el.dataset.rackId;
  const devId = el.dataset.devId;
  const label = el.querySelector('.u-label').textContent.trim();
  if (!linkStart) {
    linkStart = { rackId, devId, label };
    el.classList.add('sel');
    updateStatus(`Выбран источник: <b>${escapeHtml(label)}</b> (${escapeHtml(getRackShortLabel(rackId))}). Кликните на целевое устройство в другой стойке.`);
    return;
  }
  if (linkStart.rackId === rackId && linkStart.devId === devId) {
    // повторный клик по тому же — отмена
    linkStart = null;
    el.classList.remove('sel');
    updateStatus('');
    return;
  }
  if (linkStart.rackId === rackId) {
    updateStatus(`⚠ Связь внутри одного шкафа — настраивается в <a href="../scs-config/">Компоновщике шкафа</a>, не здесь.`);
    return;
  }
  // создать связь
  const links = getLinks();
  const pFrom = devicePorts(linkStart.rackId, linkStart.devId);
  const pTo   = devicePorts(rackId, devId);
  // Если оба устройства многопортовые — автоподбор первых свободных портов
  const usedFrom = portsUsedOn(linkStart.rackId, linkStart.devId);
  const usedTo   = portsUsedOn(rackId, devId);
  const firstFree = (max, used) => {
    for (let p = 1; p <= max; p++) if (!used.has(p)) return p;
    return null;
  };
  const fromPort = pFrom > 1 ? firstFree(pFrom, usedFrom) : null;
  const toPort   = pTo   > 1 ? firstFree(pTo,   usedTo)   : null;
  // v0.59.281: дефолт кабеля зависит от типа порта на концах.
  const fromDev = getContents(linkStart.rackId).find(x => x.id === linkStart.devId);
  const toDev   = getContents(rackId).find(x => x.id === devId);
  const pTypeA = inferPortType(fromDev), pTypeB = inferPortType(toDev);
  const fromT = fromDev ? catalogType(fromDev.typeId) : null;
  const toT   = toDev   ? catalogType(toDev.typeId)   : null;
  const sA = parseGbps(fromT?.portSpeed);
  const sB = parseGbps(toT?.portSpeed);
  const needG = Math.max(sA || 0, sB || 0);
  let defCable = 'cat6a';
  if (pTypeA === 'lc' || pTypeB === 'lc' || pTypeA === 'sfp' || pTypeB === 'sfp') {
    // оптика — выбираем по требуемой скорости
    defCable = needG > 100 ? 'os2' : needG > 40 ? 'om4' : needG > 10 ? 'om4' : 'om3';
  } else if (pTypeA === 'bnc' || pTypeB === 'bnc') defCable = 'coax';
  else if (pTypeA === 'power' || pTypeB === 'power') defCable = 'power-c13';
  else if (needG > 1) defCable = 'cat6a'; // 10G/25G → Cat.6A
  else defCable = 'cat6';
  const newLink = {
    id: newId(),
    fromRackId: linkStart.rackId, fromDevId: linkStart.devId, fromLabel: linkStart.label,
    toRackId: rackId, toDevId: devId, toLabel: label,
    fromPort, toPort,
    cableType: defCable,
    lengthM: null,
    note: '',
    createdAt: Date.now(),
  };
  links.push(newLink);
  setLinks(links);
  lastLink = { fromRackId: linkStart.rackId, fromDevId: linkStart.devId, toRackId: rackId, toDevId: devId };
  linkStart = null;
  const portInfo = (fromPort || toPort)
    ? ` (${fromPort ? 'A:p'+fromPort : 'A'} ↔ ${toPort ? 'B:p'+toPort : 'B'})`
    : '';
  const batchBtn = (pFrom > 1 && pTo > 1)
    ? ` <button id="sd-batch-btn" class="sd-btn-sel" style="margin-left:8px">+ ещё N связей подряд</button>`
    : '';
  updateStatus(`✔ Связь добавлена: <b>${escapeHtml(label)}</b>${portInfo}. Всего: ${links.length}.${batchBtn}`);
  document.getElementById('sd-batch-btn')?.addEventListener('click', promptBatchWire);
  // перерисовать стойки (чтобы снять подсветку) и список
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
}

function getRackShortLabel(rackId) {
  const r = rackById(rackId); if (!r) return rackId;
  const tag = getRackTag(rackId);
  return tag || r.name || rackId;
}

function updateStatus(html) {
  const el = document.getElementById('sd-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

/* ---------- Links list ---------- */
function renderLinksList() {
  const host = document.getElementById('sd-links-list');
  if (!host) return;
  const allLinks = getVisibleLinks();
  if (!allLinks.length) {
    host.innerHTML = `<div class="sd-empty-state">Пока нет ни одной действующей меж-шкафной связи. Кликните на устройство в одной стойке, затем на устройство в другой — появится связь.</div>`;
    renderBom();
    return;
  }
  // фильтр: поиск (шкаф/устройство/заметка) + тип кабеля + только без длины
  const q = (linksQuery || '').trim().toLowerCase();
  const ct = linksCableFilter || '';
  const missingOnly = !!linksMissingOnly;
  const linkMatches = l => {
    if (ct && (l.cableType || '') !== ct) return false;
    if (missingOnly && l.lengthM != null) return false;
    if (!q) return true;
    const hay = [
      getRackShortLabel(l.fromRackId), deviceLabel(l.fromRackId, l.fromDevId),
      getRackShortLabel(l.toRackId),   deviceLabel(l.toRackId,   l.toDevId),
      l.note || ''
    ].join(' ').toLowerCase();
    return hay.includes(q);
  };
  const links = allLinks.filter(linkMatches);
  const cableOpts = ['<option value="">все типы</option>'].concat(
    CABLE_TYPES.map(t => `<option value="${t.id}" ${ct === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`)
  ).join('');
  const opts = CABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  // сначала таблицу нарисуем, BOM — отдельной функцией
  host.innerHTML = `
    <div class="sd-picker-search">
      <input type="search" id="sd-links-q" placeholder="🔍 шкаф / устройство / заметка" value="${escapeHtml(linksQuery || '')}" autocomplete="off">
      <select id="sd-links-ct" title="Тип кабеля">${cableOpts}</select>
      <label class="muted" style="display:inline-flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="sd-links-missing" ${missingOnly ? 'checked' : ''}> только без длины</label>
      <span class="muted">${(q || ct || missingOnly) ? `${links.length}/${allLinks.length}` : `${allLinks.length} шт.`}</span>
      ${(q || ct || missingOnly) ? '<button type="button" class="sd-btn-sel" id="sd-links-clear">× сброс</button>' : ''}
    </div>
    <table class="sd-links-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Откуда (шкаф → устройство)</th>
          <th>Куда (шкаф → устройство)</th>
          <th>Кабель</th>
          <th>Длина, м</th>
          <th>Заметка</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${links.map((l, i) => {
          const fromMax = devicePorts(l.fromRackId, l.fromDevId);
          const toMax   = devicePorts(l.toRackId,   l.toDevId);
          const fromUsed = portsUsedOn(l.fromRackId, l.fromDevId, l.id);
          const toUsed   = portsUsedOn(l.toRackId,   l.toDevId,   l.id);
          const fromDup = l.fromPort && fromUsed.has(+l.fromPort);
          const toDup   = l.toPort   && toUsed.has(+l.toPort);
          const portInput = (who, max, dup, val) => max > 1
            ? `<input class="sd-port-in${dup ? ' sd-err' : ''}" data-act="${who}-port" type="number" min="1" max="${max}" value="${val == null ? '' : val}" placeholder="порт 1-${max}" style="width:78px;font-size:11px;margin-top:3px" title="Физический порт на устройстве (1…${max})${dup ? ' — конфликт: занят другой связью' : ''}">`
            : '';
          return `
          <tr data-id="${escapeAttr(l.id)}">
            <td>${i + 1}</td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.fromRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.fromRackId, l.fromDevId))}${l.fromPort ? ` · <b>p${l.fromPort}</b>` : ''}</div>
              ${portInput('from', fromMax, fromDup, l.fromPort)}
            </td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.toRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.toRackId, l.toDevId))}${l.toPort ? ` · <b>p${l.toPort}</b>` : ''}</div>
              ${portInput('to', toMax, toDup, l.toPort)}
            </td>
            <td>
              <select data-act="cable">${opts.replace(`value="${l.cableType}"`, `value="${l.cableType}" selected`)}</select>
              ${(() => {
                // v0.59.281: валидатор совместимости порт ↔ кабель.
                const c = linkCompat(l);
                if (c.ok) return '';
                return `<div class="sd-link-warn" style="margin-top:4px;font-size:11px;color:#b91c1c" title="${escapeAttr(c.reason)}">⚠ ${escapeHtml(c.reason)}</div>`;
              })()}
            </td>
            <td><input type="number" min="0" step="0.1" value="${l.lengthM == null ? '' : l.lengthM}" data-act="length" style="width:80px"></td>
            <td><input type="text" value="${escapeAttr(l.note || '')}" data-act="note" placeholder="—"></td>
            <td><button data-act="del" class="sd-btn-del" title="Удалить связь">✕</button></td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
    <div class="sd-links-footer muted">Показано: ${links.length} из ${allLinks.length}. Хранилище: <code>scs-design.links.v1</code>.</div>
  `;
  const qInput = document.getElementById('sd-links-q');
  if (qInput) qInput.addEventListener('input', e => {
    linksQuery = e.target.value;
    renderLinksList();
    const q2 = document.getElementById('sd-links-q');
    if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
  });
  document.getElementById('sd-links-ct')?.addEventListener('change', e => { linksCableFilter = e.target.value; renderLinksList(); });
  document.getElementById('sd-links-missing')?.addEventListener('change', e => { linksMissingOnly = e.target.checked; renderLinksList(); });
  document.getElementById('sd-links-clear')?.addEventListener('click', () => { linksQuery = ''; linksCableFilter = ''; linksMissingOnly = false; renderLinksList(); });
  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="cable"]').addEventListener('change', e => { updateLink(id, { cableType: e.target.value }); drawLinkOverlay(); });
    tr.querySelector('[data-act="length"]').addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { lengthM: v === '' ? null : +v });
    });
    tr.querySelector('[data-act="note"]').addEventListener('change', e => updateLink(id, { note: e.target.value }));
    tr.querySelector('[data-act="from-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { fromPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="to-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { toPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const cur = getLinks().filter(x => x.id !== id);
      setLinks(cur);
      renderLinksList();
      renderBom();
      renderLegend();
      // перерисовать подсветку linked в карточках
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
    });
  });
  renderBom();
}
/* ---------- BOM (cable journal) ---------- */
const BOM_RESERVE = 1.3; // коэфф. запаса длины

function renderBom() {
  const host = document.getElementById('sd-bom'); if (!host) return;
  const links = getVisibleLinks();
  if (!links.length) { host.innerHTML = `<div class="muted">Пока нет связей — BOM пуст.</div>`; return; }

  const byType = new Map();
  let totalLinesAll = 0, totalLenAll = 0, totalLenRawAll = 0, withoutLen = 0;
  for (const l of links) {
    totalLinesAll++;
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const row = byType.get(t);
    row.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) {
      row.lenRaw += +l.lengthM;
      totalLenRawAll += +l.lengthM;
    } else {
      row.withoutLen++;
      withoutLen++;
    }
  }
  const rows = [];
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  for (const [t, r] of byType.entries()) {
    const lenWithRes = r.lenRaw * BOM_RESERVE;
    totalLenAll += lenWithRes;
    rows.push(`<tr>
      <td>${escapeHtml(cableLabel(t))}</td>
      <td class="num">${r.lines}</td>
      <td class="num">${r.lenRaw ? r.lenRaw.toFixed(1) : '—'}</td>
      <td class="num">${r.lenRaw ? lenWithRes.toFixed(1) : '—'}</td>
      <td class="num">${r.withoutLen || ''}</td>
    </tr>`);
  }
  host.innerHTML = `
    <table class="sd-bom-table">
      <thead><tr>
        <th>Тип кабеля</th>
        <th class="num">Линий</th>
        <th class="num">Σ длин, м</th>
        <th class="num">С запасом ×${BOM_RESERVE}, м</th>
        <th class="num">Без длины</th>
      </tr></thead>
      <tbody>
        ${rows.join('')}
        <tr class="total">
          <td>Итого</td>
          <td class="num">${totalLinesAll}</td>
          <td class="num">${totalLenRawAll ? totalLenRawAll.toFixed(1) : '—'}</td>
          <td class="num">${totalLenAll ? totalLenAll.toFixed(1) : '—'}</td>
          <td class="num">${withoutLen || ''}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/* ---------- Tab «Стойки проекта» ---------- */
const KIND_ICON = {
  'switch':        { icon: '🔀', label: 'Свичи' },
  'patch-panel':   { icon: '🎛', label: 'Патч-панели' },
  'server':        { icon: '🖥', label: 'Серверы' },
  'storage':       { icon: '💾', label: 'СХД' },
  'kvm':           { icon: '⌨', label: 'KVM' },
  'monitor':       { icon: '📺', label: 'Мониторы' },
  'ups':           { icon: '🔋', label: 'ИБП-1U' },
  'cable-manager': { icon: '⇋',  label: 'Органайзеры' },
  'other':         { icon: '▫',  label: 'Другое' },
};

function rackStats(rack) {
  const u = +rack.u || 42;
  const devices = getContents(rack.id);
  let usedU = 0, powerW = 0;
  const byKind = {};
  for (const d of devices) {
    const t = catalogType(d.typeId);
    const h = +d.heightU || (t && +t.heightU) || 1;
    usedU += h;
    powerW += (+d.powerW) || (t && +t.powerW) || 0;
    const kind = (t && t.kind) || 'other';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  const links = getVisibleLinks().filter(l => l.fromRackId === rack.id || l.toRackId === rack.id);
  return { u, usedU, freeU: Math.max(0, u - usedU), powerW, devCount: devices.length, byKind, linkCount: links.length };
}

function renderRacksSummary() {
  const host = document.getElementById('sd-racks-summary');
  if (!host) return;
  // v0.59.281: сводка — только проектные стойки (inst-*). Глобальные шаблоны
  // корпусов здесь не показываем, это не «стойки в зале».
  const racks = getProjectInstances();
  if (!racks.length) {
    host.innerHTML = `<div class="sd-empty-state">
      В проекте ещё нет шкафов. Создайте их в
      <a href="../rack-config/">Конфигураторе шкафа — корпус</a> (шаблоны)
      и наполните в <a href="../scs-config/">Компоновщике шкафа</a>.
    </div>`;
    return;
  }
  const kinds = Object.keys(KIND_ICON);
  const selected = new Set(loadJson(LS_SELECTION, []));

  // Сначала стойки с тегом (реальные), затем без тега (черновики/шаблоны)
  const sorted = racks.slice().sort((a, b) => {
    const ta = (getRackTag(a.id) || '').trim();
    const tb = (getRackTag(b.id) || '').trim();
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return ta.localeCompare(tb) || (a.name || '').localeCompare(b.name || '');
  });
  const rows = sorted.map(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    const fillPct = Math.round((s.usedU / s.u) * 100);
    const fillCls = fillPct >= 90 ? ' over' : fillPct >= 70 ? ' hi' : '';
    const breakdown = kinds
      .filter(k => s.byKind[k])
      .map(k => `<span class="sd-kind-chip" title="${escapeAttr(KIND_ICON[k].label)}">${KIND_ICON[k].icon} ${s.byKind[k]}</span>`)
      .join('') || '<span class="muted">—</span>';
    const isSel = selected.has(r.id);
    const draft = !tag.trim();
    return `<tr data-id="${escapeAttr(r.id)}"${draft ? ' class="draft"' : ''} title="${draft ? 'Без тега — черновик/шаблон, не реальная стойка' : ''}">
      <td>${draft ? '<span class="sd-draft-badge" title="Нет тега">📐 черновик</span>' : `<code>${escapeHtml(tag)}</code>`}</td>
      <td>${escapeHtml(r.name || 'Без имени')}</td>
      <td class="num">${s.usedU}/${s.u}
        <div class="sd-bar"><div class="sd-bar-fill${fillCls}" style="width:${Math.min(100, fillPct)}%"></div></div>
      </td>
      <td class="num">${s.powerW ? (s.powerW / 1000).toFixed(2) + ' кВт' : '—'}</td>
      <td class="num">${s.devCount}</td>
      <td class="kinds">${breakdown}</td>
      <td class="num">${s.linkCount || '<span class="muted">—</span>'}</td>
      <td>
        <button type="button" class="sd-btn-sel ${isSel ? 'on' : ''}" data-act="toggle-sel">${isSel ? '✓ выбрана' : '+ в мастер'}</button>
        <a href="../scs-config/rack.html?rackId=${encodeURIComponent(r.id)}" class="sd-btn-sel" style="text-decoration:none;margin-left:4px">открыть</a>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = `<table class="sd-racks-table">
    <thead><tr>
      <th>Тег</th><th>Имя</th><th class="num">U</th><th class="num">Мощность</th>
      <th class="num">Устр.</th><th>Разбивка</th><th class="num">Связей</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="toggle-sel"]')?.addEventListener('click', () => {
      const sel = new Set(loadJson(LS_SELECTION, []));
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      saveJson(LS_SELECTION, Array.from(sel));
      renderRacksSummary();
      renderLinksTab(); // обновить чипы в мастере
    });
  });
}

function exportRacksCsv() {
  const racks = getProjectInstances();
  const rows = [['Тег', 'Имя', 'U занято', 'U всего', 'U свободно', 'Мощность, кВт', 'Устройств', 'Свичи', 'Патч-панели', 'Серверы', 'ИБП-1U', 'Органайзеры', 'Другое', 'Связей']];
  racks.forEach(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    rows.push([
      tag, r.name || '', s.usedU, s.u, s.freeU,
      s.powerW ? (s.powerW / 1000).toFixed(2) : '',
      s.devCount,
      s.byKind['switch'] || 0, s.byKind['patch-panel'] || 0, s.byKind['server'] || 0,
      s.byKind['ups'] || 0, s.byKind['cable-manager'] || 0, s.byKind['other'] || 0,
      s.linkCount,
    ]);
  });
  downloadCsv('scs-racks-' + dateStamp() + '.csv', rows);
}

/* ---------- Tab «План зала» ---------- */
const PLAN_DEFAULT = { step: 0.6, kRoute: 1.3, positions: {}, zoom: 1, trays: [] };
const TRAY_W_CELLS = 1; // ширина трассы (клеток поперёк оси)
const PLAN_CELL_PX = 24; // одна клетка = 24 px на экране
const PLAN_COLS = 40, PLAN_ROWS = 24;
const PLAN_ZOOM_MIN = 0.25, PLAN_ZOOM_MAX = 4;
let planZoom = 1;
let selectedTrayId = null;
const RACK_W_CELLS = 2; // legacy фолбэк, если нет физических размеров
const RACK_H_CELLS = 1;

// v0.59.303: извлечение физических размеров стойки (widthMm × depthMm).
// Источники в порядке приоритета: r.widthMm/r.depthMm → парсинг r.name
// (шаблон «600x1200x42U» или «800×1000»). Фолбэк 600×1000.
function getRackDimsMm(r) {
  let w = +r?.widthMm || 0;
  let d = +r?.depthMm || 0;
  if ((!w || !d) && r?.name) {
    const m = String(r.name).match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
    if (m) { w = w || +m[1]; d = d || +m[2]; }
  }
  return { widthMm: w || 600, depthMm: d || 1000 };
}

// Размер стойки в клетках плана с учётом поворота (0/90/180/270°).
// v0.59.313: возвращает ТОЧНЫЕ размеры стойки в клетках (float), без округления.
// Раньше делалось Math.round → стойка 800 мм при шаге 600 мм становилась 1
// клеткой (600 мм физически), после чего соседняя стойка вплотную оказывалась в
// 400 мм, а не 0 мм. Теперь wC/hC — float, рендер и коллизии — физически точные,
// а snap-к-узлу-сетки выполняется отдельно при drop/drag.
function rackSizeCells(r, plan, rot) {
  const { widthMm, depthMm } = getRackDimsMm(r);
  const step = (plan && +plan.step) || 0.6;
  let wC = Math.max(0.1, widthMm / 1000 / step);
  let hC = Math.max(0.1, depthMm / 1000 / step);
  if (rot === 90 || rot === 270) { const t = wC; wC = hC; hC = t; }
  return [wC, hC];
}

// v0.59.313: snap-позиции стойки.
// Порядок: (1) grid-snap к ближайшему целому узлу сетки; (2) если стена стойки
// в пределах толерантности от стены соседней стойки — пристыковываем стена-к-
// стене (соседний угол важнее узла сетки, т.к. 800 мм стойка ≠ целому числу
// клеток при шаге 600 мм). Возвращает [x, y] в клетках (float).
function snapRackPos(rawX, rawY, wF, hF, selfId, plan, racks) {
  const TOL = 0.5; // толерантность snap-к-соседу, в клетках
  let sx = Math.round(rawX);
  let sy = Math.round(rawY);
  for (const [oid, op] of Object.entries(plan.positions || {})) {
    if (oid === selfId) continue;
    const or = racks.find(rr => rr.id === oid);
    if (!or) continue;
    const orot = ((+op.rot) || 0) % 360;
    const [owF, ohF] = rackSizeCells(or, plan, orot);
    const oL = +op.x, oR = +op.x + owF;
    const oT = +op.y, oB = +op.y + ohF;
    // Горизонтальный snap: нужно пересечение по y
    const curT = rawY, curB = rawY + hF;
    const yOverlap = !(curB <= oT - 0.001 || curT >= oB + 0.001);
    if (yOverlap) {
      if (Math.abs(rawX - oR) < TOL) sx = oR;            // левая стена → правый край соседа
      else if (Math.abs((rawX + wF) - oL) < TOL) sx = oL - wF; // правая → левый край соседа
    }
    const curL = rawX, curR = rawX + wF;
    const xOverlap = !(curR <= oL - 0.001 || curL >= oR + 0.001);
    if (xOverlap) {
      if (Math.abs(rawY - oB) < TOL) sy = oB;
      else if (Math.abs((rawY + hF) - oT) < TOL) sy = oT - hF;
    }
  }
  sx = Math.max(0, Math.min(PLAN_COLS - wF, sx));
  sy = Math.max(0, Math.min(PLAN_ROWS - hF, sy));
  return [sx, sy];
}

function rackRot(plan, rackId) {
  const p = plan?.positions?.[rackId];
  return ((p && +p.rot) || 0) % 360;
}

// Центр стойки (в пикселях плана) с учётом её размеров и поворота.
function rackCenterPx(rackId, plan) {
  const pos = plan?.positions?.[rackId];
  if (!pos) return null;
  const r = getRacks().find(x => x.id === rackId);
  if (!r) return [(pos.x + RACK_W_CELLS/2) * PLAN_CELL_PX, (pos.y + RACK_H_CELLS/2) * PLAN_CELL_PX];
  const [wC, hC] = rackSizeCells(r, plan, pos.rot || 0);
  return [(pos.x + wC/2) * PLAN_CELL_PX, (pos.y + hC/2) * PLAN_CELL_PX];
}

function getPlan() {
  const p = loadJson(LS_PLAN, PLAN_DEFAULT);
  const out = {
    step: +p?.step || PLAN_DEFAULT.step,
    kRoute: +p?.kRoute || PLAN_DEFAULT.kRoute,
    positions: (p && p.positions && typeof p.positions === 'object') ? (() => {
      // v0.59.303: нормализация positions — поддержка поля rot (0/90/180/270).
      const out = {};
      for (const [id, pos] of Object.entries(p.positions)) {
        if (!pos || typeof pos !== 'object') continue;
        let rot = +pos.rot || 0;
        rot = ((rot % 360) + 360) % 360;
        if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) rot = 0;
        out[id] = { x: +pos.x || 0, y: +pos.y || 0, rot };
      }
      return out;
    })() : {},
    zoom: (p && +p.zoom > 0) ? Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, +p.zoom)) : 1,
    trays: Array.isArray(p?.trays) ? p.trays.map(t => ({
      id: String(t.id || ('tr-' + Math.random().toString(36).slice(2, 8))),
      x: Math.max(0, Math.min(PLAN_COLS - 1, +t.x || 0)),
      y: Math.max(0, Math.min(PLAN_ROWS - 1, +t.y || 0)),
      len: Math.max(2, Math.min(Math.max(PLAN_COLS, PLAN_ROWS), +t.len || 6)),
      orient: t.orient === 'v' ? 'v' : 'h',
      // Размеры поперечного сечения канала (мм). Дефолт — 100×50.
      widthMm: +t.widthMm > 0 ? +t.widthMm : 100,
      depthMm: +t.depthMm > 0 ? +t.depthMm : 50,
      // Макс. допустимое заполнение (%), 40 по умолчанию (IEC/РЭ).
      fillLimitPct: +t.fillLimitPct > 0 ? +t.fillLimitPct : 40,
    })) : [],
  };
  planZoom = out.zoom;
  return out;
}
// v0.59.319: undo/redo для plan. Перед каждым savePlan пушим текущее
// состояние в undoStack, redoStack сбрасывается (new branch). Стек ограничен
// 30 снапшотами. В memory, без persistence — переживает только сессию.
const UNDO_LIMIT = 30;
const undoStack = [];
const redoStack = [];
function savePlan(p) {
  try {
    const prev = loadJson(LS_PLAN, PLAN_DEFAULT);
    undoStack.push(JSON.stringify(prev));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  } catch (_) { /* не блокируем запись из-за ошибки undo */ }
  saveJson(LS_PLAN, p);
}
function undoPlan() {
  if (!undoStack.length) { updateStatus('⚠ Нет действий для отмены.'); return; }
  const cur = loadJson(LS_PLAN, PLAN_DEFAULT);
  redoStack.push(JSON.stringify(cur));
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  const prevJson = undoStack.pop();
  saveJson(LS_PLAN, JSON.parse(prevJson));
  planZoom = (+JSON.parse(prevJson).zoom) || 1;
  renderPlan();
  updateStatus(`↶ Отменено. В стеке осталось: ${undoStack.length}.`);
}
function redoPlan() {
  if (!redoStack.length) { updateStatus('⚠ Нет действий для повтора.'); return; }
  const cur = loadJson(LS_PLAN, PLAN_DEFAULT);
  undoStack.push(JSON.stringify(cur));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  const nextJson = redoStack.pop();
  saveJson(LS_PLAN, JSON.parse(nextJson));
  planZoom = (+JSON.parse(nextJson).zoom) || 1;
  renderPlan();
  updateStatus(`↷ Повторено. В redo-стеке осталось: ${redoStack.length}.`);
}
function applyPlanZoomStyle() {
  const canvas = document.getElementById('sd-plan-canvas');
  if (!canvas) return;
  // Используем CSS `zoom` вместо `transform: scale`, чтобы scrollbars во wrap
  // корректно расширялись по размеру отмасштабированного канваса.
  canvas.style.zoom = String(planZoom);
  const val = document.getElementById('sd-plan-zoom-val');
  if (val) val.textContent = Math.round(planZoom * 100) + '%';
}
function setPlanZoom(z, anchor) {
  const clamp = Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, z));
  const wrap = document.querySelector('.sd-plan-wrap');
  let anchorX, anchorY, prevSL, prevST;
  if (wrap && anchor) {
    prevSL = wrap.scrollLeft; prevST = wrap.scrollTop;
    const rect = wrap.getBoundingClientRect();
    anchorX = anchor.clientX - rect.left + prevSL;
    anchorY = anchor.clientY - rect.top + prevST;
  }
  const prev = planZoom;
  planZoom = clamp;
  const plan = getPlan();
  plan.zoom = clamp;
  savePlan(plan);
  applyPlanZoomStyle();
  renderPlanScaleBar(plan); // v0.59.315: синхронизация scale-bar при изменении zoom
  if (wrap && anchor && prev > 0) {
    const k = clamp / prev;
    wrap.scrollLeft = anchorX * k - (anchor.clientX - wrap.getBoundingClientRect().left);
    wrap.scrollTop  = anchorY * k - (anchor.clientY - wrap.getBoundingClientRect().top);
  }
}
function fitPlanZoom() {
  const wrap = document.querySelector('.sd-plan-wrap');
  if (!wrap) return;
  const pad = 16;
  const zx = (wrap.clientWidth  - pad) / (PLAN_COLS * PLAN_CELL_PX);
  const zy = (wrap.clientHeight - pad) / (PLAN_ROWS * PLAN_CELL_PX);
  setPlanZoom(Math.min(zx, zy));
}

// v0.59.317: Fit to content — зум и скролл до bbox размещённых стоек + каналов.
// Если на плане пусто — fallback к fitPlanZoom (весь план).
function fitPlanToContent() {
  const wrap = document.querySelector('.sd-plan-wrap');
  if (!wrap) return;
  const plan = getPlan();
  const racks = getRacks();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [rid, pos] of Object.entries(plan.positions || {})) {
    const r = racks.find(x => x.id === rid); if (!r) continue;
    const [wF, hF] = rackSizeCells(r, plan, ((+pos.rot) || 0) % 360);
    minX = Math.min(minX, +pos.x);
    minY = Math.min(minY, +pos.y);
    maxX = Math.max(maxX, +pos.x + wF);
    maxY = Math.max(maxY, +pos.y + hF);
  }
  (plan.trays || []).forEach(t => {
    const w = t.orient === 'h' ? t.len : 1;
    const h = t.orient === 'v' ? t.len : 1;
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + w);
    maxY = Math.max(maxY, t.y + h);
  });
  if (!isFinite(minX) || !isFinite(minY)) { fitPlanZoom(); return; }
  const pad = 1; // клеток отступ вокруг
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(PLAN_COLS, maxX + pad);
  maxY = Math.min(PLAN_ROWS, maxY + pad);
  const bw = (maxX - minX) * PLAN_CELL_PX;
  const bh = (maxY - minY) * PLAN_CELL_PX;
  const padPx = 24;
  const zx = (wrap.clientWidth  - padPx * 2) / bw;
  const zy = (wrap.clientHeight - padPx * 2) / bh;
  const z = Math.min(zx, zy, PLAN_ZOOM_MAX);
  setPlanZoom(Math.max(PLAN_ZOOM_MIN, z));
  // скролл к левому-верхнему углу bbox
  const rectW = wrap.clientWidth, rectH = wrap.clientHeight;
  const cx = (minX + maxX) / 2 * PLAN_CELL_PX * z;
  const cy = (minY + maxY) / 2 * PLAN_CELL_PX * z;
  wrap.scrollLeft = Math.max(0, cx - rectW / 2);
  wrap.scrollTop  = Math.max(0, cy - rectH / 2);
}

function manhattanCells(a, b) {
  // центр прямоугольника стойки
  const ax = a.x + RACK_W_CELLS / 2, ay = a.y + RACK_H_CELLS / 2;
  const bx = b.x + RACK_W_CELLS / 2, by = b.y + RACK_H_CELLS / 2;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function renderPlan() {
  const canvas = document.getElementById('sd-plan-canvas');
  const palette = document.getElementById('sd-plan-palette');
  const info = document.getElementById('sd-plan-info');
  const stepIn = document.getElementById('sd-plan-step');
  const krIn = document.getElementById('sd-plan-kroute');
  if (!canvas || !palette) return;

  const plan = getPlan();
  if (stepIn) stepIn.value = plan.step;
  if (krIn) krIn.value = plan.kRoute;

  // v0.59.281: на план-зал размещаем только экземпляры текущего проекта.
  // Глобальные шаблоны (tpl-*) — это дизайны корпусов, не реальные шкафы.
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  const unplaced = racks.filter(r => !plan.positions[r.id]);

  // Палитра
  palette.innerHTML = unplaced.length
    ? unplaced.map(r => `<span class="sd-plan-chip" draggable="true" data-id="${escapeAttr(r.id)}">${escapeHtml(getRackShortLabel(r.id))}</span>`).join('')
    : '<span class="muted">Все стойки размещены на плане.</span>';

  palette.querySelectorAll('.sd-plan-chip').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/sd-rack', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // Canvas
  canvas.style.width = (PLAN_COLS * PLAN_CELL_PX) + 'px';
  canvas.style.height = (PLAN_ROWS * PLAN_CELL_PX) + 'px';
  canvas.style.backgroundSize = `${PLAN_CELL_PX}px ${PLAN_CELL_PX}px`;
  canvas.innerHTML = '';

  // SVG слой для линий связей
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sd-plan-svg');
  svg.setAttribute('width', PLAN_COLS * PLAN_CELL_PX);
  svg.setAttribute('height', PLAN_ROWS * PLAN_CELL_PX);
  canvas.appendChild(svg);

  // Кабельные каналы (trays) — рисуем ДО стоек, чтобы стойки были сверху
  (plan.trays || []).forEach(t => renderTray(canvas, svg, t, plan));

  // Размещённые стойки
  placed.forEach(r => {
    const pos = plan.positions[r.id];
    const s = rackStats(r);
    const pct = s.u ? Math.round((s.usedU / s.u) * 100) : 0;
    let cls = '';
    if (pct >= 100) cls = ' over';
    else if (pct >= 90) cls = ' hi';
    else if (pct >= 70) cls = ' mid';
    else if (pct > 0) cls = ' low';
    else cls = ' empty';
    const tag = getRackTag(r.id);
    const isDraft = !tag.trim();
    const div = document.createElement('div');
    div.className = 'sd-plan-rack' + cls + (isDraft ? ' draft' : '');
    div.dataset.id = r.id;
    const rot = rackRot(plan, r.id);
    const [wC, hC] = rackSizeCells(r, plan, rot);
    const dims = getRackDimsMm(r);
    div.style.left = (pos.x * PLAN_CELL_PX) + 'px';
    div.style.top = (pos.y * PLAN_CELL_PX) + 'px';
    div.style.width = (wC * PLAN_CELL_PX) + 'px';
    div.style.height = (hC * PLAN_CELL_PX) + 'px';
    if (rot === 90 || rot === 270) div.classList.add('rot-tall');
    div.classList.add('rot-' + rot); // v0.59.314: индикатор передней стены
    // подробный тултип: + исходящие связи и метраж от этой стойки
    const rackLinks = getVisibleLinks().filter(l => l.fromRackId === r.id || l.toRackId === r.id);
    let fromM = 0;
    rackLinks.forEach(l => {
      const len = (l.lengthM != null) ? l.lengthM : computeSuggestedLength(l, plan);
      if (len != null) fromM += len * 1.3;
    });
    const byType = new Map();
    rackLinks.forEach(l => { byType.set(l.cableType || '—', (byType.get(l.cableType || '—') || 0) + 1); });
    const typesStr = Array.from(byType.entries()).map(([k, v]) => `${k}×${v}`).join(', ');
    div.title = `${tag || r.name || r.id}${isDraft ? ' [черновик]' : ''}
U: ${s.usedU}/${s.u} (${pct}%) · Устр.: ${s.devCount}
Связей: ${rackLinks.length}${typesStr ? ' (' + typesStr + ')' : ''}
Кабеля от стойки: ~${Math.round(fromM)} м (с запасом 1.3)`;
    div.innerHTML = `<span class="sd-plan-rack-label">${escapeHtml(tag || r.name || r.id)} <small class="sd-plan-rack-dim">${dims.widthMm}×${dims.depthMm}${rot?` · ${rot}°`:''}</small></span>
      <button type="button" class="sd-plan-rack-rot" title="Повернуть на 90°">⟳</button>
      <button type="button" class="sd-plan-rm" title="Убрать со схемы">✕</button>`;
    canvas.appendChild(div);

    // drag для перемещения
    let dragging = false, startX = 0, startY = 0, startCell = null;
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('sd-plan-rm')) return;
      if (e.target.classList.contains('sd-plan-rack-rot')) return;
      dragging = true;
      div.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      startCell = { x: pos.x, y: pos.y };
      div.classList.add('dragging');
    });
    div.addEventListener('pointermove', e => {
      if (!dragging) return;
      const z = planZoom || 1;
      // v0.59.313: raw-позиция в float-клетках + snap (grid + neighbor-edge)
      const rawX = startCell.x + (e.clientX - startX) / (PLAN_CELL_PX * z);
      const rawY = startCell.y + (e.clientY - startY) / (PLAN_CELL_PX * z);
      const [nx, ny] = snapRackPos(rawX, rawY, wC, hC, r.id, plan, getRacks());
      div.style.left = (nx * PLAN_CELL_PX) + 'px';
      div.style.top = (ny * PLAN_CELL_PX) + 'px';
      pos.x = nx; pos.y = ny;
      drawPlanLinks(svg, plan);
    });
    div.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      div.classList.remove('dragging');
      const p2 = getPlan();
      p2.positions[r.id] = { x: pos.x, y: pos.y };
      savePlan(p2);
      updatePlanInfo();
    });
    div.querySelector('.sd-plan-rm').addEventListener('click', (e) => {
      e.stopPropagation();
      const p2 = getPlan();
      delete p2.positions[r.id];
      savePlan(p2);
      if (focusRackId === r.id) focusRackId = null;
      renderPlan();
    });
    // v0.59.303: поворот стойки на 90°
    div.querySelector('.sd-plan-rack-rot').addEventListener('click', (e) => {
      e.stopPropagation();
      const p2 = getPlan();
      const cur = p2.positions[r.id] || { x: pos.x, y: pos.y, rot: 0 };
      const nextRot = (cur.rot + 90) % 360;
      // после поворота пересчитаем размеры, проверим границы
      const [nwC, nhC] = rackSizeCells(r, p2, nextRot);
      cur.rot = nextRot;
      cur.x = Math.max(0, Math.min(PLAN_COLS - nwC, cur.x));
      cur.y = Math.max(0, Math.min(PLAN_ROWS - nhC, cur.y));
      p2.positions[r.id] = cur;
      savePlan(p2);
      renderPlan();
    });
    // click (без drag) = фокус на трассы этой стойки
    let downAt = 0, downPt = null;
    div.addEventListener('pointerdown', e => { downAt = Date.now(); downPt = { x: e.clientX, y: e.clientY }; });
    div.addEventListener('click', e => {
      if (e.target.classList.contains('sd-plan-rm')) return;
      const dx = Math.abs(e.clientX - (downPt?.x || 0));
      const dy = Math.abs(e.clientY - (downPt?.y || 0));
      const dt = Date.now() - downAt;
      if (dx > 3 || dy > 3 || dt > 400) return; // это был drag, не клик
      focusRackId = (focusRackId === r.id) ? null : r.id;
      document.querySelectorAll('.sd-plan-rack').forEach(el => {
        el.classList.toggle('focused', el.dataset.id === focusRackId);
        el.classList.toggle('dimmed', focusRackId && el.dataset.id !== focusRackId);
      });
      drawPlanLinks(svg, getPlan());
    });
    if (focusRackId === r.id) div.classList.add('focused');
    else if (focusRackId) div.classList.add('dimmed');
  });

  // Drop target
  canvas.addEventListener('dragover', e => {
    if (Array.from(e.dataTransfer.types).includes('text/sd-rack')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  canvas.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/sd-rack');
    if (!id) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // CSS `zoom` увеличивает rect в N раз, компенсируем делением на planZoom.
    const z = planZoom || 1;
    // v0.59.313: drop с реальными размерами, grid+neighbor snap и avoid-overlap
    const p2 = getPlan();
    const racksNow = getRacks();
    const dropped = racksNow.find(r => r.id === id);
    const rot = rackRot(p2, id);
    const [wC, hC] = dropped ? rackSizeCells(dropped, p2, rot) : [2, 1];
    // raw float-позиция (курсор = угол), снап сначала к сетке, затем к соседу.
    const rawX = (e.clientX - rect.left) / (PLAN_CELL_PX * z);
    const rawY = (e.clientY - rect.top) / (PLAN_CELL_PX * z);
    let [x, y] = snapRackPos(rawX, rawY, wC, hC, id, p2, racksNow);
    // Проверка коллизий — если накрыли соседа, ищем свободную клетку по спирали.
    const collides = (cx, cy) => {
      for (const [otherId, op] of Object.entries(p2.positions || {})) {
        if (otherId === id) continue;
        const or = racksNow.find(r => r.id === otherId);
        if (!or) continue;
        const orot = ((+op.rot) || 0) % 360;
        const [owC, ohC] = rackSizeCells(or, p2, orot);
        const EPS = 0.01;
        if (cx + EPS < (+op.x) + owC && cx + wC - EPS > (+op.x) &&
            cy + EPS < (+op.y) + ohC && cy + hC - EPS > (+op.y)) return true;
      }
      return false;
    };
    if (collides(x, y)) {
      outer: for (let radius = 1; radius <= Math.max(PLAN_COLS, PLAN_ROWS); radius++) {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dy) !== radius && Math.abs(dx) !== radius) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx + wC > PLAN_COLS || ny + hC > PLAN_ROWS) continue;
          if (!collides(nx, ny)) { x = nx; y = ny; break outer; }
        }
      }
    }
    p2.positions[id] = { x, y, rot };
    savePlan(p2);
    renderPlan();
  });

  drawPlanLinks(svg, plan);
  updatePlanInfo();
  applyPlanZoomStyle();
  renderPlanScaleBar(plan);
}

// v0.59.315: Scale bar — небольшой индикатор масштаба в правом-нижнем углу
// plan-wrap: чёрная полоса 1 м (или 5 м, если шаг крупный) с подписью.
// Берётся физическая длина по plan.step и зуму.
function renderPlanScaleBar(plan) {
  const el = document.getElementById('sd-plan-scale');
  if (!el) return;
  const step = plan.step || 0.6; // м/клетка
  const zoom = planZoom || 1;
  const pxPerM = (PLAN_CELL_PX / step) * zoom;
  // Подберём «красивую» длину шкалы: 1 м, 2 м, 5 м, 10 м, 20 м…
  const targetPx = 110;
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  let chosen = candidates[0];
  for (const c of candidates) {
    if (c * pxPerM <= targetPx * 1.3) chosen = c;
    else break;
  }
  const widthPx = chosen * pxPerM;
  el.innerHTML = `<div class="sd-plan-scale-bar" style="width:${widthPx.toFixed(0)}px"></div>
    <div class="sd-plan-scale-label">${chosen} м · шаг ${step} м · zoom ${(zoom * 100).toFixed(0)}%</div>`;
}

let focusRackId = null;
let pickerQuery = '';
let linksQuery = '';
let linksCableFilter = '';
let linksMissingOnly = false;

// Ближайшая точка на отрезке tray к точке (px, py). Возвращает {qx, qy, d, tray}.
// tray = {x, y, len, orient} в КЛЕТКАХ; точки возвращаем в px (центр клетки).
function nearestOnTray(px, py, t) {
  const cx0 = (t.x + 0.5) * PLAN_CELL_PX;
  const cy0 = (t.y + 0.5) * PLAN_CELL_PX;
  let qx, qy;
  if (t.orient === 'h') {
    const x1 = cx0;
    const x2 = (t.x + t.len - 1 + 0.5) * PLAN_CELL_PX;
    qx = Math.max(x1, Math.min(x2, px));
    qy = cy0;
  } else {
    const y1 = cy0;
    const y2 = (t.y + t.len - 1 + 0.5) * PLAN_CELL_PX;
    qx = cx0;
    qy = Math.max(y1, Math.min(y2, py));
  }
  const d = Math.abs(px - qx) + Math.abs(py - qy);
  return { qx, qy, d, tray: t };
}

// v0.59.297: прилипание каналов друг к другу (T/крестовые стыки).
function snapTrayPosition(t, nx, ny, plan) {
  const SNAP = 1; // клеток
  const others = (plan.trays || []).filter(o => o.id !== t.id);
  let snapped = false;
  const isH = t.orient === 'h';
  const cx = nx + (isH ? t.len / 2 : TRAY_W_CELLS / 2);
  const cy = ny + (isH ? TRAY_W_CELLS / 2 : t.len / 2);
  for (const o of others) {
    const oH = o.orient === 'h';
    const oCx = o.x + (oH ? o.len / 2 : TRAY_W_CELLS / 2);
    const oCy = o.y + (oH ? TRAY_W_CELLS / 2 : o.len / 2);
    if (isH && !oH) {
      if (Math.abs(cy - oCy) <= SNAP &&
          oCx >= nx - SNAP && oCx <= nx + t.len + SNAP) {
        ny = Math.round(oCy - TRAY_W_CELLS / 2); snapped = true;
      }
      if (Math.abs(nx - oCx) <= SNAP) { nx = Math.round(oCx); snapped = true; }
      if (Math.abs((nx + t.len) - oCx) <= SNAP) { nx = Math.round(oCx - t.len); snapped = true; }
    } else if (!isH && oH) {
      if (Math.abs(cx - oCx) <= SNAP &&
          oCy >= ny - SNAP && oCy <= ny + t.len + SNAP) {
        nx = Math.round(oCx - TRAY_W_CELLS / 2); snapped = true;
      }
      if (Math.abs(ny - oCy) <= SNAP) { ny = Math.round(oCy); snapped = true; }
      if (Math.abs((ny + t.len) - oCy) <= SNAP) { ny = Math.round(oCy - t.len); snapped = true; }
    } else if (isH && oH) {
      if (Math.abs(ny - o.y) <= SNAP) { ny = o.y; snapped = true; }
      if (Math.abs(nx - (o.x + o.len)) <= SNAP) { nx = o.x + o.len; snapped = true; }
      if (Math.abs((nx + t.len) - o.x) <= SNAP) { nx = o.x - t.len; snapped = true; }
    } else {
      if (Math.abs(nx - o.x) <= SNAP) { nx = o.x; snapped = true; }
      if (Math.abs(ny - (o.y + o.len)) <= SNAP) { ny = o.y + o.len; snapped = true; }
      if (Math.abs((ny + t.len) - o.y) <= SNAP) { ny = o.y - t.len; snapped = true; }
    }
  }
  // v0.59.316: snap канала к стенам/углам стоек.
  // Если стена канала близко к стене стойки — прилипаем (угол стойки важнее
  // узла сетки, т.к. стойка 800мм ≠ кратна шагу сетки 600мм).
  const racksList = getRacks();
  for (const [rid, rp] of Object.entries(plan.positions || {})) {
    const rr = racksList.find(x => x.id === rid);
    if (!rr) continue;
    const rrot = ((+rp.rot) || 0) % 360;
    const [rwF, rhF] = rackSizeCells(rr, plan, rrot);
    const rL = +rp.x, rR = +rp.x + rwF;
    const rT = +rp.y, rB = +rp.y + rhF;
    if (isH) {
      // канал по y прилипает к верхней/нижней стене стойки
      if (Math.abs(ny - rB) <= SNAP) { ny = rB; snapped = true; }
      else if (Math.abs(ny + TRAY_W_CELLS - rT) <= SNAP) { ny = rT - TRAY_W_CELLS; snapped = true; }
      // по x — начало/конец канала к левому/правому углу стойки
      if (Math.abs(nx - rL) <= SNAP) { nx = rL; snapped = true; }
      else if (Math.abs(nx - rR) <= SNAP) { nx = rR; snapped = true; }
      if (Math.abs((nx + t.len) - rR) <= SNAP) { nx = rR - t.len; snapped = true; }
      else if (Math.abs((nx + t.len) - rL) <= SNAP) { nx = rL - t.len; snapped = true; }
    } else {
      if (Math.abs(nx - rR) <= SNAP) { nx = rR; snapped = true; }
      else if (Math.abs(nx + TRAY_W_CELLS - rL) <= SNAP) { nx = rL - TRAY_W_CELLS; snapped = true; }
      if (Math.abs(ny - rT) <= SNAP) { ny = rT; snapped = true; }
      else if (Math.abs(ny - rB) <= SNAP) { ny = rB; snapped = true; }
      if (Math.abs((ny + t.len) - rB) <= SNAP) { ny = rB - t.len; snapped = true; }
      else if (Math.abs((ny + t.len) - rT) <= SNAP) { ny = rT - t.len; snapped = true; }
    }
  }
  const wCells = isH ? t.len : TRAY_W_CELLS;
  const hCells = isH ? TRAY_W_CELLS : t.len;
  nx = Math.max(0, Math.min(PLAN_COLS - wCells, nx));
  ny = Math.max(0, Math.min(PLAN_ROWS - hCells, ny));
  return { x: nx, y: ny, snapped };
}

// Строит трассу A → ближайшая точка канала → вдоль канала → ближайшая к B → B.
// Если каналы у A и B совпадают → трасса через него; если нет — двойной канал;
// если каналов нет или они слишком далеко → прямая L-линия.
// Возвращает массив точек [[x,y], ...] и суммарную длину в клетках.
// Чистый Manhattan-сегмент от P→Q. Если (px,py) и (qx,qy) различаются по обеим
// осям — добавляется L-точка (qx,py) (или (px,qy)) так, чтобы все сегменты были
// строго горизонтальные или вертикальные.
function pushManhattan(pts, qx, qy, preferAxis /* 'h'|'v' */) {
  const last = pts[pts.length - 1];
  const [lx, ly] = last;
  if (lx === qx && ly === qy) return;
  if (lx === qx || ly === qy) { pts.push([qx, qy]); return; }
  // нужен L-угол
  if (preferAxis === 'v') pts.push([lx, qy]);
  else pts.push([qx, ly]);
  pts.push([qx, qy]);
}

// Строит трассу A → ближайшая точка канала → вдоль канала → ближайшая к B → B.
// v0.59.296: строгий Manhattan (без диагоналей) + принуждение канала, если он
// ближе, чем расстояние между самими стойками.
function buildCableRoute(ax, ay, bx, by, trays, fillsMap) {
  const direct = [[ax, ay]];
  pushManhattan(direct, bx, by, 'h'); // сначала горизонтально, потом вертикально
  const directCells = (Math.abs(ax - bx) + Math.abs(ay - by)) / PLAN_CELL_PX;
  if (!trays || !trays.length) return { pts: direct, cells: directCells, viaTray: false, trayIds: [] };

  // v0.59.297: вес = геом. дистанция × (1 + fill/100 × 1.5). Канал с заполнением
  // 90% смотрится как 2.35× дальше — система уйдёт на более свободный канал.
  // Если fillsMap не передан — обычная сортировка по расстоянию.
  const weighted = n => {
    if (!fillsMap) return n.d;
    const f = fillsMap.get(n.tray.id);
    if (!f) return n.d;
    const pct = Math.max(0, Math.min(150, f.pct || 0));
    return n.d * (1 + (pct / 100) * 1.5);
  };
  const nearA = trays.map(t => nearestOnTray(ax, ay, t)).sort((a, b) => weighted(a) - weighted(b));
  const nearB = trays.map(t => nearestOnTray(bx, by, t)).sort((a, b) => weighted(a) - weighted(b));
  const bestA = nearA[0];
  const bestB = nearB[0];
  if (!bestA || !bestB) return { pts: direct, cells: directCells, viaTray: false, trayIds: [] };

  // v0.59.298: если канал дальше, чем сами стойки друг от друга — идём
  // напрямую (мимо канала), потому что заход на канал увеличит трассу.
  // Если ближе — рассматриваем трассу через канал и сравниваем по длине.
  const interRack = Math.abs(ax - bx) + Math.abs(ay - by);
  if (bestA.d > interRack && bestB.d > interRack) {
    return { pts: direct, cells: directCells, viaTray: false, trayIds: [] };
  }

  // один канал для обоих концов
  if (bestA.tray === bestB.tray) {
    const pts = [[ax, ay]];
    const isH = bestA.tray.orient === 'h';
    // войти на канал перпендикулярно: сначала идём по оси канала-нормали
    if (isH) {
      pushManhattan(pts, bestA.qx, ay, 'h');
      pushManhattan(pts, bestA.qx, bestA.qy, 'v'); // встаём на ось канала
      pushManhattan(pts, bestB.qx, bestB.qy, 'h'); // идём вдоль канала
      pushManhattan(pts, bestB.qx, by, 'v');
    } else {
      pushManhattan(pts, ax, bestA.qy, 'v');
      pushManhattan(pts, bestA.qx, bestA.qy, 'h');
      pushManhattan(pts, bestB.qx, bestB.qy, 'v');
      pushManhattan(pts, bx, bestB.qy, 'h');
    }
    pushManhattan(pts, bx, by, isH ? 'h' : 'v');
    const cells = routeCells(pts);
    // v0.59.301: канал ближе interRack → идём через него без порога длины
    // (пользователь: «если канал дальше чем между стойками, идём напрямую»).
    return { pts, cells, viaTray: true, trayIds: [bestA.tray.id] };
  }

  // два разных канала → хоп между ними
  const pts = [[ax, ay]];
  const aH = bestA.tray.orient === 'h';
  const bH = bestB.tray.orient === 'h';
  // войти на bestA
  if (aH) { pushManhattan(pts, bestA.qx, ay, 'h'); pushManhattan(pts, bestA.qx, bestA.qy, 'v'); }
  else    { pushManhattan(pts, ax, bestA.qy, 'v'); pushManhattan(pts, bestA.qx, bestA.qy, 'h'); }
  // хоп — находим ближайшую точку на bestB.tray к текущей позиции на bestA
  const hop = nearestOnTray(bestA.qx, bestA.qy, bestB.tray);
  // переходим с bestA на hop: двигаемся вдоль bestA, потом L на bestB
  if (aH) pushManhattan(pts, hop.qx, bestA.qy, 'h');
  else    pushManhattan(pts, bestA.qx, hop.qy, 'v');
  pushManhattan(pts, hop.qx, hop.qy, aH ? 'v' : 'h');
  // идём вдоль bestB к bestB-точке
  pushManhattan(pts, bestB.qx, bestB.qy, bH ? 'h' : 'v');
  // выход с bestB к цели
  if (bH) { pushManhattan(pts, bestB.qx, by, 'v'); pushManhattan(pts, bx, by, 'h'); }
  else    { pushManhattan(pts, bx, bestB.qy, 'h'); pushManhattan(pts, bx, by, 'v'); }
  const cells = routeCells(pts);
  return { pts, cells, viaTray: true, trayIds: [bestA.tray.id, bestB.tray.id] };
}

// Вычисляет заполнение каждого канала: сумма площадей сечений проходящих
// через него кабелей / полезная площадь канала.
// Возвращает Map<trayId, { areaMm2, pct, cables: [{ linkId, type, diameterMm }] }>
function computeTrayFills(plan) {
  const fills = new Map();
  (plan.trays || []).forEach(t => {
    const crossMm2 = (t.widthMm || 100) * (t.depthMm || 50);
    fills.set(t.id, { tray: t, crossMm2, usedMm2: 0, pct: 0, cables: [] });
  });
  const links = getVisibleLinks();
  const trays = plan.trays || [];
  links.forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    // v0.59.303: центр стойки с учётом её физических размеров и поворота.
    const [ax, ay] = rackCenterPx(l.fromRackId, plan);
    const [bx, by] = rackCenterPx(l.toRackId, plan);
    const route = buildCableRoute(ax, ay, bx, by, trays);
    if (!route.viaTray) return;
    const d = CABLE_DIAMETER(l.cableType);
    const area = Math.PI * (d / 2) * (d / 2);
    route.trayIds.forEach(tid => {
      const f = fills.get(tid);
      if (!f) return;
      f.usedMm2 += area;
      f.cables.push({ linkId: l.id, type: l.cableType, diameterMm: d });
    });
  });
  fills.forEach(f => { f.pct = f.crossMm2 > 0 ? (f.usedMm2 / f.crossMm2) * 100 : 0; });
  return fills;
}

// v0.59.305: SVG-визуализация поперечного сечения канала.
// Прямоугольник widthMm×depthMm в масштабе + круги кабелей (greedy shelf packing,
// ряды слева-направо + wrap). Масштаб выбирается так, чтобы вся графика
// вписалась в ~220×90 px при любых размерах канала. Возвращает готовый
// <div class="sd-tray-cross"> с inline SVG и подписями.
function renderTrayCrossSection(t, fillInfo) {
  const wMm = Math.max(20, t.widthMm || 100);
  const hMm = Math.max(20, t.depthMm || 50);
  const cables = (fillInfo && Array.isArray(fillInfo.cables)) ? fillInfo.cables.slice() : [];
  const MAX_W = 220, MAX_H = 90;
  const scale = Math.min(MAX_W / wMm, MAX_H / hMm);
  const boxW = wMm * scale;
  const boxH = hMm * scale;
  const pad = 6;
  const svgW = boxW + pad * 2 + 42; // место под вертикальную подпись глубины справа
  const svgH = boxH + pad * 2 + 18; // место под подпись ширины снизу
  // Greedy shelf packing: сортируем по убыванию диаметра, укладываем слева→направо
  // в «полки» высотой = maxD текущей полки. Если не влезает в ширину — следующая полка.
  const sorted = cables.map(c => ({ ...c })).sort((a, b) => (b.diameterMm || 0) - (a.diameterMm || 0));
  const placed = [];
  let cx = 0, cy = 0, rowH = 0;
  sorted.forEach(c => {
    const d = Math.max(1, c.diameterMm || 0);
    if (cx + d > wMm) { cy += rowH; cx = 0; rowH = 0; }
    placed.push({ cx: cx + d / 2, cy: cy + d / 2, d, type: c.type });
    cx += d;
    if (d > rowH) rowH = d;
  });
  const circles = placed.map(p => {
    const px = pad + p.cx * scale;
    const py = pad + p.cy * scale;
    const pr = (p.d / 2) * scale;
    const col = CABLE_COLOR(p.type);
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${Math.max(1, pr).toFixed(1)}" fill="${col}" fill-opacity="0.6" stroke="${col}" stroke-width="0.7"/>`;
  }).join('');
  const overflow = cy + rowH > hMm;
  const boxStroke = overflow ? '#dc2626' : '#64748b';
  const widthLabel = `${wMm} мм`;
  const depthLabel = `${hMm} мм`;
  return `<div class="sd-tray-cross" title="Поперечное сечение канала ${wMm}×${hMm} мм, пакинг ${placed.length} кабелей${overflow ? ' — НЕ ВМЕЩАЕТСЯ' : ''}">
    <svg xmlns="http://www.w3.org/2000/svg" width="${svgW.toFixed(0)}" height="${svgH.toFixed(0)}" viewBox="0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}">
      <rect x="${pad}" y="${pad}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" fill="#f8fafc" stroke="${boxStroke}" stroke-width="1.2"/>
      ${circles}
      <text x="${(pad + boxW/2).toFixed(1)}" y="${(pad + boxH + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="#475569">${widthLabel}</text>
      <text x="${(pad + boxW + 6).toFixed(1)}" y="${(pad + boxH/2 + 3).toFixed(1)}" font-size="9" fill="#475569">${depthLabel}</text>
    </svg>
  </div>`;
}

function routeCells(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  }
  return len / PLAN_CELL_PX;
}

function ptsToPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
  return d;
}

function drawPlanLinks(svg, plan) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const links = getVisibleLinks();
  const trays = plan.trays || [];
  // v0.59.297: заполнение каналов считаем один раз — маршрут учитывает его веса.
  const fillsMap = trays.length ? computeTrayFills(plan) : null;
  links.forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    // v0.59.303: центр стойки с учётом её физических размеров и поворота.
    const [ax, ay] = rackCenterPx(l.fromRackId, plan);
    const [bx, by] = rackCenterPx(l.toRackId, plan);
    const route = buildCableRoute(ax, ay, bx, by, trays, fillsMap);
    const color = CABLE_COLOR(l.cableType);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ptsToPath(route.pts));
    path.setAttribute('stroke', color);
    const isFocused = focusRackId && (l.fromRackId === focusRackId || l.toRackId === focusRackId);
    const dimmed = focusRackId && !isFocused;
    path.setAttribute('stroke-width', isFocused ? '3.5' : '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', dimmed ? '0.15' : (isFocused ? '1' : '0.7'));
    if (route.viaTray) path.setAttribute('stroke-dasharray', '');
    svg.appendChild(path);
  });
}

function computeSuggestedLength(link, plan) {
  const a = plan.positions[link.fromRackId];
  const b = plan.positions[link.toRackId];
  if (!a || !b) return null;
  const [ax, ay] = rackCenterPx(link.fromRackId, plan);
  const [bx, by] = rackCenterPx(link.toRackId, plan);
  const route = buildCableRoute(ax, ay, bx, by, plan.trays || []);
  return route.cells * plan.step * plan.kRoute;
}

// Рендер кабельного канала (tray) на плане
function renderTray(canvas, svg, t, plan, fillInfo) {
  const div = document.createElement('div');
  div.className = 'sd-plan-tray' + (t.orient === 'v' ? ' v' : ' h');
  div.dataset.id = t.id;
  const w = (t.orient === 'h' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
  const h = (t.orient === 'v' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
  div.style.left = (t.x * PLAN_CELL_PX) + 'px';
  div.style.top = (t.y * PLAN_CELL_PX) + 'px';
  div.style.width = w + 'px';
  div.style.height = h + 'px';
  const pct = fillInfo ? Math.round(fillInfo.pct) : 0;
  const limit = t.fillLimitPct || 40;
  let fillClass = '';
  if (pct >= 100) fillClass = ' over';
  else if (pct >= limit) fillClass = ' hi';
  else if (pct >= limit * 0.7) fillClass = ' mid';
  else if (pct > 0) fillClass = ' low';
  div.className += fillClass;
  div.title = `Кабельный канал · ${t.orient === 'h' ? '↔' : '↕'} · ${t.len} кл ≈ ${(t.len * plan.step).toFixed(1)} м · ${t.widthMm}×${t.depthMm} мм\n` +
    `Заполнение: ${pct}% (${(fillInfo?.usedMm2 || 0).toFixed(0)} / ${(fillInfo?.crossMm2 || 0).toFixed(0)} мм², лимит ${limit}%)\n` +
    `Кабелей: ${fillInfo?.cables.length || 0}`;
  const isSelected = selectedTrayId === t.id;
  if (isSelected) div.classList.add('selected');
  // v0.59.301: редактор свойств канала (ширина/глубина/лимит заполнения)
  const propsHtml = isSelected ? `<div class="sd-tray-props">
    <label>Ширина</label><input type="number" min="20" step="10" value="${t.widthMm}" data-prop="widthMm"><span class="u">мм</span>
    <label>Глубина</label><input type="number" min="20" step="10" value="${t.depthMm}" data-prop="depthMm"><span class="u">мм</span>
    <label>Лимит</label><input type="number" min="10" max="100" step="5" value="${t.fillLimitPct || 40}" data-prop="fillLimitPct"><span class="u">%</span>
  </div>` : '';
  // v0.59.299: выделение → показать список кабелей в всплывающем pop-over
  let cablesHtml = '';
  if (isSelected && fillInfo && fillInfo.cables && fillInfo.cables.length) {
    const rackNameOf = id => {
      const r = getRacks().find(x => x.id === id);
      const tag = getRackTag(id);
      return tag || (r && r.name) || id;
    };
    const rows = fillInfo.cables.map(c => {
      const lk = (getLinks().find(x => x.id === c.linkId)) || {};
      const fromN = rackNameOf(lk.fromRackId);
      const toN = rackNameOf(lk.toRackId);
      const color = CABLE_COLOR(c.type);
      return `<div class="sd-tray-cable-row">
        <span class="sd-tray-cable-sw" style="background:${color}"></span>
        <span class="sd-tray-cable-type">${escapeHtml(c.type)}</span>
        <span class="sd-tray-cable-d">⌀${(c.diameterMm||0).toFixed(1)}мм</span>
        <span class="sd-tray-cable-ep">${escapeHtml(fromN)} → ${escapeHtml(toN)}</span>
      </div>`;
    }).join('');
    // v0.59.305: визуализация поперечного сечения канала — прямоугольник
    // widthMm×depthMm в масштабе + круги кабелей (greedy shelf packing).
    const crossSvg = renderTrayCrossSection(t, fillInfo);
    cablesHtml = `<div class="sd-tray-popover">
      ${propsHtml}
      <div class="sd-tray-popover-h">Кабелей: ${fillInfo.cables.length} · ${pct}% · лимит ${limit}%
        ${pct > limit ? `<button type="button" class="sd-tray-fit" title="Увеличить сечение канала до ${limit}% лимита">↗ Подогнать</button>` : ''}
      </div>
      ${crossSvg}
      ${rows}
    </div>`;
  } else if (isSelected) {
    cablesHtml = `<div class="sd-tray-popover">
      ${propsHtml}
      <div class="sd-tray-popover-h">В этом канале пока нет кабелей</div>
    </div>`;
  }
  div.innerHTML = `<span class="sd-plan-tray-label">⬚ L=${(t.len * plan.step).toFixed(1)}м · ${t.widthMm}×${t.depthMm} · <b class="sd-tray-fill-pct">${pct}%</b></span>
    <button type="button" class="sd-plan-tray-rot" title="Повернуть">⟳</button>
    <button type="button" class="sd-plan-tray-rm" title="Удалить">✕</button>
    <div class="sd-plan-tray-resize sd-plan-tray-resize-start" title="Растянуть/сократить (перетащите)"></div>
    <div class="sd-plan-tray-resize sd-plan-tray-resize-end" title="Растянуть/сократить (перетащите)"></div>
    ${cablesHtml}`;
  canvas.appendChild(div);

  // drag
  let dragging = false, sx = 0, sy = 0, sCell = null, movedPx = 0;
  div.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.target.classList && e.target.classList.contains('sd-plan-tray-resize')) return;
    dragging = true;
    movedPx = 0;
    div.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    sCell = { x: t.x, y: t.y };
    div.classList.add('dragging');
  });
  div.addEventListener('pointermove', e => {
    if (!dragging) return;
    const z = planZoom || 1;
    movedPx = Math.max(movedPx, Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy));
    const dx = Math.round((e.clientX - sx) / (PLAN_CELL_PX * z));
    const dy = Math.round((e.clientY - sy) / (PLAN_CELL_PX * z));
    const wCells = (t.orient === 'h' ? t.len : TRAY_W_CELLS);
    const hCells = (t.orient === 'v' ? t.len : TRAY_W_CELLS);
    let nx = Math.max(0, Math.min(PLAN_COLS - wCells, sCell.x + dx));
    let ny = Math.max(0, Math.min(PLAN_ROWS - hCells, sCell.y + dy));
    // v0.59.297: snap к соседним каналам (T/крестовые стыки).
    const snapped = snapTrayPosition(t, nx, ny, plan);
    nx = snapped.x; ny = snapped.y;
    div.classList.toggle('snapped', snapped.snapped);
    div.style.left = (nx * PLAN_CELL_PX) + 'px';
    div.style.top = (ny * PLAN_CELL_PX) + 'px';
    t.x = nx; t.y = ny;
    drawPlanLinks(svg, plan);
  });
  div.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    div.classList.remove('dragging');
    // Клик без реального перемещения → выделить/снять выделение + показать кабели
    if (movedPx < 5) {
      selectedTrayId = (selectedTrayId === t.id) ? null : t.id;
      renderPlan();
      return;
    }
    const p2 = getPlan();
    const target = (p2.trays || []).find(x => x.id === t.id);
    if (target) { target.x = t.x; target.y = t.y; savePlan(p2); }
    updatePlanInfo();
  });

  div.querySelector('.sd-plan-tray-rm').addEventListener('click', e => {
    e.stopPropagation();
    const p2 = getPlan();
    p2.trays = (p2.trays || []).filter(x => x.id !== t.id);
    savePlan(p2); renderPlan();
  });
  div.querySelector('.sd-plan-tray-rot').addEventListener('click', e => {
    e.stopPropagation();
    const p2 = getPlan();
    const target = (p2.trays || []).find(x => x.id === t.id);
    if (!target) return;
    target.orient = target.orient === 'h' ? 'v' : 'h';
    const w = target.orient === 'h' ? target.len : TRAY_W_CELLS;
    const h = target.orient === 'v' ? target.len : TRAY_W_CELLS;
    target.x = Math.max(0, Math.min(PLAN_COLS - w, target.x));
    target.y = Math.max(0, Math.min(PLAN_ROWS - h, target.y));
    savePlan(p2); renderPlan();
  });

  // Ручное растягивание за края канала
  const wireResize = (handle, isEnd) => {
    if (!handle) return;
    let drag = null;
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      drag = { sx: e.clientX, sy: e.clientY, sLen: t.len, sX: t.x, sY: t.y };
    });
    handle.addEventListener('pointermove', e => {
      if (!drag) return;
      const z = planZoom || 1;
      const dx = Math.round((e.clientX - drag.sx) / (PLAN_CELL_PX * z));
      const dy = Math.round((e.clientY - drag.sy) / (PLAN_CELL_PX * z));
      const along = (t.orient === 'h') ? dx : dy;
      if (isEnd) {
        // тянем конец → меняется только len
        const maxLen = (t.orient === 'h') ? (PLAN_COLS - drag.sX) : (PLAN_ROWS - drag.sY);
        t.len = Math.max(2, Math.min(maxLen, drag.sLen + along));
      } else {
        // тянем начало → сдвигаем x/y и уменьшаем/увеличиваем len
        const newLen = Math.max(2, drag.sLen - along);
        const delta = drag.sLen - newLen;
        if (t.orient === 'h') t.x = Math.max(0, drag.sX + delta);
        else t.y = Math.max(0, drag.sY + delta);
        t.len = newLen;
      }
      const wPx = (t.orient === 'h' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
      const hPx = (t.orient === 'v' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
      div.style.left = (t.x * PLAN_CELL_PX) + 'px';
      div.style.top = (t.y * PLAN_CELL_PX) + 'px';
      div.style.width = wPx + 'px';
      div.style.height = hPx + 'px';
      drawPlanLinks(svg, plan);
    });
    handle.addEventListener('pointerup', e => {
      if (!drag) return;
      drag = null;
      handle.releasePointerCapture(e.pointerId);
      const p2 = getPlan();
      const target = (p2.trays || []).find(x => x.id === t.id);
      if (target) { target.x = t.x; target.y = t.y; target.len = t.len; savePlan(p2); }
      renderPlan();
    });
  };
  wireResize(div.querySelector('.sd-plan-tray-resize-start'), false);
  wireResize(div.querySelector('.sd-plan-tray-resize-end'), true);

  // v0.59.301: pop-over — не начинать drag/select по клику внутри него
  const pop = div.querySelector('.sd-tray-popover');
  if (pop) {
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    pop.addEventListener('click', e => e.stopPropagation());
    // v0.59.307: кнопка «↗ Подогнать» — увеличивает widthMm (при необходимости
    // и depthMm) до тех пор, пока pct ≤ fillLimitPct, округляя до 10 мм вверх.
    const fitBtn = pop.querySelector('.sd-tray-fit');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        const p2 = getPlan();
        const target = (p2.trays || []).find(x => x.id === t.id);
        if (!target) return;
        const usedMm2 = (fillInfo?.usedMm2) || 0;
        const limit = (target.fillLimitPct || 40) / 100;
        if (limit <= 0 || usedMm2 <= 0) return;
        const neededCross = usedMm2 / limit;
        // сохраняем соотношение сторон, округляем ширину вверх до 50 мм
        const ratio = (target.widthMm || 100) / Math.max(1, target.depthMm || 50);
        let newW = Math.sqrt(neededCross * ratio);
        newW = Math.ceil(newW / 50) * 50;
        let newD = Math.ceil((neededCross / newW) / 10) * 10;
        target.widthMm = Math.max(target.widthMm || 100, newW);
        target.depthMm = Math.max(target.depthMm || 50, newD);
        savePlan(p2); renderPlan();
      });
    }
    pop.querySelectorAll('input[data-prop]').forEach(inp => {
      inp.addEventListener('change', () => {
        const p2 = getPlan();
        const target = (p2.trays || []).find(x => x.id === t.id);
        if (!target) return;
        const prop = inp.dataset.prop;
        const v = +inp.value || 0;
        if (prop === 'widthMm') target.widthMm = Math.max(20, v);
        else if (prop === 'depthMm') target.depthMm = Math.max(20, v);
        else if (prop === 'fillLimitPct') target.fillLimitPct = Math.max(10, Math.min(100, v));
        savePlan(p2); renderPlan();
      });
    });
  }
}

function addTray(orient) {
  const p2 = getPlan();
  if (!Array.isArray(p2.trays)) p2.trays = [];
  const id = 'tr-' + Math.random().toString(36).slice(2, 8);
  const len = 6;
  // спавним в центре и двигаем левее/выше, если не влезает
  let x = Math.max(0, Math.floor((PLAN_COLS - (orient === 'h' ? len : 1)) / 2));
  let y = Math.max(0, Math.floor((PLAN_ROWS - (orient === 'v' ? len : 1)) / 2));
  p2.trays.push({ id, x, y, len, orient });
  savePlan(p2); renderPlan();
}

function updatePlanInfo() {
  const info = document.getElementById('sd-plan-info');
  if (!info) return;
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]).length;
  const links = getVisibleLinks();
  const total = links.length;
  const withPos = links.filter(l => plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  const missing = links.filter(l => (l.lengthM == null) && plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  // суммарная длина с коэф. по типам (берём реальные lengthM, а где нет — suggested)
  const byType = new Map();
  let totalM = 0;
  links.forEach(l => {
    const len = (l.lengthM != null) ? l.lengthM : computeSuggestedLength(l, plan);
    if (len == null) return;
    const v = len * 1.3; // запас на спуск/подъём как в BOM
    const k = l.cableType || '—';
    byType.set(k, (byType.get(k) || 0) + v);
    totalM += v;
  });
  const typeStr = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${Math.round(v)}м`)
    .join(' · ');
  // v0.59.308: сводка по каналам — среднее заполнение + переполненные
  const trays = plan.trays || [];
  let trayStr = '';
  if (trays.length) {
    const fills = computeTrayFills(plan);
    let sum = 0, n = 0, over = 0;
    trays.forEach(t => {
      const f = fills.get(t.id);
      if (!f) return;
      sum += f.pct; n++;
      if (f.pct > (t.fillLimitPct || 40)) over++;
    });
    const avg = n ? Math.round(sum / n) : 0;
    trayStr = ` · каналов: <b>${trays.length}</b> (${avg}% avg${over ? `, <span style="color:#dc2626">⚠ ${over} перегруж.</span>` : ''})`;
  }
  info.innerHTML = `стоек: <b>${placed}</b>/${racks.length} · связей: <b>${withPos}</b>/${total} · без длины: <b>${missing}</b> · Σ с запасом: <b>${Math.round(totalM)}м</b>${typeStr ? ' (' + typeStr + ')' : ''}${trayStr}`;
}

function applySuggestedLengths() {
  const plan = getPlan();
  const links = getLinks();
  let n = 0;
  links.forEach(l => {
    if (l.lengthM != null) return;
    const len = computeSuggestedLength(l, plan);
    if (len != null) { l.lengthM = Math.round(len * 10) / 10; n++; }
  });
  setLinks(links);
  updateStatus(`✔ Заполнено длин: ${n}. Масштаб ${plan.step} м/клетка × коэф. ${plan.kRoute}.`);
  renderLinksList();
  updatePlanInfo();
  drawLinkOverlay();
}

function resetPlan() {
  savePlan({ ...getPlan(), positions: {} });
  renderPlan();
}

function exportPlanSvg() {
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  if (!placed.length) { updateStatus('⚠ План пуст — нечего экспортировать. Используйте «⊞ Автораскладка» или перетащите стойки.'); return; }

  const W = PLAN_COLS * PLAN_CELL_PX;
  const H = PLAN_ROWS * PLAN_CELL_PX;
  const rackFill = pct => {
    if (pct === 0) return '#94a3b8';
    if (pct < 70)  return '#10b981';
    if (pct < 90)  return '#0891b2';
    if (pct < 100) return '#f59e0b';
    return '#dc2626';
  };

  // Заголовок/рамка
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W + 40}" height="${H + 80}" viewBox="0 0 ${W + 40} ${H + 80}" font-family="-apple-system,Segoe UI,Arial,sans-serif">`);
  lines.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  lines.push(`<text x="20" y="26" font-size="16" font-weight="600" fill="#1f2937">План зала СКС · ${new Date().toLocaleDateString('ru')} · шаг ${plan.step} м × коэф.${plan.kRoute}</text>`);

  // Сетка
  const gx = 20, gy = 46;
  lines.push(`<g transform="translate(${gx},${gy})">`);
  lines.push(`<rect width="${W}" height="${H}" fill="#fafafa" stroke="#d4d8e0"/>`);
  const gridParts = [];
  for (let c = 1; c < PLAN_COLS; c++) gridParts.push(`<line x1="${c*PLAN_CELL_PX}" y1="0" x2="${c*PLAN_CELL_PX}" y2="${H}" stroke="#e5e7eb" stroke-width="0.5"/>`);
  for (let r = 1; r < PLAN_ROWS; r++) gridParts.push(`<line x1="0" y1="${r*PLAN_CELL_PX}" x2="${W}" y2="${r*PLAN_CELL_PX}" stroke="#e5e7eb" stroke-width="0.5"/>`);
  lines.push(gridParts.join(''));

  // v0.59.304: Каналы (trays) — рисуем ДО кабелей, чтобы кабели визуально шли
  // поверх. Цвет заливки — по заполнению (green/cyan/amber/red).
  const trayFillsMap = computeTrayFills(plan);
  const trayColor = pct => {
    if (pct < 30) return '#10b981';
    if (pct < 60) return '#0891b2';
    if (pct < 90) return '#f59e0b';
    return '#dc2626';
  };
  (plan.trays || []).forEach(t => {
    const fi = trayFillsMap.get(t.id) || { pct: 0 };
    const isH = t.orient !== 'v';
    const x = t.x * PLAN_CELL_PX;
    const y = t.y * PLAN_CELL_PX;
    const w = isH ? t.len * PLAN_CELL_PX : PLAN_CELL_PX;
    const h = isH ? PLAN_CELL_PX : t.len * PLAN_CELL_PX;
    const col = trayColor(fi.pct);
    lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" opacity="0.18" stroke="${col}" stroke-width="1" stroke-dasharray="3 2" rx="1"/>`);
    const lenM = (t.len * plan.step).toFixed(1);
    const lbl = `⬚ L=${lenM}м · ${t.widthMm}×${t.depthMm} · ${Math.round(fi.pct)}%`;
    const lx = x + w / 2, ly = y + h / 2;
    lines.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="9" fill="#475569">${escapeSvg(lbl)}</text>`);
  });

  // Кабели (Manhattan через каналы) + подписи длин — только действующие
  getVisibleLinks().forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    // v0.59.303: центр стойки с учётом её физических размеров и поворота.
    const [ax, ay] = rackCenterPx(l.fromRackId, plan);
    const [bx, by] = rackCenterPx(l.toRackId, plan);
    const color = CABLE_COLOR(l.cableType);
    // v0.59.304: используем ту же Manhattan-трассу через каналы, что и на экране.
    const route = buildCableRoute(ax, ay, bx, by, plan.trays || [], trayFillsMap);
    const pts = route.pts || [[ax, ay], [bx, by]];
    const d = pts.map((p, i) => (i ? 'L ' : 'M ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    lines.push(`<path d="${d}" stroke="${color}" stroke-width="2" fill="none" opacity="0.8"/>`);
    const lenM = ((route.cells || 0) * plan.step * plan.kRoute).toFixed(1);
    const mid = pts[Math.floor(pts.length / 2)];
    const lx = mid[0], ly = mid[1];
    lines.push(`<rect x="${lx - 18}" y="${ly - 7}" width="36" height="14" rx="2" fill="#ffffff" stroke="${color}" stroke-width="0.5" opacity="0.92"/>`);
    lines.push(`<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="9" fill="#1f2937">${lenM} м</text>`);
  });

  // Стойки
  placed.forEach(r => {
    const pos = plan.positions[r.id];
    const s = rackStats(r);
    const pct = s.u ? Math.round((s.usedU / s.u) * 100) : 0;
    const fill = rackFill(pct);
    const tag = getRackTag(r.id);
    const isDraft = !tag.trim();
    // v0.59.304: физические размеры + поворот.
    const rot = rackRot(plan, r.id);
    const [wC, hC] = rackSizeCells(r, plan, rot);
    const x = pos.x * PLAN_CELL_PX;
    const y = pos.y * PLAN_CELL_PX;
    const w = wC * PLAN_CELL_PX;
    const h = hC * PLAN_CELL_PX;
    const textFill = pct >= 70 && pct < 90 ? '#1f2937' : '#ffffff';
    const strokeAttr = isDraft ? ' stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3 2"' : '';
    const opacityAttr = isDraft ? ' opacity="0.75"' : '';
    lines.push(`<g${opacityAttr}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"${strokeAttr}/><text x="${x + w/2}" y="${y + h/2 + 3}" text-anchor="middle" font-size="9" font-weight="600" fill="${textFill}">${escapeSvg(tag || r.name || r.id)}</text></g>`);
  });

  lines.push(`</g>`);

  // Легенда
  const ly = gy + H + 10;
  const legendItems = [
    { color: '#94a3b8', label: 'пусто' },
    { color: '#10b981', label: '<70%' },
    { color: '#0891b2', label: '70-89%' },
    { color: '#f59e0b', label: '90-99%' },
    { color: '#dc2626', label: '≥100%' },
  ];
  let lx = gx;
  legendItems.forEach(it => {
    lines.push(`<rect x="${lx}" y="${ly}" width="18" height="10" fill="${it.color}" rx="1"/>`);
    lines.push(`<text x="${lx + 22}" y="${ly + 9}" font-size="11" fill="#475569">${escapeSvg(it.label)}</text>`);
    lx += 22 + (it.label.length * 6) + 14;
  });

  lines.push(`</svg>`);
  const svg = lines.join('\n');
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scs-plan-${dateStamp()}.svg`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  updateStatus(`✔ План экспортирован: ${placed.length} стоек, ${getVisibleLinks().length} связей.`);
  return { svg, W: W + 40, H: H + 80, racks: placed.length, links: getVisibleLinks().length };
}

// v0.59.320: PNG-экспорт через растеризацию SVG в <canvas>.
// Переиспользует тот же SVG-билдер (exportPlanSvg с перехватом download).
function exportPlanPng() {
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  if (!placed.length) { updateStatus('⚠ План пуст — нечего экспортировать.'); return; }
  // Перехватываем download: временно подменяем HTMLAnchorElement.click,
  // перехватываем URL созданный через URL.createObjectURL, читаем blob как SVG,
  // рендерим в canvas и экспортируем PNG.
  const origCreate = URL.createObjectURL;
  let svgBlob = null;
  URL.createObjectURL = (b) => { svgBlob = b; return 'javascript:void(0)'; };
  const origAppendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = (el) => { if (el.tagName !== 'A') origAppendChild(el); return el; };
  try { exportPlanSvg(); } finally {
    URL.createObjectURL = origCreate;
    document.body.appendChild = origAppendChild;
  }
  if (!svgBlob) { updateStatus('⚠ PNG: не удалось сгенерировать SVG.'); return; }
  const scale = 2; // ретина-масштаб для чёткости
  svgBlob.text().then(svgText => {
    const img = new Image();
    const blobUrl = origCreate(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { updateStatus('⚠ PNG: canvas.toBlob вернул пусто.'); return; }
        const url = origCreate(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `scs-plan-${dateStamp()}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); URL.revokeObjectURL(blobUrl); }, 0);
        updateStatus(`✔ PNG экспортирован (${canvas.width}×${canvas.height}).`);
      }, 'image/png');
    };
    img.onerror = () => { updateStatus('⚠ PNG: <img> не смог загрузить SVG.'); URL.revokeObjectURL(blobUrl); };
    img.src = blobUrl;
  });
}

function escapeSvg(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Автораскладка: реальные стойки с тегом группируются по «ряду» — префиксу
   до первой точки (например, DH1.SR1/DH1.SR2 → ряд DH1). Каждый ряд —
   отдельная строка плана, стойки вдоль неё. Черновики (без тега) — в отдельный
   последний ряд. Ряды разделены 2 клетками аисла. */
function autoLayout() {
  const racks = getRacks();
  if (!racks.length) return;
  const plan = getPlan();
  const tags = {};
  racks.forEach(r => { tags[r.id] = (getRackTag(r.id) || '').trim(); });

  const rows = new Map(); // rowKey -> [rackIds]
  racks.forEach(r => {
    const tag = tags[r.id];
    let key;
    if (!tag) key = '__draft__';
    else {
      const dot = tag.indexOf('.');
      key = dot > 0 ? tag.slice(0, dot) : tag;
    }
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(r);
  });

  // В рамках ряда сортируем по тегу (SR1 перед SR2…)
  for (const arr of rows.values()) {
    arr.sort((a, b) => (tags[a.id] || '').localeCompare(tags[b.id] || '', 'ru', { numeric: true }));
  }

  const positions = {};
  const rowKeys = Array.from(rows.keys()).sort((a, b) => {
    if (a === '__draft__') return 1;
    if (b === '__draft__') return -1;
    return a.localeCompare(b, 'ru', { numeric: true });
  });
  const rowGap = 2;  // клетки между рядами (hot/cold aisle approximation)
  const colGap = 0;  // соседние стойки впритык
  // v0.59.311: autoLayout учитывает физические размеры стойки + поворот.
  // Высота ряда = max(h_i) из всех стоек ряда, ширина i-й стойки = её wC.
  let curRow = 1;
  rowKeys.forEach(key => {
    const arr = rows.get(key);
    let col = 1;
    let rowMaxH = 1;
    arr.forEach(r => {
      const rot = rackRot(plan, r.id);
      const [wC, hC] = rackSizeCells(r, plan, rot);
      if (col + wC > PLAN_COLS) {
        col = 1;
        curRow += rowMaxH + rowGap;
        rowMaxH = 1;
      }
      positions[r.id] = { x: col, y: curRow, rot };
      col += wC + colGap;
      if (hC > rowMaxH) rowMaxH = hC;
    });
    curRow += rowMaxH + rowGap;
  });

  savePlan({ ...plan, positions });
  renderPlan();
  updateStatus(`✔ Автораскладка: ${Object.keys(positions).length} стоек размещено в ${rowKeys.length} рядов.`);
}

/* v0.59.306: автогенерация каналов.
   Стратегия: группируем стойки по y-координате (ряды), для каждого ряда строим
   горизонтальный канал прямо над рядом (y = rowY - 1) длиной от самой левой до
   самой правой стойки + 1 клетка с каждого края. Затем — один вертикальный
   спинальный канал в самой левой доступной колонке, соединяющий все ряды.
   Старые trays c id начинающимся на `auto-` заменяются; пользовательские
   (добавленные вручную) сохраняются. */
function autoGenerateTrays() {
  const plan = getPlan();
  const positions = plan.positions || {};
  const entries = Object.entries(positions);
  if (!entries.length) { updateStatus('⚠ На плане нет стоек — автогенерация каналов невозможна.'); return; }
  // группировка по y-координате
  const racksList = getRacks();
  const byId = new Map(racksList.map(r => [r.id, r]));
  const rows = new Map();
  entries.forEach(([id, p]) => {
    const y = p.y | 0;
    if (!rows.has(y)) rows.set(y, []);
    const r = byId.get(id);
    const rot = ((+p.rot) || 0) % 360;
    const [wC] = r ? rackSizeCells(r, plan, rot) : [1, 1];
    rows.get(y).push({ id, x: p.x | 0, w: wC });
  });
  const newTrays = [];
  const sortedRowsY = Array.from(rows.keys()).sort((a, b) => a - b);
  let minLeft = Infinity, maxRight = -Infinity;
  sortedRowsY.forEach(y => {
    const row = rows.get(y);
    const left = Math.min(...row.map(r => r.x));
    const right = Math.max(...row.map(r => r.x + r.w)); // правый край последней стойки
    const lenCells = Math.max(2, right - left + 2); // +1 клетка по краям
    const trayY = Math.max(0, y - 1); // над рядом
    newTrays.push({
      id: 'auto-h-' + y,
      orient: 'h',
      x: Math.max(0, left - 1),
      y: trayY,
      len: Math.min(lenCells, PLAN_COLS - Math.max(0, left - 1)),
      widthMm: 200, depthMm: 100, fillLimitPct: 40,
    });
    if (left < minLeft) minLeft = left;
    if (right > maxRight) maxRight = right;
  });
  // вертикальный спинальный канал слева
  if (sortedRowsY.length >= 2) {
    const topY = Math.max(0, sortedRowsY[0] - 1);
    const botY = sortedRowsY[sortedRowsY.length - 1] + 1;
    const spineX = Math.max(0, minLeft - 2);
    newTrays.push({
      id: 'auto-v-spine',
      orient: 'v',
      x: spineX,
      y: topY,
      len: Math.max(2, botY - topY + 1),
      widthMm: 300, depthMm: 150, fillLimitPct: 40,
    });
  }
  // сохраняем: заменяем все auto-*, оставляем пользовательские
  const userTrays = (plan.trays || []).filter(t => !String(t.id || '').startsWith('auto-'));
  savePlan({ ...plan, trays: [...userTrays, ...newTrays] });
  renderPlan();
  updateStatus(`✔ Авто-каналы: ${newTrays.length} канал(а/ов) сгенерировано по ${sortedRowsY.length} рядам.`);
}

/* v0.59.309: подогнать сечения ВСЕХ перегруженных каналов одним кликом.
   Для каждого канала с pct > fillLimitPct: neededCross = usedMm2 / (limit/100),
   затем новые W/D с сохранением соотношения сторон, округление ceil(W/50)×50 и
   ceil(D/10)×10. Размеры только увеличиваются (никогда не уменьшаются). */
function fitAllTrays() {
  const plan = getPlan();
  const trays = plan.trays || [];
  if (!trays.length) { updateStatus('⚠ На плане нет каналов — нечего подгонять.'); return; }
  const fills = computeTrayFills(plan);
  let fixed = 0;
  trays.forEach(t => {
    const f = fills.get(t.id);
    if (!f) return;
    const limit = (t.fillLimitPct || 40) / 100;
    if (limit <= 0 || f.pct <= (t.fillLimitPct || 40)) return;
    const usedMm2 = f.usedMm2 || 0;
    if (usedMm2 <= 0) return;
    const neededCross = usedMm2 / limit;
    const ratio = (t.widthMm || 100) / Math.max(1, t.depthMm || 50);
    let newW = Math.sqrt(neededCross * ratio);
    newW = Math.ceil(newW / 50) * 50;
    let newD = Math.ceil((neededCross / newW) / 10) * 10;
    const oldW = t.widthMm || 100, oldD = t.depthMm || 50;
    t.widthMm = Math.max(oldW, newW);
    t.depthMm = Math.max(oldD, newD);
    if (t.widthMm !== oldW || t.depthMm !== oldD) fixed++;
  });
  if (!fixed) { updateStatus('✓ Все каналы в пределах лимита — подгонка не требуется.'); return; }
  savePlan(plan);
  renderPlan();
  updateStatus(`✔ Подогнано ${fixed} канал(а/ов): сечение увеличено до лимита заполнения.`);
}

/* ---------- CSV export ---------- */
function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  // BOM для Excel + UTF-8
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function exportBomCsv() {
  const links = getVisibleLinks();
  const byType = new Map();
  for (const l of links) {
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const r = byType.get(t);
    r.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) r.lenRaw += +l.lengthM;
    else r.withoutLen++;
  }
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['Тип кабеля', 'Линий', 'Σ длин, м', `С запасом ×${BOM_RESERVE}, м`, 'Без длины']];
  for (const [t, r] of byType.entries()) {
    rows.push([cableLabel(t), r.lines, r.lenRaw.toFixed(1), (r.lenRaw * BOM_RESERVE).toFixed(1), r.withoutLen || '']);
  }
  // v0.59.310: секция «Кабельные каналы» — группировка по размеру сечения
  const plan = getPlan();
  const trays = plan.trays || [];
  if (trays.length) {
    const bySize = new Map();
    trays.forEach(t => {
      const key = `${t.widthMm || 100}×${t.depthMm || 50}`;
      const lenM = (t.len || 0) * plan.step;
      if (!bySize.has(key)) bySize.set(key, { count: 0, totalM: 0 });
      const r = bySize.get(key);
      r.count++;
      r.totalM += lenM;
    });
    rows.push([]);
    rows.push(['Сечение канала, мм', 'Шт', 'Σ длин, м', `С запасом ×${BOM_RESERVE}, м`, '']);
    Array.from(bySize.entries())
      .sort((a, b) => b[1].totalM - a[1].totalM)
      .forEach(([size, r]) => {
        rows.push([size, r.count, r.totalM.toFixed(1), (r.totalM * BOM_RESERVE).toFixed(1), '']);
      });
  }
  downloadCsv('scs-bom-' + dateStamp() + '.csv', rows);
}

function exportLinksCsv() {
  const links = getVisibleLinks();
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['#', 'Шкаф A', 'Устройство A', 'Порт A', 'Шкаф B', 'Устройство B', 'Порт B', 'Кабель', 'Длина, м', 'С запасом, м', 'Заметка']];
  links.forEach((l, i) => {
    const len = l.lengthM != null && !Number.isNaN(+l.lengthM) ? +l.lengthM : null;
    rows.push([
      i + 1,
      getRackShortLabel(l.fromRackId),
      deviceLabel(l.fromRackId, l.fromDevId),
      l.fromPort || '',
      getRackShortLabel(l.toRackId),
      deviceLabel(l.toRackId, l.toDevId),
      l.toPort || '',
      cableLabel(l.cableType),
      len == null ? '' : len.toFixed(1),
      len == null ? '' : (len * BOM_RESERVE).toFixed(1),
      l.note || '',
    ]);
  });
  downloadCsv('scs-links-' + dateStamp() + '.csv', rows);
}
/* ---------- Project JSON import / export ---------- */
const PROJECT_SCHEMA = 'raschet.scs-design/1';

function exportProjectJson() {
  const payload = {
    schema: PROJECT_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: (document.querySelector('[data-app-version]')?.textContent || '').trim(),
    selection: loadJson(LS_SELECTION, []),
    links: getLinks(),
    plan: getPlan(),
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scs-design-${dateStamp()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  const st = document.getElementById('sd-import-status');
  if (st) st.textContent = `✔ Сохранено: ${payload.links.length} связей · ${Object.keys(payload.plan.positions || {}).length} позиций · ${payload.selection.length} выбр.стоек`;
}

function importProjectJson(file) {
  const st = document.getElementById('sd-import-status');
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj || obj.schema !== PROJECT_SCHEMA) {
        if (st) st.textContent = `⚠ Не похоже на проект SCS (schema ≠ ${PROJECT_SCHEMA}).`;
        return;
      }
      if (Array.isArray(obj.selection)) saveJson(LS_SELECTION, obj.selection);
      if (Array.isArray(obj.links)) setLinks(obj.links);
      if (obj.plan && typeof obj.plan === 'object') savePlan(obj.plan);
      if (st) st.textContent = `✔ Импортировано: ${(obj.links || []).length} связей · ${Object.keys((obj.plan && obj.plan.positions) || {}).length} позиций · ${(obj.selection || []).length} выбр.стоек`;
      renderLinksTab();
      renderPlan();
      renderRacksSummary();
    } catch (err) {
      if (st) st.textContent = `⚠ Ошибка чтения: ${err.message}`;
    }
  };
  rd.readAsText(file);
}

function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function updateLink(id, patch) {
  const cur = getLinks();
  const i = cur.findIndex(x => x.id === id);
  if (i < 0) return;
  cur[i] = { ...cur[i], ...patch };
  setLinks(cur);
  renderBom();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const { pid, migrated } = rescopeToActiveProject();
  renderProjectBadge(pid);
  if (migrated > 0) {
    updateStatus(`ℹ Данные СКС перенесены в активный проект (перенесено ключей: ${migrated}). Старые глобальные ключи оставлены как резерв.`);
  }
  setupTabs();
  const cleaned = sanitizeLinks();
  renderLinksTab();
  // Esc — снять фокус с трассы на плане
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (focusRackId) {
      focusRackId = null;
      renderPlan();
    }
  });
  if (cleaned > 0) {
    updateStatus(`⚠ Удалено ${cleaned} связь(ей) с кабельными органайзерами — у них нет портов, они используются только для трассировки.`);
  }
  document.getElementById('sd-export-csv')?.addEventListener('click', exportBomCsv);
  document.getElementById('sd-export-links-csv')?.addEventListener('click', exportLinksCsv);
  document.getElementById('sd-racks-csv')?.addEventListener('click', exportRacksCsv);
  document.getElementById('sd-plan-apply')?.addEventListener('click', applySuggestedLengths);
  document.getElementById('sd-plan-reset')?.addEventListener('click', resetPlan);
  document.getElementById('sd-plan-autolay')?.addEventListener('click', autoLayout);
  document.getElementById('sd-plan-svg')?.addEventListener('click', exportPlanSvg);
  document.getElementById('sd-plan-png')?.addEventListener('click', exportPlanPng);
  document.getElementById('sd-plan-add-tray-h')?.addEventListener('click', () => addTray('h'));
  document.getElementById('sd-plan-add-tray-v')?.addEventListener('click', () => addTray('v'));
  document.getElementById('sd-plan-auto-trays')?.addEventListener('click', autoGenerateTrays);
  document.getElementById('sd-plan-fit-all')?.addEventListener('click', fitAllTrays);
  document.getElementById('sd-plan-fit-content')?.addEventListener('click', fitPlanToContent);
  document.getElementById('sd-plan-undo')?.addEventListener('click', undoPlan);
  document.getElementById('sd-plan-redo')?.addEventListener('click', redoPlan);
  // v0.59.295: zoom/pan только мышью (кнопки убраны). Двойной клик = 1:1.
  const planWrap = document.querySelector('.sd-plan-wrap');
  if (planWrap) {
    // Ctrl+wheel zoom
    planWrap.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setPlanZoom(planZoom * delta, { clientX: e.clientX, clientY: e.clientY });
    }, { passive: false });
    // Middle-button / Shift+LMB grab-pan
    let panStart = null;
    planWrap.addEventListener('mousedown', e => {
      const isMiddle = e.button === 1;
      const isShiftLeft = e.button === 0 && e.shiftKey;
      // Shift+LMB на пустом канвасе (не на стойке/кнопке)
      const onRack = e.target.closest('.sd-plan-rack, .sd-plan-chip, button, input');
      if (!(isMiddle || (isShiftLeft && !onRack))) return;
      e.preventDefault();
      panStart = { x: e.clientX, y: e.clientY, sl: planWrap.scrollLeft, st: planWrap.scrollTop };
      planWrap.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      if (!panStart) return;
      planWrap.scrollLeft = panStart.sl - (e.clientX - panStart.x);
      planWrap.scrollTop  = panStart.st - (e.clientY - panStart.y);
    });
    window.addEventListener('mouseup', () => {
      if (!panStart) return;
      panStart = null;
      planWrap.style.cursor = '';
    });
    // Dblclick на пустом месте канваса — reset зума на 1:1
    planWrap.addEventListener('dblclick', e => {
      const onItem = e.target.closest('.sd-plan-rack, .sd-plan-tray, .sd-plan-chip, button, input');
      if (onItem) return;
      setPlanZoom(1);
    });
    // v0.59.318: клавиатурные шорткаты при активном focusRackId.
    // R — повернуть на 90°, Delete — убрать со схемы, стрелки — nudge на 1 клетку.
    // Игнорируем, когда фокус в <input> / <textarea> / contenteditable.
    document.addEventListener('keydown', e => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable);
      // v0.59.319: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo на plan-view.
      // Только если активна вкладка plan (sd-plan-wrap визуально показан).
      const planVisible = !!document.querySelector('.sd-plan-wrap')?.offsetParent;
      if (!typing && planVisible && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
          if (e.shiftKey) redoPlan(); else undoPlan();
          e.preventDefault(); return;
        }
        if (e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н') {
          redoPlan(); e.preventDefault(); return;
        }
      }
      if (!focusRackId) return;
      if (typing) return;
      const p2 = getPlan();
      const cur = p2.positions[focusRackId];
      if (!cur) return;
      const r = getRacks().find(x => x.id === focusRackId);
      if (!r) return;
      const [wF, hF] = rackSizeCells(r, p2, cur.rot || 0);
      let handled = false;
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        const nextRot = ((+cur.rot || 0) + 90) % 360;
        const [nwF, nhF] = rackSizeCells(r, p2, nextRot);
        cur.rot = nextRot;
        cur.x = Math.max(0, Math.min(PLAN_COLS - nwF, cur.x));
        cur.y = Math.max(0, Math.min(PLAN_ROWS - nhF, cur.y));
        savePlan(p2); renderPlan(); handled = true;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        delete p2.positions[focusRackId];
        focusRackId = null;
        savePlan(p2); renderPlan(); handled = true;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowLeft')  cur.x = Math.max(0, cur.x - step);
        if (e.key === 'ArrowRight') cur.x = Math.min(PLAN_COLS - wF, cur.x + step);
        if (e.key === 'ArrowUp')    cur.y = Math.max(0, cur.y - step);
        if (e.key === 'ArrowDown')  cur.y = Math.min(PLAN_ROWS - hF, cur.y + step);
        savePlan(p2); renderPlan(); handled = true;
      }
      if (handled) e.preventDefault();
    });
  }
  document.getElementById('sd-export-json')?.addEventListener('click', exportProjectJson);
  const importBtn = document.getElementById('sd-import-json');
  const importFile = document.getElementById('sd-import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) importProjectJson(f);
      e.target.value = '';
    });
  }
  document.getElementById('sd-plan-step')?.addEventListener('change', e => {
    const p = getPlan(); p.step = Math.max(0.1, +e.target.value || PLAN_DEFAULT.step); savePlan(p); updatePlanInfo();
  });
  document.getElementById('sd-plan-kroute')?.addEventListener('change', e => {
    const p = getPlan(); p.kRoute = Math.max(1.0, +e.target.value || PLAN_DEFAULT.kRoute); savePlan(p); updatePlanInfo();
  });
  window.addEventListener('storage', (e) => {
    if ([LS_RACK, LS_CONTENTS, LS_RACKTAGS, LS_LINKS].includes(e.key)) renderLinksTab();
  });
  // пересчёт линий при скролле ряда стоек, скролле юнитов внутри карточки и ресайзе окна
  document.getElementById('sd-racks-row')?.addEventListener('scroll', scheduleOverlay, true);
  window.addEventListener('resize', scheduleOverlay);
});
