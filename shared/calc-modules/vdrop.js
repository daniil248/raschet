// ======================================================================
// shared/calc-modules/vdrop.js
// Обязательный модуль: проверка падения напряжения (IEC 60364-5-52
// Annex G, ПУЭ 1.2.22). Норма: ΔU ≤ 5% для освещения / ≤ 5% для
// силовых (пользователь задаёт maxVdropPct).
//
// Если текущий подбор по току не укладывается — модуль предлагает
// увеличить сечение (bump), но не принимает решение сам: итоговое
// сечение выбирается runner'ом как max(bump_i по всем модулям).
// ======================================================================

import { calcVoltageDrop, findMinSizeForVdrop, getMethod } from '../../js/methods/index.js';

export const vdropModule = {
  id: 'vdrop',
  label: 'Падение напряжения',
  description: 'IEC 60364-5-52 Annex G — проверка ΔU ≤ maxVdropPct. Если не укладываемся, предлагается большее сечение.',
  mandatory: true,
  order: 20,
  calc(input) {
    if (!(input.lengthM > 0)) {
      return {
        pass: true,
        details: { skipped: true, reason: 'длина линии не задана' },
        warnings: [],
      };
    }
    const cosPhi = input.dc ? 1 : (input.cosPhi || 0.92);
    const sCurrent = Number(input.currentSize) || 0;
    if (!(sCurrent > 0)) {
      return { pass: true, details: { skipped: true }, warnings: [] };
    }
    const vdrop = calcVoltageDrop(
      input.I, sCurrent, input.material, input.lengthM,
      input.U, input.phases, cosPhi, input.parallel || 1, !!input.dc
    );
    const maxPct = Number(input.maxVdropPct) || 5;
    const pass = vdrop.dUpct <= maxPct;
    let bump = null;
    if (!pass) {
      const method = getMethod(input.calcMethod || 'iec');
      const sizes = method.availableSizes(input.material, input.insulation, input.method)
        .filter(s => s <= (input.maxSize || 240));
      bump = findMinSizeForVdrop(
        input.I, input.material, input.lengthM, input.U, input.phases,
        cosPhi, input.parallel || 1, maxPct, sizes, !!input.dc
      );
    }
    return {
      pass,
      bump,
      details: {
        s: sCurrent,
        dUvolts: vdrop.dU,
        dUpct: vdrop.dUpct,
        maxPct,
        cosPhi,
        bumpedTo: bump,
      },
      warnings: pass ? [] : [`ΔU ${vdrop.dUpct.toFixed(2)}% > ${maxPct}% — рекомендуется увеличить сечение.`],
    };
  },
};
