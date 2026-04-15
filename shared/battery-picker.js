// ======================================================================
// shared/battery-picker.js
// Единый модуль каскадного выбора АКБ (Производитель → Серия → Модель).
// Используется во всех подпрограммах и инспекторах, где нужен подбор
// конкретной батареи из справочника: один и тот же UX, одна логика группировки.
//
// API:
//   extractBatterySeries(type)              — эвристика имени серии
//   groupBatteriesBySupplier(list)          — Map<sup, Map<ser, Battery[]>>
//   buildCascadeOptions(grouped, cur)       — {supOpts, serOpts, modOpts} (HTML)
//   mountBatteryPicker(container, opts)     — монтирует 3 селекта + события
//
// ======================================================================

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Эвристика серии из имени модели.
//   «6-GFM150»     → «6-GFM»
//   «LC-P127R2PG1» → «LC-P»
//   «VP12100/N»    → «VP»
//   «A412/180A»    → «A»
export function extractBatterySeries(type) {
  const s = String(type || '').trim();
  if (!s) return 'Other';
  const m = s.match(/^([A-Za-z0-9-]*?[A-Za-z])(?=\d)/);
  if (m && m[1]) return m[1];
  const onlyLetters = s.match(/^[A-Za-z-]+$/);
  if (onlyLetters) return s;
  return s.slice(0, 4);
}

// Группировка: supplier → series → Battery[]
export function groupBatteriesBySupplier(list) {
  const bySup = new Map();
  for (const b of (list || [])) {
    const sup = b.supplier || 'Unknown';
    if (!bySup.has(sup)) bySup.set(sup, new Map());
    const ser = extractBatterySeries(b.type);
    const byS = bySup.get(sup);
    if (!byS.has(ser)) byS.set(ser, []);
    byS.get(ser).push(b);
  }
  return bySup;
}

// Генерация <option>-ов для 3 селектов каскада.
// cur = { supplier, series, modelId }. Возвращает {supOpts, serOpts, modOpts,
// effSupplier, effSeries, effModelId} с учётом валидации выбранных значений.
// placeholders = { supplier, series, model } — тексты первой опции («все…»
// или «— не выбрано —») в зависимости от режима вызова.
export function buildCascadeOptions(grouped, cur = {}, placeholders = {}) {
  const phSup = placeholders.supplier || '— не выбрано —';
  const phSer = placeholders.series   || '— не выбрано —';
  const phMod = placeholders.model    || '— не выбрано —';

  const curSup = (cur.supplier && grouped.has(cur.supplier)) ? cur.supplier : '';
  const supOpts = [`<option value="">${_esc(phSup)}</option>`];
  for (const sup of [...grouped.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    supOpts.push(`<option value="${_esc(sup)}"${sup === curSup ? ' selected' : ''}>${_esc(sup)}</option>`);
  }

  const serOpts = [`<option value="">${_esc(phSer)}</option>`];
  let curSer = '';
  if (curSup) {
    const series = grouped.get(curSup);
    curSer = (cur.series && series.has(cur.series)) ? cur.series : '';
    for (const ser of [...series.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
      serOpts.push(`<option value="${_esc(ser)}"${ser === curSer ? ' selected' : ''}>${_esc(ser)}</option>`);
    }
  }

  const modOpts = [`<option value="">${_esc(phMod)}</option>`];
  let curMod = '';
  if (curSup && curSer) {
    const list = grouped.get(curSup).get(curSer) || [];
    for (const b of list) {
      const label = b._label || `${b.type}${b.blockVoltage ? ' · ' + b.blockVoltage + ' В' : ''}${b.capacityAh ? ' · ' + b.capacityAh + ' А·ч' : ''}`;
      const selected = cur.modelId === b.id ? ' selected' : '';
      if (cur.modelId === b.id) curMod = b.id;
      modOpts.push(`<option value="${_esc(b.id)}"${selected}>${_esc(label)}</option>`);
    }
  }

  return {
    supOpts: supOpts.join(''),
    serOpts: serOpts.join(''),
    modOpts: modOpts.join(''),
    effSupplier: curSup,
    effSeries: curSer,
    effModelId: curMod,
  };
}

// Монтирует готовый каскадный пикер в контейнер и навешивает события.
// opts = {
//   list,                          // массив батарей
//   selectedId,                    // id предвыбранной модели (или null)
//   currentSupplier, currentSeries,// состояние выбора (для сохранения между rerender)
//   placeholders,                  // {supplier, series, model}
//   labels,                        // {supplier, series, model} — подписи над селектами
//   idPrefix,                      // префикс id для 3 селектов (во избежание коллизий)
//   onChange,                      // (state) => void — state = {supplier, series, modelId, battery}
// }
export function mountBatteryPicker(container, opts = {}) {
  if (!container) return null;
  const idSup = (opts.idPrefix || 'bp') + '-supplier';
  const idSer = (opts.idPrefix || 'bp') + '-series';
  const idMod = (opts.idPrefix || 'bp') + '-model';
  const lSup = opts.labels?.supplier ?? 'Производитель';
  const lSer = opts.labels?.series   ?? 'Серия';
  const lMod = opts.labels?.model    ?? 'Модель';

  const state = {
    supplier: opts.currentSupplier || '',
    series:   opts.currentSeries   || '',
    modelId:  opts.selectedId      || '',
  };
  const grouped = groupBatteriesBySupplier(opts.list || []);

  // При первом монтировании, если modelId есть — вытаскиваем supplier/series
  if (state.modelId && (!state.supplier || !state.series)) {
    for (const [sup, bySer] of grouped.entries()) {
      for (const [ser, list] of bySer.entries()) {
        if (list.some(b => b.id === state.modelId)) {
          state.supplier = state.supplier || sup;
          state.series = state.series || ser;
          break;
        }
      }
    }
  }

  function rerender() {
    const cur = { supplier: state.supplier, series: state.series, modelId: state.modelId };
    const { supOpts, serOpts, modOpts, effSupplier, effSeries, effModelId } =
      buildCascadeOptions(grouped, cur, opts.placeholders);
    state.supplier = effSupplier;
    state.series = effSeries;
    state.modelId = effModelId;
    container.innerHTML = `
      <div class="bp-row" style="display:flex;gap:6px;flex-wrap:wrap">
        <label style="flex:1;min-width:140px;font-size:11px;color:#6b7280">${_esc(lSup)}
          <select id="${idSup}" style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${supOpts}</select>
        </label>
        <label style="flex:1;min-width:140px;font-size:11px;color:#6b7280">${_esc(lSer)}
          <select id="${idSer}"${effSupplier ? '' : ' disabled'} style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${serOpts}</select>
        </label>
        <label style="flex:1;min-width:160px;font-size:11px;color:#6b7280">${_esc(lMod)}
          <select id="${idMod}"${effSupplier && effSeries ? '' : ' disabled'} style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${modOpts}</select>
        </label>
      </div>`;
    const supEl = container.querySelector('#' + idSup);
    const serEl = container.querySelector('#' + idSer);
    const modEl = container.querySelector('#' + idMod);
    supEl?.addEventListener('change', () => {
      state.supplier = supEl.value || '';
      state.series = '';
      state.modelId = '';
      rerender();
      emit();
    });
    serEl?.addEventListener('change', () => {
      state.series = serEl.value || '';
      state.modelId = '';
      rerender();
      emit();
    });
    modEl?.addEventListener('change', () => {
      state.modelId = modEl.value || '';
      emit();
    });
  }

  function emit() {
    if (typeof opts.onChange !== 'function') return;
    const battery = state.modelId
      ? (opts.list || []).find(b => b.id === state.modelId) || null
      : null;
    opts.onChange({ ...state, battery });
  }

  rerender();
  return {
    getState: () => ({ ...state }),
    refresh: (newList) => {
      if (Array.isArray(newList)) opts.list = newList;
      const g = groupBatteriesBySupplier(opts.list || []);
      grouped.clear?.();
      for (const [k, v] of g.entries()) grouped.set(k, v);
      rerender();
    },
  };
}
