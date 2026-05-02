// =============================================================================
// cooling/ui/chiller-form.js — форма спецификации чиллера/DX
// =============================================================================
// HTML-форма с tooltips на каждом параметре (правило проекта: любая
// переменная/обозначение → hover-tooltip). Зависит от DOM.
//
// Перенесено из meteo/annual-table.js (renderChillerSpecForm) — модули
// разделены: расчёт оборудования теперь в Cooling Systems.

import { DEFAULT_CHILLER, SYSTEM_TYPES, FC_MODES } from '../calc/chiller-defaults.js';
import { parsePerformanceCurveCsv } from '../calc/chiller-bin-calc.js';
import { escAttr, escHtml } from '../../meteo/util.js';

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
    // v0.60.6 (Phase 22.7): сохранение spec как catalog-элемент kind=climate.
    if (e.target.closest('[data-save-to-catalog]')) {
      try {
        const lib = await import('../../shared/element-library.js');
        const name = prompt('Название изделия для каталога:', `Чиллер ${s.systemType} ${Math.round(s.ratedCapKw || 0)}кВт`);
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
        alert(`✔ Изделие «${name}» сохранено в каталог (kind=climate). Используйте «📥 Из каталога» в других подборах.`);
      } catch (err) {
        alert(`❌ Ошибка сохранения в каталог: ${err.message}`);
      }
      return;
    }
    if (e.target.closest('[data-load-from-catalog]')) {
      try {
        const lib = await import('../../shared/element-library.js');
        const items = lib.listElements({ kind: 'climate' }).filter(el => el.specs?.coolingSpec);
        if (!items.length) {
          alert('В каталоге нет сохранённых cooling-spec элементов. Сначала сохраните spec через «📚 Сохранить в каталог».');
          return;
        }
        const lines = items.map((el, i) => `${i+1}. ${el.name} (${el.specs?.systemType || '?'}, ${Math.round(el.specs?.ratedCapKw || 0)}кВт)`).join('\n');
        const choice = prompt(`Выберите номер изделия:\n\n${lines}`);
        const idx = parseInt(choice, 10) - 1;
        if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return;
        const picked = items[idx];
        onChange({ ...DEFAULT_CHILLER, ...picked.specs.coolingSpec });
        alert(`✔ Загружено: «${picked.name}». Spec заменена.`);
      } catch (err) {
        alert(`❌ Ошибка загрузки: ${err.message}`);
      }
      return;
    }
    if (e.target.closest('[data-clear-perfcurve]')) {
      onChange({ ...s, perfCurve: null });
      return;
    }
    if (e.target.closest('[data-import-perfcurve]')) {
      // Открываем file-picker; парсим CSV; передаём в onChange.
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.csv,text/csv,text/plain';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const { points, error } = parsePerformanceCurveCsv(text);
          if (error) { alert(`❌ Ошибка парсинга CSV: ${error}`); return; }
          onChange({ ...s, perfCurve: points });
          alert(`✔ Импортировано ${points.length} точек performance-curve. T от ${points[0].T}°C до ${points[points.length-1].T}°C. Расчёт capacity/COP теперь использует кривую.`);
        } catch (err) {
          alert(`❌ Не удалось прочитать файл: ${err.message}`);
        }
      };
      inp.click();
      return;
    }
  });
  return wrap;
}
