// ======================================================================
// elements/elements-editor.js
// Minimal UI для управления element-library.
//
// Фаза 1.1.3 MVP: CRUD операций + фильтры + импорт/экспорт JSON.
// Не входит в MVP: загрузка SVG для views, настройка портов, визуальный
// редактор composition, drag-n-drop — это Фаза 2+.
// ======================================================================

import {
  listElements, getElement, saveElement, removeElement, cloneElement,
  exportLibraryJSON, importLibraryJSON, onLibraryChange,
  ELEMENT_KINDS,
} from '../shared/element-library.js';
import { initCatalogBridge } from '../shared/catalog-bridge.js';
import { createElement } from '../shared/element-schemas.js';
import { rsConfirm, rsPrompt } from '../shared/dialog.js';

// Важно: bridge регистрирует legacy-каталоги как builtin — иначе список
// будет пустой (elements/ страница не загружает engine).
initCatalogBridge();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// ====================== Фильтры ======================
const filters = { kind: '', source: '', search: '' };

function matchesFilter(el) {
  if (filters.kind && el.kind !== filters.kind) return false;
  if (filters.source) {
    if (filters.source === 'builtin' && !el.builtin) return false;
    if (filters.source === 'user' && el.source !== 'user') return false;
    if (filters.source === 'imported' && el.source !== 'imported') return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay = [el.label, el.manufacturer, el.series, el.variant, el.id]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ====================== Рендер ======================
function render() {
  const all = listElements();
  const filtered = all.filter(matchesFilter);
  const container = document.getElementById('element-list');
  if (!container) return;

  // Статистика
  const stats = document.getElementById('stats');
  if (stats) {
    const byKind = {};
    for (const e of all) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    const parts = [`<b>${all.length}</b> элементов всего`];
    if (filtered.length !== all.length) parts.push(`отфильтровано: <b>${filtered.length}</b>`);
    const kindSummary = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(', ');
    parts.push(`(${kindSummary})`);
    stats.innerHTML = parts.join(' · ');
  }

  // Группируем по kind
  const groups = {};
  for (const el of filtered) {
    const k = el.kind || 'other';
    (groups[k] = groups[k] || []).push(el);
  }

  const html = [];
  if (!filtered.length) {
    html.push('<div class="muted" style="padding:20px;text-align:center">Ничего не найдено по текущим фильтрам.</div>');
  }
  for (const [kind, items] of Object.entries(groups)) {
    const kindDef = ELEMENT_KINDS[kind] || { label: kind };
    html.push(`<div class="kind-group">`);
    html.push(`<div class="kind-header">${esc(kindDef.label)} <span class="muted" style="font-weight:400">· ${items.length}</span></div>`);
    for (const el of items) {
      const srcBadge = el.builtin
        ? '<span class="badge builtin">builtin</span>'
        : el.source === 'imported'
          ? '<span class="badge imported">imported</span>'
          : '<span class="badge user">user</span>';
      const meta = [el.manufacturer, el.series, el.variant].filter(Boolean).join(' · ');
      html.push(`<div class="element-row" data-id="${esc(el.id)}">`);
      html.push(`<div class="element-label">`);
      html.push(`<span class="element-title">${srcBadge} ${esc(el.label || el.id)}</span>`);
      if (meta) html.push(`<span class="element-meta">${esc(meta)}</span>`);
      html.push(`<span class="element-meta" style="font-family:monospace">${esc(el.id)}</span>`);
      html.push(`</div>`);
      html.push(`<div class="row-actions">`);
      html.push(`<button data-act="view">Просмотр</button>`);
      if (!el.builtin) html.push(`<button data-act="edit">Редактировать</button>`);
      html.push(`<button data-act="clone">Клонировать</button>`);
      if (!el.builtin) html.push(`<button data-act="delete" class="danger">×</button>`);
      html.push(`</div>`);
      html.push(`</div>`);
    }
    html.push(`</div>`);
  }
  container.innerHTML = html.join('');
  wireRowActions();
}

function wireRowActions() {
  document.querySelectorAll('.element-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'view') viewElement(id);
        else if (act === 'edit') editElement(id);
        else if (act === 'clone') doClone(id);
        else if (act === 'delete') doDelete(id);
      });
    });
  });
}

// ====================== Actions ======================
function viewElement(id) {
  const el = getElement(id);
  if (!el) return flash('Элемент не найден', 'error');
  const json = JSON.stringify(el, null, 2);
  openEditModal({ title: 'Просмотр: ' + el.label, element: el, readOnly: true, jsonOverride: json });
}

function editElement(id) {
  const el = getElement(id);
  if (!el) return flash('Элемент не найден', 'error');
  if (el.builtin) return flash('Встроенные элементы нельзя редактировать. Склонируйте.', 'warn');
  openEditModal({ title: 'Редактирование: ' + el.label, element: el });
}

async function doClone(id) {
  const el = getElement(id);
  if (!el) return flash('Элемент не найден', 'error');
  const newName = await rsPrompt('Имя клона:', (el.label || id) + ' (копия)');
  if (!newName) return;
  try {
    const cloned = cloneElement(id, newName);
    flash('Клонировано: ' + cloned.label, 'success');
    render();
  } catch (e) {
    flash('Ошибка: ' + e.message, 'error');
  }
}

async function doDelete(id) {
  const el = getElement(id);
  if (!el) return;
  if (el.builtin) return flash('Встроенные нельзя удалить', 'warn');
  if (!(await rsConfirm('Удалить элемент «' + (el.label || id) + '»?', '', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
  const ok = removeElement(id);
  flash(ok ? 'Удалено' : 'Не удалось удалить', ok ? 'success' : 'error');
  if (ok) render();
}

// ====================== Модалка редактирования ======================
function openEditModal({ title, element, readOnly, jsonOverride }) {
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-title').textContent = title;
  const form = document.getElementById('edit-form');

  const el = element || { kind: 'custom', label: '' };
  const jsonText = jsonOverride || JSON.stringify(el, null, 2);

  const kindOpts = Object.entries(ELEMENT_KINDS).map(([k, def]) =>
    `<option value="${k}"${k === el.kind ? ' selected' : ''}>${esc(def.label)}</option>`
  ).join('');

  form.innerHTML = `
    <div class="field">
      <label>ID (kebab-case, уникальный)</label>
      <input type="text" id="f-id" value="${esc(el.id || '')}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>Kind</label>
      <select id="f-kind" ${readOnly ? 'disabled' : ''}>${kindOpts}</select>
    </div>
    <div class="field">
      <label>Название</label>
      <input type="text" id="f-label" value="${esc(el.label || '')}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>Производитель</label>
      <input type="text" id="f-manufacturer" value="${esc(el.manufacturer || '')}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>Серия</label>
      <input type="text" id="f-series" value="${esc(el.series || '')}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>Вариант / артикул</label>
      <input type="text" id="f-variant" value="${esc(el.variant || '')}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>Описание</label>
      <textarea id="f-description" ${readOnly ? 'readonly' : ''} rows="2">${esc(el.description || '')}</textarea>
    </div>
    <div class="field">
      <label>Теги (через запятую)</label>
      <input type="text" id="f-tags" value="${esc((el.tags || []).join(', '))}" ${readOnly ? 'readonly' : ''}>
    </div>
    <div class="field">
      <label>JSON (расширенные параметры, electrical/geometry/kindProps/composition)</label>
      <textarea id="f-json" ${readOnly ? 'readonly' : ''} rows="10">${esc(jsonText)}</textarea>
    </div>
  `;

  modal.classList.add('show');
  document.getElementById('edit-save').style.display = readOnly ? 'none' : '';

  document.getElementById('edit-cancel').onclick = () => modal.classList.remove('show');
  document.getElementById('edit-save').onclick = () => {
    if (readOnly) return;
    try {
      const id = document.getElementById('f-id').value.trim();
      const kind = document.getElementById('f-kind').value;
      if (!id) return flash('ID обязателен', 'error');
      // Пытаемся распарсить JSON — это источник правды для сложных полей
      const rawJson = document.getElementById('f-json').value;
      let base;
      try { base = JSON.parse(rawJson); } catch (e) { return flash('JSON невалиден: ' + e.message, 'error'); }
      // Поверх JSON накладываем простые поля из формы (label/manufacturer/…)
      const tags = document.getElementById('f-tags').value
        .split(',').map(s => s.trim()).filter(Boolean);
      const patch = {
        ...base,
        id, kind,
        label: document.getElementById('f-label').value,
        manufacturer: document.getElementById('f-manufacturer').value || undefined,
        series: document.getElementById('f-series').value || undefined,
        variant: document.getElementById('f-variant').value || undefined,
        description: document.getElementById('f-description').value || undefined,
        tags: tags.length ? tags : undefined,
      };
      // Factory заполняет все остальные поля дефолтами если их нет
      const full = createElement(kind, patch);
      saveElement(full);
      flash('Сохранено', 'success');
      modal.classList.remove('show');
      render();
    } catch (e) {
      flash('Ошибка сохранения: ' + e.message, 'error');
    }
  };
}

// ====================== Wire UI ======================
function wireToolbar() {
  // Заполняем kind-filter опциями
  const sel = document.getElementById('filter-kind');
  for (const [k, def] of Object.entries(ELEMENT_KINDS)) {
    sel.innerHTML += `<option value="${k}">${esc(def.label)}</option>`;
  }

  document.getElementById('filter-kind').addEventListener('change', e => {
    filters.kind = e.target.value; render();
  });
  document.getElementById('filter-source').addEventListener('change', e => {
    filters.source = e.target.value; render();
  });
  document.getElementById('filter-search').addEventListener('input', e => {
    filters.search = e.target.value; render();
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    render();
    flash('Обновлено', 'success');
  });

  document.getElementById('btn-add').addEventListener('click', async () => {
    const id = await rsPrompt('ID нового элемента (например "my-panel-1"):', '');
    if (!id) return;
    if (getElement(id)) return flash('Элемент с таким ID уже существует', 'error');
    openEditModal({ title: 'Новый элемент', element: { id, kind: 'custom', label: id, source: 'user' } });
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const json = exportLibraryJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'element-library-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    flash('Экспорт готов', 'success');
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const mode = (await rsConfirm('Режим импорта', 'Merge — дополнить существующие. Replace — заменить всё пользовательское.', { okLabel: 'Merge', cancelLabel: 'Replace' })) ? 'merge' : 'replace';
    try {
      const text = await file.text();
      const result = importLibraryJSON(text, mode);
      flash(`Импорт: +${result.added}, обновлено ${result.updated}, всего ${result.total}`, 'success');
      render();
    } catch (err) {
      flash('Ошибка импорта: ' + err.message, 'error');
    }
    e.target.value = '';
  });
}

// ====================== Bootstrap ======================
document.addEventListener('DOMContentLoaded', () => {
  wireToolbar();
  // Первый рендер — ждём немного чтобы catalog-bridge успел зарегистрировать
  setTimeout(render, 200);
  // Реактивность — при изменении library (save/remove/import) re-render
  onLibraryChange(() => render());
});
