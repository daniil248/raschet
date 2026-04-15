// ======================================================================
// shared/report/editor.js
// Canvas-редактор шаблона отчёта. Слева — вкладки свойств листа, зоны
// и properties выбранной зоны. Справа — холст со страницей, на котором
// пользователь перетаскивает логотип, колонтитулы и свободные текстовые
// зоны (инфо о компании, адресат, дата, произвольный текст).
//
// Важно: редактор не пересобирает форму на каждом вводе — иначе поля
// теряют фокус после одного символа. Форма собирается только при
// смене вкладки или смене выделения, а события ввода обновляют лишь
// данные и канвас.
//
// API:
//   import { openTemplateEditor } from '../shared/report/editor.js';
//   openTemplateEditor(tpl, {
//     onSave(newTpl) { ... },   // глубокая копия с правками
//     onCancel()     { ... },
//   });
// ======================================================================

import { PAGE_SIZES, FONT_FAMILIES, createTemplate, pageSizeMm } from './template.js';
import { renderPreview } from './preview.js';

let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = new URL('./editor.css', import.meta.url).href;
  document.head.appendChild(link);
  _cssInjected = true;
}

// ——————————————————————————————————————————————————————————————————————
// Пресеты зон — пользователь добавляет зону выбором из этого списка.
// Каждый пресет задаёт стартовый размер, стиль и текст-заглушку.
// ——————————————————————————————————————————————————————————————————————
const ZONE_PRESETS = [
  { id: 'title',       label: 'Заголовок документа', w: 120, h: 12, styleRef: 'h1',      text: '{{meta.title}}',                 align: 'left'   },
  { id: 'subtitle',    label: 'Подзаголовок',        w: 120, h:  9, styleRef: 'h2',      text: 'Подзаголовок',                   align: 'left'   },
  { id: 'company',     label: 'Информация о компании', w: 80, h: 16, styleRef: 'caption', text: 'ООО «Компания»\nАдрес, телефон', align: 'left'   },
  { id: 'addressee',   label: 'Адресат',             w: 80, h: 14, styleRef: 'caption', text: 'Кому: Ф.И.О.\nДолжность',         align: 'left'   },
  { id: 'date',        label: 'Дата',                w: 40, h:  6, styleRef: 'caption', text: '{{date}}',                        align: 'right'  },
  { id: 'pageNum',     label: 'Номер страницы',      w: 40, h:  6, styleRef: 'caption', text: 'стр. {{page}} из {{pages}}',      align: 'center' },
  { id: 'author',      label: 'Автор',               w: 60, h:  6, styleRef: 'caption', text: '{{meta.author}}',                 align: 'left'   },
  { id: 'freeText',    label: 'Свободный текст',     w: 80, h: 10, styleRef: 'body',    text: 'Текст',                           align: 'left'   },
];

// ——————————————————————————————————————————————————————————————————————
// Главная функция
// ——————————————————————————————————————————————————————————————————————
export function openTemplateEditor(tpl, opts = {}) {
  ensureCss();
  const working = createTemplate(tpl);
  if (!Array.isArray(working.overlays)) working.overlays = [];

  // ——— состояние ———
  const state = {
    activeTab:  'page',            // 'page' | 'zones' | 'props'
    selectedId: null,              // 'logo' | 'header' | 'footer' | overlay.id
    scale:      2.2,               // px на мм (пересчитывается по размеру холста)
  };

  // ——— DOM ———
  const backdrop = el('div', 'rpt-modal-backdrop');
  const modal    = el('div', 'rpt-modal rpt-modal--canvas');
  backdrop.appendChild(modal);

  const hdr = el('div', 'rpt-modal__hdr');
  const title = el('div', 'rpt-modal__title');
  title.textContent = 'Настройка шаблона отчёта';
  hdr.appendChild(title);
  const hdrBtns = el('div');
  const btnCancel = buttonEl('Отмена');
  const btnSave   = buttonEl('Сохранить', 'primary');
  hdrBtns.appendChild(btnCancel);
  hdrBtns.appendChild(btnSave);
  hdr.appendChild(hdrBtns);
  modal.appendChild(hdr);

  const body = el('div', 'rpt-modal__body');
  const sidebar  = el('div', 'rpt-editor__sidebar');
  const canvasWrap = el('div', 'rpt-editor__canvas-wrap');
  body.appendChild(sidebar);
  body.appendChild(canvasWrap);
  modal.appendChild(body);

  // Вкладки слева
  const tabs = el('div', 'rpt-editor__tabs');
  sidebar.appendChild(tabs);
  const tabContent = el('div', 'rpt-editor__tab-content');
  sidebar.appendChild(tabContent);

  const TABS = [
    { id: 'page',  label: 'Лист' },
    { id: 'zones', label: 'Зоны' },
    { id: 'props', label: 'Свойства' },
  ];
  const tabButtons = {};
  for (const t of TABS) {
    const b = buttonEl(t.label);
    b.className = '';
    b.addEventListener('click', () => {
      state.activeTab = t.id;
      rebuildTab();
      updateTabButtons();
    });
    tabButtons[t.id] = b;
    tabs.appendChild(b);
  }

  // Холст
  const canvas = el('div', 'rpt-canvas');
  canvasWrap.appendChild(canvas);

  document.body.appendChild(backdrop);

  // ——— первичный рендер ———
  computeScale();
  rebuildTab();
  updateTabButtons();
  redrawCanvas();

  // ——— события кнопок ———
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

  // Пересчёт масштаба при ресайзе окна
  const resizeObs = new ResizeObserver(() => {
    computeScale();
    redrawCanvas();
  });
  resizeObs.observe(canvasWrap);

  // ——————————————————————————————————————————————————————
  // Вспомогательные
  // ——————————————————————————————————————————————————————

  function updateTabButtons() {
    for (const t of TABS) {
      tabButtons[t.id].classList.toggle('active', t.id === state.activeTab);
    }
  }

  function computeScale() {
    const { width, height } = pageSizeMm(working.page);
    const padding = 48;
    const wrapRect = canvasWrap.getBoundingClientRect();
    const availW = Math.max(200, wrapRect.width - padding);
    const availH = Math.max(200, wrapRect.height - padding);
    state.scale = Math.min(availW / width, availH / height);
    if (!isFinite(state.scale) || state.scale <= 0) state.scale = 2.2;
  }

  // ——— перестройка формы (только при смене вкладки/выделения) ———
  function rebuildTab() {
    tabContent.innerHTML = '';
    if (state.activeTab === 'page')  buildPageTab(tabContent);
    if (state.activeTab === 'zones') buildZonesTab(tabContent);
    if (state.activeTab === 'props') buildPropsTab(tabContent);
  }

  // ——————————————————————————————————————————————————————
  // Вкладка «Лист»
  // ——————————————————————————————————————————————————————
  function buildPageTab(parent) {
    sectionTitle(parent, 'Формат');
    const fmtField = field(parent, 'Размер');
    const fmtSel = document.createElement('select');
    ['A3','A4','A5','Letter','Legal','Custom'].forEach(k => {
      const o = document.createElement('option'); o.value = k; o.textContent = k;
      fmtSel.appendChild(o);
    });
    fmtSel.value = working.page.format;
    fmtSel.addEventListener('change', () => {
      working.page.format = fmtSel.value;
      if (working.page.format !== 'Custom') {
        const sz = PAGE_SIZES[working.page.format];
        working.page.width = sz.width; working.page.height = sz.height;
        inpW.value = sz.width; inpH.value = sz.height;
      }
      inpW.disabled = working.page.format !== 'Custom';
      inpH.disabled = working.page.format !== 'Custom';
      computeScale(); redrawCanvas();
    });
    fmtField.appendChild(fmtSel);

    const row = el('div', 'rpt-row');
    const fw = field(row, 'Ширина, мм');
    const inpW = numInput(working.page.width, v => {
      working.page.width = v; computeScale(); redrawCanvas();
    });
    inpW.disabled = working.page.format !== 'Custom';
    fw.appendChild(inpW);
    const fh = field(row, 'Высота, мм');
    const inpH = numInput(working.page.height, v => {
      working.page.height = v; computeScale(); redrawCanvas();
    });
    inpH.disabled = working.page.format !== 'Custom';
    fh.appendChild(inpH);
    parent.appendChild(row);

    const fo = field(parent, 'Ориентация');
    const so = document.createElement('select');
    [['portrait','Книжная'],['landscape','Альбомная']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; so.appendChild(o);
    });
    so.value = working.page.orientation;
    so.addEventListener('change', () => {
      working.page.orientation = so.value;
      computeScale(); redrawCanvas();
    });
    fo.appendChild(so);

    sectionTitle(parent, 'Поля печати, мм');
    ['top','right','bottom','left'].forEach(k => {
      const f = field(parent, labelForMargin(k));
      f.appendChild(numInput(working.page.margins[k], v => {
        working.page.margins[k] = v;
        redrawCanvas();
      }));
    });

    sectionTitle(parent, 'Метаданные');
    const ft = field(parent, 'Заголовок');
    ft.appendChild(textInput(working.meta.title, v => {
      working.meta.title = v; redrawCanvas();
    }));
    const fa = field(parent, 'Автор');
    fa.appendChild(textInput(working.meta.author, v => {
      working.meta.author = v; redrawCanvas();
    }));
  }

  function labelForMargin(k) {
    return ({ top: 'Верхнее', right: 'Правое', bottom: 'Нижнее', left: 'Левое' })[k];
  }

  // ——————————————————————————————————————————————————————
  // Вкладка «Зоны»
  // ——————————————————————————————————————————————————————
  function buildZonesTab(parent) {
    sectionTitle(parent, 'Добавить зону');

    const grid = el('div', 'rpt-zone-grid');
    for (const p of ZONE_PRESETS) {
      const b = buttonEl('+ ' + p.label);
      b.className = 'rpt-zone-add-btn';
      b.addEventListener('click', () => {
        addOverlayFromPreset(p);
      });
      grid.appendChild(b);
    }
    parent.appendChild(grid);

    const logoFld = field(parent, 'Логотип');
    const logoBtn = buttonEl(working.logo.src ? '📷 Заменить логотип…' : '+ 📷 Добавить логотип');
    logoBtn.className = 'rpt-zone-add-btn';
    logoBtn.addEventListener('click', () => pickLogo());
    logoFld.appendChild(logoBtn);
    if (working.logo.src) {
      const rm = buttonEl('Убрать логотип');
      rm.className = 'rpt-zone-add-btn';
      rm.addEventListener('click', () => {
        working.logo.src = null;
        if (state.selectedId === 'logo') state.selectedId = null;
        rebuildTab();
        redrawCanvas();
      });
      logoFld.appendChild(rm);
    }

    sectionTitle(parent, 'Зоны на шаблоне');
    const listBox = el('div', 'rpt-zone-list');
    const items = listZoneItems();
    if (items.length === 0) {
      const empty = el('div', 'rpt-zone-list__empty');
      empty.textContent = 'Пока нет зон — добавьте из списка выше.';
      listBox.appendChild(empty);
    } else {
      for (const it of items) {
        const row = el('div', 'rpt-zone-list__item');
        if (it.id === state.selectedId) row.classList.add('active');
        row.textContent = it.label;
        row.addEventListener('click', () => {
          state.selectedId = it.id;
          state.activeTab = 'props';
          rebuildTab();
          updateTabButtons();
          redrawCanvas();
        });
        listBox.appendChild(row);
      }
    }
    parent.appendChild(listBox);
  }

  function listZoneItems() {
    const items = [];
    if (working.logo.src) items.push({ id: 'logo', label: '📷 Логотип' });
    for (const ov of working.overlays) {
      items.push({ id: ov.id, label: '▦ ' + shortText(ov.content?.text || '(пусто)') });
    }
    return items;
  }
  function shortText(s) {
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > 32 ? s.slice(0, 29) + '…' : s;
  }

  function addOverlayFromPreset(p) {
    // Новая зона помещается в центре печатной области
    const { width, height } = pageSizeMm(working.page);
    const m = working.page.margins;
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    const x = Math.max(m.left, m.left + (pw - p.w) / 2);
    const y = Math.max(m.top,  m.top  + (ph - p.h) / 2);
    const id = 'ov-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    working.overlays.push({
      id, type: 'text', scope: 'all',
      x: round1(x), y: round1(y),
      width: p.w, height: p.h,
      content: { text: p.text, styleRef: p.styleRef, align: p.align },
    });
    state.selectedId = id;
    state.activeTab  = 'props';
    rebuildTab();
    updateTabButtons();
    redrawCanvas();
  }

  function pickLogo() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      working.logo.src = await readAsDataUrl(f);
      // если логотип только что появился — разместим его в левом верхнем углу
      if (!working.logo.width)  working.logo.width  = 30;
      if (!working.logo.height) working.logo.height = 15;
      state.selectedId = 'logo';
      rebuildTab();
      redrawCanvas();
    });
    inp.click();
  }

  // ——————————————————————————————————————————————————————
  // Вкладка «Свойства»
  // ——————————————————————————————————————————————————————
  function buildPropsTab(parent) {
    const id = state.selectedId;
    if (!id) {
      const hint = el('div', 'rpt-hint');
      hint.textContent = 'Кликните зону на холсте или в списке зон, чтобы настроить её свойства.';
      parent.appendChild(hint);
      return;
    }

    if (id === 'logo' && working.logo.src) {
      buildLogoProps(parent);
      return;
    }
    const ov = working.overlays.find(o => o.id === id);
    if (ov) {
      buildOverlayProps(parent, ov);
      return;
    }
    const hint = el('div', 'rpt-hint');
    hint.textContent = 'Зона не найдена.';
    parent.appendChild(hint);
  }

  function buildLogoProps(parent) {
    sectionTitle(parent, 'Логотип');
    // Предпросмотр
    const img = document.createElement('img');
    img.src = working.logo.src;
    img.className = 'rpt-logo-preview';
    parent.appendChild(img);

    const row = el('div', 'rpt-row');
    const fW = field(row, 'Ширина, мм');
    fW.appendChild(numInput(working.logo.width, v => {
      working.logo.width = v; redrawCanvas();
    }));
    const fH = field(row, 'Высота, мм');
    fH.appendChild(numInput(working.logo.height, v => {
      working.logo.height = v; redrawCanvas();
    }));
    parent.appendChild(row);

    const fOnly = field(parent, '');
    const lbl = el('label', 'chk');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!working.logo.onFirstPageOnly;
    cb.addEventListener('change', () => {
      working.logo.onFirstPageOnly = cb.checked; redrawCanvas();
    });
    lbl.appendChild(cb);
    const sp = document.createElement('span');
    sp.textContent = 'Только на первой странице';
    lbl.appendChild(sp);
    fOnly.appendChild(lbl);

    const rm = buttonEl('Удалить логотип', 'danger');
    rm.addEventListener('click', () => {
      working.logo.src = null;
      state.selectedId = null;
      state.activeTab = 'zones';
      rebuildTab();
      updateTabButtons();
      redrawCanvas();
    });
    parent.appendChild(rm);
  }

  function buildOverlayProps(parent, ov) {
    sectionTitle(parent, 'Зона текста');

    const fT = field(parent, 'Текст');
    const ta = document.createElement('textarea');
    ta.value = ov.content.text || '';
    ta.rows = 4;
    ta.addEventListener('input', () => {
      ov.content.text = ta.value;
      redrawCanvas();
    });
    fT.appendChild(ta);

    const hint = el('div', 'rpt-hint');
    hint.innerHTML = 'Плейсхолдеры: <code>{{meta.title}}</code>, <code>{{meta.author}}</code>, <code>{{date}}</code>, <code>{{page}}</code>, <code>{{pages}}</code>';
    parent.appendChild(hint);

    const fS = field(parent, 'Стиль');
    const sSel = document.createElement('select');
    [['h1','Заголовок 1'],['h2','Заголовок 2'],['h3','Заголовок 3'],['body','Основной'],['caption','Подпись']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; sSel.appendChild(o);
    });
    sSel.value = ov.content.styleRef || 'body';
    sSel.addEventListener('change', () => {
      ov.content.styleRef = sSel.value; redrawCanvas();
    });
    fS.appendChild(sSel);

    const fA = field(parent, 'Выравнивание');
    const aSel = document.createElement('select');
    [['left','Слева'],['center','По центру'],['right','Справа']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; aSel.appendChild(o);
    });
    aSel.value = ov.content.align || 'left';
    aSel.addEventListener('change', () => {
      ov.content.align = aSel.value; redrawCanvas();
    });
    fA.appendChild(aSel);

    const fSc = field(parent, 'На каких страницах');
    const scSel = document.createElement('select');
    [['all','На всех'],['first','Только на первой'],['other','На всех кроме первой']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; scSel.appendChild(o);
    });
    scSel.value = ov.scope || 'all';
    scSel.addEventListener('change', () => {
      ov.scope = scSel.value; redrawCanvas();
    });
    fSc.appendChild(scSel);

    sectionTitle(parent, 'Положение и размер');
    const row1 = el('div', 'rpt-row');
    const fx = field(row1, 'X, мм');
    fx.appendChild(numInput(round1(ov.x), v => { ov.x = clampX(v, ov); redrawCanvas(); }));
    const fy = field(row1, 'Y, мм');
    fy.appendChild(numInput(round1(ov.y), v => { ov.y = clampY(v, ov); redrawCanvas(); }));
    parent.appendChild(row1);
    const row2 = el('div', 'rpt-row');
    const fw = field(row2, 'Ширина, мм');
    fw.appendChild(numInput(round1(ov.width), v => { ov.width = Math.max(10, v); redrawCanvas(); }));
    const fh = field(row2, 'Высота, мм');
    fh.appendChild(numInput(round1(ov.height), v => { ov.height = Math.max(4, v); redrawCanvas(); }));
    parent.appendChild(row2);

    const rmBtn = buttonEl('Удалить зону', 'danger');
    rmBtn.addEventListener('click', () => {
      working.overlays = working.overlays.filter(o => o.id !== ov.id);
      state.selectedId = null;
      state.activeTab = 'zones';
      rebuildTab();
      updateTabButtons();
      redrawCanvas();
    });
    parent.appendChild(rmBtn);
  }

  // ——————————————————————————————————————————————————————
  // Холст
  // ——————————————————————————————————————————————————————
  function redrawCanvas() {
    canvas.innerHTML = '';
    const { width, height } = pageSizeMm(working.page);
    const m = working.page.margins;
    const s = state.scale;

    const page = el('div', 'rpt-cv-page');
    page.style.width  = (width  * s) + 'px';
    page.style.height = (height * s) + 'px';
    canvas.appendChild(page);

    // поля печати — пунктирная рамка
    const box = el('div', 'rpt-cv-printarea');
    box.style.left   = (m.left  * s) + 'px';
    box.style.top    = (m.top   * s) + 'px';
    box.style.width  = ((width  - m.left - m.right)  * s) + 'px';
    box.style.height = ((height - m.top  - m.bottom) * s) + 'px';
    page.appendChild(box);

    // «Зона отчёта» — подсказка в центре
    const bodyLabel = el('div', 'rpt-cv-body-label');
    bodyLabel.textContent = 'Зона отчёта\n(сюда подпрограмма подставит содержимое)';
    page.appendChild(bodyLabel);
    bodyLabel.style.left = (m.left * s) + 'px';
    bodyLabel.style.top  = (m.top  * s) + 'px';
    bodyLabel.style.width  = ((width  - m.left - m.right)  * s) + 'px';
    bodyLabel.style.height = ((height - m.top  - m.bottom) * s) + 'px';

    // Логотип
    if (working.logo.src) {
      const lz = el('div', 'rpt-cv-zone rpt-cv-zone--logo');
      const lx = getLogoXY();
      lz.style.left   = (lx.x * s) + 'px';
      lz.style.top    = (lx.y * s) + 'px';
      lz.style.width  = (working.logo.width  * s) + 'px';
      lz.style.height = (working.logo.height * s) + 'px';
      if (state.selectedId === 'logo') lz.classList.add('selected');
      const img = document.createElement('img');
      img.src = working.logo.src;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.draggable = false;
      lz.appendChild(img);
      attachZoneHandlers(lz, 'logo');
      const rz = el('div', 'rpt-cv-resize');
      lz.appendChild(rz);
      attachResizeHandlers(rz, 'logo');
      page.appendChild(lz);
    }

    // Overlay-зоны
    for (const ov of working.overlays) {
      const zd = el('div', 'rpt-cv-zone rpt-cv-zone--text');
      zd.style.left   = (ov.x * s) + 'px';
      zd.style.top    = (ov.y * s) + 'px';
      zd.style.width  = (ov.width  * s) + 'px';
      zd.style.height = (ov.height * s) + 'px';
      if (state.selectedId === ov.id) zd.classList.add('selected');
      const inner = el('div', 'rpt-cv-zone__text');
      const st = working.styles[ov.content.styleRef || 'body'] || working.styles.body;
      inner.style.fontFamily = st.font;
      inner.style.fontSize   = (st.size * 0.9) + 'pt'; // чуть уменьшаем для экрана
      inner.style.fontWeight = st.bold ? '700' : '400';
      inner.style.fontStyle  = st.italic ? 'italic' : 'normal';
      inner.style.color      = st.color;
      inner.style.lineHeight = st.lineHeight;
      inner.style.textAlign  = ov.content.align || 'left';
      inner.textContent = (ov.content.text || '').replace(/\{\{(\w+\.?\w*)\}\}/g, (_, k) => '{{' + k + '}}');
      zd.appendChild(inner);
      const rz = el('div', 'rpt-cv-resize');
      zd.appendChild(rz);
      attachZoneHandlers(zd, ov.id);
      attachResizeHandlers(rz, ov.id);
      page.appendChild(zd);
    }

    // Клик по пустому месту — снять выделение
    page.addEventListener('mousedown', (e) => {
      if (e.target === page || e.target === box || e.target === bodyLabel) {
        if (state.selectedId) {
          state.selectedId = null;
          if (state.activeTab === 'props') rebuildTab();
          redrawCanvas();
        }
      }
    });
  }

  function getLogoXY() {
    // Если у логотипа есть абсолютные x/y — используем, иначе считаем по
    // legacy position (header-left / center / right и т.д.)
    if (typeof working.logo.x === 'number' && typeof working.logo.y === 'number') {
      return { x: working.logo.x, y: working.logo.y };
    }
    const { width, height } = pageSizeMm(working.page);
    const m = working.page.margins;
    const pos = working.logo.position || 'header-left';
    const isHeader = pos.startsWith('header');
    const y = isHeader ? m.top : (height - m.bottom - working.logo.height);
    let x = m.left;
    if (pos.endsWith('center')) x = (width - working.logo.width) / 2;
    if (pos.endsWith('right'))  x = width - m.right - working.logo.width;
    return { x, y };
  }

  // ——————————————————————————————————————————————————————
  // Drag & resize
  // ——————————————————————————————————————————————————————
  function attachZoneHandlers(el, id) {
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('rpt-cv-resize')) return;
      e.preventDefault();
      state.selectedId = id;
      if (state.activeTab === 'props') rebuildTab();
      redrawCanvas();

      const s = state.scale;
      const startX = e.clientX, startY = e.clientY;
      const start = snapshot(id);
      if (!start) return;

      const onMove = (ev) => {
        const dxMm = (ev.clientX - startX) / s;
        const dyMm = (ev.clientY - startY) / s;
        let nx = start.x + dxMm;
        let ny = start.y + dyMm;
        const clamped = clampBox(nx, ny, start.width, start.height);
        applyPos(id, clamped.x, clamped.y);
        redrawCanvas();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup',   onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onUp);
    });
  }

  function attachResizeHandlers(el, id) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const s = state.scale;
      const startX = e.clientX, startY = e.clientY;
      const start = snapshot(id);
      if (!start) return;

      const onMove = (ev) => {
        const dxMm = (ev.clientX - startX) / s;
        const dyMm = (ev.clientY - startY) / s;
        let nw = Math.max(10, start.width  + dxMm);
        let nh = Math.max(4,  start.height + dyMm);
        // не вылезаем за печатную область
        const { width, height } = pageSizeMm(working.page);
        const m = working.page.margins;
        nw = Math.min(nw, width  - m.right  - start.x);
        nh = Math.min(nh, height - m.bottom - start.y);
        applySize(id, nw, nh);
        redrawCanvas();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup',   onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onUp);
    });
  }

  function snapshot(id) {
    if (id === 'logo') {
      const p = getLogoXY();
      return { x: p.x, y: p.y, width: working.logo.width, height: working.logo.height };
    }
    const ov = working.overlays.find(o => o.id === id);
    if (!ov) return null;
    return { x: ov.x, y: ov.y, width: ov.width, height: ov.height };
  }
  function applyPos(id, x, y) {
    if (id === 'logo') { working.logo.x = round1(x); working.logo.y = round1(y); return; }
    const ov = working.overlays.find(o => o.id === id);
    if (!ov) return;
    ov.x = round1(x); ov.y = round1(y);
  }
  function applySize(id, w, h) {
    if (id === 'logo') { working.logo.width = round1(w); working.logo.height = round1(h); return; }
    const ov = working.overlays.find(o => o.id === id);
    if (!ov) return;
    ov.width = round1(w); ov.height = round1(h);
  }

  function clampBox(x, y, w, h) {
    const { width, height } = pageSizeMm(working.page);
    const m = working.page.margins;
    const minX = m.left, minY = m.top;
    const maxX = width  - m.right  - w;
    const maxY = height - m.bottom - h;
    return {
      x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
    };
  }
  function clampX(x, ov) {
    return clampBox(x, ov.y, ov.width, ov.height).x;
  }
  function clampY(y, ov) {
    return clampBox(ov.x, y, ov.width, ov.height).y;
  }
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
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function round1(v) { return Math.round(v * 10) / 10; }
