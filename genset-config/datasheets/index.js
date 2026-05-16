// =============================================================================
// genset-config/datasheets/index.js — re-export shim
// =============================================================================
// v0.60.92 (по правилу feedback_use_catalogs.md и запросу Пользователя
// 2026-05-03 «может все таки даташиты будут в каталоге соответствующем»):
// каталог ДГУ перенесён в shared/catalogs/genset.js — единое место для
// всех справочных данных платформы.
//
// Этот файл — лишь re-export для обратной совместимости с существующими
// импортами из genset-config/genset-config.js и других модулей.

export {
  DGU_DATASHEETS,
  listDgus,
  listDguVendors,
  suggestDgu,
} from '../../shared/catalogs/genset/index.js';
