/* =========================================================================
   hydraulic-methods/index.js — реестр гидравлических методик (calc-lib).
   Контракт идентичен suppression-methods: каждый метод-модуль экспортирует
   { META, compute(input) }; здесь — METHODS / METHOD_LIST / run().
   Дисциплина: hydraulic (scheme.discipline, 47.4.1). Без UI/DOM.
   Потребитель (будущий): UI-модуль гидравлики / cross-discipline отчёт.
   ========================================================================= */

// D4/D5 (v0.60.590): потери напора обособлены ПО МЕТОДИКЕ/НОРМЕ —
// отдельный файл-метод, пользователь выбирает (picker = METHOD_LIST).
// Добавить методику/версию = +1 импорт +1 элемент _ALL; отключить =
// META.enabled:false (исчезает из picker, id сохраняется).
import * as DW   from './darcy-weisbach.js';            // INT универсальный
import * as HLRK from './head-loss-sprk.js';             // KZ  СН/СП РК
import * as HW   from './head-loss-hazen-williams.js';   // INT Хазен–Вильямс
import * as MN   from './head-loss-manning.js';          // INT Шези–Маннинг
import * as NPSH from './npsh.js';

export * as formulas from './formulas.js';

const _ALL = [DW, HLRK, HW, MN, NPSH];
const _ON  = _ALL.filter(m => m && m.META && m.META.enabled !== false);

export const METHODS = Object.fromEntries(_ON.map(m => [m.META.id, m]));
export const METHOD_LIST = _ON.map(m => m.META);
/** Полный список (включая отключённые) — для админ-UI/диагностики. */
export const ALL_META = _ALL.map(m => m && m.META).filter(Boolean);

/** Запустить методику по id: run('darcy-weisbach', input) → result. */
export function run(methodId, input) {
  const m = METHODS[methodId];
  if (!m) throw new Error('Unknown hydraulic method: ' + methodId);
  return m.compute(input);
}

export const DISCIPLINE = 'hydraulic';
