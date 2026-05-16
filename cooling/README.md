# Подбор холодильных систем (`cooling/`)

Подбор чиллеров/DX-систем, free-cooling, расчёт CAPEX/TCO/payback и технико-экономическое сравнение нескольких опций.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `cooling.js` — UI-оркестратор (3 режима: standalone/project/embed)
  - `calc/chiller-bin-calc.js` — bin-расчёт по интервалам температур
  - `calc/capex-tco.js` — CAPEX/TCO/payback
  - `calc/topology.js`, `calc/comparison.js` — топология и сравнение опций
  - `meteo-bridge.js` — мост к датасетам модуля Meteo
- **Расчётная часть (calc):** `calc/*` — чистые функции без DOM (`chiller-bin-calc`, `capex-tco`, `comparison`, `topology`, `psychro-formulas`, `fc-summary`, `datasheet`, `chiller-defaults`)
- **UI/рендер:** `ui/*` (формы, чарты, таблицы), `cooling.css`
- **Данные/справочники:** `datasheets/index.js`; климат читается из проекта через `meteo-bridge.js`
- **Cross-module связи:** `cooling/meteo-bridge.js` (данные Meteo через project-storage, без cross-import)
- **Куда добавлять новое:** методики расчёта — в `calc/`; экраны/чарты — в `ui/`; даташиты оборудования — в `datasheets/`
