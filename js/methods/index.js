// COMPAT-SHIM (v0.60.592, D1): реестр электрики перенесён в
// lib/electrical-methods/index.js (calc-модуль класса lib/*-methods).
// Все потребители (recalc, cable-calc, shared/calc-modules, inspector)
// импортируют ИМЕНОВАННЫЕ экспорты отсюда — re-export сохраняет путь
// без изменений (zero-build, нулевая регрессия).
export * from '../../lib/electrical-methods/index.js';
