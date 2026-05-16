// =============================================================================
// shared/catalogs/genset/volvo-penta.js
// Volvo Penta DGUs — TAD/TWD серии. 3 модели.
// Источник: Volvo Penta Power Generation datasheets 2023-2024.
//
// v0.60.214 split из shared/catalogs/dgu.js по производителям.
// =============================================================================

export const VOLVO_PENTA_DGUS = [
  {
    vendor: 'Volvo Penta', model: 'TAD941GE (250 kVA)',
    nameplateKw: 200, espKw: 200, prpKw: 180, copKw: 160,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TAD941GE', cylinders: 6, displacement: 9.4,
    fuelType: 'diesel', sfcLkWh: 0.232,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 3300, widthMm: 1100, heightMm: 1850, weightKg: 2050 },
    notes: 'EU Stage IIIA. Robust marine-derived block.',
  },
  {
    vendor: 'Volvo Penta', model: 'TAD1342GE (400 kVA)',
    nameplateKw: 320, espKw: 320, prpKw: 290, copKw: 260,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TAD1342GE', cylinders: 6, displacement: 13,
    fuelType: 'diesel', sfcLkWh: 0.219,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 4200, widthMm: 1400, heightMm: 2150, weightKg: 3200 },
    notes: 'Compact for footprint-constrained sites.',
  },
  {
    vendor: 'Volvo Penta', model: 'TWD1683GE (650 kVA)',
    nameplateKw: 520, espKw: 520, prpKw: 470, copKw: 420,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TWD1683GE', cylinders: 6, displacement: 16.1,
    fuelType: 'diesel', sfcLkWh: 0.213,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 4800, widthMm: 1700, heightMm: 2300, weightKg: 4900 },
    notes: 'Mid-range for medium DC.',
  },
];
