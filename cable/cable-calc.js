import {
  GLOBAL, IEC_TABLES, BREAKER_SERIES, K_TEMP, K_GROUP_TABLES,
  INSTALL_METHODS, CABLE_TYPES, BREAKER_TYPES
} from '../js/engine/constants.js';

import {
  selectCableSize, selectBreaker, cableTable,
  kTempLookup, kGroupLookup, kBundlingFactor, kBundlingIgnoresGrouping
} from '../js/engine/cable.js';

// ============ DOM refs ============
const $ = id => document.getElementById(id);

const els = {
  inputMode:    $('input-mode'),
  fieldsCurrent: $('fields-current'),
  fieldsPower:   $('fields-power'),
  current:      $('in-current'),
  power:        $('in-power'),
  voltage:      $('in-voltage'),
  cosphi:       $('in-cosphi'),
  material:     $('in-material'),
  insulation:   $('in-insulation'),
  cableType:    $('in-cableType'),
  maxSize:      $('in-maxSize'),
  method:       $('in-method'),
  ambient:      $('in-ambient'),
  grouping:     $('in-grouping'),
  bundling:     $('in-bundling'),
  breaker:      $('in-breaker'),
  parallel:     $('in-parallel'),
  length:       $('in-length'),
  vdropVoltage: $('in-vdrop-voltage'),
  vdropPhases:  $('in-vdrop-phases'),
  vdropCosphi:  $('in-vdrop-cosphi'),
  btnCalc:      $('btn-calc'),
  resultArea:   $('result-area'),
};

// ============ Input mode toggle ============
let mode = 'current';
els.inputMode.addEventListener('click', e => {
  const lbl = e.target.closest('label');
  if (!lbl) return;
  mode = lbl.dataset.mode;
  els.inputMode.querySelectorAll('label').forEach(l => l.classList.toggle('active', l === lbl));
  els.fieldsCurrent.style.display = mode === 'current' ? '' : 'none';
  els.fieldsPower.style.display   = mode === 'power'   ? '' : 'none';
});

// ============ Compute sizing current ============
function getSizingCurrent() {
  if (mode === 'current') {
    return Number(els.current.value) || 0;
  }
  const P = Number(els.power.value) || 0;
  const [vStr, phStr] = els.voltage.value.split('_');
  const V = Number(vStr);
  const phases = Number(phStr);
  const cos = Number(els.cosphi.value) || 0.92;
  if (P <= 0 || V <= 0) return 0;
  const k = phases === 3 ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * V * cos);
}

// ============ Voltage drop calculation ============
// IEC 60364-5-52: dU = (b * rho * L * I * cos) / (n * S)
// rho Cu = 0.0175 Ohm*mm2/m, Al = 0.028
// b = 2 for 1ph, sqrt(3) for 3ph
function calcVoltageDrop(I, S, material, lengthM, voltage, phases, cosPhi, parallel) {
  if (S <= 0 || lengthM <= 0 || voltage <= 0) return { dU: 0, dUpct: 0 };
  const rho = material === 'Al' ? 0.028 : 0.0175;
  const b = phases === 3 ? Math.sqrt(3) : 2;
  const cos = cosPhi || 0.92;
  const n = Math.max(1, parallel);
  const dU = (b * rho * lengthM * I * cos) / (n * S);
  return { dU, dUpct: (dU / voltage) * 100 };
}

// ============ Main calculation ============
function calculate() {
  const I = getSizingCurrent();
  if (I <= 0) {
    els.resultArea.innerHTML = '<div class="result-empty">Ток должен быть больше 0</div>';
    return;
  }

  const material   = els.material.value;
  const insulation = els.insulation.value;
  const method     = els.method.value;
  const ambient    = Number(els.ambient.value) || 30;
  const grouping   = Number(els.grouping.value) || 1;
  const bundling   = els.bundling.value;
  const cableType  = els.cableType.value;
  const maxSize    = Number(els.maxSize.value) || 240;
  const breakerCurve = els.breaker.value;
  const parallel   = Number(els.parallel.value) || 1;
  const lengthM    = Number(els.length.value) || 0;
  const vdropV     = Number(els.vdropVoltage.value) || 400;
  const vdropPh    = Number(els.vdropPhases.value) || 3;
  const vdropCos   = Number(els.vdropCosphi.value) || 0.92;

  const result = selectCableSize(I, {
    material, insulation, method,
    ambientC: ambient, grouping, bundling,
    cableType, maxSize,
    conductorsInParallel: parallel,
    breakerCurve,
    allowAutoParallel: true,
  });

  const In = selectBreaker(I / result.parallel);
  const brkType = BREAKER_TYPES[breakerCurve] || BREAKER_TYPES.MCB_C;
  const kTotal = result.kT * result.kG;

  // Voltage drop
  const vdrop = calcVoltageDrop(I, result.s, material, lengthM, vdropV, vdropPh, vdropCos, result.parallel);
  const vdropOk = vdrop.dUpct <= 5;

  renderResult(I, result, In, brkType, kTotal, vdrop, vdropOk, {
    material, insulation, method, ambient, grouping, bundling, cableType, breakerCurve, lengthM, vdropV
  });
}

// ============ Render results ============
function renderResult(I, res, In, brkType, kTotal, vdrop, vdropOk, params) {
  const matLabel = params.material === 'Cu' ? 'Медь' : 'Алюминий';
  const insLabel = params.insulation === 'PVC' ? 'ПВХ' : 'СПЭ (XLPE)';
  const methLabel = (INSTALL_METHODS[params.method] || {}).label || params.method;
  const typeLabel = (CABLE_TYPES[params.cableType] || {}).label || params.cableType;
  const brkLabel = brkType.label || params.breakerCurve;
  const prefix = brkType.prefix || '';

  const overflowHtml = res.overflow
    ? `<div class="result-detail tag-overflow">Внимание: не удалось подобрать кабель, взято максимальное сечение!</div>`
    : '';

  const autoParHtml = res.autoParallel
    ? `<div class="result-detail tag-warn">Авто-увеличение до ${res.parallel} параллельных линий</div>`
    : '';

  const html = `
    <div class="result-grid">
      <div class="result-card highlight">
        <h3>Сечение кабеля</h3>
        <div class="result-value">${res.s}<span class="unit">мм&sup2;</span></div>
        <div class="result-detail">
          ${matLabel}, ${insLabel}, ${typeLabel}<br>
          ${res.parallel > 1 ? res.parallel + ' параллельных линий' : '1 линия'}
        </div>
        ${overflowHtml}
        ${autoParHtml}
      </div>

      <div class="result-card">
        <h3>Автомат защиты</h3>
        <div class="result-value">${prefix}${In}<span class="unit">А</span></div>
        <div class="result-detail">
          ${brkLabel}<br>
          I<sub>2</sub> / I<sub>n</sub> = ${brkType.I2ratio}
        </div>
      </div>

      <div class="result-card">
        <h3>Допустимый ток кабеля</h3>
        <div class="result-value">${res.iDerated.toFixed(1)}<span class="unit">А/линию</span></div>
        <div class="result-detail">
          Табличный: <strong>${res.iAllowed} А</strong><br>
          После снижения: <strong>${res.iDerated.toFixed(1)} А</strong><br>
          ${res.parallel > 1 ? 'Суммарно: <strong>' + res.totalCapacity.toFixed(1) + ' А</strong>' : ''}
        </div>
      </div>

      <div class="result-card ${!vdropOk ? 'warn' : ''}">
        <h3>Падение напряжения</h3>
        <div class="result-value ${!vdropOk ? 'tag-warn' : ''}">${vdrop.dUpct.toFixed(2)}<span class="unit">%</span></div>
        <div class="result-detail">
          &Delta;U = ${vdrop.dU.toFixed(2)} В при ${params.lengthM} м<br>
          <span class="${vdropOk ? 'tag-ok' : 'tag-overflow'}">${vdropOk ? 'В норме (\u22645%)' : 'Превышение допустимого!'}</span>
        </div>
      </div>
    </div>

    <h3 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#1f2430">Детали расчёта</h3>
    <table class="detail-table">
      <tr><th colspan="2">Параметры расчёта</th></tr>
      <tr><td>Расчётный ток (I<sub>расч</sub>)</td><td>${I.toFixed(2)} А</td></tr>
      <tr><td>Ток на линию (I / n)</td><td>${(I / res.parallel).toFixed(2)} А</td></tr>
      <tr><td>Номинал автомата (I<sub>n</sub>)</td><td>${In} А</td></tr>
      <tr><td>Способ прокладки</td><td>${methLabel}</td></tr>
      <tr><td>Температура среды</td><td>${params.ambient} &deg;C</td></tr>
      <tr><td>Кабелей в группе</td><td>${params.grouping}</td></tr>
      <tr><td>Укладка</td><td>${params.bundling}</td></tr>
      <tr><th colspan="2">Коэффициенты снижения</th></tr>
      <tr><td>K<sub>t</sub> (температура)</td><td>${res.kT.toFixed(3)}</td></tr>
      <tr><td>K<sub>g</sub> (группирование + укладка)</td><td>${res.kG.toFixed(3)}</td></tr>
      <tr><td>K<sub>total</sub> = K<sub>t</sub> &times; K<sub>g</sub></td><td><strong>${kTotal.toFixed(3)}</strong></td></tr>
      <tr><th colspan="2">Проверка по IEC 60364-4-43</th></tr>
      <tr><td>I<sub>расч</sub> &le; I<sub>n</sub> &le; I<sub>z</sub></td>
        <td>${(I / res.parallel).toFixed(1)} &le; ${In} &le; ${res.iDerated.toFixed(1)}
          — <span class="${In <= res.iDerated ? 'tag-ok' : 'tag-overflow'}">${In <= res.iDerated ? 'OK' : 'НЕТ'}</span>
        </td>
      </tr>
      <tr><td>I<sub>2</sub> = ${brkType.I2ratio} &times; ${In} = ${(brkType.I2ratio * In).toFixed(1)} А &le; 1.45 &times; ${res.iDerated.toFixed(1)} = ${(1.45 * res.iDerated).toFixed(1)} А</td>
        <td><span class="${brkType.I2ratio * In <= 1.45 * res.iDerated ? 'tag-ok' : 'tag-overflow'}">${brkType.I2ratio * In <= 1.45 * res.iDerated ? 'OK' : 'НЕТ'}</span></td>
      </tr>
    </table>
  `;

  els.resultArea.innerHTML = html;
}

// ============ Events ============
els.btnCalc.addEventListener('click', calculate);

// Enter key triggers calculation
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') calculate();
});

// Auto-sync voltage drop fields from power fields
els.voltage.addEventListener('change', () => {
  const [v, ph] = els.voltage.value.split('_');
  els.vdropVoltage.value = v;
  els.vdropPhases.value = ph;
});
els.cosphi.addEventListener('change', () => {
  els.vdropCosphi.value = els.cosphi.value;
});

// Run initial calculation
calculate();
