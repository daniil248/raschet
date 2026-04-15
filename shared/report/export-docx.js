// ======================================================================
// shared/report/export-docx.js
// Экспорт шаблона отчёта в DOCX через docx.js (UMD-сборка с CDN).
// Библиотека ~300 КБ, поэтому грузится лениво при первом вызове.
//
// Маппинг сущностей:
//   tpl.page.margins    → SectionProperties.page.margin
//   tpl.header          → Section.headers (first/default)
//   tpl.footer          → Section.footers (first/default)
//   tpl.styles.h1/h2/h3 → Paragraph.heading + inline run style
//   tpl.styles.body     → обычный Paragraph
//   tpl.styles.list     → Paragraph с нумерацией/буллетом
//   tpl.styles.table    → Table с границами и фоном заголовка
//   tpl.logo            → ImageRun в соответствующем колонтитуле
// ======================================================================

import { pageSizeMm, substitute } from './template.js';

const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js';
const FILE_SAVER_URL = 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js';

let _docxPromise = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (_docxPromise) return _docxPromise;
  _docxPromise = Promise.all([
    loadScript(DOCX_URL),
    loadScript(FILE_SAVER_URL),
  ]).then(() => window.docx);
  return _docxPromise;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

// Перевод мм → twips (1 mm = 56.7 twips). Точный коэффициент 567/10.
const MM_TO_TWIP = 56.7;
const mm2tw = mm => Math.round(mm * MM_TO_TWIP);
// Перевод мм → EMU (для картинок). 1 mm = 36000 EMU.
const mm2emu = mm => Math.round(mm * 36000);

/** Главный экспорт. */
export async function exportDOCX(tpl, filename) {
  const D = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, Table, TableRow, TableCell, WidthType,
    BorderStyle, ShadingType, Header, Footer, PageOrientation,
    ImageRun, LevelFormat, PageBreak,
  } = D;

  const { width, height } = pageSizeMm(tpl.page);
  const m = tpl.page.margins;

  const section = {
    properties: {
      page: {
        size: {
          width:  mm2tw(width),
          height: mm2tw(height),
          orientation: tpl.page.orientation === 'landscape'
            ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top:    mm2tw(m.top),
          right:  mm2tw(m.right),
          bottom: mm2tw(m.bottom),
          left:   mm2tw(m.left),
          header: mm2tw(Math.max(5, m.top - (tpl.header.otherPages.height || 0))),
          footer: mm2tw(Math.max(5, m.bottom - (tpl.footer.otherPages.height || 0))),
        },
        titlePage: true,  // отдельные колонтитулы для первой страницы
      },
    },
    headers: {
      first:   tpl.header.firstPage.enabled  ? new Header({ children: blocksToDocx(tpl.header.firstPage.blocks,  tpl, D, { first: true })  }) : undefined,
      default: tpl.header.otherPages.enabled ? new Header({ children: blocksToDocx(tpl.header.otherPages.blocks, tpl, D, { first: false }) }) : undefined,
    },
    footers: {
      first:   tpl.footer.firstPage.enabled  ? new Footer({ children: blocksToDocx(tpl.footer.firstPage.blocks,  tpl, D, { first: true,  footer: true }) }) : undefined,
      default: tpl.footer.otherPages.enabled ? new Footer({ children: blocksToDocx(tpl.footer.otherPages.blocks, tpl, D, { first: false, footer: true }) }) : undefined,
    },
    children: blocksToDocx(tpl.content || [], tpl, D, {}),
  };

  // Overlay-зоны: DOCX не поддерживает свободное позиционирование
  // текста прямо в теле секции, поэтому приближаем — верхние overlays
  // дописываем в header, нижние в footer. Точные координаты не
  // сохраняются (это задокументированное ограничение DOCX-экспорта).
  injectOverlays(section, tpl, D, height);

  // Если есть логотип — ставим его первым ребёнком соответствующего колонтитула
  if (tpl.logo && tpl.logo.src) {
    injectLogo(section, tpl, D);
  }

  const doc = new Document({
    creator: tpl.meta.author || '',
    title:   tpl.meta.title  || 'Отчёт',
    subject: tpl.meta.subject || '',
    numbering: {
      config: [{
        reference: 'rpt-bullet',
        levels: [{
          level: 0, format: LevelFormat.BULLET,
          text: tpl.styles.list.bullet || '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: mm2tw(tpl.styles.list.indent + 3), hanging: mm2tw(tpl.styles.list.indent) } } },
        }],
      }, {
        reference: 'rpt-numbered',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: mm2tw(tpl.styles.list.indent + 3), hanging: mm2tw(tpl.styles.list.indent) } } },
        }],
      }],
    },
    sections: [section],
  });

  const blob = await Packer.toBlob(doc);
  const name = filename || tpl.meta.title || 'report';
  window.saveAs(blob, name.endsWith('.docx') ? name : name + '.docx');
}

// ——————————————————————————————————————————————————————————————————————
// Преобразование блоков в элементы docx
// ——————————————————————————————————————————————————————————————————————
function blocksToDocx(blocks, tpl, D, opts) {
  const out = [];
  for (const block of (blocks || [])) {
    const items = blockToDocx(block, tpl, D, opts);
    if (Array.isArray(items)) out.push(...items);
    else if (items) out.push(items);
  }
  // docx не допускает пустой массив children в headers/footers
  if (out.length === 0) {
    out.push(new D.Paragraph({ children: [] }));
  }
  return out;
}

function blockToDocx(block, tpl, D, opts) {
  const {
    Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
  } = D;
  const S = tpl.styles;
  const ctx = { page: '', pages: '' };  // нумерацию пишет сам Word

  switch (block.type) {
    case 'spacer':
      return new Paragraph({
        children: [new TextRun({ text: '' })],
        spacing: { before: mm2tw(block.height || 3) * 20 / MM_TO_TWIP, after: 0 },
      });

    case 'pagebreak':
      return new Paragraph({ children: [new PageBreak()] });

    case 'hr':
      return new Paragraph({
        border: { bottom: { color: (block.color || '#c0c6d2').replace('#',''),
          size: Math.max(1, Math.round((block.thickness || 0.3) * 8)),
          style: BorderStyle.SINGLE, space: 1 } },
      });

    case 'heading': {
      const level = block.level || 1;
      const s = S['h' + level] || S.h1;
      const headingLevel = level === 1 ? HeadingLevel.HEADING_1
                        : level === 2 ? HeadingLevel.HEADING_2
                        :               HeadingLevel.HEADING_3;
      return new Paragraph({
        heading: headingLevel,
        alignment: mapAlign(block.align || s.align, AlignmentType),
        spacing: { before: mmToDocxSpacing(s.spaceBefore), after: mmToDocxSpacing(s.spaceAfter) },
        children: [ runFrom(substitute(block.text, tpl, ctx), s, D) ],
      });
    }

    case 'paragraph': {
      const s = S[block.style || 'body'] || S.body;
      return new Paragraph({
        alignment: mapAlign(block.align || s.align, AlignmentType),
        spacing: { before: mmToDocxSpacing(s.spaceBefore), after: mmToDocxSpacing(s.spaceAfter),
                   line: Math.round(s.lineHeight * 240) },
        children: textToRuns(substitute(block.text, tpl, ctx), s, D, tpl, opts),
      });
    }

    case 'list': {
      const s = S.list;
      return (block.items || []).map(item => new Paragraph({
        numbering: { reference: block.ordered ? 'rpt-numbered' : 'rpt-bullet', level: 0 },
        spacing: { before: 0, after: mmToDocxSpacing(s.spaceAfter) },
        children: [ runFrom(substitute(item, tpl, ctx), s, D) ],
      }));
    }

    case 'table': {
      const s = S.table;
      const cols = (block.columns || []).map(c => typeof c === 'string' ? { text: c } : c);
      const border = {
        top:    { style: BorderStyle.SINGLE, size: 4, color: (s.borderColor || '#c0c6d2').replace('#','') },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: (s.borderColor || '#c0c6d2').replace('#','') },
        left:   { style: BorderStyle.SINGLE, size: 4, color: (s.borderColor || '#c0c6d2').replace('#','') },
        right:  { style: BorderStyle.SINGLE, size: 4, color: (s.borderColor || '#c0c6d2').replace('#','') },
      };
      const mkCell = (txt, isHead, align) => new TableCell({
        borders: border,
        shading: isHead ? { type: ShadingType.CLEAR, fill: (s.headBg || '#f1f3f7').replace('#','') } : undefined,
        children: [ new Paragraph({
          alignment: mapAlign(align, AlignmentType),
          children: [ new TextRun({
            text: String(txt ?? ''),
            bold: isHead ? !!s.headBold : false,
            size: Math.round((s.size || 10) * 2),
            font: s.font || 'Helvetica',
            color: (s.color || '#222222').replace('#',''),
          }) ],
        }) ],
      });
      const head = new TableRow({
        tableHeader: true,
        children: cols.map(c => mkCell(c.text, true, c.align)),
      });
      const body = (block.rows || []).map(row => new TableRow({
        children: row.map((cell, i) => mkCell(substitute(cell, tpl, ctx), false, cols[i] && cols[i].align)),
      }));
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [head, ...body],
      });
    }

    case 'image': {
      if (!block.src) return new Paragraph({ children: [] });
      const bytes = dataUrlToUint8(block.src);
      if (!bytes) return new Paragraph({ children: [] });
      return new Paragraph({
        alignment: mapAlign(block.align, AlignmentType),
        children: [ new D.ImageRun({
          data: bytes,
          transformation: { width: block.width || 30, height: block.height || 20 },
        }) ],
      });
    }

    case 'custom': {
      // docx-рендер для custom блоков: блок может отдавать docx-элементы
      // через block.docx = (tpl, D) => [Paragraph|Table|...]
      if (typeof block.docx === 'function') {
        try { return block.docx(tpl, D) || new Paragraph({ children: [] }); }
        catch (e) { return new Paragraph({ children: [ new TextRun({ text: '[custom error: ' + e.message + ']' }) ] }); }
      }
      return new Paragraph({ children: [] });
    }
  }
  return new Paragraph({ children: [] });
}

function runFrom(text, s, D) {
  return new D.TextRun({
    text: String(text || ''),
    bold:   !!s.bold,
    italics: !!s.italic,
    size:   Math.round((s.size || 11) * 2), // docx size в half-pt
    font:   s.font || 'Helvetica',
    color:  (s.color || '#222222').replace('#',''),
  });
}

/** Разбор плейсхолдеров {{page}}/{{pages}} в колонтитулах: они должны
 * попадать в DOCX как PageNumber/NumberOfPages run, иначе Word покажет
 * пустой текст. Остальной текст — обычные run'ы. */
function textToRuns(text, s, D, tpl, opts) {
  const { TextRun, PageNumber } = D;
  const out = [];
  const parts = String(text || '').split(/(\{\{[\w.]+\}\})/g);
  for (const p of parts) {
    if (!p) continue;
    const m = /^\{\{(.+)\}\}$/.exec(p);
    if (m) {
      const key = m[1].trim();
      if (key === 'page') {
        out.push(new TextRun({ children: [PageNumber.CURRENT], ...runOpts(s) }));
        continue;
      }
      if (key === 'pages') {
        out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], ...runOpts(s) }));
        continue;
      }
    }
    out.push(runFrom(p.replace(/\{\{.+?\}\}/g, (mm) => {
      // статическая подстановка: берём из meta/date
      return substitute(mm, tpl, {});
    }), s, D));
  }
  return out.length ? out : [runFrom('', s, D)];
}

function runOpts(s) {
  return {
    bold:   !!s.bold,
    italics: !!s.italic,
    size:   Math.round((s.size || 11) * 2),
    font:   s.font || 'Helvetica',
    color:  (s.color || '#222222').replace('#',''),
  };
}

function mapAlign(a, A) {
  if (a === 'center') return A.CENTER;
  if (a === 'right')  return A.RIGHT;
  if (a === 'justify') return A.JUSTIFIED;
  return A.LEFT;
}

function mmToDocxSpacing(mm) {
  // docx spacing в 1/20 pt. 1 мм ≈ 2.835 pt ≈ 56.7/20 units.
  return Math.round((mm || 0) * 56.7);
}

function dataUrlToUint8(dataUrl) {
  try {
    const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    const bin = atob(m[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch (e) { return null; }
}

function injectOverlays(section, tpl, D, pageHeightMm) {
  const ovs = Array.isArray(tpl.overlays) ? tpl.overlays : [];
  if (ovs.length === 0) return;
  const top = [];    // { ov, scope }
  const bot = [];
  for (const ov of ovs) {
    if (!ov || ov.type !== 'text') continue;
    const target = (ov.y + ov.height / 2) < pageHeightMm / 2 ? top : bot;
    target.push(ov);
  }
  const mkPara = (ov) => {
    const s = tpl.styles[ov.content?.styleRef || 'body'] || tpl.styles.body;
    const align = ov.content?.align === 'center' ? D.AlignmentType.CENTER
               : ov.content?.align === 'right'  ? D.AlignmentType.RIGHT
               :                                    D.AlignmentType.LEFT;
    return new D.Paragraph({
      alignment: align,
      children: [ new D.TextRun({
        text: String(ov.content?.text || ''),
        bold:   !!s.bold,
        italics: !!s.italic,
        size:   Math.round((s.size || 11) * 2),
        font:   s.font || 'Helvetica',
        color:  (s.color || '#222222').replace('#',''),
      })],
    });
  };
  const addTo = (header, items, scope) => {
    const filtered = items.filter(o => o.scope === scope || o.scope === 'all');
    if (!filtered.length || !header) return;
    for (const ov of filtered) header.options.children.push(mkPara(ov));
  };
  addTo(section.headers.first,   top, 'first');
  addTo(section.headers.default, top, 'other');
  addTo(section.footers.first,   bot, 'first');
  addTo(section.footers.default, bot, 'other');
}

function injectLogo(section, tpl, D) {
  const l = tpl.logo;
  const bytes = dataUrlToUint8(l.src);
  if (!bytes) return;
  const makePara = () => new D.Paragraph({
    alignment: l.position.endsWith('center') ? D.AlignmentType.CENTER
            : l.position.endsWith('right')  ? D.AlignmentType.RIGHT
            :                                  D.AlignmentType.LEFT,
    children: [ new D.ImageRun({
      data: bytes,
      transformation: { width: l.width, height: l.height },
    }) ],
  });
  const isHeader = (l.position || 'header-left').startsWith('header');
  if (isHeader) {
    if (section.headers.first)   section.headers.first.options.children.unshift(makePara());
    if (section.headers.default && !l.onFirstPageOnly)
      section.headers.default.options.children.unshift(makePara());
  } else {
    if (section.footers.first)   section.footers.first.options.children.unshift(makePara());
    if (section.footers.default && !l.onFirstPageOnly)
      section.footers.default.options.children.unshift(makePara());
  }
}
