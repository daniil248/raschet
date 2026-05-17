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

    // ——— ОБЛОЖКА / ТИТУЛ (Word-style, redesign DS) ———
    // Если enabled — это ОТДЕЛЬНАЯ первая страница(ы) перед потоком:
    // своя геометрия (page=null → как базовая), свои блоки (тот же
    // формат, что flow: docTitle/companyInfo/… + текст), колонтитулы
    // по умолчанию ВЫКЛючены (chrome:false). Содержимое отчёта идёт
    // ПОСЛЕ обложки со своей пагинацией.
    cover: {
      enabled: false,
      page:    null,                  // {format,orientation,margins} | null
      chrome:  false,                 // показывать ли header/footer на обложке
      blocks:  [],
    },

    // ——— ПЕРВАЯ СТРАНИЦА КОНТЕНТА (Word «особая первая страница») ———
    // Геометрия первой страницы потока может отличаться от базовой
    // (разный колонтитул 1-й стр. уже задаётся header/footer.firstPage).
    firstPage: { page: null },        // {format,orientation,margins} | null

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

    // ——— ЕДИНЫЙ ПОТОК ДОКУМЕНТА (новая модель, redesign R1) ———
    // flow[] — упорядоченный список блоков, который РЕНДЕРИТСЯ СВЕРХУ
    // ВНИЗ С РЕЗЕРВИРОВАНИЕМ МЕСТА. Сюда входят и структурные блоки
    // (title/company/addressee/metaLine/toc/signature/stamp), и тело
    // отчёта (heading/paragraph/list/table/...). Наложение контента и
    // «шапки/подписи» невозможно конструктивно — всё в одном потоке.
    //
    // Структурные блоки (type из набора ниже; reserve = да):
    //   { type:'docTitle',    text, styleRef:'h1', align }
    //   { type:'companyInfo', text|null (null → из company-profile), align }
    //   { type:'addressee',   text, align }
    //   { type:'metaLine',    text (дата/№/город, {{...}}), align }
    //   { type:'tocAuto',     title }                 // авто-содержание
    //   { type:'signature',   role, name, withDate, mp, scanSrc|null }
    //   { type:'stamp',       src|null, width, height, align }
    // плюс любые блоки content (blocks.js). Каждый блок может нести
    // section/sectionLabel — порядок/видимость через sections +
    // effectiveFlow().
    //
    // Пусто → модель ещё не задействована; рендер использует content
    // (legacy). migrateToFlow() собирает flow из content+overlays для
    // сохранённых шаблонов (обратная совместимость, идемпотентно).
    flow: [],

    // Плавающий слой — ЕДИНСТВЕННОЕ намеренное наложение поверх
    // потока (вместе с колонтитулами — единственное, чему можно за
    // поля печати). Два режима привязки:
    //   • absolute: { x,y } (мм от листа) — фон/водяной знак на всю
    //     страницу;
    //   • anchor:{ role:'signature'|<...>, refId?, dx,dy } — привязка
    //     к блоку потока (печать/скан-подпись ПОВЕРХ подписанта;
    //     остаётся на подписанте при изменении длины контента).
    //   { id, type:'text'|'image', scope:'first'|'all'|'other',
    //     anchor|null, x,y,width,height (мм), opacity, rotate,
    //     content:{ src|text, ... } }
    floating: [],

    // ——— разделы документа (порядок и видимость) ———
    // Подпрограмма при формировании отчёта помечает блоки content
    // полями block.section (id) и block.sectionLabel (человекочитаемо)
    // и кладёт в tpl.sections.manifest список { id, label } в
    // естественном порядке. Пользователь в редакторе («Разделы»)
    // меняет order (порядок) и hidden (скрытые). effectiveContent()
    // применяет это при рендере. Если content НЕ полностью
    // разбит на секции — order/hidden игнорируются (legacy-совместимо,
    // нулевая регрессия для ещё не мигрированных отчётов).
    sections: { order: [], hidden: [], manifest: [] },

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
    //     type:    'text' | 'image',       // текст или изображение
    //     scope:   'first' | 'all' | 'other',  // на каких страницах
    //     x, y, width, height: number,     // мм, внутри поля печати
    //     content: {                       // для type==='text':
    //       text:     string,              // с поддержкой {{...}}
    //       styleRef: 'body'|'h1'|'h2'|'h3'|'caption',
    //       align:    'left'|'center'|'right',
    //     } | {                            // для type==='image':
    //       src:   string,                 // data URL (PNG/JPEG) | null
    //       fit:   'contain' | 'fill',
    //       label: string,                 // напр. «Печать организации»
    //     },
    //   }
    //   Image-зоны используются для печати организации и скан-подписи
    //   ответственного лица (текстовые подписи/контакты — type 'text'
    //   с пресетами respSign / executor).
    overlays: [],
  };
}

/** Глубокое слияние (частичный patch поверх шаблона по умолчанию).
 *  Дополнительно выполняет автомиграцию legacy-колонтитулов в новую
 *  overlays-модель — чтобы canvas-редактор показывал их как зоны на
 *  холсте. Миграция идемпотентна: если overlays уже непусты, она
 *  пропускается. */
export function createTemplate(patch) {
  const merged = mergeDeep(defaultTemplate(), patch || {});
  return migrateLegacyToOverlays(merged);
}

/** Преобразует legacy-колонтитулы (tpl.header.*.blocks, tpl.footer.*.blocks)
 *  и legacy-позицию логотипа (tpl.logo.position) в новую модель overlays
 *  + logo.x/y. После миграции legacy-поля колонтитулов отключаются
 *  (enabled=false), чтобы не было двойного рендера. */
export function migrateLegacyToOverlays(tpl) {
  if (!Array.isArray(tpl.overlays)) tpl.overlays = [];
  // Уже мигрировано / пользователь задал свои overlays — не трогаем.
  if (tpl.overlays.length > 0) {
    migrateLogoPosition(tpl);
    return tpl;
  }

  const { width, height } = pageSizeMm(tpl.page);
  const m = tpl.page.margins;
  const printW = width - m.left - m.right;
  let nextId = 1;
  const overlays = [];

  const addFromBlock = (block, y, h, scope) => {
    if (!block || block.type !== 'paragraph') return;
    overlays.push({
      id: 'mig-' + (nextId++),
      type: 'text',
      scope,
      x: round1(m.left),
      y: round1(y),
      width:  round1(printW),
      height: round1(h),
      content: {
        text:     block.text || '',
        styleRef: block.style || 'caption',
        align:    block.align || 'left',
      },
    });
  };

  // ——— Header ———
  const hdrF = tpl.header?.firstPage;
  const hdrO = tpl.header?.otherPages;
  const headerSame = blocksEqual(hdrF?.blocks, hdrO?.blocks);
  const headerY = m.top;
  if (hdrF?.enabled && Array.isArray(hdrF.blocks)) {
    const scope = headerSame && hdrO?.enabled ? 'all' : 'first';
    for (const b of hdrF.blocks) addFromBlock(b, headerY, hdrF.height || 12, scope);
  }
  if (hdrO?.enabled && !headerSame && Array.isArray(hdrO.blocks)) {
    for (const b of hdrO.blocks) addFromBlock(b, headerY, hdrO.height || 12, 'other');
  }

  // ——— Footer ———
  const ftrF = tpl.footer?.firstPage;
  const ftrO = tpl.footer?.otherPages;
  const footerSame = blocksEqual(ftrF?.blocks, ftrO?.blocks);
  if (ftrF?.enabled && Array.isArray(ftrF.blocks)) {
    const h = ftrF.height || 10;
    const y = height - m.bottom - h;
    const scope = footerSame && ftrO?.enabled ? 'all' : 'first';
    for (const b of ftrF.blocks) addFromBlock(b, y, h, scope);
  }
  if (ftrO?.enabled && !footerSame && Array.isArray(ftrO.blocks)) {
    const h = ftrO.height || 10;
    const y = height - m.bottom - h;
    for (const b of ftrO.blocks) addFromBlock(b, y, h, 'other');
  }

  migrateLogoPosition(tpl);

  if (overlays.length > 0) {
    tpl.overlays = overlays;
    // Отключаем legacy-колонтитулы, чтобы рендерер не выводил их повторно.
    if (tpl.header) {
      tpl.header.firstPage  = { ...tpl.header.firstPage,  enabled: false };
      tpl.header.otherPages = { ...tpl.header.otherPages, enabled: false };
    }
    if (tpl.footer) {
      tpl.footer.firstPage  = { ...tpl.footer.firstPage,  enabled: false };
      tpl.footer.otherPages = { ...tpl.footer.otherPages, enabled: false };
    }
  }
  return tpl;
}

function migrateLogoPosition(tpl) {
  // Если логотип уже имеет абсолютные координаты — не трогаем.
  if (!tpl.logo || !tpl.logo.src) return;
  if (typeof tpl.logo.x === 'number' && typeof tpl.logo.y === 'number') return;
  const { width, height } = pageSizeMm(tpl.page);
  const m = tpl.page.margins;
  const pos = tpl.logo.position || 'header-left';
  const isHeader = pos.startsWith('header');
  let y = isHeader ? m.top : (height - m.bottom - tpl.logo.height);
  let x = m.left;
  if (pos.endsWith('center')) x = (width - tpl.logo.width) / 2;
  if (pos.endsWith('right'))  x = width - m.right - tpl.logo.width;
  tpl.logo.x = round1(x);
  tpl.logo.y = round1(y);
}

function blocksEqual(a, b) {
  try { return JSON.stringify(a || []) === JSON.stringify(b || []); }
  catch { return false; }
}

function round1(v) { return Math.round(v * 10) / 10; }

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
    if (!o || (o.type !== 'text' && o.type !== 'image')) return false;
    if (o.scope === 'all') return true;
    if (o.scope === 'first') return isFirstPage;
    if (o.scope === 'other') return !isFirstPage;
    return true;
  });
}

/** Список разделов {id,label} в естественном порядке появления в
 *  content. Подпрограмма вызывает её после сборки блоков и кладёт
 *  результат в tpl.sections.manifest, чтобы редактор «Разделы» знал
 *  состав даже когда сам content в сохранённый шаблон не пишется. */
export function sectionManifestFromContent(content) {
  const seen = new Map();
  for (const b of (Array.isArray(content) ? content : [])) {
    if (b && b.section && !seen.has(b.section)) {
      seen.set(b.section, b.sectionLabel || b.section);
    }
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** Content с применённым порядком/видимостью разделов.
 *  Правило (предсказуемое, нулевая регрессия): если content НЕ
 *  полностью разбит на секции (есть хоть один блок без .section) —
 *  возвращаем как есть. Иначе группируем по секциям с сохранением
 *  порядка первого появления, затем применяем tpl.sections.order
 *  (неизвестные/новые секции дописываются в естественном порядке) и
 *  выкидываем tpl.sections.hidden. */
export function effectiveContent(tpl) {
  const content = Array.isArray(tpl?.content) ? tpl.content : [];
  if (!content.length) return content;
  if (!content.every(b => b && b.section)) return content;

  const sec = tpl.sections || {};
  const hidden = new Set(Array.isArray(sec.hidden) ? sec.hidden : []);
  const groups = new Map();
  const natural = [];
  for (const b of content) {
    if (!groups.has(b.section)) { groups.set(b.section, []); natural.push(b.section); }
    groups.get(b.section).push(b);
  }
  const wanted = Array.isArray(sec.order) && sec.order.length ? sec.order : natural;
  const finalIds = [];
  for (const id of wanted) {
    if (groups.has(id) && !finalIds.includes(id)) finalIds.push(id);
  }
  for (const id of natural) {
    if (!finalIds.includes(id)) finalIds.push(id);
  }
  const out = [];
  for (const id of finalIds) {
    if (hidden.has(id)) continue;
    out.push(...groups.get(id));
  }
  return out;
}

// ——————————————————————————————————————————————————————————————————————
// Redesign R1: единый поток документа (flow). Структурные блоки в
// потоке резервируют место → наложение «шапка/подпись поверх
// контента» невозможно конструктивно. Здесь — только МОДЕЛЬ и
// миграция; рендереры/редактор подключаются в R2/R3 (нет потребителей
// в этом деплое — cache-safe).
// ——————————————————————————————————————————————————————————————————————

/** Структурные типы блоков потока (резервируют высоту, не absolute). */
export const STRUCT_FLOW_TYPES = new Set([
  'docTitle', 'companyInfo', 'addressee', 'metaLine',
  'tocAuto', 'signature', 'stamp',
]);

/** Классификация legacy-overlay по содержимому/стилю → роль flow.
 *  Возвращает тип структурного блока либо null (обычный текст/картинка). */
function classifyOverlay(ov) {
  if (!ov) return null;
  if (ov.type === 'image') {
    const lbl = String(ov.content?.label || '').toLowerCase();
    if (lbl.includes('печат')) return 'stamp';
    if (lbl.includes('подпис')) return 'signatureScan';
    return null; // прочие картинки (логотип и т.п.) — не структурные
  }
  const t = String(ov.content?.text || '');
  const low = t.toLowerCase();
  if (t.includes('{{meta.title}}') || ov.content?.styleRef === 'h1') return 'docTitle';
  if (low.includes('кому') || low.includes('адресат')) return 'addressee';
  if (low.includes('м.п.') || low.includes('{{meta.custom.resp') ||
      low.includes('подпись ответствен')) return 'signature';
  if (low.includes('ооо') || low.includes('компани') ||
      low.includes('исполнитель') || low.includes('{{meta.custom.exec')) return 'companyInfo';
  if (t.includes('{{date}}') || /№|город|дата/i.test(t)) return 'metaLine';
  return null;
}

/** Собрать flow[] из legacy content[]+overlays[] (обратная
 *  совместимость сохранённых шаблонов). Идемпотентно: если flow уже
 *  непуст — только гарантирует наличие floating[] и выходит. Контент
 *  НИКОГДА не теряется (неклассифицированные overlay → текст/картинка
 *  в начале потока). Структурные overlay СЪЕДАЮТСЯ потоком:
 *  tpl.overlays перезаписывается только колонтитулами (page-number),
 *  чтобы drawOverlays не рисовал их absolute поверх потока. content
 *  не мутируется (работает копия tpl от createTemplate). */
export function migrateToFlow(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  if (!Array.isArray(tpl.floating)) tpl.floating = [];
  if (Array.isArray(tpl.flow) && tpl.flow.length > 0) {
    // flow уже есть (сохранённый редактором шаблон: структура/
    // колонтитулы/floating настроены). Если подпрограмма положила
    // tpl.content (тело отчёта) и оно ещё не влито — вставляем тело
    // МЕЖДУ шапкой и подписью (перед первым блоком раздела
    // doc-sign; иначе в конец). Идемпотентно через _flowBodyMerged.
    const body = Array.isArray(tpl.content) ? tpl.content : [];
    if (body.length && !tpl._flowBodyMerged) {
      const flow = tpl.flow.slice();
      let at = flow.findIndex(b => b && b.section === 'doc-sign');
      if (at < 0) at = flow.length;
      tpl.flow = [...flow.slice(0, at), ...body, ...flow.slice(at)];
      tpl._flowBodyMerged = true;
    }
    return tpl;
  }

  const overlays = Array.isArray(tpl.overlays) ? tpl.overlays : [];
  const content  = Array.isArray(tpl.content)  ? tpl.content  : [];
  const top = [];      // структурные сверху
  const bottom = [];   // подпись/печать снизу
  const extras = [];   // неклассифицированное — не теряем

  const seenRole = new Set();   // дедуп: один docTitle/addressee/...
  const keptOverlays = [];      // остаются absolute (только колонтитулы)
  for (const ov of overlays) {
    // Бегущий колонтитул (номер страницы и т.п.) — НЕ тянем в поток;
    // оставляем overlay (рисуется absolute в зоне полей — это
    // санкционировано инвариантом: за поля можно колонтитулам).
    if (ov.type !== 'image' &&
        /\{\{\s*pages?\s*\}\}/.test(String(ov.content?.text || ''))) {
      keptOverlays.push(ov);
      continue;
    }
    const role = classifyOverlay(ov);
    // Шаблоны хранят зоны для firstPage и otherPages (миграция
    // колонтитулов даёт 2 overlay scope first/other) → один и тот же
    // структурный блок не дублируем (берём первый).
    if (role && role !== 'signatureScan' && seenRole.has(role)) continue;
    if (role) seenRole.add(role);
    if (role === 'docTitle') {
      top.push({ type: 'docTitle', text: ov.content?.text || '{{meta.title}}',
        styleRef: 'h1', align: ov.content?.align || 'left' });
    } else if (role === 'companyInfo') {
      top.push({ type: 'companyInfo', text: ov.content?.text || null,
        align: ov.content?.align || 'left' });
    } else if (role === 'addressee') {
      top.push({ type: 'addressee', text: ov.content?.text || '',
        align: ov.content?.align || 'left' });
    } else if (role === 'metaLine') {
      top.push({ type: 'metaLine', text: ov.content?.text || '{{date}}',
        align: ov.content?.align || 'right' });
    } else if (role === 'signature') {
      bottom.push({ type: 'signature', text: ov.content?.text || '',
        align: ov.content?.align || 'left' });
    } else if (role === 'stamp') {
      // Печать — НЕ блок потока, а floating с привязкой к подписанту
      // (намеренное наложение поверх блока signature).
      tpl.floating.push({ id: 'flt-stamp', type: 'image',
        anchor: { role: 'signature', dx: ov.content?.dx ?? 60, dy: ov.content?.dy ?? -4 },
        scope: 'all', width: ov.width || 38, height: ov.height || 38,
        opacity: 1, content: { src: ov.content?.src || null, label: 'Печать организации' } });
    } else if (role === 'signatureScan') {
      tpl.floating.push({ id: 'flt-sign', type: 'image',
        anchor: { role: 'signature', dx: ov.content?.dx ?? 18, dy: ov.content?.dy ?? -2 },
        scope: 'all', width: ov.width || 50, height: ov.height || 20,
        opacity: 1, content: { src: ov.content?.src || null, label: 'Подпись (скан)' } });
    } else if (ov.type === 'image') {
      // нелого/неструктурная картинка — сохранить как image-блок
      if (ov.content?.src) extras.push({ type: 'image', src: ov.content.src,
        width: ov.width, height: ov.height });
    } else {
      const txt = ov.content?.text;
      if (txt) extras.push({ type: 'paragraph', text: txt,
        style: ov.content?.styleRef === 'caption' ? 'caption' : undefined });
    }
  }

  // Структурные блоки шапки/подписи получают свои разделы — чтобы
  // поток был полностью секционирован (effectiveFlow применяет
  // порядок/видимость, редактор «Разделы» их показывает).
  for (const b of top)    { b.section = 'doc-head'; b.sectionLabel = 'Шапка документа'; }
  for (const b of extras) { b.section = b.section || 'doc-head'; b.sectionLabel = b.sectionLabel || 'Шапка документа'; }
  for (const b of bottom) { b.section = 'doc-sign'; b.sectionLabel = 'Подписи и печать'; }

  tpl.flow = [...top, ...extras, ...content, ...bottom];
  // Структурные overlay СЪЕДЕНЫ потоком — оставляем только
  // колонтитулы (page-number и т.п.), иначе drawOverlays нарисует
  // их absolute ПОВЕРХ потока → дубль + возврат наложения.
  tpl.overlays = keptOverlays;
  return tpl;
}

/** Поток с применённым порядком/видимостью разделов — аналог
 *  effectiveContent, но над tpl.flow. Если flow пуст — fallback на
 *  effectiveContent (legacy), чтобы рендереры R2 звали единообразно. */
export function effectiveFlow(tpl) {
  const flow = Array.isArray(tpl?.flow) ? tpl.flow : [];
  if (!flow.length) return effectiveContent(tpl);

  // 1) порядок/видимость разделов (если поток полностью секционирован)
  let ordered = flow;
  if (flow.every(b => b && b.section)) {
    const sec = tpl.sections || {};
    const hidden = new Set(Array.isArray(sec.hidden) ? sec.hidden : []);
    const groups = new Map();
    const natural = [];
    for (const b of flow) {
      if (!groups.has(b.section)) { groups.set(b.section, []); natural.push(b.section); }
      groups.get(b.section).push(b);
    }
    const wanted = Array.isArray(sec.order) && sec.order.length ? sec.order : natural;
    const finalIds = [];
    for (const id of wanted) if (groups.has(id) && !finalIds.includes(id)) finalIds.push(id);
    for (const id of natural) if (!finalIds.includes(id)) finalIds.push(id);
    ordered = [];
    for (const id of finalIds) { if (hidden.has(id)) continue; ordered.push(...groups.get(id)); }
  }

  // 2) разворачиваем структурные блоки в базовые примитивы
  // (heading/paragraph/list/image/...), которые умеют рендерить все
  // три рендерера — без новых экспортов и без правок drawBlock.
  const out = [];
  for (const b of ordered) {
    if (b && STRUCT_FLOW_TYPES.has(b.type)) out.push(...expandStructural(b, tpl));
    else out.push(b);
  }
  return out;
}

/** Структурный flow-блок → массив базовых блоков. Текст со
 *  {{плейсхолдерами}} резолвится здесь (meta/date; page/pages в
 *  структурных не используются). section/sectionLabel наследуются. */
function expandStructural(b, tpl) {
  const sec = { section: b.section, sectionLabel: b.sectionLabel };
  const S = (txt) => substitute(txt == null ? '' : txt, tpl, {});
  const wrap = (o) => Object.assign(o, sec);
  switch (b.type) {
    case 'docTitle':
      return [wrap({ type: 'heading', level: 1,
        text: S(b.text || '{{meta.title}}'), align: b.align || 'left' })];
    case 'companyInfo':
      return [wrap({ type: 'paragraph', style: 'caption',
        text: S(b.text || ''), align: b.align || 'left' })];
    case 'addressee':
      return [wrap({ type: 'paragraph',
        text: S(b.text || ''), align: b.align || 'left' })];
    case 'metaLine':
      return [wrap({ type: 'paragraph', style: 'caption',
        text: S(b.text || '{{date}}'), align: b.align || 'right' })];
    case 'tocAuto': {
      const items = (tpl.sections?.manifest || []).map(s => s.label);
      const arr = [wrap({ type: 'heading', level: 2, text: b.title || 'Содержание' })];
      if (items.length) arr.push(wrap({ type: 'list', ordered: false, items }));
      return arr;
    }
    case 'signature': {
      const arr = [wrap({ type: 'spacer', height: b.gap || 8 })];
      const txt = b.text != null && b.text !== ''
        ? b.text
        : [b.role || 'Должность',
           '_______________ / ' + (b.name || '') + ' /',
           '«___» __________ 20__ г.' + (b.mp === false ? '' : '\nМ.П.')].join('\n');
      // _anchorTag — маркер для floating-слоя: печать/скан-подпись
      // привязываются к этому блоку (намеренное наложение поверх).
      arr.push(wrap({ type: 'paragraph', style: 'caption', _anchorTag: 'signature',
        text: S(txt), align: b.align || 'left' }));
      return arr;
    }
    case 'stamp':
      // Печать — floating с привязкой к подписанту (см. migrateToFlow /
      // tpl.floating), НЕ блок потока.
      return [];
    default:
      return [b];
  }
}

// ——————————————————————————————————————————————————————————————————————
// Word-style разделы документа (DS): обложка + переменная геометрия
// страницы по блоку sectionBreak. Здесь — только МОДЕЛЬ/хелперы;
// рендереры подключаются в DS2 (нет потребителей сейчас — cache-safe).
//   flow-блок: { type:'sectionBreak', page:{format?,orientation?,
//                margins?} } — новая страница + смена геометрии до
//                следующего sectionBreak.
// ——————————————————————————————————————————————————————————————————————

/** Слияние геометрии: override поверх базовой (поля — поглубже). */
export function mergePageGeom(base, ov) {
  base = base || {};
  if (!ov) return {
    format: base.format || 'A4', width: base.width || 210,
    height: base.height || 297, orientation: base.orientation || 'portrait',
    margins: { ...(base.margins || { top: 20, right: 15, bottom: 20, left: 20 }) },
  };
  return {
    format:      ov.format      || base.format      || 'A4',
    width:       ov.width       || base.width       || 210,
    height:      ov.height      || base.height      || 297,
    orientation: ov.orientation || base.orientation || 'portrait',
    margins: { ...(base.margins || {}), ...(ov.margins || {}) },
  };
}

/** contentBox для произвольной геометрии (с учётом колонтитулов,
 *  если chromeOn). isFirst — для выбора header/footer.firstPage. */
export function contentBoxFor(tpl, geom, chromeOn, isFirst) {
  const { width, height } = pageSizeMm(geom);
  const m = geom.margins || { top: 20, right: 15, bottom: 20, left: 20 };
  const hdr = chromeOn ? (isFirst ? tpl.header?.firstPage : tpl.header?.otherPages) : null;
  const ftr = chromeOn ? (isFirst ? tpl.footer?.firstPage : tpl.footer?.otherPages) : null;
  const top    = m.top    + (hdr && hdr.enabled ? hdr.height : 0);
  const bottom = m.bottom + (ftr && ftr.enabled ? ftr.height : 0);
  return {
    x: m.left, y: top,
    width:  width  - m.left - m.right,
    height: height - top - bottom,
  };
}

/** Документ → сегменты с собственной геометрией:
 *  [{ isCover, chrome, geom, blocks[] }]. Обложка (если enabled) —
 *  первый сегмент; затем контент, разрезаемый блоками sectionBreak
 *  (каждый меняет геометрию относительно текущей). Структурные блоки
 *  уже развёрнуты (effectiveFlow). */
export function flowSegments(tpl) {
  const base = tpl.page || {};
  const segs = [];
  if (tpl.cover && tpl.cover.enabled) {
    const cb = (tpl.cover.blocks && tpl.cover.blocks.length)
      ? effectiveFlow({ flow: tpl.cover.blocks, meta: tpl.meta, sections: {} })
      : [];
    segs.push({ isCover: true, chrome: !!tpl.cover.chrome,
      geom: mergePageGeom(base, tpl.cover.page), blocks: cb });
  }
  let geom = mergePageGeom(base, tpl.firstPage && tpl.firstPage.page);
  let cur = { isCover: false, chrome: true, geom, blocks: [] };
  for (const b of effectiveFlow(tpl)) {
    if (b && b.type === 'sectionBreak') {
      segs.push(cur);
      geom = mergePageGeom(geom, b.page);
      cur = { isCover: false, chrome: true, geom, blocks: [] };
      continue;
    }
    cur.blocks.push(b);
  }
  segs.push(cur);
  // Пустые контент-сегменты (например, break в самом начале) не
  // создают пустую страницу — кроме случая, когда документ пуст.
  const out = segs.filter((s, i) => s.isCover || s.blocks.length ||
    (i === segs.length - 1 && !segs.some(x => !x.isCover && x.blocks.length)));
  return out.length ? out : segs;
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
