/* =========================================================================
   NFPA 2001 — Standard on Clean Agent Fire Extinguishing Systems (2018 ed.)

   Halocarbon (NFPA 2001 §A.5.5, flooding quantity):
     W = V · C / (100 − C) / s
     where:
       W — agent quantity, kg
       V — hazard volume, m³
       s — specific volume of agent vapor at T, m³/kg; s = k1 + k2·T(°C)
       C — design concentration, %

   Design concentration (§5.4):
     Class A: 1.3 × MEC (LEL-equivalent)
     Class B: 1.3 × MEC  (or cup-burner value × 1.3)
     Class C: class A method
   ========================================================================= */

import { AGENTS } from './agents.js';

export const META = {
  id: 'nfpa-2001',
  label: 'NFPA 2001 (USA, 2018)',
  region: 'US',
  year: 2018,
  refs: ['NFPA 2001 §5.5, A.5.5, Appendix A'],
};

// specific volume for common agents at 20°C (NFPA 2001 table A.5.5)
const S_COEF = {
  'HFC-227ea':  { k1: 0.1269, k2: 0.000513 },
  'FK-5-1-12':  { k1: 0.0664, k2: 0.000274 },
  'HFC-125':    { k1: 0.1537, k2: 0.000650 },
  'HFC-23':     { k1: 0.3164, k2: 0.00117  },
};

function sOfAgent(agent, T) {
  const c = S_COEF[agent];
  if (c) return c.k1 + c.k2 * (Number.isFinite(T) ? T : 20);
  return AGENTS[agent].s20;
}

function altFactor(H) {
  // NFPA 2001 Table A.5.5.1 (atmospheric correction)
  const h = Math.max(0, H || 0);
  if (h <= 1000) return 1 - h / 10000;        // ~1% per 100m
  if (h <= 2000) return 0.9 - (h - 1000) / 10000;
  return 0.8;
}

export function compute(input) {
  const { agent, V, fireClass = 'A', tempC = 20, altM = 0, designFactor = 1.3 } = input;
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);

  const Cmin = fireClass === 'A' ? a.Cmin_A : a.Cmin_B;
  const C = +(Cmin * designFactor).toFixed(2);
  const s = sOfAgent(agent, tempC);
  const Kalt = altFactor(altM);

  let W;
  if (a.type === 'halocarbon') {
    W = V / s * (C / (100 - C));
  } else {
    W = V * a.rho20 * Math.log(100 / (100 - C));
  }
  W = +(W / Kalt).toFixed(1);

  return {
    method: META.id, agent, agentLabel: a.label,
    V, fireClass, tempC, altM, designFactor,
    C, Cmin, s: +s.toFixed(4), Kalt: +Kalt.toFixed(3),
    M: W, Mreserve: W,
    dischargeS: a.dischargeS,
    steps: [
      `Agent: ${a.label}`,
      `MEC (class ${fireClass}) = ${Cmin}% × design factor ${designFactor} → C = ${C}%`,
      `s(T=${tempC}°C) = ${s.toFixed(4)} m³/kg`,
      a.type === 'halocarbon'
        ? `W = V/s · C/(100−C) / Kalt = ${V}/${s.toFixed(4)} · ${C}/${(100-C).toFixed(1)} / ${Kalt.toFixed(3)} = ${W} kg`
        : `W = V·ρ·ln(100/(100−C)) / Kalt = ${W} kg`,
    ],
  };
}
