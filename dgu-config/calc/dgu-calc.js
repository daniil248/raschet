// =============================================================================
// dgu-config/calc/dgu-calc.js — расчётный слой ДГУ
// =============================================================================
// Phase 30.3 (v0.60.70): По требованию Пользователя 2026-05-03 «надеюсь ты уже
// проработал план интеграции модуля Технолог ЦОД с модулями климата, подбора
// холода, подбора ИБП, ДГУ, расчёт PUE».
//
// Pure JS, no DOM. Расчёт мощности ДГУ с учётом:
//   - Mode (ESP / PRP / COP) — допустимая нагрузка по ISO 8528-1
//   - Climate derate (altitude / ambient T / humidity) по ISO 3046-1
//   - Резервирование (N / N+1 / 2N)
//   - Расход топлива (л/кВт·ч)
//   - Объём топливного бака (часы автономности × расход)

/**
 * Допустимая загрузка генератора по режиму ISO 8528-1.
 *
 * - ESP (Emergency Standby Power): аварийный — до 100% nameplate в течение
 *   ограниченного времени (типично ≤ 200 ч/год, ≤ 25 ч непрерывно).
 *   Без перегрузки. Default load factor для расчёта = 1.0.
 *
 * - PRP (Prime Power): постоянный с переменной нагрузкой. До 100% peak,
 *   средняя нагрузка ≤ 70% от nameplate. Default load factor = 0.70.
 *
 * - COP (Continuous Operating Power): постоянный 24/7 при постоянной
 *   нагрузке. До 70-80% nameplate. Default load factor = 0.70.
 */
export const DGU_MODES = {
  ESP: { label: 'ESP — аварийный standby', maxLoadFactor: 1.0,  isoStandard: 'ISO 8528-1', notes: 'До 200 ч/год, до 25 ч непрерывно. Без перегрузки.' },
  PRP: { label: 'PRP — основной (с переменной нагрузкой)', maxLoadFactor: 0.70, isoStandard: 'ISO 8528-1', notes: 'Постоянный режим. Средняя нагрузка ≤ 70% от nameplate.' },
  COP: { label: 'COP — постоянный 24/7', maxLoadFactor: 0.70, isoStandard: 'ISO 8528-1', notes: 'Базовая мощность. До 70-80% nameplate continuous.' },
};

/**
 * Climate derate по ISO 3046-1.
 * Возвращает множитель допустимой мощности (1.0 = без derate).
 *
 * Формула (упрощённая):
 *   derate = 1 − (altitude_m − 100)/100 × 0.03   (3% за каждые 300м над 100м)
 *          − (T_amb − 25)/5      × 0.025         (2.5% за каждые 5°C выше 25°C)
 *          − (RH − 60)/25        × 0.01          (1% за каждые 25% выше 60% RH)
 *
 * @param {object} climate — { altitudeM, ambientTC, humidityPct }
 * @returns {{ multiplier:number, breakdown:object }}
 */
export function calcClimateDerate(climate = {}) {
  const altM = Number(climate.altitudeM) || 0;
  const tAmb = Number(climate.ambientTC) || 25;
  const rh = Number(climate.humidityPct) || 60;

  // Altitude derate: −3% per 300m выше 100м
  const altDerate = altM > 100 ? Math.max(0, (altM - 100) / 100) * 0.01 : 0;
  // Temperature derate: −2.5% per 5°C выше 25°C
  const tDerate = tAmb > 25 ? (tAmb - 25) / 5 * 0.025 : 0;
  // Humidity derate: −1% per 25% выше 60% RH
  const rhDerate = rh > 60 ? (rh - 60) / 25 * 0.01 : 0;

  const totalDerate = altDerate + tDerate + rhDerate;
  const multiplier = Math.max(0.5, 1 - totalDerate);

  return {
    multiplier,
    breakdown: {
      altDerate: -(altDerate * 100), // в процентах (отрицательное = снижение)
      tDerate: -(tDerate * 100),
      rhDerate: -(rhDerate * 100),
      totalDerate: -(totalDerate * 100),
    },
  };
}

/**
 * Расчёт необходимой мощности ДГУ.
 *
 * @param {object} input — {
 *   loadKw,           — суммарная электрическая нагрузка (IT + cooling + ups_loss + aux)
 *   mode,             — 'ESP' | 'PRP' | 'COP'
 *   redundancy,       — 'N' | 'N+1' | '2N'
 *   climate,          — { altitudeM, ambientTC, humidityPct }
 *   safetyMarginPct,  — % запаса (default 15%)
 * }
 * @returns {{
 *   loadKw, modeLabel, maxLoadFactor, derate,
 *   requiredKw,         — после derate + load factor
 *   nameplateKw,        — номинал ДГУ для заказа (с margin)
 *   redundancyMode, qty, totalNameplateKw
 * }}
 */
export function calcDguRequired(input) {
  const loadKw = Number(input.loadKw) || 0;
  const mode = input.mode || 'ESP';
  const modeMeta = DGU_MODES[mode] || DGU_MODES.ESP;
  const margin = Number(input.safetyMarginPct) || 15;
  const redundancy = input.redundancy || 'N';
  // v0.60.78 fix (Пользователь 2026-05-03 «где дирейтинги???»): climate
  // приходил как nested object input.climate, но UI передаёт ПЛОСКИЕ поля
  // input.altitudeM/ambientTC/humidityPct. Поддерживаем оба варианта:
  // если nested — используем как раньше, иначе собираем из плоских.
  const climateArg = input.climate
    ? input.climate
    : { altitudeM: input.altitudeM, ambientTC: input.ambientTC, humidityPct: input.humidityPct };
  const derate = calcClimateDerate(climateArg);

  // Базовая требуемая = loadKw × (1 + margin) / loadFactor / derateMultiplier
  const baseRequired = loadKw * (1 + margin / 100) / modeMeta.maxLoadFactor / derate.multiplier;

  // Кол-во единиц по резервированию
  let qty = 1;
  if (redundancy === 'N+1') qty = 2;
  else if (redundancy === '2N') qty = 2;

  // Если 2N — каждая единица должна нести 100% нагрузки (полное дублирование).
  // Если N+1 — каждая несёт baseRequired / N (где N = qty − 1 = 1).
  const perUnitNameplateKw = redundancy === '2N' ? baseRequired : baseRequired;
  const totalNameplateKw = perUnitNameplateKw * qty;

  return {
    loadKw,
    modeLabel: modeMeta.label,
    maxLoadFactor: modeMeta.maxLoadFactor,
    derate,
    requiredKw: Math.ceil(baseRequired),
    nameplateKw: Math.ceil(perUnitNameplateKw),
    redundancyMode: redundancy,
    qty,
    totalNameplateKw: Math.ceil(totalNameplateKw),
  };
}

/**
 * Расчёт расхода топлива и объёма бака.
 *
 * Specific fuel consumption (л/кВт·ч):
 *   — 100% nameplate: ~0.22 (Tier 4 inverter genset до 0.20)
 *   — 75%: ~0.24
 *   — 50%: ~0.27
 *   — 25%: ~0.34
 *
 * @param {object} input — { nameplateKw, loadKw, autonomyHours, sfcLkWh? }
 * @returns {{ sfc:number, hourlyL:number, totalL:number, tankSafetyL:number }}
 */
export function calcFuelConsumption(input) {
  const nameplateKw = Number(input.nameplateKw) || 0;
  const loadKw = Number(input.loadKw) || nameplateKw;
  const autonomy = Number(input.autonomyHours) || 8;
  // Load fraction (для интерполяции SFC).
  const loadFrac = nameplateKw > 0 ? loadKw / nameplateKw : 1;

  // Специфический расход (л/кВт·ч), интерполируем по таблице
  let sfc;
  if (input.sfcLkWh) {
    sfc = Number(input.sfcLkWh);
  } else if (loadFrac >= 0.95) sfc = 0.22;
  else if (loadFrac >= 0.70) sfc = 0.22 + (0.95 - loadFrac) / 0.25 * 0.02; // 0.22→0.24
  else if (loadFrac >= 0.45) sfc = 0.24 + (0.70 - loadFrac) / 0.25 * 0.03; // 0.24→0.27
  else                        sfc = 0.27 + Math.max(0, 0.45 - loadFrac) / 0.25 * 0.07; // 0.27→0.34

  const hourlyL = loadKw * sfc;        // л/час
  const totalL = hourlyL * autonomy;
  const tankSafetyL = Math.ceil(totalL * 1.10);  // 10% запас бака

  return {
    sfc: Math.round(sfc * 1000) / 1000,
    hourlyL: Math.round(hourlyL * 10) / 10,
    totalL: Math.round(totalL),
    tankSafetyL,
  };
}

/**
 * Полный расчёт: спецификация ДГУ + топливо.
 *
 * @param {object} input — все параметры из UI
 * @returns {{ spec, fuel }}
 */
export function calcDgu(input) {
  const spec = calcDguRequired(input);
  const fuel = calcFuelConsumption({
    nameplateKw: spec.nameplateKw,
    loadKw: input.loadKw,
    autonomyHours: input.autonomyHours,
    sfcLkWh: input.sfcLkWh,
  });
  return { spec, fuel };
}
