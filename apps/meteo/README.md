# Метеоданные (`meteo/`)

Stand-alone модуль метеоданных: хранит наборы почасовых метеоизмерений («датасеты») внутри активного проекта, загрузка из источников (Open-Meteo, ASHRAE, RP5, CSV), графики и годовые таблицы.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `meteo.js` — UI-ядро + оркестрация вкладок
  - `sources/*` — плагины источников (open-meteo, ashrae, rp5, csv-generic) + `registry.js`
  - `charts.js` — графики (гистограммы T/RH, помесячная T, матрица days-in-range)
  - `annual-table.js` — годовая pivot-таблица часов с column-config + CSV
  - `ashrae-datasheet.js`, `station-picker.js` — даташит ASHRAE и выбор станции
- **Расчётная часть (calc):** `util.js` (computeStats и общие утилиты), `meteo-api.js`, источники `sources/*`
- **UI/рендер:** `meteo.js`, `charts.js`, `annual-table.js`, `station-picker.js`, `meteo.css`
- **Данные/справочники:** `stations/wmo-list.js`; датасеты — в project-storage
- **Cross-module связи:** датасеты читаются другими модулями (cooling через meteo-bridge) по общему ключу project-storage
- **Куда добавлять новое:** новый источник — модуль в `sources/` + регистрация в `sources/registry.js`; графики — в `charts.js`
