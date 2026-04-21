// ======================================================================
// shared/racks-catalog-data.js
// Каталог базовых комплектов серверных стоек 19" (kind='rack').
// Выделен из монолитного shared/rack-catalog-data.js (v0.59.120) — тип/
// категория в отдельном файле, чтобы добавлять модели можно было не
// задевая PDU и аксессуары.
//
// Экспорт:
//   KIT_CATALOG              — массив преднастроек
//   DOOR_LABEL / TOP_LABEL / BASE_LABEL / ENTRY_LABEL / LOCK_LABEL /
//   BLANK_LABEL / BLANK_U    — справочники для BOM/UI
//   listBuiltinRacks()       — маппинг в формат element-library
//   getLiveKitCatalog()      — учитывает override-правки catalog-admin
//   kitById(id)              — поиск по id с fallback на «Произвольную»
// ======================================================================

import { _syncList } from './_helpers.js';

/* ---------- справочные таблицы ---------- */
export const DOOR_LABEL = {
  glass:        'Дверь стекло одностворчатая',
  mesh:         'Дверь перфорированная одностворчатая',
  metal:        'Дверь металл глухая одностворчатая',
  'double-mesh':  'Дверь двустворчатая перфорированная',
  'double-glass': 'Дверь двустворчатая стеклянная',
  'double-metal': 'Дверь двустворчатая металл',
  none:         null,
};
export const TOP_LABEL = {
  solid: 'Крыша глухая',
  vent:  'Крыша вентилируемая',
  fan:   'Крыша с вентиляторными модулями (4×)',
};
export const BASE_LABEL = {
  feet:    'Комплект регулируемых ножек',
  casters: 'Комплект роликов',
  plinth:  'Цоколь',
};
export const ENTRY_LABEL = {
  brush: 'Кабельный ввод со щёткой',
  plug:  'Кабельный ввод-заглушка',
  pg:    'Кабельный ввод PG-сальник',
};
export const LOCK_LABEL = {
  key:     'Замок ключевой (отд. позиция)',
  code:    'Замок кодовый (отд. позиция)',
  electro: 'Электрозамок (отд. позиция)',
};
export const BLANK_LABEL = {
  '1U-solid': 'Заглушка 1U глухая',
  '1U-vent':  'Заглушка 1U перфорированная',
  '2U-solid': 'Заглушка 2U глухая',
};
export const BLANK_U = { '1U-solid': 1, '1U-vent': 1, '2U-solid': 2 };

/* ---------- каталог базовых комплектов ---------- */
export const KIT_CATALOG = [
  { id: '', sku: '', name: 'Произвольная конфигурация', includes: [], preset: {} },

  { id: 'apc-ar3100', sku: 'AR3100',
    name: 'APC NetShelter SX 42U 600×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'APC NetShelter SX', u: 42, width: 600, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet', comboTopBase: true } },
  { id: 'apc-ar3150', sku: 'AR3150',
    name: 'APC NetShelter SX 42U 750×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'APC NetShelter SX', u: 42, width: 800, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet', comboTopBase: true } },
  { id: 'cmo-shtk-m-42', sku: 'ШТК-М-42.6.10-44АА',
    name: 'ЦМО ШТК-М 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: { manufacturer: 'ЦМО ШТК-М', u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'rittal-ts-it-42', sku: 'TS IT 5528.110',
    name: 'Rittal TS IT 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'Rittal TS IT', u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-split', top: 'vent', base: 'feet', comboTopBase: true } },
  { id: 'hyperline-twb-24', sku: 'TWB-2466-SR-RAL9004',
    name: 'Hyperline TWB 24U 600×600 (настенный)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: { manufacturer: 'Hyperline TWB', u: 24, width: 600, depth: 600,
      doorFront: 'glass', doorRear: 'none', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },

  // === Kehua Data IT Cabinet — H series (welded, high-end) ===
  { id: 'kehua-hser-61042-mf', sku: 'HSER-61042BK-MF',
    name: 'Kehua H-series 42U 600×1000 (mesh/mesh)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'kehua-hser-61242-mf', sku: 'HSER-61242BK-MF',
    name: 'Kehua H-series 42U 600×1200 (mesh/mesh)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 600, depth: 1200,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'kehua-hser-81042-mf', sku: 'HSER-81042BK-MF',
    name: 'Kehua H-series 42U 800×1000 (mesh/mesh)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 800, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'kehua-hser-81242-mf', sku: 'HSER-81242BK-MF',
    name: 'Kehua H-series 42U 800×1200 (mesh/mesh)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 800, depth: 1200,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'kehua-hser-61242-gf', sku: 'HSER-61242BK-GF',
    name: 'Kehua H-series 42U 600×1200 (glass/mesh) — холодный коридор',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 600, depth: 1200,
      doorFront: 'glass', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
  { id: 'kehua-hser-61442-gm', sku: 'HSER-61442BK-GM',
    name: 'Kehua H-series 42U 600×1400 (glass/metal-double) — hot+cold aisle',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','cableEntryTop'],
    preset: { manufacturer: 'Kehua Data H-series', u: 42, width: 600, depth: 1400,
      doorFront: 'glass', doorRear: 'double-metal', doorWithLock: true,
      sides: 'pair-sku', top: 'solid', base: 'feet' } },
];

export function kitById(id) {
  const live = getLiveKitCatalog();
  return live.find(k => k.id === id) || live[0] || KIT_CATALOG[0];
}

/* ---------- маппинг в element-library ---------- */
export function listBuiltinRacks() {
  return KIT_CATALOG.filter(k => k.id).map(k => {
    const p = k.preset || {};
    return {
      id: 'rack.' + k.id,
      kind: 'rack',
      category: 'equipment',
      label: k.name,
      description: `Базовый комплект серверной стойки 19", ${p.u}U ${p.width}×${p.depth} мм`,
      manufacturer: p.manufacturer || '',
      series: '',
      variant: k.sku,
      geometry: {
        widthMm: p.width, depthMm: p.depth,
        heightMm: (p.u || 0) * 44.45 + 150,
      },
      kindProps: {
        sku: k.sku,
        kitId: k.id,
        u: p.u, width: p.width, depth: p.depth,
        doorFront: p.doorFront, doorRear: p.doorRear,
        doorWithLock: p.doorWithLock,
        sides: p.sides, top: p.top, base: p.base,
        comboTopBase: p.comboTopBase,
        includes: k.includes,
      },
      tags: [p.manufacturer].filter(Boolean),
      source: 'builtin', builtin: true,
    };
  });
}

/** Всегда-актуальный KIT_CATALOG с учётом override-правок. */
export function getLiveKitCatalog() {
  const live = _syncList('rack');
  if (!live.length) return KIT_CATALOG;
  const out = [{ id: '', sku: '', name: 'Произвольная конфигурация', includes: [], preset: {} }];
  for (const el of live) {
    const kp = el.kindProps || {};
    out.push({
      id:   kp.kitId || el.id.replace(/^rack\./, ''),
      sku:  kp.sku || el.variant || '',
      name: el.label || '',
      includes: Array.isArray(kp.includes) ? kp.includes : [],
      preset: {
        manufacturer: el.manufacturer || '',
        u: kp.u, width: kp.width, depth: kp.depth,
        doorFront: kp.doorFront, doorRear: kp.doorRear,
        doorWithLock: kp.doorWithLock,
        sides: kp.sides, top: kp.top, base: kp.base,
        comboTopBase: kp.comboTopBase,
      },
    });
  }
  return out;
}
