// =============================================================================
// shared/catalogs/pdus/apc.js — APC Rack PDU
// =============================================================================
// v0.60.217 (split). 1U / ZeroU, basic / metered / switched / monitored / hybrid.

export const APC_PDUS = [
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
];
