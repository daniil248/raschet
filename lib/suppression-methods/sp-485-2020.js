/* =========================================================================
   SP 485.1311500.2020 — Russian Set of Rules for Automatic Fire
   Suppression Installations, section on gaseous agents.

   Halocarbon (СП 485, п. 9.4.1):
     M = V · (ρ1 / s) · (C_н / (100 − C_н)) · K1
     K1 = 1.10 (typical indoor), up to 1.30 for compartments with openings
     C_н = C_min × K_без (1.2 class B, 1.3 class A)
   Inert (п. 9.4.2):
     M = K1 · V · ρ_s · ln(100/(100 − C_н))
   ========================================================================= */

import { AGENTS } from './agents.js';

export const META = {
  id: 'sp-485-2020',
  label: 'СП 485.1311500.2020 (Россия)',
  region: 'RU',
  year: 2020,
  refs: [
    'СП 485.1311500.2020',
    'ГОСТ Р 53281, 53282, 53283',
  ],
};

function Ks(fireClass) { return fireClass === 'A' ? 1.3 : 1.2; }

function K1ByLeakage(leak) {
  // SP 485 uses slightly different coefficients:
  //   I  (airtight)       — 1.00
  //   II (standard)       — 1.15
  //   III (with openings) — 1.30
  return leak === 'I' ? 1.00 : leak === 'III' ? 1.30 : 1.15;
}

function tempCorrection(T) {
  return (273.15 + 20) / (273.15 + (Number.isFinite(T) ? T : 20));
}

function altCorrection(H) {
  // Russian methodology (approx, linear 1%/100m up to 2000m)
  const h = Math.max(0, H || 0);
  return Math.max(0.75, 1 - h / 10000);
}

export function compute(input) {
  const { agent, V, fireClass = 'A', leakage = 'II', tempC = 20, altM = 0 } = input;
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);

  const Kbez = Ks(fireClass);
  const K1 = K1ByLeakage(leakage);
  const Cmin = fireClass === 'A' ? a.Cmin_A : a.Cmin_B;
  const C = +(Cmin * Kbez).toFixed(2);
  const Kt = tempCorrection(tempC);
  const Kalt = altCorrection(altM);

  let M;
  if (a.type === 'halocarbon') {
    M = K1 * V * (1 / a.s20) * (C / (100 - C));
  } else {
    M = K1 * V * a.rho20 * Math.log(100 / (100 - C));
  }
  M = +(M * Kt / Kalt).toFixed(1);

  return {
    method: META.id, agent, agentLabel: a.label,
    V, fireClass, leakage, tempC, altM,
    C, Cmin, Ks: Kbez, K1, Kt: +Kt.toFixed(3), Kalt: +Kalt.toFixed(3),
    M, Mreserve: M,
    dischargeS: a.dischargeS,
    steps: [
      `Агент: ${a.label}`,
      `Cmin(${fireClass}) = ${Cmin}% × K_без=${Kbez} → C_н = ${C}%`,
      `K1 (утечки ${leakage}) = ${K1}`,
      a.type === 'halocarbon'
        ? `M = K1·V·(ρ/s)·C/(100−C) = ${K1}·${V}·${(1/a.s20).toFixed(2)}·${C}/${(100-C).toFixed(1)} = ${M} кг`
        : `M = K1·V·ρ·ln(100/(100−C)) = ${M} кг`,
    ],
  };
}
