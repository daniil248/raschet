// =============================================================================
// shared/catalogs/drups/hitec.js — Hitec Power Protection (Нидерланды/Австрия)
// =============================================================================
// v0.60.217 (split). DRUPS = Diesel Rotary UPS, Continuous Power System (CPS).
// Маховик низких оборотов в вакууме + дизель MTU.

export const HITEC_DRUPS = [
  {
    vendor: 'Hitec', model: 'PowerPRO 2700 (300 kVA)',
    nameplateKva: 300, nameplateKw: 240,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'low-speed-vacuum', autonomySec: 12,
    engineModel: 'MTU 8V2000G81', dieselKw: 280, sfcLkWh: 0.225,
    efficiency: 0.965,
    physical: { lengthMm: 5500, widthMm: 1800, heightMm: 2100, weightKg: 6800 },
    notes: 'Compact CPS для малых-средних ЦОД. Маховик ~140 кг, autonomy 10-12 сек. PUE 1.15-1.20.',
  },
  {
    vendor: 'Hitec', model: 'PowerPRO 2500 (1500 kVA)',
    nameplateKva: 1500, nameplateKw: 1200,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'low-speed-vacuum', autonomySec: 14,
    engineModel: 'MTU 16V4000G14F', dieselKw: 1280, sfcLkWh: 0.205,
    efficiency: 0.968,
    physical: { lengthMm: 9500, widthMm: 2400, heightMm: 2700, weightKg: 22000 },
    notes: 'Mid-range data centre. Standard 1500 кВА block. Maintained 25 лет MTBF.',
  },
  {
    vendor: 'Hitec', model: 'PowerPRO 2700 (3000 kVA)',
    nameplateKva: 3000, nameplateKw: 2400,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'low-speed-vacuum', autonomySec: 16,
    engineModel: 'MTU 20V4000G94', dieselKw: 2520, sfcLkWh: 0.198,
    efficiency: 0.970,
    physical: { lengthMm: 12500, widthMm: 2800, heightMm: 3200, weightKg: 38500 },
    notes: 'Large data centre block. Параллель до 6 единиц. PUE 1.10-1.15. Tier IV.',
  },
];
