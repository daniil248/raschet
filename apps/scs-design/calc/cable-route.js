// ======================================================================
// scs-design/calc/cable-route.js
// Чистый расчётный слой Дизайнера СКС (без DOM): Manhattan-геометрия
// кабельных маршрутов — наращивание ломаной без диагоналей, длина
// маршрута в клетках, SVG path. Размер клетки (PLAN_CELL_PX) мутирует
// при смене масштаба — передаётся параметром.
// Переиспользуемо: расчёт длин, экспорт, отчёты, тесты.
// ======================================================================

// Наращивает Manhattan-ломаную: добавляет к pts точку (qx,qy) без
// диагоналей (при необходимости — промежуточный L-угол по preferAxis).
export function pushManhattan(pts, qx, qy, preferAxis /* 'h'|'v' */) {
  const last = pts[pts.length - 1];
  const [lx, ly] = last;
  if (lx === qx && ly === qy) return;
  if (lx === qx || ly === qy) { pts.push([qx, qy]); return; }
  if (preferAxis === 'v') pts.push([lx, qy]);
  else pts.push([qx, ly]);
  pts.push([qx, qy]);
}

// Длина ломаной в клетках плана (cellPx — текущий размер клетки в px).
export function routeCells(pts, cellPx) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  }
  return len / cellPx;
}

// SVG path (M…L…) по списку точек.
export function ptsToPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
  return d;
}
