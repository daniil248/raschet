// ======================================================================
// shared/ups-verified.js
// Список ИБП, у которых V_DC окно подтверждено datasheet (через web-search
// или прямой PDF). Остальные seed-записи имеют значения V_DC из
// первоначального каталога — это оценки по аналогии или по номинальному
// напряжению. До явной верификации datasheet их следует помечать ⚠ в UI.
//
// Источники для verified:
//   • Eaton 93PM 50/100/200 → 360-540 (PQ131012EN, 36/40 × 12В VRLA)
//   • Eaton 93PS 40         → 336-480 (PS153045, 28/40 × 12В VRLA)
//   • Schneider Galaxy VS 60 → 384-576 (securepower.com GVSUPS60KGS)
//   • Все Kehua MR33/S3 AIO  → паспорт Kehua UPS Catalog 2024-10-22
// ======================================================================

const VERIFIED_VDC_IDS = new Set([
  // Eaton (verified through datasheet web-search)
  'eaton-93pm-50k', 'eaton-93pm-100k', 'eaton-93pm-200k',
  'eaton-93ps-40k',
  'eaton-9395-500k',
  // Schneider
  'schneider-galaxy-vs-60k',
  // Kehua — указаны страницы каталога в source
  'kehua-mr33120-30k', 'kehua-mr33200-50k', 'kehua-mr33300-50k',
  'kehua-mr33400-50k', 'kehua-mr33500-50k', 'kehua-mr33600-50k',
  'kehua-mr33800-100k', 'kehua-mr331000-100k', 'kehua-mr331200-100k',
  'kehua-kr10kva-rm', 'kehua-kr20kva-rm', 'kehua-kr30kva-rm', 'kehua-kr40kva-rm',
  'kehua-my60', 'kehua-my80', 'kehua-my100', 'kehua-my120', 'kehua-my160', 'kehua-my200',
  'kehua-fruk3310-gel', 'kehua-fruk3320-gel', 'kehua-fruk3340-gel',
  'kehua-fruk3380-gel', 'kehua-fruk33160-gel', 'kehua-fruk33200-gel',
  'kehua-fruk3360', 'kehua-fruk33200', 'kehua-fruk33400', 'kehua-fruk33600-12p',
  'kehua-kr33400-h', 'kehua-kr33600-h', 'kehua-kr33800-h',
  'kehua-kr33300', 'kehua-kr33500', 'kehua-kr33800', 'kehua-kr331200',
  'kehua-mr3390-b', 'kehua-mr3390-s', 'kehua-mr33150-b', 'kehua-mr33150-s',
]);

export function isUpsVdcVerified(u) {
  if (!u) return false;
  // Пользовательские записи (custom:true) — пользователь сам отвечает за данные.
  if (u.custom) return true;
  return VERIFIED_VDC_IDS.has(u.id);
}

export function getVdcVerificationLabel(u) {
  return isUpsVdcVerified(u) ? '✓ V_DC подтверждено datasheet' : '⚠ V_DC — оценка, требует сверки с datasheet';
}
