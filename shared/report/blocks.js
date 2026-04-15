// ======================================================================
// shared/report/blocks.js
// Конструкторы блоков содержимого и колонтитулов. Подпрограммы не
// обязаны их использовать — можно собирать JSON вручную, — но эти
// хелперы делают код подпрограммы короче и типобезопаснее.
//
//   import * as B from '../shared/report/blocks.js';
//
//   tpl.content = [
//     B.h1('Отчёт о расчёте кабельной линии'),
//     B.paragraph('Исходные данные и результаты модулей.'),
//     B.h2('Исходные данные'),
//     B.list(['I = 120 А', 'U = 400 В', 'L = 80 м']),
//     B.table(
//       ['Параметр', 'Значение', 'Ед.'],
//       [
//         ['Сечение', '25',  'мм²'],
//         ['ΔU',      '2.1', '%'],
//       ],
//     ),
//     B.pageBreak(),
//   ];
// ======================================================================

export const h1 = (text, opts = {}) =>
  ({ type: 'heading', level: 1, text, ...opts });

export const h2 = (text, opts = {}) =>
  ({ type: 'heading', level: 2, text, ...opts });

export const h3 = (text, opts = {}) =>
  ({ type: 'heading', level: 3, text, ...opts });

export const paragraph = (text, opts = {}) =>
  ({ type: 'paragraph', text, ...opts });

export const caption = (text, opts = {}) =>
  ({ type: 'paragraph', style: 'caption', text, ...opts });

export const list = (items, opts = {}) =>
  ({ type: 'list', ordered: false, items, ...opts });

export const orderedList = (items, opts = {}) =>
  ({ type: 'list', ordered: true, items, ...opts });

/** table(columns, rows):
 *    columns — массив заголовков (string) или объектов { text, align, width }
 *              (width в мм; если не задан — делятся поровну)
 *    rows    — массив массивов строк
 */
export const table = (columns, rows, opts = {}) =>
  ({ type: 'table', columns, rows, ...opts });

/** image({ src, width, height, align }): src — data URL или обычный URL */
export const image = (opts) =>
  ({ type: 'image', align: 'left', ...opts });

export const spacer = (heightMm = 3) =>
  ({ type: 'spacer', height: heightMm });

export const pageBreak = () => ({ type: 'pagebreak' });

export const hr = (opts = {}) =>
  ({ type: 'hr', color: '#c0c6d2', thickness: 0.3, ...opts });

/** Свободный блок: функция, которая получает контекст рендера и сама
 * рисует через низкоуровневое API (см. preview.js / export-pdf.js).
 * Используется для редких случаев вроде подписей или штампов. */
export const custom = (renderFn, opts = {}) =>
  ({ type: 'custom', render: renderFn, ...opts });

/** Набор валидных типов — renderer'ы сверяются с ним. */
export const BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'list', 'table', 'image',
  'spacer', 'pagebreak', 'hr', 'custom',
]);
