// ======================================================================
// shared/report/compose.js
// Канонический конвейер отчёта одним вызовом — чтобы все подпрограммы
// формировали документы единообразно (требование Пользователя: все
// отчёты на кастомных сохраняемых шаблонах + предпросмотр перед
// экспортом + flow-модель без наложения).
//
//   import { composeReport } from 'shared/report/compose.js';
//   await composeReport({
//     tags:  ['ups-config','общее'],          // → picker шаблона
//     title: `Конфигурация ИБП — ${name}`,
//     author: 'Иванов И.И.',
//     kind:  'ups-config',
//     build: (B) => [ B.h2('Раздел'), B.paragraph('…') ],   // blocks[]
//     filename: 'ups-config.pdf',
//   });
//
// Делает: pickTemplate (если заданы tags) → createTemplate(rec) →
// meta → tpl.content = build(blocks) → migrateToFlow (структура в
// поток, печать/подпись floating, без наложения) → sections.manifest
// → persist manifest в выбранный шаблон → previewPDF (предпросмотр
// перед сохранением). Возвращает 'done' | 'cancelled'.
// ======================================================================

export async function composeReport(opts = {}) {
  const {
    tags, title, author, kind, build, filename,
    pickTitle, persist = true, preview = true,
  } = opts;

  const Report = await import('./index.js');
  const B      = await import('./blocks.js');
  const { migrateToFlow } = await import('./template.js');

  let rec = null;
  if (Array.isArray(tags) && tags.length) {
    rec = await Report.pickTemplate({
      title: pickTitle || ('Шаблон: ' + (title || 'отчёт')),
      tags,
    });
    if (!rec) return 'cancelled';
  }

  const tpl = Report.createTemplate(rec ? rec.template : {});
  tpl.meta = {
    ...(tpl.meta || {}),
    ...(title  ? { title }  : {}),
    ...(author ? { author } : {}),
    ...(kind   ? { kind }   : {}),
  };

  const blocks = (typeof build === 'function' ? build(B) : build) || [];
  tpl.content = blocks;

  // Единый поток: структура шаблона + тело отчёта → нет наложения;
  // печать/подпись floating с привязкой к подписанту.
  migrateToFlow(tpl);

  if (!tpl.sections || typeof tpl.sections !== 'object') tpl.sections = {};
  tpl.sections.manifest = Report.sectionManifestFromContent(tpl.flow);
  if (!Array.isArray(tpl.sections.order))  tpl.sections.order  = [];
  if (!Array.isArray(tpl.sections.hidden)) tpl.sections.hidden = [];

  // Состав разделов → в выбранный шаблон каталога (редактор «Структура»
  // сразу заполнен; порядок/видимость применяются при след. генерациях).
  if (persist && rec && rec.id) {
    try {
      const Cat = await import('../report-catalog.js');
      const st = Cat.getTemplate(rec.id);
      if (st) {
        const cur = JSON.stringify(st.template?.sections?.manifest || []);
        if (cur !== JSON.stringify(tpl.sections.manifest)) {
          const t = st.template || {};
          t.sections = {
            order:  Array.isArray(t.sections?.order)  ? t.sections.order  : [],
            hidden: Array.isArray(t.sections?.hidden) ? t.sections.hidden : [],
            manifest: tpl.sections.manifest,
          };
          Cat.saveTemplate({ ...st, template: t });
        }
      }
    } catch (e) { /* персист опционален */ }
  }

  if (preview) await Report.previewPDF(tpl, filename);
  else await Report.exportPDF(tpl, filename);
  return 'done';
}
