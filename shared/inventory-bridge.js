// =========================================================================
// shared/inventory-bridge.js — v0.59.351
//
// Связь объектов схемы с реестрами проекта. Узел в Конструкторе схем имеет
// поля assetId (инв.№) и serialNo (S/N) — это удобный «человеческий» якорь.
// Здесь — функции автоматического матчинга с реестром IT-оборудования
// (scs-config contents.v1) и реестром объекта (facility-inventory.v1).
//
// Пока используется автоматический матчинг по serialNo / assetId — никаких
// явных inventoryRef-полей на узле не требуется. Если найдено совпадение,
// инспектор показывает чип «✓ в реестре IT, стойка DH1.SR2».
// =========================================================================

import { projectKey } from './project-storage.js';

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

/**
 * Найти устройство в реестре IT (scs-config contents.v1) по S/N или assetId.
 * @param {string} pid — id проекта
 * @param {string} sn — серийный номер (опц.)
 * @param {string} assetId — инв. № (опц.)
 * @returns {{ device, rackId, rackTag } | null}
 */
export function findItDeviceByIdentifiers(pid, sn, assetId) {
  if (!pid || (!sn && !assetId)) return null;
  const contents = loadJson(projectKey(pid, 'scs-config', 'contents.v1'), {}) || {};
  const tags = loadJson(projectKey(pid, 'scs-config', 'rackTags.v1'), {}) || {};
  const snTrim = (sn || '').trim();
  const aTrim = (assetId || '').trim();
  for (const [rackId, devs] of Object.entries(contents)) {
    if (!Array.isArray(devs)) continue;
    for (const d of devs) {
      if (!d) continue;
      const matchSn = snTrim && (d.sn || '').trim() === snTrim;
      const matchAsset = aTrim && (d.assetId || d.address || '').trim() === aTrim;
      if (matchSn || matchAsset) {
        return { device: d, rackId, rackTag: (tags[rackId] || '').trim() || null };
      }
    }
  }
  return null;
}

/**
 * Найти позицию в реестре оборудования объекта (facility-inventory.v1) по
 * S/N или инв. №. Реестр объекта пока — массив объектов с полями {id, name,
 * sn, assetId, ...}. Схема не финализирована, поэтому матчинг толерантен.
 * @returns {{ item } | null}
 */
export function findFacilityItemByIdentifiers(pid, sn, assetId) {
  if (!pid || (!sn && !assetId)) return null;
  const raw = loadJson(projectKey(pid, 'facility-inventory', 'v1'), null);
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  if (!items.length) return null;
  const snTrim = (sn || '').trim();
  const aTrim = (assetId || '').trim();
  for (const it of items) {
    if (!it) continue;
    const matchSn = snTrim && (it.sn || it.serialNo || '').trim() === snTrim;
    const matchAsset = aTrim && (it.assetId || it.invNo || '').trim() === aTrim;
    if (matchSn || matchAsset) return { item: it };
  }
  return null;
}

/**
 * Список всех IT-устройств проекта (плоский, для picker'а).
 * @returns {Array<{ device, rackId, rackTag, label, sn, assetId }>}
 */
export function listAllItDevices(pid) {
  if (!pid) return [];
  const contents = loadJson(projectKey(pid, 'scs-config', 'contents.v1'), {}) || {};
  const tags = loadJson(projectKey(pid, 'scs-config', 'rackTags.v1'), {}) || {};
  const out = [];
  for (const [rackId, devs] of Object.entries(contents)) {
    if (!Array.isArray(devs)) continue;
    const rackTag = (tags[rackId] || '').trim();
    for (const d of devs) {
      if (!d) continue;
      out.push({
        device: d,
        rackId,
        rackTag: rackTag || null,
        label: (d.label || d.name || d.model || d.kind || '?'),
        sn: (d.sn || '').trim(),
        assetId: (d.assetId || d.address || '').trim(),
      });
    }
  }
  return out;
}

/**
 * Список всех позиций реестра объекта.
 */
export function listAllFacilityItems(pid) {
  if (!pid) return [];
  const raw = loadJson(projectKey(pid, 'facility-inventory', 'v1'), null);
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  return items.map(it => ({
    item: it,
    label: (it && (it.name || it.label || it.model)) || '?',
    sn: ((it && (it.sn || it.serialNo)) || '').trim(),
    assetId: ((it && (it.assetId || it.invNo)) || '').trim(),
  }));
}

/**
 * Полный поиск по обоим реестрам. Возвращает первый найденный матч.
 */
export function findInventoryMatch(pid, sn, assetId) {
  const it = findItDeviceByIdentifiers(pid, sn, assetId);
  if (it) return { kind: 'it', ...it };
  const fac = findFacilityItemByIdentifiers(pid, sn, assetId);
  if (fac) return { kind: 'facility', ...fac };
  return null;
}
