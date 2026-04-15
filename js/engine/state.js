// ================= State =================
// Модель страниц:
//  state.pages = [{ id, name, type: 'independent'|'linked', view: {x,y,zoom} }]
//  state.currentPageId — активная страница
//  У каждого node и conn есть поле pageIds: string[] — на каких страницах он виден.
//    'independent' страница: новые узлы получают [pageId] — видны только здесь.
//    'linked' страница: узлы могут быть из других страниц (добавляются в pageIds существующих узлов).
//  Рендер фильтрует узлы/связи по currentPageId.
export const state = {
  nodes: new Map(),
  conns: new Map(),
  pages: [],              // массив страниц
  currentPageId: null,    // id активной страницы
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

// ===== Helpers для работы со страницами =====
export function ensureDefaultPage() {
  if (!state.pages || !state.pages.length) {
    const p = { id: 'p1', name: 'Страница 1', type: 'independent', view: { x: 0, y: 0, zoom: 1 } };
    state.pages = [p];
    state.currentPageId = p.id;
  }
  if (!state.currentPageId || !state.pages.find(p => p.id === state.currentPageId)) {
    state.currentPageId = state.pages[0].id;
  }
}
export function getCurrentPage() {
  return state.pages.find(p => p.id === state.currentPageId) || null;
}
// Виден ли node/conn на текущей странице (проверка по pageIds).
// Если pageIds отсутствует — считаем что узел на всех страницах (legacy-миграция).
export function isOnCurrentPage(obj) {
  if (!obj) return false;
  const pids = obj.pageIds;
  if (!Array.isArray(pids) || pids.length === 0) return true;
  return pids.includes(state.currentPageId);
}
// Следующий свободный id страницы
export function nextPageId() {
  let k = 1;
  const used = new Set((state.pages || []).map(p => p.id));
  while (used.has('p' + k)) k++;
  return 'p' + k;
}

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
export let svg, layerZones, layerConns, layerNodes, layerOver, inspectorBody, statsEl, modesListEl;

export function initDOM() {
  svg           = document.getElementById('canvas');
  layerZones    = document.getElementById('layer-zones');
  layerConns    = document.getElementById('layer-conns');
  layerNodes    = document.getElementById('layer-nodes');
  layerOver     = document.getElementById('layer-overlay');
  inspectorBody = document.getElementById('inspector-body');
  statsEl       = document.getElementById('stats');
  modesListEl   = document.getElementById('modes-list');
}
