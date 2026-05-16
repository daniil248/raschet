# Расчёт АКБ (`battery/`)

Подбор ёмкости и конфигурации АКБ для ИБП. Загрузка таблиц разряда производителей (Kehua, Panasonic, SVC, Sonnenschein) в XLSX и точный расчёт по ним.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `battery-calc.js` — UI-оркестратор, расчёт конфигурации и lifecycle-стоимости
  - `battery-discharge.js` — расчёт по таблицам разряда производителей
  - `battery-data-parser.js` — парсер XLSX-таблиц разряда
  - `battery-catalog.js` — доступ к каталогу АКБ
- **Расчётная часть (calc):** `battery-discharge.js`, `battery-data-parser.js` (логика разряда/парсинга)
- **UI/рендер:** `battery-calc.js` + `battery-calc.css`
- **Данные/справочники:** каталог АКБ (`raschet.batteryCatalog.v1`), `shared/battery-picker`
- **Cross-module связи:** handoff с ИБП через `raschet.upsHandoff.v1` / `raschet.upsBatteryReturn.v1`; событие `battery:configs-changed`; URL-параметры `loadKw`, `autonomyMin`, `fromUps`
- **Куда добавлять новое:** новые методики разряда — в `battery-discharge.js`; парсинг новых форматов производителей — в `battery-data-parser.js`; экран — в `battery-calc.js`
