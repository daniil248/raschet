// =============================================================================
// shared/money.js — универсальные деньги/валюты (без зависимостей, NO DOM)
// =============================================================================
// v0.60.428: вынесено в shared, чтобы shared/selection-panel.js не тянул
// cooling/calc/fc-summary.js. Логика идентична cooling-копии.

/** Каталог валют: code — символ; iso — ISO 4217; label — название. */
export const CURRENCIES = [
  { code: '₽',   iso: 'RUB', label: 'RUB · российский рубль' },
  { code: '$',   iso: 'USD', label: 'USD · доллар США' },
  { code: '€',   iso: 'EUR', label: 'EUR · евро' },
  { code: '₸',   iso: 'KZT', label: 'KZT · казахстанский тенге' },
  { code: '¥',   iso: 'CNY', label: 'CNY · юань (КНР)' },
  { code: '£',   iso: 'GBP', label: 'GBP · фунт стерлингов' },
  { code: 'Br',  iso: 'BYN', label: 'BYN · белорусский рубль' },
  { code: '₺',   iso: 'TRY', label: 'TRY · турецкая лира' },
  { code: '₴',   iso: 'UAH', label: 'UAH · украинская гривна' },
  { code: 'CHF', iso: 'CHF', label: 'CHF · швейцарский франк' },
];

/** ISO-код по символу валюты (₽ → RUB, $ → USD, …). */
export function currencyToIso(code) {
  return CURRENCIES.find(c => c.code === code)?.iso || code;
}

/** Форматирование сумм с символом валюты. */
export function fmtMoney(v, cur = '₽') {
  if (!Number.isFinite(v)) return '—';
  const c = cur || '₽';
  return v >= 1000000 ? `${(v / 1000000).toFixed(2)} млн ${c}`
    : v >= 1000 ? `${(v / 1000).toFixed(0)} тыс ${c}`
    : `${v.toFixed(0)} ${c}`;
}

// =============================================================================
// v0.60.567 (Фаза 5): locale-aware форматтеры (аддитивно, без зависимостей,
// NO DOM). Единственная locale-aware утилита проекта. locale — BCP-47;
// по умолчанию 'ru-RU'. i18n-фаза свяжет дефолт с shared/i18n getLocale()
// (здесь намеренно НЕ импортируем i18n — money.js остаётся zero-dep, без
// рисков цикла/кэш-скью §6a). Все три — безопасный фолбэк при невалидном
// входе ('—'); никакой существующий код не затронут (чистое добавление).
// =============================================================================

/** Число с группировкой/десятичными по локали. fmtNumber(1234.5,{max:1}) */
export function fmtNumber(v, { locale = 'ru-RU', min = 0, max = 2 } = {}) {
  if (!Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: min, maximumFractionDigits: max,
    }).format(v);
  } catch { return String(v); }
}

/** Дата/время по локали. Принимает Date | number(ms) | ISO-string. */
export function fmtDate(v, { locale = 'ru-RU', withTime = false } = {}) {
  const d = (v instanceof Date) ? v : new Date(v);
  if (!d || isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(d);
  } catch { return d.toLocaleString(); }
}

/** Величина с единицей: "12,5 кВт". unit — строка-суффикс (локализуется
 *  в i18n-фазе через t()); число — по локали (fmtNumber). */
export function fmtUnit(v, unit = '', { locale = 'ru-RU', min = 0, max = 2 } = {}) {
  if (!Number.isFinite(v)) return '—';
  const n = fmtNumber(v, { locale, min, max });
  return unit ? `${n} ${unit}` : n;
}
