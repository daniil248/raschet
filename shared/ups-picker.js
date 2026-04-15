// ======================================================================
// shared/ups-picker.js
// Единый модуль доступа к параметрам ИБП для всех подпрограмм: инспектор
// схемы, расчёт АКБ, будущий «Конфигуратор ИБП». Главная идея — все поля
// ИБП хранятся В ОДНОМ МЕСТЕ (на узле схемы либо в будущей записи каталога),
// а модули только читают их через эти хелперы. Это предотвращает дрейф
// данных между модулями и готовит инфраструктуру для каталога ИБП.
//
// Текущий API:
//   readUpsDcParams(node)   — параметры входа АКБ (V_DC min/max, КПД, cos φ)
//   readUpsCapacity(node)   — номинальная / фактическая мощность
//   formatUpsSummary(node)  — однострочное описание ИБП для UI-подсказок
//
// Позже добавится:
//   mountUpsPicker(container, opts)  — каскадный выбор Производитель →
//                                       серия → модель (когда появится
//                                       каталог UPS, аналог battery-picker)
//   applyUpsModel(node, upsRecord)   — применение выбранной модели к узлу
// ======================================================================

// Значения по умолчанию для DC-параметров батарейной цепи ИБП. Совпадают
// с дефолтами в openUpsParamsModal, чтобы «пустые» значения не расходились.
export const UPS_DC_DEFAULTS = Object.freeze({
  vdcMin: 340,   // В — минимальное напряжение на DC-шине инвертора
  vdcMax: 480,   // В — максимальное напряжение на DC-шине инвертора
  efficiency: 95,// % — КПД преобразования DC → AC
  cosPhi: 1.0,   // cos φ нагрузки ИБП при номинальной мощности
});

/**
 * Читает DC-параметры входа батарейной цепи из узла ИБП.
 * Все 4 поля имеют безопасные дефолты, так что результат всегда валиден.
 * @param {Object} node — узел ИБП (state.nodes entry)
 * @returns {{vdcMin:number, vdcMax:number, efficiency:number, cosPhi:number}}
 */
export function readUpsDcParams(node) {
  const n = node || {};
  return {
    vdcMin:     Number(n.batteryVdcMin ?? UPS_DC_DEFAULTS.vdcMin),
    vdcMax:     Number(n.batteryVdcMax ?? UPS_DC_DEFAULTS.vdcMax),
    efficiency: Number(n.efficiency   ?? UPS_DC_DEFAULTS.efficiency),
    cosPhi:     Number(n.cosPhi       ?? UPS_DC_DEFAULTS.cosPhi),
  };
}

/**
 * Возвращает мощность ИБП: номинальную (по паспорту) и текущую расчётную.
 * Для модульных ИБП номинал = min(frameKw, working_modules × module_kw).
 * @param {Object} node
 * @returns {{nominalKw:number, loadKw:number, maxLoadKw:number}}
 */
export function readUpsCapacity(node) {
  const n = node || {};
  return {
    nominalKw: Number(n.capacityKw) || 0,
    loadKw:    Number(n._loadKw)    || 0,
    maxLoadKw: Number(n._maxLoadKw) || 0,
  };
}

/**
 * Короткое описание ИБП для подсказок (hover, placeholder).
 * Пример: «Моноблок · 300 kW · КПД 95% · cos φ 1.00»
 */
export function formatUpsSummary(node) {
  const n = node || {};
  const { nominalKw } = readUpsCapacity(node);
  const { efficiency, cosPhi } = readUpsDcParams(node);
  const type = n.upsType === 'modular' ? 'Модульный' : 'Моноблок';
  return `${type} · ${Math.round(nominalKw)} kW · КПД ${efficiency}% · cos φ ${cosPhi.toFixed(2)}`;
}

// ======================================================================
// Каскадный пикер моделей ИБП (Производитель → Серия → Модель).
// Повторяет API shared/battery-picker.js для единообразия.
// ======================================================================

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Эвристика серии из имени модели UPS:
//   «PowerWave 33»   → «PowerWave»
//   «Galaxy VM 500»  → «Galaxy»
//   «CP100KVA»       → «CP»
//   «DPA500»         → «DPA»
export function extractUpsSeries(model) {
  const s = String(model || '').trim();
  if (!s) return 'Other';
  // Первое слово (до пробела) — обычно серия
  const firstWord = s.match(/^([A-Za-z][A-Za-z-]*)/);
  if (firstWord && firstWord[1] && firstWord[1].length >= 2) return firstWord[1];
  // Иначе префикс до первой цифры
  const m = s.match(/^([A-Za-z][A-Za-z0-9-]*?[A-Za-z])(?=\d)/);
  if (m && m[1]) return m[1];
  return s.slice(0, 4);
}

// Группировка: supplier → series → UpsRecord[]
export function groupUpsesBySupplier(list) {
  const bySup = new Map();
  for (const u of (list || [])) {
    const sup = u.supplier || 'Unknown';
    if (!bySup.has(sup)) bySup.set(sup, new Map());
    const ser = extractUpsSeries(u.model);
    const byS = bySup.get(sup);
    if (!byS.has(ser)) byS.set(ser, []);
    byS.get(ser).push(u);
  }
  return bySup;
}

// Сборка HTML-опций для 3 селектов каскада.
export function buildUpsCascadeOptions(grouped, cur = {}, placeholders = {}) {
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
    for (const u of list) {
      const label = `${u.model}${u.capacityKw ? ' · ' + u.capacityKw + ' kW' : ''}${u.upsType === 'modular' ? ' · модульный' : ''}`;
      const selected = cur.modelId === u.id ? ' selected' : '';
      if (cur.modelId === u.id) curMod = u.id;
      modOpts.push(`<option value="${_esc(u.id)}"${selected}>${_esc(label)}</option>`);
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

// Монтирует каскадный пикер UPS в контейнер. Интерфейс идентичен
// mountBatteryPicker из battery-picker.js.
export function mountUpsPicker(container, opts = {}) {
  if (!container) return null;
  const idSup = (opts.idPrefix || 'up') + '-supplier';
  const idSer = (opts.idPrefix || 'up') + '-series';
  const idMod = (opts.idPrefix || 'up') + '-model';
  const lSup = opts.labels?.supplier ?? 'Производитель';
  const lSer = opts.labels?.series   ?? 'Серия';
  const lMod = opts.labels?.model    ?? 'Модель';

  const state = {
    supplier: opts.currentSupplier || '',
    series:   opts.currentSeries   || '',
    modelId:  opts.selectedId      || '',
  };
  const grouped = groupUpsesBySupplier(opts.list || []);

  // Если selectedId задан — восстанавливаем supplier/series
  if (state.modelId && (!state.supplier || !state.series)) {
    for (const [sup, bySer] of grouped.entries()) {
      for (const [ser, list] of bySer.entries()) {
        if (list.some(u => u.id === state.modelId)) {
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
      buildUpsCascadeOptions(grouped, cur, opts.placeholders);
    state.supplier = effSupplier;
    state.series = effSeries;
    state.modelId = effModelId;
    container.innerHTML = `
      <div class="up-row" style="display:flex;gap:6px;flex-wrap:wrap">
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
    const ups = state.modelId
      ? (opts.list || []).find(u => u.id === state.modelId) || null
      : null;
    opts.onChange({ ...state, ups });
  }

  rerender();
  return {
    getState: () => ({ ...state }),
    refresh: (newList) => {
      if (Array.isArray(newList)) opts.list = newList;
      const g = groupUpsesBySupplier(opts.list || []);
      grouped.clear();
      for (const [k, v] of g.entries()) grouped.set(k, v);
      rerender();
    },
  };
}

// Применение выбранной модели UPS к узлу схемы (обновление полей n.*).
// Поля, зависящие от пользовательской схемы (inputs, voltageLevelIdx),
// НЕ перезатираются, если они уже настроены — берутся только паспортные
// параметры ИБП (capacityKw, efficiency, cosPhi, vdcMin/max, frame/modules).
export function applyUpsModel(node, upsRecord) {
  if (!node || !upsRecord) return;
  const u = upsRecord;
  if (u.upsType) node.upsType = u.upsType;
  if (Number.isFinite(u.capacityKw)) node.capacityKw = u.capacityKw;
  if (u.upsType === 'modular') {
    if (Number.isFinite(u.frameKw))       node.frameKw = u.frameKw;
    if (Number.isFinite(u.moduleKwRated)) node.moduleKwRated = u.moduleKwRated;
    if (Number.isFinite(u.moduleSlots))   node.moduleSlots = u.moduleSlots;

    // Авто-подбор числа установленных модулей. Раньше при применении
    // модели moduleInstalled не трогался и оставался дефолтный 4 (из
    // migration в inspector/ups.js), что для MR33 1200K (12 слотов по
    // 100 кВт) давало номинал 400 кВт вместо 1200. Теперь ставим:
    //   — если у узла уже есть даунстрим-нагрузка: ceil(load/eta/modKw)+1
    //     (N+1 резерв);
    //   — иначе: полное заполнение = ceil(capacityKw / moduleKw), с
    //     cap на moduleSlots.
    const modKw = Number(u.moduleKwRated) || 0;
    const slots = Number(u.moduleSlots)   || 0;
    if (modKw > 0 && slots > 0) {
      const loadKw = Number(node._maxLoadKw || node._loadKw || 0);
      const eff    = (Number(u.efficiency) || 96) / 100;
      let need;
      if (loadKw > 0) {
        need = Math.ceil(loadKw / eff / modKw) + 1;
      } else {
        const capKw = Number(u.capacityKw) || (slots * modKw);
        need = Math.ceil(capKw / modKw);
      }
      need = Math.max(1, Math.min(slots, need));
      node.moduleInstalled = need;
      node.moduleCount     = need; // legacy-поле
    }
  }
  if (Number.isFinite(u.efficiency)) node.efficiency = u.efficiency;
  if (Number.isFinite(u.cosPhi))     node.cosPhi = u.cosPhi;
  if (Number.isFinite(u.vdcMin))     node.batteryVdcMin = u.vdcMin;
  if (Number.isFinite(u.vdcMax))     node.batteryVdcMax = u.vdcMax;
  // Помечаем источник
  node.upsCatalogId = u.id || null;
}
