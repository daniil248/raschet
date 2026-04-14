// =========================================================================
// Расчёт падения напряжения — общий модуль для всех методик
// Формула: ΔU = (b × ρ × L × I × cosφ) / (n × S)
// ρ(Cu) = 0.0175 Ом·мм²/м, ρ(Al) = 0.028 Ом·мм²/м
// b = √3 для 3 фаз, 2 для 1 фазы
// =========================================================================

const RHO = { Cu: 0.0175, Al: 0.028 };

/**
 * Расчёт падения напряжения.
 * @param {number} I       — полный ток нагрузки, А
 * @param {number} S       — сечение жилы, мм²
 * @param {string} material — 'Cu' | 'Al'
 * @param {number} lengthM  — длина линии, м
 * @param {number} voltage  — напряжение линии (V_LL), В
 * @param {number} phases   — число фаз (3 | 1)
 * @param {number} cosPhi   — cos φ
 * @param {number} parallel — число параллельных линий
 * @returns {{ dU: number, dUpct: number }}
 */
export function calcVoltageDrop(I, S, material, lengthM, voltage, phases, cosPhi, parallel) {
  if (S <= 0 || lengthM <= 0 || voltage <= 0) return { dU: 0, dUpct: 0 };
  const rho = RHO[material] || RHO.Cu;
  const b = phases === 3 ? Math.sqrt(3) : 2;
  const cos = cosPhi || 0.92;
  const n = Math.max(1, parallel);
  const dU = (b * rho * lengthM * I * cos) / (n * S);
  return { dU, dUpct: (dU / voltage) * 100 };
}

/**
 * Найти минимальное стандартное сечение, при котором Vdrop ≤ maxPct%.
 * @param {number} I
 * @param {string} material
 * @param {number} lengthM
 * @param {number} voltage
 * @param {number} phases
 * @param {number} cosPhi
 * @param {number} parallel
 * @param {number} maxPct  — допустимое падение, %
 * @param {number[]} sizes — отсортированный массив доступных сечений [1.5, 2.5, 4, ...]
 * @returns {number|null}  — сечение мм², или null если ни одно не подходит
 */
export function findMinSizeForVdrop(I, material, lengthM, voltage, phases, cosPhi, parallel, maxPct, sizes) {
  for (const s of sizes) {
    const { dUpct } = calcVoltageDrop(I, s, material, lengthM, voltage, phases, cosPhi, parallel);
    if (dUpct <= maxPct) return s;
  }
  return null;
}
