// =============================================================================
// shared/catalogs/racks/hyperline.js — Hyperline TWB (настенные)
// =============================================================================
// v0.60.217 (split).

export const HYPERLINE_RACK_KITS = [
  { id: 'hyperline-twb-24', sku: 'TWB-2466-SR-RAL9004',
    name: 'Hyperline TWB 24U 600×600 (настенный)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: { manufacturer: 'Hyperline', series: 'TWB', u: 24, width: 600, depth: 600,
      doorFront: 'glass', doorRear: 'none', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet' } },
];
