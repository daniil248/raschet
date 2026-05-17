// ======================================================================
// shared/catalog-bridge.js
// Мост между legacy каталогами (panel-catalog, ups-catalog, battery-*,
// transformer-catalog, cable-types-catalog) и единой element-library.
//
// При загрузке вызывает syncLegacyToLibrary() — читает все записи из
// старых каталогов, конвертирует в Element через *-schemas и
// регистрирует через registerBuiltins() из element-library.
//
// Это read-only синхронизация: редактирование продолжает идти через
// legacy API (addPanel, addUps, …) до Фазы 1.2.n когда API унифицируется
// окончательно. Новые подпрограммы (elements editor, BOM) уже могут
// работать через listElements() и видят все данные из legacy-каталогов.
// ======================================================================

import { registerBuiltins, clearBuiltins } from './element-library.js';
import {
  fromPanelRecord,
  fromUpsRecord,
  fromBatteryRecord,
  fromTransformerRecord,
  fromCableTypeRecord,
} from './element-schemas.js';

// Ленивая загрузка адаптеров — модули подгружаются по требованию
// (чтобы подпрограммы не тянули всё, что не нужно).

async function _loadPanels() {
  try {
    const m = await import('./panel-catalog.js');
    const list = m.listPanels ? m.listPanels() : [];
    return list.map(fromPanelRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] panels', e.message); return []; }
}

// Breaker-seed (Фаза 1.10): базовые MCB + MCCB, зарегистрированы как builtin.
// Без legacy-каталога — сразу из breaker-seed.js.
async function _loadBreakers() {
  try {
    const m = await import('./catalogs/breakers.js');
    return m.listBuiltinBreakers ? m.listBuiltinBreakers() : [];
  } catch (e) { console.warn('[catalog-bridge] breakers', e.message); return []; }
}

// MV-switchgear-seed (Фаза 1.19): RM6, SafeRing, ЩО-70.
async function _loadMvSwitchgear() {
  try {
    const m = await import('./mv-switchgear-seed.js');
    return m.listBuiltinMvSwitchgear ? m.listBuiltinMvSwitchgear() : [];
  } catch (e) { console.warn('[catalog-bridge] mv-switchgear', e.message); return []; }
}

async function _loadUpses() {
  try {
    const m = await import('./ups-catalog.js');
    const list = m.listUpses ? m.listUpses() : (m.listUps ? m.listUps() : []);
    return list.map(fromUpsRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] ups', e.message); return []; }
}

async function _loadBatteries() {
  // v0.59.871: battery-catalog.js физически живёт в /battery/ — раньше
  // первым кандидатом был './battery-catalog.js' (shared/), который дал
  // постоянный 404 в консоли. Убрали несуществующий путь.
  try {
    const m = await import('../apps/battery/battery-catalog.js');
    const list = m.listBatteries ? m.listBatteries() : [];
    return list.map(fromBatteryRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] batteries', e.message); return []; }
}

async function _loadTransformers() {
  try {
    const m = await import('./transformer-catalog.js');
    const list = m.listTransformers ? m.listTransformers() : [];
    return list.map(fromTransformerRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] transformers', e.message); return []; }
}

// Rack / PDU / rack-accessory seeds (shared/rack-catalog-data.js).
// Данные — централизованные; рендер в rack-config и будущий pdu-config
// читают их через listElements({kind:'rack'|'pdu'|'rack-accessory'}).
async function _loadRackCatalogData() {
  try {
    const m = await import('./rack-catalog-data.js');
    const racks = m.listBuiltinRacks ? m.listBuiltinRacks() : [];
    const pdus  = m.listBuiltinPdus ? m.listBuiltinPdus() : [];
    const accs  = m.listBuiltinRackAccessories ? m.listBuiltinRackAccessories() : [];
    return [...racks, ...pdus, ...accs];
  } catch (e) { console.warn('[catalog-bridge] rack-catalog-data', e.message); return []; }
}

async function _loadCableTypes() {
  try {
    const m = await import('./cable-types-catalog.js');
    const list = m.listCableTypes ? m.listCableTypes() : [];
    return list.map(fromCableTypeRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] cable-types', e.message); return []; }
}

// v0.60.71 (Phase 25.6): cooling datasheets как builtin-элементы.
// По требованию Пользователя 2026-05-03 «в каком каталоге у нас кондиционеры?».
// Все datasheets из cooling/datasheets/index.js (Daikin/York/Carrier/Trane/Stulz/
// Vertiv/Generic/Kehua) регистрируются в element-library с kind='climate'.
async function _loadCoolingDatasheets() {
  try {
    const m = await import('cooling/datasheets/index.js');
    return m.listBuiltinCoolingElements ? m.listBuiltinCoolingElements() : [];
  } catch (e) { console.warn('[catalog-bridge] cooling-datasheets', e.message); return []; }
}

// v0.60.71 (Phase 30.3 cont.): DGU datasheets как builtin (ДГУ — kind='dgu').
async function _loadDguDatasheets() {
  try {
    // v0.60.92: каталог переехал в shared/catalogs/genset.js (ранее dgu.js)
    const m = await import('./catalogs/genset.js');
    if (!m.DGU_DATASHEETS) return [];
    return m.DGU_DATASHEETS.map(d => {
      // v0.60.72: series = product-line (C18/C32/3516/QSL9/TAD941GE/P200H).
      // v0.60.74 (запрос «вариант — С АВР или без, таких немного»): variant =
      // bucket по nameplate kW (~4 значения), а не SKU/трим-код.
      const modelClean = String(d.model || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const sp = modelClean.indexOf(' ');
      const seriesParsed = sp > 0 ? modelClean.slice(0, sp) : modelClean;
      const kw = Number(d.nameplateKw) || 0;
      const variantBucket = kw < 250 ? 'до 250 кВт'
        : kw < 500 ? '250–500 кВт'
        : kw < 1000 ? '500–1000 кВт'
        : '> 1000 кВт';
      return {
        id: `dgu-${d.vendor}-${d.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        kind: 'dgu',
        subKind: 'Дизель',           // v0.60.77: только дизель пока в каталоге
        category: 'equipment',
        label: `${d.vendor} ${d.model}`,
        manufacturer: d.vendor,
        series: seriesParsed,        // C18, C32, 3516, QSL9-G7, TAD941GE и т.п.
        variant: variantBucket,      // до 250 / 250-500 / 500-1000 / >1000 кВт
        powerKw: d.nameplateKw,
        notes: d.notes || '',
        tags: ['dgu', d.fuelType, d.engineModel].filter(Boolean),
        physical: d.physical || {},
        dgu: {
          nameplateKw: d.nameplateKw, espKw: d.espKw, prpKw: d.prpKw, copKw: d.copKw,
          voltage: d.voltage, phase: d.phase, freq: d.freq, rpm: d.rpm,
          engineModel: d.engineModel, cylinders: d.cylinders, displacement: d.displacement,
          fuelType: d.fuelType, sfcLkWh: d.sfcLkWh,
        },
      };
    });
  } catch (e) { console.warn('[catalog-bridge] dgu-datasheets', e.message); return []; }
}

// v0.60.92 (Пользователь 2026-05-03): DRUPS (Diesel Rotary UPS) — Hitec /
// Piller / Euro-Diesel. Отдельный kind 'drups' (НЕ дгу, НЕ ИБП — гибрид).
async function _loadDrupsDatasheets() {
  try {
    const m = await import('./catalogs/drups.js');
    if (!m.DRUPS_DATASHEETS) return [];
    return m.DRUPS_DATASHEETS.map(d => {
      const modelClean = String(d.model || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const sp = modelClean.indexOf(' ');
      const seriesParsed = sp > 0 ? modelClean.slice(0, sp) : modelClean;
      const kva = Number(d.nameplateKva) || 0;
      const variantBucket = kva < 500 ? 'до 500 кВА'
        : kva < 1500 ? '500–1500 кВА'
        : kva < 2500 ? '1500–2500 кВА'
        : '> 2500 кВА';
      return {
        id: `drups-${d.vendor}-${d.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        kind: 'drups',
        subKind: 'Diesel Rotary UPS',
        category: 'equipment',
        label: `${d.vendor} ${d.model}`,
        manufacturer: d.vendor,
        series: seriesParsed,
        variant: variantBucket,
        powerKw: d.nameplateKw,
        notes: d.notes || '',
        tags: ['drups', 'rotary-ups', d.flywheelType, d.engineModel].filter(Boolean),
        physical: d.physical || {},
        drups: {
          nameplateKva: d.nameplateKva, nameplateKw: d.nameplateKw,
          voltage: d.voltage, phase: d.phase, freq: d.freq,
          flywheelType: d.flywheelType, autonomySec: d.autonomySec,
          engineModel: d.engineModel, dieselKw: d.dieselKw, sfcLkWh: d.sfcLkWh,
          efficiency: d.efficiency,
        },
      };
    });
  } catch (e) { console.warn('[catalog-bridge] drups-datasheets', e.message); return []; }
}

/**
 * Синхронизирует все legacy-каталоги в element-library как builtins.
 * Вызывается при старте приложения (в engine/index.js и в подпрограммах).
 * Возвращает Promise<{ panels, ups, batteries, transformers, cableTypes, total }>
 */
export async function syncLegacyToLibrary() {
  const [panels, upses, batteries, transformers, cableTypes, breakers, mvSw, rackData, coolingDs, dguDs, drupsDs] = await Promise.all([
    _loadPanels(),
    _loadUpses(),
    _loadBatteries(),
    _loadTransformers(),
    _loadCableTypes(),
    _loadBreakers(),
    _loadMvSwitchgear(),
    _loadRackCatalogData(),
    _loadCoolingDatasheets(),
    _loadDguDatasheets(),
    _loadDrupsDatasheets(),  // v0.60.92
  ]);

  // Очистим предыдущие builtin (перерегистрируем актуальные)
  clearBuiltins();

  const all = [...panels, ...upses, ...batteries, ...transformers, ...cableTypes, ...breakers, ...mvSw, ...rackData, ...coolingDs, ...dguDs, ...drupsDs];
  registerBuiltins(all);

  const racks = rackData.filter(e => e.kind === 'rack').length;
  const pdus  = rackData.filter(e => e.kind === 'pdu').length;
  const rackAcc = rackData.filter(e => e.kind === 'rack-accessory').length;

  return {
    panels: panels.length,
    ups: upses.length,
    batteries: batteries.length,
    transformers: transformers.length,
    cableTypes: cableTypes.length,
    breakers: breakers.length,
    mvSwitchgear: mvSw.length,
    racks, pdus, rackAccessories: rackAcc,
    cooling: coolingDs.length,    // v0.60.71
    dgu: dguDs.length,            // v0.60.71
    total: all.length,
  };
}

/**
 * Дебаунс-обёртка над syncLegacyToLibrary: если несколько каталогов
 * меняются подряд (например импорт XLSX), делаем один sync по таймауту.
 *
 * Дополнительная защита: если sync уже идёт (_syncInFlight), не запускаем
 * второй параллельно — дожидаемся завершения и ставим pending флаг для
 * повторного запуска.
 */
let _syncTimer = null;
let _syncInFlight = false;
let _syncPending = false;
function _scheduleSync() {
  if (_syncInFlight) { _syncPending = true; return; }
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    _syncTimer = null;
    _syncInFlight = true;
    try {
      const stats = await syncLegacyToLibrary();
      // Лог только когда total реально изменился — не захламляем console
      if (stats.total !== _lastSyncTotal) {
        console.info('[catalog-bridge] resync', stats);
        _lastSyncTotal = stats.total;
      }
    } catch (e) {
      console.warn('[catalog-bridge] resync', e);
    } finally {
      _syncInFlight = false;
      if (_syncPending) {
        _syncPending = false;
        _scheduleSync(); // запускаем если что-то пришло во время выполнения
      }
    }
  }, 150); // увеличено с 50 до 150 мс — батчит storage events от разных вкладок
}

/**
 * Подписка на same-tab изменения legacy-каталогов (onPanelsChange,
 * onUpsesChange и т.п.). Каждый каталог экспортирует свой listener —
 * если экспорт отсутствует (модуль не загружался), подписка молча
 * пропускается.
 */
async function _subscribeSameTab() {
  const sources = [
    { path: './panel-catalog.js',         hook: 'onPanelsChange' },
    { path: './ups-catalog.js',           hook: 'onUpsesChange' },
    // v0.59.871: убрали несуществующий './battery-catalog.js' — давал 404.
    { path: '../apps/battery/battery-catalog.js', hook: 'onBatteriesChange' },
    { path: './transformer-catalog.js',   hook: 'onTransformersChange' },
    { path: './cable-types-catalog.js',   hook: 'onCableTypesChange' },
  ];
  for (const { path, hook } of sources) {
    try {
      const m = await import(/* @vite-ignore */ path);
      if (typeof m[hook] === 'function') m[hook](_scheduleSync);
    } catch { /* модуль не грузится — игнорируем */ }
  }
}

/**
 * Инициализация bridge — вызывается один раз на страницу.
 * - Первая синхронизация legacy → element-library
 * - Подписка на same-tab изменения (через onXChange каждого каталога)
 * - Подписка на cross-tab изменения (через storage event)
 */
let _initialized = false;
let _lastSyncTotal = -1;
export function initCatalogBridge() {
  if (_initialized) return;
  _initialized = true;

  // Первая синхронизация — лог только первый раз
  syncLegacyToLibrary().then(stats => {
    _lastSyncTotal = stats.total;
    console.info('[catalog-bridge] init sync', stats);
  }).catch(e => {
    console.warn('[catalog-bridge] init failed', e);
  });

  // Same-tab sync: подписываемся на listener каждого каталога
  _subscribeSameTab();

  // Cross-tab sync: следим за изменениями в localStorage других вкладок
  try {
    window.addEventListener('storage', (ev) => {
      if (!ev.key) return;
      if (ev.key.startsWith('raschet.panelCatalog') ||
          ev.key.startsWith('raschet.upsCatalog') ||
          ev.key.startsWith('raschet.batteryCatalog') ||
          ev.key.startsWith('raschet.transformerCatalog') ||
          ev.key.startsWith('raschet.cableTypesCatalog')) {
        _scheduleSync();
      }
    });
  } catch { /* no window */ }
}
