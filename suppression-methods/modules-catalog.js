/* =========================================================================
   suppression-methods/modules-catalog.js — каталог модулей газового
   пожаротушения (МГП). Наименования, типоразмеры, объём, макс.
   загрузка (kz), остаток ГОТВ в модуле (mb), минимальное давление
   перед насадками (pmin, атм), диаметр выпускного штуцера (DN).

   ПРИМЕЧАНИЕ: наименования и численные значения — иллюстративные,
   взяты по открытым паспортам производителей (Артсок, Бранд-Инвест,
   Эпотос, Источник Плюс и др.). Перед производственным применением
   проверять по актуальной тех. документации производителя.
   ========================================================================= */

/** Каждая серия = список модификаций.
 *  Модификация: { code, ob (л), kz_max, mb, pmin_atm, DN, P_bar, agents:['HFC-227ea',...], mass_empty, H, D }
 */
export const MODULE_SERIES = {
  'МГП-ИМПЕРАТОР': {
    manufacturer: 'Пожтехника',
    family: 'halocarbon',
    pressure_bar: 42,
    note: 'Газ-вытеснитель: азот. Для хладонов 227ea/125/23 и Novec 1230.',
    variants: [
      { code: 'МГП-ИМПЕРАТОР(65-40-50)',  ob: 40,  kz_max: 1.20, mb: 0.3, pmin_atm: 6, DN: 50, H: 890,  D: 255 },
      { code: 'МГП-ИМПЕРАТОР(65-60-50)',  ob: 60,  kz_max: 1.20, mb: 0.4, pmin_atm: 6, DN: 50, H: 1190, D: 255 },
      { code: 'МГП-ИМПЕРАТОР(65-100-50)', ob: 100, kz_max: 1.20, mb: 0.6, pmin_atm: 6, DN: 50, H: 1490, D: 315 },
      { code: 'МГП-ИМПЕРАТОР(65-140-50)', ob: 140, kz_max: 1.20, mb: 0.8, pmin_atm: 6, DN: 50, H: 1690, D: 355 },
      { code: 'МГП-ИМПЕРАТОР(65-180-80)', ob: 180, kz_max: 1.20, mb: 1.0, pmin_atm: 6, DN: 80, H: 1880, D: 406 },
    ],
  },
  'МПТХ2': {
    manufacturer: 'Эпотос',
    family: 'halocarbon',
    pressure_bar: 42,
    note: 'Модули пожаротушения тонкораспылённым хладоном, серия 2.',
    variants: [
      { code: 'МПТХ2(65-20-32)',  ob: 20,  kz_max: 1.15, mb: 0.2, pmin_atm: 6, DN: 32, H: 700,  D: 219 },
      { code: 'МПТХ2(65-40-32)',  ob: 40,  kz_max: 1.15, mb: 0.3, pmin_atm: 6, DN: 32, H: 900,  D: 245 },
      { code: 'МПТХ2(65-80-40)',  ob: 80,  kz_max: 1.15, mb: 0.5, pmin_atm: 6, DN: 40, H: 1290, D: 310 },
      { code: 'МПТХ2(65-120-50)', ob: 120, kz_max: 1.15, mb: 0.7, pmin_atm: 6, DN: 50, H: 1550, D: 355 },
    ],
  },
  'МПТУ-150': {
    manufacturer: 'Артсок',
    family: 'halocarbon',
    pressure_bar: 65,
    note: 'Модуль пожаротушения универсальный 150 бар.',
    variants: [
      { code: 'МПТУ-150-50-12',  ob: 50,  kz_max: 1.10, mb: 0.4, pmin_atm: 8, DN: 40, H: 1200, D: 260 },
      { code: 'МПТУ-150-100-12', ob: 100, kz_max: 1.10, mb: 0.6, pmin_atm: 8, DN: 50, H: 1500, D: 325 },
    ],
  },
  'МГП-Консул': {
    manufacturer: 'НПФ Консул',
    family: 'halocarbon',
    pressure_bar: 65,
    note: 'Серия модулей Консул, газ-вытеснитель азот, рабочее 65 бар.',
    variants: [
      { code: 'МГП-Консул-65-25-50',   ob: 25,  kz_max: 1.20, mb: 0.2, pmin_atm: 6, DN: 50, H: 760,  D: 219 },
      { code: 'МГП-Консул-65-40-50',   ob: 40,  kz_max: 1.20, mb: 0.3, pmin_atm: 6, DN: 50, H: 900,  D: 245 },
      { code: 'МГП-Консул-65-60-50',   ob: 60,  kz_max: 1.20, mb: 0.4, pmin_atm: 6, DN: 50, H: 1180, D: 279 },
      { code: 'МГП-Консул-65-80-50',   ob: 80,  kz_max: 1.20, mb: 0.5, pmin_atm: 6, DN: 50, H: 1280, D: 305 },
      { code: 'МГП-Консул-65-100-50',  ob: 100, kz_max: 1.20, mb: 0.6, pmin_atm: 6, DN: 50, H: 1480, D: 325 },
      { code: 'МГП-Консул-65-140-50',  ob: 140, kz_max: 1.20, mb: 0.8, pmin_atm: 6, DN: 50, H: 1680, D: 356 },
      { code: 'МГП-Консул-65-180-80',  ob: 180, kz_max: 1.20, mb: 1.0, pmin_atm: 6, DN: 80, H: 1860, D: 406 },
    ],
  },
  'МГП-2': {
    manufacturer: 'Бранд-Инвест',
    family: 'halocarbon',
    pressure_bar: 42,
    note: 'Серия МГП-2.',
    variants: [
      { code: 'МГП-2-80',  ob: 80,  kz_max: 1.10, mb: 0.5, pmin_atm: 6, DN: 40, H: 1290, D: 299 },
      { code: 'МГП-2-100', ob: 100, kz_max: 1.10, mb: 0.6, pmin_atm: 6, DN: 50, H: 1490, D: 325 },
    ],
  },
  'МИЖУ': {
    manufacturer: 'Пожтехника',
    family: 'inert',
    pressure_bar: 300,
    note: 'Модуль изотермический для жидкой углекислоты (CO2 низкого давления).',
    variants: [
      { code: 'МИЖУ-3.2',  ob: 3200,  kz_max: 0.75, mb: 0.0, pmin_atm: 15, DN: 50, H: 4500, D: 1200 },
      { code: 'МИЖУ-6.0',  ob: 6000,  kz_max: 0.75, mb: 0.0, pmin_atm: 15, DN: 65, H: 5000, D: 1600 },
    ],
  },
  'Inert-80L-300': {
    manufacturer: 'Generic',
    family: 'inert',
    pressure_bar: 300,
    note: 'Универсальный баллон 80 л, 300 бар — для IG-541/IG-55/IG-100/IG-01.',
    variants: [
      { code: '80L-300bar',  ob: 80,  kz_max: 0.0, mb: 0.0, pmin_atm: 20, DN: 50, P_bar: 300, H: 1500, D: 267 },
      { code: '140L-300bar', ob: 140, kz_max: 0.0, mb: 0.0, pmin_atm: 20, DN: 65, P_bar: 300, H: 1800, D: 325 },
    ],
  },
};

/** Плоский список кодов для select */
export function listVariants(seriesId) {
  const s = MODULE_SERIES[seriesId];
  return s ? s.variants.map(v => ({ ...v, series: seriesId, family: s.family })) : [];
}

export function findVariant(code) {
  for (const [sid, s] of Object.entries(MODULE_SERIES)) {
    const v = s.variants.find(x => x.code === code);
    if (v) return { ...v, series: sid, family: s.family, pressure_bar: s.pressure_bar };
  }
  return null;
}

export const SERIES_LIST = Object.entries(MODULE_SERIES).map(([id, s]) => ({
  id, manufacturer: s.manufacturer, family: s.family, pressure_bar: s.pressure_bar, note: s.note,
}));
