// Инспектор связи (линии) и общие хелперы условий прокладки.
// Выделено из inspector.js.
import { GLOBAL, BREAKER_SERIES, CABLE_CATEGORIES } from '../constants.js';
import { listCableTypes, getCableType } from '../../../shared/cable-types-catalog.js';
// TCC-chart грузится лениво в _mountConnTccChart (только когда пользователь
// открывает инспектор линии с автоматом/кабелем)
let _tccChartMod = null;
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
  // Фаза 1.19.8: ввод от городской сети — абстрактный ввод, ТУ даёт
  // поставщик энергии. Не подбираем и не проверяем защиту / сечение
  // этой линии: за участок «город → граница балансовой принадлежности»
  // отвечает электроснабжающая организация. Для ДГУ/солнечных/своих
  // источников (type='generator', 'ups' и т.д.) подбор защиты остаётся.
  const isUtilityInfeed = fromN && fromN.type === 'source'
    && (fromN.sourceSubtype === 'utility' || fromN.sourceSubtype === 'grid');
  // Префикс по IEC 81346-2: «W» для обычных силовых линий, «WH» для
  // высоковольтных (U > 1000 В). Флаг _isHV проставляется recalc.js.
  const linePrefix = c._isHV ? 'WH' : 'W';
  const autoLineLabel = `${linePrefix}-${fromTag}-${toTag}`;
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

  // connectionKind хранится в данных (по умолчанию 'electrical') — select
  // появится только на non-electrical страницах в Фазе 2 (layout, mechanical
  // page.kind). На электрической принципиальной схеме выбор не нужен —
  // все соединения электрические.

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
    if (isUtilityInfeed) {
      h.push(`<div class="muted" style="font-size:11px;margin:8px 0;padding:6px 8px;background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;color:#1565c0">ℹ Ввод от городской сети — абстрактный участок по ТУ поставщика. Защита и сечение линии здесь не проверяются (ответственность электроснабжающей организации).</div>`);
    }
    if (!isUtilityInfeed) {
      const hvBadge = c._isHV
        ? ` <span style="font-size:10px;background:#ef6c00;color:#fff;padding:1px 6px;border-radius:3px">ВН · ${escHtml(cableVoltageClass(c._voltage || 0))}</span>`
        : '';
      h.push(`<h4 style="margin:12px 0 6px;font-size:12px">Проводник${hvBadge}</h4>`);
    }
    if (!isUtilityInfeed && (c._cableSize || c._busbarNom || c._cableIz)) {
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
      // Для групповой нагрузки (N приборов, N×автомат per-line) координация
      // и oversize-проверка идут per-line: каждая линия защищена своим
      // автоматом InPerLine, Iz линии сравнивается с ним, а не с суммарным.
      const isGroupBreakers = !c._breakerIn && c._breakerPerLine && (c._breakerCount || 1) > 1;
      const brkRef = isGroupBreakers ? c._breakerPerLine : effectiveBrkIn;
      const izRef = isGroupBreakers ? Iz : IzTotal;
      const inLeIz = !brkRef || !izRef || brkRef <= izRef;
      const protOk = inLeIz;
      const oversize = izRef > 0 && brkRef > 0 && izRef > brkRef * 2 && (c._cableSize || 0) > 1.5;
      const bgColor = !protOk ? '#ffebee' : oversize ? '#fff8e1' : '#f5f5f5';
      const methodLabel = GLOBAL.calcMethod === 'pue' ? 'ПУЭ' : 'IEC 60364';
      h.push(`<div style="font-size:11px;line-height:1.6;margin-top:4px;padding:6px;background:${bgColor};border-radius:4px">` +
        (cableSpec ? cableSpec + '<br>' : '') +
        (effectiveBrkIn ? `Автомат: <b>${effectiveBrkIn} A</b><br>` : '') +
        (Iz ? `Iдоп на жилу (Iz): <b>${fmt(Iz)} A</b>${par > 1 ? ` · суммарно <b>${fmt(IzTotal)} А</b>` : ''}<br>` : '') +
        (!inLeIz ? (c._parallelProtectionEff === 'common'
          ? '<span style="color:#e65100;font-size:11px">⚠ In > Iz·n при общей защите параллельных линий — рекомендуется увеличить сечение или перейти в режим «индивидуальная защита».</span><br>'
          : '<span style="color:#c62828;font-weight:600">⚠ In > Iz — кабель не защищён автоматом!</span><br>') : '') +
        (oversize ? '<span style="color:#e65100">ℹ Кабель значительно завышен (Iz > 2×In)</span><br>' : '') +
        (c._breakerUndersize ? '<span style="color:#c62828;font-weight:600">⚠ Автомат меньше расчётного тока!</span><br>' : '') +
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
          ${effectiveBrkIn ? `3) Координация с автоматом: Iz·n ≥ In, требуется Iz·n ≥ <b>${effectiveBrkIn} А</b><br>` : ''}
          4) Коэффициенты условий прокладки: Kt=${(c._cableKt||1).toFixed(2)}, Kg=${(c._cableKg||1).toFixed(2)}, K=${(c._cableKtotal||1).toFixed(3)}<br>
          5) Для ${methodLabel} выбрано ближайшее стандартное сечение <b>${c._cableSize} мм²</b>${par > 1 ? ` × ${par}` : ''}, дающее Iz=<b>${fmt(Iz)} А</b>${par > 1 ? ` (суммарно ${fmt(IzTotal)} А)` : ''}<br>
          Правило: Iрасч ≤ Iz·n и In ≤ Iz·n.
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

  // Марка кабеля из справочника (shared/cable-types-catalog.js, Фаза 0.3 + 1.11 + 1.15)
  // Информационный выбор — при выборе авто-заполняются material/insulation.
  //
  // Фаза 1.15: фильтрация по классу напряжения линии.
  // Электрическая принципиальная схема содержит только силовые линии —
  // слаботочка/данные/полевые категории не предлагаются (они живут на
  // low-voltage / data page.kind, Фаза 2).
  //   c._isHV = true (U > 1000 В, не DC) → только 'hv' (АПвПуг, ПвПу)
  //   DC-линия (детектируется по уровню напряжения с hz=0) → 'dc' + 'power'
  //   LV (по умолчанию) → только 'power' (ВВГ, АВВГ, АВБбШв …)
  try {
    // Определяем допустимые категории по классу напряжения соединения.
    // _isHV проставляется recalc'ом. Если recalc не был вызван — берём
    // консервативно LV (только power).
    let allowedCats = ['power'];
    let classLabel = 'LV (низкое напряжение)';
    if (c._isHV) {
      allowedCats = ['hv'];
      classLabel = 'MV/HV (среднее/высокое напряжение)';
    } else if (c._isDC) {
      allowedCats = ['dc', 'power'];
      classLabel = 'DC (постоянный ток)';
    }

    const cableTypes = listCableTypes();
    const curMark = c.cableMark || '';
    const byCat = {};
    for (const ct2 of cableTypes) {
      const cat = ct2.category || 'power';
      if (!allowedCats.includes(cat)) continue; // фильтр по классу линии
      (byCat[cat] = byCat[cat] || []).push(ct2);
    }
    let markOpts = '<option value="">— не выбрано (указать вручную) —</option>';
    // Сохраняем порядок allowedCats (силовой сначала)
    for (const cat of allowedCats) {
      const items = byCat[cat] || [];
      if (!items.length) continue;
      const catDef = CABLE_CATEGORIES?.[cat];
      const catLabel = catDef?.label || cat;
      markOpts += `<optgroup label="${escHtml(catLabel)}">`;
      for (const m of items) {
        markOpts += `<option value="${escAttr(m.id)}"${m.id === curMark ? ' selected' : ''}>${escHtml(m.brand || m.id)}</option>`;
      }
      markOpts += '</optgroup>';
    }
    // Если выбранный curMark относится к запрещённой сейчас категории — показать в conflicting группе с пометкой
    if (curMark) {
      const sel = getCableType(curMark);
      if (sel && !allowedCats.includes(sel.category || 'power')) {
        markOpts += `<optgroup label="⚠ Несоответствие классу линии">`;
        markOpts += `<option value="${escAttr(sel.id)}" selected>${escHtml(sel.brand || sel.id)} (${escHtml(sel.category)})</option>`;
        markOpts += '</optgroup>';
      }
    }
    h.push(field('Марка кабеля (из справочника)', `<select data-conn-prop="cableMark">${markOpts}</select>`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-4px;margin-bottom:4px">Класс линии: <b>${classLabel}</b>. На электрической принципиальной схеме показаны только совместимые категории (силовые/высоковольтные/DC). Слаботочные и информационные — на соответствующих страницах (Фаза 2).</div>`);
    if (curMark) {
      const sel = getCableType(curMark);
      if (sel) {
        const mismatch = !allowedCats.includes(sel.category || 'power');
        h.push(`<div class="muted" style="font-size:11px;margin-top:0;margin-bottom:6px">
          <b>${escHtml(sel.brand || '')}</b> · ${escHtml(sel.fullName || '')}<br>
          <span style="color:#1976d2">${escHtml(sel.standard || '')}</span> · материал ${escHtml(sel.material || '?')} · изоляция ${escHtml(sel.insulation || '?')}
          ${sel.fireResistant ? ' · <span style="color:#c67300">огнестойкий</span>' : ''}
          ${sel.lowSmokeZH ? ' · <span style="color:#2e7d32">LSZH</span>' : ''}
          ${mismatch ? '<br><span style="color:#cf222e;font-weight:600">⚠ Выбранная марка относится к категории «' + escHtml(sel.category) + '» — не подходит для линии ' + escHtml(classLabel) + '. Выберите другой тип.</span>' : ''}
        </div>`);
      }
    }
  } catch (e) { /* каталог опционален */ }

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
    // Экономическая плотность тока — per-connection toggle
    const ecoChecked = !!c.economicDensity;
    h.push(`<div class="field" style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-conn-prop="economicDensity" ${ecoChecked ? 'checked' : ''}> Экон. плотность тока</label></div>`);

    // Для ВН-кабелей — опция «с бронёй». Броня не считается проводником
    // (она заземляется отдельно), но важна для BOM и выбора марки
    // (например ПвПу vs ПвПуг — с/без бронирования).
    if (c._isHV) {
      const hasArmour = !!c.hasArmour;
      h.push(`<div class="field" style="margin-top:4px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-conn-prop="hasArmour" ${hasArmour ? 'checked' : ''}> Кабель с бронёй (заземлённой)</label></div>`);
      h.push(`<div class="muted" style="font-size:11px;margin-top:-2px;margin-bottom:8px">На ВН: 3 жилы (3 фазы). Броня (если есть) — экран, заземлённый на обоих концах. В числе жил не учитывается.</div>`);
    }
  }
  // Секция сечения — ВНУТРИ details "Проводник"
  if ((c._cableSize || c._busbarNom || c._maxA > 0) && !isBusbar) {
    const manualCable = !!c.manualCableSize;
    // Для рекомендации при ручном кабеле — пересчитываем авто
    let autoSize, autoPar, autoIz;
    if (manualCable && c._maxA > 0) {
      const _m = getMethod(GLOBAL.calcMethod);
      // Предпросмотр «что подобрал бы авто» — применяем ту же цепочку запаса,
      // что и основной recalc, чтобы рекомендация совпадала с авто-режимом.
      const _recSizingMargin = (typeof c._breakerMarginPctEff === 'number')
        ? c._breakerMarginPctEff
        : 0;
      const _recCurve = c.breakerCurve || c._breakerCurveEff || 'MCB_C';
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
        breakerMarginPct: _recSizingMargin,
        breakerCurve: _recCurve,
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

  // Автомат защиты — для всех линий (не только активных).
  // Фаза 1.19.8: для ввода от городской сети блок скрыт.
  if (!isUtilityInfeed) {
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


    // Эффективный Iz для координации (учитываем параллельные жилы)
    const _parBrk = Math.max(1, c._cableParallel || 1);
    const _IzTotal = (c._cableIz || 0) * _parBrk;
    const _Imax = c._maxA || 0;
    const _IperLine = _Imax / _parBrk;
    const _showHelp = GLOBAL.showHelp !== false;
    // Минимальный запас автомата (%) из глобальных настроек
    const _minMarginPct = Math.max(0, Number(GLOBAL.breakerMinMarginPct) || 0);
    // Запасы:
    //  - по автомату: (In - Iрасч) / Iрасч · 100
    //  - по кабелю:   (Iz_total - Iрасч) / Iрасч · 100
    // Для групповой нагрузки (N приборов × N per-line автоматов) сравниваем
    // per-line ток с per-line автоматом и per-line Iz — иначе запас ложно
    // отрицательный (считался бы суммарный ток против одного автомата).
    const _isGroupBrk = !c._breakerIn && c._breakerPerLine && (c._breakerCount || 1) > 1;
    const _ImaxRef = _isGroupBrk ? _IperLine : _Imax;
    const _brkRef = _isGroupBrk ? (c._breakerPerLine || 0) : effectiveIn;
    const _izRef = _isGroupBrk ? (c._cableIz || 0) : _IzTotal;
    const _brkMarginPct = (_ImaxRef > 0 && _brkRef > 0)
      ? ((_brkRef - _ImaxRef) / _ImaxRef) * 100
      : null;
    const _cableMarginPct = (_ImaxRef > 0 && _izRef > 0)
      ? ((_izRef - _ImaxRef) / _ImaxRef) * 100
      : null;
    const _fmtPct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
    const _marginColor = (v) => {
      if (v == null) return '#999';
      if (v < 0) return '#c62828';
      if (v < _minMarginPct) return '#e65100';
      return '#2e7d32';
    };

    // Блок запасов (и для auto, и для manual). Показываем также целевой
    // запас и его источник (линия / потребитель / auto).
    const _targetMarginPct = (typeof c._breakerMarginPctEff === 'number') ? c._breakerMarginPctEff : null;
    const _marginSrc = c._breakerMarginSource || 'auto';
    const _srcLabel = _marginSrc === 'line' ? 'линия' : (_marginSrc === 'consumer' ? 'потребитель' : 'авто по inrush');
    const marginBlock = () => `
      <div style="display:flex;gap:12px;font-size:11px;margin-top:4px;padding:4px 0;border-top:1px dashed #e0e3ea">
        <div>Запас по автомату:
          <b style="color:${_marginColor(_brkMarginPct)}">${_fmtPct(_brkMarginPct)}</b></div>
        <div>Запас по кабелю:
          <b style="color:${_marginColor(_cableMarginPct)}">${_fmtPct(_cableMarginPct)}</b></div>
      </div>
      ${_targetMarginPct != null ? `<div class="muted" style="font-size:10px;margin-top:-2px">Целевой запас: <b>${_targetMarginPct.toFixed(0)}%</b> (${_srcLabel})</div>` : ''}`;

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
          </div>`);
        }
      }
      // Warning 1: автомат > Iz (кабель не защищён от перегрузки).
      // Для групповой нагрузки сравниваем In per-line vs Iz per-line
      // (каждый кабель защищается своим автоматом отдельно).
      const _w1LhsIn = _isGroupBrk ? (c._breakerPerLine || effectiveIn) : effectiveIn;
      const _w1RhsIz = _isGroupBrk ? (c._cableIz || 0) : _IzTotal;
      const _w1IzLabel = _isGroupBrk ? 'на жилу' : (_parBrk > 1 ? 'суммарно' : '');
      if (_w1RhsIz > 0 && _w1LhsIn > _w1RhsIz) {
        const _commonW1 = c._parallelProtectionEff === 'common';
        if (_commonW1) {
          h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;color:#e65100;margin-top:4px">ℹ In (${_w1LhsIn} А) > Iz (${fmt(_w1RhsIz)} А${_w1IzLabel ? ' ' + _w1IzLabel : ''}) — общая защита параллельных линий не даёт 100 % координации. Это допустимо если линии идентичны и нагрузка симметрична; иначе — увеличьте сечение либо переключитесь на «индивидуальную» защиту.</div>`);
        } else {
          h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${_w1LhsIn} А) > Iz (${fmt(_w1RhsIz)} А${_w1IzLabel ? ' ' + _w1IzLabel : ''}) — кабель не защищён от перегрузки! Увеличьте сечение.</div>`);
        }
      }
      // Warning 2: автомат < Iрасч (сработает при нормальной нагрузке, нагрузка будет отключена)
      if (_Imax > 0 && effectiveIn > 0 && effectiveIn < _Imax * 0.95) {
        h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${effectiveIn} А) &lt; Iрасч (${fmt(_Imax)} А) — автомат будет срабатывать при штатной нагрузке! Нагрузка будет отключена.</div>`);
      }
    } else {
      // Для общего автомата на параллельные линии предупреждение
      // мягче (info вместо error): «общий автомат не полностью покрывает
      // сумму Iz» — типовой trade-off выбора режима защиты.
      const _commonMode = c._parallelProtectionEff === 'common';
      const badge = c._breakerAgainstCable
        ? (_commonMode
            ? '<span class="badge" style="background:#fff3e0;color:#e65100;border:1px solid #ffcc80">общая защита</span>'
            : '<span class="badge off">нарушена</span>')
        : (effectiveIn ? '<span class="badge on">ок</span>' : '');
      // Pointer to UPS internal breaker origin (Phase 1.20.65)
      const _upsSrcLabel = { 'ups-output-QF3': 'QF3 (выход ИБП)',
        'ups-input-QF1': 'QF1 (вход сети ИБП)',
        'ups-input-QF2': 'QF2 (вход байпаса ИБП)' }[c._breakerInternalSource] || null;
      const _upsInternalNote = c._breakerInternal && _upsSrcLabel
        ? `<div class="muted" style="font-size:10.5px;line-height:1.4;margin-top:2px">Встроенный автомат ИБП: ${_upsSrcLabel}. В спецификацию не попадает (поставляется в составе ИБП). Номинал — ${c._breakerInAuto ? 'расчётный по мощности ИБП (уточните в параметрах ИБП при необходимости)' : (effectiveIn ? 'из параметров ИБП' : 'не задан — уточните в свойствах ИБП')}.</div>`
        : '';
      h.push(`<div style="font-size:12px;line-height:1.8">` +
        (effectiveIn ? `Номинал: <b>${effectiveIn} А</b> ${badge}<br>` : (c._breakerInternal ? `<span class="muted">Внешнего автомата нет — защита по уставкам инвертора ИБП</span><br>` : 'Не определён<br>')) +
        (cnt > 1 ? `В шкафу: <b>${cnt} × ${effectiveIn} А</b> <span class="muted">(по одному на параллельную линию)</span><br>` : '') +
        (c._breakerAgainstCable ? (_commonMode
          ? `<span style="color:#e65100;font-size:11px">ℹ In (${effectiveIn} А) &gt; суммарного Iz (${fmt(_IzTotal)} А) — при общей защите параллельных линий это приемлемый компромисс; для полной координации перейдите в режим «индивидуальная защита».</span>`
          : `<span style="color:#c62828;font-size:11px">In > Iz (${_isGroupBrk ? fmt(c._cableIz || 0) + ' А на жилу' : fmt(_IzTotal) + ' А' + (_parBrk > 1 ? ' суммарно' : '')}) — увеличьте сечение</span>`) : '') +
        `</div>` + _upsInternalNote);
      // Запасы по автомату и кабелю
      if (effectiveIn) h.push(marginBlock());
      if (_showHelp && effectiveIn) {
        const parText = _parBrk > 1 ? ` × ${_parBrk} ветви = ${fmt(_IzTotal)} А суммарно` : '';
        if (_isGroupBrk) {
          h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
            <b>Как получено (групповая нагрузка):</b><br>
            ${_parBrk} приборов × собственный кабель + собственный автомат.<br>
            На жилу Iрасч/n = <b>${fmt(_IperLine)} А</b>, Iz жилы = <b>${fmt(c._cableIz || 0)} А</b>.<br>
            Правило per-line: Iрасч/n ≤ In ≤ Iz. Номинал <b>${effectiveIn} А</b> — ближайший стандартный ≥ ${fmt(_IperLine)} А.
          </div>`);
        } else {
          h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
            <b>Как получено:</b><br>
            Iрасч линии = <b>${fmt(_Imax)} А</b>${_parBrk > 1 ? ` (на жилу ${fmt(_IperLine)} А)` : ''}<br>
            Iz кабеля = <b>${fmt(c._cableIz || 0)} А</b>${parText}<br>
            Правило: Iрасч ≤ In ≤ Iz. Номинал <b>${effectiveIn} А</b> — ближайший стандартный из ряда, удовлетворяющий условию.
          </div>`);
        }
      }
    }

    // Тип автомата + настройки (кривая / Ir-Isd-tsd-Ii для MCCB/ACB)
    {
      const curveEff = c._breakerCurveEff || c.breakerCurve || 'MCB_C';
      const curveManual = !!c.breakerCurve;
      const CURVES = [
        ['MCB_B', 'MCB кр. B'],
        ['MCB_C', 'MCB кр. C'],
        ['MCB_D', 'MCB кр. D'],
        ['MCCB', 'MCCB (литой корпус)'],
        ['ACB', 'ACB (воздушный)'],
      ];
      h.push('<details class="inspector-section" style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Тип автомата и настройки</summary>');
      h.push('<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">');
      h.push(`<label style="font-size:11px;color:${curveManual?'#999':'#4caf50'}">авто</label>`);
      h.push(`<div data-brk-curve-toggle style="position:relative;width:32px;height:16px;border-radius:8px;background:${curveManual?'#ff9800':'#4caf50'};cursor:pointer">`);
      h.push(`<div style="position:absolute;top:2px;${curveManual?'right:2px':'left:2px'};width:12px;height:12px;border-radius:6px;background:#fff"></div>`);
      h.push('</div>');
      h.push(`<label style="font-size:11px;color:${curveManual?'#e65100':'#999'}">ручной</label>`);
      h.push(`<span style="margin-left:auto;font-size:11px;color:#666">Сейчас: <b>${curveEff}</b></span>`);
      h.push('</div>');
      if (curveManual) {
        const opts = CURVES.map(([v, lbl]) => `<option value="${v}"${v===curveEff?' selected':''}>${lbl}</option>`).join('');
        h.push(field('Тип / кривая', `<select data-conn-prop="breakerCurve">${opts}</select>`));
      } else {
        h.push(`<div class="muted" style="font-size:10px;margin-bottom:4px">Определяется по типу нагрузки (inrush потребителя) и номиналу In.</div>`);
      }

      // Настройки регулируемого автомата — MCCB/ACB/VCB
      if (c._breakerSettings) {
        const s = c._breakerSettings;
        const settingsManual = (c.breakerSettings && Object.keys(c.breakerSettings).length > 0);
        h.push('<div style="display:flex;gap:8px;align-items:center;margin:8px 0 4px">');
        h.push(`<b style="font-size:11px">Уставки защиты</b>`);
        h.push(`<label style="font-size:11px;color:${settingsManual?'#999':'#4caf50'}">авто</label>`);
        h.push(`<div data-brk-settings-toggle style="position:relative;width:32px;height:16px;border-radius:8px;background:${settingsManual?'#ff9800':'#4caf50'};cursor:pointer">`);
        h.push(`<div style="position:absolute;top:2px;${settingsManual?'right:2px':'left:2px'};width:12px;height:12px;border-radius:6px;background:#fff"></div>`);
        h.push('</div>');
        h.push(`<label style="font-size:11px;color:${settingsManual?'#e65100':'#999'}">ручной</label>`);
        h.push('</div>');
        const row = (lbl, key, val, min, max, step, unit) =>
          `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
            <label style="width:110px;font-size:11px">${lbl}</label>
            <input type="number" data-brk-setting="${key}" value="${val}" min="${min}" max="${max}" step="${step}" ${settingsManual ? '' : 'disabled'} style="flex:1;font-size:11px;padding:3px 6px;border:1px solid ${settingsManual?'#ccc':'#eee'};border-radius:3px;background:${settingsManual?'#fff':'#fafafa'};color:${settingsManual?'#000':'#888'}">
            <span style="font-size:10px;color:#666;width:20px">${unit}</span>
          </div>`;
        h.push(row('Ir (long-time)',    'Ir',  s.Ir,  1,    6300, 1,   'А'));
        h.push(row('Isd (short-time)',  'Isd', s.Isd, 1,    40000, 10, 'А'));
        h.push(row('tsd (short delay)', 'tsd', s.tsd, 0,    1,    0.05, 'с'));
        h.push(row('Ii (instant)',      'Ii',  s.Ii,  1,    40000, 10, 'А'));
        h.push(`<div class="muted" style="font-size:10px;margin-top:2px">Ir — уставка длительной перегрузки; Isd·tsd — короткая селективная; Ii — мгновенное отключение. Уставки автоматически отражаются на TCC-графике и в проверке селективности.</div>`);
      }
      h.push('</details>');
    }

    // === Режим защиты параллельных линий (для par > 1) ===
    if ((c._cableParallel || 1) > 1) {
      const _curMode = c.parallelProtection || ''; // '' = inherit GLOBAL
      const _globalMode = GLOBAL.parallelProtection || 'individual';
      const _effLabel = (c._parallelProtectionEff === 'individual')
        ? 'индивидуальная (на каждую жилу + общий)'
        : (c._parallelProtectionEff === 'common' ? 'общая (один автомат на все жилы)' : 'по умолчанию');
      h.push(`<details class="inspector-section" style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Защита параллельных линий</summary>`);
      h.push(`<div class="muted" style="font-size:10.5px;margin-bottom:4px;line-height:1.4">Текущий режим: <b>${_effLabel}</b>. Для «общей» защиты координация In ≤ Iz·n — условная (общий автомат не гарантирует отключение отдельной жилы при её повреждении).</div>`);
      const selOpts = [
        ['',           `— по настройкам проекта (сейчас: ${_globalMode === 'individual' ? 'индивидуальная' : 'общая'})`],
        ['individual', 'Индивидуальная защита (per-line + общий)'],
        ['common',     'Общая защита (один автомат на все жилы)'],
      ].map(([v, l]) => `<option value="${v}"${v === _curMode ? ' selected' : ''}>${l}</option>`).join('');
      h.push(field('Режим', `<select data-conn-prop="parallelProtection">${selOpts}</select>`));
      h.push('</details>');
    }

    h.push('</div>');
  }

  // === УЗО (RCD) ===
  {
    const rcdEnabled = !!c.rcdEnabled;
    const rcdTrip = c.rcdTripMa || 30;
    const rcdAuto = !!c._rcdAutoInstalled;
    const RCD_TYPES = [
      { ma: 30,  label: '30 мА (защита людей)' },
      { ma: 100, label: '100 мА (защита от пожара)' },
      { ma: 300, label: '300 мА (защита от пожара)' },
    ];
    h.push('<details class="inspector-section"' + ((rcdEnabled || rcdAuto) ? ' open' : '') + '>');
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">УЗО (дифф. защита)${rcdAuto ? ' <span style="background:#e8f5e9;color:#2e7d32;font-size:10px;padding:1px 6px;border-radius:3px;margin-left:4px">авто</span>' : ''}</summary>`);
    if (rcdAuto) {
      h.push(`<div style="background:#e8f5e9;border:1px solid #81c784;border-radius:4px;padding:6px;font-size:11px;color:#2e7d32;margin-bottom:6px;line-height:1.4"><b>УЗО установлено автоматически.</b> Проверка петли фаза-ноль (Ik1 ≥ Ia) не прошла — защита обеспечивается УЗО (IΔn=30 мА) по IEC 60364-4-41 §411.3.3. Поставьте галочку «Установить УЗО» для фиксации в BOM и уставок.</div>`);
    }
    h.push(`<div class="field" style="margin-top:4px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-conn-prop="rcdEnabled" ${rcdEnabled ? 'checked' : ''}> Установить УЗО на линию</label></div>`);
    if (rcdEnabled) {
      let rcdOpts = RCD_TYPES.map(t =>
        `<option value="${t.ma}"${t.ma === rcdTrip ? ' selected' : ''}>${t.label}</option>`
      ).join('');
      h.push(field('Ток утечки IΔn', `<select data-conn-prop="rcdTripMa">${rcdOpts}</select>`));
      h.push(`<div style="font-size:11px;color:#555;margin-top:4px;line-height:1.4">
        УЗО обеспечивает защиту от поражения электрическим током при косвенном прикосновении (IEC 60364-4-41).
        При IΔn ≤ 30 мА — дополнительная защита при прямом прикосновении.
      </div>`);
    }
    h.push('</details>');
  }

  // === Результаты расчётных модулей ===
  if (Array.isArray(c._moduleResults) && c._moduleResults.length) {
    h.push(renderConnModuleResultsBlock(c._moduleResults));
  }

  // === TCC-карта защиты линии (Фаза 1.9.2) ===
  // Отображается только если на линии есть автомат или подобран кабель.
  // Содержит кривую автомата + термостойкость кабеля + upstream-автоматы
  // (до 2 уровней вверх) + I_k_max / I_k_min (из модулей).
  if (c._breakerIn || c._cableSize) {
    h.push(`<details class="inspector-section">
      <summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">⚡ Карта защиты (TCC)</summary>
      <div id="tcc-conn-chart-${escAttr(c.id)}" style="margin-top:6px;background:#fafbfc;border:1px solid #e1e4e8;border-radius:4px;padding:8px;font-size:11px;color:#666">
        Загрузка графика…
      </div>
    </details>`);
  }

  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Рукоятки на концах — переключить связь на другой порт. «+» в середине сегмента — добавить точку сплайна. Shift+клик по точке — удалить. Shift+клик по линии — удалить связь.</div>');
  // Кнопка сброса точек сплайна — только если точки есть
  if (Array.isArray(c.waypoints) && c.waypoints.length) {
    h.push(`<button class="full-btn" id="btn-reset-waypoints" style="margin-top:8px">↺ Сбросить траекторию (${c.waypoints.length} точ.)</button>`);
  }
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Отложенно монтируем TCC-график (async import tcc-chart)
  if (c._breakerIn || c._cableSize) {
    _mountConnTccChart(c, fromN, toN);
  }

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
      // Фаза 1.11: при выборе марки кабеля из справочника — автозаполняем
      // материал / изоляцию из записи (если есть информация).
      if (prop === 'cableMark' && v) {
        try {
          const ctRec = getCableType(v);
          if (ctRec) {
            if (ctRec.material === 'Cu' || ctRec.material === 'Al') c.material = ctRec.material;
            if (ctRec.insulation === 'PVC' || ctRec.insulation === 'XLPE' || ctRec.insulation === 'PE') {
              c.insulation = ctRec.insulation === 'PE' ? 'PVC' : ctRec.insulation; // PE→PVC fallback
            }
          }
        } catch {}
      }
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

  // Toggle авто/ручной для кривой автомата
  const brkCurveToggle = inspectorBody.querySelector('[data-brk-curve-toggle]');
  if (brkCurveToggle) {
    brkCurveToggle.addEventListener('click', () => {
      snapshot('brk-curve-mode:' + c.id);
      if (c.breakerCurve) delete c.breakerCurve;
      else c.breakerCurve = c._breakerCurveEff || 'MCB_C';
      render(); renderInspector(); notifyChange();
    });
  }

  // Toggle авто/ручной для уставок регулируемого автомата
  const brkSettingsToggle = inspectorBody.querySelector('[data-brk-settings-toggle]');
  if (brkSettingsToggle) {
    brkSettingsToggle.addEventListener('click', () => {
      snapshot('brk-settings-mode:' + c.id);
      if (c.breakerSettings && Object.keys(c.breakerSettings).length > 0) {
        delete c.breakerSettings;
      } else if (c._breakerSettings) {
        c.breakerSettings = {
          Ir: c._breakerSettings.Ir, Isd: c._breakerSettings.Isd,
          tsd: c._breakerSettings.tsd, Ii: c._breakerSettings.Ii,
        };
      }
      render(); renderInspector(); notifyChange();
    });
  }

  // Редактирование уставок вручную
  inspectorBody.querySelectorAll('[data-brk-setting]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.getAttribute('data-brk-setting');
      const v = Number(el.value);
      if (!c.breakerSettings) c.breakerSettings = {};
      c.breakerSettings[key] = v;
      snapshot('brk-setting:' + c.id + ':' + key);
      render(); renderInspector(); notifyChange();
    });
  });

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

// ===== Рендер блока «Расчётные модули» в инспекторе линии =====
// Получает c._moduleResults (массив из runCalcModules) и возвращает HTML
// collapsed <details> со списком модулей. Каждый модуль — компактная
// строка с иконкой статуса (OK/warn/skip) и ключевыми показателями.
// Нажатие «▸» разворачивает подробности каждого модуля.
function renderConnModuleResultsBlock(modResults) {
  const fmtN = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d ?? 2) : '—';
  // Сводка: сколько прошло / провалило / пропущено
  let okCount = 0, failCount = 0, skipCount = 0;
  for (const m of modResults) {
    const d = m.result && m.result.details || {};
    if (d.skipped) skipCount++;
    else if (m.result && m.result.pass) okCount++;
    else failCount++;
  }
  const summaryBadge = failCount > 0
    ? `<span style="background:#ffebee;color:#c62828;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">⚠ ${failCount} проблем</span>`
    : (okCount > 0 ? `<span style="background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">✓ OK</span>` : '');
  const subtle = `<span class="muted" style="font-size:10px">${okCount} OK${failCount ? ' · ' + failCount + ' fail' : ''}${skipCount ? ' · ' + skipCount + ' skip' : ''}</span>`;

  const rows = modResults.map(m => {
    const r = m.result || {};
    const d = r.details || {};
    let icon, color;
    if (d.skipped)  { icon = '○'; color = '#9e9e9e'; }
    else if (r.pass){ icon = '✓'; color = '#2e7d32'; }
    else            { icon = '⚠'; color = '#c62828'; }
    let keyInfo = '';
    if (m.id === 'ampacity' && !d.skipped) {
      keyInfo = `S=${d.s} мм² · Iz=${fmtN(d.iDerated, 1)} А · n=${d.parallel || 1}`;
    } else if (m.id === 'vdrop' && !d.skipped) {
      keyInfo = `ΔU=${fmtN(d.dUpct)}% (≤${d.maxPct}%)`;
      if (d.bumpedTo) keyInfo += ` → рекомендуется ${d.bumpedTo} мм²`;
    } else if (m.id === 'economic' && !d.skipped) {
      keyInfo = `j=${d.jEk} А/мм² · S=${d.sStandard} мм²`;
    } else if (m.id === 'shortCircuit' && !d.skipped) {
      keyInfo = `Smin=${d.sRequired} мм² при Ik=${Math.round(d.IkA)} А, tk=${d.tkS} с${d.tkAuto ? ' (авто)' : ''}`;
    } else if (m.id === 'phaseLoop' && !d.skipped) {
      keyInfo = `Zloop=${d.Zloop} Ом · Ik1=${d.Ik1} А · Ia=${d.Ia} А` + (d.rcdEnabled ? ` · УЗО ${d.rcdTripMa} мА` : '');
    } else if (d.skipped) {
      keyInfo = `<span class="muted">${d.reason || 'нет данных'}</span>`;
    }
    const warnsHtml = (r.warnings && r.warnings.length)
      ? `<div style="margin-top:2px;font-size:10px;color:#c62828">⚠ ${r.warnings.map(escHtml).join('<br>⚠ ')}</div>`
      : '';
    return `<div style="padding:4px 6px;border-bottom:1px solid #f0f0f0;font-size:11px;line-height:1.5">
      <div><span style="color:${color};font-weight:600">${icon}</span> <b>${escHtml(m.label)}</b></div>
      <div style="padding-left:16px;color:#555">${keyInfo}</div>
      ${warnsHtml}
    </div>`;
  }).join('');

  return `<details class="inspector-section" ${failCount > 0 ? 'open' : ''}>
    <summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">
      Расчётные модули ${summaryBadge} ${subtle}
    </summary>
    <div style="margin-top:4px;background:#fafafa;border:1px solid #e0e0e0;border-radius:4px">
      ${rows}
    </div>
  </details>`;
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

  // Поддержка и channelType (legacy), и IEC метода.
  // Phase 1.20.50: мэппинг приведён в соответствие с IEC 60364-5-52:
  //   A1/A2 — в теплоизол. стене (в трубе / кабель)
  //   B1 — в трубе на стене, B2 — в коробе / сплошном лотке
  //   C — открыто на стене (clipped), E — перфор. лоток, F — лестн. лоток,
  //   G — одножильные с интервалом в воздухе (без лотка),
  //   D1 — в трубе в земле, D2 — напрямую в земле.
  const ct = ({
    A1: 'insulated_conduit', A2: 'insulated_cable',
    B1: 'conduit', B2: 'tray_solid',
    C: 'wall', E: 'tray_perf', F: 'tray_ladder', G: 'air_spaced',
    D1: 'ground', D2: 'ground_direct',
  })[channelType] || channelType || 'conduit';

  switch (ct) {
    case 'conduit':
      // Труба на стене (B1): штрихованная стена сверху + труба с жилами
      paths = hatch(0, 0, 36, 8) + circSvg(18, 18, 9, 'none', '#888') + dotsSvg(18, 18, 5); break;
    case 'insulated_conduit':
      // Труба в теплоизол. стене (A1): штриховка выше и ниже трубы
      paths = hatch(0, 0, 36, 7) + hatch(0, 27, 36, 7) + circSvg(18, 17, 8, 'none', '#888') + dotsSvg(18, 17, 4.5); break;
    case 'insulated_cable':
      // Кабель в теплоизол. стене (A2): штриховка сверху/снизу + жилы без трубы
      paths = hatch(0, 0, 36, 7) + hatch(0, 27, 36, 7) + dotsSvg(18, 17, 5.5); break;
    case 'tray_solid':
      // Сплошной короб/лоток (B2): замкнутый прямоугольник с жилами
      paths = `<rect x="${2 * scale}" y="${10 * scale}" width="${32 * scale}" height="${14 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 17, 5); break;
    case 'wall':
      // Открыто на стене (C): штриховка стены + жилы прижатые к стене
      paths = hatch(0, 0, 36, 8) + dotsSvg(18, 14, 6); break;
    case 'tray_perf': case 'tray_wire':
      // Перфорированный лоток (E): П-образное дно + жилы над
      paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_ladder':
      // Лестничный лоток (F): вертикальные боковины + перекладина
      paths = `<line x1="${4 * scale}" y1="${16 * scale}" x2="${4 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${32 * scale}" y1="${16 * scale}" x2="${32 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${4 * scale}" y1="${21 * scale}" x2="${32 * scale}" y2="${21 * scale}" stroke="#888" stroke-width="${0.8 * scale}"/>` + dotsSvg(18, 12, 5); break;
    case 'air_spaced': case 'air':
      // Одножильные с интервалами в воздухе (G): 3 жилы поодаль, без лотка
      paths = circSvg(8, 16, 4, 'none', '#555') + circSvg(18, 16, 4, 'none', '#555') + circSvg(28, 16, 4, 'none', '#555') +
              `<line x1="${11 * scale}" y1="${24 * scale}" x2="${15 * scale}" y2="${24 * scale}" stroke="#1976d2" stroke-width="${0.8 * scale}"/>` +
              `<text x="${13 * scale}" y="${23 * scale}" text-anchor="middle" fill="#1976d2" font-size="${6 * scale}">≥Ø</text>`; break;
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
    // touching — окружности касаются (расстояние между центрами = 2r = 12)
    svg = `<circle cx="18" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="18" cy="16" r="2" fill="#555"/><circle cx="30" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="30" cy="16" r="2" fill="#555"/>`;
  }
  return `<svg width="${s}" height="${s * 32 / 48}" viewBox="0 0 48 32">${svg}</svg>`;
}

// ======================================================================
// TCC-карта защиты цепочки линии (Фаза 1.9.2)
// ======================================================================

/**
 * Нормализация curve из нашего формата ('MCB_B', 'MCCB') в формат tcc-curves
 * ('B', 'C', 'D', 'MCCB', 'ACB').
 */
function _normalizeCurveShort(curve) {
  if (!curve) return 'C';
  const m = /^MCB_([BCDKZ])$/i.exec(String(curve));
  if (m) return m[1].toUpperCase();
  return String(curve);
}

/**
 * Коэффициент k для термостойкости кабеля (IEC 60364-4-43).
 */
function _cableK(material, insulation) {
  const m = material === 'Al' ? 'Al' : 'Cu';
  const i = insulation === 'XLPE' ? 'XLPE' : 'PVC';
  const T = { Cu: { PVC: 115, XLPE: 143 }, Al: { PVC: 76, XLPE: 94 } };
  return T[m][i];
}

/**
 * Собрать upstream-цепочку автоматов от текущей линии к источнику.
 * Идём через c.from.nodeId вверх: для каждой промежуточной panel
 * находим входную connection и берём её автомат.
 *
 * Защита от циклов — max 5 уровней (обычно 2-3 достаточно).
 *
 * @returns Array<{ c, In, curveShort, label }>
 */
function _collectUpstreamBreakers(conn) {
  const chain = [];
  const seen = new Set([conn.id]);
  let currentNode = conn.from?.nodeId ? state.nodes.get(conn.from.nodeId) : null;
  let level = 0;
  while (currentNode && level < 5) {
    // Если дошли до источника — стоп
    if (currentNode.type === 'source' || currentNode.type === 'generator') break;
    // Для panel/ups ищем входную connection с автоматом
    let upConn = null;
    for (const cc of state.conns.values()) {
      if (cc.to?.nodeId === currentNode.id && !seen.has(cc.id) && cc._breakerIn) {
        upConn = cc;
        break;
      }
    }
    if (!upConn) break;
    seen.add(upConn.id);
    chain.push({
      c: upConn,
      In: Number(upConn._breakerIn) || 0,
      curveShort: _normalizeCurveShort(upConn.breakerCurve || upConn._breakerCurveEff),
      label: `Upstream L${level + 1}: ${upConn.breakerCurve || 'MCCB'} ${upConn._breakerIn}A`,
    });
    currentNode = upConn.from?.nodeId ? state.nodes.get(upConn.from.nodeId) : null;
    level++;
  }
  return chain;
}

/**
 * Монтирует TCC-карту защиты в #tcc-conn-chart-<id>.
 */
// Phase 1.20.12: вынесена в отдельную функцию сборка items для TCC
// графика из conn (breaker + cable + upstream), чтобы вызывать модалку
// и из cable-table (openConnTccDirect).
function _buildConnTccPayload(conn, fromN, toN) {
  const items = [];
  // Phase 1.19.15: если линия выходит из MV-ячейки с уставками реле —
  // используем их (Ir/Isd/tsd/Ii) вместо фиксированной In+curve.
  // Находим соответствующую ячейку в fromN.mvCells по индексу порта вывода.
  let mvCellSettings = null;
  if (fromN?.isMv && Array.isArray(fromN.mvCells)) {
    const feeders = fromN.mvCells.filter(cc => cc.type === 'feeder' || cc.type === 'transformer-protect');
    // conn.from.port указывает на выход — сопоставим с порядком feeder-ячеек
    const port = Number(conn.from?.port) || 0;
    const cell = feeders[port] || feeders[0];
    if (cell && cell.settings && Number(cell.settings.Ir) > 0) {
      mvCellSettings = cell.settings;
    }
  }
  // Текущий автомат (защита данной линии)
  // Phase 1.20.38: для групповых потребителей _breakerIn=null, но
  // _breakerPerLine содержит реальный номинал (по одному автомату на
  // параллельную линию). Раньше this-breaker кривая не рисовалась.
  const breakerInEff = Number(conn._breakerIn) || Number(conn._breakerPerLine) || 0;
  const breakerCount = Number(conn._breakerCount) || 1;
  if (breakerInEff || mvCellSettings) {
    const In = breakerInEff || Number(mvCellSettings?.Ir) || 630;
    const curveStr = conn.breakerCurve || conn._breakerCurveEff || 'MCCB';
    // Настройки регулируемого автомата (MCCB/ACB/VCB): приоритет mvCellSettings
    // (реле ячейки СН), затем _breakerSettings (авто/ручная настройка LV MCCB/ACB).
    const adjSettings = mvCellSettings
      || (conn._breakerSettings && Object.keys(conn._breakerSettings).length
          ? { Ir: conn._breakerSettings.Ir, Isd: conn._breakerSettings.Isd,
              tsd: conn._breakerSettings.tsd, Ii: conn._breakerSettings.Ii }
          : null);
    let label;
    if (mvCellSettings) {
      label = `ЭТА линия: VCB-реле Ir ${mvCellSettings.Ir}А · Isd ${mvCellSettings.Isd}А · tsd ${mvCellSettings.tsd}с`;
    } else if (adjSettings) {
      label = `ЭТА линия: ${curveStr} Ir ${adjSettings.Ir}А · Isd ${adjSettings.Isd}А · tsd ${adjSettings.tsd}с`;
    } else if (!conn._breakerIn && conn._breakerPerLine && breakerCount > 1) {
      // групповая: «3 × 6A»
      label = `ЭТА линия: ${curveStr} ${breakerCount} × ${In}A (групповая)`;
    } else {
      label = `ЭТА линия: ${curveStr} ${In}A`;
    }
    items.push({
      id: 'this-breaker',
      kind: 'breaker',
      In,
      curve: _normalizeCurveShort(conn.breakerCurve || conn._breakerCurveEff),
      settings: adjSettings || undefined,
      label,
      color: '#1976d2',
    });
  }
  // Кабель (термостойкость)
  if (conn._cableSize) {
    const k = _cableK(conn.material || GLOBAL.defaultMaterial, conn.insulation || GLOBAL.defaultInsulation);
    items.push({
      id: 'this-cable',
      kind: 'cable',
      S_mm2: Number(conn._cableSize),
      k,
      label: `Кабель ${conn.material || 'Cu'}/${conn.insulation || 'PVC'} ${conn._cableSize} мм² (k=${k})`,
      color: '#d32f2f',
    });
  }
  // Upstream автоматы (до 2 уровней достаточно для обзора)
  const upstream = _collectUpstreamBreakers(conn);
  for (let i = 0; i < Math.min(upstream.length, 2); i++) {
    const u = upstream[i];
    items.push({
      id: 'up' + i,
      kind: 'breaker',
      In: u.In,
      curve: u.curveShort,
      label: u.label,
      color: i === 0 ? '#f57c00' : '#7b1fa2',
    });
  }

  // I_k: максимум из модулей phase-loop
  const mod = conn._moduleResults?.find(m => m.id === 'phaseLoop');
  const ikMin = mod?.result?.details?.Ik1 ? Number(mod.result.details.Ik1) : null;
  const ikMax = Number(GLOBAL.Ik_kA || 0) * 1000 || null;

  // Диапазон оси X: от 0.5 × min(In) до max(Ik, In × 200)
  const allIn = items.filter(it => it.kind === 'breaker').map(it => it.In);
  const minIn = allIn.length ? Math.min(...allIn) : 16;
  const maxIn = allIn.length ? Math.max(...allIn) : 100;
  const xMax = Math.max(ikMax || 0, maxIn * 200, 10000);

  return { items, xMin: Math.max(1, minIn * 0.5), xMax, ikMin, ikMax };
}

async function _mountConnTccChart(conn, fromN, toN) {
  if (!_tccChartMod) {
    try {
      _tccChartMod = await import('../../../shared/tcc-chart.js');
    } catch (e) {
      console.warn('[conn-tcc] tcc-chart load failed', e);
      return;
    }
  }
  const container = document.getElementById('tcc-conn-chart-' + conn.id);
  if (!container) return;
  container.innerHTML = '';

  const { items, xMin, xMax, ikMin, ikMax } = _buildConnTccPayload(conn, fromN, toN);

  _tccChartMod.mountTccChart(container, {
    items,
    xRange: [xMin, xMax],
    yRange: [0.003, 10000],
    width: Math.min(container.clientWidth || 420, 560),
    height: 320,
    ikMax, ikMin,
  });

  // Кнопка «Открыть в модальном окне» — увеличенный график с карточками Ir/Isd
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'full-btn';
  btn.style.cssText = 'margin-top:6px;font-size:11px;padding:5px 10px;background:#f0f4ff;border:1px solid #d0d7e8;color:#1976d2;border-radius:4px;cursor:pointer';
  btn.textContent = '⤢ Открыть в большом окне (с ползунками Ir/Isd)';
  btn.addEventListener('click', () => {
    _tccChartMod.openTccModal({
      items,
      ikMax, ikMin,
      title: `Карта защиты линии: ${fromN?.name || fromN?.tag || '?'} → ${toN?.name || toN?.tag || '?'}`,
    });
  });
  container.appendChild(btn);

  // Подсказка под графиком
  const hint = document.createElement('div');
  hint.className = 'muted';
  hint.style.cssText = 'font-size:10px;margin-top:6px;line-height:1.5';
  hint.innerHTML = `
    <b>Чтение графика:</b><br>
    🔵 Эта линия — автомат защиты (залитая полоса — диапазон срабатывания по IEC 60898).
    🔴 Пунктир — термостойкость подобранного кабеля.
    🟠🟣 Upstream — вышестоящие автоматы (селективность ОК когда их полосы выше и правее).
    ${ikMax ? `<br>I<sub>k</sub> max = ${_fmtA(ikMax)}, ` : ''}
    ${ikMin ? `I<sub>k</sub> min = ${_fmtA(ikMin)}` : ''}
  `;
  container.appendChild(hint);
}

function _fmtA(I) {
  if (!I) return '—';
  return I >= 1000 ? (I / 1000).toFixed(I >= 10000 ? 0 : 1) + ' кА' : Math.round(I) + ' А';
}

/**
 * Phase 1.20.12: открыть TCC-модалку для указанной линии напрямую
 * (из cable-table row, без открытия инспектора). Асинхронная —
 * выполняет lazy-import tcc-chart при первом вызове.
 */
export async function openConnTccDirect(connId) {
  const conn = state.conns.get(connId);
  if (!conn) return false;
  const fromN = state.nodes.get(conn.from?.nodeId);
  const toN = state.nodes.get(conn.to?.nodeId);
  if (!_tccChartMod) {
    try {
      _tccChartMod = await import('../../../shared/tcc-chart.js');
    } catch (e) {
      console.warn('[conn-tcc] tcc-chart load failed', e);
      return false;
    }
  }
  const { items, ikMin, ikMax } = _buildConnTccPayload(conn, fromN, toN);
  if (!items.length) {
    try { window.Raschet?.flash?.('У линии нет защитного аппарата и/или кабеля для построения графика', 'warn'); } catch {}
    return false;
  }
  _tccChartMod.openTccModal({
    items,
    ikMax, ikMin,
    title: `Карта защиты линии: ${fromN?.name || fromN?.tag || '?'} → ${toN?.name || toN?.tag || '?'}`,
  });
  return true;
}
