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

// v0.59.792 (ROADMAP 1.28.19): property inheritance для aliases. Пользователь:
// «свойства расположенных внутри объектов связаны с основным (кроме
// обозначений)». Если node — alias (linkedAlias указывает на shell),
// читаем электрику из shell. Tag/name остаются индивидуальные.
//
// Стратегия: GETTER без мутации. Старые stored-значения на alias'е
// остаются как fallback (если shell удалён) или для legacy-данных,
// но при наличии shell приоритет — у shell'а.
function _shellOf(n) {
  if (n && n.linkedAlias && state.nodes && state.nodes.get) {
    const s = state.nodes.get(n.linkedAlias);
    return s || null;
  }
  return null;
}
export function effectiveDemandKw(n) {
  const s = _shellOf(n);
  if (s) return Number(s.demandKw) || 0;
  return Number(n?.demandKw) || 0;
}
export function effectiveCosPhi(n) {
  const s = _shellOf(n);
  if (s && Number.isFinite(Number(s.cosPhi))) return Number(s.cosPhi);
  return Number(n?.cosPhi) || 0.95;
}
export function effectivePhase(n) {
  const s = _shellOf(n);
  if (s && s.phase) return s.phase;
  return n?.phase || '3ph';
}
export function effectiveVoltageLevelIdx(n) {
  const s = _shellOf(n);
  if (s && Number.isFinite(Number(s.voltageLevelIdx))) return Number(s.voltageLevelIdx);
  return Number(n?.voltageLevelIdx) || 0;
}
export function effectiveConsumerSubtype(n) {
  const s = _shellOf(n);
  if (s && s.consumerSubtype) return s.consumerSubtype;
  return n?.consumerSubtype || '';
}
export function isAliasOfShell(n) { return !!_shellOf(n); }

// v0.59.774: базовое обозначение узла. Для consumer-группы с привязанными
// экземплярами (linkedAliases) — берём обозначение первого экземпляра
// в естественной сортировке (SR01 < SR02 < SR10). Пользователь: «группа
// потребителей должна иметь обозначение по обозначению первого экземпляра
// (не размещенного а по сортировке)». Для остальных — просто n.tag.
// v0.59.815: для consumer-container — обозначение младшего linked-consumer'а
// (placeholders без tag не участвуют). Пользователь: «объект контейнер
// потребителей принимает обозначение объекта с самым младшим обозначением
// (по сортировке)».
function _baseTag(n) {
  const first = _firstSortedAlias(n);
  if (first && first.tag) return first.tag;
  return (n && n.tag) || '';
}

// v0.59.811: возвращает первый по натуральной сортировке alias-узел
// внутри shell-группы (если есть). Используется для derived display
// данных (tag, name, etc).
// v0.59.815: расширено для нового типа 'consumer-container' — собирает
// linked-consumer-узлы из slots[].
function _firstSortedAlias(n) {
  if (!n) return null;
  // Новая модель: consumer-container с slots[]
  if (n.type === 'consumer-container' && Array.isArray(n.slots)) {
    let first = null;
    for (const s of n.slots) {
      if (!s || s.kind !== 'linked' || !s.nodeId) continue;
      const a = state.nodes.get(s.nodeId);
      if (!a || !a.tag) continue;
      if (!first || a.tag.localeCompare(first.tag, undefined, { numeric: true, sensitivity: 'base' }) < 0) {
        first = a;
      }
    }
    return first;
  }
  // Legacy модель: shell consumer с linkedAliases
  if (!Array.isArray(n.linkedAliases) || n.linkedAliases.length === 0) return null;
  let first = null;
  for (const aid of n.linkedAliases) {
    if (!aid) continue;
    const a = state.nodes.get(aid);
    if (!a || !a.tag) continue;
    if (!first || a.tag.localeCompare(first.tag, undefined, { numeric: true, sensitivity: 'base' }) < 0) {
      first = a;
    }
  }
  return first;
}

// v0.59.815: helpers для работы с consumer-container.
// containerLinkedConsumers — массив реальных consumer-узлов из linked-слотов.
// containerPlaceholders — массив placeholder-спецификаций (kind:'placeholder').
// containerSlotCount — общее число слотов (linked + placeholder).
// isInContainer — true если consumer-узел является членом какого-либо контейнера
//   (т.е. имеет n.containerId, указывающий на существующий container).
export function containerLinkedConsumers(container) {
  if (!container || container.type !== 'consumer-container' || !Array.isArray(container.slots)) return [];
  const out = [];
  for (const s of container.slots) {
    if (!s || s.kind !== 'linked' || !s.nodeId) continue;
    const a = state.nodes.get(s.nodeId);
    if (a) out.push(a);
  }
  return out;
}
export function containerPlaceholders(container) {
  if (!container || container.type !== 'consumer-container' || !Array.isArray(container.slots)) return [];
  return container.slots.filter(s => s && s.kind === 'placeholder');
}
export function containerSlotCount(container) {
  if (!container || container.type !== 'consumer-container' || !Array.isArray(container.slots)) return 0;
  return container.slots.length;
}
export function isInContainer(n) {
  if (!n || !n.containerId) return false;
  const c = state.nodes.get(n.containerId);
  return !!(c && c.type === 'consumer-container');
}

// v0.59.830 (1.28.20): нормализация контейнеров.
//   1. Чистка битых ссылок: slot.nodeId не существует → slot удаляется.
//   2. Авто-коллапс: если в контейнере остался ровно 1 валидный linked-слот
//      и нет placeholder'ов, контейнер сворачивается в этот consumer-узел
//      (consumer возвращается на canvas: pageIds container'а; connections
//      container.id перенаправляются на consumer.id; контейнер удаляется).
//   3. Пустой контейнер удаляется.
// Пользователь: «если потребитель был отвергнут группой, не следует
// все равно создавать группу с одним слотом и этим потребителем,
// нужно оставить его как простой потребитель».
export function normalizeContainers() {
  const toDelete = [];
  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer-container') continue;
    if (!Array.isArray(n.slots)) { n.slots = []; }
    // 1. Чистка битых linked-ссылок
    n.slots = n.slots.filter(s => {
      if (!s) return false;
      if (s.kind === 'linked') {
        if (!s.nodeId) return false;
        const a = state.nodes.get(s.nodeId);
        if (!a) return false;
      }
      return true;
    });
    // 2. Подсчёт linked + placeholders
    let linkedCount = 0, phCount = 0, lastLinkedId = null;
    for (const s of n.slots) {
      if (s.kind === 'linked' && s.nodeId) { linkedCount++; lastLinkedId = s.nodeId; }
      else if (s.kind === 'placeholder') phCount++;
    }
    // 3. Авто-коллапс: 1 linked + 0 placeholder → выкатить consumer обратно
    if (linkedCount === 1 && phCount === 0 && lastLinkedId) {
      const a = state.nodes.get(lastLinkedId);
      if (a) {
        // consumer возвращается на canvas: получает pageIds от контейнера
        a.pageIds = Array.isArray(n.pageIds) ? n.pageIds.slice() : [];
        if (n.positionsByPage) {
          a.positionsByPage = JSON.parse(JSON.stringify(n.positionsByPage));
        }
        a.x = n.x; a.y = n.y;
        delete a.containerId;
        // Перенаправить connections container → consumer
        for (const c of state.conns.values()) {
          if (c.from && c.from.nodeId === n.id) c.from.nodeId = a.id;
          if (c.to   && c.to.nodeId   === n.id) c.to.nodeId   = a.id;
        }
        if (state.sysConns) {
          for (const sc of state.sysConns.values()) {
            if (sc.fromNodeId === n.id) sc.fromNodeId = a.id;
            if (sc.toNodeId   === n.id) sc.toNodeId   = a.id;
          }
        }
        toDelete.push(n.id);
        continue;
      }
    }
    // 4. Пустой контейнер — удалить
    if (n.slots.length === 0) {
      toDelete.push(n.id);
    }
  }
  for (const id of toDelete) {
    // Снять containerId со всех бывших членов (их consumer-узлы остаются
    // в state.nodes но без containerId — они либо уже унаследовали pageIds
    // в коллапсе, либо остаются unplaced).
    const removed = state.nodes.get(id);
    if (removed && Array.isArray(removed.slots)) {
      for (const s of removed.slots) {
        if (s && s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a && a.containerId === id) delete a.containerId;
        }
      }
    }
    state.nodes.delete(id);
  }
  return toDelete.length;
}

// v0.59.811: эффективное имя узла. Для shell-группы с linkedAliases —
// имя первого alias-узла (как и effectiveTag). Иначе n.name.
// Пользователь: «обозначается по первому потребителю в группе» —
// аналогично применяется к name, чтобы tag и name не рассинхронизировались.
export function effectiveName(n) {
  const first = _firstSortedAlias(n);
  if (first && first.name) return first.name;
  return (n && n.name) || '';
}

// Эффективное обозначение с учётом полной цепочки зон: «G1.S2.PNL1».
// v0.59.774: для consumer-группы базовое обозначение = обозначение первого
// привязанного экземпляра по сортировке (см. _baseTag).
export function effectiveTag(n) {
  if (!n) return '';
  if (n.type === 'zone') {
    const chain = zoneChain(n);
    return chain.map(z => z.zonePrefix || z.tag || '').filter(Boolean).join('.');
  }
  const baseTag = _baseTag(n);
  // Секция многосекционного щита: PNL1.P1
  if (n.parentSectionedId) {
    const parent = state.nodes.get(n.parentSectionedId);
    if (parent) {
      const parentTag = effectiveTag(parent);
      // Секция использует свой tag как суффикс (P1, P2...)
      return parentTag ? `${parentTag}.${baseTag}` : baseTag;
    }
  }
  const z = findZoneForMember(n);
  if (z) {
    const prefix = zonePrefix(z);
    if (prefix) return `${prefix}.${baseTag}`;
  }
  // Многосекционный контейнер: если сам не в зоне, проверить зону первой секции
  if (n.type === 'panel' && n.switchMode === 'sectioned' && Array.isArray(n.sectionIds) && n.sectionIds.length) {
    const firstSec = state.nodes.get(n.sectionIds[0]);
    if (firstSec) {
      const secZone = findZoneForMember(firstSec);
      if (secZone) {
        const prefix = zonePrefix(secZone);
        if (prefix) return `${prefix}.${baseTag}`;
      }
    }
  }
  return baseTag;
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
    // Переписать кросс-ссылки по idMap. Важно: маппим тупо через idMap,
    // а не фильтруем через state.nodes.has(), т.к. на момент клонирования
    // корневой зоны её дочерние копии ещё НЕ добавлены в state.nodes
    // (они создаются позже в этом же цикле). Фильтр state.nodes.has()
    // вырезал memberIds и дети оказывались отвязанными.
    if (Array.isArray(copy.memberIds)) {
      copy.memberIds = copy.memberIds
        .map(id => idMap.get(id))
        .filter(id => !!id);
    }
    if (Array.isArray(copy.sectionIds)) {
      copy.sectionIds = copy.sectionIds
        .map(id => idMap.get(id) || id)
        .filter(id => !!id);
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
