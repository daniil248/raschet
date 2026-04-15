import { GLOBAL } from '../js/engine/constants.js';
import { getMethod, listMethods, calcVoltageDrop, findMinSizeForVdrop, getEcoMethod, listEcoMethods } from '../js/methods/index.js';

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
  ecoEnabled:        $('in-eco-enabled'),
  ecoFields:         $('eco-fields'),
  ecoMethod:         $('in-eco-method'),
  ecoParams:         $('eco-params'),
  btnCalc:           $('btn-calc'),
  resultArea:        $('result-area'),
};

let mode = 'current';
let currentMethod = null;
let currentEcoMethod = null;

// ============ Init ============
function init() {
  // Populate method selector
  els.methodStandard.innerHTML = listMethods().map(m =>
    `<option value="${m.id}">${m.label}</option>`
  ).join('');

  // Populate voltage levels
  els.voltageLevel.innerHTML = GLOBAL.voltageLevels.map((v, i) =>
    `<option value="${i}">${v.label}</option>`
  ).join('');

  // Populate economic methods
  els.ecoMethod.innerHTML = listEcoMethods().map(m =>
    `<option value="${m.id}">${m.label}</option>`
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
  els.ecoEnabled.addEventListener('change', () => {
    els.ecoFields.style.display = els.ecoEnabled.checked ? '' : 'none';
    if (els.ecoEnabled.checked) switchEcoMethod(els.ecoMethod.value);
  });
  els.ecoMethod.addEventListener('change', () => switchEcoMethod(els.ecoMethod.value));
  els.btnCalc.addEventListener('click', calculate);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') calculate();
  });

  switchMethod('iec');
  switchEcoMethod('pue_eco');
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
  // Render dynamic params
  els.ecoParams.innerHTML = (currentEcoMethod.params || []).map(p => {
    if (p.type === 'select') {
      const opts = p.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
      return `<div class="field"><label>${p.label}</label><select id="eco-param-${p.id}">${opts}</select></div>`;
    }
    return `<div class="field"><label>${p.label}</label><input type="number" id="eco-param-${p.id}" value="${p.default || 0}"></div>`;
  }).join('');
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
  return GLOBAL.voltageLevels[idx] || GLOBAL.voltageLevels[0];
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

  // 1. Подбор по токовой нагрузке (parallel=1, auto-increment)
  const resByAmp = currentMethod.selectCable(I, {
    material, insulation, method, cableType,
    ambient, grouping, bundling, maxSize, parallel: 1,
  });

  // 2. Vdrop
  const isDC = !!vl.dc;
  const effCosPhi = isDC ? 1 : cosPhi;
  const vdropAmp = calcVoltageDrop(I, resByAmp.s, material, lengthM, vl.vLL, vl.phases, effCosPhi, resByAmp.parallel, isDC);

  let sizeByVdrop = null;
  let vdropFinal = vdropAmp;

  if (lengthM > 0 && vdropAmp.dUpct > maxVdropPct) {
    const sizes = currentMethod.availableSizes(material, insulation, method).filter(s => s <= maxSize);
    sizeByVdrop = findMinSizeForVdrop(I, material, lengthM, vl.vLL, vl.phases, effCosPhi, resByAmp.parallel, maxVdropPct, sizes, isDC);
  }

  // 3. Экономическая плотность тока
  let ecoResult = null;
  if (els.ecoEnabled.checked && currentEcoMethod) {
    const sizes = currentMethod.availableSizes(material, insulation, method).filter(s => s <= maxSize);
    const insulated = true; // кабели с изоляцией
    ecoResult = currentEcoMethod.calcEconomicSize(I, material, insulated, getEcoParams(), sizes);
  }

  // 4. Итоговое сечение = max(по току, по Vdrop, по экон.плотности)
  let finalSize = resByAmp.s;
  let increasedBy = null;
  if (sizeByVdrop && sizeByVdrop > finalSize) { finalSize = sizeByVdrop; increasedBy = 'vdrop'; }
  if (ecoResult && ecoResult.sStandard > finalSize) { finalSize = ecoResult.sStandard; increasedBy = 'economic'; }

  if (finalSize > resByAmp.s) {
    vdropFinal = calcVoltageDrop(I, finalSize, material, lengthM, vl.vLL, vl.phases, effCosPhi, resByAmp.parallel, isDC);
  }

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

  renderResult(I, resByAmp, finalSize, increasedBy, In, vdropAmp, vdropFinal, maxVdropPct, ecoResult, protection, breakerOverflow, isDC, {
    material, insulation, method, cableType, ambient, grouping, bundling, lengthM, vl, cosPhi,
  });
}

// ============ Render results ============
function renderResult(I, res, finalSize, increasedBy, In, vdropAmp, vdropFinal, maxVdropPct, ecoResult, protection, breakerOverflow, isDC, params) {
  const matLabel = currentMethod.materials[params.material] || params.material;
  const insLabel = currentMethod.insulations[params.insulation] || params.insulation;
  const methLabel = currentMethod.installMethods[params.method] || params.method;
  const typeLabel = currentMethod.cableTypes[params.cableType] || params.cableType;
  const kTotal = res.kT * res.kG;
  const vdropOk = vdropFinal.dUpct <= maxVdropPct;
  const increased = finalSize > res.s;

  const overflowHtml = res.overflow
    ? `<div class="result-detail tag-overflow">Не удалось подобрать кабель, взято макс. сечение!</div>` : '';
  const autoParHtml = res.autoParallel
    ? `<div class="result-detail tag-warn">Авто: ${res.parallel} параллельных линий</div>` : '';

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
        ${overflowHtml}${autoParHtml}
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

    <h3 style="margin:20px 0 12px;font-size:14px;font-weight:600;color:#1f2430">Детали расчёта (${currentMethod.label})</h3>
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
}

// ============ Start ============
init();
