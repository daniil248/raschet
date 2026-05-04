// =============================================================================
// shared/catalogs/pdus.js — re-export shim
// =============================================================================
// v0.60.217 (по правилу feedback_use_catalogs.md и продолжая v0.60.214):
// каталог PDU разделён на per-vendor файлы в shared/catalogs/pdus/.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами вида `from 'shared/catalogs/pdus.js'`.

export {
  PDU_CATEGORY,
  PDU_CATALOG,
  listBuiltinPdus,
  getLivePduCatalog,
  pduBySku,
} from './pdus/index.js';
