// ======================================================================
// shared/report/cross-discipline.js
// X.4.4 — сводный мультидисциплинарный отчёт (КОНТРАКТ-builder).
// Чистая функция: на вход нормализованные секции по дисциплинам,
// на выход — blocks[] для модуля reports/ (memory: reports-only-via-
// reports — подпрограмма НЕ рисует HTML сама). Связывает per-discipline
// движки lib/<id>-methods (X.4.1) + реестр shared/disciplines.js
// (X.4.2) с отчётным слоем. Импорты только SHARED→SHARED (закон границ
// соблюдён: lib НЕ импортируется — результаты передаёт потребитель).
//
//   import { buildCrossDisciplineReport } from
//     '../shared/report/cross-discipline.js';
//   const blocks = buildCrossDisciplineReport({ title, sections });
//   // → отдаётся в shared/report/index.js createTemplate(...).content
// ======================================================================

import * as B from './blocks.js';
import { getDiscipline, DEFAULT_DISCIPLINE } from '../disciplines.js';

/**
 * @typedef {Object} DisciplineSection
 * @property {string}   disciplineId  id из реестра disciplines.js
 * @property {string}  [methodLabel]  название применённой методики
 * @property {Array<[string,(string|number),string=]>} [rows]
 *           строки таблицы: [параметр, значение, ед.изм?]
 * @property {string[]} [steps]       пошаговый вывод (caption-список)
 * @property {string}  [note]         примечание под секцией
 */

/** Нормализовать значение ячейки → строка (числа без хвостов). */
function _cell(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? String(v)
      : String(Math.round(v * 1e4) / 1e4);
  }
  return String(v);
}

/**
 * Собрать blocks[] сводного мультидисциплинарного отчёта.
 * @param {Object} opts
 * @param {string} [opts.title]    заголовок отчёта
 * @param {string} [opts.intro]    вводный абзац (опц.)
 * @param {Object} [opts.project]  { name, designation } для шапки (опц.)
 * @param {DisciplineSection[]} opts.sections  секции по дисциплинам
 * @param {boolean} [opts.withSteps=true]   включать пошаговый вывод
 * @param {boolean} [opts.withCoverage=true] сводная таблица охвата
 * @returns {Array<object>} blocks[] (контракт shared/report)
 */
export function buildCrossDisciplineReport(opts = {}) {
  const {
    title = 'Сводный мультидисциплинарный расчёт',
    intro = '',
    project = null,
    sections = [],
    withSteps = true,
    withCoverage = true,
  } = opts;

  const blocks = [B.h1(title)];

  if (project && (project.name || project.designation)) {
    const head = [project.designation, project.name]
      .filter(Boolean).join(' — ');
    blocks.push(B.caption(head));
  }
  if (intro) blocks.push(B.paragraph(intro));

  const seen = [];
  for (const s of (Array.isArray(sections) ? sections : [])) {
    if (!s || typeof s !== 'object') continue;
    const d = getDiscipline(s.disciplineId) || getDiscipline(DEFAULT_DISCIPLINE);
    const icon = d ? d.icon : '•';
    const label = d ? d.label : (s.disciplineId || '—');
    seen.push({ id: d ? d.id : (s.disciplineId || '—'), label,
      method: s.methodLabel || '—', units: d ? d.units : '' });

    blocks.push(B.h2(`${icon} ${label}${s.methodLabel ? ' — ' + s.methodLabel : ''}`));

    const rows = Array.isArray(s.rows) ? s.rows : [];
    if (rows.length) {
      blocks.push(B.table(
        ['Параметр', 'Значение', 'Ед.'],
        rows.map(r => [_cell(r[0]), _cell(r[1]), _cell(r[2] ?? '')]),
      ));
    } else {
      blocks.push(B.paragraph('Данные расчёта не предоставлены.'));
    }

    if (withSteps && Array.isArray(s.steps) && s.steps.length) {
      blocks.push(B.caption('Ход расчёта:'));
      blocks.push(B.orderedList(s.steps.map(_cell)));
    }
    if (s.note) blocks.push(B.caption(s.note));
    blocks.push(B.hr());
  }

  if (withCoverage && seen.length) {
    blocks.push(B.h2('Охват дисциплин'));
    blocks.push(B.table(
      ['Дисциплина', 'Методика', 'Базовые величины'],
      seen.map(x => [x.label, x.method, x.units]),
    ));
  }

  if (!seen.length) {
    blocks.push(B.paragraph('Нет секций для включения в сводный отчёт.'));
  }

  return blocks;
}
