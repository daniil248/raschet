// =============================================================================
// service/ui/materials-catalog.js — UI каталога расходных материалов
// =============================================================================
// Phase 32.2 UI: модалка для CRUD пользовательских материалов + picker.
// Открывается через кнопку «📦 Каталог материалов» в сайдбаре service.

import {
  SEED_MATERIALS, listMaterials, addMaterial, updateMaterial, deleteMaterial,
  EQUIPMENT_KINDS,
} from '../catalog/materials.js';
import { POSITION_CATEGORIES } from '../../calc/order-model.js';
import { escAttr, escHtml, modalOpen, toast } from 'meteo/util.js';

/**
 * Открыть модалку каталога материалов с CRUD.
 */
export async function openMaterialsCatalogModal() {
  let filterEquip = '';

  const renderRows = () => {
    const all = listMaterials(filterEquip ? { equipment: filterEquip } : {});
    if (!all.length) {
      return '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Материалов нет.</td></tr>';
    }
    return all.map(m => {
      const isSeed = !m.isUser;
      const lock = isSeed ? '📦' : '✏';
      const editBtn = isSeed
        ? '<button type="button" disabled style="opacity:0.3;cursor:not-allowed" title="Встроенный материал — нельзя редактировать. 📋 чтобы скопировать.">✏</button>'
        : `<button type="button" class="mc-edit" data-id="${escAttr(m.id)}" title="Редактировать">✏</button>`;
      const cloneBtn = `<button type="button" class="mc-clone" data-id="${escAttr(m.id)}" title="Скопировать как пользовательский">📋</button>`;
      const delBtn = isSeed
        ? '<button type="button" disabled style="opacity:0.3;cursor:not-allowed" title="Встроенный — нельзя удалить">🗑</button>'
        : `<button type="button" class="mc-del" data-id="${escAttr(m.id)}" title="Удалить">🗑</button>`;
      const equipLabels = (m.compatibleEquipment || []).slice(0, 3).map(e => {
        const k = EQUIPMENT_KINDS.find(x => x.id === e);
        return k ? k.label : e;
      }).join(', ') + ((m.compatibleEquipment || []).length > 3 ? '…' : '');
      const priceStr = `${(m.defaultPrice?.value || 0).toLocaleString('ru-RU')} ${m.defaultPrice?.currency || ''}`;
      return `<tr data-mid="${escAttr(m.id)}">
        <td title="${isSeed ? 'Встроенный (read-only)' : 'Пользовательский'}">${lock}</td>
        <td><b>${escHtml(m.name)}</b>${m.sku ? `<br><span class="muted" style="font-size:10.5px">SKU: ${escHtml(m.sku)}</span>` : ''}</td>
        <td>${escHtml(m.unit)}</td>
        <td class="num">${escHtml(priceStr)}</td>
        <td title="${escAttr((m.compatibleEquipment || []).join(', '))}" style="font-size:11px;color:#475569">${escHtml(equipLabels || '—')}</td>
        <td title="${escAttr(m.notes || '')}" style="font-size:11px;color:#475569">${escHtml((m.notes || '').slice(0, 40))}${m.notes && m.notes.length > 40 ? '…' : ''}</td>
        <td style="white-space:nowrap">${cloneBtn}${editBtn}${delBtn}</td>
      </tr>`;
    }).join('');
  };

  const equipOpts = ['<option value="">-- Все --</option>',
    ...EQUIPMENT_KINDS.map(k => `<option value="${escAttr(k.id)}">${escHtml(k.label)}</option>`),
  ].join('');

  const body = `
    <p class="muted" style="font-size:11.5px;margin:0 0 8px">
      📦 — встроенные (read-only). ✏ — пользовательские. 📋 копирует встроенный как редактируемый. Используется в наряде через кнопку «+ Из материалов».
    </p>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px">
        Фильтр оборудование:
        <select id="mc-filter-equip" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">${equipOpts}</select>
      </label>
    </div>
    <div style="max-height:50vh;overflow:auto;border:1px solid #e2e8f0;border-radius:3px">
      <table id="mc-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f1f5f9;font-size:10.5px;color:#475569;text-transform:uppercase;letter-spacing:0.3px">
            <th style="padding:6px 8px;text-align:center">Тип</th>
            <th style="padding:6px 8px;text-align:left">Название / SKU</th>
            <th style="padding:6px 8px;text-align:left">Ед.</th>
            <th style="padding:6px 8px;text-align:right">Цена</th>
            <th style="padding:6px 8px;text-align:left">Оборудование</th>
            <th style="padding:6px 8px;text-align:left">Заметки</th>
            <th style="padding:6px 8px"></th>
          </tr>
        </thead>
        <tbody id="mc-tbody">${renderRows()}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      <button type="button" id="mc-add" class="sv-btn-primary" title="Создать новый пользовательский материал">+ Добавить материал</button>
    </div>
  `;

  const promise = modalOpen(
    '<h3>📦 Каталог расходных материалов</h3>',
    body,
    async () => ({ ok: true })
  );
  requestAnimationFrame(() => bindEvents());
  await promise;

  function bindEvents() {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    const tbody = overlay.querySelector('#mc-tbody');
    const refresh = () => { if (tbody) tbody.innerHTML = renderRows(); };

    const filterSel = overlay.querySelector('#mc-filter-equip');
    if (filterSel) filterSel.addEventListener('change', () => {
      filterEquip = filterSel.value;
      refresh();
    });

    const addBtn = overlay.querySelector('#mc-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const m = await editMaterialForm(null);
      if (!m) return;
      const created = addMaterial(m);
      toast(`✓ «${created.name}» добавлен`, 'ok');
      refresh();
    });

    overlay.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr[data-mid]');
      if (!tr) return;
      const mid = tr.dataset.mid;
      const all = listMaterials();
      const m = all.find(x => x.id === mid);
      if (!m) return;

      if (ev.target.closest('.mc-clone')) {
        const copy = { ...m, name: m.name + ' (копия)' };
        delete copy.id; delete copy.isUser;
        const created = addMaterial(copy);
        toast(`✓ Скопирован: «${created.name}»`, 'ok');
        refresh();
        return;
      }
      if (ev.target.closest('.mc-edit') && m.isUser) {
        const updated = await editMaterialForm(m);
        if (!updated) return;
        updateMaterial(mid, updated);
        toast(`✓ Обновлён: «${updated.name}»`, 'ok');
        refresh();
        return;
      }
      if (ev.target.closest('.mc-del') && m.isUser) {
        const ok = await modalOpen('<h3>Подтверждение</h3>',
          `<p>Удалить материал «${escHtml(m.name)}»?</p>`,
          async () => ({ ok: true })
        );
        if (!ok) return;
        deleteMaterial(mid);
        toast(`Материал удалён`, 'info');
        refresh();
        return;
      }
    });
  }
}

/* Форма редактирования / создания материала. */
async function editMaterialForm(initial) {
  const m = initial || { name: '', sku: '', unit: 'шт', defaultPrice: { value: 0, currency: '₸' }, compatibleEquipment: [], notes: '' };
  const equipChecks = EQUIPMENT_KINDS.map(k => `
    <label style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:#475569;margin-right:8px">
      <input type="checkbox" data-equip="${escAttr(k.id)}" ${m.compatibleEquipment?.includes(k.id) ? 'checked' : ''}>
      ${escHtml(k.label)}
    </label>
  `).join('');
  const curOpts = ['$', '€', '₸', '₽', 'Br', '£', '¥']
    .map(c => `<option value="${c}"${c === (m.defaultPrice?.currency || '₸') ? ' selected' : ''}>${c}</option>`).join('');

  const body = `
    <label style="display:block;margin-bottom:6px">
      <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Название</span>
      <input type="text" id="mat-f-name" value="${escAttr(m.name)}" placeholder="напр. Хладагент R410A" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
      <label>
        <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Артикул / SKU</span>
        <input type="text" id="mat-f-sku" value="${escAttr(m.sku || '')}" placeholder="напр. R410A-1KG" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label>
        <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Единица</span>
        <input type="text" id="mat-f-unit" value="${escAttr(m.unit || 'шт')}" placeholder="кг / шт / л / м" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:6px">
      <label>
        <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Цена / ед.</span>
        <input type="number" min="0" step="100" id="mat-f-price" value="${Number(m.defaultPrice?.value) || 0}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;text-align:right">
      </label>
      <label>
        <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Валюта</span>
        <select id="mat-f-cur" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px">${curOpts}</select>
      </label>
    </div>
    <div style="margin-bottom:6px">
      <div style="font-size:11.5px;color:#475569;margin-bottom:3px">Совместимое оборудование</div>
      <div style="padding:6px;border:1px solid #cbd5e1;border-radius:3px;max-height:120px;overflow-y:auto">${equipChecks}</div>
    </div>
    <label style="display:block">
      <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">Заметки</span>
      <textarea id="mat-f-notes" rows="2" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;resize:vertical">${escHtml(m.notes || '')}</textarea>
    </label>
  `;
  const result = await modalOpen(
    `<h3>${initial ? '✏ Редактирование материала' : '+ Новый материал'}</h3>`,
    body,
    async (overlay) => {
      const name = overlay.querySelector('#mat-f-name')?.value?.trim() || '';
      if (!name) { toast('Укажите название', 'err'); return null; }
      const compatibleEquipment = Array.from(overlay.querySelectorAll('[data-equip]:checked')).map(c => c.dataset.equip);
      return {
        ok: true,
        payload: {
          name,
          sku: overlay.querySelector('#mat-f-sku')?.value || '',
          unit: overlay.querySelector('#mat-f-unit')?.value || 'шт',
          category: 'material',
          defaultPrice: {
            value: Number(overlay.querySelector('#mat-f-price')?.value) || 0,
            currency: overlay.querySelector('#mat-f-cur')?.value || '₸',
          },
          compatibleEquipment,
          notes: overlay.querySelector('#mat-f-notes')?.value || '',
        },
      };
    }
  );
  return result?.payload || null;
}

/**
 * Picker материала для формы наряда. Возвращает выбранный материал
 * (с дефолтной ценой и валютой) или null.
 *
 * @param {string} [equipmentKind] — фильтр совместимости (опц.)
 */
export async function pickMaterialModal(equipmentKind = null) {
  const all = equipmentKind ? listMaterials({ equipment: equipmentKind }) : listMaterials();
  if (!all.length) {
    toast('Каталог материалов пуст', 'err');
    return null;
  }
  const opts = all.map((m, i) => {
    const userMark = m.isUser ? '✏ ' : '📦 ';
    const priceStr = `${(m.defaultPrice?.value || 0).toLocaleString('ru-RU')} ${m.defaultPrice?.currency || ''}`;
    return `<option value="${i}">${userMark}${escHtml(m.name)}${m.sku ? ` (${escHtml(m.sku)})` : ''} — ${escHtml(priceStr)}/${escHtml(m.unit)}</option>`;
  }).join('');
  const result = await modalOpen(
    '<h3>📦 Выбор материала</h3>',
    `<label>Выберите материал из каталога:<select id="mat-pick-sel" size="12" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">${opts}</select></label>
     <p class="muted" style="font-size:11.5px;margin-top:6px">📦 встроенные / ✏ пользовательские. После добавления qty можно изменить.</p>`,
    async () => {
      const sel = document.getElementById('mat-pick-sel');
      const i = Number(sel?.value);
      if (!Number.isFinite(i) || !all[i]) return null;
      return { picked: all[i] };
    }
  );
  return result?.picked || null;
}
