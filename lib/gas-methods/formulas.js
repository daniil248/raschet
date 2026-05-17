/* =========================================================================
   gas-methods/formulas.js — базовые газодинамические примитивы (SI).
   Чистые функции, без DOM/состояния. Среда — газ (природный/СУГ/воздух).
   Единицы: расход Q [м³/с] (либо м³/ч где отмечено) при нормальных
   условиях, диаметр D [м], длина L [м], давление P [Па абс.],
   температура T [К], плотность ρ [кг/м³].
   ========================================================================= */

export const RHO_AIR_N = 1.293;      // плотность воздуха при н.у. (0°C,101325), кг/м³
export const P_ATM     = 101325;     // атм. давление, Па
export const T_NORM    = 273.15;     // нормальная температура, К (0 °C)

/** Свойства типовых газов: d — отн. плотность к воздуху, nu — кин.
 *  вязкость при н.у. [м²/с] (инж. ориентир). */
export const GAS_PROPS = {
  natural:  { d: 0.68,  nu: 14.3e-6 },   // природный газ
  methane:  { d: 0.554, nu: 14.5e-6 },
  propane:  { d: 1.55,  nu: 3.8e-6  },
  butane:   { d: 2.07,  nu: 2.6e-6  },
  air:      { d: 1.0,   nu: 13.3e-6 },
};

/** Плотность газа при н.у. по относительной плотности к воздуху. */
export function gasDensityNormal(relDensity) {
  return (Number(relDensity) || 1) * RHO_AIR_N;
}

/** Плотность газа при рабочих условиях ρ = ρн·(P/Pн)·(Tн/T), кг/м³.
 *  P [Па абс.], T [К]. */
export function gasDensity(rhoN, P = P_ATM, T = 293.15) {
  return (Number(rhoN) || 0) * (P / P_ATM) * (T_NORM / (Number(T) || T_NORM));
}

/** Площадь круглого сечения D [м] → A [м²]. */
export function pipeArea(D) { return Math.PI * D * D / 4; }

/** Скорость потока v = Q/A [м/с]. Q [м³/с] при рабочих условиях. */
export function flowVelocity(Q, D) {
  const A = pipeArea(D);
  return A > 0 ? Q / A : 0;
}

/** Число Рейнольдса Re = v·D/ν. */
export function reynolds(v, D, nu) {
  return nu > 0 ? Math.abs(v) * D / nu : 0;
}

/** Коэффициент трения λ (Дарси): ламинар 64/Re; турбулент —
 *  Свами–Джейн (Colebrook–White). eps,D [м]. */
export function frictionFactor(Re, eps, D) {
  if (Re <= 0) return 0;
  if (Re < 2300) return 64 / Re;
  const term = (eps / (3.7 * D)) + (5.74 / Math.pow(Re, 0.9));
  const denom = Math.log10(term);
  return 0.25 / (denom * denom);
}

/** Потери давления для НИЗКОГО давления (≤5 кПа изб., ρ≈const):
 *  ΔP = λ·(L/D)·ρ·v²/2 [Па]. */
export function dpLowPressure(lambda, L, D, rho, v) {
  return D > 0 ? (Number(lambda) || 0) * (L / D) * (Number(rho) || 0) * v * v / 2 : 0;
}

/** Перепад для СРЕДНЕГО/ВЫСОКОГО давления (изотермич. сжимаемое
 *  течение): P1² − P2² = 16·λ·L·ρн·Pн·Qн² / (π²·D⁵)  [Па²].
 *  Qn — расход при н.у. [м³/с], ρн — плотность при н.у. */
export function dpSquaredMediumPressure(lambda, L, D, rhoN, Qn) {
  if (D <= 0) return 0;
  return 16 * (Number(lambda) || 0) * L * (Number(rhoN) || 0) * P_ATM
    * (Qn * Qn) / (Math.PI * Math.PI * Math.pow(D, 5));
}

/** Типовая абс. шероховатость [м] стенки газопровода. */
export const ROUGHNESS = {
  steel_new:  4.0e-5,
  steel_used: 1.0e-4,
  pe:         7.0e-7,    // полиэтилен
  cast_iron:  2.6e-4,
};

/** Порог низкого давления, Па изб. (СП 62.13330: ≤5 кПа). */
export const LOW_PRESSURE_LIMIT = 5000;

/* ── D4: стандарт-специфичные эмпирические формулы ──────────────────
   Каждый стандарт — обособленная методика (отдельный файл-метод).
   Здесь — их примитивы. Qh — расход [м³/ч] при н.у., D_mm [мм],
   L [м], dRel — отн. плотность газа к воздуху.                       */

/** Renouard linéaire (низкое/среднее P, ΔP « P):
 *  ΔP[мбар] = 23200 · dRel · L · Qh^1.82 / D_mm^4.82  → возвращаем Па. */
export function renouardLinearDP(dRel, L, D_mm, Qh) {
  if (D_mm <= 0) return 0;
  const dPmbar = 23200 * (Number(dRel) || 0) * L
    * Math.pow(Math.max(Qh, 0), 1.82) / Math.pow(D_mm, 4.82);
  return dPmbar * 100;                    // мбар → Па
}

/** Renouard quadratique (среднее/высокое P):
 *  Pa²−Pb²[бар²] = 48600 · dRel · L · Qh^1.82 / D_mm^4.82
 *  → возвращаем [Па²]. */
export function renouardQuadraticDSq(dRel, L, D_mm, Qh) {
  if (D_mm <= 0) return 0;
  const dSqBar2 = 48600 * (Number(dRel) || 0) * L
    * Math.pow(Math.max(Qh, 0), 1.82) / Math.pow(D_mm, 4.82);
  return dSqBar2 * 1e10;                  // бар² → Па² (1 бар=1e5 Па)
}

/** Weymouth: коэффициент трения Дарси λ = 0.009407 / D^(1/3),
 *  D [м] (классич. Weymouth для магистральных газопроводов). */
export function weymouthFriction(D) {
  return D > 0 ? 0.009407 / Math.cbrt(D) : 0;
}
