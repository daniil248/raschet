// =============================================================================
// service/catalog/work-templates.js — каталог типовых работ сервиса
// =============================================================================
// Phase 24.2: По правилу feedback_use_catalogs.md «всё что можно вынести в
// каталоги, должно быть вынесено в соответствующий каталог». Раньше
// WORK_TEMPLATES были захардкожены в service/calc/order-model.js — нарушение.
//
// Теперь:
//   - SEED_TEMPLATES — встроенные дефолты (read-only).
//   - User-кастомные шаблоны хранятся в LS (`raschet.service.workTemplates.v1`).
//   - listTemplates(type) возвращает merged-список (seed + user).
//   - addTemplate / updateTemplate / deleteTemplate / resetToSeed — CRUD для user-шаблонов.
//
// Pure JS / LS utility wrappers.

const LS_KEY = 'raschet.service.workTemplates.v1';

/**
 * Seed-каталог. Read-only встроенные шаблоны с дефолтными ценами в ₽.
 * Для проектов в других валютах: после добавления позиции редактируйте
 * валюту/цены через select в строке наряда.
 */
export const SEED_TEMPLATES = {
  install: [
    { id: 'seed-i-1', label: 'Монтаж чиллера до 200 кВт', category: 'labor', unit: 'комплект', costPrice: 80000, clientPrice: 130000 },
    { id: 'seed-i-2', label: 'Монтаж чиллера 200–500 кВт', category: 'labor', unit: 'комплект', costPrice: 150000, clientPrice: 240000 },
    { id: 'seed-i-3', label: 'Монтаж DX-блока', category: 'labor', unit: 'комплект', costPrice: 35000, clientPrice: 60000 },
    { id: 'seed-i-4', label: 'Монтаж CRAC прецизионного', category: 'labor', unit: 'комплект', costPrice: 50000, clientPrice: 80000 },
    { id: 'seed-i-5', label: 'Опрессовка холодильного контура', category: 'labor', unit: 'комплект', costPrice: 12000, clientPrice: 22000 },
    { id: 'seed-i-6', label: 'Заправка R410A', category: 'material', unit: 'кг', costPrice: 3500, clientPrice: 5500 },
    { id: 'seed-i-7', label: 'Заправка R32', category: 'material', unit: 'кг', costPrice: 4200, clientPrice: 6500 },
    { id: 'seed-i-8', label: 'Заправка R134a', category: 'material', unit: 'кг', costPrice: 4800, clientPrice: 7200 },
    { id: 'seed-i-9', label: 'Пусконаладочные работы (ПНР)', category: 'labor', unit: 'комплект', costPrice: 25000, clientPrice: 45000 },
    { id: 'seed-i-10', label: 'Командировка инженера (день)', category: 'travel', unit: 'сутки', costPrice: 8000, clientPrice: 15000 },
  ],
  maintenance: [
    { id: 'seed-m-1', label: 'Регламентное ТО ежемесячное', category: 'labor', unit: 'выезд', costPrice: 6000, clientPrice: 10000 },
    { id: 'seed-m-2', label: 'Регламентное ТО квартальное', category: 'labor', unit: 'выезд', costPrice: 12000, clientPrice: 20000 },
    { id: 'seed-m-3', label: 'Регламентное ТО годовое', category: 'labor', unit: 'выезд', costPrice: 30000, clientPrice: 50000 },
    { id: 'seed-m-4', label: 'Замена воздушных фильтров', category: 'material', unit: 'шт', costPrice: 1200, clientPrice: 2000 },
    { id: 'seed-m-5', label: 'Чистка теплообменника', category: 'labor', unit: 'комплект', costPrice: 8000, clientPrice: 14000 },
    { id: 'seed-m-6', label: 'Дозаправка хладагента', category: 'material', unit: 'кг', costPrice: 4000, clientPrice: 6500 },
    { id: 'seed-m-7', label: 'Анализ масла компрессора', category: 'labor', unit: 'комплект', costPrice: 5000, clientPrice: 9000 },
  ],
  'one-off': [
    { id: 'seed-o-1', label: 'Аварийный выезд', category: 'travel', unit: 'выезд', costPrice: 15000, clientPrice: 28000 },
    { id: 'seed-o-2', label: 'Диагностика неисправности', category: 'labor', unit: 'ч', costPrice: 3500, clientPrice: 6000 },
    { id: 'seed-o-3', label: 'Ремонт компрессора', category: 'labor', unit: 'комплект', costPrice: 50000, clientPrice: 90000 },
  ],
};

/** Прочитать пользовательские шаблоны из LS. */
function loadUserTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { install: [], maintenance: [], 'one-off': [] };
  } catch {
    return { install: [], maintenance: [], 'one-off': [] };
  }
}

function saveUserTemplates(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    _notifyChange();
  } catch {}
}

/**
 * Получить merged-список шаблонов для типа наряда (seed + user).
 *
 * @param {string} type — 'install' | 'maintenance' | 'one-off'
 * @returns {Array<{id, label, category, unit, costPrice, clientPrice, isUser?}>}
 */
export function listTemplates(type) {
  const seed = (SEED_TEMPLATES[type] || []).map(t => ({ ...t, isUser: false }));
  const user = (loadUserTemplates()[type] || []).map(t => ({ ...t, isUser: true }));
  return [...seed, ...user];
}

/**
 * Добавить новый пользовательский шаблон.
 *
 * @param {string} type
 * @param {object} tpl — без id (генерируется)
 * @returns {object} новый шаблон с id
 */
export function addTemplate(type, tpl) {
  const data = loadUserTemplates();
  if (!data[type]) data[type] = [];
  const id = 'usr-' + Math.random().toString(36).slice(2, 8);
  const newTpl = {
    id,
    label: String(tpl.label || ''),
    category: tpl.category || 'labor',
    unit: tpl.unit || 'шт',
    costPrice: Number(tpl.costPrice) || 0,
    clientPrice: Number(tpl.clientPrice) || 0,
  };
  data[type].push(newTpl);
  saveUserTemplates(data);
  return newTpl;
}

/**
 * Обновить пользовательский шаблон. SEED-шаблоны (id="seed-...") нельзя
 * редактировать — игнорируется.
 */
export function updateTemplate(type, id, patch) {
  if (id?.startsWith('seed-')) return false;
  const data = loadUserTemplates();
  const arr = data[type] || [];
  const idx = arr.findIndex(t => t.id === id);
  if (idx < 0) return false;
  arr[idx] = { ...arr[idx], ...patch, id };
  saveUserTemplates(data);
  return true;
}

/** Удалить пользовательский шаблон (seed нельзя). */
export function deleteTemplate(type, id) {
  if (id?.startsWith('seed-')) return false;
  const data = loadUserTemplates();
  data[type] = (data[type] || []).filter(t => t.id !== id);
  saveUserTemplates(data);
  return true;
}

/** Удалить все user-шаблоны (вернуть только seed). */
export function resetUserTemplates() {
  try { localStorage.removeItem(LS_KEY); _notifyChange(); } catch {}
}

/* Pub/sub для UI auto-refresh */
const _listeners = new Set();
export function onWorkTemplatesChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notifyChange() {
  _listeners.forEach(cb => { try { cb(); } catch {} });
  try { window.dispatchEvent(new CustomEvent('raschet:work-templates-change')); } catch {}
}
