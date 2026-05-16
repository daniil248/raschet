# Конфигуратор ИБП (`ups-config/`)

Подбор конфигурации ИБП по нагрузке: тип (моноблок / модульный), резервирование N+X, параметры входа и батарейной цепи.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `ups-config.js` — подбор ИБП, резервирование, вход и батарейная цепь
  - `ups-config.css` — стили
- **Расчётная часть (calc):** логика подбора внутри `ups-config.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `ups-config.js`
- **Данные/справочники:** `shared/ups-catalog`, `shared/ups-picker`; LS-ключи `raschet.configurations.ups.v1`, `raschet.lastUpsConfig.v1`, `raschet.project.<pid>.ups-config.selected.v1`
- **Cross-module связи:** handoff с АКБ (`raschet.upsHandoff.v1`, `raschet.upsBatteryReturn.v1`); события `rs-selection-change`, `ups-config:configs-changed`, `ups:open-master`; URL `capacityKw`, `loadKw`, `redundancy`, `upsType` и др.
- **Куда добавлять новое:** модели ИБП — через `shared/ups-catalog`; логику резервирования/батарейной цепи и экран — в `ups-config.js`
