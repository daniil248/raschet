import { state, uid } from './state.js';
import { nodeWidth, nodeHeight } from './geometry.js';

// Полностью ли bbox узла внутри bbox зоны.
export function isNodeFullyInside(n, zone) {
  if (!n || !zone || zone.type !== 'zone') return false;
  const nw = nodeWidth(n), nh = nodeHeight(n);
  const zw = nodeWidth(zone), zh = nodeHeight(zone);
  return n.x >= zone.x
      && n.y >= zone.y
      && n.x + nw <= zone.x + zw
      && n.y + nh <= zone.y + zh;
}

// Зона, в которую по членству входит узел. Если узел числится в нескольких
// (вложенных), берём ту, где bbox зоны меньше.
export function findZoneForMember(n) {
  if (!n || n.type === 'zone') return null;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (!Array.isArray(z.memberIds) || !z.memberIds.includes(n.id)) continue;
    const area = nodeWidth(z) * nodeHeight(z);
    if (area < bestArea) { best = z; bestArea = area; }
  }
  return best;
}

// Родительская зона для зоны (зона, содержащая другую зону как member)
export function findParentZone(zone) {
  if (!zone || zone.type !== 'zone') return null;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone' || z.id === zone.id) continue;
    if (!Array.isArray(z.memberIds) || !z.memberIds.includes(zone.id)) continue;
    const area = nodeWidth(z) * nodeHeight(z);
    if (area < bestArea) { best = z; bestArea = area; }
  }
  return best;
}

// Полная цепочка зон от корневой до текущей (включая саму зону)
function zoneChain(zone) {
  const chain = [];
  let cur = zone;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = findParentZone(cur);
  }
  return chain;
}

// Полный префикс зоны с учётом вложенности: «G1.S2»
export function zonePrefix(zone) {
  const chain = zoneChain(zone);
  return chain.map(z => z.zonePrefix || z.tag || '').filter(Boolean).join('.');
}

// Эффективное обозначение с учётом полной цепочки зон: «G1.S2.PNL1»
export function effectiveTag(n) {
  if (!n) return '';
  if (n.type === 'zone') {
    const chain = zoneChain(n);
    return chain.map(z => z.zonePrefix || z.tag || '').filter(Boolean).join('.');
  }
  // Секция многосекционного щита: PNL1.P1
  if (n.parentSectionedId) {
    const parent = state.nodes.get(n.parentSectionedId);
    if (parent) {
      const parentTag = effectiveTag(parent);
      // Секция использует свой tag как суффикс (P1, P2...)
      return parentTag ? `${parentTag}.${n.tag || ''}` : (n.tag || '');
    }
  }
  const z = findZoneForMember(n);
  if (z) {
    const prefix = zonePrefix(z);
    if (prefix) return `${prefix}.${n.tag || ''}`;
  }
  // Многосекционный контейнер: если сам не в зоне, проверить зону первой секции
  if (n.type === 'panel' && n.switchMode === 'sectioned' && Array.isArray(n.sectionIds) && n.sectionIds.length) {
    const firstSec = state.nodes.get(n.sectionIds[0]);
    if (firstSec) {
      const secZone = findZoneForMember(firstSec);
      if (secZone) {
        const prefix = zonePrefix(secZone);
        if (prefix) return `${prefix}.${n.tag || ''}`;
      }
    }
  }
  return n.tag || '';
}

// Узлы, принадлежащие зоне РЕКУРСИВНО (включая потомков дочерних зон
// и секции многосекционных щитов)
export function nodesInZone(zone) {
  if (!zone || !Array.isArray(zone.memberIds)) return [];
  const result = [];
  const visited = new Set();
  const collect = (ids) => {
    for (const id of ids) {
      if (visited.has(id)) continue;
      visited.add(id);
      const n = state.nodes.get(id);
      if (!n) continue;
      result.push(n);
      // Рекурсия: дочерняя зона → её члены
      if (n.type === 'zone' && Array.isArray(n.memberIds)) {
        collect(n.memberIds);
      }
      // Рекурсия: многосекционный щит → его секции
      if (n.type === 'panel' && n.switchMode === 'sectioned' && Array.isArray(n.sectionIds)) {
        collect(n.sectionIds);
      }
    }
  };
  collect(zone.memberIds);
  return result;
}

// Попытаться добавить узел в зону, если он полностью внутри неё и ещё
// не является членом. Берём самую «узкую» подходящую зону.
export function tryAttachToZone(n) {
  if (!n) return;
  // Зона не прикрепляется к самой себе
  // Для обычных узлов: если уже член зоны — не трогаем
  if (n.type !== 'zone' && findZoneForMember(n)) return;
  // Для зон: если уже вложена — не трогаем
  if (n.type === 'zone' && findParentZone(n)) return;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (z.id === n.id) continue; // не к самой себе
    if (!isNodeFullyInside(n, z)) continue;
    const area = nodeWidth(z) * nodeHeight(z);
    if (area < bestArea) { best = z; bestArea = area; }
  }
  if (best) {
    if (!Array.isArray(best.memberIds)) best.memberIds = [];
    if (!best.memberIds.includes(n.id)) best.memberIds.push(n.id);
  }
}

// Убрать узел из всех зон
export function detachFromZones(nodeId) {
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (!Array.isArray(z.memberIds)) continue;
    z.memberIds = z.memberIds.filter(id => id !== nodeId);
  }
}

// ======================================================================
// Копирование зоны со всеми элементами
// ======================================================================
//
// Создаёт полный клон зоны (корневой) со всеми вложенными элементами
// и подзонами. Внутренние элементы КЛОНИРУЮТСЯ ЦЕЛИКОМ но сохраняют
// свои tag'и (обозначения) — уникальность обеспечивается тем, что
// effectiveTag() включает префикс корневой зоны, который меняется.
//
// Корневая новая зона получает zonePrefix следующего незанятого
// номера с тем же буквенным префиксом (P1 → P2 если P2 свободен).
//
// Также клонируются все внутренние связи (обе конечные ноды которых
// входят в клонируемое множество). Связи, выходящие за пределы зоны,
// НЕ клонируются.
//
// Возвращает id новой корневой зоны (или null при ошибке).
// ======================================================================
export function copyZoneWithMembers(zoneId) {
  const src = state.nodes.get(zoneId);
  if (!src || src.type !== 'zone') return null;

  // 1. Собираем полный набор клонируемых нод (зона + рекурсивно все
  //    memberIds, включая подзоны и секции щитов).
  const srcIds = new Set([src.id]);
  const walk = (ids) => {
    for (const id of ids || []) {
      if (srcIds.has(id)) continue;
      srcIds.add(id);
      const nn = state.nodes.get(id);
      if (!nn) continue;
      if (nn.type === 'zone' && Array.isArray(nn.memberIds)) walk(nn.memberIds);
      if (nn.type === 'panel' && nn.switchMode === 'sectioned' && Array.isArray(nn.sectionIds)) walk(nn.sectionIds);
    }
  };
  walk(src.memberIds);

  // 2. Вычисляем новый zonePrefix корневой зоны. Отделяем буквенный
  //    префикс от числового суффикса: «P12» → ('P', 12). Перебираем
  //    номера от N+1 до первой свободной комбинации.
  const srcPrefix = String(src.zonePrefix || src.tag || 'Z1');
  const m = srcPrefix.match(/^(\D*)(\d+)$/);
  let basePrefix = 'Z';
  let startNum = 1;
  if (m) { basePrefix = m[1] || 'Z'; startNum = Number(m[2]) || 1; }
  else { basePrefix = srcPrefix; startNum = 1; }

  const usedZonePrefixes = new Set();
  for (const nn of state.nodes.values()) {
    if (nn.type === 'zone' && nn.zonePrefix) usedZonePrefixes.add(nn.zonePrefix);
  }
  let newNum = startNum + 1;
  let newZonePrefix;
  while (true) {
    newZonePrefix = basePrefix + newNum;
    if (!usedZonePrefixes.has(newZonePrefix)) break;
    newNum++;
    if (newNum > 99999) { newZonePrefix = basePrefix + Date.now(); break; }
  }

  // 3. Определяем оффсет: справа от исходной зоны + 40 px.
  const dx = (Number(nodeWidth(src)) || 600) + 40;
  const dy = 0;

  // 4. Создаём мапу старый id → новый id ДО клонирования, чтобы
  //    потом можно было переписать все кросс-ссылки (memberIds,
  //    sectionIds, parentSectionedId, linked*Id и т.п.).
  const idMap = new Map();
  for (const oldId of srcIds) idMap.set(oldId, uid());

  // 5. Клонируем каждый узел.
  const skipRuntime = new Set([
    '_loadKw','_loadA','_powered','_overload','_cosPhi','_onBattery',
    '_inputKw','_nominalA','_ratedA','_inrushA','_calcKw','_maxLoadKw','_maxLoadA',
    '_avrBreakerOverride','_avrActivePort','_avrSwitchCountdown','_avrInterlockCountdown',
    '_avrDisconnected','_prevSwitchMode','_onStaticBypass','_trafoP0Kw','_trafoPkKw',
    '_watchdogActivePorts','_ownInputPowered','_ownInputAvailable','_activeTriggerGroup',
    '_running','_startCountdown','_stopCountdown','_avrSwitchStartedAt','_ikA','_deltaUPct',
    '_marginPct','_marginWarn','_powerP','_powerQ','_powerS','_linkD','_linkPreview',
  ]);
  for (const oldId of srcIds) {
    const srcNode = state.nodes.get(oldId);
    if (!srcNode) continue;
    const copy = JSON.parse(JSON.stringify(srcNode));
    // Чистим runtime-поля
    for (const k of Object.keys(copy)) {
      if (skipRuntime.has(k) || k.startsWith('_')) delete copy[k];
    }
    copy.id = idMap.get(oldId);
    // Смещение координат
    if (typeof copy.x === 'number') copy.x += dx;
    if (typeof copy.y === 'number') copy.y += dy;
    // Переписать кросс-ссылки по idMap
    if (Array.isArray(copy.memberIds)) {
      copy.memberIds = copy.memberIds.map(id => idMap.get(id) || id).filter(id => idMap.has(id) || state.nodes.has(id));
      // После фильтра оставляем только те, что действительно в idMap
      copy.memberIds = copy.memberIds.filter(id => [...idMap.values()].includes(id));
    }
    if (Array.isArray(copy.sectionIds)) {
      copy.sectionIds = copy.sectionIds.map(id => idMap.get(id) || id);
    }
    if (copy.parentSectionedId) {
      copy.parentSectionedId = idMap.get(copy.parentSectionedId) || copy.parentSectionedId;
    }
    if (copy.linkedOutdoorId) copy.linkedOutdoorId = idMap.get(copy.linkedOutdoorId) || copy.linkedOutdoorId;
    if (copy.linkedIndoorId) copy.linkedIndoorId = idMap.get(copy.linkedIndoorId) || copy.linkedIndoorId;

    // Для корневой зоны копии назначаем новый zonePrefix.
    if (oldId === src.id) {
      copy.zonePrefix = newZonePrefix;
    }
    state.nodes.set(copy.id, copy);
  }

  // 6. Клонируем связи, у которых оба конца внутри srcIds.
  for (const c of state.conns.values()) {
    if (!srcIds.has(c.from.nodeId) || !srcIds.has(c.to.nodeId)) continue;
    const newConn = JSON.parse(JSON.stringify(c));
    for (const k of Object.keys(newConn)) {
      if (k.startsWith('_')) delete newConn[k];
    }
    newConn.id = uid('c');
    newConn.from = { nodeId: idMap.get(c.from.nodeId), port: c.from.port };
    newConn.to   = { nodeId: idMap.get(c.to.nodeId),   port: c.to.port };
    state.conns.set(newConn.id, newConn);
  }

  return idMap.get(src.id);
}

// Проверка: сколько портов данного вида реально занято связями
export function maxOccupiedPort(nodeId, kind) {
  let max = -1;
  for (const c of state.conns.values()) {
    if (kind === 'in' && c.to.nodeId === nodeId) max = Math.max(max, c.to.port);
    if (kind === 'out' && c.from.nodeId === nodeId) max = Math.max(max, c.from.port);
  }
  return max;
}
