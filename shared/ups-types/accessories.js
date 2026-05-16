// =============================================================================
// shared/ups-types/accessories.js — авто-сборка ПРИНАДЛЕЖНОСТЕЙ ИБП
// =============================================================================
// v0.60.487 (по замечанию Пользователя: «конфигуратор не делает ничего
// кроме выбора из списка, нужно добавить принадлежности — кабели,
// наконечники, модули связи, parallel-kit, сервис/ПНР»).
//
// Pure (без DOM). Вызывается из buildComposition() каждого типа ИБП —
// после [frame/модули] добавляются accessory-строки по автоправилам.
// Пользователь может править состав построчно (как в АКБ-ЖЦ).
//
// Каждая строка: { role:'accessory', cls, qty, label, kitInclusion }
//   cls: 'cable' | 'lug' | 'comm' | 'parallel' | 'service' | 'consumable'
//   kitInclusion: 'included' (в комплекте производителя, в цене системы)
//                 | 'separate' (заказывается/оплачивается отдельно)
// =============================================================================

// Пресеты комплектности по классу (аналог DEFAULT_KIT_INCLUSION у S³).
export const UPS_ACCESSORY_KIT = {
  cable:      'separate',   // силовые кабели — отдельно (по месту)
  lug:        'separate',   // наконечники — отдельно
  comm:       'separate',   // карта SNMP/Modbus — отдельная позиция
  'comm-std': 'included',   // сухие контакты — штатно в комплекте
  parallel:   'separate',   // комплект параллельной работы — отдельно
  service:    'separate',   // ПНР — отдельная услуга
  consumable: 'separate',   // ЗИП/расходники — отдельно
};

/**
 * Сформировать строки принадлежностей по конфигурации ИБП.
 * @param {object} u  — запись ИБП (capacityKw, frameKw, vdcMin/Max…)
 * @param {object} fi — fitInfo (realCapacity/usable, installed, parallelFrames…)
 * @param {object} [opts] — { phases, redundancyScheme }
 * @returns {Array<object>}
 */
export function buildUpsAccessories(u, fi, opts = {}) {
  u = u || {}; fi = fi || {};
  const kw = Math.round(Number(fi.realCapacity || fi.usable || u.capacityKw || 0)) || 0;
  const phases = Number(opts.phases) || 3;
  const frames = Math.max(1, Number(fi.parallelFrames || fi.unitCount || fi.installed || 1) || 1);
  const out = [];

  // 1) Кабели + наконечники (вход / выход; bypass для on-line). Кол-во
  //    наконечников = (фазы + N) на ввод и вывод + PE. Справочный комплект.
  const lugsPerSide = phases + 1;            // фазы + нейтраль/PE
  out.push({
    role: 'accessory', cls: 'cable', qty: 1, kitInclusion: UPS_ACCESSORY_KIT.cable,
    label: `Силовые кабели вход/выход (${phases}ph, ≈${kw} кВт) — комплект`,
  });
  out.push({
    role: 'accessory', cls: 'lug', qty: lugsPerSide * 2, kitInclusion: UPS_ACCESSORY_KIT.lug,
    label: `Кабельные наконечники (вход+выход, ${phases}ph + PE)`,
  });

  // 2) Модули связи: карта мониторинга SNMP/Modbus (заказная) + штатные
  //    сухие контакты (в комплекте). Датчик температуры — опц. позиция.
  out.push({
    role: 'accessory', cls: 'comm', qty: 1, kitInclusion: UPS_ACCESSORY_KIT.comm,
    label: 'Модуль связи: карта SNMP/Modbus (мониторинг)',
  });
  out.push({
    role: 'accessory', cls: 'comm', qty: 1, kitInclusion: UPS_ACCESSORY_KIT['comm-std'],
    label: 'Сухие контакты (релейные сигналы) — штатно',
  });

  // 3) Parallel-kit / шины параллели — при >1 ИБП/фрейма в параллель.
  if (frames > 1) {
    out.push({
      role: 'accessory', cls: 'parallel', qty: 1, kitInclusion: UPS_ACCESSORY_KIT.parallel,
      label: `Комплект параллельной работы (${frames} ИБП/фрейма): синхро-кабели/шины`,
    });
  }

  // 4) Сервис/ПНР + расходники.
  out.push({
    role: 'accessory', cls: 'service', qty: 1, kitInclusion: UPS_ACCESSORY_KIT.service,
    label: 'Пусконаладочные работы (ПНР) ИБП',
  });
  out.push({
    role: 'accessory', cls: 'consumable', qty: 1, kitInclusion: UPS_ACCESSORY_KIT.consumable,
    label: 'ЗИП-комплект / расходники (рекомендуется)',
  });

  return out;
}
