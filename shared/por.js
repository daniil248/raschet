// ======================================================================
// shared/por.js — Project Object Registry (POR)
// Фаза 2.5 PoC (v0.59.500): единый реестр проектных объектов с
// многодоменными атрибутами и многостраничными видами.
//
// Зачем: раньше каждый модуль (engine / rack-config / scs-config / …)
// имел собственное хранилище. Когда технолог добавлял шкаф в одном
// модуле, электрик и СКС-инженер не видели его в своих — и заводили
// тот же объект ещё раз. POR решает это: один объект = один POR-record,
// у которого есть атрибуты по доменам (electrical/scs/mechanical/hvac/…)
// и виды по page.kind (schematic/layout/data/mechanical/3d).
//
// Схема POR-объекта:
//   {
//     id:           string,    // POR-id, уникальный в рамках проекта
//     type:         string,    // 'rack' | 'panel' | 'ups' | 'consumer' | 'outlet' | 'patch-panel' | 'cable' | …
//     subtype:      string,    // уточнение в рамках type
//     tag:          string,    // обозначение (user-facing), уникально в проекте
//     name:         string,    // человеко-читаемое имя
//     manufacturer, model, serialNo, assetId,
//
//     domains: {                 // ← многодоменные атрибуты
//       electrical:   { … },
//       scs:          { … },
//       mechanical:   { … },
//       hvac:         { … },
//       suppression:  { … },
//       logistics:    { … },
//     },
//     views: {                   // ← многостраничные виды (Phase 2.2 как часть POR)
//       schematic:    { svg?, symbol?, ports[] },
//       layout:       { footprintMm: { w, h }, anchor },
//       data:         { jackType, color, … },
//       mechanical:   { svgFront?, svgTop? },
//       '3d':         { meshUrl?, color },
//     },
//
//     ownerByDomain: { electrical: 'uid_X', scs: 'uid_Y' },  // кто последний правил домен
//     createdBy:     uid,
//     createdAt:     ms,
//     updatedBy:     uid,
//     updatedAt:     ms,
//     schemaVersion: 1,
//   }
//
// Storage:
//   ЛК-ключ: raschet.project.<pid>.por.objects.v1
//   Формат:  { [oid]: ProjectObject }
//
// PoC scope (v0.59.500):
//   • CRUD + локальный pubsub (in-tab + cross-tab через storage-event).
//   • PoC-тип 'rack' с доменами mechanical / scs / electrical.
//   • Облачная sync (Firestore) и domain-locks — будущие подзадачи 2.5.5/6.
// ======================================================================

import { projectKey, projectLoad, projectSave, getActiveProjectId } from './project-storage.js';

// ──────────────────────────── Константы ─────────────────────────────

const POR_MODULE = 'por';
const POR_KEY    = 'objects.v1';
const SCHEMA_VERSION = 1;

// Список известных доменов. Расширяем по мере миграции модулей.
export const POR_DOMAINS = ['electrical', 'scs', 'mechanical', 'hvac', 'suppression', 'logistics'];

// Метаданные доменов для UI (бейджи в инспекторе и т.п.).
export const POR_DOMAIN_META = {
  electrical:   { label: 'Электрика',     icon: '⚡', color: '#1976d2' },
  scs:          { label: 'СКС',          icon: '🔗', color: '#388e3c' },
  mechanical:   { label: 'Механика',     icon: '⚙',  color: '#616161' },
  hvac:         { label: 'Климат',       icon: '❄',  color: '#0288d1' },
  suppression:  { label: 'АГПТ',         icon: '🔥', color: '#d32f2f' },
  logistics:    { label: 'Логистика',    icon: '📦', color: '#7b1fa2' },
};

// Список известных типов POR-объектов. В PoC активны 'rack' и 'consumer-group'.
//
// 'consumer-group' — агрегатор для электрика: несколько физически отдельных
// объектов (стойки, кондеи и т.п.) с ИДЕНТИЧНЫМИ electrical-параметрами
// показываются на принципиалке как ОДИН узел (с бейджем «×N»), но в SCS /
// механике / layout остаются отдельными записями. Создаётся электриком в
// engine, не размывает данные SCS-инженера.
//
// Валидация при добавлении члена в группу — см. canGroupTogether(a, b).
export const POR_TYPES = ['rack', 'panel', 'ups', 'consumer', 'outlet', 'patch-panel', 'cable', 'fire-zone', 'enclosure', 'consumer-group'];

// Поля electrical, которые ДОЛЖНЫ совпадать у членов группы. Если хотя бы
// одно отличается — объединение запрещено. demandKw сравнивается per-unit
// (на одну стойку), не суммарно — иначе любые два объекта не объединить.
export const GROUP_ELECTRICAL_KEYS = ['phases', 'cosPhi', 'demandKw', 'voltageV'];

// ──────────────────────────── Helpers ───────────────────────────────

function _now() { return Date.now(); }
function _uidPor() { return 'por_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function _currentUid() {
  // Заглушка: пока auth не подключён — uid из localStorage или 'anon'.
  try { return localStorage.getItem('raschet.uid') || 'anon'; } catch { return 'anon'; }
}

function _resolvePid(pid) {
  return pid || getActiveProjectId() || null;
}

function _loadStore(pid) {
  pid = _resolvePid(pid);
  if (!pid) return {};
  return projectLoad(pid, POR_MODULE, POR_KEY, {}) || {};
}

function _saveStore(pid, store) {
  pid = _resolvePid(pid);
  if (!pid) return;
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

// Map<pid, Set<callback>>. Callback signature:
//   (event: { kind: 'add'|'patch'|'remove'|'sync', pid, oid?, object?, before?, after?, source: 'local'|'remote' })
const _subs = new Map();

function _emit(pid, event) {
  pid = _resolvePid(pid);
  if (!pid) return;
  const set = _subs.get(pid);
  if (!set) return;
  for (const cb of set) {
    try { cb(event); } catch (e) { console.warn('[por] subscriber failed:', e); }
  }
}

export function subscribe(pid, callback) {
  pid = _resolvePid(pid);
  if (!pid || typeof callback !== 'function') return () => {};
  if (!_subs.has(pid)) _subs.set(pid, new Set());
  _subs.get(pid).add(callback);
  return () => {
    const set = _subs.get(pid);
    if (set) set.delete(callback);
  };
}

// Cross-tab синхронизация через storage-event. Слушаем все вкладки —
// если другой таб изменил POR-store текущего проекта, эмитим 'sync'.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e || !e.key) return;
    const m = e.key.match(/^raschet\.project\.([^.]+)\.por\.objects\.v1$/);
    if (!m) return;
    const pid = m[1];
    _emit(pid, { kind: 'sync', pid, source: 'remote' });
  });
}

// ──────────────────────────── CRUD ──────────────────────────────────

/** Список всех POR-объектов проекта (опционально с фильтром). */
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

/** Один POR-объект по id. */
export function getObject(pid, oid) {
  pid = _resolvePid(pid); if (!pid || !oid) return null;
  const store = _loadStore(pid);
  return _ensureObjectShape(store[oid]) || null;
}

/**
 * Добавить POR-объект. Возвращает финальный объект с id/createdAt/updatedAt.
 * partial может содержать любые поля схемы; обязательно — type.
 */
export function addObject(pid, partial) {
  pid = _resolvePid(pid); if (!pid) return null;
  if (!partial || !partial.type) {
    console.warn('[por] addObject: type required'); return null;
  }
  const uid = _currentUid();
  const now = _now();
  const oid = partial.id || _uidPor();
  const obj = _ensureObjectShape({
    id: oid,
    type: partial.type,
    subtype: partial.subtype || '',
    tag: partial.tag || '',
    name: partial.name || '',
    manufacturer: partial.manufacturer || '',
    model:        partial.model        || '',
    serialNo:     partial.serialNo     || '',
    assetId:      partial.assetId      || '',
    domains: partial.domains || {},
    views:   partial.views   || {},
    ownerByDomain: partial.ownerByDomain || {},
    createdBy: uid, createdAt: now,
    updatedBy: uid, updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  });
  // owner для каждого домена, который пришёл в partial.domains, считаем — uid создателя.
  for (const d of Object.keys(obj.domains)) {
    if (!obj.ownerByDomain[d]) obj.ownerByDomain[d] = uid;
  }
  const store = _loadStore(pid);
  store[oid] = obj;
  _saveStore(pid, store);
  _emit(pid, { kind: 'add', pid, oid, object: obj, source: 'local' });
  return obj;
}

/**
 * Patch объекта. Если opts.domain — патч идёт в obj.domains[domain] (deep merge поверх),
 * obj.ownerByDomain[domain] обновляется на текущего uid.
 * Если opts.view — патч в obj.views[view].
 * Иначе — top-level merge (tag, name, manufacturer, …).
 *
 * Возвращает обновлённый объект или null если не найден.
 */
export function patchObject(pid, oid, patch, opts) {
  pid = _resolvePid(pid); if (!pid || !oid || !patch) return null;
  const store = _loadStore(pid);
  const before = store[oid];
  if (!before) return null;
  const after = JSON.parse(JSON.stringify(before));
  _ensureObjectShape(after);
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
    // Top-level. Не позволяем затереть id/createdBy/createdAt.
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'createdBy' || k === 'createdAt' || k === 'schemaVersion') continue;
      after[k] = v;
    }
  }
  after.updatedBy = uid;
  after.updatedAt = _now();
  store[oid] = after;
  _saveStore(pid, store);
  _emit(pid, { kind: 'patch', pid, oid, before, after, source: 'local' });
  return after;
}

/** Удалить POR-объект. Возвращает true если был удалён. */
export function removeObject(pid, oid) {
  pid = _resolvePid(pid); if (!pid || !oid) return false;
  const store = _loadStore(pid);
  const before = store[oid];
  if (!before) return false;
  delete store[oid];
  _saveStore(pid, store);
  _emit(pid, { kind: 'remove', pid, oid, before, source: 'local' });
  return true;
}

/** Найти объект по тегу (уникальный в рамках проекта). */
export function findByTag(pid, tag) {
  if (!tag) return null;
  const arr = getObjects(pid, { tag });
  return arr[0] || null;
}

// ──────────────────────────── Schema helpers ────────────────────────

/** Создать заготовку POR-объекта типа 'rack'. */
export function createRackPartial(opts) {
  const o = opts || {};
  return {
    type: 'rack',
    subtype: o.subtype || '',
    tag:  o.tag  || '',
    name: o.name || 'Стойка',
    manufacturer: o.manufacturer || '',
    model:        o.model        || '',
    domains: {
      mechanical: {
        widthMm:   Number(o.widthMm)   || 600,
        heightMm:  Number(o.heightMm)  || 1991,  // 42U стандартный
        depthMm:   Number(o.depthMm)   || 800,
        weightKg:  Number(o.weightKg)  || 80,
        rackUnits: Number(o.rackUnits) || 42,
        anchorType: o.anchorType || 'floor',
      },
      scs: {
        contents: Array.isArray(o.contents) ? o.contents : [],
      },
      electrical: {
        demandKw: Number(o.demandKw) || 0,
        cosPhi:   Number(o.cosPhi)   || 0.95,
        phases:   Number(o.phases)   || 3,
      },
    },
    views: {
      schematic:  { symbol: 'rack' },
      layout:     { footprintMm: { w: Number(o.widthMm)||600, h: Number(o.depthMm)||800 } },
      data:       { },
    },
  };
}

// ──────────────────────────── Aggregation groups ───────────────────
//
// Электрик в engine может объединять несколько идентичных по электрике
// объектов (стойки, кондеи, …) в один групповой узел на принципиалке.
// Это уменьшает шум на схеме (вместо 10 одинаковых стоек — один узел
// «Серверные стойки ×10»). При этом SCS-инженер по-прежнему видит каждую
// стойку отдельной строкой в своём списке — данные не размываются.
//
// Группа — отдельный POR-объект type='consumer-group', у которого:
//   • domains.electrical.members        — массив POR-id членов
//   • domains.electrical.demandKw       — суммарная нагрузка (count × per-unit)
//   • domains.electrical.count          — N для бейджа «×N»
//   • domains.electrical.{phases,cosPhi,voltageV,demandKwPerUnit} — общие параметры
//
// Члены группы (физические POR-объекты) остаются неизменными; в их
// поле domains.electrical.groupId хранится id группы — для быстрого
// поиска. Удаление группы НЕ удаляет членов.

/**
 * Можно ли объединить два POR-объекта в группу?
 * Возвращает { ok: bool, reason?: string }.
 */
export function canGroupTogether(a, b) {
  if (!a || !b) return { ok: false, reason: 'Нет объектов' };
  if (a.id === b.id) return { ok: false, reason: 'Один и тот же объект' };
  if (a.type !== b.type) return { ok: false, reason: `Разные типы: ${a.type} vs ${b.type}` };
  const ae = (a.domains && a.domains.electrical) || {};
  const be = (b.domains && b.domains.electrical) || {};
  for (const k of GROUP_ELECTRICAL_KEYS) {
    const av = ae[k], bv = be[k];
    // undefined считается «не задано» — пропускаем (объединить можно).
    if (av == null && bv == null) continue;
    if (av !== bv) {
      return { ok: false, reason: `Различие по ${k}: ${av} vs ${bv}` };
    }
  }
  return { ok: true };
}

/** Создать заготовку POR-объекта типа 'consumer-group'. */
export function createGroupPartial(memberObjects, opts) {
  const o = opts || {};
  const arr = Array.isArray(memberObjects) ? memberObjects : [];
  if (!arr.length) return null;
  const first = arr[0];
  const e = (first.domains && first.domains.electrical) || {};
  const memberType = first.type;
  const memberIds = arr.map(m => m.id);
  const perUnitKw = Number(e.demandKw) || 0;
  return {
    type: 'consumer-group',
    subtype: memberType,                   // что объединяем — для UI
    tag:  o.tag  || '',
    name: o.name || `Группа ${memberType} ×${arr.length}`,
    domains: {
      electrical: {
        members:          memberIds,
        count:            arr.length,
        demandKwPerUnit:  perUnitKw,
        demandKw:         perUnitKw * arr.length,
        phases:           e.phases   || 3,
        cosPhi:           e.cosPhi   || 0.95,
        voltageV:         e.voltageV || null,
      },
    },
    views: {
      schematic: { symbol: 'consumer-group', countBadge: arr.length },
    },
  };
}

/**
 * Создать группу из массива POR-объектов. Вернёт { ok, group?, reason? }.
 * Все члены должны проходить canGroupTogether попарно (через первого).
 */
export function createGroup(pid, memberObjects, opts) {
  const arr = Array.isArray(memberObjects) ? memberObjects : [];
  if (arr.length < 2) return { ok: false, reason: 'Группа требует минимум 2 объекта' };
  for (let i = 1; i < arr.length; i++) {
    const r = canGroupTogether(arr[0], arr[i]);
    if (!r.ok) return r;
  }
  // Проверяем что никто из членов уже не в группе.
  for (const m of arr) {
    const gid = m && m.domains && m.domains.electrical && m.domains.electrical.groupId;
    if (gid) return { ok: false, reason: `Объект ${m.tag || m.id} уже в группе ${gid}` };
  }
  const partial = createGroupPartial(arr, opts);
  if (!partial) return { ok: false, reason: 'Не удалось построить заготовку группы' };
  const group = addObject(pid, partial);
  if (!group) return { ok: false, reason: 'addObject вернул null' };
  // Прописываем groupId членам.
  for (const m of arr) {
    patchObject(pid, m.id, { groupId: group.id }, { domain: 'electrical' });
  }
  return { ok: true, group };
}

/** Добавить ещё один член в существующую группу (с проверкой совместимости). */
export function addMemberToGroup(pid, groupId, memberObject) {
  const group  = getObject(pid, groupId);
  if (!group || group.type !== 'consumer-group') {
    return { ok: false, reason: 'Группа не найдена' };
  }
  const members = (group.domains.electrical && group.domains.electrical.members) || [];
  if (!members.length) return { ok: false, reason: 'Группа без членов — нечем сравнить' };
  const probe = getObject(pid, members[0]);
  if (!probe) return { ok: false, reason: 'Первый член группы не найден' };
  const r = canGroupTogether(probe, memberObject);
  if (!r.ok) return r;
  if (members.includes(memberObject.id)) return { ok: false, reason: 'Уже в группе' };
  const newMembers = [...members, memberObject.id];
  const perUnitKw = Number(group.domains.electrical.demandKwPerUnit) || 0;
  patchObject(pid, groupId, {
    members:  newMembers,
    count:    newMembers.length,
    demandKw: perUnitKw * newMembers.length,
  }, { domain: 'electrical' });
  patchObject(pid, memberObject.id, { groupId }, { domain: 'electrical' });
  return { ok: true };
}

/** Убрать члена из группы. Если в группе остаётся <2 членов — группа удаляется. */
export function removeMemberFromGroup(pid, groupId, memberId) {
  const group = getObject(pid, groupId);
  if (!group) return { ok: false, reason: 'Группа не найдена' };
  const members = (group.domains.electrical && group.domains.electrical.members) || [];
  const newMembers = members.filter(id => id !== memberId);
  patchObject(pid, memberId, { groupId: null }, { domain: 'electrical' });
  if (newMembers.length < 2) {
    // Распускаем группу — последнему оставшемуся (если есть) тоже снимаем groupId.
    for (const id of newMembers) {
      patchObject(pid, id, { groupId: null }, { domain: 'electrical' });
    }
    removeObject(pid, groupId);
    return { ok: true, dissolved: true };
  }
  const perUnitKw = Number(group.domains.electrical.demandKwPerUnit) || 0;
  patchObject(pid, groupId, {
    members:  newMembers,
    count:    newMembers.length,
    demandKw: perUnitKw * newMembers.length,
  }, { domain: 'electrical' });
  return { ok: true, dissolved: false };
}

// ──────────────────────────── Debug ─────────────────────────────────

if (typeof window !== 'undefined') {
  window.RaschetPOR = {
    getObjects, getObject, addObject, patchObject, removeObject,
    findByTag, subscribe, createRackPartial,
    canGroupTogether, createGroup, addMemberToGroup, removeMemberFromGroup, createGroupPartial,
    POR_DOMAINS, POR_DOMAIN_META, POR_TYPES, GROUP_ELECTRICAL_KEYS,
  };
}
