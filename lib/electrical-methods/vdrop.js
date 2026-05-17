// =========================================================================
// Расчёт падения напряжения — общий модуль для всех методик
// AC: ΔU = (b × ρ × L × I × cosφ) / (n × S), b = √3 (3ф) или 2 (1ф)
// DC: ΔU = (2 × ρ × L × I) / (n × S)
// ρ(Cu) = 0.0175 Ом·мм²/м, ρ(Al) = 0.028 Ом·мм²/м
// =========================================================================

const RHO = { Cu: 0.0175, Al: 0.028 };

/**
 * Расчёт падения напряжения.
 * @param {number} I        — полный ток нагрузки, А
 * @param {number} S        — сечение жилы, мм²
 * @param {string} material — 'Cu' | 'Al'
 * @param {number} lengthM  — длина линии, м
 * @param {number} voltage  — напряжение линии (V_LL), В
 * @param {number} phases   — число фаз (3 | 1)
 * @param {number} cosPhi   — cos φ (игнорируется для DC)
 * @param {number} parallel — число параллельных линий
 * @param {boolean} [dc]    — true для постоянного тока
 * @returns {{ dU: number, dUpct: number }}
 */
export function calcVoltageDrop(I, S, material, lengthM, voltage, phases, cosPhi, parallel, dc) {
  if (S <= 0 || lengthM <= 0 || voltage <= 0) return { dU: 0, dUpct: 0 };
  const rho = RHO[material] || RHO.Cu;
  const n = Math.max(1, parallel);
  let dU;
  if (dc) {
    // DC: ΔU = 2 × ρ × L × I / (n × S)
    dU = (2 * rho * lengthM * I) / (n * S);
  } else {
    // AC: ΔU = b × ρ × L × I × cosφ / (n × S)
    const b = phases === 3 ? Math.sqrt(3) : 2;
    const cos = cosPhi || 0.92;
    dU = (b * rho * lengthM * I * cos) / (n * S);
  }
  return { dU, dUpct: (dU / voltage) * 100 };
}

/**
 * Найти минимальное стандартное сечение, при котором Vdrop ≤ maxPct%.
 */
export function findMinSizeForVdrop(I, material, lengthM, voltage, phases, cosPhi, parallel, maxPct, sizes, dc) {
  for (const s of sizes) {
    const { dUpct } = calcVoltageDrop(I, s, material, lengthM, voltage, phases, cosPhi, parallel, dc);
    if (dUpct <= maxPct) return s;
  }
  return null;
}
