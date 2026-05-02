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

import { projectKey } from './project-storage.js';

const KEY_ORDERS    = ['service', 'orders.v1'];
const KEY_ACTIVE_ID = ['service', 'activeOrderId.v1'];

function storageKey(pid, suffix) {
  if (!pid) return `raschet.service.standalone.${suffix.join('.')}`;
  return projectKey(pid, ...suffix);
}

/**
 * Сгенерировать уникальный seq-id для нового наряда (учитывая существующие).
 */
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
  const order = { ...orderData, id };

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
