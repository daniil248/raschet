/* =========================================================================
   hvac-methods/heat-gain.js — теплопритоки помещения (летний режим).
   Сумма: трансмиссия через ограждения + солнечная радиация через
   остекление + люди + освещение + оборудование. Контракт calc-lib.
   ========================================================================= */

import {
  transmissionHeat, airDensity, humidAirCp, humidityRatio,
  airflowForSensible, PERSON_HEAT,
} from './formulas.js';

export const META = {
  id: 'heat-gain',
  label: 'Теплопритоки помещения',
  discipline: 'hvac',
  refs: ['СП 60.13330', 'ASHRAE Fundamentals', 'Q = ΣU·A·ΔT + Qсолн + Qлюди + Qосв + Qоб'],
};

/**
 * @param {object} input
 *   envelopes — [{ U, A, dT }] ограждения (опц., [])
 *   glazing   — [{ A, SHGC, I }] остекление: площадь, коэф. солн. фактора,
 *               интенсивность радиации Вт/м² (опц., [])
 *   persons   — число людей (опц., 0)
 *   activity  — ключ PERSON_HEAT ('sitting'…) (опц., 'sitting')
 *   lighting_W  — установл. мощность освещения, Вт (опц., 0)
 *   equipment_W — тепловыделение оборудования, Вт (опц., 0)
 *   t_room    — расчётная t помещения, °C (опц., 24)
 *   t_supply  — t приточного воздуха, °C (опц., 18)
 *   rh        — относит. влажность, 0..1 (опц., 0.5)
 * @returns {object} разбивка нагрузок + суммарная + потребный расход
 */
export function compute(input = {}) {
  const envelopes = Array.isArray(input.envelopes) ? input.envelopes : [];
  const glazing   = Array.isArray(input.glazing) ? input.glazing : [];
  const persons   = Number(input.persons) || 0;
  const act       = PERSON_HEAT[input.activity] ?? PERSON_HEAT.sitting;
  const lighting  = Number(input.lighting_W) || 0;
  const equipment = Number(input.equipment_W) || 0;
  const tRoom     = Number.isFinite(+input.t_room) ? +input.t_room : 24;
  const tSup      = Number.isFinite(+input.t_supply) ? +input.t_supply : 18;
  const rh        = Number.isFinite(+input.rh) ? +input.rh : 0.5;

  const q_envelope = envelopes.reduce(
    (s, e) => s + transmissionHeat(e.U, e.A, e.dT), 0);
  const q_solar = glazing.reduce(
    (s, g) => s + (Number(g.A) || 0) * (Number(g.SHGC) || 0) * (Number(g.I) || 0), 0);
  const q_people_sens = persons * act.sensible;
  const q_people_lat  = persons * act.latent;

  const q_sensible = q_envelope + q_solar + q_people_sens + lighting + equipment;
  const q_latent   = q_people_lat;
  const q_total    = q_sensible + q_latent;

  const dT  = tRoom - tSup;
  const rho = airDensity(tRoom, input.P);
  const cp  = humidAirCp(humidityRatio(tRoom, rh, input.P));
  const flow_m3h = dT > 0
    ? airflowForSensible(q_sensible, dT, rho, cp) * 3600
    : 0;

  return {
    method: META.id,
    inputs: { persons, activity: input.activity || 'sitting',
              lighting_W: lighting, equipment_W: equipment,
              t_room: tRoom, t_supply: tSup },
    q_envelope_W: q_envelope,
    q_solar_W: q_solar,
    q_people_sensible_W: q_people_sens,
    q_people_latent_W: q_people_lat,
    q_lighting_W: lighting,
    q_equipment_W: equipment,
    q_sensible_W: q_sensible,
    q_latent_W: q_latent,
    q_total_W: q_total,
    q_total_kW: q_total / 1000,
    rho, cp,
    flow_required_m3h: flow_m3h,
    steps: [
      `Трансмиссия ΣU·A·ΔT = ${q_envelope.toFixed(0)} Вт`,
      `Солнце ΣA·SHGC·I = ${q_solar.toFixed(0)} Вт`,
      `Люди ${persons}: явн. ${q_people_sens.toFixed(0)} + скрыт. ${q_people_lat.toFixed(0)} Вт`,
      `Освещение ${lighting.toFixed(0)} + оборуд. ${equipment.toFixed(0)} Вт`,
      `Σ явн. ${q_sensible.toFixed(0)} + Σ скрыт. ${q_latent.toFixed(0)} = ${q_total.toFixed(0)} Вт (${(q_total / 1000).toFixed(2)} кВт)`,
      dT > 0
        ? `Расход по явной: V̇ = ${q_sensible.toFixed(0)}/(${rho.toFixed(3)}·${cp.toFixed(0)}·${dT.toFixed(1)}) = ${flow_m3h.toFixed(0)} м³/ч`
        : `Расход: ΔT≤0 — приток теплее помещения, охлаждение потоком невозможно`,
    ],
  };
}
