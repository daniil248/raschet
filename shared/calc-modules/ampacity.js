// ======================================================================
// shared/calc-modules/ampacity.js
// Обязательный модуль: подбор сечения по длительно допустимому току
// (IEC 60364-5-52). Каждая линия ДОЛЖНА пройти этот расчёт — отключить
// нельзя.
//
// Использует существующую логику расчёта из js/methods/ (методика
// IEC или ПУЭ, выбранная пользователем). Это тонкая обёртка, которая
// адаптирует методику под единый интерфейс calc-module.
// ======================================================================

import { getMethod } from '../../js/methods/index.js';

export const ampacityModule = {
  id: 'ampacity',
  label: 'Подбор по току нагрузки',
  description: 'Длительно допустимый ток с учётом температуры, группирования и способа прокладки. Таблицы по выбранной методике (IEC 60364-5-52 или ПУЭ).',
  mandatory: true,
  order: 10,
  calc(input) {
    const method = getMethod(input.calcMethod || 'iec');
    const sel = method.selectCable(input.I, {
      material:  input.material,
      insulation: input.insulation,
      method:    input.method,
      cableType: input.cableType,
      ambient:   input.ambient,
      grouping:  input.grouping,
      bundling:  input.bundling,
      maxSize:   input.maxSize,
      parallel:  input.parallel || 1,
    });
    const warnings = [];
    if (sel.overflow) warnings.push('Не удалось подобрать кабель в пределах maxSize — взято максимальное.');
    if (sel.autoParallel) warnings.push(`Авто-наращена параллель до ${sel.parallel} линий.`);
    return {
      pass: !sel.overflow,
      bump: sel.s,
      details: {
        s: sel.s,
        iAllowed: sel.iAllowed,
        iDerated: sel.iDerated,
        kT: sel.kT,
        kG: sel.kG,
        kTotal: sel.kT * sel.kG,
        parallel: sel.parallel,
        totalCapacity: sel.totalCapacity,
        overflow: !!sel.overflow,
        autoParallel: !!sel.autoParallel,
      },
      warnings,
    };
  },
};
