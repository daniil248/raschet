// ======================================================================
// shared/report/export-pdf.js
// Экспорт шаблона отчёта в PDF через jsPDF (UMD-сборка с CDN).
// Библиотека загружается лениво при первом вызове — страницы
// подпрограмм не тянут её, если пользователь не нажал «скачать PDF».
// ======================================================================

import { pageSizeMm, contentBox, substitute } from './template.js';
import { paginate, estimateBlockHeight }       from './preview.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

let _jspdfPromise = null;
function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfPromise) return _jspdfPromise;
  _jspdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.onload  = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Не удалось загрузить jsPDF с CDN'));
    document.head.appendChild(s);
  });
  return _jspdfPromise;
}

/** Главный экспорт. filename — имя файла (с .pdf или без). */
export async function exportPDF(tpl, filename) {
  const JsPDF = await loadJsPDF();
  const { width, height } = pageSizeMm(tpl.page);
  const doc = new JsPDF({
    unit: 'mm',
    format: [width, height],
    orientation: width > height ? 'l' : 'p',
    compress: true,
  });

  // Метаданные документа
  if (tpl.meta) {
    if (tpl.meta.title)   doc.setProperties({ title:   tpl.meta.title });
    if (tpl.meta.author)  doc.setProperties({ author:  tpl.meta.author });
    if (tpl.meta.subject) doc.setProperties({ subject: tpl.meta.subject });
  }

  const pages = paginate(tpl);
  const total = Math.max(1, pages.length);

  pages.forEach((pageBlocks, i) => {
    if (i > 0) doc.addPage([width, height], width > height ? 'l' : 'p');
    const isFirst = i === 0;
    drawHeaderFooter(doc, tpl, isFirst, i + 1, total);
    drawLogo(doc, tpl, isFirst);
    drawBody(doc, tpl, isFirst, pageBlocks, { page: i + 1, pages: total });
  });

  const name = filename || (tpl.meta && tpl.meta.title) || 'report';
  doc.save(name.endsWith('.pdf') ? name : name + '.pdf');
}

// ——————————————————————————————————————————————————————————————————————
// Колонтитулы и логотип
// ——————————————————————————————————————————————————————————————————————
function drawHeaderFooter(doc, tpl, isFirst, pageNum, total) {
  const m = tpl.page.margins;
  const { width, height } = pageSizeMm(tpl.page);

  const hdr = isFirst ? tpl.header.firstPage : tpl.header.otherPages;
  if (hdr && hdr.enabled) {
    drawBlocks(doc, tpl, hdr.blocks || [], {
      x: m.left, y: m.top,
      width: width - m.left - m.right,
      height: hdr.height,
    }, { page: pageNum, pages: total });
  }

  const ftr = isFirst ? tpl.footer.firstPage : tpl.footer.otherPages;
  if (ftr && ftr.enabled) {
    drawBlocks(doc, tpl, ftr.blocks || [], {
      x: m.left, y: height - m.bottom - ftr.height,
      width: width - m.left - m.right,
      height: ftr.height,
    }, { page: pageNum, pages: total });
  }
}

function drawLogo(doc, tpl, isFirst) {
  const l = tpl.logo;
  if (!l || !l.src) return;
  if (l.onFirstPageOnly && !isFirst) return;
  const m = tpl.page.margins;
  const { width, height } = pageSizeMm(tpl.page);
  const isHeader = (l.position || 'header-left').startsWith('header');
  const y = isHeader ? m.top : (height - m.bottom - l.height);
  let x = m.left;
  if (l.position.endsWith('center')) x = (width - l.width) / 2;
  if (l.position.endsWith('right'))  x = width - m.right - l.width;
  try {
    const fmt = /^data:image\/(png|jpeg|jpg)/i.exec(l.src);
    const type = fmt ? fmt[1].toUpperCase().replace('JPG', 'JPEG') : 'PNG';
    doc.addImage(l.src, type, x, y, l.width, l.height);
  } catch (e) { /* ignore */ }
}

// ——————————————————————————————————————————————————————————————————————
// Основное содержимое страницы
// ——————————————————————————————————————————————————————————————————————
function drawBody(doc, tpl, isFirst, blocks, ctx) {
  const box = contentBox(tpl, isFirst);
  drawBlocks(doc, tpl, blocks, box, ctx);
}

function drawBlocks(doc, tpl, blocks, box, ctx) {
  let y = box.y;
  for (const block of blocks) {
    y = drawBlock(doc, tpl, block, { ...box, y }, ctx);
  }
}

function drawBlock(doc, tpl, block, box, ctx) {
  const S = tpl.styles;
  let y = box.y;

  switch (block.type) {
    case 'spacer':
      return y + (Number(block.height) || 0);

    case 'hr': {
      const t = block.thickness || 0.3;
      doc.setDrawColor(block.color || '#c0c6d2');
      doc.setLineWidth(t);
      doc.line(box.x, y + 1, box.x + box.width, y + 1);
      return y + t + 1.5;
    }

    case 'heading': {
      const s = S['h' + (block.level || 1)] || S.h1;
      y += (s.spaceBefore || 0);
      y = drawText(doc, substitute(block.text, tpl, ctx), { ...box, y }, s, block.align);
      return y + (s.spaceAfter || 0);
    }

    case 'paragraph': {
      const s = S[block.style || 'body'] || S.body;
      y += (s.spaceBefore || 0);
      y = drawText(doc, substitute(block.text, tpl, ctx), { ...box, y }, s, block.align);
      return y + (s.spaceAfter || 0);
    }

    case 'list': {
      const s = S.list;
      y += (s.spaceBefore || 0);
      const indent = s.indent || 5;
      const bullet = s.bullet || '•';
      for (const item of (block.items || [])) {
        const bullettext = block.ordered ? ((block.items.indexOf(item) + 1) + '.') : bullet;
        setFont(doc, s);
        doc.text(bullettext, box.x, y + ptToMm(s.size));
        const itemBox = { x: box.x + indent, y, width: box.width - indent, height: 0 };
        y = drawText(doc, substitute(item, tpl, ctx), itemBox, s);
        y += (s.spaceAfter || 0);
      }
      return y;
    }

    case 'table': {
      return drawTable(doc, tpl, block, box, ctx);
    }

    case 'image': {
      try {
        const w = block.width  || 30;
        const h = block.height || 20;
        let x = box.x;
        if (block.align === 'center') x = box.x + (box.width - w) / 2;
        if (block.align === 'right')  x = box.x + (box.width - w);
        const fmt = /^data:image\/(png|jpeg|jpg)/i.exec(block.src || '');
        const type = fmt ? fmt[1].toUpperCase().replace('JPG', 'JPEG') : 'PNG';
        doc.addImage(block.src, type, x, y, w, h);
        return y + h + 2;
      } catch (e) { return y + 5; }
    }

    case 'pagebreak':
      return y;

    case 'custom':
      // Свободный блок: если render — функция с подписью (doc, box, tpl, ctx),
      // ей передаётся PDF-контекст. Если нет — пропускаем.
      if (typeof block.render === 'function' && block.render.length >= 2) {
        try { block.render(doc, { ...box, y }, tpl, ctx); }
        catch (e) { /* ignore */ }
      }
      return y + (Number(block.estimatedHeight) || 10);
  }
  return y;
}

// ——————————————————————————————————————————————————————————————————————
// Текст и таблица
// ——————————————————————————————————————————————————————————————————————
function setFont(doc, s) {
  const style = s.bold && s.italic ? 'bolditalic' : s.bold ? 'bold' : s.italic ? 'italic' : 'normal';
  // jsPDF знает 'helvetica' | 'times' | 'courier'
  doc.setFont((s.font || 'Helvetica').toLowerCase(), style);
  doc.setFontSize(s.size);
  doc.setTextColor(s.color || '#222222');
}

function drawText(doc, text, box, s, alignOverride) {
  setFont(doc, s);
  const lines = doc.splitTextToSize(text || '', box.width);
  const lineH = ptToMm(s.size * s.lineHeight);
  const align = alignOverride || s.align || 'left';
  let x = box.x;
  if (align === 'center') x = box.x + box.width / 2;
  if (align === 'right')  x = box.x + box.width;
  let y = box.y + ptToMm(s.size);  // baseline первой строки
  for (const line of lines) {
    doc.text(line, x, y, { align: align === 'left' ? undefined : align });
    y += lineH;
  }
  return y - ptToMm(s.size) + (lineH - ptToMm(s.size));
}

function drawTable(doc, tpl, block, box, ctx) {
  const s = tpl.styles.table;
  const cols = (block.columns || []).map(c => (typeof c === 'string' ? { text: c } : c));
  const n = cols.length || 1;
  // Ширины: если задано width — используем; остаток делим поровну
  let fixed = 0, freeCnt = 0;
  cols.forEach(c => { if (c.width) fixed += c.width; else freeCnt++; });
  const freeW = Math.max(0, box.width - fixed);
  const widths = cols.map(c => c.width || (freeCnt ? freeW / freeCnt : box.width / n));

  const pad = s.cellPadding || 1.8;
  const rowHBase = ptToMm(s.size * 1.4) + 2 * pad;

  setFont(doc, { font: s.font, size: s.size, color: s.color,
    bold: s.headBold, italic: false });

  let y = box.y;
  let x = box.x;

  // Заголовок
  doc.setFillColor(s.headBg || '#f1f3f7');
  doc.setDrawColor(s.borderColor || '#c0c6d2');
  doc.setLineWidth(0.2);
  cols.forEach((c, i) => {
    doc.rect(x, y, widths[i], rowHBase, 'FD');
    doc.text(String(c.text || ''), x + pad, y + pad + ptToMm(s.size), {
      align: c.align === 'center' ? 'center' : c.align === 'right' ? 'right' : undefined,
    });
    x += widths[i];
  });
  y += rowHBase;

  // Строки
  setFont(doc, { font: s.font, size: s.size, color: s.color, bold: false, italic: false });
  (block.rows || []).forEach(row => {
    x = box.x;
    row.forEach((cell, i) => {
      doc.setDrawColor(s.borderColor || '#c0c6d2');
      doc.rect(x, y, widths[i], rowHBase);
      const c = cols[i] || {};
      doc.text(substitute(cell, tpl, ctx), x + pad, y + pad + ptToMm(s.size), {
        align: c.align === 'center' ? 'center' : c.align === 'right' ? 'right' : undefined,
      });
      x += widths[i];
    });
    y += rowHBase;
  });

  return y + 2;
}

function ptToMm(pt) { return pt * 0.3528; }
