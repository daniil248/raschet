/* =========================================================================
   hvac-methods/air-balance.js — воздухообмен помещения.
   Требуемый расход = max(по кратности, по отводу явной теплоты,
   по санитарной норме наружного воздуха). Контракт calc-lib.
   ========================================================================= */

import {
  airDensity, humidityRatio, humidAirCp, flowFromACH, achFromFlow,
  airflowForSensible, FRESH_AIR_PER_PERSON,
} from './formulas.js';

export const META = {
  id: 'air-balance',
  label: 'Воздухообмен — СП 60.13330 / ASHRAE 62.1',
  standard: 'СП 60.13330 / ASHRAE 62.1',
  region: 'INT',
  version: '1.0',
  enabled: true,
  discipline: 'hvac',
  refs: ['СП 60.13330', 'ASHRAE 62.1', 'V̇ = max(n·V, Q/ρcpΔT, норма·N)'],
  inputs: [
    { key: 'V_room',   label: 'Объём помещения', unit: 'м³',   type: 'number', default: 120, required: true },
    { key: 'ach',      label: 'Нормат. кратность', unit: '1/ч', type: 'number', default: 2 },
    { key: 'Q_sens',   label: 'Явная нагрузка',  unit: 'Вт',   type: 'number', default: 3000 },
    { key: 't_supply', label: 'Темп. приточн.',  unit: '°C',   type: 'number', default: 18 },
    { key: 't_room',   label: 'Темп. помещения', unit: '°C',   type: 'number', default: 24 },
    { key: 'persons',  label: 'Число людей',     unit: 'чел',  type: 'number', default: 0 },
    { key: 'freshType', label: 'Норма наружн.',  unit: '',     type: 'select', default: 'office',
      options: [
        { value: 'office', label: 'Офис (40)' },
        { value: 'meeting', label: 'Переговорная (40)' },
        { value: 'retail', label: 'Торговля (20)' },
        { value: 'serverless', label: 'Серверная (60)' },
      ] },
  ],
};

/**
 * @param {object} input
 *   V_room    — объём помещения, м³
 *   ach       — нормативная кратность, 1/ч (опц., 0)
 *   Q_sens    — явная тепловая нагрузка к отводу, Вт (опц., 0)
 *   t_supply  — температура приточного воздуха, °C (опц., 18)
 *   t_room    — расчётная температура помещения, °C (опц., 24)
 *   persons   — число людей (опц., 0)
 *   freshType — ключ FRESH_AIR_PER_PERSON ('office'…) (опц., 'office')
 *   freshPerPerson — переопределение нормы, м³/ч·чел (опц.)
 *   P         — давление, Па (опц., атм.)
 *   rh        — относит. влажность, 0..1 (опц., 0.5)
 * @returns {object} требуемые расходы по каждому критерию + итог
 */
export function compute(input = {}) {
  const V_room = Number(input.V_room) || 0;
  const ach    = Number(input.ach) || 0;
  const Q_sens = Number(input.Q_sens) || 0;
  const tSup   = Number.isFinite(+input.t_supply) ? +input.t_supply : 18;
  const tRoom  = Number.isFinite(+input.t_room) ? +input.t_room : 24;
  const persons = Number(input.persons) || 0;
  const P      = Number.isFinite(+input.P) ? +input.P : undefined;
  const rh     = Number.isFinite(+input.rh) ? +input.rh : 0.5;
  const freshNorm = Number.isFinite(+input.freshPerPerson)
    ? +input.freshPerPerson
    : (FRESH_AIR_PER_PERSON[input.freshType] ?? FRESH_AIR_PER_PERSON.office);

  const dT  = tRoom - tSup;                       // К, нагрев приточного
  const rho = airDensity(tRoom, P);
  const w   = humidityRatio(tRoom, rh, P);
  const cp  = humidAirCp(w);

  const flow_ach   = flowFromACH(ach, V_room);    // м³/ч
  const flow_sens  = dT > 0
    ? airflowForSensible(Q_sens, dT, rho, cp) * 3600   // м³/с → м³/ч
    : 0;
  const flow_fresh = persons * freshNorm;         // м³/ч

  const flow_req = Math.max(flow_ach, flow_sens, flow_fresh);
  const driver = flow_req === 0 ? '—'
    : flow_req === flow_sens ? 'отвод явной теплоты'
    : flow_req === flow_ach  ? 'нормативная кратность'
    : 'санитарная норма';

  return {
    method: META.id,
    inputs: { V_room, ach, Q_sens, t_supply: tSup, t_room: tRoom,
              persons, freshPerPerson: freshNorm },
    rho, cp, w,
    flow_ach_m3h:   flow_ach,
    flow_sens_m3h:  flow_sens,
    flow_fresh_m3h: flow_fresh,
    flow_required_m3h: flow_req,
    flow_required_m3s: flow_req / 3600,
    ach_resulting: achFromFlow(flow_req, V_room),
    driver,
    steps: [
      `По кратности: V̇ = n·V = ${ach}·${V_room} = ${flow_ach.toFixed(0)} м³/ч`,
      dT > 0
        ? `По теплоте: V̇ = Q/(ρ·cp·ΔT) = ${Q_sens}/(${rho.toFixed(3)}·${cp.toFixed(0)}·${dT.toFixed(1)}) = ${flow_sens.toFixed(0)} м³/ч`
        : `По теплоте: ΔT≤0 (tпом ${tRoom}°C ≤ tприт ${tSup}°C) — нагрев недопустим`,
      `По норме: ${persons} чел × ${freshNorm} = ${flow_fresh.toFixed(0)} м³/ч`,
      `Итог: max = ${flow_req.toFixed(0)} м³/ч (определяет: ${driver}); кратность ${achFromFlow(flow_req, V_room).toFixed(2)} 1/ч`,
    ],
  };
}
