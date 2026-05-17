/* =========================================================================
   hvac-methods/index.js — реестр ОВиК-методик (calc-lib).
   Контракт идентичен suppression-methods / hydraulic-methods: каждый
   метод-модуль экспортирует { META, compute(input) }; здесь —
   METHODS / METHOD_LIST / run(). Дисциплина: hvac (47.4.1). Без UI/DOM.
   Потребитель (будущий): UI-модуль вентиляции / cross-discipline отчёт.
   ========================================================================= */

import * as AB from './air-balance.js';
import * as HG from './heat-gain.js';

export * as formulas from './formulas.js';

export const METHODS = {
  [AB.META.id]: AB,
  [HG.META.id]: HG,
};

export const METHOD_LIST = [AB.META, HG.META];

/** Запустить методику по id: run('air-balance', input) → result. */
export function run(methodId, input) {
  const m = METHODS[methodId];
  if (!m) throw new Error('Unknown hvac method: ' + methodId);
  return m.compute(input);
}

export const DISCIPLINE = 'hvac';
