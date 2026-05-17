/* =========================================================================
   hvac-methods/index.js — реестр ОВиК-методик (calc-lib).
   Контракт идентичен suppression-methods / hydraulic-methods: каждый
   метод-модуль экспортирует { META, compute(input) }; здесь —
   METHODS / METHOD_LIST / run(). Дисциплина: hvac (47.4.1). Без UI/DOM.
   Потребитель (будущий): UI-модуль вентиляции / cross-discipline отчёт.
   ========================================================================= */

// D4/D5 (v0.60.595): методики обособлены по норме/типу — отдельный
// файл-метод, пользователь выбирает (picker = METHOD_LIST). Добавить
// методику/версию = +1 импорт +1 элемент _ALL; отключить =
// META.enabled:false (исчезает из picker, id сохраняется backward-compat).
import * as AB    from './air-balance.js';            // INT СП 60.13330/ASHRAE
import * as ABRK  from './air-balance-sprk.js';        // KZ  СН РК 4.02
import * as HG    from './heat-gain.js';               // INT теплопритоки

export * as formulas from './formulas.js';

const _ALL = [AB, ABRK, HG];
const _ON  = _ALL.filter(m => m && m.META && m.META.enabled !== false);

export const METHODS = Object.fromEntries(_ON.map(m => [m.META.id, m]));
export const METHOD_LIST = _ON.map(m => m.META);
/** Полный список (включая отключённые) — для админ-UI/диагностики. */
export const ALL_META = _ALL.map(m => m && m.META).filter(Boolean);

/** Запустить методику по id: run('air-balance', input) → result. */
export function run(methodId, input) {
  const m = METHODS[methodId];
  if (!m) throw new Error('Unknown hvac method: ' + methodId);
  return m.compute(input);
}

export const DISCIPLINE = 'hvac';
