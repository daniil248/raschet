// ======================================================================
// shared/report/editor.js
// Модальный редактор шаблона отчёта. Открывается подпрограммой, чтобы
// пользователь мог настроить страницу, колонтитулы, логотип и стили.
// Содержимое отчёта (tpl.content) не редактируется здесь — его формирует
// подпрограмма из своих данных.
//
// API:
//   import { openTemplateEditor } from '../shared/report/editor.js';
//   openTemplateEditor(tpl, {
//     onSave(newTpl) { ... },   // вызывается по «Сохранить»
//     onCancel()     { ... },   // опционально
//   });
//
// Редактор работает по копии шаблона — исходный tpl не мутируется до
// нажатия «Сохранить».
// ======================================================================

import { PAGE_SIZES, FONT_FAMILIES, createTemplate, pageSizeMm } from './template.js';
import { renderPreview } from './preview.js';

let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  // resolve относительно этого модуля
  link.href = new URL('./editor.css', import.meta.url).href;
  document.head.appendChild(link);
  _cssInjected = true;
}

export function openTemplateEditor(tpl, opts = {}) {
  ensureCss();
  const working = createTemplate(tpl);  // deep copy через merge

  const backdrop = el('div', 'rpt-modal-backdrop');
  const modal    = el('div', 'rpt-modal');
  backdrop.appendChild(modal);

  // ——— шапка ———
  const hdr = el('div', 'rpt-modal__hdr');
  const title = el('div', 'rpt-modal__title'); title.textContent = 'Настройка шаблона отчёта';
  hdr.appendChild(title);
  const hdrBtns = el('div');
  const btnCancel = buttonEl('Отмена');
  const btnSave   = buttonEl('Сохранить', 'primary');
  hdrBtns.appendChild(btnCancel);
  hdrBtns.appendChild(btnSave);
  hdr.appendChild(hdrBtns);
  modal.appendChild(hdr);

  // ——— тело ———
  const body = el('div', 'rpt-modal__body');
  const tabs = el('div', 'rpt-modal__tabs');
  const main = el('div', 'rpt-modal__main');
  const form    = el('div', 'rpt-modal__form');
  const preview = el('div', 'rpt-modal__preview');
  main.appendChild(form);
  main.appendChild(preview);
  body.appendChild(tabs);
  body.appendChild(main);
  modal.appendChild(body);

  document.body.appendChild(backdrop);

  // ——— вкладки ———
  const TABS = [
    { id: 'page',    label: 'Страница',    build: buildPageTab },
    { id: 'margins', label: 'Поля',         build: buildMarginsTab },
    { id: 'header',  label: 'Колонтитулы', build: buildHeaderFooterTab },
    { id: 'logo',    label: 'Логотип',      build: buildLogoTab },
    { id: 'styles',  label: 'Стили',        build: buildStylesTab },
    { id: 'meta',    label: 'Метаданные',  build: buildMetaTab },
  ];
  let activeTab = TABS[0].id;
  const tabButtons = {};
  TABS.forEach(t => {
    const b = buttonEl(t.label);
    b.className = '';
    tabButtons[t.id] = b;
    b.addEventListener('click', () => {
      activeTab = t.id;
      refresh();
    });
    tabs.appendChild(b);
  });

  function refresh() {
    // кнопки вкладок
    TABS.forEach(t => {
      tabButtons[t.id].classList.toggle('active', t.id === activeTab);
    });
    // форма
    form.innerHTML = '';
    const current = TABS.find(t => t.id === activeTab);
    if (current) current.build(form, working, refresh);
    // превью
    renderPreview(working, preview, { mode: 'edit' });
  }

  btnCancel.addEventListener('click', () => {
    backdrop.remove();
    if (opts.onCancel) opts.onCancel();
  });
  btnSave.addEventListener('click', () => {
    backdrop.remove();
    if (opts.onSave) opts.onSave(working);
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
      if (opts.onCancel) opts.onCancel();
    }
  });

  refresh();
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Страница»
// ——————————————————————————————————————————————————————————————————————
function buildPageTab(form, tpl, refresh) {
  sectionTitle(form, 'Формат листа');

  const fmtField = field(form, 'Размер');
  const fmtSelect = document.createElement('select');
  ['A3','A4','A5','Letter','Legal','Custom'].forEach(k => {
    const o = document.createElement('option'); o.value = k; o.textContent = k;
    fmtSelect.appendChild(o);
  });
  fmtSelect.value = tpl.page.format;
  fmtSelect.addEventListener('change', () => {
    tpl.page.format = fmtSelect.value;
    if (tpl.page.format !== 'Custom') {
      const s = PAGE_SIZES[tpl.page.format];
      tpl.page.width = s.width; tpl.page.height = s.height;
    }
    refresh();
  });
  fmtField.appendChild(fmtSelect);

  const row = el('div','rpt-row');
  const fw = field(row, 'Ширина, мм');
  const inpW = numInput(tpl.page.width, v => { tpl.page.width = v; refresh(); });
  inpW.disabled = tpl.page.format !== 'Custom';
  fw.appendChild(inpW);
  const fh = field(row, 'Высота, мм');
  const inpH = numInput(tpl.page.height, v => { tpl.page.height = v; refresh(); });
  inpH.disabled = tpl.page.format !== 'Custom';
  fh.appendChild(inpH);
  form.appendChild(row);

  const fo = field(form, 'Ориентация');
  const so = document.createElement('select');
  [['portrait','Книжная'], ['landscape','Альбомная']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    so.appendChild(o);
  });
  so.value = tpl.page.orientation;
  so.addEventListener('change', () => { tpl.page.orientation = so.value; refresh(); });
  fo.appendChild(so);

  // итоговый размер — подсказка
  const sz = pageSizeMm(tpl.page);
  const hint = el('div'); hint.style.fontSize = '11px'; hint.style.color = '#6b7280';
  hint.textContent = `Итого: ${sz.width.toFixed(1)} × ${sz.height.toFixed(1)} мм`;
  form.appendChild(hint);
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Поля»
// ——————————————————————————————————————————————————————————————————————
function buildMarginsTab(form, tpl, refresh) {
  sectionTitle(form, 'Поля печати, мм');
  ['top','right','bottom','left'].forEach(k => {
    const f = field(form, labelForMargin(k));
    f.appendChild(numInput(tpl.page.margins[k], v => { tpl.page.margins[k] = v; refresh(); }));
  });
}
function labelForMargin(k) {
  return ({ top: 'Верхнее', right: 'Правое', bottom: 'Нижнее', left: 'Левое' })[k];
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Колонтитулы»
// ——————————————————————————————————————————————————————————————————————
function buildHeaderFooterTab(form, tpl, refresh) {
  buildZone(form, tpl, 'header', 'firstPage',  'Шапка — первая страница', refresh);
  buildZone(form, tpl, 'header', 'otherPages', 'Шапка — последующие страницы', refresh);
  buildZone(form, tpl, 'footer', 'firstPage',  'Подвал — первая страница', refresh);
  buildZone(form, tpl, 'footer', 'otherPages', 'Подвал — последующие страницы', refresh);

  const help = el('div');
  help.style.fontSize = '11px';
  help.style.color = '#6b7280';
  help.style.marginTop = '12px';
  help.innerHTML = 'Доступные плейсхолдеры: <code>{{page}}</code>, <code>{{pages}}</code>, <code>{{date}}</code>, <code>{{meta.title}}</code>, <code>{{meta.author}}</code>.';
  form.appendChild(help);
}

function buildZone(form, tpl, kind, variant, title, refresh) {
  sectionTitle(form, title);
  const zone = tpl[kind][variant];

  const fEn = field(form, '');
  const lbl = el('label', 'chk');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = zone.enabled;
  cb.addEventListener('change', () => { zone.enabled = cb.checked; refresh(); });
  lbl.appendChild(cb);
  const span = document.createElement('span'); span.textContent = 'Включить зону';
  lbl.appendChild(span);
  fEn.appendChild(lbl);

  const fH = field(form, 'Высота, мм');
  fH.appendChild(numInput(zone.height, v => { zone.height = v; refresh(); }));

  // редактирование блоков колонтитула — простая схема: один текстовый
  // блок с выравниванием и стилем. Для сложных сценариев подпрограмма
  // сама заполнит blocks через API.
  const fT = field(form, 'Текст (или пусто)');
  const ta = document.createElement('textarea');
  const firstPara = (zone.blocks || []).find(b => b.type === 'paragraph');
  ta.value = firstPara ? (firstPara.text || '') : '';
  ta.addEventListener('input', () => {
    if (!firstPara) {
      zone.blocks = [ { type: 'paragraph', align: 'center', style: 'caption', text: ta.value } ];
    } else {
      firstPara.text = ta.value;
    }
    refresh();
  });
  fT.appendChild(ta);

  const fA = field(form, 'Выравнивание');
  const sa = document.createElement('select');
  [['left','По левому краю'],['center','По центру'],['right','По правому краю']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    sa.appendChild(o);
  });
  sa.value = (firstPara && firstPara.align) || 'center';
  sa.addEventListener('change', () => {
    const p = (zone.blocks || []).find(b => b.type === 'paragraph');
    if (p) { p.align = sa.value; refresh(); }
  });
  fA.appendChild(sa);
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Логотип»
// ——————————————————————————————————————————————————————————————————————
function buildLogoTab(form, tpl, refresh) {
  sectionTitle(form, 'Логотип');

  const fFile = field(form, 'Файл (PNG/JPEG)');
  const inpFile = document.createElement('input');
  inpFile.type = 'file';
  inpFile.accept = 'image/png,image/jpeg';
  inpFile.addEventListener('change', async () => {
    const f = inpFile.files && inpFile.files[0];
    if (!f) return;
    tpl.logo.src = await readAsDataUrl(f);
    refresh();
  });
  fFile.appendChild(inpFile);

  if (tpl.logo.src) {
    const rm = buttonEl('Убрать логотип');
    rm.addEventListener('click', () => { tpl.logo.src = null; refresh(); });
    form.appendChild(rm);
  }

  const fPos = field(form, 'Позиция');
  const sp = document.createElement('select');
  [
    ['header-left','Шапка слева'],['header-center','Шапка по центру'],['header-right','Шапка справа'],
    ['footer-left','Подвал слева'],['footer-center','Подвал по центру'],['footer-right','Подвал справа'],
  ].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    sp.appendChild(o);
  });
  sp.value = tpl.logo.position;
  sp.addEventListener('change', () => { tpl.logo.position = sp.value; refresh(); });
  fPos.appendChild(sp);

  const row = el('div','rpt-row');
  const fW = field(row, 'Ширина, мм');
  fW.appendChild(numInput(tpl.logo.width,  v => { tpl.logo.width  = v; refresh(); }));
  const fH = field(row, 'Высота, мм');
  fH.appendChild(numInput(tpl.logo.height, v => { tpl.logo.height = v; refresh(); }));
  form.appendChild(row);

  const fOnly = field(form, '');
  const lbl = el('label','chk');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!tpl.logo.onFirstPageOnly;
  cb.addEventListener('change', () => { tpl.logo.onFirstPageOnly = cb.checked; refresh(); });
  lbl.appendChild(cb);
  const t = document.createElement('span'); t.textContent = 'Только на первой странице';
  lbl.appendChild(t);
  fOnly.appendChild(lbl);
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Стили»
// ——————————————————————————————————————————————————————————————————————
function buildStylesTab(form, tpl, refresh) {
  const STYLES = [
    ['h1',      'Заголовок 1'],
    ['h2',      'Заголовок 2'],
    ['h3',      'Заголовок 3'],
    ['body',    'Основной текст'],
    ['caption', 'Подпись'],
    ['list',    'Элемент списка'],
  ];
  STYLES.forEach(([key, label]) => buildStyleCard(form, tpl, key, label, refresh));

  // Стиль таблицы — отдельный короткий блок
  const card = el('div', 'rpt-style-card');
  const h = document.createElement('h4'); h.textContent = 'Таблица'; card.appendChild(h);
  const row = el('div','rpt-row');
  const f1 = field(row,'Размер, pt');
  f1.appendChild(numInput(tpl.styles.table.size, v => { tpl.styles.table.size = v; refresh(); }, { step: 0.5 }));
  const f2 = field(row,'Фон шапки');
  f2.appendChild(colorInput(tpl.styles.table.headBg, v => { tpl.styles.table.headBg = v; refresh(); }));
  const f3 = field(row,'Границы');
  f3.appendChild(colorInput(tpl.styles.table.borderColor, v => { tpl.styles.table.borderColor = v; refresh(); }));
  card.appendChild(row);
  form.appendChild(card);
}

function buildStyleCard(form, tpl, key, label, refresh) {
  const s = tpl.styles[key];
  const card = el('div', 'rpt-style-card');
  const h = document.createElement('h4'); h.textContent = label; card.appendChild(h);

  const rFont = el('div','rpt-row');
  const fF = field(rFont,'Шрифт');
  const sf = document.createElement('select');
  FONT_FAMILIES.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; sf.appendChild(o); });
  sf.value = s.font;
  sf.addEventListener('change', () => { s.font = sf.value; refresh(); });
  fF.appendChild(sf);

  const fSz = field(rFont,'Размер, pt');
  fSz.appendChild(numInput(s.size, v => { s.size = v; refresh(); }, { step: 0.5 }));

  const fCl = field(rFont,'Цвет');
  fCl.appendChild(colorInput(s.color, v => { s.color = v; refresh(); }));
  card.appendChild(rFont);

  const rToggles = el('div','rpt-row');
  const fB = field(rToggles,'');
  fB.appendChild(checkbox('Жирный', s.bold, v => { s.bold = v; refresh(); }));
  const fI = field(rToggles,'');
  fI.appendChild(checkbox('Курсив', s.italic, v => { s.italic = v; refresh(); }));
  card.appendChild(rToggles);

  const rSpace = el('div','rpt-row');
  const fBf = field(rSpace,'Отступ до, мм');
  fBf.appendChild(numInput(s.spaceBefore || 0, v => { s.spaceBefore = v; refresh(); }, { step: 0.5 }));
  const fAf = field(rSpace,'Отступ после, мм');
  fAf.appendChild(numInput(s.spaceAfter || 0, v => { s.spaceAfter = v; refresh(); }, { step: 0.5 }));
  card.appendChild(rSpace);

  form.appendChild(card);
}

// ——————————————————————————————————————————————————————————————————————
// Вкладка «Метаданные»
// ——————————————————————————————————————————————————————————————————————
function buildMetaTab(form, tpl, refresh) {
  sectionTitle(form, 'Свойства документа');
  const fT = field(form, 'Заголовок');
  fT.appendChild(textInput(tpl.meta.title, v => { tpl.meta.title = v; refresh(); }));
  const fA = field(form, 'Автор');
  fA.appendChild(textInput(tpl.meta.author, v => { tpl.meta.author = v; refresh(); }));
  const fS = field(form, 'Тема');
  fS.appendChild(textInput(tpl.meta.subject, v => { tpl.meta.subject = v; refresh(); }));
}

// ——————————————————————————————————————————————————————————————————————
// мелкие хелперы
// ——————————————————————————————————————————————————————————————————————
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

function buttonEl(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

function field(parent, label) {
  const f = el('div','rpt-field');
  if (label) {
    const l = document.createElement('label');
    l.textContent = label;
    f.appendChild(l);
  }
  parent.appendChild(f);
  return f;
}

function sectionTitle(parent, text) {
  const s = el('div','rpt-section-title');
  s.textContent = text;
  parent.appendChild(s);
}

function numInput(value, onChange, opts = {}) {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = opts.step || 1;
  if (opts.min != null) i.min = opts.min;
  i.value = value;
  i.addEventListener('input', () => {
    const v = parseFloat(i.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  return i;
}

function textInput(value, onChange) {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value || '';
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

function colorInput(value, onChange) {
  const i = document.createElement('input');
  i.type = 'color';
  i.value = value || '#222222';
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

function checkbox(label, value, onChange) {
  const l = el('label','chk');
  const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!value;
  i.addEventListener('change', () => onChange(i.checked));
  l.appendChild(i);
  const s = document.createElement('span'); s.textContent = label;
  l.appendChild(s);
  return l;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
