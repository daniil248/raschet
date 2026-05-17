/* =========================================================================
   gas-methods/pressure-drop.js — потери давления в газопроводе.
   Авто-выбор режима по входному избыточному давлению:
     ≤5 кПа изб. → низкое давление (ρ≈const, ΔP линейная);
     >5 кПа изб. → среднее/высокое (изотермич. сжимаемое, P1²−P2²).
   Контракт calc-lib: { META, compute(input) }.
   ========================================================================= */

import {
  GAS_PROPS, gasDensityNormal, gasDensity, pipeArea, flowVelocity,
  reynolds, frictionFactor, dpLowPressure, dpSquaredMediumPressure,
  ROUGHNESS, LOW_PRESSURE_LIMIT, P_ATM,
} from './formulas.js';

export const META = {
  id: 'gas-pressure-drop',
  // D4 (v0.60.587): обособлено по стандарту. id сохранён для
  // обратной совместимости сохранённых node.disciplineParams.
  label: 'Потери давления — СП 42-101 / СП 62.13330',
  standard: 'СП 42-101-2003 / СП 62.13330',
  region: 'RU',
  version: '1.0',
  enabled: true,
  discipline: 'gas',
  refs: ['СП 62.13330', 'СП 42-101-2003', 'Colebrook–White / Swamee–Jain'],
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

/**
 * @param {object} input
 *   Q        — расход при н.у., м³/ч
 *   D_mm     — внутренний диаметр, мм
 *   L        — длина участка, м
 *   P1_kPa   — избыточное давление в начале, кПа (опц., 3)
 *   gas      — ключ GAS_PROPS ('natural'…) (опц., 'natural')
 *   relDensity — переопределение отн. плотности к воздуху (опц.)
 *   nu       — переопределение кин. вязкости, м²/с (опц.)
 *   material — ключ ROUGHNESS ('steel_new'…) (опц., 'steel_new')
 *   eps_mm   — переопределение шероховатости, мм (опц.)
 *   tC       — температура газа, °C (опц., 20)
 * @returns {object} { regime, dP_Pa|P2_kPa, v, Re, lambda, ... }
 */
export function compute(input = {}) {
  const Qn   = (Number(input.Q) || 0) / 3600;          // м³/с при н.у.
  const D    = (Number(input.D_mm) || 0) / 1000;       // м
  const L    = Number(input.L) || 0;
  const P1g  = Number.isFinite(+input.P1_kPa) ? (+input.P1_kPa) * 1000 : 3000; // Па изб.
  const tC   = Number.isFinite(+input.tC) ? +input.tC : 20;
  const T    = tC + 273.15;
  const props = GAS_PROPS[input.gas] ?? GAS_PROPS.natural;
  const relD = Number.isFinite(+input.relDensity) ? +input.relDensity : props.d;
  const nu   = Number.isFinite(+input.nu) ? +input.nu : props.nu;
  const eps  = Number.isFinite(+input.eps_mm)
    ? (+input.eps_mm) / 1000
    : (ROUGHNESS[input.material] ?? ROUGHNESS.steel_new);

  const rhoN = gasDensityNormal(relD);
  const P1abs = P_ATM + P1g;
  const isLow = P1g <= LOW_PRESSURE_LIMIT;

  // средняя плотность/скорость считаем по давлению начала участка
  const rho = gasDensity(rhoN, P1abs, T);
  const Qact = rhoN > 0 ? Qn * rhoN / rho : 0;          // приведение к рабочим
  const v   = flowVelocity(Qact, D);
  const Re  = reynolds(v, D, nu);
  const lambda = frictionFactor(Re, eps, D);

  let dP_Pa, P2g, P2abs;
  if (isLow) {
    dP_Pa = dpLowPressure(lambda, L, D, rho, v);
    P2abs = P1abs - dP_Pa;
    P2g   = P2abs - P_ATM;
  } else {
    const dSq = dpSquaredMediumPressure(lambda, L, D, rhoN, Qn);
    const P2sq = Math.max(P1abs * P1abs - dSq, 0);
    P2abs = Math.sqrt(P2sq);
    P2g   = P2abs - P_ATM;
    dP_Pa = P1abs - P2abs;
  }

  const regime = isLow ? 'низкое давление (≤5 кПа)'
    : 'среднее/высокое (изотерм. сжимаемое)';
  const flowRegime = Re <= 0 ? '—'
    : (Re < 2300 ? 'ламинарный' : (Re < 4000 ? 'переходный' : 'турбулентный'));

  return {
    method: META.id,
    inputs: { Q_m3h: input.Q, D_mm: input.D_mm, L, P1_kPa: P1g / 1000,
              gas: input.gas || 'natural', relDensity: relD, tC,
              eps_mm: eps * 1000 },
    regime, flowRegime,
    rhoN, rho, area_m2: pipeArea(D),
    v, Re, lambda,
    dP_Pa, dP_kPa: dP_Pa / 1000,
    P1_kPa: P1g / 1000,
    P2_kPa: P2g / 1000,
    dP_per_100m_kPa: L > 0 ? (dP_Pa / L * 100) / 1000 : 0,
    steps: [
      `Режим: ${regime}; ρн=${rhoN.toFixed(4)}, ρраб=${rho.toFixed(4)} кг/м³`,
      `v=${v.toFixed(3)} м/с; Re=${Re.toFixed(0)} (${flowRegime}); λ=${lambda.toFixed(5)}`,
      isLow
        ? `ΔP=λ(L/D)ρv²/2 = ${(dP_Pa / 1000).toFixed(3)} кПа; P2=${(P2g / 1000).toFixed(3)} кПа изб.`
        : `P1²−P2²=16λLρнPнQн²/π²D⁵ → P2=${(P2g / 1000).toFixed(2)} кПа изб.; ΔP=${(dP_Pa / 1000).toFixed(2)} кПа`,
    ],
  };
}
