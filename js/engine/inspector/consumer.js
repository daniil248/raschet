// Инспектор: модалка «Параметры потребителя».
// Выделено из inspector.js. Использует прямые импорты зависимостей.
import { GLOBAL, DEFAULTS, CONSUMER_CATALOG, CONSUMER_CATEGORIES, NODE_H } from '../constants.js';
import { state, uid } from '../state.js';
import { escHtml, escAttr, fmt, field, flash } from '../utils.js';
import { effectiveTag } from '../zones.js';
import { nextFreeTag } from '../graph.js';
import { snapshot, notifyChange } from '../history.js';
import { setEffectiveLoadFactor } from '../modes.js';
import { render } from '../render.js';
import { formatVoltageLevelLabel } from '../electrical.js';

let _renderInspector = null;
export function bindInspectorConsumerDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}

export function openConsumerParamsModal(n) {
  const body = document.getElementById('consumer-params-body');
  if (!body) return;
  const isOutdoor = n.consumerSubtype === 'outdoor_unit';
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="cp-name" value="${escAttr(n.name || '')}">`));

  // Миграция: старые user-записи без category получают 'other'
  const fullCatalog = [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])]
    .map(c => ({ ...c, category: c.category || 'other' }));
  if (!isOutdoor) {
    const curSub = n.consumerSubtype || 'custom';
    const curEntry = fullCatalog.find(c => c.id === curSub);
    const curCat = curEntry ? curEntry.category : 'other';
    // Select категории (функциональное назначение)
    let categoryOpts = '';
    for (const [catId, catDef] of Object.entries(CONSUMER_CATEGORIES)) {
      const count = fullCatalog.filter(c => c.category === catId).length;
      if (count === 0 && catId !== curCat) continue; // скрываем пустые категории
      categoryOpts += `<option value="${catId}"${catId === curCat ? ' selected' : ''}>${catDef.icon} ${escHtml(catDef.label)}${count ? ` (${count})` : ''}</option>`;
    }
    h.push(field('Категория', `<select id="cp-category">${categoryOpts}</select>`));
    // Select типа (фильтруется по выбранной категории)
    let typeOpts = '';
    for (const cat of fullCatalog) {
      if (cat.category !== curCat) continue;
      typeOpts += `<option value="${cat.id}"${cat.id === curSub ? ' selected' : ''}>${escHtml(cat.label)}</option>`;
    }
    h.push(field('Тип потребителя', `<select id="cp-catalog">${typeOpts}</select>`));
  } else {
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px">Наружный блок кондиционера</div>`);
  }

  h.push(field('Количество в группе', `<input type="number" id="cp-count" min="1" max="999" step="1" value="${n.count || 1}">`));
  const _cpCount = Math.max(1, Number(n.count) || 1);
  const _serial = _cpCount > 1 && !!n.serialMode;
  const _loadSpec = (n.loadSpec === 'total') ? 'total' : 'per-unit';
  if (_cpCount > 1) {
    h.push(`<div class="field check"><input type="checkbox" id="cp-serialMode"${n.serialMode ? ' checked' : ''}><label>Последовательное соединение (цепочка)</label></div>`);
    h.push(`<div id="cp-loadSpec-wrap" class="field" style="${_serial ? '' : 'display:none'}">
      <label>Указание нагрузки</label>
      <select id="cp-loadSpec">
        <option value="per-unit"${_loadSpec === 'per-unit' ? ' selected' : ''}>На каждый элемент</option>
        <option value="total"${_loadSpec === 'total' ? ' selected' : ''}>На всю группу</option>
      </select>
    </div>`);
  }
  const _displayDemand = (_serial && _loadSpec === 'total')
    ? (Number(n.demandKw || 0) * _cpCount)
    : Number(n.demandKw || 0);
  const _demandLabel = (_cpCount > 1)
    ? ((_serial && _loadSpec === 'total') ? 'Мощность всей группы, kW' : 'Мощность каждого, kW')
    : 'Установленная мощность, kW';
  h.push(`<div id="cp-demandKw-wrap" class="field">
    <label id="cp-demandKw-label">${_demandLabel}</label>
    <input type="number" id="cp-demandKw" min="0" step="0.1" value="${_displayDemand}">
  </div>`);

  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(levels[i]))}</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="cp-voltage">${vOpts}</select>`));
  const ph = n.phase || '3ph';
  h.push(field('Фазность', `<select id="cp-phase">
    <option value="3ph"${ph === '3ph' ? ' selected' : ''}>3-фазный</option>
    <option value="2ph"${ph === '2ph' ? ' selected' : ''}>2-фазный (split-phase)</option>
    <option value="1ph"${ph === '1ph' || ph === 'A' || ph === 'B' || ph === 'C' ? ' selected' : ''}>1-фазный</option>
  </select>`));
  h.push(field('cos φ', `<input type="number" id="cp-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi ?? 0.92}">`));
  h.push(field('Ки — коэффициент использования', `<input type="number" id="cp-kUse" min="0" max="1" step="0.05" value="${n.kUse ?? 1}">`));
  // Множитель нагрузки в текущем сценарии (нормальный или аварийный режим).
  // 1 = 100%, 0 = не считается, 0.5 = 50%.
  if (state.activeModeId) {
    const curMode = (state.modes || []).find(m => m.id === state.activeModeId);
    const lf = (curMode?.overrides?.[n.id]?.loadFactor);
    const lfVal = typeof lf === 'number' ? lf : 1;
    h.push(field(`Множитель нагрузки (0–3)`,
      `<input type="number" id="cp-loadFactor" min="0" max="3" step="0.1" value="${lfVal}">`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-2px">В текущем сценарии «${escHtml(curMode?.name || '')}». 0 = выключено. Не влияет на другие режимы.</div>`);
  } else {
    const nlf = typeof n.normalLoadFactor === 'number' ? n.normalLoadFactor : 1;
    h.push(field(`Множитель нагрузки (0–3)`,
      `<input type="number" id="cp-normalLoadFactor" min="0" max="3" step="0.1" value="${nlf}">`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-2px">1.0 = номинал, 0.5 = 50%, 0 = выключено.</div>`);
  }
  h.push(field('Кратность пускового тока', `<input type="number" id="cp-inrush" min="1" max="10" step="0.1" value="${n.inrushFactor ?? 1}">`));
  h.push(field('Входов', `<input type="number" id="cp-inputs" min="1" max="2" step="1" value="${Math.min(n.inputs || 1, 2)}">`));
  // Наличие нейтрали (N) и защитного проводника (PE) у этого
  // потребителя. Если флаги не заданы (undefined) — берутся дефолты
  // по системе заземления питающего щита или GLOBAL.earthingSystem.
  // Фазность определяется уровнем напряжения.
  {
    const hasN = (typeof n.hasNeutral === 'boolean') ? n.hasNeutral : null;
    const hasG = (typeof n.hasGround  === 'boolean') ? n.hasGround  : null;
    const triState = (val) => val === null ? 'auto' : (val ? 'on' : 'off');
    h.push('<div class="field"><label style="text-transform:uppercase;font-size:11px;color:#666">Жилы кабеля</label>');
    h.push('<div style="display:flex;gap:8px;flex-wrap:wrap">');
    h.push(`<select id="cp-hasNeutral" style="flex:1">
        <option value="auto"${triState(hasN)==='auto'?' selected':''}>N: авто</option>
        <option value="on"${triState(hasN)==='on'?' selected':''}>N: есть</option>
        <option value="off"${triState(hasN)==='off'?' selected':''}>N: нет</option>
      </select>`);
    h.push(`<select id="cp-hasGround" style="flex:1">
        <option value="auto"${triState(hasG)==='auto'?' selected':''}>PE: авто</option>
        <option value="on"${triState(hasG)==='on'?' selected':''}>PE: есть</option>
        <option value="off"${triState(hasG)==='off'?' selected':''}>PE: нет</option>
      </select>`);
    h.push('</div>');
    h.push('<div class="muted" style="font-size:10px;margin-top:4px">Авто — от системы заземления питающего щита. Фазность берётся из уровня напряжения.</div>');
    h.push('</div>');
  }

  const inputCount = n.inputs || 1;
  if (inputCount > 1) {
    h.push('<div class="field"><label style="text-transform:uppercase;font-size:11px;color:#666">Приоритеты входов</label>');
    h.push('<div style="display:flex;gap:6px;flex-wrap:wrap">');
    for (let i = 0; i < inputCount; i++) {
      const v = (n.priorities && n.priorities[i]) ?? (i + 1);
      h.push(`<div style="text-align:center"><div style="font-size:10px;color:#999;margin-bottom:2px">Вх ${i + 1}</div>`);
      h.push(`<input type="number" id="cp-prio-${i}" min="1" max="99" step="1" value="${v}" style="width:48px;text-align:center;padding:4px">`);
      h.push('</div>');
    }
    h.push('</div>');
    h.push('<div class="muted" style="font-size:10px;margin-top:2px">1 = высший. Равные значения = параллельная работа.</div>');
    h.push('</div>');
  }

  if (!isOutdoor && (n.consumerSubtype === 'conditioner')) {
    h.push('<details class="inspector-section" open>');
    h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Наружный блок</summary>');
    h.push(field('Мощность наружного блока, kW', `<input type="number" id="cp-outdoorKw" min="0" step="0.1" value="${n.outdoorKw || 0.3}">`));
    h.push(field('cos φ наружного блока', `<input type="number" id="cp-outdoorCosPhi" min="0.1" max="1" step="0.01" value="${n.outdoorCosPhi || 0.85}">`));
    if (n.linkedOutdoorId) {
      const outdoor = state.nodes.get(n.linkedOutdoorId);
      if (outdoor) {
        h.push(`<div class="muted" style="font-size:11px">Наружный блок: ${escHtml(effectiveTag(outdoor))} ${escHtml(outdoor.name)}</div>`);
      }
    }
    h.push('</details>');
  }

  if (!isOutdoor) {
    h.push('<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee">');
    h.push('<button type="button" id="cp-save-catalog" style="font-size:11px;padding:4px 8px;border:1px dashed #999;background:#f9f9f9;border-radius:4px;cursor:pointer">+ Сохранить как тип в мою библиотеку</button>');
    h.push('</div>');
  }

  body.innerHTML = h.join('');

  const saveBtn = document.getElementById('cp-save-catalog');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const label = prompt('Название типа потребителя:');
      if (!label) return;
      const id = 'user_' + Date.now();
      const currentCategory = document.getElementById('cp-category')?.value || 'other';
      const entry = {
        id, label,
        category: currentCategory,
        demandKw: Number(document.getElementById('cp-demandKw')?.value) || 10,
        cosPhi: Number(document.getElementById('cp-cosPhi')?.value) || 0.92,
        kUse: Number(document.getElementById('cp-kUse')?.value) ?? 1,
        inrushFactor: Number(document.getElementById('cp-inrush')?.value) || 1,
        phase: '3ph',
      };
      if (!Array.isArray(GLOBAL.customConsumerCatalog)) GLOBAL.customConsumerCatalog = [];
      GLOBAL.customConsumerCatalog.push(entry);
      if (typeof window !== 'undefined' && typeof window.__raschetPersistUserCatalog === 'function') {
        window.__raschetPersistUserCatalog();
      }
      notifyChange();
      openConsumerParamsModal(n);
      flash('Тип сохранён в мою библиотеку');
    });
  }

  // Смена категории → перезаполнить список типов и выбрать первый
  const categorySelect = document.getElementById('cp-category');
  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      const newCat = categorySelect.value;
      const typesInCat = fullCatalog.filter(c => c.category === newCat);
      const typeSel = document.getElementById('cp-catalog');
      if (!typeSel) return;
      typeSel.innerHTML = typesInCat.map(c =>
        `<option value="${c.id}">${escHtml(c.label)}</option>`
      ).join('');
      // Применим первый тип новой категории
      if (typesInCat[0]) {
        typeSel.value = typesInCat[0].id;
        typeSel.dispatchEvent(new Event('change'));
      }
    });
  }

  const catSelect = document.getElementById('cp-catalog');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      const cat = fullCatalog.find(c => c.id === catSelect.value);
      if (!cat) return;
      const demEl = document.getElementById('cp-demandKw');
      const cosEl = document.getElementById('cp-cosPhi');
      const kUseEl = document.getElementById('cp-kUse');
      const inrEl = document.getElementById('cp-inrush');
      if (demEl) demEl.value = cat.demandKw;
      if (cosEl) cosEl.value = cat.cosPhi;
      if (kUseEl) kUseEl.value = cat.kUse;
      if (inrEl) inrEl.value = cat.inrushFactor;
      const wasCond = n.consumerSubtype === 'conditioner';
      const isCond = cat.id === 'conditioner';
      if (wasCond !== isCond) {
        n.consumerSubtype = cat.id;
        if (isCond) {
          n.outdoorKw = cat.outdoorKw || 0.3;
          n.outdoorCosPhi = cat.outdoorCosPhi || 0.85;
        }
        openConsumerParamsModal(n);
      }
    });
  }

  // Live-обновление полей serial/loadSpec
  const serialCb = document.getElementById('cp-serialMode');
  const loadSpecSel = document.getElementById('cp-loadSpec');
  const loadSpecWrap = document.getElementById('cp-loadSpec-wrap');
  const demandInput = document.getElementById('cp-demandKw');
  const demandLabel = document.getElementById('cp-demandKw-label');
  const countInput = document.getElementById('cp-count');
  const updateDemandUi = (prevSerial, prevLoadSpec) => {
    const cnt = Math.max(1, Number(countInput?.value) || 1);
    const serial = !!serialCb?.checked;
    const ls = (loadSpecSel?.value === 'total') ? 'total' : 'per-unit';
    if (loadSpecWrap) loadSpecWrap.style.display = serial ? '' : 'none';
    if (demandLabel) {
      demandLabel.textContent = (cnt > 1)
        ? ((serial && ls === 'total') ? 'Мощность всей группы, kW' : 'Мощность каждого, kW')
        : 'Установленная мощность, kW';
    }
    if (demandInput) {
      const cur = Number(demandInput.value) || 0;
      const wasTotal = !!prevSerial && prevLoadSpec === 'total' && cnt > 1;
      const isTotal = serial && ls === 'total' && cnt > 1;
      if (wasTotal !== isTotal) {
        if (isTotal) demandInput.value = (cur * cnt).toFixed(2).replace(/\.00$/, '');
        else demandInput.value = (cur / cnt).toFixed(2).replace(/\.00$/, '');
      }
    }
  };
  if (serialCb) {
    let _prevSerial = serialCb.checked;
    let _prevLS = loadSpecSel?.value || 'per-unit';
    serialCb.addEventListener('change', () => {
      updateDemandUi(_prevSerial, _prevLS);
      _prevSerial = serialCb.checked;
      _prevLS = loadSpecSel?.value || 'per-unit';
    });
    if (loadSpecSel) {
      loadSpecSel.addEventListener('change', () => {
        updateDemandUi(_prevSerial, _prevLS);
        _prevSerial = serialCb.checked;
        _prevLS = loadSpecSel.value || 'per-unit';
      });
    }
  }

  const applyBtn = document.getElementById('consumer-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('consumer-params:' + n.id);
    const catId = document.getElementById('cp-catalog')?.value || n.consumerSubtype || 'custom';
    const cat = fullCatalog.find(c => c.id === catId);
    n.consumerSubtype = catId;
    const nameInput = document.getElementById('cp-name')?.value?.trim();
    n.name = nameInput || (cat ? cat.label : n.name || 'Потребитель');
    n.count = Number(document.getElementById('cp-count')?.value) || 1;
    n.serialMode = !!document.getElementById('cp-serialMode')?.checked;
    n.loadSpec = (document.getElementById('cp-loadSpec')?.value === 'total') ? 'total' : 'per-unit';
    const _rawDemand = Number(document.getElementById('cp-demandKw')?.value) || 0;
    n.demandKw = (n.serialMode && n.loadSpec === 'total' && n.count > 1)
      ? (_rawDemand / n.count)
      : _rawDemand;
    const vIdx = Number(document.getElementById('cp-voltage')?.value) || 0;
    n.voltageLevelIdx = vIdx;
    if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; }
    n.phase = document.getElementById('cp-phase')?.value || '3ph';
    n.cosPhi = Number(document.getElementById('cp-cosPhi')?.value) || 0.92;
    n.kUse = Number(document.getElementById('cp-kUse')?.value) ?? 1;
    // Множитель нагрузки
    const lfEl = document.getElementById('cp-loadFactor');
    if (lfEl && state.activeModeId) {
      setEffectiveLoadFactor(n, Number(lfEl.value));
    }
    const nlfEl = document.getElementById('cp-normalLoadFactor');
    if (nlfEl) {
      n.normalLoadFactor = Number(nlfEl.value);
    }
    n.inrushFactor = Number(document.getElementById('cp-inrush')?.value) || 1;
    n.inputs = Number(document.getElementById('cp-inputs')?.value) || 1;
    // Флаги hasNeutral / hasGround — tri-state (auto/on/off)
    const hnVal = document.getElementById('cp-hasNeutral')?.value;
    if (hnVal === 'on') n.hasNeutral = true;
    else if (hnVal === 'off') n.hasNeutral = false;
    else delete n.hasNeutral;
    const hgVal = document.getElementById('cp-hasGround')?.value;
    if (hgVal === 'on') n.hasGround = true;
    else if (hgVal === 'off') n.hasGround = false;
    else delete n.hasGround;
    // Устаревшее поле wireCount больше не используется — удаляем на всякий случай
    delete n.wireCount;

    if (!Array.isArray(n.priorities)) n.priorities = [];
    for (let i = 0; i < n.inputs; i++) {
      const el = document.getElementById('cp-prio-' + i);
      n.priorities[i] = el ? (Number(el.value) || (i + 1)) : (i + 1);
    }
    while (n.priorities.length < n.inputs) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = n.inputs;

    if (catId === 'conditioner') {
      n.outdoorKw = Number(document.getElementById('cp-outdoorKw')?.value) || 0.3;
      n.outdoorCosPhi = Number(document.getElementById('cp-outdoorCosPhi')?.value) || 0.85;
      n.outputs = 1;
      if (n.id !== '__preset_edit__' && (!n.linkedOutdoorId || !state.nodes.get(n.linkedOutdoorId))) {
        const outId = uid();
        const outdoor = {
          id: outId, type: 'consumer',
          x: n.x,
          y: n.y + NODE_H + 80,
          ...DEFAULTS.consumer(),
          name: 'Наруж. блок',
          consumerSubtype: 'outdoor_unit',
          demandKw: n.outdoorKw,
          cosPhi: n.outdoorCosPhi,
          linkedIndoorId: n.id,
          inputs: 1, outputs: 0, count: n.count || 1,
        };
        outdoor.tag = nextFreeTag('consumer');
        state.nodes.set(outId, outdoor);
        n.linkedOutdoorId = outId;
        const connId = uid('c');
        state.conns.set(connId, {
          id: connId,
          from: { nodeId: n.id, port: 0 },
          to: { nodeId: outId, port: 0 },
          material: GLOBAL.defaultMaterial,
          insulation: GLOBAL.defaultInsulation,
          installMethod: GLOBAL.defaultInstallMethod,
          ambientC: GLOBAL.defaultAmbient,
          grouping: GLOBAL.defaultGrouping,
          bundling: 'touching',
          lengthM: 5,
        });
      } else {
        const outdoor = state.nodes.get(n.linkedOutdoorId);
        if (outdoor) {
          outdoor.demandKw = n.outdoorKw;
          outdoor.cosPhi = n.outdoorCosPhi;
          outdoor.count = n.count || 1;
        }
      }
    } else if (n.id !== '__preset_edit__') {
      if (n.linkedOutdoorId) {
        const outId = n.linkedOutdoorId;
        for (const c of Array.from(state.conns.values())) {
          if (c.from.nodeId === outId || c.to.nodeId === outId) state.conns.delete(c.id);
        }
        state.nodes.delete(outId);
        n.linkedOutdoorId = null;
      }
      n.outputs = 0;
    }

    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-consumer-params').classList.add('hidden');
      return;
    }
    render();
    if (_renderInspector) _renderInspector();
    notifyChange();
    openConsumerParamsModal(n);
    flash('Параметры обновлены');
  };
  document.getElementById('modal-consumer-params').classList.remove('hidden');
}
