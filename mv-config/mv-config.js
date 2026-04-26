// ======================================================================
// mv-config.js — подпрограмма «Конфигуратор РУ СН» (Фаза 1.19.1)
//
// 2 режима:
//   1) Справочник: перечень всех mv-switchgear из element-library
//      (builtin: RM6, SafeRing, ЩО-70 + user-добавленные)
//   2) Wizard (когда открыта с ?nodeId=<id>): пошаговый подбор РУ
//      для конкретного узла схемы, возврат через
//      localStorage['raschet.pendingMvSelection.v1']
// ======================================================================

import { listElements, getElement } from '../shared/element-library.js';
import { initCatalogBridge } from '../shared/catalog-bridge.js';
import { pricesForElement } from '../shared/price-records.js';
import { rsConfirm } from '../shared/dialog.js';

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
  // Phase 1.19.13: если в проекте уже выбрана модель (lockedId), фиксируем
  // mvType / manufacturer / series, чтобы Шаг 2 предлагал только совместимые
  // варианты (в рамках того же семейства).
  if (qp.get('lockedId')) {
    const locked = listElements({ kind: 'mv-switchgear' }).find(e => e.id === qp.get('lockedId'));
    if (locked) {
      wizState.lockedId = locked.id;
      wizState.lockedManufacturer = locked.manufacturer || '';
      wizState.lockedSeries = locked.series || '';
      rq.mvType = locked.kindProps?.mvType || rq.mvType;
    }
  }

  const wizard = document.getElementById('mv-wizard');
  if (!wizard) return;
  wizard.style.display = '';
  document.getElementById('mv-catalog-panel').style.display = 'none';

  _fillStep1();
  _showStep(1);

  document.getElementById('mv-wiz-cancel').onclick = async () => {
    if (await rsConfirm('Отменить конфигурирование?', '', { okLabel: 'Отменить', cancelLabel: 'Продолжить' })) {
      try { window.close(); } catch {}
    }
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
  // Phase 1.19.13: если lockedId — блокируем выбор типа РУ и показываем
  // плашку «Зафиксировано производителем/серией из проекта».
  if (wizState.lockedManufacturer || wizState.lockedSeries) {
    const sel = document.getElementById('mv-type');
    if (sel) sel.disabled = true;
    const parent = sel?.parentElement;
    if (parent && !parent.querySelector('.mv-locked-hint')) {
      const hint = document.createElement('div');
      hint.className = 'mv-locked-hint muted';
      hint.style.cssText = 'font-size:11px;color:#c67300;margin-top:4px';
      hint.textContent = `🔒 Зафиксировано из проекта: ${wizState.lockedManufacturer || '—'}${wizState.lockedSeries ? ' / ' + wizState.lockedSeries : ''}. Альтернативные РУ не предлагаются.`;
      parent.appendChild(hint);
    }
  }
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
    // Phase 1.19.13: если проект заблокировал на конкретного производителя/
    // серию (lockedManufacturer/lockedSeries), показываем только варианты
    // того же семейства — иначе при выборе RM6 вылезали SafeRing и ЩО-70.
    if (wizState.lockedManufacturer) {
      if ((el.manufacturer || '') !== wizState.lockedManufacturer) continue;
    }
    if (wizState.lockedSeries) {
      if ((el.series || '') !== wizState.lockedSeries) continue;
    }
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

// Функции RM6 (Schneider RM6 / SafeRing и аналоги). По документации RM6:
//   I  — выключатель нагрузки 630 А
//   B  — выключатель нагрузки 630 А + заземлитель
//   D  — выключатель нагрузки 200 А (для защиты ТП)
//   Q  — выключатель нагрузки + предохранители (защита ТП)
//   O  — кабельное присоединение (без аппарата)
//   Ic — секционный выключатель нагрузки
//   Bc — секционный выключатель 630 А
//   Mt — измерение (ТН на стороне СН)
const RM6_FUNCTIONS = [
  { code: 'I',  cellType: 'infeed',               In_A: 630, breakerType: 'switch',       label: 'I — Ввод с выключателем нагрузки 630 А' },
  { code: 'B',  cellType: 'infeed',               In_A: 630, breakerType: 'switch',       label: 'B — Ввод + заземлитель (з/р), 630 А' },
  { code: 'D',  cellType: 'transformer-protect',  In_A: 200, breakerType: 'switch',       label: 'D — Защита ТП: выключатель 200 А' },
  { code: 'Q',  cellType: 'transformer-protect',  In_A: 200, breakerType: 'fuse-switch',  label: 'Q — Защита ТП: выключатель + предохранители' },
  { code: 'O',  cellType: 'feeder',               In_A: 630, breakerType: 'none',         label: 'O — Кабельное присоединение (без аппарата)' },
  { code: 'Ic', cellType: 'busCoupler',           In_A: 630, breakerType: 'switch',       label: 'Ic — Секционный выключатель нагрузки' },
  { code: 'Bc', cellType: 'busCoupler',           In_A: 630, breakerType: 'switch',       label: 'Bc — Секционный выключатель 630 А' },
  { code: 'Mt', cellType: 'measurement',          In_A: 100, breakerType: 'none',         label: 'Mt — Измерение (ТН на стороне СН)' },
];

function _isRm6Family(sel) {
  if (!sel) return false;
  const mfg = (sel.el.manufacturer || '').toLowerCase();
  const series = (sel.el.series || '').toLowerCase();
  const mvType = sel.kp.mvType;
  // Ringmain SF6 семейство: Schneider RM6 / ABB SafeRing / аналоги
  return mvType === 'ringmain' && (
    mfg.includes('schneider') || mfg.includes('rm6')
    || mfg.includes('abb') || series.includes('safering') || series.includes('rm')
  );
}

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

  const html = [];

  // RM6-builder — быстрый выбор функций по кодам I/B/D/Q/O/Ic/Bc/Mt
  // (только для ringmain-моделей семейства RM6 / SafeRing)
  if (_isRm6Family(wizState.selected)) {
    const count = wizState.cells.length || 3;
    html.push(`<div style="background:#fff4e5;padding:10px;border-radius:5px;margin-bottom:10px;font-size:12px">
      <div style="font-weight:600;margin-bottom:6px;color:#c67300">⚡ RM6-функции: быстрая сборка по кодам</div>
      <div class="muted" style="font-size:11px;margin-bottom:6px">
        Выберите функцию для каждой ячейки. Коды по документации Schneider RM6:
        <b>I</b> — ввод выключатель нагрузки 630 А · <b>B</b> — ввод + заземлитель ·
        <b>D</b> — защита ТП 200 А · <b>Q</b> — защита ТП с предохранителями ·
        <b>O</b> — кабельное присоединение · <b>Ic/Bc</b> — секционная · <b>Mt</b> — измерение
      </div>
      <label style="display:inline-flex;gap:6px;align-items:center;margin-right:12px">
        Число ячеек:
        <select id="rm6-count" style="padding:2px 5px">
          ${[2, 3, 4, 5].map(n => `<option value="${n}"${n === count ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <div id="rm6-fn-row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button type="button" id="rm6-preset-iii" class="btn-sm">Шаблон III (2I+D)</button>
        <button type="button" id="rm6-preset-iidi" class="btn-sm">IIDI (2I+2D)</button>
        <button type="button" id="rm6-preset-idi" class="btn-sm">IDI (I+D+I)</button>
        <button type="button" id="rm6-preset-iiv" class="btn-sm">IIV (2I+VCB)</button>
      </div>
    </div>`);
  }

  html.push(`<table class="mv-cells-table">
    <thead><tr><th>#</th><th>Тип</th><th>In, А</th><th>Аппарат</th><th>Назначение</th><th class="actions"></th></tr></thead>
    <tbody>`);
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

  // RM6-builder wiring
  if (_isRm6Family(wizState.selected)) {
    _renderRm6FunctionsRow();
    document.getElementById('rm6-count').onchange = (e) => {
      const newCount = Number(e.target.value);
      while (wizState.cells.length < newCount) {
        wizState.cells.push({ type: 'feeder', In_A: 630, breakerType: 'switch', functionDesc: '' });
      }
      if (wizState.cells.length > newCount) wizState.cells.length = newCount;
      _renderCellsEditor();
    };
    const applyPreset = (codes) => {
      wizState.cells = codes.map(code => {
        if (code === 'VCB') {
          return { type: 'feeder', In_A: 630, breakerType: 'VCB', functionDesc: 'Вакуумный выключатель' };
        }
        const fn = RM6_FUNCTIONS.find(f => f.code === code);
        if (!fn) return { type: 'feeder', In_A: 630, breakerType: 'switch', functionDesc: '' };
        return { type: fn.cellType, In_A: fn.In_A, breakerType: fn.breakerType, functionDesc: fn.label };
      });
      _renderCellsEditor();
    };
    document.getElementById('rm6-preset-iii').onclick = () => applyPreset(['I', 'I', 'D']);
    document.getElementById('rm6-preset-iidi').onclick = () => applyPreset(['I', 'I', 'D', 'D']);
    document.getElementById('rm6-preset-idi').onclick = () => applyPreset(['I', 'D', 'I']);
    document.getElementById('rm6-preset-iiv').onclick = () => applyPreset(['I', 'I', 'VCB']);
  }
}

// Вспомогательная функция: рендерит ряд dropdown'ов функций RM6
// для каждой ячейки (I/B/D/Q/O/Ic/Bc/Mt).
function _renderRm6FunctionsRow() {
  const row = document.getElementById('rm6-fn-row');
  if (!row) return;
  const html = [];
  wizState.cells.forEach((c, i) => {
    // Определяем текущий код по (type + breakerType)
    const match = RM6_FUNCTIONS.find(fn =>
      fn.cellType === c.type && fn.breakerType === c.breakerType && Math.abs((fn.In_A || 0) - (c.In_A || 0)) < 10
    );
    const curCode = match?.code || '';
    const opts = RM6_FUNCTIONS.map(fn =>
      `<option value="${fn.code}"${fn.code === curCode ? ' selected' : ''}>${fn.code}</option>`).join('');
    html.push(`
      <div style="display:flex;flex-direction:column;align-items:center;padding:4px 6px;background:#fff;border:1px solid #f0cea0;border-radius:4px">
        <span style="font-size:10px;color:#888">Яч.${i + 1}</span>
        <select class="rm6-fn" data-idx="${i}" style="padding:2px 4px;font-size:12px;font-weight:600">${opts}</select>
      </div>`);
  });
  row.innerHTML = html.join('');
  row.querySelectorAll('.rm6-fn').forEach(sel => {
    sel.onchange = (e) => {
      const i = Number(sel.dataset.idx);
      const code = sel.value;
      const fn = RM6_FUNCTIONS.find(f => f.code === code);
      if (fn) {
        wizState.cells[i] = { type: fn.cellType, In_A: fn.In_A, breakerType: fn.breakerType, functionDesc: fn.label };
      }
      _renderCellsEditor();
    };
  });
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

// ==================== Standalone-режим (v0.59.363) ====================
// Wizard теперь доступен и без ?nodeId — пользователь может запустить
// подбор РУ как отдельный калькулятор и экспортировать результат в файл.
function _startStandaloneWizard() {
  // имитируем nodeId, чтобы initWizard и _applyConfiguration не валились
  if (!wizState.nodeId) wizState.nodeId = 'standalone-' + Date.now().toString(36);
  const wizard = document.getElementById('mv-wizard');
  if (!wizard) return;
  wizard.style.display = '';
  document.getElementById('mv-catalog-panel').style.display = 'none';
  document.getElementById('mv-standalone-panel').style.display = 'none';
  _fillStep1();
  _showStep(1);
  document.getElementById('mv-wiz-cancel').onclick = () => {
    wizard.style.display = 'none';
    document.getElementById('mv-catalog-panel').style.display = '';
    document.getElementById('mv-standalone-panel').style.display = '';
    wizState.nodeId = null;
  };
  document.getElementById('mv-wiz-next-1').onclick = _goStep2;
  document.getElementById('mv-wiz-back-2').onclick = () => _showStep(1);
  document.getElementById('mv-wiz-next-2').onclick = _goStep3;
  document.getElementById('mv-wiz-back-3').onclick = () => _showStep(2);
  document.getElementById('mv-wiz-next-3').onclick = _goStep4;
  document.getElementById('mv-wiz-back-4').onclick = () => _showStep(3);
  document.getElementById('mv-wiz-apply').onclick = () => {
    // в standalone-режиме «Применить» = экспорт в файл
    _exportCurrentConfig();
  };
}

function _exportCurrentConfig() {
  try {
    const rq = wizState.requirements;
    const sel = wizState.selected;
    const payload = {
      schema: 'raschet.mv-config.v1',
      exportedAt: new Date().toISOString(),
      requirements: { ...rq },
      selected: sel ? {
        id: sel.el?.id,
        label: sel.el?.label,
        manufacturer: sel.el?.manufacturer,
        series: sel.el?.series,
        kindProps: sel.el?.kindProps,
      } : null,
      cells: wizState.cells,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = (rq.name || 'mv-config').replace(/[^\w\-]+/g, '_').slice(0, 40);
    a.download = `mv-config-${safe}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    flash('✔ Конфигурация выгружена в JSON', 'success');
  } catch (e) {
    flash('Ошибка экспорта: ' + (e.message || e), 'error');
  }
}

function _importConfigFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.schema !== 'raschet.mv-config.v1') {
        flash('Неподдерживаемая схема: ' + (data.schema || '(нет)'), 'error');
        return;
      }
      Object.assign(wizState.requirements, data.requirements || {});
      wizState.cells = Array.isArray(data.cells) ? data.cells : [];
      _startStandaloneWizard();
      flash('✔ Конфигурация загружена. Проверьте Шаг 1.', 'success');
    } catch (e) {
      flash('Не удалось распарсить файл: ' + (e.message || e), 'error');
    }
  };
  reader.readAsText(file);
}

// ==================== Bootstrap ====================
document.addEventListener('DOMContentLoaded', () => {
  renderCatalog();
  initWizard();
  // standalone-кнопки (видны только когда нет ?nodeId)
  const startBtn = document.getElementById('mv-start-standalone');
  if (startBtn) startBtn.addEventListener('click', _startStandaloneWizard);
  const expBtn = document.getElementById('mv-export-config');
  if (expBtn) expBtn.addEventListener('click', _exportCurrentConfig);
  const impInput = document.getElementById('mv-import-config');
  if (impInput) impInput.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) _importConfigFromFile(f);
    e.target.value = '';
  });
  // если запущено с ?nodeId — скрываем standalone-панель
  if (new URLSearchParams(location.search).get('nodeId')) {
    const sp = document.getElementById('mv-standalone-panel');
    if (sp) sp.style.display = 'none';
  }
});
