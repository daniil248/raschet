// =============================================================================
// shared/catalogs/racks/cmo.js — ЦМО ШТК-М
// =============================================================================
// v0.60.217 (split).

export const CMO_RACK_KITS = [
  { id: 'cmo-shtk-m-42', sku: 'ШТК-М-42.6.10-44АА',
    name: 'ЦМО ШТК-М 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: { manufacturer: 'ЦМО', series: 'ШТК-М', u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
];
