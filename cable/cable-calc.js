import { GLOBAL } from '../js/engine/constants.js';
import { getMethod, listMethods, calcVoltageDrop, findMinSizeForVdrop } from '../js/methods/index.js';

// ============ DOM refs ============
const $ = id => document.getElementById(id);

const els = {
  methodStandard: $('in-method-standard'),
  methodLabel:    $('method-label'),
  inputMode:      $('input-mode'),
  fieldsCurrent:  $('fields-current'),
  fieldsPower:    $('fields-power'),
  current:        $('in-current'),
  power:          $('in-power'),
  voltageLevel:   $('in-voltage-level'),
  cosphi:         $('in-cosphi'),
  material:       $('in-material'),
  insulation:     $('in-insulation'),
  cableType:      $('in-cableType'),
  maxSize:        $('in-maxSize'),
  method:         $('in-method'),
  ambient:        $('in-ambient'),
  grouping:       $('in-grouping'),
  bundling:       $('in-bundling'),
  bundlingField:  $('bundling-field'),
  parallel:       $('in-parallel'),
  length:         $('in-length'),
  maxVdrop:       $('in-max-vdrop'),
  btnCalc:        $('btn-calc'),
  resultArea:     $('result-area'),
};

let mode = 'current';
let currentMethod = null;

// ============ Init ============
function init() {
  // Populate method selector
  const methods = listMethods();
  els.methodStandard.innerHTML = methods.map(m =>
    `<option value="${m.id}">${m.label}</option>`
  ).join('');

  // Populate voltage levels from GLOBAL
  els.voltageLevel.innerHTML = GLOBAL.voltageLevels.map((v, i) =>
    `<option value="${i}">${v.label}</option>`
  ).join('');

  // Switch method
  els.methodStandard.addEventListener('change', () => switchMethod(els.methodStandard.value));

  // Input mode toggle
  els.inputMode.addEventListener('click', e => {
    const lbl = e.target.closest('label');
    if (!lbl) return;
    mode = lbl.dataset.mode;
    els.inputMode.querySelectorAll('label').forEach(l => l.classList.toggle('active', l === lbl));
    els.fieldsCurrent.style.display = mode === 'current' ? '' : 'none';
    els.fieldsPower.style.display   = mode === 'power'   ? '' : 'none';
  });

  // Calc button
  els.btnCalc.addEventListener('click', calculate);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') calculate();
  });

  // Initial method
  switchMethod('iec');
  calculate();
}

// ============ Switch method ============
function switchMethod(id) {
  currentMethod = getMethod(id);
  els.methodLabel.textContent = currentMethod.label;

  // Materials
  fillSelect(els.material, currentMethod.materials);

  // Insulations
  fillSelect(els.insulation, currentMethod.insulations);

  // Cable types
  fillSelect(els.cableType, currentMethod.cableTypes);

  // Install methods
  fillSelect(els.method, currentMethod.installMethods);
  if (currentMethod.defaultMethod) els.method.value = currentMethod.defaultMethod;

  // Bundling
  if (currentMethod.hasBundling) {
    els.bundlingField.style.display = '';
    fillSelect(els.bundling, currentMethod.bundlingOptions);
  } else {
    els.bundlingField.style.display = 'none';
  }
}

function fillSelect(el, map) {
  const prev = el.value;
  el.innerHTML = Object.entries(map).map(([k, v]) =>
    `<option value="${k}">${v}</option>`
  ).join('');
  // Restore previous value if still valid
  if ([...el.options].some(o => o.value === prev)) el.value = prev;
}

// ============ Compute sizing current ============
function getVoltageInfo() {
  const idx = Number(els.voltageLevel.value) || 0;
  const vl = GLOBAL.voltageLevels[idx] || GLOBAL.voltageLevels[0];
  return vl;
}

function getSizingCurrent() {
  if (mode === 'current') {
    return Number(els.current.value) || 0;
  }
  const P = Number(els.power.value) || 0;
  const vl = getVoltageInfo();
  const cos = Number(els.cosphi.value) || 0.92;
  if (P <= 0) return 0;
  const k = vl.phases === 3 ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * vl.vLL * cos);
}

// ============ Main calculation ============
function calculate() {
  if (!currentMethod) return;

  const I = getSizingCurrent();
  if (I <= 0) {
    els.resultArea.innerHTML = '<div class="result-empty">Ток должен быть больше 0</div>';
    return;
  }

  const material   = els.material.value;
  const insulation = els.insulation.value;
  const method     = els.method.value;
  const cableType  = els.cableType.value;
  const ambient    = Number(els.ambient.value) || 30;
  const grouping   = Number(els.grouping.value) || 1;
  const bundling   = currentMethod.hasBundling ? els.bundling.value : 'touching';
  const maxSize    = Number(els.maxSize.value) || 240;
  const parallel   = Number(els.parallel.value) || 1;
  const lengthM    = Number(els.length.value) || 0;
  const maxVdropPct = Number(els.maxVdrop.value) || 5;
  const vl         = getVoltageInfo();
  const cosPhi     = Number(els.cosphi.value) || 0.92;

  // 1. Подбор по токовой нагрузке
  const resByAmp = currentMethod.selectCable(I, {
    material, insulation, method, cableType,
    ambient, grouping, bundling, maxSize, parallel,
  });

  // 2. Расчёт Vdrop для подобранного сечения
  const vdropAmp = calcVoltageDrop(I, resByAmp.s, material, lengthM, vl.vLL, vl.phases, cosPhi, resByAmp.parallel);

  // 3. Подбор по Vdrop (если есть длина)
  let sizeByVdrop = null;
  let resByVdrop = null;
  let vdropFinal = vdropAmp;

  if (lengthM > 0 && vdropAmp.dUpct > maxVdropPct) {
    const sizes = currentMethod.availableSizes(material, insulation, method).filter(s => s <= maxSize);
    sizeByVdrop = findMinSizeForVdrop(I, material, lengthM, vl.vLL, vl.phases, cosPhi, resByAmp.parallel, maxVdropPct, sizes);

    if (sizeByVdrop && sizeByVdrop > resByAmp.s) {
      // Пересчитываем с увеличенным сечением — нужно подтвердить что метод тоже выдаёт ≥
      resByVdrop = { s: sizeByVdrop };
      vdropFinal = calcVoltageDrop(I, sizeByVdrop, material, lengthM, vl.vLL, vl.phases, cosPhi, resByAmp.parallel);
    }
  }

  const finalSize = (resByVdrop && resByVdrop.s > resByAmp.s) ? resByVdrop.s : resByAmp.s;
  const increased = finalSize > resByAmp.s;

  // Финальный Vdrop
  if (increased) {
    vdropFinal = calcVoltageDrop(I, finalSize, material, lengthM, vl.vLL, vl.phases, cosPhi, resByAmp.parallel);
  }

  const In = currentMethod.selectBreaker(I / resByAmp.parallel);

  renderResult(I, resByAmp, finalSize, increased, In, vdropAmp, vdropFinal, maxVdropPct, {
    material, insulation, method, cableType, ambient, grouping, bundling, lengthM, vl, cosPhi,
  });
}

// ============ Render results ============
function renderResult(I, res, finalSize, increased, In, vdropAmp, vdropFinal, maxVdropPct, params) {
  const matLabel = currentMethod.materials[params.material] || params.material;
  const insLabel = currentMethod.insulations[params.insulation] || params.insulation;
  const methLabel = currentMethod.installMethods[params.method] || params.method;
  const typeLabel = currentMethod.cableTypes[params.cableType] || params.cableType;
  const kTotal = res.kT * res.kG;
  const vdropOk = vdropFinal.dUpct <= maxVdropPct;

  const overflowHtml = res.overflow
    ? `<div class="result-detail tag-overflow">Не удалось подобрать кабель, взято макс. сечение!</div>`
    : '';

  const autoParHtml = res.autoParallel
    ? `<div class="result-detail tag-warn">Авто-увеличение до ${res.parallel} параллельных линий</div>`
    : '';

  // Рекомендация по Vdrop
  let recommendHtml = '';
  if (increased) {
    recommendHtml = `
      <div class="result-card recommend">
        <h3>Рекомендация</h3>
        <div class="result-detail">
          По токовой нагрузке достаточно <strong>${res.s} мм&sup2;</strong>, но при длине ${params.lengthM} м
          падение напряжения составит <strong>${vdropAmp.dUpct.toFixed(2)}%</strong> (больше ${maxVdropPct}%).<br><br>
          Рекомендуется увеличить сечение до <strong>${finalSize} мм&sup2;</strong> — при этом
          &Delta;U = <strong>${vdropFinal.dUpct.toFixed(2)}%</strong>.
        </div>
      </div>
    `;
  }

  const html = `
    <div class="result-grid">
      <div class="result-card highlight">
        <h3>Сечение кабеля ${increased ? '(итоговое)' : ''}</h3>
        <div class="result-value">${finalSize}<span class="unit">мм&sup2;</span></div>
        <div class="result-detail">
          ${matLabel}, ${insLabel}, ${typeLabel}<br>
          ${res.parallel > 1 ? res.parallel + ' параллельных линий' : '1 линия'}
          ${increased ? '<br><span class="tag-warn">Увеличено по Vdrop</span>' : ''}
        </div>
        ${overflowHtml}
        ${autoParHtml}
      </div>

      <div class="result-card">
        <h3>Автомат защиты</h3>
        <div class="result-value">${In}<span class="unit">А</span></div>
        <div class="result-detail">
          Ближайший &ge; I<sub>расч</sub>/n
        </div>
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
          ${params.vl.label}, cos&phi; = ${params.cosPhi}<br>
          <span class="${vdropOk ? 'tag-ok' : 'tag-overflow'}">${vdropOk ? 'В норме (\u2264' + maxVdropPct + '%)' : 'Превышение!'}</span>
        </div>
      </div>
    </div>

    ${recommendHtml}

    <h3 style="margin:20px 0 12px;font-size:14px;font-weight:600;color:#1f2430">Детали расчёта (${currentMethod.label})</h3>
    <table class="detail-table">
      <tr><th colspan="2">Параметры</th></tr>
      <tr><td>Расчётный ток (I<sub>расч</sub>)</td><td>${I.toFixed(2)} А</td></tr>
      <tr><td>Ток на линию (I / n)</td><td>${(I / res.parallel).toFixed(2)} А</td></tr>
      <tr><td>Номинал автомата (I<sub>n</sub>)</td><td>${In} А</td></tr>
      <tr><td>Способ прокладки</td><td>${methLabel}</td></tr>
      <tr><td>Температура среды</td><td>${params.ambient} &deg;C</td></tr>
      <tr><td>Кабелей в группе</td><td>${params.grouping}</td></tr>
      ${currentMethod.hasBundling ? `<tr><td>Укладка</td><td>${params.bundling}</td></tr>` : ''}
      <tr><th colspan="2">Коэффициенты снижения</th></tr>
      <tr><td>K<sub>t</sub> (температура)</td><td>${res.kT.toFixed(3)}</td></tr>
      <tr><td>K<sub>g</sub> (группирование)</td><td>${res.kG.toFixed(3)}</td></tr>
      <tr><td>K<sub>total</sub> = K<sub>t</sub> &times; K<sub>g</sub></td><td><strong>${kTotal.toFixed(3)}</strong></td></tr>
      <tr><th colspan="2">Подбор сечения</th></tr>
      <tr><td>По токовой нагрузке</td><td>${res.s} мм&sup2;</td></tr>
      ${increased ? `<tr><td>По падению напряжения</td><td>${finalSize} мм&sup2;</td></tr>` : ''}
      <tr><td>Итоговое сечение</td><td><strong>${finalSize} мм&sup2;</strong>${increased ? ' (увеличено по &Delta;U)' : ''}</td></tr>
      ${params.lengthM > 0 ? `
      <tr><th colspan="2">Падение напряжения</th></tr>
      <tr><td>&Delta;U при ${res.s} мм&sup2;</td><td>${vdropAmp.dUpct.toFixed(2)}% (${vdropAmp.dU.toFixed(2)} В)</td></tr>
      ${increased ? `<tr><td>&Delta;U при ${finalSize} мм&sup2;</td><td>${vdropFinal.dUpct.toFixed(2)}% (${vdropFinal.dU.toFixed(2)} В)</td></tr>` : ''}
      <tr><td>Допустимо</td><td>&le; ${maxVdropPct}% — <span class="${vdropOk ? 'tag-ok' : 'tag-overflow'}">${vdropOk ? 'OK' : 'НЕТ'}</span></td></tr>
      ` : ''}
    </table>
  `;

  els.resultArea.innerHTML = html;
}

// ============ Events ============
init();
