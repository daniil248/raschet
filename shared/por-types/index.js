// shared/por-types/index.js
// Регистрация всех известных POR-типов. Сторонние модули могут
// регистрировать свои типы через registerPorType(typeDef) — например,
// shared/ups-types-por.js может регистрировать конкретные подтипы ИБП
// (monoblock / modular / all-in-one) с собственными views.
//
// Контракт type-definition (см. rack.js, containers.js, consumer-group.js):
//   {
//     id:               string,           // 'rack', 'panel', …
//     label:            string,           // 'Стойка', …
//     icon:             string,           // '🗄', …
//     category:         'equipment' | 'container' | 'connector' | 'aggregator',
//     defaultDomains:   string[],         // какие domains у объекта по умолчанию
//     inspectorPanels:  string[],         // порядок вкладок в инспекторе
//     factory:          (opts) => partial POR-object,
//     views?:           { [pageKind]: render-функция / стат. описание },
//     groupElectricalKeys?: string[],     // для type-ов которые могут быть в consumer-group
//     validate?:        (obj) => { ok, errors[] },
//   }

import { RACK_TYPE } from './rack.js';
import { CONTAINER_TYPES } from './containers.js';
import { CONSUMER_GROUP_TYPE } from './consumer-group.js';
import { CONSUMER_SYSTEM_TYPE } from './consumer-system.js';

const _registry = new Map();

/** Регистрация type-definition. Если id уже существует — переопределяет. */
export function registerPorType(typeDef) {
  if (!typeDef || !typeDef.id || typeof typeDef.factory !== 'function') {
    console.warn('[por-types] registerPorType: invalid def', typeDef);
    return;
  }
  _registry.set(typeDef.id, typeDef);
}

export function getPorType(id) { return _registry.get(id) || null; }
export function listPorTypes() { return [..._registry.values()]; }
export function listPorTypeIds() { return [..._registry.keys()]; }

// ── Регистрация built-in типов ─────────────────────────────────────
registerPorType(RACK_TYPE);
registerPorType(CONSUMER_GROUP_TYPE);
registerPorType(CONSUMER_SYSTEM_TYPE);
for (const t of CONTAINER_TYPES) registerPorType(t);

// Известные категории type-definition (из .category поля). Используется
// палитрами / UI для группировки. Системы не имеют габаритов и могут
// требовать иной UI чем equipment.
export const POR_TYPE_CATEGORIES = ['equipment', 'system', 'container', 'aggregator', 'connector'];

/** Перечислить type-definitions с указанной категорией. */
export function listPorTypesByCategory(category) {
  return listPorTypes().filter(t => t.category === category);
}

// Удобство: агрегированный набор groupElectricalKeys для типов которые
// могут быть в consumer-group (если type не объявил свой — defaults).
export const DEFAULT_GROUP_ELECTRICAL_KEYS = ['phases', 'cosPhi', 'demandKw', 'voltageV'];

if (typeof window !== 'undefined') {
  window.RaschetPORTypes = { registerPorType, getPorType, listPorTypes, listPorTypeIds };
}
