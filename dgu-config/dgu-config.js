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

import { calcDgu, DGU_MODES } from './calc/dgu-calc.js';
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
  margin: 15,
  altitudeM: 0,
  ambientTC: 25,
  humidityPct: 60,
  autonomyHours: 24,
  vendor: '',
};

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

function readUrlParams() {
  const qp = new URLSearchParams(location.search);
  if (qp.get('capacityKw')) _state.loadKw = Number(qp.get('capacityKw')) || _state.loadKw;
  if (qp.get('mode')) _state.mode = qp.get('mode');
  if (qp.get('redundancy')) _state.redundancy = qp.get('redundancy');
  if (qp.get('altitude')) _state.altitudeM = Number(qp.get('altitude')) || _state.altitudeM;
  if (qp.get('tamb')) _state.ambientTC = Number(qp.get('tamb')) || _state.ambientTC;
  if (qp.get('rh')) _state.humidityPct = Number(qp.get('rh')) || _state.humidityPct;
  if (qp.get('autonomy')) _state.autonomyHours = Number(qp.get('autonomy')) || _state.autonomyHours;
  if (qp.get('vendor')) _state.vendor = qp.get('vendor');
}

function syncStateFromInputs() {
  _state.loadKw = Number($('dg-loadKw').value) || _state.loadKw;
  _state.mode = $('dg-mode').value || _state.mode;
  _state.redundancy = $('dg-redundancy').value || _state.redundancy;
  _state.margin = Number($('dg-margin').value) || _state.margin;
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
  $('dg-margin').value = _state.margin;
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

function renderSuggestResult(spec) {
  const filter = { mode: _state.mode };
  if (_state.vendor) filter.vendor = _state.vendor;

  // Подбор: показываем top-5 ближайших по possKw
  const fieldByMode = { ESP: 'espKw', PRP: 'prpKw', COP: 'copKw' };
  const field = fieldByMode[_state.mode];
  const allDgus = listDgus(_state.vendor ? { vendor: _state.vendor } : {});
  const sorted = allDgus.slice().sort((a, b) => a[field] - b[field]);

  // Best = ближайшая ≥ requiredKw
  const best = sorted.find(d => d[field] >= spec.nameplateKw);
  const matches = sorted.filter(d => d[field] >= spec.nameplateKw && d[field] <= spec.nameplateKw * 1.5);

  if (!matches.length) {
    return `<div class="dg-warn">⚠ Нет моделей в каталоге, покрывающих требуемые ${fmt(spec.nameplateKw)} кВт по режиму ${escHtml(_state.mode)}${_state.vendor ? ` (вендор: ${escHtml(_state.vendor)})` : ''}. Попробуйте другой режим или снимите фильтр вендора.</div>`;
  }

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
          return `<tr class="${isBest ? 'dg-suggest-best' : ''}" title="${escAttr(d.notes || '')}">
            <td>${escHtml(d.vendor)}</td>
            <td><b>${escHtml(d.model)}</b></td>
            <td class="num"><b>${fmt(d[field])}</b></td>
            <td class="num">${fmt(d.espKw)} / ${fmt(d.prpKw)} / ${fmt(d.copKw)}</td>
            <td>${escHtml(d.engineModel)} (${d.cylinders} цил., ${fmt(d.displacement, 1)} L)</td>
            <td class="num">${p.lengthMm || '—'} × ${p.widthMm || '—'} × ${p.heightMm || '—'}</td>
            <td class="num">${p.weightKg ? fmt(p.weightKg) + ' кг' : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${best ? `<div class="dg-success">✓ Рекомендация: <b>${escHtml(best.vendor)} ${escHtml(best.model)}</b> — ${fmt(best[field])} кВт по ${escHtml(_state.mode)}, ${best.cylinders}-цилиндровый ${escHtml(best.engineModel)}, SFC ${fmt(best.sfcLkWh, 3)} л/кВт·ч.</div>` : ''}
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

function recalcAndRender() {
  syncStateFromInputs();
  const res = calcDgu(_state);
  $('dg-calc-result').innerHTML = renderCalcResult(res);
  $('dg-suggest-result').innerHTML = renderSuggestResult(res.spec);

  // Best для fuel
  const fieldByMode = { ESP: 'espKw', PRP: 'prpKw', COP: 'copKw' };
  const allDgus = listDgus(_state.vendor ? { vendor: _state.vendor } : {});
  const sorted = allDgus.slice().sort((a, b) => a[fieldByMode[_state.mode]] - b[fieldByMode[_state.mode]]);
  const best = sorted.find(d => d[fieldByMode[_state.mode]] >= res.spec.nameplateKw);
  $('dg-fuel-result').innerHTML = renderFuelResult(res, best);

  // v0.60.81: persist state per-project + auto-save best as selected
  saveProjectState();
  if (best) saveSelectedDgu(best);
}

function renderProjectContext() {
  const el = $('dg-project-context');
  if (!el) return;
  let projects = [];
  try { projects = listProjects() || []; } catch {}
  const opts = projects.map(p => {
    const labelText = p.name || p.designation || p.id;
    return `<option value="${escAttr(p.id)}"${p.id === _pid ? ' selected' : ''}>${escHtml(labelText)}</option>`;
  }).join('');
  el.innerHTML = `
    <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.4px"
           title="Проект, к которому привязан ДГУ-расчёт. Параметры и выбранная модель сохраняются автоматически.">📁 Контекст проекта</label>
    <select id="dg-project-sel" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px;background:#fff;cursor:pointer">
      ${opts || '<option value="">— нет проектов —</option>'}
    </select>
  `;
  const sel = el.querySelector('#dg-project-sel');
  if (!sel) return;
  sel.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v || v === _pid) return;
    const url = new URL(location.href);
    url.searchParams.set('project', v);
    location.href = url.toString();
  });
}

function init() {
  // v0.60.81: project-context first, then load saved state, then URL params override.
  _pid = resolvePid();
  loadProjectState();
  readUrlParams();
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
  ['dg-loadKw', 'dg-mode', 'dg-redundancy', 'dg-margin', 'dg-altitude', 'dg-tamb', 'dg-rh', 'dg-autonomy', 'dg-vendor'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', recalcAndRender);
  });
  $('dg-recalc')?.addEventListener('click', recalcAndRender);

  recalcAndRender();
}

document.addEventListener('DOMContentLoaded', init);
