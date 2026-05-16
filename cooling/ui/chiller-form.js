// =============================================================================
// cooling/ui/chiller-form.js — форма спецификации чиллера/DX
// =============================================================================
// HTML-форма с tooltips на каждом параметре (правило проекта: любая
// переменная/обозначение → hover-tooltip). Зависит от DOM.
//
// Перенесено из meteo/annual-table.js (renderChillerSpecForm) — модули
// разделены: расчёт оборудования теперь в Cooling Systems.
//
// v0.60.20 (Phase 25.2): добавлена кнопка «📥 Импорт даташита (JSON)» с
// in-page модалкой (file-upload + paste-area + preview). Все browser-prompt/
// alert заменены на in-page util.modalOpen / util.toast (правило проекта).

import { DEFAULT_CHILLER, SYSTEM_TYPES, FC_MODES } from '../calc/chiller-defaults.js';
import { parsePerformanceCurveCsv } from '../calc/chiller-bin-calc.js';
import { parseDatasheet, applyDatasheetToSpec, getExampleDatasheet, DATASHEET_SCHEMA } from '../calc/datasheet.js';
import { listDatasheets, listVendors } from '../datasheets/index.js';
import { escAttr, escHtml, modalOpen, toast } from '../../meteo/util.js';

/**
 * @param {object} spec — текущая spec (или null → DEFAULT_CHILLER)
 * @param {function(spec)} onChange   — вызывается при каждом change
 * @param {function()}     onClear    — вызывается при ❌ Сбросить
 * @returns {HTMLElement}
 */
export function renderChillerSpecForm(spec, onChange, onClear) {
  const s = { ...DEFAULT_CHILLER, ...(spec || {}) };
  const wrap = document.createElement('div');
  wrap.className = 'cl-chiller-form';
  const sysType = s.systemType || 'chiller';
  const fcVisible = (sysType === 'chiller');
  const dxFcVisible = (sysType === 'dx-pumped-fc');

  const sysOpts = SYSTEM_TYPES.map(t => `<option value="${escAttr(t.id)}"${t.id === sysType ? ' selected' : ''}>${escHtml(t.label)}</option>`).join('');
  const fcOpts = FC_MODES.map(m => `<option value="${escAttr(m.id)}"${m.id === (s.freeCoolingMode || 'none') ? ' selected' : ''}>${escHtml(m.label)}</option>`).join('');
  const sysDesc = SYSTEM_TYPES.find(t => t.id === sysType)?.desc || '';

  wrap.innerHTML = `
    <h4 title="Спецификация чиллера или DX-системы для расчёта Capacity / COP / Power / Energy по интервалам температуры наружного воздуха. Поддерживает фрикулинг (chiller dry/wet) и pumped refrigerant economizer (DX-FC).">❄ Chiller / DX spec</h4>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">1️⃣ Тип системы и базовые параметры</div>
      <div class="cl-chiller-grid">
        <label title="Тип охлаждающей системы. Определяет применимость фрикулинга.">
          Тип системы:
          <select data-cf="systemType">${sysOpts}</select>
        </label>
        <label title="Rated cooling capacity (Q_rated), кВт. Холодопроизводительность при ratedAmbient.">
          Rated capacity, кВт:<input type="number" step="1" min="0" data-cf="ratedCapKw" value="${s.ratedCapKw}">
        </label>
        <label title="Rated COP = Q_cool / P_elec при ratedAmbient. Типично:
• Чиллер scroll: 3.0–3.5
• Чиллер screw: 3.5–5.0
• Чиллер centrifugal: 5.0–7.0
• DX (RTU): 2.8–3.5
• DX (split inverter): 3.5–4.5">
          Rated COP:<input type="number" step="0.1" min="1" max="10" data-cf="ratedCOP" value="${s.ratedCOP}">
        </label>
        <label title="Rated ambient T (T_rated), °C — условия по которым задан rated. Стандарт ASHRAE = 35°C для air-cooled.">
          Rated ambient T, °C:<input type="number" step="1" data-cf="ambientRated" value="${s.ambientRated}">
        </label>
      </div>
      <p class="cl-chiller-desc" title="Описание выбранного типа системы.">${escHtml(sysDesc)}</p>
    </div>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">2️⃣ Capacity & COP correction по T_amb</div>
      <div class="cl-chiller-grid">
        <label title="Capacity correction (%/°C). Холодопроизводительность снижается с ростом T_amb. Air-cooled: −1.5%/°C; water-cooled: −0.5%/°C. Capacity(T) = ratedCap × (1 + corr × (T − T_rated)).">
          Capacity correction, %/°C:<input type="number" step="0.1" data-cf="capCorrPctPerC" value="${s.capCorrPctPerC}">
        </label>
        <label title="Part-load COP curve:
• IPLV — линейная Carnot-подобная коррекция COP по T_amb.
• Fixed — COP постоянный (упрощённая оценка).">
          COP curve:
          <select data-cf="partLoadCurve">
            <option value="iplv"${s.partLoadCurve === 'iplv' ? ' selected' : ''}>IPLV (T-corrected)</option>
            <option value="fixed"${s.partLoadCurve === 'fixed' ? ' selected' : ''}>Fixed (без T-correction)</option>
          </select>
        </label>
      </div>
    </div>

    <div class="cl-chiller-section" ${fcVisible ? '' : 'style="display:none"'} data-fc-section>
      <div class="cl-chiller-section-title">3️⃣ Free-cooling (только для чиллеров)</div>
      <div class="cl-chiller-grid">
        <label title="Режим фрикулинга:
• none — только мех. охлаждение
• dry — drycooler (T_ref = T_db). Без водопотребления.
• wet — cooling tower (T_ref = T_wb). Эффективнее, требует подпитки.">
          Free-cooling mode:
          <select data-cf="freeCoolingMode">${fcOpts}</select>
        </label>
        <label title="CHWS — Chilled Water Supply temperature, °C. Чем выше — тем больше FC-часов.
• 7°C — стандартный комфорт
• 12°C — тех. охлаждение
• 18–22°C — High-Temp Cooling в ЦОД (ASHRAE TC 9.9 W3/W4)">
          CHWS T, °C:<input type="number" step="0.5" min="2" max="30" data-cf="chwsTemp" value="${s.chwsTemp}">
        </label>
        <label title="Approach (ΔT, °C) между T_ref и CHWS для 100% FC. T_ref ≤ chws−approach → 100%; ≥ chws → 0%; между — partial. Dry: 5°C; Wet: 3°C.">
          Approach ΔT, °C:<input type="number" step="0.5" min="1" max="15" data-cf="freeCoolingApproach" value="${s.freeCoolingApproach}">
        </label>
        <label title="Aux power во время FC, % от ratedCap. Насос вторичного контура + вентиляторы dry cooler / насос градирни. Dry: 5–7%; Wet: 3–5%.">
          Aux power FC, %:<input type="number" step="0.5" min="0" max="20" data-cf="freeCoolingAuxPctOfRated" value="${s.freeCoolingAuxPctOfRated}">
        </label>
      </div>
    </div>

    <div class="cl-chiller-section" ${dxFcVisible ? '' : 'style="display:none"'} data-dxfc-section>
      <div class="cl-chiller-section-title">4️⃣ DX pumped refrigerant FC</div>
      <div class="cl-chiller-grid">
        <label title="Threshold T_amb_db (°C) — ниже которой DX-pumped переходит в режим pumped refrigerant. Обычно T_indoor_supply − 5°C. Для ЦОД (T_supply≈18°C) → 13°C.">
          Threshold T_db, °C:<input type="number" step="0.5" data-cf="dxPumpedThresholdDb" value="${s.dxPumpedThresholdDb}">
        </label>
        <label title="Aux power DX-pumped (% от ratedCap). Мощность насоса хладагента во время FC. Типично 2–4%.">
          Aux power pump, %:<input type="number" step="0.5" min="0" max="10" data-cf="dxPumpedAuxPctOfRated" value="${s.dxPumpedAuxPctOfRated}">
        </label>
      </div>
    </div>

    <div class="cl-chiller-section" data-perfcurve-section>
      <div class="cl-chiller-section-title" title="Реальная performance-curve производителя (Daikin EWAQ, Trane RTAF, Carrier 30XW, Vertiv Liebert, и т.п.). Если задана — заменяет аналитические формулы capacity/COP линейной интерполяцией по T_amb.">5️⃣ Performance-curve производителя (опц.)</div>
      ${(s.perfCurve && s.perfCurve.length) ? `
        <p class="muted" style="font-size:11px;margin:0 0 6px">
          ✔ Задана кривая из ${s.perfCurve.length} точек (T от ${s.perfCurve[0].T}°C до ${s.perfCurve[s.perfCurve.length-1].T}°C). Используется в расчёте вместо формул.
        </p>
      ` : `
        <p class="muted" style="font-size:11px;margin:0 0 6px">
          Не задана — используются аналитические формулы (capacity correction + IPLV COP). Импорт CSV из selection software производителя даёт точный расчёт.
        </p>
      `}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="cl-btn-ghost" data-import-perfcurve
                title="Импорт CSV: заголовок T,capacity,cop (или T,capacity,power) + строки данных. Разделитель , ; или TAB. Минимум 2 точки. Пример: T,capacity,cop\\n−5,160,5.2\\n10,140,4.5\\n25,120,3.8\\n35,100,3.5">📥 Импорт CSV</button>
        ${(s.perfCurve && s.perfCurve.length) ? `<button type="button" class="cl-btn-ghost" data-clear-perfcurve title="Удалить performance-curve, вернуться к аналитическим формулам.">🗑 Очистить кривую</button>` : ''}
      </div>
    </div>

    <div class="cl-chiller-actions" style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" class="cl-btn-ghost" data-pick-datasheet
              title="Выбрать spec из встроенного каталога вендоров (Daikin / York / Carrier / Trane / Stulz / Vertiv). Готовые типичные параметры — заменяет текущую spec.">📚 Готовый даташит</button>
      <button type="button" class="cl-btn-ghost" data-import-datasheet
              title="Импорт полной spec из JSON-даташита производителя (vendor / model / capacity / COP / FC-параметры / performance-curve). Кликните для drag&drop файла, paste JSON или скачивания примера. Формат описан в Справке (❓).">📥 Импорт даташита (JSON)</button>
      <button type="button" class="cl-btn-ghost" data-save-to-catalog
              title="Сохранить эту chiller/DX-spec как «изделие» в каталог проекта (kind=climate). Затем можно использовать в других подборах через «📚 Из каталога», или экспортировать в общий каталог объекта.">📚 Сохранить в каталог</button>
      <button type="button" class="cl-btn-ghost" data-load-from-catalog
              title="Загрузить chiller/DX-spec из каталога — выбрать сохранённый элемент kind=climate с привязанной cooling-spec. Заменяет текущую spec в этом варианте.">📥 Из каталога</button>
      <button type="button" class="cl-btn-ghost" data-clear-chiller title="Сбросить spec и удалить chiller-колонки.">🗑 Сбросить</button>
    </div>
  `;

  wrap.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-cf]');
    if (!inp) return;
    const field = inp.dataset.cf;
    const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    onChange({ ...s, [field]: val });
  });
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-clear-chiller]')) { onClear(); return; }

    // v0.60.20 (Phase 25.2): импорт даташита JSON
    if (e.target.closest('[data-import-datasheet]')) {
      const result = await openDatasheetImportModal();
      if (!result || !result.datasheet) return;
      const newSpec = applyDatasheetToSpec(result.datasheet, s);
      onChange(newSpec);
      const warns = (result.errors && result.errors.length)
        ? ` (с предупреждениями: ${result.errors.length})`
        : '';
      toast(`✔ Spec импортирована из даташита: ${newSpec.name || 'без имени'}${warns}`, 'ok');
      return;
    }
    // v0.60.28 (Phase 25.3): готовые даташиты вендоров
    if (e.target.closest('[data-pick-datasheet]')) {
      const ds = await openVendorDatasheetPicker();
      if (!ds) return;
      const newSpec = applyDatasheetToSpec(ds, s);
      onChange(newSpec);
      toast(`✔ Загружен ${ds.vendor} ${ds.model}`, 'ok');
      return;
    }

    // v0.60.20: catalog-сохранение через in-page модалку (вместо prompt/alert)
    if (e.target.closest('[data-save-to-catalog]')) {
      try {
        const lib = await import('shared/element-library.js');
        const defaultName = `Чиллер ${s.systemType} ${Math.round(s.ratedCapKw || 0)}кВт`;
        const name = await clPromptInline('Название изделия для каталога', defaultName);
        if (!name) return;
        const elId = 'cooling-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        lib.saveElement({
          id: elId,
          kind: 'climate',
          name: name.trim(),
          manufacturer: 'Custom (cooling)',
          specs: {
            coolingSpec: { ...s },
            ratedCapKw: s.ratedCapKw || 0,
            ratedCOP: s.ratedCOP || 0,
            systemType: s.systemType || 'chiller',
          },
          notes: `Сохранено из модуля «Подбор холодильных систем» ${new Date().toLocaleString('ru-RU')}. Тип: ${s.systemType}, rated ${s.ratedCapKw}кВт.`,
        });
        toast(`✔ «${name}» сохранено в каталог (kind=climate). Используйте «📥 Из каталога» в других подборах.`, 'ok');
      } catch (err) {
        toast(`❌ Ошибка сохранения в каталог: ${err.message}`, 'err');
      }
      return;
    }

    if (e.target.closest('[data-load-from-catalog]')) {
      try {
        const lib = await import('shared/element-library.js');
        const items = lib.listElements({ kind: 'climate' }).filter(el => el.specs?.coolingSpec);
        if (!items.length) {
          toast('В каталоге нет cooling-spec изделий. Сохраните spec через «📚 Сохранить в каталог».', 'info');
          return;
        }
        const picked = await clPickerModal('Выбор изделия из каталога', items.map(el => ({
          id: el.id,
          label: `${el.name} — ${el.specs?.systemType || '?'}, ${Math.round(el.specs?.ratedCapKw || 0)} кВт`,
          el,
        })));
        if (!picked) return;
        onChange({ ...DEFAULT_CHILLER, ...picked.el.specs.coolingSpec });
        toast(`✔ Загружено: «${picked.el.name}». Spec заменена.`, 'ok');
      } catch (err) {
        toast(`❌ Ошибка загрузки: ${err.message}`, 'err');
      }
      return;
    }
    if (e.target.closest('[data-clear-perfcurve]')) {
      onChange({ ...s, perfCurve: null });
      return;
    }
    if (e.target.closest('[data-import-perfcurve]')) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.csv,text/csv,text/plain';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const { points, error } = parsePerformanceCurveCsv(text);
          if (error) { toast(`❌ Ошибка парсинга CSV: ${error}`, 'err'); return; }
          onChange({ ...s, perfCurve: points });
          toast(`✔ Импортировано ${points.length} точек performance-curve. T от ${points[0].T}°C до ${points[points.length-1].T}°C.`, 'ok');
        } catch (err) {
          toast(`❌ Не удалось прочитать файл: ${err.message}`, 'err');
        }
      };
      inp.click();
      return;
    }
  });
  return wrap;
}

// =============================================================================
// In-page модалки (заменяют browser prompt/alert по правилу проекта)
// =============================================================================

function clPromptInline(label, def = '') {
  return modalOpen('<h3>Ввод значения</h3>',
    `<label>${escHtml(label)}:<input type="text" id="cl-pi-input" value="${escAttr(def)}" autofocus></label>`,
    async () => ({ value: document.getElementById('cl-pi-input').value })
  ).then(r => r ? r.value : null);
}

function clPickerModal(title, items) {
  const opts = items.map(it => `<option value="${escAttr(it.id)}">${escHtml(it.label)}</option>`).join('');
  return modalOpen(`<h3>${escHtml(title)}</h3>`,
    `<label>Выберите элемент:<select id="cl-pick-sel" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">${opts}</select></label>`,
    async () => {
      const sel = document.getElementById('cl-pick-sel');
      const id = sel?.value;
      const item = items.find(it => it.id === id);
      return item ? { picked: item } : null;
    }
  ).then(r => r ? r.picked : null);
}

/**
 * Phase 25.2: модалка импорта даташита JSON.
 * Возвращает {datasheet, errors[]} или null если отменили.
 */
function openDatasheetImportModal() {
  const example = getExampleDatasheet();
  const body = `
    <p class="muted" style="font-size:12px;margin:0 0 8px" title="Импорт JSON-даташита холодильного оборудования. Поддерживается drag&drop файла или paste JSON в текстовое поле. После «OK» spec в форме будет заменена на распарсенную.">
      Импорт JSON-даташита оборудования (схема <code>${escHtml(DATASHEET_SCHEMA)}</code>).
    </p>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <input type="file" id="cl-ds-file" accept=".json,application/json,text/plain" title="Выберите JSON-файл даташита. Структура описана в кнопке «📋 Пример».">
      <button type="button" id="cl-ds-example" class="cl-btn-ghost" style="font-size:11px;padding:4px 8px" title="Вставить пример JSON в поле ниже — можно использовать как шаблон.">📋 Вставить пример</button>
      <button type="button" id="cl-ds-download" class="cl-btn-ghost" style="font-size:11px;padding:4px 8px" title="Скачать пример datasheet.json — заполните своими параметрами и импортируйте обратно.">⬇ Скачать пример</button>
    </div>
    <label style="display:block;font-size:12px;color:#475569;margin-bottom:4px" title="Содержимое выбранного файла или ваш paste. Парсится при нажатии «OK».">JSON-содержимое:</label>
    <textarea id="cl-ds-text" rows="14" style="width:100%;font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;resize:vertical" placeholder="Вставьте сюда JSON-даташит или выберите файл выше"></textarea>
    <div id="cl-ds-preview" style="margin-top:8px;font-size:11.5px"></div>
  `;
  const promise = modalOpen(
    '<h3>📥 Импорт даташита оборудования</h3>',
    body,
    async (overlay) => {
      const txt = overlay.querySelector('#cl-ds-text')?.value || '';
      if (!txt.trim()) { toast('Поле пустое — вставьте JSON или выберите файл.', 'err'); return null; }
      const res = parseDatasheet(txt);
      if (!res.ok) {
        toast(`❌ Ошибки парсинга: ${res.errors.length}. Смотрите preview ниже.`, 'err');
        const prev = overlay.querySelector('#cl-ds-preview');
        if (prev) prev.innerHTML = renderDsErrors(res.errors);
        return null;
      }
      return { ok: true, datasheet: res.datasheet, errors: res.errors };
    }
  );
  // Wire-up after overlay rendered
  requestAnimationFrame(() => {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    const fileInp = overlay.querySelector('#cl-ds-file');
    const textArea = overlay.querySelector('#cl-ds-text');
    const exampleBtn = overlay.querySelector('#cl-ds-example');
    const downloadBtn = overlay.querySelector('#cl-ds-download');
    const prev = overlay.querySelector('#cl-ds-preview');

    if (fileInp) fileInp.addEventListener('change', async () => {
      const f = fileInp.files?.[0]; if (!f) return;
      try {
        const txt = await f.text();
        if (textArea) textArea.value = txt;
        // Live-preview
        const res = parseDatasheet(txt);
        if (prev) prev.innerHTML = res.ok
          ? renderDsPreview(res.datasheet, res.errors)
          : renderDsErrors(res.errors);
      } catch (err) {
        toast(`Не удалось прочитать файл: ${err.message}`, 'err');
      }
    });
    if (exampleBtn) exampleBtn.addEventListener('click', () => {
      if (textArea) {
        textArea.value = example;
        const res = parseDatasheet(example);
        if (prev) prev.innerHTML = renderDsPreview(res.datasheet, res.errors);
      }
    });
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
      const blob = new Blob([example], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'cooling-datasheet-example.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Пример скачан как cooling-datasheet-example.json', 'ok');
    });
    if (textArea) textArea.addEventListener('input', () => {
      const txt = textArea.value;
      if (!txt.trim()) { if (prev) prev.innerHTML = ''; return; }
      const res = parseDatasheet(txt);
      if (prev) prev.innerHTML = res.ok
        ? renderDsPreview(res.datasheet, res.errors)
        : renderDsErrors(res.errors);
    });
  });
  return promise;
}

function renderDsPreview(ds, warnings) {
  const fields = [
    ['Производитель', ds.vendor],
    ['Модель',       ds.model],
    ['Тип',          ds.systemType || ds.kind],
    ['Rated cap, кВт', ds.ratedCapKw ?? ds.ratedCap ?? ds.capacity],
    ['Rated COP',    ds.ratedCop ?? ds.ratedCOP ?? ds.COP],
    ['Rated ambient, °C', ds.ambientRated],
    ['FC mode',      ds.freeCoolingMode],
    ['Performance-curve, точек', Array.isArray(ds.performanceCurve) ? ds.performanceCurve.length : '—'],
  ];
  const rows = fields.filter(([, v]) => v != null && v !== '').map(([k, v]) =>
    `<tr><td style="color:#64748b">${escHtml(k)}</td><td><b>${escHtml(String(v))}</b></td></tr>`
  ).join('');
  return `
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:3px;padding:6px 10px">
      <div style="color:#065f46;font-weight:600;font-size:12px;margin-bottom:4px" title="Так будут выглядеть основные поля spec после применения даташита.">✔ Preview распарсенных полей</div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px"><tbody>${rows}</tbody></table>
      ${warnings && warnings.length ? `<div style="margin-top:6px;color:#92400e;font-size:11px">⚠ Предупреждений: ${warnings.length}. ${escHtml(warnings.join(' • '))}</div>` : ''}
    </div>
  `;
}

function renderDsErrors(errors) {
  return `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:3px;padding:6px 10px">
      <div style="color:#b91c1c;font-weight:600;font-size:12px;margin-bottom:4px">❌ Ошибки парсинга:</div>
      <ul style="margin:0;padding-left:18px;font-size:11.5px;color:#991b1b">
        ${errors.map(e => `<li>${escHtml(e)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Phase 25.3: picker готовых даташитов вендоров.
 * Возвращает выбранный datasheet или null.
 */
async function openVendorDatasheetPicker() {
  const all = listDatasheets();
  const vendors = listVendors();
  const vendorOpts = ['<option value="">-- Все вендоры --</option>',
    ...vendors.map(v => `<option value="${escAttr(v)}">${escHtml(v)}</option>`),
  ].join('');
  const renderRows = (filterVendor) => {
    const filtered = filterVendor ? all.filter(d => d.vendor === filterVendor) : all;
    return filtered.map((d, idx) => `
      <tr data-idx="${idx}" data-orig-idx="${all.indexOf(d)}" style="cursor:pointer">
        <td>${escHtml(d.vendor)}</td>
        <td>${escHtml(d.model)}</td>
        <td>${escHtml(d.kind)}</td>
        <td class="num">${d.ratedCapKw} кВт</td>
        <td class="num">${d.ratedCop}</td>
        <td>${escHtml(d.freeCoolingMode || '—')}</td>
      </tr>
    `).join('');
  };
  const body = `
    <p class="muted" style="font-size:11.5px;margin:0 0 8px">
      Готовые даташиты от популярных вендоров с типичными параметрами. Кликните на строку — spec будет применена.
      Для проектного использования уточните параметры из официального datasheet производителя на конкретную модель.
    </p>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px">
      Фильтр вендор:
      <select id="vds-vendor-filter" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">${vendorOpts}</select>
    </label>
    <div style="max-height:50vh;overflow:auto;border:1px solid #e2e8f0;border-radius:3px">
      <table class="cl-annual-table" id="vds-table" style="font-size:12px;width:100%">
        <thead>
          <tr><th>Вендор</th><th>Модель</th><th>Тип</th><th class="num">Rated</th><th class="num">COP</th><th>FC</th></tr>
        </thead>
        <tbody>${renderRows(null)}</tbody>
      </table>
    </div>
    <p class="muted" style="font-size:11px;margin-top:6px">Всего ${all.length} даташитов от ${vendors.length} вендоров.</p>
  `;
  // Сначала запускаем modalOpen (создаёт overlay синхронно), затем биндим
  // events в следующем кадре, потом ждём результат.
  const promise = modalOpen(
    '<h3>📚 Готовые даташиты вендоров</h3>',
    body,
    async () => {
      const sel = document.querySelector('#vds-table tr.selected');
      if (!sel) { toast('Выберите даташит из таблицы', 'err'); return null; }
      const idx = Number(sel.dataset.origIdx);
      return all[idx] ? { picked: all[idx] } : null;
    }
  );
  requestAnimationFrame(() => {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    const tbody = overlay.querySelector('#vds-table tbody');
    const filter = overlay.querySelector('#vds-vendor-filter');
    overlay.addEventListener('click', (ev) => {
      const tr = ev.target.closest('#vds-table tbody tr[data-idx]');
      if (!tr) return;
      tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr));
    });
    overlay.addEventListener('dblclick', (ev) => {
      const tr = ev.target.closest('#vds-table tbody tr[data-idx]');
      if (!tr) return;
      tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr));
      overlay.querySelector('.mt-modal-ok')?.click();
    });
    if (filter) filter.addEventListener('change', () => {
      tbody.innerHTML = renderRows(filter.value || null);
    });
  });
  const result = await promise;
  return result?.picked || null;
}
