// ======================================================================
// logistics/logistics.js — модуль «Рабочее место логиста» (Фаза 1.6 MVP).
// 4 таба: Отправления / Склады / Тарифы / Калькулятор.
// ======================================================================

import {
  listWarehouses, getWarehouse, saveWarehouse, removeWarehouse,
  onWarehousesChange, WAREHOUSE_TYPES,
  listCarrierRates, getCarrierRate, saveCarrierRate, removeCarrierRate,
  onCarrierRatesChange, SHIPMENT_MODES,
  listShipments, getShipment, saveShipment, removeShipment,
  onShipmentsChange, SHIPMENT_STATUSES,
  calcShipmentCost,
} from '../shared/logistics-schemas.js';
import { listCounterparties } from '../shared/counterparty-catalog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtRub = v => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
const fmtDate = ts => !ts ? '—' : new Date(ts).toLocaleDateString('ru-RU');

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

function openModal(title, html, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-form').innerHTML = html;
  const modal = document.getElementById('modal');
  modal.classList.add('show');
  document.getElementById('modal-cancel').onclick = () => modal.classList.remove('show');
  document.getElementById('modal-save').onclick = () => {
    try {
      if (onSave() !== false) modal.classList.remove('show');
    } catch (e) { flash('Ошибка: ' + e.message, 'error'); }
  };
}

// ====================== TAB: ОТПРАВЛЕНИЯ ======================
let currentTab = 'shipments';

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.hidden = (c.id !== 'tab-' + name));
  ({
    shipments: renderShipmentsTab,
    warehouses: renderWarehousesTab,
    rates: renderRatesTab,
    calculator: renderCalculatorTab,
  })[name]?.();
}

function renderShipmentsTab() {
  const container = document.getElementById('tab-shipments');
  const list = listShipments();
  const html = [`
    <div class="toolbar">
      <span class="muted" style="font-size:12px">Всего: <b>${list.length}</b></span>
      <div class="spacer"></div>
      <button id="sh-add" class="primary">+ Новое отправление</button>
    </div>
    <div style="max-height:60vh;overflow:auto">
      <table class="data-table">
        <thead><tr>
          <th>Статус</th><th>Название</th><th>Режим</th><th>Откуда → Куда</th>
          <th>Позиций</th><th class="num">Стоимость</th><th>План</th><th></th>
        </tr></thead>
        <tbody>`];
  if (!list.length) html.push('<tr><td colspan="8" class="empty">Нет отправлений. Создайте первое.</td></tr>');
  for (const sh of list) {
    const st = SHIPMENT_STATUSES[sh.status] || SHIPMENT_STATUSES.draft;
    const mode = SHIPMENT_MODES[sh.mode] || SHIPMENT_MODES.road;
    const origin = sh.originId ? getWarehouse(sh.originId) : null;
    const dest = sh.destinationId ? getWarehouse(sh.destinationId) : null;
    html.push(`<tr data-id="${esc(sh.id)}">
      <td><span class="type-badge" style="color:${st.color}">${st.icon} ${esc(st.label)}</span></td>
      <td><b>${esc(sh.label || sh.id)}</b></td>
      <td>${mode.icon} ${esc(mode.label)}</td>
      <td class="muted" style="font-size:11px">
        ${origin ? esc(origin.name) : '—'} →<br>
        ${dest ? esc(dest.name) : '—'}
      </td>
      <td class="num">${(sh.items || []).length}</td>
      <td class="num">${fmtRub(sh.cost)}</td>
      <td>${fmtDate(sh.plannedAt)}</td>
      <td class="actions">
        <button data-act="edit">✎</button>
        <button data-act="del" class="danger">×</button>
      </td>
    </tr>`);
  }
  html.push('</tbody></table></div>');
  container.innerHTML = html.join('');

  document.getElementById('sh-add').onclick = () => openShipmentModal();
  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'edit') openShipmentModal(id);
        else if (btn.dataset.act === 'del' && confirm('Удалить?')) { removeShipment(id); flash('Удалено', 'success'); }
      };
    });
  });
}

function openShipmentModal(editId) {
  const rec = editId ? getShipment(editId) : { status: 'draft', mode: 'road', items: [] };
  const whs = listWarehouses();
  const modeOpts = Object.entries(SHIPMENT_MODES).map(([k, v]) =>
    `<option value="${k}"${k === rec.mode ? ' selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('');
  const statusOpts = Object.entries(SHIPMENT_STATUSES).map(([k, v]) =>
    `<option value="${k}"${k === rec.status ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  const whOpts = whs.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');

  const dateVal = rec.plannedAt ? new Date(rec.plannedAt).toISOString().slice(0, 10) : '';

  let itemsHtml = (rec.items || []).map((it, i) => `
    <div class="shipment-item-row" data-idx="${i}">
      <input class="it-label" placeholder="Наименование" value="${esc(it.label || '')}">
      <input class="it-qty" type="number" min="0" step="1" placeholder="кол-во" value="${it.qty || 1}">
      <input class="it-kg" type="number" min="0" step="0.1" placeholder="кг" value="${it.unitKg || ''}">
      <input class="it-m3" type="number" min="0" step="0.001" placeholder="м³" value="${it.unitM3 || ''}">
      <input class="it-price" type="number" min="0" step="0.01" placeholder="цена ₽" value="${it.unitPriceRUB || ''}">
      <button type="button" class="it-del danger" title="Удалить">×</button>
    </div>`).join('');

  const html = `
    <div class="field"><label>Название отправления</label><input id="f-label" value="${esc(rec.label || '')}" placeholder="например: «Поставка ВРУ-1 на объект X»"></div>
    <div class="field-row">
      <div class="field"><label>Статус</label><select id="f-status">${statusOpts}</select></div>
      <div class="field"><label>Режим</label><select id="f-mode">${modeOpts}</select></div>
      <div class="field"><label>План дата</label><input type="date" id="f-plannedAt" value="${dateVal}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Откуда (склад)</label>
        <select id="f-originId"><option value="">—</option>${whOpts.replace(/value="([^"]+)"/g, (m, v) => `value="${v}"${v === rec.originId ? ' selected' : ''}`)}</select>
      </div>
      <div class="field"><label>Куда (склад)</label>
        <select id="f-destinationId"><option value="">—</option>${whOpts.replace(/value="([^"]+)"/g, (m, v) => `value="${v}"${v === rec.destinationId ? ' selected' : ''}`)}</select>
      </div>
    </div>
    <div class="field"><label>Стоимость перевозки, ₽</label><input type="number" id="f-cost" min="0" step="0.01" value="${rec.cost || ''}"></div>
    <h4 style="margin:14px 0 6px;font-size:13px">Позиции отправления</h4>
    <div class="shipment-item-row" style="font-size:11px;color:#666;font-weight:600">
      <span>Наименование</span><span>Кол-во</span><span>Кг/шт</span><span>м³/шт</span><span>Цена ₽/шт</span><span></span>
    </div>
    <div id="items-list">${itemsHtml}</div>
    <button type="button" id="add-item" style="margin-top:8px">+ Добавить позицию</button>
    <div class="field"><label>Примечания</label><textarea id="f-notes">${esc(rec.notes || '')}</textarea></div>
  `;
  openModal(editId ? 'Редактирование отправления' : 'Новое отправление', html, () => {
    const items = [];
    document.querySelectorAll('.shipment-item-row[data-idx]').forEach(row => {
      const label = row.querySelector('.it-label')?.value || '';
      const qty = Number(row.querySelector('.it-qty')?.value) || 0;
      if (!label || qty <= 0) return;
      items.push({
        label, qty,
        unitKg: Number(row.querySelector('.it-kg')?.value) || 0,
        unitM3: Number(row.querySelector('.it-m3')?.value) || 0,
        unitPriceRUB: Number(row.querySelector('.it-price')?.value) || 0,
      });
    });
    saveShipment({
      id: editId || undefined,
      label: document.getElementById('f-label').value.trim(),
      status: document.getElementById('f-status').value,
      mode: document.getElementById('f-mode').value,
      originId: document.getElementById('f-originId').value || null,
      destinationId: document.getElementById('f-destinationId').value || null,
      cost: Number(document.getElementById('f-cost').value) || 0,
      plannedAt: document.getElementById('f-plannedAt').value ? new Date(document.getElementById('f-plannedAt').value).getTime() : null,
      notes: document.getElementById('f-notes').value || null,
      items,
    });
    flash('Сохранено', 'success');
  });

  // Wire add-item
  document.getElementById('add-item').onclick = () => {
    const list = document.getElementById('items-list');
    const idx = list.querySelectorAll('.shipment-item-row[data-idx]').length;
    const div = document.createElement('div');
    div.className = 'shipment-item-row';
    div.dataset.idx = idx;
    div.innerHTML = `
      <input class="it-label" placeholder="Наименование">
      <input class="it-qty" type="number" min="0" step="1" placeholder="кол-во" value="1">
      <input class="it-kg" type="number" min="0" step="0.1" placeholder="кг">
      <input class="it-m3" type="number" min="0" step="0.001" placeholder="м³">
      <input class="it-price" type="number" min="0" step="0.01" placeholder="цена ₽">
      <button type="button" class="it-del danger">×</button>`;
    list.appendChild(div);
    div.querySelector('.it-del').onclick = () => div.remove();
  };
  document.querySelectorAll('.it-del').forEach(b => { b.onclick = () => b.closest('.shipment-item-row').remove(); });
}

// ====================== TAB: СКЛАДЫ ======================
function renderWarehousesTab() {
  const container = document.getElementById('tab-warehouses');
  const list = listWarehouses();
  const html = [`
    <div class="toolbar">
      <span class="muted" style="font-size:12px">Всего: <b>${list.length}</b></span>
      <div class="spacer"></div>
      <button id="wh-add" class="primary">+ Новый склад</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Тип</th><th>Название</th><th>Адрес</th><th class="num">Ёмкость, м³</th><th class="num">₽/м³·день</th><th>Срок готовности</th><th></th></tr></thead>
      <tbody>`];
  if (!list.length) html.push('<tr><td colspan="7" class="empty">Нет складов.</td></tr>');
  for (const w of list) {
    const t = WAREHOUSE_TYPES[w.type] || WAREHOUSE_TYPES.own;
    html.push(`<tr data-id="${esc(w.id)}">
      <td><span class="type-badge">${t.icon} ${esc(t.label)}</span></td>
      <td><b>${esc(w.name)}</b></td>
      <td class="muted" style="font-size:11px">${esc(w.address || '—')}</td>
      <td class="num">${w.capacityM3 || '—'}</td>
      <td class="num">${w.costPerM3Day || '—'}</td>
      <td>${w.leadDays ? w.leadDays + ' дн' : '—'}</td>
      <td class="actions"><button data-act="edit">✎</button><button data-act="del" class="danger">×</button></td>
    </tr>`);
  }
  html.push('</tbody></table>');
  container.innerHTML = html.join('');
  document.getElementById('wh-add').onclick = () => openWarehouseModal();
  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'edit') openWarehouseModal(id);
        else if (btn.dataset.act === 'del' && confirm('Удалить склад?')) { removeWarehouse(id); flash('Удалено', 'success'); }
      };
    });
  });
}

function openWarehouseModal(editId) {
  const rec = editId ? getWarehouse(editId) : { type: 'own' };
  const typeOpts = Object.entries(WAREHOUSE_TYPES).map(([k, v]) =>
    `<option value="${k}"${k === rec.type ? ' selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('');
  const cps = listCounterparties();
  const cpOpts = cps.map(c => `<option value="${c.id}"${c.id === rec.counterpartyId ? ' selected' : ''}>${esc(c.shortName || c.name)}</option>`).join('');
  const html = `
    <div class="field"><label>Название *</label><input id="f-name" value="${esc(rec.name || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Тип</label><select id="f-type">${typeOpts}</select></div>
      <div class="field"><label>Контрагент</label><select id="f-cpid"><option value="">—</option>${cpOpts}</select></div>
    </div>
    <div class="field"><label>Адрес</label><input id="f-address" value="${esc(rec.address || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Ёмкость, м³</label><input type="number" id="f-cap" min="0" step="1" value="${rec.capacityM3 || ''}"></div>
      <div class="field"><label>Хранение, ₽/м³·день</label><input type="number" id="f-cost" min="0" step="0.01" value="${rec.costPerM3Day || ''}"></div>
      <div class="field"><label>Срок готовности, дн</label><input type="number" id="f-lead" min="0" step="1" value="${rec.leadDays || ''}"></div>
    </div>
    <div class="field"><label>Примечания</label><textarea id="f-notes">${esc(rec.notes || '')}</textarea></div>
  `;
  openModal(editId ? 'Редактирование склада' : 'Новый склад', html, () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { flash('Название обязательно', 'error'); return false; }
    saveWarehouse({
      id: editId || undefined,
      name,
      type: document.getElementById('f-type').value,
      counterpartyId: document.getElementById('f-cpid').value || null,
      address: document.getElementById('f-address').value || null,
      capacityM3: Number(document.getElementById('f-cap').value) || null,
      costPerM3Day: Number(document.getElementById('f-cost').value) || null,
      leadDays: Number(document.getElementById('f-lead').value) || null,
      notes: document.getElementById('f-notes').value || null,
    });
    flash('Сохранено', 'success');
  });
}

// ====================== TAB: ТАРИФЫ ======================
function renderRatesTab() {
  const container = document.getElementById('tab-rates');
  const list = listCarrierRates();
  const cps = listCounterparties();
  const html = [`
    <div class="toolbar">
      <span class="muted" style="font-size:12px">Всего: <b>${list.length}</b></span>
      <div class="spacer"></div>
      <button id="cr-add" class="primary">+ Новый тариф</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Режим</th><th>Перевозчик</th><th class="num">Фикс, ₽</th><th class="num">₽/кг</th><th class="num">₽/км</th><th class="num">₽/м³</th><th class="num">Мин. заказ</th><th></th></tr></thead>
      <tbody>`];
  if (!list.length) html.push('<tr><td colspan="8" class="empty">Нет тарифов.</td></tr>');
  for (const r of list) {
    const m = SHIPMENT_MODES[r.mode] || SHIPMENT_MODES.road;
    const cp = cps.find(c => c.id === r.carrierId);
    html.push(`<tr data-id="${esc(r.id)}">
      <td>${m.icon} ${esc(m.label)}</td>
      <td>${cp ? esc(cp.shortName || cp.name) : '<span class="muted">—</span>'}</td>
      <td class="num">${r.unitRUB || '—'}</td>
      <td class="num">${r.perKg || '—'}</td>
      <td class="num">${r.perKm || '—'}</td>
      <td class="num">${r.perM3 || '—'}</td>
      <td class="num">${r.minOrder || '—'}</td>
      <td class="actions"><button data-act="edit">✎</button><button data-act="del" class="danger">×</button></td>
    </tr>`);
  }
  html.push('</tbody></table>');
  container.innerHTML = html.join('');
  document.getElementById('cr-add').onclick = () => openRateModal();
  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'edit') openRateModal(id);
        else if (btn.dataset.act === 'del' && confirm('Удалить?')) { removeCarrierRate(id); flash('Удалено', 'success'); }
      };
    });
  });
}

function openRateModal(editId) {
  const rec = editId ? getCarrierRate(editId) : { mode: 'road' };
  const modeOpts = Object.entries(SHIPMENT_MODES).map(([k, v]) =>
    `<option value="${k}"${k === rec.mode ? ' selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('');
  const cps = listCounterparties().filter(c => c.type === 'logistics' || c.type === 'supplier');
  const cpOpts = cps.map(c => `<option value="${c.id}"${c.id === rec.carrierId ? ' selected' : ''}>${esc(c.shortName || c.name)}</option>`).join('');
  const html = `
    <div class="field-row">
      <div class="field"><label>Режим</label><select id="f-mode">${modeOpts}</select></div>
      <div class="field"><label>Перевозчик</label><select id="f-carrier"><option value="">—</option>${cpOpts}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Фиксированная, ₽</label><input type="number" id="f-fixed" min="0" step="1" value="${rec.unitRUB || ''}"></div>
      <div class="field"><label>₽/кг</label><input type="number" id="f-perKg" min="0" step="0.01" value="${rec.perKg || ''}"></div>
      <div class="field"><label>₽/км</label><input type="number" id="f-perKm" min="0" step="0.01" value="${rec.perKm || ''}"></div>
      <div class="field"><label>₽/м³</label><input type="number" id="f-perM3" min="0" step="1" value="${rec.perM3 || ''}"></div>
    </div>
    <div class="field"><label>Минимальный заказ, ₽</label><input type="number" id="f-min" min="0" step="1" value="${rec.minOrder || ''}"></div>
    <div class="field"><label>Примечания</label><textarea id="f-notes">${esc(rec.note || '')}</textarea></div>
  `;
  openModal(editId ? 'Редактирование тарифа' : 'Новый тариф', html, () => {
    saveCarrierRate({
      id: editId || undefined,
      mode: document.getElementById('f-mode').value,
      carrierId: document.getElementById('f-carrier').value || null,
      unitRUB: Number(document.getElementById('f-fixed').value) || 0,
      perKg: Number(document.getElementById('f-perKg').value) || 0,
      perKm: Number(document.getElementById('f-perKm').value) || 0,
      perM3: Number(document.getElementById('f-perM3').value) || 0,
      minOrder: Number(document.getElementById('f-min').value) || 0,
      note: document.getElementById('f-notes').value || null,
    });
    flash('Сохранено', 'success');
  });
}

// ====================== TAB: КАЛЬКУЛЯТОР ======================
function renderCalculatorTab() {
  const container = document.getElementById('tab-calculator');
  const rates = listCarrierRates();
  const rateOpts = rates.map(r => {
    const m = SHIPMENT_MODES[r.mode] || SHIPMENT_MODES.road;
    return `<option value="${r.id}">${m.icon} ${esc(m.label)} — фикс ${r.unitRUB || 0}₽ + ${r.perKg || 0}₽/кг + ${r.perKm || 0}₽/км</option>`;
  }).join('');

  container.innerHTML = `
    <h3 style="margin-top:0">🧮 Калькулятор стоимости перевозки</h3>
    <div class="muted" style="font-size:13px;margin-bottom:12px">
      Быстрый расчёт без сохранения в «Отправления». Для полноценного расчёта с привязкой к проекту используйте вкладку «Отправления».
    </div>

    <div class="field-row">
      <div class="field" style="flex:2">
        <label>Тариф</label>
        <select id="calc-rate">
          <option value="">— выберите тариф —</option>
          ${rateOpts}
        </select>
      </div>
      <div class="field">
        <label>Расстояние, км</label>
        <input type="number" id="calc-dist" min="0" step="1" value="100">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Общий вес, кг</label>
        <input type="number" id="calc-kg" min="0" step="1" value="500">
      </div>
      <div class="field">
        <label>Общий объём, м³</label>
        <input type="number" id="calc-m3" min="0" step="0.01" value="2">
      </div>
      <div class="field">
        <label>Количество позиций</label>
        <input type="number" id="calc-qty" min="1" step="1" value="1">
      </div>
    </div>
    <button id="calc-btn" class="primary">Рассчитать</button>

    <div id="calc-result"></div>

    ${!rates.length ? '<p class="muted" style="margin-top:16px;padding:10px;background:#fff4e5;border-radius:4px">⚠ Нет тарифов в справочнике. Создайте тариф во вкладке «Тарифы» для расчёта.</p>' : ''}
  `;

  document.getElementById('calc-btn').onclick = () => {
    const rateId = document.getElementById('calc-rate').value;
    const rate = rates.find(r => r.id === rateId);
    if (!rate) { flash('Выберите тариф', 'warn'); return; }
    const items = [{
      unitKg: Number(document.getElementById('calc-kg').value) || 0,
      unitM3: Number(document.getElementById('calc-m3').value) || 0,
      qty: Number(document.getElementById('calc-qty').value) || 1,
    }];
    const result = calcShipmentCost(items, rate, {
      distanceKm: Number(document.getElementById('calc-dist').value) || 0,
    });
    document.getElementById('calc-result').innerHTML = `
      <div class="calc-result">
        <div class="calc-result-total">Итого: ${fmtRub(result.subtotal)}</div>
        <div class="calc-breakdown">
          <span class="label">Фиксированная часть</span><span class="value">${fmtRub(result.breakdown.fixed)}</span>
          <span class="label">По весу (${result.totalKg.toFixed(1)} кг × ${rate.perKg || 0}₽)</span><span class="value">${fmtRub(result.breakdown.perKg)}</span>
          <span class="label">По расстоянию (${document.getElementById('calc-dist').value} км × ${rate.perKm || 0}₽)</span><span class="value">${fmtRub(result.breakdown.perKm)}</span>
          <span class="label">По объёму (${result.totalM3.toFixed(2)} м³ × ${rate.perM3 || 0}₽)</span><span class="value">${fmtRub(result.breakdown.perM3)}</span>
          ${rate.minOrder && result.subtotal === rate.minOrder ? `<span class="label" style="grid-column:1/-1;color:#c67300;margin-top:4px">ℹ Применён минимальный заказ ${fmtRub(rate.minOrder)}</span>` : ''}
        </div>
      </div>
    `;
  };
}

// ====================== Bootstrap ======================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  switchTab('shipments');
  onWarehousesChange(() => { if (['warehouses', 'shipments', 'calculator'].includes(currentTab)) switchTab(currentTab); });
  onCarrierRatesChange(() => { if (['rates', 'calculator'].includes(currentTab)) switchTab(currentTab); });
  onShipmentsChange(() => { if (currentTab === 'shipments') renderShipmentsTab(); });

  // Phase 1.6.3: handoff из Конструктора схем. Если ?import=1 и в
  // localStorage есть raschet.logistics.handoff — открываем модалку
  // нового отправления с предзаполненными позициями.
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('import') === '1') {
      const raw = localStorage.getItem('raschet.logistics.handoff');
      if (raw) {
        const hdf = JSON.parse(raw);
        if (hdf && Array.isArray(hdf.items) && hdf.items.length) {
          // Создаём черновик shipment-а из handoff
          const draft = saveShipment({
            label: `Импорт из «${hdf.projectName || 'проекта'}» (${new Date(hdf.createdAt || Date.now()).toLocaleDateString('ru-RU')})`,
            status: 'draft', mode: 'road',
            items: hdf.items,
            notes: `Импортировано из Конструктора схем ${new Date(hdf.createdAt || Date.now()).toLocaleString('ru-RU')}`,
          });
          const draftId = draft?.id;
          localStorage.removeItem('raschet.logistics.handoff');
          // Чистим URL, чтобы F5 не пересоздавал
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('import');
          window.history.replaceState({}, '', cleanUrl.href);
          flash(`Импортировано ${hdf.items.length} позиций`, 'success');
          renderShipmentsTab();
          // Сразу открываем модалку для редактирования
          setTimeout(() => { if (draftId) openShipmentModal(draftId); }, 200);
        }
      }
    }
  } catch (e) { console.warn('[logistics] handoff import failed', e); }
});
