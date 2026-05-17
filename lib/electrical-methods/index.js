// =========================================================================
// Реестр методик расчёта кабеля
// Единая точка входа для всех модулей приложения
// =========================================================================

import iec from './iec.js';
import pue from './pue.js';
import nec from './nec.js';
import pueRk from './pue-rk.js';

export { calcVoltageDrop, findMinSizeForVdrop } from './vdrop.js';
export { getEcoMethod, listEcoMethods } from './economic/index.js';

/** Все зарегистрированные методики.
 *  v0.60.123: добавлена NEC (NFPA 70) для проектов в США/Канаде.
 *  v0.60.591 (D4/D5): + ПУЭ РК (Казахстан); harmonization к контракту
 *  методов-файлов с META region/version/enabled (как lib/*-methods).
 *  Аддитивно — getMethod/listMethods/recalc не сломаны. */
export const METHODS = { iec, pue, nec, 'pue-rk': pueRk };

/** Полный список META включая отключённые — для админ-UI/диагностики
 *  (D5). Электрика = calc-модуль класса lib/*-methods (D1). */
export const ALL_META = Object.values(METHODS).map(m => ({
  id: m.id, label: m.label, standard: m.standard || m.label,
  region: m.region || '—', version: m.version || '1.0',
  enabled: m.enabled !== false, discipline: 'electrical',
}));

/** Включённые методики (D5 enabled-фильтр). picker берёт отсюда. */
export const METHOD_LIST = ALL_META.filter(m => m.enabled);

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

/** Список методик для UI. Backward-compat: всегда есть { id, label }.
 *  D4/D5: + standard/region/version; отключённые (enabled:false)
 *  отфильтрованы (picker по стандарту). */
export function listMethods() {
  return Object.values(METHODS)
    .filter(m => m.enabled !== false)
    .map(m => ({
      id: m.id, label: m.label,
      standard: m.standard || m.label,
      region: m.region || '—',
      version: m.version || '1.0',
    }));
}
