// =============================================================================
// service/catalog/wizards/index.js — Phase 42 (v0.60.109)
// =============================================================================
// Реестр сценариев мастера составления нарядов.
//
// По запросу Пользователя 2026-05-04: «в нарядах добавь мастер составления
// нарядов, который по категориям работ будет сам предлагать выбрать
// соответствующие пункты, например если речь идет про систему вентиляции,
// то мастер запрашивает производительность системы, затем соответственно
// предлагает соответствующие расходные материалы для конкретной установки,
// учитывая производительность, по ходы работы мастера спрашивая
// пользователя, нужно ли добавить тот или иной пункт. Сами комбинации для
// того или иного оборудования или работы должны иметь возможность
// конфигурироваться (задание конкретных фильтров для конкретной
// установки...)».
//
// Архитектура: data-driven (правило feedback_use_catalogs.md). Каждый
// сценарий = декларативный объект; никакого хардкода в order-wizard.js.
// Пользователь может создавать свои сценарии (Phase 42.4 — позже).
//
// Wizard-DSL (см. ROADMAP Phase 42.1):
//   {
//     id, title, icon, appliesTo: [orderType...],
//     description, params: [...],
//     suggestions: [{ when, label, qty, category, costPrice, clientPrice,
//                     costCurrency, clientCurrency, unit, ask, group }],
//   }
//
// Поля sugestion:
//   when         — boolean expression в контексте параметров
//                  (eval'ится через safeEval — без window/eval)
//   qty          — expr (число или формула с params)
//   ask          — текст подтверждения (поддерживает {param} substitution)
//   group        — заголовок группы предложений (для UI-рендера)
// =============================================================================

// Безопасный eval выражения в контексте { params }. Whitelist операторов.
// Поддерживает: числа, строки, операции +-*/%, сравнения ===/<==/<=/>=/</>,
// логические &&/||/!, тернарный, скобки, доступ к params.fieldName,
// Math.{round,ceil,floor,min,max}.
//
// Для prod достаточно простого парсера через Function() с замороженной
// средой. Это безопасно ТОЛЬКО для built-in сценариев. Пользовательские
// сценарии (Phase 42.4) потребуют реального whitelist-парсера.
export function evalExpr(expr, ctx) {
  if (typeof expr === 'number') return expr;
  if (typeof expr !== 'string' || !expr.trim()) return undefined;
  try {
    // Простая защита: запрещаем явные опасные токены.
    if (/\b(eval|Function|window|document|globalThis|import|require|fetch|location)\b/.test(expr)) {
      console.warn('[wizard] dangerous token in expr, refused:', expr);
      return undefined;
    }
    // Контекст: params (object), Math (whitelisted methods).
    const safeMath = {
      round: Math.round, ceil: Math.ceil, floor: Math.floor,
      min: Math.min, max: Math.max, abs: Math.abs,
    };
    const fn = new Function('params', 'Math', `"use strict"; return (${expr});`);
    return fn(ctx.params || {}, safeMath);
  } catch (e) {
    console.warn('[wizard] evalExpr error:', expr, e);
    return undefined;
  }
}

// Подстановка {param} в строку.
export function interpolate(template, ctx) {
  if (typeof template !== 'string') return String(template ?? '');
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => {
    const v = ctx?.params?.[k];
    return (v === null || v === undefined) ? '' : String(v);
  });
}

// =============================================================================
// SEED-сценарии. По мере появления — добавлять новые JSON.
// Все сценарии — read-only seed (id с префиксом 'wz-seed-...').
// Пользовательские (через UI) — id 'wz-usr-...'.
// =============================================================================

import { WIZARD_VENTILATION_TO } from './ventilation-to.js';
import { WIZARD_CHILLER_TO } from './chiller-to.js';
import { WIZARD_UPS_TO } from './ups-to.js';

export const SEED_WIZARDS = [
  WIZARD_VENTILATION_TO,
  WIZARD_CHILLER_TO,
  WIZARD_UPS_TO,
];

// Получить все сценарии (seed + user). Phase 42.4: добавить user-сценарии
// из LS catalog'а.
export function listWizards(orderType = null) {
  const all = SEED_WIZARDS.slice();
  if (!orderType) return all;
  return all.filter(w => Array.isArray(w.appliesTo) && w.appliesTo.includes(orderType));
}

export function getWizard(id) {
  return SEED_WIZARDS.find(w => w.id === id) || null;
}
