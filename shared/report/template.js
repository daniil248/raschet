// ======================================================================
// shared/report/template.js
// Структура шаблона отчёта, значения по умолчанию, валидация.
//
// Шаблон — это чистый JSON-объект. Его можно сохранять в localStorage,
// передавать между подпрограммами, редактировать в UI (editor.js) и
// рендерить в HTML / PDF / DOCX (см. index.js).
//
// Единицы измерения:
//   — все размеры (страница, поля, колонтитулы, логотип) в МИЛЛИМЕТРАХ
//   — размер шрифта в ПУНКТАХ (pt), как в Word / PDF
//   — цвета — hex-строка '#rrggbb'
// ======================================================================

// ——— размеры листов по ISO 216 и Letter (portrait, в мм) ———
export const PAGE_SIZES = {
  A3:     { width: 297, height: 420 },
  A4:     { width: 210, height: 297 },
  A5:     { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal:  { width: 215.9, height: 355.6 },
};

// ——— поддерживаемые шрифты (имена должны совпадать с теми, что доступны
// и в jsPDF, и в docx; для jsPDF это встроенные PostScript-семейства) ———
export const FONT_FAMILIES = ['Helvetica', 'Times', 'Courier'];

/** Пустой (но валидный) шаблон отчёта. */
export function defaultTemplate() {
  return {
    // ——— метаданные ———
    meta: {
      title:   'Отчёт',
      author:  '',
      subject: '',
      // произвольные поля, которые подпрограмма может использовать
      // в заголовках/колонтитулах через плейсхолдеры {{meta.foo}}
      custom:  {},
    },

    // ——— страница ———
    page: {
      format:      'A4',              // ключ из PAGE_SIZES или 'Custom'
      width:       210,               // используется при format === 'Custom'
      height:      297,
      orientation: 'portrait',        // 'portrait' | 'landscape'
      margins:     { top: 20, right: 15, bottom: 20, left: 20 },
    },

    // ——— логотип (опционально) ———
    logo: {
      src:      null,                  // data URL (PNG/JPEG) или null
      position: 'header-left',         // 'header-left' | 'header-center' | 'header-right'
                                       // | 'footer-left' | 'footer-center' | 'footer-right'
      width:    30,                    // мм
      height:   15,                    // мм
      onFirstPageOnly: false,
    },

    // ——— колонтитулы ———
    // Отдельно для первой страницы и для всех последующих. Каждый колонтитул
    // содержит массив блоков (того же формата, что и основной content).
    // height — зарезервированная высота области в мм.
    header: {
      firstPage:  { enabled: true,  height: 15, blocks: [] },
      otherPages: { enabled: true,  height: 12, blocks: [] },
    },
    footer: {
      firstPage:  { enabled: true,  height: 12, blocks: [
        { type: 'paragraph', align: 'center', style: 'caption',
          text: '{{meta.title}} — стр. {{page}} из {{pages}}' },
      ]},
      otherPages: { enabled: true,  height: 12, blocks: [
        { type: 'paragraph', align: 'center', style: 'caption',
          text: 'стр. {{page}} из {{pages}}' },
      ]},
    },

    // ——— стили текстовых блоков ———
    styles: {
      body: {
        font: 'Helvetica', size: 11, bold: false, italic: false,
        color: '#222222', lineHeight: 1.35,
        spaceBefore: 0, spaceAfter: 2, align: 'left',
      },
      h1: {
        font: 'Helvetica', size: 18, bold: true, italic: false,
        color: '#1f2430', lineHeight: 1.2,
        spaceBefore: 6, spaceAfter: 3, align: 'left',
      },
      h2: {
        font: 'Helvetica', size: 14, bold: true, italic: false,
        color: '#1f2430', lineHeight: 1.2,
        spaceBefore: 5, spaceAfter: 2, align: 'left',
      },
      h3: {
        font: 'Helvetica', size: 12, bold: true, italic: false,
        color: '#1f2430', lineHeight: 1.2,
        spaceBefore: 4, spaceAfter: 1, align: 'left',
      },
      caption: {
        font: 'Helvetica', size: 9, bold: false, italic: true,
        color: '#6b7280', lineHeight: 1.2,
        spaceBefore: 0, spaceAfter: 0, align: 'left',
      },
      list: {
        font: 'Helvetica', size: 11, bold: false, italic: false,
        color: '#222222', lineHeight: 1.35,
        spaceBefore: 0, spaceAfter: 1, align: 'left',
        indent: 5, bullet: '•',
      },
      table: {
        font: 'Helvetica', size: 10, color: '#222222',
        headBold: true, headBg: '#f1f3f7', borderColor: '#c0c6d2',
        cellPadding: 1.8,
      },
    },

    // ——— основное содержимое отчёта ———
    // Массив блоков — см. blocks.js для конструкторов.
    content: [],

    // ——— свободно-позиционируемые зоны (overlays) ———
    // Накладываются поверх страницы в фиксированных координатах —
    // независимо от потока основного content. Используются
    // canvas-редактором для зон вроде «инфо о компании», «адресат»,
    // «произвольный текст», которые не вписываются в обычные
    // колонтитулы.
    //
    // Каждый overlay:
    //   {
    //     id:      string,
    //     type:    'text',                 // пока только текст
    //     scope:   'first' | 'all' | 'other',  // на каких страницах
    //     x, y, width, height: number,     // мм, внутри поля печати
    //     content: {
    //       text:     string,              // с поддержкой {{...}}
    //       styleRef: 'body'|'h1'|'h2'|'h3'|'caption',
    //       align:    'left'|'center'|'right',
    //     },
    //   }
    overlays: [],
  };
}

/** Глубокое слияние (частичный patch поверх шаблона по умолчанию). */
export function createTemplate(patch) {
  return mergeDeep(defaultTemplate(), patch || {});
}

/** Возвращает {width, height} страницы в мм с учётом orientation. */
export function pageSizeMm(page) {
  let w, h;
  if (page.format === 'Custom') {
    w = page.width;  h = page.height;
  } else {
    const size = PAGE_SIZES[page.format] || PAGE_SIZES.A4;
    w = size.width;  h = size.height;
  }
  if (page.orientation === 'landscape') return { width: h, height: w };
  return { width: w, height: h };
}

/** Область контента внутри страницы с учётом полей и колонтитулов. */
export function contentBox(tpl, isFirstPage) {
  const { width, height } = pageSizeMm(tpl.page);
  const m = tpl.page.margins;
  const hdr = isFirstPage ? tpl.header.firstPage : tpl.header.otherPages;
  const ftr = isFirstPage ? tpl.footer.firstPage : tpl.footer.otherPages;
  const top    = m.top    + (hdr.enabled ? hdr.height : 0);
  const bottom = m.bottom + (ftr.enabled ? ftr.height : 0);
  return {
    x:      m.left,
    y:      top,
    width:  width - m.left - m.right,
    height: height - top - bottom,
  };
}

/** Возвращает overlay-зоны, которые должны отображаться на странице
 *  с заданным индексом. isFirstPage=true — рендерим overlays со scope
 *  'first' и 'all'; иначе 'other' и 'all'. */
export function overlaysForPage(tpl, isFirstPage) {
  const list = Array.isArray(tpl?.overlays) ? tpl.overlays : [];
  return list.filter(o => {
    if (!o || o.type !== 'text') return false;
    if (o.scope === 'all') return true;
    if (o.scope === 'first') return isFirstPage;
    if (o.scope === 'other') return !isFirstPage;
    return true;
  });
}

/** Подстановка плейсхолдеров {{meta.title}}, {{page}}, {{pages}}, {{date}}. */
export function substitute(text, tpl, ctx) {
  if (text == null) return '';
  ctx = ctx || {};
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    if (key === 'page')  return ctx.page  != null ? String(ctx.page)  : '';
    if (key === 'pages') return ctx.pages != null ? String(ctx.pages) : '';
    if (key === 'date')  return ctx.date  || new Date().toLocaleDateString('ru-RU');
    if (key.startsWith('meta.')) {
      const rest = key.slice(5);
      if (rest in tpl.meta) return String(tpl.meta[rest] ?? '');
      if (tpl.meta.custom && rest in tpl.meta.custom) return String(tpl.meta.custom[rest] ?? '');
      return '';
    }
    return '';
  });
}

// ——— утилиты ———

function mergeDeep(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object') {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(patch)) {
      out[k] = mergeDeep(base ? base[k] : undefined, patch[k]);
    }
    return out;
  }
  return patch === undefined ? base : patch;
}
