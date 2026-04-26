// ======================================================================
// battery-discharge.js
// Расчёт разряда АКБ. Работает в двух режимах:
//
//   1. «По таблице» — если у выбранной модели батареи есть таблица
//      постоянной мощности разряда (Constant Power Discharge Table),
//      берём значения прямо из неё с линейной интерполяцией по времени
//      для выбранного конечного напряжения на элемент.
//
//   2. «Среднее» (fallback) — если таблицы нет, используем простую
//      энергобалансовую модель: E = V × C × eff_k, t = E / P.
//      Коэффициент eff_k учитывает эффект Пойкерта (эффективность
//      разряда падает с током) — для свинца ≈ 0.6…0.85, для Li-Ion
//      ≈ 0.90…0.95. Коэффициент выбирается по chemistry и времени.
//
// Оба результата возвращают {
//   feasible, autonomyMin, requiredBlocks, blockPower, method, warnings
// }
// ======================================================================

// --------- «Средние» коэффициенты эффективности (fallback) ----------
// Зависимость от времени разряда: чем дольше разряд, тем выше доступная
// ёмкость (эффект Пойкерта). Табличка — грубая, но лучше чем 100%.
function avgEfficiency(chemistry, tMin) {
  if (chemistry === 'li-ion') {
    if (tMin < 5) return 0.88;
    if (tMin < 15) return 0.92;
    if (tMin < 60) return 0.95;
    return 0.96;
  }
  // VRLA / lead-acid
  if (tMin < 5)   return 0.45;
  if (tMin < 15)  return 0.58;
  if (tMin < 30)  return 0.68;
  if (tMin < 60)  return 0.78;
  if (tMin < 180) return 0.85;
  return 0.90;
}

// Линейная интерполяция по времени для фиксированного endV.
// table: [{endV, tMin, powerW}, ...] — уже отсортирована
// Возвращает powerW при (endV, tMin) или null если выходит за пределы.
function interpTable(table, endV, tMin) {
  // Берём только точки с ближайшим endV (точное совпадение или границы)
  const endVs = [...new Set(table.map(p => p.endV))].sort((a, b) => a - b);
  if (!endVs.length) return null;

  // Выбираем ближайший endV (без экстраполяции между endV-ами — это
  // отдельные кривые, и перекрёстная интерполяция некорректна).
  let bestEv = endVs[0];
  let bestDiff = Math.abs(endVs[0] - endV);
  for (const ev of endVs) {
    const d = Math.abs(ev - endV);
    if (d < bestDiff) { bestDiff = d; bestEv = ev; }
  }
  const curve = table.filter(p => p.endV === bestEv).sort((a, b) => a.tMin - b.tMin);
  if (!curve.length) return null;

  // Интерполяция по tMin
  if (tMin <= curve[0].tMin) return curve[0].powerW;
  if (tMin >= curve[curve.length - 1].tMin) return curve[curve.length - 1].powerW;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (tMin >= a.tMin && tMin <= b.tMin) {
      const k = (tMin - a.tMin) / (b.tMin - a.tMin);
      return a.powerW + (b.powerW - a.powerW) * k;
    }
  }
  return null;
}

// Обратная интерполяция: при заданной мощности (W/блок) — какое
// максимальное время разряда (в мин) до endV?
function interpTimeByPower(table, endV, powerW) {
  const endVs = [...new Set(table.map(p => p.endV))].sort((a, b) => a - b);
  if (!endVs.length) return null;
  let bestEv = endVs[0];
  let bestDiff = Math.abs(endVs[0] - endV);
  for (const ev of endVs) {
    const d = Math.abs(ev - endV);
    if (d < bestDiff) { bestDiff = d; bestEv = ev; }
  }
  const curve = table.filter(p => p.endV === bestEv).sort((a, b) => a.tMin - b.tMin);
  if (!curve.length) return null;
  // Кривая: с ростом tMin — powerW ПАДАЕТ. Возврат: число (в пределах таблицы)
  // или объект { tMin, extrapolated:true } за её пределами.
  if (powerW > curve[0].powerW) {
    // Запрошенная мощность выше первой точки — экстраполируем влево по
    // двум первым точкам в координатах (P, t).
    if (curve.length >= 2) {
      const a = curve[0], b = curve[1];
      if (a.powerW !== b.powerW) {
        const k = (a.powerW - powerW) / (a.powerW - b.powerW);
        const t = a.tMin + (b.tMin - a.tMin) * k;
        return { tMin: Math.max(0, t), extrapolated: true };
      }
    }
    return { tMin: 0, extrapolated: true };
  }
  if (powerW < curve[curve.length - 1].powerW) return Infinity;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (powerW <= a.powerW && powerW >= b.powerW) {
      if (a.powerW === b.powerW) return a.tMin;
      const k = (a.powerW - powerW) / (a.powerW - b.powerW);
      return a.tMin + (b.tMin - a.tMin) * k;
    }
  }
  return curve[curve.length - 1].tMin;
}

/**
 * Расчёт автономии батарейной системы при заданной нагрузке.
 *
 * @param {Object} input
 * @param {Object} input.battery         — запись из каталога (или null)
 * @param {number} input.loadKw          — нагрузка ИБП/системы, кВт
 * @param {number} input.dcVoltage       — напряжение всего блока DC, В
 * @param {number} input.strings         — число параллельных цепочек
 * @param {number} input.blocksPerString — число блоков в одной цепочке
 * @param {number} input.endV            — конечное напряжение на элемент (В/элемент), обычно 1.6…1.85
 * @param {number} input.invEff          — КПД инвертора (0.9…0.98)
 * @param {string} [input.chemistry]     — если battery=null, используется для fallback
 * @returns {{
 *   autonomyMin: number, feasible: boolean, blockPowerW: number,
 *   method: 'table'|'average', warnings: string[]
 * }}
 */
export function calcAutonomy(input) {
  const {
    battery, loadKw, strings, blocksPerString,
    endV = 1.75, invEff = 0.94,
  } = input;
  const warnings = [];
  if (!(loadKw > 0)) {
    return { autonomyMin: 0, feasible: false, blockPowerW: 0, method: 'average', warnings: ['Нагрузка должна быть > 0'] };
  }
  const totalBlocks = (Number(strings) || 1) * (Number(blocksPerString) || 1);
  if (totalBlocks <= 0) {
    return { autonomyMin: 0, feasible: false, blockPowerW: 0, method: 'average', warnings: ['Нет блоков'] };
  }
  // Мощность на каждый блок (с учётом КПД инвертора — энергия с АКБ)
  const totalPowerFromBatt = (loadKw * 1000) / Math.max(0.5, invEff);
  const blockPowerW = totalPowerFromBatt / totalBlocks;

  // === Режим по таблице ===
  if (battery && Array.isArray(battery.dischargeTable) && battery.dischargeTable.length) {
    const raw = interpTimeByPower(battery.dischargeTable, endV, blockPowerW);
    let tMin, extrapolated = false;
    if (raw == null) {
      warnings.push('Не удалось интерполировать по таблице');
    } else if (raw === Infinity || raw && raw === Infinity) {
      return { autonomyMin: Infinity, feasible: true, blockPowerW, method: 'table', warnings, extrapolated: false };
    } else if (typeof raw === 'object' && raw !== null) {
      tMin = raw.tMin;
      extrapolated = !!raw.extrapolated;
    } else {
      tMin = raw;
    }
    if (tMin != null) {
      const feasible = tMin > 0;
      if (extrapolated) warnings.push('Условный расчёт: запрошенный режим вне таблицы производителя — значение получено экстраполяцией двух первых точек кривой и не подтверждено производителем');
      else if (!feasible) warnings.push('Запрошенная мощность на блок превышает характеристики при самых коротких временах разряда — нужно больше блоков');
      return { autonomyMin: tMin, feasible: feasible || extrapolated, blockPowerW, method: 'table', warnings, extrapolated };
    }
  }

  // === Fallback: «средняя» модель ===
  const chemistry = (battery && battery.chemistry) || input.chemistry || 'vrla';
  const capacityAh = (battery && battery.capacityAh) || input.capacityAh || 100;
  const blockV = (battery && battery.blockVoltage) || 12;
  // Итеративно подбираем время (капасити зависит от времени через eff)
  let tGuess = 30; // мин, начальное
  for (let iter = 0; iter < 5; iter++) {
    const eff = avgEfficiency(chemistry, tGuess);
    const usableEnergyWhPerBlock = blockV * capacityAh * eff;
    const t = (usableEnergyWhPerBlock / blockPowerW) * 60;
    if (!Number.isFinite(t)) break;
    if (Math.abs(t - tGuess) < 0.5) { tGuess = t; break; }
    tGuess = t;
  }
  const feasible = tGuess > 0 && Number.isFinite(tGuess);
  if (!battery) warnings.push('Таблица батареи не загружена — расчёт по усреднённой модели');
  return { autonomyMin: tGuess, feasible, blockPowerW, method: 'average', warnings };
}

/**
 * Обратная задача: при заданном времени автономии и нагрузке — сколько
 * блоков/цепочек нужно? Возвращает минимальное totalBlocks.
 * Итерируется от 1 вверх до maxBlocks, проверяя calcAutonomy.
 */
export function calcRequiredBlocks(input) {
  const { targetMin = 10, maxBlocks = 2000 } = input;
  // blocksPerString берётся как есть — вызывающая сторона уже учла
  // диапазон V_DC мин/макс при выборе N (см. battery-calc.js).
  // Только если N не передан — fallback к round(dcVoltage / blockV).
  let blocksPerString = input.blocksPerString || 0;
  if (!blocksPerString && input.dcVoltage && input.battery && input.battery.blockVoltage) {
    blocksPerString = Math.max(1, Math.round(input.dcVoltage / input.battery.blockVoltage));
  }
  if (!blocksPerString) blocksPerString = 1;
  for (let strings = 1; strings * blocksPerString <= maxBlocks; strings++) {
    const r = calcAutonomy({ ...input, strings, blocksPerString });
    if (r.feasible && r.autonomyMin >= targetMin) {
      return { strings, blocksPerString, totalBlocks: strings * blocksPerString, result: r };
    }
  }
  return null;
}

export { interpTable, interpTimeByPower, avgEfficiency };
