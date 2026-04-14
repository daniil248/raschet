// =========================================================================
// Экономическая плотность тока — IEC 60287-3-2
// Упрощённая таблица рекомендованных значений j_эк
// =========================================================================

const J_TABLE = {
  Cu: [3.0, 2.5, 2.0],  // [<3000ч, 3000-5000ч, >5000ч]
  Al: [1.6, 1.4, 1.2],
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
  id: 'iec_eco',
  label: 'IEC 60287-3-2',

  params: [
    {
      id: 'hours', label: 'Annual hours of maximum load utilization',
      type: 'select',
      options: [
        { value: 3000, label: 'До 3000 ч' },
        { value: 5000, label: '3000–5000 ч' },
        { value: 8000, label: 'Более 5000 ч' },
      ],
      default: 5000,
    },
  ],

  calcEconomicSize(I, material, insulated, params, availableSizes) {
    const col = J_TABLE[material] || J_TABLE.Cu;
    const idx = hoursIdx(params.hours || 5000);
    const jEk = col[idx];
    const sCalc = I / jEk;
    const sStandard = availableSizes.find(s => s >= sCalc) || availableSizes[availableSizes.length - 1];
    return {
      jEk,
      sCalc: Math.round(sCalc * 100) / 100,
      sStandard,
      description: `IEC 60287-3-2, ${material === 'Cu' ? 'Cu' : 'Al'}, ${hoursLabel(params.hours || 5000)}: j_эк = ${jEk} А/мм²`,
    };
  },
};
