// ======================================================================
// shared/engine-por-mirror.js
// Engine ↔ POR двусторонний mirror.
//
// При создании/изменении в engine схеме узлов type='consumer' с
// subtype='rack' (или consumerKind='rack') — автоматически зеркалируется
// POR-объект type='rack' с соответствующими доменами (electrical/
// mechanical). Когда POR-объект меняется (например из POR Playground
// или из rack-config), engine получает обновление и применяет к узлу.
//
// Связка через node.porObjectId: храним POR-id в самом engine-узле.
// Это переживает reload и сериализацию.
//
// АКТИВАЦИЯ: вызывать enableEngineMirror(pid) после загрузки engine.
// Если pid не задан — mirror не активен (engine работает как раньше).
// Удобнее всего звать из project-bootstrap.js или из main.js при
// открытии проекта.
// ======================================================================

import { state, uid as engineUid } from '../js/engine/state.js';
import { addChangeListener } from '../js/engine/state.js';
import {
  getObject, getObjects, addObject, patchObject, removeObject, subscribe as porSubscribe,
} from './por.js';
import { getPorType } from './por-types/index.js';

let _activePid = null;
let _unsubChange = null;
let _unsubPor   = null;
let _suppressSync = false;          // защита от рекурсии (engine → POR → engine)

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Маппинг engine consumer-узла → POR-type/subtype.
 *
 * Distributed системы (нет geometric footprint) → POR type='consumer-system'
 * с subtype отражающим вид:
 *   lighting       → освещение
 *   pipe-heating   → обогрев трубопроводов
 *   plinth-heating → плинтусный/тёплый пол
 *   ventilation    → электр. часть вентиляции
 *   outlets        → розеточная сеть
 *
 * Discrete объекты с габаритом:
 *   rack           → POR type='rack' (полноценный stand)
 *
 * Прочее (motor, hvac-unit, generic consumer без subtype) пока не
 * мигрируем в POR — оставляем как обычные engine-узлы. Когда придёт
 * соответствующий POR-type ('hvac-unit', 'motor') — добавим маппинг.
 */
const SYSTEM_SUBTYPES = new Set(['lighting', 'pipe-heating', 'plinth-heating', 'ventilation', 'outlets', 'snow-melting', 'heater']);

function _consumerSubtype(n) {
  return (n && (n.subtype || n.consumerKind)) || '';
}

function _porMapping(n) {
  if (!n || n.type !== 'consumer') return null;
  const sub = _consumerSubtype(n);
  if (sub === 'rack') return { porType: 'rack', porSubtype: '' };
  if (SYSTEM_SUBTYPES.has(sub)) {
    // 'heater' и 'pipe-heating' → один subtype в POR
    let s = sub;
    if (sub === 'heater') s = 'plinth-heating';
    return { porType: 'consumer-system', porSubtype: s };
  }
  return null; // прочее не зеркалируем
}

function isRackNode(n) {
  if (!n || n.type !== 'consumer') return false;
  return _consumerSubtype(n) === 'rack';
}

function isMirroredNode(n) {
  return _porMapping(n) != null;
}

function buildRackPartialFromNode(n) {
  const def = getPorType('rack');
  if (!def) return null;
  return def.factory({
    tag:       n.tag || '',
    name:      n.name || 'Стойка',
    demandKw:  Number(n.demandKw) || 0,
    cosPhi:    Number(n.cosPhi)   || 0.95,
    phases:    Number(n.phases)   || 3,
    voltageV:  Number(n.voltageV) || 400,
    widthMm:   Number(n.widthMm   || (n.geometryMm && n.geometryMm.widthMm)  || 600),
    depthMm:   Number(n.depthMm   || (n.geometryMm && n.geometryMm.depthMm)  || 800),
    heightMm:  Number(n.heightMm  || (n.geometryMm && n.geometryMm.heightMm) || 1991),
    rackUnits: Number(n.u || n.units || 42),
  });
}

function buildSystemPartialFromNode(n, porSubtype) {
  const def = getPorType('consumer-system');
  if (!def) return null;
  // composition зависит от subtype: для lighting — unitCount/unitPowerW.
  // PoC: пробрасываем что есть в node, factory заполнит дефолтами.
  return def.factory({
    subtype:   porSubtype,
    tag:       n.tag || '',
    name:      n.name || '',
    demandKw:  Number(n.demandKw) || 0,
    cosPhi:    Number(n.cosPhi)   || 0.95,
    phases:    Number(n.phases)   || 1,
    voltageV:  Number(n.voltageV) || 230,
    composition: n.composition || {},
  });
}

function applyPorToNode(n, obj) {
  if (!n || !obj) return false;
  let changed = false;
  const e = (obj.domains && obj.domains.electrical) || {};
  const m = (obj.domains && obj.domains.mechanical) || {};
  if (obj.tag       && n.tag      !== obj.tag)      { n.tag      = obj.tag;      changed = true; }
  if (obj.name      && n.name     !== obj.name)     { n.name     = obj.name;     changed = true; }
  if (e.demandKw    != null && n.demandKw  !== e.demandKw)  { n.demandKw  = e.demandKw;  changed = true; }
  if (e.cosPhi      != null && n.cosPhi    !== e.cosPhi)    { n.cosPhi    = e.cosPhi;    changed = true; }
  if (e.phases      != null && n.phases    !== e.phases)    { n.phases    = e.phases;    changed = true; }
  if (m.widthMm     != null && n.widthMm   !== m.widthMm)   { n.widthMm   = m.widthMm;   changed = true; }
  if (m.depthMm     != null && n.depthMm   !== m.depthMm)   { n.depthMm   = m.depthMm;   changed = true; }
  if (m.heightMm    != null && n.heightMm  !== m.heightMm)  { n.heightMm  = m.heightMm;  changed = true; }
  if (m.rackUnits   != null && (n.u || n.units) !== m.rackUnits) { n.u = m.rackUnits; changed = true; }
  return changed;
}

function patchPorFromNode(pid, oid, n, mapping) {
  patchObject(pid, oid, { tag: n.tag || '', name: n.name || '' });
  // electrical — для всех типов
  patchObject(pid, oid, {
    demandKw: Number(n.demandKw) || 0,
    cosPhi:   Number(n.cosPhi)   || 0.95,
    phases:   Number(n.phases)   || (mapping.porType === 'rack' ? 3 : 1),
    voltageV: Number(n.voltageV) || (mapping.porType === 'rack' ? 400 : 230),
  }, { domain: 'electrical' });
  // mechanical — только для rack (системы без габарита).
  if (mapping.porType === 'rack') {
    patchObject(pid, oid, {
      widthMm:   Number(n.widthMm   || (n.geometryMm && n.geometryMm.widthMm)  || 600),
      depthMm:   Number(n.depthMm   || (n.geometryMm && n.geometryMm.depthMm)  || 800),
      heightMm:  Number(n.heightMm  || (n.geometryMm && n.geometryMm.heightMm) || 1991),
      rackUnits: Number(n.u || n.units || 42),
    }, { domain: 'mechanical' });
  }
}

// ─── Engine → POR ────────────────────────────────────────────────────

function syncEngineToPOR() {
  if (!_activePid || _suppressSync) return;
  _suppressSync = true;
  let created = 0, updated = 0;
  try {
    // Обходим все consumer-узлы; для тех что мапятся в POR (rack ИЛИ
    // distributed system) — upsert. Прочие игнорируем.
    const seenOids = new Set();
    for (const n of state.nodes.values()) {
      const mapping = _porMapping(n);
      if (!mapping) continue;
      if (n.porObjectId) {
        const obj = getObject(_activePid, n.porObjectId);
        if (obj) {
          patchPorFromNode(_activePid, n.porObjectId, n, mapping);
          seenOids.add(n.porObjectId);
          updated++;
        } else {
          n.porObjectId = null;
        }
      }
      if (!n.porObjectId) {
        const partial = (mapping.porType === 'rack')
          ? buildRackPartialFromNode(n)
          : buildSystemPartialFromNode(n, mapping.porSubtype);
        if (!partial) continue;
        const createdObj = addObject(_activePid, partial);
        if (createdObj) {
          n.porObjectId = createdObj.id;
          seenOids.add(createdObj.id);
          created++;
          console.info(`[engine-por-mirror] created POR ${mapping.porType}${mapping.porSubtype?'/'+mapping.porSubtype:''} ${createdObj.id} for engine node ${n.id} (${n.tag || ''})`);
        }
      }
    }
    if (created || updated) {
      console.debug(`[engine-por-mirror] sync: +${created} ~${updated}`);
    }
  } finally {
    _suppressSync = false;
  }
}

// ─── POR → Engine ────────────────────────────────────────────────────

function applyPorEvent(ev) {
  if (!_activePid || _suppressSync) return;
  if (ev.source === 'local') return;  // локальные события (этот же таб) уже отражены
  const oid = ev.oid || (ev.object && ev.object.id) || (ev.before && ev.before.id);
  if (!oid) {
    // sync-event (другой таб переписал store) — pull новых racks + refresh.
    pullPorRacksToEngine();
    refreshAllNodesFromPor();
    return;
  }
  const targetNode = [...state.nodes.values()].find(n => n.porObjectId === oid);
  if (ev.kind === 'remove') {
    if (targetNode) {
      // Не удаляем engine-узел автоматически (decision: пользователь сам
      // решает). Снимаем линк.
      targetNode.porObjectId = null;
    }
    return;
  }
  if (!targetNode) {
    // POR add/patch для НОВОГО объекта (не было engine-узла) → pull.
    if (ev.kind === 'add') {
      pullPorRacksToEngine();
    }
    return;
  }
  const obj = ev.after || ev.object || getObject(_activePid, oid);
  if (!obj) return;
  _suppressSync = true;
  try {
    if (applyPorToNode(targetNode, obj)) {
      if (typeof window !== 'undefined' && window.Raschet) {
        try { window.Raschet.rerender && window.Raschet.rerender(); } catch {}
      }
    }
  } finally {
    _suppressSync = false;
  }
}

function refreshAllNodesFromPor() {
  if (!_activePid) return;
  _suppressSync = true;
  try {
    let anyChanged = false;
    for (const n of state.nodes.values()) {
      if (!isRackNode(n) || !n.porObjectId) continue;
      const obj = getObject(_activePid, n.porObjectId);
      if (!obj) { n.porObjectId = null; continue; }
      if (applyPorToNode(n, obj)) anyChanged = true;
    }
    if (anyChanged && typeof window !== 'undefined' && window.Raschet) {
      try { window.Raschet.rerender && window.Raschet.rerender(); } catch {}
    }
  } finally {
    _suppressSync = false;
  }
}

/**
 * POR → Engine pull: если POR-объект type='rack' существует, но в engine
 * нет узла с этим porObjectId — создаём UNPLACED engine-узел (pageIds=[]).
 * Он появится в инспекторе во вкладке «Неразмещённые», и main-инженер
 * сможет drag-and-drop поместить его на схему.
 *
 * Запускается:
 *   • При активации mirror'а (enableEngineMirror) — pull всего что есть.
 *   • При cross-tab sync-event — кто-то добавил rack в другом окне.
 *
 * Защита от рекурсии: _suppressSync, как у syncEngineToPOR.
 */
function pullPorRacksToEngine() {
  if (!_activePid || _suppressSync) return 0;
  _suppressSync = true;
  let pulled = 0;
  try {
    const porRacks = getObjects(_activePid, { type: 'rack' }) || [];
    if (!porRacks.length) return 0;
    const linkedOids = new Set();
    for (const n of state.nodes.values()) {
      if (n.porObjectId) linkedOids.add(n.porObjectId);
    }
    for (const obj of porRacks) {
      if (linkedOids.has(obj.id)) continue;
      const m = (obj.domains && obj.domains.mechanical) || {};
      const e = (obj.domains && obj.domains.electrical) || {};
      const nid = engineUid('n');
      const node = {
        id: nid,
        type: 'consumer',
        subtype: 'rack',
        consumerKind: 'rack',
        tag:        obj.tag      || '',
        name:       obj.name     || 'Стойка',
        demandKw:   Number(e.demandKw)  || 0,
        cosPhi:     Number(e.cosPhi)    || 0.95,
        phases:     Number(e.phases)    || 3,
        voltageV:   Number(e.voltageV)  || 400,
        widthMm:    Number(m.widthMm)   || 600,
        depthMm:    Number(m.depthMm)   || 800,
        heightMm:   Number(m.heightMm)  || 1991,
        u:          Number(m.rackUnits) || 42,
        x: 0, y: 0,
        pageIds: [],          // ← unplaced (см. js/engine/state.js::isOnCurrentPage)
        inputs: 1, outputs: 0,
        porObjectId: obj.id,  // линк к POR-объекту
      };
      state.nodes.set(nid, node);
      pulled++;
      console.info(`[engine-por-mirror] pulled POR rack ${obj.id} (${obj.tag||''}) → unplaced engine node ${nid}`);
    }
    if (pulled > 0 && typeof window !== 'undefined' && window.Raschet) {
      try { window.Raschet.rerender && window.Raschet.rerender(); } catch {}
    }
  } catch (e) { console.warn('[engine-por-mirror] pull failed:', e); }
  finally { _suppressSync = false; }
  return pulled;
}

// ─── Public API ──────────────────────────────────────────────────────

export function enableEngineMirror(pid) {
  if (!pid) return;
  if (_activePid === pid && _unsubChange) return;  // уже активен
  disableEngineMirror();
  _activePid = pid;
  // Engine → POR на каждое изменение.
  _unsubChange = addChangeListener(syncEngineToPOR);
  // POR → Engine на cross-tab события.
  _unsubPor = porSubscribe(pid, applyPorEvent);
  // Начальная синхронизация: текущая schema → POR.
  const all = [...state.nodes.values()];
  const initialRacks = all.filter(isRackNode).length;
  const initialSystems = all.filter(n => {
    const mp = _porMapping(n); return mp && mp.porType === 'consumer-system';
  }).length;
  syncEngineToPOR();
  // Pull: POR-объекты type='rack' без engine-узла → unplaced engine-узлы.
  const pulled = pullPorRacksToEngine();
  console.info(`[engine-por-mirror] activated for pid=${pid} (rack-узлов: ${initialRacks}, систем: ${initialSystems}, pulled из POR: ${pulled})`);
  if (typeof window !== 'undefined') {
    window.__engine_por_mirror_pid = pid;
  }
}

export function disableEngineMirror() {
  if (_unsubChange) { try { _unsubChange(); } catch {} _unsubChange = null; }
  if (_unsubPor)    { try { _unsubPor();    } catch {} _unsubPor    = null; }
  _activePid = null;
  if (typeof window !== 'undefined') delete window.__engine_por_mirror_pid;
}

export function getEngineMirrorPid() { return _activePid; }

if (typeof window !== 'undefined') {
  window.RaschetEnginePorMirror = {
    enableEngineMirror, disableEngineMirror, getEngineMirrorPid,
    pullPorRacksToEngine, syncEngineToPOR,
  };
}
