// ======================================================================
// shared/transformer-picker.js
// Каскадный пикер трансформаторов (Производитель → Серия → Типоразмер).
// API идентичен battery/ups/panel pickers.
// ======================================================================

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function groupTransformersBySupplier(list) {
  const bySup = new Map();
  for (const t of (list || [])) {
    const sup = t.supplier || 'Unknown';
    if (!bySup.has(sup)) bySup.set(sup, new Map());
    const ser = t.series || 'Other';
    const byS = bySup.get(sup);
    if (!byS.has(ser)) byS.set(ser, []);
    byS.get(ser).push(t);
  }
  return bySup;
}

export function buildTransformerCascadeOptions(grouped, cur = {}, placeholders = {}) {
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
    // Сортируем по sKva внутри серии
    const list = [...(grouped.get(curSup).get(curSer) || [])].sort((a, b) => (a.sKva || 0) - (b.sKva || 0));
    for (const t of list) {
      const label = `${t.sKva ? t.sKva + ' кВА' : ''}${t.uhvKv ? ' · ' + t.uhvKv + '/' + ((t.ulvV || 0) / 1000).toFixed(2) + ' кВ' : ''}${t.vectorGroup ? ' · ' + t.vectorGroup : ''}`;
      const selected = cur.modelId === t.id ? ' selected' : '';
      if (cur.modelId === t.id) curMod = t.id;
      modOpts.push(`<option value="${_esc(t.id)}"${selected}>${_esc(label)}</option>`);
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

export function mountTransformerPicker(container, opts = {}) {
  if (!container) return null;
  const idSup = (opts.idPrefix || 'tp') + '-supplier';
  const idSer = (opts.idPrefix || 'tp') + '-series';
  const idMod = (opts.idPrefix || 'tp') + '-model';
  const lSup = opts.labels?.supplier ?? 'Производитель';
  const lSer = opts.labels?.series   ?? 'Серия';
  const lMod = opts.labels?.model    ?? 'Типоразмер';

  const state = {
    supplier: opts.currentSupplier || '',
    series:   opts.currentSeries   || '',
    modelId:  opts.selectedId      || '',
  };
  const grouped = groupTransformersBySupplier(opts.list || []);

  if (state.modelId && (!state.supplier || !state.series)) {
    for (const [sup, bySer] of grouped.entries()) {
      for (const [ser, list] of bySer.entries()) {
        if (list.some(t => t.id === state.modelId)) {
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
      buildTransformerCascadeOptions(grouped, cur, opts.placeholders);
    state.supplier = effSupplier;
    state.series = effSeries;
    state.modelId = effModelId;
    container.innerHTML = `
      <div class="tp-row" style="display:flex;gap:6px;flex-wrap:wrap">
        <label style="flex:1;min-width:140px;font-size:11px;color:#6b7280">${_esc(lSup)}
          <select id="${idSup}" style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${supOpts}</select>
        </label>
        <label style="flex:1;min-width:140px;font-size:11px;color:#6b7280">${_esc(lSer)}
          <select id="${idSer}"${effSupplier ? '' : ' disabled'} style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${serOpts}</select>
        </label>
        <label style="flex:1;min-width:180px;font-size:11px;color:#6b7280">${_esc(lMod)}
          <select id="${idMod}"${effSupplier && effSeries ? '' : ' disabled'} style="width:100%;padding:6px 8px;font:inherit;font-size:12px;border:1px solid #d0d0d0;border-radius:4px;margin-top:2px">${modOpts}</select>
        </label>
      </div>`;
    const supEl = container.querySelector('#' + idSup);
    const serEl = container.querySelector('#' + idSer);
    const modEl = container.querySelector('#' + idMod);
    supEl?.addEventListener('change', () => { state.supplier = supEl.value || ''; state.series = ''; state.modelId = ''; rerender(); emit(); });
    serEl?.addEventListener('change', () => { state.series = serEl.value || ''; state.modelId = ''; rerender(); emit(); });
    modEl?.addEventListener('change', () => { state.modelId = modEl.value || ''; emit(); });
  }

  function emit() {
    if (typeof opts.onChange !== 'function') return;
    const transformer = state.modelId ? (opts.list || []).find(t => t.id === state.modelId) || null : null;
    opts.onChange({ ...state, transformer });
  }

  rerender();
  return {
    getState: () => ({ ...state }),
    refresh: (newList) => {
      if (Array.isArray(newList)) opts.list = newList;
      const g = groupTransformersBySupplier(opts.list || []);
      grouped.clear();
      for (const [k, v] of g.entries()) grouped.set(k, v);
      rerender();
    },
  };
}

/**
 * Расчётный ток КЗ на вторичке трансформатора (упрощённый IEC 60909).
 *   I_k (LV) = S / (√3 × U_LV × u_k)   [A]
 * где S в ВА, U_LV в В, u_k в долях (не процентах).
 * Возвращает { IkA, IratedA } в амперах.
 */
export function computeTransformerIk(record) {
  const S = (Number(record?.sKva) || 0) * 1000; // ВА
  const U = Number(record?.ulvV) || 0;
  const ukPct = Number(record?.ukPct) || 0;
  if (S <= 0 || U <= 0 || ukPct <= 0) return { IkA: 0, IratedA: 0 };
  const Irated = S / (Math.sqrt(3) * U);
  const Ik = Irated / (ukPct / 100);
  return {
    IratedA: Math.round(Irated),
    IkA: Math.round(Ik),
  };
}

/**
 * Применение паспортных данных трансформатора к узлу-источнику главной
 * схемы. Обновляет sourceSubtype, capacityKw (примерно S×cosφ), u_k,
 * потери. Не трогает user-настроенные связи.
 */
export function applyTransformerModel(node, record) {
  if (!node || !record) return;
  const t = record;
  node.sourceSubtype = 'transformer';
  if (Number.isFinite(t.sKva)) node.capacityKva = t.sKva;
  if (Number.isFinite(t.sKva)) node.capacityKw = Math.round(t.sKva * 0.9); // cos φ ≈ 0.9
  if (Number.isFinite(t.uhvKv)) node.primaryVoltage = t.uhvKv * 1000;
  if (Number.isFinite(t.ulvV))  node.voltage = t.ulvV;
  if (Number.isFinite(t.ukPct)) node.ukPct = t.ukPct;
  if (Number.isFinite(t.p0Kw))  node.p0Kw = t.p0Kw;
  if (Number.isFinite(t.pkKw))  node.pkKw = t.pkKw;
  if (t.vectorGroup) node.vectorGroup = t.vectorGroup;
  node.transformerCatalogId = t.id || null;
}
