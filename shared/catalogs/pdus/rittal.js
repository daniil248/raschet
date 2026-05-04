// =============================================================================
// shared/catalogs/pdus/rittal.js — Rittal PSM (1U) и PDU (ZeroU)
// =============================================================================
// v0.60.217 (split). Полный набор: 1U managed + ZeroU basic/metered/switched/
// monitored/hybrid + Schuko/HD-варианты + 63A.

export const RITTAL_PDUS = [
  // PSM Basic 1U
  { sku: 'DK 7856.008', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×Schuko', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'DK 7856.200', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×Schuko (EU)', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'DK 7856.201', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.202', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.203', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 32A, 6×C13 + 4×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:4 }] },
  { sku: 'DK 7856.250', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 3ф 16A, 12×C13 + 3×C19', phases: 3, rating: 16, height: 1, outlets: [{ type:'C13', count:12 }, { type:'C19', count:3 }] },
  // PSM ZeroU Basic
  { sku: 'DK 7955.100', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 24×C13', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }] },
  { sku: 'DK 7955.110', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.120', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.130', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.140', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  // PSM Metered
  { sku: 'DK 7955.300', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.310', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.320', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.330', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  // PSM Switched
  { sku: 'DK 7955.400', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.410', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.420', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.430', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // PSM Monitored+Switched (hybrid)
  { sku: 'DK 7955.500', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.510', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.520', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.530', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // ZeroU HD (36×C13)
  { sku: 'DK 7955.150', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.350', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.450', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.550', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Schuko-варианты (EU)
  { sku: 'DK 7955.160', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  { sku: 'DK 7955.360', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  { sku: 'DK 7955.460', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  // Смешанные гнёзда (C13+C19+Schuko)
  { sku: 'DK 7955.170', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 32A, 12×C13 + 6×C19 + 6×Schuko', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:12 }, { type:'C19', count:6 }, { type:'Schuko', count:6 }] },
  { sku: 'DK 7955.370', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 32A, 12×C13 + 6×C19 + 6×Schuko', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:12 }, { type:'C19', count:6 }, { type:'Schuko', count:6 }] },
  // 63A HD-линейка (HPC, крупные нагрузки)
  { sku: 'DK 7955.180', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.380', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.480', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.580', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  // 1U managed (DK 7856.3xx/4xx/5xx)
  { sku: 'DK 7856.300', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.310', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.320', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 32A, 8×C13 + 2×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:8 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.400', mfg: 'Rittal', category: 'switched', name: 'Rittal PSM switched, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.410', mfg: 'Rittal', category: 'switched', name: 'Rittal PSM switched, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.500', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PSM metered+switched by outlet, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.510', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PSM metered+switched by outlet, 1U, 1ф 32A, 8×C13 + 2×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:8 }, { type:'C19', count:2 }] },
  // Monitored (metered-by-outlet)
  { sku: 'DK 7955.600', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.610', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.620', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.630', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.650', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
];
