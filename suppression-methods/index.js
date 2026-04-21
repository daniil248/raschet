/* =========================================================================
   suppression-methods/index.js — registry of gas suppression methodologies.
   Each method module exports { META, compute(input) } with a unified input:
     { agent, V, fireClass, leakage, tempC, altM, designFactor? }
   and returns { M, C, steps[], ... } to be rendered by the UI.
   ========================================================================= */

import * as SPRK  from './sp-rk-2022.js';
import * as SP485 from './sp-485-2020.js';
import * as NFPA  from './nfpa-2001.js';
import * as ISO   from './iso-14520.js';

export { AGENTS, CYLINDERS, Cnorm } from './agents.js';

export const METHODS = {
  [SPRK.META.id]:  SPRK,
  [SP485.META.id]: SP485,
  [NFPA.META.id]:  NFPA,
  [ISO.META.id]:   ISO,
};

export const METHOD_LIST = [SPRK.META, SP485.META, NFPA.META, ISO.META];

export function run(methodId, input) {
  const m = METHODS[methodId];
  if (!m) throw new Error('Unknown method: ' + methodId);
  return m.compute(input);
}

/* ----- Piping (simplified sizing, common to all methods) -----
   Main pipe diameter by mass-flow rate: m_dot = M / t_разр
   Pipe ID by continuity & target velocity 30–40 m/s for halocarbon,
   60–80 m/s for inert.
   Nozzle count: one per 100 m² of protected area (NFPA guideline),
   with max radius 7.3 m per nozzle for halocarbon.
   ========================================================================= */
export function pipingSpec(result, input) {
  const a = METHODS[result.method] ? null : null;
  const { M, dischargeS } = result;
  const type = result.s ? 'halocarbon' /* nfpa/iso has s */
             : result.K1 && result.Kalt && result.Kt ? 'halocarbon' : 'inert';
  // mass flow rate
  const mdot = M / dischargeS;                  // kg/s
  const vel  = type === 'halocarbon' ? 35 : 70; // m/s target
  // ID from ρ·v·A=ṁ (using rho20 as approx for pipe sizing)
  const rho = 7; // rough average vapor density in pipe (kg/m³)
  const A   = mdot / (rho * vel);
  const ID  = Math.sqrt(4 * A / Math.PI) * 1000; // mm
  // round up to nearest DN
  const DN_LIST = [15,20,25,32,40,50,65,80,100,125,150];
  const DN = DN_LIST.find(d => d >= ID) || 150;

  // Nozzles: assume floorArea = V / H, default H=3m if area unknown
  const H = input.heightM || 3;
  const floorArea = input.V / H;
  const nozzleCoverage = type === 'halocarbon' ? 80 : 100; // m²/nozzle
  const nozzles = Math.max(1, Math.ceil(floorArea / nozzleCoverage));

  // Pipe length estimate: perimeter + riser + branches
  const pipeLen = Math.ceil(2 * Math.sqrt(floorArea) + H + nozzles * 2);

  return {
    type, mdot: +mdot.toFixed(2), vel, DN,
    nozzles, pipeLen,
    notes: [
      `Массовый расход m˙ = M/t = ${M}/${dischargeS} = ${mdot.toFixed(2)} кг/с`,
      `Скорость в трубопроводе ≈ ${vel} м/с → DN ${DN}`,
      `Площадь пола ≈ ${floorArea.toFixed(1)} м² → ${nozzles} форсунок (≈${nozzleCoverage} м²/шт)`,
      `Оценка длины трубопровода ≈ ${pipeLen} м`,
    ],
  };
}

/* ----- Cylinder selection -----
   Picks the smallest cylinder size that yields ceil(M/Mcyl) cylinders.
   ========================================================================= */
import { AGENTS, CYLINDERS } from './agents.js';
export function cylinderPick(result, preferredV) {
  const a = AGENTS[result.agent];
  const pool = CYLINDERS[a.type];
  const options = pool.map(c => {
    const Mcyl = a.type === 'halocarbon'
      ? c.V * a.fillRatioMax
      : c.V * (c.P * 100 /* bar→kPa */) / (a.rho20 * 8.314 * 293.15 / a.molarMass / 1000);
    const n = Math.ceil(result.Mreserve / Mcyl);
    return { ...c, Mcyl: +Mcyl.toFixed(1), n };
  });
  if (preferredV) {
    const hit = options.find(o => o.V === preferredV);
    if (hit) return hit;
  }
  // default: smallest n with min total
  return options.reduce((best, o) => (o.n < best.n || (o.n === best.n && o.V < best.V)) ? o : best);
}
