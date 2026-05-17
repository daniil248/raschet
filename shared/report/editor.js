// ======================================================================
// shared/report/editor.js  (R3: flow-редактор шаблона отчёта)
//
// Прежний canvas-редактор (absolute overlays + drag/resize) заменён на
// редактор ЕДИНОГО ПОТОКА (flow). Структура документа, колонтитулы,
// плавающий слой, лист и стили правятся списком/полями; справа —
// живой WYSIWYG через renderPreview (тот же effectiveFlow, что и
// PDF) → наложение блоков невозможно конструктивно.
//
// API (контракт сохранён):
//   import { openTemplateEditor } from '../shared/report/editor.js';
//   openTemplateEditor(tpl, { onSave(newTpl){...}, onCancel(){...} });
// ======================================================================

import { PAGE_SIZES, FONT_FAMILIES, createTemplate, pageSizeMm, migrateToFlow }
  from './template.js';
import { renderPreview } from './preview.js';

let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./editor.css', import.meta.url).href;
  document.head.appendChild(link);
  _cssInjected = true;
}

// Структурные блоки, которые можно добавить в поток.
const STRUCT_ADD = [
  { type: 'docTitle',    label: 'Заголовок документа', mk: () => ({ type: 'docTitle', text: '{{meta.title}}', align: 'left' }) },
  { type: 'companyInfo', label: 'Реквизиты компании',  mk: () => ({ type: 'companyInfo', text: 'Компания: {{meta.custom.companyName}}\n{{meta.custom.companyAddr}}', align: 'left' }) },
  { type: 'addressee',   label: 'Адресат',             mk: () => ({ type: 'addressee', text: 'Кому: {{meta.custom.recipient}}\n{{meta.custom.recipientPost}}', align: 'left' }) },
  { type: 'metaLine',    label: 'Дата / № / город',    mk: () => ({ type: 'metaLine', text: '{{date}}', align: 'right' }) },
  { type: 'tocAuto',     label: 'Содержание (авто)',   mk: () => ({ type: 'tocAuto', title: 'Содержание' }) },
  { type: 'signature',   label: 'Подпись ответственного', mk: () => ({ type: 'signature', role: 'Должность', name: '', mp: true }) },
  { type: 'heading',     label: 'Заголовок (текст)',   mk: () => ({ type: 'heading', level: 2, text: 'Заголовок' }) },
  { type: 'paragraph',   label: 'Абзац (текст)',       mk: () => ({ type: 'paragraph', text: 'Текст' }) },
];

const TYPE_LABEL = {
  docTitle: 'Заголовок документа', companyInfo: 'Реквизиты компании',
  addressee: 'Адресат', metaLine: 'Дата/№', tocAuto: 'Содержание',
  signature: 'Подпись ответственного', stamp: 'Печать',
  heading: 'Заголовок', paragraph: 'Абзац', list: 'Список',
  table: 'Таблица', image: 'Изображение', spacer: 'Отступ',
  hr: 'Линия', pagebreak: 'Разрыв страницы', custom: 'Блок',
};

export function openTemplateEditor(tpl, opts = {}) {
  ensureCss();
  const working = createTemplate(tpl);
  migrateToFlow(working);                       // редактор работает на flow
  if (!Array.isArray(working.flow)) working.flow = [];
  if (!Array.isArray(working.floating)) working.floating = [];
  if (!working.sections || typeof working.sections !== 'object') working.sections = {};
  if (!Array.isArray(working.sections.order))  working.sections.order = [];
  if (!Array.isArray(working.sections.hidden)) working.sections.hidden = [];
  if (!Array.isArray(working.sections.manifest)) working.sections.manifest = [];

  const state = { tab: 'structure', sel: -1 };

  const backdrop = el('div', 'rpt-modal-backdrop');
  const modal = el('div', 'rpt-modal rpt-modal--canvas');
  backdrop.appendChild(modal);

  const hdr = el('div', 'rpt-modal__hdr');
  const ttl = el('div', 'rpt-modal__title');
  ttl.textContent = 'Настройка шаблона отчёта (поток)';
  hdr.appendChild(ttl);
  const hb = el('div');
  const bCancel = btn('Отмена');
  const bSave = btn('Сохранить', 'primary');
  hb.appendChild(bCancel); hb.appendChild(bSave);
  hdr.appendChild(hb);
  modal.appendChild(hdr);

  const bodyEl = el('div', 'rpt-modal__body');
  const sidebar = el('div', 'rpt-editor__sidebar');
  const previewWrap = el('div', 'rpt-editor__canvas-wrap');
  bodyEl.appendChild(sidebar);
  bodyEl.appendChild(previewWrap);
  modal.appendChild(bodyEl);

  const tabsEl = el('div', 'rpt-editor__tabs');
  sidebar.appendChild(tabsEl);
  const tabContent = el('div', 'rpt-editor__tab-content');
  sidebar.appendChild(tabContent);

  const previewEl = el('div', 'rpt-canvas');
  previewWrap.appendChild(previewEl);

  const TABS = [
    ['structure', 'Структура'],
    ['chrome',    'Колонтитулы'],
    ['floating',  'Плавающий слой'],
    ['page',      'Лист'],
    ['styles',    'Стили'],
  ];
  const tabBtns = {};
  for (const [id, label] of TABS) {
    const b = btn(label);
    b.className = '';
    b.addEventListener('click', () => { state.tab = id; rebuild(); });
    tabBtns[id] = b;
    tabsEl.appendChild(b);
  }

  document.body.appendChild(backdrop);
  rebuild();

  const close = (save) => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
    if (save) opts.onSave && opts.onSave(working);
    else opts.onCancel && opts.onCancel();
  };
  bCancel.addEventListener('click', () => close(false));
  bSave.addEventListener('click', () => close(true));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
  function onKey(e) {
    const ae = document.activeElement;
    const inField = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); if (inField) ae.blur(); close(true); return;
    }
    if (e.key === 'Escape' && !inField) { close(false); }
  }
  window.addEventListener('keydown', onKey);

  // ——————————————————————————————————————————————————————
  function rebuild() {
    for (const [id] of TABS) tabBtns[id].classList.toggle('active', id === state.tab);
    tabContent.innerHTML = '';
    if (state.tab === 'structure') buildStructure(tabContent);
    else if (state.tab === 'chrome') buildChrome(tabContent);
    else if (state.tab === 'floating') buildFloating(tabContent);
    else if (state.tab === 'page') buildPage(tabContent);
    else if (state.tab === 'styles') buildStyles(tabContent);
    renderPane();
  }

  function renderPane() {
    try {
      const { width } = pageSizeMm(working.page);
      const avail = Math.max(220, previewWrap.getBoundingClientRect().width - 40);
      const scale = Math.max(1.4, Math.min(3.4, avail / width));
      renderPreview(working, previewEl, { mode: 'view', scale });
    } catch (e) {
      previewEl.innerHTML = '<div style="padding:20px;color:#b91c1c;font:13px system-ui">' +
        'Ошибка превью: ' + (e && e.message || e) + '</div>';
    }
  }

  // ——— Вкладка «Структура» (flow) ———
  function buildStructure(p) {
    sect(p, 'Добавить блок в поток');
    const add = el('div', 'rpt-zone-add');
    for (const s of STRUCT_ADD) {
      const b = btn('+ ' + s.label);
      b.className = 'rpt-zone-add-btn';
      b.addEventListener('click', () => {
        const blk = s.mk();
        const sgIdx = working.flow.findIndex(x => x && x.section === 'doc-sign');
        if (s.type === 'signature' || sgIdx < 0) working.flow.push(blk);
        else working.flow.splice(sgIdx, 0, blk);
        state.sel = working.flow.indexOf(blk);
        rebuild();
      });
      add.appendChild(b);
    }
    p.appendChild(add);

    sect(p, 'Блоки документа (сверху вниз)');
    const hint = el('div', 'rpt-hint');
    hint.textContent = 'Порядок = порядок в документе. 👁 — скрыть из PDF/DOCX. Тело отчёта подставляет подпрограмма; структурные блоки и порядок сохраняются в шаблоне.';
    p.appendChild(hint);

    const list = el('div', 'rpt-zone-list');
    const hidden = new Set(working.sections.hidden || []);
    working.flow.forEach((b, i) => {
      const row = el('div', 'rpt-zone-list__item');
      row.style.cssText = 'display:flex;align-items:center;gap:4px';
      if (i === state.sel) row.classList.add('active');

      const eye = btn(b._hidden || (b.section && hidden.has(b.section)) ? '🚫' : '👁');
      eye.title = 'Показать/скрыть блок';
      eye.style.padding = '2px 6px';
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (b.section) {
          const h = new Set(working.sections.hidden || []);
          h.has(b.section) ? h.delete(b.section) : h.add(b.section);
          working.sections.hidden = [...h];
        } else { b._hidden = !b._hidden; }
        rebuild();
      });
      row.appendChild(eye);

      const nm = el('span');
      nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nm.textContent = blockLabel(b);
      if (b._hidden || (b.section && hidden.has(b.section))) {
        nm.style.opacity = '0.5'; nm.style.textDecoration = 'line-through';
      }
      row.appendChild(nm);

      const up = btn('▲'); up.style.padding = '2px 6px'; up.disabled = i === 0;
      up.addEventListener('click', (ev) => { ev.stopPropagation(); moveBlock(i, -1); });
      const dn = btn('▼'); dn.style.padding = '2px 6px'; dn.disabled = i === working.flow.length - 1;
      dn.addEventListener('click', (ev) => { ev.stopPropagation(); moveBlock(i, 1); });
      const rm = btn('✕', 'danger'); rm.style.padding = '2px 6px';
      rm.title = 'Удалить блок';
      rm.addEventListener('click', (ev) => {
        ev.stopPropagation();
        working.flow.splice(i, 1);
        state.sel = -1;
        rebuild();
      });
      row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
      row.addEventListener('click', () => { state.sel = i; rebuild(); });
      list.appendChild(row);
    });
    if (!working.flow.length) {
      const e0 = el('div', 'rpt-hint');
      e0.textContent = 'Поток пуст. Добавьте структурные блоки выше — тело отчёта подставит подпрограмма.';
      list.appendChild(e0);
    }
    p.appendChild(list);

    if (state.sel >= 0 && working.flow[state.sel]) {
      sect(p, 'Свойства блока');
      buildBlockProps(p, working.flow[state.sel]);
    }
  }

  function moveBlock(i, d) {
    const j = i + d;
    if (j < 0 || j >= working.flow.length) return;
    const a = working.flow;
    [a[i], a[j]] = [a[j], a[i]];
    if (state.sel === i) state.sel = j;
    else if (state.sel === j) state.sel = i;
    rebuild();
  }

  function blockLabel(b) {
    if (!b) return '—';
    const t = TYPE_LABEL[b.type] || b.type || 'блок';
    if (b.type === 'docTitle') return '📌 ' + t;
    if (b.type === 'signature') return '✍ ' + t;
    if (b.type === 'companyInfo' || b.type === 'addressee' || b.type === 'metaLine')
      return '🏢 ' + t;
    if (b.type === 'tocAuto') return '🗂 ' + t;
    if (b.section) return '▸ ' + (b.sectionLabel || t) + ' · ' + t;
    const txt = (b.text || (Array.isArray(b.items) ? b.items[0] : '') || '').toString();
    return '· ' + t + (txt ? ' — ' + txt.slice(0, 28) : '');
  }

  function buildBlockProps(p, b) {
    if (b.type === 'signature') {
      fld(p, 'Должность', textInput(b.role || '', v => { b.role = v; renderPane(); }));
      fld(p, 'Ф.И.О.', textInput(b.name || '', v => { b.name = v; renderPane(); }));
      const lbl = el('label', 'chk');
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = b.mp !== false;
      cb.addEventListener('change', () => { b.mp = cb.checked; renderPane(); });
      lbl.appendChild(cb);
      const sp = document.createElement('span'); sp.textContent = ' М.П. (место печати)';
      lbl.appendChild(sp);
      const w = fld(p, '', lbl);
      void w;
      return;
    }
    if (b.type === 'tocAuto') {
      fld(p, 'Заголовок', textInput(b.title || 'Содержание', v => { b.title = v; renderPane(); }));
      return;
    }
    if (b.type === 'docTitle' || b.type === 'companyInfo' || b.type === 'addressee' ||
        b.type === 'metaLine' || b.type === 'heading' || b.type === 'paragraph') {
      fld(p, 'Текст (можно {{плейсхолдеры}})',
        textArea(b.text || '', v => { b.text = v; renderPane(); }));
      fld(p, 'Выравнивание', selectInput(
        [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']],
        b.align || 'left', v => { b.align = v; renderPane(); }));
      const h = el('div', 'rpt-hint');
      h.innerHTML = 'Плейсхолдеры: <code>{{meta.title}}</code> <code>{{meta.author}}</code> ' +
        '<code>{{date}}</code> <code>{{meta.custom.recipient}}</code> ' +
        '<code>{{meta.custom.companyName}}</code>';
      p.appendChild(h);
      return;
    }
    const h = el('div', 'rpt-hint');
    h.textContent = 'Этот блок формирует подпрограмма — здесь только порядок/видимость.';
    p.appendChild(h);
  }

  // ——— Вкладка «Колонтитулы» ———
  function buildChrome(p) {
    const hint = el('div', 'rpt-hint');
    hint.textContent = 'Колонтитулы повторяются на страницах и могут выходить за поля печати. Текст поддерживает {{page}} {{pages}} {{date}} {{meta.title}}.';
    p.appendChild(hint);
    chromeBand(p, 'Шапка — первая страница', working.header.firstPage);
    chromeBand(p, 'Шапка — остальные', working.header.otherPages);
    chromeBand(p, 'Подвал — первая страница', working.footer.firstPage);
    chromeBand(p, 'Подвал — остальные', working.footer.otherPages);
  }
  function chromeBand(p, label, band) {
    sect(p, label);
    if (!band || typeof band !== 'object') return;
    const lbl = el('label', 'chk');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    cb.checked = band.enabled !== false;
    cb.addEventListener('change', () => { band.enabled = cb.checked; renderPane(); });
    lbl.appendChild(cb);
    const sp = document.createElement('span'); sp.textContent = ' включена';
    lbl.appendChild(sp);
    fld(p, '', lbl);
    fld(p, 'Высота, мм', numInput(band.height || 12, v => { band.height = v; renderPane(); }));
    const first = (band.blocks && band.blocks[0]) || null;
    const txt = first && first.text || '';
    fld(p, 'Текст', textInput(txt, v => {
      band.blocks = v ? [{ type: 'paragraph', style: 'caption',
        align: (first && first.align) || 'center', text: v }] : [];
      renderPane();
    }));
    fld(p, 'Выравнивание', selectInput(
      [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']],
      (first && first.align) || 'center', v => {
        if (band.blocks && band.blocks[0]) { band.blocks[0].align = v; renderPane(); }
      }));
  }

  // ——— Вкладка «Плавающий слой» ———
  function buildFloating(p) {
    const hint = el('div', 'rpt-hint');
    hint.innerHTML = 'Единственное намеренное наложение поверх потока. ' +
      'Привязка к подписанту — печать/скан поверх блока подписи; ' +
      'без привязки — фон/водяной знак (можно за поля).';
    p.appendChild(hint);

    const addRow = el('div', 'rpt-zone-add');
    const aW = btn('+ Водяной знак');
    aW.className = 'rpt-zone-add-btn';
    aW.addEventListener('click', () => {
      working.floating.push({ id: 'flt-' + Date.now().toString(36), type: 'text',
        scope: 'all', x: 40, y: 130, width: 120, height: 20, opacity: 0.12,
        rotate: -30, content: { text: 'ЧЕРНОВИК', size: 48, color: '#c8c8c8' } });
      rebuild();
    });
    const aS = btn('+ Печать (над подписью)');
    aS.className = 'rpt-zone-add-btn';
    aS.addEventListener('click', () => {
      const f = { id: 'flt-' + Date.now().toString(36), type: 'image',
        anchor: { role: 'signature', dx: 60, dy: -4 }, scope: 'all',
        width: 38, height: 38, opacity: 1, content: { src: null, label: 'Печать организации' } };
      working.floating.push(f);
      pickImage(src => { f.content.src = src; rebuild(); });
      rebuild();
    });
    addRow.appendChild(aW); addRow.appendChild(aS);
    p.appendChild(addRow);

    sect(p, 'Элементы');
    working.floating.forEach((f, i) => {
      const card = el('div', 'rpt-style-card');
      const h = document.createElement('h4');
      h.textContent = (f.type === 'image' ? '🖼 ' : '🅰 ') +
        (f.content?.label || (f.type === 'image' ? 'Изображение' : 'Текст')) +
        (f.anchor ? ' · над подписью' : ' · фон');
      card.appendChild(h);
      if (f.type === 'image') {
        const pk = btn(f.content?.src ? '📷 Заменить' : '📷 Выбрать файл');
        pk.addEventListener('click', () => pickImage(src => {
          if (!f.content) f.content = {}; f.content.src = src; rebuild();
        }));
        card.appendChild(pk);
      } else {
        fld(card, 'Текст', textInput(f.content?.text || '', v => {
          if (!f.content) f.content = {}; f.content.text = v; renderPane();
        }));
      }
      const r1 = el('div', 'rpt-row');
      fld(r1, 'Ширина', numInput(f.width || 40, v => { f.width = v; renderPane(); }));
      fld(r1, 'Высота', numInput(f.height || 20, v => { f.height = v; renderPane(); }));
      card.appendChild(r1);
      fld(card, 'Прозрачность (0..1)', numInput(
        typeof f.opacity === 'number' ? f.opacity : 1,
        v => { f.opacity = Math.max(0, Math.min(1, v)); renderPane(); }));
      if (f.anchor) {
        const r2 = el('div', 'rpt-row');
        fld(r2, 'Смещение X', numInput(f.anchor.dx || 0, v => { f.anchor.dx = v; renderPane(); }));
        fld(r2, 'Смещение Y', numInput(f.anchor.dy || 0, v => { f.anchor.dy = v; renderPane(); }));
        card.appendChild(r2);
      } else {
        const r2 = el('div', 'rpt-row');
        fld(r2, 'X, мм', numInput(f.x || 0, v => { f.x = v; renderPane(); }));
        fld(r2, 'Y, мм', numInput(f.y || 0, v => { f.y = v; renderPane(); }));
        card.appendChild(r2);
      }
      const del = btn('Удалить', 'danger');
      del.addEventListener('click', () => { working.floating.splice(i, 1); rebuild(); });
      card.appendChild(del);
      p.appendChild(card);
    });
    if (!working.floating.length) {
      const e0 = el('div', 'rpt-hint');
      e0.textContent = 'Плавающих элементов нет.';
      p.appendChild(e0);
    }
  }

  // ——— Вкладка «Лист» ———
  function buildPage(p) {
    sect(p, 'Формат');
    const fmt = Object.keys(PAGE_SIZES).concat(['Custom']);
    fld(p, 'Размер', selectInput(fmt.map(f => [f, f]), working.page.format || 'A4',
      v => { working.page.format = v; renderPane(); }));
    fld(p, 'Ориентация', selectInput(
      [['portrait', 'Книжная'], ['landscape', 'Альбомная']],
      working.page.orientation || 'portrait', v => { working.page.orientation = v; renderPane(); }));
    const r = el('div', 'rpt-row');
    fld(r, 'Ширина, мм', numInput(working.page.width || 210, v => { working.page.width = v; renderPane(); }));
    fld(r, 'Высота, мм', numInput(working.page.height || 297, v => { working.page.height = v; renderPane(); }));
    p.appendChild(r);
    sect(p, 'Поля печати, мм');
    const m = working.page.margins || (working.page.margins = { top: 20, right: 15, bottom: 20, left: 20 });
    const r2 = el('div', 'rpt-row');
    fld(r2, 'Верхнее', numInput(m.top, v => { m.top = v; renderPane(); }));
    fld(r2, 'Нижнее', numInput(m.bottom, v => { m.bottom = v; renderPane(); }));
    p.appendChild(r2);
    const r3 = el('div', 'rpt-row');
    fld(r3, 'Левое', numInput(m.left, v => { m.left = v; renderPane(); }));
    fld(r3, 'Правое', numInput(m.right, v => { m.right = v; renderPane(); }));
    p.appendChild(r3);
    sect(p, 'Метаданные');
    fld(p, 'Заголовок', textInput(working.meta?.title || '', v => {
      working.meta = working.meta || {}; working.meta.title = v; renderPane();
    }));
    fld(p, 'Автор', textInput(working.meta?.author || '', v => {
      working.meta = working.meta || {}; working.meta.author = v; renderPane();
    }));
  }

  // ——— Вкладка «Стили» ———
  function buildStyles(p) {
    const KEYS = [['h1', 'Заголовок 1'], ['h2', 'Заголовок 2'], ['h3', 'Заголовок 3'],
      ['body', 'Основной текст'], ['caption', 'Подпись'], ['list', 'Список'], ['table', 'Таблица']];
    for (const [k, label] of KEYS) {
      const s = working.styles[k] || (working.styles[k] = {});
      const card = el('div', 'rpt-style-card');
      const h = document.createElement('h4'); h.textContent = label; card.appendChild(h);
      const r = el('div', 'rpt-row');
      fld(r, 'Размер, pt', numInput(s.size || 11, v => { s.size = v; renderPane(); }));
      fld(r, 'Цвет', colorInput(s.color || '#222222', v => { s.color = v; renderPane(); }));
      card.appendChild(r);
      if (k !== 'table') {
        const lbl = el('label', 'chk');
        const cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = !!s.bold;
        cb.addEventListener('change', () => { s.bold = cb.checked; renderPane(); });
        lbl.appendChild(cb);
        const sp = document.createElement('span'); sp.textContent = ' жирный';
        lbl.appendChild(sp);
        fld(card, '', lbl);
      }
      p.appendChild(card);
    }
  }

  // ——— общий picker картинки ———
  function pickImage(cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/jpeg';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => cb(rd.result);
      rd.readAsDataURL(f);
    });
    inp.click();
  }
}

// ——————————————————————————————————————————————————————————————————————
// Мелкие DOM-утилиты
// ——————————————————————————————————————————————————————————————————————
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function btn(text, variant) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (variant ? ' ' + variant : '');
  b.textContent = text;
  return b;
}
function sect(parent, text) {
  const s = el('div', 'rpt-sect-title');
  s.textContent = text;
  parent.appendChild(s);
}
function fld(parent, label, control) {
  const wrap = el('div', 'rpt-field');
  if (label) { const l = el('label'); l.textContent = label; wrap.appendChild(l); }
  if (control) wrap.appendChild(control);
  parent.appendChild(wrap);
  return wrap;
}
function textInput(val, onChange) {
  const i = document.createElement('input');
  i.type = 'text'; i.value = val == null ? '' : val;
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function textArea(val, onChange) {
  const t = document.createElement('textarea');
  t.rows = 3; t.value = val == null ? '' : val;
  t.addEventListener('change', () => onChange(t.value));
  return t;
}
function numInput(val, onChange) {
  const i = document.createElement('input');
  i.type = 'number'; i.value = val;
  i.addEventListener('change', () => {
    const n = parseFloat(i.value);
    if (!isNaN(n)) onChange(n);
  });
  return i;
}
function colorInput(val, onChange) {
  const i = document.createElement('input');
  i.type = 'color'; i.value = /^#[0-9a-f]{6}$/i.test(val) ? val : '#222222';
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function selectInput(options, val, onChange) {
  const s = document.createElement('select');
  for (const [v, l] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = l;
    s.appendChild(o);
  }
  s.value = val;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
