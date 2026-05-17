// COMPAT-SHIM (v0.60.592, D1): электрика перенесена в
// lib/electrical-methods/ (calc-модуль). Старый путь сохранён —
// CORE recalc и потребители резолвятся без изменений (zero-build).
export * from '../../lib/electrical-methods/iec.js';
export { default } from '../../lib/electrical-methods/iec.js';
