// =============================================================================
// shared/catalogs/genset/fg-wilson.js
// FG Wilson DGUs — Perkins-engined серии P200H / P400P3 / P800P3. 3 модели.
// Источник: FG Wilson datasheets 2023-2024.
//
// v0.60.214 split из shared/catalogs/dgu.js по производителям.
// =============================================================================

export const FG_WILSON_DGUS = [
  {
    vendor: 'FG Wilson', model: 'P200H (200 kVA)',
    nameplateKw: 160, espKw: 160, prpKw: 145, copKw: 130,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 1106A-70TG3', cylinders: 6, displacement: 7,
    fuelType: 'diesel', sfcLkWh: 0.235,
    derateProfile: 'perkins-1106a-70tag2',
    physical: { lengthMm: 3200, widthMm: 1100, heightMm: 1800, weightKg: 1950 },
    notes: 'Perkins powered. Cost-effective for small DC.',
  },
  {
    vendor: 'FG Wilson', model: 'P400P3 (400 kVA)',
    nameplateKw: 320, espKw: 320, prpKw: 290, copKw: 260,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 2206A-E13TAG3', cylinders: 6, displacement: 12.5,
    fuelType: 'diesel', sfcLkWh: 0.222,
    derateProfile: 'perkins-4000-series',
    physical: { lengthMm: 4400, widthMm: 1500, heightMm: 2200, weightKg: 3700 },
    notes: 'PowerWizard 2.1 controller.',
  },
  {
    vendor: 'FG Wilson', model: 'P800P3 (800 kVA)',
    nameplateKw: 640, espKw: 640, prpKw: 580, copKw: 515,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 4006-23TAG3A', cylinders: 6, displacement: 23,
    fuelType: 'diesel', sfcLkWh: 0.215,
    derateProfile: 'perkins-4000-series',
    physical: { lengthMm: 5300, widthMm: 1900, heightMm: 2400, weightKg: 6500 },
    notes: 'Heavy-fuel option (HFO ready).',
  },
];
