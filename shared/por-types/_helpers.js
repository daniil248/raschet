// shared/por-types/_helpers.js
// Общие хелперы для всех POR-type модулей. Не импортируется напрямую
// конфигураторами — только другими por-types/*.js.

export function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

export function str(v, fallback) {
  return v == null ? (fallback == null ? '' : fallback) : String(v);
}

/**
 * Унифицированная нормализация partial-объекта: гарантирует наличие domains/views
 * без перезатирания содержимого.
 */
export function withDomains(partial, domains) {
  return {
    ...partial,
    domains: { ...(domains || {}), ...(partial.domains || {}) },
    views:   partial.views || {},
  };
}
