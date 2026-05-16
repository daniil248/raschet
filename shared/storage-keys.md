# Raschet — Каталог ключей localStorage (контракт хранения)

> Спецификация v1 (2026-05-16). Каталог собран из кода (grep) —
> репрезентативный, НЕ исчерпывающий. Фаза 0/1 формализует его
> авто-проверкой: каждый `manifest.json.dependsOnContracts.storageKeys`
> сверяется с этой таблицей; новые ключи добавляются сюда в PR.
> Правило (см. `contracts/README.md` §3): чужие `raschet.project.*` /
> глобальные реестровые ключи читаются ТОЛЬКО через
> `project-storage.js` / `configuration-catalog.js` / `subscriptions.js`
> / объявленный мост — не сырым `localStorage`.

## 0. Соглашение об именах
- **Project-scoped:** `raschet.project.<pid>.<module>.<key>.v<schema>`
  — пишет/читает helper `projectKey(pid, module, 'key.vN')`
  (`shared/project-storage.js`). Владелец = `<module>`.
- **Global registry:** `raschet.<name>.v<schema>` — общие реестры.
- **Handoff/bridge:** `raschet.<topic>.v<schema>` или
  `raschet.<topic>.bridge.<nodeId>` — временные каналы передачи
  между модулями (одноразовые, со сроком свежести).
- **Per-user:** суффикс `.<uid>` (uid из `raschet.currentUserId`,
  иначе `anonymous`).
- **Session/UI-pref:** `raschet.<name>` без `vN` — не контрактные,
  не межмодульные (ширины панелей, видимость колонок и т.п.).

## 1. Глобальные реестры (владелец: SHARED-CONTRACTS / CORE)
| Ключ | Владелец | Назначение |
|---|---|---|
| `raschet.projects.v1` | project-storage | Реестр проектов (массив метаданных) |
| `raschet.activeProjectId.v1` | project-storage | Id активного проекта |
| `raschet.activeProject.v1` | project-storage | Снимок активного проекта (legacy-совм.) |
| `raschet.storageMode.v1` | project-storage | Режим хранилища (local/cloud) |
| `raschet.subscription.v1` | subscriptions | План/триал/модули/роль |
| `raschet.internal.v1` / `raschet.internal.role.v1` | subscriptions | Внутр.пользователь / RBAC-роль |
| `raschet.currentUserId` / `raschet.currentRole` | auth/main | uid / роль каталога |
| `raschet.global.v1` | engine/constants (SETTINGS_KEY) | Глобальные настройки расчёта |
| `raschet.configurations.<kind>.v1` | configuration-catalog | Библиотеки конфигураций (ups/panel/mv/…) |
| `raschet.userPresets.v1` · `raschet.presetsDeleted.v1` · `raschet.presetsOverrides.v1` | js/presets | Пресеты карточек (built-in + overrides + soft-delete) |
| `raschet.upsCatalog.v1` · `raschet.batteryCatalog.v1` · `raschet.transformerCatalog.v1` · `raschet.panelCatalog.v1` (+`.<uid>`) | каталоги модулей | Пользовательские каталоги изделий |
| `raschet.catalog.colVisibility.v1` · `raschet.tableColumns.<table>.v1` | UI-pref | Видимость колонок таблиц |
| `raschet.reportCatalog.builtinVersion` | reports | Версия встроенных шаблонов отчётов |
| `raschet.paletteWidth` · `raschet.rs-sidebar-left-w`/`-right-w` | UI-pref | Ширины панелей (sidebar-resizer) |

## 2. Project-scoped (владелец = модуль; ключ `raschet.project.<pid>.<module>.…`)
| Префикс | Модуль | Примеры ключей |
|---|---|---|
| `…engine.scheme.v1` · `…engine.issues.v1` | CORE/constructor | Граф схемы; снапшот проблем расчёта |
| `…tech-workspace.variants.v1` · `…activeVariantId.v1` | tech-workspace | Варианты концепции |
| `…cooling.selections.v1` · `…activeSelectionId.v1` · `…options.v1` · `…tariff.v1` · `…cols.v1` | cooling | Подборы холода |
| `…ups-config.selected.v1` | ups-config | Выбранная модель ИБП (PULL в TW) |
| `…dgu-config.selected.v1` | genset-config | Выбранная ДГУ (LS-namespace `dgu-config` оставлен для совместимости данных) |
| `…meteo.datasets.v1` | meteo | Климатические датасеты проекта |
| `…scs-design.links.v1` · `…scs-design.plan.v1` | scs-design | Меж-стоечные связи / план |
| `…scs-config.inventory.v1` | scs-config | IT-инвентарь |
| `…facility-inventory.v1` | facility-inventory | Не-IT имущество |
| `…service.orders.v1` | service | Наряды монтаж/ТО |
| `…plan.tasks.v1` · `…implStages.v1` | projects (ГИП) | План-график / этапы |
| `…battery.lifecycleCostItems.v1` | battery | Состав/ЖЦ АКБ |

> Полный список генерируется/валидируется тулингом Фазы 1. Любой
> модуль владеет ТОЛЬКО своим `<module>`-неймспейсом
> (manifest.lsNamespacesOwned). Чтение чужого — через helper/мост.

## 3. Handoff / мосты (временные, одноразовые)
| Ключ | Канал | От → К |
|---|---|---|
| `raschet.lastUpsConfig.v1` · `raschet.pendingUpsSelection.v1` | ups-config → Конструктор/TW | выбранный ИБП (24ч свежесть) |
| `raschet.upsHandoff.v1` · `raschet.upsBatteryReturn.v1` | ups-config ↔ battery | подбор АКБ для ИБП-мастера |
| `raschet.pendingBatterySelection.v1` | battery → потребитель | выбранная АКБ |
| `raschet.pendingMvSelection.v1` | mv-config → Конструктор | выбранная ячейка СН |
| `raschet.cooling.prefill.v1` | tech-workspace → cooling | requiredCoolingKw (60с свежесть) |
| `raschet.mdcToSuppression.v1` | mdc-config → suppression-config | данные для АГПТ |
| `raschet.logistics.handoff` | * → logistics | импорт позиций |
| `raschet.rack.bridge.<nodeId>` · `raschet.dgu.bridge.<nodeId>` | rack-config/genset-config → Конструктор | postMessage-фолбэк (`raschet.rack.apply`/`raschet.dgu.apply`; protocol-ключ `raschet.dgu.*` оставлен) |
| `raschet.nav.return.<S>.payload` | module-nav | embed/return payload |
| `raschet.cs.ctx.<kind>` | configuration-catalog | контекст подбора (standalone/project) |
| `raschet.savePending.<pid>` | main | бэкап несохранённого перед восстановлением |

## 4. Migration-флаги (one-shot, сессия/версия)
`raschet.scheme-orphan-migration.v1`, `raschet.legacy-rack-migration.v2`,
`raschet.main.cleanup-phantoms-hard.session`,
`raschet.cable.autoNormHint.shown` и подобные — внутренние, не
контрактные; перечислять не обязательно, но НЕ переиспользовать как
канал данных.

## 5. Правила
- Новый project-ключ → только `raschet.project.<pid>.<свой-module>.…vN`
  через `projectKey()`; добавить в §2 + в `manifest.lsNamespacesOwned`.
- Новый handoff → в §3 + `manifest.dependsOnContracts.events/bridges`,
  обязательно срок свежести (ts) и одноразовость (remove после чтения).
- Чужой ключ читать нельзя сырым `localStorage` — только helper/мост
  (boundary-lint форбидит; текущие исключения — `lint-allowlist.json`).
- Смена смысла/удаление ключа = мажорный bump `vN` + миграция или
  soft-delete (history-log).
