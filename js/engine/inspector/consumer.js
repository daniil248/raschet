// Инспектор: модалка «Параметры потребителя».
// Выделено из inspector.js. Использует прямые импорты зависимостей.
import { GLOBAL, DEFAULTS, CONSUMER_CATALOG, CONSUMER_CATEGORIES, NODE_H, STARTER_TYPES } from '../constants.js';
import { state, uid } from '../state.js';
import { escHtml, escAttr, fmt, field, flash, helpIcon } from '../utils.js';
import { effectiveTag } from '../zones.js';
import { nextFreeTag } from '../graph.js';
import { snapshot, notifyChange } from '../history.js';
import { setEffectiveLoadFactor } from '../modes.js';
import { render } from '../render.js';
import { formatVoltageLevelLabel } from '../electrical.js';
import { rsPrompt } from '../../../shared/dialog.js';
import { getTerm, getTermTooltip, isTermUsed } from '../../methods/terms.js';

let _renderInspector = null;
export function bindInspectorConsumerDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}

export function openConsumerParamsModal(n) {
  const body = document.getElementById('consumer-params-body');
  if (!body) return;
  const isOutdoor = n.consumerSubtype === 'outdoor_unit';
  const h = [];
  // v0.59.371: fullCatalog поднят наверх — раньше он использовался в блоке
  // catalogLocked (строка ~83), но declared ниже (строка ~94), что давало
  // TDZ ReferenceError → модалка не открывалась для узлов с catalogLocked=true.
  // Это маскировалось как «не открывается для однофазных потребителей»,
  // потому что 1ф-нагрузки (освещение, бытовые) чаще привязаны к каталогу.
  const fullCatalog = [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])]
    .map(c => ({ ...c, category: c.category || 'other' }));
  // v0.59.98: только обозначение + название (read-only) над вкладками —
  // пользователь просит редактируемые поля убрать в свою вкладку. Для
  // редактирования имени открывается вкладка «Общее».
  h.push(`<h3 style="margin-bottom:4px">${escHtml(effectiveTag(n))} <span style="font-weight:500">${escHtml(n.name)}</span></h3>`);
  // v0.59.757: вкладка «Группа» отображается только когда consumer групповой
  // (count > 1). Содержимое: items-list для individual + плейсхолдеры для
  // 1.28.10 (cross-discipline reconciliation) и 1.28.13 (split-out).
  // ROADMAP 1.28.12.
  const _isGroupTabVisible = (Number(n.count) || 1) > 1;
  // Active-tab по умолчанию: «Группа» если групповой, иначе «Электрика».
  const _defaultTab = _isGroupTabVisible ? 'group' : 'electrical';
  h.push(`<div class="tp-tabs" role="tablist">
    <button type="button" class="tp-tab" data-tab="general" role="tab">📋 Общее</button>
    <button type="button" class="tp-tab${_defaultTab === 'electrical' ? ' active' : ''}" data-tab="electrical" role="tab">⚡ Электрика</button>
    ${_isGroupTabVisible ? `<button type="button" class="tp-tab${_defaultTab === 'group' ? ' active' : ''}" data-tab="group" role="tab">👥 Группа</button>` : ''}
    <button type="button" class="tp-tab" data-tab="geometry" role="tab">📐 Габариты</button>
  </div>`);
  // === Вкладка «Общее» (идентификация + топология) ===
  h.push(`<div class="tp-panel" data-panel="general" hidden>`);
  h.push(field('Имя', `<input type="text" id="cp-name" value="${escAttr(n.name || '')}">`));

  // v0.59.99: «Конфигурировать» и «Выбрать из каталога» — два быстрых
  // действия на вкладке «Общее». Конфигуратор выбирается по типу
  // (consumerSubtype / subtype); если нет специализированного — кнопка
  // открывает каталог в режиме «задать требования и подобрать изделие».
  // Каталог — всегда доступен; параметры n.consumerSubtype/subtype уходят
  // в query-string как подсказка для фильтра (catalog может их применить).
  {
    const _cSub = n.consumerSubtype || '';
    const _sub = n.subtype || '';
    const _cfg = (() => {
      if (_sub === 'rack' || _cSub === 'rack') return { href: 'rack-config/', label: '🗄 Конфигуратор стойки' };
      if (_cSub === 'conditioner' || _sub === 'hvac') return { href: 'psychrometrics/', label: '❄ Расчёт параметров HVAC' };
      // Универсальный fallback — «каталог в режиме требований»
      return { href: null, label: '⚙ Конфигуратор (задать требования)' };
    })();
    const _catalogHref = (() => {
      // v0.59.109: filterKind мапится в канонический ELEMENT_KINDS
      // на стороне catalog/ (через KIND_MAP в catalog.js). Отправляем
      // «интент» — какой подтип потребителя мы ищем; сторона каталога
      // сама подберёт подходящий kind (rack → rack, conditioner → climate).
      const qp = new URLSearchParams();
      const _hint = (_sub === 'rack' || _cSub === 'rack') ? 'rack'
                  : (_cSub === 'conditioner' || _sub === 'hvac') ? 'climate'
                  : '';
      if (_hint) qp.set('filterKind', _hint);
      if (_cSub) qp.set('filterSubtype', _cSub);
      if (_sub && _sub !== 'generic') qp.set('filterRole', _sub);
      qp.set('nodeId', n.id);
      return 'catalog/?' + qp.toString();
    })();
    h.push(`<div class="field" style="margin-top:8px"><label>Подбор изделия</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_cfg.href
          ? `<a href="${escAttr(_cfg.href)}" target="_blank" class="full-btn" style="flex:1;text-align:center;padding:6px 10px;background:#e3f2fd;color:#1565c0;text-decoration:none;border:1px solid #90caf9;border-radius:4px;font-size:12px;font-weight:500">${_cfg.label}</a>`
          : `<button type="button" id="cp-cfg-stub" class="full-btn" style="flex:1;padding:6px 10px;background:#fafbfc;color:#455a64;border:1px dashed #b0bec5;border-radius:4px;font-size:12px;cursor:pointer">${_cfg.label}</button>`
        }
        <a href="${escAttr(_catalogHref)}" target="_blank" class="full-btn" style="flex:1;text-align:center;padding:6px 10px;background:#fff;color:#1565c0;text-decoration:none;border:1px solid #90caf9;border-radius:4px;font-size:12px;font-weight:500">📋 Выбрать из каталога</a>
      </div>
      <div class="muted" style="font-size:10px;margin-top:4px">Конфигуратор — указать требования (мощность, cooling, redundancy) и получить рекомендацию. Каталог — выбрать конкретное изделие.</div>
    </div>`);

    // v0.59.99.2: индикатор привязки к каталогу. Если узел привязан
    // (n.catalogLocked=true), параметры, взятые из каталожной записи
    // (demandKw, cosPhi, kUse, inrushFactor, curveHint, breakerMarginPct),
    // становятся read-only и помечаются замком. Отвязать — кнопкой ниже.
    if (n.catalogLocked) {
      const _lockEntry = fullCatalog.find(c => c.id === n.consumerSubtype);
      const _lockLabel = _lockEntry ? _lockEntry.label : (n.consumerSubtype || '?');
      h.push(`<div style="margin-top:6px;padding:8px 10px;background:#fff3e0;border:1px solid #ffb74d;border-radius:4px;font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>🔒 Привязано к каталогу: <b>${escHtml(_lockLabel)}</b></span>
        <button type="button" id="cp-catalog-unlock" style="margin-left:auto;padding:3px 10px;background:#fff;color:#ef6c00;border:1px solid #ffb74d;border-radius:3px;cursor:pointer;font-size:11px">✎ Отвязать и редактировать</button>
      </div>
      <div class="muted" style="font-size:10px;margin-top:4px">Электрические параметры, зависящие от изделия (мощность, cos φ, Ки, пусковой, кривая, запас), защищены от случайного изменения. Отвяжите, чтобы редактировать вручную.</div>`);
    }
  }

  // Миграция: старые user-записи без category получают 'other'.
  // (fullCatalog объявлен выше — см. v0.59.371.)
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
  // v0.59.747: _loadSpec / _isTotalDisplay удалены — после ввода парных
  // полей (v0.59.738) и отказа от селектора loadSpec (v0.59.744) эти
  // переменные больше нигде не используются. n.loadSpec в данных
  // фиксируется как 'per-unit' в apply-handler.
  // v0.57.81: режим группы. 'uniform' — один demandKw на все приборы
  // (count × demandKw). 'individual' — массив items [{name, demandKw}]
  // с разными мощностями. Показывается только когда count > 1.
  const _groupMode = n.groupMode === 'individual' ? 'individual' : 'uniform';
  if (_cpCount > 1) {
    // v0.59.663: Юзер: «мощность индивидуальная может быть доступна только
    // если выбрана цепочка, когда один общий кабель, иначе разную мощность
    // использовать нельзя». Опция «Индивидуальная» в селекте отключается
    // через disabled когда не выбрано последовательное соединение
    // (n.serialMode === false). Сам checkbox «Последовательное соединение»
    // теперь всегда виден (раньше скрывался при individual).
    const _indivDisabled = !n.serialMode;
    // v0.59.746: «Тип группы» имеет смысл только при последовательном
    // соединении (без него «Индивидуальная» недоступна → uniform по умолчанию,
    // и сам селектор не нужен). Поэтому весь блок скрывается при
    // отключённом cp-serialMode (видимость переключается в hadler ниже).
    h.push(`<div class="field" id="cp-groupMode-wrap" style="${_indivDisabled ? 'display:none' : ''}">
      <label>Тип группы</label>
      <select id="cp-groupMode">
        <option value="uniform"${_groupMode === 'uniform' ? ' selected' : ''}>Единообразная (все приборы одинаковые)</option>
        <option value="individual"${_groupMode === 'individual' ? ' selected' : ''}${_indivDisabled ? ' disabled' : ''}>Индивидуальная (мощности разные)${_indivDisabled ? ' — только при цепочке' : ''}</option>
      </select>
      <div class="muted" id="cp-groupMode-hint" style="font-size:10px;margin-top:2px${_indivDisabled ? '' : ';display:none'}">Разные мощности возможны только при последовательном соединении (один общий кабель). Включите «Последовательное соединение» ниже, чтобы выбрать «Индивидуальная».</div>
    </div>`);
    h.push(`<div class="field check" id="cp-serialMode-wrap"><input type="checkbox" id="cp-serialMode"${n.serialMode ? ' checked' : ''}><label>Последовательное соединение (цепочка)</label></div>`);
    // v0.59.381: «Указание нагрузки» теперь доступно ВСЕГДА при count>1
    // (не только при последовательном) — пользователь может ввести
    // суммарную мощность группы и не пересчитывать единичную вручную.
    // v0.59.744: селектор «Указание нагрузки» (per-unit / total) удалён —
    // оба значения теперь видны в парных полях «Мощность каждого» +
    // «Мощность всей группы», переключатель потерял смысл (юзер сам
    // правит то поле, в категориях которого ему удобнее думать).
    // Скрытый input нужен только для обратной совместимости readForm
    // (n.loadSpec оставлен в схеме данных, но всегда 'per-unit').
    h.push(`<input type="hidden" id="cp-loadSpec" value="per-unit">`);
  }
  h.push(`</div>`); // /tp-panel general
  h.push(`<div class="tp-panel" data-panel="electrical"${_defaultTab !== 'electrical' ? ' hidden' : ''}>`);
  // v0.59.747: _displayDemand / _demandLabel больше не используются —
  // парные поля v0.59.738 рендерят свои собственные значения и метки.
  // (Раньше через них шёл переключатель loadSpec, теперь n.demandKw —
  // ВСЕГДА per-unit, group-итог считается × count в HTML.)
  // v0.59.99.2: флаг блокировки полей, зависящих от каталожного изделия.
  // Используется `disabled + title` на input, а для select — `disabled`
  // (readonly на select не работает). Отвязка — кнопкой на «Общее».
  const _lk = n.catalogLocked ? ' disabled title="Привязано к каталогу — отвяжите на вкладке Общее"' : '';
  const _lkIcon = n.catalogLocked ? ' 🔒' : '';
  // v0.59.91: общие параметры нужны раньше (в карточках членов group'а для
  // «унаследовать от родителя» и в основных селектах ниже).
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  const ph = n.phase || '3ph';
  // v0.59.684: ПЕРЕУПОРЯДОЧИВАНИЕ полей в модалке параметров потребителя.
  // Пользователь: «Уровень напряжения, Фазность, cos φ размести в самом
  // начале, так как эти значения общие, потом номинальная мощность, это
  // из паспорта и только потом расчетные значения».
  // Порядок:
  //   1. Уровень напряжения
  //   2. Фазность
  //   3. cos φ (общий параметр для расчёта)
  //   4. Установленная мощность (паспорт)
  //   5. Номинальный ток I (производное от мощности)
  //   6. Группа (если individual)
  //   7. Ки
  //   8. Множитель нагрузки
  //   9. Расчётная нагрузка (P × Ки × множитель)
  //  10. Кратность пуска
  //  11. Запас автомата + Кривая автомата
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(levels[i]))}</option>`;
  }
  // v0.59.685: подсказка вынесена в «?» иконку рядом с лейблом.
  h.push(`<div class="field">
    <label>Уровень напряжения${helpIcon('Класс напряжения для расчёта тока. Должен совпадать с классом источника. В будущем будет наследоваться от питающей линии (расчёт через падение напряжения).')}</label>
    <select id="cp-voltage">${vOpts}</select>
  </div>`);
  h.push(`<div class="field">
    <label>Фазность${helpIcon('3-фазный — нагрузка на 3 фазы (cos φ × √3 в формуле тока). 2-фазный — split-phase (две фазы + нейтраль). 1-фазный — фаза + нейтраль (vLN, без √3).')}</label>
    <select id="cp-phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>3-фазный</option>
      <option value="2ph"${ph === '2ph' ? ' selected' : ''}>2-фазный (split-phase)</option>
      <option value="1ph"${ph === '1ph' || ph === 'A' || ph === 'B' || ph === 'C' ? ' selected' : ''}>1-фазный</option>
    </select>
  </div>`);
  // v0.59.657: лейблы и подсказки полей зависят от выбранной методики.
  const _method = GLOBAL.calcMethod || 'iec';
  const _cosTerm = getTerm('powerFactor', _method);
  const _cosTip  = getTermTooltip('powerFactor', _method);
  h.push(`<div class="field">
    <label>${escHtml(_cosTerm.label)}${_lkIcon}${_cosTip ? helpIcon(_cosTip) : ''}</label>
    <input type="number" id="cp-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi ?? 0.92}"${_lk}>
  </div>`);
  // v0.59.704: рабочее напряжение на клеммах с учётом падения напряжения
  // от источника. Пользователь ранее: «нужно проверять допустимое напряжение
  // (пределы из справочника, например 100-280В) и ток фактический пересчитывать
  // исходя из падения напряжения». Шаг 1 — отображение фактического U
  // на клеммах с проверкой диапазона.
  // U_term = U_nominal × (1 - deltaUPct/100); deltaUPct накапливается в
  // recalc.js по всем участкам линии от источника.
  {
    // v0.59.747: для 1-фазного — берём vLN ИЗ определения уровня (level
    // объявляет и vLL и vLN явно: { vLL:400, vLN:230 }). Раньше код считал
    // vLL/√3 ≈ 231 для уровня 400/230, что давало рассинхронизацию с
    // recalc.js (там для 1-фазной линии c._voltage = vLN = 230 из level'а).
    // Получалось: consumer-modal показывал U_term=230.6 В (231 × (1-0.2%)),
    // а conn-инспектор — 229.6 В (230 × (1-0.19%)) для одной и той же
    // точки клемм. Юзер: «как напряжение на клеммах щита выше чем у
    // источника?» — это и был артефакт неправильного nominal для 1ф.
    const _isPh1 = (ph === '1ph' || ph === 'A' || ph === 'B' || ph === 'C');
    const _level = levels[curIdx];
    const _uNomPhase = _isPh1
      ? (Number(_level?.vLN) || Math.round((Number(_level?.vLL) || 0) / Math.sqrt(3)))
      : (Number(_level?.vLL) || 0);
    const _drop = Number(n._deltaUPct) || 0;
    const _uTerm = _uNomPhase * (1 - _drop / 100);
    // Допустимый диапазон: ±10% по ГОСТ 32144-2013 (норма качества
    // электроэнергии). Для расширенного диапазона ±15% — отдельная
    // категория электроприёмников.
    const _devPct = _uNomPhase > 0 ? (_uTerm - _uNomPhase) / _uNomPhase * 100 : 0;
    const _color = Math.abs(_devPct) <= 5 ? '#15803d'
      : Math.abs(_devPct) <= 10 ? '#ca8a04'
      : '#b91c1c';
    const _badge = Math.abs(_devPct) <= 5 ? '✓ норма (ГОСТ 32144)'
      : Math.abs(_devPct) <= 10 ? '⚠ на границе ±10%'
      : '⛔ вне ±10% (вне допустимых пределов)';
    const _uTermTip = 'Фактическое напряжение на клеммах потребителя с учётом накопленного падения напряжения по линии от источника. Считается как U_ном × (1 − ΔU%/100), где ΔU% — сумма падений на всех участках кабелей в цепи от источника до этого потребителя. Допустимый диапазон ±10% по ГОСТ 32144-2013 (нормально допустимое отклонение). Если выходит за ±10% — нагрузка может работать ненадёжно или с пониженным КПД, требуется увеличить сечение питающих кабелей или повысить уровень напряжения.';
    if (_uNomPhase > 0) {
      h.push(`<div class="field" style="padding:6px 10px;background:#f9fafb;border-left:3px solid ${_color};border-radius:3px">
        <label style="font-size:11px;color:#475569">⚡ Рабочее напряжение на клеммах${helpIcon(_uTermTip)}</label>
        <div style="font-size:13px;line-height:1.4">
          <b style="color:${_color}">${_uTerm.toFixed(1)} В</b>
          <span class="muted" style="font-size:11px">(${_devPct >= 0 ? '+' : ''}${_devPct.toFixed(1)}% от ${_uNomPhase} В)</span>
        </div>
        <div style="font-size:10.5px;color:${_color};margin-top:2px">${_badge}</div>
      </div>`);
    }
  }
  // ===== Установленная (номинальная) мощность — паспорт =====
  // v0.59.738: парные поля Мощность + Ток в одной строке (как в cable-calc /
  // panel-config). При количестве > 1 + uniform добавляется ВТОРАЯ строка
  // выше с групповыми значениями (группа = на единицу × count). Каждое из
  // 4 полей синхронизировано двунаправленно (см. _wireGroupSync ниже).
  // _displayDemand теперь ВСЕГДА per-unit — n.demandKw хранится per-unit
  // (см. save-логику ниже), а group-row показывает n.demandKw × count.
  const _isGroupUniform = (_cpCount > 1 && _groupMode === 'uniform');
  const _perUnitKw = Number(n.demandKw || 0);
  const _hideDemand = (_groupMode === 'individual' && _cpCount > 1);
  const _ipTip = `Связан с мощностью через U/cos φ/фазу: I = P × 1000 / (U × cos φ × √3 для 3ф). При изменении одного поля автоматически пересчитывается другое.`;
  const _gridStyle = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end';
  if (_isGroupUniform) {
    // Верхняя строка — на всю группу (P + I)
    h.push(`<div id="cp-demandGroup-wrap" class="field" style="${_gridStyle}">
      <div>
        <label>Мощность всей группы, kW${_lkIcon}${helpIcon('Суммарная мощность группы = «Мощность каждого» × «Количество». Редактирование пересчитывает «Мощность каждого» = группа / N.')}</label>
        <input type="number" id="cp-demandKwGroup" min="0" step="0.1" value="${_perUnitKw * _cpCount}"${_lk}>
      </div>
      <div>
        <label>Ток всей группы, А${_lkIcon}${helpIcon(_ipTip + ' Группа = ток одного × N (для параллельных потребителей).')}</label>
        <input type="number" id="cp-demandAGroup" min="0" step="0.1" value=""${_lk}>
      </div>
    </div>`);
  }
  // Нижняя строка — на единицу (P + I) — она же единственная при count=1
  const _perUnitLabel = _isGroupUniform ? 'Мощность каждого, kW' : 'Установленная мощность, kW';
  const _perUnitIlabel = _isGroupUniform ? 'Ток каждого, А' : 'Номинальный ток I, А';
  h.push(`<div id="cp-demandKw-wrap" class="field" style="${_hideDemand ? 'display:none' : _gridStyle}">
    <div>
      <label id="cp-demandKw-label">${_perUnitLabel}${_lkIcon}</label>
      <input type="number" id="cp-demandKw" min="0" step="0.1" value="${_perUnitKw}"${_lk}>
    </div>
    <div>
      <label id="cp-demandA-label">${_perUnitIlabel}${_lkIcon}${helpIcon(_ipTip)}</label>
      <input type="number" id="cp-demandA" min="0" step="0.1" value=""${_lk}>
    </div>
  </div>`);
  // v0.59.91: групповой потребитель (individual) = оболочка над N членами.
  // Каждый член = «обычный потребитель» со своими параметрами (не только
  // name+kW как было раньше). Раскладка — карточки, как секции многосекционного
  // щита. Кнопка «⚙ Параметры» раскрывает полный блок полей: напряжение,
  // фазность, cos φ, Ки, кратность пуска, запас и кривая автомата.
  // Общие фолбэки: если у члена поле не задано — берётся из родителя.
  const _items = Array.isArray(n.items) ? n.items : [];
  const _vOptsFor = (curIdx) => {
    let s = '';
    for (let i = 0; i < levels.length; i++) {
      s += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(levels[i]))}</option>`;
    }
    return s;
  };
  // Карточка одного прибора в группе. Параметры — как у обычного потребителя,
  // но свёрнуты в <details>; заголовок карточки — имя + сводка kW.
  const _itemCardHtml = (it, idx) => {
    const kwVal = Number(it.demandKw) || 0;
    const vIdx = Number.isFinite(+it.voltageLevelIdx) ? Number(it.voltageLevelIdx) : curIdx;
    const phV  = it.phase || ph;
    const cos  = it.cosPhi != null && it.cosPhi !== '' ? Number(it.cosPhi) : Number(n.cosPhi ?? 0.92);
    const ku   = it.kUse   != null && it.kUse   !== '' ? Number(it.kUse)   : Number(n.kUse ?? 1);
    const inr  = it.inrushFactor != null && it.inrushFactor !== '' ? Number(it.inrushFactor) : Number(n.inrushFactor ?? 1);
    const curveVal = it.curveHint || '';
    const bmVal = (typeof it.breakerMarginPct === 'number') ? String(it.breakerMarginPct) : '';
    return `
    <div class="cp-it-card" data-idx="${idx}" style="border:1px solid #d7dde5;border-radius:4px;background:#fafbfc;margin-bottom:6px;padding:6px 8px;">
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-weight:600;color:#37474f;font-size:11px;min-width:18px;text-align:right">${idx + 1}.</span>
        <input type="text" class="cp-it-name" value="${escAttr(it.name || '')}" placeholder="Прибор ${idx + 1}" style="flex:1;font-size:11px;padding:3px 6px">
        <input type="number" class="cp-it-kw" min="0" step="0.1" value="${kwVal}" title="kW" style="width:68px;font-size:11px;padding:3px 6px;text-align:right">
        <span class="muted" style="font-size:11px">kW</span>
        <button type="button" class="cp-it-gear" title="Показать/скрыть расширенные параметры" style="background:none;border:1px solid #cfd6df;color:#455a64;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:11px">⚙</button>
        <button type="button" class="cp-it-del" title="Удалить из группы" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:13px">✕</button>
      </div>
      <div class="cp-it-params" hidden style="margin-top:6px;padding-top:6px;border-top:1px dashed #d7dde5;display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-size:11px">
        <label>Напряжение<br><select class="cp-it-voltage" style="width:100%;font-size:11px;padding:2px 4px">${_vOptsFor(vIdx)}</select></label>
        <label>Фазность<br><select class="cp-it-phase" style="width:100%;font-size:11px;padding:2px 4px">
          <option value="3ph"${phV==='3ph'?' selected':''}>3-фазный</option>
          <option value="2ph"${phV==='2ph'?' selected':''}>2-фазный</option>
          <option value="1ph"${phV==='1ph'||phV==='A'||phV==='B'||phV==='C'?' selected':''}>1-фазный</option>
        </select></label>
        <label>cos φ<br><input type="number" class="cp-it-cos" min="0.1" max="1" step="0.01" value="${cos}" style="width:100%;font-size:11px;padding:2px 4px"></label>
        <label>Ки<br><input type="number" class="cp-it-ku" min="0" max="1" step="0.05" value="${ku}" style="width:100%;font-size:11px;padding:2px 4px"></label>
        <label>Крат. пуска<br><input type="number" class="cp-it-inr" min="1" max="10" step="0.1" value="${inr}" style="width:100%;font-size:11px;padding:2px 4px"></label>
        <label>Запас автомата, %<br><input type="number" class="cp-it-bm" min="0" max="100" step="5" value="${bmVal}" placeholder="авто" style="width:100%;font-size:11px;padding:2px 4px"></label>
        <label style="grid-column:1/-1">Кривая автомата<br><select class="cp-it-curve" style="width:100%;font-size:11px;padding:2px 4px">
          <option value=""${curveVal===''?' selected':''}>авто (от родителя)</option>
          <option value="MCB_B"${curveVal==='MCB_B'?' selected':''}>MCB B — резистивная</option>
          <option value="MCB_C"${curveVal==='MCB_C'?' selected':''}>MCB C — общее назначение</option>
          <option value="MCB_D"${curveVal==='MCB_D'?' selected':''}>MCB D — двигатели</option>
        </select></label>
      </div>
    </div>`;
  };
  // v0.59.757: items-wrap перенесён в новую вкладку «Группа» (см. конец
  // функции). Здесь ничего не выводим — переход через табы.
  // ROADMAP 1.28.12.

  // v0.59.684: блоки «Уровень напряжения / Фазность / cos φ» подняты
  // выше (см. ранний h.push в начале функции). Здесь — только Ки и
  // множитель (расчётные значения).
  // v0.59.685: подсказки и справка показываются только в всплывающем
  // окне на знаке вопроса «?» рядом с лейблом (см. helpIcon в utils.js).
  // Пользователь: «подсказки и справку показывай только в всплывающем
  // окне над параметром или над знаком вопроса в кружке после названия
  // параметра».
  if (isTermUsed('utilization', _method)) {
    const _kuTerm = getTerm('utilization', _method);
    const _kuTip  = getTermTooltip('utilization', _method);
    h.push(`<div class="field">
      <label>${escHtml(_kuTerm.label)}${_lkIcon}${_kuTip ? helpIcon(_kuTip) : ''}</label>
      <input type="number" id="cp-kUse" min="0" max="1" step="0.05" value="${n.kUse ?? 1}"${_lk}>
    </div>`);
  } else {
    h.push(`<input type="hidden" id="cp-kUse" value="${n.kUse ?? 1}">`);
  }
  // Множитель нагрузки в текущем сценарии (нормальный или аварийный режим).
  if (state.activeModeId) {
    const curMode = (state.modes || []).find(m => m.id === state.activeModeId);
    const lf = (curMode?.overrides?.[n.id]?.loadFactor);
    const lfVal = typeof lf === 'number' ? lf : 1;
    const _lfTip = `Множитель нагрузки в текущем сценарии «${curMode?.name || ''}». 1.0 = номинал, 0.5 = 50%, 0 = выключено. Не влияет на другие режимы.`;
    h.push(`<div class="field">
      <label>Множитель нагрузки (0–3)${helpIcon(_lfTip)}</label>
      <input type="number" id="cp-loadFactor" min="0" max="3" step="0.1" value="${lfVal}">
    </div>`);
  } else {
    const nlf = typeof n.normalLoadFactor === 'number' ? n.normalLoadFactor : 1;
    const _lfTip = 'Множитель нагрузки. 1.0 = номинал, 0.5 = 50%, 0 = выключено.';
    h.push(`<div class="field">
      <label>Множитель нагрузки (0–3)${helpIcon(_lfTip)}</label>
      <input type="number" id="cp-normalLoadFactor" min="0" max="3" step="0.1" value="${nlf}">
    </div>`);
  }
  // v0.59.652: Расчётная мощность и ток — двунаправленный пересчёт через Ки.
  // P_расч = P_ном × N × Ки × множитель_нагрузки
  // Ки = P_расч / (P_ном × N × множитель_нагрузки)
  // I_расч = computeCurrentA(P_расч, U, cos φ, фаза)
  // Юзер: «автоматический пересчёт расчётной мощности из коэффициентов
  // или коэффициентов из известной расчётной мощности».
  // v0.59.656: формула в заголовке развёрнута до «P_ном × N × Ки × множитель»,
  // чтобы юзеру было видно связь расчётных значений с номинальными через
  // коэффициенты. Юзер: «почему расчётные значения не связаны с номинальными
  // через коэффициенты». — связь явная: P_расч = P_ном × N × Ки × LF.
  // v0.59.663: Юзер: «расчётная мощность указывается для одного потребителя
  // и справочно выводится для группы, только если не используется указание
  // мощности или тока всех нагрузок одним числом». То есть:
  //   - Если loadSpec='per-unit' (на каждый элемент) — расчётная P_calc / I_calc
  //     показываются НА 1 ЕД., группа выводится справочно ниже.
  //   - Если loadSpec='total' (на всю группу) — расчётная сразу для группы
  //     (юзер ввёл сумму), справочный per-unit не нужен.
  //   - Для single-consumer (count=1) — без изменений (всё одна штука).
  // Заголовок и хинт переписаны соответственно.
  // v0.59.738: cp-demandKw (Pnom) теперь ВСЕГДА per-unit, поэтому Pcalc
  // тоже всегда per-unit; справочный группа-итог P_calc_group выводится
  // ниже. Заголовок «(на 1 ед.)» при count>1.
  const _calcPerUnit = (_cpCount > 1);
  const _calcHeader = (_cpCount > 1)
    ? 'P_ном × Ки × множитель (на 1 ед.)'
    : 'P_ном × Ки × множитель';
  // v0.59.685: подсказки расчётной нагрузки вынесены в «?» иконку.
  const _calcMainTip = `Расчётная нагрузка = P_ном × Ки × множитель сценария. I_расч = P_расч × 1000 / (U × cos φ × √3 для 3ф). При изменении расчётной P или I — пересчитается Ки. При изменении Ки / множителя / P_ном — пересчитается расчётная. Ограничение: Pрасч / Iрасч клампятся до P_ном × множитель (т.е. Ки ≤ 1) — выше номинального ввести нельзя.${_calcPerUnit ? ' Для группы суммарная Pрасч и Iрасч показываются справочно ниже.' : ''}`;
  // v0.59.753: парные ряды Pрасч + Iрасч в режиме группы — симметрично с
  // номинальной парой v0.59.738. Юзер: «для расчётной нагрузки сделай так
  // же как и для номинальной, мощность группы и мощность одного».
  //   count > 1 + uniform → ДВА ряда (группа + единица), 4 поля синх.
  //   count === 1 / individual → ОДИН ряд (P + I per-unit).
  const _calcGridStyle = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end';
  const _calcGroupRow = _calcPerUnit
    ? `<div class="field" id="cp-calcGroup-wrap" style="margin-bottom:4px;${_calcGridStyle}">
        <div>
          <label style="font-size:11px">Расчётная мощность всей группы, кВт</label>
          <input type="number" id="cp-calcKwGroup" min="0" step="0.1" value="">
        </div>
        <div>
          <label style="font-size:11px">Расчётный ток всей группы, А</label>
          <input type="number" id="cp-calcAGroup" min="0" step="0.1" value="">
        </div>
      </div>`
    : '';
  const _calcUnitLabelP = _calcPerUnit ? 'Расчётная мощность каждого, кВт' : 'Расчётная мощность P, кВт';
  const _calcUnitLabelI = _calcPerUnit ? 'Расчётный ток каждого, А' : 'Расчётный ток I, А';
  h.push(`<div style="margin-top:6px;padding:8px 10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px">
    <div class="muted" style="font-size:10px;margin-bottom:4px;font-weight:600;color:#0369a1">📊 Расчётная нагрузка = ${_calcHeader}${helpIcon(_calcMainTip)}</div>
    ${_calcGroupRow}
    <div class="field" style="margin-bottom:0;${_calcGridStyle}">
      <div>
        <label style="font-size:11px">${_calcUnitLabelP}</label>
        <input type="number" id="cp-calcKw" min="0" step="0.1" value="">
      </div>
      <div>
        <label style="font-size:11px">${_calcUnitLabelI}</label>
        <input type="number" id="cp-calcA" min="0" step="0.1" value="">
      </div>
    </div>
  </div>`);
  // v0.59.657: methodology-aware inrush label с «?» иконкой подсказки.
  if (isTermUsed('inrush', _method)) {
    const _inTerm = getTerm('inrush', _method);
    const _inTip  = getTermTooltip('inrush', _method);
    h.push(`<div class="field">
      <label>${escHtml(_inTerm.label)}${_lkIcon}${_inTip ? helpIcon(_inTip) : ''}</label>
      <input type="number" id="cp-inrush" min="1" max="10" step="0.1" value="${n.inrushFactor ?? 1}"${_lk}>
    </div>`);
  } else {
    h.push(`<input type="hidden" id="cp-inrush" value="${n.inrushFactor ?? 1}">`);
  }

  // Запас по автомату — override категории/авто. Пустое поле = авто по inrush.
  {
    const mv = (typeof n.breakerMarginPct === 'number') ? String(n.breakerMarginPct) : '';
    h.push(`<div class="field">
      <label>Запас по автомату, %${_lkIcon}${helpIcon('Пусто = авто по кратности пуска (лёгкий 20%, средний 35%, тяжёлый 50%). Используется для подбора номинала автомата защиты линии.')}</label>
      <input type="number" id="cp-brkMargin" min="0" max="100" step="5" value="${mv}" placeholder="авто"${_lk}>
    </div>`);
  }
  // Кривая/тип автомата — подсказка для авто-подбора
  {
    const cv = n.curveHint || '';
    h.push(`<div class="field">
      <label>Кривая автомата (подсказка)${_lkIcon}${helpIcon('Актуально для In ≤ 125 А. Выше — автоматически MCCB/ACB. Кривая B — резистивная (освещение), C — общее назначение, D — двигатели/трансформаторы.')}</label>
      <select id="cp-curveHint"${_lk}>
        <option value=""${cv===''?' selected':''}>авто (по inrush и In)</option>
        <option value="MCB_B"${cv==='MCB_B'?' selected':''}>MCB кр. B — резистивная, освещение</option>
        <option value="MCB_C"${cv==='MCB_C'?' selected':''}>MCB кр. C — общее назначение</option>
        <option value="MCB_D"${cv==='MCB_D'?' selected':''}>MCB кр. D — двигатели, трансформаторы</option>
      </select>
    </div>`);
  }
  // v0.59.621: Тип пуска и K_рез (CRF). Влияет ТОЛЬКО при питании от ИБП.
  // На обычной сети без ИБП — безразлично.
  // v0.59.622: «Пользовательский» в списке → показывает поле ввода K.
  // v0.59.623: расчёт всегда активен (чекбокс на ИБП убран).
  {
    const curStarter = n.starterType || '';
    const opts = [
      `<option value=""${curStarter===''?' selected':''}>авто (по подтипу/политике ИБП)</option>`,
      ...STARTER_TYPES.map(t => {
        const lbl = t.crf != null ? `${t.label} — K=${t.crf.toFixed(2)}` : t.label;
        return `<option value="${escAttr(t.id)}"${curStarter===t.id?' selected':''}>${escHtml(lbl)}</option>`;
      }),
    ].join('');
    h.push(field('Тип пуска (для ИБП)' + _lkIcon, `<select id="cp-starterType"${_lk}>${opts}</select>`));
    const ovVal = (typeof n.crfOverride === 'number' && Number.isFinite(n.crfOverride)) ? String(n.crfOverride) : '';
    const isCustom = curStarter === 'custom';
    const customStyle = isCustom ? '' : 'display:none';
    // v0.59.701: helpIcon для K_рез — справочный текст в tooltip.
    h.push(`<div id="cp-crfOverride-wrap" class="field" style="${customStyle}">
      <label style="text-transform:uppercase;font-size:11px;color:#666">Свой K_рез (0.30–1.00)${_lkIcon}${helpIcon('K_рез — доля номинала ИБП, реально требуемая нагрузке. Приоритет: «Пользовательский» (свой K) > выбранный тип пуска > default по подтипу из каталога > 1.00. На обычной сети (без ИБП) — параметр игнорируется. Применяется только в схемах с ИБП для оценки фактической загрузки инвертора.')}</label>
      <input type="number" id="cp-crfOverride" min="0.30" max="1.00" step="0.01" value="${ovVal}" placeholder="например 0.85"${_lk}>
    </div>`);
  }
  h.push(`<div class="field">
    <label>Входов${helpIcon('Количество вводов питания у этого потребителя. 1 — обычное одиночное подключение. 2 — две независимые линии (например, СКС-стойка с двойным вводом A/B для резервирования). При 2 портах в схеме — оба должны быть подключены к разным фидерам.')}</label>
    <input type="number" id="cp-inputs" min="1" max="2" step="1" value="${Math.min(n.inputs || 1, 2)}">
  </div>`);
  // Наличие нейтрали (N) и защитного проводника (PE) у этого
  // потребителя. Если флаги не заданы (undefined) — берутся дефолты
  // по системе заземления питающего щита или GLOBAL.earthingSystem.
  // Фазность определяется уровнем напряжения.
  {
    const hasN = (typeof n.hasNeutral === 'boolean') ? n.hasNeutral : null;
    const hasG = (typeof n.hasGround  === 'boolean') ? n.hasGround  : null;
    const triState = (val) => val === null ? 'auto' : (val ? 'on' : 'off');
    h.push(`<div class="field"><label style="text-transform:uppercase;font-size:11px;color:#666">Жилы кабеля${helpIcon('Наличие нейтрали (N) и защитного проводника (PE) у потребителя. «Авто» — определяется по системе заземления питающего щита (TN-S → 5 жил, TN-C → 4 жилы и т.д.). «Есть/Нет» — ручное переопределение для нестандартных подключений (например, симметричная 3ф нагрузка без N: 4 жилы вместо 5).')}</label>`);
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
  h.push('</div>'); // /panel electrical

  // v0.59.757: панель «Группа» — отдельная вкладка для группового потребителя
  // (count > 1). Содержимое:
  //   - individual mode: items-list (cp-items-wrap) с per-item параметрами;
  //   - uniform mode: список связанных POR-инстансов (placeholder для 1.28.10);
  //   - кнопка «✂ Исключить экземпляр» (placeholder для 1.28.13).
  // ROADMAP 1.28.12.
  if (_isGroupTabVisible) {
    const _itemsCardsHtml = _items.map((it, idx) => _itemCardHtml(it, idx)).join('');
    h.push(`<div class="tp-panel" data-panel="group"${_defaultTab !== 'group' ? ' hidden' : ''}>`);
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px;padding:6px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;color:#0369a1">
      Групповой потребитель ×${_cpCount}. ${_groupMode === 'individual'
        ? 'Каждый прибор имеет собственные параметры (мощность, фаза, cos φ); пустые поля = унаследовать от группы.'
        : 'Все приборы одинаковые (uniform). Чтобы задать индивидуальные параметры — включите чекбокс «Последовательное соединение» на вкладке «Общее» и выберите тип группы «Индивидуальная».'}
    </div>`);
    if (_groupMode === 'individual') {
      h.push(`<div id="cp-items-wrap" class="field">
        <label>Приборы в группе <span class="muted" style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0">— каждый с собственными параметрами; пусто = унаследовать от группы</span></label>
        <div id="cp-items-body">${_itemsCardsHtml}</div>
        <div style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:4px">
          <button type="button" id="cp-it-add" style="padding:3px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer">➕ Добавить прибор</button>
          <span id="cp-items-sum" class="muted"></span>
        </div>
      </div>`);
    } else {
      // uniform mode. Реализован picker для 1.28.10 (link existing) v0.59.761;
      // 1.28.13 (split-out) пока placeholder.
      h.push(`<div id="cp-items-wrap" class="field" style="display:none"><div id="cp-items-body"></div><span id="cp-items-sum" class="muted"></span></div>`);
      // v0.59.761: picker одиночных потребителей для связи с группой
      // (ROADMAP 1.28.10). v0.59.762 расширение: включаем НЕ ТОЛЬКО размещённых
      // на текущей странице, но и unplaced (POR-объекты от технолога без
      // engine-узла или с pageIds=[]) + потребителей с неуказанной мощностью
      // (kw=0). Юзер: «должны попадать не только размещенные потребители но
      // и не размещенные, включая потребители с неуказанными параметрами
      // мощности».
      // Уровни совместимости (для UI-сортировки и пометки):
      //   exact   — все параметры совпадают (subtype/phase/voltage/cosPhi/kw)
      //   partial — kw отличается > 5% или не задан, остальное совпадает
      //   loose   — больше расхождений (subtype или phase отличается)
      const _grpSubtype = (n.consumerSubtype || '');
      const _grpPhase = n.phase || '3ph';
      const _grpV = Number(n.voltageLevelIdx);
      const _grpCos = Number(n.cosPhi) || 0.92;
      const _grpKw = Number(n.demandKw) || 0;
      const _candidates = [];
      const _curPageId = state.currentPageId;
      for (const m of state.nodes.values()) {
        if (m.id === n.id) continue;
        if (m.type !== 'consumer') continue;
        if ((Number(m.count) || 1) !== 1) continue;
        if (m.groupMode === 'individual') continue;
        // Categorize match level
        const mSubtype = m.consumerSubtype || '';
        const mPhase = m.phase || '3ph';
        const mV = Number(m.voltageLevelIdx);
        const mCos = Number(m.cosPhi) || 0.92;
        const mKw = Number(m.demandKw) || 0;
        const mPids = Array.isArray(m.pageIds) ? m.pageIds : [];
        const isUnplaced = !mPids.includes(_curPageId) && mPids.length === 0;
        const isOnOtherPage = !mPids.includes(_curPageId) && mPids.length > 0;
        // Hard exclusions: явное несоответствие subtype или phase делает
        // связь бессмысленной (это разные нагрузки), но мы их ВСЁ ЕЩЁ показываем
        // в категории «loose» с warning — пусть юзер сам решит.
        const subtypeMatch = mSubtype === _grpSubtype;
        const phaseMatch = mPhase === _grpPhase;
        const voltMatch = !Number.isFinite(_grpV) || !Number.isFinite(mV) || _grpV === mV;
        const cosMatch = Math.abs(mCos - _grpCos) <= 0.05;
        const kwExact = mKw > 0 && _grpKw > 0 && Math.abs(mKw - _grpKw) / Math.max(mKw, _grpKw) <= 0.05;
        const kwUnknown = mKw <= 0 || _grpKw <= 0;
        let matchLevel;
        if (subtypeMatch && phaseMatch && voltMatch && cosMatch && kwExact) matchLevel = 'exact';
        else if (subtypeMatch && phaseMatch && voltMatch && (cosMatch || kwUnknown)) matchLevel = 'partial';
        else matchLevel = 'loose';
        const placement = isUnplaced ? 'unplaced' : (isOnOtherPage ? 'other-page' : 'placed');
        _candidates.push({ node: m, matchLevel, placement, mKw });
      }
      // Sort: exact placed → exact unplaced → partial placed → partial unplaced → loose
      const _matchRank = { exact: 0, partial: 1, loose: 2 };
      const _placeRank = { placed: 0, unplaced: 1, 'other-page': 2 };
      _candidates.sort((a, b) => (_matchRank[a.matchLevel] - _matchRank[b.matchLevel]) || (_placeRank[a.placement] - _placeRank[b.placement]));
      if (_candidates.length > 0) {
        const _badge = (cand) => {
          const parts = [];
          if (cand.placement === 'unplaced') parts.push('<span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:2px;font-size:9.5px">🧪 не размещён</span>');
          else if (cand.placement === 'other-page') parts.push('<span style="background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:2px;font-size:9.5px">📄 на другой стр.</span>');
          if (cand.matchLevel === 'partial') parts.push('<span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:2px;font-size:9.5px" title="Параметры частично отличаются от группы">⚠ частично</span>');
          else if (cand.matchLevel === 'loose') parts.push('<span style="background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:2px;font-size:9.5px" title="Существенное расхождение параметров">⛔ разные</span>');
          return parts.join(' ');
        };
        h.push(`<div class="field" style="margin-top:8px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px">
          <label style="font-size:11px;font-weight:600;color:#15803d;margin-bottom:6px;display:block">🔗 Связать с существующими ${_grpSubtype === 'rack' ? 'стойками' : 'потребителями'} (${_candidates.length})</label>
          <div class="muted" style="font-size:10.5px;margin-bottom:6px;color:#166534;line-height:1.4">
            Список включает <b>размещённые</b>, <b>не размещённые</b> и <b>с других страниц</b>. Параметры группы: ${_grpKw > 0 ? _grpKw + ' кВт, ' : ''}${_grpPhase}, cos φ ${_grpCos.toFixed(2)}, subtype «${_grpSubtype || '—'}». Отметьте кандидатов и нажмите «Объединить».
          </div>
          <div id="cp-link-candidates" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto;font-size:11.5px">
            ${_candidates.map(c => `<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:#fff;border:1px solid #d4d4d4;border-radius:3px;cursor:pointer">
              <input type="checkbox" class="cp-link-cb" data-link-id="${escAttr(c.node.id)}">
              <span style="font-weight:600">${escHtml(c.node.tag || c.node.id)}</span>
              <span class="muted">${escHtml(c.node.name || '')}</span>
              ${_badge(c)}
              <span class="muted" style="margin-left:auto;font-size:10px">${c.mKw > 0 ? c.mKw.toFixed(2) + ' кВт' : '— кВт'}</span>
            </label>`).join('')}
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button type="button" id="cp-link-apply" style="padding:4px 12px;border:1px solid #15803d;background:#15803d;color:#fff;border-radius:3px;cursor:pointer;font-size:11px">🔗 Объединить отмеченные</button>
            <button type="button" id="cp-link-all" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px" title="Выделить только exact-совпадения">✓ Точные</button>
            <button type="button" id="cp-link-all-with-warn" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px" title="Выделить все включая частичные/разные">▣ Все</button>
            <span id="cp-link-status" class="muted" style="font-size:10.5px"></span>
          </div>
        </div>`);
      } else {
        h.push(`<div class="muted" style="font-size:11px;margin-top:8px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;color:#6b7280">
          🔗 В проекте нет одиночных ${_grpSubtype === 'rack' ? 'стоек' : 'потребителей'} для связи. Создайте новый узел через палитру или добавьте импортом.
        </div>`);
      }
      h.push(`<div class="muted" style="font-size:11px;margin-top:6px;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;color:#92400e">
        ✂ <b>Исключение экземпляра</b> — в разработке (ROADMAP 1.28.13).
      </div>`);
    }
    h.push(`</div>`); // /panel group
  }

  // Панель «Габариты (мм)» — Phase 2.3. Читается getNodeGeometryMm в рендере.
  // Пустые поля = брать из библиотеки / из каталога. Здесь только override.
  const gm = n.geometryMm || {};
  const plc = (k) => {
    // Плейсхолдер — чтобы показать что вставится если оставить пусто.
    const cat = (fullCatalog.find(c => c.id === (n.consumerSubtype || ''))) || null;
    if (cat && cat[k] != null && cat[k] > 0) return String(Math.round(cat[k]));
    return '';
  };
  h.push(`<div class="tp-panel" data-panel="geometry" hidden>
    <div class="muted" style="font-size:11px;margin-bottom:8px">
      Физические габариты элемента (в миллиметрах). Используются на странице «Схема расположения» (layout) — узел рисуется пунктиром реального размера. Пустые поля = брать значение из каталога.
    </div>
    <div class="field"><label>Ширина, мм</label>
      <input type="number" id="cp-widthMm" min="0" step="10" value="${escAttr(gm.widthMm || '')}" placeholder="${plc('widthMm')}">
    </div>
    <div class="field"><label>Высота, мм</label>
      <input type="number" id="cp-heightMm" min="0" step="10" value="${escAttr(gm.heightMm || '')}" placeholder="${plc('heightMm')}">
    </div>
    <div class="field"><label>Глубина, мм</label>
      <input type="number" id="cp-depthMm" min="0" step="10" value="${escAttr(gm.depthMm || '')}" placeholder="${plc('depthMm')}">
    </div>
    <div class="field"><label>Вес, кг</label>
      <input type="number" id="cp-weightKg" min="0" step="0.1" value="${escAttr(gm.weightKg || '')}" placeholder="${plc('weightKg')}">
    </div>
    <div class="muted" style="font-size:11px;margin-top:8px">
      Источник по умолчанию: каталог элемента (если есть запись). Переопределение здесь перекрывает каталог только для этого узла.
    </div>
  </div>`);

  body.innerHTML = h.join('');

  // Переключение вкладок
  const tabsEl = body.querySelector('.tp-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll('.tp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabsEl.querySelectorAll('.tp-tab').forEach(b => b.classList.toggle('active', b === btn));
        body.querySelectorAll('.tp-panel').forEach(p => {
          p.hidden = p.dataset.panel !== target;
        });
      });
    });
  }

  // v0.59.99: stub-кнопка «задать требования» — простой prompt с подсказкой
  // и редирект в каталог с предзаполненными параметрами. Полноценный
  // wizard-конфигуратор для consumer будет в следующей итерации.
  const cfgStub = document.getElementById('cp-cfg-stub');
  if (cfgStub) {
    cfgStub.addEventListener('click', async () => {
      const kw = await rsPrompt('Требуемая мощность, кВт (и при желании — доп. требование, напр. "60, net sensible 45"):',
        String(Number(n.demandKw) || ''));
      if (!kw) return;
      const parts = kw.split(',').map(s => s.trim()).filter(Boolean);
      const qp = new URLSearchParams();
      qp.set('filterKind', 'consumer');
      if (n.consumerSubtype) qp.set('filterSubtype', n.consumerSubtype);
      if (parts[0]) qp.set('reqKw', parts[0]);
      if (parts[1]) qp.set('reqNote', parts[1]);
      qp.set('nodeId', n.id);
      qp.set('mode', 'configure');
      window.open('catalog/?' + qp.toString(), '_blank');
      flash('Каталог открыт в новой вкладке — отфильтруйте и выберите изделие.');
    });
  }

  const saveBtn = document.getElementById('cp-save-catalog');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const label = await rsPrompt('Название типа потребителя:');
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

  // v0.59.381: смена категории — ТОЛЬКО фильтр списка типов. Не трогаем
  // n.consumerSubtype до Apply, не дёргаем cp-catalog change. Категория
  // помогает найти нужный тип, но не привязывает параметры.
  const categorySelect = document.getElementById('cp-category');
  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      const newCat = categorySelect.value;
      const typesInCat = fullCatalog.filter(c => c.category === newCat);
      const typeSel = document.getElementById('cp-catalog');
      if (!typeSel) return;
      // Выбираем первый тип из новой категории как «значение по умолчанию»
      // в select'е, но НЕ применяем параметры из каталожной записи и НЕ
      // помечаем catalogLocked. Записывается на Apply через n.consumerSubtype.
      typeSel.innerHTML = typesInCat.map(c =>
        `<option value="${c.id}">${escHtml(c.label)}</option>`
      ).join('');
      if (typesInCat[0]) typeSel.value = typesInCat[0].id;
    });
  }

  // v0.59.381: смена типа потребителя — БЕЗ авто-привязки к каталогу.
  // Это просто метаданные узла (consumerSubtype), которые показывают/скрывают
  // секции (например, «Наружный блок» для conditioner). Привязка параметров
  // из каталожной записи теперь только через явную кнопку
  // «📋 Выбрать из каталога» на вкладке «Общее».
  // Раньше change-handler писал demandKw/cosPhi/kUse/inrushFactor/curveHint
  // и ставил catalogLocked=true → пользовательские значения молча терялись.

  // v0.59.99.2: кнопка «Отвязать» — снять catalogLocked, разрешить правки
  const unlockBtn = document.getElementById('cp-catalog-unlock');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      snapshot('catalog-unlock:' + n.id);
      n.catalogLocked = false;
      notifyChange();
      openConsumerParamsModal(n);
      flash('Привязка к каталогу снята — поля открыты для редактирования.');
    });
  }

  // v0.57.81: Live-управление режимом группы (uniform ↔ individual)
  const groupModeSel = document.getElementById('cp-groupMode');
  const itemsWrap = document.getElementById('cp-items-wrap');
  const itemsBody = document.getElementById('cp-items-body');
  const itemsSum = document.getElementById('cp-items-sum');
  const demandWrap = document.getElementById('cp-demandKw-wrap');
  const serialWrap = document.getElementById('cp-serialMode-wrap');
  const itAddBtn = document.getElementById('cp-it-add');
  // v0.59.91: карточки вместо строк таблицы. Каждая карточка — потенциально
  // полный потребитель со своими параметрами (⚙ раскрывает блок).
  const refreshItemsSum = () => {
    if (!itemsBody || !itemsSum) return;
    let s = 0, cnt = 0;
    itemsBody.querySelectorAll('.cp-it-card').forEach(card => {
      const kw = Number(card.querySelector('.cp-it-kw')?.value) || 0;
      s += kw; cnt++;
    });
    itemsSum.textContent = cnt ? `Σ ${s.toFixed(2).replace(/\.00$/, '')} kW · ${cnt} шт.` : '—';
  };
  const _wireCard = (card) => {
    card.querySelector('.cp-it-kw')?.addEventListener('input', refreshItemsSum);
    card.querySelector('.cp-it-del')?.addEventListener('click', () => { card.remove(); refreshItemsSum(); });
    const gear = card.querySelector('.cp-it-gear');
    const params = card.querySelector('.cp-it-params');
    if (gear && params) {
      gear.addEventListener('click', () => {
        params.hidden = !params.hidden;
        gear.style.background = params.hidden ? 'none' : '#e3f2fd';
      });
    }
  };
  const addItemRow = (name = '', kw = 0) => {
    if (!itemsBody) return;
    const idx = itemsBody.children.length;
    const wrap = document.createElement('div');
    wrap.innerHTML = _itemCardHtml({ name, demandKw: kw }, idx);
    const card = wrap.firstElementChild;
    itemsBody.appendChild(card);
    _wireCard(card);
    refreshItemsSum();
  };
  // v0.59.761: handlers для picker «🔗 Связать с существующими» (ROADMAP 1.28.10).
  // Объединяет выбранные одиночные consumer-узлы в текущую группу: count += 1
  // на каждого, узел и его связи удаляются.
  {
    const linkApplyBtn = document.getElementById('cp-link-apply');
    const linkAllBtn = document.getElementById('cp-link-all');
    const linkAllWarnBtn = document.getElementById('cp-link-all-with-warn');
    const linkStatus = document.getElementById('cp-link-status');
    // v0.59.762: «Точные» — только exact-совпадения (без warning-бейджей).
    if (linkAllBtn) {
      linkAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.cp-link-cb').forEach(cb => {
          const labelEl = cb.closest('label');
          const hasWarn = !!labelEl?.querySelector('span[title]');
          cb.checked = !hasWarn;
        });
      });
    }
    if (linkAllWarnBtn) {
      linkAllWarnBtn.addEventListener('click', () => {
        document.querySelectorAll('.cp-link-cb').forEach(cb => { cb.checked = true; });
      });
    }
    if (linkApplyBtn) {
      linkApplyBtn.addEventListener('click', () => {
        const checked = [...document.querySelectorAll('.cp-link-cb:checked')];
        if (!checked.length) {
          if (linkStatus) linkStatus.textContent = 'Не выбрано ни одного потребителя.';
          return;
        }
        const ids = checked.map(cb => cb.dataset.linkId).filter(Boolean);
        try { snapshot('group-link:' + n.id + '←' + ids.join(',')); } catch {}
        let merged = 0;
        for (const id of ids) {
          const src = state.nodes.get(id);
          if (!src) continue;
          // увеличиваем count группы и удаляем источник со связями
          n.count = (Number(n.count) || 1) + (Number(src.count) || 1);
          // снести входящие/исходящие связи источника
          const connsToDel = [];
          for (const c of state.conns.values()) {
            if (c.from?.nodeId === src.id || c.to?.nodeId === src.id) connsToDel.push(c.id);
          }
          for (const cid of connsToDel) state.conns.delete(cid);
          state.nodes.delete(src.id);
          merged++;
        }
        if (merged > 0) {
          try { flash(`Объединено ${merged} ${merged === 1 ? 'потребитель' : 'потребителя/-ей'} в группу ${n.tag || n.id} (×${n.count})`, 'success'); } catch {}
          notifyChange();
          // Перерисовать модалку с обновлённым списком
          openConsumerParamsModal(n);
        }
      });
    }
  }

  // Навесить обработчики на уже отрисованные карточки
  if (itemsBody) {
    itemsBody.querySelectorAll('.cp-it-card').forEach(_wireCard);
    refreshItemsSum();
  }
  if (itAddBtn) itAddBtn.addEventListener('click', () => addItemRow('', 0));
  if (groupModeSel) {
    groupModeSel.addEventListener('change', () => {
      const mode = groupModeSel.value;
      const cnt = Math.max(1, Number(document.getElementById('cp-count')?.value) || 1);
      const indiv = mode === 'individual' && cnt > 1;
      if (demandWrap) demandWrap.style.display = indiv ? 'none' : '';
      if (itemsWrap) itemsWrap.style.display = indiv ? '' : 'none';
      // v0.59.663: serialMode-чекбокс остаётся видимым всегда — он управляет
      // доступностью «Индивидуальная» опции. Раньше прятался при индивид.
      if (indiv && itemsBody && itemsBody.children.length === 0) {
        // Миграция: первый переход → заполняем items из count × demandKw
        const per = Number(document.getElementById('cp-demandKw')?.value) || 0;
        for (let i = 0; i < cnt; i++) addItemRow('', per);
      }
    });
  }
  // v0.59.663: при включении/выключении «Последовательное соединение»
  // опция «Индивидуальная» в cp-groupMode становится доступной/нет.
  // Если серийность снимается, а сейчас выбрана individual → откатываем
  // на uniform (нельзя оставить запрещённое состояние).
  {
    const _serialCb = document.getElementById('cp-serialMode');
    const _gmHint = document.getElementById('cp-groupMode-hint');
    if (_serialCb && groupModeSel) {
      _serialCb.addEventListener('change', () => {
        const enabled = _serialCb.checked;
        const indivOpt = groupModeSel.querySelector('option[value="individual"]');
        if (indivOpt) {
          indivOpt.disabled = !enabled;
          indivOpt.textContent = enabled
            ? 'Индивидуальная (мощности разные)'
            : 'Индивидуальная (мощности разные) — только при цепочке';
        }
        if (_gmHint) _gmHint.style.display = enabled ? 'none' : '';
        // Если выкл серийность и сейчас выбрана individual → uniform.
        if (!enabled && groupModeSel.value === 'individual') {
          groupModeSel.value = 'uniform';
          groupModeSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  }

  // Live-обновление полей serial/loadSpec
  const serialCb = document.getElementById('cp-serialMode');
  // v0.59.744: loadSpec-селектор удалён, остался hidden input. Оставляем
  // переменную для backward-compat по апплаю (см. apply ниже), но никаких
  // event-listener на ней нет (всегда 'per-unit').
  const loadSpecSel = document.getElementById('cp-loadSpec');
  const demandInput = document.getElementById('cp-demandKw');
  const demandLabel = document.getElementById('cp-demandKw-label');
  const demandALabel = document.getElementById('cp-demandA-label');
  const countInput = document.getElementById('cp-count');
  // v0.59.738: cp-demandKw / cp-demandA ВСЕГДА хранят per-unit-значения.
  // Группа показывается отдельной парой полей выше (cp-demandKwGroup /
  // cp-demandAGroup) и пересчитывается из per-unit × count в _wireGroupSync.
  const updateDemandUi = () => {
    const cnt = Math.max(1, Number(countInput?.value) || 1);
    if (demandLabel) demandLabel.textContent = (cnt > 1) ? 'Мощность каждого, kW' : 'Установленная мощность, kW';
    if (demandALabel) {
      // Заменить только текстовый префикс лейбла, сохранив helpIcon.
      const helpEl = demandALabel.querySelector('.help-icon, [data-help-icon]');
      const prefix = (cnt > 1) ? 'Ток каждого, А' : 'Номинальный ток I, А';
      // Перестроить через innerHTML чтобы сохранить helpIcon.
      const helpHtml = helpEl ? helpEl.outerHTML : '';
      demandALabel.innerHTML = prefix + helpHtml;
    }
  };
  if (countInput) countInput.addEventListener('change', updateDemandUi);
  if (serialCb) {
    serialCb.addEventListener('change', () => {
      // v0.59.746: «Тип группы» виден только в режиме «Последовательное».
      // Без serial — выбор индивидуальной всё равно недоступен, селектор
      // лишний. При снятии чекбокса принудительно сбрасываем groupMode в
      // 'uniform', чтобы скрытое 'individual' не оставалось живым в форме
      // (и не сбивало рендер блока members при следующем открытии).
      const wrap = document.getElementById('cp-groupMode-wrap');
      const gmSel = document.getElementById('cp-groupMode');
      const isSerial = !!serialCb.checked;
      if (wrap) wrap.style.display = isSerial ? '' : 'none';
      if (!isSerial && gmSel) {
        gmSel.value = 'uniform';
        gmSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // v0.59.622: показываем поле «Свой K_рез» только при выборе «Пользовательский».
  const starterSel = document.getElementById('cp-starterType');
  if (starterSel) {
    starterSel.addEventListener('change', () => {
      const wrap = document.getElementById('cp-crfOverride-wrap');
      if (wrap) wrap.style.display = (starterSel.value === 'custom') ? '' : 'none';
    });
  }

  // v0.59.651: двунаправленный пересчёт P ↔ I.
  // P (kW) = I (А) × U (В) × cos φ × √3 (для 3ph) / 1000
  // I (А) = P (kW) × 1000 / (U × cos φ × √3 для 3ph)
  // U берётся из выбранного уровня напряжения, cos φ — из текущего поля.
  const demandAInput = document.getElementById('cp-demandA');
  const cosInput = document.getElementById('cp-cosPhi');
  const phaseSel = document.getElementById('cp-phase');
  const voltSel = document.getElementById('cp-voltage');
  const _getU = () => {
    const idx = voltSel ? Number(voltSel.value) : -1;
    if (Number.isFinite(idx) && idx >= 0) {
      const lv = (GLOBAL.voltageLevels || [])[idx];
      if (lv && Number(lv.vLL)) return Number(lv.vLL);
    }
    // fallback из узла: phase ph выбран → стандартное напряжение
    const ph = phaseSel ? phaseSel.value : (n.phase || '3ph');
    if (ph === 'dc') return 48;
    if (ph === '1ph') return 230;
    return 400;
  };
  const _getCos = () => Math.max(0.1, Math.min(1, Number(cosInput?.value) || Number(n.cosPhi) || 0.92));
  const _is3ph = () => (phaseSel ? phaseSel.value : (n.phase || '3ph')) === '3ph';
  const _isDC = () => (phaseSel ? phaseSel.value : n.phase) === 'dc';
  const _PtoI = (kw) => {
    const U = _getU();
    if (!U || U <= 0 || !(kw > 0)) return 0;
    const cos = _isDC() ? 1 : _getCos();
    const k = _is3ph() && !_isDC() ? Math.sqrt(3) : 1;
    return (kw * 1000) / (U * cos * k);
  };
  const _ItoP = (a) => {
    const U = _getU();
    if (!U || U <= 0 || !(a > 0)) return 0;
    const cos = _isDC() ? 1 : _getCos();
    const k = _is3ph() && !_isDC() ? Math.sqrt(3) : 1;
    return (a * U * cos * k) / 1000;
  };
  // v0.59.738: 4-way двунаправленный sync. Per-unit P (cp-demandKw) —
  // канонический источник. Поля cp-demandA / cp-demandKwGroup /
  // cp-demandAGroup — производные.
  // Per-unit:    P_unit ↔ I_unit  через _PtoI / _ItoP
  // Group:       P_group = P_unit × N
  //              I_group = I_unit × N (параллельные потребители — суммарный
  //                                    ток равен сумме токов)
  // Любая правка → пересчёт всех остальных полей.
  const demandKwGroupInput = document.getElementById('cp-demandKwGroup');
  const demandAGroupInput  = document.getElementById('cp-demandAGroup');
  if (demandInput && demandAInput) {
    const _readCount = () => Math.max(1, Number(countInput?.value) || 1);
    const _fmt = (v) => v > 0 ? v.toFixed(2).replace(/\.00$/, '') : '';
    let _syncing = false;
    // Распространение от per-unit P (канонического значения) на 3 остальных.
    const _propFromUnitP = () => {
      const pUnit = Number(demandInput.value) || 0;
      const iUnit = _PtoI(pUnit);
      demandAInput.value = _fmt(iUnit);
      const cnt = _readCount();
      if (demandKwGroupInput) demandKwGroupInput.value = _fmt(pUnit * cnt);
      if (demandAGroupInput)  demandAGroupInput.value  = _fmt(iUnit * cnt);
    };
    // Инициализация: посчитать I_unit + group-поля из текущего P_unit.
    _propFromUnitP();
    // P_unit введён — пересчитать I_unit, group P, group I.
    demandInput.addEventListener('input', () => {
      if (_syncing) return;
      _syncing = true;
      try { _propFromUnitP(); } finally { _syncing = false; }
    });
    // I_unit введён — обратная P_unit, затем пропагация.
    demandAInput.addEventListener('input', () => {
      if (_syncing) return;
      _syncing = true;
      try {
        const a = Number(demandAInput.value) || 0;
        const p = _ItoP(a);
        demandInput.value = _fmt(p);
        const cnt = _readCount();
        if (demandKwGroupInput) demandKwGroupInput.value = _fmt(p * cnt);
        if (demandAGroupInput)  demandAGroupInput.value  = _fmt(a * cnt);
      } finally { _syncing = false; }
    });
    // P_group введён — обратная P_unit = P_group / N, затем пропагация.
    if (demandKwGroupInput) {
      demandKwGroupInput.addEventListener('input', () => {
        if (_syncing) return;
        _syncing = true;
        try {
          const cnt = _readCount();
          const pGroup = Number(demandKwGroupInput.value) || 0;
          const pUnit = cnt > 0 ? pGroup / cnt : 0;
          demandInput.value = _fmt(pUnit);
          const iUnit = _PtoI(pUnit);
          demandAInput.value = _fmt(iUnit);
          if (demandAGroupInput) demandAGroupInput.value = _fmt(iUnit * cnt);
        } finally { _syncing = false; }
      });
    }
    // I_group введён — обратная I_unit = I_group / N, затем пропагация.
    if (demandAGroupInput) {
      demandAGroupInput.addEventListener('input', () => {
        if (_syncing) return;
        _syncing = true;
        try {
          const cnt = _readCount();
          const iGroup = Number(demandAGroupInput.value) || 0;
          const iUnit = cnt > 0 ? iGroup / cnt : 0;
          demandAInput.value = _fmt(iUnit);
          const pUnit = _ItoP(iUnit);
          demandInput.value = _fmt(pUnit);
          if (demandKwGroupInput) demandKwGroupInput.value = _fmt(pUnit * cnt);
        } finally { _syncing = false; }
      });
    }
    // При смене U/cos/phase/count — пересчитать всё из канонического P_unit.
    const _refreshAll = () => {
      if (_syncing) return;
      _syncing = true;
      try { _propFromUnitP(); } finally { _syncing = false; }
    };
    if (cosInput) cosInput.addEventListener('input', _refreshAll);
    if (phaseSel) phaseSel.addEventListener('change', _refreshAll);
    if (voltSel) voltSel.addEventListener('change', _refreshAll);
    if (countInput) countInput.addEventListener('input', _refreshAll);
    if (countInput) countInput.addEventListener('change', _refreshAll);
  }

  // v0.59.753: «Расчётная нагрузка» — теперь парные ряды (группа + единица)
  // в режиме count > 1 + uniform, симметрично с номинальным блоком v0.59.738.
  // Юзер: «для расчётной нагрузки сделай так же как и для номинальной,
  // мощность группы и мощность одного».
  //   Канонический источник: Pcalc_unit (cp-calcKw).
  //   Производные: Icalc_unit (= _PtoI(Pcalc_unit)),
  //                Pcalc_group = Pcalc_unit × N,
  //                Icalc_group = Icalc_unit × N.
  //   Clamp: Pcalc_unit ≤ Pnom_unit × LF (Ки ≤ 1); Pcalc_group ≤ Pnom_group × LF.
  const calcKwInput = document.getElementById('cp-calcKw');
  const calcAInput = document.getElementById('cp-calcA');
  const calcKwGroupInput = document.getElementById('cp-calcKwGroup');
  const calcAGroupInput  = document.getElementById('cp-calcAGroup');
  const kuInput = document.getElementById('cp-kUse');
  const lfInput = document.getElementById('cp-loadFactor') || document.getElementById('cp-normalLoadFactor');
  const countInputForCalc = document.getElementById('cp-count');
  if (calcKwInput && kuInput) {
    let _calcSyncing = false;
    const _readCount = () => Math.max(1, Number(countInputForCalc?.value) || 1);
    const _readPnomUnit = () => Number(demandInput?.value) || 0; // всегда per-unit с v0.59.738
    const _readKu = () => Math.max(0, Math.min(1, Number(kuInput.value) || 0));
    const _readLf = () => Math.max(0, Math.min(3, Number(lfInput?.value) || 1));
    const _fmtCalc = (v) => v > 0 ? v.toFixed(2).replace(/\.00$/, '') : '';
    // Распространяет от канонического Pcalc_unit на все 4 поля.
    const _propFromCalcUnit = (PcalcUnit) => {
      const cnt = _readCount();
      const IcalcUnit = _PtoI(PcalcUnit);
      calcKwInput.value = _fmtCalc(PcalcUnit);
      if (calcAInput) calcAInput.value = _fmtCalc(IcalcUnit);
      if (calcKwGroupInput) calcKwGroupInput.value = _fmtCalc(PcalcUnit * cnt);
      if (calcAGroupInput) calcAGroupInput.value = _fmtCalc(IcalcUnit * cnt);
    };
    // Полный recompute из формулы Pnom × Ku × LF — например, при смене Ku/LF/Pnom/count.
    const _refreshCalc = () => {
      if (_calcSyncing) return;
      _calcSyncing = true;
      try {
        const PnomUnit = _readPnomUnit();
        const ku = _readKu();
        const lf = _readLf();
        const PcalcUnit = PnomUnit * ku * lf;
        _propFromCalcUnit(PcalcUnit);
      } finally { _calcSyncing = false; }
    };
    // Применяет clamp Pcalc_unit ≤ Pnom_unit × LF и обновляет Ku.
    const _applyCalcUnitP = (PcalcUnitWanted) => {
      const PnomUnit = _readPnomUnit();
      const lf = _readLf();
      const Pmax = PnomUnit * lf;
      const PcalcUnit = (PnomUnit > 0 && lf > 0)
        ? Math.max(0, Math.min(PcalcUnitWanted, Pmax))
        : Math.max(0, PcalcUnitWanted);
      if (PnomUnit > 0 && lf > 0) {
        const newKu = PcalcUnit / (PnomUnit * lf);
        kuInput.value = Math.max(0, Math.min(1, newKu)).toFixed(3).replace(/\.?0+$/, '');
      }
      _propFromCalcUnit(PcalcUnit);
    };
    // Юзер ввёл Pcalc_unit (cp-calcKw)
    calcKwInput.addEventListener('input', () => {
      if (_calcSyncing) return;
      _calcSyncing = true;
      try { _applyCalcUnitP(Number(calcKwInput.value) || 0); }
      finally { _calcSyncing = false; }
    });
    // Юзер ввёл Icalc_unit (cp-calcA) — обратная Pcalc_unit
    if (calcAInput) calcAInput.addEventListener('input', () => {
      if (_calcSyncing) return;
      _calcSyncing = true;
      try {
        const I = Number(calcAInput.value) || 0;
        _applyCalcUnitP(_ItoP(I));
      } finally { _calcSyncing = false; }
    });
    // Юзер ввёл Pcalc_group → Pcalc_unit = P_group / N
    if (calcKwGroupInput) calcKwGroupInput.addEventListener('input', () => {
      if (_calcSyncing) return;
      _calcSyncing = true;
      try {
        const cnt = _readCount();
        const Pgroup = Number(calcKwGroupInput.value) || 0;
        _applyCalcUnitP(cnt > 0 ? Pgroup / cnt : 0);
      } finally { _calcSyncing = false; }
    });
    // Юзер ввёл Icalc_group → Pcalc_unit = _ItoP(I_group / N)
    if (calcAGroupInput) calcAGroupInput.addEventListener('input', () => {
      if (_calcSyncing) return;
      _calcSyncing = true;
      try {
        const cnt = _readCount();
        const Igroup = Number(calcAGroupInput.value) || 0;
        _applyCalcUnitP(_ItoP(cnt > 0 ? Igroup / cnt : 0));
      } finally { _calcSyncing = false; }
    });
    // Реакция на смену Ки / LF / Pnom_unit / count — пересчитать всё.
    kuInput.addEventListener('input', _refreshCalc);
    if (lfInput) lfInput.addEventListener('input', _refreshCalc);
    if (demandInput) demandInput.addEventListener('input', _refreshCalc);
    if (countInputForCalc) countInputForCalc.addEventListener('change', _refreshCalc);
    if (countInputForCalc) countInputForCalc.addEventListener('input', _refreshCalc);
    // Инициализация при открытии формы.
    _refreshCalc();
  }

  const applyBtn = document.getElementById('consumer-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('consumer-params:' + n.id);
    // v0.57.68: preserve-on-miss. Если элемента в DOM нет или поле пустое —
    // сохраняем текущее n.*, а не затираем дефолтом.
    const readNum = (id, curr) => {
      const el = document.getElementById(id);
      if (!el) return curr;
      const raw = String(el.value ?? '').trim();
      if (raw === '') return curr;
      const v = Number(raw);
      return Number.isFinite(v) ? v : curr;
    };
    const catId = document.getElementById('cp-catalog')?.value || n.consumerSubtype || 'custom';
    const cat = fullCatalog.find(c => c.id === catId);
    n.consumerSubtype = catId;
    const nameInput = document.getElementById('cp-name')?.value?.trim();
    n.name = nameInput || (cat ? cat.label : n.name || 'Потребитель');
    n.count = readNum('cp-count', n.count ?? 1);
    n.serialMode = !!document.getElementById('cp-serialMode')?.checked;
    n.loadSpec = (document.getElementById('cp-loadSpec')?.value === 'total') ? 'total' : 'per-unit';
    // v0.57.81: режим группы и items для индивидуальной
    const _gmEl = document.getElementById('cp-groupMode');
    const _groupModeSel = _gmEl ? _gmEl.value : (n.groupMode || 'uniform');
    const _individual = (_groupModeSel === 'individual' && n.count > 1);
    if (_individual) {
      // v0.59.91: items теперь могут содержать расширенные поля (каждый прибор
      // — полноценный потребитель). Пустые поля = унаследовать от родителя
      // (удаляем ключ из item, чтобы compute читал n.cosPhi/kUse и т.п.).
      const cards = document.querySelectorAll('#cp-items-body .cp-it-card');
      const items = [];
      cards.forEach(card => {
        const nm = String(card.querySelector('.cp-it-name')?.value || '').trim();
        const kw = Number(card.querySelector('.cp-it-kw')?.value) || 0;
        const it = { name: nm, demandKw: kw };
        const readRich = (sel, key, numeric = false) => {
          const el = card.querySelector(sel);
          if (!el) return;
          const raw = String(el.value ?? '').trim();
          if (raw === '') return;
          if (numeric) {
            const v = Number(raw);
            if (Number.isFinite(v)) it[key] = v;
          } else {
            it[key] = raw;
          }
        };
        readRich('.cp-it-voltage', 'voltageLevelIdx', true);
        readRich('.cp-it-phase', 'phase', false);
        readRich('.cp-it-cos', 'cosPhi', true);
        readRich('.cp-it-ku', 'kUse', true);
        readRich('.cp-it-inr', 'inrushFactor', true);
        readRich('.cp-it-bm', 'breakerMarginPct', true);
        readRich('.cp-it-curve', 'curveHint', false);
        items.push(it);
      });
      // Если пусто — откатываемся в uniform
      if (items.length === 0) {
        n.groupMode = 'uniform';
        delete n.items;
      } else {
        n.groupMode = 'individual';
        n.items = items;
        n.count = items.length;
        // Для совместимости: в demandKw пишем среднее, чтобы старые
        // сериализованные ссылки (экспорт/CSV) оставались валидными.
        const _sum = items.reduce((a, it) => a + (Number(it.demandKw) || 0), 0);
        n.demandKw = _sum / items.length;
      }
    } else {
      n.groupMode = 'uniform';
      if (Array.isArray(n.items)) delete n.items;
      const demandEl = document.getElementById('cp-demandKw');
      if (demandEl && String(demandEl.value ?? '').trim() !== '') {
        // v0.59.738: cp-demandKw ВСЕГДА хранит per-unit (см. рендер выше).
        // Группа отображается отдельным полем cp-demandKwGroup, которое
        // sync-логика автоматически пересчитывает в per-unit / count.
        n.demandKw = Number(demandEl.value) || 0;
      }
    }
    const vEl = document.getElementById('cp-voltage');
    if (vEl && String(vEl.value ?? '').trim() !== '') {
      const vIdx = Number(vEl.value);
      if (Number.isFinite(vIdx)) {
        n.voltageLevelIdx = vIdx;
        if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; }
      }
    }
    const phEl = document.getElementById('cp-phase');
    if (phEl && phEl.value) n.phase = phEl.value;
    n.cosPhi = readNum('cp-cosPhi', n.cosPhi ?? 0.92);
    n.kUse = readNum('cp-kUse', n.kUse ?? 1);
    // Множитель нагрузки
    const lfEl = document.getElementById('cp-loadFactor');
    if (lfEl && state.activeModeId) {
      setEffectiveLoadFactor(n, Number(lfEl.value));
    }
    const nlfEl = document.getElementById('cp-normalLoadFactor');
    if (nlfEl) {
      n.normalLoadFactor = Number(nlfEl.value);
    }
    n.inrushFactor = readNum('cp-inrush', n.inrushFactor ?? 1);
    // Запас по автомату: пусто = auto (удаляем поле, используется авто)
    const brkMarginRaw = document.getElementById('cp-brkMargin')?.value;
    if (brkMarginRaw === '' || brkMarginRaw == null) delete n.breakerMarginPct;
    else n.breakerMarginPct = Number(brkMarginRaw);
    const curveHintRaw = document.getElementById('cp-curveHint')?.value;
    if (!curveHintRaw) delete n.curveHint;
    else n.curveHint = curveHintRaw;
    // v0.59.621/622: Тип пуска и K_рез (для питания от ИБП).
    // crfOverride сохраняется только при starterType==='custom' — в остальных
    // случаях K_рез берётся из STARTER_TYPES, поле override игнорируется.
    const stRaw = document.getElementById('cp-starterType')?.value || '';
    if (stRaw) n.starterType = stRaw;
    else delete n.starterType;
    if (stRaw === 'custom') {
      const crfOvRaw = document.getElementById('cp-crfOverride')?.value;
      if (crfOvRaw == null || String(crfOvRaw).trim() === '') {
        delete n.crfOverride;
      } else {
        const ov = Number(crfOvRaw);
        if (Number.isFinite(ov) && ov >= 0.30 && ov <= 1.00) n.crfOverride = ov;
        else delete n.crfOverride;
      }
    } else {
      delete n.crfOverride; // не custom → override не релевантен
    }
    n.inputs = readNum('cp-inputs', n.inputs ?? 1);
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
      n.outdoorKw = readNum('cp-outdoorKw', n.outdoorKw ?? 0.3);
      n.outdoorCosPhi = readNum('cp-outdoorCosPhi', n.outdoorCosPhi ?? 0.85);
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

    // Phase 2.3: вкладка «Габариты» — пишем n.geometryMm.
    // Пустые поля = не override (удаляем). Все 4 пустых = удаляем объект.
    const _gv = (id) => {
      const raw = document.getElementById(id)?.value;
      if (raw == null) return null;
      const s = String(raw).trim();
      if (s === '') return 0;
      const v = Number(s);
      return Number.isFinite(v) ? v : 0;
    };
    const gW = _gv('cp-widthMm');
    const gH = _gv('cp-heightMm');
    const gD = _gv('cp-depthMm');
    const gKg = _gv('cp-weightKg');
    if (gW || gH || gD || gKg) {
      n.geometryMm = {};
      if (gW) n.geometryMm.widthMm = gW;
      if (gH) n.geometryMm.heightMm = gH;
      if (gD) n.geometryMm.depthMm = gD;
      if (gKg) n.geometryMm.weightKg = gKg;
    } else if (gW === 0 && gH === 0 && gD === 0 && gKg === 0) {
      // Все 4 явно очищены — снимаем override
      delete n.geometryMm;
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
