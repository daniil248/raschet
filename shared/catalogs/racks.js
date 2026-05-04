// =============================================================================
// shared/catalogs/racks.js — re-export shim
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md и продолжая v0.60.214):
// каталог стоек разделён на per-vendor файлы в shared/catalogs/racks/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/racks.js'`.

export {
  KIT_CATALOG,
  DOOR_LABEL, TOP_LABEL, BASE_LABEL, ENTRY_LABEL, LOCK_LABEL,
  BLANK_LABEL, BLANK_U,
  listBuiltinRacks,
  getLiveKitCatalog,
  kitById,
} from './racks/index.js';
