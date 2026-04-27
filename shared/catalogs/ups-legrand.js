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
    vdcMin: 72, vdcMax: 96, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor LP datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 3 кВА · 1ф · Line-Interactive · Tower.',
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
    vdcMin: 432, vdcMax: 540, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor HPE datasheet',
    importedAt: 0, custom: false,
    notes: 'Моноблок 400 кВА · 3ф · ЦОД-класс.',
  },
  // ── Keor MOD / MP (modular) ──────────────────────────────────────
  {
    id: 'legrand-keor-mod-30k', supplier: 'Legrand',
    model: 'Keor MOD 30', kind: 'ups', upsType: 'modular',
    capacityKva: 30, capacityKw: 30, phases: 3,
    frameKw: 120, moduleKwRated: 30, moduleSlots: 4,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 360, vdcMax: 480, inputs: 1, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor MOD datasheet',
    importedAt: 0, custom: false,
    notes: 'Модульный 30 кВт (1×30 в фрейме 120) · 3ф · Hot-swap.',
  },
  {
    id: 'legrand-keor-mp-300k', supplier: 'Legrand',
    model: 'Keor MP 300', kind: 'ups', upsType: 'modular',
    capacityKva: 300, capacityKw: 300, phases: 3,
    frameKw: 600, moduleKwRated: 50, moduleSlots: 12,
    efficiency: 97, cosPhi: 1.0,
    vdcMin: 432, vdcMax: 540, inputs: 2, outputs: 1,
    batteryChemistry: 'vrla',
    source: 'Legrand Keor MP datasheet',
    importedAt: 0, custom: false,
    notes: 'Модульный 300 кВт (6×50) · 3ф · ЦОД-класс.',
  },
];
