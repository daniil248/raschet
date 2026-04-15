// ======================================================================
// schematic.js
// Редактор принципиальных электрических схем.
// SVG-based, все координаты — в миллиметрах в системе листа ISO 216.
// ======================================================================

import { IEC_SYMBOLS, getSymbolGroups, getSymbolById, GRID_MM } from './iec60617-symbols.js';
import { getSheetSize, getFrameMargins, buildSheetFrame, buildZoneMarkers, buildTitleBlock } from './iso-paper.js';

// ---------------------------------------------------------------- state
const state = {
  paperSize: 'A3',
  paperOrient: 'landscape',
  zoom: 1,                       // screen px per mm
  tool: 'select',                // select | wire | junction | text
  sheets: [
    { id: 1, components: [], wires: [], texts: [] },
  ],
  activeSheet: 1,
  selection: null,               // { type: 'component'|'wire', id, sheet }
  titleBlock: {
    title: '',
    docTitle: 'Схема электрическая принципиальная',
    docNumber: '',
    prepared: '',
    approved: '',
    owner: '',
    date: new Date().toISOString().slice(0, 10),
    rev: 'A',
    lang: 'ru',
    scale: '1:1',
  },
  // wire-in-progress
  wireDraft: null,               // { points: [{x,y}...] }
  // ghost при drag из палитры
  dragGhost: null,
  nextId: 1,
};

// ---------------------------------------------------------------- DOM refs
const $ = (sel) => document.querySelector(sel);
const svg       = $('#sch-canvas');
const sheetBg   = $('#sch-sheet-bg');
const sheetFrame= $('#sch-sheet-frame');
const zonesG    = $('#sch-sheet-zones');
const titleG    = $('#sch-title-block');
const gridG     = $('#sch-grid-layer');
const compsG    = $('#sch-components');
const wiresG    = $('#sch-wires');
const textsG    = $('#sch-texts');
const overlayG  = $('#sch-overlay');

// ============================================================================
// Инициализация
// ============================================================================
function init() {
  renderPalette();
  bindToolbar();
  bindCanvas();
  bindPropsInputs();
  loadTitleFromInputs();
  relayoutSheet();
  render();
}

function genId(prefix = 'el') {
  return `${prefix}${state.nextId++}`;
}

// ============================================================================
// Палитра
// ============================================================================
function renderPalette() {
  const host = $('#sch-palette-body');
  const groups = getSymbolGroups();
  const chunks = [];
  for (const [group, items] of groups) {
    chunks.push(`<div class="sch-palette-group">
      <div class="sch-palette-group-title">${group}</div>
      <div class="sch-palette-grid">
        ${items.map(s => `
          <div class="sch-palette-item" draggable="true"
               data-symbol="${s.id}"
               data-label="${s.name}"
               title="${s.name} · ${s.iec}">
            <svg viewBox="${-s.w/2 - 2} ${-s.h/2 - 2} ${s.w + 4} ${s.h + 4}">${s.draw()}</svg>
          </div>
        `).join('')}
      </div>
    </div>`);
  }
  host.innerHTML = chunks.join('');

  host.querySelectorAll('.sch-palette-item').forEach(el => {
    el.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('text/schematic-symbol', el.dataset.symbol);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => {
      // одиночный клик — в центр листа
      const sym = getSymbolById(el.dataset.symbol);
      if (!sym) return;
      const size = getSheetSize(state.paperSize, state.paperOrient);
      placeComponent(sym.id, snap(size.w / 2), snap(size.h / 2));
      render();
    });
  });

  $('#sch-palette-search').addEventListener('input', ev => {
    const q = ev.target.value.trim().toLowerCase();
    host.querySelectorAll('.sch-palette-item').forEach(el => {
      const s = getSymbolById(el.dataset.symbol);
      const hit = !q || s.name.toLowerCase().includes(q) || s.iec.toLowerCase().includes(q) || s.refPrefix.toLowerCase().includes(q);
      el.style.display = hit ? '' : 'none';
    });
  });
}

// ============================================================================
// Toolbar
// ============================================================================
function bindToolbar() {
  // инструменты
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  // формат листа
  $('#sch-paper-size').addEventListener('change', ev => {
    state.paperSize = ev.target.value;
    relayoutSheet();
    render();
  });
  $('#sch-paper-orient').addEventListener('change', ev => {
    state.paperOrient = ev.target.value;
    relayoutSheet();
    render();
  });

  // действия
  $('#sch-btn-rotate').addEventListener('click', rotateSelection);
  $('#sch-btn-mirror').addEventListener('click', mirrorSelection);
  $('#sch-btn-delete').addEventListener('click', deleteSelection);

  // zoom
  $('#sch-btn-zoom-in').addEventListener('click',  () => setZoom(state.zoom * 1.25));
  $('#sch-btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
  $('#sch-btn-zoom-fit').addEventListener('click', fitZoom);

  // save/load/export
  $('#sch-btn-save').addEventListener('click', saveProject);
  $('#sch-btn-load').addEventListener('click', () => $('#sch-file-input').click());
  $('#sch-file-input').addEventListener('change', loadProjectFile);
  $('#sch-btn-export-svg').addEventListener('click', exportSVG);
  $('#sch-btn-print').addEventListener('click', () => window.print());

  // горячие клавиши
  window.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    switch (ev.key.toLowerCase()) {
      case 's': setTool('select'); break;
      case 'w': setTool('wire'); break;
      case 'j': setTool('junction'); break;
      case 't': setTool('text'); break;
      case 'r': rotateSelection(); break;
      case 'm': mirrorSelection(); break;
      case 'delete': case 'backspace': deleteSelection(); break;
      case 'escape': state.wireDraft = null; state.selection = null; render(); break;
    }
  });
}

function setTool(t) {
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === t);
  });
  state.wireDraft = null;
  render();
}

// ============================================================================
// Свойства
// ============================================================================
function bindPropsInputs() {
  const map = {
    'sch-tb-title':   'title',
    'sch-tb-doctype': 'docTitle',
    'sch-tb-docno':   'docNumber',
    'sch-tb-prep':    'prepared',
    'sch-tb-appr':    'approved',
    'sch-tb-owner':   'owner',
    'sch-tb-date':    'date',
    'sch-tb-rev':     'rev',
    'sch-tb-lang':    'lang',
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $('#' + id);
    if (!el) continue;
    el.addEventListener('input', () => {
      state.titleBlock[key] = el.value;
      renderTitleBlock();
    });
  }
}

function loadTitleFromInputs() {
  $('#sch-tb-doctype').value = state.titleBlock.docTitle;
  $('#sch-tb-date').value    = state.titleBlock.date;
  $('#sch-tb-rev').value     = state.titleBlock.rev;
  $('#sch-tb-lang').value    = state.titleBlock.lang;
}

function renderPropsPanel() {
  const host = $('#sch-props-body');
  const sel = state.selection;
  if (!sel) {
    host.innerHTML = '<div class="sch-props-empty">Ничего не выбрано</div>';
    return;
  }
  const sheet = activeSheet();
  if (sel.type === 'component') {
    const comp = sheet.components.find(c => c.id === sel.id);
    if (!comp) return;
    const sym = getSymbolById(comp.symbolId);
    host.innerHTML = `
      <label class="sch-field">
        <span>Позиционное обозначение</span>
        <input type="text" id="pp-ref" value="${comp.ref || ''}">
      </label>
      <label class="sch-field">
        <span>Номинал / тип</span>
        <input type="text" id="pp-value" value="${comp.value || ''}">
      </label>
      <label class="sch-field">
        <span>Символ</span>
        <input type="text" value="${sym?.name || ''} · ${sym?.iec || ''}" disabled>
      </label>
      <div class="sch-field-row">
        <label class="sch-field">
          <span>X, мм</span>
          <input type="number" id="pp-x" value="${comp.x}" step="${GRID_MM}">
        </label>
        <label class="sch-field">
          <span>Y, мм</span>
          <input type="number" id="pp-y" value="${comp.y}" step="${GRID_MM}">
        </label>
      </div>
      <div class="sch-field-row">
        <label class="sch-field">
          <span>Угол</span>
          <select id="pp-rot">
            <option value="0">0°</option>
            <option value="90">90°</option>
            <option value="180">180°</option>
            <option value="270">270°</option>
          </select>
        </label>
        <label class="sch-field">
          <span>Зеркало</span>
          <select id="pp-mir">
            <option value="0">Нет</option>
            <option value="1">Да</option>
          </select>
        </label>
      </div>
    `;
    host.querySelector('#pp-rot').value = String(comp.rot || 0);
    host.querySelector('#pp-mir').value = comp.mirror ? '1' : '0';

    const upd = () => {
      comp.ref    = host.querySelector('#pp-ref').value;
      comp.value  = host.querySelector('#pp-value').value;
      comp.x      = parseFloat(host.querySelector('#pp-x').value) || 0;
      comp.y      = parseFloat(host.querySelector('#pp-y').value) || 0;
      comp.rot    = parseInt(host.querySelector('#pp-rot').value) || 0;
      comp.mirror = host.querySelector('#pp-mir').value === '1';
      renderContent();
    };
    host.querySelectorAll('input,select').forEach(el => el.addEventListener('input', upd));
  } else if (sel.type === 'wire') {
    host.innerHTML = `<div class="sch-props-empty">Провод #${sel.id}. Нажмите Delete, чтобы удалить.</div>`;
  }
}

// ============================================================================
// Лист / системы координат
// ============================================================================
function activeSheet() {
  return state.sheets.find(s => s.id === state.activeSheet) || state.sheets[0];
}

function relayoutSheet() {
  const { w: W, h: H } = getSheetSize(state.paperSize, state.paperOrient);
  // viewBox в мм — 1 mm = 1 SVG unit
  const pad = 0;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`);
  const zoom = state.zoom;
  svg.setAttribute('width',  (W * zoom) + 'px');
  svg.setAttribute('height', (H * zoom) + 'px');

  sheetBg.setAttribute('x', 0);
  sheetBg.setAttribute('y', 0);
  sheetBg.setAttribute('width',  W);
  sheetBg.setAttribute('height', H);

  const margins = getFrameMargins(state.paperSize);
  const frame = buildSheetFrame(W, H, margins);
  sheetFrame.setAttribute('x', frame.x);
  sheetFrame.setAttribute('y', frame.y);
  sheetFrame.setAttribute('width',  frame.w);
  sheetFrame.setAttribute('height', frame.h);

  zonesG.innerHTML = buildZoneMarkers(frame);
  renderTitleBlock();
  renderGrid();
  $('#sch-zoom-value').textContent = Math.round(zoom * 100 / (devicePixelRatio || 1)) + '%';
}

function renderTitleBlock() {
  const { w: W, h: H } = getSheetSize(state.paperSize, state.paperOrient);
  const margins = getFrameMargins(state.paperSize);
  const frame = buildSheetFrame(W, H, margins);
  const fields = {
    ...state.titleBlock,
    sheet: state.activeSheet,
    sheets: state.sheets.length,
  };
  titleG.innerHTML = buildTitleBlock(frame, fields);
}

function renderGrid() {
  const { w: W, h: H } = getSheetSize(state.paperSize, state.paperOrient);
  const margins = getFrameMargins(state.paperSize);
  const frame = buildSheetFrame(W, H, margins);
  const step = GRID_MM;
  const parts = [];
  for (let x = Math.ceil(frame.x / step) * step; x < frame.x + frame.w; x += step) {
    for (let y = Math.ceil(frame.y / step) * step; y < frame.y + frame.h; y += step) {
      parts.push(`<circle class="sch-grid-dot" cx="${x}" cy="${y}" r="0.15"/>`);
    }
  }
  gridG.innerHTML = parts.join('');
}

function setZoom(z) {
  state.zoom = Math.max(0.3, Math.min(8, z));
  relayoutSheet();
}

function fitZoom() {
  const wrap = $('#sch-canvas-wrap');
  const { w, h } = getSheetSize(state.paperSize, state.paperOrient);
  const zx = (wrap.clientWidth - 48) / w;
  const zy = (wrap.clientHeight - 48) / h;
  setZoom(Math.min(zx, zy));
}

// ============================================================================
// Преобразование координат мышь → лист (мм)
// ============================================================================
function mouseToMM(ev) {
  const rect = svg.getBoundingClientRect();
  const { w, h } = getSheetSize(state.paperSize, state.paperOrient);
  const x = ((ev.clientX - rect.left) / rect.width)  * w;
  const y = ((ev.clientY - rect.top)  / rect.height) * h;
  return { x, y };
}
function snap(v) { return Math.round(v / GRID_MM) * GRID_MM; }

// Мировая точка вывода компонента с учётом rotate/mirror.
function worldPin(comp, pin) {
  let px = pin.x, py = pin.y;
  if (comp.mirror) px = -px;
  const rad = ((comp.rot || 0) * Math.PI) / 180;
  const cs = Math.cos(rad), sn = Math.sin(rad);
  return {
    x: comp.x + px * cs - py * sn,
    y: comp.y + px * sn + py * cs,
  };
}

// Найти ближайший вывод к точке (x,y) в мм, в пределах threshold.
function findPinNear(x, y, threshold = 2) {
  const sheet = activeSheet();
  let best = null, bestD = threshold;
  for (const c of sheet.components) {
    if (c.symbolId === '__junction__') continue;
    const sym = getSymbolById(c.symbolId);
    if (!sym || !sym.pins) continue;
    for (const p of sym.pins) {
      const w = worldPin(c, p);
      const d = Math.hypot(w.x - x, w.y - y);
      if (d <= bestD) {
        bestD = d;
        best = { comp: c.id, pin: p.id, x: w.x, y: w.y };
      }
    }
  }
  return best;
}

// Разрешить точку провода: {ref:{comp,pin}} → текущие мировые координаты.
function resolveWirePoint(p) {
  if (p && p.ref) {
    const sheet = activeSheet();
    const comp = sheet.components.find(c => c.id === p.ref.comp);
    if (!comp) return { x: p.x || 0, y: p.y || 0 };
    const sym = getSymbolById(comp.symbolId);
    const pin = sym?.pins?.find(pp => pp.id === p.ref.pin);
    if (!pin) return { x: p.x || 0, y: p.y || 0 };
    return worldPin(comp, pin);
  }
  return { x: p.x, y: p.y };
}

// Собрать множество "ref:comp|pin" всех подключённых выводов — для отрисовки.
function collectConnectedPins() {
  const set = new Set();
  for (const w of activeSheet().wires) {
    for (const pt of w.points) {
      if (pt && pt.ref) set.add(pt.ref.comp + '|' + pt.ref.pin);
    }
  }
  return set;
}

// ============================================================================
// Canvas events
// ============================================================================
function bindCanvas() {
  const wrap = $('#sch-canvas-wrap');

  // drop из палитры
  wrap.addEventListener('dragover', ev => { ev.preventDefault(); });
  wrap.addEventListener('drop', ev => {
    ev.preventDefault();
    const id = ev.dataTransfer.getData('text/schematic-symbol');
    if (!id) return;
    const { x, y } = mouseToMM(ev);
    placeComponent(id, snap(x), snap(y));
    render();
  });

  svg.addEventListener('mousedown', onCanvasDown);
  svg.addEventListener('mousemove', onCanvasMove);
  window.addEventListener('mouseup', onCanvasUp);

  // Ctrl+колесо = зум с фиксацией точки под курсором.
  // Обычное колесо — стандартная прокрутка (overflow:auto).
  wrap.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return;            // обычная прокрутка
    ev.preventDefault();
    const prev = state.zoom;
    const factor = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
    const next = Math.max(0.3, Math.min(8, prev * factor));
    if (next === prev) return;
    // координаты точки под курсором в системе wrap до зума
    const wrapRect = wrap.getBoundingClientRect();
    const mx = ev.clientX - wrapRect.left + wrap.scrollLeft;
    const my = ev.clientY - wrapRect.top  + wrap.scrollTop;
    state.zoom = next;
    relayoutSheet();
    // скорректировать scroll так, чтобы точка под курсором осталась на месте
    const k = next / prev;
    wrap.scrollLeft = mx * k - (ev.clientX - wrapRect.left);
    wrap.scrollTop  = my * k - (ev.clientY - wrapRect.top);
  }, { passive: false });

  // Панорамирование средней кнопкой мыши.
  wrap.addEventListener('mousedown', ev => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    const startX = ev.clientX, startY = ev.clientY;
    const startL = wrap.scrollLeft, startT = wrap.scrollTop;
    wrap.style.cursor = 'grabbing';
    const move = (e) => {
      wrap.scrollLeft = startL - (e.clientX - startX);
      wrap.scrollTop  = startT - (e.clientY - startY);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      wrap.style.cursor = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // листы
  $('#sch-sheet-add').addEventListener('click', addSheet);
  $('#sch-sheets-bar').addEventListener('click', ev => {
    const tab = ev.target.closest('.sch-sheet-tab');
    if (!tab) return;
    state.activeSheet = parseInt(tab.dataset.sheet);
    render();
  });
}

let dragState = null;

function onCanvasDown(ev) {
  const pt = mouseToMM(ev);
  const sheet = activeSheet();

  if (state.tool === 'wire') {
    // EPLAN-style: если рядом вывод — прицепиться к нему, иначе — к сетке.
    const pin = findPinNear(pt.x, pt.y, 2.5);
    const sp = pin
      ? { x: pin.x, y: pin.y, ref: { comp: pin.comp, pin: pin.pin } }
      : { x: snap(pt.x), y: snap(pt.y) };

    if (!state.wireDraft) {
      state.wireDraft = { points: [sp] };
    } else {
      const last = state.wireDraft.points[state.wireDraft.points.length - 1];
      if (last.x !== sp.x && last.y !== sp.y) {
        state.wireDraft.points.push({ x: sp.x, y: last.y });
      }
      state.wireDraft.points.push(sp);
      // завершение: двойной клик ИЛИ клик по выводу
      if (ev.detail > 1 || pin) finalizeWire();
    }
    render();
    return;
  }

  if (state.tool === 'junction') {
    sheet.components.push({
      id: genId('j'), symbolId: '__junction__',
      x: snap(pt.x), y: snap(pt.y), rot: 0, mirror: false,
    });
    render();
    return;
  }

  if (state.tool === 'text') {
    const txt = prompt('Текст:');
    if (txt) {
      sheet.texts.push({ id: genId('t'), x: snap(pt.x), y: snap(pt.y), text: txt });
      render();
    }
    return;
  }

  // select tool: попытаться зацепить компонент
  const target = ev.target.closest('.sch-comp, .sch-wire');
  if (target) {
    const kind = target.classList.contains('sch-comp') ? 'component' : 'wire';
    state.selection = { type: kind, id: target.dataset.id };
    if (kind === 'component') {
      const comp = sheet.components.find(c => c.id === target.dataset.id);
      if (comp) {
        dragState = { type: 'move', id: comp.id, start: pt, origX: comp.x, origY: comp.y };
      }
    }
  } else {
    state.selection = null;
  }
  render();
}

function onCanvasMove(ev) {
  const pt = mouseToMM(ev);

  // Подсветить ближайший вывод под курсором (EPLAN-style).
  if (state.tool === 'wire' || state.tool === 'select') {
    const pin = findPinNear(pt.x, pt.y, 2.5);
    document.querySelectorAll('.sch-pin-connector.snap').forEach(el => el.classList.remove('snap'));
    if (pin) {
      const el = document.querySelector(`.sch-pin-connector[data-comp="${pin.comp}"][data-pin="${pin.pin}"]`);
      if (el) el.classList.add('snap');
    }
  }

  if (state.tool === 'wire' && state.wireDraft) {
    const pin = findPinNear(pt.x, pt.y, 2.5);
    const sp = pin ? { x: pin.x, y: pin.y } : { x: snap(pt.x), y: snap(pt.y) };
    const last = state.wireDraft.points[state.wireDraft.points.length - 1];
    const lastXY = resolveWirePoint(last);
    const preview = [...state.wireDraft.points.map(resolveWirePoint), { x: sp.x, y: lastXY.y }, sp];
    overlayG.innerHTML = `<polyline class="sch-wire" points="${preview.map(p => `${p.x},${p.y}`).join(' ')}"/>`;
    return;
  }

  if (dragState && dragState.type === 'move') {
    const sheet = activeSheet();
    const comp = sheet.components.find(c => c.id === dragState.id);
    if (comp) {
      comp.x = snap(dragState.origX + (pt.x - dragState.start.x));
      comp.y = snap(dragState.origY + (pt.y - dragState.start.y));
      renderContent();  // провода с ref-точками автоматически обновятся
    }
  }
}

function onCanvasUp() {
  if (dragState) dragState = null;
}

function finalizeWire() {
  if (state.wireDraft && state.wireDraft.points.length >= 2) {
    activeSheet().wires.push({ id: genId('w'), points: state.wireDraft.points });
  }
  state.wireDraft = null;
  overlayG.innerHTML = '';
  render();
}

// ============================================================================
// Действия
// ============================================================================
function placeComponent(symbolId, x, y) {
  const sym = getSymbolById(symbolId);
  if (!sym) return;
  const sheet = activeSheet();
  const n = 1 + sheet.components.filter(c => {
    const s = getSymbolById(c.symbolId);
    return s && s.refPrefix === sym.refPrefix;
  }).length;
  sheet.components.push({
    id: genId('c'),
    symbolId,
    x, y,
    rot: 0,
    mirror: false,
    ref: `${sym.refPrefix}${n}`,
    value: '',
  });
}

function rotateSelection() {
  if (!state.selection || state.selection.type !== 'component') return;
  const comp = activeSheet().components.find(c => c.id === state.selection.id);
  if (!comp) return;
  comp.rot = ((comp.rot || 0) + 90) % 360;
  render();
}
function mirrorSelection() {
  if (!state.selection || state.selection.type !== 'component') return;
  const comp = activeSheet().components.find(c => c.id === state.selection.id);
  if (!comp) return;
  comp.mirror = !comp.mirror;
  render();
}
function deleteSelection() {
  if (!state.selection) return;
  const sheet = activeSheet();
  if (state.selection.type === 'component') {
    sheet.components = sheet.components.filter(c => c.id !== state.selection.id);
  } else if (state.selection.type === 'wire') {
    sheet.wires = sheet.wires.filter(w => w.id !== state.selection.id);
  }
  state.selection = null;
  render();
}

function addSheet() {
  const id = Math.max(...state.sheets.map(s => s.id)) + 1;
  state.sheets.push({ id, components: [], wires: [], texts: [] });
  state.activeSheet = id;
  renderSheetTabs();
  render();
}

function renderSheetTabs() {
  const bar = $('#sch-sheets-bar');
  const addBtn = '<button class="sch-sheet-add" id="sch-sheet-add" title="Добавить лист">+</button>';
  bar.innerHTML = state.sheets.map(s =>
    `<button class="sch-sheet-tab ${s.id === state.activeSheet ? 'active' : ''}" data-sheet="${s.id}">Лист ${s.id}</button>`
  ).join('') + addBtn;
  $('#sch-sheet-add').addEventListener('click', addSheet);
}

// ============================================================================
// Render
// ============================================================================
function render() {
  renderSheetTabs();
  renderContent();
  renderTitleBlock();
  renderPropsPanel();
}

function renderContent() {
  const sheet = activeSheet();
  const connected = collectConnectedPins();
  // компоненты
  const comps = sheet.components.map(c => renderComponent(c, connected)).join('');
  compsG.innerHTML = comps;
  // провода
  const wires = sheet.wires.map(w => {
    const pts = w.points.map(resolveWirePoint);
    return `<polyline class="sch-wire ${state.selection && state.selection.type==='wire' && state.selection.id===w.id ? 'selected' : ''}"
              data-id="${w.id}"
              points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"/>`;
  }).join('');
  wiresG.innerHTML = wires;
  // тексты
  textsG.innerHTML = sheet.texts.map(t =>
    `<text x="${t.x}" y="${t.y}" style="font-family:Arial;font-size:3px">${escapeXml(t.text)}</text>`
  ).join('');
}

function renderComponent(comp, connected = new Set()) {
  if (comp.symbolId === '__junction__') {
    return `<g class="sch-comp ${state.selection && state.selection.id===comp.id ? 'selected':''}"
               data-id="${comp.id}"
               transform="translate(${comp.x} ${comp.y})">
      <circle class="sch-junction" cx="0" cy="0" r="0.7"/>
    </g>`;
  }
  const sym = getSymbolById(comp.symbolId);
  if (!sym) return '';
  const selected = state.selection && state.selection.id === comp.id ? ' selected' : '';
  const sc = comp.mirror ? 'scale(-1,1)' : '';
  const pins = (sym.pins || []).map(p => {
    const isConnected = connected.has(comp.id + '|' + p.id);
    return `<circle class="sch-pin-connector${isConnected ? ' connected' : ''}"
                    data-comp="${comp.id}" data-pin="${p.id}"
                    cx="${p.x}" cy="${p.y}" r="0.7"/>`;
  }).join('');
  return `<g class="sch-comp${selected}" data-id="${comp.id}"
             transform="translate(${comp.x} ${comp.y}) rotate(${comp.rot || 0}) ${sc}">
    ${sym.draw()}
    ${pins}
    <text x="0" y="${-sym.h/2 - 2}" text-anchor="middle">${escapeXml(comp.ref || '')}</text>
    ${comp.value ? `<text x="0" y="${sym.h/2 + 4}" text-anchor="middle">${escapeXml(comp.value)}</text>` : ''}
  </g>`;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

// ============================================================================
// Save / load / export
// ============================================================================
function saveProject() {
  const data = {
    format: 'raschet-schematic/1',
    paperSize: state.paperSize,
    paperOrient: state.paperOrient,
    titleBlock: state.titleBlock,
    sheets: state.sheets,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.titleBlock.docNumber || 'schematic') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadProjectFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.format !== 'raschet-schematic/1') throw new Error('Неверный формат файла');
      state.paperSize   = data.paperSize   || 'A3';
      state.paperOrient = data.paperOrient || 'landscape';
      state.titleBlock  = { ...state.titleBlock, ...(data.titleBlock || {}) };
      state.sheets      = data.sheets || [{ id: 1, components: [], wires: [], texts: [] }];
      state.activeSheet = state.sheets[0].id;
      $('#sch-paper-size').value   = state.paperSize;
      $('#sch-paper-orient').value = state.paperOrient;
      loadTitleFromInputs();
      relayoutSheet();
      render();
    } catch (e) {
      alert('Не удалось открыть файл: ' + e.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

function exportSVG() {
  const clone = svg.cloneNode(true);
  // убираем сетку и overlay
  clone.querySelector('#sch-grid-layer')?.remove();
  clone.querySelector('#sch-overlay')?.remove();
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.titleBlock.docNumber || 'schematic') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Публичный API для интеграции с Конструктором схем
// ============================================================================
/**
 * Глобальный API: позволяет подпрограмме «Конструктор схем» сформировать
 * принципиальную схему щита и передать её сюда.
 */
window.RaschetSchematic = {
  /** Загрузить проект (тот же формат, что у saveProject). */
  loadProject(data) {
    try {
      if (data.format !== 'raschet-schematic/1') return false;
      state.paperSize   = data.paperSize || 'A3';
      state.paperOrient = data.paperOrient || 'landscape';
      state.titleBlock  = { ...state.titleBlock, ...(data.titleBlock || {}) };
      state.sheets      = data.sheets || [{ id: 1, components: [], wires: [], texts: [] }];
      state.activeSheet = state.sheets[0].id;
      $('#sch-paper-size').value   = state.paperSize;
      $('#sch-paper-orient').value = state.paperOrient;
      loadTitleFromInputs();
      relayoutSheet();
      render();
      return true;
    } catch { return false; }
  },
  /** Получить текущий проект в виде JSON-объекта. */
  getProject() {
    return {
      format: 'raschet-schematic/1',
      paperSize: state.paperSize,
      paperOrient: state.paperOrient,
      titleBlock: state.titleBlock,
      sheets: state.sheets,
    };
  },
  /** Список доступных IEC-символов — для генерации схемы извне. */
  getSymbolCatalog() {
    return IEC_SYMBOLS.map(s => ({
      id: s.id, iec: s.iec, name: s.name, group: s.group,
      refPrefix: s.refPrefix, w: s.w, h: s.h, pins: s.pins,
    }));
  },
};

// автоподгон начального масштаба по окну
function initialFit() {
  const wrap = $('#sch-canvas-wrap');
  const { w, h } = getSheetSize(state.paperSize, state.paperOrient);
  const zx = (wrap.clientWidth - 48) / w;
  const zy = (wrap.clientHeight - 48) / h;
  state.zoom = Math.min(zx, zy) * 1.4;   // чуть больше fit — чтобы появилась прокрутка
  if (state.zoom < 1) state.zoom = 1;
  relayoutSheet();
}

// ============================================================================
init();
initialFit();
