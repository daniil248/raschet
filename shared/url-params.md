# Raschet — URL-параметры (контракт навигации)

> Спецификация v1 (2026-05-16). Один из 5 каналов общения
> (см. `contracts/README.md` §4). Навигация/контекст/handoff между
> модулями. Парсинг контекста проекта — централизован в
> `shared/project-context.js` / `project-bootstrap.js`; embed/return —
> в `shared/module-nav.js`. Модули объявляют используемые параметры в
> `manifest.json.dependsOnContracts.urlParams`.

## 1. Контекст проекта (универсальные)
| Параметр | Значение | Кто читает | Назначение |
|---|---|---|---|
| `project` (синоним `pid`) | projectId | `project-context.js` + все модули | открыть модуль в контексте проекта |
| `from` (синоним `fromModule`) | id модуля-источника | `project-context.js`, scs-config, racks-list | «вернуться назад» / поведение по источнику |
| `standalone` | `1` | service, configuration-catalog | принудительно standalone (игнор project) |
| `embedded` / `mode` | `1` / `embedded` | rack-sidebar, configuration-catalog | embed-режим (скрыть свой сайдбар/шапку) |
| `tab` | id вкладки | projects/project | deep-link на вкладку карточки проекта |
| `focusNode` / `nodeId` | nodeId | Конструктор, *-config | фокус/handoff на конкретный узел схемы |
| `openFile` | имя | js/main | открыть файл-схему (file-storage) |
| `openSelection` | selectionId | cooling | открыть конкретный подбор |

> Канонично читать через `project-context.js`/`project-bootstrap.js`,
> а не сырым `URLSearchParams` в каждом модуле (цель упрощения X.1.3).

## 2. Embed / return (мост `module-nav.js`)
| Параметр | Назначение |
|---|---|
| `return` | URL модуля-источника, куда вернуться после выбора |
| `returnSession` | id сессии возврата (ключ `raschet.nav.return.<S>.payload`) |
| `returnLabel` | человекочитаемая метка источника (для кнопки «← …») |

Поток: A → `openEmbed(target, {return, returnSession, returnLabel})`
→ B делает выбор → `completeReturn(payload)` пишет
`raschet.nav.return.<S>.payload` → редирект назад → A
`readEmbedResult()` забирает и удаляет.

## 3. Handoff-префилл условий подбора (Конструктор/Технолог → конфигуратор)
Параметры-условия, которыми вызывающий предзаполняет подбор
(значения — числа/enum; конфигуратор берёт как стартовые условия):

| Параметр | Где потребляется |
|---|---|
| `capacityKw`, `loadKw` | ups-config, genset-config, panel-config, battery (требуемая мощность/нагрузка) |
| `autonomyMin`, `targetAutonomyMin` | ups-config, battery (автономия) |
| `cosPhi`, `phases`, `redundancy`, `upsType`, `mode` | ups-config, genset-config (cos φ / фазность / резерв / тип / режим ДГУ) |
| `requiredCoolingKw` | cooling (через `raschet.cooling.prefill.v1` + URL) |
| `selected`, `fromUps`, `fromCtx` | battery (предвыбор модели / признак прихода из ИБП-мастера) |

Правило: handoff-префилл заполняет ТОЛЬКО пустые поля условий
(user-params sacred — ручной ввод не затирать). Канал данных для
крупного payload — LS-handoff (см. `storage-keys.md` §3), URL — для
лёгких скаляров и признаков режима.

## 4. Правила
- Новый параметр → добавить сюда + в `manifest.urlParams` модуля.
- Никаких PII / секретов в URL.
- Контекст проекта читать через `project-context.js`, не дублируя
  парсинг (boundary-lint позже проверит прямые `URLSearchParams` на
  `project`/`from` вне разрешённых файлов — пока WARN).
- Параметр-условие не отменяет ручной ввод пользователя (sacred).
