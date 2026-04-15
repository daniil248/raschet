// ======================================================================
// shared/kehua-s3-data.js
// Встроенный справочник литий-ионных батарейных систем Kehua S3 (LFP).
// Источник: Kehua S3 Smart Backup Li-Ion Battery System Brochure 20231116
// и MR33 200-500k Brochure 2025-02-18.
//
// Продукты S3 — НЕ обычные батареи, а шкафы с модулями, каждый модуль
// с собственным DC/DC-преобразователем на 240 В. В нашей модели
// справочника ОДНА запись = ОДИН ШКАФ: его полная ёмкость kWh, номинал
// kW и таблица разряда (производная из конфигурационных таблиц из
// брошюры). blockVoltage зафиксирован = 240 В (выход одного шкафа).
//
// Совместимость: ИБП Kehua (вся линейка, 6-1200 кВт), включая MR33.
// Для MR33 с шиной ±240 В пользователь выставляет blocksPerString = 2
// (два шкафа последовательно), strings = параллели. Максимум 15
// параллельных шкафов по спецификации.
// ======================================================================

// Конфигурационные таблицы из брошюры S3 (страница 5) дают требуемое
// число шкафов/модулей для разных времён резерва. Обратным ходом получаем
// P/шкаф для каждой точки времени:
//
//   40Ah модуль @ 10 кВт rated:
//     60 кВт × 10 мин → 6 модулей → 1 модуль ≈ 10 кВт @ 10 мин
//     60 кВт × 20 мин → 12 модулей → 1 модуль ≈ 5 кВт @ 20 мин
//   → Шкаф (20 модулей): 200 кВт × 10 мин, 100 кВт × 20 мин
//
//   50Ah модуль @ 10 кВт rated:
//     Шкаф (20 модулей): 200 кВт × 15 мин, 100 кВт × 30 мин
//
//   100Ah модуль @ 5 кВт rated:
//     Шкаф (12 модулей): 60 кВт × 1 ч, 30 кВт × 2 ч, 15 кВт × 4 ч

export const KEHUA_S3_BATTERIES = [
  {
    id: 'kehua-s3c040-6c-20-mx',
    supplier: 'Kehua',
    type: 'S3C040-6C-20-MX',
    chemistry: 'li-ion',
    // Шкаф 41 кВт·ч, 200 кВт, 240 В DC (выход DC/DC-преобразователей)
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 75,         // 240 В / 3.2 В на элемент LFP
    capacityAh: 171,       // 41000 Вт·ч / 240 В ≈ 170.8 А·ч эквивалент
    dischargeTable: [
      // tMin / powerW — при ближайшем endV (для LFP cut-off ≈ 2.5 В/эл.)
      { endV: 2.5, tMin: 10, powerW: 200000 },
      { endV: 2.5, tMin: 20, powerW: 100000 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    // Расширенные поля Kehua S3 (используются UI для явной маркировки)
    isSystem: true,
    systemType: 'kehua-s3',
    systemDescription: 'Шкаф 41 кВт·ч, 200 кВт (short-time backup). 20 модулей S3M040-6C-240 по 40 А·ч / 10 кВт. Выход DC/DC 240 / ±240 / 480 В. LFP-химия, ресурс 5000 циклов @ 50% DOD, срок службы ~10 лет.',
    moduleModel: 'S3M040-6C-240-X',
    modulesPerCabinet: 20,
    moduleRatedKw: 10,
    cabinetKwh: 41,
    cabinetPowerKw: 200,
    maxParallelCabinets: 15,
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Совместим со всеми ИБП Kehua 6-1200 кВт (включая MR33, MR11, KR33, KR11 и др.)',
  },
  {
    id: 'kehua-s3c050-4c-20-mx',
    supplier: 'Kehua',
    type: 'S3C050-4C-20-MX',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 75,
    capacityAh: 242,       // 58000 / 240 ≈ 241.7
    dischargeTable: [
      { endV: 2.5, tMin: 15, powerW: 200000 },
      { endV: 2.5, tMin: 30, powerW: 100000 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemDescription: 'Шкаф 58 кВт·ч, 200 кВт (medium-time backup). 20 модулей S3M050-4C-240 по 50 А·ч / 10 кВт. Выход DC/DC 240 / ±240 / 480 В. LFP, 5000 циклов @ 50% DOD.',
    moduleModel: 'S3M050-4C-240-X',
    modulesPerCabinet: 20,
    moduleRatedKw: 10,
    cabinetKwh: 58,
    cabinetPowerKw: 200,
    maxParallelCabinets: 15,
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Совместим со всеми ИБП Kehua 6-1200 кВт',
  },
  {
    id: 'kehua-s3c100-1c-12-mx',
    supplier: 'Kehua',
    type: 'S3C100-1C-12-MX',
    chemistry: 'li-ion',
    blockVoltage: 240,
    cellVoltage: 3.2,
    cellCount: 75,
    capacityAh: 288,       // 69000 / 240 = 287.5
    dischargeTable: [
      { endV: 2.5, tMin: 60,  powerW: 60000 },
      { endV: 2.5, tMin: 120, powerW: 30000 },
      { endV: 2.5, tMin: 240, powerW: 15000 },
    ],
    source: 'Kehua S3 Brochure 2023-11-16',
    importedAt: 0,
    custom: false,
    isSystem: true,
    systemType: 'kehua-s3',
    systemDescription: 'Шкаф 69 кВт·ч, 60 кВт (long-time backup, 1…4 часа). 12 модулей S3M100-1C-240 по 100 А·ч / 5 кВт. Выход DC/DC 240 / ±240 / 480 В. LFP, 5000 циклов @ 50% DOD.',
    moduleModel: 'S3M100-1C-240-X',
    modulesPerCabinet: 12,
    moduleRatedKw: 5,
    cabinetKwh: 69,
    cabinetPowerKw: 60,
    maxParallelCabinets: 15,
    compatibleSupplier: 'Kehua',
    compatibleNotes: 'Совместим со всеми ИБП Kehua 6-1200 кВт — для длительного резервирования 1…4 ч',
  },
];
