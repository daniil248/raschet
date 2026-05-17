# shared/i18n — инфраструктура локализации

Фаза 5 мастер-плана: **только инфраструктура-плейсхолдер**. Извлечение
строк в каталоги — отдельная отложенная i18n-фаза (codemod ru-литералы →
каталоги + en-заглушки + переключатель локали в `app-header`).

## Сейчас
- `index.js` — `t(ns,key,params,fallbackText)`, `tAsync`, `getLocale`,
  `setLocale`, `availableLocales`, `loadNamespace`. Каталогов нет →
  `t()` возвращает `fallbackText || key` (полный no-op, UI не меняется).
- Источник правды и fallback-локаль = **`ru`**.
- Резолюция: `loaded[lang][ns][key]` → `loaded.ru[ns][key]` →
  `fallbackText` → `key`.

## Контракт ключа
`<ns>.<section>.<key>`, где `ns` = id модуля из `<module>/manifest.json`.

## Каталоги (появятся в i18n-фазе)
`shared/i18n/<lang>/<ns>.json` — плоский `{ "<section>.<key>": "текст" }`.
Грузится лениво (`fetch`, document-relative — Pages + file://).
Отсутствие файла — НЕ ошибка (тихий фолбэк на ru/ключ).

## Конструктивное ограничение СЕЙЧАС
Каждая новая/правимая UI-строка должна быть **изолируема** (один
литерал, без конкатенации с разметкой) — чтобы будущий codemod её
извлёк. Локаль-зависимое форматирование чисел/дат/единиц — через
`shared/money.js` (`fmtNumber`/`fmtDate`/`fmtUnit`).

## Событие
`setLocale()` эмитит `rs-locale-change` (`detail.locale`) — UI может
перерисоваться.
