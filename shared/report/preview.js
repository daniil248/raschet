// ======================================================================
// shared/report/preview.js
// HTML-превью шаблона отчёта. Рендерит весь документ как серию
// абсолютно-позиционированных «страниц», чтобы пользователь видел точные
// границы листов, поля и зоны колонтитулов.
//
// Превью работает в двух режимах:
//   — 'edit'  — показывает рамки полей и зон (для редактора шаблона)
//   — 'final' — чистый вид без направляющих (для показа готового отчёта)
//
// Данные блоков, у которых текст содержит {{...}}, подставляются из
// tpl.meta + ctx (дата, номер страницы / общее число страниц).
// ======================================================================

import { pageSizeMm, contentBox, substitute, overlaysForPage } from './template.js';

/** Рендер всего шаблона в переданный контейнер. */
export function renderPreview(tpl, container, opts = {}) {
  const mode  = opts.mode || 'edit';
  const scale = opts.scale || 2.8;  // px на 1 мм — даёт ~80% от экранного A4
  container.innerHTML = '';
  container.classList.add('rpt-preview');
  if (mode === 'edit') container.classList.add('rpt-preview--edit');

  // Разбиваем content по страницам (упрощённая пагинация: считаем высоту
  // каждого блока и кладём в текущую страницу, пока влезает).
  const pages = paginate(tpl);
  const totalPages = Math.max(1, pages.length);

  pages.forEach((pageBlocks, i) => {
    const isFirst = i === 0;
    const pageEl = buildPageShell(tpl, scale, mode, isFirst, i + 1, totalPages);
    const body   = pageEl.querySelector('.rpt-page__body');
    pageBlocks.forEach(block => body.appendChild(renderBlock(block, tpl, { page: i + 1, pages: totalPages })));
    container.appendChild(pageEl);
  });
}

// ——————————————————————————————————————————————————————————————————————
// Пагинация: считаем грубую высоту каждого блока в мм и заполняем
// страницы по очереди. Этого достаточно для превью и совпадает с тем,
// как считает PDF-экспорт (см. export-pdf.js).
// ——————————————————————————————————————————————————————————————————————
export function paginate(tpl) {
  const pages = [];
  let current = [];
  let usedH = 0;
  let pageIdx = 0;

  const pushPage = () => {
    pages.push(current);
    current = [];
    usedH = 0;
    pageIdx += 1;
  };

  const availH = () => contentBox(tpl, pageIdx === 0).height;

  for (const block of (tpl.content || [])) {
    if (block.type === 'pagebreak') {
      pushPage();
      continue;
    }
    const h = estimateBlockHeight(block, tpl);
    if (usedH + h > availH() && current.length > 0) {
      pushPage();
    }
    current.push(block);
    usedH += h;
  }
  if (current.length || pages.length === 0) pushPage();
  return pages;
}

/** Грубая оценка высоты блока в мм. Используется и пагинатором, и
 * PDF-экспортом, чтобы их разбиение сходилось. */
export function estimateBlockHeight(block, tpl) {
  const styles = tpl.styles;
  const contentWidthMm = contentBox(tpl, true).width;

  switch (block.type) {
    case 'spacer':    return Number(block.height) || 0;
    case 'hr':        return (Number(block.thickness) || 0.3) + 1.5;
    case 'pagebreak': return 0;

    case 'heading': {
      const s = styles['h' + (block.level || 1)] || styles.h1;
      return (s.spaceBefore || 0) + ptToMm(s.size * s.lineHeight) + (s.spaceAfter || 0);
    }
    case 'paragraph': {
      const s = styles[block.style || 'body'] || styles.body;
      const lines = wrapLines(block.text || '', contentWidthMm, s);
      return (s.spaceBefore || 0) + lines * ptToMm(s.size * s.lineHeight) + (s.spaceAfter || 0);
    }
    case 'list': {
      const s = styles.list;
      let h = (s.spaceBefore || 0);
      for (const item of (block.items || [])) {
        const lines = wrapLines(item, contentWidthMm - (s.indent || 0), s);
        h += lines * ptToMm(s.size * s.lineHeight) + (s.spaceAfter || 0);
      }
      return h;
    }
    case 'table': {
      const s = styles.table;
      const rowH = ptToMm(s.size * 1.4) + 2 * (s.cellPadding || 1.8);
      return rowH * (1 + (block.rows?.length || 0)) + 2;
    }
    case 'image': {
      return (Number(block.height) || 20) + 2;
    }
    case 'custom': {
      return Number(block.estimatedHeight) || 10;
    }
  }
  return 5;
}

function ptToMm(pt) { return pt * 0.3528; }

/** Очень грубая оценка количества строк текста в блоке при ширине
 * contentWidthMm. В 1 мм при 11pt укладывается примерно 2.6 символа
 * пропорционального шрифта — этого достаточно для оценки. */
function wrapLines(text, widthMm, style) {
  const charsPerMm = Math.max(0.1, 3.2 - (style.size - 11) * 0.15);
  const perLine   = Math.max(1, Math.floor(widthMm * charsPerMm));
  const words     = String(text).split(/\s+/);
  let lines = 1, cur = 0;
  for (const w of words) {
    const add = (cur ? 1 : 0) + w.length;
    if (cur + add > perLine) { lines += 1; cur = w.length; }
    else cur += add;
  }
  return lines;
}

// ——————————————————————————————————————————————————————————————————————
// Каркас страницы: лист + поля + колонтитулы + область body + логотип.
// ——————————————————————————————————————————————————————————————————————
function buildPageShell(tpl, scale, mode, isFirst, pageNum, totalPages) {
  const { width, height } = pageSizeMm(tpl.page);
  const m    = tpl.page.margins;
  const hdr  = isFirst ? tpl.header.firstPage : tpl.header.otherPages;
  const ftr  = isFirst ? tpl.footer.firstPage : tpl.footer.otherPages;

  const page = div('rpt-page');
  page.style.width  = (width  * scale) + 'px';
  page.style.height = (height * scale) + 'px';

  // Направляющие полей (только в edit-режиме)
  if (mode === 'edit') {
    const guide = div('rpt-page__margins');
    guide.style.left   = (m.left   * scale) + 'px';
    guide.style.right  = (m.right  * scale) + 'px';
    guide.style.top    = (m.top    * scale) + 'px';
    guide.style.bottom = (m.bottom * scale) + 'px';
    page.appendChild(guide);
  }

  // Шапка
  if (hdr.enabled) {
    const h = div('rpt-page__header');
    h.style.left   = (m.left  * scale) + 'px';
    h.style.right  = (m.right * scale) + 'px';
    h.style.top    = (m.top   * scale) + 'px';
    h.style.height = (hdr.height * scale) + 'px';
    if (mode === 'edit') h.classList.add('rpt-zone--edit');
    (hdr.blocks || []).forEach(b =>
      h.appendChild(renderBlock(b, tpl, { page: pageNum, pages: totalPages })));
    page.appendChild(h);
  }

  // Подвал
  if (ftr.enabled) {
    const f = div('rpt-page__footer');
    f.style.left   = (m.left  * scale) + 'px';
    f.style.right  = (m.right * scale) + 'px';
    f.style.bottom = (m.bottom * scale) + 'px';
    f.style.height = (ftr.height * scale) + 'px';
    if (mode === 'edit') f.classList.add('rpt-zone--edit');
    (ftr.blocks || []).forEach(b =>
      f.appendChild(renderBlock(b, tpl, { page: pageNum, pages: totalPages })));
    page.appendChild(f);
  }

  // Основная область
  const body = div('rpt-page__body');
  const cb = contentBox(tpl, isFirst);
  body.style.left   = (cb.x * scale) + 'px';
  body.style.top    = (cb.y * scale) + 'px';
  body.style.width  = (cb.width  * scale) + 'px';
  body.style.height = (cb.height * scale) + 'px';
  if (mode === 'edit') body.classList.add('rpt-body--edit');
  page.appendChild(body);

  // Логотип
  if (tpl.logo && tpl.logo.src && (!tpl.logo.onFirstPageOnly || isFirst)) {
    const img = document.createElement('img');
    img.className = 'rpt-logo';
    img.src = tpl.logo.src;
    img.style.width  = (tpl.logo.width  * scale) + 'px';
    img.style.height = (tpl.logo.height * scale) + 'px';
    positionLogo(img, tpl, scale);
    page.appendChild(img);
  }

  // Overlay-зоны (свободно позиционируемые)
  const ovs = overlaysForPage(tpl, isFirst);
  for (const ov of ovs) {
    const el = document.createElement('div');
    el.className = 'rpt-overlay';
    el.style.left   = (ov.x * scale) + 'px';
    el.style.top    = (ov.y * scale) + 'px';
    el.style.width  = (ov.width  * scale) + 'px';
    el.style.height = (ov.height * scale) + 'px';
    if (mode === 'edit') el.classList.add('rpt-overlay--edit');
    const s = tpl.styles[ov.content?.styleRef || 'body'] || tpl.styles.body;
    el.style.fontFamily = s.font;
    el.style.fontSize   = s.size + 'pt';
    el.style.fontWeight = s.bold ? '700' : '400';
    el.style.fontStyle  = s.italic ? 'italic' : 'normal';
    el.style.color      = s.color;
    el.style.lineHeight = s.lineHeight;
    el.style.textAlign  = ov.content?.align || 'left';
    el.style.overflow   = 'hidden';
    el.textContent = substitute(ov.content?.text || '', tpl, { page: pageNum, pages: totalPages });
    page.appendChild(el);
  }

  // Номер страницы внизу-по-центру в edit-режиме
  if (mode === 'edit') {
    const lbl = div('rpt-page__label');
    lbl.textContent = `Стр. ${pageNum} из ${totalPages}`;
    page.appendChild(lbl);
  }

  return page;
}

function positionLogo(img, tpl, scale) {
  // Абсолютные координаты из canvas-редактора имеют приоритет над legacy
  // position ('header-left' и т.п.), которая оставлена для совместимости.
  if (typeof tpl.logo.x === 'number' && typeof tpl.logo.y === 'number') {
    img.style.left = (tpl.logo.x * scale) + 'px';
    img.style.top  = (tpl.logo.y * scale) + 'px';
    return;
  }
  const { width, height } = pageSizeMm(tpl.page);
  const m = tpl.page.margins;
  const pos = tpl.logo.position || 'header-left';
  const isHeader = pos.startsWith('header');
  const y = isHeader ? m.top : (height - m.bottom - tpl.logo.height);
  img.style.top = (y * scale) + 'px';
  if (pos.endsWith('left'))   img.style.left  = (m.left  * scale) + 'px';
  if (pos.endsWith('right'))  img.style.left  = ((width - m.right - tpl.logo.width) * scale) + 'px';
  if (pos.endsWith('center')) img.style.left  = (((width - tpl.logo.width) / 2) * scale) + 'px';
}

// ——————————————————————————————————————————————————————————————————————
// Рендер одного блока в DOM.
// ——————————————————————————————————————————————————————————————————————
export function renderBlock(block, tpl, ctx) {
  const S = tpl.styles;
  switch (block.type) {
    case 'heading': {
      const level = block.level || 1;
      const el = document.createElement('div');
      el.className = `rpt-h rpt-h${level}`;
      applyStyle(el, S['h' + level] || S.h1, block);
      el.textContent = substitute(block.text, tpl, ctx);
      return el;
    }
    case 'paragraph': {
      const el = document.createElement('div');
      el.className = 'rpt-p';
      const s = S[block.style || 'body'] || S.body;
      applyStyle(el, s, block);
      el.textContent = substitute(block.text, tpl, ctx);
      return el;
    }
    case 'list': {
      const el = document.createElement(block.ordered ? 'ol' : 'ul');
      el.className = 'rpt-list';
      applyStyle(el, S.list, block);
      el.style.paddingLeft = (S.list.indent + 2) + 'mm';
      (block.items || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = substitute(item, tpl, ctx);
        el.appendChild(li);
      });
      return el;
    }
    case 'table': {
      const el = document.createElement('table');
      el.className = 'rpt-table';
      const s = S.table;
      el.style.font = `${s.size}pt ${s.font}`;
      el.style.color = s.color;
      el.style.borderColor = s.borderColor;
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      (block.columns || []).forEach(col => {
        const th = document.createElement('th');
        const c = typeof col === 'string' ? { text: col } : col;
        th.textContent = c.text || '';
        if (c.align) th.style.textAlign = c.align;
        if (c.width) th.style.width = c.width + 'mm';
        if (s.headBold) th.style.fontWeight = '700';
        th.style.background = s.headBg;
        th.style.padding = s.cellPadding + 'mm';
        th.style.border = `0.2mm solid ${s.borderColor}`;
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      el.appendChild(thead);
      const tbody = document.createElement('tbody');
      (block.rows || []).forEach(row => {
        const tr = document.createElement('tr');
        row.forEach((cell, i) => {
          const td = document.createElement('td');
          td.textContent = substitute(cell, tpl, ctx);
          const c = block.columns && typeof block.columns[i] === 'object' ? block.columns[i] : null;
          if (c && c.align) td.style.textAlign = c.align;
          td.style.padding = s.cellPadding + 'mm';
          td.style.border = `0.2mm solid ${s.borderColor}`;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      el.appendChild(tbody);
      return el;
    }
    case 'image': {
      const el = document.createElement('img');
      el.className = 'rpt-image';
      el.src = block.src;
      if (block.width)  el.style.width  = block.width  + 'mm';
      if (block.height) el.style.height = block.height + 'mm';
      if (block.align === 'center') { el.style.display = 'block'; el.style.margin = '0 auto'; }
      if (block.align === 'right')  { el.style.display = 'block'; el.style.marginLeft = 'auto'; }
      return el;
    }
    case 'spacer': {
      const el = document.createElement('div');
      el.style.height = (block.height || 3) + 'mm';
      return el;
    }
    case 'hr': {
      const el = document.createElement('hr');
      el.className = 'rpt-hr';
      el.style.borderTop = `${block.thickness || 0.3}mm solid ${block.color || '#c0c6d2'}`;
      el.style.margin = '1mm 0';
      return el;
    }
    case 'pagebreak': {
      return document.createComment('pagebreak');
    }
    case 'custom': {
      const el = document.createElement('div');
      el.className = 'rpt-custom';
      if (typeof block.render === 'function') {
        try { block.render(el, tpl, ctx); }
        catch (e) { el.textContent = '[custom block error: ' + (e && e.message) + ']'; }
      }
      return el;
    }
  }
  return document.createComment('unknown block: ' + block.type);
}

function applyStyle(el, s, block) {
  el.style.fontFamily = s.font;
  el.style.fontSize   = s.size + 'pt';
  el.style.fontWeight = s.bold ? '700' : '400';
  el.style.fontStyle  = s.italic ? 'italic' : 'normal';
  el.style.color      = s.color;
  el.style.lineHeight = s.lineHeight;
  el.style.textAlign  = block.align || s.align || 'left';
  el.style.marginTop    = (s.spaceBefore || 0) + 'mm';
  el.style.marginBottom = (s.spaceAfter  || 0) + 'mm';
}

function div(cls) { const el = document.createElement('div'); el.className = cls; return el; }
