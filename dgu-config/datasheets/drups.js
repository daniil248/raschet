// =============================================================================
// dgu-config/datasheets/drups.js — re-export shim
// =============================================================================
// v0.60.92: каталог DRUPS перенесён в shared/catalogs/drups.js по правилу
// feedback_use_catalogs.md. Этот файл — лишь re-export для backward-compat.

export {
  DRUPS_DATASHEETS,
  listDrups,
  listDrupsVendors,
  suggestDrups,
} from '../../shared/catalogs/drups.js';
