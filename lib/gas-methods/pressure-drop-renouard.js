/* =========================================================================
   gas-methods/pressure-drop-renouard.js — потери давления по формулам
   Renouard (распределительные газопроводы, EU-практика). D4: обособленная
   методика-стандарт, выбирается пользователем. Контракт calc-lib.
   Renouard linéaire — низкое/среднее P (ΔP « P); Renouard quadratique —
   среднее/высокое P. Порог — LOW_PRESSURE_LIMIT (5 кПа изб.).
   ========================================================================= */

import {
  GAS_PROPS, gasDensityNormal, renouardLinearDP, renouardQuadraticDSq,
  LOW_PRESSURE_LIMIT, P_ATM,
} from './formulas.js';

export const META = {
  id: 'gas-dp-renouard',
  label: 'Потери давления — Renouard',
  standard: 'Renouard (linéaire / quadratique)',
  discipline: 'gas',
  refs: ['Renouard linéaire', 'Renouard quadratique', 'EU распред. газопроводы'],
  inputs: [
    { key: 'Q',      label: 'Расход (н.у.)',   unit: 'м³/ч', type: 'number', default: 50, required: true },
    { key: 'D_mm',   label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',      label: 'Длина участка',   unit: 'м',    type: 'number', default: 200, required: true },
    { key: 'P1_kPa', label: 'Давл. в начале (изб.)', unit: 'кПа', type: 'number', default: 3 },
    { key: 'gas',    label: 'Газ',             unit: '',     type: 'select', default: 'natural',
      options: [
        { value: 'natural', label: 'Природный' },
        { value: 'methane', label: 'Метан' },
        { value: 'propane', label: 'Пропан' },
        { value: 'butane', label: 'Бутан' },
        { value: 'air', label: 'Воздух' },
      ] },
    { key: 'tC',     label: 'Темп. газа',      unit: '°C',   type: 'number', default: 20 },
  ],
};

export function compute(input = {}) {
  const Qh   = Number(input.Q) || 0;                // м³/ч н.у.
  const Dmm  = Number(input.D_mm) || 0;
  const L    = Number(input.L) || 0;
  const P1g  = Number.isFinite(+input.P1_kPa) ? (+input.P1_kPa) * 1000 : 3000;
  const props = GAS_PROPS[input.gas] ?? GAS_PROPS.natural;
  const dRel = Number.isFinite(+input.relDensity) ? +input.relDensity : props.d;
  const rhoN = gasDensityNormal(dRel);
  const P1abs = P_ATM + P1g;
  const isLow = P1g <= LOW_PRESSURE_LIMIT;

  let dP_Pa, P2g, P2abs, mode;
  if (isLow) {
    mode = 'Renouard linéaire (низкое/среднее)';
    dP_Pa = renouardLinearDP(dRel, L, Dmm, Qh);
    P2abs = P1abs - dP_Pa;
    P2g   = P2abs - P_ATM;
  } else {
    mode = 'Renouard quadratique (среднее/высокое)';
    const dSq  = renouardQuadraticDSq(dRel, L, Dmm, Qh);
    const P2sq = Math.max(P1abs * P1abs - dSq, 0);
    P2abs = Math.sqrt(P2sq);
    P2g   = P2abs - P_ATM;
    dP_Pa = P1abs - P2abs;
  }

  return {
    method: META.id, standard: META.standard,
    inputs: { Q_m3h: Qh, D_mm: Dmm, L, P1_kPa: P1g / 1000,
              gas: input.gas || 'natural', relDensity: dRel },
    regime: mode, rhoN,
    dP_Pa, dP_kPa: dP_Pa / 1000,
    P1_kPa: P1g / 1000, P2_kPa: P2g / 1000,
    dP_per_100m_kPa: L > 0 ? (dP_Pa / L * 100) / 1000 : 0,
    steps: [
      `Стандарт: ${META.standard}; режим: ${mode}; dRel=${dRel}`,
      isLow
        ? `ΔP = 23200·dRel·L·Q^1.82/D^4.82 = ${(dP_Pa / 1000).toFixed(3)} кПа; P2=${(P2g / 1000).toFixed(3)} кПа изб.`
        : `P1²−P2² (Renouard quad.) → P2=${(P2g / 1000).toFixed(2)} кПа изб.; ΔP=${(dP_Pa / 1000).toFixed(2)} кПа`,
    ],
  };
}
