// =============================================================================
// cooling.js — UI orchestrator модуля «Подбор холодильных систем»
// =============================================================================
// Подбор чиллеров/DX-систем + free-cooling + CAPEX/TCO/payback +
// технико-экономическое сравнение нескольких опций.
//
// Использует:
//   • cooling/calc/* — pure-функции расчёта (без DOM, переиспользуемые)
//   • cooling/ui/*   — рендереры (tooltips, формы, чарты)
//   • cooling/meteo-bridge.js — мост к данным meteo (без cross-import)
//
// Состояние модуля:
//   _options  — массив { id, name, spec, eco }
//   _activeId — id активной опции (для табов Spec/Energy/CAPEX)
//   _activeTab
//   _activeCols — настройка отображаемых столбцов annual table
//   _tariffRubKwh — общий тариф для всех опций
//
// Persist в LS под project-storage:
//   raschet.project.<pid>.cooling.options.v1
//   raschet.project.<pid>.cooling.activeId.v1
//   raschet.project.<pid>.cooling.cols.v1
//   raschet.project.<pid>.cooling.tariff.v1

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';
import * as util from '../meteo/util.js';

import { DEFAULT_CHILLER, COLUMNS, DEFAULT_COLS, CHILLER_COLS } from './calc/chiller-defaults.js';
import { buildBinData } from './calc/chiller-bin-calc.js';
import { computeFcSummary } from './calc/fc-summary.js';
import { computeTco, DEFAULT_ECONOMICS, discountedPaybackYears } from './calc/capex-tco.js';
import { compareOptions } from './calc/comparison.js';

import { renderChillerSpecForm } from './ui/chiller-form.js';
import { renderAnnualTable, renderColumnPicker } from './ui/annual-table-view.js';
import { renderFreeCoolingSummary } from './ui/fc-summary-view.js';
import { drawChillerEnergyChart, drawTcoChart } from './ui/energy-chart.js';
import { renderCapexForm, renderTcoKpi } from './ui/capex-form.js';
import { renderComparisonTable } from './ui/comparison-view.js';

import { tableToCsv, downloadCsv } from '../meteo/charts.js';
import { getActiveMeteoDataset, getMeteoFilter, applyFilter } from './meteo-bridge.js';
import { CURRENCIES } from './calc/fc-summary.js';
import { open as openRatesDialog } from '../shared/currency-rates/rates-dialog.js';

const $ = (id) => document.getElementById(id);

let _pid = null;
let _options = [];
let _activeId = null;
let _activeTab = 'spec';
let _activeCols = [...DEFAULT_COLS, ...CHILLER_COLS];
let _tariffRubKwh = 7.5;       // тариф в ВЫБРАННОЙ валюте (не обязательно ₽) — переменная сохранила историческое имя
let _currency = '₽';
let _seq = 1;

const KEY_OPTIONS  = ['cooling', 'options.v1'];
const KEY_ACTIVE   = ['cooling', 'activeId.v1'];
const KEY_COLS     = ['cooling', 'cols.v1'];
const KEY_TARIFF   = ['cooling', 'tariff.v1'];
const KEY_CURRENCY = ['cooling', 'currency.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try { const raw = localStorage.getItem(projectKey(_pid, ...suffix)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}
function persist() {
  saveJson(KEY_OPTIONS,  _options);
  saveJson(KEY_ACTIVE,   _activeId);
  saveJson(KEY_COLS,     _activeCols);
  saveJson(KEY_TARIFF,   _tariffRubKwh);
  saveJson(KEY_CURRENCY, _currency);
}

function activeOption() {
  return _options.find(o => o.id === _activeId) || null;
}

/* ----- Hourly из meteo с применённым фильтром ----- */
function getHourly() {
  const m = getActiveMeteoDataset();
  if (!m) return { hourly: [], dataset: null };
  const filter = getMeteoFilter();
  return { hourly: applyFilter(m.hourly, filter), dataset: m.dataset, filter };
}

/* ----- Sidebar list ----- */
function renderOptionsList() {
  const root = $('cl-options-list');
  if (!root) return;
  if (!_options.length) {
    root.innerHTML = '<div class="muted" style="font-size:11.5px;padding:6px 0">Опций пока нет. Добавьте первую — она станет baseline для сравнения.</div>';
    return;
  }
  root.innerHTML = _options.map((o, i) => {
    const cls = o.id === _activeId ? 'cl-option-row active' : 'cl-option-row';
    const baseline = i === 0 ? ' <span style="color:#16a34a;font-size:10px">★ baseline</span>' : '';
    return `<div class="${cls}" data-id="${util.escAttr(o.id)}">
      <span class="cl-option-name">${util.escHtml(o.name)}${baseline}</span>
      <span class="cl-option-actions">
        <button type="button" data-act="rename" data-id="${util.escAttr(o.id)}" title="Переименовать">✏</button>
        <button type="button" data-act="delete" data-id="${util.escAttr(o.id)}" title="Удалить опцию">🗑</button>
      </span>
      <span class="cl-option-meta" style="grid-column:1/-1">
        ${util.escHtml(o.spec.systemType)} · ${Math.round(o.spec.ratedCapKw)} кВт${o.spec.systemType === 'chiller' ? ' · FC: ' + (o.spec.freeCoolingMode || 'none') : ''}
      </span>
    </div>`;
  }).join('');
}

function renderMeteoStatus() {
  const root = $('cl-meteo-status');
  if (!root) return;
  const m = getActiveMeteoDataset();
  if (!m) {
    root.className = 'cl-meteo-status empty';
    root.textContent = '⚠ Нет meteo-датасетов. Откройте модуль Метеоданные и загрузите хотя бы один.';
    return;
  }
  const filter = getMeteoFilter();
  const total = m.hourly.length;
  const filtered = applyFilter(m.hourly, filter).length;
  let filterDesc;
  if (filter.mode === 'year' && filter.year) filterDesc = `год ${filter.year}`;
  else if (filter.mode === 'period') filterDesc = `${filter.periodFrom || '?'}—${filter.periodTo || '?'}`;
  else filterDesc = 'все годы';
  root.className = 'cl-meteo-status';
  root.innerHTML = `<b>${util.escHtml(m.dataset.name)}</b><br>
    <span style="font-size:11px">${util.escHtml(m.dataset.locationName || '')} · ${filterDesc}</span><br>
    <span style="font-size:11px">${filtered} записей${total !== filtered ? ` из ${total}` : ''}</span>`;
}

/* ----- Active panel ----- */
function renderActive() {
  const opt = activeOption();
  const empty = $('cl-empty');
  const pane = $('cl-active-pane');
  renderMeteoStatus();
  renderOptionsList();
  if (!opt) {
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    $('cl-active-name').textContent = '— нет активной опции —';
    $('cl-active-meta').textContent = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  $('cl-active-name').textContent = opt.name;
  $('cl-active-meta').textContent = `${opt.spec.systemType} · rated ${Math.round(opt.spec.ratedCapKw)} кВт · COP ${opt.spec.ratedCOP}`;
  renderActiveTab();
}

function renderActiveTab() {
  const opt = activeOption();
  if (!opt) return;
  document.querySelectorAll('.cl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
  document.querySelectorAll('.cl-tab-pane').forEach(p => p.hidden = (p.dataset.pane !== _activeTab));

  const { hourly } = getHourly();

  if (_activeTab === 'spec') {
    const wrap = $('cl-spec-form-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      wrap.appendChild(renderChillerSpecForm(opt.spec, (next) => {
        const sysTypeChanged = (opt.spec.systemType || 'chiller') !== (next.systemType || 'chiller');
        opt.spec = next;
        persist();
        if (sysTypeChanged) renderActiveTab();   // re-render форму с новыми секциями
        // Также обновляем sidebar list (там показан тип)
        renderOptionsList();
      }, () => {
        opt.spec = { ...DEFAULT_CHILLER };
        persist();
        renderActiveTab();
        renderOptionsList();
      }));
    }
  } else if (_activeTab === 'energy') {
    const rows = buildBinData(hourly, opt.spec);
    // FC summary
    const fcEl = $('cl-fc-summary');
    if (fcEl) {
      fcEl.innerHTML = (opt.spec && Number(opt.spec.ratedCapKw) > 0)
        ? renderFreeCoolingSummary(rows, opt.spec, _tariffRubKwh, hourly, _currency)
        : '<div class="muted">Задайте Rated capacity > 0 во вкладке ❄ Spec для расчёта.</div>';
    }
    // Chart
    const cvs = $('cl-energy-chart');
    if (cvs) drawChillerEnergyChart(cvs, rows);
    // Table
    const tbl = $('cl-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  } else if (_activeTab === 'capex') {
    const fwrap = $('cl-capex-form-wrap');
    if (fwrap) {
      fwrap.innerHTML = '';
      fwrap.appendChild(renderCapexForm(opt.eco, (next) => {
        opt.eco = next;
        persist();
        renderActiveTab();   // обновить KPI и chart
      }, _currency));
    }
    // Считаем TCO
    const rows = buildBinData(hourly, opt.spec);
    const fc = computeFcSummary(rows, opt.spec, _tariffRubKwh, hourly);
    const tco = computeTco({ annualEnergyKwh: fc ? fc.energyKwh : 0, tariffRubKwh: _tariffRubKwh, eco: opt.eco });
    // Payback относительно baseline (первой опции)
    let payback = null;
    if (_options.length > 1 && _options[0].id !== opt.id) {
      const baseline = _options[0];
      const bRows = buildBinData(hourly, baseline.spec);
      const bFc = computeFcSummary(bRows, baseline.spec, _tariffRubKwh, hourly);
      const bTco = computeTco({ annualEnergyKwh: bFc ? bFc.energyKwh : 0, tariffRubKwh: _tariffRubKwh, eco: baseline.eco });
      payback = discountedPaybackYears(tco, bTco);
    }
    const kpi = $('cl-tco-kpi');
    if (kpi) kpi.innerHTML = renderTcoKpi(tco, payback, _currency);
    // TCO chart по всем опциям
    const cvs = $('cl-tco-chart');
    if (cvs) {
      const allMetrics = compareOptions(_options, hourly, _tariffRubKwh);
      drawTcoChart(cvs, allMetrics);
    }
  } else if (_activeTab === 'compare') {
    const tbl = $('cl-compare-table');
    if (tbl) {
      const metrics = compareOptions(_options, hourly, _tariffRubKwh);
      tbl.innerHTML = renderComparisonTable(metrics, _currency);
    }
  }
}

/* ----- Init ----- */
function init() {
  _pid = ensureDefaultProject();
  _options = loadJson(KEY_OPTIONS, []) || [];
  _activeId = loadJson(KEY_ACTIVE, null);
  _activeCols = loadJson(KEY_COLS, _activeCols);
  const t = Number(loadJson(KEY_TARIFF, null));
  if (Number.isFinite(t) && t >= 0) _tariffRubKwh = t;
  const savedCur = loadJson(KEY_CURRENCY, null);
  if (typeof savedCur === 'string' && savedCur) _currency = savedCur;
  if (_activeId && !_options.some(o => o.id === _activeId)) _activeId = _options[0]?.id || null;
  // Гарантируем уникальность счётчика id
  for (const o of _options) {
    const m = /opt-(\d+)/.exec(o.id);
    if (m) _seq = Math.max(_seq, +m[1] + 1);
  }

  // Валюта select
  const curSel = $('cl-currency');
  if (curSel) {
    curSel.innerHTML = CURRENCIES.map(c =>
      `<option value="${c.code}"${c.code === _currency ? ' selected' : ''} title="${c.label}">${c.code} — ${c.label}</option>`
    ).join('');
    curSel.addEventListener('change', () => {
      _currency = curSel.value || '₽';
      persist();
      renderActiveTab();
    });
  }

  // Тариф input
  const tarInp = $('cl-tariff');
  if (tarInp) {
    tarInp.value = _tariffRubKwh;
    tarInp.addEventListener('change', () => {
      const v = Number(tarInp.value);
      _tariffRubKwh = Number.isFinite(v) && v >= 0 ? v : 0;
      persist();
      renderActiveTab();
    });
  }

  // Кнопка курсов валют
  const ratesBtn = $('cl-rates-btn');
  if (ratesBtn) {
    ratesBtn.addEventListener('click', () => {
      openRatesDialog();
    });
  }

  // Tab navigation
  document.querySelectorAll('.cl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });

  // Add option
  const addBtn = $('cl-add-option');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const base = activeOption();
      const name = await clPrompt('Название новой опции', `Опция ${_options.length + 1}`);
      if (name == null) return;
      const newOpt = {
        id: `opt-${_seq++}`,
        name: (name.trim() || `Опция ${_options.length + 1}`),
        spec: { ...(base ? base.spec : DEFAULT_CHILLER) },
        eco:  { ...(base ? base.eco  : DEFAULT_ECONOMICS) },
      };
      _options.push(newOpt);
      _activeId = newOpt.id;
      persist();
      renderActive();
      util.toast('Опция создана', 'ok');
    });
  }

  // Sidebar list clicks
  $('cl-options-list').addEventListener('click', async (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const id = actBtn.dataset.id;
      const act = actBtn.dataset.act;
      const opt = _options.find(o => o.id === id);
      if (!opt) return;
      if (act === 'rename') {
        const newName = await clPrompt('Новое название', opt.name);
        if (newName == null) return;
        opt.name = newName.trim() || opt.name;
        persist(); renderOptionsList(); renderActive();
      } else if (act === 'delete') {
        const ok = await clConfirm(`Удалить опцию «${opt.name}»?`);
        if (!ok) return;
        _options = _options.filter(o => o.id !== id);
        if (_activeId === id) _activeId = _options[0]?.id || null;
        persist(); renderActive();
      }
      return;
    }
    const row = e.target.closest('.cl-option-row');
    if (row) {
      _activeId = row.dataset.id;
      persist();
      renderActive();
    }
  });

  // Cols picker
  const colsBtn = $('cl-cols-btn');
  if (colsBtn) {
    const wrap = $('cl-col-picker-wrap');
    colsBtn.addEventListener('click', () => {
      if (!wrap) return;
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) {
        const opt = activeOption();
        wrap.innerHTML = '';
        wrap.appendChild(renderColumnPicker(_activeCols, (next) => {
          _activeCols = next;
          persist();
          renderActiveTab();
        }, !!(opt && Number(opt.spec.ratedCapKw) > 0)));
      }
    });
  }

  // Export CSV
  const exportBtn = $('cl-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const opt = activeOption();
      if (!opt) return;
      const { hourly } = getHourly();
      const rows = buildBinData(hourly, opt.spec);
      const cols = COLUMNS.filter(c => _activeCols.includes(c.id));
      const csvRows = [cols.map(c => c.label)];
      for (const r of rows) csvRows.push(cols.map(c => c.fmt(r)));
      const safeName = (opt.name || 'cooling').replace(/[^\w\dА-Яа-я-]+/g, '_');
      downloadCsv(tableToCsv(csvRows), `cooling-${safeName}.csv`);
      util.toast(`CSV сохранён`, 'ok');
    });
  }

  renderActive();
}

function clConfirm(msg) {
  return util.modalOpen('<h3>Подтверждение</h3>', `<p>${util.escHtml(msg)}</p>`, async () => true);
}
function clPrompt(label, def = '') {
  return util.modalOpen('<h3>Ввод значения</h3>',
    `<label>${util.escHtml(label)}:<input type="text" id="cl-prompt-input" value="${util.escAttr(def)}" autofocus></label>`,
    async () => document.getElementById('cl-prompt-input').value);
}

document.addEventListener('DOMContentLoaded', init);
