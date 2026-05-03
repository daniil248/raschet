// =============================================================================
// dgu-config/datasheets/drups.js — каталог DRUPS (Diesel Rotary UPS)
// =============================================================================
// v0.60.92 (по запросу Пользователя 2026-05-03 «дизель динамические ИБП типа
// Hitec или Pillar, с соответствующим расчетом... может какой то отдельный
// конфигуратор»).
//
// DRUPS = Diesel Rotary Uninterruptible Power Supply.
// Принцип: маховик (kinetic energy storage) + дизельный двигатель + синхронная
// машина (мотор-генератор) на одном валу. При сбое сети маховик питает
// нагрузку 5-15 секунд, за это время запускается дизель и принимает нагрузку.
//
// Преимущества:
//   - Нет батарей (никаких химических расходников)
//   - Bypass через статор синхронной машины — практически бесперебойно
//   - Высокий КПД (96-97% против 94-96% UPS+DGU)
//   - Срок службы 25-30 лет
//   - PUE до 1.1-1.2
//
// Производители (открытая инфо):
//   - Hitec (Нидерланды/Австрия) — Continuous Power System (CPS)
//   - Piller (Германия) — UNIBLOCK UBT/UBR
//   - Euro-Diesel (Бельгия) — NO-BREAK KS
//   - Powerthru (USA) — flywheel only (rotary UPS без диесля)
//
// Pure JS, no DOM.

/**
 * DRUPS-датшит. Структура:
 *   { vendor, model, nameplateKva, nameplateKw, voltage, phase,
 *     flywheelType, autonomySec, engineModel, dieselKw, sfcLkWh,
 *     efficiency, physical, notes }
 *
 * autonomySec — сколько секунд маховик держит нагрузку до запуска дизеля.
 * efficiency — КПД системы при номинальной нагрузке (типично 96-97%).
 */
export const DRUPS_DATASHEETS = [
  // ===== Hitec Power Protection =====
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

  // ===== Piller =====
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (300 kVA)',
    nameplateKva: 300, nameplateKw: 240,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 8,
    engineModel: 'MAN D2862 LE451', dieselKw: 260, sfcLkWh: 0.220,
    efficiency: 0.967,
    physical: { lengthMm: 5800, widthMm: 1700, heightMm: 2200, weightKg: 5500 },
    notes: 'High-speed flywheel (магнитные подшипники). Compact для офисных серверных и mid-sized DC.',
  },
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (1670 kVA)',
    nameplateKva: 1670, nameplateKw: 1340,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 12,
    engineModel: 'MTU 16V4000G14', dieselKw: 1450, sfcLkWh: 0.203,
    efficiency: 0.972,
    physical: { lengthMm: 9800, widthMm: 2400, heightMm: 2700, weightKg: 21500 },
    notes: 'Standard mid-large block. ISO/IEC 8528-13 DCC class. Используется в Hyperscale ЦОД.',
  },
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (3000 kVA)',
    nameplateKva: 3000, nameplateKw: 2400,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 16,
    engineModel: 'MTU 20V4000G94', dieselKw: 2550, sfcLkWh: 0.197,
    efficiency: 0.973,
    physical: { lengthMm: 12200, widthMm: 2700, heightMm: 3100, weightKg: 36000 },
    notes: 'Largest standard block. Параллель до 8. КПД 97.3% — лучший в классе. Tier IV.',
  },

  // ===== Euro-Diesel =====
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

export function listDrups(filter = {}) {
  let arr = DRUPS_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  if (filter.minKva) arr = arr.filter(d => d.nameplateKva >= filter.minKva);
  if (filter.maxKva) arr = arr.filter(d => d.nameplateKva <= filter.maxKva);
  return arr;
}

export function listDrupsVendors() {
  return [...new Set(DRUPS_DATASHEETS.map(d => d.vendor))];
}

/**
 * Подобрать ближайшую DRUPS ≥ requiredKva.
 */
export function suggestDrups(requiredKva, filter = {}) {
  let arr = DRUPS_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  arr.sort((a, b) => a.nameplateKva - b.nameplateKva);
  return arr.find(d => d.nameplateKva >= requiredKva) || arr[arr.length - 1] || null;
}
