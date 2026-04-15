// ======================================================================
// shared/report/index.js
// Точка входа модуля «Отчёт». Сам модуль не используется как отдельная
// подпрограмма — он предоставляет API для формирования шаблонов отчётов
// и экспорта в PDF / DOCX из любых подпрограмм (cable/, schematic/,
// battery/, ups-config/, panel-config/ и т.д.).
//
// Подробная инструкция по интеграции — shared/report/README.md
// Пользовательский UI для подготовки шаблонов — подпрограмма reports/
//
// Минимальный пример использования:
//
//   import * as Report from '../shared/report/index.js';
//   import * as B      from '../shared/report/blocks.js';
//
//   // 1. Создаём шаблон (стартовые настройки)
//   const tpl = Report.createTemplate({
//     meta: { title: 'Расчёт кабельной линии', author: 'Иванов И.И.' },
//   });
//
//   // 2. (Опционально) даём пользователю настроить оформление
//   Report.openTemplateEditor(tpl, {
//     onSave(updated) {
//       // 3. Заполняем содержимое из данных подпрограммы
//       updated.content = [
//         B.h1('Отчёт о расчёте'),
//         B.paragraph('Исходные данные и результаты.'),
//         B.h2('Параметры'),
//         B.table(
//           ['Параметр','Значение','Ед.'],
//           [['Ток','120','А'],['Длина','80','м']],
//         ),
//       ];
//       // 4. Превью или экспорт
//       Report.renderPreview(updated, document.getElementById('prev'));
//       Report.exportPDF(updated, 'report.pdf');
//       Report.exportDOCX(updated, 'report.docx');
//     }
//   });
// ======================================================================

export {
  defaultTemplate,
  createTemplate,
  pageSizeMm,
  contentBox,
  substitute,
  PAGE_SIZES,
  FONT_FAMILIES,
} from './template.js';

export * as blocks from './blocks.js';

export { renderPreview, paginate, estimateBlockHeight, renderBlock } from './preview.js';

export { openTemplateEditor } from './editor.js';

// Экспортёры грузят тяжёлые CDN-зависимости лениво (jsPDF / docx.js),
// поэтому их функции async.
export { exportPDF }  from './export-pdf.js';
export { exportDOCX } from './export-docx.js';
