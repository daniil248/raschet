// ================= State =================
export const state = {
  nodes: new Map(),
  conns: new Map(),
  modes: [],
  activeModeId: null,
  selectedKind: null,
  selectedId: null,
  view: { x: 0, y: 0, zoom: 1 },
  // linksOverride: null — нормальный вид (по настройке линии), 'all-links' — все скрыть, 'all-lines' — все показать
  linksOverride: null,
  pending: null,     // { fromNodeId, fromPort, mouseX, mouseY, restoreConn? }
  drag: null,        // { nodeId, dx, dy } | { pan, sx, sy, vx, vy }
  readOnly: false,   // read-only view
  selection: new Set(), // multi-selection: Set<nodeId>
  rubberBand: null,    // { sx, sy, ex, ey }
};

// ================= UID generator =================
let _idSeq = 1;
export const uid = (p = 'n') => `${p}${_idSeq++}`;
export function getIdSeq() { return _idSeq; }
export function setIdSeq(v) { _idSeq = v; }

// ================= Change callback =================
let _changeCb = null;
export function setChangeCb(cb) { _changeCb = cb; }
export function getChangeCb() { return _changeCb; }

// ================= DOM refs (lazy) =================
export let svg, layerConns, layerNodes, layerOver, inspectorBody, statsEl, modesListEl;

export function initDOM() {
  svg           = document.getElementById('canvas');
  layerConns    = document.getElementById('layer-conns');
  layerNodes    = document.getElementById('layer-nodes');
  layerOver     = document.getElementById('layer-overlay');
  inspectorBody = document.getElementById('inspector-body');
  statsEl       = document.getElementById('stats');
  modesListEl   = document.getElementById('modes-list');
}
