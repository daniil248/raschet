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
import { KEHUA_MR33_UPSES } from '../shared/catalogs/ups/kehua-mr33.js';
import { KEHUA_S3_AIO_UPSES } from '../shared/catalogs/ups/kehua-s3-aio.js';
// v0.59.446: единый источник правды seed-данных ИБП (все 6 каталогов).
import '../shared/ups-seed.js';
// v0.59.385: типы ИБП — плагин-архитектура. Чтобы добавить новый тип
// (моноблок/модульный/интегрированный/...), создайте файл в
// shared/ups-types/ и зарегистрируйте его в shared/ups-types/index.js.
import { listUpsTypes, getUpsType, detectUpsType, getUpsTypeOrFallback } from '../shared/ups-types/index.js';
import { pricesForElement } from '../shared/price-records.js';
import { rsToast, rsConfirm, rsPrompt } from '../shared/dialog.js';
import { wireExportImport } from '../shared/config-io.js';
import { APP_VERSION } from '../js/engine/constants.js';
import { getActiveProjectCode, getSelectionMeta } from '../shared/configuration-catalog.js';
import { getProject as _getProjectD, getActiveProjectId as _getActiveProjectIdD } from '../shared/project-storage.js';

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
  // v0.59.421: Kehua S³C All-in-One — отдельный seed-button.
  const aioBtn = document.getElementById('btn-seed-kehua-aio');
  if (aioBtn) aioBtn.addEventListener('click', () => {
    const n = KEHUA_S3_AIO_UPSES.length;
    for (const rec of KEHUA_S3_AIO_UPSES) {
      addUps({ ...rec, importedAt: Date.now() });
    }
    flash(`Загружено Kehua S³C AIO: ${n} моделей (моноблок со встроенной АКБ)`, 'success');
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
  // v0.60.444: ДВЕ ЗОНЫ (как «Подбор холода»). По умолчанию открыта зона
  // ПОДБОРА (панель «Свойства подбора/TCO/Сравнение»), wizard НЕ
  // авто-открывается. Wizard (зона варианта) показывается при: ?nodeId=
  // (из Конструктора схем — initWizard сам откроет), клике «🧙 Мастер
  // подбора» или выборе варианта в сайдбаре. Видимость секций — index.html
  // (setScope по событию rs-cs-focus). Раньше standalone-wizard
  // авто-открывался → панель подбора и wizard были на одной странице.
  initWizard();

  // v0.60.475 (по замечанию Пользователя 2026-05-16: «зачем два раза про
  // АКБ/ИБП»): редактор ВАРИАНТА — это вкладки [Spec/АКБ/CAPEX/Итог] в
  // ПАНЕЛИ (B2.2 i1–i4). Старый 4-шаговый wizard БОЛЬШЕ НЕ открывается
  // автоматически при выборе варианта (это и давало дублирующий блок
  // «Конфигуратор ИБП для проекта» под панелью). Wizard остаётся ТОЛЬКО
  // мостом: ?nodeId (Конструктор схем) / ?capacityKw (PUSH технолог) —
  // см. initWizard(); подбор/смена модели — кнопками внутри панели.
  window.addEventListener('rs-cs-focus', (ev) => {
    const d = ev.detail || {};
    if (d.kind && d.kind !== 'ups') return;
    if (d.selectionName) _activeSelName = d.selectionName;
  });
  // v0.60.483 (по замечанию Пользователя: «верни сам подход»): «Сменить
  // модель / мастер подбора» и пустой (ещё не сконфигурированный) вариант
  // открывают СТАРЫЙ конфигуратор-wizard с АВТО-конфигурацией количества
  // модулей и прочих элементов (он был лучше). Запускается ЯВНО (по
  // кнопке / для пустого варианта), не на каждый фокус — дубля нет.
  window.addEventListener('ups:open-master', (ev) => {
    const d = ev.detail || {};
    if (d.kind && d.kind !== 'ups') return;
    const sn = d.selectionName || _activeSelName;
    try { _enterVariantEditor(sn); }
    catch (e) { try { launchStandaloneWizard(); } catch {} }
  });
  window.addEventListener('rs-selection-change', (ev) => {
    const d = ev.detail || {};
    if (d.kind && d.kind !== 'ups') return;
    if (d.selectionName) _activeSelName = d.selectionName;
  });
});

// ====================== WIZARD конфигуратора ======================
// v0.60.446: активный подбор (из сайдбара) — источник УСЛОВИЙ для варианта.
let _activeSelName = null;
const wizState = {
  nodeId: null,
  requirements: {
    loadKw: 10,
    autonomyMin: 15,
    redundancy: 'N',          // legacy alias (== moduleRedundancy)
    moduleRedundancy: 'N',     // v0.60.409: модули внутри frame
    unitRedundancy: 'N',       // v0.60.409: ИБП-units (frames / monoblocks) в параллель
    upsType: '',
    vdcMin: 340,
    vdcMax: 480,
    cosPhi: 0.9,
    phases: 3,
    // v0.59.640: новые UPS-поля для round-trip с Конструктором схем.
    canParallel: true,           // конструкция поддерживает параллельную работу
    maxLoadFactorActive: false,  // активен ли cap «макс. загрузка»
    maxLoadFactor: 0.80,         // например 0.80 = ИБП можно нагружать не более 80%
  },
  selected: null, // выбранный фрейм/модель из справочника
  composition: null, // рассчитанная конфигурация
};

function initWizard() {
  const qp = new URLSearchParams(location.search);
  const ctxNodeId = qp.get('nodeId');
  // v0.60.69 (Phase 30.2): запуск wizard без nodeId, если передан capacityKw
  // (PUSH из tech-workspace). standalone-режим с pre-filled параметрами.
  const hasPrefill = !ctxNodeId && qp.get('capacityKw');
  if (!ctxNodeId && !hasPrefill) return false; // обычный standalone-mode

  wizState.nodeId = ctxNodeId || null;
  // Предзаполнение из query
  const rq = wizState.requirements;
  if (qp.get('capacityKw')) rq.loadKw = Number(qp.get('capacityKw')) || rq.loadKw;
  // Поддержка старого targetAutonomyMin и нового autonomyMin (PUSH из tech-workspace).
  if (qp.get('targetAutonomyMin')) rq.autonomyMin = Number(qp.get('targetAutonomyMin')) || rq.autonomyMin;
  if (qp.get('autonomyMin')) rq.autonomyMin = Number(qp.get('autonomyMin')) || rq.autonomyMin;
  if (qp.get('redundancy')) rq.redundancy = qp.get('redundancy');
  if (qp.get('upsType')) rq.upsType = qp.get('upsType');
  if (qp.get('vdcMin')) rq.vdcMin = Number(qp.get('vdcMin')) || rq.vdcMin;
  if (qp.get('vdcMax')) rq.vdcMax = Number(qp.get('vdcMax')) || rq.vdcMax;
  if (qp.get('cosPhi')) rq.cosPhi = Number(qp.get('cosPhi')) || rq.cosPhi;
  if (qp.get('phases')) rq.phases = Number(qp.get('phases')) || rq.phases;
  // v0.59.640: round-trip параметры из Конструктора схем.
  if (qp.get('canParallel') === '0') rq.canParallel = false;
  if (qp.get('maxLoadFactorActive') === '1') rq.maxLoadFactorActive = true;
  if (qp.get('maxLoadFactor')) {
    const mf = Number(qp.get('maxLoadFactor'));
    if (Number.isFinite(mf) && mf >= 0.30 && mf <= 1.00) rq.maxLoadFactor = mf;
  }

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
  // v0.60.485 (по замечанию Пользователя): шаг «Подбор АКБ» в мастере
  // ИБП больше НЕ нужен — подбор АКБ вынесен в отдельный раздел сверху
  // (вкладка/кнопка «🔋 АКБ»). Шаг 2 (модель) → сразу Итог; АКБ в
  // мастере помечаем как внешний (подбирается отдельно).
  document.getElementById('wiz-btn-next-2').onclick = () => {
    wizState.batteryChoice = wizState.batteryChoice || 'external';
    _goStep4();
  };
  document.getElementById('wiz-btn-back-3').onclick = () => _showStep(2);
  const skipBtn = document.getElementById('wiz-btn-skip-batt');
  const pickBtn = document.getElementById('wiz-btn-pick-batt');
  const next3Btn = document.getElementById('wiz-btn-next-3');
  const back4Btn = document.getElementById('wiz-btn-back-4');
  if (skipBtn) skipBtn.onclick = () => { wizState.batteryChoice = 'skip'; if (next3Btn) next3Btn.disabled = false; _renderBatteryInfo(); _goStep4(); };
  if (pickBtn) pickBtn.onclick = _openBatteryPicker;
  if (next3Btn) next3Btn.onclick = _goStep4;
  // Шаг 2 — без промежуточного АКБ-шага: «Назад» из Итога ведёт к модели.
  if (back4Btn) back4Btn.onclick = () => _showStep(2);
  // v0.59.441: кнопка «Изменить конфигурацию» — возврат к шагу 1 с сохранёнными значениями.
  const editCfgBtn = document.getElementById('wiz-btn-edit-cfg');
  if (editCfgBtn) editCfgBtn.onclick = () => { _fillWizStep1Fields(); _showStep(1); };
  document.getElementById('wiz-btn-apply').onclick = _applyConfiguration;
  const saveCfgBtn = document.getElementById('wiz-btn-save-cfg');
  if (saveCfgBtn) saveCfgBtn.onclick = _saveWizardConfiguration;
  // v0.59.420: печатный отчёт о подобранной конфигурации.
  const printBtn = document.getElementById('wiz-btn-print');
  if (printBtn) printBtn.onclick = _printUpsReport;
  _showStep(1);
}

// v0.60.446: загрузить УСЛОВИЯ из активного подбора (selection-meta) в
// wizState.requirements. Условия — общие для всех вариантов, задаются в
// зоне ПОДБОРА («Свойства подбора»), здесь только читаются.
function _loadReqFromSelection(selName) {
  if (!selName) return false;
  let meta = null;
  try { meta = getSelectionMeta('ups', { projectCode: getActiveProjectCode() || null, selectionName: selName }); } catch {}
  const r = meta && meta.requirements;
  if (!r) return false;
  const rq = wizState.requirements;
  if (r.loadKw != null && r.loadKw !== '') rq.loadKw = Number(r.loadKw) || rq.loadKw;
  if (r.autonomyMin != null && r.autonomyMin !== '') rq.autonomyMin = Number(r.autonomyMin) || rq.autonomyMin;
  if (r.redundancy) { rq.redundancy = r.redundancy; rq.moduleRedundancy = r.redundancy; }
  if (r.cosPhi != null && r.cosPhi !== '') rq.cosPhi = Number(r.cosPhi) || rq.cosPhi;
  if (r.phases != null && r.phases !== '') rq.phases = Number(r.phases) || rq.phases;
  // v0.60.451: «Допустимые типы ИБП» — массив. Тип варианта = тип
  // выбранной модели; список моделей фильтруется по допустимым типам.
  // Backward-compat: старое одиночное r.upsType.
  if (Array.isArray(r.upsTypes)) {
    rq.upsTypes = r.upsTypes.slice();
    rq.upsType = r.upsTypes.length === 1 ? r.upsTypes[0] : '';
  } else if (r.upsType != null) {
    rq.upsType = r.upsType;
    rq.upsTypes = r.upsType ? [r.upsType] : [];
  }
  // v0.60.448: высота установки + макс. темп. среды — условия подбора
  // (дерейтинг). Из проекта/технолога или вручную в «Свойства подбора».
  if (r.altitudeM != null && r.altitudeM !== '') rq.altitudeM = Number(r.altitudeM) || 0;
  if (r.ambientMaxC != null && r.ambientMaxC !== '') rq.ambientMaxC = Number(r.ambientMaxC) || 0;
  // v0.60.450: если подбор привязан к проекту — высота/макс.темп.среды
  // берутся ИЗ ПРОЕКТА (карточка → 🏔 Параметры площадки), перекрывая
  // значения подбора (единый источник, как тариф/валюта).
  try {
    if (getActiveProjectCode()) {
      const proj = _getProjectD(_getActiveProjectIdD());
      const loc = proj && proj.location;
      if (loc) {
        if (Number.isFinite(Number(loc.elevationM))) rq.altitudeM = Number(loc.elevationM);
        if (Number.isFinite(Number(loc.ambientMaxC))) rq.ambientMaxC = Number(loc.ambientMaxC);
      }
    }
  } catch {}
  return true;
}

// v0.60.446: вход в зону ВАРИАНТА. Шаг 1 (требования) НЕ показываем —
// условия берём из подбора. Открываем сразу подбор модели (Шаг 2).
// «← Назад» / «✏ Изменить условия» возвращают в зону ПОДБОРА.
function _enterVariantEditor(selName) {
  const wizard = document.getElementById('configurator-wizard');
  if (!wizard) return;
  if (!wizard._wizBound) { _openWizard({ standalone: true }); wizard._wizBound = true; }
  wizard.style.display = '';
  _loadReqFromSelection(selName);
  _fillWizStep1Fields();
  // Назад/изменить условия → зона подбора (а не Шаг 1, которого больше нет).
  const toPodbor = () => {
    try { window.dispatchEvent(new CustomEvent('rs-cs-focus', { detail: { kind: 'ups', scope: 'selection', selectionName: selName || _activeSelName } })); } catch {}
  };
  const back2 = document.getElementById('wiz-btn-back-2');
  if (back2) back2.onclick = toPodbor;
  const editCfg = document.getElementById('wiz-btn-edit-cfg');
  if (editCfg) editCfg.onclick = toPodbor;
  const rq = wizState.requirements;
  // v0.60.449: дефолт фильтров подбора модели — ИЗ условий подбора, чтобы
  // «Мощность ≥/≤ kW» были осмысленно предзаполнены, а не пусты.
  const setVal = (id, v) => { const e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
  setVal('wiz-filter-kwMin', Math.round(Number(rq.loadKw) || 0) || '');
  setVal('wiz-redundancy', rq.moduleRedundancy || rq.redundancy || 'N');
  setVal('wiz-redundancy-modules', rq.moduleRedundancy || rq.redundancy || 'N');
  setVal('wiz-redundancy-units', rq.unitRedundancy || 'N');
  // v0.60.449: видимый read-only баннер УСЛОВИЙ ПОДБОРА вверху редактора
  // варианта (не только в индикаторе) + ссылка вернуться в зону подбора.
  const typeLbl = rq.upsType === 'modular' ? 'модульный' : rq.upsType === 'monoblock' ? 'моноблок' : 'любой тип';
  const wiz2 = document.getElementById('wiz-step-2');
  if (wiz2) {
    let b = document.getElementById('wiz-podbor-conditions');
    if (!b) {
      b = document.createElement('div');
      b.id = 'wiz-podbor-conditions';
      b.style.cssText = 'margin:0 0 12px;padding:9px 12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;font-size:12px;color:#3730a3;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
      wiz2.insertBefore(b, wiz2.firstChild);
    }
    b.innerHTML = `<span title="Эти условия заданы в «Свойства подбора» и одинаковы для всех вариантов. Здесь подбирается конкретная модель.">📋 Условия подбора: <b>${Number(rq.loadKw) || 0} кВт</b> · ${rq.moduleRedundancy || rq.redundancy || 'N'} · ${typeLbl} · ${rq.topology || '—'} · cos φ ${rq.cosPhi || '—'} · ${rq.phases || 3}ф · автономия ${Number(rq.autonomyMin) || 0} мин</span>
      <button type="button" id="wiz-back-podbor" style="flex:0 0 auto;padding:4px 10px;font-size:11.5px;background:#fff;border:1px solid #c7d2fe;border-radius:4px;color:#3730a3;cursor:pointer" title="Вернуться к условиям подбора («Свойства подбора»)">← Условия подбора</button>`;
    b.querySelector('#wiz-back-podbor')?.addEventListener('click', toPodbor);
  }
  const ind = document.getElementById('wiz-step-indicator');
  if (ind) ind.textContent = 'Подбор модели для варианта';
  // v0.60.449: вспомогательная панель «Выбранная модель» (каскад справочника)
  // не нужна в зоне варианта — скрываем (Пользователь: «блок ни от чего»).
  const selPanel = document.getElementById('selected-ups-details');
  if (selPanel && selPanel.closest('.panel')) selPanel.closest('.panel').style.display = 'none';
  try { _goStep2(); } catch (e) { console.warn('[ups-config] goStep2', e); _showStep(2); }
}

// v0.59.405: сохранение полной конфигурации wizard'а в перечень слева.
// Использует общий shared/configuration-catalog.js (kind='ups'), чтобы
// запись попадала в тот же список, что и кнопка «+ Сохранить» в шапке
// сайдбара. В payload — полное состояние wizard (требования + frame +
// модули + АКБ + резервирование), чтобы при выборе из списка можно было
// разом восстановить все поля.
async function _saveWizardConfiguration() {
  const comp = wizState.composition;
  if (!comp) { flash('Сначала выберите конфигурацию (Шаг 4)', 'warn'); return; }
  const u = comp.ups;
  const fi = comp.fitInfo;
  const rq = wizState.requirements;
  // v0.60.422 (по запросу Пользователя 2026-05-06: «Добавь конфигурации с
  // вариантами как в модуле подбор холода»): сохранение в Подбор / Вариант.
  // 1) Подбор (selectionName) — общая группа, может содержать несколько
  //    альтернативных вариантов (модулярный vs моноблок vs гибрид).
  //    Default: «Подбор N+R мощностью X кВт» (по требованиям).
  // 2) Вариант (label) — конкретная модель ИБП в этом подборе.
  const { listSelectionNames } = await import('../shared/configuration-catalog.js');
  const existingSelections = listSelectionNames('ups').slice(0, 20);
  const defSelection = `${rq.loadKw} кВт · ${rq.unitRedundancy || rq.redundancy} ИБП${(rq.moduleRedundancy && rq.moduleRedundancy !== 'N') ? ' · модули ' + rq.moduleRedundancy : ''}`;
  let selectionName;
  try {
    const hint = existingSelections.length
      ? `\n\nСуществующие подборы (вставьте имя для добавления варианта):\n${existingSelections.map(s => '• ' + s).join('\n')}`
      : '';
    const res = await rsPrompt('Название подбора (Подбор)' + hint, defSelection, { okLabel: 'Далее', cancelLabel: 'Отмена' });
    if (res === null || res === undefined) return;
    selectionName = String(res || '').trim() || defSelection;
  } catch { selectionName = defSelection; }
  // Имя варианта (label) по умолчанию = модель ИБП.
  const defLabel = `${u.supplier || ''} ${u.model || u.id} · ${fi.usable} kW`.trim();
  let label = defLabel;
  try {
    const res = await rsPrompt('Название варианта в подборе «' + selectionName + '»', defLabel, { okLabel: 'Сохранить', cancelLabel: 'Отмена' });
    if (res === null || res === undefined) return;
    label = String(res || '').trim() || defLabel;
  } catch { label = defLabel; }
  const description = [
    rq.upsType ? (getUpsType(rq.upsType) || {}).label : '',
    rq.redundancy,
    `${rq.autonomyMin} мин`,
    wizState.batteryChoice === 'skip' ? 'без АКБ' : (wizState.battery ? `АКБ: ${wizState.battery.supplier || ''} ${wizState.battery.model || ''}`.trim() : ''),
  ].filter(Boolean).join(' · ');
  const payload = {
    // Требования
    loadKw: rq.loadKw, autonomy: rq.autonomyMin, redundancy: rq.redundancy,
    upsType: rq.upsType, cosPhi: rq.cosPhi, phases: rq.phases,
    // Подобранный frame
    upsId: u.id, upsSupplier: u.supplier, upsModel: u.model,
    capacityKw: fi.realCapacity || fi.usable,
    moduleInstalled: fi.installed, moduleWorking: fi.working, moduleRedundant: fi.redundant,
    frameKw: u.frameKw, moduleKwRated: u.moduleKwRated, moduleSlots: u.moduleSlots,
    efficiency: u.efficiency, vdcMin: u.vdcMin, vdcMax: u.vdcMax,
    // АКБ
    batteryChoice: wizState.batteryChoice || null,
    battery: wizState.battery || null,
    // Цена
    totalPrice: comp.totalPrice, currency: comp.currency,
    // Композиция (для standalone-режима с модулями)
    composition: comp.composition,
  };
  try {
    const cat = await import('../shared/configuration-catalog.js');
    const { saveConfig, getActiveProjectCode, ensureSelectionMeta, getSelectionMeta, saveSelectionMeta } = cat;
    // v0.60.438: контекст подбора (проект / разовый) — синхронно с сайдбаром
    // (raschet.cs.ctx.ups). Шаг 1 «Требования к ИБП» = УСЛОВИЯ ПОДБОРА.
    const basePc = getActiveProjectCode() || null;
    let ctxSA;
    try { const s = localStorage.getItem('raschet.cs.ctx.ups'); ctxSA = s ? s === 'standalone' : !basePc; }
    catch { ctxSA = !basePc; }
    const pc = ctxSA ? null : basePc;
    const entry = saveConfig('ups', {
      label,
      description,
      // v0.60.422: selectionName — группа «Подбор» в сайдбаре.
      selectionName,
      projectCode: pc,
      payload,
    });
    // v0.60.438: Шаг 1 «Требования к ИБП» — это и есть УСЛОВИЯ ПОДБОРА
    // (одинаковы для всех вариантов). Пишем их в запись подбора, чтобы
    // панель «Свойства подбора» и расчёт TCO брали их отсюда (единый
    // источник, без дублирующего ввода).
    try {
      ensureSelectionMeta('ups', { projectCode: pc, selectionName },
        { requirements: {}, eco: {} });
      const meta = getSelectionMeta('ups', { projectCode: pc, selectionName });
      const reqPrev = (meta && meta.requirements) || {};
      saveSelectionMeta('ups', {
        projectCode: pc, selectionName,
        requirements: {
          ...reqPrev,
          loadKw: rq.loadKw,
          autonomyMin: rq.autonomyMin,
          redundancy: rq.redundancy,
          cosPhi: rq.cosPhi,
          phases: rq.phases,
        },
      });
    } catch (e) { console.warn('[ups-config] saveSelectionMeta failed', e); }
    flash(`Сохранено: ${entry.id} · ${label} (подбор «${selectionName}»)`, 'success');
    // Тригернём refresh сайдбара (он подписан на onConfigsChange)
    try { window.dispatchEvent(new CustomEvent('ups-config:configs-changed')); } catch {}
    // Активируем этот подбор в панели «Свойства подбора / TCO».
    try { window.dispatchEvent(new CustomEvent('rs-selection-change', { detail: { kind: 'ups', selectionName } })); } catch {}

    // v0.60.89 (Phase 36.2 / Phase 30.2 PULL): сохраняем выбранную модель в
    // LS-bridge для tech-workspace round-trip. TW читает её и предлагает
    // «↩ Применить из ups-config» как для DGU.
    try {
      const qp = new URLSearchParams(location.search);
      const pid = qp.get('project') || qp.get('pid');
      if (pid) {
        const { projectKey } = await import('../shared/project-storage.js');
        const selectedPayload = {
          ts: Date.now(),
          supplier: u.supplier || null,
          model: u.model || u.id,
          upsId: u.id,
          capacityKw: fi.realCapacity || fi.usable,
          frameKw: u.frameKw, moduleKwRated: u.moduleKwRated,
          moduleInstalled: fi.installed, moduleWorking: fi.working, moduleRedundant: fi.redundant,
          efficiency: u.efficiency, cosPhi: u.cosPhi || rq.cosPhi,
          autonomyMin: rq.autonomyMin,
          redundancy: rq.redundancy,
          upsType: rq.upsType || u.upsType,
          configId: entry.id,
        };
        localStorage.setItem(projectKey(pid, 'ups-config', 'selected.v1'), JSON.stringify(selectedPayload));
      }
    } catch (err) {
      console.warn('[ups-config] PULL bridge save failed:', err);
    }
  } catch (e) {
    flash('Не удалось сохранить: ' + (e.message || e), 'error');
  }
}

// v0.59.735: bidirectional sync для wiz-loadKw ↔ wiz-loadA. cos φ из
// wiz-cosPhi, фаза из wiz-phases. Напряжение: 3ф 400В / 1ф 230В.
function _ucKwToA(kw) {
  if (!(kw > 0)) return 0;
  const cos = Number(document.getElementById('wiz-cosPhi')?.value) || 0.9;
  const ph = Number(document.getElementById('wiz-phases')?.value) || 3;
  const U = ph === 1 ? 230 : 400;
  const k = ph === 1 ? 1 : Math.sqrt(3);
  return (kw * 1000) / (k * U * cos);
}
function _ucAToKw(a) {
  if (!(a > 0)) return 0;
  const cos = Number(document.getElementById('wiz-cosPhi')?.value) || 0.9;
  const ph = Number(document.getElementById('wiz-phases')?.value) || 3;
  const U = ph === 1 ? 230 : 400;
  const k = ph === 1 ? 1 : Math.sqrt(3);
  return (a * k * U * cos) / 1000;
}
function _ucSyncLoadAFromKw() {
  const kwEl = document.getElementById('wiz-loadKw');
  const aEl = document.getElementById('wiz-loadA');
  if (!kwEl || !aEl) return;
  const a = _ucKwToA(Number(kwEl.value) || 0);
  aEl.value = a > 0 ? a.toFixed(2).replace(/\.00$/, '') : '';
}
let _ucWizFieldsWired = false;
function _ucWireWizLoadFields() {
  if (_ucWizFieldsWired) { _ucSyncLoadAFromKw(); return; }
  const kwEl = document.getElementById('wiz-loadKw');
  const aEl = document.getElementById('wiz-loadA');
  if (!kwEl || !aEl) return;
  _ucWizFieldsWired = true;
  let _syncing = false;
  kwEl.addEventListener('input', () => {
    if (_syncing) return;
    _syncing = true;
    try { _ucSyncLoadAFromKw(); } finally { _syncing = false; }
  });
  aEl.addEventListener('input', () => {
    if (_syncing) return;
    _syncing = true;
    try {
      const kw = _ucAToKw(Number(aEl.value) || 0);
      kwEl.value = kw > 0 ? kw.toFixed(2).replace(/\.00$/, '') : '';
    } finally { _syncing = false; }
  });
  // Смена cos φ или фаз → пересчитать I из текущей P.
  document.getElementById('wiz-cosPhi')?.addEventListener('change', _ucSyncLoadAFromKw);
  document.getElementById('wiz-cosPhi')?.addEventListener('input', _ucSyncLoadAFromKw);
  document.getElementById('wiz-phases')?.addEventListener('change', _ucSyncLoadAFromKw);
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
  // v0.60.409: раздельные селекторы — модули и ИБП.
  const modSel = document.getElementById('wiz-redundancy-modules');
  if (modSel) modSel.value = rq.moduleRedundancy || rq.redundancy || 'N';
  const unitSel = document.getElementById('wiz-redundancy-units');
  if (unitSel) unitSel.value = rq.unitRedundancy || 'N';
  // legacy
  const redSel = document.getElementById('wiz-redundancy');
  if (redSel) redSel.value = rq.moduleRedundancy || rq.redundancy || 'N';
  // v0.59.640: дополнительные поля.
  const cpEl = document.getElementById('wiz-canParallel');
  if (cpEl) cpEl.checked = rq.canParallel !== false;
  const mlActiveEl = document.getElementById('wiz-maxLoadActive');
  if (mlActiveEl) mlActiveEl.checked = !!rq.maxLoadFactorActive;
  const mlFactorEl = document.getElementById('wiz-maxLoadFactor');
  if (mlFactorEl) mlFactorEl.value = rq.maxLoadFactor || 0.80;
  // v0.59.735: связь wiz-loadKw ↔ wiz-loadA (двунаправленная).
  _ucWireWizLoadFields();
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
  // v0.59.640: дополнительные поля.
  const cpEl = document.getElementById('wiz-canParallel');
  if (cpEl) rq.canParallel = !!cpEl.checked;
  const mlActiveEl = document.getElementById('wiz-maxLoadActive');
  if (mlActiveEl) rq.maxLoadFactorActive = !!mlActiveEl.checked;
  const mlFactorEl = document.getElementById('wiz-maxLoadFactor');
  if (mlFactorEl) {
    const v = Number(mlFactorEl.value);
    if (Number.isFinite(v) && v >= 0.30 && v <= 1.00) rq.maxLoadFactor = v;
  }
}

// v0.59.400: чтение фильтров и резервирования с шага 2.
function _readStep2() {
  const rq = wizState.requirements;
  // v0.60.409 (по запросу Пользователя 2026-05-06: «так мне резерв и по
  // модулям и по ИБП нужно отдельно выбирать»): раздельные селекторы.
  const modSel = document.getElementById('wiz-redundancy-modules');
  const unitSel = document.getElementById('wiz-redundancy-units');
  // Backward-compat: legacy wiz-redundancy → пишем в обе.
  const legacySel = document.getElementById('wiz-redundancy');
  if (modSel) rq.moduleRedundancy = modSel.value || 'N';
  if (unitSel) rq.unitRedundancy = unitSel.value || 'N';
  // legacy `redundancy` оставляем как alias на module-level для совместимости.
  rq.redundancy = rq.moduleRedundancy || rq.redundancy || (legacySel ? legacySel.value : 'N') || 'N';
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

// v0.59.468: КРОСС-ФИЛЬТРАЦИЯ. Опции каждого селекта учитывают значения
// всех остальных активных фильтров. Раньше «Все» считалось от полного
// suitable-списка независимо от того что выбрал пользователь — поэтому
// можно было выбрать невозможную комбинацию (Legrand + All-in-One и т.п.).
function _populateStep2FilterOptions(suitable) {
  const supSel = document.getElementById('wiz-filter-supplier');
  const topSel = document.getElementById('wiz-filter-topology');
  // Применяем все фильтры кроме одного — для определения опций этого фильтра.
  const subset = (excludeId) => {
    const sup = excludeId === 'sup' ? '' : (document.getElementById('wiz-filter-supplier')?.value || '').toLowerCase();
    const top = excludeId === 'top' ? '' : (document.getElementById('wiz-filter-topology')?.value || '').toLowerCase();
    const kwMin = Number(document.getElementById('wiz-filter-kwMin')?.value) || 0;
    const kwMax = Number(document.getElementById('wiz-filter-kwMax')?.value) || Infinity;
    const txt = (document.getElementById('wiz-filter-text')?.value || '').trim().toLowerCase();
    return suitable.filter(({ ups, fitInfo }) => {
      if (sup && (ups.supplier || '').toLowerCase() !== sup) return false;
      if (top && (ups.topology || '').toLowerCase() !== top) return false;
      const kw = fitInfo.usable || ups.frameKw || ups.capacityKw || 0;
      if (kw < kwMin || kw > kwMax) return false;
      if (txt) {
        const hay = [ups.supplier, ups.model, ups.id, ups.series, ups.topology].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(txt)) return false;
      }
      return true;
    });
  };
  if (supSel) {
    const cur = supSel.value;
    const sups = [...new Set(subset('sup').map(s => s.ups.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    supSel.innerHTML = '<option value="">Все</option>' + sups.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (cur && sups.includes(cur)) supSel.value = cur;
    else if (cur) supSel.value = '';
  }
  if (topSel) {
    const cur = topSel.value;
    const tops = [...new Set(subset('top').map(s => s.ups.topology).filter(Boolean))].sort();
    topSel.innerHTML = '<option value="">Все</option>' + tops.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (cur && tops.includes(cur)) topSel.value = cur;
    else if (cur) topSel.value = '';
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
    // v0.59.423: если выбран All-in-One, а в справочнике нет AIO моделей —
    // показать кнопку «Загрузить каталог Kehua S³C AIO» прямо здесь.
    const rq = wizState.requirements;
    const catalog = listUpses();
    const hasAio = catalog.some(u => (u.kind === 'ups-all-in-one'));
    let extra = '';
    if (rq.upsType === 'all-in-one' && !hasAio) {
      extra = `
        <div style="margin-top:10px">
          <button id="wiz-btn-seed-aio" class="primary" type="button">
            📦 Загрузить каталог Kehua S³C AIO (6 моделей)
          </button>
          <div class="muted" style="font-size:11px;margin-top:6px">
            All-in-One моноблочные шкафы со встроенной АКБ Li-Ion. После загрузки модели появятся в этом списке.
          </div>
        </div>`;
    }
    list.innerHTML = `
      <div class="suitable-list">
        <div class="empty" style="padding:30px;text-align:center">
          ${all.length
            ? 'Под фильтры ничего не попало — ослабьте критерии (производитель, диапазон kW, текст).'
            : 'Подходящих моделей не найдено. Добавьте модели в справочник или смягчите требования (уменьшите нагрузку / уберите фильтр по типу).'}
          ${extra}
        </div>
      </div>`;
    const seedBtn = document.getElementById('wiz-btn-seed-aio');
    if (seedBtn) {
      seedBtn.addEventListener('click', () => {
        for (const rec of KEHUA_S3_AIO_UPSES) addUps({ ...rec, importedAt: Date.now() });
        flash(`Загружено Kehua S³C AIO: ${KEHUA_S3_AIO_UPSES.length} моделей`, 'success');
        _renderSuitableList();
      });
    }
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
  const filterIds = ['wiz-redundancy', 'wiz-redundancy-modules', 'wiz-redundancy-units', 'wiz-filter-supplier', 'wiz-filter-topology', 'wiz-filter-kwMin', 'wiz-filter-kwMax', 'wiz-filter-text'];
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

// v0.60.410 (по запросу Пользователя 2026-05-06: «состав комплекта АКБ
// нужно расписать так же как и состав комплекта ИБП (BOM)»): build
// battery composition (BOM-items) для одного и для всех комплектов.
// Возвращает array of { elementId, qty, role, label } — формат идентичен
// UPS composition. wizState.battery содержит данные расчёта АКБ из
// battery-calc (totalBlocks, strings, blocksPerString, ...).
function _buildBatteryComposition() {
  if (!wizState.battery || wizState.batteryChoice !== 'pick') return null;
  const b = wizState.battery;
  const comp = wizState.composition;
  if (!comp) return null;
  const units = _getUpsUnits(comp);
  const topology = wizState.batteryTopology || (units.unitCount > 1 ? 'per-unit' : 'shared');
  const setsQty = (topology === 'per-unit') ? units.unitCount : 1;
  const items = [];
  // 1) Блоки АКБ — главная позиция (per-unit qty × setsQty = total blocks).
  const blocksPerSet = Number(b.totalBlocks) || 0;
  if (blocksPerSet > 0) {
    items.push({
      elementId: b.id || null,
      qty: blocksPerSet * setsQty,
      role: 'battery-block',
      label: `АКБ-блок: ${(b.supplier || '')} ${(b.model || b.id || '')}`.trim()
        + (b.blockVoltage ? ` · ${b.blockVoltage}V` : '')
        + (b.capacityAh ? ` · ${b.capacityAh}Ah` : ''),
      groupKey: 'battery',
      perSet: blocksPerSet,
      sets: setsQty,
    });
  }
  // 2) String layout — справочно (не отдельный элемент BOM, но описание).
  if (b.strings && b.blocksPerString) {
    items.push({
      elementId: null,
      inline: true,
      qty: setsQty,
      role: 'battery-string-layout',
      label: `Конфигурация на комплект: ${b.strings} × ${b.blocksPerString} блоков (V_DC ${b.dcVoltage || '—'} В)`,
      groupKey: 'battery',
    });
  }
  // 3) Battery breaker / disconnect (стандарт, если задано в записи).
  if (b.breakerIn) {
    items.push({
      elementId: null,
      inline: true,
      qty: setsQty,
      role: 'battery-breaker',
      label: `Автомат АКБ: ${b.breakerIn} A (DC)`,
      groupKey: 'battery',
    });
  }
  // 4) Кабель межблочный (если задан).
  if (b.cableMark || b.cableSizeMm2) {
    items.push({
      elementId: null,
      inline: true,
      qty: setsQty,
      role: 'battery-cable',
      label: `Межблочные кабели: ${b.cableMark || ''} ${b.cableSizeMm2 || ''} мм²`.trim(),
      groupKey: 'battery',
    });
  }
  // 5) Sets summary (вершинный элемент).
  items.unshift({
    elementId: null,
    inline: true,
    qty: setsQty,
    role: 'battery-set',
    label: `Комплект АКБ${setsQty > 1 ? ` (${topology === 'per-unit' ? 'per-unit, на каждый ИБП' : 'shared, общая шина'})` : ''}`,
    groupKey: 'battery',
    topology,
  });
  return items;
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
  // v0.60.406: топология АКБ для параллельных систем (per-unit / shared).
  // Default: per-unit для multi-unit, shared для single-unit.
  if (!wizState.batteryTopology) {
    wizState.batteryTopology = (comp.fitInfo.installed > 1) ? 'per-unit' : 'shared';
  }
  _wireBatteryTopologyUi();
  _renderBatteryInfo();
  _showStep(3);
}

// v0.60.407 (по уточнению Пользователя 2026-05-06: «здесь не верно определено
// 50 кВт на модуль, здесь должно быть 1000 нужно 2 ИБП подобрали, значит
// нужно 500 запрос на ИБП»): для модулярного ИБП с multi-frame parallel
// «единицы ИБП» = число фреймов (parallelFrames), а НЕ число модулей.
// Раньше использовался fi.working = total modules → давало loadKw/20=50 kW
// вместо правильного loadKw/2=500 kW.
function _getUpsUnits(comp) {
  if (!comp) return { unitCount: 1, workingUnits: 1, redundantUnits: 0 };
  const fi = comp.fitInfo;
  const ups = comp.ups;
  if (!fi) return { unitCount: 1, workingUnits: 1, redundantUnits: 0 };
  // Модулярный multi-frame parallel — единицы = фреймы.
  // v0.60.408: учитываем frame-level редундансию (workingFrames vs total).
  if (ups && ups.upsType === 'modular' && fi.parallelFrames && fi.parallelFrames > 1) {
    return {
      unitCount: fi.parallelFrames, // total frames (incl. reserve)
      workingUnits: fi.workingFrames || fi.parallelFrames,
      redundantUnits: fi.redundantFrames || 0,
    };
  }
  // Моноблок / single-frame — единицы = installed (total UPS).
  return {
    unitCount: Math.max(1, fi.installed || 1),
    workingUnits: Math.max(1, fi.working || 1),
    redundantUnits: Math.max(0, fi.redundant || 0),
  };
}

// v0.60.406: видимость и логика селектора топологии АКБ.
function _wireBatteryTopologyUi() {
  const wrap = document.getElementById('wiz-battery-topology');
  if (!wrap) return;
  const comp = wizState.composition;
  if (!comp) { wrap.style.display = 'none'; return; }
  const units = _getUpsUnits(comp);
  const isMulti = units.unitCount > 1;
  // Селектор виден только при multi-unit (>=2 ИБП в системе).
  wrap.style.display = isMulti ? '' : 'none';
  if (!isMulti) return;
  // Установить current state
  document.querySelectorAll('input[name="wiz-batt-topology"]').forEach(r => {
    r.checked = (r.value === (wizState.batteryTopology || 'per-unit'));
    r.onchange = () => {
      wizState.batteryTopology = r.value;
      _renderBatteryTopologySummary();
      _renderBatteryInfo();
    };
  });
  _renderBatteryTopologySummary();
}

function _renderBatteryTopologySummary() {
  const sum = document.getElementById('wiz-batt-topology-summary');
  if (!sum) return;
  const comp = wizState.composition;
  if (!comp) { sum.textContent = ''; return; }
  const rq = wizState.requirements;
  const units = _getUpsUnits(comp);
  const loadKw = Number(rq.loadKw) || 0;
  const topology = wizState.batteryTopology || 'per-unit';
  const loadPerUnit = loadKw / Math.max(1, units.workingUnits);
  if (topology === 'per-unit') {
    sum.innerHTML = `<b>Per-unit</b>: в подбор АКБ передаётся <b>${loadPerUnit.toFixed(1)} kW</b> (= ${loadKw}/${units.workingUnits}). Заказ: <b>${units.unitCount}</b> комплектов АКБ (${units.workingUnits} рабочих${units.redundantUnits > 0 ? ' + ' + units.redundantUnits + ' резерв' : ''}).`;
  } else {
    sum.innerHTML = `<b>Shared</b>: в подбор АКБ передаётся <b>${loadKw.toFixed(1)} kW</b> (полная нагрузка). Заказ: <b>1</b> комплект АКБ (увеличенной ёмкости, общая шина для всех ${units.unitCount} ИБП).`;
  }
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
    type: p.battery?.type,
    chemistry: p.battery?.chemistry,
    capacityAh: p.battery?.capacityAh, blockVoltage: p.battery?.blockVoltage,
    strings: p.strings, blocksPerString: p.blocksPerString, totalBlocks: p.totalBlocks,
    autonomyMin: p.autonomyMin, totalKwh: p.totalKwh, dcVoltage: p.dcVoltage,
    mode: p.mode, targetMin: p.targetMin, endV: p.endV, invEff: p.invEff,
    derate: p.derate,
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
  const fi = comp.fitInfo;
  // v0.60.407: контекст параллели — для модулярного multi-frame единицы =
  // фреймы (НЕ модули).
  const units = _getUpsUnits(comp);
  const N = units.workingUnits;
  const installed = units.unitCount;
  const isMulti = installed > 1;
  const topology = wizState.batteryTopology || (isMulti ? 'per-unit' : 'shared');
  const battSetsQty = (topology === 'per-unit') ? installed : 1;
  const loadKwToPicker = (topology === 'per-unit')
    ? (Number(rq.loadKw) || 0) / N
    : (Number(rq.loadKw) || 0);
  const lines = [];
  const parallelDescr = isMulti
    ? (units.redundantUnits > 0
        ? ` × <b>${installed}</b> в параллель (${N} раб + ${units.redundantUnits} рез)`
        : ` × <b>${installed}</b> в параллель`)
    : '';
  lines.push(`Выбран ИБП: <b>${esc(u.supplier || '')} ${esc(u.model || u.id)}</b>${parallelDescr}`);
  if (u.vdcMin && u.vdcMax) lines.push(`Диапазон V<sub>DC</sub> по паспорту: <b>${u.vdcMin}…${u.vdcMax} В</b>`);
  if (isMulti) {
    lines.push(`Топология АКБ: <b>${topology === 'per-unit' ? 'на каждый ИБП' : 'общая шина'}</b> → в подбор передаётся <b>${loadKwToPicker.toFixed(1)} kW</b>, заказ <b>${battSetsQty}</b> комплект(ов)`);
  } else {
    lines.push(`Нагрузка: <b>${rq.loadKw} kW</b>, автономия: <b>${rq.autonomyMin} мин</b>, cos φ: <b>${rq.cosPhi}</b>`);
  }
  if (wizState.batteryChoice === 'skip') {
    lines.push(`<div style="margin-top:6px;color:#92400e">⚠ АКБ пропущены — конфигурация будет применена без батарей.</div>`);
  } else if (wizState.battery) {
    const b = wizState.battery;
    // v0.60.408: показываем ВСЕГДА общее количество АКБ (комплект × блоков).
    const blocksPerSet = Number(b.totalBlocks) || 0;
    const totalBlocks = blocksPerSet * battSetsQty;
    const setQtyLbl = (battSetsQty > 1)
      ? ` · <b>${battSetsQty} комплект(ов)</b>${blocksPerSet > 0 ? ` × ${blocksPerSet} блок = <b>${totalBlocks} блок всего</b>` : ''}`
      : (blocksPerSet > 0 ? ` · <b>${blocksPerSet} блок (1 комплект)</b>` : '');
    lines.push(`<div style="margin-top:6px;color:#065f46">✓ Подобрана АКБ: <b>${esc(b.supplier || '')} ${esc(b.model || b.id)}</b>${b.dcVoltage ? ' · V<sub>DC</sub> ' + b.dcVoltage + ' В' : ''}${setQtyLbl}</div>`);
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
  const fi = comp.fitInfo;
  const rq = wizState.requirements;
  // v0.60.406 / v0.60.407: per-unit vs shared topology.
  // - per-unit: loadKw / workingUnits передаётся в подбор; кол-во комплектов = unitCount.
  // - shared: вся нагрузка передаётся; кол-во комплектов = 1.
  // ВАЖНО: для модулярного с multi-frame parallel единицы = фреймы (НЕ модули).
  const units = _getUpsUnits(comp);
  const N = units.workingUnits;
  const installed = units.unitCount;
  const topology = wizState.batteryTopology || (installed > 1 ? 'per-unit' : 'shared');
  const isPerUnit = topology === 'per-unit';
  const loadKwToPicker = isPerUnit ? (Number(rq.loadKw) || 0) / N : Number(rq.loadKw) || 0;
  const batterySetsQty = isPerUnit ? installed : 1;
  const handoff = {
    source: 'ups-config',
    selectedAt: Date.now(),
    loadKw: loadKwToPicker,
    autonomyMin: rq.autonomyMin,
    cosPhi: rq.cosPhi,
    invEff: (u.efficiency || 94) / 100,
    vdcMin: u.vdcMin || null,
    vdcMax: u.vdcMax || null,
    upsLabel: [u.supplier, u.model || u.id].filter(Boolean).join(' '),
    upsId: u.id,
    // v0.60.406: контекст параллельной системы для отчёта в battery-calc.
    parallelContext: {
      topology,
      workingCount: N,
      installedCount: installed,
      redundantCount: Math.max(0, fi.redundant || 0),
      batterySetsQty,
      totalLoadKw: Number(rq.loadKw) || 0,
      perUnitLoadKw: (Number(rq.loadKw) || 0) / N,
      redundancyScheme: rq.redundancy || 'N',
    },
  };
  // v0.60.457: «Допустимые типы АКБ» — из УСЛОВИЙ подбора ИБП → в подбор АКБ.
  let battTypes = [];
  try {
    const m = getSelectionMeta('ups', { projectCode: getActiveProjectCode() || null, selectionName: _activeSelName });
    if (m && Array.isArray(m.requirements && m.requirements.batteryTypes)) battTypes = m.requirements.batteryTypes.slice();
  } catch {}
  handoff.batteryTypes = battTypes;
  handoff.selectionName = _activeSelName || null;
  try { localStorage.setItem('raschet.upsHandoff.v1', JSON.stringify(handoff)); } catch {}
  const url = new URL('../battery/', location.href);
  url.searchParams.set('fromUps', '1');
  url.searchParams.set('loadKw', loadKwToPicker.toFixed(2));
  url.searchParams.set('autonomyMin', rq.autonomyMin);
  if (battTypes.length) url.searchParams.set('battTypes', battTypes.join(','));
  if (u.vdcMin) url.searchParams.set('vdcMin', u.vdcMin);
  if (u.vdcMax) url.searchParams.set('vdcMax', u.vdcMax);
  if (u.efficiency) url.searchParams.set('invEff', u.efficiency);
  // v0.60.406: контекст параллели для индикации в battery-calc.
  url.searchParams.set('battSetsQty', String(batterySetsQty));
  url.searchParams.set('battTopology', topology);
  url.searchParams.set('parallelN', String(N));
  url.searchParams.set('parallelInstalled', String(installed));
  window.open(url.toString(), '_blank');
  wizState.batteryChoice = 'pick';
  const next3Btn = document.getElementById('wiz-btn-next-3');
  if (next3Btn) next3Btn.disabled = false;
  _renderBatteryInfo();
  flash('Модуль «Расчёт АКБ» открыт в новой вкладке. После выбора модели вернитесь сюда и нажмите «Далее → Итог».', 'info');
}

// v0.59.440: восстановление сохранённой конфигурации из сайдбара —
// клик в `Конфигурации ИБП` теперь открывает не только переименование
// (это делалось через onRename в config-sidebar), а САМУ конфигурацию:
// заполняет требования, восстанавливает battery / composition и
// прыгает на Шаг 4 (Итог), где пользователь видит подобранный ИБП.
function _loadFromSavedPayload(p) {
  if (!p) return;
  // 1. Требования
  const rq = wizState.requirements;
  if (p.loadKw != null) rq.loadKw = Number(p.loadKw) || rq.loadKw;
  if (p.autonomy != null) rq.autonomyMin = Number(p.autonomy) || rq.autonomyMin;
  if (p.redundancy) rq.redundancy = p.redundancy;
  if (p.upsType) rq.upsType = p.upsType;
  if (p.cosPhi != null) rq.cosPhi = Number(p.cosPhi) || rq.cosPhi;
  if (p.phases != null) rq.phases = Number(p.phases) || rq.phases;
  if (p.vdcMin != null) rq.vdcMin = Number(p.vdcMin) || rq.vdcMin;
  if (p.vdcMax != null) rq.vdcMax = Number(p.vdcMax) || rq.vdcMax;
  // 2. АКБ
  wizState.batteryChoice = p.batteryChoice || null;
  wizState.battery = p.battery || null;
  // 3. Подобранный ИБП — восстанавливаем comp.ups + fitInfo из плоского payload
  const u = {
    id: p.upsId, supplier: p.upsSupplier, model: p.upsModel,
    upsType: p.upsType,
    frameKw: p.frameKw, moduleKwRated: p.moduleKwRated, moduleSlots: p.moduleSlots,
    efficiency: p.efficiency, cosPhi: p.cosPhi,
    vdcMin: p.vdcMin, vdcMax: p.vdcMax,
    inputs: p.inputs, outputs: p.outputs, topology: p.topology,
  };
  const fi = {
    installed: p.moduleInstalled, working: p.moduleWorking,
    redundant: p.moduleRedundant,
    realCapacity: p.capacityKw, usable: p.capacityKw,
  };
  wizState.composition = {
    ups: u, fitInfo: fi,
    unitPrice: null, totalPrice: p.totalPrice, currency: p.currency,
    composition: p.composition || null,
  };
  // 4. Открываем wizard на Шаге 1 (с заполненными данными), пользователь
  //    может листать Далее → или прыгнуть в Итог (Шаг 4).
  _openWizard({ standalone: true });
  _fillWizStep1Fields();
  if (u.id) {
    _goStep4();
  } else {
    _showStep(1);
  }
}
window.addEventListener('ups-config:load', (e) => {
  const entry = e && e.detail;
  const payload = entry && entry.payload;
  if (payload) _loadFromSavedPayload(payload);
});

function _goStep4() {
  const comp = wizState.composition;
  if (!comp) { flash('Нет выбранной конфигурации', 'warn'); return; }
  const rq = wizState.requirements;
  const u = comp.ups;
  const fi = comp.fitInfo;
  const priceStr = comp.totalPrice != null
    ? Number(comp.totalPrice).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + comp.currency
    : 'не указана';
  // v0.60.406 / v0.60.407: контекст параллели для отчёта.
  // ВАЖНО: для модулярного multi-frame parallel единицы = фреймы (НЕ модули).
  const units = _getUpsUnits(comp);
  const N = units.workingUnits;
  const R = units.redundantUnits;
  const installed = units.unitCount;
  const isMulti = installed > 1;
  const battTopology = wizState.batteryTopology || (isMulti ? 'per-unit' : 'shared');
  const battSetsQty = (battTopology === 'per-unit') ? installed : 1;
  const loadPerUnit = Number(rq.loadKw) / Math.max(1, N);
  const battTopologyLbl = (battTopology === 'per-unit')
    ? `на каждый ИБП (per-unit) — ${battSetsQty} комплект(ов) × ${loadPerUnit.toFixed(1)} kW`
    : `общая шина (shared) — 1 комплект × ${rq.loadKw} kW`;
  // v0.60.409: показываем оба уровня резерва раздельно.
  const modScheme = rq.moduleRedundancy || rq.redundancy || 'N';
  const unitScheme = rq.unitRedundancy || 'N';
  const redundancyDetail = isMulti
    ? (R > 0
        ? `Модули: <b>${esc(modScheme)}</b>, ИБП: <b>${esc(unitScheme)}</b> → ${N} рабочих + ${R} резерв = ${installed} ИБП`
        : `Модули: <b>${esc(modScheme)}</b>, ИБП: <b>${esc(unitScheme)}</b> → ${installed} ИБП в параллель`)
    : `Модули: <b>${esc(modScheme)}</b>${unitScheme !== 'N' ? `, ИБП: <b>${esc(unitScheme)}</b>` : ''}`;
  const summary = document.getElementById('wiz-summary');
  summary.innerHTML = `
    <div class="wiz-summary-box">
      <h5>Исходные требования</h5>
      <table class="wiz-summary-table">
        <tr><td>Нагрузка</td><td>${rq.loadKw} kW</td></tr>
        <tr><td>Автономия</td><td>${rq.autonomyMin} мин</td></tr>
        <tr><td>Резервирование</td><td>${esc(redundancyDetail)}</td></tr>
        <tr><td>Тип</td><td>${rq.upsType ? esc((getUpsType(rq.upsType) || {}).label || rq.upsType) : 'любой'}</td></tr>
        <tr><td>V<sub>DC</sub> (по паспорту ИБП)</td><td>${u.vdcMin || '—'}–${u.vdcMax || '—'} В</td></tr>
        <tr><td>cos φ / фазы</td><td>${rq.cosPhi} / ${rq.phases}ph</td></tr>
        ${isMulti ? `<tr><td>🔋 Топология АКБ</td><td>${esc(battTopologyLbl)}</td></tr>` : ''}
        <tr><td>АКБ</td><td>${wizState.batteryChoice === 'skip' ? '<i>пропущены</i>' : (wizState.battery ? (function() {
          const b = wizState.battery;
          const blk = Number(b.totalBlocks) || 0;
          const total = blk * battSetsQty;
          const breakdown = battSetsQty > 1
            ? ` × <b>${battSetsQty}</b> комплект(ов)${blk > 0 ? ` × ${blk} блок = <b>${total} блок всего</b>` : ''}`
            : (blk > 0 ? ` · <b>${blk}</b> блок` : '');
          return esc((b.supplier||'') + ' ' + (b.model||b.id||'')) + breakdown;
        })() : '—')}</td></tr>
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
      <h5>Состав комплекта ИБП (BOM)</h5>
      <table class="wiz-summary-table">
        ${(comp.composition || []).map(it => `
          <tr>
            <td>${esc(it.label || it.role || '—')}</td>
            <td><b>${it.qty} ${it.role === 'frame' ? 'шт.' : (it.role === 'module' ? 'шт. модулей' : 'шт.')}</b>${it.elementId ? ` <span class="muted" style="font-size:10.5px">· ${esc(it.elementId)}</span>` : ''}</td>
          </tr>`).join('')}
      </table>
    </div>
    ${(function() {
      // v0.60.410: состав комплекта АКБ (BOM) — отдельный блок.
      const battComp = _buildBatteryComposition();
      if (!battComp || !battComp.length) return '';
      const totalBlocksAll = (battComp.find(it => it.role === 'battery-block') || {}).qty || 0;
      return `
    <div class="wiz-summary-box" style="background:#f0fdf4;border-left:3px solid #16a34a">
      <h5>Состав комплекта АКБ (BOM)</h5>
      <div class="muted" style="font-size:11px;margin-bottom:8px">
        Топология: <b>${battTopology === 'per-unit' ? 'на каждый ИБП' : 'общая шина'}</b> · Комплектов: <b>${battSetsQty}</b>${totalBlocksAll > 0 ? ` · <b>${totalBlocksAll}</b> блок(ов) всего` : ''}
      </div>
      <table class="wiz-summary-table">
        ${battComp.map(it => `
          <tr>
            <td>${esc(it.label || it.role || '—')}</td>
            <td><b>${it.qty}</b>${it.perSet ? ` <span class="muted" style="font-size:10.5px">(${it.perSet}/комплект × ${it.sets} компл.)</span>` : ''}${it.elementId ? ` <span class="muted" style="font-size:10.5px">· ${esc(it.elementId)}</span>` : ''}</td>
          </tr>`).join('')}
      </table>
    </div>`;
    })()}
    <div class="wiz-summary-box">
      <h5>Стоимость (оборудование ИБП)</h5>
      <table class="wiz-summary-table">
        <tr><td>Цена за ед.</td><td>${comp.unitPrice != null ? Number(comp.unitPrice).toLocaleString('ru-RU') + ' ' + comp.currency : 'нет в каталоге'}</td></tr>
        <tr><td>Количество</td><td>${fi.installed}</td></tr>
        <tr><td><b>Итого ИБП</b></td><td><b>${priceStr}</b></td></tr>
      </table>
      <p class="muted" style="font-size:11px;margin:8px 0 0">
        Цены АКБ добавляются в модуле <a href="../catalog/" target="_blank">«Каталог и цены»</a> (по элементу батареи).
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
      // v0.60.409: раздельные схемы резерва — модули и ИБП.
      moduleRedundancyScheme: rq.moduleRedundancy || rq.redundancy || 'N',
      unitRedundancyScheme: rq.unitRedundancy || 'N',
      batteryVdcMin: u.vdcMin || null,
      batteryVdcMax: u.vdcMax || null,
      batteryAutonomyMin: rq.autonomyMin,
      batterySelection: wizState.battery || null,
      batteryChoice: wizState.batteryChoice || null,
      // v0.60.406 / v0.60.407: топология АКБ (per-unit / shared) + кол-во
      // комплектов. Для модулярного multi-frame parallel — единицы = фреймы.
      batteryTopology: wizState.batteryTopology
        || (_getUpsUnits(comp).unitCount > 1 ? 'per-unit' : 'shared'),
      batterySetsQty: ((wizState.batteryTopology || (_getUpsUnits(comp).unitCount > 1 ? 'per-unit' : 'shared')) === 'shared'
        ? 1
        : _getUpsUnits(comp).unitCount),
      composition: comp.composition,
      // v0.60.410: состав АКБ (BOM) — для отчёта и BOM-агрегации в Конструкторе.
      batteryComposition: _buildBatteryComposition() || [],
      totalPrice: comp.totalPrice,
      currency: comp.currency,
      // v0.59.640: round-trip полей из/в Конструктор схем.
      canParallel: rq.canParallel !== false,
      maxLoadFactorActive: !!rq.maxLoadFactorActive,
      maxLoadFactor: Number.isFinite(rq.maxLoadFactor) ? rq.maxLoadFactor : 0.80,
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

// v0.59.420: печатный отчёт о подобранной конфигурации ИБП.
// Открывает новое окно с разделами «Исходные требования», «Подобранная
// конфигурация», «Стоимость», «Состав комплекта (BOM)» и AKB (если
// выбрана). Используется системный «Печать в PDF» через window.print().
// CSS-правила симметричны battery-calc: h2 не отрывается от следующего
// блока (break-after: avoid), секции и таблицы не разрываются на
// странице (break-inside: avoid).
function _printUpsReport() {
  const comp = wizState.composition;
  if (!comp) { flash('Сначала выберите конфигурацию (Шаг 4)', 'warn'); return; }
  const u = comp.ups || {};
  const fi = comp.fitInfo || {};
  const rq = wizState.requirements || {};
  const battery = wizState.battery || null;
  const upsLabel = [u.supplier, u.model || u.id].filter(Boolean).join(' ') || 'ИБП';
  const priceUnit = (comp.unitPrice != null)
    ? Number(comp.unitPrice).toLocaleString('ru-RU') + ' ' + (comp.currency || '')
    : 'нет в каталоге';
  const priceTotal = (comp.totalPrice != null)
    ? Number(comp.totalPrice).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (comp.currency || '')
    : 'не указана';

  const row = (k, v, unit) => `<tr><td>${esc(k)}</td><td style="text-align:right">${esc(String(v ?? '—'))}</td><td style="text-align:center;color:#666">${esc(unit || '')}</td></tr>`;
  const tbl = (rows) => `<table class="rep"><thead><tr><th>Параметр</th><th style="text-align:right">Значение</th><th style="text-align:center">Ед.</th></tr></thead><tbody>${rows.filter(Boolean).join('')}</tbody></table>`;

  let html = `<!doctype html><html><head><meta charset="utf-8"><title>Конфигурация ИБП — ${esc(upsLabel)}</title>`;
  html += `<style>
    body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color:#1f2430; max-width: 920px; margin: 20px auto; padding: 0 16px; line-height:1.45; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #ccd;
         break-after: avoid-page; page-break-after: avoid; break-inside: avoid; }
    .muted { color:#666; font-size: 12px; }
    table.rep { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0 10px; }
    table.rep th, table.rep td { border: 1px solid #ddd; padding: 4px 8px; }
    table.rep th { background: #f4f6fa; text-align: left; }
    .warn { background:#fff3e0; border:1px solid #ffb74d; padding:6px 10px; border-radius:4px; margin:6px 0; font-size:12px; }
    .section { break-inside: avoid; page-break-inside: avoid; }
    .actions { position:fixed; top:10px; right:14px; }
    .actions button { padding: 6px 12px; font-size: 13px; cursor: pointer; }
    @media print {
      .actions { display:none; }
      body { margin: 0; max-width: none; }
      h2 { break-after: avoid-page; page-break-after: avoid; }
      h2 + table, h2 + p, h2 + div { break-before: avoid-page; page-break-before: avoid; }
      .section { break-inside: avoid; page-break-inside: avoid; }
      tr, thead { break-inside: avoid; page-break-inside: avoid; }
    }
  </style></head><body>`;
  html += `<div class="actions"><button onclick="window.print()">🖨 Печать</button> <button onclick="window.close()">✕ Закрыть</button></div>`;
  html += `<h1>Отчёт о подобранной конфигурации ИБП</h1>`;
  html += `<div class="muted">Модель: <b>${esc(upsLabel)}</b> · Дата: ${new Date().toLocaleString('ru-RU')}</div>`;

  // 1. Исходные требования
  html += `<div class="section"><h2>1. Исходные требования</h2>`;
  const upsTypeLabel = rq.upsType ? ((getUpsType(rq.upsType) || {}).label || rq.upsType) : 'любой';
  html += tbl([
    row('Нагрузка', rq.loadKw, 'кВт'),
    row('Автономия', rq.autonomyMin, 'мин'),
    row('Резервирование', rq.redundancy, ''),
    row('Тип ИБП', upsTypeLabel, ''),
    row('V_DC (по паспорту ИБП)', `${u.vdcMin || '—'}…${u.vdcMax || '—'}`, 'В'),
    row('cos φ', rq.cosPhi, '—'),
    row('Фазы', rq.phases, ''),
    row('АКБ', wizState.batteryChoice === 'skip'
      ? 'пропущены'
      : (battery ? [(battery.supplier || ''), (battery.model || battery.id || '')].filter(Boolean).join(' ') : '—'), ''),
  ]);
  html += `</div>`;

  // 2. Подобранная конфигурация
  html += `<div class="section"><h2>2. Подобранная конфигурация</h2>`;
  const tDef = getUpsTypeOrFallback(u);
  const upsTypeName = tDef && tDef.label ? tDef.label : (u.upsType || '—');
  // Frame/modules детализация для модульного типа.
  const isModular = (u.upsType === 'modular') || Number(u.frameKw) > 0 || Number(u.moduleSlots) > 0;
  html += tbl([
    row('Модель', upsLabel, ''),
    row('Тип', upsTypeName, ''),
    isModular ? row('Корпус (frame)', u.frameKw, 'кВт') : '',
    isModular ? row('Модуль', u.moduleKwRated, 'кВт') : '',
    isModular ? row('Установлено модулей', `${fi.installed} из ${u.moduleSlots || '—'}`, 'шт.') : '',
    isModular ? row('Рабочих модулей', fi.working, 'шт.') : '',
    isModular ? row('Резерв', fi.redundant, 'шт.') : '',
    row('Реальная мощность', fi.realCapacity || fi.usable, 'кВт'),
    row('Итоговая мощность', fi.usable, 'кВт'),
    row('КПД DC–AC', u.efficiency, '%'),
    row('cos φ ИБП', u.cosPhi, '—'),
    row('Топология (IEC 62040-3)', u.topology, ''),
    row('V_DC мин/макс', `${u.vdcMin || '—'}…${u.vdcMax || '—'}`, 'В'),
    row('Входов / Выходов', `${u.inputs || 1} / ${u.outputs || 1}`, ''),
  ]);
  html += `</div>`;

  // 3. Стоимость
  html += `<div class="section"><h2>3. Стоимость (оборудование ИБП)</h2>`;
  html += tbl([
    row('Цена за единицу', priceUnit, ''),
    row('Количество', fi.installed, 'шт.'),
    row('Итого ИБП', priceTotal, ''),
  ]);
  html += `<p class="muted">АКБ подбирается отдельно в «Калькуляторе АКБ». Цены пополняются в модуле «Каталог и цены».</p>`;
  html += `</div>`;

  // 4. Состав комплекта (BOM) — если есть.
  if (Array.isArray(comp.composition) && comp.composition.length) {
    html += `<div class="section"><h2>4. Состав комплекта (BOM)</h2>`;
    html += `<table class="rep"><thead><tr><th>Поз.</th><th>Наименование</th><th style="text-align:right">Кол-во</th><th style="text-align:right">Цена за ед.</th><th style="text-align:right">Сумма</th></tr></thead><tbody>`;
    comp.composition.forEach((it, idx) => {
      const qty  = Number(it.qty) || 0;
      const unit = (it.unitPrice != null) ? Number(it.unitPrice).toLocaleString('ru-RU') + ' ' + (it.currency || comp.currency || '') : '—';
      const sum  = (it.unitPrice != null) ? (qty * Number(it.unitPrice)).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (it.currency || comp.currency || '') : '—';
      const name = [it.supplier || '', it.label || it.model || it.id || it.kind || ''].filter(Boolean).join(' ');
      html += `<tr><td>${idx + 1}</td><td>${esc(name)}</td><td style="text-align:right">${qty}</td><td style="text-align:right">${esc(unit)}</td><td style="text-align:right">${esc(sum)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // 5. АКБ — если выбрана. На новой странице.
  if (battery && wizState.batteryChoice !== 'skip') {
    const sectionNo = Array.isArray(comp.composition) && comp.composition.length ? '5' : '4';
    const articleUpper = String(battery.model || battery.type || battery.id || '').toUpperCase();
    html += `<div class="section" style="page-break-before:always;break-before:page"><h2>${sectionNo}. Аккумуляторная батарея</h2>`;
    html += tbl([
      row('Производитель', battery.supplier, ''),
      row('Модель', articleUpper, ''),
      row('Тип АКБ', battery.chemistry === 'li-ion' ? 'Li-Ion (LFP)' : 'VRLA', ''),
      row('Напряжение блока', battery.blockVoltage, 'В'),
      row('Ёмкость блока', battery.capacityAh, 'А·ч'),
      battery.dcVoltage != null ? row('Напряжение DC-шины', battery.dcVoltage, 'В') : '',
      battery.blocksPerString != null ? row('Блоков в цепочке', battery.blocksPerString, 'шт.') : '',
      battery.strings != null ? row('Параллельных цепочек', battery.strings, 'шт.') : '',
      battery.totalBlocks != null ? row('Всего блоков (модулей)', battery.totalBlocks, 'шт.') : '',
      battery.totalKwh != null ? row('Суммарная ёмкость АКБ', Number(battery.totalKwh).toFixed(1), 'кВт·ч') : '',
      battery.autonomyMin != null ? row('Расчётная автономия', Number(battery.autonomyMin).toFixed(1), 'мин') : '',
      battery.endV != null ? row('Конечное напряжение элемента', battery.endV, 'В') : '',
      battery.invEff != null ? row('КПД инвертора (учёт)', (Number(battery.invEff) * 100).toFixed(0), '%') : '',
      battery.mode ? row('Режим расчёта', battery.mode === 'autonomy' ? 'Прямой (автономия по блокам)' : 'Обратный (блоки по автономии)', '') : '',
    ]);
    if (battery.derate && (battery.derate.kAge || battery.derate.kTemp || battery.derate.kDesign)) {
      const d = battery.derate;
      html += `<h2 style="margin-top:14px">Коэффициенты расчёта (IEEE 485 / IEC 62040)</h2>`;
      html += tbl([
        d.kAge    != null ? row('k_age (старение, EOL)', Number(d.kAge).toFixed(2), '—') : '',
        d.kTemp   != null ? row('k_temp (температура)',   Number(d.kTemp).toFixed(2), '—') : '',
        d.kDesign != null ? row('k_design (запас)',       Number(d.kDesign).toFixed(2), '—') : '',
        d.kTotal  != null ? row('k_total',                Number(d.kTotal).toFixed(3), '—') : '',
        d.vdcSafetyPct != null ? row('Окно V_DC',         '±' + Number(d.vdcSafetyPct).toFixed(1), '%') : '',
        d.socMinPct    != null ? row('Резерв SoC (Li-ion)', Number(d.socMinPct).toFixed(0), '%') : '',
      ]);
    }
    html += `<p class="muted">Расчёт выполнен в подпрограмме «Расчёт АКБ»; полный отчёт с графиком разряда доступен там же.</p>`;
    // v0.60.410: состав комплекта АКБ (BOM-таблица) — как для ИБП.
    const battComp = _buildBatteryComposition();
    if (battComp && battComp.length) {
      const totalBlocksAll = (battComp.find(it => it.role === 'battery-block') || {}).qty || 0;
      const battTopologyR = wizState.batteryTopology
        || (_getUpsUnits(wizState.composition).unitCount > 1 ? 'per-unit' : 'shared');
      const battSetsQtyR = (battTopologyR === 'shared') ? 1 : _getUpsUnits(wizState.composition).unitCount;
      html += `<h2 style="margin-top:14px">Состав комплекта АКБ (BOM)</h2>`;
      html += `<p class="muted">Топология: <b>${battTopologyR === 'per-unit' ? 'на каждый ИБП (per-unit)' : 'общая шина (shared)'}</b> · Комплектов: <b>${battSetsQtyR}</b>${totalBlocksAll > 0 ? ` · <b>${totalBlocksAll}</b> блок(ов) всего` : ''}</p>`;
      html += `<table class="rep"><thead><tr><th>Поз.</th><th>Наименование</th><th style="text-align:right">Кол-во</th><th style="text-align:right">На комплект</th></tr></thead><tbody>`;
      battComp.forEach((it, idx) => {
        html += `<tr><td>${idx + 1}</td><td>${esc(it.label || it.role || '—')}${it.elementId ? ` <span style="color:#9ca3af;font-size:11px">(${esc(it.elementId)})</span>` : ''}</td><td style="text-align:right">${it.qty}</td><td style="text-align:right">${it.perSet ? it.perSet : (it.role === 'battery-set' ? '—' : (it.qty / battSetsQtyR).toFixed(0))}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    html += `</div>`;
  }

  html += `<hr style="margin-top:18px"><p class="muted">Документ сформирован автоматически Raschet · ${new Date().toLocaleDateString('ru-RU')}</p>`;
  html += `</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { flash('Не удалось открыть окно печати — проверьте блокировщик всплывающих окон.', 'error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); } catch (e) {} }, 200);
}
