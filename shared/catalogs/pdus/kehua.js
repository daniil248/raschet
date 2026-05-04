// =============================================================================
// shared/catalogs/pdus/kehua.js — Kehua KPDU
// =============================================================================
// v0.60.217 (split). KPDU-B/M/S/H для basic/metered/switched/hybrid.

export const KEHUA_PDUS = [
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
