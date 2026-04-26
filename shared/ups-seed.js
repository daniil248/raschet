// ======================================================================
// shared/ups-seed.js
// Единый источник правды (single source of truth) для seed-данных ИБП.
// Идемпотентно загружает встроенные каталоги в per-user localStorage,
// чтобы все подпрограммы (главная схема, калькулятор АКБ, ups-config)
// видели один и тот же набор моделей.
//
// Раньше проблема: KEHUA_MR33 авто-импортировался в engine/index.js,
// а KEHUA_S3_AIO + сторонние производители — только по ручной кнопке
// в ups-config. На главной странице/в battery-calc подгружался только
// MR33. Пользователь видел только Kehua и считал это «двумя источниками».
//
// Теперь: ensureBuiltinUpsSeeds() вызывается ИЗ КАЖДОЙ ТОЧКИ ВХОДА:
//   • js/engine/index.js (главная схема)
//   • battery/battery-calc.js (калькулятор АКБ)
//   • ups-config/ups-config.js (конструктор ИБП)
// версия seed бампится при добавлении новых seed-записей.
// ======================================================================

import { listUpses, addUps } from './ups-catalog.js';
import { KEHUA_MR33_UPSES } from './catalogs/ups-kehua-mr33.js';
import { KEHUA_S3_AIO_UPSES } from './catalogs/ups-kehua-s3-aio.js';
import { SCHNEIDER_UPSES } from './catalogs/ups-schneider.js';
import { EATON_UPSES } from './catalogs/ups-eaton.js';
import { LEGRAND_UPSES } from './catalogs/ups-legrand.js';
import { DKC_UPSES } from './catalogs/ups-dkc.js';

const KEY = 'raschet.upsCatalog.kehua.seedVersion';
const CURRENT_VERSION = '6'; // v0.59.447: kind:'ups' (вместо 'ups-integrated') у Schneider/Eaton/Legrand/DKC

export const ALL_UPS_SEEDS = [
  ...KEHUA_MR33_UPSES,
  ...KEHUA_S3_AIO_UPSES,
  ...SCHNEIDER_UPSES,
  ...EATON_UPSES,
  ...LEGRAND_UPSES,
  ...DKC_UPSES,
];

let _ranInThisTab = false;

export function ensureBuiltinUpsSeeds() {
  if (_ranInThisTab) return;
  _ranInThisTab = true;
  try {
    const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    if (stored === CURRENT_VERSION) return;
    const existing = new Set(listUpses().map(u => u.id));
    let added = 0, updated = 0;
    // v0.59.447: при bump версии — force-upsert ВСЕХ seed-записей. Раньше
    // делали `if (!existing.has)` → не было способа исправить ошибку в
    // seed-данных (например, поменять kind c 'ups-integrated' на 'ups').
    // Это безопасно, т.к. seed-записи имеют custom:false; пользовательские
    // имеют другие id (custom:true) и не пересекаются.
    for (const rec of ALL_UPS_SEEDS) {
      addUps({ ...rec, importedAt: Date.now() });
      if (existing.has(rec.id)) updated++; else added++;
    }
    try { localStorage.setItem(KEY, CURRENT_VERSION); } catch {}
    if (added > 0 || updated > 0) {
      console.info(`[ups-seed] +${added} new, ${updated} updated (Kehua MR33/S³ AIO + Schneider + Eaton + Legrand + DKC)`);
    }
  } catch (e) { console.warn('[ups-seed]', e); }
}

// Авто-вызов при импорте — гарантия что каталог инициализирован.
ensureBuiltinUpsSeeds();
