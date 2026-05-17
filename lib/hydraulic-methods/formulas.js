/* =========================================================================
   hydraulic-methods/formulas.js — базовые гидравлические примитивы (SI).
   Чистые функции, без DOM/состояния. Жидкость по умолчанию — вода.
   Единицы: расход Q [м³/с], диаметр D [м], длина L [м], скорость v [м/с],
   давление [Па], напор h [м], температура t [°C].
   ========================================================================= */

export const G = 9.80665;            // ускорение свободного падения, м/с²
export const P_ATM = 101325;         // атм. давление, Па (уровень моря)

/** Плотность воды ρ(t), кг/м³. Аппрокс. 0..100 °C (макс ~0.3% ошибки). */
export function waterDensity(tC = 20) {
  const t = Number.isFinite(tC) ? tC : 20;
  // Полином Кельвина-Тэйта (упрощённый, инж. точность)
  return 1000 * (1 - ((t + 288.9414) / (508929.2 * (t + 68.12963))) * (t - 3.9863) ** 2);
}

/** Кинематическая вязкость воды ν(t), м²/с. Аппрокс. Vogel-типа. */
export function waterKinematicViscosity(tC = 20) {
  const t = Number.isFinite(tC) ? tC : 20;
  // μ(t) [Па·с] ≈ 2.414e-5 · 10^(247.8/(t+133.15))  (Andrade)
  const mu = 2.414e-5 * Math.pow(10, 247.8 / (t + 133.15));
  return mu / waterDensity(t);
}

/** Давление насыщенных паров воды Pv(t), Па (Antoine, инж. точность). */
export function waterVaporPressure(tC = 20) {
  const t = Number.isFinite(tC) ? tC : 20;
  // log10(P[мм рт.ст.]) = A − B/(C+t); A=8.07131,B=1730.63,C=233.426 (1..100°C)
  const mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t));
  return mmHg * 133.322;             // мм рт.ст. → Па
}

/** Площадь круглого сечения по диаметру D [м] → A [м²]. */
export function pipeArea(D) { return Math.PI * D * D / 4; }

/** Скорость потока v = Q/A [м/с]. Q [м³/с], D [м]. */
export function flowVelocity(Q, D) {
  const A = pipeArea(D);
  return A > 0 ? Q / A : 0;
}

/** Число Рейнольдса Re = v·D/ν (безразмерное). */
export function reynolds(v, D, nu) {
  return nu > 0 ? Math.abs(v) * D / nu : 0;
}

/** Коэффициент трения Дарси f.
 *  Ламинар (Re<2300): f = 64/Re.
 *  Турбулент: явная аппрокс. Свами–Джейна (Colebrook–White),
 *  eps — абс. шероховатость [м], D [м]. */
export function frictionFactor(Re, eps, D) {
  if (Re <= 0) return 0;
  if (Re < 2300) return 64 / Re;
  const term = (eps / (3.7 * D)) + (5.74 / Math.pow(Re, 0.9));
  const denom = Math.log10(term);
  return 0.25 / (denom * denom);
}

/** Потери напора по длине, Дарси–Вейсбах: hf = f·(L/D)·v²/(2g) [м]. */
export function headLossDarcy(f, L, D, v) {
  return D > 0 ? f * (L / D) * (v * v) / (2 * G) : 0;
}

/** Местные потери: hm = ΣK · v²/(2g) [м]. sumK — сумма коэф. сопротивления. */
export function headLossLocal(sumK, v) {
  return (Number(sumK) || 0) * (v * v) / (2 * G);
}

/** Перевод напора h [м] в давление ΔP [Па]: ΔP = ρ·g·h. */
export function headToPressure(h, rho) { return (rho ?? 1000) * G * h; }

/** Типовая абс. шероховатость [м] по материалу трубы. */
export const ROUGHNESS = {
  steel_new:      4.5e-5,
  steel_used:     2.0e-4,
  galvanized:     1.5e-4,
  cast_iron:      2.6e-4,
  copper:         1.5e-6,
  pvc:            1.5e-6,
  pe:             7.0e-7,
  concrete:       1.0e-3,
};

/* ── D4/D5: альтернативные методики потерь напора (отдельные методы-
   файлы). Q [м³/с], D [м], L [м], hf [м].                            */

/** Коэффициент Хазена–Вильямса C по материалу (безразмерный). */
export const HW_C = {
  steel_new:  130, steel_used: 100, galvanized: 120, cast_iron: 100,
  copper:     140, pvc: 150, pe: 150, concrete: 120,
};

/** Потери напора Хазена–Вильямса (SI):
 *  hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.871) [м]. Только вода. */
export function headLossHazenWilliams(C, L, D, Q) {
  if (D <= 0 || C <= 0) return 0;
  return 10.67 * L * Math.pow(Math.max(Q, 0), 1.852)
    / (Math.pow(C, 1.852) * Math.pow(D, 4.871));
}

/** Коэффициент шероховатости Маннинга n (с/м^⅓) по материалу. */
export const MANNING_N = {
  steel_new:  0.011, steel_used: 0.014, galvanized: 0.013,
  cast_iron:  0.013, copper: 0.010, pvc: 0.009, pe: 0.009,
  concrete:   0.013,
};

/** Потери напора Шези–Маннинга для НАПОРНОЙ круглой трубы полного
 *  сечения: R = D/4; Sf = n²·v² / R^(4/3); hf = Sf·L [м]. */
export function headLossManning(n, L, D, v) {
  if (D <= 0) return 0;
  const R = D / 4;                              // гидравлич. радиус (полное сеч.)
  const Sf = (Number(n) || 0) ** 2 * (v * v) / Math.pow(R, 4 / 3);
  return Sf * L;
}
