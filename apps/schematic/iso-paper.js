// ======================================================================
// iso-paper.js
// Форматы листа ISO 216 + рамка чертежа (ISO 5457) + основная надпись
// по ISO 7200 (Title blocks for technical product documentation).
//
// Все размеры — в миллиметрах. Функции возвращают SVG-строки и должны
// вызываться в системе координат листа (0,0 — левый верхний угол листа).
// ======================================================================

/**
 * Размеры листов ISO 216 (альбомная ориентация: w ≥ h).
 */
export const PAPER_SIZES = {
  A4: { w: 297,  h: 210 },
  A3: { w: 420,  h: 297 },
  A2: { w: 594,  h: 420 },
  A1: { w: 841,  h: 594 },
  A0: { w: 1189, h: 841 },
};

/**
 * Отступы рамки чертежа по ISO 5457:
 *   левый край — 20 мм (для подшивки), остальные — 10 мм для A4/A3
 *   и 20 мм для A2/A1/A0.
 */
export function getFrameMargins(size) {
  if (size === 'A4' || size === 'A3') {
    return { left: 20, right: 10, top: 10, bottom: 10 };
  }
  return { left: 20, right: 20, top: 20, bottom: 20 };
}

/**
 * Возвращает параметры листа с учётом ориентации.
 */
export function getSheetSize(size, orientation = 'landscape') {
  const s = PAPER_SIZES[size] || PAPER_SIZES.A3;
  if (orientation === 'portrait') {
    return { w: s.h, h: s.w };
  }
  return { w: s.w, h: s.h };
}

/**
 * Размеры основной надписи ISO 7200.
 * ISO 7200 не стандартизирует жёсткие габариты, но устанавливает
 * набор полей. В практике — блок 180×40 мм в нижнем правом углу.
 * Для A4 используется 180×40 во всю ширину рамки.
 */
export const TITLE_BLOCK = {
  w: 180,
  h: 40,
};

// ----------------------------------------------------------------------
// Рамка чертежа + координатные зоны по ISO 5457
// ----------------------------------------------------------------------
export function buildSheetFrame(sheetW, sheetH, margins) {
  const { left, right, top, bottom } = margins;
  return {
    x: left,
    y: top,
    w: sheetW - left - right,
    h: sheetH - top - bottom,
  };
}

/**
 * Возвращает массив прямоугольников/линий координатных зон по ISO 5457.
 * Горизонтальные зоны нумеруются арабскими цифрами 1,2,3…
 * Вертикальные — латинскими буквами A,B,C…
 * Размер поля зоны на каждой стороне — 5 мм, ячейки ~50 мм.
 */
export function buildZoneMarkers(frame) {
  const CELL = 50;         // размер одной зоны
  const STRIP = 5;         // ширина полоски зон
  const out = [];

  // горизонтальные (сверху и снизу) — цифры
  const cols = Math.max(1, Math.round(frame.w / CELL));
  for (let i = 0; i < cols; i++) {
    const x0 = frame.x + (frame.w * i) / cols;
    const x1 = frame.x + (frame.w * (i + 1)) / cols;
    const cx = (x0 + x1) / 2;
    const label = String(cols - i); // нумерация справа налево как на чертежах
    // верхняя полоска
    out.push(`<line x1="${x1}" y1="${frame.y}" x2="${x1}" y2="${frame.y + STRIP}"/>`);
    out.push(`<text x="${cx}" y="${frame.y + STRIP / 2}">${label}</text>`);
    // нижняя полоска
    out.push(`<line x1="${x1}" y1="${frame.y + frame.h - STRIP}" x2="${x1}" y2="${frame.y + frame.h}"/>`);
    out.push(`<text x="${cx}" y="${frame.y + frame.h - STRIP / 2}">${label}</text>`);
  }

  // вертикальные (слева и справа) — буквы
  const rows = Math.max(1, Math.round(frame.h / CELL));
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // без I,O,Q
  for (let i = 0; i < rows; i++) {
    const y0 = frame.y + (frame.h * i) / rows;
    const y1 = frame.y + (frame.h * (i + 1)) / rows;
    const cy = (y0 + y1) / 2;
    const label = alphabet[i] || '?';
    // левая полоска
    out.push(`<line x1="${frame.x}" y1="${y1}" x2="${frame.x + STRIP}" y2="${y1}"/>`);
    out.push(`<text x="${frame.x + STRIP / 2}" y="${cy}">${label}</text>`);
    // правая полоска
    out.push(`<line x1="${frame.x + frame.w - STRIP}" y1="${y1}" x2="${frame.x + frame.w}" y2="${y1}"/>`);
    out.push(`<text x="${frame.x + frame.w - STRIP / 2}" y="${cy}">${label}</text>`);
  }

  return out.join('\n');
}

/**
 * Построить SVG-блок основной надписи по ISO 7200.
 * Позиция — в правом нижнем углу рамки.
 *
 * fields:
 *   title     — наименование изделия (product title)
 *   docTitle  — наименование документа (document title)
 *   docNumber — обозначение документа (document number)
 *   prepared  — разработчик
 *   approved  — утвердил
 *   owner     — владелец документа
 *   date      — дата выпуска (ISO yyyy-mm-dd)
 *   rev       — ревизия
 *   lang      — язык
 *   sheet     — номер листа
 *   sheets    — всего листов
 *   scale     — масштаб (1:1 и т. п.)
 */
export function buildTitleBlock(frame, fields = {}) {
  const W = TITLE_BLOCK.w;
  const H = TITLE_BLOCK.h;
  const x = frame.x + frame.w - W;
  const y = frame.y + frame.h - H;

  const esc = (s) => String(s ?? '').replace(/[&<>]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));

  // сетка полей (сверху вниз):
  //   row 0: Разработчик | Утвердил | Владелец | Наименование изделия + документа | № листа
  //   row 1: Дата        | Дата     | Ревизия  | Обозначение документа            | Всего листов
  //
  // колонки:
  //   0..40   — Prepared
  //  40..80   — Approved
  //  80..110  — Owner / Rev
  // 110..160  — Title (большая ячейка)
  // 160..180  — Sheet / Sheets
  //
  // строки: 0..20..40
  //
  // Нижняя правая ячейка — обозначение документа (во всю ширину titles).

  const lines = [];
  // внешняя рамка
  lines.push(`<rect class="tb-frame" x="${x}" y="${y}" width="${W}" height="${H}"/>`);

  // вертикальные линии
  [40, 80, 110, 160].forEach(xi => {
    lines.push(`<line x1="${x + xi}" y1="${y}" x2="${x + xi}" y2="${y + H}"/>`);
  });
  // горизонтальные линии
  [10, 20, 30].forEach(yi => {
    lines.push(`<line x1="${x}" y1="${y + yi}" x2="${x + 110}" y2="${y + yi}"/>`);
  });
  // правая часть (sheet/sheets) — 2 строки по 10 мм сверху
  lines.push(`<line x1="${x + 160}" y1="${y + 10}" x2="${x + W}" y2="${y + 10}"/>`);
  lines.push(`<line x1="${x + 160}" y1="${y + 20}" x2="${x + W}" y2="${y + 20}"/>`);
  lines.push(`<line x1="${x + 160}" y1="${y + 30}" x2="${x + W}" y2="${y + 30}"/>`);
  // разделитель title / docNumber по середине большой ячейки
  lines.push(`<line x1="${x + 110}" y1="${y + 25}" x2="${x + 160}" y2="${y + 25}"/>`);

  // --- подписи (labels) ---
  const L = (lx, ly, txt) =>
    `<text class="tb-label" x="${x + lx + 1}" y="${y + ly + 2}" text-anchor="start">${esc(txt)}</text>`;
  // --- значения ---
  const V = (lx, ly, txt, big = false) =>
    `<text class="${big ? 'tb-value-big' : 'tb-value'}" x="${x + lx + 1}" y="${y + ly}" text-anchor="start">${esc(txt)}</text>`;

  lines.push(L(0,   0,  'Prepared by / Разраб.'));
  lines.push(V(0,   8,  fields.prepared));
  lines.push(L(0,   10, 'Date / Дата'));
  lines.push(V(0,   18, fields.date));

  lines.push(L(40,  0,  'Approved by / Утв.'));
  lines.push(V(40,  8,  fields.approved));
  lines.push(L(40,  10, 'Date / Дата'));
  lines.push(V(40,  18, fields.date));

  lines.push(L(80,  0,  'Owner / Владелец'));
  lines.push(V(80,  8,  fields.owner));
  lines.push(L(80,  10, 'Rev / Рев.'));
  lines.push(V(80,  18, fields.rev));

  lines.push(L(110, 0,  'Title / Наименование'));
  lines.push(V(110, 10, fields.title, true));
  lines.push(L(110, 15, 'Document title / Документ'));
  lines.push(V(110, 23, fields.docTitle));

  lines.push(L(160, 0,  'Sheet / Лист'));
  lines.push(V(160, 8,  fields.sheet));
  lines.push(L(160, 10, 'Sheets / Всего'));
  lines.push(V(160, 18, fields.sheets));
  lines.push(L(160, 20, 'Scale / Масштаб'));
  lines.push(V(160, 28, fields.scale));

  // нижняя строка — обозначение документа (document number) — 30..40
  lines.push(L(0,   30, 'Document number / Обозначение'));
  lines.push(V(0,   38, fields.docNumber, true));

  // язык
  lines.push(L(160, 30, 'Lang / Язык'));
  lines.push(V(160, 38, fields.lang));

  return lines.join('\n');
}
