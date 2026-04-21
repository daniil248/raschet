// ======================================================================
// shared/pdus-catalog-data.js
// Каталог блоков распределения питания PDU (kind='pdu').
// Выделен из shared/rack-catalog-data.js (v0.59.120).
//
// Экспорт:
//   PDU_CATEGORY          — справочник категорий (basic/metered/…)
//   PDU_CATALOG           — массив моделей (APC, Rittal, Raritan, Kehua)
//   listBuiltinPdus()     — маппинг в формат element-library
//   getLivePduCatalog()   — с учётом override-правок catalog-admin
//   pduBySku(sku)         — поиск по SKU
// ======================================================================

import { _syncList, _slug } from './_helpers.js';

export const PDU_CATEGORY = {
  basic:     'Базовый (без измерений)',
  metered:   'Metered (метеринг на вводе)',
  monitored: 'Metered-by-outlet (метеринг по розеткам)',
  switched:  'Switched (управление коммутацией)',
  hybrid:    'Monitored+Switched (метеринг+управление)',
};

export const PDU_CATALOG = [
  // APC
  { sku: 'AP7820B',  mfg: 'APC',    category: 'basic',
    name: 'APC Basic Rack PDU, 1U, 1ф 16A, 8×C13',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }] },
  { sku: 'AP7921B',  mfg: 'APC',    category: 'switched',
    name: 'APC Rack PDU 2G Switched, ZeroU, 1ф 16A, 8×C13 + 8×C19',
    phases: 1, rating: 16, height: 0,
    outlets: [{ type:'C13', count:8 }, { type:'C19', count:8 }] },
  { sku: 'AP8959',   mfg: 'APC',    category: 'metered',
    name: 'APC Rack PDU 2G Metered, ZeroU, 3ф 32A, 21×C13 + 3×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:21 }, { type:'C19', count:3 }] },
  { sku: 'AP7952',   mfg: 'APC',    category: 'switched',
    name: 'APC Rack PDU 2G Switched, ZeroU, 3ф 16A, 21×C13 + 3×C19',
    phases: 3, rating: 16, height: 0,
    outlets: [{ type:'C13', count:21 }, { type:'C19', count:3 }] },
  { sku: 'AP7998B',  mfg: 'APC',    category: 'monitored',
    name: 'APC Rack PDU 2G Metered-by-outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'APDU9959', mfg: 'APC',    category: 'hybrid',
    name: 'APC 9000-series Monitored+Switched, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Rittal
  { sku: 'DK 7856.200', mfg: 'Rittal', category: 'basic',
    name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×Schuko',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'DK 7955.310', mfg: 'Rittal', category: 'metered',
    name: 'Rittal PDU metered, ZeroU, 3ф 16A, 24×C13 + 6×C19',
    phases: 3, rating: 16, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.410', mfg: 'Rittal', category: 'switched',
    name: 'Rittal PDU switched, ZeroU, 3ф 32A, 24×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.510', mfg: 'Rittal', category: 'hybrid',
    name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 32A, 24×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // Raritan / Minkels
  { sku: 'PX2-1464',     mfg: 'Raritan/Minkels', category: 'basic',
    name: 'Raritan PX2 basic, 1U, 1ф 16A, 8×C13 + 4×Schuko',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }, { type:'Schuko', count:4 }] },
  { sku: 'PX3-5190',     mfg: 'Raritan/Minkels', category: 'metered',
    name: 'Raritan PX3 iPDU metered, ZeroU, 3ф 16A, 30×C13',
    phases: 3, rating: 16, height: 0,
    outlets: [{ type:'C13', count:30 }] },
  { sku: 'PX3-1491R',    mfg: 'Raritan/Minkels', category: 'monitored',
    name: 'Raritan PX3 iPDU metered-by-outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19',
    phases: 1, rating: 32, height: 0,
    outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'PX3-5493V',    mfg: 'Raritan/Minkels', category: 'hybrid',
    name: 'Raritan PX3 iPDU metered+switched, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Kehua
  { sku: 'KPDU-B1F16-08C13', mfg: 'Kehua', category: 'basic',
    name: 'Kehua PDU basic, 1U, 1ф 16A, 8×C13',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }] },
  { sku: 'KPDU-M3F32-24C13-06C19', mfg: 'Kehua', category: 'metered',
    name: 'Kehua PDU metered, ZeroU, 3ф 32A, 24×C13 + 6×C19, LED-дисплей',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'KPDU-S3F32-24C13-06C19', mfg: 'Kehua', category: 'switched',
    name: 'Kehua PDU switched, ZeroU, 3ф 32A, 24×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'KPDU-H3F32-36C13-06C19', mfg: 'Kehua', category: 'hybrid',
    name: 'Kehua PDU hybrid (метеринг+упр.), ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
];

export function pduBySku(sku) { return getLivePduCatalog().find(p => p.sku === sku) || null; }

/* ---------- маппинг в element-library ---------- */
export function listBuiltinPdus() {
  return PDU_CATALOG.map(p => ({
    id: 'pdu.' + _slug(p.sku),
    kind: 'pdu',
    category: 'equipment',
    label: p.name,
    description: `${PDU_CATEGORY[p.category] || p.category} · ${p.phases}-фаза · ${p.rating} A`,
    manufacturer: p.mfg,
    series: '',
    variant: p.sku,
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
  }));
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
