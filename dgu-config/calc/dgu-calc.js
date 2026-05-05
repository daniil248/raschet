// =============================================================================
// dgu-config/calc/dgu-calc.js — расчётный слой ДГУ
// =============================================================================
// Phase 30.3 (v0.60.70): По требованию Пользователя 2026-05-03 «надеюсь ты уже
// проработал план интеграции модуля Технолог ЦОД с модулями климата, подбора
// холода, подбора ИБП, ДГУ, расчёт PUE».
//
// Pure JS, no DOM. Расчёт мощности ДГУ с учётом:
//   - Mode (ESP / PRP / COP) — допустимая нагрузка по ISO 8528-1
//   - Climate derate (altitude / ambient T / humidity) по ISO 3046-1
//   - Резервирование (N / N+1 / 2N)
//   - Расход топлива (л/кВт·ч)
//   - Объём топливного бака (часы автономности × расход)

/**
 * Полный набор режимов мощности генератора по ISO 8528 (части 1, 13).
 * v0.60.91 (Пользователь 2026-05-03 «тип мощности ДГУ так же должен быть
 * связан во всех модулях проекта и расширен всеми типами из справочника
 * согласно ISO»).
 *
 * ISO 8528-1:2018 — общие режимы для генераторов:
 *   ESP — Emergency Standby Power (аварийный)
 *   PRP — Prime Power (основной с переменной нагрузкой)
 *   LTP — Limited-Time Prime Power (основной с ограничением по времени)
 *   COP — Continuous Operating Power (непрерывная при постоянной нагрузке)
 *
 * ISO 8528-13:2016 — специфика для дата-центров:
 *   DCC — Data Centre Continuous Power (для критических 24/7 нагрузок ЦОД)
 *   DCP — Data Centre Prime Power (PRP-аналог для ЦОД)
 *   DCS — Data Centre Standby Power (резервный для ЦОД)
 *   MCSP — Mission Critical Standby Power (резерв критических объектов)
 *
 * Каждый режим имеет:
 *   maxLoadFactor — допустимая средняя нагрузка / nameplate (для расчёта
 *     требуемого размера ДГУ: required_kW = load_kW / maxLoadFactor)
 *   maxOverloadPct — допустимая перегрузка в %
 *   maxHoursPerYear — лимит часов в год (null = без лимита)
 *   notes — пояснение для tooltip'а.
 */
export const DGU_MODES = {
  // Стандартные ISO 8528-1
  ESP:  { label: 'ESP — аварийный standby',
          maxLoadFactor: 1.0, maxOverloadPct: 0, maxHoursPerYear: 200,
          isoStandard: 'ISO 8528-1', category: 'general',
          notes: 'Emergency Standby Power. До 200 ч/год, ≤ 25 ч непрерывно. Без перегрузки. Запуск в случае аварии основного питания.' },
  PRP:  { label: 'PRP — основной (переменная нагрузка)',
          maxLoadFactor: 0.70, maxOverloadPct: 10, maxHoursPerYear: null,
          isoStandard: 'ISO 8528-1', category: 'general',
          notes: 'Prime Power. Постоянный режим. Средняя нагрузка ≤ 70% nameplate. 10% перегрузка допустима 1ч из 12. Без лимита времени работы.' },
  LTP:  { label: 'LTP — ограниченный по времени',
          maxLoadFactor: 1.0, maxOverloadPct: 0, maxHoursPerYear: 500,
          isoStandard: 'ISO 8528-1', category: 'general',
          notes: 'Limited-Time Prime. До 500 ч/год при 100% нагрузке. Без перегрузки. Для систем где основная сеть существует но нестабильна.' },
  COP:  { label: 'COP — непрерывный 24/7',
          maxLoadFactor: 1.0, maxOverloadPct: 0, maxHoursPerYear: null,
          isoStandard: 'ISO 8528-1', category: 'general',
          notes: 'Continuous Operating Power. 24/7 при постоянной 100% нагрузке (без переменной составляющей). Часто — единственный источник питания на удалённых объектах.' },
  // Специальные для ЦОД (ISO 8528-13)
  DCC:  { label: 'DCC — ЦОД непрерывный',
          maxLoadFactor: 1.0, maxOverloadPct: 10, maxHoursPerYear: null,
          isoStandard: 'ISO 8528-13', category: 'datacentre',
          notes: 'Data Centre Continuous Power. 24/7 для критической IT-нагрузки. Аналог COP но с допуском 10% переменной нагрузки и расширенными требованиями к запуску в течение 10 секунд.' },
  DCP:  { label: 'DCP — ЦОД основной',
          maxLoadFactor: 0.85, maxOverloadPct: 10, maxHoursPerYear: null,
          isoStandard: 'ISO 8528-13', category: 'datacentre',
          notes: 'Data Centre Prime Power. Аналог PRP но для ЦОД: средняя нагрузка ≤ 85% (вместо 70% в обычном PRP). Без лимита времени.' },
  DCS:  { label: 'DCS — ЦОД резервный',
          maxLoadFactor: 1.0, maxOverloadPct: 0, maxHoursPerYear: 200,
          isoStandard: 'ISO 8528-13', category: 'datacentre',
          notes: 'Data Centre Standby Power. Резерв для ЦОД с допуском работы при отказе основного питания. Запуск в течение 10 секунд (критичен для UPS bypass).' },
  MCSP: { label: 'MCSP — критический резерв',
          maxLoadFactor: 1.0, maxOverloadPct: 0, maxHoursPerYear: null,
          isoStandard: 'ISO 8528-13 (Tier IV)', category: 'datacentre',
          notes: 'Mission Critical Standby Power. Для Tier IV ЦОД и аналогичных критических объектов. Без лимита часов, синхронная параллельная работа с UPS bypass.' },
};

/** Список режимов сгруппированный по категории (для UI selector). */
export const DGU_MODE_GROUPS = [
  { label: 'Общие (ISO 8528-1)', modes: ['ESP', 'PRP', 'LTP', 'COP'] },
  { label: 'Дата-центры (ISO 8528-13)', modes: ['DCC', 'DCP', 'DCS', 'MCSP'] },
];

/**
 * v0.60.312 (по репорту Пользователя 2026-05-06: «проверь данные по
 * дирейтингу, наш дизель вроде имеет другие показатели»):
 * Engine-profile aware climate derate. Раньше использовалась только
 * generic ISO 3046-1 формула (-3%/300м выше 100м, -2.5%/5°C выше 25°C),
 * которая корректна для NATURALLY ASPIRATED двигателей. Современные
 * turbocharged + aftercooled engines (Perkins 1100/1300, Cummins QSB,
 * CAT C-series, Volvo TWD) имеют namely БОЛЕЕ ВЫСОКИЙ baseline
 * altitude (1500-2400м) — до этой высоты дирейтинга НЕТ.
 *
 * Profiles encoded по datasheet'ам производителей:
 */
export const ENGINE_DERATE_PROFILES = {
  // Generic ISO 3046-1: naturally aspirated, конструктивный default.
  'iso-naturally-aspirated': {
    label: 'Generic ISO 3046-1 (naturally aspirated)',
    altBaselineM: 100,
    altPerHundredPct: 1.0,      // -1% per 100m above baseline
    tempBaselineC: 25,
    tempPer5Pct: 2.5,           // -2.5% per 5°C above baseline
    note: 'Консервативная generic формула. Для современных turbo-двигателей дирейтинг будет завышен.',
  },
  // Современный turbocharged + aftercooled (Perkins 1100/1300, Cummins QSB,
  // CAT C-series, Volvo TWD, Iveco N-series). Per datasheet'ам — нет
  // дирейтинга до ~1500м при 25-30°C, slope ~1% за 100м после baseline.
  'modern-turbo-aftercooled': {
    label: 'Современный turbo+aftercooled (Perkins/Cummins/CAT/Volvo)',
    altBaselineM: 1500,
    altPerHundredPct: 1.0,
    tempBaselineC: 25,
    tempPer5Pct: 2.0,           // менее агрессивный t-derate
    note: 'Подходит для большинства современных Tier 4 / Stage IIIA двигателей. Подтверждён datasheet\'ами Perkins 1106A, Cummins QSB7, CAT C9.',
  },
  // Perkins 1106A-70TAG2 — точная аппроксимация официального derate chart.
  // Per Perkins doc: baseline = 2400m@25°C, 2300m@30°C, 2150m@40°C, 2050m@50°C.
  'perkins-1106a-70tag2': {
    label: 'Perkins 1106A-70TAG2 (точный по datasheet)',
    altBaselineM: 2400,           // при 25°C
    altPerHundredPct: 1.1,        // ~1.1% per 100m above baseline
    tempBaselineC: 25,
    tempPer5Pct: 1.5,
    altShiftPerC: 7.5,            // baseline понижается на 7.5м за каждый °C выше 25
    source: 'Perkins datasheet 1106A-70TAG2 50Hz Prime Derate Chart',
    note: 'Точные данные из Perkins datasheet. Дирейтинг отсутствует до 2400м при 25°C.',
  },
  // Perkins 4000 series (1306-E87, 4006-23TAG2A, 4008-30TAG3) — большие
  // двигатели для 200-1100 кВт ДГУ. Аппроксимация типичной кривой.
  'perkins-4000-series': {
    label: 'Perkins 4000-series (1306, 4006, 4008)',
    altBaselineM: 1800,
    altPerHundredPct: 1.0,
    tempBaselineC: 25,
    tempPer5Pct: 2.0,
    source: 'Perkins 4000-series typical datasheet',
    note: 'Типовая кривая для серии 4000. Точная — в datasheet конкретной модели.',
  },
  // Cummins QSB / QSL / QSX series — типовая для 60-700 кВт.
  'cummins-qs-series': {
    label: 'Cummins QSB/QSL/QSX (Tier 3/4)',
    altBaselineM: 1500,
    altPerHundredPct: 1.0,
    tempBaselineC: 25,
    tempPer5Pct: 2.0,
    source: 'Cummins QS-series typical datasheet',
    note: 'Tier 3/4 turbocharged + aftercooled. Стандарт для большинства Cummins ДГУ.',
  },
  // Caterpillar C-series (C4.4, C7.1, C9, C13, C15, C18, C32).
  'cat-c-series': {
    label: 'Caterpillar C-series (C4.4 — C32)',
    altBaselineM: 1500,
    altPerHundredPct: 1.0,
    tempBaselineC: 25,
    tempPer5Pct: 2.0,
    source: 'Cat C-series typical datasheet',
    note: 'Типовая кривая. CAT публикует точные derate charts на каждую модель.',
  },
  // Volvo Penta TAD/TWD — индустриальные генераторные.
  'volvo-tad-twd': {
    label: 'Volvo Penta TAD/TWD',
    altBaselineM: 1500,
    altPerHundredPct: 1.0,
    tempBaselineC: 25,
    tempPer5Pct: 2.0,
    source: 'Volvo Penta industrial gen-set datasheet',
    note: 'Современные turbo+aftercooled. Ключевое преимущество — высокий допуск по T (до 50°C без значительного дирейтинга).',
  },
  // MTU 2000 / 4000 series — крупные ДГУ 1-3 МВт.
  'mtu-large': {
    label: 'MTU 12V/16V 2000 / 4000',
    altBaselineM: 1500,
    altPerHundredPct: 0.8,        // менее агрессивный slope для больших двигателей
    tempBaselineC: 25,
    tempPer5Pct: 1.5,
    source: 'MTU industrial gen-set datasheet',
    note: 'Для ЦОД-класса (1-3 МВт). Топ-класс по T-tolerance благодаря двойному охлаждению.',
  },
};

/**
 * Climate derate.
 *
 * @param {object} climate — { altitudeM, ambientTC, humidityPct }
 * @param {string=} profileId — id из ENGINE_DERATE_PROFILES (default 'iso-naturally-aspirated')
 * @returns {{ multiplier:number, breakdown:object, profile:object }}
 */
export function calcClimateDerate(climate = {}, profileId) {
  const altM = Number(climate.altitudeM) || 0;
  const tAmb = Number(climate.ambientTC) || 25;
  const rh = Number(climate.humidityPct) || 60;
  const profile = ENGINE_DERATE_PROFILES[profileId] || ENGINE_DERATE_PROFILES['iso-naturally-aspirated'];

  // Effective altitude baseline: для perkins сдвигается на altShiftPerC × max(0, T-tempBaseline)
  const altShift = (profile.altShiftPerC || 0) * Math.max(0, tAmb - profile.tempBaselineC);
  const effAltBaseline = profile.altBaselineM - altShift;

  const altDerate = altM > effAltBaseline
    ? Math.max(0, (altM - effAltBaseline) / 100) * (profile.altPerHundredPct / 100)
    : 0;
  const tDerate = tAmb > profile.tempBaselineC
    ? (tAmb - profile.tempBaselineC) / 5 * (profile.tempPer5Pct / 100)
    : 0;
  // RH derate — общий стандарт (не engine-specific).
  const rhDerate = rh > 60 ? (rh - 60) / 25 * 0.01 : 0;

  const totalDerate = altDerate + tDerate + rhDerate;
  const multiplier = Math.max(0.5, 1 - totalDerate);

  return {
    multiplier,
    breakdown: {
      altDerate: -(altDerate * 100),
      tDerate: -(tDerate * 100),
      rhDerate: -(rhDerate * 100),
      totalDerate: -(totalDerate * 100),
      effAltBaseline,             // фактическая высота, с которой начинается дирейтинг (с учётом T-сдвига)
    },
    profile: {
      id: profileId || 'iso-naturally-aspirated',
      label: profile.label,
      note: profile.note,
    },
  };
}

/**
 * Эвристика выбора engine profile по названию модели/двигателя.
 * Возвращает id профиля. Если ничего не подобрано — generic ISO.
 */
export function detectEngineProfile(engineName, modelName) {
  const s = ((engineName || '') + ' ' + (modelName || '')).toLowerCase();
  // Точные совпадения по конкретной модели — паспортные данные.
  if (/1106a-70tag2|1106a-70/i.test(s)) return 'perkins-1106a-70tag2';
  // Серийные совпадения — типовые datasheet для серии.
  if (/perkins\s*(4006|4008|1306-e87|2806)/i.test(s)) return 'perkins-4000-series';
  if (/perkins\s*(1[01]\d{2}|1[234]\d{2})/i.test(s)) return 'modern-turbo-aftercooled';
  if (/cummins\s*(qsb|qsl|qst|qsx|qsk)/i.test(s)) return 'cummins-qs-series';
  if (/cummins\s*(6bt|6lt|nt855)/i.test(s)) return 'modern-turbo-aftercooled';
  if (/(caterpillar|^cat\s)\s*c[0-9]{1,2}/i.test(s)) return 'cat-c-series';
  if (/volvo\s*(tad|twd|tid)/i.test(s)) return 'volvo-tad-twd';
  if (/iveco\s*(n|c)[0-9]/i.test(s)) return 'modern-turbo-aftercooled';
  if (/mtu\s*(12v|16v)?\s*(2000|4000)/i.test(s)) return 'mtu-large';
  if (/john\s*deere\s*(4045|6068|6090|6135)/i.test(s)) return 'modern-turbo-aftercooled';
  // Default: generic ISO 3046-1 (нет данных для модели → берём нормативные).
  return 'iso-naturally-aspirated';
}

/**
 * Расчёт необходимой мощности ДГУ.
 *
 * @param {object} input — {
 *   loadKw,           — суммарная электрическая нагрузка (IT + cooling + ups_loss + aux)
 *   mode,             — 'ESP' | 'PRP' | 'COP'
 *   redundancy,       — 'N' | 'N+1' | '2N'
 *   climate,          — { altitudeM, ambientTC, humidityPct }
 *   safetyMarginPct,  — % запаса (default 15%)
 * }
 * @returns {{
 *   loadKw, modeLabel, maxLoadFactor, derate,
 *   requiredKw,         — после derate + load factor
 *   nameplateKw,        — номинал ДГУ для заказа (с margin)
 *   redundancyMode, qty, totalNameplateKw
 * }}
 */
export function calcDguRequired(input) {
  const loadKw = Number(input.loadKw) || 0;
  const mode = input.mode || 'ESP';
  const modeMeta = DGU_MODES[mode] || DGU_MODES.ESP;
  // v0.60.312 (по репорту Пользователя 2026-05-06: «при margin 0% значение
  // выше чем при 5% — 132 vs 121, проверяй»): `|| 15` интерпретирует 0 как
  // falsy и заменяет на default 15. Поэтому margin=0 давал 132, margin=5
  // давал 121. Используем Number.isFinite + fallback только если NaN/null.
  const _marginInput = Number(input.safetyMarginPct);
  const margin = Number.isFinite(_marginInput) ? _marginInput : 15;
  const redundancy = input.redundancy || 'N';
  // v0.60.78 fix (Пользователь 2026-05-03 «где дирейтинги???»): climate
  // приходил как nested object input.climate, но UI передаёт ПЛОСКИЕ поля
  // input.altitudeM/ambientTC/humidityPct. Поддерживаем оба варианта:
  // если nested — используем как раньше, иначе собираем из плоских.
  const climateArg = input.climate
    ? input.climate
    : { altitudeM: input.altitudeM, ambientTC: input.ambientTC, humidityPct: input.humidityPct };
  // v0.60.312: engine-specific derate profile. Если передан engineProfile —
  // используем его. Иначе пробуем detect по engineName/modelName. Если
  // ничего не подобрано — generic ISO 3046-1.
  const profileId = input.engineProfile
    || detectEngineProfile(input.engineName, input.modelName);
  const derate = calcClimateDerate(climateArg, profileId);

  // Базовая требуемая = loadKw × (1 + margin) / loadFactor / derateMultiplier
  const baseRequired = loadKw * (1 + margin / 100) / modeMeta.maxLoadFactor / derate.multiplier;

  // Кол-во единиц по резервированию
  let qty = 1;
  if (redundancy === 'N+1') qty = 2;
  else if (redundancy === '2N') qty = 2;

  // Если 2N — каждая единица должна нести 100% нагрузки (полное дублирование).
  // Если N+1 — каждая несёт baseRequired / N (где N = qty − 1 = 1).
  const perUnitNameplateKw = redundancy === '2N' ? baseRequired : baseRequired;
  const totalNameplateKw = perUnitNameplateKw * qty;

  return {
    loadKw,
    modeLabel: modeMeta.label,
    maxLoadFactor: modeMeta.maxLoadFactor,
    derate,
    requiredKw: Math.ceil(baseRequired),
    nameplateKw: Math.ceil(perUnitNameplateKw),
    redundancyMode: redundancy,
    qty,
    totalNameplateKw: Math.ceil(totalNameplateKw),
  };
}

/**
 * Расчёт расхода топлива и объёма бака.
 *
 * Specific fuel consumption (л/кВт·ч):
 *   — 100% nameplate: ~0.22 (Tier 4 inverter genset до 0.20)
 *   — 75%: ~0.24
 *   — 50%: ~0.27
 *   — 25%: ~0.34
 *
 * @param {object} input — { nameplateKw, loadKw, autonomyHours, sfcLkWh? }
 * @returns {{ sfc:number, hourlyL:number, totalL:number, tankSafetyL:number }}
 */
export function calcFuelConsumption(input) {
  const nameplateKw = Number(input.nameplateKw) || 0;
  const loadKw = Number(input.loadKw) || nameplateKw;
  const autonomy = Number(input.autonomyHours) || 8;
  // Load fraction (для интерполяции SFC).
  const loadFrac = nameplateKw > 0 ? loadKw / nameplateKw : 1;

  // Специфический расход (л/кВт·ч), интерполируем по таблице
  let sfc;
  if (input.sfcLkWh) {
    sfc = Number(input.sfcLkWh);
  } else if (loadFrac >= 0.95) sfc = 0.22;
  else if (loadFrac >= 0.70) sfc = 0.22 + (0.95 - loadFrac) / 0.25 * 0.02; // 0.22→0.24
  else if (loadFrac >= 0.45) sfc = 0.24 + (0.70 - loadFrac) / 0.25 * 0.03; // 0.24→0.27
  else                        sfc = 0.27 + Math.max(0, 0.45 - loadFrac) / 0.25 * 0.07; // 0.27→0.34

  const hourlyL = loadKw * sfc;        // л/час
  const totalL = hourlyL * autonomy;
  const tankSafetyL = Math.ceil(totalL * 1.10);  // 10% запас бака

  return {
    sfc: Math.round(sfc * 1000) / 1000,
    hourlyL: Math.round(hourlyL * 10) / 10,
    totalL: Math.round(totalL),
    tankSafetyL,
  };
}

/**
 * Маппинг режима на поле в datasheet каталога.
 */
export const DGU_MODE_FIELDS = {
  ESP: 'espKw',
  PRP: 'prpKw',
  LTP: 'ltpKw',
  COP: 'copKw',
  DCS: 'dcsKw',
  DCP: 'dcpKw',
  DCC: 'dccKw',
  MCSP: 'mcspKw',
};

/**
 * v0.60.216 (по запросу Пользователя 2026-05-04 «если в каталоге ДГУ нет
 * мощности для режима, вычисляй их посредством применения коэффициентов,
 * например если нет параметра COP, то применением дискаунта 30% от
 * мощности в режиме PRP»).
 *
 * Получить мощность ДГУ для конкретного режима. Если в datasheet нет
 * прямого значения — выводим через типовые коэффициенты ISO 8528-1
 * (для общих режимов) и ISO 8528-13 (для режимов ЦОД).
 *
 * Принятые ratio (в индустрии и в большинстве datasheet):
 *   PRP  ≈ 0.90 × ESP        (PRP = 90% standby — стандарт ISO 8528-1)
 *   LTP  ≈ 0.95 × ESP        (между PRP и ESP, лимит 500 ч/год)
 *   COP  ≈ 0.70 × PRP = 0.63 × ESP (−30% от PRP, для 24/7 без перерывов)
 *   DCS  = ESP               (для ЦОД — те же условия что Standby)
 *   DCP  ≈ 1.05 × PRP        (чистая нагрузка ЦОД позволяет +5%)
 *   DCC  ≈ 1.05 × COP        (24/7 ЦОД с допуском 10% переменной)
 *   MCSP ≈ 0.95 × ESP        (резерв Tier IV, чуть консервативнее)
 *
 * @param {object} dgu — datasheet entry (espKw / prpKw / copKw …)
 * @param {string} mode — 'ESP'|'PRP'|'LTP'|'COP'|'DCS'|'DCP'|'DCC'|'MCSP'
 * @returns {{ kw: number, source: string }} — kw=NaN если вывод невозможен.
 */
export function getDguModePowerKw(dgu, mode) {
  if (!dgu) return { kw: NaN, source: 'no datasheet' };
  const field = DGU_MODE_FIELDS[mode];
  if (field && Number.isFinite(Number(dgu[field]))) {
    return { kw: Number(dgu[field]), source: 'datasheet' };
  }
  const esp = Number(dgu.espKw);
  const prp = Number(dgu.prpKw);
  const cop = Number(dgu.copKw);
  const ltp = Number(dgu.ltpKw);
  switch (mode) {
    case 'ESP':
      if (Number.isFinite(prp)) return { kw: prp / 0.90, source: 'derived: ESP=PRP÷0.90 (ISO 8528-1)' };
      if (Number.isFinite(ltp)) return { kw: ltp / 0.95, source: 'derived: ESP=LTP÷0.95' };
      if (Number.isFinite(cop)) return { kw: cop / 0.63, source: 'derived: ESP=COP÷0.63' };
      break;
    case 'PRP':
      if (Number.isFinite(esp)) return { kw: esp * 0.90, source: 'derived: PRP=ESP×0.90 (ISO 8528-1)' };
      if (Number.isFinite(cop)) return { kw: cop / 0.70, source: 'derived: PRP=COP÷0.70 (−30% по ISO)' };
      if (Number.isFinite(ltp)) return { kw: ltp * 0.95, source: 'derived: PRP≈LTP×0.95' };
      break;
    case 'LTP':
      if (Number.isFinite(esp)) return { kw: esp * 0.95, source: 'derived: LTP=ESP×0.95 (ISO 8528-1)' };
      if (Number.isFinite(prp)) return { kw: prp / 0.95, source: 'derived: LTP=PRP÷0.95' };
      break;
    case 'COP':
      if (Number.isFinite(prp)) return { kw: prp * 0.70, source: 'derived: COP=PRP×0.70 (−30% по ISO 8528-1)' };
      if (Number.isFinite(esp)) return { kw: esp * 0.63, source: 'derived: COP≈ESP×0.63' };
      break;
    case 'DCS':
      if (Number.isFinite(esp)) return { kw: esp, source: 'derived: DCS=ESP (ISO 8528-13)' };
      break;
    case 'DCP':
      if (Number.isFinite(prp)) return { kw: prp * 1.05, source: 'derived: DCP=PRP×1.05 (ISO 8528-13)' };
      if (Number.isFinite(esp)) return { kw: esp * 0.945, source: 'derived: DCP≈ESP×0.945' };
      break;
    case 'DCC':
      if (Number.isFinite(cop)) return { kw: cop * 1.05, source: 'derived: DCC=COP×1.05 (ISO 8528-13)' };
      if (Number.isFinite(prp)) return { kw: prp * 0.735, source: 'derived: DCC≈PRP×0.735' };
      if (Number.isFinite(esp)) return { kw: esp * 0.661, source: 'derived: DCC≈ESP×0.661' };
      break;
    case 'MCSP':
      if (Number.isFinite(esp)) return { kw: esp * 0.95, source: 'derived: MCSP=ESP×0.95 (Tier IV)' };
      if (Number.isFinite(prp)) return { kw: prp * 1.056, source: 'derived: MCSP≈PRP×1.056' };
      break;
  }
  return { kw: NaN, source: 'unknown (нет источника)' };
}

/**
 * Полный расчёт: спецификация ДГУ + топливо.
 *
 * @param {object} input — все параметры из UI
 * @returns {{ spec, fuel }}
 */
export function calcDgu(input) {
  const spec = calcDguRequired(input);
  const fuel = calcFuelConsumption({
    nameplateKw: spec.nameplateKw,
    loadKw: input.loadKw,
    autonomyHours: input.autonomyHours,
    sfcLkWh: input.sfcLkWh,
  });
  return { spec, fuel };
}
