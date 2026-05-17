# ДГУ-конфигуратор (`genset-config/`)

Подбор дизель-генераторной установки по нагрузке с учётом режима (ESP/PRP/COP), резервирования, высоты над уровнем моря, температуры наружного воздуха и автономии.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `genset-config.js` — UI-оркестратор (standalone-режим, PUSH из tech-workspace через URL params)
  - `calc/genset-calc.js` — расчётное ядро подбора ДГУ
  - `genset-config.css` — стили
- **Расчётная часть (calc):** `calc/genset-calc.js` (чистая логика без DOM)
- **UI/рендер:** `genset-config.js`
- **Данные/справочники:** `datasheets/index.js` → `shared/catalogs/genset/`
- **Cross-module связи:** приём контекста из tech-workspace через URL (`capacityKw`, `mode`, `redundancy`, `altitude`, `tamb`, `autonomy`, `vendor`); apply в Конструктор через postMessage `raschet.dgu.apply` (протокол-ключ оставлен прежним)
- **LS-namespace:** `dgu-config` (намеренно НЕ переименован — storage-совместимость уже сохранённых данных)
- **Куда добавлять новое:** методику подбора/деретинга — в `calc/genset-calc.js`; даташиты вендоров — в `shared/catalogs/genset/`; экран — в `genset-config.js`
