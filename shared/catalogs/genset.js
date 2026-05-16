// =============================================================================
// shared/catalogs/genset.js — re-export shim
// =============================================================================
// v0.60.254 (по правилу feedback_use_catalogs.md и аналогично shim'у drups.js):
// каталог DGU разделён на per-vendor файлы в shared/catalogs/genset/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/genset.js'` (в частности catalog-bridge.js).

export {
  DGU_DATASHEETS,
  listDgus,
  listDguVendors,
  suggestDgu,
} from './genset/index.js';
