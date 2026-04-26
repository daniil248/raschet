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
import { KEHUA_MR33_UPSES } from '../shared/catalogs/ups-kehua-mr33.js';
// v0.59.385: типы ИБП — плагин-архитектура. Чтобы добавить новый тип
// (моноблок/модульный/интегрированный/...), создайте файл в
// shared/ups-types/ и зарегистрируйте его в shared/ups-types/index.js.
import { listUpsTypes, getUpsType, detectUpsType, getUpsTypeOrFallback } from '../shared/ups-types/index.js';
import { pricesForElement } from '../shared/price-records.js';
import { rsToast, rsConfirm, rsPrompt } from '../shared/dialog.js';
import { wireExportImport } from '../shared/config-io.js';
import { APP_VERSION } from '../js/engine/constants.js';

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
  renderPendingBanner();
}

// Индикатор standalone-выбора: показывает какая модель сейчас лежит в
// raschet.lastUpsConfig.v1 и ждёт применения в Конструкторе схем.
// Виден только в standalone-режиме (без ?nodeId=), чтобы пользователь
// видел, что выбор произведён даже после reload страницы.
function renderPendingBanner() {
  if (new URLSearchParams(location.search).get('nodeId')) return; // в wizard-режиме не нужно
  let el = document.getElementById('pending-standalone-banner');
  let last = null;
  try {
    const raw = localStorage.getItem('raschet.lastUpsConfig.v1');
    if (raw) last = JSON.parse(raw);
  } catch {}
  const fresh = last?.ups && last.selectedAt && (Date.now() - last.selectedAt) < 24 * 60 * 60 * 1000;
  if (!fresh) {
    if (el) el.remove();
    return;
  }
  const ageMin = Math.round((Date.now() - last.selectedAt) / 60000);
  const ageStr = ageMin < 60 ? (ageMin + ' мин назад') : (Math.round(ageMin / 60) + ' ч назад');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pending-standalone-banner';
    el.style.cssText = 'margin:0 0 14px;padding:10px 14px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const intro = document.querySelector('.page-intro');
    if (intro) intro.after(el); else document.querySelector('main')?.prepend(el);
  }
  const cfg = last.configuration;
  const cfgHint = cfg
    ? `<span class="muted" style="font-size:11px">· ${cfg.capacityKw || '?'} kW · резерв ${esc(cfg.redundancyScheme || 'N')}${Number.isFinite(cfg.batteryAutonomyMin) ? ' · автономия ' + cfg.batteryAutonomyMin + ' мин' : ''}</span>`
    : '';
  el.innerHTML = `
    <span>✓ Сейчас выбрано: <b>${esc(last.ups.supplier || '')} · ${esc(last.ups.model || '')}</b>
      <span class="muted" style="font-size:11px">(${ageStr})</span>
      ${cfgHint}</span>
    <span class="muted" style="font-size:11px;flex:1;min-width:200px">В Конструкторе схем → параметры ИБП → «⬇ Применить из Конфигуратора».</span>
    <button id="pending-banner-clear" class="btn-sm">✕ Сбросить</button>
  `;
  const btn = el.querySelector('#pending-banner-clear');
  if (btn) btn.addEventListener('click', () => {
    try { localStorage.removeItem('raschet.lastUpsConfig.v1'); } catch {}
    renderPendingBanner();
    flash('Сброшено');
  });
}

// Периодически обновляем «X мин назад» каждую минуту
setInterval(() => { try { renderPendingBanner(); } catch {} }, 60000);

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
  const kindIcon = (k, u) => {
    switch (k) {
      case 'frame':              return '📦';
      case 'power-module':       return '🔌';
      case 'batt-cabinet-vrla':  return '🔋';
      case 'batt-cabinet-s3':    return '🏛';
      default: {
        // Готовый ИБП — иконка из плагина типа
        const t = detectUpsType(u);
        return (t && t.icon) || '⚡';
      }
    }
  };
  const kindLabel = (u) => {
    const k = u.kind || 'ups';
    if (k === 'frame')             return 'Фрейм';
    if (k === 'power-module')      return 'Силовой модуль';
    if (k === 'batt-cabinet-vrla') return 'Шкаф VRLA';
    if (k === 'batt-cabinet-s3')   return 'Шкаф S³';
    // Готовый ИБП — short-label из плагина типа
    const t = detectUpsType(u);
    return (t && t.shortLabel) || 'ИБП';
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
        <td style="text-align:center;font-size:14px" title="${esc(kindLabel(u))}">${kindIcon(k, u)}</td>
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
    btn.addEventListener('click', async () => {
      if (!(await rsConfirm('Удалить эту запись?', '', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
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
        rsToast('Редактирование записей типа «' + kind + '» через эту форму пока не поддерживается. Удалите и создайте заново.', 'warn');
        return;
      }
      openManualModal(u);
    });
  });
  wrap.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.copy;
      const u = list.find(x => x.id === id);
      if (!u) return;
      const suggested = (u.model || '') + ' (копия)';
      const newModel = await rsPrompt('Название новой модели:', suggested);
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
  else {
    const t = getUpsTypeOrFallback(u);
    typeTitle = (t.icon || '⚡') + ' ' + t.shortLabel;
  }

  let rows = `<div>Тип записи:</div><div><b>${typeTitle}</b></div>`;
  if (!isFrame && !isModule && !isBattVrla && !isBattS3) {
    // Готовый ИБП — общие поля + типо-специфичные строки из плагина.
    const t = getUpsTypeOrFallback(u);
    const typedRows = t.detailRowsHtml ? t.detailRowsHtml(u) : '';
    rows += `
      <div>Номинал:</div><div><b>${fmt(u.capacityKw)} kW</b></div>
      ${typedRows}
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
      renderPendingBanner();
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
  // v0.59.385: тип-плагин из реестра. Опции в dropdown собираются динамически.
  const types = listUpsTypes();
  const initialType = detectUpsType(src) || types[0];
  const typeOptionsHtml = types.map(t =>
    `<option value="${esc(t.id)}" ${t.id === initialType.id ? 'selected' : ''}>${esc(t.label)}</option>`
  ).join('');
  body.innerHTML = `
    <div class="form-grid">
      <label>Производитель<input id="mu-supplier" type="text" placeholder="ABB" value="${esc(v(src.supplier, ''))}"></label>
      <label>Модель<input id="mu-model" type="text" placeholder="PowerWave 33 300 kW" value="${esc(v(src.model, ''))}"></label>
      <label>Тип
        <select id="mu-type">${typeOptionsHtml}</select>
      </label>
      <label>Номинал, kW<input id="mu-cap" type="number" min="1" step="1" value="${v(src.capacityKw, 100)}"></label>
      <label>КПД DC–AC, %<input id="mu-eff" type="number" min="50" max="99" step="1" value="${v(src.efficiency, 95)}"></label>
      <label>cos φ<input id="mu-cosphi" type="number" min="0.5" max="1" step="0.01" value="${v(src.cosPhi, 0.99)}"></label>
      <label>V<sub>DC</sub> min, В<input id="mu-vdcmin" type="number" min="24" max="1200" step="1" value="${v(src.vdcMin, 340)}"></label>
      <label>V<sub>DC</sub> max, В<input id="mu-vdcmax" type="number" min="24" max="1200" step="1" value="${v(src.vdcMax, 480)}"></label>
      <label>Входов<input id="mu-inputs" type="number" min="1" max="2" step="1" value="${v(src.inputs, 1)}"></label>
      <label>Выходов<input id="mu-outputs" type="number" min="1" max="20" step="1" value="${v(src.outputs, 1)}"></label>
      <div id="mu-typed-fields" style="grid-column:1/-1">
        <div class="form-grid"></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mu-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mu-save" class="btn-sm btn-primary">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;
  const g = id => document.getElementById(id);
  const typedWrap = body.querySelector('#mu-typed-fields .form-grid');
  // Рендер доп. полей выбранного типа
  const renderTypedFields = () => {
    const t = getUpsType(g('mu-type').value) || types[0];
    typedWrap.innerHTML = t.formFieldsHtml ? t.formFieldsHtml(src) : '';
  };
  g('mu-type').addEventListener('change', renderTypedFields);
  renderTypedFields();
  g('mu-cancel').addEventListener('click', () => modal.classList.remove('show'));
  g('mu-save').addEventListener('click', () => {
    const supplier = g('mu-supplier').value.trim();
    const model = g('mu-model').value.trim();
    if (!supplier || !model) { rsToast('Заполните Производителя и Модель', 'warn'); return; }
    const newId = makeUpsId(supplier, model);
    const t = getUpsType(g('mu-type').value) || types[0];
    // Базовая часть (общие поля)
    let record = {
      ...(isEdit ? existing : {}),
      id: newId,
      supplier, model,
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
    // Сначала: если тип сменился — очищаем поля старого типа.
    if (isEdit) {
      const oldType = detectUpsType(existing);
      if (oldType && oldType.id !== t.id) {
        ['frameKw', 'moduleKwRated', 'moduleSlots',
         'hasIntegratedAts', 'pdmModules',
         'cabinetWidthMm', 'cabinetDepthMm', 'cabinetHeightMm',
        ].forEach(k => delete record[k]);
        delete record.kind;
      }
    }
    // Применяем дефолты типа (только то, чего нет)
    const defs = t.defaults ? t.defaults() : {};
    for (const k of Object.keys(defs)) {
      if (record[k] == null) record[k] = defs[k];
    }
    // Записываем типо-специфичные поля из формы
    const getField = name => typedWrap.querySelector(`[data-ut-field="${name}"]`)?.value;
    const patch = t.readForm ? t.readForm(getField, typedWrap) : {};
    record = { ...record, ...patch };
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

  const wizBtn = document.getElementById('btn-wizard-standalone');
  if (wizBtn) wizBtn.addEventListener('click', launchStandaloneWizard);

  // v0.59.365: экспорт/импорт конфигурации в JSON.
  wireExportImport({
    exportBtn: document.getElementById('uc-export-config'),
    importBtn: document.getElementById('uc-import-config'),
    fileInput: document.getElementById('uc-import-file'),
    schema: 'raschet.ups-config.v1',
    lsKeys: ['raschet.lastUpsConfig.v1', 'raschet.pendingUpsSelection.v1'],
    filenamePrefix: 'ups-config',
    appVersion: APP_VERSION,
    toast: (m, t) => rsToast(m, t === 'err' ? 'error' : (t === 'ok' ? 'success' : 'info')),
  });

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
  if (clrBtn) clrBtn.addEventListener('click', async () => {
    if (!(await rsConfirm('Очистить весь справочник ИБП?', 'Действие нельзя отменить.', { okLabel: 'Очистить', cancelLabel: 'Отмена' }))) return;
    clearCatalog();
    cascadeState.supplier = cascadeState.series = cascadeState.modelId = '';
    render();
    flash('Справочник очищен');
  });
  render();

  // ====================== Интеграция с Конструктором схем (Фаза 1.4.5) ======================
  // Если страница открыта из инспектора ИБП (?nodeId=), запускаем
  // WIZARD конфигуратора вместо показа одного справочника.
  // Если открыта standalone (без nodeId) — всё равно показываем wizard
  // сразу на шаге 1, чтобы модуль работал как КОНФИГУРАТОР, а не только
  // как каталог. Каталог остаётся ниже как справочник.
  const startedViaNode = initWizard();
  if (!startedViaNode) {
    try { launchStandaloneWizard(); } catch (e) { console.warn('[ups-config] auto-wizard', e); }
  }
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
  if (!ctxNodeId) return false; // standalone-режим запускается отдельно

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

  _openWizard({ standalone: false });
  return true;
}

// Запуск wizard в standalone-режиме: без ?nodeId=, inline-оверлей над
// справочником. Результат уходит в raschet.lastUpsConfig.v1 вместе с
// полным «configuration» (не только ups-моделью, но и composition,
// installed/working/redundant, capacityKw реальный). Инспектор ИБП в
// Конструкторе схем это всё применит.
function launchStandaloneWizard() {
  wizState.nodeId = null; // маркер standalone
  _openWizard({ standalone: true });
  // Прокрутить к wizard, чтобы пользователь его сразу увидел
  const wizard = document.getElementById('configurator-wizard');
  if (wizard && wizard.scrollIntoView) wizard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _openWizard({ standalone }) {
  const wizard = document.getElementById('configurator-wizard');
  if (!wizard) return;
  wizard.style.display = '';
  _fillWizStep1Fields();

  // В standalone-режиме справочник и «Выбранная модель» остаются видимыми:
  // пользователь может параллельно смотреть каталог. В node-targeted
  // режиме — скрываем «Выбранная модель», чтобы не дублировать с wizard.
  const selectedPanel = document.getElementById('selected-ups-details');
  if (selectedPanel) {
    selectedPanel.closest('.panel').style.display = standalone ? '' : 'none';
  }

  // Меняем подзаголовок / подсказку шага 1 в зависимости от режима
  const wiz1 = document.getElementById('wiz-step-1');
  if (wiz1) {
    const sub = wiz1.querySelector('p.muted');
    if (sub) sub.textContent = standalone
      ? 'Введите требования — мощность нагрузки и время автономии. Мастер выберет подходящие модели из справочника.'
      : 'Параметры переданы из Конструктора схем. Можно подправить.';
  }
  // Кнопка «Применить» на шаге 3 в standalone меняет текст
  const applyBtn = document.getElementById('wiz-btn-apply');
  if (applyBtn) applyBtn.textContent = standalone
    ? '✓ Выбрать эту конфигурацию'
    : '✓ Применить к схеме';

  // Кнопки wizard'а (переназначаем onclick, чтобы смена режима не ломала)
  document.getElementById('wiz-btn-cancel').onclick = async () => {
    if (standalone) {
      wizard.style.display = 'none';
      if (selectedPanel) selectedPanel.closest('.panel').style.display = '';
    } else if (await rsConfirm('Отменить конфигурирование?', '', { okLabel: 'Отменить', cancelLabel: 'Продолжить' })) {
      try { window.close(); } catch {}
    }
  };
  document.getElementById('wiz-btn-next-1').onclick = _goStep2;
  document.getElementById('wiz-btn-back-2').onclick = () => _showStep(1);
  document.getElementById('wiz-btn-next-2').onclick = _goStep3;
  document.getElementById('wiz-btn-back-3').onclick = () => _showStep(2);
  // v0.59.400: шаг 3 — выбор АКБ или пропустить, шаг 4 — итог.
  const skipBtn = document.getElementById('wiz-btn-skip-batt');
  const pickBtn = document.getElementById('wiz-btn-pick-batt');
  const next3Btn = document.getElementById('wiz-btn-next-3');
  const back4Btn = document.getElementById('wiz-btn-back-4');
  if (skipBtn) skipBtn.onclick = () => { wizState.batteryChoice = 'skip'; if (next3Btn) next3Btn.disabled = false; _renderBatteryInfo(); _goStep4(); };
  if (pickBtn) pickBtn.onclick = _openBatteryPicker;
  if (next3Btn) next3Btn.onclick = _goStep4;
  if (back4Btn) back4Btn.onclick = () => _showStep(3);
  document.getElementById('wiz-btn-apply').onclick = _applyConfiguration;
  _showStep(1);
}

function _fillWizStep1Fields() {
  const rq = wizState.requirements;
  document.getElementById('wiz-loadKw').value = rq.loadKw;
  document.getElementById('wiz-autonomy').value = rq.autonomyMin;
  // v0.59.385: опции «Тип» в wizard'е собираются из реестра типов.
  const typeSel = document.getElementById('wiz-upsType');
  if (typeSel) {
    const opts = ['<option value="">Любой</option>'];
    for (const t of listUpsTypes()) {
      opts.push(`<option value="${esc(t.id)}">${esc(t.label)}</option>`);
    }
    typeSel.innerHTML = opts.join('');
  }
  document.getElementById('wiz-upsType').value = rq.upsType || '';
  document.getElementById('wiz-cosPhi').value = rq.cosPhi;
  document.getElementById('wiz-phases').value = rq.phases;
  // v0.59.400: резервирование выехало на шаг 2.
  const redSel = document.getElementById('wiz-redundancy');
  if (redSel) redSel.value = rq.redundancy;
}

function _showStep(n) {
  [1, 2, 3, 4].forEach(i => {
    const s = document.getElementById('wiz-step-' + i);
    if (s) s.style.display = (i === n) ? '' : 'none';
  });
  const ind = document.getElementById('wiz-step-indicator');
  if (ind) ind.textContent = 'Шаг ' + n + ' из 4';
}

function _readStep1() {
  const rq = wizState.requirements;
  rq.loadKw = Number(document.getElementById('wiz-loadKw').value) || rq.loadKw;
  rq.autonomyMin = Number(document.getElementById('wiz-autonomy').value) || 0;
  rq.upsType = document.getElementById('wiz-upsType').value;
  rq.cosPhi = Number(document.getElementById('wiz-cosPhi').value) || rq.cosPhi;
  rq.phases = Number(document.getElementById('wiz-phases').value) || 3;
}

// v0.59.400: чтение фильтров и резервирования с шага 2.
function _readStep2() {
  const rq = wizState.requirements;
  const redSel = document.getElementById('wiz-redundancy');
  if (redSel) rq.redundancy = redSel.value || 'N';
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
  for (const u of catalog) {
    // Распознаём тип-плагин записи. Записи без типа (frame/module/batt-*) — пропускаем.
    const t = detectUpsType(u);
    if (!t) continue;
    // Фильтр по типу (если указан)
    if (rq.upsType && t.id !== rq.upsType) continue;
    // v0.59.400: фильтр по V_DC убран — параметры АКБ задаются на отдельном шаге.
    // Подбор делегируется плагину
    const fitInfo = t.pickFit ? t.pickFit(rq, u, _parseRedundancy) : null;
    if (fitInfo) out.push({ ups: u, fitInfo, type: t });
  }
  // Сортировка: сначала модульные, потом по утилизации
  out.sort((a, b) => {
    const aUtil = a.fitInfo.usable / (a.ups.frameKw || a.fitInfo.usable);
    const bUtil = b.fitInfo.usable / (b.ups.frameKw || b.fitInfo.usable);
    return bUtil - aUtil;
  });
  return out;
}

// v0.59.400: применить пользовательские фильтры на шаге 2 (производитель,
// топология, диапазон мощности, текстовый поиск). Возвращает суженный
// список из _pickSuitable.
function _applyStep2Filters(suitable) {
  const sup = (document.getElementById('wiz-filter-supplier')?.value || '').toLowerCase();
  const top = (document.getElementById('wiz-filter-topology')?.value || '').toLowerCase();
  const kwMin = Number(document.getElementById('wiz-filter-kwMin')?.value) || 0;
  const kwMax = Number(document.getElementById('wiz-filter-kwMax')?.value) || Infinity;
  const txt = (document.getElementById('wiz-filter-text')?.value || '').trim().toLowerCase();
  return suitable.filter(({ ups, fitInfo }) => {
    if (sup && (ups.supplier || '').toLowerCase() !== sup) return false;
    if (top && (ups.topology || '').toLowerCase() !== top) return false;
    const kw = fitInfo.usable || ups.frameKw || ups.capacityKw || 0;
    if (kw < kwMin) return false;
    if (kw > kwMax) return false;
    if (txt) {
      const hay = [ups.supplier, ups.model, ups.id, ups.series, ups.topology].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(txt)) return false;
    }
    return true;
  });
}

// v0.59.400: заполнить выпадающие списки фильтров шага 2 уникальными значениями
// из текущего набора подходящих моделей.
function _populateStep2FilterOptions(suitable) {
  const supSel = document.getElementById('wiz-filter-supplier');
  const topSel = document.getElementById('wiz-filter-topology');
  if (supSel) {
    const cur = supSel.value;
    const sups = [...new Set(suitable.map(s => s.ups.supplier).filter(Boolean))].sort();
    supSel.innerHTML = '<option value="">Все</option>' + sups.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (sups.includes(cur)) supSel.value = cur;
  }
  if (topSel) {
    const cur = topSel.value;
    const tops = [...new Set(suitable.map(s => s.ups.topology).filter(Boolean))].sort();
    topSel.innerHTML = '<option value="">Все</option>' + tops.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (tops.includes(cur)) topSel.value = cur;
  }
}

// v0.59.400: построить _и_ отрисовать список моделей с учётом фильтров шага 2.
function _renderSuitableList() {
  const list = document.getElementById('wiz-suitable-list');
  if (!list) return;
  _readStep2();
  const all = _pickSuitable();
  _populateStep2FilterOptions(all);
  const filtered = _applyStep2Filters(all);
  const next2 = document.getElementById('wiz-btn-next-2');
  if (!filtered.length) {
    list.innerHTML = `
      <div class="suitable-list">
        <div class="empty" style="padding:30px;text-align:center">
          ${all.length
            ? 'Под фильтры ничего не попало — ослабьте критерии (производитель, диапазон kW, текст).'
            : 'Подходящих моделей не найдено. Добавьте модели в справочник или смягчите требования (уменьшите нагрузку / уберите фильтр по типу).'}
        </div>
      </div>`;
    if (next2) next2.disabled = true;
    return;
  }
  const html = ['<div class="suitable-list">'];
  filtered.forEach(({ ups, fitInfo, type }, idx) => {
    const priceInfo = pricesForElement(ups.id);
    const priceStr = priceInfo.latest
      ? Number(priceInfo.latest.price).toLocaleString('ru-RU') + ' ' + priceInfo.latest.currency
      : '—';
    const isRec = idx === 0 ? ' recommended' : '';
    const t = type || getUpsTypeOrFallback(ups);
    const typeLabel = t.label;
    const metaText = t.metaLabel ? t.metaLabel(ups) : '';
    const calcText = t.fitDescription ? t.fitDescription(ups, fitInfo) : '';
    const vdcStr = (ups.vdcMin && ups.vdcMax) ? `· V<sub>DC</sub> ${ups.vdcMin}–${ups.vdcMax}V ` : '';
    html.push(`
      <div class="suitable-item${isRec}" data-id="${esc(ups.id)}" data-idx="${idx}">
        <div class="suitable-main">
          <div class="suitable-title">${esc(ups.supplier || '')} ${esc(ups.model || ups.id)} <span class="muted" style="font-size:11px">· ${esc(typeLabel)}${ups.topology ? ' · ' + esc(ups.topology) : ''}</span></div>
          <div class="suitable-meta">
            ${metaText}
            ${vdcStr}· Цена ${priceStr}
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
      wizState.selected = filtered[idx];
      if (next2) next2.disabled = false;
    };
  });
  // Авто-выбор первого (рекомендованного), если ничего не выбрано
  const curId = wizState.selected?.ups?.id;
  const keep = curId && filtered.findIndex(s => s.ups.id === curId);
  if (keep != null && keep >= 0) {
    list.querySelectorAll('.suitable-item')[keep]?.click();
  } else if (filtered[0]) {
    list.querySelector('.suitable-item')?.click();
  }
}

function _goStep2() {
  _readStep1();
  const rq = wizState.requirements;
  if (rq.loadKw <= 0) { flash('Укажите нагрузку > 0', 'warn'); return; }
  // Подвешиваем live-обновление фильтров (на повторных входах не дублируем).
  const filterIds = ['wiz-redundancy', 'wiz-filter-supplier', 'wiz-filter-topology', 'wiz-filter-kwMin', 'wiz-filter-kwMax', 'wiz-filter-text'];
  for (const id of filterIds) {
    const el = document.getElementById(id);
    if (el && !el._wizBound) {
      el.addEventListener('change', _renderSuitableList);
      el.addEventListener('input', _renderSuitableList);
      el._wizBound = true;
    }
  }
  _renderSuitableList();
  _showStep(2);
}

// ====================== Шаг 3: Итог ======================
function _buildComposition() {
  const sel = wizState.selected;
  const rq = wizState.requirements;
  if (!sel) return null;
  const { ups, fitInfo } = sel;
  const t = sel.type || getUpsTypeOrFallback(ups);
  // Состав делегируется плагину типа.
  const composition = t.buildComposition ? t.buildComposition(ups, fitInfo) : [{
    elementId: ups.id, qty: fitInfo.installed,
    role: 'active', label: (ups.supplier || '') + ' ' + (ups.model || ups.id),
  }];
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

// v0.59.400: шаг 3 — выбор АКБ или пропустить.
function _goStep3() {
  _readStep2();
  if (!wizState.selected) { flash('Не выбрана модель ИБП', 'warn'); return; }
  // Готовим composition (нужен для V_DC из паспорта выбранного ИБП).
  const comp = _buildComposition();
  if (!comp) { flash('Не удалось рассчитать конфигурацию', 'error'); return; }
  wizState.composition = comp;
  wizState.batteryChoice = wizState.batteryChoice || null; // 'skip' | 'pick' | null
  _renderBatteryInfo();
  _showStep(3);
}

// v0.59.400: подхват результата возврата из battery/. Если пользователь
// сделал расчёт и нажал «Применить → ИБП», битч-ся payload в
// raschet.upsBatteryReturn.v1 — забираем его и кладём в wizState.battery.
function _consumeUpsBatteryReturn() {
  let p = null;
  try {
    const raw = localStorage.getItem('raschet.upsBatteryReturn.v1');
    if (!raw) return false;
    p = JSON.parse(raw);
    localStorage.removeItem('raschet.upsBatteryReturn.v1');
  } catch { return false; }
  if (!p) return false;
  wizState.battery = {
    id: p.battery?.id, supplier: p.battery?.supplier, model: p.battery?.model,
    chemistry: p.battery?.chemistry,
    capacityAh: p.battery?.capacityAh, blockVoltage: p.battery?.blockVoltage,
    strings: p.strings, blocksPerString: p.blocksPerString, totalBlocks: p.totalBlocks,
    autonomyMin: p.autonomyMin, totalKwh: p.totalKwh, dcVoltage: p.dcVoltage,
  };
  wizState.batteryChoice = 'pick';
  const next3Btn = document.getElementById('wiz-btn-next-3');
  if (next3Btn) next3Btn.disabled = false;
  return true;
}
// При фокусе вкладки — пробуем подхватить возврат из battery/.
window.addEventListener('focus', () => {
  if (_consumeUpsBatteryReturn()) {
    _renderBatteryInfo();
    flash('Подбор АКБ получен из «Расчёт АКБ».', 'success');
  }
});

function _renderBatteryInfo() {
  const info = document.getElementById('wiz-battery-info');
  if (!info) return;
  const comp = wizState.composition;
  const rq = wizState.requirements;
  if (!comp) { info.textContent = ''; return; }
  const u = comp.ups;
  const lines = [];
  lines.push(`Выбран ИБП: <b>${esc(u.supplier || '')} ${esc(u.model || u.id)}</b>`);
  if (u.vdcMin && u.vdcMax) lines.push(`Диапазон V<sub>DC</sub> по паспорту: <b>${u.vdcMin}…${u.vdcMax} В</b>`);
  lines.push(`Нагрузка: <b>${rq.loadKw} kW</b>, автономия: <b>${rq.autonomyMin} мин</b>, cos φ: <b>${rq.cosPhi}</b>`);
  if (wizState.batteryChoice === 'skip') {
    lines.push(`<div style="margin-top:6px;color:#92400e">⚠ АКБ пропущены — конфигурация будет применена без батарей.</div>`);
  } else if (wizState.battery) {
    const b = wizState.battery;
    lines.push(`<div style="margin-top:6px;color:#065f46">✓ Подобрана АКБ: <b>${esc(b.supplier || '')} ${esc(b.model || b.id)}</b>${b.dcVoltage ? ' · V<sub>DC</sub> ' + b.dcVoltage + ' В' : ''}${b.totalBlocks ? ' · ' + b.totalBlocks + ' блок(ов)' : ''}</div>`);
  } else {
    lines.push(`<div style="margin-top:6px;color:#6b7280">Выберите дальнейшее действие.</div>`);
  }
  info.innerHTML = lines.join('<br>');
}

// v0.59.400: открыть модуль «Расчёт АКБ» с переданными параметрами ИБП.
// Параметры идут двумя путями: query-string (для удобной отладки) и
// localStorage handoff (для надёжности; battery-calc.js его подхватит).
function _openBatteryPicker() {
  const comp = wizState.composition;
  if (!comp) { flash('Сначала выберите ИБП', 'warn'); return; }
  const u = comp.ups;
  const rq = wizState.requirements;
  const handoff = {
    source: 'ups-config',
    selectedAt: Date.now(),
    loadKw: rq.loadKw,
    autonomyMin: rq.autonomyMin,
    cosPhi: rq.cosPhi,
    invEff: (u.efficiency || 94) / 100,
    vdcMin: u.vdcMin || null,
    vdcMax: u.vdcMax || null,
    upsLabel: [u.supplier, u.model || u.id].filter(Boolean).join(' '),
    upsId: u.id,
  };
  try { localStorage.setItem('raschet.upsHandoff.v1', JSON.stringify(handoff)); } catch {}
  const url = new URL('../battery/', location.href);
  url.searchParams.set('fromUps', '1');
  url.searchParams.set('loadKw', rq.loadKw);
  url.searchParams.set('autonomyMin', rq.autonomyMin);
  if (u.vdcMin) url.searchParams.set('vdcMin', u.vdcMin);
  if (u.vdcMax) url.searchParams.set('vdcMax', u.vdcMax);
  if (u.efficiency) url.searchParams.set('invEff', u.efficiency);
  window.open(url.toString(), '_blank');
  wizState.batteryChoice = 'pick';
  const next3Btn = document.getElementById('wiz-btn-next-3');
  if (next3Btn) next3Btn.disabled = false;
  _renderBatteryInfo();
  flash('Модуль «Расчёт АКБ» открыт в новой вкладке. После выбора модели вернитесь сюда и нажмите «Далее → Итог».', 'info');
}

function _goStep4() {
  const comp = wizState.composition;
  if (!comp) { flash('Нет выбранной конфигурации', 'warn'); return; }
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
        <tr><td>Тип</td><td>${rq.upsType ? esc((getUpsType(rq.upsType) || {}).label || rq.upsType) : 'любой'}</td></tr>
        <tr><td>V<sub>DC</sub> (по паспорту ИБП)</td><td>${u.vdcMin || '—'}–${u.vdcMax || '—'} В</td></tr>
        <tr><td>cos φ / фазы</td><td>${rq.cosPhi} / ${rq.phases}ph</td></tr>
        <tr><td>АКБ</td><td>${wizState.batteryChoice === 'skip' ? '<i>пропущены</i>' : (wizState.battery ? esc((wizState.battery.supplier||'') + ' ' + (wizState.battery.model||wizState.battery.id||'')) : '—')}</td></tr>
      </table>
    </div>
    <div class="wiz-summary-box">
      <h5>Подобранная конфигурация</h5>
      <table class="wiz-summary-table">
        <tr><td>Модель</td><td>${esc(u.supplier || '')} ${esc(u.model || u.id)}</td></tr>
        <tr><td>Тип</td><td>${esc(getUpsTypeOrFallback(u).label)}</td></tr>
        ${(getUpsTypeOrFallback(u).summaryRowsHtml ? getUpsTypeOrFallback(u).summaryRowsHtml(u, fi) : '')}
        <tr><td>Итоговая мощность</td><td>${fi.usable} kW</td></tr>
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
  _showStep(4);
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
      batteryVdcMin: u.vdcMin || null,
      batteryVdcMax: u.vdcMax || null,
      batteryAutonomyMin: rq.autonomyMin,
      batterySelection: wizState.battery || null,
      batteryChoice: wizState.batteryChoice || null,
      composition: comp.composition,
      totalPrice: comp.totalPrice,
      currency: comp.currency,
    },
    selectedAt: Date.now(),
  };
  try {
    if (wizState.nodeId) {
      // Node-targeted: прямой канал + автозакрытие вкладки
      localStorage.setItem('raschet.pendingUpsSelection.v1', JSON.stringify(payload));
      flash('Конфигурация передана. Возврат в Конструктор схем…', 'success');
      setTimeout(() => { try { window.close(); } catch {} }, 1500);
    } else {
      // Standalone: сохраняем в lastUpsConfig.v1 — инспектор ИБП
      // применит по кнопке «⬇ Применить из Конфигуратора».
      // Payload тот же формат, что и pendingUpsSelection (nodeId=null),
      // чтобы consumer-код в engine/index.js мог reuse логику.
      localStorage.setItem('raschet.lastUpsConfig.v1', JSON.stringify(payload));
      flash('Конфигурация сохранена. Откройте Конструктор схем → параметры ИБП → «⬇ Применить из Конфигуратора».', 'success');
      renderPendingBanner();
      // Сворачиваем wizard, показываем справочник обратно
      const wizard = document.getElementById('configurator-wizard');
      if (wizard) wizard.style.display = 'none';
      const selectedPanel = document.getElementById('selected-ups-details');
      if (selectedPanel) selectedPanel.closest('.panel').style.display = '';
    }
  } catch (e) {
    flash('Не удалось передать конфигурацию: ' + (e.message || e), 'error');
  }
}
