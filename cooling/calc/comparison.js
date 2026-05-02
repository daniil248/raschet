// =============================================================================
// cooling/calc/comparison.js — сравнение нескольких конфигураций
// =============================================================================
// Принимает массив именованных опций { name, spec, eco } + общий hourly +
// тариф, возвращает таблицу метрик для side-by-side сравнения.
//
// NO DOM. Pure JS.

import { buildBinData } from './chiller-bin-calc.js';
import { computeFcSummary } from './fc-summary.js';
import { computeTco, discountedPaybackYears } from './capex-tco.js';

/**
 * Метрики для одной опции.
 *
 * @typedef {object} OptionMetrics
 * @property {string} name           — пользовательское имя
 * @property {object} spec           — chillerSpec
 * @property {object} eco            — economics
 * @property {object} fc             — результат computeFcSummary
 * @property {object} tco            — результат computeTco
 * @property {number} annualEnergy   — кВт·ч/год (alias fc.energyKwh)
 * @property {number} annualCost     — ₽/год (alias fc.costRub)
 * @property {object|null} payback   — discounted payback vs первой опции
 *                                     (если эта опция дороже по CAPEX)
 */

/**
 * Сравнить N опций.
 *
 * @param {Array<{name, spec, eco}>} options — список опций
 * @param {Array<object>} hourly             — фильтрованный hourly meteo
 * @param {number} tariffRubKwh
 *
 * @returns {Array<OptionMetrics>}
 */
export function compareOptions(options, hourly, tariffRubKwh) {
  if (!options || !options.length) return [];

  // Считаем TCO/FC для каждой опции
  const computed = options.map(opt => {
    const rows = buildBinData(hourly, opt.spec);
    const fc = computeFcSummary(rows, opt.spec, tariffRubKwh, hourly);
    const tco = computeTco({
      annualEnergyKwh: fc ? fc.energyKwh : 0,
      tariffRubKwh,
      eco: opt.eco,
    });
    return {
      name: opt.name,
      spec: opt.spec,
      eco: opt.eco,
      fc,
      tco,
      annualEnergy: fc ? fc.energyKwh : 0,
      annualCost: fc ? fc.costRub : 0,
      payback: null,
    };
  });

  // Payback каждой относительно baseline (первой)
  const baseline = computed[0];
  for (let i = 1; i < computed.length; i++) {
    computed[i].payback = discountedPaybackYears(computed[i].tco, baseline.tco);
  }

  return computed;
}

/**
 * Найти «победителя» по конкретной метрике.
 *
 * @param {Array<OptionMetrics>} metrics
 * @param {string} field   — путь через точки, напр. 'tco.tco', 'fc.energyKwh'
 * @param {boolean} lowerIsBetter
 *
 * @returns {number} индекс победителя или -1 если нет данных
 */
export function findBest(metrics, field, lowerIsBetter = true) {
  let bestIdx = -1;
  let bestVal = lowerIsBetter ? Infinity : -Infinity;
  metrics.forEach((m, i) => {
    const v = field.split('.').reduce((o, k) => (o == null ? null : o[k]), m);
    if (!Number.isFinite(v)) return;
    if (lowerIsBetter ? v < bestVal : v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}
