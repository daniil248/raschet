// =============================================================================
// shared/catalogs/dgu-aj-power.js
// AJ Power (Северная Ирландия / Великобритания) DGUs — DA серия.
// Двигатели — Volvo Penta, Perkins.
//
// Источник: www.ajpower.net / AJ Power 50Hz Diesel Generator datasheets.
// Серия DA = Diesel Alternator. Модели именуются по схеме:
//   DA<phase>-AJ<kVA>-P<package> (P1=open frame, P2=canopy, P3=container).
//   DA3 — 3-phase 400/230V.
//
// v0.60.214 (по репорту Пользователя 2026-05-04 «так же мне нужны ДГУ
// AJ Power, включая DA3-AJ165-P1»).
// =============================================================================

export const AJ_POWER_DGUS = [
  // v0.60.322: derateProfile — id профиля derate (см.
  // dgu-config/calc/dgu-calc.js ENGINE_DERATE_PROFILES). Прописывается
  // прямо в datasheet — каталог = source of truth для подбора и derate.
  {
    vendor: 'AJ Power', model: 'DA3-AJ110-P1 (110 kVA)',
    nameplateKw: 88, espKw: 88, prpKw: 80, copKw: 72,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TAD531GE', cylinders: 4, displacement: 5.1,
    fuelType: 'diesel', sfcLkWh: 0.230,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 2700, widthMm: 1050, heightMm: 1750, weightKg: 1500 },
    notes: '110 кВА open-frame (P1). Volvo Penta engine. Малый коммерческий объект.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ165-P1 (165 kVA)',
    nameplateKw: 132, espKw: 132, prpKw: 120, copKw: 108,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TAD732GE', cylinders: 6, displacement: 7.2,
    fuelType: 'diesel', sfcLkWh: 0.227,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 3000, widthMm: 1100, heightMm: 1850, weightKg: 1850 },
    notes: '165 кВА open-frame (P1). Volvo Penta TAD732GE 6-cyl. Средний коммерческий объект.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ165-P2 (165 kVA, canopy)',
    nameplateKw: 132, espKw: 132, prpKw: 120, copKw: 108,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TAD732GE', cylinders: 6, displacement: 7.2,
    fuelType: 'diesel', sfcLkWh: 0.227,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 2050, weightKg: 2200 },
    notes: '165 кВА в canopy (P2) ~75 dB@7m. Volvo Penta TAD732GE.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ250-P1 (250 kVA)',
    nameplateKw: 200, espKw: 200, prpKw: 180, copKw: 162,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TAD941GE', cylinders: 6, displacement: 9.4,
    fuelType: 'diesel', sfcLkWh: 0.222,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 1950, weightKg: 2400 },
    notes: '250 кВА open-frame (P1). Volvo Penta TAD941GE 9.4L.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ400-P1 (400 kVA)',
    nameplateKw: 320, espKw: 320, prpKw: 290, copKw: 260,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TAD1342GE', cylinders: 6, displacement: 13,
    fuelType: 'diesel', sfcLkWh: 0.218,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 4200, widthMm: 1400, heightMm: 2150, weightKg: 3400 },
    notes: '400 кВА open-frame (P1). Volvo Penta TAD1342GE 13L. Средний/большой ЦОД.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ650-P1 (650 kVA)',
    nameplateKw: 520, espKw: 520, prpKw: 470, copKw: 420,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Volvo Penta TWD1683GE', cylinders: 6, displacement: 16.1,
    fuelType: 'diesel', sfcLkWh: 0.213,
    derateProfile: 'volvo-tad-twd',
    physical: { lengthMm: 4800, widthMm: 1700, heightMm: 2300, weightKg: 5200 },
    notes: '650 кВА open-frame (P1). Volvo Penta TWD1683GE 16.1L. Большой ЦОД.',
  },
  {
    vendor: 'AJ Power', model: 'DA3-AJ1000-P3 (1000 kVA, container)',
    nameplateKw: 800, espKw: 800, prpKw: 720, copKw: 640,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 4006-23TAG3A', cylinders: 6, displacement: 23,
    fuelType: 'diesel', sfcLkWh: 0.210,
    derateProfile: 'perkins-4000-series',
    physical: { lengthMm: 6100, widthMm: 2440, heightMm: 2800, weightKg: 9500 },
    notes: '1000 кВА в контейнере (P3, 20-ft). Perkins 4006 engine. Mission-critical.',
  },
];
