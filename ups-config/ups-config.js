// ======================================================================
// ups-config.js
// Подпрограмма «Конфигуратор ИБП»: справочник моделей + каскадный пикер
// (Производитель → Серия → Модель), выбор модели, просмотр характеристик.
// Использует shared/ups-catalog.js и shared/ups-picker.js — та же логика
// будет применяться из инспектора ИБП главной схемы.
// ======================================================================

import { listUpses, addUps, removeUps, clearCatalog, makeUpsId } from '../shared/ups-catalog.js';
import { mountUpsPicker, extractUpsSeries } from '../shared/ups-picker.js';
import { KEHUA_MR33_UPSES } from '../shared/kehua-mr33-data.js';

let cascadeHandle = null;
const cascadeState = { supplier: '', series: '', modelId: '' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmt(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return v % 1 === 0 ? v.toString() : v.toFixed(digits);
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

// ====================== Рендер ======================
function render() {
  const list = listUpses();

  // Монтируем каскадный пикер (или обновляем существующий)
  const mount = document.getElementById('ups-cascade-mount');
  if (mount) {
    if (!cascadeHandle) {
      cascadeHandle = mountUpsPicker(mount, {
        list,
        selectedId: cascadeState.modelId || null,
        currentSupplier: cascadeState.supplier,
        currentSeries: cascadeState.series,
        placeholders: { supplier: 'Все производители', series: 'Все серии', model: 'Все модели' },
        labels: { supplier: 'Производитель', series: 'Серия', model: 'Модель' },
        idPrefix: 'ups-cat',
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
  // Фильтр по каскаду (supplier/series/modelId)
  const filtered = list.filter(u => {
    if (cascadeState.supplier && (u.supplier || 'Unknown') !== cascadeState.supplier) return false;
    if (cascadeState.series && extractUpsSeries(u.model) !== cascadeState.series) return false;
    if (cascadeState.modelId && u.id !== cascadeState.modelId) return false;
    return true;
  });
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty">По фильтру ничего не найдено. Очистите каскад.</div>`;
    return;
  }
  const kindIcon = (k) => {
    switch (k) {
      case 'frame':              return '📦';
      case 'power-module':       return '🔌';
      case 'batt-cabinet-vrla':  return '🔋';
      case 'batt-cabinet-s3':    return '🏛';
      default:                   return '⚡'; // готовый ИБП
    }
  };
  const kindLabel = (u) => {
    const k = u.kind || 'ups';
    if (k === 'frame')             return 'Фрейм';
    if (k === 'power-module')      return 'Силовой модуль';
    if (k === 'batt-cabinet-vrla') return 'Шкаф VRLA';
    if (k === 'batt-cabinet-s3')   return 'Шкаф S³';
    return u.upsType === 'modular' ? 'ИБП (модульный)' : 'ИБП (моноблок)';
  };
  const mainValue = (u) => {
    const k = u.kind || 'ups';
    if (k === 'frame')        return fmt(u.frameKw) + ' kW (корпус)';
    if (k === 'power-module') return fmt(u.moduleKwRated) + ' kW (модуль)';
    if (k === 'batt-cabinet-vrla') return (u.rackSlots || '?') + ' блоков';
    if (k === 'batt-cabinet-s3')   return fmt(u.cabinetKwh) + ' kWh / ' + fmt(u.cabinetPowerKw) + ' kW';
    return fmt(u.capacityKw) + ' kW';
  };
  const rows = filtered.map(u => {
    const k = u.kind || 'ups';
    return `
      <tr data-id="${esc(u.id)}">
        <td style="text-align:center;font-size:14px" title="${esc(kindLabel(u))}">${kindIcon(k)}</td>
        <td><b>${esc(u.supplier)}</b></td>
        <td>${esc(u.model)}</td>
        <td>${esc(kindLabel(u))}</td>
        <td>${mainValue(u)}</td>
        <td>${u.efficiency ? fmt(u.efficiency, 0) + '%' : '—'}</td>
        <td>${u.vdcMin ? fmt(u.vdcMin, 0) + '…' + fmt(u.vdcMax, 0) + ' В' : '—'}</td>
        <td>
          <button class="btn-sm btn-del" data-del="${esc(u.id)}">Удалить</button>
        </td>
      </tr>`;
  }).join('');
  wrap.innerHTML = `
    <table class="cat-table">
      <thead><tr>
        <th></th><th>Производитель</th><th>Модель</th><th>Тип</th><th>Основной параметр</th>
        <th>КПД</th><th>V<sub>DC</sub></th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Удалить эту запись?')) return;
      removeUps(btn.dataset.del);
      flash('Удалено');
      render();
    });
  });
}

function renderSelected(list) {
  const box = document.getElementById('selected-ups-details');
  if (!box) return;
  if (!cascadeState.modelId) {
    box.className = 'empty';
    box.textContent = 'Выберите модель в каскаде выше.';
    return;
  }
  const u = list.find(x => x.id === cascadeState.modelId);
  if (!u) {
    box.className = 'empty';
    box.textContent = 'Запись не найдена.';
    return;
  }
  box.className = 'details-card';
  const k = u.kind || 'ups';
  const isFrame  = k === 'frame';
  const isModule = k === 'power-module';
  const isBattVrla = k === 'batt-cabinet-vrla';
  const isBattS3   = k === 'batt-cabinet-s3';
  let typeTitle;
  if (isFrame)        typeTitle = '📦 Фрейм (корпус модульного ИБП)';
  else if (isModule)  typeTitle = '🔌 Силовой модуль';
  else if (isBattVrla) typeTitle = '🔋 Шкаф батарейный (VRLA/AGM)';
  else if (isBattS3)   typeTitle = '🏛 Шкаф батарейный (Kehua S³)';
  else typeTitle = u.upsType === 'modular' ? '⚡ ИБП (модульный)' : '⚡ ИБП (моноблок)';

  let rows = `<div>Тип записи:</div><div><b>${typeTitle}</b></div>`;
  if (!isFrame && !isModule && !isBattVrla && !isBattS3) {
    // Готовый ИБП
    rows += `
      <div>Номинал:</div><div><b>${fmt(u.capacityKw)} kW</b></div>
      ${u.upsType === 'modular' ? `
      <div>Корпус:</div><div><b>${fmt(u.frameKw)} kW</b> · ${u.moduleSlots || '—'} слотов</div>
      <div>Модуль:</div><div><b>${fmt(u.moduleKwRated)} kW</b></div>
      ` : ''}
      <div>КПД DC–AC:</div><div><b>${fmt(u.efficiency, 0)}%</b></div>
      <div>cos φ:</div><div><b>${fmt(u.cosPhi, 2)}</b></div>
      <div>V<sub>DC</sub>:</div><div><b>${fmt(u.vdcMin, 0)}…${fmt(u.vdcMax, 0)} В</b></div>
      <div>Входов / выходов:</div><div><b>${u.inputs || 1} / ${u.outputs || 1}</b></div>`;
  } else if (isFrame) {
    rows += `
      <div>Мощность корпуса:</div><div><b>${fmt(u.frameKw)} kW</b></div>
      <div>Слотов под модули:</div><div><b>${u.moduleSlots || '?'}</b></div>
      <div>Комплектация:</div><div><span class="muted">Поставляется ПУСТЫМ — силовые модули заказываются отдельно</span></div>`;
  } else if (isModule) {
    rows += `
      <div>Мощность модуля:</div><div><b>${fmt(u.moduleKwRated)} kW</b></div>
      <div>Габариты:</div><div>${esc(u.physicalDims || '—')}</div>
      <div>Масса:</div><div>${u.weightKg ? u.weightKg + ' кг' : '—'}</div>
      <div>КПД:</div><div><b>${fmt(u.efficiency, 0)}%</b></div>`;
  } else if (isBattVrla) {
    rows += `
      <div>Посадочных мест:</div><div><b>${u.rackSlots || '?'} блоков</b></div>
      <div>Макс. ёмкость блока:</div><div><b>${u.maxBlockAh || '?'} А·ч</b></div>
      <div>DC шина:</div><div><b>${u.dcVoltage || '?'} В</b></div>
      <div>Батареи:</div><div><span class="muted">VRLA/AGM заказываются отдельно</span></div>`;
  } else if (isBattS3) {
    rows += `
      <div>Ёмкость шкафа:</div><div><b>${fmt(u.cabinetKwh)} kWh</b></div>
      <div>Мощность шкафа:</div><div><b>${fmt(u.cabinetPowerKw)} kW</b> (паспорт)</div>
      <div>Мест под модули:</div><div><b>${u.modulesPerCabinet || '?'}</b></div>
      <div>Модель модуля:</div><div><b>${esc(u.moduleModel || '—')}</b></div>
      <div>Модули:</div><div><span class="muted">Заказываются отдельно (см. справочник АКБ)</span></div>`;
  }
  rows += `<div>Источник:</div><div class="muted">${esc(u.source || '—')}</div>`;
  if (u.notes) rows += `<div>Примечание:</div><div class="muted" style="font-size:11px">${esc(u.notes)}</div>`;

  box.innerHTML = `
    <h4>${esc(u.supplier)} · ${esc(u.model)}</h4>
    <div class="grid">${rows}</div>
    ${(isFrame || isModule || isBattVrla || isBattS3) ? `
    <p class="muted" style="font-size:11px;margin-top:10px;padding:6px 10px;background:#fff8e1;border-left:3px solid #e65100;border-radius:3px">
      ℹ Это BOM-запись (${typeTitle.replace(/^[^\s]+\s/, '')}). Она не применяется к узлу ИБП напрямую, а используется для спецификации и сметы. Расчёт автономии для S³ шкафов ведётся через модули в справочнике АКБ.
    </p>` : ''}
  `;
}

// ====================== Модалка ручного добавления ======================
function openManualModal() {
  let modal = document.getElementById('manual-ups-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manual-ups-modal';
    modal.className = 'ups-modal';
    modal.innerHTML = `
      <div class="ups-modal-box">
        <div class="ups-modal-head">
          <h3>Добавить ИБП вручную</h3>
          <button class="ups-modal-close" aria-label="Закрыть">×</button>
        </div>
        <div class="ups-modal-body" id="manual-ups-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.ups-modal-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const body = document.getElementById('manual-ups-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>Производитель<input id="mu-supplier" type="text" placeholder="ABB"></label>
      <label>Модель<input id="mu-model" type="text" placeholder="PowerWave 33 300 kW"></label>
      <label>Тип
        <select id="mu-type">
          <option value="monoblock" selected>Моноблок</option>
          <option value="modular">Модульный</option>
        </select>
      </label>
      <label>Номинал, kW<input id="mu-cap" type="number" min="1" step="1" value="100"></label>
      <label>КПД DC–AC, %<input id="mu-eff" type="number" min="50" max="99" step="1" value="95"></label>
      <label>cos φ<input id="mu-cosphi" type="number" min="0.5" max="1" step="0.01" value="0.99"></label>
      <label>V<sub>DC</sub> min, В<input id="mu-vdcmin" type="number" min="24" max="1200" step="1" value="340"></label>
      <label>V<sub>DC</sub> max, В<input id="mu-vdcmax" type="number" min="24" max="1200" step="1" value="480"></label>
      <label>Входов<input id="mu-inputs" type="number" min="1" max="2" step="1" value="1"></label>
      <label>Выходов<input id="mu-outputs" type="number" min="1" max="20" step="1" value="1"></label>
      <div id="mu-modular-fields" style="display:none;grid-column:1/-1">
        <div class="form-grid">
          <label>Корпус, kW<input id="mu-frame" type="number" min="1" step="5" value="200"></label>
          <label>Модуль, kW<input id="mu-modkw" type="number" min="1" step="1" value="25"></label>
          <label>Слотов в корпусе<input id="mu-slots" type="number" min="1" max="32" step="1" value="8"></label>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mu-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mu-save" class="btn-sm btn-primary">Добавить</button>
    </div>
  `;
  const g = id => document.getElementById(id);
  // Показ/скрытие блока модульных полей
  const toggleModular = () => {
    const isModular = g('mu-type').value === 'modular';
    g('mu-modular-fields').style.display = isModular ? 'block' : 'none';
  };
  g('mu-type').addEventListener('change', toggleModular);
  toggleModular();
  g('mu-cancel').addEventListener('click', () => modal.classList.remove('show'));
  g('mu-save').addEventListener('click', () => {
    const supplier = g('mu-supplier').value.trim();
    const model = g('mu-model').value.trim();
    if (!supplier || !model) { alert('Заполните Производителя и Модель'); return; }
    const record = {
      id: makeUpsId(supplier, model),
      supplier, model,
      upsType: g('mu-type').value || 'monoblock',
      capacityKw: Number(g('mu-cap').value) || 0,
      efficiency: Number(g('mu-eff').value) || 95,
      cosPhi: Number(g('mu-cosphi').value) || 1,
      vdcMin: Number(g('mu-vdcmin').value) || 340,
      vdcMax: Number(g('mu-vdcmax').value) || 480,
      inputs: Number(g('mu-inputs').value) || 1,
      outputs: Number(g('mu-outputs').value) || 1,
      source: 'ручной ввод',
      importedAt: Date.now(),
      custom: true,
    };
    if (record.upsType === 'modular') {
      record.frameKw = Number(g('mu-frame').value) || 200;
      record.moduleKwRated = Number(g('mu-modkw').value) || 25;
      record.moduleSlots = Number(g('mu-slots').value) || 8;
    }
    addUps(record);
    modal.classList.remove('show');
    flash('Добавлено: ' + model, 'success');
    render();
  });
  modal.classList.add('show');
}

// ====================== Инициализация ======================
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('btn-add-manual');
  if (addBtn) addBtn.addEventListener('click', openManualModal);

  // Kehua UPS defaults — загружает ВСЮ линейку Kehua из каталога
  // 2024-10-22: KR-RM 10-40 kVA, Myria 60-200 kW, MR33 120-1200 kVA
  // (30/50/100K модули), FR-UK33 GEL, FR-UK33, KR33, KR33-H. Все
  // имеют флаг compatibleS3:true для совместимости с системой
  // Kehua S³ Li-Ion. Идемпотентно через upsert по id.
  const kehuaBtn = document.getElementById('btn-seed-kehua');
  if (kehuaBtn) kehuaBtn.addEventListener('click', () => {
    const n = KEHUA_MR33_UPSES.length;
    for (const rec of KEHUA_MR33_UPSES) {
      addUps({ ...rec, importedAt: Date.now() });
    }
    flash(`Загружено Kehua UPS: ${n} моделей`, 'success');
    render();
  });
  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник ИБП?')) return;
    clearCatalog();
    cascadeState.supplier = cascadeState.series = cascadeState.modelId = '';
    render();
    flash('Справочник очищен');
  });
  render();
});
