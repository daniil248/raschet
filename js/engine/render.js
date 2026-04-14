import { state } from './state.js';
import { svg, layerConns, layerNodes, statsEl, modesListEl } from './state.js';
import { NODE_H, SVG_NS, CHANNEL_TYPES, PORT_R, GLOBAL, CONSUMER_CATALOG, BREAKER_TYPES } from './constants.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight, portPos } from './geometry.js';
import { effectiveOn, selectMode, deleteMode } from './modes.js';
import { recalc } from './recalc.js';
import { effectiveTag } from './zones.js';
import { fmt, escHtml, escAttr } from './utils.js';
import { snapshot, notifyChange } from './history.js';
import { computeCurrentA, nodeVoltage, isThreePhase } from './electrical.js';

let _renderInspector;
export function bindRenderDeps({ renderInspector }) { _renderInspector = renderInspector; }

export function updateViewBox() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const vw = W / state.view.zoom;
  const vh = H / state.view.zoom;
  svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${vw} ${vh}`);
  const bg = document.getElementById('bg');
  bg.setAttribute('x', state.view.x);
  bg.setAttribute('y', state.view.y);
  bg.setAttribute('width', vw);
  bg.setAttribute('height', vh);
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

export function render() {
  recalc();
  renderConns();
  renderNodes();
  renderStats();
  renderModes();
}

export function renderNodes() {
  while (layerNodes.firstChild) layerNodes.removeChild(layerNodes.firstChild);

  // Сначала рисуем зоны (они позади обычных узлов).
  // Тело зоны — pointer-events: none, чтобы связи и порты внутри неё оставались
  // кликабельными. Для перетаскивания зоны используется узкая полоса-хэндл сверху.
  for (const n of state.nodes.values()) {
    if (n.type !== 'zone') continue;
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
    layerNodes.appendChild(g);
  }

  // Многосекционные щиты — обёртка-контейнер (рисуется как зона)
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
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

  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    if (n.type === 'channel' && n.trayMode) continue;
    if (n.type === 'panel' && n.switchMode === 'sectioned') continue; // контейнер рисуется выше
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
      // Текст группы на выступающей части — выровнен по правому краю
      const totalKw = (n.count || 1) * (n.demandKw || 0);
      const gt = text(w + ox - 8, NODE_H + oy - 6,
        `${n.count} × ${fmt(n.demandKw)} = ${fmt(totalKw)} kW`, 'node-load');
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

    // IEC условное обозначение для источников (маленький SVG-символ)
    if (n.type === 'source' || n.type === 'generator') {
      const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
      const ix = w - 32, iy = 14;
      if (subtype === 'transformer') {
        // IEC 60617: два пересекающихся кольца (обмотки)
        g.appendChild(el('circle', { cx: ix, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
        g.appendChild(el('circle', { cx: ix + 10, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
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
    const subTxt = {
      source:    subtype === 'generator' ? 'Генератор' + (n.backupMode ? ' (резерв)' : '') : 'Трансформатор',
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel:     `In ${fmt(n.capacityA || 0)} A · Макс: ${fmt(n._maxLoadA || 0)} A / ${fmt(n._maxLoadKw || 0)} kW`,
      ups:       `ИБП · КПД ${Math.round(Number(n.efficiency) || 100)}%` +
                   (n._onStaticBypass ? ' · БАЙПАС' : ''),
      consumer:  ((n.consumerSubtype === 'outdoor_unit' ? 'Наруж. блок'
                    : (CONSUMER_CATALOG.find(c => c.id === n.consumerSubtype) || {}).label || 'Потребитель'))
                  + (n.inputs > 1 ? ` · вх ${n.inputs}` : ''),
      channel:   (CHANNEL_TYPES[n.channelType] || CHANNEL_TYPES.conduit).label,
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
      loadLine = n._powered ? `${fmt(n.demandKw)} kW` : `${fmt(n.demandKw)} kW · нет`;
      if (!n._powered) loadCls += ' off';
    } else if (n.type === 'channel') {
      loadLine = `${n.ambientC || 30}°C · ${n.lengthM || 0} м`;
      // IEC 60364-5-52: иконка способа прокладки (справа) + расположения кабелей (левее)
      drawChannelIcon(g, w, n.channelType || 'conduit');
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
      // Метка приоритета
      if (n.type === 'panel' || (n.type === 'consumer' && inCount > 1)) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        if (isSideInput) {
          const lx = cx === 0 ? cx - 12 : cx + 12;
          g.appendChild(text(lx, cy, `P${prio}`, 'port-label'));
        } else {
          g.appendChild(text(cx, -10, `P${prio}`, 'port-label'));
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
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const rawWaypoints = Array.isArray(c.waypoints) ? c.waypoints : [];
    const waypoints = _adjustedWaypoints(c, a, b);
    // Определяем направление выхода/входа для боковых портов
    const aDir = { x: 0, y: 1 }; // output всегда вниз
    let bDir = { x: 0, y: -1 };  // input по умолчанию сверху
    if (toN.type === 'consumer' && toN.inputSide && toN.inputSide !== 'top') {
      const side = toN.inputSide;
      if (side === 'left') bDir = { x: -1, y: 0 };
      else if (side === 'right') bDir = { x: 1, y: 0 };
      else if (side === 'split') bDir = c.to.port === 0 ? { x: -1, y: 0 } : { x: 1, y: 0 };
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

    // Невидимая «толстая» дорожка — упрощает попадание кликом
    const hit = el('path', { class: 'conn-hit', d });
    hit.dataset.connId = c.id;
    layerConns.appendChild(hit);

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
      // Короткие линии ×2 длиннее (было 24, стало 48) со стрелкой на конце.
      // Подписи — вертикальные (rotate -90), как port-label/breaker-badge,
      // с таким же отступом от порта: rOff=12.
      const stubLen = 48;
      const rOff = 12; // отступ от конца стаба до начала текста (как у breaker badge)
      const charW = 5.8;
      const strokeCol = (c._state === 'active' || c._state === 'powered')
        ? (c._sourceColor || '#e53935') : '#bbb';

      // from-конец: стаб от порта в направлении aDir
      const af = el('line', {
        x1: a.x, y1: a.y, x2: a.x + aDir.x * stubLen, y2: a.y + aDir.y * stubLen,
        stroke: strokeCol, 'stroke-width': 2, 'marker-end': 'url(#arrow-link)',
      });
      af.dataset.connId = c.id;
      layerConns.appendChild(af);
      // Подпись: центр на оси стаба, сдвинута на (rOff + rLen/2) ЗА стрелкой
      const fromTxt = `→ ${toTag}`;
      const fromLen = fromTxt.length * charW;
      const fsx = a.x + aDir.x * (stubLen + rOff + fromLen / 2);
      const fsy = a.y + aDir.y * (stubLen + rOff + fromLen / 2);
      const fromLbl = el('text', {
        x: fsx, y: fsy, class: 'conn-link-label',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        transform: `rotate(-90 ${fsx} ${fsy})`,
      });
      fromLbl.textContent = fromTxt;
      fromLbl.dataset.connId = c.id;
      layerConns.appendChild(fromLbl);

      // to-конец: стаб заходит в порт (stub-end в точке b, stub-start в bDir*stubLen от b)
      const ab = el('line', {
        x1: b.x + bDir.x * stubLen, y1: b.y + bDir.y * stubLen, x2: b.x, y2: b.y,
        stroke: strokeCol, 'stroke-width': 2, 'marker-end': 'url(#arrow-link)',
      });
      ab.dataset.connId = c.id;
      layerConns.appendChild(ab);
      // Подпись у to-конца: сдвинута ОТ порта в направлении bDir на (stubLen + rOff + rLen/2)
      const toTxt = `← ${fromTag}`;
      const toLen = toTxt.length * charW;
      const tsx = b.x + bDir.x * (stubLen + rOff + toLen / 2);
      const tsy = b.y + bDir.y * (stubLen + rOff + toLen / 2);
      const toLbl = el('text', {
        x: tsx, y: tsy, class: 'conn-link-label',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        transform: `rotate(-90 ${tsx} ${tsy})`,
      });
      toLbl.textContent = toTxt;
      toLbl.dataset.connId = c.id;
      layerConns.appendChild(toLbl);
    } else {
      const path = el('path', {
        class: 'conn' + stateClass + (selected ? ' selected' : ''),
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
      const cores = c._wireCount || (c._threePhase ? 5 : 3);
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
        const groupCount = (toN.type === 'consumer' && (toN.count || 1) > 1)
          ? Number(toN.count) : 0;

        if (isAutoParallel && parallel > 1) {
          const totalA = maxPerBranch * parallel;
          labelText = `${fmt(totalA)} A · ${parallel}×${fmt(maxPerBranch)} A / ${cableSpec}`;
        } else {
          labelText = `${fmt(maxPerBranch)} A / ${cableSpec}`;
        }
        if (groupCount > 1) labelText += ` (${groupCount} шт.)`;
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
  let totalDemand = 0, totalCap = 0, totalDraw = 0;
  let unpoweredCount = 0, overloadCount = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      totalDemand += Number(n.demandKw) || 0;
      if (!n._powered) unpoweredCount++;
    }
    if (n.type === 'source' || n.type === 'generator') {
      if (effectiveOn(n)) totalCap += Number(n.capacityKw) || 0;
      totalDraw += n._loadKw || 0;
      if (n._overload) overloadCount++;
    }
  }
  const rows = [];
  rows.push(`<div class="row"><span>Запрос</span><span>${fmt(totalDemand)} kW</span></div>`);
  rows.push(`<div class="row"><span>Источников</span><span>${fmt(totalCap)} kW</span></div>`);
  rows.push(`<div class="row"><span>Потребляется</span><span>${fmt(totalDraw)} kW</span></div>`);
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

  switch (channelType) {
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
