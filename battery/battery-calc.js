// ======================================================================
// battery-calc.js — главный UI подпрограммы «Расчёт АКБ».
// Состоит из двух вкладок:
//   1. Справочник АКБ — загрузка XLSX, просмотр/удаление моделей
//   2. Расчёт разряда — выбор АКБ + параметры нагрузки → автономия
// ======================================================================

import { listBatteries, addBattery, removeBattery, clearCatalog, getBattery, makeBatteryId } from './battery-catalog.js';
import { rsToast, rsConfirm } from '../shared/dialog.js';
import { parseBatteryXlsx } from './battery-data-parser.js';
import { calcAutonomy, calcRequiredBlocks, interpTimeByPower } from './battery-discharge.js';
import * as Report from '../shared/report/index.js';
import * as B      from '../shared/report/blocks.js';

// Последнее состояние расчёта АКБ для экспорта отчёта
let lastBatteryCalc = null;
import { mountBatteryPicker, extractBatterySeries } from '../shared/battery-picker.js';
import { KEHUA_S3_BATTERIES } from '../shared/catalogs/battery-kehua-s3.js';
import { listUpses, getUps } from '../shared/ups-catalog.js';
import { isUpsVdcVerified } from '../shared/ups-verified.js';
// v0.59.446: единый источник правды seed-данных ИБП (Kehua MR33/S3 AIO,
// Schneider, Eaton, Legrand, DKC). Импорт инициализирует каталог.
import '../shared/ups-seed.js';
// v0.59.448: единый источник правды seed-данных АКБ (Kehua S³).
// Аналогично ups-seed.js — раньше требовался ручной клик на кнопку.
import '../shared/battery-seed.js';
// v0.59.447: реестр типов ИБП (плагины) — single source of truth для
// фильтра «Тип» (моноблок/модульный/интегрированный/all-in-one).
import { listUpsTypes, detectUpsType } from '../shared/ups-types/index.js';
// v0.59.417: ЕДИНЫЙ источник логики S³ — тот же модуль, что в инспекторе.
import { isS3Module, computeS3Configuration, findMinimalS3Config } from '../shared/battery-s3-logic.js';
// v0.59.427: плагин типа АКБ S³ — автосборка master/slave/combiner + аксессуары.
import { s3LiIonType } from '../shared/battery-types/s3-li-ion.js';
import { renderS3IsoSvg } from '../shared/battery-types/s3-iso-view.js';
import { mountS3ThreeDView } from '../shared/battery-types/s3-3d-view.js';
import { saveConfig as _saveConfig, nextConfigId as _nextConfigId, getActiveProjectCode as _getActiveProjectCode } from '../shared/configuration-catalog.js';

const fmt = (n, d = 2) => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(d);
};
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

// v0.59.456: единый человекочитаемый лейбл для chemistry. Раньше показывали
// сырые id ('vrla', 'li-ion') в UI. Поле называется «Тип АКБ» (соглашение UI).
const CHEM_LABELS = {
  'vrla':       'Свинцово-кислотные (VRLA/AGM)',
  'lead-acid':  'Свинцово-кислотные (VRLA/AGM)',
  'li-ion':     'Литий-ионные (LFP)',
  'lifepo4':    'Литий-ионные (LFP)',
  'nicd':       'Никель-кадмиевые (NiCd)',
  'nimh':       'Никель-металл-гидридные (NiMH)',
};
const chemLabel = (c) => {
  if (!c) return '—';
  const k = String(c).toLowerCase();
  return CHEM_LABELS[k] || String(c).toUpperCase();
};

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) { rsToast(msg, 'info'); return; }
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// ================= Каталог =================
// Состояние каскадного пикера справочника (persist между рендерами).
// Используется ТОТ ЖЕ shared/battery-picker.js, что и в UPS-инспекторе, —
// модуль подбора АКБ идентичен во всех подпрограммах.
const _catCascade = { supplier: '', series: '', modelId: '' };
let _catPickerHandle = null;
function _mountCatalogPicker(all) {
  const mount = document.getElementById('cat-cascade-mount');
  if (!mount) return;
  _catPickerHandle = mountBatteryPicker(mount, {
    list: all,
    selectedId: _catCascade.modelId || null,
    currentSupplier: _catCascade.supplier,
    currentSeries: _catCascade.series,
    placeholders: { supplier: 'Все производители', series: 'Все серии', model: 'Все модели' },
    labels: { supplier: 'Производитель', series: 'Серия', model: 'Модель' },
    idPrefix: 'cat',
    onChange: (st) => {
      _catCascade.supplier = st.supplier || '';
      _catCascade.series   = st.series   || '';
      _catCascade.modelId  = st.modelId  || '';
      renderCatalog();
    },
  });
}

function _getCatalogFilters() {
  return {
    text: (document.getElementById('cat-filter-text')?.value || '').trim().toLowerCase(),
    chem: document.getElementById('cat-filter-chem')?.value || '',
    custom: document.getElementById('cat-filter-custom')?.value || '',
  };
}

function renderCatalog() {
  const wrap = document.getElementById('catalog-list');
  if (!wrap) return;
  const all = listBatteries();
  // Монтируем/обновляем каскадный пикер справочника
  if (!_catPickerHandle) _mountCatalogPicker(all);
  else _catPickerHandle.refresh(all);

  const { text, chem, custom } = _getCatalogFilters();
  // Применяем фильтры (включая каскад Производитель → Серия → Модель)
  // и сортировку (по поставщику → V блока → Ah → модели).
  const list = _sortBatteries(all.filter(b => {
    // v0.59.460: справочник АКБ показывает только сами АКБ-модули.
    // Шкафы (cabinet) и аксессуары (combiner, networking, blank panels,
    // wire kits) скрыты — они не АКБ, а компоненты систем.
    if (b.systemSubtype === 'cabinet' || b.systemSubtype === 'accessory') return false;
    if (chem && (b.chemistry || '').toLowerCase() !== chem) return false;
    if (custom === 'imported' && b.custom === true) return false;
    if (custom === 'custom' && b.custom !== true) return false;
    if (_catCascade.supplier && (b.supplier || 'Unknown') !== _catCascade.supplier) return false;
    if (_catCascade.series && extractBatterySeries(b.type) !== _catCascade.series) return false;
    if (_catCascade.modelId && b.id !== _catCascade.modelId) return false;
    if (text) {
      const hay = `${b.supplier} ${b.type} ${b.chemistry || ''} ${b.source || ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  }));
  if (!all.length) {
    wrap.innerHTML = `<div class="empty">Справочник пуст. Загрузите XLSX-файлы через «+ Загрузить» или добавьте запись вручную.</div>`;
    return;
  }
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">По заданным фильтрам ничего не найдено. Попробуйте очистить поиск.</div>`;
    return;
  }
  const h = ['<table class="cat-table">'];
  h.push('<thead><tr><th></th><th>Поставщик</th><th>Модель</th><th>Тип АКБ</th><th>Блок</th><th>Ёмкость</th><th>Точек</th><th>Источник</th><th></th></tr></thead>');
  h.push('<tbody>');
  for (const b of list) {
    const isCustom = b.custom === true;
    const isSystem = b.isSystem === true;
    const lockIcon = isSystem ? '🏛' : (isCustom ? '✎' : '🔒');
    const lockTitle = isSystem
      ? `Готовая система (${b.systemType || 'system'}) — шкаф с модульной архитектурой. ${b.compatibleNotes || ''}`
      : (isCustom ? 'Ручная запись — редактируется' : 'Импортированная запись — только чтение');
    const iconColor = isSystem ? '#e65100' : (isCustom ? '#2e7d32' : '#90a4ae');
    const typeLabel = isSystem
      ? `<b>${escHtml(b.type)}</b><br><span class="muted" style="font-size:10px">Шкаф ${b.cabinetKwh || '?'} кВт·ч / ${b.cabinetPowerKw || '?'} кВт</span>`
      : `<b>${escHtml(b.type)}</b>`;
    h.push(`<tr data-id="${escHtml(b.id)}" class="cat-row" title="Клик — посмотреть таблицу разряда">
      <td title="${escHtml(lockTitle)}" style="text-align:center;font-size:14px;color:${iconColor}">${lockIcon}</td>
      <td>${escHtml(b.supplier)}</td>
      <td>${typeLabel}</td>
      <td>${escHtml(chemLabel(b.chemistry))}</td>
      <td>${fmt(b.blockVoltage)} В</td>
      <td>${b.capacityAh != null ? fmt(b.capacityAh) + ' А·ч' : '—'}</td>
      <td>${b.dischargeTable?.length || 0}</td>
      <td class="src">${escHtml(b.source || '')}</td>
      <td>
        <button class="btn-sm btn-curve" data-curve="${escHtml(b.id)}" title="Открыть таблицу и кривую разряда">📈 Кривая</button>
        <button class="btn-sm btn-copy" data-copy="${escHtml(b.id)}" title="Создать редактируемую копию">Копировать</button>
        ${isCustom ? `<button class="btn-sm btn-edit" data-edit="${escHtml(b.id)}">Изменить</button>` : ''}
        <button class="btn-sm btn-del" data-del="${escHtml(b.id)}">Удалить</button>
      </td>
    </tr>`);
  }
  h.push('</tbody></table>');
  wrap.innerHTML = h.join('');
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!(await rsConfirm('Удалить эту запись из справочника?', '', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
      removeBattery(id);
      renderCatalog();
      renderBatterySelector();
      flash('Удалено');
    });
  });
  wrap.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.edit;
      const b = listBatteries().find(x => x.id === id);
      if (b) openManualBatteryModal(b);
    });
  });
  // Явная кнопка «Кривая» — открывает модалку таблицы/кривой разряда
  // (то же действие, что и клик по строке, но без неявности).
  wrap.querySelectorAll('[data-curve]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.curve;
      const b = listBatteries().find(x => x.id === id);
      if (b) openDischargeTableModal(b);
    });
  });
  // Копирование записи (в т.ч. импортированной) → новая редактируемая строка.
  // Модалка ручного ввода открывается с pre-filled полями, но без existing →
  // при сохранении создастся новая запись с custom:true и новым id.
  wrap.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.copy;
      const src = listBatteries().find(x => x.id === id);
      if (!src) return;
      const copy = {
        // Сохраняем все поля кроме id / custom / source / importedAt
        supplier: src.supplier || '',
        type: (src.type || '') + ' (копия)',
        chemistry: src.chemistry || 'vrla',
        blockVoltage: src.blockVoltage,
        cellCount: src.cellCount,
        cellVoltage: src.cellVoltage,
        capacityAh: src.capacityAh,
        dischargeTable: Array.isArray(src.dischargeTable)
          ? src.dischargeTable.map(p => ({ ...p }))
          : [],
        // custom/id/source будут проставлены при сохранении
      };
      // existing=null → модалка создаст новую запись
      openManualBatteryModal(null, copy);
    });
  });
  // Клик по строке → модалка просмотра таблицы разряда
  wrap.querySelectorAll('.cat-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const b = listBatteries().find(x => x.id === id);
      if (b) openDischargeTableModal(b);
    });
  });
}

// ================= Ручное добавление / редактирование АКБ =================
// existing — запись для редактирования (режим UPDATE, ID сохраняется).
// prefill  — данные для заполнения полей при СОЗДАНИИ новой записи (режим
//            COPY): существующая запись копируется в новую редактируемую.
function openManualBatteryModal(existing = null, prefill = null) {
  let modal = document.getElementById('manual-batt-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manual-batt-modal';
    modal.className = 'dtable-modal';
    modal.innerHTML = `
      <div class="dtable-box" style="max-width:680px">
        <div class="dtable-head">
          <h3 id="manual-batt-title">Добавить АКБ вручную</h3>
          <button class="dtable-close" aria-label="Закрыть">×</button>
        </div>
        <div class="dtable-body" id="manual-batt-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.dtable-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const title = document.getElementById('manual-batt-title');
  const body = document.getElementById('manual-batt-body');
  title.textContent = existing
    ? `Редактировать: ${existing.supplier} · ${existing.type}`
    : (prefill ? `Копия: ${prefill.supplier} · ${prefill.type}` : 'Добавить АКБ вручную');

  // Источник данных для полей: existing (edit) → prefill (copy) → {} (new)
  const e = existing || prefill || {};
  // Таблица разряда → CSV (endV,tMin,powerW по строке)
  const tableCsv = Array.isArray(e.dischargeTable)
    ? e.dischargeTable.map(p => `${p.endV},${p.tMin},${p.powerW}`).join('\n')
    : '';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px">
      <label>Поставщик<input id="mb-supplier" type="text" value="${escHtml(e.supplier || '')}" ${existing ? 'disabled' : ''}></label>
      <label>Модель<input id="mb-type" type="text" value="${escHtml(e.type || '')}" ${existing ? 'disabled' : ''}></label>
      <label>Тип АКБ
        <select id="mb-chemistry">
          <option value="vrla"${e.chemistry === 'vrla' ? ' selected' : ''}>Свинцово-кислотные (VRLA/AGM)</option>
          <option value="li-ion"${e.chemistry === 'li-ion' ? ' selected' : ''}>Литий-ионные (LiFePO4)</option>
          <option value="nicd"${e.chemistry === 'nicd' ? ' selected' : ''}>Никель-кадмиевые</option>
          <option value="nimh"${e.chemistry === 'nimh' ? ' selected' : ''}>Никель-металлогидридные</option>
        </select>
      </label>
      <label>Напряжение блока, В<input id="mb-blockV" type="number" min="1" step="0.5" value="${e.blockVoltage ?? 12}"></label>
      <label>Ёмкость блока, А·ч<input id="mb-capAh" type="number" min="1" step="1" value="${e.capacityAh ?? 100}"></label>
      <label>Элементов в блоке<input id="mb-cellCount" type="number" min="1" step="1" value="${e.cellCount ?? 6}"></label>
    </div>
    <div style="margin-top:10px;padding:8px 10px;background:#f6f8fa;border-radius:4px">
      <div style="font-size:11px;font-weight:600;color:#1976d2;margin-bottom:6px">Габариты и монтаж (для компоновки VRLA-шкафа)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 14px">
        <label>Длина, мм<input id="mb-lengthMm" type="number" min="0" step="1" value="${e.lengthMm ?? ''}"></label>
        <label>Ширина, мм<input id="mb-widthMm" type="number" min="0" step="1" value="${e.widthMm ?? ''}"></label>
        <label>Высота, мм<input id="mb-heightMm" type="number" min="0" step="1" value="${e.heightMm ?? ''}"></label>
        <label>Масса, кг<input id="mb-weightKg" type="number" min="0" step="0.1" value="${e.weightKg ?? ''}"></label>
        <label>Зазор до клемм, мм<input id="mb-termClear" type="number" min="0" step="1" value="${e.terminalClearanceMm ?? 15}" title="Минимальный зазор между токоведущими клеммами и металлом корпуса/полки (электробезопасность)"></label>
        <label>Клеммы<select id="mb-termPos">
          <option value="top"${e.terminalPosition === 'top' ? ' selected' : ''}>сверху</option>
          <option value="front"${e.terminalPosition === 'front' ? ' selected' : ''}>спереди</option>
          <option value="side"${e.terminalPosition === 'side' ? ' selected' : ''}>сбоку</option>
        </select></label>
      </div>
    </div>
    <div style="margin-top:12px">
      <label style="display:block;margin-bottom:4px;font-size:12px;color:#6b7280">
        Таблица разряда (Constant Power Discharge) — опционально.<br>
        Формат: <code>endV,tMin,powerW</code> — по строке. Например:
        <code>1.6,10,3474</code>
      </label>
      <textarea id="mb-table" rows="10" style="width:100%;font:11px/1.4 ui-monospace,Consolas,monospace;padding:8px;border:1px solid #d0d0d0;border-radius:5px;resize:vertical">${escHtml(tableCsv)}</textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button type="button" id="mb-cancel" class="btn-sm">Отмена</button>
      <button type="button" id="mb-save" class="btn-sm" style="background:#1976d2;color:#fff;border-color:#1976d2">${existing ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  const g = id => document.getElementById(id);
  g('mb-cancel').addEventListener('click', () => modal.classList.remove('show'));
  g('mb-save').addEventListener('click', () => {
    const supplier = g('mb-supplier').value.trim() || 'Custom';
    const type = g('mb-type').value.trim();
    if (!type) { rsToast('Заполните поле «Модель»', 'warn'); return; }
    const chemistry = g('mb-chemistry').value;
    const blockVoltage = Number(g('mb-blockV').value) || 12;
    const capacityAh = Number(g('mb-capAh').value) || 0;
    const cellCount = Math.max(1, Number(g('mb-cellCount').value) || Math.round(blockVoltage / 2));
    const cellVoltage = blockVoltage / cellCount;
    // Парсим таблицу разряда из CSV
    const raw = g('mb-table').value.trim();
    const table = [];
    if (raw) {
      for (const line of raw.split(/\r?\n/)) {
        const parts = line.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 3) continue;
        const endV = Number(parts[0]);
        const tMin = Number(parts[1]);
        const powerW = Number(parts[2]);
        if (Number.isFinite(endV) && Number.isFinite(tMin) && Number.isFinite(powerW)) {
          table.push({ endV, tMin, powerW });
        }
      }
      table.sort((a, b) => (a.endV - b.endV) || (a.tMin - b.tMin));
    }
    // Габариты и монтаж (опционально — для компоновки VRLA-шкафа)
    const lengthMm = Number(g('mb-lengthMm').value) || null;
    const widthMm = Number(g('mb-widthMm').value) || null;
    const heightMm = Number(g('mb-heightMm').value) || null;
    const weightKg = Number(g('mb-weightKg').value) || null;
    const terminalClearanceMm = Number(g('mb-termClear').value) || 15;
    const terminalPosition = g('mb-termPos').value || 'top';
    const id = existing ? existing.id : makeBatteryId(supplier, type);
    const entry = {
      id,
      supplier,
      type,
      chemistry,
      blockVoltage,
      cellCount,
      cellVoltage,
      capacityAh,
      dischargeTable: table,
      lengthMm,
      widthMm,
      heightMm,
      weightKg,
      terminalClearanceMm,
      terminalPosition,
      source: existing ? existing.source : 'ручной ввод',
      importedAt: existing ? existing.importedAt : Date.now(),
      custom: true,
    };
    addBattery(entry);
    renderCatalog();
    renderBatterySelector();
    modal.classList.remove('show');
    flash(existing ? 'Запись обновлена' : 'Добавлено: ' + type, 'success');
  });

  modal.classList.add('show');
}

// ================= Модалка справки =================
// Две секции: format (формат XLSX для загрузки) и method (методика расчёта).
function openHelpModal(which = 'format') {
  let modal = document.getElementById('help-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'help-modal';
    modal.className = 'dtable-modal';
    modal.innerHTML = `
      <div class="dtable-box" style="max-width:820px">
        <div class="dtable-head">
          <h3 id="help-title"></h3>
          <button class="dtable-close" aria-label="Закрыть">×</button>
        </div>
        <div class="dtable-body help-body" id="help-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.dtable-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const title = document.getElementById('help-title');
  const body = document.getElementById('help-body');
  if (which === 'format') {
    title.textContent = 'Формат XLSX-файлов справочника АКБ';
    body.innerHTML = `
      <p>Справочник импортирует таблицы Constant Power Discharge Table в
      «long-format». Каждая строка — одна точка (endV, tMin, powerW)
      для одной модели.</p>

      <h4>Обязательные колонки</h4>
      <table class="dtable-grid" style="margin-bottom:12px">
        <thead><tr><th>Колонка</th><th>Тип</th><th>Описание</th></tr></thead>
        <tbody>
          <tr><th>Battery_Supplier</th><td>текст</td><td>Производитель (например, Kehua, Panasonic, Sonnenschein)</td></tr>
          <tr><th>Battery_Type</th><td>текст</td><td>Модель / артикул (например, 6-GFM150, LC-P127R2PG1)</td></tr>
          <tr><th>Capacity</th><td>число</td><td>Номинальная ёмкость блока, А·ч</td></tr>
          <tr><th>End_Voltage</th><td>число</td><td>Конечное напряжение на элемент, В (обычно 1.60 / 1.65 / 1.70 / 1.75 / 1.80 / 1.85)</td></tr>
          <tr><th>Time_Value</th><td>число</td><td>Длительность разряда, мин (3, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200…)</td></tr>
          <tr><th>Power_Value</th><td>число</td><td>Мощность, W, которую отдаёт БЛОК за указанное время</td></tr>
        </tbody>
      </table>

      <h4>Пример строки</h4>
      <div style="font:11px/1.5 ui-monospace,Consolas,monospace;background:#f6f8fa;padding:8px 12px;border-radius:4px;margin-bottom:12px">
        Kehua&nbsp;&nbsp;6-GFM150&nbsp;&nbsp;150&nbsp;&nbsp;1.65&nbsp;&nbsp;60&nbsp;&nbsp;1186
      </div>
      <p>→ блок Kehua 6-GFM150 (150 А·ч) отдаёт 1186 W в течение 60 минут
      при разряде до 1.65 В/элемент.</p>

      <h4>Несколько моделей в одном файле</h4>
      <p>Файл может содержать строки разных моделей — парсер автоматически
      сгруппирует их по (Battery_Supplier, Battery_Type) и создаст отдельную
      запись в справочнике для каждой комбинации. Для каждой группы
      определяется тип АКБ (по имени модели: Li/LFP → li-ion, иначе VRLA),
      напряжение блока (эвристика по имени / End_Voltage диапазону) и
      количество элементов в блоке.</p>

      <h4>Где взять данные</h4>
      <p>Datasheets производителей АКБ. Почти у всех есть Constant Power
      Discharge Table на данных страницах — нужно лишь перенести в XLSX
      с указанными колонками. Проверенные источники: Kehua, Panasonic,
      SVC, Sonnenschein, Leoch, CSB, Yuasa, Fiamm.</p>

      <h4>Импортированные vs ручные записи</h4>
      <p>Записи из XLSX помечаются замком 🔒 — они read-only. Записи,
      созданные через «+ Добавить вручную», помечаются иконкой ✎ —
      их можно редактировать и удалять.</p>
    `;
  } else if (which === 'method') {
    title.textContent = 'Методика расчёта разряда АКБ';
    body.innerHTML = `
      <h4>Две модели расчёта</h4>
      <p>Расчётный движок (<code>battery-discharge.js</code>) работает в двух режимах:</p>
      <ol>
        <li><b>По таблице</b> — если у выбранной модели есть Constant Power
          Discharge Table, берутся значения прямо из неё с линейной
          интерполяцией по времени для выбранного конечного напряжения
          на элемент. Это точный метод, рекомендуется.</li>
        <li><b>Усреднённая модель</b> (fallback) — если таблицы нет,
          используется энергобалансовая формула с коэффициентом эффективности
          разряда, учитывающим эффект Пойкерта по химии и времени.</li>
      </ol>

      <h4>Мощность на блок</h4>
      <p>При заданной нагрузке <code>P<sub>load</sub></code> (кВт), КПД инвертора
      <code>η<sub>inv</sub></code>, числе параллельных цепочек <code>N<sub>str</sub></code>
      и числе блоков в цепочке <code>M<sub>blk</sub></code>:</p>
      <div style="font:13px/1.6 ui-monospace,Consolas,monospace;background:#f6f8fa;padding:10px 14px;border-radius:4px;margin:8px 0">
        P<sub>block</sub> = (P<sub>load</sub> × 1000 / η<sub>inv</sub>) / (N<sub>str</sub> × M<sub>blk</sub>) [W]
      </div>
      <p>Все блоки в цепочке несут одинаковый ток, поэтому на каждый блок
      приходится равная доля мощности с учётом КПД инвертора.</p>

      <h4>Режим «по таблице»</h4>
      <p>Обратная интерполяция: при заданной мощности <code>P<sub>block</sub></code> и
      выбранном <code>endV</code> находим ближайшую кривую <code>endV</code> в таблице
      и ищем отрезок [t<sub>i</sub>, t<sub>i+1</sub>], в который попадает мощность
      (с учётом того, что мощность монотонно убывает с ростом времени разряда):</p>
      <div style="font:13px/1.6 ui-monospace,Consolas,monospace;background:#f6f8fa;padding:10px 14px;border-radius:4px;margin:8px 0">
        k = (P<sub>i</sub> − P<sub>block</sub>) / (P<sub>i</sub> − P<sub>i+1</sub>)<br>
        t = t<sub>i</sub> + (t<sub>i+1</sub> − t<sub>i</sub>) × k [мин]
      </div>
      <p>Если <code>P<sub>block</sub></code> больше максимальной точки кривой (слишком
      большая нагрузка на блок) — возвращается 0 (неосуществимо). Если
      меньше минимальной — ∞.</p>

      <h4>Режим «усреднённая модель»</h4>
      <p>Энергия блока: <code>E = V<sub>blk</sub> × C × η<sub>bat</sub>(t)</code>, где
      <code>η<sub>bat</sub>(t)</code> — доступная доля ёмкости при данном времени
      разряда (эффект Пойкерта). Для VRLA:</p>
      <table class="dtable-grid" style="font-size:11px;margin-bottom:12px">
        <thead><tr><th>t, мин</th><th>&lt; 5</th><th>5–15</th><th>15–30</th><th>30–60</th><th>60–180</th><th>≥ 180</th></tr></thead>
        <tbody><tr><th>η<sub>bat</sub></th><td>0.45</td><td>0.58</td><td>0.68</td><td>0.78</td><td>0.85</td><td>0.90</td></tr></tbody>
      </table>
      <p>Для Li-Ion эффект Пойкерта слабее: η<sub>bat</sub> = 0.88…0.96
      в том же диапазоне.</p>
      <p>Далее итеративно подбирается время (t зависит от η<sub>bat</sub>, которое
      зависит от t) через 5 итераций сходимости:</p>
      <div style="font:13px/1.6 ui-monospace,Consolas,monospace;background:#f6f8fa;padding:10px 14px;border-radius:4px;margin:8px 0">
        t<sub>n+1</sub> = (V<sub>blk</sub> × C × η<sub>bat</sub>(t<sub>n</sub>) / P<sub>block</sub>) × 60
      </div>

      <h4>Обратная задача</h4>
      <p>Сколько блоков нужно для целевой автономии <code>t<sub>target</sub></code>?
      Функция <code>calcRequiredBlocks</code> перебирает <code>N<sub>str</sub></code> от 1
      вверх при фиксированном <code>M<sub>blk</sub></code> (из <code>dcVoltage /
      battery.blockVoltage</code>) до первого <code>t ≥ t<sub>target</sub></code>, либо
      пока totalBlocks не превысит 2000.</p>

      <h4>Интеграция с конструктором схем</h4>
      <p>В инспекторе ИБП конструктора есть модалка «🔋 АКБ» с селектором
      моделей из справочника. Если выбрана модель с таблицей — автономия
      считается через <code>calcAutonomy</code> с указанием «по таблице разряда»
      (зелёный), иначе «усреднённая модель» (серый).</p>
    `;
  }
  modal.classList.add('show');
}

// ================= Модалка просмотра таблицы разряда =================
function openDischargeTableModal(battery) {
  let modal = document.getElementById('dtable-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dtable-modal';
    modal.className = 'dtable-modal';
    modal.innerHTML = `
      <div class="dtable-box">
        <div class="dtable-head">
          <h3 id="dtable-title"></h3>
          <button class="dtable-close" aria-label="Закрыть">×</button>
        </div>
        <div class="dtable-body" id="dtable-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    modal.querySelector('.dtable-close').addEventListener('click', () => modal.classList.remove('show'));
  }
  const title = document.getElementById('dtable-title');
  const bodyEl = document.getElementById('dtable-body');
  title.textContent = `${battery.supplier} · ${battery.type}`;

  const rows = (battery.dischargeTable || []).slice();
  if (!rows.length) {
    bodyEl.innerHTML = '<div class="empty">В записи нет точек таблицы разряда.</div>';
  } else {
    // Сводка
    const endVs = [...new Set(rows.map(p => p.endV))].sort((a, b) => a - b);
    const tMins = [...new Set(rows.map(p => p.tMin))].sort((a, b) => a - b);
    // Строим wide-таблицу: строки = tMin, колонки = endV
    const grid = new Map();
    for (const p of rows) grid.set(`${p.endV}|${p.tMin}`, p.powerW);

    const maxPowerW = _getBatteryMaxPowerW(battery);
    const pk = battery.packaging || {};
    let html = `<div class="muted" style="font-size:11px;margin-bottom:8px">
      Модель: <b>${escHtml(battery.type)}</b>
      · Поставщик: <b>${escHtml(battery.supplier)}</b>
      · Тип АКБ: <b>${escHtml(chemLabel(battery.chemistry))}</b>
      · Напр. блока: <b>${fmt(battery.blockVoltage)} В</b>
      ${battery.capacityAh != null ? '· Ёмкость: <b>' + fmt(battery.capacityAh) + ' А·ч</b>' : ''}
      · Точек: <b>${rows.length}</b>
      · Источник: <b>${escHtml(battery.source || '—')}</b>
      ${maxPowerW ? `· <b style="color:#c62828">Макс. P/модуль: ${fmt(maxPowerW / 1000)} кВт</b>` : ''}
      ${pk.cabinetPowerKw ? `· Макс. P/шкаф: <b>${pk.cabinetPowerKw} кВт</b> (${pk.maxPerCabinet} модулей)` : ''}
    </div>`;
    html += '<div style="overflow:auto;max-height:60vh">';
    html += '<table class="dtable-grid"><thead><tr>';
    html += '<th>t, мин \\ Uэл, В</th>';
    for (const ev of endVs) html += `<th>${fmt(ev)}</th>`;
    html += '</tr></thead><tbody>';
    for (const tm of tMins) {
      html += `<tr><th>${tm}</th>`;
      for (const ev of endVs) {
        const v = grid.get(`${ev}|${tm}`);
        html += `<td>${v != null ? fmt(v) : '—'}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';
    html += '<div class="muted" style="font-size:11px;margin-top:8px">Значения в ячейках — мощность (W) на блок, которую АКБ может отдать за указанное время до конечного напряжения на элемент.</div>';
    // График разряда — одна кривая на каждое endV
    html += '<h4 style="margin:18px 0 6px;font-size:13px">График разряда</h4>';
    html += `<div id="dtable-chart-wrap" style="background:#fafbfc;border:1px solid #e0e3ea;border-radius:6px;padding:12px"></div>`;
    // v0.59.460: детекция аномалий в данных производителя.
    // Для каждой кривой (endV) проверяем что powerW монотонно убывает с ростом t.
    // Если точка выпадает: соседи P_a (t_a) и P_b (t_b), ожидаемое P_exp по
    // лог-линейной интерполяции; |log(P_x) − log(P_exp)| > порог → аномалия.
    const anomalies = _detectDischargeAnomalies(rows);
    if (anomalies.length) {
      html = html.replace('<h4 style="margin:18px 0 6px;font-size:13px">График разряда</h4>',
        `<div class="warn" style="background:#fff3e0;border:1px solid #ffb74d;padding:8px 10px;border-radius:4px;margin-top:14px;font-size:12px;line-height:1.5">`
        + `<b>⚠ В данных производителя обнаружены ${anomalies.length} аномалий</b> (точки явно выпадают из монотонной кривой). На графике они помечены жёлтым кружком; в расчётах используется интерполяция соседних точек:`
        + `<ul style="margin:6px 0 0 18px;padding:0">`
        + anomalies.map(a => `<li>endV=<b>${fmt(a.endV)}</b> В/эл, t=<b>${fmt(a.tMin)}</b> мин: значение <b>${fmt(a.actual)}</b> W → ожидалось ≈ <b>${fmt(a.expected)}</b> W (отклонение в ${fmt(a.ratio)}× раз)</li>`).join('')
        + `</ul></div>`
        + `<h4 style="margin:18px 0 6px;font-size:13px">График разряда</h4>`);
      bodyEl.innerHTML = html;
    } else {
      bodyEl.innerHTML = html;
    }
    // Заменяем powerW аномалий на ожидаемое значение для отрисовки
    // (но оригинальные данные не трогаем — таблица показывается как есть).
    const rowsForChart = rows.map(p => {
      const a = anomalies.find(x => x.endV === p.endV && x.tMin === p.tMin);
      return a ? { ...p, powerW: a.expected, _anomaly: true, _origPower: a.actual } : p;
    });
    _renderDischargeChart(
      document.getElementById('dtable-chart-wrap'),
      rowsForChart, endVs, null, { maxPowerW, cabinetPowerKw: pk.cabinetPowerKw, maxPerCabinet: pk.maxPerCabinet }
    );
  }
  modal.classList.add('show');
}

// v0.59.465: расчётная номинальная мощность модуля АКБ.
// Для Kehua S³: rated = packaging.cabinetPowerKw / packaging.maxPerCabinet.
// Превышать это значение модуль физически не может (BMS отключит), 200 кВт
// на шкаф (12-20 модулей) — паспортное ограничение системы.
// Для других АКБ — берём максимум из таблицы разряда (там самая короткая
// длительность — обычно соответствует rated current).
function _getBatteryMaxPowerW(b) {
  if (!b) return null;
  const pk = b.packaging;
  if (pk && Number.isFinite(pk.cabinetPowerKw) && Number.isFinite(pk.maxPerCabinet) && pk.maxPerCabinet > 0) {
    return (pk.cabinetPowerKw / pk.maxPerCabinet) * 1000;
  }
  if (Array.isArray(b.dischargeTable) && b.dischargeTable.length) {
    return Math.max(...b.dischargeTable.map(p => Number(p.powerW) || 0));
  }
  return null;
}

// v0.59.460/461: детектор аномалий в таблице разряда (итеративный).
// На каждой кривой (фиксированный endV) точки сортируются по tMin.
// Алгоритм:
//   1. Для каждой внутренней точки считаем лог-линейную интерполяцию
//      по соседям слева/справа в (log t, log P).
//   2. Берём точку с максимальным отклонением (если оно > THRESHOLD).
//   3. Помечаем её аномальной, заменяем powerW на ожидаемое значение
//      во ВНУТРЕННЕЙ копии и идём на шаг 1.
//   4. Повторяем пока находятся аномалии (max iterations = N/2).
//
// Так мы удаляем самый сильный выброс первым; соседи, ошибочно
// «провалившиеся» относительно него, на следующей итерации уже не
// помечаются — потому что интерполяция считается по исправленным значениям.
function _detectDischargeAnomalies(rows) {
  if (!Array.isArray(rows) || rows.length < 3) return [];
  const out = [];
  const byEv = new Map();
  for (const p of rows) {
    if (!Number.isFinite(p.tMin) || !Number.isFinite(p.powerW) || p.tMin <= 0 || p.powerW <= 0) continue;
    if (!byEv.has(p.endV)) byEv.set(p.endV, []);
    byEv.get(p.endV).push(p);
  }
  const THRESHOLD = 2.0; // отклонение в 2× от лог-интерполяции = аномалия
  for (const [ev, ptsOrig] of byEv.entries()) {
    const pts = ptsOrig.slice().sort((a, b) => a.tMin - b.tMin);
    if (pts.length < 3) continue;
    // Рабочая копия powerW (мутируем при «исправлении»)
    const work = pts.map(p => p.powerW);
    const maxIter = Math.max(1, Math.floor(pts.length / 2));
    for (let iter = 0; iter < maxIter; iter++) {
      let worstIdx = -1, worstScore = 0, worstExpected = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], x = pts[i], b = pts[i + 1];
        const ltA = Math.log(a.tMin), ltX = Math.log(x.tMin), ltB = Math.log(b.tMin);
        if (ltA === ltB) continue;
        const k = (ltX - ltA) / (ltB - ltA);
        const lpExp = Math.log(work[i - 1]) + k * (Math.log(work[i + 1]) - Math.log(work[i - 1]));
        const pExp = Math.exp(lpExp);
        const ratio = work[i] / pExp;
        const score = ratio > 1 ? ratio : 1 / ratio;
        if (score > THRESHOLD && score > worstScore) {
          worstScore = score;
          worstIdx = i;
          worstExpected = pExp;
        }
      }
      if (worstIdx < 0) break;
      // Записываем аномалию (на оригинальном значении), исправляем рабочую копию.
      out.push({
        endV: ev, tMin: pts[worstIdx].tMin,
        actual: pts[worstIdx].powerW, expected: worstExpected,
        ratio: worstScore,
      });
      work[worstIdx] = worstExpected;
    }
  }
  return out;
}

// v0.59.415: монотонный кубический Hermite (Fritsch-Carlson) — сглаживает
// ломаную в плавный сплайн БЕЗ overshoot для монотонных данных. Принимает
// массив точек [{x,y}] в экранных координатах, возвращает SVG path d-string.
// На монотонно убывающей кривой разряда даёт визуально гладкую линию,
// которая нигде не выпирает за входные точки.
function _smoothPathMonotone(pts) {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} L${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;
  // Секущие наклоны
  const dx = new Array(n - 1), dy = new Array(n - 1), m = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  // Касательные в узлах
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0; // смена знака → плоская
    else t[i] = (m[i - 1] + m[i]) / 2;
  }
  // Ограничение Fritsch-Carlson — без overshoot
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i]     = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  // Hermite → Bezier
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x     + dx[i] / 3;
    const c1y = pts[i].y     + t[i]     * dx[i] / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - t[i + 1] * dx[i] / 3;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

// v0.59.456: внутреннее состояние видимости кривых per-mount (по DOM-элементу).
// Позволяет пользователю включать/выключать кривые endV через клик-чекбоксы
// в легенде, не теряя выбор при ререндере.
const _chartVisibilityByMount = new WeakMap();

// Рисует SVG-кривые разряда: X = время (линейная), Y = мощность (log),
// одна кривая на каждое endV. Линия + маркеры точек.
// v0.59.456: добавлены (а) hover-crosshair с подписью точки на кривой,
// (б) кликабельная легенда — toggle видимости каждой endV-кривой.
function _renderDischargeChart(mount, rows, endVs, highlight = null, limits = null) {
  if (!mount) return;
  // Восстанавливаем/инициализируем set видимых endV
  let visibleSet = _chartVisibilityByMount.get(mount);
  if (!visibleSet) {
    visibleSet = new Set(endVs);
    _chartVisibilityByMount.set(mount, visibleSet);
  }
  // Удаляем из set исчезнувшие endV (например, сменили АКБ)
  for (const ev of [...visibleSet]) if (!endVs.includes(ev)) visibleSet.delete(ev);
  // Если ничего не видно (после фильтра все исчезли) — показать все
  if (![...visibleSet].some(ev => endVs.includes(ev))) endVs.forEach(ev => visibleSet.add(ev));
  // Палитра цветов по endV (холодный→тёплый)
  const palette = ['#1565c0', '#2e7d32', '#f57f17', '#c62828', '#6a1b9a', '#00695c'];
  const W = 860, H = 360;
  const padL = 60, padR = 20, padT = 20, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allT = rows.map(p => p.tMin).filter(v => v > 0);
  const allP = rows.map(p => p.powerW).filter(v => v > 0);
  if (!allT.length || !allP.length) {
    mount.innerHTML = '<div class="muted" style="font-size:12px;text-align:center;padding:20px">Нет данных для графика</div>';
    return;
  }
  let tMin = Math.min(...allT);
  let tMax = Math.max(...allT);
  let pMin = Math.min(...allP);
  let pMax = Math.max(...allP);
  // v0.59.477: Расширяем диапазон, чтобы маркер рассчитанной точки
  // гарантированно попал в видимую область с запасом не менее 10% по обе
  // стороны. Раньше использовали 0.9/1.1 — но если highlight.tMin меньше
  // tMin таблицы лишь немного, padding мог быть меньше реального шага.
  if (highlight && Number.isFinite(highlight.tMin) && highlight.tMin > 0) {
    if (highlight.tMin < tMin) tMin = Math.max(0.01, highlight.tMin * 0.85);
    if (highlight.tMin > tMax) tMax = highlight.tMin * 1.15;
  }
  if (highlight && Number.isFinite(highlight.powerW) && highlight.powerW > 0) {
    if (highlight.powerW < pMin) pMin = Math.max(1, highlight.powerW * 0.85);
    if (highlight.powerW > pMax) pMax = highlight.powerW * 1.15;
  }

  // v0.59.400: ось X — линейная по времени (раньше была log10, искажала
  // короткие времена). Ось Y оставляем log — мощность падает на порядки
  // при увеличении длительности разряда, иначе мелкие точки слипаются.
  const logPMin = Math.log10(pMin);
  const logPMax = Math.log10(pMax);
  const xOf = (t) => padL + ((t - tMin) / Math.max(0.001, tMax - tMin)) * plotW;
  const yOf = (p) => padT + plotH - ((Math.log10(p) - logPMin) / Math.max(0.001, logPMax - logPMin)) * plotH;

  // Тики по X (целые степени 10 и промежуточные)
  const xTicks = [];
  const tickCandidates = [1, 3, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600];
  for (const t of tickCandidates) {
    if (t >= tMin && t <= tMax) xTicks.push(t);
  }
  if (!xTicks.length) xTicks.push(tMin, tMax);
  // Тики по Y
  const yTicks = [];
  const yTickCandidates = [10, 30, 100, 300, 1000, 3000, 10000];
  for (const p of yTickCandidates) {
    if (p >= pMin * 0.8 && p <= pMax * 1.2) yTicks.push(p);
  }
  if (!yTicks.length) yTicks.push(pMin, pMax);

  const parts = [`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;font-family:-apple-system,sans-serif;font-size:11px">`];

  // Фон графика
  parts.push(`<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#e0e3ea" stroke-width="1"/>`);

  // Сетка + тики X
  for (const t of xTicks) {
    const x = xOf(t);
    parts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#f0f0f0" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${padT + plotH + 16}" text-anchor="middle" fill="#6b7280">${t}</text>`);
  }
  // Сетка + тики Y
  for (const p of yTicks) {
    const y = yOf(p);
    parts.push(`<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#6b7280">${p >= 1000 ? (p / 1000).toFixed(0) + 'k' : p}</text>`);
  }

  // Подписи осей
  parts.push(`<text x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#1f2430" font-weight="600">Время разряда, мин</text>`);
  parts.push(`<text transform="rotate(-90 16 ${padT + plotH / 2})" x="16" y="${padT + plotH / 2}" text-anchor="middle" fill="#1f2430" font-weight="600">Мощность на блок, W (log)</text>`);

  // Кривые по каждому endV (рисуем только видимые, сохраняем сами curves
  // в map для интерполяции под курсором).
  const curvesByEv = new Map();
  endVs.forEach((ev, idx) => {
    const color = palette[idx % palette.length];
    const curve = rows.filter(r => r.endV === ev)
      .filter(r => r.powerW > 0 && r.tMin > 0)
      .sort((a, b) => a.tMin - b.tMin);
    if (!curve.length) return;
    curvesByEv.set(ev, { color, curve });
    if (!visibleSet.has(ev)) return;
    const ptsScreen = curve.map(p => ({ x: xOf(p.tMin), y: yOf(p.powerW) }));
    // v0.59.463: монотонный Hermite-сплайн (Fritsch-Carlson) — гладкая кривая
    // без overshoot. Чтобы точки/tooltip/snap лежали ровно на ней, мы
    // помечаем path атрибутом data-ev и считаем Y(x) через getPointAtLength
    // в обработчике hover (общий метод для отрисовки и интерполяции).
    const d = _smoothPathMonotone(ptsScreen);
    parts.push(`<path data-ev="${ev}" d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of curve) {
      // v0.59.460: аномальные точки помечены жёлтым (значение интерполировано).
      const isAnomaly = !!p._anomaly;
      const fill = isAnomaly ? '#fbc02d' : color;
      const r = isAnomaly ? 5 : 3;
      const sw = isAnomaly ? 2 : 1;
      const titleSuffix = isAnomaly ? ` · ⚠ интерполировано вместо ${p._origPower} W (аномалия в datasheet)` : '';
      parts.push(`<circle cx="${xOf(p.tMin).toFixed(1)}" cy="${yOf(p.powerW).toFixed(1)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="${sw}"><title>${ev} В · ${p.tMin} мин · ${fmt(p.powerW)} W${titleSuffix}</title></circle>`);
    }
  });

  // v0.59.465: горизонтальная красная линия — паспортный максимум мощности
  // на модуль (для S³ Li-Ion: P_cabinet / N_modules; для VRLA — пиковое
  // значение из таблицы). Превышение этого значения не реализуемо
  // физически (BMS отключит / превышение DC-rate VRLA).
  if (limits && Number.isFinite(limits.maxPowerW) && limits.maxPowerW > 0) {
    const yLim = yOf(limits.maxPowerW);
    if (yLim >= padT && yLim <= padT + plotH) {
      parts.push(`<line x1="${padL}" y1="${yLim.toFixed(1)}" x2="${padL + plotW}" y2="${yLim.toFixed(1)}" stroke="#c62828" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>`);
      const labelTxt = limits.cabinetPowerKw
        ? `Макс. P/модуль: ${fmt(limits.maxPowerW / 1000)} кВт (шкаф ${limits.cabinetPowerKw} кВт / ${limits.maxPerCabinet})`
        : `Макс. P: ${fmt(limits.maxPowerW / 1000)} кВт`;
      parts.push(`<rect x="${padL + 6}" y="${(yLim - 14).toFixed(1)}" width="${labelTxt.length * 5.5 + 8}" height="14" fill="#fff" stroke="#c62828" rx="2" opacity="0.95"/>`);
      parts.push(`<text x="${padL + 10}" y="${(yLim - 4).toFixed(1)}" fill="#c62828" font-size="10" font-weight="600">${labelTxt}</text>`);
    }
  }

  // Маркер рассчитанной точки — крестовина + кружок + подпись
  if (highlight && Number.isFinite(highlight.tMin) && Number.isFinite(highlight.powerW) && highlight.tMin > 0 && highlight.powerW > 0) {
    const cx = xOf(highlight.tMin);
    const cy = yOf(highlight.powerW);
    const stroke = highlight.extrapolated ? '#ff9800' : '#d32f2f';
    parts.push(`<line x1="${padL}" y1="${cy.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/>`);
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${padT}" x2="${cx.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/>`);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${stroke}" stroke="#fff" stroke-width="2"/>`);
    const lbl = highlight.label || `${fmt(highlight.tMin)} мин · ${fmt(highlight.powerW)} W/блок`;
    const tx = cx + 10;
    const ty = Math.max(padT + 14, cy - 8);
    parts.push(`<rect x="${tx - 2}" y="${ty - 11}" width="${(lbl.length * 6.5 + 6).toFixed(0)}" height="16" fill="#fff" stroke="${stroke}" rx="3"/>`);
    parts.push(`<text x="${tx + 2}" y="${ty + 1}" fill="${stroke}" font-weight="600">${escHtml(lbl)}</text>`);
  }

  // Сначала — невидимая зона для crosshair (её перекроют легенда и
  // highlight, чтобы клики по ним не блокировались hover-областью).
  parts.push(`<rect class="chart-hover-area" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" pointer-events="all"/>`);
  // Crosshair-группа (изначально скрыта). Содержит обе линии: вертикальную
  // (текущее t) и горизонтальную (текущая P в позиции курсора).
  parts.push(`<g class="chart-crosshair" style="display:none;pointer-events:none">`);
  parts.push(`<line class="cx-vline" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="#888" stroke-width="1" stroke-dasharray="3 3"/>`);
  parts.push(`<line class="cx-hline" x1="${padL}" y1="0" x2="${padL + plotW}" y2="0" stroke="#888" stroke-width="1" stroke-dasharray="3 3"/>`);
  parts.push(`</g>`);

  // Легенда справа вверху — КЛИКАБЕЛЬНАЯ (toggle видимости). Кладём
  // ПОСЛЕ hover-area, чтобы клики приходили на неё.
  const legendX = W - padR - 130;
  const legendY = padT + 8;
  parts.push(`<g class="chart-legend" pointer-events="auto">`);
  parts.push(`<rect x="${legendX - 6}" y="${legendY - 12}" width="130" height="${endVs.length * 18 + 14}" fill="#fff" stroke="#e0e3ea" rx="4"/>`);
  parts.push(`<text x="${legendX}" y="${legendY}" fill="#6b7280" font-size="10" pointer-events="none">Клик — скрыть/показать</text>`);
  endVs.forEach((ev, idx) => {
    const color = palette[idx % palette.length];
    const y = legendY + 8 + idx * 18 + 8;
    const visible = visibleSet.has(ev);
    const op = visible ? 1 : 0.35;
    parts.push(`<g data-legend-ev="${ev}" style="cursor:pointer" opacity="${op}">`);
    parts.push(`<rect x="${legendX - 4}" y="${y - 9}" width="128" height="16" fill="#fff" fill-opacity="0.01"/>`);
    parts.push(`<rect x="${legendX}" y="${y - 6}" width="12" height="12" fill="${visible ? color : '#fff'}" stroke="${color}" stroke-width="1.5" rx="2" pointer-events="none"/>`);
    if (visible) parts.push(`<polyline points="${legendX + 2.5},${y} ${legendX + 5},${y + 2.5} ${legendX + 9},${y - 2}" fill="none" stroke="#fff" stroke-width="1.8" pointer-events="none"/>`);
    parts.push(`<text x="${legendX + 18}" y="${y + 4}" fill="#1f2430" pointer-events="none">${ev} В/эл</text>`);
    parts.push(`</g>`);
  });
  parts.push(`</g>`);

  parts.push('</svg>');
  // Wrap SVG + tooltip overlay в relative-контейнер. overflow:hidden чтобы
  // tooltip не выводил скролл за пределы графика.
  mount.innerHTML = `<div style="position:relative;overflow:hidden">${parts.join('')}<div class="chart-tooltip" style="position:absolute;display:none;background:#1f2430;color:#fff;font-size:11px;padding:6px 8px;border-radius:4px;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);line-height:1.5;z-index:10;max-width:240px"></div></div>`;

  // ──────── Интерактив ────────
  const svg = mount.querySelector('svg');
  if (!svg) return;
  // Клик по легенде — toggle видимости и re-render.
  svg.querySelectorAll('[data-legend-ev]').forEach(g => {
    g.addEventListener('click', () => {
      const ev = parseFloat(g.getAttribute('data-legend-ev'));
      if (visibleSet.has(ev)) visibleSet.delete(ev); else visibleSet.add(ev);
      _renderDischargeChart(mount, rows, endVs, highlight);
    });
  });
  // Hover crosshair: находим под курсором tMin, считаем powerW для каждой
  // видимой кривой, рисуем точки + подпись.
  const hoverArea = svg.querySelector('.chart-hover-area');
  const crossG = svg.querySelector('.chart-crosshair');
  const vline = svg.querySelector('.cx-vline');
  const hline = svg.querySelector('.cx-hline');
  const tooltip = mount.querySelector('.chart-tooltip');
  // v0.59.463: ОДИН И ТОТ ЖЕ метод для кривой и для точек на ней —
  // запрашиваем Y у самого SVG-path через getPointAtLength + binary search
  // по длине дуги до заданного X. Так точка ВСЕГДА на сплайне, какой бы
  // он ни был (Hermite, Bezier и т.д.).
  const yOfPathAtX = (path, targetX) => {
    if (!path) return null;
    const total = path.getTotalLength();
    if (!(total > 0)) return null;
    // Binary search: длина дуги монотонно возрастает с t (параметр сплайна),
    // и path-X монотонна по t (т.к. xOf — монотонна по tMin).
    let lo = 0, hi = total;
    for (let i = 0; i < 24; i++) { // 2^24 точность, достаточно
      const mid = (lo + hi) / 2;
      const pt = path.getPointAtLength(mid);
      if (pt.x < targetX) lo = mid;
      else hi = mid;
      if (hi - lo < 0.05) break;
    }
    const pt = path.getPointAtLength((lo + hi) / 2);
    return pt.y;
  };
  // Возвращает powerW при заданном t для конкретного endV — берём Y из path.
  const interpPower = (ev, t) => {
    const path = svg.querySelector(`path[data-ev="${ev}"]`);
    if (!path) return null;
    const yScreen = yOfPathAtX(path, xOf(t));
    if (yScreen == null) return null;
    // Обратная yOf: log10(P) = logPMin + (1 - (y - padT)/plotH) * (logPMax - logPMin)
    const logP = logPMin + (1 - (yScreen - padT) / plotH) * (logPMax - logPMin);
    return Math.pow(10, logP);
  };
  // Координата мыши → координата SVG (учёт scaling из viewBox).
  const ptInSvg = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return { x, y };
  };
  hoverArea.addEventListener('mousemove', (e) => {
    const { x: xSvg, y: ySvg } = ptInSvg(e);
    if (xSvg < padL || xSvg > padL + plotW || ySvg < padT || ySvg > padT + plotH) {
      crossG.style.display = 'none';
      tooltip.style.display = 'none';
      // удалить временные маркеры
      svg.querySelectorAll('.cx-pt').forEach(n => n.remove());
      return;
    }
    // Обратная функция xOf: t = tMin + (x - padL)/plotW * (tMax - tMin)
    const t = tMin + ((xSvg - padL) / plotW) * (tMax - tMin);
    crossG.style.display = '';
    // v0.59.459: линии crosshair проходят ЧЕРЕЗ точку на кривой разряда,
    // а не через положение курсора. Vertical — на t (фиксируется курсором X),
    // horizontal — на Y кривой, ближайшей к курсору (если видимых несколько).
    // Удаляем старые точки
    svg.querySelectorAll('.cx-pt').forEach(n => n.remove());
    const lines = [`<b>Время разряда: ${fmt(t)} мин</b>`];
    let bestSnapY = null;
    let bestSnapDist = Infinity;
    const ns = svg.namespaceURI;
    endVs.forEach((ev, idx) => {
      if (!visibleSet.has(ev)) return;
      const c = curvesByEv.get(ev);
      if (!c) return;
      // v0.59.463: yOnPath — Y координата на самом SVG-сплайне в этом X.
      const path = svg.querySelector(`path[data-ev="${ev}"]`);
      const cy = yOfPathAtX(path, xSvg);
      if (cy == null) return;
      // Обратная yOf для tooltip-метки (log Y).
      const logP = logPMin + (1 - (cy - padT) / plotH) * (logPMax - logPMin);
      const p = Math.pow(10, logP);
      if (!Number.isFinite(p) || p <= 0) return;
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'cx-pt');
      dot.setAttribute('cx', xSvg.toFixed(1));
      dot.setAttribute('cy', cy.toFixed(1));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', c.color);
      dot.setAttribute('stroke', '#fff');
      dot.setAttribute('stroke-width', '1.5');
      dot.style.pointerEvents = 'none';
      svg.appendChild(dot);
      lines.push(`<span style="color:${c.color}">●</span> ${ev} В/эл → <b>${fmt(p)}</b> W/блок`);
      const dist = Math.abs(cy - ySvg);
      if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapY = cy; }
    });
    vline.setAttribute('x1', xSvg);
    vline.setAttribute('x2', xSvg);
    // Горизонтальная — на уровне ближайшей видимой кривой; если ни одна
    // не видна — по позиции курсора как fallback.
    const hY = (bestSnapY != null) ? bestSnapY : ySvg;
    hline.setAttribute('y1', hY);
    hline.setAttribute('y2', hY);
    tooltip.innerHTML = lines.join('<br>');
    tooltip.style.display = '';
    // Позиционируем относительно SVG-контейнера. После innerHTML измеряем
    // размер tooltip и держим его внутри bounds контейнера.
    const wrap = mount.firstElementChild; // div со SVG и tooltip
    const wrapR = wrap.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const margin = 10;
    const cx = e.clientX - wrapR.left;
    const cy = e.clientY - wrapR.top;
    let tx = cx + 14;
    let ty = cy + 14;
    // По горизонтали — если не помещается справа, ставим слева от курсора.
    if (tx + tw + margin > wrapR.width) tx = Math.max(margin, cx - tw - 14);
    // По вертикали — если не помещается снизу, ставим сверху курсора.
    if (ty + th + margin > wrapR.height) ty = Math.max(margin, cy - th - 14);
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  });
  hoverArea.addEventListener('mouseleave', () => {
    crossG.style.display = 'none';
    tooltip.style.display = 'none';
    svg.querySelectorAll('.cx-pt').forEach(n => n.remove());
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let addedModels = 0, failedFiles = 0;
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const entries = parseBatteryXlsx(buf, file.name);
      for (const e of entries) {
        addBattery(e);
        addedModels++;
      }
    } catch (e) {
      console.error('Failed to parse', file.name, e);
      failedFiles++;
    }
  }
  renderCatalog();
  renderBatterySelector();
  if (addedModels) flash(`Добавлено моделей: ${addedModels}${failedFiles ? ` (ошибок файлов: ${failedFiles})` : ''}`, 'success');
  else flash(`Не удалось распознать ни одного файла`, 'error');
}

function wireUpload() {
  const input = document.getElementById('upload-input');
  const dropZone = document.getElementById('upload-zone');
  if (!input || !dropZone) return;
  input.addEventListener('change', () => handleFiles(input.files));
  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('hover');
    handleFiles(e.dataTransfer.files);
  });

  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', async () => {
    if (!(await rsConfirm('Очистить весь справочник АКБ?', 'Действие нельзя отменить.', { okLabel: 'Очистить', cancelLabel: 'Отмена' }))) return;
    clearCatalog();
    renderCatalog();
    renderBatterySelector();
    flash('Справочник очищен');
  });

  const addBtn = document.getElementById('btn-add-manual');
  if (addBtn) addBtn.addEventListener('click', () => openManualBatteryModal());

  // Kehua S³ defaults — загружает 3 шкафа Kehua S³ Li-Ion из встроенных
  // данных (shared/kehua-s3-data.js). Идемпотентно: повторное нажатие
  // просто обновит существующие записи (addBattery делает upsert по id).
  const kehuaBtn = document.getElementById('btn-seed-kehua');
  if (kehuaBtn) kehuaBtn.addEventListener('click', () => {
    const n = KEHUA_S3_BATTERIES.length;
    for (const rec of KEHUA_S3_BATTERIES) {
      // Обновляем importedAt на текущее время
      addBattery({ ...rec, importedAt: Date.now() });
    }
    flash(`Загружено Kehua S³: ${n} шкафов`, 'success');
    renderCatalog();
    renderBatterySelector();
  });

  // Экспорт пустого шаблона XLSX с нужными колонками — чтобы пользователь
  // мог скачать файл-болванку, заполнить в Excel и загрузить через drop-zone.
  const tplBtn = document.getElementById('btn-export-template');
  if (tplBtn) tplBtn.addEventListener('click', () => {
    const XLSX = (typeof window !== 'undefined') ? window.XLSX : null;
    if (!XLSX) { flash('SheetJS не загружен', 'error'); return; }
    const headers = ['Battery_Supplier', 'Battery_Type', 'Capacity', 'End_Voltage', 'Time_Value', 'Power_Value'];
    // Пример из 6 строк (одна модель × две кривые endV × три точки по времени)
    const sample = [
      ['Example',  'EX-12100', 100, 1.65, 10,  3474],
      ['Example',  'EX-12100', 100, 1.65, 60,   880],
      ['Example',  'EX-12100', 100, 1.65, 180,  320],
      ['Example',  'EX-12100', 100, 1.75, 10,  3300],
      ['Example',  'EX-12100', 100, 1.75, 60,   820],
      ['Example',  'EX-12100', 100, 1.75, 180,  290],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    // Ширина столбцов для читабельности
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Battery Data');
    XLSX.writeFile(wb, 'battery-template.xlsx');
    flash('Шаблон скачан: battery-template.xlsx', 'success');
  });

  const helpFmt = document.getElementById('btn-help-format');
  if (helpFmt) helpFmt.addEventListener('click', () => openHelpModal('format'));
  const helpMet = document.getElementById('btn-help-method');
  if (helpMet) helpMet.addEventListener('click', () => openHelpModal('method'));

  // Фильтры каталога — перерисовываем при любом изменении
  ['cat-filter-text', 'cat-filter-chem', 'cat-filter-custom'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => renderCatalog());
  });
}

// ================= Селектор батареи в калькуляторе =================
function _calcFilters() {
  const v = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  return {
    text: v('calc-filter-text').toLowerCase(),
    supp: v('calc-filter-supp'),
    chem: v('calc-filter-chem-flt'),
    vblk: v('calc-filter-vblk'),
    capMin: Number(v('calc-filter-capmin')) || 0,
    capMax: Number(v('calc-filter-capmax')) || 0,
  };
}
function _populateCalcFilterOptions(list) {
  // v0.59.466: КРОСС-ФИЛЬТРАЦИЯ. Каждый select ограничен значениями,
  // которые присутствуют в записях, удовлетворяющих ВСЕМ остальным
  // фильтрам. Так не бывает «пустых» комбинаций.
  const f = _calcFilters();
  const sSupp = document.getElementById('calc-filter-supp');
  const sChem = document.getElementById('calc-filter-chem-flt');
  const sVblk = document.getElementById('calc-filter-vblk');
  // Поставщик: учитываем все фильтры кроме supp.
  if (sSupp) {
    const cur = sSupp.value;
    const subset = _filterBatteries(list, { ...f, supp: '' });
    const supps = [...new Set(subset.map(b => b.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    let h = '<option value="">Все поставщики</option>';
    for (const s of supps) h += `<option value="${escHtml(s)}">${escHtml(s)}</option>`;
    sSupp.innerHTML = h;
    if (cur && supps.includes(cur)) sSupp.value = cur;
  }
  // Тип АКБ (chemistry): учитываем все фильтры кроме chem.
  if (sChem) {
    const cur = sChem.value;
    const subset = _filterBatteries(list, { ...f, chem: '' });
    const chems = [...new Set(subset.map(b => (b.chemistry || '').toLowerCase()).filter(Boolean))];
    const all = ['vrla', 'li-ion', 'nicd', 'nimh'];
    let h = '<option value="">Все типы АКБ</option>';
    for (const c of all) {
      if (!chems.includes(c)) continue;
      h += `<option value="${escHtml(c)}">${escHtml(chemLabel(c))}</option>`;
    }
    sChem.innerHTML = h;
    if (cur && chems.includes(cur)) sChem.value = cur;
  }
  // V блока: учитываем все фильтры кроме vblk.
  if (sVblk) {
    const cur = sVblk.value;
    const subset = _filterBatteries(list, { ...f, vblk: '' });
    const vblks = [...new Set(subset.map(b => Number(b.blockVoltage)).filter(v => v > 0))].sort((a,b)=>a-b);
    let h = '<option value="">V блока: любое</option>';
    for (const v of vblks) h += `<option value="${v}">${v} В</option>`;
    sVblk.innerHTML = h;
    if (cur && vblks.includes(Number(cur))) sVblk.value = cur;
  }
}
function _filterBatteries(list, f) {
  return list.filter(b => {
    if (f.text) {
      const s = ((b.supplier||'')+' '+(b.type||'')+' '+(b.model||'')+' '+(b.source||'')).toLowerCase();
      if (!s.includes(f.text)) return false;
    }
    if (f.supp && b.supplier !== f.supp) return false;
    if (f.chem && b.chemistry !== f.chem) return false;
    if (f.vblk && Number(b.blockVoltage) !== Number(f.vblk)) return false;
    if (f.capMin && !(Number(b.capacityAh) >= f.capMin)) return false;
    if (f.capMax && !(Number(b.capacityAh) <= f.capMax)) return false;
    return true;
  });
}
function _sortBatteries(list) {
  return list.slice().sort((a, b) => {
    const sa = (a.supplier || '').toLowerCase();
    const sb = (b.supplier || '').toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb, 'ru');
    const va = Number(a.blockVoltage) || 0;
    const vb = Number(b.blockVoltage) || 0;
    if (va !== vb) return va - vb;
    const ca = Number(a.capacityAh) || 0;
    const cb = Number(b.capacityAh) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.type || a.model || '').localeCompare(String(b.type || b.model || ''), 'ru');
  });
}
function renderBatterySelector() {
  const sel = document.getElementById('calc-battery');
  if (!sel) return;
  // v0.59.424–0.59.425: фильтруем «не-модули» из списка выбора —
  // для S³ и аналогичных модульных систем выбираются ТОЛЬКО модули.
  // Шкафы (systemSubtype='cabinet') собираются автоматически из количества
  // модулей. Аксессуары (systemSubtype='accessory': combiner, networking
  // device, blank panels, wire kits) добавляются BOM-логикой.
  const all = listBatteries().filter(b => b.systemSubtype !== 'cabinet' && b.systemSubtype !== 'accessory');
  _populateCalcFilterOptions(all);
  const f = _calcFilters();
  let list = _sortBatteries(_filterBatteries(all, f));
  // v0.59.449: фильтр совместимости с выбранным ИБП по окну V_DC.
  const upsSel = document.getElementById('calc-ups-pick');
  const ups = upsSel && upsSel.value ? getUps(upsSel.value) : null;
  const compatWrap = document.getElementById('calc-filter-ups-compat-wrap');
  if (compatWrap) compatWrap.style.display = ups ? 'inline-flex' : 'none';
  const compatChk = document.getElementById('calc-filter-ups-compat');
  const useCompat = !!(ups && compatChk && compatChk.checked);
  let totalForUps = list.length, compatN = list.length;
  if (ups) {
    const compatible = list.filter(b => _isBatteryCompatibleWithUps(b, ups).ok);
    compatN = compatible.length;
    if (useCompat) list = compatible;
  }
  const cur = sel.value;
  // v0.59.450: если ранее выбранная модель отфильтрована — оставляем её
  // в списке с пометкой «(несовместима с ИБП)», чтобы пользователь видел
  // текущий выбор и мог сознательно его поменять.
  let extraCurrent = null;
  if (cur && !list.some(b => b.id === cur)) {
    const curB = getBattery(cur);
    if (curB && curB.systemSubtype !== 'cabinet' && curB.systemSubtype !== 'accessory') {
      extraCurrent = curB;
    }
  }
  let h = '<option value="">— средняя модель (без таблицы) —</option>';
  if (extraCurrent) {
    const tag = ups && !_isBatteryCompatibleWithUps(extraCurrent, ups).ok ? ' — несовместима с ИБП' : ' — отфильтрована';
    h += `<option value="${escHtml(extraCurrent.id)}">⚠ ${escHtml(extraCurrent.supplier)} · ${escHtml(extraCurrent.type)} (${fmt(extraCurrent.blockVoltage)} В / ${extraCurrent.capacityAh != null ? fmt(extraCurrent.capacityAh) + ' А·ч' : '—'})${tag}</option>`;
  }
  for (const b of list) {
    h += `<option value="${escHtml(b.id)}">${escHtml(b.supplier)} · ${escHtml(b.type)} (${fmt(b.blockVoltage)} В / ${b.capacityAh != null ? fmt(b.capacityAh) + ' А·ч' : '—'})</option>`;
  }
  const info = document.getElementById('calc-battery-info');
  if (info) {
    let txt = `Подходит ${list.length} из ${all.length} моделей`;
    if (ups) txt += ` · совместимых с ИБП: ${compatN} из ${totalForUps}`;
    info.textContent = txt;
  }
  sel.innerHTML = h;
  if (cur && (list.some(b => b.id === cur) || (extraCurrent && extraCurrent.id === cur))) sel.value = cur;
  _applyBatteryLock();
  _renderUpsCompatHint();
  _renderCapacityRecommend();
}

// v0.59.449: подсказка под селектором АКБ — почему текущая пара
// «АКБ + ИБП» несовместима (если несовместима). Делает ошибку
// «Диапазон не покрывается» гораздо понятнее.
function _renderUpsCompatHint() {
  const sel = document.getElementById('calc-battery');
  const upsSel = document.getElementById('calc-ups-pick');
  const info = document.getElementById('calc-battery-info');
  if (!sel || !info) return;
  const b = sel.value ? getBattery(sel.value) : null;
  const u = upsSel && upsSel.value ? getUps(upsSel.value) : null;
  // удаляем старый блок
  const old = document.getElementById('calc-ups-compat-hint');
  if (old) old.remove();
  if (!b || !u) return;
  const r = _isBatteryCompatibleWithUps(b, u);
  if (r.ok) return;
  const div = document.createElement('div');
  div.id = 'calc-ups-compat-hint';
  div.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid #f5b7a0;background:#fff5f0;border-radius:5px;font-size:12px;line-height:1.55;color:#7a2a00';
  div.innerHTML = `<b>⚠ Несовместимо:</b> ${escHtml(r.reason)}<br><span class="muted">Снимите галочку «Только совместимые», чтобы увидеть все модели, либо выберите АКБ с другим напряжением блока (напр., 6 В вместо 12 В для узкого окна V<sub>DC</sub>).</span>`;
  info.parentElement.appendChild(div);
}
function _applyBatteryLock() {
  const sel = document.getElementById('calc-battery');
  const b = sel && sel.value ? getBattery(sel.value) : null;
  // v0.59.428: показываем S³-опции только когда выбран модуль S³.
  const s3Box = document.getElementById('calc-s3-options');
  const isS3 = isS3Module(b);
  if (s3Box) s3Box.style.display = isS3 ? 'block' : 'none';
  // v0.59.433: для S³ скрываем VRLA-специфичные поля — End voltage,
  // «Цепочек параллельно», «Ёмкость блока (fallback)», «Напряжение блока».
  // Они не применимы к модульной LFP-системе, где модуль = готовый блок
  // с BMS и фиксированной ячейкой.
  const hideForS3 = ['calc-endv', 'calc-strings', 'calc-capAh', 'calc-blockv'];
  hideForS3.forEach(id => {
    const inp = document.getElementById(id);
    if (!inp) return;
    const wrap = inp.closest('div') || inp.parentElement;
    if (wrap) wrap.style.display = isS3 ? 'none' : '';
  });
  // v0.59.489: для S³ переименовываем «Блоков в цепочке (N)» → «Модулей в
  // шкафу (N)», «Цепочек параллельно (M)» → «Шкафов (M)». Терминология
  // VRLA не применима к модульной системе.
  const blocksLbl = document.querySelector('label[for="calc-blocks"], #calc-blocks')?.parentElement?.querySelector('label > span:first-child');
  if (blocksLbl) blocksLbl.textContent = isS3 ? 'Модулей в шкафу (N)' : 'Блоков в цепочке (N)';
  const stringsLbl = document.querySelector('#calc-strings-manual')?.parentElement?.querySelector('label');
  if (stringsLbl) {
    const tag = stringsLbl.querySelector('.muted');
    stringsLbl.firstChild.textContent = isS3 ? 'Шкафов (M) ' : 'Цепочек параллельно (M) ';
    if (tag) stringsLbl.appendChild(tag);
  }
  const lock = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (b && val != null && Number.isFinite(Number(val))) {
      el.value = val;
      el.readOnly = true;
      el.style.background = '#f0f0f0';
      el.title = 'Заблокировано — параметр взят из выбранной модели АКБ';
    } else {
      el.readOnly = false;
      el.style.background = '';
      el.title = '';
    }
  };
  if (b) {
    lock('calc-blockv', b.blockVoltage);
    lock('calc-capAh', b.capacityAh);
    // Тип АКБ: автоматически выбираем по chemistry АКБ и блокируем select
    const chemSel = document.getElementById('calc-chem');
    if (chemSel && b.chemistry) {
      // Если в select нет такого option (например, NiCd) — добавим его
      if (!Array.from(chemSel.options).some(o => o.value === b.chemistry)) {
        const op = document.createElement('option');
        op.value = b.chemistry; op.textContent = chemLabel(b.chemistry);
        chemSel.appendChild(op);
      }
      chemSel.value = b.chemistry;
      chemSel.disabled = true;
      chemSel.title = 'Заблокировано — тип АКБ определён выбранной моделью';
      chemSel.style.background = '#f0f0f0';
    }
    // выставим dcVoltage кратно blockV если хоть как-то
    const blkV = Number(b.blockVoltage);
    const dc = document.getElementById('calc-dcv');
    if (dc && blkV > 0) {
      const cur = Number(dc.value) || 0;
      const n = Math.max(1, Math.round(cur / blkV));
      dc.value = n * blkV;
    }
  } else {
    lock('calc-blockv', null);
    lock('calc-capAh', null);
    const chemSel = document.getElementById('calc-chem');
    if (chemSel) {
      chemSel.disabled = false;
      chemSel.title = '';
      chemSel.style.background = '';
    }
  }
}
function _renderCapacityRecommend() {
  const box = document.getElementById('calc-recommend');
  if (!box) return;
  const get = id => document.getElementById(id);
  const loadKw = Number(get('calc-load') && get('calc-load').value) || 0;
  const targetMin = Number(get('calc-target') && get('calc-target').value) || 0;
  const dcV = Number(get('calc-dcv') && get('calc-dcv').value) || 0;
  const invEff = Math.max(0.5, Math.min(1, (Number(get('calc-inveff') && get('calc-inveff').value) || 94) / 100));
  const chem = (get('calc-chem') && get('calc-chem').value) || 'vrla';
  const mode = get('calc-mode') && get('calc-mode').value;
  if (mode !== 'required' || !(loadKw > 0) || !(targetMin > 0) || !(dcV > 0)) {
    box.style.display = 'none';
    return;
  }
  // Энергобаланс с учётом эффективности и aging+temperature reserve
  const eff = (chem === 'li-ion') ? 0.93 : 0.70;
  const aging = 1.25; // 80% EoL
  const tempK = 1.0;  // нейтрально, можно расширить
  const energyWh = (loadKw * 1000 / invEff) * (targetMin / 60);
  const usableWh = energyWh * aging * tempK / eff;
  const ahNeeded = usableWh / dcV;
  // Рекомендованная номинальная ёмкость на цепочку (одна цепочка)
  const sug = [50, 65, 75, 100, 125, 150, 200, 250].find(x => x >= ahNeeded) || Math.ceil(ahNeeded/50)*50;
  box.style.display = '';
  const ahMin = Math.round(ahNeeded);
  box.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">` +
      `<div style="flex:1;min-width:240px"><b>Рекомендуемая ёмкость АКБ:</b> ≈ <b>${fmt(ahNeeded)} А·ч</b> на цепочку (ближайший стандарт: <b>${sug} А·ч</b>)</div>` +
      `<button type="button" id="calc-apply-recommend" class="btn-sm" style="font-size:11px">→ Фильтр «Ah ≥ ${ahMin}»</button>` +
    `</div>` +
    `<div class="muted" style="margin-top:4px">P=${loadKw} кВт · t=${targetMin} мин · η_inv=${(invEff*100).toFixed(0)}% · K_aging=${aging} · η_${chem}=${(eff*100).toFixed(0)}%</div>`;
  const btn = document.getElementById('calc-apply-recommend');
  if (btn) btn.addEventListener('click', () => {
    const f = document.getElementById('calc-filter-capmin');
    if (f) { f.value = ahMin; renderBatterySelector(); }
  });
}

// ================= Расчёт =================
// Достаём V_DC min/max из текущего источника:
//   1) UPS picker (catalog) — паспорт ИБП
//   2) Manual V_DC min/max поля
//   3) handoff из ИБП-конфигуратора / схемы (через _handoffVdc)
//   4) fallback ±5% от dcRaw
function _getCurrentVdcRange(dcRaw) {
  // Главные поля V_DC мин/макс — всегда видны и редактируемы (если не залочены ИБП).
  const a = Number(document.getElementById('calc-vdcmin')?.value) || 0;
  const b = Number(document.getElementById('calc-vdcmax')?.value) || 0;
  if (a > 0 && b > 0 && a < b) return { min: a, max: b, known: true, source: 'form' };
  // Handoff
  if (_handoffVdc.min && _handoffVdc.max) return { min: _handoffVdc.min, max: _handoffVdc.max, known: true, source: 'handoff' };
  // UPS catalog
  const sel = document.getElementById('calc-ups-pick');
  const id = sel ? sel.value : '';
  if (id) {
    const u = getUps(id);
    if (u && u.vdcMin && u.vdcMax) return { min: u.vdcMin, max: u.vdcMax, known: true, source: 'ups-catalog' };
  }
  // Fallback ±5%
  if (dcRaw > 0) return { min: Math.round(dcRaw * 0.95), max: Math.round(dcRaw * 1.05), known: false, source: 'fallback' };
  return { min: 0, max: 0, known: false, source: 'none' };
}
const _handoffVdc = { min: 0, max: 0 };

// v0.59.413: Расчётные коэффициенты (IEEE 485 / IEC 62040).
// Старение, температура, конструктивный запас, окно V_DC, SoC-min для Li.
// v0.59.469/472/474: расчёт k_temp из температуры АКБ — раздельно по химии.
//
// VRLA (свинцово-кислотные):
//   • T < 25°C: IEEE 485 § 6.2 — k = 1 + 0.008·(25 − T) (потеря ёмкости).
//   • T > 25°C: запас на ускоренное старение по Аррениусу — k = 1 + 0.005·(T−25).
//
// Li-Ion (LFP):
//   • Холод влияет СИЛЬНЕЕ: при 0°C ~75% ёмкости, при −10°C ~50%, при −20°C
//     BMS отключает разряд. Используем k = 1 + 0.015·(25 − T) при 0…25°C;
//     при T < 0°C добавляем «обрыв» (k *= 1.5) — нужен подогрев.
//   • Жара: BMS защищает от мгновенных проблем, но идёт календарное
//     старение. Меньше ёмкостной поправки (0.003), но всё равно нужен запас.
function _kTempFromCelsius(tC, chemistry) {
  if (!Number.isFinite(tC)) return 1.0;
  const isLi = chemistry === 'li-ion';
  if (isLi) {
    if (tC < 0) {
      // Резкий сброс ёмкости + критическая работа BMS. Запас 1.5×.
      const baseK = 1 + 0.015 * (25 - tC); // линейная экстраполяция
      return baseK * 1.5;
    }
    if (tC < 25) return 1 + 0.015 * (25 - tC); // 0°C → 1.375; 10°C → 1.225
    return 1 + 0.003 * (tC - 25); // меньшее влияние тепла на ёмкость
  }
  // VRLA
  if (tC < 25) return 1 + 0.008 * (25 - tC);
  return 1 + 0.005 * (tC - 25);
}
function _readDerating() {
  const get = id => Number(document.getElementById(id)?.value) || 0;
  const kAge    = Math.max(1, get('calc-k-age')    || 1.25);
  // v0.59.469: k_temp вычисляется из температуры (если поле задано),
  // hidden-input calc-k-temp хранит результат для preserve-on-miss совместимости.
  const tEl = document.getElementById('calc-temp-c');
  const chemEl = document.getElementById('calc-chem');
  const battSel = document.getElementById('calc-battery');
  const battery = battSel?.value ? getBattery(battSel.value) : null;
  const chemistry = (battery && battery.chemistry) || (chemEl?.value || 'vrla');
  const kTemp = tEl
    ? _kTempFromCelsius(Number(tEl.value), chemistry)
    : Math.max(1, get('calc-k-temp') || 1.00);
  const kDesign = Math.max(1, get('calc-k-design') || 1.10);
  const vdcSafetyPct = Math.max(0, Math.min(20, get('calc-vdc-safety') || 0));
  const socMinPct    = Math.max(0, Math.min(50, get('calc-soc-min') || 0));
  const kTotal = kAge * kTemp * kDesign;
  return { kAge, kTemp, kDesign, kTotal, vdcSafetyPct, socMinPct };
}
const DERATING_PRESETS = {
  ieee485:    { kAge: 1.25, kTemp: 1.00, kDesign: 1.10, vdcSafetyPct: 0, socMinPct: 10 },
  iec62040:   { kAge: 1.20, kTemp: 1.00, kDesign: 1.05, vdcSafetyPct: 0, socMinPct: 10 },
  aggressive: { kAge: 1.25, kTemp: 1.11, kDesign: 1.15, vdcSafetyPct: 3, socMinPct: 20 },
  none:       { kAge: 1.00, kTemp: 1.00, kDesign: 1.00, vdcSafetyPct: 0, socMinPct: 0  },
};
function _applyDeratingPreset(name) {
  const p = DERATING_PRESETS[name];
  if (!p) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('calc-k-age', p.kAge);
  set('calc-k-temp', p.kTemp);
  set('calc-k-design', p.kDesign);
  set('calc-vdc-safety', p.vdcSafetyPct);
  set('calc-soc-min', p.socMinPct);
  _refreshDerateSummary();
  _refreshDcExplanation();
}
function _refreshDerateSummary() {
  const el = document.getElementById('calc-derate-summary');
  if (!el) return;
  const d = _readDerating();
  el.innerHTML =
    `Итог: <b>k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> = ${d.kAge.toFixed(2)}×${d.kTemp.toFixed(2)}×${d.kDesign.toFixed(2)} = ${d.kTotal.toFixed(3)}</b>`
    + ` — нагрузка на блок умножается на ${d.kTotal.toFixed(2)} (расчёт ёмкости с запасом ~${Math.round((d.kTotal - 1) * 100)}%).`
    + (d.vdcSafetyPct > 0 ? ` Окно V<sub>DC</sub> ±${d.vdcSafetyPct}%.` : '')
    + (d.socMinPct > 0 ? ` Резерв SoC (Li) ${d.socMinPct}%.` : '');
}

// v0.59.412: Подбор экономически оптимального числа блоков в цепочке.
// Не «середина диапазона», а МИНИМУМ блоков, удовлетворяющий двум физическим
// ограничениям ИБП:
//   • End-of-discharge: при разряде до endV V/cell итоговое V_DC ≥ vdcMin.
//     N · endV · cellsPerBlock ≥ vdcMin → N ≥ ⌈vdcMin / (endV · cells)⌉
//   • Float charge: при подзаряде V_DC ≤ vdcMax.
//     N · floatV · cellsPerBlock ≤ vdcMax → N ≤ ⌊vdcMax / (floatV · cells)⌋
// Также проверяется номинал: nMinNom ≤ N ≤ nMaxNom (на всякий случай).
// Из всех допустимых N выбирается минимальное (минимум блоков = минимум
// стоимости АКБ и занимаемой площади).
// v0.59.449: совместимость АКБ с конкретным ИБП.
// Возвращает { ok, reason, nLow, nHigh } — есть ли целое N блоков, при котором
// одновременно: N·endV·cellsPerBlock ≥ vdcMin·(1+safety) (выдержит разряд)
// и N·floatV·cellsPerBlock ≤ vdcMax·(1−safety) (не превысит на флоате).
// Для модульных систем (Kehua S³) blockVoltage = фиксированное напряжение
// готового модуля → проверяем, что vdcMin ≤ N·blockV ≤ vdcMax при N∈{1..3}.
function _isBatteryCompatibleWithUps(b, ups) {
  if (!b || !ups) return { ok: true, reason: '' };
  const vMin = Number(ups.vdcMin) || 0;
  const vMax = Number(ups.vdcMax) || 0;
  if (!(vMin > 0 && vMax > 0 && vMax >= vMin)) return { ok: true, reason: '' };
  const blockV = Number(b.blockVoltage) || 0;
  if (blockV <= 0) return { ok: true, reason: '' };
  const safety = Math.max(0, Math.min(20, _readDerating().vdcSafetyPct)) / 100;
  const vMinEff = vMin * (1 + safety);
  const vMaxEff = vMax * (1 - safety);
  // Для S³ и других «готовых» Li-Ion модулей подбор N по end-voltage не применим:
  // ячейки/BMS зашиты в модуль, есть свой диапазон. Берём номинал.
  if (isS3Module(b)) {
    for (let N = 1; N <= 3; N++) {
      const v = N * blockV;
      if (v >= vMinEff && v <= vMaxEff) return { ok: true, reason: '' };
    }
    return { ok: false, reason: `Номинал модуля ${blockV} В не попадает в окно ИБП ${vMin}…${vMax} В (с запасом ${(safety*100).toFixed(0)}%).` };
  }
  const chem = b.chemistry || 'vrla';
  const cellsPerBlock = Math.max(1, Math.round(blockV / 2));
  // v0.59.452: float 2.25 В/эл — типичная рекомендация ИБП-производителей
  // для VRLA (Eaton/Schneider/APC). 2.27 — теоретическая верхняя граница
  // от vendor'ов АКБ; на практике приводит к перезаряду в backup-режиме.
  const endVperCell = chem === 'li-ion' ? 2.5 : 1.85;
  const floatVperCell = chem === 'li-ion' ? 3.45 : 2.25;
  const endVperBlock = endVperCell * cellsPerBlock;
  const floatVperBlock = floatVperCell * cellsPerBlock;
  const nMin = Math.ceil(vMinEff / endVperBlock);
  const nMax = Math.floor(vMaxEff / floatVperBlock);
  if (nMin <= nMax && nMin >= 1) return { ok: true, reason: '', nLow: nMin, nHigh: nMax };
  return {
    ok: false,
    nLow: nMin, nHigh: nMax,
    reason: `Окно V_DC ИБП ${vMin}…${vMax} В не покрывает блок ${blockV} В: для разряда нужно N≥${nMin} (end ${endVperCell} В/эл.), для флоата N≤${nMax} (float ${floatVperCell} В/эл.). Слишком узкое окно для этой модели.`
  };
}

function _pickOptimalBlocks(vMin, vMax, blockV, endV, chemistry, vdcSafetyPct) {
  const cellsPerBlock = Math.max(1, Math.round(blockV / 2));
  // v0.59.452: float 2.25 В/эл — типичная рекомендация ИБП-производителей
  // (см. также _isBatteryCompatibleWithUps).
  const floatVperCell = chemistry === 'li-ion' ? 3.45 : 2.25;
  const endVperBlock   = endV * cellsPerBlock;
  const floatVperBlock = floatVperCell * cellsPerBlock;
  // v0.59.413: окно V_DC сужает диапазон ИБП симметрично — учёт ripple,
  // переходных процессов, падения на DC-шине и предохранителях.
  const safety = Math.max(0, Math.min(20, Number(vdcSafetyPct) || 0)) / 100;
  const vMinEff = (vMin || 0) * (1 + safety);
  const vMaxEff = (vMax || 0) * (1 - safety);
  const nMinDischarge = Math.ceil(vMinEff / endVperBlock);
  const nMaxFloat     = Math.floor(vMaxEff / floatVperBlock);
  const nMinNom       = Math.ceil(vMinEff / blockV);
  const nMaxNom       = Math.floor(vMaxEff / blockV);
  const nLow  = Math.max(nMinDischarge, nMinNom, 1);
  const nHigh = Math.min(nMaxFloat, nMaxNom);
  const feasible = nLow <= nHigh && nLow >= 1;
  return {
    N: feasible ? nLow : Math.max(1, nLow),
    feasible, nLow, nHigh,
    cellsPerBlock, endVperBlock, floatVperBlock, floatVperCell,
    nMinDischarge, nMaxFloat, nMinNom, nMaxNom,
    vMinEff, vMaxEff, vdcSafetyPct: safety * 100,
  };
}

// Обновляет подсказку под полем V_DC номинальное: показывает формулу,
// границы и причину выбора. Вызывается при изменении vdcMin/vdcMax/blockV/
// endV/chemistry и при выборе модели ИБП. Без зависимости от doCalc().
function _refreshDcExplanation() {
  const hint = document.getElementById('calc-dcv-hint');
  if (!hint) return;
  const get = id => document.getElementById(id);
  // v0.59.433: для S³ (и других модульных Li-Ion систем) логика подбора N
  // блоков по end-voltage не применима — там фиксированные топологии 240 /
  // ±240 / 480 ВDC модуля. Показываем короткое пояснение вместо VRLA-формул.
  const selBatt = get('calc-battery');
  const battery = (selBatt && selBatt.value) ? getBattery(selBatt.value) : null;
  if (battery && isS3Module(battery)) {
    const v0 = _getCurrentVdcRange(Number(get('calc-dcv')?.value) || 0);
    hint.innerHTML =
      `<div style="background:#eef7ff;border:1px solid #b3d4ff;padding:6px 8px;border-radius:4px;line-height:1.55">`
      + `<b>🔷 S³ Li-Ion:</b> топология DC-шины задаётся типом модуля (`
      + `${battery.blockVoltage} В номинал) и диапазоном V<sub>DC</sub> ИБП ${v0.known ? `${v0.min}…${v0.max} В` : ''}. `
      + `Подбор N-блоков и end-voltage на элемент (1.75 В…) не применим: `
      + `модуль уже укомплектован BMS и фиксированными ячейками LFP. `
      + `Число модулей и состав шкафов подбираются ниже автоматически.`
      + `</div>`;
    return;
  }
  const blockV = Number(get('calc-blockv')?.value) || 12;
  const endV = Number(get('calc-endv')?.value) || 1.75;
  const chemistry = get('calc-chem')?.value || 'vrla';
  const v = _getCurrentVdcRange(Number(get('calc-dcv')?.value) || 0);
  if (!v.known) { hint.innerHTML = ''; return; }
  const d = _readDerating();
  const o = _pickOptimalBlocks(v.min, v.max, blockV, endV, chemistry, d.vdcSafetyPct);
  const dc = o.N * blockV;
  const dcEnd   = (o.N * o.endVperBlock).toFixed(0);
  const dcFloat = (o.N * o.floatVperBlock).toFixed(0);
  const winNote = d.vdcSafetyPct > 0
    ? ` (с окном ±${d.vdcSafetyPct}% → эффективно ${o.vMinEff.toFixed(0)}…${o.vMaxEff.toFixed(0)} В)`
    : '';
  hint.innerHTML =
    `<div style="background:#f0f7ff;border:1px solid #b3d4ff;padding:6px 8px;border-radius:4px;line-height:1.55">`
    + `<b>📐 Подбор N (экономически оптимальный):</b><br>`
    + `Диапазон ИБП V<sub>DC</sub> мин/макс: <b>${v.min}…${v.max} В</b>${winNote}. `
    + `Блок ${blockV} В = ${o.cellsPerBlock} элементов. `
    + `End ${endV} В/эл → ${o.endVperBlock.toFixed(2)} В/блок. `
    + `Float ${o.floatVperCell} В/эл → ${o.floatVperBlock.toFixed(2)} В/блок.<br>`
    + `Нижняя граница N (чтобы при разряде V<sub>DC</sub> ≥ ${o.vMinEff.toFixed(0)} В): `
    + `⌈${o.vMinEff.toFixed(0)}/${o.endVperBlock.toFixed(2)}⌉ = <b>${o.nMinDischarge}</b>.<br>`
    + `Верхняя граница N (чтобы при float V<sub>DC</sub> ≤ ${o.vMaxEff.toFixed(0)} В): `
    + `⌊${o.vMaxEff.toFixed(0)}/${o.floatVperBlock.toFixed(2)}⌋ = <b>${o.nMaxFloat}</b>.<br>`
    + (o.feasible
      ? `Выбран <b>МИНИМУМ N = ${o.N}</b> (минимум блоков → минимум стоимости и места). `
        + `Номинал V<sub>DC</sub> = ${o.N}×${blockV} = <b>${dc} В</b>. `
        + `Конечное при разряде ≈ ${dcEnd} В, при float ≈ ${dcFloat} В — оба в допуске.`
      : `<b style="color:#c62828">⚠ Диапазон не покрывается:</b> N<sub>min</sub>=${o.nLow} > N<sub>max</sub>=${o.nHigh}. `
        + (() => {
            // v0.59.451: подсказываем подходящий блок.
            const candidates = [2, 4, 6, 12].filter(bv => bv !== blockV);
            const altsOk = candidates.filter(bv => {
              const cells = Math.max(1, Math.round(bv / 2));
              const endB = endV * cells;
              const flB  = o.floatVperCell * cells;
              const nMin = Math.ceil(o.vMinEff / endB);
              const nMax = Math.floor(o.vMaxEff / flB);
              return nMin <= nMax && nMin >= 1;
            });
            // v0.59.454: считаем минимальный endV, при котором уравнение
            // решается. endV_min = vMinEff / (nMaxFloat · cellsPerBlock).
            // Также показываем при каком U/блок ИБП отключится при N=nMaxFloat.
            const endVmin = o.nMaxFloat > 0
              ? (o.vMinEff / (o.nMaxFloat * o.cellsPerBlock))
              : null;
            const tip = altsOk.length
              ? `Попробуйте блок <b>${altsOk.join(' или ')} В</b> вместо ${blockV} В — окно V<sub>DC</sub> для них покрывается. `
              : '';
            const physics = endVmin && endVmin <= 2.0
              ? `<br><b>Физический смысл:</b> при N=${o.nMaxFloat} блоков (макс. для флоата ${o.floatVperBlock.toFixed(2)} В/блок) ИБП отключится по нижнему порогу при `
                + `${(o.vMinEff/o.nMaxFloat).toFixed(2)} В/блок = <b>${endVmin.toFixed(2)} В/эл.</b> — это и есть <b>минимальный достижимый endV</b> на этом ИБП. `
                + `Глубже разрядить нельзя: ИБП первым уйдёт в shutdown.`
              : `<br><b>Физический смысл:</b> соотношение float/end = ${(o.floatVperCell/endV).toFixed(3)} больше окна ИБП V<sub>max</sub>/V<sub>min</sub> = ${(o.vMaxEff/o.vMinEff).toFixed(3)} → батарея «качается» сильнее, чем готов терпеть ИБП. Нужен ИБП с более широким окном.`;
            const action = endVmin && endVmin <= 2.0
              ? `<br><b>Решение:</b> установите endV ≥ ${endVmin.toFixed(2)} В/эл. (рекомендую ${Math.ceil(endVmin*100)/100} В/эл.) — тогда N=${o.nMaxFloat} впишется и в разряд, и во флоат.`
              : `<br><b>Решение:</b> снизьте float (если допускает АКБ) или возьмите ИБП с более широким V<sub>DC</sub>.`;
            return tip + physics + action;
          })())
    + `</div>`;
}

// Авто-подбор числа параллельных цепочек:
// - autonomy mode: минимум strings, при котором blockPower вписывается в таблицу
//   (для table-based расчёта) или усреднённая модель даёт positive autonomy.
// - required mode: вернуть 1 (calcRequiredBlocks сам итерирует по strings).
function _autoSelectStrings({ battery, loadKw, blocksPerString, blockV, endV, invEff, chemistry, capacityAh, mode, targetMin }) {
  if (!(loadKw > 0)) return { strings: 1, warning: null };
  if (mode === 'required') return { strings: 1, warning: null }; // calcRequiredBlocks сам подбирает
  const maxStrings = 200;
  const totalPowerW = (loadKw * 1000) / Math.max(0.5, invEff);
  // Ищем minimum strings, при котором расчёт даёт sane результат (без extrapolation если возможно)
  let bestNoExtrap = null;
  for (let s = 1; s <= maxStrings; s++) {
    const r = calcAutonomy({
      battery, loadKw, dcVoltage: blocksPerString * blockV,
      strings: s, blocksPerString, endV, invEff, chemistry, capacityAh,
    });
    if (r.feasible && r.autonomyMin > 0 && Number.isFinite(r.autonomyMin)) {
      if (!r.extrapolated) { bestNoExtrap = s; break; }
    }
  }
  if (bestNoExtrap) return { strings: bestNoExtrap, warning: null };
  // Если без экстраполяции не нашли — берём minimum, при котором хоть feasible
  for (let s = 1; s <= maxStrings; s++) {
    const r = calcAutonomy({
      battery, loadKw, dcVoltage: blocksPerString * blockV,
      strings: s, blocksPerString, endV, invEff, chemistry, capacityAh,
    });
    if (r.feasible && r.autonomyMin > 0) {
      return { strings: s, warning: 'Решение получено экстраполяцией — таблица производителя не покрывает запрошенный режим' };
    }
  }
  return { strings: 1, warning: 'Не удалось подобрать число цепочек ≤ ' + maxStrings };
}

// v0.59.417: S³-ветка doCalc(). Использует ЕДИНЫЙ shared/battery-s3-logic.js
// (тот же модуль, что и инспектор). Авто-определяет N (модулей в шкафу) =
// maxPerCabinet и C (шкафов) = ceil(loadKw / cabinetPowerKw); для обратного
// режима — findMinimalS3Config. Никакого дублирования логики — всё в shared.
// v0.59.427: рендер блока «состав системы S³» на основе плагина
// s3LiIonType.buildSystem(). Показывает шкафы (master / slave / combiner)
// и аксессуары (wire-kit / networking device / blank panels), плюс
// предупреждение от validateMaxCRate если есть.
function _renderS3SystemSpecHtml(battery, totalModules, loadKw, invEff, requestedCabinetsCount) {
  if (!battery || !(totalModules > 0)) return '';
  const allBatts = listBatteries();
  const accessoryCatalog = allBatts.filter(b => b.systemSubtype === 'accessory');
  const masterVariant = (document.getElementById('calc-s3-master-variant')?.value) || 'M';
  const slaveVariant  = (document.getElementById('calc-s3-slave-variant')?.value)  || 'S';
  const fireFighting  = (document.getElementById('calc-s3-fire-fighting')?.value)  || 'X';
  // v0.59.434: предварительная проверка лимита 200 кВт/шкаф (минимум по power).
  // v0.59.476: учитываем явно запрошенное число шкафов (от findMinimalS3Config) —
  // оно может быть больше power-limit, например когда блок-диагностика 2 шкафа.
  // Берём максимум: max(power-limit, requested).
  const preChk = s3LiIonType.validateMaxCRate({ module: battery, loadKw, totalModules, invEff });
  const minByPower = (preChk && preChk.suggestedMinCabinets) || 0;
  const minByRequest = Number(requestedCabinetsCount) || 0;
  const minCabinets = Math.max(minByPower, minByRequest);
  const spec = s3LiIonType.buildSystem({
    module: battery, totalModules,
    options: { masterVariant, slaveVariant, fireFighting, minCabinets },
  });
  const bom  = s3LiIonType.bomLines(spec, { module: battery, accessoryCatalog });
  // Финальный чек уже на фактической конфигурации (cabinetsCount после bump).
  const cRateChk = s3LiIonType.validateMaxCRate({
    module: battery, loadKw, totalModules: spec.totalModules || totalModules, invEff,
  });
  // Override cabinetsCount in cRateChk to match spec — для корректной строки «На шкаф».
  if (cRateChk && spec.cabinetsCount) {
    cRateChk.cabinetsCount = spec.cabinets.filter(c => c.role !== 'combiner').length;
    cRateChk.perCabinetKw = cRateChk.reqKw / Math.max(1, cRateChk.cabinetsCount);
  }
  const autoBumped = minCabinets > 0 && spec.cabinets.filter(c => c.role !== 'combiner').length > Math.ceil(totalModules / (battery.packaging?.maxPerCabinet || 4));

  // v0.59.435: группируем одинаковые шкафы (роль + модель + заполнение)
  // и выводим колонку «Кол-во» вместо повторения N одинаковых строк.
  const groups = [];
  for (const c of spec.cabinets) {
    const fillStr = c.role === 'combiner' ? '— (шинная разводка DC)' :
      `${c.modulesInCabinet} мод.${c.emptySlots > 0 ? ` + ${c.emptySlots} заглушек` : ''}`;
    const key = `${c.role}|${c.model}|${fillStr}`;
    const found = groups.find(g => g.key === key);
    if (found) found.qty += 1;
    else groups.push({ key, role: c.role, model: c.model, fillStr, qty: 1 });
  }
  const cabinetRows = groups.map(g => {
    const roleLabel = g.role === 'master' ? 'Master' : g.role === 'slave' ? 'Slave' : 'Combiner';
    return `<tr><td>${escHtml(roleLabel)}</td><td><b>${escHtml(g.model)}</b></td><td>${g.fillStr}</td><td style="text-align:center"><b>${g.qty}</b></td></tr>`;
  }).join('');
  // v0.59.437: отдельная строка «модули» в таблице — battery.type N шт.
  let modulesRow = '';
  let totalModulesUsedUi = 0;
  for (const c of spec.cabinets) totalModulesUsedUi += (c.modulesInCabinet || 0);
  if (totalModulesUsedUi > 0) {
    const modModel = battery.type || battery.model || 'S3M';
    const ahStr = battery.capacityAh ? ` · ${battery.capacityAh} А·ч` : '';
    const vStr  = battery.blockVoltage ? ` · ${battery.blockVoltage} В` : '';
    modulesRow = `<tr style="background:#f5fbf5"><td>Модуль</td><td><b>${escHtml(modModel)}</b></td><td>${escHtml((battery.supplier||'Kehua') + ahStr + vStr)}</td><td style="text-align:center"><b>${totalModulesUsedUi}</b></td></tr>`;
  }

  const accRows = (spec.accessories || []).map(a => {
    const cat = accessoryCatalog.find(x => x.id === a.id);
    const name = cat ? (cat.type || cat.id) : a.id;
    const desc = cat ? (cat.systemDescription || '') : '';
    return `<tr><td>${escHtml(name)}</td><td>${a.qty}</td><td class="muted" style="font-size:11px">${escHtml(desc)}</td></tr>`;
  }).join('');

  let html = `<div class="result-block" style="margin-top:14px">`;
  html += `<div class="result-title">Состав системы (автосборка)</div>`;
  // v0.59.437: настоящий 3D-вид (Three.js + OrbitControls). Контейнер
  // монтируется лениво из _renderS3SystemSpecHtml's caller (после insert-html).
  // Здесь просто оставляем плейсхолдер, mountS3ThreeDView вызовется в DOM.
  const _s3v3dId = 's3-3d-view-' + Math.random().toString(36).slice(2, 8);
  html += `<div id="${_s3v3dId}" data-s3-3d-mount="1" style="margin-top:10px"></div>`;
  // запоминаем spec для post-mount через MutationObserver-стиль:
  // прокидываем через окно (singleton — последний рендер). Простое решение.
  window.__pendingS3Mount = { id: _s3v3dId, spec };
  html += `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">`;
  html += `<thead><tr style="background:#f5f7fa"><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Роль</th><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Модель шкафа</th><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Заполнение</th><th style="text-align:center;padding:6px;border:1px solid #e0e3ea;width:60px">Кол-во</th></tr></thead>`;
  html += `<tbody>${(cabinetRows + modulesRow).replace(/<td>/g, '<td style="padding:6px;border:1px solid #e0e3ea">')}</tbody>`;
  html += `</table>`;

  if (accRows) {
    html += `<div class="result-title" style="margin-top:12px;font-size:13px">Аксессуары (BOM)</div>`;
    html += `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">`;
    html += `<thead><tr style="background:#f5f7fa"><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Наименование</th><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Кол-во</th><th style="text-align:left;padding:6px;border:1px solid #e0e3ea">Описание</th></tr></thead>`;
    html += `<tbody>${accRows.replace(/<td>/g, '<td style="padding:6px;border:1px solid #e0e3ea;vertical-align:top">')}</tbody>`;
    html += `</table>`;
  }

  if (spec.warnings && spec.warnings.length) {
    spec.warnings.forEach(w => { html += `<div class="warn" style="margin-top:6px">⚠ ${escHtml(w)}</div>`; });
  }
  if (autoBumped) {
    const realCabinets = spec.cabinets.filter(c => c.role !== 'combiner').length;
    html += `<div style="margin-top:6px;background:#e8f5e9;border:1px solid #a5d6a7;padding:8px;border-radius:4px;font-size:12px">ℹ <b>Авто-добавление шкафов.</b> Расчётная нагрузка превышала лимит 200 кВт/шкаф — система автоматически расширена до <b>${realCabinets} шкаф${realCabinets === 1 ? '' : 'ов'}</b> (нагрузка/шкаф ≤ 200 кВт). Свободные слоты заполнены blank-панелями.</div>`;
  }
  if (cRateChk && !cRateChk.ok) {
    html += `<div class="warn" style="margin-top:6px;background:#ffebee;border:1px solid #ef9a9a;padding:8px;border-radius:4px">⚠ <b>Превышение лимита.</b> ${escHtml(cRateChk.reason)}</div>`;
  } else if (cRateChk && cRateChk.cRate) {
    const used = cRateChk.reqKw / cRateChk.ratedSystemKw * 100;
    const cabLine = (cRateChk.cabinetsCount && cRateChk.perCabinetKw != null)
      ? ` На шкаф: ${fmt(cRateChk.perCabinetKw)} кВт / ${cRateChk.cabinetMaxKw} кВт лимит (${cRateChk.cabinetsCount} шкаф${cRateChk.cabinetsCount === 1 ? '' : 'ов'}).`
      : '';
    html += `<div class="muted" style="font-size:11px;margin-top:6px">Загрузка по C-rate: ${used.toFixed(1)}% от паспортной мощности системы (${fmt(cRateChk.ratedSystemKw)} кВт при ${cRateChk.cRate}C × ${totalModules} мод.).${cabLine}</div>`;
  }
  html += `</div>`;
  return html;
}

function _doCalcS3({ battery, loadKw, mode, targetMin, vRange, derate, invEff }) {
  const out = document.getElementById('calc-result');
  if (!out) return;
  const lim = (battery.packaging || {});
  // Эффективная нагрузка с дерейтингом и SoC-резервом (как для VRLA).
  let loadKwEff = loadKw * derate.kTotal;
  if (derate.socMinPct > 0) loadKwEff = loadKwEff / Math.max(0.5, 1 - derate.socMinPct / 100);

  // Wiring — авто. Определяется в computeS3Configuration по диапазону Vdc ИБП.
  // Авто-N: максимум на шкаф (минимизирует число шкафов и стоимость каркаса).
  // Авто-C: для autonomy — минимум, в котором мощность вписывается; для
  // required — calcAutonomy перебирает в findMinimalS3Config.
  let s3Cfg = null, found = null, calcResult = null, html = '';
  if (mode === 'autonomy') {
    // v0.59.489: для S³ в autonomy режиме читаем РУЧНЫЕ значения N (модулей
    // в шкафу) и M (шкафов) — пользователь может задать конкретную сборку
    // из паспортной таблицы Kehua (например, 1 шкаф × 20 модулей для UPS
    // 200 кВт / 10 мин по «Battery Configuration Table»). Если ручные
    // значения не заданы — берём авто (max модулей и min шкафов по нагрузке).
    const manualN = Number(document.getElementById('calc-blocks')?.value);
    const manualM = Number(document.getElementById('calc-strings-manual')?.value);
    const maxN = Number(lim.maxPerCabinet) || 20;
    const useN = (Number.isFinite(manualN) && manualN >= 1 && manualN <= maxN) ? manualN : maxN;
    let useC;
    if (Number.isFinite(manualM) && manualM >= 1) {
      useC = manualM;
    } else {
      const probe = computeS3Configuration({
        module: battery, loadKw: loadKwEff,
        vdcMin: vRange.min, vdcMax: vRange.max, invEff,
        modulesPerCabinet: useN, cabinetsCount: 1,
      });
      useC = probe ? probe.minCabinetsForLoad : 1;
    }
    s3Cfg = computeS3Configuration({
      module: battery, loadKw: loadKwEff,
      vdcMin: vRange.min, vdcMax: vRange.max, invEff,
      modulesPerCabinet: useN,
      cabinetsCount: useC,
    });
    const r = calcAutonomy({
      battery, loadKw: loadKwEff,
      dcVoltage: s3Cfg.vdcOper, strings: s3Cfg.cabinetsCount,
      blocksPerString: s3Cfg.modulesPerCabinet,
      // v0.59.445: для Li-Ion (LFP) EoD ~2.5 В/элемент, не 1.75 В как у VRLA.
      endV: 2.5, invEff, chemistry: 'li-ion',
      capacityAh: battery.capacityAh,
    });
    calcResult = { kind: 'autonomy', r, blocksPerString: s3Cfg.modulesPerCabinet, derate, loadKwEff, s3Cfg };
    html += `<div class="result-block">`;
    html += `<div class="result-title">Автономия системы Kehua S³ (${escHtml(battery.type)})</div>`;
    html += `<div class="result-value">${Number.isFinite(r.autonomyMin) ? fmt(r.autonomyMin) + ' мин' : '∞'}</div>`;
    html += `<div class="result-sub">Конфигурация (авто): <b>${s3Cfg.cabinetsCount} шкаф(ов) × ${s3Cfg.modulesPerCabinet} модулей</b> = ${s3Cfg.totalModules} мод. · V<sub>DC</sub>=${s3Cfg.vdcOper} В (${s3Cfg.wiring === 'series' ? '±240 В биполярная (series 2×240)' : '240 В параллельная (parallel)'})</div>`;
    html += `<div class="result-sub">Шкаф: <b>${escHtml(s3Cfg.cabinetModel)}</b> · паспорт ${fmt(s3Cfg.cabinetPowerKw)} кВт · до ${s3Cfg.nMax} модулей</div>`;
    html += `<div class="result-sub">На модуль: <b>${fmt(s3Cfg.powerPerModuleW)} W</b> · ёмкость системы: <b>${fmt(s3Cfg.totalKwh)} кВт·ч</b></div>`;
    html += `<div class="result-sub">Требуемая мощность от АКБ: ${fmt(s3Cfg.batteryPwrReqKw)} кВт · паспорт системы: ${fmt(s3Cfg.systemPowerKw)} кВт</div>`;
    if (s3Cfg.overload) {
      html += `<div class="warn">⚠ Перегруз шкафа: требуется ${fmt(s3Cfg.batteryPwrReqKw)} кВт > паспортные ${fmt(s3Cfg.systemPowerKw)} кВт. Минимум шкафов: ${s3Cfg.minCabinetsForLoad}.</div>`;
    }
    if (derate.kTotal > 1.001 || derate.socMinPct > 0) {
      html += `<div class="result-sub" style="background:#f0f7ff;padding:4px 6px;border-radius:3px;font-size:11px">`
        + `k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> = ${derate.kAge.toFixed(2)}×${derate.kTemp.toFixed(2)}×${derate.kDesign.toFixed(2)} = <b>${derate.kTotal.toFixed(3)}</b>`
        + ` → расчётная нагрузка <b>${fmt(loadKwEff)} kW</b> (паспортная ${fmt(loadKw)} kW).`
        + (derate.socMinPct > 0 ? ` Резерв SoC ${derate.socMinPct}%.` : '')
        + `</div>`;
    }
    if (r.extrapolated) html += `<div class="warn" style="background:#fff3e0;border:1px solid #ffb74d;padding:6px 8px;border-radius:4px;margin-top:6px"><b>⚠ Условный расчёт.</b> Запрошенное время вне таблицы производителя — линейная экстраполяция.</div>`;
    if (r.warnings && r.warnings.length) html += r.warnings.map(w => `<div class="warn">⚠ ${escHtml(w)}</div>`).join('');
    html += `</div>`;
  } else {
    // Обратный режим: минимум модулей и шкафов для targetMin.
    found = findMinimalS3Config({
      module: battery, loadKw: loadKwEff, requiredAutonomyMin: targetMin,
      vdcMin: vRange.min, vdcMax: vRange.max, invEff,
      calcAutonomyFn: calcAutonomy,
    });
    if (found.ok) {
      s3Cfg = computeS3Configuration({
        module: battery, loadKw: loadKwEff,
        vdcMin: vRange.min, vdcMax: vRange.max, invEff,
        modulesPerCabinet: found.modulesPerCabinet,
        cabinetsCount: found.cabinetsCount,
      });
      calcResult = {
        kind: 'required',
        found: {
          totalBlocks: found.total,
          strings: found.cabinetsCount,
          blocksPerString: found.modulesPerCabinet,
          result: { autonomyMin: found.autonomyMin, blockPowerW: s3Cfg.powerPerModuleW, method: 'table' },
        },
        blocksPerString: found.modulesPerCabinet, derate, loadKwEff, s3Cfg,
      };
      html += `<div class="result-block">`;
      html += `<div class="result-title">Минимум для автономии ≥ ${targetMin} мин (Kehua S³ ${escHtml(battery.type)})</div>`;
      html += `<div class="result-value">${found.cabinetsCount} шкаф(ов) × ${found.modulesPerCabinet} мод. = ${found.total}</div>`;
      html += `<div class="result-sub">V<sub>DC</sub>=${s3Cfg.vdcOper} В (${s3Cfg.wiring === 'series' ? '±240 В биполярная (series 2×240)' : '240 В параллельная (parallel)'}) · шкаф <b>${escHtml(s3Cfg.cabinetModel)}</b> · паспорт ${fmt(s3Cfg.cabinetPowerKw)} кВт</div>`;
      html += `<div class="result-sub">Реальная автономия: <b>${fmt(found.autonomyMin)} мин</b> · на модуль: <b>${fmt(s3Cfg.powerPerModuleW)} W</b> · ёмкость: <b>${fmt(s3Cfg.totalKwh)} кВт·ч</b></div>`;
      if (found.limitedByPower) html += `<div class="result-sub" style="color:#666;font-size:11px">Число шкафов ограничено паспортной мощностью системы (${fmt(s3Cfg.systemPowerKw)} кВт).</div>`;
      if (derate.kTotal > 1.001 || derate.socMinPct > 0) {
        html += `<div class="result-sub" style="background:#f0f7ff;padding:4px 6px;border-radius:3px;font-size:11px">`
          + `k<sub>total</sub> = <b>${derate.kTotal.toFixed(3)}</b> → расч. <b>${fmt(loadKwEff)} kW</b> (пасп. ${fmt(loadKw)} kW).`
          + (derate.socMinPct > 0 ? ` SoC ${derate.socMinPct}%.` : '')
          + `</div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="result-block error">Не удалось подобрать S³-конфигурацию: ${escHtml(found.reason || 'unknown')}</div>`;
    }
  }
  // v0.59.427: блок «состав шкафов + аксессуары» — собирается плагином
  // s3LiIonType.buildSystem({module, totalModules}) на основе результата
  // computeS3Configuration. Показывает master/slave/combiner и BOM-список
  // аксессуаров (Slave Wire Kit, Networking Device, Blank Panel).
  if (s3Cfg && s3Cfg.totalModules > 0) {
    html += _renderS3SystemSpecHtml(battery, s3Cfg.totalModules, loadKwEff, invEff, s3Cfg.cabinetsCount);
  }

  // График разряда + zoom (как для обычной АКБ — battery.dischargeTable есть).
  html += `<div class="result-block" style="margin-top:14px"><div class="result-title" style="margin-bottom:8px">График разряда модуля</div><div id="calc-chart-mount" style="background:#fafbfc;border:1px solid #e0e3ea;border-radius:6px;padding:12px"></div><div class="muted" style="font-size:11px;margin-top:6px">Кривая P(t) для одного модуля. Красный маркер — рабочая точка.</div></div>`;
  html += `<div class="result-block" style="margin-top:14px"><div class="result-title" style="margin-bottom:8px">Детализация в рабочей зоне (zoom)</div><div id="calc-chart-zoom-mount" style="background:#fafbfc;border:1px solid #e0e3ea;border-radius:6px;padding:12px"></div></div>`;
  out.innerHTML = html;

  // v0.59.437: монтируем настоящий 3D-вид S³ (Three.js) после insert-html.
  try {
    const pend = window.__pendingS3Mount;
    if (pend && pend.id) {
      const cont = document.getElementById(pend.id);
      if (cont) mountS3ThreeDView(cont, pend.spec, { height: 380 });
      window.__pendingS3Mount = null;
    }
  } catch (e) { console.warn('[battery-calc] s3 3d mount failed', e); }

  const params = {
    battery, chemistry: 'li-ion', loadKw,
    dcVoltage: s3Cfg ? s3Cfg.vdcOper : 0,
    strings: s3Cfg ? s3Cfg.cabinetsCount : 1,
    // v0.59.445: для Li-Ion (LFP) EoD ~2.5 В/элемент, не 1.75 В как у VRLA.
    endV: 2.5, invEff, mode, targetMin,
    capacityAh: battery.capacityAh,
  };
  _renderCalcDischargeChart(params, calcResult, s3Cfg ? s3Cfg.modulesPerCabinet : 1, battery.blockVoltage);
  _renderCalcDischargeChartZoom(params, calcResult, s3Cfg ? s3Cfg.modulesPerCabinet : 1, battery.blockVoltage);

  lastBatteryCalc = { params, calcResult, vRange, opt: null, dcVoltageRaw: 0, blockV: battery.blockVoltage, dcWarn: null, s3Cfg };
  const btnRpt = document.getElementById('btn-battery-report');
  if (btnRpt) btnRpt.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
  const btnPrn = document.getElementById('btn-battery-print');
  if (btnPrn) btnPrn.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
  const btnSav = document.getElementById('btn-battery-save-config');
  if (btnSav) btnSav.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
}

function doCalc() {
  const out = document.getElementById('calc-result');
  if (!out) return;
  const get = id => document.getElementById(id);
  const battery = get('calc-battery').value ? getBattery(get('calc-battery').value) : null;
  const chemistry = get('calc-chem').value;
  const loadKw = Number(get('calc-load').value) || 0;
  const dcVoltageRaw = Number(get('calc-dcv').value) || 0;
  const endV = Number(get('calc-endv').value) || 1.75;
  const invEff = Math.max(0.5, Math.min(1, (Number(get('calc-inveff').value) || 94) / 100));
  const mode = get('calc-mode').value;
  // v0.59.485: для auto-режима читаем calc-target-auto (свой input), для
  // required — calc-target. Раньше всегда читался calc-target → в auto
  // режиме targetMin был зашит на дефолт 10 независимо от ввода
  // пользователя в видимое поле «Целевая автономия» auto-варианта.
  const targetMin = (mode === 'auto')
    ? (Number(get('calc-target-auto')?.value) || Number(get('calc-target')?.value) || 10)
    : (Number(get('calc-target')?.value) || 10);
  const capacityAh = Number(get('calc-capAh').value) || 100;

  // v0.59.417: S³-модуль идёт по отдельной ветке через ЕДИНЫЙ shared-модуль
  // (тот же, что в инспекторе ИБП). Авто-N=maxPerCabinet, авто-C по мощности.
  if (battery && isS3Module(battery)) {
    const vRange = _getCurrentVdcRange(dcVoltageRaw);
    const derate = _readDerating();
    return _doCalcS3({ battery, loadKw, mode, targetMin, vRange, derate, invEff });
  }

  const blockV = battery ? battery.blockVoltage : (Number(get('calc-blockv').value) || 12);

  // v0.59.413: коэффициенты дерейтинга (IEEE 485 / IEC 62040).
  const derate = _readDerating();
  // Эффективная нагрузка для расчёта ёмкости АКБ. k_total учитывает
  // старение, температуру и конструктивный запас. Для Li-ion дополнительно
  // делим располагаемую ёмкость на (1 - socMin/100) — что эквивалентно
  // увеличению нагрузки. Для VRLA — без socMin (используется только endV).
  let loadKwEff = loadKw * derate.kTotal;
  if (chemistry === 'li-ion' && derate.socMinPct > 0) {
    loadKwEff = loadKwEff / Math.max(0.5, 1 - derate.socMinPct / 100);
  }

  // Получаем V_DC min/max из текущего источника (UPS picker / manual / handoff).
  // Если диапазон неизвестен — допускаем ±5% от dcVoltageRaw (мягкая граница).
  const vRange = _getCurrentVdcRange(dcVoltageRaw);
  // v0.59.412: ЭКОНОМИЧЕСКИ ОПТИМАЛЬНЫЙ подбор N (а не середина диапазона).
  // Минимум блоков → минимум денег и места. Ограничения:
  //   1) при разряде до endV V/cell напряжение не должно упасть ниже vdcMin;
  //   2) при float-charge напряжение не должно превысить vdcMax.
  // → N_min_safe = ⌈vdcMin / (endV · cellsPerBlock)⌉
  // → N_max_safe = ⌊vdcMax / (floatV · cellsPerBlock)⌋
  // → оптимально = N_min_safe.
  const opt = _pickOptimalBlocks(vRange.min, vRange.max, blockV, endV, chemistry, derate.vdcSafetyPct);
  let blocksPerString = opt.N;
  let dcWarn = null;
  if (!opt.feasible) {
    blocksPerString = Math.max(1, opt.N);
    dcWarn = `Невозможно строго уложить цепочку в диапазон ИБП ${vRange.min}…${vRange.max} В при блоке ${blockV} В, endV ${endV} В/эл (≈${opt.endVperBlock.toFixed(1)} В/блок) и float ≈${opt.floatVperBlock.toFixed(1)} В/блок. Нижняя граница N=${opt.nLow}, верхняя N=${opt.nHigh}. Принят минимум ${blocksPerString}.`;
  }
  // v0.59.474: в режиме 'autonomy' пользователь может задать N вручную.
  // Если значение валидно — используем его; иначе fallback на авто-подбор.
  if (mode === 'autonomy') {
    const manualN = Number(get('calc-blocks')?.value);
    if (Number.isFinite(manualN) && manualN >= 1) {
      blocksPerString = manualN;
      // Проверка: лежит ли вне V_DC окна — даём warning.
      if (opt.feasible && (manualN < opt.nLow || manualN > opt.nHigh)) {
        dcWarn = `N=${manualN} вне рекомендованного диапазона V_DC ИБП [${opt.nLow}…${opt.nHigh}]. Расчёт продолжается, но при разряде V_DC может выйти за паспорт ИБП.`;
      }
    }
  }
  const dcVoltage = blocksPerString * blockV;

  // Авто-выбор числа цепочек (strings).
  // Стратегия: минимум strings, при котором мощность на блок не превышает
  // максимум таблицы (или хотя бы feasible в усреднённой модели).
  // При loadKw=0 — strings=1 (нет нагрузки).
  // v0.59.474: в режиме 'autonomy' пользователь может задать M вручную.
  let strings;
  let stringsAuto = { warning: null };
  if (mode === 'autonomy') {
    const manualM = Number(get('calc-strings-manual')?.value);
    strings = (Number.isFinite(manualM) && manualM >= 1) ? manualM : 1;
  } else {
    stringsAuto = _autoSelectStrings({
      battery, loadKw: loadKwEff, blocksPerString, blockV, endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
      mode, targetMin,
    });
    strings = stringsAuto.strings;
  }
  // Отражаем значение в UI (display-поля для каждого режима)
  const strEl = get('calc-strings');
  if (strEl) strEl.value = strings;
  const strADEl = get('calc-strings-auto-display');
  if (strADEl) strADEl.value = strings;
  const dcEl = get('calc-dcv');
  if (dcEl) dcEl.value = dcVoltage;

  const params = { battery, chemistry, loadKw, dcVoltage, strings, endV, invEff, mode, targetMin, capacityAh };

  let html = '';
  let calcResult = null;
  if (mode === 'autonomy') {
    // Прямая задача: дано — сколько блоков, нагрузка → автономия
    const r = calcAutonomy({
      battery, loadKw: loadKwEff, dcVoltage, strings, blocksPerString,
      endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
    });
    calcResult = { kind: 'autonomy', r, blocksPerString, derate, loadKwEff };
    html += `<div class="result-block">`;
    html += `<div class="result-title">Автономия системы</div>`;
    html += `<div class="result-value">${Number.isFinite(r.autonomyMin) ? fmt(r.autonomyMin) + ' мин' : '∞'}</div>`;
    html += `<div class="result-sub">Метод: <b>${r.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель'}</b></div>`;
    html += `<div class="result-sub">Конфигурация (авто): <b>${strings} цеп. × ${blocksPerString} бл.</b> · V<sub>DC</sub>=${dcVoltage} В ${vRange.known ? `(в диапазоне ${vRange.min}…${vRange.max} В)` : ''}</div>`;
    html += `<div class="result-sub">На блок: <b>${fmt(r.blockPowerW)} W</b>, всего блоков: <b>${strings * blocksPerString}</b></div>`;
    if (derate.kTotal > 1.001 || derate.vdcSafetyPct > 0 || derate.socMinPct > 0) {
      html += `<div class="result-sub" style="background:#f0f7ff;padding:4px 6px;border-radius:3px;font-size:11px">`
        + `Учтены коэффициенты: k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> = ${derate.kAge.toFixed(2)}×${derate.kTemp.toFixed(2)}×${derate.kDesign.toFixed(2)} = <b>${derate.kTotal.toFixed(3)}</b>`
        + ` → расчётная нагрузка <b>${fmt(loadKwEff)} kW</b> (паспортная ${fmt(loadKw)} kW).`
        + (derate.vdcSafetyPct > 0 ? ` Окно V<sub>DC</sub> ±${derate.vdcSafetyPct}%.` : '')
        + (chemistry === 'li-ion' && derate.socMinPct > 0 ? ` Резерв SoC ${derate.socMinPct}%.` : '')
        + `</div>`;
    }
    if (dcWarn) html += `<div class="warn">⚠ ${escHtml(dcWarn)}</div>`;
    if (stringsAuto.warning) html += `<div class="warn">⚠ ${escHtml(stringsAuto.warning)}</div>`;
    if (r.extrapolated) html += `<div class="warn" style="background:#fff3e0;border:1px solid #ffb74d;padding:6px 8px;border-radius:4px;margin-top:6px"><b>⚠ Условный расчёт.</b> Запрошенное время разряда находится вне таблицы производителя — значение получено линейной экстраполяцией. Не подтверждено производителем.</div>`;
    if (r.warnings.length) html += r.warnings.map(w => `<div class="warn">⚠ ${escHtml(w)}</div>`).join('');
    html += `</div>`;
  } else if (mode === 'auto') {
    // v0.59.469/473: Авто-оптимум — пользователь задаёт только P+t.
    // Перебираем (endV × blockV) когда конкретная АКБ не выбрана из каталога;
    // если выбрана — фиксируем blockV из её паспорта. Для каждой пары:
    // feasibility по V_DC окну ИБП + N через _pickOptimalBlocks + расчёт.
    // Критерий выбора (приоритет): max endV (бережнее) → min totalBlocks
    // (дешевле) → min blockV (стандартные 12В часто экономически оптимальнее).
    const targetMinAuto = Number(get('calc-target-auto')?.value) || targetMin;
    const isLi = chemistry === 'li-ion';
    const evCandidates = isLi ? [2.5, 2.6, 2.7, 2.8, 2.9, 3.0] : [1.65, 1.70, 1.75, 1.80, 1.85, 1.90];
    const bvCandidates = battery ? [blockV] : (isLi ? [12, 24, 48] : [2, 4, 6, 12]);
    const trials = [];
    for (const bv of bvCandidates) {
      for (const ev of evCandidates) {
        const optT = _pickOptimalBlocks(vRange.min, vRange.max, bv, ev, chemistry, derate.vdcSafetyPct);
        if (!optT.feasible) continue;
        const f = calcRequiredBlocks({
          battery, loadKw: loadKwEff, dcVoltage: optT.N * bv,
          endV: ev, invEff, chemistry,
          capacityAh: battery ? battery.capacityAh : capacityAh,
          blocksPerString: optT.N,
          targetMin: targetMinAuto,
        });
        if (!f) continue;
        trials.push({ endV: ev, blockV: bv, opt: optT, found: f, totalBlocks: f.totalBlocks });
      }
    }
    if (!trials.length) {
      html += `<div class="result-block error">Авто-подбор не нашёл подходящей конфигурации. Проверьте V<sub>DC</sub> окно ИБП и нагрузку.</div>`;
    } else {
      // Сортировка: max endV → min totalBlocks → min blockV
      trials.sort((a, b) => (b.endV - a.endV) || (a.totalBlocks - b.totalBlocks) || (a.blockV - b.blockV));
      const best = trials[0];
      blocksPerString = best.opt.N;
      const dcVoltageFinal = best.opt.N * best.blockV;
      const dcEl2 = get('calc-dcv'); if (dcEl2) dcEl2.value = dcVoltageFinal;
      const endvEl = get('calc-endv'); if (endvEl) endvEl.value = best.endV;
      const bvEl = get('calc-blockv'); if (bvEl) bvEl.value = best.blockV;
      params.endV = best.endV;
      params.dcVoltage = dcVoltageFinal;
      params.targetMin = targetMinAuto;
      calcResult = { kind: 'required', found: best.found, blocksPerString, derate, loadKwEff, autoEndV: best.endV, autoBlockV: best.blockV, autoTrials: trials };
      html += `<div class="result-block">`;
      html += `<div class="result-title">🤖 Авто-оптимум: blockV=<b style="color:#2e7d32">${best.blockV} В</b>, endV=<b style="color:#2e7d32">${best.endV} В/эл</b>, ${best.found.totalBlocks} блоков</div>`;
      html += `<div class="result-value">${best.found.totalBlocks}</div>`;
      html += `<div class="result-sub">Цепочек: <b>${best.found.strings}</b> × блоков в цепочке: <b>${best.found.blocksPerString}</b> · V<sub>DC</sub>=${dcVoltageFinal} В</div>`;
      html += `<div class="result-sub">Реальная автономия: <b>${fmt(best.found.result.autonomyMin)} мин</b> (цель ${targetMinAuto} мин). На блок: <b>${fmt(best.found.result.blockPowerW)} W</b>.</div>`;
      html += `<div class="result-sub" style="background:#e8f5e9;padding:6px 8px;border-radius:4px;font-size:11px;margin-top:4px;color:#1b5e20">Приоритет выбора: <b>max endV</b> (бережнее к АКБ → больше ресурс) → <b>min блоков</b> (дешевле/компактнее) → <b>min blockV</b> (стандартные 2В мощнее на блок, но 12В удобнее в монтаже).</div>`;
      if (derate.kTotal > 1.001) {
        html += `<div class="result-sub" style="background:#f0f7ff;padding:4px 6px;border-radius:3px;font-size:11px">`
          + `Учтены коэффициенты: k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> = <b>${derate.kTotal.toFixed(3)}</b> → расчётная нагрузка <b>${fmt(loadKwEff)} kW</b> (паспортная ${fmt(loadKw)} kW).`
          + `</div>`;
      }
      // Таблица всех вариантов: показываем top-12 чтобы не перегружать UI.
      const showTrials = trials.slice(0, Math.min(12, trials.length));
      html += `<details style="margin-top:8px"><summary class="muted" style="font-size:11px;cursor:pointer">📋 Топ ${showTrials.length} вариантов автоподбора из ${trials.length}</summary>`;
      html += `<table style="font-size:11px;margin-top:4px;border-collapse:collapse;width:auto"><thead><tr style="background:#f0f4f8"><th style="padding:3px 10px">blockV</th><th style="padding:3px 10px;text-align:left">endV, В/эл</th><th style="padding:3px 10px">N в цепочке</th><th style="padding:3px 10px">Цепочек</th><th style="padding:3px 10px">Всего</th><th style="padding:3px 10px">V<sub>DC</sub>, В</th><th style="padding:3px 10px">Автономия, мин</th></tr></thead><tbody>`;
      for (const t of showTrials) {
        const isBest = t === best;
        html += `<tr style="${isBest?'background:#e8f5e9;font-weight:600':''}"><td style="padding:2px 10px;text-align:center">${t.blockV}${isBest?' ★':''}</td><td style="padding:2px 10px">${t.endV}</td><td style="padding:2px 10px;text-align:center">${t.opt.N}</td><td style="padding:2px 10px;text-align:center">${t.found.strings}</td><td style="padding:2px 10px;text-align:center">${t.totalBlocks}</td><td style="padding:2px 10px;text-align:center">${t.opt.N * t.blockV}</td><td style="padding:2px 10px;text-align:center">${fmt(t.found.result.autonomyMin)}</td></tr>`;
      }
      html += `</tbody></table></details>`;
      html += `</div>`;
    }
  } else {
    // Обратная задача: дано — нагрузка + целевое время → сколько блоков
    const found = calcRequiredBlocks({
      battery, loadKw: loadKwEff, dcVoltage, endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
      blocksPerString,
      targetMin,
    });
    calcResult = { kind: 'required', found, blocksPerString, derate, loadKwEff };
    if (found) {
      html += `<div class="result-block">`;
      html += `<div class="result-title">Минимум блоков для автономии ≥ ${targetMin} мин</div>`;
      html += `<div class="result-value">${found.totalBlocks}</div>`;
      html += `<div class="result-sub">Цепочек (авто): <b>${found.strings}</b> × блоков в цепочке: <b>${found.blocksPerString}</b> · V<sub>DC</sub>=${found.blocksPerString * blockV} В ${vRange.known ? `(в диапазоне ${vRange.min}…${vRange.max} В)` : ''}</div>`;
      if (dcWarn) html += `<div class="warn">⚠ ${escHtml(dcWarn)}</div>`;
      html += `<div class="result-sub">Реальная автономия: <b>${fmt(found.result.autonomyMin)} мин</b>, метод: <b>${found.result.method === 'table' ? 'по таблице' : 'среднее'}</b></div>`;
      if (derate.kTotal > 1.001 || derate.vdcSafetyPct > 0 || derate.socMinPct > 0) {
        html += `<div class="result-sub" style="background:#f0f7ff;padding:4px 6px;border-radius:3px;font-size:11px">`
          + `Учтены коэффициенты: k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> = ${derate.kAge.toFixed(2)}×${derate.kTemp.toFixed(2)}×${derate.kDesign.toFixed(2)} = <b>${derate.kTotal.toFixed(3)}</b>`
          + ` → расчётная нагрузка <b>${fmt(loadKwEff)} kW</b> (паспортная ${fmt(loadKw)} kW).`
          + (derate.vdcSafetyPct > 0 ? ` Окно V<sub>DC</sub> ±${derate.vdcSafetyPct}%.` : '')
          + (chemistry === 'li-ion' && derate.socMinPct > 0 ? ` Резерв SoC ${derate.socMinPct}%.` : '')
          + `</div>`;
      }
      if (found.result.extrapolated) html += `<div class="warn" style="background:#fff3e0;border:1px solid #ffb74d;padding:6px 8px;border-radius:4px;margin-top:6px"><b>⚠ Условный расчёт.</b> Запрошенное время разряда вне таблицы производителя — значение получено линейной экстраполяцией двух ближайших точек. Не подтверждено производителем.</div>`;
      html += `</div>`;
    } else {
      html += `<div class="result-block error">Не удалось подобрать конфигурацию в пределах 2000 блоков. Проверьте нагрузку / параметры.</div>`;
    }
  }
  // Контейнер для графика разряда с отметкой рассчитанной точки
  html += `<div class="result-block" style="margin-top:14px"><div class="result-title" style="margin-bottom:8px">График разряда АКБ</div><div id="calc-chart-mount" style="background:#fafbfc;border:1px solid #e0e3ea;border-radius:6px;padding:12px"></div><div class="muted" style="font-size:11px;margin-top:6px">Красный маркер — рассчитанная рабочая точка (мощность на блок и время разряда). Оранжевый — экстраполированная (за пределами таблицы производителя).</div></div>`;
  // v0.59.414: дополнительный зум-график с детализацией в зоне рабочей точки.
  html += `<div class="result-block" style="margin-top:14px"><div class="result-title" style="margin-bottom:8px">Детализация в рабочей зоне (zoom)</div><div id="calc-chart-zoom-mount" style="background:#fafbfc;border:1px solid #e0e3ea;border-radius:6px;padding:12px"></div><div class="muted" style="font-size:11px;margin-top:6px">Окно ±70% от рабочей точки по обеим осям. Линейные шкалы для удобной оценки запаса.</div></div>`;
  out.innerHTML = html;
  _renderCalcDischargeChart(params, calcResult, blocksPerString, blockV);
  _renderCalcDischargeChartZoom(params, calcResult, blocksPerString, blockV);

  // Сохраняем состояние для экспорта отчёта и разблокируем кнопку
  lastBatteryCalc = { params, calcResult, vRange, opt, dcVoltageRaw, blockV, dcWarn };
  const btnRpt = document.getElementById('btn-battery-report');
  if (btnRpt) btnRpt.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
  const btnPrn = document.getElementById('btn-battery-print');
  if (btnPrn) btnPrn.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
  const btnSav = document.getElementById('btn-battery-save-config');
  if (btnSav) btnSav.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
}

// Рендер графика разряда после расчёта: если у выбранной АКБ есть таблица —
// рисуем её кривые; иначе синтезируем кривую через avgEfficiency. В обоих
// случаях добавляем маркер рассчитанной рабочей точки (tMin = автономия,
// powerW = blockPowerW), чтобы пользователь видел, где он на графике.
function _renderCalcDischargeChart(params, calcResult, blocksPerString, blockV) {
  const mount = document.getElementById('calc-chart-mount');
  if (!mount) return;
  const { battery, endV, chemistry, capacityAh } = params;
  let autonomyMin = null, blockPowerW = null, extrapolated = false;
  if (calcResult && calcResult.kind === 'autonomy' && calcResult.r) {
    autonomyMin = calcResult.r.autonomyMin;
    blockPowerW = calcResult.r.blockPowerW;
    extrapolated = !!calcResult.r.extrapolated;
  } else if (calcResult && calcResult.kind === 'required' && calcResult.found) {
    autonomyMin = calcResult.found.result?.autonomyMin;
    blockPowerW = calcResult.found.result?.blockPowerW;
    extrapolated = !!calcResult.found.result?.extrapolated;
  }
  // v0.59.457: универсальный snap-to-curve. Сначала строим rows (либо из
  // таблицы, либо синтетически), затем интерполируем t из P ИМЕННО по
  // этим rows — гарантия что точка лежит на видимой кривой независимо
  // от источника данных.
  let rows, endVsForChart, bestEv;
  if (battery && Array.isArray(battery.dischargeTable) && battery.dischargeTable.length) {
    const all = battery.dischargeTable;
    const allEvs = [...new Set(all.map(p => p.endV))].sort((a, b) => a - b);
    bestEv = allEvs[0];
    let bestDiff = Math.abs(allEvs[0] - (endV || 1.75));
    for (const ev of allEvs) {
      const d = Math.abs(ev - (endV || 1.75));
      if (d < bestDiff) { bestDiff = d; bestEv = ev; }
    }
    rows = all.filter(p => p.endV === bestEv);
    endVsForChart = [bestEv];
  } else {
    const chem = (battery && battery.chemistry) || chemistry || 'vrla';
    const cap = (battery && battery.capacityAh) || capacityAh || 100;
    const blkV = (battery && battery.blockVoltage) || blockV || 12;
    const tPoints = [1, 3, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600];
    rows = tPoints.map(t => {
      const eff = _avgEffShim(chem, t);
      const usableWh = blkV * cap * eff;
      const powerW = usableWh / (t / 60);
      return { endV: endV || 1.75, tMin: t, powerW };
    });
    bestEv = endV || 1.75;
    endVsForChart = [bestEv];
  }
  const highlight = _snapHighlightToCurve(rows, bestEv, blockPowerW, autonomyMin, extrapolated);
  _renderDischargeChart(mount, rows, endVsForChart, highlight);
}

// v0.59.457: единая функция snap-to-curve. Берёт строки кривой и мощность
// на блок, возвращает highlight {tMin, powerW, label} где tMin — точка
// на кривой, соответствующая powerW. Кривая интерпретируется ровно так
// же как в _renderDischargeChart: линейная по (t, P), монотонно убывающая.
function _snapHighlightToCurve(rows, ev, blockPowerW, fallbackTMin, extrapolatedFlag) {
  if (!Number.isFinite(blockPowerW) || blockPowerW <= 0) return null;
  const curve = rows.filter(r => r.endV === ev && r.powerW > 0 && r.tMin > 0).sort((a, b) => a.tMin - b.tMin);
  if (!curve.length) return null;
  // Кривая: при росте t — P убывает. Ищем t такое, что P(t) = blockPowerW.
  let snappedT = null;
  let outOfTable = '';
  // v0.59.461/462: snap использует ТОТ ЖЕ метод что и отрисовка кривой —
  // линейно в log P (ось Y чарта log; кривая рисуется отрезками между
  // экранными координатами точек таблицы).
  const lp = Math.log(blockPowerW);
  if (blockPowerW > curve[0].powerW) {
    if (curve.length >= 2) {
      const a = curve[0], b = curve[1];
      const lpA = Math.log(a.powerW), lpB = Math.log(b.powerW);
      if (lpA !== lpB) {
        const k = (lp - lpA) / (lpB - lpA);
        snappedT = Math.max(0, a.tMin + (b.tMin - a.tMin) * k);
        outOfTable = ' (экстраполяция)';
      }
    }
  } else if (blockPowerW < curve[curve.length - 1].powerW) {
    snappedT = curve[curve.length - 1].tMin;
    outOfTable = ' (P ниже таблицы → автономия ≥ макс. табличной)';
  } else {
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      if (blockPowerW <= a.powerW && blockPowerW >= b.powerW) {
        const lpA = Math.log(a.powerW), lpB = Math.log(b.powerW);
        if (lpA === lpB) { snappedT = a.tMin; break; }
        const k = (lp - lpA) / (lpB - lpA);
        snappedT = a.tMin + (b.tMin - a.tMin) * k;
        break;
      }
    }
  }
  if (!Number.isFinite(snappedT) || snappedT <= 0) {
    if (Number.isFinite(fallbackTMin) && fallbackTMin > 0) snappedT = fallbackTMin;
    else return null;
  }
  return {
    tMin: snappedT,
    powerW: blockPowerW,
    extrapolated: !!extrapolatedFlag || outOfTable.includes('экстрап'),
    label: `${fmt(snappedT)} мин · ${fmt(blockPowerW)} W/блок${extrapolatedFlag ? ' (условно)' : ''}${outOfTable}`,
  };
}
// v0.59.414: zoomed chart — окно вокруг рабочей точки, линейные шкалы.
// Filtering rows: tMin ∈ [highlight.tMin × 0.3 … × 3], powerW аналогично.
// Если точек < 3, расширяем окно до × 5.
function _renderCalcDischargeChartZoom(params, calcResult, blocksPerString, blockV) {
  const mount = document.getElementById('calc-chart-zoom-mount');
  if (!mount) return;
  const { battery, endV, chemistry, capacityAh } = params;
  let autonomyMin = null, blockPowerW = null, extrapolated = false;
  if (calcResult && calcResult.kind === 'autonomy' && calcResult.r) {
    autonomyMin = calcResult.r.autonomyMin;
    blockPowerW = calcResult.r.blockPowerW;
    extrapolated = !!calcResult.r.extrapolated;
  } else if (calcResult && calcResult.kind === 'required' && calcResult.found) {
    autonomyMin = calcResult.found.result?.autonomyMin;
    blockPowerW = calcResult.found.result?.blockPowerW;
    extrapolated = !!calcResult.found.result?.extrapolated;
  }
  if (!Number.isFinite(blockPowerW) || blockPowerW <= 0) {
    mount.innerHTML = '<div class="muted" style="font-size:12px;text-align:center;padding:20px">Нет рабочей точки для детализации</div>';
    return;
  }
  // v0.59.457: snap-to-curve по rows, что будут реально нарисованы.
  let allRows, endVs, bestEv;
  if (battery && Array.isArray(battery.dischargeTable) && battery.dischargeTable.length) {
    const all = battery.dischargeTable;
    const allEvs = [...new Set(all.map(p => p.endV))].sort((a, b) => a - b);
    bestEv = allEvs[0];
    let bestDiff = Math.abs(allEvs[0] - (endV || 1.75));
    for (const ev of allEvs) {
      const d = Math.abs(ev - (endV || 1.75));
      if (d < bestDiff) { bestDiff = d; bestEv = ev; }
    }
    allRows = all.filter(p => p.endV === bestEv);
    endVs = [bestEv];
  } else {
    const chem = (battery && battery.chemistry) || chemistry || 'vrla';
    const cap = (battery && battery.capacityAh) || capacityAh || 100;
    const blkV = (battery && battery.blockVoltage) || blockV || 12;
    const tPoints = [1, 3, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600];
    allRows = tPoints.map(t => {
      const eff = _avgEffShim(chem, t);
      const usableWh = blkV * cap * eff;
      const powerW = usableWh / (t / 60);
      return { endV: endV || 1.75, tMin: t, powerW };
    });
    bestEv = endV || 1.75;
    endVs = [bestEv];
  }
  const highlight = _snapHighlightToCurve(allRows, bestEv, blockPowerW, autonomyMin, extrapolated);
  if (!highlight) {
    mount.innerHTML = '<div class="muted" style="font-size:12px;text-align:center;padding:20px">Нет рабочей точки для детализации</div>';
    return;
  }
  // Окно
  const filterWindow = (factor) => {
    const tLo = highlight.tMin / factor, tHi = highlight.tMin * factor;
    const pLo = highlight.powerW / factor, pHi = highlight.powerW * factor;
    return allRows.filter(r => r.tMin >= tLo && r.tMin <= tHi && r.powerW >= pLo && r.powerW <= pHi);
  };
  let rows = filterWindow(2.0);
  if (rows.length < 3) rows = filterWindow(3.5);
  if (rows.length < 2) rows = allRows.slice();
  _renderDischargeChartLinear(mount, rows, endVs, highlight);
}

// Линейный вариант графика (X = время мин, Y = мощность W) — для зум-окна.
// Без log-шкалы, чтобы запас по обеим осям визуализировался пропорционально.
function _renderDischargeChartLinear(mount, rows, endVs, highlight = null) {
  if (!mount) return;
  const palette = ['#1565c0', '#2e7d32', '#f57f17', '#c62828', '#6a1b9a', '#00695c'];
  const W = 860, H = 320;
  const padL = 70, padR = 20, padT = 20, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const allT = rows.map(p => p.tMin).filter(v => v > 0);
  const allP = rows.map(p => p.powerW).filter(v => v > 0);
  if (!allT.length || !allP.length) {
    mount.innerHTML = '<div class="muted" style="font-size:12px;text-align:center;padding:20px">Нет данных для зум-графика</div>';
    return;
  }
  let tMin = Math.min(...allT), tMax = Math.max(...allT);
  let pMin = Math.min(...allP), pMax = Math.max(...allP);
  if (highlight) {
    tMin = Math.min(tMin, highlight.tMin * 0.85);
    tMax = Math.max(tMax, highlight.tMin * 1.15);
    pMin = Math.min(pMin, highlight.powerW * 0.85);
    pMax = Math.max(pMax, highlight.powerW * 1.15);
  }
  // Запас 5% по краям
  const tPad = (tMax - tMin) * 0.05 || 1;
  const pPad = (pMax - pMin) * 0.05 || 1;
  tMin -= tPad; tMax += tPad; pMin -= pPad; pMax += pPad;
  if (pMin < 0) pMin = 0;
  if (tMin < 0) tMin = 0;
  const xOf = t => padL + ((t - tMin) / Math.max(0.001, tMax - tMin)) * plotW;
  const yOf = p => padT + plotH - ((p - pMin) / Math.max(0.001, pMax - pMin)) * plotH;
  // Тики
  const niceTicks = (lo, hi, n = 5) => {
    const span = hi - lo, step0 = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let v = start; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  };
  const xTicks = niceTicks(tMin, tMax, 6);
  const yTicks = niceTicks(pMin, pMax, 5);
  const parts = [`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;font-family:-apple-system,sans-serif;font-size:11px">`];
  parts.push(`<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#e0e3ea" stroke-width="1"/>`);
  for (const t of xTicks) {
    const x = xOf(t);
    parts.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#f0f0f0" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${padT + plotH + 16}" text-anchor="middle" fill="#6b7280">${t % 1 === 0 ? t : t.toFixed(1)}</text>`);
  }
  for (const p of yTicks) {
    const y = yOf(p);
    parts.push(`<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#6b7280">${p >= 1000 ? (p / 1000).toFixed(1) + 'k' : Math.round(p)}</text>`);
  }
  parts.push(`<text x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#1f2430" font-weight="600">Время разряда, мин</text>`);
  parts.push(`<text transform="rotate(-90 16 ${padT + plotH / 2})" x="16" y="${padT + plotH / 2}" text-anchor="middle" fill="#1f2430" font-weight="600">Мощность на блок, W</text>`);
  endVs.forEach((ev, idx) => {
    const color = palette[idx % palette.length];
    const curve = rows.filter(r => r.endV === ev).filter(r => r.powerW > 0 && r.tMin > 0).sort((a, b) => a.tMin - b.tMin);
    if (!curve.length) return;
    const ptsScreen = curve.map(p => ({ x: xOf(p.tMin), y: yOf(p.powerW) }));
    const d = _smoothPathMonotone(ptsScreen);
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of curve) {
      parts.push(`<circle cx="${xOf(p.tMin).toFixed(1)}" cy="${yOf(p.powerW).toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${ev} В · ${p.tMin} мин · ${p.powerW} W</title></circle>`);
    }
  });
  if (highlight && Number.isFinite(highlight.tMin) && Number.isFinite(highlight.powerW)) {
    const cx = xOf(highlight.tMin), cy = yOf(highlight.powerW);
    const stroke = highlight.extrapolated ? '#ff9800' : '#d32f2f';
    parts.push(`<line x1="${padL}" y1="${cy.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.7"/>`);
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${padT}" x2="${cx.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.7"/>`);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" fill="${stroke}" stroke="#fff" stroke-width="2.5"/>`);
    const lbl = highlight.label || `${fmt(highlight.tMin)} мин · ${fmt(highlight.powerW)} W/блок`;
    const tx = cx + 12, ty = Math.max(padT + 14, cy - 10);
    parts.push(`<rect x="${tx - 3}" y="${ty - 11}" width="${(lbl.length * 6.5 + 8).toFixed(0)}" height="17" fill="#fff" stroke="${stroke}" rx="3"/>`);
    parts.push(`<text x="${tx + 2}" y="${ty + 2}" fill="${stroke}" font-weight="700">${escHtml(lbl)}</text>`);
  }
  parts.push('</svg>');
  mount.innerHTML = parts.join('');
}

// Локальная копия avgEfficiency, чтобы не тащить лишний импорт
function _avgEffShim(chemistry, tMin) {
  if (chemistry === 'li-ion') {
    if (tMin < 5) return 0.88;
    if (tMin < 15) return 0.92;
    if (tMin < 60) return 0.95;
    return 0.96;
  }
  if (tMin < 5)   return 0.45;
  if (tMin < 15)  return 0.58;
  if (tMin < 30)  return 0.68;
  if (tMin < 60)  return 0.78;
  if (tMin < 180) return 0.85;
  return 0.90;
}

// ================ UPS picker (standalone-режим battery) ================
function _sortUpses(list) {
  return list.slice().sort((a, b) => {
    const sa = (a.supplier || '').toLowerCase();
    const sb = (b.supplier || '').toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb, 'ru');
    const ka = Number(a.capacityKw) || 0;
    const kb = Number(b.capacityKw) || 0;
    if (ka !== kb) return ka - kb;
    return String(a.model || '').localeCompare(String(b.model || ''), 'ru');
  });
}
function _upsFilters() {
  const v = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  return {
    text: v('calc-ups-flt-text').toLowerCase(),
    supp: v('calc-ups-flt-supp'),
    type: v('calc-ups-flt-type'),
    kwMin: Number(v('calc-ups-flt-kw')) || 0,
  };
}
function _filterUpses(list, f) {
  return list.filter(u => {
    if (f.text) {
      const s = ((u.supplier||'')+' '+(u.model||'')).toLowerCase();
      if (!s.includes(f.text)) return false;
    }
    if (f.supp && u.supplier !== f.supp) return false;
    if (f.type) {
      // v0.59.447: фильтр типа — по детектору плагин-реестра, а не по
      // upsType вручную. Поддерживает 'monoblock' / 'modular' /
      // 'integrated' / 'all-in-one'.
      const t = detectUpsType(u);
      if (!t || t.id !== f.type) return false;
    }
    if (f.kwMin && !(Number(u.capacityKw) >= f.kwMin)) return false;
    return true;
  });
}
// Только полнокомплектные ИБП. Из каталога исключаются:
//   - kind:'frame'           (пустой корпус MR33 — не работает без модулей)
//   - kind:'power-module'    (силовой модуль — не работает без фрейма)
//   - kind:'batt-cabinet-*'  (батарейные шкафы — не ИБП)
// v0.59.447: kind 'ups' (стандартный моноблок/модульный сторонних
// производителей), 'ups-integrated' (Kehua с встроенными PDM),
// 'ups-all-in-one' (Kehua S³C со встроенной АКБ) — все показываются.
function _isStandaloneUps(u) {
  if (!u) return false;
  const k = u.kind;
  if (!k) return true; // legacy: запись без kind считается полноценным ИБП
  return (k === 'ups' || k === 'ups-integrated' || k === 'ups-all-in-one');
}
function renderUpsPicker() {
  const sel = document.getElementById('calc-ups-pick');
  if (!sel) return;
  const all = listUpses().filter(_isStandaloneUps);
  // v0.59.466: КРОСС-ФИЛЬТРАЦИЯ. Опции в каждом select показывают только
  // те значения, которые присутствуют в записях, удовлетворяющих ВСЕМ
  // ОСТАЛЬНЫМ фильтрам. Так нельзя выбрать пустую комбинацию (Legrand +
  // All-in-One), и при выборе типа исчезают поставщики у которых его нет.
  const f = _upsFilters();
  const filteredExceptSupp = _filterUpses(all, { ...f, supp: '' });
  const filteredExceptType = _filterUpses(all, { ...f, type: '' });
  const sSupp = document.getElementById('calc-ups-flt-supp');
  if (sSupp) {
    const cur = sSupp.value;
    const supps = [...new Set(filteredExceptSupp.map(u => u.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    let h = '<option value="">Все поставщики</option>';
    for (const s of supps) h += `<option value="${escHtml(s)}">${escHtml(s)}</option>`;
    sSupp.innerHTML = h;
    // Сохраняем выбор, если он всё ещё валиден; иначе сбрасываем.
    if (cur && supps.includes(cur)) sSupp.value = cur;
    else sSupp.value = '';
  }
  const sType = document.getElementById('calc-ups-flt-type');
  if (sType) {
    const cur = sType.value;
    // Доступные типы — те, что встречаются среди ups, прошедших остальные
    // фильтры (включая supplier).
    const availTypeIds = new Set(filteredExceptType.map(u => detectUpsType(u)?.id).filter(Boolean));
    let h = '<option value="">Любой тип</option>';
    for (const t of listUpsTypes()) {
      if (!availTypeIds.has(t.id)) continue;
      h += `<option value="${escHtml(t.id)}">${escHtml(t.label || t.id)}</option>`;
    }
    sType.innerHTML = h;
    if (cur && availTypeIds.has(cur)) sType.value = cur;
    else sType.value = '';
  }
  // После пересчёта select'ов перечитываем фильтры (значения могли сброситься).
  const fApplied = _upsFilters();
  const list = _sortUpses(_filterUpses(all, fApplied));
  const cur = sel.value;
  let h = '<option value="">— не выбран (заполните вручную параметры расчёта) —</option>';
  for (const u of list) {
    const vdc = (u.vdcMin && u.vdcMax) ? `, V_DC ${u.vdcMin}…${u.vdcMax}` : '';
    const t = detectUpsType(u);
    const typeLbl = t ? (t.shortLabel || t.label || t.id) : (u.upsType==='modular'?'модульный':'моноблок');
    h += `<option value="${escHtml(u.id)}">${escHtml(u.supplier)} · ${escHtml(u.model)} (${u.capacityKw} кВт, ${escHtml(typeLbl)}${vdc})</option>`;
  }
  sel.innerHTML = h;
  if (cur && list.some(u => u.id === cur)) sel.value = cur;
  const info = document.getElementById('calc-ups-info');
  if (info) info.textContent = `Подходит ${list.length} из ${all.length} ИБП в каталоге`;
}
function _applyUpsPickerLock() {
  const sel = document.getElementById('calc-ups-pick');
  const id = sel ? sel.value : '';
  const u = id ? getUps(id) : null;
  const lock = (fid, val, hard) => {
    const el = document.getElementById(fid);
    if (!el) return;
    if (u && val != null && Number.isFinite(Number(val))) {
      el.value = val;
      el.readOnly = hard;
      if (hard) { el.style.background = '#f0f0f0'; el.title = 'Заблокировано — берётся из выбранного ИБП'; }
    } else {
      el.readOnly = false;
      el.style.background = '';
      el.title = '';
    }
  };
  const info = document.getElementById('calc-ups-info');
  if (u) {
    // Из паспорта ИБП: КПД и V_DC берём жёстко, нагрузка остаётся за
    // пользователем (ИБП на 1000 кВт может питать и 100 кВт нагрузку).
    const loadEl = document.getElementById('calc-load');
    if (loadEl) {
      loadEl.readOnly = false;
      loadEl.style.background = '';
      loadEl.title = `Номинал ИБП ${u.capacityKw} кВт — введите фактическую нагрузку`;
      loadEl.placeholder = `до ${u.capacityKw} кВт`;
      loadEl.max = u.capacityKw;
    }
    lock('calc-inveff', Math.round((u.efficiency || 0.94) * 100 < 1 ? (u.efficiency || 94) : (u.efficiency || 94)), true);
    if (u.vdcMin && u.vdcMax) {
      // v0.59.412: показываем не середину, а экономически оптимальное N×blockV
      // (минимум блоков с учётом end/float). Полная формула — в hint под полем.
      const blockV = Number(document.getElementById('calc-blockv')?.value) || 12;
      const endV   = Number(document.getElementById('calc-endv')?.value)   || 1.75;
      const chem   = document.getElementById('calc-chem')?.value || 'vrla';
      const o = _pickOptimalBlocks(u.vdcMin, u.vdcMax, blockV, endV, chem, _readDerating().vdcSafetyPct);
      const optV = o.N * blockV;
      const dc = document.getElementById('calc-dcv');
      if (dc) { dc.value = optV; dc.title = `Подобрано экономически оптимально: N=${o.N} блоков (минимум) → V_DC=${optV} В. Диапазон ИБП ${u.vdcMin}…${u.vdcMax} В.`; }
      // Заполняем основные поля V_DC мин/макс и блокируем (источник — паспорт ИБП).
      const vmin = document.getElementById('calc-vdcmin');
      const vmax = document.getElementById('calc-vdcmax');
      if (vmin) { vmin.value = u.vdcMin; vmin.readOnly = true; vmin.style.background = '#f0f0f0'; vmin.title = `Из паспорта ${u.supplier || ''} ${u.model || ''}`; }
      if (vmax) { vmax.value = u.vdcMax; vmax.readOnly = true; vmax.style.background = '#f0f0f0'; vmax.title = `Из паспорта ${u.supplier || ''} ${u.model || ''}`; }
    }
    _setDcvRangeHint(u.vdcMin, u.vdcMax, `по паспорту ${u.supplier || ''} ${u.model || ''}`.trim());
    _refreshDcExplanation();
    if (info) {
      const verified = isUpsVdcVerified(u);
      const vdcBadge = verified
        ? '<span title="V_DC подтверждено datasheet" style="color:#2e7d32">✓</span>'
        : '<span title="V_DC — оценка по аналогии или по ном. напряжению. Сверьте с реальным datasheet ИБП перед использованием." style="color:#e65100">⚠</span>';
      info.innerHTML = `Выбран: <b>${escHtml(u.supplier)} ${escHtml(u.model)}</b> · ${u.capacityKw} кВт · η=${(((u.efficiency||0.94)*100<1?(u.efficiency*100):u.efficiency)||94).toFixed(0)}% · V<sub>DC</sub> ${u.vdcMin||'?'}…${u.vdcMax||'?'} В ${vdcBadge}`
        + (verified ? '' : `<div style="margin-top:4px;padding:6px 8px;background:#fff3e0;border:1px solid #ffb74d;border-radius:4px;font-size:11px;color:#7a4a00">⚠ Окно V<sub>DC</sub> для этой модели — <b>оценка по аналогии</b>, не подтверждено datasheet. Перед production-расчётом сверьте с паспортом ИБП. Verified-модели: Eaton 93PM 50/100/200, 93PS 40; Schneider Galaxy VS 60; вся линейка Kehua.</div>`);
    }
  } else {
    const loadEl = document.getElementById('calc-load');
    if (loadEl) { loadEl.readOnly = false; loadEl.style.background = ''; loadEl.title = ''; loadEl.placeholder = ''; loadEl.removeAttribute('max'); }
    lock('calc-inveff', null);
    const dc = document.getElementById('calc-dcv');
    if (dc) { dc.style.background = '#f0f0f0'; dc.title = ''; dc.removeAttribute('max'); }
    // Разлок V_DC мин/макс — позволяем пользователю редактировать
    const vmin = document.getElementById('calc-vdcmin');
    const vmax = document.getElementById('calc-vdcmax');
    if (vmin) { vmin.readOnly = false; vmin.style.background = ''; vmin.title = ''; }
    if (vmax) { vmax.readOnly = false; vmax.style.background = ''; vmax.title = ''; }
    _setDcvRangeHint(null, null, '');
    _refreshDcExplanation();
  }
  _renderCapacityRecommend();
}
function _setDcvRangeHint(vmin, vmax, source) {
  const range = document.getElementById('calc-dcv-range');
  const hint = document.getElementById('calc-dcv-hint');
  if (range) range.textContent = (vmin && vmax) ? `· допустимо ${vmin}…${vmax} В` : '';
  if (hint) hint.innerHTML = (vmin && vmax)
    ? `Диапазон V<sub>DC</sub> мин/макс: <b>${vmin}…${vmax} В</b>${source ? ` <span class="muted">(${escHtml(source)})</span>` : ''}. Число блоков в цепочке подберётся автоматически — фактическое V<sub>DC</sub> = N · V<sub>блока</sub> должно попасть в этот диапазон.`
    : '';
}
function _wireUpsPicker() {
  // v0.59.409: убран radio-toggle catalog/manual. Логика проще:
  //   модель выбрана  → V_DC мин/макс + КПД блокируются паспортом;
  //   модель не выбрана → пользователь редактирует поля формы вручную.
  ['calc-ups-flt-text','calc-ups-flt-supp','calc-ups-flt-type','calc-ups-flt-kw'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => renderUpsPicker());
  });
  const sel = document.getElementById('calc-ups-pick');
  if (sel) sel.addEventListener('change', () => { _applyUpsPickerLock(); renderBatterySelector(); });
  // v0.59.449: чекбокс «совместимость с ИБП» → перерендер списка АКБ.
  const compatChk = document.getElementById('calc-filter-ups-compat');
  if (compatChk) compatChk.addEventListener('change', () => renderBatterySelector());
  // В handoff-режиме (?fromUps=1) скрываем блок — ИБП уже определён
  try {
    const qp = new URLSearchParams(location.search);
    if (qp.get('fromUps') === '1' || qp.get('fromCtx') === '1') {
      const block = document.getElementById('calc-ups-source-block');
      if (block) block.style.display = 'none';
    }
  } catch {}
}

function wireCalcForm() {
  const form = document.getElementById('calc-form');
  if (!form) return;
  form.addEventListener('submit', e => { e.preventDefault(); doCalc(); });
  // Пересчёт при смене режима
  const modeSel = document.getElementById('calc-mode');
  modeSel.addEventListener('change', () => {
    document.querySelectorAll('[data-mode-only]').forEach(el => {
      const wanted = el.dataset.modeOnly;
      el.style.display = (wanted === modeSel.value) ? '' : 'none';
    });
    _renderCapacityRecommend();
  });
  modeSel.dispatchEvent(new Event('change'));
  // v0.59.469/474: температура → k_temp + display update (с учётом химии).
  const tempEl = document.getElementById('calc-temp-c');
  const updateKTemp = () => {
    const tC = Number(tempEl?.value);
    const battSel = document.getElementById('calc-battery');
    const battery = battSel?.value ? getBattery(battSel.value) : null;
    const chemEl = document.getElementById('calc-chem');
    const chemistry = (battery && battery.chemistry) || (chemEl?.value || 'vrla');
    const k = _kTempFromCelsius(tC, chemistry);
    const hidden = document.getElementById('calc-k-temp');
    if (hidden) hidden.value = k.toFixed(2);
    const disp = document.getElementById('calc-k-temp-display');
    if (disp) disp.textContent = k.toFixed(2);
    _refreshDerateSummary();
  };
  if (tempEl) {
    tempEl.addEventListener('input', updateKTemp);
    updateKTemp();
  }
  // Также обновляем при смене химии или АКБ.
  ['calc-chem', 'calc-battery'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => updateKTemp());
  });
  // v0.59.475: live-связь поля «Блоков в цепочке (N)» с V_DC окном ИБП.
  // Под полем — подсказка с допустимым диапазоном, у поля красная рамка
  // при выходе из диапазона. Обновляется при изменении любого из:
  // vdcMin/vdcMax/blockV/endV/chem/battery/vdc-safety.
  const updateBlocksHint = () => {
    const blocksEl = document.getElementById('calc-blocks');
    const hintEl = document.getElementById('calc-blocks-hint');
    if (!blocksEl || !hintEl) return;
    const vMin = Number(document.getElementById('calc-vdcmin')?.value);
    const vMax = Number(document.getElementById('calc-vdcmax')?.value);
    const battSel = document.getElementById('calc-battery');
    const battery = battSel?.value ? getBattery(battSel.value) : null;
    const blockV = battery ? battery.blockVoltage : (Number(document.getElementById('calc-blockv')?.value) || 12);
    const endV = Number(document.getElementById('calc-endv')?.value) || 1.85;
    const chemEl = document.getElementById('calc-chem');
    const chemistry = (battery && battery.chemistry) || (chemEl?.value || 'vrla');
    const safety = Number(document.getElementById('calc-vdc-safety')?.value) || 0;
    if (!(vMin > 0 && vMax > 0 && blockV > 0)) {
      hintEl.innerHTML = '<span style="color:#888">Допустимый диапазон N появится после задания V_DC мин/макс и blockV.</span>';
      blocksEl.style.borderColor = '';
      return;
    }
    const opt = _pickOptimalBlocks(vMin, vMax, blockV, endV, chemistry, safety);
    const N = Number(blocksEl.value);
    const inRange = opt.feasible && Number.isFinite(N) && N >= opt.nLow && N <= opt.nHigh;
    const dcAtN = N * blockV;
    if (!opt.feasible) {
      hintEl.innerHTML = `<span style="color:#c62828">⚠ V<sub>DC</sub> окно ИБП ${vMin}…${vMax} В не покрывается ни одним N при blockV=${blockV} В, endV=${endV} В/эл, float ${chemistry === 'li-ion' ? 3.45 : 2.25}. Уменьшите endV или возьмите блоки меньшего номинала.</span>`;
      blocksEl.style.borderColor = '#c62828';
      return;
    }
    const baseHint = `Допустимо N = <b>${opt.nLow}…${opt.nHigh}</b> (V<sub>DC</sub> ${opt.nLow * blockV}…${opt.nHigh * blockV} В при разряде/флоате). Текущее N=${N || '?'} → V<sub>DC</sub> ном. <b>${dcAtN || '?'} В</b>.`;
    if (Number.isFinite(N) && N >= 1) {
      if (inRange) {
        hintEl.innerHTML = `<span style="color:#2e7d32">✓ ${baseHint}</span>`;
        blocksEl.style.borderColor = '';
      } else if (N < opt.nLow) {
        hintEl.innerHTML = `<span style="color:#c62828">⚠ N=${N} ниже минимума ${opt.nLow}: при разряде V<sub>DC</sub> упадёт ниже ${vMin} В → ИБП отключится раньше.</span><br>${baseHint}`;
        blocksEl.style.borderColor = '#c62828';
      } else {
        hintEl.innerHTML = `<span style="color:#c62828">⚠ N=${N} выше максимума ${opt.nHigh}: при флоат-заряде V<sub>DC</sub> превысит ${vMax} В → перезаряд / срабатывание защиты ИБП.</span><br>${baseHint}`;
        blocksEl.style.borderColor = '#c62828';
      }
    } else {
      hintEl.innerHTML = baseHint;
      blocksEl.style.borderColor = '';
    }
  };
  ['calc-vdcmin', 'calc-vdcmax', 'calc-blockv', 'calc-endv', 'calc-vdc-safety', 'calc-blocks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateBlocksHint);
  });
  ['calc-chem', 'calc-battery'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => updateBlocksHint());
  });
  updateBlocksHint();
  // v0.59.476: кнопка «↺ авто» — подставить N = N_min (экономически оптимум).
  const blocksAutoBtn = document.getElementById('calc-blocks-auto');
  if (blocksAutoBtn) blocksAutoBtn.addEventListener('click', () => {
    const vMin = Number(document.getElementById('calc-vdcmin')?.value);
    const vMax = Number(document.getElementById('calc-vdcmax')?.value);
    const battSel = document.getElementById('calc-battery');
    const battery = battSel?.value ? getBattery(battSel.value) : null;
    const blockV = battery ? battery.blockVoltage : (Number(document.getElementById('calc-blockv')?.value) || 12);
    const endV = Number(document.getElementById('calc-endv')?.value) || 1.85;
    const chemEl = document.getElementById('calc-chem');
    const chemistry = (battery && battery.chemistry) || (chemEl?.value || 'vrla');
    const safety = Number(document.getElementById('calc-vdc-safety')?.value) || 0;
    if (!(vMin > 0 && vMax > 0 && blockV > 0)) {
      rsToast('Заполните V_DC мин/макс перед авто-подбором', 'warn');
      return;
    }
    const opt = _pickOptimalBlocks(vMin, vMax, blockV, endV, chemistry, safety);
    if (!opt.feasible) {
      rsToast('V_DC окно не покрывается — нет валидного N', 'warn');
      return;
    }
    const blocksEl = document.getElementById('calc-blocks');
    if (blocksEl) {
      blocksEl.value = opt.nLow;
      blocksEl.dispatchEvent(new Event('input'));
      rsToast(`Подобрано N=${opt.nLow} (экономически оптимум, V_DC=${opt.nLow * blockV} В)`, 'ok');
    }
  });
  const btnRpt = document.getElementById('btn-battery-report');
  if (btnRpt) btnRpt.addEventListener('click', exportBatteryReport);
  const btnPrn = document.getElementById('btn-battery-print');
  if (btnPrn) btnPrn.addEventListener('click', printBatteryReport);
  // v0.59.445: «Сохранить конфигурацию» → запись в configuration-catalog (kind='battery').
  const btnSave = document.getElementById('btn-battery-save-config');
  if (btnSave) btnSave.addEventListener('click', _saveBatteryConfiguration);
  // Фильтры и выбор модели
  ['calc-filter-text','calc-filter-supp','calc-filter-chem-flt','calc-filter-vblk','calc-filter-capmin','calc-filter-capmax'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => renderBatterySelector());
  });
  const reset = document.getElementById('calc-filter-reset');
  if (reset) reset.addEventListener('click', () => {
    ['calc-filter-text','calc-filter-supp','calc-filter-chem-flt','calc-filter-vblk','calc-filter-capmin','calc-filter-capmax'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    renderBatterySelector();
  });
  const sel = document.getElementById('calc-battery');
  if (sel) sel.addEventListener('change', () => { _applyBatteryLock(); _renderCapacityRecommend(); });
  // v0.59.428: смена опций S³ → перезапуск расчёта, чтобы блок «Состав
  // системы» сразу отразил новые варианты master/slave (-M vs -M1 vs -M2,
  // -S vs -S2, X vs blank).
  ['calc-s3-master-variant','calc-s3-slave-variant','calc-s3-fire-fighting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { try { doCalc(); } catch {} });
  });
  ['calc-load','calc-target','calc-dcv','calc-inveff','calc-chem'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { _renderCapacityRecommend(); _refreshDcExplanation(); });
    if (el) el.addEventListener('change', () => { _renderCapacityRecommend(); _refreshDcExplanation(); });
  });
  // v0.59.412: blockV / endV влияют на оптимальный N — обновляем объяснение.
  ['calc-blockv','calc-endv'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { _refreshDcExplanation(); _renderCapacityRecommend(); });
    el.addEventListener('change', () => { _refreshDcExplanation(); _renderCapacityRecommend(); });
  });
  // V_DC мин/макс — обновляем подсказку и рекомендацию при ручном вводе.
  ['calc-vdcmin','calc-vdcmax'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const a = Number(document.getElementById('calc-vdcmin')?.value) || 0;
      const b = Number(document.getElementById('calc-vdcmax')?.value) || 0;
      if (a > 0 && b > 0 && a < b) {
        // v0.59.412: предзаполняем поле «номинальное V_DC» оптимальным N
        // (минимум блоков, удовлетворяющий end-of-discharge и float),
        // а не средней точкой диапазона.
        const blockV = Number(document.getElementById('calc-blockv')?.value) || 12;
        const endV   = Number(document.getElementById('calc-endv')?.value)   || 1.75;
        const chem   = document.getElementById('calc-chem')?.value || 'vrla';
        const o = _pickOptimalBlocks(a, b, blockV, endV, chem, _readDerating().vdcSafetyPct);
        const dc = document.getElementById('calc-dcv');
        if (dc) dc.value = o.N * blockV;
      }
      _refreshDcExplanation();
      _renderCapacityRecommend();
    });
  });
  // v0.59.413: коэффициенты дерейтинга. Кнопки-пресеты + живые input'ы.
  document.querySelectorAll('[data-derate-preset]').forEach(btn => {
    btn.addEventListener('click', () => _applyDeratingPreset(btn.dataset.deratePreset));
  });
  ['calc-k-age','calc-k-temp','calc-k-design','calc-vdc-safety','calc-soc-min'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  () => { _refreshDerateSummary(); _refreshDcExplanation(); });
    el.addEventListener('change', () => { _refreshDerateSummary(); _refreshDcExplanation(); });
  });
  // Первичный рендер объяснения (после монтирования формы).
  setTimeout(() => { _refreshDerateSummary(); _refreshDcExplanation(); }, 0);
}

// ================ Сохранение конфигурации АКБ ================
// v0.59.445: записывает текущий расчёт в configuration-catalog (kind='battery').
// Дальше его можно увидеть в боковом перечне (если он смонтирован) или
// открыть из ups-config'а как стартовую точку для подбора ИБП.
async function _saveBatteryConfiguration() {
  if (!lastBatteryCalc || !lastBatteryCalc.calcResult) {
    rsToast('Сначала выполните расчёт.', 'warn');
    return;
  }
  const { params, calcResult, s3Cfg } = lastBatteryCalc;
  const battery = params.battery || {};
  let strings = 1, blocksPerString = 1, autonomyMin = null;
  if (calcResult.kind === 'autonomy') {
    strings = params.strings || 1;
    blocksPerString = calcResult.blocksPerString || 1;
    autonomyMin = calcResult.r?.autonomyMin || null;
  } else if (calcResult.kind === 'required' && calcResult.found) {
    strings = calcResult.found.strings || 1;
    blocksPerString = calcResult.found.blocksPerString || 1;
    autonomyMin = calcResult.found.result?.autonomyMin || null;
  }
  const totalBlocks = strings * blocksPerString;
  const totalKwh = totalBlocks * (battery.capacityAh || 0) * (battery.blockVoltage || 0) / 1000;
  // диалог имени
  let defaultLabel = '';
  if (s3Cfg) {
    defaultLabel = `S³ ${battery.type || ''} · ${s3Cfg.cabinetsCount}шкаф×${s3Cfg.modulesPerCabinet}мод`;
  } else {
    defaultLabel = `${battery.supplier || ''} ${battery.type || battery.model || ''} · ${strings}×${blocksPerString}`.trim();
  }
  const name = (window.scsPrompt
    ? await window.scsPrompt('Сохранение конфигурации АКБ', 'Имя конфигурации:', defaultLabel)
    : prompt('Имя конфигурации АКБ:', defaultLabel));
  if (!name) return;
  const projectCode = _getActiveProjectCode();
  const id = _nextConfigId('battery', projectCode);
  const description = [
    battery.supplier,
    battery.type || battery.model,
    battery.capacityAh && (battery.capacityAh + ' А·ч'),
    battery.blockVoltage && (battery.blockVoltage + ' В'),
    `${strings}×${blocksPerString} = ${totalBlocks} бл.`,
    autonomyMin && (Number(autonomyMin).toFixed(1) + ' мин'),
  ].filter(Boolean).join(' · ');
  const entry = {
    id, kind: 'battery', label: name.trim(), description,
    projectCode: projectCode || undefined,
    payload: {
      source: 'battery-calc',
      battery: {
        id: battery.id, supplier: battery.supplier, model: battery.model,
        type: battery.type, chemistry: battery.chemistry,
        capacityAh: battery.capacityAh, blockVoltage: battery.blockVoltage,
      },
      mode: params.mode, targetMin: params.targetMin,
      endV: params.endV, invEff: params.invEff,
      derate: calcResult.derate || null,
      strings, blocksPerString, totalBlocks, totalKwh,
      autonomyMin,
      dcVoltage: battery.blockVoltage ? battery.blockVoltage * blocksPerString : null,
      s3Cfg: s3Cfg ? {
        cabinetsCount: s3Cfg.cabinetsCount,
        modulesPerCabinet: s3Cfg.modulesPerCabinet,
        totalModules: s3Cfg.totalModules,
        cabinetModel: s3Cfg.cabinetModel,
        vdcOper: s3Cfg.vdcOper,
        wiring: s3Cfg.wiring,
      } : null,
    },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  try {
    _saveConfig('battery', entry);
    rsToast(`Сохранено: ${entry.label} (${entry.id})`, 'success');
  } catch (e) {
    rsToast('Не удалось сохранить: ' + (e && e.message ? e.message : e), 'err');
  }
}

// ================ Экспорт отчёта АКБ ================
async function exportBatteryReport() {
  if (!lastBatteryCalc) {
    rsToast('Сначала выполните расчёт.', 'warn');
    return;
  }
  const rec = await Report.pickTemplate({
    title: 'Выбор шаблона для отчёта по расчёту АКБ',
    tags:  ['акб','батарея','расчёты','общее','инженерный'],
  });
  if (!rec) return;
  const tpl = Report.createTemplate(rec.template);
  tpl.meta.title = 'Расчёт аккумуляторной батареи';
  tpl.content = buildBatteryReportBlocks(lastBatteryCalc);
  try { await Report.exportPDF(tpl, 'Расчёт АКБ'); }
  catch (e) { rsToast('Не удалось сформировать PDF: ' + (e && e.message ? e.message : e), 'err'); }
}

function buildBatteryReportBlocks(state) {
  const p = state.params;
  const r = state.calcResult;
  const batName = p.battery
    ? [p.battery.supplier, p.battery.type || p.battery.model, p.battery.capacityAh ? (p.battery.capacityAh + ' А·ч') : ''].filter(Boolean).join(' · ')
    : 'усреднённая модель, тип АКБ: ' + chemLabel(p.chemistry);
  const capAh = p.battery ? p.battery.capacityAh : p.capacityAh;
  const blockV = p.battery ? p.battery.blockVoltage : 12;
  const blocksPerString = r ? r.blocksPerString : Math.max(1, Math.round(p.dcVoltage / blockV) || 1);

  const blocks = [
    B.h1('Отчёт о расчёте аккумуляторной батареи'),
    B.caption('Модель: ' + batName),

    B.h2('1. Исходные данные'),
    B.table(
      [
        { text: 'Параметр', width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Ед.', align: 'center', width: 18 },
      ],
      [
        ['Мощность нагрузки',           String(p.loadKw),               'кВт'],
        ['КПД инвертора',               (p.invEff * 100).toFixed(0),    '%'],
        ['Напряжение DC-шины',          String(p.dcVoltage),            'В'],
        ['Конечное напряжение элемента', String(p.endV),                'В'],
        ['Ёмкость блока',               String(capAh),                  'Ач'],
        ['Номинальное напряжение блока',String(blockV),                 'В'],
        ['Параллельных цепочек',        String(p.strings),              '—'],
        ['Блоков в цепочке',            String(blocksPerString),        '—'],
        ['Режим расчёта', p.mode === 'autonomy' ? 'Прямой (автономия по блокам)' : 'Обратный (блоки по автономии)', ''],
        p.mode === 'required' ? ['Требуемая автономия', String(p.targetMin), 'мин'] : null,
      ].filter(Boolean),
    ),

    B.h2('2. Результаты'),
  ];

  if (r.kind === 'autonomy' && r.r) {
    blocks.push(B.table(
      [
        { text: 'Параметр', width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Ед.', align: 'center', width: 18 },
      ],
      [
        ['Автономия',       Number.isFinite(r.r.autonomyMin) ? fmt(r.r.autonomyMin) : '∞', 'мин'],
        ['Метод',           r.r.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель', ''],
        ['Мощность на блок', fmt(r.r.blockPowerW), 'Вт'],
        ['Всего блоков',    String(p.strings * blocksPerString), 'шт.'],
        ['Конфигурация',    p.strings + ' цеп. × ' + blocksPerString + ' блоков', ''],
      ],
    ));
    if (r.r.warnings && r.r.warnings.length) {
      blocks.push(B.h3('Предупреждения'));
      blocks.push(B.list(r.r.warnings.map(w => '⚠ ' + w)));
    }
  } else if (r.kind === 'required') {
    if (r.found) {
      const f = r.found;
      blocks.push(B.table(
        [
          { text: 'Параметр', width: 80 },
          { text: 'Значение', align: 'right', width: 40 },
          { text: 'Ед.', align: 'center', width: 18 },
        ],
        [
          ['Минимум блоков',      String(f.totalBlocks), 'шт.'],
          ['Параллельных цепочек', String(f.strings),    '—'],
          ['Блоков в цепочке',    String(f.blocksPerString), '—'],
          ['Реальная автономия',  fmt(f.result.autonomyMin), 'мин'],
          ['Метод',               f.result.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель', ''],
        ],
      ));
      blocks.push(B.paragraph('Конфигурация удовлетворяет требованию ≥ ' + p.targetMin + ' мин.'));
    } else {
      blocks.push(B.paragraph('Не удалось подобрать конфигурацию в пределах 2000 блоков. Проверьте нагрузку и параметры.'));
    }
  }

  // v0.59.414: добавляем разделы по дерейтингу и подбору N (если есть данные).
  const derate = r && r.derate;
  if (derate && (derate.kTotal > 1.001 || derate.vdcSafetyPct > 0 || derate.socMinPct > 0)) {
    blocks.push(B.h2('3. Расчётные коэффициенты (IEEE 485 / IEC 62040)'));
    blocks.push(B.table(
      [
        { text: 'Коэффициент', width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Назначение', width: 80 },
      ],
      [
        ['k_age',    derate.kAge.toFixed(2),    'Старение АКБ к концу срока службы'],
        ['k_temp',   derate.kTemp.toFixed(2),   'Температурная коррекция'],
        ['k_design', derate.kDesign.toFixed(2), 'Конструктивный запас (design margin)'],
        ['k_total',  derate.kTotal.toFixed(3),  'Произведение коэффициентов'],
        ['Окно V_DC ±%',   derate.vdcSafetyPct.toFixed(1) + ' %', 'Симметричное сужение допустимого диапазона V_DC ИБП'],
        ['Резерв SoC, %',  derate.socMinPct.toFixed(0) + ' %',    'Только для Li-ion: минимальный остаточный заряд'],
      ],
    ));
    if (Number.isFinite(r.loadKwEff)) {
      blocks.push(B.paragraph('Расчётная нагрузка: ' + fmt(r.loadKwEff) + ' кВт (паспортная ' + fmt(p.loadKw) + ' кВт), коэффициент дерейтинга k_total = ' + derate.kTotal.toFixed(3) + '.'));
    }
  }
  // Подбор N (V_DC оптимизация)
  if (state.opt && state.vRange) {
    const o = state.opt, vR = state.vRange;
    blocks.push(B.h2((derate && (derate.kTotal > 1.001 || derate.vdcSafetyPct > 0 || derate.socMinPct > 0)) ? '4. Подбор числа блоков (V_DC оптимизация)' : '3. Подбор числа блоков (V_DC оптимизация)'));
    blocks.push(B.paragraph('Цель: выбрать минимальное число блоков N в цепочке, при котором напряжение DC-шины остаётся в допустимом диапазоне ИБП и в режиме разряда (до endV), и в режиме плавающего заряда (float).'));
    blocks.push(B.table(
      [
        { text: 'Параметр', width: 80 },
        { text: 'Значение', align: 'right', width: 40 },
        { text: 'Ед.', align: 'center', width: 18 },
      ],
      [
        ['Диапазон V_DC ИБП',         vR.min + '…' + vR.max,                        'В'],
        ['Окно после safety',         o.vMinEff.toFixed(0) + '…' + o.vMaxEff.toFixed(0), 'В'],
        ['Элементов в блоке',         String(o.cellsPerBlock),                      'шт.'],
        ['Конец разряда на блок',     o.endVperBlock.toFixed(2),                    'В/блок'],
        ['Float-напряжение на блок',  o.floatVperBlock.toFixed(2),                  'В/блок'],
        ['N_min (по разряду)',        String(o.nMinDischarge),                      'шт.'],
        ['N_max (по float)',          String(o.nMaxFloat),                          'шт.'],
        ['Принято (минимум по экономике)', String(blocksPerString),                 'шт.'],
      ],
    ));
    blocks.push(B.paragraph('Формулы: N_min = ⌈V_DC_min_eff / (endV · cellsPerBlock)⌉, N_max = ⌊V_DC_max_eff / (floatV · cellsPerBlock)⌋. Выбран N = N_min для минимизации количества блоков и стоимости.'));
    if (state.dcWarn) blocks.push(B.paragraph('⚠ ' + state.dcWarn));
  }

  blocks.push(B.hr());
  blocks.push(B.caption('Документ сформирован автоматически.'));
  return blocks;
}

// v0.59.414: открывает новое окно с печатным отчётом — таблицами + обоими
// SVG-графиками — и вызывает window.print(). Альтернатива PDF-экспорту,
// удобна для быстрой печати без выбора шаблона.
function printBatteryReport() {
  if (!lastBatteryCalc) {
    rsToast('Сначала выполните расчёт.', 'warn');
    return;
  }
  const s = lastBatteryCalc;
  const p = s.params, r = s.calcResult;
  const batName = p.battery
    ? [p.battery.supplier, p.battery.type || p.battery.model, p.battery.capacityAh ? (p.battery.capacityAh + ' А·ч') : ''].filter(Boolean).join(' · ')
    : 'усреднённая модель, тип АКБ: ' + chemLabel(p.chemistry);
  const blockV = p.battery ? p.battery.blockVoltage : (s.blockV || 12);
  const capAh = p.battery ? p.battery.capacityAh : p.capacityAh;
  const blocksPerString = r.blocksPerString;

  const row = (k, v, u) => `<tr><td>${escHtml(k)}</td><td style="text-align:right">${escHtml(String(v))}</td><td style="text-align:center;color:#666">${escHtml(u || '')}</td></tr>`;
  const tbl = (rows) => `<table class="rep"><thead><tr><th>Параметр</th><th style="text-align:right">Значение</th><th style="text-align:center">Ед.</th></tr></thead><tbody>${rows.filter(Boolean).join('')}</tbody></table>`;

  let html = `<!doctype html><html><head><meta charset="utf-8"><title>Расчёт АКБ — ${escHtml(batName)}</title>`;
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
    .chart { background:#fafbfc; border:1px solid #e0e3ea; border-radius:6px; padding:10px; margin: 6px 0 12px;
             break-inside: avoid; page-break-inside: avoid; }
    /* v0.59.418: «секция» = h2 + следующий блок (таблица / график / параграф).
       break-inside: avoid удерживает заголовок вместе с первым следующим блоком,
       чтобы заголовок не висел в одиночестве в конце страницы. */
    .section { break-inside: avoid; page-break-inside: avoid; }
    .actions { position:fixed; top:10px; right:14px; }
    .actions button { padding: 6px 12px; font-size: 13px; cursor: pointer; }
    @media print {
      .actions { display:none; }
      body { margin: 0; max-width: none; }
      h2 { break-after: avoid-page; page-break-after: avoid; }
      h2 + table, h2 + .chart, h2 + p, h2 + div { break-before: avoid-page; page-break-before: avoid; }
      .section { break-inside: avoid; page-break-inside: avoid; }
      .chart { break-inside: avoid; page-break-inside: avoid; }
      tr, thead { break-inside: avoid; page-break-inside: avoid; }
    }
  </style></head><body>`;
  html += `<div class="actions"><button onclick="window.print()">🖨 Печать</button> <button onclick="window.close()">✕ Закрыть</button></div>`;
  html += `<h1>Отчёт о расчёте аккумуляторной батареи</h1>`;
  html += `<div class="muted">Модель: <b>${escHtml(batName)}</b> · Дата: ${new Date().toLocaleString('ru-RU')}</div>`;

  html += `<div class="section"><h2>1. Исходные данные</h2>`;
  html += tbl([
    row('Мощность нагрузки', p.loadKw, 'кВт'),
    row('КПД инвертора', (p.invEff * 100).toFixed(0), '%'),
    row('Напряжение DC-шины', p.dcVoltage, 'В'),
    row('Конечное напряжение элемента', p.endV, 'В'),
    row('Ёмкость блока', capAh, 'Ач'),
    row('Номинальное напряжение блока', blockV, 'В'),
    row('Параллельных цепочек', p.strings, '—'),
    row('Блоков в цепочке', blocksPerString, '—'),
    row('Режим расчёта', p.mode === 'autonomy' ? 'Прямой (автономия по блокам)' : 'Обратный (блоки по автономии)', ''),
    p.mode === 'required' ? row('Требуемая автономия', p.targetMin, 'мин') : '',
  ]);
  html += `</div>`;

  html += `<div class="section"><h2>2. Результаты</h2>`;
  if (r.kind === 'autonomy' && r.r) {
    html += tbl([
      row('Автономия', Number.isFinite(r.r.autonomyMin) ? fmt(r.r.autonomyMin) : '∞', 'мин'),
      row('Метод', r.r.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель', ''),
      row('Мощность на блок', fmt(r.r.blockPowerW), 'Вт'),
      row('Всего блоков', p.strings * blocksPerString, 'шт.'),
      row('Конфигурация', p.strings + ' цеп. × ' + blocksPerString + ' бл.', ''),
    ]);
    if (r.r.extrapolated) html += `<div class="warn">⚠ Условный расчёт: запрошенное время вне таблицы производителя — линейная экстраполяция.</div>`;
    if (r.r.warnings && r.r.warnings.length) html += r.r.warnings.map(w => `<div class="warn">⚠ ${escHtml(w)}</div>`).join('');
  } else if (r.kind === 'required' && r.found) {
    const f = r.found;
    html += tbl([
      row('Минимум блоков', f.totalBlocks, 'шт.'),
      row('Параллельных цепочек', f.strings, '—'),
      row('Блоков в цепочке', f.blocksPerString, '—'),
      row('Реальная автономия', fmt(f.result.autonomyMin), 'мин'),
      row('Метод', f.result.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель', ''),
    ]);
    if (f.result.extrapolated) html += `<div class="warn">⚠ Условный расчёт: запрошенное время вне таблицы — линейная экстраполяция.</div>`;
  }
  html += `</div>`;

  // Дерейтинг
  const d = r.derate;
  if (d && (d.kTotal > 1.001 || d.vdcSafetyPct > 0 || d.socMinPct > 0)) {
    html += `<div class="section"><h2>3. Расчётные коэффициенты (IEEE 485 / IEC 62040)</h2>`;
    html += tbl([
      row('k_age', d.kAge.toFixed(2), '—'),
      row('k_temp', d.kTemp.toFixed(2), '—'),
      row('k_design', d.kDesign.toFixed(2), '—'),
      row('k_total', d.kTotal.toFixed(3), '—'),
      row('Окно V_DC', '±' + d.vdcSafetyPct.toFixed(1), '%'),
      row('Резерв SoC (Li-ion)', d.socMinPct.toFixed(0), '%'),
      Number.isFinite(r.loadKwEff) ? row('Расчётная нагрузка', fmt(r.loadKwEff), 'кВт') : '',
    ]);
    html += `</div>`;
  }

  // Подбор N
  if (s.opt && s.vRange) {
    const o = s.opt, vR = s.vRange;
    html += `<div class="section"><h2>${(d && (d.kTotal > 1.001 || d.vdcSafetyPct > 0 || d.socMinPct > 0)) ? '4' : '3'}. Подбор числа блоков (V_DC оптимизация)</h2>`;
    html += `<p style="font-size:12px">Минимальное N в цепочке при условии: V_DC в окне ИБП и при разряде, и при float-заряде.</p>`;
    html += tbl([
      row('Диапазон V_DC ИБП', vR.min + '…' + vR.max, 'В'),
      row('Окно после safety', o.vMinEff.toFixed(0) + '…' + o.vMaxEff.toFixed(0), 'В'),
      row('Элементов в блоке', o.cellsPerBlock, 'шт.'),
      row('endV на блок', o.endVperBlock.toFixed(2), 'В'),
      row('floatV на блок', o.floatVperBlock.toFixed(2), 'В'),
      row('N_min (разряд)', o.nMinDischarge, 'шт.'),
      row('N_max (float)', o.nMaxFloat, 'шт.'),
      row('Принято N', blocksPerString, 'шт.'),
    ]);
    html += `<p style="font-size:12px;color:#444">Формулы: N_min = ⌈V_DC_min_eff / (endV · cellsPerBlock)⌉; N_max = ⌊V_DC_max_eff / (floatV · cellsPerBlock)⌋. Выбран минимум — экономически оптимально.</p>`;
    if (s.dcWarn) html += `<div class="warn">⚠ ${escHtml(s.dcWarn)}</div>`;
    html += `</div>`;
  }

  // Графики (вытягиваем innerHTML текущих SVG)
  const mainChart = document.getElementById('calc-chart-mount');
  const zoomChart = document.getElementById('calc-chart-zoom-mount');
  const nextN = (d && (d.kTotal > 1.001 || d.vdcSafetyPct > 0 || d.socMinPct > 0)) ? (s.opt ? '5' : '4') : (s.opt ? '4' : '3');
  if (mainChart && mainChart.innerHTML.trim()) {
    html += `<div class="section"><h2>${nextN}. График разряда АКБ</h2>`;
    html += `<div class="chart">${mainChart.innerHTML}</div>`;
    html += `<p class="muted">Красный маркер — рассчитанная рабочая точка. Оранжевый — экстраполированная (за пределами таблицы производителя).</p>`;
    html += `</div>`;
  }
  if (zoomChart && zoomChart.innerHTML.trim()) {
    html += `<div class="section"><h2>${+nextN + 1}. Детализация в рабочей зоне</h2>`;
    html += `<div class="chart">${zoomChart.innerHTML}</div>`;
    html += `<p class="muted">Окно вокруг рабочей точки. Линейные шкалы для оценки запаса по обеим осям.</p>`;
    html += `</div>`;
  }

  html += `<hr style="margin-top:18px"><p class="muted">Документ сформирован автоматически Raschet · ${new Date().toLocaleDateString('ru-RU')}</p>`;
  html += `</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    rsToast('Не удалось открыть окно печати — проверьте блокировщик всплывающих окон.', 'err');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Auto-focus и небольшая задержка для рендера SVG перед печатью
  setTimeout(() => { try { w.focus(); } catch (e) {} }, 200);
}

// ================= Вкладки =================
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

// ================= Rack layout calculator (VRLA) =================
// Расчёт компоновки батарейного шкафа: размещение блоков на полках,
// проверка зазоров до клемм, оценка массы шкафа.
//
// Нормы:
//   IEC 62485-2 §5 / ГОСТ Р МЭК 62485-2 — расстояние между смежными
//     батареями, минимум до токоведущих частей.
//   ПУЭ 4.4.12 — «Расстояние между батареями и стеной … не менее
//     50 мм, между полками — не менее 50 мм (лучше больше), зазор
//     между клеммами и металлом — не менее 15 мм».
//
// Алгоритм:
//   1) Выбираем ориентацию (long / short) и считаем footprint одного блока
//   2) По внутр. ширине шкафа — blocksPerRow = floor((cabW - 2×wall + gap) / (blockW + gap))
//   3) По внутр. глубине — rowsPerShelf = floor((cabD - 2×wall + gap) / (blockD + gap))
//   4) Мест на полке = blocksPerRow × rowsPerShelf
//   5) Полок = ceil(N / blocksPerShelf)
//   6) Высота от пола = shelfTotalHeight × полок + зазор сверху
//      shelfTotalHeight = blockH + shelfClear + shelfThickness
//   7) Проверки: помещаются ли все блоки, укладывается ли высота в cabH,
//      есть ли конфликт terminalClearanceMm > shelfClearance (клеммы
//      уткнутся в полку сверху).
function renderRackBatterySelector() {
  const sel = document.getElementById('rack-battery');
  if (!sel) return;
  // v0.59.464: показываем ВСЕ VRLA АКБ (даже без габаритов). Пользователь
  // выбирает модель, заполняет габариты вручную если их нет, и кнопкой
  // «💾 Сохранить» записывает их обратно в каталог для дальнейшего
  // использования (через addBattery, который делает upsert по id).
  const list = _sortBatteries(listBatteries().filter(b => b.chemistry === 'vrla' && b.systemSubtype !== 'cabinet' && b.systemSubtype !== 'accessory'));
  const cur = sel.value;
  let h = '<option value="">— задать габариты вручную —</option>';
  let withDims = 0, noDims = 0;
  for (const b of list) {
    const has = b.lengthMm > 0 && b.widthMm > 0 && b.heightMm > 0;
    const tag = has
      ? `${b.lengthMm}×${b.widthMm}×${b.heightMm} мм, ${b.weightKg || '?'} кг`
      : '⚠ габариты не заданы';
    h += `<option value="${escHtml(b.id)}">${escHtml(b.supplier)} · ${escHtml(b.type)} (${tag})</option>`;
    if (has) withDims++; else noDims++;
  }
  sel.innerHTML = h;
  if (cur) sel.value = cur;
  const info = document.getElementById('rack-battery-info');
  if (info) {
    info.textContent = `АКБ в каталоге: ${list.length} (с габаритами: ${withDims}, без: ${noDims})`;
  }
}

// v0.59.464: применяет габариты выбранной АКБ к полям формы. Если габаритов
// нет — поля очищаются, чтобы пользователь ввёл вручную.
function _applyRackBatteryToForm() {
  const sel = document.getElementById('rack-battery');
  if (!sel || !sel.value) return;
  const b = getBattery(sel.value);
  if (!b) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && Number.isFinite(Number(v)) && Number(v) > 0) el.value = v; };
  set('rack-L', b.lengthMm);
  set('rack-W', b.widthMm);
  set('rack-H', b.heightMm);
  set('rack-Wt', b.weightKg);
  // Активируем/деактивируем кнопку «Сохранить»
  const btn = document.getElementById('rack-battery-save-dims');
  if (btn) btn.disabled = !sel.value;
}

// v0.59.464: сохраняет введённые габариты в выбранную запись каталога АКБ.
// addBattery() делает upsert по id, так что повторное использование тут же
// доступно во всех остальных местах (расчёт автономии, отчёт).
function _saveRackBatteryDims() {
  const sel = document.getElementById('rack-battery');
  if (!sel || !sel.value) {
    rsToast('Сначала выберите АКБ из справочника', 'warn');
    return;
  }
  const b = getBattery(sel.value);
  if (!b) return;
  const num = id => { const v = Number(document.getElementById(id)?.value); return Number.isFinite(v) && v > 0 ? v : null; };
  const L = num('rack-L'), W = num('rack-W'), H = num('rack-H'), Wt = num('rack-Wt');
  if (!L || !W || !H) {
    rsToast('Заполните L, W, H перед сохранением', 'warn');
    return;
  }
  const updated = { ...b, lengthMm: L, widthMm: W, heightMm: H };
  if (Wt) updated.weightKg = Wt;
  addBattery(updated);
  rsToast(`Габариты ${b.supplier} ${b.type} сохранены в каталог`, 'ok');
  renderRackBatterySelector();
  renderCatalog();
}

function doRackCalc() {
  const out = document.getElementById('rack-result');
  if (!out) return;
  const g = id => document.getElementById(id);
  const L = Number(g('rack-L').value) || 0;
  const W = Number(g('rack-W').value) || 0;
  const H = Number(g('rack-H').value) || 0;
  const Wt = Number(g('rack-Wt').value) || 0;
  const N = Math.max(1, Number(g('rack-N').value) || 1);
  const orient = g('rack-orient').value;
  const cabW = Number(g('rack-cabW').value) || 0;
  const cabD = Number(g('rack-cabD').value) || 0;
  const cabH = Number(g('rack-cabH').value) || 0;
  const gap  = Number(g('rack-gap').value) || 0;
  const wall = Number(g('rack-wall').value) || 0;
  const shelf = Number(g('rack-shelf').value) || 0;
  const shelfT = Number(g('rack-shelfT').value) || 0;
  const termClear = Number(g('rack-termClear').value) || 0;

  // Ориентация: блок на полке лежит длинной стороной вдоль ширины
  // шкафа («long») или поперёк («short»). Footprint на полке:
  //   long:  ширина = L, глубина = W
  //   short: ширина = W, глубина = L
  const blockW_shelf = orient === 'long' ? L : W;
  const blockD_shelf = orient === 'long' ? W : L;

  const errors = [];
  const warns = [];
  if (L <= 0 || W <= 0 || H <= 0) errors.push('Задайте габариты блока (L, W, H > 0).');
  if (cabW <= 0 || cabD <= 0 || cabH <= 0) errors.push('Задайте внутренние размеры шкафа.');

  // Помещается ли один блок в шкаф?
  const usableW = cabW - 2 * wall;
  const usableD = cabD - 2 * wall;
  if (blockW_shelf > usableW) errors.push(`Блок (${blockW_shelf} мм по ширине) не проходит в шкаф (полезная ширина ${usableW} мм после зазоров ${wall} мм до стенок).`);
  if (blockD_shelf > usableD) errors.push(`Блок (${blockD_shelf} мм по глубине) не проходит в шкаф (полезная глубина ${usableD} мм).`);

  // Блоков на ряд и рядов на полку
  const blocksPerRow = Math.max(0, Math.floor((usableW + gap) / (blockW_shelf + gap)));
  const rowsPerShelf = Math.max(0, Math.floor((usableD + gap) / (blockD_shelf + gap)));
  const blocksPerShelf = blocksPerRow * rowsPerShelf;

  if (blocksPerShelf === 0 && errors.length === 0) {
    errors.push('С заданными зазорами на полку не помещается ни одного блока.');
  }

  // Полок
  const shelves = blocksPerShelf > 0 ? Math.ceil(N / blocksPerShelf) : 0;
  // Полная высота: shelves × (H + shelfClear + shelfThickness) + нижний зазор
  const shelfUnitH = H + shelf + shelfT;
  const rackTotalH = shelves * shelfUnitH + wall;
  if (rackTotalH > cabH) {
    errors.push(`Требуется ${shelves} полок × ${shelfUnitH} мм = ${rackTotalH} мм, шкаф высотой ${cabH} мм не вмещает.`);
  }

  // Проверка зазора до клемм: клеммы должны быть ниже полки выше
  // как минимум на termClear. shelf — вертикальный зазор над блоком
  // (пространство между верхом блока и низом следующей полки).
  // Если termClear > shelf — проблема.
  if (termClear > shelf) {
    errors.push(`Зазор между блоком и следующей полкой (${shelf} мм) меньше требуемого зазора до клемм (${termClear} мм). Клеммы могут замкнуться на металл полки.`);
  } else if (termClear > shelf - 20) {
    warns.push(`Зазор до клемм (${termClear} мм) близок к пределу (${shelf} мм). Рекомендуется увеличить зазор между полками.`);
  }

  const totalMassKg = N * Wt;
  const shelfLoadKg = blocksPerShelf > 0 ? blocksPerShelf * Wt : 0;

  let html = '';
  if (errors.length) {
    html += `<div class="result-block error"><div class="result-title">⛔ Размещение невозможно</div>`;
    html += errors.map(e => `<div>• ${escHtml(e)}</div>`).join('');
    html += `</div>`;
  }
  if (!errors.length) {
    const usedBlocks = Math.min(N, blocksPerShelf * shelves);
    const sparePlaces = blocksPerShelf * shelves - N;
    html += `<div class="result-block">`;
    html += `<div class="result-title">✓ Компоновка рассчитана</div>`;
    html += `<table class="detail-table" style="margin-top:8px">`;
    html += `<tr><th colspan="2">Полка</th></tr>`;
    html += `<tr><td>Блоков на ряд (по ширине)</td><td><b>${blocksPerRow}</b></td></tr>`;
    html += `<tr><td>Рядов на полку (по глубине)</td><td><b>${rowsPerShelf}</b></td></tr>`;
    html += `<tr><td>Блоков на полке</td><td><b>${blocksPerShelf}</b></td></tr>`;
    html += `<tr><td>Нагрузка на полку</td><td><b>${shelfLoadKg.toFixed(1)} кг</b></td></tr>`;
    html += `<tr><th colspan="2">Шкаф</th></tr>`;
    html += `<tr><td>Полок</td><td><b>${shelves}</b></td></tr>`;
    html += `<tr><td>Высота компоновки</td><td><b>${rackTotalH} мм</b> из ${cabH} мм</td></tr>`;
    html += `<tr><td>Запас по высоте</td><td>${cabH - rackTotalH} мм</td></tr>`;
    html += `<tr><td>Свободных мест</td><td>${sparePlaces}</td></tr>`;
    html += `<tr><th colspan="2">Масса и BOM</th></tr>`;
    html += `<tr><td>Всего блоков</td><td><b>${N}</b></td></tr>`;
    html += `<tr><td>Масса АКБ</td><td><b>${totalMassKg.toFixed(1)} кг</b></td></tr>`;
    html += `</table></div>`;
    if (warns.length) {
      html += `<div class="result-block warn"><div class="result-title">⚠ Предупреждения</div>`;
      html += warns.map(w => `<div>• ${escHtml(w)}</div>`).join('');
      html += `</div>`;
    }
    // ASCII-схематичная визуализация одной полки
    if (blocksPerRow > 0 && rowsPerShelf > 0) {
      const cell = '[■]';
      const row = cell.repeat(blocksPerRow);
      const rows = Array(rowsPerShelf).fill(row).join('\n');
      html += `<div class="result-block">
        <div class="result-title">Схема полки (вид сверху)</div>
        <pre style="font:12px/1.4 ui-monospace,Consolas,monospace;margin-top:6px">${rows}</pre>
        <div class="muted" style="font-size:11px">Ширина шкафа →, глубина ↓. Один «[■]» = один блок ${L}×${W} мм.</div>
      </div>`;
    }
  }
  out.innerHTML = html;
}

function wireRackForm() {
  const form = document.getElementById('rack-form');
  if (!form) return;
  form.addEventListener('submit', e => { e.preventDefault(); doRackCalc(); });
  // Подстановка габаритов из справочника при выборе модели
  const sel = document.getElementById('rack-battery');
  if (sel) sel.addEventListener('change', () => {
    const id = sel.value;
    const btn = document.getElementById('rack-battery-save-dims');
    if (btn) btn.disabled = !id;
    if (!id) return;
    const b = getBattery(id);
    if (!b) return;
    const g = (x, v) => { const el = document.getElementById(x); if (el && v != null) el.value = v; };
    g('rack-L', b.lengthMm);
    g('rack-W', b.widthMm);
    g('rack-H', b.heightMm);
    g('rack-Wt', b.weightKg);
    if (b.terminalClearanceMm) g('rack-termClear', b.terminalClearanceMm);
  });
  // v0.59.464: кнопка «Сохранить габариты в каталог».
  const saveBtn = document.getElementById('rack-battery-save-dims');
  if (saveBtn) saveBtn.addEventListener('click', () => _saveRackBatteryDims());
  // Селектор VRLA-шкафа из ups-catalog. При выборе записи подставляем
  // её внутренние габариты + ограничение по числу блоков (rackSlots).
  const cabSel = document.getElementById('rack-cabinet');
  if (cabSel) {
    populateRackCabinetSelect(cabSel);
    cabSel.addEventListener('change', () => {
      const id = cabSel.value;
      if (!id) return;
      const rec = getUps(id);
      if (!rec) return;
      const g = (x, v) => { const el = document.getElementById(x); if (el && v != null) el.value = v; };
      // Kehua-каталог хранит внешние габариты; для компоновки лучше брать
      // внутренние (internal*) если заданы, иначе габариты со скидкой на
      // толщину стенки (~25 мм с каждой стороны).
      const innerW = rec.internalWidthMm  || (rec.cabinetWidthMm  ? rec.cabinetWidthMm  - 50 : null);
      const innerD = rec.internalDepthMm  || (rec.cabinetDepthMm  ? rec.cabinetDepthMm  - 50 : null);
      const innerH = rec.internalHeightMm || (rec.cabinetHeightMm ? rec.cabinetHeightMm - 50 : null);
      if (innerW) g('rack-cabW', innerW);
      if (innerD) g('rack-cabD', innerD);
      if (innerH) g('rack-cabH', innerH);
      // Подсказка по лимиту числа блоков
      const maxBlocks = rec.rackSlots || 0;
      const nInput = document.getElementById('rack-N');
      if (nInput && maxBlocks > 0) {
        nInput.title = `Паспортный лимит шкафа ${rec.model}: ${maxBlocks} блоков`;
        if (Number(nInput.value) > maxBlocks) nInput.value = maxBlocks;
      }
    });
  }
}

// Заполняет <select id="rack-cabinet"> всеми записями с
// kind === 'batt-cabinet-vrla' из текущего ups-catalog пользователя.
// Группирует по supplier для удобства.
function populateRackCabinetSelect(sel) {
  const all = listUpses().filter(r => r.kind === 'batt-cabinet-vrla');
  if (!all.length) {
    sel.innerHTML = '<option value="">— каталог ИБП пуст, откройте ups-config/ и загрузите Kehua —</option>';
    return;
  }
  // Группируем по supplier
  const bySup = new Map();
  for (const r of all) {
    const s = r.supplier || 'прочие';
    if (!bySup.has(s)) bySup.set(s, []);
    bySup.get(s).push(r);
  }
  const parts = ['<option value="">— задать размеры шкафа вручную —</option>'];
  for (const [sup, list] of bySup.entries()) {
    parts.push(`<optgroup label="${sup}">`);
    for (const r of list) {
      const slots = r.rackSlots ? ` · ${r.rackSlots} блоков` : '';
      const dims = (r.cabinetWidthMm && r.cabinetDepthMm && r.cabinetHeightMm)
        ? ` · ${r.cabinetWidthMm}×${r.cabinetDepthMm}×${r.cabinetHeightMm}`
        : '';
      parts.push(`<option value="${r.id}">${r.model}${slots}${dims}</option>`);
    }
    parts.push('</optgroup>');
  }
  sel.innerHTML = parts.join('');
}

// ================= Bootstrap =================
window.addEventListener('DOMContentLoaded', () => {
  wireTabs();
  wireUpload();
  wireCalcForm();
  wireRackForm();
  renderCatalog();
  renderBatterySelector();
  renderRackBatterySelector();
  // v0.59.403: UPS picker внутри battery (standalone-режим)
  _wireUpsPicker();
  renderUpsPicker();
  // Фаза 1.4.4: интеграция с Конструктором схем
  initSchemaContext();
  // v0.59.400: handoff из ups-config (?fromUps=1) — предзаполнение и возврат.
  initUpsHandoff();
});

// ================= Интеграция с Конструктором схем (Фаза 1.4.4) =================
// Аналогично ups-config: если URL содержит ?nodeId=<id>, показываем баннер
// с кнопкой «Применить к схеме», которая передаёт выбранную АКБ + число
// цепочек + число блоков обратно в узел ИБП.
function initSchemaContext() {
  const qp = new URLSearchParams(location.search);
  const ctxNodeId = qp.get('nodeId');
  if (!ctxNodeId) return;

  // Предзаполнение формы расчёта из контекста ИБП
  const loadKw = qp.get('loadKw');
  const vdcMin = qp.get('vdcMin');
  const vdcMax = qp.get('vdcMax');
  const autonomyMin = qp.get('autonomyMin');
  const selected = qp.get('selected');
  const invEffPct = qp.get('invEff');

  // Переключаемся на вкладку «Расчёт разряда»
  const calcTab = document.querySelector('[data-tab="calc"]');
  if (calcTab) calcTab.click();

  // Отложенно заполним поля (после рендера формы).
  // ID полей: calc-battery, calc-load, calc-target, calc-dcv (среднее от vdcMin/max)
  setTimeout(() => {
    const loadEl = document.getElementById('calc-load');
    if (loadEl && loadKw) loadEl.value = loadKw;
    const autEl = document.getElementById('calc-target');
    if (autEl && autonomyMin) autEl.value = autonomyMin;
    const dcvEl = document.getElementById('calc-dcv');
    if (dcvEl && (vdcMin || vdcMax)) {
      const mid = (Number(vdcMin || vdcMax) + Number(vdcMax || vdcMin)) / 2;
      if (Number.isFinite(mid)) dcvEl.value = mid;
    }
    if (vdcMin && vdcMax) {
      _handoffVdc.min = Number(vdcMin) || 0;
      _handoffVdc.max = Number(vdcMax) || 0;
      const vmin = document.getElementById('calc-vdcmin');
      const vmax = document.getElementById('calc-vdcmax');
      if (vmin) { vmin.value = _handoffVdc.min; vmin.readOnly = true; vmin.style.background = '#f0f0f0'; vmin.title = 'Из контекста схемы'; }
      if (vmax) { vmax.value = _handoffVdc.max; vmax.readOnly = true; vmax.style.background = '#f0f0f0'; vmax.title = 'Из контекста схемы'; }
      _setDcvRangeHint(_handoffVdc.min, _handoffVdc.max, 'из контекста схемы');
    }
    // v0.59.419: КПД инвертора из паспорта ИБП — блокируем поле, чтобы
    // пользователь не мог случайно изменить и получить расчёт, не
    // соответствующий выбранному ИБП.
    if (invEffPct) {
      const ie = document.getElementById('calc-inveff');
      const v = Math.round(Number(invEffPct));
      if (ie && Number.isFinite(v) && v > 0) {
        ie.value = v;
        ie.readOnly = true;
        ie.style.background = '#f0f0f0';
        ie.title = 'Из паспорта ИБП — нельзя менять при подборе для конкретной модели';
      }
    }
    const batEl = document.getElementById('calc-battery');
    if (batEl && selected) batEl.value = selected;
    // Режим «найти минимум блоков для автономии ≥ target»
    const modeEl = document.getElementById('calc-mode');
    if (modeEl && autonomyMin) {
      modeEl.value = 'required';
      modeEl.dispatchEvent(new Event('change'));
    }
    try { _renderCapacityRecommend(); } catch {}
    try { _applyBatteryLock(); } catch {}
  }, 150);

  // Баннер сверху
  const banner = document.createElement('div');
  banner.style.cssText = 'position:sticky;top:0;z-index:100;padding:10px 16px;background:#1976d2;color:#fff;display:flex;align-items:center;gap:12px;font-size:13px;box-shadow:0 2px 4px rgba(0,0,0,.15)';
  banner.innerHTML = `
    <span style="flex:1">🔋 Открыто из Конструктора схем (узел <code style="background:rgba(255,255,255,.2);padding:1px 5px;border-radius:3px">${escHtml(ctxNodeId)}</code>). Подберите АКБ и нажмите «Применить».</span>
    <button type="button" id="ctx-apply-battery" style="background:#fff;color:#1976d2;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:600">Применить к схеме</button>
    <button type="button" id="ctx-cancel-battery" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);padding:5px 10px;border-radius:4px;cursor:pointer">Отмена</button>
  `;
  document.body.insertBefore(banner, document.body.firstChild);

  document.getElementById('ctx-apply-battery')?.addEventListener('click', () => {
    // Забираем результат последнего расчёта
    if (!lastBatteryCalc || !lastBatteryCalc.calcResult) {
      flash('Сначала выполните расчёт — выберите АКБ и нажмите «Рассчитать»', 'warn');
      return;
    }
    const { params, calcResult } = lastBatteryCalc;
    // Извлекаем strings / blocksPerString / autonomyMin из двух возможных структур
    let strings = 1, blocksPerString = calcResult.blocksPerString || 1, autonomyMin = null;
    if (calcResult.kind === 'autonomy') {
      strings = params.strings || 1;
      autonomyMin = calcResult.r?.autonomyMin || null;
    } else if (calcResult.kind === 'required' && calcResult.found) {
      strings = calcResult.found.strings || 1;
      blocksPerString = calcResult.found.blocksPerString || blocksPerString;
      autonomyMin = calcResult.found.result?.autonomyMin || null;
    }
    // Total kWh = strings × blocksPerString × capacityAh × blockVoltage / 1000
    const battery = params.battery;
    const totalKwh = battery
      ? strings * blocksPerString * (battery.capacityAh || 0) * (battery.blockVoltage || 0) / 1000
      : null;
    const payload = {
      nodeId: ctxNodeId,
      batteryCatalogId: battery?.id || null,
      batteryStringCount: strings,
      batteryBlocksPerString: blocksPerString,
      batteryAutonomyMin: autonomyMin,
      batteryKwh: totalKwh,
      selectedAt: Date.now(),
    };
    try {
      localStorage.setItem('raschet.pendingBatterySelection.v1', JSON.stringify(payload));
      flash('Готово. Вернитесь на вкладку Конструктора схем', 'success');
      setTimeout(() => { try { window.close(); } catch {} }, 2000);
    } catch (e) {
      flash('Не удалось передать результат: ' + (e.message || e), 'error');
    }
  });
  document.getElementById('ctx-cancel-battery')?.addEventListener('click', () => {
    try { window.close(); } catch {}
  });
}

// v0.59.400: интеграция с конфигуратором ИБП. Когда battery открывается из
// ups-config (?fromUps=1), берём параметры из query-string и localStorage
// handoff (raschet.upsHandoff.v1). Заполняем форму расчёта (нагрузка,
// V_DC, целевая автономия, КПД инвертора). Показываем баннер «Из
// конфигуратора ИБП». При нажатии «Применить → ИБП» сохраняем выбор АКБ в
// raschet.upsBatteryReturn.v1 для подбора в wizard'е ИБП.
function initUpsHandoff() {
  const qp = new URLSearchParams(location.search);
  if (qp.get('fromUps') !== '1') return;
  let h = {};
  try { h = JSON.parse(localStorage.getItem('raschet.upsHandoff.v1') || '{}'); } catch {}
  const loadKw = qp.get('loadKw') || h.loadKw;
  const autonomyMin = qp.get('autonomyMin') || h.autonomyMin;
  const vdcMin = qp.get('vdcMin') || h.vdcMin;
  const vdcMax = qp.get('vdcMax') || h.vdcMax;
  const invEffPct = qp.get('invEff') || (h.invEff != null ? h.invEff * 100 : null);
  setTimeout(() => {
    const calcTab = document.querySelector('[data-tab="tab-calc"]');
    if (calcTab) calcTab.click();
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    set('calc-load', loadKw);
    set('calc-target', autonomyMin);
    if (vdcMin || vdcMax) {
      const mid = (Number(vdcMin || vdcMax) + Number(vdcMax || vdcMin)) / 2;
      if (Number.isFinite(mid)) set('calc-dcv', Math.round(mid));
      if (vdcMin && vdcMax) {
        _handoffVdc.min = Number(vdcMin) || 0;
        _handoffVdc.max = Number(vdcMax) || 0;
        const vminEl = document.getElementById('calc-vdcmin');
        const vmaxEl = document.getElementById('calc-vdcmax');
        if (vminEl) { vminEl.value = _handoffVdc.min; vminEl.readOnly = true; vminEl.style.background = '#f0f0f0'; vminEl.title = 'Из ИБП-конфигуратора'; }
        if (vmaxEl) { vmaxEl.value = _handoffVdc.max; vmaxEl.readOnly = true; vmaxEl.style.background = '#f0f0f0'; vmaxEl.title = 'Из ИБП-конфигуратора'; }
        _setDcvRangeHint(_handoffVdc.min, _handoffVdc.max, 'из ИБП-конфигуратора');
      }
    }
    if (invEffPct) {
      const ie = document.getElementById('calc-inveff');
      const v = Math.round(Number(invEffPct));
      if (ie && Number.isFinite(v) && v > 0) {
        ie.value = v;
        // v0.59.419: блокируем — паспорт ИБП.
        ie.readOnly = true;
        ie.style.background = '#f0f0f0';
        ie.title = 'Из ИБП-конфигуратора — нельзя менять при подборе для конкретной модели';
      }
    }
    const modeEl = document.getElementById('calc-mode');
    if (modeEl && autonomyMin) {
      modeEl.value = 'required';
      modeEl.dispatchEvent(new Event('change'));
    }
    // Programmatic value set не триггерит input/change — вручную дёргаем
    // зависимые рендеры (рекомендация ёмкости, лок V/Ah)
    try { _renderCapacityRecommend(); } catch {}
    try { _applyBatteryLock(); } catch {}
  }, 150);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:sticky;top:0;z-index:100;padding:10px 16px;background:#6366f1;color:#fff;display:flex;align-items:center;gap:12px;font-size:13px;box-shadow:0 2px 4px rgba(0,0,0,.15)';
  banner.innerHTML = `
    <span style="flex:1">⚡ Подбор АКБ для ИБП <b>${escHtml(h.upsLabel || '')}</b>${vdcMin && vdcMax ? ` · V<sub>DC</sub> ${vdcMin}…${vdcMax} В` : ''}. Параметры предзаполнены — выберите модель и рассчитайте, затем нажмите «Применить → ИБП».</span>
    <button type="button" id="ups-apply-battery" style="background:#fff;color:#4338ca;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:600">Применить → ИБП</button>
    <button type="button" id="ups-cancel-battery" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);padding:5px 10px;border-radius:4px;cursor:pointer">Отмена</button>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
  document.getElementById('ups-apply-battery')?.addEventListener('click', () => {
    if (!lastBatteryCalc || !lastBatteryCalc.calcResult) {
      flash('Сначала выполните расчёт — выберите АКБ и нажмите «Рассчитать»', 'warn');
      return;
    }
    const { params, calcResult } = lastBatteryCalc;
    let strings = 1, blocksPerString = calcResult.blocksPerString || 1, autonomy = null;
    if (calcResult.kind === 'autonomy') {
      strings = params.strings || 1;
      autonomy = calcResult.r?.autonomyMin || null;
    } else if (calcResult.kind === 'required' && calcResult.found) {
      strings = calcResult.found.strings || 1;
      blocksPerString = calcResult.found.blocksPerString || blocksPerString;
      autonomy = calcResult.found.result?.autonomyMin || null;
    }
    const battery = params.battery;
    const totalKwh = battery
      ? strings * blocksPerString * (battery.capacityAh || 0) * (battery.blockVoltage || 0) / 1000
      : null;
    const dcVoltage = battery && battery.blockVoltage ? battery.blockVoltage * blocksPerString : null;
    const payload = {
      source: 'battery-calc',
      selectedAt: Date.now(),
      battery: battery ? {
        id: battery.id, supplier: battery.supplier, model: battery.model,
        type: battery.type,
        chemistry: battery.chemistry, capacityAh: battery.capacityAh,
        blockVoltage: battery.blockVoltage,
      } : null,
      // v0.59.440: extra-поля для расширенного «Расчёт АКБ» в отчёте ИБП.
      mode: params.mode, targetMin: params.targetMin,
      endV: params.endV, invEff: params.invEff,
      derate: calcResult.derate || null,
      strings, blocksPerString, autonomyMin: autonomy,
      totalBlocks: strings * blocksPerString,
      totalKwh, dcVoltage,
    };
    try {
      localStorage.setItem('raschet.upsBatteryReturn.v1', JSON.stringify(payload));
      flash('Готово. Вернитесь на вкладку конфигуратора ИБП и нажмите «Далее → Итог».', 'success');
      setTimeout(() => { try { window.close(); } catch {} }, 2000);
    } catch (e) {
      flash('Не удалось передать результат: ' + (e.message || e), 'error');
    }
  });
  document.getElementById('ups-cancel-battery')?.addEventListener('click', () => {
    try { window.close(); } catch {}
  });
}
