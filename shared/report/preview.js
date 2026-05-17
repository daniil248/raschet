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

import { pageSizeMm, contentBox, substitute, overlaysForPage, effectiveFlow,
         flowSegments, contentBoxFor } from './template.js';

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

  pages.forEach((pg, i) => {
    const pageEl = buildPageShell(tpl, scale, mode, pg, i + 1, totalPages);
    const body   = pageEl.querySelector('.rpt-page__body');
    (pg.blocks || []).forEach(block => {
      const bel = renderBlock(block, tpl, { page: i + 1, pages: totalPages });
      if (block && block._anchorTag && bel && bel.dataset) bel.dataset.rptAnchor = block._anchorTag;
      body.appendChild(bel);
    });
    container.appendChild(pageEl);
  });

  // Плавающий слой поверх потока (фон/водяной знак + печать/подпись
  // с привязкой к подписанту). Единственное (с колонтитулами)
  // санкционированное наложение.
  placeFloating(container, tpl, scale);
}

function placeFloating(container, tpl, scale) {
  const list = Array.isArray(tpl.floating) ? tpl.floating : [];
  if (!list.length) return;
  const pageEls = [...container.querySelectorAll('.rpt-page')];
  if (!pageEls.length) return;
  const mk = (pageEl, f, leftPx, topPx) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;pointer-events:none;z-index:5;overflow:hidden';
    el.style.left   = leftPx + 'px';
    el.style.top    = topPx + 'px';
    el.style.width  = ((f.width  || 40) * scale) + 'px';
    el.style.height = ((f.height || 40) * scale) + 'px';
    el.style.opacity = (typeof f.opacity === 'number' ? f.opacity : 1);
    if (f.rotate) el.style.transform = 'rotate(' + f.rotate + 'deg)';
    if (f.type === 'image' && f.content?.src) {
      const im = document.createElement('img');
      im.src = f.content.src;
      im.style.cssText = 'width:100%;height:100%;object-fit:contain';
      im.draggable = false;
      el.appendChild(im);
    } else if (f.type === 'text' && f.content?.text) {
      el.textContent = f.content.text;
      el.style.font  = (f.content.size || 24) + 'pt system-ui,sans-serif';
      el.style.color = f.content.color || '#c8c8c8';
      el.style.whiteSpace = 'nowrap';
    }
    if (getComputedStyle(pageEl).position === 'static') pageEl.style.position = 'relative';
    pageEl.appendChild(el);
  };
  for (const f of list) {
    if (!f) continue;
    if (f.anchor) {
      const aEl = container.querySelector('[data-rpt-anchor="' + f.anchor.role + '"]');
      if (!aEl) continue;
      const pageEl = aEl.closest('.rpt-page');
      if (!pageEl) continue;
      const pr = pageEl.getBoundingClientRect();
      const ar = aEl.getBoundingClientRect();
      mk(pageEl, f, (ar.left - pr.left) + (f.anchor.dx || 0) * scale,
                    (ar.top  - pr.top ) + (f.anchor.dy || 0) * scale);
    } else {
      const sc = f.scope || 'all';
      pageEls.forEach((pageEl, idx) => {
        const p = idx + 1;
        if (sc === 'first' && p !== 1) return;
        if (sc === 'other' && p === 1) return;
        mk(pageEl, f, (f.x || 0) * scale, (f.y || 0) * scale);
      });
    }
  }
}

// ——————————————————————————————————————————————————————————————————————
// Пагинация: считаем грубую высоту каждого блока в мм и заполняем
// страницы по очереди. Этого достаточно для превью и совпадает с тем,
// как считает PDF-экспорт (см. export-pdf.js).
// ——————————————————————————————————————————————————————————————————————
// Пагинация по Word-style сегментам (DS2): каждый сегмент
// (обложка / контент / после sectionBreak) имеет свою геометрию
// (формат/ориентация/поля) и колонтитулы. Возвращает массив
// page-объектов { blocks, geom, chrome, isCover, isFirst }.
// Дефолтный документ (нет обложки/sectionBreak) даёт ОДИН
// контент-сегмент с базовой геометрией → разбиение идентично
// прежнему (нулевая регрессия).
export function paginate(tpl) {
  const out = [];
  const segs = flowSegments(tpl);
  let firstContentDone = false;

  for (const seg of segs) {
    const segIsContent = !seg.isCover;
    let current = [];
    let usedH = 0;
    let segPageIdx = 0;

    // Особый header/footer первой страницы — только на самой первой
    // странице ВСЕГО контента (как в Word: «особая первая страница»).
    const isFirstNow = () => segIsContent && !firstContentDone && segPageIdx === 0;
    const availH = () => contentBoxFor(tpl, seg.geom, seg.chrome, isFirstNow()).height;

    const pushPage = () => {
      out.push({ blocks: current, geom: seg.geom, chrome: seg.chrome,
        isCover: !!seg.isCover, isFirst: isFirstNow() });
      if (segIsContent && !firstContentDone) firstContentDone = true;
      current = [];
      usedH = 0;
      segPageIdx += 1;
    };

    for (const block of (seg.blocks || [])) {
      if (block && block.type === 'pagebreak') { pushPage(); continue; }

      // Таблицы режем построчно по страницам с повтором шапки.
      if (block && block.type === 'table' && (block.rows || []).length) {
        const lay = tableLayout(block, tpl);
        let idx = 0;
        const rows = block.rows;
        while (idx < rows.length) {
          let free = availH() - usedH;
          if (current.length > 0 && free < lay.headH + lay.rowHs[idx] + 2) {
            pushPage();
            free = availH();
          }
          let h = lay.headH;
          const chunk = [];
          while (idx < rows.length && h + lay.rowHs[idx] + 2 <= free) {
            h += lay.rowHs[idx];
            chunk.push(rows[idx]);
            idx += 1;
          }
          if (chunk.length === 0) {
            chunk.push(rows[idx]);
            h += lay.rowHs[idx];
            idx += 1;
          }
          current.push({ ...block, rows: chunk });
          usedH += h + 2;
          if (idx < rows.length) pushPage();
        }
        continue;
      }

      const h = estimateBlockHeight(block, tpl);
      if (usedH + h > availH() && current.length > 0) pushPage();
      current.push(block);
      usedH += h;
    }
    // Завершаем сегмент: пустой контент-сегмент не плодит страницу
    // (кроме случая полностью пустого документа).
    if (current.length || (!seg.isCover && out.length === 0)) pushPage();
    else if (seg.isCover) pushPage();
  }
  if (out.length === 0) {
    out.push({ blocks: [], geom: flowSegments(tpl)[0]?.geom || tpl.page,
      chrome: true, isCover: false, isFirst: true });
  }
  return out;
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
      const lay = tableLayout(block, tpl);
      return lay.headH + lay.rowHs.reduce((a, b) => a + b, 0) + 2;
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

/** Перенос строки по символьной эвристике. Возвращает МАССИВ строк.
 * Используется и пагинатором (для оценки высоты), и PDF-экспортом
 * (для фактической отрисовки) — единая логика → разбиение страниц
 * и реальная высота таблицы СХОДЯТСЯ (нет наезда на колонтитул).
 * Длинные «слова» (шифры без пробелов) жёстко рубятся по perLine,
 * чтобы текст не вылезал за границу ячейки. */
export function wrapCell(text, widthMm, style) {
  // Реалистичная ширина глифа PT Sans ≈ 0.50·size(pt) → в мм
  // 0.1764·size. Делим на 0.90 (×1.1 запас) — переносим чуть раньше,
  // чтобы оценка ≥ факта (нет наезда на колонтитул) и текст НЕ
  // вылезал за границу ячейки. Прежняя эвристика (~3.35 симв/мм при
  // 10pt) была ~6× оптимистична → перенос не срабатывал, текст
  // переполнял колонки и таблица недооценивалась по высоте.
  const sz = style.size || 10;
  const charsPerMm = Math.max(0.1, 1 / (0.196 * sz));
  const perLine    = Math.max(1, Math.floor(widthMm * charsPerMm));
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    let cur = '';
    for (let w of raw.split(/\s+/).filter(Boolean)) {
      while (w.length > perLine) {                 // жёсткий разрыв шифра
        if (cur) { out.push(cur); cur = ''; }
        out.push(w.slice(0, perLine));
        w = w.slice(perLine);
      }
      const add = (cur ? 1 : 0) + w.length;
      if (cur && cur.length + add > perLine) { out.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    out.push(cur);
  }
  return out.length ? out : [''];
}

function wrapLines(text, widthMm, style) {
  return wrapCell(text, widthMm, style).length;
}

/** Единая геометрия таблицы — общая для пагинатора и PDF-рендера.
 * Возвращает { widths[], lineH, pad, headH, rowHs[] } в мм. */
export function tableLayout(block, tpl) {
  const s = tpl.styles.table;
  const boxW = contentBox(tpl, true).width;
  const cols = (block.columns || []).map(c => (typeof c === 'string' ? { text: c } : c));
  const n = cols.length || 1;
  let fixed = 0, freeCnt = 0;
  cols.forEach(c => { if (c.width) fixed += c.width; else freeCnt++; });
  const freeW = Math.max(0, boxW - fixed);
  const widths = cols.map(c => c.width || (freeCnt ? freeW / freeCnt : boxW / n));
  const pad   = s.cellPadding || 1.8;
  const lineH = ptToMm(s.size * 1.32);
  const rowH  = (cells) => {
    let maxLines = 1;
    (cells || []).forEach((cell, i) => {
      const w = (widths[i] || boxW / n) - 2 * pad;
      maxLines = Math.max(maxLines, wrapCell(cell, w, s).length);
    });
    return 2 * pad + maxLines * lineH;
  };
  const headH = rowH(cols.map(c => c.text || ''));
  const rowHs = (block.rows || []).map(r => rowH(r));
  return { widths, lineH, pad, headH, rowHs, cols };
}

// ——————————————————————————————————————————————————————————————————————
// Каркас страницы: лист + поля + колонтитулы + область body + логотип.
// ——————————————————————————————————————————————————————————————————————
function buildPageShell(tpl, scale, mode, pg, pageNum, totalPages) {
  const geom = (pg && pg.geom) || tpl.page;
  const isFirst = !!(pg && pg.isFirst);
  const chromeOn = !pg || pg.chrome !== false;
  const { width, height } = pageSizeMm(geom);
  const m    = geom.margins || tpl.page.margins;
  const hdr  = chromeOn ? (isFirst ? tpl.header.firstPage : tpl.header.otherPages) : { enabled: false };
  const ftr  = chromeOn ? (isFirst ? tpl.footer.firstPage : tpl.footer.otherPages) : { enabled: false };

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
  const cb = contentBoxFor(tpl, geom, chromeOn, isFirst);
  body.style.left   = (cb.x * scale) + 'px';
  body.style.top    = (cb.y * scale) + 'px';
  body.style.width  = (cb.width  * scale) + 'px';
  body.style.height = (cb.height * scale) + 'px';
  if (mode === 'edit') body.classList.add('rpt-body--edit');
  page.appendChild(body);

  // Логотип
  if (chromeOn && tpl.logo && tpl.logo.src && (!tpl.logo.onFirstPageOnly || isFirst)) {
    const img = document.createElement('img');
    img.className = 'rpt-logo';
    img.src = tpl.logo.src;
    img.style.width  = (tpl.logo.width  * scale) + 'px';
    img.style.height = (tpl.logo.height * scale) + 'px';
    positionLogo(img, tpl, scale);
    page.appendChild(img);
  }

  // Overlay-зоны (колонтитул-номер и т.п.) — только при chrome
  const ovs = chromeOn ? overlaysForPage(tpl, isFirst) : [];
  for (const ov of ovs) {
    const el = document.createElement('div');
    el.className = 'rpt-overlay';
    el.style.left   = (ov.x * scale) + 'px';
    el.style.top    = (ov.y * scale) + 'px';
    el.style.width  = (ov.width  * scale) + 'px';
    el.style.height = (ov.height * scale) + 'px';
    if (mode === 'edit') el.classList.add('rpt-overlay--edit');
    if (ov.type === 'image') {
      el.style.overflow = 'hidden';
      if (ov.content?.src) {
        const im = document.createElement('img');
        im.src = ov.content.src;
        im.style.width = '100%';
        im.style.height = '100%';
        im.style.objectFit = ov.content.fit === 'fill' ? 'fill' : 'contain';
        im.draggable = false;
        el.appendChild(im);
      } else if (mode === 'edit') {
        el.style.border = '1px dashed #b0b6c2';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.font = '10px system-ui';
        el.style.color = '#9aa1ad';
        el.textContent = '🖼 нет изображения';
      }
      page.appendChild(el);
      continue;
    }
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
