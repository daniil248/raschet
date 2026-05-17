# Технолог ЦОД (`tech-workspace/`)

Предпроектная стадия ЦОД: концепция объекта (стойки, IT-нагрузка, ИБП, климат, ввод ТП/ДГУ, PDU, площади), multi-variant compare, handoff в детальное проектирование. Два режима входа — список параметров или план зала.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `tech-workspace.js` — UI/рендер: концепция объекта, варианты, сравнение, handoff, «План зала»
  - `calc/concept-loads.js` — чистый расчётный слой (нагрузки/площади, без DOM): `calcITTotal`, `calcUpsByPurpose`, `calcCoolTotal`, `calcHeatLoad`, `calcFeedTotal`, `calcAreas` и др.
  - `tech-workspace.css` — стили
- **Расчётная часть (calc):** `calc/concept-loads.js` — чистые функции без DOM (принимают объект концепции `c`; переиспользуемо: карточки, отчёты, сравнение, тесты)
- **UI/рендер:** `tech-workspace.js`
- **Данные/справочники:** LS-ключи `raschet.project.<pid>.tech-workspace.variants.v1`, `...activeVariantId.v1`, `raschet.cooling.prefill.v1`
- **Cross-module связи:** мост `scheme-rack-bridge`; PUSH контекста в дочерние конфигураторы (genset-config и др.) через URL; prefill для cooling
- **Куда добавлять новое:** новые параметры концепции/варианты и логику handoff — в `tech-workspace.js`
