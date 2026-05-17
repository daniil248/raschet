// ======================================================================
// reports/reports.js
// Страница «Шаблоны отчётов». Пользователь создаёт шаблоны оформления
// (страница, поля, логотип, колонтитулы, стили), сохраняет их в
// per-user каталог и потом выбирает в подпрограммах (cable/, schematic/,
// battery/ и т.д.) при экспорте отчёта.
//
// Инструкция для пользователя доступна по кнопке «?» в тулбаре слева
// (см. reports/help.js). Инструкция для разработчиков, встраивающих
// модуль в свои подпрограммы — shared/report/README.md.
// ======================================================================

import * as Report   from 'shared/report/index.js';
import * as B        from 'shared/report/blocks.js';
import * as Catalog  from 'shared/report-catalog.js';
import { migrateToFlow, applyBaseChrome } from 'shared/report/template.js';
import { BUILTIN_TEMPLATES, BUILTIN_VERSION, getDemoContent } from 'shared/report/templates-seed.js';
import { openHelp }  from './help.js';
import { rsToast, rsConfirm } from 'shared/dialog.js';

// Версия встроенных шаблонов хранится отдельно — при смене перезаседаем
// только builtin-записи, пользовательские не трогаем.
const BUILTIN_VER_KEY = 'raschet.reportCatalog.builtinVersion';

// ——— состояние страницы ———
const state = {
  selectedId: null,
  filterText: '',
  prevGuides: false,   // показывать направляющие полей в превью
  prevZoom: 1,         // масштаб превью (1 = вписать по ширине)
  catTab: 'docs',      // активная вкладка списка: 'docs' | 'base'
};

// ——— DOM-ссылки ———
const $list        = document.getElementById('cat-list');
const $catTabs     = document.getElementById('cat-tabs');
const $search      = document.getElementById('cat-search');
const $detail      = document.getElementById('detail');
const $detailEmpty = document.getElementById('detail-empty');
const $detailFull  = document.getElementById('detail-full');
const $detailTitle = document.getElementById('detail-title');
const $detailSub   = document.getElementById('detail-subtitle');
const $preview     = document.getElementById('detail-preview');
const $btnNew      = document.getElementById('btn-new');
const $btnImport   = document.getElementById('btn-import');
const $btnExport   = document.getElementById('btn-export');
const $fileImport  = document.getElementById('file-import');
const $btnEdit     = document.getElementById('btn-edit');
const $btnRename   = document.getElementById('btn-rename');
const $btnClone    = document.getElementById('btn-clone');
const $btnDelete   = document.getElementById('btn-delete');
const $btnExportOne= document.getElementById('btn-export-one');
const $btnPdf      = document.getElementById('btn-pdf');
const $btnDocx     = document.getElementById('btn-docx');
const $btnHelp     = document.getElementById('btn-help');

// ——— сидинг встроенных шаблонов ———
// Список берётся из reports/templates-seed.js. При смене BUILTIN_VERSION
// все builtin-записи пересеиваются (удаляются старые, вставляются новые),
// пользовательские шаблоны не затрагиваются.
function seedBuiltinsIfNeeded() {
  let storedVer = null;
  try { storedVer = parseInt(localStorage.getItem(BUILTIN_VER_KEY) || '0', 10) || 0; }
  catch { storedVer = 0; }

  if (storedVer >= BUILTIN_VERSION) return;

  // Удаляем старые встроенные (они source==='builtin'), чтобы при
  // обновлении не плодились дубли и не оставались устаревшие настройки.
  // removeTemplate блокирует удаление builtin — поэтому идём прямо в
  // localStorage через clearUserTemplates-подобный приём: перечитываем
  // каталог, фильтруем, записываем обратно.
  const userOnly = Catalog.listTemplates().filter(t => t.source !== 'builtin');
  // clearUserTemplates оставляет только builtin; нам нужно наоборот —
  // поэтому сразу перезаписываем весь каталог.
  for (const rec of Catalog.listTemplates()) {
    if (rec.source === 'builtin') {
      // Временно помечаем как user, чтобы removeTemplate пропустил удаление
      Catalog.saveTemplate({ ...rec, source: 'user' });
      Catalog.removeTemplate(rec.id);
    }
  }
  // Пользовательские могли потеряться при пересохранении builtin-как-user —
  // восстановим их обратно.
  for (const rec of userOnly) Catalog.saveTemplate(rec);

  // Сеем новые встроенные
  for (const rec of BUILTIN_TEMPLATES) {
    Catalog.saveTemplate(rec);
  }

  try { localStorage.setItem(BUILTIN_VER_KEY, String(BUILTIN_VERSION)); }
  catch { /* noop */ }
}

// ——— демо-контент для превью и тестового экспорта ———
// Для встроенных шаблонов берём персональный набор блоков из seed-файла,
// для пользовательских — общий fallback (он же в getDemoContent).
function demoContentFor(rec) {
  return getDemoContent(rec && rec.id);
}

// ——— рендер списка ———
function renderList() {
  const all = Catalog.listTemplates();
  const q = state.filterText.trim().toLowerCase();
  const filtered = q
    ? all.filter(t => (t.name + ' ' + (t.description || '') + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(q))
    : all;

  // Базовые шаблоны (level==='base' — только поля/колонтитулы/стили)
  // и шаблоны документов (свой порядок блоков, наследуют базу) —
  // ПОЛНОСТЬЮ разделены вкладками: видим только активную категорию.
  const isBase = (t) => t.template && t.template.level === 'base';
  const docs  = filtered.filter(t => !isBase(t));
  const bases = filtered.filter(isBase);

  // Счётчики на вкладках
  if ($catTabs) {
    const dBtn = $catTabs.querySelector('[data-cat="docs"]');
    const bBtn = $catTabs.querySelector('[data-cat="base"]');
    if (dBtn) dBtn.textContent = 'Документы (' + docs.length + ')';
    if (bBtn) bBtn.textContent = 'Базовые (' + bases.length + ')';
    for (const b of $catTabs.querySelectorAll('.rpt-cat-tab'))
      b.classList.toggle('active', b.dataset.cat === state.catTab);
  }

  const arr = state.catTab === 'base' ? bases : docs;
  $list.innerHTML = '';
  if (arr.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rpt-cat-empty';
    empty.textContent = q
      ? 'Нет совпадений'
      : (state.catTab === 'base' ? 'Базовых шаблонов нет' : 'Шаблоны документов не созданы');
    $list.appendChild(empty);
    return;
  }
  for (const t of arr) $list.appendChild(buildCatItem(t));
}

function buildCatItem(t) {
  const item = document.createElement('div');
  item.className = 'rpt-cat-item';
  if (t.id === state.selectedId) item.classList.add('active');

  const name = document.createElement('div');
  name.className = 'rpt-cat-item__name';
  name.appendChild(document.createTextNode(t.name));
  if (t.template && t.template.level === 'base') {
    const lv = document.createElement('span');
    lv.className = 'rpt-cat-item__badge base';
    lv.textContent = 'База';
    name.appendChild(lv);
  }
  const badge = document.createElement('span');
  badge.className = 'rpt-cat-item__badge ' + (t.source === 'builtin' ? 'builtin' : 'user');
  badge.textContent = t.source === 'builtin' ? 'Встроенный' : 'Мой';
  name.appendChild(badge);
  item.appendChild(name);

  if (t.description) {
    const d = document.createElement('div');
    d.className = 'rpt-cat-item__desc';
    d.textContent = t.description;
    item.appendChild(d);
  }

  const meta = document.createElement('div');
  meta.className = 'rpt-cat-item__meta';
  const pg = Report.pageSizeMm(t.template.page || {});
  meta.textContent = `${t.template.page?.format || 'A4'} · ${pg.width.toFixed(0)}×${pg.height.toFixed(0)} мм`;
  item.appendChild(meta);

  item.addEventListener('click', () => {
    state.selectedId = t.id;
    renderList();
    renderDetail();
  });
  return item;
}

// ——— рендер детали ———
function renderDetail() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) {
    $detailEmpty.style.display = 'flex';
    $detailFull.style.display = 'none';
    return;
  }
  $detailEmpty.style.display = 'none';
  $detailFull.style.display = 'flex';

  $detailTitle.textContent = rec.name;
  const sub = [];
  const pg = Report.pageSizeMm(rec.template.page || {});
  sub.push(`${rec.template.page?.format || 'A4'} · ${pg.width.toFixed(0)}×${pg.height.toFixed(0)} мм`);
  sub.push(rec.source === 'builtin' ? 'встроенный' : 'пользовательский');
  if (rec.updatedAt) sub.push('обновлён ' + new Date(rec.updatedAt).toLocaleDateString('ru-RU'));
  $detailSub.textContent = sub.join('  ·  ');

  $btnDelete.disabled = rec.source === 'builtin';
  $btnEdit.disabled   = false;
  $btnRename.disabled = rec.source === 'builtin';

  // Кнопка «↺ Сбросить» (восстановить встроенный из сид-эталона) —
  // создаётся динамически, видна только для встроенных.
  if (!window.__rptResetBtn) {
    const b = document.createElement('button');
    b.id = 'btn-reset-builtin';
    b.type = 'button';
    b.textContent = '↺ Сбросить';
    b.title = 'Восстановить встроенный шаблон из эталона';
    b.className = $btnRename.className || '';
    b.addEventListener('click', onResetBuiltin);
    ($btnRename.parentElement || $btnEdit.parentElement).insertBefore(b, $btnDelete);
    window.__rptResetBtn = b;
  }
  window.__rptResetBtn.style.display = rec.source === 'builtin' ? '' : 'none';

  renderPreviewPane(rec);
}

// Просмотрщик шаблона: тулбар (поля вкл/выкл, масштаб, многостранич.)
// + лист(ы). mode:'final' + pageLabel:false → нет дубля колонтитула-
// номера («2 колонтитула» в демо). Поля показываются по тумблеру.
function renderPreviewPane(rec) {
  if (!rec) return;
  const previewTpl = prepTpl(rec);
  $preview.innerHTML = '';

  const tools = document.createElement('div');
  tools.className = 'rpt-prev-tools';

  const mkBtn = (txt, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-sm';
    b.textContent = txt; if (title) b.title = title;
    return b;
  };

  const gBtn = mkBtn(state.prevGuides ? '🔲 Поля: вкл' : '⬜ Поля: выкл',
    'Показать/скрыть направляющие полей печати');
  gBtn.addEventListener('click', () => {
    state.prevGuides = !state.prevGuides;
    renderPreviewPane(rec);
  });

  const zMinus = mkBtn('−', 'Уменьшить');
  const zLabel = document.createElement('span');
  zLabel.className = 'rpt-prev-zoom';
  zLabel.textContent = Math.round(state.prevZoom * 100) + '%';
  const zPlus = mkBtn('+', 'Увеличить');
  const zFit  = mkBtn('⤢ Вписать', 'Вписать по ширине (100%)');
  const setZoom = (z) => {
    state.prevZoom = Math.max(0.4, Math.min(4, Math.round(z * 100) / 100));
    renderPreviewPane(rec);
  };
  zMinus.addEventListener('click', () => setZoom(state.prevZoom - 0.1));
  zPlus .addEventListener('click', () => setZoom(state.prevZoom + 0.1));
  zFit  .addEventListener('click', () => setZoom(1));

  const pages = document.createElement('span');
  pages.className = 'rpt-prev-pages';

  tools.appendChild(gBtn);
  const sep = document.createElement('span'); sep.className = 'rpt-prev-sep';
  tools.appendChild(sep);
  tools.appendChild(zMinus); tools.appendChild(zLabel); tools.appendChild(zPlus);
  tools.appendChild(zFit);
  tools.appendChild(pages);
  $preview.appendChild(tools);

  const host = document.createElement('div');
  host.className = 'rpt-prev-host';
  $preview.appendChild(host);

  // Масштаб: вписываем страницу по ширине области, затем × zoom.
  let scale = 2.4;
  try {
    const pg = Report.pageSizeMm(previewTpl.page || {});
    const avail = Math.max(360, ($preview.clientWidth || 760) - 36);
    const fit = Math.max(0.8, Math.min(6, avail / (pg.width || 210)));
    scale = fit * (state.prevZoom || 1);
  } catch (e) { /* дефолт */ }

  Report.renderPreview(previewTpl, host, {
    mode: 'final', guides: state.prevGuides, pageLabel: false, scale });

  const n = host.querySelectorAll('.rpt-page').length;
  pages.textContent = n > 1 ? ('Страниц: ' + n) : '1 страница';

  // Ctrl+колесо — зум с шагом (общие правила: без Ctrl — нативный
  // скролл/пан). Навешиваем один раз на $preview.
  if (!$preview.__rptWheel) {
    $preview.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const r = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
      if (!r) return;
      state.prevZoom = Math.max(0.4, Math.min(4,
        Math.round((state.prevZoom + (ev.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100));
      renderPreviewPane(r);
    }, { passive: false });
    $preview.__rptWheel = true;
  }
}

// Каталог-превью/экспорт ДОЛЖНЫ идти тем же конвейером, что и реальная
// генерация: наследование базы (applyBaseChrome) + единый поток
// (migrateToFlow) → без дублей/наложения, превью = факт.
function prepTpl(rec) {
  const tpl = Report.createTemplate(rec.template);
  if (tpl.baseTemplateId) {
    try {
      const b = Catalog.getTemplate(tpl.baseTemplateId);
      if (b && b.template) applyBaseChrome(tpl, b.template);
    } catch (e) { /* база недоступна */ }
  }
  if (!tpl.content || tpl.content.length === 0) tpl.content = demoContentFor(rec);
  migrateToFlow(tpl);
  return tpl;
}

// ——— действия ———
function openPrompt({ title, name = '', description = '', onOk }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rpt-prompt-backdrop';
  const box = document.createElement('div');
  box.className = 'rpt-prompt';
  box.innerHTML = `
    <h3>${title}</h3>
    <label>Название</label>
    <input type="text" id="pm-name">
    <label>Описание (необязательно)</label>
    <textarea id="pm-desc"></textarea>
    <div class="rpt-prompt__buttons">
      <button class="btn" id="pm-cancel">Отмена</button>
      <button class="btn primary" id="pm-ok">ОК</button>
    </div>`;
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  const $n = box.querySelector('#pm-name');
  const $d = box.querySelector('#pm-desc');
  $n.value = name; $d.value = description;
  $n.focus(); $n.select();
  const close = () => backdrop.remove();
  box.querySelector('#pm-cancel').addEventListener('click', close);
  box.querySelector('#pm-ok').addEventListener('click', () => {
    const val = ($n.value || '').trim();
    if (!val) { $n.focus(); return; }
    close();
    onOk({ name: val, description: ($d.value || '').trim() });
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  $n.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('#pm-ok').click(); });
}

function onNew() {
  // Тип нового шаблона = активная вкладка (Документы → document,
  // Базовые → base): создаём сразу в нужной категории без
  // переключения уровня внутри редактора.
  const lvl = state.catTab === 'base' ? 'base' : 'document';
  openPrompt({
    title: lvl === 'base' ? 'Новый базовый шаблон' : 'Новый шаблон документа',
    onOk({ name, description }) {
      const rec = Catalog.saveTemplate({
        name, description,
        template: Report.createTemplate({ level: lvl, meta: { title: name, author: '', subject: '' } }),
        source: 'user',
      });
      state.selectedId = rec.id;
      renderList();
      renderDetail();
      // Сразу открываем редактор
      onEdit();
    },
  });
}

function onEdit() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  // Редактор мутирует working-копию; сохраняет только по «Сохранить».
  // Встроенный шаблон НЕ перезаписываем (иначе правки разрушают сид —
  // инцидент с «Технической запиской») → форкаем в пользовательскую
  // копию; встроенный остаётся эталоном.
  Report.openTemplateEditor(rec.template, {
    onSave(updated) {
      if (rec.source === 'builtin') {
        const copy = Catalog.saveTemplate({
          name: rec.name + ' (моя копия)',
          description: rec.description || '',
          tags: rec.tags || [],
          template: updated,
          source: 'user',
        });
        if (copy) state.selectedId = copy.id;
        rsToast('Встроенный шаблон не изменяется — сохранена ваша копия', 'ok');
      } else {
        Catalog.saveTemplate({ ...rec, template: updated });
      }
      renderList();
      renderDetail();
    },
  });
}

// Восстановить встроенный шаблон из сид-эталона (если был повреждён
// прежними правками/тестами). Доступно только для source==='builtin'.
function onResetBuiltin() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec || rec.source !== 'builtin') return;
  const seed = BUILTIN_TEMPLATES.find(b => b.id === rec.id);
  if (!seed) { rsToast('Сид для этого шаблона не найден', 'err'); return; }
  Catalog.saveTemplate({ ...seed, source: 'builtin' });
  renderList();
  renderDetail();
  rsToast('Встроенный шаблон восстановлен из эталона', 'ok');
}

function onRename() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec || rec.source === 'builtin') return;
  openPrompt({
    title: 'Переименовать шаблон',
    name: rec.name,
    description: rec.description,
    onOk({ name, description }) {
      Catalog.saveTemplate({ ...rec, name, description });
      renderList();
      renderDetail();
    },
  });
}

function onClone() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  openPrompt({
    title: 'Клонировать шаблон',
    name: rec.name + ' (копия)',
    description: rec.description,
    onOk({ name, description }) {
      const copy = Catalog.saveTemplate({
        name, description,
        template: JSON.parse(JSON.stringify(rec.template)),
        source: 'user',
      });
      state.selectedId = copy.id;
      renderList();
      renderDetail();
    },
  });
}

async function onDelete() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec || rec.source === 'builtin') return;
  if (!(await rsConfirm(`Удалить шаблон «${rec.name}»?`, '', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
  Catalog.removeTemplate(rec.id);
  state.selectedId = null;
  renderList();
  renderDetail();
}

function onExportCatalog() {
  const json = Catalog.exportCatalogJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'raschet-report-templates.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function onExportOne() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const json = JSON.stringify({ version: 1, templates: [rec] }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (rec.name || 'template').replace(/\s+/g, '-') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function onImport() { $fileImport.click(); }
$fileImport.addEventListener('change', async () => {
  const f = $fileImport.files && $fileImport.files[0];
  if (!f) return;
  const text = await f.text();
  try {
    const res = Catalog.importCatalogJSON(text, 'merge');
    rsToast(`Импорт завершён. Добавлено: ${res.added}, обновлено: ${res.updated}, всего: ${res.total}.`, 'ok');
    renderList();
    renderDetail();
  } catch (e) {
    rsToast('Ошибка импорта: ' + e.message, 'err');
  }
  $fileImport.value = '';
});

async function onPdf() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const tpl = prepTpl(rec);
  // v0.60.325: previewPDF показывает modal с iframe-предпросмотром.
  // Кнопка «💾 Скачать» внутри сохраняет; «✕ Закрыть» — отмена.
  try {
    const result = await Report.previewPDF(tpl, rec.name || 'report');
    if (result === 'saved') rsToast('✔ PDF сохранён', 'ok');
  } catch (e) { rsToast('Не удалось сформировать PDF: ' + e.message, 'err'); }
}

async function onDocx() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const tpl = prepTpl(rec);
  try { await Report.exportDOCX(tpl, rec.name || 'report'); }
  catch (e) { rsToast('Не удалось сформировать DOCX: ' + e.message, 'err'); }
}

// ——— события ———
$search.addEventListener('input', () => { state.filterText = $search.value; renderList(); });
if ($catTabs) $catTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.rpt-cat-tab');
  if (!b || !b.dataset.cat || b.dataset.cat === state.catTab) return;
  state.catTab = b.dataset.cat;
  renderList();
});
$btnNew     .addEventListener('click', onNew);
$btnImport  .addEventListener('click', onImport);
$btnExport  .addEventListener('click', onExportCatalog);
$btnEdit    .addEventListener('click', onEdit);
$btnRename  .addEventListener('click', onRename);
$btnClone   .addEventListener('click', onClone);
$btnDelete  .addEventListener('click', onDelete);
$btnExportOne.addEventListener('click', onExportOne);
$btnPdf     .addEventListener('click', onPdf);
$btnDocx    .addEventListener('click', onDocx);
if ($btnHelp) $btnHelp.addEventListener('click', openHelp);

// ——— запуск ———
seedBuiltinsIfNeeded();
renderList();
renderDetail();
