// =============================================================================
// shared/service-bridge.js — публичное API для создания нарядов из других модулей
// =============================================================================
// Phase 24.7: Кросс-модульная связь cooling → service. Позволяет любому модулю
// создать наряд в Сервисе для текущего проекта (или standalone).
//
// API:
//   createServiceOrderForProject(pid, order) → { id, navigateUrl }
//     Записывает order в LS под service namespace проекта (или standalone),
//     помечает активным, возвращает URL для перехода в Service модуль.
//
// Pure JS / LS utility wrappers.

import { projectKey, getProject } from './project-storage.js';
import { formatOrderNumber, DEFAULT_NUMBER_PATTERNS } from '../apps/service/calc/order-model.js';

const KEY_ORDERS    = ['service', 'orders.v1'];
const KEY_ACTIVE_ID = ['service', 'activeOrderId.v1'];

function storageKey(pid, suffix) {
  if (!pid) return `raschet.service.standalone.${suffix.join('.')}`;
  return projectKey(pid, ...suffix);
}

/**
 * Сгенерировать уникальный seq-id для нового наряда (учитывая существующие).
 */
/* v0.60.41: вытащить customer/notes из реквизитов проекта. */
function buildOrderDefaultsFromProjectRequisites(pid) {
  if (!pid) return {};
  try {
    const proj = getProject(pid);
    const r = proj?.requisites || {};
    const out = {};
    if (r.customer) out.customer = { name: r.customer, contact: r.gip || '' };
    if (r.address) {
      out.notes = `Объект: ${r.address}${r.code ? ` (шифр ${r.code})` : ''}${r.stage ? ` · стадия ${r.stage}` : ''}`;
    }
    return out;
  } catch { return {}; }
}

/* v0.60.48: учётный номер с per-context per-type counter. */
const KEY_NUM_COUNTERS = ['service', 'numberCounters.v1'];
const KEY_NUM_PATTERNS = ['service', 'numberPatterns.v1'];

function nextOrderNumber(pid, type) {
  const cKey = storageKey(pid, KEY_NUM_COUNTERS);
  let counters = {};
  try { const raw = localStorage.getItem(cKey); if (raw) counters = JSON.parse(raw); } catch {}
  const next = (Number(counters[type]) || 0) + 1;
  counters[type] = next;
  try { localStorage.setItem(cKey, JSON.stringify(counters)); } catch {}
  let patterns = {};
  try { const raw = localStorage.getItem(storageKey(pid, KEY_NUM_PATTERNS)); if (raw) patterns = JSON.parse(raw); } catch {}
  const pattern = patterns[type] || DEFAULT_NUMBER_PATTERNS[type] || '{counter}';
  return formatOrderNumber(pattern, next);
}

function nextOrderId(pid) {
  let max = 0;
  try {
    const raw = localStorage.getItem(storageKey(pid, KEY_ORDERS));
    const arr = raw ? JSON.parse(raw) : [];
    for (const o of arr) {
      const m = /ord-(\d+)/.exec(o.id || '');
      if (m) max = Math.max(max, +m[1]);
    }
  } catch {}
  return 'ord-' + (max + 1);
}

/**
 * Создать наряд в Сервисе для текущего проекта (или standalone).
 *
 * @param {string|null} pid — id проекта (null → standalone)
 * @param {object} orderData — partial order (id будет сгенерирован если не задан)
 * @returns {{id: string, navigateUrl: string}}
 */
export function createServiceOrderForProject(pid, orderData = {}) {
  const id = orderData.id || nextOrderId(pid);
  // v0.60.41: автозаполнение customer/notes из реквизитов проекта если caller
  // не передал.
  const projectDefaults = pid ? buildOrderDefaultsFromProjectRequisites(pid) : {};
  // v0.60.48 (Phase 32.1): учётный номер. Counter — per-context per-type.
  const number = orderData.number || nextOrderNumber(pid, orderData.type || 'install');
  const order = {
    ...projectDefaults,
    ...orderData,                 // caller-overrides выше project-defaults
    id,
    number,
    // merge customer без потери частичных полей
    customer: { ...(projectDefaults.customer || {}), ...(orderData.customer || {}) },
  };

  // Append to orders[]
  let orders = [];
  try {
    const raw = localStorage.getItem(storageKey(pid, KEY_ORDERS));
    if (raw) orders = JSON.parse(raw);
  } catch {}
  orders.push(order);
  localStorage.setItem(storageKey(pid, KEY_ORDERS), JSON.stringify(orders));

  // Set as active
  localStorage.setItem(storageKey(pid, KEY_ACTIVE_ID), JSON.stringify(id));

  // Build navigation URL
  const navigateUrl = pid
    ? `../service/?pid=${encodeURIComponent(pid)}`
    : `../service/?standalone=1`;

  return { id, navigateUrl };
}
