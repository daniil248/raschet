// =============================================================================
// shared/catalogs/dgu-aksa.js
// AKSA Power Generation (Турция) DGUs — APD серия. 7 моделей.
// Источник: www.aksa.com.tr datasheets 2023-2024.
//
// Двигатели — Doosan, Cummins, Perkins, Volvo Penta, Baudouin, MTU
// (выбор зависит от модели и мощности).
//
// v0.60.214 split из shared/catalogs/dgu.js по производителям.
// =============================================================================

export const AKSA_DGUS = [
  {
    vendor: 'AKSA', model: 'APD33C (33 kVA / Cummins)',
    nameplateKw: 26, espKw: 26, prpKw: 24, copKw: 22,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cummins X2.5-G3', cylinders: 4, displacement: 2.5,
    fuelType: 'diesel', sfcLkWh: 0.245,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 1900, widthMm: 800, heightMm: 1300, weightKg: 750 },
    notes: '33 кВА. Малая мощность для офиса/коттеджа. Open-frame или canopy.',
  },
  {
    vendor: 'AKSA', model: 'APD110A (110 kVA / Doosan)',
    nameplateKw: 88, espKw: 88, prpKw: 80, copKw: 72,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Doosan P086TI', cylinders: 6, displacement: 5.9,
    fuelType: 'diesel', sfcLkWh: 0.235,
    derateProfile: 'modern-turbo-aftercooled',
    physical: { lengthMm: 2700, widthMm: 1100, heightMm: 1700, weightKg: 1450 },
    notes: '110 кВА. Малый/средний коммерческий объект. Soundproof опция -75dB@7m.',
  },
  {
    vendor: 'AKSA', model: 'APD220A (220 kVA / Doosan)',
    nameplateKw: 176, espKw: 176, prpKw: 160, copKw: 145,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Doosan P126TI-II', cylinders: 6, displacement: 11.1,
    fuelType: 'diesel', sfcLkWh: 0.225,
    derateProfile: 'modern-turbo-aftercooled',
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 1900, weightKg: 2100 },
    notes: '220 кВА. Стандарт для серверной/малого ЦОД. ATS-готовность.',
  },
  {
    vendor: 'AKSA', model: 'APD330C (330 kVA / Cummins)',
    nameplateKw: 264, espKw: 264, prpKw: 240, copKw: 215,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cummins NTAA855-G7A', cylinders: 6, displacement: 14,
    fuelType: 'diesel', sfcLkWh: 0.218,
    derateProfile: 'cummins-qs-series',
    physical: { lengthMm: 4000, widthMm: 1400, heightMm: 2100, weightKg: 3000 },
    notes: '330 кВА. Средний коммерческий / малый ЦОД (10–20 стоек).',
  },
  {
    vendor: 'AKSA', model: 'APD500P (500 kVA / Perkins)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 320,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 2506A-E15TAG2', cylinders: 6, displacement: 15.2,
    fuelType: 'diesel', sfcLkWh: 0.215,
    derateProfile: 'perkins-2506a-e15',
    physical: { lengthMm: 4500, widthMm: 1600, heightMm: 2200, weightKg: 4500 },
    notes: '500 кВА. Средний ЦОД (30–50 стоек) или промышленный объект.',
  },
  {
    vendor: 'AKSA', model: 'APD825BD (825 kVA / Baudouin)',
    nameplateKw: 660, espKw: 660, prpKw: 600, copKw: 540,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Baudouin 12M26.2', cylinders: 12, displacement: 26.0,
    fuelType: 'diesel', sfcLkWh: 0.207,
    derateProfile: 'modern-turbo-aftercooled',
    physical: { lengthMm: 5500, widthMm: 1900, heightMm: 2400, weightKg: 7800 },
    notes: '825 кВА. Большой коммерческий ЦОД (60–100 стоек). Tier III/IV ready.',
  },
  {
    vendor: 'AKSA', model: 'APD1250M (1250 kVA / MTU)',
    nameplateKw: 1000, espKw: 1000, prpKw: 910, copKw: 800,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 12V2000G65', cylinders: 12, displacement: 23.9,
    fuelType: 'diesel', sfcLkWh: 0.200,
    derateProfile: 'mtu-large',
    physical: { lengthMm: 6500, widthMm: 2200, heightMm: 2700, weightKg: 11000 },
    notes: '1250 кВА. Промышленный ЦОД / hyperscale (100+ стоек). MTU engine.',
  },
];
