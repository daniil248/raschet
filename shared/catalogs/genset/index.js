// =============================================================================
// shared/catalogs/genset/index.js — агрегатор каталога ДГУ
// =============================================================================
// Phase 30.3: типовые модели Caterpillar / Cummins / Volvo Penta / FG Wilson /
// MTU / AKSA / AJ Power. Параметры — из открытых datasheet производителей.
//
// Pure JS, no DOM.
//
// v0.60.214 (по репорту Пользователя 2026-05-04 «давай не будем сваливать в
// одну папку, а для каждого типа оборудования или элемента сделаем отдельную
// подпапку, а в внутри уже по производителям будут файлы»):
// каталог разделён на per-vendor файлы в этой подпапке. Этот index.js —
// агрегатор + утилитарные функции.
//
// Каждая запись каталога:
//   { vendor, model, nameplateKw, espKw, prpKw, copKw, voltage, phase,
//     rpm, engineModel, cylinders, displacement, fuelType, sfcLkWh,
//     dimensions, weightKg, refrigerant, notes }
//
// espKw / prpKw / copKw — мощности по режимам (ISO 8528-1).
// sfcLkWh — specific fuel consumption при 75% нагрузки (ISO 3046-1).
// =============================================================================

import { CATERPILLAR_DGUS } from './caterpillar.js';
import { CUMMINS_DGUS }     from './cummins.js';
import { VOLVO_PENTA_DGUS } from './volvo-penta.js';
import { FG_WILSON_DGUS }   from './fg-wilson.js';
import { MTU_DGUS }         from './mtu.js';
import { AKSA_DGUS }        from './aksa.js';
import { AJ_POWER_DGUS }    from './aj-power.js';

export const DGU_DATASHEETS = [
  ...CATERPILLAR_DGUS,
  ...CUMMINS_DGUS,
  ...VOLVO_PENTA_DGUS,
  ...FG_WILSON_DGUS,
  ...MTU_DGUS,
  ...AKSA_DGUS,
  ...AJ_POWER_DGUS,
];

/**
 * Получить ДГУ-датшиты по фильтру.
 * @param {object} [filter] — { vendor?, minKw?, maxKw? }
 */
export function listDgus(filter = {}) {
  let arr = DGU_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  if (filter.minKw)  arr = arr.filter(d => d.nameplateKw >= filter.minKw);
  if (filter.maxKw)  arr = arr.filter(d => d.nameplateKw <= filter.maxKw);
  return arr;
}

/** Список уникальных производителей. */
export function listDguVendors() {
  return [...new Set(DGU_DATASHEETS.map(d => d.vendor))];
}

/**
 * Подбор: первая модель с espKw ≥ minKw, при равном — меньшее по нагрузке (наиболее компактная).
 * @param {number} minKw — минимально требуемая ESP-мощность.
 * @param {string} [vendor] — ограничить вендором.
 */
export function suggestDgu(minKw, vendor = null) {
  let arr = DGU_DATASHEETS.filter(d => d.espKw >= minKw);
  if (vendor) arr = arr.filter(d => d.vendor === vendor);
  if (!arr.length) return null;
  arr.sort((a, b) => a.espKw - b.espKw);
  return arr[0];
}
