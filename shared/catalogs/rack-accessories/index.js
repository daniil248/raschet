// =============================================================================
// shared/catalogs/rack-accessories/index.js — агрегатор аксессуаров
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md «подпапка-per-type,
// файл-per-vendor»). Split из shared/catalogs/rack-accessories.js.
//
// Экспорты (совместимость с прежним shared/catalogs/rack-accessories.js):
//   ACC_CATEGORIES, ACCESSORY_CATALOG,
//   listBuiltinRackAccessories(), getLiveAccessoryCatalog(), accBySku(sku),
//   accessoryMatchesRackMfg(), accessoryMfgList().
// =============================================================================

import { _syncList } from '../_helpers.js';
import { KEHUA_RACK_ACCESSORIES }   from './kehua.js';
import { APC_RACK_ACCESSORIES }     from './apc.js';
import { RITTAL_RACK_ACCESSORIES }  from './rittal.js';
import { RARITAN_RACK_ACCESSORIES } from './raritan.js';

export const ACC_CATEGORIES = {
  'mounting': 'Монтаж / полки / постаменты',
  'cable':    'Кабель-менеджмент',
  'cooling':  'Охлаждение / воздушные потоки',
};

export const ACCESSORY_CATALOG = [
  ...KEHUA_RACK_ACCESSORIES,
  ...APC_RACK_ACCESSORIES,
  ...RITTAL_RACK_ACCESSORIES,
  ...RARITAN_RACK_ACCESSORIES,
];

export function accBySku(sku) { return getLiveAccessoryCatalog().find(a => a.sku === sku) || null; }

// Матчинг бренда аксессуара с брендом шкафа (case-insensitive substring)
export function accessoryMatchesRackMfg(acc, rackMfg) {
  if (!rackMfg) return false;
  const r = String(rackMfg).toLowerCase();
  const a = String(acc.mfg || '').toLowerCase();
  if (!a) return false;
  return a.split(/[\/\s]+/).some(tok => tok && r.includes(tok));
}

export function accessoryMfgList() {
  const set = new Set();
  ACCESSORY_CATALOG.forEach(a => set.add(a.mfg));
  return Array.from(set).sort();
}

/* ---------- маппинг в element-library ---------- */
export function listBuiltinRackAccessories() {
  return ACCESSORY_CATALOG.map(a => {
    // v0.60.77: subKind = accessory category (mounting/cable/cooling/...),
    // series = префикс sku. variant убран (sku в id и label).
    const skuPrefix = String(a.sku || '').match(/^([A-Z]+)/i);
    const series = skuPrefix ? skuPrefix[1] : '';
    return {
    id: 'rack-acc.' + _slug(a.sku),
    kind: 'rack-accessory',
    subKind: ACC_CATEGORIES[a.category] || a.category || '',
    category: 'fitting',
    label: a.name,
    description: a.note || '',
    manufacturer: a.mfg,
    series: series,
    variant: '',
    kindProps: {
      sku: a.sku,
      accCategory: a.category,
      accCategoryLabel: ACC_CATEGORIES[a.category] || a.category,
      note: a.note || '',
    },
    tags: [a.mfg, a.category].filter(Boolean),
    source: 'builtin', builtin: true,
    };
  });
}

export function getLiveAccessoryCatalog() {
  const live = _syncList('rack-accessory');
  if (!live.length) return ACCESSORY_CATALOG;
  return live.map(el => {
    const kp = el.kindProps || {};
    return {
      sku:      kp.sku || el.variant || el.id,
      mfg:      el.manufacturer || '',
      category: kp.accCategory || 'other',
      name:     el.label || '',
      note:     kp.note || el.description || '',
    };
  });
}

// локальный _slug (дублируем из helpers — чтобы не вводить второй import
// для одного вызова в listBuiltin…())
function _slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}
