/* =========================================================================
   hydraulic-methods/head-loss-manning.js — потери напора по Шези–
   Маннингу (напорная круглая труба полного сечения; n — коэф.
   шероховатости). D4/D5: обособленная методика-файл. Sf = n²v²/R^(4/3),
   R = D/4, hf = Sf·L. Контракт calc-lib.
   ========================================================================= */

import {
  MANNING_N, pipeArea, flowVelocity, headLossManning,
  headToPressure, waterDensity, G,
} from './formulas.js';

export const META = {
  id: 'chezy-manning',
  label: 'Потери напора — Шези–Маннинг',
  standard: 'Chézy–Manning (R=D/4, полное сечение)',
  region: 'INT',
  version: '1.0',
  enabled: true,
  discipline: 'hydraulic',
  refs: ['Manning', 'Chézy', 'самотёчные / напорные трубопроводы'],
  inputs: [
    { key: 'Q',    label: 'Расход',          unit: 'м³/ч', type: 'number', default: 36, required: true },
    { key: 'D_mm', label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',    label: 'Длина участка',   unit: 'м',    type: 'number', default: 120, required: true },
    { key: 'material', label: 'Материал трубы', unit: '',   type: 'select', default: 'steel_used',
      options: [
        { value: 'steel_new', label: 'Сталь новая' },
        { value: 'steel_used', label: 'Сталь б/у' },
        { value: 'galvanized', label: 'Оцинковка' },
        { value: 'cast_iron', label: 'Чугун' },
        { value: 'copper', label: 'Медь' },
        { value: 'pvc', label: 'ПВХ' },
        { value: 'pe', label: 'ПЭ' },
        { value: 'concrete', label: 'Бетон' },
      ] },
    { key: 'n_override', label: 'n (переопр.)', unit: 'с/м^⅓', type: 'number', default: 0 },
    { key: 'tC',   label: 'Темп. воды',      unit: '°C',   type: 'number', default: 20 },
    { key: 'dz',   label: 'Геод. перепад',   unit: 'м',    type: 'number', default: 0 },
  ],
};

export function compute(input = {}) {
  const Qh = Number(input.Q) || 0;
  const Q  = Qh / 3600;
  const D  = (Number(input.D_mm) || 0) / 1000;
  const L  = Number(input.L) || 0;
  const dz = Number(input.dz) || 0;
  const tC = Number.isFinite(+input.tC) ? +input.tC : 20;
  const n  = (+input.n_override > 0)
    ? +input.n_override
    : (MANNING_N[input.material] ?? MANNING_N.steel_used);

  const rho = waterDensity(tC);
  const v   = flowVelocity(Q, D);
  const hf_len   = headLossManning(n, L, D, v);
  const hf_geo   = dz;
  const hf_total = hf_len + hf_geo;
  const dP_total = headToPressure(hf_total, rho);

  return {
    method: META.id, standard: META.standard,
    inputs: { Q_m3h: Qh, D_mm: input.D_mm, L, n, tC, dz },
    rho, area_m2: pipeArea(D), v,
    hf_len, hf_geo, hf_total,
    dP_total, dP_kPa: dP_total / 1000,
    i_per_100m: D > 0 && L > 0 ? hf_len / L * 100 : 0,
    steps: [
      `v = Q/A = ${v.toFixed(3)} м/с; n(Маннинг) = ${n}; R = D/4 = ${(D / 4).toFixed(4)} м`,
      `Sf = n²·v²/R^(4/3); hf = Sf·L = ${hf_len.toFixed(3)} м; геод. ${hf_geo.toFixed(3)} м`,
      `ΔP = ρ·g·Σh = ${rho.toFixed(1)}·${G}·${hf_total.toFixed(3)} = ${(dP_total / 1000).toFixed(2)} кПа`,
    ],
  };
}
