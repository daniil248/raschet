// Инспектор связи (линии) и общие хелперы условий прокладки.
// Выделено из inspector.js.
import { GLOBAL, BREAKER_SERIES } from '../constants.js';
import { state, inspectorBody } from '../state.js';
import { escHtml, escAttr, fmt, field, flash } from '../utils.js';
import { effectiveTag } from '../zones.js';
import { cableVoltageClass } from '../electrical.js';
import { snapshot, notifyChange } from '../history.js';
import { render } from '../render.js';
import { deleteConn } from '../graph.js';
import { kTempLookup, kGroupLookup, kBundlingFactor } from '../cable.js';
import { getMethod } from '../../methods/index.js';

let _renderInspector = null;
export function bindInspectorConnDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}
function renderInspector() { if (_renderInspector) _renderInspector(); }

export function buildInstallConditionsBlock(method, bundling, ambientC, grouping, circuits, insulation, propPrefix) {
  const h = [];
  h.push('<details class="inspector-section">');
  h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Условия прокладки</summary>');
  // Способы прокладки из текущей методики
  const cm = getMethod(GLOBAL.calcMethod);
  const methodOpts = Object.entries(cm.installMethods).map(([k, v]) =>
    `<option value="${k}"${method === k ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
  h.push(field('Способ прокладки', `<select ${propPrefix}="installMethod">${methodOpts}</select>`));
  // Укладка из текущей методики
  const bundOpts = cm.hasBundling
    ? Object.entries(cm.bundlingOptions).map(([k, v]) =>
        `<option value="${k}"${bundling === k ? ' selected' : ''}>${escHtml(v)}</option>`).join('')
    : `<option value="touching" selected>Стандарт</option>`;
  h.push(field('Расположение кабелей', `<select ${propPrefix}="bundling">${bundOpts}</select>`));
  // Иконки способа прокладки и расположения
  h.push(`<div style="display:flex;gap:12px;justify-content:center;margin:8px 0">${channelIconSVG(method, 48)}${bundlingIconSVG(bundling, 48)}</div>`);
  h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" ${propPrefix}="ambientC" value="${ambientC || 30}">`));
  h.push(field('Цепей в группе', `<input type="number" min="1" max="50" step="1" ${propPrefix}="grouping" value="${grouping || 1}">`));
  // Коэффициенты
  h.push(installCoefficientBlock(method, ambientC, circuits, bundling, insulation || 'PVC'));
  h.push('</details>');
  return h.join('');
}

// Общая функция: справочные коэффициенты прокладки
// method — IEC метод, ambient — °C, circuits — кол-во цепей, bundling — укладка, insulation — PVC/XLPE
export function installCoefficientBlock(method, ambient, circuits, bundling, insulation) {
  const kt = kTempLookup(ambient || 30, insulation || 'PVC');
  const kg = kGroupLookup(Math.max(1, circuits || 0), method || 'B1');
  const kb = kBundlingFactor(bundling || 'touching');
  const ktotal = kt * kg * kb;
  return `<div class="muted" style="font-size:11px;line-height:1.8;margin-top:6px">` +
    `Kt (темп.) = <b>${kt.toFixed(2)}</b> · ` +
    `Kg (группа, ${circuits || 0} цеп.) = <b>${kg.toFixed(2)}</b> · ` +
    `Kb (укладка) = <b>${kb.toFixed(2)}</b><br>` +
    `<b>Kобщ = ${ktotal.toFixed(3)}</b>` +
    `</div>`;
}

export function renderInspectorConn(c) {
  const fromN = state.nodes.get(c.from.nodeId);
  const toN   = state.nodes.get(c.to.nodeId);
  const h = [];
  const fromTag = effectiveTag(fromN) || fromN?.name || '?';
  const toTag = effectiveTag(toN) || toN?.name || '?';
  const autoLineLabel = `W-${fromTag}-${toTag}`;
  const lineLabel = c.lineLabel || autoLineLabel;
  h.push('<div class="muted" style="font-size:12px;margin-bottom:8px">Линия / связь</div>');
  h.push(`<div class="field"><label>Обозначение</label><div style="font-size:12px;font-weight:600">${escHtml(autoLineLabel)}</div></div>`);
  h.push(`<div class="field"><label>Откуда</label><div>${escHtml(fromTag)} · ${escHtml(fromN?.name || '?')} · выход ${c.from.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Куда</label><div>${escHtml(toTag)} · ${escHtml(toN?.name || '?')} · вход ${c.to.port + 1}</div></div>`);

  const lm = c.lineMode || 'normal';
  h.push(field('Состояние линии',
    `<select data-conn-prop="lineMode">
      <option value="normal"${lm === 'normal' ? ' selected' : ''}>Нормальная</option>
      <option value="damaged"${lm === 'damaged' ? ' selected' : ''}>Повреждена</option>
      <option value="disabled"${lm === 'disabled' ? ' selected' : ''}>Отключена</option>
    </select>`));

  // Режим разрыва (link mode) — линия скрывается, показываются ссылки на концах
  h.push(`<div class="field check"><input type="checkbox" id="cp-linkMode"${c.linkMode ? ' checked' : ''}><label>Скрыть линию (показать ссылками)</label></div>`);
  if (c.linkMode) {
    const previewOn = !!c._linkPreview;
    h.push(`<button type="button" id="cp-link-preview" class="full-btn" style="margin-bottom:8px">${previewOn ? '✓ Скрыть путь' : '👁 Показать путь (пунктир)'}</button>`);
  }

  if (c._state === 'active') {
    h.push('<div class="inspector-section"><h4>Нагрузка линии</h4>');
    const _par = Math.max(1, c._cableParallel || 1);
    const loadPerLine = (c._loadA || 0) / _par;
    const maxPerLine = (c._maxA || 0) / _par;
    const kwPerLine = (c._loadKw || 0) / _par;
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      (_par > 1 ? `Линий: <b>${_par}</b><br>` : '') +
      `Текущая P: <b>${fmt(kwPerLine)} kW</b><br>` +
      `Текущий I: <b>${fmt(loadPerLine)} A</b><br>` +
      `Расчётный I: <b>${fmt(maxPerLine)} A</b> <span class="muted">(по макс. нагрузке)</span><br>` +
      (c._cosPhi ? `cos φ: <b>${c._cosPhi.toFixed(2)}</b><br>` : '') +
      `Напряжение: <b>${c._voltage || '-'} В</b>` +
      (c._ikA && isFinite(c._ikA) ? `<br>Ik в точке: <b>${fmt(c._ikA / 1000)} кА</b>` : '') +
      `</div>`);
    // Блок ПРОВОДНИК — справочная информация
    {
      const hvBadge = c._isHV
        ? ` <span style="font-size:10px;background:#ef6c00;color:#fff;padding:1px 6px;border-radius:3px">ВН · ${escHtml(cableVoltageClass(c._voltage || 0))}</span>`
        : '';
      h.push(`<h4 style="margin:12px 0 6px;font-size:12px">Проводник${hvBadge}</h4>`);
    }
    if (c._cableSize || c._busbarNom || c._cableIz) {
      const par = Math.max(1, c._cableParallel || 1);
      const cores = c._wireCount || (c._threePhase ? 5 : 3);
      let cableSpec = '';
      if (c._busbarNom) {
        cableSpec = `Шинопровод: <b>${c._busbarNom} А</b>`;
      } else if (c._cableSize) {
        const spec = `${cores}×${c._cableSize} мм²`;
        cableSpec = par > 1 ? `Кабель: <b>${spec}</b> (${par} линии)` : `Кабель: <b>${spec}</b>`;
      }
      const effectiveBrkIn = c.manualBreakerIn || c._breakerIn || c._breakerPerLine || 0;
      const Iz = c._cableIz || 0;
      const IzTotal = Iz * par;
      // Координация по полному Iz при параллельных жилах, а не per-line
      const _pm = c.protectionMode || 'full';
      const inLeIz = (_pm === 'sc-only') || !effectiveBrkIn || !IzTotal || effectiveBrkIn <= IzTotal;
      const protOk = inLeIz;
      const oversize = IzTotal > 0 && effectiveBrkIn > 0 && IzTotal > effectiveBrkIn * 2;
      const bgColor = !protOk ? '#ffebee' : oversize ? '#fff8e1' : '#f5f5f5';
      const methodLabel = GLOBAL.calcMethod === 'pue' ? 'ПУЭ' : 'IEC 60364';
      h.push(`<div style="font-size:11px;line-height:1.6;margin-top:4px;padding:6px;background:${bgColor};border-radius:4px">` +
        (cableSpec ? cableSpec + '<br>' : '') +
        (effectiveBrkIn ? `Автомат: <b>${effectiveBrkIn} A</b><br>` : '') +
        (Iz ? `Iдоп на жилу (Iz): <b>${fmt(Iz)} A</b>${par > 1 ? ` · суммарно <b>${fmt(IzTotal)} А</b>` : ''}<br>` : '') +
        (!inLeIz ? '<span style="color:#c62828;font-weight:600">⚠ In > Iz — кабель не защищён автоматом!</span><br>' : '') +
        (oversize ? '<span style="color:#e65100">ℹ Кабель значительно завышен (Iz > 2×In)</span><br>' : '') +
        (c._breakerUndersize ? '<span style="color:#c62828;font-weight:600">⚠ Автомат меньше расчётного тока!</span><br>' : '') +
        (c._ecoSize ? `<span style="color:#0277bd">Экон. плотность: <b>${c._ecoSize} мм²</b> (j<sub>эк</sub>=${c._ecoJek})</span><br>` : '') +
        (c._cableKtotal ? `<span class="muted">K = ${c._cableKtotal.toFixed(3)} (Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span><br>` : '') +
        `<span class="muted">Методика: ${methodLabel}</span>` +
        `</div>`);

      // Справка: как подбирался кабель
      if (GLOBAL.showHelp !== false && c._cableSize) {
        const Iraw = c._maxA || 0;
        const IperNeeded = Iraw / par;
        h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
          <b>Как подбирался кабель:</b><br>
          1) Расчётный ток линии Iрасч = <b>${fmt(Iraw)} А</b><br>
          ${par > 1 ? `2) Параллельных жил — <b>${par}</b>, на жилу Iрасч/n = <b>${fmt(IperNeeded)} А</b><br>` : ''}
          ${_pm !== 'sc-only' && effectiveBrkIn ? `3) Координация с автоматом: Iz·n ≥ In, требуется Iz·n ≥ <b>${effectiveBrkIn} А</b><br>` : ''}
          4) Коэффициенты условий прокладки: Kt=${(c._cableKt||1).toFixed(2)}, Kg=${(c._cableKg||1).toFixed(2)}, K=${(c._cableKtotal||1).toFixed(3)}<br>
          5) Для ${methodLabel} выбрано ближайшее стандартное сечение <b>${c._cableSize} мм²</b>${par > 1 ? ` × ${par}` : ''}, дающее Iz=<b>${fmt(Iz)} А</b>${par > 1 ? ` (суммарно ${fmt(IzTotal)} А)` : ''}<br>
          Правило: Iрасч ≤ Iz·n${_pm !== 'sc-only' ? ' и In ≤ Iz·n' : ''}.
        </div>`);
      }
    }
    h.push('</div>');
  }

  // === Проводник линии ===
  const ct = c.cableType || GLOBAL.defaultCableType;
  const isBusbar = ct === 'busbar';

  h.push('<details class="inspector-section">');
  h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Подбор проводника</summary>');
  h.push(field('Тип проводника',
    `<select data-conn-prop="cableType">
      <option value="multi"${ct === 'multi' ? ' selected' : ''}>Многожильный</option>
      <option value="single"${ct === 'single' ? ' selected' : ''}>Одножильный многопроволочный</option>
      <option value="solid"${ct === 'solid' ? ' selected' : ''}>Цельная жила (класс 1–2, до 10 мм²)</option>
      <option value="busbar"${ct === 'busbar' ? ' selected' : ''}>Шинопровод</option>
    </select>`));
  h.push(field('Длина, м', `<input type="number" min="0" max="10000" step="0.5" data-conn-prop="lengthM" value="${c.lengthM ?? 1}">`));

  if (!isBusbar) {
    // Кабельные параметры — только для кабелей
    const material = c.material || GLOBAL.defaultMaterial;
    h.push(field('Материал жил',
      `<select data-conn-prop="material">
        <option value="Cu"${material === 'Cu' ? ' selected' : ''}>Медь</option>
        <option value="Al"${material === 'Al' ? ' selected' : ''}>Алюминий</option>
      </select>`));
    const insulation = c.insulation || GLOBAL.defaultInsulation;
    h.push(field('Изоляция',
      `<select data-conn-prop="insulation">
        <option value="PVC"${insulation === 'PVC' ? ' selected' : ''}>ПВХ</option>
        <option value="XLPE"${insulation === 'XLPE' ? ' selected' : ''}>СПЭ (XLPE)</option>
      </select>`));
    // Экономическая плотность тока — per-connection
    const ecoChecked = !!c.economicDensity;
    h.push(`<div class="field" style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-conn-prop="economicDensity" ${ecoChecked ? 'checked' : ''}> Расчёт по экон. плотности тока</label></div>`);
    if (ecoChecked) {
      const ecoHours = c.economicHours || 5000;
      h.push(field('Часы макс. нагрузки/год', `<select data-conn-prop="economicHours">
        <option value="3000"${ecoHours <= 3000 ? ' selected' : ''}>До 3000 ч</option>
        <option value="5000"${ecoHours > 3000 && ecoHours <= 5000 ? ' selected' : ''}>3000–5000 ч</option>
        <option value="8000"${ecoHours > 5000 ? ' selected' : ''}>Более 5000 ч</option>
      </select>`));
      if (c._ecoSize) {
        h.push(`<div style="background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;padding:6px;font-size:11px;margin-top:4px">j<sub>эк</sub> = ${c._ecoJek || '?'} А/мм², S<sub>эк</sub> = ${c._ecoSize} мм²</div>`);
      }
    }
  }
  // Секция сечения — ВНУТРИ details "Проводник"
  if ((c._cableSize || c._busbarNom || c._maxA > 0) && !isBusbar) {
    const manualCable = !!c.manualCableSize;
    // Для рекомендации при ручном кабеле — пересчитываем авто
    let autoSize, autoPar, autoIz;
    if (manualCable && c._maxA > 0) {
      const _m = getMethod(GLOBAL.calcMethod);
      const recSel = _m.selectCable(c._maxA || 0, {
        material: c.material || GLOBAL.defaultMaterial,
        insulation: c.insulation || GLOBAL.defaultInsulation,
        method: c._cableMethod || GLOBAL.defaultInstallMethod,
        ambient: c._cableAmbient || GLOBAL.defaultAmbient,
        grouping: c._cableGrouping || GLOBAL.defaultGrouping,
        bundling: c._cableBundling || 'touching',
        cableType: c.cableType || GLOBAL.defaultCableType,
        maxSize: GLOBAL.maxCableSize,
        parallel: c._cableParallel || 1,
      });
      autoSize = recSel.s;
      autoPar = recSel.parallel;
      autoIz = recSel.iDerated;
    } else {
      autoSize = c._cableSize;
      autoPar = c._cableParallel || 1;
      autoIz = c._cableIz || 0;
    }
    const SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
    const typeLabel = { multi: 'многожильный', single: 'одножильный многопр.', solid: 'цельная жила' }[c._cableType || 'multi'] || 'многожильный';
    const bundlingLabel = { spaced: 'с зазором', touching: 'плотно', bundled: 'в пучке' }[c._cableBundling || 'touching'] || 'плотно';

    h.push('<hr style="border:none;border-top:1px solid #e0e3ea;margin:10px 0">');
    // Toggle авто/ручной
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">');
    h.push('<span style="font-size:11px;font-weight:600">Сечение:</span>');
    h.push(`<span style="font-size:10px;color:${!manualCable ? '#4caf50' : '#999'}">авто</span>`);
    h.push(`<div data-cable-mode-toggle style="position:relative;width:36px;height:18px;border-radius:9px;background:${manualCable ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`);
    h.push(`<div style="position:absolute;top:2px;${manualCable ? 'right:2px' : 'left:2px'};width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></div>`);
    h.push('</div>');
    h.push(`<span style="font-size:10px;color:${manualCable ? '#e65100' : '#999'}">ручной</span>`);
    h.push('</div>');

    if (manualCable) {
      const mSize = c.manualCableSize || autoSize || 240;
      const mPar = c.manualCableParallel || autoPar || 1;
      let sizeOpts = '';
      for (const s of SECTIONS) sizeOpts += `<option value="${s}"${s === mSize ? ' selected' : ''}>${s} мм²</option>`;
      h.push('<div style="display:flex;gap:8px">');
      h.push('<div style="flex:1">' + field('Сечение', `<select data-conn-prop="manualCableSize">${sizeOpts}</select>`) + '</div>');
      h.push('<div style="flex:1">' + field('Параллельных', `<input type="number" data-conn-prop="manualCableParallel" min="1" max="20" step="1" value="${mPar}">`) + '</div>');
      h.push('</div>');
      // Подсказка с рекомендацией
      if (autoSize) {
        const recSpec = autoPar > 1 ? `${autoPar}×${autoSize} мм²` : `${autoSize} мм²`;
        h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;line-height:1.6">` +
          `Рекомендация: <b>${recSpec}</b><br>` +
          `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b>, ${typeLabel}<br>` +
          `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b>, t=${c._cableAmbient}°C, группа=${c._cableGrouping}<br>` +
          `Iдоп на жилу: <b>${fmt(autoIz)} A</b>` +
          (autoPar > 1 ? `<br>⚠ Авто-параллель: ${autoPar} линий (одиночная ${GLOBAL.maxCableSize} мм² не проходит)` : '') +
          (c._cableKtotal ? `<br><span style="color:#666">Kобщ = <b>${c._cableKtotal.toFixed(3)}</b></span>` +
            ` <span style="color:#999">(Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span>` : '') +
          `</div>`);
      }
      if (mSize < (autoSize || 0)) {
        h.push('<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ Сечение меньше рекомендуемого — перегруз</div>');
      } else if (autoSize && mSize > autoSize * 2) {
        h.push('<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:6px;font-size:11px;color:#2e7d32;margin-top:4px">ℹ Сечение избыточное</div>');
      }
    } else {
      // Авто — детальное описание подбора
      if (autoSize) {
        const warn = c._cableOverflow ? '<span style="color:#c62828"> ⚠ не проходит</span>' : '';
        h.push(`<div style="font-size:11px;line-height:1.8">` +
          `Сечение: <b>${autoPar > 1 ? autoPar + '×' : ''}${autoSize} мм²</b>${warn}<br>` +
          `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b><br>` +
          `Конструкция: <b>${typeLabel}</b><br>` +
          `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b><br>` +
          `t=${c._cableAmbient}°C, группа=${c._cableGrouping}, длина=${fmt(c._cableLength || 0)} м<br>` +
          `Iдоп на жилу: <b>${fmt(autoIz)} A</b>` +
          (autoPar > 1 ? `<br>Параллельных линий: <b>${autoPar}</b> · Iдоп всего: <b>${fmt(c._cableTotalIz || 0)} A</b>` : '') +
          (c._cableKtotal ? `<br><span style="color:#666">Kобщ = <b>${c._cableKtotal.toFixed(3)}</b></span>` +
            ` <span style="color:#999">(Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span>` : '') +
          `</div>`);
        if (c._cableAutoParallel && autoPar > 1) {
          h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:4px;line-height:1.6">` +
            `⚠ Авто-параллель: одиночная жила ${GLOBAL.maxCableSize} мм² не проходит → <b>${autoPar} параллельных ${autoSize} мм²</b><br>` +
            `<span class="muted">• Кабели одной фазы — одинаковой длины и сечения<br>` +
            `• Разносить не более 1 Ø или с зазором ≥ Ø<br>` +
            `• На каждую линию — свой автомат</span></div>`);
        }
      }
    }
  } else if (isBusbar && c._busbarNom) {
    const warn = c._cableOverflow ? ' ⚠ превышен макс.' : '';
    h.push(`<hr style="border:none;border-top:1px solid #e0e3ea;margin:10px 0">`);
    h.push(`<div style="font-size:11px;line-height:1.8">` +
      `Шинопровод: <b>${c._busbarNom} А</b>${warn} · Imax: <b>${fmt(c._maxA || 0)} A</b></div>`);
  }
  h.push('</details>');

  if (!isBusbar) {
    // === Условия прокладки — единый блок (идентичный каналу) ===
    const curMethod = c._cableMethod || c.installMethod || GLOBAL.defaultInstallMethod;
    const curBundling = c._cableBundling || c.bundling || 'touching';
    const curAmbient = c._cableAmbient || c.ambientC || GLOBAL.defaultAmbient;
    const curGrouping = c._cableGrouping || c.grouping || GLOBAL.defaultGrouping;
    h.push(buildInstallConditionsBlock(
      c.installMethod || GLOBAL.defaultInstallMethod,
      c.bundling || 'touching',
      c.ambientC || GLOBAL.defaultAmbient,
      c.grouping || GLOBAL.defaultGrouping,
      curGrouping,
      c.insulation || GLOBAL.defaultInsulation,
      'data-conn-prop'
    ));
  }

  // Кабельные каналы — после условий прокладки
  const channels = [...state.nodes.values()].filter(nn => nn.type === 'channel');
  if (channels.length) {
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    const chCount = chainIds.length;
    h.push(`<details class="inspector-section"${chCount ? ' open' : ''}>`);
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Кабельные каналы (${chCount})</summary>`);
    h.push('<div class="muted" style="font-size:10px;margin:4px 0 6px">Отметьте каналы, через которые проходит линия.</div>');
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')}</label></div>`);
    }
    h.push('</details>');
  }

  // Автомат защиты — для всех линий (не только активных)
  {
    // Используем единый справочник из constants.js
    const autoIn = c._breakerIn || c._breakerPerLine || 0;
    const manualBreaker = !!c.manualBreakerIn;
    const effectiveIn = manualBreaker ? (c.manualBreakerIn || autoIn) : autoIn;
    const cnt = c._breakerCount || 1;

    h.push('<div class="inspector-section">');
    // Toggle авто/ручной
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">');
    h.push('<h4 style="margin:0;font-size:12px">Защитный аппарат</h4>');
    h.push(`<span style="font-size:10px;color:${!manualBreaker ? '#4caf50' : '#999'}">авто</span>`);
    h.push(`<div data-breaker-mode-toggle style="position:relative;width:36px;height:18px;border-radius:9px;background:${manualBreaker ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`);
    h.push(`<div style="position:absolute;top:2px;${manualBreaker ? 'right:2px' : 'left:2px'};width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></div>`);
    h.push('</div>');
    h.push(`<span style="font-size:10px;color:${manualBreaker ? '#e65100' : '#999'}">ручной</span>`);
    h.push('</div>');

    // Режим защиты для ЭТОЙ линии: полная (КЗ + перегрузка) или только КЗ.
    // В режиме 'sc-only' авто-подбор кабеля не принуждает In ≤ Iz и не выдаёт
    // warning при превышении — применяется когда перегрузка защищается upstream.
    const _pm = c.protectionMode || 'full';
    h.push(field('Режим защиты', `
      <select data-conn-prop="protectionMode">
        <option value="full"${_pm === 'full' ? ' selected' : ''}>КЗ и перегрузка</option>
        <option value="sc-only"${_pm === 'sc-only' ? ' selected' : ''}>Только КЗ</option>
      </select>`));

    // Эффективный Iz для координации (учитываем параллельные жилы)
    const _parBrk = Math.max(1, c._cableParallel || 1);
    const _IzTotal = (c._cableIz || 0) * _parBrk;
    const _Imax = c._maxA || 0;
    const _IperLine = _Imax / _parBrk;
    const _pmFlag = c.protectionMode || 'full';
    const _showHelp = GLOBAL.showHelp !== false;
    // Минимальный запас автомата (%) из глобальных настроек
    const _minMarginPct = Math.max(0, Number(GLOBAL.breakerMinMarginPct) || 0);
    // Запасы:
    //  - по автомату: (In - Iрасч) / Iрасч · 100
    //  - по кабелю:   (Iz_total - Iрасч) / Iрасч · 100
    const _brkMarginPct = (_Imax > 0 && effectiveIn > 0)
      ? ((effectiveIn - _Imax) / _Imax) * 100
      : null;
    const _cableMarginPct = (_Imax > 0 && _IzTotal > 0)
      ? ((_IzTotal - _Imax) / _Imax) * 100
      : null;
    const _fmtPct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
    const _marginColor = (v) => {
      if (v == null) return '#999';
      if (v < 0) return '#c62828';
      if (v < _minMarginPct) return '#e65100';
      return '#2e7d32';
    };

    // Блок запасов (и для auto, и для manual)
    const marginBlock = () => `
      <div style="display:flex;gap:12px;font-size:11px;margin-top:4px;padding:4px 0;border-top:1px dashed #e0e3ea">
        <div>Запас по автомату:
          <b style="color:${_marginColor(_brkMarginPct)}">${_fmtPct(_brkMarginPct)}</b></div>
        <div>Запас по кабелю:
          <b style="color:${_marginColor(_cableMarginPct)}">${_fmtPct(_cableMarginPct)}</b></div>
      </div>`;

    if (manualBreaker) {
      let brkOpts = '';
      for (const nom of BREAKER_SERIES) {
        brkOpts += `<option value="${nom}"${nom === (c.manualBreakerIn || autoIn) ? ' selected' : ''}>${nom} А</option>`;
      }
      h.push(field('Номинал автомата', `<select data-conn-prop="manualBreakerIn">${brkOpts}</select>`));
      h.push(marginBlock());
      // Warning если запас по автомату меньше заданного минимума
      if (_brkMarginPct != null && _brkMarginPct >= 0 && _brkMarginPct < _minMarginPct) {
        h.push(`<div style="background:#fff3e0;border:1px solid #ffb74d;border-radius:4px;padding:6px;font-size:11px;color:#e65100;margin-top:4px">⚠ Запас по автомату ${_brkMarginPct.toFixed(1)}% меньше минимального ${_minMarginPct}%. Повысьте номинал.</div>`);
      }
      if (autoIn) {
        h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:4px">Рекомендация (авто): <b>${autoIn} А</b>${_minMarginPct > 0 ? ` <span class="muted">(с запасом ≥${_minMarginPct}%)</span>` : ''}</div>`);
        if (_showHelp) {
          const parText = _parBrk > 1 ? ` × ${_parBrk} ветви = ${fmt(_IzTotal)} А суммарно` : '';
          h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:4px;color:#1565c0;line-height:1.5">
            <b>Как получено:</b><br>
            Iрасч линии = <b>${fmt(_Imax)} А</b>${_parBrk > 1 ? ` (на жилу ${fmt(_IperLine)} А)` : ''}<br>
            Iz кабеля = <b>${fmt(c._cableIz || 0)} А</b>${parText}<br>
            Правило: Iрасч ≤ In ≤ Iz. Выбран ближайший стандартный номинал из ряда.
            ${_pmFlag === 'sc-only' ? '<br>Режим: <b>Только КЗ</b> — координация с Iz не требуется.' : ''}
          </div>`);
        }
      }
      // Warning 1: автомат > Iz (кабель не защищён от перегрузки) — только при full
      if (_pmFlag !== 'sc-only' && _IzTotal > 0 && effectiveIn > _IzTotal) {
        h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${effectiveIn} А) > Iz (${fmt(_IzTotal)} А${_parBrk > 1 ? ' суммарно' : ''}) — кабель не защищён от перегрузки! Увеличьте сечение или режим «Только КЗ».</div>`);
      }
      // Warning 2: автомат < Iрасч (сработает при нормальной нагрузке, нагрузка будет отключена)
      if (_Imax > 0 && effectiveIn > 0 && effectiveIn < _Imax * 0.95) {
        h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${effectiveIn} А) &lt; Iрасч (${fmt(_Imax)} А) — автомат будет срабатывать при штатной нагрузке! Нагрузка будет отключена.</div>`);
      }
    } else {
      const badge = c._breakerAgainstCable
        ? '<span class="badge off">нарушена</span>'
        : (effectiveIn ? '<span class="badge on">ок</span>' : '');
      h.push(`<div style="font-size:12px;line-height:1.8">` +
        (effectiveIn ? `Номинал: <b>${effectiveIn} А</b> ${badge}<br>` : 'Не определён<br>') +
        (cnt > 1 ? `В шкафу: <b>${cnt} × ${effectiveIn} А</b> <span class="muted">(по одному на параллельную линию)</span><br>` : '') +
        (c._breakerAgainstCable ? `<span style="color:#c62828;font-size:11px">In > Iz (${fmt(_IzTotal)} А${_parBrk > 1 ? ' суммарно' : ''}) — увеличьте сечение</span>` : '') +
        `</div>`);
      // Запасы по автомату и кабелю
      if (effectiveIn) h.push(marginBlock());
      if (_showHelp && effectiveIn) {
        const parText = _parBrk > 1 ? ` × ${_parBrk} ветви = ${fmt(_IzTotal)} А суммарно` : '';
        h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
          <b>Как получено:</b><br>
          Iрасч линии = <b>${fmt(_Imax)} А</b>${_parBrk > 1 ? ` (на жилу ${fmt(_IperLine)} А)` : ''}<br>
          Iz кабеля = <b>${fmt(c._cableIz || 0)} А</b>${parText}<br>
          Правило: Iрасч ≤ In ≤ Iz. Номинал <b>${effectiveIn} А</b> — ближайший стандартный из ряда, удовлетворяющий условию.
          ${_pmFlag === 'sc-only' ? '<br>Режим: <b>Только КЗ</b> — условие In ≤ Iz не принуждается.' : ''}
        </div>`);
      }
    }
    h.push('</div>');
  }

  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Рукоятки на концах — переключить связь на другой порт. «+» в середине сегмента — добавить точку сплайна. Shift+клик по точке — удалить. Shift+клик по линии — удалить связь.</div>');
  // Кнопка сброса точек сплайна — только если точки есть
  if (Array.isArray(c.waypoints) && c.waypoints.length) {
    h.push(`<button class="full-btn" id="btn-reset-waypoints" style="margin-top:8px">↺ Сбросить траекторию (${c.waypoints.length} точ.)</button>`);
  }
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка на поля связи.
  // Баг-фикс (фокус): для text/number используем событие 'input' + вызываем
  // только render() — без renderInspector(), иначе каждый символ пересобирает
  // DOM и input теряет фокус. Для select/checkbox используем 'change' и
  // renderInspector() разрешён (эти контролы теряют фокус штатно, а нам нужно
  // перерисовать зависимые блоки — иконки, справочные значения и т.п.).
  inspectorBody.querySelectorAll('[data-conn-prop]').forEach(inp => {
    const isSelect = inp.tagName === 'SELECT';
    const isCheckbox = inp.type === 'checkbox';
    const isTextLike = !isSelect && !isCheckbox; // input[type=text|number|...]
    const evt = isTextLike ? 'input' : 'change';
    inp.addEventListener(evt, () => {
      snapshot('conn:' + c.id + ':' + inp.dataset.connProp);
      const prop = inp.dataset.connProp;
      let v = isCheckbox ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
      // Числовые свойства из select: manualBreakerIn, manualCableSize, manualCableParallel, grouping
      if (['manualBreakerIn', 'manualCableSize', 'manualCableParallel', 'grouping', 'ambientC', 'lengthM', 'economicHours'].includes(prop)) {
        v = Number(v) || 0;
      }
      c[prop] = v;
      render();
      notifyChange();
      // renderInspector ТОЛЬКО для select/checkbox — они могут показать/скрыть
      // зависимые блоки (иконки прокладки, манула кабеля и т.п.), а для
      // текстовых полей это ломает фокус/каретку.
      if (!isTextLike) renderInspector();
    });
  });
  // Режим разрыва (link mode)
  {
    const lmCb = document.getElementById('cp-linkMode');
    if (lmCb) {
      lmCb.addEventListener('change', () => {
        snapshot('conn-linkMode:' + c.id);
        c.linkMode = lmCb.checked;
        if (!c.linkMode) c._linkPreview = false;
        render(); notifyChange(); renderInspector();
      });
    }
    const lpBtn = document.getElementById('cp-link-preview');
    if (lpBtn) {
      lpBtn.addEventListener('click', () => {
        c._linkPreview = !c._linkPreview;
        render(); renderInspector();
      });
    }
  }
  // Чекбоксы каналов
  inspectorBody.querySelectorAll('[data-conn-channel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('conn-channel:' + c.id);
      if (!Array.isArray(c.channelIds)) c.channelIds = [];
      const chId = inp.dataset.connChannel;
      if (inp.checked) {
        if (!c.channelIds.includes(chId)) c.channelIds.push(chId);
      } else {
        c.channelIds = c.channelIds.filter(x => x !== chId);
      }
      render();
      renderInspector();
      notifyChange();
    });
  });
  // Toggle авто/ручной подбор кабеля
  const cableModeToggle = inspectorBody.querySelector('[data-cable-mode-toggle]');
  if (cableModeToggle) {
    cableModeToggle.addEventListener('click', () => {
      snapshot('cable-mode:' + c.id);
      if (c.manualCableSize) {
        // Переключаем на авто
        delete c.manualCableSize;
        delete c.manualCableParallel;
      } else {
        // Переключаем на ручной — копируем текущий авто-подбор
        c.manualCableSize = c._cableSize || 240;
        c.manualCableParallel = c._cableParallel || 1;
      }
      render(); renderInspector(); notifyChange();
    });
  }

  // Toggle авто/ручной автомат
  const breakerModeToggle = inspectorBody.querySelector('[data-breaker-mode-toggle]');
  if (breakerModeToggle) {
    breakerModeToggle.addEventListener('click', () => {
      snapshot('breaker-mode:' + c.id);
      if (c.manualBreakerIn) {
        delete c.manualBreakerIn;
      } else {
        c.manualBreakerIn = c._breakerIn || 100;
      }
      render(); renderInspector(); notifyChange();
    });
  }

  document.getElementById('btn-del-conn').onclick = () => deleteConn(c.id);
  const resetBtn = document.getElementById('btn-reset-waypoints');
  if (resetBtn) resetBtn.onclick = () => {
    snapshot('wp-reset:' + c.id);
    c.waypoints = [];
    render();
    renderInspector();
    notifyChange();
    flash('Траектория сброшена');
  };
}

// ===== icon helpers (moved from inspector.js) =====
export function channelIconSVG(channelType, size) {
  const s = size || 48;
  const scale = s / 36;
  let paths = '';
  // Упрощённые версии иконок как inline SVG строка
  function circSvg(cx, cy, r, fill, stroke) {
    return `<circle cx="${cx * scale}" cy="${cy * scale}" r="${r * scale}" fill="${fill || 'none'}" stroke="${stroke || '#555'}" stroke-width="${1.2 * scale}"/>`;
  }
  function dotsSvg(cx, cy, r) {
    const jr = r * 0.28 * scale;
    return circSvg(cx, cy, r, 'none', '#555') +
      `<circle cx="${(cx - r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${(cx + r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${cx * scale}" cy="${(cy + r * 0.2) * scale}" r="${jr}" fill="#555"/>`;
  }
  function hatch(x, y, w, h) {
    let r = `<rect x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="#888" stroke-width="${scale}"/>`;
    for (let i = 0; i < w; i += 4) {
      r += `<line x1="${(x + i) * scale}" y1="${(y + h) * scale}" x2="${(x + i + 4) * scale}" y2="${y * scale}" stroke="#ccc" stroke-width="${0.5 * scale}"/>`;
    }
    return r;
  }

  // Поддержка и channelType (legacy), и IEC метода
  const ct = ({
    A1: 'conduit', A2: 'conduit', B1: 'conduit', B2: 'tray_solid',
    C: 'wall', E: 'tray_perf', F: 'tray_ladder', G: 'wall',
    D1: 'ground', D2: 'ground_direct',
  })[channelType] || channelType || 'conduit';

  switch (ct) {
    case 'conduit': case 'insulated_conduit': case 'insulated_cable':
      paths = hatch(0, 0, 36, 8) + circSvg(18, 18, 9, 'none', '#888') + dotsSvg(18, 18, 5); break;
    case 'tray_solid':
      paths = `<rect x="${2 * scale}" y="${10 * scale}" width="${32 * scale}" height="${14 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 17, 5); break;
    case 'wall':
      paths = hatch(0, 0, 36, 8) + dotsSvg(18, 18, 6); break;
    case 'tray_perf': case 'tray_wire':
      paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_ladder': case 'air':
      paths = `<line x1="${4 * scale}" y1="${16 * scale}" x2="${4 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${32 * scale}" y1="${16 * scale}" x2="${32 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${4 * scale}" y1="${21 * scale}" x2="${32 * scale}" y2="${21 * scale}" stroke="#888" stroke-width="${0.8 * scale}"/>` + dotsSvg(18, 12, 5); break;
    case 'ground':
      paths = hatch(0, 0, 36, 28) + circSvg(18, 14, 8, 'none', '#888') + dotsSvg(18, 14, 4.5); break;
    case 'ground_direct':
      paths = hatch(0, 0, 36, 28) + dotsSvg(18, 14, 5.5); break;
    default: paths = dotsSvg(18, 14, 6);
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s * 28 / 36}">${paths}</svg>`;
}

export function bundlingIconSVG(bundling, size) {
  const s = size || 48;
  let svg = '';
  if (bundling === 'spaced') {
    svg = `<circle cx="12" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="12" cy="16" r="2" fill="#555"/><circle cx="36" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="36" cy="16" r="2" fill="#555"/><line x1="18" y1="8" x2="30" y2="8" stroke="#1976d2" stroke-width="0.8"/><text x="24" y="7" text-anchor="middle" fill="#1976d2" font-size="6">≥Ø</text>`;
  } else if (bundling === 'bundled') {
    svg = `<ellipse cx="24" cy="16" rx="18" ry="12" fill="none" stroke="#888" stroke-width="0.8" stroke-dasharray="3 2"/><circle cx="16" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="12" r="2" fill="#555"/><circle cx="30" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="30" cy="12" r="2" fill="#555"/><circle cx="23" cy="22" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="23" cy="22" r="2" fill="#555"/>`;
  } else {
    svg = `<circle cx="16" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="16" r="2" fill="#555"/><circle cx="32" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="32" cy="16" r="2" fill="#555"/>`;
  }
  return `<svg width="${s}" height="${s * 32 / 48}" viewBox="0 0 48 32">${svg}</svg>`;
}
