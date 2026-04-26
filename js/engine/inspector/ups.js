// Инспектор и модалки для ИБП: параметры, управление, статус-блок.
// Выделено из inspector.js для поддержки. Использует прямые импорты
// зависимостей (render/history/utils) — инъекция не нужна.
import { GLOBAL, autoUpsBreakerNominals } from '../constants.js';
import { escHtml, escAttr, fmt, field, flash } from '../utils.js';
import { effectiveOn } from '../modes.js';
import { effectiveTag } from '../zones.js';
import { nodeVoltage, isThreePhase, computeCurrentA, upsChargeKw, formatVoltageLevelLabel } from '../electrical.js';
import { snapshot, notifyChange } from '../history.js';
import { render } from '../render.js';
import { mountBatteryPicker } from '../../../shared/battery-picker.js';
import { readUpsDcParams, mountUpsPicker, applyUpsModel } from '../../../shared/ups-picker.js';
import { listUpses } from '../../../shared/ups-catalog.js';
// v0.59.386: реестр типов ИБП-плагинов (см. shared/ups-types/).
import { listUpsTypes, getUpsType, detectUpsType, getUpsTypeOrFallback } from '../../../shared/ups-types/index.js';
import { syncIntegratedUpsComposite, getIntegratedUpsExternalConns } from '../ups-composite.js';
// v0.59.416: единый модуль логики Kehua S³ — DRY с battery-calc.
import { isS3Module as _isS3Module, resolveS3Wiring as _resolveS3Wiring,
         computeS3Configuration as _computeS3Configuration } from '../../../shared/battery-s3-logic.js';
// v0.59.429: плагин типа АКБ S³ для автосборки шкафов в модалке инспектора.
import { s3LiIonType as _s3LiIonType } from '../../../shared/battery-types/s3-li-ion.js';

// forward-объявление — renderInspector устанавливается через bind
let _renderInspector = null;
export function bindInspectorUpsDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}
// v0.58.6: обёртка модалок во вкладки систем
let _wrapTabs = null;
export function bindWrapModalTabs(fn) { _wrapTabs = fn; }
function _wrapModalWithSystemTabs(bodyEl, n) {
  if (_wrapTabs) try { _wrapTabs(bodyEl, n); } catch {}
}

// ================= Модалка «Параметры ИБП» =================
export function openUpsParamsModal(n) {
  const body = document.getElementById('ups-params-body');
  if (!body) return;
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="up-name" value="${escAttr(n.name || '')}">`));

  // === Модель из справочника ИБП (shared/ups-catalog + shared/ups-picker) ===
  // Тот же каскадный пикер, что и в подпрограмме «Конфигуратор ИБП». При
  // выборе модели её паспортные параметры (capacityKw, efficiency, cosPhi,
  // vdcMin/max, frame/module) применяются к узлу через applyUpsModel().
  try {
    const upsCatalog = listUpses();
    if (upsCatalog.length) {
      h.push('<h4 style="margin:14px 0 6px">Модель из справочника</h4>');
      h.push('<div id="up-cat-picker-mount" style="margin-bottom:4px"></div>');
      h.push(`<div class="muted" style="font-size:11px;margin:-2px 0 8px">При выборе модели автоматически заполняются тип / номинал / КПД / cos φ / V<sub>DC</sub>.</div>`);
    } else {
      h.push(`<div class="muted" style="font-size:11px;margin:10px 0 6px;padding:8px 10px;background:#f6f8fa;border-radius:4px">
        Справочник ИБП пуст. Добавьте модели в подпрограмме «Конфигуратор ИБП» (кнопка ниже), чтобы выбирать их здесь одним кликом.
      </div>`);
    }
    // Кнопка перехода в полноформатный конфигуратор (Фаза 1.4.2).
    // Передаём nodeId + capacityKw через query — чтобы конфигуратор мог
    // (в будущем) пред-отфильтровать справочник или открыть текущую модель.
    // v0.57.87 (Phase 1.4.5): передаём в wizard все доступные параметры
    // узла, чтобы шаг «Исходные данные» предзаполнился из схемы, а не из
    // дефолтов. Пустые поля опускаем — wizard подставит свои fallback.
    const qp = new URLSearchParams();
    qp.set('nodeId', n.id);
    if (n.upsCatalogId) qp.set('selected', n.upsCatalogId);
    if (n.capacityKw) qp.set('capacityKw', String(n.capacityKw));
    if (n.upsType) qp.set('upsType', n.upsType);
    if (n.batteryAutonomyMin) qp.set('targetAutonomyMin', String(n.batteryAutonomyMin));
    if (n.redundancyScheme) qp.set('redundancy', n.redundancyScheme);
    if (n.batteryVdcMin) qp.set('vdcMin', String(n.batteryVdcMin));
    if (n.batteryVdcMax) qp.set('vdcMax', String(n.batteryVdcMax));
    if (n.cosPhi) qp.set('cosPhi', String(n.cosPhi));
    qp.set('phases', isThreePhase(n) ? '3' : '1');
    h.push(`<div style="margin:4px 0 10px">
      <a href="ups-config/?${qp.toString()}" target="_blank" class="full-btn" style="display:block;text-align:center;padding:6px 10px;background:#f0f4ff;color:#1976d2;text-decoration:none;border:1px solid #d0d7e8;border-radius:4px;font-size:12px">
        ⚙ Сконфигурировать подробно (новая вкладка)
      </a>
    </div>`);
  } catch (e) { /* модуль опционален */ }

  // Приём модели из standalone-сессии Конфигуратора ИБП
  // (ups-config открыт из Hub без nodeId, пользователь выбрал модель
  //  и нажал «⬆ Выбрать эту модель» — она легла в lastUpsConfig.v1).
  try {
    const rawLast = localStorage.getItem('raschet.lastUpsConfig.v1');
    if (rawLast) {
      const last = JSON.parse(rawLast);
      const ageMin = last?.selectedAt ? Math.round((Date.now() - last.selectedAt) / 60000) : null;
      const fresh = ageMin != null && ageMin < 24 * 60; // 24 часа
      if (fresh && last.ups && (last.ups.supplier || last.ups.model)) {
        h.push(`<div style="margin:6px 0 10px;padding:8px 10px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;font-size:12px">
          <div style="margin-bottom:6px">В Конфигураторе ИБП выбрано: <b>${escHtml(last.ups.supplier || '')} · ${escHtml(last.ups.model || '')}</b> <span style="color:#888;font-size:11px">(${ageMin} мин назад)</span></div>
          <button id="up-apply-last-config" class="btn-sm btn-primary" style="margin-right:6px">⬇ Применить из Конфигуратора</button>
          <button id="up-clear-last-config" class="btn-sm">✕ Забыть</button>
        </div>`);
      }
    }
  } catch {}

  // v0.59.408: если узел привязан к каталожной модели — паспортные
  // параметры заблокированы. Пользователь может менять только проектные
  // настройки (резервирование, установлено модулей, breakers).
  const _isFromCatalog = !!n.upsCatalogId;
  const _lockAttr = _isFromCatalog ? ' readonly title="🔒 Параметр из справочника — нельзя менять при выбранной модели. Сбросьте модель в каскадном пикере выше для ручной правки." style="background:#f0f0f0;cursor:not-allowed"' : '';
  const _lockSelAttr = _isFromCatalog ? ' disabled title="🔒 Параметр из справочника — сбросьте модель для ручной правки"' : '';

  h.push('<h4 style="margin:14px 0 6px">Ручной ввод параметров</h4>');
  if (_isFromCatalog) {
    h.push(`<div style="font-size:11.5px;margin:-2px 0 10px;padding:8px 10px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;line-height:1.5">
      🔒 <b>Паспортные параметры заблокированы</b> — модель выбрана из справочника. Тип, КПД, V<sub>DC</sub> мин/макс, корпус, мощность модуля и слоты редактировать нельзя. Для ручной правки сбросьте модель в каскадном пикере выше (Производитель/Серия/Модель → пустое значение).
    </div>`);
  } else {
    h.push(`<div class="muted" style="font-size:11px;margin:-2px 0 8px">Если модель не из справочника и конфигуратор не нужен — заполняйте поля ниже вручную. Для моноблока доступно поле «Выходная мощность», для модульного — frame/модули/резерв.</div>`);
  }
  // Тип ИБП — опции собираются из реестра плагинов (v0.59.386).
  // Текущий тип распознаётся через detectUpsType(n) с фолбэком на 'monoblock'.
  const _curType = detectUpsType(n) || getUpsType('monoblock');
  const _typeOpts = listUpsTypes().map(t =>
    `<option value="${t.id}"${t.id === _curType.id ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  h.push(field('Тип ИБП', `<select id="up-upsType"${_lockSelAttr}>${_typeOpts}</select>`));
  // Для моноблока — прямое поле мощности. Для модульного — вычисляется ниже.
  if (n.upsType !== 'modular') {
    h.push(field('Выходная мощность, kW', `<input type="number" id="up-capKw" min="0" step="0.1" value="${n.capacityKw}"${_lockAttr}>`));
  } else {
    h.push(`<div class="muted" style="font-size:11px;margin:-4px 0 8px;padding:6px 8px;background:#fff8e1;border-radius:4px;border:1px solid #ffe0a0">
      Для модульного ИБП мощность считается автоматически из frame/модулей/резерва (см. блок «Модули и резервирование» ниже). Чтобы ввести мощность вручную — переключите тип на «Моноблок».
    </div>`);
  }
  h.push(field('КПД DC–AC, %', `<input type="number" id="up-eff" min="30" max="100" step="1" value="${n.efficiency}"${_lockAttr}>`));
  h.push(field('Входов', `<input type="number" id="up-inputs" min="1" max="2" step="1" value="${Math.min(2, Math.max(1, Number(n.inputs) || 1))}"${_lockAttr}>`));
  h.push(field('Выходов', `<input type="number" id="up-outputs" min="1" max="20" step="1" value="${n.outputs}"${_lockAttr}>`));

  // Параметры DC-входа (батарейной цепи): диапазон напряжения инвертора.
  // Используется при каталожном подборе АКБ для расчёта min/max числа
  // блоков в цепочке (см. UPS battery modal, каталожный режим).
  h.push('<h4 style="margin:16px 0 8px">Параметры DC-входа (батарейная цепь)</h4>');
  h.push('<div style="display:flex;gap:8px">');
  h.push(`<div style="flex:1">${field('V<sub>DC</sub> min, В',
    `<input type="number" id="up-vdcMin" min="24" max="1200" step="1" value="${Number(n.batteryVdcMin ?? 340)}"${_lockAttr}>`)}</div>`);
  h.push(`<div style="flex:1">${field('V<sub>DC</sub> max, В',
    `<input type="number" id="up-vdcMax" min="24" max="1200" step="1" value="${Number(n.batteryVdcMax ?? 480)}"${_lockAttr}>`)}</div>`);
  h.push('</div>');
  h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Рабочий диапазон напряжения инвертора на стороне АКБ. Определяет допустимое число блоков в цепочке при подборе АКБ из справочника.</div>');

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
    h.push(`<div style="flex:1">${field('Корпус, kW (frame)', `<input type="number" id="up-frameKw" min="1" step="5" value="${n.frameKw}"${_lockAttr}>`)}</div>`);
    h.push(`<div style="flex:1">${field('Мощность модуля, kW', `<input type="number" id="up-modKwRated" min="1" step="0.5" value="${n.moduleKwRated}"${_lockAttr}>`)}</div>`);
    h.push('</div>');
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Слотов в корпусе', `<input type="number" id="up-slots" min="1" max="32" step="1" value="${n.moduleSlots}"${_lockAttr}>`)}</div>`);
    h.push(`<div style="flex:1">${field('Установлено модулей <span class="muted" style="font-size:10px;font-weight:400">· проектное</span>', `<input type="number" id="up-installed" min="0" max="32" step="1" value="${n.moduleInstalled}">`)}</div>`);
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

  // v0.59.388: блок «Интегрированные компоненты» для типа integrated.
  // Показывает встроенный АВР и список распред. панелей PDM (read-only).
  // Источник истины — сам узел (n.hasIntegratedAts, n.pdmModules).
  if (n.kind === 'ups-integrated') {
    h.push('<h4 style="margin:16px 0 8px">Интегрированные компоненты</h4>');
    const atsLine = n.hasIntegratedAts
      ? '<b>Входной АВР:</b> встроенный (2 ввода с автоматическим переключением)'
      : '<b>Входной АВР:</b> нет (1 ввод через MCCB)';
    const pdms = Array.isArray(n.pdmModules) ? n.pdmModules : [];
    const pdmRows = pdms.length
      ? pdms.map(p => {
          const src = p.source === 'utility'  ? 'сеть'
                    : p.source === 'inverter' ? 'инвертор'
                    : p.source === 'bypass'   ? 'байпас'
                    : (p.source || '—');
          return `<li><b>${escHtml(p.label || p.id)}</b> · ${escHtml(src)} · ${Number(p.maxBreakers) || 0}×${escHtml(p.polarity || '1P')}</li>`;
        }).join('')
      : '<li class="muted">Распределительные панели не настроены</li>';
    const cab = (n.cabinetWidthMm || n.cabinetDepthMm || n.cabinetHeightMm)
      ? `<div class="muted" style="font-size:11px;margin-top:6px">Габариты шкафа: ${n.cabinetWidthMm || '—'} × ${n.cabinetDepthMm || '—'} × ${n.cabinetHeightMm || '—'} мм</div>`
      : '';
    h.push(`<div class="muted" style="font-size:11.5px;line-height:1.65;padding:8px 10px;background:#f0f7ff;border-radius:6px;border:1px solid #cfe2ff">
      ${atsLine}
      <div style="margin-top:6px"><b>Распред. панели (PDM):</b></div>
      <ul style="margin:4px 0 0 18px;padding:0">${pdmRows}</ul>
      ${cab}
      <div style="margin-top:6px;font-size:10.5px;color:#666">Параметры берутся из каталога при выборе модели и попадают в BOM (категории «Встроенный АВР ИБП», «Распред. панели ИБП (PDM)»).</div>
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
  h.push('<div class="muted" style="font-size:10.5px;margin-bottom:4px;line-height:1.4">Пусто = использовать расчётный по мощности ИБП. Значение применяется и к линиям (QF3 — линии от ИБП, QF1/QF2 — линии к ИБП). Эти автоматы входят в состав ИБП и не попадают в спецификацию.</div>');
  const _auto = autoUpsBreakerNominals(n);
  const noms = [
    ['inputBreakerIn',       'In QF1 (вводной), A',        _auto.input],
    ['inputBypassBreakerIn', 'In QF2 (вх. байпаса), A',    _auto.inputBypass],
    ['outputBreakerIn',      'In QF3 (выходной), A',       _auto.output],
    ['bypassBreakerIn',      'In QF4 (байпас), A',         _auto.bypass],
    ['batteryBreakerIn',     'In QB (батарея), A',         _auto.battery],
  ];
  for (const [key, label, auto] of noms) {
    const v = n[key] ?? '';
    const ph = auto ? `авто ≈ ${auto}` : 'авто';
    h.push(field(label, `<input type="number" id="up-${key}" min="0" step="1" value="${v}" placeholder="${ph}">`));
  }
  h.push('</details>');

  // Напряжение
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(levels[i]))}</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="up-voltage">${vOpts}</select>`));
  h.push(field('cos φ', `<input type="number" id="up-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi || 1.0}"${_lockAttr}>`));

  // Блок «Батарея (АКБ)» полностью перенесён в отдельную модалку
  // «🔋 АКБ» (кнопка в инспекторе ИБП). Здесь — только короткая ссылка.
  {
    const cells = Number(n.batteryCellCount ?? 192) || 0;
    const cellV = Number(n.batteryCellVoltage ?? 2.0) || 0;
    const blockV = cells * cellV;
    const pct = Math.round(Number(n.batteryChargePct ?? 100) || 0);
    h.push(`<div class="muted" style="font-size:11px;margin:14px 0 4px;padding:8px 10px;background:#f6f8fa;border-radius:6px">
      🔋 АКБ: ${n.batteryType === 'li-ion' ? 'Li-Ion' : 'VRLA'}
      · блок DC <b>${fmt(blockV)} В</b> · заряд <b>${pct}%</b><br>
      Настройки батареи (тип, элементы, напряжение, ёмкость, цепочки,
      ток заряда) — в отдельной модалке <b>«🔋 АКБ»</b> в инспекторе ИБП.
    </div>`);
  }

  // ================= Байпас обслуживания (Maintenance bypass) =================
  // К maintenance-байпасу относится выбор «перемычка / отдельный кабель»:
  // по физике это механическая перемычка вокруг ИБП (или отдельный
  // кабель), а не статический электронный SBS.
  h.push('<h4 style="margin:16px 0 8px">Байпас обслуживания (QF4)</h4>');
  {
    const mode = n.bypassFeedMode || 'jumper';
    h.push(field('Подключение байпаса',
      `<select id="up-bypassMode">
        <option value="jumper"${mode === 'jumper' ? ' selected' : ''}>Перемычка от основного ввода</option>
        <option value="separate"${mode === 'separate' ? ' selected' : ''}>Отдельный кабель</option>
      </select>`));
    if (mode === 'separate') {
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px;color:#1565c0">В режиме «отдельный кабель» у ИБП должно быть ≥ 2 входов: порт 1 — основной, порт 2 — байпасный. Подведите два независимых фидера.</div>');
    } else {
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Байпас подключён перемычкой от основного ввода (один кабель на ИБП).</div>');
    }
  }

  // ================= Статический байпас (SBS) =================
  // Только конфигурационные флаги. Оперативные команды (принудительный
  // байпас, авто-переход по перегрузу с порогом) — в «Управлении ИБП».
  h.push('<h4 style="margin:16px 0 8px">Статический байпас (SBS)</h4>');
  h.push(`<div class="field check"><input type="checkbox" id="up-bypass"${n.staticBypass !== false ? ' checked' : ''}><label>Байпас разрешён (допускается переход на SBS)</label></div>`);
  h.push('<div class="muted" style="font-size:11px;margin-top:-6px">Принудительная активация SBS, разрешение авто-перехода и порог перегруза — в модалке <b>«🔌 Управление ИБП»</b>.</div>');

  body.innerHTML = h.join('');
  _wrapModalWithSystemTabs(body, n);

  // Монтируем каскадный пикер ИБП (если справочник не пуст).
  try {
    const upsCatalog = listUpses();
    const upsPickerMount = document.getElementById('up-cat-picker-mount');
    if (upsCatalog.length && upsPickerMount) {
      // В инспекторе ИБП показываем ТОЛЬКО полнокомплектные ИБП:
      // классические (без kind) и интегрированные (kind:'ups-integrated').
      // Исключаются BOM-заготовки: фреймы, силовые модули, батарейные шкафы.
      // v0.59.411: добавлен 'ups-integrated' — ранее ошибочно отсеивался,
      // и MR3390-B/MR33150-S не появлялись в каскадном пикере инспектора.
      const upsOnly = upsCatalog.filter(u =>
        !u.kind || u.kind === 'ups' || u.kind === 'ups-integrated'
      );
      mountUpsPicker(upsPickerMount, {
        list: upsOnly,
        selectedId: n.upsCatalogId || null,
        currentSupplier: n._upsSelSupplier || '',
        currentSeries: n._upsSelSeries || '',
        placeholders: { supplier: '— не выбрано —', series: '— не выбрано —', model: '— свой состав —' },
        labels: { supplier: 'Производитель', series: 'Серия', model: 'Модель' },
        idPrefix: 'up-cat',
        onChange: (st) => {
          n._upsSelSupplier = st.supplier || null;
          n._upsSelSeries = st.series || null;
          if (st.modelId && st.ups && st.modelId !== n.upsCatalogId) {
            // v0.59.395: блокируем смену модели, если к ИБП (или его композиту)
            // уже подключены кабели — пользователь должен сперва их отключить.
            const ext = getIntegratedUpsExternalConns(n);
            if (ext.length > 0) {
              flash(`Нельзя сменить модель ИБП: подключено ${ext.length} ${ext.length === 1 ? 'кабель' : 'кабел' + (ext.length < 5 ? 'я' : 'ей')}. Сперва отключите линии от ИБП и распред. панелей.`, 'warn');
              openUpsParamsModal(n); // re-render чтобы откатить selected в picker
              return;
            }
            snapshot('ups-params:' + n.id + ':catalog');
            applyUpsModel(n, st.ups);
            try { syncIntegratedUpsComposite(n.id); } catch (e) { console.warn('[ups-composite]', e); }
            render(); notifyChange();
            openUpsParamsModal(n);
          } else if (!st.modelId && n.upsCatalogId) {
            // Сбрасываем привязку к каталогу, но не трогаем уже
            // применённые паспортные параметры.
            n.upsCatalogId = null;
            openUpsParamsModal(n);
          }
        },
      });
    }
  } catch (e) { /* опционально */ }

  // Кнопки «Применить из Конфигуратора» / «Забыть» — связываем с
  // raschet.lastUpsConfig.v1 (standalone-канал ups-config).
  const applyLastBtn = document.getElementById('up-apply-last-config');
  if (applyLastBtn) applyLastBtn.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem('raschet.lastUpsConfig.v1');
      if (!raw) { flash('Запись Конфигуратора не найдена', 'warn'); return; }
      const last = JSON.parse(raw);
      if (!last || !last.ups) { flash('Некорректная запись Конфигуратора', 'error'); return; }
      // v0.59.395: блокируем замену модели при наличии внешних кабелей.
      const ext2 = getIntegratedUpsExternalConns(n);
      if (ext2.length > 0) {
        flash(`Нельзя применить новую модель ИБП: подключено ${ext2.length} ${ext2.length === 1 ? 'кабель' : 'кабел' + (ext2.length < 5 ? 'я' : 'ей')}. Сперва отключите линии от ИБП и распред. панелей.`, 'warn');
        return;
      }
      snapshot('ups-params:' + n.id + ':lastConfig');
      applyUpsModel(n, last.ups);
      try { syncIntegratedUpsComposite(n.id); } catch (e) { console.warn('[ups-composite]', e); }
      // Если запись от wizard'а — применяем полный configuration
      // (capacityKw реальный, moduleInstalled, redundancyScheme, AКБ-V, автономия)
      const cfg = last.configuration;
      if (cfg) {
        if (cfg.frameId) n.elementId = cfg.frameId;
        if (cfg.upsType) n.upsType = cfg.upsType;
        if (Number.isFinite(cfg.capacityKw)) n.capacityKw = cfg.capacityKw;
        if (Number.isFinite(cfg.moduleInstalled)) n.moduleInstalled = cfg.moduleInstalled;
        if (Number.isFinite(cfg.frameKw)) n.frameKw = cfg.frameKw;
        if (Number.isFinite(cfg.moduleKwRated)) n.moduleKwRated = cfg.moduleKwRated;
        if (Number.isFinite(cfg.moduleSlots)) n.moduleSlots = cfg.moduleSlots;
        if (cfg.redundancyScheme) n.redundancyScheme = cfg.redundancyScheme;
        if (Number.isFinite(cfg.batteryVdcMin)) n.batteryVdcMin = cfg.batteryVdcMin;
        if (Number.isFinite(cfg.batteryVdcMax)) n.batteryVdcMax = cfg.batteryVdcMax;
        if (Number.isFinite(cfg.batteryAutonomyMin)) n.batteryAutonomyMin = cfg.batteryAutonomyMin;
        if (Array.isArray(cfg.composition)) n.composition = cfg.composition;
      }
      render(); notifyChange();
      flash(`Применено: ${last.ups.supplier || ''} · ${last.ups.model || ''}`, 'success');
      openUpsParamsModal(n); // перерисовать модалку с новыми параметрами
    } catch (e) {
      flash('Ошибка применения: ' + (e.message || e), 'error');
    }
  });
  const clearLastBtn = document.getElementById('up-clear-last-config');
  if (clearLastBtn) clearLastBtn.addEventListener('click', () => {
    try { localStorage.removeItem('raschet.lastUpsConfig.v1'); } catch {}
    openUpsParamsModal(n);
  });

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
    // (Поля состава АКБ вынесены в отдельную модалку «АКБ».)
    // DC-вход батарейной цепи — здесь, в параметрах ИБП.
    grab('up-vdcMin', 'batteryVdcMin', true);
    grab('up-vdcMax', 'batteryVdcMax', true);
    // Напряжение и cos
    grab('up-cosPhi', 'cosPhi', true);
    // Байпас (только конфигурационный флаг «разрешён»; авто/порог/принуд.
    // — в модалке Управление ИБП).
    grab('up-bypass', 'staticBypass', false, true);
    // Флаги автоматов
    for (const flag of ['hasInputBreaker','hasInputBypassBreaker','hasOutputBreaker','hasBypassBreaker','hasBatteryBreaker']) {
      grab('up-' + flag, flag, false, true);
    }
  };
  const upsTypeSel = document.getElementById('up-upsType');
  if (upsTypeSel) {
    upsTypeSel.addEventListener('change', () => {
      // v0.59.395: блокируем смену типа при наличии подключённых кабелей.
      const ext = getIntegratedUpsExternalConns(n);
      if (ext.length > 0) {
        const cur = n.kind === 'ups-integrated' ? 'integrated' : (n.upsType || 'monoblock');
        upsTypeSel.value = cur;
        flash(`Нельзя сменить тип ИБП: подключено ${ext.length} ${ext.length === 1 ? 'кабель' : 'кабел' + (ext.length < 5 ? 'я' : 'ей')}. Сперва отключите линии от ИБП и распред. панелей.`, 'warn');
        return;
      }
      snapshotVisibleFields();
      // v0.59.386: применяем дефолты выбранного типа из реестра плагинов.
      // Поля legacy: n.upsType ('monoblock'|'modular') + n.kind для расширенных типов.
      const typeId = upsTypeSel.value || 'monoblock';
      const t = getUpsType(typeId);
      const defs = (t && t.defaults) ? t.defaults() : {};
      // Legacy-mapping: integrated тоже хранит upsType='modular' (frame+modules),
      // но различается по n.kind='ups-integrated'.
      n.upsType = defs.upsType || (typeId === 'modular' ? 'modular' : 'monoblock');
      if (defs.kind) n.kind = defs.kind; else delete n.kind;
      // Применяем недостающие поля типа (только если у узла их ещё нет).
      for (const k of Object.keys(defs)) {
        if (k === 'upsType' || k === 'kind') continue;
        if (n[k] == null) n[k] = defs[k];
      }
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
    // v0.57.68: preserve-on-miss — пользовательские параметры нельзя затирать.
    const readNum = (id, curr) => {
      const el = document.getElementById(id);
      if (!el) return curr;
      const raw = String(el.value ?? '').trim();
      if (raw === '') return curr;
      const v = Number(raw);
      return Number.isFinite(v) ? v : curr;
    };
    // v0.59.386: тип-id из реестра → legacy n.upsType + n.kind.
    const _typeId = document.getElementById('up-upsType')?.value || (detectUpsType(n) || {}).id || 'monoblock';
    const _tApply = getUpsType(_typeId);
    const _defsApply = (_tApply && _tApply.defaults) ? _tApply.defaults() : {};
    n.upsType = _defsApply.upsType || (_typeId === 'modular' ? 'modular' : 'monoblock');
    if (_defsApply.kind) n.kind = _defsApply.kind; else delete n.kind;
    if (n.upsType === 'modular') {
      n.frameKw = Math.max(1, readNum('up-frameKw', n.frameKw ?? 200));
      n.moduleKwRated = Math.max(1, readNum('up-modKwRated', n.moduleKwRated ?? 25));
      n.moduleSlots = Math.max(1, readNum('up-slots', n.moduleSlots ?? 8));
      n.moduleInstalled = Math.max(0, readNum('up-installed', n.moduleInstalled ?? 0));
      n.redundancyScheme = document.getElementById('up-redund')?.value || n.redundancyScheme || 'N';
      const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
      const working = Math.max(0, n.moduleInstalled - redundN);
      n.capacityKw = Math.min(n.frameKw, working * n.moduleKwRated);
      // Синхронизация устаревших полей для обратной совместимости
      n.moduleCount = n.moduleInstalled;
      n.moduleKw = n.moduleKwRated;
    } else {
      n.capacityKw = readNum('up-capKw', n.capacityKw ?? 0);
    }
    n.efficiency = readNum('up-eff', n.efficiency ?? 95);
    n.inputs = Math.min(2, Math.max(1, readNum('up-inputs', n.inputs ?? 1)));
    n.outputs = readNum('up-outputs', n.outputs ?? 1);
    // Флаги состава автоматов
    for (const flag of ['hasInputBreaker','hasInputBypassBreaker','hasOutputBreaker','hasBypassBreaker','hasBatteryBreaker']) {
      n[flag] = document.getElementById('up-' + flag)?.checked !== false;
    }
    // Номиналы автоматов (опциональные)
    for (const key of ['inputBreakerIn','inputBypassBreakerIn','outputBreakerIn','bypassBreakerIn','batteryBreakerIn']) {
      const v = document.getElementById('up-' + key)?.value;
      n[key] = (v === '' || v == null) ? null : (Number(v) || null);
    }
    const vEl = document.getElementById('up-voltage');
    if (vEl && String(vEl.value ?? '').trim() !== '') {
      const vIdx = Number(vEl.value);
      if (Number.isFinite(vIdx)) {
        n.voltageLevelIdx = vIdx;
        if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; n.phase = '3ph'; }
      }
    }
    n.cosPhi = readNum('up-cosPhi', n.cosPhi ?? 1.0);
    // DC-вход батарейной цепи (V_DC min / max)
    const _vdcMin = Number(document.getElementById('up-vdcMin')?.value);
    const _vdcMax = Number(document.getElementById('up-vdcMax')?.value);
    if (Number.isFinite(_vdcMin) && _vdcMin > 0) n.batteryVdcMin = _vdcMin;
    if (Number.isFinite(_vdcMax) && _vdcMax > 0) n.batteryVdcMax = _vdcMax;
    // Параметры АКБ (batteryType/CellCount/CellVoltage/CapacityAh/
    // StringCount/ChargePct/chargeA) — целиком в отдельной модалке «АКБ».
    // Статический байпас: только конфигурационный флаг «разрешён».
    // staticBypassAuto / staticBypassOverloadPct / staticBypassForced —
    // управляются из модалки «🔌 Управление ИБП», здесь не трогаем.
    n.staticBypass = document.getElementById('up-bypass')?.checked !== false;
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
  try {
    _renderUpsControlBody(n);
  } catch (err) {
    console.error('[openUpsControlModal] render error:', err);
    body.innerHTML =
      `<div style="padding:16px;color:#c62828;background:#ffebee;border:1px solid #c62828;border-radius:6px">` +
      `<b>Ошибка отображения управления ИБП</b><br><br>` +
      `<code style="font-size:11px;white-space:pre-wrap">${escHtml(String(err && err.message || err))}</code>` +
      (err && err.stack ? `<details style="margin-top:8px"><summary style="cursor:pointer">stack</summary><pre style="font-size:10px;white-space:pre-wrap">${escHtml(err.stack)}</pre></details>` : '') +
      `</div>`;
  }
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

  // Предупреждение про синхронизацию с сетью — когда активирован байпас
  // (механический maintenance через QF4 ИЛИ статический через SBS).
  // Физически это параллельное соединение входа и выхода ИБП, и если
  // инвертор остаётся в работе, его выход должен быть синхронизирован
  // с сетью по фазе, частоте и амплитуде — иначе большие уравнительные
  // токи и повреждение инвертора.
  const maintQF4On = n.hasBypassBreaker !== false && n.bypassBreakerOn !== false;
  if (onBypass || maintQF4On) {
    h.push(`<div style="margin-bottom:12px;padding:8px 12px;background:#fff3e0;border:1px solid #ef6c00;border-radius:6px;font-size:12px;line-height:1.6;color:#bf360c">
      ⚠ <b>ИБП должен быть синхронизирован с сетью</b>: активна ${onBypass ? 'статическая байпас-цепь (SBS)' : 'механическая байпас-перемычка (QF4)'}
      — вход и выход ИБП параллелятся по сети. Инвертор обязан отслеживать
      фазу, частоту и амплитуду Mains, иначе возможны уравнительные токи.
    </div>`);
  }

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

  {
    let struct;
    try {
      struct = _upsStructSvg(n, { outA, inA, inBypassA, battA, onBypass, onBattery });
    } catch (err) {
      console.error('[_upsStructSvg] error:', err);
      struct = { svg: '', width: 400, height: 100 };
      h.push(`<div style="padding:10px;background:#ffebee;border:1px solid #c62828;border-radius:6px;color:#c62828;font-size:12px;margin-bottom:12px">
        Ошибка отрисовки структурной схемы: ${escHtml(String(err && err.message || err))}
      </div>`);
    }
    const displayH = Math.min(struct.height, 520);
    h.push(`<div style="background:#fff;border:1px solid #dfe2e8;border-radius:6px;padding:12px;margin-bottom:12px;overflow:auto">
      <svg viewBox="0 0 ${struct.width} ${struct.height}" style="width:100%;max-width:100%;height:auto;max-height:${displayH}px" xmlns="http://www.w3.org/2000/svg">${struct.svg}</svg>
    </div>`);
  }

  // Список «Защитные аппараты» удалён — управление автоматами перенесено
  // на клик прямо по автоматам на SVG-схеме (см. data-ups-brk в _svgBreaker).

  h.push('<h4 style="margin:16px 0 6px">Статический байпас</h4>');
  if (n.staticBypass === false) {
    h.push(`<div class="muted" style="font-size:11px;padding:8px 10px;background:#f6f8fa;border-radius:6px;margin-bottom:6px">SBS запрещён в «Параметры ИБП» — принудительный переход и авто-переход недоступны.</div>`);
  } else {
    // Принудительная активация SBS
    h.push(`<div class="ups-ctl-row">
      <div class="ups-ctl-label">Принудительный режим</div>
      <div class="ups-ctl-current">${onBypass ? 'Активен' : 'Неактивен'}</div>
      <button class="ups-ctl-toggle ${n.staticBypassForced ? 'on' : 'off'}" data-ups-flag="staticBypassForced">${n.staticBypassForced ? 'ВКЛ' : 'ОТКЛ'}</button>
    </div>`);
    // Авто-переход + редактируемый порог (в одной строке — toggle и input)
    h.push(`<div class="ups-ctl-row">
      <div class="ups-ctl-label">Авто-переход при перегрузе</div>
      <div class="ups-ctl-current" style="display:flex;align-items:center;gap:6px">
        Порог
        <input type="number" id="ups-ctl-bypassPct" min="80" max="200" step="5"
          value="${n.staticBypassOverloadPct || 110}"
          style="width:60px;padding:3px 6px;font:inherit;font-size:12px;text-align:right">
        %
      </div>
      <button class="ups-ctl-toggle ${n.staticBypassAuto !== false ? 'on' : 'off'}" data-ups-flag="staticBypassAuto">${n.staticBypassAuto !== false ? 'ВКЛ' : 'ОТКЛ'}</button>
    </div>`);
  }

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
  // Редактируемый порог перегруза (перенесён из Параметров ИБП)
  const bypassPctInput = document.getElementById('ups-ctl-bypassPct');
  if (bypassPctInput) {
    bypassPctInput.addEventListener('change', () => {
      snapshot('ups-ctl:' + n.id + ':bypassPct');
      const v = Math.max(80, Math.min(200, Number(bypassPctInput.value) || 110));
      n.staticBypassOverloadPct = v;
      render(); notifyChange(); _renderUpsControlBody(n);
    });
  }
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

// Загрузка справочника АКБ из localStorage. Используется per-user ключ
// 'raschet.batteryCatalog.v1.<uid>' (uid кэшируется main.js в
// 'raschet.currentUserId' на auth onChange). Fallback — legacy-ключ
// 'raschet.batteryCatalog.v1' для чтения старых данных.
function _loadBatteryCatalog() {
  try {
    const uid = localStorage.getItem('raschet.currentUserId') || 'anonymous';
    const raw = localStorage.getItem('raschet.batteryCatalog.v1.' + uid);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    // Legacy fallback
    const legacy = localStorage.getItem('raschet.batteryCatalog.v1');
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) return arr;
    }
    return [];
  } catch { return []; }
}

// Пытается определить supplier ИБП для проверки совместимости с S³.
// Читает ups-catalog (shared), если узел привязан через upsCatalogId.
// Возвращает строку supplier или null.
function _getUpsSupplierGuess(n) {
  if (!n || !n.upsCatalogId) return null;
  try {
    const uid = localStorage.getItem('raschet.currentUserId') || 'anonymous';
    const raw = localStorage.getItem('raschet.upsCatalog.v1.' + uid)
             || localStorage.getItem('raschet.upsCatalog.v1');
    if (!raw) return null;
    const arr = JSON.parse(raw);
    const found = Array.isArray(arr) ? arr.find(u => u.id === n.upsCatalogId) : null;
    return found?.supplier || null;
  } catch { return null; }
}

// Асинхронный динамический импорт battery-discharge.js из подпрограммы
// battery/. Модуль импортируется лениво (только когда реально нужно
// считать по таблице), чтобы конструктор схем не тащил его при загрузке.
let _dischargeModule = null;
async function _loadDischargeModule() {
  if (_dischargeModule) return _dischargeModule;
  try {
    _dischargeModule = await import('../../../battery/battery-discharge.js');
    return _dischargeModule;
  } catch (e) {
    console.warn('[ups] battery-discharge module not available:', e);
    return null;
  }
}

function _renderUpsBatteryBody(n) {
  const body = document.getElementById('ups-battery-body');
  if (!body) return;

  const U = nodeVoltage(n);
  const k3 = isThreePhase(n) ? Math.sqrt(3) : 1;
  // Для расчёта АКБ всегда используем МАКСИМАЛЬНУЮ нагрузку на ИБП
  // (n._maxLoadKw), а не текущую (_loadKw) — батарея должна выдержать
  // наихудший сценарий, а не мгновенное потребление.
  //   _maxLoadKw — максимум по всем сценариям (см. recalc.js)
  //   _loadKw    — текущая (расчётная) нагрузка
  //   capacityKw — номинал ИБП (fallback, если downstream не посчитан)
  const load = n._maxLoadKw || n._loadKw || 0;
  const cap = Number(n.capacityKw) || 0;

  const bt = n.batteryType || 'lead-acid';
  const cells = Number(n.batteryCellCount ?? 192) || 0;
  const cellV = Number(n.batteryCellVoltage ?? 2.0) || 0;
  const ah = Number(n.batteryCapacityAh ?? 100) || 0;
  const strs = Number(n.batteryStringCount ?? 1) || 1;

  // Справочник АКБ (из подпрограммы «Расчёт АКБ»)
  const catalog = _loadBatteryCatalog();
  const blockV = cells * cellV;
  const totalAh = ah * strs;
  const kwh = (blockV * totalAh) / 1000;
  const pctRaw = Number(n.batteryChargePct ?? 100) || 0;
  const pct = Math.round(pctRaw);
  const storedKwh = kwh * pctRaw / 100;
  const loadKw = load > 0 ? load : cap;
  // Базовая оценка автономии — по ёмкости kWh / нагрузке (без Пойкерта).
  const autonomyMin = loadKw > 0 ? (storedKwh / loadKw * 60) : 0;

  // Если выбрана модель из справочника — асинхронно пересчитаем автономию
  // через battery-discharge.js (по таблице Constant Power Discharge)
  // и обновим тело модалки. Здесь считаем простую оценку и рендерим,
  // а точный расчёт подставим позже.
  const selectedBattery = n.batteryCatalogId
    ? catalog.find(b => b.id === n.batteryCatalogId)
    : null;

  const h = [];
  h.push(`<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name || 'ИБП')} · АКБ</h3>`);

  // Сводка (вычисляется при каждом render, обновляется после change)
  h.push(`<div class="muted" style="font-size:12px;line-height:1.9;padding:10px 12px;background:#f6f8fa;border-radius:6px;margin-bottom:12px">
    Напряжение блока DC: <b>${fmt(blockV)} В</b><br>
    Полная ёмкость: <b>${fmt(totalAh)} А·ч</b> / <b>${fmt(kwh)} kWh</b><br>
    Заряд: <b>${pct}%</b> → запас <b>${fmt(storedKwh)} kWh</b><br>
    Оценка автономии на <b>макс.</b> нагрузке ${fmt(loadKw)} kW:
    <b id="ups-batt-autonomy">${autonomyMin > 0 ? fmt(autonomyMin) + ' мин' : '—'}</b>
    <span id="ups-batt-autonomy-method" class="muted" style="font-size:10px;margin-left:4px">(по kWh)</span>
  </div>`);

  // Выбор модели из справочника АКБ — единый shared/battery-picker.js
  // (тот же компонент используется в подпрограмме «Расчёт АКБ»).
  if (catalog.length) {
    h.push('<h4 style="margin:8px 0 6px">Модель из справочника</h4>');
    h.push('<div id="ups-batt-picker-mount" style="margin-bottom:6px"></div>');
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:4px">При выборе модели автоматически заполняются тип / напряжение / количество элементов / ёмкость.</div>`);
  } else {
    h.push(`<div class="muted" style="font-size:11px;margin:8px 0;padding:8px 10px;background:#f6f8fa;border-radius:4px">
      Справочник АКБ пуст. Загрузите XLSX-данные производителя в подпрограмме «Расчёт АКБ» (кнопка ниже).
    </div>`);
  }
  // Кнопка перехода в полноформатный калькулятор АКБ (Фаза 1.4.4).
  // Передаём nodeId + параметры ИБП для предзаполнения расчёта.
  {
    const qp2 = new URLSearchParams();
    qp2.set('nodeId', n.id);
    if (n.capacityKw) qp2.set('loadKw', String(n.capacityKw));
    if (n.batteryVdcMin) qp2.set('vdcMin', String(n.batteryVdcMin));
    if (n.batteryVdcMax) qp2.set('vdcMax', String(n.batteryVdcMax));
    if (n.batteryCatalogId) qp2.set('selected', n.batteryCatalogId);
    if (n.batteryAutonomyMin) qp2.set('autonomyMin', String(n.batteryAutonomyMin));
    // v0.59.419: КПД инвертора передаём из паспорта ИБП (n.efficiency, %).
    // В battery-calc он попадает в поле «КПД инвертора ИБП» и блокируется.
    if (Number.isFinite(Number(n.efficiency)) && Number(n.efficiency) > 0) qp2.set('invEff', String(Number(n.efficiency)));
    h.push(`<div style="margin:4px 0 10px">
      <a href="battery/?${qp2.toString()}" target="_blank" class="full-btn" style="display:block;text-align:center;padding:6px 10px;background:#f0f4ff;color:#1976d2;text-decoration:none;border:1px solid #d0d7e8;border-radius:4px;font-size:12px">
        🔋 Подобрать АКБ в калькуляторе (новая вкладка)
      </a>
    </div>`);
  }

  if (selectedBattery) {
    // КАТАЛОЖНЫЙ режим: характеристики блока фиксированы из справочника,
    // пользователь задаёт Vdc-диапазон ИБП, число блоков в цепочке,
    // параллели, end-voltage, температуру и целевую автономию.
    // Автоматически считается min/max количество блоков в цепочке,
    // мощность на блок, ток цепочки, автономия и строится кривая разряда.
    const picked = selectedBattery;
    const cellsPerBlock = Number(picked.cellCount) || 6;
    const blockVnom = Number(picked.blockVoltage) || (cellsPerBlock * (Number(picked.cellVoltage) || 2));
    const capAhBlock = Number(picked.capacityAh) || 100;
    const isS3Module = _isS3Module(picked); // v0.59.416: shared detector

    // Параметры ИБП для подбора АКБ — читаются через единый shared-хелпер.
    // Редактирование этих полей — ТОЛЬКО в основной модалке «Параметры ИБП»;
    // здесь они отображаются read-only, чтобы один источник правды.
    const upsDc = readUpsDcParams(n);
    const vdcMin = upsDc.vdcMin;
    const vdcMax = upsDc.vdcMax;
    const invEff = Math.max(0.5, Math.min(1, upsDc.efficiency / 100));
    const cosPhi = upsDc.cosPhi;

    // Режим подключения DC/DC выходов модулей S³ (IEC Brochure: «DC/DC
    // rated output voltage — 240*2 (In series or parallel)»):
    //   'parallel' — оба выхода 240 В параллельно → Vdc = 240 В, двойной ток
    //   'series'   — оба выхода 240 В последовательно → Vdc = 480 В
    // Хранится в n.batteryDcWiring. Дефолт: если Vdc min ИБП ≥ 320 В
    // (≈ MR33 с ±240 В шиной) — series; иначе parallel. Пользователь
    // может переключить вручную.
    // v0.59.416: разрешение wiring через shared-модуль (см. battery-s3-logic.js)
    let s3Wiring = null, s3Vdc = blockVnom;
    if (isS3Module) {
      const _w = _resolveS3Wiring({ module: picked, requestedWiring: n.batteryDcWiring, vdcMin, vdcMax });
      s3Wiring = _w.wiring;
      s3Vdc = _w.vdcOper;
    }
    // Дефолт end-voltage на элемент зависит от химии:
    //   VRLA (свинцово-кислотные, 2 В/эл.) → 1.75 В/элемент (~87%)
    //   Li-Ion LiFePO4 (3.2 В/эл.)         → 2.80 В/элемент (cut-off ~87% от 3.2)
    const isLiIon = picked.chemistry === 'li-ion';
    const defaultEndV = isLiIon ? 2.80 : 1.75;
    const endVcell = Number(n.batteryEndVperCell ?? defaultEndV);
    const tempC = Number(n.batteryTempC ?? 20);
    const targetMin = Number(n.batteryTargetMin ?? 10);

    // Диапазон допустимого числа блоков в цепочке:
    //   Обычные VRLA / Li-Ion:
    //     N_max = floor(Vmax / Vblock_nominal)
    //     N_min = ceil (Vmin / (cellsPerBlock × endVcell))
    //   S³ модули (Kehua): N интерпретируется как «модулей в шкафу».
    //     Границы заданы жёстко упаковкой: 1 ≤ N ≤ maxPerCabinet.
    //     Напряжение DC — фиксированное (выход DC/DC 240 В), независимо от N.
    let nMax, nMin;
    if (isS3Module) {
      nMax = Number(picked.packaging.maxPerCabinet) || 20;
      nMin = 1;
    } else {
      nMax = Math.max(1, Math.floor(vdcMax / Math.max(0.1, blockVnom)));
      const nMinV = cellsPerBlock * endVcell;
      nMin = Math.max(1, Math.ceil(vdcMin / Math.max(0.1, nMinV)));
    }
    // Пользовательское число блоков (или автоматическое = nMax)
    const userBlocks = Number(n.batteryBlocksPerString) || 0;
    let blocksPerString = userBlocks;
    let clampHint = '';
    if (!blocksPerString) {
      blocksPerString = nMax;  // первая инициализация
    } else if (blocksPerString < nMin) {
      blocksPerString = nMin;
      clampHint = `Клэмп ↑ до ${nMin} (min по Vdc min ${vdcMin} В и endV ${endVcell} В/эл.)`;
    } else if (blocksPerString > nMax) {
      blocksPerString = nMax;
      clampHint = `Клэмп ↓ до ${nMax} (max по Vdc max ${vdcMax} В и ${blockVnom} В/блок)`;
    }

    // Для S³ модулей auto-init числа шкафов: минимум, чтобы покрыть
    // нагрузку с учётом паспортной мощности одного шкафа (200 или 60 кВт,
    // System rated output power). Число модулей в шкафу к мощности
    // отношения не имеет — только к автономии. Делается один раз.
    let stringsCat = Math.max(1, Number(n.batteryStringCount) || 1);
    if (isS3Module && !n._s3StringsAutoInit && loadKw > 0) {
      const pk = picked.packaging;
      const cabPowerKw = Number(pk.cabinetPowerKw) || 200;
      const invEffLocal = Math.max(0.5, Math.min(1, upsDc.efficiency / 100));
      const requiredKw = loadKw / invEffLocal;
      const minCabinets = Math.max(1, Math.ceil(requiredKw / cabPowerKw));
      const maxCab = Number(pk.maxCabinets) || 15;
      if (minCabinets > stringsCat) {
        stringsCat = Math.min(minCabinets, maxCab);
        n.batteryStringCount = stringsCat;
      }
      n._s3StringsAutoInit = true;
    }

    // v0.59.416: для S³ модулей — единый расчёт через computeS3Configuration.
    // Для обычных VRLA остаётся локальная формула (не S³-specific).
    let batteryPwrReqKw, powerPerBlockW, vdcOper, stringCurrentA;
    let s3Cfg = null; // detail из shared-модуля, потом используется в BOM-блоке
    if (isS3Module) {
      s3Cfg = _computeS3Configuration({
        module: picked, loadKw, vdcMin, vdcMax, invEff, cosPhi,
        modulesPerCabinet: blocksPerString, cabinetsCount: stringsCat,
        dcWiring: s3Wiring,
      });
      batteryPwrReqKw = s3Cfg.batteryPwrReqKw;
      powerPerBlockW  = s3Cfg.powerPerModuleW;
      vdcOper         = s3Cfg.vdcOper;
      stringCurrentA  = s3Cfg.stringCurrentA;
    } else {
      const activePowerKw = loadKw * (cosPhi || 1);
      batteryPwrReqKw = activePowerKw / invEff;
      powerPerBlockW = (batteryPwrReqKw * 1000) / (stringsCat * blocksPerString);
      vdcOper = blockVnom * blocksPerString;
      stringCurrentA = vdcOper > 0 ? (batteryPwrReqKw * 1000 / vdcOper) / stringsCat : 0;
    }

    // Параметры ИБП — read-only, редактируются в основной модалке
    // «⚙ Параметры ИБП». Здесь только отображение текущих значений,
    // чтобы не дублировать источник правды.
    h.push('<h4 style="margin:12px 0 6px">Параметры ИБП <span style="font-size:11px;font-weight:400;color:#6b7280">(из «⚙ Параметры ИБП»)</span></h4>');
    h.push(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:12px;padding:8px 12px;background:#f6f8fa;border-radius:6px;margin-bottom:10px">
      <div>V<sub>DC</sub> min:</div><div><b>${vdcMin} В</b></div>
      <div>V<sub>DC</sub> max:</div><div><b>${vdcMax} В</b></div>
      <div>КПД DC–AC:</div><div><b>${Math.round(invEff*100)}%</b></div>
      <div>cos φ:</div><div><b>${cosPhi.toFixed(2)}</b></div>
    </div>
    <button type="button" id="ups-batt-goto-params" class="btn-sm" style="margin-bottom:12px;font-size:11px;padding:3px 10px">⚙ Изменить в «Параметры ИБП»</button>`);

    h.push('<h4 style="margin:12px 0 6px">Конфигурация АКБ (' + escHtml(picked.type) + ')</h4>');
    // Карточка описания с признаком "система" (Kehua S³ и подобные) —
    // оранжевая рамка, компактный блок спецификации шкафа и предупреждение
    // о совместимости, если совместимость ограничена одним производителем.
    if (picked.isSystem) {
      const compatible = picked.compatibleSupplier || picked.supplier;
      const upsSupplier = _getUpsSupplierGuess(n);
      const compatMismatch = compatible && upsSupplier && compatible.toLowerCase() !== upsSupplier.toLowerCase();
      // Модуль (pack) — основа расчёта. Показываем связку с шкафом,
      // в который он монтируется, и лимиты на количество.
      if (picked.systemSubtype === 'module' && picked.packaging) {
        const pk = picked.packaging;
        h.push(`<div style="font-size:11px;padding:8px 12px;background:#fff3e0;border-left:3px solid #e65100;border-radius:4px;margin-bottom:8px;line-height:1.6">
          <div style="font-weight:600;color:#e65100;margin-bottom:4px">🔋 Модуль ${escHtml(picked.supplier || '')} ${escHtml(picked.type)}</div>
          <div>Монтируется в шкаф: <b>${escHtml(pk.cabinetModel || '—')}</b> (до <b>${pk.maxPerCabinet}</b> модулей)</div>
          <div>Полный шкаф: <b>${pk.cabinetKwh} кВт·ч / ${pk.cabinetPowerKw} кВт</b> · макс. параллель: <b>${pk.maxCabinets} шкафов</b></div>
          <div>DC/DC выход модуля: <b>${escHtml(pk.dcOutputV || (fmt(blockVnom) + ' В'))}</b></div>
          ${picked.systemDescription ? `<div class="muted" style="margin-top:4px;font-size:10px">${escHtml(picked.systemDescription)}</div>` : ''}
          ${picked.compatibleNotes ? `<div class="muted" style="margin-top:3px;font-size:10px">⚠ ${escHtml(picked.compatibleNotes)}</div>` : ''}
          ${compatMismatch ? `<div style="margin-top:6px;padding:4px 8px;background:#ffebee;border-radius:3px;color:#c62828;font-weight:600">⛔ ИБП производителя «${escHtml(upsSupplier)}» — несовместим (требуется «${escHtml(compatible)}»).</div>` : ''}
          <div style="margin-top:6px;padding:4px 8px;background:#eef9e4;border-radius:3px;font-size:10px;color:#2e7d32">
            💡 Ниже «<b>Блоков в цепочке</b>» = модулей на шкаф (max ${pk.maxPerCabinet}), «<b>Параллельных цепочек</b>» = шкафов (max ${pk.maxCabinets}).
          </div>
        </div>`);
      } else {
        // Шкаф или другой тип системы — старая универсальная плашка
        const mrModulesInCabinet = picked.modulesPerCabinet || '?';
        const mrModel = picked.moduleModel || '';
        const cabPowKw = picked.cabinetPowerKw || '?';
        const cabKwh = picked.cabinetKwh || '?';
        const maxPar = picked.maxParallelCabinets || 15;
        h.push(`<div style="font-size:11px;padding:8px 12px;background:#fff3e0;border-left:3px solid #e65100;border-radius:4px;margin-bottom:8px;line-height:1.6">
          <div style="font-weight:600;color:#e65100;margin-bottom:4px">🏛 Система ${escHtml(picked.supplier || '')} ${escHtml(picked.type)}</div>
          <div>Шкаф: <b>${cabKwh} кВт·ч / ${cabPowKw} кВт</b> · ${mrModulesInCabinet} модулей ${escHtml(mrModel)}</div>
          <div>DC выход: <b>${fmt(blockVnom)} В</b> · макс. параллель: <b>${maxPar} шкафов</b></div>
          ${picked.systemDescription ? `<div class="muted" style="margin-top:4px;font-size:10px">${escHtml(picked.systemDescription)}</div>` : ''}
          ${compatMismatch ? `<div style="margin-top:6px;padding:4px 8px;background:#ffebee;border-radius:3px;color:#c62828;font-weight:600">⛔ ИБП производителя «${escHtml(upsSupplier)}» — несовместим (требуется «${escHtml(compatible)}»).</div>` : ''}
        </div>`);
      }
    } else {
      h.push(`<div class="muted" style="font-size:11px;padding:6px 10px;background:#eef4fb;border-left:3px solid #1976d2;border-radius:4px;margin-bottom:8px">
        ${escHtml(picked.supplier || '')} · ${escHtml(picked.type)} · ${fmt(blockVnom)} В / ${fmt(capAhBlock)} А·ч · ${cellsPerBlock} эл.
      </div>`);
    }

    // Параметры блока из справочника (read-only по умолчанию).
    // Пользователь может разблокировать их кнопкой «Ручной ввод», тогда
    // значения на узле перестают синхронизироваться со справочником
    // (n.batteryManualOverride = true).
    const manualOverride = !!n.batteryManualOverride;
    const lockBtnTxt = manualOverride ? '🔒 Вернуть из справочника' : '✏ Ручной ввод';
    const disAttr = manualOverride ? '' : ' disabled';
    const readOnlyBg = manualOverride ? '' : ' style="background:#f6f8fa;color:#555"';
    h.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:600;color:${manualOverride ? '#e65100' : '#1976d2'}">
        ${manualOverride ? '✏ Ручной режим (справочник игнорируется)' : '🔒 Из справочника'}
      </span>
      <button type="button" id="ups-batt-lock-toggle" class="btn-sm" style="margin-left:auto;font-size:11px;padding:3px 8px">${lockBtnTxt}</button>
    </div>`);
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Элементов в блоке',
      `<input type="number" id="ups-batt-cells" min="1" max="400" step="1" value="${Number(n.batteryCellCount) || cellsPerBlock * blocksPerString}"${disAttr}${readOnlyBg}>`)}</div>`);
    h.push(`<div style="flex:1">${field('Напр. элемента, В',
      `<input type="number" id="ups-batt-cellV" min="0.5" max="5" step="0.1" value="${Number(n.batteryCellVoltage) || picked.cellVoltage || 2}"${disAttr}${readOnlyBg}>`)}</div>`);
    h.push('</div>');
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Ёмкость блока, А·ч',
      `<input type="number" id="ups-batt-ah" min="1" step="1" value="${Number(n.batteryCapacityAh) || capAhBlock}"${disAttr}${readOnlyBg}>`)}</div>`);
    h.push(`<div style="flex:1">${field('Тип батарей',
      `<select id="ups-batt-type"${disAttr}${readOnlyBg}>
        <option value="lead-acid"${bt === 'lead-acid' ? ' selected' : ''}>VRLA / AGM (2 В)</option>
        <option value="li-ion"${bt === 'li-ion' ? ' selected' : ''}>Li-Ion LiFePO4 (3.2 В)</option>
      </select>`)}</div>`);
    h.push('</div>');
    // Селектор режима подключения DC/DC выходов для S³ модулей
    if (isS3Module) {
      const vP = blockVnom, vS = blockVnom * 2;
      const parOk = vP >= vdcMin && vP <= vdcMax;
      const serOk = vS >= vdcMin && vS <= vdcMax;
      h.push(field('Подключение DC/DC (240 В × 2)', `
        <select id="ups-batt-s3wiring">
          <option value="parallel"${s3Wiring === 'parallel' ? ' selected' : ''}${parOk ? '' : ' disabled'}>Параллельно → Vdc = ${vP} В${parOk ? '' : ' (вне диапазона ИБП)'}</option>
          <option value="series"${s3Wiring === 'series' ? ' selected' : ''}${serOk ? '' : ' disabled'}>Последовательно → Vdc = ${vS} В${serOk ? '' : ' (вне диапазона ИБП)'}</option>
        </select>`));
      h.push(`<div class="muted" style="font-size:10px;margin-top:-6px;margin-bottom:8px">Каждый модуль имеет два DC/DC выхода 240 В. Их можно соединить параллельно (240 В, удвоенный ток) или последовательно (480 В). Выбор должен попадать в диапазон Vdc ИБП (${vdcMin}…${vdcMax} В).</div>`);
    }
    h.push('<div style="display:flex;gap:8px">');
    const blocksInputStyle = clampHint ? ' style="border-color:#e65100;background:#fff8e1"' : '';
    const blocksLabel = isS3Module ? `Модулей в шкафу (${nMin}…${nMax})` : `Блоков в цепочке (${nMin}…${nMax})`;
    h.push(`<div style="flex:1">${field(blocksLabel,
      `<input type="number" id="ups-batt-nblocks" min="${nMin}" max="${nMax}" step="1" value="${blocksPerString}"${blocksInputStyle}>`)}</div>`);
    const stringsMax = isS3Module ? (Number(picked.packaging.maxCabinets) || 15) : 16;
    const stringsLabel = isS3Module ? `Шкафов в параллель (1…${stringsMax})` : 'Параллельных цепочек';
    // Предварительный расчёт перегруза: нужен для красной рамки input'а.
    // Мощность шкафа — паспортная константа из cabinetPowerKw.
    // v0.59.416: переиспользуем результат из единого источника (computeS3Configuration)
    const s3OverloadForInput = !!(isS3Module && s3Cfg && s3Cfg.overload);
    const stringsInputStyle = s3OverloadForInput
      ? ' style="border-color:#c62828;background:#ffebee"' : '';
    h.push(`<div style="flex:1">${field(stringsLabel,
      `<input type="number" id="ups-batt-str" min="1" max="${stringsMax}" step="1" value="${stringsCat}"${stringsInputStyle}>`)}</div>`);
    h.push('</div>');
    if (clampHint) {
      h.push(`<div style="font-size:11px;color:#e65100;background:#fff8e1;border-left:3px solid #e65100;padding:4px 8px;border-radius:3px;margin-top:-4px;margin-bottom:6px">⚠ ${escHtml(clampHint)}</div>`);
    }
    h.push('<div style="display:flex;gap:8px">');
    // Диапазон end-voltage зависит от химии: у VRLA узкий (1.60…1.85 В/эл.),
    // у Li-Ion LiFePO4 — широкий (2.50…3.00 В/эл., рабочий разряд до cut-off)
    const endVopts = isLiIon
      ? [2.50, 2.60, 2.70, 2.80, 2.90, 3.00]
      : [1.60, 1.65, 1.70, 1.75, 1.80, 1.85];
    h.push(`<div style="flex:1">${field('End V / элемент', `
      <select id="ups-batt-endv">
        ${endVopts.map(v =>
          `<option value="${v}"${Math.abs(v-endVcell)<0.001?' selected':''}>${v.toFixed(2)} В</option>`
        ).join('')}
      </select>`)}</div>`);
    h.push(`<div style="flex:1">${field('Температура, °C', `<input type="number" id="ups-batt-temp" min="-20" max="60" step="1" value="${tempC}">`)}</div>`);
    h.push('</div>');

    // Режим расчёта:
    //   'forward' — задано кол-во модулей/шкафов, считаем автономию
    //   'reverse' — задана целевая автономия, подбираем минимум модулей
    const calcMode = n.batteryCalcMode || 'forward';
    h.push(field('Режим расчёта', `
      <select id="ups-batt-mode">
        <option value="forward"${calcMode === 'forward' ? ' selected' : ''}>Проверить автономию (модули → время)</option>
        <option value="reverse"${calcMode === 'reverse' ? ' selected' : ''}>Подобрать модули по автономии (время → модули)</option>
      </select>`));
    h.push(field(
      calcMode === 'reverse' ? 'Требуемая автономия, мин' : 'Требуемая автономия, мин (справочно)',
      `<input type="number" id="ups-batt-target" min="1" max="1440" step="1" value="${targetMin}">`
    ));
    if (calcMode === 'reverse') {
      h.push(`<button type="button" id="ups-batt-suggest" class="btn-sm btn-primary" style="margin-bottom:10px;font-size:12px">🔍 Подобрать минимум модулей / шкафов</button>`);
      if (n._batterySuggestResult) {
        const r = n._batterySuggestResult;
        if (r.ok) {
          h.push(`<div style="margin-bottom:10px;padding:8px 12px;background:#e8f5e9;border-left:3px solid #2e7d32;border-radius:4px;font-size:12px;line-height:1.6">
            <div style="font-weight:600;color:#2e7d32">✓ Подобрано: ${r.strings} × ${r.blocksPerString}${isS3Module ? ' модулей' : ' блоков'} (всего ${r.total})</div>
            <div>Автономия: <b>${fmt(r.autonomyMin)} мин</b> ≥ цель ${r.target} мин${r.limitedByPower ? ' (лимит мощности шкафа учтён)' : ''}</div>
            <button type="button" id="ups-batt-apply-suggest" class="btn-sm" style="margin-top:6px;font-size:11px">Применить конфигурацию</button>
          </div>`);
        } else {
          h.push(`<div style="margin-bottom:10px;padding:8px 12px;background:#ffebee;border-left:3px solid #c62828;border-radius:4px;font-size:12px;color:#c62828">
            ⛔ ${escHtml(r.reason || 'Не удалось подобрать конфигурацию в пределах лимитов.')}
          </div>`);
        }
      }
    }

    // Результаты расчёта (сразу основные цифры; кривая — async ниже).
    // Для S³ модулей дополнительно выводим полезную BOM-информацию:
    // всего модулей, шкафов, полная мощность шкафа в конфигурации и
    // ЯВНЫЙ ЛИМИТ МОЩНОСТИ СИСТЕМЫ. Каждый шкаф ограничен паспортным
    // System rated output power: 200 кВт для S3C040/S3C050 и 60 кВт
    // для S3C100 (из брошюры Kehua S³). Если нагрузка превышает
    // suммарный лимит — показываем красную плашку.
    h.push('<h4 style="margin:14px 0 6px">Результаты расчёта</h4>');
    const totalModules = stringsCat * blocksPerString;
    const moduleLabel = isS3Module ? 'Мощность/модуль' : 'Мощность/блок';
    const totalLabel = isS3Module ? 'Всего модулей' : 'Всего блоков';
    const currentLabel = isS3Module ? 'Ток шкафа' : 'Ток цепочки';
    let bomBlock = '';
    let s3OverloadBlock = '';
    if (isS3Module && s3Cfg) {
      // v0.59.416: все BOM-числа берутся из единого расчёта computeS3Configuration.
      // cabinetPowerKw (200/200/60) — паспортная константа System rated output
      // power, не зависит от числа модулей в шкафу. Число модулей определяет
      // только автономию (кВт·ч), не мгновенную мощность.
      const pk = picked.packaging;
      bomBlock = `
        <div>Шкафов:</div><div><b>${s3Cfg.cabinetsCount}</b> × ${escHtml(s3Cfg.cabinetModel || '—')}</div>
        <div>Модулей/шкаф:</div><div><b>${s3Cfg.modulesPerCabinet}</b> из ${s3Cfg.nMax}</div>
        <div>P шкафа:</div><div><b>${fmt(s3Cfg.cabinetPowerKw)} кВт</b> (паспорт System rated output)</div>
        <div>P системы:</div><div><b${s3Cfg.overload ? ' style="color:#c62828"' : ''}>${fmt(s3Cfg.systemPowerKw)} кВт</b> (${fmt(s3Cfg.cabinetPowerKw)} × ${s3Cfg.cabinetsCount})</div>
        <div>P<sub>треб.</sub> от АКБ:</div><div><b${s3Cfg.overload ? ' style="color:#c62828"' : ''}>${fmt(s3Cfg.batteryPwrReqKw)} кВт</b></div>`;
      if (s3Cfg.overload) {
        s3OverloadBlock = `<div style="margin-top:8px;padding:8px 12px;background:#ffebee;border-left:3px solid #c62828;border-radius:4px;font-size:11px;color:#c62828;line-height:1.6">
          <b>⛔ Лимит системы превышен.</b> Требуемая мощность АКБ <b>${fmt(s3Cfg.batteryPwrReqKw)} кВт</b>
          превышает суммарную мощность ${s3Cfg.cabinetsCount} шкаф(ов) × ${fmt(s3Cfg.cabinetPowerKw)} кВт = <b>${fmt(s3Cfg.systemPowerKw)} кВт</b>.<br>
          Увеличьте число шкафов минимум до <b>${s3Cfg.minCabinetsForLoad}</b>${picked.type.startsWith('S3M100') ? ' или выберите модули S3M040/S3M050 (200 кВт на шкаф вместо 60)' : ''}.
        </div>`;
      }
    }
    h.push(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:12px;padding:8px 12px;background:#f6f8fa;border-radius:6px">
      <div>U<sub>DC раб</sub>:</div><div><b>${fmt(vdcOper)} В</b></div>
      <div>${moduleLabel}:</div><div><b id="ups-batt-pperblock">${fmt(powerPerBlockW)} Вт</b></div>
      <div>${currentLabel}:</div><div><b id="ups-batt-istring">${fmt(stringCurrentA)} А</b></div>
      <div>${totalLabel}:</div><div><b>${totalModules}</b></div>
      ${bomBlock}
      <div>Автономия (расч.):</div><div><b id="ups-batt-autonomy2">—</b>
        <span id="ups-batt-autonomy-method2" class="muted" style="font-size:10px;margin-left:4px"></span></div>
    </div>
    ${s3OverloadBlock}`);

    // v0.59.429: состав системы S³ + аксессуары через плагин s3LiIonType.
    if (isS3Module && s3Cfg && s3Cfg.totalModules > 0) {
      const masterVar = n.batteryMasterVariant || 'M';
      const slaveVar  = n.batterySlaveVariant  || 'S';
      const fireFighting = n.batteryFireFighting != null ? n.batteryFireFighting : 'X';
      const spec = _s3LiIonType.buildSystem({
        module: picked, totalModules: s3Cfg.totalModules,
        options: { masterVariant: masterVar, slaveVariant: slaveVar, fireFighting },
      });
      const accessoryCatalog = catalog.filter(b => b && b.systemSubtype === 'accessory');
      const cabRows = spec.cabinets.map(c => {
        const role = c.role === 'master' ? 'Master' : c.role === 'slave' ? 'Slave' : 'Combiner';
        const fill = c.role === 'combiner' ? '— (DC busbar)' :
          `${c.modulesInCabinet} мод.${c.emptySlots > 0 ? ` + ${c.emptySlots} заглушек` : ''}`;
        return `<tr><td style="padding:3px 8px;border-bottom:1px solid #e0e3ea">${role}</td><td style="padding:3px 8px;border-bottom:1px solid #e0e3ea"><b>${escHtml(c.model)}</b></td><td style="padding:3px 8px;border-bottom:1px solid #e0e3ea">${fill}</td></tr>`;
      }).join('');
      const accRows = (spec.accessories || []).map(a => {
        const cat = accessoryCatalog.find(x => x.id === a.id);
        const name = cat ? (cat.type || cat.id) : a.id;
        return `<tr><td style="padding:3px 8px;border-bottom:1px solid #e0e3ea">${escHtml(name)}</td><td style="padding:3px 8px;border-bottom:1px solid #e0e3ea">${a.qty}</td></tr>`;
      }).join('');
      const cRateChk = _s3LiIonType.validateMaxCRate({
        module: picked, loadKw: loadKw,
        totalModules: s3Cfg.totalModules, invEff,
      });
      let cRateBlock = '';
      if (cRateChk && !cRateChk.ok) {
        cRateBlock = `<div style="margin-top:6px;padding:6px 8px;background:#ffebee;border-left:3px solid #c62828;border-radius:3px;font-size:11px;color:#c62828">⚠ ${escHtml(cRateChk.reason)}</div>`;
      } else if (cRateChk && cRateChk.cRate) {
        const used = cRateChk.reqKw / cRateChk.ratedSystemKw * 100;
        cRateBlock = `<div class="muted" style="font-size:11px;margin-top:6px">Загрузка по C-rate: ${used.toFixed(1)}% от паспорта (${fmt(cRateChk.ratedSystemKw)} кВт при ${cRateChk.cRate}C × ${s3Cfg.totalModules} мод.)</div>`;
      }
      h.push(`<details style="margin-top:8px;background:#eff7ff;border:1px solid #bbdefb;border-radius:6px;padding:8px 12px">
        <summary style="cursor:pointer;font-weight:600;font-size:12px">Состав системы S³ (автосборка) — ${spec.cabinets.length} шкаф(ов)${(spec.accessories||[]).length ? ' + ' + spec.accessories.length + ' аксессуаров' : ''}</summary>
        <div style="margin-top:8px">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#fff"><th style="text-align:left;padding:3px 8px;border-bottom:2px solid #bbdefb">Роль</th><th style="text-align:left;padding:3px 8px;border-bottom:2px solid #bbdefb">Модель</th><th style="text-align:left;padding:3px 8px;border-bottom:2px solid #bbdefb">Заполнение</th></tr></thead>
            <tbody>${cabRows}</tbody>
          </table>
          ${accRows ? `<div style="margin-top:8px;font-size:11px;font-weight:600">Аксессуары</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px">
            <thead><tr style="background:#fff"><th style="text-align:left;padding:3px 8px;border-bottom:2px solid #bbdefb">Наименование</th><th style="text-align:left;padding:3px 8px;border-bottom:2px solid #bbdefb">Кол-во</th></tr></thead>
            <tbody>${accRows}</tbody>
          </table>` : ''}
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px">
            <label>Master <select id="ups-batt-master-variant" style="width:100%;font-size:11px">
              <option value="M" ${masterVar==='M'?'selected':''}>-M (touch)</option>
              <option value="M1" ${masterVar==='M1'?'selected':''}>-M1 (1 breaker)</option>
              <option value="M2" ${masterVar==='M2'?'selected':''}>-M2 (KR)</option>
            </select></label>
            <label>Slave <select id="ups-batt-slave-variant" style="width:100%;font-size:11px">
              <option value="S" ${slaveVar==='S'?'selected':''}>-S (LED)</option>
              <option value="S2" ${slaveVar==='S2'?'selected':''}>-S2 (KR)</option>
            </select></label>
            <label>Fire-fighting <select id="ups-batt-fire" style="width:100%;font-size:11px">
              <option value="X" ${fireFighting==='X'?'selected':''}>X (есть)</option>
              <option value="" ${fireFighting===''?'selected':''}>— (нет)</option>
            </select></label>
          </div>
          ${cRateBlock}
        </div>
      </details>`);
    }

    // Сохраняем в узле ключевые параметры для rerender после изменения
    n.batteryVdcMin = vdcMin;
    n.batteryVdcMax = vdcMax;
    n.batteryEndVperCell = endVcell;
    n.batteryTempC = tempC;
    n.batteryBlocksPerString = blocksPerString;
    n.batteryTargetMin = targetMin;
    if (isS3Module) n.batteryDcWiring = s3Wiring;
    // Авто-синхронизация состава блока из справочника — ТОЛЬКО если пользователь
    // не включил ручной режим (n.batteryManualOverride). В ручном режиме мы
    // сохраняем введённые значения и пересчитываем kWh из них.
    if (!manualOverride) {
      n.batteryCellCount = cellsPerBlock * blocksPerString;
      n.batteryCellVoltage = Number(picked.cellVoltage) || 2;
      n.batteryCapacityAh = capAhBlock;
      n.batteryKwh = (blockVnom * blocksPerString * capAhBlock * stringsCat) / 1000;
    } else {
      // Ручной режим: kWh считается из введённых пользователем значений
      const _blockV = (Number(n.batteryCellCount) || 0) * (Number(n.batteryCellVoltage) || 0);
      const _totalAh = (Number(n.batteryCapacityAh) || 0) * stringsCat;
      n.batteryKwh = (_blockV * _totalAh) / 1000;
    }

    // Контейнер для кривой разряда
    h.push('<h4 style="margin:14px 0 6px">Кривая разряда</h4>');
    h.push('<div id="ups-batt-chart" style="width:100%;min-height:220px;background:#fff;border:1px solid #d6dbe4;border-radius:4px;padding:6px"></div>');

  } else {
    // Ручной режим (без выбранной модели из каталога) — старые поля
    h.push('<h4 style="margin:8px 0 6px">Состав блока</h4>');
    h.push(field('Тип батарей', `
      <select id="ups-batt-type">
        <option value="lead-acid"${bt === 'lead-acid' ? ' selected' : ''}>Свинцово-кислотные (VRLA/AGM), 2 В</option>
        <option value="li-ion"${bt === 'li-ion' ? ' selected' : ''}>Литий-ионные (LiFePO4), 3.2 В</option>
      </select>`));
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Элементов в блоке', `<input type="number" id="ups-batt-cells" min="1" max="400" step="1" value="${cells}">`)}</div>`);
    h.push(`<div style="flex:1">${field('Напр. элемента, В', `<input type="number" id="ups-batt-cellV" min="0.5" max="5" step="0.1" value="${cellV}">`)}</div>`);
    h.push('</div>');
    h.push('<div style="display:flex;gap:8px">');
    h.push(`<div style="flex:1">${field('Ёмкость элемента, А·ч', `<input type="number" id="ups-batt-ah" min="1" step="1" value="${ah}">`)}</div>`);
    h.push(`<div style="flex:1">${field('Параллельных цепочек', `<input type="number" id="ups-batt-str" min="1" max="16" step="1" value="${strs}">`)}</div>`);
    h.push('</div>');
  }

  // Ток заряда
  h.push('<h4 style="margin:16px 0 6px">Ток заряда</h4>');
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

  // Если выбрана модель из справочника — точный расчёт автономии по
  // таблице Constant Power Discharge из battery/battery-discharge.js.
  // Загружаем модуль лениво; после вычисления обновляем DOM spans.
  if (selectedBattery && loadKw > 0) {
    _loadDischargeModule().then(mod => {
      if (!mod || typeof mod.calcAutonomy !== 'function') return;
      // Определяем блоки на цепочку: dcVoltage / blockVoltage модели
      const dcVoltage = blockV || 0;
      const blocksPerString = selectedBattery.blockVoltage > 0
        ? Math.max(1, Math.round(dcVoltage / selectedBattery.blockVoltage))
        : 1;
      const strings = Math.max(1, Number(n.batteryStringCount) || 1);
      const invEff = Math.max(0.5, Math.min(1, (Number(n.efficiency) || 94) / 100));
      const r = mod.calcAutonomy({
        battery: selectedBattery,
        loadKw,
        dcVoltage,
        strings,
        blocksPerString,
        endV: 1.75,
        invEff,
        chemistry: selectedBattery.chemistry,
      });
      const span = document.getElementById('ups-batt-autonomy');
      const method = document.getElementById('ups-batt-autonomy-method');
      if (span) {
        if (!r.feasible) {
          span.textContent = '—';
          span.style.color = '#c62828';
        } else if (!Number.isFinite(r.autonomyMin)) {
          span.textContent = '∞';
        } else {
          span.textContent = fmt(r.autonomyMin) + ' мин';
        }
      }
      if (method) {
        method.textContent = r.method === 'table' ? '(по таблице разряда)' : '(усреднённая модель)';
        method.style.color = r.method === 'table' ? '#2e7d32' : '#9aa3b5';
      }
    });
  }

  // Хелпер: пересчитать batteryKwh из полей и сделать snapshot/rerender
  const recalcKwh = () => {
    const _blockV = (Number(n.batteryCellCount) || 0) * (Number(n.batteryCellVoltage) || 0);
    const _totalAh = (Number(n.batteryCapacityAh) || 0) * (Number(n.batteryStringCount) || 1);
    n.batteryKwh = (_blockV * _totalAh) / 1000;
  };

  // Обработчики полей состава
  const bindNum = (id, prop, min = 0) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':' + prop);
      n[prop] = Math.max(min, Number(el.value) || 0);
      recalcKwh();
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  };
  // Каскадный селектор справочника АКБ — единый компонент shared/battery-picker.js.
  // Состояние выбора supplier/series хранится на узле (_battSelSupplier /
  // _battSelSeries), чтобы переживать перерендер модалки. При выборе модели
  // применяем её характеристики к узлу и пересобираем тело.
  const pickerMount = document.getElementById('ups-batt-picker-mount');
  if (pickerMount) {
    // Для UPS battery modal скрываем «не-модули» (cabinet / accessory):
    // расчёт всегда ведётся по модулю (или обычной АКБ).
    // v0.59.425: добавлен фильтр accessory (combiner, networking device,
    // blank panels, wire kits) — они добавляются автоматически BOM-логикой.
    const pickerList = catalog.filter(b => !(b.isSystem && (b.systemSubtype === 'cabinet' || b.systemSubtype === 'accessory')));
    mountBatteryPicker(pickerMount, {
      list: pickerList,
      selectedId: n.batteryCatalogId || null,
      currentSupplier: n._battSelSupplier || '',
      currentSeries: n._battSelSeries || '',
      placeholders: { supplier: '— не выбрано —', series: '— не выбрано —', model: '— свой состав —' },
      labels: { supplier: 'Производитель', series: 'Серия', model: 'Модель' },
      idPrefix: 'ups-batt-cat',
      onChange: (st) => {
        n._battSelSupplier = st.supplier || null;
        n._battSelSeries = st.series || null;
        if (st.modelId !== n.batteryCatalogId) {
          snapshot('ups-batt:' + n.id + ':catalog');
          n.batteryCatalogId = st.modelId || null;
          // Сбрасываем флаг auto-init S³ — новая модель = новый auto-расчёт
          n._s3StringsAutoInit = false;
          if (st.battery) {
            // Применяем характеристики выбранной модели.
            const newType = st.battery.chemistry === 'li-ion' ? 'li-ion' : 'lead-acid';
            // Если химия поменялась — сбрасываем endV, чтобы следующий рендер
            // подставил корректный дефолт (VRLA: 1.75, Li-Ion: 2.80 В/эл.)
            if (n.batteryType !== newType) n.batteryEndVperCell = null;
            n.batteryType = newType;
            if (st.battery.cellCount)   n.batteryCellCount   = st.battery.cellCount;
            if (st.battery.cellVoltage) n.batteryCellVoltage = st.battery.cellVoltage;
            if (st.battery.capacityAh)  n.batteryCapacityAh  = st.battery.capacityAh;
            const _blockV = (Number(n.batteryCellCount) || 0) * (Number(n.batteryCellVoltage) || 0);
            const _totalAh = (Number(n.batteryCapacityAh) || 0) * (Number(n.batteryStringCount) || 1);
            n.batteryKwh = (_blockV * _totalAh) / 1000;
          }
          render(); notifyChange();
        }
        _renderUpsBatteryBody(n);
      },
    });
  }

  const typeSel = document.getElementById('ups-batt-type');
  if (typeSel) {
    typeSel.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':type');
      n.batteryType = typeSel.value || 'lead-acid';
      // Подставим дефолтное напряжение элемента по типу — но только если
      // пользователь не задавал его вручную (значение соответствует
      // дефолту другого типа).
      const cellVEl = document.getElementById('ups-batt-cellV');
      if (cellVEl) {
        const curV = Number(cellVEl.value) || 0;
        if (n.batteryType === 'li-ion' && (curV === 2 || curV === 0)) {
          n.batteryCellVoltage = 3.2;
        } else if (n.batteryType === 'lead-acid' && (curV === 3.2 || curV === 0)) {
          n.batteryCellVoltage = 2.0;
        }
      }
      recalcKwh();
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  }
  bindNum('ups-batt-cells', 'batteryCellCount', 1);
  bindNum('ups-batt-cellV', 'batteryCellVoltage', 0.1);
  bindNum('ups-batt-ah', 'batteryCapacityAh', 1);
  bindNum('ups-batt-str', 'batteryStringCount', 1);
  // Каталожный режим: обработчики новых полей + точный пересчёт автономии
  // и кривая разряда.
  if (selectedBattery) {
    // V_DC min/max/КПД/cosPhi редактируются в openUpsParamsModal (единая
    // точка правды); здесь они read-only и не имеют bind-обработчиков.
    bindNum('ups-batt-nblocks', 'batteryBlocksPerString', 1);
    bindNum('ups-batt-temp', 'batteryTempC', -20);
    bindNum('ups-batt-target', 'batteryTargetMin', 1);
    // Селектор режима подключения DC/DC выходов S³ модулей
    // Селектор режима расчёта (forward / reverse)
    const modeEl = document.getElementById('ups-batt-mode');
    if (modeEl) modeEl.addEventListener('change', () => {
      n.batteryCalcMode = modeEl.value === 'reverse' ? 'reverse' : 'forward';
      n._batterySuggestResult = null;
      _renderUpsBatteryBody(n);
    });
    // Кнопка «Подобрать минимум» — запускает обратный расчёт.
    // Для S³ модулей ищем минимальную пару (modulesPerCabinet, cabinetsCount)
    // с учётом лимита мощности шкафа и паспортных границ. Для обычных АКБ
    // используется calcRequiredBlocks из battery-discharge.js.
    const suggestBtn = document.getElementById('ups-batt-suggest');
    if (suggestBtn) suggestBtn.addEventListener('click', async () => {
      const mod = await _loadDischargeModule();
      if (!mod) { flash('battery-discharge module not available'); return; }
      const target = Number(n.batteryTargetMin) || targetMin;
      if (loadKw <= 0) {
        n._batterySuggestResult = { ok: false, reason: 'Нагрузка ИБП = 0. Задайте мощность ИБП или подключите потребителей.' };
        _renderUpsBatteryBody(n);
        return;
      }
      const commonInput = {
        battery: picked,
        loadKw,
        endV: endVcell,
        invEff,
        chemistry: picked.chemistry,
      };
      let best = null;
      if (isS3Module) {
        const pk = picked.packaging;
        const maxPer = Number(pk.maxPerCabinet) || 20;
        const maxCab = Number(pk.maxCabinets) || 15;
        const cabPowerKw = Number(pk.cabinetPowerKw) || 200;
        // Мощностный лимит: cabs × cabPowerKw ≥ reqKw. Модули к мощности
        // не относятся — только к автономии. Минимум шкафов считается
        // напрямую: minCabs = ceil(reqKw / cabPowerKw).
        const reqKw = loadKw / invEff;
        const minCabs = Math.max(1, Math.ceil(reqKw / cabPowerKw));
        if (minCabs > maxCab) {
          best = { ok: false, reason: `Нагрузка ${fmt(loadKw)} кВт требует минимум ${minCabs} шкафов (${fmt(cabPowerKw)} кВт на шкаф), но паспортный максимум параллели — ${maxCab}. ${picked.type.startsWith('S3M100') ? 'Выберите S3M040/S3M050 (200 кВт на шкаф).' : 'Уменьшите нагрузку или выберите другую серию.'}` };
        } else {
          // Перебираем (cabs ≥ minCabs, mods 1…maxPer) ища минимальное
          // суммарное число модулей для target автономии. Для каждого
          // cabs число модулей растёт пропорционально нагрузке/модуль.
          outer: for (let cabs = minCabs; cabs <= maxCab; cabs++) {
            for (let mods = 1; mods <= maxPer; mods++) {
              const dcV = s3Wiring === 'series' ? (blockVnom * 2) : blockVnom;
              const r = mod.calcAutonomy({
                ...commonInput,
                dcVoltage: dcV,
                strings: cabs,
                blocksPerString: mods,
              });
              if (r.feasible && r.autonomyMin >= target) {
                best = {
                  ok: true,
                  strings: cabs,
                  blocksPerString: mods,
                  total: cabs * mods,
                  autonomyMin: r.autonomyMin,
                  target,
                };
                break outer;
              }
            }
          }
          if (!best) {
            best = { ok: false, reason: `Не удалось подобрать: даже ${maxCab} шкафов × ${maxPer} модулей не дают ${target} мин при нагрузке ${fmt(loadKw)} кВт. Попробуйте другую серию или уменьшите нагрузку.` };
          }
        }
      } else {
        // Обычные АКБ — calcRequiredBlocks
        const req = mod.calcRequiredBlocks({
          ...commonInput,
          dcVoltage: blockVnom * blocksPerString,
          blocksPerString,
          targetMin: target,
        });
        if (req) {
          best = {
            ok: true,
            strings: req.strings,
            blocksPerString: req.blocksPerString,
            total: req.totalBlocks,
            autonomyMin: req.result.autonomyMin,
            target,
          };
        } else {
          best = { ok: false, reason: 'Не удалось подобрать в пределах 2000 блоков.' };
        }
      }
      n._batterySuggestResult = best;
      _renderUpsBatteryBody(n);
    });
    // Кнопка «Применить конфигурацию» — записывает подобранные значения
    // в узел и переключает режим обратно в 'forward'.
    const applyBtn = document.getElementById('ups-batt-apply-suggest');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      const r = n._batterySuggestResult;
      if (!r || !r.ok) return;
      snapshot('ups-batt:' + n.id + ':apply-suggest');
      n.batteryBlocksPerString = r.blocksPerString;
      n.batteryStringCount = r.strings;
      n.batteryCalcMode = 'forward';
      n._batterySuggestResult = null;
      n._s3StringsAutoInit = true;  // не перезаписывать нашу конфигу auto-init'ом
      render(); notifyChange(); _renderUpsBatteryBody(n);
      flash('Конфигурация применена: ' + r.strings + ' × ' + r.blocksPerString, 'success');
    });

    const s3WiringEl = document.getElementById('ups-batt-s3wiring');
    if (s3WiringEl) s3WiringEl.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':s3wiring');
      n.batteryDcWiring = s3WiringEl.value === 'series' ? 'series' : 'parallel';
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
    // Кнопка «⚙ Изменить в Параметры ИБП»: закрывает АКБ-модалку и
    // открывает основную модалку параметров ИБП.
    const gotoParamsBtn = document.getElementById('ups-batt-goto-params');
    if (gotoParamsBtn) gotoParamsBtn.addEventListener('click', () => {
      const battModal = document.getElementById('modal-ups-battery');
      if (battModal) battModal.classList.add('hidden');
      openUpsParamsModal(n);
    });
    // Toggle lock: переключение между read-only справочником и ручным вводом
    // параметров блока (cellCount / cellVoltage / capacityAh / type).
    // При переходе в lock → значения пересинхронизируются из selectedBattery.
    const lockBtn = document.getElementById('ups-batt-lock-toggle');
    if (lockBtn) lockBtn.addEventListener('click', () => {
      snapshot('ups-batt:' + n.id + ':override');
      n.batteryManualOverride = !n.batteryManualOverride;
      if (!n.batteryManualOverride) {
        // Возвращаемся к справочнику: перезатираем поля из picked
        if (selectedBattery.cellCount)   n.batteryCellCount   = selectedBattery.cellCount;
        if (selectedBattery.cellVoltage) n.batteryCellVoltage = selectedBattery.cellVoltage;
        if (selectedBattery.capacityAh)  n.batteryCapacityAh  = selectedBattery.capacityAh;
        n.batteryType = selectedBattery.chemistry === 'li-ion' ? 'li-ion' : 'lead-acid';
        const _blockV = (Number(n.batteryCellCount) || 0) * (Number(n.batteryCellVoltage) || 0);
        const _totalAh = (Number(n.batteryCapacityAh) || 0) * (Number(n.batteryStringCount) || 1);
        n.batteryKwh = (_blockV * _totalAh) / 1000;
      }
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
    const endVEl = document.getElementById('ups-batt-endv');
    if (endVEl) endVEl.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':endv');
      n.batteryEndVperCell = Number(endVEl.value) || 1.75;
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
    // Точный расчёт автономии + кривая разряда
    _loadDischargeModule().then(mod => {
      if (!mod || typeof mod.calcAutonomy !== 'function') return;
      const picked = selectedBattery;
      const blockVnom = Number(picked.blockVoltage) || ((Number(picked.cellCount) || 6) * (Number(picked.cellVoltage) || 2));
      const blocksPer = Number(n.batteryBlocksPerString) || 1;
      // S³ модуль: DC/DC выход = 240 (parallel) или 480 (series).
      // Обычные АКБ: dcVoltage = blockVnom × блоков в цепочке.
      const _isS3ModAsync = picked.isSystem && picked.systemSubtype === 'module' && picked.packaging;
      const _s3Wire = n.batteryDcWiring === 'series' ? 'series' : 'parallel';
      const dcVoltage = _isS3ModAsync
        ? (_s3Wire === 'series' ? blockVnom * 2 : blockVnom)
        : (blockVnom * blocksPer);
      const strings = Math.max(1, Number(n.batteryStringCount) || 1);
      const invEff = Math.max(0.5, Math.min(1, (Number(n.efficiency) || 94) / 100));
      const endV = Number(n.batteryEndVperCell) || 1.75;
      const r = mod.calcAutonomy({
        battery: picked, loadKw, dcVoltage, strings,
        blocksPerString: blocksPer, endV, invEff,
        chemistry: picked.chemistry,
      });
      const span = document.getElementById('ups-batt-autonomy2');
      const method = document.getElementById('ups-batt-autonomy-method2');
      if (span) {
        if (!r.feasible) { span.textContent = '—'; span.style.color = '#c62828'; }
        else if (!Number.isFinite(r.autonomyMin)) span.textContent = '∞';
        else span.textContent = fmt(r.autonomyMin) + ' мин';
      }
      if (method) {
        method.textContent = r.method === 'table' ? '(по таблице)' : '(усреднённая)';
        method.style.color = r.method === 'table' ? '#2e7d32' : '#9aa3b5';
      }
      // Рисуем кривую разряда
      _drawDischargeChart(document.getElementById('ups-batt-chart'), picked, {
        operPowerW: r.blockPowerW,
        operTimeMin: r.autonomyMin,
        selectedEndV: endV,
      });
    });
  }

  // Ток заряда
  const chargeAInput = document.getElementById('ups-batt-chargeA');
  if (chargeAInput) {
    chargeAInput.addEventListener('change', () => {
      snapshot('ups-batt:' + n.id + ':chargeA');
      n.chargeA = Math.max(0, Number(chargeAInput.value) || 0);
      render(); notifyChange(); _renderUpsBatteryBody(n);
    });
  }
  // Слайдер заряда
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
  // v0.59.429: селекторы вариантов S³ (master / slave / fire-fighting).
  // При смене сохраняем в узле и рендерим заново — состав шкафов
  // обновится с новыми суффиксами модели (-M1, -S2, -X и т.п.).
  const mvar = body.querySelector('#ups-batt-master-variant');
  if (mvar) mvar.addEventListener('change', () => {
    snapshot('ups-batt:' + n.id + ':masterVariant');
    n.batteryMasterVariant = mvar.value || 'M';
    notifyChange(); _renderUpsBatteryBody(n);
  });
  const svar = body.querySelector('#ups-batt-slave-variant');
  if (svar) svar.addEventListener('change', () => {
    snapshot('ups-batt:' + n.id + ':slaveVariant');
    n.batterySlaveVariant = svar.value || 'S';
    notifyChange(); _renderUpsBatteryBody(n);
  });
  const fire = body.querySelector('#ups-batt-fire');
  if (fire) fire.addEventListener('change', () => {
    snapshot('ups-batt:' + n.id + ':fireFighting');
    n.batteryFireFighting = fire.value;
    notifyChange(); _renderUpsBatteryBody(n);
  });
}

// Кривая разряда АКБ (log-log SVG): мощность/блок (W) vs время разряда (мин)
// для нескольких end-voltage кривых. Красная точка = рабочая точка.
function _drawDischargeChart(mount, battery, opts = {}) {
  if (!mount) return;
  mount.innerHTML = '';
  const tbl = Array.isArray(battery && battery.dischargeTable) ? battery.dischargeTable : [];
  if (!tbl.length) {
    mount.innerHTML = '<div class="muted" style="font-size:11px;text-align:center;padding:30px 10px">Таблица разряда недоступна — расчёт по усреднённой модели.</div>';
    return;
  }
  const W = 560, H = 240;
  const padL = 52, padR = 12, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Сгруппируем по endV
  const byEv = new Map();
  for (const p of tbl) {
    if (!byEv.has(p.endV)) byEv.set(p.endV, []);
    byEv.get(p.endV).push(p);
  }
  for (const arr of byEv.values()) arr.sort((a, b) => a.tMin - b.tMin);
  const endVs = [...byEv.keys()].sort((a, b) => a - b);

  // Диапазоны (log-log)
  let tMin = Infinity, tMax = 0, pMin = Infinity, pMax = 0;
  for (const p of tbl) {
    if (p.tMin > 0) tMin = Math.min(tMin, p.tMin);
    tMax = Math.max(tMax, p.tMin);
    if (p.powerW > 0) pMin = Math.min(pMin, p.powerW);
    pMax = Math.max(pMax, p.powerW);
  }
  if (!Number.isFinite(tMin) || tMax <= tMin) { tMin = 1; tMax = 1000; }
  if (!Number.isFinite(pMin) || pMax <= pMin) { pMin = 1; pMax = 10000; }
  // Включаем рабочую точку
  if (opts.operTimeMin > 0 && Number.isFinite(opts.operTimeMin)) {
    tMin = Math.min(tMin, opts.operTimeMin * 0.9);
    tMax = Math.max(tMax, opts.operTimeMin * 1.1);
  }
  if (opts.operPowerW > 0) {
    pMin = Math.min(pMin, opts.operPowerW * 0.9);
    pMax = Math.max(pMax, opts.operPowerW * 1.1);
  }
  const logT0 = Math.log10(tMin), logT1 = Math.log10(tMax);
  const logP0 = Math.log10(pMin), logP1 = Math.log10(pMax);
  const xOf = t => padL + ((Math.log10(t) - logT0) / (logT1 - logT0)) * plotW;
  const yOf = p => padT + plotH - ((Math.log10(p) - logP0) / (logP1 - logP0)) * plotH;

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('style', 'max-width:100%;height:auto');

  // Оси
  const axis = document.createElementNS(svgNs, 'g');
  axis.setAttribute('stroke', '#9aa3b5');
  axis.setAttribute('fill', 'none');
  const lx = document.createElementNS(svgNs, 'line');
  lx.setAttribute('x1', padL); lx.setAttribute('y1', padT + plotH);
  lx.setAttribute('x2', padL + plotW); lx.setAttribute('y2', padT + plotH);
  axis.appendChild(lx);
  const ly = document.createElementNS(svgNs, 'line');
  ly.setAttribute('x1', padL); ly.setAttribute('y1', padT);
  ly.setAttribute('x2', padL); ly.setAttribute('y2', padT + plotH);
  axis.appendChild(ly);
  svg.appendChild(axis);

  // Риски по X (декады)
  const xTicks = [1, 3, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200];
  for (const t of xTicks) {
    if (t < tMin || t > tMax) continue;
    const x = xOf(t);
    const tk = document.createElementNS(svgNs, 'line');
    tk.setAttribute('x1', x); tk.setAttribute('y1', padT + plotH);
    tk.setAttribute('x2', x); tk.setAttribute('y2', padT + plotH + 4);
    tk.setAttribute('stroke', '#9aa3b5');
    svg.appendChild(tk);
    const tx = document.createElementNS(svgNs, 'text');
    tx.setAttribute('x', x); tx.setAttribute('y', padT + plotH + 16);
    tx.setAttribute('font-size', '10'); tx.setAttribute('fill', '#5a6374');
    tx.setAttribute('text-anchor', 'middle');
    tx.textContent = t;
    svg.appendChild(tx);
  }
  // Риски по Y (мощность)
  const pStep = Math.pow(10, Math.floor(Math.log10(pMax)));
  const yTicks = [];
  for (let v = pStep; v <= pMax * 1.1; v += pStep) yTicks.push(v);
  if (yTicks.length < 3) yTicks.unshift(pStep / 2);
  for (const p of yTicks) {
    if (p < pMin * 0.9) continue;
    const y = yOf(p);
    const tk = document.createElementNS(svgNs, 'line');
    tk.setAttribute('x1', padL - 4); tk.setAttribute('y1', y);
    tk.setAttribute('x2', padL); tk.setAttribute('y2', y);
    tk.setAttribute('stroke', '#9aa3b5');
    svg.appendChild(tk);
    const tx = document.createElementNS(svgNs, 'text');
    tx.setAttribute('x', padL - 6); tx.setAttribute('y', y + 3);
    tx.setAttribute('font-size', '10'); tx.setAttribute('fill', '#5a6374');
    tx.setAttribute('text-anchor', 'end');
    tx.textContent = p >= 1000 ? (p / 1000).toFixed(0) + 'k' : p.toFixed(0);
    svg.appendChild(tx);
  }
  // Подпись осей
  const xlab = document.createElementNS(svgNs, 'text');
  xlab.setAttribute('x', padL + plotW / 2); xlab.setAttribute('y', H - 4);
  xlab.setAttribute('font-size', '10'); xlab.setAttribute('fill', '#5a6374');
  xlab.setAttribute('text-anchor', 'middle');
  xlab.textContent = 'Время разряда, мин (log)';
  svg.appendChild(xlab);
  const ylab = document.createElementNS(svgNs, 'text');
  ylab.setAttribute('x', 10); ylab.setAttribute('y', padT + plotH / 2);
  ylab.setAttribute('font-size', '10'); ylab.setAttribute('fill', '#5a6374');
  ylab.setAttribute('transform', `rotate(-90 10 ${padT + plotH / 2})`);
  ylab.setAttribute('text-anchor', 'middle');
  ylab.textContent = 'Мощность/блок, Вт (log)';
  svg.appendChild(ylab);

  // Кривые endV (выбранная — синяя, остальные — серые)
  const palette = ['#1976d2', '#2e7d32', '#ef6c00', '#7e57c2', '#00838f', '#c62828'];
  endVs.forEach((ev, i) => {
    const pts = byEv.get(ev);
    const isSelected = Math.abs(ev - (opts.selectedEndV || 0)) < 0.001;
    const color = isSelected ? '#1976d2' : palette[i % palette.length];
    const d = pts.map((p, idx) => {
      if (p.tMin <= 0 || p.powerW <= 0) return '';
      return (idx === 0 ? 'M' : 'L') + xOf(p.tMin).toFixed(1) + ',' + yOf(p.powerW).toFixed(1);
    }).filter(Boolean).join(' ');
    if (!d) return;
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', isSelected ? 2 : 1);
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', isSelected ? 1 : 0.5);
    svg.appendChild(path);
    // Подпись кривой справа
    const last = pts[pts.length - 1];
    if (last) {
      const t = document.createElementNS(svgNs, 'text');
      t.setAttribute('x', xOf(last.tMin) + 3);
      t.setAttribute('y', yOf(last.powerW) + 3);
      t.setAttribute('font-size', '9');
      t.setAttribute('fill', color);
      t.textContent = ev.toFixed(2) + ' В';
      svg.appendChild(t);
    }
  });

  // Рабочая точка
  if (opts.operPowerW > 0 && opts.operTimeMin > 0 && Number.isFinite(opts.operTimeMin)) {
    const x = xOf(opts.operTimeMin), y = yOf(opts.operPowerW);
    const vline = document.createElementNS(svgNs, 'line');
    vline.setAttribute('x1', x); vline.setAttribute('y1', padT);
    vline.setAttribute('x2', x); vline.setAttribute('y2', padT + plotH);
    vline.setAttribute('stroke', '#c62828');
    vline.setAttribute('stroke-dasharray', '3,2');
    svg.appendChild(vline);
    const hline = document.createElementNS(svgNs, 'line');
    hline.setAttribute('x1', padL); hline.setAttribute('y1', y);
    hline.setAttribute('x2', padL + plotW); hline.setAttribute('y2', y);
    hline.setAttribute('stroke', '#c62828');
    hline.setAttribute('stroke-dasharray', '3,2');
    svg.appendChild(hline);
    const dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);
    dot.setAttribute('fill', '#c62828');
    svg.appendChild(dot);
    const lab = document.createElementNS(svgNs, 'text');
    lab.setAttribute('x', x + 6); lab.setAttribute('y', y - 6);
    lab.setAttribute('font-size', '10');
    lab.setAttribute('fill', '#c62828');
    lab.setAttribute('font-weight', '600');
    lab.textContent = fmt(opts.operPowerW) + ' Вт · ' + fmt(opts.operTimeMin) + ' мин';
    svg.appendChild(lab);
  }

  mount.appendChild(svg);
}

// Структурная схема ИБП (SVG).
// Возвращает { svg, width, height } — высота зависит от числа модулей.
// Компоновка: три входа слева (Bypass / Mains / Battery), стек
// Power Modules в середине, Maintenance bypass сверху, Output справа.
function _upsStructSvg(n, flows) {
  const { outA, inA, inBypassA, battA, onBypass, onBattery } = flows;
  const colActive = '#2979ff';
  const colBypass = '#ff9800';
  const colBatt = '#43a047';
  const colIdle = '#cfd4e0';
  const fmtA = (a) => a > 0 ? `${fmt(a)} A` : '';

  // Новая цветовая модель с раздельными цветами для каждой фазы напряжения:
  //   синий    — Mains (AC вход)
  //   зелёный  — Battery (постоянный ток от АКБ через DC/DC)
  //   фиолетовый — DC bus (после выпрямителя, между REC/DC/DC/INV)
  //   бирюзовый — Output (AC после инвертора, «чистая синусоида»)
  //   оранжевый — SBS-тиристор в пиктограмме Bypass module (только символ)
  const colDC = '#7e57c2';   // DC внутренняя шина
  const colOut = '#00bcd4';  // выход инвертора / output bus в инверторном режиме

  // Состояния автоматов
  const qf1on = n.hasInputBreaker !== false && n.inputBreakerOn !== false;
  const qf2on = n.hasInputBypassBreaker !== false && n.inputBypassBreakerOn !== false;
  const qf3on = n.hasOutputBreaker !== false && n.outputBreakerOn !== false;
  const qf4on = n.hasBypassBreaker !== false && n.bypassBreakerOn !== false;
  const qbon = n.hasBatteryBreaker !== false && n.batteryBreakerOn !== false;
  // Mains доступен (не в режиме батареи)
  const mainsFed = effectiveOn(n) && !onBattery;
  // Maintenance bypass замкнут (QF4 on) — физическое короткое замыкание
  // входа на выход. В этом режиме выход виден «сырым mains».
  const maintBypassActive = mainsFed && qf4on;
  // Static bypass (SBS) проводит: форсированный или авто-перегруз или oneBypass
  const sbsConducting = mainsFed && qf2on && onBypass;
  // Обобщённое «байпас активен» (либо maint, либо SBS) — выход = mains
  const bypassOutputActive = maintBypassActive || sbsConducting;

  // Участок ДО QF1 — живой, пока есть mains (до всех точек ветвления).
  const mainsPreCol = mainsFed ? colActive : colIdle;
  // Участок после QF1 к mains-шине (к AC/DC модулей) — живой когда QF1 замкнут.
  const afterQF1Col = (mainsFed && qf1on) ? colActive : colIdle;
  // Обратная совместимость с переменной mainsLineCol — используется в mains-шине.
  const mainsLineCol = afterQF1Col;

  // Байпасная ветка ДО QF2 (от jumper до левой клеммы QF2) — mains (синий),
  // т.к. это физически провод с напряжением сети.
  const preQF2Col = mainsFed ? colActive : colIdle;
  // Байпасная ветка ПОСЛЕ QF2 через SBS к xOutBus — живая (синяя, т.к.
  // тоже mains-проводник) когда mainsFed && qf2on.
  const postQF2Col = (mainsFed && qf2on) ? colActive : colIdle;
  // Общий цвет для обратной совместимости (вызовов bypassWireCol в старом коде)
  const bypassWireCol = postQF2Col;

  // Maintenance bypass (верхняя горизонталь) — синий (mains) когда живой.
  const maintWireCol = maintBypassActive ? colActive : colIdle;

  // Battery
  const battOn = qbon && onBattery;
  const battCableCol = battOn ? colBatt : colIdle;

  // Внутренний DC bus каждого модуля:
  //   — инверторный режим: AC/DC выпрямляет mains → фиолетовый
  //   — батарея: DC/DC поднимает напряжение от АКБ → фиолетовый
  //   — байпас (SBS/maint): инвертор простаивает → DC bus серый
  const dcBusActive = (mainsFed && qf1on && !bypassOutputActive) || onBattery;
  const dcBusCol = dcBusActive ? colDC : colIdle;
  // Выход инвертора: бирюзовый когда инвертор работает (нормальный или батарейный),
  // серый на байпасе.
  const invOutActive = dcBusActive && !bypassOutputActive;
  const invOutCol = invOutActive ? colOut : colIdle;
  // Output bus + вся выходная цепь до клеммы Output:
  //   — на байпасе (maint или SBS) — синий (mains pass-through)
  //   — иначе когда инвертор работает — бирюзовый
  //   — иначе серый
  const outCol = bypassOutputActive ? colActive : (invOutActive ? colOut : colIdle);

  const bypassSeparate = n.bypassFeedMode === 'separate';
  const isModular = n.upsType === 'modular';
  const totalModules = isModular
    ? Math.max(1, Number(n.moduleInstalled ?? n.moduleCount) || 1)
    : 1;
  // Для модульного ИБП показываем ТОЛЬКО первый и последний модуль
  // (с "⋮" между ними, если всего больше двух). Для моноблока — один.
  const visibleModuleIndices = [];
  if (!isModular || totalModules === 1) {
    visibleModuleIndices.push(0);
  } else if (totalModules === 2) {
    visibleModuleIndices.push(0, 1);
  } else {
    visibleModuleIndices.push(0, totalModules - 1);
  }
  const showCount = visibleModuleIndices.length;
  const drawDots = isModular && totalModules > 2;

  // Координаты
  const xLeftLabel = 50;
  const xInputTerm = 50;
  const xQF1 = 200;
  const xMainsBus = 280;
  const xBattBus = 305;
  const modX = 340;
  const modW = 420;
  const xOutBus = 800;
  const xQF3 = 860;
  const xOutTerm = 930;

  const yMaint = 40;
  const yBypass = 110;
  const yMains = 210;
  const yBatt = 290;
  const modStartY = 170;
  const modH = 115;
  const modGap = 30;

  // Компактный «пропущенные модули» блок между первым и последним
  // (только когда drawDots=true и есть минимум 3 модуля).
  const compactH = drawDots ? 38 : 0;
  const tightGap = drawDots ? 12 : modGap;

  const modulePositions = [];
  let curY = modStartY;
  // первый модуль
  modulePositions.push(curY);
  curY += modH;
  // компактный блок (если есть)
  let compactY = null;
  if (showCount > 1) {
    if (drawDots) {
      curY += tightGap;
      compactY = curY;
      curY += compactH + tightGap;
    } else {
      curY += modGap;
    }
    // второй (он же последний) модуль
    modulePositions.push(curY);
    curY += modH;
  }
  const H = curY + 40;
  const W = 980;

  const parts = [];
  // Группа-обёртка с дефолтным сглаживанием: shape-rendering
  // geometricPrecision (плавные диагонали), линии с закруглёнными концами
  // и сочленениями — для аккуратного вида на retina и zoom.
  parts.push(`<g shape-rendering="geometricPrecision" stroke-linecap="round" stroke-linejoin="round" text-rendering="optimizeLegibility">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fafbfc" rx="6" ry="6"/>`);

  // === Maintenance bypass (верхняя обходная линия) ===
  // Физически это одна линия с перемычкой ДО QF2 (и в jumper-режиме —
  // ДО QF1). Т.е. отключение QF2/QF1 не мешает maintenance bypass
  // выполнять свою работу. Точка ответвления:
  //   - в jumper-режиме (один ввод) — тот же jumperX, что и обычная
  //     байпасная ветка (xQF1 − 50, на mains-кабеле до QF1);
  //   - в separate-режиме (отдельный bypass input) — на байпасном
  //     кабеле до QF2.
  const hasQF4 = n.hasBypassBreaker !== false;
  const jumperForBypass = xQF1 - 50;
  const xMaintTap = bypassSeparate ? (xInputTerm + 70) : jumperForBypass;
  if (hasQF4) {
    const xQF4 = (xQF1 + xOutBus) / 2;
    parts.push(`<text x="${xQF4}" y="${yMaint - 30}" text-anchor="middle" font-size="11" fill="#546e7a">Maintenance bypass</text>`);
    parts.push(`<line x1="${xMaintTap}" y1="${yBypass}" x2="${xMaintTap}" y2="${yMaint}" stroke="${maintWireCol}" stroke-width="2" stroke-dasharray="4 3"/>`);
    parts.push(`<line x1="${xMaintTap}" y1="${yMaint}" x2="${xQF4 - 20}" y2="${yMaint}" stroke="${maintWireCol}" stroke-width="2" stroke-dasharray="4 3"/>`);
    parts.push(_svgBreaker(xQF4, yMaint, 'QF4', colBypass, qf4on, true, 'bypassBreakerOn'));
    parts.push(`<line x1="${xQF4 + 20}" y1="${yMaint}" x2="${xOutBus}" y2="${yMaint}" stroke="${maintWireCol}" stroke-width="2" stroke-dasharray="4 3"/>`);
    if (n.bypassBreakerIn) {
      parts.push(`<text x="${xQF4 + 25}" y="${yMaint + 5}" font-size="9" fill="#777">${n.bypassBreakerIn}A</text>`);
    }
  }

  // === Bypass input ===
  // В режиме 'separate' — отдельный кабель и терминал «Bypass input».
  // В режиме 'jumper'   — перемычка от шины mains (сверху), без отдельного входа.
  const hasQF2 = n.hasInputBypassBreaker !== false;
  if (bypassSeparate) {
    parts.push(`<text x="${xLeftLabel + 10}" y="${yBypass - 8}" font-size="11" fill="#546e7a">Bypass input</text>`);
    parts.push(`<circle cx="${xInputTerm}" cy="${yBypass}" r="4" fill="none" stroke="#666" stroke-width="1.5"/>`);
    parts.push(`<line x1="${xInputTerm + 5}" y1="${yBypass}" x2="${hasQF2 ? xQF1 - 20 : 460}" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="3"/>`);
    if (hasQF2) {
      parts.push(_svgBreaker(xQF1, yBypass, 'QF2', colBypass, qf2on, true, 'inputBypassBreakerOn'));
      if (n.inputBypassBreakerIn) parts.push(`<text x="${xQF1 + 25}" y="${yBypass + 5}" font-size="9" fill="#777">${n.inputBypassBreakerIn}A</text>`);
      parts.push(`<line x1="${xQF1 + 20}" y1="${yBypass}" x2="460" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="3"/>`);
    }
  } else {
    // Jumper: перемычка от mains-линии до байпасной ветки.
    // Ответвление делается ПЕРЕД QF1 (на участке кабеля от клеммы
    // Mains input до QF1), чтобы QF1 не отключал байпас / maint bypass.
    // Физически это одно ответвление на байпасную ветку, из которого
    // далее уходит и maintenance bypass (выше), и обычная байпасная
    // ветка через QF2 и SBS-модуль.
    const jumperX = jumperForBypass;
    parts.push(`<text x="${jumperX - 6}" y="${yBypass - 8}" text-anchor="end" font-size="10" fill="#888">перемычка maint-bypass</text>`);
    // Вертикаль jumper'а: «живая» пока есть mains (до QF1 — до QF2).
    const jumperVertCol = mainsFed ? colActive : colIdle;
    parts.push(`<line x1="${jumperX}" y1="${yMains}" x2="${jumperX}" y2="${yBypass}" stroke="${jumperVertCol}" stroke-width="2"/>`);
    parts.push(`<circle cx="${jumperX}" cy="${yMains}" r="3" fill="${jumperVertCol}"/>`);
    // Горизонталь от jumper до QF2 — тоже «живая» когда есть mains
    // (до QF2 ветка ещё не зависит от QF2).
    const preQF2Col = mainsFed ? colBypass : colIdle;
    if (hasQF2) {
      parts.push(_svgBreaker(xQF1, yBypass, 'QF2', colBypass, qf2on, true, 'inputBypassBreakerOn'));
      if (n.inputBypassBreakerIn) parts.push(`<text x="${xQF1 + 25}" y="${yBypass + 5}" font-size="9" fill="#777">${n.inputBypassBreakerIn}A</text>`);
      parts.push(`<line x1="${jumperX}" y1="${yBypass}" x2="${xQF1 - 20}" y2="${yBypass}" stroke="${preQF2Col}" stroke-width="3"/>`);
      parts.push(`<line x1="${xQF1 + 20}" y1="${yBypass}" x2="460" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="3"/>`);
    } else {
      parts.push(`<line x1="${jumperX}" y1="${yBypass}" x2="460" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="3"/>`);
    }
  }
  // Bypass module: пунктирная рамка с SCR-тиристором внутри
  const bmX = 460, bmW = 200, bmY = yBypass - 28, bmH = 56;
  parts.push(`<rect x="${bmX}" y="${bmY}" width="${bmW}" height="${bmH}" fill="#fff" stroke="#9aa3ad" stroke-width="1" stroke-dasharray="3 3" rx="6" ry="6"/>`);
  parts.push(`<text x="${bmX + bmW - 8}" y="${bmY + bmH - 6}" text-anchor="end" font-size="10" fill="#777">Bypass module</text>`);
  // SCR-тиристор (треугольник + катод + gate)
  const scrX = bmX + bmW / 2, scrY = yBypass;
  parts.push(`<polygon points="${scrX - 10},${scrY - 10} ${scrX - 10},${scrY + 10} ${scrX + 6},${scrY}" fill="none" stroke="${bypassWireCol}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${scrX + 6}" y1="${scrY - 10}" x2="${scrX + 6}" y2="${scrY + 10}" stroke="${bypassWireCol}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${scrX + 8}" y1="${scrY - 3}" x2="${scrX + 16}" y2="${scrY - 11}" stroke="${bypassWireCol}" stroke-width="1.2"/>`);
  parts.push(`<line x1="${bmX}" y1="${yBypass}" x2="${scrX - 10}" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="2"/>`);
  parts.push(`<line x1="${scrX + 6}" y1="${yBypass}" x2="${bmX + bmW}" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="2"/>`);
  parts.push(`<line x1="${bmX + bmW}" y1="${yBypass}" x2="${xOutBus}" y2="${yBypass}" stroke="${bypassWireCol}" stroke-width="3"/>`);
  if (inBypassA > 0) parts.push(`<text x="${xQF1 + 24}" y="${yBypass - 8}" font-size="10" fill="${colBypass}" font-weight="600">${fmtA(inBypassA)}</text>`);

  // === Mains input ===
  // Участок ДО QF1 (от клеммы до jumper и далее до QF1) живой пока есть
  // mains (mainsPreCol). После QF1 — только если QF1 замкнут и работаем
  // в инверторном режиме (mainsLineCol).
  const hasQF1 = n.hasInputBreaker !== false;
  parts.push(`<text x="${xLeftLabel + 10}" y="${yMains - 8}" font-size="11" fill="#546e7a">Mains input${bypassSeparate ? ' (осн.)' : ''}</text>`);
  parts.push(`<circle cx="${xInputTerm}" cy="${yMains}" r="4" fill="none" stroke="#666" stroke-width="1.5"/>`);
  parts.push(`<line x1="${xInputTerm + 5}" y1="${yMains}" x2="${hasQF1 ? xQF1 - 20 : xMainsBus}" y2="${yMains}" stroke="${mainsPreCol}" stroke-width="3"/>`);
  if (hasQF1) {
    parts.push(_svgBreaker(xQF1, yMains, 'QF1', colActive, qf1on, true, 'inputBreakerOn'));
    if (n.inputBreakerIn) parts.push(`<text x="${xQF1 + 25}" y="${yMains + 5}" font-size="9" fill="#777">${n.inputBreakerIn}A</text>`);
    parts.push(`<line x1="${xQF1 + 20}" y1="${yMains}" x2="${xMainsBus}" y2="${yMains}" stroke="${mainsLineCol}" stroke-width="3"/>`);
  }
  if (inA > 0) parts.push(`<text x="${xQF1 + 24}" y="${yMains + 18}" font-size="10" fill="${colActive}" font-weight="600">${fmtA(inA)}</text>`);

  // === Battery input + символ АКБ ===
  // Рисуем реальный условный символ батареи (несколько пар пластин +/−)
  // слева от QB. Под схемой — лейбл «АКБ».
  const hasQB = n.hasBatteryBreaker !== false;
  {
    // Батарея: 3 пары пластин (+ длинная, − короткая), ширина ~40 px
    const battAnchorX = 12;
    const pitch = 10;
    for (let k = 0; k < 3; k++) {
      const px = battAnchorX + k * pitch;
      // + (длинная)
      parts.push(`<line x1="${px}" y1="${yBatt - 12}" x2="${px}" y2="${yBatt + 12}" stroke="#263238" stroke-width="3"/>`);
      // − (короткая)
      parts.push(`<line x1="${px + 4}" y1="${yBatt - 7}" x2="${px + 4}" y2="${yBatt + 7}" stroke="#263238" stroke-width="2"/>`);
    }
    parts.push(`<text x="${battAnchorX + 13}" y="${yBatt - 16}" text-anchor="middle" font-size="11" fill="#546e7a" font-weight="600">АКБ</text>`);
    // Подпись напряжения блока DC
    const blockV = (Number(n.batteryCellCount) || 0) * (Number(n.batteryCellVoltage) || 0);
    if (blockV > 0) parts.push(`<text x="${battAnchorX + 13}" y="${yBatt + 24}" text-anchor="middle" font-size="9" fill="#777">${fmt(blockV)} В DC</text>`);
    // Провод от АКБ к QB (или к xBattBus если QB нет). Делаем id для анимации.
    const battWireX1 = battAnchorX + 28; // после правой пластины
    const battWireX2 = hasQB ? xQF1 - 20 : xBattBus;
    parts.push(`<line id="ups-batt-anim-a" x1="${battWireX1}" y1="${yBatt}" x2="${battWireX2}" y2="${yBatt}" stroke="${battCableCol}" stroke-width="3"/>`);
    if (hasQB) {
      parts.push(_svgBreaker(xQF1, yBatt, 'QB', colBatt, qbon, true, 'batteryBreakerOn'));
      if (n.batteryBreakerIn) parts.push(`<text x="${xQF1 + 25}" y="${yBatt + 5}" font-size="9" fill="#777">${n.batteryBreakerIn}A</text>`);
      parts.push(`<line id="ups-batt-anim-b" x1="${xQF1 + 20}" y1="${yBatt}" x2="${xBattBus}" y2="${yBatt}" stroke="${battCableCol}" stroke-width="3"/>`);
    }
  }
  if (battA > 0) parts.push(`<text x="${xQF1 + 24}" y="${yBatt + 18}" font-size="10" fill="${colBatt}" font-weight="600">${fmtA(battA)}</text>`);

  // Предварительные координаты середины REC/INV/DC-DC у каждого модуля.
  // Должны СТРОГО совпадать с формулами в блоке рисования модулей ниже,
  // иначе горизонтальные подключения не попадают в шины.
  //   recY = mY + 20, recH = 40 → mid = mY + 40
  //   ddY  = mY + modH - 54, ddH = 38 → mid = mY + modH - 35
  const recRowY = (mY) => mY + 40;
  const ddRowY  = (mY) => mY + modH - 35;

  // === Вертикальные шины (mains / battery / output) ===
  const mainsYs = modulePositions.map(recRowY);
  mainsYs.push(yMains);
  parts.push(`<line x1="${xMainsBus}" y1="${Math.min(...mainsYs)}" x2="${xMainsBus}" y2="${Math.max(...mainsYs)}" stroke="${mainsLineCol}" stroke-width="3"/>`);
  parts.push(`<circle cx="${xMainsBus}" cy="${yMains}" r="3" fill="${mainsLineCol}"/>`);

  const battYs = modulePositions.map(ddRowY);
  battYs.push(yBatt);
  parts.push(`<line x1="${xBattBus}" y1="${Math.min(...battYs)}" x2="${xBattBus}" y2="${Math.max(...battYs)}" stroke="${battCableCol}" stroke-width="3"/>`);
  parts.push(`<circle cx="${xBattBus}" cy="${yBatt}" r="3" fill="${battCableCol}"/>`);

  const outYs = modulePositions.map(recRowY);
  outYs.push(yBypass);
  if (n.hasBypassBreaker !== false) outYs.push(yMaint);
  parts.push(`<line x1="${xOutBus}" y1="${Math.min(...outYs)}" x2="${xOutBus}" y2="${Math.max(...outYs)}" stroke="${outCol === colIdle ? colIdle : outCol}" stroke-width="3"/>`);

  // === Power modules ===
  for (let i = 0; i < showCount; i++) {
    const mY = modulePositions[i];
    const realIdx = visibleModuleIndices[i];
    const modActive = isModular
      ? (Array.isArray(n.modulesActive) ? n.modulesActive[realIdx] !== false : true)
      : true;
    // Per-module цвета:
    //   modMainCol — синий mains на AC/DC входе
    //   modDcCol   — фиолетовый на внутренней DC-шине (REC → DC bus ↔ DC/DC)
    //   modOutCol  — бирюзовый на выходе DC/AC → output bus
    //   modBattCol — зелёный на линии battery bus → DC/DC
    const modMainCol = (modActive && mainsFed && qf1on && !bypassOutputActive) ? colActive : colIdle;
    const modDcCol   = (modActive && dcBusActive) ? colDC : colIdle;
    const modOutCol  = (modActive && invOutActive) ? colOut : colIdle;
    const modBattCol = (modActive && onBattery && qbon) ? colBatt : colIdle;
    // Старые имена — для случайных ссылок ниже (оставляем как aliases)
    const modInvCol = modOutCol;

    // Рамка модуля (пунктирная светло-серая, со скруглением)
    parts.push(`<rect x="${modX}" y="${mY}" width="${modW}" height="${modH}" fill="#fafafa" stroke="#aaa" stroke-width="1" stroke-dasharray="3 3" rx="8" ry="8"/>`);
    const label = totalModules === 1
      ? 'Power module'
      : `Power module ${realIdx + 1}${drawDots && i === showCount - 1 ? ' (из ' + totalModules + ')' : ''}`;
    parts.push(`<text x="${modX + modW - 10}" y="${mY + modH - 8}" text-anchor="end" font-size="10" fill="#777">${label}</text>`);
    if (isModular && !modActive) {
      parts.push(`<text x="${modX + 18}" y="${mY + modH - 8}" font-size="10" fill="#c62828" font-weight="600">⊗ ОТКЛ</text>`);
    }

    // AC/DC rectifier
    const recX = modX + 40, recY = mY + 20, recW = 64, recH = 40;
    parts.push(`<rect x="${recX}" y="${recY}" width="${recW}" height="${recH}" fill="#fff" stroke="${modMainCol === colIdle ? '#aaa' : modMainCol}" stroke-width="1.8" rx="5" ry="5"/>`);
    parts.push(`<text x="${recX + 16}" y="${recY + 17}" font-size="10" fill="#2b303b" font-weight="700">AC</text>`);
    parts.push(`<line x1="${recX + 8}" y1="${recY + recH - 8}" x2="${recX + recW - 8}" y2="${recY + 8}" stroke="#777" stroke-width="1"/>`);
    parts.push(`<text x="${recX + recW - 16}" y="${recY + recH - 5}" font-size="10" fill="#2b303b" font-weight="700">DC</text>`);

    // DC/AC inverter — обводка = output color (бирюзовый)
    const invX = modX + modW - 104, invY = mY + 20, invW = 64, invH = 40;
    parts.push(`<rect x="${invX}" y="${invY}" width="${invW}" height="${invH}" fill="#fff" stroke="${modOutCol === colIdle ? '#aaa' : modOutCol}" stroke-width="1.8" rx="5" ry="5"/>`);
    parts.push(`<text x="${invX + 16}" y="${invY + 17}" font-size="10" fill="#2b303b" font-weight="700">DC</text>`);
    parts.push(`<line x1="${invX + 8}" y1="${invY + invH - 8}" x2="${invX + invW - 8}" y2="${invY + 8}" stroke="#777" stroke-width="1"/>`);
    parts.push(`<text x="${invX + invW - 16}" y="${invY + invH - 5}" font-size="10" fill="#2b303b" font-weight="700">AC</text>`);

    // DC/DC charger (центр снизу) — обводка = battery (зелёный) или DC (фиолетовый)
    const ddX = modX + modW / 2 - 32, ddY = mY + modH - 54, ddW = 64, ddH = 38;
    const ddStroke = modBattCol !== colIdle ? modBattCol : (modDcCol !== colIdle ? modDcCol : '#aaa');
    parts.push(`<rect x="${ddX}" y="${ddY}" width="${ddW}" height="${ddH}" fill="#fff" stroke="${ddStroke}" stroke-width="1.8" rx="5" ry="5"/>`);
    parts.push(`<text x="${ddX + 16}" y="${ddY + 15}" font-size="10" fill="#2b303b" font-weight="700">DC</text>`);
    parts.push(`<line x1="${ddX + 8}" y1="${ddY + ddH - 6}" x2="${ddX + ddW - 8}" y2="${ddY + 6}" stroke="#777" stroke-width="1"/>`);
    parts.push(`<text x="${ddX + ddW - 16}" y="${ddY + ddH - 5}" font-size="10" fill="#2b303b" font-weight="700">DC</text>`);

    // Внутренняя DC-шина REC → DC bus → INV (inверторный вход) — ФИОЛЕТОВАЯ.
    // НЕ проходит сквозь DC/AC (для выхода используется modOutCol ниже).
    const dcBusY = recY + recH / 2;
    parts.push(`<line x1="${recX + recW}" y1="${dcBusY}" x2="${invX}" y2="${dcBusY}" stroke="${modDcCol}" stroke-width="2"/>`);
    // DC/DC ↕ внутренняя DC-шина — тоже фиолетовая (DC сторона DC/DC)
    parts.push(`<line x1="${ddX + ddW / 2}" y1="${ddY}" x2="${ddX + ddW / 2}" y2="${dcBusY}" stroke="${modDcCol}" stroke-width="2"/>`);
    parts.push(`<circle cx="${ddX + ddW / 2}" cy="${dcBusY}" r="2.8" fill="${modDcCol}"/>`);

    // Внешние подключения к шинам
    // AC/DC ← mains bus
    parts.push(`<line x1="${xMainsBus}" y1="${recY + recH / 2}" x2="${recX}" y2="${recY + recH / 2}" stroke="${modMainCol}" stroke-width="2.5"/>`);
    parts.push(`<circle cx="${xMainsBus}" cy="${recY + recH / 2}" r="2.5" fill="${mainsLineCol}"/>`);
    // DC/DC ← battery bus
    parts.push(`<line x1="${xBattBus}" y1="${ddY + ddH / 2}" x2="${ddX}" y2="${ddY + ddH / 2}" stroke="${modBattCol}" stroke-width="2.5"/>`);
    parts.push(`<circle cx="${xBattBus}" cy="${ddY + ddH / 2}" r="2.5" fill="${battCableCol}"/>`);
    // DC/AC → output bus — бирюзовый в инверторном режиме, серый на байпасе
    parts.push(`<line x1="${invX + invW}" y1="${invY + invH / 2}" x2="${xOutBus}" y2="${invY + invH / 2}" stroke="${modOutCol}" stroke-width="2.5"/>`);
    parts.push(`<circle cx="${xOutBus}" cy="${invY + invH / 2}" r="2.5" fill="${modOutCol === colIdle ? colIdle : colOut}"/>`);
  }

  // Компактный блок «пропущенные модули» — без внутренностей, мало
  // места по вертикали. Показывает диапазон индексов и количество.
  // Рисуется между первым и последним модулем (только когда drawDots).
  if (drawDots && compactY != null) {
    const skipCount = totalModules - 2;
    const fromIdx = 2, toIdx = totalModules - 1;
    const cY = compactY;
    const cH = compactH;
    // Пунктирная рамка
    parts.push(`<rect x="${modX}" y="${cY}" width="${modW}" height="${cH}" fill="#f5f5f5" stroke="#bbb" stroke-width="1" stroke-dasharray="2 3" rx="5"/>`);
    // Текст внутри
    parts.push(`<text x="${modX + modW / 2}" y="${cY + cH / 2 + 4}" text-anchor="middle" font-size="11" fill="#666">… модули ${fromIdx}…${toIdx} (${skipCount} шт) …</text>`);
    // «Прозрачные» сегменты подключения к шинам на уровне середины блока
    const midY = cY + cH / 2;
    parts.push(`<line x1="${xMainsBus}" y1="${midY}" x2="${modX + 40}" y2="${midY}" stroke="${mainsLineCol}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.55"/>`);
    parts.push(`<line x1="${modX + modW - 40}" y1="${midY}" x2="${xOutBus}" y2="${midY}" stroke="${outCol === colIdle ? colIdle : outCol}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.55"/>`);
    parts.push(`<line x1="${xBattBus}" y1="${midY}" x2="${modX + 40}" y2="${midY}" stroke="${battCableCol}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.4"/>`);
  }

  // === Output switch QF3 + клемма ===
  const hasQF3 = n.hasOutputBreaker !== false;
  const qf3Y = modulePositions[0] ? (modulePositions[0] + 40) : 210; // уровень первого инвертора
  if (hasQF3) {
    parts.push(`<line x1="${xOutBus}" y1="${qf3Y}" x2="${xQF3 - 20}" y2="${qf3Y}" stroke="${outCol}" stroke-width="3"/>`);
    parts.push(_svgBreaker(xQF3, qf3Y, 'QF3', colActive, qf3on, true, 'outputBreakerOn'));
    if (n.outputBreakerIn) parts.push(`<text x="${xQF3 + 25}" y="${qf3Y + 5}" font-size="9" fill="#777">${n.outputBreakerIn}A</text>`);
    parts.push(`<line x1="${xQF3 + 20}" y1="${qf3Y}" x2="${xOutTerm - 5}" y2="${qf3Y}" stroke="${outCol}" stroke-width="3"/>`);
  } else {
    parts.push(`<line x1="${xOutBus}" y1="${qf3Y}" x2="${xOutTerm - 5}" y2="${qf3Y}" stroke="${outCol}" stroke-width="3"/>`);
  }
  parts.push(`<circle cx="${xOutTerm}" cy="${qf3Y}" r="4" fill="none" stroke="#666" stroke-width="1.5"/>`);
  parts.push(`<text x="${xOutTerm + 8}" y="${qf3Y + 4}" font-size="11" fill="#546e7a">Output</text>`);
  if (outA > 0) parts.push(`<text x="${xQF3 - 36}" y="${qf3Y + 18}" font-size="10" fill="${outCol}" font-weight="600">${fmtA(outA)}</text>`);

  // === Анимация тока заряда/разряда АКБ ===
  // Charging: ток течёт ИЗ mains → DC/DC → АКБ (направление вправо→влево).
  // Discharging: ток течёт ИЗ АКБ → DC/DC → INV → Output (направление влево→вправо).
  const isCharging = mainsFed && qf1on && qbon && (Number(n.batteryChargePct) || 0) < 100 && (Number(n.chargeA) || 0) > 0;
  const isDischarging = onBattery && qbon;
  if (isCharging || isDischarging) {
    // Скорость зависит от величины тока: charging → chargeA, discharging → battA
    const I = isCharging ? (Number(n.chargeA) || 1) : Math.max(1, battA || 1);
    const dur = Math.max(0.4, Math.min(3.5, 20 / I));
    // Направление: charging — dashoffset возрастает (dashes едут справа налево),
    //               discharging — dashoffset убывает (dashes едут слева направо).
    const from = isCharging ? '0' : '0';
    const to   = isCharging ? '20' : '-20';
    // Добавляем общий style для всех элементов батарейной цепи
    const animColor = isCharging ? colBatt : colBatt;
    // Применяем stroke-dasharray к видимым сегментам батарейной цепи.
    // Переопределяем stroke тех line-элементов, которые мы пометили id'ами
    // (ups-batt-anim-a/b), и рисуем поверх них тонкую «бегущую» штриховую линию.
    const animLines = [];
    // 1) АКБ → QB (или до шины если QB нет)
    // 2) QB → xBattBus (если QB есть)
    // 3) Вертикальная шина xBattBus
    // 4) Горизонтали xBattBus → ddX у каждого видимого модуля
    const battAnchorX = 12 + 2 * 10 + 28; // правая пластина + отступ = battWireX1 из блока выше
    const battWireEndA = hasQB ? xQF1 - 20 : xBattBus;
    animLines.push({ x1: battAnchorX, y1: yBatt, x2: battWireEndA, y2: yBatt });
    if (hasQB) animLines.push({ x1: xQF1 + 20, y1: yBatt, x2: xBattBus, y2: yBatt });
    // Вертикаль шины (от yBatt вверх до самого верхнего модуля DC/DC)
    const ddYs = modulePositions.map(ddRowY);
    if (ddYs.length) {
      const topY = Math.min(yBatt, ...ddYs);
      const botY = Math.max(yBatt, ...ddYs);
      animLines.push({ x1: xBattBus, y1: topY, x2: xBattBus, y2: botY });
    }
    // Горизонтали к каждому модулю (только для активных модулей).
    // y — середина DC/DC блока (= ddRowY), совпадает со статической
    // линией x1=xBattBus .. x2=ddX, нарисованной в блоке модуля.
    for (let i = 0; i < showCount; i++) {
      const mY = modulePositions[i];
      const realIdx = visibleModuleIndices[i];
      const modActive = isModular
        ? (Array.isArray(n.modulesActive) ? n.modulesActive[realIdx] !== false : true)
        : true;
      if (!modActive) continue;
      const ddX = modX + modW / 2 - 32;
      const yMid = ddRowY(mY);
      animLines.push({ x1: xBattBus, y1: yMid, x2: ddX, y2: yMid });
    }
    for (const ln of animLines) {
      parts.push(`<line x1="${ln.x1}" y1="${ln.y1}" x2="${ln.x2}" y2="${ln.y2}" stroke="${animColor}" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" opacity="0.9">
        <animate attributeName="stroke-dashoffset" from="${from}" to="${to}" dur="${dur}s" repeatCount="indefinite"/>
      </line>`);
    }
  }

  // Закрываем общую группу сглаживания
  parts.push(`</g>`);

  return { svg: parts.join(''), width: W, height: H };
}

// Горизонтальный автомат в стиле однолинейок щитов: верхний контакт (круг),
// механизм-крестик, контакт (замкнут — прямая; разомкнут — отклонён на 30°
// вверх-влево от правой точки оси), ось вращения. Ширина ≈ 40 px.
// Когда present=false — штрих-пунктирная линия с лейблом (место зарезервировано).
// onKey — если передан, автомат оборачивается в <g data-ups-brk="...">
// с cursor:pointer для кликов из Control modal.
function _svgBreaker(cx, cy, label, color, on, present = true, onKey = null) {
  const body = _svgBreakerBody(cx, cy, label, color, on, present);
  if (onKey) {
    // Прозрачный прямоугольник-хит поверх + сам автомат, обёрнутые в <g>
    return `<g data-ups-brk="${onKey}" style="cursor:pointer" class="ups-brk-hit">` +
      `<rect x="${cx - 22}" y="${cy - 14}" width="44" height="28" fill="transparent"/>` +
      body +
      `</g>`;
  }
  return body;
}
function _svgBreakerBody(cx, cy, label, color, on, present = true) {
  if (!present) {
    return `<line x1="${cx - 20}" y1="${cy}" x2="${cx + 20}" y2="${cy}" stroke="#ccc" stroke-width="2" stroke-dasharray="2 2"/>
            <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="9" fill="#999">${label}</text>`;
  }
  const col = on ? color : '#ff9800';
  const wireCol = on ? color : '#bbb';
  // Геометрия (горизонталь)
  const leftTerm = cx - 20;          // левый неподвижный контакт
  const crossX = cx - 7;             // крестик механизма
  const pivotX = cx + 13;            // ось вращения (правая сторона)
  const rightTerm = cx + 20;         // правый выход
  let s = '';
  // Левый провод до крестика
  s += `<line x1="${leftTerm}" y1="${cy}" x2="${crossX - 4}" y2="${cy}" stroke="${wireCol}" stroke-width="2"/>`;
  // Крестик механизма
  s += `<line x1="${crossX - 4}" y1="${cy - 4}" x2="${crossX + 4}" y2="${cy + 4}" stroke="${col}" stroke-width="1.5"/>`;
  s += `<line x1="${crossX + 4}" y1="${cy - 4}" x2="${crossX - 4}" y2="${cy + 4}" stroke="${col}" stroke-width="1.5"/>`;
  if (on) {
    // Замкнут: контакт от крестика к оси — горизонталь
    s += `<line x1="${crossX + 4}" y1="${cy}" x2="${pivotX}" y2="${cy}" stroke="${col}" stroke-width="2.5"/>`;
  } else {
    // Разомкнут: от оси вращения (справа) тяга уходит вверх-влево ~30°
    const contactLen = pivotX - (crossX + 4);
    const ang = 30 * Math.PI / 180;
    const tipX = pivotX - Math.cos(ang) * contactLen;
    const tipY = cy - Math.sin(ang) * contactLen;
    s += `<line x1="${pivotX}" y1="${cy}" x2="${tipX}" y2="${tipY}" stroke="${col}" stroke-width="2.5"/>`;
  }
  // Правый провод от оси
  s += `<line x1="${pivotX}" y1="${cy}" x2="${rightTerm}" y2="${cy}" stroke="${wireCol}" stroke-width="2"/>`;
  // Точки: левая клемма и ось вращения
  s += `<circle cx="${leftTerm}" cy="${cy}" r="2" fill="${wireCol}"/>`;
  s += `<circle cx="${pivotX}" cy="${cy}" r="2.5" fill="${col}"/>`;
  // Лейбл — НАД автоматом, чуть выше чтобы не перекрывать механизм
  // и возможную верхнюю клемму в разомкнутом состоянии (контакт уходит
  // вверх-влево ~30°, tipY = cy − sin(30°)·20 ≈ cy − 10).
  s += `<text x="${crossX}" y="${cy - 18}" text-anchor="middle" font-size="10" fill="#546e7a">${label}</text>`;
  return s;
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
  // Автономия: основной показатель — при МАКСИМАЛЬНОЙ нагрузке
  // (расчётный случай для АКБ), дополнительно показываем при текущей.
  const _autonomyFmt = (loadKwRef) => {
    if (!(loadKwRef > 0)) return null;
    const hrs = battKwh / loadKwRef;
    const min = hrs * 60;
    if (min >= 600) return '> 10 ч';
    if (min >= 60)  return hrs.toFixed(1) + ' ч';
    if (min >= 1)   return Math.round(min) + ' мин';
    return '< 1 мин';
  };
  const maxAut = _autonomyFmt(n._maxLoadKw || n._loadKw);
  if (maxAut) parts.push(`<b>автономия при макс. нагрузке: ${maxAut}</b>`);
  if (n._loadKw > 0 && (n._maxLoadKw || 0) > n._loadKw) {
    const curAut = _autonomyFmt(n._loadKw);
    if (curAut) parts.push(`<span class="muted">автономия при текущей (${fmt(n._loadKw)} kW): ${curAut}</span>`);
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
