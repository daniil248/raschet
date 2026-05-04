// =============================================================================
// shared/catalogs/pdus/index.js — агрегатор каталога PDU
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md «подпапка-per-type,
// файл-per-vendor»). Split из shared/catalogs/pdus.js (5 вендоров).
//
// Экспорты (совместимость с прежним shared/catalogs/pdus.js):
//   PDU_CATEGORY, PDU_CATALOG,
//   listBuiltinPdus(), getLivePduCatalog(), pduBySku(sku).
// =============================================================================

import { _syncList, _slug } from '../_helpers.js';
import { APC_PDUS }     from './apc.js';
import { RITTAL_PDUS }  from './rittal.js';
import { CMO_PDUS }     from './cmo.js';
import { RARITAN_PDUS } from './raritan.js';
import { KEHUA_PDUS }   from './kehua.js';

export const PDU_CATEGORY = {
  basic:     'Базовый (без измерений)',
  metered:   'Metered (метеринг на вводе)',
  monitored: 'Metered-by-outlet (метеринг по розеткам)',
  switched:  'Switched (управление коммутацией)',
  hybrid:    'Monitored+Switched (метеринг+управление)',
};

export const PDU_CATALOG = [
  ...APC_PDUS,
  ...RITTAL_PDUS,
  ...CMO_PDUS,
  ...RARITAN_PDUS,
  ...KEHUA_PDUS,
];

export function pduBySku(sku) { return getLivePduCatalog().find(p => p.sku === sku) || null; }

/* ---------- маппинг в element-library ---------- */
export function listBuiltinPdus() {
  return PDU_CATALOG.map(p => {
    // v0.60.77: subKind = категория PDU (basic / metered / switched / hybrid /
    // monitored). Series = префикс sku (KPDU / AP / PX3 / TS / ...). Variant =
    // фазность + ток (1ф 16A / 3ф 32A) — small set.
    const skuPrefix = String(p.sku || '').match(/^([A-Z]+)/i);
    const series = skuPrefix ? skuPrefix[1] : '';
    return {
    id: 'pdu.' + _slug(p.sku),
    kind: 'pdu',
    subKind: PDU_CATEGORY[p.category] || p.category || '',
    category: 'equipment',
    label: p.name,
    description: `${PDU_CATEGORY[p.category] || p.category} · ${p.phases}-фаза · ${p.rating} A`,
    manufacturer: p.mfg,
    series: series,
    variant: `${p.phases}ф ${p.rating}A`,
    electrical: {
      voltageCategory: 'lv',
      phases: p.phases,
      capacityA: p.rating,
    },
    kindProps: {
      sku: p.sku,
      category: p.category,
      categoryLabel: PDU_CATEGORY[p.category] || p.category,
      phases: p.phases,
      rating: p.rating,
      height: p.height,
      outlets: p.outlets,
    },
    tags: [p.mfg, p.category].filter(Boolean),
    source: 'builtin', builtin: true,
    };
  });
}

export function getLivePduCatalog() {
  const live = _syncList('pdu');
  if (!live.length) return PDU_CATALOG;
  return live.map(el => {
    const kp = el.kindProps || {};
    const outlets = Array.isArray(kp.outlets) ? kp.outlets.map(o => ({
      type: o.type,
      count: Number(o.count ?? o.qty ?? 0),
    })) : [];
    return {
      sku:    kp.sku || el.variant || el.id,
      mfg:    el.manufacturer || '',
      category: kp.category || 'basic',
      name:   el.label || '',
      phases: Number(kp.phases || el.electrical?.phases || 1),
      rating: Number(kp.rating || el.electrical?.capacityA || 16),
      height: Number(kp.height || 0),
      outlets,
    };
  });
}
