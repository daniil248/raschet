// =============================================================================
// cooling/ui/annual-table-view.js — рендер annual table + col picker
// =============================================================================
// HTML-вывод bin-таблицы с настраиваемыми столбцами. Tooltip на каждом th.
// Перенесено из meteo/annual-table.js → renderAnnualTable + renderColumnPicker.

import { COLUMNS } from '../calc/chiller-defaults.js';
import { escAttr, escHtml } from '../../meteo/util.js';

/**
 * @param {Array<object>} rows         — bin-строки (с применённой spec)
 * @param {Array<string>} activeCols   — id-список активных колонок
 * @returns {string} HTML
 */
export function renderAnnualTable(rows, activeCols) {
  const cols = COLUMNS.filter(c => activeCols.includes(c.id));
  if (!rows.length) return '<div class="muted">Нет данных. Загрузите датасет в модуле Метеоданные.</div>';
  let totalHours = 0, totalDays = 0, totalEnergy = 0, totalFcHours = 0;
  for (const r of rows) {
    totalHours += r.hours;
    totalDays += r.days;
    if (Number.isFinite(r.energy)) totalEnergy += r.energy;
    if (Number.isFinite(r.fcFraction)) totalFcHours += r.fcFraction * r.hours;
  }
  const fcAvgPct = totalHours > 0 ? (totalFcHours / totalHours * 100) : null;

  return `<table class="cl-annual-table">
    <thead><tr>${cols.map(c => `<th class="${c.id === 'tBin' ? '' : 'num'}" title="${escAttr(c.tip || c.label)}">${escHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.id === 'tBin' ? '' : 'num'}">${escHtml(c.fmt(r))}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr>${cols.map(c => {
      if (c.id === 'tBin')      return `<td title="Сумма по всем бинам"><b>Σ</b></td>`;
      if (c.id === 'hours')     return `<td class="num" title="Σ часов в году ≈ 8766"><b>${totalHours.toFixed(0)}</b></td>`;
      if (c.id === 'days')      return `<td class="num" title="Σ дней в году ≈ 365.25"><b>${totalDays.toFixed(1)}</b></td>`;
      if (c.id === 'pct')       return `<td class="num"><b>100.00</b></td>`;
      if (c.id === 'fcFraction')return `<td class="num" title="Средневзвешенная по часам доля FC в году"><b>${fcAvgPct != null ? fcAvgPct.toFixed(0) : ''}</b></td>`;
      if (c.id === 'energy')    return `<td class="num" title="Годовое суммарное эл. потребление"><b>${totalEnergy.toFixed(0)}</b></td>`;
      return `<td></td>`;
    }).join('')}</tr></tfoot>
  </table>`;
}

/**
 * Пикер столбцов annual-таблицы.
 *
 * @param {Array<string>} activeCols
 * @param {function(string[])} onChange
 * @param {boolean} hasChillerSpec
 */
export function renderColumnPicker(activeCols, onChange, hasChillerSpec = false) {
  const wrap = document.createElement('div');
  wrap.className = 'cl-col-picker';
  wrap.innerHTML = COLUMNS.map(c => {
    const disabled = c.id === 'tBin' || (c.chiller && !hasChillerSpec);
    const note = c.chiller && !hasChillerSpec ? ' <span class="muted">(задайте Chiller/DX spec)</span>' : '';
    return `<label class="cl-col-picker-row" title="${escAttr(c.tip || c.label)}">
      <input type="checkbox" data-col-id="${escAttr(c.id)}" ${activeCols.includes(c.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${escHtml(c.label)}${note}</span>
    </label>`;
  }).join('');
  wrap.addEventListener('change', (e) => {
    if (e.target.matches('input[data-col-id]')) {
      const id = e.target.dataset.colId;
      const next = e.target.checked
        ? [...activeCols, id]
        : activeCols.filter(c => c !== id);
      onChange(next);
    }
  });
  return wrap;
}
