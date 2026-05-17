/* =========================================================================
   hvac-methods/formulas.js — базовые ОВиК-примитивы (SI).
   Чистые функции, без DOM/состояния. Среда — влажный воздух.
   Единицы: температура t [°C], давление [Па], расход V̇ [м³/с] либо
   [м³/ч] (где отмечено), теплота Q [Вт], объём помещения V [м³].
   ========================================================================= */

export const R_AIR  = 287.058;       // удельная газовая пост. сухого возд., Дж/(кг·К)
export const CP_AIR = 1006;          // удельная теплоёмкость сухого возд., Дж/(кг·К)
export const CP_VAP = 1860;          // удельная теплоёмкость водяного пара, Дж/(кг·К)
export const P_ATM  = 101325;        // атм. давление, Па (уровень моря)

/** Плотность сухого воздуха ρ(t,P) = P/(R·T), кг/м³. P [Па], t [°C]. */
export function airDensity(tC = 20, P = P_ATM) {
  const T = (Number.isFinite(+tC) ? +tC : 20) + 273.15;
  const Pa = Number.isFinite(+P) ? +P : P_ATM;
  return Pa / (R_AIR * T);
}

/** Давление насыщенного пара es(t), Па (Magnus, для воздуха, −40..60 °C). */
export function satVaporPressure(tC = 20) {
  const t = Number.isFinite(+tC) ? +tC : 20;
  return 610.94 * Math.exp((17.625 * t) / (t + 243.04));
}

/** Влагосодержание w [кг/кг с.в.] по t [°C], φ [0..1], P [Па]. */
export function humidityRatio(tC = 20, rh = 0.5, P = P_ATM) {
  const phi = Math.min(Math.max(Number(rh) || 0, 0), 1);
  const pv = phi * satVaporPressure(tC);
  return 0.62198 * pv / Math.max(P - pv, 1);
}

/** Удельная теплоёмкость влажного воздуха, Дж/(кг·К). */
export function humidAirCp(w = 0) {
  return CP_AIR + CP_VAP * (Number(w) || 0);
}

/** Теплота парообразования воды hfg(t), Дж/кг (инж. аппрокс.). */
export function latentHeatVap(tC = 20) {
  const t = Number.isFinite(+tC) ? +tC : 20;
  return (2501 - 2.361 * t) * 1000;   // кДж/кг → Дж/кг
}

/** Энтальпия влажного воздуха h, Дж/кг с.в. t [°C], w [кг/кг]. */
export function moistAirEnthalpy(tC = 20, w = 0) {
  const t = Number.isFinite(+tC) ? +tC : 20;
  const W = Number(w) || 0;
  return (1.006 * t + W * (2501 + 1.86 * t)) * 1000;
}

/** Расход по кратности: V̇ = n·V, м³/ч. n [1/ч], V [м³]. */
export function flowFromACH(n, V) {
  return (Number(n) || 0) * (Number(V) || 0);
}

/** Кратность по расходу: n = V̇/V, 1/ч. V̇ [м³/ч], V [м³]. */
export function achFromFlow(flow_m3h, V) {
  const vol = Number(V) || 0;
  return vol > 0 ? (Number(flow_m3h) || 0) / vol : 0;
}

/** Расход воздуха для отвода явной теплоты, м³/с.
 *  V̇ = Q / (ρ·cp·ΔT). Q [Вт], ΔT [К]. */
export function airflowForSensible(Q, dT, rho, cp = CP_AIR) {
  const denom = (Number(rho) || 0) * (Number(cp) || CP_AIR) * (Number(dT) || 0);
  return denom !== 0 ? (Number(Q) || 0) / denom : 0;
}

/** Явная теплота, переносимая потоком: Q = ρ·cp·V̇·ΔT, Вт.
 *  V̇ [м³/с], ΔT [К]. */
export function sensibleHeat(flow_m3s, dT, rho, cp = CP_AIR) {
  return (Number(rho) || 0) * (Number(cp) || CP_AIR)
    * (Number(flow_m3s) || 0) * (Number(dT) || 0);
}

/** Скрытая теплота потока: Q = ρ·V̇·hfg·Δw, Вт. V̇ [м³/с], Δw [кг/кг]. */
export function latentHeat(flow_m3s, dW, rho, hfg) {
  return (Number(rho) || 0) * (Number(flow_m3s) || 0)
    * (Number(hfg) || latentHeatVap(20)) * (Number(dW) || 0);
}

/** Трансмиссионные потери/притоки через ограждение: Q = U·A·ΔT, Вт.
 *  U [Вт/(м²·К)], A [м²], ΔT [К]. */
export function transmissionHeat(U, A, dT) {
  return (Number(U) || 0) * (Number(A) || 0) * (Number(dT) || 0);
}

/** Типовая удельная теплоотдача человека (офис, 25 °C), Вт/чел. */
export const PERSON_HEAT = {
  sitting:  { sensible: 75,  latent: 55  },
  light:    { sensible: 75,  latent: 95  },
  moderate: { sensible: 90,  latent: 150 },
  heavy:    { sensible: 105, latent: 245 },
};

/** Минимальная норма наружного воздуха на человека, м³/ч (ориентир). */
export const FRESH_AIR_PER_PERSON = {
  office:    40,
  meeting:   40,
  retail:    20,
  serverless: 60,
};
