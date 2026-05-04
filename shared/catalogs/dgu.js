// =============================================================================
// dgu-config/datasheets/index.js — каталог типовых ДГУ
// =============================================================================
// Phase 30.3: типовые модели Caterpillar / Cummins / Volvo Penta / FG Wilson.
// Параметры — из открытых datasheet-ов производителей.
//
// Pure JS, no DOM.

/**
 * Каталог. Каждая запись:
 *   { vendor, model, nameplateKw, espKw, prpKw, copKw, voltage, phase,
 *     rpm, engineModel, cylinders, displacement, fuelType, sfcLkWh,
 *     dimensions, weightKg, refrigerant, notes }
 *
 * espKw / prpKw / copKw — мощности по режимам (ISO 8528-1).
 * sfcLkWh — specific fuel consumption при 75% нагрузки (ISO 3046-1).
 */
export const DGU_DATASHEETS = [
  // ===== Caterpillar =====
  {
    vendor: 'Caterpillar', model: 'C18 (DE220 GC)',
    nameplateKw: 220, espKw: 220, prpKw: 200, copKw: 180,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C9.3', cylinders: 6, displacement: 9.3,
    fuelType: 'diesel', sfcLkWh: 0.225,
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 1900, weightKg: 2300 },
    notes: 'Open-frame, Tier 3. Soundproof enclosure +30dB option.',
  },
  {
    vendor: 'Caterpillar', model: 'C18 (DE400 E0)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 320,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C18', cylinders: 6, displacement: 18.1,
    fuelType: 'diesel', sfcLkWh: 0.220,
    physical: { lengthMm: 4500, widthMm: 1500, heightMm: 2200, weightKg: 4200 },
    notes: 'Tier 3 / EU Stage IIIA. Wide ambient -10°C…+50°C.',
  },
  {
    vendor: 'Caterpillar', model: 'C32 (DE800 E0)',
    nameplateKw: 800, espKw: 800, prpKw: 720, copKw: 640,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C32', cylinders: 12, displacement: 32.1,
    fuelType: 'diesel', sfcLkWh: 0.210,
    physical: { lengthMm: 5800, widthMm: 1900, heightMm: 2400, weightKg: 7500 },
    notes: 'High-voltage 400V/690V option.',
  },
  {
    vendor: 'Caterpillar', model: '3516 (DE1500 E0)',
    nameplateKw: 1500, espKw: 1500, prpKw: 1365, copKw: 1200,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3516B', cylinders: 16, displacement: 69,
    fuelType: 'diesel', sfcLkWh: 0.205,
    physical: { lengthMm: 7500, widthMm: 2200, heightMm: 2800, weightKg: 14500 },
    notes: 'Heavy-duty data center class. Parallel-ready.',
  },

  // ===== Cummins =====
  {
    vendor: 'Cummins', model: 'C220D5 (QSL9-G7)',
    nameplateKw: 220, espKw: 220, prpKw: 200, copKw: 180,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSL9-G7', cylinders: 6, displacement: 8.9,
    fuelType: 'diesel', sfcLkWh: 0.228,
    physical: { lengthMm: 3400, widthMm: 1200, heightMm: 1900, weightKg: 2350 },
    notes: 'PowerCommand 2.3 controller. EU Stage IIIA.',
  },
  {
    vendor: 'Cummins', model: 'C400D5 (QSX15-G8)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 330,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSX15-G8', cylinders: 6, displacement: 15,
    fuelType: 'diesel', sfcLkWh: 0.215,
    physical: { lengthMm: 4400, widthMm: 1500, heightMm: 2200, weightKg: 4150 },
    notes: 'PowerCommand 3.3.',
  },
  {
    vendor: 'Cummins', model: 'C825D5 (QSK23-G3)',
    nameplateKw: 825, espKw: 825, prpKw: 750, copKw: 670,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK23-G3', cylinders: 12, displacement: 23,
    fuelType: 'diesel', sfcLkWh: 0.207,
    physical: { lengthMm: 5400, widthMm: 1900, heightMm: 2400, weightKg: 7900 },
    notes: 'Quiet enclosure -24dB. 14 days fuel tank option.',
  },
  {
    vendor: 'Cummins', model: 'C1675D5 (QSK60-G3)',
    nameplateKw: 1675, espKw: 1675, prpKw: 1525, copKw: 1340,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G3', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.203,
    physical: { lengthMm: 7800, widthMm: 2300, heightMm: 2900, weightKg: 15800 },
    notes: 'Mission-critical class. Tier 2.',
  },

  // ===== Volvo Penta =====
  {
    vendor: 'Volvo Penta', model: 'TAD941GE (250 kVA)',
    nameplateKw: 200, espKw: 200, prpKw: 180, copKw: 160,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TAD941GE', cylinders: 6, displacement: 9.4,
    fuelType: 'diesel', sfcLkWh: 0.232,
    physical: { lengthMm: 3300, widthMm: 1100, heightMm: 1850, weightKg: 2050 },
    notes: 'EU Stage IIIA. Robust marine-derived block.',
  },
  {
    vendor: 'Volvo Penta', model: 'TAD1342GE (400 kVA)',
    nameplateKw: 320, espKw: 320, prpKw: 290, copKw: 260,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TAD1342GE', cylinders: 6, displacement: 13,
    fuelType: 'diesel', sfcLkWh: 0.219,
    physical: { lengthMm: 4200, widthMm: 1400, heightMm: 2150, weightKg: 3200 },
    notes: 'Compact for footprint-constrained sites.',
  },
  {
    vendor: 'Volvo Penta', model: 'TWD1683GE (650 kVA)',
    nameplateKw: 520, espKw: 520, prpKw: 470, copKw: 420,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'TWD1683GE', cylinders: 6, displacement: 16.1,
    fuelType: 'diesel', sfcLkWh: 0.213,
    physical: { lengthMm: 4800, widthMm: 1700, heightMm: 2300, weightKg: 4900 },
    notes: 'Mid-range for medium DC.',
  },

  // ===== FG Wilson =====
  {
    vendor: 'FG Wilson', model: 'P200H (200 kVA)',
    nameplateKw: 160, espKw: 160, prpKw: 145, copKw: 130,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 1106A-70TG3', cylinders: 6, displacement: 7,
    fuelType: 'diesel', sfcLkWh: 0.235,
    physical: { lengthMm: 3200, widthMm: 1100, heightMm: 1800, weightKg: 1950 },
    notes: 'Perkins powered. Cost-effective for small DC.',
  },
  {
    vendor: 'FG Wilson', model: 'P400P3 (400 kVA)',
    nameplateKw: 320, espKw: 320, prpKw: 290, copKw: 260,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 2206A-E13TAG3', cylinders: 6, displacement: 12.5,
    fuelType: 'diesel', sfcLkWh: 0.222,
    physical: { lengthMm: 4400, widthMm: 1500, heightMm: 2200, weightKg: 3700 },
    notes: 'PowerWizard 2.1 controller.',
  },
  {
    vendor: 'FG Wilson', model: 'P800P3 (800 kVA)',
    nameplateKw: 640, espKw: 640, prpKw: 580, copKw: 515,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 4006-23TAG3A', cylinders: 6, displacement: 23,
    fuelType: 'diesel', sfcLkWh: 0.215,
    physical: { lengthMm: 5300, widthMm: 1900, heightMm: 2400, weightKg: 6500 },
    notes: 'Heavy-fuel option (HFO ready).',
  },
  // ===== v0.60.92: расширение каталога до 2500 кВА (запрос Пользователя 2026-05-03) =====
  // Большие гензетки для крупных ЦОД и промышленных объектов.
  {
    vendor: 'Caterpillar', model: '3516B (DE1800 E0)',
    nameplateKw: 1440, espKw: 1440, prpKw: 1310, copKw: 1150,  // ~1800 kVA при cos 0.8
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3516B', cylinders: 16, displacement: 69,
    fuelType: 'diesel', sfcLkWh: 0.205,
    physical: { lengthMm: 8200, widthMm: 2300, heightMm: 2800, weightKg: 16500 },
    notes: 'Tier 2. Промышленный класс. 1800 кВА @ cos 0.8.',
  },
  {
    vendor: 'Caterpillar', model: '3520C (DE2000 E0)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,  // 2000 kVA @ 0.8
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat 3520C', cylinders: 20, displacement: 78,
    fuelType: 'diesel', sfcLkWh: 0.202,
    physical: { lengthMm: 8800, widthMm: 2400, heightMm: 2900, weightKg: 18800 },
    notes: 'Mission-critical. 2000 кВА. Параллель до 16 единиц через EMCP4.',
  },
  {
    vendor: 'Caterpillar', model: 'C175-16 (DE2500 E0)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,  // 2500 kVA @ 0.8
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cat C175-16', cylinders: 16, displacement: 85,
    fuelType: 'diesel', sfcLkWh: 0.198,
    physical: { lengthMm: 9500, widthMm: 2500, heightMm: 3000, weightKg: 22000 },
    notes: 'Top of the C175 family. 2500 кВА. Tier 4 Final option. Для крупных ЦОД 5+ МВт суммарно.',
  },
  {
    vendor: 'Cummins', model: 'C2000D5 (QSK60-G14)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,  // 2000 kVA
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G14', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.200,
    physical: { lengthMm: 8400, widthMm: 2400, heightMm: 2900, weightKg: 17500 },
    notes: 'PowerCommand 3.3. 2000 кВА. Совместим с PowerCommand cloud для удалённого мониторинга.',
  },
  {
    vendor: 'Cummins', model: 'C2250D5 (QSK60-G15)',
    nameplateKw: 1800, espKw: 1800, prpKw: 1640, copKw: 1440,  // 2250 kVA
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK60-G15', cylinders: 16, displacement: 60,
    fuelType: 'diesel', sfcLkWh: 0.198,
    physical: { lengthMm: 8800, widthMm: 2500, heightMm: 2900, weightKg: 18900 },
    notes: '2250 кВА. Auxiliary water-cooled aftercooler.',
  },
  {
    vendor: 'Cummins', model: 'C2500D5 (QSK78-G16)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,  // 2500 kVA
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'QSK78-G16', cylinders: 18, displacement: 78,
    fuelType: 'diesel', sfcLkWh: 0.196,
    physical: { lengthMm: 9300, widthMm: 2600, heightMm: 3000, weightKg: 21500 },
    notes: '2500 кВА. Hybrid Tier 2/4 ready. Для гипер-ЦОД (10+ МВт суммарно).',
  },
  {
    vendor: 'MTU', model: '20V4000G94S (DE2500 E0)',
    nameplateKw: 2000, espKw: 2000, prpKw: 1820, copKw: 1600,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 20V4000G94S', cylinders: 20, displacement: 95.4,
    fuelType: 'diesel', sfcLkWh: 0.193,
    physical: { lengthMm: 9800, widthMm: 2700, heightMm: 3100, weightKg: 24500 },
    notes: 'Rolls-Royce Power Systems. Топ-класс для ЦОД Tier IV. 2500 кВА.',
  },
  {
    vendor: 'MTU', model: '16V4000G94S (DE2000 E0)',
    nameplateKw: 1600, espKw: 1600, prpKw: 1455, copKw: 1280,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 16V4000G94S', cylinders: 16, displacement: 76.3,
    fuelType: 'diesel', sfcLkWh: 0.195,
    physical: { lengthMm: 9000, widthMm: 2600, heightMm: 3000, weightKg: 22000 },
    notes: 'MTU Series 4000. 2000 кВА. Стандарт data center industry.',
  },
  // ===== AKSA (Турция) =====
  // v0.60.213 (по репорту Пользователя 2026-05-04 «добавь в каталог ДГУ AKSA»):
  // турецкий бренд, популярен в КЗ/РФ. Двигатели — Doosan, Cummins, Perkins,
  // Volvo Penta, Baudouin (выбор от модели и мощности).
  // Параметры — из открытых datasheet www.aksa.com.tr.
  {
    vendor: 'AKSA', model: 'APD33C (33 kVA / Cummins)',
    nameplateKw: 26, espKw: 26, prpKw: 24, copKw: 22,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cummins X2.5-G3', cylinders: 4, displacement: 2.5,
    fuelType: 'diesel', sfcLkWh: 0.245,
    physical: { lengthMm: 1900, widthMm: 800, heightMm: 1300, weightKg: 750 },
    notes: '33 кВА. Малая мощность для офиса/коттеджа. Open-frame или canopy.',
  },
  {
    vendor: 'AKSA', model: 'APD110A (110 kVA / Doosan)',
    nameplateKw: 88, espKw: 88, prpKw: 80, copKw: 72,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Doosan P086TI', cylinders: 6, displacement: 5.9,
    fuelType: 'diesel', sfcLkWh: 0.235,
    physical: { lengthMm: 2700, widthMm: 1100, heightMm: 1700, weightKg: 1450 },
    notes: '110 кВА. Малый/средний коммерческий объект. Soundproof опция -75dB@7m.',
  },
  {
    vendor: 'AKSA', model: 'APD220A (220 kVA / Doosan)',
    nameplateKw: 176, espKw: 176, prpKw: 160, copKw: 145,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Doosan P126TI-II', cylinders: 6, displacement: 11.1,
    fuelType: 'diesel', sfcLkWh: 0.225,
    physical: { lengthMm: 3500, widthMm: 1200, heightMm: 1900, weightKg: 2100 },
    notes: '220 кВА. Стандарт для серверной/малого ЦОД. ATS-готовность.',
  },
  {
    vendor: 'AKSA', model: 'APD330C (330 kVA / Cummins)',
    nameplateKw: 264, espKw: 264, prpKw: 240, copKw: 215,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Cummins NTAA855-G7A', cylinders: 6, displacement: 14,
    fuelType: 'diesel', sfcLkWh: 0.218,
    physical: { lengthMm: 4000, widthMm: 1400, heightMm: 2100, weightKg: 3000 },
    notes: '330 кВА. Средний коммерческий / малый ЦОД (10–20 стоек).',
  },
  {
    vendor: 'AKSA', model: 'APD500P (500 kVA / Perkins)',
    nameplateKw: 400, espKw: 400, prpKw: 365, copKw: 320,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Perkins 2506A-E15TAG2', cylinders: 6, displacement: 15.2,
    fuelType: 'diesel', sfcLkWh: 0.215,
    physical: { lengthMm: 4500, widthMm: 1600, heightMm: 2200, weightKg: 4500 },
    notes: '500 кВА. Средний ЦОД (30–50 стоек) или промышленный объект.',
  },
  {
    vendor: 'AKSA', model: 'APD825BD (825 kVA / Baudouin)',
    nameplateKw: 660, espKw: 660, prpKw: 600, copKw: 540,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'Baudouin 12M26.2', cylinders: 12, displacement: 26.0,
    fuelType: 'diesel', sfcLkWh: 0.207,
    physical: { lengthMm: 5500, widthMm: 1900, heightMm: 2400, weightKg: 7800 },
    notes: '825 кВА. Большой коммерческий ЦОД (60–100 стоек). Tier III/IV ready.',
  },
  {
    vendor: 'AKSA', model: 'APD1250M (1250 kVA / MTU)',
    nameplateKw: 1000, espKw: 1000, prpKw: 910, copKw: 800,
    voltage: 400, phase: 3, freq: 50, rpm: 1500,
    engineModel: 'MTU 12V2000G65', cylinders: 12, displacement: 23.9,
    fuelType: 'diesel', sfcLkWh: 0.200,
    physical: { lengthMm: 6500, widthMm: 2200, heightMm: 2700, weightKg: 11000 },
    notes: '1250 кВА. Промышленный ЦОД / hyperscale (100+ стоек). MTU engine.',
  },
];

/**
 * Получить ДГУ-датшиты по фильтру.
 * @param {object} [filter] — { vendor?, minKw?, maxKw? }
 */
export function listDgus(filter = {}) {
  let arr = DGU_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  if (filter.minKw)  arr = arr.filter(d => d.nameplateKw >= filter.minKw);
  if (filter.maxKw)  arr = arr.filter(d => d.nameplateKw <= filter.maxKw);
  return arr;
}

export function listDguVendors() {
  return [...new Set(DGU_DATASHEETS.map(d => d.vendor))];
}

/**
 * Подобрать ближайшую модель ≥ requiredKw.
 * @param {number} requiredKw
 * @param {object} [filter] — { vendor?, mode? }
 * @returns {object|null}
 */
export function suggestDgu(requiredKw, filter = {}) {
  const mode = filter.mode || 'PRP';
  const fieldByMode = { ESP: 'espKw', PRP: 'prpKw', COP: 'copKw' };
  const field = fieldByMode[mode] || 'prpKw';
  let arr = DGU_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  arr.sort((a, b) => a[field] - b[field]);
  return arr.find(d => d[field] >= requiredKw) || arr[arr.length - 1] || null;
}
