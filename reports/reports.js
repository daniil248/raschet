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

import * as Report   from '../shared/report/index.js';
import * as B        from '../shared/report/blocks.js';
import * as Catalog  from '../shared/report-catalog.js';
import { BUILTIN_TEMPLATES, BUILTIN_VERSION, getDemoContent } from './templates-seed.js';
import { openHelp }  from './help.js';
import { rsToast, rsConfirm } from '../shared/dialog.js';

// Версия встроенных шаблонов хранится отдельно — при смене перезаседаем
// только builtin-записи, пользовательские не трогаем.
const BUILTIN_VER_KEY = 'raschet.reportCatalog.builtinVersion';

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

  // Превью: клонируем шаблон, вливаем демо-контент (если контент пуст).
  // Для встроенных шаблонов demoContentFor отдаёт персональный набор —
  // так пользователь видит реалистичное представление отчёта под задачу.
  const previewTpl = Report.createTemplate(rec.template);
  if (!previewTpl.content || previewTpl.content.length === 0) {
    previewTpl.content = demoContentFor(rec);
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
  const tpl = Report.createTemplate(rec.template);
  if (!tpl.content || tpl.content.length === 0) tpl.content = demoContentFor(rec);
  try { await Report.exportPDF(tpl, rec.name || 'report'); }
  catch (e) { rsToast('Не удалось сформировать PDF: ' + e.message, 'err'); }
}

async function onDocx() {
  const rec = state.selectedId ? Catalog.getTemplate(state.selectedId) : null;
  if (!rec) return;
  const tpl = Report.createTemplate(rec.template);
  if (!tpl.content || tpl.content.length === 0) tpl.content = demoContentFor(rec);
  try { await Report.exportDOCX(tpl, rec.name || 'report'); }
  catch (e) { rsToast('Не удалось сформировать DOCX: ' + e.message, 'err'); }
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
if ($btnHelp) $btnHelp.addEventListener('click', openHelp);

// ——— запуск ———
seedBuiltinsIfNeeded();
renderList();
renderDetail();
