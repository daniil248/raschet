// =========================================================================
// shared/scheme-rack-bridge.js — v0.59.345
//
// Раскрывает «стойки из схемы» в индивидуальные виртуальные экземпляры для
// списков scs-config / scs-design.
//
// Источник: узлы схемы проекта (`raschet.project.<pid>.engine.scheme.v1`),
// у которых `type === 'consumer'` и `(subtype === 'rack' || consumerKind === 'rack')`.
// Каждый такой узел имеет поле `count` (по умолчанию 1) — это N физических
// стоек одного типоразмера, нарисованных одним символом на схеме.
//
// Раньше: один узел = одна позиция в Компоновщике СКС (даже если count>3).
// Теперь: один узел с count=N = N отдельных позиций с уникальными Tag.
//
// Виртуальные id детерминированы: `scheme-<nodeId>-<i>` (1-based), что важно
// — мы не плодим случайные id при каждой перезагрузке. Их можно «материализовать»
// в полноценный inst-* экземпляр, тогда виртуальный из списка пропадёт
// (override’ится по тегу через скрытие — см. ensureNotShadowed).
// =========================================================================

import { projectKey } from './project-storage.js';

const SCHEME_KEY_SUFFIX = ['engine', 'scheme.v1'];

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

/** Базовый «тег» узла схемы — то, что пользователь увидит в Tag-колонке. */
function baseTagOf(n) {
  const t = (n.tag || '').trim();
  if (t) return t;
  const name = (n.name || '').trim();
  if (name) return name.replace(/\s+/g, '');
  return 'R' + String(n.id || '').slice(-4);
}

/** Имя по умолчанию для виртуальной стойки. */
function baseNameOf(n) {
  return (n.name || '').trim() || (n.tag || '').trim() || 'Серверная стойка';
}

/** Считает, что узел схемы — серверная/телеком стойка. */
function isRackNode(n) {
  return n && n.type === 'consumer' &&
    (n.subtype === 'rack' || n.consumerKind === 'rack');
}

/**
 * Развернуть стойки проекта из схемы в индивидуальные «виртуальные» экземпляры.
 * @param {string} pid — id проекта
 * @returns {Array<{id, name, u, occupied, fromScheme:true, schemeNodeId, schemeIndex, autoTag}>}
 */
export function loadSchemeVirtualRacks(pid) {
  if (!pid) return [];
  const schemeKey = projectKey(pid, SCHEME_KEY_SUFFIX[0], SCHEME_KEY_SUFFIX[1]);
  const scheme = loadJson(schemeKey, null);
  if (!scheme || !Array.isArray(scheme.nodes)) return [];

  const out = [];
  for (const n of scheme.nodes) {
    if (!isRackNode(n)) continue;
    const total = Math.max(1, parseInt(n.count, 10) || 1);
    const baseTag = baseTagOf(n);
    const baseName = baseNameOf(n);
    // Поля u/occupied — если у узла есть rackTemplate с этими данными,
    // подставляем; иначе дефолт 42U.
    const tpl = n.rackTemplate && typeof n.rackTemplate === 'object' ? n.rackTemplate : null;
    const u = (tpl && Number.isFinite(tpl.u)) ? tpl.u : 42;
    const occupied = (tpl && Number.isFinite(tpl.occupied)) ? tpl.occupied : 0;

    for (let i = 1; i <= total; i++) {
      const tag = total > 1 ? `${baseTag}-${i}` : baseTag;
      out.push({
        id: `scheme-${n.id}-${i}`,
        name: total > 1 ? `${baseName} #${i}` : baseName,
        u,
        occupied,
        fromScheme: true,
        schemeNodeId: n.id,
        schemeIndex: i,
        schemeTotal: total,
        autoTag: tag,
      });
    }
  }
  return out;
}

/**
 * v0.59.532: виртуальные стойки из POR consumer-group с rack-членами.
 * Источник: POR.getObjects(pid, { type: 'consumer-group' }) — для каждой
 * группы с subtype='rack' (или с rack-членами) генерируем `count` виртуалов.
 * Если у группы есть materialized members[], для каждого члена с известным
 * id используем его как identity (id виртуала = member.id). Анонимные слоты
 * получают детерминированный id `por-group-<gid>-<i>`.
 *
 * Это нужно для случая, когда электрик нарисовал группу ×N в POR (через
 * playground / engine mirror anonymous-mode), но индивидуальные racks ещё
 * не созданы. SCS-инженер должен видеть N посадочных мест в Компоновщике.
 */
export function loadPorGroupVirtualRacks(pid) {
  if (!pid) return [];
  if (typeof window === 'undefined' || !window.RaschetPOR) return [];
  let groups = [];
  try { groups = window.RaschetPOR.getObjects(pid, { type: 'consumer-group' }) || []; }
  catch { return []; }

  const out = [];
  for (const g of groups) {
    if (!g || !g.id) continue;
    // Группа представляет racks, если subtype='rack' или хотя бы один член — rack.
    const memberType = (g.subtype || '').trim();
    if (memberType && memberType !== 'rack' && memberType !== 'consumer-rack') continue;

    const e = (g.domains && g.domains.electrical) || {};
    const members = Array.isArray(e.members) ? e.members : [];
    const count   = Math.max(members.length, parseInt(e.count, 10) || 0);
    if (!count) continue;

    const baseTag  = (g.tag || '').trim() || (g.name || '').trim() || 'GR' + String(g.id).slice(-4);
    const baseName = (g.name || '').trim() || baseTag;

    for (let i = 1; i <= count; i++) {
      const tag = count > 1 ? `${baseTag}-${i}` : baseTag;
      const memberId = members[i - 1] || null;
      out.push({
        id: memberId || `por-group-${g.id}-${i}`,
        name: count > 1 ? `${baseName} #${i}` : baseName,
        u: 42,
        occupied: 0,
        fromPorGroup: true,
        porGroupId:  g.id,
        porGroupSlot: i,
        porMemberId: memberId,            // null для анонимного слота
        autoTag: tag,
        schemeTotal: count,
        schemeIndex: i,
      });
    }
  }
  return out;
}

/**
 * Слить виртуальные «стойки из схемы» с реальным списком стоек.
 * Виртуальные, чей autoTag уже занят реальной стойкой (с тегом), скрываются —
 * пользователь явно «материализовал» эту позицию.
 * @param {Array} realRacks — что вернул loadAllRacksForActiveProject()
 * @param {Object} tagMap — { rackId: tag } из rackTags.v1
 * @param {Array} virtuals — что вернул loadSchemeVirtualRacks()
 * @returns {{ merged: Array, autoTags: Object }} — autoTags = карта id→тег
 *   для виртуальных (используется как «как если бы они были в rackTags»).
 */
export function mergeWithSchemeRacks(realRacks, tagMap, virtuals) {
  const usedTags = new Set();
  for (const r of (realRacks || [])) {
    const t = (tagMap && tagMap[r.id]) ? String(tagMap[r.id]).trim() : '';
    if (t) usedTags.add(t);
  }
  const autoTags = {};
  const visible = [];
  for (const v of (virtuals || [])) {
    if (usedTags.has(v.autoTag)) continue; // материализована
    visible.push(v);
    autoTags[v.id] = v.autoTag;
  }
  return {
    merged: [...(realRacks || []), ...visible],
    autoTags,
  };
}
