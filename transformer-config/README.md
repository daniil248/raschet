# Конфигуратор трансформатора (`transformer-config/`)

Подбор силового трансформатора: мощность, первичное / вторичное напряжение, группа соединений, потери ХХ / КЗ, uk, тип охлаждения.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `transformer-config.js` — подбор трансформатора, расчёт потерь/параметров
  - `transformer-config.css` — стили
- **Расчётная часть (calc):** логика подбора внутри `transformer-config.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `transformer-config.js`
- **Данные/справочники:** `shared/transformer-catalog`; LS-ключи `raschet.configurations.transformer.v1`, `raschet.transformerCatalog.v1`
- **Cross-module связи:** события `rs-selection-change`, `rs-cs-focus`; URL `project`, `nodeId`
- **Куда добавлять новое:** модели трансформаторов — через `shared/transformer-catalog`; логику подбора и экран — в `transformer-config.js`
