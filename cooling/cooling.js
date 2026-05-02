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

import { ensureDefaultProject, projectKey, listProjects } from '../shared/project-storage.js';
import * as util from '../meteo/util.js';

import { DEFAULT_CHILLER, COLUMNS, DEFAULT_COLS, CHILLER_COLS } from './calc/chiller-defaults.js';
import { buildBinData } from './calc/chiller-bin-calc.js';
import { computeFcSummary } from './calc/fc-summary.js';
import { computeTco, DEFAULT_ECONOMICS, discountedPaybackYears, convertEcoToCurrency } from './calc/capex-tco.js';
import { compareOptions } from './calc/comparison.js';

import { renderChillerSpecForm } from './ui/chiller-form.js';
import { renderAnnualTable, renderColumnPicker } from './ui/annual-table-view.js';
import { renderFreeCoolingSummary } from './ui/fc-summary-view.js';
import { drawChillerEnergyChart, drawTcoChart } from './ui/energy-chart.js';
import { renderCapexForm, renderTcoKpi } from './ui/capex-form.js';
import { renderComparisonTable } from './ui/comparison-view.js';
import { buildTopologyFromOptions, simulateTopology, DEFAULT_TOPOLOGY } from './calc/topology.js';
import { renderTopologyConfig, renderTopologyResults } from './ui/topology-view.js';

import { tableToCsv, downloadCsv } from '../meteo/charts.js';
import { getActiveMeteoDataset, getMeteoFilter, applyFilter } from './meteo-bridge.js';
import { CURRENCIES, currencyToIso } from './calc/fc-summary.js';
import { open as openRatesDialog } from '../shared/currency-rates/rates-dialog.js';
import { fetchRates, convert as convertRate } from '../shared/currency-rates/index.js';
import '../shared/currency-rates/sources/index.js';
import { detectNavMode, renderModuleActions } from '../shared/module-nav.js';

const $ = (id) => document.getElementById(id);

/* v0.59.995: модель данных
 * Cooling может работать в двух режимах хранения (определяется через
 * URL ?standalone=1 либо явный флаг в LS):
 *
 *   1) PROJECT mode (default) — данные привязаны к activeProject.
 *      LS-ключ: raschet.project.<pid>.cooling.<key>
 *
 *   2) STANDALONE mode — данные общие, без привязки к проекту.
 *      LS-ключ: raschet.cooling.standalone.<key>
 *
 * Структура данных в обоих режимах:
 *   _selections: [
 *     { id, name, mainOptionId, activeOptionId, options: [
 *       { id, name, spec, eco }     // eco.currency = native валюта
 *     ]}
 *   ]
 *
 * В одном проекте может быть несколько подборов (разные системы — например
 * «Чиллер для серверной A» и «DX для офиса B»). В каждом подборе несколько
 * опций (вариантов оборудования), одна — основная. Не-основные можно
 * удалять. Удалить основную нельзя — нужно сначала перевыбрать main.
 */
let _pid = null;             // project object (или null в standalone)
let _standalone = false;     // режим хранения = standalone
let _navMode = null;         // 'standalone' | 'embed' | 'project' (см. shared/module-nav.js)
let _navReturn = null;       // { path, sessionId, label } для embed-mode
let _selections = [];        // массив подборов
let _activeSelectionId = null;
let _activeTab = 'spec';
let _activeCols = [...DEFAULT_COLS, ...CHILLER_COLS];
let _tariffRubKwh = 7.5;     // тариф в _currency (валюта проекта)
let _currency = '₽';
let _seq = 1;
let _selSeq = 1;

// v0.59.994: кеш курсов на текущую calcDate (по умолчанию today). Загружается
// фоновым запросом при первом render. convertFn() возвращает конвертер
// (amount, fromIso, toIso) → number, или null если курсы недоступны.
let _ratesCache = null;        // { date, base, rates } последняя загруженная сводка
let _ratesLoading = false;
async function ensureRatesLoaded() {
  if (_ratesCache || _ratesLoading) return;
  _ratesLoading = true;
  try { _ratesCache = await fetchRates(null, null, false); }
  catch (e) { /* offline / CORS — eco отображается без конвертации */ }
  finally { _ratesLoading = false; }
}
function makeConvertFn() {
  if (!_ratesCache) return null;
  return (amount, fromIso, toIso) => convertRate(amount, fromIso, toIso, _ratesCache);
}

// v0.59.995: новые ключи хранения «подборов».
// Старые KEY_OPTIONS / KEY_ACTIVE используются для миграции legacy-данных.
const KEY_SELECTIONS    = ['cooling', 'selections.v1'];
const KEY_ACTIVE_SEL    = ['cooling', 'activeSelectionId.v1'];
const KEY_COLS          = ['cooling', 'cols.v1'];
const KEY_TARIFF        = ['cooling', 'tariff.v1'];
const KEY_CURRENCY      = ['cooling', 'currency.v1'];
const LEGACY_KEY_OPTS   = ['cooling', 'options.v1'];
const LEGACY_KEY_ACTIVE = ['cooling', 'activeId.v1'];

/* В standalone-режиме project-storage не используется — хранимся под
   raschet.cooling.standalone.<module>.<key> чтобы не мешать project-data. */
function storageKey(suffix) {
  if (_standalone) {
    return `raschet.cooling.standalone.${suffix.join('.')}`;
  }
  return projectKey(_pid, ...suffix);
}
function loadJson(suffix, fallback) {
  try { const raw = localStorage.getItem(storageKey(suffix)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveJson(suffix, value) {
  try { localStorage.setItem(storageKey(suffix), JSON.stringify(value)); } catch {}
}
function persist() {
  saveJson(KEY_SELECTIONS, _selections);
  saveJson(KEY_ACTIVE_SEL, _activeSelectionId);
  saveJson(KEY_COLS,       _activeCols);
  saveJson(KEY_TARIFF,     _tariffRubKwh);
  saveJson(KEY_CURRENCY,   _currency);
}

/* ----- Активный подбор / опция ----- */
function activeSelection() {
  return _selections.find(s => s.id === _activeSelectionId) || null;
}
function activeOption() {
  const sel = activeSelection();
  if (!sel) return null;
  return sel.options.find(o => o.id === sel.activeOptionId)
      || sel.options[0]
      || null;
}
function makeNewSelection(name) {
  const sel = {
    id: `sel-${_selSeq++}`,
    name: name || `Подбор ${_selections.length + 1}`,
    mainOptionId: null,
    activeOptionId: null,
    options: [],
  };
  return sel;
}
function makeNewOption(name, baseSpec, baseEco) {
  return {
    id: `opt-${_seq++}`,
    name: name || 'Новая опция',
    spec: { ...(baseSpec || DEFAULT_CHILLER) },
    eco:  { ...(baseEco || DEFAULT_ECONOMICS), currency: (baseEco?.currency || _currency) },
  };
}

// Удалены: legacy activeOption() (см. новую выше).

/* ----- Hourly из meteo с применённым фильтром ----- */
function getHourly() {
  const m = getActiveMeteoDataset();
  if (!m) return { hourly: [], dataset: null };
  const filter = getMeteoFilter();
  return { hourly: applyFilter(m.hourly, filter), dataset: m.dataset, filter };
}

/* ----- Sidebar: list of selections with nested options ----- */
function renderSelectionsList() {
  const root = $('cl-options-list');
  if (!root) return;
  if (!_selections.length) {
    root.innerHTML = '<div class="muted" style="font-size:11.5px;padding:6px 0">Подборов пока нет. Кнопка «+ Добавить подбор» — создаст первый. В подборе можно держать несколько вариантов оборудования для сравнения.</div>';
    return;
  }
  const html = [];
  for (const sel of _selections) {
    const selActive = sel.id === _activeSelectionId;
    const selCls = selActive ? 'cl-sel-row active' : 'cl-sel-row';
    html.push(`<div class="cl-sel-block">
      <div class="${selCls}" data-act-sel="activate" data-sel-id="${util.escAttr(sel.id)}">
        <span class="cl-sel-name" title="${util.escHtml(sel.name)} — кликните чтобы сделать подбор активным.">📋 ${util.escHtml(sel.name)}</span>
        <span class="cl-sel-actions">
          <button type="button" data-act-sel="rename" data-sel-id="${util.escAttr(sel.id)}" title="Переименовать подбор">✏</button>
          <button type="button" data-act-sel="delete" data-sel-id="${util.escAttr(sel.id)}" title="Удалить подбор со всеми вариантами">🗑</button>
        </span>
        <span class="cl-sel-meta" style="grid-column:1/-1">
          ${sel.options.length} вариант${(sel.options.length === 1) ? '' : (sel.options.length >= 2 && sel.options.length <= 4 ? 'а' : 'ов')}
        </span>
      </div>`);
    if (selActive) {
      if (!sel.options.length) {
        html.push('<div class="muted" style="font-size:11px;padding:4px 14px">Вариантов нет. Кнопка «+ Добавить вариант» ниже добавит первый.</div>');
      } else {
        for (const o of sel.options) {
          const isMain = sel.mainOptionId === o.id;
          const isActiveOpt = sel.activeOptionId === o.id;
          const cls = `cl-option-row${isActiveOpt ? ' active' : ''}${isMain ? ' main' : ''}`;
          const mainBadge = isMain ? '<span class="cl-main-badge" title="Основной вариант — нельзя удалить пока не выбран другой основной. Используется как baseline для расчёта payback в сравнении.">★ основной</span>' : '';
          html.push(`<div class="${cls}" data-opt-id="${util.escAttr(o.id)}">
            <span class="cl-option-name" title="Кликните чтобы открыть этот вариант в табах справа.">${util.escHtml(o.name)} ${mainBadge}</span>
            <span class="cl-option-actions">
              ${isMain ? '' : `<button type="button" data-act-opt="setmain" data-opt-id="${util.escAttr(o.id)}" title="Сделать основным вариантом подбора (заменит ★ метку, защитит от удаления)">★</button>`}
              <button type="button" data-act-opt="rename" data-opt-id="${util.escAttr(o.id)}" title="Переименовать вариант">✏</button>
              ${isMain ? `<button type="button" data-act-opt="delete-blocked" title="Нельзя удалить основной вариант. Сначала сделайте основным другой вариант через ★." disabled style="opacity:0.4;cursor:not-allowed">🗑</button>`
                       : `<button type="button" data-act-opt="delete" data-opt-id="${util.escAttr(o.id)}" title="Удалить вариант">🗑</button>`}
            </span>
            <span class="cl-option-meta" style="grid-column:1/-1">
              ${util.escHtml(o.spec.systemType)} · ${Math.round(o.spec.ratedCapKw)} кВт${o.spec.systemType === 'chiller' ? ' · FC: ' + (o.spec.freeCoolingMode || 'none') : ''}
            </span>
          </div>`);
        }
      }
    }
    html.push('</div>');
  }
  root.innerHTML = html.join('');
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
  const sel = activeSelection();
  const opt = activeOption();
  const empty = $('cl-empty');
  const pane = $('cl-active-pane');
  renderMeteoStatus();
  renderSelectionsList();
  renderStorageMode();
  renderModuleActionsHere();
  if (!sel || !opt) {
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    $('cl-active-name').textContent = sel
      ? `📋 ${sel.name} — нет активного варианта`
      : '— нет активного подбора —';
    $('cl-active-meta').textContent = sel
      ? 'Добавьте вариант оборудования через «+ Добавить вариант» или выберите существующий слева.'
      : 'Создайте подбор через «+ Добавить подбор» в боковой панели.';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  const isMain = sel.mainOptionId === opt.id ? ' ★' : '';
  $('cl-active-name').textContent = `📋 ${sel.name} → ${opt.name}${isMain}`;
  $('cl-active-meta').textContent = `${opt.spec.systemType} · rated ${Math.round(opt.spec.ratedCapKw)} кВт · COP ${opt.spec.ratedCOP}`;
  renderActiveTab();
}

function renderStorageMode() {
  const el = $('cl-storage-mode');
  if (!el) return;
  if (_navMode === 'embed' && _navReturn) {
    el.innerHTML = `<span title="Embed-режим: модуль вызван из «${util.escAttr(_navReturn.label)}». Сделайте подбор и нажмите «✓ Применить и вернуться» в правом верхнем углу.">🔗 Embed: вернуться в <b>${util.escHtml(_navReturn.label)}</b></span>`;
    return;
  }
  if (_standalone) {
    // v0.59.997: в standalone-режиме показываем кнопку «📤 Сохранить в проект»
    // только если в системе есть хотя бы один проект (модуль Проекты доступен).
    let projAvail = false;
    try { projAvail = (listProjects() || []).length > 0; } catch {}
    el.innerHTML = `
      <span title="Standalone-режим: данные хранятся в общем разделе LocalStorage без привязки к проекту. Используйте если открыли модуль из закладки/прямой ссылки без активного проекта.">🔓 Standalone</span>
      ${projAvail
        ? `<button type="button" id="cl-save-to-project" style="display:block;width:100%;margin-top:6px;padding:5px 8px;font-size:11.5px;background:#1e40af;color:#fff;border:none;border-radius:3px;cursor:pointer" title="Скопировать активный подбор в выбранный проект. После сохранения вы можете перейти в проект и продолжить работу там.">📤 Сохранить активный подбор в проект</button>`
        : `<div class="muted" style="font-size:10.5px;margin-top:4px" title="Модуль «Проекты» не активен или не имеет проектов. Создайте проект через главное меню чтобы переносить подборы между сессиями.">💡 Создайте проект (через Hub) для сохранения подборов в проект</div>`
      }
    `;
    const btn = el.querySelector('#cl-save-to-project');
    if (btn) btn.addEventListener('click', saveActiveSelectionToProject);
    return;
  }
  const projName = (_pid && _pid.name) || 'default';
  el.innerHTML = `<span title="Project-режим: данные привязаны к активному проекту «${util.escAttr(projName)}». Все подборы будут сохранены в проекте.">💼 Проект: <b>${util.escHtml(projName)}</b></span>`;
}

/* v0.59.997: копирование активного standalone-подбора в выбранный проект.
   Открывает picker проектов; на выбор — записывает selection в LS-bucket
   проекта; опционально перенаправляет в project-mode cooling. */
async function saveActiveSelectionToProject() {
  const sel = activeSelection();
  if (!sel) { util.toast('Нет активного подбора для сохранения.', 'err'); return; }
  let projects = [];
  try { projects = listProjects() || []; } catch {}
  if (!projects.length) { util.toast('Нет доступных проектов. Создайте проект через Hub.', 'err'); return; }

  // Простой select-picker через modalOpen
  const html = `
    <label>Проект назначения:
      <select id="cl-save-proj-sel" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
        ${projects.map(p => `<option value="${util.escAttr(p.id)}">${util.escHtml(p.name || p.id)}</option>`).join('')}
      </select>
    </label>
    <p class="muted" style="font-size:11.5px;margin:8px 0 0">
      Подбор «${util.escHtml(sel.name)}» (${sel.options.length} вариант${sel.options.length === 1 ? '' : 'ов'}) будет скопирован в выбранный проект. Standalone-копия сохранится.
    </p>
  `;
  const result = await util.modalOpen(
    '<h3>📤 Сохранить подбор в проект</h3>',
    html,
    async () => {
      const sel2 = document.getElementById('cl-save-proj-sel');
      const pid = sel2 ? sel2.value : null;
      return pid ? { projectId: pid } : null;
    }
  );
  if (!result || !result.projectId) return;

  // Копируем подбор в LS проекта (с новым id, чтобы не конфликтовать).
  try {
    const key = projectKey(result.projectId, 'cooling', 'selections.v1');
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const newSel = JSON.parse(JSON.stringify(sel));
    newSel.id = 'sel-' + Date.now();
    // Перегенерируем option id для уникальности в новом контексте
    const idMap = new Map();
    for (const o of newSel.options) {
      const newId = 'opt-' + (Math.floor(Math.random() * 1e6));
      idMap.set(o.id, newId);
      o.id = newId;
    }
    if (newSel.mainOptionId) newSel.mainOptionId = idMap.get(newSel.mainOptionId) || newSel.mainOptionId;
    if (newSel.activeOptionId) newSel.activeOptionId = idMap.get(newSel.activeOptionId) || newSel.activeOptionId;
    arr.push(newSel);
    localStorage.setItem(key, JSON.stringify(arr));
    util.toast(`✔ Подбор «${sel.name}» сохранён в проект.`, 'ok');
    // Опциональный быстрый переход
    setTimeout(() => {
      if (confirm('Перейти в проект и открыть подбор?')) {
        location.href = `../cooling/?projectId=${encodeURIComponent(result.projectId)}`;
      }
    }, 500);
  } catch (e) {
    util.toast(`Ошибка сохранения: ${e.message}`, 'err');
  }
}

function renderModuleActionsHere() {
  const root = $('cl-content-actions');
  if (!root) return;
  renderModuleActions(root, {
    navContext: { mode: _navMode, return: _navReturn },
    crossLinks: [],   // в project-mode крос-ссылок не показываем (по требованию,
                       // ссылка на Hub есть в общем app-header слева).
    getPayload: () => {
      // payload для возврата: id активного подбора + id основного варианта.
      const sel = activeSelection();
      const opt = activeOption();
      return {
        selectionId: sel?.id || null,
        selectionName: sel?.name || null,
        mainOptionId: sel?.mainOptionId || null,
        activeOptionId: opt?.id || null,
        // Можно расширить в будущем по запросу вызывающего модуля.
      };
    },
  });
}

function renderActiveTab() {
  const sel = activeSelection();
  const opt = activeOption();
  if (!sel || !opt) return;
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
        if (sysTypeChanged) renderActiveTab();
        renderSelectionsList();
      }, () => {
        opt.spec = { ...DEFAULT_CHILLER };
        persist();
        renderActiveTab();
        renderSelectionsList();
      }));
    }
  } else if (_activeTab === 'energy') {
    const rows = buildBinData(hourly, opt.spec);
    const fcEl = $('cl-fc-summary');
    if (fcEl) {
      fcEl.innerHTML = (opt.spec && Number(opt.spec.ratedCapKw) > 0)
        ? renderFreeCoolingSummary(rows, opt.spec, _tariffRubKwh, hourly, _currency)
        : '<div class="muted">Задайте Rated capacity > 0 во вкладке ❄ Spec для расчёта.</div>';
    }
    const cvs = $('cl-energy-chart');
    if (cvs) drawChillerEnergyChart(cvs, rows);
    const tbl = $('cl-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  } else if (_activeTab === 'capex') {
    const fwrap = $('cl-capex-form-wrap');
    if (fwrap) {
      fwrap.innerHTML = '';
      fwrap.appendChild(renderCapexForm(opt.eco, (next) => {
        opt.eco = next;
        persist();
        renderActiveTab();
      }, _currency));
    }
    const convertFn = makeConvertFn();
    const rows = buildBinData(hourly, opt.spec);
    const fc = computeFcSummary(rows, opt.spec, _tariffRubKwh, hourly);
    const ecoConv = convertEcoToCurrency(opt.eco, _currency, convertFn);
    const tco = computeTco({ annualEnergyKwh: fc ? fc.energyKwh : 0, tariffRubKwh: _tariffRubKwh, eco: ecoConv });
    // Payback относительно ОСНОВНОГО варианта подбора (а не первого).
    let payback = null;
    const main = sel.options.find(o => o.id === sel.mainOptionId);
    if (main && main.id !== opt.id) {
      const bRows = buildBinData(hourly, main.spec);
      const bFc = computeFcSummary(bRows, main.spec, _tariffRubKwh, hourly);
      const bEcoConv = convertEcoToCurrency(main.eco, _currency, convertFn);
      const bTco = computeTco({ annualEnergyKwh: bFc ? bFc.energyKwh : 0, tariffRubKwh: _tariffRubKwh, eco: bEcoConv });
      payback = discountedPaybackYears(tco, bTco);
    }
    const kpi = $('cl-tco-kpi');
    if (kpi) kpi.innerHTML = renderTcoKpi(tco, payback, _currency);
    const cvs = $('cl-tco-chart');
    if (cvs) {
      // TCO chart по всем вариантам ТЕКУЩЕГО подбора (с основным первым).
      const ordered = orderedOptionsForCompare(sel);
      const allMetrics = compareOptions(ordered, hourly, _tariffRubKwh, _currency, convertFn);
      drawTcoChart(cvs, allMetrics);
    }
  } else if (_activeTab === 'topology') {
    // Топология этого подбора: chillers + CRAC + redundancy
    if (!sel.topology) sel.topology = { ...DEFAULT_TOPOLOGY };
    const cwrap = $('cl-topo-config-wrap');
    if (cwrap) {
      cwrap.innerHTML = '';
      cwrap.appendChild(renderTopologyConfig(sel.topology, (next) => {
        sel.topology = next;
        persist();
        renderActiveTab();
      }, sel));
    }
    // Сборка топологии из вариантов подбора (по типам chiller/crac).
    const topo = buildTopologyFromOptions(
      sel.options,
      sel.topology.loopMode,
      sel.topology.redundancyN,
      sel.topology.redundancyM,
    );
    const metrics = simulateTopology(topo, hourly);
    const rwrap = $('cl-topo-results');
    if (rwrap) rwrap.innerHTML = renderTopologyResults(metrics, _currency, _tariffRubKwh);
  } else if (_activeTab === 'compare') {
    const tbl = $('cl-compare-table');
    if (tbl) {
      const convertFn = makeConvertFn();
      const ordered = orderedOptionsForCompare(sel);
      const metrics = compareOptions(ordered, hourly, _tariffRubKwh, _currency, convertFn);
      tbl.innerHTML = renderComparisonTable(metrics, _currency);
    }
  }
}

/* Упорядочить варианты подбора так, чтобы основной шёл первым (он —
   baseline для расчёта payback в comparison.js). */
function orderedOptionsForCompare(sel) {
  if (!sel || !sel.options.length) return [];
  const main = sel.options.find(o => o.id === sel.mainOptionId);
  if (!main) return sel.options;
  return [main, ...sel.options.filter(o => o.id !== main.id)];
}

/* ----- Init ----- */
function init() {
  // v0.59.995: режим работы модуля (standalone / embed / project).
  const nav = detectNavMode();
  _navMode = nav.mode;
  _navReturn = nav.return;
  _standalone = (_navMode === 'standalone');
  if (!_standalone) _pid = ensureDefaultProject();

  _activeCols = loadJson(KEY_COLS, _activeCols);
  const t = Number(loadJson(KEY_TARIFF, null));
  if (Number.isFinite(t) && t >= 0) _tariffRubKwh = t;
  const savedCur = loadJson(KEY_CURRENCY, null);
  if (typeof savedCur === 'string' && savedCur) _currency = savedCur;

  // v0.59.995: загрузка подборов + миграция legacy bucket _options
  _selections = loadJson(KEY_SELECTIONS, []) || [];
  _activeSelectionId = loadJson(KEY_ACTIVE_SEL, null);

  if (!_selections.length) {
    // Миграция: если есть старые _options — обернуть в один подбор.
    const legacyOpts = loadJson(LEGACY_KEY_OPTS, []) || [];
    const legacyActive = loadJson(LEGACY_KEY_ACTIVE, null);
    if (legacyOpts.length) {
      const sel = makeNewSelection('Подбор по умолчанию');
      sel.options = legacyOpts.map(o => ({
        ...o,
        eco: { ...DEFAULT_ECONOMICS, ...(o.eco || {}), currency: o.eco?.currency || _currency },
      }));
      sel.mainOptionId = legacyActive && sel.options.some(o => o.id === legacyActive)
        ? legacyActive
        : sel.options[0].id;
      sel.activeOptionId = legacyActive || sel.mainOptionId;
      _selections.push(sel);
      _activeSelectionId = sel.id;
      // Зафиксировать миграцию (legacy keys больше не пишем, но и не удаляем
      // — пусть остаются на случай отката).
      persist();
      util.toast(`Мигрированы ${legacyOpts.length} опций в новый подбор «Подбор по умолчанию»`, 'info');
    }
  }

  // Восстановить активность
  if (_activeSelectionId && !_selections.some(s => s.id === _activeSelectionId)) {
    _activeSelectionId = _selections[0]?.id || null;
  }
  if (!_activeSelectionId && _selections.length) _activeSelectionId = _selections[0].id;

  // Гарантируем уникальность счётчиков id
  for (const sel of _selections) {
    const m1 = /sel-(\d+)/.exec(sel.id);
    if (m1) _selSeq = Math.max(_selSeq, +m1[1] + 1);
    for (const o of (sel.options || [])) {
      const m = /opt-(\d+)/.exec(o.id);
      if (m) _seq = Math.max(_seq, +m[1] + 1);
    }
  }

  // Валюта select
  const curSel = $('cl-currency');
  if (curSel) {
    curSel.innerHTML = CURRENCIES.map(c =>
      `<option value="${c.code}"${c.code === _currency ? ' selected' : ''} title="${c.label}">${c.code} — ${c.label}</option>`
    ).join('');
    curSel.addEventListener('change', async () => {
      const oldCur = _currency;
      const newCur = curSel.value || '₽';
      if (oldCur === newCur) return;

      // v0.59.995: суммы хранятся в native eco.currency и конвертируются на
      // дисплее автоматически через convertEcoToCurrency. _currency меняет
      // только display-валюту проекта; eco не трогаем. Тариф ВСЕГДА в
      // _currency (он не привязан к опции). Если есть тариф — предлагаем
      // конвертировать ТОЛЬКО его.
      let factor = 1;
      if (_tariffRubKwh > 0) {
        const ok = await clConfirm(`Конвертировать тариф из ${oldCur} в ${newCur} по текущему курсу? (CAPEX опций уже хранятся в их родных валютах и пересчитываются автоматически.)`);
        if (ok) {
          try {
            const rates = await fetchRates(null, null, false);
            const fromIso = currencyToIso(oldCur);
            const toIso   = currencyToIso(newCur);
            const f = convertRate(1, fromIso, toIso, rates);
            if (Number.isFinite(f) && f > 0) {
              factor = f;
              _tariffRubKwh = +(((_tariffRubKwh || 0) * factor).toFixed(3));
              util.toast(`Тариф конвертирован: 1 ${oldCur} = ${factor.toFixed(4)} ${newCur} на ${rates.date}`, 'ok');
            } else {
              util.toast(`Курс ${fromIso}→${toIso} не найден. Тариф остался прежним.`, 'err');
            }
          } catch (e) {
            util.toast(`Не удалось загрузить курсы: ${e.message}.`, 'err');
          }
        }
      }

      _currency = newCur;
      // Обновить input тарифа после конвертации
      const tInp = $('cl-tariff');
      if (tInp) tInp.value = _tariffRubKwh;
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

  // Add selection
  const addSelBtn = $('cl-add-selection');
  if (addSelBtn) {
    addSelBtn.addEventListener('click', async () => {
      const name = await clPrompt('Название нового подбора', `Подбор ${_selections.length + 1}`);
      if (name == null) return;
      const sel = makeNewSelection(name.trim());
      _selections.push(sel);
      _activeSelectionId = sel.id;
      persist();
      renderActive();
      util.toast(`Подбор «${sel.name}» создан. Добавьте варианты оборудования через «+ Вариант».`, 'ok');
    });
  }

  // Add option (variant) into active selection
  const addBtn = $('cl-add-option');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      let sel = activeSelection();
      if (!sel) {
        const ok = await clConfirm('Сначала нужно создать подбор. Создать «Подбор по умолчанию»?');
        if (!ok) return;
        sel = makeNewSelection('Подбор по умолчанию');
        _selections.push(sel);
        _activeSelectionId = sel.id;
      }
      const base = activeOption();
      const name = await clPrompt('Название нового варианта', `Вариант ${sel.options.length + 1}`);
      if (name == null) return;
      const newOpt = makeNewOption(
        (name.trim() || `Вариант ${sel.options.length + 1}`),
        base ? base.spec : null,
        base ? base.eco  : null,
      );
      sel.options.push(newOpt);
      sel.activeOptionId = newOpt.id;
      if (!sel.mainOptionId) sel.mainOptionId = newOpt.id;  // первый = main
      persist();
      renderActive();
      util.toast(`Вариант «${newOpt.name}» создан${sel.mainOptionId === newOpt.id && sel.options.length === 1 ? ' (★ основной)' : ''}.`, 'ok');
    });
  }

  // Sidebar list clicks: selection + option actions
  $('cl-options-list').addEventListener('click', async (e) => {
    // === Selection actions ===
    const selBtn = e.target.closest('button[data-act-sel]');
    if (selBtn) {
      e.stopPropagation();
      const id = selBtn.dataset.selId;
      const act = selBtn.dataset.actSel;
      const sel = _selections.find(s => s.id === id);
      if (!sel) return;
      if (act === 'rename') {
        const newName = await clPrompt('Новое название подбора', sel.name);
        if (newName == null) return;
        sel.name = newName.trim() || sel.name;
        persist(); renderActive();
      } else if (act === 'delete') {
        const ok = await clConfirm(`Удалить подбор «${sel.name}» со всеми ${sel.options.length} вариантами?`);
        if (!ok) return;
        _selections = _selections.filter(s => s.id !== id);
        if (_activeSelectionId === id) _activeSelectionId = _selections[0]?.id || null;
        persist(); renderActive();
        util.toast(`Подбор удалён`, 'info');
      }
      return;
    }
    const selRow = e.target.closest('.cl-sel-row');
    if (selRow && !e.target.closest('button')) {
      _activeSelectionId = selRow.dataset.selId;
      persist(); renderActive();
      return;
    }

    // === Option actions ===
    const optBtn = e.target.closest('button[data-act-opt]');
    if (optBtn) {
      e.stopPropagation();
      const id = optBtn.dataset.optId;
      const act = optBtn.dataset.actOpt;
      const sel = activeSelection();
      if (!sel) return;
      const opt = sel.options.find(o => o.id === id);
      if (!opt) return;
      if (act === 'rename') {
        const newName = await clPrompt('Новое название варианта', opt.name);
        if (newName == null) return;
        opt.name = newName.trim() || opt.name;
        persist(); renderActive();
      } else if (act === 'setmain') {
        sel.mainOptionId = id;
        persist(); renderActive();
        util.toast(`«${opt.name}» теперь основной вариант подбора`, 'ok');
      } else if (act === 'delete') {
        if (sel.mainOptionId === id) {
          util.toast('Нельзя удалить основной вариант. Сначала сделайте основным другой вариант через ★.', 'err');
          return;
        }
        sel.options = sel.options.filter(o => o.id !== id);
        if (sel.activeOptionId === id) sel.activeOptionId = sel.options[0]?.id || null;
        persist(); renderActive();
        util.toast(`Вариант «${opt.name}» удалён`, 'info');
      }
      return;
    }
    const optRow = e.target.closest('.cl-option-row');
    if (optRow && !e.target.closest('button')) {
      const sel = activeSelection();
      if (sel) {
        sel.activeOptionId = optRow.dataset.optId;
        persist(); renderActive();
      }
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

  // v0.59.994: подгружаем курсы фоном для конвертации eco-валют. Если есть
  // активный convertFn — capex-tab/compare-tab сразу пересчитают на следующем
  // рендере. Если сеть/CORS отказывает — пользователь видит native-числа.
  ensureRatesLoaded().then(() => {
    if (_ratesCache && _selections.length) renderActiveTab();
  });
}

// modalOpen из meteo/util.js закрывается только при truthy-результате onOk.
// Поэтому возвращаем sentinel-объект, который всегда truthy, и распаковываем
// в caller'е (для prompt — берём .value; для confirm — true).
function clConfirm(msg) {
  return util.modalOpen('<h3>Подтверждение</h3>', `<p>${util.escHtml(msg)}</p>`,
    async () => ({ ok: true })).then(r => !!r);
}
function clPrompt(label, def = '') {
  return util.modalOpen('<h3>Ввод значения</h3>',
    `<label>${util.escHtml(label)}:<input type="text" id="cl-prompt-input" value="${util.escAttr(def)}" autofocus></label>`,
    async () => ({ value: document.getElementById('cl-prompt-input').value })
  ).then(r => r ? r.value : null);
}

document.addEventListener('DOMContentLoaded', init);
