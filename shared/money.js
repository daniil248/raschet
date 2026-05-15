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
