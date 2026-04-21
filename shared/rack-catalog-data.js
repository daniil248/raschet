// ======================================================================
// shared/rack-catalog-data.js
// Barrel-модуль: реэкспорт трёх отдельных каталогов. Существует ради
// обратной совместимости — старые импорты (rack-config, catalog-bridge,
// страница «Каталог») продолжают работать без правок.
//
// С v0.59.120 данные разнесены по типам/категориям:
//   • shared/racks-catalog-data.js              — базовые комплекты стоек
//   • shared/pdus-catalog-data.js               — PDU
//   • shared/rack-accessories-catalog-data.js   — аксессуары стойки
//   • shared/_catalog-helpers.js                — _syncList / _slug
//
// Новый код должен импортировать из конкретного файла (короче путь
// цепочки импортов, меньше зацеплений). Этот barrel можно удалить в
// будущем, когда все callers перейдут на прямые импорты.
// ======================================================================

export {
  DOOR_LABEL, TOP_LABEL, BASE_LABEL, ENTRY_LABEL, LOCK_LABEL,
  BLANK_LABEL, BLANK_U,
  KIT_CATALOG, kitById,
  listBuiltinRacks, getLiveKitCatalog,
} from './catalogs/racks.js';

export {
  PDU_CATEGORY, PDU_CATALOG, pduBySku,
  listBuiltinPdus, getLivePduCatalog,
} from './catalogs/pdus.js';

export {
  ACC_CATEGORIES, ACCESSORY_CATALOG, accBySku,
  accessoryMatchesRackMfg, accessoryMfgList,
  listBuiltinRackAccessories, getLiveAccessoryCatalog,
} from './catalogs/rack-accessories.js';
