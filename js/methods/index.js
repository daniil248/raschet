// =========================================================================
// Реестр методик расчёта кабеля
// Единая точка входа для всех модулей приложения
// =========================================================================

import iec from './iec.js';
import pue from './pue.js';

export { calcVoltageDrop, findMinSizeForVdrop } from './vdrop.js';

/** Все зарегистрированные методики */
export const METHODS = { iec, pue };

/** Получить методику по id */
export function getMethod(id) {
  return METHODS[id] || METHODS.iec;
}

/** Список методик для UI [{ id, label }] */
export function listMethods() {
  return Object.values(METHODS).map(m => ({ id: m.id, label: m.label }));
}
