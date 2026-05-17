// =========================================================================
// Экономическая плотность тока — ПУЭ 7 табл. 1.3.36
// =========================================================================

// j_эк (А/мм²) в зависимости от материала, изоляции и числа часов
// Строки: [Cu голые, Cu изолир., Al голые, Al изолир.]
// Столбцы: [<3000ч, 3000-5000ч, >5000ч]
const J_TABLE = {
  Cu: { bare: [2.5, 2.1, 1.8], insulated: [3.5, 3.1, 2.7] },
  Al: { bare: [1.3, 1.1, 1.0], insulated: [1.9, 1.7, 1.6] },
};

function hoursIdx(hours) {
  if (hours <= 3000) return 0;
  if (hours <= 5000) return 1;
  return 2;
}

function hoursLabel(hours) {
  if (hours <= 3000) return 'до 3000 ч';
  if (hours <= 5000) return '3000–5000 ч';
  return 'более 5000 ч';
}

export default {
  id: 'pue_eco',
  label: 'ПУЭ табл. 1.3.36',

  params: [
    {
      id: 'hours', label: 'Число часов использования максимума нагрузки в год',
      type: 'select',
      options: [
        { value: 3000, label: 'До 3000 ч' },
        { value: 5000, label: '3000–5000 ч' },
        { value: 8000, label: 'Более 5000 ч' },
      ],
      default: 5000,
    },
  ],

  /**
   * @param {number} I — расчётный ток, А
   * @param {string} material — 'Cu' | 'Al'
   * @param {boolean} insulated — true для кабелей с изоляцией
   * @param {object} params — { hours: number }
   * @param {number[]} availableSizes — [1.5, 2.5, 4, ...]
   * @returns {{ jEk, sCalc, sStandard, description }}
   */
  calcEconomicSize(I, material, insulated, params, availableSizes) {
    const mat = J_TABLE[material] || J_TABLE.Cu;
    const col = insulated ? mat.insulated : mat.bare;
    const idx = hoursIdx(params.hours || 5000);
    const jEk = col[idx];
    const sCalc = I / jEk;
    const sStandard = availableSizes.find(s => s >= sCalc) || availableSizes[availableSizes.length - 1];
    return {
      jEk,
      sCalc: Math.round(sCalc * 100) / 100,
      sStandard,
      description: `ПУЭ табл. 1.3.36, ${material === 'Cu' ? 'медь' : 'алюминий'}, ${insulated ? 'изолир.' : 'голые'}, ${hoursLabel(params.hours || 5000)}: j_эк = ${jEk} А/мм²`,
    };
  },
};
