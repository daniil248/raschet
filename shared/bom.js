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
 * Резолвит legacy-поля узла (upsCatalogId / panelCatalogId / transformerId
 * / batteryCatalogId) как ссылку на Element в library. Возвращает id или null.
 * Используется backward-compat: узлы старых проектов не имеют node.elementId,
 * но имеют специфические *.catalogId.
 */
function _resolveLegacyElementId(node) {
  if (!node) return null;
  if (node.elementId) return node.elementId;
  if (node.upsCatalogId) return node.upsCatalogId;
  if (node.panelCatalogId) return node.panelCatalogId;
  if (node.enclosureId) return node.enclosureId;
  if (node.transformerCatalogId) return node.transformerCatalogId;
  return null;
}

/**
 * Для ИБП с выбранной АКБ из каталога — строим синтетическую композицию
 * { ибп + (строк × блоков) батарей }. Phantom-режим: батареи помечаются
 * role='battery' и видны в BOM как отдельная строка.
 */
function _syntheticUpsComposition(node) {
  if (!node || node.type !== 'ups') return null;
  if (!node.batteryCatalogId) return null;
  const strings = Math.max(1, Number(node.batteryStringCount) || 1);
  const blocks = Math.max(1, Number(node.batteryBlocksPerString) || 0);
  if (!blocks) return null;
  return {
    elementId: node.batteryCatalogId,
    qty: strings * blocks,
    role: 'battery',
    phantom: false,
  };
}

/**
 * Строка BOM для одного узла проекта.
 * Если node.elementId задан — разворачиваем через library.
 * Иначе генерим placeholder-строку по типу узла (backward-compat).
 */
export function bomForNode(node) {
  if (!node) return [];
  const count = Math.max(1, Number(node.count) || 1);
  const elementId = _resolveLegacyElementId(node);
  const items = [];

  // 1) node.elementId / legacy catalogId → library
  if (elementId) {
    const el = getElement(elementId);
    if (el) {
      items.push(...expandComposition(el, count, 0, new Set(), ['node:' + node.id]));
      // Label корня заменим на имя узла (ИБП "Сервера" вместо "APC Smart-UPS 3000")
      if (items[0] && node.name) {
        items[0].label = node.name + ' (' + (items[0].label || el.id) + ')';
        items[0].nodeId = node.id;
      }
    }
  }

  // 2) Узел с inline-composition (не из library)
  if (!items.length && Array.isArray(node.composition) && node.composition.length) {
    const synthetic = {
      id: 'node:' + node.id,
      label: (node.name || node.tag || node.type),
      kind: node.type,
      composition: node.composition,
    };
    items.push(...expandComposition(synthetic, count, 0, new Set(), []));
  }

  // 3) Fallback: Placeholder по типу узла
  if (!items.length) {
    items.push({
      elementId: null,
      label: node.name || node.tag || node.type || 'node',
      kind: node.type,
      qty: count,
      role: null,
      phantom: false,
      depth: 0,
      path: ['node:' + node.id],
      nodeId: node.id,
    });
  }

  // Дополнение: для ИБП с батареей из каталога — добавляем АКБ как
  // компонент (синтетическая composition-ссылка). Phantom=false потому
  // что АКБ — физический компонент, просто привязан к ИБП.
  const upsBatteryRef = _syntheticUpsComposition(node);
  if (upsBatteryRef) {
    const battery = getElement(upsBatteryRef.elementId);
    if (battery) {
      const sub = expandComposition(battery, upsBatteryRef.qty * count, 1, new Set(), ['node:' + node.id, 'battery']);
      if (sub[0]) {
        sub[0].role = 'battery';
        sub[0].phantom = false;
      }
      items.push(...sub);
    } else {
      items.push({
        elementId: upsBatteryRef.elementId,
        label: 'АКБ ' + upsBatteryRef.elementId,
        kind: 'battery',
        qty: upsBatteryRef.qty * count,
        role: 'battery',
        phantom: false,
        missing: true,
        depth: 1,
        path: ['node:' + node.id, 'battery'],
      });
    }
  }

  return items;
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
