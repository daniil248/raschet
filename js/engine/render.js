import { state } from './state.js';
import { svg, layerConns, layerNodes, statsEl, modesListEl } from './state.js';
import { NODE_H, SVG_NS, CHANNEL_TYPES, PORT_R, GLOBAL, CONSUMER_CATALOG } from './constants.js';
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
export function bezier(a, b) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
}

// Путь сплайна с промежуточными точками. Использует Catmull-Rom -> Bezier, чтобы
// линия проходила через все waypoints гладко.
export function splinePath(a, points, b) {
  if (!points || points.length === 0) return bezier(a, b);
  const pts = [a, ...points, b];
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // Catmull-Rom -> cubic Bezier
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
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

  // Каналы в режиме трассы (trayMode) — рисуем как повёрнутые прямоугольники
  for (const n of state.nodes.values()) {
    if (n.type !== 'channel' || !n.trayMode) continue;
    const tw = n.trayWidth || 40;
    const tl = Math.max(80, (n.lengthM || 10) * 4); // длина пропорционально метрам
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
    if (n.type === 'channel' && n.trayMode) continue; // уже нарисован выше
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
      consumer:  ((n.count || 1) > 1
                    ? `Группа · ${n.count} × ${fmt(n.demandKw)} kW`
                    : (n.consumerSubtype === 'outdoor_unit' ? 'Наруж. блок'
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
    for (let i = 0; i < inCount; i++) {
      const totalW = inCount * gs;
      const cx = (w - totalW) / 2 + gs / 2 + i * gs;
      const circ = el('circle', { class: 'port in', cx, cy: 0, r: PORT_R });
      circ.dataset.portKind = 'in'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // Метка приоритета
      if (n.type === 'panel' || (n.type === 'consumer' && inCount > 1)) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        g.appendChild(text(cx, -10, `P${prio}`, 'port-label'));
      }
      // Лампочки — показывают СОСТОЯНИЕ АВТОМАТА (не напряжение):
      //   зелёная — автомат замкнут (ввод активен)
      //   красная — автомат разомкнут (ввод не выбран)
      //   только для портов с подключением
      const conn = portConns.get(i);
      if (conn) {
        const breakerClosed = conn._state === 'active';
        if (breakerClosed) {
          g.appendChild(el('circle', { class: 'port-lamp green', cx, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core green', cx, cy: 0, r: 2 }));
        } else {
          g.appendChild(el('circle', { class: 'port-lamp red', cx, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core red', cx, cy: 0, r: 2 }));
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
    const tl = Math.max(80, (ch.lengthM || 10) * 4);
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
        const tl = Math.max(80, (ch.lengthM || 10) * 4);
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
    const d = splinePath(a, waypoints, b);

    const selected = state.selectedKind === 'conn' && state.selectedId === c.id;

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
    const path = el('path', {
      class: 'conn' + stateClass + (selected ? ' selected' : ''),
      d,
    });
    // Цвет по источнику (если включен режим) — на ВСЕХ живых линиях
    if (GLOBAL.showSourceColors && c._sourceColor && (c._state === 'active' || c._state === 'powered')) {
      let style = `stroke: ${c._sourceColor}`;
      // Пунктир для смешанных источников (два разных ввода в простом щите)
      if (c._mixedSources) style += '; stroke-dasharray: 8 4';
      path.setAttribute('style', style);
    }
    path.dataset.connId = c.id;
    layerConns.appendChild(path);

    // Подпись на активных линиях.
    // Формат: «Imax A / жилы×[N×]сечение мм² [(кол-во шт.)]»
    //   Imax — ток в максимальном режиме (одна параллельная ветвь)
    //   жилы — 5 для 3ф (L1+L2+L3+N+PE), 3 для 1ф (L+N+PE)
    //   N× — количество спаренных кабелей (только если > 1)
    //   (кол-во шт.) — только для групповых потребителей (count > 1)
    // Подпись кабеля/шинопровода на ЛЮБОЙ линии с maxA > 0
    if (GLOBAL.showCableLabels !== false && c._maxA > 0 && (c._cableSize || c._busbarNom || c._cableOverflow)) {
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

      // Существующие waypoints (raw positions for dragging)
      for (let i = 0; i < rawWaypoints.length; i++) {
        const wp = rawWaypoints[i];
        const dot = el('circle', { class: 'conn-waypoint', cx: wp.x, cy: wp.y, r: 5 });
        dot.dataset.waypointId = c.id;
        dot.dataset.waypointIdx = i;
        layerConns.appendChild(dot);
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
    if (GLOBAL.showBreakerLabels !== false && hasBreaker) {
      // Позиция = выходной порт (from)
      const bx = a.x;
      const by = a.y + 6; // чуть ниже порта

      let brkText;
      if (c._cableAutoParallel && c._breakerIn && c._breakerPerLine && c._breakerCount > 1) {
        brkText = `C${c._breakerIn}А (${c._breakerCount}×C${c._breakerPerLine}А)`;
      } else if (c._breakerPerLine && c._breakerCount > 1) {
        brkText = `${c._breakerCount}×C${c._breakerPerLine}А`;
      } else if (c._breakerIn) {
        brkText = `C${c._breakerIn}А`;
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
