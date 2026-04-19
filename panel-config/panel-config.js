// ======================================================================
// panel-config.js
// Подпрограмма «Конфигуратор щита»: per-user справочник моделей +
// каскадный пикер Производитель → Серия → Типоразмер + ручное добавление.
// Использует shared/panel-catalog.js и shared/panel-picker.js — те же
// модули применимы в будущем из инспектора щита главной схемы.
// ======================================================================

import { listPanels, addPanel, removePanel, clearCatalog, makePanelId } from '../shared/panel-catalog.js';
import { parsePanelXlsx, downloadCatalogTemplate } from '../shared/catalog-xlsx-parser.js';
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

  const tplBtn = document.getElementById('btn-template-xlsx');
  if (tplBtn) tplBtn.addEventListener('click', () => {
    try { downloadCatalogTemplate('panel'); flash('Шаблон скачан', 'success'); }
    catch (e) { flash('Ошибка: ' + (e.message || e), 'error'); }
  });

  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник щитов?')) return;
    clearCatalog();
    cascadeState.supplier = cascadeState.series = cascadeState.modelId = '';
    render();
    flash('Справочник очищен');
  });
  render();

  // Фаза 1.7: wizard конфигуратора при ?nodeId=
  initPanelWizard();
});

// ====================== WIZARD (Фаза 1.7) ======================
const pcWizState = {
  nodeId: null,
  step: 1,
  requirements: {
    name: 'ЩС',
    kind: 'distribution',
    loadKw: 20,
    voltage: 'lv-400',
    inputs: 1,
    outputs: 6,
    ip: 'IP31',
    form: '2',
    reserve: 20,
  },
  selectedEnclosure: null,
  breakers: [], // { name, inA, curve, role }
};

// Расчёт тока по мощности и напряжению
function _pcCalcCurrent(kW, voltage) {
  const U = voltage === 'lv-230' ? 230 : (voltage === 'lv-690' ? 690 : 400);
  const is1ph = voltage === 'lv-230';
  const cosPhi = 0.9;
  if (is1ph) return (kW * 1000) / (U * cosPhi);
  return (kW * 1000) / (Math.sqrt(3) * U * cosPhi);
}

// Округлить ток до стандартного номинала автомата
function _pcStandardBreakerIn(I) {
  const std = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  for (const s of std) if (s >= I) return s;
  return std[std.length - 1];
}

function _pcParseIp(ip) {
  const m = /IP(\d)(\d)/.exec(String(ip || ''));
  return m ? { solid: Number(m[1]), liquid: Number(m[2]) } : { solid: 2, liquid: 0 };
}
function _pcIpCovers(candidateIp, requiredIp) {
  const c = _pcParseIp(candidateIp), r = _pcParseIp(requiredIp);
  return c.solid >= r.solid && c.liquid >= r.liquid;
}

function initPanelWizard() {
  const qp = new URLSearchParams(location.search);
  const ctxNodeId = qp.get('nodeId');
  if (!ctxNodeId) return;

  pcWizState.nodeId = ctxNodeId;
  const rq = pcWizState.requirements;
  if (qp.get('name')) rq.name = qp.get('name');
  if (qp.get('kind')) rq.kind = qp.get('kind');
  if (qp.get('loadKw')) rq.loadKw = Number(qp.get('loadKw')) || rq.loadKw;
  if (qp.get('voltage')) rq.voltage = qp.get('voltage');
  if (qp.get('inputs')) rq.inputs = Number(qp.get('inputs')) || 1;
  if (qp.get('outputs')) rq.outputs = Number(qp.get('outputs')) || 6;
  if (qp.get('ip')) rq.ip = qp.get('ip');
  if (qp.get('form')) rq.form = qp.get('form');

  const wizard = document.getElementById('pc-wizard');
  if (!wizard) return;
  wizard.style.display = '';

  // Скрываем нижний блок «Выбранная модель» (не нужен в wizard)
  const selectedPanel = document.getElementById('selected-panel-details');
  if (selectedPanel) selectedPanel.closest('.panel').style.display = 'none';
  // Справочник сворачиваем в аккордеон (доступ из wizard, но не мешает)

  _pcFillStep1();
  _pcShowStep(1);

  // Кнопки навигации
  document.getElementById('pc-wiz-cancel').onclick = () => {
    if (confirm('Отменить конфигурирование щита?')) { try { window.close(); } catch {} }
  };
  document.getElementById('pc-wiz-next-1').onclick = _pcGoStep2;
  document.getElementById('pc-wiz-back-2').onclick = () => _pcShowStep(1);
  document.getElementById('pc-wiz-next-2').onclick = _pcGoStep3;
  document.getElementById('pc-wiz-back-3').onclick = () => _pcShowStep(2);
  document.getElementById('pc-wiz-next-3').onclick = _pcGoStep4;
  document.getElementById('pc-wiz-back-4').onclick = () => _pcShowStep(3);
  document.getElementById('pc-wiz-apply').onclick = _pcApplyConfiguration;
}

function _pcFillStep1() {
  const rq = pcWizState.requirements;
  document.getElementById('pc-name').value = rq.name;
  document.getElementById('pc-kind').value = rq.kind;
  document.getElementById('pc-loadKw').value = rq.loadKw;
  document.getElementById('pc-voltage').value = rq.voltage;
  document.getElementById('pc-inputs').value = rq.inputs;
  document.getElementById('pc-outputs').value = rq.outputs;
  document.getElementById('pc-ip').value = rq.ip;
  document.getElementById('pc-form').value = rq.form;
  document.getElementById('pc-reserve').value = rq.reserve;
}

function _pcReadStep1() {
  const rq = pcWizState.requirements;
  rq.name = document.getElementById('pc-name').value || 'ЩС';
  rq.kind = document.getElementById('pc-kind').value;
  rq.loadKw = Number(document.getElementById('pc-loadKw').value) || 0;
  rq.voltage = document.getElementById('pc-voltage').value;
  rq.inputs = Math.max(1, Number(document.getElementById('pc-inputs').value) || 1);
  rq.outputs = Math.max(1, Number(document.getElementById('pc-outputs').value) || 1);
  rq.ip = document.getElementById('pc-ip').value;
  rq.form = document.getElementById('pc-form').value;
  rq.reserve = Number(document.getElementById('pc-reserve').value) || 0;
}

function _pcShowStep(n) {
  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById('pc-wiz-step-' + i);
    if (el) el.style.display = (i === n) ? '' : 'none';
  });
  pcWizState.step = n;
  const ind = document.getElementById('pc-wiz-step-indicator');
  if (ind) ind.textContent = 'Шаг ' + n + ' из 4';
}

// ----- Шаг 2: подбор оболочки -----
function _pcPickEnclosures() {
  const rq = pcWizState.requirements;
  const I_required = _pcCalcCurrent(rq.loadKw, rq.voltage) * (1 + rq.reserve / 100);
  const inStd = _pcStandardBreakerIn(I_required);
  const catalog = listPanels();
  const out = [];
  for (const p of catalog) {
    const inNom = Number(p.inNominal) || Number(p.busbarA) || 0;
    if (inNom < inStd) continue;
    // IP проверка
    if (!_pcIpCovers(p.ipRating, rq.ip)) continue;
    // Форма (если задана у записи)
    if (p.form && Number(p.form) < Number(rq.form)) continue;
    // Утилизация
    const utilization = I_required / inNom;
    out.push({ panel: p, inNom, utilization, I_required, inStd });
  }
  // Сортировка: сначала по утилизации близкой к оптимальной (0.5-0.8), потом по цене
  out.sort((a, b) => Math.abs(0.65 - b.utilization) - Math.abs(0.65 - a.utilization));
  // Инвертируем: лучшее первым (меньшее значение — лучше, т.к. ближе к 0)
  out.sort((a, b) => Math.abs(0.65 - a.utilization) - Math.abs(0.65 - b.utilization));
  return { items: out, I_required, inStd };
}

function _pcGoStep2() {
  _pcReadStep1();
  const { items, I_required, inStd } = _pcPickEnclosures();
  const list = document.getElementById('pc-wiz-enclosure-list');
  if (!items.length) {
    list.innerHTML = `
      <div class="empty" style="padding:30px;text-align:center">
        Подходящих оболочек не найдено (требуется In ≥ ${inStd} А, ${pcWizState.requirements.ip}, Form ${pcWizState.requirements.form}).<br>
        Добавьте модели в справочник (ниже) или смягчите требования.<br>
        Если вы хотите использовать «произвольную» оболочку — нажмите «Далее»,
        щит будет создан с параметрами, введёнными вручную.
      </div>
      <div style="text-align:right;margin-top:10px">
        <button class="btn-sm" id="pc-skip-enclosure">Продолжить без оболочки</button>
      </div>`;
    document.getElementById('pc-wiz-next-2').disabled = true;
    document.getElementById('pc-skip-enclosure')?.addEventListener('click', () => {
      pcWizState.selectedEnclosure = null;
      document.getElementById('pc-wiz-next-2').disabled = false;
      _pcGoStep3();
    });
    _pcShowStep(2);
    return;
  }
  const html = [
    `<p class="muted" style="font-size:12px">Требуемый ток: <b>${I_required.toFixed(0)} А</b>, подходящий номинал шин: <b>${inStd} А</b>. Оптимальная утилизация 50-80%.</p>`,
    '<div class="enclosure-list">',
  ];
  items.forEach((it, idx) => {
    const p = it.panel;
    const isRec = idx === 0 ? ' recommended' : '';
    const utilPct = (it.utilization * 100).toFixed(0);
    const utilColor = it.utilization > 0.9 ? '#cf222e' : (it.utilization < 0.3 ? '#c67300' : '#2e7d32');
    html.push(`
      <div class="enclosure-item${isRec}" data-id="${esc(p.id)}" data-idx="${idx}">
        <div class="enclosure-main">
          <div class="enclosure-title">${esc(p.supplier || '')} · ${esc(p.series || '')} · ${esc(p.variant || p.id)}</div>
          <div class="enclosure-meta">
            In ${p.inNominal || '?'} А · шины ${p.busbarA || '?'} А · ${esc(p.ipRating || '?')} · Form ${esc(p.form || '?')} ·
            ${p.width || '?'}×${p.height || '?'}×${p.depth || '?'} мм${p.material ? ' · ' + esc(p.material) : ''}
          </div>
        </div>
        <div class="enclosure-calc" style="color:${utilColor}">Утилизация: ${utilPct}%</div>
      </div>`);
  });
  html.push('</div>');
  list.innerHTML = html.join('');
  list.querySelectorAll('.enclosure-item').forEach(el => {
    el.onclick = () => {
      list.querySelectorAll('.enclosure-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      const idx = Number(el.dataset.idx);
      pcWizState.selectedEnclosure = items[idx];
      document.getElementById('pc-wiz-next-2').disabled = false;
    };
  });
  // Авто-выбор лучшего
  list.querySelector('.enclosure-item')?.click();
  _pcShowStep(2);
}

// ----- Шаг 3: автоматы -----
function _pcGenerateBreakers() {
  const rq = pcWizState.requirements;
  const I_total = _pcCalcCurrent(rq.loadKw, rq.voltage);
  const I_in = I_total * (1 + rq.reserve / 100);
  const inIn = _pcStandardBreakerIn(I_in);
  // Средняя нагрузка на отходящую линию (с коэф. одновременности 0.7)
  const I_per_out = (I_total * 0.7) / rq.outputs;
  const inOut = _pcStandardBreakerIn(Math.max(I_per_out, 10));

  const list = [];
  // Вводные автоматы (по числу вводов)
  for (let i = 0; i < rq.inputs; i++) {
    list.push({
      role: 'input',
      name: rq.inputs > 1 ? `Вводной ${i + 1}` : 'Вводной',
      inA: inIn,
      curve: 'MCCB',
      poles: rq.voltage === 'lv-230' ? 2 : 4,
    });
  }
  // Если АВР — добавим переключатель
  if (rq.kind === 'avr' && rq.inputs >= 2) {
    list.push({ role: 'switch', name: 'АВР (переключатель)', inA: inIn, curve: '—', poles: 4 });
  }
  // Отходящие автоматы
  for (let i = 0; i < rq.outputs; i++) {
    list.push({
      role: 'output',
      name: `Отходящая линия ${i + 1}`,
      inA: inOut,
      curve: 'MCB_C',
      poles: rq.voltage === 'lv-230' ? 1 : 3,
    });
  }
  return list;
}

function _pcGoStep3() {
  pcWizState.breakers = _pcGenerateBreakers();
  const container = document.getElementById('pc-wiz-breakers');
  const html = [
    `<p class="muted" style="font-size:12px">Предварительный состав. Номиналы и типы можно подправить.</p>`,
    '<table class="pc-breakers-table"><thead><tr><th>Роль</th><th>Назначение</th><th>In, А</th><th>Тип</th><th>Полюса</th></tr></thead><tbody>',
  ];
  pcWizState.breakers.forEach((b, idx) => {
    const inOpts = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600]
      .map(n => `<option value="${n}"${n === b.inA ? ' selected' : ''}>${n}</option>`).join('');
    const curveOpts = ['MCB_B', 'MCB_C', 'MCB_D', 'MCCB', 'ACB']
      .map(c => `<option value="${c}"${c === b.curve ? ' selected' : ''}>${c}</option>`).join('<option value="—"' + (b.curve === '—' ? ' selected' : '') + '>—</option>');
    const polesOpts = [1, 2, 3, 4]
      .map(n => `<option value="${n}"${n === b.poles ? ' selected' : ''}>${n}P</option>`).join('');
    html.push(`
      <tr data-idx="${idx}">
        <td>${b.role === 'input' ? '🔌 Ввод' : b.role === 'switch' ? '↔ АВР' : '→ Отход.'}</td>
        <td><input type="text" class="pc-br-name" value="${esc(b.name)}"></td>
        <td><select class="pc-br-in">${inOpts}</select></td>
        <td><select class="pc-br-curve">${curveOpts}</select></td>
        <td><select class="pc-br-poles">${polesOpts}</select></td>
      </tr>`);
  });
  html.push('</tbody></table>');
  html.push(`<p class="muted" style="font-size:11px;margin-top:8px">⚠ Это упрощённый подбор. Полноценный (с селективностью, TCC, расцепителями) — в Фазе 1.10.</p>`);
  container.innerHTML = html.join('');

  // Слушатели изменений
  container.querySelectorAll('tr[data-idx]').forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelector('.pc-br-name').oninput = e => { pcWizState.breakers[idx].name = e.target.value; };
    row.querySelector('.pc-br-in').onchange = e => { pcWizState.breakers[idx].inA = Number(e.target.value); };
    row.querySelector('.pc-br-curve').onchange = e => { pcWizState.breakers[idx].curve = e.target.value; };
    row.querySelector('.pc-br-poles').onchange = e => { pcWizState.breakers[idx].poles = Number(e.target.value); };
  });
  _pcShowStep(3);
}

// ----- Шаг 4: итог -----
function _pcGoStep4() {
  const rq = pcWizState.requirements;
  const enc = pcWizState.selectedEnclosure;
  const brs = pcWizState.breakers;
  const I_total = _pcCalcCurrent(rq.loadKw, rq.voltage);

  const html = [`
    <div class="wiz-summary-box">
      <h5>Требования</h5>
      <table class="wiz-summary-table">
        <tr><td>Имя щита</td><td>${esc(rq.name)}</td></tr>
        <tr><td>Тип</td><td>${esc(rq.kind)}</td></tr>
        <tr><td>Расчётная нагрузка</td><td>${rq.loadKw} kW → ${I_total.toFixed(0)} А</td></tr>
        <tr><td>Напряжение</td><td>${esc(rq.voltage)}</td></tr>
        <tr><td>Вводы / выходы</td><td>${rq.inputs} / ${rq.outputs}</td></tr>
        <tr><td>IP / Form</td><td>${esc(rq.ip)} / Form ${esc(rq.form)}</td></tr>
      </table>
    </div>`];

  if (enc) {
    html.push(`
      <div class="wiz-summary-box">
        <h5>Оболочка</h5>
        <table class="wiz-summary-table">
          <tr><td>Модель</td><td>${esc(enc.panel.supplier || '')} ${esc(enc.panel.series || '')} ${esc(enc.panel.variant || '')}</td></tr>
          <tr><td>In</td><td>${enc.panel.inNominal || '?'} А</td></tr>
          <tr><td>Габариты</td><td>${enc.panel.width || '?'}×${enc.panel.height || '?'}×${enc.panel.depth || '?'} мм</td></tr>
          <tr><td>Утилизация</td><td>${(enc.utilization * 100).toFixed(0)}%</td></tr>
        </table>
      </div>`);
  } else {
    html.push(`<div class="wiz-summary-box"><h5>Оболочка</h5><p class="muted" style="font-size:12px">Не выбрана (используются вручную заданные параметры)</p></div>`);
  }

  // Состав автоматов
  html.push(`
    <div class="wiz-summary-box">
      <h5>Состав автоматов (${brs.length} шт.)</h5>
      <table class="pc-breakers-table"><thead><tr><th>Роль</th><th>Название</th><th>In</th><th>Тип</th><th>P</th></tr></thead><tbody>`);
  for (const b of brs) {
    html.push(`<tr>
      <td>${b.role === 'input' ? '🔌' : b.role === 'switch' ? '↔' : '→'}</td>
      <td>${esc(b.name)}</td><td>${b.inA} А</td><td>${esc(b.curve)}</td><td>${b.poles}P</td>
    </tr>`);
  }
  html.push('</tbody></table></div>');

  document.getElementById('pc-wiz-summary').innerHTML = html.join('');
  _pcShowStep(4);
}

function _pcApplyConfiguration() {
  const rq = pcWizState.requirements;
  const enc = pcWizState.selectedEnclosure;
  const brs = pcWizState.breakers;

  // Формируем composition для element-library / BOM
  const composition = [];
  if (enc) {
    composition.push({ elementId: enc.panel.id, qty: 1, role: 'enclosure', label: 'Оболочка щита' });
  }
  for (const b of brs) {
    composition.push({
      elementId: null,  // для конкретных автоматов ещё нет справочника (Фаза 1.10)
      inline: true,
      qty: 1,
      role: b.role === 'input' ? 'breaker-input' : (b.role === 'switch' ? 'switch-ats' : 'breaker-output'),
      label: `${b.name} (${b.inA}A ${b.curve} ${b.poles}P)`,
    });
  }

  const payload = {
    nodeId: pcWizState.nodeId,
    configuration: {
      panelCatalogId: enc ? enc.panel.id : null,
      enclosureId: enc ? enc.panel.id : null,
      name: rq.name,
      panelKind: rq.kind,
      inputs: rq.inputs,
      outputs: rq.outputs,
      ipRating: rq.ip,
      form: rq.form,
      reservePct: rq.reserve,
      breakers: brs,
      composition,
    },
    selectedAt: Date.now(),
  };
  try {
    localStorage.setItem('raschet.pendingPanelSelection.v1', JSON.stringify(payload));
    flash('Конфигурация передана. Возврат в Конструктор схем…', 'success');
    setTimeout(() => { try { window.close(); } catch {} }, 1500);
  } catch (e) {
    flash('Не удалось передать конфигурацию: ' + (e.message || e), 'error');
  }
}
