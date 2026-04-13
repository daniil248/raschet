import { state, svg, uid } from './state.js';
import { NODE_H, SVG_NS, GLOBAL, CONSUMER_CATALOG, DEFAULTS } from './constants.js';
import { nodeWidth, nodeHeight } from './geometry.js';
import { updateViewBox, render } from './render.js';
import { snapshot, undo, redo, updateUndoButtons, notifyChange } from './history.js';
import { serialize, deserialize } from './serialization.js';
import { renderInspector } from './inspector.js';
import { createMode } from './modes.js';
import { flash, escHtml } from './utils.js';
import { createNode } from './graph.js';

export function initToolbar() {
  // Zoom
  document.getElementById('btn-zoom-in').onclick  = () => { state.view.zoom = Math.min(4, state.view.zoom * 1.2); updateViewBox(); };
  document.getElementById('btn-zoom-out').onclick = () => { state.view.zoom = Math.max(0.2, state.view.zoom / 1.2); updateViewBox(); };
  document.getElementById('btn-zoom-reset').onclick = () => { state.view.zoom = 1; updateViewBox(); };
  document.getElementById('btn-fit').onclick = fitAll;

  // Undo / Redo
  const _btnUndo = document.getElementById('btn-undo');
  const _btnRedo = document.getElementById('btn-redo');
  if (_btnUndo) _btnUndo.onclick = undo;
  if (_btnRedo) _btnRedo.onclick = redo;
  updateUndoButtons();

  // Clear
  document.getElementById('btn-clear').onclick = () => {
    if (state.nodes.size && !confirm('Очистить схему?')) return;
    snapshot();
    state.nodes.clear(); state.conns.clear(); state.modes = []; state.activeModeId = null;
    state.selectedKind = null; state.selectedId = null;
    render(); renderInspector();
    notifyChange();
  };

  // Modes
  document.getElementById('btn-new-mode').onclick = () => createMode();

  // === Файловые операции (sidebar + legacy toolbar IDs) ===
  const saveLocalFn = () => { localStorage.setItem('raschet.scheme', JSON.stringify(serialize())); flash('Сохранено в браузере'); };
  const loadLocalFn = () => {
    const s = localStorage.getItem('raschet.scheme');
    if (!s) return flash('Нет сохранения');
    try { deserialize(JSON.parse(s)); render(); renderInspector(); flash('Загружено'); }
    catch (err) { flash('Ошибка: ' + err.message); }
  };
  const exportJsonFn = () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
    a.download = `raschet-scheme_${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJsonFn = () => document.getElementById('file-input').click();

  // Привязка к sidebar-кнопкам
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('btn-save-local-side', saveLocalFn);
  bind('btn-load-local-side', loadLocalFn);
  bind('btn-export-side', exportJsonFn);
  bind('btn-import-side', importJsonFn);
  bind('btn-export-svg-side', () => exportSVG());
  bind('btn-export-png-side', () => exportPNG());

  // Legacy toolbar IDs (если остались)
  bind('btn-save-local', saveLocalFn);
  bind('btn-load-local', loadLocalFn);
  bind('btn-export', exportJsonFn);
  bind('btn-import', importJsonFn);
  bind('btn-export-svg', () => exportSVG());
  bind('btn-export-png', () => exportPNG());

  // File input handler
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { deserialize(JSON.parse(r.result)); render(); renderInspector(); }
      catch (err) { alert('Ошибка: ' + err.message); }
    };
    r.readAsText(f);
  });

  // Toolbar: кнопки сетка / привязка
  const gridBtn = document.getElementById('btn-toggle-grid');
  if (gridBtn) {
    const updateGridBtn = () => { gridBtn.style.opacity = GLOBAL.showGrid !== false ? '1' : '0.4'; };
    updateGridBtn();
    gridBtn.onclick = () => {
      GLOBAL.showGrid = !(GLOBAL.showGrid !== false);
      const bg = document.getElementById('bg');
      if (bg) bg.setAttribute('fill', GLOBAL.showGrid ? 'url(#grid)' : '#fff');
      updateGridBtn();
    };
  }
  const snapBtn = document.getElementById('btn-toggle-snap');
  if (snapBtn) {
    const updateSnapBtn = () => { snapBtn.style.opacity = GLOBAL.snapToGrid !== false ? '1' : '0.4'; };
    updateSnapBtn();
    snapBtn.onclick = () => {
      GLOBAL.snapToGrid = !(GLOBAL.snapToGrid !== false);
      updateSnapBtn();
      flash(GLOBAL.snapToGrid ? 'Привязка к сетке вкл' : 'Привязка к сетке выкл');
    };
  }

  // Toolbar: цвета по источникам
  const colorsBtn = document.getElementById('btn-toggle-colors');
  if (colorsBtn) {
    const updateColorsBtn = () => { colorsBtn.style.opacity = GLOBAL.showSourceColors ? '1' : '0.4'; };
    updateColorsBtn();
    colorsBtn.onclick = () => { GLOBAL.showSourceColors = !GLOBAL.showSourceColors; updateColorsBtn(); render(); };
  }

  // Toolbar: подписи кабелей / автоматов
  const cablesBtn = document.getElementById('btn-toggle-cables');
  if (cablesBtn) {
    if (!('showCableLabels' in GLOBAL)) GLOBAL.showCableLabels = true;
    const updateCablesBtn = () => { cablesBtn.style.opacity = GLOBAL.showCableLabels !== false ? '1' : '0.4'; };
    updateCablesBtn();
    cablesBtn.onclick = () => { GLOBAL.showCableLabels = !GLOBAL.showCableLabels; updateCablesBtn(); render(); };
  }
  const breakersBtn = document.getElementById('btn-toggle-breakers');
  if (breakersBtn) {
    if (!('showBreakerLabels' in GLOBAL)) GLOBAL.showBreakerLabels = true;
    const updateBreakersBtn = () => { breakersBtn.style.opacity = GLOBAL.showBreakerLabels !== false ? '1' : '0.4'; };
    updateBreakersBtn();
    breakersBtn.onclick = () => { GLOBAL.showBreakerLabels = !GLOBAL.showBreakerLabels; updateBreakersBtn(); render(); };
  }

  // Модальные окна — перетаскивание за заголовок
  document.querySelectorAll('.modal-head').forEach(head => {
    let dragging = false, dx = 0, dy = 0;
    const box = head.closest('.modal-box');
    if (!box) return;
    head.style.cursor = 'move';
    head.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return; // не перетаскивать при клике на кнопку закрытия
      dragging = true;
      const rect = box.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      box.style.position = 'fixed';
      box.style.margin = '0';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      box.style.left = (e.clientX - dx) + 'px';
      box.style.top = (e.clientY - dy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  });

  // Справочник потребителей в левом меню
  renderConsumerCatalog();
  const addCatBtn = document.getElementById('btn-add-catalog-entry');
  if (addCatBtn) {
    addCatBtn.addEventListener('click', () => {
      const label = prompt('Название нового типа потребителя:');
      if (!label) return;
      if (!Array.isArray(GLOBAL.customConsumerCatalog)) GLOBAL.customConsumerCatalog = [];
      GLOBAL.customConsumerCatalog.push({
        id: 'user_' + Date.now(),
        label,
        demandKw: 10, cosPhi: 0.92, kUse: 1, inrushFactor: 1, phase: '3ph',
      });
      notifyChange();
      renderConsumerCatalog();
    });
  }
}

export function renderConsumerCatalog() {
  const container = document.getElementById('consumer-catalog-list');
  if (!container) return;
  const fullCatalog = [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])];
  const h = [];
  for (const cat of fullCatalog) {
    const isCustom = cat.id.startsWith('user_');
    h.push(`<div class="cat-item" data-cat-id="${cat.id}" draggable="true" style="display:flex;align-items:center;gap:4px;padding:4px 6px;margin:2px 0;border:1px solid #e0e0e0;border-radius:4px;cursor:grab;background:#fafafa">`);
    h.push(`<span class="chip cns" style="flex-shrink:0"></span>`);
    h.push(`<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(cat.label)}\n${cat.demandKw} kW, cos φ ${cat.cosPhi}, Ки ${cat.kUse}">${escHtml(cat.label)}</span>`);
    h.push(`<span style="color:#999;font-size:10px;flex-shrink:0">${cat.demandKw}kW</span>`);
    if (isCustom) {
      h.push(`<button class="cat-edit" data-cat-edit="${cat.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;font-size:12px;color:#999" title="Редактировать">✎</button>`);
      h.push(`<button class="cat-del" data-cat-del="${cat.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;font-size:12px;color:#ccc" title="Удалить">✕</button>`);
    }
    h.push('</div>');
  }
  container.innerHTML = h.join('');

  // Drag & drop — при перетаскивании на холст создаётся потребитель с параметрами из каталога
  container.querySelectorAll('.cat-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/raschet-catalog', item.dataset.catId);
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('click', e => {
      if (e.target.closest('.cat-edit') || e.target.closest('.cat-del')) return;
      // Click-to-add (mobile/shortcut)
      const catId = item.dataset.catId;
      const cat = fullCatalog.find(c => c.id === catId);
      if (!cat) return;
      const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
      const cx = state.view.x + (W / 2) / state.view.zoom;
      const cy = state.view.y + (H / 2) / state.view.zoom;
      const nodeId = createNode('consumer', cx, cy);
      const n = state.nodes.get(nodeId);
      if (n) {
        n.name = cat.label;
        n.consumerSubtype = cat.id;
        n.demandKw = cat.demandKw;
        n.cosPhi = cat.cosPhi;
        n.kUse = cat.kUse;
        n.inrushFactor = cat.inrushFactor;
        if (cat.phase) n.phase = cat.phase;
        render();
      }
      document.body.classList.remove('palette-open');
    });
  });

  // SVG drop handler for catalog items
  svg.addEventListener('drop', e => {
    const catId = e.dataTransfer.getData('text/raschet-catalog');
    if (!catId) return;
    e.preventDefault();
    const cat = [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])].find(c => c.id === catId);
    if (!cat) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.view.zoom + state.view.x;
    const y = (e.clientY - rect.top) / state.view.zoom + state.view.y;
    const nodeId = createNode('consumer', x, y);
    const n = state.nodes.get(nodeId);
    if (n) {
      n.name = cat.label;
      n.consumerSubtype = cat.id;
      n.demandKw = cat.demandKw;
      n.cosPhi = cat.cosPhi;
      n.kUse = cat.kUse;
      n.inrushFactor = cat.inrushFactor;
      if (cat.phase) n.phase = cat.phase;
      render();
    }
  });

  // Edit/delete for custom entries
  container.querySelectorAll('.cat-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.catEdit;
      const customs = GLOBAL.customConsumerCatalog || [];
      const cat = customs.find(c => c.id === catId);
      if (!cat) return;
      const label = prompt('Название:', cat.label);
      if (label === null) return;
      cat.label = label;
      const kw = prompt('Мощность, kW:', cat.demandKw);
      if (kw !== null) cat.demandKw = Number(kw) || cat.demandKw;
      const cos = prompt('cos φ:', cat.cosPhi);
      if (cos !== null) cat.cosPhi = Number(cos) || cat.cosPhi;
      const ku = prompt('Ки:', cat.kUse);
      if (ku !== null) cat.kUse = Number(ku) ?? cat.kUse;
      const inr = prompt('Кратность пуска:', cat.inrushFactor);
      if (inr !== null) cat.inrushFactor = Number(inr) || cat.inrushFactor;
      notifyChange();
      renderConsumerCatalog();
    });
  });
  container.querySelectorAll('.cat-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.catDel;
      if (!confirm('Удалить тип из справочника?')) return;
      GLOBAL.customConsumerCatalog = (GLOBAL.customConsumerCatalog || []).filter(c => c.id !== catId);
      notifyChange();
      renderConsumerCatalog();
    });
  });
}

export function autoLayout() {
  if (!state.nodes.size) return;
  snapshot();
  // Topological sort: определяем уровень каждого узла
  const levels = new Map();
  const q = [];
  // Стартуем с узлов без входных связей (источники, генераторы)
  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
    if (!hasIn) { levels.set(n.id, 0); q.push(n.id); }
  }
  // BFS вниз
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const lvl = levels.get(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const nextLvl = lvl + 1;
      if (!levels.has(c.to.nodeId) || levels.get(c.to.nodeId) < nextLvl) {
        levels.set(c.to.nodeId, nextLvl);
        q.push(c.to.nodeId);
      }
    }
  }
  // Узлы без связей — уровень 0
  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    if (!levels.has(n.id)) levels.set(n.id, 0);
  }
  // Группируем по уровням
  const byLevel = new Map();
  for (const [id, lvl] of levels) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(id);
  }
  const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const gapY = NODE_H + 80;
  const gapX = 40;
  let startY = 80;
  for (const lvl of sortedLevels) {
    const ids = byLevel.get(lvl);
    let totalW = 0;
    for (const id of ids) totalW += nodeWidth(state.nodes.get(id)) + gapX;
    let x = 100 - totalW / 2 + 400; // центрируем
    for (const id of ids) {
      const n = state.nodes.get(id);
      n.x = Math.round(x / 40) * 40;
      n.y = Math.round(startY / 40) * 40;
      x += nodeWidth(n) + gapX;
    }
    startY += gapY;
  }
  render();
  fitAll();
  notifyChange();
  flash('Авто-раскладка применена');
}

export function exportSVG() {
  const clone = svg.cloneNode(true);
  // Убираем интерактивные элементы
  clone.querySelectorAll('.conn-handle, .conn-waypoint, .conn-waypoint-add, .zone-resize, #__pending, #__rubberband').forEach(e => e.remove());
  // Вычисляем bbox для viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n), h = nodeHeight(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  const pad = 40;
  const vw = (maxX - minX) + pad * 2;
  const vh = (maxY - minY) + pad * 2;
  clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${vw} ${vh}`);
  clone.setAttribute('width', vw);
  clone.setAttribute('height', vh);
  // Встраиваем стили
  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = document.querySelector('link[href="app.css"]')
    ? '' : ''; // Inline основные стили для SVG
  // Простой вариант — копируем все правила из <style> и <link>
  let cssText = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) cssText += rule.cssText + '\n';
    } catch { /* cross-origin */ }
  }
  styleEl.textContent = cssText;
  clone.insertBefore(styleEl, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  a.download = `raschet_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flash('SVG сохранён');
}

export function exportPNG() {
  // Рендерим SVG в canvas, потом toBlob
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n), h = nodeHeight(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  if (!isFinite(minX)) { flash('Схема пуста', 'error'); return; }
  const pad = 40;
  const vw = (maxX - minX) + pad * 2;
  const vh = (maxY - minY) + pad * 2;
  const scale = 2; // retina
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.conn-handle, .conn-waypoint, .conn-waypoint-add, .zone-resize, #__pending, #__rubberband').forEach(e => e.remove());
  clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${vw} ${vh}`);
  clone.setAttribute('width', vw * scale);
  clone.setAttribute('height', vh * scale);
  // Inline стили
  let cssText = '';
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) cssText += rule.cssText + '\n'; } catch {}
  }
  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = cssText;
  clone.insertBefore(styleEl, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = vw * scale;
    canvas.height = vh * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      a.download = `raschet_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash('PNG сохранён');
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}

export function fitAll() {
  if (!state.nodes.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + NODE_H);
  }
  const pad = 60;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const W = svg.clientWidth, H = svg.clientHeight;
  state.view.zoom = Math.min(W / w, H / h, 2);
  state.view.x = minX - pad;
  state.view.y = minY - pad;
  updateViewBox();
}
