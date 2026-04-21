/* =========================================================================
   psychrometrics-core.js — moist-air thermodynamics.
   Follows ASHRAE Fundamentals 2021, Chapter 1.

   All SI: temperatures °C, pressure Pa, humidity ratio kg/kg_da,
   enthalpy kJ/kg_da, density kg/m³.

   Hyland–Wexler (1983) saturation-pressure formulation:
     over liquid water (T >= 0°C):
       ln(Pws) = C8/T + C9 + C10·T + C11·T² + C12·T³ + C13·ln(T)
     over ice (T < 0°C):
       ln(Pws) = C1/T + C2 + C3·T + C4·T² + C5·T³ + C6·T⁴ + C7·ln(T)
     where T is in K, Pws in Pa.
   ========================================================================= */

export const T0 = 273.15;

/* --- Барометрическое давление на высоте h (м).
   ISA / ГОСТ 4401-81: P(h) = P0·(1 − 2.25577·10⁻⁵·h)^5.2559,  P0 = 101325 Па. */
export function pressureAtAltitude(h_m, P0 = 101325) {
  return P0 * Math.pow(1 - 2.25577e-5 * Math.max(0, h_m || 0), 5.2559);
}

/* --- Нормальная плотность воздуха (20 °C, 101 325 Па, W=0) ≈ 1.2041 кг/м³.
   Используется для Vn = V · (ρ / ρN) — приведение к нормальным условиям. */
export const RHO_NORMAL = 1.2041;

/* --- Тепловая мощность процесса воздухообмена (кВт).
   Q = m_da · Δh,  где m_da = V · ρ_da / 3600 (кг/с), Δh в кДж/кг_да.
   Для смешанной (humid) энтальпии это полная тепловая нагрузка. */
export function processPowerKW(st1, st2, V_m3h) {
  if (!(V_m3h > 0)) return 0;
  const rho = st1.rho || 1.2;          // кг/м³ на входе
  const m_da_s = (V_m3h * rho) / 3600 / (1 + (st1.W || 0));  // кг_да/с
  return m_da_s * ((st2.h || 0) - (st1.h || 0));
}

/* --- Влагоприток процесса (кг/ч):
   qw = m_da (кг/ч) · ΔW (кг/кг) */
export function processMoistureKgH(st1, st2, V_m3h) {
  if (!(V_m3h > 0)) return 0;
  const rho = st1.rho || 1.2;
  const m_da_h = (V_m3h * rho) / (1 + (st1.W || 0));  // кг_да/ч
  return m_da_h * ((st2.W || 0) - (st1.W || 0));
}

// --- Saturation pressure of water (Pa) ---
export function Pws(T_C) {
  const T = T_C + T0;
  if (T_C >= 0) {
    // over liquid water
    const C8  = -5.8002206e3;
    const C9  =  1.3914993;
    const C10 = -4.8640239e-2;
    const C11 =  4.1764768e-5;
    const C12 = -1.4452093e-8;
    const C13 =  6.5459673;
    return Math.exp(C8 / T + C9 + C10 * T + C11 * T * T + C12 * T ** 3 + C13 * Math.log(T));
  } else {
    // over ice
    const C1 = -5.6745359e3;
    const C2 =  6.3925247;
    const C3 = -9.6778430e-3;
    const C4 =  6.2215701e-7;
    const C5 =  2.0747825e-9;
    const C6 = -9.4840240e-13;
    const C7 =  4.1635019;
    return Math.exp(
      C1 / T + C2 + C3 * T + C4 * T * T + C5 * T ** 3 + C6 * T ** 4 + C7 * Math.log(T),
    );
  }
}

// Partial pressure of water vapor (Pa) from RH[0..1]
export function Pw(T_C, RH) { return RH * Pws(T_C); }

// Humidity ratio (kg_v / kg_da) given T, RH, P
export function humidityRatio(T_C, RH, P = 101325) {
  const pw = Pw(T_C, RH);
  return 0.621945 * pw / (P - pw);
}

// RH from T, W, P
export function RHfromW(T_C, W, P = 101325) {
  const pw = W * P / (0.621945 + W);
  return pw / Pws(T_C);
}

// Enthalpy of moist air (kJ/kg_da) at T_C and W
export function enthalpy(T_C, W) {
  return 1.006 * T_C + W * (2501 + 1.86 * T_C);
}

// T from h and W (inverse of enthalpy)
export function TfromHW(h, W) {
  return (h - 2501 * W) / (1.006 + 1.86 * W);
}

// Specific volume of moist air (m³/kg_da)
export function specificVolume(T_C, W, P = 101325) {
  const Ra = 287.055;   // J/(kg·K)
  return Ra * (T_C + T0) * (1 + 1.6078 * W) / P;
}

// Density of moist air (kg/m³)
export function density(T_C, W, P = 101325) {
  return (1 + W) / specificVolume(T_C, W, P);
}

// Dew-point temperature — invert Pws(Td) = Pw
export function dewPoint(T_C, RH, P = 101325) {
  const pw = Pw(T_C, RH);
  return PwsInverse(pw);
}
export function dewPointFromW(W, P = 101325) {
  const pw = W * P / (0.621945 + W);
  return PwsInverse(pw);
}
function PwsInverse(pwsTarget) {
  // Newton iteration (good initial guess ~Magnus)
  const lnP = Math.log(Math.max(1e-3, pwsTarget));
  let T = (237.3 * (lnP - Math.log(611.2))) / (17.27 - (lnP - Math.log(611.2))); // Magnus init
  for (let i = 0; i < 40; i++) {
    const f = Math.log(Pws(T)) - lnP;
    const dT = 0.01;
    const dfdT = (Math.log(Pws(T + dT)) - Math.log(Pws(T - dT))) / (2 * dT);
    const step = f / dfdT;
    T -= step;
    if (Math.abs(step) < 1e-4) break;
  }
  return T;
}

// Wet-bulb — iteratively solve psychrometric equation:
//   W = ((2501 - 2.326·Twb)·Ws(Twb) - 1.006·(T - Twb)) / (2501 + 1.86·T - 4.186·Twb)
export function wetBulb(T_C, RH, P = 101325) {
  const W = humidityRatio(T_C, RH, P);
  let Twb = T_C - 5;   // initial guess
  for (let i = 0; i < 80; i++) {
    const Ws = 0.621945 * Pws(Twb) / (P - Pws(Twb));
    const num = (2501 - 2.326 * Twb) * Ws - 1.006 * (T_C - Twb);
    const den = 2501 + 1.86 * T_C - 4.186 * Twb;
    const f = num / den - W;
    const dT = 0.01;
    const Ws2 = 0.621945 * Pws(Twb + dT) / (P - Pws(Twb + dT));
    const num2 = (2501 - 2.326 * (Twb + dT)) * Ws2 - 1.006 * (T_C - (Twb + dT));
    const den2 = 2501 + 1.86 * T_C - 4.186 * (Twb + dT);
    const df = (num2 / den2 - W - f) / dT;
    const step = f / df;
    Twb -= step;
    if (Math.abs(step) < 1e-4) break;
  }
  return Twb;
}

/* --- Canonical state from (T, RH, P) --- */
export function state(T_C, RH, P = 101325) {
  const W  = humidityRatio(T_C, RH, P);
  const h  = enthalpy(T_C, W);
  const Td = dewPointFromW(W, P);
  const Twb = wetBulb(T_C, RH, P);
  const v  = specificVolume(T_C, W, P);
  const rho = density(T_C, W, P);
  return {
    T: +T_C.toFixed(2), RH: +(RH * 100).toFixed(1), W: +W.toFixed(5),
    h: +h.toFixed(2), Td: +Td.toFixed(2), Twb: +Twb.toFixed(2),
    v: +v.toFixed(4), rho: +rho.toFixed(4), P,
  };
}

/* --- HVAC processes: return new state --- */

// Sensible cooling/heating at constant W (no condensation yet)
export function heat(st, dT) {
  const Tn = st.T + dT;
  return state(Tn, RHfromW(Tn, st.W, st.P), st.P);
}

// Cooling with possible dehumidification — cool to surface temperature T_coil
// with a bypass factor BF (0 = ideal, 1 = no contact).
export function coolDehumidify(st, T_coil, BF = 0.15) {
  const Pws_c = Pws(T_coil);
  const W_coil = 0.621945 * Pws_c / (st.P - Pws_c);
  if (st.W <= W_coil) {
    // dry cooling
    return heat(st, T_coil - st.T);
  }
  const W_out = BF * st.W + (1 - BF) * W_coil;
  const T_out = BF * st.T + (1 - BF) * T_coil;
  return state(T_out, RHfromW(T_out, W_out, st.P), st.P);
}

// Adiabatic mixing of two streams (mass flow m1, m2 in kg_da/s)
export function mix(st1, m1, st2, m2) {
  const m = m1 + m2;
  const W = (m1 * st1.W + m2 * st2.W) / m;
  const h = (m1 * st1.h + m2 * st2.h) / m;
  const T = TfromHW(h, W);
  return state(T, RHfromW(T, W, st1.P), st1.P);
}

// Humidification (adiabatic, water spray) — increase W at constant h
export function humidifyAdiabatic(st, W_new) {
  if (W_new <= st.W) return st;
  const h = st.h;
  const T = TfromHW(h, W_new);
  return state(T, RHfromW(T, W_new, st.P), st.P);
}

// Steam humidification — add W with some superheat (simplified: constant T)
export function humidifySteam(st, W_new) {
  if (W_new <= st.W) return st;
  return state(st.T, RHfromW(st.T, W_new, st.P), st.P);
}
