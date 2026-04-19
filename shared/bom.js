// ======================================================================
// shared/bom.js
// BOM (Bill of Materials) — генератор спецификации проекта.
//
// Работает поверх element-library (через getElement / listElements) и
// state.nodes проекта. Поддерживает:
//
//  - Composition: element.composition = [{ elementId, qty, phantom, role }]
//    Разворачивается рекурсивно; phantom-элементы (скрытые от UI, но
//    учитываемые в BOM) выводятся в спецификацию.
//  - Node-level overrides: node.elementId ссылается на Element из
//    library; node.count (группы) и node.composition (локальный состав
//    вне library) учитываются.
//  - Backward-compat: узел без elementId — строка BOM по типу узла с
//    меткой (ИБП «Сервера», 12kW).
//
// Фаза 1.3 — минимальная версия. Без интеграции с reports/pdf (это
// придёт в 1.3.3 или 1.4 когда будет реальный состав у ИБП-конфигуратора).
// ======================================================================

import { getElement } from './element-library.js';

/**
 * Рекурсивное разворачивание composition в плоский массив line-items.
 * Возвращает: [{ elementId, label, qty, role, phantom, depth, path }]
 *
 * seen — защита от циклов. depth — уровень вложенности.
 */
export function expandComposition(element, multiplier = 1, depth = 0, seen = new Set(), path = []) {
  if (!element || !element.id) return [];
  if (seen.has(element.id)) {
    console.warn('[bom] composition cycle at', element.id);
    return [];
  }
  seen = new Set(seen); // per-branch, чтобы параллельные ветки не мешали
  seen.add(element.id);

  const items = [];
  // Сам элемент — корень (если depth=0, клиент сам решит включать или
  // только разворачивать состав)
  items.push({
    elementId: element.id,
    label: element.label || element.id,
    kind: element.kind,
    qty: multiplier,
    role: null,
    phantom: !!element.phantom,
    depth,
    path: [...path, element.id],
  });

  const comp = Array.isArray(element.composition) ? element.composition : [];
  for (const c of comp) {
    if (!c || !c.elementId) continue;
    const child = getElement(c.elementId);
    if (!child) {
      // Неизвестный id — выводим как placeholder
      items.push({
        elementId: c.elementId,
        label: c.label || ('? ' + c.elementId),
        kind: null,
        qty: (c.qty || 1) * multiplier,
        role: c.role || null,
        phantom: !!c.phantom,
        missing: true,
        depth: depth + 1,
        path: [...path, element.id, c.elementId],
      });
      continue;
    }
    const sub = expandComposition(child, (c.qty || 1) * multiplier, depth + 1, seen, [...path, element.id]);
    // Первый элемент sub — сам child; переносим его role/phantom из текущего ref
    if (sub[0]) {
      sub[0].role = c.role || null;
      sub[0].phantom = !!(c.phantom || sub[0].phantom);
    }
    items.push(...sub);
  }
  return items;
}

/**
 * Строка BOM для одного узла проекта.
 * Если node.elementId задан — разворачиваем через library.
 * Иначе генерим placeholder-строку по типу узла (backward-compat).
 */
export function bomForNode(node) {
  if (!node) return [];
  const count = Math.max(1, Number(node.count) || 1);
  // 1) node.elementId → library
  if (node.elementId) {
    const el = getElement(node.elementId);
    if (el) {
      return expandComposition(el, count, 0, new Set(), ['node:' + node.id]);
    }
  }
  // 2) Узел с inline-composition (не из library)
  if (Array.isArray(node.composition) && node.composition.length) {
    const synthetic = {
      id: 'node:' + node.id,
      label: (node.name || node.tag || node.type),
      kind: node.type,
      composition: node.composition,
    };
    return expandComposition(synthetic, count, 0, new Set(), []);
  }
  // 3) Placeholder — просто один line-item по типу узла
  return [{
    elementId: null,
    label: node.name || node.tag || node.type || 'node',
    kind: node.type,
    qty: count,
    role: null,
    phantom: false,
    depth: 0,
    path: ['node:' + node.id],
    nodeId: node.id,
  }];
}

/**
 * Собрать BOM всего проекта.
 * state — объект с .nodes Map (такой же как в js/engine/state.js).
 *
 * Возвращает { flat, aggregated }:
 *   flat — все line-items в порядке обхода (иерархия через depth)
 *   aggregated — агрегированные по elementId + role ({ elementId, label,
 *     kind, qty, role, phantom }), qty просуммированы
 */
export function collectBomFromProject(state) {
  if (!state || !state.nodes) return { flat: [], aggregated: [] };
  const flat = [];
  const nodes = (state.nodes instanceof Map) ? [...state.nodes.values()] : Object.values(state.nodes);
  for (const node of nodes) {
    // Узлы не-оборудование — пропускаем (зоны, каналы — это не BOM)
    if (node.type === 'zone') continue;
    const items = bomForNode(node);
    flat.push(...items);
  }
  return { flat, aggregated: aggregateBom(flat) };
}

/**
 * Группировка по (elementId, role). Строки без elementId группируются
 * по (label, kind). phantom не суммируется отдельно — phantom-признак
 * имеет строка если все её источники phantom, иначе false.
 */
export function aggregateBom(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.elementId
      ? it.elementId + '|' + (it.role || '')
      : 'none|' + (it.label || '') + '|' + (it.kind || '');
    const prev = map.get(key);
    if (prev) {
      prev.qty += it.qty;
      if (!it.phantom) prev.phantom = false;
    } else {
      map.set(key, {
        elementId: it.elementId,
        label: it.label,
        kind: it.kind,
        qty: it.qty,
        role: it.role,
        phantom: it.phantom,
        missing: it.missing,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    (a.kind || '').localeCompare(b.kind || '') || (a.label || '').localeCompare(b.label || '')
  );
}

/**
 * Группировка для отчёта: по kind (panel / ups / battery / ...) с
 * под-группами по (label, role).
 */
export function groupBomByKind(aggregated) {
  const groups = {};
  for (const it of aggregated) {
    const k = it.kind || 'other';
    if (!groups[k]) groups[k] = [];
    groups[k].push(it);
  }
  return groups;
}

/**
 * Сформировать markdown-таблицу BOM для включения в отчёт.
 * Возвращает строку.
 */
export function bomToMarkdown(aggregated) {
  if (!aggregated || !aggregated.length) return '_Спецификация пуста_';
  const groups = groupBomByKind(aggregated);
  const KIND_LABELS = {
    panel: 'Распределительные щиты',
    ups: 'ИБП',
    battery: 'Аккумуляторные батареи',
    transformer: 'Трансформаторы',
    breaker: 'Автоматические выключатели',
    enclosure: 'Корпуса щитов',
    climate: 'Климатическое оборудование',
    'consumer-type': 'Потребители',
    'cable-type': 'Типы кабелей',
    channel: 'Кабельные трассы',
    custom: 'Прочее',
    other: 'Прочее',
  };
  const lines = ['| Тип | Наименование | Кол-во |', '|---|---|---:|'];
  for (const [kind, items] of Object.entries(groups)) {
    lines.push(`| **${KIND_LABELS[kind] || kind}** | | |`);
    for (const it of items) {
      const label = (it.phantom ? '*' : '') + (it.label || it.elementId) + (it.role ? ` (${it.role})` : '');
      lines.push(`| ${kind} | ${label} | ${it.qty} |`);
    }
  }
  return lines.join('\n');
}
