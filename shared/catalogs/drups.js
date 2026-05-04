// =============================================================================
// shared/catalogs/drups.js — re-export shim
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md и продолжая v0.60.214):
// каталог DRUPS разделён на per-vendor файлы в shared/catalogs/drups/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/drups.js'`.

export {
  DRUPS_DATASHEETS,
  listDrups,
  listDrupsVendors,
  suggestDrups,
} from './drups/index.js';
