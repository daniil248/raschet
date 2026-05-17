# Конфигуратор трансформатора (`transformer-config/`)

Подбор силового трансформатора: мощность, первичное / вторичное напряжение, группа соединений, потери ХХ / КЗ, uk, тип охлаждения.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `transformer-config.js` — UI/рендер, чтение DOM, каскадный пикер, wizard-экран
  - `calc/tx-select.js` — чистый расчётный слой: `classifyTxType()` (сухой/масляный), `selectTransformers(catalog, criteria)` (фильтр+ранжирование по загрузке), без DOM
  - `transformer-config.css` — стили
- **Расчётная часть (calc):** `calc/tx-select.js` — чистые функции без DOM (переиспользуемо: tech-workspace prefill, отчёты, тесты)
- **UI/рендер:** `transformer-config.js`
- **Данные/справочники:** `shared/transformer-catalog`; LS-ключи `raschet.configurations.transformer.v1`, `raschet.transformerCatalog.v1`
- **Cross-module связи:** события `rs-selection-change`, `rs-cs-focus`; URL `project`, `nodeId`
- **Куда добавлять новое:** модели трансформаторов — через `shared/transformer-catalog`; логику подбора и экран — в `transformer-config.js`
