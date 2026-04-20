// ================= State =================
// Модель страниц:
//  state.pages = [{ id, name, type: 'independent'|'linked',
//                   kind: 'schematic'|'layout'|'mechanical'|'low-voltage'|'data'|'3d',
//                   view: {x,y,zoom} }]
//  state.currentPageId — активная страница
//  У каждого node и conn есть поле pageIds: string[] — на каких страницах он виден.
//    'independent' страница: новые узлы получают [pageId] — видны только здесь.
//    'linked' страница: узлы могут быть из других страниц (добавляются в pageIds существующих узлов).
//  Рендер фильтрует узлы/связи по currentPageId.
//
// v0.57.93 (Phase 2.1): page.kind — представление страницы. 'schematic'
// (принципиалка, по умолчанию) — полный функционал текущего редактора;
// layout/mechanical/... вводятся постепенно в Фазах 2.2-2.5 и пока
// рендерятся как schematic с бейджем «бета-вид».

// Виды страниц (Phase 2.1). PAGE_KINDS_META — иконка + label + описание
// для UI. Порядок задаёт порядок в меню выбора типа.
export const PAGE_KINDS_META = {
  'schematic':   { label: 'Принципиальная',    icon: '⚡', desc: 'Электрическая схема (текущий редактор)' },
  'layout':      { label: 'Схема расположения', icon: '📐', desc: 'Физическая расстановка оборудования (мм) — Фаза 2.3' },
  'mechanical':  { label: 'Механика',          icon: '⚙',  desc: 'Трубопроводы, вентиляция, каркасы — Фаза 2.5' },
  'low-voltage': { label: 'Слаботочка',        icon: '📡', desc: 'Связь, СКС, пожарная сигнализация' },
  'data':        { label: 'Данные',            icon: '🗂', desc: 'Информационные соединения (logical только)' },
  '3d':          { label: '3D',                icon: '🧊', desc: 'Трёхмерное представление — Фаза 4' },
};
export const PAGE_KINDS = Object.keys(PAGE_KINDS_META);
export function getPageKind(p) {
  if (!p) return 'schematic';
  return PAGE_KINDS.includes(p.kind) ? p.kind : 'schematic';
}
export const state = {
  nodes: new Map(),
  conns: new Map(),
  pages: [],              // массив страниц
  currentPageId: null,    // id активной страницы
  // Параметры проекта (идут в шапку отчёта)
  project: {
    designation: '',      // обозначение (шифр) проекта
    name: '',             // наименование проекта
    customer: '',         // заказчик
    object: '',           // объект / адрес
    stage: '',            // стадия (П / РД / ...)
    author: '',           // ГИП / исполнитель
    description: '',      // общее описание
  },
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

// Валидация view — гарантирует конечные числа и минимальный zoom.
// Спасает от случаев когда проект был сохранён с повреждённым view
// (например {}, {x,y} без zoom, или zoom = 0 / NaN / Infinity).
export function sanitizeView(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const x = Number.isFinite(src.x) ? src.x : 0;
  const y = Number.isFinite(src.y) ? src.y : 0;
  let zoom = Number(src.zoom);
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
  // Соблюдаем границы зума как в wheel-обработчике
  if (zoom < 0.2) zoom = 0.2;
  if (zoom > 4) zoom = 4;
  return { x, y, zoom };
}

// ===== Helpers для работы со страницами =====
export function ensureDefaultPage() {
  if (!state.pages || !state.pages.length) {
    const p = { id: 'p1', name: 'Страница 1', type: 'independent', kind: 'schematic', view: { x: 0, y: 0, zoom: 1 } };
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
// Phase 2.3 (v0.58.3): per-page positions.
// Каждая карточка может иметь разное расположение на разных страницах
// (например, schematic vs layout vs mechanical). Общие данные (имя,
// параметры, связи) остаются в одном месте — меняется только x/y.
//
// Механизм: при переключении страниц
//   - текущие n.x/n.y сохраняются в n.positionsByPage[oldPageId]
//   - из n.positionsByPage[newPageId] загружается позиция для новой
//     страницы; если записи нет — n.x/n.y остаются как были (каждая
//     новая страница "наследует" дефолтную позицию при первом визите).
//
// Во время drag никакого кода менять не нужно — он пишет в n.x/n.y
// как раньше. Сохранение в positionsByPage происходит только в момент
// смены страницы (и при serialize).
export function saveCurrentPagePositions(pageId) {
  if (!pageId) return;
  for (const n of state.nodes.values()) {
    if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
    if (!n.positionsByPage) n.positionsByPage = {};
    n.positionsByPage[pageId] = { x: n.x, y: n.y };
  }
}
export function loadPagePositions(pageId) {
  if (!pageId) return;
  for (const n of state.nodes.values()) {
    const pos = n.positionsByPage && n.positionsByPage[pageId];
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      n.x = pos.x;
      n.y = pos.y;
    }
    // если записи нет — n.x/n.y не трогаем (остаются от предыдущей
    // страницы как дефолт для первого визита этой страницы).
  }
}

// Следующий свободный id страницы
export function nextPageId() {
  let k = 1;
  const used = new Set((state.pages || []).map(p => p.id));
  while (used.has('p' + k)) k++;
  return 'p' + k;
}
// Вернуть home-страницу узла. Home = первая INDEPENDENT страница в pageIds.
// Если ни одной нет — считаем что home = первая страница из pageIds.
export function nodeHomePageId(node) {
  const pids = Array.isArray(node?.pageIds) ? node.pageIds : [];
  if (!pids.length) return null;
  for (const pid of pids) {
    const p = (state.pages || []).find(pp => pp.id === pid);
    if (p && p.type !== 'linked') return pid;
  }
  // Если нет independent — берём sourcePageId первой linked
  for (const pid of pids) {
    const p = (state.pages || []).find(pp => pp.id === pid);
    if (p && p.type === 'linked' && p.sourcePageId) return p.sourcePageId;
  }
  return pids[0];
}
// Список страниц, на которые МОЖНО поместить узел (home + linked-потомки home).
export function pagesForNode(node) {
  const home = nodeHomePageId(node);
  if (!home) return state.pages || [];
  const res = [];
  for (const p of (state.pages || [])) {
    if (p.id === home) res.push(p);
    else if (p.type === 'linked' && p.sourcePageId === home) res.push(p);
  }
  return res;
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
