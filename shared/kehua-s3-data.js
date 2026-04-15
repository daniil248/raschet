// ======================================================================
// shared/kehua-s3-data.js
// Встроенный справочник Kehua S3 Li-Ion (LFP). Источник: Kehua S³
// Smart Backup Li-Ion Battery System Brochure 2023-11-16.
//
// АРХИТЕКТУРА:
//   S3 — модульная система. Основа расчёта — модуль (battery pack),
//   а шкаф — это металлический корпус, в который ставится до 20 или 12
//   модулей. Поэтому в каталог загружаются обе категории:
//
//   1) МОДУЛИ (systemSubtype: 'module') — участвуют в расчёте
//      автономии. Пользователь в модалке АКБ выбирает один из 3 модулей
//      и задаёт их количество. Per-module таблица разряда выведена из
//      конфиг-таблиц брошюры (страница 5).
//
//   2) ШКАФЫ (systemSubtype: 'cabinet') — metadata: какую ёмкость
//      и мощность даёт «набитый» шкаф, сколько модулей вмещает,
//      максимум параллельных шкафов. В UI UPS battery modal эти
//      записи скрываются из пикера — они видны только в общем
//      справочнике battery/ как справочная информация.
//
// СВЯЗЬ МОДУЛЬ ↔ ШКАФ (поле packaging в модуле):
//   {
//     cabinetModel:     'S3C040-6C-20-MX',  // в какой шкаф ставится
//     maxPerCabinet:    20,                  // макс. модулей на шкаф
//     cabinetPowerKw:   200,                 // мощность полного шкафа
//     cabinetKwh:       41,                  // ёмкость полного шкафа
//     maxCabinets:      15,                  // макс. параллельных шкафов
//     dcOutputV:        '240 / ±240 / 480',  // варианты выхода DC/DC
//   }
//
// РАСЧЁТ: powerPerModule = loadKw × 1000 / (invEff × totalModules)
//         totalModules   = modulesPerCabinet × cabinetsInParallel
//         totalModules   ≤ maxPerCabinet × maxCabinets
//
// Совместимость: все ИБП Kehua 6-1200 кВт (MR33, MR11, KR33, KR11 и др.).
// ======================================================================

// ========== МОДУЛИ (battery packs) ==========
// Per-module discharge table выведена из конфиг-таблиц брошюры обратным
// ходом: для UPS=60 кВт и 10 мин нужно 6 модулей × 10 кВт → 1 модуль
// отдаёт 10 кВт в течение 10 мин. Аналогично для 20 мин: 12 модулей ×
// 5 кВт. Для 100Ah: 1 модуль 5 кВт/1ч, 2.5 кВт/2ч, 1.25 кВт/4ч.
export const KEHUA_S3_MODULES = [
  {
    id: 'kehua-s3m040-6c-240-x',
    supplier: 'Kehua',
    type: 'S3M040-6C-240-X',
    chemistry: 'li-ion',
    blockVoltage: 240,          // DC/DC output voltage (module-level)
    cellVoltage: 3.2,
    cellCount: 16,              // 51.2 В pack / 3.2 В на элемент LFP
    capacityAh: 40,             // паспортная ёмкость модуля
    dischargeTable: [
      { endV: 2.5, tMin: 10, powerW: 10000 },   // rated 10 kW
      { endV: 2.5, tMin: 20, powerW: 5000 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'module',    // участвует в расчёте автономии
    systemDescription: 'Модуль S3M040-6C-240 · 40 А·ч LFP · rated 10 кВт / 10 мин. Ставится в шкаф S3C040-6C-20-MX (до 20 модулей).',
    packaging: {
      cabinetModel: 'S3C040-6C-20-MX',
      maxPerCabinet: 20,
      cabinetPowerKw: 200,
      cabinetKwh: 41,
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
    },
    moduleWeightKg: 36,
    moduleDimensionsMm: '223×665×152',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Совместим со всеми ИБП Kehua 6-1200 кВт (MR33, MR11, KR33, KR11, MY, MYA, Eon).',
  },
  {
    id: 'kehua-s3m050-4c-240-x',
    supplier: 'Kehua',
    type: 'S3M050-4C-240-X',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 18,              // 57.6 В / 3.2 В
    capacityAh: 50,
    dischargeTable: [
      { endV: 2.5, tMin: 15, powerW: 10000 },
      { endV: 2.5, tMin: 30, powerW: 5000 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'module',
    systemDescription: 'Модуль S3M050-4C-240 · 50 А·ч LFP · rated 10 кВт / 15 мин. Ставится в шкаф S3C050-4C-20-MX (до 20 модулей).',
    packaging: {
      cabinetModel: 'S3C050-4C-20-MX',
      maxPerCabinet: 20,
      cabinetPowerKw: 200,
      cabinetKwh: 58,
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
    },
    moduleWeightKg: 38,
    moduleDimensionsMm: '223×665×152',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Совместим со всеми ИБП Kehua 6-1200 кВт',
  },
  {
    id: 'kehua-s3m100-1c-240-x',
    supplier: 'Kehua',
    type: 'S3M100-1C-240-X',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 18,
    capacityAh: 100,
    dischargeTable: [
      { endV: 2.5, tMin: 60,  powerW: 5000 },    // rated 5 kW / 1h
      { endV: 2.5, tMin: 120, powerW: 2500 },
      { endV: 2.5, tMin: 240, powerW: 1250 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'module',
    systemDescription: 'Модуль S3M100-1C-240 · 100 А·ч LFP · rated 5 кВт / 1 ч (long-time backup). Ставится в шкаф S3C100-1C-12-MX (до 12 модулей).',
    packaging: {
      cabinetModel: 'S3C100-1C-12-MX',
      maxPerCabinet: 12,
      cabinetPowerKw: 60,
      cabinetKwh: 69,
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
    },
    moduleWeightKg: 50,
    moduleDimensionsMm: '440×665×132',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Для длительного резервирования 1…4 ч. Совместим со всеми ИБП Kehua 6-1200 кВт.',
  },
];

// ========== ШКАФЫ (cabinets) ==========
// Информационные записи — metadata о корпусах. В UI UPS battery modal
// скрываются из пикера (systemSubtype === 'cabinet' фильтруется).
// Видны только в общем справочнике battery/ как справочная информация
// для BOM и компоновки.
export const KEHUA_S3_CABINETS = [
  {
    id: 'kehua-s3c040-6c-20-mx',
    supplier: 'Kehua',
    type: 'S3C040-6C-20-MX',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 16,
    capacityAh: 800,           // 20 × 40 А·ч
    dischargeTable: [],         // пустая — расчёт ведётся по модулю
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'cabinet',   // НЕ участвует в расчёте — только metadata
    systemDescription: 'Шкаф 41 кВт·ч · 200 кВт · 20 ячеек под модули S3M040-6C-240. Габариты 600×860×2000 мм, масса 960 кг.',
    cabinetKwh: 41,
    cabinetPowerKw: 200,
    modulesPerCabinet: 20,
    moduleModel: 'S3M040-6C-240-X',
    maxParallelCabinets: 15,
    cabinetWeightKg: 960,
    cabinetDimensionsMm: '600×860×2000',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Шкаф — корпус для модулей S3M040. Для расчёта автономии используйте запись модуля.',
  },
  {
    id: 'kehua-s3c050-4c-20-mx',
    supplier: 'Kehua',
    type: 'S3C050-4C-20-MX',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 18,
    capacityAh: 1000,
    dischargeTable: [],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'cabinet',
    systemDescription: 'Шкаф 58 кВт·ч · 200 кВт · 20 ячеек под модули S3M050-4C-240. Габариты 600×860×2000 мм, масса 1000 кг.',
    cabinetKwh: 58,
    cabinetPowerKw: 200,
    modulesPerCabinet: 20,
    moduleModel: 'S3M050-4C-240-X',
    maxParallelCabinets: 15,
    cabinetWeightKg: 1000,
    cabinetDimensionsMm: '600×860×2000',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Шкаф — корпус для модулей S3M050. Для расчёта автономии используйте запись модуля.',
  },
  {
    id: 'kehua-s3c100-1c-12-mx',
    supplier: 'Kehua',
    type: 'S3C100-1C-12-MX',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 18,
    capacityAh: 1200,
    dischargeTable: [],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'cabinet',
    systemDescription: 'Шкаф 69 кВт·ч · 60 кВт · 12 ячеек под модули S3M100-1C-240. Габариты 600×860×2000 мм, масса 860 кг. Для длительного резервирования 1…4 ч.',
    cabinetKwh: 69,
    cabinetPowerKw: 60,
    modulesPerCabinet: 12,
    moduleModel: 'S3M100-1C-240-X',
    maxParallelCabinets: 15,
    cabinetWeightKg: 860,
    cabinetDimensionsMm: '600×860×2000',
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Шкаф — корпус для модулей S3M100. Для расчёта автономии используйте запись модуля.',
  },
];

// Объединённый экспорт для загрузки одной кнопкой.
// При загрузке каталога S3 получает ВСЁ: 3 модуля + 3 шкафа.
export const KEHUA_S3_BATTERIES = [...KEHUA_S3_MODULES, ...KEHUA_S3_CABINETS];
