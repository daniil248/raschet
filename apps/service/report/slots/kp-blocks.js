// =============================================================================
// shared/report/slots/kp-blocks.js — slot-builders для шаблона КП
// =============================================================================
// Phase 29.3: Каждая функция здесь принимает (ctx, options) и возвращает
// blocks[] (для shared/report/blocks). Slot-renderer (kp-template-renderer.js)
// вызывает их в порядке template.slots, собирая итоговый content.
//
// ctx = {
//   order, displayCurrency, convertFn, company, totals,
//   B,           // shared/report/blocks как параметр (избегаем циклических импортов)
//   POSITION_CATEGORIES, ORDER_TYPES,  // из service/calc/order-model.js
//   fmtMoney,    // утилита форматирования
// }
//
// options = per-slot настройки, прокинутые из template.slots[i].options.
//
// Pure JS, no DOM.

/* ---------- Helpers ---------- */

function conv(value, fromCur, toCur, convertFn) {
  if (!Number.isFinite(value) || value === 0 || fromCur === toCur || !convertFn) return value;
  const r = convertFn(value, fromCur, toCur);
  return Number.isFinite(r) ? r : value;
}

/* v0.60.44: fmtMoney из cooling даёт сокращения «60 тыс ₽» — для КП клиенту
   нужны полные суммы с разделителями и валютой. По репорту: «нужно нормально
   выводить суммы, с нулями в выбранной валюте». */
function fmtKpMoney(v, currency) {
  if (!Number.isFinite(v)) return '—';
  // Дробная часть только если есть копейки
  const hasFraction = Math.abs(v - Math.round(v)) > 0.005;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(v) + ' ' + (currency || '');
}

/* ---------- Slot builders ---------- */

export function companyHeader(ctx, options = {}) {
  const { B, company } = ctx;
  if (!company.name) {
    return [B.paragraph('⚠ Реквизиты компании не заполнены — заполните в шестерёнке (⚙) → «🏢 Реквизиты организации».')];
  }
  const blocks = [];
  blocks.push(B.h3(company.name));
  if (company.address) blocks.push(B.caption(company.address));
  if (options.showContacts !== false) {
    const line = [company.phone, company.email, company.website].filter(Boolean).join(' · ');
    if (line) blocks.push(B.caption(line));
  }
  if (options.showBin !== false && company.bin) {
    blocks.push(B.caption(`БИН/ИНН: ${company.bin}`));
  }
  blocks.push(B.spacer(4));
  return blocks;
}

export function docTitle(ctx) {
  const { B } = ctx;
  return [B.h1('Коммерческое предложение')];
}

export function docMeta(ctx) {
  const { B, order } = ctx;
  const date = order.date || new Date().toISOString().slice(0, 10);
  // v0.60.48: предпочитаем учётный номер (order.number) над internal id.
  const orderNum = order.number || order.id || 'без №';
  return [
    B.h2(`№ ${orderNum} от ${date} · «${order.name || '(без названия)'}»`),
    B.spacer(2),
  ];
}

export function customerInfo(ctx, options = {}) {
  const { B, order, displayCurrency, ORDER_TYPES } = ctx;
  const typeLabel = ORDER_TYPES.find(x => x.id === order.type)?.label || order.type;
  const rows = [['Тип работ:', typeLabel]];
  if (order.customer?.name)    rows.push(['Заказчик:', order.customer.name]);
  if (order.customer?.contact) rows.push(['Контакт:',  order.customer.contact]);
  if (options.showCurrency !== false) rows.push(['Валюта:', displayCurrency]);
  return [B.table(['', ''], rows), B.spacer(4)];
}

export function positionsTable(ctx, options = {}) {
  const { B, order, displayCurrency, convertFn, POSITION_CATEGORIES } = ctx;
  const showCost = options.showCostColumn === true;
  const groupByCategory = options.groupByCategory !== false;
  const positions = Array.isArray(order.positions) ? order.positions : [];
  const fmt = (v) => fmtKpMoney(v, displayCurrency);

  const blocks = [B.h2('Состав работ и материалов')];

  const headers = showCost
    ? ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена/ед.', 'Себес/ед.', 'Сумма']
    : ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена/ед.', 'Сумма'];

  if (!groupByCategory) {
    // Flat-таблица без группировки
    let idx = 0;
    const rows = positions.map(p => {
      idx++;
      const q = Number(p.qty) || 0;
      const clientPerUnit = conv(Number(p.clientPrice?.value) || 0, p.clientPrice?.currency || displayCurrency, displayCurrency, convertFn);
      const baseRow = [String(idx), p.label || '', String(q), p.unit || '', fmt(clientPerUnit)];
      if (showCost) {
        const costPerUnit = conv(Number(p.costPrice?.value) || 0, p.costPrice?.currency || displayCurrency, displayCurrency, convertFn);
        baseRow.push(fmt(costPerUnit));
      }
      baseRow.push(fmt(q * clientPerUnit));
      return baseRow;
    });
    blocks.push(B.table(headers, rows));
    return blocks;
  }

  // Группировка по категориям
  const byCategory = new Map();
  for (const p of positions) {
    const cat = POSITION_CATEGORIES.find(c => c.id === p.category) || POSITION_CATEGORIES.find(c => c.id === 'other');
    const arr = byCategory.get(cat.id) || { label: cat.label, items: [] };
    arr.items.push(p);
    byCategory.set(cat.id, arr);
  }
  let lineIdx = 0;
  for (const c of POSITION_CATEGORIES) {
    const grp = byCategory.get(c.id);
    if (!grp || !grp.items.length) continue;
    blocks.push(B.h3(grp.label));
    let grpSubtotal = 0;
    const rows = grp.items.map(p => {
      lineIdx++;
      const q = Number(p.qty) || 0;
      const clientPerUnit = conv(Number(p.clientPrice?.value) || 0, p.clientPrice?.currency || displayCurrency, displayCurrency, convertFn);
      const lineTotal = q * clientPerUnit;
      grpSubtotal += lineTotal;
      const baseRow = [String(lineIdx), p.label || '', String(q), p.unit || '', fmt(clientPerUnit)];
      if (showCost) {
        const costPerUnit = conv(Number(p.costPrice?.value) || 0, p.costPrice?.currency || displayCurrency, displayCurrency, convertFn);
        baseRow.push(fmt(costPerUnit));
      }
      baseRow.push(fmt(lineTotal));
      return baseRow;
    });
    blocks.push(B.table(headers, rows));
    blocks.push(B.paragraph(`Итого по разделу «${grp.label}»: ${fmt(grpSubtotal)}`, { style: 'caption' }));
    blocks.push(B.spacer(3));
  }
  return blocks;
}

export function totals(ctx, options = {}) {
  const { B, order, totals, displayCurrency } = ctx;
  const showCost = options.showCostInTotals === true;
  const fmt = (v) => fmtKpMoney(v, displayCurrency);
  // v0.60.112: vatEnabled — для экспортных КП («без НДС»).
  // Если выключен (project.economics.vat.enabled=false ИЛИ override
  // в наряде) — НЕ выводим строку «НДС», итог = чистая клиент-цена.
  const vatEnabled = (order.vatEnabled !== false) && (Number(order.vatPct) || 0) > 0;
  const vatLabel = order.vatLabel || 'НДС';
  const rows = vatEnabled
    ? [
        [`Стоимость работ и материалов (без ${vatLabel}):`, fmt(totals.sumClientNative)],
        [`${vatLabel} (${order.vatPct}%):`, fmt(totals.sumVat)],
        ['ИТОГО к оплате:', fmt(totals.sumClientWithVat)],
      ]
    : [
        // Экспортный КП: одна строка, без НДС-роу. Подпись «(без НДС)»
        // явно указывает клиенту что это чистая стоимость.
        [`ИТОГО к оплате (без ${vatLabel}):`, fmt(totals.sumClientNative)],
      ];
  if (showCost) {
    rows.push(['(служебно) Себестоимость + накладные:', fmt(totals.sumCostWithOverhead)]);
    rows.push(['(служебно) Маржа:', `${fmt(totals.marginAbs)} (${totals.marginPct.toFixed(1)} %)`]);
  }
  return [B.h2('Итого'), B.table(['', ''], rows)];
}

export function notes(ctx) {
  const { B, order } = ctx;
  if (!order.notes) return [];  // скрываем если пусто
  return [B.spacer(4), B.h2('Примечания'), B.paragraph(order.notes)];
}

export function paymentRequisites(ctx) {
  const { B, company } = ctx;
  if (!company.bankRequisites) return [];  // скрываем если пусто
  return [B.spacer(4), B.h2('Платёжные реквизиты'), B.paragraph(company.bankRequisites)];
}

export function signatures(ctx, options = {}) {
  const { B, company } = ctx;
  const showDirector = options.showDirector !== false;
  const sigRows = [
    [`Исполнитель${showDirector && company.director ? ': ' + company.director : ':'}`, 'Заказчик:'],
    ['_______________________ / подпись / дата', '_______________________ / подпись / дата'],
  ];
  return [B.spacer(8), B.table(['', ''], sigRows)];
}

/**
 * Реестр builder-ов по slot.id. Renderer ищет здесь функцию для каждого
 * enabled-слота и вызывает её. Если builder для slot.id не найден —
 * пропускает (warning в console).
 */
export const SLOT_BUILDERS = {
  'company-header':     companyHeader,
  'doc-title':          docTitle,
  'doc-meta':           docMeta,
  'customer-info':      customerInfo,
  'positions-table':    positionsTable,
  'totals':             totals,
  'notes':              notes,
  'payment-requisites': paymentRequisites,
  'signatures':         signatures,
};
