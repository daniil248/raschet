// =============================================================================
// cooling/calc/psychro-formulas.js — pure thermodynamic helpers
// =============================================================================
// Подмножество психрометрических формул, нужных модулю Cooling Systems.
// Дублирует то, что есть в psychrometrics/psychrometrics.js, чтобы Cooling
// можно было использовать без зависимости от UI-модуля Mollier-Ramzin.
// При желании эти формулы могут быть импортированы из psychrometrics, но
// тогда появится cross-module hard-dep.
//
// Источники:
//   • Stull R. (2011) "Wet-Bulb Temperature from Relative Humidity and Air
//     Temperature", J.Appl.Meteor.Climatol. 50, 2267–2269.
//   • ASHRAE Handbook — Fundamentals (2021) гл. 1 (Psychrometrics).
//
// NO DOM, NO browser-API. Pure JS.

/**
 * Wet-bulb (мокрого термометра) из drybulb T (°C) и RH (%).
 * Упрощённая формула Stull 2011, погрешность ±1°C при RH 5–99%.
 *
 * @param {number} T  — drybulb °C
 * @param {number} RH — relative humidity %
 * @returns {number|null} T_wb °C или null если входы NaN
 */
export function wetBulbStull(T, RH) {
  if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659))
    + Math.atan(T + RH) - Math.atan(RH - 1.676331)
    + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
}
