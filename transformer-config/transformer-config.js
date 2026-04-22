// ======================================================================
// transformer-config.js
// Подпрограмма «Конфигуратор трансформатора»: per-user справочник +
// каскадный пикер Производитель → Серия → Типоразмер, ручное
// добавление записей. Автоматический расчёт I_k по паспорту
// (shared/transformer-picker.computeTransformerIk).
// ======================================================================

import {
  listTransformers, addTransformer, removeTransformer, clearCatalog, makeTransformerId,
} from '../shared/transformer-catalog.js';
import { mountTransformerPicker, computeTransformerIk } from '../shared/transformer-picker.js';
import { parseTransformerXlsx, downloadCatalogTemplate } from '../shared/catalog-xlsx-parser.js';

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
  const list = listTransformers();
  const mount = document.getElementById('tx-cascade-mount');
  if (mount) {
    if (!cascadeHandle) {
      cascadeHandle = mountTransformerPicker(mount, {
        list,
        selectedId: cascadeState.modelId || null,
        currentSupplier: cascadeState.supplier,
        currentSeries: cascadeState.series,
        placeholders: { supplier: 'Все производители', series: 'Все серии', model: 'Все типоразмеры' },
        labels: { supplier: 'Производитель', series: 'Серия', model: 'Типоразмер (S, кВА)' },
        idPrefix: 'tx-cat',
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
    wrap.innerHTML = `<div class="empty">Справочник пуст. Нажмите «+ Добавить вручную».</div>`;
    return;
  }
  const filtered = list.filter(t => {
    if (cascadeState.supplier && (t.supplier || 'Unknown') !== cascadeState.supplier) return false;
    if (cascadeState.series && (t.series || 'Other') !== cascadeState.series) return false;
    if (cascadeState.modelId && t.id !== cascadeState.modelId) return false;
    return true;
  });
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty">По фильтру ничего не найдено.</div>`;
    return;
  }
  const rows = filtered.map(t => {
    const { IkA, IratedA } = computeTransformerIk(t);
    return `
      <tr data-id="${esc(t.id)}">
        <td><b>${esc(t.supplier || '—')}</b></td>
        <td>${esc(t.series || '—')}</td>
        <td>${t.sKva || '—'} кВА</td>
        <td>${t.uhvKv || '—'} / ${t.ulvV ? (t.ulvV / 1000).toFixed(2) : '—'} кВ</td>
        <td>${esc(t.vectorGroup || '—')}</td>
        <td>${t.ukPct || '—'}%</td>
        <td>${IratedA || '—'} А</td>
        <td>${IkA ? (IkA / 1000).toFixed(1) + ' кА' : '—'}</td>
        <td>
          <button class="btn-sm btn-del" data-del="${esc(t.id)}">Удалить</button>
        </td>
      </tr>`;
  }).join('');
  wrap.innerHTML = `
    <table class="cat-table">
      <thead><tr>
        <th>Производитель</th><th>Серия</th><th>S</th>
        <th>U<sub>HV</sub>/U<sub>LV</sub></th>
        <th>Гр.</th><th>u<sub>k</sub></th>
        <th>I<sub>ном LV</sub></th><th>I<sub>k LV</sub></th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Удалить эту запись?')) return;
      removeTransformer(btn.dataset.del);
      flash('Удалено');
      render();
    });
  });
}

function renderSelected(list) {
  const box = document.getElementById('selected-tx-details');
  if (!box) return;
  if (!cascadeState.modelId) {
    box.className = 'empty';
    box.textContent = 'Выберите модель в каскаде выше.';
    return;
  }
  const t = list.find(x => x.id === cascadeState.modelId);
  if (!t) { box.className = 'empty'; box.textContent = 'Запись не найдена.'; return; }
  const { IkA, IratedA } = computeTransformerIk(t);
  box.className = 'details-card';
  box.innerHTML = `
    <h4>${esc(t.supplier)} · ${esc(t.series)} · ${t.sKva} кВА</h4>
    <div class="grid">
      <div>Мощность:</div><div><b>${t.sKva || '—'} кВА</b></div>
      <div>U<sub>HV</sub>:</div><div><b>${t.uhvKv || '—'} кВ</b></div>
      <div>U<sub>LV</sub>:</div><div><b>${t.ulvV || '—'} В</b></div>
      <div>Группа соединений:</div><div><b>${esc(t.vectorGroup || '—')}</b></div>
      <div>u<sub>k</sub>:</div><div><b>${t.ukPct || '—'}%</b></div>
      <div>I<sub>ном LV</sub>:</div><div><b>${IratedA || '—'} А</b></div>
      <div>I<sub>k LV</sub> (расч.):</div><div><b>${IkA ? (IkA / 1000).toFixed(2) + ' кА' : '—'}</b>
        <span class="muted" style="font-size:11px;margin-left:4px">(по I_k = I_ном / u_k)</span></div>
      <div>Потери P₀ (ХХ):</div><div>${t.p0Kw || '—'} кВт</div>
      <div>Потери P<sub>k</sub> (КЗ):</div><div>${t.pkKw || '—'} кВт</div>
      <div>Охлаждение:</div><div>${esc(t.cooling || '—')}</div>
      <div>Изоляция:</div><div>${esc(t.insulation || '—')}</div>
      ${t.weight ? `<div>Масса:</div><div>${t.weight} кг</div>` : ''}
      <div>Источник:</div><div class="muted">${esc(t.source || '—')}</div>
    </div>
    <p class="muted" style="font-size:11px;margin-top:10px">
      В будущих итерациях здесь появится кнопка «Применить к источнику»
      через <code>applyTransformerModel</code> из <code>shared/transformer-picker.js</code>.
    </p>
  `;
}

function openManualModal() {
  let modal = document.getElementById('manual-tx-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manual-tx-modal';
    modal.className = 'ups-modal';
    modal.innerHTML = `
      <div class="ups-modal-box">
        <div class="ups-modal-head">
          <h3>Добавить трансформатор вручную</h3>
          <button class="ups-modal-close" aria-label="Закрыть">×</button>
        </div>
        <div class="ups-modal-body" id="manual-tx-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.ups-modal-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const body = document.getElementById('manual-tx-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>Производитель<input id="mt-supplier" type="text" placeholder="ABB"></label>
      <label>Серия<input id="mt-series" type="text" placeholder="TMG"></label>
      <label>S, кВА<input id="mt-s" type="number" min="25" step="25" value="1000"></label>
      <label>U<sub>HV</sub>, кВ<input id="mt-uhv" type="number" min="0.4" step="0.1" value="10"></label>
      <label>U<sub>LV</sub>, В<input id="mt-ulv" type="number" min="100" step="10" value="400"></label>
      <label>Группа соединений<input id="mt-vg" type="text" value="Dyn11"></label>
      <label>u<sub>k</sub>, %<input id="mt-uk" type="number" min="2" max="15" step="0.1" value="6"></label>
      <label>P₀ (ХХ), кВт<input id="mt-p0" type="number" min="0" step="0.1" value="1.5"></label>
      <label>P<sub>k</sub> (КЗ), кВт<input id="mt-pk" type="number" min="0" step="0.1" value="10"></label>
      <label>Охлаждение<select id="mt-cool">
        <option value="ONAN">ONAN (масло, естест. воздух)</option>
        <option value="ONAF">ONAF (масло, принудит. воздух)</option>
        <option value="AN">AN (сухой, естест. воздух)</option>
        <option value="AF">AF (сухой, принудит. воздух)</option>
      </select></label>
      <label>Изоляция<select id="mt-ins">
        <option value="oil">масляный</option>
        <option value="dry">сухой</option>
        <option value="epoxy">эпоксид (TRIHAL)</option>
      </select></label>
      <label>Масса, кг (опц.)<input id="mt-weight" type="number" min="0" step="10" value=""></label>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mt-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mt-save" class="btn-sm btn-primary">Добавить</button>
    </div>
  `;
  const g = id => document.getElementById(id);
  g('mt-cancel').addEventListener('click', () => modal.classList.remove('show'));
  g('mt-save').addEventListener('click', () => {
    const supplier = g('mt-supplier').value.trim();
    const series = g('mt-series').value.trim();
    const sKva = Number(g('mt-s').value) || 0;
    if (!supplier || !series || !sKva) { alert('Заполните Производителя, Серию и мощность S'); return; }
    const record = {
      id: makeTransformerId(supplier, series, sKva),
      supplier, series,
      sKva,
      uhvKv: Number(g('mt-uhv').value) || 0,
      ulvV: Number(g('mt-ulv').value) || 0,
      vectorGroup: g('mt-vg').value.trim() || 'Dyn11',
      ukPct: Number(g('mt-uk').value) || 0,
      p0Kw: Number(g('mt-p0').value) || 0,
      pkKw: Number(g('mt-pk').value) || 0,
      cooling: g('mt-cool').value || 'ONAN',
      insulation: g('mt-ins').value || 'oil',
      weight: Number(g('mt-weight').value) || null,
      source: 'ручной ввод',
      importedAt: Date.now(),
      custom: true,
    };
    addTransformer(record);
    modal.classList.remove('show');
    flash('Добавлено: ' + supplier + ' ' + series + ' ' + sKva + ' кВА', 'success');
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
          const records = parseTransformerXlsx(buf, f.name);
          for (const rec of records) { addTransformer(rec); added++; }
        } catch (e) {
          errors.push(`${f.name}: ${e.message || e}`);
        }
      }
      importInput.value = '';
      render();
      if (errors.length) {
        flash(`Импортировано ${added}. Ошибок: ${errors.length}`, 'warn');
        console.warn('[transformer-config] xlsx import errors:', errors);
      } else {
        flash(`Импортировано ${added} трансформаторов`, 'success');
      }
    });
  }

  const tplBtn = document.getElementById('btn-template-xlsx');
  if (tplBtn) tplBtn.addEventListener('click', () => {
    try { downloadCatalogTemplate('transformer'); flash('Шаблон скачан', 'success'); }
    catch (e) { flash('Ошибка: ' + (e.message || e), 'error'); }
  });

  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник трансформаторов?')) return;
    clearCatalog();
    cascadeState.supplier = cascadeState.series = cascadeState.modelId = '';
    render();
    flash('Справочник очищен');
  });
  // Wizard подбора
  const wizRun = document.getElementById('tx-wiz-run');
  if (wizRun) wizRun.addEventListener('click', runTxWizard);
  const wizReset = document.getElementById('tx-wiz-reset');
  if (wizReset) wizReset.addEventListener('click', () => {
    document.getElementById('tx-wiz-loadKva').value = 630;
    document.getElementById('tx-wiz-reserve').value = 25;
    document.getElementById('tx-wiz-uhv').value = '10';
    document.getElementById('tx-wiz-ulv').value = '400';
    document.getElementById('tx-wiz-type').value = '';
    document.getElementById('tx-wiz-group').value = 'Dyn11';
    document.getElementById('tx-wiz-results').innerHTML = '';
  });

  render();
});

// ===== WIZARD подбора трансформатора =====
function _classifyTxType(t) {
  const s = String(t.series || t.model || '').toUpperCase();
  // ТСЛ / ТСЗГЛ / ТС / dry — сухие
  if (/ТСЛ|ТСЗГЛ|ТС[ЗГ]?\b|DRY|СУХ/.test(s) || t.coolingType === 'AN' || t.coolingType === 'AF') return 'dry';
  // ТМ / ТМГ / ТМЗ / ТМН — масляные
  if (/ТМ|OIL|МАСЛ|ONAN|ONAF/.test(s) || t.coolingType === 'ONAN' || t.coolingType === 'ONAF') return 'oil';
  return '';
}

function runTxWizard() {
  const loadKva = Number(document.getElementById('tx-wiz-loadKva').value) || 0;
  const reserve = Number(document.getElementById('tx-wiz-reserve').value) || 0;
  const uhv = document.getElementById('tx-wiz-uhv').value;
  const ulv = document.getElementById('tx-wiz-ulv').value;
  const type = document.getElementById('tx-wiz-type').value;
  const group = document.getElementById('tx-wiz-group').value;
  const results = document.getElementById('tx-wiz-results');

  if (loadKva <= 0) {
    results.innerHTML = '<div class="empty" style="padding:14px">Укажите нагрузку &gt; 0 кВА.</div>';
    return;
  }
  const sRequired = loadKva * (1 + reserve / 100);

  const catalog = listTransformers();
  const matched = [];
  for (const t of catalog) {
    const s = Number(t.ratedPowerKva || t.sKva || t.powerKva) || 0;
    if (s <= 0 || s < sRequired) continue;
    if (uhv && Number(t.primaryVoltageKv || t.uhvKv) !== Number(uhv)) continue;
    if (ulv && Number(t.secondaryVoltageV || t.ulvV) !== Number(ulv)) continue;
    if (type) {
      const cl = _classifyTxType(t);
      if (cl && cl !== type) continue;
    }
    if (group && (t.connectionGroup || t.vectorGroup || t.group) &&
        String(t.connectionGroup || t.vectorGroup || t.group).toUpperCase() !== group.toUpperCase()) continue;
    const util = loadKva / s;
    matched.push({ t, s, util });
  }
  matched.sort((a, b) => b.util - a.util); // наибольшая утилизация сверху

  if (!matched.length) {
    results.innerHTML = `
      <div class="empty" style="padding:14px;text-align:center">
        Подходящих моделей не найдено. Попробуйте: ослабить фильтры, увеличить запас,
        или добавить модели в справочник (кнопка «+ Добавить вручную» / «📊 Импорт XLSX»).
      </div>`;
    return;
  }

  const rows = matched.slice(0, 20).map(({ t, s, util }, idx) => {
    const pct = Math.round(util * 100);
    const uhvStr = t.primaryVoltageKv || t.uhvKv || '—';
    const ulvStr = t.secondaryVoltageV || t.ulvV || '—';
    const grp = t.connectionGroup || t.vectorGroup || t.group || '—';
    const uk = t.impedanceUk ?? t.uk;
    const ukStr = uk != null ? Number(uk).toFixed(1) + '%' : '—';
    const cl = _classifyTxType(t);
    const typeStr = cl === 'oil' ? 'масл.' : (cl === 'dry' ? 'сух.' : '—');
    return `
      <tr data-id="${esc(t.id)}" style="${idx === 0 ? 'background:#f0fff4' : ''}">
        <td>${idx === 0 ? '<b>★</b>' : (idx + 1)}</td>
        <td><b>${esc(t.supplier || '—')}</b></td>
        <td>${esc(t.model || t.series || t.id)}</td>
        <td style="text-align:right">${s} кВА</td>
        <td>${uhvStr} / ${ulvStr} В</td>
        <td>${typeStr}</td>
        <td>${esc(grp)}</td>
        <td>${ukStr}</td>
        <td style="text-align:right">${pct}%</td>
        <td><button class="btn-sm" data-pick="${esc(t.id)}">Выбрать</button></td>
      </tr>`;
  }).join('');

  results.innerHTML = `
    <div class="muted" style="font-size:11px;margin-bottom:6px">
      Требуется ≥ ${sRequired.toFixed(0)} кВА (нагрузка ${loadKva} + запас ${reserve}%).
      Найдено моделей: <b>${matched.length}</b>.
    </div>
    <table class="cat-table">
      <thead><tr>
        <th>#</th><th>Производитель</th><th>Модель</th><th>S</th>
        <th>U<sub>HV</sub>/U<sub>LV</sub></th><th>Тип</th><th>Группа</th>
        <th>u<sub>k</sub></th><th>Загрузка</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  results.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pick;
      cascadeState.modelId = id;
      const list = listTransformers();
      const t = list.find(x => x.id === id);
      if (t) {
        cascadeState.supplier = t.supplier || '';
        cascadeState.series = t.series || '';
      }
      render();
      const sel = document.getElementById('selected-tx-details');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash('Модель выбрана — см. «Выбранная модель»', 'success');
    });
  });
}
