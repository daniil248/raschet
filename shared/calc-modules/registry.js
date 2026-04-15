// ======================================================================
// shared/calc-modules/registry.js
// Единый реестр расчётных модулей кабельной линии. Используется и
// главным приложением (recalc.js), и подпрограммой «Расчёт кабельной
// линии» (cable/), и будущими подпрограммами.
//
// Идея:
//   — каждый модуль — это объект с детерминированным API
//   — часть модулей обязательны (mandatory: true) — ПУЭ / IEC 60364
//     требуют их применять, отключить нельзя
//   — остальные — опциональные: пользователь сам решает, применять ли
//   — отчёт выводит результат КАЖДОГО включённого модуля отдельно,
//     чтобы пользователь видел влияние каждого
//
// Формат модуля:
//   {
//     id:          'ampacity' | 'vdrop' | 'shortCircuit' | ... ,
//     label:       'Подбор по токовой нагрузке',
//     description: 'IEC 60364-5-52 — ...'
//     mandatory:   true/false,
//     defaultOn:   true,   // для опциональных — включён по умолчанию?
//     order:       10,     // порядок в отчёте (меньше = раньше)
//     calc(input) → {
//       pass:    boolean,     // модуль прошёл проверку?
//       bump?:   number,      // рекомендованное min-сечение (если модуль
//                             //   хочет увеличить итоговое)
//       details: object,      // данные для рендера (свободный формат)
//       warnings: string[],   // сообщения пользователю
//     }
//   }
//
// input — единый объект параметров расчёта:
//   { I, U, phases, dc, cosPhi, lengthM, material, insulation, method,
//     ambient, grouping, bundling, cableType, maxSize, parallel, ... }
// ======================================================================

const _modules = new Map();

/**
 * Регистрация расчётного модуля. Идемпотентна: повторная регистрация
 * по тому же id заменяет предыдущую (чтобы можно было патчить модули
 * из тестов или подпрограмм).
 */
export function registerModule(mod) {
  if (!mod || !mod.id) throw new Error('[calc-modules] module must have id');
  _modules.set(mod.id, Object.freeze({
    id: mod.id,
    label: mod.label || mod.id,
    description: mod.description || '',
    mandatory: !!mod.mandatory,
    defaultOn: mod.defaultOn !== false,
    order: Number.isFinite(mod.order) ? mod.order : 100,
    calc: typeof mod.calc === 'function' ? mod.calc : (() => ({ pass: true, details: {}, warnings: [] })),
  }));
}

/** Возвращает все зарегистрированные модули, отсортированные по order. */
export function listModules() {
  return [..._modules.values()].sort((a, b) => a.order - b.order);
}

/** Один модуль по id или null. */
export function getModule(id) {
  return _modules.get(id) || null;
}

/** Запуск всех ВКЛЮЧЁННЫХ модулей. Возвращает массив результатов в
 *  порядке order. enabledIds — Set идентификаторов опциональных модулей,
 *  которые пользователь включил. Mandatory-модули запускаются всегда. */
export function runModules(input, enabledIds) {
  const enabled = enabledIds instanceof Set ? enabledIds : new Set(enabledIds || []);
  const out = [];
  for (const mod of listModules()) {
    const shouldRun = mod.mandatory || enabled.has(mod.id);
    if (!shouldRun) continue;
    let result;
    try {
      result = mod.calc(input) || { pass: true, details: {}, warnings: [] };
    } catch (e) {
      result = { pass: false, details: {}, warnings: ['Ошибка в модуле: ' + (e && e.message || e)] };
    }
    out.push({
      id: mod.id,
      label: mod.label,
      mandatory: mod.mandatory,
      description: mod.description,
      order: mod.order,
      result,
    });
  }
  return out;
}

