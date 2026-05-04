// =========================================================================
// Реестр методик расчёта кабеля
// Единая точка входа для всех модулей приложения
// =========================================================================

import iec from './iec.js';
import pue from './pue.js';
import nec from './nec.js';

export { calcVoltageDrop, findMinSizeForVdrop } from './vdrop.js';
export { getEcoMethod, listEcoMethods } from './economic/index.js';

/** Все зарегистрированные методики.
 *  v0.60.123: добавлена NEC (NFPA 70) для проектов в США/Канаде. */
export const METHODS = { iec, pue, nec };

/** Получить методику по id.
 *  v0.59.655: 'rtm' (РТМ 36.18.32.4-92) задаёт только методику расчёта
 *  максимальной нагрузки (метод упорядоченных диаграмм Каялова, см.
 *  shared/calc-modules/rtm-load.js). Свою методику расчёта сечения кабеля
 *  у РТМ нет — РТМ это советский/российский стандарт, поэтому для кабеля
 *  используем ПУЭ 7 (юзер: «РТМ ближе к ПУЭ чем к IEC»).
 *  v0.60.123: 'nec' — NEC (NFPA 70). Минимальная реализация через
 *  IEC-таблицы; полная поддержка AWG-сечений + NEC Annex C — TODO. */
export function getMethod(id) {
  if (id === 'rtm') return METHODS.pue;
  return METHODS[id] || METHODS.iec;
}

/** Список методик для UI [{ id, label }] */
export function listMethods() {
  return Object.values(METHODS).map(m => ({ id: m.id, label: m.label }));
}
