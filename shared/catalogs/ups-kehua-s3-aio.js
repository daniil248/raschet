// ======================================================================
// shared/catalogs/ups-kehua-s3-aio.js
// Kehua S³C All-in-One UPS — моноблочный шкаф со встроенной АКБ Li-Ion
// и встроенными PDM-панелями. Источник: Kehua S³ Brochure 2023-11-16,
// раздел «All-in-One Configurations».
//
// Именование модели: S3C{aH}-{phaseCode}{kVA}, где
//   {aH}        — ёмкость батарейного модуля (40 / 50 / 100)
//   {phaseCode} — 11 (1:1) или 33 (3:3)
//   {kVA}       — выходная мощность ИБП в kVA
//
// Лимит модулей АКБ:
//   • 40 / 50 А·ч → до 8 батарейных модулей в шкафу
//   • 100 А·ч     → до 4 модулей (модули в 1.5 раза больше по высоте)
//
// ВАЖНО: All-in-One НЕ поддерживает параллельную работу. Для нагрузки
// > 20 кВА или резервирования N+1 / 2N — используйте standalone S³
// (тип «Интегрированный» + cabinet S3C040/050/100).
// ======================================================================

export const KEHUA_S3_AIO_UPSES = [
  // ─── 1:1 серия 40 А·ч (commercial / small office) ───────────────
  {
    id: 'kehua-s3c040-1106',
    supplier: 'Kehua',
    model: 'S³C040-1106',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 6, capacityKw: 6,
    phases: 1,
    efficiency: 95, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion',
    batteryCapacityAh: 40,
    batteryMaxModules: 8,
    batteryInstalledModules: 8,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '1P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 6 кВА · 1:1 · встроенная АКБ 40 А·ч × 8 модулей. Параллель не поддерживается.',
  },
  {
    id: 'kehua-s3c040-1110',
    supplier: 'Kehua',
    model: 'S³C040-1110',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 10, capacityKw: 10,
    phases: 1,
    efficiency: 95, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion', batteryCapacityAh: 40,
    batteryMaxModules: 8, batteryInstalledModules: 8,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '1P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 1:1 · встроенная АКБ 40 А·ч × 8 модулей.',
  },
  // ─── 3:3 серия 40 А·ч ──────────────────────────────────────────
  {
    id: 'kehua-s3c040-3310',
    supplier: 'Kehua',
    model: 'S³C040-3310',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 10, capacityKw: 10,
    phases: 3,
    efficiency: 95, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion', batteryCapacityAh: 40,
    batteryMaxModules: 8, batteryInstalledModules: 8,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '3P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 10 кВА · 3:3 · встроенная АКБ 40 А·ч × 8 модулей.',
  },
  {
    id: 'kehua-s3c040-3320',
    supplier: 'Kehua',
    model: 'S³C040-3320',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20,
    phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion', batteryCapacityAh: 40,
    batteryMaxModules: 8, batteryInstalledModules: 8,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '3P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3:3 · встроенная АКБ 40 А·ч × 8 модулей. Самая популярная модель AIO.',
  },
  // ─── 3:3 серия 50 А·ч ──────────────────────────────────────────
  {
    id: 'kehua-s3c050-3320',
    supplier: 'Kehua',
    model: 'S³C050-3320',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20,
    phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion', batteryCapacityAh: 50,
    batteryMaxModules: 8, batteryInstalledModules: 8,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '3P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3:3 · АКБ 50 А·ч × 8 модулей (увеличенная автономия vs 40 А·ч).',
  },
  // ─── 3:3 серия 100 А·ч (long-time backup) ──────────────────────
  {
    id: 'kehua-s3c100-3320',
    supplier: 'Kehua',
    model: 'S³C100-3320',
    kind: 'ups-all-in-one',
    upsType: 'monoblock',
    capacityKva: 20, capacityKw: 20,
    phases: 3,
    efficiency: 96, cosPhi: 1.0,
    vdcMin: 192, vdcMax: 240,
    inputs: 1, outputs: 1,
    batteryChemistry: 'li-ion', batteryCapacityAh: 100,
    batteryMaxModules: 4, batteryInstalledModules: 4,
    parallelSupported: false,
    pdmModules: [
      { id: 'ac', label: 'PDM-AC', source: 'utility',  polarity: '3P' },
      { id: 'it', label: 'PDM-IT', source: 'inverter', polarity: '1P' },
    ],
    cabinetWidthMm: 600, cabinetDepthMm: 1100, cabinetHeightMm: 2000,
    source: 'Kehua S3 Brochure 2023-11-16, AIO',
    importedAt: 0, custom: false,
    notes: 'Моноблок 20 кВА · 3:3 · АКБ 100 А·ч × 4 модуля. Для длительного резервирования (1+ ч на полной нагрузке).',
  },
];
