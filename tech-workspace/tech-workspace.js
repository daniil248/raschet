// =========================================================================
// tech-workspace.js — v0.59.784 (Phase 20.1, multi-group rebuild)
//
// Пользователь (2026-04-30): «по стойкам может быть несколько групп стоек с разной
// мощностью, так же и ИБП могут быть разные для IT и для кондиционирования.
// PDU тоже в рамках стойки конфигурируется».
//
// Data shape:
//   variant.concept = {
//     rackGroups: [{
//       id, name, count, kwPerRack, profile, widthMm, depthMm, modelRef,
//       pdu: { kind, phases, ratingA, inputsPerRack, modelRef }   ← per group
//     }],
//     upsSystems: [{
//       id, name, purpose: 'it'|'cooling'|'mixed',
//       count, ratedKva, redundancy, cosPhi, loadFactor,
//       autonomyMin, batteryTech, modelRef
//     }],
//     coolingUnits: [{
//       id, name, count, kwPerUnit, type, redundancy, modelRef
//     }],
//     feed: { tp: {...}, dgu: {...} }
//   }
// =========================================================================

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';

const $ = (id) => document.getElementById(id);

// ─── State
let _pid = null;
let _variants = [];
let _activeId = null;
let _mode = 'list';

// ─── Storage
const KEY_VARIANTS = ['tech-workspace', 'variants.v1'];
const KEY_ACTIVE = ['tech-workspace', 'activeVariantId.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try {
    const raw = localStorage.getItem(projectKey(_pid, ...suffix));
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}

// ─── ID generator
function _newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

// ─── Default factories
function newRackGroup(name) {
  return {
    id: _newId('rg'),
    name: name || 'Группа стоек',
    count: 0, kwPerRack: 0, profile: 'it',
    widthMm: 600, depthMm: 1200,
    modelRef: null,
    pdu: { kind: 'metered', phases: '3ph', ratingA: 32, inputsPerRack: 2, modelRef: null },
  };
}
function newUpsSystem(name, purpose) {
  return {
    id: _newId('us'),
    name: name || (purpose === 'cooling' ? 'ИБП климат' : 'ИБП IT'),
    purpose: purpose || 'it',
    count: 2, ratedKva: 0, redundancy: 'N+1',
    cosPhi: 0.95, loadFactor: 0.8, autonomyMin: 15, batteryTech: 'vrla',
    modelRef: null,
  };
}
function newCoolingUnit(name) {
  return {
    id: _newId('cu'),
    name: name || 'Климат',
    count: 3, kwPerUnit: 0, type: 'crac', redundancy: 'N+1',
    modelRef: null,
  };
}

// ─── Variant data shape
function newVariant(name) {
  return {
    id: 'v-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Базовый вариант',
    primary: false,
    readOnly: false,
    createdAt: Date.now(),
    concept: {
      rackGroups: [newRackGroup('Стойки IT')],
      upsSystems: [newUpsSystem('ИБП IT', 'it')],
      coolingUnits: [newCoolingUnit('Климат')],
      feed: {
        tp: { needed: false, kva: 0, redundancy: '2', modelRef: null },
        dgu: { needed: false, kw: 0, mode: 'esp', redundancy: 'N+1', modelRef: null },
      },
    },
  };
}

// ─── Migration: backward-compat для старых variants со скалярными полями
function migrateVariant(v) {
  if (!v || !v.concept) return v;
  const c = v.concept;
  // racks (single) → rackGroups[]
  if (!Array.isArray(c.rackGroups)) {
    if (c.racks) {
      const rg = newRackGroup('Стойки IT');
      Object.assign(rg, {
        count: c.racks.count || 0,
        kwPerRack: c.racks.kwPerRack || 0,
        profile: c.racks.profile || 'it',
        widthMm: c.racks.widthMm || 600,
        depthMm: c.racks.depthMm || 1200,
        modelRef: c.racks.modelRef || null,
      });
      // pdu из старой schema жил как concept.pdu (один на всё) — копируем
      // в первую группу.
      if (c.pdu) {
        rg.pdu = {
          kind: c.pdu.kind || 'metered',
          phases: c.pdu.phases || '3ph',
          ratingA: Number(c.pdu.ratingA) || 32,
          inputsPerRack: Number(c.pdu.inputsPerRack) || 2,
          modelRef: c.pdu.modelRef || null,
        };
      }
      c.rackGroups = [rg];
    } else {
      c.rackGroups = [newRackGroup('Стойки IT')];
    }
    delete c.racks;
    delete c.pdu;
  }
  // ups (single) → upsSystems[]
  if (!Array.isArray(c.upsSystems)) {
    if (c.ups) {
      const us = newUpsSystem('ИБП IT', 'it');
      Object.assign(us, {
        count: c.ups.count || 2,
        ratedKva: c.ups.ratedKva || 0,
        redundancy: c.ups.redundancy || 'N+1',
        cosPhi: c.ups.cosPhi || 0.95,
        loadFactor: c.ups.loadFactor || 0.8,
        autonomyMin: c.ups.autonomyMin || 15,
        batteryTech: c.ups.batteryTech || 'vrla',
        modelRef: c.ups.modelRef || null,
      });
      c.upsSystems = [us];
    } else {
      c.upsSystems = [newUpsSystem('ИБП IT', 'it')];
    }
    delete c.ups;
  }
  // cooling (single) → coolingUnits[]
  if (!Array.isArray(c.coolingUnits)) {
    if (c.cooling) {
      const cu = newCoolingUnit('Климат');
      Object.assign(cu, {
        count: c.cooling.count || 3,
        kwPerUnit: c.cooling.kwPerUnit || 0,
        type: c.cooling.type || 'crac',
        redundancy: c.cooling.redundancy || 'N+1',
        modelRef: c.cooling.modelRef || null,
      });
      c.coolingUnits = [cu];
    } else {
      c.coolingUnits = [newCoolingUnit('Климат')];
    }
    delete c.cooling;
  }
  if (!c.feed) c.feed = {
    tp: { needed: false, kva: 0, redundancy: '2', modelRef: null },
    dgu: { needed: false, kw: 0, mode: 'esp', redundancy: 'N+1', modelRef: null },
  };
  return v;
}

// ─── Calculations
function calcITTotal(c) {
  // Сумма по всем rack-группам с profile in {it, blade, gpu, storage} (не network)
  return (c.rackGroups || []).reduce((s, rg) => {
    if (rg.profile === 'network') return s; // network — не IT-нагрузка
    return s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
  }, 0);
}
function calcRackGroupKw(rg) {
  return (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
}
function calcMachroomArea(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  return Math.round(N * 2.5 * 1.4);
}
function _upsAvail(us) {
  const count = Number(us.count) || 0;
  const reserve = us.redundancy === 'N+1' ? 1 : (us.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  const kva = Number(us.ratedKva) || 0;
  const cos = Number(us.cosPhi) || 0.95;
  const lf = Number(us.loadFactor) || 0.8;
  return Math.round(N * kva * cos * lf * 10) / 10;
}
function calcUpsByPurpose(c) {
  const out = { it: 0, cooling: 0, mixed: 0, total: 0 };
  for (const us of (c.upsSystems || [])) {
    const kw = _upsAvail(us);
    out[us.purpose || 'it'] = (out[us.purpose || 'it'] || 0) + kw;
    out.total += kw;
  }
  return out;
}
function _coolAvail(cu) {
  const count = Number(cu.count) || 0;
  const reserve = cu.redundancy === 'N+1' ? 1 : (cu.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  return Math.round(N * (Number(cu.kwPerUnit) || 0) * 10) / 10;
}
function calcCoolTotal(c) {
  return (c.coolingUnits || []).reduce((s, cu) => s + _coolAvail(cu), 0);
}
function calcFeedTotal(c) {
  const itTotal = calcITTotal(c);
  const climateLoss = itTotal * 0.3;
  const totalNeeded = itTotal + climateLoss;
  const tp = c.feed?.tp?.needed ? Number(c.feed.tp.kva) || 0 : 0;
  return Math.max(totalNeeded, tp * 0.8);
}
function calcAreas(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  const upsCount = (c.upsSystems || []).reduce((s, us) => s + (Number(us.count) || 0), 0);
  const upsKvaTotal = (c.upsSystems || []).reduce((s, us) => s + (Number(us.ratedKva) || 0) * (Number(us.count) || 0), 0);
  const hasVrla = (c.upsSystems || []).some(us => us.batteryTech === 'vrla');
  const coolCount = (c.coolingUnits || []).reduce((s, cu) => s + (Number(cu.count) || 0), 0);
  const areas = [
    { name: 'Машзал (стойки)', m2: Math.max(20, Math.round(N * 2.5 * 1.4)) },
    { name: 'ИБП-зал', m2: Math.max(15, Math.round(upsCount * 4)) },
    { name: 'АКБ-зал (VRLA)', m2: hasVrla ? Math.max(10, Math.round(upsKvaTotal * 0.012)) : 0 },
    { name: 'Климат-зал', m2: Math.max(20, Math.round(coolCount * 6)) },
    { name: 'ТП', m2: c.feed.tp.needed ? Math.max(20, Math.round((Number(c.feed.tp.kva) || 0) * 0.025)) : 0 },
    { name: 'ДГУ-зал', m2: c.feed.dgu.needed ? Math.max(30, Math.round((Number(c.feed.dgu.kw) || 0) * 0.04)) : 0 },
    { name: 'Склад', m2: 15 },
    { name: 'Диспетчерская', m2: 12 },
  ].filter(a => a.m2 > 0);
  return areas;
}

// ─── Render: variants list (sidebar)
function renderVariantsList() {
  const root = $('tw-variants-list');
  if (!root) return;
  if (!_variants.length) {
    root.innerHTML = '<div class="muted tw-no-variants">Нет вариантов. Нажмите ➕</div>';
    return;
  }
  root.innerHTML = _variants.map(v => {
    const active = v.id === _activeId ? ' active' : '';
    const primary = v.primary ? ' <span class="tw-badge-primary" title="Основной вариант">⭐</span>' : '';
    const readonly = v.readOnly ? ' <span class="tw-badge-readonly" title="Передан в проектирование">🔒</span>' : '';
    return `<div class="tw-variant-row${active}" data-vid="${v.id}">
      <span class="tw-variant-name" title="${escAttr(v.name)}">${escHtml(v.name)}</span>
      ${primary}${readonly}
      <span class="tw-variant-actions">
        <button type="button" data-act="primary" data-vid="${v.id}" title="Сделать основным">⭐</button>
        <button type="button" data-act="duplicate" data-vid="${v.id}" title="Дублировать">📋</button>
        <button type="button" data-act="delete" data-vid="${v.id}" title="Удалить">🗑</button>
      </span>
    </div>`;
  }).join('');
}

// ─── Render: bind-button HTML helper
function _bindBtnHtml(domain, refId, modelRef) {
  const has = !!(modelRef && modelRef.id);
  const txt = has
    ? `📦 ${escHtml((modelRef.manufacturer || '') + ' ' + (modelRef.model || ''))} ✏`
    : '📦 Привязать модель…';
  const cls = has ? 'tw-bind-btn tw-bind-btn-bound' : 'tw-bind-btn';
  return `<button type="button" class="${cls}" data-bind-domain="${domain}" data-ref-id="${escAttr(refId)}">${txt}</button>`;
}

// ─── Render: rack group card
function renderRackGroupCard(rg, isReadOnly) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = calcRackGroupKw(rg);
  return `<div class="tw-card" data-card-kind="rack" data-card-id="${rg.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(rg.name)}" placeholder="Название группы" ${ro}>
      <span class="tw-card-summary muted">${rg.count} × ${rg.kwPerRack} кВт = ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить группу" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      <label>Кол-во стоек:<input type="number" data-field="count" min="0" step="1" value="${rg.count}" ${ro}></label>
      <label>Мощность на стойку, кВт:<input type="number" data-field="kwPerRack" min="0" step="0.5" value="${rg.kwPerRack}" ${ro}></label>
      <label>Профиль:
        <select data-field="profile" ${ro}>
          <option value="it"${rg.profile === 'it' ? ' selected' : ''}>IT-rack</option>
          <option value="blade"${rg.profile === 'blade' ? ' selected' : ''}>Blade</option>
          <option value="gpu"${rg.profile === 'gpu' ? ' selected' : ''}>GPU-heavy</option>
          <option value="network"${rg.profile === 'network' ? ' selected' : ''}>Network</option>
          <option value="storage"${rg.profile === 'storage' ? ' selected' : ''}>Storage</option>
        </select>
      </label>
      <label>Ширина, мм:<input type="number" data-field="widthMm" min="600" step="100" value="${rg.widthMm}" ${ro}></label>
      <label>Глубина, мм:<input type="number" data-field="depthMm" min="800" step="100" value="${rg.depthMm}" ${ro}></label>
    </div>
    ${_bindBtnHtml('rack', rg.id, rg.modelRef)}
    <!-- PDU sub-section внутри группы стоек (юзер: «PDU тоже в рамках стойки конфигурируется») -->
    <div class="tw-subsection">
      <h5>🔌 PDU для этой группы</h5>
      <div class="tw-grid">
        <label>Тип:
          <select data-field="pdu.kind" ${ro}>
            <option value="basic"${rg.pdu.kind === 'basic' ? ' selected' : ''}>Basic</option>
            <option value="metered"${rg.pdu.kind === 'metered' ? ' selected' : ''}>Metered</option>
            <option value="switched"${rg.pdu.kind === 'switched' ? ' selected' : ''}>Switched</option>
            <option value="monitored"${rg.pdu.kind === 'monitored' ? ' selected' : ''}>Monitored</option>
          </select>
        </label>
        <label>Фазность:
          <select data-field="pdu.phases" ${ro}>
            <option value="1ph"${rg.pdu.phases === '1ph' ? ' selected' : ''}>1ф</option>
            <option value="3ph"${rg.pdu.phases === '3ph' ? ' selected' : ''}>3ф</option>
          </select>
        </label>
        <label>Ток на ввод, А:
          <select data-field="pdu.ratingA" ${ro}>
            <option value="16"${rg.pdu.ratingA === 16 ? ' selected' : ''}>16</option>
            <option value="32"${rg.pdu.ratingA === 32 ? ' selected' : ''}>32</option>
            <option value="63"${rg.pdu.ratingA === 63 ? ' selected' : ''}>63</option>
          </select>
        </label>
        <label>Вводов на стойку:
          <select data-field="pdu.inputsPerRack" ${ro}>
            <option value="1"${rg.pdu.inputsPerRack === 1 ? ' selected' : ''}>1</option>
            <option value="2"${rg.pdu.inputsPerRack === 2 ? ' selected' : ''}>2 (N+1 / 2N)</option>
            <option value="4"${rg.pdu.inputsPerRack === 4 ? ' selected' : ''}>4</option>
          </select>
        </label>
      </div>
      ${_bindBtnHtml('pdu', rg.id, rg.pdu.modelRef)}
    </div>
  </div>`;
}

// ─── Render: ups system card
function renderUpsCard(us, isReadOnly) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = _upsAvail(us);
  return `<div class="tw-card" data-card-kind="ups" data-card-id="${us.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(us.name)}" placeholder="Название" ${ro}>
      <span class="tw-card-summary muted">${us.count} × ${us.ratedKva} кВА · доступно ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить систему" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      <label>Назначение:
        <select data-field="purpose" ${ro}>
          <option value="it"${us.purpose === 'it' ? ' selected' : ''}>⚡ IT-нагрузка</option>
          <option value="cooling"${us.purpose === 'cooling' ? ' selected' : ''}>❄ Климат / кондиционирование</option>
          <option value="mixed"${us.purpose === 'mixed' ? ' selected' : ''}>🔄 Смешанное</option>
        </select>
      </label>
      <label>Кол-во ИБП:<input type="number" data-field="count" min="1" step="1" value="${us.count}" ${ro}></label>
      <label>Номинал, кВА:<input type="number" data-field="ratedKva" min="0" step="50" value="${us.ratedKva}" ${ro}></label>
      <label>Резервирование:
        <select data-field="redundancy" ${ro}>
          <option value="N"${us.redundancy === 'N' ? ' selected' : ''}>N (без резерва)</option>
          <option value="N+1"${us.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
          <option value="2N"${us.redundancy === '2N' ? ' selected' : ''}>2N</option>
        </select>
      </label>
      <label>cos φ:<input type="number" data-field="cosPhi" min="0.5" max="1" step="0.01" value="${us.cosPhi}" ${ro}></label>
      <label>Загрузка, %:<input type="number" data-field="loadFactor" min="20" max="95" step="5" value="${Math.round((us.loadFactor || 0.8) * 100)}" ${ro}></label>
      <label>Автономия, мин:<input type="number" data-field="autonomyMin" min="5" step="5" value="${us.autonomyMin}" ${ro}></label>
      <label>Тип АКБ:
        <select data-field="batteryTech" ${ro}>
          <option value="vrla"${us.batteryTech === 'vrla' ? ' selected' : ''}>VRLA</option>
          <option value="lifepo4"${us.batteryTech === 'lifepo4' ? ' selected' : ''}>Li-Ion (LFP)</option>
        </select>
      </label>
    </div>
    ${_bindBtnHtml('ups', us.id, us.modelRef)}
  </div>`;
}

// ─── Render: cooling unit card
function renderCoolCard(cu, isReadOnly) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = _coolAvail(cu);
  return `<div class="tw-card" data-card-kind="cool" data-card-id="${cu.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(cu.name)}" placeholder="Название" ${ro}>
      <span class="tw-card-summary muted">${cu.count} × ${cu.kwPerUnit} кВт холода · доступно ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      <label>Кол-во кондиционеров:<input type="number" data-field="count" min="1" step="1" value="${cu.count}" ${ro}></label>
      <label>Холод на единицу, кВт:<input type="number" data-field="kwPerUnit" min="0" step="5" value="${cu.kwPerUnit}" ${ro}></label>
      <label>Тип:
        <select data-field="type" ${ro}>
          <option value="crac"${cu.type === 'crac' ? ' selected' : ''}>CRAC (downflow)</option>
          <option value="inrow"${cu.type === 'inrow' ? ' selected' : ''}>In-Row</option>
          <option value="fancoil"${cu.type === 'fancoil' ? ' selected' : ''}>Fan-coil</option>
          <option value="freecool"${cu.type === 'freecool' ? ' selected' : ''}>Free cooling</option>
        </select>
      </label>
      <label>Резервирование:
        <select data-field="redundancy" ${ro}>
          <option value="N"${cu.redundancy === 'N' ? ' selected' : ''}>N</option>
          <option value="N+1"${cu.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
          <option value="2N"${cu.redundancy === '2N' ? ' selected' : ''}>2N</option>
        </select>
      </label>
    </div>
    ${_bindBtnHtml('cool', cu.id, cu.modelRef)}
  </div>`;
}

// ─── Render: feed (TP/DGU)
function renderFeedSection(feed, isReadOnly) {
  const ro = isReadOnly ? 'disabled' : '';
  return `<div class="tw-grid">
    <label class="tw-checkbox"><input type="checkbox" data-field="tp.needed"${feed.tp.needed ? ' checked' : ''} ${ro}> ТП требуется</label>
    <label>Мощность ТП, кВА:<input type="number" data-field="tp.kva" min="0" step="100" value="${feed.tp.kva}" ${ro}></label>
    <label>Резервирование ТП:
      <select data-field="tp.redundancy" ${ro}>
        <option value="1"${feed.tp.redundancy === '1' ? ' selected' : ''}>1 ввод</option>
        <option value="2"${feed.tp.redundancy === '2' ? ' selected' : ''}>2 ввода</option>
        <option value="2-avr"${feed.tp.redundancy === '2-avr' ? ' selected' : ''}>2 ввода + АВР</option>
      </select>
    </label>
    <label class="tw-checkbox"><input type="checkbox" data-field="dgu.needed"${feed.dgu.needed ? ' checked' : ''} ${ro}> ДГУ требуется</label>
    <label>Мощность ДГУ, кВт:<input type="number" data-field="dgu.kw" min="0" step="100" value="${feed.dgu.kw}" ${ro}></label>
    <label>Режим ДГУ:
      <select data-field="dgu.mode" ${ro}>
        <option value="esp"${feed.dgu.mode === 'esp' ? ' selected' : ''}>ESP (резерв)</option>
        <option value="prp"${feed.dgu.mode === 'prp' ? ' selected' : ''}>PRP (постоянное)</option>
      </select>
    </label>
    <label>Резервирование ДГУ:
      <select data-field="dgu.redundancy" ${ro}>
        <option value="none"${feed.dgu.redundancy === 'none' ? ' selected' : ''}>Нет</option>
        <option value="N+1"${feed.dgu.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
        <option value="2N"${feed.dgu.redundancy === '2N' ? ' selected' : ''}>2N</option>
      </select>
    </label>
  </div>
  <div class="tw-summary">
    <button type="button" class="tw-bind-btn ${feed.tp.modelRef ? 'tw-bind-btn-bound' : ''}" data-bind-domain="tp" data-ref-id="feed-tp">📦 ${feed.tp.modelRef ? escHtml((feed.tp.modelRef.manufacturer || '') + ' ' + (feed.tp.modelRef.model || '')) + ' ✏' : 'Привязать модель ТП'}</button>
    <button type="button" class="tw-bind-btn ${feed.dgu.modelRef ? 'tw-bind-btn-bound' : ''}" data-bind-domain="dgu" data-ref-id="feed-dgu">📦 ${feed.dgu.modelRef ? escHtml((feed.dgu.modelRef.manufacturer || '') + ' ' + (feed.dgu.modelRef.model || '')) + ' ✏' : 'Привязать модель ДГУ'}</button>
  </div>`;
}

// ─── Render: compare mode (multi-variant side-by-side, Phase 20.10)
function renderCompareMode() {
  const pane = $('tw-mode-compare');
  if (!pane) return;
  if (_variants.length === 0) {
    pane.innerHTML = '<div class="tw-empty-state"><div><h3>Нет вариантов</h3><p class="muted">Создайте 2+ варианта в левой панели для сравнения.</p></div></div>';
    return;
  }
  // Build rows: each метрика — строка, варианты — колонки
  const rows = [
    { label: '⭐ Основной', get: v => v.primary ? '★' : '' },
    { label: '🔒 Передан в проектирование', get: v => v.readOnly ? `да (${new Date(v.handoffAt || 0).toLocaleDateString()})` : 'нет' },
    { label: '— Стойки —', isHeader: true },
    { label: 'Кол-во групп стоек', get: v => (v.concept.rackGroups || []).length },
    { label: 'Σ стоек', get: v => (v.concept.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0) },
    { label: 'Σ IT-нагрузка, кВт', get: v => calcITTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— ИБП —', isHeader: true },
    { label: 'Кол-во систем ИБП', get: v => (v.concept.upsSystems || []).length },
    { label: 'Σ ИБП IT доступно, кВт', get: v => {
      const u = calcUpsByPurpose(v.concept);
      return (u.it + u.mixed).toFixed(1);
    }, highlight: 'kw' },
    { label: 'Σ ИБП климат доступно, кВт', get: v => {
      const u = calcUpsByPurpose(v.concept);
      return (u.cooling + u.mixed).toFixed(1);
    } },
    { label: '— Климат —', isHeader: true },
    { label: 'Кол-во групп кондиц.', get: v => (v.concept.coolingUnits || []).length },
    { label: 'Σ холод доступен, кВт', get: v => calcCoolTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— Ввод —', isHeader: true },
    { label: 'ТП', get: v => v.concept.feed?.tp?.needed ? `${v.concept.feed.tp.kva} кВА` : '—' },
    { label: 'ДГУ', get: v => v.concept.feed?.dgu?.needed ? `${v.concept.feed.dgu.kw} кВт (${v.concept.feed.dgu.mode})` : '—' },
    { label: 'Σ принятая мощность, кВт', get: v => calcFeedTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— Площади —', isHeader: true },
    { label: 'Σ площадь, м²', get: v => calcAreas(v.concept).reduce((s, a) => s + a.m2, 0), highlight: 'm2' },
  ];
  // Find max for highlighting
  const maxBy = {};
  for (const r of rows) {
    if (!r.highlight) continue;
    const vals = _variants.map(v => Number(r.get(v)) || 0);
    maxBy[r.label] = Math.max(...vals);
  }
  pane.innerHTML = `<div class="tw-compare-wrap">
    <div class="tw-compare-toolbar">
      <span class="muted">Сравнение ${_variants.length} вариантов. Лучшие значения подсвечены зелёным (где больше = лучше).</span>
    </div>
    <table class="tw-compare-table">
      <thead>
        <tr>
          <th class="tw-compare-metric">Параметр</th>
          ${_variants.map(v => `<th class="tw-compare-variant${v.id === _activeId ? ' active' : ''}">${escHtml(v.name)}${v.primary ? ' ⭐' : ''}${v.readOnly ? ' 🔒' : ''}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          if (r.isHeader) {
            return `<tr class="tw-compare-section-row"><td colspan="${_variants.length + 1}">${escHtml(r.label)}</td></tr>`;
          }
          return `<tr>
            <td class="tw-compare-metric">${escHtml(r.label)}</td>
            ${_variants.map(v => {
              const val = r.get(v);
              const num = Number(val);
              const isBest = r.highlight && Number.isFinite(num) && num === maxBy[r.label] && num > 0;
              return `<td class="tw-compare-cell${isBest ? ' best' : ''}">${escHtml(val == null ? '—' : val)}</td>`;
            }).join('')}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

// ─── Render: active variant (right pane)
function renderActiveVariant() {
  const v = _variants.find(x => x.id === _activeId);
  const empty = $('tw-empty-state');
  const listPane = $('tw-mode-list');
  const planPane = $('tw-mode-plan');
  const comparePane = $('tw-mode-compare');
  const handoffBtn = $('tw-handoff');
  if (!v) {
    if (empty) empty.style.display = 'flex';
    if (listPane) listPane.hidden = true;
    if (planPane) planPane.hidden = true;
    if (comparePane) comparePane.hidden = true;
    if (handoffBtn) handoffBtn.disabled = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (handoffBtn) handoffBtn.disabled = !!v.readOnly;
  if (listPane) listPane.hidden = (_mode !== 'list');
  if (planPane) planPane.hidden = (_mode !== 'plan');
  if (comparePane) comparePane.hidden = (_mode !== 'compare');
  if (_mode === 'compare') renderCompareMode();
  $('tw-variant-name').textContent = v.name + (v.primary ? ' ⭐' : '');
  $('tw-readonly-badge').hidden = !v.readOnly;
  const c = v.concept;
  const ro = !!v.readOnly;
  // Compute summaries
  const itKw = calcITTotal(c);
  const machM2 = calcMachroomArea(c);
  const upsByPurpose = calcUpsByPurpose(c);
  const coolKw = calcCoolTotal(c);
  const feedKw = calcFeedTotal(c);
  const upsItKw = upsByPurpose.it + upsByPurpose.mixed;
  const upsCoolKw = upsByPurpose.cooling + upsByPurpose.mixed;

  // Build full list pane HTML
  if (listPane && _mode === 'list') {
    const upsItMargin = (itKw > 0)
      ? (upsItKw >= itKw ? `<span style="color:#16a34a">✓ +${(upsItKw - itKw).toFixed(1)} кВт</span>` : `<span style="color:#dc2626">⚠ −${(itKw - upsItKw).toFixed(1)} кВт</span>`)
      : '—';
    listPane.innerHTML = `
      <div class="tw-section">
        <div class="tw-section-head">
          <h3>1. Концепция стоек</h3>
          <button type="button" class="tw-add-btn" data-add-card="rack" ${ro ? 'disabled' : ''}>➕ Группа стоек</button>
        </div>
        <div class="tw-cards" data-cards-for="rack">
          ${(c.rackGroups || []).map(rg => renderRackGroupCard(rg, ro)).join('')}
        </div>
        <div class="tw-summary">
          <b>Σ IT-нагрузка:</b> <span>${itKw.toFixed(1)}</span> кВт ·
          <b>Σ площадь машзала (≈):</b> <span>${machM2}</span> м²
        </div>
      </div>

      <div class="tw-section">
        <div class="tw-section-head">
          <h3>2. Системы ИБП</h3>
          <button type="button" class="tw-add-btn" data-add-card="ups" ${ro ? 'disabled' : ''}>➕ Система ИБП</button>
        </div>
        <div class="tw-cards" data-cards-for="ups">
          ${(c.upsSystems || []).map(us => renderUpsCard(us, ro)).join('')}
        </div>
        <div class="tw-summary">
          <b>⚡ ИБП IT:</b> ${upsItKw.toFixed(1)} кВт ${upsItMargin} ·
          <b>❄ ИБП климат:</b> ${upsCoolKw.toFixed(1)} кВт ·
          <b>Σ итого:</b> ${upsByPurpose.total.toFixed(1)} кВт
        </div>
      </div>

      <div class="tw-section">
        <div class="tw-section-head">
          <h3>3. Климат</h3>
          <button type="button" class="tw-add-btn" data-add-card="cool" ${ro ? 'disabled' : ''}>➕ Группа кондиционеров</button>
        </div>
        <div class="tw-cards" data-cards-for="cool">
          ${(c.coolingUnits || []).map(cu => renderCoolCard(cu, ro)).join('')}
        </div>
        <div class="tw-summary">
          <b>Σ холод доступен:</b> ${coolKw.toFixed(1)} кВт ·
          <b>Запас:</b> ${itKw > 0 ? (coolKw >= itKw ? `<span style="color:#16a34a">✓ +${(coolKw - itKw).toFixed(1)} кВт</span>` : `<span style="color:#dc2626">⚠ −${(itKw - coolKw).toFixed(1)} кВт</span>`) : '—'}
        </div>
      </div>

      <div class="tw-section">
        <div class="tw-section-head"><h3>4. Ввод: ТП и ДГУ</h3></div>
        ${renderFeedSection(c.feed, ro)}
        <div class="tw-summary">
          <b>Σ принятая мощность:</b> ${feedKw.toFixed(1)} кВт
        </div>
      </div>

      <div class="tw-section">
        <div class="tw-section-head"><h3>5. Площади помещений</h3></div>
        <div id="tw-areas-table"></div>
      </div>
    `;
    // Render areas
    const areas = calcAreas(c);
    const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
    const areasRoot = listPane.querySelector('#tw-areas-table');
    if (areasRoot) {
      areasRoot.innerHTML = `<table class="tw-areas">
        <thead><tr><th>Помещение</th><th class="num">Площадь, м²</th></tr></thead>
        <tbody>${areas.map(a => `<tr><td>${escHtml(a.name)}</td><td class="num">${a.m2}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><b>Σ</b></td><td class="num"><b>${sumM2}</b></td></tr></tfoot>
      </table>`;
    }
    $('tw-content-summary').textContent = `${(c.rackGroups || []).reduce((s, rg) => s + (rg.count || 0), 0)} стоек · ${itKw.toFixed(1)} кВт IT · Σ ${sumM2} м²`;
  }
}

// ─── Persistence
function persistVariants() { saveJson(KEY_VARIANTS, _variants); }
function persistActive() { saveJson(KEY_ACTIVE, _activeId); }

// ─── Field bindings via event delegation
// Каждая card имеет data-card-kind + data-card-id + data-field на input/select.
// Контейнер #tw-mode-list слушает только `change` event (НЕ `input`).
//
// ВАЖНО (MEMORY.md → feedback_input_event.md): при re-render через
// innerHTML на каждый keystroke (input event) браузер теряет фокус ввода
// — пользователь набирает 1 символ за раз. Решение: использовать `change`
// (fires on blur / Enter) — после ввода полного значения. Пользователь просил
// дважды: «символы можно вводить только по одному так как теряется фокус».
function bindListEvents() {
  const root = $('tw-mode-list');
  if (!root) return;
  const handle = (e) => {
    const cur = _variants.find(x => x.id === _activeId);
    if (!cur || cur.readOnly) return;
    const target = e.target;
    if (!target || (!target.matches('input, select'))) return;
    const card = target.closest('.tw-card');
    const field = target.dataset.field;
    if (!field) return;
    const value = (target.type === 'checkbox') ? target.checked
      : (target.type === 'number' ? Number(target.value) || 0 : target.value);
    if (card) {
      const kind = card.dataset.cardKind;
      const id = card.dataset.cardId;
      const arr = cur.concept[kind === 'rack' ? 'rackGroups' : kind === 'ups' ? 'upsSystems' : 'coolingUnits'];
      const obj = arr.find(x => x.id === id);
      if (!obj) return;
      // Поддержка nested путей вроде "pdu.kind"
      _setNested(obj, field, kind === 'ups' && field === 'loadFactor' ? value / 100 : value);
    } else {
      // feed.tp.* / feed.dgu.* — относится к concept.feed
      _setNested(cur.concept.feed, field, value);
    }
    persistVariants();
    renderActiveVariant();
  };
  // ТОЛЬКО change — НЕ input. Иначе фокус теряется на каждом keystroke.
  root.addEventListener('change', handle);
  // Кнопки add/delete card
  root.addEventListener('click', (e) => {
    const cur = _variants.find(x => x.id === _activeId);
    if (!cur || cur.readOnly) return;
    const addBtn = e.target.closest('.tw-add-btn[data-add-card]');
    if (addBtn) {
      const kind = addBtn.dataset.addCard;
      if (kind === 'rack') cur.concept.rackGroups.push(newRackGroup(`Группа ${cur.concept.rackGroups.length + 1}`));
      else if (kind === 'ups') cur.concept.upsSystems.push(newUpsSystem('ИБП', 'it'));
      else if (kind === 'cool') cur.concept.coolingUnits.push(newCoolingUnit('Климат'));
      persistVariants(); renderActiveVariant();
      return;
    }
    const delBtn = e.target.closest('.tw-card-del[data-card-action="delete"]');
    if (delBtn) {
      const card = delBtn.closest('.tw-card');
      if (!card) return;
      const kind = card.dataset.cardKind;
      const id = card.dataset.cardId;
      const arrName = kind === 'rack' ? 'rackGroups' : kind === 'ups' ? 'upsSystems' : 'coolingUnits';
      const arr = cur.concept[arrName];
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return;
      if (arr.length === 1) {
        alert('Нельзя удалить последнюю запись. Добавьте новую перед удалением.');
        return;
      }
      if (!confirm(`Удалить «${arr[idx].name}»?`)) return;
      arr.splice(idx, 1);
      persistVariants(); renderActiveVariant();
      return;
    }
    const bindBtn = e.target.closest('.tw-bind-btn[data-bind-domain]');
    if (bindBtn) {
      openModelPicker(bindBtn.dataset.bindDomain, bindBtn.dataset.refId);
    }
  });
}

function _setNested(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

// ─── Variant CRUD
function addVariant() {
  const name = `Вариант ${_variants.length + 1}`;
  const v = newVariant(name);
  if (_variants.length === 0) v.primary = true;
  _variants.push(v);
  _activeId = v.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function duplicateVariant(id) {
  const src = _variants.find(v => v.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'v-' + Math.random().toString(36).slice(2, 10);
  copy.name = src.name + ' (копия)';
  copy.primary = false;
  copy.readOnly = false;
  copy.createdAt = Date.now();
  // Переназначить id вложенных объектов чтобы они не пересекались
  for (const rg of (copy.concept.rackGroups || [])) rg.id = _newId('rg');
  for (const us of (copy.concept.upsSystems || [])) us.id = _newId('us');
  for (const cu of (copy.concept.coolingUnits || [])) cu.id = _newId('cu');
  _variants.push(copy);
  _activeId = copy.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function deleteVariant(id) {
  const idx = _variants.findIndex(v => v.id === id);
  if (idx < 0) return;
  if (!confirm(`Удалить вариант «${_variants[idx].name}»?`)) return;
  _variants.splice(idx, 1);
  if (_activeId === id) _activeId = _variants[0]?.id || null;
  if (!_variants.some(v => v.primary) && _variants.length > 0) {
    _variants[0].primary = true;
  }
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function makePrimary(id) {
  for (const v of _variants) v.primary = (v.id === id);
  persistVariants();
  renderVariantsList(); renderActiveVariant();
}

// ─── Mode toggle
function setMode(mode) {
  _mode = (mode === 'plan') ? 'plan' : 'list';
  document.querySelectorAll('.tw-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
  renderActiveVariant();
}

// ─── Catalog picker
const DOMAIN_KIND = {
  rack: 'rack', ups: 'ups', cool: 'cooler',
  tp: 'transformer', dgu: 'generator', pdu: 'pdu',
};
const DOMAIN_LABEL = {
  rack: 'Стойка', ups: 'ИБП', cool: 'Кондиционер',
  tp: 'Трансформатор', dgu: 'ДГУ', pdu: 'PDU',
};

async function openModelPicker(domain, refId) {
  const cur = _variants.find(x => x.id === _activeId);
  if (!cur) return;
  const kind = DOMAIN_KIND[domain];
  if (!kind) return;
  let elements = [];
  try {
    const lib = await import('../shared/element-library.js');
    elements = lib.listElements({ kind }) || [];
  } catch (e) { alert(`Не удалось загрузить библиотеку: ${e.message || e}`); return; }
  // Ищем текущий modelRef для подсветки
  const target = _findBindTarget(cur.concept, domain, refId);
  const currentRefId = target?.modelRef?.id || null;
  const overlay = document.createElement('div');
  overlay.className = 'tw-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:inherit';
  const rows = elements.map(el => {
    const sel = el.id === currentRefId ? ' style="background:#dbeafe;border-color:#1e40af"' : '';
    const kw = el.demandKw ?? el.kva ?? el.power ?? '';
    return `<div class="tw-picker-row" data-id="${escAttr(el.id)}"${sel}>
      <span class="tw-picker-mfr">${escHtml(el.manufacturer || '')}</span>
      <span class="tw-picker-model"><b>${escHtml(el.model || el.name || el.id)}</b></span>
      <span class="tw-picker-kind muted">${escHtml(el.kind || '')}</span>
      <span class="tw-picker-power muted">${kw ? kw + (el.kind === 'ups' ? ' кВА' : ' кВт') : ''}</span>
    </div>`;
  }).join('');
  overlay.innerHTML = `<div class="tw-picker">
    <div class="tw-picker-head">
      <h3>📦 Выбор модели — ${escHtml(DOMAIN_LABEL[domain])}</h3>
      <button type="button" class="tw-picker-close">×</button>
    </div>
    <div class="tw-picker-search-row">
      <input type="text" class="tw-picker-search" placeholder="🔍 Поиск...">
      <span class="muted" style="font-size:11px">${elements.length} моделей</span>
    </div>
    <div class="tw-picker-list">
      ${elements.length === 0
        ? `<div class="muted" style="padding:20px;text-align:center">В библиотеке нет элементов kind="${kind}". Добавьте их в catalog/.</div>`
        : rows}
    </div>
    <div class="tw-picker-actions">
      ${currentRefId ? `<button type="button" class="tw-picker-clear">🗑 Снять привязку</button>` : ''}
      <span style="flex:1"></span>
      <button type="button" class="tw-picker-cancel">Отмена</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.tw-picker-close').addEventListener('click', close);
  overlay.querySelector('.tw-picker-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const search = overlay.querySelector('.tw-picker-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      overlay.querySelectorAll('.tw-picker-row').forEach(row => {
        const txt = row.textContent.toLowerCase();
        row.style.display = (!q || txt.includes(q)) ? '' : 'none';
      });
    });
    search.focus();
  }
  overlay.querySelectorAll('.tw-picker-row').forEach(row => {
    row.addEventListener('click', () => {
      const el = elements.find(e => e.id === row.dataset.id);
      if (el) { _bindModel(domain, refId, el); close(); }
    });
  });
  const clearBtn = overlay.querySelector('.tw-picker-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => { _bindModel(domain, refId, null); close(); });
}

function _findBindTarget(concept, domain, refId) {
  if (domain === 'rack') return (concept.rackGroups || []).find(rg => rg.id === refId);
  if (domain === 'ups') return (concept.upsSystems || []).find(us => us.id === refId);
  if (domain === 'cool') return (concept.coolingUnits || []).find(cu => cu.id === refId);
  if (domain === 'pdu') {
    // refId — это id rack-группы; modelRef лежит в rg.pdu.modelRef
    const rg = (concept.rackGroups || []).find(rg => rg.id === refId);
    return rg ? rg.pdu : null;
  }
  if (domain === 'tp') return concept.feed?.tp;
  if (domain === 'dgu') return concept.feed?.dgu;
  return null;
}

function _bindModel(domain, refId, element) {
  const cur = _variants.find(x => x.id === _activeId);
  if (!cur || cur.readOnly) return;
  const target = _findBindTarget(cur.concept, domain, refId);
  if (!target) return;
  const ref = element ? {
    id: element.id,
    manufacturer: element.manufacturer || '',
    model: element.model || element.name || element.id,
    kind: element.kind,
  } : null;
  target.modelRef = ref;
  // Авто-копирование параметров
  if (element) {
    if (domain === 'rack') {
      if (Number.isFinite(element.widthMm)) target.widthMm = element.widthMm;
      if (Number.isFinite(element.depthMm)) target.depthMm = element.depthMm;
      if (Number.isFinite(element.demandKw) && !target.kwPerRack) target.kwPerRack = element.demandKw;
    } else if (domain === 'ups') {
      const kva = element.kva || element.ratedKva;
      if (Number.isFinite(kva) && !target.ratedKva) target.ratedKva = kva;
    } else if (domain === 'cool') {
      const kw = element.kwCool || element.kw;
      if (Number.isFinite(kw) && !target.kwPerUnit) target.kwPerUnit = kw;
    } else if (domain === 'tp') {
      if (Number.isFinite(element.kva) && !target.kva) target.kva = element.kva;
    } else if (domain === 'dgu') {
      if (Number.isFinite(element.kw) && !target.kw) target.kw = element.kw;
    }
  }
  persistVariants();
  renderActiveVariant();
}

// ─── Handoff (Phase 20.11): генерируем engine.scheme.v1 из concept
//
// MVP: создаём ноды (без connections) на одной странице, пользователь сам
// проводит линии. Это сильно проще чем правильно строить port-топологию,
// и оставляет electrical-detail (автоматы, кабели) за электриком.
//
// Узлы:
//   - source (utility / transformer) — если concept.feed.tp.needed
//   - generator (ДГУ) — если concept.feed.dgu.needed
//   - panel — 1 ГРЩ
//   - consumer-group — по 1 на rackGroup, count = group.count
//   - ups — по 1 на upsSystem
//   - cooling consumer — по 1 на coolingUnit
function _buildSchemeFromConcept(concept, variantName) {
  const nodes = [];
  let nextId = 1;
  const newId = () => 'n' + (nextId++);
  const newTag = (() => {
    const used = new Set();
    return (prefix) => {
      let i = 1;
      while (used.has(prefix + i)) i++;
      const t = prefix + i;
      used.add(t);
      return t;
    };
  })();

  let curY = 100;
  const colX = { source: 100, mid: 500, end: 900 };
  const pageId = 'p1';

  // Source: TP или Utility
  if (concept.feed?.tp?.needed) {
    nodes.push({
      id: newId(), type: 'source', tag: newTag('TP'),
      name: 'Ввод ТП', x: colX.source, y: curY,
      sourceSubtype: 'transformer',
      snomKva: Number(concept.feed.tp.kva) || 1000,
      voltage: 400, voltageLevelIdx: 0, phase: '3ph', cosPhi: 0.95,
      ukPct: 4.5, sscMva: 250,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
  } else {
    nodes.push({
      id: newId(), type: 'source', tag: newTag('U'),
      name: 'Городская сеть', x: colX.source, y: curY,
      sourceSubtype: 'utility',
      voltage: 10000, voltageLevelIdx: 3, phase: '3ph', cosPhi: 1,
      ikKA: 10, sscMva: 250,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
  }
  curY += 200;
  if (concept.feed?.dgu?.needed) {
    nodes.push({
      id: newId(), type: 'generator', tag: newTag('G'),
      name: 'ДГУ', x: colX.source, y: curY,
      capacityKw: Number(concept.feed.dgu.kw) || 100,
      backupMode: concept.feed.dgu.mode === 'esp',
      phase: '3ph', voltage: 400, cosPhi: 0.85,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
    curY += 200;
  }
  // ГРЩ (главный распределительный щит)
  const panelY = 100;
  nodes.push({
    id: newId(), type: 'panel', tag: newTag('ГРЩ'),
    name: 'ГРЩ', x: colX.mid, y: panelY,
    inputs: 2, outputs: Math.max(2, (concept.upsSystems || []).length + (concept.coolingUnits || []).length),
    capacityA: 800,
    pageIds: [pageId],
    positionsByPage: { [pageId]: { x: colX.mid, y: panelY } },
  });
  // ИБП-узлы
  let upsY = panelY;
  for (const us of (concept.upsSystems || [])) {
    nodes.push({
      id: newId(), type: 'ups', tag: newTag(us.purpose === 'cooling' ? 'ИБПК' : 'ИБП'),
      name: us.name, x: colX.mid + 250, y: upsY,
      kva: Number(us.ratedKva) || 0,
      autonomyMin: Number(us.autonomyMin) || 15,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.mid + 250, y: upsY } },
    });
    upsY += 200;
  }
  // Consumer-group узлы для стоек
  let rackY = panelY;
  for (const rg of (concept.rackGroups || [])) {
    nodes.push({
      id: newId(), type: 'consumer', tag: newTag('SR'),
      name: rg.name || 'Стойки',
      consumerSubtype: 'rack', consumerKind: 'rack',
      x: colX.end, y: rackY,
      count: Number(rg.count) || 1,
      demandKw: Number(rg.kwPerRack) || 0,
      cosPhi: 0.95, phase: '3ph', voltage: 400,
      width: 250, height: 120,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.end, y: rackY } },
      _fromTechWorkspace: true,
      _profile: rg.profile,
    });
    rackY += 200;
  }
  // Cooling consumers (как просто потребители)
  for (const cu of (concept.coolingUnits || [])) {
    const kwTot = (Number(cu.count) || 0) * (Number(cu.kwPerUnit) || 0);
    nodes.push({
      id: newId(), type: 'consumer', tag: newTag('K'),
      name: cu.name || 'Кондиционеры',
      consumerSubtype: 'outdoor_unit',
      x: colX.end, y: rackY,
      count: Number(cu.count) || 1,
      demandKw: Number(cu.kwPerUnit) || 0,
      cosPhi: 0.85, phase: '3ph', voltage: 400,
      width: 250, height: 120,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.end, y: rackY } },
      _fromTechWorkspace: true,
    });
    rackY += 200;
  }

  return {
    version: 4,
    nextId: nextId,
    nodes,
    conns: [],
    sysConns: [],
    pages: [{
      id: pageId,
      name: variantName || 'Главная схема',
      type: 'independent',
      kind: 'schematic',
      view: { x: 0, y: 0, zoom: 0.7 },
    }],
    currentPageId: pageId,
    project: { name: variantName || 'Концепция' },
    modes: [],
    activeModeId: null,
    view: { x: 0, y: 0, zoom: 0.7 },
    globalSettings: {},
  };
}

// ─── Phase 20.9: пояснительная записка (HTML-report, печатаемый)
// Пользователь: «Шаблонная ПЗ по концепции: структура с разделами «Описание
// объекта», «Концепция размещения», «Электроснабжение», «Климат»,
// «Резервирование», «Площади», «Перечень ТЗ для смежных дисциплин».
function _redundancyLabel(r) {
  return ({ 'N': 'без резерва (N)', 'N+1': 'N+1', '2N': '2N', '1': '1 ввод', '2': '2 ввода', '2-avr': '2 ввода + АВР', 'none': 'нет', 'esp': 'резервный (ESP)', 'prp': 'постоянный (PRP)' }[r]) || r;
}
function _profileLabel(p) {
  return ({ 'it': 'IT-rack', 'blade': 'Blade', 'gpu': 'GPU-heavy', 'network': 'Network', 'storage': 'Storage' }[p]) || p;
}
function _coolTypeLabel(t) {
  return ({ 'crac': 'CRAC (downflow)', 'inrow': 'In-Row', 'fancoil': 'Fan-coil', 'freecool': 'Free cooling' }[t]) || t;
}
function _purposeLabel(p) {
  return ({ 'it': 'IT-нагрузка', 'cooling': 'климат', 'mixed': 'смешанное' }[p]) || p;
}
function generateReportHtml(v) {
  const c = v.concept;
  const itKw = calcITTotal(c);
  const upsByPurpose = calcUpsByPurpose(c);
  const coolKw = calcCoolTotal(c);
  const feedKw = calcFeedTotal(c);
  const areas = calcAreas(c);
  const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
  const totalRacks = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  const date = new Date().toLocaleDateString('ru-RU');

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Пояснительная записка — ${escHtml(v.name)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.4; color: #000; max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20pt; text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
  h2 { font-size: 14pt; margin-top: 24px; border-bottom: 1px solid #888; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11pt; }
  table th, table td { border: 1px solid #888; padding: 5px 8px; text-align: left; }
  table th { background: #f0f0f0; font-weight: bold; }
  table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .meta { color: #555; font-size: 10pt; text-align: center; margin-bottom: 24px; }
  .badge { display: inline-block; padding: 1px 6px; background: #f0f0f0; border: 1px solid #888; border-radius: 3px; font-size: 10pt; }
  .summary { background: #f9f9f9; border: 1px solid #ccc; padding: 10px 14px; margin: 12px 0; border-radius: 4px; }
  .summary b { color: #000; }
  .toc { background: #f9f9f9; padding: 10px 14px; border: 1px solid #ddd; margin: 16px 0; }
  .toc ul { margin: 4px 0; padding-left: 24px; }
  .print-actions { position: fixed; top: 8px; right: 8px; }
  .print-actions button { padding: 6px 12px; font-size: 11pt; cursor: pointer; }
  @media print { .print-actions { display: none; } body { padding: 0; max-width: 100%; } }
</style>
</head><body>
<div class="print-actions">
  <button onclick="window.print()">🖨 Печать / PDF</button>
  <button onclick="window.close()">✕ Закрыть</button>
</div>

<h1>Пояснительная записка</h1>
<div class="meta">
  Концепция объекта ЦОД · Вариант «${escHtml(v.name)}»${v.primary ? ' (основной)' : ''}<br>
  Сформировано: ${date} · Технолог ЦОД, Raschet
</div>

<div class="toc">
  <b>Содержание:</b>
  <ul>
    <li>1. Описание объекта</li>
    <li>2. Концепция стоек</li>
    <li>3. Электроснабжение (ИБП)</li>
    <li>4. Климатическое обеспечение</li>
    <li>5. Ввод (ТП и ДГУ)</li>
    <li>6. Площади помещений</li>
    <li>7. Перечень ТЗ для смежных дисциплин</li>
  </ul>
</div>

<h2>1. Описание объекта</h2>
<p>Объект — центр обработки данных (ЦОД) с IT-нагрузкой <b>${itKw.toFixed(1)} кВт</b>
и общей площадью <b>${sumM2} м²</b>. Концепция включает ${totalRacks} серверных стоек,
${(c.upsSystems || []).length} систем(ы) ИБП,
${(c.coolingUnits || []).length} групп(ы) кондиционирования.</p>
<div class="summary">
  <b>Ключевые параметры:</b><br>
  • IT-нагрузка: ${itKw.toFixed(1)} кВт (${totalRacks} стоек)<br>
  • Подключённая мощность ИБП: ⚡ IT ${(upsByPurpose.it + upsByPurpose.mixed).toFixed(1)} кВт · ❄ климат ${(upsByPurpose.cooling + upsByPurpose.mixed).toFixed(1)} кВт<br>
  • Холодопроизводительность: ${coolKw.toFixed(1)} кВт<br>
  • Принятая мощность объекта: ${feedKw.toFixed(1)} кВт<br>
  • Общая площадь: ${sumM2} м²
</div>

<h2>2. Концепция стоек</h2>
<p>Объект включает ${(c.rackGroups || []).length} групп(ы) серверных стоек:</p>
<table>
  <thead><tr><th>Группа</th><th>Профиль</th><th class="num">Кол-во</th><th class="num">кВт/стойка</th><th class="num">Σ кВт</th><th>Размеры (Ш × Г)</th><th>PDU</th></tr></thead>
  <tbody>
    ${(c.rackGroups || []).map(rg => {
      const sumKw = (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
      const pduSummary = `${rg.pdu?.kind || ''} ${rg.pdu?.phases || ''} ${rg.pdu?.ratingA || ''}А ×${rg.pdu?.inputsPerRack || 1}`;
      return `<tr>
        <td>${escHtml(rg.name)}</td>
        <td>${_profileLabel(rg.profile)}</td>
        <td class="num">${rg.count}</td>
        <td class="num">${rg.kwPerRack}</td>
        <td class="num"><b>${sumKw.toFixed(1)}</b></td>
        <td>${rg.widthMm} × ${rg.depthMm} мм</td>
        <td>${escHtml(pduSummary)}</td>
      </tr>`;
    }).join('')}
    <tr><td colspan="2"><b>Итого:</b></td><td class="num"><b>${totalRacks}</b></td><td></td><td class="num"><b>${itKw.toFixed(1)}</b></td><td></td><td></td></tr>
  </tbody>
</table>

<h2>3. Электроснабжение (ИБП)</h2>
<p>Питание IT-нагрузки и систем климата обеспечивается ${(c.upsSystems || []).length} системами ИБП:</p>
<table>
  <thead><tr><th>Система</th><th>Назначение</th><th class="num">Кол-во</th><th class="num">кВА/шт.</th><th>Резерв</th><th class="num">Доступно, кВт</th><th class="num">Автономия, мин</th><th>АКБ</th></tr></thead>
  <tbody>
    ${(c.upsSystems || []).map(us => `<tr>
      <td>${escHtml(us.name)}</td>
      <td>${_purposeLabel(us.purpose)}</td>
      <td class="num">${us.count}</td>
      <td class="num">${us.ratedKva}</td>
      <td>${_redundancyLabel(us.redundancy)}</td>
      <td class="num">${_upsAvail(us).toFixed(1)}</td>
      <td class="num">${us.autonomyMin}</td>
      <td>${us.batteryTech === 'vrla' ? 'VRLA' : 'Li-Ion (LFP)'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="summary">
  <b>Σ доступная мощность ИБП:</b> ⚡ IT ${(upsByPurpose.it + upsByPurpose.mixed).toFixed(1)} кВт ·
  ❄ климат ${(upsByPurpose.cooling + upsByPurpose.mixed).toFixed(1)} кВт ·
  итого ${upsByPurpose.total.toFixed(1)} кВт
</div>

<h2>4. Климатическое обеспечение</h2>
<p>Для отвода тепла IT-нагрузки (${itKw.toFixed(1)} кВт) предусмотрены:</p>
<table>
  <thead><tr><th>Группа</th><th>Тип</th><th class="num">Кол-во</th><th class="num">кВт/шт.</th><th>Резерв</th><th class="num">Доступно, кВт</th></tr></thead>
  <tbody>
    ${(c.coolingUnits || []).map(cu => `<tr>
      <td>${escHtml(cu.name)}</td>
      <td>${_coolTypeLabel(cu.type)}</td>
      <td class="num">${cu.count}</td>
      <td class="num">${cu.kwPerUnit}</td>
      <td>${_redundancyLabel(cu.redundancy)}</td>
      <td class="num">${_coolAvail(cu).toFixed(1)}</td>
    </tr>`).join('')}
    <tr><td colspan="5"><b>Итого:</b></td><td class="num"><b>${coolKw.toFixed(1)}</b></td></tr>
  </tbody>
</table>
${coolKw < itKw ? `<p style="color:#c62828"><b>⚠ Внимание:</b> Холодопроизводительность (${coolKw.toFixed(1)} кВт) меньше IT-нагрузки (${itKw.toFixed(1)} кВт). Требуется доукомплектование на ${(itKw - coolKw).toFixed(1)} кВт.</p>` : ''}

<h2>5. Ввод (ТП и ДГУ)</h2>
${c.feed?.tp?.needed ? `<p><b>Трансформаторная подстанция (ТП):</b> ${c.feed.tp.kva} кВА, резервирование — ${_redundancyLabel(c.feed.tp.redundancy)}.</p>` : '<p><i>ТП не предусмотрена.</i></p>'}
${c.feed?.dgu?.needed ? `<p><b>Дизель-генераторная установка (ДГУ):</b> ${c.feed.dgu.kw} кВт, режим — ${_redundancyLabel(c.feed.dgu.mode)}, резервирование — ${_redundancyLabel(c.feed.dgu.redundancy)}.</p>` : '<p><i>ДГУ не предусмотрена.</i></p>'}
<div class="summary">
  <b>Σ принятая мощность объекта:</b> ${feedKw.toFixed(1)} кВт (с учётом потерь и климата ~30%)
</div>

<h2>6. Площади помещений</h2>
<p>Расчётная разбивка площадей (по ТКП 308-2011 / TIA-942):</p>
<table>
  <thead><tr><th>Помещение</th><th class="num">Площадь, м²</th></tr></thead>
  <tbody>
    ${areas.map(a => `<tr><td>${escHtml(a.name)}</td><td class="num">${a.m2}</td></tr>`).join('')}
    <tr><td><b>Σ Итого</b></td><td class="num"><b>${sumM2}</b></td></tr>
  </tbody>
</table>

<h2>7. Перечень ТЗ для смежных дисциплин</h2>

<h3>7.1. Электрик</h3>
<ul>
  <li>Подобрать конкретные модели ИБП (${(c.upsSystems || []).length} шт.) под параметры из раздела 3.</li>
  <li>Подобрать автоматические выключатели и сечения кабелей по нагрузкам стоек (${itKw.toFixed(1)} кВт IT).</li>
  <li>Предусмотреть распределительный щит ГРЩ под ${(c.upsSystems || []).length + (c.coolingUnits || []).length} вводов.</li>
  ${c.feed?.tp?.needed ? `<li>Подобрать трансформатор ${c.feed.tp.kva} кВА.</li>` : ''}
  ${c.feed?.dgu?.needed ? `<li>Подобрать ДГУ ${c.feed.dgu.kw} кВт (${_redundancyLabel(c.feed.dgu.mode)}).</li>` : ''}
</ul>

<h3>7.2. СКС-инженер</h3>
<ul>
  <li>Расположить ${totalRacks} стоек по группам (раздел 2) в машзале (≈ ${areas.find(a => a.name.startsWith('Машзал'))?.m2 || 0} м²).</li>
  <li>Спроектировать межшкафные связи и кабельные трассы.</li>
  <li>Подобрать конкретные модели стоек (${(c.rackGroups || []).filter(rg => rg.modelRef?.id).length} из ${(c.rackGroups || []).length} групп уже привязаны к каталогу).</li>
</ul>

<h3>7.3. Климатик</h3>
<ul>
  <li>Подобрать конкретные модели кондиционеров (${(c.coolingUnits || []).length} групп(ы) на ${coolKw.toFixed(1)} кВт холода).</li>
  <li>Расположить кондиционеры в климат-зале (≈ ${areas.find(a => a.name.startsWith('Климат'))?.m2 || 0} м²).</li>
  <li>${coolKw < itKw ? 'Доукомплектовать на ' + (itKw - coolKw).toFixed(1) + ' кВт.' : 'Проверить запас при максимальных температурах окружающей среды.'}</li>
</ul>

<h3>7.4. Архитектор</h3>
<ul>
  <li>Скомпоновать помещения общей площадью ${sumM2} м² (см. раздел 6).</li>
  <li>Учесть требования по электротехническим свойствам (двери, кабельные проходки), пожарной безопасности (АГПТ для машзала и АКБ-зала), ИБП-залу — отдельная вентиляция.</li>
</ul>

<p style="margin-top:32px;border-top:1px solid #888;padding-top:8px;font-size:10pt;color:#888;text-align:center">
  Документ сгенерирован автоматически в Raschet · Технолог ЦОД · ${date}
</p>

</body></html>`;
}

function bindReport() {
  const btn = $('tw-report');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const v = _variants.find(x => x.id === _activeId);
    if (!v) { alert('Сначала выберите вариант.'); return; }
    const html = generateReportHtml(v);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { alert('Браузер заблокировал открытие. Разрешите попапы для этого сайта.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

function bindHandoff() {
  const btn = $('tw-handoff');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const v = _variants.find(x => x.id === _activeId);
    if (!v || v.readOnly) return;
    if (!confirm(`📤 Передать вариант «${v.name}» в детальное проектирование?\n\nБудет создана схема в Конструкторе с предзаполненными узлами:\n• Источник (${v.concept.feed?.tp?.needed ? 'ТП' : 'Utility'})\n• ГРЩ\n• ${v.concept.upsSystems?.length || 0} ИБП-узлов\n• ${v.concept.rackGroups?.length || 0} групп стоек\n• ${v.concept.coolingUnits?.length || 0} кондиционеров\n\nСвязи между узлами вы проведёте вручную в Конструкторе.\n\nПосле handoff variant станет read-only. Продолжить?`)) return;
    try {
      const scheme = _buildSchemeFromConcept(v.concept, v.name);
      // Записываем в engine.scheme.v1 проекта
      const key = projectKey(_pid, 'engine', 'scheme.v1');
      const existing = localStorage.getItem(key);
      if (existing) {
        if (!confirm(`Внимание! В проекте уже есть схема. Заменить её на сгенерированную из концепции?\n\nСтарая схема будет потеряна (Ctrl+Z в Конструкторе не поможет).`)) return;
      }
      localStorage.setItem(key, JSON.stringify(scheme));
      v.readOnly = true;
      v.handoffAt = Date.now();
      persistVariants();
      renderVariantsList(); renderActiveVariant();
      if (confirm(`✓ Схема создана. Открыть Конструктор?`)) {
        location.href = '../index.html';
      }
    } catch (e) {
      console.error('[handoff]', e);
      alert(`Ошибка handoff: ${e.message || e}`);
    }
  });
}

// ─── Main
function init() {
  _pid = ensureDefaultProject();
  _variants = (loadJson(KEY_VARIANTS, []) || []).map(migrateVariant);
  _activeId = loadJson(KEY_ACTIVE, null);
  if (!_variants.length) {
    addVariant();
  } else if (!_variants.some(v => v.id === _activeId)) {
    _activeId = _variants[0].id;
  }
  // Сохраним мигрированные данные обратно
  persistVariants();
  renderVariantsList();
  renderActiveVariant();
  bindListEvents();
  bindReport();
  bindHandoff();
  // Sidebar variants list events
  $('tw-variants-list').addEventListener('click', (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const vid = actBtn.dataset.vid;
      const act = actBtn.dataset.act;
      if (act === 'duplicate') duplicateVariant(vid);
      else if (act === 'delete') deleteVariant(vid);
      else if (act === 'primary') makePrimary(vid);
      return;
    }
    const row = e.target.closest('.tw-variant-row');
    if (row) {
      _activeId = row.dataset.vid;
      persistActive();
      renderVariantsList();
      renderActiveVariant();
    }
  });
  $('tw-variant-add').addEventListener('click', addVariant);
  document.querySelectorAll('.tw-mode-btn').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
}

// ─── Utils
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return escHtml(s); }

document.addEventListener('DOMContentLoaded', init);
