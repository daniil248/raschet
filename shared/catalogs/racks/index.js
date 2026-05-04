// =============================================================================
// shared/catalogs/racks/index.js — агрегатор каталога серверных стоек
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md «подпапка-per-type,
// файл-per-vendor»). Split из shared/catalogs/racks.js (5+ вендоров).
//
// Экспорты (совместимость с прежним shared/catalogs/racks.js):
//   KIT_CATALOG, DOOR_LABEL, TOP_LABEL, BASE_LABEL, ENTRY_LABEL,
//   LOCK_LABEL, BLANK_LABEL, BLANK_U,
//   listBuiltinRacks(), getLiveKitCatalog(), kitById(id).
// =============================================================================

import { _syncList } from '../_helpers.js';
import { APC_RACK_KITS }       from './apc.js';
import { CMO_RACK_KITS }       from './cmo.js';
import { RITTAL_RACK_KITS }    from './rittal.js';
import { HYPERLINE_RACK_KITS } from './hyperline.js';
import { KEHUA_RACK_KITS }     from './kehua.js';

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

/* ---------- агрегированный каталог ---------- */
export const KIT_CATALOG = [
  { id: '', sku: '', name: 'Произвольная конфигурация', includes: [], preset: {} },
  ...APC_RACK_KITS,
  ...CMO_RACK_KITS,
  ...RITTAL_RACK_KITS,
  ...HYPERLINE_RACK_KITS,
  ...KEHUA_RACK_KITS,
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
      subKind: `${p.u}U`,                    // v0.60.77: подтип = высота (24U / 42U)
      category: 'equipment',
      label: k.name,
      description: `Базовый комплект серверной стойки 19", ${p.u}U ${p.width}×${p.depth} мм`,
      manufacturer: p.manufacturer || '',
      series: p.series || '',
      variant: `${p.width}×${p.depth} мм`,   // v0.60.77: вариант = размер
      sku: k.sku,                            // sku отдельно (раньше был в variant)
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
