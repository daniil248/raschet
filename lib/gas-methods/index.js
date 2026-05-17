/* =========================================================================
   gas-methods/index.js — реестр газовых методик (calc-lib).
   Контракт идентичен suppression-/hydraulic-/hvac-methods: каждый
   метод-модуль экспортирует { META, compute(input) }; здесь —
   METHODS / METHOD_LIST / run(). Дисциплина: gas (47.4.1). Без UI/DOM.
   Потребитель (будущий): UI-модуль газоснабжения / cross-discipline.
   ========================================================================= */

// D4/D5 (v0.60.587-589): потери давления обособлены ПО СТАНДАРТУ И
// РЕГИОНУ — отдельный файл-метод на норму (РФ/РК/EU/US), пользователь
// выбирает (picker = METHOD_LIST). Добавить новую методику/версию =
// +1 импорт +1 элемент _ALL; отключить = META.enabled:false (метод
// исчезает из picker, но id остаётся для backward-compat).
import * as PD     from './pressure-drop.js';           // RU  СП 42-101/62.13330
import * as PDSPRK from './pressure-drop-sprk.js';       // KZ  СН РК / СП РК
import * as PDR    from './pressure-drop-renouard.js';   // EU  Renouard
import * as PDW    from './pressure-drop-weymouth.js';   // US  Weymouth
import * as TP     from './throughput.js';

export * as formulas from './formulas.js';

// Единый список модулей-методов. Фильтр по META.enabled !== false.
const _ALL = [PD, PDSPRK, PDR, PDW, TP];
const _ON  = _ALL.filter(m => m && m.META && m.META.enabled !== false);

export const METHODS = Object.fromEntries(_ON.map(m => [m.META.id, m]));
export const METHOD_LIST = _ON.map(m => m.META);
/** Полный список (включая отключённые) — для админ-UI/диагностики. */
export const ALL_META = _ALL.map(m => m && m.META).filter(Boolean);

/** Запустить методику по id: run('gas-pressure-drop', input) → result. */
export function run(methodId, input) {
  const m = METHODS[methodId];
  if (!m) throw new Error('Unknown gas method: ' + methodId);
  return m.compute(input);
}

export const DISCIPLINE = 'gas';
