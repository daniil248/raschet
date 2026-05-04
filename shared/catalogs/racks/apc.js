// =============================================================================
// shared/catalogs/racks/apc.js — APC NetShelter SX
// =============================================================================
// v0.60.217 (split из shared/catalogs/racks.js по правилу
// feedback_use_catalogs.md «для каждого типа оборудования или элемента
// сделаем отдельную подпапку, а внутри уже по производителям будут файлы»).

export const APC_RACK_KITS = [
  { id: 'apc-ar3100', sku: 'AR3100',
    name: 'APC NetShelter SX 42U 600×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'APC', series: 'NetShelter SX', u: 42, width: 600, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet', comboTopBase: true } },
  { id: 'apc-ar3150', sku: 'AR3150',
    name: 'APC NetShelter SX 42U 750×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase','cableEntryTop'],
    preset: { manufacturer: 'APC', series: 'NetShelter SX', u: 42, width: 800, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
      sides: 'pair-sku', top: 'vent', base: 'feet', comboTopBase: true } },
];
