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
  listConfigs, getConfig, saveConfig, removeConfig,
  onConfigsChange, formatConfigLine, isEmbeddedMode, getActiveProjectCode,
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
  const projectCode = o.projectCode != null ? o.projectCode : getActiveProjectCode();
  const projHint = projectCode
    ? `<span style="font-size:10px;color:#64748b;font-weight:400;margin-left:6px">@ ${esc(projectCode)}</span>` : '';

  const root = document.createElement('div');
  root.className = 'rs-cs-sidebar';
  root.innerHTML = `
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
        <span>${esc(o.title || 'Конфигурации')}${projHint}</span>
        <button type="button" class="rs-cs-btn rs-cs-btn-primary" data-act="save">+ Сохранить</button>
      </div>
      <div class="rs-cs-sect-body">
        <input class="rs-cs-search" type="text" placeholder="Поиск по id/метке/описанию…">
        <ul class="rs-cs-list" data-slot="list"><li class="rs-cs-empty">Нет записей</li></ul>
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
  let filter = '';

  function render() {
    if (!slotList) return;
    const entries = listConfigs(kind, {
      projectCode: projectCode || undefined,
      search: filter || undefined,
    });
    if (!entries.length) {
      slotList.innerHTML = `<li class="rs-cs-empty">${filter ? 'Ничего не найдено' : 'Нет записей'}</li>`;
      return;
    }
    slotList.innerHTML = entries.map(e => `
      <li class="rs-cs-item ${e.id === activeId ? 'rs-active' : ''}" data-id="${esc(e.id)}">
        <div class="rs-cs-item-main">
          <span class="rs-cs-item-id">${esc(e.id)}</span>
          ${e.label ? ` · <span class="rs-cs-item-label">${esc(e.label)}</span>` : ''}
          ${e.description ? `<div class="rs-cs-item-desc">${esc(e.description)}</div>` : ''}
        </div>
        <div class="rs-cs-item-actions">
          <button type="button" class="rs-cs-btn" data-act="rename" title="Переименовать">✎</button>
          <button type="button" class="rs-cs-btn rs-cs-btn-danger" data-act="del" title="Удалить">✕</button>
        </div>
      </li>
    `).join('');
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

  // Делегирование кликов по списку
  if (slotList) slotList.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    const li = ev.target.closest('.rs-cs-item');
    if (!li) return;
    const id = li.getAttribute('data-id');
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
  });

  // Сохранить
  const saveBtn = root.querySelector('[data-act="save"]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    let data = {};
    if (typeof o.onSave === 'function') {
      try { data = o.onSave() || {}; }
      catch (e) { console.warn('[config-sidebar] onSave error', e); rsToast('Ошибка сохранения', 'err'); return; }
    }
    const label = data.label != null ? data.label :
      await rsPrompt('Метка конфигурации (коротко)', '');
    if (label == null) return;
    const description = data.description != null ? data.description :
      await rsPrompt('Описание (что именно конфигурировали)', '');
    if (description == null) return;
    const saved = saveConfig(kind, {
      label, description,
      projectCode: data.projectCode || projectCode || undefined,
      payload: data.payload || {},
    });
    activeId = saved.id;
    renderProps(saved);
    rsToast('Сохранено: ' + saved.id, 'ok');
  });

  if (searchInput) searchInput.addEventListener('input', () => {
    filter = searchInput.value.trim();
    render();
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

  listEl.addEventListener('click', ev => {
    const li = ev.target.closest('.rs-cs-item');
    if (!li) return;
    const e = getConfig(kind, li.getAttribute('data-id'));
    if (e && typeof o.onApply === 'function') {
      try { o.onApply(e); } catch (err) { console.warn(err); }
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
