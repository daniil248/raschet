// =============================================================================
// sketch/sketch.js — модуль «Скетч / Whiteboard» (drawio-like).
// =============================================================================
// v0.60.151 START. По репорту Пользователя 2026-05-04: «Добавь модуль полностью
// копирующий функционал drawio, включая библиотеки фигур, для составления
// предварительных набросков по проекту» + «готовые библиотеки должны
// копироваться и создаваться пользовательские библиотеки с импортом
// и экспортом».
//
// MVP-функциональность (Phase 1):
//   • SVG-холст с pan/zoom, сеткой
//   • Палитра фигур по категориям (drag-drop на холст)
//   • Move/resize/delete фигур
//   • Connect-tool (соединение фигур стрелками)
//   • Правая панель свойств (label, color, fontSize, position)
//   • Multi-page (отдельный sketch может иметь несколько листов)
//   • Save/load per-project + per-sketch (LS)
//   • Export SVG / PNG / JSON
//   • Undo/redo (Ctrl+Z / Ctrl+Y)
//   • Keyboard shortcuts (V/C/T, Del, Ctrl+0/+/-)
//   • Библиотеки: seed (built-in) + user + org с copy/import/export.
//
// Storage:
//   raschet.sketch.state.<pid>.<sketchId>.v1 — основное состояние
//   raschet.sketch.libraries.user.v1 / org.v1 — библиотеки
//   raschet.sketch.lib-visibility.v1 — toggle'ы видимости
// =============================================================================

import { mountFooter } from '../shared/module-footer.js';
import { rsToast, rsConfirm, rsPrompt } from '../shared/dialog.js';
import { getActiveProjectId } from '../shared/project-storage.js';
import { SHAPE_LIBRARY, findShapeDef } from './shape-library.js';
import {
  listAllLibraries, listVisibleLibraries, getLibrary,
  setLibraryVisibility, isLibraryVisible,
  addUserLibrary, updateUserLibrary, deleteUserLibrary,
  cloneLibraryToUser, exportLibrary, importLibrary,
  addShapeToLibrary, removeShapeFromLibrary,
} from './library-store.js';

// ─── State ──────────────────────────────────────────────────────────────────
const _pid = (() => { try { return getActiveProjectId() || 'default'; } catch { return 'default'; } })();
const SKETCH_ID = 'main';  // MVP: один sketch на проект; multi-sketch — будущая фаза.
const LS_KEY = `raschet.sketch.state.${_pid}.${SKETCH_ID}.v1`;

let state = {
  formatVersion: '1.0',
  pages: [{
    id: 'page-1',
    name: 'Лист 1',
    shapes: [],   // {id, libraryId, shapeId, x, y, w, h, label, fill, stroke, fontSize, rotation}
    edges: [],    // {id, from: shapeId|null, fromAnchor, fromX, fromY, to, toAnchor, toX, toY, label, dashed}
  }],
  activePageId: 'page-1',
  view: { tx: 0, ty: 0, scale: 1 },
};
let _selection = new Set();   // shape/edge ids
let _activeTool = 'select';   // 'select' | 'connect' | 'text'
let _undoStack = [];
let _redoStack = [];
const UNDO_MAX = 50;

// ─── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const svg = () => $('sk-svg');
const shapesLayer = () => $('sk-shapes-layer');
const edgesLayer = () => $('sk-edges-layer');
const overlayLayer = () => $('sk-overlay-layer');
const gridLayer = () => $('sk-grid-layer');

const SVG_NS = 'http://www.w3.org/2000/svg';

// ─── Persistence ────────────────────────────────────────────────────────────
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      formatVersion: state.formatVersion,
      pages: state.pages,
      activePageId: state.activePageId,
      view: state.view,
    }));
  } catch (e) { console.warn('[sketch] save failed', e); }
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (Array.isArray(obj.pages) && obj.pages.length) state.pages = obj.pages;
    if (obj.activePageId) state.activePageId = obj.activePageId;
    if (obj.view) state.view = obj.view;
  } catch (e) { console.warn('[sketch] load failed', e); }
}
function pushUndo() {
  _undoStack.push(JSON.stringify(state.pages));
  if (_undoStack.length > UNDO_MAX) _undoStack.shift();
  _redoStack.length = 0;
  _updateUndoButtons();
}
function _updateUndoButtons() {
  const ub = $('sk-undo'), rb = $('sk-redo');
  if (ub) ub.disabled = !_undoStack.length;
  if (rb) rb.disabled = !_redoStack.length;
}
function undo() {
  if (!_undoStack.length) return;
  _redoStack.push(JSON.stringify(state.pages));
  state.pages = JSON.parse(_undoStack.pop());
  if (!state.pages.find(p => p.id === state.activePageId)) state.activePageId = state.pages[0]?.id;
  _selection.clear();
  saveState();
  renderAll();
  _updateUndoButtons();
}
function redo() {
  if (!_redoStack.length) return;
  _undoStack.push(JSON.stringify(state.pages));
  state.pages = JSON.parse(_redoStack.pop());
  _selection.clear();
  saveState();
  renderAll();
  _updateUndoButtons();
}

function activePage() {
  return state.pages.find(p => p.id === state.activePageId) || state.pages[0];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const escAttr = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const escHtml = escAttr;
function uid(prefix = 'el') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
function svgPoint(clientX, clientY) {
  // Convert screen coords to SVG coords accounting for view transform.
  const s = svg();
  if (!s) return { x: 0, y: 0 };
  const rect = s.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const v = state.view;
  return { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
}
function applyViewTransform() {
  const t = `translate(${state.view.tx},${state.view.ty}) scale(${state.view.scale})`;
  shapesLayer().setAttribute('transform', t);
  edgesLayer().setAttribute('transform', t);
  overlayLayer().setAttribute('transform', t);
  gridLayer().setAttribute('transform', t);
  const lbl = $('sk-zoom-label');
  if (lbl) lbl.textContent = Math.round(state.view.scale * 100) + '%';
}

// ─── Palette rendering ──────────────────────────────────────────────────────
function renderPalette() {
  const host = $('sk-palette-cats');
  if (!host) return;
  const libs = listVisibleLibraries();
  const search = ($('sk-search')?.value || '').toLowerCase().trim();
  // Кнопка управления библиотеками сверху.
  const manageBtn = `
    <button type="button" id="sk-lib-manage" class="sk-toolbar-btn"
            style="width:100%;padding:6px 10px;background:#dbeafe;border:1px solid #93c5fd;color:#1e40af;border-radius:4px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;margin-bottom:6px"
            title="Управление библиотеками: клонирование seed, создание / редактирование пользовательских, импорт / экспорт JSON.">
      📚 Библиотеки (${libs.length} видимы)…
    </button>`;
  const html = libs.map(lib => {
    const shapes = lib.shapes.filter(s =>
      !search || (s.label && s.label.toLowerCase().includes(search)) || (s.id && s.id.toLowerCase().includes(search))
    );
    if (search && !shapes.length) return '';
    const tiles = shapes.map(s => {
      const w = s.defaultW || s.defaults?.w || 100;
      const h = s.defaultH || s.defaults?.h || 80;
      const renderFn = s.render;
      let svgFrag = '';
      try {
        svgFrag = (typeof renderFn === 'function') ? renderFn(w, h) : (renderFn || '');
      } catch { svgFrag = `<rect width="${w}" height="${h}"/>`; }
      // v0.60.152 (по репорту Пользователя 2026-05-04 «мог бы ты просто
      // забрать отображение из drawio а то у тебя как то не очень вид»):
      // wrap-<g> получает inline style fill:#fff + stroke:#1f2937 +
      // stroke-width:1.4 (drawio-like тонкая линия). Custom-fill внутри
      // фигур (например, fill="#fef3c7" у firewall) переопределяет
      // автоматически. Раньше тайлы рендерились чёрной заливкой т.к.
      // CSS-style на .sk-shape не применялся к .sk-tile-content.
      return `<div class="sk-shape-tile"
                   draggable="true"
                   data-lib-id="${escAttr(lib.id)}"
                   data-shape-id="${escAttr(s.id)}"
                   title="${escAttr(s.label)} — перетащите на холст">
        <svg viewBox="-2 -2 ${w+4} ${h+4}" preserveAspectRatio="xMidYMid meet" pointer-events="none">
          <g style="fill:#ffffff;stroke:#1f2937;stroke-width:1.4;stroke-linejoin:round" vector-effect="non-scaling-stroke">${svgFrag}</g>
        </svg>
        <span class="sk-shape-tile-label">${escHtml(s.label)}</span>
      </div>`;
    }).join('');
    if (!tiles) return '';
    const collapsed = ''; // TODO collapse-state per library
    return `<div class="sk-palette-cat ${collapsed}" data-lib-id="${escAttr(lib.id)}">
      <div class="sk-palette-cat-h">
        <span>${escHtml(lib.icon || '📦')} ${escHtml(lib.name)} <span class="muted" style="font-weight:400;font-size:10px">(${shapes.length})</span></span>
      </div>
      <div class="sk-palette-cat-body">${tiles}</div>
    </div>`;
  }).join('');
  host.innerHTML = manageBtn + (html || '<div class="muted" style="font-size:11px;padding:8px">По вашему запросу ничего не найдено.</div>');
  _wirePaletteEvents();
}

function _wirePaletteEvents() {
  // Кнопка управления.
  $('sk-lib-manage')?.addEventListener('click', openLibraryManager);
  // Collapse/expand категорий.
  document.querySelectorAll('.sk-palette-cat-h').forEach(h => {
    h.addEventListener('click', () => {
      h.parentElement.classList.toggle('collapsed');
    });
  });
  // Drag из tile в холст.
  document.querySelectorAll('.sk-shape-tile').forEach(tile => {
    tile.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      const payload = { libId: tile.dataset.libId, shapeId: tile.dataset.shapeId };
      e.dataTransfer.setData('application/x-raschet-sketch-shape', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.shapeId);
    });
  });
}

// ─── Canvas rendering ───────────────────────────────────────────────────────
function renderShape(sh) {
  // sh: { id, libraryId, shapeId, x, y, w, h, label, fill, stroke, fontSize }
  const lib = getLibrary(sh.libraryId);
  let shapeDef = null;
  if (lib) shapeDef = lib.shapes.find(s => s.id === sh.shapeId);
  if (!shapeDef) shapeDef = findShapeDef(sh.shapeId);
  let svgFrag = '';
  const w = sh.w, h = sh.h;
  if (shapeDef) {
    try {
      svgFrag = (typeof shapeDef.render === 'function') ? shapeDef.render(w, h) : (shapeDef.render || '');
    } catch { svgFrag = `<rect width="${w}" height="${h}"/>`; }
    // Если snapshot (string render для w=100,h=100) — используем viewBox для scaling.
    if (shapeDef._isSnapshot && typeof shapeDef.render === 'string') {
      const dw = shapeDef.defaultW || 100;
      const dh = shapeDef.defaultH || 100;
      svgFrag = `<svg width="${w}" height="${h}" viewBox="0 0 ${dw} ${dh}" preserveAspectRatio="none">${shapeDef.render}</svg>`;
    }
  } else {
    svgFrag = `<rect width="${w}" height="${h}"/>`;
  }
  const isSel = _selection.has(sh.id);
  // Anchor points (4 sides) for connecting.
  const anchorR = 4;
  const anchors = [
    { x: w/2, y: 0,  side: 'top' },
    { x: w,   y: h/2, side: 'right' },
    { x: w/2, y: h,  side: 'bottom' },
    { x: 0,   y: h/2, side: 'left' },
  ].map(a => `<circle class="sk-anchor" cx="${a.x}" cy="${a.y}" r="${anchorR}" data-anchor="${a.side}"/>`).join('');
  // Resize handles (8 positions) — only when selected.
  let handles = '';
  if (isSel && _selection.size === 1) {
    const hx = [0, w/2, w];
    const hy = [0, h/2, h];
    const dirs = ['nw', 'n', 'ne', 'w', '', 'e', 'sw', 's', 'se'];
    let i = 0;
    for (const y of hy) for (const x of hx) {
      const dir = dirs[i++];
      if (!dir) continue;
      handles += `<rect class="sk-handle h-${dir}" x="${x-4}" y="${y-4}" width="8" height="8" data-handle="${dir}"/>`;
    }
  }
  // Fill / stroke / opacity / rotation override (v0.60.153 — drawio-like).
  const fill = sh.fill || '#fff';
  const stroke = sh.stroke || '#1f2937';
  const strokeWidth = sh.strokeWidth ?? 1.4;
  const opacity = sh.opacity ?? 1;
  const rotation = sh.rotation || 0;
  const flipH = sh.flipH ? -1 : 1;
  const flipV = sh.flipV ? -1 : 1;
  const dashed = sh.dashed ? 'stroke-dasharray="6,4"' : '';
  // Label с textAlign/textVAlign + bold/italic/underline
  const labelText = sh.label || '';
  const fontSize = sh.fontSize || 12;
  const fontFamily = sh.fontFamily || 'system-ui';
  const textColor = sh.textColor || '#0f172a';
  const fontWeight = sh.bold ? 'bold' : 'normal';
  const fontStyle = sh.italic ? 'italic' : 'normal';
  const textDeco = sh.underline ? 'underline' : 'none';
  const ta = sh.textAlign || 'center';
  const tva = sh.textVAlign || 'middle';
  const tx = ta === 'left' ? 4 : ta === 'right' ? w - 4 : w/2;
  const tAnchor = ta === 'left' ? 'start' : ta === 'right' ? 'end' : 'middle';
  const ty = tva === 'top' ? fontSize + 2 : tva === 'bottom' ? h - 4 : h/2 + fontSize/3;
  const labelEl = labelText
    ? `<text x="${tx}" y="${ty}" text-anchor="${tAnchor}" font-size="${fontSize}" font-family="${escAttr(fontFamily)}" font-weight="${fontWeight}" font-style="${fontStyle}" text-decoration="${textDeco}" fill="${textColor}" pointer-events="none">${escHtml(labelText)}</text>`
    : '';
  // Rounded — для rect-фигур применяется в shape-render. Для прочих — нет
  // эффекта (неглавное MVP-ограничение).
  // Rotation + flip через transform на wrap-<g>.
  const innerTransform = (rotation || flipH < 0 || flipV < 0)
    ? `translate(${w/2},${h/2}) rotate(${rotation}) scale(${flipH},${flipV}) translate(${-w/2},${-h/2})`
    : '';
  const innerOpen = innerTransform
    ? `<g transform="${innerTransform}" style="fill:${fill};stroke:${stroke === 'none' ? 'none' : stroke};stroke-width:${strokeWidth};stroke-linejoin:round;opacity:${opacity}" ${dashed} vector-effect="non-scaling-stroke">`
    : `<g style="fill:${fill};stroke:${stroke === 'none' ? 'none' : stroke};stroke-width:${strokeWidth};stroke-linejoin:round;opacity:${opacity}" ${dashed} vector-effect="non-scaling-stroke">`;
  return `<g class="sk-shape ${isSel ? 'selected' : ''}" data-shape-id="${escAttr(sh.id)}"
              transform="translate(${sh.x},${sh.y})"
              style="--fill:${fill};--stroke:${stroke}">
    ${innerOpen}${svgFrag}</g>
    ${labelEl}
    ${anchors}
    ${handles}
  </g>`;
}

function renderEdge(ed) {
  const page = activePage();
  const fromShape = ed.from ? page.shapes.find(s => s.id === ed.from) : null;
  const toShape   = ed.to   ? page.shapes.find(s => s.id === ed.to)   : null;
  const p1 = _anchorPoint(fromShape, ed.fromAnchor) || { x: ed.fromX, y: ed.fromY };
  const p2 = _anchorPoint(toShape,   ed.toAnchor)   || { x: ed.toX,   y: ed.toY };
  // Ortho routing (drawio-style elbow).
  const midX = (p1.x + p2.x) / 2;
  const d = `M ${p1.x},${p1.y} L ${midX},${p1.y} L ${midX},${p2.y} L ${p2.x},${p2.y}`;
  const isSel = _selection.has(ed.id);
  const labelMid = { x: midX, y: (p1.y + p2.y) / 2 };
  const lbl = ed.label
    ? `<text class="sk-edge-label" x="${labelMid.x}" y="${labelMid.y}">${escHtml(ed.label)}</text>`
    : '';
  return `<g class="sk-edge-group" data-edge-id="${escAttr(ed.id)}">
    <path class="sk-edge-hit" d="${d}"/>
    <path class="sk-edge ${isSel ? 'selected' : ''}" d="${d}"
          marker-end="url(#sk-arrow${isSel ? '-sel' : ''})"
          ${ed.dashed ? 'stroke-dasharray="6,4"' : ''}/>
    ${lbl}
  </g>`;
}
function _anchorPoint(shape, side) {
  if (!shape) return null;
  const { x, y, w, h } = shape;
  switch (side) {
    case 'top':    return { x: x + w/2, y };
    case 'right':  return { x: x + w,   y: y + h/2 };
    case 'bottom': return { x: x + w/2, y: y + h };
    case 'left':   return { x,           y: y + h/2 };
    default: return { x: x + w/2, y: y + h/2 };
  }
}

function renderCanvas() {
  const page = activePage();
  shapesLayer().innerHTML = page.shapes.map(renderShape).join('');
  edgesLayer().innerHTML = page.edges.map(renderEdge).join('');
}
function renderAll() {
  renderPalette();
  renderCanvas();
  renderPages();
  renderProperties();
  applyViewTransform();
}

// ─── Pages ──────────────────────────────────────────────────────────────────
function renderPages() {
  const sel = $('sk-page-sel');
  if (!sel) return;
  sel.innerHTML = state.pages.map(p =>
    `<option value="${escAttr(p.id)}"${p.id === state.activePageId ? ' selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
}
function addPage() {
  pushUndo();
  const n = state.pages.length + 1;
  const page = { id: uid('page'), name: `Лист ${n}`, shapes: [], edges: [] };
  state.pages.push(page);
  state.activePageId = page.id;
  saveState(); renderAll();
}
async function removePage() {
  if (state.pages.length <= 1) {
    rsToast('Нельзя удалить последнюю страницу', 'warn');
    return;
  }
  const ok = await rsConfirm('Удалить текущую страницу?', 'Все фигуры и связи на ней будут потеряны.', { okLabel: 'Удалить', cancelLabel: 'Отмена' });
  if (!ok) return;
  pushUndo();
  const idx = state.pages.findIndex(p => p.id === state.activePageId);
  state.pages.splice(idx, 1);
  state.activePageId = state.pages[Math.max(0, idx - 1)].id;
  saveState(); renderAll();
}

// ─── Selection / Move / Resize ─────────────────────────────────────────────
function selectShape(id, additive = false) {
  if (!additive) _selection.clear();
  _selection.add(id);
  renderCanvas();
  renderProperties();
}
function selectNothing() {
  _selection.clear();
  renderCanvas();
  renderProperties();
}

// ─── Properties panel (drawio-style tabbed) ─────────────────────────────────
// v0.60.153 (по уточнению Пользователя 2026-05-04 — скриншоты drawio): право-
// панельный UI с tabs «Стиль / Текст / Упорядочить» при выделенной фигуре,
// и «Холст» когда ничего не выделено.
let _propsActiveTab = 'style';  // 'style' | 'text' | 'arrange' | 'canvas'
const COLOR_PRESETS = [
  '#ffffff', '#f3f4f6', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2',
  '#fce7f3', '#ede9fe', '#cffafe', '#e0e7ff', '#1f2937', '#000000',
];
const STROKE_PRESETS = [
  '#1f2937', '#000000', '#475569', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0891b2', '#1e40af', '#7c3aed', '#db2777', '#94a3b8',
];

function renderProperties() {
  const host = $('sk-properties');
  if (!host) return;
  if (_selection.size === 0) {
    host.innerHTML = _renderCanvasProperties();
    _wireCanvasProperties();
    return;
  }
  if (_selection.size > 1) {
    host.innerHTML = `<div class="sk-properties-empty">Выделено ${_selection.size} элементов. Multi-edit — TODO.</div>`;
    return;
  }
  const id = [..._selection][0];
  const page = activePage();
  const sh = page.shapes.find(s => s.id === id);
  const ed = page.edges.find(e => e.id === id);
  if (sh) {
    if (_propsActiveTab === 'canvas') _propsActiveTab = 'style';
    host.innerHTML = _renderShapeTabs(sh);
    _wireShapeTabs(sh);
  } else if (ed) {
    host.innerHTML = _renderEdgeProperties(ed);
    _wireEdgeProperties(ed);
  }
}

function _renderShapeTabs(sh) {
  const tabBtn = (id, label, title) => {
    const active = _propsActiveTab === id;
    return `<button type="button" class="sk-tab-btn${active ? ' active' : ''}" data-tab="${id}" title="${escAttr(title)}">${label}</button>`;
  };
  let body = '';
  if (_propsActiveTab === 'style') body = _renderStyleTab(sh);
  else if (_propsActiveTab === 'text') body = _renderTextTab(sh);
  else if (_propsActiveTab === 'arrange') body = _renderArrangeTab(sh);
  return `
    <div class="sk-tabs">
      ${tabBtn('style', '🎨 Стиль', 'Заливка, обводка, прозрачность, скругление')}
      ${tabBtn('text', '📝 Текст', 'Шрифт, размер, выравнивание, цвет текста')}
      ${tabBtn('arrange', '📐 Упорядочить', 'Позиция, размер, поворот, слой')}
    </div>
    <div class="sk-tab-body">${body}</div>
    <div class="sk-tab-foot">
      <button type="button" id="sk-shape-add-to-lib" class="sk-btn-ghost"
              title="Добавить эту фигуру в пользовательскую библиотеку (snapshot — позже доступна в палитре).">📥 В библиотеку</button>
      <button type="button" id="sk-shape-duplicate" class="sk-btn-ghost"
              title="Создать копию рядом (Ctrl+D).">⧉ Копия</button>
      <button type="button" id="sk-shape-delete" class="sk-btn-danger"
              title="Удалить (Del).">🗑 Удалить</button>
    </div>`;
}

function _colorPresetsHtml(prop, current, presets, label) {
  const tiles = presets.map(c => {
    const sel = (c.toLowerCase() === String(current || '').toLowerCase()) ? ' selected' : '';
    return `<button type="button" class="sk-color-preset${sel}" data-prop="${escAttr(prop)}" data-val="${escAttr(c)}" style="background:${c}" title="${escAttr(c)}"></button>`;
  }).join('');
  return `
    <div class="sk-prop-label">${escHtml(label)}</div>
    <div class="sk-color-row">
      <div class="sk-color-presets">${tiles}</div>
      <input type="color" class="sk-color-picker" data-prop="${escAttr(prop)}" value="${escAttr(current || (prop === 'fill' ? '#ffffff' : '#1f2937'))}" title="Выбрать произвольный цвет">
    </div>`;
}

function _renderStyleTab(sh) {
  const fill = sh.fill || '#ffffff';
  const stroke = sh.stroke || '#1f2937';
  const strokeWidth = sh.strokeWidth ?? 1.4;
  const opacity = sh.opacity ?? 1;
  const rounded = !!sh.rounded;
  const dashed = !!sh.dashed;
  const noFill = sh.fill === 'none';
  const noStroke = sh.stroke === 'none';
  return `
    ${_colorPresetsHtml('fill', noFill ? '' : fill, COLOR_PRESETS, '🎨 Заливка')}
    <label class="sk-prop-check">
      <input type="checkbox" data-prop="_noFill"${noFill ? ' checked' : ''}>
      <span>Без заливки (прозрачная)</span>
    </label>
    ${_colorPresetsHtml('stroke', noStroke ? '' : stroke, STROKE_PRESETS, '✏ Линия')}
    <label class="sk-prop-check">
      <input type="checkbox" data-prop="_noStroke"${noStroke ? ' checked' : ''}>
      <span>Без линии</span>
    </label>
    <div class="sk-prop-row">
      <label>Толщина, pt
        <input type="number" data-prop="strokeWidth" min="0.5" max="10" step="0.1" value="${strokeWidth}">
      </label>
      <label>Стиль
        <select data-prop="dashed">
          <option value="0"${!dashed ? ' selected' : ''}>──── сплошная</option>
          <option value="1"${dashed ? ' selected' : ''}>- - - пунктир</option>
        </select>
      </label>
    </div>
    <label>Непрозрачность: <span class="sk-slider-val">${Math.round(opacity * 100)}%</span>
      <input type="range" data-prop="opacity" min="0" max="1" step="0.05" value="${opacity}">
    </label>
    <label class="sk-prop-check" title="Скруглить углы (для прямоугольников и параллелепипедов).">
      <input type="checkbox" data-prop="rounded"${rounded ? ' checked' : ''}>
      <span>Скруглённые углы</span>
    </label>`;
}

function _renderTextTab(sh) {
  const fontSize = sh.fontSize || 12;
  const fontFamily = sh.fontFamily || 'system-ui';
  const bold = !!sh.bold;
  const italic = !!sh.italic;
  const underline = !!sh.underline;
  const textColor = sh.textColor || '#0f172a';
  const textAlign = sh.textAlign || 'center';
  const textVAlign = sh.textVAlign || 'middle';
  return `
    <label>Подпись
      <textarea data-prop="label" rows="3" placeholder="Текст в фигуре">${escHtml(sh.label || '')}</textarea>
    </label>
    <div class="sk-prop-row">
      <label>Шрифт
        <select data-prop="fontFamily">
          <option value="system-ui"${fontFamily === 'system-ui' ? ' selected' : ''}>System UI</option>
          <option value="Helvetica, Arial, sans-serif"${fontFamily.includes('Helvetica') ? ' selected' : ''}>Helvetica</option>
          <option value="Arial, sans-serif"${fontFamily.includes('Arial') && !fontFamily.includes('Helvetica') ? ' selected' : ''}>Arial</option>
          <option value="Verdana, sans-serif"${fontFamily.includes('Verdana') ? ' selected' : ''}>Verdana</option>
          <option value="Georgia, serif"${fontFamily.includes('Georgia') ? ' selected' : ''}>Georgia</option>
          <option value="Times New Roman, serif"${fontFamily.includes('Times') ? ' selected' : ''}>Times New Roman</option>
          <option value="Courier New, monospace"${fontFamily.includes('Courier') ? ' selected' : ''}>Courier New</option>
        </select>
      </label>
      <label>Размер, px
        <input type="number" data-prop="fontSize" min="6" max="72" value="${fontSize}">
      </label>
    </div>
    <div class="sk-style-buttons">
      <button type="button" class="sk-style-btn${bold ? ' active' : ''}" data-prop="bold" title="Жирный (Ctrl+B)"><b>B</b></button>
      <button type="button" class="sk-style-btn${italic ? ' active' : ''}" data-prop="italic" title="Курсив (Ctrl+I)"><i>I</i></button>
      <button type="button" class="sk-style-btn${underline ? ' active' : ''}" data-prop="underline" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
    </div>
    <div class="sk-prop-label">Выравнивание</div>
    <div class="sk-style-buttons">
      <button type="button" class="sk-style-btn${textAlign === 'left' ? ' active' : ''}" data-prop="textAlign" data-val="left" title="По левому краю">⇤</button>
      <button type="button" class="sk-style-btn${textAlign === 'center' ? ' active' : ''}" data-prop="textAlign" data-val="center" title="По центру">⇔</button>
      <button type="button" class="sk-style-btn${textAlign === 'right' ? ' active' : ''}" data-prop="textAlign" data-val="right" title="По правому краю">⇥</button>
      <span style="width:8px"></span>
      <button type="button" class="sk-style-btn${textVAlign === 'top' ? ' active' : ''}" data-prop="textVAlign" data-val="top" title="Сверху">⇡</button>
      <button type="button" class="sk-style-btn${textVAlign === 'middle' ? ' active' : ''}" data-prop="textVAlign" data-val="middle" title="По центру">⇕</button>
      <button type="button" class="sk-style-btn${textVAlign === 'bottom' ? ' active' : ''}" data-prop="textVAlign" data-val="bottom" title="Снизу">⇣</button>
    </div>
    ${_colorPresetsHtml('textColor', textColor, STROKE_PRESETS, 'Цвет текста')}`;
}

function _renderArrangeTab(sh) {
  const rotation = sh.rotation || 0;
  const lockProps = !!sh.lockProportions;
  const aspect = sh.h ? (sh.w / sh.h) : 1;
  return `
    <div class="sk-prop-label">📐 Размер</div>
    <div class="sk-prop-row">
      <label>Ширина<input type="number" data-prop="w" min="20" value="${Math.round(sh.w)}" data-aspect="${aspect}"></label>
      <label>Высота<input type="number" data-prop="h" min="20" value="${Math.round(sh.h)}" data-aspect="${aspect}"></label>
    </div>
    <label class="sk-prop-check" title="При изменении ширины автоматически масштабируется высота (и наоборот).">
      <input type="checkbox" data-prop="lockProportions"${lockProps ? ' checked' : ''}>
      <span>Сохранить пропорции</span>
    </label>
    <div class="sk-prop-label">📍 Положение</div>
    <div class="sk-prop-row">
      <label>X<input type="number" data-prop="x" value="${Math.round(sh.x)}"></label>
      <label>Y<input type="number" data-prop="y" value="${Math.round(sh.y)}"></label>
    </div>
    <label>🔄 Поворот, °
      <input type="number" data-prop="rotation" min="-360" max="360" step="1" value="${rotation}">
    </label>
    <div class="sk-prop-label">↔ Отразить</div>
    <div class="sk-style-buttons">
      <button type="button" class="sk-style-btn" data-prop="_flipH" title="Отразить по горизонтали">⇋ H</button>
      <button type="button" class="sk-style-btn" data-prop="_flipV" title="Отразить по вертикали">⥯ V</button>
    </div>
    <div class="sk-prop-label">📚 Слой</div>
    <div class="sk-style-buttons" style="flex-wrap:wrap">
      <button type="button" class="sk-style-btn" data-prop="_layerFront" title="На передний план">↟</button>
      <button type="button" class="sk-style-btn" data-prop="_layerForward" title="Перенести вперёд">↑</button>
      <button type="button" class="sk-style-btn" data-prop="_layerBackward" title="Перенести назад">↓</button>
      <button type="button" class="sk-style-btn" data-prop="_layerBack" title="На задний план">↡</button>
    </div>`;
}

function _wireShapeTabs(sh) {
  const host = $('sk-properties');
  // Tab switching
  host.querySelectorAll('.sk-tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      _propsActiveTab = b.dataset.tab;
      renderProperties();
    });
  });
  // Color preset clicks
  host.querySelectorAll('.sk-color-preset').forEach(b => {
    b.addEventListener('click', () => {
      pushUndo();
      sh[b.dataset.prop] = b.dataset.val;
      saveState();
      renderCanvas();
      renderProperties();
    });
  });
  // Style toggle buttons (B/I/U/align/flip/layer)
  host.querySelectorAll('.sk-style-btn').forEach(b => {
    b.addEventListener('click', () => {
      pushUndo();
      const prop = b.dataset.prop;
      const val = b.dataset.val;
      if (prop === '_flipH') { sh.flipH = !sh.flipH; }
      else if (prop === '_flipV') { sh.flipV = !sh.flipV; }
      else if (prop === '_layerFront') _moveLayer(sh, 'front');
      else if (prop === '_layerBack') _moveLayer(sh, 'back');
      else if (prop === '_layerForward') _moveLayer(sh, 'forward');
      else if (prop === '_layerBackward') _moveLayer(sh, 'backward');
      else if (val !== undefined) sh[prop] = val;
      else sh[prop] = !sh[prop];  // toggle bool
      saveState();
      renderCanvas();
      renderProperties();
    });
  });
  // Generic data-prop inputs (input/textarea/select/range/color)
  host.querySelectorAll('[data-prop]:not(.sk-color-preset):not(.sk-style-btn)').forEach(inp => {
    const evtName = inp.type === 'range' ? 'input' : 'change';
    inp.addEventListener(evtName, () => {
      pushUndo();
      const prop = inp.dataset.prop;
      let val;
      if (inp.type === 'checkbox') val = inp.checked;
      else if (inp.type === 'number' || inp.type === 'range') val = Number(inp.value);
      else val = inp.value;
      // Special meta-props
      if (prop === '_noFill') {
        sh.fill = val ? 'none' : (sh.fill === 'none' ? '#ffffff' : sh.fill);
      } else if (prop === '_noStroke') {
        sh.stroke = val ? 'none' : (sh.stroke === 'none' ? '#1f2937' : sh.stroke);
      } else if (prop === 'dashed') {
        sh.dashed = !!Number(val);
      } else if (prop === 'lockProportions') {
        sh.lockProportions = val;
      } else if ((prop === 'w' || prop === 'h') && sh.lockProportions) {
        const aspect = Number(inp.dataset.aspect) || (sh.w / sh.h);
        if (prop === 'w') { sh.w = val; sh.h = Math.round(val / aspect); }
        else { sh.h = val; sh.w = Math.round(val * aspect); }
      } else {
        sh[prop] = val;
      }
      // Update slider value display
      if (inp.type === 'range') {
        const lbl = inp.parentElement.querySelector('.sk-slider-val');
        if (lbl) lbl.textContent = Math.round(val * 100) + '%';
      }
      saveState();
      renderCanvas();
      // Не renderProperties для текстового ввода (label) — потеряет фокус.
      if (prop === 'label' || prop === 'fontFamily' || prop === 'fontSize') return;
      renderProperties();
    });
  });
  $('sk-shape-delete')?.addEventListener('click', () => deleteSelection());
  $('sk-shape-add-to-lib')?.addEventListener('click', () => addShapeToUserLibrary(sh));
  $('sk-shape-duplicate')?.addEventListener('click', () => duplicateSelection());
}

function _moveLayer(sh, dir) {
  const arr = activePage().shapes;
  const idx = arr.indexOf(sh);
  if (idx < 0) return;
  arr.splice(idx, 1);
  if (dir === 'front')   arr.push(sh);
  else if (dir === 'back') arr.unshift(sh);
  else if (dir === 'forward')  arr.splice(Math.min(arr.length, idx + 1), 0, sh);
  else if (dir === 'backward') arr.splice(Math.max(0, idx - 1), 0, sh);
}
function duplicateSelection() {
  if (!_selection.size) return;
  const page = activePage();
  pushUndo();
  const newIds = [];
  for (const id of _selection) {
    const sh = page.shapes.find(s => s.id === id);
    if (!sh) continue;
    const copy = JSON.parse(JSON.stringify(sh));
    copy.id = uid('sh');
    copy.x += 20;
    copy.y += 20;
    page.shapes.push(copy);
    newIds.push(copy.id);
  }
  _selection.clear();
  newIds.forEach(id => _selection.add(id));
  saveState();
  renderCanvas();
  renderProperties();
}

// ─── Canvas-level properties (when nothing selected) ───────────────────────
function _renderCanvasProperties() {
  const v = state.view || {};
  return `
    <div class="sk-tabs">
      <button type="button" class="sk-tab-btn active" data-tab="canvas">📋 Холст</button>
    </div>
    <div class="sk-tab-body">
      <div class="sk-prop-label">📋 Текущая страница</div>
      <label>Имя
        <input type="text" data-cprop="pageName" value="${escAttr(activePage().name || '')}">
      </label>
      <div class="sk-prop-label">🔍 Вид</div>
      <div class="sk-prop-row">
        <label>Zoom
          <input type="number" data-cprop="zoom" min="20" max="500" step="10" value="${Math.round((v.scale || 1) * 100)}"> %
        </label>
        <button type="button" id="sk-canvas-fit" class="sk-btn-ghost" title="Вписать содержимое (F)">⛶ Fit</button>
      </div>
      <div class="sk-prop-label">📊 Статистика</div>
      <p class="muted" style="font-size:11.5px;margin:0">
        Фигур: <b>${activePage().shapes.length}</b> · связей: <b>${activePage().edges.length}</b><br>
        Страниц всего: <b>${state.pages.length}</b>
      </p>
      <div class="sk-prop-label">⚡ Шорткаты</div>
      <p class="muted" style="font-size:11px;line-height:1.5;margin:0">
        <b>V</b> — выделение · <b>C</b> — соединение · <b>T</b> — текст<br>
        <b>Del</b> — удалить · <b>Ctrl+D</b> — копия · <b>Ctrl+Z/Y</b> — отмена/повтор<br>
        <b>F</b> — вписать · <b>Esc</b> — снять выделение<br>
        <b>Ctrl+wheel</b> — zoom · <b>Alt+drag</b> — pan
      </p>
    </div>`;
}
function _wireCanvasProperties() {
  const host = $('sk-properties');
  host.querySelectorAll('[data-cprop]').forEach(inp => {
    inp.addEventListener('change', () => {
      const prop = inp.dataset.cprop;
      if (prop === 'pageName') {
        pushUndo();
        activePage().name = inp.value;
        saveState();
        renderPages();
      } else if (prop === 'zoom') {
        const z = Math.max(0.2, Math.min(5, Number(inp.value) / 100 || 1));
        state.view.scale = z;
        applyViewTransform();
        saveState();
      }
    });
  });
  $('sk-canvas-fit')?.addEventListener('click', fitView);
}

function _renderEdgeProperties(ed) {
  return `
    <div class="sk-tabs">
      <button type="button" class="sk-tab-btn active">↔ Связь</button>
    </div>
    <div class="sk-tab-body">
      <label>Подпись<input type="text" data-prop="label" value="${escAttr(ed.label || '')}"></label>
      <label class="sk-prop-check">
        <input type="checkbox" data-prop="dashed"${ed.dashed ? ' checked' : ''}>
        <span>Пунктирная линия</span>
      </label>
      <div class="sk-prop-row">
        <label>Толщина, pt
          <input type="number" data-prop="strokeWidth" min="0.5" max="6" step="0.1" value="${ed.strokeWidth || 1.4}">
        </label>
        <label>Стиль стрелки
          <select data-prop="arrowStyle">
            <option value="end"${(ed.arrowStyle || 'end') === 'end' ? ' selected' : ''}>→ Конец</option>
            <option value="both"${ed.arrowStyle === 'both' ? ' selected' : ''}>↔ Обе</option>
            <option value="none"${ed.arrowStyle === 'none' ? ' selected' : ''}>── Без стрелки</option>
          </select>
        </label>
      </div>
      ${_colorPresetsHtml('stroke', ed.stroke || '#475569', STROKE_PRESETS, 'Цвет линии')}
    </div>
    <div class="sk-tab-foot">
      <button type="button" id="sk-edge-delete" class="sk-btn-danger" title="Удалить (Del)">🗑 Удалить</button>
    </div>`;
}
function _wireEdgeProperties(ed) {
  const host = $('sk-properties');
  host.querySelectorAll('.sk-color-preset').forEach(b => {
    b.addEventListener('click', () => {
      pushUndo();
      ed[b.dataset.prop] = b.dataset.val;
      saveState();
      renderCanvas();
      renderProperties();
    });
  });
  host.querySelectorAll('[data-prop]:not(.sk-color-preset)').forEach(inp => {
    inp.addEventListener('change', () => {
      const prop = inp.dataset.prop;
      let val = inp.type === 'checkbox' ? inp.checked : inp.value;
      pushUndo();
      ed[prop] = val;
      saveState(); renderCanvas();
    });
  });
  $('sk-edge-delete')?.addEventListener('click', () => deleteSelection());
}

async function addShapeToUserLibrary(sh) {
  // Дать выбрать библиотеку.
  const userLibs = listAllLibraries().filter(l => l.scope === 'user');
  if (!userLibs.length) {
    const ok = await rsConfirm('Нет пользовательских библиотек', 'Создать новую библиотеку для этой фигуры?', { okLabel: 'Создать', cancelLabel: 'Отмена' });
    if (!ok) return;
    const name = await rsPrompt('Имя новой библиотеки:', 'Мои фигуры');
    if (!name) return;
    const lib = addUserLibrary(name);
    userLibs.push(lib);
  }
  // Простой выбор — модалка.
  const libId = userLibs.length === 1 ? userLibs[0].id : await _pickLibraryModal(userLibs);
  if (!libId) return;
  const labelDefault = sh.label || sh.shapeId;
  const label = await rsPrompt('Имя фигуры в библиотеке:', labelDefault);
  if (!label) return;
  // Snapshot SVG: рендерим shape по defaults и сохраняем как строку.
  const def = findShapeDef(sh.shapeId) || (getLibrary(sh.libraryId)?.shapes.find(s => s.id === sh.shapeId));
  let render = '<rect width="100" height="60"/>';
  if (def) {
    try {
      render = (typeof def.render === 'function') ? def.render(100, 100) : def.render;
    } catch {}
  }
  const newShape = addShapeToLibrary(libId, {
    label,
    render,
    defaultW: Math.round(sh.w) || 100,
    defaultH: Math.round(sh.h) || 60,
  });
  if (newShape) {
    rsToast(`✓ Фигура «${label}» добавлена в библиотеку`, 'ok');
    renderPalette();
  }
}
function _pickLibraryModal(libs) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font:13px system-ui,sans-serif';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:8px;max-width:400px;width:100%;padding:16px;box-shadow:0 12px 48px rgba(0,0,0,0.3)">
        <h3 style="margin:0 0 8px">Выберите библиотеку</h3>
        <div style="display:flex;flex-direction:column;gap:4px;margin:8px 0">
          ${libs.map(l => `<button type="button" data-lib-id="${escAttr(l.id)}" style="text-align:left;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;cursor:pointer;font:inherit;font-size:13px">${escHtml(l.icon || '📦')} ${escHtml(l.name)} <span class="muted" style="font-size:11px">(${l.shapes.length} фигур)</span></button>`).join('')}
        </div>
        <button type="button" id="sk-lib-pick-cancel" style="margin-top:8px;padding:6px 14px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;border-radius:4px">Отмена</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-lib-id]').forEach(b => {
      b.addEventListener('click', () => { overlay.remove(); resolve(b.dataset.libId); });
    });
    overlay.querySelector('#sk-lib-pick-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
  });
}

// ─── Library Manager modal ─────────────────────────────────────────────────
function openLibraryManager() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font:13px system-ui,sans-serif';
  const render = () => {
    const libs = listAllLibraries();
    const rows = libs.map(l => {
      const visible = isLibraryVisible(l.id);
      const scopeIcon = l.scope === 'seed' ? '📦' : l.scope === 'user' ? '✏' : '👥';
      const scopeLbl = l.scope === 'seed' ? 'встроенная' : l.scope === 'user' ? 'личная' : 'организация';
      const actions = [];
      // Toggle visibility
      actions.push(`<button type="button" class="lib-vis" data-lib-id="${escAttr(l.id)}" title="${visible ? 'Скрыть' : 'Показать'} библиотеку в палитре">${visible ? '👁' : '🙈'}</button>`);
      // Clone (для seed/org)
      if (l.scope === 'seed' || l.scope === 'org') {
        actions.push(`<button type="button" class="lib-clone" data-lib-id="${escAttr(l.id)}" title="Скопировать как личную (можно потом редактировать)">📋</button>`);
      }
      // Promote user → org
      if (l.scope === 'user') {
        actions.push(`<button type="button" class="lib-promote" data-lib-id="${escAttr(l.id)}" title="Опубликовать в каталог организации">↑</button>`);
      }
      // Export
      actions.push(`<button type="button" class="lib-export" data-lib-id="${escAttr(l.id)}" title="Скачать библиотеку как JSON">📤</button>`);
      // Delete (только user/org)
      if (l.scope !== 'seed') {
        actions.push(`<button type="button" class="lib-delete" data-lib-id="${escAttr(l.id)}" title="Удалить библиотеку" style="color:#dc2626">×</button>`);
      }
      return `<tr data-lib-id="${escAttr(l.id)}" style="border-bottom:1px solid #e5e7eb">
        <td style="padding:6px 8px">${escHtml(l.icon || '📦')}</td>
        <td style="padding:6px 8px;font-weight:600">${escHtml(l.name)}</td>
        <td style="padding:6px 8px;font-size:11px;color:#64748b">${scopeIcon} ${scopeLbl}</td>
        <td style="padding:6px 8px;text-align:center">${l.shapes.length}</td>
        <td style="padding:6px 8px;white-space:nowrap;text-align:right">${actions.join(' ')}</td>
      </tr>`;
    }).join('');
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:8px;max-width:780px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">📚 Управление библиотеками фигур</h3>
          <button type="button" id="sk-lib-close" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;padding:0 6px">×</button>
        </div>
        <div style="padding:12px 16px;flex:1;overflow-y:auto">
          <p class="muted" style="margin:0 0 8px;font-size:11.5px">
            👁 — показать/скрыть в палитре · 📋 — клонировать как личную · ↑ — в организацию · 📤 — экспорт JSON · × — удалить.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead><tr style="background:#f1f5f9;border-bottom:1px solid #e2e8f0;text-align:left">
              <th style="padding:6px 8px"></th><th style="padding:6px 8px">Имя</th><th style="padding:6px 8px">Тип</th><th style="padding:6px 8px;text-align:center">Фигур</th><th style="padding:6px 8px;text-align:right">Действия</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="padding:10px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" id="sk-lib-create" style="padding:6px 14px;background:#16a34a;color:#fff;border:0;border-radius:4px;cursor:pointer;font:inherit;font-size:12.5px">＋ Создать библиотеку</button>
          <button type="button" id="sk-lib-import" style="padding:6px 14px;background:#3b82f6;color:#fff;border:0;border-radius:4px;cursor:pointer;font:inherit;font-size:12.5px">📥 Импорт JSON</button>
          <input type="file" id="sk-lib-import-file" accept="application/json,.json" hidden>
          <button type="button" id="sk-lib-done" style="margin-left:auto;padding:6px 14px;background:#1e40af;color:#fff;border:0;border-radius:4px;cursor:pointer;font:inherit;font-size:12.5px">Готово</button>
        </div>
      </div>`;
    _wireLibManagerEvents(overlay, render);
  };
  render();
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
function _wireLibManagerEvents(overlay, rerender) {
  overlay.querySelector('#sk-lib-close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#sk-lib-done')?.addEventListener('click', () => { overlay.remove(); renderPalette(); });
  // Visibility toggles
  overlay.querySelectorAll('.lib-vis').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.libId;
    setLibraryVisibility(id, !isLibraryVisible(id));
    rerender();
  }));
  // Clone
  overlay.querySelectorAll('.lib-clone').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.libId;
    const src = getLibrary(id);
    const name = await rsPrompt('Имя копии:', (src?.name || '') + ' (копия)');
    if (!name) return;
    cloneLibraryToUser(id, name);
    rsToast('✓ Скопировано в личные', 'ok');
    rerender();
  }));
  // Promote
  overlay.querySelectorAll('.lib-promote').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.libId;
    const ok = await rsConfirm('Опубликовать в организацию?', 'Будет видна всем членам команды.', { okLabel: '↑ Опубликовать', cancelLabel: 'Отмена' });
    if (!ok) return;
    // promote через library-store
    const { promoteUserToOrg } = await import('./library-store.js');
    promoteUserToOrg(id);
    rsToast('✓ Опубликовано', 'ok');
    rerender();
  }));
  // Export
  overlay.querySelectorAll('.lib-export').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.libId;
    const json = exportLibrary(id);
    if (!json) return;
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sketch-library-${(json.name || id).replace(/[^a-zA-Z0-9а-яА-Я-_]/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    rsToast('✓ Экспорт скачан', 'ok');
  }));
  // Delete
  overlay.querySelectorAll('.lib-delete').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.libId;
    const lib = getLibrary(id);
    const ok = await rsConfirm(`Удалить библиотеку «${lib.name}»?`, 'Действие необратимо.', { okLabel: 'Удалить', cancelLabel: 'Отмена' });
    if (!ok) return;
    if (lib.scope === 'user') deleteUserLibrary(id);
    else if (lib.scope === 'org') (await import('./library-store.js')).deleteOrgLibrary(id);
    rerender();
  }));
  // Create new
  overlay.querySelector('#sk-lib-create')?.addEventListener('click', async () => {
    const name = await rsPrompt('Имя новой библиотеки:', 'Моя библиотека');
    if (!name) return;
    addUserLibrary(name);
    rsToast('✓ Создана', 'ok');
    rerender();
  });
  // Import
  overlay.querySelector('#sk-lib-import')?.addEventListener('click', () => {
    overlay.querySelector('#sk-lib-import-file').click();
  });
  overlay.querySelector('#sk-lib-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const lib = importLibrary(json);
      rsToast(`✓ Импорт: «${lib.name}» (${lib.shapes.length} фигур)`, 'ok');
      rerender();
    } catch (err) {
      rsToast('Ошибка импорта: ' + (err.message || err), 'err');
    }
    e.target.value = '';
  });
}

// ─── Drop from palette / Click-create ──────────────────────────────────────
function _onCanvasDragOver(e) {
  if (e.dataTransfer.types.includes('application/x-raschet-sketch-shape')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}
function _onCanvasDrop(e) {
  const data = e.dataTransfer.getData('application/x-raschet-sketch-shape');
  if (!data) return;
  e.preventDefault();
  let payload;
  try { payload = JSON.parse(data); } catch { return; }
  const lib = getLibrary(payload.libId);
  const def = lib?.shapes.find(s => s.id === payload.shapeId);
  if (!def) return;
  const pt = svgPoint(e.clientX, e.clientY);
  const w = def.defaultW || def.defaults?.w || 100;
  const h = def.defaultH || def.defaults?.h || 80;
  pushUndo();
  const sh = {
    id: uid('sh'),
    libraryId: payload.libId,
    shapeId: payload.shapeId,
    x: Math.round(pt.x - w/2),
    y: Math.round(pt.y - h/2),
    w, h,
    label: def.label,
    fill: '#fff',
    stroke: '#1f2937',
    fontSize: 12,
  };
  activePage().shapes.push(sh);
  saveState();
  selectShape(sh.id);
}

// ─── Mouse interactions on SVG ──────────────────────────────────────────────
let _dragState = null;
function _onSvgMouseDown(e) {
  const pt = svgPoint(e.clientX, e.clientY);
  // Click on anchor → start connect
  const anchor = e.target.closest('.sk-anchor');
  if (anchor && _activeTool !== 'text') {
    e.preventDefault();
    const shapeEl = anchor.closest('.sk-shape');
    const shapeId = shapeEl?.dataset.shapeId;
    const side = anchor.dataset.anchor;
    _dragState = { kind: 'connect', fromShapeId: shapeId, fromSide: side, toX: pt.x, toY: pt.y };
    return;
  }
  // Click on resize handle
  const handle = e.target.closest('.sk-handle');
  if (handle) {
    e.preventDefault();
    const shapeEl = handle.closest('.sk-shape');
    const shapeId = shapeEl.dataset.shapeId;
    const sh = activePage().shapes.find(s => s.id === shapeId);
    if (!sh) return;
    pushUndo();
    _dragState = { kind: 'resize', shapeId, dir: handle.dataset.handle, startPt: pt, orig: { x: sh.x, y: sh.y, w: sh.w, h: sh.h } };
    return;
  }
  // Click on shape → select + start move
  const shape = e.target.closest('.sk-shape');
  if (shape) {
    e.preventDefault();
    const id = shape.dataset.shapeId;
    if (!_selection.has(id)) selectShape(id, e.shiftKey);
    pushUndo();
    const moves = [..._selection].map(sid => {
      const s = activePage().shapes.find(x => x.id === sid);
      return s ? { id: sid, ox: s.x, oy: s.y } : null;
    }).filter(Boolean);
    _dragState = { kind: 'move', startPt: pt, moves };
    return;
  }
  // Click on edge → select
  const edgeG = e.target.closest('.sk-edge-group');
  if (edgeG) {
    e.preventDefault();
    selectShape(edgeG.dataset.edgeId, e.shiftKey);
    return;
  }
  // Empty canvas — start pan (middle mouse / space) or drag-select
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    _dragState = { kind: 'pan', startClientX: e.clientX, startClientY: e.clientY, origTx: state.view.tx, origTy: state.view.ty };
    svg().classList.add('panning');
    return;
  }
  // Click on empty — deselect.
  selectNothing();
}
function _onSvgMouseMove(e) {
  if (!_dragState) return;
  const pt = svgPoint(e.clientX, e.clientY);
  if (_dragState.kind === 'move') {
    const dx = pt.x - _dragState.startPt.x;
    const dy = pt.y - _dragState.startPt.y;
    _dragState.moves.forEach(m => {
      const s = activePage().shapes.find(x => x.id === m.id);
      if (s) { s.x = Math.round(m.ox + dx); s.y = Math.round(m.oy + dy); }
    });
    renderCanvas();
  } else if (_dragState.kind === 'resize') {
    const sh = activePage().shapes.find(s => s.id === _dragState.shapeId);
    if (!sh) return;
    const o = _dragState.orig;
    const dx = pt.x - _dragState.startPt.x;
    const dy = pt.y - _dragState.startPt.y;
    const dir = _dragState.dir;
    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
    if (dir.includes('e')) nw = Math.max(20, o.w + dx);
    if (dir.includes('s')) nh = Math.max(20, o.h + dy);
    if (dir.includes('w')) { nw = Math.max(20, o.w - dx); nx = o.x + (o.w - nw); }
    if (dir.includes('n')) { nh = Math.max(20, o.h - dy); ny = o.y + (o.h - nh); }
    sh.x = Math.round(nx); sh.y = Math.round(ny);
    sh.w = Math.round(nw); sh.h = Math.round(nh);
    renderCanvas();
  } else if (_dragState.kind === 'connect') {
    _dragState.toX = pt.x;
    _dragState.toY = pt.y;
    // Draw temp edge in overlay
    const tmpEd = {
      id: '_tmp',
      from: _dragState.fromShapeId, fromAnchor: _dragState.fromSide,
      toX: pt.x, toY: pt.y,
    };
    overlayLayer().innerHTML = renderEdge(tmpEd);
  } else if (_dragState.kind === 'pan') {
    const dx = e.clientX - _dragState.startClientX;
    const dy = e.clientY - _dragState.startClientY;
    state.view.tx = _dragState.origTx + dx;
    state.view.ty = _dragState.origTy + dy;
    applyViewTransform();
  }
}
function _onSvgMouseUp(e) {
  if (!_dragState) return;
  if (_dragState.kind === 'connect') {
    overlayLayer().innerHTML = '';
    // Find target shape under mouse
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    const tShape = targetEl?.closest('.sk-shape');
    if (tShape && tShape.dataset.shapeId !== _dragState.fromShapeId) {
      const targetId = tShape.dataset.shapeId;
      const tAnchor = targetEl?.closest('.sk-anchor');
      const ed = {
        id: uid('ed'),
        from: _dragState.fromShapeId, fromAnchor: _dragState.fromSide,
        to: targetId, toAnchor: tAnchor?.dataset.anchor || 'left',
        label: '', dashed: false,
      };
      pushUndo();
      activePage().edges.push(ed);
      saveState();
    }
    renderCanvas();
  } else if (_dragState.kind === 'move' || _dragState.kind === 'resize') {
    saveState();
  } else if (_dragState.kind === 'pan') {
    svg().classList.remove('panning');
    saveState();
  }
  _dragState = null;
}

function _onSvgWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    // Zoom around cursor
    const pt = svgPoint(e.clientX, e.clientY);
    const old = state.view.scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.max(0.2, Math.min(5, old * delta));
    state.view.scale = next;
    // Adjust tx/ty so that cursor world point stays in place.
    const rect = svg().getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    state.view.tx = cx - pt.x * next;
    state.view.ty = cy - pt.y * next;
    applyViewTransform();
    saveState();
  }
}

function deleteSelection() {
  if (!_selection.size) return;
  pushUndo();
  const page = activePage();
  page.shapes = page.shapes.filter(s => !_selection.has(s.id));
  page.edges = page.edges.filter(e => !_selection.has(e.id) && !_selection.has(e.from) && !_selection.has(e.to));
  _selection.clear();
  saveState(); renderCanvas(); renderProperties();
}

// ─── Tools ──────────────────────────────────────────────────────────────────
function setTool(tool) {
  _activeTool = tool;
  document.querySelectorAll('.sk-tool-btn').forEach(b => {
    b.dataset.active = b.dataset.tool === tool ? '1' : '0';
  });
  const s = svg();
  if (s) {
    s.classList.remove('tool-connect', 'tool-text', 'tool-select');
    s.classList.add('tool-' + tool);
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────
function exportSvg() {
  const page = activePage();
  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  page.shapes.forEach(s => {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }
  const pad = 20;
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);
  const tx = -minX + pad, ty = -minY + pad;
  const shapesSvg = page.shapes.map(s => {
    const def = (getLibrary(s.libraryId)?.shapes.find(x => x.id === s.shapeId)) || findShapeDef(s.shapeId);
    let frag = '';
    if (def) {
      try { frag = (typeof def.render === 'function') ? def.render(s.w, s.h) : def.render; } catch {}
      if (def._isSnapshot && typeof def.render === 'string') {
        const dw = def.defaultW || 100, dh = def.defaultH || 100;
        frag = `<svg width="${s.w}" height="${s.h}" viewBox="0 0 ${dw} ${dh}" preserveAspectRatio="none">${def.render}</svg>`;
      }
    }
    const labelEl = s.label ? `<text x="${s.w/2}" y="${s.h/2 + (s.fontSize||12)/3}" text-anchor="middle" font-size="${s.fontSize||12}" font-family="system-ui,sans-serif" fill="#0f172a">${escHtml(s.label)}</text>` : '';
    return `<g transform="translate(${s.x},${s.y})" style="fill:${s.fill||'#fff'};stroke:${s.stroke||'#1f2937'};stroke-width:1.6">${frag}${labelEl}</g>`;
  }).join('');
  const edgesSvg = page.edges.map(ed => {
    const fS = page.shapes.find(s => s.id === ed.from);
    const tS = page.shapes.find(s => s.id === ed.to);
    const p1 = _anchorPoint(fS, ed.fromAnchor) || { x: ed.fromX, y: ed.fromY };
    const p2 = _anchorPoint(tS, ed.toAnchor)   || { x: ed.toX,   y: ed.toY };
    const midX = (p1.x + p2.x) / 2;
    const d = `M ${p1.x},${p1.y} L ${midX},${p1.y} L ${midX},${p2.y} L ${p2.x},${p2.y}`;
    return `<path d="${d}" fill="none" stroke="#475569" stroke-width="1.6" marker-end="url(#sk-arrow-export)" ${ed.dashed ? 'stroke-dasharray="6,4"' : ''}/>`;
  }).join('');
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <marker id="sk-arrow-export" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>
      </marker>
    </defs>
    <rect width="${w}" height="${h}" fill="#fff"/>
    <g transform="translate(${tx},${ty})">
      ${shapesSvg}${edgesSvg}
    </g>
  </svg>`;
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sketch-${page.name.replace(/\s+/g, '_')}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  rsToast('✓ SVG скачан', 'ok');
}
function exportPng() {
  // Простейший подход: render SVG в Canvas через Image.
  const page = activePage();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  page.shapes.forEach(s => {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
  });
  if (!isFinite(minX)) { rsToast('Нет фигур для экспорта', 'warn'); return; }
  // Reuse SVG export logic — но в blob и через Image.
  // Это упрощённый MVP — full PNG-export через html2canvas или dom-to-image — TODO.
  rsToast('PNG export — упрощённый. Используйте SVG → конвертацию в PNG через любой online-конвертер. Полный PNG export — TODO.', 'info');
  exportSvg();
}
function exportJson() {
  const json = {
    formatVersion: state.formatVersion,
    type: 'raschet-sketch',
    pages: state.pages,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sketch-${_pid}-${SKETCH_ID}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  rsToast('✓ JSON скачан', 'ok');
}
async function importJson(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (json.type !== 'raschet-sketch') throw new Error('Не sketch JSON');
    if (!Array.isArray(json.pages)) throw new Error('Нет pages');
    pushUndo();
    state.pages = json.pages;
    state.activePageId = json.pages[0]?.id || null;
    saveState();
    renderAll();
    rsToast(`✓ Импортировано: ${json.pages.length} страниц(ы)`, 'ok');
  } catch (e) {
    rsToast('Ошибка импорта: ' + (e.message || e), 'err');
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────
function init() {
  loadState();
  renderAll();
  // Wire toolbar
  document.querySelectorAll('.sk-tool-btn').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  $('sk-undo')?.addEventListener('click', undo);
  $('sk-redo')?.addEventListener('click', redo);
  $('sk-zoom-in')?.addEventListener('click', () => { state.view.scale = Math.min(5, state.view.scale * 1.2); applyViewTransform(); saveState(); });
  $('sk-zoom-out')?.addEventListener('click', () => { state.view.scale = Math.max(0.2, state.view.scale / 1.2); applyViewTransform(); saveState(); });
  $('sk-zoom-reset')?.addEventListener('click', () => { state.view = { tx: 0, ty: 0, scale: 1 }; applyViewTransform(); saveState(); });
  $('sk-zoom-fit')?.addEventListener('click', fitView);
  $('sk-page-sel')?.addEventListener('change', (e) => { state.activePageId = e.target.value; saveState(); _selection.clear(); renderAll(); });
  $('sk-page-add')?.addEventListener('click', addPage);
  $('sk-page-del')?.addEventListener('click', removePage);
  $('sk-export-svg')?.addEventListener('click', exportSvg);
  $('sk-export-png')?.addEventListener('click', exportPng);
  $('sk-export-json')?.addEventListener('click', exportJson);
  $('sk-import-json')?.addEventListener('click', () => $('sk-import-file').click());
  $('sk-import-file')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importJson(f);
    e.target.value = '';
  });
  $('sk-search')?.addEventListener('input', renderPalette);

  // Canvas events
  const s = svg();
  if (s) {
    s.addEventListener('mousedown', _onSvgMouseDown);
    s.addEventListener('wheel', _onSvgWheel, { passive: false });
    document.addEventListener('mousemove', _onSvgMouseMove);
    document.addEventListener('mouseup', _onSvgMouseUp);
    s.addEventListener('dragover', _onCanvasDragOver);
    s.addEventListener('drop', _onCanvasDrop);
  }

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'v' || e.key === 'V') setTool('select');
    else if (e.key === 'c' || e.key === 'C') setTool('connect');
    else if (e.key === 't' || e.key === 'T') setTool('text');
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); state.view = { tx:0, ty:0, scale:1 }; applyViewTransform(); }
    else if (e.key === 'f' || e.key === 'F') fitView();
    else if (e.key === 'Escape') selectNothing();
  });

  setTool('select');
}

function fitView() {
  const page = activePage();
  if (!page.shapes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  page.shapes.forEach(s => {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
  });
  const rect = svg().getBoundingClientRect();
  const w = maxX - minX + 80;
  const h = maxY - minY + 80;
  const scale = Math.min(rect.width / w, rect.height / h, 2);
  state.view.scale = scale;
  state.view.tx = -minX * scale + (rect.width - w * scale) / 2 + 40 * scale;
  state.view.ty = -minY * scale + (rect.height - h * scale) / 2 + 40 * scale;
  applyViewTransform();
  saveState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
