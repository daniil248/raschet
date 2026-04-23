import { state, uid } from './state.js';
import { GLOBAL, DEFAULTS, TAG_PREFIX, SOURCE_SUBTYPE_PREFIX, NODE_H } from './constants.js';
import { nodeWidth, nodeInputCount } from './geometry.js';
import { effectiveTag } from './zones.js';

let _snapshot, _render, _renderInspector, _notifyChange, _selectNode, _findZoneForMember;
export function bindGraphDeps({ snapshot, render, renderInspector, notifyChange, selectNode, findZoneForMember }) {
  _snapshot = snapshot; _render = render; _renderInspector = renderInspector;
  _notifyChange = notifyChange; _selectNode = selectNode; _findZoneForMember = findZoneForMember;
}

// Поиск наименьшего свободного обозначения с заданным префиксом (TR1, TR2, …)
export function nextFreeTag(type) {
  const prefix = TAG_PREFIX[type] || 'X';
  return nextFreeTagWithPrefix(prefix);
}
export function nextFreeTagWithPrefix(prefix) {
  const used = new Set();
  for (const n of state.nodes.values()) {
    if (n.tag) used.add(n.tag);
  }
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

// Проверка, что tag не занят другим узлом В ТОМ ЖЕ ПРОСТРАНСТВЕ СТРАНИЦЫ.
// Пространство = independent home + её linked-потомки. На разных независимых
// страницах допустимы одинаковые обозначения (они «не видят» друг друга).
// Плюс внутри одного пространства — старое правило «одинаковые теги в разных
// зонах допустимы» (через effectiveTag).
export function isTagUnique(tag, exceptId) {
  const candidate = state.nodes.get(exceptId);
  const oldTag = candidate ? candidate.tag : '';
  if (candidate) candidate.tag = tag;
  const candidateEff = candidate ? effectiveTag(candidate) : tag;
  if (candidate) candidate.tag = oldTag;

  // Вычисляем пространство страницы для candidate
  const candPids = Array.isArray(candidate?.pageIds) ? candidate.pageIds : [];
  // Для каждой pageId в candidate находим home (independent или sourcePageId если linked)
  const candHomes = new Set();
  for (const pid of candPids) {
    const p = (state.pages || []).find(x => x.id === pid);
    if (!p) continue;
    if (p.type === 'linked' && p.sourcePageId) candHomes.add(p.sourcePageId);
    else candHomes.add(p.id);
  }
  // Пространство candidate = все его home + их linked-потомки
  const candSpace = new Set(candHomes);
  for (const p of (state.pages || [])) {
    if (p.type === 'linked' && candHomes.has(p.sourcePageId)) candSpace.add(p.id);
  }
  const inCandSpace = (n) => {
    const pids = Array.isArray(n?.pageIds) ? n.pageIds : null;
    if (!pids || pids.length === 0) return true; // legacy
    for (const pid of pids) if (candSpace.has(pid)) return true;
    return false;
  };
  for (const n of state.nodes.values()) {
    if (n.id === exceptId) continue;
    if (n.type === 'zone') continue;
    if (candSpace.size > 0 && !inCandSpace(n)) continue;
    const nEff = effectiveTag(n);
    if (nEff === candidateEff) return false;
  }
  return true;
}

// ================= Создание / удаление =================
export function createNode(type, x, y, opts) {
  _snapshot();
  const id = uid();
  const subtype = opts && opts.subtype;
  const defaults = typeof DEFAULTS[type] === 'function'
    ? DEFAULTS[type](subtype)
    : {};
  const base = { id, type, x, y, ...defaults };
  // Префикс тега — для source с подтипом берём SOURCE_SUBTYPE_PREFIX
  let tagPrefix = null;
  if (type === 'source' && subtype && SOURCE_SUBTYPE_PREFIX[subtype]) {
    tagPrefix = SOURCE_SUBTYPE_PREFIX[subtype];
  }
  base.tag = tagPrefix ? nextFreeTagWithPrefix(tagPrefix) : nextFreeTag(type);
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
  // v0.58.11: новый узел добавляется ТОЛЬКО на текущую страницу.
  // На других страницах он попадает в палитру «Неразмещённые» —
  // пользователь сам решает, где карточку разместить. Данные карточки
  // (параметры, имя, связи) общие.
  if (state.currentPageId) {
    base.pageIds = [state.currentPageId];
  }
  state.nodes.set(id, base);
  _selectNode(id);
  _render();
  _notifyChange();
  return id;
}
// v0.58.9: подтверждение удаления — элемент удаляется со ВСЕХ страниц
// проекта (карточки общие). Без confirm — слишком легко потерять.
// Можно отключить подтверждение через GLOBAL.confirmDeleteNode = false
// или передать opts.silent=true (используется для программных удалений
// из каскада — secondStage, linkedOutdoorId и т.п.).
export function deleteNode(id, opts = {}) {
  const n0 = state.nodes.get(id);
  if (!n0) return;
  // v0.58.14: «soft delete» с холста — если указан opts.fromPage, удаляем
  // ноду только с этой страницы (pageIds.filter). Если страниц ещё нет —
  // элемент переходит в реестр (pageIds=[]), не уничтожается. Хард-удаление
  // только через × в палитре-реестре (opts.hard=true) или при явном opts.silent.
  const fromPage = opts.fromPage || null;
  if (fromPage && !opts.hard && !opts.silent) {
    const pids = Array.isArray(n0.pageIds) ? n0.pageIds : [];
    if (pids.includes(fromPage)) {
      _snapshot();
      n0.pageIds = pids.filter(p => p !== fromPage);
      if (n0.positionsByPage) delete n0.positionsByPage[fromPage];
      if (state.selectedKind === 'node' && state.selectedId === id) {
        state.selectedKind = null; state.selectedId = null;
      }
      return;
    }
    // Если страницы нет в списке — ничего не делаем (уже не на этой странице)
    return;
  }
  // v0.59.183: подтверждение удаления вынесено в callers (interaction/inspector),
  // там используется rsConfirm (in-page). Здесь — чистое выполнение.
  // Совместимость: если кто-то всё ещё зовёт без silent и GLOBAL.confirmDeleteNode
  // разрешает, — тихо продолжаем (подтверждение уже должно было состояться наверху).
  _snapshot();
  const n = state.nodes.get(id);
  // Каскадное удаление
  const linkedIds = [];
  if (n) {
    if (n.linkedOutdoorId) linkedIds.push(n.linkedOutdoorId);
    if (n.linkedIndoorId) linkedIds.push(n.linkedIndoorId);
    // Многосекционный щит — удаляем все секции
    if (n.switchMode === 'sectioned' && Array.isArray(n.sectionIds)) {
      for (const sid of n.sectionIds) linkedIds.push(sid);
    }
  }
  for (const lid of linkedIds) {
    const linked = state.nodes.get(lid);
    if (linked) {
      // Очистить обратную ссылку, чтобы не было рекурсии
      linked.linkedOutdoorId = null;
      linked.linkedIndoorId = null;
      for (const c of Array.from(state.conns.values())) {
        if (c.from.nodeId === lid || c.to.nodeId === lid) state.conns.delete(c.id);
      }
      // v0.59.143: каскадное удаление patch-link'ов инфо-портов.
      if (state.sysConns) {
        for (const sc of Array.from(state.sysConns.values())) {
          if (sc.fromNodeId === lid || sc.toNodeId === lid) state.sysConns.delete(sc.id);
        }
      }
      state.nodes.delete(lid);
      for (const m of state.modes) { if (m.overrides) delete m.overrides[lid]; }
    }
  }
  for (const c of Array.from(state.conns.values())) {
    if (c.from.nodeId === id || c.to.nodeId === id) state.conns.delete(c.id);
  }
  if (state.sysConns) {
    for (const sc of Array.from(state.sysConns.values())) {
      if (sc.fromNodeId === id || sc.toNodeId === id) state.sysConns.delete(sc.id);
    }
  }
  state.nodes.delete(id);
  for (const m of state.modes) { if (m.overrides) delete m.overrides[id]; }
  // Убрать из sectionIds контейнера
  if (n && n.parentSectionedId) {
    const parent = state.nodes.get(n.parentSectionedId);
    if (parent && Array.isArray(parent.sectionIds)) {
      parent.sectionIds = parent.sectionIds.filter(sid => sid !== id);
    }
  }
  if (state.selectedKind === 'node' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  _render();
  _renderInspector();
  _notifyChange();
}
export function deleteConn(id) {
  _snapshot();
  state.conns.delete(id);
  if (state.selectedKind === 'conn' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  _render();
  _renderInspector();
  _notifyChange();
}
export function clampPortsInvolvingNode(n) {
  // Порты удалять НЕ разрешаем — пользователь должен сначала снять связи.
  // Эта функция теперь только нормализует вспомогательные массивы.
  if (Array.isArray(n.priorities)) {
    while (n.priorities.length < nodeInputCount(n)) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = nodeInputCount(n);
  }
  if (n.type === 'panel' && Array.isArray(n.parallelEnabled)) {
    while (n.parallelEnabled.length < nodeInputCount(n)) n.parallelEnabled.push(false);
    n.parallelEnabled.length = nodeInputCount(n);
  }
}

// ================= Связи =================
export function wouldCreateCycle(fromNodeId, toNodeId) {
  const stack = [toNodeId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromNodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId === cur) stack.push(c.to.nodeId);
    }
  }
  return false;
}
export function tryConnect(from, to) {
  if (from.nodeId === to.nodeId) return false;
  // Вход щита/клеммной коробки может принимать до 2 линий (шлейф /
  // daisy-chain). Все прочие узлы — не более 1 связи на входной порт.
  const toNodeForLimit = state.nodes.get(to.nodeId);
  const inputMax = (toNodeForLimit && (toNodeForLimit.type === 'panel' || toNodeForLimit.type === 'junction-box')) ? 2 : 1;
  let existingOnTo = 0;
  for (const c of state.conns.values()) {
    if (c.to.nodeId === to.nodeId && c.to.port === to.port) existingOnTo++;
    // Выход может иметь только одну исходящую связь
    if (c.from.nodeId === from.nodeId && c.from.port === from.port) return false;
  }
  if (existingOnTo >= inputMax) return false;
  // v0.58.20: у endpoint-ов должна быть хотя бы одна общая система.
  // На странице определённого вида дополнительно эта система должна быть в
  // systemsForPageKind(kind) — иначе визуально связь сразу скроется.
  try {
    const fromN = state.nodes.get(from.nodeId);
    const toN = state.nodes.get(to.nodeId);
    if (fromN && toN) {
      // inline getNodeSystems (без кругового импорта из render.js)
      const sys = (n) => {
        if (Array.isArray(n.systems) && n.systems.length) return n.systems;
        if (n.type === 'zone' || n.type === 'channel') return ['electrical','low-voltage','data','pipes','hvac','gas','fire','security','video'];
        return ['electrical'];
      };
      const fs = sys(fromN), ts = sys(toN);
      let shared = false;
      for (const s of fs) if (ts.includes(s)) { shared = true; break; }
      if (!shared) return false;
    }
  } catch {}
  // Проверка цикличности отключена — схемы с АВР и встречными линиями допустимы
  _snapshot();
  const id = uid('c');
  // Фаза 1.16+: авто-подстановка основной марки кабеля из «Параметры проекта».
  // Определяем класс напряжения по узлам (простая эвристика для tryConnect —
  // recalc позже уточнит _isHV и может обновить cableMark если нужно).
  let defaultMark = null;
  try {
    const fromN = state.nodes.get(from.nodeId);
    const toN = state.nodes.get(to.nodeId);
    const levels = GLOBAL.voltageLevels || [];
    const getVll = (n) => {
      if (!n) return 0;
      const lv = (typeof n.voltageLevelIdx === 'number') ? levels[n.voltageLevelIdx] : null;
      return lv ? (Number(lv.vLL) || 0) : 0;
    };
    const isHv = Math.max(getVll(fromN), getVll(toN)) > 1000;
    defaultMark = isHv
      ? (GLOBAL.projectMainCableHv || null)
      : (GLOBAL.projectMainCableLv || null);
  } catch {}
  const conn = {
    id, from, to,
    // Дефолты по умолчанию для вывода ~1 м до щита/потребителя в норм. условиях
    material: GLOBAL.defaultMaterial,
    insulation: GLOBAL.defaultInsulation,
    installMethod: GLOBAL.defaultInstallMethod,
    ambientC: GLOBAL.defaultAmbient,
    grouping: GLOBAL.defaultGrouping,
    bundling: 'touching',
    lengthM: 1,
    cableMark: defaultMark,   // null если в Параметрах проекта не задано
  };
  state.conns.set(id, conn);
  _notifyChange();
  return id;
}
