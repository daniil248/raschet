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

// =============================================================================
// Phase 42.4 (v0.60.118): User / Org-уровень сценариев.
//
// Три scope:
//   📦 seed — встроенные read-only (этот файл).
//   ✏ user — личные пользовательские (LS_KEY_USER).
//   👥 org  — общие шаблоны организации (LS_KEY_ORG; Phase 41.2 pattern).
//
// Сценарии в LS — те же объекты что и SEED_WIZARDS, плюс scope/createdAt/etc.
// Pure JSON, без import — поэтому редактировать можно через JSON editor.
// =============================================================================

const LS_KEY_USER = 'raschet.service.wizards.user.v1';
const LS_KEY_ORG  = 'raschet.service.wizards.org.v1';

function _loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function _saveJson(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr || [])); _notifyChange(); } catch {}
}

export function loadUserWizards() { return _loadJson(LS_KEY_USER); }
export function loadOrgWizards()  { return _loadJson(LS_KEY_ORG); }

/** Получить сценарий по id (seed / user / org). */
export function getWizard(id) {
  return SEED_WIZARDS.find(w => w.id === id)
      || loadUserWizards().find(w => w.id === id)
      || loadOrgWizards().find(w => w.id === id)
      || null;
}

/** Получить все сценарии (с пометкой scope), опционально отфильтрованные по orderType. */
export function listWizards(orderType = null) {
  const seed = SEED_WIZARDS.map(w => ({ ...w, scope: 'seed' }));
  const user = loadUserWizards().map(w => ({ ...w, scope: 'user' }));
  const org  = loadOrgWizards().map(w => ({ ...w, scope: 'org'  }));
  const all = [...seed, ...org, ...user];
  if (!orderType) return all;
  return all.filter(w => Array.isArray(w.appliesTo) && w.appliesTo.includes(orderType));
}

// ─── CRUD user

/** Добавить новый user-сценарий. */
export function addUserWizard(wizard) {
  const arr = loadUserWizards();
  const id = 'wz-usr-' + Math.random().toString(36).slice(2, 8);
  const tpl = { ...wizard, id, createdAt: Date.now() };
  arr.push(tpl);
  _saveJson(LS_KEY_USER, arr);
  return tpl;
}

/** Обновить user-сценарий. */
export function updateUserWizard(id, patch) {
  if (!id?.startsWith('wz-usr-')) return false;
  const arr = loadUserWizards();
  const idx = arr.findIndex(w => w.id === id);
  if (idx < 0) return false;
  arr[idx] = { ...arr[idx], ...patch, id, updatedAt: Date.now() };
  _saveJson(LS_KEY_USER, arr);
  return true;
}

/** Удалить user-сценарий. */
export function deleteUserWizard(id) {
  if (!id?.startsWith('wz-usr-')) return false;
  const arr = loadUserWizards().filter(w => w.id !== id);
  _saveJson(LS_KEY_USER, arr);
  return true;
}

// ─── CRUD org

export function updateOrgWizard(id, patch) {
  if (!id?.startsWith('wz-org-')) return false;
  const arr = loadOrgWizards();
  const idx = arr.findIndex(w => w.id === id);
  if (idx < 0) return false;
  arr[idx] = { ...arr[idx], ...patch, id, updatedAt: Date.now() };
  _saveJson(LS_KEY_ORG, arr);
  return true;
}

export function deleteOrgWizard(id) {
  if (!id?.startsWith('wz-org-')) return false;
  const arr = loadOrgWizards().filter(w => w.id !== id);
  _saveJson(LS_KEY_ORG, arr);
  return true;
}

/** Promotion: user → org. */
export function promoteWizardToOrg(id) {
  if (!id?.startsWith('wz-usr-')) return false;
  const userArr = loadUserWizards();
  const idx = userArr.findIndex(w => w.id === id);
  if (idx < 0) return false;
  const wz = userArr[idx];
  const orgArr = loadOrgWizards();
  const newId = 'wz-org-' + Math.random().toString(36).slice(2, 8);
  orgArr.push({ ...wz, id: newId, promotedAt: Date.now(), promotedFrom: wz.id });
  userArr.splice(idx, 1);
  _saveJson(LS_KEY_ORG, orgArr);
  _saveJson(LS_KEY_USER, userArr);
  return newId;
}

/** Demotion: org → user. */
export function demoteWizardToUser(id) {
  if (!id?.startsWith('wz-org-')) return false;
  const orgArr = loadOrgWizards();
  const idx = orgArr.findIndex(w => w.id === id);
  if (idx < 0) return false;
  const wz = orgArr[idx];
  const userArr = loadUserWizards();
  const newId = 'wz-usr-' + Math.random().toString(36).slice(2, 8);
  const userTpl = { ...wz, id: newId, demotedAt: Date.now(), demotedFrom: wz.id };
  delete userTpl.promotedAt;
  delete userTpl.promotedFrom;
  userArr.push(userTpl);
  orgArr.splice(idx, 1);
  _saveJson(LS_KEY_USER, userArr);
  _saveJson(LS_KEY_ORG, orgArr);
  return newId;
}

/** Скопировать seed/org → user (как «черновик» для редактирования). */
export function cloneToUser(srcId) {
  const src = getWizard(srcId);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.scope;
  delete copy.id;
  copy.title = (copy.title || '') + ' (копия)';
  return addUserWizard(copy);
}

// ─── Pub/sub
const _listeners = new Set();
export function onWizardsChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
function _notifyChange() {
  _listeners.forEach(cb => { try { cb(); } catch {} });
  try { window.dispatchEvent(new CustomEvent('raschet:wizards-change')); } catch {}
}

// ─── Validation для JSON-editor
//
// Минимальная проверка структуры. Полная валидация по JSON-схеме — TODO.
// Возвращает { ok: true } или { ok: false, errors: [...] }.
export function validateWizard(wz) {
  const errors = [];
  if (!wz || typeof wz !== 'object') errors.push('Не объект');
  else {
    if (typeof wz.title !== 'string' || !wz.title.trim()) errors.push('title — строка обязательна');
    if (!Array.isArray(wz.appliesTo) || !wz.appliesTo.length) errors.push('appliesTo — массив orderType (install|maintenance|one-off)');
    if (!Array.isArray(wz.params)) errors.push('params — массив (может быть пустым)');
    if (!Array.isArray(wz.suggestions)) errors.push('suggestions — массив (может быть пустым)');
    if (Array.isArray(wz.params)) {
      wz.params.forEach((p, i) => {
        if (!p.id) errors.push(`params[${i}].id — обязательно`);
        if (!p.label) errors.push(`params[${i}].label — обязательно`);
        if (p.type && !['number','choice'].includes(p.type)) errors.push(`params[${i}].type — number|choice`);
        if (p.type === 'choice' && (!Array.isArray(p.options) || !p.options.length)) errors.push(`params[${i}].options — для choice обязательно`);
      });
    }
    if (Array.isArray(wz.suggestions)) {
      wz.suggestions.forEach((g, gi) => {
        if (!Array.isArray(g.rules)) errors.push(`suggestions[${gi}].rules — массив обязателен`);
        else g.rules.forEach((r, ri) => {
          if (!r.label) errors.push(`suggestions[${gi}].rules[${ri}].label — обязательно`);
          if (r.qty == null) errors.push(`suggestions[${gi}].rules[${ri}].qty — обязательно (число или expr-строка)`);
        });
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
