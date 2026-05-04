// =============================================================================
// shared/catalogs/pdus/raritan.js — Raritan / Minkels PX
// =============================================================================
// v0.60.217 (split). PX2 / PX3 iPDU.

export const RARITAN_PDUS = [
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
];
