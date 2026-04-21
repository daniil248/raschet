// ======================================================================
// shared/rack-accessories-catalog-data.js
// Каталог аксессуаров серверной стойки (kind='rack-accessory'):
// полки, кабельные органайзеры, охлаждение, постаменты. Выделен из
// shared/rack-catalog-data.js (v0.59.120).
//
// Экспорт:
//   ACC_CATEGORIES              — справочник категорий аксессуаров
//   ACCESSORY_CATALOG           — массив моделей
//   listBuiltinRackAccessories()— маппинг в element-library
//   getLiveAccessoryCatalog()   — с учётом override-правок
//   accBySku(sku)               — поиск по SKU
//   accessoryMatchesRackMfg()   — матчинг бренда аксессуара с брендом шкафа
//   accessoryMfgList()          — список производителей аксессуаров
// ======================================================================

import { _syncList } from './_helpers.js';

export const ACC_CATEGORIES = {
  'mounting': 'Монтаж / полки / постаменты',
  'cable':    'Кабель-менеджмент',
  'cooling':  'Охлаждение / воздушные потоки',
};

export const ACCESSORY_CATALOG = [
  // Kehua Wise (H-series)
  { sku: 'KSSH-710-BK',     name: 'Полка лёгкая 100 кг (light load laminate)',
    mfg: 'Kehua', category: 'mounting', note: 'Для стоек 1100/1200 мм, 100 кг' },
  { sku: 'KZZH-710-BK',     name: 'Полка тяжёлая 200 кг (heavy load laminate)',
    mfg: 'Kehua', category: 'mounting', note: 'Для стоек 1100/1200 мм, 200 кг' },
  { sku: 'KCHR-705-BK',     name: 'L-образные направляющие (L-tray)',
    mfg: 'Kehua', category: 'mounting', note: 'Под оборудование без рельс, 50 кг' },
  { sku: 'KCLD-F1U-BK',     name: 'Горизонтальный кабельный орг. 1U',
    mfg: 'Kehua', category: 'cable', note: 'Фронтальный кабель-менеджмент, U-posts' },
  { sku: 'KCMR-700-BK',     name: 'Внутренний кабельный менеджмент',
    mfg: 'Kehua', category: 'cable', note: 'Прокладка кабеля спереди назад внутри стойки' },
  { sku: 'KLXH-BK',         name: 'Кольцо-держатель кабеля (metal ring)',
    mfg: 'Kehua', category: 'cable', note: 'Металлич. кольцо, до 6 шт. на стойку (рекомендация)' },
  { sku: 'KCLB-42U100D-BK', name: 'Вертикальная кабель-гребёнка 42U',
    mfg: 'Kehua', category: 'cable', note: 'Для задней вертикальной прокладки, + 2 стяжки в комплекте' },
  { sku: 'KCLD-42U100D-BK', name: 'Вертикальный кабель-канал 42U (100×108 мм)',
    mfg: 'Kehua', category: 'cable', note: 'Пластик, вертикальный монтаж, для патч-кордов' },
  { sku: 'KHL-BASE-BK',     name: 'Анкерный постамент (anchor frame)',
    mfg: 'Kehua', category: 'mounting', note: 'Для антисейсмического крепления к полу' },
  { sku: 'KHL-BOTTOM-CAB',  name: 'Вводный короб снизу (bottom cable entry)',
    mfg: 'Kehua', category: 'cable', note: 'Нижний ввод кабеля, регулируемый' },
  // APC NetShelter
  { sku: 'AR8136BLK',  name: 'Горизонтальный кабельный орг. 1U с кольцами',
    mfg: 'APC', category: 'cable', note: 'NetShelter, 5 D-колец, металл' },
  { sku: 'AR8426A',    name: 'Кабельная направляющая 0U (пара)',
    mfg: 'APC', category: 'cable', note: 'Вертикальная, для 42U стоек' },
  { sku: 'AR8165A',    name: 'Вертикальный кабель-менеджмент 42U',
    mfg: 'APC', category: 'cable', note: 'С крышкой, ширина 150 мм' },
  { sku: 'AR8168BLK',  name: 'Полка 4-точечная, 114 кг',
    mfg: 'APC', category: 'mounting', note: 'NetShelter SX / AR, 19"' },
  { sku: 'AR7540',     name: 'Воздухораспределитель фронт-тыл 1U',
    mfg: 'APC', category: 'cooling', note: 'Пассивный, изоляция горячего коридора' },
  { sku: 'AR7710',     name: 'Blanking panel kit (аэроблок, не U-заглушка)',
    mfg: 'APC', category: 'cooling', note: 'Боковые щётки для изоляции, не 1U-заглушка' },
  // Rittal TS IT / VX25
  { sku: 'DK 7063.120', name: 'Полка 19" 482.6 мм, нагрузка 50 кг',
    mfg: 'Rittal', category: 'mounting', note: 'TS IT' },
  { sku: 'DK 7063.130', name: 'Полка усиленная, 100 кг',
    mfg: 'Rittal', category: 'mounting', note: 'TS IT, телескопическая' },
  { sku: 'DK 7111.235', name: 'Кабельная направляющая 19", 1U',
    mfg: 'Rittal', category: 'cable', note: 'Гребёнка' },
  { sku: 'DK 5502.135', name: 'Лесенка кабельная вертикальная',
    mfg: 'Rittal', category: 'cable', note: '42U, с монтажными уголками' },
  { sku: 'DK 7828.103', name: 'Кабельный лоток 600 мм',
    mfg: 'Rittal', category: 'cable', note: 'На крышу шкафа' },
  { sku: 'DK 3301.390', name: 'Фан-бокс 4×вентилятора на крыше',
    mfg: 'Rittal', category: 'cooling', note: '230 V, 950 м³/ч' },
  // Raritan / Minkels (Legrand)
  { sku: 'CMVS1U-01',   name: 'Горизонтальный кабель-менеджмент 1U',
    mfg: 'Raritan/Minkels', category: 'cable', note: 'С крышкой' },
  { sku: 'CMVV42U-02',  name: 'Вертикальный кабель-канал 42U',
    mfg: 'Raritan/Minkels', category: 'cable', note: 'Minkels NextGen, двухсторонний' },
  { sku: 'MNKSH-100',   name: 'Полка стационарная 100 кг',
    mfg: 'Raritan/Minkels', category: 'mounting', note: 'Minkels, регулируемая глубина' },
  { sku: 'MNKAD-19',    name: 'Адаптер 19" для 21" шкафа Minkels',
    mfg: 'Raritan/Minkels', category: 'mounting', note: 'Пара, L+R' },
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
  return ACCESSORY_CATALOG.map(a => ({
    id: 'rack-acc.' + _slug(a.sku),
    kind: 'rack-accessory',
    category: 'fitting',
    label: a.name,
    description: a.note || '',
    manufacturer: a.mfg,
    series: '',
    variant: a.sku,
    kindProps: {
      sku: a.sku,
      accCategory: a.category,
      accCategoryLabel: ACC_CATEGORIES[a.category] || a.category,
      note: a.note || '',
    },
    tags: [a.mfg, a.category].filter(Boolean),
    source: 'builtin', builtin: true,
  }));
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
