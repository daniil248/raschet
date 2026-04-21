/* =========================================================================
   ISO 14520 — Gaseous fire-extinguishing systems (general requirements).
   Harmonized with NFPA 2001 but uses slightly different safety factors.

   Design concentration:
     Class A surface fires: 1.3 × MEC
     Class B:               1.3 × cup-burner value
   Quantity:
     halocarbon: M = V/s · C/(100−C)     (kg)
     inert:      M = V · ρ_s · ln(100/(100−C))
   Altitude correction per ISO 14520-1 Annex E.
   ========================================================================= */

import { AGENTS } from './agents.js';

export const META = {
  id: 'iso-14520',
  label: 'ISO 14520 (International, 2019)',
  region: 'INT',
  year: 2019,
  refs: ['ISO 14520-1:2015 + Amd.1:2019', 'ISO 14520-9,-10,-13,-15 (по газу)'],
};

function tempS(agentKey, T) {
  // ISO 14520 s(T) piecewise-linear, 20°C baseline
  const a = AGENTS[agentKey];
  return a.s20 * (273.15 + (Number.isFinite(T) ? T : 20)) / (273.15 + 20);
}

function altFactor(H) {
  // ISO 14520 Annex E Table 1
  const table = [[0,1.00],[500,0.94],[1000,0.88],[1500,0.82],
                 [2000,0.76],[2500,0.70],[3000,0.65]];
  const h = Math.max(0, Math.min(3000, H || 0));
  for (let i = 1; i < table.length; i++) {
    if (h <= table[i][0]) {
      const [h0,k0] = table[i-1], [h1,k1] = table[i];
      return k0 + (k1 - k0) * (h - h0) / (h1 - h0);
    }
  }
  return 0.65;
}

export function compute(input) {
  const { agent, V, fireClass = 'A', tempC = 20, altM = 0, designFactor = 1.3 } = input;
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);

  const Cmin = fireClass === 'A' ? a.Cmin_A : a.Cmin_B;
  const C = +(Cmin * designFactor).toFixed(2);
  const s = tempS(agent, tempC);
  const Kalt = altFactor(altM);

  let M;
  if (a.type === 'halocarbon') {
    M = V / s * (C / (100 - C));
  } else {
    M = V * a.rho20 * Math.log(100 / (100 - C));
  }
  M = +(M / Kalt).toFixed(1);

  return {
    method: META.id, agent, agentLabel: a.label,
    V, fireClass, tempC, altM, designFactor,
    C, Cmin, s: +s.toFixed(4), Kalt: +Kalt.toFixed(3),
    M, Mreserve: M,
    dischargeS: a.dischargeS,
    steps: [
      `Agent: ${a.label}`,
      `Design C = ${Cmin} × ${designFactor} = ${C}% (class ${fireClass})`,
      `s(T=${tempC}°C) = ${s.toFixed(4)} m³/kg; Kalt(H=${altM}m)=${Kalt.toFixed(3)}`,
      a.type === 'halocarbon'
        ? `M = V/s · C/(100−C) / Kalt = ${M} kg`
        : `M = V·ρ·ln(100/(100−C)) / Kalt = ${M} kg`,
    ],
  };
}
