// ======================================================================
// shared/report/export-pdf.js
// Экспорт шаблона отчёта в PDF через jsPDF (UMD-сборка с CDN).
// Библиотека загружается лениво при первом вызове — страницы
// подпрограмм не тянут её, если пользователь не нажал «скачать PDF».
//
// Кириллица: встроенные шрифты jsPDF (Helvetica/Times/Courier) содержат
// только Latin-1 — русские буквы в них рисуются как кракозябры. Поэтому
// при первом экспорте мы дополнительно подгружаем TTF шрифты с Google
// Fonts (PT Sans Regular + Bold — кириллический sans-serif) и
// регистрируем их в каждом jsPDF-документе через addFileToVFS /
// addFont. Стили шаблона (Helvetica/Times/Courier) при этом игнорируются
// — в PDF используется единый PT Sans, чтобы кириллица отображалась
// корректно во всех случаях. Жирность (bold) поддерживается через
// второй TTF.
// ======================================================================

import { pageSizeMm, contentBox, substitute, overlaysForPage } from './template.js';
import { paginate, estimateBlockHeight }       from './preview.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

// PT Sans, Regular + Bold (кириллический сабсет). TTF-файлы лежат в
// самом репозитории: shared/report/fonts/. Это даёт стабильный
// оффлайн-работающий путь и исключает зависимость от актуальности
// хэшей Google Fonts. Размер ~130 КБ на оба файла — приемлемо.
// Лицензия: SIL Open Font License, Copyright © ParaType.
const FONT_REGULAR_URL = new URL('./fonts/PTSans-Regular.ttf', import.meta.url).href;
const FONT_BOLD_URL    = new URL('./fonts/PTSans-Bold.ttf',    import.meta.url).href;
const RPT_FONT_FAMILY  = 'rpt-sans';

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

// Кэш base64-версий TTF. Загружаем один раз за время жизни страницы.
let _fontPromise = null;
async function loadCyrillicFont() {
  if (_fontPromise) return _fontPromise;
  _fontPromise = (async () => {
    try {
      const [regBuf, boldBuf] = await Promise.all([
        fetch(FONT_REGULAR_URL).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' — PT Sans Regular');
          return r.arrayBuffer();
        }),
        fetch(FONT_BOLD_URL).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' — PT Sans Bold');
          return r.arrayBuffer();
        }),
      ]);
      return { regular: bufferToBase64(regBuf), bold: bufferToBase64(boldBuf) };
    } catch (e) {
      _fontPromise = null;  // позволить повтор при следующем вызове
      throw new Error('Не удалось загрузить кириллический шрифт: ' + e.message);
    }
  })();
  return _fontPromise;
}

// Chunked base64 — обычный btoa(String.fromCharCode(...arr)) ломается
// на больших TTF из-за лимита аргументов apply.
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

function registerCyrillicFont(doc, fontCache) {
  doc.addFileToVFS('rpt-sans-regular.ttf', fontCache.regular);
  doc.addFont('rpt-sans-regular.ttf', RPT_FONT_FAMILY, 'normal');
  doc.addFileToVFS('rpt-sans-bold.ttf', fontCache.bold);
  doc.addFont('rpt-sans-bold.ttf', RPT_FONT_FAMILY, 'bold');
}

/**
 * Сгенерировать PDF-документ из шаблона. Возвращает jspdf doc instance.
 * Используется в exportPDF (save) и previewPDF (blob URL).
 */
async function buildPdfDoc(tpl) {
  const JsPDF = await loadJsPDF();
  const fontCache = await loadCyrillicFont();
  const { width, height } = pageSizeMm(tpl.page);
  const doc = new JsPDF({
    unit: 'mm',
    format: [width, height],
    orientation: width > height ? 'l' : 'p',
    compress: true,
  });

  // Регистрируем кириллический шрифт в этом документе
  registerCyrillicFont(doc, fontCache);

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
    drawOverlays(doc, tpl, isFirst, i + 1, total);
  });
  return doc;
}

/** Главный экспорт. filename — имя файла (с .pdf или без). */
export async function exportPDF(tpl, filename) {
  const doc = await buildPdfDoc(tpl);
  const name = filename || (tpl.meta && tpl.meta.title) || 'report';
  doc.save(name.endsWith('.pdf') ? name : name + '.pdf');
}

/**
 * v0.60.325 (по запросу Пользователя 2026-05-06: «перед экспортом в PDF
 * не плохо было бы показать превью пользователю, чтобы он не выводил
 * не завершённый документ или документ с неправильным шаблоном»):
 * Показывает PDF preview в modal-диалоге. Кнопки:
 *   • «💾 Скачать PDF» — обычный save
 *   • «✕ Закрыть» — отменить
 * Возвращает Promise, который резолвится 'saved' / 'cancelled'.
 */
export async function previewPDF(tpl, filename) {
  const doc = await buildPdfDoc(tpl);
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const name = filename || (tpl.meta && tpl.meta.title) || 'report';
  const fileName = name.endsWith('.pdf') ? name : name + '.pdf';
  const totalPages = doc.internal?.getNumberOfPages?.() || 1;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;font:13px/1.4 system-ui,sans-serif';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:8px;box-shadow:0 16px 48px rgba(0,0,0,0.35);width:min(1200px,96vw);height:min(900px,92vh);display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:20px">📄</span>
          <div style="flex:1;min-width:200px">
            <div style="font-weight:700;font-size:15px;color:#0f172a">Превью PDF</div>
            <div style="font-size:11.5px;color:#64748b">${(tpl.meta?.title || 'Документ')} · ${totalPages} стр. · файл: <code>${fileName}</code></div>
          </div>
          <button type="button" id="rs-pdf-save" style="padding:8px 16px;background:#16a34a;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit;font-weight:600">💾 Скачать PDF</button>
          <button type="button" id="rs-pdf-close" style="padding:8px 14px;background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:5px;cursor:pointer;font:inherit" title="Отменить — документ не будет сохранён">✕ Закрыть</button>
        </div>
        <iframe src="${blobUrl}" style="flex:1;border:0;width:100%;background:#525659"></iframe>
        <div style="padding:8px 16px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">
          ⚠ Проверьте перед скачиванием: правильный шаблон, все блоки заполнены, нет «Lorem ipsum» / placeholder'ов, шапка/подвал корректны.
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      overlay.remove();
      resolve(result);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup('cancelled'); });
    overlay.querySelector('#rs-pdf-close').addEventListener('click', () => cleanup('cancelled'));
    overlay.querySelector('#rs-pdf-save').addEventListener('click', () => {
      doc.save(fileName);
      cleanup('saved');
    });
  });
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

function drawOverlays(doc, tpl, isFirst, pageNum, total) {
  const ovs = overlaysForPage(tpl, isFirst);
  const ctx = { page: pageNum, pages: total };
  for (const ov of ovs) {
    const s = tpl.styles[ov.content?.styleRef || 'body'] || tpl.styles.body;
    // Через общий setFont — гарантированно RPT_FONT_FAMILY с кириллицей
    setFont(doc, s);
    const text = substitute(ov.content?.text || '', tpl, ctx);
    const lines = doc.splitTextToSize(text, Math.max(1, ov.width));
    const lineH = s.size * s.lineHeight * 0.3528;
    const align = ov.content?.align || 'left';
    let x = ov.x;
    if (align === 'center') x = ov.x + ov.width / 2;
    if (align === 'right')  x = ov.x + ov.width;
    let y = ov.y + lineH * 0.85;
    for (const line of lines) {
      if (y - lineH > ov.y + ov.height) break; // не вылезаем за зону
      doc.text(line, x, y, { align: align === 'left' ? undefined : align });
      y += lineH;
    }
  }
}

function drawLogo(doc, tpl, isFirst) {
  const l = tpl.logo;
  if (!l || !l.src) return;
  if (l.onFirstPageOnly && !isFirst) return;
  const m = tpl.page.margins;
  const { width, height } = pageSizeMm(tpl.page);

  // Абсолютные координаты из canvas-редактора имеют приоритет над legacy
  // position ('header-left' и т.п.), которая оставлена для совместимости.
  let x, y;
  if (typeof l.x === 'number' && typeof l.y === 'number') {
    x = l.x;
    y = l.y;
  } else {
    const pos = l.position || 'header-left';
    const isHeader = pos.startsWith('header');
    y = isHeader ? m.top : (height - m.bottom - l.height);
    x = m.left;
    if (pos.endsWith('center')) x = (width - l.width) / 2;
    if (pos.endsWith('right'))  x = width - m.right - l.width;
  }
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
  // Встроенный PT Sans поддерживает только 'normal' и 'bold'.
  // Курсив (italic) не поддерживается — графически он почти не
  // используется в инженерных отчётах, а для caption достаточно
  // изменения цвета/размера. Имя шрифта из стилей шаблона
  // (Helvetica/Times/Courier) игнорируется — всегда PT Sans.
  const style = s.bold ? 'bold' : 'normal';
  doc.setFont(RPT_FONT_FAMILY, style);
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
