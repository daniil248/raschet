// meteo/stations/wmo-list.js — v0.59.898
// Базовый каталог метеостанций (WMO/ICAO) для удобного выбора локации.
// Источник: open data из OurAirports (https://ourairports.com/data/, public domain),
// дополнено крупными городами СНГ. Координаты — округлены до 0.001°.
//
// Расширение: добавляйте записи свободно. Для локаций без ICAO — оставьте id пустым.

export const STATIONS = [
  // ========== Казахстан (с дублями: аэропорт + город там, где WMO sync station есть) ==========
  { id: 'UAAA', wmo: '36974', name: 'Алматы (Аэропорт)', country: 'KZ', region: 'Алматы', lat: 43.352, lon: 77.040, elev: 681 },
  { wmo: '36870',           name: 'Алматы (Город)',     country: 'KZ', region: 'Алматы', lat: 43.236, lon: 76.945, elev: 850 },
  { id: 'UACC', wmo: '35188', name: 'Астана',             country: 'KZ', region: 'Астана', lat: 51.022, lon: 71.467, elev: 355 },
  { id: 'UACK', wmo: '35394', name: 'Караганда',          country: 'KZ', region: 'Караганда', lat: 49.671, lon: 73.334, elev: 526 },
  { id: 'UATT', wmo: '35108', name: 'Актобе',             country: 'KZ', region: 'Актобе', lat: 50.246, lon: 57.207, elev: 226 },
  { id: 'UATE', wmo: '35700', name: 'Атырау',             country: 'KZ', region: 'Атырау', lat: 47.121, lon: 51.821, elev: -22 },
  { id: 'UAOO', wmo: '38198', name: 'Кызылорда',          country: 'KZ', region: 'Кызылорда', lat: 44.706, lon: 65.592, elev: 132 },
  { id: 'UASS', wmo: '36177', name: 'Усть-Каменогорск',   country: 'KZ', region: 'ВКО', lat: 50.036, lon: 82.494, elev: 286 },
  { id: 'UAII', wmo: '38328', name: 'Шымкент (Аэропорт)',  country: 'KZ', region: 'Туркестан', lat: 42.364, lon: 69.479, elev: 411 },
  { wmo: '38457',              name: 'Шымкент (Город)',    country: 'KZ', region: 'Туркестан', lat: 42.317, lon: 69.583, elev: 506 },
  { id: 'UATG', wmo: '35085', name: 'Уральск',            country: 'KZ', region: 'ЗКО', lat: 51.151, lon: 51.543, elev: 38 },
  { id: 'UAKD',              name: 'Жезказган',          country: 'KZ', region: 'Улытау', lat: 47.708, lon: 67.733, elev: 380 },
  { id: 'UAUU', wmo: '28952', name: 'Костанай',           country: 'KZ', region: 'Костанай', lat: 53.207, lon: 63.551, elev: 168 },
  { id: 'UAOL',              name: 'Кокшетау',           country: 'KZ', region: 'Акмолинская', lat: 53.329, lon: 69.595, elev: 274 },
  { id: 'UASP', wmo: '36003', name: 'Павлодар',           country: 'KZ', region: 'Павлодар', lat: 52.195, lon: 77.074, elev: 124 },
  { id: 'UASB',              name: 'Балхаш',             country: 'KZ', region: 'Карагандинская', lat: 46.894, lon: 75.005, elev: 450 },
  { id: 'UATR', wmo: '36177', name: 'Семей',              country: 'KZ', region: 'ВКО', lat: 50.351, lon: 80.234, elev: 200 },
  { id: 'UATA', wmo: '38001', name: 'Актау',              country: 'KZ', region: 'Мангистау', lat: 43.860, lon: 51.092, elev: 22 },
  { id: 'UAOH',              name: 'Тараз',              country: 'KZ', region: 'Жамбылская', lat: 42.853, lon: 71.303, elev: 654 },
  { id: 'UAKK',              name: 'Темиртау',           country: 'KZ', region: 'Карагандинская', lat: 50.058, lon: 72.953, elev: 460 },
  { wmo: '36859',            name: 'Талдыкорган',        country: 'KZ', region: 'Алматинская', lat: 45.018, lon: 78.387, elev: 602 },
  { wmo: '36096',            name: 'Петропавловск',      country: 'KZ', region: 'СКО', lat: 54.875, lon: 69.156, elev: 138 },
  { wmo: '38062',            name: 'Туркестан',          country: 'KZ', region: 'Туркестанская', lat: 43.279, lon: 68.234, elev: 207 },

  // ========== Россия (крупнейшие) ==========
  { id: 'UUEE', name: 'Москва (Шереметьево)', country: 'RU', region: 'Московская', lat: 55.973, lon: 37.415, elev: 192 },
  { id: 'UUDD', name: 'Москва (Домодедово)', country: 'RU', region: 'Московская', lat: 55.408, lon: 37.906, elev: 179 },
  { id: 'ULLI', name: 'Санкт-Петербург', country: 'RU', region: 'СПб', lat: 59.800, lon: 30.262, elev: 24 },
  { id: 'UWGG', name: 'Нижний Новгород', country: 'RU', region: 'НиНов', lat: 56.230, lon: 43.784, elev: 78 },
  { id: 'UWKD', name: 'Казань', country: 'RU', region: 'Татарстан', lat: 55.606, lon: 49.279, elev: 116 },
  { id: 'UWUU', name: 'Уфа', country: 'RU', region: 'Башкортостан', lat: 54.557, lon: 55.874, elev: 137 },
  { id: 'UWWW', name: 'Самара', country: 'RU', region: 'Самарская', lat: 53.504, lon: 50.164, elev: 145 },
  { id: 'UWOO', name: 'Оренбург', country: 'RU', region: 'Оренбургская', lat: 51.795, lon: 55.456, elev: 117 },
  { id: 'USSS', name: 'Екатеринбург', country: 'RU', region: 'Свердловская', lat: 56.743, lon: 60.803, elev: 233 },
  { id: 'USNN', name: 'Сургут', country: 'RU', region: 'ХМАО', lat: 61.343, lon: 73.402, elev: 56 },
  { id: 'USCC', name: 'Челябинск', country: 'RU', region: 'Челябинская', lat: 55.305, lon: 61.503, elev: 235 },
  { id: 'USTR', name: 'Тюмень', country: 'RU', region: 'Тюменская', lat: 57.190, lon: 65.324, elev: 61 },
  { id: 'UNOO', name: 'Омск', country: 'RU', region: 'Омская', lat: 54.967, lon: 73.310, elev: 95 },
  { id: 'UNNT', name: 'Новосибирск', country: 'RU', region: 'НСО', lat: 55.012, lon: 82.651, elev: 113 },
  { id: 'UNKL', name: 'Красноярск', country: 'RU', region: 'Красноярский', lat: 56.173, lon: 92.493, elev: 287 },
  { id: 'UIII', name: 'Иркутск', country: 'RU', region: 'Иркутская', lat: 52.268, lon: 104.389, elev: 513 },
  { id: 'UHWW', name: 'Владивосток', country: 'RU', region: 'Приморский', lat: 43.399, lon: 132.148, elev: 12 },
  { id: 'UHHH', name: 'Хабаровск', country: 'RU', region: 'Хабаровский', lat: 48.526, lon: 135.188, elev: 75 },
  { id: 'URRR', name: 'Ростов-на-Дону', country: 'RU', region: 'Ростовская', lat: 47.493, lon: 39.924, elev: 86 },
  { id: 'URKK', name: 'Краснодар', country: 'RU', region: 'Краснодарский', lat: 45.034, lon: 39.171, elev: 36 },
  { id: 'URSS', name: 'Сочи', country: 'RU', region: 'Краснодарский', lat: 43.449, lon: 39.957, elev: 26 },
  { id: 'URMM', name: 'Минеральные Воды', country: 'RU', region: 'Ставропольский', lat: 44.225, lon: 43.082, elev: 314 },
  { id: 'ULMM', name: 'Мурманск', country: 'RU', region: 'Мурманская', lat: 68.781, lon: 32.751, elev: 81 },
  { id: 'UEEE', name: 'Якутск', country: 'RU', region: 'Саха', lat: 62.093, lon: 129.771, elev: 100 },

  // ========== Беларусь / Украина / Молдова ==========
  { id: 'UMMS', name: 'Минск', country: 'BY', region: '', lat: 53.882, lon: 28.030, elev: 204 },
  { id: 'UKBB', name: 'Киев (Борисполь)', country: 'UA', region: '', lat: 50.345, lon: 30.894, elev: 130 },
  { id: 'UKHH', name: 'Харьков', country: 'UA', region: '', lat: 49.925, lon: 36.290, elev: 155 },
  { id: 'UKDD', name: 'Днепр', country: 'UA', region: '', lat: 48.357, lon: 35.100, elev: 148 },
  { id: 'UKOO', name: 'Одесса', country: 'UA', region: '', lat: 46.427, lon: 30.676, elev: 52 },
  { id: 'LUKK', name: 'Кишинёв', country: 'MD', region: '', lat: 46.928, lon: 28.931, elev: 122 },

  // ========== Узбекистан / Кыргызстан / Таджикистан ==========
  { id: 'UTTT', name: 'Ташкент', country: 'UZ', region: '', lat: 41.258, lon: 69.281, elev: 418 },
  { id: 'UTSS', name: 'Самарканд', country: 'UZ', region: '', lat: 39.700, lon: 66.984, elev: 678 },
  { id: 'UTKK', name: 'Фергана', country: 'UZ', region: '', lat: 40.359, lon: 71.745, elev: 605 },
  { id: 'UAFM', name: 'Бишкек', country: 'KG', region: '', lat: 43.061, lon: 74.478, elev: 631 },
  { id: 'UTDD', name: 'Душанбе', country: 'TJ', region: '', lat: 38.543, lon: 68.825, elev: 743 },

  // ========== Грузия / Азербайджан / Армения ==========
  { id: 'UGTB', name: 'Тбилиси', country: 'GE', region: '', lat: 41.669, lon: 44.955, elev: 495 },
  { id: 'UBBB', name: 'Баку', country: 'AZ', region: '', lat: 40.467, lon: 50.047, elev: 3 },
  { id: 'UDYZ', name: 'Ереван', country: 'AM', region: '', lat: 40.147, lon: 44.396, elev: 866 },

  // ========== Европа ==========
  { id: 'EGLL', name: 'Лондон (Хитроу)', country: 'GB', region: '', lat: 51.477, lon: -0.461, elev: 25 },
  { id: 'LFPG', name: 'Париж (Шарль-де-Голль)', country: 'FR', region: '', lat: 49.013, lon: 2.550, elev: 119 },
  { id: 'EDDF', name: 'Франкфурт', country: 'DE', region: '', lat: 50.033, lon: 8.570, elev: 111 },
  { id: 'EDDB', name: 'Берлин (Бранденбург)', country: 'DE', region: '', lat: 52.367, lon: 13.504, elev: 47 },
  { id: 'EDDM', name: 'Мюнхен', country: 'DE', region: '', lat: 48.354, lon: 11.786, elev: 453 },
  { id: 'LSZH', name: 'Цюрих', country: 'CH', region: '', lat: 47.464, lon: 8.549, elev: 432 },
  { id: 'LIMC', name: 'Милан (Мальпенса)', country: 'IT', region: '', lat: 45.630, lon: 8.728, elev: 234 },
  { id: 'LIRF', name: 'Рим (Фьюмичино)', country: 'IT', region: '', lat: 41.800, lon: 12.239, elev: 5 },
  { id: 'LEMD', name: 'Мадрид', country: 'ES', region: '', lat: 40.472, lon: -3.561, elev: 609 },
  { id: 'EHAM', name: 'Амстердам', country: 'NL', region: '', lat: 52.309, lon: 4.764, elev: -4 },
  { id: 'LOWW', name: 'Вена', country: 'AT', region: '', lat: 48.111, lon: 16.570, elev: 183 },
  { id: 'EFHK', name: 'Хельсинки', country: 'FI', region: '', lat: 60.317, lon: 24.964, elev: 51 },
  { id: 'ESSA', name: 'Стокгольм', country: 'SE', region: '', lat: 59.652, lon: 17.918, elev: 38 },
  { id: 'ENGM', name: 'Осло', country: 'NO', region: '', lat: 60.194, lon: 11.100, elev: 208 },
  { id: 'EKCH', name: 'Копенгаген', country: 'DK', region: '', lat: 55.618, lon: 12.656, elev: 5 },
  { id: 'EPWA', name: 'Варшава', country: 'PL', region: '', lat: 52.166, lon: 20.967, elev: 110 },
  { id: 'LKPR', name: 'Прага', country: 'CZ', region: '', lat: 50.101, lon: 14.260, elev: 380 },
  { id: 'LHBP', name: 'Будапешт', country: 'HU', region: '', lat: 47.437, lon: 19.262, elev: 151 },
  { id: 'LROP', name: 'Бухарест', country: 'RO', region: '', lat: 44.572, lon: 26.102, elev: 96 },
  { id: 'LBSF', name: 'София', country: 'BG', region: '', lat: 42.696, lon: 23.411, elev: 531 },
  { id: 'LGAV', name: 'Афины', country: 'GR', region: '', lat: 37.937, lon: 23.944, elev: 94 },
  { id: 'LTBA', name: 'Стамбул', country: 'TR', region: '', lat: 41.275, lon: 28.752, elev: 99 },
  { id: 'LTAC', name: 'Анкара', country: 'TR', region: '', lat: 40.128, lon: 32.995, elev: 953 },

  // ========== Северная Америка ==========
  { id: 'KJFK', name: 'Нью-Йорк (JFK)', country: 'US', region: 'NY', lat: 40.640, lon: -73.779, elev: 4 },
  { id: 'KORD', name: 'Чикаго', country: 'US', region: 'IL', lat: 41.978, lon: -87.905, elev: 204 },
  { id: 'KLAX', name: 'Лос-Анджелес', country: 'US', region: 'CA', lat: 33.943, lon: -118.408, elev: 38 },
  { id: 'KSFO', name: 'Сан-Франциско', country: 'US', region: 'CA', lat: 37.619, lon: -122.375, elev: 4 },
  { id: 'KMIA', name: 'Майами', country: 'US', region: 'FL', lat: 25.793, lon: -80.291, elev: 3 },
  { id: 'KDFW', name: 'Даллас', country: 'US', region: 'TX', lat: 32.897, lon: -97.038, elev: 185 },
  { id: 'KSEA', name: 'Сиэтл', country: 'US', region: 'WA', lat: 47.450, lon: -122.309, elev: 132 },
  { id: 'CYYZ', name: 'Торонто', country: 'CA', region: 'ON', lat: 43.677, lon: -79.631, elev: 173 },

  // ========== Ближний Восток / Африка ==========
  { id: 'OMDB', name: 'Дубай', country: 'AE', region: '', lat: 25.253, lon: 55.365, elev: 11 },
  { id: 'OEJN', name: 'Джидда', country: 'SA', region: '', lat: 21.680, lon: 39.157, elev: 15 },
  { id: 'HECA', name: 'Каир', country: 'EG', region: '', lat: 30.122, lon: 31.406, elev: 116 },
  { id: 'FAOR', name: 'Йоханнесбург', country: 'ZA', region: '', lat: -26.139, lon: 28.246, elev: 1694 },

  // ========== Азия ==========
  { id: 'ZBAA', name: 'Пекин', country: 'CN', region: '', lat: 40.080, lon: 116.585, elev: 35 },
  { id: 'ZSPD', name: 'Шанхай (Пудун)', country: 'CN', region: '', lat: 31.144, lon: 121.808, elev: 4 },
  { id: 'VHHH', name: 'Гонконг', country: 'HK', region: '', lat: 22.309, lon: 113.915, elev: 9 },
  { id: 'RJTT', name: 'Токио (Ханэда)', country: 'JP', region: '', lat: 35.553, lon: 139.781, elev: 11 },
  { id: 'RKSI', name: 'Сеул (Инчхон)', country: 'KR', region: '', lat: 37.469, lon: 126.451, elev: 7 },
  { id: 'WSSS', name: 'Сингапур', country: 'SG', region: '', lat: 1.350, lon: 103.994, elev: 7 },
  { id: 'VIDP', name: 'Дели', country: 'IN', region: '', lat: 28.567, lon: 77.103, elev: 237 },

  // ========== Австралия / Океания ==========
  { id: 'YSSY', name: 'Сидней', country: 'AU', region: '', lat: -33.946, lon: 151.177, elev: 6 },
  { id: 'YMML', name: 'Мельбурн', country: 'AU', region: '', lat: -37.673, lon: 144.843, elev: 132 },

  // ========== Южная Америка ==========
  { id: 'SBGR', name: 'Сан-Паулу', country: 'BR', region: '', lat: -23.435, lon: -46.473, elev: 750 },
  { id: 'SAEZ', name: 'Буэнос-Айрес', country: 'AR', region: '', lat: -34.822, lon: -58.536, elev: 20 },
];

export function findStation(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return STATIONS;
  return STATIONS.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.id || '').toLowerCase().includes(q) ||
    (s.country || '').toLowerCase().includes(q) ||
    (s.region || '').toLowerCase().includes(q)
  );
}

export function getStationById(id) {
  return STATIONS.find(s => s.id === id) || null;
}

// v0.59.914: lookup by WMO numeric code (для rp5-импорта). Возвращает первую
// станцию с этим WMO, или null. WMO коды иногда дублируются между Aэропорт/
// Город — берём первый matched.
export function getStationByWmo(wmo) {
  const w = String(wmo || '').trim();
  if (!w) return null;
  return STATIONS.find(s => String(s.wmo || '') === w) || null;
}

// Расстояние между двумя точками (haversine, км).
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Top-N ближайших станций к точке. Возвращает массив { ...station, distanceKm }.
export function nearestStations(lat, lon, limit = 10) {
  return STATIONS
    .map(s => ({ ...s, distanceKm: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

const COUNTRY_LABELS = {
  KZ: '🇰🇿 Казахстан', RU: '🇷🇺 Россия', BY: '🇧🇾 Беларусь', UA: '🇺🇦 Украина',
  MD: '🇲🇩 Молдова', UZ: '🇺🇿 Узбекистан', KG: '🇰🇬 Кыргызстан', TJ: '🇹🇯 Таджикистан',
  GE: '🇬🇪 Грузия', AZ: '🇦🇿 Азербайджан', AM: '🇦🇲 Армения',
  GB: '🇬🇧 UK', FR: '🇫🇷 Франция', DE: '🇩🇪 Германия', CH: '🇨🇭 Швейцария',
  IT: '🇮🇹 Италия', ES: '🇪🇸 Испания', NL: '🇳🇱 Нидерланды', AT: '🇦🇹 Австрия',
  FI: '🇫🇮 Финляндия', SE: '🇸🇪 Швеция', NO: '🇳🇴 Норвегия', DK: '🇩🇰 Дания',
  PL: '🇵🇱 Польша', CZ: '🇨🇿 Чехия', HU: '🇭🇺 Венгрия', RO: '🇷🇴 Румыния',
  BG: '🇧🇬 Болгария', GR: '🇬🇷 Греция', TR: '🇹🇷 Турция',
  US: '🇺🇸 США', CA: '🇨🇦 Канада',
  AE: '🇦🇪 ОАЭ', SA: '🇸🇦 Саудовская Аравия', EG: '🇪🇬 Египет', ZA: '🇿🇦 ЮАР',
  CN: '🇨🇳 Китай', HK: '🇭🇰 Гонконг', JP: '🇯🇵 Япония', KR: '🇰🇷 Корея',
  SG: '🇸🇬 Сингапур', IN: '🇮🇳 Индия',
  AU: '🇦🇺 Австралия', BR: '🇧🇷 Бразилия', AR: '🇦🇷 Аргентина',
};

export function countryLabel(code) { return COUNTRY_LABELS[code] || code || ''; }
