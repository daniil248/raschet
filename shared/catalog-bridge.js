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

async function _loadUpses() {
  try {
    const m = await import('./ups-catalog.js');
    const list = m.listUpses ? m.listUpses() : (m.listUps ? m.listUps() : []);
    return list.map(fromUpsRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] ups', e.message); return []; }
}

async function _loadBatteries() {
  // battery-catalog.js может лежать либо в shared/, либо в battery/
  // Проверим оба варианта
  const candidates = ['./battery-catalog.js', '../battery/battery-catalog.js'];
  for (const path of candidates) {
    try {
      const m = await import(/* @vite-ignore */ path);
      const list = m.listBatteries ? m.listBatteries() : [];
      return list.map(fromBatteryRecord).filter(Boolean);
    } catch { /* try next */ }
  }
  return [];
}

async function _loadTransformers() {
  try {
    const m = await import('./transformer-catalog.js');
    const list = m.listTransformers ? m.listTransformers() : [];
    return list.map(fromTransformerRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] transformers', e.message); return []; }
}

async function _loadCableTypes() {
  try {
    const m = await import('./cable-types-catalog.js');
    const list = m.listCableTypes ? m.listCableTypes() : [];
    return list.map(fromCableTypeRecord).filter(Boolean);
  } catch (e) { console.warn('[catalog-bridge] cable-types', e.message); return []; }
}

/**
 * Синхронизирует все legacy-каталоги в element-library как builtins.
 * Вызывается при старте приложения (в engine/index.js и в подпрограммах).
 * Возвращает Promise<{ panels, ups, batteries, transformers, cableTypes, total }>
 */
export async function syncLegacyToLibrary() {
  const [panels, upses, batteries, transformers, cableTypes] = await Promise.all([
    _loadPanels(),
    _loadUpses(),
    _loadBatteries(),
    _loadTransformers(),
    _loadCableTypes(),
  ]);

  // Очистим предыдущие builtin (перерегистрируем актуальные)
  clearBuiltins();

  const all = [...panels, ...upses, ...batteries, ...transformers, ...cableTypes];
  registerBuiltins(all);

  return {
    panels: panels.length,
    ups: upses.length,
    batteries: batteries.length,
    transformers: transformers.length,
    cableTypes: cableTypes.length,
    total: all.length,
  };
}

/**
 * Дебаунс-обёртка над syncLegacyToLibrary: если несколько каталогов
 * меняются подряд (например импорт XLSX), делаем один sync по таймауту.
 */
let _syncTimer = null;
function _scheduleSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncLegacyToLibrary().catch(e => console.warn('[catalog-bridge] resync', e));
  }, 50);
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
    { path: './battery-catalog.js',       hook: 'onBatteriesChange' },
    { path: '../battery/battery-catalog.js', hook: 'onBatteriesChange' },
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
export function initCatalogBridge() {
  if (_initialized) return;
  _initialized = true;

  // Первая синхронизация
  syncLegacyToLibrary().then(stats => {
    console.info('[catalog-bridge] synced', stats);
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
