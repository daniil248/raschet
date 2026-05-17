/* =========================================================================
   gas-methods/pressure-drop-weymouth.js — потери давления по уравнению
   Weymouth (магистральные/высоконапорные газопроводы, US-практика).
   D4: обособленная методика-стандарт, выбирается пользователем.
   Weymouth задаёт коэф. трения λ = 0.009407/D^(1/3); подставляется
   в строгую изотермическую модель (P1²−P2²) либо линейную (низкое P).
   ========================================================================= */

import {
  GAS_PROPS, gasDensityNormal, gasDensity, pipeArea, flowVelocity,
  weymouthFriction, dpLowPressure, dpSquaredMediumPressure,
  LOW_PRESSURE_LIMIT, P_ATM,
} from './formulas.js';

export const META = {
  id: 'gas-dp-weymouth',
  label: 'Потери давления — Weymouth',
  standard: 'Weymouth (магистральные газопроводы)',
  discipline: 'gas',
  refs: ['Weymouth equation', 'λ = 0.009407 / D^(1/3)', 'изотерм. сжимаемое'],
  inputs: [
    { key: 'Q',      label: 'Расход (н.у.)',   unit: 'м³/ч', type: 'number', default: 5000, required: true },
    { key: 'D_mm',   label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 300, required: true },
    { key: 'L',      label: 'Длина участка',   unit: 'м',    type: 'number', default: 5000, required: true },
    { key: 'P1_kPa', label: 'Давл. в начале (изб.)', unit: 'кПа', type: 'number', default: 600 },
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
  const Qn   = (Number(input.Q) || 0) / 3600;       // м³/с н.у.
  const D    = (Number(input.D_mm) || 0) / 1000;    // м
  const L    = Number(input.L) || 0;
  const P1g  = Number.isFinite(+input.P1_kPa) ? (+input.P1_kPa) * 1000 : 600000;
  const tC   = Number.isFinite(+input.tC) ? +input.tC : 20;
  const T    = tC + 273.15;
  const props = GAS_PROPS[input.gas] ?? GAS_PROPS.natural;
  const dRel = Number.isFinite(+input.relDensity) ? +input.relDensity : props.d;

  const rhoN  = gasDensityNormal(dRel);
  const P1abs = P_ATM + P1g;
  const isLow = P1g <= LOW_PRESSURE_LIMIT;
  const lambda = weymouthFriction(D);

  const rho  = gasDensity(rhoN, P1abs, T);
  const Qact = rhoN > 0 ? Qn * rhoN / rho : 0;
  const v    = flowVelocity(Qact, D);

  let dP_Pa, P2g, P2abs;
  if (isLow) {
    dP_Pa = dpLowPressure(lambda, L, D, rho, v);
    P2abs = P1abs - dP_Pa;
    P2g   = P2abs - P_ATM;
  } else {
    const dSq  = dpSquaredMediumPressure(lambda, L, D, rhoN, Qn);
    const P2sq = Math.max(P1abs * P1abs - dSq, 0);
    P2abs = Math.sqrt(P2sq);
    P2g   = P2abs - P_ATM;
    dP_Pa = P1abs - P2abs;
  }

  return {
    method: META.id, standard: META.standard,
    inputs: { Q_m3h: input.Q, D_mm: input.D_mm, L, P1_kPa: P1g / 1000,
              gas: input.gas || 'natural', relDensity: dRel, tC },
    regime: isLow ? 'низкое давление (линейная)' : 'среднее/высокое (изотерм.)',
    rhoN, rho, area_m2: pipeArea(D), v, lambda,
    dP_Pa, dP_kPa: dP_Pa / 1000,
    P1_kPa: P1g / 1000, P2_kPa: P2g / 1000,
    dP_per_100m_kPa: L > 0 ? (dP_Pa / L * 100) / 1000 : 0,
    steps: [
      `Стандарт: Weymouth; λ=0.009407/D^(1/3)=${lambda.toFixed(5)} (D=${D.toFixed(4)} м)`,
      `ρн=${rhoN.toFixed(4)}, ρраб=${rho.toFixed(4)} кг/м³; v=${v.toFixed(3)} м/с`,
      isLow
        ? `ΔP=λ(L/D)ρv²/2 = ${(dP_Pa / 1000).toFixed(3)} кПа; P2=${(P2g / 1000).toFixed(3)} кПа изб.`
        : `P1²−P2²=16λLρнPнQн²/π²D⁵ → P2=${(P2g / 1000).toFixed(2)} кПа изб.; ΔP=${(dP_Pa / 1000).toFixed(2)} кПа`,
    ],
  };
}
