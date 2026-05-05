// =============================================================================
// shared/catalogs/dgu-cummins.js
// Cummins DGUs — серии QSL9 / QSX15 / QSK23 / QSK60 / QSK78. 7 моделей.
// Источник: Cummins Power Generation datasheets 2023-2024.
//
// v0.60.214 split из shared/catalogs/dgu.js по производителям.
// =============================================================================

export const CUMMINS_DGUS = [
  {
    vendor: 'Cummins', model: 'C220D5 (QSL9-G7)',
    nameplateKw: 220, espKw: 220, prpKw: 200, copKw: 180,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSL9-G7', cylinders: 6, displacement: 8.9,
    fuelType: 'diesel', sfcLkWh: 0.230,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 3400, widthMm: 1200, heightMm: 1800, weightKg: 2200 },
    notes: 'PowerCommand controller. Standard 220 kVA.',
  },
  {
    vendor: 'Cummins', model: 'C400D5 (QSX15-G8)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 330,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSX15-G8', cylinders: 6, displacement: 15,
    fuelType: 'diesel', sfcLkWh: 0.218,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 4400, widthMm: 1500, heightMm: 2150, weightKg: 4100 },
    notes: 'PowerCommand 3.3.',
  },
  {
    vendor: 'Cummins', model: 'C825D5 (QSK23-G3)',
    nameplateKw: 825, espKw: 825, prpKw: 750, copKw: 670,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK23-G3', cylinders: 12, displacement: 23,
    fuelType: 'diesel', sfcLkWh: 0.208,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 6800, widthMm: 2050, heightMm: 2700, weightKg: 9800 },
    notes: 'Heavy-duty. Параллельная работа до 8 единиц.',
  },
  {
    vendor: 'Cummins', model: 'C1675D5 (QSK60-G3)',
    nameplateKw: 1675, espKw: 1675, prpKw: 1525, copKw: 1340,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G3', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.203,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 7800, widthMm: 2300, heightMm: 2900, weightKg: 15800 },
    notes: 'Mission-critical class. Tier 2.',
  },
  {
    vendor: 'Cummins', model: 'C2000D5 (QSK60-G14)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G14', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.200,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 8400, widthMm: 2400, heightMm: 2900, weightKg: 17500 },
    notes: 'PowerCommand 3.3. 2000 кВА. Совместим с PowerCommand cloud для удалённого мониторинга.',
  },
  {
    vendor: 'Cummins', model: 'C2250D5 (QSK60-G15)',
    nameplateKw: 1800, espKw: 1800, prpKw: 1640, copKw: 1440,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G15', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.198,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 8800, widthMm: 2500, heightMm: 2900, weightKg: 18900 },
    notes: '2250 кВА. Auxiliary water-cooled aftercooler.',
  },
  {
    vendor: 'Cummins', model: 'C2500D5 (QSK78-G16)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK78-G16', cylinders: 18, displacement: 78,
    fuelType: 'diesel', sfcLkWh: 0.196,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 9300, widthMm: 2600, heightMm: 3000, weightKg: 21500 },
    notes: '2500 кВА. Hybrid Tier 2/4 ready. Для гипер-ЦОД (10+ МВт суммарно).',
  },
];
