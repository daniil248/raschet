// =============================================================================
// service/ui/order-form.js — форма наряда сервисных/монтажных работ
// =============================================================================
// Phase 24.1. UI-слой; зависит от DOM. Использует pure-функции из
// service/calc/order-model.js.

import {
  DEFAULT_ORDER, ORDER_TYPES, POSITION_CATEGORIES, UNITS, WORK_TEMPLATES,
  defaultPosition, computeOrderTotals, CURRENCIES,
} from '../calc/order-model.js';
import { fmtMoney } from '../../cooling/calc/fc-summary.js';
import { escAttr, escHtml, modalOpen, toast } from '../../meteo/util.js';

/**
 * @param {object} order            — текущий наряд
 * @param {function(order)} onChange — вызывается при каждом изменении
 * @param {string} displayCurrency  — валюта проекта/отчёта
 * @param {function|null} convertFn — (amount, fromCur, toCur) => number
 */
export function renderOrderForm(order, onChange, displayCurrency = '₽', convertFn = null) {
  const o = { ...DEFAULT_ORDER, ...(order || {}) };
  if (!Array.isArray(o.positions)) o.positions = [];
  const wrap = document.createElement('div');
  wrap.className = 'sv-order-form';

  const totals = computeOrderTotals(o, displayCurrency, convertFn);
  const fmt = (v) => fmtMoney(v, displayCurrency);

  const typeOpts = ORDER_TYPES.map(t =>
    `<option value="${t.id}"${t.id === o.type ? ' selected' : ''} title="${escAttr(t.desc)}">${escHtml(t.label)}</option>`
  ).join('');

  wrap.innerHTML = `
    <div class="sv-section">
      <div class="sv-section-title" title="Параметры наряда: имя, тип, заказчик, дата.">📋 Свойства наряда</div>
      <div class="sv-grid">
        <label class="sv-field" title="Краткое имя наряда (например «Монтаж чиллера York YLAA200 для ЦОД-1»). Появляется в списке нарядов.">
          <span>Название</span>
          <input type="text" data-of="name" value="${escAttr(o.name || '')}" placeholder="Например: Монтаж чиллера для серверной A">
        </label>
        <label class="sv-field" title="Тип наряда. Влияет на подсказки шаблонов работ.">
          <span>Тип</span>
          <select data-of="type">${typeOpts}</select>
        </label>
        <label class="sv-field" title="Дата наряда. Используется для выбора курса валют (если включена дата курса).">
          <span>Дата</span>
          <input type="date" data-of="date" value="${escAttr(o.date)}">
        </label>
        <label class="sv-field" title="Имя заказчика / организации.">
          <span>Заказчик</span>
          <input type="text" data-of="customer.name" value="${escAttr(o.customer?.name || '')}" placeholder="ООО «...»">
        </label>
        <label class="sv-field" title="Контакт заказчика (телефон / email).">
          <span>Контакт</span>
          <input type="text" data-of="customer.contact" value="${escAttr(o.customer?.contact || '')}" placeholder="+7 ... / email@...">
        </label>
        <label class="sv-field" title="Накладные расходы — % от себестоимости. Учитываются при расчёте маржи. Типично 10–20%.">
          <span>Накладные, %</span>
          <input type="number" min="0" max="200" step="1" data-of="overheadPct" value="${o.overheadPct}">
        </label>
        <label class="sv-field" title="НДС, % от клиент-цены. Применяется к итогу для клиента. РФ — 20%, KZ — 12%.">
          <span>НДС, %</span>
          <input type="number" min="0" max="50" step="0.5" data-of="vatPct" value="${o.vatPct}">
        </label>
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Позиции наряда: одна строка = одна работа/материал/командировка с qty/unit/себес/клиент-ценой.">📦 Состав работ и материалов (${o.positions.length})</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <button type="button" class="sv-btn-primary" id="sv-add-pos" title="Добавить пустую позицию.">+ Позиция</button>
        <button type="button" class="sv-btn-ghost" id="sv-add-template" title="Открыть каталог типовых работ для текущего типа наряда (${escAttr(ORDER_TYPES.find(t => t.id === o.type)?.label || '')}). Шаблоны имеют дефолтные себес/клиент-цены — можно редактировать после добавления.">📚 Из шаблонов</button>
      </div>
      <div class="sv-table-wrap">
        ${renderPositionsTable(o.positions, displayCurrency)}
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Итоги наряда — все суммы в валюте проекта (${escAttr(displayCurrency)}) с per-cell конвертацией по курсу.">📊 Итоги</div>
      <div class="sv-totals-grid">
        <div class="sv-total-block sv-total-cost" title="Себестоимость = Σ qty × costPrice. Накладные = себес × overhead%/100. Итого = себес + накладные.">
          <h5>СЕБЕСТОИМОСТЬ</h5>
          <div class="sv-total-row"><span>Σ Себес (без накладных)</span><b>${fmt(totals.sumCostNative)}</b></div>
          <div class="sv-total-row"><span>+ Накладные (${o.overheadPct}%)</span><b>${fmt(totals.sumOverhead)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>= Себес итого</span><b>${fmt(totals.sumCostWithOverhead)}</b></div>
        </div>
        <div class="sv-total-block sv-total-client" title="Клиент-цена = Σ qty × clientPrice. НДС = клиент × vat%/100. Итого с НДС.">
          <h5>ДЛЯ КЛИЕНТА</h5>
          <div class="sv-total-row"><span>Σ Клиент (без НДС)</span><b>${fmt(totals.sumClientNative)}</b></div>
          <div class="sv-total-row"><span>+ НДС (${o.vatPct}%)</span><b>${fmt(totals.sumVat)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>= К оплате</span><b>${fmt(totals.sumClientWithVat)}</b></div>
        </div>
        <div class="sv-total-block sv-total-margin" title="Маржа = Клиент − Себес итого. Маржа% относительно Себес итого. Целевая маржа ≥ 30% для устойчивого бизнеса.">
          <h5>МАРЖА</h5>
          <div class="sv-total-row"><span>Маржа абс.</span><b>${fmt(totals.marginAbs)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>Маржа %</span><b style="color:${totals.marginPct >= 30 ? '#16a34a' : (totals.marginPct >= 15 ? '#f59e0b' : '#dc2626')}">${totals.marginPct.toFixed(1)} %</b></div>
        </div>
      </div>
      <div class="sv-by-cat" title="Распределение себестоимости по категориям — помогает понять структуру затрат.">
        <h5>Себестоимость по категориям</h5>
        <div class="sv-cat-grid">
          ${POSITION_CATEGORIES.map(c => {
            const v = totals.byCategory[c.id] || 0;
            return `<div class="sv-cat-row" title="${escAttr(c.tip)}"><span>${escHtml(c.label)}</span><b>${fmt(v)}</b></div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Свободные примечания к наряду (детали договора, условия гарантии, контактное лицо).">📝 Примечания</div>
      <textarea data-of="notes" rows="3" style="width:100%" placeholder="Дополнительная информация, условия, гарантии...">${escHtml(o.notes || '')}</textarea>
    </div>
  `;

  wrap.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-of]');
    if (inp) {
      const path = inp.dataset.of;
      const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
      const next = setByPath({ ...o }, path, val);
      onChange(next);
      return;
    }
    // Position cells
    const tr = ev.target.closest('tr[data-pos]');
    if (tr) handlePositionInput(ev, tr, o, onChange, displayCurrency, convertFn);
  });
  wrap.addEventListener('change', (ev) => {
    // selects: обработка currency-change с пересчётом
    const tr = ev.target.closest('tr[data-pos]');
    if (tr) handlePositionInput(ev, tr, o, onChange, displayCurrency, convertFn, /*isChange*/true);
  });
  wrap.addEventListener('click', async (ev) => {
    if (ev.target.closest('#sv-add-pos')) {
      const next = { ...o, positions: [...o.positions, defaultPosition(displayCurrency)] };
      onChange(next);
      return;
    }
    if (ev.target.closest('#sv-add-template')) {
      const tpl = await pickTemplateModal(o.type, displayCurrency);
      if (tpl) {
        const next = { ...o, positions: [...o.positions, tpl] };
        onChange(next);
      }
      return;
    }
    const del = ev.target.closest('.sv-pos-del');
    if (del) {
      const tr = del.closest('tr[data-pos]');
      const idx = Number(tr.dataset.pos);
      const next = { ...o, positions: o.positions.filter((_, i) => i !== idx) };
      onChange(next);
      return;
    }
  });

  return wrap;
}

function renderPositionsTable(positions, displayCurrency) {
  const curOpts = (sel) => CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''}>${c.code}</option>`
  ).join('');
  const catOpts = (sel) => POSITION_CATEGORIES.map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''} title="${escAttr(c.tip)}">${escHtml(c.label)}</option>`
  ).join('');
  const unitOpts = (sel) => UNITS.map(u =>
    `<option value="${u}"${u === sel ? ' selected' : ''}>${escHtml(u)}</option>`
  ).join('');

  if (!positions.length) {
    return '<p class="muted" style="margin:0;padding:10px;text-align:center">Нет позиций. Добавьте через «+ Позиция» или «📚 Из шаблонов».</p>';
  }

  const rows = positions.map((p, i) => `
    <tr data-pos="${i}">
      <td><input type="text" class="sv-pos-label" data-attr="label" value="${escAttr(p.label || '')}" placeholder="Описание работы / материала" title="Описание позиции"></td>
      <td><select class="sv-pos-cat" data-attr="category" title="Категория позиции">${catOpts(p.category)}</select></td>
      <td><input type="number" min="0" step="0.5" class="sv-pos-qty" data-attr="qty" value="${Number(p.qty) || 1}" title="Количество"></td>
      <td><select class="sv-pos-unit" data-attr="unit" title="Единица измерения">${unitOpts(p.unit)}</select></td>
      <td><input type="number" min="0" step="100" class="sv-pos-val" data-col="costPrice" data-attr="value" value="${Number(p.costPrice?.value) || 0}" title="Себестоимость одной единицы"></td>
      <td><select class="sv-pos-cur" data-col="costPrice" data-attr="currency" title="Валюта себестоимости">${curOpts(p.costPrice?.currency || displayCurrency)}</select></td>
      <td><input type="number" min="0" step="100" class="sv-pos-val" data-col="clientPrice" data-attr="value" value="${Number(p.clientPrice?.value) || 0}" title="Цена для клиента за единицу"></td>
      <td><select class="sv-pos-cur" data-col="clientPrice" data-attr="currency" title="Валюта клиент-цены">${curOpts(p.clientPrice?.currency || displayCurrency)}</select></td>
      <td><button type="button" class="sv-pos-del" title="Удалить позицию">×</button></td>
    </tr>
  `).join('');
  return `
    <table class="sv-pos-table">
      <thead>
        <tr>
          <th title="Описание позиции">Позиция</th>
          <th title="Категория: работа / материал / командировочные / субподряд / прочее">Категория</th>
          <th title="Количество">Кол-во</th>
          <th title="Единица измерения">Ед.</th>
          <th title="Себестоимость одной единицы">Себес/ед</th>
          <th title="Валюта себестоимости">Вал.</th>
          <th title="Клиент-цена одной единицы">Клиент/ед</th>
          <th title="Валюта клиент-цены">Вал.</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function handlePositionInput(ev, tr, o, onChange, displayCurrency, convertFn, isChange = false) {
  const idx = Number(tr.dataset.pos);
  const positions = o.positions.map(p => ({ ...p,
    costPrice: { ...p.costPrice }, clientPrice: { ...p.clientPrice },
  }));
  if (!positions[idx]) return;
  const attr = ev.target.dataset.attr;
  const col = ev.target.dataset.col;
  const targetVal = ev.target.value;

  if (col && attr === 'currency') {
    if (!isChange) return;  // currency только в change
    if (!positions[idx][col]) positions[idx][col] = { value: 0, currency: displayCurrency };
    const oldCur = positions[idx][col].currency;
    const newCur = targetVal;
    if (oldCur !== newCur) {
      const curVal = Number(positions[idx][col].value) || 0;
      if (curVal > 0 && convertFn) {
        const v = convertFn(curVal, oldCur, newCur);
        if (Number.isFinite(v) && v > 0) {
          positions[idx][col].value = +(v.toFixed(2));
          toast(`${oldCur} → ${newCur}: ${curVal} → ${positions[idx][col].value}`, 'info');
        }
      }
      positions[idx][col].currency = newCur;
    }
  } else if (col && attr === 'value') {
    if (!positions[idx][col]) positions[idx][col] = { value: 0, currency: displayCurrency };
    positions[idx][col].value = Number(targetVal) || 0;
  } else if (attr === 'label') {
    positions[idx].label = targetVal;
  } else if (attr === 'category') {
    positions[idx].category = targetVal;
  } else if (attr === 'unit') {
    positions[idx].unit = targetVal;
  } else if (attr === 'qty') {
    positions[idx].qty = Number(targetVal) || 0;
  } else {
    return;  // ignore прочие поля
  }
  onChange({ ...o, positions });
}

function setByPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  return obj;
}

async function pickTemplateModal(type, displayCurrency) {
  const tpls = WORK_TEMPLATES[type] || [];
  if (!tpls.length) {
    toast('Нет шаблонов для этого типа наряда.', 'info');
    return null;
  }
  const opts = tpls.map((t, i) =>
    `<option value="${i}" title="${escAttr(t.label)} — ${escAttr(t.category)}, ${t.costPrice} ₽ → ${t.clientPrice} ₽">${escHtml(t.label)} (${escHtml(t.category)}, ${t.unit})</option>`
  ).join('');
  const result = await modalOpen(
    `<h3>📚 Шаблоны типовых работ — ${escHtml(ORDER_TYPES.find(t => t.id === type)?.label || '')}</h3>`,
    `<label>Выберите шаблон:<select id="sv-tpl-sel" size="10" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">${opts}</select></label>
     <p class="muted" style="font-size:11.5px;margin-top:6px">Цены в шаблонах указаны в ₽. Если валюта проекта другая — после добавления откорректируйте через select валюты в строке.</p>`,
    async () => {
      const sel = document.getElementById('sv-tpl-sel');
      const i = Number(sel?.value);
      if (!Number.isFinite(i) || !tpls[i]) return null;
      return { idx: i };
    }
  );
  if (!result) return null;
  const t = tpls[result.idx];
  return {
    id: 'pos-' + Math.random().toString(36).slice(2, 8),
    label: t.label,
    category: t.category,
    qty: 1,
    unit: t.unit,
    costPrice:   { value: t.costPrice,   currency: '₽' },
    clientPrice: { value: t.clientPrice, currency: '₽' },
  };
}
