# Каталог и библиотека элементов (`catalog/`)

Единый источник оборудования платформы: элементы (ИБП, щиты, АКБ, трансформаторы, автоматы, корпуса, климат, кабели), цены по датам и контрагентам, импорт прайс-листов XLSX, аналитика. Страница `elements/` объединена с `catalog/` во избежание дублирования UI.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `catalog.js` — экран каталога: элементы, цены, импорт прайсов, аналитика
  - `catalog.css` — стили
- **Расчётная часть (calc):** —
- **UI/рендер:** `catalog.js`
- **Данные/справочники:** `shared/element-library`, `shared/element-schemas`, `shared/price-records`, `shared/counterparty-catalog`; LS-ключи `raschet.upsCatalog.v1`, `raschet.batteryCatalog.v1`, `raschet.transformerCatalog.v1`, `raschet.panelCatalog.v1`; коллекции `prices`, `counterparties`
- **Cross-module связи:** `shared/catalog-bridge`; события `raschet:work-templates-change`, `raschet:materials-change`, `raschet:wizards-change`
- **Куда добавлять новое:** новые виды оборудования — через `shared/element-library`/`shared/catalogs/*`; UI вкладок — в `catalog.js`
