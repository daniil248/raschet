// =============================================================================
// shared/catalogs/dgu-mtu.js
// MTU (Rolls-Royce Power Systems) DGUs — Series 4000 G94S. 2 модели.
// Источник: MTU/Rolls-Royce Power Systems datasheets 2023-2024.
//
// v0.60.214 split из shared/catalogs/dgu.js по производителям.
// =============================================================================

export const MTU_DGUS = [
  {
    vendor: 'MTU', model: '20V4000G94S (DE2500 E0)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 20V4000G94S', cylinders: 20, displacement: 95.4,
    fuelType: 'diesel', sfcLkWh: 0.193,
    derateProfile: 'mtu-large',
    physical: { lengthMm: 9800, widthMm: 2700, heightMm: 3100, weightKg: 24500 },
    notes: 'Rolls-Royce Power Systems. Топ-класс для ЦОД Tier IV. 2500 кВА.',
  },
  {
    vendor: 'MTU', model: '16V4000G94S (DE2000 E0)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 16V4000G94S', cylinders: 16, displacement: 76.3,
    fuelType: 'diesel', sfcLkWh: 0.195,
    derateProfile: 'mtu-large',
    physical: { lengthMm: 9000, widthMm: 2600, heightMm: 3000, weightKg: 22000 },
    notes: 'MTU Series 4000. 2000 кВА. Стандарт data center industry.',
  },
];
