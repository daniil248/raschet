// =========================================================================
// Маппинг значений installMethod / bundling между методиками
// (IEC 60364-5-52 ↔ ПУЭ 7 ↔ РТМ 36.18.32.4-92).
// -------------------------------------------------------------------------
// v0.59.725: при переключении методики расчёта (calcMethod) на схеме
// часто остаются старые значения c.installMethod / c.bundling, которые
// не совместимы с новой методикой. Например, IEC «E — Перфорированный
// лоток» при переходе на ПУЭ становится невалидным; нужно подобрать
// ближайший аналог («open — Открытая прокладка»).
//
// Пользователь: «при переключении методики расчета, заменяй данные так
// чтобы выбор наиболее соответствовал исходной настройке».
//
// API:
//   mapInstallMethod(fromMid, toMid, value) → новый key из toMid
//   mapBundling(fromMid, toMid, value) → новый key bundlingOptions
// =========================================================================

// IEC → ПУЭ: классы IEC сворачиваются в 3 категории ПУЭ.
const IEC_TO_PUE_INSTALL = {
  A1: 'pipe',   // труба в теплоизол. стене
  A2: 'pipe',   // кабель в теплоизол. стене (нет прямого аналога — pipe ближе всего)
  B1: 'pipe',   // труба на/в стене
  B2: 'pipe',   // короб / сплошной лоток
  C:  'open',   // открыто на стене
  E:  'open',   // перфорированный лоток / в воздухе
  F:  'open',   // лестничный лоток
  G:  'open',   // одножильные с интервалами
  D1: 'ground', // в трубе в земле
  D2: 'ground', // напрямую в земле
};
// ПУЭ → IEC: расширяется обратно до представительного метода IEC.
const PUE_TO_IEC_INSTALL = {
  pipe:   'B1',  // труба на/в стене — самый общий
  open:   'E',   // перфорированный лоток / в воздухе — типичная открытая прокладка
  ground: 'D1',  // в трубе в земле — более частый случай
};

// Bundling: разные ключи в IEC (touching/spaced/bundled) и ПУЭ (rows/spaced/bundle).
const IEC_TO_PUE_BUNDLING = {
  touching: 'rows',    // вплотную ≈ в ряд однослойно
  spaced:   'spaced',  // с зазором → точное совпадение
  bundled:  'bundle',  // в пучке → почти совпадение (bundle vs bundled)
};
const PUE_TO_IEC_BUNDLING = {
  bundle:   'bundled',
  rows:     'touching',
  spaced:   'spaced',
};

// РТМ для cable использует ПУЭ как fallback (см. js/methods/index.js,
// getMethod('rtm') → METHODS.pue), поэтому в маппинге РТМ обрабатывается
// идентично ПУЭ.
function _norm(mid) {
  return mid === 'rtm' ? 'pue' : mid;
}

/**
 * Маппит значение installMethod при смене методики.
 * Если значения совпадают (одна и та же методика) — возвращает как есть.
 * Если ключ не найден в маппинге — возвращает defaultMethod новой методики
 * (или null, если default неизвестен).
 *
 * @param {string} fromMid — id исходной методики ('iec' | 'pue' | 'rtm')
 * @param {string} toMid — id новой методики
 * @param {string} value — текущее значение installMethod
 * @returns {string|null}
 */
export function mapInstallMethod(fromMid, toMid, value) {
  const f = _norm(fromMid), t = _norm(toMid);
  if (f === t) return value;
  if (f === 'iec' && t === 'pue') return IEC_TO_PUE_INSTALL[value] || 'pipe';
  if (f === 'pue' && t === 'iec') return PUE_TO_IEC_INSTALL[value] || 'B1';
  return value;
}

/** Аналогично для bundling. */
export function mapBundling(fromMid, toMid, value) {
  const f = _norm(fromMid), t = _norm(toMid);
  if (f === t) return value;
  if (f === 'iec' && t === 'pue') return IEC_TO_PUE_BUNDLING[value] || 'rows';
  if (f === 'pue' && t === 'iec') return PUE_TO_IEC_BUNDLING[value] || 'touching';
  return value;
}

/**
 * Хождение по схеме и трансляция всех c.installMethod / c.bundling +
 * GLOBAL.defaultInstallMethod при смене методики. Применять ПЕРЕД
 * сменой GLOBAL.calcMethod (значения должны быть translated в новую
 * систему ключей до того, как cable engine начнёт использовать
 * новую методику для подбора).
 *
 * @param {object} state — engine state (с .conns Map)
 * @param {object} GLOBAL — глобальные настройки
 * @param {string} fromMid — старый calcMethod
 * @param {string} toMid — новый calcMethod
 */
export function migrateConnsForMethodChange(state, GLOBAL, fromMid, toMid) {
  if (_norm(fromMid) === _norm(toMid)) return 0;
  let migrated = 0;
  // Глобальный default
  if (GLOBAL && GLOBAL.defaultInstallMethod) {
    const next = mapInstallMethod(fromMid, toMid, GLOBAL.defaultInstallMethod);
    if (next && next !== GLOBAL.defaultInstallMethod) {
      GLOBAL.defaultInstallMethod = next;
      migrated++;
    }
  }
  // Per-connection overrides
  if (state && state.conns && typeof state.conns.values === 'function') {
    for (const c of state.conns.values()) {
      if (c.installMethod) {
        const next = mapInstallMethod(fromMid, toMid, c.installMethod);
        if (next && next !== c.installMethod) {
          c.installMethod = next;
          migrated++;
        }
      }
      if (c.bundling) {
        const nextB = mapBundling(fromMid, toMid, c.bundling);
        if (nextB && nextB !== c.bundling) {
          c.bundling = nextB;
          migrated++;
        }
      }
    }
  }
  return migrated;
}
