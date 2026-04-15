// Инспектор и модалки для ИБП: параметры, управление, статус-блок.
// Выделено из inspector.js для поддержки. Использует прямые импорты
// зависимостей (render/history/utils) — инъекция не нужна.
import { GLOBAL } from '../constants.js';
import { escHtml, escAttr, fmt, field, flash } from '../utils.js';
import { effectiveOn } from '../modes.js';
import { effectiveTag } from '../zones.js';
import { nodeVoltage, isThreePhase, computeCurrentA, upsChargeKw } from '../electrical.js';
import { snapshot, notifyChange } from '../history.js';
import { render } from '../render.js';

// forward-объявление — renderInspector устанавливается через bind
let _renderInspector = null;
export function bindInspectorUpsDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}

// ================= Модалка «Параметры ИБП» =================
export function openUpsParamsModal(n) {
  const body = document.getElementById('ups-params-body');
  if (!body) return;
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="up-name" value="${escAttr(n.name || '')}">`));

  h.push('<h4 style="margin:8px 0">Основные параметры</h4>');
  // Тип ИБП
  h.push(field('Тип ИБП', `
    <select id="up-upsType">
      <option value="monoblock"${n.upsType !== 'modular' ? ' selected' : ''}>Моноблок</option>
      <option value="modular"${n.upsType === 'modular' ? ' selected' : ''}>Модульный</option>
    </select>`));
  // Для моноблока — прямое поле мощности. Для модульного — вычисляется ниже.
  if (n.upsType !== 'modular') {
    h.push(field('Выходная мощность, kW', `<input type="number" id="up-capKw" min="0" step="0.1" value="${n.capacityKw}">`));
  }
  h.push(field('КПД, %', `<input type="number" id="up-eff" min="30" max="100" step="1" value="${n.efficiency}">`));
  h.push(field('Входов', `<input type="number" id="up-inputs" min="1" max="5" step="1" value="${n.inputs}">`));
  h.push(field('Выходов', `<input type="number" id="up-outputs" min="1" max="20" step="1" value="${n.outputs}">`));

  // Параметры модульного ИБП: frame + installed + redundancy N+X
  if (n.upsType === 'modular') {
    // Миграция старых полей moduleCount/moduleKw в новую модель, если её ещё нет
    if (n.moduleKwRated == null) n.moduleKwRated = n.moduleKw || 25;
    if (n.moduleSlots == null) n.moduleSlots = Math.max(1, n.moduleCount || 8);
    if (n.moduleInstalled == null) n.moduleInstalled = n.moduleCount || 4;
    if (n.frameKw == null) n.frameKw = n.moduleSlots * n.moduleKwRated;
    if (!n.redundancyScheme) n.redundancyScheme = 'N';

    h.push('<h4 style="margin:16px 0 8px">Модули и резервирование</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Корпус (frame) задаёт максимум системы. Устанавливаемые модули должны помещаться в слоты. Схема N+X означает: X модулей в резерве, рабочих = Установлено − X.</div>');

    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Корпус, kW (frame)', `<input type="number" id="up-frameKw" min="1" step="5" value="${n.frameKw}">`)}</div>`);
    h.push(`<div style="flex:1">${field('Мощность модуля, kW', `<input type="number" id="up-modKwRated" min="1" step="0.5" value="${n.moduleKwRated}">`)}</div>`);
    h.push('</div>');
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Слотов в корпусе', `<input type="number" id="up-slots" min="1" max="32" step="1" value="${n.moduleSlots}">`)}</div>`);
    h.push(`<div style="flex:1">${field('Установлено модулей', `<input type="number" id="up-installed" min="0" max="32" step="1" value="${n.moduleInstalled}">`)}</div>`);
    h.push('</div>');
    h.push(field('Схема резервирования', `
      <select id="up-redund">
        <option value="N"${n.redundancyScheme === 'N' ? ' selected' : ''}>N (без резерва)</option>
        <option value="N+1"${n.redundancyScheme === 'N+1' ? ' selected' : ''}>N+1</option>
        <option value="N+2"${n.redundancyScheme === 'N+2' ? ' selected' : ''}>N+2</option>
      </select>`));

    // Расчёт и предупреждения
    const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
    const working = Math.max(0, (n.moduleInstalled || 0) - redundN);
    const ratedKw = Math.min(n.frameKw || 0, working * (n.moduleKwRated || 0));
    const installedCapKw = (n.moduleInstalled || 0) * (n.moduleKwRated || 0);
    const warnings = [];
    if ((n.moduleInstalled || 0) > (n.moduleSlots || 0)) warnings.push('⚠ Установлено больше, чем слотов');
    if (installedCapKw > (n.frameKw || 0)) warnings.push('⚠ Суммарная мощность модулей превышает корпус');
    if ((n.moduleInstalled || 0) < redundN + 1) warnings.push('⚠ Не хватает модулей для выбранного резервирования');
    h.push(`<div class="muted" style="font-size:11px;line-height:1.7;margin:4px 0 10px;padding:6px 8px;background:#f6f8fa;border-radius:4px">
      Рабочих модулей: <b>${working}</b> × ${fmt(n.moduleKwRated)} kW = <b>${fmt(working * (n.moduleKwRated||0))} kW</b><br>
      В резерве: <b>${redundN}</b> × ${fmt(n.moduleKwRated)} kW = ${fmt(redundN * (n.moduleKwRated||0))} kW<br>
      <b>Номинал ИБП: ${fmt(ratedKw)} kW</b> (min от корпуса ${fmt(n.frameKw)} kW)
      ${warnings.length ? '<br><span style="color:#c62828">' + warnings.join('<br>') + '</span>' : ''}
    </div>`);
  }

  // Состав защитных аппаратов
  h.push('<h4 style="margin:16px 0 8px">Состав защитных аппаратов</h4>');
  h.push('<div class="muted" style="font-size:11px;margin-bottom:6px">Отметьте какие автоматы физически присутствуют в ИБП. Отсутствующие не будут показаны в панели управления.</div>');
  const breakers = [
    ['hasInputBreaker',       'Вводной (QF1)'],
    ['hasInputBypassBreaker', 'Вводной байпаса (QF2)'],
    ['hasOutputBreaker',      'Выходной (QF3)'],
    ['hasBypassBreaker',      'Байпасный — механический ручной (QF4)'],
    ['hasBatteryBreaker',     'Батарейный (QB)'],
  ];
  for (const [flag, label] of breakers) {
    const ch = n[flag] !== false;
    h.push(`<div class="field check"><input type="checkbox" id="up-${flag}"${ch ? ' checked' : ''}><label>${escHtml(label)}</label></div>`);
  }
  // Опциональные номиналы
  h.push('<details><summary style="cursor:pointer;font-size:11px;color:#666;margin-top:6px">Номиналы автоматов (опционально)</summary>');
  const noms = [
    ['inputBreakerIn',       'In QF1 (вводной), A'],
    ['inputBypassBreakerIn', 'In QF2 (вх. байпаса), A'],
    ['outputBreakerIn',      'In QF3 (выходной), A'],
    ['bypassBreakerIn',      'In QF4 (байпас), A'],
    ['batteryBreakerIn',     'In QB (батарея), A'],
  ];
  for (const [key, label] of noms) {
    const v = n[key] ?? '';
    h.push(field(label, `<input type="number" id="up-${key}" min="0" step="1" value="${v}">`));
  }
  h.push('</details>');

  // Напряжение
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(levels[i].label)} (${levels[i].vLL}V)</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="up-voltage">${vOpts}</select>`));
  h.push(field('cos φ', `<input type="number" id="up-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi || 1.0}">`));

  h.push('<h4 style="margin:16px 0 8px">Батарея (АКБ)</h4>');
  h.push('<div class="muted" style="font-size:11px;margin-bottom:6px">Тип и состав блока. Ток заряда — в модалке «Управление ИБП».</div>');
  h.push(field('Тип батарей', `
    <select id="up-battType">
      <option value="lead-acid"${(n.batteryType || 'lead-acid') === 'lead-acid' ? ' selected' : ''}>Свинцово-кислотные (VRLA/AGM), 2 В</option>
      <option value="li-ion"${n.batteryType === 'li-ion' ? ' selected' : ''}>Литий-ионные (LiFePO4), 3.2 В</option>
    </select>`));
  h.push('<div style="display:flex;gap:8px">');
  h.push(`<div style="flex:1">${field('Элементов в блоке', `<input type="number" id="up-battCells" min="1" max="400" step="1" value="${n.batteryCellCount ?? 192}">`)}</div>`);
  h.push(`<div style="flex:1">${field('Напр. элемента, В', `<input type="number" id="up-battCellV" min="0.5" max="5" step="0.1" value="${n.batteryCellVoltage ?? 2.0}">`)}</div>`);
  h.push('</div>');
  h.push('<div style="display:flex;gap:8px">');
  h.push(`<div style="flex:1">${field('Ёмкость элемента, А·ч', `<input type="number" id="up-battAh" min="1" step="1" value="${n.batteryCapacityAh ?? 100}">`)}</div>`);
  h.push(`<div style="flex:1">${field('Параллельных цепочек', `<input type="number" id="up-battStr" min="1" max="16" step="1" value="${n.batteryStringCount ?? 1}">`)}</div>`);
  h.push('</div>');
  // Расчёт напряжения блока и ёмкости
  {
    const cells = Number(n.batteryCellCount ?? 192) || 0;
    const cellV = Number(n.batteryCellVoltage ?? 2.0) || 0;
    const ah = Number(n.batteryCapacityAh ?? 100) || 0;
    const strs = Number(n.batteryStringCount ?? 1) || 1;
    const blockV = cells * cellV;
    const totalAh = ah * strs;
    const kwh = (blockV * totalAh) / 1000;
    h.push(`<div class="muted" style="font-size:11px;line-height:1.7;margin:4px 0 10px;padding:6px 8px;background:#f6f8fa;border-radius:4px">
      Напряжение блока DC: <b>${fmt(blockV)} В</b><br>
      Полная ёмкость: <b>${fmt(totalAh)} А·ч</b> (${strs} × ${fmt(ah)})<br>
      Запас энергии: <b>${fmt(kwh)} kWh</b>
    </div>`);
  }
  // Старые поля (оставлены для обратной совместимости — скрыты)
  h.push(`<input type="hidden" id="up-battKwh" value="${n.batteryKwh ?? 0}">`);
  h.push(field('Заряд батареи, %', `<input type="number" id="up-battPct" min="0" max="100" step="1" value="${n.batteryChargePct ?? 100}">`));

  h.push('<h4 style="margin:16px 0 8px">Статический байпас</h4>');
  // Режим подключения байпасного ввода
  {
    const mode = n.bypassFeedMode || 'jumper';
    h.push(field('Байпасный ввод',
      `<select id="up-bypassMode">
        <option value="jumper"${mode === 'jumper' ? ' selected' : ''}>Перемычка от основного ввода</option>
        <option value="separate"${mode === 'separate' ? ' selected' : ''}>Отдельный кабель</option>
      </select>`));
    if (mode === 'separate') {
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px;color:#1565c0">В режиме «отдельный кабель» у ИБП должно быть ≥ 2 входов: порт 1 — основной, порт 2 — байпасный. Подведите два независимых фидера.</div>');
    } else {
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Байпас питается от того же ввода, что и основной тракт (один кабель на ИБП).</div>');
    }
  }
  h.push(`<div class="field check"><input type="checkbox" id="up-bypass"${n.staticBypass !== false ? ' checked' : ''}><label>Байпас разрешён</label></div>`);
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassAuto"${n.staticBypassAuto !== false ? ' checked' : ''}><label>Автоматический (по перегрузу)</label></div>`);
  h.push(field('Порог перехода, % от Pном', `<input type="number" id="up-bypassPct" min="80" max="200" step="5" value="${n.staticBypassOverloadPct || 110}">`));
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassForced"${n.staticBypassForced ? ' checked' : ''}><label>Принудительный байпас</label></div>`);

  body.innerHTML = h.join('');

  // Живой перерисовщик при смене зависимых селектов (тип ИБП, режим
  // байпаса). Сохраняет все уже введённые видимые поля — иначе ввод
  // сбрасывался бы на дефолты. Никакого snapshot/recalc не делает.
  const snapshotVisibleFields = () => {
    const grab = (id, key, numeric = false, checkbox = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (checkbox) n[key] = !!el.checked;
      else if (numeric) { const v = Number(el.value); if (!Number.isNaN(v)) n[key] = v; }
      else n[key] = el.value;
    };
    grab('up-name', 'name');
    grab('up-capKw', 'capacityKw', true);
    grab('up-eff', 'efficiency', true);
    grab('up-inputs', 'inputs', true);
    grab('up-outputs', 'outputs', true);
    // Модульные поля
    grab('up-frameKw', 'frameKw', true);
    grab('up-modKwRated', 'moduleKwRated', true);
    grab('up-slots', 'moduleSlots', true);
    grab('up-installed', 'moduleInstalled', true);
    grab('up-redund', 'redundancyScheme');
    // Батарея
    grab('up-battType', 'batteryType');
    grab('up-battCells', 'batteryCellCount', true);
    grab('up-battCellV', 'batteryCellVoltage', true);
    grab('up-battAh', 'batteryCapacityAh', true);
    grab('up-battStr', 'batteryStringCount', true);
    grab('up-battPct', 'batteryChargePct', true);
    // Напряжение и cos
    grab('up-cosPhi', 'cosPhi', true);
    // Байпас
    grab('up-bypass', 'staticBypass', false, true);
    grab('up-bypassAuto', 'staticBypassAuto', false, true);
    grab('up-bypassPct', 'staticBypassOverloadPct', true);
    grab('up-bypassForced', 'staticBypassForced', false, true);
    // Флаги автоматов
    for (const flag of ['hasInputBreaker','hasInputBypassBreaker','hasOutputBreaker','hasBypassBreaker','hasBatteryBreaker']) {
      grab('up-' + flag, flag, false, true);
    }
  };
  const upsTypeSel = document.getElementById('up-upsType');
  if (upsTypeSel) {
    upsTypeSel.addEventListener('change', () => {
      snapshotVisibleFields();
      n.upsType = upsTypeSel.value || 'monoblock';
      openUpsParamsModal(n);
    });
  }
  const bypassModeSel = document.getElementById('up-bypassMode');
  if (bypassModeSel) {
    bypassModeSel.addEventListener('change', () => {
      snapshotVisibleFields();
      n.bypassFeedMode = bypassModeSel.value === 'separate' ? 'separate' : 'jumper';
      if (n.bypassFeedMode === 'separate' && (Number(n.inputs) || 0) < 2) {
        n.inputs = 2;
      }
      openUpsParamsModal(n);
    });
  }

  const applyBtn = document.getElementById('ups-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('ups-params:' + n.id);
    const upName = document.getElementById('up-name')?.value?.trim();
    if (upName) n.name = upName;
    n.upsType = document.getElementById('up-upsType')?.value || 'monoblock';
    if (n.upsType === 'modular') {
      n.frameKw = Math.max(1, Number(document.getElementById('up-frameKw')?.value) || 200);
      n.moduleKwRated = Math.max(1, Number(document.getElementById('up-modKwRated')?.value) || 25);
      n.moduleSlots = Math.max(1, Number(document.getElementById('up-slots')?.value) || 8);
      n.moduleInstalled = Math.max(0, Number(document.getElementById('up-installed')?.value) || 0);
      n.redundancyScheme = document.getElementById('up-redund')?.value || 'N';
      const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
      const working = Math.max(0, n.moduleInstalled - redundN);
      n.capacityKw = Math.min(n.frameKw, working * n.moduleKwRated);
      // Синхронизация устаревших полей для обратной совместимости
      n.moduleCount = n.moduleInstalled;
      n.moduleKw = n.moduleKwRated;
    } else {
      n.capacityKw = Number(document.getElementById('up-capKw')?.value) || 0;
    }
    n.efficiency = Number(document.getElementById('up-eff')?.value) || 95;
    n.inputs = Number(document.getElementById('up-inputs')?.value) || 1;
    n.outputs = Number(document.getElementById('up-outputs')?.value) || 1;
    // Флаги состава автоматов
    for (const flag of ['hasInputBreaker','hasInputBypassBreaker','hasOutputBreaker','hasBypassBreaker','hasBatteryBreaker']) {
      n[flag] = document.getElementById('up-' + flag)?.checked !== false;
    }
    // Номиналы автоматов (опциональные)
    for (const key of ['inputBreakerIn','inputBypassBreakerIn','outputBreakerIn','bypassBreakerIn','batteryBreakerIn']) {
      const v = document.getElementById('up-' + key)?.value;
      n[key] = (v === '' || v == null) ? null : (Number(v) || null);
    }
    const vIdx = Number(document.getElementById('up-voltage')?.value) || 0;
    n.voltageLevelIdx = vIdx;
    if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; n.phase = levels[vIdx].phases === 3 ? '3ph' : '1ph'; }
    n.cosPhi = Number(document.getElementById('up-cosPhi')?.value) || 1.0;
    // Новые поля АКБ
    n.batteryType = document.getElementById('up-battType')?.value || 'lead-acid';
    n.batteryCellCount = Math.max(1, Number(document.getElementById('up-battCells')?.value) || 192);
    n.batteryCellVoltage = Number(document.getElementById('up-battCellV')?.value) || 2.0;
    n.batteryCapacityAh = Math.max(1, Number(document.getElementById('up-battAh')?.value) || 100);
    n.batteryStringCount = Math.max(1, Number(document.getElementById('up-battStr')?.value) || 1);
    // Пересчитать batteryKwh из новых полей
    const _blockV = n.batteryCellCount * n.batteryCellVoltage;
    const _totalAh = n.batteryCapacityAh * n.batteryStringCount;
    n.batteryKwh = (_blockV * _totalAh) / 1000;
    n.batteryChargePct = Number(document.getElementById('up-battPct')?.value) || 0;
    // chargeA остаётся на узле, управляется из «Управление ИБП»
    n.staticBypass = document.getElementById('up-bypass')?.checked !== false;
    n.staticBypassAuto = document.getElementById('up-bypassAuto')?.checked !== false;
    n.staticBypassOverloadPct = Number(document.getElementById('up-bypassPct')?.value) || 110;
    n.staticBypassForced = !!document.getElementById('up-bypassForced')?.checked;
    n.bypassFeedMode = document.getElementById('up-bypassMode')?.value === 'separate' ? 'separate' : 'jumper';
    // В режиме 'separate' ИБП должен иметь как минимум 2 входа
    if (n.bypassFeedMode === 'separate' && (Number(n.inputs) || 0) < 2) {
      n.inputs = 2;
    }
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-ups-params').classList.add('hidden');
      return;
    }
    render();
    if (_renderInspector) _renderInspector();
    notifyChange();
    openUpsParamsModal(n);
    flash('Параметры ИБП обновлены');
  };

  document.getElementById('modal-ups-params').classList.remove('hidden');
}

// ================= Модалка «Управление ИБП» =================
export function openUpsControlModal(n) {
  const body = document.getElementById('ups-control-body');
  if (!body) return;
  _renderUpsControlBody(n);
  document.getElementById('modal-ups-control').classList.remove('hidden');
}

function _renderUpsControlBody(n) {
  const body = document.getElementById('ups-control-body');
  if (!body) return;
  const h = [];
  h.push(`<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name || 'ИБП')}</h3>`);
  const cap = Number(n.capacityKw) || 0;
  const load = n._loadKw || 0;
  const loadPct = cap > 0 ? (load / cap * 100) : 0;
  const U = nodeVoltage(n);
  const k3 = isThreePhase(n) ? Math.sqrt(3) : 1;
  const currentA = (kw, cos = 1) => (kw * 1000) / (U * k3 * (cos || 1));
  const eff = Math.max(0.01, (Number(n.efficiency) || 95) / 100);
  const onBypass = !!n._onStaticBypass;
  const onBattery = !!n._onBattery;
  const outA = n._loadA || currentA(load);
  const inA = onBattery ? 0 : (onBypass ? 0 : currentA(load / eff + upsChargeKw(n)));
  const inBypassA = onBypass ? outA : 0;
  const battA = onBattery ? outA : 0;

  const overload = cap > 0 && load > cap;
  const battPctHdr = Math.round(Number(n.batteryChargePct) || 0);
  h.push(`<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px;background:${overload ? '#ffebee' : '#f5f7fa'};border-radius:6px;${overload ? 'border:1px solid #c62828;' : ''}">
    <div>Режим: <b>${onBattery ? 'БАТАРЕЯ' : onBypass ? 'БАЙПАС' : 'ИНВЕРТОР'}</b></div>
    <div>Нагрузка: <b style="${overload ? 'color:#c62828' : ''}">${fmt(load)} kW / ${fmt(cap)} kW (${loadPct.toFixed(0)}%)</b></div>
    <div>АКБ: <b>${battPctHdr}%</b></div>
  </div>`);

  // Предупреждение о перегрузе / недостаточной мощности ИБП
  if (overload) {
    const deficit = load - cap;
    let causeHint = '';
    if (n.upsType === 'modular') {
      const modKw = Number(n.moduleKwRated ?? n.moduleKw) || 0;
      const installed = Number(n.moduleInstalled ?? n.moduleCount) || 0;
      const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
      const activeCount = Array.isArray(n.modulesActive)
        ? n.modulesActive.filter(v => v !== false).length : installed;
      const offCount = installed - activeCount;
      if (offCount > 0) {
        const needMore = modKw > 0 ? Math.ceil(deficit / modKw) : 0;
        causeHint = ` Отключено модулей: <b>${offCount}/${installed}</b>` +
          (redundN > 0 ? ` (из них в резерве ${redundN} по схеме ${n.redundancyScheme})` : '') +
          (needMore > 0 ? `. Для покрытия дефицита нужно включить ещё <b>${needMore}</b> модуль(я) × ${fmt(modKw)} kW.` : '');
      }
    }
    h.push(`<div style="margin-bottom:12px;padding:8px 12px;background:#fff3e0;border:1px solid #ef6c00;border-radius:6px;font-size:12px;line-height:1.7;color:#bf360c">
      ⚠ <b>Недостаточно мощности ИБП</b>: нагрузка ${fmt(load)} kW превышает номинал ${fmt(cap)} kW на <b>${fmt(deficit)} kW</b> (${(loadPct - 100).toFixed(0)} % сверх).
      ${causeHint}
      ${n.staticBypass ? ' При превышении порога авто-байпаса (' + (n.staticBypassOverloadPct || 110) + ' %) ИБП перейдёт на статический байпас.' : ''}
    </div>`);
  }

  h.push(`<div style="background:#fff;border:1px solid #dfe2e8;border-radius:6px;padding:12px;margin-bottom:12px">
    <svg viewBox="0 0 780 220" style="width:100%;height:220px" xmlns="http://www.w3.org/2000/svg">${_upsStructSvg(n, { outA, inA, inBypassA, battA, onBypass, onBattery })}</svg>
  </div>`);

  h.push('<h4 style="margin:12px 0 6px">Защитные аппараты</h4>');
  const brkRow = (key, label, onKey, nominalKey, branchA) => {
    if (n[key] === false) return '';
    const isOn = n[onKey] !== false;
    const nom = n[nominalKey];
    const nomStr = nom ? `${nom} А` : '—';
    return `<div class="ups-ctl-row">
      <div class="ups-ctl-label">${escHtml(label)}</div>
      <div class="ups-ctl-nominal">In: <b>${nomStr}</b></div>
      <div class="ups-ctl-current">Iтек: <b>${fmt(branchA)} А</b></div>
      <button class="ups-ctl-toggle ${isOn ? 'on' : 'off'}" data-ups-brk="${onKey}">${isOn ? 'ВКЛ' : 'ОТКЛ'}</button>
    </div>`;
  };
  h.push('<div class="ups-ctl-grid">');
  h.push(brkRow('hasInputBreaker',       'QF1 · Вводной',           'inputBreakerOn',       'inputBreakerIn',       inA));
  h.push(brkRow('hasInputBypassBreaker', 'QF2 · Вводной байпаса',   'inputBypassBreakerOn', 'inputBypassBreakerIn', inBypassA));
  h.push(brkRow('hasOutputBreaker',      'QF3 · Выходной',          'outputBreakerOn',      'outputBreakerIn',      outA));
  h.push(brkRow('hasBypassBreaker',      'QF4 · Байпас (механ.)',   'bypassBreakerOn',      'bypassBreakerIn',      0));
  h.push(brkRow('hasBatteryBreaker',     'QB · Батарейный',         'batteryBreakerOn',     'batteryBreakerIn',     battA));
  h.push('</div>');

  h.push('<h4 style="margin:16px 0 6px">Статический байпас</h4>');
  h.push(`<div class="ups-ctl-row">
    <div class="ups-ctl-label">Принудительный режим</div>
    <div class="ups-ctl-current">${onBypass ? 'Активен' : 'Неактивен'}</div>
    <button class="ups-ctl-toggle ${n.staticBypassForced ? 'on' : 'off'}" data-ups-flag="staticBypassForced">${n.staticBypassForced ? 'ВКЛ' : 'ОТКЛ'}</button>
  </div>`);
  h.push(`<div class="ups-ctl-row">
    <div class="ups-ctl-label">Авто-переход при перегрузе</div>
    <div class="ups-ctl-current">Порог ${n.staticBypassOverloadPct || 110}%</div>
    <button class="ups-ctl-toggle ${n.staticBypassAuto !== false ? 'on' : 'off'}" data-ups-flag="staticBypassAuto">${n.staticBypassAuto !== false ? 'ВКЛ' : 'ОТКЛ'}</button>
  </div>`);

  if (n.upsType === 'modular') {
    h.push('<h4 style="margin:16px 0 6px">Модули</h4>');
    // Используем новую модель: moduleInstalled/moduleKwRated/redundancyScheme.
    // Падение на moduleCount/moduleKw — для старых схем.
    const total = Number(n.moduleInstalled ?? n.moduleCount) || 4;
    const modKw = Number(n.moduleKwRated ?? n.moduleKw) || 25;
    const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
    if (!Array.isArray(n.modulesActive) || n.modulesActive.length !== total) {
      n.modulesActive = Array(total).fill(true);
    }
    h.push('<div class="ups-modules">');
    for (let i = 0; i < total; i++) {
      const active = n.modulesActive[i] !== false;
      h.push(`<button class="ups-module ${active ? 'on' : 'off'}" data-ups-module="${i}" title="Модуль ${i + 1}">
        M${i + 1}<br><span class="muted">${modKw} kW</span>
      </button>`);
    }
    h.push('</div>');
    const activeCount = n.modulesActive.filter(v => v !== false).length;
    const workingCount = Math.max(0, activeCount - redundN);
    const ratedKw = Math.min(Number(n.frameKw) || (total * modKw), workingCount * modKw);
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px;line-height:1.6">
      Активных модулей: <b>${activeCount}/${total}</b>
      ${redundN > 0 ? ` · Резерв (${n.redundancyScheme}): <b>${Math.min(redundN, activeCount)}</b>` : ''}
      · Рабочих: <b>${workingCount}</b> × ${modKw} kW<br>
      <b>Текущий номинал: ${fmt(ratedKw)} kW</b> (из фрейма ${fmt(n.frameKw || 0)} kW)
    </div>`);
  }

  // Управление АКБ вынесено в отдельную модалку «АКБ» (openUpsBatteryModal)
  // — кнопка в инспекторе между «Управление ИБП» и «Параметры ИБП».
  {
    const pct = Math.round(Number(n.batteryChargePct ?? 100) || 0);
    h.push(`<div class="muted" style="font-size:11px;margin-top:12px;padding:6px 8px;background:#f6f8fa;border-radius:4px">
      🔋 АКБ: <b>${pct}%</b> · Ток заряда: <b>${fmt(n.chargeA ?? 0)} А</b>
      (подробности и управление — в отдельной модалке «АКБ»)
    </div>`);
  }

  body.innerHTML = h.join('');

  body.querySelectorAll('[data-ups-brk]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.upsBrk;
      snapshot('ups-ctl:' + n.id + ':' + key);
      n[key] = !(n[key] !== false);
      render(); notifyChange(); _renderUpsControlBody(n);
    });
  });
  body.querySelectorAll('[data-ups-flag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.upsFlag;
      snapshot('ups-ctl:' + n.id + ':' + key);
      n[key] = !n[key];
      render(); notifyChange(); _renderUpsControlBody(n);
    });
  });
  body.querySelectorAll('[data-ups-module]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.upsModule);
      snapshot('ups-ctl:' + n.id + ':module:' + idx);
      if (!Array.isArray(n.modulesActive)) n.modulesActive = [];
      n.modulesActive[idx] = !(n.modulesActive[idx] !== false);
      // Пересчёт текущего номинала модульного ИБП исходя из активных модулей
      if (n.upsType === 'modular') {
        const modKw = Number(n.moduleKwRated ?? n.moduleKw) || 25;
        const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
        const activeCount = n.modulesActive.filter(v => v !== false).length;
        const working = Math.max(0, activeCount - redundN);
        n.capacityKw = Math.min(Number(n.frameKw) || (activeCount * modKw), working * modKw);
      }
      render(); notifyChange(); _renderUpsControlBody(n);
    });
  });
}

// ================= Модалка «АКБ» =================
// Отдельная модалка для батарей ИБП — вынесено из Control modal
// по запросу: кнопка между «Управление ИБП» и «Параметры ИБП».
export function openUpsBatteryModal(n) {
  const modal = document.getElementById('modal-ups-battery');
  const body = document.getElementById('ups-battery-body');
  if (!modal || !body) return;
  _renderUpsBatteryBody(n);
  modal.classList.remove('hidden');
}

function _renderUpsBatteryBody(n) {
  const body = document.getElementById('ups-battery-body');
  if (!body) return;

  const U = nodeVoltage(n);
  const k3 = isThreePhase(n) ? Math.sqrt(3) : 1;
  const load = n._loadKw || 0;
  const cap = Number(n.capacityKw) || 0;

  const bt = n.batteryType || 'lead-acid';
  const cells = Number(n.batteryCellCount ?? 192) || 0;
  const cellV = Number(n.batteryCellVoltage ?? 2.0) || 0;
  const ah = Number(n.batteryCapacityAh ?? 100) || 0;
  const strs = Number(n.batteryStringCount ?? 1) || 1;
  const blockV = cells * cellV;
  const totalAh = ah * strs;
  const kwh = (blockV * totalAh) / 1000;
  const pctRaw = Number(n.batteryChargePct ?? 100) || 0;
  const pct = Math.round(pctRaw);
  const storedKwh = kwh * pctRaw / 100;
  const loadKw = load > 0 ? load : cap;
  const autonomyMin = loadKw > 0 ? (storedKwh / loadKw * 60) : 0;

  const h = [];
  h.push(`<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name || 'ИБП')} · АКБ</h3>`);

  h.push(`<div class="muted" style="font-size:12px;line-height:1.9;padding:10px 12px;background:#f6f8fa;border-radius:6px;margin-bottom:12px">
    Тип: <b>${bt === 'li-ion' ? 'Li-Ion (LiFePO4)' : 'Свинцово-кислотные (VRLA)'}</b>
    · Напряжение блока DC: <b>${fmt(blockV)} В</b><br>
    Состав: <b>${cells}</b> эл. × <b>${fmt(cellV)} В</b> × <b>${strs}</b> цеп. × <b>${fmt(ah)} А·ч</b><br>
    Полная ёмкость: <b>${fmt(totalAh)} А·ч</b> / <b>${fmt(kwh)} kWh</b><br>
    Заряд: <b>${pct}%</b> → запас <b>${fmt(storedKwh)} kWh</b><br>
    Оценка автономии на нагрузке ${fmt(loadKw)} kW: <b>${autonomyMin > 0 ? fmt(autonomyMin) + ' мин' : '—'}</b>
  </div>`);

  // Ток заряда
  h.push('<h4 style="margin:12px 0 6px">Ток заряда</h4>');
  h.push(`<div class="ups-ctl-row">
    <div class="ups-ctl-label">Ток заряда, А (AC со входа)</div>
    <div class="ups-ctl-current">
      <input type="number" id="ups-batt-chargeA" min="0" step="0.1" value="${n.chargeA ?? 2}" style="width:80px;padding:4px 6px;font:inherit;font-size:12px;text-align:right">
    </div>
    <div class="muted" style="font-size:11px">kW ≈ ${fmt((n.chargeA ?? 2) * U * k3 / 1000)}</div>
  </div>`);

  // Уровень заряда
  h.push('<h4 style="margin:16px 0 6px">Уровень заряда</h4>');
  h.push('<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">');
  h.push(`<label style="font-size:11px;min-width:100px">Заряд, %</label>`);
  h.push(`<input type="range" id="ups-batt-pct" min="0" max="100" step="1" value="${pct}" style="flex:1">`);
  h.push(`<span id="ups-batt-pctLabel" style="font-size:12px;font-weight:600;min-width:42px;text-align:right">${pct}%</span>`);
  h.push('</div>');
  h.push('<div style="display:flex;gap:6px">');
  h.push('<button class="ups-ctl-toggle" data-ups-batt-set="0" style="flex:1">Разряжена</button>');
  h.push('<button class="ups-ctl-toggle" data-ups-batt-set="50" style="flex:1">50%</button>');
  h.push('<button class="ups-ctl-toggle on" data-ups-batt-set="100" style="flex:1">Полная</button>');
  h.push('</div>');

  body.innerHTML = h.join('');

  // Обработчики
  const chargeAInput = document.getElementById('ups-batt-chargeA');
  if (chargeAInput) {
    chargeAInput.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':chargeA');
      n.chargeA = Math.max(0, Number(chargeAInput.value) || 0);
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  }
  const pctSlider = document.getElementById('ups-batt-pct');
  const pctLabel = document.getElementById('ups-batt-pctLabel');
  if (pctSlider) {
    pctSlider.addEventListener('input', () => {
      if (pctLabel) pctLabel.textContent = pctSlider.value + '%';
    });
    pctSlider.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':pct');
      n.batteryChargePct = Math.max(0, Math.min(100, Number(pctSlider.value) || 0));
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  }
  body.querySelectorAll('[data-ups-batt-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('ups-batt:' + n.id + ':pct');
      n.batteryChargePct = Number(btn.dataset.upsBattSet) || 0;
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  });
}

// Структурная схема ИБП (SVG)
function _upsStructSvg(n, flows) {
  const { outA, inA, inBypassA, battA, onBypass, onBattery } = flows;
  const colActive = '#2979ff';
  const colBypass = '#ff9800';
  const colBatt = '#43a047';
  const colIdle = '#cfd4e0';
  const fmtA = (a) => a > 0 ? `${fmt(a)} A` : '';
  const mainCol = (onBypass || onBattery) ? colIdle : colActive;
  const bypassCol = onBypass ? colBypass : colIdle;
  const battCol = onBattery ? colBatt : colIdle;
  const parts = [];
  parts.push('<rect x="0" y="0" width="780" height="220" fill="#fafbfc"/>');
  // Режим подключения байпасного ввода: 'jumper' — перемычка, 'separate' — отдельный кабель
  const bypassSeparate = n.bypassFeedMode === 'separate';
  parts.push(`<line x1="20" y1="50" x2="80" y2="50" stroke="${mainCol}" stroke-width="3"/>`);
  parts.push(`<text x="20" y="42" font-size="11" fill="#546e7a">AC вход${bypassSeparate ? ' 1 (осн.)' : ''}</text>`);
  if (inA > 0) parts.push(`<text x="22" y="66" font-size="10" fill="${mainCol}" font-weight="600">${fmtA(inA)}</text>`);
  const qf1on = n.hasInputBreaker !== false && n.inputBreakerOn !== false;
  parts.push(_svgBreaker(80, 50, 'QF1', qf1on ? mainCol : colIdle, n.hasInputBreaker !== false));
  parts.push(`<line x1="120" y1="50" x2="180" y2="50" stroke="${mainCol}" stroke-width="3"/>`);
  parts.push(`<rect x="180" y="30" width="80" height="40" fill="#fff" stroke="${mainCol}" stroke-width="2" rx="4"/>`);
  parts.push(`<text x="220" y="55" text-anchor="middle" font-size="12" fill="#2b303b">REC =/~</text>`);
  parts.push(`<line x1="260" y1="50" x2="320" y2="50" stroke="${mainCol}" stroke-width="3"/>`);
  parts.push(`<rect x="320" y="30" width="80" height="40" fill="#fff" stroke="${onBattery ? battCol : mainCol}" stroke-width="2" rx="4"/>`);
  parts.push(`<text x="360" y="55" text-anchor="middle" font-size="12" fill="#2b303b">INV ~/=</text>`);
  const qbon = n.hasBatteryBreaker !== false && n.batteryBreakerOn !== false;
  parts.push(`<line x1="290" y1="70" x2="290" y2="140" stroke="${battCol}" stroke-width="3"/>`);
  parts.push(_svgBreaker(290, 140, 'QB', qbon ? battCol : colIdle, n.hasBatteryBreaker !== false, 'down'));
  parts.push(`<rect x="260" y="170" width="60" height="30" fill="#fff" stroke="${battCol}" stroke-width="2" rx="4"/>`);
  parts.push(`<text x="290" y="190" text-anchor="middle" font-size="11" fill="#2b303b">BATT</text>`);
  if (battA > 0) parts.push(`<text x="305" y="105" font-size="10" fill="${battCol}" font-weight="600">${fmtA(battA)}</text>`);
  parts.push(`<line x1="400" y1="50" x2="580" y2="50" stroke="${(onBypass || onBattery) ? (onBypass ? colIdle : battCol) : mainCol}" stroke-width="3"/>`);
  const qf2on = n.hasInputBypassBreaker !== false && n.inputBypassBreakerOn !== false;
  if (bypassSeparate) {
    // Отдельный кабель на байпас — отдельный ввод снизу слева, на отдельной линии
    parts.push(`<line x1="20" y1="130" x2="150" y2="130" stroke="${bypassCol}" stroke-width="3"/>`);
    parts.push(`<text x="20" y="122" font-size="11" fill="#546e7a">AC вход 2 (байпас)</text>`);
    parts.push(_svgBreaker(150, 130, 'QF2', qf2on ? bypassCol : colIdle, n.hasInputBypassBreaker !== false));
    parts.push(`<line x1="190" y1="130" x2="300" y2="130" stroke="${bypassCol}" stroke-width="3"/>`);
    parts.push(`<line x1="300" y1="130" x2="300" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
    parts.push(`<line x1="300" y1="110" x2="440" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
  } else {
    // Перемычка от основного ввода — старая схема
    parts.push(`<line x1="100" y1="50" x2="100" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
    parts.push(`<line x1="100" y1="110" x2="440" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
    parts.push(_svgBreaker(150, 110, 'QF2', qf2on ? bypassCol : colIdle, n.hasInputBypassBreaker !== false));
  }
  parts.push(`<rect x="300" y="95" width="80" height="30" fill="#fff" stroke="${bypassCol}" stroke-width="2" rx="4"/>`);
  parts.push(`<text x="340" y="114" text-anchor="middle" font-size="11" fill="#2b303b">SBS</text>`);
  parts.push(`<line x1="440" y1="110" x2="440" y2="50" stroke="${bypassCol}" stroke-width="3"/>`);
  if (inBypassA > 0) parts.push(`<text x="410" y="85" font-size="10" fill="${bypassCol}" font-weight="600">${fmtA(inBypassA)}</text>`);
  const qf4on = n.hasBypassBreaker !== false && n.bypassBreakerOn !== false;
  if (n.hasBypassBreaker !== false) {
    parts.push(`<line x1="100" y1="180" x2="680" y2="180" stroke="${qf4on ? colBypass : colIdle}" stroke-width="3" stroke-dasharray="4 3"/>`);
    parts.push(`<line x1="100" y1="50" x2="100" y2="180" stroke="${qf4on ? colBypass : colIdle}" stroke-width="3" stroke-dasharray="4 3"/>`);
    parts.push(`<line x1="680" y1="50" x2="680" y2="180" stroke="${qf4on ? colBypass : colIdle}" stroke-width="3" stroke-dasharray="4 3"/>`);
    parts.push(_svgBreaker(370, 180, 'QF4', qf4on ? colBypass : colIdle, true));
  }
  const qf3on = n.hasOutputBreaker !== false && n.outputBreakerOn !== false;
  const outCol = (onBypass || onBattery) ? (onBypass ? bypassCol : battCol) : mainCol;
  parts.push(_svgBreaker(580, 50, 'QF3', qf3on ? outCol : colIdle, n.hasOutputBreaker !== false));
  parts.push(`<line x1="620" y1="50" x2="720" y2="50" stroke="${outCol}" stroke-width="3"/>`);
  parts.push(`<text x="730" y="54" font-size="11" fill="#546e7a">AC выход</text>`);
  if (outA > 0) parts.push(`<text x="630" y="66" font-size="10" fill="${outCol}" font-weight="600">${fmtA(outA)}</text>`);
  return parts.join('');
}

function _svgBreaker(cx, cy, label, color, present /*, orient = 'right' */) {
  if (!present) {
    return `<line x1="${cx - 20}" y1="${cy}" x2="${cx + 20}" y2="${cy}" stroke="${color}" stroke-width="2" stroke-dasharray="2 2"/>
            <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="9" fill="#999">${label}</text>`;
  }
  return `<line x1="${cx - 20}" y1="${cy}" x2="${cx - 8}" y2="${cy}" stroke="${color}" stroke-width="3"/>
          <circle cx="${cx}" cy="${cy}" r="4" fill="#fff" stroke="${color}" stroke-width="2"/>
          <line x1="${cx + 8}" y1="${cy}" x2="${cx + 20}" y2="${cy}" stroke="${color}" stroke-width="3"/>
          <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="10" fill="#546e7a">${label}</text>`;
}

// ================= Статус-блок ИБП (в инспекторе) =================
export function upsStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) {
    parts.push('<span class="badge off">отключён</span>');
  } else if (!n._powered) {
    parts.push('<span class="badge off">без питания</span>');
  } else if (n._onStaticBypass) {
    parts.push('<span class="badge backup">статический байпас</span>');
    parts.push(`<span class="muted">инвертор выключен, реактивная мощность потребителей идёт сквозь ИБП</span>`);
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    parts.push(`на входе: <b>${fmt(n._inputKw)} kW</b> (без потерь)`);
  } else {
    parts.push(n._onBattery
      ? '<span class="badge backup">работа от батареи</span>'
      : '<span class="badge on">работа от сети</span>');
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    if (!n._onBattery) parts.push(`потребление на входе: <b>${fmt(n._inputKw)} kW</b>`);
  }
  const capA = computeCurrentA(n.capacityKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`<b>Номинальный ток: ${fmt(capA)} A</b> (при ${fmt(n.capacityKw)} kW, cos φ = 1)`);

  if (typeof n._powerP === 'number') {
    parts.push(`P акт.: <b>${fmt(n._powerP)} kW</b>`);
    parts.push(`Q реакт.: <b>${fmt(n._powerQ || 0)} kvar</b> ${n._onStaticBypass ? '' : '<span class="muted">(инвертор — 0)</span>'}`);
    parts.push(`S полн.: <b>${fmt(n._powerS || 0)} kVA</b>`);
    parts.push(`cos φ: <b>${n._cosPhi ? n._cosPhi.toFixed(2) : '1.00'}</b> ${n._onStaticBypass ? '<span class="muted">(байпас)</span>' : '<span class="muted">(инвертор)</span>'}`);
  }
  const maxInputKw = Number(n.capacityKw) / Math.max(0.01, (Number(n.efficiency) || 100) / 100) + upsChargeKw(n);
  const maxInputA = computeCurrentA(maxInputKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`макс. потребление на входе: <b>${fmt(maxInputKw)} kW · ${fmt(maxInputA)} A</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на выходе: <b>${fmt(n._ikA / 1000)} кА</b>`);
  const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
  parts.push(`запас батареи: <b>${fmt(battKwh)} kWh</b> (${n.batteryChargePct || 0}%)`);
  if (n._loadKw > 0) {
    const hrs = battKwh / n._loadKw;
    const min = hrs * 60;
    let autTxt;
    if (min >= 600) autTxt = '> 10 ч';
    else if (min >= 60) autTxt = (hrs).toFixed(1) + ' ч';
    else if (min >= 1) autTxt = Math.round(min) + ' мин';
    else autTxt = '< 1 мин';
    parts.push(`автономия при текущей нагрузке: <b>${autTxt}</b>`);
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
