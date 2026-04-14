import { state, svg } from './state.js';
import { NODE_H, SVG_NS, GLOBAL } from './constants.js';
import { nodeWidth, nodeHeight } from './geometry.js';
import { updateViewBox, render } from './render.js';
import { snapshot, undo, redo, updateUndoButtons, notifyChange } from './history.js';
import { serialize, deserialize } from './serialization.js';
import { renderInspector } from './inspector.js';
import { createMode } from './modes.js';
import { flash } from './utils.js';

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

  // «Сохранить как…» — копия проекта с новым именем
  bind('btn-save-as', async () => {
    const curName = document.getElementById('project-name')?.textContent || 'Проект';
    const newName = prompt('Сохранить копию проекта как:', curName + ' (копия)');
    if (!newName) return;
    try {
      const scheme = serialize();
      if (window.Storage && window.Storage.createProject) {
        const p = await window.Storage.createProject(newName, scheme);
        flash('Проект сохранён: ' + newName);
        // Переключиться на новый проект
        if (window.location) {
          const url = new URL(window.location.href);
          url.searchParams.set('project', p.id);
          window.location.href = url.toString();
        }
      } else {
        // Fallback: скачать как JSON
        const blob = new Blob([JSON.stringify({ name: newName, scheme }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = newName.replace(/[^\w\s\-а-яёА-ЯЁ]/g, '_') + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        flash('Скачан: ' + a.download);
      }
    } catch (e) {
      console.error('[saveAs]', e);
      flash('Ошибка сохранения', 'error');
    }
  });

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

  // Линии-ссылки: временно скрыть все / показать все / восстановить нормальный вид
  const updateLinksBtns = () => {
    const ov = state.linksOverride;
    const a = document.getElementById('btn-links-hide-all');
    const b = document.getElementById('btn-links-show-all');
    const c = document.getElementById('btn-links-normal');
    if (a) a.style.opacity = ov === 'all-links' ? '1' : '0.55';
    if (b) b.style.opacity = ov === 'all-lines' ? '1' : '0.55';
    if (c) c.style.opacity = ov === null ? '1' : '0.55';
  };
  updateLinksBtns();
  const hideAllBtn = document.getElementById('btn-links-hide-all');
  if (hideAllBtn) hideAllBtn.onclick = () => { state.linksOverride = 'all-links'; updateLinksBtns(); render(); };
  const showAllBtn = document.getElementById('btn-links-show-all');
  if (showAllBtn) showAllBtn.onclick = () => { state.linksOverride = 'all-lines'; updateLinksBtns(); render(); };
  const normalBtn = document.getElementById('btn-links-normal');
  if (normalBtn) normalBtn.onclick = () => { state.linksOverride = null; updateLinksBtns(); render(); };

  // Номиналы автоматов на разорванных линиях
  if (!('showLinkBreakers' in GLOBAL)) GLOBAL.showLinkBreakers = false;
  const linkBrkBtn = document.getElementById('btn-links-breakers');
  const updateLinkBrkBtn = () => { if (linkBrkBtn) linkBrkBtn.style.opacity = GLOBAL.showLinkBreakers ? '1' : '0.55'; };
  updateLinkBrkBtn();
  if (linkBrkBtn) linkBrkBtn.onclick = () => { GLOBAL.showLinkBreakers = !GLOBAL.showLinkBreakers; updateLinkBrkBtn(); render(); };

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
