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

import { ensureDefaultProject, projectKey, listProjects, getProject, setActiveProjectId, getActiveProjectId } from '../shared/project-storage.js';
import * as util from '../meteo/util.js';

import { DEFAULT_CHILLER, COLUMNS, DEFAULT_COLS, CHILLER_COLS, isCracType as isCracTypeLocal } from './calc/chiller-defaults.js';
import { buildBinData } from './calc/chiller-bin-calc.js';
import { computeFcSummary } from './calc/fc-summary.js';
import { computeTco, DEFAULT_ECONOMICS, discountedPaybackYears, convertEcoToCurrency } from '../shared/calc/capex-tco.js';
import { compareOptions } from './calc/comparison.js';

import { renderChillerSpecForm } from './ui/chiller-form.js';
import { renderAnnualTable, renderColumnPicker } from './ui/annual-table-view.js';
import { renderFreeCoolingSummary } from './ui/fc-summary-view.js';
import { drawChillerEnergyChart, drawTcoChart } from './ui/energy-chart.js';
import { renderCapexForm, renderTcoKpi } from './ui/capex-form.js';
import { syncCostItemsFromEquipment } from '../shared/calc/capex-tco.js';
import { fetchAndSaveMeteoForProject } from '../shared/meteo-fetch.js';
import { createServiceOrderForProject } from '../shared/service-bridge.js';
import { renderComparisonTable } from './ui/comparison-view.js';
// v0.60.17: stale-imports убраны (buildTopologyFromOptions / simulateTopology
// — legacy путь, не используется в новой модели per-equipment N+R).
import { simulateOptionTopology } from './calc/topology.js';
// v0.60.17: renderTopologyConfig больше не используется (Topology-tab
// inlined в renderActiveTab). Оставлен только renderTopologyResults.
import { renderTopologyResults } from './ui/topology-view.js';

import { tableToCsv, downloadCsv } from '../meteo/charts.js';
import { getActiveMeteoDataset, getMeteoFilter, applyFilter, preloadMeteoForPid } from './meteo-bridge.js';
import { CURRENCIES, currencyToIso } from './calc/fc-summary.js';
import { open as openRatesDialog } from '../shared/currency-rates/rates-dialog.js';
import { fetchRates, convert as convertRate } from '../shared/currency-rates/index.js';
import '../shared/currency-rates/sources/index.js';
import { detectNavMode, renderModuleActions, openEmbed, readEmbedResult } from '../shared/module-nav.js';
import { historyAppend, historyList, historyTrash, historyRestore, historyPurge } from '../shared/history-log.js';

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
let _activeTab = 'general';
// v0.60.23: фокус — что именно сейчас редактирует пользователь.
//   'selection' — фокус на подборе (видны selection-scope tabs: general, compare)
//   'option'    — фокус на конкретном варианте (видны option-scope tabs: spec, energy, capex, topology)
let _focus = 'selection';
// v0.60.8 (Phase 22.11): режим compare-вкладки.
//   'variants' — варианты текущего подбора (default)
//   'selections' — главные ★-варианты всех подборов проекта
let _compareMode = 'variants';
let _activeCols = [...DEFAULT_COLS, ...CHILLER_COLS];
let _tariffRubKwh = 7.5;     // тариф в его «родной» валюте _tariffCurrency
let _tariffCurrency = '₽';   // v0.60.18: тариф может быть введён в любой валюте, в расчётах конвертируется по курсу
let _currency = '₽';
let _seq = 1;
let _selSeq = 1;

// v0.60.0: кеш курсов на конкретную _ratesDate (по умолчанию today). По
// требованию: «нужно добавить указание даты на какую принимать курсы валют».
// При смене _ratesDate — пере-загружаем кеш и перерендериваем активную вкладку.
// convertFn принимает символы валют (₽/$/€/...) и переводит их в ISO внутри.
let _ratesCache = null;        // { date, base, rates }
let _ratesLoading = false;
let _ratesDate = (() => {
  try { return localStorage.getItem('cooling.ratesDate.v1') || new Date().toISOString().slice(0, 10); }
  catch { return new Date().toISOString().slice(0, 10); }
})();
async function ensureRatesLoaded() {
  if (_ratesLoading) return;
  if (_ratesCache && _ratesCache.date === _ratesDate) return;
  _ratesLoading = true;
  try { _ratesCache = await fetchRates(null, _ratesDate, false); }
  catch (e) { /* offline / CORS — eco отображается без конвертации */ }
  finally { _ratesLoading = false; }
}
function makeConvertFn() {
  if (!_ratesCache) return null;
  // Принимаем символы (₽/$/€), внутри конвертируем в ISO.
  return (amount, from, to) => {
    const fromIso = currencyToIso(from);
    const toIso = currencyToIso(to);
    return convertRate(amount, fromIso, toIso, _ratesCache);
  };
}

// v0.59.995: новые ключи хранения «подборов».
// Старые KEY_OPTIONS / KEY_ACTIVE используются для миграции legacy-данных.
const KEY_SELECTIONS    = ['cooling', 'selections.v1'];
const KEY_ACTIVE_SEL    = ['cooling', 'activeSelectionId.v1'];
const KEY_COLS          = ['cooling', 'cols.v1'];
const KEY_TARIFF        = ['cooling', 'tariff.v1'];
const KEY_TARIFF_CUR    = ['cooling', 'tariffCurrency.v1'];
const KEY_CURRENCY      = ['cooling', 'currency.v1'];
const LEGACY_KEY_OPTS   = ['cooling', 'options.v1'];
const LEGACY_KEY_ACTIVE = ['cooling', 'activeId.v1'];

/* В standalone-режиме project-storage не используется — хранимся под
   raschet.cooling.standalone.<module>.<key> чтобы не мешать project-data. */
function storageKey(suffix) {
  if (_standalone) {
    return `raschet.cooling.standalone.${suffix.join('.')}`;
  }
  // v0.60.18 fix: projectKey ожидает строковый id, а не объект _pid; раньше
  // хранилось под '[object Object]' из-за неявной toString-конверсии.
  return projectKey(_pid?.id, ...suffix);
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
  saveJson(KEY_TARIFF_CUR, _tariffCurrency);
  saveJson(KEY_CURRENCY,   _currency);
}

/* v0.60.18: одноразовая миграция legacy-пути '[object Object]' → правильный pid.
 * До этой версии storageKey() передавал _pid (project object) в projectKey()
 * вместо _pid.id, и JS неявно конвертировал object → '[object Object]'. Все
 * cooling-данные в project-mode писались под единым ключом, не привязанным к
 * конкретному проекту. После фикса нужно перенести данные в правильный
 * neymspace pid'а текущего активного проекта. */
function migrateLegacyObjectObjectKeys() {
  if (_standalone || !_pid?.id) return;
  const legacyPrefix = 'raschet.project.[object Object].cooling.';
  const targetPrefix = `raschet.project.${_pid.id}.cooling.`;
  let migrated = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(legacyPrefix)) keys.push(k);
    }
    for (const lk of keys) {
      const suffix = lk.slice(legacyPrefix.length);
      const tk = targetPrefix + suffix;
      if (localStorage.getItem(tk) != null) continue;  // уже есть данные — не перетираем
      const v = localStorage.getItem(lk);
      if (v != null) { localStorage.setItem(tk, v); migrated++; }
    }
    if (migrated) util.toast(`Перенесены данные cooling из legacy-кеша в проект (${migrated} ключ${migrated === 1 ? '' : 'ей'})`, 'info');
  } catch {}
}

/* v0.60.21: целевая холодопроизводительность подбора (с запасом).
 * Используется для расчёта чиллеров когда нет CRAC-групп — иначе чиллер
 * не имеет нагрузки и energy = 0. */
function requiredCoolingKwOf(sel) {
  if (!sel || !sel.general) return 0;
  const req = Number(sel.general.requiredCoolingKw) || 0;
  const margin = Number(sel.general.safetyMarginPct) || 0;
  return req * (1 + margin / 100);
}

/* v0.60.18: тариф для расчётов = native тариф, конвертированный в displayCurrency */
function tariffInDisplayCurrency() {
  if (!Number.isFinite(_tariffRubKwh) || _tariffRubKwh <= 0) return 0;
  if (_tariffCurrency === _currency) return _tariffRubKwh;
  const cf = makeConvertFn();
  if (!cf) return _tariffRubKwh;  // курс ещё не подгружен — считаем без конвертации
  const v = cf(_tariffRubKwh, _tariffCurrency, _currency);
  return Number.isFinite(v) ? v : _tariffRubKwh;
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

/* v0.60.15 (Phase 22.10.1, refined): модель option-комплекса.
 *
 * По уточнению Пользователя 2026-05-02: «обычно для группы подбирается
 * один чиллер, а не каждый, так как они одинаковые. Резервирование
 * относится к одной компоновке и подбору чиллера. Количество можно
 * внести в общие данные. Так же задать общую необходимую мощность и
 * процент запаса».
 *
 * Модель:
 *   option = {
 *     id, name,
 *     general: {                         // общие данные подбора (новая вкладка)
 *       requiredCoolingKw,               // суммарная необходимая холодопроизводительность
 *       safetyMarginPct,                 // процент запаса (default 20)
 *     },
 *     equipment: [
 *       {
 *         id, role, spec,                // одна группа одинаковых единиц
 *         qty,                           // количество в группе
 *         redundancyN,                   // штатно рабочих в группе
 *         redundancyM,                   // в резерве в группе
 *         standbyMode: 'cold' | 'hot',   // режим резерва per-group
 *       }
 *     ],
 *     topology: { loopMode: 'common-loop' | 'p2p' },  // только loopMode
 *     eco: { ... }                       // CAPEX/OPEX комплекса
 *   }
 *
 * Backward-compat:
 *   • option.spec → equipment: [{spec, qty:1, N:1, M:0, mode:'cold'}]
 *   • option.topology.{redundancyN,M,standbyMode} → equipment[0] (миграция)
 */
function normalizeOption(opt) {
  if (!opt) return opt;

  // Уже новый формат — only ensure equipment items имеют qty/N/M/standbyMode.
  if (Array.isArray(opt.equipment)) {
    let changed = false;
    const equipment = opt.equipment.map(eq => {
      const out = { ...eq };
      if (typeof out.qty !== 'number' || out.qty < 1) { out.qty = 1; changed = true; }
      if (typeof out.redundancyN !== 'number') { out.redundancyN = Math.max(1, out.qty - 0); changed = true; }
      if (typeof out.redundancyM !== 'number') { out.redundancyM = Math.max(0, (out.qty || 1) - out.redundancyN); changed = true; }
      if (!out.standbyMode) { out.standbyMode = 'cold'; changed = true; }
      return out;
    });
    // Если у опции случайно был general (от предыдущей итерации) — удаляем.
    if (opt.general) { changed = true; const { general, ...rest } = opt; return { ...rest, equipment }; }
    return changed ? { ...opt, equipment } : opt;
  }

  // Старый формат с opt.spec — оборачиваем.
  if (!opt.spec) return { ...opt, equipment: [] };
  const tN = Number(opt.topology?.redundancyN) || 1;
  const tM = Number(opt.topology?.redundancyM) || 0;
  const tMode = opt.topology?.standbyMode || 'cold';
  return {
    ...opt,
    equipment: [{
      id: 'eq-' + Math.random().toString(36).slice(2, 8),
      role: deriveRole(opt.spec.systemType),
      spec: opt.spec,
      qty: tN + tM,
      redundancyN: tN,
      redundancyM: tM,
      standbyMode: tMode,
    }],
    topology: { loopMode: opt.topology?.loopMode || 'common-loop' },
  };
}

/* v0.60.18 (workflow refined per user 2026-05-02): «вводим условия всего
 * контура, потом в опции выбираем мощность и параметры одного агрегата и
 * уровень резервирования, остальное рассчитывается на общую мощность
 * условий».
 *
 * Auto-calc qty:
 *   targetKw = required × (1 + margin/100)
 *   N (рабочих) = ceil(targetKw / ratedCapPerUnit)
 *   M = N (если 2N) | 1 (если N+1) | 0 (если N)  — выбирается пользователем
 *   qty = N + M
 */
function deriveAutoQty(targetKw, ratedCapKw, redundancyMode) {
  const cap = Number(ratedCapKw) || 0;
  if (cap <= 0 || targetKw <= 0) return { N: 1, M: 0, qty: 1 };
  const N = Math.max(1, Math.ceil(targetKw / cap));
  let M = 0;
  if (redundancyMode === 'N+1') M = 1;
  else if (redundancyMode === 'N+2') M = 2;
  else if (redundancyMode === '2N') M = N;
  return { N, M, qty: N + M };
}

/* v0.60.17: helper для legacy-кода. Возвращает spec первой equipment-группы
 * либо opt.spec (legacy fallback). Используется в Spec/Energy/Compare-tabs
 * пока UI ещё одно-spec-per-option. Multi-equipment — TODO в Phase 22.10.1.x.
 */
function primarySpec(opt) {
  if (!opt) return null;
  if (Array.isArray(opt.equipment) && opt.equipment[0]?.spec) return opt.equipment[0].spec;
  return opt.spec || null;
}

/* v0.60.18: при изменении spec через chiller-form — синхронизируем
 * opt.spec И opt.equipment[0].spec, ПЛЮС auto-recompute qty/N/M из
 * selection.general.requiredCoolingKw и opt.redundancyMode.
 * sel передаётся для доступа к requiredKw + margin. */
function setPrimarySpec(opt, newSpec, sel) {
  if (!opt) return;
  opt.spec = newSpec;
  const role = deriveRole(newSpec?.systemType);
  // Mode хранится на самой опции (на каждом варианте свой)
  const redundancyMode = opt.redundancyMode || 'N+1';
  const standbyMode = opt.standbyMode || 'cold';
  // targetKw из selection.general
  const general = sel?.general || { requiredCoolingKw: 0, safetyMarginPct: 20 };
  const targetKw = (general.requiredCoolingKw || 0) * (1 + (general.safetyMarginPct || 0) / 100);
  const { N, M, qty } = deriveAutoQty(targetKw, newSpec?.ratedCapKw || 0, redundancyMode);
  if (Array.isArray(opt.equipment) && opt.equipment[0]) {
    opt.equipment[0].spec = newSpec;
    opt.equipment[0].role = role;
    opt.equipment[0].qty = qty;
    opt.equipment[0].redundancyN = N;
    opt.equipment[0].redundancyM = M;
    opt.equipment[0].standbyMode = standbyMode;
  } else if (newSpec) {
    opt.equipment = [{
      id: 'eq-' + Math.random().toString(36).slice(2, 8),
      role, spec: newSpec, qty, redundancyN: N, redundancyM: M, standbyMode,
    }];
  }
}

/** Пересчитать equipment-qty всех вариантов подбора при изменении general.
 *  Вызывается когда пользователь меняет requiredKw / margin. */
function recomputeAutoQtyForSelection(sel) {
  if (!sel || !Array.isArray(sel.options)) return;
  const general = sel.general || { requiredCoolingKw: 0, safetyMarginPct: 20 };
  const targetKw = (general.requiredCoolingKw || 0) * (1 + (general.safetyMarginPct || 0) / 100);
  for (const opt of sel.options) {
    if (!Array.isArray(opt.equipment) || !opt.equipment[0]) continue;
    const eq = opt.equipment[0];
    const mode = opt.redundancyMode || 'N+1';
    const { N, M, qty } = deriveAutoQty(targetKw, eq.spec?.ratedCapKw || 0, mode);
    eq.redundancyN = N;
    eq.redundancyM = M;
    eq.qty = qty;
  }
}

/** Derive equipment role from systemType. */
function deriveRole(sysType) {
  if (sysType === 'crac-water' || sysType === 'crac-water+compressor' || sysType === 'crac-water+fc-loop') return 'crac';
  if (sysType === 'dx-air' || sysType === 'dx-pumped-fc') return 'dx';
  return 'chiller';
}

/** In-place миграция всех selections + options до новой модели. */
function migrateSelectionsToComplex() {
  let changed = false;
  for (const sel of _selections) {
    // v0.60.15 (refined): selection.general — общие данные подбора
    // (требуемая мощность + % запаса). Если нет — добавляем default.
    if (!sel.general) {
      sel.general = { requiredCoolingKw: 0, safetyMarginPct: 20 };
      changed = true;
    }
    for (let i = 0; i < (sel.options || []).length; i++) {
      const before = sel.options[i];
      const after = normalizeOption(before);
      if (after !== before) {
        sel.options[i] = after;
        changed = true;
      }
    }
  }
  if (changed) persist();
}
function makeNewSelection(name) {
  const sel = {
    id: `sel-${_selSeq++}`,
    name: name || `Подбор ${_selections.length + 1}`,
    // v0.60.15 (refined): свойства подбора — общие для всех вариантов.
    // По уточнению Пользователя: «необходимая мощность должна быть задана
    // для свойств подбора, а уровни резервирования для каждой опции отдельно».
    general: {
      requiredCoolingKw: 0,    // суммарная необходимая мощность системы
      safetyMarginPct: 20,     // % запаса (default 20%)
    },
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
  const m = getActiveMeteoDataset(_pid?.id);
  if (!m) return { hourly: [], dataset: null };
  const filter = getMeteoFilter(_pid?.id);
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
  const m = getActiveMeteoDataset(_pid?.id);
  if (!m) {
    root.className = 'cl-meteo-status empty';
    // v0.60.32: если у проекта есть локация — предлагаем 1-кликовую
    // загрузку через Open-Meteo вместо ручного перехода в /meteo/.
    const projLoc = (!_standalone && _pid?.location) ? _pid.location : null;
    if (projLoc && Number.isFinite(Number(projLoc.lat)) && Number.isFinite(Number(projLoc.lon))) {
      // v0.60.55: набор кнопок 1/5/10/15/20 лет.
      // 1 год — primary (самый частый сценарий, быстро).
      // 5/10/15/20 — для долгосрочной аналитики (TCO, climate-adjusted PUE).
      // Большие датасеты (10+ лет ≈ 6+ МБ) сохраняются в IDB.
      root.innerHTML = `
        <div style="font-size:11.5px;color:#92400e;margin-bottom:6px">⚠ Нет meteo-датасетов</div>
        <div style="font-size:11px;color:#475569;margin-bottom:6px" title="Локация проекта (см. Свойства проекта). Загрузим почасовые данные через Open-Meteo Historical API для этих координат.">
          📍 ${util.escHtml(projLoc.city || '')} (${Number(projLoc.lat).toFixed(3)}, ${Number(projLoc.lon).toFixed(3)})
        </div>
        <button type="button" data-yrs="1" id="cl-fetch-meteo-1y" class="cl-btn-primary cl-fetch-meteo-btn" style="width:100%;margin-bottom:4px;padding:6px 10px;font-size:11.5px"
                title="1 год почасовых данных (~250 КБ). Самый быстрый сценарий — для оперативного подбора. Сохранится как ⭐активный датасет проекта.">
          🌐 Загрузить метео — 1 год
        </button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:4px">
          <button type="button" data-yrs="5" class="cl-fetch-meteo-btn" style="padding:5px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer"
                  title="5 лет (~1.3 МБ). Достаточно для анализа сезонной изменчивости и пиковых нагрузок.">5 лет</button>
          <button type="button" data-yrs="10" class="cl-fetch-meteo-btn" style="padding:5px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer"
                  title="10 лет (~2.6 МБ, ~88 тыс. часов). Стандарт для climate-adjusted TCO/PUE. Хранится в IndexedDB.">10 лет</button>
          <button type="button" data-yrs="15" class="cl-fetch-meteo-btn" style="padding:5px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer"
                  title="15 лет (~4 МБ). Для долгосрочного моделирования free-cooling. Хранится в IndexedDB.">15 лет</button>
          <button type="button" data-yrs="20" class="cl-fetch-meteo-btn" style="padding:5px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer"
                  title="20 лет (~5.3 МБ, ~175 тыс. часов). Максимальный набор для climate-baseline. Хранится в IndexedDB.">20 лет</button>
        </div>
        <div style="font-size:10.5px;color:#64748b">или вручную → кнопка ниже</div>
      `;
      root.querySelectorAll('.cl-fetch-meteo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const yrs = Math.max(1, Math.min(20, parseInt(btn.dataset.yrs, 10) || 1));
          autoFetchMeteoForProject(projLoc, yrs);
        });
      });
    } else {
      root.textContent = '⚠ Нет meteo-датасетов. Откройте модуль Метеоданные и загрузите хотя бы один.';
    }
    return;
  }
  const filter = getMeteoFilter(_pid?.id);
  const total = m.hourly.length;
  const filtered = applyFilter(m.hourly, filter).length;
  let filterDesc;
  if (filter.mode === 'year' && filter.year) filterDesc = `год ${filter.year}`;
  else if (filter.mode === 'period') filterDesc = `${filter.periodFrom || '?'}—${filter.periodTo || '?'}`;
  else filterDesc = 'все годы';
  root.className = 'cl-meteo-status';

  // v0.60.56: проверка несоответствия активного датасета и локации проекта.
  // Bug-репорт от Пользователя 2026-05-03: «у меня везде Темиртау, хотя
  // проект Ташкент». Активный датасет мог быть импортирован раньше когда
  // проект был привязан к другому городу, или вручную выбран в meteo.
  // Решение: показать warning + grid кнопок «Загрузить <city проекта>».
  const projLoc = (!_standalone && _pid?.location) ? _pid.location : null;
  const hasProjLoc = projLoc && Number.isFinite(Number(projLoc.lat)) && Number.isFinite(Number(projLoc.lon));
  let mismatchHtml = '';
  if (hasProjLoc && Number.isFinite(m.dataset.lat) && Number.isFinite(m.dataset.lon)) {
    const distKm = haversineKm(
      Number(projLoc.lat), Number(projLoc.lon),
      Number(m.dataset.lat), Number(m.dataset.lon)
    );
    if (distKm > 50) {
      const cityEsc = util.escHtml(projLoc.city || `${Number(projLoc.lat).toFixed(2)}, ${Number(projLoc.lon).toFixed(2)}`);
      mismatchHtml = `
        <div style="margin-top:8px;padding:6px 8px;background:#fef3c7;border:1px solid #fbbf24;border-radius:3px;font-size:11px;color:#92400e"
             title="Активный meteo-датасет геометрически далеко от локации проекта. Расчёт идёт по климату из датасета, а не по городу проекта.">
          ⚠ Датасет на ${distKm.toFixed(0)} км от проекта (${cityEsc})
        </div>
        <button type="button" data-yrs="1" class="cl-fetch-meteo-btn cl-btn-primary" style="width:100%;margin-top:4px;padding:6px 10px;font-size:11.5px"
                title="Загрузить 1 год почасовых данных для локации проекта (${cityEsc}) и сделать активным датасетом.">
          🌐 Загрузить ${cityEsc} — 1 год
        </button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:3px">
          <button type="button" data-yrs="5"  class="cl-fetch-meteo-btn" style="padding:4px 6px;font-size:10.5px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer" title="5 лет (~1.3 МБ)">5 лет</button>
          <button type="button" data-yrs="10" class="cl-fetch-meteo-btn" style="padding:4px 6px;font-size:10.5px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer" title="10 лет (~2.6 МБ). IndexedDB.">10 лет</button>
          <button type="button" data-yrs="15" class="cl-fetch-meteo-btn" style="padding:4px 6px;font-size:10.5px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer" title="15 лет (~4 МБ). IndexedDB.">15 лет</button>
          <button type="button" data-yrs="20" class="cl-fetch-meteo-btn" style="padding:4px 6px;font-size:10.5px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer" title="20 лет (~5.3 МБ). IndexedDB.">20 лет</button>
        </div>
      `;
    }
  }

  root.innerHTML = `<b>${util.escHtml(m.dataset.name)}</b><br>
    <span style="font-size:11px">${util.escHtml(m.dataset.locationName || '')} · ${filterDesc}</span><br>
    <span style="font-size:11px">${filtered} записей${total !== filtered ? ` из ${total}` : ''}</span>${mismatchHtml}`;

  if (mismatchHtml && hasProjLoc) {
    root.querySelectorAll('.cl-fetch-meteo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const yrs = Math.max(1, Math.min(20, parseInt(btn.dataset.yrs, 10) || 1));
        autoFetchMeteoForProject(projLoc, yrs);
      });
    });
  }
}

/* v0.60.56: расстояние по большому кругу (км). Используется для детекции
   несоответствия meteo-датасета и локации проекта. Земля не идеальный
   шар, но точности ±0.5% хватает для фильтра «датасет в этом городе или нет». */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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
  // v0.60.23: показываем пэйн если есть sel (для selection-tabs general/compare).
  // Если ещё и opt — option-tabs тоже доступны.
  if (!sel) {
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    $('cl-active-name').textContent = '— нет активного подбора —';
    $('cl-active-meta').textContent = 'Создайте подбор через «+ Подбор» в боковой панели.';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  // Если фокус option, но opt нет — авто-сваливаемся в selection-фокус.
  if (_focus === 'option' && !opt) _focus = 'selection';
  if (_focus === 'option' && opt) {
    const isMain = sel.mainOptionId === opt.id ? ' ★' : '';
    $('cl-active-name').textContent = `📋 ${sel.name} → ${opt.name}${isMain}`;
    const pSpec = primarySpec(opt) || {};
    $('cl-active-meta').textContent = `${pSpec.systemType || '?'} · rated ${Math.round(pSpec.ratedCapKw || 0)} кВт · COP ${pSpec.ratedCOP || '?'}`;
  } else {
    $('cl-active-name').textContent = `📋 ${sel.name}`;
    $('cl-active-meta').textContent = `${sel.options.length} вариантов · общие свойства подбора`;
  }
  renderActiveTab();
}

function renderStorageMode() {
  const el = $('cl-storage-mode');
  if (!el) return;
  if (_navMode === 'embed' && _navReturn) {
    el.innerHTML = `<span title="Embed-режим: модуль вызван из «${util.escAttr(_navReturn.label)}». Сделайте подбор и нажмите «✓ Применить и вернуться» в правом верхнем углу.">🔗 Embed: вернуться в <b>${util.escHtml(_navReturn.label)}</b></span>`;
    return;
  }
  // v0.60.347: picker «Контекст подбора» — упрощённый по требованию
  // Пользователя 2026-05-05: «просто Проекты и разовый подбор, больше ни чего,
  // локальные проекты, которые сформированы в СКС, не должны здесь
  // отображаться». Раньше было 4 категории (Локальные подборы холода / Проекты
  // с подборами / Прочие проекты / Без проекта). Сейчас:
  //   - 🔓 Разовый подбор (standalone)
  //   - 📁 Проекты — только full-проекты (kind='full'); SCS-sketch и другие
  //     локальные sketch'и НЕ показываются.
  let projects = [];
  try { projects = listProjects() || []; } catch {}
  const currentVal = _standalone ? '__standalone__' : ((_pid && _pid.id) || '__standalone__');

  // Только реальные full-проекты. Sketch-проекты (включая СКС-локальные и
  // cooling-локальные) исключены — Пользователь явно запросил «больше ничего»,
  // и СКС-sketch здесь не место.
  const fullProjects = projects.filter(p => p.kind === 'full');

  const optEl = (p) =>
    `<option value="${util.escAttr(p.id)}"${currentVal === p.id ? ' selected' : ''} title="Подборы будут сохранены в проекте «${util.escAttr(p.name || p.id)}»">📁 ${util.escHtml(p.name || p.id)}</option>`;
  const grpHtml = (label, opts) => opts.length
    ? `<optgroup label="${util.escAttr(label)}">${opts.join('')}</optgroup>`
    : '';
  const optsHtml = `
    <option value="__standalone__"${currentVal === '__standalone__' ? ' selected' : ''} title="Разовый подбор — данные хранятся в общем LocalStorage без привязки к проекту. Не попадёт в отчёт по проекту.">🔓 Разовый подбор</option>
    ${grpHtml('Проекты', fullProjects.map(p => optEl(p)))}
  `;
  el.innerHTML = `
    <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px" title="Контекст хранения подборов. Выберите проект для привязки или «Разовый подбор» — данные в общем LocalStorage.">КОНТЕКСТ ПОДБОРА</label>
    <select id="cl-context-sel" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;background:#fff;cursor:pointer" title="🔓 Разовый подбор — данные в общем LS, не привязаны к проекту. 📁 Проект — подбор сохраняется в выбранном проекте.">${optsHtml}</select>
    ${_standalone && projects.length
      ? `<button type="button" id="cl-save-to-project" style="display:block;width:100%;margin-top:6px;padding:5px 8px;font-size:11.5px;background:#1e40af;color:#fff;border:none;border-radius:3px;cursor:pointer" title="Скопировать активный подбор в выбранный проект. После сохранения вы можете перейти в проект и продолжить работу там.">📤 Сохранить активный подбор в проект</button>`
      : ''}
  `;
  const sel = el.querySelector('#cl-context-sel');
  if (sel) sel.addEventListener('change', async () => {
    const v = sel.value;
    if (v === '__standalone__') {
      const url = new URL(location.href);
      url.searchParams.set('standalone', '1');
      url.searchParams.delete('pid');
      location.href = url.toString();
      return;
    }
    // Обычный проект
    const url = new URL(location.href);
    url.searchParams.delete('standalone');
    url.searchParams.set('pid', v);
    location.href = url.toString();
  });
  const btn = el.querySelector('#cl-save-to-project');
  if (btn) btn.addEventListener('click', saveActiveSelectionToProject);
}

/* v0.60.32: 1-кликовая загрузка meteo-датасета через Open-Meteo
   по координатам проекта. Используется в renderMeteoStatus при пустом
   списке датасетов.
   v0.60.55: добавлен параметр years (1/5/10/15/20). Большие датасеты
   могут грузиться 10+ секунд — UI блокирует кнопки на время загрузки. */
async function autoFetchMeteoForProject(projLoc, years = 1) {
  if (!_pid?.id) {
    util.toast('Нет активного проекта (standalone mode) — переключитесь в проект через picker контекста.', 'err');
    return;
  }
  // Блокируем все fetch-кнопки пока идёт загрузка
  const allBtns = document.querySelectorAll('.cl-fetch-meteo-btn');
  allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'wait'; });
  util.toast(`Загрузка ${years} ${years === 1 ? 'года' : 'лет'} почасовых данных через Open-Meteo…`, 'info');
  try {
    const result = await fetchAndSaveMeteoForProject(_pid.id, {
      lat: Number(projLoc.lat),
      lon: Number(projLoc.lon),
      locationName: projLoc.city || `${Number(projLoc.lat).toFixed(3)}, ${Number(projLoc.lon).toFixed(3)}`,
      years,
      triggeredFrom: 'cooling',  // Phase 35: тег источника в history-log
    });
    if (!result.ok) {
      util.toast(`❌ ${result.error}`, 'err');
      return;
    }
    util.toast(`✓ Загружено: ${result.dataset.stats.n} часов (${years} ${years === 1 ? 'год' : 'лет'}), T ${result.dataset.stats.tmin}…${result.dataset.stats.tmax} °C`, 'ok');
    // Обновляем IDB-кэш меteo-bridge перед перерисовкой
    try { await preloadMeteoForPid(_pid.id); } catch (e) { console.warn('[cooling] preload after fetch failed:', e); }
    renderActive();
  } finally {
    allBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; });
  }
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
    // Опциональный быстрый переход. v0.60.139: убран confirm() (no browser dialogs);
    // вместо этого toast с CTA-кнопкой, либо просто toast без перехода.
    // Используем modalOpen из meteo/util.js для in-page подтверждения.
    setTimeout(async () => {
      const goToProject = await util.modalOpen(
        '<h3>Перейти в проект?</h3>',
        '<p>Открыть проект и перейти к сохранённому подбору?</p>',
        async () => ({ ok: true })
      );
      if (goToProject) {
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

/* v0.60.23: применить focus (selection|option) — скрыть/показать tabs по scope.
 * Если текущая активная вкладка не в текущем scope — переключаемся на первую
 * вкладку нужного scope. */
function applyFocusUI() {
  const sel = activeSelection();
  const opt = activeOption();
  document.querySelectorAll('.cl-tab').forEach(b => {
    const scope = b.dataset.scope;
    const visible = (scope === _focus);
    b.style.display = visible ? '' : 'none';
  });
  // Если текущий tab не в этом scope — переключаемся.
  const curBtn = document.querySelector(`.cl-tab[data-tab="${_activeTab}"]`);
  if (!curBtn || curBtn.dataset.scope !== _focus) {
    const fallback = document.querySelector(`.cl-tab[data-scope="${_focus}"]`);
    if (fallback) _activeTab = fallback.dataset.tab;
  }
  // Focus-индикатор
  const fi = document.getElementById('cl-focus-indicator');
  if (fi) {
    if (_focus === 'selection') {
      fi.innerHTML = `<span title="Сейчас редактируется подбор «${util.escAttr(sel?.name || '')}». Видны вкладки уровня подбора: общие свойства + сравнение опций. Кликните на конкретный вариант в сайдбаре, чтобы перейти к редактированию опции.">📋 <b>Редактирование подбора</b>: «${util.escHtml(sel?.name || '—')}» (${sel?.options?.length || 0} вариантов)</span>`;
      fi.className = 'cl-focus-indicator cl-focus-selection';
    } else {
      // v0.60.33: для option-focus добавляем кнопки cross-module действий
      // (создать наряд монтажа/ТО в Сервисе на основе этой опции).
      fi.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span title="Сейчас редактируется вариант «${util.escAttr(opt?.name || '')}» подбора «${util.escAttr(sel?.name || '')}». Видны вкладки уровня опции: spec, энергия, CAPEX, топология. Кликните на название подбора в сайдбаре, чтобы перейти к свойствам подбора.">⚙ <b>Редактирование варианта</b>: «${util.escHtml(opt?.name || '—')}» в подборе «${util.escHtml(sel?.name || '')}»</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button type="button" id="cl-push-service-install" class="cl-btn-ghost" style="padding:4px 8px;font-size:11px"
                    title="Создать в модуле «Сервис» наряд МОНТАЖА с авто-заполнением позиций по equipment[] этой опции (qty из топологии, дефолт-цены по типу/мощности). Откроется Сервис в этом окне.">
              📤 → Сервис: Монтаж
            </button>
            <button type="button" id="cl-push-service-maint" class="cl-btn-ghost" style="padding:4px 8px;font-size:11px"
                    title="Создать в модуле «Сервис» наряд ТО (квартальное) с авто-заполнением позиций по equipment[] этой опции.">
              📤 → Сервис: ТО
            </button>
          </div>
        </div>
      `;
      fi.className = 'cl-focus-indicator cl-focus-option';
      // Wire push-buttons
      const pushBtn = (id, type) => {
        const btn = fi.querySelector(`#${id}`);
        if (btn) btn.addEventListener('click', () => pushOptionToService(sel, opt, type));
      };
      pushBtn('cl-push-service-install', 'install');
      pushBtn('cl-push-service-maint', 'maintenance');
    }
  }
}

/* v0.60.33: создать наряд в Сервисе из cooling-опции и навигироваться. */
async function pushOptionToService(sel, opt, type) {
  if (!opt?.equipment?.length) {
    util.toast('У опции нет equipment-групп. Сначала задайте оборудование во вкладке Топология.', 'err');
    return;
  }
  // Динамический импорт order-builder (из service)
  let builder;
  try {
    builder = await import('../service/calc/order-builder.js');
  } catch (e) {
    util.toast(`Не удалось загрузить service-модуль: ${e.message}`, 'err');
    return;
  }
  const buildFn = (type === 'maintenance')
    ? builder.buildMaintenancePositionsFromCoolingOption
    : builder.buildInstallPositionsFromCoolingOption;
  const positions = buildFn(opt, _currency);
  if (!positions.length) {
    util.toast('Не удалось сгенерировать позиции (нет valid equipment).', 'err');
    return;
  }
  const typeLabel = type === 'maintenance' ? 'ТО' : 'Монтаж';
  const order = {
    name: `${typeLabel}: ${sel.name} → ${opt.name}`,
    type,
    date: new Date().toISOString().slice(0, 10),
    coolingSelectionId: sel.id,
    positions,
    overheadPct: 15,
    vatPct: 12,
    customer: { name: '', contact: '' },
    notes: `Авто-сгенерировано из cooling-подбора «${sel.name}» / опции «${opt.name}» (${positions.length} позиций).`,
  };
  const pid = _standalone ? null : (_pid?.id || null);
  const result = createServiceOrderForProject(pid, order);
  util.toast(`✓ Наряд создан в Сервисе. Открываем…`, 'ok');
  setTimeout(() => { location.href = result.navigateUrl; }, 800);
}

function renderActiveTab() {
  const sel = activeSelection();
  const opt = activeOption();
  if (!sel) return;
  applyFocusUI();
  // Для option-scope нужен opt; для selection-scope — нет.
  if (_focus === 'option' && !opt) return;
  document.querySelectorAll('.cl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
  document.querySelectorAll('.cl-tab-pane').forEach(p => p.hidden = (p.dataset.pane !== _activeTab));

  const { hourly } = getHourly();

  if (_activeTab === 'general') {
    // v0.60.18: Свойства всего подбора — общие условия для всех вариантов.
    // v0.60.25: Финансовые параметры (lifetime/discount/escalations) тоже здесь —
    // на selection-уровне, чтобы все варианты сравнивались на одинаковых
    // финансовых условиях.
    const wrap = $('cl-general-wrap');
    if (wrap) {
      // Гарантируем default-eco на selection (миграция из option.eco при первом
      // открытии — берём из основного варианта, если sel.eco пусто).
      if (!sel.eco) {
        const main = sel.options.find(o => o.id === sel.mainOptionId) || sel.options[0];
        const fromOpt = main?.eco || {};
        sel.eco = {
          projectLifetimeYears: Number(fromOpt.projectLifetimeYears) || 20,
          discountRatePct:      Number(fromOpt.discountRatePct)      || 8,
          escalationEnergyPct:  Number(fromOpt.escalationEnergyPct)  || 5,
          escalationMaintPct:   Number(fromOpt.escalationMaintPct)   || 4,
        };
      }
      const eco = sel.eco;
      const general = sel.general || { requiredCoolingKw: 0, safetyMarginPct: 20 };
      const targetKw = (general.requiredCoolingKw || 0) * (1 + (general.safetyMarginPct || 0) / 100);
      // Перечень вариантов с auto-расчётом qty
      const variantsHtml = sel.options.map(o => {
        const sp = primarySpec(o) || {};
        const mode = o.redundancyMode || 'N+1';
        const { N, M, qty } = deriveAutoQty(targetKw, sp.ratedCapKw || 0, mode);
        const totalKw = (sp.ratedCapKw || 0) * N;
        return `<tr ${o.id === sel.mainOptionId ? 'style="background:#ecfdf5"' : ''}>
          <td>${o.id === sel.mainOptionId ? '★ ' : ''}${util.escHtml(o.name)}</td>
          <td>${util.escHtml(sp.systemType || '?')}</td>
          <td class="num">${sp.ratedCapKw || 0} кВт</td>
          <td>${mode}</td>
          <td class="num"><b>${N}</b></td>
          <td class="num">${M}</td>
          <td class="num"><b>${qty}</b></td>
          <td class="num">${totalKw} кВт${totalKw >= targetKw ? ' ✓' : ' ⚠'}</td>
        </tr>`;
      }).join('');
      wrap.innerHTML = `
        <h4 title="Общие условия для всего подбора. Применяются ко всем вариантам сравнения.">📋 Свойства подбора «${util.escHtml(sel.name)}»</h4>
        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title">Условия системы охлаждения</div>
          <div class="cl-chiller-grid">
            <label title="Суммарная необходимая холодопроизводительность (Q_required, кВт). Должна покрывать IT-нагрузку + потери UPS + теплоприток ограждений + люди.">
              Требуемая мощн., кВт:
              <input type="number" min="0" step="10" id="cl-gen-required-kw" value="${general.requiredCoolingKw || 0}">
            </label>
            <label title="Процент запаса по мощности. Default 20%. Учитывает рост IT-нагрузки, climate-margin, перегрузки. targetKw = required × (1 + margin/100).">
              Запас, %:
              <input type="number" min="0" max="100" step="5" id="cl-gen-margin-pct" value="${general.safetyMarginPct || 0}">
            </label>
          </div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">
            🎯 <b>Целевая мощность с запасом: ${targetKw.toFixed(0)} кВт.</b> Все варианты ниже подбираются на эту мощность.
          </p>
        </div>
        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title" title="Финансовые параметры применяются ко ВСЕМ вариантам подбора одинаково — для справедливого сравнения. Разные финусловия исказят payback и TCO.">💰 Финансовые параметры (общие для всех вариантов)</div>
          <div class="cl-chiller-grid">
            <label title="Срок горизонта оценки TCO. Типично 10–20 лет для HVAC, до 25 лет для крупных чиллеров.">
              Срок проекта, лет:
              <input type="number" min="1" max="40" step="1" id="cl-gen-lifetime" value="${eco.projectLifetimeYears}">
            </label>
            <label title="Discount rate (ставка дисконтирования) — приведение будущих платежей к текущей стоимости. Типично:
• 8–10% для коммерческих проектов
• 12–15% для high-risk
• 5–7% для гос/инфраструктурных">
              Discount rate, %/год:
              <input type="number" min="0" max="50" step="0.5" id="cl-gen-discount" value="${eco.discountRatePct}">
            </label>
            <label title="Годовой рост тарифа на электроэнергию. Применяется к OPEX_energy_t = base × (1+esc)^(t-1). РФ типично 4–7%/год.">
              Эскалация эл/энергии, %/год:
              <input type="number" min="0" max="20" step="0.5" id="cl-gen-esc-energy" value="${eco.escalationEnergyPct}">
            </label>
            <label title="Годовой рост стоимости ТО (зарплаты + запчасти). Типично 3–5%/год.">
              Эскалация ТО, %/год:
              <input type="number" min="0" max="20" step="0.5" id="cl-gen-esc-maint" value="${eco.escalationMaintPct}">
            </label>
          </div>
        </div>
        ${sel.options.length ? `
        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title">Auto-расчёт количества по вариантам</div>
          <p class="muted" style="font-size:11.5px;margin:0 0 6px">
            В каждом варианте задаётся ОДИН агрегат + уровень резервирования. Количество (N+R) считается автоматически из целевой мощности и rated одного агрегата:
            <b>N = ceil(${targetKw.toFixed(0)} / rated)</b>; R по выбранному режиму (N+1 → R=1, N+2 → R=2, 2N → R=N).
          </p>
          <table class="cl-annual-table" style="font-size:12px">
            <thead><tr>
              <th>Вариант</th><th>Тип</th><th>Rated 1шт</th><th>Резерв</th>
              <th title="Рабочих">N</th><th title="В резерве">R</th>
              <th title="Всего шт = N+R">Σ qty</th>
              <th title="Установленная мощность активных = N × rated. Должна ≥ целевой.">Установлено</th>
            </tr></thead>
            <tbody>${variantsHtml}</tbody>
          </table>
        </div>` : '<p class="muted">Добавьте варианты через «+ Вариант» в боковой панели.</p>'}
      `;
      const reqInp = wrap.querySelector('#cl-gen-required-kw');
      if (reqInp) reqInp.addEventListener('change', () => {
        if (!sel.general) sel.general = {};
        sel.general.requiredCoolingKw = Number(reqInp.value) || 0;
        recomputeAutoQtyForSelection(sel);
        persist(); renderActiveTab();
      });
      const marInp = wrap.querySelector('#cl-gen-margin-pct');
      if (marInp) marInp.addEventListener('change', () => {
        if (!sel.general) sel.general = {};
        sel.general.safetyMarginPct = Number(marInp.value) || 0;
        recomputeAutoQtyForSelection(sel);
        persist(); renderActiveTab();
      });
      // v0.60.25: финпараметры подбора
      const wireSelEco = (selector, field) => {
        const el = wrap.querySelector(selector);
        if (!el) return;
        el.addEventListener('change', () => {
          if (!sel.eco) sel.eco = {};
          sel.eco[field] = Number(el.value) || 0;
          persist(); renderActiveTab();
        });
      };
      wireSelEco('#cl-gen-lifetime',   'projectLifetimeYears');
      wireSelEco('#cl-gen-discount',   'discountRatePct');
      wireSelEco('#cl-gen-esc-energy', 'escalationEnergyPct');
      wireSelEco('#cl-gen-esc-maint',  'escalationMaintPct');
    }
  } else if (_activeTab === 'spec') {
    const wrap = $('cl-spec-form-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      const curSpec = primarySpec(opt) || { ...DEFAULT_CHILLER };
      // v0.60.18: добавляем над chiller-form блок «Резервирование» + auto-calc
      const general = sel.general || { requiredCoolingKw: 0, safetyMarginPct: 20 };
      const targetKw = (general.requiredCoolingKw || 0) * (1 + (general.safetyMarginPct || 0) / 100);
      const mode = opt.redundancyMode || 'N+1';
      const standby = opt.standbyMode || 'cold';
      const { N, M, qty } = deriveAutoQty(targetKw, curSpec.ratedCapKw || 0, mode);
      const totalKw = (curSpec.ratedCapKw || 0) * N;
      const redundancyHtml = document.createElement('div');
      redundancyHtml.className = 'cl-chiller-section';
      redundancyHtml.innerHTML = `
        <div class="cl-chiller-section-title" title="Уровень резервирования и режим резерва. Количество N (рабочих) считается автоматически из целевой мощности (см. вкладку «📋 Свойства подбора»).">⚙ Резервирование (per-вариант)</div>
        <div class="cl-chiller-grid">
          <label title="Стандартные схемы резервирования по ASHRAE / Uptime Institute:
• N — без резерва (один путь, нет защиты от отказа)
• N+1 — один резервный (типовой ЦОД Tier II/III)
• N+2 — два резервных (повышенная надёжность)
• 2N — каждому активному — свой резерв (Tier IV, концерт-критично)">
            Схема резервирования:
            <select id="cl-opt-redundancy-mode">
              <option value="N"${mode === 'N' ? ' selected' : ''}>N (без резерва)</option>
              <option value="N+1"${mode === 'N+1' ? ' selected' : ''}>N+1</option>
              <option value="N+2"${mode === 'N+2' ? ' selected' : ''}>N+2</option>
              <option value="2N"${mode === '2N' ? ' selected' : ''}>2N</option>
            </select>
          </label>
          <label title="Режим резерва:
• Холодный — резерв полностью off, energy=0, ждёт failover.
• Горячий — резерв работает параллельно с активными, делит нагрузку.">
            Режим резерва:
            <select id="cl-opt-standby-mode">
              <option value="cold"${standby === 'cold' ? ' selected' : ''}>❄ Холодный</option>
              <option value="hot"${standby === 'hot' ? ' selected' : ''}>🔥 Горячий</option>
            </select>
          </label>
        </div>
        <p class="muted" style="font-size:11.5px;margin:6px 0 0;background:#f0f9ff;padding:6px 10px;border-radius:3px">
          🎯 Целевая мощность: <b>${targetKw.toFixed(0)} кВт</b> (Свойства подбора)<br>
          📐 Auto-расчёт: <b>N=${N} рабочих × ${curSpec.ratedCapKw || 0} кВт = ${totalKw} кВт</b> ${totalKw >= targetKw ? '<span style="color:#16a34a">✓ покрывает</span>' : `<span style="color:#b91c1c">⚠ дефицит ${(targetKw - totalKw).toFixed(0)} кВт</span>`}; M=${M} в резерве; <b>Σ qty=${qty} шт</b>
        </p>
      `;
      wrap.appendChild(redundancyHtml);
      // Wire redundancy/standby selects
      redundancyHtml.querySelector('#cl-opt-redundancy-mode')?.addEventListener('change', (e) => {
        opt.redundancyMode = e.target.value;
        if (Array.isArray(opt.equipment) && opt.equipment[0]) {
          const { N, M, qty } = deriveAutoQty(targetKw, curSpec.ratedCapKw || 0, opt.redundancyMode);
          opt.equipment[0].redundancyN = N;
          opt.equipment[0].redundancyM = M;
          opt.equipment[0].qty = qty;
        }
        persist(); renderActiveTab();
      });
      redundancyHtml.querySelector('#cl-opt-standby-mode')?.addEventListener('change', (e) => {
        opt.standbyMode = e.target.value;
        if (Array.isArray(opt.equipment) && opt.equipment[0]) {
          opt.equipment[0].standbyMode = opt.standbyMode;
        }
        persist(); renderActiveTab();
      });
      wrap.appendChild(renderChillerSpecForm(curSpec, (next) => {
        const sysTypeChanged = (curSpec.systemType || 'chiller') !== (next.systemType || 'chiller');
        setPrimarySpec(opt, next, sel);
        persist();
        if (sysTypeChanged) renderActiveTab();
        renderSelectionsList();
      }, () => {
        setPrimarySpec(opt, { ...DEFAULT_CHILLER }, sel);
        persist();
        renderActiveTab();
        renderSelectionsList();
      }));
    }
  } else if (_activeTab === 'energy') {
    // v0.60.18: используем simulateOptionTopology для учёта qty + N+R.
    // Per-unit spec → суммарная установленная мощность × N (active) или N+R (hot).
    const pSpec = primarySpec(opt);
    const tMetrics = simulateOptionTopology(opt, hourly, requiredCoolingKwOf(sel));
    const annualEnergyKwh = tMetrics.totalEnergyKwh;
    // Для одно-spec FC summary удобнее показать «per-unit» rows.
    const rows = buildBinData(hourly, pSpec);
    const fcEl = $('cl-fc-summary');
    if (fcEl) {
      fcEl.innerHTML = (pSpec && Number(pSpec.ratedCapKw) > 0)
        ? renderFreeCoolingSummary(rows, pSpec, tariffInDisplayCurrency(), hourly, _currency)
        : '<div class="muted">Задайте Rated capacity > 0 во вкладке ❄ Spec для расчёта.</div>';
    }
    const cvs = $('cl-energy-chart');
    if (cvs) drawChillerEnergyChart(cvs, rows);
    const tbl = $('cl-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  } else if (_activeTab === 'capex') {
    // v0.60.24: option-tab «CAPEX (входные)» — только форма для текущей опции.
    // TCO chart/KPI/Payback переехали в selection-tab «📈 TCO / Payback».
    const fwrap = $('cl-capex-form-wrap');
    if (fwrap) {
      fwrap.innerHTML = '';
      const cf = makeConvertFn();
      opt.eco = { ...opt.eco, costItems: syncCostItemsFromEquipment(opt.eco, opt.equipment, _currency) };
      persist();
      fwrap.appendChild(renderCapexForm(opt.eco, (next) => {
        opt.eco = next;
        persist();
        renderActiveTab();
      }, _currency, cf));
    }
  } else if (_activeTab === 'tco') {
    // v0.60.24: ПОДБОР-уровень. TCO chart + KPI основного + сводка по всем вариантам.
    const convertFn = makeConvertFn();
    const tariffDisp = tariffInDisplayCurrency();
    const reqKw = requiredCoolingKwOf(sel);
    const ordered = orderedOptionsForCompare(sel);
    const allMetrics = compareOptions(ordered, hourly, tariffDisp, _currency, convertFn, reqKw, sel.eco);

    // KPI по основному (★) варианту
    const main = sel.options.find(o => o.id === sel.mainOptionId) || sel.options[0];
    if (main) {
      const mainMetrics = allMetrics.find(m => m.name === main.name) || allMetrics[0];
      const kpi = $('cl-tco-kpi');
      if (kpi && mainMetrics) kpi.innerHTML = renderTcoKpi(mainMetrics.tco, null, _currency);
    }

    const cvs = $('cl-tco-chart');
    if (cvs) drawTcoChart(cvs, allMetrics, _currency);

    // Сводная таблица по вариантам подбора
    const sumWrap = $('cl-tco-summary');
    if (sumWrap) sumWrap.innerHTML = renderTcoSummaryTable(allMetrics, _currency);
  } else if (_activeTab === 'topology') {
    // v0.60.15 (refined): Топология теперь per-OPTION; равзвертка из equipment[].
    // Свойства подбора (selection.general): requiredCoolingKw + safetyMarginPct.
    const cwrap = $('cl-topo-config-wrap');
    if (cwrap) {
      const general = sel.general || { requiredCoolingKw: 0, safetyMarginPct: 20 };
      const targetKw = (general.requiredCoolingKw || 0) * (1 + (general.safetyMarginPct || 0) / 100);
      const installedKw = (opt.equipment || []).reduce((sum, eq) => {
        if (!eq.spec) return sum;
        if (isCracTypeLocal(eq.spec.systemType)) return sum;
        const active = eq.standbyMode === 'hot' ? eq.qty : (eq.redundancyN || eq.qty || 1);
        return sum + (eq.spec.ratedCapKw || 0) * active;
      }, 0);
      const eqRows = (opt.equipment || []).map((eq, i) => {
        const isCrac = eq.spec && isCracTypeLocal(eq.spec.systemType);
        return `<tr style="${isCrac ? 'background:#f0f9ff' : 'background:#fffbea'}">
          <td>${isCrac ? '🌬' : '❄'} ${util.escHtml(eq.spec?.name || `Группа ${i+1}`)}</td>
          <td>${util.escHtml(eq.spec?.systemType || '?')}</td>
          <td class="num">${eq.spec?.ratedCapKw || 0}</td>
          <td><input type="number" min="1" max="20" data-eq-i="${i}" data-eq-f="qty" value="${eq.qty || 1}" style="width:60px"></td>
          <td><input type="number" min="1" max="20" data-eq-i="${i}" data-eq-f="redundancyN" value="${eq.redundancyN || 1}" style="width:60px"
                     title="N — штатно работающих в этой группе"></td>
          <td><input type="number" min="0" max="10" data-eq-i="${i}" data-eq-f="redundancyM" value="${eq.redundancyM || 0}" style="width:60px"
                     title="R — в резерве в этой группе. N+R ≤ qty."></td>
          <td><select data-eq-i="${i}" data-eq-f="standbyMode" title="Холодный — резерв off, energy=0. Горячий — резервы работают параллельно с активными.">
                <option value="cold"${eq.standbyMode === 'cold' ? ' selected' : ''}>❄ Холодный</option>
                <option value="hot"${eq.standbyMode === 'hot' ? ' selected' : ''}>🔥 Горячий</option>
              </select></td>
          <td>${(opt.equipment || []).length > 1
            ? `<button type="button" class="cl-btn-ghost" data-eq-del="${i}" title="Удалить группу из опции" style="padding:2px 8px;font-size:11px;color:#991b1b">×</button>`
            : ''}</td>
        </tr>`;
      }).join('');
      cwrap.innerHTML = `
        <h4 title="Топология подбора: оборудование группами + резервирование per-группа.">🔗 Топология «${util.escHtml(opt.name)}»</h4>

        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title" title="Свойства всего ПОДБОРА (общие для всех вариантов): требуемая мощность системы охлаждения и процент запаса. Для всех опций сравниваются на одной целевой мощности.">📋 Свойства подбора (общие)</div>
          <div class="cl-chiller-grid">
            <label title="Суммарная необходимая холодопроизводительность системы (кВт). Должна покрывать IT-нагрузку + потери UPS + теплоприток ограждений + люди.">
              Требуемая мощн., кВт: <input type="number" min="0" step="10" id="cl-sel-required-kw" value="${general.requiredCoolingKw || 0}">
            </label>
            <label title="Процент запаса по мощности. Default 20%. Учитывает рост IT-нагрузки, climate-margin, перегрузки.">
              Запас, %: <input type="number" min="0" max="100" step="5" id="cl-sel-margin-pct" value="${general.safetyMarginPct || 0}">
            </label>
          </div>
          <p class="muted" style="font-size:11.5px;margin:6px 0 0">
            Целевая мощность с запасом: <b>${targetKw.toFixed(0)} кВт</b>. Установлено в этой опции: <b>${installedKw.toFixed(0)} кВт</b> ${installedKw >= targetKw ? '<span style="color:#16a34a">✓</span>' : `<span style="color:#b91c1c">⚠ дефицит ${(targetKw - installedKw).toFixed(0)} кВт</span>`}.
          </p>
        </div>

        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title" title="Резервирование задаётся per-группа оборудования. Внутри одной группы все единицы одинаковы; N — рабочих, M — резерв (cold/hot). v0.60.99: можно добавить несколько групп в одну опцию (например Чиллер + CRAC) для корректного сравнения с self-contained системами (DX).">📐 Группы оборудования + резервирование</div>
          ${(opt.equipment || []).length === 0
            ? '<p class="muted">Нет оборудования. Задайте параметры в табе Spec или добавьте группу ниже.</p>'
            : `<table class="cl-annual-table" style="font-size:12px">
                <thead><tr><th>Имя</th><th>Тип</th><th class="num" title="Rated capacity одной единицы">Rated</th><th title="Количество одинаковых единиц в группе">Qty</th><th title="N — рабочих">N</th><th title="R — в резерве">R</th><th title="Режим резерва">Резерв</th><th></th></tr></thead>
                <tbody>${eqRows}</tbody>
              </table>`}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button type="button" class="cl-btn-primary" id="cl-eq-add-chiller" title="Добавить чиллер в этот подбор. Особенно важно если вы выбрали CRAC — без чиллера CRAC water-cooled не работает (нужна холодная вода). Comparison с DX будет корректным только если в одной опции есть полный комплект оборудования.">➕ Добавить чиллер</button>
            <button type="button" class="cl-btn-ghost" id="cl-eq-add-crac" title="Добавить CRAC. Используется парно с чиллером (CRAC отдаёт тепло в чиллер).">➕ Добавить CRAC</button>
            <button type="button" class="cl-btn-ghost" id="cl-eq-add-dx" title="Добавить self-contained DX-блок (без upstream чиллера).">➕ Добавить DX</button>
          </div>
          <p class="muted" style="font-size:11px;margin:8px 0 0;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:3px">
            💡 <b>Для сравнения «Чиллер+CRAC vs DX»</b> создайте 2 опции в ОДНОМ подборе:<br>
            • <b>Опция A</b>: Чиллер + CRAC (2 группы оборудования) — общий контур.<br>
            • <b>Опция B</b>: DX (1 группа) — self-contained.<br>
            Затем во вкладке «📊 Сравнение» (selection-уровень) увидите side-by-side energy/CAPEX/OPEX/TCO.
          </p>
        </div>

        <div class="cl-chiller-section">
          <div class="cl-chiller-section-title">⚙ Связь между группами</div>
          <div class="cl-chiller-grid">
            <label title="Тип связи между группами оборудования:
• Общий контур — CRAC подключены к общему трубопроводу с резервированными чиллерами.
• Точка-точка — каждый CRAC жёстко привязан к одному чиллеру (1:1).">
              Тип связи:
              <select id="cl-sel-loopmode">
                <option value="common-loop"${(opt.topology?.loopMode || 'common-loop') === 'common-loop' ? ' selected' : ''}>Общий контур</option>
                <option value="p2p"${opt.topology?.loopMode === 'p2p' ? ' selected' : ''}>Точка-точка (1:1)</option>
              </select>
            </label>
          </div>
          <p class="muted" style="font-size:11.5px;margin:8px 0 0;padding:6px 10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:3px" title="Принцип расчёта при нескольких CRAC, подключённых к чиллерам:
1. Каждый CRAC рассчитывается отдельно — energy_CRAC_i = power_per_unit × hours × activeUnits.
2. Тепловая нагрузка на upstream чиллер = Σ cracCoolingLoadKw × activeUnits по всем CRAC-группам (для каждого bin температуры).
3. Эта суммарная нагрузка распределяется РАВНОМЕРНО между всеми активными чиллерами всех групп: load_per_chiller = total_load / Σ activeChillerUnits. Каждый чиллер видит часть нагрузки = load/N (или load/(N+R) для hot-резерва).
4. energy_chiller_i = (load_per_chiller / COP_chiller) × hours × activeUnits.
5. Σ energy системы = Σ energy_CRAC + Σ energy_chiller (cold-резерв = 0).
Так считаются и chiller-only системы (без CRAC) — нагрузка берётся из «Требуемая мощн.» подбора и распределяется на активные чиллеры.">
            ℹ <b>Расчёт при нескольких CRAC ↔ один или несколько чиллеров</b>: общая теплонагрузка от ВСЕХ active CRAC суммируется по интервалам температуры, затем распределяется равномерно между всеми active чиллерами всех групп. Hover на этом блоке для подробностей.
          </p>
        </div>
      `;
      // Wire inputs
      cwrap.querySelectorAll('[data-eq-i]').forEach(inp => {
        inp.addEventListener('change', () => {
          const i = +inp.dataset.eqI;
          const f = inp.dataset.eqF;
          const eq = opt.equipment[i]; if (!eq) return;
          const v = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
          eq[f] = v;
          // Гарантируем N+R ≤ qty
          if (f === 'qty') {
            if (eq.redundancyN > eq.qty) eq.redundancyN = eq.qty;
            if (eq.redundancyN + eq.redundancyM > eq.qty) eq.redundancyM = Math.max(0, eq.qty - eq.redundancyN);
          }
          if (f === 'redundancyN' && eq.redundancyN + eq.redundancyM > eq.qty) {
            eq.redundancyM = Math.max(0, eq.qty - eq.redundancyN);
          }
          if (f === 'redundancyM' && eq.redundancyN + eq.redundancyM > eq.qty) {
            eq.redundancyM = Math.max(0, eq.qty - eq.redundancyN);
            inp.value = eq.redundancyM;
          }
          persist(); renderActiveTab();
        });
      });
      const reqInp = cwrap.querySelector('#cl-sel-required-kw');
      if (reqInp) reqInp.addEventListener('change', () => {
        if (!sel.general) sel.general = {};
        sel.general.requiredCoolingKw = Number(reqInp.value) || 0;
        persist(); renderActiveTab();
      });
      const marInp = cwrap.querySelector('#cl-sel-margin-pct');
      if (marInp) marInp.addEventListener('change', () => {
        if (!sel.general) sel.general = {};
        sel.general.safetyMarginPct = Number(marInp.value) || 0;
        persist(); renderActiveTab();
      });
      const loopSel = cwrap.querySelector('#cl-sel-loopmode');
      if (loopSel) loopSel.addEventListener('change', () => {
        if (!opt.topology) opt.topology = {};
        opt.topology.loopMode = loopSel.value;
        persist(); renderActiveTab();
      });
      // v0.60.99: «+ Добавить чиллер/CRAC/DX» в топологии — добавляет вторую (или N-ю)
      // группу оборудования в опцию. Решает проблему «как сравнить Чиллер+CRAC с DX»:
      // надо чтобы все компоненты решения были в одной опции.
      const _addEqBtn = (selector, kind) => {
        const btn = cwrap.querySelector(selector);
        if (!btn) return;
        btn.addEventListener('click', () => {
          if (!opt.equipment) opt.equipment = [];
          const defaults = {
            chiller:    { name: 'Новый чиллер',    systemType: 'chiller', ratedCapKw: 200, ratedCOP: 3.5, freeCoolingMode: 'dry', chwsTemp: 7, freeCoolingApproach: 5 },
            crac:       { name: 'Новый CRAC',      systemType: 'crac-water', ratedCapKw: 50, ratedCOP: 30 },
            dx:         { name: 'Новый DX-блок',   systemType: 'dx-air', ratedCapKw: 100, ratedCOP: 3.2 },
          };
          const newSpec = { ...defaults[kind] };
          opt.equipment.push({
            id: `eq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,
            spec: newSpec,
            qty: 1, redundancyN: 1, redundancyM: 0, standbyMode: 'cold',
            role: kind === 'crac' ? 'crac' : kind === 'chiller' ? 'chiller' : 'dx',
          });
          persist(); renderActiveTab();
          util.toast(`✓ Добавлена группа «${newSpec.name}». Откройте таб «⚙ Spec» для настройки параметров.`, 'ok');
        });
      };
      _addEqBtn('#cl-eq-add-chiller', 'chiller');
      _addEqBtn('#cl-eq-add-crac', 'crac');
      _addEqBtn('#cl-eq-add-dx', 'dx');
      // v0.60.99: удаление equipment-группы
      cwrap.querySelectorAll('[data-eq-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.eqDel;
          if (!opt.equipment || opt.equipment.length <= 1) return;
          const eq = opt.equipment[i];
          if (!eq) return;
          opt.equipment.splice(i, 1);
          persist(); renderActiveTab();
          util.toast(`✓ Удалена группа «${eq.spec?.name || ''}»`, 'info');
        });
      });
    }
    // Per-equipment results через новый simulateOptionTopology
    let metrics = simulateOptionTopology(opt, hourly, requiredCoolingKwOf(sel));
    // v0.60.64: нормализация на 1 год для multiyear-датасетов.
    // simulateOptionTopology суммирует по hourly без учёта длины периода;
    // для отчётов лучше показывать annual-значения, а не period-totals.
    const totalH = (metrics.bins || []).reduce((s, b) => s + (b.hours || 0), 0) || (hourly?.length || 8760);
    const yrs = totalH > 0 ? totalH / 8760 : 1;
    if (yrs > 1.01 && metrics.perEquipment) {
      metrics = {
        ...metrics,
        totalEnergyKwh: (metrics.totalEnergyKwh || 0) / yrs,
        perEquipment: metrics.perEquipment.map(e => ({
          ...e,
          energyKwh: (e.energyKwh || 0) / yrs,
          // peakKw — это пик мгновенной мощности, не зависит от длины периода
        })),
        yearsInPeriod: yrs,
      };
    }
    const rwrap = $('cl-topo-results');
    if (rwrap) rwrap.innerHTML = renderTopologyResults(metrics, _currency, tariffInDisplayCurrency());
  } else if (_activeTab === 'compare') {
    const tbl = $('cl-compare-table');
    if (tbl) {
      const convertFn = makeConvertFn();
      let ordered;
      if (_compareMode === 'selections') {
        // v0.60.8 (Phase 22.11): сравнение ★-главных вариантов всех подборов
        // проекта между собой. Имена в comparison — это имена подборов
        // (не имена вариантов), чтобы было видно: «Чиллер vs DX vs Mixed»
        // вместо «Опция 1 vs Опция 1 vs Опция 1».
        ordered = _selections.map(s => {
          const main = s.options.find(o => o.id === s.mainOptionId) || s.options[0];
          if (!main) return null;
          return { ...main, name: s.name };   // override имени для compare-таблицы
        }).filter(Boolean);
        if (!ordered.length) {
          tbl.innerHTML = '<div class="muted">Нет ★-главных вариантов в подборах проекта.</div>';
          return;
        }
      } else {
        ordered = orderedOptionsForCompare(sel);
      }
      // v0.60.21: для compare-mode='selections' каждая опция приходит из
      // своего подбора с разной requiredCoolingKw. Передаём 0 → fallback на
      // active-chiller-load (каждая опция по-прежнему симулируется через её
      // собственное option.equipment[]).
      const reqKw = (_compareMode === 'selections') ? 0 : requiredCoolingKwOf(sel);
      // v0.60.25: для variants-mode используем sel.eco (общие финпараметры);
      // для selections-mode у каждого подбора свой sel.eco — не override'им.
      const ecoOverride = (_compareMode === 'selections') ? null : sel.eco;
      const metrics = compareOptions(ordered, hourly, tariffInDisplayCurrency(), _currency, convertFn, reqKw, ecoOverride);
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

/* v0.60.24: компактная сводная таблица TCO для всех вариантов подбора. */
function renderTcoSummaryTable(metrics, currency) {
  if (!metrics || !metrics.length) return '<p class="muted">Нет вариантов для сводки.</p>';
  const cur = currency || '₽';
  const fmt = (v) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ' + cur;
  const rows = metrics.map((m, i) => `
    <tr ${i === 0 ? 'style="background:#fef3c7"' : ''}>
      <td title="${i === 0 ? 'Основной (★) вариант — baseline для payback' : ''}">${i === 0 ? '★ ' : ''}${util.escHtml(m.name)}</td>
      <td class="num" title="Σ qty × ratedCap активных единиц">${Math.round(m.installedKw || 0)} кВт</td>
      <td class="num" title="Capital expenses (год 0)">${fmt(m.tco.capex || 0)}</td>
      <td class="num" title="Годовое OPEX = energy × tariff в первый год">${fmt(m.fc.costRub || 0)}</td>
      <td class="num" title="Total Cost of Ownership (NPV)">${fmt(m.tco.tco || 0)}</td>
      <td class="num" title="Среднегодовая стоимость владения">${fmt(m.tco.averageRubPerYear || 0)}</td>
      <td title="Discounted payback относительно основного варианта">${i === 0 ? 'baseline' : (m.payback ? (m.payback.neverPaysBack ? `> ${m.tco.projectLifetimeYears} лет` : `${m.payback.exact.toFixed(1)} лет`) : '—')}</td>
    </tr>
  `).join('');
  return `<table class="cl-annual-table" style="font-size:12px;width:100%">
    <thead><tr>
      <th title="Имя варианта">Вариант</th>
      <th class="num" title="Установленная мощность системы">Установлено</th>
      <th class="num" title="CAPEX (год 0)">CAPEX</th>
      <th class="num" title="OPEX за первый год">OPEX/год</th>
      <th class="num" title="TCO (NPV)">TCO</th>
      <th class="num" title="Σ TCO / lifetime">Средн./год</th>
      <th title="Discounted payback">Payback</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ----- Init ----- */
async function init() {
  // v0.59.995: режим работы модуля (standalone / embed / project).
  const nav = detectNavMode();
  _navMode = nav.mode;
  _navReturn = nav.return;
  _standalone = (_navMode === 'standalone');
  if (!_standalone) {
    // v0.60.18: уважать ?pid=<id> в URL (из переключателя контекста).
    // v0.60.53 (по репорту «попадаю в другой проект»): ТАКЖЕ принимаем
    // ?project=<id> из buildModuleHref (project-context.js использует
    // именно этот key — раньше cooling его игнорировал → defaultil к
    // первому проекту).
    const params = new URLSearchParams(location.search);
    const urlPid = params.get('pid') || params.get('project');
    if (urlPid) {
      const proj = getProject(urlPid);
      if (proj) {
        setActiveProjectId(urlPid);
        _pid = proj;
      } else {
        console.warn('[cooling v0.60.53] ?pid/project=' + urlPid + ' не найден среди проектов — fallback на default');
        _pid = ensureDefaultProject();
      }
    } else {
      // v0.60.439 (по замечанию Пользователя 2026-05-15: «не нужно в
      // нескольких местах отображать разные проекты»): без ?pid берём
      // АКТИВНЫЙ проект из шапки (единый источник), а не первый/default —
      // иначе cooling показывал другой проект, чем бейдж в шапке.
      const aid = (() => { try { return getActiveProjectId(); } catch { return null; } })();
      _pid = (aid && getProject(aid)) || ensureDefaultProject();
    }
  }

  // v0.60.54 (Phase 34): preload meteo-датасетов из IndexedDB перед первым render.
  // Иначе getActiveMeteoDataset() (sync) вернёт пусто, хотя в IDB всё есть.
  if (_pid?.id) {
    try { await preloadMeteoForPid(_pid.id); } catch (e) { console.warn('[cooling] preload meteo failed:', e); }
  }

  // v0.60.18: миграция данных из legacy-пути 'raschet.project.[object Object].cooling.*'
  // (баг до v0.60.17: storageKey передавал _pid OBJECT в projectKey вместо .id).
  // Копируем в правильный pid-namespace, если там ещё пусто.
  migrateLegacyObjectObjectKeys();

  _activeCols = loadJson(KEY_COLS, _activeCols);
  // v0.60.98 (Пользователь 2026-05-03 «тариф на электроэнергию синхронизировать
  // или объединить для всего проекта»): сначала читаем project.economics
  // (если есть), потом per-cooling override (если был).
  let projectEco = null;
  if (!_standalone && _pid?.id) {
    try {
      const proj = getProject(_pid.id);
      projectEco = proj?.economics || null;
    } catch {}
  }
  if (projectEco) {
    if (typeof projectEco.displayCurrency === 'string') _currency = projectEco.displayCurrency;
    if (Number.isFinite(Number(projectEco.tariffPerKwh))) _tariffRubKwh = Number(projectEco.tariffPerKwh);
    if (typeof projectEco.tariffCurrency === 'string') _tariffCurrency = projectEco.tariffCurrency;
    if (typeof projectEco.ratesDate === 'string') _ratesDate = projectEco.ratesDate;
    console.info('[cooling v0.60.98] use project economics:', projectEco);
    // Show hint badge in sidebar header
    setTimeout(() => {
      const hint = document.getElementById('cl-eco-hint');
      if (hint) hint.style.display = 'inline';
    }, 0);
  }
  // Per-cooling override (если был ранее установлен)
  const t = Number(loadJson(KEY_TARIFF, null));
  if (Number.isFinite(t) && t >= 0 && !projectEco) _tariffRubKwh = t;
  const savedCur = loadJson(KEY_CURRENCY, null);
  if (typeof savedCur === 'string' && savedCur && !projectEco) _currency = savedCur;
  // v0.60.18: тариф может быть в любой валюте; default = валюта проекта.
  const savedTarCur = loadJson(KEY_TARIFF_CUR, null);
  if (typeof savedTarCur === 'string' && savedTarCur && !projectEco) _tariffCurrency = savedTarCur;
  if (!_tariffCurrency) _tariffCurrency = _currency;

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

  // Phase 30.1 (v0.60.66): обработка prefill-payload от tech-workspace.
  // Если в LS есть свежий (< 60 сек) raschet.cooling.prefill.v1 для текущего
  // pid — создаём новый подбор с requiredCoolingKw из концепции и удаляем
  // payload (одноразовое применение).
  try {
    const prefillRaw = localStorage.getItem('raschet.cooling.prefill.v1');
    if (prefillRaw) {
      const prefill = JSON.parse(prefillRaw);
      const isRecent = (Date.now() - (prefill.ts || 0)) < 60000;
      if (isRecent && prefill.projectId === _pid?.id && Number(prefill.requiredCoolingKw) > 0) {
        const sel = makeNewSelection(`Подбор для концепции${prefill.locationName ? ` (${prefill.locationName})` : ''}`);
        sel.general.requiredCoolingKw = Number(prefill.requiredCoolingKw);
        sel.general.safetyMarginPct = 20;
        _selections.unshift(sel);
        _activeSelectionId = sel.id;
        try { localStorage.removeItem('raschet.cooling.prefill.v1'); } catch {}
        util.toast(`📥 Создан подбор для концепции: req = ${sel.general.requiredCoolingKw} кВт. Добавьте варианты оборудования через «+ Вариант».`, 'ok');
      }
    }
  } catch (e) { console.warn('[cooling] prefill apply failed:', e); }

  // v0.60.7 (Phase 22.10.1): миграция option → equipment[] + topology per option.
  migrateSelectionsToComplex();

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
    curSel.addEventListener('change', () => {
      const oldCur = _currency;
      const newCur = curSel.value || '₽';
      if (oldCur === newCur) return;

      // v0.60.18: тариф ТЕПЕРЬ хранится в собственной валюте (_tariffCurrency)
      // и автоматически конвертируется в валюту проекта при расчётах через
      // tariffInDisplayCurrency(). Поэтому смена валюты проекта НЕ требует
      // никакой ручной конвертации тарифа — он останется в той же native-валюте.
      _currency = newCur;
      persist();
      renderActiveTab();
    });
  }

  // Tariff-currency select v0.60.18 — заполняем после _currency установлено
  const tarCurSel = $('cl-tariff-cur');
  if (tarCurSel) {
    tarCurSel.innerHTML = CURRENCIES.map(c =>
      `<option value="${c.code}"${c.code === _tariffCurrency ? ' selected' : ''} title="${c.label}">${c.code}</option>`
    ).join('');
    tarCurSel.addEventListener('change', async () => {
      const oldCur = _tariffCurrency;
      const newCur = tarCurSel.value || _currency;
      if (oldCur === newCur) return;
      // Авто-пересчёт тарифа по курсу при смене валюты тарифа.
      let newVal = _tariffRubKwh;
      if (_tariffRubKwh > 0) {
        await ensureRatesLoaded();
        const cf = makeConvertFn();
        if (cf) {
          const v = cf(_tariffRubKwh, oldCur, newCur);
          if (Number.isFinite(v) && v > 0) {
            newVal = +(v.toFixed(4));
            util.toast(`Тариф пересчитан: ${_tariffRubKwh} ${oldCur} → ${newVal} ${newCur}`, 'ok');
          } else {
            util.toast(`Курс ${oldCur}→${newCur} не найден. Тариф сохранён без пересчёта.`, 'err');
          }
        } else {
          util.toast(`Курсы валют ещё не загружены. Тариф сохранён без пересчёта.`, 'err');
        }
      }
      _tariffRubKwh = newVal;
      _tariffCurrency = newCur;
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

  // v0.60.0: Дата курса валют (применяется ко всем конвертациям).
  const dateInp = $('cl-rates-date');
  if (dateInp) {
    dateInp.value = _ratesDate;
    dateInp.max = new Date().toISOString().slice(0, 10);
    dateInp.addEventListener('change', async () => {
      const newDate = dateInp.value;
      if (!newDate || newDate === _ratesDate) return;
      _ratesDate = newDate;
      try { localStorage.setItem('cooling.ratesDate.v1', _ratesDate); } catch {}
      // Принудительно сбрасываем кеш и перегружаем на новую дату.
      _ratesCache = null;
      await ensureRatesLoaded();
      renderActiveTab();
      util.toast(`📅 Курсы валют — на ${_ratesDate}${_ratesCache ? ` (источник: ${_ratesCache.base})` : ''}`, 'ok');
    });
  }

  // Кнопка курсов валют
  const ratesBtn = $('cl-rates-btn');
  if (ratesBtn) {
    ratesBtn.addEventListener('click', () => {
      openRatesDialog();
    });
  }

  // Phase 35: handlers «📜 Журнал» и «🗑 Корзина».
  const histBtn = $('cl-btn-history');
  if (histBtn) histBtn.addEventListener('click', openCoolingHistoryModal);
  const trashBtn = $('cl-btn-trash');
  if (trashBtn) trashBtn.addEventListener('click', openCoolingTrashModal);
  refreshCoolingTrashCount();

  // v0.60.1: «📅 Открыть Метеоданные →» в EMBED-режиме.
  // По требованию: «я так и не смог перейти в модуль Метеоданные и
  // вернуться с выбором другого местоположения».
  const openMeteoBtn = $('cl-open-meteo');
  if (openMeteoBtn) {
    openMeteoBtn.addEventListener('click', () => {
      // openEmbed: записывает return URL+sessionId в URL → location.href
      // редиректит в /meteo/?return=...&returnSession=...&returnLabel=Cooling
      // v0.60.33 fix: location.pathname + location.search чтобы при возврате
      // не потерять ?pid=... (был баг «при возврате из метео сломалось» —
      // cooling сваливался на default-проект).
      openEmbed(location.pathname + location.search, '../meteo/', 'Подбор холодильных систем');
    });
  }

  // v0.60.1: при возврате из embed-меteo — применить выбранный датасет.
  // readEmbedResult() читает payload из LS-bridge и удаляет ключ.
  const embedResult = readEmbedResult();
  if (embedResult && embedResult.datasetId) {
    util.toast(`✔ Получено из Метеоданных: ${embedResult.datasetName || embedResult.datasetId}${embedResult.locationName ? ` (${embedResult.locationName})` : ''}`, 'ok');
    // Активный датасет meteo переключается через project-storage. Найдём
    // и пометим ⭐ для проекта (тогда meteo-bridge.getActiveMeteoDataset
    // на следующем чтении вернёт этот датасет).
    try {
      const KEY_META_DATA = ['meteo', 'datasets.v1'];
      const KEY_META_ACTIVE = ['meteo', 'activeId.v1'];
      const datasets = JSON.parse(localStorage.getItem(projectKey(_pid?.id, ...KEY_META_DATA)) || '[]');
      for (const d of datasets) d.activeForProject = (d.id === embedResult.datasetId);
      localStorage.setItem(projectKey(_pid?.id, ...KEY_META_DATA), JSON.stringify(datasets));
      localStorage.setItem(projectKey(_pid?.id, ...KEY_META_ACTIVE), JSON.stringify(embedResult.datasetId));
    } catch {}
    // v0.60.30 (по репорту: «не обновляется местоположение из модуля метео»):
    // обновить project.location координатами выбранного датасета. Без этого
    // другие модули (psychrometrics, tech-workspace) продолжают видеть
    // старое местоположение проекта.
    try {
      if (!_standalone && _pid?.id && (embedResult.lat != null || embedResult.locationName)) {
        const projModule = await import('../shared/project-storage.js');
        const proj = projModule.getProject(_pid.id);
        if (proj) {
          const newLoc = {
            city: embedResult.locationName || proj.location?.city || '',
            country: proj.location?.country || '',
            lat: embedResult.lat ?? proj.location?.lat ?? null,
            lon: embedResult.lon ?? proj.location?.lon ?? null,
          };
          projModule.updateProject(_pid.id, { location: newLoc });
          _pid = projModule.getProject(_pid.id);  // refresh _pid object
          util.toast(`📍 Местоположение проекта обновлено: ${newLoc.city || ''} ${newLoc.lat?.toFixed(3) || '?'}, ${newLoc.lon?.toFixed(3) || '?'}`, 'info');
        }
      }
    } catch (e) {
      console.error('[cooling] Не удалось обновить project.location:', e);
    }
  }

  // Tab navigation
  document.querySelectorAll('.cl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      // v0.60.24: клик по tab переключает focus в соответствии со scope
      const scope = btn.dataset.scope;
      if (scope) _focus = scope;
      renderActive();
    });
  });

  // v0.60.8 (Phase 22.11): compare-mode select
  document.addEventListener('change', (e) => {
    if (e.target?.id === 'cl-compare-mode') {
      _compareMode = e.target.value || 'variants';
      if (_activeTab === 'compare') renderActiveTab();
    }
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
      // v0.60.23: клик по подбору → focus = selection (только selection-tabs)
      _focus = 'selection';
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
        // v0.60.23: клик по варианту → focus = option (только option-tabs)
        _focus = 'option';
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

// =============================================================================
// Phase 35: модалки «📜 История» и «🗑 Корзина» в cooling
// =============================================================================
// Cooling показывает ВСЮ историю проекта (cross-module): meteo-импорты,
// будущие datasheets, BOM-импорты. Сейчас фактически только meteo-events
// + cooling-импорты с триггером. Удаление meteo-датасета через cooling-UI
// напрямую не предусмотрено — только через /meteo/.

const CL_ACTION_LABELS = {
  'import':  { icon: '➕', label: 'Импорт', color: '#0d8a4e' },
  'update':  { icon: '✏', label: 'Обновлено', color: '#0369a1' },
  'delete':  { icon: '🗑', label: 'Удалено', color: '#92400e' },
  'restore': { icon: '↩', label: 'Восстановлено', color: '#7c3aed' },
  'purge':   { icon: '✕', label: 'Удалено навсегда', color: '#991b1b' },
};
const CL_MODULE_ICONS = {
  'meteo': '🌤',
  'cooling': '❄',
  'service': '🛠',
  'ups-config': '🔋',
  'mdc-config': '🏗',
};

function clFmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

async function refreshCoolingTrashCount() {
  if (!_pid?.id) {
    const span = $('cl-trash-count');
    if (span) span.textContent = '';
    return;
  }
  try {
    const trash = await historyTrash(_pid.id);
    const span = $('cl-trash-count');
    if (span) span.textContent = trash.length ? `(${trash.length})` : '';
  } catch (e) {
    console.warn('[cooling] refreshTrashCount failed:', e);
  }
}

async function openCoolingHistoryModal() {
  if (!_pid?.id) {
    util.toast('История доступна только в project-mode', 'err');
    return;
  }
  const events = await historyList(_pid.id);
  events.sort((a, b) => b.ts - a.ts);

  const rowsHtml = events.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px">Нет событий. Импортируйте датасет — появится в журнале.</td></tr>`
    : events.map(ev => {
        const meta = CL_ACTION_LABELS[ev.action] || { icon: '?', label: ev.action, color: '#64748b' };
        const modIcon = CL_MODULE_ICONS[ev.module] || '📦';
        return `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:6px 8px;font-size:11.5px;color:#475569;white-space:nowrap">${util.escHtml(clFmtTs(ev.ts))}</td>
          <td style="padding:6px 8px;font-size:12px" title="Модуль ${util.escAttr(ev.module)}">${modIcon} ${util.escHtml(ev.module)}</td>
          <td style="padding:6px 8px;font-size:12px"><span style="color:${meta.color}">${meta.icon} ${util.escHtml(meta.label)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${util.escHtml(ev.itemName || ev.itemId || '—')}</td>
          <td style="padding:6px 8px;font-size:11px;color:#64748b">${util.escHtml(ev.source || '')}${ev.payload?.triggeredFrom ? ` <span title="Из какого модуля инициирован" style="opacity:0.7">(${util.escHtml(ev.payload.triggeredFrom)})</span>` : ''}</td>
        </tr>`;
      }).join('');

  await util.modalOpen(
    '<h3>📜 История данных проекта</h3>',
    `<div style="max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Время</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Модуль</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Событие</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Объект</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Источник</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:8px;font-size:11px">Всего событий: ${events.length}. Журнал per-project, append-only. Кросс-модульная история: meteo, cooling, и др.</p>`,
    async () => null
  );
}

async function openCoolingTrashModal() {
  if (!_pid?.id) {
    util.toast('Корзина доступна только в project-mode', 'err');
    return;
  }
  const trash = await historyTrash(_pid.id);
  trash.sort((a, b) => b.ts - a.ts);

  const rowsHtml = trash.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px">Корзина пуста.</td></tr>`
    : trash.map(ev => {
        const modIcon = CL_MODULE_ICONS[ev.module] || '📦';
        return `<tr style="border-bottom:1px solid #f1f5f9" data-ev-id="${util.escAttr(ev.id)}">
          <td style="padding:6px 8px;font-size:11.5px;color:#475569;white-space:nowrap">${util.escHtml(clFmtTs(ev.ts))}</td>
          <td style="padding:6px 8px;font-size:12px" title="${util.escAttr(ev.module)}">${modIcon}</td>
          <td style="padding:6px 8px;font-size:12px">${util.escHtml(ev.itemName || ev.itemId || '—')}</td>
          <td style="padding:6px 8px;font-size:11px;color:#64748b">${util.escHtml(ev.source || '')}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap">
            <button type="button" data-trash-act="restore" data-ev-id="${util.escAttr(ev.id)}" style="padding:3px 8px;font-size:11px;border:1px solid #7c3aed;background:#f5f3ff;color:#7c3aed;border-radius:3px;cursor:pointer;margin-right:4px" title="Восстановление производится в исходном модуле. Откройте этот модуль и нажмите Restore.">↩ Восстановить</button>
            <button type="button" data-trash-act="purge" data-ev-id="${util.escAttr(ev.id)}" style="padding:3px 8px;font-size:11px;border:1px solid #991b1b;background:#fef2f2;color:#991b1b;border-radius:3px;cursor:pointer" title="Удалить навсегда — освобождает место в IDB.">✕ Навсегда</button>
          </td>
        </tr>`;
      }).join('');

  await util.modalOpen(
    '<h3>🗑 Корзина проекта</h3>',
    `<div style="max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px">
      <table id="cl-trash-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Удалено</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Модуль</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Объект</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Источник</th>
            <th style="padding:6px 8px;text-align:right;font-weight:600;border-bottom:2px solid #cbd5e1">Действие</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:8px;font-size:11px">В корзине: ${trash.length}. Восстановление meteo-датасетов: откройте /meteo/ → 🗑 Корзина → ↩.</p>`,
    async () => null
  );

  const table = document.getElementById('cl-trash-table');
  if (table) {
    table.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-trash-act]');
      if (!btn) return;
      const evId = btn.dataset.evId;
      const act = btn.dataset.trashAct;
      if (act === 'restore') {
        const r = await historyRestore(_pid.id, evId);
        if (!r.ok) { util.toast(`❌ ${r.error}`, 'err'); return; }
        // Cross-module restore: для meteo-dataset пишем данные обратно
        // в IDB и обновляем кэш bridge → cooling сразу увидит.
        // Для других типов пока просим открыть исходный модуль.
        if (r.itemKind === 'meteo-dataset' && r.payload?.dataset) {
          try {
            const { idbGet, idbSet, idbAvailable } = await import('../shared/idb-store.js');
            const idbKey = `meteo.datasets.${_pid.id}`;
            let datasets = idbAvailable() ? (await idbGet(idbKey, [])) : [];
            if (!Array.isArray(datasets)) datasets = [];
            // Снимаем activeForProject со всех остальных — восстанавливаем как ⭐.
            for (const d of datasets) d.activeForProject = false;
            const restored = { ...r.payload.dataset, activeForProject: true };
            // Если уже есть с таким id — обновляем; иначе — добавляем сверху.
            const idx = datasets.findIndex(d => d.id === restored.id);
            if (idx >= 0) datasets[idx] = restored;
            else datasets.unshift(restored);
            if (idbAvailable()) await idbSet(idbKey, datasets);
            // Обновляем bridge-кэш → cooling сразу видит без F5.
            await preloadMeteoForPid(_pid.id);
            renderActive();
            util.toast(`✓ «${r.itemName}» восстановлен в meteo как ⭐активный`, 'ok');
          } catch (e) {
            console.error('[cooling] meteo-dataset restore failed:', e);
            util.toast(`⚠ Запись в логе восстановлена, но датасет не записан в IDB: ${e.message}`, 'err');
          }
        } else {
          util.toast(`✓ Запись восстановлена. Для возврата данных откройте исходный модуль.`, 'ok');
        }
        btn.closest('tr')?.remove();
        await refreshCoolingTrashCount();
      } else if (act === 'purge') {
        const ok = await util.modalOpen('<h3>Удалить навсегда?</h3>', '<p>Восстановить будет нельзя.</p>', async () => true);
        if (!ok) return;
        const r = await historyPurge(_pid.id, evId);
        if (!r.ok) { util.toast(`❌ ${r.error}`, 'err'); return; }
        util.toast('✓ Удалено навсегда', 'ok');
        btn.closest('tr')?.remove();
        await refreshCoolingTrashCount();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[cooling v0.60.34] Fatal init error:', err);
    const el = document.getElementById('cl-storage-mode');
    if (el) el.innerHTML = `<div style="padding:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;font-size:12px;color:#b91c1c">⚠ Ошибка инициализации: ${util.escHtml(err.message || String(err))}. Откройте DevTools → Console.</div>`;
  });
});
