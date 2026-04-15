// ======================================================================
// panel-config.js
// Подпрограмма «Конфигуратор щита»: per-user справочник моделей +
// каскадный пикер Производитель → Серия → Типоразмер + ручное добавление.
// Использует shared/panel-catalog.js и shared/panel-picker.js — те же
// модули применимы в будущем из инспектора щита главной схемы.
// ======================================================================

import { listPanels, addPanel, removePanel, clearCatalog, makePanelId } from '../shared/panel-catalog.js';
import { parsePanelXlsx } from '../shared/catalog-xlsx-parser.js';
import { mountPanelPicker } from '../shared/panel-picker.js';

let cascadeHandle = null;
const cascadeState = { supplier: '', series: '', modelId: '' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

function render() {
  const list = listPanels();
  const mount = document.getElementById('panel-cascade-mount');
  if (mount) {
    if (!cascadeHandle) {
      cascadeHandle = mountPanelPicker(mount, {
        list,
        selectedId: cascadeState.modelId || null,
        currentSupplier: cascadeState.supplier,
        currentSeries: cascadeState.series,
        placeholders: { supplier: 'Все производители', series: 'Все серии', model: 'Все типоразмеры' },
        labels: { supplier: 'Производитель', series: 'Серия', model: 'Типоразмер' },
        idPrefix: 'pp-cat',
        onChange: (st) => {
          cascadeState.supplier = st.supplier || '';
          cascadeState.series   = st.series   || '';
          cascadeState.modelId  = st.modelId  || '';
          renderList(list);
          renderSelected(list);
        },
      });
    } else {
      cascadeHandle.refresh(list);
    }
  }
  renderList(list);
  renderSelected(list);
}

function renderList(list) {
  const wrap = document.getElementById('catalog-list');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">Справочник пуст. Нажмите «+ Добавить вручную» чтобы создать первую запись.</div>`;
    return;
  }
  const filtered = list.filter(p => {
    if (cascadeState.supplier && (p.supplier || 'Unknown') !== cascadeState.supplier) return false;
    if (cascadeState.series && (p.series || 'Other') !== cascadeState.series) return false;
    if (cascadeState.modelId && p.id !== cascadeState.modelId) return false;
    return true;
  });
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty">По фильтру ничего не найдено.</div>`;
    return;
  }
  const rows = filtered.map(p => `
    <tr data-id="${esc(p.id)}">
      <td><b>${esc(p.supplier || '—')}</b></td>
      <td>${esc(p.series || '—')}</td>
      <td>${esc(p.variant || '—')}</td>
      <td>${p.inNominal || '—'} А</td>
      <td>${p.inputs || 1} / ${p.outputs || 1}</td>
      <td>${p.sections || 1}</td>
      <td>${esc(p.ipRating || '—')}</td>
      <td>
        <button class="btn-sm btn-del" data-del="${esc(p.id)}">Удалить</button>
      </td>
    </tr>`).join('');
  wrap.innerHTML = `
    <table class="cat-table">
      <thead><tr>
        <th>Производитель</th><th>Серия</th><th>Типоразмер</th>
        <th>I ном</th><th>Вх/Вых</th><th>Секций</th><th>IP</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Удалить эту запись?')) return;
      removePanel(btn.dataset.del);
      flash('Удалено');
      render();
    });
  });
}

function renderSelected(list) {
  const box = document.getElementById('selected-panel-details');
  if (!box) return;
  if (!cascadeState.modelId) {
    box.className = 'empty';
    box.textContent = 'Выберите модель в каскаде выше.';
    return;
  }
  const p = list.find(x => x.id === cascadeState.modelId);
  if (!p) { box.className = 'empty'; box.textContent = 'Запись не найдена.'; return; }
  box.className = 'details-card';
  box.innerHTML = `
    <h4>${esc(p.supplier)} · ${esc(p.series)} · ${esc(p.variant)}</h4>
    <div class="grid">
      <div>Вводной номинал:</div><div><b>${p.inNominal || '—'} А</b></div>
      <div>Входов / выходов:</div><div><b>${p.inputs || 1} / ${p.outputs || 1}</b></div>
      <div>Секций:</div><div><b>${p.sections || 1}</b></div>
      <div>Степень защиты:</div><div><b>${esc(p.ipRating || '—')}</b></div>
      <div>Форма разделения:</div><div><b>${esc(p.form || '—')}</b></div>
      <div>Габариты (Ш×В×Г):</div><div>${p.width || '—'} × ${p.height || '—'} × ${p.depth || '—'} мм</div>
      ${p.busbarA ? `<div>Шинопровод:</div><div><b>${p.busbarA} А</b></div>` : ''}
      <div>Источник:</div><div class="muted">${esc(p.source || '—')}</div>
    </div>
    <p class="muted" style="font-size:11px;margin-top:10px">
      В будущих итерациях здесь появится кнопка «Применить к узлу схемы»
      через <code>applyPanelModel</code> из <code>shared/panel-picker.js</code>.
    </p>
  `;
}

function openManualModal() {
  let modal = document.getElementById('manual-panel-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manual-panel-modal';
    modal.className = 'ups-modal';
    modal.innerHTML = `
      <div class="ups-modal-box">
        <div class="ups-modal-head">
          <h3>Добавить щит вручную</h3>
          <button class="ups-modal-close" aria-label="Закрыть">×</button>
        </div>
        <div class="ups-modal-body" id="manual-panel-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.ups-modal-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const body = document.getElementById('manual-panel-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>Производитель<input id="mp-supplier" type="text" placeholder="ABB"></label>
      <label>Серия<input id="mp-series" type="text" placeholder="ArTu M"></label>
      <label>Типоразмер<input id="mp-variant" type="text" placeholder="M208"></label>
      <label>I ном вводного, А<input id="mp-in" type="number" min="16" step="1" value="400"></label>
      <label>Входов<input id="mp-inputs" type="number" min="1" max="4" value="1"></label>
      <label>Выходов<input id="mp-outputs" type="number" min="1" max="60" value="12"></label>
      <label>Секций<input id="mp-sections" type="number" min="1" max="4" value="1"></label>
      <label>IP<input id="mp-ip" type="text" value="IP31"></label>
      <label>Форма разделения<select id="mp-form">
        <option value="1">Form 1</option>
        <option value="2">Form 2</option>
        <option value="3">Form 3</option>
        <option value="4" selected>Form 4</option>
      </select></label>
      <label>Ширина, мм<input id="mp-width" type="number" min="0" step="10" value="800"></label>
      <label>Высота, мм<input id="mp-height" type="number" min="0" step="10" value="2000"></label>
      <label>Глубина, мм<input id="mp-depth" type="number" min="0" step="10" value="600"></label>
      <label>Шинопровод, А (опц.)<input id="mp-busbar" type="number" min="0" step="1" value=""></label>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mp-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mp-save" class="btn-sm btn-primary">Добавить</button>
    </div>
  `;
  const g = id => document.getElementById(id);
  g('mp-cancel').addEventListener('click', () => modal.classList.remove('show'));
  g('mp-save').addEventListener('click', () => {
    const supplier = g('mp-supplier').value.trim();
    const series = g('mp-series').value.trim();
    const variant = g('mp-variant').value.trim();
    if (!supplier || !series || !variant) { alert('Заполните Производителя, Серию и Типоразмер'); return; }
    const record = {
      id: makePanelId(supplier, series, variant),
      supplier, series, variant,
      inNominal: Number(g('mp-in').value) || 0,
      inputs: Number(g('mp-inputs').value) || 1,
      outputs: Number(g('mp-outputs').value) || 1,
      sections: Number(g('mp-sections').value) || 1,
      ipRating: g('mp-ip').value.trim() || 'IP31',
      form: g('mp-form').value || '4',
      width: Number(g('mp-width').value) || 0,
      height: Number(g('mp-height').value) || 0,
      depth: Number(g('mp-depth').value) || 0,
      busbarA: Number(g('mp-busbar').value) || null,
      source: 'ручной ввод',
      importedAt: Date.now(),
      custom: true,
    };
    addPanel(record);
    modal.classList.remove('show');
    flash('Добавлено: ' + variant, 'success');
    render();
  });
  modal.classList.add('show');
}

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('btn-add-manual');
  if (addBtn) addBtn.addEventListener('click', openManualModal);

  // Импорт XLSX
  const importBtn = document.getElementById('btn-import-xlsx');
  const importInput = document.getElementById('import-xlsx-input');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const files = Array.from(importInput.files || []);
      if (!files.length) return;
      let added = 0, errors = [];
      for (const f of files) {
        try {
          const buf = await f.arrayBuffer();
          const records = parsePanelXlsx(buf, f.name);
          for (const rec of records) { addPanel(rec); added++; }
        } catch (e) {
          errors.push(`${f.name}: ${e.message || e}`);
        }
      }
      importInput.value = '';
      render();
      if (errors.length) {
        flash(`Импортировано ${added}. Ошибок: ${errors.length}`, 'warn');
        console.warn('[panel-config] xlsx import errors:', errors);
      } else {
        flash(`Импортировано ${added} записей щитов`, 'success');
      }
    });
  }

  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник щитов?')) return;
    clearCatalog();
    cascadeState.supplier = cascadeState.series = cascadeState.modelId = '';
    render();
    flash('Справочник очищен');
  });
  render();
});
