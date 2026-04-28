// ======================================================================
// shared/por.js — Project Object Registry (POR) — slim core
// Фаза 2.5 PoC (v0.59.500/501): единый реестр проектных объектов.
//
// Архитектура:
//   ├── shared/por.js          ← это ядро: CRUD + pubsub + ports + registry-driven factory
//   ├── shared/por-types/      ← type-definitions (rack / consumer-group / containers / …)
//   │   ├── index.js           ← регистрация type-definitions через registerPorType()
//   │   ├── _helpers.js        ← num/str/withDomains
//   │   ├── rack.js
//   │   ├── consumer-group.js  ← + operations: canGroup/createGroup/material…
//   │   └── containers.js      ← site/building/floor/space
//   ├── shared/data-adapter.js ← contract «как получить данные» (LS / POR / …)
//   ├── shared/por-adapters.js ← POR-backed реализации DataAdapter
//   └── shared/project-bootstrap.js ← регистрирует POR-адаптеры в проектном режиме
//
// Конфигураторы (rack-config / scs-config / …) НЕ импортируют этот файл.
// Они работают через DataAdapter (см. shared/data-adapter.js). Проектный
// слой инжектит POR-backed адаптер; standalone — LS-based по умолчанию.
//
// Схема POR-объекта:
//   {
//     id, type, subtype, tag, name, manufacturer, model, serialNo, assetId,
//     domains: {
//       electrical:   { ports[], …attrs },
//       scs:          { ports[], contents[], …attrs },
//       mechanical:   { widthMm, depthMm, heightMm, ports[], …attrs },
//       hvac:         { ports[], …attrs },
//       suppression:  { ports[], …attrs },
//       logistics:    { …attrs },
//       location:     { siteId?, buildingId?, floorId?, spaceId?, parentId?, level?, address?, positionMm?, rotationDeg? },
//     },
//     views: { schematic?, layout?, data?, mechanical?, '3d'? },
//     ownerByDomain: { electrical: 'uid_X', … },
//     createdBy/At, updatedBy/At, schemaVersion: 1
//   }
//
// Storage: raschet.project.<pid>.por.objects.v1   (формат { [oid]: obj })
// Pubsub:  in-tab Map<pid, Set<cb>> + cross-tab через storage-event.
// ======================================================================

import { projectKey, projectLoad, projectSave, getActiveProjectId, listProjects } from './project-storage.js';
import { getPorType, listPorTypes, registerPorType, listPorTypeIds } from './por-types/index.js';
import {
  canGroupTogether       as _grp_canGroupTogether,
  createGroupFromMembers as _grp_createGroupFromMembers,
  addMemberToGroup       as _grp_addMemberToGroup,
  removeMemberFromGroup  as _grp_removeMemberFromGroup,
  materializeGroupSlot   as _grp_materializeGroupSlot,
  materializeAllSlots    as _grp_materializeAllSlots,
} from './por-types/consumer-group.js';

// ──────────────────────────── Константы ─────────────────────────────

const POR_MODULE = 'por';
const POR_KEY    = 'objects.v1';
const SCHEMA_VERSION = 1;

export const POR_DOMAINS = ['electrical', 'scs', 'mechanical', 'hvac', 'suppression', 'logistics', 'location'];

export const POR_DOMAIN_META = {
  electrical:   { label: 'Электрика',     icon: '⚡', color: '#1976d2' },
  scs:          { label: 'СКС',          icon: '🔗', color: '#388e3c' },
  mechanical:   { label: 'Механика',     icon: '⚙',  color: '#616161' },
  hvac:         { label: 'Климат',       icon: '❄',  color: '#0288d1' },
  suppression:  { label: 'АГПТ',         icon: '🔥', color: '#d32f2f' },
  logistics:    { label: 'Логистика',    icon: '📦', color: '#7b1fa2' },
  location:     { label: 'Расположение', icon: '📍', color: '#455a64' },
};

// ──────────────────────────── Helpers ───────────────────────────────

function _now() { return Date.now(); }
function _uidPor() { return 'por_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function _uidPort() { return 'port_' + Math.random().toString(36).slice(2, 8); }
function _currentUid() {
  try { return localStorage.getItem('raschet.uid') || 'anon'; } catch { return 'anon'; }
}

// v0.59.602: pid resolution с auto-redirect sketch → parent.
// ПРОБЛЕМА: scs-design открыт в подпроекте (kind='sketch') s_o0evc10etc
// у parent p_tyux2vnmz4. Юзер добавляет стойку → POR-объект пишется
// в s_o0evc10etc, но parent p_tyux2vnmz4 не видит. POR-данные физических
// стоек должны быть ОДНИ на весь проект (sketch = "вариант СКС-вида",
// не отдельная физическая инсталляция).
//
// РЕШЕНИЕ: _resolvePid авто-редиректит sketch → parent. Для всех
// CRUD-операций POR-объекты живут в parent. sketch остаётся для
// scs-design/scs-config/links/contents storage (это его собственные
// данные), но POR (физические объекты — стойки/группы) — у parent.
function _resolvePid(pid) {
  let id = pid || getActiveProjectId() || null;
  if (!id) return null;
  try {
    const projects = listProjects();
    const proj = projects.find(p => p && p.id === id);
    if (proj && proj.kind === 'sketch' && proj.parentProjectId) {
      return proj.parentProjectId;
    }
  } catch {}
  return id;
}

function _loadStore(pid) {
  pid = _resolvePid(pid); if (!pid) return {};
  return projectLoad(pid, POR_MODULE, POR_KEY, {}) || {};
}
function _saveStore(pid, store) {
  pid = _resolvePid(pid); if (!pid) return;
  projectSave(pid, POR_MODULE, POR_KEY, store);
}
function _ensureObjectShape(o) {
  if (!o || typeof o !== 'object') return null;
  if (!o.domains || typeof o.domains !== 'object') o.domains = {};
  if (!o.views   || typeof o.views   !== 'object') o.views   = {};
  if (!o.ownerByDomain || typeof o.ownerByDomain !== 'object') o.ownerByDomain = {};
  if (!Number.isFinite(o.schemaVersion)) o.schemaVersion = SCHEMA_VERSION;
  return o;
}

// ──────────────────────────── Pubsub ────────────────────────────────

const _subs = new Map();

function _emit(pid, event) {
  pid = _resolvePid(pid); if (!pid) return;
  const set = _subs.get(pid); if (!set) return;
  for (const cb of set) {
    try { cb(event); } catch (e) { console.warn('[por] subscriber failed:', e); }
  }
}

export function subscribe(pid, callback) {
  pid = _resolvePid(pid);
  if (!pid || typeof callback !== 'function') return () => {};
  if (!_subs.has(pid)) _subs.set(pid, new Set());
  _subs.get(pid).add(callback);
  return () => { const set = _subs.get(pid); if (set) set.delete(callback); };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e || !e.key) return;
    const m = e.key.match(/^raschet\.project\.([^.]+)\.por\.objects\.v1$/);
    if (!m) return;
    _emit(m[1], { kind: 'sync', pid: m[1], source: 'remote' });
  });
}

// ──────────────────────────── CRUD ──────────────────────────────────

export function getObjects(pid, filter) {
  pid = _resolvePid(pid); if (!pid) return [];
  const store = _loadStore(pid);
  const arr = Object.values(store).filter(Boolean).map(_ensureObjectShape).filter(Boolean);
  if (!filter) return arr;
  return arr.filter(o => {
    if (filter.type    && o.type    !== filter.type)    return false;
    if (filter.subtype && o.subtype !== filter.subtype) return false;
    if (filter.domain  && !(o.domains && o.domains[filter.domain])) return false;
    if (filter.tag     && o.tag     !== filter.tag)     return false;
    return true;
  });
}

export function getObject(pid, oid) {
  pid = _resolvePid(pid); if (!pid || !oid) return null;
  const store = _loadStore(pid);
  return _ensureObjectShape(store[oid]) || null;
}

export function addObject(pid, partial) {
  pid = _resolvePid(pid); if (!pid) return null;
  if (!partial || !partial.type) { console.warn('[por] addObject: type required'); return null; }
  const uid = _currentUid();
  const now = _now();
  const oid = partial.id || _uidPor();
  // Базовый shape с whitelist'ом обязательных top-level полей.
  const baseShape = _ensureObjectShape({
    id: oid, type: partial.type,
    subtype: partial.subtype || '', tag: partial.tag || '', name: partial.name || '',
    manufacturer: partial.manufacturer || '', model: partial.model || '',
    serialNo: partial.serialNo || '', assetId: partial.assetId || '',
    domains: partial.domains || {}, views: partial.views || {},
    ownerByDomain: partial.ownerByDomain || {},
    createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  });
  // v0.59.510: extra top-level fields из partial passthrough — для legacy-
  // маркеров (legacyRackId, legacySource), groupId-link'ов и любых
  // дополнительных меток без нужды расширять whitelist.
  const obj = baseShape;
  const RESERVED = new Set(['id','type','subtype','tag','name','manufacturer','model','serialNo','assetId','domains','views','ownerByDomain','createdBy','createdAt','updatedBy','updatedAt','schemaVersion']);
  for (const [k, v] of Object.entries(partial)) {
    if (RESERVED.has(k)) continue;
    obj[k] = v;
  }
  for (const d of Object.keys(obj.domains)) {
    if (!obj.ownerByDomain[d]) obj.ownerByDomain[d] = uid;
  }
  // Если объект с этим id уже существует — сохраняем его createdBy/At
  // (перезаписываем только updatedBy/At). Это делает upsert-подобным.
  const store = _loadStore(pid);
  const prev = store[oid];
  if (prev) {
    obj.createdBy = prev.createdBy || obj.createdBy;
    obj.createdAt = prev.createdAt || obj.createdAt;
  }
  store[oid] = obj;
  _saveStore(pid, store);
  _emit(pid, { kind: prev ? 'patch' : 'add', pid, oid, object: obj, before: prev, source: 'local' });
  return obj;
}

export function patchObject(pid, oid, patch, opts) {
  pid = _resolvePid(pid); if (!pid || !oid || !patch) return null;
  const store = _loadStore(pid);
  const before = store[oid]; if (!before) return null;
  const after = JSON.parse(JSON.stringify(before)); _ensureObjectShape(after);
  const uid = _currentUid();
  if (opts && opts.domain) {
    const d = opts.domain;
    if (!after.domains[d]) after.domains[d] = {};
    Object.assign(after.domains[d], patch);
    after.ownerByDomain[d] = uid;
  } else if (opts && opts.view) {
    const v = opts.view;
    if (!after.views[v]) after.views[v] = {};
    Object.assign(after.views[v], patch);
  } else {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'createdBy' || k === 'createdAt' || k === 'schemaVersion') continue;
      after[k] = v;
    }
  }
  after.updatedBy = uid; after.updatedAt = _now();
  store[oid] = after; _saveStore(pid, store);
  _emit(pid, { kind: 'patch', pid, oid, before, after, source: 'local' });
  return after;
}

export function removeObject(pid, oid) {
  pid = _resolvePid(pid); if (!pid || !oid) return false;
  const store = _loadStore(pid);
  const before = store[oid]; if (!before) return false;
  delete store[oid]; _saveStore(pid, store);
  _emit(pid, { kind: 'remove', pid, oid, before, source: 'local' });
  return true;
}

export function findByTag(pid, tag) {
  if (!tag) return null;
  return getObjects(pid, { tag })[0] || null;
}

// ──────────────────────────── Type registry-driven factory ──────────

/**
 * Универсальный конструктор: ищет type-definition в registry, вызывает
 * factory(opts), создаёт POR-объект и возвращает его.
 */
export function createObject(pid, type, opts) {
  const def = getPorType(type);
  if (!def) { console.warn('[por] createObject: unknown type', type); return null; }
  const partial = def.factory(opts || {});
  if (!partial) { console.warn('[por] createObject: factory вернул null', type); return null; }
  return addObject(pid, partial);
}

// Реэкспорт API registry для удобства потребителей.
export { getPorType, listPorTypes, listPorTypeIds, registerPorType };

// ──────────────────────────── Ports API ─────────────────────────────
//
// См. подробное описание port-структуры и kind-таблицу в комментарии
// shared/por-types/_helpers.js (TODO: вынести таблицу в отдельный
// файл-документацию или в JSDoc).

function _ensurePortsArray(obj, domain) {
  if (!obj.domains[domain]) obj.domains[domain] = {};
  if (!Array.isArray(obj.domains[domain].ports)) obj.domains[domain].ports = [];
  return obj.domains[domain].ports;
}

export function addPort(pid, oid, domain, port) {
  pid = _resolvePid(pid); if (!pid || !oid || !domain || !port) return null;
  const obj = getObject(pid, oid); if (!obj) return null;
  const portObj = {
    id: port.id || _uidPort(),
    kind: port.kind || 'custom',
    name: port.name || '',
    direction: port.direction || 'bidir',
    ...port,
  };
  if (!port.id) portObj.id = portObj.id;
  const ports = _ensurePortsArray(obj, domain);
  ports.push(portObj);
  return patchObject(pid, oid, { ports }, { domain });
}

export function removePort(pid, oid, domain, portId) {
  pid = _resolvePid(pid); if (!pid || !oid || !domain || !portId) return false;
  const obj = getObject(pid, oid); if (!obj) return false;
  const ports = (obj.domains[domain] && obj.domains[domain].ports) || [];
  const newPorts = ports.filter(p => p.id !== portId);
  if (newPorts.length === ports.length) return false;
  patchObject(pid, oid, { ports: newPorts }, { domain });
  return true;
}

export function patchPort(pid, oid, domain, portId, patchPortAttrs) {
  pid = _resolvePid(pid); if (!pid || !oid || !domain || !portId) return null;
  const obj = getObject(pid, oid); if (!obj) return null;
  const ports = (obj.domains[domain] && obj.domains[domain].ports) || [];
  const newPorts = ports.map(p => p.id === portId ? { ...p, ...patchPortAttrs, id: portId } : p);
  return patchObject(pid, oid, { ports: newPorts }, { domain });
}

export function listAllPorts(pid, oid) {
  const obj = getObject(pid, oid); if (!obj) return [];
  const out = [];
  for (const [domain, dData] of Object.entries(obj.domains || {})) {
    const ports = Array.isArray(dData && dData.ports) ? dData.ports : [];
    for (const p of ports) out.push({ ...p, domain });
  }
  return out;
}

// ──────────────────────────── Group operations ──────────────────────
//
// Operations живут в shared/por-types/consumer-group.js (где и factory),
// сюда лишь подвязываем их к нашему API (getObject/addObject/patchObject/
// removeObject) — чтобы consumer-group.js не имел циклической зависимости.

const _porApi = { getObject, addObject, patchObject, removeObject };

export const canGroupTogether = _grp_canGroupTogether;
export function createGroup(pid, memberObjects, opts) {
  // Прокидываем typeDef первого члена для groupElectricalKeys.
  const first = memberObjects && memberObjects[0];
  const typeDef = first ? getPorType(first.type) : null;
  return _grp_createGroupFromMembers(_porApi, pid, memberObjects, { ...(opts || {}), typeDef });
}
export function addMemberToGroup(pid, groupId, memberObject, opts) {
  const typeDef = memberObject ? getPorType(memberObject.type) : null;
  const groupKeys = (opts && opts.groupElectricalKeys) || (typeDef && typeDef.groupElectricalKeys);
  return _grp_addMemberToGroup(_porApi, pid, groupId, memberObject, { groupElectricalKeys: groupKeys });
}
export function removeMemberFromGroup(pid, groupId, memberId) {
  return _grp_removeMemberFromGroup(_porApi, pid, groupId, memberId);
}

/**
 * Материализовать один анонимный слот группы. memberType — какой POR-type
 * создать (например 'rack'); опционально memberOpts передаются factory.
 */
export function materializeGroupSlot(pid, groupId, memberType, memberOpts) {
  const def = getPorType(memberType);
  if (!def) return { ok: false, reason: `Неизвестный type: ${memberType}` };
  return _grp_materializeGroupSlot(_porApi, pid, groupId, def.factory, memberOpts);
}

/** Материализовать ВСЕ анонимные слоты. */
export function materializeAllSlots(pid, groupId, memberType, memberOptsArr) {
  const def = getPorType(memberType);
  if (!def) return { ok: false, reason: `Неизвестный type: ${memberType}` };
  return _grp_materializeAllSlots(_porApi, pid, groupId, def.factory, memberOptsArr);
}

// ──────────────────────────── Debug ─────────────────────────────────

if (typeof window !== 'undefined') {
  window.RaschetPOR = {
    // CRUD
    getObjects, getObject, addObject, patchObject, removeObject, findByTag, subscribe,
    // Registry-based factory
    createObject, getPorType, listPorTypes, listPorTypeIds, registerPorType,
    // Ports
    addPort, removePort, patchPort, listAllPorts,
    // Groups
    canGroupTogether, createGroup, addMemberToGroup, removeMemberFromGroup,
    materializeGroupSlot, materializeAllSlots,
    // Constants
    POR_DOMAINS, POR_DOMAIN_META,
  };
}
