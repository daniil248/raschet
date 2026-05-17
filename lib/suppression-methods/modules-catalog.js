/* =========================================================================
   suppression-methods/modules-catalog.js — типовые размеры модулей
   газового пожаротушения (МГП). Каталог обобщённый — без привязки к
   конкретным производителям и моделям: группировка по семействам
   (галогеноуглеводороды / инертные / CO₂) и рабочему давлению, внутри
   — типоразмеры по объёму баллона.

   Параметры модификации:
     ob       — объём баллона, л
     kz_max   — максимальный коэффициент загрузки, кг/л
     mb       — остаток ГОТВ в модуле, кг
     pmin_atm — минимальное давление перед насадками, атм
     DN       — выпускной штуцер, мм
     H, D     — габариты (высота/диаметр), мм — справочно
   ========================================================================= */

/** Каждая серия — набор типоразмеров по объёму. */
export const MODULE_SERIES = {
  'halocarbon-42bar': {
    label: 'Модуль галогенуглеродный · 42 бар',
    family: 'halocarbon',
    pressure_bar: 42,
    note: 'Для хладонов (HFC-227ea, HFC-125, HFC-23) и Novec 1230. Вытеснитель — азот.',
    variants: [
      { code: 'HAL-42-20',  ob: 20,  kz_max: 1.20, mb: 0.2, pmin_atm: 6, DN: 32, H: 700,  D: 219 },
      { code: 'HAL-42-40',  ob: 40,  kz_max: 1.20, mb: 0.3, pmin_atm: 6, DN: 40, H: 900,  D: 245 },
      { code: 'HAL-42-60',  ob: 60,  kz_max: 1.20, mb: 0.4, pmin_atm: 6, DN: 40, H: 1180, D: 279 },
      { code: 'HAL-42-80',  ob: 80,  kz_max: 1.20, mb: 0.5, pmin_atm: 6, DN: 50, H: 1280, D: 305 },
      { code: 'HAL-42-100', ob: 100, kz_max: 1.20, mb: 0.6, pmin_atm: 6, DN: 50, H: 1480, D: 325 },
      { code: 'HAL-42-140', ob: 140, kz_max: 1.20, mb: 0.8, pmin_atm: 6, DN: 50, H: 1680, D: 356 },
      { code: 'HAL-42-180', ob: 180, kz_max: 1.20, mb: 1.0, pmin_atm: 6, DN: 80, H: 1860, D: 406 },
    ],
  },
  'halocarbon-65bar': {
    label: 'Модуль галогенуглеродный · 65 бар',
    family: 'halocarbon',
    pressure_bar: 65,
    note: 'Повышенное рабочее давление для протяжённых трубопроводов.',
    variants: [
      { code: 'HAL-65-25',  ob: 25,  kz_max: 1.20, mb: 0.2, pmin_atm: 8, DN: 32, H: 760,  D: 219 },
      { code: 'HAL-65-40',  ob: 40,  kz_max: 1.20, mb: 0.3, pmin_atm: 8, DN: 40, H: 900,  D: 245 },
      { code: 'HAL-65-60',  ob: 60,  kz_max: 1.20, mb: 0.4, pmin_atm: 8, DN: 50, H: 1180, D: 279 },
      { code: 'HAL-65-100', ob: 100, kz_max: 1.20, mb: 0.6, pmin_atm: 8, DN: 50, H: 1480, D: 325 },
      { code: 'HAL-65-140', ob: 140, kz_max: 1.20, mb: 0.8, pmin_atm: 8, DN: 50, H: 1680, D: 356 },
    ],
  },
  'inert-200bar': {
    label: 'Модуль инертный · 200 бар',
    family: 'inert',
    pressure_bar: 200,
    note: 'Для инертных газов (IG-541 / IG-55 / IG-100 / IG-01). Хранение в газовой фазе.',
    variants: [
      { code: 'INE-200-67',  ob: 67,  kz_max: 0.0, mb: 0.0, pmin_atm: 18, DN: 40, H: 1500, D: 229 },
      { code: 'INE-200-80',  ob: 80,  kz_max: 0.0, mb: 0.0, pmin_atm: 18, DN: 50, H: 1500, D: 267 },
      { code: 'INE-200-140', ob: 140, kz_max: 0.0, mb: 0.0, pmin_atm: 18, DN: 65, H: 1800, D: 325 },
    ],
  },
  'inert-300bar': {
    label: 'Модуль инертный · 300 бар',
    family: 'inert',
    pressure_bar: 300,
    note: 'Повышенное давление — меньше баллонов на тот же объём газа.',
    variants: [
      { code: 'INE-300-80',  ob: 80,  kz_max: 0.0, mb: 0.0, pmin_atm: 20, DN: 50, H: 1500, D: 267 },
      { code: 'INE-300-140', ob: 140, kz_max: 0.0, mb: 0.0, pmin_atm: 20, DN: 65, H: 1800, D: 325 },
    ],
  },
  'co2-hp': {
    label: 'Модуль CO₂ высокого давления',
    family: 'co2',
    pressure_bar: 150,
    note: 'Углекислотная установка высокого давления, хранение при температуре окружающей среды.',
    variants: [
      { code: 'CO2-HP-40',  ob: 40,  kz_max: 0.75, mb: 0.0, pmin_atm: 10, DN: 32, H: 1200, D: 229 },
      { code: 'CO2-HP-80',  ob: 80,  kz_max: 0.75, mb: 0.0, pmin_atm: 10, DN: 50, H: 1500, D: 267 },
    ],
  },
  'co2-lp': {
    label: 'Модуль CO₂ низкого давления (изотермический)',
    family: 'co2',
    pressure_bar: 22,
    note: 'Изотермический резервуар для жидкой углекислоты с холодильной установкой.',
    variants: [
      { code: 'CO2-LP-3200', ob: 3200, kz_max: 0.75, mb: 0.0, pmin_atm: 15, DN: 50, H: 4500, D: 1200 },
      { code: 'CO2-LP-6000', ob: 6000, kz_max: 0.75, mb: 0.0, pmin_atm: 15, DN: 65, H: 5000, D: 1600 },
    ],
  },
};

/** Плоский список модификаций серии. */
export function listVariants(seriesId) {
  const s = MODULE_SERIES[seriesId];
  return s ? s.variants.map(v => ({ ...v, series: seriesId, family: s.family, pressure_bar: s.pressure_bar })) : [];
}

export function findVariant(code) {
  for (const [sid, s] of Object.entries(MODULE_SERIES)) {
    const v = s.variants.find(x => x.code === code);
    if (v) return { ...v, series: sid, family: s.family, pressure_bar: s.pressure_bar };
  }
  return null;
}

export const SERIES_LIST = Object.entries(MODULE_SERIES).map(([id, s]) => ({
  id, label: s.label, family: s.family, pressure_bar: s.pressure_bar, note: s.note,
}));
