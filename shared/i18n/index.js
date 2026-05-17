// =============================================================================
// shared/i18n/index.js — инфраструктура локализации (NO DOM, zero-build)
// =============================================================================
// Фаза 5 (мастер-план): ТОЛЬКО инфраструктура-плейсхолдер. Извлечение строк
// в каталоги — отдельная отложенная i18n-фаза (codemod + en-заглушки).
// Сейчас каталогов нет → t() возвращает fallbackText || key (полный no-op
// для текущего UI: ничего не ломается, строки остаются русскими в коде).
//
// Контракт ключа: `<ns>.<section>.<key>`, где ns = id модуля (manifest).
// Источник правды и fallback-локаль = 'ru'. Резолюция значения:
//   loaded[lang][ns][key]  →  loaded['ru'][ns][key]  →  fallbackText  →  key
//
// Каталог локали грузится ЛЕНИВО: shared/i18n/<lang>/<ns>.json (fetch,
// document-relative — работает на Pages и file://). Отсутствие файла —
// НЕ ошибка (тихий фолбэк), чтобы инфра не требовала сразу всех каталогов.
//
// Использование (когда появятся каталоги):
//   import { t, setLocale } from 'shared/i18n/index.js';
//   t('cooling', 'form.title', { n: 3 }, 'Подбор холода');  // params {n}
// =============================================================================

const LS_LOCALE = 'raschet.locale.v1';
const SOURCE_LOCALE = 'ru';

let _locale = (() => {
  try { return localStorage.getItem(LS_LOCALE) || SOURCE_LOCALE; }
  catch { return SOURCE_LOCALE; }
})();

// loaded[lang][ns] = { key: text }  | null (попытка была, файла нет)
const _loaded = Object.create(null);
const _inflight = new Map();   // `${lang}/${ns}` → Promise

export function getLocale() { return _locale; }

export function setLocale(lang) {
  _locale = lang || SOURCE_LOCALE;
  try { localStorage.setItem(LS_LOCALE, _locale); } catch {}
  try {
    window.dispatchEvent(new CustomEvent('rs-locale-change', { detail: { locale: _locale } }));
  } catch {}
  return _locale;
}

/** Доступные локали (расширяется по мере появления каталогов). */
export function availableLocales() {
  return [{ code: 'ru', label: 'Русский' }];
}

function _interp(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) =>
    (params[k] != null ? String(params[k]) : m));
}

/** Ленивая подгрузка каталога <lang>/<ns>.json. Идемпотентно; молча
 *  кэширует null при отсутствии файла (инфра не падает без каталогов). */
export async function loadNamespace(ns, lang = _locale) {
  _loaded[lang] = _loaded[lang] || Object.create(null);
  if (ns in _loaded[lang]) return _loaded[lang][ns];
  const cacheId = `${lang}/${ns}`;
  if (_inflight.has(cacheId)) return _inflight.get(cacheId);
  const p = (async () => {
    try {
      const url = new URL(`./${lang}/${ns}.json`, import.meta.url);
      const res = await fetch(url);
      _loaded[lang][ns] = res.ok ? await res.json() : null;
    } catch {
      _loaded[lang][ns] = null;
    }
    _inflight.delete(cacheId);
    return _loaded[lang][ns];
  })();
  _inflight.set(cacheId, p);
  return p;
}

/** Синхронный перевод. Если каталог не загружен/нет ключа — fallbackText
 *  (рекомендуется передавать ru-литерал) либо сам key. params: {name}. */
export function t(ns, key, params = null, fallbackText = null) {
  const tryLang = (lang) => {
    const cat = _loaded[lang] && _loaded[lang][ns];
    return cat && (key in cat) ? cat[key] : undefined;
  };
  let val = tryLang(_locale);
  if (val === undefined && _locale !== SOURCE_LOCALE) val = tryLang(SOURCE_LOCALE);
  if (val === undefined) val = (fallbackText != null ? fallbackText : key);
  return _interp(val, params);
}

/** Async-вариант: гарантирует подгрузку каталога перед резолвом. */
export async function tAsync(ns, key, params = null, fallbackText = null) {
  await loadNamespace(ns, _locale);
  if (_locale !== SOURCE_LOCALE) await loadNamespace(ns, SOURCE_LOCALE);
  return t(ns, key, params, fallbackText);
}
