// ======================================================================
// shared/calc-modules/economic.js
// Опциональный модуль: экономическая плотность тока (ПУЭ 1.3.25-28).
// Для кабелей, работающих > 4000…5000 часов в год, ПУЭ рекомендует
// увеличивать сечение до ближайшего стандартного ≥ I/j_эк. В краткие
// режимы (резерв, аварийный, реже 2000 ч/год) — не применяется.
//
// По умолчанию ВЫКЛЮЧЕНО (defaultOn: false), потому что применимо
// не всегда и требует явного выбора пользователя.
// ======================================================================

import { getEcoMethod } from '../../js/methods/index.js';
import { getMethod } from '../../js/methods/index.js';

export const economicModule = {
  id: 'economic',
  label: 'Экономическая плотность тока',
  description: 'Экономическая плотность тока: j ≤ jэк. По ПУЭ 1.3.25 или IEC 60287-3-2. Методика зависит от выбора в настройках.',
  mandatory: false,
  defaultOn: false,
  order: 60,
  calc(input) {
    const eco = getEcoMethod(input.ecoMethod || 'pue_eco');
    if (!eco) {
      return { pass: true, details: { skipped: true }, warnings: ['Методика экономической плотности не найдена'] };
    }
    const method = getMethod(input.calcMethod || 'iec');
    const sizes = method.availableSizes(input.material, input.insulation, input.method)
      .filter(s => s <= (input.maxSize || 240));
    const params = { hours: input.economicHours || 5000 };
    const r = eco.calcEconomicSize(input.I, input.material, true, params, sizes);
    const sCurrent = Number(input.currentSize) || 0;
    const bump = r.sStandard > sCurrent ? r.sStandard : null;
    return {
      pass: bump == null,
      bump,
      details: {
        jEk: r.jEk,
        sCalc: r.sCalc,
        sStandard: r.sStandard,
        description: r.description,
        hours: params.hours,
      },
      warnings: bump ? [`По экон. плотности требуется ${r.sStandard} мм² (j_эк = ${r.jEk} А/мм²).`] : [],
    };
  },
};
