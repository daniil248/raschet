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

import { ensureDefaultProject, projectKey, getProject, setActiveProjectId } from 'shared/project-storage.js';
import { detectNavMode, renderModuleActions, completeReturn, cancelReturn } from 'shared/module-nav.js';
import { idbGet, idbSet, idbDelete, idbAvailable } from 'shared/idb-store.js';
import { historyAppend, historyTrash, historyRestore, historyPurge, historyList } from 'shared/history-log.js';
import * as util from './util.js';
import { getAll as getSources } from './sources/index.js';
import { drawTempHistogram, drawHumidityHistogram, drawMonthlyTempChart, drawWindRose, renderDaysInRangeTable } from './charts.js';
import { renderAshraeDatasheet } from './ashrae-datasheet.js';
// v0.59.991: модуль подбора чиллеров вынесен в /cooling. Meteo теперь
// работает только с климатическими данными. Annual hours table остаётся
// здесь как чисто климатический pivot (без chiller-cols).
import { COLUMNS, DEFAULT_COLS, buildBinData, renderAnnualTable, exportAnnualTableCsv, renderColumnPicker } from './annual-table.js';

const $ = (id) => document.getElementById(id);

let _pid = null;
let _datasets = [];
let _activeId = null;
let _activeTab = 'summary';
let _activeCols = [...DEFAULT_COLS];
// v0.59.986: ГЛОБАЛЬНЫЙ фильтр периода — применяется ко всем вкладкам.
//   mode: 'all' | 'year' | 'period'
//   year: '2023' (string) — используется при mode='year'
//   periodFrom / periodTo: 'YYYY-MM-DD' — при mode='period'
// Заменяет более узкий _annualYear (v0.59.971) — теперь фильтр глобальный.
let _filter = { mode: 'all', year: '', periodFrom: '', periodTo: '' };
let _navMode = null;     // v0.59.995: 'standalone' | 'embed' | 'project'
let _navReturn = null;

const KEY_DATA = ['meteo', 'datasets.v1'];
const KEY_ACTIVE = ['meteo', 'activeId.v1'];
const KEY_COLS = ['meteo', 'annualCols.v1'];
const KEY_FILTER = ['meteo', 'globalFilter.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try { const raw = localStorage.getItem(projectKey(_pid, ...suffix)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try {
    localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value));
  } catch (e) {
    // v0.60.51: явная обработка QuotaExceededError. По репорту: «10 раз
    // загружал meteo Темиртау и ни разу не сохранилось». Корневая причина —
    // ASHRAE 10 лет (87696 точек) ≈ 6-7 MB → превышает LS quota (~5-10MB).
    const isQuota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
    if (isQuota) {
      // Подсчёт занятого места + список крупнейших ключей для подсказки
      let totalKB = 0; const big = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k);
          const sz = (k.length + (v?.length || 0)) * 2 / 1024;
          totalKB += sz;
          if (sz > 50) big.push({ k, kb: Math.round(sz) });
        }
      } catch {}
      big.sort((a, b) => b.kb - a.kb);
      const topList = big.slice(0, 5).map(x => `• ${x.k} — ${x.kb} КБ`).join('\n');
      const msg = `⚠ Превышена квота LocalStorage (~${Math.round(totalKB)} КБ занято). Большой meteo-датасет (${suffix.join('.')}) НЕ сохранён. Топ-5 крупных ключей:\n${topList}\n\nРешение: откройте DevTools → Application → Local Storage и удалите stale-данные (например legacy [object Object] namespace), либо используйте более короткий период meteo.`;
      console.error('[meteo v0.60.51] LS quota exceeded:', msg);
      try { util.toast('⚠ Не удалось сохранить — превышена квота LocalStorage. См. console.', 'err'); } catch {}
    } else {
      console.error('[meteo] saveJson error:', e);
    }
  }
}

/* v0.60.54 (Phase 34): datasets — большие, идут в IDB. Метаданные (activeId,
   cols, filter) — маленькие, остаются в LS. */
function idbDatasetsKey() {
  return _pid ? `meteo.datasets.${_pid}` : null;
}
async function persist() {
  // Datasets → IDB (если доступен), иначе fallback в LS с risk quota
  if (idbAvailable() && idbDatasetsKey()) {
    try {
      await idbSet(idbDatasetsKey(), _datasets);
    } catch (e) {
      console.error('[meteo] idb persist failed:', e);
      saveJson(KEY_DATA, _datasets);  // last-resort
    }
  } else {
    saveJson(KEY_DATA, _datasets);
  }
  // Маленькие — в LS
  saveJson(KEY_ACTIVE, _activeId);
  saveJson(KEY_COLS, _activeCols);
  saveJson(KEY_FILTER, _filter);
}

/* v0.59.986: Применить глобальный фильтр к hourly. Возвращает массив
   записей за выбранный период (YYYY-MM-DD сравнивается лексикографически
   на префиксе, что корректно для ISO-8601 дат). */
function getFilteredHourly(d) {
  const all = (d && d.hourly) || [];
  if (!all.length) return all;
  const f = _filter || { mode: 'all' };
  if (f.mode === 'year' && f.year) {
    const prefix = String(f.year);
    return all.filter(h => (h.t || '').startsWith(prefix));
  }
  if (f.mode === 'period') {
    const from = f.periodFrom || '';
    const to = f.periodTo || '';
    return all.filter(h => {
      const t = (h.t || '').slice(0, 10);
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }
  return all;
}

/* Описание выбранного фильтра коротко (для info-блока и tooltip) */
function describeFilter(filteredCount, totalCount) {
  const f = _filter || { mode: 'all' };
  let desc;
  if (f.mode === 'year' && f.year)        desc = `год ${f.year}`;
  else if (f.mode === 'period')           desc = `${f.periodFrom || '?'} — ${f.periodTo || '?'}`;
  else                                    desc = 'все годы';
  return `${desc}: ${filteredCount} записей${totalCount && totalCount !== filteredCount ? ` из ${totalCount}` : ''}`;
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
  await persist();
  renderDatasetsList();
  renderActive();
  // Phase 35: записываем в history-log как событие импорта.
  // payload включает данные для возможности restore из корзины.
  if (_pid) {
    historyAppend(_pid, {
      module: 'meteo',
      action: 'import',
      itemKind: 'meteo-dataset',
      itemId: dataset.id,
      itemName: dataset.name,
      source: dataset.source,
      payload: { dataset },
    });
  }
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

// ─── v0.60.31: жирный embed-баннер сверху content
function renderEmbedBanner() {
  const banner = $('mt-embed-banner');
  if (!banner) return;
  if (_navMode !== 'embed' || !_navReturn) {
    banner.hidden = true;
    return;
  }
  const d = _datasets.find(x => x.id === _activeId);
  const hasActive = !!d;
  banner.hidden = false;
  banner.style.cssText = 'margin:8px 0 12px;padding:10px 14px;background:linear-gradient(90deg,#fef3c7,#fffbeb);border:2px solid #f59e0b;border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
  banner.innerHTML = `
    <div style="font-size:13px;color:#78350f">
      🔗 <b>Embed-режим</b>: вы выбираете датасет для модуля «${util.escHtml(_navReturn.label || 'исходный')}».
      ${hasActive ? `Активный: <b>${util.escHtml(d.name)}</b> (${util.escHtml(d.locationName || '')}, ${d.lat?.toFixed(3) || '?'}, ${d.lon?.toFixed(3) || '?'}).` : '⚠ Выберите датасет в списке слева, или импортируйте новый.'}
    </div>
    <div style="display:flex;gap:6px">
      <button type="button" id="mt-embed-apply" ${hasActive ? '' : 'disabled style="opacity:0.4;cursor:not-allowed"'}
              style="padding:8px 16px;background:#16a34a;color:#fff;border:1px solid #16a34a;border-radius:4px;cursor:pointer;font:inherit;font-size:13px;font-weight:600"
              title="Применить выбранный датасет и вернуться в исходный модуль. project.location обновится координатами этого датасета.">
        ✓ Применить и вернуться
      </button>
      <button type="button" id="mt-embed-cancel"
              style="padding:8px 14px;background:#fff;color:#475569;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font:inherit;font-size:12.5px"
              title="Вернуться без передачи датасета.">
        ✗ Отмена
      </button>
    </div>
  `;
  const applyBtn = banner.querySelector('#mt-embed-apply');
  if (applyBtn && hasActive) applyBtn.addEventListener('click', () => {
    const payload = {
      datasetId: d.id, datasetName: d.name,
      locationName: d.locationName || '',
      lat: d.lat || null, lon: d.lon || null,
      dateFrom: d.dateFrom || null, dateTo: d.dateTo || null,
      recordsCount: (d.hourly || []).length,
    };
    completeReturn(_navReturn, payload);
  });
  const cancelBtn = banner.querySelector('#mt-embed-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelReturn(_navReturn));
}

// ─── Render: активный датасет
function renderActive() {
  // v0.59.995: cross-links / return-buttons.
  // v0.60.220 (по репорту Пользователя 2026-05-04 «зачем две кнопки, оставь
  // одну, которая работает»): в embed-mode полагаемся ТОЛЬКО на жирный
  // жёлтый баннер renderEmbedBanner ниже — он информативнее (показывает
  // активный dataset, локацию, координаты). Дублирующая кнопка из
  // renderModuleActions в шапке актива убрана. В project-mode по-прежнему
  // используется renderModuleActions для cross-links.
  const actionsEl = $('mt-content-actions');
  if (actionsEl) {
    if (_navMode === 'embed') {
      actionsEl.innerHTML = '';
    } else {
      renderModuleActions(actionsEl, {
        navContext: { mode: _navMode, return: _navReturn },
        crossLinks: [
          // В project-mode показываем cross-link на cooling. По требованию:
          // «А вот ссылка Подбор холодильных систем может быть доступна
          // только если у пользователя есть доступ к этому модулю» —
          // permissions пока не реализованы, делаем всегда видимым TODO.
          { href: '../apps/cooling/', label: '❄ Подбор холодильных систем →',
            title: 'Перейти в модуль «Подбор холодильных систем» — расчёт чиллеров/DX/free-cooling по этим климатическим данным.' },
        ],
        getPayload: () => {
          const d = _datasets.find(x => x.id === _activeId);
          return {
            datasetId: d?.id || null,
            datasetName: d?.name || null,
            locationName: d?.locationName || null,
            lat: d?.lat || null,
            lon: d?.lon || null,
            dateFrom: d?.dateFrom || null,
            dateTo: d?.dateTo || null,
            recordsCount: (d?.hourly || []).length,
          };
        },
      });
    }
  }
  // v0.60.31: жирный embed-баннер сверху + кнопка «✓ Выбрать ЭТОТ датасет
  // и вернуться» — пользователь должен сразу понимать что он в embed-режиме
  // и как вернуться. По репорту: «назад в модуль подбора холода не передаёт».
  renderEmbedBanner();

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
  const totalN = (d.hourly || []).length;
  $('mt-active-meta').textContent = `${d.locationName || ''} · ${d.lat ? d.lat.toFixed(3) : '—'}, ${d.lon ? d.lon.toFixed(3) : '—'}${d.stationId ? ' · ICAO ' + d.stationId : ''} · ${d.dateFrom || ''}—${d.dateTo || ''} · ${totalN} записей всего`;

  // v0.59.986: фильтруем hourly один раз, передаём всем рендерерам
  const filteredHourly = getFilteredHourly(d);
  // Recompute stats на фильтрованных
  const s = util.computeStats(filteredHourly);
  $('mt-kpi-tmean').textContent = `${s.tmean} °C`;
  $('mt-kpi-tmin').textContent = `${s.tmin} °C`;
  $('mt-kpi-tmax').textContent = `${s.tmax} °C`;
  $('mt-kpi-t99').textContent = `${s.t99} °C`;
  $('mt-kpi-fc').textContent = `${s.freecoolHours} ч`;
  $('mt-kpi-n').textContent = `${s.n}`;

  // Заполняем select годов и обновляем info-блок фильтра
  populateFilterYearSelect(d.hourly || []);
  syncFilterUI(d);
  const info = $('mt-filter-info');
  if (info) info.textContent = describeFilter(filteredHourly.length, totalN);

  // Сразу рендерим текущий tab
  renderActiveTab();
}

/* Заполнение select годов из доступных в исходном (нефильтрованном) hourly. */
function populateFilterYearSelect(hourly) {
  const sel = $('mt-filter-year');
  if (!sel) return;
  const years = new Set();
  for (const h of hourly) {
    const y = (h.t || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  const yArr = [...years].sort((a, b) => b.localeCompare(a));
  const cur = _filter.year || sel.value || '';
  sel.innerHTML = yArr.map(y => `<option value="${y}">${y}</option>`).join('');
  if (yArr.includes(cur)) sel.value = cur;
  else if (yArr.length) { sel.value = yArr[0]; _filter.year = yArr[0]; }
}

/* Синхронизировать UI фильтра с текущим состоянием _filter и пределами hourly. */
function syncFilterUI(d) {
  const modeSel = $('mt-filter-mode');
  const yearSel = $('mt-filter-year');
  const periodWrap = $('mt-filter-period-wrap');
  const fromInp = $('mt-filter-from');
  const toInp = $('mt-filter-to');
  if (modeSel) modeSel.value = _filter.mode || 'all';
  if (yearSel) yearSel.hidden = (_filter.mode !== 'year');
  if (periodWrap) periodWrap.hidden = (_filter.mode !== 'period');
  // Заполнить min/max периода границами доступных дат
  if (fromInp && toInp && d) {
    if (d.dateFrom) { fromInp.min = d.dateFrom; toInp.min = d.dateFrom; }
    if (d.dateTo)   { fromInp.max = d.dateTo;   toInp.max = d.dateTo; }
    if (_filter.periodFrom) fromInp.value = _filter.periodFrom;
    else if (d.dateFrom)    fromInp.value = d.dateFrom;
    if (_filter.periodTo)   toInp.value = _filter.periodTo;
    else if (d.dateTo)      toInp.value = d.dateTo;
  }
}

function renderActiveTab() {
  const d = _datasets.find(x => x.id === _activeId);
  if (!d) return;
  document.querySelectorAll('.mt-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
  document.querySelectorAll('.mt-tab-pane').forEach(p => p.hidden = (p.dataset.pane !== _activeTab));

  // v0.59.986: единый источник фильтрованных данных для всех вкладок
  const hourly = getFilteredHourly(d);

  if (_activeTab === 'summary') {
    const cvs = $('mt-hist-canvas');
    if (cvs) drawTempHistogram(cvs, hourly);
    drawSummary(d, util.computeStats(hourly), hourly);
  } else if (_activeTab === 'charts') {
    const cvsRH = $('mt-rh-canvas');
    if (cvsRH) drawHumidityHistogram(cvsRH, hourly);
    const cvsM = $('mt-monthly-canvas');
    if (cvsM) drawMonthlyTempChart(cvsM, hourly);
    const cvsW = $('mt-windrose-canvas');
    if (cvsW) drawWindRose(cvsW, hourly);
    const pivot = $('mt-pivot-table');
    if (pivot) pivot.innerHTML = renderDaysInRangeTable(hourly);
  } else if (_activeTab === 'annual') {
    // v0.59.991: чисто климатический pivot — без chiller. Подбор оборудования
    // вынесен в отдельный модуль /cooling.
    const rows = buildBinData(hourly);
    const tbl = $('mt-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  } else if (_activeTab === 'ashrae') {
    renderAshraeBlock(d, hourly);
  }
}

function drawSummary(d, s, hourly) {
  const sum = $('mt-summary');
  if (!sum) return;
  hourly = hourly || (d.hourly || []);
  const cdd = hourly.reduce((acc, h) => acc + Math.max(0, (Number(h.T) || 0) - 18), 0) / 24;
  const hdd = hourly.reduce((acc, h) => acc + Math.max(0, 18 - (Number(h.T) || 0)), 0) / 24;
  const sortedT = [...hourly.map(h => Number(h.T)).filter(Number.isFinite)].sort((a, b) => a - b);
  const t1 = sortedT.length ? sortedT[Math.floor(sortedT.length * 0.01)] : '—';
  sum.innerHTML = `<table>
    <tbody>
      <tr><th title="Источник метеоданных: open-meteo (REST API), ASHRAE (design conditions), rp5 (CSV-импорт), manual (ручной ввод).">Источник</th><td>${util.escHtml(d.source)}</td></tr>
      <tr><th title="Геолокация площадки: название и координаты (широта, долгота) в десятичных градусах WGS-84.">Локация</th><td>${util.escHtml(d.locationName || '')} (${d.lat?.toFixed(3) || '—'}, ${d.lon?.toFixed(3) || '—'})</td></tr>
      <tr><th title="Период загруженных данных в датасете (исходный, до фильтра). Фильтр применяется через 📅 Период выше.">Период (датасет)</th><td>${util.escHtml(d.dateFrom || '')} — ${util.escHtml(d.dateTo || '')}</td></tr>
      <tr><th title="Heating Degree Days, °C·сут. HDD = Σ max(0, 18 − T_i) / 24. Используется для прикидочной оценки годовой нагрузки на систему отопления (Q ≈ HDD × UA).">HDD (база 18 °C)</th><td class="num">${hdd.toFixed(0)} °C·сут</td></tr>
      <tr><th title="Cooling Degree Days, °C·сут. CDD = Σ max(0, T_i − 18) / 24. Аналогичная метрика для системы охлаждения.">CDD (база 18 °C)</th><td class="num">${cdd.toFixed(0)} °C·сут</td></tr>
      <tr><th title="Часы в году с T_amb < 14°C — потенциал прямого фрикулинга (без чиллера). Косвенный (через теплообменник glycol-loop) расширяет порог до ~18°C.">Часы FreeCool (T &lt; 14 °C)</th><td class="num">${s.freecoolHours} ч (${(s.freecoolHours / Math.max(1, s.n) * 100).toFixed(1)}%)</td></tr>
      <tr><th title="1-й перцентиль температуры — T, ниже которой 1% записей. Используется как «расчётная мин. температура» для систем отопления (более стабильна, чем абсолютный мин).">T 1% (≈ tmin расчётная)</th><td class="num">${typeof t1 === 'number' ? t1.toFixed(1) : t1} °C</td></tr>
    </tbody>
  </table>`;
}

function renderAshraeBlock(d, hourlyOverride) {
  const block = $('mt-ashrae-block');
  if (!block) return;
  // v0.59.986: можно передать фильтрованный hourly (из глобального
  // фильтра периода). Backward-compat: если не передан — используем d.hourly.
  const hourly = hourlyOverride != null ? hourlyOverride : (d.hourly || []);
  if (hourly.length < 24 * 30) {
    block.innerHTML = `<p class="muted">Недостаточно данных в выбранном периоде (${hourly.length} часов). Минимум 30 дней почасовых наблюдений для статистических расчётов.</p>`;
    return;
  }
  // Передаём в renderAshraeDatasheet «виртуальный» dataset с подменённым
  // hourly, чтобы он считал по фильтрованным данным (он использует d.hourly).
  block.innerHTML = renderAshraeDatasheet({ ...d, hourly }, d.locationName || d.name);
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
async function init() {
  // v0.59.995: режим работы (standalone / embed / project) — определяет
  // какие cross-links / return-buttons показать.
  const nav = detectNavMode();
  _navMode = nav.mode;
  _navReturn = nav.return;

  // v0.60.37: уважать ?pid=<id> в URL (был баг — meteo всегда брал
  // ensureDefaultProject, поэтому при embed из cooling с pid=p_qarmet
  // датасеты сохранялись в default-проект, а cooling видел старое для
  // p_qarmet). Дополнительно: вытащить pid из ?return=... если своего pid нет.
  const params = new URLSearchParams(location.search);
  // v0.60.53: принимаем pid из ?pid= ИЛИ ?project= (project-context.js style)
  // ИЛИ из ?return= URL (когда meteo embed-ed из cooling/service).
  const urlPid = params.get('pid') || params.get('project') || (function tryFromReturnUrl() {
    try {
      const ret = params.get('return');
      if (!ret) return null;
      const decoded = decodeURIComponent(ret);
      const qIdx = decoded.indexOf('?');
      if (qIdx < 0) return null;
      const inner = new URLSearchParams(decoded.slice(qIdx + 1));
      return inner.get('pid') || inner.get('project');
    } catch { return null; }
  })();
  if (urlPid) {
    const proj = getProject(urlPid);
    if (proj) {
      setActiveProjectId(urlPid);
      _pid = urlPid;  // meteo использует pid как строку (не объект)
    } else {
      _pid = ensureDefaultProject().id;
    }
  } else {
    const dp = ensureDefaultProject();
    _pid = typeof dp === 'string' ? dp : dp.id;
  }
  // v0.60.37: миграция legacy-данных meteo из 'raschet.project.[object Object].meteo.*'
  // в правильный pid-namespace. Был баг до v0.60.37 — meteo передавал object вместо
  // .id в projectKey, всё писалось под единым [object Object] namespace.
  try {
    const legacyPrefix = 'raschet.project.[object Object].meteo.';
    const targetPrefix = `raschet.project.${_pid}.meteo.`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(legacyPrefix)) keys.push(k);
    }
    let migrated = 0;
    for (const lk of keys) {
      const tk = targetPrefix + lk.slice(legacyPrefix.length);
      if (localStorage.getItem(tk) != null) continue;  // уже есть — не перетираем
      const v = localStorage.getItem(lk);
      if (v != null) { localStorage.setItem(tk, v); migrated++; }
    }
    if (migrated) {
      console.info(`[meteo v0.60.37] Мигрировано ${migrated} legacy-ключей из [object Object] → ${_pid}`);
      // v0.60.51: освобождаем legacy namespace [object Object] чтобы не
      // занимало место в LS (часто 1-2 МБ meteo-датасетов). По репорту
      // пользователя про quota-exceeded.
      try {
        let freed = 0;
        for (const lk of keys) {
          const sz = (localStorage.getItem(lk) || '').length;
          localStorage.removeItem(lk);
          freed += sz;
        }
        console.info(`[meteo v0.60.51] Очищено legacy [object Object] namespace: ~${Math.round(freed / 1024)} КБ освобождено`);
      } catch {}
    }
  } catch {}
  // v0.60.54 (Phase 34): пробуем сначала IDB (большие датасеты), fallback на LS.
  if (idbAvailable() && _pid) {
    try {
      const idbData = await idbGet(`meteo.datasets.${_pid}`, null);
      if (Array.isArray(idbData) && idbData.length) {
        _datasets = idbData;
      } else {
        _datasets = loadJson(KEY_DATA, []) || [];
        // Если нашли в LS — мигрируем в IDB и удаляем из LS (освобождаем место).
        if (_datasets.length) {
          await idbSet(`meteo.datasets.${_pid}`, _datasets);
          try { localStorage.removeItem(projectKey(_pid, ...KEY_DATA)); } catch {}
          console.info(`[meteo v0.60.54] Migrated ${_datasets.length} datasets из LS → IDB (${_pid})`);
        }
      }
    } catch (e) {
      console.error('[meteo] idb load failed:', e);
      _datasets = loadJson(KEY_DATA, []) || [];
    }
  } else {
    _datasets = loadJson(KEY_DATA, []) || [];
  }
  _activeId = loadJson(KEY_ACTIVE, null);
  _activeCols = loadJson(KEY_COLS, _activeCols);
  // v0.59.991: миграция — убираем chiller-cols которые могли быть сохранены
  // от старых версий, т.к. эти столбцы переехали в /cooling.
  const CHILLER_COL_IDS = ['capacity', 'copMech', 'fcFraction', 'cop', 'power', 'energy'];
  _activeCols = _activeCols.filter(c => !CHILLER_COL_IDS.includes(c));
  if (!_activeCols.length) _activeCols = [...DEFAULT_COLS];
  const savedFilter = loadJson(KEY_FILTER, null);
  if (savedFilter && typeof savedFilter === 'object') {
    _filter = { mode: 'all', year: '', periodFrom: '', periodTo: '', ...savedFilter };
  }
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
        const ds = _datasets.find(x => x.id === id);
        if (!ds) return;
        const ok = await mtConfirm(`Удалить датасет «${ds.name}»? Запись попадёт в Корзину — можно восстановить.`);
        if (!ok) return;
        // Phase 35: soft-delete — пишем snapshot в историю.
        if (_pid) {
          historyAppend(_pid, {
            module: 'meteo',
            action: 'delete',
            itemKind: 'meteo-dataset',
            itemId: ds.id,
            itemName: ds.name,
            source: ds.source,
            payload: { dataset: ds },
          });
        }
        _datasets = _datasets.filter(d => d.id !== id);
        if (_activeId === id) _activeId = _datasets[0]?.id || null;
        await persist(); renderDatasetsList(); renderActive();
        util.toast(`«${ds.name}» в Корзине. Восстановить → 📜 История.`, 'ok');
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

  // Phase 35: handlers «📜 Журнал» и «🗑 Корзина».
  const histBtn = $('mt-btn-history');
  if (histBtn) histBtn.addEventListener('click', openHistoryModal);
  const trashBtn = $('mt-btn-trash');
  if (trashBtn) trashBtn.addEventListener('click', openTrashModal);
  // обновляем счётчик корзины при init
  refreshTrashCount();

  // v0.59.986: глобальный фильтр периода — единая точка изменения
  const onGlobalFilterChange = () => {
    persist();
    renderActive();   // recompute KPIs + перерисовка активной вкладки
  };
  const modeSel = $('mt-filter-mode');
  if (modeSel) modeSel.addEventListener('change', () => {
    _filter.mode = modeSel.value || 'all';
    onGlobalFilterChange();
  });
  const yearSel = $('mt-filter-year');
  if (yearSel) yearSel.addEventListener('change', () => {
    _filter.year = yearSel.value;
    onGlobalFilterChange();
  });
  const fromInp = $('mt-filter-from');
  if (fromInp) fromInp.addEventListener('change', () => {
    _filter.periodFrom = fromInp.value;
    onGlobalFilterChange();
  });
  const toInp = $('mt-filter-to');
  if (toInp) toInp.addEventListener('change', () => {
    _filter.periodTo = toInp.value;
    onGlobalFilterChange();
  });

  // Annual hours toolbar — чисто климатический pivot. Подбор оборудования
  // (chillerSpec / FC / OPEX / charts) — в модуле /cooling.
  const reRenderAnnual = () => {
    const d = _datasets.find(x => x.id === _activeId);
    if (!d) return;
    const filtered = getFilteredHourly(d);
    const rows = buildBinData(filtered);
    const tbl = $('mt-annual-table');
    if (tbl) tbl.innerHTML = renderAnnualTable(rows, _activeCols);
  };

  const colsBtn = $('mt-cols-btn');
  if (colsBtn) {
    const wrap = $('mt-col-picker-wrap');
    colsBtn.addEventListener('click', () => {
      if (!wrap) return;
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) {
        wrap.innerHTML = '';
        // hasChillerSpec=false — chiller-cols отключены, видны только в /cooling.
        wrap.appendChild(renderColumnPicker(_activeCols, (next) => {
          _activeCols = next;
          persist();
          reRenderAnnual();
        }, false));
      }
    });
  }

  const exportBtn = $('mt-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const d = _datasets.find(x => x.id === _activeId);
      if (!d) return;
      const filtered = getFilteredHourly(d);
      const rows = buildBinData(filtered);
      const tag = _filter.mode === 'year' && _filter.year ? `-${_filter.year}`
        : _filter.mode === 'period' ? `-${_filter.periodFrom || 'start'}_${_filter.periodTo || 'end'}`
        : '-allyears';
      const fname = `meteo-annual${tag}-${(d.locationName || 'export').replace(/[^\w\dА-Яа-я-]+/g, '_')}.csv`;
      exportAnnualTableCsv(rows, _activeCols, fname);
      util.toast(`CSV сохранён: ${fname}`, 'ok');
    });
  }
}

function mtConfirm(msg, title = 'Подтверждение') {
  return util.modalOpen(`<h3>${util.escHtml(title)}</h3>`, `<p>${util.escHtml(msg)}</p>`, async () => true);
}

// =============================================================================
// Phase 35: модалки «📜 История» и «🗑 Корзина»
// =============================================================================
const ACTION_LABELS = {
  'import':  { icon: '➕', label: 'Импорт', color: '#0d8a4e' },
  'update':  { icon: '✏', label: 'Обновлено', color: '#0369a1' },
  'delete':  { icon: '🗑', label: 'Удалено', color: '#92400e' },
  'restore': { icon: '↩', label: 'Восстановлено', color: '#7c3aed' },
  'purge':   { icon: '✕', label: 'Удалено навсегда', color: '#991b1b' },
};

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

async function refreshTrashCount() {
  if (!_pid) {
    const span = $('mt-trash-count');
    if (span) span.textContent = '';
    return;
  }
  try {
    const trash = await historyTrash(_pid, { module: 'meteo' });
    const span = $('mt-trash-count');
    if (span) span.textContent = trash.length ? `(${trash.length})` : '';
  } catch (e) {
    console.warn('[meteo] refreshTrashCount failed:', e);
  }
}

async function openHistoryModal() {
  if (!_pid) {
    util.toast('История доступна только в project-mode (нет активного проекта)', 'err');
    return;
  }
  const events = await historyList(_pid, { module: 'meteo' });
  events.sort((a, b) => b.ts - a.ts);  // newest first
  const rowsHtml = events.length === 0
    ? `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:16px">Нет событий. Импортируйте датасет — он появится в журнале.</td></tr>`
    : events.map(ev => {
        const meta = ACTION_LABELS[ev.action] || { icon: '?', label: ev.action, color: '#64748b' };
        return `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:6px 8px;font-size:11.5px;color:#475569;white-space:nowrap" title="${util.escAttr(new Date(ev.ts).toISOString())}">${util.escHtml(fmtTs(ev.ts))}</td>
          <td style="padding:6px 8px;font-size:12px"><span style="color:${meta.color}">${meta.icon} ${util.escHtml(meta.label)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${util.escHtml(ev.itemName || ev.itemId || '—')}</td>
          <td style="padding:6px 8px;font-size:11px;color:#64748b">${util.escHtml(ev.source || '')}</td>
        </tr>`;
      }).join('');

  await util.modalOpen(
    '<h3>📜 История meteo-данных</h3>',
    `<div style="max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Время</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Событие</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Датасет</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Источник</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:8px;font-size:11px">Всего событий: ${events.length}. Журнал per-project, append-only. Восстановление удалённых — через 🗑 Корзина.</p>`,
    async () => null  // только закрытие
  );
}

async function openTrashModal() {
  if (!_pid) {
    util.toast('Корзина доступна только в project-mode', 'err');
    return;
  }
  const trash = await historyTrash(_pid, { module: 'meteo' });
  trash.sort((a, b) => b.ts - a.ts);

  const rowsHtml = trash.length === 0
    ? `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:16px">Корзина пуста.</td></tr>`
    : trash.map(ev => {
        const ds = ev.payload?.dataset || {};
        const n = ds.hourly?.length || 0;
        return `<tr style="border-bottom:1px solid #f1f5f9" data-ev-id="${util.escAttr(ev.id)}">
          <td style="padding:6px 8px;font-size:11.5px;color:#475569;white-space:nowrap">${util.escHtml(fmtTs(ev.ts))}</td>
          <td style="padding:6px 8px;font-size:12px">${util.escHtml(ev.itemName || ev.itemId || '—')}</td>
          <td style="padding:6px 8px;font-size:11px;color:#64748b">${n} часов · ${util.escHtml(ev.source || '')}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap">
            <button type="button" data-trash-act="restore" data-ev-id="${util.escAttr(ev.id)}" style="padding:3px 8px;font-size:11px;border:1px solid #7c3aed;background:#f5f3ff;color:#7c3aed;border-radius:3px;cursor:pointer;margin-right:4px" title="Восстановить датасет в активный список">↩ Восстановить</button>
            <button type="button" data-trash-act="purge" data-ev-id="${util.escAttr(ev.id)}" style="padding:3px 8px;font-size:11px;border:1px solid #991b1b;background:#fef2f2;color:#991b1b;border-radius:3px;cursor:pointer" title="Удалить навсегда — восстановить будет нельзя">✕ Навсегда</button>
          </td>
        </tr>`;
      }).join('');

  await util.modalOpen(
    '<h3>🗑 Корзина meteo</h3>',
    `<div style="max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px">
      <table id="mt-trash-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Удалено</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Датасет</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Размер</th>
            <th style="padding:6px 8px;text-align:right;font-weight:600;border-bottom:2px solid #cbd5e1">Действие</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:8px;font-size:11px">В корзине: ${trash.length}. Восстановление возвращает датасет в активный список. «Навсегда» — освобождает место в IndexedDB.</p>`,
    async () => null
  );

  // Вешаем handlers ПОСЛЕ открытия модалки (table в DOM).
  const table = document.getElementById('mt-trash-table');
  if (table) {
    table.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-trash-act]');
      if (!btn) return;
      const evId = btn.dataset.evId;
      const act = btn.dataset.trashAct;
      if (act === 'restore') {
        const r = await historyRestore(_pid, evId);
        if (!r.ok) { util.toast(`❌ ${r.error}`, 'err'); return; }
        const ds = r.payload?.dataset;
        if (ds) {
          // Возвращаем датасет в _datasets если его там нет
          if (!_datasets.find(d => d.id === ds.id)) {
            _datasets.unshift(ds);
            await persist();
            renderDatasetsList();
            renderActive();
          }
        }
        util.toast(`✓ «${r.itemName}» восстановлен`, 'ok');
        // Удаляем строку из таблицы
        btn.closest('tr')?.remove();
        await refreshTrashCount();
      } else if (act === 'purge') {
        const ok = await mtConfirm('Удалить навсегда? Восстановить будет нельзя.', 'Permanent delete');
        if (!ok) return;
        const r = await historyPurge(_pid, evId);
        if (!r.ok) { util.toast(`❌ ${r.error}`, 'err'); return; }
        util.toast('✓ Удалено навсегда', 'ok');
        btn.closest('tr')?.remove();
        await refreshTrashCount();
      }
    });
  }
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
