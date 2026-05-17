/* =========================================================================
   hydraulic-methods/head-loss-hazen-williams.js — потери напора по
   эмпирической формуле Хазена–Вильямса (вода, напорные трубопроводы).
   D4/D5: обособленная методика-файл (отключаемая/версионируемая).
   hf = 10.67·L·Q^1.852 / (C^1.852·D^4.871). Контракт calc-lib.
   ========================================================================= */

import {
  HW_C, pipeArea, flowVelocity, headLossHazenWilliams,
  headToPressure, waterDensity, G,
} from './formulas.js';

export const META = {
  id: 'hazen-williams',
  label: 'Потери напора — Хазен–Вильямс',
  standard: 'Hazen–Williams (эмпирич., вода)',
  region: 'INT',
  version: '1.0',
  enabled: true,
  discipline: 'hydraulic',
  refs: ['Hazen–Williams', 'AWWA', 'вода, турбулентный режим'],
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
    { key: 'C_override', label: 'C (переопр.)', unit: '',  type: 'number', default: 0 },
    { key: 'tC',   label: 'Темп. воды',      unit: '°C',   type: 'number', default: 20 },
    { key: 'dz',   label: 'Геод. перепад',   unit: 'м',    type: 'number', default: 0 },
  ],
};

export function compute(input = {}) {
  const Qh = Number(input.Q) || 0;
  const Q  = Qh / 3600;                          // м³/с
  const D  = (Number(input.D_mm) || 0) / 1000;   // м
  const L  = Number(input.L) || 0;
  const dz = Number(input.dz) || 0;
  const tC = Number.isFinite(+input.tC) ? +input.tC : 20;
  const C  = (+input.C_override > 0)
    ? +input.C_override
    : (HW_C[input.material] ?? HW_C.steel_used);

  const rho = waterDensity(tC);
  const v   = flowVelocity(Q, D);
  const hf_len   = headLossHazenWilliams(C, L, D, Q);
  const hf_geo   = dz;
  const hf_total = hf_len + hf_geo;
  const dP_total = headToPressure(hf_total, rho);

  return {
    method: META.id, standard: META.standard,
    inputs: { Q_m3h: Qh, D_mm: input.D_mm, L, C, tC, dz },
    rho, area_m2: pipeArea(D), v,
    hf_len, hf_geo, hf_total,
    dP_total, dP_kPa: dP_total / 1000,
    i_per_100m: D > 0 && L > 0 ? hf_len / L * 100 : 0,
    steps: [
      `v = Q/A = ${v.toFixed(3)} м/с; C(Хазен–Вильямс) = ${C}`,
      `hf = 10.67·L·Q^1.852/(C^1.852·D^4.871) = ${hf_len.toFixed(3)} м; геод. ${hf_geo.toFixed(3)} м`,
      `ΔP = ρ·g·Σh = ${rho.toFixed(1)}·${G}·${hf_total.toFixed(3)} = ${(dP_total / 1000).toFixed(2)} кПа`,
    ],
  };
}
