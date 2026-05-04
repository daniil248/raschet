// =============================================================================
// shared/catalogs/rack-accessories.js — re-export shim
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md и продолжая v0.60.214):
// каталог аксессуаров стоек разделён на per-vendor файлы в
// shared/catalogs/rack-accessories/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/rack-accessories.js'`.

export {
  ACC_CATEGORIES,
  ACCESSORY_CATALOG,
  listBuiltinRackAccessories,
  getLiveAccessoryCatalog,
  accBySku,
  accessoryMatchesRackMfg,
  accessoryMfgList,
} from './rack-accessories/index.js';
