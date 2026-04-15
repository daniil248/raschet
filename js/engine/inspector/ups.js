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
  h.push(field('Выходная мощность, kW', `<input type="number" id="up-capKw" min="0" step="0.1" value="${n.capacityKw}">`));
  h.push(field('КПД, %', `<input type="number" id="up-eff" min="30" max="100" step="1" value="${n.efficiency}">`));
  h.push(field('Входов', `<input type="number" id="up-inputs" min="1" max="5" step="1" value="${n.inputs}">`));
  h.push(field('Выходов', `<input type="number" id="up-outputs" min="1" max="20" step="1" value="${n.outputs}">`));

  // Параметры модульного ИБП
  if (n.upsType === 'modular') {
    h.push('<h4 style="margin:16px 0 8px">Модули</h4>');
    h.push(field('Количество модулей', `<input type="number" id="up-moduleCount" min="1" max="32" step="1" value="${n.moduleCount || 4}">`));
    h.push(field('Мощность одного модуля, kW', `<input type="number" id="up-moduleKw" min="1" step="0.5" value="${n.moduleKw || 25}">`));
    const cap = (n.moduleCount || 4) * (n.moduleKw || 25);
    h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Суммарно: <b>${fmt(cap)} кВт</b> (N×P = capacityKw)</div>`);
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

  h.push('<h4 style="margin:16px 0 8px">Батарея</h4>');
  h.push(field('Ёмкость батареи, kWh', `<input type="number" id="up-battKwh" min="0" step="0.1" value="${n.batteryKwh}">`));
  h.push(field('Заряд батареи, %', `<input type="number" id="up-battPct" min="0" max="100" step="1" value="${n.batteryChargePct}">`));
  h.push(field('Ток заряда, А (AC)', `<input type="number" id="up-chargeA" min="0" step="0.1" value="${n.chargeA ?? 2}">`));
  h.push('<div class="muted" style="font-size:10px;margin-top:-8px">Ток из сети на заряд АКБ.</div>');

  h.push('<h4 style="margin:16px 0 8px">Статический байпас</h4>');
  h.push(`<div class="field check"><input type="checkbox" id="up-bypass"${n.staticBypass !== false ? ' checked' : ''}><label>Байпас разрешён</label></div>`);
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassAuto"${n.staticBypassAuto !== false ? ' checked' : ''}><label>Автоматический (по перегрузу)</label></div>`);
  h.push(field('Порог перехода, % от Pном', `<input type="number" id="up-bypassPct" min="80" max="200" step="5" value="${n.staticBypassOverloadPct || 110}">`));
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassForced"${n.staticBypassForced ? ' checked' : ''}><label>Принудительный байпас</label></div>`);

  body.innerHTML = h.join('');

  const applyBtn = document.getElementById('ups-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('ups-params:' + n.id);
    const upName = document.getElementById('up-name')?.value?.trim();
    if (upName) n.name = upName;
    n.upsType = document.getElementById('up-upsType')?.value || 'monoblock';
    if (n.upsType === 'modular') {
      n.moduleCount = Math.max(1, Number(document.getElementById('up-moduleCount')?.value) || 4);
      n.moduleKw = Math.max(1, Number(document.getElementById('up-moduleKw')?.value) || 25);
      n.capacityKw = n.moduleCount * n.moduleKw;
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
    n.batteryKwh = Number(document.getElementById('up-battKwh')?.value) || 0;
    n.batteryChargePct = Number(document.getElementById('up-battPct')?.value) || 0;
    n.chargeA = Number(document.getElementById('up-chargeA')?.value) || 0;
    n.staticBypass = document.getElementById('up-bypass')?.checked !== false;
    n.staticBypassAuto = document.getElementById('up-bypassAuto')?.checked !== false;
    n.staticBypassOverloadPct = Number(document.getElementById('up-bypassPct')?.value) || 110;
    n.staticBypassForced = !!document.getElementById('up-bypassForced')?.checked;
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

  h.push(`<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px;background:#f5f7fa;border-radius:6px">
    <div>Режим: <b>${onBattery ? 'БАТАРЕЯ' : onBypass ? 'БАЙПАС' : 'ИНВЕРТОР'}</b></div>
    <div>Нагрузка: <b>${fmt(load)} kW / ${fmt(cap)} kW (${loadPct.toFixed(0)}%)</b></div>
    <div>АКБ: <b>${n.batteryChargePct || 0}%</b></div>
  </div>`);

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
    const total = Number(n.moduleCount) || 4;
    if (!Array.isArray(n.modulesActive) || n.modulesActive.length !== total) {
      n.modulesActive = Array(total).fill(true);
    }
    h.push('<div class="ups-modules">');
    for (let i = 0; i < total; i++) {
      const active = n.modulesActive[i] !== false;
      h.push(`<button class="ups-module ${active ? 'on' : 'off'}" data-ups-module="${i}" title="Модуль ${i + 1}">
        M${i + 1}<br><span class="muted">${n.moduleKw || 25} kW</span>
      </button>`);
    }
    h.push('</div>');
    const activeCount = n.modulesActive.filter(v => v !== false).length;
    const totalKw = activeCount * (n.moduleKw || 25);
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px">Активных модулей: <b>${activeCount}/${total}</b> · Суммарная мощность: <b>${totalKw} kW</b></div>`);
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
      render(); notifyChange(); _renderUpsControlBody(n);
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
  parts.push(`<line x1="20" y1="50" x2="80" y2="50" stroke="${mainCol}" stroke-width="3"/>`);
  parts.push(`<text x="20" y="42" font-size="11" fill="#546e7a">AC вход</text>`);
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
  parts.push(`<line x1="100" y1="50" x2="100" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
  parts.push(`<line x1="100" y1="110" x2="440" y2="110" stroke="${bypassCol}" stroke-width="3"/>`);
  parts.push(_svgBreaker(150, 110, 'QF2', qf2on ? bypassCol : colIdle, n.hasInputBypassBreaker !== false));
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
