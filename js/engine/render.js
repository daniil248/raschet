import { state } from './state.js';
import { svg, layerZones, layerConns, layerNodes, layerOver, statsEl, modesListEl, isOnCurrentPage, sanitizeView } from './state.js';
import { NODE_H, SVG_NS, CHANNEL_TYPES, INSTALL_METHODS, PORT_R, GLOBAL, CONSUMER_CATALOG, BREAKER_TYPES } from './constants.js';

// IEC installation method → legacy CHANNEL_TYPES key (для иконок/лейблов)
const INSTALL_TO_CHANNEL_KEY = {
  A1: 'insulated_conduit', A2: 'insulated_cable',
  B1: 'conduit',           B2: 'tray_solid',
  C:  'wall',
  E:  'tray_perf',         F:  'tray_ladder',
  G:  'air_spaced',
  D1: 'ground',            D2: 'ground_direct',
};
function resolveChannelKey(n) {
  if (n && n.installMethod && INSTALL_TO_CHANNEL_KEY[n.installMethod]) {
    return INSTALL_TO_CHANNEL_KEY[n.installMethod];
  }
  return (n && n.channelType) || 'conduit';
}
function resolveChannelLabel(n) {
  if (n && n.installMethod && INSTALL_METHODS[n.installMethod]) {
    return INSTALL_METHODS[n.installMethod].label;
  }
  return (CHANNEL_TYPES[n && n.channelType] || CHANNEL_TYPES.conduit).label;
}
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight, portPos } from './geometry.js';
import { effectiveOn, selectMode, deleteMode } from './modes.js';
import { recalc } from './recalc.js';
import { effectiveTag } from './zones.js';
import { fmt, fmtPower, escHtml, escAttr } from './utils.js';
import { snapshot, notifyChange } from './history.js';
import { computeCurrentA, nodeVoltage, isThreePhase, cableVoltageClass, consumerTotalDemandKw, consumerCountEffective } from './electrical.js';

let _renderInspector;
export function bindRenderDeps({ renderInspector }) { _renderInspector = renderInspector; }

export function updateViewBox() {
  const W = svg.clientWidth, H = svg.clientHeight;
  // Дефенсивно санитируем state.view: если за время жизни сессии
  // что-то сделало zoom/x/y невалидными (NaN / Infinity / undefined),
  // нормализуем тут чтобы не ломать SVG атрибуты.
  const safe = sanitizeView(state.view);
  if (state.view.x !== safe.x || state.view.y !== safe.y || state.view.zoom !== safe.zoom) {
    state.view.x = safe.x; state.view.y = safe.y; state.view.zoom = safe.zoom;
  }
  const vw = W / safe.zoom;
  const vh = H / safe.zoom;
  svg.setAttribute('viewBox', `${safe.x} ${safe.y} ${vw} ${vh}`);
  const bg = document.getElementById('bg');
  if (bg) {
    bg.setAttribute('x', safe.x);
    bg.setAttribute('y', safe.y);
    bg.setAttribute('width', vw);
    bg.setAttribute('height', vh);
  }
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) e.appendChild(c);
  return e;
}
export function text(x, y, str, cls) {
  const t = el('text', { x, y, class: cls });
  t.textContent = str;
  return t;
}
export function bezier(a, b, opts) {
  const aDir = opts?.aDir || { x: 0, y: 1 };
  const bDir = opts?.bDir || { x: 0, y: -1 };
  const dist = Math.max(25, Math.hypot(b.x - a.x, b.y - a.y) / 4);
  const cp1x = a.x + aDir.x * dist;
  const cp1y = a.y + aDir.y * dist;
  const cp2x = b.x + bDir.x * dist;
  const cp2y = b.y + bDir.y * dist;
  return `M${a.x},${a.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${b.x},${b.y}`;
}

// opts: { aDir: {x,y}, bDir: {x,y} }
export function splinePath(a, points, b, opts) {
  if (!points || points.length === 0) return bezier(a, b, opts);
  const pts = [a, ...points, b];
  const last = pts.length - 1;
  const T = 0.10; // натяжение Catmull-Rom (меньше = плотнее кривые)
  const STUB = 25; // длина перпендикулярного участка у порта
  const aDir = opts?.aDir || { x: 0, y: 1 };
  const bDir = opts?.bDir || { x: 0, y: -1 };
  let d = `M${a.x},${a.y}`;

  for (let i = 0; i < last; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    let cp1x, cp1y, cp2x, cp2y;

    if (i === 0) {
      const stub = Math.min(STUB, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3 || STUB);
      cp1x = p1.x + aDir.x * stub;
      cp1y = p1.y + aDir.y * stub;
    } else {
      const p0 = pts[i - 1];
      cp1x = p1.x + (p2.x - p0.x) * T;
      cp1y = p1.y + (p2.y - p0.y) * T;
    }

    // --- cp2: касательная ВХОДА в p2 ---
    if (i === last - 1) {
      // В input-порт: направление bDir
      const stub = Math.min(STUB, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3 || STUB);
      cp2x = p2.x + bDir.x * stub;
      cp2y = p2.y + bDir.y * stub;
    } else {
      const p3 = pts[i + 2];
      cp2x = p2.x - (p3.x - p1.x) * T;
      cp2y = p2.y - (p3.y - p1.y) * T;
    }

    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

// Средняя точка пути по длине дуги ломаной [a, ...points, b].
// Это хорошая аппроксимация середины сплайна, и она следует за waypoints.
export function pathMidpoint(a, points, b) {
  const pts = [a, ...(points || []), b];
  // Общая длина
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    segs.push(len);
    total += len;
  }
  if (total === 0) return { x: a.x, y: a.y };
  const half = total / 2;
  // Идём по сегментам, пока не накопится половина длины
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= half) {
      const t = segs[i] > 0 ? (half - acc) / segs[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segs[i];
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

// Иконки потребителей по consumerSubtype — рисуем в заданную <g> группу
// с локальными координатами (0,0) = центр иконки. Размер базовый ~22px.
// Цвет берём из текущей темы — #546e7a.
function drawConsumerIconTo(g, subtype, color = '#546e7a') {
  const mk = (tag, attrs) => el(tag, Object.assign({ class: 'node-icon' }, attrs));
  switch (subtype) {
    case 'lighting': {
      // Лампочка: круг + маленькая «колба»
      g.appendChild(mk('circle', { cx: 0, cy: -1, r: 7, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -3, y1: 7, x2: 3, y2: 7, stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -2, y1: 9, x2: 2, y2: 9, stroke: color, 'stroke-width': 1.5 }));
      break;
    }
    case 'socket': {
      // Розетка: скруглённый квадрат + две дырки
      g.appendChild(mk('rect', { x: -9, y: -8, width: 18, height: 16, rx: 3, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('circle', { cx: -4, cy: 0, r: 1.8, fill: color }));
      g.appendChild(mk('circle', { cx:  4, cy: 0, r: 1.8, fill: color }));
      break;
    }
    case 'motor': {
      g.appendChild(mk('circle', { cx: 0, cy: 0, r: 9, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      const t = text(0, 4, 'M', 'node-icon-letter');
      t.style.fill = color;
      g.appendChild(t);
      break;
    }
    case 'pump': {
      g.appendChild(mk('circle', { cx: 0, cy: 0, r: 9, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      // Капля
      g.appendChild(mk('path', { d: 'M0,-5 C 4,0 4,4 0,5 C -4,4 -4,0 0,-5 Z', fill: color }));
      break;
    }
    case 'fan': {
      // Три лопасти — маленькие эллипсы вокруг центра
      for (let k = 0; k < 3; k++) {
        const a = (k * 2 * Math.PI) / 3;
        g.appendChild(mk('ellipse', {
          cx: Math.cos(a) * 4, cy: Math.sin(a) * 4,
          rx: 4, ry: 1.8, fill: color,
          transform: `rotate(${k * 120} ${Math.cos(a) * 4} ${Math.sin(a) * 4})`,
        }));
      }
      g.appendChild(mk('circle', { cx: 0, cy: 0, r: 1.5, fill: '#fff', stroke: color, 'stroke-width': 1 }));
      break;
    }
    case 'server': {
      // Серверная стойка: 3 горизонтальные планки
      g.appendChild(mk('rect', { x: -8, y: -9, width: 16, height: 18, rx: 1, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -5, y1: -4, x2: 5, y2: -4, stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -5, y1:  0, x2: 5, y2:  0, stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -5, y1:  4, x2: 5, y2:  4, stroke: color, 'stroke-width': 1.5 }));
      break;
    }
    case 'heater': {
      // Обогрев: волнистые линии
      g.appendChild(mk('path', { d: 'M-8,-4 Q -4,-8 0,-4 T 8,-4', fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('path', { d: 'M-8, 0 Q -4,-4 0, 0 T 8, 0', fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('path', { d: 'M-8, 4 Q -4, 0 0, 4 T 8, 4', fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      break;
    }
    case 'conditioner': {
      // Кондиционер: прямоугольник + 3 диагональных штриха
      g.appendChild(mk('rect', { x: -9, y: -5, width: 18, height: 10, rx: 2, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('line', { x1: -5, y1: -2, x2: -2, y2: 2, stroke: color, 'stroke-width': 1 }));
      g.appendChild(mk('line', { x1: -1, y1: -2, x2:  2, y2: 2, stroke: color, 'stroke-width': 1 }));
      g.appendChild(mk('line', { x1:  3, y1: -2, x2:  6, y2: 2, stroke: color, 'stroke-width': 1 }));
      break;
    }
    case 'elevator': {
      // Лифт: квадрат со стрелкой вверх и вниз
      g.appendChild(mk('rect', { x: -8, y: -9, width: 16, height: 18, rx: 1, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('path', { d: 'M-3,-2 L0,-6 L3,-2 Z', fill: color }));
      g.appendChild(mk('path', { d: 'M-3, 2 L0, 6 L3, 2 Z', fill: color }));
      break;
    }
    case 'outdoor_unit': {
      // Наружный блок: прямоугольник с решёткой
      g.appendChild(mk('rect', { x: -9, y: -7, width: 18, height: 14, rx: 2, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      g.appendChild(mk('circle', { cx: 0, cy: 0, r: 4, fill: 'none', stroke: color, 'stroke-width': 1 }));
      g.appendChild(mk('line', { x1: -4, y1: 0, x2: 4, y2: 0, stroke: color, 'stroke-width': 1 }));
      g.appendChild(mk('line', { x1: 0, y1: -4, x2: 0, y2: 4, stroke: color, 'stroke-width': 1 }));
      break;
    }
    default: {
      // custom / неизвестный: круг с вопросом
      g.appendChild(mk('circle', { cx: 0, cy: 0, r: 9, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      const t = text(0, 4, '?', 'node-icon-letter');
      t.style.fill = color;
      g.appendChild(t);
    }
  }
}

export function render() {
  recalc();
  renderConns();
  renderNodes();
  renderStats();
  renderModes();
  decorateRemoteLocks();
  renderRemoteCursors();
}

// v0.57.78 (Collaboration C.6): курсоры других участников сессии.
// Данные берутся из window.__remoteCursors = { uid: {x, y, pageId, name, photo, color} }.
// Рисует стрелку-треугольник + короткую подпись с именем рядом. Чужой
// курсор показывается только если он на текущей странице. Размер
// компенсируется zoom'ом, чтобы не раздувать при приближении.
// Отдельная функция экспортируется — main.js дёргает её при смене
// presence-снапшота без полного render()+recalc().
export function renderRemoteCursors() {
  if (!layerOver) return;
  let g = document.getElementById('layer-remote-cursors');
  if (g) g.parentNode?.removeChild(g);
  const cursors = (typeof window !== 'undefined' && window.__remoteCursors) || {};
  const uids = Object.keys(cursors);
  if (!uids.length) return;
  g = el('g', { id: 'layer-remote-cursors', 'pointer-events': 'none' });
  const zoom = (state?.view?.zoom > 0 ? state.view.zoom : 1);
  const inv = 1 / zoom;  // размер иконки не должен зависеть от zoom
  for (const uid of uids) {
    const c = cursors[uid];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    if (c.pageId && state?.currentPageId && c.pageId !== state.currentPageId) continue;
    const name = (c.name || c.email || '?').trim();
    const short = name.length > 14 ? name.slice(0, 14) + '…' : name;
    const hue = Math.abs([...(uid || name)].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360;
    const color = c.color || `hsl(${hue},65%,50%)`;
    const cg = el('g', { transform: `translate(${c.x},${c.y}) scale(${inv})` });
    // Стрелка-курсор (треугольник как системный pointer)
    cg.appendChild(el('path', {
      d: 'M0,0 L0,16 L4.5,12 L7,18 L10,16.5 L7.5,10.5 L13,10 Z',
      fill: color,
      stroke: '#fff', 'stroke-width': 1.2, 'stroke-linejoin': 'round',
    }));
    // Подпись с именем
    const labelW = Math.max(32, short.length * 6 + 10);
    const lg = el('g', { transform: 'translate(14, 14)' });
    lg.appendChild(el('rect', {
      x: 0, y: 0, width: labelW, height: 14, rx: 3,
      fill: color, stroke: '#fff', 'stroke-width': 0.8, opacity: 0.92,
    }));
    const t = el('text', { x: 5, y: 10, fill: '#fff', 'font-size': 9, 'font-weight': 600 });
    t.textContent = short;
    lg.appendChild(t);
    cg.appendChild(lg);
    g.appendChild(cg);
  }
  layerOver.appendChild(g);
}

// Оверлей для объектов, редактируемых другими участниками collab-сессии.
// Рисует пунктирную оранжевую рамку + бейдж с именем. Данные берутся из
// window.__remoteLocks (устанавливается main.js из subscribeLocks).
export function decorateRemoteLocks() {
  const locks = (typeof window !== 'undefined' && window.__remoteLocks) || {};
  const keys = Object.keys(locks);
  if (!keys.length) return;
  for (const key of keys) {
    const lock = locks[key];
    const owner = (lock.name || lock.email || '?').trim();
    const ownerShort = '🔒 ' + (owner.length > 12 ? owner.slice(0, 12) + '…' : owner);
    // v0.57.76: conn locks имеют ключ вида "conn:xxx"
    if (key.startsWith('conn:')) {
      const connId = key.slice(5);
      const c = state.conns.get(connId);
      if (!c) continue;
      const fromN = state.nodes.get(c.from?.nodeId);
      const toN = state.nodes.get(c.to?.nodeId);
      if (!fromN || !toN) continue;
      if (!isOnCurrentPage(fromN) && !isOnCurrentPage(toN)) continue;
      // Линия выделения связи — просто толстая пунктирная оверлей по центрам двух узлов.
      // Берём центры, чтобы не полагаться на роутинг (который может быть сложным).
      const fw = nodeWidth(fromN), fh = nodeHeight(fromN);
      const tw = nodeWidth(toN), th = nodeHeight(toN);
      const x1 = fromN.x + fw / 2, y1 = fromN.y + fh / 2;
      const x2 = toN.x + tw / 2, y2 = toN.y + th / 2;
      const overlay = el('g', {
        class: 'remote-lock-overlay remote-lock-conn',
        'pointer-events': 'none',
      });
      overlay.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: '#ff9800', 'stroke-width': 4, opacity: 0.35,
        'stroke-dasharray': '7 4',
      }));
      // Бейдж по середине
      const mx = (x1 + x2) / 2 - 48, my = (y1 + y2) / 2 - 7;
      const badge = el('g', { transform: `translate(${mx}, ${my})` });
      badge.appendChild(el('rect', { x: 0, y: 0, width: 96, height: 14, rx: 7,
        fill: '#ff9800', stroke: '#e65100', 'stroke-width': 0.5 }));
      const t = el('text', { x: 7, y: 10, fill: '#fff', 'font-size': 9, 'font-weight': 600 });
      t.textContent = ownerShort;
      badge.appendChild(t);
      overlay.appendChild(badge);
      layerNodes.appendChild(overlay);
      continue;
    }
    // Node-лок
    const n = state.nodes.get(key);
    if (!n || !isOnCurrentPage(n)) continue;
    const w = nodeWidth(n), h = nodeHeight(n);
    const overlay = el('g', {
      class: 'remote-lock-overlay',
      transform: `translate(${n.x},${n.y})`,
      'pointer-events': 'none',
    });
    overlay.appendChild(el('rect', {
      x: -3, y: -3, width: w + 6, height: h + 6, rx: 6,
      fill: 'none', stroke: '#ff9800', 'stroke-width': 2,
      'stroke-dasharray': '5 3',
    }));
    const badge = el('g', { transform: `translate(${Math.max(0, w - 96)}, ${-14})` });
    badge.appendChild(el('rect', {
      x: 0, y: 0, width: 96, height: 14, rx: 7,
      fill: '#ff9800', stroke: '#e65100', 'stroke-width': 0.5,
    }));
    const t = el('text', { x: 7, y: 10, fill: '#fff', 'font-size': 9, 'font-weight': 600 });
    t.textContent = ownerShort;
    badge.appendChild(t);
    overlay.appendChild(badge);
    layerNodes.appendChild(overlay);
  }
}

export function renderNodes() {
  while (layerNodes.firstChild) layerNodes.removeChild(layerNodes.firstChild);
  if (layerZones) while (layerZones.firstChild) layerZones.removeChild(layerZones.firstChild);

  // Санитация x/y всех узлов — если данные повреждены, заменяем на 0.
  // Предотвращает translate(NaN/Infinity/null) которые ломают SVG.
  for (const n of state.nodes.values()) {
    if (!Number.isFinite(n.x)) n.x = 0;
    if (!Number.isFinite(n.y)) n.y = 0;
  }

  // Зоны рендерим в ОТДЕЛЬНЫЙ слой layerZones — он ниже layerConns,
  // поэтому фон зоны не тонирует связи и подписи.
  const zoneParent = layerZones || layerNodes;
  for (const n of state.nodes.values()) {
    if (n.type !== 'zone') continue;
    if (!isOnCurrentPage(n)) continue;
    const w = nodeWidth(n), h = nodeHeight(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const g = el('g', {
      class: 'node zone' + (selected ? ' selected' : ''),
      transform: `translate(${n.x},${n.y})`,
    });
    g.dataset.nodeId = n.id;
    // Тело зоны — видимый, но не интерактивный фон
    g.appendChild(el('rect', {
      class: 'zone-body',
      x: 0, y: 0, width: w, height: h,
      fill: n.color || '#e3f2fd',
      'fill-opacity': 0.25,
    }));
    // Drag-handle — полоса 44px сверху, единственная кликабельная часть для перетаскивания
    g.appendChild(el('rect', {
      class: 'zone-drag-handle',
      x: 0, y: 0, width: w, height: 44,
    }));
    // Подпись: префикс зоны крупнее, имя ниже
    g.appendChild(text(12, 22, n.zonePrefix || n.tag || '', 'zone-prefix'));
    g.appendChild(text(12, 40, n.name || '', 'zone-name'));
    // Зоны ресайза — 4 стороны + 4 угла
    const rz = 8; // толщина зоны захвата
    // Стороны
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'n',  x: rz, y: -rz/2, width: w - rz*2, height: rz, style: 'cursor:ns-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 's',  x: rz, y: h - rz/2, width: w - rz*2, height: rz, style: 'cursor:ns-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'w',  x: -rz/2, y: rz, width: rz, height: h - rz*2, style: 'cursor:ew-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'e',  x: w - rz/2, y: rz, width: rz, height: h - rz*2, style: 'cursor:ew-resize' }));
    // Углы
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'nw', x: -rz/2, y: -rz/2, width: rz*2, height: rz*2, style: 'cursor:nwse-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'ne', x: w - rz*1.5, y: -rz/2, width: rz*2, height: rz*2, style: 'cursor:nesw-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'sw', x: -rz/2, y: h - rz*1.5, width: rz*2, height: rz*2, style: 'cursor:nesw-resize' }));
    g.appendChild(el('rect', { class: 'zone-resize', 'data-rz': 'se', x: w - rz*1.5, y: h - rz*1.5, width: rz*2, height: rz*2, style: 'cursor:nwse-resize' }));
    zoneParent.appendChild(g);
  }

  // Многосекционные щиты — обёртка-контейнер (рисуется как зона)
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
    if (!isOnCurrentPage(n)) continue;
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    if (!secIds.length) continue;
    // Вычисляем bounds по дочерним секциям
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sid of secIds) {
      const s = state.nodes.get(sid);
      if (!s) continue;
      const sw = nodeWidth(s), sh = nodeHeight(s);
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x + sw > maxX) maxX = s.x + sw;
      if (s.y + sh > maxY) maxY = s.y + sh;
    }
    const pad = 20;
    const wx = minX - pad, wy = minY - pad - 20;
    const ww = maxX - minX + pad * 2, wh = maxY - minY + pad * 2 + 20;
    n.x = wx; n.y = wy; n._wrapW = ww; n._wrapH = wh; // sync position & size
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const g = el('g', {
      class: 'node panel sectioned-wrapper' + (selected ? ' selected' : ''),
      transform: `translate(${wx},${wy})`,
    });
    g.dataset.nodeId = n.id;
    // Фон обёртки
    g.appendChild(el('rect', { x: 0, y: 0, width: ww, height: wh,
      fill: '#f3e5f5', 'fill-opacity': '0.3', stroke: '#9c27b0', 'stroke-width': selected ? 2 : 1,
      'stroke-dasharray': '6 3', rx: 8, 'pointer-events': 'none' }));
    // Заголовок
    const tag = effectiveTag(n) || n.tag || '';
    g.appendChild(text(8, 14, `${tag} ${n.name || ''}`, 'node-tag'));
    // СВ лампочки между секциями
    const busTies = Array.isArray(n.busTies) ? n.busTies : [];
    const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : busTies.map(t => !!t.closed);
    for (let ti = 0; ti < busTies.length; ti++) {
      const [siA, siB] = busTies[ti].between;
      const nodeA = state.nodes.get(secIds[siA]);
      const nodeB = state.nodes.get(secIds[siB]);
      if (!nodeA || !nodeB) continue;
      const ax = nodeA.x + nodeWidth(nodeA), ay = nodeA.y + nodeHeight(nodeA) / 2;
      const bx = nodeB.x, by = nodeB.y + nodeHeight(nodeB) / 2;
      const mx = (ax + bx) / 2 - wx, my = (ay + by) / 2 - wy;
      const tieOn = tieStates[ti];
      const col = tieOn ? '#4caf50' : '#e53935';
      g.appendChild(el('circle', { cx: mx, cy: my, r: 6, fill: col, stroke: '#fff', 'stroke-width': 1.5, opacity: 0.8 }));
      g.appendChild(el('line', { x1: ax - wx, y1: ay - wy, x2: mx - 6, y2: my, stroke: '#999', 'stroke-width': 1, 'stroke-dasharray': '3 2' }));
      g.appendChild(el('line', { x1: mx + 6, y1: my, x2: bx - wx, y2: by - wy, stroke: '#999', 'stroke-width': 1, 'stroke-dasharray': '3 2' }));
    }
    // Хэндл для перетаскивания (полоса сверху)
    g.appendChild(el('rect', { x: 0, y: 0, width: ww, height: 20,
      fill: 'transparent', style: 'cursor:move', class: 'zone-drag-handle' }));
    layerNodes.appendChild(g);
  }

  // Каналы в режиме трассы (trayMode) — рисуем как повёрнутые прямоугольники
  for (const n of state.nodes.values()) {
    if (n.type !== 'channel' || !n.trayMode) continue;
    if (!isOnCurrentPage(n)) continue;
    const tw = n.trayWidth || 40;
    const tl = (n.trayLength || 120); // длина пропорционально метрам
    const angle = n.trayAngle || 0;
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const cx = n.x + tw / 2;
    const cy = n.y + tl / 2;

    const g = el('g', {
      class: 'node channel' + (selected ? ' selected' : ''),
      transform: `translate(${n.x},${n.y}) rotate(${angle} ${tw/2} ${tl/2})`,
    });
    g.dataset.nodeId = n.id;
    // Тело трассы
    g.appendChild(el('rect', {
      class: 'node-body',
      x: 0, y: 0, width: tw, height: tl,
      fill: '#fff3e0', 'fill-opacity': '0.6',
      stroke: '#a1887f', 'stroke-width': selected ? 2.5 : 1.5,
      'stroke-dasharray': '6 3', rx: 4,
    }));
    // Метка
    const label = n.tag || n.name || 'CH';
    g.appendChild(text(tw / 2, tl / 2, label, 'node-tag'));
    // Центральный кружок — точка привязки для сплайнов
    g.appendChild(el('circle', {
      cx: tw / 2, cy: tl / 2, r: 6,
      fill: '#a1887f', 'fill-opacity': '0.3',
      stroke: '#a1887f', 'stroke-width': 1,
      class: 'channel-snap-point',
    }));
    // Рукоятка поворота — маленький кружок на торце трассы
    if (selected) {
      const rh = el('circle', {
        cx: tw / 2, cy: -8, r: 5,
        fill: '#ff9800', stroke: '#e65100', 'stroke-width': 1.5,
        class: 'channel-rotate-handle', cursor: 'grab',
      });
      rh.dataset.rotateNodeId = n.id;
      g.appendChild(rh);
      // Ручка изменения длины — внизу канала
      const lh = el('circle', {
        cx: tw / 2, cy: tl + 8, r: 5,
        fill: '#1976d2', stroke: '#0d47a1', 'stroke-width': 1.5,
        class: 'channel-length-handle', cursor: 'ns-resize',
      });
      lh.dataset.lengthNodeId = n.id;
      g.appendChild(lh);
    }
    layerNodes.appendChild(g);
  }

  // Utility — source с sourceSubtype='utility', рисуется стальной опорой-башней ЛЭП
  for (const n of state.nodes.values()) {
    if (!(n.type === 'source' && n.sourceSubtype === 'utility')) continue;
    if (!isOnCurrentPage(n)) continue;
    const w = nodeWidth(n), h = nodeHeight(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const g = el('g', {
      class: 'node source utility' + (selected ? ' selected' : ''),
      transform: `translate(${n.x},${n.y})`,
    });
    g.dataset.nodeId = n.id;
    // Прозрачная подложка для клика/драга
    g.appendChild(el('rect', {
      x: 0, y: 0, width: w, height: h,
      fill: 'transparent',
      stroke: selected ? '#2979ff' : 'none',
      'stroke-width': selected ? 2 : 0,
      'stroke-dasharray': selected ? '4 4' : '0',
      rx: 4,
    }));
    // === Стальная решётчатая опора-башня ===
    const cx = w / 2;
    // Класс напряжения по IEC рисуется НАД башней, поэтому оставляем место сверху.
    const topY = 22;                 // верх пирамидки (смещено вниз на 12px)
    const crossY = 34;               // нижний изолятор 1
    const crossY2 = 46;              // изолятор 2
    const crossY3 = 58;              // изолятор 3
    const baseY = h - 16;            // основание башни (низ контура)
    const halfTop = 8;               // ширина башни сверху
    const halfBase = 28;             // ширина у основания
    const stroke = '#455a64';

    // Контур башни — трапеция
    g.appendChild(el('path', {
      d: `M${cx - halfTop},${topY} L${cx + halfTop},${topY} L${cx + halfBase},${baseY} L${cx - halfBase},${baseY} Z`,
      fill: 'none', stroke, 'stroke-width': 2, class: 'node-icon',
    }));
    // Решётчатая диагональная структура внутри (X-кресты по высоте)
    const lattice = 5;
    for (let i = 0; i < lattice; i++) {
      const t1 = i / lattice;
      const t2 = (i + 1) / lattice;
      const y1 = topY + (baseY - topY) * t1;
      const y2 = topY + (baseY - topY) * t2;
      const hw1 = halfTop + (halfBase - halfTop) * t1;
      const hw2 = halfTop + (halfBase - halfTop) * t2;
      // Горизонтальные пояса
      g.appendChild(el('line', { x1: cx - hw1, y1, x2: cx + hw1, y2: y1, stroke, 'stroke-width': 1, class: 'node-icon' }));
      // Диагонали X
      g.appendChild(el('line', { x1: cx - hw1, y1, x2: cx + hw2, y2: y2, stroke, 'stroke-width': 0.8, class: 'node-icon' }));
      g.appendChild(el('line', { x1: cx + hw1, y1, x2: cx - hw2, y2: y2, stroke, 'stroke-width': 0.8, class: 'node-icon' }));
    }
    // Нижний пояс
    g.appendChild(el('line', { x1: cx - halfBase, y1: baseY, x2: cx + halfBase, y2: baseY, stroke, 'stroke-width': 1.5, class: 'node-icon' }));

    // Три перекладины с изоляторами (на вершине)
    const armW = 22;
    const armsY = [crossY, crossY2, crossY3];
    for (const ay of armsY) {
      g.appendChild(el('line', { x1: cx - armW, y1: ay, x2: cx + armW, y2: ay, stroke, 'stroke-width': 1.5, class: 'node-icon' }));
      // Изоляторы (свисают с концов перекладины)
      g.appendChild(el('line', { x1: cx - armW, y1: ay, x2: cx - armW, y2: ay + 4, stroke, 'stroke-width': 1, class: 'node-icon' }));
      g.appendChild(el('line', { x1: cx + armW, y1: ay, x2: cx + armW, y2: ay + 4, stroke, 'stroke-width': 1, class: 'node-icon' }));
      g.appendChild(el('circle', { cx: cx - armW, cy: ay + 5, r: 1.6, fill: '#90a4ae', class: 'node-icon' }));
      g.appendChild(el('circle', { cx: cx + armW, cy: ay + 5, r: 1.6, fill: '#90a4ae', class: 'node-icon' }));
    }

    // Провода от изоляторов вниз, сходящиеся к выходному порту
    const portX = cx, portY = h;
    for (const ay of armsY) {
      const sxL = cx - armW, sxR = cx + armW;
      const isoY = ay + 5;
      g.appendChild(el('path', {
        d: `M${sxL},${isoY} Q${(sxL + portX) / 2},${isoY + 20} ${portX},${portY}`,
        fill: 'none', stroke, 'stroke-width': 0.9, class: 'node-icon',
      }));
      g.appendChild(el('path', {
        d: `M${sxR},${isoY} Q${(sxR + portX) / 2},${isoY + 20} ${portX},${portY}`,
        fill: 'none', stroke, 'stroke-width': 0.9, class: 'node-icon',
      }));
    }

    // Класс напряжения по IEC 60502-2 — НАД башней (компактный серый текст)
    const uVal = nodeVoltage(n);
    const vClass = cableVoltageClass(uVal);
    const vt = text(cx, 12, vClass, 'node-sub');
    vt.setAttribute('text-anchor', 'middle');
    vt.setAttribute('style', 'font-size:9px;fill:#546e7a;font-weight:600');
    g.appendChild(vt);

    // Подпись TAG снизу (под башней)
    const tag = effectiveTag(n) || n.tag || '';
    if (tag) {
      const t = text(cx, h - 3, tag, 'node-tag');
      t.setAttribute('text-anchor', 'middle');
      g.appendChild(t);
    }
    // Выходной порт — внизу на оси башни (ровно по центру w)
    const outCirc = el('circle', { class: 'port out', cx: portX, cy: h, r: PORT_R });
    outCirc.dataset.portKind = 'out';
    outCirc.dataset.portIdx = 0;
    outCirc.dataset.nodeId = n.id;
    g.appendChild(outCirc);
    layerNodes.appendChild(g);
  }

  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    if (n.type === 'source' && n.sourceSubtype === 'utility') continue; // уже отрисован выше
    if (n.type === 'channel' && n.trayMode) continue;
    if (n.type === 'panel' && n.switchMode === 'sectioned') continue; // контейнер рисуется выше
    if (!isOnCurrentPage(n)) continue;
    const w = nodeWidth(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const cls = [
      'node', n.type,
      selected ? 'selected' : '',
      state.selection.has(n.id) ? 'multi-selected' : '',
      n._overload ? 'overload' : '',
      (!n._powered && (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups')) ? 'unpowered' : '',
      (n.type === 'ups' && n._onBattery) ? 'onbattery' : '',
      (n.type === 'ups' && n._onStaticBypass) ? 'onbypass' : '',
      (n.type === 'panel' && n.switchMode === 'manual') ? 'manual' : '',
      (n.type === 'panel' && n._marginWarn === 'undersize') ? 'undersize' : '',
      (n.type === 'panel' && n._marginWarn === 'oversize') ? 'oversize' : '',
    ].filter(Boolean).join(' ');

    const g = el('g', { class: cls, transform: `translate(${n.x},${n.y})` });
    g.dataset.nodeId = n.id;

    // Групповой потребитель — стопка карточек
    const isGroup = n.type === 'consumer' && (n.count || 1) > 1;
    const groupPeek = isGroup ? 24 : 0;
    if (isGroup) {
      const ox = 6, oy = groupPeek;
      // Нижняя карточка (полная высота, сдвинута вниз и вправо)
      g.appendChild(el('rect', {
        class: 'node-body group-back', x: ox, y: oy, width: w, height: NODE_H, rx: 6,
      }));
      // Текст группы на выступающей части — выровнен по правому краю.
      // Если задано распределение по фазам (результат балансировки для
      // параллельной 1ф группы) — дописываем A/B/C-счётчики.
      const totalKw = consumerTotalDemandKw(n);
      const cntEff = consumerCountEffective(n);
      // v0.57.81: для «индивидуальной» группы подпись Σ (N kW, M шт)
      // потому что мощности разные. Для uniform — старый формат N × P = T.
      let gLabel = (n.groupMode === 'individual' && Array.isArray(n.items))
        ? `Σ ${fmtPower(totalKw)} (${cntEff} шт.)`
        : `${n.count || 1} × ${fmtPower(n.demandKw)} = ${fmtPower(totalKw)}`;
      if (n.phaseDistribution && !n.serialMode) {
        const pd = n.phaseDistribution;
        gLabel += `  · A${pd.A || 0}/B${pd.B || 0}/C${pd.C || 0}`;
      }
      const gt = text(w + ox - 8, NODE_H + oy - 6, gLabel, 'node-load');
      gt.setAttribute('text-anchor', 'end');
      g.appendChild(gt);
    }
    // Верхняя карточка (основная, полностью непрозрачная)
    g.appendChild(el('rect', { class: 'node-body', x: 0, y: 0, width: w, height: NODE_H }));

    // Обозначение — с учётом префикса зоны («P1.MPB1»)
    const displayTag = effectiveTag(n);
    if (displayTag) g.appendChild(text(12, 16, displayTag, 'node-tag'));

    // Имя
    g.appendChild(text(12, 33, n.name || '(без имени)', 'node-title'));

    // Иконка потребителя по подтипу — в правом верхнем углу карточки.
    // Для группы с serialMode — дополнительно ряд мелких иконок вдоль нижнего края.
    if (n.type === 'consumer' && GLOBAL.showConsumerIcons !== false) {
      const iconG = el('g', { transform: `translate(${w - 22},16)`, class: 'node-icon' });
      drawConsumerIconTo(iconG, n.consumerSubtype || 'custom');
      g.appendChild(iconG);
      // Serial-mode: нарисовать ряд мелких иконок по низу карточки
      const count = Math.max(1, Number(n.count) || 1);
      if (n.serialMode && count > 1) {
        const maxShown = Math.min(count, 6);
        const step = Math.min(22, (w - 24) / maxShown);
        const startX = 12 + step / 2;
        const cy = NODE_H - 30;
        for (let k = 0; k < maxShown; k++) {
          const cx = startX + k * step;
          const sg = el('g', { transform: `translate(${cx},${cy}) scale(0.55)`, class: 'node-icon' });
          drawConsumerIconTo(sg, n.consumerSubtype || 'custom', '#90a4ae');
          g.appendChild(sg);
          // Соединительная линия между иконками
          if (k < maxShown - 1) {
            g.appendChild(el('line', {
              x1: cx + step * 0.3, y1: cy,
              x2: cx + step * 0.7, y2: cy,
              stroke: '#90a4ae', 'stroke-width': 1.2,
              class: 'node-icon',
            }));
          }
        }
        if (count > maxShown) {
          const t = text(w - 12, cy + 4, `+${count - maxShown}`, 'node-icon-letter');
          t.setAttribute('text-anchor', 'end');
          t.style.fill = '#90a4ae';
          g.appendChild(t);
        }
      }
    }

    // Класс напряжения по IEC 60502-2 НАД объектом (для источников/генератора/ИБП).
    // Пример: "0.4 kV", "6/10 (12) kV". Компактный серый текст.
    if (n.type === 'source' || n.type === 'generator' || n.type === 'ups') {
      const uVal = nodeVoltage(n);
      if (uVal > 0) {
        const vClass = cableVoltageClass(uVal);
        if (vClass) {
          const vt = text(w / 2, -4, vClass, 'node-sub');
          vt.setAttribute('text-anchor', 'middle');
          vt.setAttribute('style', 'font-size:10px;fill:#546e7a;font-weight:600');
          g.appendChild(vt);
        }
      }
    }

    // IEC условное обозначение для источников (маленький SVG-символ)
    if (n.type === 'source' || n.type === 'generator') {
      const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
      const ix = w - 32, iy = 14;
      if (subtype === 'transformer') {
        // IEC 60617: два пересекающихся кольца (обмотки)
        g.appendChild(el('circle', { cx: ix, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
        g.appendChild(el('circle', { cx: ix + 10, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
      } else if (subtype === 'other') {
        // Внешняя сеть (IEC 60617 арр-стиль: прямоугольник со стрелкой вверх)
        g.appendChild(el('rect', { x: ix, y: iy - 8, width: 20, height: 16, fill: 'none', stroke: '#1976d2', 'stroke-width': 1.5, rx: 2, class: 'node-icon' }));
        g.appendChild(el('path', { d: `M${ix+10},${iy+4} L${ix+10},${iy-4} M${ix+6},${iy-0} L${ix+10},${iy-4} L${ix+14},${iy-0}`, fill: 'none', stroke: '#1976d2', 'stroke-width': 1.5, class: 'node-icon' }));
      } else {
        // IEC 60617: кольцо с буквой G
        g.appendChild(el('circle', { cx: ix + 5, cy: iy, r: 11, fill: 'none', stroke: '#ff9800', 'stroke-width': 1.5, class: 'node-icon' }));
        const gt = text(ix + 5, iy + 4, 'G', 'node-icon-letter');
        g.appendChild(gt);
      }
    }

    // Маркер цвета линии для источников/генераторов/ИБП
    if ((n.type === 'source' || n.type === 'generator' || (n.type === 'ups' && n.lineColor)) && GLOBAL.showSourceColors) {
      const color = n.lineColor || '#e53935';
      g.appendChild(el('circle', {
        cx: w - 14, cy: NODE_H - 14, r: 7,
        fill: color, stroke: '#fff', 'stroke-width': 1.5,
      }));
    }

    // Подпись типа
    const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    const srcSubLabel = subtype === 'other' ? 'Внешняя сеть'
      : subtype === 'generator' ? ('Генератор' + (n.backupMode ? ' (резерв)' : ''))
      : 'Трансформатор';
    const subTxt = {
      source:    srcSubLabel,
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel:     `In ${fmt(n.capacityA || 0)} A · Макс: ${fmt(n._maxLoadA || 0)} A / ${fmt(n._maxLoadKw || 0)} kW`,
      ups:       `ИБП · КПД ${Math.round(Number(n.efficiency) || 100)}%` +
                   (n._onStaticBypass ? ' · БАЙПАС' : ''),
      consumer:  ((n.consumerSubtype === 'outdoor_unit' ? 'Наруж. блок'
                    : (CONSUMER_CATALOG.find(c => c.id === n.consumerSubtype) || {}).label || 'Потребитель'))
                  + (n.inputs > 1 ? ` · вх ${n.inputs}` : ''),
      channel:   resolveChannelLabel(n),
    }[n.type];
    g.appendChild(text(12, 49, subTxt, 'node-sub'));

    // Нагрузка
    let loadLine = '', loadCls = 'node-load';
    if (n.type === 'source') {
      if (!effectiveOn(n)) { loadLine = `Отключён · ${fmt(n.capacityKw)} kW`; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} (макс ${fmt(n._maxLoadKw || 0)}) / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'generator') {
      const hasTrigger = (Array.isArray(n.triggerGroups) && n.triggerGroups.length) || n.triggerNodeId;
      if (!effectiveOn(n)) { loadLine = `Отключён · ${fmt(n.capacityKw)} kW`; loadCls += ' off'; }
      else if (hasTrigger && n._startCountdown > 0) {
        loadLine = `ПУСК через ${Math.ceil(n._startCountdown)} с · ${fmt(n.capacityKw)} kW`;
        loadCls += ' off';
      } else if (hasTrigger && n._stopCountdown > 0) {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW · стоп ${Math.ceil(n._stopCountdown)} с`;
      } else if (hasTrigger && !n._running) {
        loadLine = `Дежурство · ${fmt(n.capacityKw)} kW`;
        loadCls += ' off';
      } else {
        loadLine = `${fmt(n._loadKw)} (макс ${fmt(n._maxLoadKw || 0)}) / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'panel') {
      if (n.maintenance) {
        loadLine = 'Обслуживание'; loadCls += ' off';
      } else if (!n._powered) {
        loadLine = 'Без питания';
        loadCls += ' off';
      } else {
        loadLine = `Текущее: ${fmt(n._loadA || 0)} A / ${fmt(n._loadKw || 0)} kW`;
        if (n._marginWarn === 'low') loadCls += ' overload';
      }
      // Таймер АВР
      if (n._avrSwitchCountdown > 0) {
        loadLine += ` · АВР ${Math.ceil(n._avrSwitchCountdown)}с`;
      } else if (n._avrInterlockCountdown > 0) {
        loadLine += ` · разб. ${Math.ceil(n._avrInterlockCountdown)}с`;
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else if (!n._powered) { loadLine = 'Без питания'; loadCls += ' off'; }
      else {
        let suffix = '';
        if (n._onStaticBypass) suffix = ' · БАЙПАС';
        else if (n._onBattery) {
          const sec = Math.max(0, Math.round(n._runtimeLeftSec || 0));
          const mm = Math.floor(sec / 60);
          const ss = sec % 60;
          suffix = ` · БАТ ${mm}:${String(ss).padStart(2, '0')}`;
        }
        // Показываем ток / макс.ток и мощность
        const capA = computeCurrentA(n.capacityKw, nodeVoltage(n), 1.0, isThreePhase(n));
        loadLine = `${fmt(n._loadA || 0)} / ${fmt(capA)} A · ${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW${suffix}`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'consumer') {
      loadLine = n._powered ? fmtPower(n.demandKw) : `${fmtPower(n.demandKw)} · нет`;
      if (!n._powered) loadCls += ' off';
    } else if (n.type === 'channel') {
      loadLine = `${n.ambientC || 30}°C · ${n.lengthM || 0} м`;
      // IEC 60364-5-52: иконка способа прокладки (справа) + расположения кабелей (левее)
      drawChannelIcon(g, w, resolveChannelKey(n));
      drawBundlingIcon(g, w - 82, n.bundling || 'touching');
    }
    g.appendChild(text(12, NODE_H - 12, loadLine, loadCls));

    // Порты — входы
    const inCount = nodeInputCount(n);
    // Определяем состояние автомата и наличие подключения для каждого порта
    const portConns = new Map(); // port → conn
    for (const c of state.conns.values()) {
      if (c.to.nodeId === n.id) portConns.set(c.to.port, c);
    }
    const gs = 40; // GLOBAL.gridStep
    const isSideInput = (n.type === 'consumer' && n.inputSide && n.inputSide !== 'top')
                      || (n.type === 'generator' && n.auxInput);
    for (let i = 0; i < inCount; i++) {
      let cx, cy;
      if (n.type === 'generator' && n.auxInput) {
        // Генератор: порт СН сбоку
        const side = n.auxInputSide || 'left';
        cx = side === 'left' ? 0 : w;
        cy = NODE_H / 2;
      } else if (isSideInput) {
        // Порты сбоку
        const side = n.inputSide;
        if (side === 'left') {
          cx = 0;
          cy = NODE_H / (inCount + 1) * (i + 1);
        } else if (side === 'right') {
          cx = w;
          cy = NODE_H / (inCount + 1) * (i + 1);
        } else if (side === 'split') {
          cx = i === 0 ? 0 : w;
          cy = NODE_H / 2;
        }
      } else {
        const totalW = inCount * gs;
        cx = (w - totalW) / 2 + gs / 2 + i * gs;
        cy = 0;
      }
      const circ = el('circle', { class: 'port in', cx, cy, r: PORT_R });
      circ.dataset.portKind = 'in'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // Метка "СН" для генератора
      if (n.type === 'generator' && n.auxInput) {
        const lx = cx === 0 ? cx - 14 : cx + 14;
        const t = text(lx, cy + 4, 'СН', 'port-label');
        t.setAttribute('text-anchor', cx === 0 ? 'end' : 'start');
        g.appendChild(t);
      }
      // Метка приоритета — размещается ВЫШЕ и ЛЕВЕЕ порта, чтобы не пересекать
      // ни порт, ни приходящую к нему линию/стрелку.
      // Важно: .port-label в CSS имеет text-anchor:middle, поэтому переопределяем
      // через inline style (attribute setAttribute тут CSS перекрывает).
      if (n.type === 'panel' || (n.type === 'consumer' && inCount > 1)) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        if (isSideInput) {
          // Боковой вход: подпись левее/правее порта на его высоте
          const lx = cx === 0 ? cx - 14 : cx + 14;
          const t = text(lx, cy - 10, `P${prio}`, 'port-label');
          t.style.textAnchor = cx === 0 ? 'end' : 'start';
          t.setAttribute('dominant-baseline', 'central');
          g.appendChild(t);
        } else {
          // Топ-вход: выше и ЛЕВЕЕ оси порта — диагонально вверх-влево.
          // y = -16 (16px выше верхнего края блока), x = cx - 16 с anchor=end.
          const t = text(cx - 16, -16, `P${prio}`, 'port-label');
          t.style.textAnchor = 'end';
          t.setAttribute('dominant-baseline', 'central');
          g.appendChild(t);
        }
      }
      // Лампочки — показывают состояние автомата
      const conn = portConns.get(i);
      if (conn) {
        const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
        const avrBrk = Array.isArray(n._avrBreakerOverride) ? n._avrBreakerOverride : [];
        let breakerClosed;
        if ((n.type === 'panel' || n.type === 'consumer') && n.switchMode !== 'parallel' && n.switchMode !== 'manual' && avrBrk.length) {
          breakerClosed = avrBrk[i] !== false;
        } else {
          breakerClosed = inBrk[i] !== false;
        }
        if (breakerClosed) {
          g.appendChild(el('circle', { class: 'port-lamp green', cx, cy, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core green', cx, cy, r: 2 }));
        } else {
          g.appendChild(el('circle', { class: 'port-lamp red', cx, cy, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core red', cx, cy, r: 2 }));
        }
      }
    }
    // Порты — выходы
    const outCount = nodeOutputCount(n);
    for (let i = 0; i < outCount; i++) {
      const totalOutW = outCount * gs;
      const cx = (w - totalOutW) / 2 + gs / 2 + i * gs;
      const circ = el('circle', { class: 'port out', cx, cy: NODE_H, r: PORT_R });
      circ.dataset.portKind = 'out'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // "Резерв" на пустых выходных портах (без подключения)
      if (GLOBAL.showBreakerLabels !== false) {
        let hasConn = false;
        for (const c of state.conns.values()) {
          if (c.from.nodeId === n.id && c.from.port === i) { hasConn = true; break; }
        }
        if (!hasConn) {
          // "Резерв" — те же отступы и стиль что breaker badge
          const rText = 'Резерв';
          const rLen = rText.length * 5.8;
          const rH = 12;
          const rOff = 12; // отступ от порта
          const rbx = n.x + cx; // абсолютная X (для layerConns)
          const rby = n.y + NODE_H + 6;
          const rty = rby + rOff + rLen / 2;
          // Рисуем в layerConns (поверх связей) для правильного z-order
          const rbg = el('rect', { x: rbx - rH/2, y: rby + rOff, width: rH, height: rLen + 6, fill: '#fff', 'fill-opacity': '0.85', rx: 2 });
          layerConns.appendChild(rbg);
          const rl = el('text', { x: rbx, y: rty, class: 'breaker-badge', 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(-90 ${rbx} ${rty})`, fill: '#bbb' });
          rl.textContent = rText;
          layerConns.appendChild(rl);
        }
      }
    }

    // Кнопки +/- для добавления/удаления выходных портов щита.
    // Рисуются снизу справа, под правым краем карточки. Только для
    // обычных (несекционных) панелей.
    if (n.type === 'panel' && n.switchMode !== 'sectioned' && !state.readOnly) {
      const btnY = NODE_H - 14;
      const btnRx = w - 32;
      const btnRp = w - 14;
      // Минус
      const minusG = el('g', { class: 'port-btn port-btn-del', 'data-port-del': n.id });
      minusG.appendChild(el('circle', { cx: btnRx, cy: btnY, r: 8 }));
      minusG.appendChild(el('line', { x1: btnRx - 4, y1: btnY, x2: btnRx + 4, y2: btnY }));
      g.appendChild(minusG);
      // Плюс
      const plusG = el('g', { class: 'port-btn port-btn-add', 'data-port-add': n.id });
      plusG.appendChild(el('circle', { cx: btnRp, cy: btnY, r: 8 }));
      plusG.appendChild(el('line', { x1: btnRp - 4, y1: btnY, x2: btnRp + 4, y2: btnY }));
      plusG.appendChild(el('line', { x1: btnRp, y1: btnY - 4, x2: btnRp, y2: btnY + 4 }));
      g.appendChild(plusG);
    }

    // Жёлтый треугольник с «!» — предупреждение о номинале шкафа
    if (n.type === 'panel' && n._marginWarn) {
      const tx = w - 22, ty = 8;
      const tri = el('path', {
        class: 'margin-warn-tri',
        d: `M${tx + 8},${ty} L${tx + 16},${ty + 14} L${tx},${ty + 14} Z`,
      });
      g.appendChild(tri);
      const bang = text(tx + 8, ty + 13, '!', 'margin-warn-bang');
      g.appendChild(bang);
      const title = el('title', {});
      const mp = n._marginPct == null ? '-' : n._marginPct.toFixed(1);
      title.textContent = n._marginWarn === 'undersize'
        ? `Перегруз: номинал ${fmt(n.capacityA)} А < макс.ток ${fmt(n._maxLoadA || 0)} А (${mp}%)`
        : `Избыточный запас: номинал ${fmt(n.capacityA)} А, макс.ток ${fmt(n._maxLoadA || 0)} А (запас ${mp}%, макс. ${n.marginMaxPct}%)`;
      tri.appendChild(title);
    }

    layerNodes.appendChild(g);
  }
}

export function renderConns() {
  while (layerConns.firstChild) layerConns.removeChild(layerConns.firstChild);

  // Control-линии: от каждого триггера к генератору
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator') continue;
    const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : []);
    if (!triggers.length) continue;
    const genW = nodeWidth(n);
    for (const tid of triggers) {
      const trigger = state.nodes.get(tid);
      if (!trigger) continue;
      const trigW = nodeWidth(trigger);
      const a = { x: trigger.x + trigW / 2, y: trigger.y + NODE_H / 2 };
      const b = { x: n.x + genW / 2, y: n.y + NODE_H / 2 };
      const triggerAlive = !!trigger._powered;
      const genRunning = !!n._running;
      const cls = (!triggerAlive && genRunning) ? 'control-line started' : 'control-line';
      layerConns.appendChild(el('line', { class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const label = !triggerAlive ? (genRunning ? 'ПУСК' : 'СИГНАЛ') : 'дежурство';
      layerConns.appendChild(text(mid.x, mid.y - 4, label, 'control-label' + (!triggerAlive ? ' started' : '')));
    }
  }

  // Build per-channel offset map: for tray-mode channels with multiple
  // connections sharing a waypoint at the center, spread them across the width.
  // Key = channelId, value = Map<connId, offsetIndex>
  const _trayOffsets = new Map(); // channelId → { conns: connId[], angle, spacing }
  for (const ch of state.nodes.values()) {
    if (ch.type !== 'channel' || !ch.trayMode) continue;
    const tw = ch.trayWidth || 40;
    const tl = (ch.trayLength || 120);
    const cx = ch.x + tw / 2;
    const cy = ch.y + tl / 2;
    const angle = (ch.trayAngle || 0) * Math.PI / 180;
    const connsInCh = [];
    for (const c of state.conns.values()) {
      const wps = Array.isArray(c.waypoints) ? c.waypoints : [];
      if (wps.some(wp => Math.hypot(wp.x - cx, wp.y - cy) < 5)) {
        connsInCh.push(c.id);
      }
    }
    if (connsInCh.length > 1) {
      const spacing = Math.min(8, (tw - 4) / connsInCh.length);
      _trayOffsets.set(ch.id, { conns: connsInCh, angle, spacing, cx, cy });
    }
  }

  // Get adjusted waypoints for a connection, applying tray offsets.
  // A single waypoint at a channel center expands to 3 points:
  //   entry (beyond channel bounds) → center → exit (beyond channel bounds)
  // The direction is along the channel's long axis.
  function _adjustedWaypoints(c, startPt, endPt) {
    const wps = Array.isArray(c.waypoints) ? c.waypoints : [];
    const result = [];
    const chain = [startPt, ...wps, endPt]; // full point chain for direction
    for (let wi = 0; wi < wps.length; wi++) {
      const wp = wps[wi];
      let matched = false;
      // Check all tray channels
      for (const ch of state.nodes.values()) {
        if (ch.type !== 'channel' || !ch.trayMode) continue;
        const tw = ch.trayWidth || 40;
        const tl = (ch.trayLength || 120);
        const cx = ch.x + tw / 2;
        const cy = ch.y + tl / 2;
        if (Math.hypot(wp.x - cx, wp.y - cy) > 5) continue;
        matched = true;
        const angle = (ch.trayAngle || 0) * Math.PI / 180;
        // Channel axis direction (along long side = angle direction, 0° = up)
        const axX = Math.sin(angle);
        const axY = -Math.cos(angle);
        // Half-length + overshoot (10px beyond bounds)
        const halfLen = tl / 2 + 10;

        // Perpendicular offset for multiple lines
        let perpOff = 0;
        const trayInfo = _trayOffsets.get(ch.id);
        if (trayInfo) {
          const idx = trayInfo.conns.indexOf(c.id);
          if (idx >= 0) {
            const n = trayInfo.conns.length;
            perpOff = (idx - (n - 1) / 2) * trayInfo.spacing;
          }
        }
        const perpAngle = angle + Math.PI / 2;
        const px = Math.cos(perpAngle) * perpOff;
        const py = Math.sin(perpAngle) * perpOff;

        // Determine which end is entry and which is exit based on prev/next points
        const prev = chain[wi]; // point before this waypoint in chain
        const next = chain[wi + 2]; // point after this waypoint in chain
        const entryEnd = { x: cx + px - axX * halfLen, y: cy + py - axY * halfLen };
        const exitEnd  = { x: cx + px + axX * halfLen, y: cy + py + axY * halfLen };

        // Выбираем порядок: ближний конец к prev = entry
        const dEntry = Math.hypot(prev.x - entryEnd.x, prev.y - entryEnd.y);
        const dExit  = Math.hypot(prev.x - exitEnd.x, prev.y - exitEnd.y);
        if (dEntry <= dExit) {
          result.push(entryEnd, exitEnd);
        } else {
          result.push(exitEnd, entryEnd);
        }
        break;
      }
      if (!matched) result.push(wp);
    }
    return result;
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;
    // Связь видна только если оба её конца видны на текущей странице
    if (!isOnCurrentPage(fromN) || !isOnCurrentPage(toN)) continue;
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const rawWaypoints = Array.isArray(c.waypoints) ? c.waypoints : [];
    const waypoints = _adjustedWaypoints(c, a, b);
    // Определяем направление выхода/входа для боковых портов.
    // Выходы всегда снизу (aDir=0,1). Входы могут быть сверху или сбоку:
    //   - consumer с inputSide left/right/split
    //   - generator с auxInput (порт СН) на auxInputSide left/right
    const aDir = { x: 0, y: 1 };
    let bDir = { x: 0, y: -1 };
    if (toN.type === 'consumer' && toN.inputSide && toN.inputSide !== 'top') {
      const side = toN.inputSide;
      if (side === 'left') bDir = { x: -1, y: 0 };
      else if (side === 'right') bDir = { x: 1, y: 0 };
      else if (side === 'split') bDir = c.to.port === 0 ? { x: -1, y: 0 } : { x: 1, y: 0 };
    } else if (toN.type === 'generator' && toN.auxInput) {
      const side = toN.auxInputSide || 'left';
      bDir = side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    }
    const d = splinePath(a, waypoints, b, { aDir, bDir });

    const selected = state.selectedKind === 'conn' && state.selectedId === c.id;

    // Определяем эффективный режим "разрыва" (link mode):
    // state.linksOverride: 'all-links' → скрыть все, 'all-lines' → показать все, null → по c.linkMode
    // c._linkPreview (runtime) — временный пунктирный показ при клике
    let effLinkMode;
    if (state.linksOverride === 'all-links') effLinkMode = true;
    else if (state.linksOverride === 'all-lines') effLinkMode = false;
    else effLinkMode = !!c.linkMode;
    const linkPreview = !!c._linkPreview; // временное отображение скрытой линии пунктиром

    // Невидимая «толстая» дорожка — упрощает попадание кликом.
    // Phase 1.20.6: для линий в link-mode (скрытые с референсными подписями)
    // отключаем hit-путь чтобы курсор не ловил невидимую трассу. Исключение
    // — временный _linkPreview (пользователь явно попросил подсветить путь).
    if (!(effLinkMode && !linkPreview)) {
      const hit = el('path', { class: 'conn-hit', d });
      hit.dataset.connId = c.id;
      layerConns.appendChild(hit);
    }

    // Видимая линия — повреждённые и отключённые перекрывают электрическое состояние
    let stateClass;
    if (c.lineMode === 'damaged') stateClass = ' damaged';
    else if (c.lineMode === 'disabled') stateClass = ' disabled';
    else stateClass = c._state === 'active' ? ' active'
                    : c._state === 'powered' ? ' powered'
                    : ' dead';

    // Режим разрыва: скрываем основную линию, рисуем две короткие стрелки с подписями
    if (effLinkMode && !linkPreview) {
      const fromTag = (effectiveTag(fromN) || fromN.name || '?') + '-' + (c.from.port + 1);
      const toTag = (effectiveTag(toN) || toN.name || '?') + '-' + (c.to.port + 1);
      const stubLen = 48;
      const rOff = 12;
      const charW = 5.8;
      const strokeCol = (c._state === 'active' || c._state === 'powered')
        ? (c._sourceColor || '#e53935') : '#bbb';

      // Сохраняем путь для hover-preview (пунктир при наведении)
      c._linkD = d;

      // Формируем текст автомата (если включено)
      let brkTxt = null;
      if (GLOBAL.showLinkBreakers && (c._breakerIn || c._breakerPerLine)) {
        if (c._breakerIn && c._breakerPerLine && c._breakerCount > 1) {
          brkTxt = `${c._breakerIn}А (${c._breakerCount}×${c._breakerPerLine}А)`;
        } else if (c._breakerPerLine && c._breakerCount > 1) {
          brkTxt = `${c._breakerCount}×${c._breakerPerLine}А`;
        } else if (c._breakerIn) {
          brkTxt = `${c._breakerIn}А`;
        }
        // Для DC-линий — суффикс DC (указывает на необходимость DC-rated MCCB)
        if (brkTxt && c._breakerDcRequired) brkTxt += ' DC';
      }
      const brkLen = brkTxt ? brkTxt.length * charW : 0;
      // Длина брекера + отступ (только на from-end): сдвигает ref-label дальше.
      const brkUsed = brkTxt ? (brkLen + rOff) : 0;

      // Тексты и их длины — известны заранее, можем посчитать центры подписей
      // для гиперссылочного перехода (чтобы курсор был ПРЯМО на противоположной подписи).
      const fromRefTxt = `→ ${toTag}`;
      const toRefTxt   = `← ${fromTag}`;
      const fromRefLen = fromRefTxt.length * charW;
      const toRefLen   = toRefTxt.length * charW;
      // Центр from-label (на a, с учётом брекера)
      const fromRefCx = a.x + aDir.x * (stubLen + rOff + brkUsed + fromRefLen / 2);
      const fromRefCy = a.y + aDir.y * (stubLen + rOff + brkUsed + fromRefLen / 2);
      // Центр to-label (на b, без брекера)
      const toRefCx = b.x + bDir.x * (stubLen + rOff + toRefLen / 2);
      const toRefCy = b.y + bDir.y * (stubLen + rOff + toRefLen / 2);

      // Хелпер: создаёт подпись (горизонтальную или вертикальную)
      const makeLabel = (p, dir, txt, offset, cls, clickTarget, tgtXY) => {
        const horizontal = Math.abs(dir.x) > Math.abs(dir.y);
        let lbl;
        if (horizontal) {
          const anchor = dir.x > 0 ? 'start' : 'end';
          const lx = p.x + dir.x * offset;
          const ly = p.y + dir.y * offset;
          lbl = el('text', {
            x: lx, y: ly, class: cls,
            'text-anchor': anchor, 'dominant-baseline': 'central',
          });
        } else {
          const rLen = txt.length * charW;
          const cxp = p.x + dir.x * (offset + rLen / 2);
          const cyp = p.y + dir.y * (offset + rLen / 2);
          lbl = el('text', {
            x: cxp, y: cyp, class: cls,
            'text-anchor': 'middle', 'dominant-baseline': 'central',
            transform: `rotate(-90 ${cxp} ${cyp})`,
          });
        }
        lbl.textContent = txt;
        lbl.dataset.connId = c.id;
        if (clickTarget) {
          lbl.dataset.linkJump = clickTarget;
          lbl.style.cursor = 'pointer';
          if (tgtXY) {
            lbl.dataset.targetX = tgtXY.x;
            lbl.dataset.targetY = tgtXY.y;
          }
        }
        return lbl;
      };

      // Хелпер рисует стаб + (опц.) брекер + ref-label
      // tgtCenter — SVG-координаты ПРОТИВОПОЛОЖНОЙ подписи (куда прыгать)
      const drawEnd = (p, dir, txt, lineSpec, jumpTo, tgtCenter) => {
        // Стаб со стрелкой
        const ln = el('line', Object.assign({
          stroke: strokeCol, 'stroke-width': 2, 'marker-end': 'url(#arrow-link)',
        }, lineSpec));
        ln.dataset.connId = c.id;
        ln.dataset.linkJump = jumpTo;
        ln.dataset.targetX = tgtCenter.x;
        ln.dataset.targetY = tgtCenter.y;
        ln.style.cursor = 'pointer';
        layerConns.appendChild(ln);

        // Брекер (ближе к порту) — только на from-end, где реально стоит автомат
        let usedLen = 0;
        if (brkTxt && dir === aDir) {
          const brkOffset = stubLen + rOff;
          const cls = 'breaker-badge' + (c._breakerAgainstCable ? ' overload' : '');
          const horizontal = Math.abs(dir.x) > Math.abs(dir.y);
          if (!horizontal) {
            const bgSize = 12;
            const bgX = (p.x + dir.x * brkOffset) - bgSize / 2;
            const bgY = p.y + dir.y * brkOffset;
            const bg = el('rect', {
              x: bgX, y: bgY, width: bgSize, height: brkLen + 4,
              fill: '#fff', 'fill-opacity': '0.9', rx: 2,
            });
            layerConns.appendChild(bg);
          }
          const brkLbl = makeLabel(p, dir, brkTxt, brkOffset, cls);
          layerConns.appendChild(brkLbl);
          usedLen = brkLen + rOff;
        }

        // Ref-label — дальше от порта, с гиперссылочным стилем
        const refOffset = stubLen + rOff + usedLen;
        const refLbl = makeLabel(p, dir, txt, refOffset, 'conn-link-label', jumpTo, tgtCenter);
        layerConns.appendChild(refLbl);
      };

      // from-конец: клик → прыжок к to-label (тогда курсор окажется над to-label)
      drawEnd(a, aDir, fromRefTxt, {
        x1: a.x, y1: a.y,
        x2: a.x + aDir.x * stubLen, y2: a.y + aDir.y * stubLen,
      }, 'to', { x: toRefCx, y: toRefCy });
      // to-конец: клик → прыжок к from-label
      drawEnd(b, bDir, toRefTxt, {
        x1: b.x + bDir.x * stubLen, y1: b.y + bDir.y * stubLen,
        x2: b.x, y2: b.y,
      }, 'from', { x: fromRefCx, y: fromRefCy });
    } else {
      // Если сейчас override='all-lines', а у линии стоит linkMode — подсвечиваем её,
      // чтобы пользователь видел какие связи в нормальном виде будут разорваны.
      const forcedVisible = state.linksOverride === 'all-lines' && c.linkMode;
      const path = el('path', {
        class: 'conn' + stateClass + (selected ? ' selected' : '') + (forcedVisible ? ' link-hidden' : ''),
        d,
      });
      // Цвет по источнику
      if (GLOBAL.showSourceColors && c._sourceColor && (c._state === 'active' || c._state === 'powered')) {
        let style = `stroke: ${c._sourceColor}`;
        if (c._mixedSources) style += '; stroke-dasharray: 8 4';
        else if (linkPreview) style += '; stroke-dasharray: 6 4; opacity: 0.6';
        path.setAttribute('style', style);
      } else if (linkPreview) {
        path.setAttribute('style', 'stroke-dasharray: 6 4; opacity: 0.6');
      }
      path.dataset.connId = c.id;
      layerConns.appendChild(path);
    }

    // Подпись на активных линиях.
    // Формат: «Imax A / жилы×[N×]сечение мм² [(кол-во шт.)]»
    //   Imax — ток в максимальном режиме (одна параллельная ветвь)
    //   жилы — 5 для 3ф (L1+L2+L3+N+PE), 3 для 1ф (L+N+PE)
    //   N× — количество спаренных кабелей (только если > 1)
    //   (кол-во шт.) — только для групповых потребителей (count > 1)
    // Подпись кабеля/шинопровода на ЛЮБОЙ линии с maxA > 0 (не показываем в режиме разрыва)
    if (!effLinkMode && GLOBAL.showCableLabels !== false && c._maxA > 0 && (c._cableSize || c._busbarNom || c._cableOverflow)) {
      const mid = pathMidpoint(a, waypoints, b);
      const isActive = c._state === 'active' && c._loadKw > 0;
      const parallel = Math.max(1, c._cableParallel || 1);
      // HV-линии — 3 жилы (3 фазы, без N/PE). Броня не считается проводником.
      // LV 3ф: 5 жил (L1+L2+L3+N+PE), LV 1ф: 3 (L+N+PE).
      const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
      const maxPerBranch = (c._maxA || 0) / parallel;

      let labelText;
      if (c._cableOverflow) {
        // Overflow — не удалось подобрать кабель
        labelText = `⚠ ${fmt(c._maxA)} A — кабель не подобран!`;
      } else if (c._busbarNom) {
        labelText = `${fmt(c._maxA)} A / шинопр. ${c._busbarNom} А`;
      } else if (c._cableSize) {
        const isAutoParallel = !!c._cableAutoParallel;
        const inner = `${cores}×${c._cableSize} мм²`;
        const cableSpec = (isAutoParallel && parallel > 1) ? `${parallel}×(${inner})` : inner;
        // «N шт.» — показываем ТОЛЬКО для параллельной группы (несколько приборов
        // на отдельных кабельных линиях). Для serialMode это один кабель — суффикс
        // не нужен и был бы визуально обманчив.
        const groupCount = (toN.type === 'consumer' && (toN.count || 1) > 1 && !toN.serialMode)
          ? Number(toN.count) : 0;

        if (isAutoParallel && parallel > 1) {
          const totalA = maxPerBranch * parallel;
          labelText = `${fmt(totalA)} A · ${parallel}×${fmt(maxPerBranch)} A / ${cableSpec}`;
        } else {
          labelText = `${fmt(maxPerBranch)} A / ${cableSpec}`;
        }
        if (groupCount > 1) labelText += ` (${groupCount} шт.)`;
        // v0.57.63: номинал защитного аппарата (QF/FU) в подпись линии.
        // Для внутренних автоматов ИБП (QF1/QF2/QF3) — пропускаем.
        if (!c._breakerInternal) {
          const brkIn = Number(c._breakerIn) || Number(c._breakerPerLine) || 0;
          if (brkIn > 0) {
            const isFu = c._protectionKind === 'fuse';
            const tag = isFu
              ? `FU ${fmt(brkIn)}А ${c._fuseType || 'gG'}`
              : `QF ${fmt(brkIn)}А ${c._breakerCurveEff || c.breakerCurve || ''}`.trim();
            labelText = tag + ' · ' + labelText;
          }
        }
        // Обозначение класса напряжения по IEC 60502-2 для HV-линий:
        // U₀/U (Um) кВ — ставим перед током и сечением.
        if (c._isHV) {
          const vc = cableVoltageClass(c._voltage || 0);
          labelText = vc + ' · ' + labelText;
        }
        // DC-линии: префикс "=" (ГОСТ/IEC стандарт для постоянного тока).
        if (c._isDC) {
          const uDc = Math.round(Number(c._voltage) || 0);
          labelText = `= ${uDc} В · ` + labelText;
        }
      }

      if (labelText) {
        const cls = isActive
          ? ('conn-label' + (c._cableOverflow ? ' overload' : ''))
          : ('conn-label-sub' + (c._cableOverflow ? ' overload' : ''));
        const prefix = isActive ? '' : '[';
        const suffix = isActive ? '' : ']';
        const lbl = text(mid.x, mid.y - 4, prefix + labelText + suffix, cls);
        layerConns.appendChild(lbl);
      }
    }

    // Рукоятки на обоих концах выделенной связи + точки сплайна
    if (selected) {
      const h1 = el('circle', { class: 'conn-handle', cx: b.x, cy: b.y, r: 7 });
      h1.dataset.reconnectId = c.id;
      h1.dataset.reconnectEnd = 'to';
      layerConns.appendChild(h1);
      const h2 = el('circle', { class: 'conn-handle', cx: a.x, cy: a.y, r: 7 });
      h2.dataset.reconnectId = c.id;
      h2.dataset.reconnectEnd = 'from';
      layerConns.appendChild(h2);

      // Существующие waypoints (raw positions for dragging) + кнопка удаления
      for (let i = 0; i < rawWaypoints.length; i++) {
        const wp = rawWaypoints[i];
        const dot = el('circle', { class: 'conn-waypoint', cx: wp.x, cy: wp.y, r: 5 });
        dot.dataset.waypointId = c.id;
        dot.dataset.waypointIdx = i;
        layerConns.appendChild(dot);
        // Кнопка удаления (×) справа-сверху от точки
        const del = el('circle', {
          class: 'conn-waypoint-del', cx: wp.x + 8, cy: wp.y - 8, r: 5,
        });
        del.dataset.waypointDelId = c.id;
        del.dataset.waypointDelIdx = i;
        layerConns.appendChild(del);
        const delX = text(wp.x + 8, wp.y - 5, '×', 'conn-waypoint-del-text');
        delX.dataset.waypointDelId = c.id;
        delX.dataset.waypointDelIdx = i;
        layerConns.appendChild(delX);
      }
      // «Плюсы» для добавления новых waypoints в середине каждого сегмента
      const chain = [a, ...waypoints, b];
      for (let i = 0; i < chain.length - 1; i++) {
        const mid = { x: (chain[i].x + chain[i + 1].x) / 2, y: (chain[i].y + chain[i + 1].y) / 2 };
        const plus = el('circle', { class: 'conn-waypoint-add', cx: mid.x, cy: mid.y, r: 4 });
        plus.dataset.waypointAddId = c.id;
        plus.dataset.waypointAddIdx = i; // вставка перед позицией i в waypoints
        layerConns.appendChild(plus);
      }
    }

    // Бейдж автомата — под выходным портом, повёрнут -90°, с белой подложкой
    const hasBreaker = c._breakerIn || c._breakerPerLine;
    if (!effLinkMode && GLOBAL.showBreakerLabels !== false && hasBreaker) {
      // Позиция = выходной порт (from)
      const bx = a.x;
      const by = a.y + 6; // чуть ниже порта

      let brkText;
      if (c._breakerIn && c._breakerPerLine && c._breakerCount > 1) {
        brkText = `${c._breakerIn}А (${c._breakerCount}×${c._breakerPerLine}А)`;
      } else if (c._breakerPerLine && c._breakerCount > 1) {
        brkText = `${c._breakerCount}×${c._breakerPerLine}А`;
      } else if (c._breakerIn) {
        brkText = `${c._breakerIn}А`;
      }
      // DC-линии требуют DC-rated автомата (IEC 60947-2 / MCCB DC)
      if (brkText && c._breakerDcRequired) brkText += ' DC';
      if (brkText) {
        const cls = 'breaker-badge' + (c._breakerAgainstCable ? ' overload' : '');
        const textLen = brkText.length * 5.8;
        const padX = 3, padY = 2;
        const bgH = 12;
        const offsetY = 12; // отступ от порта чтобы не перекрывать
        // Позиция: центр текста на оси порта (bx), начало ниже порта
        const tx = bx;
        const ty = by + offsetY + textLen / 2; // центр текста по вертикали (после поворота)
        // Подложка — прямоугольник, центрированный по оси порта
        const bg = el('rect', {
          x: tx - bgH / 2,
          y: by + offsetY,
          width: bgH,
          height: textLen + padX * 2,
          fill: '#fff', 'fill-opacity': '0.9',
          rx: 2, ry: 2,
        });
        layerConns.appendChild(bg);
        // Текст — повёрнут -90°, центрирован по оси порта
        const lbl = el('text', {
          x: tx,
          y: ty,
          class: cls,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          transform: `rotate(-90 ${tx} ${ty})`,
        });
        lbl.textContent = brkText;
        layerConns.appendChild(lbl);
      }
    }
  }
}

export function renderStats() {
  // Phase 1.20.39: переработка сводной статистики в sidebar.
  // * «Запрос» — установленная мощность всех потребителей (Σ demand×count).
  //   Это верхняя оценка: все потребители включены одновременно.
  // * «Общая мощность ист. питания» (ex «Источников») — Σ capacity включённых
  //   источников/генераторов. Это общая (номинальная) установленная мощность.
  // * «Доступно (N-1)» — (Phase 1.20.45) tiered-redundancy модель:
  //   в каждой группе redundancyGroup из основных (не backup/standby)
  //   источников вычитается макс. ёмкость (N-1), backup и standby
  //   не суммируются. Это реальная доступная мощность в нормальном режиме.
  let totalDemand = 0, totalCap = 0;
  let standbyCount = 0, backupCount = 0;
  let unpoweredCount = 0, overloadCount = 0;
  const groups = new Map(); // groupKey → [cap]
  const singletons = [];
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      const per = Number(n.demandKw) || 0;
      const cnt = Math.max(1, Number(n.count) || 1);
      totalDemand += per * cnt;
      if (!n._powered) unpoweredCount++;
    }
    if (n.type === 'source' || n.type === 'generator') {
      if (effectiveOn(n)) {
        const cap = Number(n.capacityKw) || 0;
        totalCap += cap;
        if (n.isStandby) standbyCount++;
        else if (n.isBackup) backupCount++;
        else {
          const grp = (typeof n.redundancyGroup === 'string' && n.redundancyGroup.trim()) ? n.redundancyGroup.trim() : null;
          if (grp) {
            if (!groups.has(grp)) groups.set(grp, []);
            groups.get(grp).push(cap);
          } else singletons.push(cap);
        }
      }
      if (n._overload) overloadCount++;
    }
  }
  let availCap = 0;
  for (const arr of groups.values()) {
    if (arr.length >= 2) {
      const s = arr.reduce((a, b) => a + b, 0);
      const mx = Math.max(...arr);
      availCap += (s - mx);
    } else {
      availCap += arr.reduce((a, b) => a + b, 0);
    }
  }
  availCap += singletons.reduce((a, b) => a + b, 0);
  const rows = [];
  rows.push(`<div class="row"><span>Запрос</span><span>${fmt(totalDemand)} kW</span></div>`);
  rows.push(`<div class="row" title="Сумма ёмкости всех источников и генераторов"><span>Общая мощность ист. питания</span><span>${fmt(totalCap)} kW</span></div>`);
  if (standbyCount > 0 || backupCount > 0 || availCap !== totalCap) {
    const availOk = availCap >= totalDemand;
    const extras = [];
    if (backupCount > 0) extras.push(`backup ${backupCount}`);
    if (standbyCount > 0) extras.push(`резерв ${standbyCount}`);
    const title = 'N-1 в группах' + (extras.length ? ' · ' + extras.join(', ') : '');
    rows.push(`<div class="row ${availOk ? 'ok' : 'warn'}" title="${title}"><span>Доступно (N-1)</span><span>${fmt(availCap)} kW</span></div>`);
  }
  if (unpoweredCount) rows.push(`<div class="row warn"><span>Без питания</span><span>${unpoweredCount}</span></div>`);
  if (overloadCount)  rows.push(`<div class="row warn"><span>Перегруз</span><span>${overloadCount}</span></div>`);
  if (!unpoweredCount && !overloadCount && state.nodes.size) {
    rows.push(`<div class="row ok"><span>Статус</span><span>OK</span></div>`);
  }
  statsEl.innerHTML = rows.join('');
}

export function renderModes() {
  const rows = [];
  const list = [{ id: null, name: 'Нормальный' }, ...state.modes];
  for (const m of list) {
    const active = m.id === state.activeModeId;
    const canDel = m.id !== null;
    rows.push(
      `<div class="mode-row${active ? ' active' : ''}" data-mid="${m.id ?? ''}">
        <input type="radio" name="mode"${active ? ' checked' : ''}>
        <input type="text" class="mode-name" value="${escAttr(m.name)}"${canDel ? '' : ' disabled'}>
        <button class="mode-del" ${canDel ? '' : 'disabled'}>×</button>
      </div>`
    );
  }
  modesListEl.innerHTML = rows.join('');

  modesListEl.querySelectorAll('.mode-row').forEach(row => {
    const mid = row.dataset.mid || null;
    row.querySelector('input[type=radio]').addEventListener('change', () => selectMode(mid));
    row.addEventListener('click', e => {
      if (e.target.closest('.mode-del') || e.target.classList.contains('mode-name')) return;
      selectMode(mid);
    });
    const nameInput = row.querySelector('.mode-name');
    if (!nameInput.disabled) {
      nameInput.addEventListener('input', () => {
        snapshot('mode-name:' + mid);
        const m = state.modes.find(x => x.id === mid);
        if (m) m.name = nameInput.value;
        notifyChange();
      });
    }
    const del = row.querySelector('.mode-del');
    if (!del.disabled) del.addEventListener('click', e => { e.stopPropagation(); deleteMode(mid); });
  });
}

// IEC 60364-5-52 графические обозначения способов прокладки.
// Рисует SVG-иконку 36×28 px в правом верхнем углу карточки канала.
export function drawChannelIcon(g, nodeW, channelType) {
  const ix = nodeW - 44, iy = 6;
  const ig = el('g', { transform: `translate(${ix},${iy})`, class: 'node-icon' });

  // Общие элементы
  function cable(cx, cy, r) {
    // Кабель в разрезе: внешняя оболочка + 3 жилы внутри
    ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#555', 'stroke-width': 1.2 }));
    const jr = r * 0.28;
    ig.appendChild(el('circle', { cx: cx - jr, cy: cy - jr * 0.5, r: jr, fill: '#555' }));
    ig.appendChild(el('circle', { cx: cx + jr, cy: cy - jr * 0.5, r: jr, fill: '#555' }));
    ig.appendChild(el('circle', { cx, cy: cy + jr * 0.7, r: jr, fill: '#555' }));
  }
  function wall(x, y, w, h) {
    // Штриховка стены/грунта
    ig.appendChild(el('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#888', 'stroke-width': 1 }));
    for (let i = 0; i < w; i += 4) {
      ig.appendChild(el('line', { x1: x + i, y1: y + h, x2: x + i + 4, y2: y, stroke: '#bbb', 'stroke-width': 0.5 }));
    }
  }
  function tray(x, y, w) {
    // Лоток — U-образный профиль
    ig.appendChild(el('path', { d: `M${x},${y} L${x},${y + 6} L${x + w},${y + 6} L${x + w},${y}`, fill: 'none', stroke: '#666', 'stroke-width': 1.2 }));
  }
  function tube(cx, cy, r) {
    // Труба — круг
    ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#888', 'stroke-width': 1.2 }));
  }

  // Мини-иконка теплоизоляции (штриховка волнами)
  function insulation(x, y, w, h) {
    ig.appendChild(el('rect', { x, y, width: w, height: h, fill: '#fff3e0', stroke: '#d99', 'stroke-width': 0.8, 'stroke-dasharray': '2 2' }));
  }

  switch (channelType) {
    case 'insulated_conduit': // A1 — труба в теплоизол. стене
      insulation(0, 0, 36, 28);
      tube(18, 14, 9);
      cable(18, 14, 5);
      break;
    case 'insulated_cable': // A2 — кабель в теплоизол. стене (без трубы)
      insulation(0, 0, 36, 28);
      cable(18, 14, 6);
      break;
    case 'conduit': // B1 — кабель в трубе на стене
      wall(0, 0, 36, 8);
      tube(18, 18, 9);
      cable(18, 18, 5);
      break;
    case 'tray_solid': // B2 — сплошной лоток/короб
      ig.appendChild(el('rect', { x: 2, y: 10, width: 32, height: 14, fill: 'none', stroke: '#666', 'stroke-width': 1.2 }));
      cable(18, 17, 5);
      break;
    case 'wall': // C — открыто на стене
      wall(0, 0, 36, 8);
      cable(18, 18, 6);
      break;
    case 'tray_perf': // E — перфорированный лоток
      tray(2, 20, 32);
      // Отверстия перфорации
      for (let i = 6; i < 32; i += 8) {
        ig.appendChild(el('rect', { x: i, y: 22, width: 4, height: 2, fill: '#fff', stroke: '#888', 'stroke-width': 0.5 }));
      }
      cable(18, 14, 5);
      break;
    case 'tray_wire': // E — проволочный лоток
      tray(2, 20, 32);
      // Проволочная сетка
      for (let i = 4; i < 34; i += 5) {
        ig.appendChild(el('line', { x1: i, y1: 20, x2: i, y2: 26, stroke: '#aaa', 'stroke-width': 0.5 }));
      }
      cable(18, 14, 5);
      break;
    case 'tray_ladder': // F — лестничный лоток
      // Боковины
      ig.appendChild(el('line', { x1: 4, y1: 16, x2: 4, y2: 26, stroke: '#666', 'stroke-width': 1.5 }));
      ig.appendChild(el('line', { x1: 32, y1: 16, x2: 32, y2: 26, stroke: '#666', 'stroke-width': 1.5 }));
      // Перекладины
      for (let y = 18; y <= 24; y += 6) {
        ig.appendChild(el('line', { x1: 4, y1: y, x2: 32, y2: y, stroke: '#888', 'stroke-width': 0.8 }));
      }
      cable(18, 12, 5);
      break;
    case 'air': // F — свободно в воздухе
      cable(18, 14, 6);
      // Стрелки воздушного потока
      ig.appendChild(el('path', { d: 'M6,24 L10,20 L14,24', fill: 'none', stroke: '#aaa', 'stroke-width': 0.8 }));
      ig.appendChild(el('path', { d: 'M22,24 L26,20 L30,24', fill: 'none', stroke: '#aaa', 'stroke-width': 0.8 }));
      break;
    case 'air_spaced': // G — одножильные с интервалами
      cable(8, 14, 4.5);
      cable(18, 14, 4.5);
      cable(28, 14, 4.5);
      // Маркер зазора
      ig.appendChild(el('line', { x1: 13, y1: 22, x2: 15, y2: 22, stroke: '#aaa', 'stroke-width': 0.6 }));
      ig.appendChild(el('line', { x1: 23, y1: 22, x2: 25, y2: 22, stroke: '#aaa', 'stroke-width': 0.6 }));
      break;
    case 'ground': // D1 — в трубе в земле
      wall(0, 0, 36, 28);
      tube(18, 14, 8);
      cable(18, 14, 4.5);
      break;
    case 'ground_direct': // D2 — напрямую в земле
      wall(0, 0, 36, 28);
      cable(18, 14, 5.5);
      break;
    default:
      cable(18, 14, 6);
  }
  g.appendChild(ig);
}

// Компактная иконка расположения кабелей (bundling) 28×28 px
export function drawBundlingIcon(g, x, bundling) {
  const ig = el('g', { transform: `translate(${x},${6})`, class: 'node-icon' });
  const c = (cx, cy, r) => ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#555', 'stroke-width': 1 }));
  const dot = (cx, cy) => ig.appendChild(el('circle', { cx, cy, r: 1.8, fill: '#555' }));

  if (bundling === 'spaced') {
    c(6, 14, 5); dot(6, 14);
    c(22, 14, 5); dot(22, 14);
    // Зазор
    ig.appendChild(el('line', { x1: 11, y1: 6, x2: 17, y2: 6, stroke: '#1976d2', 'stroke-width': 0.6 }));
  } else if (bundling === 'bundled') {
    ig.appendChild(el('ellipse', { cx: 14, cy: 14, rx: 12, ry: 10, fill: 'none', stroke: '#888', 'stroke-width': 0.8, 'stroke-dasharray': '2 1.5' }));
    c(8, 11, 4); dot(8, 11);
    c(20, 11, 4); dot(20, 11);
    c(14, 20, 4); dot(14, 20);
  } else {
    // touching
    c(8, 14, 5); dot(8, 14);
    c(20, 14, 5); dot(20, 14);
  }
  g.appendChild(ig);
}
