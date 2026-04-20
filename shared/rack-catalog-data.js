// ======================================================================
// shared/rack-catalog-data.js
// Централизованные данные каталога серверной 19" инфраструктуры:
//   • базовые комплекты стоек (kind='rack')
//   • PDU — блоки распределения питания (kind='pdu')
//   • аксессуары стоек (kind='rack-accessory')
//
// Все три набора регистрируются в единой element-library через
// shared/catalog-bridge.js. Конфигуратор стоек (rack-config/) и
// общая страница «Каталог и библиотека элементов» получают данные
// из одного источника (listElements({kind:…})) и могут применять
// одинаковые фильтры.
//
// Справочные таблицы (DOOR_LABEL, TOP_LABEL, …) — реэкспортируются
// для конфигуратора: подписи в BOM и UI.
// ======================================================================

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

/* ---------- каталог базовых комплектов (rack kits) ---------- */
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

/* ---------- каталог аксессуаров стойки ---------- */
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

/* ---------- каталог PDU ---------- */
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
export function accBySku(sku) { return getLiveAccessoryCatalog().find(a => a.sku === sku) || null; }
export function kitById(id)   {
  const live = getLiveKitCatalog();
  return live.find(k => k.id === id) || live[0] || KIT_CATALOG[0];
}

/* ---------- Live-геттеры (v0.58.74) ----------
   Читают элементы из element-library через listElements() — это
   включает override-правки, внесённые в Каталоге. Если library ещё
   не инициализирована (listElements вернул 0 для нашего kind) —
   возвращаем статический массив как fallback.
   Формат выдачи совпадает с исходными KIT_CATALOG / PDU_CATALOG /
   ACCESSORY_CATALOG — поэтому rack-config работает без изменений
   контракта данных. */

let __listElements = null;
async function _ensureLib() {
  if (__listElements) return __listElements;
  try {
    const m = await import('./element-library.js');
    __listElements = m.listElements;
  } catch { __listElements = () => []; }
  return __listElements;
}
// Синхронная версия: используем уже-загруженный listElements (kэш).
// Первый вызов до init вернёт статику — это ок, rack-config делает
// re-render при изменениях library (подпишемся отдельно).
function _syncList(kind) {
  try {
    if (!__listElements && globalThis.__raschetElementLibrary?.listElements) {
      __listElements = globalThis.__raschetElementLibrary.listElements;
    }
    if (__listElements) return __listElements({ kind });
  } catch {}
  return [];
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

/** Всегда-актуальный PDU_CATALOG с учётом override-правок. */
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

/** Всегда-актуальный ACCESSORY_CATALOG с учётом override-правок. */
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

// Первая инициализация (асинхронная) — чтобы __listElements кэш был готов
// к моменту первого re-render'а rack-config.
_ensureLib();

/* ---------- Маппинг в Element-формат для element-library ----------
   Регистрируется через catalog-bridge как builtin. Элементы появляются
   на странице «Каталог и библиотека» в соответствующих kind-секциях. */

function _slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

// rack (kit) → Element
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
        heightMm: (p.u || 0) * 44.45 + 150, // U → мм, приближённо + рама
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

// pdu → Element
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

// rack-accessory → Element
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
