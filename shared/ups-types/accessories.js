// =============================================================================
// shared/ups-types/accessories.js — авто-сборка ПРИНАДЛЕЖНОСТЕЙ ИБП
// =============================================================================
// v0.60.487/489. По замечанию Пользователя: конфигуратор должен добавлять
// принадлежности (кабели, наконечники, модули связи, parallel-kit, ПНР,
// ЗИП), а не только модель. Pure (без DOM). Вызывается из
// buildComposition() каждого типа ИБП — после [frame/модули] добавляются
// accessory-строки по правилам каталога.
//
// v0.60.489: справочные данные/правила вынесены в КАТАЛОГ
// shared/catalogs/ups-accessories.js (правило «справочники — в каталоге»);
// здесь только применение правил и формирование строк состава.
//
// Каждая строка: { role:'accessory', cls, qty, label, kitInclusion }
//   kitInclusion: 'included' (в комплекте производителя, в цене системы)
//               | 'separate' (заказывается/оплачивается отдельно)
// =============================================================================

import { UPS_ACCESSORY_CATALOG, UPS_ACCESSORY_KIT } from '../catalogs/ups-accessories.js';

export { UPS_ACCESSORY_KIT };

/**
 * Сформировать строки принадлежностей по конфигурации ИБП — по правилам
 * каталога UPS_ACCESSORY_CATALOG.
 * @param {object} u  — запись ИБП (capacityKw, frameKw, vdcMin/Max…)
 * @param {object} fi — fitInfo (realCapacity/usable, installed, parallelFrames…)
 * @param {object} [opts] — { phases }
 * @returns {Array<object>}
 */
export function buildUpsAccessories(u, fi, opts = {}) {
  u = u || {}; fi = fi || {};
  const ctx = {
    u, fi,
    kw: Math.round(Number(fi.realCapacity || fi.usable || u.capacityKw || 0)) || 0,
    phases: Number(opts.phases) || 3,
    frames: Math.max(1, Number(fi.parallelFrames || fi.unitCount || fi.installed || 1) || 1),
  };
  const out = [];
  for (const a of UPS_ACCESSORY_CATALOG) {
    try {
      if (typeof a.applies === 'function' && !a.applies(ctx)) continue;
      out.push({
        role: 'accessory',
        cls: a.cls,
        accId: a.id,
        sku: a.sku || null,
        qty: Math.max(1, Number(typeof a.qty === 'function' ? a.qty(ctx) : (a.qty || 1)) || 1),
        kitInclusion: a.kitInclusion || 'separate',
        label: typeof a.label === 'function' ? a.label(ctx) : (a.label || a.id),
      });
    } catch { /* пропускаем сбойную позицию каталога */ }
  }
  return out;
}
