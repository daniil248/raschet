/* interaction.js -- all canvas/palette event handling (ES module) */

import { state, svg, layerOver, uid, getCurrentPage, getPageKind } from './state.js';
import { NODE_H, SVG_NS, DEFAULTS, GLOBAL } from './constants.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight, portPos, getNodeGeometryMm } from './geometry.js';
import { snapshot, notifyChange } from './history.js';
import { selectNode, selectConn, renderInspector, clientToSvg } from './inspector.js';
import { render, updateViewBox, el, bezier } from './render.js';
import { createNode, deleteNode, deleteConn, tryConnect, wouldCreateCycle, nextFreeTag } from './graph.js';
import { tryAttachToZone, detachFromZones, findZoneForMember, findParentZone, isNodeFullyInside, nodesInZone, copyZoneWithMembers } from './zones.js';
import { flash } from './utils.js';
import { rsToast, rsConfirm } from '../../shared/dialog.js';

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
// Effective grid step for snap: schematic pages = GLOBAL.gridStep (40),
// layout pages = 10 mm (1 SVG unit = 1 mm), shift/ctrl = 1 mm fine snap.
// Phase 2.3 (v0.58.2): layout-aware drag snap.
function _effectiveSnapStep(e) {
  try {
    const kind = getPageKind(getCurrentPage());
    if (kind === 'layout') {
      // 1 mm при Shift для точного позиционирования, иначе 10 мм
      if (e && e.shiftKey) return 1;
      return 10;
    }
  } catch {}
  return GLOBAL.gridStep || 40;
}

// Collision helpers for layout pages (v0.58.12).
// На layout-странице объекты на одной высоте (n.floor) не могут пересекаться,
// ЗА ИСКЛЮЧЕНИЕМ случая, когда один полностью содержит другой (nesting:
// PDU в серверном шкафу, батарея в батарейном шкафу).
function _layoutFootprint(n, x, y) {
  const g = getNodeGeometryMm(n);
  const w = g?.widthMm || 400;
  const h = (g?.depthMm && g.depthMm > 0) ? g.depthMm : (g?.heightMm || 300);
  return { x, y, w, h };
}
function _rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function _rectContains(outer, inner) {
  const EPS = 0.5;
  return inner.x + EPS >= outer.x
      && inner.y + EPS >= outer.y
      && inner.x + inner.w <= outer.x + outer.w + EPS
      && inner.y + inner.h <= outer.y + outer.h + EPS;
}
// Phase 2.3 (v0.59.499): автоматическая расстановка новых элементов на
// layout-странице. Стратегия — staging-колонка слева:
//   • Якорь по X: если есть «не-авто» (вручную размещённые) ноды на
//     странице, staging-колонка ставится ЛЕВЕЕ их leftmost.x на 200 мм
//     (с учётом ширины нового). Иначе используется x уже существующих
//     auto-placed нод (продолжаем колонку), либо 100 мм если страница
//     пуста.
//   • Якорь по Y: bottom самого нижнего auto-placed узла + 50 мм. На
//     пустом staging — y=100.
// Узел получает n.layoutAutoPlaced=true. Когда пользователь руками
// перетаскивает узел, флаг сбрасывается (см. mouseup-обработчик), и
// узел перестаёт «занимать» слот в staging-колонке для следующих новых.
function _layoutAutoPlacePos(type, opts) {
  try {
    const page = getCurrentPage();
    if (!page || getPageKind(page) !== 'layout') return null;
    const pageId = page.id;
    // Габариты будущей ноды — конструируем pseudo-node чтобы прогнать
    // через getNodeGeometryMm. DEFAULTS может быть функцией (subtype).
    const defaults = typeof DEFAULTS[type] === 'function'
      ? DEFAULTS[type](opts && opts.subtype)
      : DEFAULTS[type] || {};
    const tmp = { type, ...defaults };
    if (opts && opts.subtype) tmp.subtype = opts.subtype;
    const g = getNodeGeometryMm(tmp);
    const newW = (g && g.widthMm > 0) ? g.widthMm : 600;
    const newH = (g && g.depthMm > 0) ? g.depthMm : ((g && g.heightMm > 0) ? g.heightMm : 600);

    const onPage = [];
    for (const n of state.nodes.values()) {
      const pids = Array.isArray(n.pageIds) ? n.pageIds : [];
      if (!pids.includes(pageId)) continue;
      if (n.type === 'zone' || n.type === 'channel') continue;
      onPage.push(n);
    }
    const placed   = onPage.filter(n => !n.layoutAutoPlaced);
    const staged   = onPage.filter(n =>  n.layoutAutoPlaced);

    let stageX;
    if (placed.length) {
      const minX = Math.min(...placed.map(n => Number(n.x) || 0));
      stageX = Math.round(minX - newW - 200);
    } else if (staged.length) {
      stageX = Math.round(Math.min(...staged.map(n => Number(n.x) || 0)));
    } else {
      stageX = 100;
    }

    let stageY = 100;
    if (staged.length) {
      let bottomY = 100;
      for (const sn of staged) {
        const sg = getNodeGeometryMm(sn);
        const sh = (sg && sg.depthMm > 0) ? sg.depthMm : ((sg && sg.heightMm > 0) ? sg.heightMm : 600);
        const sy = (Number(sn.y) || 0) + sh;
        if (sy > bottomY) bottomY = sy;
      }
      stageY = bottomY + 50;
    }
    return { x: stageX, y: stageY, widthMm: newW, heightMm: newH };
  } catch { return null; }
}

function _layoutCollides(n, nx, ny) {
  const pageId = state.currentPageId;
  if (!pageId) return false;
  const myFloor = Number(n.floor) || 0;
  const myFoot = _layoutFootprint(n, nx, ny);
  for (const other of state.nodes.values()) {
    if (!other || other.id === n.id) continue;
    if (other.type === 'zone' || other.type === 'channel') continue;
    const pids = Array.isArray(other.pageIds) ? other.pageIds : [];
    if (!pids.includes(pageId)) continue;
    const otherFloor = Number(other.floor) || 0;
    if (otherFloor !== myFloor) continue;
    const posOverride = other.positionsByPage && other.positionsByPage[pageId];
    const ox = posOverride ? posOverride.x : other.x;
    const oy = posOverride ? posOverride.y : other.y;
    const oFoot = _layoutFootprint(other, ox, oy);
    if (!_rectsOverlap(myFoot, oFoot)) continue;
    // nesting exception: один полностью внутри другого
    if (_rectContains(oFoot, myFoot) || _rectContains(myFoot, oFoot)) continue;
    return true;
  }
  return false;
}

// Remove channelIds that no longer have a waypoint snapped to their center
function _removeWaypointChannelSnap(c) {
  if (!Array.isArray(c.channelIds) || !c.channelIds.length) return;
  const wps = Array.isArray(c.waypoints) ? c.waypoints : [];
  const SNAP_R = 5;
  c.channelIds = c.channelIds.filter(chId => {
    const ch = state.nodes.get(chId);
    if (!ch || !ch.trayMode) return true; // keep non-tray channels (assigned manually)
    const tw = ch.trayWidth || 40;
    const tl = (ch.trayLength || 120);
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
  // Проверка цикличности отключена — допускаются схемы с АВР и встречными линиями

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
  else {
    // v0.58.20: диагностика — проверяем систему endpoints
    const fromN = state.nodes.get(outEnd.nodeId);
    const toN = state.nodes.get(inEnd.nodeId);
    const sys = (n) => {
      if (!n) return ['electrical'];
      // v0.59.100: channel — только кабельные системы.
      if (n.type === 'channel') {
        const base = ['electrical','low-voltage','data','fire','security','video'];
        return (Array.isArray(n.systems) && n.systems.length)
          ? n.systems.filter(s => base.includes(s)) : base;
      }
      if (Array.isArray(n.systems) && n.systems.length) return n.systems;
      if (n.type === 'zone') return ['electrical','low-voltage','data','pipes','hvac','gas','fire','security','video'];
      return ['electrical'];
    };
    const shared = fromN && toN && sys(fromN).some(s => sys(toN).includes(s));
    if (fromN && toN && !shared) {
      flash('Нет общей системы: выберите пересекающиеся системы во вкладке «🧩 Системы»', 'error');
    } else {
      flash('Не удалось создать связь', 'error');
    }
  }
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

  // ---- Палитра: только drag & drop (click-to-add удалён по запросу) ----
  let _palDragActive = false;
  // Раскрытие type-секций палитры
  document.querySelectorAll('.pal-type-head').forEach(head => {
    head.addEventListener('click', (e) => {
      const sec = head.closest('.pal-type');
      if (sec) sec.classList.toggle('collapsed');
    });
  });
  // Раскрытие burger-групп внутри секций (для source с подтипами)
  document.querySelectorAll('.pal-group .pal-expand').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const group = btn.closest('.pal-group');
      if (group) group.classList.toggle('expanded');
    });
  });
  // dragstart / dragend для всех pal-items (базовые + пресеты)
  const bindPalItem = (item) => {
    if (item._palBound) return;
    item._palBound = true;
    item.addEventListener('dragstart', e => {
      if (state.readOnly) { e.preventDefault(); return; }
      _palDragActive = true;
      const presetId = item.dataset.presetId;
      if (presetId) {
        e.dataTransfer.setData('text/raschet-preset', presetId);
      } else {
        e.dataTransfer.setData('text/raschet-type', item.dataset.type || '');
        if (item.dataset.subtype) {
          e.dataTransfer.setData('text/raschet-subtype', item.dataset.subtype);
        }
        if (item.dataset.isMv) {
          e.dataTransfer.setData('text/raschet-ismv', '1');
        }
        // v0.59.327: клеммная коробка — panel с initSwitchMode='terminal'.
        if (item.dataset.initSwitchMode) {
          e.dataTransfer.setData('text/raschet-switchmode', item.dataset.initSwitchMode);
        }
      }
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dragend', () => {
      setTimeout(() => { _palDragActive = false; }, 150);
    });
  };
  document.querySelectorAll('.pal-item').forEach(bindPalItem);
  // Эскпонируем для повторного применения после render пресетов
  if (typeof window !== 'undefined') window.__raschetBindPalItem = bindPalItem;

  // v0.58.11: dragstart и click для «Неразмещённых» элементов.
  // Делегируем события на контейнер — он перерисовывается при каждом
  // render(), поэтому слушатели на конкретных детях теряются.
  const unplacedList = document.getElementById('pal-unplaced-list');
  if (unplacedList) {
    unplacedList.addEventListener('dragstart', e => {
      const item = e.target.closest('.pal-unplaced-item');
      if (!item || state.readOnly) { e.preventDefault(); return; }
      const id = item.dataset.unplacedId;
      if (!id) { e.preventDefault(); return; }
      _palDragActive = true;
      e.dataTransfer.setData('text/raschet-unplaced-id', id);
      // v0.58.43: 'copyMove' совместимо с dropEffect='copy' на canvas — иначе
      // браузер отклоняет drop и пользователь видит только курсор-запрет.
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    unplacedList.addEventListener('dragend', () => {
      setTimeout(() => { _palDragActive = false; }, 150);
    });
    // v0.58.43: click-to-place убран — пользователю нужно только перетаскивание.
    // v0.59.334: × во вкладке «Неразмещённые» удаляет узел из проекта (с тем
    // же guard'ом, что и в реестре — проверяем pageIds=0 и conn-count=0).
    unplacedList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.pal-reg-del');
      if (!delBtn) return;
      e.stopPropagation();
      const id = delBtn.dataset.delId;
      const n0 = state.nodes.get(id);
      if (!n0) return;
      const label = (n0.name || n0.tag) || id;
      const pids = Array.isArray(n0.pageIds) ? n0.pageIds.length : 0;
      if (pids > 0) {
        flash(`«${label}» размещён на ${pids} стр. — сначала снимите его со всех холстов`, 'error');
        return;
      }
      let cc = 0;
      for (const k of state.conns.values()) {
        if (k.from?.nodeId === id || k.to?.nodeId === id) cc++;
      }
      if (state.sysConns) {
        for (const k of state.sysConns.values()) {
          if (k.from?.nodeId === id || k.to?.nodeId === id) cc++;
        }
      }
      if (cc > 0) {
        flash(`«${label}» имеет ${cc} подключённых линий — сначала снимите их`, 'error');
        return;
      }
      (async () => {
        const ok = await rsConfirm(
          `Удалить «${label}» из проекта?`,
          `Элемент нигде не размещён и не имеет подключений. Можно отменить через Ctrl+Z.`,
          { okLabel: 'Удалить', cancelLabel: 'Отмена' });
        if (!ok) return;
        deleteNode(id, { hard: true, silent: true });
        notifyChange(); render();
      })();
    });
  }
  // v0.58.13: вкладки инспектора (Свойства / Неразмещённые / Реестр)
  const inspTabs = document.querySelectorAll('.insp-tab');
  if (inspTabs && inspTabs.length) {
    inspTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.inspTab;
        document.querySelectorAll('.insp-tab').forEach(b => {
          const on = b.dataset.inspTab === key;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.insp-panel').forEach(p => {
          p.hidden = p.dataset.inspPanel !== key;
        });
      });
    });
  }

  // v0.58.13: реестр элементов — клик/+/×/создать-без-размещения.
  const regList = document.getElementById('pal-registry-list');
  if (regList) {
    // v0.58.19: drag из реестра — тот же transfer-тип, что и в unplaced
    regList.addEventListener('dragstart', e => {
      const item = e.target.closest('.pal-reg-item');
      if (!item || state.readOnly) return;
      // Кнопки +/× не должны инициировать drag
      if (e.target.closest('.pal-reg-place, .pal-reg-del')) { e.preventDefault(); return; }
      const id = item.dataset.regId;
      if (!id) return;
      _palDragActive = true;
      e.dataTransfer.setData('text/raschet-unplaced-id', id);
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    regList.addEventListener('dragend', () => {
      setTimeout(() => { _palDragActive = false; }, 150);
    });
    regList.addEventListener('click', e => {
      if (state.readOnly) return;
      const placeBtn = e.target.closest('.pal-reg-place');
      if (placeBtn) {
        e.stopPropagation();
        const id = placeBtn.dataset.placeId;
        const n = state.nodes.get(id);
        if (!n) return;
        snapshot('registry-place:' + id);
        const svgEl = document.getElementById('canvas') || svg;
        const W = svgEl.clientWidth, H = svgEl.clientHeight;
        const zoom = state.view.zoom || 1;
        const cx = (state.view.x || 0) + (W / zoom) / 2;
        const cy = (state.view.y || 0) + (H / zoom) / 2;
        if (!Array.isArray(n.pageIds)) n.pageIds = [];
        if (!n.pageIds.includes(state.currentPageId)) n.pageIds.push(state.currentPageId);
        n.x = Math.round(cx - 100); n.y = Math.round(cy - 50);
        if (!n.positionsByPage) n.positionsByPage = {};
        n.positionsByPage[state.currentPageId] = { x: n.x, y: n.y };
        notifyChange(); render();
        flash('Добавлено на страницу');
        return;
      }
      const delBtn = e.target.closest('.pal-reg-del');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.dataset.delId;
        const n0 = state.nodes.get(id);
        const label = n0 && (n0.name || n0.tag) || id;
        const pids = n0 && Array.isArray(n0.pageIds) ? n0.pageIds.length : 0;
        // v0.59.331: блокируем хард-удаление из реестра, если элемент ещё
        // размещён хотя бы на одной странице. Пользователь должен сперва
        // снять его со всех холстов.
        if (pids > 0) {
          flash(`«${label}» размещён на ${pids} стр. — сначала снимите его со всех холстов, затем удаляйте из реестра`, 'error');
          return;
        }
        // v0.59.334: блокируем хард-удаление, если к узлу ещё привязаны линии
        // (иначе удаление оставит сиротские conn/sysConn в других проекциях).
        let connCount = 0;
        for (const k of state.conns.values()) {
          if (k.from?.nodeId === id || k.to?.nodeId === id) connCount++;
        }
        if (state.sysConns) {
          for (const k of state.sysConns.values()) {
            if (k.from?.nodeId === id || k.to?.nodeId === id) connCount++;
          }
        }
        if (connCount > 0) {
          flash(`«${label}» имеет ${connCount} подключённых линий — сначала снимите их, затем удаляйте из реестра`, 'error');
          return;
        }
        (async () => {
          const ok = await rsConfirm(
            `Удалить «${label}» из проекта?`,
            `Элемент хранится в реестре без размещения. Можно отменить через Ctrl+Z.`,
            { okLabel: 'Удалить', cancelLabel: 'Отмена' });
          if (!ok) return;
          deleteNode(id, { hard: true, silent: true });
          notifyChange(); render();
        })();
        return;
      }
      const item = e.target.closest('.pal-reg-item');
      if (item) {
        const id = item.dataset.regId;
        const n = state.nodes.get(id);
        if (n) {
          // Переключаемся на вкладку Свойства и открываем инспектор
          const propsTab = document.querySelector('.insp-tab[data-insp-tab="props"]');
          if (propsTab) propsTab.click();
          selectNode(id);
        }
      }
    });
  }
  const regAddBtn = document.getElementById('pal-registry-add');
  if (regAddBtn) {
    regAddBtn.addEventListener('click', () => {
      if (state.readOnly) return;
      const sel = document.getElementById('pal-registry-new-type');
      let type = sel ? sel.value : 'consumer';
      let isMv = false;
      if (type === 'panel-mv') { type = 'panel'; isMv = true; }
      if (!DEFAULTS[type]) { flash('Неизвестный тип', 'error'); return; }
      snapshot('registry-new:' + type);
      // Создаём «виртуально» — далеко от canvas, pageIds=[] (без размещения)
      const newId = createNode(type, 0, 0);
      if (!newId) return;
      const node = state.nodes.get(newId);
      if (node) {
        node.pageIds = []; // без размещения
        if (isMv) node.isMv = true;
      }
      notifyChange(); render();
      flash('Элемент создан в реестре');
    });
  }

  // v0.59.143: patch-link для инфо-портов. Mousedown (capture) по кружку-
  // коннектору (.sys-port-connector) — первый клик ставит sysPending, второй
  // клик по другому кружку той же системы создаёт patch-link. Esc — отмена.
  // Правило 1:1 — на каждый конкретный кружок не более одного patch-link'а.
  // Используем mousedown+capture, чтобы перехватить до drag/select-логики
  // основного mousedown-хендлера на svg.
  svg.addEventListener('mousedown', e => {
    if (state.readOnly) return;
    if (e.button !== 0) return;
    const circ = e.target.closest && e.target.closest('circle.sys-port-connector');
    if (!circ) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeId  = circ.dataset.nodeId;
    const sysId   = circ.dataset.sysId || '';
    const portKey = circ.dataset.portKey;
    const portIdx = Number(circ.dataset.portIdx);
    if (!nodeId || !portKey || !Number.isFinite(portIdx)) return;
    // Уже занят patch-link'ом? (1:1)
    const isOccupied = (nId, pK, pI) => {
      for (const sc of state.sysConns.values()) {
        if ((sc.fromNodeId === nId && sc.fromPortKey === pK && sc.fromPortIdx === pI) ||
            (sc.toNodeId   === nId && sc.toPortKey   === pK && sc.toPortIdx   === pI)) return sc.id;
      }
      return null;
    };
    const occ = isOccupied(nodeId, portKey, portIdx);
    // Если этот порт уже занят — удаляем существующий patch-link.
    if (occ) {
      snapshot('sys-patch-remove:' + occ);
      state.sysConns.delete(occ);
      state.sysPending = null;
      try { notifyChange(); } catch {}
      render();
      return;
    }
    // Первый клик — запоминаем. Подсветка (оранжевое кольцо) вычисляется
    // в render() из state.sysPending, поэтому переживает любые rerender'ы.
    if (!state.sysPending) {
      state.sysPending = { fromNodeId: nodeId, fromPortKey: portKey, fromPortIdx: portIdx, sysId };
      render();
      return;
    }
    // Второй клик — проверяем и создаём.
    const p = state.sysPending;
    if (p.fromNodeId === nodeId && p.fromPortKey === portKey && p.fromPortIdx === portIdx) {
      // Клик по тому же кружку — отмена.
      state.sysPending = null;
      render();
      return;
    }
    if (p.sysId && sysId && p.sysId !== sysId) {
      rsToast('Patch-link соединяет порты одной системы. Источник: ' + p.sysId + ', цель: ' + sysId, 'warn');
      return;
    }
    // Создаём.
    const id = uid('sc');
    snapshot('sys-patch-create:' + id);
    state.sysConns.set(id, {
      id, sysId: sysId || p.sysId,
      fromNodeId: p.fromNodeId, fromPortKey: p.fromPortKey, fromPortIdx: p.fromPortIdx,
      toNodeId: nodeId,         toPortKey: portKey,         toPortIdx: portIdx,
    });
    state.sysPending = null;
    try { notifyChange(); } catch {}
    render();
  }, true);

  svg.addEventListener('dragover', e => { if (state.readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  svg.addEventListener('drop', e => {
    if (state.readOnly) return;
    e.preventDefault();
    // v0.58.11: drop «Неразмещённого» — добавить n.pageIds текущей страницы
    const unplacedId = e.dataTransfer.getData('text/raschet-unplaced-id');
    if (unplacedId) {
      const n = state.nodes.get(unplacedId);
      if (n) {
        snapshot('place-unplaced-drop:' + unplacedId);
        const p = clientToSvg(e.clientX, e.clientY);
        if (!Array.isArray(n.pageIds)) n.pageIds = [];
        if (!n.pageIds.includes(state.currentPageId)) n.pageIds.push(state.currentPageId);
        n.x = Math.round(p.x - 100);
        n.y = Math.round(p.y - 50);
        if (!n.positionsByPage) n.positionsByPage = {};
        n.positionsByPage[state.currentPageId] = { x: n.x, y: n.y };
        notifyChange();
        render();
      }
      return;
    }
    const presetId = e.dataTransfer.getData('text/raschet-preset');
    if (presetId && window.Presets) {
      const preset = window.Presets.get(presetId);
      if (preset && window.Raschet && window.Raschet.applyPresetAt) {
        const p = clientToSvg(e.clientX, e.clientY);
        window.Raschet.applyPresetAt(preset, p.x, p.y);
        return;
      }
    }
    const type = e.dataTransfer.getData('text/raschet-type');
    const subtype = e.dataTransfer.getData('text/raschet-subtype');
    const isMv = e.dataTransfer.getData('text/raschet-ismv') === '1';
    const initSwitchMode = e.dataTransfer.getData('text/raschet-switchmode') || '';
    if (!type || !DEFAULTS[type]) return;
    const p = clientToSvg(e.clientX, e.clientY);
    // Phase 2.3 (v0.59.499): на layout-странице drop-позиция игнорируется,
    // новый узел ставится в staging-колонку слева. Пользователь сразу видит,
    // что элемент создан, может перетащить в нужное место (drag сбрасывает
    // флаг layoutAutoPlaced).
    let dropX = p.x, dropY = p.y;
    const _autoLayout = _layoutAutoPlacePos(type, { subtype });
    if (_autoLayout) {
      // createNode интерпретирует (x, y) как ЦЕНТР узла на схеме: внутри
      // ставит base.x = x - nodeWidth/2, base.y = y - NODE_H/2. Чтобы
      // top-left footprint лёг на (auto.x, auto.y), компенсируем сдвиг.
      // nodeWidth для нового узла зависит от типа/портов — используем
      // приближённо новую ширину в SVG-юнитах (для layout 1 SVG = 1 мм, и
      // schematic-ширина < footprint, так что нода окажется около auto.x).
      dropX = _autoLayout.x + (_autoLayout.widthMm / 2);
      dropY = _autoLayout.y + (NODE_H / 2);
    }
    const newId = createNode(type, dropX, dropY, subtype ? { subtype } : undefined);
    if (_autoLayout && newId) {
      const _node = state.nodes.get(newId);
      if (_node) {
        // Жёстко выставляем top-left footprint на расчётный staging-слот:
        // createNode-сдвиг (через nodeWidth) для footprint неточен, поэтому
        // переписываем n.x/n.y напрямую.
        _node.x = _autoLayout.x;
        _node.y = _autoLayout.y;
        _node.layoutAutoPlaced = true;
        if (!_node.positionsByPage) _node.positionsByPage = {};
        _node.positionsByPage[state.currentPageId] = { x: _autoLayout.x, y: _autoLayout.y };
      }
    }
    // v0.59.350: для consumer-узлов с domain-подтипом (rack/hvac/motor/lighting)
    // явно записываем n.subtype — DEFAULTS.consumer его не читает, но inspector
    // и render используют это поле для иконок и configurator-кнопки.
    if (subtype && newId && type === 'consumer') {
      const node = state.nodes.get(newId);
      if (node && !node.subtype) {
        node.subtype = subtype;
        // Имя по умолчанию по подтипу — пользователь увидит «Стойка», а не
        // «Потребитель», сразу после drop'а.
        const subtypeNames = { rack: 'Серверная стойка', hvac: 'Кондиционер', motor: 'Двигатель', lighting: 'Освещение', heater: 'Нагреватель' };
        if (subtypeNames[subtype] && (!node.name || node.name === 'Потребитель')) {
          node.name = subtypeNames[subtype];
        }
      }
    }
    if (isMv && newId) {
      const node = state.nodes.get(newId);
      if (node) {
        node.isMv = true;
        node.name = node.name || 'РУ СН';
      }
    }
    // v0.59.327: «Клеммная коробка» из палитры — panel + switchMode='terminal'.
    if (initSwitchMode && newId) {
      const node = state.nodes.get(newId);
      if (node) {
        node.switchMode = initSwitchMode;
        if (initSwitchMode === 'terminal') {
          node.name = node.name && node.name !== 'НКУ' ? node.name : 'Клеммная коробка';
          // v0.59.328: terminal — 1:1 passthrough; inputs===outputs.
          const n0 = Math.max(2, Number(node.inputs) || 2);
          node.inputs = n0;
          node.outputs = n0;
          node.capacityA = 0;
          node.kSim = 1;
          if (!Array.isArray(node.channelProtection)) {
            node.channelProtection = new Array(n0).fill(false);
          }
          if (!Array.isArray(node.channelJumpers)) {
            // массив пар [i,j] — перемычки между входами (i<j), только до защиты
            node.channelJumpers = [];
          }
        }
      }
    }
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
    // v0.58.37: режим установки нулевой точки (layout) — следующий клик
    // по канвасу устанавливает page.originMm в мировых координатах точки клика.
    if (state.rulerSetOriginMode && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      const page = state.pages && state.pages.find(p => p.id === state.currentPageId);
      if (page) {
        const p = clientToSvg(e.clientX, e.clientY);
        snapshot('page-origin');
        page.originMm = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
        state.rulerSetOriginMode = false;
        try { notifyChange(); } catch {}
        render();
      }
      return;
    }

    // В режиме разрыва элементы с data-link-jump — это стабы/подписи ссылок.
    // Клик по ним = прыжок к противоположному концу БЕЗ изменения zoom.
    // Вью сдвигается так, чтобы перекрёстная подпись оказалась точно под курсором —
    // целевые SVG-координаты взяты из data-target-x/y (проставлены в render.js).
    const jumpEl = e.target.closest('[data-link-jump]');
    if (jumpEl && jumpEl.dataset.linkJump && jumpEl.dataset.connId) {
      e.preventDefault();
      e.stopPropagation();
      const cid = jumpEl.dataset.connId;
      const conn = state.conns.get(cid);
      if (conn) {
        const tx = parseFloat(jumpEl.dataset.targetX);
        const ty = parseFloat(jumpEl.dataset.targetY);
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
          const rect = svg.getBoundingClientRect();
          // Пан: (tx,ty) должна отобразиться в (e.clientX, e.clientY).
          // Формула: view.x = tx - (screenX - rect.left) / zoom
          state.view.x = tx - (e.clientX - rect.left) / state.view.zoom;
          state.view.y = ty - (e.clientY - rect.top)  / state.view.zoom;
          updateViewBox();
          selectConn(cid);
          render();
        }
      }
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
      const tl = (ch.trayLength || 120);
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
        startTrayLength: ch.trayLength || 120,
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
    // Кнопка × для удаления waypoint
    const delEl = e.target.closest('.conn-waypoint-del') || e.target.closest('.conn-waypoint-del-text');
    if (delEl) {
      if (state.readOnly) return;
      e.stopPropagation();
      const cid = delEl.dataset.waypointDelId;
      const idx = Number(delEl.dataset.waypointDelIdx);
      const c = state.conns.get(cid);
      if (!c || !Array.isArray(c.waypoints)) return;
      snapshot();
      c.waypoints.splice(idx, 1);
      _removeWaypointChannelSnap(c);
      render();
      notifyChange();
      return;
    }
    // Клик на существующий waypoint -> перетаскиваем его.
    // Shift+клик или правый клик удаляет waypoint.
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

    // Кнопки +/- для добавления/удаления выходных портов щита.
    const portBtnEl = e.target.closest('[data-port-add], [data-port-del]');
    if (portBtnEl && !state.readOnly) {
      e.stopPropagation();
      const addId = portBtnEl.getAttribute('data-port-add');
      const delId = portBtnEl.getAttribute('data-port-del');
      const nid = addId || delId;
      const nn = state.nodes.get(nid);
      if (nn && nn.type === 'panel') {
        const isTerminal = nn.switchMode === 'terminal';
        if (addId) {
          snapshot('port-add:' + nid);
          nn.outputs = Math.min(30, (Number(nn.outputs) || 0) + 1);
          if (isTerminal) {
            // Клеммная коробка: входов = выходов (клеммное соединение 1:1)
            nn.inputs = nn.outputs;
            if (!Array.isArray(nn.channelProtection)) nn.channelProtection = [];
            while (nn.channelProtection.length < nn.outputs) nn.channelProtection.push(false);
            nn.channelProtection.length = nn.outputs;
          }
          render(); notifyChange();
          renderInspector();
        } else if (delId) {
          const cur = Number(nn.outputs) || 0;
          if (cur <= 1) { flash('Должен остаться хотя бы один выход'); return; }
          // Проверяем, занят ли последний выходной порт
          const lastIdx = cur - 1;
          const used = [...state.conns.values()].some(c => c.from.nodeId === nid && c.from.port === lastIdx);
          if (used) {
            flash('Сначала отключите линию с выхода №' + cur, 'error');
            return;
          }
          if (isTerminal) {
            const inUsed = [...state.conns.values()].some(c => c.to.nodeId === nid && c.to.port === lastIdx);
            if (inUsed) {
              flash('Сначала отключите линию со входа №' + cur, 'error');
              return;
            }
          }
          snapshot('port-del:' + nid);
          nn.outputs = cur - 1;
          if (isTerminal) {
            nn.inputs = nn.outputs;
            if (Array.isArray(nn.channelProtection)) nn.channelProtection.length = nn.outputs;
            if (Array.isArray(nn.channelJumpers)) {
              nn.channelJumpers = nn.channelJumpers.filter(pair =>
                Array.isArray(pair) && pair.every(i => i < nn.outputs)
              );
            }
          }
          render(); notifyChange();
          renderInspector();
        }
      }
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
        if (original && original.type === 'zone') {
          // Зона: полное копирование всех вложенных элементов с
          // автоинкрементом zonePrefix и сохранением привязки детей.
          snapshot();
          const newId = copyZoneWithMembers(id);
          if (newId) {
            selectNode(newId);
            const newZone = state.nodes.get(newId);
            if (newZone) {
              // Готовим drag с children-пакетом (как обычное перемещение зоны)
              const p = clientToSvg(e.clientX, e.clientY);
              const children = nodesInZone(newZone).map(ch => ({
                id: ch.id, dx: ch.x - newZone.x, dy: ch.y - newZone.y,
              }));
              state.drag = { nodeId: newId, dx: p.x - newZone.x, dy: p.y - newZone.y, children };
            }
          }
          render();
          return;
        }
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
        // v0.58.17: клик по неглавному экземпляру группы на layout — drag только этого экземпляра.
        const iIdxRaw = nodeEl.dataset.instanceIdx;
        const iIdx = iIdxRaw ? Number(iIdxRaw) : 0;
        if (iIdx > 0 && getPageKind(getCurrentPage()) === 'layout') {
          const pageId = state.currentPageId;
          if (!n.instancePositions) n.instancePositions = {};
          if (!n.instancePositions[pageId]) n.instancePositions[pageId] = [];
          const arr = n.instancePositions[pageId];
          // Текущая позиция: если переопределена — берём её, иначе базовая формула
          const geom = getNodeGeometryMm(n);
          const W = geom?.widthMm || 400;
          const gap = 40;
          const cur = (arr[iIdx] && Number.isFinite(arr[iIdx].x)) ? arr[iIdx] : { x: n.x + iIdx * (W + gap), y: n.y };
          arr[iIdx] = { x: cur.x, y: cur.y };
          state.drag = { nodeId: id, instanceIdx: iIdx, dx: p.x - cur.x, dy: p.y - cur.y };
          render();
          return;
        }
        if (n.type === 'zone') {
          const children = nodesInZone(n).map(ch => ({
            id: ch.id, dx: ch.x - n.x, dy: ch.y - n.y,
          }));
          state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y, children };
        } else if (n.type === 'panel' && n.switchMode === 'sectioned' && Array.isArray(n.sectionIds)) {
          // Многосекционный щит — двигаем секции вместе с контейнером
          const children = n.sectionIds.map(sid => {
            const s = state.nodes.get(sid);
            return s ? { id: sid, dx: s.x - n.x, dy: s.y - n.y } : null;
          }).filter(Boolean);
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
        const tw = ch.trayWidth || 40;
        // Центр канала
        const cx = ch.x + tw / 2;
        const startTl = state.drag.startTrayLength || 120;
        const cy = ch.y + startTl / 2;
        const angle = state.drag.channelAngle;
        const axX = Math.sin(angle);
        const axY = Math.cos(angle);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const proj = dx * axX + dy * axY;
        const newTl = Math.max(40, Math.round(Math.abs(proj) * 2));
        // Обновить waypoints: центр канала сдвигается при изменении длины
        const oldTl = ch.trayLength || 120;
        if (oldTl !== newTl) {
          const oldCx = ch.x + tw / 2;
          const oldCy = ch.y + oldTl / 2;
          const newCy = ch.y + newTl / 2;
          for (const conn of state.conns.values()) {
            const wps = Array.isArray(conn.waypoints) ? conn.waypoints : [];
            for (const wp of wps) {
              if (Math.hypot(wp.x - oldCx, wp.y - oldCy) < 5) {
                wp.x = oldCx;
                wp.y = newCy;
              }
            }
          }
        }
        ch.trayLength = newTl;
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
          const tl = (ch.trayLength || 120);
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
      // Snap to grid — держим Alt чтобы отключить привязку.
      // На layout-странице шаг = 10 мм (Shift = 1 мм).
      if (!e.altKey) {
        const gs = _effectiveSnapStep(e);
        nx = (GLOBAL.snapToGrid !== false ? Math.round(nx / gs) * gs : nx);
        ny = (GLOBAL.snapToGrid !== false ? Math.round(ny / gs) * gs : ny);
      }
      // v0.58.17: независимый drag экземпляра группы на layout.
      if (state.drag.instanceIdx && state.drag.instanceIdx > 0) {
        const iIdx = state.drag.instanceIdx;
        const pageId = state.currentPageId;
        // Collision-check против соседей использует _layoutFootprint с (nx,ny)
        if (getPageKind(getCurrentPage()) === 'layout') {
          if (_layoutCollides(n, nx, ny)) {
            // откатываемся на сохранённое положение экземпляра
            const cur = n.instancePositions?.[pageId]?.[iIdx];
            if (cur) {
              if (!_layoutCollides(n, nx, cur.y))      { ny = cur.y; }
              else if (!_layoutCollides(n, cur.x, ny)) { nx = cur.x; }
              else { nx = cur.x; ny = cur.y; }
            }
          }
        }
        if (!n.instancePositions) n.instancePositions = {};
        if (!n.instancePositions[pageId]) n.instancePositions[pageId] = [];
        n.instancePositions[pageId][iIdx] = { x: nx, y: ny };
        render();
        return;
      }
      // Секция многосекционного щита — свободное перемещение
      // Для каналов в режиме трассы — привязка ЦЕНТРА к сетке
      if (n.type === 'channel' && n.trayMode && !e.altKey && GLOBAL.snapToGrid !== false) {
        const gs = GLOBAL.gridStep || 40;
        const tw = n.trayWidth || 40;
        const tl = (n.trayLength || 120);
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
          const tl = (n.trayLength || 120);
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
      // Layout-collision: запрещаем overlap на одной высоте, кроме nested.
      // Пробуем полный шаг, затем только по X, затем только по Y — чтобы
      // скольжение вдоль края соседа работало.
      if (getPageKind(getCurrentPage()) === 'layout' && n.type !== 'channel' && n.type !== 'zone') {
        if (_layoutCollides(n, nx, ny)) {
          if (!_layoutCollides(n, nx, n.y))      { ny = n.y; }
          else if (!_layoutCollides(n, n.x, ny)) { nx = n.x; }
          else                                   { nx = n.x; ny = n.y; }
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
        // На странице-расстановке (layout) НЕ пересчитываем членство в зоне:
        // «полное обозначение» всегда соответствует главной схеме, даже если
        // объект физически вынесен за пределы зоны на плане.
        const _onLayoutPage = getPageKind(getCurrentPage()) === 'layout';
        // Phase 2.3 (v0.59.499): drag сбрасывает флаг layoutAutoPlaced —
        // узел больше не «занимает» слот в staging-колонке слева, и
        // следующий новый узел встанет в освободившееся место.
        if (_onLayoutPage && dragged && dragged.layoutAutoPlaced) {
          delete dragged.layoutAutoPlaced;
        }
        if (dragged && !_onLayoutPage) {
          if (dragged.type === 'zone') {
            // Зона: проверяем вложенность в родительскую зону
            const parentZone = findParentZone(dragged);
            if (parentZone && !isNodeFullyInside(dragged, parentZone)) {
              parentZone.memberIds = (parentZone.memberIds || []).filter(id => id !== dragged.id);
            }
            if (!findParentZone(dragged)) {
              tryAttachToZone(dragged);
            }
          } else {
            // Обычные узлы и многосекционные щиты (с children)
            const currentZone = findZoneForMember(dragged);
            if (currentZone && !isNodeFullyInside(dragged, currentZone)) {
              currentZone.memberIds = (currentZone.memberIds || []).filter(id => id !== dragged.id);
            }
            if (!findZoneForMember(dragged)) {
              tryAttachToZone(dragged);
            }
            // Для многосекционного щита: обновить зону для всех секций
            if (dragged.type === 'panel' && dragged.switchMode === 'sectioned' && Array.isArray(dragged.sectionIds)) {
              for (const sid of dragged.sectionIds) {
                const sec = state.nodes.get(sid);
                if (!sec) continue;
                const secZone = findZoneForMember(sec);
                if (secZone && !isNodeFullyInside(sec, secZone)) {
                  secZone.memberIds = (secZone.memberIds || []).filter(id => id !== sid);
                }
                if (!findZoneForMember(sec)) {
                  tryAttachToZone(sec);
                }
              }
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

  // Правый клик:
  //  1) если ведётся pending — отменяем его
  //  2) если клик по связи (.conn / .conn-hit) — toggle linkMode (скрыть/показать ссылкой)
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.pending) { cancelPending(); return; }
    if (state.readOnly) return;
    // Клик по зоне → контекстное меню с опцией «Копировать зону»
    const zoneEl = e.target.closest('.node');
    if (zoneEl) {
      const nid = zoneEl.dataset.nodeId;
      const nn = state.nodes.get(nid);
      if (nn && nn.type === 'zone') {
        _showNodeContextMenu(e.clientX, e.clientY, nn);
        return;
      }
    }
    // Клик по стабу/подписи в режиме разрыва — тоже считаем кликом по связи
    const jumpEl = e.target.closest('[data-link-jump]');
    const connEl = e.target.closest('.conn-hit, .conn');
    const cid = (jumpEl && jumpEl.dataset.connId) || (connEl && connEl.dataset.connId);
    if (!cid) return;
    const c = state.conns.get(cid);
    if (!c) return;
    snapshot('conn-linkMode-toggle:' + cid);
    c.linkMode = !c.linkMode;
    if (!c.linkMode) c._linkPreview = false;
    render();
    notifyChange();
  });

  // Контекстное меню для узла (пока только зоны — копирование со всеми
  // вложенными элементами).
  function _showNodeContextMenu(clientX, clientY, node) {
    _hideNodeContextMenu();
    const menu = document.createElement('div');
    menu.id = '__node-context-menu';
    menu.style.cssText = `
      position: fixed; left: ${clientX}px; top: ${clientY}px;
      background: #fff; border: 1px solid #d0d0d0; border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px 0;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 13px;
      z-index: 1000; min-width: 220px; user-select: none;
    `;
    const items = [];
    if (node.type === 'zone') {
      items.push({
        label: '📋 Копировать зону со всеми элементами',
        action: () => {
          snapshot('copy-zone:' + node.id);
          const newId = copyZoneWithMembers(node.id);
          if (newId) {
            selectNode(newId);
            render();
            notifyChange();
          }
        },
      });
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.textContent = it.label;
      row.style.cssText = 'padding: 8px 16px; cursor: pointer; color: #1f2430;';
      row.addEventListener('mouseenter', () => { row.style.background = '#f0f4fa'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => {
        _hideNodeContextMenu();
        try { it.action(); } catch (err) { console.error(err); }
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    // Корректируем позицию если меню выходит за viewport
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
      if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';
    });
    // Закрытие по клику вне меню или по Escape
    setTimeout(() => {
      document.addEventListener('mousedown', _hideNodeContextMenu, { once: true });
    }, 0);
  }
  function _hideNodeContextMenu() {
    const el = document.getElementById('__node-context-menu');
    if (el) el.remove();
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') _hideNodeContextMenu();
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
    // v0.59.143: Escape также отменяет pending patch-link инфо-порта.
    if (e.key === 'Escape' && state.sysPending) { state.sysPending = null; render(); }
    // v0.58.32: навигация по этажам на layout-странице
    if (getPageKind(getCurrentPage()) === 'layout' && (e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home')) {
      // собираем уникальные этажи на текущей странице
      const floors = new Set();
      for (const n of state.nodes.values()) {
        if (n.type === 'zone' || n.type === 'channel') continue;
        const pids = Array.isArray(n.pageIds) ? n.pageIds : [];
        if (!pids.includes(state.currentPageId)) continue;
        floors.add(Number(n.floor) || 0);
      }
      if (floors.size <= 1) return;
      const arr = [...floors].sort((a, b) => a - b);
      if (e.key === 'Home') {
        state.floorFilter = null;
      } else {
        const cur = state.floorFilter;
        let idx = (cur == null) ? -1 : arr.indexOf(cur);
        if (e.key === 'PageUp') idx = (idx < 0) ? arr.length - 1 : Math.min(arr.length - 1, idx + 1);
        else idx = (idx < 0) ? 0 : Math.max(0, idx - 1);
        state.floorFilter = arr[idx];
      }
      e.preventDefault();
      render();
      return;
    }
    if (state.readOnly) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // v0.58.14: удаление с холста — «мягкое», элемент только снимается с
      // текущей страницы и уходит в реестр (unplaced). Хард-удаление —
      // через × в палитре «Реестр».
      // v0.59.331: блокируем удаление карточки если к ней подключены кабели.
      const fromPage = state.currentPageId || null;
      let blockedCount = 0; let deletedCount = 0;
      const delOne = (id) => {
        const r = deleteNode(id, { fromPage });
        if (r && r.blocked === 'has-cables') blockedCount++;
        else if (r && r.softDeleted) deletedCount++;
        else deletedCount++; // legacy: hard-delete без fromPage тоже считаем удалением
      };
      if (state.selection.size) {
        snapshot();
        for (const id of [...state.selection]) delOne(id);
        if (deletedCount) state.selection.clear();
        e.preventDefault();
      } else if (state.selectedKind === 'node' && state.selectedId) {
        delOne(state.selectedId); e.preventDefault();
      } else if (state.selectedKind === 'conn' && state.selectedId) {
        deleteConn(state.selectedId); e.preventDefault();
      }
      if (blockedCount) {
        flash(`Сначала снимите кабельные линии с ${blockedCount === 1 ? 'элемента' : blockedCount + ' элементов'} — потом удаляйте карточку с холста`, 'error');
      }
    }
  });

  // ---- Hover-preview для ссылок в режиме разрыва ----
  // Наведение на стаб/подпись ссылки -> добавляем пунктирный путь скрытой линии.
  // Уход курсора -> убираем. Без полного render().
  let _linkHoverPath = null;
  const clearLinkHover = () => {
    if (_linkHoverPath) { _linkHoverPath.remove(); _linkHoverPath = null; }
  };
  svg.addEventListener('mouseover', e => {
    const tgt = e.target.closest('[data-link-jump]');
    if (!tgt || !tgt.dataset.connId) return;
    const c = state.conns.get(tgt.dataset.connId);
    if (!c || !c._linkD) return;
    clearLinkHover();
    const p = el('path', {
      d: c._linkD,
      fill: 'none',
      stroke: '#1565c0',
      'stroke-width': 3,
      'stroke-dasharray': '6 4',
      opacity: '0.7',
      'pointer-events': 'none',
    });
    // Кладём в тот же layer что и conns, чтобы трансформы viewport совпадали.
    const layerConns = document.getElementById('layer-conns');
    if (layerConns) layerConns.appendChild(p);
    _linkHoverPath = p;
  });
  svg.addEventListener('mouseout', e => {
    // Снимаем превью только если курсор ушёл ИЗ подписи/стаба
    const from = e.target.closest('[data-link-jump]');
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-link-jump]');
    if (from && !to) clearLinkHover();
  });

  // ---- Зум колесом ----
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    // Если текущий zoom повреждён (NaN/Infinity/0) — принудительно сбросим
    if (!Number.isFinite(state.view.zoom) || state.view.zoom <= 0) {
      state.view.zoom = 1;
      if (!Number.isFinite(state.view.x)) state.view.x = 0;
      if (!Number.isFinite(state.view.y)) state.view.y = 0;
    }
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
