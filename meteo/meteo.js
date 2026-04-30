// =========================================================================
// meteo.js — v0.59.898 (Etap C, plugin-arch + tabs/charts/annual-table)
//
// Stand-alone модуль метеоданных. Хранит набор «датасетов» (наборов
// почасовых метеоизмерений) внутри активного проекта.
//
// Архитектура:
//   meteo.js              — UI-ядро + tab orchestration.
//   meteo/util.js         — общие утилиты (computeStats, modalOpen, toast).
//   meteo/charts.js       — графики (T-histogram, RH-histogram, monthly-T,
//                           days-in-range matrix).
//   meteo/annual-table.js — annual hours pivot table с column-config + CSV.
//   meteo/station-picker.js — picker метеостанции (список + Leaflet карта).
//   meteo/stations/wmo-list.js — каталог станций.
//   meteo/sources/        — плагины источников. Каждый файл = отдельный
//                           источник, регистрирующийся через registry.
// =========================================================================

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';
import * as util from './util.js';
import { getAll as getSources } from './sources/index.js';
import { drawTempHistogram, drawHumidityHistogram, drawMonthlyTempChart, drawWindRose, renderDaysInRangeTable } from './charts.js';
import { COLUMNS, buildBinData, renderAnnualTable, exportAnnualTableCsv, renderColumnPicker } from './annual-table.js';

const $ = (id) => document.getElementById(id);

let _pid = null;
let _datasets = [];
let _activeId = null;
let _activeTab = 'summary';
let _activeCols = COLUMNS.filter(c => c.default).map(c => c.id);

const KEY_DATA = ['meteo', 'datasets.v1'];
const KEY_ACTIVE = ['meteo', 'activeId.v1'];
const KEY_COLS = ['meteo', 'annualCols.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try { const raw = localStorage.getItem(projectKey(_pid, ...suffix)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}

function persist() {
  saveJson(KEY_DATA, _datasets);
  saveJson(KEY_ACTIVE, _activeId);
  saveJson(KEY_COLS, _activeCols);
}

// ─── Render: sources buttons (генерируется автоматически из registry)
function renderImportButtons() {
  const aside = document.querySelector('.mt-sidebar');
  if (!aside) return;
  const importSection = aside.querySelector('.mt-section:nth-child(2)');
  if (!importSection) return;
  const sources = getSources();
  importSection.innerHTML = `<h3>➕ Импорт</h3>` + sources.map(s =>
    `<button type="button" class="mt-action-btn" data-src-id="${util.escAttr(s.id)}" title="${util.escAttr(s.description || '')}">${util.escHtml(s.label)}</button>`
  ).join('') + (sources.length === 0 ? '<div class="mt-empty-list">Нет зарегистрированных источников.</div>' : '');

  importSection.querySelectorAll('button[data-src-id]').forEach(btn => {
    btn.addEventListener('click', () => importViaSource(btn.dataset.srcId));
  });
}

async function importViaSource(srcId) {
  const sources = getSources();
  const src = sources.find(s => s.id === srcId);
  if (!src) return;
  const ctx = { util };
  const ds = await src.createDataset(ctx);
  if (!ds) return;
  const dataset = {
    id: util.newId('ds'),
    activeForProject: !_datasets.some(d => d.activeForProject),
    createdAt: Date.now(),
    ...ds,
  };
  _datasets.unshift(dataset);
  _activeId = dataset.id;
  persist();
  renderDatasetsList();
  renderActive();
  util.toast(`Загружено ${(ds.hourly || []).length} строк (${ds.stats?.tmin}…${ds.stats?.tmax} °C)`, 'ok');
}

// ─── Render: список датасетов
function renderDatasetsList() {
  const root = $('mt-datasets-list');
  if (!root) return;
  if (!_datasets.length) {
    root.innerHTML = '<div class="mt-empty-list">Нет датасетов.<br>Используйте кнопки ➕ Импорт.</div>';
    return;
  }
  const SRC_ICONS = { 'open-meteo': '🌐', 'rp5': '📥', 'ashrae': '📐', 'manual': '✏' };
  root.innerHTML = _datasets.map(d => {
    const star = d.activeForProject ? '⭐ ' : '';
    const cls = d.id === _activeId ? 'mt-dataset-row active' : 'mt-dataset-row';
    const period = `${d.dateFrom || '?'} … ${d.dateTo || '?'}`;
    const srcIcon = SRC_ICONS[d.source] || '📊';
    return `<div class="${cls}" data-id="${util.escAttr(d.id)}">
      <span class="mt-dataset-name">${star}${util.escHtml(d.name)}</span>
      <span class="mt-dataset-meta">${srcIcon} ${util.escHtml(d.source)} · ${util.escHtml(period)}</span>
      <span class="mt-dataset-actions">
        <button type="button" data-act="activate" data-id="${util.escAttr(d.id)}" title="Сделать активным для проекта">⭐</button>
        <button type="button" data-act="rename" data-id="${util.escAttr(d.id)}" title="Переименовать">✏</button>
        <button type="button" data-act="delete" data-id="${util.escAttr(d.id)}" title="Удалить">🗑</button>
      </span>
    </div>`;
  }).join('');
}

// ─── Render: активный датасет
function renderActive() {
  const d = _datasets.find(x => x.id === _activeId);
  const empty = $('mt-empty');
  const pane = $('mt-active-pane');
  if (!d) {
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    $('mt-active-name').textContent = '— нет датасета —';
    $('mt-active-meta').textContent = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  const star = d.activeForProject ? ' ⭐' : '';
  $('mt-active-name').textContent = d.name + star;
  $('mt-active-meta').textContent = `${d.locationName || ''} · ${d.lat ? d.lat.toFixed(3) : '—'}, ${d.lon ? d.lon.toFixed(3) : '—'}${d.stationId ? ' · ICAO ' + d.stationId : ''} · ${d.dateFrom || ''}—${d.dateTo || ''} · ${(d.hourly || []).length} записей`;

  const s = d.stats || util.computeStats(d.hourly || []);
  $('mt-kpi-tmean').textContent = `${s.tmean} °C`;
  $('mt-kpi-tmin').textContent = `${s.tmin} °C`;
  $('mt-kpi-tmax').textContent = `${s.tmax} °C`;
  $('mt-kpi-t99').textContent = `${s.t99} °C`;
  $('mt-kpi-fc').textContent = `${s.freecoolHours} ч`;
  $('mt-kpi-n').textContent = `${s.n}`;

  // Сразу рендерим текущий tab
  renderActiveTab();
}

function renderActiveTab() {
  const d = _datasets.find(x => x.id === _activeId);
  if (!d) return;
  document.querySelectorAll('.mt-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
  document.querySelectorAll('.mt-tab-pane').forEach(p => p.hidden = (p.dataset.pane !== _activeTab));

  if (_activeTab === 'summary') {
    const cvs = $('mt-hist-canvas');
    if (cvs) drawTempHistogram(cvs, d.hourly || []);
    drawSummary(d, d.stats || util.computeStats(d.hourly || []));
  } else if (_activeTab === 'charts') {
    const cvsRH = $('mt-rh-canvas');
    if (cvsRH) drawHumidityHistogram(cvsRH, d.hourly || []);
    const cvsM = $('mt-monthly-canvas');
    if (cvsM) drawMonthlyTempChart(cvsM, d.hourly || []);
    const cvsW = $('mt-windrose-canvas');
    if (cvsW) drawWindRose(cvsW, d.hourly || []);
    const pivot = $('mt-pivot-table');
    if (pivot) pivot.innerHTML = renderDaysInRangeTable(d.hourly || []);
  } else if (_activeTab === 'annual') {
    const rows = buildBinData(d.hourly || []);
    const tbl = $('mt-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  } else if (_activeTab === 'ashrae') {
    renderAshraeBlock(d);
  }
}

function drawSummary(d, s) {
  const sum = $('mt-summary');
  if (!sum) return;
  const cdd = (d.hourly || []).reduce((acc, h) => acc + Math.max(0, (Number(h.T) || 0) - 18), 0) / 24;
  const hdd = (d.hourly || []).reduce((acc, h) => acc + Math.max(0, 18 - (Number(h.T) || 0)), 0) / 24;
  const sortedT = [...(d.hourly || []).map(h => Number(h.T)).filter(Number.isFinite)].sort((a, b) => a - b);
  const t1 = sortedT.length ? sortedT[Math.floor(sortedT.length * 0.01)] : '—';
  sum.innerHTML = `<table>
    <tbody>
      <tr><th>Источник</th><td>${util.escHtml(d.source)}</td></tr>
      <tr><th>Локация</th><td>${util.escHtml(d.locationName || '')} (${d.lat?.toFixed(3) || '—'}, ${d.lon?.toFixed(3) || '—'})</td></tr>
      <tr><th>Период</th><td>${util.escHtml(d.dateFrom || '')} — ${util.escHtml(d.dateTo || '')}</td></tr>
      <tr><th>HDD (база 18 °C)</th><td class="num">${hdd.toFixed(0)} °C·сут</td></tr>
      <tr><th>CDD (база 18 °C)</th><td class="num">${cdd.toFixed(0)} °C·сут</td></tr>
      <tr><th>Часы FreeCool (T &lt; 14 °C)</th><td class="num">${s.freecoolHours} ч (${(s.freecoolHours / Math.max(1, s.n) * 100).toFixed(1)}%)</td></tr>
      <tr><th>T 1% (≈ tmin расчётная)</th><td class="num">${typeof t1 === 'number' ? t1.toFixed(1) : t1} °C</td></tr>
    </tbody>
  </table>`;
}

function renderAshraeBlock(d) {
  const block = $('mt-ashrae-block');
  if (!block) return;
  const ash = d.stats?.ashraeDesign;
  if (!ash) {
    block.innerHTML = `<p class="muted">ASHRAE design conditions для этого датасета не вычислены. Загружайте данные через источник <b>📐 ASHRAE</b> (10 лет архива по выбранной станции) — расчёт делается автоматически.</p>
      <p class="muted" style="font-size:11.5px">Текущий датасет: <code>${util.escHtml(d.source)}</code> (${(d.hourly || []).length} записей). Если данных ≥ 5 лет, можно выполнить расчёт прямо сейчас:</p>
      <button type="button" class="mt-btn-primary" id="mt-ashrae-compute">📐 Вычислить design-условия из текущих данных</button>`;
    const btn = block.querySelector('#mt-ashrae-compute');
    if (btn) btn.addEventListener('click', async () => {
      const m = await import('./sources/ashrae.js');
      // ashrae.js не экспортирует computeAshraeDesign публично — для inline-расчёта
      // вызываем общий percentile-помощник из ниже:
      const ds = computeAshraeFromHourly(d.hourly);
      d.stats.ashraeDesign = ds;
      persist();
      renderActiveTab();
    });
    return;
  }
  block.innerHTML = `
    <p class="muted">Расчётные условия по ASHRAE HoF гл. 14, рассчитаны из ${ash.nYears || '?'} лет почасовых данных. MCWB — coincident wet-bulb, MCDP — coincident dew-point.</p>
    <h4>Heating (зимний расчёт)</h4>
    <table class="mt-ashrae-table">
      <thead><tr><th>Перцентиль</th><th class="num">T<sub>db</sub>, °C</th><th class="num">MCWB, °C</th><th class="num">MCDP, °C</th></tr></thead>
      <tbody>
        <tr><td><b>99.6%</b> (extreme)</td><td class="num">${fmt(ash.heating?.pct99_6?.Tdb)}</td><td class="num">${fmt(ash.heating?.pct99_6?.MCWB)}</td><td class="num">${fmt(ash.heating?.pct99_6?.MCDP)}</td></tr>
        <tr><td><b>99%</b> (typical)</td><td class="num">${fmt(ash.heating?.pct99_0?.Tdb)}</td><td class="num">${fmt(ash.heating?.pct99_0?.MCWB)}</td><td class="num">${fmt(ash.heating?.pct99_0?.MCDP)}</td></tr>
      </tbody>
    </table>
    <h4>Cooling (летний расчёт)</h4>
    <table class="mt-ashrae-table">
      <thead><tr><th>Перцентиль</th><th class="num">T<sub>db</sub>, °C</th><th class="num">MCWB, °C</th><th class="num">MCDP, °C</th></tr></thead>
      <tbody>
        <tr><td><b>0.4%</b> (peak)</td><td class="num">${fmt(ash.cooling?.pct0_4?.Tdb)}</td><td class="num">${fmt(ash.cooling?.pct0_4?.MCWB)}</td><td class="num">${fmt(ash.cooling?.pct0_4?.MCDP)}</td></tr>
        <tr><td><b>1%</b></td><td class="num">${fmt(ash.cooling?.pct1_0?.Tdb)}</td><td class="num">${fmt(ash.cooling?.pct1_0?.MCWB)}</td><td class="num">${fmt(ash.cooling?.pct1_0?.MCDP)}</td></tr>
        <tr><td><b>2%</b></td><td class="num">${fmt(ash.cooling?.pct2_0?.Tdb)}</td><td class="num">${fmt(ash.cooling?.pct2_0?.MCWB)}</td><td class="num">${fmt(ash.cooling?.pct2_0?.MCDP)}</td></tr>
      </tbody>
    </table>
    <p class="muted" style="font-size:11.5px;margin-top:10px">⚠ Значения вычислены по public Open-Meteo historical data (1940→present), не из официальных ASHRAE Handbook таблиц (paywalled). Методика — стандартные перцентили T<sub>db</sub> по ряду; MCWB — упрощённая Stull 2011.</p>`;

  function fmt(v) { return v == null ? '—' : Number(v).toFixed(1); }
}

function computeAshraeFromHourly(hourly) {
  // Inline-копия из sources/ashrae.js для on-demand расчёта на любых данных
  const validIdx = hourly.map((h, i) => Number.isFinite(Number(h.T)) ? i : -1).filter(i => i >= 0);
  if (!validIdx.length) return null;
  const sortedByT = [...validIdx].sort((a, b) => hourly[a].T - hourly[b].T);
  const N = sortedByT.length;
  const at = (frac) => hourly[sortedByT[Math.max(0, Math.min(N - 1, Math.floor(N * frac)))]];
  const wetBulb = (T, RH) => {
    if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
    const Tw = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659))
      + Math.atan(T + RH) - Math.atan(RH - 1.676331)
      + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
    return Math.round(Tw * 10) / 10;
  };
  const fmt = (h) => h ? {
    Tdb: Math.round(h.T * 10) / 10,
    MCWB: wetBulb(h.T, h.RH),
    MCDP: Number.isFinite(Number(h.dewPoint)) ? Math.round(h.dewPoint * 10) / 10 : null,
  } : null;
  return {
    nYears: Math.round(N / (24 * 365)),
    heating: { pct99_6: fmt(at(0.004)), pct99_0: fmt(at(0.010)) },
    cooling: { pct0_4: fmt(at(0.996)), pct1_0: fmt(at(0.990)), pct2_0: fmt(at(0.980)) },
  };
}

// ─── Init
function init() {
  _pid = ensureDefaultProject();
  _datasets = loadJson(KEY_DATA, []) || [];
  _activeId = loadJson(KEY_ACTIVE, null);
  _activeCols = loadJson(KEY_COLS, _activeCols);
  if (_activeId && !_datasets.some(d => d.id === _activeId)) _activeId = _datasets[0]?.id || null;

  renderImportButtons();
  renderDatasetsList();
  renderActive();

  $('mt-datasets-list').addEventListener('click', async (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const id = actBtn.dataset.id;
      const act = actBtn.dataset.act;
      if (act === 'activate') {
        for (const d of _datasets) d.activeForProject = (d.id === id);
        persist(); renderDatasetsList(); renderActive();
        util.toast('Датасет помечен ⭐ для проекта', 'ok');
      } else if (act === 'rename') {
        const d = _datasets.find(x => x.id === id);
        if (!d) return;
        const newName = await mtPrompt('Новое название', d.name);
        if (newName == null) return;
        d.name = newName.trim() || d.name;
        persist(); renderDatasetsList(); renderActive();
      } else if (act === 'delete') {
        const ok = await mtConfirm(`Удалить датасет «${_datasets.find(x => x.id === id)?.name}»?`);
        if (!ok) return;
        _datasets = _datasets.filter(d => d.id !== id);
        if (_activeId === id) _activeId = _datasets[0]?.id || null;
        persist(); renderDatasetsList(); renderActive();
      }
      return;
    }
    const row = e.target.closest('.mt-dataset-row');
    if (row) {
      _activeId = row.dataset.id;
      persist();
      renderDatasetsList(); renderActive();
    }
  });

  // Tab navigation
  document.querySelectorAll('.mt-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });

  // Annual hours toolbar
  const colsBtn = $('mt-cols-btn');
  if (colsBtn) {
    const wrap = $('mt-col-picker-wrap');
    colsBtn.addEventListener('click', () => {
      if (!wrap) return;
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden && !wrap.children.length) {
        wrap.appendChild(renderColumnPicker(_activeCols, (next) => {
          _activeCols = next;
          persist();
          // Re-render текущей таблицы
          const d = _datasets.find(x => x.id === _activeId);
          if (d) {
            const rows = buildBinData(d.hourly || []);
            const tbl = $('mt-annual-table');
            if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
          }
        }));
      }
    });
  }
  const exportBtn = $('mt-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const d = _datasets.find(x => x.id === _activeId);
      if (!d) return;
      const rows = buildBinData(d.hourly || []);
      const fname = `meteo-annual-${(d.locationName || 'export').replace(/[^\w\dА-Яа-я-]+/g, '_')}.csv`;
      exportAnnualTableCsv(rows, _activeCols, fname);
      util.toast(`CSV сохранён: ${fname}`, 'ok');
    });
  }
}

function mtConfirm(msg, title = 'Подтверждение') {
  return util.modalOpen(`<h3>${util.escHtml(title)}</h3>`, `<p>${util.escHtml(msg)}</p>`, async () => true);
}
function mtPrompt(label, def = '') {
  return util.modalOpen(`<h3>Ввод значения</h3>`,
    `<label>${util.escHtml(label)}:<input type="text" id="mt-prompt-input" value="${util.escAttr(def)}" autofocus></label>`,
    async () => {
      const val = document.getElementById('mt-prompt-input').value;
      return val;
    });
}

document.addEventListener('DOMContentLoaded', init);
