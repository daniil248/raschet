// =========================================================================
// shared/card-presets.js — v0.59.783 (Phase 19.2 + 19.4)
//
// Пресеты отображения карточек узлов на схеме. Иерархия (от старшей):
//   1. Page (scheme-level): page.cardPresetActiveId + page.cardPresets[]
//   2. Project (project-level): project.cardPresetActiveId + project.cardPresets[]
//   3. User (LS): raschet.cardPresets.v1 + raschet.cardPresetActiveId.v1
//   4. System default — DEFAULT_PRESETS.full
//
// Юзер: «если есть настройка конкретной схемы, берем настройку схемы,
// если для схемы настройки нет, берем настройки проекта, иначе берем
// настройку пользователя».
//
// Per-mode (режим страницы): пресет содержит perMode с ключами по
// page.kind ('schematic' | 'layout' | 'scs-design' | …). render.js
// читает effective.perMode[page.kind].perType[node.type] = [field-id…].
//
// Поле в списке = «показывать». Если списка нет → fallback на
// allFieldIds (показываем всё). Required-поля принудительно добавляются.
// =========================================================================

import { CARD_FIELDS, allFieldIds, requiredFieldIds, listCardFields } from './card-fields-registry.js';

const KEY_PRESETS = 'raschet.cardPresets.v1';
const KEY_ACTIVE  = 'raschet.cardPresetActive.v1';

// ─── System default presets ──────────────────────────────────────────────
function _buildPresetFields(picker) {
  // picker(kind, type, allFieldsArr) → array<id> или null (= показывать всё)
  const out = {};
  for (const kind of Object.keys(CARD_FIELDS)) {
    out[kind] = { perType: {} };
    for (const type of Object.keys(CARD_FIELDS[kind])) {
      const all = CARD_FIELDS[kind][type];
      const picked = picker(kind, type, all);
      out[kind].perType[type] = picked == null ? all.map(f => f.id) : picked;
    }
  }
  return out;
}

/** Системные пресеты «из коробки» — нельзя удалить, можно скопировать. */
export const SYSTEM_PRESETS = [
  {
    id: 'full',
    name: 'Полный',
    system: true,
    description: 'Все поля карточки видны (текущее поведение Конструктора).',
    perMode: _buildPresetFields(() => null),
  },
  {
    id: 'electrician',
    name: 'Электрик',
    system: true,
    description: 'Электрические параметры: kW/A/автомат/кабель/ΔU.',
    perMode: _buildPresetFields((kind, type) => {
      if (kind !== 'schematic') return null;
      const elFields = ['demandKw', 'currentA', 'breakerIn', 'cableSpec', 'deltaUPct',
                        'voltage', 'phase', 'cosPhi', 'count', 'capacityA', 'marginPct',
                        'snomKva', 'kva', 'kw', 'currentA'];
      return [...requiredFieldIds(kind, type), ...listCardFields(kind, type)
        .filter(f => !f.required && elFields.includes(f.id)).map(f => f.id)];
    }),
  },
  {
    id: 'technologist',
    name: 'Технолог',
    system: true,
    description: 'Параметры технолога: мощность, габариты, тип охлаждения.',
    perMode: _buildPresetFields((kind, type) => {
      const techFields = ['demandKw', 'count', 'cosPhi', 'voltage', 'rackUnits',
                          'widthMm', 'depthMm', 'cooling', 'occupied'];
      return [...requiredFieldIds(kind, type), ...listCardFields(kind, type)
        .filter(f => !f.required && techFields.includes(f.id)).map(f => f.id)];
    }),
  },
  {
    id: 'minimum',
    name: 'Минимум',
    system: true,
    description: 'Только tag/name, без электрических деталей. Для скриншотов клиенту.',
    perMode: _buildPresetFields((kind, type) => requiredFieldIds(kind, type)),
  },
];

const SYSTEM_PRESET_BY_ID = Object.fromEntries(SYSTEM_PRESETS.map(p => [p.id, p]));

// ─── User-level storage (LocalStorage) ───────────────────────────────────

function _load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function _save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** Загрузить user-пресеты (массив). Системные не включает. */
export function loadUserPresets() {
  const arr = _load(KEY_PRESETS, []);
  return Array.isArray(arr) ? arr : [];
}
/** Сохранить user-пресеты. */
export function saveUserPresets(arr) {
  _save(KEY_PRESETS, Array.isArray(arr) ? arr : []);
  _emitChanged();
}
export function getUserActivePresetId() { return _load(KEY_ACTIVE, 'full'); }
export function setUserActivePresetId(id) { _save(KEY_ACTIVE, id || 'full'); _emitChanged(); }

/** Все доступные пресеты для UI: системные + user. */
export function listAllPresets() {
  return [...SYSTEM_PRESETS, ...loadUserPresets()];
}

/** Найти пресет по id (системный или user). */
export function getPresetById(id) {
  if (!id) return null;
  if (SYSTEM_PRESET_BY_ID[id]) return SYSTEM_PRESET_BY_ID[id];
  return loadUserPresets().find(p => p.id === id) || null;
}

// ─── Resolver (3-level priority) ─────────────────────────────────────────

/**
 * Effective пресет для текущей страницы.
 * @param {object} ctx { page?, project?, userActive? }
 *   page    — объект страницы (state.pages[i]); может иметь cardPresetActiveId + cardPresets[]
 *   project — объект проекта (state.project); может иметь cardPresetActiveId + cardPresets[]
 *   userActive — id user-active-пресета (если не передан, берём из LS)
 * @returns пресет (системный/user/project/scheme).
 */
export function resolveCardPreset(ctx = {}) {
  const { page = null, project = null } = ctx;
  // 1) Scheme level
  if (page && page.cardPresetActiveId) {
    const id = page.cardPresetActiveId;
    if (Array.isArray(page.cardPresets)) {
      const p = page.cardPresets.find(x => x.id === id);
      if (p) return p;
    }
    const sys = SYSTEM_PRESET_BY_ID[id];
    if (sys) return sys;
  }
  // 2) Project level
  if (project && project.cardPresetActiveId) {
    const id = project.cardPresetActiveId;
    if (Array.isArray(project.cardPresets)) {
      const p = project.cardPresets.find(x => x.id === id);
      if (p) return p;
    }
    const sys = SYSTEM_PRESET_BY_ID[id];
    if (sys) return sys;
  }
  // 3) User level
  const userId = ctx.userActive || getUserActivePresetId();
  const userPreset = getPresetById(userId);
  if (userPreset) return userPreset;
  // 4) Fallback
  return SYSTEM_PRESET_BY_ID.full;
}

/**
 * Какие поля показывать для текущего (page.kind, node.type) согласно
 * effective пресету. Возвращает Set<string> field-id'ов.
 *
 * Required-поля всегда добавлены (даже если их нет в preset.perMode).
 * Если preset не определяет ничего для (kind,type) — возвращаем все доступные
 * (fallback: показываем всё).
 */
export function getVisibleFieldIds(preset, kind, type) {
  if (!preset) return new Set(allFieldIds(kind, type));
  const perMode = preset.perMode || {};
  const perKind = perMode[kind];
  if (!perKind) return new Set(allFieldIds(kind, type));
  const perType = perKind.perType || {};
  const ids = perType[type];
  if (!Array.isArray(ids)) return new Set(allFieldIds(kind, type));
  // Required всегда добавлены
  const set = new Set(ids);
  for (const r of requiredFieldIds(kind, type)) set.add(r);
  return set;
}

/** Утилита для render.js: проверить виден ли конкретный fieldId. */
export function isFieldVisible(preset, kind, type, fieldId) {
  return getVisibleFieldIds(preset, kind, type).has(fieldId);
}

// ─── Events ──────────────────────────────────────────────────────────────
function _emitChanged() {
  try {
    window.dispatchEvent(new CustomEvent('raschet:card-preset-changed'));
  } catch {}
}

// ─── User-preset CRUD helpers ────────────────────────────────────────────
export function createUserPreset(name, fromPresetId = 'full') {
  const src = getPresetById(fromPresetId) || SYSTEM_PRESET_BY_ID.full;
  const id = 'preset-' + Math.random().toString(36).slice(2, 10);
  const p = {
    id, name: name || 'Без имени', system: false,
    perMode: JSON.parse(JSON.stringify(src.perMode)),
  };
  const all = loadUserPresets();
  all.push(p);
  saveUserPresets(all);
  return p;
}
export function deleteUserPreset(id) {
  const all = loadUserPresets().filter(p => p.id !== id);
  saveUserPresets(all);
  if (getUserActivePresetId() === id) setUserActivePresetId('full');
}
export function renameUserPreset(id, newName) {
  const all = loadUserPresets();
  const p = all.find(x => x.id === id);
  if (!p) return;
  p.name = newName || p.name;
  saveUserPresets(all);
}
/** Установить полный список field-id для (kind,type) внутри user-пресета. */
export function setUserPresetFields(presetId, kind, type, fieldIds) {
  const all = loadUserPresets();
  const p = all.find(x => x.id === presetId);
  if (!p || p.system) return;
  if (!p.perMode) p.perMode = {};
  if (!p.perMode[kind]) p.perMode[kind] = { perType: {} };
  if (!p.perMode[kind].perType) p.perMode[kind].perType = {};
  // Required-поля принудительно добавляем
  const merged = new Set(fieldIds || []);
  for (const r of requiredFieldIds(kind, type)) merged.add(r);
  p.perMode[kind].perType[type] = Array.from(merged);
  saveUserPresets(all);
}
