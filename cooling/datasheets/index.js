// =============================================================================
// cooling/datasheets/index.js — каталог готовых даташитов вендоров
// =============================================================================
// Phase 25.3: По требованию: «бесплатные шаблоны от популярных вендоров
// (Daikin / Stulz / York / Carrier / Trane / Kehua) — несколько готовых JSON для
// быстрого старта».
//
// Все значения — типичные/представительные для класса оборудования. Для
// проектного использования рекомендуется уточнить из официального datasheet
// производителя на конкретную модель.
//
// Источники (открытая инфо):
//   - Daikin EWAQ catalogue
//   - Stulz CyberCool / CyberHandler datasheets
//   - York YLAA series
//   - Carrier 30RB AquaForce
//   - Vertiv Liebert PCW
//   - Trane RTAF
//   - Kehua Thermal Management Catalog 2024-07-30 (KHJA / KHNA / KHCA series)
//     User Manuals: KHNA-X 25-65kW (2023-10-20), KHJA 25-120kW (2021-09-22),
//     KHCA-X 3.5-12.5kW (2024-08-21). Fluorine Pump Logic Description (Eng).
//
// Pure JS, no DOM.

import { DATASHEET_SCHEMA } from '../calc/datasheet.js';

/**
 * Каталог. Каждая запись — полный datasheet-объект, готовый к
 * applyDatasheetToSpec(). Группированы по vendor для UI.
 */
export const VENDOR_DATASHEETS = [
  // ===== Daikin =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Daikin',
    model: 'EWAQ-G 200 (air-cooled scroll)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 200,
    ratedCop: 3.2,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 7,
    freeCoolingApproach: 5,
    freeCoolingAuxPctOfRated: 6,
    refrigerant: 'R32',
    compressorType: 'scroll',
    physical: { lengthMm: 4500, widthMm: 2200, heightMm: 2100, weightKg: 2800 },
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Daikin',
    model: 'EWAH-TZ 350 (air-cooled inverter screw)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 350,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -1.4,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 12,
    freeCoolingApproach: 5,
    freeCoolingAuxPctOfRated: 5,
    refrigerant: 'R134a',
    compressorType: 'screw',
  },

  // ===== York (Johnson Controls) =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'York',
    model: 'YLAA0250HE (air-cooled scroll)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 250,
    ratedCop: 3.1,
    ambientRated: 35,
    capCorrPctPerC: -1.6,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'none',
    refrigerant: 'R410A',
    compressorType: 'scroll',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'York',
    model: 'YVAA 0500 (air-cooled VSD screw, free-cooling)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 500,
    ratedCop: 3.6,
    ambientRated: 35,
    capCorrPctPerC: -1.3,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 12,
    freeCoolingApproach: 4,
    freeCoolingAuxPctOfRated: 4,
    refrigerant: 'R134a',
    compressorType: 'screw',
  },

  // ===== Carrier =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Carrier',
    model: '30RB AquaForce 300 (air-cooled scroll)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 300,
    ratedCop: 3.3,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 7,
    freeCoolingApproach: 5,
    freeCoolingAuxPctOfRated: 5,
    refrigerant: 'R410A',
    compressorType: 'scroll',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Carrier',
    model: '30XW Water-cooled centrifugal 1000',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 1000,
    ratedCop: 5.8,
    ambientRated: 30,
    capCorrPctPerC: -0.5,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'wet',
    chwsTemp: 7,
    freeCoolingApproach: 3,
    freeCoolingAuxPctOfRated: 3,
    refrigerant: 'R134a',
    compressorType: 'centrifugal',
  },

  // ===== Trane =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Trane',
    model: 'RTAF 400 (air-cooled VSD screw)',
    kind: 'chiller',
    systemType: 'chiller',
    ratedCapKw: 400,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -1.4,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 12,
    freeCoolingApproach: 5,
    freeCoolingAuxPctOfRated: 5,
    refrigerant: 'R134a',
    compressorType: 'screw',
  },

  // ===== Stulz (CRAC) =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Stulz',
    model: 'CyberCool CW 80 (CRAC chilled water)',
    kind: 'crac',
    systemType: 'crac-water',
    ratedCapKw: 80,
    ratedCop: 30, // EER ratio для CRAC водяного охлаждения (только вентиляторы)
    ambientRated: 24,
    capCorrPctPerC: 0,
    partLoadCurve: 'fixed',
    refrigerant: 'water',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Stulz',
    model: 'CyberHandler 2 350 (CRAC + free-cooling loop)',
    kind: 'crac',
    systemType: 'crac-water+fc-loop',
    ratedCapKw: 350,
    ratedCop: 25,
    ambientRated: 24,
    capCorrPctPerC: 0,
    partLoadCurve: 'fixed',
    refrigerant: 'water+glycol',
  },

  // ===== Vertiv (Liebert) =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Vertiv (Liebert)',
    model: 'PCW 100 (CRAC chilled water)',
    kind: 'crac',
    systemType: 'crac-water',
    ratedCapKw: 100,
    ratedCop: 32,
    ambientRated: 24,
    capCorrPctPerC: 0,
    partLoadCurve: 'fixed',
    refrigerant: 'water',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Vertiv (Liebert)',
    model: 'DSE 200 (DX with pumped refrigerant economizer)',
    kind: 'dx',
    systemType: 'dx-pumped-fc',
    ratedCapKw: 200,
    ratedCop: 3.2,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'iplv',
    dxPumpedThresholdDb: 13,
    dxPumpedAuxPctOfRated: 3,
    refrigerant: 'R134a',
    compressorType: 'scroll',
  },

  // ===== Generic small DX =====
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Generic',
    model: 'DX air-cooled split inverter 12 kW',
    kind: 'dx',
    systemType: 'dx-air',
    ratedCapKw: 12,
    ratedCop: 4.2,
    ambientRated: 35,
    capCorrPctPerC: -2.0,
    partLoadCurve: 'iplv',
    refrigerant: 'R32',
    compressorType: 'scroll',
  },

  // =============================================================================
  // ===== Kehua (v0.60.65, по запросу Пользователя 2026-05-03) ==================
  // =============================================================================
  // Test conditions (вся серия): indoor return 24°C/50%RH, outdoor 35°C
  // (для KHCA: indoor return 37°C/24%RH, outdoor 35°C — high-density rack).
  // Standard refrigerant: R410A. Standard fan: EC. Standard expansion: electronic.
  // Operating temperature range: outdoor −35°C…+45°C (ultra-wide).
  // Capacity derating per condenser table (X25/35/50/65 — KHNRC):
  //   Δcap @ 40°C = 1.0; @ 45°C = 0.83-1.0; @ 48°C = 0.7-0.86; @ 55°C = 0.27-0.33.
  // Соответствует capCorrPctPerC ≈ −1.7%/°C для X25, ≈ −1.2%/°C для X65.

  // ----- KHJA series: in-room precision AC (fixed-frequency / inverter) -----
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P8AU 7.5 kW (in-room, R410A)',
    kind: 'crac',
    systemType: 'dx-air',  // air-cooled DX (split with KHNR8 outdoor)
    ratedCapKw: 7.5,
    ratedCop: 3.0,         // typical small CRAC scroll R410A @ AHRI
    ambientRated: 35,
    capCorrPctPerC: -1.8,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 550, widthMm: 450, heightMm: 1800, weightKg: 118 },
    notes: 'EC fan 2300 m³/h. Optional electrode humidifier (1.5 kg/h) and 3 kW heater (P-suffix). Outdoor unit KHNR8 (728×405×762, 34 kg). 220V/1PH/50Hz.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P12AU 12.5 kW (in-room, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 12.5,
    ratedCop: 3.0,
    ambientRated: 35,
    capCorrPctPerC: -1.8,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 650, widthMm: 450, heightMm: 1800, weightKg: 138 },
    notes: 'EC fan 3600 m³/h. Outdoor unit KHNR12 (728×405×1372, 53 kg). Sensible heat ratio ~90%. Wet-film humidifier optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P20AU 20 kW (in-room, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 20,
    ratedCop: 3.1,
    ambientRated: 35,
    capCorrPctPerC: -1.8,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 800, widthMm: 650, heightMm: 1800, weightKg: 174 },
    notes: 'EC fan 5400 m³/h. Outdoor KHNR20 (1080×405×1372, 85 kg). 220V/1PH/50Hz indoor / 380V/3PH outdoor.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P30AU 30 kW (in-room fixed-freq, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 30,           // 31.8 kW @ 24°C/50%RH per catalog
    ratedCop: 3.2,
    ambientRated: 35,
    capCorrPctPerC: -1.6,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 900, widthMm: 995, heightMm: 1965, weightKg: 310 },
    notes: 'EC backward centrifugal fan 9000 m³/h. Outdoor KHNR46×1 (1237×1039×780, 140 kg). Optional fluorine-pump centralized condenser KHNJ46E.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P40AU 40 kW (in-room fixed-freq, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 40,           // 41.2 kW @ 24°C/50%RH
    ratedCop: 3.3,
    ambientRated: 35,
    capCorrPctPerC: -1.6,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 1100, widthMm: 995, heightMm: 1965, weightKg: 415 },
    notes: 'EC fan 11000 m³/h. Outdoor KHNR54×1 (1237×1207×780, 150 kg). Wet-film humidifier 10 kg/h optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P60BU 60 kW (in-room fixed-freq dual-system)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 60,           // 66 kW @ 24°C/50%RH
    ratedCop: 3.3,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 1800, widthMm: 995, heightMm: 1965, weightKg: 600 },
    notes: 'Dual-system. EC fan 18000 m³/h. 2× KHNR46 outdoor units. R410A. 380V/3PH/50Hz.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P80BU 80 kW (in-room fixed-freq dual-system)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 80,           // 80.2 kW @ 24°C/50%RH
    ratedCop: 3.4,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 2200, widthMm: 995, heightMm: 1965, weightKg: 660 },
    notes: 'Dual-system. EC fan 21500 m³/h. 2× KHNR54 outdoor. Heater 9 kW + humidifier 10 kg/h optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHJA-P100BU 100 kW (in-room fixed-freq dual-system)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 100,          // 100.2 kW @ 24°C/50%RH
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -1.4,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 2200, widthMm: 995, heightMm: 1965, weightKg: 680 },
    notes: 'Dual-system. EC fan 25000 m³/h. 2× KHNR66 outdoor (1841×997×651, 160 kg). Modular V/A evaporator. DC inverter compressor option (P→V suffix).',
  },

  // ----- KHNA-X series: inter-row column AC with optional fluorine-pump FC -----
  // Per Kehua catalog 2024 «freon pump naturally cooled — annual energy saving
  // up to 40%». Поэтому моделируем KHNA-X*E (с pump cabinet) как dx-pumped-fc.
  // Базовые модели без E — обычный dx-air. При threshold по T_outdoor ≤ 13°C
  // насос обеспечивает natural circulation.
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X25 25 kW (inter-row air-cooled, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 25,
    ratedCop: 3.2,
    ambientRated: 35,
    capCorrPctPerC: -1.7,    // X25 derating ≈ -1.7%/°C per condenser table
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 300, widthMm: 1200, heightMm: 2000, weightKg: 210 },
    notes: 'In-row 300mm column. EC fan 5000 m³/h. Outdoor KHNRC25 single fan (1218×1087×955, 130 kg). 380V/3PH/50Hz. 26.7 A max. Heater 3 kW + humidifier 1.5 kg/h optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X25E 25 kW (inter-row + fluorine pump FC)',
    kind: 'crac',
    systemType: 'dx-pumped-fc',  // фреоновый насос для natural FC
    ratedCapKw: 25,
    ratedCop: 3.2,
    ambientRated: 35,
    capCorrPctPerC: -1.7,
    partLoadCurve: 'fixed',
    dxPumpedThresholdDb: 13,     // ниже 13°C → fluorine pump natural cooling
    dxPumpedAuxPctOfRated: 4,    // только насос + EC fan (~4% rated)
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 300, widthMm: 1200, heightMm: 2000, weightKg: 210 },
    notes: 'In-row + fluorine pump cabinet (KHE01). Auto-switch to natural cooling at T_amb ≤ 13°C. Annual energy saving up to 40% per Kehua. Outdoor KHNJ38E V-condenser (1020×1020×1770).',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X35 35 kW (inter-row air-cooled, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 35,           // 40 kW catalog rated, 35 nameplate
    ratedCop: 3.3,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 315 },
    notes: 'In-row 600mm. EC fan 8500 m³/h. Outdoor KHNRC35 (1368×1237×1207, 150 kg). 44.6 A max. Heater 6 kW + humidifier 3 kg/h optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X35E 35 kW (inter-row + fluorine pump FC)',
    kind: 'crac',
    systemType: 'dx-pumped-fc',
    ratedCapKw: 35,
    ratedCop: 3.3,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'fixed',
    dxPumpedThresholdDb: 13,
    dxPumpedAuxPctOfRated: 4,
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 315 },
    notes: 'In-row + fluorine pump (KHE02). KHNJ54E V-condenser. Annual saving 40% per Kehua catalog.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X50 50 kW (inter-row air-cooled, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 50,
    ratedCop: 3.4,
    ambientRated: 35,
    capCorrPctPerC: -1.4,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 335 },
    notes: 'In-row 600mm. EC fan 10000 m³/h. Outdoor KHNRC50 dual fan (1972×1841×997, 160 kg). 56.4 A max.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X50E 50 kW (inter-row + fluorine pump FC)',
    kind: 'crac',
    systemType: 'dx-pumped-fc',
    ratedCapKw: 50,
    ratedCop: 3.4,
    ambientRated: 35,
    capCorrPctPerC: -1.4,
    partLoadCurve: 'fixed',
    dxPumpedThresholdDb: 13,
    dxPumpedAuxPctOfRated: 4,
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 335 },
    notes: 'In-row + fluorine pump (KHE03). KHNJ66E V-condenser. Annual saving 40%.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X65 65 kW (inter-row air-cooled, R410A)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 65,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -1.2,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 350 },
    notes: 'In-row 600mm. EC fan 12000 m³/h. Outdoor KHNRC65 dual fan (2263×2132×1039, 200 kg). Heater 6 kW + humidifier 3 kg/h optional.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHNA-X65E 65 kW (inter-row + fluorine pump FC)',
    kind: 'crac',
    systemType: 'dx-pumped-fc',
    ratedCapKw: 65,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -1.2,
    partLoadCurve: 'fixed',
    dxPumpedThresholdDb: 13,
    dxPumpedAuxPctOfRated: 4,
    refrigerant: 'R410A',
    compressorType: 'scroll',
    physical: { lengthMm: 600, widthMm: 1200, heightMm: 2000, weightKg: 350 },
    notes: 'In-row + fluorine pump. KHNJ78E V-condenser (1080×1080×1950). Maximum capacity in series.',
  },

  // ----- KHCA-X series: rack-mounted AC -----
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHCA-X4 3.5 kW (rack-mounted 5U)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 3.5,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -2.0,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'rotary',
    physical: { lengthMm: 440, widthMm: 760, heightMm: 217, weightKg: 26 },
    notes: '5U rack-mount, 19" cabinet. Air-cooled. 220V/1PH/50Hz. 800 m³/h. Test conditions: indoor return 37°C/24%RH. Outdoor unit 830×325×540 mm, 30.5 kg. WiseRow/WiseCabinet integration.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHCA-X8 7.5 kW (rack-mounted 8U)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 7.5,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -2.0,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'rotary',
    physical: { lengthMm: 440, widthMm: 760, heightMm: 350, weightKg: 36 },
    notes: '8U rack-mount, 19". 1500 m³/h. DC inverter compressor, slide-out maintenance design. Outdoor 960×396×700, 43.5 kg.',
  },
  {
    schema: DATASHEET_SCHEMA,
    vendor: 'Kehua',
    model: 'KHCA-X13 12.5 kW (rack-mounted 10U)',
    kind: 'crac',
    systemType: 'dx-air',
    ratedCapKw: 12.5,
    ratedCop: 3.5,
    ambientRated: 35,
    capCorrPctPerC: -2.0,
    partLoadCurve: 'fixed',
    refrigerant: 'R410A',
    compressorType: 'rotary',
    physical: { lengthMm: 440, widthMm: 760, heightMm: 442, weightKg: 50 },
    notes: '10U rack-mount, 19". 2200 m³/h. DC inverter compressor. Stepless capacity adjustment. WiseCol-U integration.',
  },
];

/**
 * Получить datasheets, опционально отфильтрованные по vendor / kind.
 */
export function listDatasheets(filter = {}) {
  let arr = VENDOR_DATASHEETS.slice();
  if (filter.vendor) arr = arr.filter(d => d.vendor === filter.vendor);
  if (filter.kind)   arr = arr.filter(d => d.kind === filter.kind);
  return arr;
}

export function listVendors() {
  return [...new Set(VENDOR_DATASHEETS.map(d => d.vendor))];
}
