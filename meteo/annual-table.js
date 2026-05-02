// meteo/annual-table.js — v0.59.991
// Pivot-таблица бинов Ambient T °C × агрегаты (часы/год, дни/год, RH/wind).
// Колонки настраиваются. Экспорт в CSV (Excel-совместимый, с BOM).
//
// История: до v0.59.991 здесь жила вся логика chiller/DX расчёта
// (capacity, COP, FC, energy, FC summary, chiller spec form). Перенесена
// в отдельный модуль /cooling — meteo теперь работает только с
// климатическими данными, оставляя расчёт оборудования другому модулю.

import { escHtml, escAttr } from './util.js';
import { tableToCsv, downloadCsv } from './charts.js';

/**
 * Метаданные климатических столбцов pivot-таблицы.
 * tip = расширенное описание для tooltip.
 */
export const COLUMNS = [
  { id: 'tBin',     label: 'Темп. наружн. возд., °C',
    tip: 'Интервал температуры наружного воздуха (по сухому термометру), целое число °C. Записи группируются по floor(T) — например, в строку «5» попадают часы с T от 5.0 до 5.9999°C.',
    default: true,  fmt: v => v.tBin },
  { id: 'hours',    label: 'Часов в году',
    tip: 'Сколько часов в году температура попадала в этот интервал. Σ по всем строкам = 8766 (365.25 × 24). Масштабируется к 1 году исходя из объёма выборки.',
    default: true,  fmt: v => v.hours.toFixed(0) },
  { id: 'days',     label: 'Дней в году',
    tip: 'Сколько дней в году = часов / 24.',
    default: true,  fmt: v => v.days.toFixed(2) },
  { id: 'pct',      label: '% года',
    tip: 'Доля года = часов / 8766 × 100. Плотность распределения температуры.',
    default: false, fmt: v => v.pct.toFixed(2) },
  { id: 'rhAvg',    label: 'Средн. RH, %',
    tip: 'Средняя относительная влажность в этом интервале температуры.',
    default: true,  fmt: v => v.rhAvg != null ? v.rhAvg.toFixed(0) : '' },
  { id: 'rhMin',    label: 'Мин. RH, %',
    tip: 'Минимальная относительная влажность в интервале.',
    default: false, fmt: v => v.rhMin != null ? v.rhMin.toFixed(0) : '' },
  { id: 'rhMax',    label: 'Макс. RH, %',
    tip: 'Максимальная относительная влажность в интервале.',
    default: false, fmt: v => v.rhMax != null ? v.rhMax.toFixed(0) : '' },
  { id: 'windAvg',  label: 'Средн. ветер, м/с',
    tip: 'Средняя скорость ветра в этом интервале температуры. Косвенно влияет на эффективность air-cooled конденсаторов.',
    default: false, fmt: v => v.windAvg != null ? v.windAvg.toFixed(1) : '' },
  { id: 'cumPct',   label: 'Кумул. %',
    tip: 'Кумулятивный процент года (от низких T к высоким). Помогает оценить «сколько времени T ≤ X».',
    default: false, fmt: v => v.cumPct.toFixed(1) },
];

export const DEFAULT_COLS = COLUMNS.filter(c => c.default).map(c => c.id);

/**
 * Bin данные по hourly: T → { hours, days, rhAvg, rhMin, rhMax, windAvg, ... }
 */
export function buildBinData(hourly) {
  if (!hourly || !hourly.length) return [];
  const totalRecords = hourly.filter(h => Number.isFinite(Number(h.T))).length;
  const yearScale = totalRecords > 0 ? (8766 / totalRecords) : 1;  // 8766 = 365.25 × 24
  const map = new Map();
  for (const h of hourly) {
    const T = Number(h.T);
    if (!Number.isFinite(T)) continue;
    const tBin = Math.floor(T);
    let acc = map.get(tBin);
    if (!acc) {
      acc = { tBin, count: 0, rhSum: 0, rhN: 0, rhMin: Infinity, rhMax: -Infinity, windSum: 0, windN: 0 };
      map.set(tBin, acc);
    }
    acc.count++;
    const RH = Number(h.RH);
    if (Number.isFinite(RH)) {
      acc.rhSum += RH; acc.rhN++;
      if (RH < acc.rhMin) acc.rhMin = RH;
      if (RH > acc.rhMax) acc.rhMax = RH;
    }
    const W = Number(h.wind);
    if (Number.isFinite(W)) { acc.windSum += W; acc.windN++; }
  }
  const rows = [...map.values()].sort((a, b) => a.tBin - b.tBin);
  let cum = 0;
  return rows.map(acc => {
    const hours = acc.count * yearScale;
    const days = hours / 24;
    const pct = (hours / 8766) * 100;
    cum += pct;
    return {
      tBin: acc.tBin,
      hours, days, pct, cumPct: cum,
      rhAvg: acc.rhN > 0 ? acc.rhSum / acc.rhN : null,
      rhMin: acc.rhN > 0 ? acc.rhMin : null,
      rhMax: acc.rhN > 0 ? acc.rhMax : null,
      windAvg: acc.windN > 0 ? acc.windSum / acc.windN : null,
    };
  });
}

/**
 * HTML pivot-таблицы. Tooltip на каждом th.
 */
export function renderAnnualTable(rows, activeCols) {
  const cols = COLUMNS.filter(c => activeCols.includes(c.id));
  if (!rows.length) return '<div class="muted">Нет данных.</div>';
  let totalHours = 0, totalDays = 0;
  for (const r of rows) { totalHours += r.hours; totalDays += r.days; }
  return `<table class="mt-annual-table">
    <thead><tr>${cols.map(c => `<th class="${c.id === 'tBin' ? '' : 'num'}" title="${escAttr(c.tip || c.label)}">${escHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.id === 'tBin' ? '' : 'num'}">${escHtml(c.fmt(r))}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr>${cols.map(c => {
      if (c.id === 'tBin') return `<td title="Сумма по всем бинам"><b>Σ</b></td>`;
      if (c.id === 'hours') return `<td class="num" title="Σ часов ≈ 8766"><b>${totalHours.toFixed(0)}</b></td>`;
      if (c.id === 'days') return `<td class="num" title="Σ дней ≈ 365.25"><b>${totalDays.toFixed(1)}</b></td>`;
      if (c.id === 'pct') return `<td class="num"><b>100.00</b></td>`;
      return `<td></td>`;
    }).join('')}</tr></tfoot>
  </table>`;
}

export function exportAnnualTableCsv(rows, activeCols, filename = 'annual-hours.csv') {
  const cols = COLUMNS.filter(c => activeCols.includes(c.id));
  const csvRows = [cols.map(c => c.label)];
  for (const r of rows) csvRows.push(cols.map(c => c.fmt(r)));
  downloadCsv(tableToCsv(csvRows), filename);
}

/**
 * Picker столбцов pivot-таблицы. Tooltip на каждом checkbox.
 *
 * @param {Array<string>} activeCols
 * @param {function(string[])} onChange
 * @param {boolean} hasChillerSpec — игнорируется (climate-only). Параметр
 *                  оставлен для backward-compat сигнатуры.
 */
export function renderColumnPicker(activeCols, onChange, hasChillerSpec = false) {
  const wrap = document.createElement('div');
  wrap.className = 'mt-col-picker';
  wrap.innerHTML = COLUMNS.map(c => {
    const disabled = c.id === 'tBin';
    return `<label class="mt-col-picker-row" title="${escAttr(c.tip || c.label)}">
      <input type="checkbox" data-col-id="${escAttr(c.id)}" ${activeCols.includes(c.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${escHtml(c.label)}</span>
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
