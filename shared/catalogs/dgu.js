// =============================================================================
// shared/catalogs/dgu.js — re-export shim
// =============================================================================
// v0.60.254 (по правилу feedback_use_catalogs.md и аналогично shim'у drups.js):
// каталог DGU разделён на per-vendor файлы в shared/catalogs/dgu/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/dgu.js'` (в частности catalog-bridge.js).

export {
  DGU_DATASHEETS,
  listDgus,
  listDguVendors,
  suggestDgu,
} from './dgu/index.js';
