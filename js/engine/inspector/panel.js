// Инспектор: модалки щитов (секционные/обычные), управление щитом,
// вспомогательные функции отрисовки. Выделено из inspector.js.
import { DEFAULTS, BREAKER_SERIES, GLOBAL } from '../constants.js';
import { state, uid } from '../state.js';
import { escHtml, escAttr, fmt, field, flash } from '../utils.js';
import { effectiveTag } from '../zones.js';
import { snapshot, notifyChange } from '../history.js';
import { render } from '../render.js';
import { isTagUnique } from '../graph.js';
import { listPanels } from '../../../shared/panel-catalog.js';
import { mountPanelPicker, applyPanelModel } from '../../../shared/panel-picker.js';

let _renderInspector = null;
export function bindInspectorPanelDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}
// forward-reference для renderInspector() вызовов внутри перенесённого кода
function renderInspector() { if (_renderInspector) _renderInspector(); }

// Состояние зума и полноэкранного режима для модалки "Управление щитом".
// Общее для обычных и секционных щитов, сохраняется между перерисовками.
const _pcZoomState = { zoom: 1, fullscreen: false };

export function openPanelParamsModal(n) {
  const body = document.getElementById('panel-params-body');
  if (!body) return;
  // Фаза 1.19.2: динамический заголовок в зависимости от типа щита
  const titleEl = document.getElementById('panel-params-title');
  if (titleEl) {
    titleEl.textContent = n.isMv ? 'Параметры РУ СН (MV)' : 'Параметры НКУ (LV щит)';
  }
  const h = [];
  // Обозначение (редактируемое) + Имя
  h.push(field('Обозначение', `<input type="text" id="pp-tag" value="${escAttr(n.tag || '')}">`));
  {
    const eff = effectiveTag(n);
    if (eff && eff !== n.tag) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное: <b>${escHtml(eff)}</b></div>`);
    }
  }
  h.push(field('Имя', `<input type="text" id="pp-name" value="${escAttr(n.name || '')}">`));

  // === MV-switchgear (Фаза 1.19): если щит помечен isMv — специальный блок ===
  if (n.isMv || n.mvSwitchgearId) {
    h.push('<h4 style="margin:14px 0 6px;color:#c67300">⚡ Устройство СН (RM6 / FafeRing / ЩО-70)</h4>');
    // Выбор модели из element-library kind='mv-switchgear'
    (async () => {
      try {
        const lib = await import('../../../shared/element-library.js');
        const mvList = lib.listElements({ kind: 'mv-switchgear' });
        const mount = document.getElementById('pp-mv-select-mount');
        if (!mount || !mvList.length) return;
        const opts = ['<option value="">— не выбрано —</option>'];
        for (const el of mvList) {
          const sel = el.id === n.mvSwitchgearId ? ' selected' : '';
          opts.push(`<option value="${el.id}"${sel}>${escHtml(el.label || el.id)}</option>`);
        }
        mount.innerHTML = `<select id="pp-mv-select" style="width:100%;padding:5px 8px">${opts.join('')}</select>`;
        document.getElementById('pp-mv-select').addEventListener('change', (e) => {
          const newId = e.target.value;
          snapshot('mvSwitchgear:' + n.id);
          n.mvSwitchgearId = newId || null;
          // Применяем параметры выбранной модели
          if (newId) {
            const sel = lib.getElement(newId);
            if (sel) {
              const kp = sel.kindProps || {};
              if (kp.In_A) n.capacityA = kp.In_A;
              if (kp.IP) n.ipRating = kp.IP;
              if (Array.isArray(kp.cells)) {
                const infeeds = kp.cells.filter(c => c.type === 'infeed' || c.type === 'busCoupler').length;
                const feeders = kp.cells.filter(c => c.type === 'feeder' || c.type === 'transformer-protect').length;
                if (infeeds > 0) n.inputs = Math.max(1, infeeds);
                if (feeders > 0) n.outputs = Math.max(1, feeders);
                if (!Array.isArray(n.priorities) || n.priorities.length !== n.inputs) {
                  n.priorities = Array.from({ length: n.inputs }, (_, i) => i + 1);
                }
              }
            }
          }
          render(); notifyChange(); renderInspector();
        });
      } catch (e) { console.warn('[panel-inspector] mv lib', e); }
    })();
    h.push(`<div id="pp-mv-select-mount" style="margin-bottom:6px">Загрузка справочника…</div>`);
    h.push(`<div class="muted" style="font-size:11px;margin:-2px 0 8px">РУ среднего напряжения (6-35 кВ): моноблоки SF6 (RM6/FafeRing) или сборные (ЩО-70). Конфигуратор с wizard — в <a href="mv-config/" target="_blank" style="color:#1976d2">«Конфигураторе MV»</a> (в разработке, Фаза 1.19.1).</div>`);

    // Кнопка MV-конфигуратора
    {
      const qp = new URLSearchParams();
      qp.set('nodeId', n.id);
      if (n.name) qp.set('name', n.name);
      // Класс напряжения из voltageLevel
      const levels = GLOBAL.voltageLevels || [];
      const lv = (typeof n.voltageLevelIdx === 'number') ? levels[n.voltageLevelIdx] : null;
      const UnKv = lv ? (Number(lv.vLL) || 10000) / 1000 : 10;
      qp.set('Un_kV', String(UnKv));
      if (n.capacityA) qp.set('In_A', String(n.capacityA));
      if (n._maxLoadA) qp.set('loadA', String(Math.round(n._maxLoadA)));
      if (n.inputs || n.outputs) qp.set('cellsCount', String((n.inputs || 1) + (n.outputs || 1)));
      if (n.ipRating) qp.set('IP', n.ipRating);
      h.push(`<div style="margin:4px 0 10px">
        <a href="mv-config/?${qp.toString()}" target="_blank" class="full-btn" style="display:block;text-align:center;padding:6px 10px;background:#fff4e5;color:#c67300;text-decoration:none;border:1px solid #f0cea0;border-radius:4px;font-size:12px">
          ⚙ Сконфигурировать РУ СН подробно (новая вкладка)
        </a>
      </div>`);
    }
    // Ik3 на MV-шинах (Фаза 1.19.3-4, IEC 60909 с учётом MV-кабелей)
    if (n._Ik3_kA) {
      const overload = n._mvIkOverload;
      const bgColor = overload ? '#ffebee' : '#e8f5e9';
      const txtColor = overload ? '#c62828' : '#2e7d32';
      const zDetails = n._Ik3_Z_ohm
        ? ` · Z<sub>k</sub> = ${(n._Ik3_Z_ohm * 1000).toFixed(1)} мОм · κ = ${n._Ik3_kappa ? n._Ik3_kappa.toFixed(2) : '1.8'}`
        : '';
      h.push(`<div style="margin:6px 0 10px;padding:8px 10px;background:${bgColor};border-radius:4px;font-size:12px;color:${txtColor}">
        <b>Ток КЗ (IEC 60909)</b><br>
        I<sub>k3</sub> = <b>${n._Ik3_kA.toFixed(2)} кА</b> · i<sub>p</sub> (ударный) = <b>${n._ip_kA ? n._ip_kA.toFixed(2) : '?'} кА</b>${zDetails}
        ${overload ? '<br><b>⚠ Превышена термическая стойкость шин</b> — выберите модель с бо́льшим It' : ''}
      </div>`);
    }
    if (n.mvSwitchgearId) {
      // Покажем информацию о выбранной модели
      h.push(`<div id="pp-mv-info" class="muted" style="font-size:11px;padding:6px 10px;background:#fff4e5;border-radius:4px;margin-bottom:8px">
        Загрузка параметров модели…
      </div>`);
      (async () => {
        try {
          const lib = await import('../../../shared/element-library.js');
          const el = lib.getElement(n.mvSwitchgearId);
          const info = document.getElementById('pp-mv-info');
          if (!el || !info) return;
          const kp = el.kindProps || {};
          const cellsHtml = Array.isArray(kp.cells) && kp.cells.length
            ? '<br>Ячейки: ' + kp.cells.map(c => `<b>${c.type}</b>${c.breakerType ? ` (${c.breakerType})` : ''}`).join(', ')
            : '';
          info.innerHTML = `
            <b>${escHtml(el.label)}</b><br>
            ${kp.mvType || '—'} · ${kp.Un_kV || '?'} кВ · ${kp.In_A || '?'} А · Icu ${kp.It_kA || '?'} кА · ${kp.insulation || '?'}${kp.arcProof ? ' · arc-proof' : ''}${cellsHtml}
          `;
        } catch (e) { /* silent */ }
      })();
    }
  }

  // === Модель НКУ из справочника (panel-catalog + panel-picker) ===
  // Показывается ТОЛЬКО для LV-щитов (не MV). Для MV-щитов (isMv=true)
  // действует отдельный блок выше с выбором mv-switchgear из
  // element-library + кнопкой mv-config/. Смешивать нельзя — разные
  // стандарты IEC 61439 (НКУ LV) и IEC 62271-200 (РУ СН MV).
  if (!n.isMv) {
    try {
      const panelCatalog = listPanels();
      if (panelCatalog.length) {
        h.push('<h4 style="margin:14px 0 6px">Модель НКУ из справочника</h4>');
        h.push('<div id="pp-cat-picker-mount" style="margin-bottom:4px"></div>');
        h.push(`<div class="muted" style="font-size:11px;margin:-2px 0 4px">При выборе модели автоматически заполняются I<sub>ном</sub>, число входов / выходов, IP, форма разделения.</div>`);
      } else {
        h.push(`<div class="muted" style="font-size:11px;margin:8px 0;padding:8px 10px;background:#f6f8fa;border-radius:4px">
          Справочник НКУ пуст. Добавьте модели в «Конфигураторе НКУ» (кнопка ниже), чтобы выбирать их здесь одним кликом.
        </div>`);
      }
      // Фаза 1.7: кнопка перехода в wizard-конфигуратор для проекта
      const qp = new URLSearchParams();
      qp.set('nodeId', n.id);
      if (n.name) qp.set('name', n.name);
      if (n.switchMode === 'avr') qp.set('kind', 'avr');
      else if (n.type === 'panel') qp.set('kind', 'distribution');
      if (n._loadKw) qp.set('loadKw', String(n._loadKw));
      if (n.inputs) qp.set('inputs', String(n.inputs));
      if (n.outputs) qp.set('outputs', String(n.outputs));
      if (n.ipRating) qp.set('ip', n.ipRating);
      h.push(`<div style="margin:4px 0 10px">
        <a href="panel-config/?${qp.toString()}" target="_blank" class="full-btn" style="display:block;text-align:center;padding:6px 10px;background:#f0f4ff;color:#1976d2;text-decoration:none;border:1px solid #d0d7e8;border-radius:4px;font-size:12px">
          ⚙ Сконфигурировать НКУ подробно (новая вкладка)
        </a>
      </div>`);
    } catch (e) { /* опционально */ }
  }

  // Тип щита — всегда виден
  const sm = n.switchMode || 'auto';
  {
    const isSubSection = !!n.parentSectionedId;
    let smOpts = `<option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Щит</option>`;
    smOpts += `<option value="auto"${sm === 'auto' ? ' selected' : ''}>Щит с АВР</option>`;
    if (!isSubSection) smOpts += `<option value="sectioned"${sm === 'sectioned' ? ' selected' : ''}>Многосекционный щит</option>`;
    if ((n.inputs || 0) > 1) {
      smOpts += `<option value="avr_paired"${sm === 'avr_paired' ? ' selected' : ''}>АВР с привязкой</option>`;
      smOpts += `<option value="switchover"${sm === 'switchover' ? ' selected' : ''}>Подменный</option>`;
      smOpts += `<option value="watchdog"${sm === 'watchdog' ? ' selected' : ''}>Watchdog</option>`;
    }
    h.push(field('Тип щита', `<select id="pp-switchMode">${smOpts}</select>`));
  }

  const isSectioned = sm === 'sectioned';

  // Базовые настройки — только для несекционных щитов
  if (!isSectioned) {
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Входов', `<input type="number" id="pp-inputs" min="1" max="30" step="1" value="${n.inputs}">`) + '</div>');
    h.push('<div style="flex:1">' + field('Выходов', `<input type="number" id="pp-outputs" min="1" max="30" step="1" value="${n.outputs}">`) + '</div>');
    h.push('</div>');
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Ксим', `<input type="number" id="pp-kSim" min="0" max="1.2" step="0.05" value="${n.kSim ?? 1}">`) + '</div>');
    {
      const curA = n.capacityA ?? 160;
      let opts = '';
      let hasCur = false;
      for (const v of BREAKER_SERIES) {
        if (v === curA) hasCur = true;
        opts += `<option value="${v}"${v === curA ? ' selected' : ''}>${v} А</option>`;
      }
      if (!hasCur) opts = `<option value="${curA}" selected>${curA} А</option>` + opts;
      h.push('<div style="flex:1">' + field('In, А', `<select id="pp-capacityA">${opts}</select>`) + '</div>');
    }
    h.push('</div>');
    if (n._capacityKwFromA) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-8px;margin-bottom:10px">Эквивалент: <b>${fmt(n._capacityKwFromA)} kW</b></div>`);
    }
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Мин. запас, %', `<input type="number" id="pp-marginMin" min="0" max="50" step="1" value="${n.marginMinPct ?? 2}">`) + '</div>');
    h.push('<div style="flex:1">' + field('Макс. запас, %', `<input type="number" id="pp-marginMax" min="5" max="500" step="1" value="${n.marginMaxPct ?? 30}">`) + '</div>');
    h.push('</div>');

    // Система заземления для линий, ВЫХОДЯЩИХ из этого щита.
    // Доступны: наследование от глобальной + все варианты IEC 60364-4-41.
    // Дополнительно — tri-state флаги N/PE для нюансов перехода.
    {
      const eo = n.earthingOut || '';
      h.push(field('Система заземления на выходе', `
        <select id="pp-earthingOut">
          <option value=""${eo === '' ? ' selected' : ''}>(по умолчанию — глобальная)</option>
          <option value="TN-S"${eo === 'TN-S' ? ' selected' : ''}>TN-S (3L+N+PE)</option>
          <option value="TN-C"${eo === 'TN-C' ? ' selected' : ''}>TN-C (3L+PEN)</option>
          <option value="TN-C-S"${eo === 'TN-C-S' ? ' selected' : ''}>TN-C-S (разделение PE на этом щите)</option>
          <option value="TT"${eo === 'TT' ? ' selected' : ''}>TT (3L+N+PE, локальный PE)</option>
          <option value="IT-N"${eo === 'IT-N' ? ' selected' : ''}>IT с нейтралью (3L+N+PE)</option>
          <option value="IT"${eo === 'IT' ? ' selected' : ''}>IT без нейтрали (3L+PE)</option>
        </select>`));
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Система заземления определяет дефолтные флаги N/PE для всех кабелей, выходящих из щита. Потребитель может переопределить индивидуально.</div>');
    }
  }

  // Режимы переключения для несекционных щитов
  {
    const multiInput = (n.inputs || 0) > 1;

    if (multiInput && !isSectioned) {

      const hasAVR = sm !== 'parallel';

      if (hasAVR) {
        // Приоритеты — только для стандартного АВР (auto)
        if (sm === 'auto') {
          h.push('<h4 style="margin:12px 0 8px">Приоритеты входов</h4>');
          h.push('<div class="muted" style="font-size:10px;margin-bottom:6px">1 = высший. Равные = параллельная работа.</div>');
          h.push('<div style="display:flex;gap:8px;flex-wrap:wrap">');
          for (let i = 0; i < (n.inputs || 0); i++) {
            const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
            let feederTag = `Вх${i + 1}`;
            for (const c of state.conns.values()) {
              if (c.to.nodeId === n.id && c.to.port === i) {
                const from = state.nodes.get(c.from.nodeId);
                if (from) feederTag = effectiveTag(from) || from.name || feederTag;
                break;
              }
            }
            h.push(`<div style="text-align:center"><div style="font-size:9px;color:#666;margin-bottom:2px">${escHtml(feederTag)}</div><input type="number" id="pp-prio-${i}" min="1" max="20" step="1" value="${prio}" style="width:44px;text-align:center;font-size:12px"></div>`);
          }
          h.push('</div>');
        }

        // (секционный щит реализован как отдельные panel nodes — см. блок isSectioned ниже)

        // Задержки — для всех АВР
        h.push('<h4 style="margin:12px 0 8px">Задержки</h4>');
        h.push('<div style="display:flex;gap:12px">');
        h.push('<div style="flex:1">' + field('Переключение, сек', `<input type="number" id="pp-avrDelay" min="0" max="30" step="0.5" value="${n.avrDelaySec ?? 2}">`) + '</div>');
        h.push('<div style="flex:1">' + field('Разбежка, сек', `<input type="number" id="pp-avrInterlock" min="0" max="10" step="0.5" value="${n.avrInterlockSec ?? 1}">`) + '</div>');
        h.push('</div>');
      } // end hasAVR
    } // end multiInput
  }

  // === Многосекционный щит — секции как отдельные panel-узлы ===
  if (isSectioned) {
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    const ties = Array.isArray(n.busTies) ? n.busTies : [];

    h.push('<h4 style="margin:12px 0 8px">Секции</h4>');
    h.push(`<div class="muted" style="font-size:10px;margin-bottom:8px">Каждая секция — отдельный щит. Клик по секции открывает параметры.</div>`);

    for (let si = 0; si < secIds.length; si++) {
      const secNode = state.nodes.get(secIds[si]);
      if (!secNode) continue;
      const secName = secNode.name || `Секция ${si + 1}`;
      const secTag = effectiveTag(secNode) || secNode.tag || '';
      const secSm = secNode.switchMode || 'parallel';
      const smLabel = secSm === 'auto' ? 'АВР' : 'Щит';
      // Проверяем подключения
      let hasConns = false;
      for (const c of state.conns.values()) {
        if (c.to.nodeId === secNode.id || c.from.nodeId === secNode.id) { hasConns = true; break; }
      }

      h.push(`<div style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:6px">`);
      h.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">`);
      h.push(`<span style="font-size:12px;font-weight:600">${escHtml(secName)}</span>`);
      h.push(`<span style="font-size:10px;color:#999">${secTag} · ${smLabel} · In ${secNode.capacityA || 0}А · вх${secNode.inputs} вых${secNode.outputs}</span>`);
      h.push(`<button type="button" data-sec-open="${secIds[si]}" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:4px;cursor:pointer">⚙ Параметры</button>`);
      h.push('</div>');
      if (secIds.length > 1 && !hasConns) {
        h.push(`<button type="button" data-sec-delete="${si}" style="font-size:10px;padding:2px 6px;border:1px solid #ef9a9a;background:#fff;border-radius:3px;cursor:pointer;color:#c62828">✕ Удалить</button>`);
      } else if (secIds.length > 1 && hasConns) {
        h.push(`<span class="muted" style="font-size:10px">Нельзя удалить — есть линии</span>`);
      }
      h.push('</div>');

      // СВ между секциями
      if (si < secIds.length - 1) {
        const tieIdx = ties.findIndex(t => (t.between[0] === si && t.between[1] === si + 1) || (t.between[0] === si + 1 && t.between[1] === si));
        h.push(`<div style="text-align:center;margin:4px 0;padding:6px;background:#f0f0f0;border-radius:4px">`);
        if (tieIdx >= 0) {
          const tie = ties[tieIdx];
          h.push(`<div style="font-size:11px;font-weight:600;margin-bottom:4px">СВ${tieIdx + 1}</div>`);
          h.push('<div style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap">');
          h.push(`<select data-tie-mode="${tieIdx}" style="font-size:11px;padding:3px 8px;border:1px solid #ccc;border-radius:3px">`);
          h.push(`<option value="auto"${tie.auto ? ' selected' : ''}>Авто</option>`);
          h.push(`<option value="manual"${!tie.auto ? ' selected' : ''}>Ручной</option></select>`);
          if (tie.auto) {
            h.push(`<label style="font-size:10px;color:#666">Ts</label><input type="number" data-tie-delay="${tieIdx}" min="0" max="30" step="0.5" value="${tie.delaySec ?? 2}" style="width:50px;font-size:11px;padding:3px">`);
            h.push(`<label style="font-size:10px;color:#666">Tr</label><input type="number" data-tie-interlock="${tieIdx}" min="0" max="10" step="0.5" value="${tie.interlockSec ?? 1}" style="width:50px;font-size:11px;padding:3px">`);
          }
          h.push(`<button type="button" data-tie-remove="${tieIdx}" style="font-size:11px;padding:3px 6px;border:1px solid #ef9a9a;background:#fff;border-radius:3px;cursor:pointer;color:#c62828">✕</button>`);
          h.push('</div>');
        } else {
          const nextSec = state.nodes.get(secIds[si + 1]);
          h.push(`<button type="button" data-tie-add="${si}" style="font-size:11px;padding:4px 12px;border:1px dashed #999;background:#fff;border-radius:4px;cursor:pointer">+ СВ</button>`);
        }
        h.push('</div>');
      }
    }
    h.push(`<button type="button" id="pp-addSection" style="width:100%;font-size:11px;padding:6px;border:1px dashed #999;background:#f9f9f9;border-radius:4px;cursor:pointer;margin-top:8px">+ Добавить секцию</button>`);
  }

  body.innerHTML = h.join('');

  // Монтируем каскадный пикер щитов (если справочник не пуст)
  try {
    const panelCatalog = listPanels();
    const pickerMount = document.getElementById('pp-cat-picker-mount');
    if (panelCatalog.length && pickerMount) {
      mountPanelPicker(pickerMount, {
        list: panelCatalog,
        selectedId: n.panelCatalogId || null,
        currentSupplier: n._panelSelSupplier || '',
        currentSeries: n._panelSelSeries || '',
        placeholders: { supplier: '— не выбрано —', series: '— не выбрано —', model: '— свой состав —' },
        labels: { supplier: 'Производитель', series: 'Серия', model: 'Типоразмер' },
        idPrefix: 'pp-cat',
        onChange: (st) => {
          n._panelSelSupplier = st.supplier || null;
          n._panelSelSeries = st.series || null;
          if (st.modelId && st.panel && st.modelId !== n.panelCatalogId) {
            snapshot('panel-params:' + n.id + ':catalog');
            applyPanelModel(n, st.panel);
            render(); notifyChange();
            openPanelParamsModal(n);
          } else if (!st.modelId && n.panelCatalogId) {
            n.panelCatalogId = null;
            openPanelParamsModal(n);
          }
        },
      });
    }
  } catch (e) { /* опционально */ }

  // Live: переключение типа АВР сразу применяется
  const smSel = document.getElementById('pp-switchMode');
  if (smSel) {
    smSel.addEventListener('change', () => {
      snapshot('switchMode:' + n.id);
      n.switchMode = smSel.value;
      // При переходе на sectioned — автосоздание первой секции
      if (smSel.value === 'sectioned' && (!n.sectionIds || !n.sectionIds.length)) {
        const secId = uid();
        const secNode = {
          id: secId, type: 'panel',
          x: n.x, y: n.y,
          ...DEFAULTS.panel(),
          name: 'Секция 1',
          inputs: n.inputs || 1, outputs: n.outputs || 4,
          switchMode: (n.inputs || 1) > 1 ? 'auto' : 'parallel',
          capacityA: n.capacityA || 160,
          priorities: n.priorities ? [...n.priorities] : [1],
          parentSectionedId: n.id,
        };
        secNode.tag = 'P1';
        state.nodes.set(secId, secNode);
        n.sectionIds = [secId];
        n.busTies = [];
        n.inputs = 0; n.outputs = 0;
      }
      render(); renderInspector(); notifyChange();
      openPanelParamsModal(n);
    });
  }

  // Обработчики секционного щита
  if (n.switchMode === 'sectioned') {
    // Открыть параметры секции
    body.querySelectorAll('[data-sec-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const secId = btn.dataset.secOpen;
        const secNode = state.nodes.get(secId);
        if (secNode) {
          document.getElementById('modal-panel-params').classList.add('hidden');
          openPanelParamsModal(secNode);
        }
      });
    });
    // Добавить секцию — создаёт отдельный panel node
    const addSecBtn = document.getElementById('pp-addSection');
    if (addSecBtn) addSecBtn.addEventListener('click', () => {
      snapshot('addSection:' + n.id);
      if (!Array.isArray(n.sectionIds)) n.sectionIds = [];
      const secId = uid();
      const secNum = n.sectionIds.length + 1;
      // Позиция: правее последней секции
      let sx = n.x || 0, sy = n.y || 0;
      if (n.sectionIds.length > 0) {
        const lastSec = state.nodes.get(n.sectionIds[n.sectionIds.length - 1]);
        if (lastSec) { sx = lastSec.x + nodeWidth(lastSec) + 40; sy = lastSec.y; }
      }
      const secNode = {
        id: secId, type: 'panel',
        x: sx, y: sy,
        ...DEFAULTS.panel(),
        name: `Секция ${secNum}`,
        inputs: 1, outputs: 4,
        switchMode: 'parallel',
        capacityA: 160,
        parentSectionedId: n.id,
      };
      secNode.tag = `P${n.sectionIds.length + 1}`;
      state.nodes.set(secId, secNode);
      n.sectionIds.push(secId);
      render(); notifyChange();
      openPanelParamsModal(n);
    });
    // Удалить секцию
    body.querySelectorAll('[data-sec-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = Number(btn.dataset.secDelete);
        const secId = n.sectionIds[si];
        if (!secId) return;
        snapshot('delSection:' + n.id);
        // Удалить связи секции
        for (const c of Array.from(state.conns.values())) {
          if (c.from.nodeId === secId || c.to.nodeId === secId) state.conns.delete(c.id);
        }
        state.nodes.delete(secId);
        n.sectionIds.splice(si, 1);
        // Удалить СВ ссылающиеся на эту секцию
        n.busTies = (n.busTies || []).filter(t => t.between[0] !== si && t.between[1] !== si)
          .map(t => ({ ...t, between: t.between.map(i => i > si ? i - 1 : i) }));
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Добавить СВ
    body.querySelectorAll('[data-tie-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = Number(btn.dataset.tieAdd);
        snapshot('addTie:' + n.id);
        if (!Array.isArray(n.busTies)) n.busTies = [];
        n.busTies.push({ between: [si, si + 1], closed: false, auto: true });
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Удалить СВ
    body.querySelectorAll('[data-tie-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = Number(btn.dataset.tieRemove);
        snapshot('delTie:' + n.id);
        n.busTies.splice(ti, 1);
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Режим СВ
    body.querySelectorAll('[data-tie-mode]').forEach(sel => {
      sel.addEventListener('change', () => {
        const ti = Number(sel.dataset.tieMode);
        n.busTies[ti].auto = sel.value === 'auto';
        notifyChange();
      });
    });
  }

  const applyBtn = document.getElementById('panel-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('panel-params:' + n.id);
    // Обозначение
    const ppTag = document.getElementById('pp-tag')?.value?.trim();
    if (ppTag && ppTag !== n.tag) {
      if (isTagUnique(ppTag, n.id)) {
        n.tag = ppTag;
      } else {
        flash(`Обозначение «${ppTag}» уже занято`, 'error');
        return;
      }
    }
    const ppName = document.getElementById('pp-name')?.value?.trim();
    if (ppName) n.name = ppName;
    const curSm = document.getElementById('pp-switchMode')?.value || n.switchMode;
    if (curSm !== 'sectioned') n.inputs = Number(document.getElementById('pp-inputs')?.value) || 1;
    else { n.inputs = 0; n.outputs = 0; }
    n.outputs = Number(document.getElementById('pp-outputs')?.value) || 1;
    n.kSim = Number(document.getElementById('pp-kSim')?.value) ?? 1;
    n.capacityA = Number(document.getElementById('pp-capacityA')?.value) || 160;
    n.marginMinPct = Number(document.getElementById('pp-marginMin')?.value) || 2;
    n.marginMaxPct = Number(document.getElementById('pp-marginMax')?.value) || 30;
    // Система заземления на выходе щита (пусто = наследовать глобальную)
    const eoVal = document.getElementById('pp-earthingOut')?.value;
    if (eoVal === '' || eoVal == null) delete n.earthingOut;
    else n.earthingOut = eoVal;
    const smSel = document.getElementById('pp-switchMode');
    if (smSel) n.switchMode = smSel.value;
    n.avrDelaySec = Number(document.getElementById('pp-avrDelay')?.value) ?? 2;
    n.avrInterlockSec = Number(document.getElementById('pp-avrInterlock')?.value) ?? 1;
    // Приоритеты
    if (!Array.isArray(n.priorities)) n.priorities = [];
    for (let i = 0; i < n.inputs; i++) {
      const el = document.getElementById(`pp-prio-${i}`);
      if (el) n.priorities[i] = Number(el.value) || (i + 1);
    }
    while (n.priorities.length < n.inputs) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = n.inputs;
    // Многосекционный щит: сохранить задержки СВ
    if (n.switchMode === 'sectioned') {
      n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
      // Сохранить задержки СВ
      if (Array.isArray(n.busTies)) {
        for (let ti = 0; ti < n.busTies.length; ti++) {
          const dEl = body.querySelector(`[data-tie-delay="${ti}"]`);
          if (dEl) n.busTies[ti].delaySec = Number(dEl.value) ?? 2;
          const iEl = body.querySelector(`[data-tie-interlock="${ti}"]`);
          if (iEl) n.busTies[ti].interlockSec = Number(iEl.value) ?? 1;
        }
      }
    }
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-panel-params').classList.add('hidden');
      return;
    }
    render(); renderInspector(); notifyChange();
    openPanelParamsModal(n);
    flash('Параметры щита обновлены');
  };

  document.getElementById('modal-panel-params').classList.remove('hidden');
}


function svgBreaker(x, topY, on, color, offColor) {
  const h = 30;
  const col = on ? color : (offColor || '#bbb');
  let s = '';

  // Верхняя точка подключения (неподвижный контакт)
  const topPt = topY;
  // Крестик механизма — в верхней трети
  const crossY = topY + 7;
  // Ось вращения контакта — внизу
  const pivotY = topY + h;

  // Верхняя вертикальная линия (от верхней точки до крестика)
  s += `<line x1="${x}" y1="${topPt}" x2="${x}" y2="${crossY - 4}" stroke="${col}" stroke-width="2"/>`;

  // Крестик механизма (всегда сверху)
  s += `<line x1="${x - 4}" y1="${crossY - 4}" x2="${x + 4}" y2="${crossY + 4}" stroke="${col}" stroke-width="1.5"/>`;
  s += `<line x1="${x + 4}" y1="${crossY - 4}" x2="${x - 4}" y2="${crossY + 4}" stroke="${col}" stroke-width="1.5"/>`;

  if (on) {
    // Замкнут: контакт вертикален — от крестика вниз до оси
    s += `<line x1="${x}" y1="${crossY + 4}" x2="${x}" y2="${pivotY}" stroke="${col}" stroke-width="2.5"/>`;
  } else {
    // Разомкнут: контакт отклонён от оси (снизу) влево вверх ~30°
    // Ось вращения = pivotY, контакт идёт от pivotY вверх-влево
    const contactLen = pivotY - crossY - 4;
    const angle = 30 * Math.PI / 180; // 30 градусов
    const tipX = x - Math.sin(angle) * contactLen;
    const tipY = pivotY - Math.cos(angle) * contactLen;
    s += `<line x1="${x}" y1="${pivotY}" x2="${tipX}" y2="${tipY}" stroke="${offColor || '#ff9800'}" stroke-width="2.5"/>`;
  }

  // Нижняя точка (ось вращения)
  s += `<circle cx="${x}" cy="${pivotY}" r="2.5" fill="${col}"/>`;
  // Верхняя точка
  s += `<circle cx="${x}" cy="${topPt}" r="2" fill="${col}"/>`;

  return { svg: s, height: h };
}


function _renderSectionedPanelControl(n, body) {
  const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
  const busTies = Array.isArray(n.busTies) ? n.busTies : [];
  if (!secIds.length) {
    body.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Секции не настроены. Откройте «Параметры щита» и добавьте секции.</div>';
    document.getElementById('modal-panel-control').classList.remove('hidden');
    return;
  }
  // Собираем section nodes
  const sections = secIds.map(id => state.nodes.get(id)).filter(Boolean);
  if (!sections.length) {
    body.innerHTML = '<div class="muted" style="padding:20px">Секции не найдены.</div>';
    document.getElementById('modal-panel-control').classList.remove('hidden');
    return;
  }
  const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : busTies.map(t => !!t.closed);
  if (!Array.isArray(n._busTieStates)) n._busTieStates = tieStates;

  // Размеры — ширина секции пропорциональна количеству выходов/входов (как у простого щита)
  const portGap = 40; // расстояние между портами
  const secWidths = sections.map(sec => {
    const pins = Math.max(sec.inputs || 1, sec.outputs || 1, 2);
    return pins * portGap + 40;
  });
  const tieW = 60;  // промежуток для СВ
  const totalW = secWidths.reduce((s, w) => s + w, 0) + (sections.length - 1) * tieW + 40;
  const brkH = 28;
  const inBrkY = 30;
  const busY = inBrkY + brkH + 20;
  const outBrkY = busY + 20;
  const maxOuts = Math.max(...sections.map(s => s.outputs || 1), 1);
  const svgH = outBrkY + brkH + 20 + maxOuts * 14;

  // Определяем питание секций: секция запитана если _powered И хотя бы один вводной автомат включён
  const sectionPowered = new Array(sections.length).fill(false);
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    if (!sec._powered) continue;
    // Проверяем что хотя бы один вводной автомат включён
    const inBrk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
    let hasClosedBreaker = false;
    for (let i = 0; i < (sec.inputs || 1); i++) {
      if (inBrk[i] !== false) { hasClosedBreaker = true; break; }
    }
    // Или питание через виртуальную связь (СВ) — тоже считаем
    if (hasClosedBreaker) {
      sectionPowered[si] = true;
    } else {
      // Может быть запитана через СВ
      for (const c of state.conns.values()) {
        if (c._virtual && c.to.nodeId === sec.id && (c._state === 'active' || c._state === 'powered')) {
          sectionPowered[si] = true;
          break;
        }
      }
    }
  }
  // BFS: через замкнутые СВ определяем какие секции запитаны
  const sectionFed = new Array(sections.length).fill(false);
  for (let si = 0; si < sections.length; si++) {
    if (!sectionPowered[si]) continue;
    // BFS от запитанной секции через замкнутые СВ
    const queue = [si];
    const visited = new Set();
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      sectionFed[cur] = true;
      for (let ti = 0; ti < busTies.length; ti++) {
        if (!tieStates[ti]) continue;
        const [a, b] = busTies[ti].between;
        if (a === cur && !visited.has(b)) queue.push(b);
        if (b === cur && !visited.has(a)) queue.push(a);
      }
    }
  }

  let h = '';
  h += `<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`;
  h += `<div class="muted" style="font-size:11px;margin-bottom:8px">Многосекционный щит · ${sections.length} секций · ${busTies.length} СВ</div>`;
  h += `<div id="pc-svg-wrap" style="display:flex;justify-content:center;align-items:flex-start;overflow:auto;flex:1">`;
  h += `<svg id="pc-svg" width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}" style="font-family:sans-serif;font-size:10px">`;

  // Вычисляем X-позиции начала каждой секции
  const secStartX = [];
  let cx = 20;
  for (let si = 0; si < sections.length; si++) {
    secStartX.push(cx);
    cx += secWidths[si];
    if (si < sections.length - 1) cx += tieW;
  }

  // Рисуем каждую секцию (стиль идентичен простому щиту)
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const secW = secWidths[si];
    const sx = secStartX[si];
    const fed = sectionFed[si];
    const hasPower = sectionPowered[si];
    const busCol = fed ? '#e53935' : '#bbb';

    // Подпись секции
    const secLabel = sec.name || `Секция ${si + 1}`;
    h += `<text x="${sx + secW / 2}" y="${svgH - 4}" text-anchor="middle" fill="#999" font-size="9">${escHtml(secLabel)}</text>`;
    // Нагрузка секции
    let secLoadKw = 0;
    for (const cc of state.conns.values()) {
      if (cc.from.nodeId === sec.id && cc._loadKw) secLoadKw += cc._loadKw;
    }
    const capA = sec.capacityA || 0;
    const maxA = sec._maxLoadA || 0;
    if (capA) h += `<text x="${sx + 4}" y="${busY - 14}" text-anchor="start" fill="${fed ? '#333' : '#999'}" font-size="8">In ${capA}А</text>`;
    if (maxA) h += `<text x="${sx + 4}" y="${busY - 5}" text-anchor="start" fill="${fed ? '#333' : '#999'}" font-size="8">Макс: ${fmt(maxA)}А</text>`;
    // Шина секции
    h += `<rect x="${sx}" y="${busY - 2}" width="${secW}" height="4" fill="${busCol}" rx="1"/>`;

    // Входы секции (стиль как у простого щита)
    const inCount = sec.inputs || 1;
    for (let ii = 0; ii < inCount; ii++) {
      const port = ii;
      const ix = sx + 20 + (ii + 0.5) * ((secW - 40) / Math.max(inCount, 1));
      // Подпись источника
      let feederTag = `Вх${port + 1}`;
      for (const c of state.conns.values()) {
        if (c.to.nodeId === sec.id && c.to.port === port && !c._virtual) {
          const from = state.nodes.get(c.from.nodeId);
          if (from) feederTag = effectiveTag(from) || from.name || feederTag;
          break;
        }
      }
      h += `<text x="${ix}" y="12" text-anchor="middle" fill="#333" font-size="9" font-weight="600">${escHtml(feederTag)}</text>`;
      // Линия сверху → автомат
      const inBrk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
      const brkOn = inBrk[port] !== false;
      const lineAlive = hasPower;
      const topColor = lineAlive ? '#e53935' : '#bbb';
      const throughColor = lineAlive && brkOn ? '#e53935' : '#bbb';
      h += `<line x1="${ix}" y1="16" x2="${ix}" y2="${inBrkY}" stroke="${topColor}" stroke-width="2"/>`;
      // Лампочка (идентична простому щиту)
      const lampY = 22;
      if (lineAlive && brkOn) {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="#43a047" opacity="0.8"/>`;
      } else if (lineAlive) {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="#e53935" opacity="0.8"/>`;
      } else {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="none" stroke="#ccc" stroke-width="1"/>`;
      }
      // Автомат IEC
      const brk = svgBreaker(ix, inBrkY, brkOn, throughColor, '#ff9800');
      h += brk.svg;
      // Линия от автомата до шины
      h += `<line x1="${ix}" y1="${inBrkY + brkH}" x2="${ix}" y2="${busY - 2}" stroke="${throughColor}" stroke-width="2"/>`;
      // Приоритет
      const prio = (sec.priorities && sec.priorities[ii]) ?? (ii + 1);
      h += `<text x="${ix + 12}" y="${inBrkY + brkH / 2 + 3}" fill="#1976d2" font-size="8">P${prio}</text>`;
      // Клик-зона
      h += `<rect x="${ix - 14}" y="${inBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-sec-in-toggle="${si}:${port}"/>`;
    }

    // Выходы секции (стиль как у простого щита)
    const outCount = sec.outputs || 1;
    for (let oi = 0; oi < outCount; oi++) {
      const port = oi;
      const ox = sx + 20 + (oi + 0.5) * ((secW - 40) / Math.max(outCount, 1));
      const outBrk = Array.isArray(sec.breakerStates) ? sec.breakerStates : [];
      const outOn = outBrk[port] !== false;
      const powered = fed && outOn;
      const lineCol = powered ? '#e53935' : '#bbb';
      // Линия шина → автомат
      h += `<line x1="${ox}" y1="${busY + 2}" x2="${ox}" y2="${outBrkY}" stroke="${busCol}" stroke-width="2"/>`;
      const brk = svgBreaker(ox, outBrkY, outOn, lineCol, '#ff9800');
      h += brk.svg;

      // Номинал автомата (как у простого щита — с _breakerCount и кривой)
      let brkLabel = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === sec.id && cc.from.port === port) {
          if (cc._breakerIn) {
            const cnt = cc._breakerCount || 1;
            if (cnt > 1 && cc._breakerPerLine) brkLabel = `${cnt}×${cc._breakerPerLine}А`;
            else brkLabel = `${cc._breakerIn}А`;
          } else if (cc._breakerPerLine) {
            const cnt = cc._breakerCount || 1;
            brkLabel = cnt > 1 ? `${cnt}×${cc._breakerPerLine}А` : `${cc._breakerPerLine}А`;
          }
          break;
        }
      }
      if (brkLabel) {
        h += `<text x="${ox - 12}" y="${outBrkY + brkH / 2}" fill="#ef6c00" font-size="8" font-weight="600" text-anchor="end" dominant-baseline="central">${brkLabel}</text>`;
      }
      // Линия от автомата вниз
      h += `<line x1="${ox}" y1="${outBrkY + brkH}" x2="${ox}" y2="${outBrkY + brkH + 14}" stroke="${lineCol}" stroke-width="2"/>`;
      // Метка назначения (как у простого щита)
      let outLabel = '';
      let labelColor = '#333';
      let hasConn = false;
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === sec.id && cc.from.port === port && !cc._virtual) {
          hasConn = true;
          const to = state.nodes.get(cc.to.nodeId);
          outLabel = to ? (effectiveTag(to) || to.name || '') : '';
          outLabel += `-${cc.to.port + 1}`;
          break;
        }
      }
      if (!hasConn) { outLabel = 'Резерв'; labelColor = '#bbb'; }
      const labelY = outBrkY + brkH + 16;
      h += `<text x="${ox}" y="${labelY}" fill="${labelColor}" font-size="9" font-weight="600" text-anchor="end" dominant-baseline="central" transform="rotate(-90 ${ox} ${labelY})">${escHtml(outLabel)}</text>`;
      // Клик-зона
      h += `<rect x="${ox - 14}" y="${outBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-sec-out-toggle="${si}:${port}"/>`;
    }
  }

  // Рисуем СВ между секциями
  for (let ti = 0; ti < busTies.length; ti++) {
    const tie = busTies[ti];
    const [secA, secB] = tie.between;
    const tieOn = tieStates[ti];
    // X позиция: между секциями secA и secB
    const xA = secStartX[secA] + secWidths[secA];
    const xB = secStartX[secB];
    const mx = (xA + xB) / 2;

    const col = tieOn ? '#e53935' : '#bbb';
    // Горизонтальные линии от шин к СВ
    h += `<line x1="${xA}" y1="${busY}" x2="${mx - 10}" y2="${busY}" stroke="${col}" stroke-width="2"/>`;
    h += `<line x1="${mx + 10}" y1="${busY}" x2="${xB}" y2="${busY}" stroke="${col}" stroke-width="2"/>`;

    // СВ символ (горизонтальный автомат)
    if (tieOn) {
      h += `<line x1="${mx - 10}" y1="${busY}" x2="${mx + 10}" y2="${busY}" stroke="${col}" stroke-width="3"/>`;
    } else {
      h += `<line x1="${mx - 10}" y1="${busY}" x2="${mx + 4}" y2="${busY - 10}" stroke="${col}" stroke-width="2.5"/>`;
    }
    // Крестик
    h += `<line x1="${mx - 3}" y1="${busY - 4}" x2="${mx + 3}" y2="${busY + 4}" stroke="${col}" stroke-width="1.5"/>`;
    h += `<line x1="${mx + 3}" y1="${busY - 4}" x2="${mx - 3}" y2="${busY + 4}" stroke="${col}" stroke-width="1.5"/>`;

    // Подпись
    h += `<text x="${mx}" y="${busY - 14}" text-anchor="middle" fill="${tie.auto ? '#1976d2' : '#666'}" font-size="8">${tie.auto ? 'авто' : 'ручн.'}</text>`;
    h += `<text x="${mx}" y="${busY + 24}" text-anchor="middle" fill="#666" font-size="8">СВ${ti + 1}</text>`;

    // Клик-зона
    h += `<rect x="${mx - 16}" y="${busY - 16}" width="32" height="32" fill="transparent" style="cursor:pointer" data-sec-tie-toggle="${ti}"/>`;
  }

  h += '</svg></div>';

  // Настройки выносим в отдельную панель (pc-settings-panel)
  let sh = '';

  // Переключатели Авто/Ручной для каждого СВ + таймеры
  if (busTies.length) {
    sh += '<div>';
    for (let ti = 0; ti < busTies.length; ti++) {
      const tie = busTies[ti];
      const isAuto = !!tie.auto;
      sh += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">';
      sh += `<span style="font-size:11px;font-weight:600;color:#666;min-width:36px">СВ${ti + 1}:</span>`;
      sh += `<span style="font-size:11px;color:${isAuto ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh += `<div data-tie-auto-toggle="${ti}" style="position:relative;width:44px;height:22px;border-radius:11px;background:${isAuto ? '#4caf50' : '#ff9800'};cursor:pointer;flex-shrink:0">`;
      sh += `<div style="position:absolute;top:2px;${isAuto ? 'left:2px' : 'right:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh += '</div>';
      sh += `<span style="font-size:11px;color:${!isAuto ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh += '</div>';
      const swCd = Array.isArray(n._busTieSwitchCountdown) ? (n._busTieSwitchCountdown[ti] || 0) : 0;
      const ilCd = Array.isArray(n._busTieInterlockCountdown) ? (n._busTieInterlockCountdown[ti] || 0) : 0;
      const swStarted = Array.isArray(n._busTieSwitchStartedAt) ? (n._busTieSwitchStartedAt[ti] || 0) : 0;
      const swElapsed = swStarted > 0 ? (Date.now() - swStarted) / 1000 : 0;
      if (swCd > 0 && swElapsed > 0.5) {
        sh += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">СВ${ti + 1}: задержка ${Math.ceil(swCd)} с</div>`;
      } else if (ilCd > 0) {
        sh += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">СВ${ti + 1}: разбежка ${Math.ceil(ilCd)} с</div>`;
      }
    }
    sh += '</div>';
  }
  // АВР для секций с несколькими вводами
  const avrSections = sections.filter(s => (s.inputs || 1) > 1);
  if (avrSections.length) {
    sh += '<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px">';
    sh += '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:4px">АВР секций:</div>';
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      if ((sec.inputs || 1) <= 1) continue;
      const manualNow = sec.switchMode === 'manual';
      const secLabel = sec.name || `Секция ${si + 1}`;
      sh += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0">';
      sh += `<span style="font-size:11px;font-weight:600;color:#666;min-width:70px">${escHtml(secLabel)}:</span>`;
      sh += `<span style="font-size:11px;color:${!manualNow ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh += `<div data-sec-avr-toggle="${si}" style="position:relative;width:44px;height:22px;border-radius:11px;background:${manualNow ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`;
      sh += `<div style="position:absolute;top:2px;${manualNow ? 'right:2px' : 'left:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh += '</div>';
      sh += `<span style="font-size:11px;color:${manualNow ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh += '</div>';
      if (sec._avrSwitchCountdown > 0) {
        sh += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">${escHtml(secLabel)}: задержка ${Math.ceil(sec._avrSwitchCountdown)} с</div>`;
      } else if (sec._avrInterlockCountdown > 0) {
        sh += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">${escHtml(secLabel)}: разбежка ${Math.ceil(sec._avrInterlockCountdown)} с</div>`;
      }
    }
    sh += '</div>';
  }
  // Приоритет ввода для каждой секции
  const hasAutoTie = busTies.some(t => t.auto);
  if (hasAutoTie) {
    sh += '<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px">';
    sh += '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:4px">Приоритет:</div>';
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const secLabel = sec.name || `Секция ${si + 1}`;
      const prio = sec.sectionInputPriority || 'input';
      sh += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0">';
      sh += `<span style="font-size:11px;color:#666;min-width:70px">${escHtml(secLabel)}:</span>`;
      sh += `<button type="button" data-sec-priority="${si}:input" style="padding:2px 8px;border:1px solid ${prio === 'input' ? '#1976d2' : '#ccc'};background:${prio === 'input' ? '#1976d2' : '#fff'};color:${prio === 'input' ? '#fff' : '#333'};border-radius:3px;cursor:pointer;font-size:10px">Ввод</button>`;
      sh += `<button type="button" data-sec-priority="${si}:tie" style="padding:2px 8px;border:1px solid ${prio === 'tie' ? '#1976d2' : '#ccc'};background:${prio === 'tie' ? '#1976d2' : '#fff'};color:${prio === 'tie' ? '#fff' : '#333'};border-radius:3px;cursor:pointer;font-size:10px">СВ</button>`;
      sh += '</div>';
    }
    sh += '</div>';
  }

  body.innerHTML = h;

  // Записываем настройки в нижнюю панель с кнопкой сворачивания
  const settingsPanel = document.getElementById('pc-settings-panel');
  if (settingsPanel && sh) {
    settingsPanel.innerHTML =
      `<div style="width:280px;border:1px solid #d0d0d0;border-radius:8px;background:rgba(255,255,255,0.92);backdrop-filter:blur(6px);box-shadow:0 2px 12px rgba(0,0,0,0.1)">` +
      `<div id="pc-settings-toggle" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;user-select:none">` +
      `<span style="font-size:12px;font-weight:700;color:#444">⚙ Настройки</span>` +
      `<span style="font-size:12px;color:#999" id="pc-settings-arrow">▲</span></div>` +
      `<div id="pc-settings-content" style="padding:4px 12px 10px;border-top:1px solid #eee">${sh}</div></div>`;
    const toggle = document.getElementById('pc-settings-toggle');
    const content = document.getElementById('pc-settings-content');
    const arrow = document.getElementById('pc-settings-arrow');
    if (toggle && content) {
      toggle.onclick = () => {
        const hidden = content.style.display === 'none';
        content.style.display = hidden ? '' : 'none';
        if (arrow) arrow.textContent = hidden ? '▲' : '▼';
      };
    }
  } else if (settingsPanel) {
    settingsPanel.innerHTML = '';
  }

  // Зум
  {
    let pcZoom = _pcZoomState.zoom;
    const pcSvg = document.getElementById('pc-svg');
    const pcLabel = document.getElementById('pc-zoom-label');
    const pcWrap = document.getElementById('pc-svg-wrap');
    const applyZoom = () => {
      if (pcSvg) { pcSvg.style.width = (totalW * pcZoom) + 'px'; pcSvg.style.height = (svgH * pcZoom) + 'px'; }
      if (pcLabel) pcLabel.textContent = Math.round(pcZoom * 100) + '%';
      _pcZoomState.zoom = pcZoom;
    };
    applyZoom();
    const zIn = document.getElementById('pc-zoom-in');
    const zOut = document.getElementById('pc-zoom-out');
    if (zIn) zIn.onclick = () => { pcZoom = Math.min(3, pcZoom * 1.25); applyZoom(); };
    if (zOut) zOut.onclick = () => { pcZoom = Math.max(0.3, pcZoom / 1.25); applyZoom(); };
  }

  // Fullscreen
  const fsBtn = document.getElementById('pc-fullscreen');
  const modalBox = body.closest('.modal-box');
  if (fsBtn && modalBox) {
    if (_pcZoomState.fullscreen) { modalBox.classList.add('modal-fullscreen'); fsBtn.textContent = '⤡'; }
    fsBtn.onclick = () => { modalBox.classList.toggle('modal-fullscreen'); _pcZoomState.fullscreen = modalBox.classList.contains('modal-fullscreen'); fsBtn.textContent = _pcZoomState.fullscreen ? '⤡' : '⤢'; };
  }

  // Клик по входным автоматам секций
  body.querySelectorAll('[data-sec-in-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, portStr] = el.dataset.secInToggle.split(':');
      const si = Number(siStr), port = Number(portStr);
      const sec = sections[si];
      if (!sec) return;
      if (!Array.isArray(sec.inputBreakerStates)) sec.inputBreakerStates = new Array(sec.inputs || 0).fill(true);
      while (sec.inputBreakerStates.length < (sec.inputs || 0)) sec.inputBreakerStates.push(true);
      // Блокировка: если секция имеет АВР в авто-режиме
      if ((sec.inputs || 1) > 1 && sec.switchMode !== 'manual' && sec.switchMode !== 'parallel') {
        flash('Вводные автоматы управляются АВР секции. Переключите в ручной режим.', 'error');
        return;
      }
      // Блокировка: если СВ к этой секции в авто-режиме — автоматика управляет вводами
      for (let ti = 0; ti < busTies.length; ti++) {
        const tie = busTies[ti];
        if (!tie.auto) continue;
        const [a, b] = tie.between;
        if (a === si || b === si) {
          flash('Вводные автоматы управляются автоматикой СВ. Переключите СВ в ручной режим.', 'error');
          return;
        }
      }
      const wantOn = !sec.inputBreakerStates[port];
      // Блокировка: при включении автомата — проверить что СВ к смежной секции
      // не соединит два источника
      if (wantOn) {
        for (let ti = 0; ti < busTies.length; ti++) {
          if (!tieStates[ti]) continue; // СВ разомкнут — ОК
          const [a, b] = busTies[ti].between;
          const otherSi = a === si ? b : (b === si ? a : -1);
          if (otherSi < 0) continue;
          const otherSec = sections[otherSi];
          if (!otherSec) continue;
          // Проверяем: есть ли у смежной секции включённые автоматы?
          const otherBrk = Array.isArray(otherSec.inputBreakerStates) ? otherSec.inputBreakerStates : [];
          const otherHasOn = Array.from({length: otherSec.inputs || 1}, (_, i) => otherBrk[i] !== false).some(Boolean);
          if (otherHasOn) {
            flash('Блокировка: СВ замкнут — сначала отключите СВ или вводные автоматы смежной секции!', 'error');
            return;
          }
        }
      }
      snapshot('sec-in:' + sec.id + ':' + port);
      sec.inputBreakerStates[port] = wantOn;
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Клик по выходным автоматам секций
  body.querySelectorAll('[data-sec-out-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, portStr] = el.dataset.secOutToggle.split(':');
      const si = Number(siStr), port = Number(portStr);
      const sec = sections[si];
      if (!sec) return;
      if (!Array.isArray(sec.breakerStates)) sec.breakerStates = new Array(sec.outputs || 0).fill(true);
      while (sec.breakerStates.length < (sec.outputs || 0)) sec.breakerStates.push(true);
      snapshot('sec-out:' + sec.id + ':' + port);
      sec.breakerStates[port] = !sec.breakerStates[port];
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Клик по СВ — с блокировкой
  body.querySelectorAll('[data-sec-tie-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const ti = Number(el.dataset.secTieToggle);
      const tie = busTies[ti];
      if (!tie) return;
      // Блокировка ручного управления в режиме Авто
      if (tie.auto) {
        flash('СВ в автоматическом режиме. Переключите в ручной для управления.', 'error');
        return;
      }
      const wantClose = !tieStates[ti];
      // Блокировка: СВ можно замкнуть только если ВСЕ вводные автоматы
      // хотя бы ОДНОЙ из смежных секций выключены
      if (wantClose) {
        const [siA, siB] = tie.between;
        const secA = sections[siA], secB = sections[siB];
        // Проверяем: все ли вводные автоматы секции выключены?
        const allBrkOff = (sec) => {
          if (!sec) return true;
          const brk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
          for (let i = 0; i < (sec.inputs || 1); i++) {
            if (brk[i] !== false) return false; // автомат включён
          }
          return true; // все выключены
        };
        if (!allBrkOff(secA) && !allBrkOff(secB)) {
          flash('Блокировка: выключите все вводные автоматы одной из секций перед включением СВ!', 'error');
          return;
        }
      }
      snapshot('sec-tie:' + n.id + ':' + ti);
      n._busTieStates[ti] = wantClose;
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Переключатель Авто/Ручной для СВ (в settings panel)
  document.querySelectorAll('[data-tie-auto-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const ti = Number(el.dataset.tieAutoToggle);
      const tie = busTies[ti];
      if (!tie) return;
      snapshot('sec-tie-mode:' + n.id + ':' + ti);
      tie.auto = !tie.auto;
      // Сброс таймеров при переключении режима
      if (Array.isArray(n._busTieSwitchStartedAt)) {
        n._busTieSwitchStartedAt[ti] = 0;
        n._busTieSwitchCountdown[ti] = 0;
        n._busTieInterlockStartedAt[ti] = 0;
        n._busTieInterlockCountdown[ti] = 0;
        n._busTieDisconnected[ti] = false;
      }
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Приоритет ввод/СВ для секций (в settings panel)
  document.querySelectorAll('[data-sec-priority]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, val] = el.dataset.secPriority.split(':');
      const sec = sections[Number(siStr)];
      if (!sec) return;
      snapshot('secPriority:' + sec.id);
      sec.sectionInputPriority = val;
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // АВР секций: Авто/Ручной toggle (в settings panel)
  document.querySelectorAll('[data-sec-avr-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const si = Number(el.dataset.secAvrToggle);
      const sec = sections[si];
      if (!sec) return;
      snapshot('sec-avr:' + sec.id);
      if (sec.switchMode === 'manual') {
        sec.switchMode = sec._prevSwitchMode || 'auto';
        sec.inputBreakerStates = null;
        sec._avrBreakerOverride = null;
        sec._avrActivePort = undefined;
        sec._avrSwitchStartedAt = 0;
        sec._avrDisconnected = false;
      } else {
        sec._prevSwitchMode = sec.switchMode;
        if (Array.isArray(sec._avrBreakerOverride)) {
          sec.inputBreakerStates = [...sec._avrBreakerOverride];
        } else {
          const states = new Array(sec.inputs || 0).fill(false);
          for (const c of state.conns.values()) {
            if (c.to.nodeId === sec.id && c._state === 'active') states[c.to.port] = true;
          }
          sec.inputBreakerStates = states;
        }
        sec.switchMode = 'manual';
      }
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  document.getElementById('modal-panel-control').classList.remove('hidden');
}


export function openPanelControlModal(n) {
  const body = document.getElementById('panel-control-body');
  if (!body) return;

  // Многосекционный щит — отдельный рендер
  if (n.switchMode === 'sectioned') {
    _renderSectionedPanelControl(n, body);
    return;
  }

  const inCount = n.inputs || 0;
  const outCount = n.outputs || 0;
  const isPlainPanel = n.switchMode === 'parallel';
  const isManual = n.switchMode === 'manual' || isPlainPanel;
  const hasAVR = !isPlainPanel;
  const colW = 90;
  const maxCols = Math.max(inCount, outCount, 1);
  const svgW = Math.max(maxCols * colW + 40, 300);
  const inBrkY = 30;   // начало автоматов входов
  const brkH = 28;
  const busY = inBrkY + brkH + 20;
  const outBrkY = busY + 20;
  const svgH = outBrkY + brkH + 80; // увеличено для вертикальных подписей

  // Состояние входов
  // В авто-режиме: АВР определяет какие входы замкнуты (по приоритетам/логике).
  // В ручном/щит: из inputBreakerStates.
  const inputStates = [];
  const inBreakers = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];

  // Определяем какие входы АВР считает активными (по связям active/powered)
  const avrActiveInputs = new Set();
  for (const c of state.conns.values()) {
    if (c.to.nodeId === n.id && (c._state === 'active')) {
      avrActiveInputs.add(c.to.port);
    }
  }

  for (let i = 0; i < inCount; i++) {
    let feederTag = '—', hasPower = false;
    for (const c of state.conns.values()) {
      if (c.to.nodeId === n.id && c.to.port === i) {
        const from = state.nodes.get(c.from.nodeId);
        feederTag = from ? (effectiveTag(from) || from.name || '?') : '?';
        hasPower = c._state === 'active' || c._state === 'powered';
        break;
      }
    }
    let breakerOn;
    if (isManual) {
      // Ручной/Щит: из inputBreakerStates
      breakerOn = inBreakers[i] !== false;
    } else {
      // Авто (АВР): из _avrBreakerOverride (симуляция) или active input
      if (Array.isArray(n._avrBreakerOverride) && typeof n._avrBreakerOverride[i] === 'boolean') {
        breakerOn = n._avrBreakerOverride[i];
      } else {
        breakerOn = avrActiveInputs.has(i);
      }
    }
    inputStates.push({ powered: hasPower, feederTag, breakerOn });
  }

  // Состояние выходов
  const outputStates = [];
  const outBreakers = Array.isArray(n.breakerStates) ? n.breakerStates : [];
  for (let i = 0; i < outCount; i++) {
    let destTag = '—', powered = false;
    for (const c of state.conns.values()) {
      if (c.from.nodeId === n.id && c.from.port === i) {
        const to = state.nodes.get(c.to.nodeId);
        destTag = to ? (effectiveTag(to) || to.name || '?') : '?';
        powered = c._state === 'active' || c._state === 'powered';
        break;
      }
    }
    const breakerOn = outBreakers[i] !== false;
    outputStates.push({ powered, destTag, breakerOn });
  }

  const busPowered = !n.maintenance && inputStates.some(s => s.powered && s.breakerOn);

  let h = '';
  h += `<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`;

  // --- SVG однолинейная схема (зум в header, АВР toggle в settings panel) ---
  h += `<div id="pc-svg-wrap" style="display:flex;justify-content:center;align-items:flex-start;overflow:auto;flex:1">`;
  h += `<svg id="pc-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:sans-serif;font-size:10px">`;

  // Шина
  const busX1 = 15, busX2 = svgW - 15;
  const busColor = busPowered ? '#e53935' : '#bbb';
  h += `<rect x="${busX1}" y="${busY - 2}" width="${busX2 - busX1}" height="4" fill="${busColor}" rx="1"/>`;

  // Входы: линия сверху → автомат → шина
  for (let i = 0; i < inCount; i++) {
    const x = 20 + (i + 0.5) * ((svgW - 40) / Math.max(inCount, 1));
    const s = inputStates[i];
    const lineAlive = s.powered && !n.maintenance;
    const topColor = lineAlive ? '#e53935' : '#bbb';
    const throughColor = lineAlive && s.breakerOn ? '#e53935' : '#bbb';

    // Метка источника
    h += `<text x="${x}" y="12" text-anchor="middle" fill="#333" font-size="9" font-weight="600">${escHtml(s.feederTag)}</text>`;
    // Линия сверху до автомата
    h += `<line x1="${x}" y1="16" x2="${x}" y2="${inBrkY}" stroke="${topColor}" stroke-width="2"/>`;
    // Лампочка состояния ввода
    const lampY = 22;
    if (lineAlive && s.breakerOn) {
      // Зелёная — запитан и замкнут
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="#43a047" opacity="0.8"/>`;
    } else if (lineAlive) {
      // Красная — есть напряжение, но разомкнут
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="#e53935" opacity="0.8"/>`;
    } else {
      // Серая — нет напряжения
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="none" stroke="#ccc" stroke-width="1"/>`;
    }
    // Автомат входа (IEC)
    const brk = svgBreaker(x, inBrkY, s.breakerOn, throughColor, '#ff9800');
    h += brk.svg;
    // Линия от автомата до шины
    h += `<line x1="${x}" y1="${inBrkY + brkH}" x2="${x}" y2="${busY - 2}" stroke="${throughColor}" stroke-width="2"/>`;
    // Кликабельная зона автомата входа:
    // - Щит без АВР: всегда кликабельно
    // - АВР ручной режим: кликабельно (с блокировкой приоритетов)
    // - АВР авто: НЕ кликабельно (управляет АВР)
    // - 1 вход: всегда кликабельно (нечего переключать)
    const inputClickable = isManual || inCount <= 1;
    if (inputClickable) {
      h += `<rect x="${x - 14}" y="${inBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-in-breaker-toggle="${i}"/>`;
    }
    // Приоритет
    const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
    h += `<text x="${x + 12}" y="${inBrkY + brkH / 2 + 3}" fill="#1976d2" font-size="8">P${prio}</text>`;
  }

  // Выходы: шина → автомат → линия вниз
  for (let i = 0; i < outCount; i++) {
    const x = 20 + (i + 0.5) * ((svgW - 40) / Math.max(outCount, 1));
    const s = outputStates[i];
    const on = s.breakerOn;
    const powered = busPowered && on;
    const busCol = busPowered ? '#e53935' : '#bbb';
    const lineCol = powered ? '#e53935' : '#bbb';

    // Линия шина → автомат
    h += `<line x1="${x}" y1="${busY + 2}" x2="${x}" y2="${outBrkY}" stroke="${busCol}" stroke-width="2"/>`;
    // Автомат выхода (IEC)
    const brk = svgBreaker(x, outBrkY, on, lineCol, '#ff9800');
    h += brk.svg;
    // Подпись номинала автомата (слева от автомата)
    {
      let brkLabel = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === n.id && cc.from.port === i) {
          if (cc._breakerIn) {
            const cnt = cc._breakerCount || 1;
            if (cnt > 1 && cc._breakerPerLine) brkLabel = `${cnt}×${cc._breakerPerLine}А`;
            else brkLabel = `${cc._breakerIn}А`;
          } else if (cc._breakerPerLine) {
            const cnt = cc._breakerCount || 1;
            brkLabel = cnt > 1 ? `${cnt}×${cc._breakerPerLine}А` : `${cc._breakerPerLine}А`;
          }
          break;
        }
      }
      if (brkLabel) {
        h += `<text x="${x - 12}" y="${outBrkY + brkH/2}" fill="#ef6c00" font-size="8" font-weight="600" text-anchor="end" dominant-baseline="central">${brkLabel}</text>`;
      }
    }
    // Линия от автомата вниз
    h += `<line x1="${x}" y1="${outBrkY + brkH}" x2="${x}" y2="${outBrkY + brkH + 14}" stroke="${lineCol}" stroke-width="2"/>`;
    // Метка назначения / "Резерв"
    let outLabel;
    let labelColor = '#333';
    if (s.destTag === '—') {
      outLabel = 'Резерв';
      labelColor = '#bbb';
    } else {
      let inPortNum = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === n.id && cc.from.port === i) {
          inPortNum = `-${cc.to.port + 1}`;
          break;
        }
      }
      outLabel = s.destTag + inPortNum;
    }
    const labelY = outBrkY + brkH + 16;
    h += `<text x="${x}" y="${labelY}" fill="${labelColor}" font-size="9" font-weight="600" text-anchor="end" dominant-baseline="central" transform="rotate(-90 ${x} ${labelY})">${escHtml(outLabel)}</text>`;
    // Кликабельная зона
    h += `<rect x="${x - 14}" y="${outBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-breaker-toggle="${i}"/>`;
  }

  h += `</svg></div>`;

  body.innerHTML = h;

  // Настройки простого щита — в settings panel
  {
    const sp = document.getElementById('pc-settings-panel');
    let sh2 = '';
    if (inCount > 1 && hasAVR) {
      const manualNow = n.switchMode === 'manual';
      sh2 += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">';
      sh2 += `<span style="font-size:11px;font-weight:600;color:#666">АВР:</span>`;
      sh2 += `<span style="font-size:11px;color:${!manualNow ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh2 += `<div id="pc-toggle" style="position:relative;width:44px;height:22px;border-radius:11px;background:${manualNow ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`;
      sh2 += `<div style="position:absolute;top:2px;${manualNow ? 'right:2px' : 'left:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh2 += '</div>';
      sh2 += `<span style="font-size:11px;color:${manualNow ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh2 += '</div>';
      if (n._avrSwitchCountdown > 0) {
        sh2 += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">Задержка ${Math.ceil(n._avrSwitchCountdown)} с</div>`;
      } else if (n._avrInterlockCountdown > 0) {
        sh2 += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">Разбежка ${Math.ceil(n._avrInterlockCountdown)} с</div>`;
      }
    }
    if (sp && sh2) {
      sp.innerHTML = `<div style="width:240px;border:1px solid #d0d0d0;border-radius:8px;background:rgba(255,255,255,0.92);backdrop-filter:blur(6px);box-shadow:0 2px 12px rgba(0,0,0,0.1)">` +
        `<div id="pc-settings-toggle" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;user-select:none">` +
        `<span style="font-size:12px;font-weight:700;color:#444">⚙ Настройки</span>` +
        `<span style="font-size:12px;color:#999" id="pc-settings-arrow">▲</span></div>` +
        `<div id="pc-settings-content" style="padding:4px 12px 10px;border-top:1px solid #eee">${sh2}</div></div>`;
      const toggle = document.getElementById('pc-settings-toggle');
      const content = document.getElementById('pc-settings-content');
      const arrow = document.getElementById('pc-settings-arrow');
      if (toggle && content) {
        toggle.onclick = () => { const h = content.style.display === 'none'; content.style.display = h ? '' : 'none'; if (arrow) arrow.textContent = h ? '▲' : '▼'; };
      }
    } else if (sp) {
      sp.innerHTML = '';
    }
  }

  // Зум однолинейной схемы — восстанавливаем сохранённый зум
  {
    let pcZoom = _pcZoomState.zoom;
    const pcSvg = document.getElementById('pc-svg');
    const pcLabel = document.getElementById('pc-zoom-label');
    const pcWrap = document.getElementById('pc-svg-wrap');
    const applyZoom = () => {
      if (pcSvg) {
        pcSvg.style.width = (svgW * pcZoom) + 'px';
        pcSvg.style.height = (svgH * pcZoom) + 'px';
      }
      if (pcLabel) pcLabel.textContent = Math.round(pcZoom * 100) + '%';
      _pcZoomState.zoom = pcZoom;
    };
    applyZoom(); // применить сохранённый зум сразу
    const zoomIn = document.getElementById('pc-zoom-in');
    const zoomOut = document.getElementById('pc-zoom-out');
    if (zoomIn) zoomIn.onclick = () => { pcZoom = Math.min(3, pcZoom * 1.25); applyZoom(); };
    if (zoomOut) zoomOut.onclick = () => { pcZoom = Math.max(0.3, pcZoom / 1.25); applyZoom(); };
    if (pcWrap) pcWrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pcZoom = e.deltaY < 0 ? Math.min(3, pcZoom * 1.1) : Math.max(0.3, pcZoom / 1.1);
      applyZoom();
    }, { passive: false });
  }

  // Fullscreen toggle — восстанавливаем сохранённое состояние
  const fsBtn = document.getElementById('pc-fullscreen');
  const modalBox = body.closest('.modal-box');
  if (fsBtn && modalBox) {
    if (_pcZoomState.fullscreen) {
      modalBox.classList.add('modal-fullscreen');
      fsBtn.textContent = '⤡';
    }
    fsBtn.onclick = () => {
      modalBox.classList.toggle('modal-fullscreen');
      _pcZoomState.fullscreen = modalBox.classList.contains('modal-fullscreen');
      fsBtn.textContent = _pcZoomState.fullscreen ? '⤡' : '⤢';
    };
  }

  // Автоматы выходов
  body.querySelectorAll('[data-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      snapshot('breaker:' + n.id);
      const idx = Number(el.dataset.breakerToggle);
      if (!Array.isArray(n.breakerStates)) n.breakerStates = new Array(outCount).fill(true);
      while (n.breakerStates.length < outCount) n.breakerStates.push(true);
      n.breakerStates[idx] = !n.breakerStates[idx];
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Автоматы входов
  body.querySelectorAll('[data-in-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.inBreakerToggle);
      if (!Array.isArray(n.inputBreakerStates)) n.inputBreakerStates = new Array(inCount).fill(true);
      while (n.inputBreakerStates.length < inCount) n.inputBreakerStates.push(true);

      const wantOn = !n.inputBreakerStates[idx];

      // Блокировка для АВР в ручном режиме: нельзя включить автомат
      // другого приоритета пока текущий не выключен
      if (hasAVR && n.switchMode === 'manual' && wantOn) {
        const priorities = Array.isArray(n.priorities) ? n.priorities : [];
        const myPrio = priorities[idx] ?? (idx + 1);
        // Проверяем: есть ли включённый автомат с ДРУГИМ приоритетом?
        for (let i = 0; i < inCount; i++) {
          if (i === idx) continue;
          if (n.inputBreakerStates[i]) {
            const otherPrio = priorities[i] ?? (i + 1);
            if (otherPrio !== myPrio) {
              flash('Блокировка: сперва выключите другой ввод (P' + otherPrio + ')');
              return;
            }
          }
        }
      }

      snapshot('in-breaker:' + n.id);
      n.inputBreakerStates[idx] = wantOn;
      // Для АВР: сбросить _avrBreakerOverride при ручном переключении
      if (n.switchMode === 'manual') {
        n._avrBreakerOverride = [...n.inputBreakerStates];
      }
      render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Переключатель Авто / Ручной (toggle)
  const toggleEl = document.getElementById('pc-toggle');
  if (toggleEl) {
    toggleEl.addEventListener('click', () => {
      snapshot('mode:' + n.id);
      if (n.switchMode === 'manual') {
        n.switchMode = n._prevSwitchMode || 'auto';
        // Сброс — АВР управляет автоматами
        n.inputBreakerStates = null;
        n._avrBreakerOverride = null;
        n._avrActivePort = undefined;
        n._avrSwitchStartedAt = 0;
        n._avrDisconnected = false;
      } else {
        n._prevSwitchMode = n.switchMode;
        // Копируем текущее состояние автоматов АВР в ручное управление
        // чтобы при переключении ничего не менялось
        if (Array.isArray(n._avrBreakerOverride)) {
          n.inputBreakerStates = [...n._avrBreakerOverride];
        } else {
          // Определяем из текущих active связей
          const states = new Array(n.inputs || 0).fill(false);
          for (const c of state.conns.values()) {
            if (c.to.nodeId === n.id && c._state === 'active') {
              states[c.to.port] = true;
            }
          }
          n.inputBreakerStates = states;
        }
        n.switchMode = 'manual';
      }
      render(); notifyChange();
      openPanelControlModal(n);
    });
  }

  // Обслуживание
  const maintCb = document.getElementById('pc-maintenance');
  if (maintCb) {
    maintCb.addEventListener('change', () => {
      snapshot('maint:' + n.id);
      n.maintenance = maintCb.checked;
      render(); renderInspector(); notifyChange();
      openPanelControlModal(n);
    });
  }

  // +/- входы/выходы (с проверкой подключений)
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  function hasConnOnPort(nodeId, kind, port) {
    for (const c of state.conns.values()) {
      if (kind === 'in' && c.to.nodeId === nodeId && c.to.port === port) return true;
      if (kind === 'out' && c.from.nodeId === nodeId && c.from.port === port) return true;
    }
    return false;
  }

  // Закрыть
  const applyBtn = document.getElementById('panel-control-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      render(); notifyChange();
      openPanelControlModal(n); // перерисовать модалку с актуальным состоянием
    };
  }

  document.getElementById('modal-panel-control').classList.remove('hidden');
}


export function panelStatusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">запитан</span>');
  else parts.push('<span class="badge off">без питания</span>');
  // Максимальная расчётная нагрузка
  if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
  // Текущая нагрузка
  parts.push(`<b>Текущая:</b> ${fmt(n._powerP || 0)} kW · ${fmt(n._loadA || 0)} A`);
  parts.push(`Q реакт.: ${fmt(n._powerQ || 0)} kvar · S полн.: ${fmt(n._powerS || 0)} kVA`);
  if (Number(n.kSim) && Number(n.kSim) !== 1) {
    parts.push(`расчётная с Ксим: <b>${fmt(n._calcKw || 0)} kW</b>`);
  }
  if (n._cosPhi) parts.push(`cos φ итог: <b>${n._cosPhi.toFixed(2)}</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik (ток КЗ): <b>${fmt(n._ikA / 1000)} кА</b>`);
  if (n._deltaUPct > 0) parts.push(`ΔU суммарный: <b>${n._deltaUPct.toFixed(2)}%</b>${n._deltaUPct > 5 ? ' ⚠ > 5%' : ''}`);

  // Запас номинала шкафа — сравниваем с максимальным током.
  if (Number(n.capacityA) > 0) {
    const capA = Number(n.capacityA);
    const maxA = n._maxLoadA || 0;
    parts.push(`номинал: <b>${fmt(capA)} A</b>, макс.ток: <b>${fmt(maxA)} A</b>`);
    if (maxA > 0) {
      const pct = n._marginPct == null ? 0 : n._marginPct;
      const pctTxt = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      if (n._marginWarn === 'undersize') {
        parts.push(`запас: <b style="color:#c62828">${pctTxt}</b> ⚠ перегруз (номинал ниже макс.тока)`);
      } else if (n._marginWarn === 'oversize') {
        parts.push(`запас: <b style="color:#8e24aa">${pctTxt}</b> ⚠ избыточен (макс. ${n.marginMaxPct}%)`);
      } else {
        parts.push(`запас: <b style="color:#2e7d32">${pctTxt}</b> ок`);
      }
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}

