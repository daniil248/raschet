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
  // v0.59.98: только обозначение + название (read-only) над вкладками —
  // пользователь просит редактируемые поля убрать в свою вкладку. Для
  // редактирования имени открывается вкладка «Общее».
  h.push(`<h3 style="margin-bottom:4px">${escHtml(effectiveTag(n))} <span style="font-weight:500">${escHtml(n.name)}</span></h3>`);
  h.push(`<div class="tp-tabs" role="tablist">
    <button type="button" class="tp-tab" data-tab="general" role="tab">📋 Общее</button>
    <button type="button" class="tp-tab active" data-tab="electrical" role="tab">⚡ Электрика</button>
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
  // v0.57.81: режим группы. 'uniform' — один demandKw на все приборы
  // (count × demandKw). 'individual' — массив items [{name, demandKw}]
  // с разными мощностями. Показывается только когда count > 1.
  const _groupMode = n.groupMode === 'individual' ? 'individual' : 'uniform';
  if (_cpCount > 1) {
    h.push(`<div class="field">
      <label>Тип группы</label>
      <select id="cp-groupMode">
        <option value="uniform"${_groupMode === 'uniform' ? ' selected' : ''}>Единообразная (все приборы одинаковые)</option>
        <option value="individual"${_groupMode === 'individual' ? ' selected' : ''}>Индивидуальная (мощности разные)</option>
      </select>
    </div>`);
    h.push(`<div class="field check" id="cp-serialMode-wrap" style="${_groupMode === 'individual' ? 'display:none' : ''}"><input type="checkbox" id="cp-serialMode"${n.serialMode ? ' checked' : ''}><label>Последовательное соединение (цепочка)</label></div>`);
    h.push(`<div id="cp-loadSpec-wrap" class="field" style="${_serial && _groupMode !== 'individual' ? '' : 'display:none'}">
      <label>Указание нагрузки</label>
      <select id="cp-loadSpec">
        <option value="per-unit"${_loadSpec === 'per-unit' ? ' selected' : ''}>На каждый элемент</option>
        <option value="total"${_loadSpec === 'total' ? ' selected' : ''}>На всю группу</option>
      </select>
    </div>`);
  }
  h.push(`</div>`); // /tp-panel general
  h.push(`<div class="tp-panel" data-panel="electrical">`);
  const _displayDemand = (_serial && _loadSpec === 'total')
    ? (Number(n.demandKw || 0) * _cpCount)
    : Number(n.demandKw || 0);
  const _demandLabel = (_cpCount > 1)
    ? ((_serial && _loadSpec === 'total') ? 'Мощность всей группы, kW' : 'Мощность каждого, kW')
    : 'Установленная мощность, kW';
  // v0.59.99.2: флаг блокировки полей, зависящих от каталожного изделия.
  // Используется `disabled + title` на input, а для select — `disabled`
  // (readonly на select не работает). Отвязка — кнопкой на «Общее».
  const _lk = n.catalogLocked ? ' disabled title="Привязано к каталогу — отвяжите на вкладке Общее"' : '';
  const _lkIcon = n.catalogLocked ? ' 🔒' : '';
  h.push(`<div id="cp-demandKw-wrap" class="field" style="${_groupMode === 'individual' && _cpCount > 1 ? 'display:none' : ''}">
    <label id="cp-demandKw-label">${_demandLabel}${_lkIcon}</label>
    <input type="number" id="cp-demandKw" min="0" step="0.1" value="${_displayDemand}"${_lk}>
  </div>`);
  // v0.59.91: общие параметры нужны раньше (в карточках членов group'а для
  // «унаследовать от родителя» и в основных селектах ниже).
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  const ph = n.phase || '3ph';
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
  const _itemsCardsHtml = _items.map((it, idx) => _itemCardHtml(it, idx)).join('');
  h.push(`<div id="cp-items-wrap" class="field" style="${_groupMode === 'individual' && _cpCount > 1 ? '' : 'display:none'}">
    <label>Приборы в группе <span class="muted" style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0">— каждый с собственными параметрами; пусто = унаследовать от группы</span></label>
    <div id="cp-items-body">${_itemsCardsHtml}</div>
    <div style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:4px">
      <button type="button" id="cp-it-add" style="padding:3px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer">➕ Добавить прибор</button>
      <span id="cp-items-sum" class="muted"></span>
    </div>
  </div>`);

  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(levels[i]))}</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="cp-voltage">${vOpts}</select>`));
  h.push(field('Фазность', `<select id="cp-phase">
    <option value="3ph"${ph === '3ph' ? ' selected' : ''}>3-фазный</option>
    <option value="2ph"${ph === '2ph' ? ' selected' : ''}>2-фазный (split-phase)</option>
    <option value="1ph"${ph === '1ph' || ph === 'A' || ph === 'B' || ph === 'C' ? ' selected' : ''}>1-фазный</option>
  </select>`));
  h.push(field('cos φ' + _lkIcon, `<input type="number" id="cp-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi ?? 0.92}"${_lk}>`));
  h.push(field('Ки — коэффициент использования' + _lkIcon, `<input type="number" id="cp-kUse" min="0" max="1" step="0.05" value="${n.kUse ?? 1}"${_lk}>`));
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
  h.push(field('Кратность пускового тока' + _lkIcon, `<input type="number" id="cp-inrush" min="1" max="10" step="0.1" value="${n.inrushFactor ?? 1}"${_lk}>`));

  // Запас по автомату — override категории/авто. Пустое поле = авто по inrush.
  {
    const mv = (typeof n.breakerMarginPct === 'number') ? String(n.breakerMarginPct) : '';
    h.push(field('Запас по автомату, %' + _lkIcon, `<input type="number" id="cp-brkMargin" min="0" max="100" step="5" value="${mv}" placeholder="авто"${_lk}>`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-2px">Пусто = авто по inrush (лёгкий 20%, средний 35%, тяжёлый 50%). Используется для подбора номинала автомата защиты линии.</div>`);
  }
  // Кривая/тип автомата — подсказка для авто-подбора
  {
    const cv = n.curveHint || '';
    h.push(field('Кривая автомата (подсказка)' + _lkIcon, `<select id="cp-curveHint"${_lk}>
      <option value=""${cv===''?' selected':''}>авто (по inrush и In)</option>
      <option value="MCB_B"${cv==='MCB_B'?' selected':''}>MCB кр. B — резистивная, освещение</option>
      <option value="MCB_C"${cv==='MCB_C'?' selected':''}>MCB кр. C — общее назначение</option>
      <option value="MCB_D"${cv==='MCB_D'?' selected':''}>MCB кр. D — двигатели, трансформаторы</option>
    </select>`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-2px">Актуально для In ≤ 125 А. Выше — автоматически MCCB/ACB.</div>`);
  }
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
  h.push('</div>'); // /panel electrical

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
    cfgStub.addEventListener('click', () => {
      const kw = prompt('Требуемая мощность, кВт (и при желании — доп. требование, напр. "60, net sensible 45"):',
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
      // v0.59.99.2: выбор из каталога → привязка. Параметры из записи
      // применяются к узлу, поля в инспекторе блокируются. Снять — кнопкой
      // «Отвязать» на «Общее».
      snapshot('catalog-bind:' + n.id);
      n.demandKw = Number(cat.demandKw) || 0;
      n.cosPhi = Number(cat.cosPhi) || 0.92;
      n.kUse = Number(cat.kUse) ?? 1;
      n.inrushFactor = Number(cat.inrushFactor) || 1;
      if (typeof cat.breakerMarginPct === 'number') n.breakerMarginPct = cat.breakerMarginPct;
      else delete n.breakerMarginPct;
      n.curveHint = cat.curveHint || '';
      n.consumerSubtype = cat.id;
      if (cat.id === 'conditioner') {
        n.outdoorKw = cat.outdoorKw || 0.3;
        n.outdoorCosPhi = cat.outdoorCosPhi || 0.85;
      }
      n.catalogLocked = true;
      notifyChange();
      openConsumerParamsModal(n);
    });
  }

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
      if (serialWrap) serialWrap.style.display = indiv ? 'none' : '';
      if (indiv && itemsBody && itemsBody.children.length === 0) {
        // Миграция: первый переход → заполняем items из count × demandKw
        const per = Number(document.getElementById('cp-demandKw')?.value) || 0;
        for (let i = 0; i < cnt; i++) addItemRow('', per);
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
        const _rawDemand = Number(demandEl.value) || 0;
        n.demandKw = (n.serialMode && n.loadSpec === 'total' && n.count > 1)
          ? (_rawDemand / n.count)
          : _rawDemand;
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
