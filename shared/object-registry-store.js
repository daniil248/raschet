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
import { objectPorts, disciplineSlice } from './object-registry.js';

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

/**
 * Нормализованные порты объекта реестра (тонкий ре-экспорт чистого
 * аксессора — потребителям store достаточно одного импорта).
 */
export { objectPorts };
