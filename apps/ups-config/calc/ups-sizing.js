// ======================================================================
// ups-config/calc/ups-sizing.js
// Чистый расчётный слой Конфигуратора ИБП (без DOM): разбор схемы
// резервирования и расчёт числа модулей модульного ИБП.
// Переиспользуемо: ups-types-плагины (pickFit), отчёты, тесты.
// ======================================================================

// Парсит схему резервирования N / N+1 / N+2 / 2N → { mode, x }.
export function parseRedundancy(scheme) {
  if (scheme === '2N') return { mode: '2N', x: 0 };
  const m = /^N(?:\+(\d+))?$/.exec(scheme || 'N');
  return { mode: 'N+X', x: m ? Number(m[1] || 0) : 0 };
}

// Вычисляет число рабочих модулей + резерв для модульного ИБП.
export function calcModules(loadKw, moduleKw, moduleSlots, redundancy) {
  const r = parseRedundancy(redundancy);
  const working = Math.ceil(loadKw / moduleKw);
  let installed;
  if (r.mode === '2N') installed = working * 2;
  else installed = working + r.x;
  const fits = installed <= moduleSlots;
  return { working, redundant: r.x, installed, fits, redundancyLabel: redundancy };
}
