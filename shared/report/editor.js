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

import { PAGE_SIZES, FONT_FAMILIES, createTemplate, pageSizeMm, migrateToFlow, applyBaseChrome, mergePageGeom }
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
  { type: 'sectionBreak', label: '⮐ Разрыв раздела (ориентация)', mk: () => ({ type: 'sectionBreak', page: { orientation: 'landscape' } }) },
];

const TYPE_LABEL = {
  docTitle: 'Заголовок документа', companyInfo: 'Реквизиты компании',
  addressee: 'Адресат', metaLine: 'Дата/№', tocAuto: 'Содержание',
  signature: 'Подпись ответственного', stamp: 'Печать',
  sectionBreak: 'Разрыв раздела', heading: 'Заголовок', paragraph: 'Абзац', list: 'Список',
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

  // Документ открывается на «Основе» (обязательный выбор базы),
  // базовый — на «Колонтитулах». renderTabs всё равно подстрахует.
  const state = { tab: working.level === 'base' ? 'psections' : 'base', sel: -1, zoom: 1 };

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

  // Зум-управление — в ШАПКЕ модалки (рядом с Отмена/Сохранить),
  // а не плавающей панелью над превью.
  const zWrap = el('div');
  zWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:10px';
  const zLabel = el('span');
  zLabel.style.cssText = 'min-width:42px;text-align:center;color:#475569;font:12px system-ui';
  const setZoom = (z) => { state.zoom = Math.max(0.4, Math.min(3, z)); zLabel.textContent = Math.round(state.zoom * 100) + '%'; renderPane(); };
  const zMinus = btn('−'); zMinus.style.padding = '2px 9px';
  zMinus.addEventListener('click', () => setZoom(state.zoom - 0.1));
  const zPlus = btn('+'); zPlus.style.padding = '2px 9px';
  zPlus.addEventListener('click', () => setZoom(state.zoom + 0.1));
  const zFit = btn('⤢ Вписать'); zFit.style.padding = '2px 8px';
  zFit.addEventListener('click', () => setZoom(1));
  const zFull = btn('⛶ Весь экран');
  zFull.style.padding = '2px 8px';
  let _full = false;
  // Полноэкранный режим через CSS-класс (не cssText: тот стирал
  // flex-раскладку, шапка с кнопкой «Свернуть» пропадала — Пользователь
  // не мог выйти иначе чем Esc). Класс сохраняет колонку flex и держит
  // шапку sticky сверху.
  const setFull = (on) => {
    _full = on;
    modal.classList.toggle('rpt-modal--full', on);
    zFull.textContent = on ? '⤡ Свернуть' : '⛶ Весь экран';
    setTimeout(renderPane, 30);
  };
  zFull.addEventListener('click', () => setFull(!_full));
  zWrap.appendChild(zMinus); zWrap.appendChild(zLabel); zWrap.appendChild(zPlus);
  zWrap.appendChild(zFit); zWrap.appendChild(zFull);
  hb.insertBefore(zWrap, bCancel);

  const previewEl = el('div', 'rpt-canvas');
  previewWrap.appendChild(previewEl);
  zLabel.textContent = '100%';

  // Панорамирование/зум по общим правилам (memory feedback_zoom_
  // ctrl_scroll): колесо БЕЗ Ctrl — нативный скролл (пан), Ctrl+
  // колесо — зум; ЛКМ-перетаскивание по фону — grab-пан.
  previewWrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    setZoom(state.zoom + (ev.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  let _pan = null;
  previewWrap.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest('.rpt-overlay, img, input, textarea, select, button')) return;
    _pan = { x: ev.clientX, y: ev.clientY, sl: previewWrap.scrollLeft, st: previewWrap.scrollTop };
    previewWrap.style.cursor = 'grabbing';
    ev.preventDefault();
  });
  const onPanMove = (ev) => {
    if (!_pan) return;
    previewWrap.scrollLeft = _pan.sl - (ev.clientX - _pan.x);
    previewWrap.scrollTop  = _pan.st - (ev.clientY - _pan.y);
  };
  const onPanUp = () => { _pan = null; previewWrap.style.cursor = ''; };
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);

  const TAB_LABEL = {
    base: 'Основа', structure: 'Структура', sections: 'Разделы',
    chrome: 'Колонтитулы', floating: 'Слой', page: 'Лист', styles: 'Стили',
    psections: 'Разделы',
  };
  // Двухуровневая модель (требование Пользователя):
  //  • БАЗОВЫЙ шаблон = только оформление: поля/размер страницы,
  //    колонтитулы, стили. Никакого выбора «типа» (тип задаётся при
  //    создании вкладкой Документы/Базовые) и никакой структуры.
  //  • Шаблон ДОКУМЕНТА = выбор базового шаблона (обязателен — без
  //    него нет оформления) + свой порядок блоков и разделы + слой.
  //    Поля/колонтитулы/стили НЕ редактируются здесь — они из базы.
  const visibleTabs = () => (working.level === 'base'
    ? ['psections', 'styles']
    : ['base', 'structure', 'sections', 'floating']
  ).map(id => [id, TAB_LABEL[id]]);
  const tabBtns = {};
  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const k of Object.keys(tabBtns)) delete tabBtns[k];
    const vis = visibleTabs();
    if (!vis.some(([id]) => id === state.tab)) state.tab = vis[0][0];
    for (const [id, label] of vis) {
      const b = btn(label);
      b.className = '';
      b.addEventListener('click', () => { state.tab = id; rebuild(); });
      tabBtns[id] = b;
      tabsEl.appendChild(b);
    }
  }

  document.body.appendChild(backdrop);
  rebuild();

  // Двухуровневая модель: документ наследует chrome базы (превью
  // отражает реальную геометрию/колонтитулы/стили базы).
  if (working.baseTemplateId) {
    import('../report-catalog.js').then(Cat => {
      try {
        const b = Cat.getTemplate(working.baseTemplateId);
        if (b && b.template) { applyBaseChrome(working, b.template); rebuild(); }
      } catch (e) { /* база недоступна */ }
    }).catch(() => {});
  }

  const close = (save) => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('mousemove', onPanMove);
    window.removeEventListener('mouseup', onPanUp);
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
    if (e.key === 'Escape' && !inField) {
      // Esc в полноэкранном — сначала сворачиваем, не закрываем редактор.
      if (_full) { setFull(false); return; }
      close(false);
    }
  }
  window.addEventListener('keydown', onKey);

  // ——————————————————————————————————————————————————————
  function rebuild() {
    renderTabs();
    for (const id of Object.keys(tabBtns)) tabBtns[id].classList.toggle('active', id === state.tab);
    tabContent.innerHTML = '';
    if (state.tab === 'psections') buildPSections(tabContent);
    else if (state.tab === 'base') buildBase(tabContent);
    else if (state.tab === 'structure') buildStructure(tabContent);
    else if (state.tab === 'sections') buildSections(tabContent);
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
      const fit = Math.max(1.4, Math.min(3.4, avail / width));
      // mode:'edit' → видны направляющие полей печати (.rpt-page__margins)
      // guides:true — видны поля печати; pageLabel:false — без
      // служебной «Стр. N из M» (она дублировала номер из колонтитула
      // → «2 колонтитула» в репорте Пользователя).
      renderPreview(working, previewEl,
        { mode: 'edit', guides: true, pageLabel: false, scale: fit * (state.zoom || 1) });
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

      // Drag-and-drop ручная перестановка блоков.
      row.draggable = true;
      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', String(i));
        row.style.opacity = '0.45';
      });
      row.addEventListener('dragend', () => { row.style.opacity = ''; });
      row.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        row.style.borderTop = '2px solid #1976d2';
      });
      row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        row.style.borderTop = '';
        const from = parseInt(ev.dataTransfer.getData('text/plain'), 10);
        if (Number.isInteger(from) && from !== i) moveBlockTo(from, i);
      });

      const grip = el('span');
      grip.textContent = '⠿';
      grip.title = 'Перетащить для перестановки';
      grip.style.cssText = 'cursor:grab;color:#94a3b8;padding:0 2px;user-select:none';
      row.appendChild(grip);

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

  // Перенос блока from→to (drag-and-drop).
  function moveBlockTo(from, to) {
    const a = working.flow;
    if (from < 0 || from >= a.length || to < 0 || to >= a.length) return;
    const [moved] = a.splice(from, 1);
    a.splice(to, 0, moved);
    state.sel = to;
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
    if (b.type === 'sectionBreak') {
      const o = b.page && b.page.orientation;
      return '⮐ Разрыв раздела' + (o ? ' · ' + (o === 'landscape' ? 'альбомная' : 'книжная') : '') +
        (b.page && b.page.format ? ' · ' + b.page.format : '');
    }
    if (b.section) return '▸ ' + (b.sectionLabel || t) + ' · ' + t;
    const txt = (b.text || (Array.isArray(b.items) ? b.items[0] : '') || '').toString();
    return '· ' + t + (txt ? ' — ' + txt.slice(0, 28) : '');
  }

  // ——— Вкладка «Разделы» (Word-аналог: разделы документа с
  // посекционными настройками страницы) ———
  //
  // Разделы выводятся ИЗ потока: блок sectionBreak начинает новый
  // раздел (новая страница + смена геометрии до следующего break),
  // ровно как flowSegments в PDF/превью. Здесь — наглядный список
  // вместо поиска настройки в свойствах блока-разрыва.
  function docSections() {
    const flow = Array.isArray(working.flow) ? working.flow : [];
    const list = [];
    let cur = { brk: null, brkIdx: -1, blocks: [] };
    flow.forEach((b, i) => {
      if (b && b.type === 'sectionBreak') {
        list.push(cur);
        cur = { brk: b, brkIdx: i, blocks: [] };
      } else {
        cur.blocks.push(b);
      }
    });
    list.push(cur);
    const ps = Array.isArray(working.pageSections) ? working.pageSections : [];
    if (ps.length) {
      // По-раздельная модель: геометрия из выбранного раздела базы.
      let idx = 0;
      list.forEach((s, k) => {
        if (k > 0) {
          const ref = s.brk && s.brk.sectionRef;
          const f = ref != null ? ps.find(x => x.id === ref || x.name === ref) : null;
          idx = f ? ps.indexOf(f) : Math.min(idx + 1, ps.length - 1);
        }
        const sec = ps[Math.min(idx, ps.length - 1)] || {};
        s.secName = sec.name;
        s.geom = mergePageGeom(working.page || {}, sec.page);
      });
      return list;
    }
    // Legacy: кумулятивная геометрия (как в flowSegments).
    let geom = mergePageGeom(working.page || {}, working.firstPage && working.firstPage.page);
    list.forEach((s, k) => {
      if (k > 0) geom = mergePageGeom(geom, s.brk && s.brk.page);
      s.geom = geom;
    });
    return list;
  }

  function buildSections(p) {
    const hint = el('div', 'rpt-hint');
    hint.innerHTML = 'Формат и поля разделов берутся из <b>базового шаблона</b> ' +
      '(вкладка «Основа»). В документе их отдельно настраивать нельзя — ' +
      'можно лишь добавить разрыв раздела (новая страница) и для него ' +
      'выбрать ориентацию (книжная/альбомная).';
    p.appendChild(hint);

    const addRow = el('div', 'rpt-zone-add');
    const aS = btn('+ Добавить раздел (разрыв)');
    aS.className = 'rpt-zone-add-btn';
    aS.addEventListener('click', () => {
      const blk = { type: 'sectionBreak', page: { orientation: 'landscape' } };
      const sgIdx = working.flow.findIndex(x => x && x.section === 'doc-sign');
      if (sgIdx < 0) working.flow.push(blk);
      else working.flow.splice(sgIdx, 0, blk);
      rebuild();
    });
    addRow.appendChild(aS);
    p.appendChild(addRow);

    const secs = docSections();
    secs.forEach((s, k) => {
      const card = el('div', 'rpt-style-card');
      const h = document.createElement('h4');
      const g = s.geom || {};
      const oTxt = (g.orientation === 'landscape' ? 'альбомная' : 'книжная');
      h.textContent = (k === 0 ? '📄 Раздел 1 · основной' : '⮐ Раздел ' + (k + 1)) +
        ' · ' + (g.format || 'A4') + ' · ' + oTxt +
        ' · блоков: ' + s.blocks.length;
      card.appendChild(h);

      if (k === 0) {
        const g = s.geom || {};
        const m = g.margins || {};
        const ro = el('div', 'rpt-hint');
        ro.innerHTML = 'Геометрия из базового шаблона (только просмотр): ' +
          '<b>' + (g.format || 'A4') + '</b>, ' +
          (g.orientation === 'landscape' ? 'альбомная' : 'книжная') +
          ', поля ' + [m.top, m.right, m.bottom, m.left]
            .map(x => x == null ? '—' : x).join(' / ') + ' мм. ' +
          'Изменить — во вкладке «Основа» (сменить базу) либо в самом ' +
          'базовом шаблоне.';
        card.appendChild(ro);
      } else {
        // Документ ЯВНО выбирает именованный раздел БАЗЫ (требование
        // Пользователя). Геометрия/колонтитул — из выбранного раздела.
        const ps = Array.isArray(working.pageSections) ? working.pageSections : [];
        if (ps.length) {
          fld(card, 'Раздел базы', selectInput(
            [['', '(следующий по порядку)'], ...ps.map(x => [x.id, x.name])],
            s.brk.sectionRef || '', v => {
              s.brk.sectionRef = v || undefined;
              if (s.brk.page) delete s.brk.page;   // геометрия из базы
              rebuild();
            }));
        } else {
          const bp = s.brk.page || (s.brk.page = {});
          fld(card, 'Ориентация раздела', selectInput(
            [['', '(как в базе)'], ['portrait', 'Книжная'], ['landscape', 'Альбомная']],
            bp.orientation || '', v => {
              bp.orientation = v || undefined;
              delete bp.format; delete bp.margins;
              rebuild();
            }));
        }
        const act = el('div', 'rpt-row');
        const go = btn('→ К блоку-разрыву');
        go.addEventListener('click', () => {
          state.tab = 'structure'; state.sel = s.brkIdx; rebuild();
        });
        const del = btn('✕ Удалить раздел', 'danger');
        del.title = 'Убрать разрыв — блоки сольются с предыдущим разделом';
        del.addEventListener('click', () => {
          const idx = working.flow.indexOf(s.brk);
          if (idx >= 0) working.flow.splice(idx, 1);
          state.sel = -1;
          rebuild();
        });
        act.appendChild(go); act.appendChild(del);
        card.appendChild(act);
      }

      // Блоки раздела (только чтение — перестановка во вкладке «Структура»).
      const bl = el('div', 'rpt-hint');
      bl.style.marginTop = '6px';
      bl.textContent = s.blocks.length
        ? 'Блоки: ' + s.blocks.map(b => blockLabel(b).replace(/^[^\wА-Яа-я]+\s*/, '')).join(' · ')
        : '(нет блоков — добавьте во вкладке «Структура»)';
      card.appendChild(bl);

      p.appendChild(card);
    });
  }

  function buildBlockProps(p, b) {
    if (b.type === 'sectionBreak') {
      if (!b.page || typeof b.page !== 'object') b.page = {};
      const h = el('div', 'rpt-hint');
      h.textContent = 'Новый раздел (новая страница). Выберите, на какой именованный раздел базового шаблона переключиться — его геометрия и колонтитул применятся отсюда.';
      p.appendChild(h);
      const psB = Array.isArray(working.pageSections) ? working.pageSections : [];
      if (psB.length) {
        fld(p, 'Раздел базы', selectInput(
          [['', '(следующий по порядку)'], ...psB.map(x => [x.id, x.name])],
          b.sectionRef || '', v => {
            b.sectionRef = v || undefined;
            if (b.page) delete b.page;
            renderPane();
          }));
      } else {
        fld(p, 'Ориентация раздела', selectInput(
          [['', '(как в базе)'], ['portrait', 'Книжная'], ['landscape', 'Альбомная']],
          b.page.orientation || '', v => {
            b.page.orientation = v || undefined;
            delete b.page.format; delete b.page.margins;
            renderPane();
          }));
      }
      return;
    }
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
    // Колонтитул в поле страницы; ширина — отдельно от области печати:
    // в пределах полей / вся страница / за край листа.
    fld(p, 'Ширина', selectInput(
      [['print', 'В пределах полей'], ['page', 'Вся ширина листа'],
       ['bleed', 'За край листа (вылет)']],
      band.width || 'print', v => { band.width = v; rebuild(); }));
    if (band.width === 'bleed') {
      fld(p, 'Вылет за край, мм', numInput(
        band.bleed != null ? band.bleed : 10,
        v => { band.bleed = v; renderPane(); }));
    }
    const first = (band.blocks && band.blocks[0]) || null;
    const txt = first && first.text || '';
    // Многострочный текст: название/версия/заголовок и пр. (перенос
    // строк сохраняется — \n и в превью, и в PDF/DOCX).
    fld(p, 'Текст (можно несколько строк)', textArea(txt, v => {
      band.blocks = v ? [{ type: 'paragraph', style: 'caption',
        align: (first && first.align) || 'center', text: v }] : [];
      renderPane();
    }));
    const hh = el('div', 'rpt-hint');
    hh.innerHTML = 'Плейсхолдеры: <code>{{meta.title}}</code> ' +
      '<code>{{meta.author}}</code> <code>{{meta.subject}}</code> ' +
      '<code>{{meta.version}}</code> <code>{{date}}</code> ' +
      '<code>{{page}}</code> <code>{{pages}}</code>. Enter — новая строка.';
    p.appendChild(hh);
    fld(p, 'Выравнивание по горизонтали', selectInput(
      [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']],
      (first && first.align) || 'center', v => {
        if (band.blocks && band.blocks[0]) { band.blocks[0].align = v; renderPane(); }
      }));
    fld(p, 'Выравнивание по вертикали', selectInput(
      [['top', 'Сверху'], ['middle', 'По центру'], ['bottom', 'Снизу']],
      band.valign || 'middle', v => { band.valign = v; renderPane(); }));
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
  // ——— Вкладка «Основа» (только для шаблона ДОКУМЕНТА) ———
  // Документ обязан ссылаться на базовый шаблон: из него берутся
  // поля/размер/колонтитулы/стили/обложка. Без базы документ
  // нерабочий — поэтому выбор обязателен и при отсутствии
  // авто-подставляется первый доступный базовый.
  function buildBase(p) {
    sect(p, 'Базовый шаблон (обязателен)');
    const hint = el('div', 'rpt-hint');
    hint.textContent = 'Документ наследует поля, размер страницы, колонтитулы и стили из выбранного базового шаблона. Здесь — только выбор базы; сами поля/стили правятся в базовом шаблоне.';
    p.appendChild(hint);

    const warn = el('div', 'rpt-hint');
    warn.style.cssText = 'color:#b91c1c;font-weight:600';

    const baseFld = fld(p, 'База', selectInput([['', '— выберите базовый шаблон —']],
      working.baseTemplateId || '', null));
    const sel = baseFld.querySelector('select');
    sel.disabled = true;
    p.appendChild(warn);

    const syncWarn = () => {
      warn.style.color = working.baseTemplateId ? '#15803d' : '#b45309';
      warn.textContent = working.baseTemplateId
        ? '✓ Оформление наследуется из выбранной базы.'
        : '⚠ База не выбрана — пока используется собственное оформление документа. Рекомендуется выбрать базовый шаблон.';
    };
    syncWarn();

    import('../report-catalog.js').then(Cat => {
      const bases = (Cat.listTemplates() || [])
        .filter(t => t.template && t.template.level === 'base');
      sel.innerHTML = '';
      const o0 = document.createElement('option');
      o0.value = ''; o0.textContent = '— выберите базовый шаблон —';
      sel.appendChild(o0);
      for (const t of bases) {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.name;
        sel.appendChild(o);
      }
      // Без авто-подстановки: произвольная база исказила бы
      // оформление (напр. альбомная «Ведомость» сломала бы книжный
      // «Инженерный отчёт»). База выбирается осознанно; до выбора
      // документ использует собственное встроенное оформление.
      sel.value = working.baseTemplateId || '';
      sel.disabled = false;
      syncWarn();
      if (!bases.length) {
        warn.textContent = '⚠ Базовых шаблонов нет. Создайте базовый шаблон во вкладке «Базовые».';
      }
      sel.addEventListener('change', () => {
        working.baseTemplateId = sel.value || null;
        if (working.baseTemplateId) {
          try {
            const b = Cat.getTemplate(working.baseTemplateId);
            if (b && b.template) applyBaseChrome(working, b.template);
          } catch (e) { /* ignore */ }
        }
        rebuild();
      });
    }).catch(() => { sel.disabled = false; });
  }

  // ——— Вкладка «Лист» (только для БАЗОВОГО шаблона) ———
  // Тип шаблона здесь не выбирается: уровень задаётся при создании
  // (вкладки Документы/Базовые). Базовый = поля/размер/стили/чрома.
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

    // ——— Обложка (отдельная титульная страница) ———
    sect(p, 'Обложка / титул');
    if (!working.cover || typeof working.cover !== 'object') working.cover = { enabled: false, page: null, chrome: false, blocks: [] };
    const cv = working.cover;
    if (!Array.isArray(cv.blocks)) cv.blocks = [];
    const cEn = el('label', 'chk');
    const cCb = document.createElement('input'); cCb.type = 'checkbox';
    cCb.checked = !!cv.enabled;
    cCb.addEventListener('change', () => { cv.enabled = cCb.checked; rebuild(); });
    cEn.appendChild(cCb);
    const cSp = document.createElement('span'); cSp.textContent = ' отдельная первая страница (обложка)';
    cEn.appendChild(cSp);
    fld(p, '', cEn);
    if (cv.enabled) {
      const cg = cv.page || (cv.page = {});
      fld(p, 'Ориентация обложки', selectInput(
        [['', '(как документ)'], ['portrait', 'Книжная'], ['landscape', 'Альбомная']],
        cg.orientation || '', v => { cg.orientation = v || undefined; renderPane(); }));
      const ch = el('label', 'chk');
      const chCb = document.createElement('input'); chCb.type = 'checkbox';
      chCb.checked = !!cv.chrome;
      chCb.addEventListener('change', () => { cv.chrome = chCb.checked; renderPane(); });
      ch.appendChild(chCb);
      const chSp = document.createElement('span'); chSp.textContent = ' колонтитулы на обложке';
      ch.appendChild(chSp);
      fld(p, '', ch);
      const add = el('div', 'rpt-zone-add');
      const aT = btn('+ Заголовок на обложку'); aT.className = 'rpt-zone-add-btn';
      aT.addEventListener('click', () => { cv.blocks.push({ type: 'docTitle', text: '{{meta.title}}', align: 'center' }); renderPane(); });
      const aP = btn('+ Текст на обложку'); aP.className = 'rpt-zone-add-btn';
      aP.addEventListener('click', () => { cv.blocks.push({ type: 'paragraph', text: 'Текст обложки', align: 'center' }); renderPane(); });
      add.appendChild(aT); add.appendChild(aP);
      p.appendChild(add);
      (cv.blocks || []).forEach((b, i) => {
        const row = el('div', 'rpt-zone-list__item');
        row.style.cssText = 'display:flex;align-items:center;gap:4px';
        const ta = textInput(b.text || '', v => { b.text = v; renderPane(); });
        ta.style.flex = '1';
        row.appendChild(ta);
        const rm = btn('✕', 'danger'); rm.style.padding = '2px 6px';
        rm.addEventListener('click', () => { cv.blocks.splice(i, 1); rebuild(); });
        row.appendChild(rm);
        p.appendChild(row);
      });
    }

    // ——— Особая первая страница контента ———
    sect(p, 'Первая страница (геометрия)');
    if (!working.firstPage || typeof working.firstPage !== 'object') working.firstPage = { page: null };
    const fp = working.firstPage.page || {};
    const fpEn = el('label', 'chk');
    const fpCb = document.createElement('input'); fpCb.type = 'checkbox';
    fpCb.checked = !!working.firstPage.page;
    fpCb.addEventListener('change', () => {
      working.firstPage.page = fpCb.checked ? { orientation: 'portrait' } : null;
      rebuild();
    });
    fpEn.appendChild(fpCb);
    const fpSp = document.createElement('span'); fpSp.textContent = ' своя геометрия 1-й страницы';
    fpEn.appendChild(fpSp);
    fld(p, '', fpEn);
    if (working.firstPage.page) {
      fld(p, 'Ориентация 1-й стр.', selectInput(
        [['portrait', 'Книжная'], ['landscape', 'Альбомная']],
        fp.orientation || 'portrait', v => { working.firstPage.page.orientation = v; renderPane(); }));
    }
  }

  // ——— Вкладка «Разделы» БАЗОВОГО шаблона (pageSections) ———
  // База владеет массивом разделов: у каждого своя геометрия + свой
  // колонтитул (шапка/подвал) + опц. свой логотип. Документы наследуют.
  function ensurePageSections() {
    if (Array.isArray(working.pageSections) && working.pageSections.length) return;
    // Первичная инициализация из legacy (page + footer/header.otherPages
    // + logo) — один раздел «Основной», чтобы существующая база не
    // потеряла оформление.
    const fo = (working.footer && working.footer.otherPages) || {};
    const ho = (working.header && working.header.otherPages) || {};
    working.pageSections = [{
      id: 'ps1', name: 'Основной',
      page: JSON.parse(JSON.stringify(working.page || {})),
      header: { enabled: ho.enabled !== false && (ho.blocks || []).length > 0,
        height: ho.height || 10, width: 'print', valign: 'middle',
        blocks: JSON.parse(JSON.stringify(ho.blocks || [])) },
      footer: { enabled: fo.enabled !== false && (fo.blocks || []).length > 0,
        height: fo.height || 10, width: 'print', valign: 'middle',
        blocks: JSON.parse(JSON.stringify(fo.blocks || [])) },
      logo: (working.logo && working.logo.src)
        ? JSON.parse(JSON.stringify(working.logo)) : null,
      repeat: true,
    }];
  }

  function bandEditor(parent, label, band) {
    sect(parent, label);
    const lbl = el('label', 'chk');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    cb.checked = band.enabled !== false;
    cb.addEventListener('change', () => { band.enabled = cb.checked; rebuild(); });
    lbl.appendChild(cb);
    const sp = document.createElement('span'); sp.textContent = ' включён';
    lbl.appendChild(sp);
    fld(parent, '', lbl);
    if (band.enabled === false) return;
    fld(parent, 'Высота, мм', numInput(band.height || 10, v => { band.height = v; renderPane(); }));
    fld(parent, 'Ширина', selectInput(
      [['print', 'В пределах полей'], ['page', 'Вся ширина листа'],
       ['bleed', 'За край листа (вылет)']],
      band.width || 'print', v => { band.width = v; rebuild(); }));
    if (band.width === 'bleed') {
      fld(parent, 'Вылет за край, мм', numInput(
        band.bleed != null ? band.bleed : 10, v => { band.bleed = v; renderPane(); }));
    }
    const first = (band.blocks && band.blocks[0]) || null;
    fld(parent, 'Текст (можно несколько строк)', textArea(first && first.text || '', v => {
      band.blocks = v ? [{ type: 'paragraph', style: 'caption',
        align: (first && first.align) || 'center', text: v }] : [];
      renderPane();
    }));
    fld(parent, 'Выравнивание по горизонтали', selectInput(
      [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']],
      (first && first.align) || 'center', v => {
        if (band.blocks && band.blocks[0]) { band.blocks[0].align = v; renderPane(); }
      }));
    fld(parent, 'Выравнивание по вертикали', selectInput(
      [['top', 'Сверху'], ['middle', 'По центру'], ['bottom', 'Снизу']],
      band.valign || 'middle', v => { band.valign = v; renderPane(); }));
  }

  function buildPSections(p) {
    ensurePageSections();
    const hint = el('div', 'rpt-hint');
    hint.innerHTML = 'Базовый шаблон состоит из <b>разделов</b>. У каждого ' +
      'своя геометрия, своя шапка/подвал и опц. свой логотип (напр. ' +
      'крупный на «Титуле», мелкий на «Основном»). Документы наследуют ' +
      'эти разделы и выбирают, в какой переключиться.';
    p.appendChild(hint);

    const addRow = el('div', 'rpt-zone-add');
    const aBtn = btn('+ Добавить раздел');
    aBtn.className = 'rpt-zone-add-btn';
    aBtn.addEventListener('click', () => {
      const n = working.pageSections.length;
      const DEF = ['Титул', 'Основной', 'Приложение'];
      working.pageSections.push({
        id: 'ps' + (n + 1), name: DEF[n] || ('Раздел ' + (n + 1)),
        page: JSON.parse(JSON.stringify(working.page || { format: 'A4', orientation: 'portrait', margins: { top: 15, right: 25, bottom: 20, left: 20 } })),
        header: { enabled: false, height: 10, width: 'print', valign: 'middle', blocks: [] },
        footer: { enabled: false, height: 10, width: 'print', valign: 'middle', blocks: [] },
        logo: null, repeat: true,
      });
      rebuild();
    });
    addRow.appendChild(aBtn);
    p.appendChild(addRow);

    working.pageSections.forEach((s, i) => {
      const card = el('div', 'rpt-style-card');
      const h = document.createElement('h4');
      h.textContent = '§ ' + (i + 1) + '. ' + (s.name || ('Раздел ' + (i + 1)));
      card.appendChild(h);

      fld(card, 'Название раздела', textInput(s.name || '', v => { s.name = v; rebuild(); }));
      if (!s.page || typeof s.page !== 'object') s.page = {};
      fld(card, 'Формат', selectInput(
        [...Object.keys(PAGE_SIZES).map(f => [f, f]), ['Custom', 'Custom']],
        s.page.format || 'A4', v => { s.page.format = v; renderPane(); }));
      fld(card, 'Ориентация', selectInput(
        [['portrait', 'Книжная'], ['landscape', 'Альбомная']],
        s.page.orientation || 'portrait', v => { s.page.orientation = v; renderPane(); }));
      const m = s.page.margins || (s.page.margins = { top: 15, right: 25, bottom: 20, left: 20 });
      const r1 = el('div', 'rpt-row');
      fld(r1, 'Поле верх', numInput(m.top, v => { m.top = v; renderPane(); }));
      fld(r1, 'Поле низ', numInput(m.bottom, v => { m.bottom = v; renderPane(); }));
      card.appendChild(r1);
      const r2 = el('div', 'rpt-row');
      fld(r2, 'Поле лево', numInput(m.left, v => { m.left = v; renderPane(); }));
      fld(r2, 'Поле право', numInput(m.right, v => { m.right = v; renderPane(); }));
      card.appendChild(r2);

      if (!s.header || typeof s.header !== 'object') s.header = { enabled: false, blocks: [] };
      if (!s.footer || typeof s.footer !== 'object') s.footer = { enabled: false, blocks: [] };
      bandEditor(card, 'Шапка раздела', s.header);
      bandEditor(card, 'Подвал раздела', s.footer);

      // Логотип раздела (свой размер на титуле/др.)
      sect(card, 'Логотип раздела');
      const lEn = el('label', 'chk');
      const lCb = document.createElement('input'); lCb.type = 'checkbox';
      lCb.checked = !!(s.logo && s.logo.src);
      lCb.addEventListener('change', () => {
        s.logo = lCb.checked ? (s.logo || { src: null, width: 40, height: 20, position: 'header-left' }) : null;
        rebuild();
      });
      lEn.appendChild(lCb);
      const lSp = document.createElement('span'); lSp.textContent = ' свой логотип в этом разделе';
      lEn.appendChild(lSp);
      fld(card, '', lEn);
      if (s.logo) {
        const pk = btn(s.logo.src ? '📷 Заменить логотип' : '📷 Выбрать логотип');
        pk.addEventListener('click', () => pickImage(src => { s.logo.src = src; rebuild(); }));
        card.appendChild(pk);
        const lr = el('div', 'rpt-row');
        fld(lr, 'Ширина, мм', numInput(s.logo.width || 40, v => { s.logo.width = v; renderPane(); }));
        fld(lr, 'Высота, мм', numInput(s.logo.height || 20, v => { s.logo.height = v; renderPane(); }));
        card.appendChild(lr);
        fld(card, 'Позиция', selectInput(
          [['header-left', 'Шапка слева'], ['header-center', 'Шапка центр'], ['header-right', 'Шапка справа'],
           ['footer-left', 'Подвал слева'], ['footer-center', 'Подвал центр'], ['footer-right', 'Подвал справа']],
          s.logo.position || 'header-left', v => { s.logo.position = v; renderPane(); }));
      }

      const act = el('div', 'rpt-row');
      const up = btn('▲'); up.disabled = i === 0; up.style.padding = '2px 8px';
      up.addEventListener('click', () => {
        const a = working.pageSections;[a[i - 1], a[i]] = [a[i], a[i - 1]]; rebuild();
      });
      const dn = btn('▼'); dn.disabled = i === working.pageSections.length - 1; dn.style.padding = '2px 8px';
      dn.addEventListener('click', () => {
        const a = working.pageSections;[a[i + 1], a[i]] = [a[i], a[i + 1]]; rebuild();
      });
      const del = btn('✕ Удалить раздел', 'danger');
      del.disabled = working.pageSections.length <= 1;
      del.addEventListener('click', () => { working.pageSections.splice(i, 1); rebuild(); });
      act.appendChild(up); act.appendChild(dn); act.appendChild(del);
      card.appendChild(act);

      p.appendChild(card);
    });
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
  const s = el('div', 'rpt-section-title');
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
