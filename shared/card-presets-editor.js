// =========================================================================
// shared/card-presets-editor.js — v0.59.787 (Phase 19.3)
//
// Модалка редактирования пресетов карточек. Открывается из toolbar (кнопка ✎)
// или программно через openCardPresetEditor().
//
// Tabs:
//   1. «Пресеты» — список user-пресетов + создать / переименовать / удалить +
//      выбрать активный. Системные пресеты read-only (показываются как
//      шаблоны для копирования).
//   2. «Поля» — для активного user-пресета: per-mode-tabs (schematic /
//      layout / scs-design), per-type sub-tabs (consumer / panel / ...),
//      чекбоксы на каждое поле. Required-поля заблокированы (всегда on).
//   3. «Импорт/Экспорт» — JSON download / upload для всех user-пресетов.
//
// Пользователь: «Сами настройки нужно так же сохранять в пресеты чтобы пользователь
// мог быстро их переключать».
// =========================================================================

import {
  SYSTEM_PRESETS, listAllPresets, getPresetById,
  loadUserPresets, saveUserPresets,
  getUserActivePresetId, setUserActivePresetId,
  createUserPreset, deleteUserPreset, renameUserPreset, setUserPresetFields,
} from './card-presets.js';
import { CARD_FIELDS, listCardFields, requiredFieldIds } from './card-fields-registry.js';

// ─── escape helpers
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return escHtml(s); }

// ─── Editor state
let _state = {
  selectedPresetId: null,   // editing this preset
  activeModeTab: 'schematic', // schematic | layout | scs-design
  activeTypeTab: 'consumer',  // node type
  activeMainTab: 'presets',   // presets | fields | io
};

// ─── Render
function render(root) {
  const presets = listAllPresets();
  const activeId = getUserActivePresetId();
  if (!_state.selectedPresetId || !presets.find(p => p.id === _state.selectedPresetId)) {
    _state.selectedPresetId = activeId;
  }
  const sel = getPresetById(_state.selectedPresetId);
  const isSystem = !!(sel && sel.system);
  const userPresets = loadUserPresets();

  root.innerHTML = `
    <div class="cpe-modal">
      <div class="cpe-head">
        <h2>🎴 Пресеты отображения карточек</h2>
        <button class="cpe-close" type="button">×</button>
      </div>
      <div class="cpe-tabs">
        <button class="cpe-tab${_state.activeMainTab === 'presets' ? ' active' : ''}" data-main-tab="presets">📋 Пресеты</button>
        <button class="cpe-tab${_state.activeMainTab === 'fields' ? ' active' : ''}" data-main-tab="fields"${isSystem ? ' disabled title="Системный пресет нельзя редактировать — скопируйте его сначала"' : ''}>✎ Поля</button>
        <button class="cpe-tab${_state.activeMainTab === 'io' ? ' active' : ''}" data-main-tab="io">⇅ Импорт/Экспорт</button>
      </div>
      <div class="cpe-body">
        ${_state.activeMainTab === 'presets' ? _renderPresetsTab(presets, activeId, userPresets) : ''}
        ${_state.activeMainTab === 'fields' ? _renderFieldsTab(sel, isSystem) : ''}
        ${_state.activeMainTab === 'io' ? _renderIoTab(userPresets) : ''}
      </div>
    </div>
  `;
}

function _renderPresetsTab(presets, activeId, userPresets) {
  const sysGroup = presets.filter(p => p.system);
  const userGroup = presets.filter(p => !p.system);
  return `<div class="cpe-pane cpe-pane-presets">
    <div class="cpe-pane-section">
      <h3>Системные (read-only)</h3>
      <div class="cpe-presets-grid">
        ${sysGroup.map(p => _presetCardHtml(p, activeId, _state.selectedPresetId)).join('')}
      </div>
    </div>
    <div class="cpe-pane-section">
      <div class="cpe-pane-section-head">
        <h3>Пользовательские (${userGroup.length})</h3>
        <button class="cpe-btn cpe-btn-primary" data-action="create">➕ Создать</button>
      </div>
      ${userGroup.length === 0
        ? `<div class="cpe-empty">Нет user-пресетов. Создайте новый или скопируйте системный.</div>`
        : `<div class="cpe-presets-grid">${userGroup.map(p => _presetCardHtml(p, activeId, _state.selectedPresetId)).join('')}</div>`}
    </div>
    <div class="cpe-info muted">
      <b>Как работает:</b> Активный пресет применяется ко всем страницам. Иерархия:
      <i>scheme → project → user</i>. Сейчас доступен только user-уровень
      (project/scheme — в 19.2 расширении). Required-поля (tag/name) всегда
      видны независимо от пресета.
    </div>
  </div>`;
}

function _presetCardHtml(p, activeId, selectedId) {
  const isActive = p.id === activeId;
  const isSelected = p.id === selectedId;
  const isSystem = p.system;
  return `<div class="cpe-preset-card${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}" data-preset-id="${escAttr(p.id)}">
    <div class="cpe-preset-card-head">
      <span class="cpe-preset-name">${escHtml(p.name)}${isActive ? ' <span class="cpe-badge-active">активен</span>' : ''}${isSystem ? ' <span class="cpe-badge-sys">🔒 sys</span>' : ''}</span>
    </div>
    ${p.description ? `<div class="cpe-preset-desc muted">${escHtml(p.description)}</div>` : ''}
    <div class="cpe-preset-actions">
      ${!isActive ? `<button class="cpe-btn-sm" data-action="activate" data-id="${escAttr(p.id)}">⚡ Активировать</button>` : ''}
      ${!isSystem ? `<button class="cpe-btn-sm" data-action="rename" data-id="${escAttr(p.id)}">✎ Переименовать</button>` : ''}
      ${isSystem ? `<button class="cpe-btn-sm" data-action="duplicate" data-id="${escAttr(p.id)}">📋 Скопировать</button>` : ''}
      ${!isSystem ? `<button class="cpe-btn-sm cpe-btn-danger" data-action="delete" data-id="${escAttr(p.id)}">🗑 Удалить</button>` : ''}
    </div>
  </div>`;
}

function _renderFieldsTab(sel, isSystem) {
  if (!sel) return `<div class="cpe-empty">Выберите пресет на вкладке «Пресеты».</div>`;
  if (isSystem) return `<div class="cpe-empty">Системный пресет редактировать нельзя. На вкладке «Пресеты» нажмите «📋 Скопировать», затем редактируйте копию.</div>`;
  const modes = Object.keys(CARD_FIELDS);
  const types = Object.keys(CARD_FIELDS[_state.activeModeTab] || {});
  if (!_state.activeTypeTab || !types.includes(_state.activeTypeTab)) {
    _state.activeTypeTab = types[0] || 'consumer';
  }
  const fields = listCardFields(_state.activeModeTab, _state.activeTypeTab);
  const required = new Set(requiredFieldIds(_state.activeModeTab, _state.activeTypeTab));
  const activeIds = new Set(
    (sel.perMode?.[_state.activeModeTab]?.perType?.[_state.activeTypeTab]) || fields.map(f => f.id)
  );
  // Group fields by f.group
  const byGroup = {};
  for (const f of fields) {
    const g = f.group || 'misc';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(f);
  }
  const groupLabel = (g) => ({
    identification: 'Идентификация',
    electrical: 'Электрика',
    mechanical: 'Габариты / механика',
    status: 'Статус',
    misc: 'Прочее',
  }[g] || g);
  return `<div class="cpe-pane cpe-pane-fields">
    <div class="cpe-mode-tabs">
      ${modes.map(m => `<button class="cpe-subtab${m === _state.activeModeTab ? ' active' : ''}" data-mode-tab="${escAttr(m)}">${escHtml(m)}</button>`).join('')}
    </div>
    <div class="cpe-type-tabs">
      ${types.map(t => `<button class="cpe-subtab${t === _state.activeTypeTab ? ' active' : ''}" data-type-tab="${escAttr(t)}">${escHtml(t)}</button>`).join('')}
    </div>
    <div class="cpe-fields-list">
      <div class="cpe-fields-toolbar">
        <button class="cpe-btn-sm" data-action="select-all">☑ Все</button>
        <button class="cpe-btn-sm" data-action="select-none">☐ Только обязательные</button>
        <span class="muted" style="margin-left:auto;font-size:11px">Required-поля (tag/name) принудительно включены.</span>
      </div>
      ${Object.keys(byGroup).map(g => `<div class="cpe-fields-group">
        <h4>${escHtml(groupLabel(g))}</h4>
        <div class="cpe-fields-grid">
          ${byGroup[g].map(f => {
            const isReq = required.has(f.id);
            const isOn = activeIds.has(f.id) || isReq;
            return `<label class="cpe-field-row${isReq ? ' cpe-field-required' : ''}">
              <input type="checkbox" data-field-id="${escAttr(f.id)}" ${isOn ? 'checked' : ''}${isReq ? ' disabled' : ''}>
              <span class="cpe-field-label">${escHtml(f.label)}</span>
              <code class="cpe-field-id muted">${escHtml(f.id)}</code>
              ${isReq ? '<span class="cpe-field-req">обяз.</span>' : ''}
            </label>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function _renderIoTab(userPresets) {
  return `<div class="cpe-pane cpe-pane-io">
    <div class="cpe-pane-section">
      <h3>📤 Экспорт</h3>
      <p class="muted">Скачать все user-пресеты в JSON-файл для переноса на другое устройство или коллегам.</p>
      <button class="cpe-btn cpe-btn-primary" data-action="export">⬇ Скачать JSON (${userPresets.length} пресетов)</button>
    </div>
    <div class="cpe-pane-section">
      <h3>📥 Импорт</h3>
      <p class="muted">Загрузить JSON-файл с пресетами. Существующие пресеты с тем же id будут обновлены.</p>
      <label class="cpe-btn">
        ⬆ Загрузить JSON
        <input type="file" data-action="import-file" accept="application/json" style="display:none">
      </label>
    </div>
  </div>`;
}

// ─── Wire events
function wire(root, host) {
  const close = () => host.remove();
  root.querySelector('.cpe-close').addEventListener('click', close);
  host.addEventListener('click', e => { if (e.target === host) close(); });

  // Main tabs
  root.querySelectorAll('button[data-main-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _state.activeMainTab = btn.dataset.mainTab;
      render(root);
      wire(root, host);
    });
  });

  // Preset cards
  root.querySelectorAll('.cpe-preset-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      _state.selectedPresetId = card.dataset.presetId;
      render(root); wire(root, host);
    });
  });

  // Preset actions
  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'activate') {
        setUserActivePresetId(id);
        render(root); wire(root, host);
      } else if (action === 'rename') {
        const cur = getPresetById(id);
        const newName = prompt('Новое имя пресета:', cur?.name || '');
        if (newName) { renameUserPreset(id, newName); render(root); wire(root, host); }
      } else if (action === 'delete') {
        const cur = getPresetById(id);
        if (cur && confirm(`Удалить пресет «${cur.name}»? Действие необратимо.`)) {
          deleteUserPreset(id);
          if (_state.selectedPresetId === id) _state.selectedPresetId = null;
          render(root); wire(root, host);
        }
      } else if (action === 'create') {
        const name = prompt('Имя нового пресета:', 'Мой пресет');
        if (name) {
          const p = createUserPreset(name, _state.selectedPresetId || 'full');
          _state.selectedPresetId = p.id;
          _state.activeMainTab = 'fields';
          render(root); wire(root, host);
        }
      } else if (action === 'duplicate') {
        const src = getPresetById(id);
        const name = prompt('Имя копии:', (src?.name || '') + ' (копия)');
        if (name) {
          const p = createUserPreset(name, id);
          _state.selectedPresetId = p.id;
          _state.activeMainTab = 'fields';
          render(root); wire(root, host);
        }
      } else if (action === 'select-all') {
        _bulkSetFields(true); render(root); wire(root, host);
      } else if (action === 'select-none') {
        _bulkSetFields(false); render(root); wire(root, host);
      } else if (action === 'export') {
        _exportJson();
      }
    });
  });

  // Mode/Type sub-tabs
  root.querySelectorAll('button[data-mode-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeModeTab = btn.dataset.modeTab;
      _state.activeTypeTab = null; // re-pick
      render(root); wire(root, host);
    });
  });
  root.querySelectorAll('button[data-type-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeTypeTab = btn.dataset.typeTab;
      render(root); wire(root, host);
    });
  });

  // Field checkboxes
  root.querySelectorAll('.cpe-field-row input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      _saveCurrentFieldsState(root);
    });
  });

  // Import file
  const importFile = root.querySelector('input[data-action="import-file"]');
  if (importFile) {
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        _importJson(data);
        alert('Импорт успешен.');
        render(root); wire(root, host);
      } catch (err) {
        alert(`Ошибка импорта: ${err.message || err}`);
      }
    });
  }
}

function _bulkSetFields(allOn) {
  const sel = getPresetById(_state.selectedPresetId);
  if (!sel || sel.system) return;
  const fields = listCardFields(_state.activeModeTab, _state.activeTypeTab);
  const ids = allOn ? fields.map(f => f.id) : requiredFieldIds(_state.activeModeTab, _state.activeTypeTab);
  setUserPresetFields(sel.id, _state.activeModeTab, _state.activeTypeTab, ids);
}

function _saveCurrentFieldsState(root) {
  const sel = getPresetById(_state.selectedPresetId);
  if (!sel || sel.system) return;
  const checked = Array.from(root.querySelectorAll('.cpe-field-row input[type=checkbox]:checked'))
    .map(cb => cb.dataset.fieldId);
  setUserPresetFields(sel.id, _state.activeModeTab, _state.activeTypeTab, checked);
}

function _exportJson() {
  const data = {
    schema: 'raschet.cardPresets/1',
    exportedAt: new Date().toISOString(),
    presets: loadUserPresets(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `card-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function _importJson(data) {
  if (!data || !Array.isArray(data.presets)) throw new Error('Неверный формат: нет presets[]');
  const cur = loadUserPresets();
  const byId = new Map(cur.map(p => [p.id, p]));
  for (const p of data.presets) {
    if (!p || !p.id) continue;
    p.system = false;  // импортированные не могут быть системными
    byId.set(p.id, p);
  }
  saveUserPresets(Array.from(byId.values()));
}

// ─── Public API
export function openCardPresetEditor() {
  // Insert CSS once
  if (!document.getElementById('cpe-styles')) {
    const style = document.createElement('style');
    style.id = 'cpe-styles';
    style.textContent = CPE_CSS;
    document.head.appendChild(style);
  }
  const host = document.createElement('div');
  host.className = 'cpe-overlay';
  document.body.appendChild(host);
  render(host);
  wire(host, host);
}

const CPE_CSS = `
.cpe-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.cpe-modal {
  background: #fff; border-radius: 8px;
  width: min(900px, 95vw); max-height: 88vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}
.cpe-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #e5e7eb;
}
.cpe-head h2 { margin: 0; font-size: 17px; color: #111827; }
.cpe-close {
  background: none; border: none; font-size: 22px; cursor: pointer; color: #6b7280;
  padding: 0 6px;
}
.cpe-close:hover { color: #111827; }
.cpe-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid #e5e7eb; padding: 0 14px;
}
.cpe-tab {
  border: none; background: none; padding: 10px 16px;
  font-size: 13px; cursor: pointer; color: #6b7280;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.cpe-tab:hover { color: #111827; }
.cpe-tab.active { color: #1e40af; border-bottom-color: #1e40af; font-weight: 600; }
.cpe-tab:disabled { color: #9ca3af; cursor: not-allowed; }
.cpe-body {
  flex: 1; overflow-y: auto;
  padding: 14px 18px;
}
.cpe-pane {
  display: flex; flex-direction: column; gap: 14px;
}
.cpe-pane-section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
.cpe-pane-section h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.4px; }
.cpe-pane-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cpe-pane-section-head h3 { margin: 0; }
.cpe-presets-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.cpe-preset-card {
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 5px;
  padding: 10px 12px; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.cpe-preset-card:hover { border-color: #93c5fd; background: #f0f9ff; }
.cpe-preset-card.selected { border-color: #4f46e5; background: #eef2ff; }
.cpe-preset-card.active { box-shadow: 0 0 0 2px #16a34a inset; }
.cpe-preset-card-head { display: flex; align-items: center; justify-content: space-between; }
.cpe-preset-name { font-weight: 600; font-size: 13px; color: #111827; }
.cpe-preset-desc { font-size: 11px; margin-top: 4px; line-height: 1.4; }
.cpe-preset-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.cpe-badge-active { background: #dcfce7; color: #15803d; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 500; }
.cpe-badge-sys { background: #f3f4f6; color: #6b7280; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 500; }
.cpe-btn { padding: 6px 12px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
.cpe-btn:hover { background: #f9fafb; }
.cpe-btn-primary { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.cpe-btn-primary:hover { background: #4338ca; }
.cpe-btn-sm { padding: 3px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 3px; cursor: pointer; font-size: 11px; }
.cpe-btn-sm:hover { background: #f9fafb; }
.cpe-btn-danger { color: #c62828; border-color: #fca5a5; }
.cpe-btn-danger:hover { background: #fef2f2; }
.cpe-empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 12.5px; }
.cpe-info { margin-top: 8px; padding: 10px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 4px; font-size: 11.5px; line-height: 1.5; color: #0c4a6e; }

.cpe-mode-tabs, .cpe-type-tabs { display: flex; gap: 4px; padding: 6px; background: #f3f4f6; border-radius: 5px; margin-bottom: 10px; }
.cpe-subtab { padding: 5px 12px; border: 1px solid transparent; background: transparent; border-radius: 3px; cursor: pointer; font-size: 12px; color: #6b7280; }
.cpe-subtab:hover { background: #fff; color: #111827; }
.cpe-subtab.active { background: #fff; color: #1e40af; border-color: #93c5fd; font-weight: 600; }
.cpe-fields-list { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
.cpe-fields-toolbar { display: flex; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; align-items: center; }
.cpe-fields-group { margin-bottom: 12px; }
.cpe-fields-group h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; }
.cpe-fields-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px; }
.cpe-field-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.cpe-field-row:hover { background: #f0f9ff; border-color: #93c5fd; }
.cpe-field-row.cpe-field-required { background: #fef3c7; border-color: #fcd34d; cursor: not-allowed; }
.cpe-field-label { flex: 1; }
.cpe-field-id { font-size: 10px; }
.cpe-field-req { font-size: 9.5px; color: #92400e; font-weight: 600; padding: 1px 5px; background: #fbbf24; border-radius: 2px; }
.muted { color: #6b7280; }
`;
