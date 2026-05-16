// =============================================================================
// shared/report/kp-editor.js — UI редактора шаблона КП
// =============================================================================
// Phase 29.4: Открывается через кнопку «📄 Настроить шаблон КП».
// Позволяет:
//   - Выбрать активный шаблон (dropdown) или создать новый (clone)
//   - Toggle enabled для каждого слота
//   - Reorder слотов через ▲ ▼ кнопки
//   - Per-slot настройки (для positions-table: groupByCategory, showCostColumn)
//   - Сохранить / удалить шаблон
//
// Использует util.modalOpen из meteo/util.js.

import {
  SLOT_CATALOG, DEFAULT_KP_TEMPLATE,
  listKpTemplates, saveKpTemplates, getActiveKpTemplate, setActiveKpTemplateId,
  cloneKpTemplate, deleteKpTemplate, updateKpTemplate, resetDefaultKpTemplate,
} from './kp-template.js';
import { escAttr, escHtml, modalOpen, toast } from '../../meteo/util.js';
// v0.60.139: rsPrompt/rsConfirm для замены browser dialogs.
import { rsConfirm, rsPrompt } from 'shared/dialog.js';

/**
 * Открыть модалку редактора шаблона КП.
 */
export async function openKpTemplateEditor() {
  let templates = listKpTemplates();
  let active = getActiveKpTemplate();

  const renderSlotRows = () => {
    const slots = active.slots || [];
    return slots.map((slot, idx) => {
      const cat = SLOT_CATALOG.find(c => c.id === slot.id);
      if (!cat) return '';
      const isLocked = !!cat.required;  // required slots — нельзя disable
      return `<tr data-slot-id="${escAttr(slot.id)}" data-idx="${idx}">
        <td style="text-align:center;width:36px">
          <input type="checkbox" ${slot.enabled ? 'checked' : ''} ${isLocked ? 'disabled title="Этот слот обязателен — нельзя выключить"' : ''} class="kpe-toggle">
        </td>
        <td title="${escAttr(cat.tip)}">
          <b>${escHtml(cat.label)}</b>
          ${renderSlotOptionsInline(slot, cat)}
        </td>
        <td style="text-align:center;width:80px;white-space:nowrap">
          <button type="button" class="kpe-up" ${idx === 0 ? 'disabled' : ''} title="Переместить выше">▲</button>
          <button type="button" class="kpe-down" ${idx === slots.length - 1 ? 'disabled' : ''} title="Переместить ниже">▼</button>
        </td>
      </tr>`;
    }).join('');
  };

  const renderSlotOptionsInline = (slot, cat) => {
    const opts = slot.options || {};
    const out = [];
    // positions-table: groupByCategory + showCostColumn
    if (slot.id === 'positions-table') {
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:14px;font-size:11px;color:#475569;font-weight:400" title="Группировать позиции по категориям (Работа / Материал / ...) с подытогами по разделам.">
        <input type="checkbox" ${opts.groupByCategory !== false ? 'checked' : ''} data-opt="groupByCategory">
        группировать по категориям
      </label>`);
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:#b91c1c;font-weight:400" title="ВНИМАНИЕ: показывать колонку себестоимости в КП. Использовать только для внутреннего просмотра — НЕ для отправки клиенту.">
        <input type="checkbox" ${opts.showCostColumn === true ? 'checked' : ''} data-opt="showCostColumn">
        ⚠ колонка себес/ед
      </label>`);
    }
    // totals: showCostInTotals
    if (slot.id === 'totals') {
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:14px;font-size:11px;color:#b91c1c;font-weight:400" title="Показать строки «Себестоимость + накладные» и «Маржа» в итогах. Только для внутреннего просмотра.">
        <input type="checkbox" ${opts.showCostInTotals === true ? 'checked' : ''} data-opt="showCostInTotals">
        ⚠ показать себес+маржу в итогах
      </label>`);
    }
    // company-header: showBin / showContacts
    if (slot.id === 'company-header') {
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:14px;font-size:11px;color:#475569;font-weight:400">
        <input type="checkbox" ${opts.showContacts !== false ? 'checked' : ''} data-opt="showContacts">
        контакты
      </label>`);
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:#475569;font-weight:400">
        <input type="checkbox" ${opts.showBin !== false ? 'checked' : ''} data-opt="showBin">
        БИН/ИНН
      </label>`);
    }
    // signatures: showDirector
    if (slot.id === 'signatures') {
      out.push(`<label style="display:inline-flex;align-items:center;gap:4px;margin-left:14px;font-size:11px;color:#475569;font-weight:400">
        <input type="checkbox" ${opts.showDirector !== false ? 'checked' : ''} data-opt="showDirector">
        ФИО руководителя
      </label>`);
    }
    return out.length ? `<div style="margin-top:3px">${out.join('')}</div>` : '';
  };

  const renderTplOptions = () => templates.map(t =>
    `<option value="${escAttr(t.id)}"${t.id === active.id ? ' selected' : ''}>${escHtml(t.name)}</option>`
  ).join('');

  const body = `
    <p class="muted" style="font-size:11.5px;margin:0 0 8px">
      Слоты в порядке отображения сверху-вниз. Переключите чекбокс чтобы скрыть/показать; ▲▼ — поменять порядок. Изменения сохраняются автоматически.
    </p>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <label title="Активный шаблон. При экспорте КП используется именно он.">
        <span style="font-size:11.5px;color:#475569">Шаблон:</span>
        <select id="kpe-tpl" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px;margin-left:4px">${renderTplOptions()}</select>
      </label>
      <button type="button" id="kpe-clone" class="sv-btn-ghost" style="padding:4px 10px;font-size:11.5px" title="Создать копию текущего шаблона под новым именем (для отдельного клиента или сценария)">📋 Скопировать</button>
      <button type="button" id="kpe-delete" class="sv-btn-ghost" style="padding:4px 10px;font-size:11.5px;color:#b91c1c" ${active.id === 'kp-default' ? 'disabled style="opacity:0.4"' : ''} title="Удалить текущий шаблон (default нельзя)">🗑 Удалить</button>
      <button type="button" id="kpe-reset" class="sv-btn-ghost" style="padding:4px 10px;font-size:11.5px;margin-left:auto" title="Сбросить ВСЕ слоты дефолтного шаблона к исходным значениям">↩ Reset default</button>
    </div>
    <div style="border:1px solid #e2e8f0;border-radius:4px;overflow:hidden">
      <table class="kpe-table" style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead>
          <tr style="background:#f1f5f9;font-size:10.5px;color:#475569;text-transform:uppercase;letter-spacing:0.3px">
            <th style="padding:6px 8px;text-align:center">Вкл</th>
            <th style="padding:6px 8px;text-align:left">Слот документа</th>
            <th style="padding:6px 8px;text-align:center">Порядок</th>
          </tr>
        </thead>
        <tbody id="kpe-tbody">${renderSlotRows()}</tbody>
      </table>
    </div>
    <p class="muted" style="font-size:11px;margin-top:8px">
      💡 После настройки — нажмите «📄 Открыть КП» в форме наряда. Активный шаблон применяется при экспорте.
    </p>
  `;

  const promise = modalOpen(
    '<h3>📄 Настройка шаблона КП</h3>',
    body,
    async () => ({ ok: true })
  );
  requestAnimationFrame(() => bindEvents());
  await promise;

  function persist() {
    updateKpTemplate(active.id, { name: active.name, slots: active.slots });
  }

  function refresh() {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    templates = listKpTemplates();
    active = templates.find(t => t.id === active.id) || templates[0];
    const tbody = overlay.querySelector('#kpe-tbody');
    if (tbody) tbody.innerHTML = renderSlotRows();
    const tplSel = overlay.querySelector('#kpe-tpl');
    if (tplSel) tplSel.innerHTML = renderTplOptions();
    const delBtn = overlay.querySelector('#kpe-delete');
    if (delBtn) {
      const isDefault = active.id === 'kp-default';
      delBtn.disabled = isDefault;
      delBtn.style.opacity = isDefault ? '0.4' : '';
    }
  }

  function bindEvents() {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;

    // Template select
    const tplSel = overlay.querySelector('#kpe-tpl');
    if (tplSel) tplSel.addEventListener('change', () => {
      setActiveKpTemplateId(tplSel.value);
      active = getActiveKpTemplate();
      refresh();
      toast(`Активный шаблон: ${active.name}`, 'ok');
    });

    // Clone
    const cloneBtn = overlay.querySelector('#kpe-clone');
    if (cloneBtn) cloneBtn.addEventListener('click', async () => {
      // v0.60.139: replaced prompt() with rsPrompt (no browser dialogs).
      const name = await rsPrompt('Название нового шаблона:', active.name + ' (копия)');
      if (!name?.trim()) return;
      const newTpl = cloneKpTemplate(active.id, name.trim());
      setActiveKpTemplateId(newTpl.id);
      active = getActiveKpTemplate();
      refresh();
      toast(`✓ Шаблон «${name}» создан`, 'ok');
    });

    // Delete
    const delBtn = overlay.querySelector('#kpe-delete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (active.id === 'kp-default') return;
      // v0.60.139: replaced confirm() with rsConfirm (no browser dialogs).
      const ok = await rsConfirm(`Удалить шаблон «${active.name}»?`, 'Дефолтный шаблон останется. Удаление необратимо.', { okLabel: 'Удалить', cancelLabel: 'Отмена' });
      if (!ok) return;
      deleteKpTemplate(active.id);
      setActiveKpTemplateId('kp-default');
      active = getActiveKpTemplate();
      refresh();
      toast('Шаблон удалён', 'info');
    });

    // Reset default
    const resetBtn = overlay.querySelector('#kpe-reset');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
      // v0.60.139: replaced confirm() with rsConfirm (no browser dialogs).
      const ok = await rsConfirm('Сбросить дефолтный шаблон?', 'К исходным значениям. Пользовательские шаблоны останутся.', { okLabel: 'Сбросить', cancelLabel: 'Отмена' });
      if (!ok) return;
      resetDefaultKpTemplate();
      if (active.id === 'kp-default') active = getActiveKpTemplate();
      refresh();
      toast('Дефолтный шаблон сброшен', 'info');
    });

    // Slot row interactions
    overlay.addEventListener('change', (ev) => {
      const tr = ev.target.closest('tr[data-slot-id]');
      if (!tr) return;
      const slotId = tr.dataset.slotId;
      const slot = active.slots.find(s => s.id === slotId);
      if (!slot) return;
      if (ev.target.classList.contains('kpe-toggle')) {
        slot.enabled = ev.target.checked;
        persist();
      } else if (ev.target.dataset.opt) {
        if (!slot.options) slot.options = {};
        slot.options[ev.target.dataset.opt] = ev.target.checked;
        persist();
      }
    });
    overlay.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-slot-id]');
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (ev.target.classList.contains('kpe-up') && idx > 0) {
        const slots = active.slots;
        [slots[idx - 1], slots[idx]] = [slots[idx], slots[idx - 1]];
        persist(); refresh();
      } else if (ev.target.classList.contains('kpe-down') && idx < active.slots.length - 1) {
        const slots = active.slots;
        [slots[idx + 1], slots[idx]] = [slots[idx], slots[idx + 1]];
        persist(); refresh();
      }
    });
  }
}
