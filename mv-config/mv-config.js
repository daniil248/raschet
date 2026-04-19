// ======================================================================
// mv-config.js — подпрограмма «Конфигуратор РУ СН» (Фаза 1.19.1)
//
// 2 режима:
//   1) Справочник: перечень всех mv-switchgear из element-library
//      (builtin: RM6, FafeRing, ЩО-70 + user-добавленные)
//   2) Wizard (когда открыта с ?nodeId=<id>): пошаговый подбор РУ
//      для конкретного узла схемы, возврат через
//      localStorage['raschet.pendingMvSelection.v1']
// ======================================================================

import { listElements, getElement } from '../shared/element-library.js';
import { initCatalogBridge } from '../shared/catalog-bridge.js';
import { pricesForElement } from '../shared/price-records.js';

initCatalogBridge();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// ==================== Справочник ====================

function renderCatalog() {
  const mount = document.getElementById('mv-catalog-list');
  if (!mount) return;
  // Ждём bridge (async) — небольшая задержка
  setTimeout(() => {
    const list = listElements({ kind: 'mv-switchgear' });
    if (!list.length) {
      mount.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Справочник пуст. Дождитесь инициализации или проверьте catalog-bridge.</div>';
      return;
    }
    const html = [];
    for (const el of list) {
      const kp = el.kindProps || {};
      const cellsHtml = Array.isArray(kp.cells)
        ? kp.cells.map(c => `<span class="mv-cell-chip ${c.type || ''}">${_cellLabel(c)}</span>`).join(' ')
        : '';
      html.push(`
        <div class="mv-catalog-card">
          <h5>${esc(el.label)} <span class="muted" style="font-weight:400;font-size:11px">· ${esc(kp.mvType || '?')}</span></h5>
          <div class="muted" style="font-size:11px">
            ${kp.Un_kV || '?'} кВ · ${kp.In_A || '?'} А (шины) · Icu ${kp.It_kA || '?'} кА ·
            ${esc(kp.insulation || '?')}${kp.arcProof ? ' · arc-proof' : ''} ·
            IP ${esc(kp.IP || '?')}
          </div>
          ${cellsHtml ? `<div class="mv-item-cells">Ячейки: ${cellsHtml}</div>` : ''}
        </div>`);
    }
    mount.innerHTML = html.join('');
  }, 300);
}

function _cellLabel(c) {
  const typeShort = {
    'infeed': '⬅ Ввод',
    'feeder': '➡ Отх.',
    'transformer-protect': '🔧 Защита ТП',
    'measurement': '📏 ТН',
    'busCoupler': '↔ ССВ',
    'earthing': '⏚ Заземл.',
    'metering': '📊 Учёт',
  };
  const lbl = typeShort[c.type] || c.type || '?';
  const br = c.breakerType && c.breakerType !== 'none'
    ? ' · ' + (c.breakerType === 'VCB' ? 'VCB' : c.breakerType === 'fuse-switch' ? 'fuse' : c.breakerType === 'switch' ? 'switch' : c.breakerType)
    : '';
  const In = c.In_A || c.In || '';
  return `${lbl}${In ? ' ' + In + 'А' : ''}${br}`;
}

// ==================== Wizard ====================

const wizState = {
  nodeId: null,
  step: 1,
  requirements: {
    name: 'РУ СН',
    Un_kV: 10,
    loadA: 630,
    In_A: 630,
    Icu_kA: 20,
    mvType: 'ringmain',
    cellsCount: 3,
    IP: 'IP4X',
    arcProof: false,
  },
  selected: null,
  cells: [],
};

function initWizard() {
  const qp = new URLSearchParams(location.search);
  const ctxNodeId = qp.get('nodeId');
  if (!ctxNodeId) return;

  wizState.nodeId = ctxNodeId;
  const rq = wizState.requirements;
  if (qp.get('name')) rq.name = qp.get('name');
  if (qp.get('Un_kV')) rq.Un_kV = Number(qp.get('Un_kV')) || 10;
  if (qp.get('loadA')) rq.loadA = Number(qp.get('loadA')) || 0;
  if (qp.get('In_A')) rq.In_A = Number(qp.get('In_A')) || 630;
  if (qp.get('mvType')) rq.mvType = qp.get('mvType');
  if (qp.get('cellsCount')) rq.cellsCount = Number(qp.get('cellsCount')) || 3;

  const wizard = document.getElementById('mv-wizard');
  if (!wizard) return;
  wizard.style.display = '';
  document.getElementById('mv-catalog-panel').style.display = 'none';

  _fillStep1();
  _showStep(1);

  document.getElementById('mv-wiz-cancel').onclick = () => {
    if (confirm('Отменить конфигурирование?')) { try { window.close(); } catch {} }
  };
  document.getElementById('mv-wiz-next-1').onclick = _goStep2;
  document.getElementById('mv-wiz-back-2').onclick = () => _showStep(1);
  document.getElementById('mv-wiz-next-2').onclick = _goStep3;
  document.getElementById('mv-wiz-back-3').onclick = () => _showStep(2);
  document.getElementById('mv-wiz-next-3').onclick = _goStep4;
  document.getElementById('mv-wiz-back-4').onclick = () => _showStep(3);
  document.getElementById('mv-wiz-apply').onclick = _applyConfiguration;
}

function _fillStep1() {
  const rq = wizState.requirements;
  document.getElementById('mv-name').value = rq.name;
  document.getElementById('mv-Un').value = rq.Un_kV;
  document.getElementById('mv-loadA').value = rq.loadA;
  document.getElementById('mv-In').value = rq.In_A;
  document.getElementById('mv-Icu').value = rq.Icu_kA;
  document.getElementById('mv-type').value = rq.mvType;
  document.getElementById('mv-cellsCount').value = rq.cellsCount;
  document.getElementById('mv-IP').value = rq.IP;
  document.getElementById('mv-arcProof').checked = rq.arcProof;
}

function _readStep1() {
  const rq = wizState.requirements;
  rq.name = document.getElementById('mv-name').value || 'РУ СН';
  rq.Un_kV = Number(document.getElementById('mv-Un').value) || 10;
  rq.loadA = Number(document.getElementById('mv-loadA').value) || 0;
  rq.In_A = Number(document.getElementById('mv-In').value) || 630;
  rq.Icu_kA = Number(document.getElementById('mv-Icu').value) || 20;
  rq.mvType = document.getElementById('mv-type').value;
  rq.cellsCount = Math.max(2, Number(document.getElementById('mv-cellsCount').value) || 3);
  rq.IP = document.getElementById('mv-IP').value;
  rq.arcProof = document.getElementById('mv-arcProof').checked;
}

function _showStep(n) {
  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById('mv-wiz-step-' + i);
    if (el) el.style.display = (i === n) ? '' : 'none';
  });
  wizState.step = n;
  const ind = document.getElementById('mv-wiz-step-indicator');
  if (ind) ind.textContent = 'Шаг ' + n + ' из 4';
}

// Шаг 2: подбор РУ
function _pickMv() {
  const rq = wizState.requirements;
  const list = listElements({ kind: 'mv-switchgear' });
  const out = [];
  for (const el of list) {
    const kp = el.kindProps || {};
    // Фильтр по типу (если указан)
    if (rq.mvType && kp.mvType !== rq.mvType) continue;
    // Фильтр по напряжению: Un_kV должно быть ≥ требуемого
    if ((Number(kp.Un_kV) || 0) < rq.Un_kV - 0.1) continue;
    // Фильтр по току шин
    if ((Number(kp.In_A) || 0) < rq.In_A - 10) continue;
    // Фильтр по Icu
    if ((Number(kp.It_kA) || 0) < rq.Icu_kA - 0.5) continue;
    // Фильтр по IP: проверка солидная/жидкая компонента
    const ipMatch = _ipCovers(kp.IP, rq.IP);
    if (!ipMatch) continue;
    // Arc-proof — мягкая проверка (если требуется — только arc-proof модели)
    if (rq.arcProof && !kp.arcProof) continue;
    // Число ячеек: близость к запрошенному (не отсекаем, но учитываем в рейтинге)
    const cellsActual = Array.isArray(kp.cells) ? kp.cells.length : 0;
    const cellsDiff = Math.abs(cellsActual - rq.cellsCount);
    out.push({ el, kp, cellsActual, cellsDiff });
  }
  // Сортируем: сначала ближайшие по числу ячеек, затем по Un_kV (минимум достаточное)
  out.sort((a, b) => {
    if (a.cellsDiff !== b.cellsDiff) return a.cellsDiff - b.cellsDiff;
    return (a.kp.Un_kV || 0) - (b.kp.Un_kV || 0);
  });
  return out;
}

function _ipCovers(candidate, required) {
  if (!candidate || !required) return true;
  const parse = (s) => { const m = /IP(\d|X)(\d|X)/i.exec(String(s)); return m ? [m[1] === 'X' ? 0 : Number(m[1]), m[2] === 'X' ? 0 : Number(m[2])] : [0, 0]; };
  const c = parse(candidate), r = parse(required);
  return c[0] >= r[0] && c[1] >= r[1];
}

function _goStep2() {
  _readStep1();
  const rq = wizState.requirements;
  if (rq.loadA <= 0 && rq.In_A <= 0) { flash('Укажите расчётный ток или In шин', 'warn'); return; }
  const items = _pickMv();
  const listEl = document.getElementById('mv-wiz-list');
  if (!items.length) {
    listEl.innerHTML = `
      <div class="muted" style="padding:30px;text-align:center">
        Подходящих РУ не найдено. Смягчите требования (уменьшите Icu / IP / уберите arc-proof),
        или добавьте свои записи mv-switchgear в <a href="../catalog/" target="_blank" style="color:#1976d2">Каталог</a>.
      </div>`;
    document.getElementById('mv-wiz-next-2').disabled = true;
    _showStep(2);
    return;
  }
  const html = [`<p class="muted" style="font-size:12px">Найдено ${items.length} моделей. Сортировка: близость к запрошенному числу ячеек → мин. достаточное Un.</p>`];
  items.forEach((item, idx) => {
    const isRec = idx === 0 ? ' recommended' : '';
    const kp = item.kp;
    const cellsHtml = Array.isArray(kp.cells)
      ? kp.cells.map(c => `<span class="mv-cell-chip ${c.type || ''}">${_cellLabel(c)}</span>`).join(' ')
      : '';
    // Цена (если есть)
    let priceStr = '';
    try {
      const info = pricesForElement(item.el.id, { activeOnly: true });
      if (info.latest) priceStr = ` · ${Number(info.latest.price).toLocaleString('ru-RU')} ${info.latest.currency}`;
    } catch {}
    html.push(`
      <div class="mv-item${isRec}" data-idx="${idx}">
        <div class="mv-item-main">
          <div class="mv-item-title">${esc(item.el.label)}</div>
          <div class="mv-item-meta">
            ${kp.Un_kV} кВ · ${kp.In_A} А (шины) · Icu ${kp.It_kA} кА · ${esc(kp.insulation || '?')}${kp.arcProof ? ' · arc-proof' : ''} · IP ${esc(kp.IP || '?')} · ${item.cellsActual} ячеек${priceStr}
          </div>
          ${cellsHtml ? `<div class="mv-item-cells">${cellsHtml}</div>` : ''}
        </div>
      </div>`);
  });
  listEl.innerHTML = html.join('');

  listEl.querySelectorAll('.mv-item').forEach(el => {
    el.onclick = () => {
      listEl.querySelectorAll('.mv-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      const idx = Number(el.dataset.idx);
      wizState.selected = items[idx];
      document.getElementById('mv-wiz-next-2').disabled = false;
    };
  });
  // Авто-выбор лучшего
  listEl.querySelector('.mv-item')?.click();
  _showStep(2);
}

// Шаг 3: состав ячеек (редактируемая таблица)
const CELL_TYPES = [
  { id: 'infeed', label: 'Ввод' },
  { id: 'feeder', label: 'Отходящая' },
  { id: 'transformer-protect', label: 'Защита ТП' },
  { id: 'measurement', label: 'Измерения (ТН)' },
  { id: 'busCoupler', label: 'Секционная (ССВ)' },
  { id: 'earthing', label: 'Заземляющая' },
  { id: 'metering', label: 'Учёт' },
];
const BREAKER_TYPES = ['VCB', 'SF6', 'fuse-switch', 'switch', 'isolator', 'earthing-switch', 'none'];

function _goStep3() {
  // Копируем ячейки выбранной модели (с возможностью редактирования)
  const sel = wizState.selected;
  if (!sel) return;
  const origCells = Array.isArray(sel.kp.cells) ? sel.kp.cells : [];
  wizState.cells = origCells.map(c => ({ ...c }));
  _renderCellsEditor();
  _showStep(3);
}

function _renderCellsEditor() {
  const container = document.getElementById('mv-wiz-cells');
  const typeOpts = (cur) => CELL_TYPES.map(t =>
    `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  const brOpts = (cur) => BREAKER_TYPES.map(b =>
    `<option value="${b}"${b === cur ? ' selected' : ''}>${esc(b)}</option>`).join('');
  const inOpts = [100, 200, 400, 630, 800, 1000, 1250, 1600, 2000];

  const html = [`<table class="mv-cells-table">
    <thead><tr><th>#</th><th>Тип</th><th>In, А</th><th>Аппарат</th><th>Назначение</th><th class="actions"></th></tr></thead>
    <tbody>`];
  wizState.cells.forEach((c, i) => {
    const inSelect = inOpts.map(n => `<option value="${n}"${Number(c.In_A || c.In) === n ? ' selected' : ''}>${n}</option>`).join('');
    html.push(`
      <tr data-idx="${i}">
        <td class="num">${i + 1}</td>
        <td><select class="cell-type">${typeOpts(c.type)}</select></td>
        <td class="num"><select class="cell-In">${inSelect}</select></td>
        <td><select class="cell-br">${brOpts(c.breakerType)}</select></td>
        <td><input class="cell-desc" value="${esc(c.functionDesc || '')}" placeholder="напр. ввод от ТП-1"></td>
        <td class="actions"><button type="button" class="cell-del danger" title="Удалить">×</button></td>
      </tr>`);
  });
  html.push('</tbody></table>');
  html.push('<button type="button" id="mv-add-cell" style="margin-top:8px">+ Добавить ячейку</button>');
  container.innerHTML = html.join('');

  container.querySelectorAll('tr[data-idx]').forEach(row => {
    const i = Number(row.dataset.idx);
    row.querySelector('.cell-type').onchange = e => { wizState.cells[i].type = e.target.value; };
    row.querySelector('.cell-In').onchange = e => { wizState.cells[i].In_A = Number(e.target.value); wizState.cells[i].In = Number(e.target.value); };
    row.querySelector('.cell-br').onchange = e => { wizState.cells[i].breakerType = e.target.value; };
    row.querySelector('.cell-desc').oninput = e => { wizState.cells[i].functionDesc = e.target.value; };
    row.querySelector('.cell-del').onclick = () => {
      wizState.cells.splice(i, 1);
      _renderCellsEditor();
    };
  });
  document.getElementById('mv-add-cell').onclick = () => {
    wizState.cells.push({ type: 'feeder', In_A: 630, breakerType: 'VCB', functionDesc: '' });
    _renderCellsEditor();
  };
}

// Шаг 4: итог
function _goStep4() {
  const rq = wizState.requirements;
  const sel = wizState.selected;
  const cells = wizState.cells;
  const html = [`
    <div class="wiz-summary-box">
      <h5>Требования</h5>
      <table class="wiz-summary-table">
        <tr><td>Имя</td><td>${esc(rq.name)}</td></tr>
        <tr><td>Напряжение</td><td>${rq.Un_kV} кВ</td></tr>
        <tr><td>Ток шин</td><td>${rq.In_A} А</td></tr>
        <tr><td>Icu</td><td>${rq.Icu_kA} кА</td></tr>
        <tr><td>Тип</td><td>${esc(rq.mvType || 'любой')}</td></tr>
        <tr><td>IP</td><td>${esc(rq.IP)}</td></tr>
        <tr><td>Arc-proof</td><td>${rq.arcProof ? 'да' : 'нет'}</td></tr>
      </table>
    </div>
    <div class="wiz-summary-box">
      <h5>Выбранная модель</h5>
      <table class="wiz-summary-table">
        <tr><td>Модель</td><td>${esc(sel.el.label)}</td></tr>
        <tr><td>Тип</td><td>${esc(sel.kp.mvType || '?')}</td></tr>
        <tr><td>Паспорт</td><td>${sel.kp.Un_kV} кВ / ${sel.kp.In_A} А / ${sel.kp.It_kA} кА · ${esc(sel.kp.insulation || '?')}${sel.kp.arcProof ? ' · arc-proof' : ''}</td></tr>
        <tr><td>Габариты</td><td>${sel.el.geometry?.widthMm || '?'}×${sel.el.geometry?.heightMm || '?'}×${sel.el.geometry?.depthMm || '?'} мм</td></tr>
      </table>
    </div>
    <div class="wiz-summary-box">
      <h5>Состав ячеек (${cells.length})</h5>
      <table class="mv-cells-table">
        <thead><tr><th>#</th><th>Тип</th><th>In</th><th>Аппарат</th><th>Назначение</th></tr></thead>
        <tbody>`];
  cells.forEach((c, i) => {
    html.push(`<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(_cellLabel(c))}</td>
      <td class="num">${c.In_A || c.In || '—'} А</td>
      <td>${esc(c.breakerType || '—')}</td>
      <td>${esc(c.functionDesc || '')}</td>
    </tr>`);
  });
  html.push('</tbody></table></div>');

  document.getElementById('mv-wiz-summary').innerHTML = html.join('');
  _showStep(4);
}

function _applyConfiguration() {
  const rq = wizState.requirements;
  const sel = wizState.selected;
  const cells = wizState.cells;

  // Считаем inputs/outputs по cellType для узла panel
  const infeeds = cells.filter(c => c.type === 'infeed' || c.type === 'busCoupler').length;
  const feeders = cells.filter(c => c.type === 'feeder' || c.type === 'transformer-protect').length;

  const composition = [{
    elementId: sel.el.id,
    qty: 1,
    role: 'mv-switchgear',
    label: sel.el.label,
  }];

  const payload = {
    nodeId: wizState.nodeId,
    configuration: {
      mvSwitchgearId: sel.el.id,
      name: rq.name,
      Un_kV: rq.Un_kV,
      capacityA: rq.In_A,
      ipRating: rq.IP,
      isMv: true,
      inputs: Math.max(1, infeeds),
      outputs: Math.max(1, feeders),
      cells,
      composition,
    },
    selectedAt: Date.now(),
  };
  try {
    localStorage.setItem('raschet.pendingMvSelection.v1', JSON.stringify(payload));
    flash('Конфигурация передана. Возврат в Конструктор схем…', 'success');
    setTimeout(() => { try { window.close(); } catch {} }, 1500);
  } catch (e) {
    flash('Не удалось передать: ' + (e.message || e), 'error');
  }
}

// ==================== Bootstrap ====================
document.addEventListener('DOMContentLoaded', () => {
  renderCatalog();
  initWizard();
});
