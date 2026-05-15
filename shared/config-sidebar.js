// =========================================================================
// shared/config-sidebar.js (v0.59.187)
// Универсальный левый сайдбар для standalone-конфигураторов.
//   • Основные настройки (form-слот, куда конфигуратор монтирует свои поля)
//   • Свойства (read-only инфо о выбранной/активной записи)
//   • Перечень сохранённых конфигураций (CRUD + поиск + применить).
//
// В embedded-режиме (isEmbeddedMode()=true) сайдбар не рендерится, вместо
// него можно вызвать mountEmbeddedPicker — компактный UI «Выберите шаблон»,
// который возвращает payload'ы выбранных конфигураций для применения к
// группам элементов.
//
// Использование:
//   import { mountConfigSidebar } from '../shared/config-sidebar.js';
//   const api = mountConfigSidebar({
//     kind: 'panel',
//     title: 'Щиты',
//     projectCode: null,                     // или 'ABC123' для привязки к проекту
//     onSelect: (entry) => { /* применить */ },
//     onSave:   () => ({ label, description, payload, projectCode? }),
//     renderSettings: (host) => { /* рендер формы основных настроек */ },
//     renderProperties: (host, entry) => { /* read-only свойства */ },
//   });
//   api.refresh();  // перечитать список
//   api.setActive(id);
// =========================================================================

import {
  listConfigs, listConfigsGrouped, listSelectionNames, setMainVariant,
  getConfig, saveConfig, removeConfig,
  onConfigsChange, formatConfigLine, isEmbeddedMode, getActiveProjectCode,
  ensureSelectionMeta, listSelectionMetas,
} from './configuration-catalog.js';
import { rsConfirm, rsPrompt, rsToast } from './dialog.js';

const SIDEBAR_CSS = `
.rs-cs-sidebar { display: flex; flex-direction: column; gap: 10px; padding: 12px; font: 13px/1.4 system-ui, sans-serif; color: #0f172a; box-sizing: border-box; height: 100%; overflow: auto; }
.rs-cs-sect { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.rs-cs-sect-head { padding: 8px 10px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; color: #475569; background: #f8fafc; border-bottom: 1px solid #e2e8f0; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
.rs-cs-sect-body { padding: 10px; }
.rs-cs-sect-body.rs-cs-slot { padding: 0; }
.rs-cs-search { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; margin-bottom: 8px; }
.rs-cs-list { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; }
.rs-cs-item { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
.rs-cs-item:hover { background: #f1f5f9; }
.rs-cs-item.rs-active { background: #dbeafe; }
.rs-cs-item:last-child { border-bottom: 0; }
.rs-cs-item-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-cs-item-id { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #334155; }
.rs-cs-item-label { font-weight: 500; }
.rs-cs-item-desc { color: #64748b; font-size: 11px; }
.rs-cs-item-actions { display: none; gap: 4px; }
.rs-cs-item:hover .rs-cs-item-actions { display: flex; }
.rs-cs-btn { cursor: pointer; padding: 3px 8px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; font: 11px/1 system-ui, sans-serif; color: #0f172a; }
.rs-cs-btn:hover { background: #f1f5f9; }
.rs-cs-btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.rs-cs-btn-primary:hover { background: #1d4ed8; }
.rs-cs-btn-danger:hover { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
.rs-cs-actions { display: flex; gap: 6px; margin-top: 8px; }
.rs-cs-empty { color: #94a3b8; font-size: 12px; padding: 10px; text-align: center; }
.rs-cs-prop { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; font-size: 12px; }
.rs-cs-prop dt { color: #64748b; }
.rs-cs-prop dd { margin: 0; color: #0f172a; word-break: break-word; }
.rs-cs-embed-picker { padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 8px 0; }
.rs-cs-embed-picker h4 { margin: 0 0 8px; font-size: 13px; }
/* v0.60.422: подборы (selections) с вариантами — сворачиваемые группы. */
.rs-cs-sel-block { border-bottom: 1px solid #e2e8f0; }
.rs-cs-sel-block:last-child { border-bottom: 0; }
.rs-cs-sel-head { padding: 6px 8px; background: #f1f5f9; font-size: 11px; font-weight: 600; color: #1e293b; cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.rs-cs-sel-head:hover { background: #e2e8f0; }
.rs-cs-sel-head.collapsed::before { content: '▶ '; font-size: 9px; color: #64748b; }
.rs-cs-sel-head:not(.collapsed)::before { content: '▼ '; font-size: 9px; color: #64748b; }
.rs-cs-sel-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-cs-sel-count { color: #64748b; font-weight: 400; font-size: 10px; }
.rs-cs-main-badge { background: #fef3c7; color: #92400e; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 600; margin-left: 4px; }
/* v0.60.434: дизайн как в «Подбор холода» (groupBySelection). */
.rs-cs-ctx { padding: 10px; }
.rs-cs-ctx label { display:block; font-size:11px; font-weight:600; color:#475569; margin-bottom:3px; text-transform:uppercase; letter-spacing:.3px; }
.rs-cs-ctx select { width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font:inherit; font-size:12px; background:#fff; cursor:pointer; }
.rs-cs-ctx-hint { font-size:10.5px; color:#64748b; margin-top:4px; }
.rs-cs-gbs .rs-cs-list { border:0; border-radius:0; max-height:none; overflow:visible; background:transparent; }
.rs-cs-gbs .rs-cs-sel-block { border:0; padding:8px 10px 0; }
.rs-cs-gbs .rs-cs-sel-head { padding:8px 12px; background:#fef3c7; border:1px solid #fde68a; border-radius:5px; font-size:12.5px; font-weight:600; color:#92400e; }
.rs-cs-gbs .rs-cs-sel-head:hover { background:#fde68a; }
.rs-cs-gbs .rs-cs-sel-head.rs-cs-sel-active { background:#fbbf24; border-color:#d97706; color:#78350f; }
.rs-cs-gbs .rs-cs-sel-head::before { color:#92400e; }
.rs-cs-gbs .rs-cs-sel-count { color:#78350f; opacity:.8; }
.rs-cs-gbs .rs-cs-sel-block > ul { margin:4px 0 0 14px; }
.rs-cs-gbs .rs-cs-item { border:1px solid #e5e7eb; background:#f9fafb; border-radius:5px; margin-bottom:4px; padding:8px 12px; }
.rs-cs-gbs .rs-cs-item:hover { background:#eff6ff; border-color:#93c5fd; }
.rs-cs-gbs .rs-cs-item.rs-active { background:#dbeafe; border-color:#1e40af; }
.rs-cs-gbs .rs-cs-item.rs-cs-item-main { background:#ecfdf5; border-color:#22c55e; }
.rs-cs-gbs .rs-cs-item.rs-cs-item-main.rs-active { background:#d1fae5; border-color:#16a34a; }
.rs-cs-gbs .rs-cs-main-badge { background:transparent; color:#16a34a; padding:0; margin-left:4px; font-size:10px; font-weight:700; }
.rs-cs-gbs .rs-cs-item-actions { display:flex; }
.rs-cs-addrow { display:flex; gap:6px; padding:10px; }
.rs-cs-addrow .rs-cs-btn { flex:1; padding:8px 10px; font-size:12.5px; text-align:center; }
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rs-cs-css')) return;
  const s = document.createElement('style');
  s.id = 'rs-cs-css';
  s.textContent = SIDEBAR_CSS;
  (document.head || document.documentElement).appendChild(s);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * mountConfigSidebar({ kind, title, projectCode, onSelect, onSave,
 *                      renderSettings, renderProperties, mountEl })
 *   В embedded-режиме возвращает { enabled:false } и ничего не рендерит.
 *   Иначе рендерит сайдбар и возвращает API { refresh, setActive, destroy }.
 */
export function mountConfigSidebar(opts) {
  if (isEmbeddedMode()) return { enabled: false };
  injectCss();
  const o = opts || {};
  const kind = o.kind;
  if (!kind) throw new Error('mountConfigSidebar: kind is required');

  const mountEl = o.mountEl || document.querySelector('aside.rs-sidebar-left')
                  || document.querySelector('aside.rs-sidebar');
  if (!mountEl) {
    console.warn('[config-sidebar] no mount element found');
    return { enabled: false };
  }

  const sections = Array.isArray(o.sections) && o.sections.length
    ? o.sections : ['settings', 'properties', 'list'];
  const has = (s) => sections.includes(s);
  // Авто-привязка к активному проекту, если не задано явно
  const baseProjectCode = o.projectCode != null ? o.projectCode : getActiveProjectCode();
  // v0.60.434: «КОНТЕКСТ ПОДБОРА» как в «Подбор холода» — привязка к проекту
  // ИЛИ разовый подбор (standalone). По умолчанию: если есть активный проект
  // — привязка к нему, иначе разовый. Выбор запоминается per-kind.
  const CTX_KEY = 'raschet.cs.ctx.' + kind;
  let ctxStandalone;
  try {
    const stored = o.groupBySelection ? localStorage.getItem(CTX_KEY) : null;
    ctxStandalone = stored ? stored === 'standalone' : !baseProjectCode;
  } catch { ctxStandalone = !baseProjectCode; }
  if (!baseProjectCode) ctxStandalone = true;
  // projectCode — действующий контекст (let: меняется при переключении).
  let projectCode = ctxStandalone ? null : baseProjectCode;
  const projHint = '';

  const root = document.createElement('div');
  root.className = 'rs-cs-sidebar' + (o.groupBySelection ? ' rs-cs-gbs' : '');
  const ctxBlock = (o.groupBySelection && has('list')) ? `
    <div class="rs-cs-sect">
      <div class="rs-cs-ctx">
        <label title="Контекст хранения подборов: привязка к проекту или разовый подбор (без проекта).">Контекст подбора</label>
        <select data-act="ctx" title="🔓 Разовый подбор — данные в общем хранилище, не привязаны к проекту. 📁 Проект — подборы сохраняются в активном проекте.">
          <option value="standalone"${ctxStandalone ? ' selected' : ''}>🔓 Разовый подбор</option>
          ${baseProjectCode ? `<option value="project"${!ctxStandalone ? ' selected' : ''}>📁 ${esc(baseProjectCode)}</option>` : ''}
        </select>
        <div class="rs-cs-ctx-hint">${ctxStandalone ? 'Разовый подбор — без привязки к проекту.' : 'Подборы сохраняются в проекте «' + esc(baseProjectCode) + '».'}</div>
      </div>
    </div>` : '';
  root.innerHTML = `
    ${ctxBlock}
    ${has('settings') ? `
    <div class="rs-cs-sect">
      <div class="rs-cs-sect-head">Основные настройки</div>
      <div class="rs-cs-sect-body rs-cs-slot" data-slot="settings"></div>
    </div>` : ''}
    ${has('properties') ? `
    <div class="rs-cs-sect">
      <div class="rs-cs-sect-head">Свойства</div>
      <div class="rs-cs-sect-body" data-slot="properties">
        <div class="rs-cs-empty">Конфигурация не выбрана.</div>
      </div>
    </div>` : ''}
    ${has('list') ? `
    <div class="rs-cs-sect">
      <div class="rs-cs-sect-head">
        <span>${o.groupBySelection ? '📋 ' + esc(o.title || 'Подборы') : esc(o.title || 'Конфигурации') + projHint}</span>
        ${o.groupBySelection ? '' : `<button type="button" class="rs-cs-btn rs-cs-btn-primary" data-act="save">+ Сохранить</button>`}
      </div>
      <div class="rs-cs-sect-body" style="${o.groupBySelection ? 'padding:0' : ''}">
        ${o.groupBySelection ? '' : '<input class="rs-cs-search" type="text" placeholder="Поиск по id/метке/описанию…">'}
        <ul class="rs-cs-list" data-slot="list"><li class="rs-cs-empty">Нет записей</li></ul>
        ${o.groupBySelection ? `
        <div class="rs-cs-addrow">
          <button type="button" class="rs-cs-btn rs-cs-btn-primary" data-act="addsel" title="Создать новый ПОДБОР (группа вариантов с общими условиями). Условия и финансы — в панели «Свойства подбора».">+ Подбор</button>
          <button type="button" class="rs-cs-btn" data-act="save" title="Сохранить текущее решение как ВАРИАНТ активного подбора.">+ Вариант</button>
        </div>` : ''}
      </div>
    </div>` : ''}
  `;
  mountEl.appendChild(root);

  const slotSettings = root.querySelector('[data-slot="settings"]');
  const slotProps    = root.querySelector('[data-slot="properties"]');
  const slotList     = root.querySelector('[data-slot="list"]');
  const searchInput  = root.querySelector('.rs-cs-search');
  if (slotSettings && typeof o.renderSettings === 'function') {
    try { o.renderSettings(slotSettings); } catch (e) { console.warn(e); }
  }

  let activeId = null;
  let activeSelName = null; // v0.60.432: активный подбор (для «+ Вариант»)
  let filter = '';
  // v0.60.422: коллапс-состояние подборов (Map<selectionName, collapsed:bool>).
  const collapsedSelections = new Map();

  function render() {
    if (!slotList) return;
    const groups = listConfigsGrouped(kind, {
      projectCode: projectCode || undefined,
      search: filter || undefined,
    });
    // v0.60.432: показываем и ПУСТЫЕ подборы (как в «Подбор холода») —
    // только что созданный «+ Подбор» без вариантов тоже виден в списке.
    if (o.groupBySelection && !filter) {
      for (const m of listSelectionMetas(kind, { projectCode: projectCode || undefined })) {
        const nm = String(m.selectionName || '').trim();
        if (nm && !groups.has(nm)) groups.set(nm, []);
      }
    }
    if (!groups.size) {
      slotList.innerHTML = `<li class="rs-cs-empty">${filter ? 'Ничего не найдено'
        : (o.groupBySelection
            ? 'Подборов пока нет. Кнопка «+ Подбор» создаст первый. В одном подборе держите альтернативные варианты (моноблок vs модульный vs гибрид) для сравнения.'
            : 'Нет записей')}</li>`;
      return;
    }
    // v0.60.422/v0.60.424: рендерим группы (Подборы) с вложенными вариантами.
    // По умолчанию (groupBySelection !== true) если только одна группа
    // «— Без подбора —» — рендерим плоско (backward-compat для panel/mv/etc.).
    // Если модуль явно включил groupBySelection (ups-config) — ВСЕГДА
    // показываем структуру подборов, чтобы фича была видна и понятна.
    const onlyDefault = groups.size === 1 && groups.has('— Без подбора —');
    if (onlyDefault && !o.groupBySelection) {
      const entries = groups.get('— Без подбора —');
      slotList.innerHTML = entries.map(e => renderEntryItem(e)).join('');
      return;
    }
    const html = [];
    for (const [selName, entries] of groups) {
      const collapsed = collapsedSelections.get(selName) === true;
      const mainEntry = entries.find(e => e.isMainVariant);
      const selActive = activeSelName && selName === activeSelName;
      html.push(`<li class="rs-cs-sel-block">
        <div class="rs-cs-sel-head${collapsed ? ' collapsed' : ''}${selActive ? ' rs-cs-sel-active' : ''}" data-act-sel="toggle" data-sel-name="${esc(selName)}" title="Активный подбор — общие условия и финансы задаются в панели «Свойства подбора».">
          <span class="rs-cs-sel-name">📋 ${esc(selName)}</span>
          <span class="rs-cs-sel-count">${entries.length} вар.${mainEntry ? ' · ★ ' + esc(mainEntry.label || mainEntry.id) : ''}</span>
        </div>
        ${collapsed ? '' : `<ul style="list-style:none;padding:0;margin:0">${entries.map(e => renderEntryItem(e)).join('')}</ul>`}
      </li>`);
    }
    slotList.innerHTML = html.join('');
  }

  function renderEntryItem(e) {
    const mainBadge = e.isMainVariant
      ? '<span class="rs-cs-main-badge" title="Основной вариант подбора">★ основной</span>'
      : '';
    return `
      <li class="rs-cs-item ${e.id === activeId ? 'rs-active' : ''}${e.isMainVariant ? ' rs-cs-item-main' : ''}" data-id="${esc(e.id)}">
        <div class="rs-cs-item-main">
          <span class="rs-cs-item-id">${esc(e.id)}</span>${mainBadge}
          ${e.label ? ` · <span class="rs-cs-item-label">${esc(e.label)}</span>` : ''}
          ${e.description ? `<div class="rs-cs-item-desc">${esc(e.description)}</div>` : ''}
        </div>
        <div class="rs-cs-item-actions">
          ${o.groupBySelection ? `<button type="button" class="rs-cs-btn" data-act="movesel" title="Переместить в подбор / создать подбор">📋</button>` : ''}
          ${e.selectionName && !e.isMainVariant ? `<button type="button" class="rs-cs-btn" data-act="setmain" title="Сделать основным вариантом подбора">★</button>` : ''}
          <button type="button" class="rs-cs-btn" data-act="rename" title="Переименовать">✎</button>
          <button type="button" class="rs-cs-btn rs-cs-btn-danger" data-act="del" title="Удалить">✕</button>
        </div>
      </li>
    `;
  }

  function renderProps(entry) {
    if (!slotProps) return;
    if (!entry) {
      slotProps.innerHTML = '<div class="rs-cs-empty">Конфигурация не выбрана.</div>';
      return;
    }
    if (typeof o.renderProperties === 'function') {
      slotProps.innerHTML = '';
      try { o.renderProperties(slotProps, entry); }
      catch (e) { console.warn('[config-sidebar] renderProperties error', e); }
      return;
    }
    const created = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—';
    const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '—';
    slotProps.innerHTML = `
      <dl class="rs-cs-prop">
        <dt>ID</dt><dd>${esc(entry.id)}</dd>
        ${entry.label ? `<dt>Метка</dt><dd>${esc(entry.label)}</dd>` : ''}
        ${entry.description ? `<dt>Описание</dt><dd>${esc(entry.description)}</dd>` : ''}
        ${entry.projectCode ? `<dt>Проект</dt><dd>${esc(entry.projectCode)}</dd>` : ''}
        <dt>Создана</dt><dd>${esc(created)}</dd>
        <dt>Изменена</dt><dd>${esc(updated)}</dd>
      </dl>
    `;
  }

  // v0.60.428: уведомление об активном ПОДБОРЕ — для shared/selection-panel.js
  // (панель условий + TCO). Опциональный колбэк o.onSelectionChange + window
  // CustomEvent 'rs-selection-change' (backward-compatible: модули без панели
  // его просто игнорируют).
  function fireSel(name) {
    const sel = String(name || '').trim() || null;
    activeSelName = sel;
    try { if (typeof o.onSelectionChange === 'function') o.onSelectionChange(sel); } catch {}
    try { window.dispatchEvent(new CustomEvent('rs-selection-change', { detail: { kind, selectionName: sel } })); } catch {}
  }

  // Делегирование кликов по списку
  if (slotList) slotList.addEventListener('click', async (ev) => {
    // v0.60.422: клик на header подбора → toggle collapsed.
    const selHead = ev.target.closest('[data-act-sel="toggle"]');
    if (selHead) {
      const name = selHead.getAttribute('data-sel-name');
      collapsedSelections.set(name, !(collapsedSelections.get(name) === true));
      render();
      fireSel(name);
      return;
    }
    const btn = ev.target.closest('[data-act]');
    const li = ev.target.closest('.rs-cs-item');
    if (!li) return;
    const id = li.getAttribute('data-id');
    // v0.60.424: «📋» — переместить вариант в подбор / создать подбор.
    if (btn && btn.dataset.act === 'movesel') {
      ev.stopPropagation();
      const e = getConfig(kind, id);
      if (!e) return;
      const existing = listSelectionNames(kind, { projectCode: projectCode || undefined }).slice(0, 20);
      const hint = existing.length
        ? `\n\nСуществующие подборы:\n${existing.map(s => '• ' + s).join('\n')}\n\n(пусто = убрать из подбора)`
        : '\n\n(пусто = без подбора)';
      const res = await rsPrompt('Переместить в подбор' + hint, e.selectionName || (existing[0] || ''));
      if (res == null) return;
      const sel = String(res || '').trim();
      saveConfig(kind, { ...e, selectionName: sel || undefined });
      rsToast(sel ? ('Перемещено → подбор «' + sel + '»') : 'Убрано из подбора', 'ok');
      if (sel) fireSel(sel);
      return;
    }
    // v0.60.422: «★» — пометить как основной вариант подбора.
    if (btn && btn.dataset.act === 'setmain') {
      ev.stopPropagation();
      const e = getConfig(kind, id);
      if (!e || !e.selectionName) return;
      setMainVariant(kind, e.selectionName, id);
      rsToast('Основной вариант изменён', 'ok');
      return;
    }
    if (btn && btn.dataset.act === 'del') {
      ev.stopPropagation();
      const ok = await rsConfirm('Удалить конфигурацию?', id, { okLabel: 'Удалить', cancelLabel: 'Отмена' });
      if (!ok) return;
      removeConfig(kind, id);
      if (activeId === id) { activeId = null; renderProps(null); }
      rsToast('Удалено', 'ok');
      return;
    }
    if (btn && btn.dataset.act === 'rename') {
      ev.stopPropagation();
      const e = getConfig(kind, id);
      if (!e) return;
      const newLabel = await rsPrompt('Метка конфигурации', e.label || '');
      if (newLabel == null) return;
      const newDesc = await rsPrompt('Описание (что конфигурировали)', e.description || '');
      if (newDesc == null) return;
      saveConfig(kind, { ...e, label: newLabel, description: newDesc });
      rsToast('Сохранено', 'ok');
      return;
    }
    // обычный клик = выбрать / применить
    activeId = id;
    const e = getConfig(kind, id);
    renderProps(e);
    render();
    if (e && typeof o.onSelect === 'function') {
      try { o.onSelect(e); } catch (err) { console.warn(err); }
    }
    if (e) fireSel(e.selectionName || null);
  });

  // Сохранить
  const saveBtn = root.querySelector('[data-act="save"]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    let data = {};
    if (typeof o.onSave === 'function') {
      try { data = o.onSave() || {}; }
      catch (e) { console.warn('[config-sidebar] onSave error', e); rsToast('Ошибка сохранения', 'err'); return; }
    }
    // v0.60.424: если модуль использует подборы (groupBySelection) —
    // спрашиваем имя Подбора (с подсказкой существующих) ДО метки/описания,
    // чтобы новая запись сразу попала в группу.
    let selectionName = data.selectionName;
    if (o.groupBySelection && selectionName == null) {
      // v0.60.432: «+ Вариант» добавляет в АКТИВНЫЙ подбор без лишнего
      // вопроса (как в «Подбор холода»). Если активного нет — спрашиваем.
      if (activeSelName) {
        selectionName = activeSelName;
      } else {
        const existing = listSelectionNames(kind, { projectCode: projectCode || undefined }).slice(0, 20);
        const hint = existing.length
          ? `\n\nСуществующие подборы (впишите имя, чтобы добавить вариант в этот подбор):\n${existing.map(s => '• ' + s).join('\n')}`
          : '\n\nСначала создайте подбор кнопкой «+ Подбор».';
        const sres = await rsPrompt('Название подбора (группа вариантов)' + hint, existing[0] || 'Подбор 1');
        if (sres == null) return;
        selectionName = String(sres || '').trim() || (existing[0] || 'Подбор 1');
      }
    }
    const label = data.label != null ? data.label :
      await rsPrompt('Метка варианта (коротко)', '');
    if (label == null) return;
    const description = data.description != null ? data.description :
      await rsPrompt('Описание (что именно конфигурировали)', '');
    if (description == null) return;
    const saved = saveConfig(kind, {
      label, description,
      selectionName: selectionName || undefined,
      projectCode: data.projectCode || projectCode || undefined,
      payload: data.payload || {},
    });
    activeId = saved.id;
    renderProps(saved);
    rsToast('Сохранено: ' + saved.id + (selectionName ? ' → подбор «' + selectionName + '»' : ''), 'ok');
    if (selectionName) fireSel(selectionName);
  });

  // v0.60.432: «+ Подбор» — создать новый ПОДБОР (как в «Подбор холода»).
  const addSelBtn = root.querySelector('[data-act="addsel"]');
  if (addSelBtn) addSelBtn.addEventListener('click', async () => {
    const existing = listSelectionNames(kind, { projectCode: projectCode || undefined });
    const def = `Подбор ${existing.length + 1}`;
    const res = await rsPrompt('Название нового подбора (общие условия + варианты)', def);
    if (res == null) return;
    const name = String(res || '').trim() || def;
    ensureSelectionMeta(kind, { projectCode: projectCode || null, selectionName: name },
      { requirements: {}, eco: {} });
    fireSel(name);          // активируем → панель «Свойства подбора» откроется
    render();
    rsToast(`Подбор «${name}» создан. Задайте условия в «Свойства подбора», добавляйте решения кнопкой «+ Вариант».`, 'ok');
  });

  if (searchInput) searchInput.addEventListener('input', () => {
    filter = searchInput.value.trim();
    render();
  });

  // v0.60.434: переключение «Контекст подбора» (проект ↔ разовый подбор).
  const ctxSel = root.querySelector('[data-act="ctx"]');
  if (ctxSel) ctxSel.addEventListener('change', () => {
    ctxStandalone = ctxSel.value === 'standalone';
    try { localStorage.setItem(CTX_KEY, ctxStandalone ? 'standalone' : 'project'); } catch {}
    projectCode = ctxStandalone ? null : baseProjectCode;
    activeSelName = null;
    activeId = null;
    const hint = root.querySelector('.rs-cs-ctx-hint');
    if (hint) hint.textContent = ctxStandalone
      ? 'Разовый подбор — без привязки к проекту.'
      : 'Подборы сохраняются в проекте «' + baseProjectCode + '».';
    render();
    // Панель «Свойства подбора / TCO» должна перепривязаться к новому
    // контексту (projectCode) и сбросить активный подбор.
    try { window.dispatchEvent(new CustomEvent('rs-cs-context', { detail: { kind, projectCode } })); } catch {}
    fireSel(null);
  });

  const unsub = onConfigsChange(kind, () => render());
  render();

  return {
    enabled: true,
    refresh: render,
    setActive(id) {
      activeId = id || null;
      renderProps(activeId ? getConfig(kind, activeId) : null);
      render();
    },
    destroy() {
      try { unsub && unsub(); } catch {}
      root.remove();
    },
  };
}

/**
 * mountEmbeddedPicker({ kind, mountEl, onApply }) — в embedded-режиме
 * показывает список сохранённых конфигураций как «шаблоны» для применения
 * к группам элементов. Возвращает { refresh, destroy } или { enabled:false }
 * если режим standalone.
 */
export function mountEmbeddedPicker(opts) {
  if (!isEmbeddedMode()) return { enabled: false };
  injectCss();
  const o = opts || {};
  const kind = o.kind;
  if (!kind) throw new Error('mountEmbeddedPicker: kind is required');
  const mountEl = o.mountEl || document.body;

  const wrap = document.createElement('div');
  wrap.className = 'rs-cs-embed-picker';
  wrap.innerHTML = `
    <h4>${esc(o.title || 'Выбор шаблона')}</h4>
    <input class="rs-cs-search" type="text" placeholder="Поиск…">
    <ul class="rs-cs-list" data-slot="list"></ul>
  `;
  mountEl.appendChild(wrap);
  const listEl = wrap.querySelector('[data-slot="list"]');
  const search = wrap.querySelector('.rs-cs-search');
  let filter = '';

  function render() {
    const items = listConfigs(kind, { search: filter || undefined });
    if (!items.length) {
      listEl.innerHTML = '<li class="rs-cs-empty">Нет сохранённых шаблонов</li>';
      return;
    }
    listEl.innerHTML = items.map(e => `
      <li class="rs-cs-item" data-id="${esc(e.id)}">
        <div class="rs-cs-item-main">
          <span class="rs-cs-item-id">${esc(e.id)}</span>
          ${e.label ? ` · <span class="rs-cs-item-label">${esc(e.label)}</span>` : ''}
          ${e.description ? `<div class="rs-cs-item-desc">${esc(e.description)}</div>` : ''}
        </div>
        <div class="rs-cs-item-actions" style="display:flex">
          <button type="button" class="rs-cs-btn rs-cs-btn-primary" data-act="apply">Применить</button>
        </div>
      </li>
    `).join('');
  }

  // Распарсить target nodeIds, переданные родителем через URL:
  //   ?embedded=1&targets=id1,id2,id3
  function readTargets() {
    try {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('targets') || p.get('target') || '';
      return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
    } catch { return []; }
  }

  listEl.addEventListener('click', ev => {
    const li = ev.target.closest('.rs-cs-item');
    if (!li) return;
    const e = getConfig(kind, li.getAttribute('data-id'));
    if (e && typeof o.onApply === 'function') {
      try { o.onApply(e, readTargets()); } catch (err) { console.warn(err); }
    }
  });
  search.addEventListener('input', () => { filter = search.value.trim(); render(); });
  const unsub = onConfigsChange(kind, () => render());
  render();

  return {
    enabled: true,
    refresh: render,
    destroy() { try { unsub && unsub(); } catch {} wrap.remove(); },
  };
}
