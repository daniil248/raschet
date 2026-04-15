// ======================================================================
// reports/reports.js
// Страница «Шаблоны отчётов». Пользователь создаёт шаблоны оформления
// (страница, поля, логотип, колонтитулы, стили), сохраняет их в
// per-user каталог и потом выбирает в подпрограммах (cable/, schematic/,
// battery/ и т.д.) при экспорте отчёта.
// ======================================================================

import * as Report   from '../shared/report/index.js';
import * as B        from '../shared/report/blocks.js';
import * as Catalog  from '../shared/report-catalog.js';

// ——— состояние страницы ———
const state = {
  selectedId: null,
  filterText: '',
};

// ——— DOM-ссылки ———
const $list        = document.getElementById('cat-list');
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

// ——— встроенные шаблоны (seed при пустом каталоге) ———
function builtinTemplates() {
  const blank = Report.createTemplate({
    meta: { title: 'Пустой шаблон', author: '', subject: '' },
    content: [],
  });
  const simple = Report.createTemplate({
    meta: { title: 'Простой отчёт', author: '', subject: '' },
    header: {
      firstPage:  { enabled: true, height: 14, blocks: [
        { type: 'paragraph', align: 'right', style: 'caption', text: '{{meta.title}}' },
      ]},
      otherPages: { enabled: true, height: 12, blocks: [
        { type: 'paragraph', align: 'right', style: 'caption', text: '{{meta.title}}' },
      ]},
    },
  });
  const formal = Report.createTemplate({
    meta: { title: 'Официальный документ', author: '', subject: '' },
    page: { format: 'A4', orientation: 'portrait', margins: { top: 25, right: 20, bottom: 25, left: 25 } },
    styles: {
      h1: { size: 16, bold: true, align: 'center', spaceBefore: 8, spaceAfter: 6 },
      h2: { size: 13, bold: true, spaceBefore: 5, spaceAfter: 3 },
      body: { size: 12, lineHeight: 1.5, align: 'justify', spaceAfter: 3 },
    },
    header: {
      firstPage:  { enabled: false, height: 0, blocks: [] },
      otherPages: { enabled: true, height: 12, blocks: [
        { type: 'paragraph', align: 'center', style: 'caption', text: '{{meta.title}}' },
      ]},
    },
    footer: {
      firstPage:  { enabled: true, height: 12, blocks: [
        { type: 'paragraph', align: 'center', style: 'caption', text: '{{date}}  ·  стр. {{page}} из {{pages}}' },
      ]},
      otherPages: { enabled: true, height: 12, blocks: [
        { type: 'paragraph', align: 'center', style: 'caption', text: 'стр. {{page}} из {{pages}}' },
      ]},
    },
  });
  return [
    { id: 'builtin-blank',  name: 'Пустой шаблон',        description: 'Стартовый шаблон без оформления', tags: ['builtin'], source: 'builtin', template: blank  },
    { id: 'builtin-simple', name: 'Простой отчёт',        description: 'A4, минимальная шапка, нумерация страниц', tags: ['builtin'], source: 'builtin', template: simple },
    { id: 'builtin-formal', name: 'Официальный документ', description: 'A4, широкие поля, выравнивание по ширине, колонтитулы', tags: ['builtin'], source: 'builtin', template: formal },
  ];
}

function seedBuiltinsIfNeeded() {
  const existing = Catalog.listTemplates();
  const haveBuiltin = existing.some(t => t.source === 'builtin');
  if (!haveBuiltin) {
    for (const rec of builtinTemplates()) {
      Catalog.saveTemplate(rec);
    }
  }
}

// ——— демо-контент, чтобы в превью было что показать ———
function demoContent() {
  return [
    B.h1('Заголовок отчёта'),
    B.paragraph('Это превью шаблона. Когда подпрограмма применит этот шаблон, на месте этих блоков будут её данные.'),
    B.h2('Раздел 1. Исходные данные'),
    B.list([
      'Параметр 1 — значение',
      'Параметр 2 — значение',
      'Параметр 3 — значение',
    ]),
    B.h2('Раздел 2. Результаты'),
    B.table(
      ['Параметр', 'Значение', 'Ед.'],
      [
        ['Первый', '10', 'шт.'],
        ['Второй', '25.5', 'кВт'],
        ['Третий', '0.92', '—'],
      ],
    ),
    B.h3('2.1. Комментарий'),
    B.paragraph('Абзац пояснений с деталями расчёта. Стиль «body» — базовый размер и межстрочный интервал.'),
    B.hr(),
    B.caption('Превью формируется модулем shared/report/preview.js.'),
  ];
}

// ——— рендер списка ———
function renderList() {
  const all = Catalog.listTemplates();
  const q = state.filterText.trim().toLowerCase();
  const filtered = q
    ? all.filter(t => (t.name + ' ' + (t.description || '') + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(q))
    : all;

  $list.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rpt-cat-empty';
    empty.textContent = q ? 'Нет совпадений' : 'Шаблоны не созданы';
    $list.appendChild(empty);
    return;
  }

  for (const t of filtered) {
    const item = document.createElement('div');
    item.className = 'rpt-cat-item';
    if (t.id === state.selectedId) item.classList.add('active');

    const name = document.createElement('div');
    name.className = 'rpt-cat-item__name';
    const badge = document.createElement('span');
    badge.className = 'rpt-cat-item__badge ' + (t.source === 'builtin' ? 'builtin' : 'user');
    badge.textContent = t.source === 'builtin' ? 'Встроенный' : 'Мой';
    name.appendChild(document.createTextNode(t.name));
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
    $list.appendChild(item);
  }
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

  // Превью: клонируем шаблон, вливаем демо-контент (если контент пуст)
  const previewTpl = Report.createTemplate(rec.template);
  if (!previewTpl.content || previewTpl.content.length === 0) {
    previewTpl.content = demoContent();
  }
  Report.renderPreview(previewTpl, $preview, { mode: 'edit' });
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
  openPrompt({
    title: 'Новый шаблон',
    onOk({ name, description }) {
      const rec = Catalog.saveTemplate({
        name, description,
        template: Report.createTemplate({ meta: { title: name, author: '', subject: '' } }),
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
  // Редактор мутирует working-копию; сохраняет только по «Сохранить»
  Report.openTemplateEditor(rec.template, {
    onSave(updated) {
      Catalog.saveTemplate({ ...rec, template: updated });
      renderList();
      renderDetail();
    },
  });
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

function onDelete() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec || rec.source === 'builtin') return;
  if (!confirm(`Удалить шаблон «${rec.name}»?`)) return;
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
    alert(`Импорт завершён. Добавлено: ${res.added}, обновлено: ${res.updated}, всего: ${res.total}.`);
    renderList();
    renderDetail();
  } catch (e) {
    alert('Ошибка импорта: ' + e.message);
  }
  $fileImport.value = '';
});

async function onPdf() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const tpl = Report.createTemplate(rec.template);
  if (!tpl.content || tpl.content.length === 0) tpl.content = demoContent();
  try { await Report.exportPDF(tpl, rec.name || 'report'); }
  catch (e) { alert('Не удалось сформировать PDF: ' + e.message); }
}

async function onDocx() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const tpl = Report.createTemplate(rec.template);
  if (!tpl.content || tpl.content.length === 0) tpl.content = demoContent();
  try { await Report.exportDOCX(tpl, rec.name || 'report'); }
  catch (e) { alert('Не удалось сформировать DOCX: ' + e.message); }
}

// ——— события ———
$search.addEventListener('input', () => { state.filterText = $search.value; renderList(); });
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

// ——— запуск ———
seedBuiltinsIfNeeded();
renderList();
renderDetail();
