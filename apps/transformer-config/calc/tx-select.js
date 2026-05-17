// ======================================================================
// transformer-config/calc/tx-select.js — расчётный слой подбора
// трансформатора. Чистые функции без DOM: классификация типа и
// фильтрация/ранжирование каталога по критериям wizard'а.
// Переиспользуемо (tech-workspace prefill, отчёты, тесты).
// ======================================================================

// Классификация типа трансформатора (сухой/масляный) по серии/модели
// и типу охлаждения. '' — не определён.
export function classifyTxType(t) {
  const s = String(t.series || t.model || '').toUpperCase();
  if (/ТСЛ|ТСЗГЛ|ТС[ЗГ]?\b|DRY|СУХ/.test(s) || t.coolingType === 'AN' || t.coolingType === 'AF') return 'dry';
  if (/ТМ|OIL|МАСЛ|ONAN|ONAF/.test(s) || t.coolingType === 'ONAN' || t.coolingType === 'ONAF') return 'oil';
  return '';
}

// Подбор трансформаторов из каталога по критериям.
// criteria: { loadKva, reservePct, uhv, ulv, type, group }
// Возвращает { sRequired, matched:[{ t, s, util }] } — отсортировано по
// убыванию загрузки (util = loadKva / S). Чистая функция (без DOM).
export function selectTransformers(catalog, criteria = {}) {
  const loadKva = Number(criteria.loadKva) || 0;
  const reservePct = Number(criteria.reservePct) || 0;
  const uhv = criteria.uhv;
  const ulv = criteria.ulv;
  const type = criteria.type;
  const group = criteria.group;

  const sRequired = loadKva * (1 + reservePct / 100);
  const matched = [];
  if (loadKva <= 0) return { sRequired, matched };

  for (const t of (catalog || [])) {
    const s = Number(t.ratedPowerKva || t.sKva || t.powerKva) || 0;
    if (s <= 0 || s < sRequired) continue;
    if (uhv && Number(t.primaryVoltageKv || t.uhvKv) !== Number(uhv)) continue;
    if (ulv && Number(t.secondaryVoltageV || t.ulvV) !== Number(ulv)) continue;
    if (type) {
      const cl = classifyTxType(t);
      if (cl && cl !== type) continue;
    }
    if (group && (t.connectionGroup || t.vectorGroup || t.group) &&
        String(t.connectionGroup || t.vectorGroup || t.group).toUpperCase() !== String(group).toUpperCase()) continue;
    matched.push({ t, s, util: loadKva / s });
  }
  matched.sort((a, b) => b.util - a.util);
  return { sRequired, matched };
}
