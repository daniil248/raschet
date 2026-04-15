// ======================================================================
// shared/kehua-mr33-data.js
// Встроенный справочник ИБП серии Kehua MR33. Источник:
// Kehua MR33 200-500k Brochure 2025-02-18, раздел Technical Specifications.
//
// MR33 — модульная серия с силовым модулем 50 kVA. Совместим и с
// свинцово-кислотными батареями (VRLA/AGM), и с литий-ионной системой
// Kehua S³. Напряжение DC-шины: ±240 В (±180~±300 настраиваемое,
// ±240~±300 при полной нагрузке). То есть полная шина = 480 В.
//
// Для подбора АКБ в нашем калькуляторе берём V_DC min = 360 В
// (2×±180), V_DC max = 600 В (2×±300), V_DC nominal = 480 В.
// ======================================================================

export const KEHUA_MR33_UPSES = [
  {
    id: 'kehua-mr33200',
    supplier: 'Kehua',
    model: 'MR33 200',
    upsType: 'modular',
    capacityKw: 200,          // 200 kVA × cos φ 1.0 = 200 kW
    frameKw: 500,             // корпус тот же 200-300, rated до 500
    moduleKwRated: 50,        // 50 kW силовой модуль
    moduleSlots: 10,          // до 10 модулей на корпус 500 kW
    efficiency: 97,           // до 97% online mode
    cosPhi: 1.0,              // выход cos φ = 1.0
    vdcMin: 360,              // 2 × ±180 В
    vdcMax: 600,              // 2 × ±300 В
    inputs: 2,                // основной + байпасный (раздельные или перемычка)
    outputs: 1,
    source: 'Kehua MR33 Brochure 2025-02-18',
    importedAt: 0,
    custom: false,
    // Расширенные поля Kehua MR33
    batteryTypes: ['vrla', 'li-ion-s3'],
    compatibleS3: true,
    notes: 'Модульный ИБП с силовым модулем 50 кВт. Совместим с VRLA (28-46 блоков на цепочку) и с S³ Li-Ion системой Kehua. Вход L-L 138-485 В, 40-70 Гц. THDi ≤ 1.5%. Перегруз 150% на 1 мин.',
  },
  {
    id: 'kehua-mr33300',
    supplier: 'Kehua',
    model: 'MR33 300',
    upsType: 'modular',
    capacityKw: 300,
    frameKw: 500,
    moduleKwRated: 50,
    moduleSlots: 10,
    efficiency: 97,
    cosPhi: 1.0,
    vdcMin: 360,
    vdcMax: 600,
    inputs: 2,
    outputs: 1,
    source: 'Kehua MR33 Brochure 2025-02-18',
    importedAt: 0,
    custom: false,
    batteryTypes: ['vrla', 'li-ion-s3'],
    compatibleS3: true,
    notes: 'Модульный ИБП, 6 силовых модулей × 50 кВт. Совместим с VRLA и Kehua S³.',
  },
  {
    id: 'kehua-mr33400',
    supplier: 'Kehua',
    model: 'MR33 400',
    upsType: 'modular',
    capacityKw: 400,
    frameKw: 1000,
    moduleKwRated: 50,
    moduleSlots: 20,
    efficiency: 97,
    cosPhi: 1.0,
    vdcMin: 360,
    vdcMax: 600,
    inputs: 2,
    outputs: 1,
    source: 'Kehua MR33 Brochure 2025-02-18',
    importedAt: 0,
    custom: false,
    batteryTypes: ['vrla', 'li-ion-s3'],
    compatibleS3: true,
    notes: 'Модульный ИБП в корпусе 1000 кВт, 8 силовых модулей × 50 кВт. Совместим с VRLA и Kehua S³.',
  },
  {
    id: 'kehua-mr33500',
    supplier: 'Kehua',
    model: 'MR33 500',
    upsType: 'modular',
    capacityKw: 500,
    frameKw: 1000,
    moduleKwRated: 50,
    moduleSlots: 20,
    efficiency: 97,
    cosPhi: 1.0,
    vdcMin: 360,
    vdcMax: 600,
    inputs: 2,
    outputs: 1,
    source: 'Kehua MR33 Brochure 2025-02-18',
    importedAt: 0,
    custom: false,
    batteryTypes: ['vrla', 'li-ion-s3'],
    compatibleS3: true,
    notes: 'Модульный ИБП в корпусе 1000 кВт, 10 силовых модулей × 50 кВт. Совместим с VRLA и Kehua S³.',
  },
];
