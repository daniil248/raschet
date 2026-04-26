// ======================================================================
// shared/battery-seed.js
// Single source of truth для seed-данных каталога АКБ.
// Идемпотентно загружает встроенные записи (Kehua S³ модули + шкафы +
// аксессуары) в per-user localStorage.
//
// Раньше пользователи получали пустой каталог АКБ, пока не кликали
// «Загрузить Kehua S³» в управлении справочником. Это та же проблема
// «двух источников правды», которая была у UPS до v0.59.446.
//
// Теперь: ensureBuiltinBatterySeeds() вызывается из:
//   • battery/battery-calc.js (калькулятор АКБ)
//   • js/engine/index.js (главная схема — для инспектора ИБП)
// ======================================================================

import { listBatteries, addBattery } from '../battery/battery-catalog.js';
import { KEHUA_S3_BATTERIES } from './catalogs/battery-kehua-s3.js';

const KEY = 'raschet.batteryCatalog.kehua.seedVersion';
const CURRENT_VERSION = '1'; // v0.59.448: первый авто-seed

let _ranInThisTab = false;

export function ensureBuiltinBatterySeeds() {
  if (_ranInThisTab) return;
  _ranInThisTab = true;
  try {
    const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    if (stored === CURRENT_VERSION) return;
    const existing = new Set(listBatteries().map(b => b.id));
    let added = 0;
    // Идемпотентный режим: добавляем только отсутствующие. Не ломаем
    // правки пользователя в существующих записях. Если в будущем seed-данные
    // изменятся (новые версии модулей), бампнуть CURRENT_VERSION и переключить
    // на force-upsert по аналогии с ups-seed.
    for (const rec of KEHUA_S3_BATTERIES) {
      if (!existing.has(rec.id)) {
        addBattery({ ...rec, importedAt: Date.now() });
        added++;
      }
    }
    try { localStorage.setItem(KEY, CURRENT_VERSION); } catch {}
    if (added > 0) {
      console.info(`[battery-seed] Auto-imported ${added} Kehua S³ records (modules + cabinets + accessories)`);
    }
  } catch (e) { console.warn('[battery-seed]', e); }
}

ensureBuiltinBatterySeeds();
