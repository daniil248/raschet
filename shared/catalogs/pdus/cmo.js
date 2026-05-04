// =============================================================================
// shared/catalogs/pdus/cmo.js — ЦМО блоки розеток
// =============================================================================
// v0.60.217 (split). 19" 1U + PV (вертикальные 0U) + Managed/Metered (R-MS/R-MM).

export const CMO_PDUS = [
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
];
