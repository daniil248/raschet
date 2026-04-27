// ======================================================================
// shared/por-adapters.js — POR-backed реализации DataAdapter.
//
// Используется shared/project-bootstrap.js: при загрузке страницы в
// проектном режиме создаются POR-adapter'ы для каждого moduleId, и
// инжектируются через setAdapter('rack-config', ...).
//
// Конфигуратор сам этот файл НЕ импортирует. Он работает с DataAdapter
// контрактом и не знает, что под ним POR.
//
// Маппинг моделей DataAdapter ↔ POR:
//   adapter.list({type, ...}) → por.getObjects(pid, {type, ...})
//   adapter.get(id)           → por.getObject(pid, id)
//   adapter.add(partial)      → por.addObject(pid, partial)  ИЛИ
//                               por.createObject(pid, type, opts) — если
//                               adapter сконфигурён с фиксированным type
//   adapter.update(id, patch) → por.patchObject(pid, id, patch, opts?)
//   adapter.remove(id)        → por.removeObject(pid, id)
//   adapter.subscribe(cb)     → por.subscribe(pid, ...) с фильтром по type
// ======================================================================

import {
  getObjects, getObject, addObject, patchObject, removeObject, subscribe,
  createObject, getPorType,
} from './por.js';

/**
 * Создать POR-adapter для конкретного типа объектов в проекте.
 *
 * @param {string} pid  — id проекта (если null — берётся activeProjectId)
 * @param {string} type — POR-type ('rack', 'panel', …) которым ограничен adapter
 * @param {object} opts — опционально:
 *   { defaultDomain }  — для adapter.update/list, какой домен патча по умолчанию
 *
 * Возвращает DataAdapter.
 */
export function createPorAdapter(pid, type, opts) {
  const def = getPorType(type);
  const defaultDomain = (opts && opts.defaultDomain) || null;

  return {
    list(filter) {
      const f = { type, ...(filter || {}) };
      return getObjects(pid, f);
    },
    get(id) { return getObject(pid, id); },
    add(partial) {
      // Если partial.type не задан — подставляем фиксированный type adapter'а.
      // Если задан и не совпадает — предупреждение (но всё равно добавляем).
      if (!partial) return null;
      if (!partial.type) partial = { ...partial, type };
      else if (partial.type !== type) {
        console.warn(`[por-adapter:${type}] add: partial.type ${partial.type} !== adapter type ${type}`);
      }
      // Если есть type-definition и opts.useFactory=true — пропускаем через factory.
      if (def && opts && opts.useFactory) {
        return createObject(pid, type, partial);
      }
      return addObject(pid, partial);
    },
    update(id, patch, updateOpts) {
      // updateOpts.domain — если задан, патч идёт в domains[domain].
      // Иначе — top-level merge.
      const finalOpts = updateOpts || (defaultDomain ? { domain: defaultDomain } : undefined);
      return patchObject(pid, id, patch, finalOpts);
    },
    remove(id) { return removeObject(pid, id); },
    subscribe(cb) {
      // Фильтруем события по type — adapter консумеру не нужны чужие.
      return subscribe(pid, (e) => {
        const obj = e.object || e.before || e.after;
        if (e.kind === 'sync') return cb(e); // sync без фильтрации
        if (obj && obj.type === type) cb(e);
      });
    },
  };
}

/**
 * Создать POR-adapter с фильтром по domain — например для SCS-инженера,
 * которому нужны ВСЕ объекты с domain.scs (стойки, патч-панели, jacks),
 * независимо от type.
 */
export function createPorDomainAdapter(pid, domain) {
  return {
    list(filter) { return getObjects(pid, { ...(filter || {}), domain }); },
    get(id) {
      const o = getObject(pid, id);
      return (o && o.domains && o.domains[domain]) ? o : null;
    },
    add(partial) {
      // Гарантируем что у объекта будет указанный domain.
      const p = { ...(partial || {}) };
      if (!p.type) {
        console.warn(`[por-domain-adapter:${domain}] add: partial.type required`);
        return null;
      }
      if (!p.domains) p.domains = {};
      if (!p.domains[domain]) p.domains[domain] = {};
      return addObject(pid, p);
    },
    update(id, patch, opts) {
      const finalOpts = opts || { domain };
      return patchObject(pid, id, patch, finalOpts);
    },
    remove(id) { return removeObject(pid, id); },
    subscribe(cb) {
      return subscribe(pid, (e) => {
        const obj = e.object || e.before || e.after;
        if (e.kind === 'sync') return cb(e);
        if (obj && obj.domains && obj.domains[domain]) cb(e);
      });
    },
  };
}
