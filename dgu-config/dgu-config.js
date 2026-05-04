// =============================================================================
// dgu-config/dgu-config.js — UI orchestrator модуля ДГУ
// =============================================================================
// Phase 30.3 (v0.60.70): standalone-режим. URL params для PUSH из tech-workspace:
//   ?capacityKw=N    — нагрузка
//   ?mode=ESP|PRP|COP
//   ?redundancy=N|N+1|2N
//   ?altitude=N      — высота
//   ?tamb=N          — T наружн.
//   ?autonomy=N      — часы автономии
//   ?vendor=...      — фильтр вендора

import { calcDgu, DGU_MODES, getDguModePowerKw } from './calc/dgu-calc.js';
import { listDgus, listDguVendors, suggestDgu } from './datasheets/index.js';
import { ensureDefaultProject, projectKey, listProjects, getProject, setActiveProjectId } from '../shared/project-storage.js';

const $ = (id) => document.getElementById(id);

// v0.60.81: per-project persistence. Сохраняем последнее состояние input-ов
// и выбранную модель в LS под projectKey. Восстанавливается при следующем
// открытии dgu-config с тем же ?project= в URL.
const KEY_STATE = ['dgu-config', 'state.v1'];
const KEY_SELECTED = ['dgu-config', 'selected.v1'];

let _pid = null;

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escAttr(s) { return escHtml(s); }
function fmt(n, dec = 0) { return Number.isFinite(n) ? Number(n).toFixed(dec) : '—'; }

let _state = {
  loadKw: 500,
  mode: 'PRP',
  redundancy: 'N',
  // v0.60.216 fix (по репорту Пользователя 2026-05-04 «маргин вроде не влияет
  // ни на что»): поле в state было `margin`, а calcDguRequired ждёт
  // `safetyMarginPct` — рассинхрон, margin молча игнорировался и брался
  // дефолт 15%. Переименовал в safetyMarginPct.
  safetyMarginPct: 15,
  altitudeM: 0,
  ambientTC: 25,
  humidityPct: 60,
  autonomyHours: 24,
  vendor: '',
};

// v0.60.216 (по репорту Пользователя 2026-05-04 «как подбор вернуть обратно
// в конструктор схем???»): id узла схемы из URL ?nodeId=. Если задан —
// показываем кнопку «↩ Применить к узлу схемы», которая отправляет
// postMessage('raschet.dgu.apply',…) родительскому окну и пишет
// LS-bridge ключ для off-tab сценариев.
let _nodeId = null;
const BRIDGE_KEY_PREFIX = 'raschet.dgu.bridge.';
let _lastBest = null;

// v0.60.81: project context resolution + per-project state persistence.
function resolvePid() {
  const params = new URLSearchParams(location.search);
  const urlPid = params.get('project') || params.get('pid');
  if (urlPid) {
    const proj = getProject(urlPid);
    if (proj) {
      setActiveProjectId(urlPid);
      return urlPid;
    }
    console.warn('[dgu-config] ?project=' + urlPid + ' not found, fallback to default');
  }
  const dp = ensureDefaultProject();
  return typeof dp === 'string' ? dp : (dp?.id || null);
}

function loadProjectState() {
  if (!_pid) return;
  try {
    const raw = localStorage.getItem(projectKey(_pid, ...KEY_STATE));
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      _state = { ..._state, ...saved };
    }
  } catch (e) { console.warn('[dgu-config] loadState failed:', e); }
}

function saveProjectState() {
  if (!_pid) return;
  try {
    localStorage.setItem(projectKey(_pid, ...KEY_STATE), JSON.stringify(_state));
  } catch (e) { console.warn('[dgu-config] saveState failed:', e); }
}

function saveSelectedDgu(dguEntry) {
  if (!_pid || !dguEntry) return;
  try {
    const payload = {
      vendor: dguEntry.vendor,
      model: dguEntry.model,
      nameplateKw: dguEntry.nameplateKw,
      espKw: dguEntry.espKw, prpKw: dguEntry.prpKw, copKw: dguEntry.copKw,
      engineModel: dguEntry.engineModel,
      sfcLkWh: dguEntry.sfcLkWh,
      ts: Date.now(),
    };
    localStorage.setItem(projectKey(_pid, ...KEY_SELECTED), JSON.stringify(payload));
  } catch (e) { console.warn('[dgu-config] saveSelected failed:', e); }
}

// v0.60.216: атрибуция источника каждого значения. Заполняется в
// loadFromProject и используется баннером _renderContextBanner.
// '?' — не определено, 'project' — project.location, 'meteo' — meteo dataset,
// 'tw' — tech-workspace concept, 'url' — URL params, 'manual' — ввод
// пользователя в самом dgu-config, 'default' — значение по умолчанию.
let _stateMeta = {
  loadKw: 'default',
  altitudeM: 'default',
  ambientTC: 'default',
  humidityPct: 'default',
  // дополнительные подробности об источниках
  projectInfo: null,   // { id, name, location: { city, country, lat, lon, altitudeM } }
  meteoInfo: null,     // { name, source } — какой dataset и откуда (ASHRAE/t99/tmax)
};

// v0.60.91 (Пользователь 2026-05-03 «мощность должна передаваться из проекта,
// так же все параметры проекта, включая место расположения, климат»):
// auto-fill параметров из выбранного проекта.
// Источники:
//   1. TW concept (variant.concept) — Σ принятая мощность для loadKw
//   2. project.location — lat/lon/city (для подсказки)
//   3. meteo dataset (IDB или LS) — T design (99%), altitude если есть
async function loadFromProject() {
  if (!_pid) return;
  let appliedHints = [];
  // v0.60.212 (по репорту Пользователя 2026-05-04 «модуль ДГУ не использует
  // модуль метео»): если запуск из инспектора схемы (URL содержит nodeId)
  // — context-данные применяются ПРИНУДИТЕЛЬНО (override saved state).
  // Inspector явно говорит «нагрузка/климат из этой схемы и проекта».
  // В standalone (без nodeId) сохраняется старая логика: применить только
  // если состояние = default (не перетирать ручные правки пользователя).
  const _qp = new URLSearchParams(location.search);
  const _force = _qp.has('nodeId');

  // 1. Power from TW concept (если есть варианты концепции)
  try {
    const variantsRaw = localStorage.getItem(projectKey(_pid, 'tech-workspace', 'variants.v1'));
    if (variantsRaw) {
      const variants = JSON.parse(variantsRaw);
      const primary = variants.find(v => v.primary) || variants[0];
      if (primary?.concept) {
        const c = primary.concept;
        const itKw = (c.rackGroups || []).reduce(
          (s, rg) => s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0), 0);
        const coolKw = (c.coolingUnits || []).reduce(
          (s, cu) => s + (Number(cu.count) || 0) * (Number(cu.kwPerUnit) || 0), 0);
        const totalKw = itKw + (itKw * 0.05) + coolKw;
        if (totalKw > 0 && (_force || _state.loadKw === 500)) {
          _state.loadKw = Math.round(totalKw);
          _stateMeta.loadKw = 'tw';
          appliedHints.push(`нагрузка ${_state.loadKw} кВт (из TW концепции)`);
        }
      }
    }
  } catch (e) { console.warn('[dgu-config] TW load failed:', e); }

  // 2. Location (altitude + meta) from project.location
  try {
    const proj = getProject(_pid);
    const loc = proj?.location || {};
    if (proj) {
      _stateMeta.projectInfo = {
        id: proj.id,
        name: proj.name || proj.code || '(без имени)',
        location: {
          city: loc.city || '',
          country: loc.country || '',
          lat: loc.lat ?? null,
          lon: loc.lon ?? null,
          altitudeM: Number.isFinite(Number(loc.altitudeM)) ? Number(loc.altitudeM) : null,
        },
      };
    }
    if (loc.altitudeM != null && (_force || _state.altitudeM === 0)) {
      _state.altitudeM = Number(loc.altitudeM);
      _stateMeta.altitudeM = 'project';
      appliedHints.push(`высота ${_state.altitudeM} м (из локации проекта)`);
    }
  } catch (e) { console.warn('[dgu-config] location read failed:', e); }

  // 3. Climate (T design + RH) from meteo dataset (IDB or LS)
  try {
    const { idbGet, idbAvailable } = await import('../shared/idb-store.js');
    let datasets = null;
    if (idbAvailable()) {
      datasets = await idbGet(`meteo.datasets.${_pid}`, null);
    }
    if (!Array.isArray(datasets) || !datasets.length) {
      const raw = localStorage.getItem(projectKey(_pid, 'meteo', 'datasets.v1'));
      if (raw) datasets = JSON.parse(raw);
    }
    if (Array.isArray(datasets) && datasets.length) {
      const active = datasets.find(d => d.activeForProject) || datasets[0];
      // v0.60.216: запоминаем источник чтобы показать пользователю в баннере.
      let tSource = null, rhSource = null;
      let tDesign = null;
      if (active.ashrae?.cooling04?.tDb != null) { tDesign = active.ashrae.cooling04.tDb; tSource = 'ASHRAE 0.4% (cooling04.tDb)'; }
      else if (active.stats?.t99 != null)        { tDesign = active.stats.t99; tSource = 't99 (stats)'; }
      else if (active.stats?.tmax != null)       { tDesign = active.stats.tmax; tSource = 'tmax (stats)'; }
      let rhDesign = null;
      if (active.ashrae?.cooling04?.rh != null) { rhDesign = active.ashrae.cooling04.rh; rhSource = 'ASHRAE 0.4% (cooling04.rh)'; }
      else if (active.stats?.rh99 != null)       { rhDesign = active.stats.rh99; rhSource = 'rh99 (stats)'; }
      else if (active.stats?.rhMax != null)      { rhDesign = active.stats.rhMax; rhSource = 'rhMax (stats)'; }
      // v0.60.224 (по репорту Пользователя 2026-05-04 «не высоты не влажности
      // не передается из метео»): meteo.computeStats() считает только
      // T-stats — RH в stats нет. Если поля не нашли через ASHRAE/stats,
      // вычисляем MCRH (Mean Coincident RH) при design-T прямо на лету
      // по hourly[] (там есть h.RH per hour). MCRH — средняя влажность
      // в часы когда T близка к design — это правильное значение для
      // climate derate ДГУ при наихудших условиях.
      if (rhDesign == null && Array.isArray(active.hourly) && active.hourly.length && tDesign != null) {
        const close = active.hourly
          .filter(h => Number.isFinite(Number(h.T)) && Number.isFinite(Number(h.RH)))
          .filter(h => Math.abs(Number(h.T) - tDesign) < 1.0);  // ±1°C от design
        if (close.length) {
          const rhAvg = close.reduce((s, h) => s + Number(h.RH), 0) / close.length;
          rhDesign = rhAvg;
          rhSource = `MCRH @ design-T (вычислено по ${close.length} часов из ${active.hourly.length})`;
        }
      }
      // v0.60.224: высота метеостанции (active.elev в метрах) — fallback
      // когда project.location.altitudeM не задан.
      let elevSource = null;
      const elevM = Number(active.elev);
      const elevValid = Number.isFinite(elevM) && elevM > 0;

      _stateMeta.meteoInfo = {
        name: active.name || active.label || active.station || '(meteo dataset)',
        tSource: tSource,
        rhSource: rhSource,
        tDesign: tDesign,
        rhDesign: rhDesign,
        elev: elevValid ? elevM : null,
      };

      if (tDesign != null && (_force || _state.ambientTC === 25)) {
        _state.ambientTC = Math.round(tDesign);
        _stateMeta.ambientTC = 'meteo';
        appliedHints.push(`T расч. ${_state.ambientTC}°C (${tSource})`);
      }
      if (rhDesign != null && (_force || _state.humidityPct === 60)) {
        _state.humidityPct = Math.round(rhDesign);
        _stateMeta.humidityPct = 'meteo';
        appliedHints.push(`RH расч. ${_state.humidityPct}% (${rhSource})`);
      }
      // v0.60.224: высота из метео — применяем если в проекте локация без
      // altitudeM (или не задана) И в state ещё default. project.location
      // имеет приоритет (см. блок 2 выше).
      if (elevValid && _stateMeta.altitudeM === 'default' && (_force || _state.altitudeM === 0)) {
        _state.altitudeM = Math.round(elevM);
        _stateMeta.altitudeM = 'meteo';
        elevSource = `${Math.round(elevM)} м (метеостанция «${active.name || ''}»)`;
        appliedHints.push(`высота ${_state.altitudeM} м (${elevSource})`);
      }
    }
  } catch (e) { console.warn('[dgu-config] meteo read failed:', e); }

  if (appliedHints.length) {
    console.info(`[dgu-config v0.60.216] auto-fill из проекта (${_force ? 'force' : 'soft'}):`, appliedHints.join(' · '));
  }
}

function readUrlParams() {
  const qp = new URLSearchParams(location.search);
  if (qp.get('capacityKw')) {
    const v = Number(qp.get('capacityKw'));
    if (Number.isFinite(v)) { _state.loadKw = v; _stateMeta.loadKw = 'url'; }
  }
  if (qp.get('mode')) _state.mode = qp.get('mode');
  if (qp.get('redundancy')) _state.redundancy = qp.get('redundancy');
  if (qp.get('altitude')) {
    const v = Number(qp.get('altitude'));
    if (Number.isFinite(v)) { _state.altitudeM = v; _stateMeta.altitudeM = 'url'; }
  }
  if (qp.get('tamb')) {
    const v = Number(qp.get('tamb'));
    if (Number.isFinite(v)) { _state.ambientTC = v; _stateMeta.ambientTC = 'url'; }
  }
  if (qp.get('rh')) {
    const v = Number(qp.get('rh'));
    if (Number.isFinite(v)) { _state.humidityPct = v; _stateMeta.humidityPct = 'url'; }
  }
  if (qp.get('autonomy')) _state.autonomyHours = Number(qp.get('autonomy')) || _state.autonomyHours;
  if (qp.get('vendor')) _state.vendor = qp.get('vendor');
}

function syncStateFromInputs() {
  _state.loadKw = Number($('dg-loadKw').value) || _state.loadKw;
  _state.mode = $('dg-mode').value || _state.mode;
  _state.redundancy = $('dg-redundancy').value || _state.redundancy;
  // v0.60.216: margin → safetyMarginPct (см. комментарий выше).
  // 0 — валидное значение, поэтому НЕ используем `||` (он съест 0).
  {
    const v = Number($('dg-margin').value);
    _state.safetyMarginPct = Number.isFinite(v) ? v : _state.safetyMarginPct;
  }
  _state.altitudeM = Number($('dg-altitude').value) || _state.altitudeM;
  _state.ambientTC = Number($('dg-tamb').value) || _state.ambientTC;
  _state.humidityPct = Number($('dg-rh').value) || _state.humidityPct;
  _state.autonomyHours = Number($('dg-autonomy').value) || _state.autonomyHours;
  _state.vendor = $('dg-vendor').value || '';
}

function applyStateToInputs() {
  $('dg-loadKw').value = _state.loadKw;
  $('dg-mode').value = _state.mode;
  $('dg-redundancy').value = _state.redundancy;
  $('dg-margin').value = _state.safetyMarginPct;
  $('dg-altitude').value = _state.altitudeM;
  $('dg-tamb').value = _state.ambientTC;
  $('dg-rh').value = _state.humidityPct;
  $('dg-autonomy').value = _state.autonomyHours;
  $('dg-vendor').value = _state.vendor;
}

function renderCalcResult(res) {
  const { spec, fuel } = res;
  const d = spec.derate.breakdown;
  return `
    <div class="dg-kpi-grid">
      <div class="dg-kpi" title="Электрическая нагрузка объекта (введено пользователем).">
        <span class="dg-kpi-lbl">P нагрузки</span>
        <span class="dg-kpi-val">${fmt(spec.loadKw)} кВт</span>
      </div>
      <div class="dg-kpi" title="Допустимый load factor для выбранного режима ISO 8528-1: ${escAttr(spec.modeLabel)}.">
        <span class="dg-kpi-lbl">Load factor (${escHtml(_state.mode)})</span>
        <span class="dg-kpi-val">${(spec.maxLoadFactor * 100).toFixed(0)}%</span>
      </div>
      <div class="dg-kpi" title="Climate derate по ISO 3046-1: ${fmt(spec.derate.multiplier * 100, 1)}% от nameplate допустимо в текущих условиях.">
        <span class="dg-kpi-lbl">Climate derate</span>
        <span class="dg-kpi-val">${fmt(spec.derate.multiplier * 100, 1)}%</span>
      </div>
      <div class="dg-kpi" title="Минимально требуемая мощность ДГУ (одна единица) после learm factor + climate derate + margin.">
        <span class="dg-kpi-lbl">P требуемая (1 ед.)</span>
        <span class="dg-kpi-val">${fmt(spec.nameplateKw)} кВт</span>
      </div>
      <div class="dg-kpi" title="Кол-во ДГУ при выбранном резервировании: N=1, N+1=2 (1 рабочий + 1 резерв горячий), 2N=2 (полное дублирование).">
        <span class="dg-kpi-lbl">Кол-во ДГУ</span>
        <span class="dg-kpi-val">${spec.qty} <span class="dg-kpi-sub">${escHtml(spec.redundancyMode)}</span></span>
      </div>
      <div class="dg-kpi" title="Σ установленной мощности всех ДГУ.">
        <span class="dg-kpi-lbl">Σ Установлено</span>
        <span class="dg-kpi-val">${fmt(spec.totalNameplateKw)} кВт</span>
      </div>
    </div>

    <h4 style="margin:12px 0 4px;font-size:12px;color:#475569">Раскладка climate derate (ISO 3046-1):</h4>
    <table class="dg-derate-table">
      <thead><tr><th>Фактор</th><th class="num">Значение</th><th class="num">Derate, %</th><th>Норма</th></tr></thead>
      <tbody>
        <tr><td>Высота над уровнем моря</td><td class="num">${fmt(_state.altitudeM)} м</td><td class="num" style="color:${d.altDerate < 0 ? '#c62828' : '#16a34a'}">${fmt(d.altDerate, 2)}%</td><td>−3% за 300м &gt; 100м</td></tr>
        <tr><td>T наружного воздуха</td><td class="num">${fmt(_state.ambientTC)} °C</td><td class="num" style="color:${d.tDerate < 0 ? '#c62828' : '#16a34a'}">${fmt(d.tDerate, 2)}%</td><td>−2.5% за 5°C &gt; 25°C</td></tr>
        <tr><td>Относительная влажность</td><td class="num">${fmt(_state.humidityPct)} %</td><td class="num" style="color:${d.rhDerate < 0 ? '#c62828' : '#16a34a'}">${fmt(d.rhDerate, 2)}%</td><td>−1% за 25% &gt; 60% RH</td></tr>
        <tr style="font-weight:600;border-top:2px solid #cbd5e1"><td>Σ Climate derate</td><td></td><td class="num" style="color:${d.totalDerate < 0 ? '#c62828' : '#16a34a'}">${fmt(d.totalDerate, 2)}%</td><td>от nameplate</td></tr>
      </tbody>
    </table>

    <p class="muted" style="font-size:11px;margin-top:8px">${escHtml(DGU_MODES[_state.mode]?.notes || '')}</p>
  `;
}

// v0.60.216: helper — мощность для текущего режима (datasheet или derived).
function _modeKw(d) {
  return getDguModePowerKw(d, _state.mode);
}
function _isDerived(d) {
  return _modeKw(d).source !== 'datasheet';
}

function renderSuggestResult(spec) {
  const filter = { mode: _state.mode };
  if (_state.vendor) filter.vendor = _state.vendor;

  const allDgus = listDgus(_state.vendor ? { vendor: _state.vendor } : {})
    .filter(d => Number.isFinite(_modeKw(d).kw));
  const sorted = allDgus.slice().sort((a, b) => _modeKw(a).kw - _modeKw(b).kw);

  // Best = ближайшая ≥ requiredKw
  const best = sorted.find(d => _modeKw(d).kw >= spec.nameplateKw);
  const matches = sorted.filter(d => {
    const k = _modeKw(d).kw;
    return k >= spec.nameplateKw && k <= spec.nameplateKw * 1.5;
  });

  if (!matches.length) {
    return `<div class="dg-warn">⚠ Нет моделей в каталоге, покрывающих требуемые ${fmt(spec.nameplateKw)} кВт по режиму ${escHtml(_state.mode)}${_state.vendor ? ` (вендор: ${escHtml(_state.vendor)})` : ''}. Попробуйте другой режим или снимите фильтр вендора.</div>`;
  }

  // v0.60.216: расчёт количества derived-значений в видимых строках.
  const derivedCount = matches.slice(0, 8).filter(d => _isDerived(d)).length;
  const derivedNote = derivedCount > 0
    ? `<div class="muted" style="font-size:11px;margin-top:6px;font-style:italic">
         <b>*</b> — мощность не задана в datasheet, выведена по типовым коэффициентам ISO 8528 (наведите на ячейку — формула в tooltip).
       </div>`
    : '';

  return `
    <p style="font-size:12px;margin-bottom:6px">
      Найдено <b>${matches.length}</b> моделей с ${escHtml(_state.mode)}-мощностью ≥ <b>${fmt(spec.nameplateKw)} кВт</b>
      ${_state.vendor ? `(вендор: <b>${escHtml(_state.vendor)}</b>)` : ''}.
      Зелёным — оптимальный подбор (минимальный размер, покрывающий требование).
    </p>
    <table class="dg-suggest-table">
      <thead>
        <tr>
          <th>Вендор</th>
          <th>Модель</th>
          <th class="num">${escHtml(_state.mode)}, кВт</th>
          <th class="num">Все режимы (ESP/PRP/COP)</th>
          <th>Двигатель</th>
          <th class="num">Габариты Д×Ш×В, мм</th>
          <th class="num">Вес</th>
        </tr>
      </thead>
      <tbody>
        ${matches.slice(0, 8).map(d => {
          const isBest = d === best;
          const p = d.physical || {};
          const mp = _modeKw(d);
          const isDer = mp.source !== 'datasheet';
          return `<tr class="${isBest ? 'dg-suggest-best' : ''}" title="${escAttr(d.notes || '')}">
            <td>${escHtml(d.vendor)}</td>
            <td><b>${escHtml(d.model)}</b></td>
            <td class="num" title="${escAttr(mp.source)}"><b>${fmt(mp.kw)}</b>${isDer ? '<sup style="color:#dc2626" title="' + escAttr(mp.source) + '">*</sup>' : ''}</td>
            <td class="num">${fmt(d.espKw)} / ${fmt(d.prpKw)} / ${fmt(d.copKw)}</td>
            <td>${escHtml(d.engineModel)} (${d.cylinders} цил., ${fmt(d.displacement, 1)} L)</td>
            <td class="num">${p.lengthMm || '—'} × ${p.widthMm || '—'} × ${p.heightMm || '—'}</td>
            <td class="num">${p.weightKg ? fmt(p.weightKg) + ' кг' : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${derivedNote}
    ${best ? (() => {
      const mp = _modeKw(best);
      const srcNote = mp.source === 'datasheet' ? '' : ` <i title="${escAttr(mp.source)}">(*выведено)</i>`;
      return `<div class="dg-success">✓ Рекомендация: <b>${escHtml(best.vendor)} ${escHtml(best.model)}</b> — ${fmt(mp.kw)} кВт по ${escHtml(_state.mode)}${srcNote}, ${best.cylinders}-цилиндровый ${escHtml(best.engineModel)}, SFC ${fmt(best.sfcLkWh, 3)} л/кВт·ч.</div>`;
    })() : ''}
  `;
}

function renderFuelResult(res, best) {
  const { spec, fuel } = res;
  const sfcSource = best ? `по datasheet ${best.vendor} ${best.model}: ${fmt(best.sfcLkWh, 3)} л/кВт·ч` : `типовой ${fmt(fuel.sfc, 3)} л/кВт·ч`;
  const tankClass = fuel.tankSafetyL > 5000 ? 'Подземный резервуар (≥10м³)' : fuel.tankSafetyL > 1000 ? 'Стационарный наземный (1-5 м³)' : 'Встроенный сабсбейс';
  return `
    <div class="dg-kpi-grid">
      <div class="dg-kpi" title="Specific Fuel Consumption — расход на единицу выработанной энергии (л/кВт·ч). Зависит от загрузки.">
        <span class="dg-kpi-lbl">SFC</span>
        <span class="dg-kpi-val">${fmt(fuel.sfc, 3)} <span class="dg-kpi-sub">л/кВт·ч</span></span>
      </div>
      <div class="dg-kpi" title="Часовой расход топлива при текущей нагрузке.">
        <span class="dg-kpi-lbl">Часовой расход</span>
        <span class="dg-kpi-val">${fmt(fuel.hourlyL, 1)} <span class="dg-kpi-sub">л/ч</span></span>
      </div>
      <div class="dg-kpi" title="Объём топлива на ${fmt(_state.autonomyHours)} часов автономии.">
        <span class="dg-kpi-lbl">Σ Топливо за ${_state.autonomyHours} ч</span>
        <span class="dg-kpi-val">${fmt(fuel.totalL)} <span class="dg-kpi-sub">л</span></span>
      </div>
      <div class="dg-kpi" title="Объём бака с 10% запасом для безопасной работы.">
        <span class="dg-kpi-lbl">Бак (с 10% запасом)</span>
        <span class="dg-kpi-val">${fmt(fuel.tankSafetyL)} <span class="dg-kpi-sub">л</span></span>
      </div>
    </div>
    <p class="muted" style="font-size:11px;margin-top:8px">
      SFC: ${escHtml(sfcSource)}. Тип бака: <b>${escHtml(tankClass)}</b>.
      Стандарт: ISO 3046-1 (specific fuel consumption при 75% нагрузки), фактический расход интерполируется по таблице 25/50/75/100% load.
    </p>
  `;
}

// v0.60.216: баннер с контекстом проекта (локация) и источниками climate
// (meteo dataset). Делает явным «откуда взялись altitude/T/RH». Показывается
// всегда (даже без nodeId), чтобы Пользователь видел, что dgu-config
// реально читает project + meteo.
function _renderContextBanner() {
  let bar = document.getElementById('dg-ctx-banner');
  const card = document.querySelector('.dg-content');
  if (!card) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dg-ctx-banner';
    bar.className = 'rs-cfg-card';
    bar.style.cssText = 'border:1px solid #cbd5e1;background:#f8fafc;font-size:12px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:14px;align-items:center';
    const hdr = card.querySelector('.dg-content-header');
    if (hdr && hdr.nextSibling) card.insertBefore(bar, hdr.nextSibling);
    else card.prepend(bar);
  }
  const proj = _stateMeta.projectInfo;
  const meteo = _stateMeta.meteoInfo;
  const _srcLabel = (s) => {
    if (s === 'project') return '📁 проект';
    if (s === 'meteo')   return '🌡 метео';
    if (s === 'tw')      return '🏗 TW концепция';
    if (s === 'url')     return '🔗 URL (из схемы)';
    if (s === 'manual')  return '✍ ввод';
    if (s === 'default') return '— default';
    return '?';
  };
  let projHtml = '';
  if (proj) {
    const loc = proj.location || {};
    const locParts = [];
    if (loc.city) locParts.push(escHtml(loc.city));
    if (loc.country) locParts.push(escHtml(loc.country));
    if (loc.lat != null && loc.lon != null) {
      locParts.push(`${Number(loc.lat).toFixed(3)}°, ${Number(loc.lon).toFixed(3)}°`);
    }
    if (loc.altitudeM != null) locParts.push(`высота ${escHtml(loc.altitudeM)} м`);
    projHtml = `<div title="Проект задаёт локацию (city/country/lat/lon/altitude). Эти данные пропагируются во все calc-модули, в т.ч. dgu-config.">
      <b>📁 Проект:</b> ${escHtml(proj.name)}<br>
      <span class="muted">📍 ${locParts.length ? locParts.join(' · ') : '<i>локация не задана</i>'}</span>
    </div>`;
  } else {
    projHtml = `<div class="muted"><i>📁 Проект не разрешён</i></div>`;
  }
  let meteoHtml = '';
  if (meteo) {
    const tParts = [];
    if (meteo.tDesign != null) tParts.push(`T design ${fmt(meteo.tDesign)}°C`);
    if (meteo.rhDesign != null) tParts.push(`RH design ${fmt(meteo.rhDesign)}%`);
    if (meteo.elev != null) tParts.push(`высота ${fmt(meteo.elev)} м`);
    meteoHtml = `<div title="Активный meteo-dataset проекта. T/RH design + высота метеостанции используются для climate derate (ISO 3046-1). Источники: T=${escAttr(meteo.tSource || '—')}, RH=${escAttr(meteo.rhSource || '—')}.">
      <b>🌡 Метео:</b> ${escHtml(meteo.name)}<br>
      <span class="muted">${tParts.length ? tParts.join(' · ') : '<i>climate-поля не найдены</i>'}</span>
    </div>`;
  } else {
    meteoHtml = `<div class="muted"
      title="Активный meteo-dataset не найден. Загрузите данные в модуле Meteo и активируйте dataset для проекта.">
      <i>🌡 Метео-dataset не активен</i>
    </div>`;
  }
  const srcHtml = `<div title="Откуда взяты значения в полях расчёта.">
    <b>📊 Источники:</b><br>
    <span class="muted">
      нагрузка ${escHtml(_srcLabel(_stateMeta.loadKw))} ·
      высота ${escHtml(_srcLabel(_stateMeta.altitudeM))} ·
      T ${escHtml(_srcLabel(_stateMeta.ambientTC))} ·
      RH ${escHtml(_srcLabel(_stateMeta.humidityPct))}
    </span>
  </div>`;
  bar.innerHTML = projHtml + meteoHtml + srcHtml;
}

function recalcAndRender() {
  syncStateFromInputs();
  const res = calcDgu(_state);
  $('dg-calc-result').innerHTML = renderCalcResult(res);
  $('dg-suggest-result').innerHTML = renderSuggestResult(res.spec);

  // Best для fuel — v0.60.216: используем getDguModePowerKw с fallback.
  const allDgus = listDgus(_state.vendor ? { vendor: _state.vendor } : {})
    .filter(d => Number.isFinite(_modeKw(d).kw));
  const sorted = allDgus.slice().sort((a, b) => _modeKw(a).kw - _modeKw(b).kw);
  const best = sorted.find(d => _modeKw(d).kw >= res.spec.nameplateKw);
  $('dg-fuel-result').innerHTML = renderFuelResult(res, best);

  // v0.60.81: persist state per-project + auto-save best as selected
  saveProjectState();
  if (best) saveSelectedDgu(best);
  // v0.60.216: запоминаем best для кнопки «↩ Применить к узлу схемы».
  _lastBest = best || null;
  _renderContextBanner();
  _renderApplyBar(res.spec);
}

// v0.60.216: bar с кнопкой возврата в Конструктор схем (если открыто из
// инспектора с ?nodeId=). За пределами schema-mode не рисуется.
function _renderApplyBar(spec) {
  let bar = document.getElementById('dg-apply-bar');
  if (!_nodeId) { if (bar) bar.remove(); return; }
  const card = document.querySelector('.dg-content');
  if (!card) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dg-apply-bar';
    bar.className = 'rs-cfg-card';
    bar.style.cssText = 'border:2px solid #16a34a;background:#f0fdf4;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between';
    // вставляем сверху content'а (после header)
    const hdr = card.querySelector('.dg-content-header');
    if (hdr && hdr.nextSibling) card.insertBefore(bar, hdr.nextSibling);
    else card.prepend(bar);
  }
  const best = _lastBest;
  // v0.60.226 (по репорту Пользователя 2026-05-04 «опять кнопки возврата
  // в модуль нет» / «кнопка прячется»): rs-cfg-btn-primary имеет светлую
  // заливку и сливается с зелёным фоном баннера — текст почти не виден,
  // только при hover становится синим. Заменили на явный inline-стиль с
  // синей заливкой и белым текстом, видимыми всегда.
  // v0.60.226: показываем мощность по ВЫБРАННОМУ режиму (не всегда ESP).
  const _activeMp = best ? getDguModePowerKw(best, _state.mode) : null;
  const _kwTxt = (_activeMp && Number.isFinite(_activeMp.kw)) ? fmt(_activeMp.kw) : '—';
  const lbl = best
    ? `<b>${escHtml(best.vendor)} ${escHtml(best.model)}</b> — ${escHtml(_state.mode)} ${_kwTxt} кВт`
    : `<span class="muted">Подбор не найден</span>`;
  const _btnStyle = best
    ? 'background:#1d4ed8;color:#fff;border:1px solid #1e40af;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15);white-space:nowrap'
    : 'background:#cbd5e1;color:#64748b;border:1px solid #94a3b8;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:not-allowed;white-space:nowrap';
  bar.innerHTML = `
    <div style="font-size:13px;flex:1 1 auto;min-width:0">
      🔗 Возврат в Конструктор схем · узел <code>${escHtml(_nodeId)}</code><br>
      ${lbl}
    </div>
    <button type="button" id="dg-apply-btn"
      ${best ? '' : 'disabled'}
      title="Записать выбранную модель ДГУ в узел Конструктора схем (manufacturer, model, capacityKw, snomKva, genRatings, fuelSfcLkWh)."
      style="${_btnStyle}">
      ↩ Применить к узлу схемы
    </button>
  `;
  const btn = document.getElementById('dg-apply-btn');
  if (btn) btn.addEventListener('click', () => sendApplyToHost(spec));
}

function sendApplyToHost(spec) {
  if (!_nodeId) return;
  const best = _lastBest;
  if (!best) return;

  // v0.60.223 (по репорту Пользователя 2026-05-04 «раньше в полях были
  // значения, сейчас убрал, хотел получить с конфигуратора»):
  // вычисляем kW и kVA для ВСЕХ ISO 8528 режимов (ESP/PRP/LTP/COP/DCC),
  // чтобы передать в схему в формате n.genRatings = { mode: {kW, kVA} }.
  // kVA вычисляется через cos φ = 0.8 — ISO 8528-1 «typical synchronous
  // generator power factor». Это ровно соответствует данным datasheet:
  // например AJ Power DA3-AJ165-P1: nameplateKw=132, model «165 kVA» →
  // 132/0.8 = 165 ✓. Для отсутствующих в каталоге режимов используется
  // ISO-fallback из getDguModePowerKw (помечается «*» в подборе).
  const _COS_NOM = 0.8;
  const ratings = {};
  for (const mode of ['COP', 'DCC', 'PRP', 'LTP', 'ESP']) {
    const mp = getDguModePowerKw(best, mode);
    if (Number.isFinite(mp.kw) && mp.kw > 0) {
      ratings[mode] = {
        kW:  Math.round(mp.kw * 10) / 10,
        kVA: Math.round((mp.kw / _COS_NOM) * 10) / 10,
      };
    } else {
      ratings[mode] = { kW: null, kVA: null };
    }
  }
  // Активная мощность для текущего режима (= n.capacityKw в схеме).
  const activeMp = getDguModePowerKw(best, _state.mode);
  const activeKw = Number.isFinite(activeMp.kw) ? Math.round(activeMp.kw) : best.nameplateKw;

  const payload = {
    nodeId: _nodeId,
    selected: {
      vendor: best.vendor,
      model: best.model,
      nameplateKw: activeKw,    // активный режим (для n.capacityKw)
      espKw: best.espKw, prpKw: best.prpKw, copKw: best.copKw,
      engineModel: best.engineModel,
      cylinders: best.cylinders,
      displacement: best.displacement,
      sfcLkWh: best.sfcLkWh,
      physical: best.physical || null,
      // v0.60.223: полная таблица режимов + cos φ для заполнения полей
      // ISO 8528 в инспекторе (n.genRatings + n.genCosPhi + n.snomKva).
      ratings,
      cosNom: _COS_NOM,
    },
    spec: {
      mode: _state.mode,
      redundancy: _state.redundancy,
      requiredKw: spec.nameplateKw,
      qty: spec.qty,
      totalNameplateKw: spec.totalNameplateKw,
      derateMultiplier: spec.derate?.multiplier,
      safetyMarginPct: _state.safetyMarginPct,
    },
    ts: Date.now(),
  };
  // 1) LS-bridge — для случая, если schema-страница уже закрыта или открыта
  // в другой вкладке: при следующем фокусе она прочитает этот ключ.
  try {
    localStorage.setItem(BRIDGE_KEY_PREFIX + _nodeId, JSON.stringify({ applied: true, ...payload }));
  } catch (e) { console.warn('[dgu-config] LS bridge failed:', e); }
  // 2) postMessage — мгновенно если schema-tab ещё открыт.
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'raschet.dgu.apply', ...payload }, '*');
    }
  } catch {}
  // toast (если в shell есть rsToast — используем, иначе alert-альтернатива)
  if (window.rsToast) {
    window.rsToast(`Модель «${best.vendor} ${best.model}» применена к узлу ${_nodeId}. Можно закрыть вкладку.`, 'ok');
  } else {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:60px;right:16px;background:#16a34a;color:#fff;padding:10px 14px;border-radius:8px;z-index:9999;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    t.textContent = `✓ Модель «${best.vendor} ${best.model}» применена к узлу ${_nodeId}. Можно закрыть вкладку.`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
}

// v0.60.134 (по репорту Пользователя 2026-05-04 «как то объедини выбор и
// отображение проекта в одном месте»): sidebar-picker выпилен — он был
// дубликатом header chip (rs-proj-badge в shared/app-header.js). Header
// chip уже показывает активный проект и по клику открывает меню
// переключения / создания. Stub оставлен для совместимости call-sites.
function renderProjectContext() {
  const el = $('dg-project-context');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}

// v0.60.224: блокировка поля loadKw на значении из схемы (требуемая
// мощность узла-генератора). Снимается через кнопку «✏ ручной режим».
let _loadKwLocked = false;
function _lockLoadKwToSchema() {
  const inp = $('dg-loadKw');
  if (!inp) return;
  _loadKwLocked = true;
  inp.readOnly = true;
  inp.style.background = '#f1f5f9';
  inp.style.cursor = 'not-allowed';
  inp.title = 'Поле заблокировано: значение из узла схемы (запрашиваемая мощность). Нажмите ✏ ниже, чтобы перейти в ручной режим.';
  // Добавим indicator + unlock-button под инпутом, если ещё не добавлены.
  let hint = document.getElementById('dg-loadKw-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'dg-loadKw-hint';
    hint.style.cssText = 'font-size:11px;margin-top:4px;color:#1e40af;line-height:1.4';
    inp.parentElement?.appendChild(hint);
  }
  hint.innerHTML = `🔗 <b>Из схемы:</b> ${_state.loadKw} кВт (требуемая мощность узла).
    <button type="button" id="dg-loadKw-unlock" style="margin-left:6px;padding:1px 8px;font-size:11px;background:#fff;border:1px solid #cbd5e1;border-radius:3px;cursor:pointer"
      title="Перейти в ручной режим: можно ввести любое значение для эксперимента. Подбор будет по введённой цифре, а не по схеме.">✏ ручной режим</button>`;
  document.getElementById('dg-loadKw-unlock')?.addEventListener('click', _unlockLoadKw);
}
function _unlockLoadKw() {
  const inp = $('dg-loadKw');
  if (!inp) return;
  _loadKwLocked = false;
  inp.readOnly = false;
  inp.style.background = '';
  inp.style.cursor = '';
  inp.title = 'Суммарная электрическая нагрузка объекта (кВт): IT-стойки + охлаждение + потери ИБП + aux. Для ЦОД — обычно 1.4-1.6 × IT-нагрузка.';
  const hint = document.getElementById('dg-loadKw-hint');
  if (hint) {
    hint.innerHTML = `<span class="muted">⚠ Ручной режим: подбор по введённому значению, не по схеме.</span>
      <button type="button" id="dg-loadKw-relock" style="margin-left:6px;padding:1px 8px;font-size:11px;background:#fff;border:1px solid #cbd5e1;border-radius:3px;cursor:pointer"
        title="Вернуть значение из схемы и заблокировать поле.">🔗 вернуть к схеме</button>`;
    document.getElementById('dg-loadKw-relock')?.addEventListener('click', () => {
      // Перечитать URL-param и заблокировать.
      const qp = new URLSearchParams(location.search);
      const v = Number(qp.get('capacityKw'));
      if (Number.isFinite(v)) {
        _state.loadKw = v;
        _stateMeta.loadKw = 'url';
        applyStateToInputs();
        _lockLoadKwToSchema();
        recalcAndRender();
      }
    });
  }
  _stateMeta.loadKw = 'manual';
}

async function init() {
  // v0.60.81: project-context first, then load saved state, then URL params override.
  _pid = resolvePid();
  loadProjectState();
  // v0.60.91: ПЕРЕД URL-params (URL имеет приоритет) тянем данные из проекта
  // (мощность из TW concept, T из meteo, высота из location).
  await loadFromProject();
  readUrlParams();
  // v0.60.216: запоминаем nodeId для apply-bar.
  try { _nodeId = new URLSearchParams(location.search).get('nodeId') || null; } catch { _nodeId = null; }
  // v0.60.224 (по репорту Пользователя 2026-05-04 «дгу должен подбираться по
  // запрашиваемой мощности а не по полю которое пользователь ввел,
  // предположительная мощность»): когда конфигуратор открыт из инспектора
  // схемы (?nodeId= + ?capacityKw=), поле «Нагрузка, кВт» блокируется на
  // значении из схемы. Кнопка «✏ редактировать» снимает блокировку для
  // ручного эксперимента.
  if (_nodeId && _stateMeta.loadKw === 'url') {
    _lockLoadKwToSchema();
  }
  renderProjectContext();
  // Заполняем vendor select
  const vendors = listDguVendors();
  const vendorSel = $('dg-vendor');
  vendors.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    vendorSel.appendChild(opt);
  });
  applyStateToInputs();

  // Listeners — auto-recalc on any input change
  // v0.60.216: помечаем источник как 'manual' для полей с отслеживанием.
  const _manualMap = {
    'dg-loadKw': 'loadKw',
    'dg-altitude': 'altitudeM',
    'dg-tamb': 'ambientTC',
    'dg-rh': 'humidityPct',
  };
  ['dg-loadKw', 'dg-mode', 'dg-redundancy', 'dg-margin', 'dg-altitude', 'dg-tamb', 'dg-rh', 'dg-autonomy', 'dg-vendor'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (_manualMap[id]) _stateMeta[_manualMap[id]] = 'manual';
      recalcAndRender();
    });
  });
  $('dg-recalc')?.addEventListener('click', recalcAndRender);

  recalcAndRender();
}

document.addEventListener('DOMContentLoaded', init);
