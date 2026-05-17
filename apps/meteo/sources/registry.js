// meteo/sources/registry.js
// Реестр плагинов-источников метеоданных. Любой новый источник =
// отдельный файл в meteo/sources/, который вызывает register(source).
//
// Plugin shape:
//   {
//     id: 'open-meteo' | 'rp5' | ...,    // уникальный
//     label: '🌐 Open-Meteo REST',       // для кнопки в UI
//     description: '...',                // tooltip / подзаголовок
//     async createDataset(ctx) → dataset | null
//   }
// ctx = { util: { computeStats, modalOpen, toast, readFileAsText, newId, escHtml } }
//
// Возвращаемый dataset должен иметь shape:
//   { name, source, lat, lon, locationName, dateFrom, dateTo, hourly, stats }
// id и activeForProject/createdAt подставляются ядром автоматически.

const _sources = new Map();

export function register(plugin) {
  if (!plugin || !plugin.id) throw new Error('[meteo/registry] plugin.id required');
  if (_sources.has(plugin.id)) {
    console.warn('[meteo/registry] re-register', plugin.id);
  }
  _sources.set(plugin.id, plugin);
}

export function getAll() {
  return Array.from(_sources.values());
}

export function get(id) {
  return _sources.get(id) || null;
}
