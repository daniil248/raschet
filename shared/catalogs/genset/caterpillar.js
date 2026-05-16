// =============================================================================
// shared/catalogs/genset/caterpillar.js
// Caterpillar (CAT) DGUs — серия C9.3 / C18 / C32 / 3516 / 3520 / C175. 7 моделей.
// Источник: Cat Power Systems datasheets 2023-2024 (cat.com).
//
// v0.60.214 (по репорту Пользователя 2026-05-04 «не хочешь каждого
// производителя запихнуть в отдельный файл, как ИБП»): split каталога
// shared/catalogs/dgu.js по производителям.
// =============================================================================

export const CATERPILLAR_DGUS = [
  {
    vendor: 'Caterpillar', model: 'C18 (DE220 GC)',
    nameplateKw: 220, espKw: 220, prpKw: 200, copKw: 180,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C9.3', cylinders: 6, displacement: 9.3,
    fuelType: 'diesel', sfcLkWh: 0.225,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 1900, weightKg: 2300 },
    notes: 'Open-frame, Tier 3. Soundproof enclosure +30dB option.',
  },
  {
    vendor: 'Caterpillar', model: 'C18 (DE400 E0)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 320,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C18', cylinders: 6, displacement: 18.1,
    fuelType: 'diesel', sfcLkWh: 0.220,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 4500, widthMm: 1500, heightMm: 2200, weightKg: 4200 },
    notes: 'Mid-size DC standard. Tier 4 ready.',
  },
  {
    vendor: 'Caterpillar', model: 'C32 (DE800 E0)',
    nameplateKw: 800, espKw: 800, prpKw: 720, copKw: 640,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C32', cylinders: 12, displacement: 32.1,
    fuelType: 'diesel', sfcLkWh: 0.210,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 6500, widthMm: 2000, heightMm: 2600, weightKg: 9500 },
    notes: 'Large DC standard. Tier 4 Final.',
  },
  {
    vendor: 'Caterpillar', model: '3516 (DE1500 E0)',
    nameplateKw: 1500, espKw: 1500, prpKw: 1365, copKw: 1200,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3516B', cylinders: 16, displacement: 69,
    fuelType: 'diesel', sfcLkWh: 0.203,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 7800, widthMm: 2300, heightMm: 2900, weightKg: 15800 },
    notes: 'Mission-critical class. Tier 2.',
  },
  {
    vendor: 'Caterpillar', model: '3516B (DE1800 E0)',
    nameplateKw: 1440, espKw: 1440, prpKw: 1310, copKw: 1150,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3516B', cylinders: 16, displacement: 69,
    fuelType: 'diesel', sfcLkWh: 0.205,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 8200, widthMm: 2300, heightMm: 2800, weightKg: 16500 },
    notes: 'Tier 2. Промышленный класс. 1800 кВА @ cos 0.8.',
  },
  {
    vendor: 'Caterpillar', model: '3520C (DE2000 E0)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3520C', cylinders: 20, displacement: 78,
    fuelType: 'diesel', sfcLkWh: 0.202,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 8800, widthMm: 2400, heightMm: 2900, weightKg: 18800 },
    notes: 'Mission-critical. 2000 кВА. Параллель до 16 единиц через EMCP4.',
  },
  {
    vendor: 'Caterpillar', model: 'C175-16 (DE2500 E0)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C175-16', cylinders: 16, displacement: 85,
    fuelType: 'diesel', sfcLkWh: 0.198,
    derateProfile: 'cat-c-series',
    physical: { lengthMm: 9500, widthMm: 2500, heightMm: 3000, weightKg: 22000 },
    notes: 'Top of the C175 family. 2500 кВА. Tier 4 Final option. Для крупных ЦОД 5+ МВт суммарно.',
  },
];
