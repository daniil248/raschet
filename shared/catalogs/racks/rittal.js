// =============================================================================
// shared/catalogs/racks/rittal.js — Rittal TS IT
// =============================================================================
// v0.60.217 (split).

export const RITTAL_RACK_KITS = [
  { id: 'rittal-ts-it-42', sku: 'TS IT 5528.110',
    name: 'Rittal TS IT 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'Rittal', series: 'TS IT', u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-split', top: 'vent', base: 'feet', comboTopBase: true } },
];
