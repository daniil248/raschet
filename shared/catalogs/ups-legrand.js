// ======================================================================
// shared/catalogs/ups-legrand.js
// Legrand Keor UPS — серии LP / SP / Multiplug / T evo / HP / MOD / MP.
// 10 моделей. Источник: Legrand Keor datasheets 2023-2024.
// ======================================================================

export const LEGRAND_UPSES = [
  // ── Keor LP / SP (1ph small online) ──────────────────────────────
  {
    id: 'legrand-keor-lp-3k', supplier: 'Legrand',
    model: 'Keor LP 3 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 3, capacityKw: 2.7, phases: 1,
    efficiency: 92, cosPhi: 0.9,
    // Datasheet Keor LP 3000 (icecat 310158): 72V nominal, 6 × 12V VRLA
    // (36 ячеек). Operating window EoD 1.67 → float 2.40 VPC:
    //   min = 6 × 6 × 1.67 = 60 В
    //   max = 6 × 6 × 2.40 = 86 В
    // Раньше 72-96 — стандартный ±20% от ном. 72V, но физически невозможно
    // 96V (превышает boost-предел VRLA).
    vdcMin: 60, vdcMax: 86, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor LP 3000 datasheet (310158): 72 VDC ном., 6 × 12В VRLA',
    importedAt: 0, custom: false,
    notes: 'Моноблок 3 кВА · 1ф · Online double-conversion · Tower. АКБ: 6 × 12В VRLA, 60…86 VDC.',
  },
  {
    // Внимание: id содержит «sp» по историческим причинам, но реальная серия —
    // Legrand Keor S (3-6-10 kVA online double-conversion VFI-SS-111).
    // Keor SP — это line-interactive 600-2000 VA, у нас не используется.
    id: 'legrand-keor-sp-6k', supplier: 'Legrand',
    model: 'Keor S 6 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 6, capacityKw: 5.4, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // Datasheet Keor S (Brochure_KEOR_S_GB.pdf): 6/10 kVA = 240 VDC ном.
    // Внутренний пакет 20 × 12В VRLA (120 ячеек). Operating window EoD 1.67
    // → float 2.40 VPC: min 200 V, max 288 V.
    vdcMin: 200, vdcMax: 288, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor S 3-10 kVA Brochure (240 VDC ном., 20 × 12В VRLA, online VFI-SS-111)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 6 кВА · 1ф · Online double-conversion VFI. АКБ: 20 × 12В VRLA, 200…288 VDC.',
  },
  {
    id: 'legrand-keor-sp-10k', supplier: 'Legrand',
    model: 'Keor S 10 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 10, capacityKw: 9, phases: 1,
    efficiency: 95, cosPhi: 0.9,
    // Datasheet Keor S: 10 kVA — то же 240 VDC ном., 20 × 12В VRLA.
    vdcMin: 200, vdcMax: 288, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor S 3-10 kVA Brochure (240 VDC ном., 20 × 12В VRLA, online VFI-SS-111)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 1ф · Online double-conversion VFI. АКБ: 20 × 12В VRLA, 200…288 VDC.',
  },
  // ── Keor T evo (3ph mid-range) ───────────────────────────────────
  {
    id: 'legrand-keor-tevo-10k', supplier: 'Legrand',
    model: 'Keor T evo 10 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 10, capacityKw: 10, phases: 3,
    efficiency: 95, cosPhi: 1.0,
    // Datasheet Keor T EVO 10-15-20 kVA (LE10507AD): конфигурируемая батарея
    // 24…40 × 12В VRLA single-bus (Compact 10 kVA = 24 jars × 9 Ah = 288 VDC
    // ном.). Operating window EoD 1.67 → float 2.40 VPC по всем конфигурациям:
    //   min = 24 × 6 × 1.67 = 240 В (24 jars EoD)
    //   max = 40 × 6 × 2.40 = 576 В (40 jars float)
    // Раньше было 240-360 — покрывало только 24-jar EoD до 30-jar float.
    vdcMin: 240, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor T EVO 10-15-20 kVA Manual LE10507AD (24…40 × 12В VRLA, single-bus, EoD 1.67 → float 2.40 VPC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 3ф · Online VFI. АКБ: 24…40 × 12В VRLA, 240…576 VDC.',
  },
  {
    id: 'legrand-keor-tevo-20k', supplier: 'Legrand',
    model: 'Keor T evo 20 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    // Datasheet Keor T EVO 10-15-20 kVA (LE10507AD): то же 24…40 × 12В VRLA
    // что у 10 kVA версии (отличается только мощность инвертора). Operating
    // window 240…576 VDC.
    vdcMin: 240, vdcMax: 576, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor T EVO 10-15-20 kVA Manual LE10507AD (24…40 × 12В VRLA, single-bus, EoD 1.67 → float 2.40 VPC)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3ф. АКБ: 24…40 × 12В VRLA, 240…576 VDC.',
  },
  // ── Keor HP / HPE (large monoblock) ──────────────────────────────
  {
    id: 'legrand-keor-hp-100k', supplier: 'Legrand',
    model: 'Keor HP 100 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 100, capacityKw: 100, phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor HP datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 100 кВА · 3ф · до 8 параллельно.',
  },
  {
    id: 'legrand-keor-hp-200k', supplier: 'Legrand',
    model: 'Keor HP 200 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 200, capacityKw: 200, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    vdcMin: 384, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor HP datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 200 кВА · 3ф.',
  },
  {
    id: 'legrand-keor-hpe-400k', supplier: 'Legrand',
    model: 'Keor HPE 400 kVA', kind: 'ups', upsType: 'monoblock',
    capacityKva: 400, capacityKw: 400, phases: 3,
    efficiency: 96.5, cosPhi: 1.0,
    // Datasheet Keor HPE 100-160 (UPS-LGR-0120_GB.pdf) и 200-300
    // (Data-sheet-Keor-HPE_200-250-300KVA_EN.pdf): 360-372 cells × 12V VRLA
    // (60-62 jars), Floating Voltage 812V (360 cells) или 840V (372 cells),
    // Min Discharge Voltage 620V (360) или 632V (372). Operating range
    // 620-840 VDC. Brochure HPE 60-600: «Common Battery Kit» — battery
    // system общая для всей серии, поэтому HPE 400 наследует те же значения.
    // Раньше 432-540 — wildly off (соответствует другому UPS).
    vdcMin: 620, vdcMax: 840, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor HPE Tech Spec UPS-LGR-0120 + 200-300KVA datasheet (360-372 × 12В VRLA, float 812-840V, EoD 620-632V)',
    importedAt: 0, custom: false,
    notes: 'Моноблок 400 кВА · 3ф · ЦОД-класс. АКБ: 360…372 ячеек (60…62 × 12В VRLA), 620…840 VDC.',
  },
  // ── Keor MOD / MP (modular) ──────────────────────────────────────
  {
    // Внимание: id «mod-30k» сохранён для обратной совместимости, но реальный
    // power-модуль Keor MOD = 25 кВт (per Brochure_KeorMod-EN.pdf: «Keor MOD
    // power module is among the most compact three-phase 25 kW modules»).
    // Конфигурация 30 кВт нестандартна для Keor MOD — представлена как
    // 25 кВт power module ближайшая к запросу 30 кВт.
    id: 'legrand-keor-mod-30k', supplier: 'Legrand',
    model: 'Keor MOD 25', kind: 'ups', upsType: 'modular',
    capacityKva: 25, capacityKw: 25, phases: 3,
    // Brochure: до 5 модулей с internal batteries (25-125 кВт) или 10 модулей
    // (25-250 кВт). frameKw 125 покрывает internal-battery конфигурацию.
    frameKw: 125, moduleKwRated: 25, moduleSlots: 5,
    efficiency: 96.5, cosPhi: 1.0,
    // Tech Spec Keor MOD 25kW (38559-keor-mod-25kw.pdf): split bus +/-264 V
    // nominal, 22 jars × 12В × 2 drawers per string = 44 jars (132 cells per
    // rail). Booster: «battery DC voltage from the nominal value of 264 Vdc».
    // Operating window EoD 1.67 → float 2.40 VPC, rail-to-rail:
    //   min = 132 × 1.67 × 2 = 441 → 440 В
    //   max = 132 × 2.40 × 2 = 633 → 634 В
    // Раньше 360-480 — было сильно занижено.
    vdcMin: 440, vdcMax: 634, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor MOD 25kW Tender Tech Spec 38559 (split bus +/-264V, 44 × 12В VRLA, EoD 1.67 → float 2.40 VPC)',
    importedAt: 0, custom: false,
    notes: 'Модульный 25 кВт (модуль) · 3ф · Hot-swap · до 5 модулей с internal АКБ (125 кВт). АКБ: 44 × 12В VRLA split bus +/-264V, 440…634 VDC.',
  },
  {
    // Внимание: id «mp-300k» сохранён для обратной совместимости, но реальная
    // серия Keor MP — 60-200 кВА (per Brochure Keor MP «60 kVA - 200 kVA»).
    // 300 кВт нестандартна; конфигурация может быть достигнута через parallel
    // подключение MP единиц. Технические параметры battery — общесерийные.
    id: 'legrand-keor-mp-300k', supplier: 'Legrand',
    model: 'Keor MP 200 kVA', kind: 'ups', upsType: 'modular',
    capacityKva: 200, capacityKw: 200, phases: 3,
    frameKw: 200, moduleKwRated: 50, moduleSlots: 4,
    efficiency: 97, cosPhi: 1.0,
    // Tech Spec Keor MP 100 (UPS_LGR_0241_GB_AA.pdf) + Brochure Keor MP
    // (60-200 kVA): «Nominal battery voltage 432 Vdc ~ 600 Vdc» (VRLA);
    // Li-ion вариант: 512-614 Vdc. Окно общесерийное для всех MP 60-200.
    // Раньше 432-540 — было занижено по верхней границе.
    vdcMin: 432, vdcMax: 600, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor MP 60-200 kVA Brochure + UPS_LGR_0241_GB_AA (Nominal battery voltage 432-600 VDC VRLA, 512-614 VDC Li-ion)',
    importedAt: 0, custom: false,
    notes: 'Модульный 200 кВА (4×50) · 3ф · ЦОД-класс. АКБ: 432…600 VDC VRLA или 512…614 VDC Li-ion.',
  },
];
