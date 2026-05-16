// ======================================================================
// reports/templates-seed.js — SHIM (обратная совместимость путей).
// Встроенные шаблоны отчётов перенесены в
// shared/report/templates-seed.js (SHARED-контракт). Этот файл цел,
// чтобы старые относительные импорты (reports/reports.js) и любой
// legacy-код продолжали резолвиться. Новый код импортирует из
// '../shared/report/templates-seed.js' (или 'shared/report/index.js').
// ======================================================================
export * from 'shared/report/templates-seed.js';
