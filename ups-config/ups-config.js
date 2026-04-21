// ======================================================================
// ups-config.js
// Подпрограмма «Конфигуратор ИБП»: справочник моделей + каскадный пикер
// (Производитель → Серия → Модель), выбор модели, просмотр характеристик.
// Использует shared/ups-catalog.js и shared/ups-picker.js — та же логика
// будет применяться из инспектора ИБП главной схемы.
// ======================================================================

import { listUpses, addUps, removeUps, clearCatalog, makeUpsId } from '../shared/ups-catalog.js';
import { parseUpsXlsx, downloadCatalogTemplate } from '../shared/catalog-xlsx-parser.js';
import { mountUpsPicker, extractUpsSeries } from '../shared/ups-picker.js';
import { KEHUA_MR33_UPSES } from '../shared/kehua-mr33-data.js';
import { pricesForElement } from '../shared/price-records.js';

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
        <td style="white-space:nowrap">
          <button class="btn-sm" data-view="${esc(u.id)}" title="Показать карточку">👁 Просмотр</button>
          ${u.custom ? `<button class="btn-sm" data-edit="${esc(u.id)}" title="Редактировать запись">✎ Правка</button>` : ''}
          <button class="btn-sm" data-copy="${esc(u.id)}" title="Создать копию записи">⧉ Копия</button>
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
  wrap.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.view;
      const u = list.find(x => x.id === id);
      if (!u) return;
      cascadeState.supplier = u.supplier || '';
      cascadeState.series   = extractUpsSeries(u.model) || '';
      cascadeState.modelId  = id;
      render();
      const box = document.getElementById('selected-ups-details');
      if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  wrap.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.edit;
      const u = list.find(x => x.id === id);
      if (!u) return;
      const kind = u.kind || 'ups';
      if (kind !== 'ups') {
        alert('Редактирование записей типа «' + kind + '» через эту форму пока не поддерживается. Удалите и создайте заново.');
        return;
      }
      openManualModal(u);
    });
  });
  wrap.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.copy;
      const u = list.find(x => x.id === id);
      if (!u) return;
      const suggested = (u.model || '') + ' (копия)';
      const newModel = prompt('Название новой модели:', suggested);
      if (newModel == null) return;
      const trimmed = newModel.trim();
      if (!trimmed) { flash('Пустое имя модели', 'warn'); return; }
      const copy = {
        ...u,
        model: trimmed,
        id: makeUpsId(u.supplier, trimmed),
        source: 'копия: ' + (u.source || u.model || ''),
        importedAt: Date.now(),
        custom: true,
      };
      if (copy.id === u.id) {
        flash('Имя копии совпадает с оригиналом', 'warn');
        return;
      }
      addUps(copy);
      flash('Скопировано: ' + trimmed, 'success');
      cascadeState.modelId = copy.id;
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
      <div>Посадочных мест:</div><div><b>${u.rackSlots || '?'} блоков</b> макс.</div>
      <div>Макс. ёмкость блока:</div><div><b>${u.maxBlockAh || '?'} А·ч</b></div>
      <div>Полок:</div><div><b>${u.batteryLayers || '?'}</b></div>
      ${u.cabinetWidthMm ? `<div>Габариты (Ш×Г×В):</div><div><b>${u.cabinetWidthMm}×${u.cabinetDepthMm}×${u.cabinetHeightMm} мм</b></div>` : ''}
      ${u.cabinetWeightKg ? `<div>Масса (пустой):</div><div><b>${u.cabinetWeightKg} кг</b></div>` : ''}
      ${u.ipRating ? `<div>Степень защиты:</div><div>${esc(u.ipRating)}</div>` : ''}
      <div>Батареи:</div><div><span class="muted">VRLA/AGM GFM-series заказываются отдельно</span></div>`;
    // Таблица «Мест по ёмкости блока»
    if (u.rackSlotsByCap) {
      const caps = Object.entries(u.rackSlotsByCap).map(([k, v]) => `<span style="display:inline-block;padding:2px 8px;margin:2px;background:#eef4fb;border-radius:3px;font-size:11px">${esc(k)}: <b>${v}</b></span>`).join('');
      rows += `<div>Мест по ёмкости:</div><div>${caps}</div>`;
    }
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

  // Кнопка «Выбрать» — только для готовых ИБП (не для frame/module/battery).
  // В standalone-режиме (без nodeId в URL) — сохраняем в
  // raschet.lastUpsConfig.v1, откуда инспектор ИБП Конструктора схем
  // подхватит через кнопку «⬇ Применить из Конфигуратора».
  // В контексте конкретного узла (?nodeId=) — сразу пишем в
  // raschet.pendingUpsSelection.v1 (старый канал), и закрываем вкладку.
  const canApply = !(isFrame || isModule || isBattVrla || isBattS3);
  const urlNodeId = new URLSearchParams(location.search).get('nodeId');
  let applyBtnHtml = '';
  if (canApply) {
    if (urlNodeId) {
      applyBtnHtml = `
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <button id="sel-ups-apply-node" class="btn-sm btn-primary">✓ Применить к узлу на схеме</button>
          <span class="muted" style="font-size:11px">Модель будет применена к узлу ИБП и вкладка закроется.</span>
        </div>`;
    } else {
      applyBtnHtml = `
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button id="sel-ups-apply-standalone" class="btn-sm btn-primary">⬆ Выбрать эту модель</button>
          <span class="muted" style="font-size:11px">Сохранит модель. В Конструкторе схем откройте параметры ИБП и нажмите «⬇ Применить из Конфигуратора».</span>
        </div>`;
    }
  }

  box.innerHTML = `
    <h4>${esc(u.supplier)} · ${esc(u.model)}</h4>
    <div class="grid">${rows}</div>
    ${applyBtnHtml}
    ${(isFrame || isModule || isBattVrla || isBattS3) ? `
    <p class="muted" style="font-size:11px;margin-top:10px;padding:6px 10px;background:#fff8e1;border-left:3px solid #e65100;border-radius:3px">
      ℹ Это BOM-запись (${typeTitle.replace(/^[^\s]+\s/, '')}). Она не применяется к узлу ИБП напрямую, а используется для спецификации и сметы. Расчёт автономии для S³ шкафов ведётся через модули в справочнике АКБ.
    </p>` : ''}
  `;

  const btnNode = box.querySelector('#sel-ups-apply-node');
  if (btnNode) btnNode.addEventListener('click', () => {
    const payload = {
      nodeId: urlNodeId,
      ups: u,
      selectedAt: Date.now(),
    };
    try {
      localStorage.setItem('raschet.pendingUpsSelection.v1', JSON.stringify(payload));
      flash('Модель передана в Конструктор схем. Возврат…', 'success');
      setTimeout(() => { try { window.close(); } catch {} }, 1200);
    } catch (e) {
      flash('Не удалось передать модель: ' + (e.message || e), 'error');
    }
  });
  const btnStandalone = box.querySelector('#sel-ups-apply-standalone');
  if (btnStandalone) btnStandalone.addEventListener('click', () => {
    const payload = { ups: u, selectedAt: Date.now() };
    try {
      localStorage.setItem('raschet.lastUpsConfig.v1', JSON.stringify(payload));
      flash('Модель сохранена. Откройте Конструктор схем → параметры ИБП → «⬇ Применить из Конфигуратора».', 'success');
    } catch (e) {
      flash('Не удалось сохранить: ' + (e.message || e), 'error');
    }
  });
}

// ====================== Модалка ручного добавления / редактирования ======================
function openManualModal(existing) {
  const isEdit = !!(existing && existing.id);
  let modal = document.getElementById('manual-ups-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manual-ups-modal';
    modal.className = 'ups-modal';
    modal.innerHTML = `
      <div class="ups-modal-box">
        <div class="ups-modal-head">
          <h3 id="manual-ups-title">Добавить ИБП вручную</h3>
          <button class="ups-modal-close" aria-label="Закрыть">×</button>
        </div>
        <div class="ups-modal-body" id="manual-ups-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.ups-modal-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const titleEl = document.getElementById('manual-ups-title');
  if (titleEl) titleEl.textContent = isEdit ? 'Редактировать ИБП' : 'Добавить ИБП вручную';
  const v = (x, d) => (x == null || x === '' ? d : x);
  const src = existing || {};
  const body = document.getElementById('manual-ups-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>Производитель<input id="mu-supplier" type="text" placeholder="ABB" value="${esc(v(src.supplier, ''))}"></label>
      <label>Модель<input id="mu-model" type="text" placeholder="PowerWave 33 300 kW" value="${esc(v(src.model, ''))}"></label>
      <label>Тип
        <select id="mu-type">
          <option value="monoblock" ${src.upsType === 'modular' ? '' : 'selected'}>Моноблок</option>
          <option value="modular" ${src.upsType === 'modular' ? 'selected' : ''}>Модульный</option>
        </select>
      </label>
      <label>Номинал, kW<input id="mu-cap" type="number" min="1" step="1" value="${v(src.capacityKw, 100)}"></label>
      <label>КПД DC–AC, %<input id="mu-eff" type="number" min="50" max="99" step="1" value="${v(src.efficiency, 95)}"></label>
      <label>cos φ<input id="mu-cosphi" type="number" min="0.5" max="1" step="0.01" value="${v(src.cosPhi, 0.99)}"></label>
      <label>V<sub>DC</sub> min, В<input id="mu-vdcmin" type="number" min="24" max="1200" step="1" value="${v(src.vdcMin, 340)}"></label>
      <label>V<sub>DC</sub> max, В<input id="mu-vdcmax" type="number" min="24" max="1200" step="1" value="${v(src.vdcMax, 480)}"></label>
      <label>Входов<input id="mu-inputs" type="number" min="1" max="2" step="1" value="${v(src.inputs, 1)}"></label>
      <label>Выходов<input id="mu-outputs" type="number" min="1" max="20" step="1" value="${v(src.outputs, 1)}"></label>
      <div id="mu-modular-fields" style="display:none;grid-column:1/-1">
        <div class="form-grid">
          <label>Корпус, kW<input id="mu-frame" type="number" min="1" step="5" value="${v(src.frameKw, 200)}"></label>
          <label>Модуль, kW<input id="mu-modkw" type="number" min="1" step="1" value="${v(src.moduleKwRated, 25)}"></label>
          <label>Слотов в корпусе<input id="mu-slots" type="number" min="1" max="32" step="1" value="${v(src.moduleSlots, 8)}"></label>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mu-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mu-save" class="btn-sm btn-primary">${isEdit ? 'Сохранить' : 'Добавить'}</button>
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
    const newId = makeUpsId(supplier, model);
    const record = {
      ...(isEdit ? existing : {}),
      id: newId,
      supplier, model,
      upsType: g('mu-type').value || 'monoblock',
      capacityKw: Number(g('mu-cap').value) || 0,
      efficiency: Number(g('mu-eff').value) || 95,
      cosPhi: Number(g('mu-cosphi').value) || 1,
      vdcMin: Number(g('mu-vdcmin').value) || 340,
      vdcMax: Number(g('mu-vdcmax').value) || 480,
      inputs: Number(g('mu-inputs').value) || 1,
      outputs: Number(g('mu-outputs').value) || 1,
      source: isEdit ? (existing.source || 'ручной ввод') : 'ручной ввод',
      importedAt: Date.now(),
      custom: true,
    };
    if (record.upsType === 'modular') {
      record.frameKw = Number(g('mu-frame').value) || 200;
      record.moduleKwRated = Number(g('mu-modkw').value) || 25;
      record.moduleSlots = Number(g('mu-slots').value) || 8;
    } else {
      delete record.frameKw;
      delete record.moduleKwRated;
      delete record.moduleSlots;
    }
    // Если id сменился (переименование) — убираем старую запись
    if (isEdit && existing.id !== newId) {
      removeUps(existing.id);
    }
    addUps(record);
    if (isEdit && cascadeState.modelId === existing.id) {
      cascadeState.modelId = newId;
    }
    modal.classList.remove('show');
    flash(isEdit ? ('Сохранено: ' + model) : ('Добавлено: ' + model), 'success');
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
  // Импорт XLSX — плоская таблица моделей, см. shared/catalog-xlsx-parser.js
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
          const records = parseUpsXlsx(buf, f.name);
          for (const rec of records) { addUps(rec); added++; }
        } catch (e) {
          errors.push(`${f.name}: ${e.message || e}`);
        }
      }
      importInput.value = '';
      render();
      if (errors.length) {
        flash(`Импортировано ${added}. Ошибок: ${errors.length}`, 'warn');
        console.warn('[ups-config] xlsx import errors:', errors);
      } else {
        flash(`Импортировано ${added} записей ИБП`, 'success');
      }
    });
  }

  // Скачать шаблон XLSX
  const tplBtn = document.getElementById('btn-template-xlsx');
  if (tplBtn) tplBtn.addEventListener('click', () => {
    try { downloadCatalogTemplate('ups'); flash('Шаблон скачан', 'success'); }
    catch (e) { flash('Ошибка: ' + (e.message || e), 'error'); }
  });

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

  // ====================== Интеграция с Конструктором схем (Фаза 1.4.5) ======================
  // Если страница открыта из инспектора ИБП (?nodeId=), запускаем
  // WIZARD конфигуратора вместо показа одного справочника.
  initWizard();
});

// ====================== WIZARD конфигуратора ======================
const wizState = {
  nodeId: null,
  requirements: {
    loadKw: 10,
    autonomyMin: 15,
    redundancy: 'N',
    upsType: '',
    vdcMin: 340,
    vdcMax: 480,
    cosPhi: 0.9,
    phases: 3,
  },
  selected: null, // выбранный фрейм/модель из справочника
  composition: null, // рассчитанная конфигурация
};

function initWizard() {
  const qp = new URLSearchParams(location.search);
  const ctxNodeId = qp.get('nodeId');
  if (!ctxNodeId) return; // обычный режим справочника

  wizState.nodeId = ctxNodeId;
  // Предзаполнение из query
  const rq = wizState.requirements;
  if (qp.get('capacityKw')) rq.loadKw = Number(qp.get('capacityKw')) || rq.loadKw;
  if (qp.get('targetAutonomyMin')) rq.autonomyMin = Number(qp.get('targetAutonomyMin')) || rq.autonomyMin;
  if (qp.get('redundancy')) rq.redundancy = qp.get('redundancy');
  if (qp.get('upsType')) rq.upsType = qp.get('upsType');
  if (qp.get('vdcMin')) rq.vdcMin = Number(qp.get('vdcMin')) || rq.vdcMin;
  if (qp.get('vdcMax')) rq.vdcMax = Number(qp.get('vdcMax')) || rq.vdcMax;
  if (qp.get('cosPhi')) rq.cosPhi = Number(qp.get('cosPhi')) || rq.cosPhi;
  if (qp.get('phases')) rq.phases = Number(qp.get('phases')) || rq.phases;

  // Показываем wizard, заполняем поля
  const wizard = document.getElementById('configurator-wizard');
  if (!wizard) return;
  wizard.style.display = '';
  _fillWizStep1Fields();

  // Скрываем «Выбранная модель» (она дублирует шаг 2)
  const selectedPanel = document.getElementById('selected-ups-details');
  if (selectedPanel) selectedPanel.closest('.panel').style.display = 'none';

  // Кнопки wizard'а
  document.getElementById('wiz-btn-cancel').onclick = () => {
    if (confirm('Отменить конфигурирование?')) { try { window.close(); } catch {} }
  };
  document.getElementById('wiz-btn-next-1').onclick = _goStep2;
  document.getElementById('wiz-btn-back-2').onclick = () => _showStep(1);
  document.getElementById('wiz-btn-next-2').onclick = _goStep3;
  document.getElementById('wiz-btn-back-3').onclick = () => _showStep(2);
  document.getElementById('wiz-btn-apply').onclick = _applyConfiguration;
  _showStep(1);
}

function _fillWizStep1Fields() {
  const rq = wizState.requirements;
  document.getElementById('wiz-loadKw').value = rq.loadKw;
  document.getElementById('wiz-autonomy').value = rq.autonomyMin;
  document.getElementById('wiz-redundancy').value = rq.redundancy;
  document.getElementById('wiz-upsType').value = rq.upsType || '';
  document.getElementById('wiz-vdcMin').value = rq.vdcMin;
  document.getElementById('wiz-vdcMax').value = rq.vdcMax;
  document.getElementById('wiz-cosPhi').value = rq.cosPhi;
  document.getElementById('wiz-phases').value = rq.phases;
}

function _showStep(n) {
  [1, 2, 3].forEach(i => {
    const s = document.getElementById('wiz-step-' + i);
    if (s) s.style.display = (i === n) ? '' : 'none';
  });
  const ind = document.getElementById('wiz-step-indicator');
  if (ind) ind.textContent = 'Шаг ' + n + ' из 3';
}

function _readStep1() {
  const rq = wizState.requirements;
  rq.loadKw = Number(document.getElementById('wiz-loadKw').value) || rq.loadKw;
  rq.autonomyMin = Number(document.getElementById('wiz-autonomy').value) || 0;
  rq.redundancy = document.getElementById('wiz-redundancy').value;
  rq.upsType = document.getElementById('wiz-upsType').value;
  rq.vdcMin = Number(document.getElementById('wiz-vdcMin').value) || rq.vdcMin;
  rq.vdcMax = Number(document.getElementById('wiz-vdcMax').value) || rq.vdcMax;
  rq.cosPhi = Number(document.getElementById('wiz-cosPhi').value) || rq.cosPhi;
  rq.phases = Number(document.getElementById('wiz-phases').value) || 3;
}

// ====================== Шаг 2: Подбор ======================
// Парсит схему резервирования N/N+1/N+2/2N → { mode, x }
function _parseRedundancy(scheme) {
  if (scheme === '2N') return { mode: '2N', x: 0 };
  const m = /^N(?:\+(\d+))?$/.exec(scheme || 'N');
  return { mode: 'N+X', x: m ? Number(m[1] || 0) : 0 };
}

// Вычисляет число рабочих модулей + резерв для модульного ИБП
function _calcModules(loadKw, moduleKw, moduleSlots, redundancy) {
  const r = _parseRedundancy(redundancy);
  const working = Math.ceil(loadKw / moduleKw);
  let installed;
  if (r.mode === '2N') installed = working * 2;
  else installed = working + r.x;
  const fits = installed <= moduleSlots;
  return { working, redundant: r.x, installed, fits, redundancyLabel: redundancy };
}

function _pickSuitable() {
  const rq = wizState.requirements;
  const catalog = listUpses();
  const out = [];
  const r = _parseRedundancy(rq.redundancy);
  for (const u of catalog) {
    // Фильтр по типу (если указан)
    if (rq.upsType && u.upsType !== rq.upsType) continue;
    // Фильтр по Vdc (диапазон ИБП должен пересекаться с требуемым)
    if (u.vdcMax && u.vdcMin) {
      if (u.vdcMax < rq.vdcMin || u.vdcMin > rq.vdcMax) continue;
    }
    let fits = false;
    let fitInfo = null;
    if (u.upsType === 'modular') {
      if (!u.moduleKwRated || !u.moduleSlots) continue;
      const mc = _calcModules(rq.loadKw, u.moduleKwRated, u.moduleSlots, rq.redundancy);
      if (!mc.fits) continue;
      fits = true;
      const realCapacity = mc.working * u.moduleKwRated;
      fitInfo = { ...mc, realCapacity, usable: mc.working * u.moduleKwRated };
    } else {
      // Моноблок: capacity * N ≥ loadKw с учётом резерва
      const cap = Number(u.capacityKw) || 0;
      if (cap <= 0) continue;
      let requiredQty = 1;
      if (r.mode === '2N') requiredQty = 2;
      else requiredQty = Math.ceil(rq.loadKw / cap) + r.x;
      if (cap * (requiredQty - r.x) >= rq.loadKw) {
        fits = true;
        fitInfo = { working: requiredQty - r.x, redundant: r.x, installed: requiredQty, realCapacity: cap, usable: cap * (requiredQty - r.x) };
      }
    }
    if (fits) out.push({ ups: u, fitInfo });
  }
  // Сортировка: сначала модульные, потом по утилизации
  out.sort((a, b) => {
    const aUtil = a.fitInfo.usable / (a.ups.frameKw || a.fitInfo.usable);
    const bUtil = b.fitInfo.usable / (b.ups.frameKw || b.fitInfo.usable);
    return bUtil - aUtil;
  });
  return out;
}

function _goStep2() {
  _readStep1();
  const rq = wizState.requirements;
  if (rq.loadKw <= 0) { flash('Укажите нагрузку > 0', 'warn'); return; }
  const suitable = _pickSuitable();
  const list = document.getElementById('wiz-suitable-list');
  if (!suitable.length) {
    list.innerHTML = `
      <div class="suitable-list">
        <div class="empty" style="padding:30px;text-align:center">
          Подходящих моделей не найдено.<br>
          Добавьте модели в справочник (кнопка «Kehua UPS» или импорт XLSX),
          либо смягчите требования (уменьшите нагрузку / уберите фильтр по типу).
        </div>
      </div>`;
    document.getElementById('wiz-btn-next-2').disabled = true;
    _showStep(2);
    return;
  }
  const html = ['<div class="suitable-list">'];
  suitable.forEach(({ ups, fitInfo }, idx) => {
    const priceInfo = pricesForElement(ups.id);
    const priceStr = priceInfo.latest
      ? Number(priceInfo.latest.price).toLocaleString('ru-RU') + ' ' + priceInfo.latest.currency
      : '—';
    const isRec = idx === 0 ? ' recommended' : '';
    const typeLabel = ups.upsType === 'modular' ? 'Модульный' : 'Моноблок';
    const calcText = ups.upsType === 'modular'
      ? `${fitInfo.working}×${ups.moduleKwRated}kW (работа) + ${fitInfo.redundant}×${ups.moduleKwRated}kW (резерв) = ${fitInfo.installed}/${ups.moduleSlots} слотов`
      : `${fitInfo.installed} × ${fitInfo.realCapacity}kW (${fitInfo.working} работа + ${fitInfo.redundant} резерв)`;
    html.push(`
      <div class="suitable-item${isRec}" data-id="${esc(ups.id)}" data-idx="${idx}">
        <div class="suitable-main">
          <div class="suitable-title">${esc(ups.supplier || '')} ${esc(ups.model || ups.id)} <span class="muted" style="font-size:11px">· ${typeLabel}</span></div>
          <div class="suitable-meta">
            ${ups.upsType === 'modular'
              ? `Frame ${ups.frameKw}kW · модуль ${ups.moduleKwRated}kW × ${ups.moduleSlots} слотов`
              : `${ups.capacityKw}kW, КПД ${ups.efficiency}%`}
            · V<sub>DC</sub> ${ups.vdcMin}–${ups.vdcMax}V · Цена ${priceStr}
          </div>
        </div>
        <div class="suitable-calc">${calcText}</div>
      </div>`);
  });
  html.push('</div>');
  list.innerHTML = html.join('');
  list.querySelectorAll('.suitable-item').forEach(item => {
    item.onclick = () => {
      list.querySelectorAll('.suitable-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      const idx = Number(item.dataset.idx);
      wizState.selected = suitable[idx];
      document.getElementById('wiz-btn-next-2').disabled = false;
    };
  });
  // Авто-выбор первого (рекомендованного)
  if (suitable[0]) {
    list.querySelector('.suitable-item')?.click();
  }
  _showStep(2);
}

// ====================== Шаг 3: Итог ======================
function _buildComposition() {
  const sel = wizState.selected;
  const rq = wizState.requirements;
  if (!sel) return null;
  const { ups, fitInfo } = sel;
  const composition = [];
  // Корень — сам ИБП (фрейм)
  if (ups.upsType === 'modular') {
    // Фрейм + модули. Фрейм — сам ups. Модули — phantom-child.
    // В текущей архитектуре модули хранятся как число (moduleInstalled) —
    // формальной отдельной записи модуля в каталоге пока нет. В будущем
    // модули станут отдельными Element'ами (1.5.8+).
    composition.push({
      elementId: ups.id,
      qty: 1,
      role: 'frame',
      label: ups.supplier + ' ' + ups.model + ' (фрейм)',
    });
    // Информационно:
    composition.push({
      elementId: null,
      inline: true,
      qty: fitInfo.installed,
      role: 'module',
      label: `Силовой модуль ${ups.moduleKwRated}kW (${fitInfo.working} раб + ${fitInfo.redundant} резерв)`,
    });
  } else {
    composition.push({
      elementId: ups.id,
      qty: fitInfo.installed,
      role: fitInfo.redundant ? 'active+standby' : 'active',
      label: ups.supplier + ' ' + ups.model,
    });
  }
  // Цена
  const priceInfo = pricesForElement(ups.id);
  const unitPrice = priceInfo.latest ? Number(priceInfo.latest.price) : null;
  const currency = priceInfo.latest ? priceInfo.latest.currency : null;
  const totalPrice = unitPrice != null ? unitPrice * fitInfo.installed : null;

  return {
    frameId: ups.id,
    ups, fitInfo,
    composition,
    unitPrice, currency, totalPrice,
    requirements: { ...rq },
  };
}

function _goStep3() {
  const comp = _buildComposition();
  if (!comp) { flash('Не выбрана модель', 'warn'); return; }
  wizState.composition = comp;
  const rq = wizState.requirements;
  const u = comp.ups;
  const fi = comp.fitInfo;
  const priceStr = comp.totalPrice != null
    ? Number(comp.totalPrice).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + comp.currency
    : 'не указана';
  const summary = document.getElementById('wiz-summary');
  summary.innerHTML = `
    <div class="wiz-summary-box">
      <h5>Исходные требования</h5>
      <table class="wiz-summary-table">
        <tr><td>Нагрузка</td><td>${rq.loadKw} kW</td></tr>
        <tr><td>Автономия</td><td>${rq.autonomyMin} мин</td></tr>
        <tr><td>Резервирование</td><td>${rq.redundancy}</td></tr>
        <tr><td>Тип</td><td>${rq.upsType || 'любой'}</td></tr>
        <tr><td>V<sub>DC</sub></td><td>${rq.vdcMin}–${rq.vdcMax} В</td></tr>
        <tr><td>cos φ / фазы</td><td>${rq.cosPhi} / ${rq.phases}ph</td></tr>
      </table>
    </div>
    <div class="wiz-summary-box">
      <h5>Подобранная конфигурация</h5>
      <table class="wiz-summary-table">
        <tr><td>Модель</td><td>${esc(u.supplier || '')} ${esc(u.model || u.id)}</td></tr>
        <tr><td>Тип</td><td>${u.upsType === 'modular' ? 'Модульный' : 'Моноблок'}</td></tr>
        ${u.upsType === 'modular' ? `
          <tr><td>Корпус (frame)</td><td>${u.frameKw} kW</td></tr>
          <tr><td>Модуль</td><td>${u.moduleKwRated} kW</td></tr>
          <tr><td>Установлено модулей</td><td>${fi.installed} из ${u.moduleSlots}</td></tr>
          <tr><td>Рабочих модулей</td><td>${fi.working}</td></tr>
          <tr><td>Резерв</td><td>${fi.redundant}</td></tr>
          <tr><td>Реальная мощность</td><td>${fi.realCapacity} kW</td></tr>
        ` : `
          <tr><td>Мощность ед.</td><td>${u.capacityKw} kW</td></tr>
          <tr><td>Количество ИБП</td><td>${fi.installed}</td></tr>
          <tr><td>Итоговая мощность</td><td>${fi.usable} kW</td></tr>
        `}
        <tr><td>КПД</td><td>${u.efficiency}%</td></tr>
        <tr><td>V<sub>DC</sub></td><td>${u.vdcMin}–${u.vdcMax} В</td></tr>
      </table>
    </div>
    <div class="wiz-summary-box">
      <h5>Стоимость (оборудование ИБП)</h5>
      <table class="wiz-summary-table">
        <tr><td>Цена за ед.</td><td>${comp.unitPrice != null ? Number(comp.unitPrice).toLocaleString('ru-RU') + ' ' + comp.currency : 'нет в каталоге'}</td></tr>
        <tr><td>Количество</td><td>${fi.installed}</td></tr>
        <tr><td><b>Итого ИБП</b></td><td><b>${priceStr}</b></td></tr>
      </table>
      <p class="muted" style="font-size:11px;margin:8px 0 0">
        АКБ подбирается отдельно в «Калькуляторе АКБ» (кнопка в инспекторе батарей).
        Цены добавляются в модуле <a href="../catalog/" target="_blank">«Каталог и цены»</a>.
      </p>
    </div>
  `;
  _showStep(3);
}

function _applyConfiguration() {
  const comp = wizState.composition;
  if (!comp) return flash('Нет конфигурации для применения', 'error');
  const u = comp.ups;
  const fi = comp.fitInfo;
  const rq = wizState.requirements;

  // Формируем payload для Constructor. Расширяем старый формат
  // raschet.pendingUpsSelection.v1 новыми полями composition + config.
  const payload = {
    nodeId: wizState.nodeId,
    ups: u, // для backward-compat с applyUpsModel
    configuration: {
      frameId: u.id,
      upsType: u.upsType,
      capacityKw: fi.realCapacity || fi.usable,
      moduleInstalled: fi.installed,
      moduleWorking: fi.working,
      moduleRedundant: fi.redundant,
      frameKw: u.frameKw,
      moduleKwRated: u.moduleKwRated,
      moduleSlots: u.moduleSlots,
      redundancyScheme: rq.redundancy,
      batteryVdcMin: rq.vdcMin,
      batteryVdcMax: rq.vdcMax,
      batteryAutonomyMin: rq.autonomyMin,
      composition: comp.composition,
      totalPrice: comp.totalPrice,
      currency: comp.currency,
    },
    selectedAt: Date.now(),
  };
  try {
    localStorage.setItem('raschet.pendingUpsSelection.v1', JSON.stringify(payload));
    flash('Конфигурация передана. Возврат в Конструктор схем…', 'success');
    setTimeout(() => { try { window.close(); } catch {} }, 1500);
  } catch (e) {
    flash('Не удалось передать конфигурацию: ' + (e.message || e), 'error');
  }
}
