/* =========================================================================
   gas-methods/throughput.js — пропускная способность газопровода.
   Обратная задача: при заданных диаметре, длине и допустимом перепаде
   давления — максимальный расход (н.у.). λ зависит от Re(Q) → решаем
   итерацией с фиксированной точкой. Контракт calc-lib.
   ========================================================================= */

import {
  GAS_PROPS, gasDensityNormal, gasDensity, pipeArea, flowVelocity,
  reynolds, frictionFactor, ROUGHNESS, LOW_PRESSURE_LIMIT, P_ATM,
} from './formulas.js';

export const META = {
  id: 'gas-throughput',
  label: 'Пропускная способность газопровода',
  standard: 'СП 62.13330 (обратная задача)',
  region: 'RU',
  version: '1.0',
  enabled: true,
  discipline: 'gas',
  refs: ['СП 62.13330', 'обратная задача ΔP→Q', 'итерация λ(Re)'],
  inputs: [
    { key: 'D_mm',   label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',      label: 'Длина участка',   unit: 'м',    type: 'number', default: 200, required: true },
    { key: 'P1_kPa', label: 'Давл. в начале (изб.)', unit: 'кПа', type: 'number', default: 3 },
    { key: 'dP_allow_kPa', label: 'Доп. перепад ΔP', unit: 'кПа', type: 'number', default: 1, required: true },
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

/**
 * @param {object} input
 *   D_mm     — внутренний диаметр, мм
 *   L        — длина участка, м
 *   P1_kPa   — избыточное давление в начале, кПа (опц., 3)
 *   dP_allow_kPa — допустимый перепад давления, кПа (обяз.)
 *   gas      — ключ GAS_PROPS (опц., 'natural')
 *   relDensity, nu — переопределения (опц.)
 *   material — ключ ROUGHNESS (опц., 'steel_new')
 *   eps_mm   — переопределение шероховатости, мм (опц.)
 *   tC       — температура газа, °C (опц., 20)
 * @returns {object} { Q_max_m3h, v, Re, lambda, regime, iterations }
 */
export function compute(input = {}) {
  const D    = (Number(input.D_mm) || 0) / 1000;
  const L    = Number(input.L) || 0;
  const P1g  = Number.isFinite(+input.P1_kPa) ? (+input.P1_kPa) * 1000 : 3000;
  const dPa  = (Number(input.dP_allow_kPa) || 0) * 1000;
  const tC   = Number.isFinite(+input.tC) ? +input.tC : 20;
  const T    = tC + 273.15;
  const props = GAS_PROPS[input.gas] ?? GAS_PROPS.natural;
  const relD = Number.isFinite(+input.relDensity) ? +input.relDensity : props.d;
  const nu   = Number.isFinite(+input.nu) ? +input.nu : props.nu;
  const eps  = Number.isFinite(+input.eps_mm)
    ? (+input.eps_mm) / 1000
    : (ROUGHNESS[input.material] ?? ROUGHNESS.steel_new);

  const rhoN  = gasDensityNormal(relD);
  const P1abs = P_ATM + P1g;
  const isLow = P1g <= LOW_PRESSURE_LIMIT;
  const A     = pipeArea(D);

  // Стартовое λ-предположение (полностью турбулентный) + итерации.
  let lambda = 0.02, Qn = 0, v = 0, Re = 0, iter = 0;
  for (iter = 1; iter <= 40; iter++) {
    let Qact;
    if (isLow) {
      const rho = gasDensity(rhoN, P1abs, T);
      // ΔP = λ(L/D)·ρ·v²/2 ; v=Qact/A → Qact = A·sqrt(2·ΔP·D/(λ·L·ρ))
      Qact = (D > 0 && lambda > 0 && L > 0 && rho > 0)
        ? A * Math.sqrt(2 * dPa * D / (lambda * L * rho)) : 0;
      Qn = rho > 0 ? Qact * rho / rhoN : 0;
    } else {
      // P1²−P2² = 16λLρнPн Qн²/π²D⁵ → Qн = sqrt(dSq·π²D⁵/(16λLρнPн))
      const P2abs = Math.max(P1abs - dPa, 0);
      const dSq = P1abs * P1abs - P2abs * P2abs;
      Qn = (lambda > 0 && L > 0 && rhoN > 0)
        ? Math.sqrt(dSq * Math.PI * Math.PI * Math.pow(D, 5)
            / (16 * lambda * L * rhoN * P_ATM)) : 0;
      const rho = gasDensity(rhoN, P1abs, T);
      Qact = rho > 0 ? Qn * rhoN / rho : 0;
    }
    v  = flowVelocity(Qact, D);
    Re = reynolds(v, D, nu);
    const lambdaNew = frictionFactor(Re, eps, D) || lambda;
    if (Math.abs(lambdaNew - lambda) < 1e-7) { lambda = lambdaNew; break; }
    lambda = lambdaNew;
  }

  const flowRegime = Re <= 0 ? '—'
    : (Re < 2300 ? 'ламинарный' : (Re < 4000 ? 'переходный' : 'турбулентный'));

  return {
    method: META.id,
    inputs: { D_mm: input.D_mm, L, P1_kPa: P1g / 1000,
              dP_allow_kPa: dPa / 1000, gas: input.gas || 'natural',
              relDensity: relD, tC },
    regime: isLow ? 'низкое давление (≤5 кПа)' : 'среднее/высокое',
    flowRegime,
    rhoN,
    Q_max_m3h: Qn * 3600,
    Q_max_m3s: Qn,
    v, Re, lambda, iterations: iter,
    steps: [
      `Диаметр ${input.D_mm} мм, L=${L} м, доп. ΔP=${(dPa / 1000).toFixed(2)} кПа`,
      `Итераций λ: ${iter}; λ=${lambda.toFixed(5)}; Re=${Re.toFixed(0)} (${flowRegime})`,
      `Qmax = ${(Qn * 3600).toFixed(1)} м³/ч (н.у.); v=${v.toFixed(2)} м/с`,
    ],
  };
}
