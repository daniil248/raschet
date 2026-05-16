# ARCHITECTURE — структура файлов модулей Raschet

Канон раскладки файлов и привязка к модульной системе (`modules.json`).
Это «закон формы». Смежные документы (НЕ дублируются здесь):

- `shared/contracts/README.md` — 5 слоёв, закон импортов, шов, R-правила.
- `CONTRIBUTING.md` — branch-per-module, lint-gate, verify/rollback.
- `shared/storage-keys.md` / `cross-module-events.md` / `url-params.md` —
  контракты кросс-модульного общения.

Платформа: vanilla-JS, zero-build, сырые ES-модули, GitHub Pages
(deploy = push в `main`). Любой физический перенос файла ломает
относительные импорты → переносить только с re-export shim'ом и
проверкой на проде (см. `CONTRIBUTING.md`).

---

## 1. Канонический скелет модуля

Один предсказуемый шаблон. Эталон уже в коде: `cooling/`, `service/`.

```
<module>/
  index.html        # только оболочка-точка входа (kind:'ui')
  README.md          # 12–20 строк: назначение, главные файлы, точки расширения
  changelog.js       # журнал модуля (паттерн scs-config/suppression-config)
  <module>.css       # стили (или styles/ если > ~800 строк)
  calc/              # ЧИСТАЯ логика: без DOM, тестируемая, переиспользуемая
    index.js         #   единая точка экспорта расчётов
    *.js             #   по подзадачам
  ui/                # DOM/рендер: панели, формы, графика
    index.js         #   монтаж модуля
    *.js             #   по экранам/панелям
  data/              # ТОЛЬКО модуль-локальные сиды
  manifest.json      # запись модульной системы (см. §3)
```

Правила формы:

- **`calc/` ничего не знает о DOM.** Расчёт вызываем из другого модуля,
  из тестов, из `reports/`. Граница `calc/ ↔ ui/` = граница `kind`
  (см. §3) и единица будущего выделения `calc-lib`.
- **Имя файла = роль, не повтор имени модуля.** `ui/index.js`,
  `calc/index.js` — а не `ups-config.js`. (Существующие монолиты
  переименовываются только при дроблении, через shim.)
- **`README.md` обязателен.** Это «понятность Пользователю»: открыл
  папку → за 15 строк понял что это, где главное, куда добавлять новое.
- **Справочники — не в коде модуля.** Любые справочные данные
  (типовые работы, прайсы, библиотеки изделий) → `shared/catalogs/*`
  или `catalog/` (правило memory `use_catalogs`). В `data/` — только
  локальные сиды самого модуля.
- **Отчёты — только через `reports/` + `shared/report/`** (правило
  memory `reports_via_module`): модуль формирует `blocks[]`, не HTML.

## 2. Реорганизация `shared/` по доменам (целевая)

Сейчас в корне `shared/` ~80 файлов вперемешку. Целевые домены (каждый
с коротким `README.md`); переезд — инкрементально, через shim:

```
shared/
  catalogs/      справочники изделий (есть)
  calc/          переиспользуемые расчёты (есть; CORE/SHARED-слой, НЕ модуль)
  ui/            общие виджеты, picker'ы, modal'ы (есть; дополнять)
  report/        подсистема отчётов (есть)
  bridges/       НОВОЕ — все *-bridge.js в одно место
  project/       project-context / project-storage / sketch-refs / bootstrap
  catalog-data/  element-library / *-seed / *-catalog-data
  platform/      auth / subscriptions / global-settings / company-profile / history-log
  types/         por-types / ups-types / battery-types
  contracts/     спеки шва + lint-allowlist (есть)
```

`shared/calc`, `shared/calc-modules`, `js/methods`, `js/engine` — это
**CORE/SHARED-слой инфраструктуры**, доступный всем модулям по
определению. Это НЕ записи `modules.json` (их регистрация
противоречила бы закону слоёв `contracts/README.md`). Их «видимость»
обеспечивается этим документом и контракт-доками, а не реестром.

## 3. Привязка структуры к модульной системе

Источник правды реестра — `<module>/manifest.json`; корневой
`modules.json` — проекция (`tools/gen-modules-json.mjs --check`).
Структура файлов ОБЯЗАНА вытекать из манифеста:

| Поле манифеста | Что обязано быть в структуре |
|---|---|
| `path` | папка модуля = единица владения (branch-per-module) |
| `kind:'ui'` | `index.html` + `ui/`, карточка в `/modules/`, проходит subscription-check |
| `kind:'calc-lib'` | только `calc/`, БЕЗ `index.html`/`ui/`, без subscription-check, но запись в реестре есть (auto-included) |
| `requires` | = реальные пути импортов; всё что модуль тянет — объявлено |
| `internalOnly` | тот же скелет, флаг только в манифесте |

`requires` — контракт, а не комментарий: `scripts/audit-manifest.py`
сверяет реальные импорты папки с `requires`/реестром и сигналит дрейф.

## 4. Чек-лист «создание / регистрация модуля»

1. Папка по канону §1 (`index.html` для ui; `calc/` для calc-lib;
   `README.md` обязателен).
2. `<module>/manifest.json` (схема `contracts/README.md` §6): `id`,
   `kind`, `path`, `requires` (= реальные импорты), `subscriptionPlan`,
   `internalOnly`, `lsNamespacesOwned`, `dependsOnContracts`.
3. Добавить `id` в `REGISTRY_ORDER` (`tools/gen-modules-json.mjs`) и
   запись в `modules.json` (паритет: `gen-modules-json.mjs --check`).
4. Карточка в `/modules/index.html` (правило memory `modules_index`;
   для `kind:'ui'`). Для calc-lib — раздел «📚 Все модули».
5. Кросс-каналы (LS-ключ / событие / URL-param / мост) → в контракт-
   доки + `dependsOnContracts` обеих сторон.
6. `python scripts/audit-manifest.py` зелёный; boundary-lint зелёный.

## 5. Долг реестра (Фаза 1, отслеживается audit-manifest.py)

`modules.json` рассинхронизирован с реальностью — это известный долг,
гасится в Фазе 1 (НЕ в Фазе 0, т.к. меняет subscription-поведение):

- **Не зарегистрированы UI-модули:** `cooling`, `meteo`, `service`,
  `scs-config`, `scs-design`, `rack-config`, `mdc-config`, `dgu-config`,
  `pdu-config`, `suppression-config`, `psychrometrics`,
  `facility-inventory`, `configurator3d`.
- **Нет ни одной записи `kind:'calc-lib'`** — кандидат №1
  `suppression-methods/` (чистая methods-библиотека, потребляется
  `suppression-config/`).
- **`requires` декларативный/мёртвый** — у `cooling` `requires:[]`,
  хотя реально тянет `shared/*`+`meteo` (через мост).

`scripts/audit-manifest.py` превращает этот дрейф в автоматическую
проверку. Регистрация (manifest + REGISTRY_ORDER + карточка) каждой
позиции — отдельный пункт Фазы 1 (по одному модулю, т.к. затрагивает
реестр подписок).

## 6. Миграция (инкрементально, без big-bang)

- **Фаза 0 (этот шаг, нулевой риск):** ARCHITECTURE.md + `README.md`
  по всем модулям + `audit-manifest.py`. Код не трогаем.
- **Фаза 1:** новые/правимые модули — по канону; синхронизация
  `requires`; регистрация недостающих модулей и `calc-lib`.
- **Фаза 2:** дробление монолитов по одному (`tech-workspace` 5.7k,
  `scs-config` 5.2k, `scs-design` 5.2k …): сначала вынуть `calc/`
  (безопасно), затем `ui/`; импортёры — через shim под кэш Pages.
