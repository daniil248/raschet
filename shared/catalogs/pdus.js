// ======================================================================
// shared/pdus-catalog-data.js
// Каталог блоков распределения питания PDU (kind='pdu').
// Выделен из shared/rack-catalog-data.js (v0.59.120).
//
// Экспорт:
//   PDU_CATEGORY          — справочник категорий (basic/metered/…)
//   PDU_CATALOG           — массив моделей (APC, Rittal, Raritan, Kehua)
//   listBuiltinPdus()     — маппинг в формат element-library
//   getLivePduCatalog()   — с учётом override-правок catalog-admin
//   pduBySku(sku)         — поиск по SKU
// ======================================================================

import { _syncList, _slug } from './_helpers.js';

export const PDU_CATEGORY = {
  basic:     'Базовый (без измерений)',
  metered:   'Metered (метеринг на вводе)',
  monitored: 'Metered-by-outlet (метеринг по розеткам)',
  switched:  'Switched (управление коммутацией)',
  hybrid:    'Monitored+Switched (метеринг+управление)',
};

export const PDU_CATALOG = [
  // APC
  { sku: 'AP7820B',  mfg: 'APC',    category: 'basic',
    name: 'APC Basic Rack PDU, 1U, 1ф 16A, 8×C13',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }] },
  { sku: 'AP7921B',  mfg: 'APC',    category: 'switched',
    name: 'APC Rack PDU 2G Switched, ZeroU, 1ф 16A, 8×C13 + 8×C19',
    phases: 1, rating: 16, height: 0,
    outlets: [{ type:'C13', count:8 }, { type:'C19', count:8 }] },
  { sku: 'AP8959',   mfg: 'APC',    category: 'metered',
    name: 'APC Rack PDU 2G Metered, ZeroU, 3ф 32A, 21×C13 + 3×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:21 }, { type:'C19', count:3 }] },
  { sku: 'AP7952',   mfg: 'APC',    category: 'switched',
    name: 'APC Rack PDU 2G Switched, ZeroU, 3ф 16A, 21×C13 + 3×C19',
    phases: 3, rating: 16, height: 0,
    outlets: [{ type:'C13', count:21 }, { type:'C19', count:3 }] },
  { sku: 'AP7998B',  mfg: 'APC',    category: 'monitored',
    name: 'APC Rack PDU 2G Metered-by-outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'APDU9959', mfg: 'APC',    category: 'hybrid',
    name: 'APC 9000-series Monitored+Switched, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Rittal — PSM Basic 1U
  { sku: 'DK 7856.008', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×Schuko', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'DK 7856.200', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×Schuko (EU)', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'DK 7856.201', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.202', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.203', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 1ф 32A, 6×C13 + 4×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:4 }] },
  { sku: 'DK 7856.250', mfg: 'Rittal', category: 'basic', name: 'Rittal PSM Basic, 1U, 3ф 16A, 12×C13 + 3×C19', phases: 3, rating: 16, height: 1, outlets: [{ type:'C13', count:12 }, { type:'C19', count:3 }] },
  // Rittal — PSM ZeroU Basic
  { sku: 'DK 7955.100', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 24×C13', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }] },
  { sku: 'DK 7955.110', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.120', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.130', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.140', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  // Rittal — PSM Metered
  { sku: 'DK 7955.300', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.310', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.320', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.330', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  // Rittal — PSM Switched
  { sku: 'DK 7955.400', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.410', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.420', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.430', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // Rittal — PSM Monitored+Switched (hybrid)
  { sku: 'DK 7955.500', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.510', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.520', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.530', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // Rittal — PSM ZeroU с увеличенной плотностью розеток (36×C13)
  { sku: 'DK 7955.150', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.350', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.450', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.550', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Rittal — Schuko-варианты для EU-розеточного парка
  { sku: 'DK 7955.160', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  { sku: 'DK 7955.360', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  { sku: 'DK 7955.460', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 1ф 16A, 18×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:18 }] },
  // Rittal — смешанные гнёзда (C13+C19+Schuko)
  { sku: 'DK 7955.170', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 1ф 32A, 12×C13 + 6×C19 + 6×Schuko', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:12 }, { type:'C19', count:6 }, { type:'Schuko', count:6 }] },
  { sku: 'DK 7955.370', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 1ф 32A, 12×C13 + 6×C19 + 6×Schuko', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:12 }, { type:'C19', count:6 }, { type:'Schuko', count:6 }] },
  // Rittal — 63A HD-линейка (для HPC/крупных нагрузок)
  { sku: 'DK 7955.180', mfg: 'Rittal', category: 'basic', name: 'Rittal PDU basic, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.380', mfg: 'Rittal', category: 'metered', name: 'Rittal PDU metered, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.480', mfg: 'Rittal', category: 'switched', name: 'Rittal PDU switched, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  { sku: 'DK 7955.580', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PDU metered+switched by outlet, ZeroU, 3ф 63A, 30×C13 + 12×C19', phases: 3, rating: 63, height: 0, outlets: [{ type:'C13', count:30 }, { type:'C19', count:12 }] },
  // Rittal — 1U managed (DK 7856.3xx/4xx/5xx)
  { sku: 'DK 7856.300', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.310', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.320', mfg: 'Rittal', category: 'metered', name: 'Rittal PSM metered, 1U, 1ф 32A, 8×C13 + 2×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:8 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.400', mfg: 'Rittal', category: 'switched', name: 'Rittal PSM switched, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.410', mfg: 'Rittal', category: 'switched', name: 'Rittal PSM switched, 1U, 1ф 16A, 6×C13 + 2×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:2 }] },
  { sku: 'DK 7856.500', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PSM metered+switched by outlet, 1U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:8 }] },
  { sku: 'DK 7856.510', mfg: 'Rittal', category: 'hybrid', name: 'Rittal PSM metered+switched by outlet, 1U, 1ф 32A, 8×C13 + 2×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:8 }, { type:'C19', count:2 }] },
  // Rittal — Monitored (metered-by-outlet)
  { sku: 'DK 7955.600', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 1ф 16A, 20×C13 + 4×C19', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.610', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'DK 7955.620', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 16A, 24×C13 + 6×C19', phases: 3, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.630', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'DK 7955.650', mfg: 'Rittal', category: 'monitored', name: 'Rittal PDU metered-by-outlet, ZeroU, 3ф 32A, 36×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // ЦМО — 19" 1U
  { sku: 'R-16-2P-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-16-2P-F, 1U, 1ф 16A, 2×Schuko, автомат + фильтр', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:2 }] },
  { sku: 'R-16-6P-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-16-6P-F, 1U, 1ф 16A, 6×Schuko, автомат + фильтр', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:6 }] },
  { sku: 'R-16-8S-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-16-8S-F, 1U, 1ф 16A, 8×Schuko, автомат + фильтр', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'R-16-9C13-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-16-9C13-F, 1U, 1ф 16A, 9×C13, автомат + фильтр', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:9 }] },
  { sku: 'R-16-6C13-3C19-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-16-6C13-3C19-F, 1U, 1ф 16A, 6×C13 + 3×C19', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:6 }, { type:'C19', count:3 }] },
  { sku: 'R-32-12C13-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-32-12C13-F, 1U, 1ф 32A, 12×C13, автомат + фильтр', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:12 }] },
  { sku: 'R-32-8C13-4C19-F', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток R-32-8C13-4C19-F, 1U, 1ф 32A, 8×C13 + 4×C19', phases: 1, rating: 32, height: 1, outlets: [{ type:'C13', count:8 }, { type:'C19', count:4 }] },
  // ЦМО — PV (вертикальные, 0U)
  { sku: 'PV-16A-6S', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток PV-16A-6S, 0U, 1ф 16A, 6×Schuko', phases: 1, rating: 16, height: 0, outlets: [{ type:'Schuko', count:6 }] },
  { sku: 'PV-16A-8C13', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток PV-16A-8C13, 0U, 1ф 16A, 8×C13', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:8 }] },
  { sku: 'PV-16A-24C13', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток PV-16A-24C13, 0U, 1ф 16A, 24×C13', phases: 1, rating: 16, height: 0, outlets: [{ type:'C13', count:24 }] },
  { sku: 'PV-32A-18C13-6C19', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток PV-32A-18C13-6C19, 0U, 1ф 32A, 18×C13 + 6×C19', phases: 1, rating: 32, height: 0, outlets: [{ type:'C13', count:18 }, { type:'C19', count:6 }] },
  { sku: 'PV-32A-24C13-6C19', mfg: 'ЦМО', category: 'basic', name: 'ЦМО Блок розеток PV-32A-24C13-6C19, 0U, 3ф 32A, 24×C13 + 6×C19', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // ЦМО — Managed / Metered (серия R-MS/R-MM)
  { sku: 'R-MM-16-8S', mfg: 'ЦМО', category: 'metered', name: 'ЦМО PDU R-MM-16-8S, 1U, 1ф 16A, 8×Schuko, мониторинг', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'R-MM-16-9C13', mfg: 'ЦМО', category: 'metered', name: 'ЦМО PDU R-MM-16-9C13, 1U, 1ф 16A, 9×C13, мониторинг', phases: 1, rating: 16, height: 1, outlets: [{ type:'C13', count:9 }] },
  { sku: 'R-MS-16-8S', mfg: 'ЦМО', category: 'switched', name: 'ЦМО PDU R-MS-16-8S, 1U, 1ф 16A, 8×Schuko, управление коммутацией', phases: 1, rating: 16, height: 1, outlets: [{ type:'Schuko', count:8 }] },
  { sku: 'PV-MM-32A-24C13-6C19', mfg: 'ЦМО', category: 'metered', name: 'ЦМО PDU PV-MM-32A-24C13-6C19, 0U, 3ф 32A, 24×C13 + 6×C19, мониторинг на вводе', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'PV-MS-32A-24C13-6C19', mfg: 'ЦМО', category: 'switched', name: 'ЦМО PDU PV-MS-32A-24C13-6C19, 0U, 3ф 32A, 24×C13 + 6×C19, switched', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'PV-MB-32A-24C13-6C19', mfg: 'ЦМО', category: 'monitored', name: 'ЦМО PDU PV-MB-32A-24C13-6C19, 0U, 3ф 32A, 24×C13 + 6×C19, мониторинг по розеткам', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'PV-MH-32A-24C13-6C19', mfg: 'ЦМО', category: 'hybrid', name: 'ЦМО PDU PV-MH-32A-24C13-6C19, 0U, 3ф 32A, 24×C13 + 6×C19, мониторинг+управление', phases: 3, rating: 32, height: 0, outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  // Raritan / Minkels
  { sku: 'PX2-1464',     mfg: 'Raritan/Minkels', category: 'basic',
    name: 'Raritan PX2 basic, 1U, 1ф 16A, 8×C13 + 4×Schuko',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }, { type:'Schuko', count:4 }] },
  { sku: 'PX3-5190',     mfg: 'Raritan/Minkels', category: 'metered',
    name: 'Raritan PX3 iPDU metered, ZeroU, 3ф 16A, 30×C13',
    phases: 3, rating: 16, height: 0,
    outlets: [{ type:'C13', count:30 }] },
  { sku: 'PX3-1491R',    mfg: 'Raritan/Minkels', category: 'monitored',
    name: 'Raritan PX3 iPDU metered-by-outlet, ZeroU, 1ф 32A, 20×C13 + 4×C19',
    phases: 1, rating: 32, height: 0,
    outlets: [{ type:'C13', count:20 }, { type:'C19', count:4 }] },
  { sku: 'PX3-5493V',    mfg: 'Raritan/Minkels', category: 'hybrid',
    name: 'Raritan PX3 iPDU metered+switched, ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
  // Kehua
  { sku: 'KPDU-B1F16-08C13', mfg: 'Kehua', category: 'basic',
    name: 'Kehua PDU basic, 1U, 1ф 16A, 8×C13',
    phases: 1, rating: 16, height: 1,
    outlets: [{ type:'C13', count:8 }] },
  { sku: 'KPDU-M3F32-24C13-06C19', mfg: 'Kehua', category: 'metered',
    name: 'Kehua PDU metered, ZeroU, 3ф 32A, 24×C13 + 6×C19, LED-дисплей',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'KPDU-S3F32-24C13-06C19', mfg: 'Kehua', category: 'switched',
    name: 'Kehua PDU switched, ZeroU, 3ф 32A, 24×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:24 }, { type:'C19', count:6 }] },
  { sku: 'KPDU-H3F32-36C13-06C19', mfg: 'Kehua', category: 'hybrid',
    name: 'Kehua PDU hybrid (метеринг+упр.), ZeroU, 3ф 32A, 36×C13 + 6×C19',
    phases: 3, rating: 32, height: 0,
    outlets: [{ type:'C13', count:36 }, { type:'C19', count:6 }] },
];

export function pduBySku(sku) { return getLivePduCatalog().find(p => p.sku === sku) || null; }

/* ---------- маппинг в element-library ---------- */
export function listBuiltinPdus() {
  return PDU_CATALOG.map(p => ({
    id: 'pdu.' + _slug(p.sku),
    kind: 'pdu',
    category: 'equipment',
    label: p.name,
    description: `${PDU_CATEGORY[p.category] || p.category} · ${p.phases}-фаза · ${p.rating} A`,
    manufacturer: p.mfg,
    series: '',
    variant: p.sku,
    electrical: {
      voltageCategory: 'lv',
      phases: p.phases,
      capacityA: p.rating,
    },
    kindProps: {
      sku: p.sku,
      category: p.category,
      categoryLabel: PDU_CATEGORY[p.category] || p.category,
      phases: p.phases,
      rating: p.rating,
      height: p.height,
      outlets: p.outlets,
    },
    tags: [p.mfg, p.category].filter(Boolean),
    source: 'builtin', builtin: true,
  }));
}

export function getLivePduCatalog() {
  const live = _syncList('pdu');
  if (!live.length) return PDU_CATALOG;
  return live.map(el => {
    const kp = el.kindProps || {};
    const outlets = Array.isArray(kp.outlets) ? kp.outlets.map(o => ({
      type: o.type,
      count: Number(o.count ?? o.qty ?? 0),
    })) : [];
    return {
      sku:    kp.sku || el.variant || el.id,
      mfg:    el.manufacturer || '',
      category: kp.category || 'basic',
      name:   el.label || '',
      phases: Number(kp.phases || el.electrical?.phases || 1),
      rating: Number(kp.rating || el.electrical?.capacityA || 16),
      height: Number(kp.height || 0),
      outlets,
    };
  });
}
