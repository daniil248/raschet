# Конфигуратор ИБП (`ups-config/`)

Подбор конфигурации ИБП по нагрузке: тип (моноблок / модульный), резервирование N+X, параметры входа и батарейной цепи.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `ups-config.js` — UI/рендер, чтение DOM, wizard-экран, подбор/батарейная цепь
  - `calc/ups-sizing.js` — чистый расчётный слой: `parseRedundancy()` (N/N+1/N+2/2N), `calcModules()` (рабочие модули + резерв), без DOM
  - `ups-config.css` — стили
- **Расчётная часть (calc):** `calc/ups-sizing.js` — чистые функции без DOM (переиспользуемо: ups-types pickFit, отчёты, тесты)
- **UI/рендер:** `ups-config.js`
- **Данные/справочники:** `shared/ups-catalog`, `shared/ups-picker`; LS-ключи `raschet.configurations.ups.v1`, `raschet.lastUpsConfig.v1`, `raschet.project.<pid>.ups-config.selected.v1`
- **Cross-module связи:** handoff с АКБ (`raschet.upsHandoff.v1`, `raschet.upsBatteryReturn.v1`); события `rs-selection-change`, `ups-config:configs-changed`, `ups:open-master`; URL `capacityKw`, `loadKw`, `redundancy`, `upsType` и др.
- **Куда добавлять новое:** модели ИБП — через `shared/ups-catalog`; логику резервирования/батарейной цепи и экран — в `ups-config.js`
