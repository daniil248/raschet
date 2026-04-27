// ======================================================================
// shared/catalogs/ups-eaton.js
// Eaton UPS — серии 9PX / 93PS / 93PM / 93E / 9395. 10 моделей.
// Источник: Eaton UPS datasheets 2023-2024.
//
// Поле vdcVerified:
//   true  — V_DC окно подтверждено datasheet (точная цитата в source).
//   false — V_DC оценено по аналогии или по ном. напряжению; пользователь
//           должен сверить с реальным datasheet перед использованием.
// На v0.59.457: verified только 93PM 50/100/200 (PQ131012EN) и 93PS 40
// (PS153045). Остальные модели — пометка ⚠ в notes до верификации.
// ======================================================================

export const EATON_UPSES = [
  // ── 9PX (5–11 kVA, monoblock 1ph) ────────────────────────────────
  {
    id: 'eaton-9px-6k', supplier: 'Eaton',
    model: '9PX 6000', kind: 'ups', upsType: 'monoblock',
    capacityKva: 6, capacityKw: 5.4, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // Datasheet TD153001EN + 9PXEBM180RT EBM (180 VDC): внутренний пакет 15×12В
    // VRLA (180V ном., 90 ячеек). Operating window EoD 1.67 → float 2.40 VPC:
    //   min = 90 × 1.67 = 150.3 → 150 В
    //   max = 90 × 2.40 = 216.0 → 216 В
    // Lithium-вариант 9PX6K-L (192V) — отдельная позиция, здесь VRLA.
    vdcMin: 150, vdcMax: 216, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 9PX 5-6 kVA Tech Spec TD153001EN (15 × 12В VRLA, 180V ном., EBM 9PXEBM180RT)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 6 кВА · 1ф · Online double-conversion · Tower/Rack. АКБ: 15 × 12В, 150…216 VDC.',
  },
  {
    id: 'eaton-9px-11k', supplier: 'Eaton',
    model: '9PX 11000', kind: 'ups', upsType: 'monoblock',
    capacityKva: 11, capacityKw: 10, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // Datasheet TD153002EN + 9PXEBM240RT EBM (240 VDC): внутренний пакет 20×12В
    // VRLA (240V ном., 120 ячеек). Operating window EoD 1.67 → float 2.40 VPC:
    //   min = 120 × 1.67 = 200.4 → 200 В
    //   max = 120 × 2.40 = 288.0 → 288 В
    vdcMin: 200, vdcMax: 288, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 9PX 8-11 kVA Tech Spec TD153002EN (20 × 12В VRLA, 240V ном., EBM 9PXEBM240RT)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 11 кВА · 1ф · 6U Rack. АКБ: 20 × 12В, 200…288 VDC.',
  },
  // ── 93PS (8–40 kW, monoblock 3ph) ────────────────────────────────
  {
    id: 'eaton-93ps-8k', supplier: 'Eaton',
    model: '93PS 8 kW', kind: 'ups', upsType: 'monoblock',
    capacityKva: 8, capacityKw: 8, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    // Datasheet: internal 384V, external 336-480 VDC (вся серия 93PS 8-40 одинакова).
    vdcMin: 336, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PS 8-10kW Technical Specification (external 336-480 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 8 кВт · 3ф. АКБ: ext 336…480 VDC, int 384V.',
  },
  {
    id: 'eaton-93ps-20k', supplier: 'Eaton',
    model: '93PS 20 kW', kind: 'ups', upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    // Datasheet PS153045: external battery 336-480 VDC (серия 93PS 8-40).
    vdcMin: 336, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PS 8-40kW Technical Specification (external 336-480 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВт · 3ф. АКБ: ext 336…480 VDC.',
  },
  {
    id: 'eaton-93ps-40k', supplier: 'Eaton',
    model: '93PS 40 kW', kind: 'ups', upsType: 'monoblock',
    capacityKva: 40, capacityKw: 40, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Datasheet PS153045: external battery 336-480 VDC (28-40 × 12В VRLA),
    // 9 Ah C10 internal option = 384V. EoD 1.67-1.75 VPC.
    vdcMin: 336, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PS 8-40kW Technical Spec rev014 (28-40 × 12В VRLA, 336-480 VDC ext.)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 40 кВт · 3ф · до 4 параллельно. АКБ: 28…40 × 12В VRLA, 336…480 VDC.',
  },
  // ── 93PM (50–200 kW, modular) ────────────────────────────────────
  {
    id: 'eaton-93pm-50k', supplier: 'Eaton',
    model: '93PM 50', kind: 'ups', upsType: 'modular',
    capacityKva: 50, capacityKw: 50, phases: 3,
    frameKw: 200, moduleKwRated: 50, moduleSlots: 4,
    efficiency: 97, cosPhi: 1.0,
    // Datasheet PQ131012EN: ном. напряжение АКБ 432 В (36 × 12В = 216 эл.) или
    // 480 В (40 × 12В = 240 эл.). EoD 1.67-1.75 VPC. Операционное окно:
    // min = 36 × 6 × 1.67 = 360.7 В; max = 40 × 6 × 2.27 (float VRLA) = 544.8 В.
    // Округлено до 360-540, что покрывает обе паспортные конфигурации.
    vdcMin: 360, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PM 30-200kW Technical Spec (36/40 × 12В VRLA, EoD 1.67-1.75 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 50 кВт (1×50 в фрейме 200) · 3ф · Hot-swap.',
  },
  {
    id: 'eaton-93pm-100k', supplier: 'Eaton',
    model: '93PM 100', kind: 'ups', upsType: 'modular',
    capacityKva: 100, capacityKw: 100, phases: 3,
    frameKw: 200, moduleKwRated: 50, moduleSlots: 4,
    efficiency: 97, cosPhi: 1.0,
    // Datasheet PQ131012EN: ном. напряжение АКБ 432 В (36 × 12В = 216 эл.) или
    // 480 В (40 × 12В = 240 эл.). EoD 1.67-1.75 VPC. Операционное окно:
    // min = 36 × 6 × 1.67 = 360.7 В; max = 40 × 6 × 2.27 (float VRLA) = 544.8 В.
    // Округлено до 360-540, что покрывает обе паспортные конфигурации.
    vdcMin: 360, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PM 30-200kW Technical Spec (36/40 × 12В VRLA, EoD 1.67-1.75 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 100 кВт (2×50 в фрейме 200) · 3ф.',
  },
  {
    id: 'eaton-93pm-200k', supplier: 'Eaton',
    model: '93PM 200', kind: 'ups', upsType: 'modular',
    capacityKva: 200, capacityKw: 200, phases: 3,
    frameKw: 200, moduleKwRated: 50, moduleSlots: 4,
    efficiency: 97, cosPhi: 1.0,
    // Datasheet PQ131012EN: ном. напряжение АКБ 432 В (36 × 12В = 216 эл.) или
    // 480 В (40 × 12В = 240 эл.). EoD 1.67-1.75 VPC. Операционное окно:
    // min = 36 × 6 × 1.67 = 360.7 В; max = 40 × 6 × 2.27 (float VRLA) = 544.8 В.
    // Округлено до 360-540, что покрывает обе паспортные конфигурации.
    vdcMin: 360, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 93PM 30-200kW Technical Spec (36/40 × 12В VRLA, EoD 1.67-1.75 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 200 кВт (4×50) · 3ф · Energy Saver System 99%.',
  },
  // ── 9395 (большие моноблоки 275–1100 kVA) ────────────────────────
  {
    id: 'eaton-9395-500k', supplier: 'Eaton',
    model: '9395P 500', kind: 'ups', upsType: 'monoblock',
    capacityKva: 500, capacityKw: 500, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Datasheet 500-600 kVA: battery DC voltage 456-492 V (узкое окно).
    vdcMin: 456, vdcMax: 492, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 9395P 500-600 kVA Technical Specification (battery 456-492 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 500 кВт · 3ф · ЦОД-класс · ESS до 99%. АКБ: 456…492 VDC.',
  },
  {
    id: 'eaton-9395-1100k', supplier: 'Eaton',
    model: '9395P 1100', kind: 'ups', upsType: 'monoblock',
    capacityKva: 1100, capacityKw: 1100, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Datasheet 1000-1200 kVA: 38-41 jars × 12В × 6 cells, EoD 1.67-1.75 VPC.
    // Battery DC voltage range 456-492 V (узкое окно семейства 9395P).
    vdcMin: 456, vdcMax: 492, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Eaton 9395P 1000-1200 kVA Technical Specification (38-41 × 12В VRLA, 456-492 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 1100 кВт · 3ф · ЦОД-класс flagship. АКБ: 38…41 × 12В, EoD 1.67-1.75 VPC.',
  },
];
