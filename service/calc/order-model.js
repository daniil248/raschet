// =============================================================================
// service/calc/order-model.js — модель «наряда» сервисных/монтажных работ
// =============================================================================
// Phase 24.1: По требованию Пользователя 2026-05-02:
// «Расчёт стоимости технического обслуживания и стоимости монтажных работ,
//  где инженер сервиса сможет формировать стоимость себеса и стоимости для
//  клиента по монтажным и сервисным работам по проекту или разовые работы».
//
// Pure JS, no DOM. Используется в service/ui/order-form.js и других модулях,
// которые могут предложить выгрузку наряда (например, cooling → service).
//
// Модель НАРЯДА:
//   order = {
//     id, name,                       // например «Монтаж чиллера York YLAA200»
//     type: 'install' | 'maintenance' | 'one-off',
//     projectId: string|null,         // null — разовые работы
//     coolingSelectionId: string|null,// если связан с подбором cooling
//     date,                           // дата создания
//     customer: { name, contact },    // клиент
//     positions: [
//       {
//         id, label,                   // описание работы/материала
//         category: 'labor' | 'material' | 'travel' | 'subcontract' | 'other',
//         qty, unit,                   // 5 шт / 12 ч / 30 м / ...
//         costPrice:   {value, currency},  // себестоимость / единица
//         clientPrice: {value, currency},  // клиент-цена / единица
//       }, ...
//     ],
//     overheadPct,                     // накладные расходы (% от себеса)
//     vatPct,                          // НДС (% от клиент-цены)
//     notes,                           // примечания
//   }
//
// Расчёт:
//   Σ Себес     = Σ qty × costPrice (с per-cell currency-конверсией)
//   Σ Накладные = Σ Себес × overheadPct/100
//   Σ Клиент    = Σ qty × clientPrice (с per-cell currency-конверсией)
//   Σ НДС       = Σ Клиент × vatPct/100
//   Маржа₽     = Σ Клиент − (Σ Себес + Σ Накладные)
//   Маржа%     = Маржа / (Σ Себес + Σ Накладные) × 100

import { CURRENCIES } from '../../cooling/calc/fc-summary.js';

export const ORDER_TYPES = [
  { id: 'install',     label: 'Монтаж',           desc: 'Монтажные работы (установка, обвязка, ПНР).' },
  { id: 'maintenance', label: 'ТО (регламент)',   desc: 'Плановое техобслуживание (квартал/год).' },
  { id: 'one-off',     label: 'Разовая работа',   desc: 'Внеплановая работа (выезд, диагностика, ремонт).' },
];

export const POSITION_CATEGORIES = [
  { id: 'labor',       label: 'Работа',         tip: 'Трудозатраты сервисной бригады. Единица обычно «час».' },
  { id: 'material',    label: 'Материал',       tip: 'Расходные материалы, запчасти, хладагент, фитинги.' },
  { id: 'travel',      label: 'Командировочные',tip: 'Билеты + проживание + суточные + транспорт.' },
  { id: 'subcontract', label: 'Субподряд',      tip: 'Стороннее лицо (грузчики, кран, спец.техника).' },
  { id: 'other',       label: 'Прочее',         tip: 'Прочие статьи затрат.' },
];

export const UNITS = ['ч', 'шт', 'м', 'м²', 'м³', 'кг', 'комплект', 'выезд', 'смена', 'сутки'];

/** Default-параметры нового наряда. */
export const DEFAULT_ORDER = {
  id: '',
  number: '',                    // v0.60.48: учётный номер (КП-2026-0042) — для учётной системы
  name: '',                      // короткое название/описание
  type: 'install',
  projectId: null,
  coolingSelectionId: null,
  date: new Date().toISOString().slice(0, 10),
  customer: { name: '', contact: '' },
  positions: [],
  overheadPct: 15,
  vatPct: 16,           // v0.60.112: KZ-2026 default. Override per-order или
                        //            из project.economics.vat (см. service.js
                        //            buildOrderDefaultsFromProject).
  vatEnabled: true,     // v0.60.112: false = «без НДС» (для экспортных КП).
                        //            В КП row «НДС» скрывается, итог = чистая
                        //            клиент-цена. Управляется в свойствах
                        //            проекта (📊 НДС / налогообложение) или
                        //            override per-order.
  vatLabel: 'НДС',      // v0.60.112: лейбл налога — НДС / VAT / другое.
  notes: '',
};

/* v0.60.48 (Phase 32.1): паттерны учётных номеров по типам нарядов.
   Поддерживаемые токены:
     {year}    — текущий год (2026)
     {YY}      — 2-значный год (26)
     {month}   — месяц (01-12)
     {quarter} — квартал (Q1-Q4)
     {counter} — auto-инкремент (per-project, per-type)
     {counter:0000} — counter с zero-padding до 4 знаков
*/
export const DEFAULT_NUMBER_PATTERNS = {
  'install':     'КП-{year}-{counter:0000}',
  'maintenance': 'ТО-{year}-{counter:0000}',
  'one-off':     'ЗН-{year}-{counter:0000}',
};

/**
 * Сгенерировать учётный номер по pattern и текущему counter.
 * Pure function (testable).
 *
 * @param {string} pattern — например «КП-{year}-{counter:0000}»
 * @param {number} counter — следующий номер (1, 2, 3...)
 * @param {Date} [date] — для year/month/quarter (default = now)
 * @returns {string}
 */
export function formatOrderNumber(pattern, counter, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const q = 'Q' + (Math.floor(date.getMonth() / 3) + 1);
  return String(pattern || '')
    .replace(/\{year\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2))
    .replace(/\{month\}/g, m)
    .replace(/\{quarter\}/g, q)
    .replace(/\{counter:(\d+)\}/g, (_, pad) => String(counter).padStart(Number(pad), '0'))
    .replace(/\{counter\}/g, String(counter));
}

/** v0.60.48 (по требованию: «валюту по умолчанию для оборудования поставь USD,
   а для работ и сервиса тенге»): дефолтная валюта зависит от категории. */
export const DEFAULT_CURRENCY_BY_CATEGORY = {
  'material':    '$',   // Оборудование/материалы — обычно импорт, USD
  'labor':       '₸',   // Работа — местные тенге
  'travel':      '₸',   // Командировочные — местные
  'subcontract': '₸',   // Субподряд — местные
  'other':      '₸',
};

/** Default-позиция. displayCurrency используется как fallback если категория
 *  не задана; иначе берётся из DEFAULT_CURRENCY_BY_CATEGORY. */
export function defaultPosition(displayCurrency = '₸', category = 'labor') {
  const cur = DEFAULT_CURRENCY_BY_CATEGORY[category] || displayCurrency;
  return {
    id: 'pos-' + Math.random().toString(36).slice(2, 8),
    label: '',
    category,
    qty: 1,
    unit: 'ч',
    costPrice:   { value: 0, currency: cur },
    clientPrice: { value: 0, currency: cur },
    // v0.60.45 (feedback_service_imports.md): источник позиции для дедупа
    // повторных импортов и визуального маркера. null/undefined = пользовательская.
    sourceModule: null,    // 'cooling' | 'ups-config' | 'mdc-config' | 'genset-config' | ...
    sourceRef: null,       // {selectionId, optionId, equipmentGroupId, ...} — module-specific
  };
}

/** Иконки источников для визуального маркера в таблице позиций. */
export const SOURCE_MODULE_ICONS = {
  'cooling':            '❄',
  'ups-config':         '🔋',
  'mdc-config':         '🏗',
  'genset-config':      '⚡',
  'dgu-config':         '⚡',
  'panel-config':       '⚙',
  'transformer-config': '🔌',
  'scs-config':         '🌐',
};

/** Человекочитаемое название модуля-источника. */
export const SOURCE_MODULE_LABELS = {
  'cooling':            'Подбор холодильных систем',
  'ups-config':         'Конфигурация ИБП',
  'mdc-config':         'Модульный ЦОД',
  'genset-config':      'Дизель-генератор',
  'dgu-config':         'Дизель-генератор',
  'panel-config':       'Конфигурация щита',
  'transformer-config': 'Конфигурация трансформатора',
  'scs-config':         'Структурированная кабельная система',
};

/**
 * Подсчитать суммы наряда в displayCurrency с per-cell конвертацией.
 *
 * @param {object} order
 * @param {string} displayCurrency
 * @param {function|null} convertFn — (amount, fromCur, toCur) => number
 * @returns {{
 *   sumCostNative, sumOverhead, sumCostWithOverhead,
 *   sumClientNative, sumVat, sumClientWithVat,
 *   marginAbs, marginPct, byCategory: {labor, material, travel, subcontract, other}
 * }}
 */
export function computeOrderTotals(order, displayCurrency = '₽', convertFn = null) {
  const o = { ...DEFAULT_ORDER, ...(order || {}) };
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const conv = (v, from, to) => {
    if (!Number.isFinite(v) || v === 0 || from === to || !convertFn) return v;
    const r = convertFn(v, from, to);
    return Number.isFinite(r) ? r : v;
  };
  let sumCost = 0, sumClient = 0;
  const byCategory = { labor: 0, material: 0, travel: 0, subcontract: 0, other: 0 };
  for (const p of positions) {
    const q = Number(p.qty) || 0;
    const c = conv(Number(p.costPrice?.value)   || 0, p.costPrice?.currency   || displayCurrency, displayCurrency);
    const cl = conv(Number(p.clientPrice?.value) || 0, p.clientPrice?.currency || displayCurrency, displayCurrency);
    sumCost   += q * c;
    sumClient += q * cl;
    if (byCategory[p.category] != null) byCategory[p.category] += q * c;
    else byCategory.other += q * c;
  }
  const overheadPct = Number(o.overheadPct) || 0;
  // v0.60.112: vatEnabled — false для экспортных КП («без НДС»).
  // Если выключен — sumVat = 0, sumClientWithVat = sumClient (чистая клиент-
  // цена, как просит Пользователь: «для КП за рубеж мы должны давать
  // стоимость без НДС»). Default true (backward-compat для старых нарядов
  // без поля vatEnabled).
  const vatEnabled = (o.vatEnabled !== false);
  const vatPct = vatEnabled ? (Number(o.vatPct) || 0) : 0;
  const sumOverhead = sumCost * overheadPct / 100;
  const sumCostWithOverhead = sumCost + sumOverhead;
  const sumVat = sumClient * vatPct / 100;
  const sumClientWithVat = sumClient + sumVat;
  const marginAbs = sumClient - sumCostWithOverhead;
  const marginPct = sumCostWithOverhead > 0 ? (marginAbs / sumCostWithOverhead) * 100 : 0;
  return {
    sumCostNative: sumCost,
    sumOverhead, sumCostWithOverhead,
    sumClientNative: sumClient, sumVat, sumClientWithVat,
    marginAbs, marginPct,
    byCategory,
  };
}

/**
 * @deprecated v0.60.36 — WORK_TEMPLATES вынесен в каталог
 * service/catalog/work-templates.js (правило feedback_use_catalogs.md).
 * Этот re-export оставлен для backward-compat; новый код должен использовать
 * <code>import { listTemplates } from '../catalog/work-templates.js'</code>.
 */
export { SEED_TEMPLATES as WORK_TEMPLATES } from '../catalog/work-templates.js';

export { CURRENCIES };
