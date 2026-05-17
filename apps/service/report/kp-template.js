// =============================================================================
// shared/report/kp-template.js — слот-ориентированный шаблон КП
// =============================================================================
// Phase 29.2: По требованию Пользователя 2026-05-02:
// «сделать шаблон, который содержит блоки конкретного документа,
// можно основные блоки размещать в любом порядке».
//
// Шаблон КП = упорядоченный список SLOTS, каждый со своим builder-ом
// (kp-blocks.js). Пользователь может:
//   - Включить/выключить каждый слот (enabled)
//   - Перестроить порядок (move up/down)
//   - Настроить опции каждого слота (через slot.options)
//   - Сохранить под именем (несколько шаблонов на разные сценарии)
//
// Storage: 'raschet.kp-templates.v1' = [{ id, name, slots[] }]
//          'raschet.kp-templates.activeId.v1' = string
//
// Pure JS, no DOM.

const LS_TEMPLATES = 'raschet.kp-templates.v1';
const LS_ACTIVE_ID = 'raschet.kp-templates.activeId.v1';

/**
 * Каталог доступных слотов. Каждый слот имеет:
 *   - id (стабильный ключ)
 *   - label (для editor UI)
 *   - tip (описание, что это за блок)
 *   - defaultOptions (per-slot настройки)
 *   - required (нельзя выключить — например, doc-title для приличия)
 */
export const SLOT_CATALOG = [
  { id: 'company-header',     label: '🏢 Шапка: реквизиты компании',           tip: 'Название организации, адрес, контакты, БИН/ИНН — из shared/company-profile.js (глобальные или per-project override).',
    defaultOptions: { showBin: true, showContacts: true } },
  { id: 'doc-title',          label: '📄 Заголовок: «Коммерческое предложение»', tip: 'Название документа — стандартный текст по центру.',
    defaultOptions: {}, required: true },
  { id: 'doc-meta',           label: '🔢 Номер КП + дата + название наряда',     tip: 'Подзаголовок: «№ord-1 от 2026-05-02 · «Монтаж: ...»».',
    defaultOptions: {}, required: true },
  { id: 'customer-info',      label: '👤 Информация о заказчике',                tip: 'Тип работ, заказчик, контакт, валюта расчётов.',
    defaultOptions: { showCurrency: true } },
  { id: 'positions-table',    label: '📋 Таблица позиций',                       tip: 'Состав работ и материалов. Опции: группировка по категориям, показывать ли колонку себестоимости (НЕ для отправки клиенту).',
    defaultOptions: { groupByCategory: true, showCostColumn: false }, required: true },
  { id: 'totals',             label: '💰 Итоги: без НДС / НДС / К оплате',       tip: 'Сводка по деньгам внизу.',
    defaultOptions: { showCostInTotals: false }, required: true },
  { id: 'notes',              label: '📝 Примечания (если заполнены)',           tip: 'Свободный текст из поля «Примечания» наряда. Скрывается если пусто.',
    defaultOptions: {} },
  { id: 'payment-requisites', label: '🏦 Платёжные реквизиты',                   tip: 'Банковские реквизиты из shared/company-profile.js. Скрывается если не заполнены.',
    defaultOptions: {} },
  { id: 'signatures',         label: '✍ Подписи (исполнитель / заказчик)',      tip: 'Места для подписей. Имя руководителя из company-profile.',
    defaultOptions: { showDirector: true } },
];

/** Дефолтный шаблон — все слоты enabled, порядок как в каталоге. */
export const DEFAULT_KP_TEMPLATE = {
  id: 'kp-default',
  name: 'Стандартный КП',
  slots: SLOT_CATALOG.map(s => ({
    id: s.id,
    enabled: true,
    options: { ...s.defaultOptions },
  })),
};

/** Прочитать все KP-шаблоны (с дефолтом если LS пуст). */
export function listKpTemplates() {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {}
  return [DEFAULT_KP_TEMPLATE];
}

/** Сохранить все шаблоны. */
export function saveKpTemplates(templates) {
  try {
    localStorage.setItem(LS_TEMPLATES, JSON.stringify(templates || [DEFAULT_KP_TEMPLATE]));
    _notifyChange();
  } catch {}
}

/** Получить активный шаблон (или дефолтный если не задан). */
export function getActiveKpTemplate() {
  const tpls = listKpTemplates();
  let id;
  try { id = JSON.parse(localStorage.getItem(LS_ACTIVE_ID) || '"kp-default"'); } catch {}
  return tpls.find(t => t.id === id) || tpls[0] || DEFAULT_KP_TEMPLATE;
}

export function setActiveKpTemplateId(id) {
  try { localStorage.setItem(LS_ACTIVE_ID, JSON.stringify(id)); _notifyChange(); } catch {}
}

/** Создать копию активного шаблона под новым именем. */
export function cloneKpTemplate(srcId, newName) {
  const tpls = listKpTemplates();
  const src = tpls.find(t => t.id === srcId) || DEFAULT_KP_TEMPLATE;
  const newId = 'kp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newId;
  copy.name = newName || (src.name + ' (копия)');
  tpls.push(copy);
  saveKpTemplates(tpls);
  return copy;
}

/** Удалить шаблон (default нельзя). */
export function deleteKpTemplate(id) {
  if (id === 'kp-default') return false;
  const tpls = listKpTemplates().filter(t => t.id !== id);
  if (!tpls.length) tpls.push(DEFAULT_KP_TEMPLATE);
  saveKpTemplates(tpls);
  return true;
}

/** Обновить шаблон (заменить целиком). */
export function updateKpTemplate(id, patch) {
  const tpls = listKpTemplates();
  const idx = tpls.findIndex(t => t.id === id);
  if (idx < 0) return false;
  tpls[idx] = { ...tpls[idx], ...patch, id };
  saveKpTemplates(tpls);
  return true;
}

/** Сбросить дефолтный шаблон к исходным значениям. */
export function resetDefaultKpTemplate() {
  const tpls = listKpTemplates();
  const idx = tpls.findIndex(t => t.id === 'kp-default');
  if (idx >= 0) tpls[idx] = { ...DEFAULT_KP_TEMPLATE };
  else tpls.unshift({ ...DEFAULT_KP_TEMPLATE });
  saveKpTemplates(tpls);
}

/* Pub/sub */
const _listeners = new Set();
export function onKpTemplatesChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
function _notifyChange() {
  _listeners.forEach(cb => { try { cb(); } catch {} });
  try { window.dispatchEvent(new CustomEvent('raschet:kp-templates-change')); } catch {}
}
