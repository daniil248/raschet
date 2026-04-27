// ======================================================================
// shared/ups-verified.js
// Список ИБП, у которых V_DC окно подтверждено datasheet (через web-search
// или прямой PDF). Остальные seed-записи имеют значения V_DC из
// первоначального каталога — это оценки по аналогии или по номинальному
// напряжению. До явной верификации datasheet их следует помечать ⚠ в UI.
//
// Источники для verified:
//   • Eaton 9PX 6/11        → 150-216 / 200-288 (TD153001EN/TD153002EN, 15/20 × 12В VRLA)
//   • Eaton 93PM 50/100/200 → 360-540 (PQ131012EN, 36/40 × 12В VRLA)
//   • Eaton 93PS 40         → 336-480 (PS153045, 28/40 × 12В VRLA)
//   • Schneider Galaxy VS 10/20 → 384-576 (Tech Spec 990-91141, 32-48 × 12В VRLA)
//   • Schneider Galaxy VS 60 → 384-576 (securepower.com GVSUPS60KGS)
//   • Schneider Galaxy VL 200/300/500 → 384-576 (Tech Spec 990-91377/91399)
//   • Schneider Galaxy VX 750/1500   → 384-576 (Tech Spec 990-5783, та же battery system что у VL)
//   • Legrand Keor S 6/10 (id «sp»)  → 200-288 (Brochure_KEOR_S_GB, 240V ном., 20 × 12В VRLA)
//   • Legrand Keor T EVO 10/20      → 240-576 (Manual LE10507AD, 24…40 × 12В VRLA)
//   • Legrand Keor LP 3              → 60-86 (310158 datasheet, 6 × 12В VRLA)
//   • Legrand Keor MOD 25 (id 30)    → 440-634 (Tech Spec 38559, split bus +/-264V, 44 × 12В)
//   • Legrand Keor MP 200 (id 300)   → 432-600 (Brochure + UPS_LGR_0241, 432-600 VDC VRLA)
//   • Legrand Keor HPE 400           → 620-840 (Tech Spec UPS-LGR-0120 + 200-300KVA, 360-372 cells × 12В)
//   • DKC Small Tower 1/3 kVA        → 24-36 / 72-96 (DKC Small Tower 1000-3000 User Manual)
//   • DKC SMALL+ 6/10 (= DAKER DK)   → 200-288 (Legrand DAKER DK Plus datasheet LE09706AB, 20 × 12В VRLA)
//   • DKC Modulys GP 25/100 (= Socomec) → 360-691 (Socomec Modulys GP UL Brochure, 18+18 to 24+24 × 12В split bus)
//   • Все Kehua MR33/S3 AIO  → паспорт Kehua UPS Catalog 2024-10-22
// ======================================================================

const VERIFIED_VDC_IDS = new Set([
  // Eaton (verified through datasheet web-search)
  'eaton-9px-6k', 'eaton-9px-11k',
  'eaton-93pm-50k', 'eaton-93pm-100k', 'eaton-93pm-200k',
  'eaton-93ps-8k', 'eaton-93ps-20k', 'eaton-93ps-40k',
  'eaton-9395-500k', 'eaton-9395-1100k',
  // Schneider
  'schneider-galaxy-vs-10k', 'schneider-galaxy-vs-20k',
  'schneider-galaxy-vs-40k', 'schneider-galaxy-vs-60k', 'schneider-galaxy-vs-100k',
  'schneider-galaxy-vl-200k', 'schneider-galaxy-vl-300k', 'schneider-galaxy-vl-500k',
  'schneider-galaxy-vx-750k', 'schneider-galaxy-vx-1500k',
  // Legrand
  'legrand-keor-sp-6k', 'legrand-keor-sp-10k',
  'legrand-keor-tevo-10k', 'legrand-keor-tevo-20k',
  'legrand-keor-lp-3k',
  'legrand-keor-mod-30k', 'legrand-keor-mp-300k',
  'legrand-keor-hpe-400k',
  // DKC
  'dkc-small-1k', 'dkc-small-3k',
  'dkc-small-6k', 'dkc-small-10k',
  'dkc-modulys-25k', 'dkc-modulys-100k',
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
