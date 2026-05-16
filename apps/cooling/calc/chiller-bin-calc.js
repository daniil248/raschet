// =============================================================================
// cooling/calc/chiller-bin-calc.js — per-bin расчёт чиллера/DX
// =============================================================================
// Pure-функции расчёта capacity / COP_mech / FC fraction / power / energy
// для одного интервала температуры наружного воздуха при заданной chillerSpec.
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
 * v0.60.4 (Phase 22.5): Линейная интерполяция performance-curve производителя.
 *
 * @param {Array<{T, capacity, cop}>|null} curve  — отсортированный по T массив точек
 * @param {number} T                              — целевая T_amb (°C)
 * @returns {{capacity, cop}|null} — либо null если curve пуст / некорректен
 */
export function lerpPerformanceCurve(curve, T) {
  if (!Array.isArray(curve) || curve.length < 2) return null;
  // Гарантируем сортировку по T
  const c = [...curve].sort((a, b) => a.T - b.T);
  if (T <= c[0].T) return { capacity: c[0].capacity, cop: c[0].cop };
  if (T >= c[c.length - 1].T) return { capacity: c[c.length - 1].capacity, cop: c[c.length - 1].cop };
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1];
    if (T >= a.T && T <= b.T) {
      const k = (T - a.T) / (b.T - a.T);
      return {
        capacity: a.capacity + (b.capacity - a.capacity) * k,
        cop:      a.cop      + (b.cop      - a.cop)      * k,
      };
    }
  }
  return null;
}

/**
 * Парсер CSV performance-curve. Поддерживает заголовки T,capacity,cop
 * (или COP) и разделители , ; tab. Возвращает массив {T, capacity, cop}
 * или null при ошибке.
 *
 * @param {string} csv
 * @returns {{points: Array, error: string|null}}
 */
export function parsePerformanceCurveCsv(csv) {
  if (!csv || typeof csv !== 'string') return { points: [], error: 'Пустой CSV' };
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { points: [], error: 'CSV нужно минимум 2 строки (header + data)' };
  // Detect separator
  const headerLine = lines[0];
  const sep = headerLine.includes(';') ? ';' : (headerLine.includes('\t') ? '\t' : ',');
  const cols = headerLine.split(sep).map(c => c.trim().toLowerCase());
  const idxT = cols.findIndex(c => /^t(_amb|amb|emp)?$/i.test(c) || c === 't');
  const idxCap = cols.findIndex(c => /^(capacity|cap|q|q_cool)$/i.test(c));
  const idxCop = cols.findIndex(c => /^(cop|cop_mech|eff)$/i.test(c));
  const idxPow = cols.findIndex(c => /^(power|p|p_input)$/i.test(c));
  if (idxT < 0) return { points: [], error: 'Нет столбца T (T/Tamb/temp)' };
  if (idxCap < 0) return { points: [], error: 'Нет столбца capacity (capacity/cap/Q)' };
  if (idxCop < 0 && idxPow < 0) return { points: [], error: 'Нужен либо столбец COP, либо power (для расчёта COP=cap/power)' };
  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.trim());
    const T = parseFloat(parts[idxT]?.replace(',', '.'));
    const cap = parseFloat(parts[idxCap]?.replace(',', '.'));
    let cop;
    if (idxCop >= 0) cop = parseFloat(parts[idxCop]?.replace(',', '.'));
    else {
      const power = parseFloat(parts[idxPow]?.replace(',', '.'));
      if (cap > 0 && power > 0) cop = cap / power;
    }
    if (Number.isFinite(T) && Number.isFinite(cap) && Number.isFinite(cop) && cap > 0 && cop > 0) {
      points.push({ T, capacity: cap, cop });
    }
  }
  if (points.length < 2) return { points: [], error: 'Не получилось распарсить ≥2 валидных строк' };
  points.sort((a, b) => a.T - b.T);
  return { points, error: null };
}

/**
 * Применить расчёт chiller/DX к строке-интервалу.
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
  const ratedCOP = Number(spec.ratedCOP) || 3.5;

  // --- v0.60.4 (Phase 22.5): performance-curve от производителя ---
  // Если spec.perfCurve = [{T, capacity, cop}] — используем линейную
  // интерполяцию по T между точками вместо аналитических формул.
  // Это позволяет загрузить реальные данные из selection software
  // (Daikin EWAQ, Trane RTAF, Carrier 30XW, Vertiv Liebert и т.п.).
  let capacity, copMech;
  const curveCalc = lerpPerformanceCurve(spec.perfCurve, T);
  if (curveCalc) {
    capacity = curveCalc.capacity;
    copMech = curveCalc.cop;
  } else {
    capacity = Math.max(0, ratedCap * (1 + capCorr * dT));
    if (spec.partLoadCurve === 'fixed') {
      copMech = ratedCOP;
    } else {
      const copFactor = 1 + 0.02 * (-dT);
      copMech = ratedCOP * Math.max(0.6, Math.min(1.8, copFactor));
    }
  }

  // --- Free-cooling fraction ---
  // v0.59.996: расширено для CRAC-типов:
  //   chiller         — FC на стороне чиллера (dry/wet), как раньше
  //   dx-pumped-fc    — бинарный pumped refrigerant FC
  //   crac-water       — CRAC без компрессора. Энергия = только fan power
  //                      + wet-side насосы. Нагрузка на чиллер передаётся
  //                      в topology.js (этот calc даёт только фан/aux).
  //   crac-water+comp  — гибрид: при T_amb выше threshold работает компрессор
  //                      (как DX), ниже — переключается на glycol-loop FC.
  //   crac-water+fc    — двухконтурный (Stulz). FC по T_amb (как dry chiller),
  //                      mech по water-loop от чиллера (нагрузка на upstream).
  const sysType = spec.systemType || 'chiller';
  const fcMode = spec.freeCoolingMode || 'none';
  let fcFraction = 0;
  let auxKw = 0;

  // Универсальный helper: linear partial FC по T_ref vs CHWS.
  function linearFc(tRef, chws, approach) {
    const thrFull = chws - approach, thrNo = chws;
    if (tRef <= thrFull)    return 1.0;
    if (tRef >= thrNo)      return 0.0;
    return (thrNo - tRef) / (thrNo - thrFull);
  }

  if (sysType === 'chiller' && fcMode !== 'none') {
    const chws = Number(spec.chwsTemp) || 12;
    const approach = Number(spec.freeCoolingApproach) || 5;
    let tRef = T;
    if (fcMode === 'wet' && Number.isFinite(row.twbAvg)) tRef = row.twbAvg;
    fcFraction = linearFc(tRef, chws, approach);
    if (fcFraction > 0) {
      auxKw = ratedCap * (Number(spec.freeCoolingAuxPctOfRated) || 5) / 100;
    }
  } else if (sysType === 'dx-pumped-fc') {
    const thr = Number(spec.dxPumpedThresholdDb) ?? 13;
    fcFraction = (T <= thr) ? 1.0 : 0.0;
    if (fcFraction > 0) {
      auxKw = ratedCap * (Number(spec.dxPumpedAuxPctOfRated) || 3) / 100;
    }
  } else if (sysType === 'crac-water') {
    // CRAC без компрессора — все охлаждение через chiller (upstream).
    // На стороне CRAC только fan power (~3-5% от ratedCap для EC-fan).
    // Нагрузка на чиллер обрабатывается в topology.js.
    fcFraction = 0;
    auxKw = ratedCap * (Number(spec.cracFanPctOfRated) || 4) / 100;
    // Compressor power = 0 для CRAC без компрессора → P_mech ниже примем 0.
    // Помечаем флагом: cooling-load для upstream чиллера = capacity (без COP_mech).
  } else if (sysType === 'crac-water+compressor') {
    // Гибрид DX + glycol-loop. При T_amb ≤ threshold (Stulz default ~13°C):
    // переключается на glycol-loop (требует chiller в топологии). Иначе — DX.
    const thr = Number(spec.cracHybridThresholdDb) ?? 13;
    fcFraction = (T <= thr) ? 1.0 : 0.0;
    if (fcFraction > 0) {
      auxKw = ratedCap * (Number(spec.cracFanPctOfRated) || 4) / 100;   // только fan + glycol pump
    }
  } else if (sysType === 'crac-water+fc-loop') {
    // Двухконтурный (Stulz CyberHandler): отдельный FC контур (dry cooler) +
    // отдельный chilled water loop от чиллера. FC включается при T_amb ≤
    // chws−approach, аналогично chiller-dry, но локально на CRAC.
    const chws = Number(spec.chwsTemp) || 12;
    const approach = Number(spec.freeCoolingApproach) || 5;
    fcFraction = linearFc(T, chws, approach);
    auxKw = ratedCap * (Number(spec.cracFanPctOfRated) || 4) / 100;     // fan всегда работает
    if (fcFraction > 0) {
      auxKw += ratedCap * (Number(spec.freeCoolingAuxPctOfRated) || 3) / 100;  // + dry cooler fan
    }
  }

  // --- Power & energy ---
  // v0.59.996: для CRAC без собственного компрессора (crac-water) механическая
  // мощность = 0 на стороне CRAC; нагрузка передаётся в topology.js → чиллер.
  // Поле cracCoolingLoadKw отдаёт эту нагрузку для дальнейшего распределения.
  let pMech;
  let cracCoolingLoadKw = null;
  if (sysType === 'crac-water') {
    pMech = 0;
    cracCoolingLoadKw = capacity;   // вся capacity → upstream чиллер
  } else if (sysType === 'crac-water+fc-loop') {
    pMech = 0;
    cracCoolingLoadKw = (1 - fcFraction) * capacity;   // только мех-часть → чиллер
  } else if (sysType === 'crac-water+compressor') {
    // В FC-режиме нагрузка идёт на glycol-loop → upstream сухой кулер
    // (но в топологии chiller тоже может быть). В DX-режиме — на собственный компрессор.
    if (fcFraction > 0) { pMech = 0; cracCoolingLoadKw = capacity; }
    else                { pMech = capacity / Math.max(0.01, copMech); cracCoolingLoadKw = 0; }
  } else {
    pMech = capacity > 0 && copMech > 0 ? (1 - fcFraction) * capacity / copMech : 0;
  }
  const pTotal = pMech + auxKw;
  const cop = pTotal > 0 ? capacity / pTotal : 0;
  const energy = pTotal * row.hours;

  return { ...row, capacity, copMech, fcFraction, cop, power: pTotal, energy, cracCoolingLoadKw };
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
