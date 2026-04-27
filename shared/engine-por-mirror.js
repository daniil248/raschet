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

import { state } from '../js/engine/state.js';
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

function isRackNode(n) {
  if (!n || n.type !== 'consumer') return false;
  return n.subtype === 'rack' || n.consumerKind === 'rack';
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

function patchPorFromNode(pid, oid, n) {
  // Top-level
  patchObject(pid, oid, { tag: n.tag || '', name: n.name || '' });
  // electrical
  patchObject(pid, oid, {
    demandKw: Number(n.demandKw) || 0,
    cosPhi:   Number(n.cosPhi)   || 0.95,
    phases:   Number(n.phases)   || 3,
    voltageV: Number(n.voltageV) || 400,
  }, { domain: 'electrical' });
  // mechanical
  patchObject(pid, oid, {
    widthMm:   Number(n.widthMm   || (n.geometryMm && n.geometryMm.widthMm)  || 600),
    depthMm:   Number(n.depthMm   || (n.geometryMm && n.geometryMm.depthMm)  || 800),
    heightMm:  Number(n.heightMm  || (n.geometryMm && n.geometryMm.heightMm) || 1991),
    rackUnits: Number(n.u || n.units || 42),
  }, { domain: 'mechanical' });
}

// ─── Engine → POR ────────────────────────────────────────────────────

function syncEngineToPOR() {
  if (!_activePid || _suppressSync) return;
  _suppressSync = true;
  try {
    // 1) Для каждого rack-узла без porObjectId — создаём POR-объект.
    // 2) Для каждого rack-узла с porObjectId — обновляем POR.
    // 3) Для POR-объектов type='rack' без соответствующего node — оставляем
    //    (могли прийти из rack-config / playground / другого модуля).
    const seenOids = new Set();
    for (const n of state.nodes.values()) {
      if (!isRackNode(n)) continue;
      if (n.porObjectId) {
        const obj = getObject(_activePid, n.porObjectId);
        if (obj) {
          patchPorFromNode(_activePid, n.porObjectId, n);
          seenOids.add(n.porObjectId);
        } else {
          // Объект исчез — пересоздаём.
          n.porObjectId = null;
        }
      }
      if (!n.porObjectId) {
        const partial = buildRackPartialFromNode(n);
        if (!partial) continue;
        const created = addObject(_activePid, partial);
        if (created) {
          n.porObjectId = created.id;
          seenOids.add(created.id);
        }
      }
    }
  } finally {
    _suppressSync = false;
  }
}

// ─── POR → Engine ────────────────────────────────────────────────────

function applyPorEvent(ev) {
  if (!_activePid || _suppressSync) return;
  if (ev.source === 'local') return;  // локальные события (этот же таб) уже отражены
  // Find engine node linked to this POR object (by porObjectId match)
  const oid = ev.oid || (ev.object && ev.object.id) || (ev.before && ev.before.id);
  if (!oid) {
    // sync-event (другой таб переписал store) — пройдёмся по всем узлам.
    refreshAllNodesFromPor();
    return;
  }
  const targetNode = [...state.nodes.values()].find(n => n.porObjectId === oid);
  if (!targetNode) return;
  if (ev.kind === 'remove') {
    // Не удаляем engine-узел автоматически (decision: пользователь сам
    // решает). Снимаем линк.
    targetNode.porObjectId = null;
    return;
  }
  const obj = ev.after || ev.object || getObject(_activePid, oid);
  if (!obj) return;
  _suppressSync = true;
  try {
    if (applyPorToNode(targetNode, obj)) {
      // Запускаем render через Raschet.rerender (если доступен).
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
  syncEngineToPOR();
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
  window.RaschetEnginePorMirror = { enableEngineMirror, disableEngineMirror, getEngineMirrorPid };
}
