// =============================================================================
// shared/catalogs/drups/index.js — агрегатор каталога DRUPS
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md «подпапка-per-type,
// файл-per-vendor»). Split из shared/catalogs/drups.js.
//
// DRUPS = Diesel Rotary Uninterruptible Power Supply.
// Принцип: маховик (kinetic energy storage) + дизельный двигатель + синхронная
// машина (мотор-генератор) на одном валу. При сбое сети маховик питает
// нагрузку 5-15 секунд, за это время запускается дизель и принимает нагрузку.
//
// Преимущества:
//   - Нет батарей (никаких химических расходников)
//   - Bypass через статор синхронной машины — практически бесперебойно
//   - Высокий КПД (96-97% против 94-96% UPS+DGU)
//   - Срок службы 25-30 лет
//   - PUE до 1.1-1.2
// =============================================================================

import { HITEC_DRUPS }       from './hitec.js';
import { PILLER_DRUPS }      from './piller.js';
import { EURO_DIESEL_DRUPS } from './euro-diesel.js';

export const DRUPS_DATASHEETS = [
  ...HITEC_DRUPS,
  ...PILLER_DRUPS,
  ...EURO_DIESEL_DRUPS,
];

export function listDrups(filter = {}) {
  let arr = DRUPS_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  if (filter.minKva) arr = arr.filter(d => d.nameplateKva >= filter.minKva);
  if (filter.maxKva) arr = arr.filter(d => d.nameplateKva <= filter.maxKva);
  return arr;
}

export function listDrupsVendors() {
  return [...new Set(DRUPS_DATASHEETS.map(d => d.vendor))];
}

/**
 * Подобрать ближайшую DRUPS ≥ requiredKva.
 */
export function suggestDrups(requiredKva, filter = {}) {
  let arr = DRUPS_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  arr.sort((a, b) => a.nameplateKva - b.nameplateKva);
  return arr.find(d => d.nameplateKva >= requiredKva) || arr[arr.length - 1] || null;
}
