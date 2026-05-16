// =============================================================================
// shared/catalogs/ups-accessories.js — КАТАЛОГ принадлежностей ИБП
// =============================================================================
// v0.60.489. По правилу проекта «справочные данные — в каталоге, не в коде
// подпрограммы»: классы/правила/комплектность принадлежностей ИБП вынесены
// сюда (seed, per-user расширяемо позже из catalog/). Сборщик —
// shared/ups-types/accessories.js (buildUpsAccessories) только применяет
// правила и формирует строки состава.
//
// Запись: {
//   id, sku?, cls, kitInclusion: 'included'|'separate',
//   label(ctx)  -> string  — наименование строки состава,
//   qty(ctx)    -> number  — количество (по конфигурации),
//   applies(ctx)-> bool    — включать ли позицию для данной конфигурации
// }
// ctx = { u, fi, kw, phases, frames }  (см. accessories.js)
//
// cls: 'cable' | 'lug' | 'comm' | 'parallel' | 'service' | 'consumable'
// =============================================================================

export const UPS_ACCESSORY_CATALOG = [
  {
    id: 'cable-power', sku: 'CBL-PWR', cls: 'cable', kitInclusion: 'separate',
    applies: () => true,
    qty: () => 1,
    label: (c) => `Силовые кабели вход/выход (${c.phases}ph, ≈${c.kw} кВт) — комплект`,
  },
  {
    id: 'lug-set', sku: 'LUG-SET', cls: 'lug', kitInclusion: 'separate',
    applies: () => true,
    qty: (c) => (c.phases + 1) * 2,            // (фазы+PE) × (ввод+вывод)
    label: (c) => `Кабельные наконечники (вход+выход, ${c.phases}ph + PE)`,
  },
  {
    id: 'comm-snmp', sku: 'COMM-SNMP', cls: 'comm', kitInclusion: 'separate',
    applies: () => true,
    qty: () => 1,
    label: () => 'Модуль связи: карта SNMP/Modbus (мониторинг)',
  },
  {
    id: 'comm-dry', sku: 'COMM-DRY', cls: 'comm', kitInclusion: 'included',
    applies: () => true,
    qty: () => 1,
    label: () => 'Сухие контакты (релейные сигналы) — штатно',
  },
  {
    id: 'parallel-kit', sku: 'PAR-KIT', cls: 'parallel', kitInclusion: 'separate',
    applies: (c) => c.frames > 1,
    qty: () => 1,
    label: (c) => `Комплект параллельной работы (${c.frames} ИБП/фрейма): синхро-кабели/шины`,
  },
  {
    id: 'commissioning', sku: 'SRV-PNR', cls: 'service', kitInclusion: 'separate',
    applies: () => true,
    qty: () => 1,
    label: () => 'Пусконаладочные работы (ПНР) ИБП',
  },
  {
    id: 'spares', sku: 'SPARE-KIT', cls: 'consumable', kitInclusion: 'separate',
    applies: () => true,
    qty: () => 1,
    label: () => 'ЗИП-комплект / расходники (рекомендуется)',
  },
];

/** Пресеты комплектности по классу (быстрый доступ; источник — записи). */
export const UPS_ACCESSORY_KIT = UPS_ACCESSORY_CATALOG.reduce((m, a) => {
  if (!(a.cls in m)) m[a.cls] = a.kitInclusion;
  return m;
}, {});
