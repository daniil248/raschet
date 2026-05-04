// =============================================================================
// shared/catalogs/drups/euro-diesel.js — Euro-Diesel (Бельгия) NO-BREAK KS
// =============================================================================
// v0.60.217 (split). Low-speed stator-flywheel + Mitsubishi/MTU.

export const EURO_DIESEL_DRUPS = [
  {
    vendor: 'Euro-Diesel', model: 'NO-BREAK KS-XF (1250 kVA)',
    nameplateKva: 1250, nameplateKw: 1000,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'low-speed-stator', autonomySec: 14,
    engineModel: 'Mitsubishi S12R-PTAA2', dieselKw: 1080, sfcLkWh: 0.208,
    efficiency: 0.965,
    physical: { lengthMm: 8800, widthMm: 2200, heightMm: 2500, weightKg: 18000 },
    notes: 'Belgian heritage. Standard mid-size. Используется в Telecom и Defense.',
  },
  {
    vendor: 'Euro-Diesel', model: 'NO-BREAK KS-XF (2500 kVA)',
    nameplateKva: 2500, nameplateKw: 2000,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'low-speed-stator', autonomySec: 15,
    engineModel: 'MTU 16V4000G94S', dieselKw: 2160, sfcLkWh: 0.200,
    efficiency: 0.968,
    physical: { lengthMm: 11000, widthMm: 2600, heightMm: 2900, weightKg: 30000 },
    notes: 'Large block. Изолированный bypass — отдельный синхронный мотор. Tier III/IV.',
  },
];
