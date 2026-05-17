// =============================================================================
// service/calc/export-offer.js — экспорт КП клиенту через модуль reports/
// =============================================================================
// v0.60.30: По правилу проекта (запомнено 2026-05-02): «все отчёты должны
// формироваться через модуль reports/. Каждый документ должен иметь свои
// шаблоны, которые пользователь может настроить по своим требованиям».
//
// Раньше (v0.60.26) КП собирался прямой HTML-вёрсткой через window.open().
// Это нарушало правило → переписано через shared/report/ (blocks API).
//
// API:
//   - buildOfferBlocks(order, displayCurrency, convertFn, opts) → blocks[]
//   - openOfferPreview(order, displayCurrency, convertFn, opts) → открывает
//     editor шаблона + preview, далее экспорт PDF/DOCX через reports/.

import { computeOrderTotals, ORDER_TYPES, POSITION_CATEGORIES } from './order-model.js';
import { fmtMoney } from 'cooling/calc/fc-summary.js';
import { loadEffectiveCompanyProfile } from 'shared/company-profile.js';
import { getActiveKpTemplate } from '../../report/kp-template.js';
import { SLOT_BUILDERS } from '../../report/slots/kp-blocks.js';

/**
 * Сформировать blocks[] для модуля reports.
 * Подпрограмма НЕ рисует HTML — только возвращает структуру; все стили,
 * шрифты, поля страницы — управляются шаблоном из reports/.
 *
 * @param {object} order
 * @param {string} displayCurrency
 * @param {function|null} convertFn
 * @param {object} opts — { showCostBreakdown, pid, blocks (alias to shared/report/blocks) }
 * @returns {Array<object>} blocks для tpl.content
 */
export function buildOfferBlocks(order, displayCurrency = '₽', convertFn = null, opts = {}) {
  const B = opts.blocks;
  if (!B) throw new Error('buildOfferBlocks: opts.blocks (shared/report/blocks) is required');

  const profile = loadEffectiveCompanyProfile(opts.pid);
  const company = { ...profile, ...(opts.companyInfo || {}) };
  const totals = computeOrderTotals(order, displayCurrency, convertFn);

  // v0.60.44 (Phase 29): slot-based renderer. Берём активный шаблон,
  // итерируем enabled-слоты, для каждого вызываем builder из SLOT_BUILDERS.
  // Override через opts.template если caller хочет явный шаблон (для preview).
  const template = opts.template || getActiveKpTemplate();
  const ctx = {
    order, displayCurrency, convertFn, company, totals,
    B,
    POSITION_CATEGORIES, ORDER_TYPES,
    fmtMoney,
  };
  const blocks = [];
  for (const slot of (template.slots || [])) {
    if (!slot.enabled) continue;
    const builder = SLOT_BUILDERS[slot.id];
    if (!builder) {
      console.warn(`[export-offer] Нет builder для слота "${slot.id}"`);
      continue;
    }
    try {
      const slotBlocks = builder(ctx, slot.options || {});
      if (Array.isArray(slotBlocks)) blocks.push(...slotBlocks);
    } catch (e) {
      console.error(`[export-offer] Ошибка builder слота "${slot.id}":`, e);
    }
  }
  // Backward-compat: если opts.showCostBreakdown=true, override slot-options
  // для positions-table и totals чтобы показать колонку себестоимости.
  if (opts.showCostBreakdown === true && !opts.template) {
    // Re-build с временным шаблоном где у positions-table.showCostColumn=true
    const overrideTpl = {
      ...template,
      slots: template.slots.map(s => {
        if (s.id === 'positions-table') return { ...s, options: { ...s.options, showCostColumn: true } };
        if (s.id === 'totals') return { ...s, options: { ...s.options, showCostInTotals: true } };
        return s;
      }),
    };
    return buildOfferBlocks(order, displayCurrency, convertFn, { ...opts, template: overrideTpl });
  }
  return blocks;
}

/**
 * Экспорт КП напрямую в PDF (без template editor — он накладывал header-overlay
 * поверх контента, по репорту 2026-05-02 «содержимое попадает поверх шаблона»).
 *
 * Phase 29 (TODO в roadmap): полноценная slot-based template system для документов
 * с возможностью перестановки блоков. Сейчас — clean default template без overlays.
 */
export async function openOfferPreview(order, displayCurrency, convertFn, opts = {}) {
  let Report, blocks;
  try {
    Report = await import('shared/report/index.js');
    blocks = await import('shared/report/blocks.js');
  } catch (e) {
    throw new Error('Не удалось загрузить модуль отчётов: ' + e.message);
  }
  const profile = loadEffectiveCompanyProfile(opts.pid);
  const tpl = Report.createTemplate({
    meta: {
      title: `КП №${order.id || ''} — ${order.name || ''}`,
      author: profile.director || profile.name || '',
      kind: 'commercial-offer',
    },
  });
  // v0.60.40: убираем default overlays (header/footer). Они накладывались
  // ПОВЕРХ контента, искажая шапку. Только page-number footer оставим, и то
  // через slim margin-bottom. Phase 29 даст полную слот-систему.
  tpl.overlays = [
    {
      id: 'kp-page-number',
      area: 'footer',
      align: 'center',
      content: 'стр. {{page}} из {{pages}}',
      fontSize: 8,
      color: '#888',
    },
  ];
  // Page settings — A4, увеличенные поля чтобы контент не упирался в края.
  tpl.page = { ...(tpl.page || {}), format: 'A4', orientation: 'portrait' };
  tpl.margins = { top: 18, right: 15, bottom: 18, left: 18 };  // mm
  tpl.content = buildOfferBlocks(order, displayCurrency, convertFn, { ...opts, blocks });
  // Прямой экспорт PDF — без openTemplateEditor.
  const fname = `kp-${(order.id || 'order').replace(/[^\w-]+/g, '_')}.pdf`;
  Report.exportPDF(tpl, fname);
}
