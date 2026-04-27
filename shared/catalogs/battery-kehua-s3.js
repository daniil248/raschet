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
    systemDescription: 'Модуль S3M040-6C-240-X · 40 А·ч LFP · rated 10 кВт / 10 мин. Ставится в шкаф S3C040-6C-20-MX (до 20 модулей).',
    packaging: {
      cabinetModel: 'S3C040-6C-20',
      cabinetVariants: ['-M', '-S', '-S2', '-M1', '-M2'],
      maxPerCabinet: 20,
      cabinetPowerKw: 200,
      cabinetKwh: 41,                     // v0.59.467: брошюра 2023-11-16 — 41 kWh (20 × 2.05 kWh = 41). Ранее ошибочно стояло 46 «по User Manual A» — brochure авторитетнее.
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
      // v0.59.425: добавлено из User Manual S³ Tech Specifications:
      dischargeRateC: 6,                  // Cell discharge rate
      chargeCurrentMaxA: 40,
      chargeCurrentDefaultA: 20,
      inputVdcCharge: '265 / ±265 / 530',
      overloadProfile: [                  // Overload capacity (discharge)
        { loadPctMin: 125, loadPctMax: 135, holdSec: 60 },
        { loadPctMin: 135, loadPctMax: 150, holdSec: 30 },
        { loadPctMin: 150, loadPctMax: Infinity, holdSec: 0.5 },
      ],
      unbalancePct: 3,                    // Module/cabinet equalized-current unbalance ≤3%
      socAccuracyPct: 95,
      sohAccuracyPct: 90,
      comms: { tcpip: true, rs485: true },
      protections: ['over-temperature','over-current','short-circuit','battery-over-voltage','battery-under-voltage','low-soc'],
      fireControl: 'module-level',
      coldStart: true, epo: true, selfStart: true, cellInsulation: true,
      opTempC: { min: 0, max: 40 },
      storageTempC: { min: -10, max: 45 },
      humidityPct: { min: 5, max: 95, condensation: false },
      altitudeMaxM: 4000,
      derateAbove2000m: 'IEC 62040-3',
      noiseDb: 65,
      overVoltageLevel: 2,
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
    systemDescription: 'Модуль S3M050-4C-240-X · 50 А·ч LFP · rated 10 кВт / 15 мин. Ставится в шкаф S3C050-4C-20-MX (до 20 модулей).',
    packaging: {
      cabinetModel: 'S3C050-4C-20',
      cabinetVariants: ['-M', '-S', '-S2', '-M1', '-M2'],
      maxPerCabinet: 20,
      cabinetPowerKw: 200,
      cabinetKwh: 58,
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
      dischargeRateC: 4,
      chargeCurrentMaxA: 40,
      chargeCurrentDefaultA: 20,
      inputVdcCharge: '265 / ±265 / 530',
      overloadProfile: [
        { loadPctMin: 125, loadPctMax: 135, holdSec: 60 },
        { loadPctMin: 135, loadPctMax: 150, holdSec: 30 },
        { loadPctMin: 150, loadPctMax: Infinity, holdSec: 0.5 },
      ],
      unbalancePct: 3,
      socAccuracyPct: 95, sohAccuracyPct: 90,
      comms: { tcpip: true, rs485: true },
      fireControl: 'module-level',
      coldStart: true, epo: true, selfStart: true, cellInsulation: true,
      opTempC: { min: 0, max: 40 }, storageTempC: { min: -10, max: 45 },
      humidityPct: { min: 5, max: 95, condensation: false },
      altitudeMaxM: 4000, derateAbove2000m: 'IEC 62040-3',
      noiseDb: 65, overVoltageLevel: 2,
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
    systemDescription: 'Модуль S3M100-1C-240-X · 100 А·ч LFP · rated 5 кВт / 1 ч (long-time backup). Ставится в шкаф S3C100-1C-12-MX (до 12 модулей).',
    packaging: {
      cabinetModel: 'S3C100-1C-12',
      cabinetVariants: ['-M', '-S'],     // У 100 А·ч только M и S по User Manual A
      maxPerCabinet: 12,
      cabinetPowerKw: 60,
      cabinetKwh: 69,
      maxCabinets: 15,
      dcOutputV: '240 / ±240 / 480',
      dischargeRateC: 1,
      chargeCurrentMaxA: 40,
      chargeCurrentDefaultA: 20,
      inputVdcCharge: '265 / ±265 / 530',
      overloadProfile: [
        { loadPctMin: 125, loadPctMax: 135, holdSec: 60 },
        { loadPctMin: 135, loadPctMax: 150, holdSec: 30 },
        { loadPctMin: 150, loadPctMax: Infinity, holdSec: 0.5 },
      ],
      unbalancePct: 3,
      socAccuracyPct: 95, sohAccuracyPct: 90,
      comms: { tcpip: true, rs485: true },
      fireControl: 'module-level',
      coldStart: true, epo: true, selfStart: true, cellInsulation: true,
      opTempC: { min: 0, max: 40 }, storageTempC: { min: -10, max: 45 },
      humidityPct: { min: 5, max: 95, condensation: false },
      altitudeMaxM: 4000, derateAbove2000m: 'IEC 62040-3',
      noiseDb: 65, overVoltageLevel: 2,
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

// ========== АКСЕССУАРЫ S³ ==========
// v0.59.425: вспомогательные элементы системы S³ согласно User Manual
// (раздел 2.8 Optionals + раздел 3 Installation, Figure3-28).
//
// Применение в архитектуре системы:
//   • 1 шкаф       → master (-M / -M1 / -M2), slave НЕ нужны.
//   • 2…N шкафов   → 1×master + (N−1)×slave (-S / -S2). Slave требует
//     комплект соединительных проводов (cabinet communication wire #2,
//     cabinet power wire #3, network wire #1, 2× RJ45 connector).
//   • >2 шкафов    → дополнительно ставится Combiner (отдельный шкаф
//     с шинной разводкой DC, см. Figure3-28: Master + Slave1…SlaveN +
//     Combiner). Используется для большого количества модулей.
//   • Communication между шкафами идёт через Networking Device
//     (managed switch, 8 RJ45 портов, до 7 шкафов на устройство).
//     При >7 шкафов ставится второе Networking Device.
//   • В неполностью заполненных шкафах пустые слоты закрываются
//     заглушками Blank Panel of Module (отдельные SKU для S3M040/050
//     и для S3M100 — разная высота слота).
//
// Эти записи НЕ участвуют в расчёте автономии (systemSubtype: 'accessory').
// Используются BOM-логикой и кодом авто-сборки шкафов (v0.59.426+).
export const KEHUA_S3_ACCESSORIES = [
  // v0.59.443: combiner — 2 типоразмера (User Manual Figure 2-24, Table 2-9):
  // S3C-2000 — до 4 шкафов АКБ, 2000 А, 120 кг.
  // S3C-4000 — до 8 шкафов АКБ, 4000 А, 140 кг.
  // Габариты обоих: 400×860×2000 мм. Авто-подбор по числу шкафов.
  {
    id: 'kehua-s3-combiner-2000',
    supplier: 'Kehua',
    type: 'S3-Combiner-2000',
    model: 'S3C-2000',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'combiner',
    combinerCurrentA: 2000,
    combinerMaxCabinets: 4,
    systemDescription: 'Шкаф-комбайнер S3C-2000: шинная DC-разводка для параллельной сборки до 4 шкафов АКБ S³. Выходной ток 2000 А. Ставится правее последнего slave.',
    appliesTo: ['S3C040-6C-20', 'S3C050-4C-20', 'S3C100-1C-12'],
    requiredWhen: 'cabinetsCount > 2 && cabinetsPerCombiner ≤ 4',
    cabinetWeightKg: 120,
    cabinetDimensionsMm: { w: 400, d: 860, h: 2000 },
    source: 'Kehua S³ User Manual, Figure 2-24, Table 2-9',
    importedAt: 0, custom: false,
  },
  {
    id: 'kehua-s3-combiner-4000',
    supplier: 'Kehua',
    type: 'S3-Combiner-4000',
    model: 'S3C-4000',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'combiner',
    combinerCurrentA: 4000,
    combinerMaxCabinets: 8,
    systemDescription: 'Шкаф-комбайнер S3C-4000: шинная DC-разводка для параллельной сборки до 8 шкафов АКБ S³. Выходной ток 4000 А. Ставится правее последнего slave.',
    appliesTo: ['S3C040-6C-20', 'S3C050-4C-20', 'S3C100-1C-12'],
    requiredWhen: 'cabinetsPerCombiner > 4',
    cabinetWeightKg: 140,
    cabinetDimensionsMm: { w: 400, d: 860, h: 2000 },
    source: 'Kehua S³ User Manual, Figure 2-24, Table 2-9',
    importedAt: 0, custom: false,
  },
  {
    id: 'kehua-s3-networking-device',
    supplier: 'Kehua',
    type: 'S3-Networking-Device',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'networking-device',
    systemDescription: 'Управляемый коммутатор связи между шкафами S³. 8× RJ45, поддерживает до 7 шкафов системы. При >7 шкафов добавляется ещё одно устройство.',
    portsCount: 8,
    cabinetsPerDevice: 7,
    appliesTo: ['S3C040-6C-20', 'S3C050-4C-20', 'S3C100-1C-12'],
    requiredWhen: 'cabinetsCount >= 2',
    source: 'Kehua S³ User Manual, §2.8.1, Figure2-21',
    importedAt: 0, custom: false,
  },
  {
    id: 'kehua-s3-blank-panel-040-050',
    supplier: 'Kehua',
    type: 'Blank Panel S3M040/S3M050',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'blank-panel',
    systemDescription: 'Декоративная заглушка пустого слота шкафа S³C040/S³C050. Размер совпадает с модулями S3M040/050 (высота 1U слота). Заполняет неиспользованные позиции в шкафу.',
    appliesTo: ['S3C040-6C-20', 'S3C050-4C-20'],
    matchesModules: ['S3M040-6C-240-X', 'S3M050-4C-240-X'],
    requiredWhen: 'modulesPerCabinet < maxPerCabinet',
    source: 'Kehua S³ User Manual, §2.8.2, Figure2-22',
    importedAt: 0, custom: false,
  },
  {
    id: 'kehua-s3-blank-panel-100',
    supplier: 'Kehua',
    type: 'Blank Panel S3M100',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'blank-panel',
    systemDescription: 'Декоративная заглушка пустого слота шкафа S³C100. Размер увеличенный (1.5×) под высоту модуля S3M100. Заполняет неиспользованные позиции в шкафу.',
    appliesTo: ['S3C100-1C-12'],
    matchesModules: ['S3M100-1C-240-X'],
    requiredWhen: 'modulesPerCabinet < maxPerCabinet',
    source: 'Kehua S³ User Manual, §2.8.2, Figure2-23',
    importedAt: 0, custom: false,
  },
  {
    id: 'kehua-s3-slave-wire-kit',
    supplier: 'Kehua',
    type: 'S3-Slave-Wire-Kit',
    chemistry: 'li-ion',
    isSystem: true,
    systemType: 'kehua-s3',
    systemSubtype: 'accessory',
    accessoryRole: 'wire-kit',
    systemDescription: 'Комплект межшкафных соединений для slave-шкафа (-S / -S2): cabinet communication wire #2 (1 шт), cabinet power wire #3 (1 шт), network wire #1 (4.5 м), RJ45 connector (2 шт). По одному комплекту на каждый slave. Master (-M / -M1 / -M2) комплект НЕ требует.',
    contents: [
      { id: 'comm-wire-2', label: 'Cabinet communication wire #2', qty: 1 },
      { id: 'power-wire-3', label: 'Cabinet power wire #3', qty: 1 },
      { id: 'network-wire-1', label: 'Network wire #1 (4.5 м)', qty: 1, lengthM: 4.5 },
      { id: 'rj45', label: 'RJ45 connector', qty: 2 },
    ],
    appliesTo: ['S3C040-6C-20-S', 'S3C040-6C-20-S2', 'S3C050-4C-20-S', 'S3C050-4C-20-S2', 'S3C100-1C-12-S'],
    requiredWhen: 'variant in [-S, -S2]',
    source: 'Kehua S³ User Manual, §3.8.1 Wire preparation',
    importedAt: 0, custom: false,
  },
];

// Объединённый экспорт для загрузки одной кнопкой.
// При загрузке каталога S3 получает ВСЁ: 3 модуля + 3 шкафа + аксессуары.
export const KEHUA_S3_BATTERIES = [...KEHUA_S3_MODULES, ...KEHUA_S3_CABINETS, ...KEHUA_S3_ACCESSORIES];
