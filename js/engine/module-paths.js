// ======================================================================
// js/engine/module-paths.js  (CORE — единый источник путей модулей)
// id модуля → путь его папки ОТ КОРНЯ САЙТА (без ../, без query).
// Это единственное место, где зашиты nav-пути. Физический перенос папки
// (Шаг X.5) = правка ТОЛЬКО значений здесь (+ entry-HTML depth + modules.json).
// CORE-owned: inspector/export (CORE) и модули импортируют отсюда
// (module→CORE и CORE→CORE разрешены законом импортов; SHARED не вовлечён).
// ======================================================================

export const MODULE_PATHS = {
  battery: 'battery/',
  cable: 'cable/',
  catalog: 'catalog/',
  configurator3d: 'configurator3d/',
  cooling: 'apps/cooling/',
  'facility-inventory': 'facility-inventory/',
  'genset-config': 'genset-config/',
  logistics: 'logistics/',
  'mdc-config': 'mdc-config/',
  meteo: 'meteo/',
  'mv-config': 'mv-config/',
  'panel-config': 'panel-config/',
  'pdu-config': 'pdu-config/',
  projects: 'projects/',
  psychrometrics: 'psychrometrics/',
  'rack-config': 'rack-config/',
  reports: 'reports/',
  schematic: 'schematic/',
  'scs-config': 'scs-config/',
  'scs-design': 'scs-design/',
  service: 'service/',
  sketch: 'sketch/',
  'suppression-config': 'suppression-config/',
  'tech-workspace': 'tech-workspace/',
  'transformer-config': 'transformer-config/',
  'ups-config': 'ups-config/',
};

// Путь папки модуля от корня сайта. prefix — для вызовов из подпапки
// (например из tech-workspace/ нужен '../'). Без префикса — для кода,
// работающего на корневом index.html (Конструктор/инспектор).
export function moduleHref(id, prefix = '') {
  const base = MODULE_PATHS[id] || (id ? String(id).replace(/\/+$/, '') + '/' : '');
  return prefix + base;
}
