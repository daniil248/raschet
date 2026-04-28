// shared/table-presets.js
// v0.59.633: Generic preset-система для таблиц во всех модулях Raschet.
// Юзер: «добавь возможность пользователю создавать собственные настройки
// фильтра и отображаемые столбцы и сохранять их как пресеты. Сделай это
// для всех таблиц всех модулей, включая будущие».
//
// Используется одним и тем же кодом для:
//   — Конструктор схем: consumers, cable, equipment
//   — scs-config: contents, racks (когда добавим)
//   — scs-design: links, bom (когда добавим)
//   — любые будущие модули
//
// Хранилище: localStorage по ключу raschet.tablePresets.<tableId>.v1
// Пресет = { id, name, columns, filters, sort }
// Каждое поле — снимок соответствующего state-объекта таблицы.
//
// Применение:
//   1. В рендере toolbar: вставь _renderTablePresetUI(tableId, currentId)
//   2. После рендера: _attachTablePresetHandlers(mountEl, tableId, getState, applyState)
//      — getState() возвращает текущие { columns, filters, sort }
//      — applyState({columns, filters, sort, presetId}) применяет пресет

const _TABLE_PRESETS_KEY = (tableId) => 'raschet.tablePresets.' + tableId + '.v1';
const _TABLE_LASTPRESET_KEY = (tableId) => 'raschet.tableLastPreset.' + tableId + '.v1';

export function loadTablePresets(tableId) {
  try {
    const raw = localStorage.getItem(_TABLE_PRESETS_KEY(tableId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {}
  return [];
}

export function saveTablePresets(tableId, list) {
  try { localStorage.setItem(_TABLE_PRESETS_KEY(tableId), JSON.stringify(list)); } catch {}
}

export function loadLastPresetId(tableId) {
  try { return localStorage.getItem(_TABLE_LASTPRESET_KEY(tableId)) || ''; } catch { return ''; }
}

export function saveLastPresetId(tableId, id) {
  try {
    if (id) localStorage.setItem(_TABLE_LASTPRESET_KEY(tableId), id);
    else localStorage.removeItem(_TABLE_LASTPRESET_KEY(tableId));
  } catch {}
}

// Возвращает HTML для блока «Пресет» (селектор + кнопки save/save-as/delete).
// Втыкается в toolbar таблицы. attachTablePresetHandlers() вешает события.
export function renderTablePresetUI(tableId, currentPresetId = '') {
  const presets = loadTablePresets(tableId);
  const escAttr = (s) => String(s || '').replace(/[<>&"']/g, ch =>
    ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[ch]));
  const opts = ['<option value="">— без пресета —</option>']
    .concat(presets.map(p =>
      `<option value="${escAttr(p.id)}"${currentPresetId === p.id ? ' selected' : ''}>${escAttr(p.name || '?')}</option>`
    ))
    .join('');
  const hasCurrent = currentPresetId && presets.some(p => p.id === currentPresetId);
  return `<div class="rs-tbl-presets" data-tbl-id="${escAttr(tableId)}" style="display:inline-flex;align-items:center;gap:4px">
    <select class="rs-tbl-preset-sel" data-tbl-id="${escAttr(tableId)}" style="padding:4px 8px;font-size:11px;border:1px solid #d0d7de;border-radius:3px;background:#fff;min-width:140px">${opts}</select>
    <button type="button" class="rs-tbl-preset-save" data-tbl-id="${escAttr(tableId)}"${hasCurrent ? '' : ' disabled'} title="Перезаписать выбранный пресет текущим состоянием" style="padding:4px 8px;font-size:11px;border:1px solid #15803d;color:#15803d;background:#fff;border-radius:3px;cursor:pointer${hasCurrent ? '' : ';opacity:0.5;cursor:not-allowed'}">💾</button>
    <button type="button" class="rs-tbl-preset-saveas" data-tbl-id="${escAttr(tableId)}" title="Сохранить как новый пресет" style="padding:4px 8px;font-size:11px;border:1px solid #1976d2;color:#1976d2;background:#fff;border-radius:3px;cursor:pointer">+ Пресет</button>
    <button type="button" class="rs-tbl-preset-delete" data-tbl-id="${escAttr(tableId)}"${hasCurrent ? '' : ' disabled'} title="Удалить выбранный пресет" style="padding:4px 8px;font-size:11px;border:1px solid #b91c1c;color:#b91c1c;background:#fff;border-radius:3px;cursor:pointer${hasCurrent ? '' : ';opacity:0.5;cursor:not-allowed'}">✕</button>
  </div>`;
}

// Вешает обработчики на preset-UI внутри mountEl.
//   tableId        — id таблицы для localStorage
//   getState()     — возвращает { columns, filters, sort } (текущее)
//   applyState(s)  — применяет { columns, filters, sort, presetId }
//   ui             — { rsPrompt?, rsConfirm?, flash? } — опциональные функции
//                    из shared/dialog.js. Если не переданы — используется
//                    confirm() / prompt() (нежелательно, см. CLAUDE memory).
export function attachTablePresetHandlers(mountEl, tableId, getState, applyState, ui = {}) {
  const sel = mountEl.querySelector(`.rs-tbl-preset-sel[data-tbl-id="${tableId}"]`);
  const btnSave = mountEl.querySelector(`.rs-tbl-preset-save[data-tbl-id="${tableId}"]`);
  const btnSaveAs = mountEl.querySelector(`.rs-tbl-preset-saveas[data-tbl-id="${tableId}"]`);
  const btnDel = mountEl.querySelector(`.rs-tbl-preset-delete[data-tbl-id="${tableId}"]`);
  const rsPrompt = ui.rsPrompt || ((q, def) => Promise.resolve(window.prompt(q, def)));
  const rsConfirm = ui.rsConfirm || ((q) => Promise.resolve(window.confirm(q)));
  const flash = ui.flash || ((m) => { try { console.log('[preset]', m); } catch {} });

  if (sel) {
    sel.addEventListener('change', () => {
      const id = sel.value;
      if (!id) { saveLastPresetId(tableId, ''); applyState({ columns: null, filters: null, sort: null, presetId: '' }); return; }
      const list = loadTablePresets(tableId);
      const p = list.find(x => x.id === id);
      if (!p) return;
      saveLastPresetId(tableId, id);
      applyState({
        columns: p.columns || null,
        filters: p.filters || null,
        sort: p.sort || null,
        presetId: id,
      });
    });
  }
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const id = sel?.value;
      if (!id) return;
      const list = loadTablePresets(tableId);
      const idx = list.findIndex(p => p.id === id);
      if (idx === -1) return;
      const cur = getState();
      list[idx] = { ...list[idx], columns: cur.columns, filters: cur.filters, sort: cur.sort };
      saveTablePresets(tableId, list);
      flash(`Пресет «${list[idx].name}» обновлён`);
    });
  }
  if (btnSaveAs) {
    btnSaveAs.addEventListener('click', async () => {
      const name = await rsPrompt('Имя нового пресета:', 'Мой пресет');
      if (!name || !String(name).trim()) return;
      const list = loadTablePresets(tableId);
      const cur = getState();
      const id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      list.push({ id, name: String(name).trim(), columns: cur.columns, filters: cur.filters, sort: cur.sort });
      saveTablePresets(tableId, list);
      saveLastPresetId(tableId, id);
      applyState({ columns: cur.columns, filters: cur.filters, sort: cur.sort, presetId: id });
      flash(`Пресет «${name}» создан`);
    });
  }
  if (btnDel) {
    btnDel.addEventListener('click', async () => {
      const id = sel?.value;
      if (!id) return;
      const list = loadTablePresets(tableId);
      const idx = list.findIndex(p => p.id === id);
      if (idx === -1) return;
      const ok = await rsConfirm(`Удалить пресет «${list[idx].name}»?`, '', { okLabel: 'Удалить', cancelLabel: 'Отмена' });
      if (!ok) return;
      list.splice(idx, 1);
      saveTablePresets(tableId, list);
      saveLastPresetId(tableId, '');
      applyState({ columns: null, filters: null, sort: null, presetId: '' });
      flash('Пресет удалён');
    });
  }
}
