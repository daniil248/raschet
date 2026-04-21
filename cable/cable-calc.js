import { GLOBAL } from '../js/engine/constants.js';
import { formatVoltageLevelLabel } from '../js/engine/electrical.js';
import { getMethod, listMethods, calcVoltageDrop, findMinSizeForVdrop, getEcoMethod, listEcoMethods } from '../js/methods/index.js';
import { runModules, listModules } from '../shared/calc-modules/index.js';
import * as Report from '../shared/report/index.js';
import * as B      from '../shared/report/blocks.js';

// Load saved global settings from localStorage (shared with constructor)
try {
  const raw = localStorage.getItem('raschet.global.v1');
  if (raw) { const saved = JSON.parse(raw); Object.assign(GLOBAL, saved); }
} catch (e) { /* ignore */ }

// ============ DOM refs ============
const $ = id => document.getElementById(id);

const els = {
  methodStandard:    $('in-method-standard'),
  methodLabel:       $('method-label'),
  inputMode:         $('input-mode'),
  fieldsCurrent:     $('fields-current'),
  fieldsPower:       $('fields-power'),
  current:           $('in-current'),
  power:             $('in-power'),
  voltageLevel:      $('in-voltage-level'),
  cosphi:            $('in-cosphi'),
  material:          $('in-material'),
  insulation:        $('in-insulation'),
  cableType:         $('in-cableType'),
  maxSize:           $('in-maxSize'),
  method:            $('in-method'),
  ambient:           $('in-ambient'),
  grouping:          $('in-grouping'),
  bundling:          $('in-bundling'),
  bundlingField:     $('bundling-field'),
  length:            $('in-length'),
  maxVdrop:          $('in-max-vdrop'),
  parallelProtection: $('in-parallel-protection'),
  btnCalc:           $('btn-calc'),
  btnReport:         $('btn-report'),
  resultArea:        $('result-area'),
};

let mode = 'current';
let currentMethod = null;
let currentEcoMethod = null;

// Последнее состояние расчёта для экспорта отчёта. Пока пользователь
// не нажал «Рассчитать» — null, и кнопка отчёта заблокирована.
let lastCalc = null;

// Состояние включённых опциональных модулей (mandatory всегда on).
// id → bool. Инициализируется из defaultOn при первом рендере.
const moduleEnabled = new Map();

// Рендерит список модулей с чекбоксами. Mandatory — чекбокс disabled
// + пометка 🔒, opt-модули — редактируемые.
function renderModulesList() {
  const wrap = document.getElementById('modules-list');
  if (!wrap) return;
  const items = listModules().map(mod => {
    if (!moduleEnabled.has(mod.id)) {
      moduleEnabled.set(mod.id, mod.mandatory || mod.defaultOn);
    }
    const on = moduleEnabled.get(mod.id);
    const disabled = mod.mandatory ? 'disabled' : '';
    return `<label class="mod-item" title="${mod.description.replace(/"/g, '&quot;')}">
      <input type="checkbox" data-mod="${mod.id}" ${on ? 'checked' : ''} ${disabled}>
      <span class="mod-label">${mod.label}</span>
    </label>`;
  }).join('');
  wrap.innerHTML = items;
  wrap.querySelectorAll('input[data-mod]').forEach(inp => {
    inp.addEventListener('change', () => {
      moduleEnabled.set(inp.dataset.mod, inp.checked);
    });
  });
}

// ============ Init ============
function init() {
  // Populate method selector
  els.methodStandard.innerHTML = listMethods().map(m =>
    `<option value="${m.id}">${m.label}</option>`
  ).join('');

  // Populate voltage levels
  els.voltageLevel.innerHTML = GLOBAL.voltageLevels.map((v, i) =>
    `<option value="${i}">${formatVoltageLevelLabel(v)}</option>`
  ).join('');

  // Events
  els.methodStandard.addEventListener('change', () => switchMethod(els.methodStandard.value));
  els.inputMode.addEventListener('click', e => {
    const lbl = e.target.closest('label');
    if (!lbl) return;
    mode = lbl.dataset.mode;
    els.inputMode.querySelectorAll('label').forEach(l => l.classList.toggle('active', l === lbl));
    els.fieldsCurrent.style.display = mode === 'current' ? '' : 'none';
    els.fieldsPower.style.display   = mode === 'power'   ? '' : 'none';
  });
  els.btnCalc.addEventListener('click', calculate);
  if (els.btnReport) els.btnReport.addEventListener('click', exportReport);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') calculate();
  });

  switchMethod('iec');
  switchEcoMethod('pue_eco');
  renderModulesList();
  calculate();
}

// ============ Switch cable method ============
function switchMethod(id) {
  currentMethod = getMethod(id);
  if (els.methodLabel) els.methodLabel.textContent = currentMethod.label;
  fillSelect(els.material, currentMethod.materials);
  fillSelect(els.insulation, currentMethod.insulations);
  fillSelect(els.cableType, currentMethod.cableTypes);
  fillSelect(els.method, currentMethod.installMethods);
  if (currentMethod.defaultMethod) els.method.value = currentMethod.defaultMethod;

  if (currentMethod.hasBundling) {
    els.bundlingField.style.display = '';
    fillSelect(els.bundling, currentMethod.bundlingOptions);
  } else {
    els.bundlingField.style.display = 'none';
  }
}

// ============ Switch economic method ============
function switchEcoMethod(id) {
  currentEcoMethod = getEcoMethod(id);
}

function fillSelect(el, map) {
  const prev = el.value;
  el.innerHTML = Object.entries(map).map(([k, v]) =>
    `<option value="${k}">${v}</option>`
  ).join('');
  if ([...el.options].some(o => o.value === prev)) el.value = prev;
}

// ============ Compute sizing current ============
function getVoltageInfo() {
  const idx = Number(els.voltageLevel.value) || 0;
  const lv = GLOBAL.voltageLevels[idx] || GLOBAL.voltageLevels[0];
  const isDC = lv.dc || (typeof lv.hz === 'number' && lv.hz === 0);
  const ph = document.getElementById('in-phase')?.value || '3ph';
  const phases = isDC ? 1 : (ph === '3ph' ? 3 : ph === '2ph' ? 2 : 1);
  return { ...lv, dc: isDC, phases, label: formatVoltageLevelLabel(lv) };
}

function getSizingCurrent() {
  if (mode === 'current') return Number(els.current.value) || 0;
  const P = Number(els.power.value) || 0;
  const vl = getVoltageInfo();
  if (P <= 0) return 0;
  if (vl.dc) {
    // DC: I = P / U
    return (P * 1000) / vl.vLL;
  }
  const cos = Number(els.cosphi.value) || 0.92;
  const k = vl.phases === 3 ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * vl.vLL * cos);
}

// ============ Gather economic params ============
function getEcoParams() {
  const params = {};
  for (const p of (currentEcoMethod.params || [])) {
    const el = document.getElementById(`eco-param-${p.id}`);
    params[p.id] = el ? Number(el.value) : (p.default || 0);
  }
  return params;
}

// ============ Main calculation ============
function calculate() {
  if (!currentMethod) return;

  const I = getSizingCurrent();
  if (I <= 0) {
    els.resultArea.innerHTML = '<div class="result-empty">Ток должен быть больше 0</div>';
    return;
  }

  const material    = els.material.value;
  const insulation  = els.insulation.value;
  const method      = els.method.value;
  const cableType   = els.cableType.value;
  const ambient     = Number(els.ambient.value) || 30;
  const grouping    = Number(els.grouping.value) || 1;
  const bundling    = currentMethod.hasBundling ? els.bundling.value : 'touching';
  const maxSize     = Number(els.maxSize.value) || 240;
  const lengthM     = Number(els.length.value) || 0;
  const maxVdropPct = Number(els.maxVdrop.value) || 5;
  const protection  = els.parallelProtection.value;
  const vl          = getVoltageInfo();
  const cosPhi      = Number(els.cosphi.value) || 0.92;

  const isDC = !!vl.dc;
  const effCosPhi = isDC ? 1 : cosPhi;
  const sizes = currentMethod.availableSizes(material, insulation, method).filter(s => s <= maxSize);
  const maxSizeInTable = sizes.length ? sizes[sizes.length - 1] : maxSize;

  // Константа k для термической проверки на КЗ (IEC 60364-4-43 Table A54).
  const K_SC = { Cu: { PVC: 115, XLPE: 143 }, Al: { PVC: 76, XLPE: 94 } };
  const kSC = (K_SC[material] || K_SC.Cu)[insulation] || 115;
  // Входные для КЗ — kA из формы. Используем и в солвере, и ниже
  // в moduleInput (чтобы не читать DOM дважды).
  const Ik_kA = Number(document.getElementById('in-ik')?.value) || 0;
  const tk_s  = Number(document.getElementById('in-tk')?.value) || 0;
  const breakerCurve   = document.getElementById('in-breakerCurve')?.value || 'MCB_C';
  const earthingSystem = document.getElementById('in-earthing')?.value   || 'TN-S';
  // Ik_A — ток КЗ в амперах (в форме пользователь вводит kA)
  const Ik_A = Ik_kA * 1000;
  const sBySc = (Ik_A > 0 && tk_s > 0)
    ? (Ik_A * Math.sqrt(tk_s)) / kSC
    : 0;
  const sBySCstd = sBySc > 0
    ? (sizes.find(s => s >= sBySc) || null)
    : null;

  // Экономическая плотность тока — управляется чекбоксом модуля economic
  let ecoResult = null;
  if (moduleEnabled.get('economic') && currentEcoMethod) {
    ecoResult = currentEcoMethod.calcEconomicSize(I, material, true, getEcoParams(), sizes);
  }

  // ============ Итеративный подбор ============
  // Для текущего числа параллельных линий подбираем сечение, которое
  // удовлетворяет ВСЕМ ограничениям: ампаситет, ΔU, экон. плотность,
  // термическая стойкость к КЗ. Если ни одно стандартное сечение (в
  // пределах maxSize) не проходит — наращиваем параллель.
  const maxPar = Number(GLOBAL.maxParallelAuto) || 10;
  let resByAmp = null;
  let finalSize = 0;
  let vdropFinal = { dU: 0, dUpct: 0 };
  let increasedBy = null;
  let vdropOverflow = false;
  let scOverflow    = false;
  let ecoOverflow   = false;

  for (let par = 1; par <= maxPar; par++) {
    // 1. Подбор по токовой нагрузке с фиксированной параллелью
    const sel = currentMethod.selectCable(I, {
      material, insulation, method, cableType,
      ambient, grouping, bundling, maxSize, parallel: par,
    });
    // Игнорируем auto-parallel внутри selectCable — мы управляем
    // параллелью сами, чтобы одновременно выдержать ΔU и КЗ.
    if (sel.autoParallel) {
      // selectCable сам нарастил — принимаем новое значение параллели
      par = sel.parallel;
    }
    let s = sel.s;
    let bumpedBy = null;

    // 2. ΔU
    let vdropCheck = null;
    if (lengthM > 0) {
      vdropCheck = calcVoltageDrop(I, s, material, lengthM, vl.vLL, vl.phases, effCosPhi, par, isDC);
      if (vdropCheck.dUpct > maxVdropPct) {
        const sV = findMinSizeForVdrop(I, material, lengthM, vl.vLL, vl.phases, effCosPhi, par, maxVdropPct, sizes, isDC);
        if (sV == null) {
          // даже максимальное сечение не тянет ΔU при этой параллели —
          // пробуем больше линий
          continue;
        }
        if (sV > s) { s = sV; bumpedBy = 'vdrop'; }
      }
    }

    // 3. Экономическая плотность тока
    if (ecoResult && ecoResult.sStandard) {
      if (ecoResult.sStandard > maxSizeInTable) {
        // не поместится в maxSize → нужен ещё один параллельный путь
        // экон. плотность делится между линиями: I/par
        // пересчитаем для новой параллели в отдельном блоке ниже
      }
      // Экон.плотность проверяем как порог для I/par — считаем заново
      // через ту же методику
      const ecoPerLine = currentEcoMethod.calcEconomicSize(I / par, material, true, getEcoParams(), sizes);
      if (ecoPerLine && ecoPerLine.sStandard && ecoPerLine.sStandard > s) {
        if (ecoPerLine.sStandard > maxSizeInTable) { continue; }
        s = ecoPerLine.sStandard;
        if (!bumpedBy) bumpedBy = 'economic';
      }
      // сохраним для отображения пересчитанный результат
      ecoResult = ecoPerLine || ecoResult;
    }

    // 4. Термическая стойкость к КЗ: S ≥ Ik·√tk / k
    if (sBySc > 0) {
      // Ток КЗ на одну линию делится на параллель (грубо, допустимо
      // для одинаковых линий одинаковой длины)
      const sScPar = (Ik_A * Math.sqrt(tk_s)) / kSC / par;
      const sScStd = sizes.find(sz => sz >= sScPar);
      if (sScStd == null) { continue; }
      if (sScStd > s) { s = sScStd; if (!bumpedBy) bumpedBy = 'shortCircuit'; }
    }

    // Все ограничения прошли — фиксируем результат
    resByAmp = sel;
    resByAmp.parallel = par;
    finalSize = s;
    increasedBy = bumpedBy;
    vdropFinal = lengthM > 0
      ? calcVoltageDrop(I, finalSize, material, lengthM, vl.vLL, vl.phases, effCosPhi, par, isDC)
      : { dU: 0, dUpct: 0 };
    break;
  }

  // Fallback если солвер не сошёлся (par>maxPar): используем ampacity-only
  // и помечаем проблемы — пользователь увидит красные теги.
  if (!resByAmp) {
    resByAmp = currentMethod.selectCable(I, {
      material, insulation, method, cableType,
      ambient, grouping, bundling, maxSize, parallel: 1,
    });
    finalSize = resByAmp.s;
    vdropFinal = lengthM > 0
      ? calcVoltageDrop(I, finalSize, material, lengthM, vl.vLL, vl.phases, effCosPhi, resByAmp.parallel, isDC)
      : { dU: 0, dUpct: 0 };
    vdropOverflow = lengthM > 0 && vdropFinal.dUpct > maxVdropPct;
    scOverflow = sBySc > 0 && sBySCstd == null;
    ecoOverflow = !!(ecoResult && ecoResult.sStandard > maxSizeInTable);
  }

  // vdropAmp = vdrop при подборе ТОЛЬКО по току (для отображения «до
  // увеличения»). Считаем один раз от resByAmp.s
  const vdropAmp = lengthM > 0
    ? calcVoltageDrop(I, resByAmp.s, material, lengthM, vl.vLL, vl.phases, effCosPhi, resByAmp.parallel, isDC)
    : { dU: 0, dUpct: 0 };
  // если вдруг итог совпал с ampacity — sizeByVdrop = null, иначе показываем
  const sizeByVdrop = (increasedBy === 'vdrop') ? finalSize : null;

  // 5. Автомат
  const parallel = resByAmp.parallel;
  let In;
  if (protection === 'individual') {
    In = currentMethod.selectBreaker(I / parallel);
  } else {
    In = currentMethod.selectBreaker(I);
  }
  // Проверка: автомат покрывает ток?
  const breakerOverflow = (protection === 'individual')
    ? (In < (I / parallel))
    : (In < I);

  // Синхронизация выпадающего списка «Характеристика автомата» с номиналом:
  // MCB (IEC 60898-1) физически ограничен 125 А, MCCB (IEC 60947-2) — до ~1600 А,
  // всё выше — ACB. Отключаем недоступные варианты и, если текущий выбор вышел
  // за границы, мягко переключаем пользователя на корректный класс.
  syncBreakerCurveOptions(In);

  // === Запуск расчётных модулей из shared/calc-modules/ ===
  // Обязательные (ampacity, vdrop, shortCircuit, phaseLoop) запускаются
  // всегда; опциональные (economic) — только если пользователь включил
  // в блоке «Расчётные модули». Ik_kA/tk_s/breakerCurve/earthingSystem
  // объявлены выше — переиспользуем.
  const enabledSet = new Set();
  for (const [id, on] of moduleEnabled.entries()) if (on) enabledSet.add(id);

  const moduleInput = {
    I, U: vl.vLL, phases: vl.phases, dc: isDC, cosPhi: effCosPhi,
    lengthM, maxVdropPct,
    material, insulation, method, cableType,
    ambient, grouping, bundling, maxSize,
    parallel: resByAmp.parallel,
    currentSize: finalSize,
    calcMethod: currentMethod.id || 'iec',
    ecoMethod: currentEcoMethod?.id || 'pue_eco',
    economicHours: (getEcoParams().hours || 5000),
    // КЗ
    IkA: Ik_kA * 1000,
    tkS: tk_s,
    // Петля фаза-ноль
    earthingSystem,
    breakerIn: In,
    breakerCurve,
    Uph: vl.vLN || (vl.phases === 3 ? vl.vLL / Math.sqrt(3) : vl.vLL),
  };
  const moduleResults = runModules(moduleInput, enabledSet);

  const renderParams = { material, insulation, method, cableType, ambient, grouping, bundling, lengthM, vl, cosPhi };
  const overflowFlags = { vdropOverflow, scOverflow, ecoOverflow };
  renderResult(I, resByAmp, finalSize, increasedBy, In, vdropAmp, vdropFinal, maxVdropPct, ecoResult, protection, breakerOverflow, isDC,
    renderParams, moduleResults, overflowFlags);

  // Запомнить состояние для экспорта отчёта
  lastCalc = {
    I, res: resByAmp, finalSize, increasedBy, In,
    vdropAmp, vdropFinal, maxVdropPct, ecoResult,
    protection, breakerOverflow, isDC,
    params: renderParams, moduleResults,
    overflowFlags,
  };
  if (els.btnReport) els.btnReport.disabled = false;
}

// ============ Render module cards ============
// Выводит карточку на каждый запущенный модуль — пользователь видит
// влияние каждого расчёта независимо.
function renderModuleCards(moduleResults) {
  if (!moduleResults || !moduleResults.length) return '';
  const cards = moduleResults.map(m => {
    const { result } = m;
    const passCls = result.pass ? 'ok' : 'warn';
    const status = result.details?.skipped
      ? '<span class="tag-muted">пропущен</span>'
      : (result.pass ? '<span class="tag-ok">OK</span>' : '<span class="tag-overflow">проблема</span>');
    const warnsHtml = (result.warnings || []).map(w =>
      `<div class="mod-warn">⚠ ${w}</div>`).join('');
    let detailsHtml = '';
    const d = result.details || {};
    if (m.id === 'ampacity' && !d.skipped) {
      detailsHtml = `
        <div>S: <b>${d.s} мм²</b> · I<sub>z</sub>: <b>${d.iDerated?.toFixed(1)} А</b>
          · K<sub>T</sub>×K<sub>G</sub> = ${d.kTotal?.toFixed(3) || '—'}
          · параллель: ${d.parallel || 1}</div>`;
    } else if (m.id === 'vdrop' && !d.skipped) {
      detailsHtml = `
        <div>ΔU = <b>${d.dUpct?.toFixed(2)}%</b> (${d.dUvolts?.toFixed(2)} В)
          при ${d.s} мм² · допустимо ≤ ${d.maxPct}%</div>
        ${d.bumpedTo ? `<div>Рекомендуется увеличить до <b>${d.bumpedTo} мм²</b></div>` : ''}`;
    } else if (m.id === 'economic' && !d.skipped) {
      detailsHtml = `
        <div>j<sub>эк</sub> = <b>${d.jEk} А/мм²</b>
          · S<sub>расч</sub> = ${d.sCalc} мм²
          · S<sub>станд</sub> = <b>${d.sStandard} мм²</b>
          · часов/год: ${d.hours}</div>`;
    } else if (m.id === 'shortCircuit' && !d.skipped) {
      detailsHtml = `
        <div>I<sub>k</sub> = <b>${d.IkA} А</b> · t<sub>k</sub> = ${d.tkS} с
          · k = ${d.k} (${d.material}/${d.insulation})</div>
        <div>S<sub>min</sub> = <b>${d.sRequired} мм²</b> · текущее ${d.sCurrent} мм²</div>`;
    } else if (m.id === 'phaseLoop' && !d.skipped) {
      detailsHtml = `
        <div>Система: <b>${d.earthing}</b>
          · Z<sub>loop</sub> = <b>${d.Zloop} Ом</b>
          · U<sub>ф</sub> = ${d.Uph} В</div>
        <div>I<sub>k1</sub> = <b>${d.Ik1} А</b>
          · I<sub>a</sub> = ${d.Ia} А (${d.breakerCurve} ${d.In}А × ${d.multiplier})</div>`;
    } else if (d.skipped) {
      detailsHtml = `<div class="muted">Пропущен: ${d.reason || 'нет данных'}</div>`;
    }
    return `
      <div class="mod-card ${passCls}">
        <div class="mod-head">
          <span class="mod-title">${m.label}</span>
          ${status}
        </div>
        <div class="mod-body">${detailsHtml}</div>
        ${warnsHtml}
      </div>`;
  }).join('');
  return `<h3 style="margin:24px 0 10px;font-size:14px;font-weight:600;color:#1f2430">Результаты расчётных модулей</h3>
    <div class="mod-list">${cards}</div>`;
}

// ============ Render results ============
function renderResult(I, res, finalSize, increasedBy, In, vdropAmp, vdropFinal, maxVdropPct, ecoResult, protection, breakerOverflow, isDC, params, moduleResults, overflowFlags) {
  overflowFlags = overflowFlags || {};
  const matLabel = currentMethod.materials[params.material] || params.material;
  const insLabel = currentMethod.insulations[params.insulation] || params.insulation;
  const methLabel = currentMethod.installMethods[params.method] || params.method;
  const typeLabel = currentMethod.cableTypes[params.cableType] || params.cableType;
  const kTotal = res.kT * res.kG;
  const vdropOk = vdropFinal.dUpct <= maxVdropPct;
  const increased = finalSize > res.s;

  const overflowHtml = res.overflow
    ? `<div class="result-detail tag-overflow">Не удалось подобрать кабель, взято макс. сечение!</div>` : '';
  const autoParHtml = res.parallel > 1
    ? `<div class="result-detail tag-warn">${res.autoParallel ? 'Авто' : 'Солвер'}: ${res.parallel} параллельных линий</div>` : '';
  // Явные сообщения, когда солвер не сошёлся по какому-то из ограничений
  // даже при maxPar параллельных линий.
  const solverFailHtml = [
    overflowFlags.vdropOverflow ? '<div class="result-detail tag-overflow">⛔ ΔU не укладывается даже при максимальной параллели — увеличьте maxSize, выбирайте более крупный автомат или сокращайте длину.</div>' : '',
    overflowFlags.scOverflow    ? '<div class="result-detail tag-overflow">⛔ Термическая стойкость к КЗ не проходит — увеличьте maxSize или ускорьте отключение автомата (t_k).</div>' : '',
    overflowFlags.ecoOverflow   ? '<div class="result-detail tag-warn">⚠ Экон. плотность требует сечение больше maxSize — добавьте параллельные линии вручную.</div>' : '',
  ].filter(Boolean).join('');

  let recommendHtml = '';
  if (increased) {
    let reason = '';
    if (increasedBy === 'vdrop') {
      reason = `При ${res.s} мм&sup2; падение напряжения ${vdropAmp.dUpct.toFixed(2)}% > ${maxVdropPct}%. Увеличено до ${finalSize} мм&sup2; (&Delta;U = ${vdropFinal.dUpct.toFixed(2)}%).`;
    } else if (increasedBy === 'economic') {
      reason = `По экономической плотности тока требуется ${finalSize} мм&sup2; (j<sub>эк</sub> = ${ecoResult.jEk} А/мм&sup2;, S<sub>расч</sub> = ${ecoResult.sCalc} мм&sup2;).`;
    }
    recommendHtml = `<div class="result-card recommend"><h3>Рекомендация</h3><div class="result-detail">${reason}</div></div>`;
  }

  // Economic card
  let ecoHtml = '';
  if (ecoResult) {
    ecoHtml = `
      <div class="result-card ${ecoResult.sStandard > res.s ? 'warn' : ''}">
        <h3>Экономическая плотность</h3>
        <div class="result-value">${ecoResult.sStandard}<span class="unit">мм&sup2;</span></div>
        <div class="result-detail">
          j<sub>эк</sub> = ${ecoResult.jEk} А/мм&sup2;<br>
          S<sub>расч</sub> = ${ecoResult.sCalc} мм&sup2;<br>
          ${ecoResult.description}
        </div>
      </div>`;
  }

  const protLabel = protection === 'individual' ? 'Индивид. (I/n)' : 'Общая (I)';

  const html = `
    <div class="result-grid">
      <div class="result-card highlight">
        <h3>Сечение кабеля ${increased ? '(итоговое)' : ''}</h3>
        <div class="result-value">${finalSize}<span class="unit">мм&sup2;</span></div>
        <div class="result-detail">
          ${matLabel}, ${insLabel}, ${typeLabel}<br>
          ${res.parallel > 1 ? res.parallel + ' параллельных линий' : '1 линия'}
          ${increased ? '<br><span class="tag-warn">Увеличено (' + (increasedBy === 'vdrop' ? '&Delta;U' : 'j<sub>эк</sub>') + ')</span>' : ''}
        </div>
        ${overflowHtml}${autoParHtml}${solverFailHtml}
      </div>

      <div class="result-card ${breakerOverflow ? 'warn' : ''}">
        <h3>Автомат защиты</h3>
        <div class="result-value ${breakerOverflow ? 'tag-overflow' : ''}">${In}<span class="unit">А</span></div>
        <div class="result-detail">${protLabel}${breakerOverflow ? '<br><span class="tag-overflow">Номинал автомата недостаточен!</span>' : ''}</div>
      </div>

      <div class="result-card">
        <h3>Допустимый ток</h3>
        <div class="result-value">${res.iDerated.toFixed(1)}<span class="unit">А/линию</span></div>
        <div class="result-detail">
          Табличный: <strong>${res.iAllowed} А</strong><br>
          После снижения: <strong>${res.iDerated.toFixed(1)} А</strong>
          ${res.parallel > 1 ? '<br>Суммарно: <strong>' + res.totalCapacity.toFixed(1) + ' А</strong>' : ''}
        </div>
      </div>

      <div class="result-card ${!vdropOk ? 'warn' : ''}">
        <h3>Падение напряжения</h3>
        <div class="result-value ${!vdropOk ? 'tag-warn' : ''}">${vdropFinal.dUpct.toFixed(2)}<span class="unit">%</span></div>
        <div class="result-detail">
          &Delta;U = ${vdropFinal.dU.toFixed(2)} В при ${params.lengthM} м<br>
          ${params.vl.label}${isDC ? ' (DC)' : ', cos&phi; = ' + params.cosPhi}<br>
          <span class="${vdropOk ? 'tag-ok' : 'tag-overflow'}">${vdropOk ? 'В норме (\u2264' + maxVdropPct + '%)' : 'Превышение!'}</span>
        </div>
      </div>

      ${ecoHtml}
    </div>

    ${recommendHtml}

    ${renderModuleCards(moduleResults)}

    <h3 style="margin:20px 0 12px;font-size:14px;font-weight:600;color:#1f2430">Детали расчёта</h3>
    <table class="detail-table">
      <tr><th colspan="2">Параметры</th></tr>
      <tr><td>Расчётный ток (I<sub>расч</sub>)</td><td>${I.toFixed(2)} А</td></tr>
      <tr><td>Ток на линию (I / n)</td><td>${(I / res.parallel).toFixed(2)} А</td></tr>
      <tr><td>Номинал автомата (I<sub>n</sub>)</td><td>${In} А (${protLabel})</td></tr>
      <tr><td>Параллельных линий</td><td>${res.parallel}${res.autoParallel ? ' (авто)' : ''}</td></tr>
      <tr><td>Способ прокладки</td><td>${methLabel}</td></tr>
      <tr><td>Температура среды</td><td>${params.ambient} &deg;C</td></tr>
      <tr><td>Кабелей в группе</td><td>${params.grouping}</td></tr>
      ${currentMethod.hasBundling ? `<tr><td>Укладка</td><td>${params.bundling}</td></tr>` : ''}
      <tr><th colspan="2">Коэффициенты снижения</th></tr>
      <tr><td>K<sub>t</sub> (температура)</td><td>${res.kT.toFixed(3)}</td></tr>
      <tr><td>K<sub>g</sub> (группирование)</td><td>${res.kG.toFixed(3)}</td></tr>
      <tr><td>K<sub>total</sub></td><td><strong>${kTotal.toFixed(3)}</strong></td></tr>
      <tr><th colspan="2">Подбор сечения</th></tr>
      <tr><td>По токовой нагрузке</td><td>${res.s} мм&sup2;</td></tr>
      ${increased && increasedBy === 'vdrop' ? `<tr><td>По &Delta;U</td><td>${finalSize} мм&sup2;</td></tr>` : ''}
      ${ecoResult ? `<tr><td>По экон. плотности (j<sub>эк</sub>=${ecoResult.jEk})</td><td>${ecoResult.sStandard} мм&sup2;</td></tr>` : ''}
      <tr><td>Итоговое</td><td><strong>${finalSize} мм&sup2;</strong></td></tr>
      ${params.lengthM > 0 ? `
      <tr><th colspan="2">Падение напряжения</th></tr>
      <tr><td>&Delta;U при ${finalSize} мм&sup2;</td><td>${vdropFinal.dUpct.toFixed(2)}% (${vdropFinal.dU.toFixed(2)} В)</td></tr>
      <tr><td>Допустимо &le; ${maxVdropPct}%</td><td><span class="${vdropOk ? 'tag-ok' : 'tag-overflow'}">${vdropOk ? 'OK' : 'НЕТ'}</span></td></tr>
      ` : ''}
    </table>
  `;

  els.resultArea.innerHTML = html;

  // === TCC-карта защиты линии (Фаза 1.17) ===
  // Показывается блок «Координация защиты автомата и кабеля» с графиком
  // время-токовых характеристик: кривая автомата + термостойкость кабеля
  // + вертикальная линия I_k. Если автомат adjustable — слайдеры
  // настроек (Ir/Isd/tsd/Ii) меняют кривую в реальном времени.
  _renderTccCoordination({
    finalSize, breakerIn: In, params, isDC,
  });
}

// Синхронизация выпадающего «Характеристика автомата» с подобранным номиналом In.
// Границы: MCB ≤ 125 А (IEC 60898-1), MCCB ≤ 1600 А (IEC 60947-2), выше — ACB.
function syncBreakerCurveOptions(In) {
  const sel = document.getElementById('in-breakerCurve');
  if (!sel) return;
  const allowMcb  = In <= 125;
  const allowMccb = In <= 1600;
  const allowAcb  = true;
  const rules = { MCB_B: allowMcb, MCB_C: allowMcb, MCB_D: allowMcb, MCCB: allowMccb, ACB: allowAcb };
  for (const opt of sel.options) {
    const ok = rules[opt.value] !== false;
    opt.disabled = !ok;
    // Подсказка в тексте опции (не меняем value)
    const base = opt.dataset.baseLabel || opt.textContent;
    if (!opt.dataset.baseLabel) opt.dataset.baseLabel = base;
    opt.textContent = ok ? base : `${base} — недоступно для ${In} А`;
  }
  // Если текущий выбор запрещён — переключаем на ближайший разрешённый класс.
  if (rules[sel.value] === false) {
    sel.value = allowMccb ? 'MCCB' : 'ACB';
    // Пересчитать, чтобы модули увидели корректный класс (но без рекурсии — только если значение реально сменилось).
    try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
  }
}

// Динамический import shared/tcc-chart — грузится только когда нужно
let _tccChartModule = null;
async function _loadTccChart() {
  if (!_tccChartModule) _tccChartModule = await import('../shared/tcc-chart.js');
  return _tccChartModule;
}

async function _renderTccCoordination({ finalSize, breakerIn, params, isDC }) {
  // Находим контейнер или создаём
  let block = document.getElementById('tcc-coord-block');
  if (!block) {
    block = document.createElement('div');
    block.id = 'tcc-coord-block';
    block.style.cssText = 'margin-top:24px;padding:14px;background:#fff;border:1px solid #e1e4e8;border-radius:6px';
    els.resultArea.appendChild(block);
  }
  // Читаем текущие параметры защиты из формы
  const IkA_raw = Number(document.getElementById('in-ik')?.value) || 0;
  const IkA = IkA_raw * 1000; // кА → А
  const breakerCurveFull = document.getElementById('in-breakerCurve')?.value || 'MCB_C';
  // Нормализация: MCB_B → 'B', MCCB → 'MCCB'
  const curveMap = { MCB_B: 'B', MCB_C: 'C', MCB_D: 'D', MCCB: 'C', ACB: 'C' };
  const curveShort = curveMap[breakerCurveFull] || 'C';
  const isMcb = breakerCurveFull.startsWith('MCB_');

  // Коэффициент k для материала/изоляции (IEC 60364-4-43)
  const k = params.material === 'Al'
    ? (params.insulation === 'XLPE' ? 94 : 76)
    : (params.insulation === 'XLPE' ? 143 : 115);

  block.innerHTML = `
    <h3 style="margin:0 0 4px;font-size:14px;font-weight:600;color:#1f2430">⚡ Координация защиты: автомат ↔ кабель</h3>
    <div class="muted" style="font-size:12px;margin-bottom:10px">
      Время-токовая характеристика выбранного автомата и линия термостойкости подобранного кабеля.
      На графике видно, отключает ли автомат КЗ раньше, чем нагреется проводник.
      ${isMcb ? 'Для настраиваемых расцепителей (MCCB/ACB с LSI) — слайдеры ниже, изменения отразятся на графике.' : ''}
    </div>
    <div id="tcc-coord-chart"></div>
    <div id="tcc-coord-controls" style="margin-top:10px"></div>
  `;

  const { mountTccChart } = await _loadTccChart();

  const baseItems = [
    {
      id: 'breaker',
      kind: 'breaker',
      In: breakerIn,
      curve: curveShort,
      label: `${isMcb ? 'MCB' : breakerCurveFull} ${curveShort}${breakerIn} A (защита)`,
      color: '#1976d2',
    },
    {
      id: 'cable',
      kind: 'cable',
      S_mm2: finalSize,
      k,
      label: `Проводник ${params.material}/${params.insulation} ${finalSize} мм² (термостойкость, k=${k})`,
      color: '#d32f2f',
    },
  ];

  const chartEl = document.getElementById('tcc-coord-chart');
  const handle = mountTccChart(chartEl, {
    items: baseItems,
    xRange: [Math.max(1, breakerIn * 0.8), Math.max(IkA * 1.5, breakerIn * 200)],
    yRange: [0.003, 10000],
    width: Math.min(chartEl.clientWidth || 650, 750),
    height: 400,
    ikMax: IkA > 0 ? IkA : null,
  });

  // Если автомат из нашего типа MCCB (а он здесь не adjustable — у нас MCB
  // плоско в cable/), adjustable-слайдеры пропускаем. Но если пользователь
  // явно указал MCCB — добавляем демо-настройки (позже в Фазе 1.10.2 будет
  // полноценное подключение к element-library по выбранной модели).
  const controls = document.getElementById('tcc-coord-controls');
  if (!isMcb) {
    const Ir_min = Math.round(breakerIn * 0.4);
    const Ir_max = breakerIn;
    const Isd_min = breakerIn * 1.5;
    const Isd_max = breakerIn * 10;
    controls.innerHTML = `
      <div style="padding:10px;background:#f6f8fa;border-radius:5px;font-size:12px">
        <div style="font-weight:600;margin-bottom:6px">Настройки расцепителя (LSI)</div>
        <div style="display:grid;grid-template-columns:140px 1fr 80px;gap:8px;align-items:center">
          <label>Ir (долгий), A</label>
          <input type="range" id="tcc-Ir" min="${Ir_min}" max="${Ir_max}" step="1" value="${Math.round(breakerIn * 0.9)}">
          <span id="tcc-Ir-val" style="font-family:monospace">${Math.round(breakerIn * 0.9)}</span>

          <label>Isd (короткий), A</label>
          <input type="range" id="tcc-Isd" min="${Isd_min}" max="${Isd_max}" step="${Math.round(breakerIn * 0.5)}" value="${Math.round(breakerIn * 6)}">
          <span id="tcc-Isd-val" style="font-family:monospace">${Math.round(breakerIn * 6)}</span>

          <label>tsd (задержка), с</label>
          <input type="range" id="tcc-tsd" min="0.05" max="0.5" step="0.05" value="0.1">
          <span id="tcc-tsd-val" style="font-family:monospace">0.10</span>
        </div>
        <div class="muted" style="font-size:11px;margin-top:6px">
          Ir — уставка теплового (долгий расцепитель).
          Isd — магнитный короткий (селективность).
          tsd — задержка Isd для координации с нижестоящими.
        </div>
      </div>
    `;

    // Live-обновление графика при изменении настроек
    const applySettings = () => {
      const Ir = Number(document.getElementById('tcc-Ir').value);
      const Isd = Number(document.getElementById('tcc-Isd').value);
      const tsd = Number(document.getElementById('tcc-tsd').value);
      document.getElementById('tcc-Ir-val').textContent = Ir;
      document.getElementById('tcc-Isd-val').textContent = Isd;
      document.getElementById('tcc-tsd-val').textContent = tsd.toFixed(2);
      // Пересчитываем эффективный In = Ir (уставка теплового сдвигает кривую)
      // для демонстрации используем упрощённую модель — реальный расчёт с
      // аналитическим расцепителем требует shared/tcc-curves extension (Фаза 1.10.2)
      handle.update({
        items: [
          { ...baseItems[0], In: Ir, label: `MCCB LSI · Ir=${Ir}A · Isd=${Isd}A · tsd=${tsd.toFixed(2)}с` },
          baseItems[1],
        ],
      });
    };
    controls.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', applySettings));
  } else {
    controls.innerHTML = `<div class="muted" style="font-size:11px;padding:6px 10px;background:#fff4e5;border-radius:4px">
      У MCB (${breakerCurveFull}) характеристика фиксированная (термомагнитный расцепитель, настройки не регулируются).
      Для подбора с регулировкой используйте MCCB с электронным расцепителем.
    </div>`;
  }
}

// ============ Экспорт отчёта ============
// Пользователь выбирает шаблон из каталога (shared/report-catalog.js),
// подпрограмма собирает блоки содержимого из lastCalc и рендерит PDF
// через shared/report/. Для DOCX можно заменить exportPDF на exportDOCX.
async function exportReport() {
  if (!lastCalc) {
    alert('Сначала выполните расчёт.');
    return;
  }
  const rec = await Report.pickTemplate({
    title: 'Выбор шаблона для отчёта по расчёту кабеля',
    tags:  ['кабель','расчёты','общее','инженерный'],
  });
  if (!rec) return;

  const tpl = Report.createTemplate(rec.template);
  tpl.meta.title  = 'Расчёт кабельной линии';
  tpl.meta.author = tpl.meta.author || '';
  tpl.content = buildCableReportBlocks(lastCalc);

  try {
    await Report.exportPDF(tpl, 'Расчёт кабельной линии');
  } catch (e) {
    alert('Не удалось сформировать PDF: ' + (e && e.message ? e.message : e));
  }
}

/** Преобразует lastCalc в массив блоков отчёта. */
function buildCableReportBlocks(c) {
  const p = c.params;
  const matLabel = currentMethod.materials[p.material] || p.material;
  const insLabel = currentMethod.insulations[p.insulation] || p.insulation;
  const methLabel = currentMethod.installMethods[p.method] || p.method;
  const typeLabel = currentMethod.cableTypes[p.cableType] || p.cableType;
  const fix = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));
  const maxVdropPct = c.maxVdropPct;
  const vdropOk = c.vdropFinal.dUpct <= maxVdropPct;

  const blocks = [
    B.h1('Отчёт о расчёте кабельной линии'),
    B.caption('Методика: ' + (currentMethod.label || '—')),

    B.h2('1. Исходные данные'),
    B.table(
      [
        { text: 'Параметр',  width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Ед.',      align: 'center', width: 18 },
      ],
      [
        ['Расчётный ток нагрузки',  fix(c.I),     'А'],
        ['Напряжение системы',      String(p.vl.label || ''), ''],
        ['Длина линии',             String(p.lengthM), 'м'],
        ['cos φ',                   c.isDC ? '—' : String(p.cosPhi), '—'],
        ['Материал жилы',           matLabel,   ''],
        ['Изоляция',                insLabel,   ''],
        ['Тип кабеля',              typeLabel,  ''],
        ['Способ прокладки',        methLabel,  ''],
        ['Температура среды',       String(p.ambient), '°C'],
        ['Кабелей в группе',        String(p.grouping), ''],
        ['Допустимое ΔU',           String(maxVdropPct), '%'],
      ],
    ),

    B.h2('2. Коэффициенты снижения'),
    B.table(
      [
        { text: 'Параметр',  width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
      ],
      [
        ['K_t (температура)',   fix(c.res.kT, 3)],
        ['K_g (группирование)', fix(c.res.kG, 3)],
        ['K_total',             fix(c.res.kT * c.res.kG, 3)],
      ],
    ),

    B.h2('3. Результаты подбора'),
    B.table(
      [
        { text: 'Параметр',  width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Ед.',      align: 'center', width: 18 },
      ],
      [
        ['По длительному току',          String(c.res.s),         'мм²'],
        ['Итоговое сечение',             String(c.finalSize),     'мм²'],
        ['Параллельных линий',           String(c.res.parallel),  ''],
        ['Допустимый ток (табличный)',   String(c.res.iAllowed),  'А'],
        ['Допустимый ток с поправками',  fix(c.res.iDerated, 1),  'А'],
        ['Номинал автомата',             String(c.In),            'А'],
        ['Падение напряжения ΔU',        fix(c.vdropFinal.dUpct, 2), '%'],
        ['Падение напряжения ΔU',        fix(c.vdropFinal.dU, 2), 'В'],
      ],
    ),
    B.paragraph('Проверка по падению напряжения: ' + (vdropOk
      ? 'в норме (≤ ' + maxVdropPct + '%).'
      : 'ПРЕВЫШЕНИЕ (> ' + maxVdropPct + '%).')),
  ];

  // Карточки модулей, если они были запущены
  if (Array.isArray(c.moduleResults) && c.moduleResults.length) {
    blocks.push(B.h2('4. Результаты расчётных модулей'));
    for (const m of c.moduleResults) {
      const status = m.result.details && m.result.details.skipped
        ? 'пропущен'
        : (m.result.pass ? 'OK' : 'проблема');
      blocks.push(B.h3(m.label + ' — ' + status));
      const d = m.result.details || {};
      const lines = [];
      if (m.id === 'ampacity' && !d.skipped) {
        lines.push('S = ' + d.s + ' мм²  ·  I_z = ' + (d.iDerated != null ? d.iDerated.toFixed(1) : '—') + ' А  ·  параллель: ' + (d.parallel || 1));
      } else if (m.id === 'vdrop' && !d.skipped) {
        lines.push('ΔU = ' + (d.dUpct != null ? d.dUpct.toFixed(2) : '—') + ' % (допустимо ≤ ' + d.maxPct + ' %)');
        if (d.bumpedTo) lines.push('Рекомендовано увеличить до ' + d.bumpedTo + ' мм²');
      } else if (m.id === 'economic' && !d.skipped) {
        lines.push('j_эк = ' + d.jEk + ' А/мм²  ·  S_расч = ' + d.sCalc + ' мм²  ·  S_станд = ' + d.sStandard + ' мм²');
      } else if (m.id === 'shortCircuit' && !d.skipped) {
        lines.push('I_k = ' + d.IkA + ' А  ·  t_k = ' + d.tkS + ' с  ·  S_min = ' + d.sRequired + ' мм²');
      } else if (m.id === 'phaseLoop' && !d.skipped) {
        lines.push('Система заземления: ' + d.earthing + '  ·  Z_loop = ' + d.Zloop + ' Ом');
        lines.push('I_k1 = ' + d.Ik1 + ' А  ·  I_a = ' + d.Ia + ' А (' + d.breakerCurve + ' ' + d.In + ' А × ' + d.multiplier + ')');
      } else if (d.skipped) {
        lines.push('Пропущен: ' + (d.reason || 'нет данных'));
      }
      if (lines.length) blocks.push(B.paragraph(lines.join('\n')));
      if (m.result.warnings && m.result.warnings.length) {
        blocks.push(B.list(m.result.warnings.map(w => '⚠ ' + w)));
      }
    }
  }

  blocks.push(B.hr());
  blocks.push(B.caption('Документ сформирован автоматически.'));
  return blocks;
}

// ============ Start ============
init();
