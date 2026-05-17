// ======================================================================
// js/engine/module-paths.js  (CORE — единый источник путей модулей)
// id модуля → путь его папки ОТ КОРНЯ САЙТА (без ../, без query).
// Это единственное место, где зашиты nav-пути. Физический перенос папки
// (Шаг X.5) = правка ТОЛЬКО значений здесь (+ entry-HTML depth + modules.json).
// CORE-owned: inspector/export (CORE) и модули импортируют отсюда
// (module→CORE и CORE→CORE разрешены законом импортов; SHARED не вовлечён).
// ======================================================================

export const MODULE_PATHS = {
  battery: 'apps/battery/',
  cable: 'apps/cable/',
  catalog: 'apps/catalog/',
  configurator3d: 'apps/configurator3d/',
  cooling: 'apps/cooling/',
  'facility-inventory': 'apps/facility-inventory/',
  'genset-config': 'apps/genset-config/',
  logistics: 'apps/logistics/',
  'mdc-config': 'apps/mdc-config/',
  meteo: 'apps/meteo/',
  'mv-config': 'apps/mv-config/',
  'panel-config': 'apps/panel-config/',
  'pdu-config': 'apps/pdu-config/',
  projects: 'apps/projects/',
  psychrometrics: 'apps/psychrometrics/',
  'rack-config': 'apps/rack-config/',
  reports: 'apps/reports/',
  schematic: 'apps/schematic/',
  'scs-config': 'apps/scs-config/',
  'scs-design': 'apps/scs-design/',
  service: 'apps/service/',
  sketch: 'apps/sketch/',
  'suppression-config': 'apps/suppression-config/',
  'tech-workspace': 'apps/tech-workspace/',
  'transformer-config': 'apps/transformer-config/',
  'ups-config': 'apps/ups-config/',
};

// Путь папки модуля от корня сайта. prefix — для вызовов из подпапки
// (например из tech-workspace/ нужен '../'). Без префикса — для кода,
// работающего на корневом index.html (Конструктор/инспектор).
export function moduleHref(id, prefix = '') {
  const base = MODULE_PATHS[id] || (id ? String(id).replace(/\/+$/, '') + '/' : '');
  return prefix + base;
}
