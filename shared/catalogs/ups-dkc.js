// ======================================================================
// shared/catalogs/ups-dkc.js
// DKC UPS — серии Small Tower / Small Rack / SMALL+ / TwinDom (моноблоки)
// и Modulys (модульные, OEM Socomec). 10 моделей.
// Источник: DKC ИБП каталог 2023-2024.
// ======================================================================

export const DKC_UPSES = [
  // ── Small (1ph small online) ─────────────────────────────────────
  {
    id: 'dkc-small-1k', supplier: 'DKC',
    model: 'Small Tower 1 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 1, capacityKw: 0.9, phases: 1,
    efficiency: 90, cosPhi: 0.9,
    // DKC Small Tower 1000-3000 User Manual (a696d39a...): для SMALLT1 (1000VA)
    // указано Battery Voltage = 24 V - 36 V (т.е. 2…3 × 12В VRLA в зависимости
    // от backup-варианта standard/long). Раньше 24-28 — слишком узко.
    vdcMin: 24, vdcMax: 36, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC Small Tower 1000-3000 User Manual (SMALLT1: Battery Voltage 24-36 V, 2-3 × 12В VRLA)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 1 кВА · 1ф · Online double-conversion · Tower. АКБ: 2…3 × 12В VRLA, 24…36 VDC.',
  },
  {
    id: 'dkc-small-3k', supplier: 'DKC',
    model: 'Small Tower 3 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 3, capacityKw: 2.7, phases: 1,
    efficiency: 92, cosPhi: 0.9,
    // DKC Small Tower 1000-3000 User Manual: SMALLT3 (3000VA) Battery Voltage
    // = 72 V - 96 V (т.е. 6…8 × 12В VRLA в зависимости от backup-варианта).
    // Существующее 72-96 совпадает с datasheet.
    vdcMin: 72, vdcMax: 96, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC Small Tower 1000-3000 User Manual (SMALLT3: Battery Voltage 72-96 V, 6-8 × 12В VRLA)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 3 кВА · 1ф · Online double-conversion. АКБ: 6…8 × 12В VRLA, 72…96 VDC.',
  },
  {
    // DKC SMALL+ 6/10 kVA — OEM-перебрендирование Legrand DAKER DK Plus
    // (общая платформа Legrand-DKC), datasheet LE09706AB.
    id: 'dkc-small-6k', supplier: 'DKC',
    model: 'SMALL+ 6 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 6, capacityKw: 5.4, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // DAKER DK Plus 5/6 kVA datasheet (LE09706AB): «Number of batteries: 20,
    // Unitary capacity: 12 Vdc - 5 Ah, Rated Battery Voltage: 240 Vdc».
    // Operating window 20 × 12В VRLA (120 ячеек) EoD 1.67 → float 2.40 VPC:
    //   min = 20 × 6 × 1.67 = 200 В; max = 20 × 6 × 2.40 = 288 В.
    // Раньше 192-240 — было занижено по верхней границе.
    vdcMin: 200, vdcMax: 288, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC SMALL+ = OEM Legrand DAKER DK Plus 5/6 kVA (LE09706AB): 20 × 12В VRLA, 240 Vdc ном.',
    importedAt: 0, custom: false,
    notes: 'Моноблок 6 кВА · 1ф · Online VFI (OEM DAKER DK Plus). АКБ: 20 × 12В VRLA, 200…288 VDC.',
  },
  {
    id: 'dkc-small-10k', supplier: 'DKC',
    model: 'SMALL+ 10 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 10, capacityKw: 9, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // DAKER DK Plus 10 kVA — то же 20 × 12В VRLA (240 Vdc ном.) что у 5/6 kVA
    // (общая battery system), operating window 200…288 VDC.
    vdcMin: 200, vdcMax: 288, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC SMALL+ = OEM Legrand DAKER DK Plus 10 kVA (LE09706AB): 20 × 12В VRLA, 240 Vdc ном.',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 1ф · Online VFI (OEM DAKER DK Plus). АКБ: 20 × 12В VRLA, 200…288 VDC.',
  },
  // ── TwinDom (3ph monoblock) ──────────────────────────────────────
  {
    id: 'dkc-twindom-20k', supplier: 'DKC',
    model: 'TwinDom 20 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20, phases: 3,
    efficiency: 95, cosPhi: 1.0,
    vdcMin: 240, vdcMax: 360, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC TwinDom datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3ф.',
  },
  {
    id: 'dkc-twindom-40k', supplier: 'DKC',
    model: 'TwinDom 40 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 40, capacityKw: 40, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 360, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC TwinDom datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 40 кВА · 3ф.',
  },
  {
    id: 'dkc-twindom-80k', supplier: 'DKC',
    model: 'TwinDom 80 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 80, capacityKw: 80, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC TwinDom datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 80 кВА · 3ф.',
  },
  // ── Modulys (modular, OEM Socomec) ───────────────────────────────
  {
    // DKC Modulys GP — OEM-перебрендирование Socomec Modulys GP (Green Power
    // 2.0 range), brochure DOC-214063USA + Tech Guide TBKMODGP2005.
    id: 'dkc-modulys-25k', supplier: 'DKC',
    model: 'Modulys GP 25', kind: 'ups', upsType: 'modular',
    capacityKva: 25, capacityKw: 25, phases: 3,
    frameKw: 200, moduleKwRated: 25, moduleSlots: 8,
    efficiency: 96, cosPhi: 1.0,
    // Socomec Modulys GP UL Brochure: «Number of battery blocks (VRLA): from
    // 18+18 to 24+24» (split bus). Конфигурируемая батарея 36-48 jars × 12В
    // VRLA total. Operating window rail-to-rail:
    //   min = 36 × 6 × 1.67 = 361 → 360 В (18+18 EoD)
    //   max = 48 × 6 × 2.40 = 691 → 691 В (24+24 float)
    // Раньше 360-480 — покрывало только 18+18 конфигурацию.
    vdcMin: 360, vdcMax: 691, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC Modulys GP = OEM Socomec Modulys GP UL Brochure (18+18 to 24+24 × 12В VRLA split bus, EoD 1.67 → float 2.40 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 25 кВт (1×25 в фрейме 200) · 3ф · Hot-swap. АКБ: 18+18…24+24 × 12В VRLA split bus, 360…691 VDC.',
  },
  {
    id: 'dkc-modulys-100k', supplier: 'DKC',
    model: 'Modulys GP 100', kind: 'ups', upsType: 'modular',
    capacityKva: 100, capacityKw: 100, phases: 3,
    frameKw: 200, moduleKwRated: 25, moduleSlots: 8,
    efficiency: 96.5, cosPhi: 1.0,
    // Те же battery system что у Modulys GP 25 (общая платформа модулей).
    vdcMin: 360, vdcMax: 691, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC Modulys GP = OEM Socomec Modulys GP UL Brochure (18+18 to 24+24 × 12В VRLA split bus, EoD 1.67 → float 2.40 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 100 кВт (4×25) · 3ф. АКБ: 18+18…24+24 × 12В VRLA split bus, 360…691 VDC.',
  },
  {
    id: 'dkc-modulys-xl-300k', supplier: 'DKC',
    model: 'Modulys XL 300', kind: 'ups', upsType: 'modular',
    capacityKva: 300, capacityKw: 300, phases: 3,
    frameKw: 600, moduleKwRated: 50, moduleSlots: 12,
    efficiency: 97, cosPhi: 1.0,
    vdcMin: 432, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'DKC Modulys XL datasheet',
    importedAt: 0, custom: false,
    notes: 'Модульный 300 кВт (6×50 в фрейме 600) · 3ф · ЦОД-класс.',
  },
];
