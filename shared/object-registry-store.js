/* =========================================================================
   shared/object-registry-store.js — персистентность общего реестра
   объектов через project-storage шов (Ф-E интеграция, X.4.5.3 §6).
   -------------------------------------------------------------------------
   Отделено от чистого контракта shared/object-registry.js (тот без
   импортов/LS — остаётся 0-consumers cache-safe). Здесь — связка с
   project-storage швом: НОВЫЙ project-scoped namespace
   `raschet.project.<pid>.object-registry.objects.v1`. Аддитивно: НЕ
   мутирует существующие данные (rack-config/tech-workspace/scs-* не
   затрагиваются — деривация из них = СЛЕДУЮЩИЙ инкремент Ф-E). НЕТ
   авто-записи (memory:user-params-sacred): пишем только по явному
   upsert/remove. 0 потребителей на этом шаге (cache-safe,
   memory:cache_safe_exports) — wiring в tech-workspace/rack-merge
   будущими защищёнными инкрементами.
   ========================================================================= */

import { projectLoad, projectSave } from './project-storage.js';
import { objectPorts, disciplineSlice, aggregateRegistry } from './object-registry.js';

/** Модуль-namespace и ключ реестра в project-storage шве. */
export const REGISTRY_MODULE = 'object-registry';
export const REGISTRY_KEY = 'objects.v1';

/**
 * Загрузить per-project реестр объектов. Всегда массив (отсутствие ≠
 * ошибка). Чистое чтение — проект не мутируется.
 * @param {string} pid id проекта
 * @returns {import('./object-registry.js').RegistryObject[]}
 */
export function loadRegistry(pid) {
  const arr = projectLoad(pid, REGISTRY_MODULE, REGISTRY_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

/**
 * Сохранить реестр (полная замена списка). Вызывается ТОЛЬКО по явному
 * действию (не авто). projectSave бампит updatedAt проекта.
 * @param {string} pid
 * @param {import('./object-registry.js').RegistryObject[]} list
 */
export function saveRegistry(pid, list) {
  projectSave(pid, REGISTRY_MODULE, REGISTRY_KEY,
    Array.isArray(list) ? list : []);
}

/**
 * Upsert одного объекта по id (явная правка). Существующий —
 * обновляется (merge верхнего уровня + аккуратный merge
 * disciplineAttrs: чужие срезы НЕ затираются, обновляется только
 * переданный, memory:user-params-sacred); новый — добавляется.
 * @returns {import('./object-registry.js').RegistryObject[]} новый список
 */
export function upsertObject(pid, obj) {
  if (!obj || typeof obj.id !== 'string' || !obj.id) return loadRegistry(pid);
  const list = loadRegistry(pid);
  const i = list.findIndex(o => o && o.id === obj.id);
  if (i < 0) {
    list.push(obj);
  } else {
    const prev = list[i];
    list[i] = {
      ...prev,
      ...obj,
      // disciplineAttrs: объединяем срезы, не теряя чужие дисциплины.
      disciplineAttrs: {
        ...(prev && prev.disciplineAttrs),
        ...(obj && obj.disciplineAttrs),
      },
    };
  }
  saveRegistry(pid, list);
  return list;
}

/**
 * Удалить объект по id (явное действие). Возвращает новый список.
 * @returns {import('./object-registry.js').RegistryObject[]}
 */
export function removeObject(pid, id) {
  const list = loadRegistry(pid).filter(o => !(o && o.id === id));
  saveRegistry(pid, list);
  return list;
}

/**
 * Записать/обновить дисциплинарный срез объекта НЕ затрагивая чужие
 * (электрик правит только electrical-срез и т.п., §6). Если объекта
 * нет — no-op (возвращает текущий список; создание объекта — явный
 * upsertObject, не побочный эффект записи среза).
 * @param {string} pid
 * @param {string} objectId
 * @param {string} disciplineId  id из shared/disciplines.js
 * @param {object} slice         атрибуты этой дисциплины
 * @returns {import('./object-registry.js').RegistryObject[]}
 */
export function writeDisciplineSlice(pid, objectId, disciplineId, slice) {
  const list = loadRegistry(pid);
  const i = list.findIndex(o => o && o.id === objectId);
  if (i < 0) return list; // объект не создан — не плодим побочно
  const prev = list[i];
  list[i] = {
    ...prev,
    disciplineAttrs: {
      ...(prev && prev.disciplineAttrs),
      [disciplineId]: { ...disciplineSlice(prev, disciplineId), ...slice },
    },
  };
  saveRegistry(pid, list);
  return list;
}

/* -------------------------------------------------------------------------
   Ф-E деривация (read-only проекция). Строит RegistryObject[] из УЖЕ
   существующих данных модулей (rack-config/scs-config/scs-design)
   через project-storage шов. ЧИСТОЕ ЧТЕНИЕ: не пишет реестр, не
   мутирует источники, не бампит updatedAt. Назначение — дать §6
   порт-driven видимость на реальных данных БЕЗ ручного наполнения
   реестра. Источники остаются владельцами своих данных (§5/§6);
   деривация — координационный снимок. 0 потребителей (cache-safe).
   ------------------------------------------------------------------------- */

/** Тег стойки из scs-config.rackTags.v1 (map rackId→tag | массив). */
function _rackTag(tags, rackId) {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    const e = tags.find(t => t && (t.id === rackId || t.rackId === rackId));
    return e ? (e.tag || e.label || null) : null;
  }
  if (typeof tags === 'object') {
    const v = tags[rackId];
    return typeof v === 'string' ? v : (v && (v.tag || v.label)) || null;
  }
  return null;
}

/**
 * Read-only проекция: единый реестр объектов из существующих данных
 * проекта. Стойки берутся из rack-config.instances.v1; порт-driven
 * видимость инферится: power-порт если есть PDU/нагрузка (→ электрика),
 * data-порт если стойка несёт СКС-устройства/связи (→ СКС). НИЧЕГО НЕ
 * ПИШЕТ. Для пустого проекта — [].
 * @param {string} pid
 * @returns {import('./object-registry.js').RegistryObject[]}
 */
export function deriveRegistry(pid) {
  if (!pid) return [];
  const racks = projectLoad(pid, 'rack-config', 'instances.v1', []);
  if (!Array.isArray(racks) || !racks.length) return [];
  const tags = projectLoad(pid, 'scs-config', 'rackTags.v1', {});
  const contents = projectLoad(pid, 'scs-config', 'contents.v1', {});
  const links = projectLoad(pid, 'scs-design', 'links.v1', []);

  // Множество rackId, участвующих в СКС (есть устройства ИЛИ связи).
  const scsRacks = new Set();
  if (contents && typeof contents === 'object') {
    for (const rid of Object.keys(contents)) {
      const arr = contents[rid];
      if (Array.isArray(arr) && arr.length) scsRacks.add(rid);
    }
  }
  if (Array.isArray(links)) {
    for (const l of links) {
      if (!l) continue;
      if (l.fromRackId) scsRacks.add(l.fromRackId);
      if (l.toRackId) scsRacks.add(l.toRackId);
    }
  }

  const out = [];
  for (const r of racks) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const ports = [];
    const hasPower = (Array.isArray(r.pdus) && r.pdus.length)
      || (typeof r.demandKw === 'number' && r.demandKw > 0);
    if (hasPower) ports.push({ id: 'pwr', type: 'power', label: 'Электропитание' });
    if (scsRacks.has(r.id)) ports.push({ id: 'data', type: 'data', label: 'СКС / слаботочка' });

    const electrical = {};
    if (typeof r.demandKw === 'number') electrical.demandKw = r.demandKw;
    if (typeof r.cosphi === 'number') electrical.cosphi = r.cosphi;
    if (r.pduRedundancy) electrical.pduRedundancy = r.pduRedundancy;
    const mechanical = {};
    if (typeof r.u === 'number') mechanical.u = r.u;
    if (typeof r.width === 'number') mechanical.widthMm = r.width;
    if (typeof r.depth === 'number') mechanical.depthMm = r.depth;

    const disciplineAttrs = {};
    if (Object.keys(electrical).length) disciplineAttrs.electrical = electrical;
    if (Object.keys(mechanical).length) disciplineAttrs.mechanical = mechanical;

    out.push({
      id: r.id,
      kind: 'rack',
      tag: _rackTag(tags, r.id) || r.name || null,
      ownerModule: 'rack-config',
      ports,
      disciplineAttrs,
    });
  }
  return out;
}

/**
 * Нормализованные порты объекта реестра (тонкий ре-экспорт чистого
 * аксессора — потребителям store достаточно одного импорта).
 */
export { objectPorts, aggregateRegistry };
