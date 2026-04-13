/* interaction.js -- all canvas/palette event handling (ES module) */

import { state, svg, layerOver, uid } from './state.js';
import { NODE_H, SVG_NS, DEFAULTS, GLOBAL } from './constants.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight, portPos } from './geometry.js';
import { snapshot, notifyChange } from './history.js';
import { selectNode, selectConn, renderInspector, clientToSvg } from './inspector.js';
import { render, updateViewBox, el, bezier } from './render.js';
import { createNode, deleteNode, deleteConn, tryConnect, wouldCreateCycle, nextFreeTag } from './graph.js';
import { tryAttachToZone, detachFromZones, findZoneForMember, findParentZone, isNodeFullyInside, nodesInZone } from './zones.js';
import { flash } from './utils.js';

/* ---- late-bound deps (set via bindInteractionDeps) ---- */
let _undo = () => {};
let _redo = () => {};
let _fitAll = () => {};
let _serialize = () => ({});

export function bindInteractionDeps({ undo, redo, fitAll, serialize }) {
  if (undo) _undo = undo;
  if (redo) _redo = redo;
  if (fitAll) _fitAll = fitAll;
  if (serialize) _serialize = serialize;
}

/* ---- helpers ---- */
// Remove channelIds that no longer have a waypoint snapped to their center
function _removeWaypointChannelSnap(c) {
  if (!Array.isArray(c.channelIds) || !c.channelIds.length) return;
  const wps = Array.isArray(c.waypoints) ? c.waypoints : [];
  const SNAP_R = 5;
  c.channelIds = c.channelIds.filter(chId => {
    const ch = state.nodes.get(chId);
    if (!ch || !ch.trayMode) return true; // keep non-tray channels (assigned manually)
    const tw = ch.trayWidth || 40;
    const tl = Math.max(80, (ch.lengthM || 10) * 4);
    const cx = ch.x + tw / 2;
    const cy = ch.y + tl / 2;
    return wps.some(wp => Math.hypot(wp.x - cx, wp.y - cy) < SNAP_R);
  });
}

/* ---- clipboard state (module-private) ---- */
let _clipboardNode = null;

/* ---- Clipboard functions ---- */
export function copySelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  flash('Скопировано: ' + (n.tag || n.name));
}

export function pasteNode(offsetX = 40, offsetY = 40) {
  if (!_clipboardNode) return;
  snapshot();
  const id = uid();
  const copy = JSON.parse(JSON.stringify(_clipboardNode));
  copy.id = id;
  copy.x = (copy.x || 0) + offsetX;
  copy.y = (copy.y || 0) + offsetY;
  copy.tag = nextFreeTag(copy.type); // уникальное обозначение
  // Обнуляем runtime-поля
  delete copy._loadKw; delete copy._loadA; delete copy._powered;
  delete copy._overload; delete copy._cosPhi; delete copy._onBattery;
  delete copy._inputKw; delete copy._nominalA; delete copy._ratedA; delete copy._inrushA;
  delete copy._calcKw;
  state.nodes.set(id, copy);
  selectNode(id);
  render();
  notifyChange();
  flash('Вставлено: ' + copy.tag);
}

export function duplicateSelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  pasteNode(40, 40);
}

/* ---- Pending-line helpers ---- */
function cancelPending() {
  if (!state.pending) return;
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  render();
}

// Завершение pending при отпускании/клике над портом.
// portEl -- DOM-элемент .port, над которым закончилось действие.
function finishPendingAtPort(portEl) {
  if (!state.pending) return;
  if (state.readOnly) { cancelPending(); return; }

  const s = state.pending;
  const nodeId = portEl.dataset.nodeId;
  const kind = portEl.dataset.portKind;
  const idx  = Number(portEl.dataset.portIdx);

  // Концы должны быть разных типов: один out, другой in
  if (s.startKind === kind) {
    flash('Соединение возможно только между выходом и входом', 'error');
    cancelPending();
    return;
  }
  const outEnd = s.startKind === 'out'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };
  const inEnd  = s.startKind === 'in'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };

  if (outEnd.nodeId === inEnd.nodeId) {
    flash('Нельзя замыкать узел на себя', 'error');
    cancelPending();
    return;
  }

  // === Жёсткие проверки ===
  // 1) Вход может иметь не более одной входящей связи
  // 2) Выход может иметь не более одной исходящей связи
  const existingId = s.reconnectConnId || null;
  const duplicateIn = [...state.conns.values()].some(c =>
    c.id !== existingId && c.to.nodeId === inEnd.nodeId && c.to.port === inEnd.port);
  if (duplicateIn) {
    flash('На этом входе уже есть линия. Сначала отключите её.', 'error');
    cancelPending();
    return;
  }
  const duplicateOut = [...state.conns.values()].some(c =>
    c.id !== existingId && c.from.nodeId === outEnd.nodeId && c.from.port === outEnd.port);
  if (duplicateOut) {
    flash('С этого выхода уже идёт линия. От одного выхода можно только одну.', 'error');
    cancelPending();
    return;
  }
  if (wouldCreateCycle(outEnd.nodeId, inEnd.nodeId)) {
    flash('Такое соединение создаст цикл', 'error');
    cancelPending();
    return;
  }

  // Reconnect существующей линии (rewire)
  if (existingId) {
    const existing = state.conns.get(existingId);
    if (existing) {
      snapshot();
      existing.from = outEnd;
      existing.to = inEnd;
      state.pending = null;
      clearPending();
      svg.classList.remove('connecting');
      render();
      notifyChange();
      return;
    }
  }

  // Новая связь
  const cid = tryConnect(outEnd, inEnd);
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  if (cid) { selectConn(cid); render(); }
  else flash('Не удалось создать связь', 'error');
}

function drawPending() {
  clearPending();
  if (!state.pending) return;
  const p = state.pending;
  const node = state.nodes.get(p.startNodeId);
  if (!node) return;
  const a = portPos(node, p.startKind, p.startPort);
  const path = el('path', {
    class: 'pending-line',
    d: bezier(a, { x: p.mouseX, y: p.mouseY }),
  });
  path.id = '__pending';
  layerOver.appendChild(path);
}

function clearPending() {
  const p = document.getElementById('__pending');
  if (p) p.remove();
}

function drawRubberBand() {
  clearRubberBand();
  if (!state.rubberBand) return;
  const rb = state.rubberBand;
  const x = Math.min(rb.sx, rb.ex), y = Math.min(rb.sy, rb.ey);
  const w = Math.abs(rb.ex - rb.sx), h = Math.abs(rb.ey - rb.sy);
  const r = el('rect', {
    id: '__rubberband', class: 'rubber-band',
    x, y, width: w, height: h,
  });
  layerOver.appendChild(r);
}

function clearRubberBand() {
  const r = document.getElementById('__rubberband');
  if (r) r.remove();
}

/* ==================================================================
   initInteraction() -- wire up all DOM event listeners
   ================================================================== */
export function initInteraction() {

  // ---- Палитра: drag & drop (десктоп) + click-to-add (мобильный и шорткат) ----
  let _palDragActive = false;
  document.querySelectorAll('.pal-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      if (state.readOnly) { e.preventDefault(); return; }
      _palDragActive = true;
      e.dataTransfer.setData('text/raschet-type', item.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dragend', () => {
      setTimeout(() => { _palDragActive = false; }, 150);
    });
    item.addEventListener('click', () => {
      if (state.readOnly) return;
      if (_palDragActive) return; // был настоящий drag -- click не обрабатываем
      const type = item.dataset.type;
      if (!DEFAULTS[type]) return;
      const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
      const cx = state.view.x + (W / 2) / state.view.zoom;
      const cy = state.view.y + (H / 2) / state.view.zoom;
      createNode(type, cx, cy);
      document.body.classList.remove('palette-open');
    });
  });
  svg.addEventListener('dragover', e => { if (state.readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  svg.addEventListener('drop', e => {
    if (state.readOnly) return;
    e.preventDefault();
    const type = e.dataTransfer.getData('text/raschet-type');
    if (!type || !DEFAULTS[type]) return;
    const p = clientToSvg(e.clientX, e.clientY);
    createNode(type, p.x, p.y);
  });

  // ---- Мышь: mousedown ----
  svg.addEventListener('mousedown', e => {
    // Средняя кнопка мыши -> всегда пан холста, независимо от того что под курсором
    if (e.button === 1) {
      e.preventDefault();
      state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
      svg.classList.add('panning');
      return;
    }

    // Ресайз зоны: клик на угловую ручку -> тянем правый-нижний угол
    const zoneResizeEl = e.target.closest('.zone-resize');
    if (zoneResizeEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const zoneEl = zoneResizeEl.closest('.node.zone');
      const zoneId = zoneEl && zoneEl.dataset.nodeId;
      const zone = zoneId && state.nodes.get(zoneId);
      if (!zone) return;
      snapshot();
      const p = clientToSvg(e.clientX, e.clientY);
      const dir = zoneResizeEl.getAttribute('data-rz') || 'se';
      state.drag = {
        zoneResizeId: zone.id,
        zoneResizeDir: dir,
        startMouse: { x: p.x, y: p.y },
        startX: zone.x,
        startY: zone.y,
        startW: Number(zone.width) || 600,
        startH: Number(zone.height) || 400,
      };
      selectNode(zone.id);
      return;
    }

    // Rotation handle on tray-mode channel
    const rotEl = e.target.closest('.channel-rotate-handle');
    if (rotEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const nodeId = rotEl.dataset.rotateNodeId;
      const ch = nodeId && state.nodes.get(nodeId);
      if (!ch) return;
      snapshot();
      const tw = ch.trayWidth || 40;
      const tl = Math.max(80, (ch.lengthM || 10) * 4);
      state.drag = {
        rotateNodeId: ch.id,
        rotateCx: ch.x + tw / 2,
        rotateCy: ch.y + tl / 2,
      };
      return;
    }

    // Length handle on tray-mode channel
    const lenEl = e.target.closest('.channel-length-handle');
    if (lenEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const nodeId = lenEl.dataset.lengthNodeId;
      const ch = nodeId && state.nodes.get(nodeId);
      if (!ch) return;
      snapshot();
      const p = clientToSvg(e.clientX, e.clientY);
      state.drag = {
        lengthNodeId: ch.id,
        startMouseY: p.y,
        startLengthM: ch.lengthM || 10,
        channelAngle: (ch.trayAngle || 0) * Math.PI / 180,
        channelX: ch.x, channelY: ch.y,
      };
      return;
    }

    // Клик на кнопку '+' в середине сегмента -> добавляем waypoint в этой точке
    const addEl = e.target.closest('.conn-waypoint-add');
    if (addEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const cid = addEl.dataset.waypointAddId;
      const idx = Number(addEl.dataset.waypointAddIdx);
      const c = state.conns.get(cid);
      if (!c) return;
      snapshot();
      if (!Array.isArray(c.waypoints)) c.waypoints = [];
      const p = clientToSvg(e.clientX, e.clientY);
      c.waypoints.splice(idx, 0, { x: p.x, y: p.y });
      state.drag = { waypointConnId: cid, waypointIdx: idx };
      render();
      notifyChange();
      return;
    }
    // Клик на существующий waypoint -> перетаскиваем его.
    // Shift+клик удаляет waypoint.
    const wpEl = e.target.closest('.conn-waypoint');
    if (wpEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const cid = wpEl.dataset.waypointId;
      const idx = Number(wpEl.dataset.waypointIdx);
      const c = state.conns.get(cid);
      if (!c || !Array.isArray(c.waypoints)) return;
      if (e.shiftKey) {
        snapshot();
        c.waypoints.splice(idx, 1);
        render();
        notifyChange();
        return;
      }
      snapshot();
      state.drag = { waypointConnId: cid, waypointIdx: idx };
      return;
    }

    // Рукоятка reconnect: на выделенной связи есть два хэндла (to и from).
    // Перетаскивание одного из них позволяет переключить связь на другой порт
    // без удаления оригинальной.
    const handleEl = e.target.closest('.conn-handle');
    if (handleEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const cid = handleEl.dataset.reconnectId;
      const end = handleEl.dataset.reconnectEnd || 'to';
      const c = state.conns.get(cid);
      if (!c) return;
      // 'Якорь' -- конец, который НЕ двигается; с него начинается pending
      if (end === 'to') {
        state.pending = {
          startNodeId: c.from.nodeId, startKind: 'out', startPort: c.from.port,
          reconnectConnId: cid, mouseX: 0, mouseY: 0,
        };
      } else {
        state.pending = {
          startNodeId: c.to.nodeId, startKind: 'in', startPort: c.to.port,
          reconnectConnId: cid, mouseX: 0, mouseY: 0,
        };
      }
      const p = clientToSvg(e.clientX, e.clientY);
      state.pending.mouseX = p.x; state.pending.mouseY = p.y;
      svg.classList.add('connecting');
      render();
      drawPending();
      return;
    }

    // Порт -- начало/конец связи. Можно начинать С ЛЮБОГО порта.
    // Клик на порт -- всегда обрабатываем:
    //  - если pending пусто и порт СВОБОДНЫЙ -> начинаем новую связь, якорь = этот порт
    //  - если pending пусто и порт УЖЕ ЗАНЯТ -> подхватываем существующую связь:
    //    якорем становится ДРУГОЙ её конец, связь ждёт нового целевого клика
    //  - если pending активен -> завершаем связь в этот порт
    const portEl = e.target.closest('.port');
    if (portEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const nodeId = portEl.dataset.nodeId;
      const kind = portEl.dataset.portKind;
      const idx  = Number(portEl.dataset.portIdx);

      if (!state.pending) {
        // Ищем уже существующую связь на этом порту
        let existing = null;
        for (const c of state.conns.values()) {
          if (kind === 'in' && c.to.nodeId === nodeId && c.to.port === idx) { existing = c; break; }
          if (kind === 'out' && c.from.nodeId === nodeId && c.from.port === idx) { existing = c; break; }
        }

        const p = clientToSvg(e.clientX, e.clientY);

        if (existing) {
          // Подхватываем линию: якорь -- противоположный конец, сам клик 'отсоединил' её
          // от того порта, по которому кликнули.
          if (kind === 'in') {
            state.pending = {
              startNodeId: existing.from.nodeId,
              startKind: 'out',
              startPort: existing.from.port,
              reconnectConnId: existing.id,
              mouseX: p.x, mouseY: p.y, moved: false,
              _startPortEl: portEl,
              _clickedPortNodeId: nodeId,
              _clickedPortKind: kind,
              _clickedPortIdx: idx,
            };
          } else {
            state.pending = {
              startNodeId: existing.to.nodeId,
              startKind: 'in',
              startPort: existing.to.port,
              reconnectConnId: existing.id,
              mouseX: p.x, mouseY: p.y, moved: false,
              _startPortEl: portEl,
              _clickedPortNodeId: nodeId,
              _clickedPortKind: kind,
              _clickedPortIdx: idx,
            };
          }
          svg.classList.add('connecting');
          flash('Линия снята. Кликните по новому порту, чтобы переподключить. Esc -- отмена.');
          drawPending();
        } else {
          // Свободный порт -- начинаем новую связь
          state.pending = {
            startNodeId: nodeId, startKind: kind, startPort: idx,
            mouseX: p.x, mouseY: p.y, moved: false,
            _startPortEl: portEl,
          };
          svg.classList.add('connecting');
          drawPending();
        }
      } else {
        // Pending активен -- завершаем связь в этот порт.
        const s = state.pending;
        // Клик в якорный порт -- отмена
        if (s.startNodeId === nodeId && s.startKind === kind && s.startPort === idx) {
          cancelPending();
          return;
        }
        // Клик в тот же порт, с которого подхватили линию (reconnect) -- отмена,
        // линия остаётся на своём месте как и была
        if (s.reconnectConnId
            && s._clickedPortNodeId === nodeId
            && s._clickedPortKind === kind
            && s._clickedPortIdx === idx) {
          cancelPending();
          return;
        }
        finishPendingAtPort(portEl);
      }
      return;
    }

    // Связь
    const connEl = e.target.closest('.conn-hit, .conn');
    if (connEl && connEl.dataset.connId) {
      const cid = connEl.dataset.connId;
      if (e.shiftKey && !state.readOnly) { deleteConn(cid); return; }
      selectConn(cid);
      render();
      return;
    }

    // Нода
    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId;
      // Shift+клик -- toggle в мульти-выделении
      if (e.shiftKey) {
        if (state.selection.has(id)) state.selection.delete(id);
        else state.selection.add(id);
        render();
        return;
      }
      // Ctrl+drag -- клонировать узел и начать таскать копию
      if ((e.ctrlKey || e.metaKey) && !state.readOnly) {
        const original = state.nodes.get(id);
        if (original && original.type !== 'zone') {
          snapshot();
          _clipboardNode = JSON.parse(JSON.stringify(original));
          pasteNode(0, 0); // вставит со смещением 0,0 -- на том же месте
          // Начинаем drag копии (она стала selectedId)
          const copyId = state.selectedId;
          const copy = state.nodes.get(copyId);
          if (copy) {
            const p = clientToSvg(e.clientX, e.clientY);
            state.drag = { nodeId: copyId, dx: p.x - copy.x, dy: p.y - copy.y };
          }
          render();
          return;
        }
      }
      // Обычный клик -- одиночное выделение
      state.selection.clear();
      selectNode(id);
      if (!state.readOnly) {
        snapshot();
        const n = state.nodes.get(id);
        const p = clientToSvg(e.clientX, e.clientY);
        if (n.type === 'zone') {
          const children = nodesInZone(n).map(ch => ({
            id: ch.id, dx: ch.x - n.x, dy: ch.y - n.y,
          }));
          state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y, children };
        } else {
          state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y };
        }
      }
      render();
      return;
    }

    // Пустое место
    if (e.shiftKey) {
      // Shift + drag по пустому -> рамка выделения
      const p = clientToSvg(e.clientX, e.clientY);
      state.rubberBand = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
      state.selection.clear();
      svg.classList.add('panning');
      return;
    }
    // Обычный drag -> пан
    state.selection.clear();
    state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.classList.add('panning');
    state.selectedKind = null; state.selectedId = null;
    renderInspector();
    render();
  });

  // ---- mousemove ----
  window.addEventListener('mousemove', e => {
    // Рамка мульти-выделения
    if (state.rubberBand) {
      const p = clientToSvg(e.clientX, e.clientY);
      state.rubberBand.ex = p.x;
      state.rubberBand.ey = p.y;
      drawRubberBand();
      return;
    }
    // Length drag for tray-mode channels
    if (state.drag && state.drag.lengthNodeId) {
      const ch = state.nodes.get(state.drag.lengthNodeId);
      if (ch) {
        const p = clientToSvg(e.clientX, e.clientY);
        const angle = state.drag.channelAngle;
        // Project mouse movement onto channel axis
        const dx = p.x - (state.drag.channelX + (ch.trayWidth || 40) / 2);
        const dy = p.y - (state.drag.channelY + Math.max(80, state.drag.startLengthM * 4) / 2);
        // Distance along axis from center (positive = towards bottom end)
        const axX = Math.sin(angle);
        const axY = -Math.cos(angle);
        const proj = dx * axX + dy * axY;
        // Convert to meters: halfLength in px = proj, so totalLength = 2*proj/4
        const newLengthM = Math.max(1, Math.round(proj * 2 / 4));
        ch.lengthM = newLengthM;
        render();
      }
      return;
    }
    // Rotation drag for tray-mode channels
    if (state.drag && state.drag.rotateNodeId) {
      const ch = state.nodes.get(state.drag.rotateNodeId);
      if (ch) {
        const p = clientToSvg(e.clientX, e.clientY);
        const cx = state.drag.rotateCx;
        const cy = state.drag.rotateCy;
        let angle = Math.atan2(p.x - cx, -(p.y - cy)) * 180 / Math.PI; // 0° = up
        // Snap to 15° increments unless Alt key held
        if (!e.altKey) {
          angle = Math.round(angle / 15) * 15;
        }
        // Normalize to 0-360
        angle = ((angle % 360) + 360) % 360;
        ch.trayAngle = angle;
        render();
      }
      return;
    }
    if (state.drag && state.drag.zoneResizeId) {
      const z = state.nodes.get(state.drag.zoneResizeId);
      if (z) {
        const p = clientToSvg(e.clientX, e.clientY);
        const dx = p.x - state.drag.startMouse.x;
        const dy = p.y - state.drag.startMouse.y;
        const dir = state.drag.zoneResizeDir || 'se';
        const gs = GLOBAL.gridStep || 40;
        const snap = (v) => GLOBAL.snapToGrid !== false && !e.altKey ? Math.round(v / gs) * gs : v;

        let nx = state.drag.startX;
        let ny = state.drag.startY;
        let nw = state.drag.startW;
        let nh = state.drag.startH;

        // Восток (правая граница)
        if (dir.includes('e')) nw = snap(state.drag.startW + dx);
        // Запад (левая граница — сдвигает x и уменьшает w)
        if (dir.includes('w')) { nx = snap(state.drag.startX + dx); nw = state.drag.startW - (nx - state.drag.startX); }
        // Юг (нижняя граница)
        if (dir.includes('s')) nh = snap(state.drag.startH + dy);
        // Север (верхняя граница — сдвигает y и уменьшает h)
        if (dir === 'n' || dir === 'nw' || dir === 'ne') { ny = snap(state.drag.startY + dy); nh = state.drag.startH - (ny - state.drag.startY); }

        nw = Math.max(200, nw);
        nh = Math.max(120, nh);

        z.x = nx;
        z.y = ny;
        z.width = nw;
        z.height = nh;
        render();
      }
      return;
    }
    if (state.drag && state.drag.waypointConnId) {
      const c = state.conns.get(state.drag.waypointConnId);
      if (c && Array.isArray(c.waypoints)) {
        const p = clientToSvg(e.clientX, e.clientY);
        let nx = p.x, ny = p.y;
        // Сначала проверяем привязку к центру канала-трассы (приоритет)
        const SNAP_R = 25;
        let snapped = false;
        for (const ch of state.nodes.values()) {
          if (ch.type !== 'channel' || !ch.trayMode) continue;
          const tw = ch.trayWidth || 40;
          const tl = Math.max(80, (ch.lengthM || 10) * 4);
          const cx = ch.x + tw / 2;
          const cy = ch.y + tl / 2;
          if (Math.hypot(nx - cx, ny - cy) < SNAP_R) {
            nx = cx; ny = cy;
            if (!Array.isArray(c.channelIds)) c.channelIds = [];
            if (!c.channelIds.includes(ch.id)) c.channelIds.push(ch.id);
            snapped = true;
            break;
          }
        }
        // Если не привязались к каналу — привязка к сетке
        if (!snapped && !e.altKey) {
          nx = (GLOBAL.snapToGrid !== false ? Math.round(nx / (GLOBAL.gridStep || 40)) * (GLOBAL.gridStep || 40) : nx);
          ny = (GLOBAL.snapToGrid !== false ? Math.round(ny / (GLOBAL.gridStep || 40)) * (GLOBAL.gridStep || 40) : ny);
        }
        if (!snapped) {
          _removeWaypointChannelSnap(c);
        }
        c.waypoints[state.drag.waypointIdx] = { x: nx, y: ny };
        render();
      }
      return;
    }
    if (state.drag && state.drag.nodeId) {
      const p = clientToSvg(e.clientX, e.clientY);
      const n = state.nodes.get(state.drag.nodeId);
      let nx = p.x - state.drag.dx;
      let ny = p.y - state.drag.dy;
      // Snap to grid 40 -- держим Alt чтобы отключить привязку
      if (!e.altKey) {
        nx = (GLOBAL.snapToGrid !== false ? Math.round(nx / (GLOBAL.gridStep || 40)) * (GLOBAL.gridStep || 40) : nx);
        ny = (GLOBAL.snapToGrid !== false ? Math.round(ny / (GLOBAL.gridStep || 40)) * (GLOBAL.gridStep || 40) : ny);
      }
      // Для каналов в режиме трассы — привязка ЦЕНТРА к сетке
      if (n.type === 'channel' && n.trayMode && !e.altKey && GLOBAL.snapToGrid !== false) {
        const gs = GLOBAL.gridStep || 40;
        const tw = n.trayWidth || 40;
        const tl = Math.max(80, (n.lengthM || 10) * 4);
        const cx = Math.round((nx + tw / 2) / gs) * gs;
        const cy = Math.round((ny + tl / 2) / gs) * gs;
        nx = cx - tw / 2;
        ny = cy - tl / 2;
      }
      // Перемещение канала-трассы перемещает привязанные waypoints
      if (n.type === 'channel' && n.trayMode) {
        const dx = nx - n.x;
        const dy = ny - n.y;
        if (dx !== 0 || dy !== 0) {
          const tw = n.trayWidth || 40;
          const tl = Math.max(80, (n.lengthM || 10) * 4);
          const oldCx = n.x + tw / 2;
          const oldCy = n.y + tl / 2;
          const newCx = nx + tw / 2;
          const newCy = ny + tl / 2;
          for (const c of state.conns.values()) {
            const wps = Array.isArray(c.waypoints) ? c.waypoints : [];
            for (const wp of wps) {
              if (Math.hypot(wp.x - oldCx, wp.y - oldCy) < 5) {
                wp.x = newCx;
                wp.y = newCy;
              }
            }
          }
        }
      }
      n.x = nx;
      n.y = ny;
      // Тащим детей вместе с зоной
      if (state.drag.children) {
        for (const ch of state.drag.children) {
          const cn = state.nodes.get(ch.id);
          if (cn) {
            cn.x = nx + ch.dx;
            cn.y = ny + ch.dy;
          }
        }
      }
      render();
    } else if (state.drag && state.drag.pan) {
      const dx = (e.clientX - state.drag.sx) / state.view.zoom;
      const dy = (e.clientY - state.drag.sy) / state.view.zoom;
      state.view.x = state.drag.vx - dx;
      state.view.y = state.drag.vy - dy;
      updateViewBox();
    }
    if (state.pending) {
      const p = clientToSvg(e.clientX, e.clientY);
      // Помечаем, что произошло реальное перемещение (более 3 пикселей)
      if (!state.pending.moved) {
        const dx = Math.abs((state.pending.mouseX || 0) - p.x);
        const dy = Math.abs((state.pending.mouseY || 0) - p.y);
        if (dx > 3 || dy > 3) state.pending.moved = true;
      }
      state.pending.mouseX = p.x; state.pending.mouseY = p.y;
      drawPending();
    }
  });

  // ---- mouseup ----
  window.addEventListener('mouseup', (e) => {
    // Завершение рамки выделения
    if (state.rubberBand) {
      const rb = state.rubberBand;
      const x1 = Math.min(rb.sx, rb.ex), y1 = Math.min(rb.sy, rb.ey);
      const x2 = Math.max(rb.sx, rb.ex), y2 = Math.max(rb.sy, rb.ey);
      state.selection.clear();
      for (const n of state.nodes.values()) {
        if (n.type === 'zone') continue;
        const nw = nodeWidth(n), nh = nodeHeight(n);
        // Узел выделяется, если пересекается с рамкой
        if (n.x + nw >= x1 && n.x <= x2 && n.y + nh >= y1 && n.y <= y2) {
          state.selection.add(n.id);
        }
      }
      state.rubberBand = null;
      clearRubberBand();
      svg.classList.remove('panning');
      render();
      if (state.selection.size) flash(`Выделено: ${state.selection.size}`);
      return;
    }
    if (state.drag) {
      const wasNodeDrag = !!state.drag.nodeId;
      const wasWpDrag = !!state.drag.waypointConnId;
      const wasZoneResize = !!state.drag.zoneResizeId;
      const wasRotate = !!state.drag.rotateNodeId;
      const wasLength = !!state.drag.lengthNodeId;
      const draggedNodeId = state.drag.nodeId;
      const hadChildren = !!(state.drag.children && state.drag.children.length);
      svg.classList.remove('panning');
      state.drag = null;
      // Членство в зоне обновляется только в момент отпускания мыши после
      // обычного drag'а узла (не самой зоны и не группового drag-all).
      if (wasNodeDrag && draggedNodeId) {
        const dragged = state.nodes.get(draggedNodeId);
        if (dragged) {
          if (dragged.type === 'zone') {
            // Зона: проверяем вложенность в родительскую зону
            const parentZone = findParentZone(dragged);
            if (parentZone && !isNodeFullyInside(dragged, parentZone)) {
              parentZone.memberIds = (parentZone.memberIds || []).filter(id => id !== dragged.id);
            }
            if (!findParentZone(dragged)) {
              tryAttachToZone(dragged);
            }
          } else if (!hadChildren) {
            // Обычные узлы (не зоны и не групповой drag)
            const currentZone = findZoneForMember(dragged);
            if (currentZone && !isNodeFullyInside(dragged, currentZone)) {
              currentZone.memberIds = (currentZone.memberIds || []).filter(id => id !== dragged.id);
            }
            if (!findZoneForMember(dragged)) {
              tryAttachToZone(dragged);
            }
          }
          render();
        }
      }
      if (wasNodeDrag || wasWpDrag || wasZoneResize || wasRotate || wasLength) notifyChange();
    }
    // Завершение pending при отпускании мыши:
    //  - курсор не двигался -> ничего не делаем, pending живёт до второго клика
    //  - двигался и отпустил над другим портом -> drag-drop финиш
    //  - двигался и отпустил не над портом -> отменяем
    if (state.pending) {
      const moved = !!state.pending.moved;
      if (!moved) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = target && target.closest && target.closest('.port');
      if (portEl && portEl !== state.pending._startPortEl) {
        finishPendingAtPort(portEl);
      } else {
        cancelPending();
      }
    }
  });

  // Отмена ведения связи
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.pending) cancelPending();
  });

  // ---- keydown ----
  window.addEventListener('keydown', e => {
    // Undo / Redo работают даже когда фокус в input, это стандартное поведение
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (state.readOnly) return;
      e.preventDefault();
      _undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      if (state.readOnly) return;
      e.preventDefault();
      _redo();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    // Copy / Paste / Duplicate
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (state.readOnly) return;
      e.preventDefault();
      copySelectedNode();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (state.readOnly) return;
      e.preventDefault();
      pasteNode();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      if (state.readOnly) return;
      e.preventDefault();
      duplicateSelectedNode();
      return;
    }
    if (e.key === 'Escape' && state.pending) cancelPending();
    if (state.readOnly) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selection.size) {
        snapshot();
        for (const id of [...state.selection]) deleteNode(id);
        state.selection.clear();
        e.preventDefault();
      } else if (state.selectedKind === 'node' && state.selectedId) {
        deleteNode(state.selectedId); e.preventDefault();
      } else if (state.selectedKind === 'conn' && state.selectedId) {
        deleteConn(state.selectedId); e.preventDefault();
      }
    }
  });

  // ---- Зум колесом ----
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const before = clientToSvg(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.2, Math.min(4, state.view.zoom * factor));
    const rect = svg.getBoundingClientRect();
    state.view.x = before.x - (e.clientX - rect.left) / newZoom;
    state.view.y = before.y - (e.clientY - rect.top)  / newZoom;
    state.view.zoom = newZoom;
    updateViewBox();
  }, { passive: false });

  // ---- Тулбар zoom buttons ----
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('btn-zoom-in',    () => { state.view.zoom = Math.min(4, state.view.zoom * 1.2); updateViewBox(); });
  bind('btn-zoom-out',   () => { state.view.zoom = Math.max(0.2, state.view.zoom / 1.2); updateViewBox(); });
  bind('btn-zoom-reset', () => { state.view.zoom = 1; updateViewBox(); });
  bind('btn-fit',        () => _fitAll());
}
