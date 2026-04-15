// ======================================================================
// battery-calc.js — главный UI подпрограммы «Расчёт АКБ».
// Состоит из двух вкладок:
//   1. Справочник АКБ — загрузка XLSX, просмотр/удаление моделей
//   2. Расчёт разряда — выбор АКБ + параметры нагрузки → автономия
// ======================================================================

import { listBatteries, addBattery, removeBattery, clearCatalog, getBattery, makeBatteryId } from './battery-catalog.js';
import { parseBatteryXlsx } from './battery-data-parser.js';
import { calcAutonomy, calcRequiredBlocks } from './battery-discharge.js';
import * as Report from '../shared/report/index.js';
import * as B      from '../shared/report/blocks.js';

// Последнее состояние расчёта АКБ для экспорта отчёта
let lastBatteryCalc = null;
import { mountBatteryPicker, extractBatterySeries } from '../shared/battery-picker.js';
import { KEHUA_S3_BATTERIES } from '../shared/kehua-s3-data.js';

const fmt = (n, d = 2) => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(d);
};
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) { alert(msg); return; }
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
  const list = all.filter(b => {
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
  });
  if (!all.length) {
    wrap.innerHTML = `<div class="empty">Справочник пуст. Загрузите XLSX-файлы через «+ Загрузить» или добавьте запись вручную.</div>`;
    return;
  }
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">По заданным фильтрам ничего не найдено. Попробуйте очистить поиск.</div>`;
    return;
  }
  const h = ['<table class="cat-table">'];
  h.push('<thead><tr><th></th><th>Поставщик</th><th>Модель</th><th>Химия</th><th>Блок</th><th>Ёмкость</th><th>Точек</th><th>Источник</th><th></th></tr></thead>');
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
      <td>${escHtml(b.chemistry || '—')}</td>
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
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm('Удалить эту запись из справочника?')) return;
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
      <label>Химия
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
    if (!type) { alert('Заполните поле «Модель»'); return; }
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
      определяется химия (по имени модели: Li/LFP → li-ion, иначе VRLA),
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

    let html = `<div class="muted" style="font-size:11px;margin-bottom:8px">
      Модель: <b>${escHtml(battery.type)}</b>
      · Поставщик: <b>${escHtml(battery.supplier)}</b>
      · Химия: <b>${escHtml(battery.chemistry || '—')}</b>
      · Напр. блока: <b>${fmt(battery.blockVoltage)} В</b>
      ${battery.capacityAh != null ? '· Ёмкость: <b>' + fmt(battery.capacityAh) + ' А·ч</b>' : ''}
      · Точек: <b>${rows.length}</b>
      · Источник: <b>${escHtml(battery.source || '—')}</b>
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
    bodyEl.innerHTML = html;
    // Отрисовка SVG-графика
    _renderDischargeChart(
      document.getElementById('dtable-chart-wrap'),
      rows, endVs
    );
  }
  modal.classList.add('show');
}

// Рисует SVG-кривые разряда: X = время (log), Y = мощность (log),
// одна кривая на каждое endV. Линия + маркеры точек.
function _renderDischargeChart(mount, rows, endVs) {
  if (!mount) return;
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
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const pMin = Math.min(...allP);
  const pMax = Math.max(...allP);

  // Логарифмические оси для лучшего распределения точек
  const logTMin = Math.log10(tMin);
  const logTMax = Math.log10(tMax);
  const logPMin = Math.log10(pMin);
  const logPMax = Math.log10(pMax);
  const xOf = (t) => padL + ((Math.log10(t) - logTMin) / Math.max(0.001, logTMax - logTMin)) * plotW;
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
  parts.push(`<text x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#1f2430" font-weight="600">Время разряда, мин (log)</text>`);
  parts.push(`<text transform="rotate(-90 16 ${padT + plotH / 2})" x="16" y="${padT + plotH / 2}" text-anchor="middle" fill="#1f2430" font-weight="600">Мощность на блок, W (log)</text>`);

  // Кривые по каждому endV
  endVs.forEach((ev, idx) => {
    const color = palette[idx % palette.length];
    const curve = rows.filter(r => r.endV === ev)
      .filter(r => r.powerW > 0 && r.tMin > 0)
      .sort((a, b) => a.tMin - b.tMin);
    if (!curve.length) return;
    // Линия
    const d = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.tMin).toFixed(1)},${yOf(p.powerW).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
    // Маркеры
    for (const p of curve) {
      parts.push(`<circle cx="${xOf(p.tMin).toFixed(1)}" cy="${yOf(p.powerW).toFixed(1)}" r="3" fill="${color}" stroke="#fff" stroke-width="1"><title>${ev} В · ${p.tMin} мин · ${p.powerW} W</title></circle>`);
    }
  });

  // Легенда справа вверху
  const legendX = W - padR - 110;
  const legendY = padT + 8;
  parts.push(`<rect x="${legendX - 6}" y="${legendY - 12}" width="110" height="${endVs.length * 16 + 8}" fill="#fff" stroke="#e0e3ea" rx="4"/>`);
  endVs.forEach((ev, idx) => {
    const color = palette[idx % palette.length];
    const y = legendY + idx * 16 + 4;
    parts.push(`<line x1="${legendX}" y1="${y}" x2="${legendX + 16}" y2="${y}" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<circle cx="${legendX + 8}" cy="${y}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`);
    parts.push(`<text x="${legendX + 22}" y="${y + 4}" fill="#1f2430">${ev} В/эл</text>`);
  });

  parts.push('</svg>');
  mount.innerHTML = parts.join('');
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
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник АКБ?')) return;
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
function renderBatterySelector() {
  const sel = document.getElementById('calc-battery');
  if (!sel) return;
  const list = listBatteries();
  const cur = sel.value;
  let h = '<option value="">— средняя модель (без таблицы) —</option>';
  for (const b of list) {
    h += `<option value="${escHtml(b.id)}">${escHtml(b.supplier)} · ${escHtml(b.type)} (${fmt(b.blockVoltage)} В / ${b.capacityAh != null ? fmt(b.capacityAh) + ' А·ч' : '—'})</option>`;
  }
  sel.innerHTML = h;
  if (cur) sel.value = cur;
}

// ================= Расчёт =================
function doCalc() {
  const out = document.getElementById('calc-result');
  if (!out) return;
  const get = id => document.getElementById(id);
  const battery = get('calc-battery').value ? getBattery(get('calc-battery').value) : null;
  const chemistry = get('calc-chem').value;
  const loadKw = Number(get('calc-load').value) || 0;
  const dcVoltage = Number(get('calc-dcv').value) || 0;
  const strings = Math.max(1, Number(get('calc-strings').value) || 1);
  const endV = Number(get('calc-endv').value) || 1.75;
  const invEff = Math.max(0.5, Math.min(1, (Number(get('calc-inveff').value) || 94) / 100));
  const mode = get('calc-mode').value;
  const targetMin = Number(get('calc-target').value) || 10;
  const capacityAh = Number(get('calc-capAh').value) || 100;
  const params = { battery, chemistry, loadKw, dcVoltage, strings, endV, invEff, mode, targetMin, capacityAh };

  // Блоков в цепочке определяем из dcVoltage / blockVoltage
  const blockV = battery ? battery.blockVoltage : (Number(get('calc-blockv').value) || 12);
  const blocksPerString = Math.max(1, Math.round(dcVoltage / blockV) || 1);

  let html = '';
  let calcResult = null;
  if (mode === 'autonomy') {
    // Прямая задача: дано — сколько блоков, нагрузка → автономия
    const r = calcAutonomy({
      battery, loadKw, dcVoltage, strings, blocksPerString,
      endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
    });
    calcResult = { kind: 'autonomy', r, blocksPerString };
    html += `<div class="result-block">`;
    html += `<div class="result-title">Автономия системы</div>`;
    html += `<div class="result-value">${Number.isFinite(r.autonomyMin) ? fmt(r.autonomyMin) + ' мин' : '∞'}</div>`;
    html += `<div class="result-sub">Метод: <b>${r.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель'}</b></div>`;
    html += `<div class="result-sub">На блок: <b>${fmt(r.blockPowerW)} W</b>, всего блоков: <b>${strings * blocksPerString}</b> (${strings} × ${blocksPerString})</div>`;
    if (r.warnings.length) html += r.warnings.map(w => `<div class="warn">⚠ ${escHtml(w)}</div>`).join('');
    html += `</div>`;
  } else {
    // Обратная задача: дано — нагрузка + целевое время → сколько блоков
    const found = calcRequiredBlocks({
      battery, loadKw, dcVoltage, endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
      blocksPerString,
      targetMin,
    });
    calcResult = { kind: 'required', found, blocksPerString };
    if (found) {
      html += `<div class="result-block">`;
      html += `<div class="result-title">Минимум блоков для автономии ≥ ${targetMin} мин</div>`;
      html += `<div class="result-value">${found.totalBlocks}</div>`;
      html += `<div class="result-sub">Цепочек: <b>${found.strings}</b> × блоков в цепочке: <b>${found.blocksPerString}</b></div>`;
      html += `<div class="result-sub">Реальная автономия: <b>${fmt(found.result.autonomyMin)} мин</b>, метод: <b>${found.result.method === 'table' ? 'по таблице' : 'среднее'}</b></div>`;
      html += `</div>`;
    } else {
      html += `<div class="result-block error">Не удалось подобрать конфигурацию в пределах 2000 блоков. Проверьте нагрузку / параметры.</div>`;
    }
  }
  out.innerHTML = html;

  // Сохраняем состояние для экспорта отчёта и разблокируем кнопку
  lastBatteryCalc = { params, calcResult };
  const btnRpt = document.getElementById('btn-battery-report');
  if (btnRpt) btnRpt.disabled = !calcResult || (calcResult.kind === 'required' && !calcResult.found);
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
  });
  modeSel.dispatchEvent(new Event('change'));
  const btnRpt = document.getElementById('btn-battery-report');
  if (btnRpt) btnRpt.addEventListener('click', exportBatteryReport);
}

// ================ Экспорт отчёта АКБ ================
async function exportBatteryReport() {
  if (!lastBatteryCalc) {
    alert('Сначала выполните расчёт.');
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
  catch (e) { alert('Не удалось сформировать PDF: ' + (e && e.message ? e.message : e)); }
}

function buildBatteryReportBlocks(state) {
  const p = state.params;
  const r = state.calcResult;
  const batName = p.battery
    ? [p.battery.supplier, p.battery.model].filter(Boolean).join(' ')
    : 'усреднённая модель, химия ' + p.chemistry;
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

  blocks.push(B.hr());
  blocks.push(B.caption('Документ сформирован автоматически.'));
  return blocks;
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
  const list = listBatteries().filter(b => b.chemistry === 'vrla');
  const cur = sel.value;
  let h = '<option value="">— задать габариты вручную —</option>';
  for (const b of list) {
    if (!b.lengthMm && !b.widthMm) continue; // без габаритов не показываем
    h += `<option value="${escHtml(b.id)}">${escHtml(b.supplier)} · ${escHtml(b.type)} (${b.lengthMm}×${b.widthMm}×${b.heightMm} мм, ${b.weightKg || '?'} кг)</option>`;
  }
  sel.innerHTML = h;
  if (cur) sel.value = cur;
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
});
