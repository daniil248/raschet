// ======================================================================
// shared/panel-picker.js
// Каскадный пикер щитов (Производитель → Серия → Типоразмер).
// API идентичен battery-picker.js / ups-picker.js — одна и та же логика
// группировки и рендеринга селектов во всех подпрограммах.
// ======================================================================

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Группировка: supplier → series → PanelRecord[]. Серия берётся
// напрямую из поля p.series — не эвристикой.
export function groupPanelsBySupplier(list) {
  const bySup = new Map();
  for (const p of (list || [])) {
    const sup = p.supplier || 'Unknown';
    if (!bySup.has(sup)) bySup.set(sup, new Map());
    const ser = p.series || 'Other';
    const byS = bySup.get(sup);
    if (!byS.has(ser)) byS.set(ser, []);
    byS.get(ser).push(p);
  }
  return bySup;
}

export function buildPanelCascadeOptions(grouped, cur = {}, placeholders = {}) {
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
    for (const p of list) {
      const label = `${p.variant || p.id}${p.inNominal ? ' · ' + p.inNominal + ' А' : ''}${p.sections > 1 ? ' · ' + p.sections + ' секции' : ''}`;
      const selected = cur.modelId === p.id ? ' selected' : '';
      if (cur.modelId === p.id) curMod = p.id;
      modOpts.push(`<option value="${_esc(p.id)}"${selected}>${_esc(label)}</option>`);
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

export function mountPanelPicker(container, opts = {}) {
  if (!container) return null;
  const idSup = (opts.idPrefix || 'pp') + '-supplier';
  const idSer = (opts.idPrefix || 'pp') + '-series';
  const idMod = (opts.idPrefix || 'pp') + '-model';
  const lSup = opts.labels?.supplier ?? 'Производитель';
  const lSer = opts.labels?.series   ?? 'Серия';
  const lMod = opts.labels?.model    ?? 'Типоразмер';

  const state = {
    supplier: opts.currentSupplier || '',
    series:   opts.currentSeries   || '',
    modelId:  opts.selectedId      || '',
  };
  const grouped = groupPanelsBySupplier(opts.list || []);

  if (state.modelId && (!state.supplier || !state.series)) {
    for (const [sup, bySer] of grouped.entries()) {
      for (const [ser, list] of bySer.entries()) {
        if (list.some(p => p.id === state.modelId)) {
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
      buildPanelCascadeOptions(grouped, cur, opts.placeholders);
    state.supplier = effSupplier;
    state.series = effSeries;
    state.modelId = effModelId;
    container.innerHTML = `
      <div class="pp-row" style="display:flex;gap:6px;flex-wrap:wrap">
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
    supEl?.addEventListener('change', () => { state.supplier = supEl.value || ''; state.series = ''; state.modelId = ''; rerender(); emit(); });
    serEl?.addEventListener('change', () => { state.series = serEl.value || ''; state.modelId = ''; rerender(); emit(); });
    modEl?.addEventListener('change', () => { state.modelId = modEl.value || ''; emit(); });
  }

  function emit() {
    if (typeof opts.onChange !== 'function') return;
    const panel = state.modelId ? (opts.list || []).find(p => p.id === state.modelId) || null : null;
    opts.onChange({ ...state, panel });
  }

  rerender();
  return {
    getState: () => ({ ...state }),
    refresh: (newList) => {
      if (Array.isArray(newList)) opts.list = newList;
      const g = groupPanelsBySupplier(opts.list || []);
      grouped.clear();
      for (const [k, v] of g.entries()) grouped.set(k, v);
      rerender();
    },
  };
}

// Применение паспортных данных щита к узлу схемы. Не трогает уже
// настроенные пользователем topology-поля (switchMode, memberIds).
export function applyPanelModel(node, panelRecord) {
  if (!node || !panelRecord) return;
  const p = panelRecord;
  if (Number.isFinite(p.inNominal)) node.capacityA = p.inNominal;
  if (Number.isFinite(p.inputs))    node.inputs = p.inputs;
  if (Number.isFinite(p.outputs))   node.outputs = p.outputs;
  if (p.ipRating) node.ipRating = p.ipRating;
  if (p.form)     node.formRating = p.form;
  node.panelCatalogId = p.id || null;
}
