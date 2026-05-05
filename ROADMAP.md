# Raschet — Roadmap архитектурного развития платформы

> **Статус:** v0.60.273 (2026-05-06). Phase 23.1 (line-items для CAPEX) ✅. Запланированы фазы 23.2–23.6 (rollout pattern на весь проект), 24 (модуль Сервис: монтаж/ТО), 25 (Импорт даташитов климат-оборудования), 26 (SharePoint integration), 27 (MS365 auth — deferred). Фаза 1.27 — «Проекты» полностью закрыта. Фаза 1.28 — POR-registry, cross-discipline reconciliation, 1.28.20 (consumer-container) — Phase 1+2+3 ✅ (включая kit-container для cond+outdoor v0.60.250-259). **Фаза 45 (File-storage drawio-style)** ✅ v0.60.258-273 — File System Access API + IndexedDB persistent handle + external-change detection + ↻ Перечитать + ✕ Закрыть + Ctrl+O/Ctrl+Shift+S + discoverability с /projects/. **Фаза 46 (Firestore quota optimization)** ✅ v0.60.260-263 — solo-skip коллаборации (-95% writes), heartbeat 60с/45с, lock debounce 800мс, autosave 3с, persistence + TTL cache (-90% reads). Фаза 19 (пресеты карточек) полностью закрыта. 1.24.18 закрыто. **Фаза 20 (Технолог ЦОД)**: 20.1 ✅ (двухпанельный layout v0.59.892), 20.2–20.6 ✅ (rackGroups/upsSystems/coolingUnits/feed/PDU per-group), 20.8 ✅ (блок МЦОД через sub-проект v0.59.893), 20.9 ✅ (HTML-ПЗ — будет переработана через модуль отчётов), 20.10 ✅ (compare), 20.11 ✅ (handoff MVP), 20.12 ✅ (PUE авто/ручной v0.59.895), 20.13 ✅ (BOM с ценами по дате v0.59.896). Открыто 20.7 (план зала). **Фаза 21 (Метеоданные)**: stand-alone модуль `meteo/` с plugin-архитектурой источников (Open-Meteo REST + rp5 CSV) — 21.1 ✅ v0.59.894. Local/Online switcher. Центр помощи с 23 статьями + кнопка ❓ в общей шапке.

> **Правило ведения:** roadmap обновляется ПОСТОЯННО — при появлении новой фичи / задачи и при закрытии любого этапа. Hotfix'ы (regressions, мелкие правки UX) НЕ попадают в roadmap, только содержательная функциональность. Это правило зафиксировано пользователем 2026-04-29.

---

## Phase 47 — «Технолог объекта» (универсальный) + Модуль ГИП 🟡

По запросу Пользователя 2026-05-06: «модуль для технолога должен поддерживать
разные типы объекта (ЦОД, завод, насосная, офис, своё) с настраиваемыми
шаблонами; для ГИПа нужен отдельный модуль — сводный view всех дисциплин,
проверка корректности схем, перечня оборудования, проверка расчётов».

### 47.1 Универсальный «Технолог объекта»
- ✅ **47.1.1 (v0.60.283)** Переименование «Технолог ЦОД» → «Технолог объекта»
  в UI (заголовок страницы, mountHeader, mountHelp, hub-card, modules-card).
  Папка `tech-workspace/` оставлена как path для обратной совместимости.
- ✅ **47.1.2 (v0.60.283)** `proj.objectKind` поле в project-storage с 5
  значениями: `datacenter` / `factory` / `pump-station` / `office` / `custom`.
  Default = `datacenter` (для существующих проектов).
- ✅ **47.1.3 (v0.60.283)** Selector «Тип объекта» в sidebar TW (chip с
  кнопкой «↪ изменить»). Modal со списком 5 опций. Для не-datacenter показывается
  warning-banner «⚠ Для этого типа разделы пока в разработке».
- ⏳ **47.1.4** Адаптация состава активных разделов sidebar по objectKind:
  - `datacenter` → как сейчас (помещения, стойки, ИБП, климат, ввод, MDC).
  - `factory` → производственные линии, силовые трансформаторы, мех-оборудование, ввод.
  - `pump-station` → насосные группы, ёмкости, КИПиА, ввод.
  - `office` → освещение, розетки, СКС, кондиционирование.
  - `custom` → пользователь сам выбирает чек-боксами какие разделы включать.
- ⏳ **47.1.5** Шаблоны через `proj.objectModules: string[]` — массив id
  активных разделов. Adminer / Пользователь может editировать состав
  для нестандартных проектов («ЦОД с производством», «офис с серверной»).
- ⏳ **47.1.6** Помещения: kind-варианты («производственный цех», «насосная»,
  «офис», «склад», «зал ИТ») с корректной семантикой клиренсов / норм.

### 47.2 Модуль ГИП
- ✅ **47.2.1 (v0.60.283)** Stub-страница `/chief/index.html` (URL: chief =
  Chief Engineer) с описанием будущей функциональности. Карточка в hub.html
  и в /modules/.
- ⏳ **47.2.2** Сводка по проекту: тип объекта, активные дисциплины, стадия,
  команда (роли).
- ⏳ **47.2.3** Cross-discipline перечень оборудования (агрегация из
  Технолога объекта + Конструктора электрических схем + СКС-design + ...).
  Все возможные порты по системам (электрика / трубы / ОВК / данные / ...).
- ⏳ **47.2.4** Проверка корректности схем: висячие связи, отсутствие
  источника, перегруз, дубли портов, орфаны.
- ⏳ **47.2.5** Проверка расчётов: ΔU, токи, селективность, cooling vs IT,
  UPS vs IT, ТП/ДГУ vs потребление. Cross-discipline баланс.
- ⏳ **47.2.6** Согласование разделов: «✓ Согласовано» с timestamp +
  подписью + историей ревизий + замечаниями.

---

## Завершено после v0.59.601 (catch-up rollup)

Эти крупные блоки функциональности влиты в master после последнего обновления
roadmap (v0.59.601 → v0.59.755, 154 коммита). Сгруппированы по темам, без
hotfix'ов и косметики.

### ✅ Фаза 45 — File-storage drawio-style (v0.60.258–273)
Файловое хранилище проектов как в drawio: проект сохраняется в локальный
файл `.raschet.json`, который можно положить на сетевой ресурс для совместной
работы (1 писатель + N читателей). Без облака, без квот.
- **Phase 1** (v0.60.258): новый модуль `shared/file-sync.js` с обёрткой над
  File System Access API (Chromium) + graceful fallback на download/upload
  для Firefox/Safari. 3 кнопки в sidebar: 📁 Открыть / 👁 Только чтение /
  💾 Сохранить в файл. Auto-save в file-mode пишется через handle (in-place),
  без диалога.
- **Phase 2** (v0.60.260): persistent handle через IndexedDB
  (`raschet-file-sync` DB) — после reload страницы handle переживает сессию,
  badge предлагает «↻ Открыть снова». Кнопки в badge'е: ↻ Перечитать,
  ✕ Закрыть файл. Timestamp последнего save.
- **Phase 3** (v0.60.262): external-change detection через mtime polling 30с.
  Toast «⚠ Файл изменён извне» для read-only / красный warning для writer.
  Badge подсвечивается красным.
- **Phase 4** (v0.60.270): file-mode и cloud-mode взаимоисключающие —
  открытие файла в cloud-проекте автоматически выходит из cloud-mode
  (`exitCloudMode`); открытие cloud-проекта в file-mode авто-выключает
  file-mode + forgetHandle. Закрывает edge-case data corruption.
- **Phase 5** (v0.60.271): instant external-change check на visibilitychange —
  при возврате на вкладку немедленно проверяем mtime, не ждём 30с tick.
- **Phase 6** (v0.60.272–273): discoverability — зелёная кнопка
  «📁 Открыть файл (drawio)» прямо на /projects/ toolbar. Хоткеи Ctrl+O /
  Ctrl+Shift+S. Sidebar реорганизован: file-mode секция первой, legacy LS/Cloud
  ниже. Полное обновление статьи `feature-file-storage.html` (23-я статья
  справки).
Файлы: `shared/file-sync.js`, `js/engine/export.js`, `js/main.js`,
`projects/index.html`, `projects/projects.js`, `index.html`,
`help/articles/feature-file-storage.html`.

### ✅ Фаза 46 — Firestore quota optimization (v0.60.260–263)
Бесплатный Spark plan имеет лимит 20K writes/day. Анализ показал что один
активный user сжигал ~48K/day (lock acquire/release на каждый клик +
heartbeat'ы). Запрос Пользователя 2026-05-06 «квота стала уходить очень
быстро» → 4 фазы оптимизации:
- **v0.60.260**: heartbeat-интервалы 2-3× длиннее (presence 25→60с,
  lock 20→45с, autosave 1.5→3с, revision 5→15мин). Pause-on-hidden:
  presence/lock heartbeat'ы skipят при `document.hidden=true`.
  Visibilitychange тригерит немедленный beat при возврате.
- **v0.60.261**: <b>solo-skip</b> — для проектов БЕЗ shared members
  `_startCollab` вообще не вызывается. Lock acquire debounce 800мс при
  rapid-clicking. Inline-solo проверка на каждом selection.
- **v0.60.263**: Firestore offline persistence
  (`enablePersistence({synchronizeTabs:true})`) — кэшируется reads в IDB,
  server-reads только за дельтой. refreshProjects TTL-cache 30с с
  force-bypass на mutations.
- **v0.60.264**: collab-on-share — после addShare() в solo-проекте
  автоматически стартуем collab. **v0.60.266**: shared→solo auto-stop —
  после unshare последнего member'а останавливаем collab.
Итог: writes 48K → 800/day (соло), reads 5K → 500/day. Spark plan теперь
выдерживает месяцы обычной работы.
Файлы: `js/main.js` (heartbeat constants + solo-detection + lock debounce),
`shared/auth.js` (enablePersistence).

### ✅ Фаза 1.28.21 — Kit-container (cond + outdoor): Phase 1-3 (v0.60.250–259)
Новый режим `kitMode: true` для consumer-container — композитные сборки
разнотипных приборов (кондиционер + 1-2 наружных блока) с внутренними
kit-internal cables. Топология переменная (cond-only / cond+1 / cond+2).
- **Phase 1** (v0.60.250–251): schema (`kitMode` flag) +
  `_markKitInternalConns()` в recalc + verification что BFS не skipает
  kit-internal (visitedConsumers предотвращает двойной счёт).
- **Phase 2** (v0.60.255): UI toggle «📦 Группа / 🧩 Сборка» в
  «Состав контейнера» modal. 3 пресета добавления: «+ cond (water)»,
  «+ cond + outdoor», «+ cond + 2× outdoor». ATS info banner. Декомпозиция
  «19 (15+4)» в строке Расчёт на карточке cond — суммарное на кабель +
  составляющие в скобках.
- **Phase 3** (v0.60.259): cable journal бейджи 🧩 kit / 🔌 int + новый
  filter «Все соединения / Внешние / Kit-internal / Integrated UPS».
  Help-статья `feature-kit-container.html`.
Файлы: `js/engine/constants.js` (DEFAULTS.kitMode), `js/engine/recalc.js`
(_markKitInternalConns), `js/engine/inspector.js` (modal UI),
`js/engine/render.js` (decomposition), `js/main.js` (cable journal filter),
`help/articles/feature-kit-container.html`.

### ✅ HVAC-derate ИБП (v0.59.605–611)
Авто-детекция HVAC-нагрузок downstream и применение per-subtype derate-коэф.
для номинала ИБП. Per-category UI с editable таблицей коэф., список нагрузок
с показом P_ном и P_eff. category-checkbox toggles all-в-категории.
Файлы: `js/engine/inspector/ups.js`, `js/calc/hvac-derate.js`, ROADMAP-anchor: Фаза 5.5+.

### ✅ Полный ΔU notification chain (v0.59.704–741)
ΔU теперь видим на всех слоях UI:
- Карточки узлов (color-coded badge при превышении 5%/10%);
- Inspector щита/потребителя/связи (cumulative от источника + segment);
- Toast при сохранении схемы с превышением;
- PDF/DOCX отчёт `Проверки и предупреждения` (с дедупликацией одинаковых записей);
- **Cable selection** учитывает ΔU: после ампасити-подбора (IEC 60364-4-43) делается
  пересчёт по ΔU (IEC 60364-5-525) и сечение увеличивается до прохождения нормы.
  Tracking: `c._cableSizeBumpedByVdrop`, `c._cableSizeBumpedFromS`, `c._cableVdropPct`.
- Cumulative `n._deltaUPct` пробрасывается во все node-инспекторы единообразно.

### ✅ Парные поля Power+Current (v0.59.729–738)
Единый UX-паттерн «P_кВт ↔ I_А» с двунаправленным пересчётом через U/cosφ/фазу,
внедрён через 8 модулей:
- `cable/` (calc), `panel-config`, `mv-config` (МВт↔А), `rack-config`,
  `mdc-config`, `ups-config`, `transformer-config` (кВА↔А) + `consumer modal`
  с парными рядами «вся группа / каждый» (4 поля + clamp до Pном×LF).

### ✅ Дизайн-чек-лист «Состояние проектирования»
В инспекторе страницы — список проверок проекта (Источников питания / ИБП /
Распределительных щитов / Потребителей / Без питания / Перегруженных узлов /
ΔU > 5% / Кабелей переполнено / Автоматов In < Iрасч). Кликабельный — ведёт в
`/Проверки и предупреждения`.

### ✅ Методика-агностик (install-mapping)
При переключении между методиками IEC 60364 / ПУЭ 7 / РТМ 36.18.32.4-92 —
автоматический перенос значений (insulation/install-method/conductor type),
чтобы юзер не настраивал заново. `js/methods/install-mapping.js`,
терминология вынесена в `js/methods/terms.js` (label/help-tooltip per methodology).

### ✅ РТМ 36.18.32.4-92 (упорядоченных диаграмм)
Полноценный load-расчёт по РТМ как 3-я методика рядом с IEC и ПУЭ. P_max
calculation, K_max таблицы. Файл: `shared/calc-modules/rtm-load.js`,
`js/methods/rtm.js`.

### ✅ Резервные линии: ΔU + автомат + inspector (v0.59.753–754)
Линии в state='powered' / 'dead' (АВР-резерв, дежурный ДГУ) теперь:
- получают расчётный ΔU по `_maxA` (флаг `_deltaUDesignMode=true`);
- получают автоподбор автомата (для генератор-выходов в т.ч.);
- inspector показывает блок «Нагрузка линии» с оранжевым design-mode баннером.
Затрагивает recalc.js (фильтр `c._state==='active'` снят) и conn.js inspector.

### ✅ Collab improvements (v0.59.739–740)
- Owner display fallback: `lock.name → presence.uid → uid-prefix → 'другой участник'`.
- Stale-lock auto-cleanup: client-side прайн каждые 15с по `lastSeen` ≥ 60с.
  Решает проблему «другой пользователь закрыл вкладку — щиты заблокированы навсегда».
- Defensive фильтр в `decorateRemoteLocks` на случай отставшего прайна.

### ✅ Cloud/local project sync (v0.59.742–743)
При openProject — `setActiveProjectId(porPid)` синхронизирует локальный активный
проект со cloud-схемой, если совпадение есть в LS. Иначе toast-warn о
рассинхроне. Sidebar-badge показывает «⚠ ≠ cloud» при mismatch.

### ✅ УРКМ-блок улучшен (v0.59.755)
- «УКРМ не требуется» вместо «треб. УКРМ: 0.00 kvar» при cos φ ≥ целевого.
- «Наиболее тяжёлый режим» вместо «worst-case» (русификация терминологии).

---

## Фаза 1.27 — Модуль «Проекты» + разделение проектных данных и библиотеки 🟡

**Требование (2026-04-22):** все данные о проектируемом объекте должны
жить в проекте, а не в конфигураторах. Конфигураторы = библиотека шаблонов,
данные объекта = проект. Плюс чёткое разделение «проектируемый объект»
(Raschet-проект) и «действующий объект» (будущий модуль «Управление объектом»).

- [x] **1.27.0** — MVP модуля `projects/` (v0.59.222)
  - LS: `raschet.projects.v1` (метаданные), `raschet.activeProjectId.v1`
  - UI: список проектов, создать/переименовать/удалить, сделать активным
  - Inline-модалки (без window.prompt/confirm/alert)
  - Экспорт/импорт проекта JSON со schema «raschet.project/1»
  - Адаптер `shared/project-storage.js` с API:
    `listProjects / createProject / updateProject / deleteProject /
     getActiveProjectId / setActiveProjectId / ensureDefaultProject /
     projectKey / projectLoad / projectSave / exportProject / importProject`
  - Плитка «📁 Проекты» первой в hub.html
- [x] **1.27.1** — scs-design → проектный неймспейс (закрыто фактически)
  - Все production data ключи `raschet.scs-design.*` → `raschet.project.<pid>.scs-design.*`
    (см. `shared/scheme-orphan-migration.js`, `scs-design.js`).
  - Остаются только session-flags (legacy-migrate-attempted) — не data, OK.
  - В UI модуля — project-badge в шапке (mountHeader project context).
- [x] **1.27.2** — главная схема (`raschet.schema.v1` → проект) (закрыто фактически)
  - engine.scheme.v1 хранится в `raschet.project.<pid>.engine.scheme.v1`
    (см. `shared/project-storage.js`, `js/engine/serialization.js`).
  - Конфигурации (mv/ups/panel) хранятся в схеме как параметры узлов.
- [x] **1.27.3** — scs-config / inventory / facility-inventory → проект (закрыто фактически)
  - Все per-rack данные хранятся под `raschet.project.<pid>.scs-config.*` /
    `raschet.project.<pid>.scs-config.contents.v1` / etc.
  - schema-string `raschet.scs-config.v1` в export — это metadata-tag,
    не storage-key.
- [x] **1.27.4** — ExportProject содержит ВСЕ scoped-данные (полный backup) (закрыто фактически в shared/project-storage.js — `collectScoped()` собирает все ключи `raschet.project.<pid>.*` без явных whitelist'ов; exportProject упаковывает их в JSON-blob `{ schema, exportedAt, project, scoped }`. importProject восстанавливает.)
  - Учитывается: что именно входит в «Объём поставки» на основе проекта (BOM-аспект — отдельная задача)
- [x] **1.27.5** — статусы проекта: `draft | planned | installed | operating` (закрыто v0.59.797)
  - Фильтр в списке проектов по статусу: chip-bar с группировкой
    «Проектирование» (draft/planned) / «Объект» (installed/operating) /
    архив. Каждый chip — toggle, с цифрой количества проектов.
  - Состояние filter сохраняется в LS (raschet.projects.statusFilter.v1).
  - Кнопка «Все» — показать все статусы.

**Правила разделения (acceptance):**
- Конфигуратор (rack-config / mv-config / ups-config / pdu-config / panel-config /
  transformer-config / mdc-config / suppression-config) хранит ТОЛЬКО сохранённые
  пользователем шаблоны (по кнопке «Сохранить»).
- В проекте лежат ЭКЗЕМПЛЯРЫ с копией параметров или с референсом на шаблон +
  оверрайдами.
- Каталоги (elements, breakers, cable-types, цены) — ГЛОБАЛЬНЫЕ, общие для всех проектов.
- Данные проекта видимы только при выбранном активном проекте.

---

## Фаза 1.28 — Project Object Registry (POR) 🟡 PoC активен

**Требование (2026-04-26):** мульти-инженерное проектирование — несколько
инженеров (технолог, электрик, СКС, климат) работают над общим объектом
без дублирования данных. Объект, добавленный одним инженером, виден всем,
но каждый инженер видит/правит свои домены атрибутов.

**Архитектура:**
- `shared/por.js` — slim-ядро (CRUD + pubsub + ports + registry-driven factory)
- `shared/por-types/<id>.js` — type-definitions (`rack`, `consumer-group`,
  `consumer-system`, `site`/`building`/`floor`/`space` containers)
- `shared/data-adapter.js` — контракт «как получить данные» (LS/POR-backed)
- `shared/por-adapters.js` — POR-backed реализации DataAdapter
- `shared/project-bootstrap.js` — регистрирует POR-адаптеры на проектном уровне
- `shared/engine-por-mirror.js` — engine ↔ POR двусторонний mirror
- `dev/por-playground.html` — тестовая площадка

**Storage:** `raschet.project.<pid>.por.objects.v1` (формат `{ [oid]: obj }`),
in-tab Map + cross-tab через storage event.

**Объект:**
```
{ id, type, subtype, tag, name, manufacturer, model, serialNo, assetId,
  domains: { electrical, scs, mechanical, hvac, suppression, logistics, location },
  views, ownerByDomain, createdBy/At, updatedBy/At, schemaVersion: 1 }
```

- [x] **1.28.0** — POR core + 4 базовых type (v0.59.500–509)
- [x] **1.28.1** — Engine ↔ POR mirror: на каждый `consumer/rack` engine-узел
  создаётся POR `type='rack'`. Pull POR-only racks → unplaced engine-узлы (v0.59.519)
- [x] **1.28.2** — scs-config / racks-list / scs-design читают POR через
  `loadAllRacksForActiveProject` (v0.59.516, v0.59.521)
- [x] **1.28.3** — Consumer-group (composed/anonymous): `members[] + count`,
  materializeGroupSlot/materializeAllSlots (v0.59.500+)
- [x] **1.28.4** — Деаноним sketch-проектов после v0.59.372: orphan-sketches
  открываемы из /projects/ + видны в scs-design parent-dropdown (v0.59.531)
- [x] **1.28.5** — Виртуалы для Компоновщика: scs-config sidebar раскрывает
  consumer-rack count=N узлы схемы и POR consumer-group rack-членов в
  индивидуальные слоты (v0.59.532)
- [ ] **1.28.6** — Domain-scoped locks (электрик правит electrical-домен,
  не блокируя SCS-инженера на scs-домене того же объекта)
- [x] **1.28.7** — Реальное наполнение vs запрошенная мощность: отдельный UI
  «contentsBasedKw vs demandKw» без записи в electrical-домен (закрыто фактически в scs-config.js строки 740-798: sidebar показывает «факт / запрос / макс PDU» с % и подсветкой при перегрузе. Σ powerW по контенту НЕ пишется в POR — соответствует требованию «без записи в electrical-домен» из v0.59.530 revert).
- [ ] **1.28.8** — Migrate всех модулей на DataAdapter contract (config readers
  не должны импортировать `shared/por.js` напрямую — только через adapter)

- [~] **1.28.9** — Авто-merge при drag-drop совместимых ПОТРЕБИТЕЛЕЙ в группу (частично закрыто v0.59.758: базовый mouseup-merge для consumer-узлов работает, без модалки подтверждения и без специфики rack/POR-merge)
  - Пользователь (2026-04-28 / 2026-04-29 расширение):
    «при перетаскивании потребителя на другой потребитель с аналогичными
    электрическими характеристиками — создавать групповой потребитель
    автоматически, перетаскивание на группу — добавлять количество.
    Применить для ВСЕХ типов потребителей (не только стоек).»
  - Hit-test на drop ноды на ноду: попадание в bbox + типы совместимы
    (consumer ↔ consumer, rack ↔ rack/consumer-rack).
  - Совместимость: phases, voltageLevelIdx, cosPhi, demandKw ±5%,
    consumerSubtype. Для rack ещё widthMm/depthMm/rackUnits.
  - Совместимы → модалка подтверждения → автокачение в групповой узел
    (consumer.count++ или создание новой группы с count=2). Для rack
    — создание / расширение consumer-group POR-объекта с `members[]`.
  - Несовместимы → drop как отдельная нода рядом + toast с указанием
    различающихся параметров.
  - Применяется ко всем consumer-subtype (not only rack).

- [x] **1.28.10** — Cross-discipline reconciliation (полностью закрыто v0.59.813)
  - IDENTIFY-AS (1:1 alias) — v0.59.761/763/764/765
  - IDENTIFY-AS (1:N через slot picker в Группа-tab) — v0.59.766
  - Compatibility-gated auto-merge при drag canvas-canvas — v0.59.812
  - **Полный merge двух групп** «🔀 Похожие группы» — v0.59.813:
    auto-detect candidate-групп по subtype + count(±20%), кнопка
    «Объединить» с tag-match merge: aliases с уникальным tag
    переносятся, дубликаты по tag пропускаются, удаляемая группа
    исчезает с очисткой back-references.
  - Юзер (2026-04-28, feedback_rack_merge.md): «электрик уже разместил
    стойки от себя и технолог добавил стойки в СКС → возможность
    сопоставить эти стойки а не размещать дважды и перерисовывать связи».
  - Юзер (2026-04-29 уточнение): «как связать размещенную стойку с
    стойкой из СКС CR1 и CR01 именно не соединить а заменить по факту,
    сказать что размещенная на схеме стойка CR1 это на самом деле не
    размещенная CR01». Это **IDENTIFY-AS**, отличается от MERGE-INTO-GROUP.

  **Два сценария:**

  **A) GROUP-MERGE (1:N)** — частично готово v0.59.761/763.
  Электрическая группа SR1 (count=8) поглощает одиночные SR01-SR08.
  Picker в Группа-tab. count++, source удаляется, метаданные в
  linkedMembers[]. Применимо когда параметры совпадают и нужна
  electrical-абстракция «8 одинаковых стоек».

  **B) IDENTIFY-AS (1:1)** — НЕ реализовано.
  Размещённая на схеме CR1 (электрическая 1-фазная 7 кВт) и неразмещённая
  CR01 (механическая/SCS, 8.8 кВт 3ф) — РАЗНЫЕ POR-объекты, но юзер
  утверждает «это одна и та же физическая стойка, у электрика и у
  технолога разные представления». Нужен mechanism «alias»:
    - В Общее-tab consumer-инспектора (видно при count=1) — секция
      «🔗 Это тот же объект, что:» с picker для standalone consumers /
      POR-инстансов.
    - При выборе target — устанавливается двусторонняя связь
      `n.linkedAlias = target.id`, `target.linkedAlias = n.id`.
    - Обе ноды остаются в state.nodes (не удаляются), но визуально
      target помечается «🔗 alias for n.tag» (в палитре «Неразмещённые»
      с серым цветом + иконкой). При hover на одной — подсветка другой.
    - Атрибуты не сливаются: каждая нода хранит СВОИ параметры
      (electrical-подход у CR1, mechanical у CR01). Cross-tab consistency
      через POR domain ownership (электрик не правит mechanical, и
      наоборот).
    - Кнопка «🔓 Разорвать связь» — удаляет linkedAlias с обеих сторон.

  **C) MERGE с переадресацией ссылок** (продвинутый MERGE для rack):
  Если юзер выбирает не identify-as, а полный merge (нет двух разных
  параметров — это просто дубликат), переадресация ссылок engine.node /
  scs-config / links / placements на master.id, удаление slave POR.

  **Auto-suggest**: при создании rack-объекта с tag, совпадающим по
  префиксу с существующим в другом домене (CR1 ↔ CR01, SR1 ↔ SR01-08) —
  toast «Похожий объект уже есть — связать?».

  **Приоритеты доменов**: электрик управляет ТОЛЬКО `panelDesignation`
  (обозначение щита) в `domains.electrical`. Остальные поля (name, tag,
  mechanical, scs, demandKw, cosPhi, phases, voltageV) — приоритет
  технолога/SCS-инженера. При конфликте параметров — версия технолога
  (кроме panelDesignation).

  **UI**: при попытке электрика отредактировать поле, не относящееся
  к щитам, — warning «Это поле управляется технологом».

- [x] **1.28.11** — Tombstones для предотвращения резурекции (закрыто v0.59.781)
  - Юзер (2026-04-28): «удаление стоек A-01, A-02 не приводит к их
    удалению, после перезагрузки страницы они вновь появляются».
  - При удалении rack-узла из «Неразмещённые» (× в палитре):
    POR-объект удаляется → но `migrateProjectLegacyRacks` на следующий
    bootstrap пересоздаёт его из legacy storage (rack-config.instances /
    scs-config.rackTags / scs-config.contents).
  - Решение: tombstones-список deleted rack-id в LS
    `raschet.project.<pid>.rack-config.tombstones.v1`.
    `_collectLegacyRacks` фильтрует по списку → resurrected ids
    больше не возвращаются.
  - Также cleanup legacy entries (rackTags, contents) при удалении.

- [x] **1.28.12** — Вкладка «👥 Группа» в свойствах потребителя (закрыто v0.59.757)
  - Пользователь (2026-04-29): «Список потребителей разместить в отдельной
    вкладке свойств потребителя `Группа`, которая отображается только тогда
    когда потребитель групповой».
  - В консьюмер-модалке (consumer.js) добавляется 4-я вкладка `[data-tab="group"]`
    рядом с «Общее / Электрика / Габариты». Видна только при count > 1.
  - Содержимое вкладки:
    - Для `groupMode='individual'` — текущий items-list (cp-items-wrap)
      с per-item параметрами. Перенесён из «Электрика».
    - Для `groupMode='uniform'` — список связанных POR-инстансов (для rack —
      по `consumer-group.members[]`), кнопка «🔗 Связать с существующим
      потребителем…», кнопка «✂ Исключить экземпляр» (см. 1.28.13).
  - Active-tab при открытии модалки автоматически = «Группа», если
    consumer.count > 1.

- [x] **1.28.13** — Исключение конкретного экземпляра из группы (split-out) (закрыто v0.59.777)
  - Пользователь (2026-04-29): «Добавить исключение конкретного экземпляра
    из группы».
  - Кнопка «✂ Исключить» рядом с каждым членом группы во вкладке «Группа».
  - Действие: создаёт новый одиночный consumer-узел рядом с группой
    (копия параметров), уменьшает count группы на 1. Для rack — отделяет
    POR-rack из `consumer-group.members[]` в standalone POR-rack.
  - Обратная операция: 1.28.9 (drag-drop одиночного на группу = вернуть).
  - Reverse-history snapshot перед split, чтобы Ctrl+Z восстановил группу.

- [x] **1.28.15** — Auto-display обозначения группы по первому связанному экземпляру (закрыто v0.59.774)
  - Пользователь (2026-04-29): «группа потребителей должна иметь обозначение
    по обозначению первого экземпляра (не размещенного а по сортировке)».
  - `effectiveTag(n)` для consumer-группы с `linkedAliases[]` возвращает
    обозначение первого alias'а в естественной сортировке (SR01 < SR10),
    вместо raw `n.tag`. Применяется везде где используется effectiveTag:
    модалка свойств, реестр, унплейс-список, canvas-карточка, BOM,
    экспорт SVG/PNG.
  - Сам `n.tag` группы не меняется (остаётся уникальным для save/load
    и nextFreeTag) — только display-derived.

- [~] **1.28.20** — Контейнер потребителей как отдельный node-type (НОВАЯ модель, активна с v0.59.815) 🟡
  - **Сосуществование двух моделей** (уточнение пользователя 2026-04-30):
    - **Group consumer (uniform)** — существующий `consumer` с `count>1`,
      `groupMode='uniform'`. Однородная масса (типа «10 лампочек × 50 Вт»).
      Идентичность членов НЕ важна. Один узел. Сохраняется как есть.
    - **Consumer container** — новый `consumer-container` тип. Идентичность
      каждого члена ВАЖНА (SR01, SR02, SR03). Каждый слот — независимый
      consumer-узел или placeholder. Сам контейнер — обёртка.
    - Слот контейнера может содержать group-consumer (count>1) — например
      «один слот = 10 лампочек × 50 Вт» — пользователь не должен создавать
      10 узлов когда массовое освещение в группе.
  - 
  - Пользователь (2026-04-30): «давай текущий групповой потребитель преобразуем
    в контейнер простых (одиночных) потребителей. Вид остается такой же, но
    сам групповой потребитель не фиксируется в реестрах и не считается
    потребителем, а только контейнером. Входящие в него потребители
    управляются как обычный потребитель. Контейнер может содержать слоты
    заглушки, когда настоящие потребители еще не определены, но считать
    и планировать уже нужно».
  - Также (2026-04-30): «объект контейнер потребителей принимает обозначение
    объекта с самым младшим обозначением (по сортировке)».
  - Уточнение (2026-04-30): требование с template/maxCount/маской — это про
    «Концепция стоек» в Технолог-ЦОД, а не про схематический контейнер.
    Схематический контейнер — без своих параметров, каждый слот независим.
  - **Концепция:** в схематическом редакторе появляется новый тип узла
    `consumer-container`. Контейнер сам — НЕ потребитель: нет demandKw/
    cosPhi/phase, не учитывается в реестре как consumer, не считается
    потребителем напрямую в recalc/POR/BOM. Каждый слот — независимая
    сущность: либо ссылка на реальный consumer-узел (linked, скрыт с
    canvas), либо placeholder-спецификация (без id, anonymous). Tag
    контейнера = младший tag среди linked-членов.
  - **Phase 1 — Foundation (закрыто v0.59.815):**
    - DEFAULTS для `consumer-container` в constants.js
    - Helpers в zones.js: containerLinkedConsumers, containerPlaceholders,
      containerSlotCount, isInContainer, _firstSortedAlias расширен для
      нового типа
    - state.isOnCurrentPage скрывает consumer с containerId
    - electrical.consumerTotalDemandKw/CountEffective раскрывают slots
    - TAG_PREFIX для нового типа = 'GR'
  - **Phase 2 — Render (закрыто v0.59.816):**
    - render.js: контейнер всегда стопкой карточек (peek 24px), даже с
      одним слотом (визуальный сигнал «это группа, не одиночный»)
    - gLabel формирует «Σ kW (N слотов)» для контейнера
    - Иконка контейнера = consumerSubtype первого linked-члена (или
      placeholder.subtype). Если slots пустые — 'custom'.
    - effectiveTag/Name контейнера автоматически = младший tag/name
      среди linked-членов (placeholders без tag не участвуют)
  - **Phase 5 — Migration ENABLED (закрыто v0.59.821):**
    - serialization.js `_migrateLegacyShellsToContainers()` теперь
      вызывается на каждый load. Legacy shell-aliases группы автоматически
      становятся consumer-container со slots. Один-раз на проект.
    - render.js registry: badge «↪ контейнер X» для членов контейнера
      (через containerId), как и раньше для linkedAlias.
  - **Phase 4 — Container inspector (закрыто v0.59.822):**
    - inspector.js: при выборе consumer-container показывает Σ-нагрузку и
      список слотов с действиями:
      • Linked-slot: click row → открыть инспектор члена; ↗ извлечь
        (split-out: член становится standalone consumer на канвасе);
        ✂ разъединить (член → placeholder, узел удаляется).
      • Placeholder-slot: inline edit kW; ⊕ materialize (создать реальный
        consumer с этой спекой как член контейнера); × удалить.
      • Битая ссылка: × удалить slot.
      • Кнопка ➕ Placeholder-слот (наследует спеку первого linked-члена).
    - Если контейнер опустевает — автоматически удаляется.
  - **Phase 3 — Drop-merge (закрыто v0.59.820):**
    - interaction.js `_mergeIntoContainer(target, source)`: создаёт/пополняет
      consumer-container при drag-drop совместимых консумеров.
    - Логика: target.type==='consumer-container' → добавить в него; target
      имеет containerId → найти контейнер, добавить; иначе → создать
      НОВЫЙ контейнер на месте target'а: target.pageIds/positionsByPage/x/y
      переносятся в контейнер; все state.conns(/sysConns) where ?.nodeId
      ===target.id перенаправляются на container.id; target и source
      становятся скрытыми членами (containerId установлен, pageIds=[]).
    - `_findConsumerOverlapAt` принимает container как валидный target.
    - `_isCompatibleConsumer`: drop на existing container всегда совместим
      (сам контейнер параметров не имеет); drop контейнера на consumer
      запрещён (только consumer на container).
    - Заменяет вызовы `_aliasConsumerToGroup` на `_mergeIntoContainer`
      в двух call-sites (drop unplaced→canvas, mouseup-merge).
    - Старый _aliasConsumerToGroup остаётся в файле как dead code до
      Phase 5 enable + Phase 4 manual link picker.
  - **Hotfix v0.59.824 — визуальный фикс:**
    - render.js: контейнер наследует CSS class `consumer` (не чёрный).
    - geometry.js nodeInputCount: контейнер берёт max inputs от членов.
  - **Phase 7 — Sync с «Концепцией стоек» (handoff, закрыто v0.59.833):**
    - tech-workspace handoff (`_buildSchemeFromConcept`): для каждой
      группы стоек создаётся `consumer-container` с N placeholder-слотами,
      где N = rg.count, спека = {demandKw: rg.kwPerRack, cosPhi:0.95,
      phase:'3ph', voltage:400, subtype:'rack'}.
    - Раньше создавался один `consumer count=N` (uniform group). Теперь —
      контейнер с placeholders, что позволяет:
        • технологу/электрику материализовать каждый слот в реальную
          стойку с уникальным tag (SR01..SRN) через инспектор / модалку
        • drop-merge новых стоек на канвасе → попадают в свободные слоты
        • cross-discipline reconciliation работает естественно
    - Поле `_conceptRgId` на контейнере хранит привязку к группе концепции
      (для будущей двусторонней синхронизации).
  - **Защита от удаления связанного объекта (1.28.6 partial):**
    - **v0.59.831** — graph.js deleteNode: hard-delete блокируется при
      наличии state.conns или state.sysConns. Toast: «подключён к
      другим элементам — сначала снимите все линии».
    - **v0.59.832** — cross-module check `_findCrossModuleReferences`:
      читает `scs-design.links.v1` (project-namespace), ищет узел в
      fromRackId/toRackId. Toast: «используется в модуле СКС-проектирование
      (связей: N)».
    - Inspector контейнера: ✂ Разъединить и × Удалить slot теперь НЕ
      удаляют consumer — он становится unplaced (containerId снят,
      pageIds=[]). Пользователь: «электрик максимум мог их выкинуть из
      группы, но не мог удалить их с проекта».
  - **Phase 9 — Convert container ⇆ consumer (закрыто v0.59.827):**
    - Кнопка «⇆ В группового потребителя» в инспекторе контейнера:
      сворачивает container в одиночный `consumer` с count=N, demandKw=
      средняя по slot'ам, cosφ/phase/voltage/subtype от первого slot'а.
      Линии re-routes на новый узел; все linked-member узлы удаляются;
      сам контейнер удаляется. Destructive — с rsConfirm подтверждением.
    - Обратное направление (consumer count>1 → container) уже доступно
      через drop-merge (Phase 3) — drop одного consumer на другой создаёт
      container с двумя linked-членами.
    - Пользователь: «Давай сделаем просто внутри переключатель, это
      групповой потребитель или группа с одинаковым управлением».
  - **Phase 8 — Modal по dblclick (закрыто v0.59.825):**
    - index.html: `<div id="modal-container-members">` — широкая модалка.
    - inspector.js `openContainerMembersModal(container)` — рендерит сетку
      карточек: linked-член (tag/name/P/cosφ/фаза/U + кнопки ⚙ Edit /
      ↗ Extract / ✂ Unlink / × Remove) и placeholder (inline edit kW/cos
      + ⊕ Materialize / × Remove). Кнопка ➕ Добавить placeholder внизу.
    - interaction.js: dblclick на consumer-container → openContainer
      MembersModal через window.__raschetInspector bridge.
    - Пользователь: «По клику на группе лучше открывать модальное окно
      где отображаются обычные карточки потребителей, так понятней».
  - **Phase 6 ext — voltage/phase fallback (закрыто v0.59.823):**
    - electrical.js: `nodeVoltage`, `nodeVoltageLN`, `isThreePhase`
      возвращают значения от первого linked-члена для consumer-container.
      Если linked нет — fallback на placeholder.
    - recalc.js per-line cos: `toN.type === 'consumer-container'` → cos
      взвешенный средний по слотам (linked × demandKw + placeholder ×
      demandKw). Это правильно для подбора кабеля линии panel→container.
  - **Phase 6 baseline — Recalc (закрыто v0.59.819):**
    - electrical.js: `isConsumerLike(n)` + `expandConsumerLike(n)` —
      хелперы для агрегации нагрузки контейнера.
    - recalc.js: `collectDownstreamConsumers` теперь раскрывает container
      на per-slot записи (linked → реальный узел с его per-unit/count;
      placeholder → одна запись со спекой). Это критично для подбора
      автомата материнского щита по РТМ (n_э зависит от индивидуальных
      P_ном).
    - recalc.js: `simpleDownstream` суммирует kW slot'ов контейнера для
      ИБП-агрегации.
    - recalc.js: UPS-аггрегация (collectDownstream) принимает container
      как consumer-узел через consumerTotalDemandKw (Phase 1 helper).
    - **Не покрыто (Phase 6 extended, следующие коммиты):**
      per-line breaker/cable derivation для container.slots; phase
      balance; serialMode/lineGroup для членов контейнера; POR-mirror;
      Реестр (правая панель) пока показывает container как unknown type.
  - **Открыто (следующие коммиты):**
    - Phase 2: render контейнера как stacked card (использует effectiveTag/
      Name из linked-членов); contained consumers скрыты с canvas
    - Phase 3: drop-merge — drop consumer на consumer/контейнер создаёт/
      пополняет контейнер (без template-constraints, любые параметры)
    - Phase 4: инспектор контейнера — слоты (linked rows + placeholder rows)
      + cross-discipline merge с другим контейнером
    - Phase 5: миграция legacy-shell (linkedAliases) → контейнер + members
      на загрузке проекта
    - Phase 6: registry/POR/BOM — контейнер скрыт как consumer; его linked-
      члены отображаются как самостоятельные элементы; placeholders отдельной
      строкой «слот ×N» в реестре контейнера
    - Phase 7: connection ports — контейнер принимает вход от родительского
      шкафа; вход «расщепляется» на linked-членов (учёт нагрузки в recalc)
  - **Не входит в задачу 1.28.20:** sync с «Концепция стоек» в Технолог-ЦОД
    (отдельная задача в Фазе 20 — концепт-группа порождает контейнер на
    схеме при handoff'е).

- [x] **1.28.19** — Shell-container model (закрыто v0.59.793: effective-getters в zones.js + alias-modal lock с inheritance banner)
  - Юзер: «элемент размещенный в групповом потребителе (контейнере) не
    считается привязанным, он сами размещается, просто отображается не
    индивидуально а в контейнере (групповой потребитель). Групповой
    потребитель как самостоятельная сущность в этом случае не используется.
    Элемент с наименьшим номером является оболочкой а все остальные
    размещаются в нем. При этом свойства расположенных внутри объектов
    связаны с основным (кроме обозначений)».
  - Концепция: НЕТ отдельной абстрактной group-ноды. Реальный consumer
    с самым младшим tag'ом является «оболочкой» (shell) и содержит
    остальные. Свойства inside-объектов (электрика) наследуются от shell;
    индивидуальны только tag/name.
  - Закрыто v0.59.790: revert v0.59.784 — group-контейнер снова виден
    в реестре (он же shell). Юзер: «ты зачем то скрыл групповые
    потребители контейнеры, вместо позиций из неразмещенных».
  - Открыто:
    - Property inheritance: alias.demandKw/cosPhi/voltage/phase читаются
      из shell в render/recalc (а не из своих локальных полей).
    - Removal of abstract group: миграция данных, где сейчас group =
      synthetic node (count=N + linkedAliases) → group превращается в
      first sorted alias (теперь shell), эта нода имеет containedIds[]
      указывающие на остальных.
    - Шелл может меняться: при добавлении alias с меньшим tag'ом он
      становится shell.

- [x] **1.28.18** — Group-as-container: alias-источник скрывается с canvas и из всех POR-листов (закрыто v0.59.776)
  - Пользователь (2026-04-30): «при связи не должно оставаться исходной
    карточки, она должна быть внутри, в группе и доступная для
    редактирования, по сути групповой потребитель это просто контейнер».
  - Также (2026-04-30): «сгруппированные или связанные элементы должны
    удалятся из списка отдельных элементов».
  - Поведение при alias-link:
    - source.pageIds → [] (узел unplaced, но в state.nodes остаётся).
    - source.positionsByPage → {}.
    - Все connections (state.conns + state.sysConns) с участием source
      удаляются (orphan-линий не остаётся).
    - source доступен через Группа-tab → click slot → openConsumerParamsModal.
  - Render-фильтры:
    - `isOnCurrentPage(obj)` возвращает false если obj.linkedAlias →
      существующая нода (auto-hide для всех ранее связанных нод).
    - dev/por-playground.html: чекбокс «Показать связанные/групповые»
      (по умолчанию выкл) скрывает POR-объекты с tag = engine consumer-узлу
      с непустым linkedAliases (родителей групп типа SR1).
    - shared/scheme-rack-bridge.js: loadSchemeVirtualRacks skip linked
      slot — alias-узел отдельный consumer-node и эмитит свой виртуал
      самостоятельно (нет дублей SR1-1...SR1-8 vs SR01...SR08).
  - При unlink (✂) — pageIds остаётся [] → toast «узел в Неразмещённые,
    перетащите на схему».

- [x] **1.28.17** — Ctrl+click по объекту в реестре = центрирование на схеме (закрыто v0.59.775)
  - Пользователь (2026-04-30): «давай добавим клик с ctrl отцентрирует
    по центру экрана выбранный в реестре объект».
  - Ctrl+click (Meta+click на macOS) по `.pal-reg-item` (вне +/× кнопок) →
    переключение страницы (`__raschetSwitchPage`) если узел на другой +
    `centerOnNode(tgt)` + selection. Без Ctrl остаётся обычное поведение
    (открыть свойства).
  - Если узел не размещён ни на одной странице — toast «не размещён».
  - Также применено для cp-slot-locate в Группа-tab (смена страницы
    через switchPage вместо прямого присваивания state.currentPageId).

- [x] **1.28.16** — Click-навигация по слотам группы (закрыто v0.59.773)
  - Пользователь (2026-04-30): «По клику нужно открывать свойства, а по
    клику на зеленом кружке, переходить к месту расположения на схеме
    с центрированием по центру экрана».
  - Клик по строке slot[data-slot-state="linked"] (вне ✂ и 🔗) →
    `openConsumerParamsModal(linkedNode)`.
  - Клик по 🔗 (cp-slot-locate) → `centerOnNode(linkedNode)` + переключение
    страницы если alias на другой + закрытие модалки.
  - Блокировка re-drag linked-aliased узлов из реестра/неразмещённых
    (draggable=false + opacity 0.7 + cursor:not-allowed + warning toast
    в interaction.js dragstart).

- [x] **1.28.14** — Уведомление электрика об изменении параметров связанных POR-инстансов (закрыто v0.59.777)
  - Пользователь (2026-04-29): «Если после размещения, технолог изменит
    мощность отдельных стоек, то нужно уведомить электрика об этом».
  - При связи через 1.28.10 (link existing) сохраняется `consumer-group.
    linkedPorIds[]` или похожая структура, отмечающая «эта электрическая
    группа = эти POR-инстансы».
  - Watcher (POR pubsub): при изменении атрибута `domains.mechanical.demandKw`
    (или electrical.demandKw, или scs.contents) у любого linked POR-объекта,
    сравнить с проектным параметром группы → если расхождение > 5%:
    1. Показать badge на узле группы: «⚠ N связанных стоек изменились
       (технолог обновил мощность)».
    2. В Группа-tab инспектора — список расхождений: «SR03: было 7 кВт,
       стало 10 кВт (+43%); SR05: было 7, стало 8.8 (+26%)».
    3. Кнопки «📥 Принять новые параметры» (увеличить group.demandKw до
       max linked) или «🚫 Игнорировать» (снять warning, оставить старое).
  - Хранение «принято/игнорировано»: `group._lastAcknowledgedAt` timestamp,
    при следующем изменении после ack — снова появляется warning.
  - Cross-tab: badge сразу обновляется в открытом табе электрика когда
    технолог сохраняет изменение в scs-config (через storage event).

**Acceptance:**
- Один и тот же rack виден SCS-инженеру (как корпус с U-юнитами и contents)
  и электрику (как нагрузка с demandKw/cosPhi/phases).
- Изменение в одном модуле сразу видно в другом (cross-tab sync через
  storage event).
- `demandKw` (запрошенная электриком) и `contentsBasedKw` (фактическая по
  наполнению) — разные поля; кабель/автомат считаются по `demandKw`.
- Группа ×N в принципиалке — один узел для электрика, N посадочных мест
  для SCS-инженера в Компоновщике.

---

> **Фаза «Отделяемые модули + Управление объектом» перенесена в конец
> документа как самостоятельный большой этап** (см. в самом низу, после
> всех текущих фаз — «Фаза 17 — Управление объектом как отдельный продукт»).

---
## История (до 0.59.222)

> Старая верхняя сводка (до архитектурного разворота).
> **Был статус:** v0.59.153. Полностью завершены: Фазы 0, 1.1–1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.15, 1.19 (MV-оборудование), 1.20 (таблица кабелей), 1.21.x (help-панель), 1.22 (категории), **Фаза 10 — MDC/GDM-600 конфигуратор ЦОД** (10.1–10.4), **Фаза 11 — АГПТ-конфигуратор** (все 9 подфаз, СП 485 + Annex D + NFPA 2001 + ISO 14520, валидационные тесты). В работе: **Фаза 1.23** — rack-config (10/10 ✅, включая unit-map SVG) и **Фаза 1.24** — scs-config (7/8 ✅ MVP + drag-n-drop + PDU-интеграция + шаблоны сборок). Добавлены ТЗ: **1.24-ext** (двухвидовой редактор СКС/Питание, каталог-палитра, 1–8 вводов питания, внешние порты стойки, ATS rack-mount, запрет передачи мощности оборудования в главную схему) и **Фаза 1.25** — `inter-rack-scs/` (межстоечная СКС-схема top-down). Следующее: реализация 1.24-ext → 1.25 → 1.6 logistics → Phase 2 мульти-пространственные схемы.
> **Цель:** единая платформа проектирования инженерных систем — электрические и механические схемы, модульные ЦОД (MDC/GDM-600), газовое пожаротушение (АГПТ), СКС (внутри- и межстоечная), тепловой расчёт/PUE — с общей библиотекой элементов, мульти-пространственными видами, 3D-вьюером, ролями пользователей (user/catalog-admin/admin), централизованной БД каталога и генерацией комплекта документации (однолинейка + планы + BOM + «Объём поставки» + отчёты).

---

## Как использовать этот документ

Документ лежит в git (`ROADMAP.md`) и доступен в любой сессии чата. Перед началом работы прочитай:

1. Этот файл — понять где остановились
2. Модуль `changelog/` и git-лог — последние коммиты и фазы
3. `C:\Users\sedko\.claude\projects\D--Works-ClaudeProject-raschet\memory\MEMORY.md` — предпочтения пользователя (deploy, style, input-event, версионирование)

После каждой выполненной фазы/подфазы — ставь галочку в соответствующем чеклисте. История изменений — в отдельном модуле, сюда не дублируется.

---

## Контекст проекта

Платформа `https://daniil248.github.io/raschet/` состоит из:

- **Конструктор схем** (`index.html` + `js/engine/*`) — главный, drag-n-drop граф электроснабжения
- **Расчёт кабельной линии** (`cable/`) — standalone калькулятор IEC/ПУЭ
- **Схема принципиальная** (`schematic/`) — SVG редактор IEC 60617 с ISO paper sizes
- **Расчёт АКБ** (`battery/`) — подбор батарей по таблицам разряда
- **Конфигуратор ИБП** (`ups-config/`) — WIP
- **Конфигуратор щита** (`panel-config/`) — WIP
- **Конфигуратор трансформатора** (`transformer-config/`) — WIP
- **Шаблоны отчётов** (`reports/`) — конструктор PDF/DOCX
- **3D конфигуратор** (`configurator3d/`) — untracked прототип three.js (не интегрирован)

**Общая инфраструктура:**
- `shared/global-settings.js` — единый источник настроек (**закреплено в Фазе 0.1**)
- `shared/{panel,ups,battery,transformer}-catalog.js` — 4 per-user каталога (будут унифицированы в Фазе 1)
- `shared/cable-types-catalog.js` — каталог кабелей (**создан в Фазе 0.3**)
- `shared/catalog-xlsx-parser.js` — унифицированный парсер XLSX для 3 каталогов
- `shared/report/` — конструктор отчётов (PDF/DOCX)
- `shared/auth.js` — Firebase OAuth + localStorage fallback
- `js/projects.js` — dual-adapter storage (Firestore/localStorage)
- `js/engine/state.js` — central state: nodes, conns, pages, zones, modes
- `js/engine/zones.js` — рекурсивные зоны с `effectiveTag()` (префикс `"Z1.AC1"`)
- `modules.json` — манифест модулей (**создан в Фазе 0.5**)

**Память пользователя** (важно для сотрудничества):
- Делать молча, не переспрашивать, минимум слов
- После push — проверить деплой через ~45 сек (`WebFetch https://daniil248.github.io/raschet/...`)
- Каждый коммит — обновлять `APP_VERSION` в `js/engine/constants.js`
- В таблицах с re-render использовать `change` event а не `input` (фокус теряется)
- Коммит-сообщение: номер версии + структурированный changelog с файлами

---

## Фазы разработки

### ✅ Фаза 0 — Подготовка фундамента (v0.41.0, завершена)

- [x] **0.1** Единый источник правды GLOBAL (`engine/index.js` загружает через `loadGlobal()`, `setGlobal()` вызывает `saveGlobal()`)
- [x] **0.2** `VOLTAGE_CATEGORIES = {lv,mv,hv,dc}` + `deriveVoltageCategory()` + миграция
- [x] **0.3** `CABLE_CATEGORIES` (power/hv/signal/data/fieldbus/dc) + `shared/cable-types-catalog.js` с 16 базовыми типами
- [x] **0.4** `CONNECTION_KINDS` (electrical/pipe/duct/data) + select в инспекторе
- [x] **0.5** `modules.json` с описанием 8 модулей
- [x] **0.6** `panel-catalog` схема расширена: `material`, `maxHeatDissipationW`; `inputs/outputs/sections` помечены DEPRECATED

**Критичные файлы Фазы 0:**
- `js/engine/constants.js` (VOLTAGE_CATEGORIES, CABLE_CATEGORIES, CONNECTION_KINDS)
- `js/engine/electrical.js` (migrateVoltageLevels с category)
- `js/engine/index.js` (loadGlobal/onGlobalChange)
- `shared/global-settings.js` (DEFAULTS с category, _migrateVoltageLevels)
- `shared/cable-types-catalog.js` (новый, 16 базовых типов)
- `shared/panel-catalog.js` (новая схема)
- `modules.json` (новый, манифест 8 модулей)

---

### 🚧 Фаза 1 — Element Library (в работе, срок 3-4 недели)

**Цель:** один единый справочник элементов вместо 4 раздельных (panel, ups, battery, transformer) + кабели + пользовательские типы потребителей. Элемент хранит: электрика, геометрия, порты, представления для разных типов схем, состав (для модульных).

#### Подфаза 1.1 — Element schema и ElementLibrary API (1 неделя) ✅

- [x] **1.1.1** Создан `shared/element-library.js`:
  - Схема `Element { id, kind, category, label, electrical, geometry, views, composition, kindProps, source, tags, createdAt, updatedAt }`
  - API: `listElements({kind, category, tag, manufacturer})`, `getElement(id)`, `saveElement(el)`, `removeElement(id)`, `cloneElement(id, newName)`, `exportLibraryJSON()`, `importLibraryJSON(json, mode)`, `clearUserElements()`, `onLibraryChange(cb)`
  - Per-user localStorage: `raschet.elementLibrary.v1.<uid>`
  - 11 kind'ов в `ELEMENT_KINDS`: panel/ups/battery/transformer/breaker/enclosure/climate/consumer-type/cable-type/channel/custom
  - Builtin vs user через `_builtins` Map + `registerBuiltin`/`registerBuiltins`/`clearBuiltins`
  - User не может перезаписать builtin (бросает ошибку)

- [x] **1.1.2** Создан `shared/element-schemas.js`:
  - Factory-функции `createPanelElement/createUpsElement/createBatteryElement/createTransformerElement/createCableTypeElement/createBreakerElement/createConsumerTypeElement/createEnclosureElement/createClimateElement`
  - Универсальный `createElement(kind, patch)` с дефолтами
  - Конвертеры legacy ↔ Element: `fromPanelRecord/toPanelRecord`, `fromUpsRecord/toUpsRecord`, `fromBatteryRecord/toBatteryRecord`, `fromTransformerRecord/toTransformerRecord`, `fromCableTypeRecord/toCableTypeRecord`

- [x] **1.1.3** MVP редактор `elements/` (v0.44.0):
  - `elements/index.html` + `elements.css` + `elements-editor.js`
  - Список элементов с группировкой по kind, статистикой и бэйджами (builtin/user/imported)
  - Фильтры: kind, source, свободный поиск (по label/manufacturer/series/variant/id)
  - Actions: view (read-only JSON), edit (user only), clone (builtin+user), delete (user only)
  - Форма редактирования: простые поля (id/kind/label/manufacturer/series/variant/description/tags) + JSON textarea для electrical/geometry/kindProps/composition
  - Create: через prompt ID + пустая форма
  - Import/Export JSON (merge/replace modes)
  - Reactive UI через `onLibraryChange`
  - initCatalogBridge() вызывается — страница видит все legacy-каталоги как builtin
  - Зарегистрирован в `modules.json` + карточка в `hub.html`
  - **НЕ включено в MVP:** загрузка SVG для views, визуальный редактор портов, drag-n-drop composition — откладывается до Фазы 2

#### Подфаза 1.5 — Полноценный модуль catalog/ (1.5-2 недели) 🆕

**Задача пользователя:** `elements/` должен стать отдельным полноценным модулем управления библиотекой/каталогами — с импортом, ценами, контрагентами.

- [x] **1.5.1** Схемы данных (закрыто 2026-04-20):
  - `shared/price-records.js` — `PriceRecord` со всеми полями + расширенные:
    `validFrom/validUntil`, `quantity/MOQ`, `unitOfMeasure`, `discount`,
    `vat`, `vatIncluded`, `conditions`. 6 типов цен (`PRICE_TYPES`) и 6
    валют (`CURRENCIES`). API: `listPrices/getPrice/savePrice/
    removePrice/bulkAddPrices/pricesForElement`, `exportPricesJSON/
    importPricesJSON`, `onPricesChange`.
  - `shared/counterparty-catalog.js` — `CounterpartyRecord` +
    `COUNTERPARTY_TYPES` (7 типов включая warehouse/customer).
    API: `listCounterparties/getCounterparty/saveCounterparty/
    removeCounterparty/makeCounterpartyId/validateInn/onCounterpartiesChange`.
  - Per-user localStorage через `currentUserId()` префикс.
  - Валидация: `savePrice` не позволяет привязать цену к non-pricable
    kind (cable-type линейка — только cable-sku).

- [x] **1.5.2** Новый модуль `catalog/` (закрыто 2026-04-20):
  - `catalog/index.html` + `catalog.js` + `catalog.css`: 5 табов
    (Элементы / Цены / Контрагенты / Импорт / **Аналитика** — бонус).
  - Tab «Элементы»: список с колонкой последней цены, badges
    builtin/user/imported, filters (kind/source/search), действия
    view/edit/clone/delete, «+ Цена» inline, переход «view-prices».
  - Tab «Цены»: `listPrices` с 4 фильтрами (по элементу/контрагенту/
    priceType/currency), сортировка по recordedAt desc.
  - Tab «Контрагенты»: CRUD + фильтр по типу + поиск.
  - `elements/` остаётся как quick-access editor.

- [x] **1.5.3** CRUD цен (закрыто 2026-04-20):
  - `openPriceModal` в catalog.js: Элемент picker + Цена + Валюта +
    Контрагент + Тип цены + Источник + Примечания.
  - `bulkAddPrices` для массовой вставки (используется в импорте XLSX).
  - Редактирование/удаление в таблице цен.
  - _Не реализовано:_ paste-from-clipboard в массовом вводе (есть XLSX
    импорт, этого достаточно).

- [x] **1.5.4** Управление контрагентами (закрыто 2026-04-20):
  - renderCounterpartiesTab + openCounterpartyModal в catalog.js.
  - Поиск по имени/ИНН/КПП/адресу/телефону/email (`listCounterparties`
    filter.search объединяет все поля).
  - `validateInn` (10/12 цифр) в счем. Быстрое добавление inline
    в форме цены через dropdown.

- [x] **1.5.5** Импорт XLSX прайс-листов (v0.57.92):
  - ✅ Drag-drop нескольких файлов, парсинг XLSX через SheetJS.
  - ✅ Авто-маппинг колонок по regex на заголовки.
  - ✅ UI маппинга с dropdown «Колонка файла → Поле прайса».
  - ✅ Привязка к контрагенту на файл + тип цены + источник.
  - ✅ Dry-run preview (первые 5 строк) перед применением.
  - ✅ Импорт JSON (backup) для prices и library.
  - ✅ **v0.57.92:** per-row counterparty override — новая колонка маппинга «Контрагент (per-row)», regex включает counter/vendor/supplier/контрагент/поставщик/продавец. Значение в строке файла приоритетнее глобального выбора; резолвится через Map(id) и Map(shortName/name), неопознанные считаются fallback-глобалом и показывают предупреждение в flash-сообщении.
  - ✅ **v0.57.92:** история импортов (`listImportBatches` в price-records.js) + откат (`rollbackImportBatch(source, minuteBucket)`). UI в tab «Импорт» → секция «История импортов»: таблица (Источник / Дата-время / Записей / Элементов / Валюты / Контрагенты / Откатить). Кнопка «↩ Откатить» удаляет все записи из партии (минутное окно `createdAt / 60000`).

- [x] **1.5.6** Статистика и аналитика (v0.57.89):
  - ✅ Tab «Аналитика» в catalog/: stat cards (элементов / контрагентов /
    цен / с ценами / без цен / устаревшие >90д).
  - ✅ Топ-5 контрагентов по числу цен.
  - ✅ Список элементов без цен с inline «+ Цена».
  - ✅ В табе «Элементы» — колонка с последней ценой на элемент.
  - ✅ **v0.57.89:** колонка «Мин / Макс» + Δ% (только при одной валюте).
  - ✅ **v0.57.89:** колонка «Динамика» со sparkline (SVG polyline 90×24, точки по recordedAt, цвет по тренду red↗/green↘/grey→, подпись `↗/↘/→ N%`, tooltip с first→last и % изменения). Функция `renderPriceSparkline(priceInfo)` в catalog/catalog.js.
  - ⏳ _Не реализовано (опционально):_ отдельная панель алертов устаревших цен.

- [x] **1.5.7** Интеграция с BOM (v0.45.1):
  - `shared/bom.js`:
    - `resolveUnitPrice(elementId, { strategy, currency, counterpartyId, activeOnly })` — 5 стратегий (latest/min/max/avg/counterparty)
    - `PRICE_STRATEGIES` экспорт для UI
    - `aggregateBom(items, opts)`: если `opts` заданы — каждая строка получает unitPrice / currency / totalPrice / priceSource
    - `bomTotals(aggregated)`: сумма по валютам + missingCount / pricedCount
    - `collectBomFromProject(state, opts)` принимает opts, возвращает `{ flat, aggregated, totals }`
  - `js/engine/report-sections.js` → `sectionBom`:
    - Вызов с `{ priceStrategy: 'latest', activeOnly: true }` по умолчанию
    - Колонки «Цена за ед.» + «Итого» появляются если есть хоть одна цена
    - Строки ИТОГО по валюте
    - Предупреждение о позициях без цены со ссылкой на модуль catalog
  - `window.Raschet.getBom(opts) / getBomMarkdown(opts) / getPriceStrategies()`

**Критичные файлы 1.5:**
- `shared/price-records.js` (новый)
- `shared/counterparty-catalog.js` (новый)
- `catalog/index.html`, `catalog/catalog.css`, `catalog/catalog.js` (новые)
- `catalog/tab-elements.js`, `catalog/tab-prices.js`, `catalog/tab-counterparties.js`, `catalog/tab-import.js`
- `shared/catalog-xlsx-parser.js` — расширение на прайс-листы
- `shared/bom.js` — интеграция цен

---

#### Подфаза 1.2 — Bridge и миграция существующих каталогов (1 неделя) 🚧

- [x] **1.2.0** Создан `shared/catalog-bridge.js` (v0.42.1):
  - `syncLegacyToLibrary()` — Promise.all чтение 5 legacy каталогов (panel/ups/battery/transformer/cable-types), конвертация через `from*Record`, регистрация как `builtin` через `registerBuiltins()`
  - Lazy dynamic imports (battery-catalog: пробует `./battery-catalog.js` и `../battery/battery-catalog.js`)
  - `initCatalogBridge()` — idempotent, первый sync + `storage`-event listener для cross-tab pre-синхронизации
  - Интегрирован в `js/engine/index.js` сразу после `onGlobalChange()` подписки
  - Read-only: редактирование продолжает идти через legacy API (`addPanel`, `addUps`…)
  - **Результат:** новые подпрограммы (elements editor, BOM) могут работать через `listElements({kind:'X'})` и видят все данные из legacy-каталогов

- [x] **1.2.1** Same-tab sync listeners (v0.42.2):
  - Добавлены в каждый legacy-каталог: `onPanelsChange/onUpsesChange/onBatteriesChange/onTransformersChange/onCableTypesChange`
  - `_notify()` вызывается после каждого `_write()` в каталоге
  - `catalog-bridge` подписывается через dynamic import + `_subscribeSameTab()`
  - Debounced re-sync (50ms) во избежание повторных обходов при bulk-импорте (XLSX)
  - **Эффект:** `addPanel()` в том же tab — и `listElements({kind:'panel'})` сразу видит новую запись без перезагрузки

- [ ] **1.2.2** Переключение внутренней реализации каталогов на Element-API — **отложено до 1.3+**:
  - `shared/panel-catalog.js`: `listPanels()` → `listElements({kind:'panel'}).map(toPanelRecord)`
  - `addPanel(rec)` → `saveElement(fromPanelRecord(rec))`
  - API остаётся (backward compat)
  - Миграция старых localStorage при первой загрузке (копирование → element-library)
  - Аналогично `ups/battery/transformer/cable-types-catalog`

  **Обоснование отложения (оценка 2026-04-19):**
  - Legacy-каталоги содержат специфичные поля (dischargeTable, vectorGroup, ukPct, moduleKwRated, cable.category/material/fireResistant), которые legacy-код (catalog-manager, pickers, инспекторы) читает напрямую (`record.capacityKw`, не `record.kindProps.capacityKw`). Замена storage backend требует либо (а) двойных конвертеров на каждом чтении, либо (б) рефакторинга всего UI — оба варианта = высокий риск регрессий без тестов.
  - Bridge уже обеспечивает единый read через `listElements()` — новые фичи (BOM, elements editor, поиск) работают без объединения.
  - Strangler fig: сначала freeze legacy, потом flip. Freeze достигается когда весь новый код работает через `listElements()` — это произойдёт в 1.3 (BOM) и 1.4 (ups-config).
  - Риск-бенефит: объединение сейчас = 5 каталогов × миграция + regressions vs. 1 новая фича (BOM) за то же время.
  - **План:** сделать 1.2.2 в Фазе 1.5 (или как микро-подфаза после 1.4), когда весь новый код уже не зависит от нативных схем.

- [x] **1.2.3** `catalog-xlsx-parser.js` — v0.57.85:
  - `parseXlsx(buffer, {kind})` реализован через dispatch к существующим per-kind парсерам (parseUpsXlsx/parsePanelXlsx/parseTransformerXlsx) + ленивый импорт `element-schemas.js` для конвертации legacy → Element
  - Возвращает `{kind, filename, elements, legacy, errors}` — `legacy` сохранён для обратной совместимости с существующими addUps/addPanel/addTransformer
  - `supportedParseXlsxKinds()` — список поддерживаемых kind'ов
  - Поддерживаются: `ups`, `panel`, `transformer`. Battery и cable-type SKU остаются через отдельные пайплайны (battery-data-parser, catalog/tab-import)

#### Подфаза 1.3 — Phantom элементы и BOM (1 неделя) ✅

- [x] **1.3.1** `element.composition: [{elementId, qty, phantom, role}]`:
  - Заложено в `shared/element-library.js` (Element.composition)
  - `expandComposition(element, multiplier, depth, seen, path)` в `shared/bom.js` — рекурсивно, с защитой от циклов (per-branch seen Set)
  - Phantom-признак переносится с ref'а в развёрнутый item (composition-ref может помечать phantom независимо от самого элемента)

- [x] **1.3.2** BOM-генератор `shared/bom.js`:
  - `bomForNode(node)`: 3 стратегии — (1) node.elementId → library, (2) node.composition inline, (3) placeholder по node.type
  - `collectBomFromProject(state)`: обход `state.nodes`, агрегация
  - `aggregateBom(items)`: группировка по `(elementId, role)` или `(label, kind)` для без-id, суммирование qty
  - `groupBomByKind(agg)`: под-группировка для отчёта
  - `bomToMarkdown(agg)`: markdown-таблица (используется в будущем для быстрого превью)
  - Экспорт в `window.Raschet.getBom()` + `getBomMarkdown()` для консоли/внешних консьюмеров

- [x] **1.3.3** Интеграция с отчётами:
  - `js/engine/report-sections.js`: новая секция `sectionBom()`, зарегистрирована как `id: 'bom'` в `getReportSections()`
  - Группировка по kind с человекочитаемыми подписями (ИБП, Щиты, АКБ, Трансформаторы...)
  - Phantom-элементы помечены звёздочкой
  - defaultTemplateId: `builtin-bom-landscape` (альбомная)

#### Подфаза 1.4 — Конфигуратор ИБП из Конструктора схем (1 неделя)

- [x] **1.4.1** BOM резолвит legacy-поля узла как `elementId` (v0.43.1):
  - `_resolveLegacyElementId(node)` в `shared/bom.js`: проверяет `node.elementId` → `upsCatalogId` → `panelCatalogId` → `enclosureId` → `transformerCatalogId`
  - `_syntheticUpsComposition(node)`: для ИБП с `batteryCatalogId` + `batteryStringCount` × `batteryBlocksPerString` — генерирует синтетическую ссылку на АКБ
  - В `bomForNode`: label корня заменяется на `"<node.name> (<element.label>)"` — BOM показывает и пользовательское имя узла, и модель
  - Результат: выбор модели ИБП в инспекторе (сохраняется в `n.upsCatalogId` через `applyUpsModel`) автоматически попадает в BOM без изменений в инспекторе
- [x] **1.4.2** Кнопка в инспекторе ИБП «Сконфигурировать подробно» (v0.43.2):
  - Ссылка `<a href="ups-config/?nodeId=X&selected=Y&capacityKw=Z&upsType=W" target="_blank">` в верхней части модалки ИБП
  - Передаёт контекст через URLSearchParams
- [x] **1.4.3** Storage-канал возврата из `ups-config/` (v0.43.2):
  - ups-config показывает sticky-баннер «Открыто из Конструктора схем» когда URL содержит `?nodeId=...`
  - При клике «Применить к схеме» пишет в `localStorage['raschet.pendingUpsSelection.v1']` = `{ nodeId, ups, selectedAt }`
  - `ups-config` пытается закрыть свою вкладку через 2 сек
  - `js/engine/index.js` слушает `focus` + `storage` event, при наличии payload: `applyUpsModel(node, payload.ups)` + снимок истории + re-render
  - TTL 5 минут: устаревшие payload игнорируются и удаляются
  - Через applyUpsModel узел получает `upsCatalogId` → BOM автоматически включает ИБП
- [x] **1.4.5** Конфигуратор ИБП — wizard (закрыто v0.57.87):
  - `ups-config/ups-config.js` — трёхшаговый wizard (исходные данные → подбор → итог/применение), активируется при `?nodeId=...`
  - Шаг 1 «Исходные данные»: поля `loadKw / autonomyMin / redundancy (N|N+1|N+2|2N) / upsType / vdcMin/Max / cosPhi / phases`, предзаполнение из query-параметров инспектора
  - Шаг 2 «Подбор»: фильтрация каталога по `upsType` и пересечению Vdc-диапазона, `_calcModules()` для модульных (working + redundant ≤ slots), `_pickSuitable()` с авто-выбором первого по утилизации + цена из price-records
  - Шаг 3 «Итог»: сводная таблица, `_buildComposition()` формирует `composition: [{elementId, qty, role}]`, кнопка «Применить» → `raschet.pendingUpsSelection.v1`
  - `js/engine/index.js:_tryConsumePendingUpsSelection()` — применяет `configuration.*` полностью (capacityKw / moduleInstalled / frameKw / moduleKwRated / moduleSlots / redundancyScheme / batteryVdcMin/Max / batteryAutonomyMin / composition)
  - **v0.57.87 дополнение:** inspector/ups.js расширил набор query-параметров (targetAutonomyMin, redundancy, vdcMin/Max, cosPhi, phases) — wizard теперь предзаполняется из узла, а не из статических дефолтов
  - АКБ подбирается отдельно через 1.4.4 (battery picker + battery-calc)

~~Старый план на 5 шагов (frame / modules / batteries / accessories) не реализован как отдельные шаги — слит в 3, поскольку для современных модульных ИБП шаги «frame+modules» неотделимы (фрейм определяет moduleSlots и moduleKwRated). При необходимости разнесения — см. TODO 1.4.6.~~

- [ ] **1.4.5-legacy** (архив) Полный 5-шаговый wizard (frame / modules / batteries / accessories / price) — отложено:
  - **Проблема (со слов пользователя):** При клике «Сконфигурировать подробно» открывается просто справочник выбора модели. Нет:
    1. Передачи исходных данных из Конструктора (нагрузка, автономия, резервирование, условия эксплуатации)
    2. Подбора фрейма по нагрузке
    3. Расчёта количества модулей (N+X резервирование)
    4. Подбора АКБ под конфигурацию
    5. Возврата КОНФИГУРАЦИИ (frame + modules + batteries + accessories), а не просто ID модели
  - **Что нужно:**
    - Переделать `ups-config/` в полноценный конфигуратор:
      - **Шаг 1 «Исходные данные»**: автозаполнение из Constructor (nodeId) — capacityKw нагрузки, targetAutonomyMin, N+X резервирование, cosPhi, phases, условия (temp/altitude)
      - **Шаг 2 «Подбор фрейма»**: показать фреймы из ups-catalog, где frameKw ≥ требуемой с учётом N+X; фильтр по производителю/серии; рекомендация
      - **Шаг 3 «Модули»**: выбранный фрейм → доступные слоты, расчёт рабочих модулей (`ceil(loadKw/moduleKw) + X`); проверка ≤ moduleSlots
      - **Шаг 4 «АКБ»**: интеграция со Step 4 battery-calc; автоподбор strings × blocks по vdcMin/max + capacityKw + autonomyMin
      - **Шаг 5 «Состав и цена»**: итоговая composition `{ frame: 1, modules: N, batteries: S×B }` + суммарная цена через price-records
      - **Кнопка «Применить конфигурацию»**: формирует `Element` (kind='ups') с composition + kindProps, сохраняет в element-library, пишет в pendingUpsSelection → Constructor узел получает `node.elementId` + `node.composition` + все параметры
    - **Интеграция с Constructor:**
      - Кнопка передаёт в query: `nodeId, capacityKw, targetAutonomyMin, redundancy, vdcMin, vdcMax, cosPhi, phases`
      - Возврат: `{ nodeId, elementId, composition, capacityKw, moduleInstalled, frameKw, batteryCatalogId, batteryStringCount, batteryBlocksPerString, totalPrice }`
      - BOM автоматически развёртывает composition через `expandComposition`
    - **Priority:** HIGH — текущий поток вводит в заблуждение (кнопка "Сконфигурировать" а показывает просто выбор модели)
  - **Файлы (предстоит изменить):**
    - `ups-config/index.html` — переделать UI в пошаговый wizard
    - `ups-config/ups-config.js` — wizard logic, подбор, composition builder
    - `js/engine/inspector/ups.js` — передавать больше query params
    - `js/engine/index.js` — ресивер должен применять composition + elementId
    - `shared/ups-picker.js` — `applyUpsConfiguration(node, config)` новая функция
    - `shared/element-schemas.js` — `createUpsElementFromConfig(frame, modules, batteries)`

- [x] **1.4.4** Связь с Конфигуратором АКБ (v0.43.3):
  - В модалке «Параметры батарей» ИБП — кнопка «🔋 Подобрать АКБ в калькуляторе»
  - `battery/?nodeId=X&loadKw=...&vdcMin=...&vdcMax=...&autonomyMin=...&selected=...`
  - `battery/battery-calc.js:initSchemaContext()`: при наличии `?nodeId=`:
    - Переключение на вкладку «Расчёт разряда»
    - Предзаполнение: `calc-load` ← loadKw, `calc-target` ← autonomyMin, `calc-dcv` ← (vdcMin+vdcMax)/2, `calc-battery` ← selected, `calc-mode` = 'required'
    - Sticky-баннер с кнопкой «Применить к схеме»
    - При клике: забирает `lastBatteryCalc`, извлекает `batteryCatalogId` / `strings` / `blocksPerString` / `autonomyMin` / `totalKwh` (с поддержкой двух режимов: 'autonomy' и 'required'), пишет в `localStorage['raschet.pendingBatterySelection.v1']`
  - `engine/index.js:_tryConsumePendingBatterySelection()`: аналогично ИБП-ресиверу, обновляет `node.batteryCatalogId / batteryStringCount / batteryBlocksPerString / batteryAutonomyMin / batteryKwh`, делает snapshot + render + notifyChange
  - TTL 5 минут

**Критичные файлы для Фазы 1:**
- `shared/element-library.js` (новый)
- `shared/element-schemas.js` (новый)
- `shared/bom.js` (новый)
- `elements/index.html` + `elements/elements-editor.js` (новые)
- Рефакторинг: `shared/{panel,ups,battery,transformer,cable-types}-catalog.js`
- `js/engine/inspector/ups.js` — интеграция с ups-config/

#### Подфаза 1.21 — Расширение графа: bypass ИБП и произвольные концы связей

Перенесено из TODO.md (2026-04-20): это крупные фичи на уровне графа,
не разовые исправления. Оба пункта требуют изменения модели связей /
портов и централизованного покрытия по recalc + inspector + render.

- [x] **1.21.1** Индивидуальный режим группы потребителей (v0.57.81):
  `n.groupMode='uniform'|'individual'` + `n.items=[{name,demandKw}]`.
  Helper `consumerTotalDemandKw` в electrical.js заменил 6 inline-
  формул. UI — переключатель и таблица с ➕/✕ в inspector/consumer.js.
  На плашке «Σ T kW (M шт.)» для individual.
- [ ] **1.21.2** Расширение связей — произвольные концы:
  - **Выход → выход** (параллельные щиты от одной шины).
  - **Вход → вход** (перемычки).
  - Переключение конца связи: рукоятка работает и на конце `from`.
  - Тип связи определяется автоматически по тому, какие порты
    соединены.
  - Расчёт: для перемычек вход-вход нагрузка распределяется между
    соединёнными входами как у параллельных входов одного узла.
  - Файлы: `engine/interaction.js` (drag-handles на from-end),
    `engine/graph.js` (валидация), `engine/recalc.js` (новая ветка
    in-in coupling), `engine/render.js` (рисовка не-стандартных
    концов).
- [x] **1.21.3** ИБП — байпасный вход (закрыто 2026-04-20, уже реализовано
  в составе Фазы 1.4):
  - Отдельный байпасный ввод: `n.bypassFeedMode='separate'` даёт порт 1 =
    bypass, порт 0 = основной; при `'jumper'` — перемычка от основного.
  - Поток мимо инвертора при байпасе: `recalc.js` 1097 ветка
    `_onStaticBypass` — КПД=100% (эффективный `eff=1`), батарея не
    обслуживается, зарядный ток = 0.
  - Условия активации: `staticBypassForced` (ручной) или
    `staticBypassAuto` + `overloadRatio > staticBypassOverloadPct` (по
    перегрузу). Реальные ИБП переходят на SBS по перегрузу/аварии
    инвертора, а не при «mains+battery dead» (в этом случае bypass
    невозможен, т.к. запитан от того же mains).
  - Инспектор: секции «Байпас обслуживания (QF4)» и «Статический байпас
    (SBS)» с выбором режимов и порогом.
  - Индикатор режима на плашке: `· БАЙПАС` / `· БАТ mm:ss` в
    load-line (`render.js` 807, 859).

#### Подфаза 1.22 — Вкладка «Общее» + унификация стиля инспектора (новое 2026-04-20)

**Цель:** упорядочить поля инспектора. Сейчас на вкладке «Электрика»
соседствуют tag/name, комментарии и собственно электрические
параметры. Выделяем общий фундамент в отдельную вкладку.

- [x] **1.22.1** Вкладка «📋 Общее» (v0.58.47, v0.58.48) — первая по порядку:
  - обозначение (tag), полное обозначение (effectiveTag),
  - имя, инв.№ / паспорт (`n.assetId`), серийный № (`n.serialNo`),
  - UUID (read-only),
  - для `consumer` — подтип (`n.subtype`: generic / rack / hvac /
    lighting / motor / heater / other); rack → кнопка
    «Конфигуратор стойки» загорается,
  - блок «Модель изделия»: производитель (`n.manufacturer`),
    поле `n.modelRef` + кнопка «🔧 Конфигурировать…» с переходом
    в соответствующий модуль (transformer-config / panel-config /
    mv-config / ups-config / rack-config / scs-config),
  - комментарий.
- [x] Электрика-вкладка очищена: tag/name/комментарии перенесены
  в «Общее» (дублирования нет).
- [x] **1.22.2** Modal-параметры (open*ParamsModal в panel/source/ups)
  тоже получают вкладку «Общее» — v0.58.50: wrapModalWithSystemTabs
  добавляет первой вкладкой «📋 Общее», провязка через
  wireGeneralPanelInputs (не дублирует btn-* из sidebar).
- [x] **1.22.3** Единый CSS-стиль всех `.tp-panel` — v0.58.51:
  первая .inspector-section без верхней границы (не дублирует
  разделитель tp-tabs), цветная полоса слева только на
  системных вкладках (`[data-sys-accent]` + CSS-var --sys-accent).
- [x] **1.22.4** Каталог изделий проекта (MVP) — v0.58.52:
  `state.project.productCatalog[]` с `{id, name, type, subtype,
  manufacturer, modelRef, systemRanges: {sysId: {paramKey:
  {min,max,default}}}}`. Узел ссылается через `n.productId`; панель
  «Общее» показывает селект подходящих изделий (по type/subtype) и
  кнопку «💾 Сохранить как изделие», в system-панелях min/max
  параметров подменяется на диапазоны из продукта. Следующая итерация —
  UI редактирования каталога + привязка к конкретным SKU модулей.

#### Подфаза 1.23 — Конфигуратор серверной / телеком стойки (новое 2026-04-20)

**Цель:** полноценная карточка стойки в проекте с BOM на заказ.
Пользователь описывает стойку «как на закупке» — корпус, двери,
боковины, PDU, заглушки. Результат — BOM со всеми артикулами.

- [x] **1.23.1** Модуль `rack-config/` (index.html + rack-config.js +
  rack-config.css). Открывается либо из hub, либо из «Общее →
  🔧 Конфигурировать…» для `n.type='consumer', subtype='rack'`.
- [x] **1.23.2** Параметры корпуса:
  - форм-фактор: `42U / 47U / 32U / 24U / 18U / ...` (настраиваемый),
  - ширина: `600 / 800 мм`,
  - глубина: `600 / 800 / 1000 / 1200 мм`,
  - производитель/серия (каталог per-user, как у остальных конфигов).
- [x] **1.23.3** Двери:
  - передняя: `стекло / сетка / металл / без двери`,
  - задняя: то же,
  - замок: `ключ / кодовый / электро`.
- [x] **1.23.4** Аксессуары:
  - боковые стенки (шт.),
  - крыша / верхняя панель (вентилируемая / глухая),
  - основание / пол (с кабельными вводами — кол-во, тип: щётки/
    заглушки/прокладки),
  - цоколь (ножки / ролики).
- [x] **1.23.5** Кабельные вводы (top/bottom/side): количество,
  диаметр, тип (щётка / заглушка / PG).
- [x] **1.23.6** Заглушки на пустые юниты: кол-во по умолчанию =
  (`totalU − занятоU`), можно override. Тип: `1U глухая / 1U
  перфорация / 2U`.
- [x] **1.23.7** PDU (блоки распределения питания):
  - количество PDU,
  - для каждого: номинальный ток (16/32 А), 1ф/3ф, высота (0U/1U/2U),
  - тип розеток: `C13 / C19 / C13+C19 / Schuko` + количество,
  - позиция в стойке (`left-0U / right-0U / horizontal 1U`),
  - **проверка по мощности**: сумма PDU A × U_nom ≥ `n.demandKw/0.9` с
    warning при недоборе.
- [x] **1.23.8** Карта юнитов: визуальная 2D-раскладка фронт-вью
  (v0.59.151) — SVG-стек занятых юнитов, заглушек и горизонтальных
  PDU, а 0U-PDU — как вертикальные рельсы слева/справа. Легенда
  под схемой. Rear view и привязка к СКС-наполнению (1.24) — потом.
- [x] **1.23.9** BOM на заказ: таблица со всеми позициями (корпус,
  двери, боковины, пол, кабвводы, PDU, заглушки). Экспорт CSV.
- [x] **1.23.10** Сохранение конфигурации как шаблон (localStorage
  `raschet.rackTemplates.v1`). Применение к узлу через `?nodeId=…`
  bridge из инспектора (Общее → 🔧 Конфигурировать…).

#### Подфаза 1.24 — Конфигуратор СКС / телеком оборудования (новое 2026-04-20)

**Цель:** описать содержимое стойки — коммутаторы, патч-панели, серверы.
Каждая единица привязывается к PDU-розетке из 1.23.7.

- [x] **1.24.1** Модуль `scs-config/` (v0.59.152): index.html + scs-config.js +
  scs-config.css + changelog.js. Запускается из hub; открытие из
  инспектора («Общее → Конфигурировать…») — следующая итерация.
- [x] **1.24.2** Каталог типов оборудования (per-user):
  - **коммутатор**: порты (8/16/24/48), Base-T / SFP / SFP+,
    PoE класс (off/af/at/bt), потребляемая мощность,
  - **патч-панель**: порты (12/24/48), keystone / модульная,
    категория (5e/6/6A/7/оптика), высота U,
  - **сервер**: форм-фактор (1U/2U/4U), мощность Вт, блоки питания
    (1+1/2+0), входные разъёмы (C13/C14/C19/C20),
  - **КВМ / монитор / ИБП 1U** — базовые типы.
- [x] **1.24.3** Размещение в стойке: инпут U + автопоиск свободной
  области + drag-n-drop (pointer events) прямо в SVG-карте со snap
  к целому U; авто-укладка. Конфликты подсвечиваются красным
  (перекрытия, наезд на «занятые» юниты rack-config, выход за границы).
- [x] **1.24.4** Привязка питания: dropdown `pduFeed` (из уникальных
  feeds стойки) + dropdown `pduOutlet` (разворачивается из
  rack.pdus[].outlets с учётом qty инстансов, с дизеблингом занятых
  слотов). Hard-check перегруза по вводу (сумма powerW vs rating·√3·230·cosφ).
  Детекция дублирования розеток (один слот = одно устройство).
- [x] **1.24.5** СКС-матрица: таблица соединений «порт A ↔ порт B»
  с типом кабеля (cat.6/6A/7, OM3, OS2), длиной и цветом. BOM
  агрегирует по типу кабеля (кол-во + ИТОГО длины).
- [x] **1.24.6** Хранение: `localStorage['scs-config.contents.v1']` =
  `{ [rackId]: [{id, typeId, label, positionU, pduFeed, pduOutlet}] }`.
  Отдельные хранилища для каталога типов и СКС-матрицы. Автосохранение
  при каждой правке, round-trip через JSON.parse/stringify.
- [x] **1.24.7** Сохранение и повторное применение «готовой сборки»:
  localStorage['scs-config.assemblyTemplates.v1'] — снапшот
  {contents, matrix}. Применение клонирует с новыми id и обрезает
  устройства, не помещающиеся в новую стойку (с уведомлением).
- [ ] **1.24.8** Отчёт по телеком-оборудованию: BOM + список
  соединений (СКС-таблица), экспорт CSV/PDF. Интеграция в общий
  отчёт проекта (`reports/`).

#### Подфаза 1.24-ext — Большая карта юнитов и палитра (ТЗ 2026-04-22)

**Мотивация:** текущая боковая миниатюра карты юнитов показывает только
один вид (фронт) и перегружена, если в стойке 30+ позиций. Размещение
и привязка к PDU через таблицу — громоздко. Реальные инженеры работают с
**двумя разными «рисунками» стойки**: один для СКС-шников (телеком-связи)
и один для электриков (питание, PDU-разводка). `scs-config/` становится
**«Конфигуратором содержимого стойки» (rack contents)** — внутренности
одного шкафа; межстоечный СКС выносится в отдельный модуль (Фаза 1.25).

**Терминология:**
- **Виды карты юнитов:**
  - **Вид СКС (front-facing, порты наверху)** — коммутаторы/патч-панели/
    сервера с указанием портов. Линии патч-кордов прокладываются между
    портами через кабельные органайзеры. Подключения к **внешним портам
    шкафа** (см. ниже) — в правой/левой граничной колонке карты.
  - **Вид питания (rear-facing, блоки питания сзади)** — то же железо,
    но отображается обратная сторона. Выделяются выходы БП, кнопки
    питания. Рядом со стойкой — **рельсы PDU** (0U) и горизонтальные
    PDU (1U/2U) с розетками. Линии питания — от входов БП устройства
    к конкретным розеткам PDU. ATS (1U) — как промежуточная коробка
    между двумя вводами A/B и одним выходом.
- **Внешние порты шкафа (`externalPorts`)** — список портов, которые
  «торчат наружу» стойки и будут подключаться на большой (межстоечной)
  схеме. Физически это — патч-панели на стыке стойки, port-breakout-
  панели, gateway-порты коммутатора. В `scs-config/` задаются явно
  (пользователь помечает порт как external), именуются (`R1.FO-1..4`,
  `R1.COPPER-1..24`), и становятся узлами связи для Фазы 1.25.
- **1, 2, …, 8 вводов питания** — у сервера/коммутатора/сторедж-массива
  может быть несколько БП. В «виде питания» устройство рисуется с
  соответствующим числом точек подключения (N+1 резервирование через
  два ввода, 2N — через 4 или 6 вводов на multi-feed storage).
  ATS (rack-mount) — отдельный тип оборудования с двумя входами (A, B)
  и одним выходом для подключения устройств с 1 вводом в 2N-схемы.

- [ ] **1.24.9** Переименование/уточнение назначения модуля. `scs-config/`
  позиционируется как **«Конфигуратор содержимого стойки»** (внутреннее
  наполнение одного шкафа). Межстоечный СКС — отдельный модуль (1.25).
  UI-правки: заголовок страницы «Содержимое стойки», в хабе карточка
  «Содержимое стойки» + отдельная «СКС (межстоечный)» для 1.25.
- [~] **1.24.10** **Палитра каталога (drag-source).** Базово: строки каталога `draggable="true"` → drop на SVG карты → устройство создаётся в том U, куда бросили (с clamp по heightU). Работает и в модалке. Полноценная графическая палитра с чипами будет позже вместе с 1.24.13. Левая колонка —
  не таблица, а вертикальная палитра плиток типов оборудования с
  миниатюрой, heightU, powerW, портами. Drag-n-drop плитки на SVG-карту
  = добавить в стойку в место дропа. Удержание Shift при drop = «сразу
  несколько штук подряд» (как в GIMP «brush»).
- [x] **1.24.11** **Два вида карты юнитов** — переключатель «СКС ↔
  Питание». Храним один набор оборудования, отображаем по-разному.
  `viewMode: 'scs' | 'power'` в state.
- [~] **1.24.12** **Модалка «Карта юнитов 🔍»** — базово готова (full-screen `<dialog>` 96×92 vh + увеличенный scale ×2 + dnd + свой toggle режима); палитра и панель свойств в модалке будут добавлены вместе с 1.24.10 / 1.24.13. **Detail-режим (только в модалке):** полная карта со всеми U, нумерация, пустые рамки + патч-корды между устройствами из СКС-матрицы (кривые Безье справа от стойки, цвет по типу кабеля). Маленькая карта — только заполненные юниты с подписями, без проводов (режим обзора). — кнопка «развернуть»
  открывает `<dialog>` на весь экран: левая колонка = палитра, центр =
  SVG-карта (крупный масштаб, rowH=40–50 px), справа = свойства
  выделенного устройства (включая порты и входы питания). Горячие
  клавиши: `Tab` переключает вид, `Del` удаляет выделенное, `←→↑↓`
  двигает по U.
- [ ] **1.24.13** **Каталог типов — многопортовое оборудование.**
  В схему типа добавить:
  - `powerInputs: [{id, connector: 'C13'|'C14'|'C19'|'C20', nominal: 'A'|'B'|'single'}]`
    — до 8 входов; одиночный `single` означает «обычное устройство
    без резервирования, подключается через ATS к 2N».
  - `ports: [{id, kind: 'copper-rj45'|'sfp'|'sfp+'|'lc-om3'|'usb'|'kvm', label: '1..24'|'UP1..4'}]`
    — именуемые порты.
  - `rearFormFactor: 'standard'|'blades'|'bladeserver'` — как отрисовать
    заднюю сторону (для серверов типа Dell MX — отдельная раскладка).
- [ ] **1.24.14** **ATS rack-mount как отдельный тип.** Новая категория
  в каталоге: `kind: 'ats'` с `heightU: 1|2`, двумя входами (A, B) и
  одним выходом. Визуально в «виде питания» — «Y» со входами сверху и
  одним выходом снизу. На выход можно таскать ссылки от устройств с
  `powerInputs.length === 1`. Помечается в warning, если подключение
  идёт не через ATS, а на single PDU при заявленном 2N.
- [ ] **1.24.15** **Внешние порты шкафа.** В каталоге типа — чекбокс
  «порт external» на каждом `ports[].id`. При отображении карта показывает
  external-порты в боковой колонке (left/right). Настройка стороны
  (`externalSide: 'left'|'right'|'top'`) — атрибут устройства.
  В BOM внешних портов добавляется раздел «External interfaces»
  (имя, тип кабеля, сторона). Это вход Phase 1.25.
- [ ] **1.24.16** **Авто-трассировка патч-кордов через органайзеры.**
  На виде СКС каждое соединение `матрицы[i]` рисуется как кривая
  между двумя портами (не между устройствами!). Путь: от порта A
  устройства → вверх/вниз до ближайшего кабельного органайзера → по
  вертикали через органайзер → вбок до порта B. Auto-routing через
  органайзеры (тип `cable-manager`, heightU≥1) разгружает основную
  зону карты. Номера портов и корды подписываются.
- [ ] **1.24.17** **Авто-рисовка линий питания.** На виде питания —
  линии от каждого `powerInputs[j]` устройства к конкретной
  `pduOutlet` (или через ATS). Цветовая кодировка: `A` = синий,
  `B` = красный, `single` = серый. Перегруз ввода PDU — линия
  становится красной толстой.
- [x] **1.24.18** **Таблицы СКС и питания сворачиваемые.** (закрыто v0.59.809) Текущие
  таблицы (Размещение в стойке / СКС-матрица / BOM) обёрнуты в `<details>`;
  по умолчанию свёрнуты (кроме «⚠ Проверки» — открыта чтобы предупреждения
  были на виду). Раскрываются по клику. Содержимое карты-юнитов
  редактируется без раскрытия таблиц. CSS-стили в scs-config.css —
  custom marker (▸ → ▾), hover-фон, плавный transform.
- [x] **1.24.19** **Отвязка мощности оборудования от главной схемы.** (закрыто фактически с v0.59.530 revert)
  Главная схема (Raschet constructor) получает от стойки **только
  `demandKw`** — заявленную мощность шкафа (вводится пользователем
  в rack-config). Сумма `powerW` устройств из scs-config НЕ передаётся
  в POR.electrical, но используется локально в warnings и в UI
  «факт vs запрос» (см. 1.28.7). Это делает содержимое стойки управленчески
  независимым от электрических расчётов.
- [ ] **1.24.20** **Добавление оборудования в глобальный каталог.**
  На палитре типов — кнопка «опубликовать в общий каталог» для
  пользователей с ролью `catalog-admin`. Запись попадает в
  `shared/element-library` как `kind='scs-equipment'` (overrides
  over builtins). Остальные пользователи видят её как стандартный тип,
  могут использовать, но не править. Для обычного пользователя —
  локальный каталог остаётся (прежнее поведение).
- [ ] **1.24.21** **Отчёт по телеком (1.24.8 refactor).** Теперь
  отчёт включает: (а) палитру типов, (б) обе карты (СКС+питание) как
  embedded SVG, (в) таблицы матрицы и контента, (г) BOM. Экспорт в
  главный отчёт проекта через `shared/report/sectionScs.js`.

---

#### Подфаза 1.24-concrete — «конкретная стойка» вместо шаблона (новое 2026-04-22)

**Принципиальное изменение концепции.** Сейчас scs-config и rack-config работают
с «шаблонами стоек» — правка шаблона влияет на все размещения этого шаблона.
Это не соответствует реальному ЦОД, где каждая стойка — физически **уникальный
объект** с ярлыком (tag, TIA-942), серийным номером, расположением в зале
и собственным содержимым.

**Новая модель данных:**
- На главной схеме Raschet узел «стойка» = **конкретная стойка** с уникальным
  `rackId` (UUID) и `tag` (TIA: напр. `DC1.H3.R05` — зал 1, ряд H3, стойка №5).
- `localStorage['raschet.rackInstances.v1']` = `{ [rackId]: {id, tag, roomId,
  rowId, pos, hardware: {u, depth, width, occupiedTop, plugs, pdus}, contents:
  [device], matrix: [link], externalPorts: [], powerDemandKw, notes} }`
- Шаблоны остаются, но превращаются в **пресеты** — используются только как
  «заготовка для создания новой стойки» или «применить к существующей
  (заменить содержимое)». Редактирование пресета НЕ затрагивает уже созданные
  стойки.
- Конфигуратор (scs-config/rack-config) открывается по URL `?rackId=<uuid>` и
  работает с `rackInstances[rackId]`. Все правки пишутся сразу туда.
- Схема **зала серверных** (новый модуль `server-room/` или зона в главной
  схеме) — top-view расстановка стоек с привязкой к `rackId`. Клик на стойку →
  открывается её конфигуратор.

**Подпункты:**
- [ ] **1.24.22** Схема `rackInstance` + миграция: из текущих `rack-config.
  templates.v1` + `scs-config.contents.v1[rackId]` собрать per-rack объекты в
  `raschet.rackInstances.v1`. Старые ключи пометить deprecated (читаем, но не
  пишем).
- [~] **1.24.23** Поле `tag` (TIA-942) в UI стойки: `DC1.H3.R05`, маска +
  валидация. Базово готово: input в topbar, хранится в `scs-config.rackTags.v1 = {[rackId]: tag}`, подставляется в подписи на карте и в сводную таблицу «Размещение». Отображается в заголовке конфигуратора и на карте юнитов
  («Стойка DC1.H3.R05 · 42U · 8.5 кВт»).
- [~] **1.24.24** URL-роутинг: `scs-config/?rackId=<uuid>` и
  `rack-config/?rackId=<uuid>`. Без параметра — список стоек проекта с
  кнопкой «➕ Создать стойку» (с опцией «из пресета»).
- [ ] **1.24.25** Пресеты (rack preset + assembly preset). Переименовать
  существующие `rack-config.templates.v1` → `rack-config.presets.v1`,
  `scs-config.assemblyTemplates.v1` → `scs-config.assemblyPresets.v1`.
  Пресет = snapshot (железо + содержимое + матрица) без `rackId`/`tag`.
  Применение к стойке = клонирование содержимого с новыми id, НЕ ссылка.
- [ ] **1.24.26** Главная схема: узел «Стойка» ссылается на `rackId`,
  показывает в инспекторе `tag`, `u`, `powerDemandKw`, «Открыть в
  конфигураторе →». Мощность узла = `powerDemandKw` стойки (ввод от юзера
  или авто-сумма по содержимому, по выбору).
- [ ] **1.24.27** Модуль `server-room/` — top-view план зала, ряды стоек,
  drag-n-drop стойки из палитры «новая стойка»/«пресет». Клик → открывает
  `scs-config/?rackId=<uuid>`. Экспорт плана в отчёт.
- [~] **1.24.28** **«Тележка» (moving cart) — межстоечный буфер.** Базово реализовано: LS_CART общий буфер, секция «🛒 Тележка (N)» в правой колонке, иконка 🛒 в каждой полосе на карте (клик = вытащить), drag строки тележки на карту любой стойки = установить (с findNearestFreeSlot), «↩ вернуть» = переключиться на исходную стойку, поставить, вернуться, «✕ выгрузить на склад» (удалить). Акценты ещё не сделаны: подсветка целевого U при drop, drag c карты прямо на тележку (сейчас через клик-иконку). Новый
  контейнер `localStorage['scs-config.cart.v1']` = `[{id, typeId, label,
  fromRackId, fromTag, takenAt, pduFeed?, pduOutlet?}]`. Поведение как в
  реальном ЦОД:
    - В конфигураторе стойки — панель «🛒 Тележка (N)» справа от карты
      юнитов; показывает все устройства в тележке (из любых стоек).
    - Drag оборудования с карты юнитов **на тележку** = вытащить сервер
      (remove из `contents`, push в cart, сохранить `fromRackId`/`fromTag`).
    - Drag с тележки **на карту юнитов** (в любой стойке) = установить
      (pop из cart, push в contents целевой стойки с заданным U).
    - На тележке можно «выгрузить на склад» (удалить из cart совсем) или
      «вернуть откуда взяли» (обратно в исходную стойку).
    - Тележка общая для всех стоек, сохраняется между сессиями.
- [~] **1.24.29** **Запрет наложения при drag-n-drop.** Базово реализовано: `canPlace(r, devices, excludeDevId, h, wantU)` проверяет rack-occupied + других устройств; drag-перемещение упирается в препятствие (d.positionU не меняется), drop из каталога ищет ближайший свободный слот через `findNearestFreeSlot` (вверх, потом вниз). Осталось: подсветка target-U пунктиром при hover, визуальный «упор» у перетаскиваемого устройства. При перетаскивании
  юнита новая позиция проверяется через `canPlace(r, devId, heightU, newU)`:
  если перекрывает другое устройство или занятые стойкой юниты — drag не
  двигается дальше (визуально упор в препятствие), на pointerup — откат на
  последнюю валидную позицию. То же при drop из каталога/тележки: если
  целевой U занят — найти ближайший свободный блок (вверх, потом вниз) и
  подсветить target-U пунктиром.
- [x] **1.24.30** Уникальные теги устройств внутри стойки (TIA-606): закрыто.
  `<rack-tag>.U<bottom>` (напр. `DC1.H3.R05.U42` для 2U устройства,
  занимающего U43+U42). Функция `deviceTag(d)` возвращает единый
  номер — **нижнюю точку крепления** (монтажный референс по TIA-606-C),
  без диапазона `U43-42`. Высота указывается отдельно в колонке
  размера устройства. Показана в карте юнитов, в таблице «Размещение»
  (колонка «Тег»), в CSV-экспорте (секция «Теги устройств TIA-606»).
  Без тега стойки — поле пустое.
  Обновлено в v0.59.201.
- [~] **1.24.32** **Склад (Warehouse) — долговременное хранение.** Базово
  реализовано (v0.59.162): LS_WAREHOUSE=`scs-config.warehouse.v1`,
  секция «📦 Склад» в правой колонке (solid yellow border), операции
  `cartToWarehouse` / `warehouseToCart` / `discardWarehouseItem`.
  HTML5 DnD cross-drag тележка↔склад через разные mime-типы
  (`application/x-scs-cartid`, `application/x-scs-whid`). Отличие от
  тележки (1.24.28): тележка — «в руках, на пути», склад — «длительное
  хранение, может лежать годами». Долгосрочно: сортировка/поиск по
  складу, инвентаризация (серийные номера), экспорт инвентаря, резерв
  под будущие проекты.
- [ ] **1.24.31** **Групповые потребители на схеме ↔ реальная нагрузка из
  стоек (live link).** Узел типа «Серверная стойка» / «Группа стоек» /
  «Серверный зал» на главной электрической схеме хранит в `kindProps`
  массив `rackIds: []` — ссылки на конкретные стойки из scs-config.
  - **Авто-расчёт нагрузки:** `demandKw` узла = Σ по каждому `rackId`:
    - либо `rackInstances[rackId].powerDemandKw` (ручной ввод
      проектировщика — «дано по ТЗ»)
    - либо `Σ devices[i].powerW × utilisation / 1000` (фактическая по
      содержимому СКС-конфигуратора) — с коэффициентом одновременности
      из GLOBAL (по умолчанию 0.8).
    - режим переключается в инспекторе узла: «Задано вручную /
      Рассчитать по содержимому».
  - **Реактивность:** при правке содержимого стойки в scs-config
    (добавить/убрать сервер, поменять powerW типа) `demandKw` у
    связанных узлов схемы пересчитывается немедленно. Реализация через:
      (а) `storage` event — scs-config пишет → schema-редактор ловит;
      (б) in-process bus если оба модуля открыты в одной вкладке.
  - **Инспектор узла:** таблица «Стойки в группе»: [tag][u][подключено
    устройств][факт. кВт][ручной кВт][действия: «→ открыть в
    конфигураторе», «× отвязать»]. Кнопка «➕ Добавить стойку» →
    picker из всех `rackInstances` проекта, мультивыбор.
  - **Двухсторонний индикатор:** в scs-config у стойки показать
    «Подключена к узлам схемы: [A1.QF5, B2.QF3]» (обратный индекс по
    rackIds) + кнопка «→ открыть в схеме».
  - **Совместимость:** старые узлы (без `rackIds`) работают как раньше
    (ручной `demandKw`); новое поведение включается когда пользователь
    привязывает хотя бы одну стойку.
  - **Хранение:** `node.kindProps.rackIds = ['<uuid>', ...]`,
    `node.kindProps.loadMode = 'manual' | 'computed'`. Миграция не
    нужна — новый опциональный атрибут.
  - **Зависимости:** 1.24.22 (rackInstances с uuid и `powerDemandKw`) —
    обязательная база; 1.24.26 (узел стойки с `rackId`) — частный
    случай этого пункта для `rackIds.length === 1`.
  - **Acceptance:** в проекте добавили 3 стойки в scs-config, узел
    «Серверная #1» на схеме ссылается на 2 из них → `demandKw`
    автоматически = сумма по содержимому; убрали 1 сервер из стойки →
    `demandKw` узла пересчитался; ток автомата питания этой группы
    обновился.

**Зависимости:**
- 1.24.22 — база для всего остального (миграция без неё невозможна).
- 1.24.27 (server-room) — может быть параллельно с 1.25 (inter-rack-scs),
  но они решают разные задачи: server-room = физическая расстановка,
  inter-rack-scs = схема патчей между стойками.
- 1.24-ext (1.24.9–1.24.21) остаются валидны, но выполняются поверх новой
  модели `rackInstance` (не `template`).

---

#### Подфаза 1.26 — Единый дизайн всех модулей (новое 2026-04-22)

**Цель:** снять разнобой в отображении модулей. Все подпрограммы
(scs-config, rack-config, mv-config, mdc-config, pdu-config, ups-config,
transformer-config, panel-config, battery-calc, cable, catalog, elements,
logistics, psychrometrics, suppression-config) должны выглядеть
однотипно: полная ширина вьюпорта (как «Конструктор схем» и «Подбор
кабеля»), единые шрифты, единые стили однотипной информации.

- [x] **1.26.1** Полноэкранное отображение. Убрать исторические
  `max-width: 1200/1400/1600px; margin: 0 auto;` у обёрток. Единое
  правило в `shared/styles/base.css` сбрасывает их для всех
  известных wrapper-классов (`.page-wrap`, `.sc-wrap`, `.rc-wrap`,
  `.cb-wrap`, `.mv-wrap`, `.pdu-wrap`, `.ups-wrap`, `.mdc-wrap`,
  `.bat-wrap`, `.cat-wrap`, `.log-wrap`, `.psy-wrap`, `.sup-wrap`,
  `.pc-wrap`, `.tr-wrap`, `.app-wrap`, `body > main`). Внутренние
  узкие колонки — через inner-контейнер, а не через внешнее
  ограничение (v0.59.173).
- [x] **1.26.2** Единая типографика. `html { font-size: 14px;
  line-height: 1.45; }` + `body { font-family: var(--rs-font); }` в
  base.css — модули больше не переопределяют font-size/font-family
  на body. Уже используется общий стек
  `-apple-system, "Segoe UI", Roboto, sans-serif` (v0.59.173).
- [x] **1.26.3** Единые стили «справочных» таблиц. Класс `.rs-table`
  в base.css: sticky thead, hover строк, `.num` — правое
  выравнивание + tabular-nums для числовых колонок. Новые таблицы
  должны использовать этот класс вместо собственных (v0.59.173).
- [x] **1.26.4** Единые токены состояний. Классы `.rs-status-*`
  (active / standby / maint / decom / error) — цветной круглый
  индикатор + текст. Иконки/цвета зафиксированы в base.css
  (v0.59.174).
- [x] **1.26.5** Единые стили форм — класс `.rs-field` в base.css
  (label + input/select/textarea/output, inline-вариант). Модули
  могут постепенно мигрировать с `.sc-field`/`.rc-field`/`.field`
  (v0.59.174). Обратная совместимость сохранена.
- [x] **1.26.6** Единая «карточка-секция» `.rs-section` с заголовком
  `h2` 15px/600, подзаголовком `h3` 13px/600, подписью `p.hint`
  12px/muted. Закреплён в base.css (v0.59.174).
- [x] **1.26.7** Единая палитра chip'ов: `.rs-chip` + варианты
  `info/success/warn/danger/muted`. Использует базовые токены
  --rs-accent-bg / --rs-success-bg / --rs-warn-bg / --rs-danger-bg
  (v0.59.174).
- [x] **1.26.8** Единый breadcrumb `.rs-breadcrumb` (class `.sep`
  для разделителей, `.spacer` для выравнивания вправо). Мигрированы
  три страницы scs-config (index / rack / inventory); старый
  `.sc-breadcrumb` удалён из scs-config.css (v0.59.174).
- [x] **1.26.9** Аудит-скрипт `scripts/audit-design.py`. Ищет
  `max-width:<число>px` + `margin:0 auto` в одном блоке на
  wrapper-селекторах (`body > main`, `main`, `.*-wrap`). Код
  возврата 1 — нарушения найдены. Первый прогон нашёл 11 нарушений
  в battery, catalog, elements, logistics, panel-config,
  rack-config, transformer-config, ups-config, mdc-config,
  psychrometrics, suppression-config, pdu-config — все вычищены
  (v0.59.175), текущий прогон зелёный.
- [ ] **1.26.10** Миграция существующих `.sc-field`/`.rc-field`/
  `.mv-field`/`.field` → `.rs-field`. Шаг за шагом, чтобы не ломать
  модули.

---

#### Подфаза 1.25 — Межстоечный СКС-конфигуратор (новое 2026-04-22)

**Цель:** отдельный модуль `inter-rack-scs/` (или `scs-floor/`) —
верхнеуровневая схема связей между стойками на плане зала. В отличие
от 1.24, который описывает содержимое одной стойки, этот модуль
работает с **множеством стоек** и соединениями «шкаф ↔ шкаф» через
их external-порты (1.24.15).

**Вход:** список шкафов проекта с их external-портами (собранный из
`scs-config.contents.v1` по всем стойкам) + plan-view (координаты
стоек на плане зала из `mdc-config/` или вручную).

- [ ] **1.25.1** Модуль `inter-rack-scs/` — index.html + .js + .css.
  Из хаба отдельная карточка «Межстоечный СКС».
- [ ] **1.25.2** План-вью: top-down план зала (если есть `mdc-config`
  — импортировать координаты; иначе — сетка и drag-n-drop шкафов).
  Каждый шкаф рисуется как прямоугольник с именем и счётчиком
  external-портов.
- [ ] **1.25.3** Импорт external-портов. По каждой стойке подтягиваются
  её external-порты из `scs-config.contents.v1`. Порты отображаются
  как точки на границе шкафа (по `externalSide`). Hover — показывает
  имя и тип (copper/fiber).
- [ ] **1.25.4** Соединения «port ↔ port» на плане. Клик по одному
  external-порту + клик по другому = создать связь. Линии рисуются
  по плану с учётом кабельных лотков (опционально в 1.25.8). Кабель
  наследует тип от «слабейшего» конца (если оба порта SFP+ — OM3 LC-LC;
  если один copper — cat.6). Длина берётся по манхэттенскому расстоянию
  × коэффициент запаса (default 1.3).
- [ ] **1.25.5** BOM межстоечных кабелей. Агрегация по типу + сумма
  метров + кол-во кабельных сборок.
- [ ] **1.25.6** Экспорт плана СКС в SVG/PDF. Легенда: шкафы, порты,
  связи, кабельные лотки.
- [ ] **1.25.7** Автоматическое обновление при правке содержимого
  стойки. `storage`-event listener на `scs-config.contents.v1`:
  если в стойке добавлен/удалён external-порт — связи этой стойки
  пересоздаются, при потере обоих концов связь удаляется (warning).
- [ ] **1.25.8** Опционально — трассировка по лоткам. На плане можно
  нарисовать кабельные лотки/каналы. Линии связей прокладываются
  «по ним» (shortest path через граф сегментов лотков), длины
  пересчитываются реально, а не по манхэттену.
- [ ] **1.25.9** Связь с главной схемой. Внешние порты стойки из
  `scs-config` экспонируются как low-voltage-связи на уровне node
  `consumer, subtype=rack`. В constructor это видно как отдельные
  информационные связи (см. patch-link 1.21.4). Физическое питание
  шкафа идёт по обычной электрической связи — эти два потока не
  смешиваются.

**Зависимости:** Phase 1.24-ext (нужны external-порты как контракт).
Phase 10 (`mdc-config/`) желательна для импорта координат стоек, но
не критична.

---

#### Подфаза 1.26 — Размежевание модулей и терминология (новое 2026-04-22)

**Мотивация.** За время разработки у нас накопились модули, которые
пересекаются по смыслу: «Конфигуратор стойки» (корпус), «Конфигуратор
СКС» (на деле — содержимое шкафа + реестр), будущий «настоящий» СКС
(трассы между стойками), парк IT-оборудования и парк всего объекта.
Слово «СКС» занято неверно и мешает. Нужна чёткая карта модулей.

**Целевой состав (5 модулей, не считая старой связки):**

| # | ID модуля | Название в UI | Назначение |
|---|---|---|---|
| 1 | `rack-config` | Конфигуратор шкафа — корпус | Типовой корпус, U, двери, стенки, PDU-слоты, заземление, базовый BOM пустого шкафа. Шаблоны. |
| 2 | `scs-config` (раньше так назывался модуль СКС; UI переименован) | Компоновщик шкафа | Наполнение конкретного экземпляра шкафа: карта юнитов (сервера/свичи/патч-панели), вертикальные PDU, **внутренние патчкорды и внутреннее питание**. Ссылается на `rack-config` (тип шкафа) и `it-inventory` (экземпляры железа). |
| 3 | `it-inventory` (новый; старый `scs-config/inventory.html` переезжает сюда) | Реестр IT-оборудования | Сервера/свичи/хранилища как экземпляры: inv-№, S/N, IP, MAC, физ.порты, привязка к шкафу+U из (2). Импорт/экспорт, поиск. |
| 4 | `scs-design` (новый, настоящий СКС; освободим слово, когда it-inventory переедет) | Проектирование СКС | Кроссы, трассы, пары port↔port на уровне здания/этажей, маркировка, длины кабелей, BOM СКС. **Внутри** — мастер меж-шкафных связей (см. ниже). Не путать с патчкордами внутри одного шкафа — те в (2). |
| 5 | `facility-inventory` (новый) | Реестр оборудования объекта | Всё не-IT: ИБП, АКБ, кондиционеры, ДГУ, ТП, щиты, СКУД, ПС — как экземпляры с привязкой к помещению/модулю ЦОД. Общая крыша над (3) на уровне «всё имущество площадки». |

**Мастер меж-шкафных связей (встроен в 4):** «настольный режим» со
несколькими открытыми шкафами одновременно, drag-связь от конкретного
порта одной стойки к конкретному порту/патч-панели другой. **Не
запускается из хаба самостоятельно** — вызывается только из `scs-design`
как внутренняя панель/модалка. Поглощает ранее запланированную
подфазу 1.25 (Межстоечный СКС-конфигуратор) — та остаётся как
архитектурный набросок, но живёт внутри `scs-design`.

- [ ] **1.26.1** Терминологический рефактор UI и хаба (без переноса
  файлов). В хабе карточка «Конфигуратор СКС / телеком» разбивается на
  две: «Компоновщик шкафа» (→ `scs-config/`) и «Реестр IT-оборудования»
  (→ `scs-config/inventory.html`). Заголовки страниц: `scs-config/index.html`
  — «Шкафы проекта» (уже так), `scs-config/rack.html` — «Компоновщик
  шкафа», `scs-config/inventory.html` — «Реестр IT-оборудования».
  Breadcrumb-линки обновляются. URL-ы пока прежние.
- [ ] **1.26.2** Физический перенос inventory в отдельный модуль
  `it-inventory/` с редиректом от `scs-config/inventory.html` на
  `it-inventory/`. Хранилища `localStorage['scs-config.inventory.*']`
  мигрировать в `raschet.itInventory.*` с сохранением fallback-чтения.
- [ ] **1.26.2.a** ⚠ **Разделение «шаблоны шкафов» vs «реальные стойки».**
  Сейчас оба типа живут в одном `rack-config.templates.v1`, что путает:
  «Новый шаблон 42U» (корпус без тега) визуально неотличим от «DH1.SR2»
  (реальная стойка машзала с тегом). **План разделения:**
    1. Новое хранилище `rack-config.instances.v1` для реальных стоек
       (массив `{id, templateId, tag, name, location, ...}`).
    2. `rack-config.templates.v1` остаётся только для **шаблонов корпуса**
       (42U/47U/static, без тега и без content'а).
    3. В `scs-config/` добавить шаг «Создать реальную стойку из шаблона»
       — клонирует шаблон, присваивает tag (напр. `DH1.SR2`) и
       location (машзал/этаж/ряд). Содержимое (`scs-config.contents.v1`)
       хранится по `instance.id`, не по `template.id`.
    4. Миграция: существующие записи с tag ≠ пусто → instances;
       остальные остаются templates.
    5. Хаб: кнопки «Шаблоны корпусов» (→ rack-config/) и «Стойки проекта»
       (→ scs-config/ или новый it-racks/). Сейчас смешано.
  **Временный workaround в scs-design (v0.59.205):** в picker «Связи» и
  таблице «Стойки проекта» визуальное разделение — стойки с тегом
  («Реальные»), без тега («Черновики/шаблоны», штриховка + жёлтый фон).
- [ ] **1.26.3** Пустой stub модуль `scs-design/` — карточка в хабе
  «Проектирование СКС», главная страница со списком «Планов СКС» и
  «+ новый план». После создания плана внутри — три вкладки: «План
  зала / Стойки / Связи».
- [ ] **1.26.4** **Мастер меж-шкафных связей** внутри `scs-design/`:
  вкладка «Связи» открывает режим, в котором выбирается N стоек
  проекта (multi-select из rackInstances), они рендерятся рядом
  (сетка или ряд), можно тянуть линию от external-порта (1.24.15)
  одной стойки к external-порту другой. Линия сохраняется в
  `raschet.scsDesign.links.v1` как `{fromRackId, fromPortId,
  toRackId, toPortId, cableType, length?}`. Отдельного пункта в
  хабе нет — только внутри `scs-design`.
  - **1.26.4.0** ⚠ **Визуальная высота многоюнитовых устройств** в карточках
    стоек scs-design: 2U/4U/6U-железки раньше рисовались одной строкой,
    что искажало занятость. Теперь — `.sd-unit.multi` с высотой
    `h × var(--u-row) + (h-1) × var(--u-gap)`, бейдж «2U/4U/…» и диапазон
    номеров «9-8». Адресация (тег) по-прежнему по нижнему U. ✅ v0.59.205.
  - **1.26.4.a** Контракт «Органайзер ≠ endpoint». Устройства с
    `kind='cable-manager'` (и любые будущие `NO_PORT_KINDS`) не могут
    быть концом связи — у них нет портов. В карточке стойки рисуются
    штриховкой, `cursor:default`, клик не создаёт link-start. При
    загрузке модуля `sanitizeLinks()` вычищает унаследованные
    некорректные связи с endpoint=органайзер. ✅ v0.59.202.
  - **1.26.4.b** (future) Органайзер как **waypoint сплайна**:
    трасса кабеля между двумя endpoint-ами рисуется через точки
    органайзеров (доступные каналы стойки), а не прямой кривой.
    Требует расчёта маршрута по стойке: вертикаль → горизонталь через
    органайзер → вертикаль. Влияет на BOM (длина = манхэттен через
    органайзеры × 1.3), отображение и будущий 3D-рендер трассы.
- [ ] **1.26.5** Stub `facility-inventory/` — карточка в хабе,
  пустая главная с таблицей и CTA «подключение оборудования объекта
  из модулей mdc-config / mv-config / ups-config / suppression-config».
  Реальное наполнение — в рамках Фазы 13.
- [ ] **1.26.6** Подфаза 1.25 (Межстоечный СКС-конфигуратор) помечается
  как **поглощённая в 1.26.4** — её пункты 1.25.1…1.25.9 переносятся
  как задачи внутри `scs-design/` (перенумерация `1.26.4.x`), отдельный
  модуль `inter-rack-scs/` больше не создаётся.

**Зависимости:** 1.24.15 (external-порты) для 1.26.4; остальное —
чисто UI-переименование + скаффолдинг, не требует готовых данных.

---

### ⏳ Фаза 2 — Раздельные дисциплины как отдельные модули (после Фазы 1, 6-8 недель)

> **Концепция изменена 2026-05-03 (запрос Пользователя):**
> «меняем концепцию много-пространственных схем (этап 2) на отдельные
> связанные модули по специальностям, электрик отдельно, слаботочник
> отдельно, АСУ ТП отдельно, .... все отдельными модулями, доступными
> как не связанных (доступных по подписке отдельных) стандалон
> приложениями так и совместная работа в рамках проекта».

**Цель:** каждая инженерная дисциплина — отдельное полнофункциональное
приложение с собственным data namespace, доступное:
1. **Standalone**: отдельная подписка / лицензия, работа без полной
   платформы Raschet (нужен только sketch-проект для контекста).
2. **В рамках проекта Raschet**: автоматический cross-module sync через
   parent-project (как cooling↔TW, ups-config↔TW, dgu-config↔TW в Phase 30).

**Список дисциплин (модулей) с приоритетом:**

- [~] **2.A — Электрик** (electrical):
  - [x] `schematic/` (главная схема) — есть
  - [x] `panel-config/` (НКУ) — есть
  - [x] `mv-config/` (РУ СН) — есть
  - [x] `transformer-config/` — есть (draft)
  - [x] `ups-config/` — есть
  - [x] `battery/` — есть
  - [x] `dgu-config/` — есть (v0.60.70-92)
  - [x] `breakers` (в catalog) — есть
  - [x] `pdu-config/` — есть
  - [ ] **2.A.1** Сводный отчёт «электротехническая часть» из всех модулей (BOM, кабельный журнал, ОЛС, ВЛС).
  - [ ] **2.A.2** Стандалон-сборка только электрики (build:electrical).

- [~] **2.B — Слаботочник** (low-voltage / weak-current):
  - [x] `scs-design/` (СКС-проект) — есть
  - [x] `scs-config/` (компоновка шкафов) — есть
  - [ ] **2.B.1** `cctv-design/` — система видеонаблюдения (камеры, NVR, расчёт хранения, сетевые требования).
  - [ ] **2.B.2** `accessctrl-design/` — СКУД (контроллеры, считыватели, расчёт точек прохода).
  - [ ] **2.B.3** `fire-alarm-design/` — ОПС (датчики, шлейфы, ППК).
  - [ ] **2.B.4** `paging-design/` — система оповещения (СОУЭ).
  - [ ] **2.B.5** Стандалон-сборка слаботочки.

- [ ] **2.C — АСУ ТП / автоматика**:
  - [ ] **2.C.1** `scada-design/` — SCADA-узлы (PLC, HMI, серверы), IO-схема.
  - [ ] **2.C.2** `field-instrumentation/` — датчики, исполнительные механизмы (КИПиА).
  - [ ] **2.C.3** Спецификация полевых сигналов (4-20 мА / Modbus / Profinet).

- [~] **2.D — Климат / HVAC**:
  - [x] `cooling/` (подбор холодильных систем) — есть
  - [x] `meteo/` — есть
  - [x] `psychrometrics/` — есть (draft)
  - [ ] **2.D.1** Вентиляция: расчёт воздухообмена, подбор приточно-вытяжных установок.
  - [ ] **2.D.2** Стандалон-сборка климата.

- [~] **2.E — Пожарная безопасность**:
  - [x] `suppression-config/` (АГПТ — газовое пожаротушение) — есть
  - [ ] **2.E.1** Спринклеры: расчёт по СП 485 / NFPA 13.
  - [ ] **2.E.2** Дымоудаление: расчёт по СП 7.

- [~] **2.F — Управление объектом**:
  - [x] `tech-workspace/` (концепция ЦОД) — есть, расширен в Phase 36
  - [x] `service/` (монтаж и ТО) — есть
  - [x] `logistics/` — есть
  - [x] `facility-inventory/` — есть
  - [x] `mdc-config/` (МЦОД GDM-600) — есть

- [ ] **2.G — Архитектура / помещения**:
  - [ ] **2.G.1** `floor-plan/` — план помещений с оборудованием.
  - [ ] **2.G.2** Расчёт площадей (ТКП 308-2011, TIA-942) — частично уже в tech-workspace.
  - [ ] **2.G.3** Эвакуационные пути / нагрузка на конструкции.

- [ ] **2.H — Структура / нагрузки**:
  - [ ] **2.H.1** `structural-load/` — расчёт нагрузок на пол / перекрытия от стоек, ИБП, АКБ, ДГУ.
  - [ ] **2.H.2** Сейсмические крепления.

**Кросс-модульная инфраструктура (общая для всех):**

- [x] Project namespace в LS / IDB (Phase 1.27 / Phase 34). Каждый модуль работает в `raschet.project.<pid>.<moduleId>.<key>`.
- [x] Cross-module bridges (cooling-bridge, service-bridge, project-context). Phase 30.
- [x] Catalog общий — все модули видят каталог через element-library + catalog-bridge.
- [x] Sketch-projects per discipline — Phase 1.27, расширено в Phase 36.1 для tech-workspace вариантов.
- [ ] **2.X.1** Подписка / лицензирование: feature-flags для активации модулей по подписке. Standalone-сборки: каждая дисциплина — отдельный package со своими модулями.
- [ ] **2.X.2** Кросс-модульный отчёт (multi-discipline) — собирает данные из всех включённых модулей и формирует комплект документации (ОЛС электр., ВЛС, СКС-журнал, BOM cooling, и т.д.).
- [ ] **2.X.3** «Модули проекта» — UI в /projects/&lt;id&gt;/ с переключателем доступных модулей (читает feature-flags подписки + ownerModule sketch-проектов).
- [ ] **2.X.4** Coordinated revisions — при изменении в одной дисциплине (например, добавление стойки) — уведомление в зависимых (СКС: «обнаружен новый rack — добавить связи?», electrical: «добавить ввод?»).

**Acceptance:**
- Можно купить только «electrical» (modules 2.A) и работать без СКС/cooling.
- В полном проекте Raschet все включённые модули видят один parent-project и synchronize automatically.
- Отчёт «комплект документации» формируется из всех включённых модулей.

**Старая концепция мульти-пространственных схем (page.kind layout/mechanical/...):**
оставлено для совместимости в schematic/, не развивается.

---

### ⏳ Фаза 3 — drawio-режим (после Фазы 2, 2 недели)

- [x] **3.0** Заменить псевдо-drawio на ОФИЦИАЛЬНЫЙ drawio (jgraph/drawio) через embed iframe + postMessage protocol. Self-hosted (drawio-app/) с fallback на embed.diagrams.net. Update: `bash sketch/update-drawio.sh`. ✅ v0.60.166-167.
- [x] **3.0.1** Sketch ⇆ данные Raschet — связи с другими модулями. shared/sketch-refs.js (registry ref-типов: project / rack / schema / schematic-sheet / panel / ups / mv / transformer / cable / sketch). Правый sidebar «🔗 Связи» + picker-modal. Метка-ссылка вставляется в drawio-холст как UserObject с raschet.refType / raschet.refId / raschet.refLabel + link на исходный модуль (drawio сохраняет custom-атрибуты в XML). Auto-resolve label при render — если в источнике переименовали entity, обновляется. ✅ v0.60.168.
- [ ] **3.1** Переключение view mode: `canvas` (бесконечный) ↔ `sheet` (A3/A4)
- [ ] **3.2** В sheet-mode: ISO 7200 основная надпись, рамка, штамп
- [ ] **3.3** Переиспользовать `schematic/iso-paper.js`
- [ ] **3.4** Авто-layout для новых элементов (packing слева)
- [~] **3.5** Reverse-link UI: в исходных модулях (rack-config / schematic / panel-config / ups-config) показывать чип «📎 N sketch'ей ссылаются на этот объект» с дропдауном → открыть sketch. Generic helper `shared/sketch-refs-reverse.js` (mountReverseLinkChip). Pilot: projects/projects.js (на карточках проектов). v0.60.169.
  - [x] **3.5.1** Расширить на rack-config (рядом с tag стойки в тулбаре). v0.60.172.
  - [ ] **3.5.2** schematic (header листа)
  - [ ] **3.5.3** panel-config / ups-config / mv-config / transformer-config (header конфигурации)
  - [ ] **3.5.4** cable (рядом с tag кабельной линии)

---

### ⏳ Фаза 4 — 3D интеграция (после Фазы 3, 6-8 недель)

- [ ] **4.1** Интеграция `configurator3d/` в основной проект:
  - `pages/` получает `kind='3d'`
  - Общая state с 2D
  - three.js рендерит узлы как 3D боксы или загруженные модели
- [ ] **4.2** Синхронизация 2D ↔ 3D:
  - Изменение в 3D → обновление `layout.x, layout.y` → перерисовка 2D
  - Изменение в 2D layout → 3D position
- [ ] **4.3** Split-view: 2D слева, 3D справа
- [ ] **4.4** Фасады: `element.views.layout.svgFront/svgTop` накладываются на 3D-боксы как текстуры

---

### ⏳ Фаза 5 — Auth и Permissions (после Фазы 1-2, 3-4 недели)

- [ ] **5.1** Email/password регистрация (Firebase Auth уже поддерживает — UI добавить)
- [ ] **5.2** User-level roles в Firestore `users` collection: `{uid, email, role, modulesAccess}`
- [ ] **5.3** Module gating:
  - `hub.html` читает `modules.json` + проверяет `hasAccess(moduleId)`
  - Каждая подпрограмма проверяет права при загрузке
- [ ] **5.4** Super-admin UI: `admin/` — таблица users, управление ролями
- [ ] **5.5** Tariff configurator: `Tariff { id, name, modules, priceMonth, priceYear }`

### ✅ Совместное редактирование (Collaboration) — все пункты закрыты

- [x] **C.1** Presence: subcollection `projects/{id}/presence/{uid}` + heartbeat 25 с (stale = 90 с); аватары в шапке.
- [x] **C.2** Live-sync: `subscribeProjectDoc` слушает изменения, применяет `loadScheme` если локально нет dirty; для dirty — confirm().
- [x] **C.3** Object-level locking: subcollection `projects/{id}/locks/{key}`. Key = nodeId или `conn:${connId}` (v0.57.76). Лок удерживается пока пользователь выделил узел/связь.
- [x] **C.4** Визуализация чужих локов: оранжевая пунктирная рамка на узлах + толстая линия на связях, бейдж с именем (`render.js:decorateRemoteLocks`).
- [x] **C.5** Preserve-local-display: view/zoom/activeModeId/currentPageId не пропагируются между сессиями (`_preserveLocalDisplay`).
- [x] **C.6** Cursor awareness (v0.57.78): mousemove дросселируется до 200 мс, координаты конвертируются в схемные (`Raschet.screenToScheme`), пишутся в `presence/{uid}.cursor = {x, y, pageId}` через `presenceCursor`. `subscribePresence` собирает чужие курсоры в `window.__remoteCursors`; `render.js:renderRemoteCursors` рисует треугольник-стрелку + бейдж с именем в `layer-overlay`, фильтрует по `currentPageId`, компенсирует zoom (scale(1/zoom)).
- [x] **C.7** Conflict-aware merge: `_computeSchemeDiff` + `_showRemoteConflictModal` (v0.57.77) — вместо браузерного confirm показывается модалка со счётчиками `nodesAdded/Removed/Changed` и `connsAdded/Removed/Changed`, кнопки «Принять удалённые / Оставить локальные / Решить позже». Автор последнего сохранения виден в заголовке.
- [x] **C.8** История версий (v0.57.79): subcollection `projects/{id}/revisions/{auto}` хранит полный snapshot схемы + метаданные (createdAt, authorUid/Name/Email, note, nodeCount, connCount). Авто-снапшот в `saveCurrent` с троттлингом 5 мин, retention 50 записей (ленивая очистка каждые 5 авто-версий). Модалка «🕓 История версий»: список с автором и размером, кнопки «Восстановить» (с backup-версией «перед восстановлением») и «Удалить». API: `Storage.saveRevision / listRevisions / getRevision / deleteRevision`.
- [x] **C.9** Email-нотификации (v0.57.80): `functions/` Cloud Functions Gen 2 — `onAccessRequestCreated` (письмо владельцу о новом запросе доступа) и `onProjectMemberAdded` (письмо приглашённому о выданных правах). Доставку делает расширение Firebase **Trigger Email** через коллекцию `mail/` — функции не хранят SMTP-секреты. Setup в `FUNCTIONS_SETUP.md`. `firebase.json` и scaffold готовы к `firebase deploy --only functions`.

---

### ⏳ Фаза 6 — Конфигуратор щита + тепловой расчёт (после Фазы 1, 3 недели)

- [ ] **6.1** Финальное разделение panel-catalog:
  - Справочник: только оболочки (убрать inputs/outputs окончательно)
  - На узле «щит»: `enclosureId` ссылка + проектная конфигурация
  - Миграция существующих пользовательских данных
- [ ] **6.2** Тепловой расчёт:
  - `shared/calc-modules/thermal.js` (IEC 60890 / IEC 61439)
  - Суммирование `element.geometry.heatDissipationW` всех компонентов щита
  - Учёт температуры среды, способа установки
- [ ] **6.3** Climate recommendation:
  - Подбор вентиляторов/кондиционеров из `element-library` (kind='climate')
  - Автодобавление в BOM

---

### ⏳ Фаза 7 — Text config + DB abstraction (после Фазы 1, 2-3 недели)

- [ ] **7.1** `config.yaml` / `config.json` в корне с настройками платформы
- [ ] **7.2** `module.json` в каждом модуле с requires/dbCollections/permissions
- [ ] **7.3** DB adapter pattern: FirebaseAdapter, LocalStorageAdapter, MySqlAdapter (stub), PostgresAdapter (stub)

---

### ⏳ Фаза 8 — Пресейлс + КП (отдельно, 4-6 недель)

- [ ] Модуль `presale/`: загрузка прайсов, генерация КП, сметы
- [ ] Интеграция с BOM и отчётами

---

### ⏳ Фаза 9 — Revit / IFC (отдельно, 4-6 недель)

- [ ] Импорт/экспорт IFC файлов
- [ ] Интеграция через revit-api (требует back-end сервиса)

---

### 🟢 Фаза 10 — Конфигуратор модульного ЦОД GDM-600 (в проде с v0.58.87)

Отдельный модуль `mdc-config/` для подбора состава модульного ЦОД серии
GDM-600 по IT-нагрузке. Референсы — drawio-чертежи проектов 26003
(Алатау), 25006 (TBC Ташкент), 26009 (QazCloud).

**Модель данных:** каталог готовых продуктов (prefab).
- `IT-HALL-300` — машзал 300 кВт (22 стойки + 10 inRow-ACU 65 кВт +
  4 PDC + Monitoring + 2 AisleDoor), 7700×7300 мм.
- `POWER-1600` — энергоблок 1600 кВт (4×Kehua MR33-300 + 2×MR33-200 +
  10×Kehua S3 (580 кВт·ч) + 4 ACU + 2 MDB + UDB-IT/M-IT/AI + PDB-M-AI +
  Monitoring + 10 JB + ODU-полка 6200×2000), 8700×7300 мм.
- Все шкафы унифицированы: **600×1200×42U**, высота помещения
  **2700 мм** от фальшпола.

**Входные данные (минимум):** количество стоек + кВт/стойку.
Всё остальное (число машзалов/энергоблоков, ИБП, АКБ, ACU) считается
автоматически из каталога с учётом резервирования и автономии.

- [x] 10.1 — MVP: wizard + зоны + planview (v0.58.87)
- [x] 10.2 — каталог готовых продуктов из drawio (v0.58.90)
- [x] 10.3 — BOM-экспорт XLSX «Объём поставки» (v0.58.91)
- [~] 10.4 — оформление XLSX в стиле 26003-SCO-001: блок метаданных
      проекта (Объект / Заказчик / Договор / Ревизия / Дата) из
      localStorage['raschet.activeProject.v1'], section-title через
      merged cells, итоги по каждому разделу (позиций, Σ кол-во) и
      общий total. Без логотипов/подписей (требует xlsx-js-style).
      v0.59.148.
- [ ] 10.4 — экспорт точно по шаблону 26003-SCO-001 (оформление,
      логотипы, подписи; сейчас упрощённый формат)
- [ ] 10.5 — передача BOM в главную схему Raschet для электрического
      расчёта (через localStorage-мост). *Отложено по запросу
      пользователя, «может быть позже».*
- [ ] **10.6 — Авто-расстановка кондиционеров в ряду серверов** (зафиксировано
      Пользователем 2026-05-03). Алгоритм размещения inRow-кондиционеров и
      шкафов внутри типового модуля GDM-600 с учётом изоляции коридоров,
      неплотностей в шкафу и типовых расстановок.

      **Геометрия модуля GDM-600:**
      - Внутренняя ширина: **2400 мм** или **3000 мм**.
      - 2400 мм → 4 конструктива по 600 мм; 3000 мм → 5 конструктивов.
      - Конструктивы: шкафы 600/800 мм, кондиционеры 300/600 мм.
      - Не кратные зазоры — заглушки типовой ширины: 200, 300, 400, 500,
        600, 800 мм.

      **Подзадачи:**
      - 10.6.1 Каталог конструктивов (`mdc-config/library/constructs.js`):
        rack-600, rack-800, acu-300, acu-600, blank-200/300/400/500/600/800.
      - 10.6.2 Алгоритм layout: вход — целевая IT-мощность, число шкафов,
        мощность/тип ACU; выход — упорядоченный массив конструктивов с
        проверкой ΣW_acu ≥ Q_it × резерв (N+R) и Σширин = 2400/3000.
      - 10.6.3 Правила размещения: ACU равномерно распределены по ряду,
        не более N шкафов между двумя ACU, симметрия торцов; для
        холодного коридора с изоляцией — учёт by-pass air через зазоры.
      - 10.6.4 Если запрашиваемая мощность не покрывается ACU — уменьшение
        числа шкафов с заполнением освободившегося места заглушками
        типовой ширины (предпочтение крупным заглушкам, минимизация
        количества штук).
      - 10.6.5 Типовые расстановки GDM-600 как пресеты: 22-стоечный
        IT-HALL-300 с 10×ACU-65кВт (текущий каталог), плюс варианты на
        2400 мм / 3000 мм для разных мощностей.
      - 10.6.6 Валидация через CFD: интеграция с внешним CFD-сервисом
        (или встроенный упрощённый CFD на Navier-Stokes 2D) для проверки
        температурных полей в коридорах, обнаружения hot-spots,
        проверки эффективности изоляции. *Сначала табличная валидация
        по правилам, CFD — позже.*

---

### 🟡 Фаза 11 — Расчёт газового пожаротушения (АГПТ) (в разработке с v0.58.99)

Отдельный модуль `suppression-config/` с плагинной архитектурой методик
(`suppression-methods/`). Аналог ПО «Салют» / Siex CalcWin. Подключаемые
методики через единый интерфейс `{ META, compute(input) }`:

- [x] 11.1 — каталог ГОТВ `agents.js`: HFC-227ea (FM-200), FK-5-1-12
      (Novec 1230), HFC-125, HFC-23, CO₂, IG-541 (Inergen), IG-55
      (Argonite), IG-100 (N₂), IG-01 (Ar), SF₆. Свойства: ρ₂₀, s₂₀,
      Cmin A/B, NOAEL, нормативное время выпуска.
- [x] 11.2 — методики (4 модуля): СП РК 2.02-102-2022 (Казахстан),
      СП 485.1311500.2020 (Россия), NFPA 2001 (США), ISO 14520.
      Поправки: K1 (утечки), Ks (класс пожара), Kt (температура),
      Kalt (высота над у. м.).
- [x] 11.3 — UI с выбором методики, параметров объёма, агента,
      баллона; результат: масса ГОТВ, концентрация, DN магистрали,
      кол-во форсунок, кол-во баллонов.
- [x] 11.4 — изометрия трубопровода (SVG, MVP): баллоны, стояк,
      потолочная магистраль, распределительная сеть, форсунки.
- [x] 11.5 — экспорт отчёта (XLSX + HTML) и спецификации.
- [x] 11.6 — гидравлический расчёт трубопровода: падение давления
      по Darcy-Weisbach (реализовано в `suppression-methods/hydraulics.js`,
      v0.59.17+, проверка P_выход ≥ P_min).
- [x] 11.7 — 3D-конфигуратор трубопровода (SVG axonometric): интерактивная
      расстановка узлов и участков, автоматическая трассировка магистрали,
      размерные линии по ISO 129-1, жёсткие/скользящие опоры (v0.59.31).
      *Полный 3D на three.js — отложено; текущая SVG-аксонометрия
      практически достаточна.*
- [x] 11.8 — интеграция с mdc-config: кнопка «🔥 → АГПТ» в mdc-config
      передаёт геометрию IT- и силовых модулей в suppression-config через
      localStorage-мост `raschet.mdcToSuppression.v1`; suppression-config
      на init предлагает создать установку с зонами = модули ЦОД
      (H=2.7 м фиксировано, S=widthMm×lengthMm, направления «IT-модули» /
      «Силовые модули»). v0.59.146.
- [x] 11.9 — валидационные (регрессионные) тесты расчётных модулей.
      Файл `suppression-methods/validation-tests.js` с 6 опорными кейсами
      (СП 485 Прил.Д FM-200 30×3 / 100×3, Novec 1230; NFPA 2001 FM-200
      50 м³; ISO 14520 FM-200 100 м³; СП РК IG-541 100 м³). Кнопка «✓ Тесты»
      в тулбаре установки → диалог с таблицей «ожидание vs факт vs Δ%»
      и сводкой «N из M прошли». Допуск ±5 %. v0.59.147.

---

### ⏳ Фаза 12 — HVAC / PUE калькулятор (планируется)

Точный расчёт климатических систем по реальной психрометрии воздуха
и термодинамике хладагентов, с выводом PUE ЦОД (как отдельный показатель
качества проекта).

- [x] 12.1 — Модуль `psychrometrics/` (ID-диаграмма Молье-Рамзина /
      psychrometric chart ASHRAE). Уравнения состояния влажного
      воздуха: IAPWS-IF97 для пара, формулы Hyland-Wexler (ASHRAE
      Fundamentals 2021, гл. 1) для насыщения. Функции:
      `state(T, RH)`, `state(T, ω)`, `state(h, ω)`, `mixing(a, b, ratio)`,
      `cooling(state, T_coil)`, `heating(state, ΔT)`, `humidifying()`,
      `dehumidifying()`. Интерактивная ID-диаграмма SVG с нанесением
      точек процесса (1→2→3→4), изотерм, линий RH.
- [ ] 12.2 — Модуль `refrigeration-cycles/` — термодинамические циклы
      компрессоров с REFPROP-подобной библиотекой свойств хладагентов
      (R-410A, R-32, R-454B, R-1234ze, R-744/CO₂, R-717/NH₃, R-290,
      R-134a, R-513A, R-1234yf). Циклы: одноступенчатый парокомпрессионный,
      с экономайзером, каскадный, CO₂-транскритический (booster).
      Расчёт COP/EER/SEER по точкам цикла (1-2-3-4) с учётом real-gas
      свойств.

      **Расширения (зафиксировано Пользователем 2026-05-03 «модуль расчёта
      компрессора с хладагентами и циклами и соответственно DX-систем и
      вообще любого вида холодильного оборудования через производительность
      фреонов»):**
      - 12.2.1 Каталог хладагентов в `cooling/refrigerants/` (или внутри
        этого модуля): критические параметры (T_крит, P_крит), NBP, GWP,
        ODP, безопасность (A1/A2L/A3/B2L), типичные применения, табличные
        свойства зависимости от T (давление насыщения, энтальпии,
        плотности).
      - 12.2.2 Реальные эффекты в цикле: superheat / subcool, η_isen
        компрессора, ΔP линий, ΔT теплообменников. Параметры:
        COP_carnot vs COP_real, capacity, mass-flow, suction/discharge T.
      - 12.2.3 UI «Cycle calculator» — ввод refrigerant + T_evap + T_cond +
        ΔT_super/sub + η_isen → вывод P-h диаграммы, COP, capacity на
        единицу mass-flow. Sweep COP(T_amb) для DX.
      - 12.2.4 Интеграция с `cooling/chiller-defaults`: spec ссылается на
        refrigerant-id и compressor-η; bin-calc использует точный
        COP(T_amb) из цикла вместо аппроксимации IPLV.
      - 12.2.5 Подбор компрессора: каталог Bitzer/Copeland/Danfoss/Frascold
        с производительностью на стандартных условиях; выбор по требуемой
        capacity.

      **Acceptance:**
      - Можно сравнить COP реального DX на R410A vs R32 vs R290 — в одном
        клике.
      - DX-spec ссылается на refrigerant + compressor — расчёт точный для
        проектных условий.
- [x] 12.3 — Подбор чиллеров / DX-систем / inRow / freecooling — закрыто Фазой 22.x
      (модуль /cooling/ полностью реализован: chiller/DX/CRAC/free-cooling/
      топология/CAPEX-TCO; bin-метод по hourly meteo через chiller-bin-calc.js).
- [x] 12.4 — Расчёт PUE — закрыто v0.60.3
      (Tech-Workspace mode 'cooling-module' читает активный подбор cooling и
      считает PUE по реальной симуляции topology, fallback на упрощённую
      auto-формулу).
- [~] 12.5 — Интеграция с mdc-config — частично закрыто
      (через tech-workspace в v0.60.3; mdc-config напрямую — TODO).
- [ ] 12.6 — Экспорт отчёта по EN 50600-4-2 / ISO/IEC 30134-2 (PUE
      measurement methodology).
- [ ] 12.7 — Валидация: сравнение с эталонными программами (CoolTools,
      DesignBuilder, Trace 700) на типовых задачах.

**Зависимости:** Фаза 10 (mdc-config) — источник нагрузки;
Фаза 11 (АГПТ) — параллельная работа, общий UI-паттерн плагинов методик.

---

### ⏳ Фаза 13 — Детальные параметры устройств наполнения стоек (после 1.28)

**Требование (2026-04-28, юзер):** «нет редактируемых свойств объектов
наполнения стоек, серверы, патчпанели, мощность количество вводов питания,
напряжение допустимое, желательно диапазон, объем воздуха для вентиляторов
и прочие параметры. так же количество портов медных оптических, какой
скорости, какой IP на какой порт назначено или DHCP».

Расширяет карточку устройства `state.contents[rackId][i]` доменными
атрибутами. Ставится после стабилизации Фазы 1.28 (POR mirror) — в этой
последовательности, потому что 13.6 рассчитывает на POR-domain-locks.

Похожие задачи объединены в одну подфазу: питание + PDU-маппинг (13.1),
сеть + IPAM (13.2), типо-специфичные расширения (13.4).

- [ ] **13.1** — Электропитание устройства + привязка к PDU
  - `powerInputs[]` — массив вводов: `{ kind: 'C13'|'C19'|'C20'|'IEC60309'|'Schuko',
    voltageNominalV, voltageRangeV: [min, max], phases: 1|3, currentMaxA,
    plug, redundancy: 'A'|'B'|'A+B' }`
  - `powerNominalW`, `powerMaxW` (из `currentMaxA × voltageNominalV`)
  - Привязка ввода к PDU-выходу: `powerInputs[i].pduPort = '<rackId>/<pduSide>/<outletNo>'`
  - BOM по устройствам считает корректное число розеток нужного типа
    (C13/C19/Schuko); проверки «N=1 ввод и оба PDU A/B заняты — ошибка»;
    «вводы с разной фазностью у одного устройства — запрещено».

- [ ] **13.2** — Сетевые порты + адресация (IPAM)
  - `ports[]`: `{ kind: 'rj45'|'sfp+'|'sfp28'|'qsfp28'|'qsfp56-dd'|'lc-mm'|'lc-sm'|'fc',
    speedGbps, label, vlanIds[]?, role: 'mgmt'|'data'|'storage'|'wan' }`
  - Скорости 1G/2.5G/10G/25G/40G/100G/400G — выпадающий список из enum
    `shared/por-types/_helpers.js`.
  - На каждом порте: `networking: { mode: 'static'|'dhcp'|'none',
    ipv4: 'a.b.c.d/mask', ipv6?, vlanId?, gw?, dns? }`. Валидация IP,
    дубликат в проекте — красная метка.
  - Матрица патч-кордов оперирует портами (`port A.<labelA> ↔ port B.<labelB>`)
    вместо устройствами целиком (как сейчас).
  - Экспорт IPAM-CSV: «устройство → порт → IP/VLAN/role» для админа сети.

- [ ] **13.3** — Тепловой профиль
  - `thermal: { airflowM3h, dissipationW, direction: 'front-to-rear'|'rear-to-front'|'side',
    inletTempMaxC, outletTempC?, noiseDbA? }`
  - Сводка по стойке: суммарный airflow, баланс направлений (предупреждение
    при смешанных). Интеграция с Фазой 12 (HVAC/PUE) — общий теплоотвод
    зала и расчёт нагрузки на холодильную систему.

- [ ] **13.4** — Type-specific расширения (server / patch-panel / другие subtype)
  - **server:** `{ cpuCount, cpuModel, ramGb, storage[]: { kind:'ssd'|'hdd'|'nvme',
    sizeTb, raid? }, gpuCount?, formFactor: '1U'|'2U'|... }`
  - **patch-panel:** `{ portCount, kind: 'rj45-cat6'|'rj45-cat6a'|'lc-mm-om4'|...,
    angled, modular, ports[]: { number, label, mappedTo? } }` — `mappedTo`
    указывает внешнюю точку (помещение / рабочее место / серверный порт),
    используется при экспорте журнала кросс-соединений.
  - Каталог `scs-config.catalog.v1` расширяется defaults по `kind+model`
    (подсказки для ports/power/thermal/specifics).

- [ ] **13.5** — UI инспектор устройства
  - Слайд-панель открывается по клику на устройство в карте юнитов или
    в строке размещения. Табы: «Питание» / «Порты+Сеть» / «Тепло» /
    «Спец. параметры» (по subtype).
  - Live-валидация (диапазоны, форматы, дубликаты).
  - Сохранение в `state.contents` (LS_CONTENTS), без bulk-saveRacks.
  - Кнопка «📋 Применить ко всем такого же типа» — массовое заполнение
    по `typeId` в текущем проекте.

- [ ] **13.6** — POR-проекция устройств (опционально, после 1.28.8)
  - Каждое устройство в стойке = POR-объект с `parentRackId` (или
    вложенный в `contents[]` POR-rack-объекта без отдельного oid —
    решить в дизайне).
  - Domain-scoped видимость: networking-инженер видит только сеть/IP,
    не тепло/питание; электрик видит только powerInputs / cosPhi.

**Зависимости:** Фаза 1.28.6 (domain locks), Фаза 1.28.8 (DataAdapter
contract). Фаза 12.1 (psychrometrics) для расчёта суммарного теплоотвода
зала после ввода 13.3. Каталог типов `scs-config.catalog.v1` (расширение
defaults по kind+model).

**Acceptance:**
- Можно открыть карточку патч-панели «24×RJ45 cat.6», проставить порту 7
  IP `192.168.10.7/24` и роль `data`, экспортировать IPAM-CSV проекта.
- При попытке использовать оба ввода сервера на PDU-A (без B) — ошибка.
- Сводка по стойке показывает суммарный airflow, мощность по A/B/A+B,
  список конфликтных IP/VLAN.

---

### ⏳ Фаза 14 — План зала: ESKD/ISO scale + читаемые подписи (после 13)

**Требование (2026-04-28, юзер):** «сетку сделай до 50 мм и при этом не
ресайзь сам план, план все таки привязан к размерам. Надписи обозначения
шкафов размещай так чтобы они были читаемы, а не накалывались или
обрезались. Для плана так же сделай масштаб, с учетом что стандартный
текст должен быть размером не более 1,8 мм в натуральную величину и не
масштабировался, как согласно ЕСКД или ISO».

Превращает «План зала» в чертёжный документ, соответствующий ЕСКД
(ГОСТ 2.302) и ISO 5457/3098. Текст и условные обозначения — фиксированной
толщины и высоты в реальных миллиметрах независимо от zoom.

- [x] **14.1** — Шаг сетки 0.05 м (50 мм) минимум — закрыто
  (scs-design index.html: input min="0.05" step="0.05"; updatePlanGrid
  пересчитывает PLAN_CELL_PX так что физ.размер плана не меняется при
  смене шага).

- [ ] **14.2** — Читаемые подписи стоек (ЕСКД)
  - Текст в карточке стойки: высота не более 1.8 мм в натуральную
    величину (по ГОСТ 2.304 шрифт 1.8/2.5/3.5/5/7).
  - При уменьшении масштаба: если 1.8 мм меньше 8 px на экране —
    подпись выносится за пределы карточки (выноска со стрелкой).
  - При вращении стойки на 90°/270° — подпись остаётся горизонтальной.
  - При близко расположенных стойках (расстояние < 2× ширина текста) —
    подписи укладываются «ёлочкой» / в столбик / выноской.

- [~] **14.3** — Линейка масштаба (ISO 5457) — частично закрыто v0.60.13
  - ✓ Графическая шкала с auto-длиной (1/2/5/10/20/50/100 м).
  - ✓ Авто-подбор стандартного ЕСКД масштаба 1:50/100/200/500/1000/2000
    через snap к ближайшему (расчёт с учётом ~96 dpi экрана).
  - ✓ Tooltip объясняет приблизительность (зависит от DPI и формата печати).
  - TODO: рамка-кадр ISO 5457 (axes A/B/C, штамп-блок).

- [x] **14.4** — Печать в реальных размерах (PDF/SVG export) — закрыто v0.60.16
  - <code>exportPlanSvgRealScale(scaleN, paperFormat)</code> в scs-design.
  - SVG с width/height в мм (не px) для точной печати.
  - viewBox в px-координатах + конверсия pxPerMm для линий ЕСКД-толщины
    (0.7 мм основные / 0.35 мм вспом.).
  - Авто-валидация: если план не влезает в формат — предупреждение в
    статусе с подсказкой большего масштаба или формата.
  - Шкала-ruler 1 м в углу + headline «М 1:N · A1/A3».
  - Кнопки «⬇ SVG 1:50 A1» / «⬇ SVG 1:100 A3» / «⬇ SVG 1:200 A3»
    в sidebar plan-view.

- [ ] **14.5** — Стены и непересекаемые препятствия
  - Юзер (2026-04-28): «позже еще появятся стенки, которые нельзя пересекать».
  - Тип объекта `wall` на плане: `{ id, x, y, len, orient: 'h'|'v',
    thicknessMm, doors[]: { offset, widthM } }`.
  - Маршрутизация кабелей (buildCableRoute) обходит стенки. Алгоритм:
    A* / BFS по сетке плана с весом ∞ для ячеек, попадающих в стенку
    (кроме дверных проёмов, через которые маршрут разрешён).
  - В UI: добавить инструменты «➕ Стена ↔», «➕ Стена ↕», «➕ Дверь»
    в сайдбар плана. Стены рисуются толстыми линиями ЕСКД (0.7 мм при
    печати). Двери — разрыв в стене с дугой пути открытия.
  - Acceptance: если стена разделяет 2 стойки и нет двери в видимости
    direct-маршрута — кабель уходит к ближайшей трассе и через неё к
    двери; если нет ни одной трассы и нет двери — линия становится
    красной с предупреждением «нет физического маршрута».

- [ ] **14.6** — 3D / 2D виды для документации (channel sections)
  - Юзер (2026-04-28): «позже сделаем 3D и 2D виды для документации
    и размеров, c указанием обозначений каналов и сечений».
  - 2D-вид «Сечения каналов»: для каждого выделенного канала рендерится
    разрез ЕСКД-стиля (прямоугольник widthMm×depthMm, кабели в нём
    с типом/⌀, размеры с засечками, обозначение по ГОСТ 21.110).
  - 3D-изометрия плана (three.js) с рендером трасс над уровнем пола,
    стен (если 14.5), стоек 3D-моделями. Toggle-вид «3D / Top».
  - Экспорт обоих видов в SVG/PDF с лейаутом по ГОСТ 21.110 (рамка,
    штамп, спецификация каналов и кабелей).

- [ ] **14.7** — Фасонные элементы трасс (fittings) и привязка сегментов
  - Юзер (2026-04-28, feedback_tray_fittings.md, feedback_tray_snap.md):
    «трассы должны соединятся посредством стандартных фасонных
    элементов»; «сегменты трасс должны привязываться к шагу 100 мм
    или примыкание к другому каналу».
  - **14.7.1** — snap-to-100мм при drag/resize: координаты x, y, len
    округляются до 100 мм. В клетках: `round(xCells × step × 10) /
    (step × 10)`. Реализуется СРАЗУ — не требует каталога фитингов.
  - **14.7.2** — snap-to-adjacent: если конец/стенка перетаскиваемой
    трассы оказывается ≤100 мм от соседней — притянуть ВПЛОТНУЮ.
    Имеет приоритет над 14.7.1 (если фитинг возможен — точный стык,
    без округления). Связанная логика уже частично есть в
    snapTrayPosition — расширить.
  - **14.7.3** — Типы фитингов: тройник (T), крест (X), угол 90°,
    угол 45°, редукция, заглушка, соединительная пластина, подъём/
    спуск (vertical riser).
  - **14.7.4** — Каталог `shared/cable-tray-fittings-catalog.js`:
    id, type, sizeMm, manufacturer (DKC/Legrand/Schneider/IEK/KopOS),
    partNo, priceRUB, weightKg.
  - **14.7.5** — Автодетекция типа соединения по геометрии плана:
    где сходятся 2 трассы под 90° → угол; 3 трассы → тройник;
    4 трассы → крест. Ставится на каждом стыке после 14.7.2.
  - **14.7.6** — Рендер фитинга на плане как отдельного объекта
    (не просто пересечение линий) — ЕСКД-обозначение фитинга.
  - **14.7.7** — Расширение BOM: штучное кол-во фитингов по типам
    и размерам («Тройник Т 100×50 — 2 шт.»). Прямые трассы режутся
    на стандартные секции (обычно 3 м) с расчётом отхода и
    количества секций в спецификации.
  - **14.7.8** — Интеграция с логистикой (Phase Y) и ценами
    (Phase 1.5) — фитинги участвуют в стоимости проекта.

---

### ⏳ Фаза 15 — Двух-полевая мощность стойки + PDU как 3D-объект с розетками

**Требование (2026-04-28, юзер, feedback_rack_power.md):**
> «для конкретной стойки проекта должна указываться проектная мощность
>  стойки для размещения оборудования. При чем средняя указывается а
>  максимальная зависит только от мощности размещенных PDU.»
>
> «сами PDU должны иметь размеры, особенно длину и отображаться в 3D
>  виде шкафа, а в компоновщике шкафа так же нужно добавить отображение
>  состава розеток и добавить возможность подключения оборудования к PDU»

- [ ] **15.1** — Двух-полевая модель мощности стойки
  - `rack.powerAvgKw` — проектная средняя (ввод юзером).
  - `rack.powerMaxKw` — ВЫЧИСЛЯЕМАЯ из Σ номинала PDU (read-only).
  - Валидация при размещении оборудования:
    - Σ оборудования ≤ powerAvgKw → OK
    - powerAvgKw < Σ ≤ powerMaxKw → warning «превышение проектной средней»
    - Σ > powerMaxKw → ошибка «PDU не выдержат пик»
  - В UI Компоновщика: вместо «факт / запрос» — две полоски «средняя /
    максимум по PDU», обе с процентом заполнения.

- [ ] **15.2** — Габариты PDU
  - PDU-объект расширен: `widthMm`, `depthMm`, `lengthMm` (или `heightU`),
    `mountType: 'vertical-rear-left'|'vertical-rear-right'|'horizontal-1u'|'horizontal-2u'`.
  - Каталог PDU (`shared/pdu-catalog.js`) обновлён с этими полями для
    типовых моделей (Raritan PX3, APC AP8, Schneider Metered Rack PDU,
    Eaton ePDU, Lutze).

- [ ] **15.3** — PDU outlets[] — состав розеток
  - PDU.outlets[]: `{ no, kind: 'C13'|'C19'|'C20'|'C21'|'Schuko'|'IEC60309',
    voltageNominalV, currentMaxA, phase: 'L1'|'L2'|'L3'|'NA',
    occupiedBy?: deviceId }`.
  - Auto-генерация по PDU-модели (например 24×C13 + 12×C19).

- [ ] **15.4** — 3D рендер PDU в шкафу (configurator3d / 3D-вид rack-config)
  - Вертикальные PDU отрисовываются как brick на задней стене стойки
    (координаты по mountType — слева/справа).
  - Длина = lengthMm в реальном масштабе.
  - На лицевой грани — ряды розеток с цветовой кодировкой по типу
    (C13 — синий, C19 — красный, Schuko — белый, IEC — оранжевый).

- [ ] **15.5** — UI «🔌 PDU и розетки» в Компоновщике (rack.html)
  - Новая секция-панель: список PDU со статистикой (число розеток,
    занято, фазная нагрузка L1/L2/L3).
  - Под каждой PDU — таблица розеток: № / тип / V/A / фаза / занят кем.
  - Балансировка фаз: суммарная нагрузка по L1/L2/L3 + warning при
    дисбалансе >20% (требование IEC).

- [ ] **15.6** — Привязка power-вводов оборудования к розеткам PDU
  - Каждое устройство имеет `powerInputs[]` (см. Phase 13.1).
  - В UI инспектора устройства (Phase 13.5, таб «Питание»):
    кнопка «🔌 Подключить» рядом с каждым вводом → модалка со списком
    свободных совместимых розеток (правильный тип C13/C19, нужная фазность).
  - При выборе — `powerInputs[i].pduPort = '<pduId>/<outletNo>'` +
    `pdu.outlets[outletNo].occupiedBy = deviceId`.
  - Визуализация: линия от устройства к занятой розетке (как
    мини-маршрут внутри одной стойки) при ховере на устройство.
  - Проверка redundancy: 1-вводное устройство не должно иметь оба
    ввода к одному PDU (если 2 PDU — A/B); двух-вводное — должно
    иметь A+B.

- [ ] **15.7** — Электрический BOM по PDU
  - Вход: список PDU с моделями, занятость, фазная нагрузка.
  - Выход: спецификация PDU + расчёт автоматов на главном щите
    по фазам.
  - Интеграция с Phase 1.5 (catalog) для цен на PDU.

---

### ⏳ Фаза 16 — Подробный расчёт длины кабеля по физическому маршруту

**Требование (2026-04-28, юзер, feedback_cable_length.md):**
> «длина линии должна учитывать расположение порта (на какой высоте
>  находится порт), расстояние от порта до горизонтального органайзера,
>  затем до вертикального до выхода из стойки, затем подъём на уровень
>  трассы и по соединённым (с разрывом ≤20см) участкам трасс. … Длина
>  пересчитывается автоматически при изменении расположения оборудования
>  с портом или расположения стойки.»
>
> «для СКС могут так же быть розетки на стене или оборудование с портом
>  СКС / данные»

- [ ] **16.1** — Высота порта (port height per device)
  - Формула: `portHeightMm = (rack.u − device.positionU) × 44.45 + portRowOffsetMm`
  - 1U device 1-row: portRowOffset = 22 (середина U)
  - 1U device 2-row (48-port patch panel): top_row=33, bottom_row=11
  - 2U+ device: середина или явное `device.portRows[]`
  - Учёт направления распределения: `rack.distributionFrom: 'top'|'bottom'`
    (overhead vs underfloor) — определяет, считается высота от верха
    или низа стойки.

- [ ] **16.2** — Внутри-стоечный путь (port → exit)
  - Базовый случай (без органайзеров): port → стенка стойки (½ ширины) →
    вверх/вниз вдоль стенки → подъём к трассе.
  - С органайзерами: port → ближайший horiz-organizer (1U выше/ниже
    устройства, на нужной строне для multi-row) → vertical organizer →
    выход из стойки.
  - Автодетекция horizontal organizer'ов в `state.contents[rackId]`
    (typeId с `kind === 'cable-manager'` или `cable-manager-1u`).
  - Vertical organizer как property стойки (`rack.verticalOrganizers:
    {side, widthMm}`) ИЛИ дефолтный (внутренняя стенка стойки).

- [ ] **16.3** — Подъём к уровню трассы
  - Riser segment: от верха/низа стойки до centerline ближайшей трассы.
  - Учёт разрыва ≤20 см между несоединёнными участками трасс
    (cable jumps the gap if small enough).

- [ ] **16.4** — Зеркальный путь на стороне получателя
  - Аналогично 16.2 + 16.3, но в обратном направлении: trayExit →
    rise-down → V-organizer → H-organizer → port.

- [ ] **16.5** — Поправки на изгибы и запасы
  - Минимальный радиус изгиба: copper UTP — 4×диаметр, оптика — 10×диаметр.
    +20мм на каждом изгибе (типично 6-8 изгибов).
  - Slack loop в стойке: 30-50 см запаса с каждой стороны для повторных
    подключений.
  - Маркировочные хомуты: +5-10 см.
  - k_route коэффициент (по умолчанию 1.3) — общий запас на маркировку
    и заделку.

- [ ] **16.6** — Endpoints не только rack-port: wall outlet и standalone
  - Расширить модель `link.fromEndpoint` / `toEndpoint`:
    ```
    { type: 'rack-port'|'wall-outlet'|'standalone-device',
      rackId?, devId?, portIdx?,
      x?, y?, heightMm?, label?, kind?: 'rj45'|'lc'|'sc'... }
    ```
  - UI: палитра «Розетки на стене» / «Внешнее оборудование» в Компоновщике
    (или отдельный модуль).
  - Wall outlet: высота установки (типично 0.4-0.6 м от пола), путь
    кабеля поднимается по стене до уровня трассы (за потолком или
    в плинтусе).
  - Standalone (Wi-Fi AP, IP-камера, принтер): координаты + высота
    установки → прямой путь к ближайшей трассе.

- [ ] **16.7** — Авто-пересчёт длин при изменениях
  - Hooks на `savePlan(p)`, `setLinks(...)`, `state.contents` change.
  - Перебираем все links → если `!link.lengthFrozen` → пересчитываем
    `link.lengthM = computeSuggestedLength(link, plan)`.
  - При изменении `device.positionU` — пересчёт всех links, где этот
    device endpoint.
  - При изменении `rack` position на плане — пересчёт всех links
    where this rack involved.

- [ ] **16.8** — Флаг lengthFrozen + UI
  - `link.lengthFrozen: boolean` — юзер вручную задал длину.
  - Иконка 🔒 рядом с полем длины в таблице связей.
  - Кнопка «↻ Пересчитать автоматически» — снимает freeze и пересчитывает.
  - В bulk-toolbar — массовое снятие freeze у выделенных.

- [ ] **16.9** — Подробный breakdown в tooltip
  - При hover на длину в таблице связей — tooltip:
    ```
    Внутри A: 0.30 м (порт→H-org) + 0.22 м (H→V) + 1.60 м (вверх) + 0.15 м (подъём)
    По трассе: 12.40 м (3 сегмента)
    Внутри B: ... аналогично
    Запас k=1.3
    Итого: 18.5 м
    ```
  - Помогает инженеру понять, откуда взялась суммарная длина.

**Зависимости:**
- Phase 13 (детальные параметры устройств) — `portRows[]` per device.
- Phase 14 (план зала ЕСКД) — точные физические координаты.
- Phase 14.5 (стены) — пересечение со стенками для wall-outlet.
- Каталог типов (`scs-config.catalog.v1`) — флаг `kind === 'cable-manager'`.

**Acceptance:**
- Кабель CR01·port12 → SR05·port24: рассчитан как 0.3+0.2+1.6+0.15+8.4+0.15+1.6+0.2+0.3 = 12.9 × k=1.3 = 16.77 м.
- Перемещение CR01 на 2 м влево → длина автоматически пересчитана.
- Перенос patch panel из U=42 в U=20 → длины всех связанных кабелей
  пересчитаны (вертикальный отрезок изменился).
- При установке horizontal organizer выше patch panel → внутри-стоечный
  путь укорачивается (порт→H-org вместо порт→стенка).
- Wall outlet «РМ-12» (x=15, y=8, h=0.4м) → cat6a → SR03·port17:
  длина = 0.4(подъём) + по трассе + 0.15+1.6+0.22+0.3+0.3 (внутри SR03) ≈ 14 м.

**Зависимости:**
- Phase 13 (детальные параметры устройств) — `powerInputs[]` обязателен.
- Phase 1.5 (catalog) — каталог PDU моделей с ценами.
- Phase 1.28 (POR) — синхронизация электрической нагрузки между SCS
  и Электрик-инженером (rack.powerAvgKw → POR.electrical.demandKw).

**Acceptance:**
- Можно создать стойку с powerAvgKw=5кВт и установить 2× APC AP8881
  (24×C13+6×C19, 32А, 3Ф). Расчётная powerMaxKw = 22.1 кВт автоматически.
- Размещение сервера 2кВт с 2 вводами C14 → подключаем 1 ввод
  к PDU-A розетке 5, 2-й ввод к PDU-B розетке 5. Сервер виден
  в обеих PDU как occupant.
- Балансировка фаз: видно нагрузку по L1/L2/L3 (например 7/8/7 кВт).
- В 3D-виде стойки видно вертикальные PDU с реальной длиной 1700 мм
  с правой и левой стороны.

**Зависимости:** Фаза 13 (детальные параметры устройств) — стабилизация
карточек до серьёзного редизайна плана. Фаза 1.27/1.28 (project scope +
POR) для сохранения настроек масштаба per-project.

**Acceptance:**
- Сетка 50 мм видна, при смене 600 → 50 мм план не «дёргается» — общий
  размер canvas стабилен.
- Подписи стоек читаемы при zoom 100%, не клипуются на маленьких
  карточках; при zoom < 50% автоматически появляются выноски.
- Линейка масштаба работает, экспорт SVG/PDF в 1:100 на A3 даёт
  чертёж с правильной геометрией при измерении линейкой.

---

## Критичные файлы (живой индекс)

### Платформа (общее)
- `js/engine/state.js` — единый state проекта
- `js/engine/constants.js` — GLOBAL, все константы (VOLTAGE_CATEGORIES, CABLE_CATEGORIES, CONNECTION_KINDS)
- `js/engine/electrical.js` — `formatVoltageLevelLabel`, `migrateVoltageLevels`, `isThreePhase`, `cableWireCount`
- `js/engine/zones.js` — `effectiveTag()` (расширять для IEC 81346 в Фазе 2)
- `js/engine/index.js` — инициализация, sync с global-settings
- `js/engine/modes.js` — `effectiveLoadFactor` для режимов работы
- `js/engine/recalc.js` — основной пересчёт кабелей/автоматов/модулей
- `js/engine/render.js` — SVG рендер узлов/связей
- `js/engine/inspector/*.js` — панели свойств узлов

### Shared (общее для модулей)
- `shared/global-settings.js` — единый источник настроек (**обязательно** читать через `getGlobal()` в подпрограммах)
- `shared/auth.js` — Firebase OAuth + localStorage fallback
- `shared/app-header.js` — единый хедер с шестерёнкой
- `shared/{panel,ups,battery,transformer,cable-types}-catalog.js` — каталоги (→ унифицировать в Фазе 1)
- `shared/catalog-xlsx-parser.js` — XLSX парсер для 3 каталогов
- `shared/calc-modules/*` — расчётные модули (ampacity, vdrop, short-circuit, phase-loop, economic)
- `shared/report/*` — конструктор отчётов
- `shared/report-catalog.js` — шаблоны отчётов

### Подпрограммы (standalone)
- `cable/cable-calc.js` — логика расчёта кабельной линии
- `battery/battery-calc.js` + `battery/battery-data-parser.js` — АКБ + парсер таблиц разряда
- `ups-config/ups-config.js` (WIP)
- `panel-config/panel-config.js` (WIP)
- `transformer-config/transformer-config.js` (WIP)
- `schematic/schematic.js` + `schematic/iec60617-symbols.js` + `schematic/iso-paper.js`
- `reports/reports.js` + `reports/templates-seed.js`

### Данные и хранение
- `js/projects.js` — dual storage adapter (Firestore/localStorage)
- `firebase-config.js` — конфигурация (пустая для локального режима)
- `modules.json` — манифест модулей
- Legacy localStorage keys (для миграции):
  - `raschet.global.v1` — глобальные настройки
  - `raschet.{panel,ups,battery,transformer}Catalog.v1.<uid>` — каталоги
  - `raschet.cableTypesCatalog.v1.<uid>` — кабели
  - `raschet.reportCatalog.v1.<uid>` — шаблоны отчётов
  - `raschet.presetsDeleted.v1`, `raschet.presetsOverrides.v1`, `raschet.userPresets.v1` — пресеты

---

## Verification checklist (после каждой подфазы)

1. `git status` — все изменения ожидаемые, нет мусора
2. Локально: Ctrl+Shift+R в браузере, открыть Конструктор схем и подпрограммы — консоль без ошибок
3. Существующие проекты пользователей открываются без ошибок (миграция работает)
4. `git commit` + `git push origin main` с полным changelog
5. Обновить `APP_VERSION` в `js/engine/constants.js`
6. Через ~45 сек: `WebFetch https://daniil248.github.io/raschet/...` проверка деплоя

> История изменений ведётся в отдельном модуле (`changelog/`) и в git-логе, в этот roadmap не дублируется.

---

## Фаза 17 — Управление объектом как отдельный продукт (продаваемые/отдельно-деплоимые модули)

> **Это большой финальный этап развития платформы**, ставится намеренно
> в конец roadmap — выполняется после того как все остальные фазы
> (проектировщик, каталоги, расчёты, конструкторы, auth, библиотека в БД)
> стабилизированы.

**Требование (2026-04-22):** модуль «Управление объектом» должен быть
возможно продать клиенту или разместить на отдельном сервере, при этом
с возможностью обновления независимо от основной платформы проектирования.
Также эта архитектура должна распространяться и на другие возможные
отделяемые модули (например мониторинг, эксплуатация, ЗИП, планировщик ТО).

**Ключевая идея:** Raschet = редактор проекта (draft/planned).
«Управление объектом» = SCADA/EAM-подобный модуль для installed/operating.
Данные проекта при сдаче объекта переходят из Raschet в «Управление объектом»
как источник-справочник, и живут там, обогащаясь телеметрией/инцидентами.

## 17.1 — Контракт «всё через schema-versioned JSON»
- [ ] Каждый тип данных проекта получает версионированную JSON-схему
  (`raschet.<domain>/<ver>`): project, scs-links, scs-plan, scs-racks,
  scheme-nodes, scheme-connections, inventory-item, facility-item и т.д.
- [ ] Версия в корне каждого экспортируемого документа
- [ ] Политика совместимости: новые поля опциональны, удаление = мажорная
  версия; обязательная миграция для мажорного перехода
- [ ] Публичная спецификация схемы (markdown в репо) — чтобы сторонние
  разработчики могли писать интеграции

## 17.2 — project-storage как интерфейс
- [ ] LS-реализация ← есть (1.27.0 MVP)
- [ ] HTTP-реализация (REST/JSON-RPC) для внешних backend
- [ ] IndexedDB-реализация для крупных проектов (схема/SVG/assets)
- [ ] Конфигурация транспорта через manifest.json приложения

## 17.3 — «Управление объектом» как самостоятельный SPA
- [ ] Отдельный репо / подпапка с независимым билдом
- [ ] Собственный деплой: GitHub Pages / on-prem / docker-контейнер
- [ ] Читает проекты через API project-storage (HTTP или через загрузку
  JSON-экспорта от Raschet)
- [ ] Не зависит от внутренних LS-ключей конфигураторов основной платформы
- [ ] Расширения данных (телеметрия, инциденты, ТО) живут в отдельной
  scope-таблице, не трогают scope проекта-источника
- [ ] Интеграция с системами мониторинга объекта (SNMP, BACnet, Modbus,
  OPC UA — позже отдельными подфазами)

## 17.4 — Обновляемость отдельно-деплоимых модулей
- [ ] Манифест модуля (`manifest.json`): имя, semver модуля, требуемая
  версия schema проекта, список поддерживаемых доменов
- [ ] Основная платформа проверяет совместимость при регистрации
  внешнего модуля (registry в hub'е + «подключенные модули» в Проектах)
- [ ] Graceful degradation при несовместимых schema-версиях (read-only
  + всплывашка «модуль требует обновления»)
- [ ] CI pipeline для внешнего модуля — независимые релизы

## 17.5 — Лицензирование / тариф модуля (связано с Фазой 5 Auth)
- [ ] Модульная лицензия: organization key + срок + список фич
- [ ] Верификация offline через подпись или online через auth-сервер
- [ ] UI для ввода/продления ключа
- [ ] Логирование использования (без PII) для биллинга

## 17.6 — Жизненный цикл данных: проект → объект
- [ ] При переходе проекта в статус `installed` — данные копируются (или
  экспортируются JSON'ом) в «Управление объектом»
- [ ] Двусторонняя синхронизация: Raschet может читать актуальное
  состояние с объекта (выполненные отклонения, замены оборудования)
- [ ] История изменений (audit trail) в обоих модулях

## 17.7 — Другие кандидаты на отделение (после 17.3)
- [ ] ЗИП / склад (под «Управление объектом»)
- [ ] ТО и инциденты
- [ ] Энергомониторинг (отдельный дашборд)
- [ ] Мобильный companion (осмотры, чеклисты, сканирование QR-меток стоек)

**Acceptance criteria для MVP Фазы X:**
- Есть спецификация JSON-схемы проекта, опубликована в репо
- Клиент может скачать JSON проекта из Raschet и загрузить в standalone
  «Управление объектом»
- «Управление объектом» обновляется независимо от основной платформы
  (новая версия не ломает существующие данные)
- В Raschet видно, какие проекты открыты в режиме «действующий объект»
  (bi-directional link, если оба доступны по сети)

---

## Фаза 18 — Рабочее место логиста (2 недели) 🆕

> Перенесено из Фазы 1.6 в самый конец roadmap'а как самостоятельный
> отделяемый этап (по решению 2026-04-27): логистика — это домен
> снабжения/доставки, не блокирующий основной маршрут расчёта проекта.
> Существующая реализация (1.6.1–1.6.3) уже в проде и используется по
> запросу; дальнейшее развитие (18.4 маршрутизация и т.д.) — после Фаз
> X.* и приоритетов выше.

**Задача пользователя:** модуль расчёта логистики. Проект → расчёт доставки, складирования, итоговой стоимости с логистикой.

- [x] **18.1** Схемы данных (закрыто 2026-04-20):
  - `shared/logistics-schemas.js` объединяет всё: Warehouse, CarrierRate,
    Shipment в одном модуле.
  - `WarehouseRecord`: id/name/counterpartyId/type/address/capacityM3/
    costPerM3Day/leadDays. 5 типов (`WAREHOUSE_TYPES`: own/rented/
    supplier/customer/transit).
  - `CarrierRate`: id/carrierId/mode/unitRUB/perKg/perKm/perM3/minOrder/
    note. 6 режимов (`SHIPMENT_MODES`).
  - `ShipmentRecord`: id/projectId/label/status/mode/carrierId/originId/
    destinationId/items[]/cost/currency/plannedAt/deliveredAt/notes.
    5 статусов (`SHIPMENT_STATUSES`).
  - `calcShipmentCost(items, rate, opts)` — калькулятор с breakdown по
    fixed/perKg/perKm/perM3 + minOrder clamp.
  - Per-user localStorage, listener API для всех трёх.

- [x] **18.2** `logistics/` module UI (закрыто 2026-04-20):
  - `logistics/index.html` + `logistics.js` + `logistics.css`, 4 таба:
    Отправления / Склады / Тарифы / Расчёт.
  - Печать ТТН / проформы через встроенный HTML-шаблон
    (`table.items` со стандартными полями).

- [x] **18.3** Интеграция с BOM + ценами (закрыто 2026-04-20):
  - `js/engine/export.js`: кнопка «🚚 Передать в логистику» в боковой
    панели Конструктора. Сохраняет handoff в localStorage и открывает
    `logistics/?import=1` с projectId.
  - `js/engine/report-sections.js:sectionLogistics` — раздел «Логистика
    и доставка» в BOM-отчёте: фильтрует shipments по текущему projectId,
    выводит таблицу с маршрутом, массой, объёмом, стоимостью товаров и
    перевозки, итоговой сметой.

- [ ] **18.4** Маршрутизация (опционально, после Фазы 17):
  - Несколько точек доставки (мультистоп)
  - Учёт складов-хабов (Москва → региональный склад → стройплощадка)
  - Оптимизация по стоимости / времени

**Критичные файлы Фазы 18:**
- `shared/warehouses.js`, `shared/shipments.js`, `shared/logistics-rates.js` (новые)
- `logistics/index.html`, `logistics/logistics.css`, `logistics/logistics.js` (новые)
- `logistics/tab-*.js` — по таб для каждой секции
- Интеграция в `shared/report/` — блок «Логистика»
- Интеграция в `js/engine/inspector/` — кнопка «Рассчитать логистику»

---

## Фаза 19 — Пресеты отображения карточек на схеме 🆕

> Запрос пользователя (2026-04-29): «пресеты настройки отображения
> карточек объектов, щитов, потребителей, чтобы пользователь мог
> настраивать свой вид этих карточек, и выводить только нужные ему
> данные» + расширение: «Приоритет следующий, если есть настройка
> конкретной схемы, берем настройку схемы, если для схемы настройки
> нет, берем настройки проекта, иначе берем настройку пользователя.
> Сами настройки нужно так же сохранять в пресеты чтобы пользователь
> мог быстро их переключать. Сами настройки должны так же выбираться
> для каждого режима».

Текущие карточки узлов на схеме (consumer / panel / source / generator /
ups) рисуют фиксированный набор полей. Не все одинаково важны разным
пользователям — электрик хочет видеть автомат и Iдоп, технолог —
мощность и площадь, пресейл — кВА и стоимость. Сейчас всем показывается
всё, карточка перегружена.

**Иерархия приоритетов (от старшей к младшей):**
1. **Схема** (page-level) — `page.cardPresetId` для конкретной страницы.
2. **Проект** — `project.cardPresetId` (общий пресет для всего проекта).
3. **Пользователь** — `user.cardPresetId` (per-user в LS, дефолт).

Если на текущей схеме нет настройки → берём проектную, иначе пользовательскую,
иначе системный дефолт «Полный».

**Per-mode/режим:** настройка делается отдельно для каждого режима страницы
(`page.kind`): schematic / layout / scs-design / mechanical / hvac.
Структура пресета содержит per-mode-секции, render.js читает применимую
по текущей странице.

**Подзадачи:**

- [x] **19.1** Реестр доступных полей по типу карточки и режиму (закрыто v0.59.783)
  - Для каждого `(page.kind, node.type)` — список field-id с label'ами:
    напр. `(schematic, consumer)` имеет `currentKw`, `currentA`, `maxKw`,
    `maxA`, `nominalKw`, `nominalA`, `freeKw`, `cosPhi`, `breakerIn`,
    `cableSpec`, `deltaUPct`. Для `(layout, consumer)` — другой набор
    (физические габариты, площадь, тип охлаждения).
  - Файл: `shared/card-fields-registry.js`.

- [~] **19.2** Пресет-схема + 3-уровневое хранилище (user/project/scheme) (user-уровень + 4 системных пресета закрыто v0.59.783; project/scheme-уровни — структура поддержана в resolver, UI настройки уровня — в 19.3)
  - Структура пресета:
    ```
    {
      id, name,
      perMode: {
        schematic: { perType: { consumer: [field-id…], panel: […], … } },
        layout:    { perType: { … } },
        ...
      }
    }
    ```
  - Storage:
    - **User-level** (default): LS `raschet.cardPresets.v1` (массив
      пресетов) + `raschet.cardPresetActive.v1` (id активного).
    - **Project-level**: `project.cardPresets[]` + `project.cardPresetActiveId`
      внутри scheme JSON. Сохраняется через project-storage.
    - **Scheme-level** (per-page): `page.cardPresets[]` + `page.cardPresetActiveId`
      в state.pages[i].
  - Дефолтные системные пресеты: «Полный» (все поля = текущее поведение),
    «Электрик» (kW/A/breaker/cable/ΔU), «Технолог» (kW/cosPhi/площадь),
    «Минимум» (только tag/name).

- [x] **19.3** UI настроек пресета (модалка) (закрыто v0.59.787)
  - В сайдбаре «Свойства страницы» — секция «🎴 Карточки на схеме»:
    селектор активного уровня (User / Project / Scheme), селектор
    активного пресета на этом уровне, кнопка «✎ Настроить…».
  - Модалка с tabs:
    - Tab 1: «Уровень» — radio user/project/scheme + список пресетов
      на каждом уровне с кнопками create/rename/delete.
    - Tab 2: «Поля» — per-mode-табы (schematic/layout/...), per-type
      под-табы (consumer/panel/...), чекбоксы на каждое поле.
    - Tab 3: «Импорт/экспорт» — кнопки export JSON, import JSON.

- [~] **19.4** Resolver и применение в render.js (resolver полный + invalidate-кэш закрыто v0.59.783; v0.59.795 расширено: load-блок (для всех типов узлов кроме channel/zone) скрывается полностью если active preset не имеет non-required полей для (kind, type) — позволяет «Минимум» пресету реально скрыть электрические данные. Status-line (off / ⚠ перегруз) остаётся видимой как критичная инфо. Per-field гранулярность для panel/source/ups — в следующей итерации)
  - Helper `resolveCardPreset(page, project, user)` возвращает effective
    пресет, выбирая по приоритету scheme → project → user → system-default.
  - В render.js при отрисовке карточки узла: читаем `preset.perMode[page.kind].perType[node.type]` → фильтруем поля.
  - Гарантия: tag/name/error-badge всегда видны (это «обязательные»
    поля независимо от пресета).
  - Кэширование resolved пресета (invalidate при изменении).

- [x] **19.5** Live-переключение без перезагрузки (закрыто v0.59.783 — селектор в toolbar + raschet:card-preset-changed event инвалидирует кэш + render())
  - При смене активного пресета (на любом уровне) — re-render всех
    canvas-карточек.
  - Toast «Применён пресет «<name>» (уровень: проект)».

- [x] **19.6** Экспорт/импорт пресетов между проектами/инженерами (закрыто v0.59.787 для user-уровня — JSON download/upload в editor-модалке)
  - JSON-схема `raschet.cardPresets/1`. Импорт мерджит с существующими
    (по id) или создаёт новые с новым id (опционально).
  - Кнопки в модалке настроек.

**Acceptance:**
- Электрик создаёт user-пресет «Электрик» с полями kW/A/breaker/cable/ΔU
  для schematic-режима — карточки на главной схеме показывают эти поля.
- Тот же электрик открывает страницу «План зала» (layout-режим) —
  его user-пресет имеет в layout-секции другие поля (габариты,
  тип охлаждения), карточки в layout рисуются ими.
- Технолог в проекте создаёт project-пресет «Технолог» — все коллеги,
  открывшие этот проект, видят карточки по Технолог-пресету (если у них
  не задан scheme-overrride).
- На конкретной странице можно поставить scheme-пресет «Только мощность»
  для скриншотов клиенту — он переопределит project и user пресеты для
  этой страницы.
- При смене активного пресета карточки на canvas обновляются мгновенно.
- Пресеты экспортируются JSON-файлом и импортируются на другой машине.

---

## Фаза 20 — Рабочее место технолога ЦОД 🆕

> Добавлено 2026-04-29 по запросу пользователя. Технолог ЦОД работает на
> предпроектной стадии: формирует **концепцию объекта** (количество стоек,
> мощности, резервирование, площади, ТП/ДГУ), без углубления в СКС или
> в детальный выбор моделей оборудования. Эта фаза даёт ему отдельный
> workflow — выходные данные потом передаются электрикам / СКС-инженерам /
> климатикам как ТЗ. Ортогональна Фазе Y (логист) и Фазе 10 (mdc-config —
> уже более детальный конфигуратор для конкретной серии GDM-600).

**Зона ответственности технолога:**
- Что ВХОДИТ: количество стоек + мощность на стойку, итоговая IT-нагрузка,
  количество и мощность ИБП-систем, количество и мощность кондиционеров,
  уровни резервирования всех систем (N / N+1 / 2N), площади помещений
  (машзал, ИБП, АКБ, климат, ТП, ДГУ), необходимость и мощности ТП/ДГУ,
  концептуальные требования к PDU (тип / фазность / ток / резервирование),
  состав МЦОД (если применимо), пояснительная записка, multi-variant compare
  для согласования с заказчиком.
- Что НЕ ВХОДИТ: СКС (отвечает СКС-инженер), активное/пассивное оборудование
  в стойках (заказчик / IT-отдел), детальный выбор моделей силового
  оборудования (электрик), кабельные журналы (электрик), раскладка СКС
  по портам (СКС-инженер).

**Подзадачи:**

- [x] **20.1** Модуль `tech-workspace/` — закрыто v0.59.892 (двухпанельный layout)
  - `tech-workspace/index.html` + `tech-workspace.js` + `tech-workspace.css`
  - Шапка проекта: имя / номер / заказчик (читается из активного проекта)
  - Левая панель — список вариантов концепции (multi-variant compare),
    кнопки «➕ Новый вариант», «📋 Дублировать», «🗑 Удалить», «⭐ Сделать основным»
  - **v0.59.892 UX-рефакторинг (Etap A)**: список блоков (rail) + детали
    выбранного блока вместо распахнутых секций сразу всех. Bulk-toolbar
    для группового редактирования стоек (размеры/PDU). Inline UI вместо
    browser dialogs. Summary-bar с KPI и индикацией недостатка/запаса.
  - **Два режима входа**: Список / План — переключатель в левой панели.
  - **Опциональный выбор конкретных изделий**: catalog-picker для
    стойки / ИБП / кондиционера / ТП / ДГУ / PDU.

- [x] **20.2** Концепция стоек — закрыто v0.59.784 (rackGroups[] per-group)
  - Параметры: общее количество стоек (например 64), мощность на стойку
    (например 7 кВт), типовой профиль (IT-rack / blade / GPU-heavy /
    network / storage). Ширина / глубина стойки (мм) — без выбора модели.
  - Расчёт: итоговая IT-нагрузка = N × P_rack, итоговая площадь машзала
    с учётом коэффициента укладки (по ASHRAE / TIA-942).
  - Выход: `concept.racks = { count, kwPerRack, profile, widthMm, depthMm }`.

- [x] **20.3** Концепция системы ИБП — закрыто v0.59.784 (upsSystems[] per-purpose)
  - Параметры: общее число ИБП-систем (например 2 параллельные), номинал
    каждого (300 кВА), уровень резервирования (N / N+1 / 2N), коэффициент
    загрузки (например 80% от номинала), время автономии (мин), тип АКБ
    (VRLA / Li-ion).
  - Расчёт: проверка достаточности (`Σ ИБП × KЗАГ ≥ IT-нагрузка`),
    рекомендуемая ёмкость АКБ, рекомендуемая площадь под АКБ.
  - Без выбора конкретной модели — это домен электрика на следующем этапе.
  - Выход: `concept.ups = { count, ratedKva, redundancy, loadFactor,
    autonomyMin, batteryTech }`.

- [x] **20.4** Концепция системы кондиционирования — закрыто v0.59.784 (coolingUnits[] per-type)
  - Параметры: количество кондиционеров (CRAC / inRow / fan-coil),
    мощность холода каждого (кВт), уровень резервирования (N / N+1).
  - Расчёт: требуемая холодопроизводительность ≥ IT-нагрузка × 1.0
    (с учётом климатических потерь по ASHRAE), пересчёт под N+1.
  - Выход: `concept.cooling = { units, kwPerUnit, redundancy, type }`.

- [x] **20.5** Концепция ввода: ТП и ДГУ — закрыто v0.59.779 (concept.feed)
  - Параметры: необходимость ТП (да/нет), мощность ТП (кВА), уровень
    резервирования (1 ввод / 2 ввода / 2 ввода + АВР), необходимость ДГУ
    (да/нет), мощность ДГУ (кВт + ESP/PRP), уровень резервирования
    (нет / N+1 / 2N), запас под scale-up.
  - Расчёт: итоговая принятая мощность объекта (с учётом потерь в ИБП,
    запаса, климата, СН), требуемая мощность подстанции.
  - Выход: `concept.feed = { tp: { needed, kva, redundancy }, dgu: { needed, kw, mode, redundancy } }`.

- [x] **20.6** Концепция PDU (per-rack-group) — закрыто v0.59.784 (rg.pdu внутри каждой группы стоек)
  - Параметры: тип PDU (basic / metered / switched / monitored), фазность
    (1ф / 3ф), номинальный ток на ввод (16/32/63 А), количество вводов
    на стойку (1 / 2 / 4 для 2N), типы розеток (C13/C19, насколько штук на
    стойку). Без указания модели/производителя.
  - Выход: `concept.pdu = { kind, phases, ratingA, inputsPerRack, outlets[] }`.

- [x] **20.7** Площади помещений — закрыто (calcAreas в tech-workspace)
  - Расчёт по ТКП 308-2011 / TIA-942 на основе количества стоек / ИБП /
    кондиционеров. Выход: concept.areas[] с m2 и пояснениями.
  - Render в детали блока «📐 Площади помещений».
  - TODO: грубая планировка (drag-drop помещений на сетку) — отдельная
    задача под Phase 14.x.

- [x] **20.8** МЦОД (модульный вариант) — закрыто v0.59.893 (Etap B)
  - `concept.mdcBuildings[]` массив зданий со ссылкой на mdc-config sub-проект.
    Каждое здание хранит `mdcSubProjectId` (sketch-проект с
    `ownerModule="mdc-config"`), `count` (кол-во одинаковых зданий),
    `configurator` (gdm600 — расширяемо для будущих типов МЦОД).
  - Rail-секция «🏢 МЦОД» с summary из mdc-config (totalRacks × rackKw).
  - Действия: ↗ Открыть в mdc-config / ➕ Создать новый / 🔗 Привязать
    существующий / 🔌 Отвязать. Read-only сводка из mdc-config (правится
    только в самом mdc-config, не в Технологе).

- [~] **20.9** Пояснительная записка (HTML / PDF через печать; DOCX отложен) (закрыто v0.59.791)
  - Шаблонная ПЗ по концепции: структура с разделами «Описание объекта»,
    «Концепция размещения», «Электроснабжение», «Климат», «Резервирование»,
    «Площади», «Перечень ТЗ для смежных дисциплин (электрик / СКС /
    климатик)».
  - Автозаполнение из `concept.*` полей выбранного варианта.

- [x] **20.10** Multi-variant compare (закрыто v0.59.788 — режим «📊 Сравнение» в tech-workspace, side-by-side таблица с подсветкой best-значений; отметка «Согласовано» через handoff'а)
  - Side-by-side сравнение 2–3 вариантов концепции по ключевым параметрам
    (мощность / площадь / резерв / стоимость concept-уровня).
  - Кнопка «Согласовано с заказчиком» — фиксирует версию + дата + ФИО.

- [~] **20.11** Handoff в детальное проектирование (MVP закрыт v0.59.789 — генерация engine.scheme.v1 с узлами без connections; пользователь проводит линии вручную в Конструкторе. Расширения: handoff в scs-design / mdc-config — будут позже)
  - Кнопка «📤 Передать в проектирование» из 20.10:
    - В `mdc-config/` (если МЦОД) — предзаполнение из `concept.*`.
    - В `schematic/` (главная схема) — создание узлов: source/transformer
      по `concept.feed.tp`, generator по `concept.feed.dgu`, ups-узлы
      по `concept.ups.count`, panel-узлы (ГРЩ / ЩС-IT / ЩС-климат),
      consumer-rack узлы группой ×N с `demandKw = concept.racks.kwPerRack`.
    - В `scs-design/` — план зала стоек по `concept.racks` для СКС-инженера.
  - Концепция переходит в `read-only` после первого handoff (variant
    становится «утверждённой версией»).

- [x] **20.12** PUE-расчёт (auto + manual) — закрыто v0.59.895 (Etap D)
  - `concept.pue = { mode: 'auto'|'manual', manualPue, value }`.
  - **Auto**: PUE = 1 + (P_cooling + P_losses) / P_IT, где P_cooling
    зависит от доли FreeCool-часов (T<14°C → COP 15, иначе компрессор
    COP 3.5). Источник климата — активный meteo-датасет (см. Фаза 21).
    Если meteo нет — fallback 55% часов FreeCool по среднестатистическому
    климату умеренной полосы.
  - **Manual**: юзер вводит значение напрямую (1.05–3.0).
  - Rail-секция «📊 PUE» с chip-значением и разбивкой расчёта.

- [x] **20.13** BOM (спецификация) с ценами по дате — закрыто v0.59.896 (Etap E)
  - `concept.bomDate` (default = today) + `concept.bomOverrides[bomKey]`.
  - Lookup через `pricesForElement(elementId, { recordedBefore: dateMs })`
    — самая поздняя цена из price-records на или до выбранной даты
    (history-aware, изменения цен после даты не учитываются).
  - Если modelRef не привязан или цены нет — поле пустое, юзер вводит
    вручную (override per-row). Σ Итого по валютам отдельно
    (multi-currency не суммируется в одну).
  - Rail-секция «📦 BOM» с переключением даты, ссылкой на /catalog/.

**Storage:**
- `raschet.project.<pid>.tech-workspace.variants.v1` — массив вариантов
- `raschet.project.<pid>.tech-workspace.activeVariantId.v1` — id активного

**Интеграции:**
- Hub: плитка «🏗 Рабочее место технолога ЦОД».
- Entry-page: сразу регистрирует POR-bootstrap (как остальные модули).
- Domain: `domains.concept` (новый POR-домен) для будущей синхронизации.

**Acceptance:**
- Технолог может за 30–60 мин подготовить концепцию объекта в одном
  модуле, без переключения между схематикой / mdc / ups-config.
- Multi-variant compare для согласования с заказчиком работает без
  дублирования ввода данных.
- Хэндof в детальное проектирование одной кнопкой создаёт корректный
  скелет схемы (тех-инженер не должен сам перерисовывать).

---

## Фаза 22 — Подбор холодильных систем (Cooling Systems) 🆕

> Добавлено 2026-05-02. Stand-alone модуль для технико-экономического сравнения
> чиллеров (CHW), DX-систем (air-cooled, pumped refrigerant) и решений с
> фрикулингом по климатическим данным проекта.

**Архитектурное требование** (Пользователь 2026-05-02): «модули должны быть
построены так, что расчётная часть в отдельных файлах, а их графическое
standalone-приложение в отдельном. Чтобы использовать расчётную часть без
графики в других приложениях если это не требуется». Реализовано через
строгое разделение `cooling/calc/*.js` (pure, no DOM) и `cooling/ui/*.js`
(DOM-aware). Calc-функции импортируются в любой модуль как pure-библиотека.

**Подзадачи:**

- [x] **22.1** Stand-alone модуль `cooling/` с calc/ + ui/ — закрыто v0.59.991
  - `cooling/calc/{chiller-defaults,chiller-bin-calc,fc-summary,capex-tco,comparison,psychro-formulas}.js`
  - `cooling/ui/{chiller-form,energy-chart,fc-summary-view,annual-table-view,capex-form,comparison-view}.js`
  - `cooling/cooling.js + index.html + cooling.css` — orchestrator
  - `cooling/meteo-bridge.js` — слабая связь с meteo через project-storage
  - 4 вкладки: Spec / Annual energy / CAPEX-TCO / Сравнение
  - Несколько именованных опций (baseline + варианты для сравнения)
  - Discounted payback, NPV, эскалация цен, кривая TCO по годам
  - Side-by-side таблица сравнения с подсветкой победителя
- [x] **22.2** Multi-currency + справочник курсов — закрыто v0.59.991
  - 10 валют (₽/$/€/₸/¥/£/Br/₺/₴/CHF) для CAPEX/OPEX/TCO
  - `shared/currency-rates/` plugin-арх источников: НБ РК (default), ЦБ РФ,
    ECB через Frankfurter, exchangerate.host
  - LS-кеш курсов по дате+источник; UI-диалог 💱 из cooling
- [x] **22.3** Документация методики — закрыто v0.59.991
  - Source list: ASHRAE HoF 2021 гл. 18, ASHRAE 90.1 IPLV bin-method,
    ASHRAE Applications гл. 38 «Owning and Operating Costs»,
    ISO 15686-5 Life-Cycle Costing, EN 15459-1, Vertiv/Liebert pumped
    refrigerant whitepapers, Stull (2011) Wet-Bulb, ASHRAE TC 9.9
  - Раскрывающаяся секция «📐 Методика расчёта (формулы)» в форме spec
  - Help-панель модуля с полным описанием
- [x] **22.4** Интеграция с Технологом ЦОД (Фаза 20.12 — PUE) — закрыто v0.60.3
  - Новый режим `pue.mode='cooling-module'` в Tech-Workspace.
  - calcPueFromCoolingModule() читает `cooling.selections.v1` проекта,
    берёт активный ★-вариант, через dynamic import calc/topology.js +
    chiller-bin-calc.js считает реальную годовую энергию (с учётом
    CRAC + free-cooling + redundancy + hot/cold standby).
  - PUE = 1 + (annualKwh/8760 + losses) / IT_kw.
  - UI: новая опция в селекторе режима PUE + ссылка «↗ Открыть Cooling».
  - Fallback на auto-режим если подбор недоступен.
- [x] **22.5** Импорт реальных performance-curves производителей — закрыто v0.60.4
  - <code>parsePerformanceCurveCsv()</code> — парсер CSV (заголовки T,capacity,cop
    или T,capacity,power; разделители , ; tab; авто-сортировка по T).
  - <code>lerpPerformanceCurve()</code> — линейная интерполяция между точками,
    edge-clamping за пределами таблицы.
  - applyChillerCalc прозрачно использует curve если она задана, иначе
    падает на аналитические формулы.
  - UI: секция «5️⃣ Performance-curve» в chiller-form с кнопками
    «📥 Импорт CSV» / «🗑 Очистить кривую».
  - Sanity на синтетике 4 точек (-5/10/25/35°C, 160-100кВт): T=17°C
    интерполируется в capacity=130.67кВт, COP=4.17, power=31.31кВт ✓.
- [x] **22.6** Доп. источники курсов — закрыто v0.60.5 (NBU UA + NBRB BY)
  - <code>shared/currency-rates/sources/nbu-ua.js</code> — НБ Украины
    (https://bank.gov.ua, JSON API, base UAH)
  - <code>shared/currency-rates/sources/nbrb-by.js</code> — НБ Беларуси
    (https://api.nbrb.by, JSON API, base BYN)
  - Оба с CORS-proxy fallback (corsproxy.io / allorigins.win) на случай
    блокировки прямого запроса.
  - Зарегистрированы в <code>sources/index.js</code> через side-effect
    import. Plugin-арх работает без правок ядра.
  - Pending: currencyapi.com / OpenExchangeRates требуют API key — TODO.
- [x] **22.7** Карточка оборудования в каталоге (catalog/) — закрыто v0.60.6
  - Кнопка «📚 Сохранить в каталог» в chiller-form: создаёт element
    kind='climate' через <code>shared/element-library.js::saveElement()</code>
    с прикреплённой <code>specs.coolingSpec = { ...spec }</code> +
    metadata (manufacturer, ratedCapKw, ratedCOP, systemType, notes).
  - Кнопка «📥 Из каталога» в chiller-form: <code>listElements({kind:'climate'})</code>,
    фильтрует те где есть specs.coolingSpec, prompt-выбор → onChange(spec).
  - Изделие после сохранения видно в catalog/ → category 'climate' и
    может быть использовано в других подборах / других проектах через
    catalog → load.

- [x] **22.8** Подборы (selections) с вариантами + main-флаг — закрыто v0.59.995
  - Заменена плоская модель `_options[]` на `_selections[].options[]`.
  - В одном проекте может быть несколько подборов (разные системы — например
    «Чиллер для серверной A», «DX для офиса B»).
  - В каждом подборе — варианты оборудования; один помечается ★ как основной
    (baseline для расчёта payback в comparison).
  - Не-основные варианты можно удалять; основной защищён от удаления.
  - LS-миграция: legacy `cooling.options.v1` → один подбор «Подбор по умолчанию».

- [x] **22.9** Storage modes: standalone vs project + embed-режим — закрыто v0.59.995
  - `?standalone=1` — данные в `raschet.cooling.standalone.*`, без привязки к проекту.
  - default — `raschet.project.<pid>.cooling.*` (project-scoped).
  - `?return=PATH&returnSession=ID&returnLabel=...` — embed: показываются
    кнопки «✓ Применить и вернуться» / «✗ Отмена», payload передаётся через
    LS-bridge `raschet.nav.return.<sessionId>.payload`.
  - Принцип «вернуться ровно туда, откуда пришли» в `shared/module-nav.js` —
    переиспользуется любым модулем (meteo, psychrometrics, и т.д.).
  - Cross-links на смежные модули показываются ТОЛЬКО в project-mode (не в
    standalone и не в embed).

- [ ] **22.10.1** Вариант = комплекс оборудования 🆕
  > Зафиксировано Пользователем 2026-05-02: «подборы обычно содержат
  > комплекс — чиллеры плюс CRAC, или DX система + конденсатор (который
  > может быть с фрикулингом). Их тоже нужно сравнивать».
  - Вариант (option) перестаёт быть одиночной spec; становится КОМПЛЕКСОМ
    оборудования с топологией.
  - Новая модель:
    ```
    option = {
      id, name,                  // имя варианта-комплекса
      eco: { ... },              // CAPEX/OPEX комплекса целиком
      equipment: [
        { role: 'chiller', spec: {...}, qty: 2 },
        { role: 'crac',    spec: {...}, qty: 4 },
      ],
      topology: { loopMode, redundancyN, redundancyM }
    }
    ```
  - Backward compat: текущая `option.spec` оборачивается в
    `equipment: [{ role: derive(systemType), spec: оригинал, qty: 1 }]`.
  - UI: вкладка ❄ Spec показывает не один chiller-form, а список
    оборудования с +/- и per-equipment spec-формы.
  - Расчёт: simulateTopology применяется внутри option (variant) → один
    набор aggregate-метрик (energy/CAPEX/TCO) для сравнения.

- [x] **22.11** Cross-selection comparison — закрыто v0.60.8
  - Toggle «Режим: Варианты подбора / Подборы проекта» в Compare-tab.
  - Variants mode (default): все варианты текущего подбора (как раньше).
  - Selections mode: ★-главные варианты ВСЕХ подборов проекта; имена в
    таблице — имена подборов (не вариантов), чтобы было видно
    «Чиллер vs DX vs Mixed» вместо «Опция 1 vs Опция 1».

- [ ] **22.13** Project location: единое место хранения координат проекта 🆕
  > Зафиксировано Пользователем 2026-05-02: «в свойствах проекта (основные
  > данные) нужно сразу выбирать место расположения, чтобы сразу передавать
  > данные во все расчётные модули. Если в свойствах проекта уже определено
  > место расположения, то ни в одном модуле нельзя это местоположение
  > изменить. Любое изменение допускается либо для локальной проверки, либо
  > для копирования в другой проект».
  - Project model: `location: { city, country, lat, lon }` (новое поле в
    проекте, заполняется один раз).
  - Properties-форма проекта: добавить выбор города (с auto-fill lat/lon) /
    координаты вручную / picker на карте (Leaflet, как в meteo station-picker).
  - Propagate во все calc-модули: meteo (загрузка климата по этим
    координатам), cooling (через meteo bridge), psychrometrics (design conds).
  - Lock-mode: если project.location задан → во всех модулях поля координат
    ReadOnly со значком 🔒 «задано в проекте». Открыть для редактирования
    можно только в:
    - Standalone-режиме (нет привязки к проекту)
    - «Локальная проверка» — кнопка «✏ Изменить локально (без сохранения)»
      раскрывает поля до закрытия страницы, не записывает в проект
    - «Скопировать в другой проект» — picker проектов + сохранение туда
  - Аудит-трейл: при изменении project.location — predict cascade
    (какие модули перерасчёт), warn пользователя.

- [ ] **22.14** Copy & customize ready-made подборов (deep-think) 🆕
  > Зафиксировано Пользователем 2026-05-02: «про копирование и донастройку
  > готовых подборов подумай тщательно».
  - Use-cases:
    - А. Скопировать подбор из проекта-A в проект-B (уже сделано в v0.59.997
      на стороне standalone, но нужно расширить).
    - Б. Скопировать конкретный вариант (option) внутри подбора как стартовый
      шаблон для нового варианта.
    - В. Скопировать подбор как «маркетплейс»-шаблон (Daikin EWAQ + Stulz CRAC ×4)
      — «применить к моему проекту». Темплейты библиотечные.
    - Г. После копии — дозированная customization: что НАСЛЕДУЕТСЯ от шаблона,
      что переопределяется (override), что свободно меняется. Нужен паттерн
      «inherit + override» с visual indication какие поля изменены.
  - Дизайн вопросы:
    - Как помечать «изменённые от шаблона» поля? (значок +)
    - Версионирование шаблонов: если шаблон обновился, что с инстансами?
    - Migration валюты при копировании между проектами с разными currencies.
    - Migration eco при копировании (новые поля могут отсутствовать).
    - LS-пространство при копировании в другой проект (copy id-mapping для
      mainOptionId / activeOptionId / etc).
  - Этап 1: расширить v0.59.997 «Сохранить в проект» — добавить:
    - Выбор: «новый подбор» / «добавить в существующий подбор»
    - При копировании в другой проект — конвертация валют по курсу на
      _ratesDate, если currencies отличаются.
  - Этап 2: библиотека шаблонов (catalog/cooling-templates).
  - Этап 3: inherit + override модель.

- [x] **22.12** Универсальный wheel-handler с Ctrl+scroll и cursor-anchored зум — закрыто v0.60.9
  - shared/wheel-zoom.js (helper для будущих модулей).
  - Psychrometrics chart + canvas — Ctrl+wheel + cursor-anchor.
  - js/engine/interaction.js (schematic/scs-design SVG canvas) — Ctrl+wheel + anchor.
  - schematic/schematic.js — уже было ✓.
  - scs-design/scs-design.js — уже было ✓.
  - scs-config/scs-config.js — уже было ✓.
  - suppression-config/suppression-config.js — добавлен Ctrl-check.
  - Pending: rack-config 3D / cooling/meteo Chart.js (chartjs-plugin-zoom)
    — могут быть добавлены по requestу.

- [x] **22.10** Топология холодоснабжения (chillers ↔ CRACs) 🆕 — закрыто v0.60.1
  > Добавлено 2026-05-02 по требованию: «система с несколькими жидкостными
  > кондиционерами … могут ссылаться (подключаться к общему чиллеру в схеме).
  > Чиллеры могут включаться с резервированием — как в общий трубопровод,
  > так и точка-точка. Один чиллер — один кондиционер. Водяные CRAC могут
  > быть с компрессором на борту и жидкостным контуром, могут быть с
  > отдельным контуром фрикулинга (пример Stulz)».
  - **Тип CRAC** (новое поле в spec):
    - `dx-air` — текущий DX air-cooled
    - `crac-water` — водяной CRAC, охлаждение от чиллера
    - `crac-water+compressor` — водяной CRAC с компрессором на борту
      (DX-glycol гибрид: компрессор работает летом, glycol-loop зимой)
    - `crac-water+fc-loop` — водяной CRAC с отдельным контуром фрикулинга
      (Stulz CyberHandler dual-circuit, возможно 100% FC при низкой Tamb
      без участия компрессора)
  - **Топология подбора**:
    - Чиллеры: массив { id, name, ratedCapKw, redundancy, ... }
    - CRACs: массив { id, name, type, ratedCapKw, chillerLinks: [...] }
    - chillerLinks:
      - `common-loop` — несколько CRACs подключены к одному кольцу/header
        нескольких резервированных чиллеров (N+1, 2N схемы).
      - `point-to-point` — каждый CRAC жёстко привязан к одному чиллеру
        (один-в-один резервирование).
  - **Расчёт нагрузки**: суммирование ratedCap CRACs → распределение между
    чиллерами с учётом redundancy. При отказе одного чиллера — оставшиеся
    держат полную нагрузку (N+1) или половину (2N).
  - **Бин-симуляция**: в каждый T_amb час смотрим какие CRACs работают
    мех/FC-режимом, какой чиллер задействован, считаем суммарное потребление.
  - **UI**: новая вкладка «🔗 Топология» в cooling: визуальный builder
    (chillers слева, CRACs справа, линии связи; drag-drop для соединения;
    color-coding redundancy schemes). Pivot-таблица «CRAC × T_amb интервал →
    режим работы (мех/FC/idle)».
  - **Calc**: `cooling/calc/topology.js` — pure-функция распределения
    нагрузки, `simulateTopology(chillers, cracs, hourly, tariff)` →
    aggregate energy + per-equipment breakdown.

**Acceptance:**
- Calc-функции импортируются и работают без DOM (можно прогнать в Node).
- TCO/payback совпадает с ручным расчётом по ISO 15686-5 на типовом примере.
- Multi-currency: смена валюты пересчитывает все KPI без потери ввода.
- Курсы кешируются по дате; повторный запрос не идёт в сеть.
- Cooling работает без активного meteo-датасета (показывает empty-state со
  ссылкой на /meteo).

---

## Фаза 21 — Метеоданные 🆕

> Добавлено 2026-04-30. Stand-alone модуль для импорта климатических рядов.
> Используется в Технологе ЦОД (Фаза 20.12 — PUE по FreeCool-часам), в
> ID-диаграмме (психрометрия для расчётных условий), в климат-модулях
> (подбор по ASHRAE TC 9.9 на основе T<sub>max</sub>/T<sub>min</sub>/T<sub>99%</sub>).

**Архитектурное требование** (Юзер 2026-04-30): «модули загрузки с разных
сайтов отличающихся по методу делай отдельными модулями, чтобы можно было
создавать и добавлять новые методы без переделки системы». Реализовано
через registry-pattern: `meteo/sources/registry.js` + side-effect import
плагинов в `sources/index.js`. Чтобы добавить новый источник — создаётся
файл `meteo/sources/<name>.js` с `register({ id, label, async createDataset })`
и добавляется одна строка `import './<name>.js'` в `sources/index.js`.
Никаких правок UI-ядра.

**Подзадачи:**

- [x] **21.1** Stand-alone модуль `meteo/` + plugin-arch источников — закрыто v0.59.894
  - `meteo/index.html` + `meteo.js` + `meteo.css` + `meteo-api.js` + `util.js`
  - `meteo/sources/registry.js` — реестр (`register`, `getAll`, `get`)
  - `meteo/sources/index.js` — точка-импорт всех плагинов
  - `meteo/sources/open-meteo.js` — Open-Meteo Historical Weather REST
    (бесплатный API archive с 1940 г. по координатам lat/lon и периоду)
  - `meteo/sources/rp5.js` — ручная загрузка CSV-архива rp5.kz/rp5.ru
    (semicolon-CSV с автодетектом колонок Местное время / T / U / Ff)
  - UI: левый sidebar — список датасетов + динамические кнопки импорта
    (генерируются из реестра); правая панель — KPI (T средн / min / max /
    99% / FreeCool / N) + гистограмма распределения T (canvas) с зелёной
    подложкой для T<14°C + сводка HDD/CDD/T1%.
  - Активный датасет помечается ⭐ и используется другими модулями
    через `meteo/meteo-api.js::getActiveDataset(pid)`.
  - Storage: `raschet.project.<pid>.meteo.datasets.v1` + `activeId.v1`.

- [ ] **21.2** Дополнительные источники — расширение plugin-каталога (по запросу)
  - NOAA Climate Data Online (https://www.ncei.noaa.gov/cdo-web/) — для США
  - Росгидромет API (если будет публичный доступ) — для РФ
  - Meteostat (https://meteostat.net/) — глобальный источник со станциями
  - Ручной ввод (`manual`) — таблица почасовых значений без файла
  - Excel/XLSX-импорт (универсальный, с маппингом колонок) — отдельный плагин
  - Каждый плагин — отдельный файл в `meteo/sources/` с минимальным
    интерфейсом (`id`, `label`, `description`, `async createDataset(ctx)`).
    Никаких правок ядра при добавлении.

- [x] **21.3** Auto-fetch для Технолога ЦОД — закрыто
  (tech-workspace: кнопка «🌐 Загрузить метео для проекта (1 клик)» в
  PUE-блоке + отдельная кнопка «Загрузить метео для этой локации» в
  блоке project-data).
  - Кнопка «🌐 Загрузить метео для этого проекта» прямо в блоке PUE
    (если активного датасета нет). Использует координаты из проекта
    (если заданы) или Алматы по умолчанию, период = последний год.
  - Шорткат через Open-Meteo (без открытия отдельного UI-модуля).

**Acceptance:**
- Plugin-арх: можно добавить новый источник за 10 минут (создать файл +
  добавить import). UI-ядро не изменяется.
- Open-Meteo загрузка: ≤2с для года почасовых данных.
- rp5 CSV: парсер автоматически распознаёт колонки времени/T/U/Ff,
  не требует от пользователя ручного маппинга.
- Активный датасет видим в Технологе ЦОД (PUE-блок), доступен через
  `getActiveDataset(pid)` в любом модуле.

---

## Фаза 23 — Универсальный паттерн «статьи затрат» для всех money-полей

> Зафиксировано Пользователем 2026-05-02: «стоимость оборудования и прочие
> параметры с возможностью наполнения, например чиллер 5000, блок насосов 2000
> итого 7000. Лучше сделать в таблице. … тоже и для opex и для TCO. При
> нажатии на поле выводится таблица, куда хоть одну строку впиши, хоть все
> подробно распиши. … Это нужно применять во всем проекте, но не в ущерб
> дизайну и комфортности работы, чем комфортней тем меньше ошибок от
> оператора.»

- [x] **23.1** MVP в `cooling/` — line-items для CAPEX (equipment / installation /
  maintenance) v0.60.18. Каждое денежное поле — компактная клик-кнопка
  (label + total + бэйдж со счётчиком статей). Клик открывает popup-таблицу
  статей затрат с колонками «Статья / Сумма / Валюта / ×». Кнопка «+ Добавить
  статью», итого в валюте поля + эквивалент в валюте проекта. Бэк-комат:
  legacy single-value поля автоматически становятся одной статьёй «Прочее».
  - Файлы: `cooling/calc/capex-tco.js` (`normMoney` с items[], `convertEcoToCurrency`
    с per-item конвертацией, `moneyTotalIn`), `cooling/ui/capex-form.js`
    (`renderCapexForm` + `openMoneyItemsModal`), `cooling/cooling.css`
    (`.cl-money-cell`, `.cl-mi-table`).

- [ ] **23.2** Экстракция в shared/. Перенести `openMoneyItemsModal` и
  `normMoney`/`moneyTotalIn` в `shared/money-items.js` + `shared/money-items.css`,
  чтобы их могли использовать ВСЕ модули проекта (logistics, scs-config,
  tech-workspace, breaker-catalog, battery-catalog, ups-picker, новый
  service-модуль). API:
  ```js
  import { openMoneyItemsModal, normMoney, moneyTotalIn } from 'shared/money-items.js';
  ```
- [ ] **23.3** Rollout в Logistics — стоимость доставки/растаможки как статьи.
- [ ] **23.4** Rollout в SCS-config / breaker-catalog / battery-catalog — поля
  цены позиции с возможностью разбивки (доставка + НДС + скидка).
- [ ] **23.5** Rollout в Tech-workspace BOM — каждая строка с возможной
  разбивкой стоимости.
- [ ] **23.6** Тариф электроэнергии (cooling) — клик-таблица «дневной/ночной
  тариф / штрафы за ПИК», итого = средневзвешенный (сейчас введён только
  валютой v0.60.18).

**Acceptance:**
- Каждое money-поле в проекте поддерживает «hover → click → таблица статей».
- Дизайн остаётся компактным (button-cell ≤ 280px), таблица в модале.
- Конвертация per-item через `convertFn(amount, fromCur, toCur)` на курс
  выбранной даты.
- Backward-compat: число и `{value, currency}` без items[] — работают как раньше.

---

## Фаза 24 — Модуль «Сервис: монтаж и ТО» (🟢 в проде с v0.60.30)

> Зафиксировано Пользователем 2026-05-02: «отдельный модуль Расчет стоимости
> технического обслуживания и стоимости монтажных работ, где инженер сервиса
> сможет формировать стоимость себеса и стоимости для клиента по монтажным и
> сервисным работам по проекту или разовые работы».

- [x] **24.1** Скаффолд `service/` модуля (v0.60.30): sidebar/orderForm/calc/ui.
- [x] **24.2** Каталог типовых работ — `service/catalog/work-templates.js` с
      seed-шаблонами (монтаж/ТО/одноразовые) + расширение с workType/equipmentKind/capacityKw для auto-suggest материалов (v0.60.50).
- [x] **24.3** Связь с проектом: импорт из cooling через
      <code>buildInstallPositionsFromCoolingOption / buildMaintenancePositionsFromCoolingOption</code> +
      дедуп по sourceModule+sourceRef (v0.60.45).
- [x] **24.4** Экспорт КП — slot-based template в `service/report/` (v0.60.40).

---

## Фаза 25 — Импорт даташитов климатического оборудования (🟢 в проде с v0.60.20)

> Зафиксировано Пользователем 2026-05-02: «для климатического оборудования
> добавь возможность загружать даташиты конкретного оборудования (описание
> формата добавь в справку модуля и поля импорта) или вводить все необходимые
> данные (с подсказками)».

- [x] **25.1** JSON-формат даташита, реализован в <code>cooling/calc/datasheet.js</code>.
- [x] **25.2** UI «📥 Импорт даташита (JSON)» в <code>chiller-form.js</code> с drag&drop, paste, preview.
- [x] **25.3** Каталог seed-даташитов (Daikin / York / Carrier / Trane / Stulz) в <code>cooling/datasheets/</code>.
- [x] **25.4** CSV-импорт performanceCurve (заголовок T,capacity,cop) — кнопка «📥 Импорт CSV» в форме.
- [x] **25.5** Help-секция «Формат даташита» в модуле + кнопка «Скачать пример».

**Спецификация JSON-формата (для справки):**
- [x] **25.1-spec** JSON-формат даташита (документировать в справке cooling-модуля):
  ```json
  {
    "schema": "raschet-chiller-datasheet/v1",
    "vendor": "Daikin",
    "model": "EWAQ016BAW",
    "kind": "chiller" | "crac" | "drycooler",
    "systemType": "chiller-air-cooled-screw" | ...,
    "ratedCapKw": 16,
    "ratedCop": 3.2,
    "iplv": 4.5,
    "freeCoolingCapable": true,
    "freeCoolingMode": "dry" | "wet" | "dx-pumped",
    "freeCoolingThresholdC": 7,
    "performanceCurve": [
      { "tAmbC": -10, "capacityKw": 18, "powerKw": 4.2, "cop": 4.3 },
      { "tAmbC":   0, "capacityKw": 17, "powerKw": 4.6, "cop": 3.7 },
      ...
    ],
    "physical": { "lengthMm": 2400, "widthMm": 1100, "heightMm": 2150, "weightKg": 850 },
    "refrigerant": "R410A",
    "compressorType": "screw"
  }
  ```
- [ ] **25.2** UI — кнопка «📥 Импорт даташита» в `chiller-form.js`:
  - Drag&drop / выбор файла (`.json` / `.txt`).
  - Paste-area для ручной вставки JSON.
  - Live-preview распарсенных полей перед применением.
  - Валидация по схеме + понятные сообщения об ошибках.
- [ ] **25.3** Бесплатные шаблоны от популярных вендоров (Daikin / Stulz /
  York / Carrier / Trane) — несколько готовых JSON в `cooling/datasheets/` для
  быстрого старта.
- [ ] **25.4** Опционально: импорт из CSV (только performanceCurve) и из
  PDF (текст-extract — best-effort, требует ручной коррекции).
- [ ] **25.5** Справка в модуле — статья «Формат даташита» с полным описанием
  схемы + примеры + кнопка «Скачать пример JSON».

---

## Фаза 26 — Модуль интеграции с SharePoint

> Зафиксировано Пользователем 2026-05-02: «Сделай еще модуль интеграции с
> сайтом SharePoint пользователя, для сохранения данных и отчетов по разным
> проектам или прочим расчетам.»

- [ ] **26.1** Скаффолд `sharepoint/` модуля:
  - Sidebar — список настроенных SharePoint-сайтов / библиотек.
  - Content — браузер документов выбранной библиотеки + кнопки
    «📤 Загрузить отчёт текущего проекта» / «📥 Загрузить из SharePoint».
- [ ] **26.2** Формат хранения — папка `Raschet/{projectCode}/` с
  файлами: `project.json` (state) + `report.pdf` (генерируется при
  push через jsPDF) + вложения (BOM xlsx, ECSD svg).
- [ ] **26.3** API-обёртка в `sharepoint/calc/sp-rest.js` — REST/Graph-вызовы
  (минимально: list-sites, list-folders, upload-file, download-file).
- [ ] **26.4** Standalone-режим: сайт + библиотека вводятся вручную через
  личный токен (без OAuth, до Фазы 27).

---

## Фаза 28 — Единый shell конфигураторов

> Зафиксировано Пользователем 2026-05-02: «может сделать для всех конфигураторов
> один вид?». Цель: единая разметка-shell + CSS variables для всех модулей-
> конфигураторов (cooling, service, scs-design, scs-config, mdc-config,
> rack-config, panel-config и т.д.). Снижение когнитивной нагрузки оператора.

- [x] **28.1** `shared/configurator-shell.css` — базовый CSS с `.rs-cfg-shell` /
  `.rs-cfg-sidebar` / `.rs-cfg-content` / `.rs-cfg-tabs` / `.rs-cfg-card`
  и CSS variables (sidebar-width, accent, border, и т.п.). Подключён в
  cooling и service. v0.60.28.
- [ ] **28.2** Миграция cooling — заменить `cl-*` классы на `rs-cfg-*` где
  возможно (постепенно). Per-module стили остаются для специфики (chart,
  performance curve и т.п.).
- [ ] **28.3** Миграция service — заменить `sv-*`.
- [ ] **28.4** Миграция scs-design + scs-config + mdc-config + rack-config.
- [ ] **28.5** Миграция остальных конфигураторов.
- [ ] **28.6** Темизация (light/dark) через CSS variables.

**Acceptance:**
- Один и тот же визуальный стиль across all configurators (sidebar +
  content + tabs).
- Минимальные различия только в иконках/цветах брендов модулей.
- Любой новый конфигуратор подключает `configurator-shell.css` и сразу
  получает консистентный вид.

---

## Фаза 29 — Слот-ориентированные шаблоны документов

> Зафиксировано Пользователем 2026-05-02: «содержимое попадает поверх шаблона.
> Сделать шаблон, который содержит блоки конкретного документа, можно
> основные блоки размещать в любом порядке».

Существующий `shared/report/` editor работает с overlay-зонами (header/footer
с meta-substitutions) — но накладывает их ПОВЕРХ контента, вызывая overlap.
Для документов вроде КП нужны **именованные content-slots**, которые
пользователь может toggle/reorder/styling.

- [x] **29.1** Workaround (v0.60.40): убраны default-overlays из export-offer,
  PDF рендерится напрямую через `exportPDF` с чистым шаблоном (только page
  number в footer). Overlap устранён.

- [ ] **29.2** Slot-based template schema:
  ```js
  template = {
    id, name, kind,             // 'commercial-offer' | 'tech-report' | ...
    pageSettings: { format, margins, font },
    slots: [
      { id: 'company-header', enabled, order, options, styles },
      { id: 'doc-title',      enabled, order, options, styles },
      { id: 'positions-table',enabled, order, options:{ groupByCategory, showCostColumn }, styles },
      { id: 'totals',         enabled, order, ... },
      { id: 'signatures',     enabled, order, ... },
      ...
    ]
  }
  ```

- [ ] **29.3** Каталог slot-builders в `shared/report/slots/`:
  - `kp-blocks.js` — builder-функции для слотов КП (companyHeader, docTitle,
    customerInfo, positionsTable, totals, paymentRequisites, signatures)
  - Каждый builder: `(data, options, styles) → blocks[]` для shared/report.

- [ ] **29.4** Editor шаблона документа:
  - Список слотов с drag-to-reorder
  - Per-slot чекбокс enabled
  - Per-slot настройки (например для positions-table: «группировать по
    категориям», «показать колонку себес»)
  - Сохранение в LS под `raschet.report-templates.<kind>.v1`
  - Импорт/экспорт шаблонов (для шаринга между установками)

- [ ] **29.5** Renderer:
  - `renderDocument(template, data)` — итерирует enabled slots, вызывает
    builder каждого слота, собирает blocks[] → exportPDF.

- [ ] **29.6** UI в Service: «📄 Настроить шаблон КП» в сайдбаре + dropdown
  «Шаблон для экспорта» в кнопке экспорта.

- [ ] **29.7** Migration: дефолтный КП-шаблон создаётся при первом запуске
  на основе текущего `buildOfferBlocks()` (10 слотов в обычном порядке).

**Acceptance:**
- Пользователь может перетащить «Платёжные реквизиты» наверх документа.
- Можно отключить «Подписи» если не нужны.
- Можно создать несколько шаблонов под разных заказчиков (с/без логотипа,
  с/без столбца себестоимости).
- Никаких overlay-наложений на контент.

---

## Фаза 30 — Сквозная интеграция Технолога ЦОД

> Зафиксировано Пользователем 2026-05-03: «надеюсь ты уже проработал план
> интеграции модуля Технолог ЦОД с модулями климата, подбора холода,
> подбора ИБП, ДГУ, расчёт PUE».

**Цель:** Технолог ЦОД (`tech-workspace/`) — концепция-композер ЦОД, должен
собирать данные из специализированных calc-модулей в единую концепцию с
автоматическим расчётом PUE, CAPEX, OPEX. Cross-module flow в обе стороны.

### Текущее состояние

- ✅ **Meteo → Tech-workspace** (Phase 21.3 / 22.13): локация проекта
  пропагируется через `project.location`; auto-fetch через
  `shared/meteo-fetch.js`. PUE auto-mode читает meteo через
  `getActiveMeteoDataset(pid)`.
- ✅ **Cooling → Tech-workspace (READ)**: `calcPueFromCoolingModule()` читает
  cooling.selections.v1 проекта, вызывает `simulateOptionTopology()` для
  расчёта годовой энергии холодильной системы → PUE = (IT + Cool) / IT.
- ⚠ **UPS / DGU**: только placeholder поля в `concept.upsSystems[]` и
  `concept.feed.dgu`. Cross-flow в `ups-config/` отсутствует.

### План работ

- [~] **30.1** Cooling ↔ Tech-workspace (двусторонний bridge):
  - [x] **PUSH** (tech → cooling, v0.60.66): кнопка «📤 Подобрать холод для этой концепции →» в tab «⚙ Топология охлаждения». Расчёт <code>requiredCoolingKw = itKw × (PUE_target − 1)</code>, запись в LS-bridge <code>raschet.cooling.prefill.v1</code>, открытие /cooling/ в embed-режиме, cooling.init читает prefill и создаёт подбор автоматически.
  - [x] **PULL** (cooling → tech, v0.60.3): через PUE mode=cooling-module — concept автоматически использует данные из подбора при пересчёте.
  - [ ] **Visual:** в концепции под cooling-блоком показать «Связанный подбор: [имя] — Σ установлено N кВт, годовой COP X.X, PUE-cooling Y.YY».

- [~] **30.2** UPS-config ↔ Tech-workspace (v0.60.69 — частично):
  - [x] **PUSH:** кнопка «⚙ Подобрать в ups-config →» в UPS-карточке концепции — открывает ups-config с URL ?capacityKw/autonomyMin/cosPhi/redundancy/phases. Wizard auto-launches.
  - [x] **PUE учитывает UPS efficiency** (Phase 30.4 v0.60.63): PUE = 1 + (P_cool + P_ups-loss + P_tp-loss + P_aux) / P_IT.
  - [ ] **Не сделано:** PULL — ups-config возвращается с modelRef → автообновление concept.upsSystems[i].modelRef. Сейчас юзер вручную нажимает «📦 Привязать модель».
  - [ ] **Не сделано:** shared/ups-bridge.js generic API — TW использует URL params напрямую.

- [x] **30.3** Новый модуль `dgu-config/` (v0.60.70 + v0.60.73):
  - [x] calc/dgu-calc.js — ISO 8528-1 (modes ESP/PRP/COP), ISO 3046-1 (climate derate altitude/T/RH), fuel SFC интерполяция, объём бака.
  - [x] datasheets/index.js — 14 моделей: Caterpillar (C18 220/400, C32 800, 3516 1500), Cummins (C220/400/825/1675), Volvo Penta (TAD941/1342, TWD1683), FG Wilson (P200/400/800).
  - [x] index.html + dgu-config.js — UI sidebar (нагрузка, режим, резервирование, climate, автономия) + content (расчёт мощности с derate breakdown / подбор / топливо+бак).
  - [x] PUSH из tech-workspace через URL params (?capacityKw/mode/redundancy/autonomy).
  - [x] Карточка в /modules/index.html + строка в техническом реестре.
  - [x] Регистрация в catalog через catalog-bridge (kind='dgu', 14 моделей видны в catalog).
  - [x] Cross-module panel в tech-workspace показывает «⚡ ДГУ».
  - [ ] **Не сделано:** shared/dgu-bridge.js generic API (как service-bridge) — пока используется URL-params + LS-bridge.
  - [x] **PULL (v0.60.81-82):** dgu-config автосохраняет best-match в LS-bridge <code>raschet.project.&lt;pid&gt;.dgu-config.selected.v1</code>. TW показывает кнопку «↩ Применить из dgu-config» если есть свежий выбор. Click записывает modelRef в concept.feed.dgu.

- [x] **30.4** Comprehensive PUE расчёт (v0.60.63 — частично):
  - PUE = 1 + (P<sub>cool</sub> + P<sub>ups-loss</sub> + P<sub>tp-loss</sub> + P<sub>aux</sub>) / P<sub>IT</sub>.
  - <code>calcPueAutoBreakdown</code> возвращает per-component массу/долю.
  - UI tab PUE: 8 строк breakdown с tooltip\'ами + override η_ups / η_tp / aux %.
  - **Не сделано:** 12-месячный график PUE (seasonal) — отложено до подходящей задачи.

- [x] **30.5** Service ↔ Tech-workspace (v0.60.67-68):
  - [x] В концепции суммарный «Сервис в год» = Σ service.orders[type=maintenance] — раздел 6b отчёта (v0.60.67).
  - [x] Кнопка «📋 Создать ТО-наряд из этого подбора →» в coolsys-tab (v0.60.68): читает основной вариант подбора → buildMaintenancePositionsFromCoolingOption → createServiceOrderForProject → редирект в /service/. Один клик.

- [x] **30.6** Cross-module reference panel в tech-workspace (v0.60.62):
  - Sidebar секция «🔗 Связанные модули проекта» — 8 модулей со счётчиками.
  - Async load: meteo через IDB, остальные через LS.
  - Сортировка: с данными вверху, пустые внизу.
  - Один клик → переход через <code>buildModuleHref</code> с pid в URL.

- [~] **30.7** Сводный концептуальный отчёт (v0.60.67 — частично):
  - [x] Раздел 4a — Подбор холодильных систем (cross-module из cooling.selections.v1: основной вариант, тип, COP, Σ установлено, CAPEX/OPEX/lifetime).
  - [x] Раздел 6a — PUE per-component breakdown (P_cool / P_ups-loss / P_tp-loss / P_aux) с формулами и КПД.
  - [x] Раздел 6b — Сервис (cross-module из service.orders.v1: install/maintenance count + Σ суммы).
  - [ ] **Не сделано:** через service/report/ шаблоны (slot-based, Phase 29.4-29.5) — пока inline HTML с CSS.
  - [ ] **Не сделано:** 5/10/20-летний TCO с графиком — отложено до Phase 30.4 (12-month chart).

**Acceptance:**
- В концепции tech-workspace одной кнопкой попадаешь в cooling/ups-config с
  pre-filled данными.
- При сохранении в этих модулях возврат в tech-workspace автоматически
  обновляет concept.
- PUE учитывает все компоненты (IT + cooling + UPS + TP + aux).
- Сводный отчёт собирается из реальных данных всех связанных модулей.
- ДГУ — отдельный модуль с каталогом и bridge.

---

## Фаза 32 — Service: учётные номера нарядов + каталог материалов

> Зафиксировано Пользователем 2026-05-03: «У нарядов должны быть номера,
> в учётной системе и отдельно названия (или краткое описание). Так же
> не хватает каталога расходных материалов с привязкой к видам работ или
> конкретному оборудованию».

- [ ] **32.1** Order numbering:
  - `order.number` — учётный номер (например «КП-2026-0042» / «ТО-Q1-2026-007»).
  - Auto-генерация по pattern с per-project counter (project.serviceCounters).
  - Pattern editable в Свойствах проекта или в шаблоне service-кейса.
  - `order.name` — короткое описание (как сейчас).
  - В UI: «№ КП-2026-0042 — Монтаж: Машинный зал».

- [ ] **32.2** Каталог расходных материалов `service/catalog/materials.js`:
  - Schema:
    ```js
    material = {
      id, name, sku, category, unit,
      defaultPrice: { value, currency },
      vendor, datasheet,  // опц.
      compatibleWith: ['chiller', 'crac', 'ups', 'pdu', ...],  // тип оборудования
      workTypes: ['install-refrigerant', 'maint-filters', ...], // привязка к работам
      consumptionRate: { perKw: 0.05, unit: 'кг/кВт' },  // напр. R410A: 50г/кВт
    }
    ```
  - Seed: фильтры HEPA/F7/EU4, хладагенты R410A/R32/R134a, масла, фитинги,
    патч-панели, кабель, разъёмы, etc.
  - User-кастомные через UI (как work-templates).

- [ ] **32.3** Auto-suggest материалов при добавлении работы:
  - При добавлении в наряд работы из шаблона (например «Монтаж чиллера 200 кВт»)
    → spice-up: «Этой работе обычно сопутствуют материалы: R410A 5 кг, ...».
  - Один клик «Добавить рекомендуемые» → позиции материалов добавлены с
    расчётным qty (по consumptionRate × power).

- [ ] **32.4** UI каталога материалов (как work-catalog):
  - «📦 Каталог материалов» в сайдбаре service.
  - Tabs по категориям (хладагенты / фильтры / масла / кабель / ...).
  - Per-row CRUD для user-материалов.

**Acceptance:**
- Каждый наряд имеет учётный номер + название.
- Pattern номера настраивается в проекте.
- Каталог материалов доступен для добавления в позиции наряда.
- При выборе работы предлагаются совместимые материалы.

---

## Фаза 33 — Интеграция с 1С (Управление небольшой фирмой / БП / УТ)

> Зафиксировано Пользователем 2026-05-03: «добавим синхронизацию с программой
> 1С по каталогу номенклатуры и ценам (пока) позже добавим синхронизацию
> КП, АВР, заказ-нарядов (конфигурации Управление небольшой фирмой)».

**Этап 1 (MVP):** одностороннее чтение из 1С — каталог + цены.
**Этап 2:** двусторонняя синхронизация документов (КП, АВР, заказ-наряд).

- [ ] **33.1** Архитектура коннектора:
  - Отдельный модуль `integrations/1c/` (под общим `integrations/` для будущих:
    Битрикс24, AmoCRM, SAP, банки и т.д.).
  - Поддержка трёх транспортов:
    - **HTTP REST** — через `Веб-сервисы 1С` (`/hs/...` endpoints, BasicAuth).
    - **OData** — стандартный 1С OData REST (для УНФ/УТ/БП).
    - **File exchange** — XML/JSON выгрузка-загрузка через папку (для
      изолированных установок без сети).
  - Конфигурация подключения хранится в global-settings (URL, логин, пароль,
    номер каталога, период синка).

- [ ] **33.2** Sync каталога номенклатуры (Этап 1):
  - Маппинг 1С `Справочник.Номенклатура` → `catalog/` платформы.
  - Поля: код, артикул, наименование, единица, ЕСМ, штрихкод, категория.
  - Дельта-sync по `ВерсияДанных` (только изменённые с прошлого sync).
  - Отображение последнего sync time в каталоге.
  - Conflict-resolution: 1С wins по умолчанию; user-override через флаг
    «локально изменено».

- [ ] **33.3** Sync цен (Этап 1):
  - Маппинг 1С `РегистрСведений.ЦеныНоменклатуры` → `catalog/prices/`.
  - Поддержка типов цен (закупочная / оптовая / розничная / валютная).
  - История цен с датами.

- [ ] **33.4** Sync КП (Этап 2):
  - Service создаёт КП → выгрузка в 1С УНФ как «Заказ покупателя» или
    «Коммерческое предложение».
  - Маппинг полей: order.name → ШапкаДокумента; positions → табличная часть
    «Товары»; itog → СуммаДокумента.
  - Связь по UUID: <code>order.externalRef = '1c:КП-2026-0042'</code>.

- [ ] **33.5** Sync АВР (Акт выполненных работ) (Этап 2):
  - На основе закрытого ТО-наряда → создать «Акт об оказании услуг» в 1С.
  - Подпись через ЭП — TODO для отдельной фазы.

- [ ] **33.6** Sync заказ-нарядов (Этап 2):
  - 1С → платформа: запросы на сервис из 1С появляются как наряды в
    service-модуле.
  - Платформа → 1С: статус-обновления (в работе / закрыт / отказ).

**Acceptance Этап 1:**
- В каталоге номенклатуры можно одной кнопкой запустить sync с 1С.
- При sync обновляются цены и атрибуты, новые позиции добавляются.
- В service при добавлении материала — поиск идёт по 1С-каталогу + локальный.

---

## Фаза 34 — Перенос больших датасетов из LocalStorage в IndexedDB

> Зафиксировано Пользователем 2026-05-03 после диагностики через Chrome MCP:
> ASHRAE Темиртау (87696 hourly точек ≈ 6-7 МБ JSON) превышает quota
> LocalStorage (~5-10 МБ на origin) → silent QuotaExceededError → данные
> не сохранялись. Hotfix v0.60.51 даёт явный toast вместо silent fail,
> но не решает корневую проблему квоты.

**Цель:** перенести крупные binary/массивные данные (meteo hourly arrays,
performance curves, BOM-снимки) в IndexedDB (квота 50 МБ — 2 ГБ в зависимости
от браузера). LocalStorage оставить только для метаданных + project-state.

- [ ] **34.1** Создать `shared/storage-adapter.js`:
  - API совместимый с текущим `loadJson/saveJson` через project-storage:
    - `await dbLoad(pid, module, key, fallback)`
    - `await dbSave(pid, module, key, value)`
    - `await dbDelete(pid, module, key)`
    - `await dbList(pid, module)` — список ключей модуля
  - Под капотом — IndexedDB через минимальный wrapper (без зависимостей).
  - LocalStorage остаётся для маленьких данных (< 50 КБ): project-meta,
    activeIds, settings, фильтры.

- [ ] **34.2** Migration: meteo datasets из LS → IDB:
  - При первом запуске meteo: если в LS есть `meteo.datasets.v1` — копируем
    в IDB, удаляем из LS (освобождаем 1-7 МБ на namespace).
  - meteo.js загружает через `await dbLoad(...)` (init становится async).
  - Backward-compat fallback: если IDB не доступен (старый браузер) —
    остаёмся на LS.

- [ ] **34.3** Migration: cooling performance-curves в IDB (если есть
  крупные кривые > 100 КБ).

- [ ] **34.4** Migration: BOM/inventory снимки tech-workspace в IDB (могут
  быть крупными при 100+ единицах оборудования).

- [ ] **34.5** Storage analytics в global-settings:
  - Показ занятого места в LS + IDB по модулям.
  - Кнопка «Очистить старые namespace» (legacy [object Object], orphan-pid
    проектов которые удалили).
  - Экспорт/импорт всего LS+IDB как .zip для бэкапа.

**Acceptance:**
- ASHRAE 25 лет (218400 точек ≈ 16 МБ) сохраняется без проблем.
- Несколько проектов с крупными meteo-датасетами в одном браузере не
  конфликтуют по квоте.
- Settings показывает реальное использование storage.

---

## Фаза 35 — История загруженных данных + Корзина (🟡 в разработке с v0.60.57)

> Зафиксировано Пользователем 2026-05-03: «любые загруженные данные должны
> сохраняться в истории». См. <code>memory/feedback_data_history.md</code>.

**Цель:** аудит-trail всех импортов + soft-delete с возможностью restore.
Решает проблему случайных удалений + позволяет проследить откуда пришли
данные.

- [x] **35.1** `shared/history-log.js` — append-only API (v0.60.57):
  - <code>historyAppend / historyList / historyTrash / historyRestore /
    historyPurge / historyClear / historyStats</code>.
  - Storage: IDB (приоритет) + LS fallback. Per-project namespace
    через <code>idbKey('history.&lt;pid&gt;')</code> или LS-key
    <code>raschet.project.&lt;pid&gt;.history.log.v1</code>.
  - События: <code>import / update / delete (soft) / restore / purge</code>.

- [x] **35.2** Интеграция в meteo (v0.60.57):
  - При импорте датасета (любой источник) — event 'import' с payload={dataset}.
  - При delete — soft-delete: snapshot в payload, datasets[] фильтруется.
  - В sidebar кнопка «📜 Журнал» — модалка таблицы всех событий.
  - В sidebar «🗑 Корзина (N)» — удалённые с restore/purge.

- [x] **35.3** Интеграция в cooling (v0.60.58):
  - 1-кликовая загрузка meteo через cooling — пишется с tag triggeredFrom='cooling'.
  - Sidebar «📜 История» с кросс-модульным журналом.
  - Модалка корзины с restore-redirect (открой /meteo/ для восстановления датасета).

- [x] **35.4** Интеграция в service (v0.60.59):
  - Создание наряда (manual / cooling-bridge) → 'import' event.
  - Удаление наряда → soft-delete с snapshot в payload.

- [x] **35.5** Глобальная история в /projects/ (v0.60.61):
  - Кнопка «📜 История проектов» в toolbar /projects/.
  - Модалка с фильтрами: проект 📁 / модуль 📦 / тип события ⚡ + кросс-зависимые.
  - Экспорт в JSON для бэкапа/аудита.
  - Счётчик корзины (общий по всем проектам).

- [x] **35.6** Restore-flow (v0.60.60):
  - Из «🗑 Корзина» одной кнопкой — entry с deleted=false возвращается
    в активный список модуля.
  - Permanent delete только из корзины с двойным подтверждением.
  - Cross-module restore: meteo-датасет восстанавливается прямо из cooling-trash через IDB-write + bridge cache refresh.

**Acceptance:**
- При импорте Темиртау через ASHRAE → entry в history с timestamp.
- Удаление любого датасета не теряет данные — soft в Корзину.
- Из global-settings можно увидеть всю историю всех проектов.
- При quota-exceeded UI предлагает очистить Корзину для освобождения
  места.

---

## Фаза 27 — Авторизация Microsoft 365 (deferred)

> Зафиксировано Пользователем 2026-05-02: «Позже добавим авторизацию через
> MS360 (новая фаза, пока не делаем)». Старт после стабилизации Фазы 26.

- [ ] **27.1** MSAL.js интеграция — login через Microsoft account / Azure AD.
- [ ] **27.2** Token-cache в LS с auto-refresh.
- [ ] **27.3** Per-user permission scope для SharePoint Sites.ReadWrite.All,
  Files.ReadWrite.All.
- [ ] **27.4** Многотенантная поддержка (work / school / personal).

---



## Фаза 36 — Технолог ЦОД: концепции + варианты схем + sync оборудования

> Зафиксировано Пользователем 2026-05-03:
> «в модуле Технолог ЦОД должна быть связь с проектом для утверждённой
> конфигурации или для различных вариантов схем (любой вариант концепции
> с своим набором схем, если нужно разработать схемы). Все оборудование
> должно синхронизироваться с модулем Технолог ЦОД, если это разработка ЦОД».

**Цель:** TW-варианты концепции должны быть полноценным «контейнером» для
всех артефактов проектирования: схемы, BOM, отчёты, привязанные модули.

- [~] **36.1** Variant = sketch-проект (v0.60.85 START):
  - [x] Variant model: linkedSketchProjectId + approvedAt поля + миграция.
  - [x] UI sidebar: «🔗 &lt;sketch-name&gt; ↗» (если linked) / «➕ Sketch-проект для схем» (если не создан).
  - [x] <code>createSubProject(_pid, \'tech-workspace\', {name, designation})</code> при клике ➕.
  - [x] Открытие <code>/projects/?focus=&lt;id&gt;</code> для разработки схем (карточка проекта со списком модулей).
  - [ ] readonly sketch-project при утверждении variant (Phase 36.3.x).
  - [ ] автоматическое создание sub-project при addVariant (опц.).
- [ ] **36.2** Bidirectional sync оборудования:
  - При выборе модели в cooling/ups-config/dgu-config (PULL уже реализован
    для cooling/dgu) — equipment автоматически попадает в concept.
  - Reverse: при изменении concept.coolingUnits/upsSystems — соответствующий
    подбор в cooling/ups-config обновляется (если связь установлена).
  - Реализовано: cooling↔TW (PULL/PUSH v0.60.66), ups↔TW (PUSH v0.60.69),
    dgu↔TW (PULL/PUSH v0.60.69 + 82).
  - Осталось: ups PULL (после ups-config wizard сохранять modelRef в LS-bridge,
    TW читает аналогично DGU), service↔TW (changes in service auto-update concept).
- [~] **36.3** Approve-flow (v0.60.85 START):
  - [x] Кнопка «✓» рядом с ⭐/📋/🗑 в variant-row. Click → twConfirm → <code>v.approvedAt = ts</code>.
  - [x] Зелёный circle-badge ✓ в sidebar для утверждённых variants.
  - [x] Снять утверждение можно повторным кликом.
  - [x] Bonus: если других primary нет, утверждённый автоматически становится primary.
  - [ ] **TODO**: Linked sketch-project помечается «утверждённый» в /projects/ (метаданные).
  - [ ] **TODO**: Кнопка «Создать ревизию» (новый sketch-project на основе утверждённого).
  - [ ] **TODO**: Из утверждённого варианта generate итоговый BOM проекта.
- [x] **36.4** UI «Какие модули используются» (v0.60.86):
  - <code>renderCrossModulePanel()</code> читает из sketch-project активного variant (если linked), иначе из parent.
  - Header указывает контекст: sketch-проект варианта vs основной проект.
  - Счётчики 10 модулей: schematic / scs-design / cooling / service / mdc-config / meteo / suppression / rack-config / ups-config / dgu-config.
  - Auto-refresh при смене variant + после создания sketch-project.
  - и т.д. — с прямыми ссылками на каждый модуль в контексте sketch-проекта.

**Acceptance:**
- При создании TW-варианта можно одной кнопкой создать sketch-проект для разработки схем.
- Каждый вариант видит свой schematic/scs-design/cooling независимо от других вариантов.
- Утверждённый вариант readonly, изменения через ревизию.
- Все equipment-модули обмениваются с TW двусторонне.

---

## Фаза 37 — CDE (Common Data Environment) по ISO 19650

> Зафиксировано Пользователем 2026-05-03: «нужна еще организованная среда
> общих данных CDE».

**Цель:** единая среда общих данных проекта по ISO 19650 — сквозной
жизненный цикл документации с состояниями (WIP / Shared / Published /
Archive), версионированием, контролем доступа и аудитом.

**Что такое CDE (Common Data Environment):**
Стандарт ISO 19650-1/-2 определяет CDE как «согласованный источник
информации, используемый для сбора, управления и распространения
документов и данных каждой команды проекта в управляемом процессе».
В CDE документ проходит четыре состояния:
- **WIP (Work In Progress)** — черновик, видим только автору/команде
- **Shared** — отправлен на согласование, видим участникам проекта
- **Published** — утверждён, доступен заказчику
- **Archive** — снят с активного использования, неизменяемый

- [ ] **37.1** Архитектура CDE:
  - <code>shared/cde/</code> модуль — общий API для всех модулей проекта.
  - State-machine документа: WIP → Shared → Published → Archive (+ обратные переходы).
  - <code>cde-event-log.js</code> — append-only audit (кто/когда/что/перевёл-куда).
  - Per-project хранилище: <code>raschet.project.&lt;pid&gt;.cde.documents.v1</code>.
- [ ] **37.2** Документ-обёртка для артефактов:
  - Любой артефакт модуля (cooling-подбор / service-наряд / schematic-схема / отчёт КП) получает CDE-метаданные: id, state, version, owner, sharedWith, publishedAt, archivedAt, supersedes (предыдущая ревизия).
  - <code>shared/cde/wrap-artifact.js</code> — helper для модулей: <code>cdeWrap(artifactId, kind, state)</code>.
- [ ] **37.3** UI CDE-панель в /projects/&lt;id&gt;/:
  - Tab «🗂 Документы (CDE)» с фильтром по state.
  - Каждый документ — кликабельная строка: открыть в исходном модуле, посмотреть историю переходов, скачать pdf/json.
  - Кнопки «Передать в Shared» / «Опубликовать» / «Архивировать» с подтверждением.
- [ ] **37.4** Версионирование:
  - Каждый переход WIP → Shared / Shared → Published создаёт snapshot (immutable).
  - Snapshot хранится с inline-data (для маленьких) или ссылкой на IDB (для больших).
  - Просмотр истории версий — diff с предыдущей.
- [ ] **37.5** Audit log:
  - История переходов: ts / actor / from-state / to-state / artifactId / comment.
  - Экспорт в JSON для внешнего аудита.
  - Интеграция с history-log (Phase 35) — переходы CDE = особый kind событий.
- [ ] **37.6** Подписки на статусы (notifications):
  - При публикации документа — уведомление зависимым модулям («cooling опубликован — обновите CAPEX»).
  - Реализовано через event-bus в browser session + LS storage event для cross-tab.

**Acceptance:**
- Любой артефакт (cooling-подбор / service-наряд / отчёт) виден в /projects/&lt;id&gt;/ → tab «🗂 Документы».
- Можно перевести артефакт через состояния с audit-логом.
- Опубликованные документы readonly, ревизия = новый WIP supersedes.

---

## Фаза 38 — Project Management & Planning

> Зафиксировано Пользователем 2026-05-03: «организация управления
> проектированием (разработкой) как отдельных систем так и объекта в целом
> и планирование всего объекта».

**Цель:** управление сроками и зависимостями для каждой дисциплины
отдельно и для всего объекта в целом. План-график (Gantt), milestone-вехи,
зависимости между задачами разных дисциплин.

- [ ] **38.1** Модель задач:
  - <code>shared/project-plan/</code> — общий API планирования.
  - Задача: { id, projectId, discipline, title, ownerEmail, status, startDate, endDate, durationDays, dependsOn[], milestones[], progressPct }.
  - Per-project хранилище: <code>raschet.project.&lt;pid&gt;.plan.tasks.v1</code>.
- [ ] **38.2** Discipline-плоскости (отдельная разработка систем):
  - План для электрики (внутри 2.A), для слаботочки (2.B), и т.д.
  - Каждая дисциплина имеет свой timeline + ответственного главного инженера (ГИП).
  - Дисциплины могут иметь зависимости: «электрика начинается после 70% архитектуры».
- [ ] **38.3** Whole-object план:
  - Сводный Gantt-вид: все дисциплины + критический путь.
  - Milestone-вехи: концепция / эскиз П / РД / монтаж / ПНР / ввод в эксплуатацию.
  - Прогноз окончания по текущему прогрессу.
- [ ] **38.4** UI:
  - <code>pm/</code> модуль — Gantt + дашборд по проекту.
  - Tab в /projects/&lt;id&gt;/ — «📅 План-график».
  - Drag-drop edit задач, dependency-стрелки.
- [ ] **38.5** Auto-progress из CDE:
  - Прогресс задачи «cooling-подбор» = state в CDE (WIP=20%, Shared=70%, Published=100%).
  - При публикации в CDE — задача авто-закрывается.
- [ ] **38.6** Resource-планирование:
  - Сотрудники / команды с ролью (ГИП / инженер / монтажник).
  - Workload chart: загрузка каждого по времени.
  - Скриншот доступности: «у Иванова 3 проекта на этой неделе».

**Acceptance:**
- Можно посмотреть Gantt всего объекта с критическим путём.
- Можно посмотреть план только электрика (фильтр по дисциплине).
- При закрытии задачи в CDE — задача в плане авто-обновляет прогресс.

---

## Фаза 39 — Lifecycle Management (LCM)

> Зафиксировано Пользователем 2026-05-03: «организация жизненным циклом
> объекта».

**Цель:** управление полным жизненным циклом объекта от концепции до
вывода из эксплуатации (decommissioning). Объединяет CDE + PM + service +
asset registry в единое вьюхно-управление.

**Стадии жизненного цикла объекта (по ISO 15288 / PLM):**
1. **Концепция** (Concept) — идея, первичные требования
2. **Эскиз / П** (Sketch) — концепция готова, оформление
3. **Рабочая документация / РД** (Working) — детальное проектирование
4. **Монтаж** (Construction) — выполнение работ
5. **ПНР** (Commissioning) — пусконаладочные работы
6. **Эксплуатация** (Operation) — рабочий режим, сервис и ТО
7. **Модернизация** (Upgrade) — обновление систем
8. **Вывод из эксплуатации** (Decommission) — демонтаж, утилизация

- [ ] **39.1** Lifecycle state в проекте:
  - <code>project.lifecycleState</code>: 'concept' / 'sketch' / 'working' / 'construction' / 'commissioning' / 'operation' / 'upgrade' / 'decommission'.
  - Метаданные: дата перехода в каждое состояние.
- [ ] **39.2** Per-state требования:
  - Каждое состояние требует определённые артефакты (документы, расчёты).
  - <code>shared/lcm/state-checklist.js</code>: концепция требует «концепция ЦОД» (TW); РД требует «комплект схем» (schematic) + «BOM электрики» (panel-config) + «СКС-журнал» (scs-design).
  - UI checklist в /projects/&lt;id&gt;/ — «Что нужно для перехода в РД».
- [ ] **39.3** Asset registry для эксплуатации:
  - После «commissioning» проект превращается в asset registry.
  - Каждое оборудование (стойка / ИБП / ДГУ / кондиционер) — asset c serial, модель, дата ввода, ТО-история.
  - Интеграция с facility-inventory.
- [ ] **39.4** Maintenance schedule:
  - Из service-нарядов type=maintenance — авто-генерация календаря ТО.
  - Per-asset history: кто и когда обслуживал, какие материалы.
  - Predictive: alerts по hours-of-operation для критических узлов.
- [ ] **39.5** Upgrade-режим:
  - Существующий проект → создать «ревизию-апгрейд» (новый sketch-проект на основе as-built).
  - Сравнение: что было / что станет.
- [ ] **39.6** Decommission:
  - Документация утилизации (АКБ — особый процесс, ГОТВ — раскачка, и т.д.).
  - Финальный отчёт «as-decommissioned».

**Cross-module integration:**
- CDE (Phase 37): document state → lifecycle state mapping.
- PM (Phase 38): задачи привязаны к lifecycle stages.
- Service (Phase 24): maintenance orders как часть operation stage.
- TW variants (Phase 36): approved variant = entry to «working» stage.

**Acceptance:**
- В /projects/&lt;id&gt;/ виден текущий lifecycle state с прогрессом.
- При переходе в новое состояние — checklist для подтверждения.
- В operation-стадии работает asset registry с ТО-журналом.

---

## Фаза 40 — Cloud-синхронизация всех данных проекта

> Зафиксировано Пользователем 2026-05-03: «есть проблема, я на одном
> устройстве сделал какие то схемы и расчеты, при этом зайдя с другого
> устройства обнаружил что доступны только схемы, остальных данных не было».

**Корень проблемы:** Schemas хранятся в Firestore (через cloud-adapter), но
данные остальных модулей (cooling.selections, service.orders, meteo.datasets,
tech-workspace.variants, dgu-config.state, ...) живут ТОЛЬКО в LocalStorage —
не синхронизируются между устройствами.

**Цель:** все project-scoped данные должны синхронизироваться через cloud
(Firestore), чтобы пользователь, работая с одного аккаунта, видел свои
данные на любом устройстве.

- [ ] **40.1** Архитектура cloud-storage adapter:
  - <code>shared/cloud-storage.js</code> — общий API <code>cloudGet/cloudSet/cloudDelete</code>.
  - При isFirebaseReady() — пишет в Firestore коллекцию <code>users/&lt;uid&gt;/project-data/&lt;pid&gt;/&lt;module&gt;-&lt;key&gt;</code>.
  - LocalStorage как cache (read-through) для скорости и offline.
- [ ] **40.2** Module-by-module migration:
  - <code>cooling.selections.v1</code> → cloud
  - <code>service.orders.v1</code> → cloud
  - <code>meteo.datasets.v1</code> → cloud (но БОЛЬШИЕ — IDB+blob storage)
  - <code>tech-workspace.variants.v1</code> → cloud
  - <code>dgu-config.state.v1 / selected.v1</code> → cloud
  - <code>ups-config.selected.v1</code> → cloud
  - <code>history-log</code> → cloud (Phase 35)
  - <code>cde.documents.v1</code> → cloud (Phase 37)
  - <code>plan.tasks.v1</code> → cloud (Phase 38)
- [ ] **40.3** Conflict resolution:
  - Last-Write-Wins (LWW) с timestamp.
  - Опционально — diff-merge для конфликтующих полей.
  - UI «⚠ Изменения с другого устройства» при cross-device write.
- [ ] **40.4** Realtime updates:
  - Firestore onSnapshot listener — изменения с другого устройства подхватываются live.
  - Toast: «🔄 Обновлено с другого устройства».
- [ ] **40.5** Offline mode:
  - Если нет сети — пишем только в LS, при подключении — push в cloud.
  - Banner «📡 Offline — изменения сохранятся локально».
- [ ] **40.6** Storage quota:
  - Большие данные (meteo 6+ МБ) — Firebase Storage (blob) с reference в Firestore.
  - История CDE — TTL для старых snapshot.
- [ ] **40.7** Account UI:
  - В global-settings — статус «👤 Аккаунт: user@example.com · 12 проектов в облаке».
  - Кнопка «🔄 Синхронизировать сейчас» (force pull).
  - Кнопка «📥 Скачать всё локально (бэкап)» / «📤 Восстановить из бэкапа».

**Acceptance:**
- Создал cooling-подбор на ноуте → открыл с телефона → подбор виден.
- Изменил параметр на телефоне → ноут получает update в течение 5 сек.
- Работает offline — изменения сохраняются и синхронизируются при connect.

---

## Фаза 41 — Организация (мульти-пользователь / общие шаблоны) 🆕

> Добавлено 2026-05-04 по запросу Пользователя: «нужно еще добавить
> настройки организации (группа людей работающих над общими проектами
> и имеющая общий настройки шаблонов и общих данных)».

**Цель:** Организация — группа пользователей платформы, работающая над
общими проектами с общим набором настроек, шаблонов и общих данных.
Это уровень между «компанией» (юр.лицом-исполнителем) и «пользователем».

**Каскад настроек:**
```
USER (👤)         — личные настройки конкретного человека
  └── ORG (👥)    — настройки команды (default currency, общие шаблоны
  │                 работ, общие прайсы, общие даташиты, общие brand-
  │                 ассеты, разрешения по ролям)
       └── COMPANY (🏢)  — реквизиты юр.лица
            └── PROJECT (📁) — настройки конкретного проекта
                 └── MODULE — per-module override (последний)
```

При резолве «куда смотреть» (валюта / прайс / шаблон) проверяется:
project → company → org → user → fallback. Уже реализовано для валюты в
v0.60.105 (`shared/currency-defaults.js::resolveDefaultCurrency`).

### 41.1 — Data model
- [x] `shared/currency-defaults.js` (v0.60.105) — каскад валюты.
- [x] **v0.60.115 START**: org-profile минимальный — `name`, `country`,
  `timezone`, `defaultCurrency`, `defaultVat`. LS-ключ
  `raschet.org.profile.v1`. Геттеры/сеттеры `getOrgProfile` /
  `saveOrgProfile` в `currency-defaults.js`.
- [ ] Расширение org-profile (members[], settings.allowedModules[],
  brand.{logoDataUrl, colorPrimary}, parentOrgId для иерархии).

### 41.2 — Shared catalogs
- [x] **v0.60.116**: `org.catalogs.workTemplates` — общий каталог
  шаблонов работ. Promotion-flow: «✏ личное → 👥 в организацию» через
  кнопку ↑ в каталоге работ. Backward demotion ↓ — снять из общего.
  Updates/deletes работают per-scope. LS-ключ
  `raschet.service.workTemplates.org.v1` отделён от user.
- [x] **v0.60.124**: `org.catalogs.priceLists` — общие прайс-листы
  через price-records org API. LS-ключ <code>raschet.priceRecords.org.v1</code>
  (отделён от user). API: <code>saveOrgPrice / removeOrgPrice /
  clearAllOrgPrices / promotePriceToOrg / demotePriceToUser</code>.
  <code>listPrices({scope:'all'|'user'|'org'})</code> — scope-фильтр.
  <code>pricesForElement</code> по умолчанию merged (user+org).
  ID-префикс <code>pr-org-</code>. Audit trail через
  <code>promotedAt/promotedFrom/demotedAt/demotedFrom</code>.
  ✅ <b>v0.60.125</b>: UI в catalog/ — scope-фильтр (Все/Личные/Организация),
  per-row scope-icon (✏/👥) с подсветкой жёлтый/синий, кнопки ↑/↓
  для promote/demote с модалками подтверждения, scope-aware delete
  с warning для org. <b>Phase 41.2 «общие прайс-листы» полностью
  завершён</b>.
- [ ] `org.catalogs.datasheets` — общие datasheets.
- [ ] `org.catalogs.elementLibrary` — общие наборы element-library.
- [x] **v0.60.116**: UI каталога работ показывает все 3 scope с разной
  подсветкой (синий = org, жёлтый = user, нейтральный = seed) + иконка
  📦/👥/✏. Фильтр «Только …» — TODO.

### 41.3 — UI настроек организации
- [x] **v0.60.115**: В `⚙ Глобальные настройки` — новая секция
  «👥 Организация» (имя/страна/часовой пояс) + расширение
  «🏢 Реквизиты компании» с default-валютой и default-НДС для каскада.
- [ ] Полный редактор: members + brand + permissions.
- [ ] В work-catalog — toggle «🔒 личное / 👥 в организацию» per-template.

### 41.4 — Permissions & roles
- [ ] Роли: `owner` / `admin` / `member` / `viewer`.

### 41.5 — Multi-org switcher
- [ ] Picker «Текущая организация» в шапке (фрилансер у нескольких команд).

### 41.6 — Cascade resolvers (расширение)
- [x] `resolveDefaultCurrency(pid)` — проект→компания→org→user→fallback.
- [ ] `resolveDefaultPriceList(pid)` — какой прайс по умолчанию.
- [ ] `resolveDefaultDatasheets(kind)` — datasheets в picker по умолчанию.
- [ ] `resolveDefaultBrand(pid)` — логотип/цвет в шапке КП.

**Acceptance:**
- Команда из 3 человек создаёт org «ГенезисЭнерго».
- Один добавляет шаблон работы в org-каталог; остальные видят его.
- При создании нового проекта валюта = org.defaultCurrency (если у
  проекта явно не задано).
- В шапке КП — логотип и реквизиты org/company по каскаду.

---

## Фаза 44 — Subscription per-module (коммерческая модель) 🆕

> Добавлено 2026-05-04 по запросу Пользователя: «хочется поддерживать
> мульти модули чтобы подавать подписку на модули» + «зависящие модули
> расчёта должны попадать в доступ автоматически, но без графического
> отображения».

**Цель:** перевести платформу на модель «модульная подписка» — клиент
выбирает план (Free / Starter / Pro / Enterprise) или индивидуальный
набор модулей, остальные показываются «🔒 заблокирован».

См. полное обоснование и архитектуру в memory `feedback_subscription_per_module.md`.

### 44.1 — Базовая инфраструктура [v0.60.131 START]

- [x] **shared/subscriptions.js** — API:
  - <code>getSubscription()</code>, <code>saveSubscription(sub)</code>.
  - <code>hasModuleAccess(moduleId)</code>, <code>requireModuleAccess(moduleId)</code>.
  - <code>activateTrial(planId, days=14)</code>.
  - <code>showLockedModal(moduleId)</code> — upsell UI.
  - <code>PLANS</code> constant — Free / Starter / Pro / Enterprise / Custom + цены.
- [x] **modules.json v1.1.0** — поля <code>kind: 'ui'|'calc-lib'</code> и
  <code>subscriptionPlan</code> (free/starter/pro/enterprise) у всех 13
  модулей.
- [x] Принцип «calc-deps авто-включаются»: подписка проверяется ТОЛЬКО для
  kind='ui'; calc-libs (cooling/calc/, dgu-config/calc/, shared/calc-modules/)
  свободно импортируются.

### 44.2 — Soft-enforcement в UI [v0.60.132 + v0.60.137 ✅]

- [x] <code>/modules/index.html</code>: для locked модулей — иконка 🔒,
  затемнение карточки, click → showLockedModal с upsell.
- [x] Plan-badge под H1 в /modules/ — кликабельный chip «🎫 ⭐ Pro · триал 13 дн.».
- [x] **v0.60.137** — <code>hub.html</code>: те же визуальные локи (script читает modules.json + walking через .hub-card).
- [x] **v0.60.137** — Plan-badge в shared/app-header.js (right-зона шапки) — единый chip во всех модулях. Internal → 🏢 фиолетовый. Click → global-settings.
- [x] **v0.60.137** — Defence-in-depth для прямого URL в internal-only модулях (projects/reports/logistics) через <code>requireModuleAccess</code>. Для остальных модулей — TODO (приоритет low т.к. /modules/ и /hub.html уже блокируют).

### 44.3 — Plan management + Internal/RBAC UI [v0.60.132–135 ✅]

- [x] В <code>⚙ Глобальные настройки</code> — раздел «🎫 Подписка»:
  - Текущий план + триал-таймер.
  - Список 4 планов с описанием/ценой, подсветка current.
  - Кнопка «🎁 Триал 14 дн.» per-plan.
- [x] **v0.60.133** — internal-only модули (Phase 44.3 follow-up):
  - Поле <code>internalOnly: true</code> у <code>projects</code>, <code>reports</code>, <code>logistics</code>.
  - <code>hasModuleAccess(id, manifest)</code> уважает <code>manifest.internalOnly</code>.
  - <code>showLockedModal</code> для internal — «🏢 Корпоративный модуль» (без upsell).
  - <code>isInternalUser()</code> / <code>setInternalUser(bool)</code> в shared/subscriptions.js.
- [x] **v0.60.135** — ролевая модель (Phase 44.3 follow-up):
  - <code>ROLES</code>: manager / gip / engineer / viewer + permissions
    (canCreateProjects / canDeleteProjects / canEditEconomics / canApproveVariants / canPromoteOrgItems).
  - <code>currentRole()</code> / <code>setRole(roleId)</code> / <code>hasPermission(perm)</code>.
  - В global-settings — секция «🏢 Внутрикорпоративный доступ + роль» (тумблер internal + селектор роли).
  - В <code>/projects/</code> — guard на «＋ Новый проект» / «Удалить» через <code>hasPermission</code>; role-banner над списком.
- [x] **v0.60.136** — расширение guard'ов permissions:
  - tech-workspace — <code>canApproveVariants</code> на «✓ Утвердить вариант» (disabled+tooltip + defence-in-depth).
  - service/ui/order-form — <code>canEditEconomics</code> для top-level (overheadPct / vatPct) + per-row (costPrice / clientPrice + валюты).
  - catalog/catalog.js (price-records) + service/ui/work-catalog + service/ui/wizard-catalog — <code>canPromoteOrgItems</code> для ↑/↓ promote/demote кнопок.
- [ ] В шапке (app-header.js) badge с текущим планом — Phase 44.2 TODO.

### 44.4 — Платёжная интеграция

- [ ] Stripe / ЮKassa / Cloudpayments / Tinkoff Acquiring — выбрать.
- [ ] Webhook на Firebase Cloud Function для активации подписки.
- [ ] Server-side validation подписки (защита от LS-tampering) —
  Firebase auth.users[uid].plan через Firestore.
- [ ] License key (для self-hosted edition).

### 44.5 — Trial-flow

- [x] **v0.60.131**: 14-дневный триал любого плана через activateTrial.
- [ ] Email-напоминания о скором окончании триала (через FCM).
- [ ] Auto-rollback на free после expiresAt (уже есть в getSubscription).
- [ ] Метрики: какие модули триал-юзеры использовали → upsell-targeting.

### 44.6 — Per-module SKU (custom plans)

- [ ] UI: «индивидуальный набор» — пользователь выбирает 3-5 модулей,
  получает индивидуальную цену.
- [ ] Discount-механизм: bundle 3+ модулей со скидкой 20%.
- [ ] B2B-предложения для корпоративных клиентов (per-seat × per-module).

**Acceptance:**
- Юзер с free-планом видит cooling/tech-workspace/suppression-config с 🔒.
- Click → upsell-модалка с предложением триала.
- После активации триала Pro — все модули доступны 14 дней.
- После истечения — auto-rollback на free, calc-libs продолжают работать.

---

## Фаза 43 — Modular development workflow (per-module ownership) 🆕

> Добавлено 2026-05-04 по запросу Пользователя: «как мне перейти на
> полностью модульную систему, где каждый модуль разрабатывается отдельным
> специалистом и интегрируется потом с другими модулями (через ветки)».

**Цель:** перевести разработку с монолитного «один человек на всё» на
модель «owner-per-module через git-ветки», без слома текущего монорепо
и без необходимости build-step.

См. полное обоснование в memory `feedback_modular_workflow.md`.

### 43.1 — Этап 0: Документировать контракты

- [ ] **shared/storage-keys.md** — каталог всех `raschet.project.<pid>.<module>.<key>`
  с указанием owner-модуля и схемы записи.
- [ ] **shared/cross-module-events.md** — каталог всех window-events
  (raschet:wizards-change, raschet:work-templates-change, ...).
- [ ] **shared/url-params.md** — стандарт URL-контракта между модулями
  (?project=, ?from=, ?return=, ?capacityKw=, ...).
- [ ] **CONTRIBUTING.md** в корне — правила branch-strategy, code review,
  cross-module dependencies.

### 43.2 — Этап 1: Branch-per-module

- [ ] Назначить owner'а каждому из ~30 модулей (поле `owner` в
  modules.json).
- [ ] Создать ветки `module/<name>` для активных модулей (cooling,
  ups-config, scs-design, tech-workspace, suppression-config — 5 pilot).
- [ ] Owner работает в своей ветке, рекурсивно ребейзится на main
  (раз в неделю minimum).
- [ ] Merges → main через PR. Self-approve если только свой модуль; review
  обязателен для shared/* и cross-module changes.
- [ ] **GitHub Actions/CI**:
  - Auto-run linter (eslint) per branch.
  - Auto-run validateWizard / validate manifests per PR.
  - Pre-deploy checks (нет TODO в production-коде, версия бамплена).

### 43.3 — Этап 2: Module manifest

- [ ] **<module>/manifest.json** в каждом модуле:
  ```json
  { "id", "name", "version", "owner", "depends": {}, "exports": {
    "lsKeys": [], "events": [], "urls": [] }, "ui": { "entry", "icon", "category" } }
  ```
- [ ] **modules.json** генерируется из всех manifest.json (build-time
  скрипт `scripts/build-modules-index.js`).
- [ ] **/modules/index.html** читает modules.json динамически.
- [ ] **Per-PR validation**: PR не может быть смержен если manifest
  сломан или объявленные lsKeys/events не используются.

### 43.4 — Этап 3 (опц.): Workspace / submodules

> Только если станет больно (10+ человек / частые конфликты в shared/).

- [ ] Миграция на pnpm workspace с `packages/*`.
- [ ] Build-step (Vite) для каждого пакета — но deploy всё равно как
  static site на GitHub Pages.
- [ ] Внутренний npm-registry или GitHub Packages для версионирования
  пакетов.

### 43.5 — Owner-board UI

- [ ] В `/modules/` рядом с каждой карточкой — chip с owner'ом
  (читается из manifest).
- [ ] Сводная таблица «👥 Owner-board» — кто за что отвечает, когда
  последний коммит, активные PR.

**Acceptance:**
- 5 pilot-модулей переведены на ветки + manifest.
- Owner может разработать фичу в своей ветке, не блокируя других.
- Merge в main работает без manual intervention для не-shared изменений.
- Релиз-процесс описан в CONTRIBUTING.md.

---

## Фаза 42 — Мастер составления нарядов (Service Order Wizard) 🆕

> Добавлено 2026-05-04 по запросу Пользователя: «в нарядах добавь мастер
> составления нарядов, который по категориям работ будет сам предлагать
> выбрать соответствующие пункты, например если речь идет про систему
> вентиляции, то мастер запрашивает производительность системы, затем
> соответственно предлагает соответствующие расходные материалы для
> конкретной установки, учитывая производительность, по ходы работы
> мастера спрашивая пользователя, нужно ли добавить тот или иной пункт.
> Сами комбинации для того или иного оборудования или работы должны
> иметь возможность конфигурироваться (задание конкретных фильтров
> для конкретной установки...)».

**Цель:** многошаговый интерактивный мастер сборки наряда (или КП)
по типу обслуживаемой системы. Мастер задаёт «правильные» вопросы,
исходя из категории, и предлагает релевантные позиции из каталога —
с учётом параметров системы (расход, мощность, тип хладагента и т.п.).

**Архитектура** — data-driven, в соответствии с правилом
`feedback_use_catalogs`. Каждый сценарий мастера — JSON-конфигурация в
`service/catalog/wizards/`. Никаких хардкод-комбинаций в коде модуля.

### 42.1 — Wizard-DSL (декларативное описание сценария)
- [ ] `service/catalog/wizards/index.js` — реестр сценариев.
- [ ] Формат сценария:
  ```js
  {
    id: 'maintenance-ventilation',
    title: 'ТО системы вентиляции',
    icon: '💨',
    appliesTo: ['maintenance'],   // тип наряда
    steps: [
      { kind: 'param', id: 'airflow', label: 'Производительность, м³/ч',
        type: 'number', min: 100, required: true,
        tip: 'Номинальный расход воздуха установки.' },
      { kind: 'param', id: 'filterCount', label: 'Кол-во фильтров',
        type: 'number', default: 1 },
      { kind: 'choice', id: 'filterClass', label: 'Класс фильтров',
        options: [{v:'G4',l:'G4 предв.'},{v:'F7',l:'F7 средний'},{v:'H13',l:'HEPA H13'}],
        multi: false, default: 'F7' },
      { kind: 'suggest', id: 'consumables',
        title: 'Расходники под параметры',
        rules: [
          // Каждое правило = когда применять + что предложить.
          // template = ссылка на work-templates ИЛИ inline-spec.
          { when: 'filterClass === "G4"',
            template: 'seed-mat-filter-g4',
            qty: 'filterCount * 2',  // expr
            ask: 'Добавить фильтры G4 ({qty} шт)?' },
          { when: 'filterClass === "F7"',
            template: 'seed-mat-filter-f7',
            qty: 'filterCount',
            ask: 'Добавить фильтры F7 ({qty} шт)?' },
          { when: 'filterClass === "H13"',
            template: 'seed-mat-filter-h13-{airflow_size}',
            qty: 'filterCount',
            ask: 'Добавить HEPA H13 фильтры ({qty} шт, размер по airflow)?' },
          { when: 'airflow > 5000',
            template: 'seed-work-cleanup-large-ahu',
            qty: 1,
            ask: 'Добавить чистку секций (большая установка)?' },
        ],
      },
      { kind: 'review', title: 'Проверьте состав' },
    ],
  }
  ```
- [ ] Поддержка expressions в `qty` / `when` через безопасный
  evaluator (whitelist of operators, no eval()).
- [ ] Поддержка `template` со wildcard (`{airflow_size}`) — резолвится
  в один из вариантов в каталоге по правилу выбора.

### 42.2 — UI мастера
- [ ] Кнопка «🪄 Через мастер» в шапке наряда (рядом с «+ Позиция»).
- [ ] Модалка с пагинацией шагов: progress-bar, кнопки «← Назад / Вперёд →».
- [ ] Шаг `param` — числовой/текстовый input с валидацией.
- [ ] Шаг `choice` — radio-group или checkbox-list.
- [ ] Шаг `suggest` — список предложенных позиций с чекбоксами +
  inline-редактирование qty + кнопка «Пропустить».
- [ ] Шаг `review` — итоговая таблица позиций перед добавлением.
- [ ] Кнопка «✓ Добавить в наряд» — применяет выбранные позиции.

### 42.3 — Каталог сценариев (seed)
- [ ] **ТО вентиляции** — параметры: расход, фильтры. Предлагает:
  фильтры по классу, чистку секций, замену клиновых ремней, замену
  пылесборника.
- [ ] **ТО чиллера** — параметры: мощность кВт, тип хладагента.
  Предлагает: проверку давления, дозаправку (по типу), замену
  масла, чистку конденсатора, регулировку расширительного клапана.
- [ ] **ТО CRAC** — параметры: мощность, тип увлажнения.
  Предлагает: чистку фильтров, обслуживание увлажнителя, проверку
  дренажа, калибровку датчиков.
- [ ] **Монтаж DX** — параметры: мощность, длина трассы. Предлагает:
  крепёж, кабельные коробы, дренажную помпу (если длина >X), пайку,
  опрессовку, заправку, ПНР.
- [ ] **Монтаж чиллер-плант** — параметры: мощность, число блоков,
  схема (N/N+1/2N). Предлагает: гидроразделитель, насосы, баки,
  обвязку, теплоизоляцию, проводку, балансировку.
- [ ] **ТО ИБП** — параметры: модель/мощность, тип АКБ, кол-во АКБ.
  Предлагает: проверку АКБ, dummy-load test (по периодичности),
  замену вентиляторов (по часам наработки), термоснимок.
- [ ] **ТО ДГУ** — параметры: мощность, мото-часы. Предлагает: масло,
  фильтры (масло/топливо/воздух), охлаждающую жидкость, замену
  свечей (если бензиновый), проверку запуска под нагрузкой.

### 42.4 — Конфигурируемость
- [x] **v0.60.118**: Редактор сценариев — кнопка «🪄 Сценарии
  мастера» в сайдбаре service-модуля. CRUD: clone/edit/delete +
  + новый-blank через «+ Новый сценарий». Edit = JSON-editor
  с валидацией структуры (validateWizard) перед save.
- [x] **v0.60.118**: Promotion в org-catalog (по pattern Phase 41.2):
  личные ✏ ↑ → общие 👥 ↓ → личные. ID-префиксы wz-usr-/wz-org-.
  Audit trail (promotedAt/promotedFrom).
- [x] **v0.60.130 (Phase 42.4 final)**: Импорт/экспорт сценариев JSON
  через файл. Кнопки в каталоге сценариев:
  • <b>📥 Импорт JSON</b> — загрузка одиночного wizard или массива
    (export-all bundle). Validate перед save. Импортированные → в личные.
  • <b>📤 Экспорт всех</b> — скачать ВСЕ user+org для текущего orderType
    в один JSON-файл (для отправки коллегам / другому org).
  • <b>📤 в строке</b> — скачать одиночный сценарий.
  Пометка скачивается как <code>wizards-{type}-{date}.json</code> или
  <code>wizard-{title}-{date}.json</code>. Phase 42.4 закрыт полностью.

### 42.5 — Cross-module pre-fill
- [x] **v0.60.117**: Если активен проект с cooling-подбором — мастер
  «ТО чиллера» предлагает мощность (capKw) и хладагент (refrigerant)
  из active-option первого подбора. Поля подсвечены 📁 авто.
- [x] **v0.60.117**: Если в проекте есть ups-config.selected.v1 —
  мастер «ТО ИБП» подтягивает мощность kVA (= capacityKw / cos φ).
- [ ] tech-workspace concept ДГУ → мастер «ТО ДГУ» (когда сценарий
  ТО ДГУ будет добавлен).
- [ ] batteryCount/stringCount/batteryTech → ТО ИБП (требует
  расширения ups-config bridge).

**Acceptance:**
- Сервисный инженер запускает мастер «ТО вентиляции», вводит
  расход 3000 м³/ч и кол-во фильтров=2 → получает готовый список
  из 4-5 позиций (фильтры F7×2, чистка секций, замена ремней)
  с правильными количествами. Соглашается / снимает галочки → жмёт
  «Добавить» → позиции в наряде.
- Технолог редактирует сценарий «ТО CRAC» — добавляет шаг с типом
  увлажнения «steam | adiabatic», и для adiabatic добавляется
  правило «предложить картриджи увлажнения».

---
