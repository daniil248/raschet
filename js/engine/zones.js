import { state } from './state.js';
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
  const z = findZoneForMember(n);
  if (z) {
    const prefix = zonePrefix(z);
    if (prefix) return `${prefix}.${n.tag || ''}`;
  }
  return n.tag || '';
}

// Узлы, принадлежащие зоне (для drag-all / отображения)
export function nodesInZone(zone) {
  if (!zone || !Array.isArray(zone.memberIds)) return [];
  const result = [];
  for (const id of zone.memberIds) {
    const n = state.nodes.get(id);
    if (n) result.push(n);
  }
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

// Проверка: сколько портов данного вида реально занято связями
export function maxOccupiedPort(nodeId, kind) {
  let max = -1;
  for (const c of state.conns.values()) {
    if (kind === 'in' && c.to.nodeId === nodeId) max = Math.max(max, c.to.port);
    if (kind === 'out' && c.from.nodeId === nodeId) max = Math.max(max, c.from.port);
  }
  return max;
}
