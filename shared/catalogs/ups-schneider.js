// ======================================================================
// shared/catalogs/ups-schneider.js
// Schneider Electric (APC) Galaxy series UPS — 10 моделей.
// Источник: Schneider Electric Galaxy VS / VL / VX / VM datasheets 2023-2024.
// Все записи — kind:'ups' (стандартный моноблок/модульный), НЕ
// 'ups-integrated' (это специфика Kehua с встроенными PDM-панелями).
// V_DC дан по паспорту «Battery DC voltage range» (рабочий диапазон).
// ======================================================================

export const SCHNEIDER_UPSES = [
  // ── Galaxy VS (10–150 kVA, monoblock) ────────────────────────────
  {
    id: 'schneider-galaxy-vs-10k', supplier: 'Schneider Electric',
    model: 'Galaxy VS 10 kVA', kind: 'ups', upsType: 'monoblock',
    // Galaxy VS — вся серия 10-150 kW трёхфазная (per Schneider product range
    // 65772). Раньше у этой записи стояло phases:1 — ошибочно (вариант 208V
    // имеет 1ph input через внутренний трансформатор, но система 3ph).
    capacityKva: 10, capacityKw: 10, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    // Galaxy VS 10kW 400V (GVSUPS10KB4HS / B2HS): external battery
    // 384-576 VDC (32-48 блоков 12В VRLA), EoD 384 V at full load,
    // float ~545 V. Раньше 192-240 — было сильно занижено.
    vdcMin: 384, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VS UPS for External Batteries Tech Spec 990-91141 (10-100 kW 400V, 384-576 VDC, 32-48 × 12В VRLA)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 3ф · 32…48 × 12В VRLA, 384…576 VDC, EoD 384V (40 jars).',
  },
  {
    id: 'schneider-galaxy-vs-20k', supplier: 'Schneider Electric',
    model: 'Galaxy VS 20 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    // Galaxy VS 20kW 480V (GVSUPS20KGS): external battery 384-576 VDC.
    // 400V вариант (GVSUPS20KB4HS) — то же окно 384-576. Раньше 240-360 —
    // было сильно занижено.
    vdcMin: 384, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VS 20kW External Batteries Tech Spec (GVSUPS20KGS / B4HS, 384-576 VDC, EoD 384V)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3ф · 32…48 × 12В VRLA, 384…576 VDC.',
  },
  {
    id: 'schneider-galaxy-vs-40k', supplier: 'Schneider Electric',
    model: 'Galaxy VS 40 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 40, capacityKw: 40, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Galaxy VS 40 kW (400V вариант GVSUPS40KHS): battery 384-480 VDC.
    // Для 480V варианта (GVSUPS40KGS) — 480-576 VDC.
    vdcMin: 384, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VS 40kW 400V datasheet (battery 384-480 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 40 кВА · 3ф.',
  },
  {
    id: 'schneider-galaxy-vs-60k', supplier: 'Schneider Electric',
    model: 'Galaxy VS 60 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 60, capacityKw: 60, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Galaxy VS 60kW: подтверждено 384-576 VDC (securepower.com GVSUPS60KGS).
    vdcMin: 384, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VS 60kVA datasheet (battery 384-576 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 60 кВА · 3ф · 32/40 SLA-блоков.',
  },
  {
    id: 'schneider-galaxy-vs-100k', supplier: 'Schneider Electric',
    model: 'Galaxy VS 100 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 100, capacityKw: 100, phases: 3,
    efficiency: 97, cosPhi: 1.0,
    // Galaxy VS 100kW: external battery 480-576 VDC at float, EoD 384 VDC.
    // Operating range 384-576 (verified securepower.com GVSUPS100KGS).
    vdcMin: 384, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VS 100kVA datasheet (battery 384-576 VDC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 100 кВА · 3ф · ECOnversion eco-mode 99%.',
  },
  // ── Galaxy VL (200–500 kVA, modular) ─────────────────────────────
  {
    id: 'schneider-galaxy-vl-200k', supplier: 'Schneider Electric',
    model: 'Galaxy VL 200 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 200, capacityKw: 200, phases: 3,
    frameKw: 500, moduleKwRated: 50, moduleSlots: 10,
    efficiency: 97, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VL datasheet 2024',
    importedAt: 0, custom: false,
    notes: 'Модульный 200 кВА (4×50 кВт в фрейме 500 кВт) · 3ф · Live Swap.',
  },
  {
    id: 'schneider-galaxy-vl-300k', supplier: 'Schneider Electric',
    model: 'Galaxy VL 300 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 300, capacityKw: 300, phases: 3,
    frameKw: 500, moduleKwRated: 50, moduleSlots: 10,
    efficiency: 97, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VL datasheet 2024',
    importedAt: 0, custom: false,
    notes: 'Модульный 300 кВА (6×50 кВт) · 3ф.',
  },
  {
    id: 'schneider-galaxy-vl-500k', supplier: 'Schneider Electric',
    model: 'Galaxy VL 500 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 500, capacityKw: 500, phases: 3,
    frameKw: 500, moduleKwRated: 50, moduleSlots: 10,
    efficiency: 97, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VL datasheet 2024',
    importedAt: 0, custom: false,
    notes: 'Модульный 500 кВА (10×50 кВт) · 3ф.',
  },
  // ── Galaxy VX (500–1500 kVA, large modular) ──────────────────────
  {
    id: 'schneider-galaxy-vx-750k', supplier: 'Schneider Electric',
    model: 'Galaxy VX 750 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 750, capacityKw: 750, phases: 3,
    frameKw: 1500, moduleKwRated: 250, moduleSlots: 6,
    efficiency: 96.5, cosPhi: 1.0,
    vdcMin: 432, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VX datasheet 2024',
    importedAt: 0, custom: false,
    notes: 'Модульный 750 кВА (3×250 кВт) · 3ф · ЦОД-класс.',
  },
  {
    id: 'schneider-galaxy-vx-1500k', supplier: 'Schneider Electric',
    model: 'Galaxy VX 1500 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 1500, capacityKw: 1500, phases: 3,
    frameKw: 1500, moduleKwRated: 250, moduleSlots: 6,
    efficiency: 96.5, cosPhi: 1.0,
    vdcMin: 432, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Schneider Galaxy VX datasheet 2024',
    importedAt: 0, custom: false,
    notes: 'Модульный 1500 кВА (6×250 кВт) · 3ф · ЦОД-класс.',
  },
];
