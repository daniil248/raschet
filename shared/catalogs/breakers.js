// ======================================================================
// shared/breaker-seed.js
// Базовый набор автоматических выключателей, регистрируемых как builtin
// в element-library при загрузке catalog-bridge.
//
// Состав:
//  - Модульные MCB: B/C/D по ряду In = 6..63 A, 1/3 полюса,
//    Icu = 4.5/6/10 кА (типичные для бытового / коммерческого сектора)
//  - MCCB: 100/160/250/400/630/1000 A, 3P, с токоограничением
//  - TCC-формулы ссылаются на типовые кривые из tcc-curves.js
//
// Цель: пользователь сразу видит справочник и может выбрать автомат
// для линии. Цены не привязаны (это делается через catalog/).
// ======================================================================

import { createBreakerElement } from '../element-schemas.js';

// Стандартный ряд In (A) для MCB — IEC 60898-1
const MCB_IN_SERIES = [1, 2, 3, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63];
// Характеристики
const MCB_CURVES = ['B', 'C', 'D'];
// Число полюсов
const MCB_POLES = [1, 2, 3, 4];

/**
 * Генерирует набор базовых MCB (модульных).
 * Возвращает массив BreakerElement.
 * Note: для экономии места создаются только 1P и 3P (наиболее частые).
 */
export function seedMcbBreakers() {
  const out = [];
  for (const curve of MCB_CURVES) {
    for (const poles of [1, 3]) {
      for (const In of MCB_IN_SERIES) {
        out.push(createBreakerElement({
          id: `mcb-${curve.toLowerCase()}-${In}-${poles}p`,
          manufacturer: 'Типовой',
          series: `MCB ${curve}`,
          variant: `${In}A ${poles}P`,
          label: `MCB ${curve}${In} (${poles}P)`,
          description: `Модульный автоматический выключатель характеристика ${curve}, ${In} А, ${poles} полюса`,
          type: 'MCB',
          curve,
          inNominal: In,
          poles,
          breakingCapacityKa: In <= 32 ? 6 : 10,  // типовое
          tripUnit: 'thermomagnetic',
          modules: poles,            // модулей в щите = число полюсов
          adjustable: false,
          tccCurveFormula: `iec-60898-${curve}`,
          voltageCategory: 'lv',
          widthMm: 18 * poles,       // 18 мм / модуль
          heightMm: 85,
          depthMm: 70,
          weightKg: 0.1 * poles,
          heatDissipationW: In > 16 ? In / 16 : 1, // приблизительно
          source: 'builtin',
          builtin: true,
          tags: ['MCB', curve + '-curve', `${In}A`, `${poles}P`],
        }));
      }
    }
  }
  return out;
}

/**
 * MCCB (промышленные) — один типовой ряд с электронным расцепителем.
 */
// v0.57.90: ряд MCCB расширен до 3200 А (Schneider ComPacT NS1600…NS3200,
// ABB Tmax XT7/T7 1000-1600, Siemens 3VA 1600-2500, Hyundai HGM-3200).
const MCCB_IN_SERIES = [100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200];

export function seedMccbBreakers() {
  const out = [];
  for (const In of MCCB_IN_SERIES) {
    // С термомагнитным расцепителем (фиксированные)
    out.push(createBreakerElement({
      id: `mccb-tm-${In}`,
      manufacturer: 'Типовой',
      series: 'MCCB TM',
      variant: `${In}A 3P`,
      label: `MCCB ${In}A (термомагнитный)`,
      description: `Силовой автомат в литом корпусе, термомагнитный расцепитель, ${In} А, 3P`,
      type: 'MCCB',
      curve: 'C',  // эквивалентно магн. 5-10×In
      inNominal: In,
      poles: 3,
      breakingCapacityKa: In <= 250 ? 25 : (In <= 630 ? 36 : 50),
      tripUnit: 'thermomagnetic',
      modules: 4,
      adjustable: false,
      widthMm: In <= 250 ? 105 : (In <= 630 ? 140 : 210),
      heightMm: In <= 250 ? 161 : 273,
      depthMm: 92,
      weightKg: In <= 250 ? 1.5 : (In <= 630 ? 3.5 : 8),
      voltageCategory: 'lv',
      source: 'builtin',
      builtin: true,
      tags: ['MCCB', 'thermomagnetic', `${In}A`, '3P'],
    }));

    // С электронным расцепителем (настраиваемые) — для больших номиналов
    if (In >= 250) {
      const Ir_min = Math.round(In * 0.4);
      const Ir_max = In;
      const Isd_min = In * 1.5;
      const Isd_max = In * 10;
      const Ii_min = In * 6;
      const Ii_max = In * 15;
      out.push(createBreakerElement({
        id: `mccb-el-${In}`,
        manufacturer: 'Типовой',
        series: 'MCCB ELEC',
        variant: `${In}A 3P LSI`,
        label: `MCCB ${In}A (электронный LSI)`,
        description: `Силовой автомат с электронным расцепителем LSI (Long-Short-Instantaneous), настраиваемый, ${In} А`,
        type: 'MCCB',
        curve: 'LSI',
        inNominal: In,
        poles: 3,
        breakingCapacityKa: In <= 400 ? 36 : 50,
        tripUnit: 'electronic',
        modules: 4,
        adjustable: true,
        settings: {
          Ir:  { min: Ir_min, max: Ir_max, step: Math.max(1, Math.round(In * 0.05)), value: Math.round(In * 0.9) },
          Isd: { min: Isd_min, max: Isd_max, step: In * 0.5, value: Math.round(In * 6) },
          tsd: { min: 0.05, max: 0.5, step: 0.05, value: 0.1 },  // time-short-delay
          Ii:  { min: Ii_min, max: Ii_max, step: In, value: Math.round(In * 10) },
        },
        widthMm: In <= 400 ? 140 : 210,
        heightMm: 273,
        depthMm: 92,
        weightKg: In <= 400 ? 3 : 8,
        voltageCategory: 'lv',
        source: 'builtin',
        builtin: true,
        tags: ['MCCB', 'electronic', `${In}A`, '3P', 'adjustable', 'LSI'],
      }));
    }
  }
  return out;
}

/**
 * MV-автоматы: VCB (вакуумные) и SF6. Для 6-35 кВ сетей.
 * Типовые параметры для inverse-time релейной защиты (не термомагнитные).
 *
 * VCB (Vacuum Circuit Breaker) — самый распространённый MV-автомат:
 *  - In: 630, 1250, 2000, 2500, 3150, 4000 А
 *  - Icu: 20, 25, 31.5, 40, 50 кА
 *  - Релейная защита: ANSI 50/51 (overcurrent), 67 (directional)
 *  - Время отключения: 40-80 мс (быстродействие)
 *
 * TCC задаётся через реле защиты (Ir/Isd/Ii), а не кривой самого VCB —
 * поэтому settings всегда adjustable=true.
 */
const MV_VCB_IN = [630, 1250, 2000, 2500, 3150, 4000];
const MV_UN = [6, 10, 20, 24, 35];

function seedMvVcbBreakers() {
  const out = [];
  // Только 10 кВ и 24 кВ — самые ходовые номинальные напряжения
  for (const Un of [10, 24]) {
    for (const In of MV_VCB_IN) {
      const Icu = In <= 1250 ? 25 : (In <= 2500 ? 31.5 : 50);
      const Ir_min = Math.round(In * 0.4);
      const Ir_max = In;
      const Isd_min = In * 1.2;
      const Isd_max = In * 15;
      const Ii_min = In * 5;
      const Ii_max = In * 20;
      out.push(createBreakerElement({
        id: `mv-vcb-${Un}kv-${In}`,
        manufacturer: 'Типовой',
        series: `VCB ${Un} кВ`,
        variant: `${In}A`,
        label: `VCB ${In}A · ${Un} кВ`,
        description: `Вакуумный выключатель среднего напряжения, ${In} А, ${Un} кВ, Icu ${Icu} кА, с электронным реле защиты`,
        type: 'MV-VCB',
        curve: 'LSI',
        inNominal: In,
        poles: 3,
        breakingCapacityKa: Icu,
        tripUnit: 'electronic-relay',
        modules: 1,
        adjustable: true,
        settings: {
          Ir:  { min: Ir_min, max: Ir_max, step: Math.max(1, Math.round(In * 0.05)), value: Math.round(In * 0.8) },
          Isd: { min: Isd_min, max: Isd_max, step: Math.round(In * 0.5), value: Math.round(In * 5) },
          tsd: { min: 0.05, max: 2.0, step: 0.05, value: 0.2 },       // селективная задержка
          Ii:  { min: Ii_min, max: Ii_max, step: Math.round(In), value: Math.round(In * 12) },
        },
        voltageCategory: 'mv',
        widthMm: 600,
        heightMm: 800,
        depthMm: 600,
        weightKg: 120 + In / 20,
        heatDissipationW: In * 0.4,
        source: 'builtin',
        builtin: true,
        tags: ['MV', 'VCB', 'vacuum', `${Un}kV`, `${In}A`, 'electronic-relay'],
      }));
    }
  }
  return out;
}

/**
 * SF6-автоматы — альтернатива VCB, используется до 40.5 кВ.
 * Обычно часть моноблоков (RM6 variants с VCB) или в GIS.
 * Номинальные токи аналогичные.
 */
function seedMvSf6Breakers() {
  const out = [];
  for (const Un of [10, 24]) {
    for (const In of [630, 1250]) {
      const Icu = 25;
      out.push(createBreakerElement({
        id: `mv-sf6-${Un}kv-${In}`,
        manufacturer: 'Типовой',
        series: `SF6 ${Un} кВ`,
        variant: `${In}A`,
        label: `SF6 ${In}A · ${Un} кВ`,
        description: `Элегазовый выключатель среднего напряжения (SF6), ${In} А, ${Un} кВ, Icu ${Icu} кА`,
        type: 'MV-SF6',
        curve: 'LSI',
        inNominal: In,
        poles: 3,
        breakingCapacityKa: Icu,
        tripUnit: 'electronic-relay',
        modules: 1,
        adjustable: true,
        settings: {
          Ir:  { min: Math.round(In * 0.4), max: In, step: Math.round(In * 0.05), value: Math.round(In * 0.8) },
          Isd: { min: In * 1.2, max: In * 15, step: Math.round(In * 0.5), value: Math.round(In * 5) },
          tsd: { min: 0.05, max: 2.0, step: 0.05, value: 0.2 },
          Ii:  { min: In * 5, max: In * 20, step: Math.round(In), value: Math.round(In * 12) },
        },
        voltageCategory: 'mv',
        widthMm: 500,
        heightMm: 800,
        depthMm: 500,
        weightKg: 80 + In / 30,
        source: 'builtin',
        builtin: true,
        tags: ['MV', 'SF6', `${Un}kV`, `${In}A`, 'electronic-relay'],
      }));
    }
  }
  return out;
}

/**
 * Плавкие предохранители HV (для transformer-protect ячеек RM6/ЩО-70).
 * Стандартный ряд IEC 60282-1 для защиты трансформаторов 400-1600 кВА.
 */
function seedMvFuses() {
  const out = [];
  // Ряд для 10 кВ / 24 кВ · типовые номиналы для защиты ТП
  const fusesData = [
    { In: 20,  Un: 10, forKva: 160 },
    { In: 31.5, Un: 10, forKva: 250 },
    { In: 40,  Un: 10, forKva: 400 },
    { In: 50,  Un: 10, forKva: 630 },
    { In: 63,  Un: 10, forKva: 1000 },
    { In: 80,  Un: 10, forKva: 1250 },
    { In: 100, Un: 10, forKva: 1600 },
    { In: 16,  Un: 24, forKva: 250 },
    { In: 25,  Un: 24, forKva: 400 },
    { In: 40,  Un: 24, forKva: 630 },
    { In: 50,  Un: 24, forKva: 1000 },
  ];
  for (const f of fusesData) {
    out.push(createBreakerElement({
      id: `mv-fuse-${f.Un}kv-${f.In}`,
      manufacturer: 'Типовой',
      series: `HV-fuse ${f.Un} кВ`,
      variant: `${f.In}A`,
      label: `HV-fuse ${f.In}A · ${f.Un} кВ (ТП ${f.forKva} кВА)`,
      description: `Плавкий предохранитель HV по IEC 60282-1, ${f.In} А, ${f.Un} кВ. Типовой для защиты трансформатора ${f.forKva} кВА`,
      type: 'MV-fuse',
      curve: 'gG',             // общего назначения (trafo + cable backup)
      inNominal: f.In,
      poles: 3,
      breakingCapacityKa: 40,
      tripUnit: 'fuse-element',
      modules: 1,
      adjustable: false,
      voltageCategory: 'mv',
      widthMm: 100,
      heightMm: 550,
      depthMm: 100,
      weightKg: 2,
      source: 'builtin',
      builtin: true,
      tags: ['MV', 'fuse', 'IEC-60282-1', `${f.Un}kV`, `${f.In}A`, 'transformer-protect'],
    }));
  }
  return out;
}

/** Все builtin-автоматы. Вызывается catalog-bridge. */
export function listBuiltinBreakers() {
  return [
    ...seedMcbBreakers(),     // LV MCB
    ...seedMccbBreakers(),    // LV MCCB
    ...seedMvVcbBreakers(),   // MV VCB (Фаза 1.19.2)
    ...seedMvSf6Breakers(),   // MV SF6
    ...seedMvFuses(),         // MV плавкие (для transformer-protect ячеек)
  ];
}
