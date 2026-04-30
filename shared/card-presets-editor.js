// =========================================================================
// shared/card-presets-editor.js — v0.59.799 (Phase 19.3 расширено)
//
// Модалка редактирования пресетов карточек. v2:
//   - Draggable по заголовку (mousedown на head → reposition)
//   - Двухколоночный layout в Поля-табе: слева список полей (checkboxes),
//     справа — live preview карточки с 4 зонами (header / topRight /
//     body / footer).
//   - У каждой зоны editable label (click → input → save on blur/Enter).
//   - Drag-drop полей между зонами (внутри preview) и из field-list в зону.
//   - За один раз настраивается одна карточка (выбранный type-tab).
//   - Карточки настраиваются для разных типов в одном пресете
//     (existing per-type subtabs + per-type zones).
//
// Данные пресета (v2):
//   preset.perMode[kind].perType[type] = ['fieldId', ...]   // legacy: список выбранных
//   preset.zoneLayout[kind][type] = {
//     zones: [{ id, label, position: 'header'|'topRight'|'body'|'footer' }],
//     assignments: { fieldId: zoneId }                       // куда поле помещено в preview
//   }
// Backward-compat: если zoneLayout нет — все selected fields в 'body'.
// =========================================================================

import {
  SYSTEM_PRESETS, listAllPresets, getPresetById,
  loadUserPresets, saveUserPresets,
  getUserActivePresetId, setUserActivePresetId,
  createUserPreset, deleteUserPreset, renameUserPreset, setUserPresetFields,
} from './card-presets.js';
import { CARD_FIELDS, listCardFields, requiredFieldIds, shortLabel as registryShortLabel, fieldUnit } from './card-fields-registry.js';

// ─── Helpers
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return escHtml(s); }

// ─── Default zones layout (used if preset has no zoneLayout for type)
const DEFAULT_ZONES = [
  { id: 'header',   label: 'Заголовок',  position: 'header'   },
  { id: 'topRight', label: 'Иконка',     position: 'topRight' },
  { id: 'body',     label: 'Тело',       position: 'body'     },
  { id: 'footer',   label: 'Подвал',     position: 'footer'   },
];

// Дефолтное распределение полей по zone-id для всех (kind, type).
// Required tag/name — в header, count в footer, icon в topRight, остальные в body.
function defaultZoneAssignment(fieldId) {
  if (fieldId === 'tag' || fieldId === 'name' || fieldId === 'zonePrefix') return 'header';
  if (fieldId === 'icon' || fieldId === 'sourceSubtype') return 'topRight';
  if (fieldId === 'count') return 'footer';
  return 'body';
}

function getZoneLayout(preset, kind, type) {
  const layouts = preset.zoneLayout || (preset.zoneLayout = {});
  if (!layouts[kind]) layouts[kind] = {};
  if (!layouts[kind][type]) {
    layouts[kind][type] = {
      zones: JSON.parse(JSON.stringify(DEFAULT_ZONES)),
      assignments: {},
      order: [],   // v0.59.830: явный порядок field-id для отображения чипов
    };
  }
  // Backward-compat: layout без order
  if (!Array.isArray(layouts[kind][type].order)) {
    layouts[kind][type].order = [];
  }
  return layouts[kind][type];
}

function saveZoneLayout(preset, kind, type, layout) {
  if (!preset.zoneLayout) preset.zoneLayout = {};
  if (!preset.zoneLayout[kind]) preset.zoneLayout[kind] = {};
  preset.zoneLayout[kind][type] = layout;
  // Persist user preset
  if (!preset.system) {
    const all = loadUserPresets();
    const idx = all.findIndex(p => p.id === preset.id);
    if (idx >= 0) { all[idx] = preset; saveUserPresets(all); }
  }
}

// ─── Editor state
let _state = {
  selectedPresetId: null,
  activeModeTab: 'schematic',
  activeTypeTab: 'consumer',
  activeMainTab: 'presets',
  modalPos: null,           // { x, y } для draggable
};

// ─── Render
function render(host) {
  const presets = listAllPresets();
  const activeId = getUserActivePresetId();
  if (!_state.selectedPresetId || !presets.find(p => p.id === _state.selectedPresetId)) {
    _state.selectedPresetId = activeId;
  }
  const sel = getPresetById(_state.selectedPresetId);
  const isSystem = !!(sel && sel.system);
  const userPresets = loadUserPresets();

  const stylePos = _state.modalPos
    ? `style="left:${_state.modalPos.x}px;top:${_state.modalPos.y}px;transform:none;position:fixed"`
    : '';

  host.innerHTML = `
    <div class="cpe-modal" ${stylePos}>
      <div class="cpe-head" data-cpe-drag-handle>
        <h2>🎴 Пресеты отображения карточек</h2>
        <button class="cpe-close" type="button">×</button>
      </div>
      <div class="cpe-tabs">
        <button class="cpe-tab${_state.activeMainTab === 'presets' ? ' active' : ''}" data-main-tab="presets">📋 Пресеты</button>
        <button class="cpe-tab${_state.activeMainTab === 'fields' ? ' active' : ''}" data-main-tab="fields"${isSystem ? ' disabled title="Системный пресет нельзя редактировать — скопируйте его сначала"' : ''}>✎ Поля</button>
        <button class="cpe-tab${_state.activeMainTab === 'io' ? ' active' : ''}" data-main-tab="io">⇅ Импорт/Экспорт</button>
      </div>
      <div class="cpe-body">
        ${_state.activeMainTab === 'presets' ? _renderPresetsTab(presets, activeId, userPresets) : ''}
        ${_state.activeMainTab === 'fields' ? _renderFieldsTabSplit(sel, isSystem) : ''}
        ${_state.activeMainTab === 'io' ? _renderIoTab(userPresets) : ''}
      </div>
    </div>
  `;
}

function _renderPresetsTab(presets, activeId, userPresets) {
  const sysGroup = presets.filter(p => p.system);
  const userGroup = presets.filter(p => !p.system);
  return `<div class="cpe-pane cpe-pane-presets">
    <div class="cpe-pane-section">
      <h3>Системные (read-only)</h3>
      <div class="cpe-presets-grid">
        ${sysGroup.map(p => _presetCardHtml(p, activeId, _state.selectedPresetId)).join('')}
      </div>
    </div>
    <div class="cpe-pane-section">
      <div class="cpe-pane-section-head">
        <h3>Пользовательские (${userGroup.length})</h3>
        <button class="cpe-btn cpe-btn-primary" data-action="create">➕ Создать</button>
      </div>
      ${userGroup.length === 0
        ? `<div class="cpe-empty">Нет user-пресетов. Создайте новый или скопируйте системный.</div>`
        : `<div class="cpe-presets-grid">${userGroup.map(p => _presetCardHtml(p, activeId, _state.selectedPresetId)).join('')}</div>`}
    </div>
    <div class="cpe-info muted">
      <b>Как работает:</b> Активный пресет применяется ко всем страницам. Иерархия:
      <i>scheme → project → user</i>. Required-поля (tag/name) всегда видны независимо от пресета.
    </div>
  </div>`;
}

function _presetCardHtml(p, activeId, selectedId) {
  const isActive = p.id === activeId;
  const isSelected = p.id === selectedId;
  const isSystem = p.system;
  return `<div class="cpe-preset-card${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}" data-preset-id="${escAttr(p.id)}">
    <div class="cpe-preset-card-head">
      <span class="cpe-preset-name">${escHtml(p.name)}${isActive ? ' <span class="cpe-badge-active">активен</span>' : ''}${isSystem ? ' <span class="cpe-badge-sys">🔒 sys</span>' : ''}</span>
    </div>
    ${p.description ? `<div class="cpe-preset-desc muted">${escHtml(p.description)}</div>` : ''}
    <div class="cpe-preset-actions">
      ${!isActive ? `<button class="cpe-btn-sm" data-action="activate" data-id="${escAttr(p.id)}">⚡ Активировать</button>` : ''}
      ${!isSystem ? `<button class="cpe-btn-sm" data-action="rename" data-id="${escAttr(p.id)}">✎ Переименовать</button>` : ''}
      ${!isSystem ? `<button class="cpe-btn-sm" data-action="reset-all" data-id="${escAttr(p.id)}" title="Сбросить ВСЕ зоны и подписи в этом пресете (всех типов всех режимов). Активные поля не трогаются.">↺ Сбросить всё</button>` : ''}
      ${isSystem ? `<button class="cpe-btn-sm" data-action="duplicate" data-id="${escAttr(p.id)}">📋 Скопировать</button>` : ''}
      ${!isSystem ? `<button class="cpe-btn-sm cpe-btn-danger" data-action="delete" data-id="${escAttr(p.id)}">🗑 Удалить</button>` : ''}
    </div>
  </div>`;
}

// ─── Поля tab — двухколоночный split с preview
function _renderFieldsTabSplit(sel, isSystem) {
  if (!sel) return `<div class="cpe-empty">Выберите пресет на вкладке «Пресеты».</div>`;
  if (isSystem) return `<div class="cpe-empty">Системный пресет редактировать нельзя. На вкладке «Пресеты» нажмите «📋 Скопировать», затем редактируйте копию.</div>`;
  const modes = Object.keys(CARD_FIELDS);
  const types = Object.keys(CARD_FIELDS[_state.activeModeTab] || {});
  if (!_state.activeTypeTab || !types.includes(_state.activeTypeTab)) {
    _state.activeTypeTab = types[0] || 'consumer';
  }
  const kind = _state.activeModeTab;
  const type = _state.activeTypeTab;
  const fields = listCardFields(kind, type);
  const required = new Set(requiredFieldIds(kind, type));
  const activeIds = new Set(
    (sel.perMode?.[kind]?.perType?.[type]) || fields.map(f => f.id)
  );
  const layout = getZoneLayout(sel, kind, type);
  // Группировка полей для левой колонки
  const byGroup = {};
  for (const f of fields) {
    const g = f.group || 'misc';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(f);
  }
  const groupLabel = (g) => ({
    identification: 'Идентификация',
    electrical: 'Электрика',
    mechanical: 'Габариты / механика',
    status: 'Статус',
    misc: 'Прочее',
  }[g] || g);

  return `<div class="cpe-pane cpe-pane-fields cpe-pane-split">
    <!-- Top: tabs -->
    <div class="cpe-mode-tabs">
      ${modes.map(m => `<button class="cpe-subtab${m === kind ? ' active' : ''}" data-mode-tab="${escAttr(m)}">${escHtml(m)}</button>`).join('')}
    </div>
    <div class="cpe-type-tabs">
      ${types.map(t => `<button class="cpe-subtab${t === type ? ' active' : ''}" data-type-tab="${escAttr(t)}">${escHtml(t)}</button>`).join('')}
    </div>

    <div class="cpe-split-grid">
      <!-- Left column: field list -->
      <div class="cpe-split-left">
        <div class="cpe-fields-toolbar">
          <button class="cpe-btn-sm" data-action="select-all">☑ Все</button>
          <button class="cpe-btn-sm" data-action="select-none">☐ Только обязательные</button>
          <button class="cpe-btn-sm" data-action="reset-type" title="Сбросить пользовательские подписи и зоны для типа «${escAttr(type)}» в этом пресете. Поля остаются как есть.">↺ Сбросить зоны/подписи</button>
        </div>
        <div class="cpe-info muted" style="font-size:10.5px;margin:6px 0">
          Слева — все доступные поля. Чекбокс включает в пресет; перетащите поле в нужную <b>зону</b> карточки справа.
        </div>
        ${Object.keys(byGroup).map(g => `<div class="cpe-fields-group">
          <h4>${escHtml(groupLabel(g))}</h4>
          ${byGroup[g].map(f => {
            // v0.59.830: чекбокс убран — добавление/удаление через drag-drop
            // в зону / ×-кнопку. Поле всегда draggable. Если поле уже в
            // карточке — показываем ✓ маркер, иначе нет.
            const isReq = required.has(f.id);
            const isOn = activeIds.has(f.id) || isReq;
            const inZone = layout.assignments[f.id] || (isOn ? defaultZoneAssignment(f.id) : null);
            const customLabel = sel.fieldLabels?.[kind]?.[type]?.[f.id] || '';
            return `<div class="cpe-field-row${isReq ? ' cpe-field-required' : ''}${!isOn ? ' cpe-field-off' : ''}" draggable="true" data-field-id="${escAttr(f.id)}">
              <span class="cpe-field-handle" title="Перетащите в зону карточки справа">⋮⋮</span>
              <span class="cpe-field-on-mark" title="${isOn ? 'В карточке' : 'Не в карточке'}" style="font-weight:600;color:${isOn ? '#16a34a' : '#cbd5e1'};font-size:13px;width:14px;display:inline-block;text-align:center">${isOn ? '✓' : '·'}</span>
              <input type="text" class="cpe-field-label-input" data-field-id="${escAttr(f.id)}" value="${escAttr(customLabel || f.label)}" placeholder="${escAttr(f.label)}" title="Подпись на карточке (кликните и измените). Пустое поле = вернуть стандартную подпись «${escAttr(f.label)}»">
              <code class="cpe-field-id muted">${escHtml(f.id)}</code>
              ${isReq ? '<span class="cpe-field-req">обяз.</span>' : ''}
              ${inZone && isOn ? `<span class="cpe-field-zone-mark muted" title="Текущая зона">→ ${escHtml(_zoneLabel(layout, inZone))}</span>` : ''}
            </div>`;
          }).join('')}
        </div>`).join('')}
      </div>

      <!-- Right column: card preview with zones + rendered sample -->
      <div class="cpe-split-right">
        <div class="cpe-preview-header">
          <span style="font-size:11px;font-weight:600;color:#374151">Предпросмотр карточки <code>${escHtml(type)}</code></span>
          <span class="muted" style="font-size:10.5px">Перетащите чипы между зонами.</span>
        </div>
        ${_renderCardPreview(sel, kind, type, fields, activeIds, required, layout)}
        <div class="cpe-rendered-preview-wrap">
          <div class="cpe-rendered-preview-head">
            <span style="font-size:11px;font-weight:600;color:#374151">📐 Как выглядит на схеме (с примерными данными):</span>
          </div>
          ${_renderSampleCard(sel, kind, type, fields, activeIds, required)}
        </div>
      </div>
    </div>
  </div>`;
}

// v0.59.806: рендер sample-карточки с примерными данными — пользователь
// видит результат пресета как на канвасе.
function _renderSampleCard(sel, kind, type, fields, activeIds, required) {
  // Sample values per type
  const sample = {
    consumer: {
      tag: 'SR1', name: 'Стойка',
      demandKw: '8.8', kvAOrVA: '9.2', currentA: '39.9',
      maxKw: '7.0', maxA: '31.7', freeKw: '1.8', freeA: '8.3',
      cosPhi: '0.95', voltage: '400', phase: '3ph',
      breakerIn: '50', cableSpec: 'ВВГнг 5×16', deltaUPct: '0.8',
      count: '8', subtitle: 'Серверная стойка · вх 2',
      nominalKw: '8.8',
    },
    panel: {
      tag: 'ГРЩ1', name: 'Главный распред. щит',
      capacityA: '630', currentA: '420', maxKw: '230', maxA: '460',
      freeKw: '110', freeA: '170', marginPct: '33.3', kSim: '0.85',
      switchMode: 'auto', sectionsCount: '2', subtitle: 'In 630 А · 2 секции',
    },
    source: {
      tag: 'TP1', name: 'Трансформатор',
      sourceSubtype: 'transformer', voltage: '10000', snomKva: '630',
      capacityKw: '600', currentA: '32', maxKw: '400', maxA: '21',
      freeKw: '230', freeA: '12', sscMva: '250', ukPct: '4.5',
      subtitle: 'Трансформатор Sном 630',
    },
    generator: {
      tag: 'G1', name: 'ДГУ',
      capacityKw: '500', snomKva: '625', currentA: '0', maxKw: '0',
      maxA: '0', freeKw: '500', freeA: '720', backupMode: 'резерв',
      triggerInfo: '2', subtitle: 'Генератор 500 кВт',
    },
    ups: {
      tag: 'UPS1', name: 'ИБП IT',
      kva: '120', kw: '108', autonomyMin: '15', currentA: '155',
      maxKw: '90', maxA: '129', freeKw: '18', freeA: '26',
      redundancy: 'N+1', subtitle: 'ИБП · КПД 95%',
    },
    zone: { tag: 'Z1', name: 'Зона 1' },
    channel: { tag: 'CH1', name: 'Лоток LM-300', cableSpec: 'F · 30°C · 50м' },
  }[type] || { tag: 'X1', name: 'Sample' };

  // v0.59.811: sample-карточка теперь использует zoneLayout — поля
  // отображаются в той зоне (header/topRight/body/footer), куда их
  // расположил пользователь. Раньше всё рендерилось линейно.
  const layout = getZoneLayout(sel, kind, type);
  const layoutZones = layout.zones || DEFAULT_ZONES;
  const layoutAssign = layout.assignments || {};

  // Распределяем активные поля по зонам (по position)
  const zonesByPos = { header: [], topRight: [], body: [], footer: [] };
  for (const f of fields) {
    if (!activeIds.has(f.id) && !required.has(f.id)) continue;
    const zid = layoutAssign[f.id] || defaultZoneAssignment(f.id);
    const z = layoutZones.find(x => x.id === zid);
    const pos = z ? z.position : 'body';
    if (!zonesByPos[pos]) zonesByPos[pos] = [];
    zonesByPos[pos].push(f);
  }

  // Render одного поля в текущем sample-card (с разной visualization
  // для tag / name / subtitle / icon / прочих)
  const renderField = (f) => {
    if (f.id === 'tag') return sample.tag ? `<div class="cpe-sample-tag">${escHtml(sample.tag)}</div>` : '';
    if (f.id === 'name') return sample.name ? `<div class="cpe-sample-name">${escHtml(sample.name)}</div>` : '';
    if (f.id === 'subtitle' || f.id === 'sourceSubtype' || f.id === 'switchMode') {
      return sample.subtitle ? `<div class="cpe-sample-subtitle muted">${escHtml(sample.subtitle)}</div>` : '';
    }
    if (f.id === 'icon') return '<div class="cpe-sample-icon-inline">▣</div>';
    if (f.id === 'zonePrefix' || f.id === 'memberCount') return '';
    const val = sample[f.id];
    if (val == null || val === '') return '';
    const customLabel = sel.fieldLabels?.[kind]?.[type]?.[f.id];
    const lbl = (typeof customLabel === 'string' && customLabel.trim())
      ? customLabel : registryShortLabel(kind, type, f.id);
    const unit = fieldUnit(kind, type, f.id);
    return `<div class="cpe-sample-row">${escHtml(lbl)}: ${escHtml(val)}${unit ? ' ' + escHtml(unit) : ''}</div>`;
  };

  const renderZone = (pos) => zonesByPos[pos].map(renderField).filter(Boolean).join('');
  const headerHtml = renderZone('header');
  const topRightHtml = renderZone('topRight');
  const bodyHtml = renderZone('body');
  const footerHtml = renderZone('footer');

  return `<div class="cpe-sample-card cpe-sample-card-zoned">
    <div class="cpe-sample-row-top">
      <div class="cpe-sample-zone cpe-sample-zone-header">
        ${headerHtml || '<div class="cpe-sample-empty muted">пусто</div>'}
      </div>
      <div class="cpe-sample-zone cpe-sample-zone-topright">
        ${topRightHtml || '<div class="cpe-sample-empty muted">—</div>'}
      </div>
    </div>
    <div class="cpe-sample-zone cpe-sample-zone-body">
      ${bodyHtml || '<div class="cpe-sample-empty muted">— тело пусто —</div>'}
    </div>
    <div class="cpe-sample-zone cpe-sample-zone-footer">
      ${footerHtml || ''}
    </div>
  </div>`;
}

function _zoneLabel(layout, zoneId) {
  const z = (layout.zones || []).find(x => x.id === zoneId);
  return z ? z.label : zoneId;
}

function _renderCardPreview(sel, kind, type, fields, activeIds, required, layout) {
  const fieldsById = Object.fromEntries(fields.map(f => [f.id, f]));
  // Распределение полей по зонам
  const byZone = {};
  for (const z of layout.zones) byZone[z.id] = [];
  for (const f of fields) {
    if (!activeIds.has(f.id) && !required.has(f.id)) continue;
    const zid = layout.assignments[f.id] || defaultZoneAssignment(f.id);
    if (!byZone[zid]) byZone[zid] = [];   // зона исчезла — fallback
    byZone[zid].push(f);
  }
  // v0.59.830: сортировка чипов в каждой зоне по layout.order (если есть).
  // Поля без записи в order — в конце списка (по дефолтной сортировке fields).
  if (Array.isArray(layout.order) && layout.order.length) {
    const orderIdx = new Map();
    layout.order.forEach((fid, i) => orderIdx.set(fid, i));
    for (const zid of Object.keys(byZone)) {
      byZone[zid].sort((a, b) => {
        const ia = orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9;
        const ib = orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9;
        return ia - ib;
      });
    }
  }
  const zonePos = (pos) => layout.zones.filter(z => z.position === pos);
  const renderZoneArea = (pos) => {
    const zones = zonePos(pos);
    return zones.map(z => `<div class="cpe-zone" data-zone-id="${escAttr(z.id)}" data-zone-pos="${escAttr(pos)}">
      <div class="cpe-zone-head">
        <input type="text" class="cpe-zone-label" value="${escAttr(z.label)}" data-zone-id="${escAttr(z.id)}" title="Подпись зоны (можно изменить)">
        <span class="cpe-zone-cnt muted">(${(byZone[z.id] || []).length})</span>
      </div>
      <div class="cpe-zone-chips" data-zone-id="${escAttr(z.id)}">
        ${(byZone[z.id] || []).map((f, idx) => {
          // v0.59.802: использовать custom label если есть в пресете
          const _customLabel = sel.fieldLabels?.[_state.activeModeTab]?.[_state.activeTypeTab]?.[f.id];
          const _displayLabel = _customLabel || f.label;
          return `<span class="cpe-chip${required.has(f.id) ? ' cpe-chip-req' : ''}" draggable="true" data-field-id="${escAttr(f.id)}" data-from-zone="${escAttr(z.id)}" data-chip-pos="${idx}" title="${escAttr(f.id)} — перетащите в другую зону или измените порядок">
            <span class="cpe-chip-grip" title="перетащить">⋮⋮</span>
            ${escHtml(_displayLabel)}
            ${!required.has(f.id) ? `<button type="button" class="cpe-chip-x" data-field-id="${escAttr(f.id)}" title="Удалить поле из карточки">×</button>` : ''}
          </span>`;
        }).join('')}
        ${(byZone[z.id] || []).length === 0 ? '<span class="cpe-zone-empty muted">пусто</span>' : ''}
      </div>
    </div>`).join('');
  };

  return `<div class="cpe-card-preview">
    <div class="cpe-card-row cpe-card-row-top">
      <div class="cpe-card-col cpe-card-col-main">${renderZoneArea('header')}</div>
      <div class="cpe-card-col cpe-card-col-side">${renderZoneArea('topRight')}</div>
    </div>
    <div class="cpe-card-row cpe-card-row-body">${renderZoneArea('body')}</div>
    <div class="cpe-card-row cpe-card-row-foot">${renderZoneArea('footer')}</div>
  </div>
  <div class="cpe-preview-legend muted">
    <b>Зоны:</b> заголовок (вверху), иконка (справа сверху), тело (центр), подвал (внизу).
    Подписи можно менять кликом по тексту. Чипы — drag-drop между зонами.
  </div>`;
}

function _renderIoTab(userPresets) {
  return `<div class="cpe-pane cpe-pane-io">
    <div class="cpe-pane-section">
      <h3>📤 Экспорт</h3>
      <p class="muted">Скачать все user-пресеты в JSON-файл.</p>
      <button class="cpe-btn cpe-btn-primary" data-action="export">⬇ Скачать JSON (${userPresets.length} пресетов)</button>
    </div>
    <div class="cpe-pane-section">
      <h3>📥 Импорт</h3>
      <p class="muted">Загрузить JSON-файл с пресетами. Существующие с тем же id будут обновлены.</p>
      <label class="cpe-btn">
        ⬆ Загрузить JSON
        <input type="file" data-action="import-file" accept="application/json" style="display:none">
      </label>
    </div>
  </div>`;
}

// ─── Wire events
function wire(host) {
  const root = host.querySelector('.cpe-modal');
  if (!root) return;
  const close = () => host.remove();
  root.querySelector('.cpe-close').addEventListener('click', close);
  host.addEventListener('click', e => { if (e.target === host) close(); });

  // Drag handle (modal перемещается)
  _wireDraggable(root, host);

  // Main tabs
  root.querySelectorAll('button[data-main-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _state.activeMainTab = btn.dataset.mainTab;
      render(host); wire(host);
    });
  });

  // Preset cards
  root.querySelectorAll('.cpe-preset-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      _state.selectedPresetId = card.dataset.presetId;
      render(host); wire(host);
    });
  });

  // Preset actions / bulk
  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'activate') { setUserActivePresetId(id); render(host); wire(host); }
      else if (action === 'reset-all') {
        const cur = getPresetById(id);
        if (!cur || cur.system) return;
        if (!confirm(`Сбросить ВСЕ зоны и подписи в пресете «${cur.name}»? Активные поля останутся как есть.`)) return;
        delete cur.zoneLayout;
        delete cur.fieldLabels;
        const all = loadUserPresets();
        const idx = all.findIndex(p => p.id === id);
        if (idx >= 0) { all[idx] = cur; saveUserPresets(all); }
        render(host); wire(host);
      }
      else if (action === 'rename') {
        const cur = getPresetById(id);
        const newName = prompt('Новое имя пресета:', cur?.name || '');
        if (newName) { renameUserPreset(id, newName); render(host); wire(host); }
      } else if (action === 'delete') {
        const cur = getPresetById(id);
        if (cur && confirm(`Удалить пресет «${cur.name}»? Действие необратимо.`)) {
          deleteUserPreset(id);
          if (_state.selectedPresetId === id) _state.selectedPresetId = null;
          render(host); wire(host);
        }
      } else if (action === 'create') {
        const name = prompt('Имя нового пресета:', 'Мой пресет');
        if (name) {
          const p = createUserPreset(name, _state.selectedPresetId || 'full');
          _state.selectedPresetId = p.id;
          _state.activeMainTab = 'fields';
          render(host); wire(host);
        }
      } else if (action === 'duplicate') {
        const src = getPresetById(id);
        const name = prompt('Имя копии:', (src?.name || '') + ' (копия)');
        if (name) {
          const p = createUserPreset(name, id);
          _state.selectedPresetId = p.id;
          _state.activeMainTab = 'fields';
          render(host); wire(host);
        }
      } else if (action === 'select-all') { _bulkSetFields(true); render(host); wire(host); }
      else if (action === 'select-none') { _bulkSetFields(false); render(host); wire(host); }
      else if (action === 'reset-type') {
        const sel = getPresetById(_state.selectedPresetId);
        if (!sel || sel.system) return;
        const kind = _state.activeModeTab, type = _state.activeTypeTab;
        if (!confirm(`Сбросить пользовательские подписи и зоны для типа «${type}» в пресете «${sel.name}»?`)) return;
        if (sel.fieldLabels?.[kind]?.[type]) delete sel.fieldLabels[kind][type];
        if (sel.zoneLayout?.[kind]?.[type]) delete sel.zoneLayout[kind][type];
        const all = loadUserPresets();
        const idx = all.findIndex(p => p.id === sel.id);
        if (idx >= 0) { all[idx] = sel; saveUserPresets(all); }
        render(host); wire(host);
      }
      else if (action === 'export') { _exportJson(); }
    });
  });

  // Mode/Type sub-tabs
  root.querySelectorAll('button[data-mode-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeModeTab = btn.dataset.modeTab;
      _state.activeTypeTab = null;
      render(host); wire(host);
    });
  });
  root.querySelectorAll('button[data-type-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeTypeTab = btn.dataset.typeTab;
      render(host); wire(host);
    });
  });

  // Field checkboxes (включить/выключить поле)
  root.querySelectorAll('.cpe-field-row input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      _saveCurrentFieldsState(host);
    });
  });

  // v0.59.802: editable field labels — change → save в preset.fieldLabels
  root.querySelectorAll('input.cpe-field-label-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const fid = inp.dataset.fieldId;
      const sel = getPresetById(_state.selectedPresetId);
      if (!sel || sel.system) return;
      const kind = _state.activeModeTab, type = _state.activeTypeTab;
      if (!sel.fieldLabels) sel.fieldLabels = {};
      if (!sel.fieldLabels[kind]) sel.fieldLabels[kind] = {};
      if (!sel.fieldLabels[kind][type]) sel.fieldLabels[kind][type] = {};
      const v = (inp.value || '').trim();
      if (v) sel.fieldLabels[kind][type][fid] = v;
      else delete sel.fieldLabels[kind][type][fid];
      // Persist user preset
      const all = loadUserPresets();
      const idx = all.findIndex(p => p.id === sel.id);
      if (idx >= 0) { all[idx] = sel; saveUserPresets(all); }
      // Re-render preview (chips with new labels)
      render(host); wire(host);
    });
    // Не пускать drag когда курсор в input — иначе edit невозможен
    inp.addEventListener('mousedown', e => e.stopPropagation());
  });

  // Drag-drop fields → zones
  _wireDragDrop(root, host);

  // Editable zone labels
  root.querySelectorAll('input.cpe-zone-label').forEach(inp => {
    inp.addEventListener('change', () => {
      const zid = inp.dataset.zoneId;
      const sel = getPresetById(_state.selectedPresetId);
      if (!sel || sel.system) return;
      const layout = getZoneLayout(sel, _state.activeModeTab, _state.activeTypeTab);
      const z = layout.zones.find(x => x.id === zid);
      if (z) { z.label = inp.value; saveZoneLayout(sel, _state.activeModeTab, _state.activeTypeTab, layout); }
    });
  });

  // Chip × — remove field from zone (turn off).
  // v0.59.866: используем delegation на root (не на кнопку), чтобы клик
  // ловился ДО того как браузер передаст mousedown в HTML5-drag родителя
  // (chip имеет draggable="true", и при mousedown на дочернем button
  // браузер мог интерпретировать как drag-grab — клик не срабатывал).
  // Дополнительно навешиваем mousedown stopPropagation на каждую × кнопку,
  // чтобы parent dragstart не запускался при клике по ней.
  root.querySelectorAll('button.cpe-chip-x').forEach(b => {
    b.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    // draggable="false" на самой кнопке — гарантия, что браузер не пытается
    // её drag'ать и не пожирает click.
    b.setAttribute('draggable', 'false');
  });
  // Delegated click — переживёт re-render одной зоны и работает даже
  // если кнопка добавлена позже.
  if (!root._cpeChipXBound) {
    root._cpeChipXBound = true;
    root.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button.cpe-chip-x');
      if (!b || !root.contains(b)) return;
      e.stopPropagation();
      e.preventDefault();
      const fid = b.dataset.fieldId;
      const sel = getPresetById(_state.selectedPresetId);
      if (!sel) return;
      if (sel.system) {
        try { console.warn('[card-presets] системный пресет нельзя редактировать — нажмите 📋 Скопировать'); } catch {}
        return;
      }
      const kind = _state.activeModeTab, type = _state.activeTypeTab;
      const fields = listCardFields(kind, type);
      const required = requiredFieldIds(kind, type);
      const current = new Set(sel.perMode?.[kind]?.perType?.[type] || fields.map(f => f.id));
      current.delete(fid);
      for (const r of required) current.add(r);
      setUserPresetFields(sel.id, kind, type, Array.from(current));
      // Remove from layout assignments
      const layout = getZoneLayout(sel, kind, type);
      delete layout.assignments[fid];
      saveZoneLayout(sel, kind, type, layout);
      render(host); wire(host);
    });
  }

  // Import file
  const importFile = root.querySelector('input[data-action="import-file"]');
  if (importFile) {
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        _importJson(data);
        alert('Импорт успешен.');
        render(host); wire(host);
      } catch (err) { alert(`Ошибка импорта: ${err.message || err}`); }
    });
  }
}

// ─── Draggable
function _wireDraggable(modal, host) {
  const handle = modal.querySelector('[data-cpe-drag-handle]');
  if (!handle) return;
  let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, select')) return;
    dragging = true;
    const rect = modal.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    origX = rect.left; origY = rect.top;
    modal.style.position = 'fixed';
    modal.style.transform = 'none';
    modal.style.left = origX + 'px';
    modal.style.top = origY + 'px';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    modal.style.left = (origX + dx) + 'px';
    modal.style.top = (origY + dy) + 'px';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    const rect = modal.getBoundingClientRect();
    _state.modalPos = { x: rect.left, y: rect.top };
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // Cleanup на close — использован modal removal через host.remove(),
  // global listeners не удаляем (изолированы)
}

// ─── Drag-drop fields → zones
// v0.59.802: используем module-scope _dragFieldId вместо dataTransfer.
// Раньше data-transfer с custom MIME 'text/x-cpe-field-id' не всегда
// возвращал данные при getData (особенно если chip содержит nested
// button × — events не пробрасываются как ожидается). Теперь — простая
// глобальная переменная состояния drag, плюс fallback через
// data-field-id на e.target.closest('[data-field-id]').
// Пользователь: «перемещение между зонами тоже не работает».
let _dragFieldId = null;

function _wireDragDrop(modal, host) {
  // Drag start: chip или field-row
  modal.querySelectorAll('.cpe-chip[draggable="true"], .cpe-field-row[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', e => {
      // Не начинать drag если событие в кнопке × внутри chip — её клик
      // должен обрабатываться отдельно как удаление.
      if (e.target.closest && e.target.closest('button.cpe-chip-x')) {
        e.preventDefault();
        return;
      }
      const fid = el.dataset.fieldId;
      _dragFieldId = fid;
      // Попытаться записать в dataTransfer (для cross-browser совместимости),
      // но НЕ полагаемся на это — основной канал — module-scope variable.
      try { e.dataTransfer.setData('text/plain', fid); } catch {}
      try { e.dataTransfer.effectAllowed = 'move'; } catch {}
      el.classList.add('cpe-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('cpe-dragging');
      _dragFieldId = null;
    });
  });
  // Drop targets — zones
  modal.querySelectorAll('.cpe-zone').forEach(z => {
    z.addEventListener('dragenter', e => {
      e.preventDefault();
      z.classList.add('cpe-zone-hover');
    });
    z.addEventListener('dragover', e => {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch {}
      z.classList.add('cpe-zone-hover');
    });
    z.addEventListener('dragleave', e => {
      // Снимаем hover только если уходим за границы зоны (не к child)
      if (e.relatedTarget && z.contains(e.relatedTarget)) return;
      z.classList.remove('cpe-zone-hover');
    });
    z.addEventListener('drop', e => {
      e.preventDefault();
      z.classList.remove('cpe-zone-hover');
      // Источник — module-scope (надёжнее) или fallback dataTransfer
      let fid = _dragFieldId;
      if (!fid) {
        try { fid = e.dataTransfer.getData('text/plain'); } catch {}
      }
      _dragFieldId = null;
      if (!fid) return;
      const targetZoneId = z.dataset.zoneId;
      const sel = getPresetById(_state.selectedPresetId);
      if (!sel || sel.system) return;
      const kind = _state.activeModeTab, type = _state.activeTypeTab;
      const fields = listCardFields(kind, type);
      const required = requiredFieldIds(kind, type);
      const current = new Set(sel.perMode?.[kind]?.perType?.[type] || fields.map(f => f.id));
      current.add(fid);
      for (const r of required) current.add(r);
      setUserPresetFields(sel.id, kind, type, Array.from(current));
      const layout = getZoneLayout(sel, kind, type);
      layout.assignments[fid] = targetZoneId;
      // v0.59.830: drop на пустую область зоны — append в конец order
      if (!Array.isArray(layout.order)) layout.order = [];
      const _idx = layout.order.indexOf(fid);
      if (_idx >= 0) layout.order.splice(_idx, 1);
      // Append в конец среди тех что в этой зоне
      layout.order.push(fid);
      saveZoneLayout(sel, kind, type, layout);
      render(host); wire(host);
    });
  });
  // v0.59.830: drop на конкретный chip — вставить ПЕРЕД ним в order
  // (для drag-reorder внутри зоны или перемещения между зонами с
  // конкретной позицией).
  modal.querySelectorAll('.cpe-chip[draggable="true"]').forEach(chip => {
    chip.addEventListener('dragover', e => {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch {}
      chip.classList.add('cpe-chip-drop-target');
    });
    chip.addEventListener('dragleave', () => {
      chip.classList.remove('cpe-chip-drop-target');
    });
    chip.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      chip.classList.remove('cpe-chip-drop-target');
      let fid = _dragFieldId;
      if (!fid) { try { fid = e.dataTransfer.getData('text/plain'); } catch {} }
      _dragFieldId = null;
      if (!fid) return;
      const targetFid = chip.dataset.fieldId;
      if (!targetFid || fid === targetFid) return;
      // zone того chip'а на который дропнули
      const zoneEl = chip.closest('.cpe-zone');
      const targetZoneId = zoneEl ? zoneEl.dataset.zoneId : (chip.dataset.fromZone || null);
      const sel = getPresetById(_state.selectedPresetId);
      if (!sel || sel.system) return;
      const kind = _state.activeModeTab, type = _state.activeTypeTab;
      const fields = listCardFields(kind, type);
      const required = requiredFieldIds(kind, type);
      const current = new Set(sel.perMode?.[kind]?.perType?.[type] || fields.map(f => f.id));
      current.add(fid);
      for (const r of required) current.add(r);
      setUserPresetFields(sel.id, kind, type, Array.from(current));
      const layout = getZoneLayout(sel, kind, type);
      if (targetZoneId) layout.assignments[fid] = targetZoneId;
      if (!Array.isArray(layout.order)) layout.order = [];
      // Удалить fid из order если уже есть
      const _idxOld = layout.order.indexOf(fid);
      if (_idxOld >= 0) layout.order.splice(_idxOld, 1);
      // Найти позицию targetFid и вставить ПЕРЕД ним
      const _idxTarget = layout.order.indexOf(targetFid);
      if (_idxTarget >= 0) {
        layout.order.splice(_idxTarget, 0, fid);
      } else {
        // targetFid ещё не в order — добавляем сначала targetFid, потом fid перед ним
        layout.order.push(fid);
        layout.order.push(targetFid);
      }
      saveZoneLayout(sel, kind, type, layout);
      render(host); wire(host);
    });
  });
}

function _bulkSetFields(allOn) {
  const sel = getPresetById(_state.selectedPresetId);
  if (!sel || sel.system) return;
  const fields = listCardFields(_state.activeModeTab, _state.activeTypeTab);
  const ids = allOn ? fields.map(f => f.id) : requiredFieldIds(_state.activeModeTab, _state.activeTypeTab);
  setUserPresetFields(sel.id, _state.activeModeTab, _state.activeTypeTab, ids);
}

function _saveCurrentFieldsState(host) {
  const sel = getPresetById(_state.selectedPresetId);
  if (!sel || sel.system) return;
  const checked = Array.from(host.querySelectorAll('.cpe-field-row input[type=checkbox]:checked'))
    .map(cb => cb.dataset.fieldId);
  setUserPresetFields(sel.id, _state.activeModeTab, _state.activeTypeTab, checked);
  render(host); wire(host);
}

function _exportJson() {
  const data = {
    schema: 'raschet.cardPresets/1',
    exportedAt: new Date().toISOString(),
    presets: loadUserPresets(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `card-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function _importJson(data) {
  if (!data || !Array.isArray(data.presets)) throw new Error('Неверный формат: нет presets[]');
  const cur = loadUserPresets();
  const byId = new Map(cur.map(p => [p.id, p]));
  for (const p of data.presets) {
    if (!p || !p.id) continue;
    p.system = false;
    byId.set(p.id, p);
  }
  saveUserPresets(Array.from(byId.values()));
}

// ─── Public API
export function openCardPresetEditor() {
  if (!document.getElementById('cpe-styles')) {
    const style = document.createElement('style');
    style.id = 'cpe-styles';
    style.textContent = CPE_CSS;
    document.head.appendChild(style);
  }
  const host = document.createElement('div');
  host.className = 'cpe-overlay';
  document.body.appendChild(host);
  render(host);
  wire(host);
}

const CPE_CSS = `
.cpe-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.cpe-modal {
  background: #fff; border-radius: 8px;
  width: min(1100px, 96vw); max-height: 92vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}
.cpe-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #e5e7eb;
  cursor: move;
  user-select: none;
}
.cpe-head h2 { margin: 0; font-size: 17px; color: #111827; pointer-events: none; }
.cpe-close {
  background: none; border: none; font-size: 22px; cursor: pointer; color: #6b7280;
  padding: 0 6px;
}
.cpe-close:hover { color: #111827; }
.cpe-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid #e5e7eb; padding: 0 14px;
}
.cpe-tab {
  border: none; background: none; padding: 10px 16px;
  font-size: 13px; cursor: pointer; color: #6b7280;
  border-bottom: 2px solid transparent;
}
.cpe-tab:hover { color: #111827; }
.cpe-tab.active { color: #1e40af; border-bottom-color: #1e40af; font-weight: 600; }
.cpe-tab:disabled { color: #9ca3af; cursor: not-allowed; }
.cpe-body {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 14px 18px;
}

/* ─── Presets tab */
.cpe-pane { display: flex; flex-direction: column; gap: 14px; }
.cpe-pane-section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
.cpe-pane-section h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.4px; }
.cpe-pane-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cpe-pane-section-head h3 { margin: 0; }
.cpe-presets-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.cpe-preset-card {
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 5px;
  padding: 10px 12px; cursor: pointer;
}
.cpe-preset-card:hover { border-color: #93c5fd; background: #f0f9ff; }
.cpe-preset-card.selected { border-color: #4f46e5; background: #eef2ff; }
.cpe-preset-card.active { box-shadow: 0 0 0 2px #16a34a inset; }
.cpe-preset-name { font-weight: 600; font-size: 13px; color: #111827; }
.cpe-preset-desc { font-size: 11px; margin-top: 4px; line-height: 1.4; }
.cpe-preset-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.cpe-badge-active { background: #dcfce7; color: #15803d; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 500; }
.cpe-badge-sys { background: #f3f4f6; color: #6b7280; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 500; }
.cpe-btn { padding: 6px 12px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
.cpe-btn:hover { background: #f9fafb; }
.cpe-btn-primary { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.cpe-btn-primary:hover { background: #4338ca; }
.cpe-btn-sm { padding: 3px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 3px; cursor: pointer; font-size: 11px; }
.cpe-btn-sm:hover { background: #f9fafb; }
.cpe-btn-danger { color: #c62828; border-color: #fca5a5; }
.cpe-btn-danger:hover { background: #fef2f2; }
.cpe-empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 12.5px; }
.cpe-info { padding: 10px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 4px; font-size: 11.5px; line-height: 1.5; color: #0c4a6e; }

/* ─── Поля tab — split layout */
.cpe-pane-split { gap: 10px; }
.cpe-mode-tabs, .cpe-type-tabs { display: flex; gap: 4px; padding: 4px 6px; background: #f3f4f6; border-radius: 5px; }
.cpe-subtab { padding: 4px 10px; border: 1px solid transparent; background: transparent; border-radius: 3px; cursor: pointer; font-size: 11.5px; color: #6b7280; }
.cpe-subtab:hover { background: #fff; color: #111827; }
.cpe-subtab.active { background: #fff; color: #1e40af; border-color: #93c5fd; font-weight: 600; }

.cpe-split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}
.cpe-split-left {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px;
  max-height: 60vh; overflow-y: auto;
}
.cpe-split-right {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 5px; padding: 12px;
  position: sticky; top: 0;
}
.cpe-fields-toolbar { display: flex; gap: 6px; padding-bottom: 6px; align-items: center; }
.cpe-fields-group { margin-bottom: 10px; }
.cpe-fields-group h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; }
.cpe-field-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 3px;
  font-size: 11.5px; margin-bottom: 3px;
  cursor: grab;
}
.cpe-field-row:hover { background: #f0f9ff; border-color: #93c5fd; }
.cpe-field-row.cpe-field-required { background: #fef3c7; border-color: #fcd34d; cursor: default; }
.cpe-field-row.cpe-field-off { opacity: 0.55; cursor: default; }
.cpe-field-handle {
  font-size: 11px; color: #94a3b8; cursor: grab;
  user-select: none; min-width: 14px; text-align: center;
  font-weight: 600;
}
.cpe-field-row[draggable="true"] .cpe-field-handle:hover { color: #4f46e5; }
.cpe-field-row[draggable="false"] .cpe-field-handle { cursor: default; }
.cpe-field-label { flex: 1; }
.cpe-field-label-input {
  flex: 1; min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  font: inherit; font-size: 11.5px; color: #1f2937;
  padding: 2px 5px; border-radius: 3px;
}
.cpe-field-label-input:hover { border-color: #cbd5e1; background: #fff; }
.cpe-field-label-input:focus {
  border-color: #4f46e5;
  background: #fff;
  outline: none;
  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);
}
.cpe-field-id { font-size: 10px; }
.cpe-field-zone-mark { font-size: 9.5px; padding: 1px 5px; background: #eef2ff; color: #4f46e5; border-radius: 2px; }
.cpe-field-req { font-size: 9.5px; color: #92400e; font-weight: 600; padding: 1px 5px; background: #fbbf24; border-radius: 2px; }

/* Card preview */
.cpe-preview-header { display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; }
.cpe-card-preview {
  border: 2px solid #1e40af; border-radius: 6px; padding: 8px; background: #fafbff;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 280px;
}
.cpe-card-row { display: flex; gap: 6px; }
.cpe-card-row-top .cpe-card-col-main { flex: 1; }
.cpe-card-row-top .cpe-card-col-side { width: 130px; }
.cpe-card-row-body { flex: 1; }
.cpe-card-row-foot { border-top: 1px dashed #cbd5e1; padding-top: 6px; }
.cpe-zone {
  border: 1.5px dashed #cbd5e1; border-radius: 4px; padding: 5px 8px;
  background: #fff;
  min-height: 40px;
  flex: 1;
  transition: border-color 0.1s, background 0.1s;
}
.cpe-zone-hover { border-color: #4f46e5; background: #eef2ff; }
.cpe-zone-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.cpe-zone-label {
  border: 1px solid transparent; background: transparent;
  font-size: 10px; font-weight: 600; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.3px;
  padding: 1px 4px; border-radius: 2px;
  width: 100%;
}
.cpe-zone-label:hover, .cpe-zone-label:focus { border-color: #93c5fd; background: #fff; outline: none; color: #1e40af; }
.cpe-zone-cnt { font-size: 9.5px; }
.cpe-zone-chips { display: flex; flex-wrap: wrap; gap: 4px; min-height: 22px; }
.cpe-zone-empty { font-size: 10px; padding: 4px; font-style: italic; }
.cpe-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px;
  background: #dbeafe; color: #1e3a8a; border: 1px solid #93c5fd; border-radius: 11px;
  font-size: 10.5px; cursor: grab;
}
.cpe-chip:hover { background: #bfdbfe; }
.cpe-chip-req { background: #fef3c7; color: #78350f; border-color: #fcd34d; }
.cpe-chip-x {
  background: none; border: none; cursor: pointer;
  color: #c62828; font-size: 12px; padding: 0 2px;
  line-height: 1;
}
.cpe-chip-x:hover { color: #7f1d1d; }
.cpe-dragging { opacity: 0.5; }
.cpe-preview-legend { font-size: 11px; line-height: 1.4; padding: 6px 8px; background: #f9fafb; border-radius: 3px; margin-top: 8px; }

/* v0.59.806: rendered sample card preview */
.cpe-rendered-preview-wrap {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #cbd5e1;
}
.cpe-rendered-preview-head { margin-bottom: 6px; }
.cpe-sample-card {
  position: relative;
  border: 2px solid #1e40af; border-radius: 6px;
  padding: 10px 14px;
  background: #fff;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  min-height: 80px;
}
.cpe-sample-card-zoned {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px;
}
.cpe-sample-row-top { display: flex; gap: 8px; align-items: flex-start; }
.cpe-sample-zone {
  background: #fafbff;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  padding: 4px 6px;
  min-height: 24px;
}
.cpe-sample-zone-header { flex: 1; }
.cpe-sample-zone-topright { width: 110px; }
.cpe-sample-zone-body { min-height: 30px; padding: 6px 8px; }
.cpe-sample-zone-footer { padding: 4px 6px; min-height: 18px; }
.cpe-sample-icon-inline { font-size: 16px; color: #94a3b8; }
.cpe-sample-tag { font-size: 14px; font-weight: 700; color: #1e3a8a; }
.cpe-sample-name { font-size: 12px; color: #475569; margin-top: 2px; }
.cpe-sample-subtitle { font-size: 10.5px; margin-top: 2px; color: #94a3b8; font-style: italic; }
.cpe-sample-row { font-size: 11px; color: #1f2937; font-variant-numeric: tabular-nums; padding: 1px 0; }
.cpe-sample-empty { font-size: 10px; padding: 2px 0; font-style: italic; }

.muted { color: #6b7280; }
`;
