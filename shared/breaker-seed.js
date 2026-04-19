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

import { createBreakerElement } from './element-schemas.js';

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
const MCCB_IN_SERIES = [100, 160, 250, 400, 630, 800, 1000, 1250, 1600];

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

/** Все builtin-автоматы. Вызывается catalog-bridge. */
export function listBuiltinBreakers() {
  return [...seedMcbBreakers(), ...seedMccbBreakers()];
}
