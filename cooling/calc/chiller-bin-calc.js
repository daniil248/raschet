// =============================================================================
// cooling/calc/chiller-bin-calc.js — per-bin расчёт чиллера/DX
// =============================================================================
// Pure-функции расчёта capacity / COP_mech / FC fraction / power / energy
// для одного бина Ambient T при заданной chillerSpec.
//
// Эта же логика раньше жила в meteo/annual-table.js → applyChillerCalc.
// Перенесена в Cooling Systems как часть архитектурной отделки модулей:
//   meteo  = только климатические данные
//   cooling = подбор оборудования + расчёты CAPEX/TCO
//
// Зависимости: только chiller-defaults (для типов).
// NO DOM. Pure JS.

import { wetBulbStull } from './psychro-formulas.js';

/**
 * Применить расчёт chiller/DX к строке-бину.
 *
 * @param {object} row   — { tBin, hours, rhAvg, twbAvg, ... }
 * @param {object} spec  — chiller specification (см. chiller-defaults.js)
 * @returns {object} расширенный row с полями capacity, copMech, fcFraction,
 *                   cop, power, energy.
 *
 * === Алгоритм ===
 *
 * 1. capacity(T_amb) — холодопроизводительность с T-correction:
 *    capacity = ratedCap × (1 + capCorrPctPerC/100 × (T_amb − T_rated))
 *
 * 2. COP_mech(T_amb) — COP компрессорного охлаждения:
 *    'iplv':  COP = ratedCOP × (1 + 0.02 × (T_rated − T_amb))
 *             clamp [0.6×ratedCOP, 1.8×ratedCOP]
 *    'fixed': COP = ratedCOP
 *
 * 3. FC fraction (0..1):
 *    chiller с freeCoolingMode='dry':
 *      T_ref = T_amb_db. fc = clamp((CHWS − T_ref) / approach, 0, 1).
 *    chiller с freeCoolingMode='wet':
 *      T_ref = T_wb (Stull 2011). Аналогично.
 *    dx-pumped-fc:
 *      Бинарно: fc=1 если T_db ≤ threshold, иначе 0.
 *    Иначе (dx-air, chiller mode='none'): fc = 0.
 *
 * 4. Power components:
 *    P_mech = (1 − fc) × capacity / COP_mech
 *    P_aux  = aux% × ratedCap / 100  (если fc > 0; иначе 0)
 *    P_total = P_mech + P_aux
 *
 * 5. COP_eff = capacity / P_total
 *    energy = P_total × hours_in_bin
 */
export function applyChillerCalc(row, spec) {
  if (!spec || !Number.isFinite(Number(spec.ratedCapKw)) || Number(spec.ratedCapKw) <= 0) return row;

  const T = row.tBin;
  const ratedCap = Number(spec.ratedCapKw) || 0;
  const tRated = Number(spec.ambientRated) || 35;
  const dT = T - tRated;
  const capCorr = (Number(spec.capCorrPctPerC) || 0) / 100;
  const capacity = Math.max(0, ratedCap * (1 + capCorr * dT));
  const ratedCOP = Number(spec.ratedCOP) || 3.5;

  // --- COP_mech ---
  let copMech;
  if (spec.partLoadCurve === 'fixed') {
    copMech = ratedCOP;
  } else {
    const copFactor = 1 + 0.02 * (-dT);
    copMech = ratedCOP * Math.max(0.6, Math.min(1.8, copFactor));
  }

  // --- Free-cooling fraction ---
  const sysType = spec.systemType || 'chiller';
  const fcMode = spec.freeCoolingMode || 'none';
  let fcFraction = 0;
  let auxKw = 0;

  if (sysType === 'chiller' && fcMode !== 'none') {
    const chws = Number(spec.chwsTemp) || 12;
    const approach = Number(spec.freeCoolingApproach) || 5;
    let tRef = T;
    if (fcMode === 'wet' && Number.isFinite(row.twbAvg)) tRef = row.twbAvg;
    const thrFull = chws - approach;
    const thrNo   = chws;
    if (tRef <= thrFull)      fcFraction = 1.0;
    else if (tRef >= thrNo)   fcFraction = 0.0;
    else                      fcFraction = (thrNo - tRef) / (thrNo - thrFull);
    if (fcFraction > 0) {
      auxKw = ratedCap * (Number(spec.freeCoolingAuxPctOfRated) || 5) / 100;
    }
  } else if (sysType === 'dx-pumped-fc') {
    const thr = Number(spec.dxPumpedThresholdDb) ?? 13;
    fcFraction = (T <= thr) ? 1.0 : 0.0;
    if (fcFraction > 0) {
      auxKw = ratedCap * (Number(spec.dxPumpedAuxPctOfRated) || 3) / 100;
    }
  }

  // --- Power & energy ---
  const pMech = capacity > 0 && copMech > 0 ? (1 - fcFraction) * capacity / copMech : 0;
  const pTotal = pMech + auxKw;
  const cop = pTotal > 0 ? capacity / pTotal : 0;
  const energy = pTotal * row.hours;

  return { ...row, capacity, copMech, fcFraction, cop, power: pTotal, energy };
}

/**
 * Построить bin-данные из почасового hourly-массива и опционально
 * применить chillerSpec к каждой строке.
 *
 * @param {Array<{t, T, RH, wind}>} hourly — почасовые наблюдения
 * @param {object|null} chillerSpec
 * @returns {Array<object>} массив bin-строк, отсортированный по tBin
 */
export function buildBinData(hourly, chillerSpec = null) {
  if (!hourly || !hourly.length) return [];
  const totalRecords = hourly.filter(h => Number.isFinite(Number(h.T))).length;
  const yearScale = totalRecords > 0 ? (8766 / totalRecords) : 1;  // 8766 = 365.25 × 24
  const map = new Map();

  for (const h of hourly) {
    const T = Number(h.T);
    if (!Number.isFinite(T)) continue;
    const tBin = Math.floor(T);
    let acc = map.get(tBin);
    if (!acc) {
      acc = { tBin, count: 0, rhSum: 0, rhN: 0, rhMin: Infinity, rhMax: -Infinity, windSum: 0, windN: 0, twbSum: 0, twbN: 0 };
      map.set(tBin, acc);
    }
    acc.count++;
    const RH = Number(h.RH);
    if (Number.isFinite(RH)) {
      acc.rhSum += RH; acc.rhN++;
      if (RH < acc.rhMin) acc.rhMin = RH;
      if (RH > acc.rhMax) acc.rhMax = RH;
      const tw = wetBulbStull(T, RH);
      if (Number.isFinite(tw)) { acc.twbSum += tw; acc.twbN++; }
    }
    const W = Number(h.wind);
    if (Number.isFinite(W)) { acc.windSum += W; acc.windN++; }
  }

  const rows = [...map.values()].sort((a, b) => a.tBin - b.tBin);
  let cum = 0;
  return rows.map(acc => {
    const hours = acc.count * yearScale;
    const days = hours / 24;
    const pct = (hours / 8766) * 100;
    cum += pct;
    const row = {
      tBin: acc.tBin,
      hours, days, pct, cumPct: cum,
      rhAvg: acc.rhN > 0 ? acc.rhSum / acc.rhN : null,
      rhMin: acc.rhN > 0 ? acc.rhMin : null,
      rhMax: acc.rhN > 0 ? acc.rhMax : null,
      twbAvg: acc.twbN > 0 ? acc.twbSum / acc.twbN : null,
      windAvg: acc.windN > 0 ? acc.windSum / acc.windN : null,
    };
    return chillerSpec ? applyChillerCalc(row, chillerSpec) : row;
  });
}
