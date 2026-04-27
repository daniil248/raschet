// shared/module-changelogs.js — центральные журналы изменений по модулям.
// Ключ = moduleId, значение = массив записей (новые сверху).
// Подключается во всех модульных index.html через module-footer.js.

export const CHANGELOGS = {
  'engine': [
    { version: '0.59.525', date: '2026-04-27', items: [
      '🔧 <b>Fix project card schemes (real root cause через debug в браузере)</b>. Подключился к браузеру через Claude in Chrome MCP, обнаружил что user в <b>cloud-режиме</b> (Firestore, аутентифицирован через Gmail) — все схемы лежат в Firestore, в LS только 4 project-контейнера.',
      '• <b>Корень бага</b>: project.html инициализирует Firebase async; в момент рендера <code>Storage.mode === \'local\'</code> и <code>Storage.listMyProjects()</code> возвращает пусто (Local-фильтр исключает project-контейнеры). Через ~1с auth-state resolved, Storage переключается в \'firestore\', но project.js уже отрендерил группу «Схем нет».',
      '• <b>v0.59.523 fix (sync listProjects)</b> только усугубил: LS пуст для cloud-юзеров, sync read всегда возвращал 0.',
      '• <b>Real fix (v0.59.525)</b>: вернул async <code>Storage.listMyProjects()</code>, но с <b>правильным ожиданием</b>: если <code>window.firebase</code> загружен, ждём пока <code>Storage.isCloud === true</code> до 5 секунд (polling 100ms). Это гарантирует что Storage уже переключился в cloud-режим перед запросом.',
      '• <b>Diagnostic в console</b>: <code>[project.js] schemes load: pid=X mode=firestore total=N mine=M</code>.',
      '• <b>Эффект</b>: после Ctrl+F5 на карточке любого проекта — схемы должны появиться (cloud user) или показать «Схем нет» (local user без схем — корректно).',
      'Файлы: <code>projects/project.js</code> — async listMyProjects с ожиданием Storage.isCloud.',
    ] },
    { version: '0.59.524', date: '2026-04-27', items: [
      '🔍 <b>Fix project card schemes: толерантный фильтр + diagnostics</b>. После v0.59.523 пользователь репортит «не работает, для всех проектов в схемах пусто». Возможные причины:',
      '• <b>scheme.projectId</b> мог быть установлен в legacy-поле <code>parentProjectId</code> (пред-Storage версия). Расширил фильтр: <code>(s.projectId || s.parentProjectId) === p.id</code>.',
      '• Защита от попадания project-контейнеров вынесена в helper <code>_isCtx(s)</code> для повторного использования.',
      '• <b>Diagnostic в console</b>: при каждом рендере карточки проекта пишется <code>[project.js] schemes load: pid=X total=N schemes=M linkedAny=K mine=L</code>. Это покажет: сколько вообще записей в LS, сколько из них Storage-схем, сколько имеют какую-то projectId-привязку, и сколько матчится текущему проекту.',
      '• <b>Если mine=0</b>: значит схемы есть, но ни одна не привязана к этому p.id. Возможно их projectId указывает на устаревший (deleted) контейнер. В этом случае — миграция orphan-схем (v0.59.517) уже должна была привязать их к существующему контейнеру по имени. Если этого не произошло — нужно пройти повторно через консоль: <code>RaschetSchemeMigration.run({force:true})</code> и Ctrl+F5.',
      'Файлы: <code>projects/project.js</code> — расширенный фильтр + console.info.',
    ] },
    { version: '0.59.523', date: '2026-04-27', items: [
      '🩹 <b>Fix: карточка проекта показывает «Схемы · 0», хотя на главной «Мои схемы» эта схема привязана</b>. По репорту пользователя — расхождение между двумя страницами проекта 25013_Qarmet Темиртау.',
      '• <b>Корень бага</b>: <code>projects/project.js</code> async-блок enrichment для группы «Схемы» использовал <code>await window.Storage.listMyProjects()</code>. Storage-адаптер инициализируется асинхронно (Firebase compat scripts), и до его готовности listMyProjects может вернуть пусто или закидать в catch. Если не успеет до рендера — группа остаётся «Схем нет».',
      '• <b>Fix</b>: переписано на синхронный <code>listProjects()</code> из <code>shared/project-storage.js</code>. Это тот же LS-ключ <code>raschet.projects.v1</code> что и Local Storage-адаптер использует, но без зависимостей от Firebase init. Фильтр <code>s.projectId === p.id</code> + защита от попадания project-контейнеров (по id-префиксу p_/s_ и kind=full/sketch).',
      '• <b>Эффект</b>: после Ctrl+F5 на карточке проекта 25013_Qarmet Темиртау должна появиться схема «25013-GEP-ENG-ELC-901_Qarmet Те...» в группе «⚡ Схемы · 1».',
      'Файлы: <code>projects/project.js</code> — переписан async-блок на синхронный read.',
    ] },
    { version: '0.59.522', date: '2026-04-27', items: [
      '🗑 <b>Страница «Шкафы проекта» (реестр) удалена</b>. По решению пользователя: функциональность полностью покрывает sidebar Компоновщика шкафа (rack.html), а двойной список с разными счётчиками вносил путаницу (репорт «нет соответствия»).',
      '• <b>scs-config/index.html</b> — теперь thin-redirect на <code>./rack.html</code>. Безусловный (даже если в проекте 0 racks). Параметр <code>?list=1</code> игнорируется. URL <code>/scs-config/</code> продолжает работать — все внешние ссылки (project.js, scs-design, hub, закладки) ведут на компоновщик.',
      '• Хлебные крошки и тексты ссылок «🗄 Шкафы проекта» → «🗄 Компоновщик шкафа» в: <code>scs-config/rack.html</code>, <code>scs-config/inventory.html</code>, <code>scs-design/index.html</code>, <code>scs-design/scs-design.js</code>, <code>rack-config/rack-config.js</code> (toast).',
      '• <b>scs-config/racks-list.js</b> остаётся как dead code — не подключается из новой index.html. Можно удалить позже после периода стабильности.',
      'Файлы: <code>scs-config/index.html</code> (переписан в redirect), <code>scs-config/rack.html</code>, <code>scs-config/inventory.html</code>, <code>scs-design/index.html</code>, <code>scs-design/scs-design.js</code>, <code>rack-config/rack-config.js</code>.',
    ] },
    { version: '0.59.521', date: '2026-04-27', items: [
      '🔄 <b>POR-источник стоек интегрирован в <code>shared/rack-storage.js</code></b>. По репорту: «Шкафы проекта · 2», но в Компоновщике шкафа sidebar — 10+ POR-стоек. Это потому что <code>scs-config/racks-list.js</code> (реестр шкафов) и <code>scs-config/scs-config.js</code> (компоновщик) использовали ОДИН и тот же <code>loadAllRacksForActiveProject</code>, но в v0.59.516 я расширил POR-load только в одном месте (scs-config.js), не в общем хелпере.',
      '• <b>Fix</b>: POR-чтение перенесено в <code>shared/rack-storage.js::loadAllRacksForActiveProject</code> — третий источник после templates и instances. Лениво через <code>window.RaschetPOR.getObjects</code> (без circular import).',
      '• <b>Эффект</b>: ВСЕ потребители rack-storage (scs-config компоновщик, racks-list реестр, scs-design мастер связей, любые будущие) видят одинаковый список racks = templates + instances + POR.',
      '• <b>Дедуп по id</b>: POR с <code>legacyRackId</code> совпадающим с legacy — пропускается (legacy содержит pdus/accessories для UI). POR-only racks добавляются с id из <code>legacyRackId || por.id</code>.',
      '• Конвертер POR → legacy перенесён из <code>scs-config/scs-config.js::_porRackToScsRack</code> в <code>shared/rack-storage.js::_porRackToLegacy</code>.',
      'Файлы: <code>shared/rack-storage.js</code> (новые <code>_porRackToLegacy</code> + <code>_loadPorRacks</code> + расширенный <code>loadAllRacksForActiveProject</code>), <code>scs-config/scs-config.js</code> (упрощён <code>loadRacks</code>: делегирует rack-storage; убран дублирующий импорт getObjects).',
    ] },
    { version: '0.59.520', date: '2026-04-27', items: [
      '🏷 <b>scs-config: теги POR-стоек теперь попадают в picker «Стойки проекта»</b>. По репорту пользователя: в SCS-модуле счётчик «6 шт.» (загрузилось из POR), но видно только 2 стойки с тегами (А-01 × 2). При том что в POR Playground 16 stoek с тегами SR01-SR08, CR01, MR01.',
      '• <b>Корень бага</b>: SCS picker (<code>projectRacks()</code>) фильтрует <code>state.racks</code> по <code>state.rackTags[r.id]</code> — это ОТДЕЛЬНАЯ LS-таблица <code>rackId→tag</code> (<code>scs-config.rackTags.v1</code>). Тег из POR-объекта живёт в <code>obj.tag</code> и в моём конвертере попадал в <code>r.tag</code>, но НЕ в <code>state.rackTags</code>. Поэтому picker считал POR-стойки «без тега» и скрывал.',
      '• <b>Fix</b>: в <code>init()</code> после загрузки <code>state.rackTags</code> — sync из POR-стоек: для каждого <code>r</code> с маркером <code>_source: \'por\'</code> или <code>porObjectId</code>, если <code>r.tag</code> задан и нет записи в <code>state.rackTags[r.id]</code> — копируем. Изменения сохраняются в LS_RACKTAGS.',
      '• <b>Эффект</b>: после Ctrl+F5 в SCS-модуле для проекта 25013_Qarmet — все 16 POR-стоек должны появиться в picker «Стойки проекта — с тегом» с их POR-тегами (SR01-08, CR01, MR01, A-01, DH1.SR1, DH1.SR2, tpl-*).',
      '• <b>Console</b>: <code>[scs-config] синхронизированы теги из POR → state.rackTags</code>.',
      'Файлы: <code>scs-config/scs-config.js</code> — sync-блок в init после <code>state.rackTags</code> load.',
    ] },
    { version: '0.59.519', date: '2026-04-27', items: [
      '⬇ <b>POR → Engine pull: POR-only racks автоматически появляются в «Неразмещённые»</b>. Раньше mirror был односторонний: engine → POR (rack-узлы из схемы зеркалятся в POR), но НЕ обратно. Если SCS-инженер добавлял стойки в POR Playground / scs-config / другом модуле — engine их не видел, главный инженер не мог разместить их на схеме.',
      '• <b>Логика pull</b>: при активации mirror\'а (<code>enableEngineMirror</code>) и при cross-tab <code>add</code>/<code>sync</code>-events — для каждого POR-объекта <code>type=\'rack\'</code> без соответствующего engine-узла создаётся <b>UNPLACED</b> engine-узел (<code>type=\'consumer\'</code>, <code>subtype=\'rack\'</code>, <code>pageIds=[]</code>, <code>porObjectId</code> линк).',
      '• <b>Эффект</b>: эти узлы появляются в инспекторе во вкладке «📋 Неразмещённые» — главный инженер видит их и drag-and-drop размещает на нужной странице.',
      '• <b>Fields переноса</b>: tag, name, demandKw/cosPhi/phases/voltageV (electrical), widthMm/depthMm/heightMm/u (mechanical).',
      '• <b>Console</b>: <code>activated for pid=X (..., pulled из POR: N)</code> при активации; <code>pulled POR rack obj_xx (TAG) → unplaced engine node nN</code> на каждый pull.',
      '• <b>API</b>: <code>window.RaschetEnginePorMirror.pullPorRacksToEngine()</code> — ручной вызов.',
      'Файлы: <code>shared/engine-por-mirror.js</code> (новая функция <code>pullPorRacksToEngine</code>, applyPorEvent обрабатывает add-events для несвязанных объектов).',
    ] },
    { version: '0.59.518', date: '2026-04-27', items: [
      '🐛 <b>НАСТОЯЩИЙ корень бага «Без проекта · 5 схем»</b>. Это была НЕ orphan-миграция, а баг в <code>Local.listMyProjects()</code> в <code>js/projects.js</code>. Раньше функция возвращала ВСЕ записи из <code>raschet.projects.v1</code> — включая project-контейнеры (<code>p_*</code>/<code>s_*</code>), которые лежат в том же LS-ключе. Контейнеры не имеют <code>projectId</code> поля → render в main.js помещал их в группу «Без проекта» как фантомные «схемы» с именами проектов.',
      '• <b>Фикс</b>: добавлен <code>_isStorageProject(p)</code> фильтр — исключает project-контейнеры (<code>id startsWith p_/s_</code> или <code>kind === \'full\'/\'sketch\'</code>); оставляет Storage-схемы (<code>lp_*</code>, <code>scheme/memberUids/ownerEmail</code>). Применён в <code>listMyProjects</code>.',
      '• <b>Эффект</b>: после Ctrl+F5 на «Мои схемы» — фантомные карточки с именами проектов исчезнут из «Без проекта». Останутся только реальные Storage-схемы. Удаление проектов больше не идёт через эти карточки (раньше было опасно — клик «Удалить» на p_xxx-карточке мог потенциально нарушить project-storage).',
      'Файлы: <code>js/projects.js</code> — добавлен <code>_isStorageProject</code>, применён в Local.listMyProjects.',
    ] },
    { version: '0.59.517', date: '2026-04-27', items: [
      '🩹 <b>Fix: orphan-схемы теперь привязываются к проектам авто-матически на КАЖДОМ открытии «Мои схемы»</b>. По репорту пользователя: на главной всё ещё «Без проекта · 5 схем» с именами «Проект по умолчанию», «25006_TBC Bank», «Тестовый проект», «25013_Qarmet Темиртау», «Запрос 26005» — несмотря на 2 предыдущих bump флага.',
      '• <b>Корень проблемы</b>: миграция управлялась флагом <code>raschet.scheme-orphan-migration.v2</code> — запускалась один раз на сессию. Если флаг был выставлен ДО того, как заработала логика match-by-name (или появлялись новые orphan-схемы между сессиями) — миграция уже не возвращалась к проблемным записям.',
      '• <b>Fix</b>: флаг полностью убран. Миграция идемпотентна (для уже-привязанных схем — early skip; для orphan — link by name) и дёшева (пара сотен ms на самой большой LS). Теперь запускается на каждом <code>refreshProjects()</code> на «Мои схемы» и при заходе на <code>/projects/</code>. Self-healing: новые orphan-схемы (от импорта, ручного создания через Storage напрямую и т.п.) подхватываются автоматически.',
      'Файлы: <code>shared/scheme-orphan-migration.js</code> — убрана проверка флага и его установка.',
    ] },
    { version: '0.59.516', date: '2026-04-27', items: [
      '🔗 <b>scs-config читает racks из POR (в дополнение к legacy)</b>. По плану Phase 2.5: scs-config теперь видит стойки, которые добавлены через engine mirror, POR Playground или другие POR-aware модули — без необходимости миграции данных в legacy LS-формат.',
      '• <b>Источники объединяются</b> в <code>loadRacks()</code>:',
      '  ⚬ Legacy: <code>loadAllRacksForActiveProject()</code> (rack-config templates + project-scoped instances).',
      '  ⚬ POR: <code>getObjects(pid, {type:\'rack\'})</code>.',
      '• <b>Дедуп по id</b>: если POR-объект имеет <code>legacyRackId</code> (после миграции), он совпадает с id legacy-копии — POR-копия пропускается, legacy остаётся (т.к. он отрисовывается в UI с pdu/accessories).',
      '• <b>POR-only racks</b> (созданные в playground / engine mirror без legacy) добавляются в список с маркером <code>_source: \'por\'</code> и id из <code>legacyRackId || por.id</code>.',
      '• <b>Конвертер</b> POR → scs-config: <code>{id, name, manufacturer, tag, u, width, depth, demandKw, cosphi, phases}</code> заполняется из <code>domains.mechanical/electrical</code>.',
      '• <b>Эффект</b>: 10 racks Kehua (SR01-08, CR01, MR01) в Qarmet после переноса (v0.59.514) теперь видны в СКС-модуле проекта 25013_Qarmet Темиртау. Pdu/accessories пока пустые (будут наполняться через scs-config UI).',
      'Файлы: <code>scs-config/scs-config.js</code> — импорт <code>getObjects</code> из <code>shared/por.js</code>, новый <code>_porRackToScsRack</code>, расширенный <code>loadRacks()</code>.',
    ] },
    { version: '0.59.515', date: '2026-04-27', items: [
      '🔄 <b>scs-config: dropdown переключения проекта прямо в шапке</b>. По вопросу пользователя «как изменить проект для СКС?». Раньше можно было только через ссылку «сменить →» в <code>/projects/</code> — выбрать другой проект и снова перейти в СКС. Теперь:',
      '• <b>Select со всеми full-проектами</b> (sketch-проекты исключены) в шапке scs-config. Активный проект — первым в списке.',
      '• <b>onChange → location.href</b> с новым <code>?project=&lt;pid&gt;&from=scs-config</code> — модуль перезагружается с новым контекстом.',
      '• Сортировка остальных проектов по <code>updatedAt</code> desc — недавние сверху.',
      '• Если ни один проект не активен — добавляется опция «— выбрать проект —».',
      'Файлы: <code>scs-config/scs-config.js</code> — переписан <code>renderProjectBadge()</code>: теперь рендерит <code>&lt;select id="sc-project-switch"&gt;</code> с привязанным change-handler.',
    ] },
    { version: '0.59.514', date: '2026-04-27', items: [
      '📦 <b>POR Playground: «Перенести все POR-объекты в другой проект»</b>. По репорту пользователя: 10 чистых стоек (SR01-SR08, CR01, MR01) попали в orphan-проект <code>p_k0w4rpc0en</code> (без имени), а нужно чтобы они принадлежали <code>p_tyux2vnmz4</code> (25013_Qarmet Темиртау).',
      '• <b>Новый блок в секции «Контекст»</b>: поле «целевой pid» (с datalist autocomplete) + кнопка «📦 Перенести».',
      '• <b>Логика</b>: copy-then-delete — для каждого POR-объекта в источнике делает <code>addObject(target, obj)</code> (upsert по id, дубликаты перезаписываются) → <code>removeObject(source, obj.id)</code>. После операции UI автоматически переключается на target.',
      '• <b>Confirm</b> с числом объектов до выполнения. <b>Лог</b>: <code>moved N POR-объектов из source → target</code>.',
      '• <b>Use case</b>: 10 racks из orphan-проекта в Qarmet — введи p_tyux2vnmz4 в поле, нажми «Перенести» → подтверди → racks теперь в Qarmet.',
      'Файлы: <code>dev/por-playground.html</code> — UI блок + handler.',
    ] },
    { version: '0.59.513', date: '2026-04-27', items: [
      '🪞 <b>Engine mirror расширен на consumer-system типы</b> (lighting / pipe-heating / plinth-heating / ventilation / outlets / heater / snow-melting). Раньше зеркалировались только rack-узлы. Теперь:',
      '• <b>Маппинг engine consumer-узла → POR</b>:',
      '  ⚬ <code>subtype=\'rack\'</code> → POR <code>type=\'rack\'</code> (как раньше).',
      '  ⚬ <code>subtype=\'lighting\'</code> → POR <code>type=\'consumer-system\'</code>, <code>subtype=\'lighting\'</code>.',
      '  ⚬ <code>subtype=\'pipe-heating\'</code> / <code>plinth-heating</code> / <code>heater</code> → consumer-system, subtype соответствующий.',
      '  ⚬ <code>subtype=\'ventilation\'</code> / <code>outlets</code> / <code>snow-melting</code> → consumer-system.',
      '  ⚬ Прочее (motor, generic) — пока не зеркалируется.',
      '• <b>Domain mirror</b>:',
      '  ⚬ <code>electrical</code> для всех типов: tag, name, demandKw, cosPhi, phases, voltageV.',
      '  ⚬ <code>mechanical</code> только для rack — у систем нет habarit.',
      '• <b>Console</b>: <code>activated for pid=X (rack-узлов: N, систем: M)</code>; на каждый создаваемый объект — <code>created POR consumer-system/lighting por_xxx for engine node nNN</code>.',
      '🎯 <b>Сценарий end-to-end</b>: технолог в engine добавляет узел consumer subtype=lighting → mirror создаёт POR <code>consumer-system</code> с <code>domains.electrical.demandKw</code>. SCS-инженер / климат-инженер открывает POR Playground → видит «💡 Освещение» в списке проекта (фильтр type=consumer-system). Каждый домен может править свой инженер; в инспекторе будет видно владельца и время правки (<code>ownerByDomain</code>).',
      'Файлы: <code>shared/engine-por-mirror.js</code> (новые helper\'ы _porMapping/buildSystemPartialFromNode, обобщённый syncEngineToPOR, mapping-aware patchPorFromNode).',
    ] },
    { version: '0.59.512', date: '2026-04-27', items: [
      '🚑 <b>Fix критичные баги в deduplicateProjectRacks</b> (по репорту: «дубликаты не удаляются»).',
      '• <b>Bug 1</b>: <code>removeObject</code> не импортировался из <code>./por.js</code> в <code>shared/legacy-rack-migration.js</code> — функция была недоступна.',
      '• <b>Bug 2</b>: мёртвая строка <code>const { removeObject } = (typeof require === \'function\') ? null : require(\'./por.js\') || {};</code> выкидывала <code>ReferenceError: require is not defined</code> в браузере → функция падала ДО цикла удаления, ничего не делая.',
      '• <b>Fix</b>: убрал мёртвую require-строку, добавил <code>removeObject</code> в import. Теперь dedup действительно вызывает <code>removeObject(pid, id)</code> для каждого дубликата и возвращает реальный счётчик.',
      'Файлы: <code>shared/legacy-rack-migration.js</code>.',
    ] },
    { version: '0.59.511', date: '2026-04-27', items: [
      '🧽 <b>Fix: dedup при каждом bootstrapProject</b>. По репорту пользователя: «каждый клик на ссылке проекта в playground добавляет новую стойку». Корень: <code>bootstrapProject(pid)</code> запускал <code>migrateProjectLegacyRacks(pid)</code>, но НЕ запускал <code>deduplicateProjectRacks(pid)</code>. Auto-dedup был только в <code>migrateAllLegacyRacks</code> из <code>refreshProjects</code> на главной. Если пользователь сразу заходил в playground (минуя главную) — оставшиеся дубликаты от старой v2-миграции с недетерминистическими id никогда не схлапывались.',
      '• <b>Fix</b>: в <code>shared/project-bootstrap.js::bootstrapProject</code> после migrateProjectLegacyRacks теперь всегда вызывается deduplicateProjectRacks. Идемпотентно (если дубликатов нет — не делает ничего).',
      '• <b>Console</b>: <code>[bootstrap] pid=p_xxx: legacy migrated +N ~M, dedup removed K</code>.',
      'Файлы: <code>shared/project-bootstrap.js</code>.',
    ] },
    { version: '0.59.510', date: '2026-04-27', items: [
      '🐛 <b>Fix: POR-дубликаты после legacy-миграции стоек</b>. По репорту пользователя: в playground вместо ~6 уникальных стоек проекта показано 42 (A-01 × 6, DH1.SR1 × 6, DH1.SR2 × 3 и т.д.).',
      '• <b>Корень бага</b>: в <code>shared/por.js::addObject</code> поле <code>legacyRackId</code> терялось при <code>_ensureObjectShape</code> (whitelist top-level полей). Поэтому повторный запуск миграции не находил существующий POR-объект по <code>legacyRackId</code> и создавал ещё одну запись.',
      '• <b>Fix 1 (addObject)</b>: extra top-level fields из <code>partial</code> passthrough — для legacy-маркеров (legacyRackId, legacySource), groupId-link\'ов и любых дополнительных меток без нужды расширять whitelist. Также addObject стал upsert: если объект с тем же id уже существует — сохраняем createdBy/At, обновляем updatedBy/At, эмитим <code>patch</code>-event.',
      '• <b>Fix 2 (legacy-rack-migration)</b>: переход на <b>детерминистические POR-id</b> вида <code>por_legacy_&lt;rackId&gt;</code>. Повторный запуск миграции upsert-перезаписывает существующие записи вместо создания дубликатов. Флаг bumped v2→v3 — у всех пользователей с уже-выставленным v2 миграция запускается заново с правильными ids. Новая <code>migrateAllLegacyRacks</code> возвращает <code>{created, updated, dedupRemoved}</code>.',
      '• <b>Fix 3 (auto-dedup)</b>: новая функция <code>deduplicateProjectRacks(pid)</code> группирует POR-объекты type=\'rack\' по (tag, demandKw, widthMm, depthMm, rackUnits) и оставляет один на группу (приоритет: id с префиксом <code>por_legacy_</code>, иначе самый старый). Запускается автоматически после <code>migrateAllLegacyRacks</code> для всех проектов.',
      '🔗 <b>Bump scheme-orphan-migration флаг v1→v2</b>. По репорту: после v0.59.507 у пользователя всё ещё «Без проекта · 5 схем» с именами совпадающими с проектами. Возможная причина — флаг v1 был выставлен раньше с пустым результатом. Bump v2 принудит повтор; логика matched-by-name теперь точно отработает.',
      '🪟 <b>Playground: фильтр по типу</b>. Раньше показывались только <code>type=\'rack\'</code> через rack-config adapter. Теперь dropdown «Тип» (rack / consumer-system / consumer-group / site / building / floor / space / все). Для не-rack типов используется <code>getObjects(pid, {type})</code> напрямую. Колонка <b>Type</b> добавлена в таблицу.',
      '🧹 <b>Playground: кнопка «🧹 Удалить дубликаты»</b>. Запускает <code>deduplicateProjectRacks(pid)</code> для текущего проекта, в логе показывает kept/removed/groups.',
      'Файлы: <code>shared/por.js</code> (addObject upsert + extra-fields passthrough), <code>shared/legacy-rack-migration.js</code> (deterministic ids + dedup + флаг v3), <code>shared/scheme-orphan-migration.js</code> (флаг v2), <code>dev/por-playground.html</code> (filter-type, cleanup-dups).',
    ] },
    { version: '0.59.509', date: '2026-04-27', items: [
      '🔗 <b>Ссылка на POR Playground в каталоге модулей</b>. Добавлена новая секция «🔧 Инструменты разработки» в <code>modules/index.html</code> с карточкой <code>🏗 POR Playground</code> (тег <span style="background:#fee2e2;color:#991b1b;padding:1px 7px;border-radius:8px;font-size:11px">dev</span>). Описание объясняет назначение: просмотр POR-объектов проекта, cross-tab sync, экспорт/импорт, группировка. Раньше playground был доступен только по прямой ссылке, теперь — через hub → «Модули» → секция dev.',
      'Файлы: <code>modules/index.html</code> (новая секция + tag.dev стиль).',
    ] },
    { version: '0.59.508', date: '2026-04-27', items: [
      '🏗 <b>Миграция legacy rack-instances → POR</b>. По репорту пользователя: бейджик «8 стоек» на карточке проекта показывал данные, но в самом СКС-модуле «legacy режим, ничего нет». Это потому что разные модули читают РАЗНЫЕ LS-ключи. POR должен стать единым источником.',
      '• <b>Источники миграции (<code>shared/legacy-rack-migration.js</code>)</b>:',
      '  ⚬ <code>raschet.project.&lt;pid&gt;.rack-config.instances.v1</code> — главный источник instance-данных (имя, U, габариты, demandKw).',
      '  ⚬ <code>raschet.project.&lt;pid&gt;.scs-config.rackTags.v1</code> — пары <code>rackId→tag</code>.',
      '  ⚬ <code>raschet.project.&lt;pid&gt;.scs-config.contents.v1</code> — стойки с содержимым (если их нет в instances — добавляются как tag-only).',
      '• <b>Дедупликация</b>: каждый POR-объект type=\'rack\' хранит <code>legacyRackId</code> и <code>legacySource</code>. Повторный запуск миграции пропускает уже мигрированные.',
      '• <b>Триггер</b>: при <code>refreshProjects</code> на главной «Мои схемы» (одиночный сессия-флаг <code>raschet.legacy-rack-migration.v2</code>) и при каждом <code>bootstrapProject(pid)</code> для конкретного pid (per-project дедуп).',
      '• <b>Console</b>: <code>[legacy-rack-migration] pid=p_xxx rack INST_xxx (TAG) → POR por_yyy</code> на каждый созданный объект. Принудительный re-run: <code>RaschetLegacyRackMigration.runAll({force:true})</code>.',
      '• <b>Эффект для пользователя</b>: после загрузки v0.59.508, открой POR Playground для проекта — твои 8 стоек должны появиться. Открой POR Playground для «Тестового проекта» (<code>?project=p_jhd9c9n0qh</code>) → должно быть 8 строк в таблице.',
      'Файлы: <code>shared/legacy-rack-migration.js</code> (новый, ~180 строк), <code>js/main.js</code> (вызов из refreshProjects + flash), <code>shared/project-bootstrap.js</code> (per-project миграция).',
    ] },
    { version: '0.59.507', date: '2026-04-27', items: [
      '🔗 <b>Авто-миграция orphan-схем</b>. По репорту пользователя на главной «Мои схемы»: 7 схем висели в группе «Без проекта» — с именами совпадающими с существующими проектами («Проект по умолчанию», «25006_TBC Bank», «Тестовый проект» и т.д.). Раньше каждая такая схема показывалась как отдельный orphan, требовала ручной привязки.',
      '• <b>Стратегия миграции (<code>shared/scheme-orphan-migration.js</code>)</b>:',
      '  ⚬ для каждой schema без <code>projectId</code> — нормализуем имя (trim/lowercase/collapse spaces) и ищем project-контейнер с тем же именем;',
      '  ⚬ если найден — линкуем (matched);',
      '  ⚬ иначе — создаём новый контейнер с этим именем (created).',
      '• <b>Запуск</b>: триггерится при первом заходе на главную «Мои схемы» (<code>refreshProjects()</code>) или на <code>/projects/</code>. Один раз через LS-флаг <code>raschet.scheme-orphan-migration.v1</code>. Toast пользователю с результатами.',
      '• <b>Console</b>: <code>[orphan-migration] scheme lp_xxx «Имя» → СУЩЕСТВУЮЩИЙ контейнер p_yyy</code> на каждую миграцию. Принудительный re-run: <code>RaschetSchemeMigration.run({force:true})</code>.',
      '• Не зовём <code>Storage.saveProject</code> (требует window.Storage init); подменяем <code>scheme.projectId</code> напрямую в <code>raschet.projects.v1</code>.',
      'Файлы: <code>shared/scheme-orphan-migration.js</code> (новый), <code>js/main.js</code> (вызов из <code>refreshProjects</code>), <code>projects/projects.js</code> (вызов на module-load).',
    ] },
    { version: '0.59.506', date: '2026-04-27', items: [
      '🧹 <b>Fix: схемы внутри проекта больше не дублируются как top-level проекты в <code>/projects/</code></b>. По репорту пользователя: создал «Схема S1» через «+ Добавить → Схема» внутри «Тестового проекта» — она появилась И как scheme внутри проекта, И как отдельный top-level проект «S1» в общем списке. Это вносило путаницу.',
      '• <b>Причина</b>: Storage-схемы (созданные через <code>window.Storage.createProject</code>, id <code>lp_*</code>, поля <code>scheme/memberUids/ownerId</code>) делят с project-контейнерами (<code>p_*</code>/<code>s_*</code>) одну LS-таблицу <code>raschet.projects.v1</code>. Фильтр в <code>/projects/</code> рендере отсекал только sketch-проекты, но не Storage-схемы.',
      '• <b>Fix</b>: фильтр расширен — записи с <code>id.startsWith(\'lp_\')</code> или с полями <code>scheme/memberUids</code> исключаются из общего списка. Они по-прежнему видны ТОЛЬКО внутри родительского проект-контейнера (Карточка проекта → раздел «Схемы»).',
      '⏳ <b>TODO следующим приходом</b>: engine-por-mirror зеркалирует только rack-узлы (<code>type=\'consumer\' && subtype=\'rack\'</code>). Расширить на все consumer-подтипы — hvac/lighting/motor/heater будут попадать в POR как <code>consumer-system</code>-объекты (subtype=lighting/ventilation/etc). Также — миграция старых rack-instances из <code>scs-config/contents.v1</code> и <code>rack-config/instances.v1</code> в POR (чтобы 8 стоек в существующих проектах появились в POR без необходимости пересоздавать).',
      'Файлы: <code>projects/projects.js</code> (расширенный filter в <code>render()</code>).',
    ] },
    { version: '0.59.505', date: '2026-04-27', items: [
      '🛠 <b>Phase 2.5 PoC: фиксы по результату первой проверки.</b>',
      '🎯 <b>Fix: POR pid теперь = id ПРОЕКТА-КОНТЕЙНЕРА, не отдельной схемы.</b> Раньше bootstrap получал <code>data.id</code> (scheme.id, например <code>lp_xxx</code>), из-за чего разные схемы одного проекта-контейнера НЕ шарили POR-объекты — каждая жила в своём <code>raschet.project.lp_xxx.por.objects.v1</code>. Теперь main.js резолвит <code>data.projectId || data.id</code>: если scheme привязана к project-контейнеру (через <code>+ Схема</code> внутри проекта) — используется <code>p_xxx</code> (контекст), все схемы одного проекта шарят POR. Fallback на scheme.id для отдельных/legacy схем.',
      '🏗 <b>Кнопка «🏗 POR» в шапке engine</b>: открывает POR Playground в новой вкладке с уже подставленным pid текущего проекта. Скрыта когда проект не загружен. Решает проблему «нужно вручную копировать pid из URL в playground».',
      '🔎 <b>Playground auto-discover проектов</b>: при загрузке (и по кнопке «🔎 Найти проекты») сканирует localStorage на ключи <code>raschet.project.&lt;pid&gt;.por.objects.v1</code> и <code>raschet.projects.v1</code>, собирает список найденных pid с метками (🏗 POR, ⚡ scheme), числом POR-объектов и именем проекта. Показывается списком кликабельных ссылок + datalist autocomplete в поле ввода. Bug-fix: ключ был указан как <code>raschet.projects.local.v1</code> (несуществующий), правильный — <code>raschet.projects.v1</code>.',
      '🎤 <b>Engine mirror: console diagnostics</b>. <code>console.info()</code> при активации (с числом rack-узлов) и при создании каждого POR-объекта. <code>console.debug()</code> со счётчиками <code>+created ~updated</code> на каждом sync. Помогает в DevTools убедиться что mirror работает.',
      'Файлы: <code>js/main.js</code> (porPid resolution + btnPorDebug handler), <code>index.html</code> (btn-por-debug), <code>shared/engine-por-mirror.js</code> (diagnostics), <code>dev/por-playground.html</code> (auto-discover + datalist + LS-key fix).',
    ] },
    { version: '0.59.504', date: '2026-04-27', items: [
      '🪞 <b>Phase 2.5 PoC: первая реальная интеграция — Engine ↔ POR mirror.</b> Стойки, добавленные в принципиальную схему (consumer-узлы с subtype=\'rack\'), теперь автоматически зеркалируются в POR-объекты type=\'rack\' с доменами <code>electrical</code> + <code>mechanical</code>. Зеркалирование двустороннее.',
      '• <b>Engine → POR</b>: на каждое <code>notifyChange()</code> рефлекс mirror проходит rack-узлы, создаёт POR-объект если не было (с записью <code>n.porObjectId</code>) или обновляет существующий (tag/name/demandKw/cosPhi/phases/voltageV/widthMm/depthMm/heightMm/rackUnits).',
      '• <b>POR → Engine</b>: подписка на <code>por.subscribe(pid)</code>. Когда POR-объект меняется в другой вкладке (или из POR Playground / rack-config / scs-config) — engine-узел получает обновление. Защита от рекурсии через <code>_suppressSync</code>.',
      '• <b>POR → Engine на cross-tab \'sync\' event</b>: refresh всех связанных узлов из текущего POR-store.',
      '🔌 <b>Multi-listener change events в engine</b>: <code>state.js</code> расширен — раньше был один <code>setChangeCb</code> (использовался main.js для autosave), теперь добавлен <code>addChangeListener(cb)</code> — отдельный список для дополнительных подписчиков (POR-mirror, плагины). <code>notifyChange()</code> вызывает оба механизма. Backwards-compat сохранён.',
      '🚀 <b>Auto-bootstrap из main.js</b>: при загрузке проекта (<code>state.currentProject = data</code>) вызывается <code>bootstrapProject(pid)</code> — регистрирует POR-adapter\'ы для rack-config / scs-config / suppression-config и активирует engine-mirror. Конфигуратор НЕ знает про этот вызов — main.js (entry-page для проекта) управляет.',
      '🎯 <b>Демо сценарий end-to-end</b>: открыть проект в engine → создать consumer-узел с subtype=\'rack\' → задать demandKw=5 → открыть POR Playground в новой вкладке с тем же ?project= → стойка отображается с теми же параметрами. Изменить kW в playground → значение обновится в engine-инспекторе.',
      'Файлы: <code>js/engine/state.js</code> (multi-listener), <code>js/engine/history.js</code> (notifyChange вызывает listeners), <code>shared/engine-por-mirror.js</code> (новый, ~190 строк), <code>shared/project-bootstrap.js</code> (lazy-импорт mirror), <code>js/main.js</code> (вызов bootstrapProject).',
    ] },
    { version: '0.59.503', date: '2026-04-27', items: [
      '🧪 <b>POR Playground (<code>dev/por-playground.html</code>)</b> — интерактивная страница для проверки Phase 2.5 PoC end-to-end. Демонстрирует:',
      '• Standalone vs project mode (бейдж сверху). Switch by вводу Project ID.',
      '• Добавление стоек через DataAdapter (<code>getAdapter(\'rack-config\').add</code>).',
      '• Cross-tab sync: открой две вкладки с одинаковым ?project= → правки видны в обеих автоматически.',
      '• Группировка отмеченных (consumer-group composed) + анонимная группа (count+demandKwPerUnit, без членов).',
      '• Live-stream событий от <code>adapter.subscribe()</code>.',
      '📁 <b>Export / Import в файл</b> (по уточнению пользователя «конфигураторы должны уметь сохранять в пространство пользователя и в/из файловой системы»):',
      '• Generic helper\'ы в <code>shared/data-adapter.js</code>: <code>exportAdapter(adapter, moduleId, filter?)</code> → JSON, <code>downloadExport(obj, fname)</code> → скачивание <code>.json</code>, <code>readExportFile(file)</code> → Promise<exportObj>, <code>importIntoAdapter(adapter, exportObj, mode)</code> с режимами <code>merge</code> (upsert по id), <code>append</code> (новые id), <code>replace</code> (стереть + добавить).',
      '• Работают с ЛЮБЫМ DataAdapter (LS / POR / memory) — конфигуратор не знает откуда данные.',
      '• Format: <code>{schemaVersion, module, exportedAt, items[]}</code>.',
      '🪛 <b>Status</b>: foundation Phase 2.5 PoC завершён. Pattern проверен на playground: standalone/project/sync/groups/import/export — всё работает. Следующая итерация: миграция первого реального конфигуратора (rack-config) на DataAdapter.',
      'Файлы: <code>dev/por-playground.html</code> (новый, ~280 строк), <code>shared/data-adapter.js</code> (расширен export/import API).',
    ] },
    { version: '0.59.502', date: '2026-04-27', items: [
      '💡 <b>POR type \'consumer-system\' — распределённые системы без габарита.</b> По уточнению пользователя: у электрика есть потребители-системы, которые НЕ имеют geometric footprint, но должны учитываться по нагрузке. Примеры: освещение (множество ламп распределены), розеточная сеть (N розеток на пространстве), обогрев трубопроводов (нагревательный кабель вдоль линии).',
      '• <b>Без mechanical-домена</b> (защищает от попыток ввести «габариты системы освещения»). По умолчанию домены: <code>electrical</code> + <code>location</code>.',
      '• <b>Subtypes</b>: <code>lighting</code> / <code>outlets</code> / <code>pipe-heating</code> / <code>snow-melting</code> / <code>ventilation</code> / <code>plinth-heating</code> / <code>custom</code>. Каждый подтип имеет свой icon и свою structure в <code>composition</code>:',
      '  ⚬ lighting: { unitCount, unitPowerW, lampType }',
      '  ⚬ outlets: { outletCount, outletRatedA, outletType }',
      '  ⚬ pipe-heating: { lengthM, powerPerMeterW, cableType, mediumTempC }',
      '  ⚬ snow-melting: { areaM2, powerPerM2W }',
      '  ⚬ ventilation: { fanCount, fanPowerKw, controlKind }',
      '• <b>location.spaces[]</b> — массив пространств (система может быть распределена по нескольким помещениям, в отличие от одного <code>spaceId</code> у rack/panel).',
      '• <b>kSim</b> — коэф. одновременности (для расчёта пиковой нагрузки от composition).',
      '• <b>Helper</b>: <code>calcSystemDemandFromComposition(comp, subtype)</code> — авто-вычисление demandKw из composition (lighting = unitCount × unitPowerW / 1000 и т.п.).',
      '• <b>Группировка</b>: consumer-system наследует <code>groupElectricalKeys</code> — электрик может объединить «8 одинаковых систем освещения на 8 этажах» в consumer-group.',
      '🏷 <b>POR_TYPE_CATEGORIES</b>: добавлена категория \'system\' (наряду с equipment / container / aggregator / connector). Helper <code>listPorTypesByCategory(\'system\')</code> для UI-палитр.',
      'Файлы: <code>shared/por-types/consumer-system.js</code> (новый), <code>shared/por-types/index.js</code> (регистрация + categories).',
    ] },
    { version: '0.59.501', date: '2026-04-27', items: [
      '🏗 <b>Phase 2.5 PoC: расширение POR — registry-pattern + ports + DataAdapter contract + project-bootstrap.</b> Большой шаг согласно ТЗ пользователя: «данные проекта лежат только в проекте, конфигураторы не знают о проектах».',
      '🧩 <b>POR Types Registry (<code>shared/por-types/</code>)</b>: каждый тип объекта в отдельном модуле, регистрируется через <code>registerPorType(typeDef)</code>. Расширяется без правки ядра. PoC-типы:',
      '• <code>rack.js</code> — серверная стойка (mechanical/scs/electrical/location).',
      '• <code>containers.js</code> — site/building/floor/space (location-иерархия). Любой объект может ссылаться через <code>domains.location.{siteId,buildingId,floorId,spaceId}</code>.',
      '• <code>consumer-group.js</code> — группа для электрика. Поддерживает 2 режима: composed (явные члены) и anonymous (только count+demandKwPerUnit, члены материализуются позже SCS-инженером). API: <code>materializeGroupSlot</code>, <code>materializeAllSlots</code> — превращают анонимные слоты в реальные POR-объекты.',
      '🔌 <b>Ports API</b>: любой объект может иметь порты в любом домене — электрические (power-in/out, control), СКС (rj45/sfp/fiber), механические (pipe-in/out с диаметром, средой, resistanceCoeff), HVAC (refrigerant-suction/discharge), АГПТ (agent-in/nozzle-out). Будущий гидравлический расчёт читает porty из domains.mechanical/hvac. API: <code>addPort/removePort/patchPort/listAllPorts</code>.',
      '📍 <b>domains.location как универсальный домен</b>: добавлен в POR_DOMAINS. Этажи, здания, помещения — для любого объекта, не только в layout-страницы engine.',
      '🪛 <b>DataAdapter contract (<code>shared/data-adapter.js</code>)</b>: разрывает связь конфигураторов с проектным слоем. Конфигуратор импортирует ТОЛЬКО data-adapter.js, вызывает <code>getAdapter(moduleId).list/add/update/remove/subscribe</code>. Не знает откуда данные. API: <code>registerDefaultAdapterFactory</code> (для standalone), <code>setAdapter</code>/<code>clearAdapter</code> (для project-bootstrap), <code>onAdapterChange</code> (для перерисовки UI). Реализации: <code>createMemoryAdapter</code>, <code>createLSAdapter(lsKey)</code>.',
      '🌉 <b>POR adapters (<code>shared/por-adapters.js</code>)</b>: <code>createPorAdapter(pid, type, opts)</code> — adapter для одного POR-type, <code>createPorDomainAdapter(pid, domain)</code> — adapter для всех объектов с указанным доменом (для SCS-инженера, который видит racks+outlets+patch-panels одним списком).',
      '🚀 <b>Project bootstrap (<code>shared/project-bootstrap.js</code>)</b>: <code>bootstrapProject(pid)</code> вызывается entry-страницей ПЕРЕД загрузкой конфигуратора, регистрирует POR-backed adapter\'ы для всех известных moduleId (rack-config, scs-config-racks, scs-config-all, suppression-config-zones). Конфигуратор НЕ знает про этот файл.',
      '🚧 <b>Status</b>: foundation готов, конфигураторы пока не мигрированы (продолжают работать через project-storage напрямую). Следующая итерация: rack-config переезжает на DataAdapter — proves end-to-end.',
      'Файлы: <code>shared/por.js</code> (slim core), <code>shared/por-types/_helpers.js</code> + <code>rack.js</code> + <code>containers.js</code> + <code>consumer-group.js</code> + <code>index.js</code> (новые), <code>shared/data-adapter.js</code> + <code>shared/por-adapters.js</code> + <code>shared/project-bootstrap.js</code> (новые).',
    ] },
    { version: '0.59.500', date: '2026-04-27', items: [
      '🏗 <b>Phase 2.5 PoC (роадмап): фундамент Project Object Registry (POR).</b> Новый модуль <code>shared/por.js</code> — единый реестр проектных объектов с многодоменными атрибутами и многостраничными видами. Идея: вместо «каждый модуль хранит свои объекты» — один POR-record на сущность, у которого есть <code>domains[domain]</code> (electrical/scs/mechanical/hvac/…) и <code>views[pageKind]</code> (schematic/layout/data/…).',
      '• <b>API</b>: <code>getObjects(pid, filter?)</code>, <code>getObject(pid, oid)</code>, <code>addObject(pid, partial)</code>, <code>patchObject(pid, oid, patch, opts)</code> где opts={domain|view}, <code>removeObject(pid, oid)</code>, <code>findByTag(pid, tag)</code>, <code>subscribe(pid, cb)</code>.',
      '• <b>Pubsub</b>: in-tab Map<pid, Set<cb>> + cross-tab через <code>storage</code>-event. Открыты engine + rack-config + scs-config в разных вкладках одного браузера → синхронизируются автоматически.',
      '• <b>Storage</b>: <code>raschet.project.&lt;pid&gt;.por.objects.v1</code> через существующий <code>projectKey()/projectLoad()/projectSave()</code>.',
      '• <b>Schema</b>: каждый объект — <code>{ id, type, subtype, tag, name, manufacturer, model, serialNo, assetId, domains:{…}, views:{…}, ownerByDomain:{…}, createdBy/At, updatedBy/At, schemaVersion }</code>. Доменные factory: <code>createRackPartial(opts)</code> для <code>type=\'rack\'</code> (PoC).',
      '• <b>Известные домены (POR_DOMAINS)</b>: electrical / scs / mechanical / hvac / suppression / logistics. UI-метаданные в <code>POR_DOMAIN_META</code> (label/icon/color).',
      '• <b>Группы для электрика (type=\'consumer-group\')</b>: электрик может объединять несколько одинаковых по электрике объектов (стойки, кондеи) в один групповой узел на принципиалке (бейдж «×N»), при этом SCS-инженер по-прежнему видит каждый объект отдельной строкой — данные не размываются. API: <code>canGroupTogether(a, b)</code>, <code>createGroup(pid, members, opts)</code>, <code>addMemberToGroup(pid, gid, m)</code>, <code>removeMemberFromGroup(pid, gid, mid)</code>. Валидация по <code>GROUP_ELECTRICAL_KEYS</code> (phases, cosPhi, demandKw, voltageV) — строгое равенство, иначе reject. Группа автоматически распускается при удалении предпоследнего члена.',
      '• <b>Debug</b>: <code>window.RaschetPOR.*</code> для console-исследования.',
      'Файлы: <code>shared/por.js</code> (новый, ~440 строк). UI пока не подключён — следующие шаги PoC: адаптация rack-config / scs-config / engine.',
    ] },
    { version: '0.59.499', date: '2026-04-27', items: [
      '📐 <b>Phase 2.3 (роадмап): автоматическая расстановка новых элементов на layout-странице.</b> Раньше drop любого элемента из палитры на layout-страницу ставил его ровно туда, где была мышь — обычно «случайное» место поверх существующих или далеко от группы. Теперь:',
      '• На layout-странице drop-позиция <b>игнорируется</b>; новый элемент ставится в <b>staging-колонку слева</b> от уже размещённых.',
      '• <b>Якорь по X:</b> если есть «не-авто» (вручную размещённые) ноды на странице — staging.x = leftmost.x − newWidthMm − 200 мм. Если страница пустая или содержит только staging — продолжаем существующую staging-колонку. Совсем пустая страница → x=100 мм.',
      '• <b>Якорь по Y:</b> bottom самого нижнего staged-узла + 50 мм. Пустой staging → y=100 мм.',
      '• <b>Сброс флага при drag:</b> когда пользователь руками перетаскивает auto-placed узел, флаг <code>layoutAutoPlaced</code> сбрасывается — узел больше не занимает слот в staging-колонке, и следующий новый встанет в освободившееся место.',
      '• На schematic / mechanical / data / прочих kind работает как раньше (drop по позиции мыши).',
      'Файлы: <code>js/engine/interaction.js</code> — новая функция <code>_layoutAutoPlacePos(type, opts)</code>, drop-обработчик на svg, mouseup-обработчик (сброс флага). Размеры берутся из <code>getNodeGeometryMm</code> (depthMm как footprint).',
    ] },
    { version: '0.59.498', date: '2026-04-27', items: [
      '✅ <b>DKC Small Tower 1/3 + SMALL+ 6/10 + Modulys GP 25/100 — V_DC verified.</b> Использован <code>pdftotext</code> локально + найдены OEM-источники для DKC (DKC ребрендирует UPS других производителей).',
      '• <b>DKC Small Tower 1 kVA</b> (User Manual a696d39a, table 16): «Battery Voltage 24 V - 36 V» (2…3 × 12В VRLA в зависимости от backup-варианта standard/long). Раньше 24-28 — слишком узко.',
      '• <b>DKC Small Tower 3 kVA</b> (тот же manual): «Battery Voltage 72 V - 96 V» (6…8 × 12В VRLA). Существующее <b>72-96</b> совпадает с datasheet — только улучшен notes.',
      '• <b>DKC SMALL+ 6/10 kVA</b> = OEM <b>Legrand DAKER DK Plus</b> (LE09706AB): «Number of batteries: 20, Rated Battery Voltage: 240 Vdc». Operating window 20 × 12В VRLA = <b>200…288 VDC</b>. Раньше 192-240 — занижено по верхней границе.',
      '• <b>DKC Modulys GP 25/100</b> = OEM <b>Socomec Modulys GP UL</b> (Brochure DOC-214063USA): «Number of battery blocks (VRLA): from 18+18 to 24+24» (split bus). Operating range rail-to-rail = <b>360…691 VDC</b> (18+18 EoD до 24+24 float). Раньше 360-480 — покрывало только 18+18 конфигурацию.',
      '• Все 6 id добавлены в <code>shared/ups-verified.js</code>.',
      '• seedVersion 19→20 force-upsert.',
      '⏳ <b>Ещё не verified:</b> DKC TwinDom 20/40/80, Modulys XL 300 — datasheets не найдены в открытом доступе. Также Keor HP 100/200 ждёт per-model PDF.',
      'Файлы: <code>shared/catalogs/ups-dkc.js</code> (small-1k/3k/6k/10k + modulys-25k/100k full update), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.497', date: '2026-04-27', items: [
      '✅ <b>Legrand Keor LP 3 + HPE 400 + MOD 30 (→25) + MP 300 (→200) — V_DC verified.</b> Использован <code>pdftotext</code> локально на скачанных PDFs (Web-search snippets были недостаточны). Исправлены также два model-name discrepancy:',
      '• <b>Keor LP 3 kVA</b> (datasheet 310158): 72V ном., 6 × 12В VRLA, 36 ячеек. EoD 1.67 → float 2.40 VPC = <b>60…86 VDC</b>. Раньше 72-96 — превышало boost-предел VRLA.',
      '• <b>Keor HPE 400 kVA</b> (Tech Spec UPS-LGR-0120 + Data-sheet-Keor-HPE_200-250-300KVA): 360-372 cells × 12В VRLA (60-62 jars), float 812-840V, EoD 620-632V. Operating range = <b>620…840 VDC</b>. Brochure HPE 60-600: «Common Battery Kit» — battery system общая для всей серии. Раньше 432-540 — wildly off.',
      '• <b>Keor MOD 25 (id mod-30k)</b> (Tech Spec 38559-keor-mod-25kw): split bus +/-264V, 22 jars × 12В × 2 drawers per string = 44 jars (132 ячеек/рейл). Operating window rail-to-rail = <b>440…634 VDC</b>. Раньше 360-480 — занижено. Также: <b>real module power = 25 kW, не 30</b> (per Brochure_KeorMod-EN). Display name «Keor MOD 30» → «Keor MOD 25», capacityKva/Kw/moduleKwRated 30→25, moduleSlots 4→5, frameKw 120→125.',
      '• <b>Keor MP 200 (id mp-300k)</b> (Brochure Keor MP 60-200 kVA + UPS_LGR_0241_GB_AA): «Nominal battery voltage 432 Vdc ~ 600 Vdc» VRLA (или 512-614 Vdc Li-ion). Operating range = <b>432…600 VDC</b>. Раньше 432-540 — занижено по верхней границе. Также: <b>Keor MP серия — 60-200 kVA, не 300</b>. Display «Keor MP 300» → «Keor MP 200 kVA», capacityKva/Kw 300→200.',
      '• Все 4 id (id-ы сохранены) добавлены в <code>shared/ups-verified.js</code>.',
      '• seedVersion 18→19 force-upsert.',
      '⏳ <b>Ещё не verified:</b> Keor HP 100/200 — datasheet brochure не содержит explicit DC voltage table (только nominal kVA/kW и mechanical specs); per-model datasheet не найден в открытом доступе.',
      'Файлы: <code>shared/catalogs/ups-legrand.js</code> (lp-3k / hpe-400k / mod-30k full update / mp-300k full update), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.496', date: '2026-04-27', items: [
      '✅ <b>Legrand Keor S 6 / 10 + Keor T EVO 10 / 20 — V_DC окно verified + Fix модели.</b>',
      '🔤 <b>Rename Keor SP 6/10 → Keor S 6/10.</b> Раньше в каталоге значилось «Keor SP», но реальная серия — <b>Keor S</b> (3-6-10 kVA online double-conversion VFI-SS-111). Keor SP — это другая серия, line-interactive 600-2000 VA, у нас не используется. Id (<code>legrand-keor-sp-6k/10k</code>) сохранены для обратной совместимости — комментарий поясняет.',
      '• <b>Keor S 6 kVA</b> + <b>Keor S 10 kVA</b> (Brochure_KEOR_S_GB.pdf): 240 VDC ном., 20 × 12В VRLA. Operating window EoD 1.67 → float 2.40 VPC = <b>200…288 VDC</b>. Раньше 192-240 — было занижено.',
      '• <b>Keor T EVO 10 kVA</b> + <b>Keor T EVO 20 kVA</b> (Manual LE10507AD): конфигурируемая батарея 24…40 × 12В VRLA single-bus. Operating window <b>240…576 VDC</b> (24 jars EoD до 40 jars float). Раньше 240-360 — покрывало только 24-jar EoD до 30-jar float.',
      '• Все 4 id добавлены в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 17→18 force-upsert.',
      '⏳ <b>Ещё не verified:</b> Keor LP 3, HP 100/200, HPE 400, MOD 30, MP 300 — datasheet PDF не парсятся через web-search; нужны прямые ссылки или OCR. Оставлены с пометкой ⚠.',
      'Файлы: <code>shared/catalogs/ups-legrand.js</code> (sp-6k/10k rename + 240-576; tevo-10k/20k vdcMax → 576), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.495', date: '2026-04-27', items: [
      '✅ <b>Schneider Galaxy VX 750 / 1500 kVA — V_DC окно verified.</b> Раньше у обоих было 432-540 — это сужение под 36-jar конфигурацию, которая для Galaxy VX не стандартна. По datasheet «Galaxy VX 500-1500 kW Tech Spec 990-5783» Galaxy VX использует ту же battery system что у Galaxy VL:',
      '• <b>40 блоков</b>: 480V ном., float 545V.',
      '• <b>48 блоков</b>: 576V ном., float 654V.',
      '• EoD at full load = <b>384 VDC</b>. Operating range = <b>384-576 VDC</b>.',
      '• Battery system общая для всей серии Galaxy VX 500-1500 kW (различаются только числом power-модулей 250 кВт), окно одинаковое.',
      '• Записи добавлены в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 16→17 force-upsert.',
      'Файлы: <code>shared/catalogs/ups-schneider.js</code> (vx-750k / 1500k vdcMin/Max + notes), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.494', date: '2026-04-27', items: [
      '✅ <b>Schneider Galaxy VL 200 / 300 / 500 kW — V_DC окно verified.</b> Раньше у всех трёх было 384-480 — это покрывало только 40-block конфигурацию, не 48. По datasheet «Galaxy VL Tech Spec 990-91377 (IEC) / 990-91399 (UL)» Galaxy VL поддерживает обе конфигурации внешних АКБ:',
      '• <b>40 блоков</b>: 480V ном., float 545V, max boost 571V.',
      '• <b>48 блоков</b>: 576V ном., float 654V, max boost 685V.',
      '• EoD at full load = <b>384 VDC</b>. Operating range = <b>384-576 VDC</b> (covers both 40 и 48 block).',
      '• Battery system общая для всей серии Galaxy VL 200-500 kW (различаются только числом power-модулей 50 кВт), поэтому окно одинаковое для VL 200 / 300 / 500.',
      '• Записи добавлены в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 15→16 force-upsert.',
      'Файлы: <code>shared/catalogs/ups-schneider.js</code> (vl-200k / 300k / 500k vdcMax 480→576 + notes), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.493', date: '2026-04-27', items: [
      '✅ <b>Schneider Galaxy VS 10 / 20 kW — V_DC окно verified + Fix фаз у VS 10.</b> Раньше V_DC были сильно занижены (VS 10 = 192-240, VS 20 = 240-360) и VS 10 был помечен как 1ф — обе ошибки. По datasheet «Galaxy VS UPS for External Batteries Tech Spec 990-91141» (10-100 kW 400V):',
      '• <b>VS 10 kW</b> (GVSUPS10KB4HS): external battery <b>384-576 VDC</b> (32-48 × 12В VRLA), EoD 384V at full load, float ~545V. Phases: <b>3</b> (раньше 1 — ошибка; вся серия Galaxy VS 10-150 kW трёхфазная per Schneider product range 65772; вариант 208V имеет 1ф input через внутренний трансформатор, но система 3ф).',
      '• <b>VS 20 kW</b> (GVSUPS20KGS / B4HS): external battery <b>384-576 VDC</b>, EoD 384V. То же окно что у уже verified VS 40/60/100.',
      '• Записи добавлены в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 14→15 force-upsert.',
      'Файлы: <code>shared/catalogs/ups-schneider.js</code> (vs-10k phases 1→3 + vdcMin/Max + notes; vs-20k vdcMin/Max + notes), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.492', date: '2026-04-27', items: [
      '🎯 <b>Авто-оптимум: blockV всегда = пользовательскому выбору.</b> Раньше при отсутствии выбранной АКБ из каталога перебирались все варианты [2, 4, 6, 12] В, и в таблице «Топ N вариантов» строки с blockV ≠ выбранному засоряли результат (пример из скриншота: при выбранном 12В таблица содержала строки с 6/4/2 В).',
      '• Теперь <code>bvCandidates = [blockV]</code> — единственное значение из поля «Напряжение блока» или паспорта АКБ, если выбрана.',
      '• Сортировка trials упрощена: max endV → min totalBlocks (третий критерий «min blockV» убран — нерелевантен).',
      '• Hint-блок «Приоритет выбора» теперь явно сообщает: «blockV=12 В зафиксирован пользователем (поле «Напряжение блока»)».',
      'Файлы: <code>battery/battery-calc.js</code> — режим <code>auto</code> в <code>doCalc</code>.',
    ] },
    { version: '0.59.491', date: '2026-04-27', items: [
      '✅ <b>Eaton 9PX 6 / 11 kVA — V_DC окно verified.</b> Раньше у обеих моделей было записано 192-240 VDC — это смесь Lithium-варианта (9PX6K-L = 192V) и нома 11kVA. Для VRLA-конфигураций реальная картина другая:',
      '• <b>9PX 6000</b> (datasheet TD153001EN + EBM 9PXEBM180RT): внутренний пакет <b>15 × 12В VRLA</b>, 180V ном., 90 ячеек. Operating window EoD 1.67 → float 2.40 VPC = <b>150…216 VDC</b>.',
      '• <b>9PX 11000</b> (datasheet TD153002EN + EBM 9PXEBM240RT): внутренний пакет <b>20 × 12В VRLA</b>, 240V ном., 120 ячеек. Operating window EoD 1.67 → float 2.40 VPC = <b>200…288 VDC</b>.',
      '• Записи добавлены в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 13→14 force-upsert.',
      'Файлы: <code>shared/catalogs/ups-eaton.js</code> (eaton-9px-6k / 11k), <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.490', date: '2026-04-27', items: [
      '✅ <b>Schneider Galaxy VS 40 kW — V_DC окно verified.</b> 400V вариант GVSUPS40KHS: battery <b>384-480 VDC</b>. Раньше 360-480 estimate. Для 480V варианта (GVSUPS40KGS) — 480-576 VDC, отмечено в notes.',
      '• Запись добавлена в <code>shared/ups-verified.js</code> → green ✓ в Battery-calc.',
      '• seedVersion 12→13 force-upsert.',
      'Verified в preview: «Galaxy VS 40 kVA · 40 кВт · η=97% · V_DC 384…480 В ✓».',
    ] },
    { version: '0.59.489', date: '2026-04-27', items: [
      '🔧 <b>S³ в режиме «Автономия» — manual N/M + терминология модулей.</b> Раньше для S³ нельзя было задать конкретную сборку (N модулей × M шкафов) — алгоритм всегда брал максимум модулей и минимум шкафов по нагрузке. Теперь:',
      '• Поле «Блоков в цепочке (N)» → <b>«Модулей в шкафу (N)»</b> при выбранном S³-модуле.',
      '• Поле «Цепочек параллельно (M)» → <b>«Шкафов (M)»</b>.',
      '• <code>_doCalcS3()</code> читает manual N и M; если заданы — использует, иначе авто (max/min).',
      '✅ <b>Соответствие datasheet Kehua S³:</b> для UPS 200 кВт + 1 шкаф × 20 модулей S3M040 (по «Battery Configuration Table»: 10 min initial backup) — расчёт даёт ровно <b>10.00 мин</b> при invEff=100% (без учёта реальных потерь). С invEff=94% — 8.72 мин (с учётом потерь инвертора). Это нормальное расхождение между theoretical-табличными данными и реальным расчётом с учётом invEff.',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_doCalcS3()</code> autonomy ветка, <code>_applyBatteryLock()</code> dynamic labels.',
    ] },
    { version: '0.59.488', date: '2026-04-27', items: [
      '✅ <b>Eaton 93PS 8 / 20 kW — V_DC окно verified.</b> Datasheet 93PS 8-10 kW: internal battery 384V, external <b>336-480 VDC</b>. Серия 93PS 8-40 kW имеет одинаковое окно — то же что у уже verified 93PS 40.',
      '• Раньше 93PS 8 = 240-360, 93PS 20 = 360-480 (estimate). Теперь оба 336-480.',
      '• <code>shared/ups-verified.js</code>: добавлены <code>eaton-93ps-8k</code>, <code>eaton-93ps-20k</code>.',
      '• seedVersion 11→12 force-upsert.',
      'Verified в preview: 93PS 8 kW → V_DC 336…480 В ✓, 93PS 20 kW → V_DC 336…480 В ✓.',
    ] },
    { version: '0.59.487', date: '2026-04-27', items: [
      '🧹 <b>Финальная зачистка слова «химия» в UI.</b> Артефакты, которые ещё всплывали в отчёте PDF/print: «усреднённая модель, химия vrla» (две точки — buildBatteryReportBlocks и аналогичная функция для S³). Заменено на «усреднённая модель, тип АКБ: Свинцово-кислотные (VRLA/AGM)» через <code>chemLabel()</code>.',
      '• Также tooltip заблокированного селекта «Заблокировано — химия определена…» → «Заблокировано — тип АКБ определён…».',
      '• Комментарий в коде про автоматическое определение и подпись в /elements/ (createBatteryElement) — «химия» → «тип АКБ».',
      '🪟 <b>Единое окно превью S³ — UI продолжение:</b> состав ряда теперь СПРАВА, табы и превью слева. Кнопка «⛶ Развернуть» перенесена из 3D-тулбара в шапку табов — работает для активного вида (3D или 2D). Раньше 2D-вкладки нельзя было развернуть.',
      'Файлы: <code>battery/battery-calc.js</code>, <code>elements/index.html</code>, <code>shared/battery-types/s3-3d-view.js</code>.',
    ] },
    { version: '0.59.486', date: '2026-04-27', items: [
      '🎨 <b>Единое окно превью S³ с табами 3D / Сверху / Спереди / Сбоку.</b> Раньше было ДВА отдельных контейнера: 3D (слева) и 2D с собственными табами (справа). Это занимало много места и было запутанно.',
      '• <b>Левая колонка:</b> «Состав ряда» (Master / Slave / Combiner / габариты / площадь / объём) — фикс. ширина 240px.',
      '• <b>Правая колонка:</b> единое окно превью с переключателем-табами «3D / Сверху / Спереди / Сбоку» наверху. Один контейнер, переключение через display:none между wrap (canvas Three.js) и view2dBody (SVG).',
      '• Состав теперь рендерится один раз слева — не дублируется на каждом 2D-табе.',
      '• Кнопка «Развернуть» работает для активного вида (3D или 2D).',
      'Verified в preview: tabs={3D, Сверху, Спереди, Сбоку}, состав слева, превью справа.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code> — рестарктура mountS3ThreeDView.',
    ] },
    { version: '0.59.485', date: '2026-04-27', items: [
      '🐛 <b>Fix: auto-режим игнорировал поле «Целевая автономия» (auto-вариант).</b> В режиме «Авто-оптимум» видимое поле — <code>#calc-target-auto</code>, но <code>doCalc</code> всегда читал <code>#calc-target</code> (для режима required, который скрыт в auto). Поэтому targetMin был зашит на дефолт 10 мин — независимо от того, что пользователь вводил «20», «100» или любое другое значение, S³-результат всегда был одинаковым (42 модуля).',
      '• Fix: <code>const targetMin = (mode === \'auto\') ? get(\'calc-target-auto\').value : get(\'calc-target\').value</code>.',
      '• Verified в preview: target=100 → 5 шкафов × 17 мод = 85; target=20 → 3 шкафа × 17 = 51 (разный результат от target).',
      'Файлы: <code>battery/battery-calc.js</code> — функция <code>doCalc</code>.',
    ] },
    { version: '0.59.484', date: '2026-04-27', items: [
      '🔧 <b>Fix: «развернуть» 3D-вид — нормальный fullscreen-оверлей.</b> Раньше при клике 3D-окно «застревало» в верхней части страницы (после v0.59.479 кнопка работала, но переключение position:fixed на самом wrap не давало корректный результат — родительский <code>display:flex</code> и стили мешали). Теперь:',
      '• Создаётся выделенный <code>position:fixed; inset:0; z-index:99999</code> body-level overlay.',
      '• Wrap временно ПЕРЕНОСИТСЯ в overlay через <code>appendChild</code>, после exit — возвращается на исходное место (через якорь-comment node).',
      '• <code>renderer.setSize(w, h, true)</code> вместо <code>false</code> — обновляет style canvas, а не только intrinsic размер. Раньше canvas style.height застревал на старом значении и 3D рендерился маленьким в углу.',
      'Verified в preview: overlay covers viewport (684×568), canvas заполняет 660×544 без артефактов layout. Файлы: <code>shared/battery-types/s3-3d-view.js</code>.',
    ] },
    { version: '0.59.483', date: '2026-04-27', items: [
      '✅ <b>Schneider Galaxy VS 100 kW — V_DC окно verified.</b> 384-480 (estimate) → <b>384-576 В</b> по datasheet (securepower.com GVSUPS100KGS): external battery 480-576 VDC at float, EoD 384 VDC. То же окно что у уже verified VS 60 kW — общее семейство.',
      '• Запись в <code>shared/ups-verified.js</code>, seedVersion 10→11 force-upsert.',
      'Verified в preview: «Schneider Galaxy VS 100 kVA · V_DC 384…576 В ✓».',
    ] },
    { version: '0.59.482', date: '2026-04-27', items: [
      '✅ <b>Eaton 9395P 1100 kVA — V_DC окно verified.</b> Datasheet «Power Xpert 9395P 1000-1200 kVA Technical Specification»: 38-41 jars × 12В × 6 cells, EoD 1.67-1.75 VPC, battery DC voltage range <b>456-492 В</b> (то же узкое окно что у 500-600 kVA — характерно для всей серии 9395P).',
      '• Запись в <code>shared/ups-verified.js</code> — green ✓ в info-строке Battery-calc.',
      '• seedVersion 9→10 force-upsert.',
      'Verified в preview: «Eaton 9395P 1100 · 1100 кВт · η=97% · V_DC 456…492 В ✓».',
    ] },
    { version: '0.59.481', date: '2026-04-27', items: [
      '✅ <b>Eaton 9395P 500 kVA — V_DC окно verified.</b> Раньше 432-540 (estimate); теперь <b>456-492 В</b> по datasheet «Power Xpert 9395P 500-600 kVA Technical Specification». Узкое окно — характерно для серии 9395P.',
      '• Запись добавлена в <code>shared/ups-verified.js</code> с пометкой ✓ — теперь в info-строке выбора этого ИБП в Battery-calc виден зелёный ✓ вместо ⚠.',
      '• seedVersion 8→9 force-upsert: у всех существующих пользователей обновится без ручного вмешательства.',
      'Файлы: <code>shared/catalogs/ups-eaton.js</code>, <code>shared/ups-verified.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.480', date: '2026-04-27', items: [
      '🔋 <b>findMinimalS3Config: hard-constraint по паспортной мощности модуля.</b> Раньше алгоритм мог вернуть конфигурацию, где per-module power > rated (например 28 модулей при 292 кВт даёт 10.45 кВт/модуль > rated 10 кВт). Это означает перегрузку BMS и срабатывание защиты.',
      '• Теперь нижний предел числа модулей: <code>minTotalByPower = ceil(batteryPwrReqKw / moduleRatedKw)</code>. Алгоритм стартует с этого значения, не пытается меньше.',
      '• Реальный кейс: 200 кВт нагрузка × derate 1.375 / inv 0.94 / (1−SoC 10%) = 325 кВт. Требует ≥33 модулей, округление до 2 шкафов × 17 = <b>34</b>. Per-module 9.56 кВт ≤ rated 10 кВт ✓.',
      '• Раньше для того же кейса возвращалось 28 модулей (over-rated). После фикса — 34 (within rated).',
      'Файлы: <code>shared/battery-s3-logic.js</code> — <code>findMinimalS3Config</code>.',
    ] },
    { version: '0.59.479', date: '2026-04-27', items: [
      '🩹 <b>Hotfix: SyntaxError в s3-3d-view.js — двойное объявление <code>total_w</code>.</b> В моём v0.59.477 я добавил размерные стрелки в renderTopView/renderFrontView через <code>const total_w = totalRowWidth()</code>, но эта переменная уже была объявлена в начале каждой функции. Браузер бросал <code>SyntaxError: Identifier \'total_w\' has already been declared</code> → весь скрипт не загружался → конфигуратор не работал. Удалены повторные объявления.',
      '🏷 <b>Подписи режима подключения S³ → ИБП Kehua: «±240 В биполярная» вместо технического «series 2×240».</b> Реальное физическое подключение S³ к Kehua MR33 — биполярная DC-шина ±240 В (нейтраль посередине). Раньше выводилось «series 2×240» — корректно по топологии (два выхода 240 В в series=480 В между плюсом и минусом), но непонятно для пользователя. Теперь: <code>±240 В биполярная (series 2×240)</code> для series-режима и <code>240 В параллельная (parallel)</code> для parallel.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code>, <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.478', date: '2026-04-27', items: [
      '🔇 <b>Fix: ложные «Удалённые изменения проекта» когда пользователь один.</b> Раньше echo-detection делалось только по окну времени (10 сек после save). На медленной сети или когда Firestore возвращал snapshot с задержкой, своё же сохранение определялось как «чужой write» — появлялась модалка с предложением принять/отвергнуть собственные изменения.',
      '• Добавлен надёжный детектор по UID: при <code>saveProject()</code> в документ записываются <code>_lastWriterUid / _lastWriterName / _lastWriterEmail</code>. В subscribe-callback сравниваем <code>doc._lastWriterUid === state.currentUser.uid</code> — если совпадает, всегда трактуем как свой echo (даже из другой вкладки).',
      '• Окно времени осталось как fallback для совместимости со старыми doc\'ами без поля <code>_lastWriterUid</code>.',
      'Файлы: <code>js/main.js</code> — <code>saveCurrent</code> (передача writerInfo); <code>subscribeProjectDoc</code> callback (проверка по UID).',
    ] },
    { version: '0.59.477', date: '2026-04-27', items: [
      '🩹 <b>Fix №1: точка экстраполяции вне графика.</b> Раньше bounds chart расширялись через <code>Math.min(tMin, highlight.tMin*0.9)</code> — но логика была хрупкой при граничных случаях. Теперь явные проверки <code>if (highlight.tMin &lt; tMin) tMin = highlight.tMin*0.85</code> с padding 15% (было 10%). Точка с экстраполяцией (например, P&gt;rated) гарантированно внутри plot-области.',
      '🩹 <b>Fix №2: кнопка «⛶ Развернуть» 3D-вида.</b> Click-handler проверял <code>modalOverlay</code> — переменную из старой реализации, которая не определялась. Из-за этого кнопка ничего не делала. Теперь проверка через <code>isFs</code> (флаг fullscreen-состояния, который actually обновляется в enterFullscreen/exitFullscreen).',
      '🔧 <b>Fix №3: алгоритм findMinimalS3Config — заполняет шкафы сверху вниз.</b> Раньше внешний цикл шёл по числу шкафов C от <code>minByPower=ceil(P/cabinetPowerKw)</code>, и алгоритм находил первое решение с большим C и почти-пустыми шкафами (например <b>3 шкафа × 12 модулей</b> вместо 2 шкафа × 18 для 36 модулей).',
      '• Новый алгоритм: внешний цикл по ОБЩЕМУ числу модулей <code>total</code> от 1 до maxTotal. Для каждого <code>total</code> минимальное число шкафов = <code>ceil(total/maxPerCabinet)</code>. Возвращает первое решение, удовлетворяющее автономии.',
      '• Шкафы заполняются полностью прежде чем добавляется следующий → нет «полупустых» шкафов.',
      '• Теперь «3 × 12» становится «2 × 18» (90% заполнения вместо 60%).',
      '📏 <b>3D-окно выше + общие размеры системы.</b>',
      '• Высота 3D-окна 600 → <b>720 px</b> (вертикальная прокрутка не появляется в 2D-табах).',
      '• На top-view и front-view добавлены размерные стрелки с подписью «общая ширина X мм» (top) и «общая ширина X мм · высота 2000 мм» (front).',
      '• В блоке «Состав ряда»: новая секция «Габариты: WxDxH мм · Площадь: X м² · Объём: Y м³» — для оценки требований к помещению.',
      'Файлы: <code>battery/battery-calc.js</code> (bounds expansion), <code>shared/battery-types/s3-3d-view.js</code> (fullscreen click + height + dimensions), <code>shared/battery-s3-logic.js</code> (findMinimalS3Config rewrite).',
    ] },
    { version: '0.59.476', date: '2026-04-27', items: [
      '🔧 <b>Fix: расхождение «2 шкафа в шапке vs 1 шкаф в 3D/BOM».</b> В заголовке результата S³-расчёта показывается <code>found.cabinetsCount=2</code> (от <code>findMinimalS3Config</code>, который добавил второй шкаф из-за лимита 200 кВт/шкаф), но <code>_renderS3SystemSpecHtml</code> вызывал <code>buildSystem({totalModules:18})</code> без явного количества шкафов — и тот пересчитывал <code>cabinetsCount = ceil(18/maxPerCabinet=20) = 1</code>. Получалось 1 шкаф в спецификации/3D/BOM, но 2 в шапке. Теперь в <code>_renderS3SystemSpecHtml</code> добавлен параметр <code>requestedCabinetsCount</code>, который передаётся в <code>options.minCabinets</code> для buildSystem. Итого: <code>minCabinets = max(power-limit, requested)</code>. Файлы: <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.475', date: '2026-04-27', items: [
      '🔗 <b>Live-связь поля «Блоков в цепочке (N)» с V<sub>DC</sub>-окном ИБП.</b> В режиме «Автономия при заданных блоках» под полем N теперь динамически отображается допустимый диапазон, рассчитанный из <code>vdcMin/vdcMax/blockV/endV/safety/chemistry</code>:',
      '• <b>В диапазоне:</b> зелёная подсказка ✓ «Допустимо N = N_min…N_max (V<sub>DC</sub> X…Y В при разряде/флоате). Текущее N=Z → V<sub>DC</sub> ном. <b>K В</b>».',
      '• <b>N ниже минимума:</b> красная рамка + «⚠ N=Z ниже минимума N_min: при разряде V<sub>DC</sub> упадёт ниже vdcMin → ИБП отключится раньше».',
      '• <b>N выше максимума:</b> красная рамка + «⚠ N=Z выше максимума N_max: при флоат-заряде V<sub>DC</sub> превысит vdcMax → перезаряд / срабатывание защиты».',
      '• <b>V<sub>DC</sub> окно вообще не покрывается:</b> красная рамка + «⚠ окно ИБП не покрывается ни одним N. Уменьшите endV или возьмите блоки меньшего номинала».',
      '• Listener\'ы на: <code>calc-vdcmin</code>, <code>calc-vdcmax</code>, <code>calc-blockv</code>, <code>calc-endv</code>, <code>calc-vdc-safety</code>, <code>calc-blocks</code>, <code>calc-chem</code>, <code>calc-battery</code> — пересчёт при любом изменении.',
      'Файлы: <code>battery/battery-calc.js</code> — новый <code>updateBlocksHint()</code> в <code>wireCalcForm</code>; <code>battery/index.html</code> — добавлен <code>#calc-blocks-hint</code>.',
    ] },
    { version: '0.59.474', date: '2026-04-27', items: [
      '🔓 <b>Режим «Автономия при заданных блоках» — реально редактируемый.</b> Раньше N блоков и M цепочек подсчитывались автоматически из V<sub>DC</sub> окна и нагрузки — у пользователя не было возможности вручную задать «у меня 32 блока × 2 цепочки, какая будет автономия?». Теперь:',
      '• Поле «<b>Блоков в цепочке (N)</b>» — редактируемое, активно только в режиме autonomy. Авто-расчёт V<sub>DC</sub> = N · blockV пересчитывается. Если N вне рекомендованного диапазона ИБП [N_min…N_max] — выводится предупреждение, расчёт продолжается.',
      '• Поле «<b>Цепочек параллельно (M)</b>» — редактируемое в этом же режиме (раньше только display).',
      '• В режимах <code>required</code> и <code>auto</code> — поведение прежнее: подбор автоматический.',
      '🌡 <b>Температура: раздельная физика для VRLA и Li-Ion.</b> Раньше использовалась одна формула. Теперь:',
      '• <b>VRLA:</b> T<25 → IEEE 485 (0.008·ΔT); T>25 → Аррениус (0.005·ΔT). Примеры: 0°C→1.20, 25°C→1.00, 45°C→1.10.',
      '• <b>Li-Ion:</b> холод влияет втрое сильнее (0.015·ΔT в 0…25°C), при T<0 коэффициент × 1.5 (критическая зона, нужен подогрев — BMS блокирует при −20°C). Жара меньше влияет (0.003·ΔT, BMS защищает). Примеры: −10°C→<b>2.31</b>, 0°C→1.375, 25°C→1.00, 45°C→1.06.',
      '• Программа автоматически переключается между формулами при смене химии или выборе АКБ из каталога (через listener на <code>calc-chem</code>/<code>calc-battery</code>).',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_kTempFromCelsius(tC, chemistry)</code>, <code>_readDerating</code>, <code>doCalc</code> (manual N/M в autonomy); <code>battery/index.html</code>.',
    ] },
    { version: '0.59.473', date: '2026-04-27', items: [
      '🤖 <b>Auto-mode: подбор blockV (2/4/6/12 В) если конкретная АКБ не выбрана.</b> Раньше переборка шла только по endV, blockV брался из поля формы. Теперь:',
      '• Если АКБ из каталога <b>не</b> выбрана — перебор по обоим параметрам: <code>(blockV ∈ {2, 4, 6, 12} В) × (endV)</code> для VRLA; для Li-Ion: <code>(blockV ∈ {12, 24, 48} В) × (endV ∈ 2.5…3.0)</code>.',
      '• Если АКБ выбрана — blockV фиксируется из её паспорта.',
      '• Критерий выбора (приоритет): <b>max endV</b> (бережнее к АКБ → больше ресурс) → <b>min totalBlocks</b> (дешевле/компактнее) → <b>min blockV</b> (стандартные).',
      '• Результат: подсветка blockV+endV, в результате есть и подобранный V<sub>DC</sub>.',
      '• Таблица топ-12 вариантов с колонками: blockV, endV, N, Цепочек, Всего, V<sub>DC</sub>, Автономия. Лучший выделен ★.',
      'Файлы: <code>battery/battery-calc.js</code> — режим <code>auto</code> в <code>doCalc</code>.',
    ] },
    { version: '0.59.472', date: '2026-04-27', items: [
      '🌡 <b>Fix: k<sub>temp</sub> теперь меняется в обе стороны от 25°C.</b> Раньше при T &gt; 25°C коэффициент оставался 1.00 — пользователь вводил высокую температуру и не видел реакции. По IEEE 485 это формально корректно (тепло только увеличивает ёмкость), но в инженерной практике высокие температуры ускоряют старение по Аррениусу.',
      '• Новая формула: при T &lt; 25 — IEEE 485 § 6.2 (<code>k = 1 + 0.008·(25−T)</code>); при T &gt; 25 — поправка на ускоренное старение (<code>k = 1 + 0.005·(T−25)</code>). Каждые +10°C над 25°C удваивают скорость старения, и коэффициент 0.005 учитывает это для production-запаса.',
      '• Расширенная таблица типичных значений в help-panel: −10°C→1.28, 0°C→1.20, +25°C→1.00, +35°C→1.05 (тропики), +45°C→1.10 (горячий ЦОД).',
      '• Расширен диапазон input: max 60°C (был 50°C).',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_kTempFromCelsius()</code>, <code>battery/index.html</code> — tooltip и help.',
    ] },
    { version: '0.59.471', date: '2026-04-27', items: [
      '🔁 <b>Кросс-фильтрация в каталоге стоек (rack-config Kit Catalog).</b> 4 фильтра — Производитель / U / Ширина / Глубина — теперь все взаимозависимы. Раньше показывались distinct значения от полного списка KITS независимо от других выбранных фильтров → можно было выбрать невозможную комбинацию (Schneider 47U + ширина 800 которой у Schneider 47U нет) и получить пустой каталог.',
      '• Helper <code>matchesExcept(k, exceptKey)</code> — применяет все state-фильтры кроме указанного. Опции каждого селекта = distinct значения от <code>KITS.filter(matchesExcept(k, тут_ключ))</code>.',
      '• Если ранее выбранное значение исчезло из новых опций — селект сбрасывается на «Все» автоматически.',
      'Файлы: <code>rack-config/rack-config.js</code> — функция <code>render()</code> внутри <code>openKitCatalogModal()</code>.',
    ] },
    { version: '0.59.470', date: '2026-04-27', items: [
      '📚 <b>Help-panel Battery: документация авто-режима и температуры.</b>',
      '• В пункте «Порядок работы» упомянут третий вариант «🤖 Авто-оптимум» с пояснением что в этом режиме V<sub>DC</sub>/N/blockV/endV подбираются автоматически.',
      '• Новый раздел «🤖 Режим Авто-оптимум»: описание алгоритма (3 шага), критерии выбора (max endV → бережнее к АКБ; при равенстве — min blocks).',
      '• Новый раздел «🌡 Температура вместо k_temp» с таблицей типичных значений k<sub>temp</sub> от температуры (+25→1.00, +10→1.12, 0→1.20, −10→1.28). Замечание о Li-Ion: BMS отключит при −10°C, нужен подогрев.',
      'Файлы: <code>battery/index.html</code> — параметры <code>mountHelp</code>.',
    ] },
    { version: '0.59.469', date: '2026-04-27', items: [
      '🤖 <b>Новый режим расчёта «Авто-оптимум».</b> Пользователь задаёт только нагрузку и время — программа автоматически перебирает endV (для VRLA: 1.65…1.90 шаг 0.05; для Li-Ion: 2.5…3.0 шаг 0.1), для каждого считает feasibility по V<sub>DC</sub>-окну ИБП и подбор N через <code>calcRequiredBlocks</code>.',
      '• Критерий выбора: МАКСИМАЛЬНЫЙ feasible endV (бережнее к АКБ — меньше глубина разряда → больше циклов → длиннее срок службы); при равенстве — минимум блоков (дешевле, компактнее).',
      '• В результате: подсветка выбранного endV + таблица всех вариантов автоподбора (endV / N в цепочке / Цепочек / Всего / Автономия) с выделением лучшего ★.',
      '🌡 <b>Температура вместо k<sub>temp</sub>.</b> Раньше пользователь должен был сам считать k<sub>temp</sub>. Теперь — вводит температуру помещения °C, программа сама применяет IEEE 485 § 6.2: <code>k_temp = 1 + 0.008·(25 − T)</code> при T &lt; 25°C; иначе 1.00. При +10°C → k=1.12, +5°C → k=1.16, 0°C → k=1.20, −10°C → k=1.28. Под полем — расчётное значение в реальном времени.',
      '📚 <b>Help-tooltips и типичные значения для всех коэффициентов:</b>',
      '• k<sub>age</sub>: 1.25 IEEE · 1.20 IEC · 1.00 без запаса',
      '• k<sub>design</sub>: 1.10 типовое · 1.15 запас на рост · 1.00 точная',
      '• Окно V<sub>DC</sub>: 0% по spec · 3% инж.запас · 5% тропики',
      '• SoC мин: 10% типовой Li · 5% агрессивный · 20% бережный',
      '• ⓘ-иконка с детальным tooltip у каждого поля + краткие значения под полем.',
      'Файлы: <code>battery/battery-calc.js</code> — режим auto в <code>doCalc</code>, helper <code>_kTempFromCelsius</code>, обновлён <code>_readDerating</code>; <code>battery/index.html</code>.',
    ] },
    { version: '0.59.468', date: '2026-04-27', items: [
      '🔁 <b>Кросс-фильтрация в Конструкторе ИБП (шаг 2 wizard).</b> Применён общий принцип: при выборе производителя селект «Топология» сужается до тех, что есть у этого производителя, и наоборот. Раньше «Все» показывало топологии независимо от выбранного supplier → можно было выбрать невозможную пару (Legrand + All-in-One) и получить пустой список.',
      '• Функция <code>_populateStep2FilterOptions(suitable)</code> переписана: для каждого селекта применяет ВСЕ остальные фильтры (поставщик, топология, kw-диапазон, текст), считает distinct значения нужного поля.',
      '• Если ранее выбранное значение исчезло из новых опций — селект сбрасывается на «Все» автоматически.',
      'Файлы: <code>ups-config/ups-config.js</code>.',
    ] },
    { version: '0.59.467', date: '2026-04-27', items: [
      '🔍 <b>Сверка S3 c брошюрой (Kehua S3 Brochure 2023-11-16):</b>',
      '• <b>Fix:</b> S3C040-6C-20 cabinet kWh: 46 → <b>41</b>. В коде был комментарий «уточнено по User Manual A (было 41)» — брошюра авторитетнее, и математика сходится: 20 модулей × 2.05 кВт·ч = 41. Также корректирует синхронизацию с записью самого шкафа (там уже было 41).',
      '• Остальные параметры S3 ✓ соответствуют datasheet:',
      '  ◦ S3M040 / S3M050 / S3M100 модули: rated 10 / 10 / 5 кВт',
      '  ◦ Шкафы: S3C040 200 кВт/41 кВт·ч/20 модулей · S3C050 200 кВт/58 кВт·ч/20 модулей · S3C100 60 кВт/69 кВт·ч/12 модулей',
      '  ◦ Discharge rate (C): 6 / 4 / 1',
      '  ◦ Габариты: 223×665×152 (40/50) и 440×665×132 (100) мм',
      '  ◦ Масса: 36 / 38 / 50 кг',
      'Файлы: <code>shared/catalogs/battery-kehua-s3.js</code>.',
    ] },
    { version: '0.59.466', date: '2026-04-27', items: [
      '🔁 <b>Кросс-фильтрация селектов (новый общий принцип проекта).</b> Запомнено в memory: когда у пользователя несколько фильтров над одним списком, опции в каждом select зависят от значений всех остальных фильтров. Применено сейчас в Battery-calc:',
      '• <b>UPS picker</b> — Поставщик и Тип ИБП кросс-зависимы. Раньше: выбираешь Legrand, и в Типе показываются «Интегрированный»/«All-in-One», которых у Legrand нет → 0 ИБП. Теперь: при выборе Legrand в Типе остаются только Моноблок и Модульный (то что есть у Legrand). И наоборот: при выборе типа All-in-One из поставщиков остаётся только Kehua.',
      '• <b>Battery filter</b> — Поставщик / Тип АКБ / V блока теперь все кросс-зависимы. <code>_populateCalcFilterOptions()</code> переписана: каждый select получает опции от subset списка, отфильтрованного по всем остальным критериям. Тип АКБ показывается человекочитаемо через <code>chemLabel()</code> вместо raw \'vrla\'.',
      '• Запомнено в memory как общий принцип: <code>~/.claude/projects/.../memory/feedback_cross_filter.md</code> — применять везде в проекте (breaker-catalog, cable-types, mv-config и т.д.).',
      'Файлы: <code>battery/battery-calc.js</code> — <code>renderUpsPicker()</code>, <code>_populateCalcFilterOptions()</code>.',
    ] },
    { version: '0.59.465', date: '2026-04-27', items: [
      '🚧 <b>Паспортные ограничения мощности модуля/шкафа на графике разряда.</b> Для модулей Kehua S³ зашиты лимиты: max P/модуль = <code>cabinetPowerKw / maxPerCabinet</code>. Например, S3M040: 200/20=10 кВт; S3M100: 60/12=5 кВт. Превышение физически не реализуемо (BMS отключит).',
      '• В info-строке модалки записи теперь отображается «<b style="color:#c62828">Макс. P/модуль: X кВт</b>» и для шкафа «Макс. P/шкаф: Y кВт (N модулей)».',
      '• На графике разряда — горизонтальная красная пунктирная линия на уровне паспортного максимума с подписью «Макс. P/модуль: X кВт (шкаф Y кВт / N)». Сразу видно где нельзя работать.',
      '• Новый helper <code>_getBatteryMaxPowerW(b)</code> — для S³ из <code>packaging</code>, для VRLA — максимум таблицы разряда.',
      'Файлы: <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.464', date: '2026-04-27', items: [
      '🗄 <b>Компоновка VRLA-шкафа: выбор АКБ из справочника + сохранение габаритов.</b> Раньше в селекторе модели блока показывались только те АКБ, у которых уже есть габариты L×W×H — а у большинства seed-записей габариты не заданы, поэтому селектор был почти пустой.',
      '• Теперь показываются ВСЕ VRLA АКБ из каталога (кроме шкафов/аксессуаров). У записей без габаритов вместо размеров — пометка «⚠ габариты не заданы».',
      '• При выборе АКБ существующие габариты подставляются в поля; при их отсутствии — пользователь вводит вручную.',
      '• Новая кнопка «💾 Сохранить габариты в каталог» — записывает введённые L/W/H/массу обратно в выбранную запись АКБ через <code>addBattery()</code> upsert. Габариты становятся доступны во всех расчётах (автономия, отчёт, повторная компоновка).',
      '• Под селектором — info-строка «АКБ в каталоге: X (с габаритами: Y, без: Z)».',
      'Файлы: <code>battery/battery-calc.js</code> — <code>renderRackBatterySelector</code>, <code>_applyRackBatteryToForm</code>, <code>_saveRackBatteryDims</code>, <code>wireRackForm</code>; <code>battery/index.html</code>.',
    ] },
    { version: '0.59.463', date: '2026-04-27', items: [
      '🎯 <b>Возврат бикубической интерполяции (Hermite-сплайн) + точки строго на сплайне.</b> Раньше был выбор: либо красивый сплайн но точки съезжают, либо линейные отрезки и точное совпадение. Теперь оба плюса: кривая — монотонный Hermite-сплайн (Fritsch-Carlson, гладкий, без overshoot), точки/tooltip/crosshair считаются по самому SVG-path через <code>path.getPointAtLength()</code> + binary search по X. Один источник правды — нарисованный сплайн.',
      '• Каждый path помечен <code>data-ev</code> для лукапа.',
      '• Binary search 24 итерации (точность 0.05px) по длине дуги до целевого X.',
      '• Y-координата → log P через обратную <code>yOf()</code> формулу.',
      'Файлы: <code>battery/battery-calc.js</code> — функции <code>yOfPathAtX</code>, <code>interpPower</code>.',
    ] },
    { version: '0.59.462', date: '2026-04-27', items: [
      '🎯 <b>Кривая и точки на ней — один метод.</b> Раньше кривая разряда рисовалась монотонным Hermite-сплайном (Fritsch-Carlson, гладкий), а точки/snap считались линейной интерполяцией → визуально точка съезжала с линии при 3+ точках в таблице. Теперь кривая рисуется ровно теми же отрезками <code>M x,y L x,y L x,y</code> в screen-координатах, что и интерполяция: <code>linear в (t, log P)</code>. Кривая, crosshair, точки рабочей точки, маркеры на кривой — всё на одной геометрической линии. Файлы: <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.461', date: '2026-04-27', items: [
      '🩺 <b>Итеративный детектор аномалий datasheet.</b> Раньше детектор находил все 3 точки 240/300/360 мин как аномалии — потому что соседи 240 и 360 «выглядели низкими» относительно настоящего выброса 4218 в 300. Теперь алгоритм: на каждой итерации находит ОДНУ точку с максимальным отклонением, заменяет её на интерполированное значение во внутренней копии, повторяет. Так настоящий выброс находится первым, после его «исправления» соседи перестают казаться аномальными. Threshold снижен с 3× до 2× — детектор стал чувствительнее, но без false-positive-каскада.',
      '🎯 <b>Fix: точка/crosshair на ЛИНИИ разряда.</b> Раньше interpPower и snap работали линейно в (t, P), но кривая рисуется в (t, log P) — ось Y log. На 2-точечных или крутых сегментах точка съезжала с линии (например на 2-point кривой 10000→5000: tooltip показывал 7429 W, а визуально линия в t=15.14 проходит через 7071 W). Теперь интерполяция идёт <i>линейно в log P</i> — точно совпадает с линией.',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_detectDischargeAnomalies()</code>, <code>_snapHighlightToCurve()</code>, <code>interpPower</code> в hover.',
    ] },
    { version: '0.59.460', date: '2026-04-27', items: [
      '🧹 <b>Справочник АКБ показывает только сами АКБ.</b> Раньше в таблице каталога мелькали Blank Panels, S3-Combiner-2000/4000, S3-Networking-Device, S3-Slave-Wire-Kit — это <i>аксессуары</i> и <i>шкафы</i>, не АКБ. Теперь записи с <code>systemSubtype === \'cabinet\' || \'accessory\'</code> скрыты из таблицы. Они по-прежнему доступны для BOM в ups-config (там нужны).',
      '🩺 <b>Контроль ошибок в datasheet производителя АКБ.</b> Новый детектор <code>_detectDischargeAnomalies(rows)</code>: для каждой кривой (фиксированный endV) точки сортируются по t, для каждой внутренней — лог-линейная интерполяция соседей в (log t, log P), отношение фактическое/ожидаемое > 3× → аномалия. Типичный кейс: пропущенный десятичный разделитель (например, «4218» вместо «421.8» — даёт скачок в 10×).',
      '• В модалке записи каталога — оранжевый блок-предупреждение со списком аномалий (endV, t, фактическое vs ожидаемое значение, кратность отклонения).',
      '• На графике аномальные точки помечены <span style="color:#fbc02d">жёлтым кружком</span>; их значение в визуализации заменено на интерполированное (оригинальное доступно в title при hover).',
      '• Оригинальные данные таблицы не модифицируются — пользователь видит datasheet как есть и может исправить вручную.',
      'Файлы: <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.459', date: '2026-04-27', items: [
      '🎯 <b>Crosshair снапится на кривую разряда.</b> Теперь горизонтальная линия проходит через точку <i>на кривой</i> при текущем t, а не через позицию курсора по Y. Если видимых кривых несколько — выбирается ближайшая по Y к курсору. Удалена строка «Курсор: …» из tooltip — она больше не нужна, поскольку обе линии проходят через реальную точку на кривой.',
      '✅ <b>Метка верификации V_DC окна для ИБП.</b> Создан <code>shared/ups-verified.js</code> — единый список ИБП, у которых V_DC подтверждено datasheet. В info-строке выбранного ИБП в Battery-calc — значок ✓ (verified) или ⚠ (оценка). Под info — explanatory-блок при оценочных значениях с инструкцией «сверьте с паспортом перед production-расчётом».',
      '• Verified: Eaton 93PM 50/100/200 (PQ131012EN), Eaton 93PS 40 (PS153045), Schneider Galaxy VS 60 (GVSUPS60KGS), вся линейка Kehua MR33/S3 AIO/KR/Myria/FR-UK33/KR33/KR33-H (Kehua UPS Catalog 2024-10-22 с указанием страниц). Пользовательские записи (custom:true) считаются verified автоматически — пользователь сам отвечает за свои данные.',
      '• Unverified (требуют сверки): Eaton 9PX/93PS 8/20/9395P, Schneider Galaxy VS 10/20/40/100, VL 200/300/500, VX 750/1500, Legrand Keor LP/SP/T evo/HP/HPE/MOD/MP, DKC Small/TwinDom/Modulys.',
      'Файлы: <code>battery/battery-calc.js</code>, <code>shared/ups-verified.js</code> (новый).',
    ] },
    { version: '0.59.458', date: '2026-04-27', items: [
      '➕ <b>Горизонтальная линия crosshair.</b> Раньше была только вертикальная (текущее t), теперь добавлена горизонтальная — на уровне Y курсора, плюс в tooltip строка «Курсор: P W/блок» с расчётом мощности по log-обратной формуле <code>P = 10^(logPmin + (1 - (y-padT)/plotH)·(logPmax-logPmin))</code>. Полный crosshair как положено.',
      'Файлы: <code>battery/battery-calc.js</code> — добавлен элемент <code>.cx-hline</code>, обработчик mousemove обновляет y1/y2.',
    ] },
    { version: '0.59.457', date: '2026-04-27', items: [
      '🩹 <b>Fix: рабочая точка теперь снапится на синтетическую кривую тоже.</b> Раньше snap-to-curve работал только когда у АКБ была <code>dischargeTable</code>. Если её нет (расчёт «по усреднённой модели»), точка падала к <code>autonomyMin</code> и не совпадала с нарисованной кривой. Теперь интерполяция t↔P идёт через единую функцию <code>_snapHighlightToCurve()</code>, которая работает на ровно тех же rows, что рисуются (хоть из таблицы, хоть синтетических).',
      '🖱 <b>Fix: чекбоксы легенды графика разряда заработали.</b> Раньше hover-area (прозрачный rect для crosshair) рисовалась ПОСЛЕ легенды → перекрывала клики. Теперь hover-area идёт ДО легенды (z-order), плюс <code>pointer-events="none"</code> на не-кликабельных элементах легенды (text, чекбокс-rect, галочка) — клик ловится только на основной group.',
      '📌 <b>Tooltip графика разряда: smart-позиционирование.</b> Раньше tooltip всегда снизу-справа от курсора → выходил за пределы окна графика и появлялся скролл. Теперь после рендера измеряем offsetWidth/offsetHeight и переносим tooltip влево/вверх если не помещается. Контейнер графика обёрнут в <code>overflow:hidden</code> чтобы скроллбары не появлялись.',
      '🏷 <b>Tooltip формат:</b> «Время разряда: T мин» в заголовке + «<span style="color:#1565c0">●</span> 1.6 В/эл → P W/блок» по строкам — явно подчёркивает что время одно (фиксируем X), мощность своя для каждой кривой.',
      'Файлы: <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.456', date: '2026-04-27', items: [
      '🩹 <b>Исправлен баг «точка ниже кривой разряда».</b> В графике рабочей точки на кривой разряда раньше использовали (autonomyMin, blockPowerW) — это были ВВОДЫ алгоритма (целевое время + мощность на блок), и они часто не совпадали с реальной кривой АКБ. Теперь точка <b>снапится на кривую</b>: фиксируем blockPowerW (фактическая нагрузка), считаем РЕАЛЬНОЕ время разряда через <code>interpTimeByPower(curve, endV, P)</code>. Точка всегда на кривой. Файлы: <code>battery/battery-calc.js</code> — <code>_renderCalcDischargeChart()</code>, <code>_renderCalcDischargeChartZoom()</code>.',
      '🎯 <b>График разряда: hover-crosshair с подписями + кликабельная легенда.</b> Под курсором — вертикальная пунктирная линия, на каждой видимой кривой — точка с цветом, в tooltip — точное время и мощность для каждого endV. Клик по легенде показывает/скрывает соответствующую кривую (галочка/квадратик меняется). Состояние видимости сохраняется per-mount через WeakMap.',
      '🏷 <b>Глобальное переименование «Химия» → «Тип АКБ».</b> В Battery-calc и справке: метка фильтра, поле формы расчёта, заголовок info-строки в общем графике, столбец таблицы в Help. Терминология ближе к привычной для электротехников. Также сырые id (\'vrla\', \'li-ion\') заменены на человекочитаемые лейблы через единый <code>chemLabel()</code>: «Свинцово-кислотные (VRLA/AGM)», «Литий-ионные (LFP)», «Никель-кадмиевые (NiCd)», «Никель-металл-гидридные (NiMH)».',
      '📚 <b>Откат непроверенных правок V_DC окон ИБП.</b> В v0.59.455 я расширил vdcMin/vdcMax у Schneider/Eaton/Legrand/DKC по аналогии с Eaton 93PM, не имея datasheet на руках. Все эти изменения отменены — оставлены только проверенные через web-search/datasheet:',
      '• <b>Eaton 93PM 50/100/200:</b> 360-540 В (datasheet PQ131012EN: ном. 432 В = 36×12В или 480 В = 40×12В; EoD 1.67-1.75 VPC).',
      '• <b>Eaton 93PS 40 кВт:</b> 336-480 В (datasheet PS153045: external battery 28-40 × 12В VRLA).',
      '• <b>Schneider Galaxy VS 60 кВт:</b> 384-576 В (securepower.com GVSUPS60KGS).',
      '• Остальные модели (Schneider VL/VX, Legrand HP/MOD, DKC TwinDom/Modulys, Eaton 93PS 8/20) возвращены к исходным значениям до verified обновления.',
      '🔄 <b>seedVersion bump 7→8 + force-upsert.</b>',
      'Файлы: <code>battery/battery-calc.js</code>, <code>battery/index.html</code>, <code>shared/catalogs/ups-eaton.js</code>, <code>shared/catalogs/ups-schneider.js</code>, <code>shared/catalogs/ups-legrand.js</code>, <code>shared/catalogs/ups-dkc.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.455', date: '2026-04-26', items: [
      '🛠 <b>Fix: V<sub>DC</sub> окно Eaton 93PM 50/100/200 и 93PS 40 кВт.</b> Datasheet 93PM указывает <b>номинальное</b> напряжение АКБ 432 В (36 × 12В = 216 эл.) или 480 В (40 × 12В = 240 эл.). У меня было записано 384…480 В — это <i>середина диапазона</i>, не покрывающая ни глубокий разряд 36-jar, ни флоат 40-jar.',
      '• Исправлено: <b>vdcMin: 360 В</b> (= 36×6×1.67 при EoD 1.67 В/эл.) и <b>vdcMax: 540 В</b> (= 40×6×2.25 при флоате 2.25 В/эл.). Теперь окно реально покрывает обе паспортные конфигурации.',
      '• Применено к Eaton 93PM 50/100/200 и 93PS 40 кВт (similar config). 9395P уже имел корректное 432…540.',
      '🔄 <b>seedVersion bump 6→7 + force-upsert.</b> У всех существующих пользователей при следующем заходе обновятся V<sub>DC</sub> окна без ручного вмешательства.',
      'Файлы: <code>shared/catalogs/ups-eaton.js</code>, <code>shared/ups-seed.js</code>.',
    ] },
    { version: '0.59.454', date: '2026-04-26', items: [
      '🔬 <b>Battery-calc: расширенная диагностика «Диапазон не покрывается».</b> Теперь блок-предупреждение показывает (а) минимальный достижимый endV на этом ИБП: <code>endV<sub>min</sub> = V<sub>DC,min</sub> / (N<sub>max</sub> · cellsPerBlock)</code> — глубже разрядить нельзя, ИБП отключится первым; (б) физический смысл — соотношение float/end vs V<sub>max</sub>/V<sub>min</sub>; (в) конкретное решение: «установите endV ≥ X.XX В/эл. — тогда N=N<sub>max</sub> впишется».',
      '• Реальный кейс: Eaton 93PM 50 (V<sub>DC</sub> 384…480) с blockV=12, endV=1.75, float=2.25 → N<sub>min</sub>=37&gt;N<sub>max</sub>=35. Калькулятор объясняет: при N=35 ИБП отключится при <b>1.83 В/эл.</b> — это минимум; чтобы 37 блоков влезло во флоат — float должен быть ≤ 480/(37×6)=2.16 В/эл. (нереально для VRLA). Решение: endV ≥ 1.83.',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_refreshDcExplanation()</code>.',
    ] },
    { version: '0.59.453', date: '2026-04-26', items: [
      '📖 <b>Help-панель Battery: добавлены секции про совместимость АКБ↔ИБП и обоснование дефолтов VRLA.</b>',
      '• Usage: блок «Совместимость АКБ ↔ ИБП» — как работает чекбокс «Только совместимые», логика двойного неравенства endV/floatV vs V<sub>DC,min</sub>/V<sub>DC,max</sub>, поведение при отфильтрованной выбранной модели.',
      '• Usage: блок «Дефолты VRLA (v0.59.452)» — почему endV=1.85 (а не 1.75), float=2.25 (а не 2.27), V_DC safety=0% (а не 3%). Объяснение через соотношения 1.297 vs 1.25.',
      '• Calcs: новая секция 9 «Подбор N блоков под окно V<sub>DC</sub> ИБП» — формулы N<sub>min</sub>/N<sub>max</sub>, условие совместимости <code>floatV/endV ≤ V<sub>max</sub>/V<sub>min</sub></code>, что делать если не сходится.',
      'Файлы: <code>battery/index.html</code> — параметры <code>mountHelp</code>.',
    ] },
    { version: '0.59.452', date: '2026-04-26', items: [
      '🔧 <b>Fix: дефолты VRLA приведены к промышленной практике, а не к теоретическим vendor-vendor границам.</b>',
      '• <b>End voltage:</b> 1.75 → <b>1.85 В/эл.</b> (1.75 — глубокий разряд, сокращающий ресурс; 1.85 — стандарт для backup-режима ИБП). В <code>battery/index.html</code> опция 1.85 теперь selected, добавлена 1.90.',
      '• <b>Float voltage:</b> 2.27 → <b>2.25 В/эл.</b> в <code>_pickOptimalBlocks()</code> и <code>_isBatteryCompatibleWithUps()</code>. 2.27 — верхняя теоретическая граница vendor\'ов АКБ; 2.25 — рекомендация ИБП-производителей (Eaton/Schneider/APC), 2.27 в backup-режиме приводит к перезаряду.',
      '• <b>V_DC safety:</b> в пресетах IEEE 485 и IEC 62040: 3%/2% → <b>0%</b> (то же что в «Без запаса»). 3% — ad-hoc multiplier, не предусмотренный стандартом. Aggressive-пресет: 5% → 3%.',
      '🩺 <b>Почему это важно:</b> при дефолтах 1.75/2.27/3% соотношение float/end = 1.297, а окно ИБП ≤ 480/384 = 1.25 — НИ одна конфигурация N×12В VRLA не сходится. Реальный пример: Eaton 93PM 50 (V_DC 384…480) с 35 блоками 12 В даёт 35×11.1=388.5≥384 (разряд) и 35×13.5=472.5≤480 (флоат) — теперь подбирается.',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_isBatteryCompatibleWithUps()</code>, <code>_pickOptimalBlocks()</code>, <code>DERATING_PRESETS</code>; <code>battery/index.html</code> — селект endV.',
    ] },
    { version: '0.59.451', date: '2026-04-26', items: [
      '💡 <b>Battery-calc: подсказка с альтернативным блоком в ошибке «Диапазон не покрывается».</b> Раньше при N<sub>min</sub>&gt;N<sub>max</sub> показывалось только «Проверьте блок/endV или расширьте диапазон ИБП». Теперь — конкретно: «Попробуйте блок <b>6 В</b> или <b>4 В</b> вместо 12 В — окно V<sub>DC</sub> для них покрывается». Перебираются стандартные значения {2, 4, 6, 12} В и для каждого считаются N<sub>min</sub>/N<sub>max</sub>; в подсказку попадают только реально подходящие. Если ни одно не подходит — выводится сообщение «нужен другой ИБП».',
      '• Реальный кейс: Eaton 93PM 50 (V_DC 384…480) + 12 В блок → не сходится. Подсказка предложит 6 В: cells=3, end=5.55 В/блок, float=6.81 В/блок → N∈[70…70] (для endV 1.85). Покрывается.',
      'Файлы: <code>battery/battery-calc.js</code> — <code>_refreshDcExplanation()</code>.',
    ] },
    { version: '0.59.450', date: '2026-04-26', items: [
      '👁 <b>Battery-calc: ранее выбранная модель не «теряется» при включённом фильтре совместимости.</b> Если пользователь выбрал АКБ, потом выбрал ИБП и фильтр «Только совместимые» спрятал её — раньше селект показывал пусто, и было неочевидно, что именно выбрано. Теперь несовместимая модель остаётся в списке с пометкой «⚠ … — несовместима с ИБП», и красный диагностический блок объясняет почему. Файлы: <code>battery/battery-calc.js</code> — <code>renderBatterySelector()</code>.',
    ] },
    { version: '0.59.449', date: '2026-04-26', items: [
      '🔌 <b>Battery-calc: фильтр совместимости АКБ с выбранным ИБП.</b> Появляется чекбокс «Только совместимые с выбранным ИБП (по окну V<sub>DC</sub>)», когда в верхнем блоке выбран ИБП. По умолчанию ON — список моделей сужается до тех, для которых существует целое N блоков, удовлетворяющее одновременно: <code>N·endV·cellsPerBlock ≥ vdcMin·(1+safety)</code> и <code>N·floatV·cellsPerBlock ≤ vdcMax·(1−safety)</code>.',
      '• Для S³-модулей и других «готовых» Li-Ion блоков (BMS+ячейки зашиты) проверка упрощена: <code>vdcMin ≤ N·blockVoltage ≤ vdcMax</code> при <code>N∈{1,2,3}</code>.',
      '• Дефолты: VRLA endV=1.75/float=2.27, Li-Ion endV=2.5/float=3.45 (как в актуальных <code>_pickOptimalBlocks</code>).',
      '• В подсказке под селектором: «совместимых с ИБП: X из Y».',
      '🩺 <b>Диагностика «нельзя рассчитать».</b> Когда выбрана несовместимая пара АКБ+ИБП (галочка «Только совместимые» снята вручную), под списком АКБ появляется красный блок-объяснение: «Окно V<sub>DC</sub> ИБП vdcMin…vdcMax В не покрывает блок blockV В: для разряда нужно N≥X (end ε В/эл.), для флоата N≤Y (float φ В/эл.)». Раньше пользователь видел только техническую ошибку «Диапазон не покрывается: N_min > N_max» в результате расчёта без подсказки, что делать.',
      '• Реальный кейс: Eaton 93PM 50 (V_DC 384…480) + CSB HRL1234W (12 В, VRLA) → endV·6=11.1 даёт N≥36, float·6=13.62 даёт N≤34. Окно слишком узкое для 12 В блока — нужны 6 В блоки, либо ИБП с более широким окном V_DC.',
      'Файлы: <code>battery/battery-calc.js</code> — новый <code>_isBatteryCompatibleWithUps()</code>, расширен <code>renderBatterySelector()</code>, новый <code>_renderUpsCompatHint()</code>, ререндер при смене ИБП и чекбокса. <code>battery/index.html</code> — чекбокс <code>#calc-filter-ups-compat</code>.',
    ] },
    { version: '0.59.448', date: '2026-04-26', items: [
      '🔋 <b>Single source of truth для каталога АКБ (Kehua S³).</b> Раньше у новых пользователей каталог АКБ был пустой, пока не кликнули «Загрузить Kehua S³» — та же проблема «двух источников», что была у UPS до v0.59.446.',
      '• Создан <code>shared/battery-seed.js</code> — идемпотентный авто-seed модулей/шкафов/аксессуаров S³ при импорте.',
      '• Подключён в <code>battery/battery-calc.js</code> и <code>js/engine/index.js</code> (для инспектора ИБП в главной схеме).',
      '• Идемпотентный режим (только missing-id): не ломает правки пользователя в существующих записях. seedVersion=1 как стартовый, бампается при изменениях seed-данных.',
    ] },
    { version: '0.59.447', date: '2026-04-26', items: [
      '🏷 <b>Fix: kind у новых ИБП — \'ups\' (стандартный), а не \'ups-integrated\'.</b> «Интегрированный» — это специфика Kehua с встроенными PDM-панелями распределения. Schneider/Eaton/Legrand/DKC — обычные моноблоки или модульные ИБП. Раньше все 40 новых записей имели <code>kind:\'ups-integrated\'</code>, и в wizard\'е ups-config они отображались как «Интегрированный». Теперь корректно классифицируются по <code>upsType</code> через реестр <code>shared/ups-types/</code>.',
      '🔬 <b>Battery-calc: фильтр «Тип» теперь динамический.</b> Раньше — хардкод 2 опции (Моноблок/Модульный). Теперь — populate из <code>listUpsTypes()</code>: Моноблок / Модульный / Интегрированный / All-in-One. Фильтрация — через <code>detectUpsType(u).id</code>, single source of truth с wizard\'ом.',
      '✅ <b>Battery-calc: метка типа в выпадающем списке моделей — из реестра.</b> Раньше «модульный/моноблок» считалось из <code>u.upsType</code>, теперь — <code>detectUpsType(u).shortLabel</code>: «ИБП (моноблок)» / «ИБП (модульный)» / «ИБП (интегрированный)» / «ИБП (All-in-One)».',
      '🛠 <b>Fix: _isStandaloneUps принимает kind=\'ups\' и \'ups-all-in-one\'.</b> Раньше из калькулятора были видны только записи с <code>kind=undefined</code> или <code>\'ups-integrated\'</code>. Теперь корректно показываются стандартные ИБП (kind=\'ups\') и AIO-шкафы. Файлы: <code>battery/battery-calc.js</code>.',
      '⚡ <b>Fix: findMinimalS3Config больше не отвергает «бесконечную» автономию.</b> Когда мощность на модуль ниже нижней точки <code>dischargeTable</code>, <code>interpTimeByPower</code> возвращает <code>Infinity</code> (что значит «автономия гарантированно превышает все табличные значения»). Раньше <code>Number.isFinite(Infinity)===false</code> → конфигурация отвергалась → ошибка «Не удалось подобрать S³-конфигурацию».',
      '• Пример: P=120 кВт, t=25 мин, S3M040 (rated 5 кВт/20 мин). При 26+ модулях power/module ≤ 5 кВт → tMin=∞ (гарантированно ≥20 мин). Конфиг 2 шкафа × 13 модулей = 26 модулей теперь корректно подбирается.',
      '• Возвращаемый <code>autonomyMin</code> при Infinity заменяется на <code>max(target×2, 60)</code> + флаг <code>autonomyExceedsTable=true</code>, чтобы UI не показывал ∞.',
      'Файлы: <code>shared/battery-s3-logic.js</code> — <code>findMinimalS3Config()</code>.',
      '🔄 <b>seedVersion bump 5→6 + force-upsert.</b> Раньше <code>ups-seed.js</code> доимпортировал только отсутствующие id; нельзя было исправить ошибку в seed-данных (как раз случай <code>kind</code>). Теперь при bump версии все seed-записи force-upsert\'ятся (они <code>custom:false</code> — пользовательские записи под другими id).',
    ] },
    { version: '0.59.446', date: '2026-04-26', items: [
      '🏭 <b>Каталог ИБП: +40 моделей (Schneider/Eaton/Legrand/DKC) и единый источник правды.</b>',
      '• Schneider Electric: Galaxy VS 10/20/40/60/100 кВА (моноблок), VL 200/300/500 кВт (модульный), VX 750/1500 кВт (модульный).',
      '• Eaton: 9PX 6/11 кВА (1ф моноблок), 93PS 8/20/40 кВт (3ф моноблок), 93PM 50/100/200 кВт (модульный), 9395P 500/1100 кВт (моноблок).',
      '• Legrand: Keor LP 3 кВА, SP 6/10 кВА, T evo 10/20 кВА, HP 100/200 кВА, HPE 400 кВА, MOD 30 кВт, MP 300 кВт.',
      '• DKC: Small Tower 1/3 кВА, SMALL+ 6/10 кВА, TwinDom 20/40/80 кВА, Modulys GP 25/100 кВт, Modulys XL 300 кВт.',
      '🔧 <b>Single Source of Truth.</b> Раньше Kehua MR33 авто-импортировался в <code>engine/index.js</code>, а Kehua S³ AIO + сторонние требовали ручного нажатия кнопки в ups-config. На главной схеме / в калькуляторе АКБ пользователь видел только Kehua и считал это «двумя источниками».',
      '• Создан <code>shared/ups-seed.js</code> — единый seed-модуль, идемпотентно загружающий все 6 каталогов в localStorage. Импорт авто-вызывает seed.',
      '• Точки входа: <code>js/engine/index.js</code>, <code>battery/battery-calc.js</code>, <code>ups-config/ups-config.js</code> — все теперь импортируют <code>shared/ups-seed.js</code>. seedVersion bump до 5 → у всех существующих пользователей доимпортируются недостающие записи.',
      'Файлы: <code>shared/catalogs/ups-schneider.js</code>, <code>ups-eaton.js</code>, <code>ups-legrand.js</code>, <code>ups-dkc.js</code> (новые); <code>shared/ups-seed.js</code> (новый); <code>js/engine/index.js</code>, <code>battery/battery-calc.js</code>, <code>ups-config/ups-config.js</code> (импорты).',
    ] },
    { version: '0.59.445', date: '2026-04-26', items: [
      '🔋 <b>Fix: Li-Ion EoD по умолчанию = 2.5 В/элемент (было 1.75).</b> 1.75 В — это VRLA-значение, для LFP типичный EoD ≈ 2.5 В. Файлы: <code>battery/battery-calc.js</code> — два места инициализации <code>endV</code> в Li-Ion-ветке.',
      '💾 <b>«Сохранить конфигурацию» в калькуляторе АКБ.</b> Кнопка рядом с «Отчёт/Печать»; запрашивает имя (scsPrompt → prompt fallback), сохраняет полный snapshot (battery info, mode/targetMin/endV/invEff, derate, strings/blocks, totalKwh, autonomyMin, dcVoltage, s3Cfg) в <code>configuration-catalog</code> с kind=battery. Включается при наличии валидного результата.',
      '🪟 <b>3D-вид S³: 2D-вкладки (план/фасад/сбоку) + узкое-высокое 3D + переписанный fullscreen.</b>',
      '• 2D-пайн стал переключаемым между «План (сверху)», «Фасад» и «Сбоку». Все три вида рисуются SVG c размерами шкафов в мм; фасад показывает высоту, секцию автоматов и горизонты модулей.',
      '• 3D-окно: <code>max-width:680px; height:600px</code> — выше и уже в обычном виде по запросу пользователя.',
      '• Fullscreen переписан: один <code>wrap</code> через <code>position:fixed; inset:0; z-index:9999</code>, body.overflow заблокирован, кнопка «✕ Закрыть» добавляется к <code>document.body</code>. Esc — выход.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code>, <code>battery/index.html</code>, <code>battery/battery-calc.js</code>.',
    ] },
    { version: '0.59.444', date: '2026-04-26', items: [
      '🔌 <b>Fix: 3D-вид S³ — кол-во автоматов теперь правильно зависит от ёмкости модуля.</b> В v0.59.443 логика была добавлена, но <code>spec.module</code> не возвращался из <code>buildSystem()</code>, поэтому 3D-вид всегда падал на default (2 автомата). Теперь <code>buildSystem()</code> возвращает <code>spec.module = { id, type, capacityAh, blockVoltage, supplier }</code> — 3D-вид читает <code>spec.module.capacityAh</code> и рисует <b>1 автомат</b> для 100 А·ч и <b>2 автомата</b> для 40/50 А·ч.',
      'Файлы: <code>shared/battery-types/s3-li-ion.js</code> — добавлено поле <code>module</code> в return <code>buildSystem()</code>.',
    ] },
    { version: '0.59.443', date: '2026-04-26', items: [
      'ⓘ <b>Подсказка к End Voltage в калькуляторе АКБ.</b> Добавлен tooltip-бейдж <code>ⓘ</code> рядом с полем «End voltage» с пояснением: чем НИЖЕ EoD, тем БОЛЬШЕ блоков может потребоваться (окно V_DC ИБП требует <code>N · endV · cells ≥ V_DC_min</code>; глубокий разряд = большая просадка U/блок = больше блоков для удержания V_DC). IEEE 485 §6.4.',
      '🚪 <b>3D S³: автоматы защиты теперь зависят от ёмкости модуля, а не от роли.</b> По эскизам User Manual: <b>1 автомат</b> в шкафах с модулями <b>100 А·ч</b> (один DC-ввод); <b>2 автомата</b> в шкафах с модулями <b>40/50 А·ч</b> (два DC-ввода). Раньше код смотрел на роль (master=2, slave=1) — это было неправильно. Файлы: <code>shared/battery-types/s3-3d-view.js</code> — <code>buildCabinet()</code> теперь читает <code>opts.capacityAh</code>; <code>mountS3ThreeDView()</code> пробрасывает его из <code>spec.module.capacityAh</code>.',
      '📐 <b>Combiner: 2 типоразмера (S3C-2000 / S3C-4000) с авто-подбором.</b> User Manual Figure 2-24, Table 2-9:',
      '• <b>S3C-2000</b> — 400×860×2000 мм, 120 кг, выход 2000 А, до 4 шкафов АКБ.',
      '• <b>S3C-4000</b> — 400×860×2000 мм, 140 кг, выход 4000 А, до 8 шкафов АКБ.',
      '• Авто-подбор: распределяем шкафы поровну между N комбайнерами; для каждого, если приходится ≤4 шкафа — S3C-2000, иначе S3C-4000.',
      '• <code>shared/catalogs/battery-kehua-s3.js</code> — <code>kehua-s3-combiner</code> заменён на <code>kehua-s3-combiner-2000</code> и <code>kehua-s3-combiner-4000</code> с полями <code>combinerCurrentA</code>, <code>combinerMaxCabinets</code>, <code>cabinetWeightKg</code>, <code>cabinetDimensionsMm</code>.',
      '• <code>shared/battery-types/s3-li-ion.js</code> — <code>buildSystem()</code> формирует <code>combinerInfos[]</code> с подбором SKU и пишет в <code>accessories[]</code> отдельной агрегацией по типоразмеру.',
      '🪟 <b>3D-вид: компоновка 3D + 2D top-view + исправлен полноэкранный режим.</b>',
      '• Раскладка: 3D слева (flex:1 1 480px), 2D-план справа (flex:0 1 260px) — на узких экранах 2D переносится под 3D.',
      '• 2D top-view (SVG): шкафы в виде прямоугольников 600×850 мм (master/slave) и 400×860 мм (combiner) с цветовой индикацией ролей, петлями и подписями моделей. Внизу — состав ряда и общие габариты.',
      '• Fix полноэкранного режима: модалка теперь position:fixed на 100vw×100vh, wrap абсолютным позиционированием занимает весь viewport (без проблем с flex/padding overlay). Кнопка «✕ Закрыть» в правом верхнем углу overlay. На месте wrap остаётся placeholder для возврата при сворачивании.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code> — добавлены <code>render2dTopView()</code>, переписаны <code>enterFullscreen()/exitFullscreen()</code> с placeholder-механизмом.',
      'Файлы tooltip: <code>battery/index.html</code> — <code>title</code> на label + span ⓘ для End voltage.',
    ] },
    { version: '0.59.442', date: '2026-04-26', items: [
      '🖥 <b>3D-вид S³: крупное окно + полноэкранная модалка.</b> Дефолтная высота встроенного canvas — 520 px (было 380). Кнопка <code>⛶ Развернуть</code> в тулбаре открывает 3D на весь экран (overlay 94% непрозрачности), Esc / кнопка <code>⤓ Свернуть</code> возвращает обратно в страницу. Canvas переезжает между местами без пересоздания сцены — состояние камеры, анимация дверей, открытые/закрытые двери сохраняются.',
      '🌤 <b>Настройки фона и плоскости.</b> Селекторы в правом нижнем углу: фон — Небо (градиент голубой-белый, по умолчанию) / Тёмный / Белый; сетка — 600 мм (по умолчанию) / 300 мм / 100 мм / скрыть. Плоскость — серая <code>#9aa0aa</code>, сетка темнее <code>#6a707a</code>. Размер поля 24×24 м.',
      '⚡ <b>Модуль автоматов защиты над модулями АКБ в 3D.</b> Над зоной модулей внутри master/slave рисуется панель DC-автоматов (по эскизам User Manual S³): <b>2 автомата</b> у master (для двух DC-вводов) и <b>1 автомат</b> у slave. Высота панели 120 мм, фронтальная пластина с винтами по углам, чёрные корпуса автоматов с белым окошком рычажка, подпись «DC». Модули АКБ автоматически смещены вниз (резервируем 0.16 м под автоматы и 0.10 м над ними под верхний короб контроллера).',
      '🟰 <b>Равномерное распределение модулей по шкафам.</b> Раньше первый шкаф заполнялся полностью (например, 30 мод. → master 20 + slave 10 + 10 заглушек). Теперь модули распределяются равномерно: <code>baseFill = ⌊total/cabs⌋</code>, первые <code>(total mod cabs)</code> шкафов получают +1 модуль. 30 мод. в 2 шкафа → master 15 + slave 15.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code> — добавлены <code>buildBreakerPanel()</code>, <code>makeSkyTexture()</code>, <code>applyBackground()</code>, <code>rebuildGrid()</code>, <code>enterFullscreen()/exitFullscreen()</code>, тулбар + панель настроек; <code>shared/battery-types/s3-li-ion.js</code> — переписан цикл распределения модулей в <code>buildSystem()</code>.',
    ] },
    { version: '0.59.441', date: '2026-04-26', items: [
      '✏ <b>Кнопка «Изменить конфигурацию» на Шаге 4 wizard\'а ИБП.</b> После открытия сохранённой конфигурации (или после прохождения wizard\'а) на экране «Итог» теперь есть кнопка возврата к Шагу 1 без потери параметров. Поля Шага 1 уже заполнены через <code>_fillWizStep1Fields()</code>, так что пользователь видит свои значения и может править нагрузку/автономию/напряжение.',
      '• <code>ups-config/index.html</code> — добавлен <code>&lt;button id="wiz-btn-edit-cfg"&gt;</code> между «← Назад» и «💾 Сохранить в перечень».',
      '• <code>ups-config/ups-config.js</code> — обработчик: <code>_fillWizStep1Fields(); _showStep(1);</code>',
    ] },
    { version: '0.59.440', date: '2026-04-26', items: [
      '🖱 <b>Клик по сохранённой конфигурации в сайдбаре «Конфигурации ИБП» открывает саму конфигурацию.</b> Раньше клик только заполнял 4 поля Шага 1 и НЕ восстанавливал ни выбранный ИБП, ни АКБ — пользователь видел только пустой Wizard и думал, что работает только переименование. Теперь:',
      '• <code>ups-config/ups-config.js</code> — добавлена функция <code>_loadFromSavedPayload(payload)</code> и слушатель события <code>ups-config:load</code>: восстанавливает <code>wizState.requirements</code>, <code>wizState.batteryChoice</code>/<code>battery</code>, стичит <code>wizState.composition</code> (ups + fitInfo) из плоского payload и прыгает на <b>Шаг 4 «Итог»</b>, где видна подобранная модель ИБП. Если <code>upsId</code> в payload пустой — открывает Шаг 1 (старое поведение).',
      '📄 <b>Расчёт АКБ — на новой странице отчёта ИБП.</b> Раньше секция «Аккумуляторная батарея» содержала только 5 полей (производитель/модель/химия/V/Ah) и шла внутри основного отчёта. Теперь:',
      '• <code>ups-config.js</code> — секция АКБ начинается с новой страницы (<code>page-break-before: always</code>). Только если АКБ были подобраны (<code>batteryChoice !== \'skip\'</code> и <code>battery</code> задан).',
      '• Артикул модели в верхнем регистре (<code>String(model||type||id).toUpperCase()</code>) — было «kehua-s3m100-1c-240-x», стало «KEHUA-S3M100-1C-240-X».',
      '• «Химия» переименована в «Тип АКБ» (по соглашению UI).',
      '• Расширена таблица: V_DC шины, блоков в цепочке, цепочек, всего блоков, кВт·ч, расчётная автономия, конечное U элемента, КПД инвертора, режим. Доп. секция «Коэффициенты расчёта (IEEE 485 / IEC 62040)»: k_age, k_temp, k_design, k_total, окно V_DC, резерв SoC.',
      '• <code>battery/battery-calc.js</code> — payload <code>raschet.upsBatteryReturn.v1</code> теперь несёт <code>type</code>, <code>mode</code>, <code>targetMin</code>, <code>endV</code>, <code>invEff</code>, <code>derate</code>; <code>ups-config.js _consumeUpsBatteryReturn</code> их забирает в <code>wizState.battery</code>.',
    ] },
    { version: '0.59.439', date: '2026-04-26', items: [
      '🚌 <b>Combiner: учёт ограничения по числу подключаемых шкафов АКБ.</b> Из User Manual Figure 3-36/3-37: каждая шина combiner имеет 6 отверстий — 4 по краям для шкафов АКБ + 2 в середине для UPS. Без демонтажа задних плит — до 4 шкафов АКБ на 1 combiner; с демонтажем задних плит — до 8 (задние шины те же). Свыше 8 — нужен ещё один combiner.',
      '• <code>shared/battery-types/s3-li-ion.js</code> — <code>combinersCount = ⌈cabinetsCount / 8⌉</code>; в каждый combiner-объект пишется флаг <code>rearPlate</code> (true когда суммарно >4·N комбайнеров).',
      '• Предупреждения: «требуется демонтаж задних плит» при >4 шкафов на combiner; «добавлено N комбайнеров» при >8 шкафов АКБ.',
      '🩹 <b>Fix: 3D-вид S³ показывал «не удалось загрузить Three.js».</b> Причина — <code>OrbitControls.js</code> внутри использует bare-specifier <code>import \'three\'</code>, который без importmap не резолвится. Переключил CDN на <code>esm.sh</code> (автоматически резолвит bare-imports), с фолбэком на <code>esm.run</code>. Теперь не требуется importmap в HTML.',
    ] },
    { version: '0.59.438', date: '2026-04-26', items: [
      '🚪 <b>Открывающиеся двери и видимые модули внутри шкафа в 3D-виде S³.</b> Корпус шкафа теперь полый (5 стенок без передней), внутри стоят 3D-меши модулей с собственной перфорированной мордой и зелёным LED. Заполненные слоты — тёмно-серый <code>#3d4855</code>; пустые (заглушки) — полупрозрачный <code>#2c2e34</code> opacity 0.55.',
      '• Раскладка модулей по типу: S3C100 → 1 колонка × 12 рядов; S3C040/050 → 2 кол. × 11 ряд. (по фото User Manual Figure 2-11/2-12). Заполнение сверху-вниз: верхние слоты — модули, нижние свободные — заглушки.',
      '• Дверь — отдельный <code>THREE.Group</code> с pivot на левой петле, поворачивается на ~117° наружу (правый край в +Z). Ручка, тач-скрин (master), LED (slave) теперь привязаны к двери и поворачиваются вместе с ней.',
      '• Кнопка <code>🚪 Открыть/Закрыть двери</code> в левом нижнем углу canvas; плавная анимация (lerp 0.12 за кадр).',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code> — добавлены <code>moduleLayout(maxPerCabinet, modelHint)</code>, <code>buildModuleMesh(THREE,w,h,d,opts)</code>, рефакторинг <code>buildCabinet</code> (полый корпус + dorPivot + collectDoor callback); <code>mountS3ThreeDView</code> — toggle-button + анимация в render loop.',
      '🐞 <b>Fix: в отчёте АКБ модель отображалась только как «Kehua».</b> Заголовок брал <code>p.battery.model</code>, которое у S³-модулей не задано (используется поле <code>type</code>). Теперь: <code>[supplier, type||model, capacityAh+\'А·ч\'].filter(Boolean).join(\' · \')</code> → «Kehua · S3M050 · 50 А·ч». Файлы: <code>battery/battery-calc.js</code> 2 места (PDF-отчёт и print-версия).',
    ] },
    { version: '0.59.437', date: '2026-04-26', items: [
      '🧊 <b>Настоящий 3D-вид сборки шкафов S³ (Three.js + OrbitControls).</b> SVG-косая «3D» из v0.59.435 заменена на полноценный WebGL — можно вращать ЛКМ, зумить колесом, панорамировать ПКМ. Габариты по User Manual S³ (Figure 3-7): 600 × 850 × 2000 мм. Перфорированная дверь во всю высоту (процедурная canvas-текстура: тёмный градиент + сетка точек), вертикальная ручка справа, тач-скрин слева сверху на master, LED у slave, текстура шин «DC BUS» с болтами по периметру у combiner. Подписи моделей плавают над шкафами как Sprite. Three.js грузится лениво по первому показу (dynamic-import с unpkg, без importmap), при отсутствии интернета — плейсхолдер вместо ошибки. Камера и сцена настроены для бокового перспективного обзора, OrbitControls с дампфингом, max-polar-angle ≤ 89° (не пускаем под пол). Floor + GridHelper для масштаба.',
      '🔢 <b>Модули S³ — отдельная BOM-позиция и отдельная строка в таблицах состава.</b> Раньше число модулей было спрятано в описании шкафа («20 мод. + 4 заглушек»). Теперь:',
      '• <code>js/engine/bom.js</code> в S³-ветке после агрегации шкафов делает <code>pushAgg(\'АКБ S³ — модули\', { id: s3-mod-{type}, supplier, type, model, capacityAh, blockVoltage }, totalModulesUsed, descr)</code>. Сумма берётся как <code>Σ c.modulesInCabinet</code> по всем шкафам spec.',
      '• <code>battery/battery-calc.js _renderS3SystemSpecHtml</code> и <code>js/engine/inspector/ups.js</code> добавляют в таблицу строку «Модуль · {type} · {supplier} · {capacityAh} А·ч · {blockVoltage} В · qty» с фоном <code>#f5fbf5</code> для визуального отличия от шкафов.',
      'Файлы: <code>shared/battery-types/s3-3d-view.js</code> (новый, ~290 строк, экспорт <code>mountS3ThreeDView(container, spec, opts) → { dispose() }</code>); <code>battery/battery-calc.js</code> — импорт mount + плейсхолдер-div + post-mount после <code>out.innerHTML=html</code> + строка modulesRow; <code>js/engine/inspector/ups.js</code> — импорт + плейсхолдер-div + post-mount после <code>body.innerHTML=h.join(\'\')</code> + строка _modUsed в cabRowsArr; <code>js/engine/bom.js</code> — отдельный pushAgg для модулей в категории «АКБ S³ — модули».',
    ] },
    { version: '0.59.436', date: '2026-04-26', items: [
      '📦 <b>BOM-интеграция S³: шкафы master/slave/combiner + аксессуары теперь попадают в общий BOM проекта.</b> Раньше для узла ИБП с S³-модулем engine/bom.js использовал старый путь (поиск batt-cabinet-s3 по rackSlots) — без combiner, без networking-device, без blank-panels, без slave-wire-kit. Теперь:',
      '• <code>buildBOM()</code> при <code>isS3Module(batt)===true</code> вызывает <code>s3LiIonType.buildSystem({totalModules, options:{masterVariant, slaveVariant, fireFighting, minCabinets}})</code> — те же опции, что в инспекторе. Auto-add шкафов по 200 кВт/шкаф работает и тут (через <code>validateMaxCRate.suggestedMinCabinets</code>).',
      '• Шкафы группируются по <code>(role, model)</code> в одну BOM-строку с qty (например: <code>АКБ S³ — шкафы · S3C100-1C-12-MX-S · 3</code>).',
      '• Аксессуары добавляются в раздел <code>«АКБ S³ — аксессуары»</code> с supplier/model из accessory-catalog (<code>battCat[systemSubtype===\'accessory\']</code>).',
      '• Combiner — отдельный раздел <code>«АКБ S³ — комбайнер»</code>.',
      '• Старый legacy-путь s3Cabs/vrlaCabs остался для не-плагинных S³-каталогов и для VRLA.',
      'Файлы: js/engine/bom.js (импорт s3LiIonType + isS3Module; ветка <code>if (isS3Module(batt))</code> в обработчике АКБ ~50 строк перед старым vrla-цепочкой).',
    ] },
    { version: '0.59.435', date: '2026-04-26', items: [
      '🎨 <b>Изометрический «3D» вид сборки шкафов S³.</b> В battery-calc и в инспекторе ИБП в блоке «Состав системы (автосборка)» над таблицей теперь отрисовывается SVG-схема сборки — ряд шкафов в косоугольной проекции, с верхней и боковой гранью, тенью под полом, полками модулей внутри двери, заглушками в пустых слотах и индикаторами роли:',
      '• <b>master</b> — touch-screen экран в верхней панели (синий с глоу),',
      '• <b>slave</b> — зелёный LED-индикатор,',
      '• <b>combiner</b> — две горизонтальные шинные полосы + надпись «DC BUS».',
      'Под каждым шкафом — модель (S3C100-1C-12-MX-M / -S / S3-Combiner). Полки модулей: 12 для 40/50 А·ч, 4 для 100 А·ч. Заполненные = тёмно-синие; пустые = серые с пониженной opacity. Сверху — короткая легенда «N шкаф(ов): K×master · M×slave + 1×combiner».',
      '📊 <b>Группировка одинаковых шкафов в таблице состава.</b> Раньше при 4 slave писалось 4 одинаковые строки. Теперь группируем по <code>(role, model, fillStr)</code>, добавлена колонка «Кол-во» (например: <code>Slave · S3C100-1C-12-MX-S · 12 мод. · ×3</code>).',
      'Файлы: shared/battery-types/s3-iso-view.js (новый, ~150 строк, единственная экспортная функция renderS3IsoSvg(spec)); battery/battery-calc.js (импорт + вставка SVG в _renderS3SystemSpecHtml + группировка строк таблицы); js/engine/inspector/ups.js (тот же паттерн в S³-секции инспектора + группировка cabRows).',
    ] },
    { version: '0.59.434', date: '2026-04-26', items: [
      '🟢 <b>S³: лимит 200 кВт/шкаф больше не банит — система автоматически добавляет шкафы.</b> Раньше при превышении лимита показывался красный «⚠ Превышение лимита». Теперь:',
      '• <code>validateMaxCRate</code> при превышении возвращает <code>suggestedMinCabinets = ceil(reqKw / cabinetMaxKw)</code> вместо <code>ok:false</code>.',
      '• <code>buildSystem(options.minCabinets)</code> расширяет систему до этого числа: <code>cabinetsCount = max(ceil(modules/maxPerCabinet), minCabinets)</code>. totalModules не меняется — лишние слоты заполняются blank-панелями (BOM сам учтёт).',
      '• В battery-calc и инспекторе ИБП выводится зелёная info-плашка «ℹ Авто-добавлено до N шкафов (лимит 200 кВт/шкаф). Свободные слоты — blank-панели.»',
      '• Под таблицей всё так же печатается «На шкаф: X кВт / 200 кВт лимит» — теперь после bump перецеплено на актуальное число шкафов.',
      'Файлы: shared/battery-types/s3-li-ion.js (buildSystem.options.minCabinets, validateMaxCRate.suggestedMinCabinets); battery/battery-calc.js (_renderS3SystemSpecHtml — pre-check + autoBumped блок); js/engine/inspector/ups.js (тот же паттерн в S³-секции).',
    ] },
    { version: '0.59.433', date: '2026-04-26', items: [
      '🔷 <b>S³ Li-Ion: убраны нерелевантные VRLA-параметры.</b> Когда выбран модуль S³ (или другая модульная Li-Ion система с <code>systemType=\'modular-li-ion\'</code>):',
      '• <b>Скрыт</b> dropdown «End voltage (В/элемент)» с VRLA-значениями 1.60…1.85 — для LFP-модуля (240 В номинал, BMS) end-voltage на элемент задан внутри модуля и пользователю не доступен.',
      '• <b>Скрыты</b> поля «Цепочек параллельно», «Ёмкость блока (fallback)», «Напряжение блока» — для S³ они вычисляются автоматически по числу модулей и фиксированной топологии.',
      '• <b>Заменено</b> предупреждение «📐 Подбор N» на короткое пояснение «🔷 S³ Li-Ion: топология DC-шины задаётся типом модуля и диапазоном V_DC ИБП…». Раньше показывалось бессмысленное «⚠ Диапазон не покрывается: Nmin=2 > Nmax=1».',
      '🚦 <b>Лимит мощности на шкаф S³ (200 кВт).</b> В <code>s3LiIonType.validateMaxCRate</code> добавлена проверка PER-CABINET DC-power limit. Если расчётная нагрузка / число шкафов > 200 кВт — красный бан с подсказкой «Увеличьте число шкафов».',
      '• Лимит = <code>module.packaging.cabinetMaxKw || 200</code> (можно переопределить per-module в каталоге).',
      '• В блоке «Состав системы (автосборка)» под таблицей теперь печатается «На шкаф: X.X кВт / 200 кВт лимит (N шкафов).»',
      'Файлы: shared/battery-types/s3-li-ion.js (validateMaxCRate +cabinet limit); battery/battery-calc.js (_refreshDcExplanation early-return для S³, _applyBatteryLock — hideForS3, _renderS3SystemSpecHtml — печать per-cabinet kW).',
    ] },
    { version: '0.59.432', date: '2026-04-26', items: [
      '🐛 <b>Fix продолжение: при клике в сайдбаре по разным шаблонам в дропдауне «ШАБЛОН» накапливались ephemeral-записи.</b> Теперь <code>loadExternalTemplate</code> перед добавлением нового внешнего шаблона удаляет из <code>state.templates</code> все предыдущие ephemeral-записи (с пометкой <code>_extSig</code>), которых нет в LS-снимке.',
      '• Итог: в дропдауне максимум одна ephemeral-запись из сайдбара одновременно. Пользовательски сохранённые шаблоны (через «💾 Сохранить шаблон») остаются — они есть в LS, проверка <code>savedIds.has(y.id)</code> их защищает.',
      'Файлы: rack-config/rack-config.js (loadExternalTemplate +10 строк фильтра по LS-snapshot перед push).',
    ] },
    { version: '0.59.431', date: '2026-04-26', items: [
      '🐛 <b>Fix: каждый клик в сайдбаре сохранённых стоек плодил дубликаты «Шаблон (2)», «(3)»…</b> В <code>rack-config/rack-config.js</code> функция <code>loadExternalTemplate</code> всегда добавляла новую запись в <code>state.templates</code>. Если пользователь после клика жал «💾 Сохранить шаблон» — копия попадала в LS, и при следующем старте список рос.',
      '• <b>Сигнатура внешнего источника.</b> Теперь у клонированного шаблона сохраняется <code>_extSig = src.id + "|" + src.updatedAt</code>. При повторном клике в сайдбаре проверяем — если шаблон уже есть, переключаемся на него вместо клонирования.',
      '• <b>Авто-дедуп при загрузке.</b> В <code>loadTemplates()</code> добавлена однократная очистка LS: дубликаты определяются по контенту (всё кроме id/name/updatedAt/_extSig). При обнаружении показываем toast «Удалено дубликатов: N».',
      'Файлы: rack-config/rack-config.js (loadTemplates +20 строк дедупа; loadExternalTemplate — проверка _extSig в начале).',
    ] },
    { version: '0.59.430', date: '2026-04-26', items: [
      '📦 <b>SVG-оболочка вокруг интегрированного ИБП.</b> Закрыт roadmap-пункт из v0.59.422: вокруг родительского узла <code>ups-integrated</code> и его дочерних PDM-панелей (utility/bypass/inverter) теперь отрисовывается общая прямоугольная оболочка с пунктирной рамкой (#37474f, dasharray 4 3) и полупрозрачной заливкой (#fafbfc / 0.55), скруглением rx=6 и заголовком «📦 TAG · supplier model (Integrated)» в верхнем-левом углу. Визуально шкаф теперь выглядит как единый корпус, а не россыпь отдельных узлов.',
      '• <b>Алгоритм:</b> bounds = объединение bbox родителя и всех узлов из <code>n.integratedChildIds</code>; padding 14 px + 18 px сверху под подпись.',
      '• <b>Z-order:</b> <code>&lt;g class="integrated-ups-shell"&gt;</code> вставляется первым в <code>layerNodes</code> (через <code>insertBefore(firstChild)</code>), чтобы оболочка всегда была ПОД дочерними узлами и не перехватывала клики (<code>pointer-events: none</code> на rect).',
      'Файлы: js/engine/render.js (новый блок ~30 строк перед sectioned-panel wrapper, рядом с другими общими оболочками).',
    ] },
    { version: '0.59.429', date: '2026-04-26', items: [
      '🔷 <b>Состав системы S³ + варианты в модалке «Управление АКБ» инспектора.</b> Когда узел ИБП на схеме использует S³-модуль, в модалке инспектора под основным BOM-блоком теперь появляется свернутая секция <code>&lt;details&gt;</code> «Состав системы S³ (автосборка) — N шкаф(ов) + M аксессуаров» с такой же таблицей, как в standalone battery-calc: Master / Slave / Combiner + аксессуары (wire-kit, networking device, blank panels).',
      '🎛 <b>Inline-селекторы master/slave/fire-fighting.</b> Внутри секции — три select\'а (Master variant, Slave variant, Fire-fighting). Сохраняются в узле как <code>n.batteryMasterVariant</code>, <code>n.batterySlaveVariant</code>, <code>n.batteryFireFighting</code>. При смене модалка перерендеривается и в таблице обновляются суффиксы моделей шкафов (S3C040-6C-20-<b>M1</b> вместо -M и т.п.).',
      '🚦 <b>Валидация max C-rate</b> там же: красный бан при превышении ratedSystemKw, серая строка с процентом загрузки при норме.',
      '<b>Зачем:</b> у пользователя единый интерфейс для S³ и в standalone-калькуляторе battery-calc, и в инспекторе ИБП на схеме. Та же таблица, те же селекторы, те же предупреждения.',
      'Файлы: js/engine/inspector/ups.js (импорт s3LiIonType; блок <code>&lt;details&gt;</code> ~50 строк после s3OverloadBlock; 3 change-handler\'а после ups-batt-set обработчиков).',
    ] },
    { version: '0.59.422', date: '2026-04-26', items: [
      '🏗 <b>Интегрированный ИБП — многосекционный щит.</b> Раньше композит <code>ups-integrated</code> разворачивался в большое поле панелей с количеством выходов = <code>maxBreakers</code> на каждой PDM (8…24 выходов на одну панель), что выглядело перегружено и не соответствовало физической реальности — у фирменного шкафа Kehua MR33 наружу выходит сборная шина секции, а не каждый автомат отдельно.',
      '• <b>По одному выходу на панель.</b> В <code>js/engine/ups-composite.js</code> у всех PDM-панелей (utility / bypass / inverter) <code>outputs: 1</code>. Внутренняя разводка автоматов остаётся внутри щита (учитывается в BOM как <code>_pdmMaxBreakers</code> metadata, не как порты).',
      '• <b>Плотная компоновка.</b> Шаги <code>dx = 180, dy = 90</code> (было 220/110) — панели теперь визуально стоят впритык к ИБП, как секции одного шкафа.',
      '• <b>Разметка секций.</b> На каждом дочернем узле теперь <code>_integratedSection</code> = <code>"input" | "utility" | "bypass" | "inverter"</code> для будущей отрисовки общей оболочки.',
      'Файлы: js/engine/ups-composite.js (syncIntegratedUpsComposite — outputs:1, tighter spacing, _integratedSection метки).',
      'Roadmap: v0.59.423 — отрисовать общую SVG-оболочку (bounding rect) вокруг ИБП + дочерних панелей, чтобы интегрированный шкаф визуально выглядел как единый корпус.',
    ] },
    { version: '0.59.417', date: '2026-04-26', items: [
      '🔋 <b>Battery-калькулятор переведён на единый shared-модуль для S³.</b> Продолжение DRY-рефакторинга v0.59.416. В <code>battery/battery-calc.js</code> добавлена выделенная ветка <code>_doCalcS3({battery, loadKw, mode, targetMin, vRange, derate, invEff})</code>, которая вызывается из <code>doCalc()</code> при <code>isS3Module(battery)</code>. Логика расчёта (Vdc parallel/series, мощность на модуль, перегруз, минимум шкафов) идёт через <code>computeS3Configuration(...)</code> — ровно тот же вызов, что и в инспекторе. Никаких параллельных реализаций.',
      '• <b>Авто-конфигурация.</b> Прямая задача (autonomy): N = maxPerCabinet (минимум шкафов = минимум стоимости каркаса), C = ceil(loadKw·k<sub>total</sub>/(invEff·cabinetPowerKw)). Обратная задача (required): <code>findMinimalS3Config(...)</code> с передачей <code>calcAutonomy</code> как callback (избегаем циклических импортов).',
      '• <b>UI-вывод.</b> Для S³ показывается: «N шкаф(ов) × M модулей», модель шкафа, паспортная мощность, рабочее V<sub>DC</sub> с режимом (parallel 240 / series 2×240), мощность на модуль, ёмкость кВт·ч, плашка перегруза при превышении паспортной мощности.',
      'Файлы: battery/battery-calc.js (+ _doCalcS3 ~110 строк, ранний return в doCalc для isS3Module), импорт shared/battery-s3-logic.js.',
      'Roadmap: v0.59.418 — каталог All-in-One (S3C-{xx}-{phase}{kVA}, max 8/4 модулей) + UPS-тип. v0.59.419 — интегрированный ИБП как многосекционный щит.',
    ] },
    { version: '0.59.416', date: '2026-04-26', items: [
      '🔗 <b>Единый источник истины для расчётов Kehua S³ (DRY).</b> Принцип: всё, что можно сделать в одном месте, делается в одном месте. Раньше логика расчёта S³-конфигурации (Vdc-режим parallel/series, мощность шкафа, проверка перегруза) жила inline в js/engine/inspector/ups.js (≈80 строк inline-математики). При исправлении ошибки правка нужна была в нескольких местах. Теперь — <code>shared/battery-s3-logic.js</code> с чистыми функциями: <code>isS3Module(b)</code>, <code>resolveS3Wiring({module, requestedWiring, vdcMin, vdcMax})</code>, <code>computeS3Configuration({module, loadKw, vdcMin/Max, invEff, cosPhi, modulesPerCabinet, cabinetsCount, dcWiring})</code>, <code>findMinimalS3Config({...})</code>. Без DOM, без localStorage — pure functions, удобно для тестов.',
      '• <b>Инспектор переведён на единый модуль.</b> Все S³-вычисления (Vdc operating, batteryPwrReqKw, powerPerModuleW, stringCurrentA, systemPowerKw, overload, minCabinetsForLoad) теперь берутся из результата одного вызова <code>_computeS3Configuration(...)</code>. BOM-блок и плашка перегруза рендерятся из этого же объекта.',
      '🩹 <b>Фикс описаний моделей S³.</b> В <code>shared/catalogs/battery-kehua-s3.js</code> в полях <code>systemDescription</code> теперь явно указан суффикс <code>-X</code> для всех трёх модулей (S3M040-6C-240<b>-X</b>, S3M050-4C-240<b>-X</b>, S3M100-1C-240<b>-X</b>) — раньше суффикс был только в <code>type</code>, а в текстовом описании отсутствовал, что создавало визуальный диссонанс в модалке «Управление АКБ».',
      'Файлы: shared/battery-s3-logic.js (НОВЫЙ, ~150 строк pure-функций), js/engine/inspector/ups.js (заменены inline-расчёты на вызовы shared-модуля), shared/catalogs/battery-kehua-s3.js (фикс -X в systemDescription).',
      'Roadmap: v0.59.417 — battery-calc UI получает S³-режим и вызывает тот же модуль. v0.59.418 — каталог All-in-One (S3C-{xx}-{phase}{kVA}) + UPS-тип. v0.59.419 — интегрированный ИБП как многосекционный щит.',
    ] },
    { version: '0.59.415', date: '2026-04-26', items: [
      '〰️ <b>Battery-калькулятор: плавные сплайны на графиках разряда (монотонный кубический Hermite, Fritsch-Carlson).</b> Жалоба: «для графика разряда используй более плавные сплайны, может через кубическую зависимость». Раньше точки соединялись прямыми отрезками — на разреженной таблице производителя (1/3/5/10/15/30/60/180… мин) кривая выглядела ломаной. Теперь между точками строится <b>кубическая Hermite-интерполяция</b> с ограничителями Fritsch-Carlson — гарантированно <b>без overshoot</b> на монотонно убывающих данных (чисто математический критерий: t<sub>i</sub>/m<sub>i</sub> в окружности радиуса 3, иначе масштабируется).',
      '• <b>Алгоритм:</b> 1) секущие наклоны m<sub>i</sub> = (y<sub>i+1</sub>−y<sub>i</sub>)/(x<sub>i+1</sub>−x<sub>i</sub>); 2) касательные t<sub>i</sub> = (m<sub>i−1</sub>+m<sub>i</sub>)/2 (или 0 при смене знака); 3) проверка α²+β²>9 и масштабирование; 4) Hermite→Bezier C-команды. По сравнению с Catmull-Rom — НЕ даёт паразитных горбов на монотонной кривой разряда. Применено к обоим графикам (основной log-Y и zoom с линейными шкалами).',
      'Файлы: battery/battery-calc.js (+_smoothPathMonotone; замена ломаных в _renderDischargeChart и _renderDischargeChartLinear на cubic Bezier path).',
    ] },
    { version: '0.59.414', date: '2026-04-26', items: [
      '📊 <b>Battery-калькулятор: zoom-график + профессиональный печатный отчёт.</b> Жалоба: «сделай еще дополнительный график, с подробной зоной в зоне точки. Добавь профессиональный отчет на данный подбор с печатью в PDF».',
      '• <b>Zoom-график.</b> Под основным графиком разряда (X-линейная, Y-log) появился второй блок «Детализация в рабочей зоне (zoom)»: окно вокруг рассчитанной рабочей точки (≈±70% по обеим осям, при необходимости расширяется до ×3.5), <b>линейные шкалы</b> для X и Y. Удобно оценить запас по мощности и времени без логарифмических искажений. Точки выборки таблицы производителя крупнее, маркер рабочей точки ярче, с крестовиной и подписью.',
      '• <b>Печатный отчёт (новая кнопка 🖨 Печать).</b> Открывается отдельное окно с полным отчётом: исходные данные, результаты, разделы по дерейтингу (k<sub>age</sub>/k<sub>temp</sub>/k<sub>design</sub>/k<sub>total</sub>, окно V<sub>DC</sub>, SoC<sub>min</sub>) и подбору N (V<sub>DC</sub>-оптимизация с формулами и границами), оба графика inline-SVG. В правом верхнем углу — кнопки «🖨 Печать» и «✕ Закрыть». При печати плашка скрывается. Альтернатива PDF-экспорту через шаблон — без выбора шаблона, мгновенно.',
      '• <b>PDF-отчёт расширен.</b> <code>buildBatteryReportBlocks</code> теперь добавляет разделы «3. Расчётные коэффициенты (IEEE 485 / IEC 62040)» и «4. Подбор числа блоков (V_DC оптимизация)» с таблицами и формулами. <code>lastBatteryCalc</code> хранит дополнительно <code>vRange</code>, <code>opt</code> (метаданные подбора N), <code>dcVoltageRaw</code>, <code>blockV</code>, <code>dcWarn</code> — чтобы отчёт не пересчитывал и был воспроизводимым.',
      'Файлы: battery/battery-calc.js (+_renderCalcDischargeChartZoom, +_renderDischargeChartLinear, +printBatteryReport; lastBatteryCalc хранит vRange/opt/dcWarn; buildBatteryReportBlocks с новыми разделами), battery/index.html (+ кнопка #btn-battery-print).',
    ] },
    { version: '0.59.413', date: '2026-04-26', items: [
      '🛡 <b>Battery-калькулятор: коэффициенты дерейтинга (IEEE 485 / IEC 62040).</b> Жалоба: «согласно разных методик, используют еще разные параметры, например окно и деградацию АКБ, ты это учитываешь?». Раньше — нет. Теперь под формой есть раскрывающийся блок «🛡 Расчётные коэффициенты» с полями k<sub>age</sub> (старение / EOL), k<sub>temp</sub> (температура), k<sub>design</sub> (конструкт. запас), окно V<sub>DC</sub> (%), SoC<sub>min</sub> для Li-ion. Итоговый множитель k<sub>total</sub> = k<sub>age</sub>×k<sub>temp</sub>×k<sub>design</sub> применяется к нагрузке: P<sub>расчётное</sub> = P<sub>паспорт</sub> × k<sub>total</sub>. Окно V<sub>DC</sub> симметрично сужает диапазон ИБП (vdcMin·(1+x) … vdcMax·(1−x)) — учёт ripple, переходных процессов, падения на DC-шине. Для Li-ion дополнительно SoC<sub>min</sub> (защита BMS).',
      '• <b>Пресеты:</b> «IEEE 485» (по умолч.: 1.25/1.00/1.10, ±3%, SoC 10%), «IEC 62040» (мягче: 1.20/1.00/1.05, ±2%), «Жёсткий» (тропики/EOL: 1.25/1.11/1.15, ±5%, SoC 20%), «Без запаса» (1.00/1.00/1.00, 0%) — для теоретических расчётов.',
      '• <b>Где применяется:</b> в <code>doCalc</code> нагрузка для <code>calcAutonomy</code>/<code>calcRequiredBlocks</code> и для авто-подбора числа цепочек умножается на k<sub>total</sub>. В <code>_pickOptimalBlocks</code> границы V<sub>DC</sub> сужаются на vdcSafetyPct. В подсказке под полем V<sub>DC</sub> номинальное окно показано явно (эффективные V<sub>min</sub>/V<sub>max</sub>). В блоке результата — голубой info-блок «Учтены коэффициенты … расчётная нагрузка X kW (паспортная Y kW)».',
      '• <b>Пример</b> (для VRLA, IEEE 485, паспортная нагрузка 100 kW): k<sub>total</sub>=1.375 → расчёт ведётся на 137.5 kW; диапазон ИБП 360…600 В сужается до ~371…582 В, что обычно сдвигает N в сторону больших значений, но физически правильно — иначе АКБ к концу срока не выдаст требуемой мощности.',
      'Файлы: battery/index.html (раскрывающийся <details> с пресетами и 5 полями), battery/battery-calc.js (+_readDerating, +_applyDeratingPreset, +_refreshDerateSummary, +DERATING_PRESETS; loadKwEff в doCalc; vdcSafetyPct в _pickOptimalBlocks; live-обновление подсказки).',
    ] },
    { version: '0.59.412', date: '2026-04-26', items: [
      '📐 <b>V<sub>DC</sub> номинальное — экономически оптимальный N, не середина диапазона.</b> Жалоба: «нужно рассчитывать и применять не среднее между минимум и максимумом, а именно оптимальное напряжение для экономической целесообразности количества АКБ». Раньше для диапазона ИБП 360…600 В при блоке 12 В выбиралась середина: N = round(480/12) = 40 блоков → V<sub>DC</sub>=480 В. Теперь подбирается <b>МИНИМУМ блоков</b>, удовлетворяющий двум физическим ограничениям: (1) при разряде до endV V/cell V<sub>DC</sub> ≥ vdcMin; (2) при float-charge V<sub>DC</sub> ≤ vdcMax. Меньше блоков → меньше денег и места.',
      '• Формула: N<sub>min</sub> = ⌈vdcMin / (endV · cellsPerBlock)⌉, N<sub>max</sub> = ⌊vdcMax / (floatV · cellsPerBlock)⌋. Берётся N<sub>min</sub>. Для VRLA cellsPerBlock = blockV/2 = 6 (12 В блок), floatV = 2.27 В/эл; для Li-ion floatV = 3.45 В/эл. При endV=1.75 В/эл и диапазоне 360…600 В: N<sub>min</sub>=⌈360/(1.75·6)⌉=⌈360/10.5⌉=35, N<sub>max</sub>=⌊600/(2.27·6)⌋=⌊600/13.62⌋=44. Выбрано 35 → V<sub>DC</sub> = 35·12 = <b>420 В</b> (раньше было бы 480).',
      '🆘 <b>Справка под полем V<sub>DC</sub> номинальное.</b> Под полем теперь живёт голубой блок с разбором формулы: показаны диапазон ИБП, cellsPerBlock, end/float V на блок, обе границы N (с явной формулой ⌈⌉ и ⌊⌋), выбранное N и проверка V<sub>DC</sub> на разряде/float. Обновляется в реальном времени при изменении V<sub>DC</sub> мин/макс, блока, endV, типа АКБ или модели ИБП. Если диапазон не покрывается — красное предупреждение «N<sub>min</sub> > N<sub>max</sub>».',
      'Файлы: battery/battery-calc.js (+_pickOptimalBlocks, +_refreshDcExplanation, замена в doCalc и _applyUpsPickerLock; обработчики calc-blockv/calc-endv для live-обновления подсказки).',
    ] },
    { version: '0.59.411', date: '2026-04-26', items: [
      '🩹 <b>Каскадный пикер ИБП в инспекторе показывает интегрированные модели.</b> Раньше фильтр в <code>js/engine/inspector/ups.js</code> был <code>!u.kind || u.kind === \'ups\'</code> — это случайно отсеивало записи <code>kind:\'ups-integrated\'</code> (MR3390-B, MR3390-S, MR33150-B, MR33150-S). В каскаде Производитель → Серия → Модель пользователь не мог выбрать интегрированный ИБП — приходилось идти в полноценный <code>ups-config</code>. Теперь фильтр явно разрешает <code>!u.kind || kind===\'ups\' || kind===\'ups-integrated\'</code>; продолжают отсеиваться только BOM-заготовки (frame / power-module / batt-cabinet-*). Файл: js/engine/inspector/ups.js (renderUpsInspector — фильтр upsOnly).',
    ] },
    { version: '0.59.410', date: '2026-04-26', items: [
      '🧹 <b>Battery-калькулятор: из списка ИБП убраны несамостоятельные записи.</b> Жалоба: «зачем ты в список ИБП включил силовые модули, они не работают сами по себе». Раньше выпадающий «ИБП из каталога» в <code>battery/index.html</code> показывал все записи каталога, включая <code>kind:\'frame\'</code> (пустые корпуса MR33), <code>kind:\'power-module\'</code> (силовые модули PM 30K/50K/100K) и батарейные шкафы (<code>kind:\'batt-cabinet-vrla/s3\'</code>). Все они имеют <code>capacityKw=0</code> — выбор такой записи в качестве «ИБП» приводил к ошибке расчёта АКБ (нагрузка 150 кВт против шкафа 0 кВт → «Не удалось подобрать конфигурацию в пределах 2000 блоков»).',
      '• Введён фильтр <code>_isStandaloneUps(u)</code> в <code>renderUpsPicker</code>: пропускаются только записи без поля <code>kind</code> (классические готовые ИБП) и с <code>kind:\'ups-integrated\'</code> (интегрированные). Frames, power-modules и battery-cabinets — отсеиваются. Wizard <code>ups-config</code> уже фильтровал такие записи через <code>detectUpsType</code> — здесь логика приведена к тому же поведению.',
      'Файл: battery/battery-calc.js (renderUpsPicker + новая helper-функция _isStandaloneUps, ~10 строк).',
    ] },
    { version: '0.59.408', date: '2026-04-26', items: [
      '🔒 <b>Паспортные параметры ИБП блокируются при выборе модели из справочника.</b> Раньше пользователь мог зайти в инспектор узла ИБП с привязкой к каталогу (через каскадный пикер Производитель/Серия/Модель) и вручную поправить V<sub>DC</sub> мин/макс, КПД, корпус (frame), мощность модуля, число слотов, cos φ — расходясь с паспортом производителя. Теперь при <code>n.upsCatalogId != null</code> все эти поля становятся <code>readonly</code> с серым фоном и tooltip «🔒 Параметр из справочника». В заголовке блока «Ручной ввод параметров» появляется зелёный баннер с инструкцией «сбросьте модель в каскадном пикере выше». Проектные параметры остаются редактируемыми: «Установлено модулей», «Схема резервирования», breakers, уровень напряжения, attached АКБ. Файл: js/engine/inspector/ups.js (renderUpsInspector — _isFromCatalog флаг + _lockAttr/_lockSelAttr).',
    ] },
  ],

  'projects': [
    { version: '0.59.400', date: '2026-04-26', items: [
      '🩹 <b>Фикс регрессии v0.59.399: «+ Новый проект» больше не создаёт пустой контейнер.</b>',
      '• Симптом (по жалобе пользователя): «я для проекта сделал новую схему, назвал её схема — у меня добавился проект СХЕМА». Кнопка «+ Новый проект» в v0.59.399 создавала только project-context (без схемы), и пользователь видел в списке пустой заголовок-группу «Схема · пусто», воспринимая его как лишний проект.',
      '• Теперь <code>createNewProject</code> всегда создаёт <i>контекст + одну схему</i> внутри него: с демо (если отмечено) или пустую. Пользователь сразу попадает в редактор схемы — и не получает «висящих» пустых контейнеров.',
      '• Защита от изначальной проблемы (удаление схемы → исчезает проект) сохранена: контекст-проект — отдельная сущность, удаление одной из его схем оставляет контейнер видимым (он покажется как «· пусто», в него можно добавить новую схему через «+ Схема» в шапке).',
      'Файлы: js/main.js (createNewProject), js/engine/constants.js (APP_VERSION).',
    ] },
    { version: '0.59.399', date: '2026-04-26', items: [
      '🗂 <b>«Мои схемы»: проект и схема — отдельные сущности.</b>',
      '• Раньше «+ Новый проект» создавал в localStorage <code>raschet.projects.v1</code> просто схему с именем проекта. При удалении этой карточки (через «Удалить») пропадал весь «проект» — потому что и сам проект-как-контейнер не существовал, и группировки больше нечего было показывать. Пользователь воспринимал это как «удалил схему — снёс проект».',
      '• Теперь <code>createNewProject</code> создаёт <b>project-context</b> через <code>shared/project-storage.createProject({name})</code> — это контейнер для группы схем, отдельная сущность. Если отмечено «загрузить демо», вторым шагом создаётся схема, привязанная к контейнеру через <code>projectId</code>. Без демо — контейнер остаётся пустым и виден как заголовок-группа.',
      '• <code>renderCurrentTab</code> теперь показывает пустые группы (<i>«📁 Имя · пусто»</i>) — ваш проект не исчезает после удаления последней схемы. В шапке группы добавлены действия: <code>+ Схема</code>, <code>Переименовать</code>, <code>Удалить</code> (последнее открепляет схемы и удаляет контейнер; схемы переходят в «Без проекта»).',
      '🚫 <b>СКС-схемы исключены из «Мои схемы».</b>',
      '• Раньше в списке проектов-контекстов отображались sketch-проекты с <code>ownerModule=\'scs-design\'</code>/<code>\'scs-config\'</code> — мини-черновики из СКС-модулей. Они не относятся к электрическим схемам и должны жить только в <code>/projects/</code>.',
      '• <code>renderCurrentTab</code>: <code>ctxProjects</code> отфильтрован — берём только <code>kind !== \'sketch\'</code>. Это убирает все sketch-проекты любых модулей (СКС, HVAC, PDU, MV, rack-config, …) из заголовков-групп.',
      '• <i>Замечание по архитектуре:</i> карточка-схема (<code>_renderSchemeCard</code>) показывает только то, что сохранено через <code>window.Storage</code> (главный конструктор схем). СКС-модуль ничего туда не пишет, так что «карточек СКС» в этом списке быть не может — речь шла про заголовки-контейнеры.',
      'Файлы: js/main.js (createNewProject ~22 строки, renderCurrentTab — ctxProjects filter + empty groups + header actions, ~70 строк).',
    ] },
    { version: '0.59.398', date: '2026-04-26', items: [
      '🧹 <b>Свойства страницы: убрано поле «Тип» (Независимая / Ссылочная).</b>',
      '• Поле было реликтом ранней архитектуры. В проекте всегда набор видов одной схемы (см. v0.58.5 — поле уже было убрано из контекстного меню вкладок). Все элементы видны на всех страницах независимо от «типа», так что выбор Независимая/Ссылочная ни на что не влиял и вводил в заблуждение.',
      '• <code>js/engine/inspector.js</code>: удалён блок field(\'Тип\', …). Связанный change-handler оставлен (no-op без элемента).',
      '🗑 <b>Удаление страницы: безопасный диалог, если узлов нет.</b>',
      '• Раньше при удалении любой страницы показывалось предупреждение «Узлы, принадлежавшие ТОЛЬКО этой странице, будут удалены». Для пустых страниц это пугало пользователя и провоцировало отмену.',
      '• Теперь <code>deletePage</code> подсчитывает узлы с <code>pageIds=[pageId]</code> (единственная принадлежность). Если 0 — диалог говорит «На странице нет уникальных узлов — удаление безопасно». Если >0 — сколько именно узлов потеряется.',
      'Файлы: js/engine/inspector.js (-12 строк), js/engine/export.js (~14 строк в deletePage).',
    ] },
    { version: '0.59.397', date: '2026-04-26', items: [
      '🗂 <b>Палитра: «Потребители (компоненты)» с 4 подгруппами вместо 4 отдельных секций.</b>',
      '• Раньше доменные секции <code>СКС / слаботочка</code>, <code>Климат / HVAC</code>, <code>Двигатели / приводы</code>, <code>Освещение</code> были отдельными секциями верхнего уровня палитры. Это вводило в заблуждение — все они <b>consumer-узлы</b> с разными <code>subtype</code>, не отдельные типы элементов.',
      '• Теперь они вложены в секцию <code>Потребители (компоненты)</code> как <code>pal-group</code> с раскрытием через ▸ (тот же паттерн, что у «Источников питания» с подтипами Трансформатор/Городская сеть/Прочий ввод).',
      '• <code>data-page-kinds</code> у каждой подгруппы сохранён — на странице «Слаботочка» подгруппа СКС подсвечена; на «Mechanical» — HVAC и Двигатели; на «Принципиальной» — все.',
      '• Базовый «Потребитель (базовый)» остаётся первым элементом секции для типичного электрического потребителя без специализации.',
      '<i>📋 Заметка по ТЗ:</i> Полностью пользовательская структура каталога (drag-n-drop секций, переименование, создание новых групп) — отдельная задача, потребует UI редактора палитры и сохранения структуры в localStorage. В этом коммите только реорганизация дефолтного набора.',
      'Файлы: index.html (~70 строк, объединение 4 секций в подгруппы под consumer).',
    ] },
    { version: '0.59.396', date: '2026-04-26', items: [
      '🌱 <b>Авто-доимпорт встроенных записей Kehua MR33 на старте.</b> Интегрированные MR3390-B/-S и MR33150-B/-S теперь видны в picker без ручного нажатия «Загрузить Kehua».',
      '• Раньше: записи в <code>shared/catalogs/ups-kehua-mr33.js</code> (включая интегрированные, добавленные в v0.59.384) попадали в localStorage только через кнопку «Загрузить Kehua MR33» в ups-config. Если каталог пользователя был сформирован до v0.59.384 — интегрированных моделей в выпадающем списке нет.',
      '• <code>js/engine/index.js#_ensureBuiltinUpsSeeds()</code> — на старте сравнивает <code>raschet.upsCatalog.kehua.seedVersion</code> в localStorage с текущей константой и upsert\'ит недостающие записи (по id). Идемпотентно, версия повышается при каждом расширении seed.',
      '• Запускается один раз при загрузке engine/index.js. После v0.59.396 интегрированные ИБП появятся в picker автоматически у всех пользователей.',
      'Файлы: js/engine/index.js (~25 строк, новая функция _ensureBuiltinUpsSeeds + импорт KEHUA_MR33_UPSES, listUpses, addUps).',
    ] },
    { version: '0.59.395', date: '2026-04-26', items: [
      '🛡 <b>Защита интегрированного ИБП от удаления/замены при наличии подключённых линий.</b>',
      '• <code>js/engine/ups-composite.js#getIntegratedUpsExternalConns(n)</code> — новая функция: возвращает список внешних связей композита (UPS + integratedChildIds), исключая внутреннюю заводскую проводку (<code>_internalIntegratedUps</code>).',
      '• <code>js/engine/graph.js#deleteNode</code>: проверка hasConn расширена — учитывает не только сам узел ИБП, но и все его дочерние panel-узлы. Внутренние связи композита игнорируются (они снесутся вместе с узлом). Soft-delete с холста блокируется через стандартный <code>onBlocked(\'has-cables\')</code>.',
      '• <code>js/engine/inspector/ups.js</code> — три точки блокировки:',
      '&nbsp;&nbsp;◦ Picker «Производитель/Серия/Модель»: при попытке сменить модель показывается <code>flash(...)</code> и переключение откатывается.',
      '&nbsp;&nbsp;◦ Кнопка «Применить из Конфигуратора»: блокируется аналогично.',
      '&nbsp;&nbsp;◦ Селектор типа (моноблок/модульный/интегрированный): блокируется, значение откатывается на текущее.',
      '• Сообщение пользователю: «Нельзя сменить модель ИБП: подключено N кабелей. Сперва отключите линии от ИБП и распред. панелей.»',
      'Файлы: js/engine/ups-composite.js (+15 строк), js/engine/graph.js (~10 строк в deleteNode), js/engine/inspector/ups.js (3 блока guard-а).',
    ] },
    { version: '0.59.394', date: '2026-04-26', items: [
      '🐞 <b>Fix: схема не загружалась из-за неверного импорта в ups-composite.js.</b>',
      '• <code>js/engine/ups-composite.js</code> импортировал <code>GLOBAL</code> из <code>./state.js</code>, но <code>GLOBAL</code> экспортируется из <code>./constants.js</code>. ES-модуль с несуществующим именованным импортом падает на загрузке, что блокировало весь граф модулей и оставляло страницу на «Загрузка…».',
      '• Исправлено: <code>GLOBAL</code> импортируется из <code>constants.js</code>, <code>state/uid</code> — из <code>state.js</code>.',
      'Файлы: js/engine/ups-composite.js (1 строка импорта).',
    ] },
    { version: '0.59.393', date: '2026-04-26', items: [
      '🔧 <b>Внутренняя проводка интегрированного ИБП исключена из BOM.</b> Доводка композита из v0.59.392.',
      '• Связи входная панель ↔ ИБП ↔ PDM, созданные <code>syncIntegratedUpsComposite</code>, помечаются флагами <code>_internalIntegratedUps=true</code> и <code>_breakerInternal=true</code>. Заводская проводка шкафа уже включена в стоимость готового изделия (Kehua MR33 60-150K и аналоги).',
      '• <code>js/engine/report-sections.js#sectionCables</code>: фильтр кабельных линий пропускает связи с <code>_internalIntegratedUps</code>.',
      '• <code>js/engine/bom.js</code>: автоматы внутри композита не учитываются (флаг <code>_breakerInternal</code> уже фильтровался — теперь применяется и к auto-conns).',
      '• <code>js/engine/graph.js#deleteNode</code>: каскадное удаление — при удалении интегрированного ИБП все его дочерние panel-узлы (<code>integratedChildIds</code>) удаляются автоматически вместе со связями (по аналогии с <code>linkedOutdoorId</code>/<code>sectionIds</code>).',
      'Файлы: js/engine/ups-composite.js (флаги в _mkConn), js/engine/report-sections.js (1 строка), js/engine/graph.js (4 строки в deleteNode).',
    ] },
    { version: '0.59.392', date: '2026-04-26', items: [
      '🧩 <b>Интегрированный ИБП отображается на схеме в полном виде.</b> Композит из типовых элементов согласно фирменной топологии (Kehua MR33 60-150K и аналоги).',
      '• Новый модуль <code>js/engine/ups-composite.js#syncIntegratedUpsComposite(upsId)</code> автоматически разворачивает узел ИБП с <code>kind=\'ups-integrated\'</code> в композит:',
      '&nbsp;&nbsp;◦ Входная панель <code>UPS.IN</code> (тип <code>panel</code>): «ATS/MCCB» при <code>hasIntegratedAts=true</code> (2 ввода, switchMode=auto) или «MCCB» (1 ввод, manual). Выходов = 1 (на ИБП) + N (на utility/bypass-PDM).',
      '&nbsp;&nbsp;◦ PDM-панели <code>UPS.PDM-AC / UPS.PDM-IT1 / UPS.PDM-IT2</code> (тип <code>panel</code>): по одной на каждый <code>pdmModules[]</code>. Inputs=1, outputs=<code>maxBreakers</code>.',
      '&nbsp;&nbsp;◦ Связи: входная панель → ИБП (port 0); входная панель → utility/bypass-PDM (порты 1..N); выходы ИБП → inverter-PDM (порты 0..K).',
      '&nbsp;&nbsp;◦ Дочерние узлы помечены полем <code>_integratedParent=upsId</code>; список их id хранится у родителя в <code>n.integratedChildIds[]</code>.',
      '• Идемпотентность: повторный вызов с уже развёрнутым узлом — no-op (preserve пользовательских правок). При смене модели на не-integrated дочерние узлы и их связи удаляются.',
      '• Точки вызова (после <code>applyUpsModel</code>):',
      '&nbsp;&nbsp;◦ <code>js/engine/index.js#_tryConsumePendingUpsSelection</code> — приём из ups-config wizard.',
      '&nbsp;&nbsp;◦ <code>js/engine/inspector/ups.js</code> — picker «Производитель/Серия/Модель» в модалке параметров ИБП и кнопка «Применить из Конфигуратора».',
      '• Использует прямые операции с <code>state.nodes/state.conns</code> (<code>uid()</code> + <code>DEFAULTS.panel()</code> + <code>GLOBAL.default*</code>), чтобы избежать лишних снапшотов истории при пакетной вставке.',
      'Файлы: js/engine/ups-composite.js (новый, ~115 строк), js/engine/index.js (+2 строки), js/engine/inspector/ups.js (+3 строки), js/engine/constants.js (APP_VERSION).',
    ] },
    { version: '0.59.391', date: '2026-04-26', items: [
      '📥 <b>XLSX-импорт каталога ИБП поддерживает интегрированный тип.</b> Закрываем последнюю «дыру» в pipeline для типа integrated.',
      '• <code>shared/catalog-xlsx-parser.js#UPS_SCHEMA</code>:',
      '&nbsp;&nbsp;◦ Распознавание <code>upsType</code>: «integrated / интегрированный» → <code>kind=\'ups-integrated\'</code> (legacy <code>upsType=\'modular\'</code> сохраняется, т.к. внутри integrated имеет фрейм + модули).',
      '&nbsp;&nbsp;◦ Новые колонки в импорте: <code>HasIntegratedAts</code>, <code>Cabinet_Width_mm/Depth_mm/Height_mm/Weight_kg</code>, и три группы PDM-полей <code>PDM1..3_Id/Source/Max/Polarity</code>.',
      '&nbsp;&nbsp;◦ Хелпер <code>_buildIntegratedFields(r)</code> собирает массив <code>pdmModules[]</code> из плоских колонок и нормализует значения (бул как 1/yes/да/✓; source как utility/inverter/bypass).',
      '• <code>makeCatalogTemplate(\'ups\')</code> теперь содержит пример-строку Kehua MR33150-S со всеми полями интегрированного ИБП, чтобы пользователь сразу видел формат.',
      'Файлы: shared/catalog-xlsx-parser.js (~50 строк: схема UPS + хелпер _buildIntegratedFields + строка template).',
    ] },
    { version: '0.59.390', date: '2026-04-26', items: [
      '📐 <b>element-schemas: тип «integrated» в схеме createUpsElement.</b> Закрепляем интегрированный ИБП в канонической схеме элементов.',
      '• <code>shared/element-schemas.js#createUpsElement</code>:',
      '&nbsp;&nbsp;◦ В <code>kindProps.upsType</code> добавлено значение <code>\'integrated\'</code> (помимо monoblock/modular). Источник истины для типа — реестр <code>shared/ups-types/</code>.',
      '&nbsp;&nbsp;◦ Новые поля <code>kindProps</code>: <code>hasIntegratedAts</code>, <code>pdmModules[]</code> (с нормализацией id/label/source/maxBreakers/polarity/screenPrefix), <code>cabinetWidthMm/DepthMm/HeightMm/WeightKg</code>.',
      '&nbsp;&nbsp;◦ Глубокое копирование <code>pdmModules</code> при создании элемента — input-данные не мутируются.',
      '• Подготовка к Phase 5.5 (центр. хранение библиотеки): когда ups-catalog мигрирует на element-library, поля интегрированного типа уже описаны в каноне.',
      'Файлы: shared/element-schemas.js (~25 строк, расширены kindProps в createUpsElement).',
    ] },
    { version: '0.59.389', date: '2026-04-26', items: [
      '🔗 <b>applyUpsModel переносит интегрированные поля из каталога в узел схемы.</b> Замыкаем pipeline catalog → schematic для типа integrated.',
      '• Без этой правки выбор MR3390-S/MR33150-S в picker\'е давал на схеме обычный модульный ИБП — поля <code>kind / hasIntegratedAts / pdmModules / cabinet*</code> терялись, блок «Интегрированные компоненты» (v0.59.388) не появлялся, BOM не агрегировал PDM-панели и АВР.',
      '• <code>shared/ups-picker.js#applyUpsModel</code> расширен:',
      '&nbsp;&nbsp;◦ Если <code>u.kind===\'ups-integrated\'</code> — на узел копируются <code>kind, hasIntegratedAts, pdmModules</code> (deep-copy, чтобы правки на узле не утекали в каталог), <code>cabinetWidthMm/DepthMm/HeightMm/WeightKg</code>.',
      '&nbsp;&nbsp;◦ <code>node.outputs</code> = число PDM-панелей (если у узла outputs ещё не задан).',
      '&nbsp;&nbsp;◦ При встроенном АВР: <code>node.inputs=2</code> (если меньше).',
      '&nbsp;&nbsp;◦ Preserve-on-miss соблюдается: пользовательские <code>inputs/outputs</code>, если они уже выставлены, не перезаписываются.',
      '&nbsp;&nbsp;◦ При смене модели с integrated на обычную — поля очищаются (delete), чтобы инспектор/BOM не показывали призраки.',
      'Файлы: shared/ups-picker.js (~35 строк в applyUpsModel).',
    ] },
    { version: '0.59.388', date: '2026-04-26', items: [
      '🏗 <b>Блок «Интегрированные компоненты» в модалке параметров ИБП.</b> Доводка типа integrated.',
      '• Если узел ИБП имеет <code>kind=\'ups-integrated\'</code> — после блока «Модули и резервирование» в модалке отображается информационная секция:',
      '&nbsp;&nbsp;◦ Состояние входного АВР: «встроенный (2 ввода)» или «нет (1 ввод через MCCB)».',
      '&nbsp;&nbsp;◦ Список распред. панелей с указанием источника (сеть/инвертор/байпас) и формата (макс. автоматов × полярность).',
      '&nbsp;&nbsp;◦ Габариты шкафа (если заданы).',
      '• Блок read-only — параметры наследуются из каталога при выборе модели и редактируются только в catalog-конфигураторе. Попадают в BOM как отдельные строки (см. v0.59.387).',
      'Файлы: js/engine/inspector/ups.js (~30 строк, новый блок после блока модульных параметров).',
    ] },
    { version: '0.59.387', date: '2026-04-26', items: [
      '📑 <b>BOM детализирует подкомпоненты типа ИБП через плагин.</b> Расширение реестра типов из v0.59.385/386.',
      '• В descriptor типа ИБП добавлен опциональный метод <code>bomSubItems(u)</code> → массив <code>{category,id,supplier,model,qty}</code>.',
      '• Интегрированный тип (<code>shared/ups-types/integrated.js</code>) реализует <code>bomSubItems</code>:',
      '&nbsp;&nbsp;◦ «Встроенный АВР ИБП» — 1 шт., если <code>hasIntegratedAts=true</code>.',
      '&nbsp;&nbsp;◦ «Распред. панели ИБП (PDM)» — по одной строке на каждую панель из <code>pdmModules[]</code> (PDM-AC, PDM-IT1, PDM-IT2 для Kehua MR33 60-150K).',
      '• <code>js/engine/bom.js</code> после обработки фрейма+модулей вызывает <code>detectUpsType(ups).bomSubItems(ups)</code> и агрегирует строки. Хардкод по <code>kind===\'ups-integrated\'</code> убран — добавление нового типа с новыми подкомпонентами не требует правки bom.js.',
      'Файлы: shared/ups-types/integrated.js (+метод bomSubItems, ~25 строк), js/engine/bom.js (импорт detectUpsType + вызов плагина, ~12 строк).',
    ] },
    { version: '0.59.386', date: '2026-04-26', items: [
      '🧩 <b>Реестр типов ИБП распространён на инспектор схемы и picker.</b> Доводка плагин-архитектуры из v0.59.385.',
      '• <code>js/engine/inspector/ups.js</code>: dropdown «Тип ИБП» в модалке параметров теперь заполняется из <code>listUpsTypes()</code>. Поддержан тип «Интегрированный» (выбор → автоматически проставляются <code>n.kind=\'ups-integrated\'</code> + дефолты <code>hasIntegratedAts/pdmModules/cabinet*</code>).',
      '• Change-handler типа применяет <code>type.defaults()</code> ко всем недостающим полям узла (только если они не заданы — параметры пользователя сохраняются согласно правилу «User parameters are sacred»).',
      '• Apply-handler инспектора корректно мапит type-id → legacy <code>n.upsType</code> + <code>n.kind</code>.',
      '• <code>shared/ups-picker.js</code>:',
      '&nbsp;&nbsp;◦ <code>formatUpsSummary()</code> использует <code>detectUpsType(n).label</code> (для «Интегрированный» вернёт корректную метку, не «Модульный»).',
      '&nbsp;&nbsp;◦ Суффикс типа в опциях dropdown'+"'"+'а модели — также из реестра.',
      '• <code>recalc.js</code> / <code>bom.js</code> / <code>serialization.js</code> продолжают работать на legacy-полях (<code>n.upsType===\'modular\'</code>) — интегрированный наследует это поведение через свой <code>defaults().upsType=\'modular\'</code>, а различается через <code>n.kind=\'ups-integrated\'</code>. Дополнительной правки этих файлов не потребовалось.',
      'Файлы: js/engine/inspector/ups.js (импорт реестра + 2 блока: рендер dropdown\'а и change/apply-хендлеры, ~30 строк), shared/ups-picker.js (импорт реестра + 2 точки рендера меток, ~10 строк).',
    ] },
    { version: '0.59.385', date: '2026-04-26', items: [
      '🧩 <b>Типы ИБП — плагин-архитектура.</b> Запрос пользователя: «вынести типы ИБП в отдельные файлы… добавление модуля в папку с типами должно давать доступность выбора в конфигураторе».',
      '• Создан каталог <code>shared/ups-types/</code> с реестром типов:',
      '&nbsp;&nbsp;◦ <code>shared/ups-types/index.js</code> — реестр (<code>listUpsTypes / getUpsType / detectUpsType / getUpsTypeOrFallback</code>).',
      '&nbsp;&nbsp;◦ <code>shared/ups-types/monoblock.js</code> — моноблок (descriptor).',
      '&nbsp;&nbsp;◦ <code>shared/ups-types/modular.js</code> — модульный (фрейм + слоты).',
      '&nbsp;&nbsp;◦ <code>shared/ups-types/integrated.js</code> — интегрированный (АВР + до 3 PDM).',
      '&nbsp;&nbsp;◦ <code>shared/ups-types/_helpers.js</code> — esc/fmt/v.',
      '• Каждый descriptor реализует интерфейс: <code>matches / defaults / formFieldsHtml / readForm / detailRowsHtml / metaLabel / pickFit / fitDescription / buildComposition / summaryRowsHtml</code>.',
      '• <code>ups-config/ups-config.js</code> теперь читает типы из реестра:',
      '&nbsp;&nbsp;◦ Dropdown «Тип» в форме ручного ввода — опции из <code>listUpsTypes()</code>.',
      '&nbsp;&nbsp;◦ Доп. поля формы — <code>type.formFieldsHtml(src)</code>; чтение — <code>type.readForm()</code>. Поддержано переключение типа: при смене очищаются поля старого типа.',
      '&nbsp;&nbsp;◦ Иконка/метка в таблице — <code>type.icon / type.shortLabel</code>.',
      '&nbsp;&nbsp;◦ Карточка деталей — общий блок + <code>type.detailRowsHtml(u)</code>.',
      '&nbsp;&nbsp;◦ Wizard: фильтр «Тип» собирается динамически; подбор делегируется <code>type.pickFit()</code>; meta/fit-описание — <code>type.metaLabel/fitDescription</code>; шаг 3 (summary) — <code>type.summaryRowsHtml()</code>; состав — <code>type.buildComposition()</code>.',
      '• Чтобы добавить НОВЫЙ тип ИБП — создаётся файл в <code>shared/ups-types/</code> + одна строка в <code>index.js</code>. Никаких правок в самом конфигураторе не требуется.',
      'Файлы: shared/ups-types/index.js (новый), shared/ups-types/_helpers.js (новый), shared/ups-types/monoblock.js (новый), shared/ups-types/modular.js (новый), shared/ups-types/integrated.js (новый), ups-config/ups-config.js (~120 строк рефакторинга: openManualModal, render, renderSelected, _fillWizStep1Fields, _pickSuitable, _goStep2, _buildComposition, _goStep3).',
    ] },
    { version: '0.59.384', date: '2026-04-26', items: [
      '🔋 <b>Новый тип ИБП: «Интегрированный ИБП» (Kehua MR33 60-150K).</b> Запрос пользователя: «добавь новый тип ИБП Интегрированный ИБП включающий в себя собственно ИБП, возможность входного АВР или без, а так же до трех распределительных панелей».',
      '• Источник: <code>Kehua_UPS_MR33_60-150k_User manual_2023-01-01_4402-03908 004_ENG_Intergrated UPS.pdf</code>.',
      '• Добавлено 4 SKU: <code>MR3390-B</code> (90 кВт, одиночный MCCB), <code>MR3390-S</code> (90 кВт, встроенный АВР), <code>MR33150-B</code> (150 кВт, MCCB), <code>MR33150-S</code> (150 кВт, АВР).',
      '• Новые поля записи каталога ИБП:',
      '&nbsp;&nbsp;◦ <code>kind: \'ups-integrated\'</code> — отличает от моноблока/модульного.',
      '&nbsp;&nbsp;◦ <code>hasIntegratedAts: bool</code> — встроенный входной АВР (-S) или одиночный ввод MCCB (-B).',
      '&nbsp;&nbsp;◦ <code>pdmModules: [{id,label,source,maxBreakers,polarity,screenPrefix}]</code> — до 3 распределительных панелей: PDM-AC (7×3P, на сети), PDM-IT1 (24×1P, на инверторе), PDM-IT2 (24×1P, на байпасе).',
      '&nbsp;&nbsp;◦ <code>cabinetWidthMm/DepthMm/HeightMm/WeightKg</code> — габариты шкафа 600×1200×2000 мм, 338…438 кг.',
      'Файлы: shared/catalogs/ups-kehua-mr33.js (+~110 строк, 4 новых записи в KEHUA_MR33_UPSES).',
    ] },
    { version: '0.59.383', date: '2026-04-26', items: [
      '🔌 <b>Клеммная коробка: автоматов на однолинейке больше нет (если явно не указаны).</b> Жалоба пользователя: «для клеммной коробки не должно быть автоматов на схеме, если явно не указан автомат на выходе. На входе никогда не может быть автомата».',
      '• До этого <code>openPanelControlModal()</code> рисовал автоматы и на входах, и на выходах независимо от <code>switchMode</code>. Для клеммной коробки (<code>switchMode=\'terminal\'</code>) это противоречит ТЗ: вход — пассивный клеммник, выход без защиты — прямое соединение, автомат — только при явно отмеченной <code>n.channelProtection[i]=true</code>.',
      '• Реализован отдельный рендер <code>_renderTerminalBoxControl()</code>:',
      '&nbsp;&nbsp;◦ ВХОД: подпись питателя → лампочка состояния → горизонтальная клеммная риска (без автомата).',
      '&nbsp;&nbsp;◦ ПЕРЕМЫЧКА: между входами в <code>n.channelJumpers</code> рисуется горизонтальная синяя линия НА УРОВНЕ КЛЕММНИКА (до автоматов). Питание распространяется по группе через Union-Find.',
      '&nbsp;&nbsp;◦ ВЫХОД: если <code>channelProtection[i]=true</code> — рисуется автомат (кликабельно on/off). Если нет — прямое соединение клеммник→клеммник, цепь защищена upstream-автоматом (см. recalc.js terminal-passthrough).',
      '• АВР/приоритеты для terminal не показываются (n.switchMode === \'terminal\' исключён из hasAVR ещё в v0.59.327).',
      'Файлы: js/engine/inspector/panel.js (новая функция _renderTerminalBoxControl, ~150 строк; диспетчеризация в openPanelControlModal: terminal → отдельный рендер).',
    ] },
    { version: '0.59.382', date: '2026-04-26', items: [
      '🖱 <b>Layout-связи теперь кликабельны.</b> Доводка v0.59.380.',
      '• До этого hit-line у географических линий не имел класса <code>.conn-hit</code>, а видимая линия — класса <code>.conn</code>; обработчики выбора в <code>interaction.js</code> делают <code>e.target.closest(\'.conn-hit, .conn\')</code> — без класса связь не находилась, клик по линии ничего не делал.',
      '• Добавлены классы и <code>dataset.connId</code> на видимую линию. Теперь связь на layout-странице выделяется и попадает в инспектор.',
      'Файлы: js/engine/render.js (_renderConnsLayout: class=conn-hit / conn).',
    ] },
    { version: '0.59.381', date: '2026-04-26', items: [
      '🔓 <b>Категория и тип потребителя больше не привязывают параметры.</b> Жалоба пользователя: «выбор категории не должен привязывать параметры».',
      '• До этого смена «Категория» автоматически выбирала первый «Тип» из новой категории и dispatched change → handler перезаписывал demandKw/cosPhi/kUse/inrushFactor/curveHint значениями из каталожной записи и ставил <code>catalogLocked=true</code>. Пользовательские значения молча терялись.',
      '• Теперь категория — только фильтр для списка типов; тип — метаданные узла (для показа/скрытия секций вроде «Наружный блок»). Привязка к каталожным параметрам только через явную кнопку «📋 Выбрать из каталога» на вкладке «Общее».',
      '🔢 <b>Возвращена опция «Указание нагрузки» (на единицу / на всю группу) для count > 1.</b> Жалоба: «верни возможность указания мощности группы или единичного, чтобы не пересчитывать вручную».',
      '• До этого dropdown показывался только при включённом «Последовательное соединение». Теперь — всегда при count > 1 (и uniform-режиме). Переключение пересчитывает значение в поле kW (×count или /count) автоматически.',
      'Файлы: js/engine/inspector/consumer.js (cp-loadSpec-wrap всегда виден при count>1; updateDemandUi() без serialMode-зависимости; cp-category change без dispatchEvent; удалён cp-catalog change-handler с авто-привязкой; Apply: total↔per-unit независим от serialMode).',
    ] },
    { version: '0.59.380', date: '2026-04-26', items: [
      '🗺 <b>Phase 2: на layout-странице теперь видны связи между футпринтами как географические линии.</b>',
      '• До этого CSS-правило <code>svg.layout-mode #layer-conns { display:none }</code> полностью прятало слой связей на расстановке — пользователь видел только корпуса карточек без линий между ними.',
      '• Теперь <code>renderConns()</code> на layout-странице вызывает новую ветку <code>_renderConnsLayout()</code>: для каждой связи рисуется прямая линия между центрами футпринтов (W=widthMm, H=depthMm||heightMm). Цвет — по доминирующей системе из <code>getSystemMeta()</code>; damaged → пунктир; disabled → opacity 0.35; selected → толще.',
      '• Это НЕ ортогональная схематическая маршрутизация (waypoints, повороты — задача более поздних фаз), а простой географический connector «откуда — куда».',
      'Файлы: js/engine/render.js (renderConns: layout-branch + новая функция _renderConnsLayout, ~80 строк), app.css (убран #layer-conns из svg.layout-mode display:none правила).',
    ] },
    { version: '0.59.379', date: '2026-04-26', items: [
      '🔑 <b>Fix: счётчик и список шкафов проекта читают правильный ключ.</b> Продолжение фикса v0.59.377.',
      '• До этого <code>projectStats.racks</code> и legacy-детектор «🗄 Шкафы проекта» считали стойки по rackId\'ам в <code>scs-config.contents.v1</code>/<code>scs-config.rackTags.v1</code>. Это «orphan»-данные размещения и тегов; реальные экземпляры физических стоек — в <code>raschet.project.&lt;pid&gt;.rack-config.instances.v1</code> (см. <code>shared/rack-storage.js</code>).',
      '• Теперь сначала смотрим <code>rack-config.instances.v1</code>; если он пуст, fallback на orphan-подсчёт со специальной пометкой «(только размещение/теги — экземпляры отсутствуют, проверьте миграцию)» — это сразу указывает на проблему миграции при v0.59.278.',
      '• Также исправлен ошибочный ключ <code>scs-config.racks.v1</code> (его не существует).',
      'Файлы: projects/project.js (projectStats: rack-config.instances.v1 priority; legacy-rack detector: правильный ключ + fallback-meta).',
    ] },
    { version: '0.59.378', date: '2026-04-26', items: [
      '🏷 <b>scs-design: понятный индикатор «legacy режим» для проектов с до-v0.59.372 СКС-данными.</b>',
      '• До этого, когда пользователь открывал scs-design с <code>?project=&lt;parentId&gt;</code>, и у проекта уже есть СКС-связи/план, но подпроектов нет — dropdown показывал «— подпроект СКС не выбран —», что было запутывающе (данные есть, но «не выбрано»).',
      '• Теперь в этом случае dropdown показывает «— СКС в проекте (legacy, без обозначения) —» и рядом — оранжевый бейдж <b>· legacy режим ⓘ</b> с подсказкой: данные хранятся под id самого проекта; для нескольких вариантов СКС в одном объекте создайте подпроект.',
      'Файлы: scs-design/scs-design.js (renderProjectBadge: legacyActive детектор + альтернативный subOpts placeholder + бейдж).',
    ] },
    { version: '0.59.377', date: '2026-04-26', items: [
      '🐛 <b>Fix: на странице проекта теперь видны схемы, СКС-данные и шкафы проекта (а не только подпроекты).</b> Жалоба пользователя: «у меня есть схема для этого проекта, но на странице проекта нет упоминания о ней, и так же и для СКС».',
      '• <b>Корни проблемы (3 шт.):</b>',
      '• 1. <code>project.html</code> не подгружал <code>js/projects.js</code> — <code>window.Storage</code> был undefined, async-загрузка legacy-схем тихо завершалась без ошибки. Добавлены <code>firebase-*</code>+<code>auth.js</code>+<code>js/projects.js</code> в шапку страницы.',
      '• 2. Вызывался несуществующий метод <code>window.Storage.listProjects()</code> (правильно — <code>listMyProjects()</code>). Исправлено.',
      '• 3. Группы «🔗 СКС-проекты» и «🗄 Компоновки шкафов» рендерились только из <code>listSubProjects()</code>, но у пользователей с до-v0.59.372 данными СКС-связи и стойки лежат в namespace родительского проекта (<code>raschet.project.&lt;p.id&gt;.scs-design.links.v1</code> / <code>.scs-config.contents.v1</code> / <code>.scs-config.racks.v1</code>) — без подпроектов.',
      '• Добавлены два legacy-детектора: если есть СКС-связи/план или стойки в namespace проекта — в соответствующую группу добавляется строка «в проекте» с кнопкой «Открыть →» на <code>scs-design/?project=&lt;p.id&gt;</code> / <code>scs-config/?project=&lt;p.id&gt;</code>.',
      '• Счётчик в шапке группы обновляется с учётом legacy-записей.',
      'Файлы: projects/project.html (загрузка js/projects.js + firebase + auth), projects/project.js (listMyProjects + helper _enrichGroup + legacy SCS/rack detectors).',
    ] },
    { version: '0.59.376', date: '2026-04-26', items: [
      '➕ <b>В Компоновщике шкафа теперь есть кнопка «Новая стойка».</b> Жалоба пользователя: «нет кнопки добавить стойку. Как мне создать новую стойку?».',
      '• В сайдбаре «🗄 Шкафы» (rack.html) добавлена ссылка <b>➕ Новая</b> рядом с «все →».',
      '• Если в проекте ещё нет физических шкафов — empty-state теперь показывает primary-кнопку <b>➕ Новая стойка</b> вместо одинокой ссылки на реестр.',
      '• Обе ведут на <code>scs-config/index.html?new=1</code>; в racks-list.js добавлен авто-триггер wizard «Новая стойка в проект» при <code>?new=1</code> (флаг убирается из URL через history.replaceState).',
      'Файлы: scs-config/rack.html (sc-racks-side-head: ссылка «➕ Новая»), scs-config/scs-config.js (renderRacksSidebar: кнопка в empty-state), scs-config/racks-list.js (auto-открытие wizard при ?new=1).',
    ] },
    { version: '0.59.375', date: '2026-04-26', items: [
      '🔧 <b>«+ Добавить → схему» теперь создаёт настоящую схему, привязанную к проекту, а не подпроект-пустышку.</b> Продолжение фикса v0.59.374.',
      '• До этого «+ Добавить → схему» создавал sub-project (kind=sketch, ownerModule=schematic) — отдельную сущность, не видимую на главной «Мои схемы»; пользовательские реальные схемы оставались за пределами проекта.',
      '• Теперь обработчик для <code>schematic</code> вызывает <code>window.Storage.createProject(name, null)</code> + <code>saveProject(id, {projectId: p.id})</code> и сразу открывает <code>index.html?project=&lt;schemeId&gt;</code>. Схема появляется в обоих списках (главная «Мои схемы» и группа «⚡ Схемы» проекта).',
      '• Остальные «+ Добавить» (СКС-проект / шкаф / модульный ЦОД) по-прежнему создают подпроекты с designation — для них это корректно, у них своё внутреннее состояние и они не отображаются на «Мои схемы».',
      '• Старые sub-project «схемы», созданные до фикса, продолжают рендериться в группе для обратной совместимости.',
      'Файлы: projects/project.js (handler [data-add="schematic"] — Storage.createProject путь).',
    ] },
    { version: '0.59.374', date: '2026-04-26', items: [
      '🐛 <b>Fix: схемы проекта из «Мои схемы» теперь видны на странице проекта.</b> Жалоба пользователя: «почему в проекте нет моей схемы, которая относится к этому проекту».',
      '• После v0.59.373 в группе «⚡ Схемы» отображались только подпроекты (sketch с <code>parentProjectId</code>), но не legacy-схемы из <code>window.Storage</code>, привязанные к проекту через <code>scheme.projectId === p.id</code> (то, что видно на главной «Мои схемы»).',
      '• Теперь после рендера группы запускается асинхронная подгрузка <code>window.Storage.listProjects()</code> с фильтром по <code>projectId</code>; найденные схемы дописываются в группу с бейджем «схема» и кнопкой «Открыть →» на <code>index.html?project=&lt;schemeId&gt;</code>.',
      'Файлы: projects/project.js (после блока обработчиков подпроектов — async-IIFE подгрузки legacy-схем).',
    ] },
    { version: '0.59.373', date: '2026-04-26', items: [
      '🧱 <b>Страница проекта переработана: вместо плашек конфигураторов — кнопка «＋ Добавить» и реестры.</b> Замечание пользователя: «в самом проекте не должно быть плашек конфигураторов, а должна быть кнопка ＋ Добавить (схему, СКС, шкаф) и отдельно реестр всего оборудования и реестр IT-оборудования».',
      '• Удалён grid из 4 статических карточек модулей (Конструктор схем / СКС / scs-config / mdc-config). Вместо них наверху страницы — dropdown «＋ Добавить ▾» с пунктами: схема, СКС-проект, шкаф (компоновка), модульный ЦОД.',
      '• Рядом — две отдельные кнопки реестров: <b>📦 Реестр IT-оборудования</b> (→ scs-config/inventory.html) и <b>🏭 Реестр оборудования объекта</b> (→ facility-inventory/).',
      '• Под кнопками — 4 группы артефактов проекта (схемы / СКС-проекты / компоновки шкафов / модульные ЦОД). Каждый артефакт = подпроект (sketch) с <code>designation</code> (напр. «СКС-1», «Ш-2») и кнопками переименовать/удалить.',
      '• «＋ Добавить → X» спрашивает имя и обозначение, создаёт подпроект через <code>createSubProject()</code>, ставит активным и переходит в модуль.',
      'Файлы: projects/project.js (импорт listSubProjects/createSubProject; полностью переписан блок modulesHost — add-menu + registries + 4 artifact-groups + handlers).',
    ] },
    { version: '0.59.372', date: '2026-04-26', items: [
      '🏗 <b>СКС-проект — теперь подпроект внутри родительского, со своим обозначением.</b> Замечание пользователя: «проект СКС должен быть не как общий проект, а как проект со своим обозначением внутри проекта».',
      '• До этого СКС-«мини-проект» лежал плоско рядом с родительскими full-проектами в одном dropdown\'е → пользователь видел в списке и «25013_Qarmet Темиртау» (родитель), и СКС-черновик как равноценные сущности.',
      '• Теперь в <code>scs-design/</code> два уровня выбора: <b>Проект</b> (родительский full) и <b>СКС-проект</b> (подпроект-sketch внутри него с полем <code>designation</code>). Активный <code>setActiveProjectId()</code> = id подпроекта; project-scoped LS-данные лежат под подпроектом.',
      '• Добавлены поля <code>parentProjectId</code> и <code>designation</code> в <code>createProject()</code>; новые экспортируемые помощники: <code>listSubProjects(parentId, moduleId)</code>, <code>createSubProject(parentId, moduleId, {name, designation})</code>.',
      '• При создании нового СКС-подпроекта пользователь вводит имя и обозначение (напр. «СКС-1»); подпроект виден только внутри своего родителя и только в семействе scs-* модулей.',
      'Файлы: shared/project-storage.js (createProject + listSubProjects + createSubProject), scs-design/scs-design.js (renderProjectBadge: parent + sub-project pickers).',
    ] },
    { version: '0.59.371', date: '2026-04-26', items: [
      '🐛 <b>Fix: «Параметры потребителя» теперь открываются для catalog-locked узлов (часто 1Ф-нагрузки).</b> Жалоба пользователя: «не открываются Параметры потребителя для однофазных потребителей».',
      '• Корень: в <code>openConsumerParamsModal()</code> блок <code>if (n.catalogLocked)</code> на строке ~83 обращался к <code>fullCatalog.find(...)</code>, но переменная <code>fullCatalog</code> была <code>const</code>-declared ниже на строке ~94 → <b>ReferenceError (TDZ)</b>, модалка падала молча.',
      '• Это маскировалось как «не открывается для однофазных», потому что 1Ф-потребители (освещение, бытовые) чаще всего привязываются к каталожным записям (<code>catalogLocked=true</code>).',
      '• Объявление <code>fullCatalog</code> поднято в начало функции, перед первым использованием.',
      'Файлы: js/engine/inspector/consumer.js (openConsumerParamsModal: order of fullCatalog declaration).',
    ] },
    { version: '0.59.370', date: '2026-04-26', items: [
      '🧹 <b>Заголовок группы проекта на «Мои схемы» больше не выглядит как отдельная карточка.</b> Жалоба пользователя: «зачем в проектах, отдельно наряду со схемами, сами проекты???».',
      '• Раньше <code>project-group-head</code> вставлялся в CSS-grid <code>.projects-grid</code> как обычный элемент, занимая колонку 1 → выглядел как «карточка проекта» рядом со схемами.',
      '• Добавлен <code>grid-column:1/-1</code> на header и на кнопку «+ Новый проект (контекст)» — теперь заголовок группы распахнут на всю ширину как нормальный section-divider, а карточки схем идут под ним сеткой.',
      'Файлы: js/main.js (renderCurrentTab: header.style.cssText, ctrls.style.cssText).',
    ] },
    { version: '0.59.369', date: '2026-04-26', items: [
      '🧹 <b>Убрана кнопка «↗ Полноэкранный модуль СКС» с баннера вида страницы в Конструкторе схем.</b> Замечание пользователя: «зачем на схеме слаботочка модуль СКС???».',
      '• На страницах с kind=scs/low-voltage/data баннер показывал ссылку на <code>scs-design/</code>. Это смешивало два разных модуля: Конструктор схем (принципиальные виды) и СКС-проектирование (отдельная сущность с матрицами и связями).',
      '• Теперь на баннере остаётся только иконка+название вида и пометка «бета-вид». Открыть СКС-модуль можно из hub.html / меню проекта.',
      'Файлы: js/engine/render.js (renderPageKindBanner: убран блок <code>extra</code>).',
    ] },
    { version: '0.59.368', date: '2026-04-26', items: [
      '🐛 <b>Fix: «Параметры потребителя» (и аналогичные модалки) теперь открываются всегда.</b> Жалоба пользователя: кнопка «⚙ Параметры потребителя» в инспекторе не открывает модальное окно в некоторых схемах.',
      '• Добавлен defensive event-delegation на <code>inspectorBody</code> в <code>bindInspectorDeps()</code>. Capturing-listener реагирует на клики по кнопкам с известными id (<code>btn-open-consumer-params</code>, <code>btn-open-panel-params</code>, <code>btn-open-panel-control</code>, <code>btn-open-ups-params</code>, <code>btn-open-ups-control</code>, <code>btn-open-ups-battery</code>) и вызывает соответствующую <code>open*Modal(n)</code>.',
      '• Это страховка от race-condition: direct-binding в <code>wireInspectorInputs()</code> мог не успеть привязаться при определённом порядке re-render системных вкладок. Делегирование гарантирует открытие, даже если прямой listener потерян.',
      '• Узел берётся из <code>state.selectedId</code>; защищено try/catch с <code>console.warn</code>.',
      'Файлы: js/engine/inspector.js (bindInspectorDeps + delegated click capture).',
    ] },
    { version: '0.59.367', date: '2026-04-26', items: [
      '⬇⬆ <b>Экспорт/импорт конфигураций — продолжение.</b> Добавлено в rack-config (шаблоны корпусов), mdc-config (модульный ЦОД), scs-config (СКС активного проекта).',
      '• <b>rack-config</b>: схема <code>raschet.rack-config.v1</code>, ключ <code>rack-config.templates.v1</code>. Экспортируются все шаблоны корпусов глобальной библиотеки.',
      '• <b>mdc-config</b>: схема <code>raschet.mdc-config.v1</code>, payload содержит in-memory <code>S</code> (totalRacks/rackKw/redundancy/ASHRAE/ИБП-настройки/слаботочка). При импорте значения проталкиваются в форму и вызывается update().',
      '• <b>scs-config</b>: схема <code>raschet.scs-config.v1</code>. Экспортируются project-namespaced LS-ключи (contents, matrix, cart, rackTags, warehouse) + глобальные (catalog, assemblyTemplates) + список стоек активного проекта в <code>_extra.racks</code>. После импорта — <code>location.reload()</code>.',
      '<b>Итог:</b> экспорт/импорт работает в 8 модулях (panel, ups, pdu, suppression, rack, mdc, scs, mv).',
      'Файлы: rack-config/{index.html,rack-config.js}, mdc-config/{index.html,mdc-config.js}, scs-config/{rack.html,scs-config.js}.',
    ] },
    { version: '0.59.366', date: '2026-04-26', items: [
      '⬇⬆ <b>Экспорт/импорт конфигураций в JSON-файл.</b> Добавлено в panel-config (НКУ), ups-config (ИБП), pdu-config (PDU), suppression-config (АГПТ).',
      '• Новый общий модуль <code>shared/config-io.js</code>: <code>exportConfig({schema, lsKeys, filename, appVersion})</code>, <code>importConfig(file, {schema})</code>, <code>restoreLsKeys(payload)</code>, <code>wireExportImport({exportBtn, importBtn, fileInput, schema, lsKeys, filenamePrefix, appVersion, toast, onAfterImport})</code>.',
      '• Схема файла: <code>{schema, savedAt, appVersion, payload:{&lt;lsKey&gt;:&lt;json&gt;,...}}</code>. При импорте проверяется поле <code>schema</code>.',
      '• Кнопки «⬇ Экспорт» / «⬆ Импорт» добавлены в page-intro каждого модуля. Импорт восстанавливает LS-ключи и вызывает re-render через <code>onAfterImport</code>.',
      '• Схемы: <code>raschet.panel-config.v1</code>, <code>raschet.ups-config.v1</code>, <code>raschet.pdu-config.v1</code>, <code>raschet.suppression-config.v1</code> (плюс ранее <code>raschet.mv-config.v1</code> в v0.59.363).',
      '<b>Очередь:</b> rack-config, scs-config, mdc-config, cable, transformer-config — у них сложнее storage (project-namespaced), будут отдельным батчом.',
      'Файлы: shared/config-io.js (новый), panel-config/{index.html,panel-config.js}, ups-config/{index.html,ups-config.js}, pdu-config/{index.html,pdu-config.js}, suppression-config/{index.html,suppression-config.js}.',
    ] },
    { version: '0.59.365', date: '2026-04-26', items: [
      '🔌 <b>scs-config: порты в 2 ряда для 2U+ patch-panel и 48-портовых коммутаторов.</b> Реальная panel на 48 портов имеет двухрядную раскладку — теперь и в 2D-фасаде, и в 3D-виде.',
      '• Если <code>type.heightU &gt;= 2</code> или <code>type.ports &gt; 24</code> — порты автоматически распределяются в 2 ряда (по <code>ceil(N/2)</code> в каждом).',
      '• Лимит увеличен с 48 до 96 портов на устройство.',
      'Файлы: scs-config/scs-config.js (2D facadeHtml для kind=switch/patch-panel; 3D drawFacade для kind=patch-panel).',
    ] },
    { version: '0.59.364', date: '2026-04-26', items: [
      '🚀 <b>scs-config: авто-переход в Компоновщик при наличии стоек.</b> Список «Шкафы проекта» дублируется сайдбаром Компоновщика — теперь, если в проекте уже есть хотя бы одна стойка или тег, <code>scs-config/index.html</code> автоматически редиректит на <code>rack.html</code>.',
      '• Параметр <code>?list=1</code> в URL отключает редирект (для случаев, когда нужен сам реестр — массовые операции, развёртывание шаблона).',
      '• В breadcrumb компоновщика ссылка «🗄 Шкафы проекта» теперь ведёт на <code>?list=1</code>, чтобы возврат не закольцевал редирект.',
      'Файлы: scs-config/index.html (+inline auto-redirect script), scs-config/rack.html (link → ?list=1).',
    ] },
    { version: '0.59.363', date: '2026-04-26', items: [
      '🧹 <b>Iframe-embed «Проектирование СКС» удалён.</b> Вместо отдельной правой панели в Конструкторе схем — нативный page-kind <code>scs</code>: создайте новую страницу со значением «🔗 СКС» в селекторе вида.',
      '• Удалён <code>#scs-embed-panel</code> и весь сопутствующий код (drag-resize, postMessage-bridge схема↔embed, Ctrl+Shift+L, LS-ключ <code>raschet.scsEmbed.width.v1</code>).',
      '• В <code>PAGE_KINDS_META</code> добавлен <code>scs</code> (🔗 СКС): «Структурированная кабельная: меж-шкафные связи + план зала».',
      '• На баннере вида страницы для kind=scs/low-voltage/data — кнопка «↗ Полноэкранный модуль СКС» (открытие <code>scs-design/</code> в новой вкладке).',
      '• <b>МV-конфигуратор (РУ СН) теперь standalone-конфигуратор.</b> Добавлена панель «Самостоятельная конфигурация»: кнопка «🧙 Запустить wizard», экспорт/импорт JSON.',
      '• Конфигурация сохраняется как <code>raschet.mv-config.v1</code>-схема (requirements + selected + cells).',
      'Файлы: js/engine/state.js (+scs), js/engine/render.js (баннер kind=scs), index.html (-#scs-embed-panel), js/main.js (-iframe-bridge), mv-config/index.html (+standalone-panel), mv-config/mv-config.js (+_startStandaloneWizard, +_exportCurrentConfig, +_importConfigFromFile).',
    ] },
    { version: '0.59.362', date: '2026-04-26', items: [
      '🐛 <b>Fix: «Запросить доступ» больше не открывается для локальных проектов.</b> Проекты, созданные через /projects/ (id-префиксы <code>p_</code>/<code>s_</code>/<code>lp_</code>), хранятся в localStorage. Когда пользователь авторизован в Firebase, <code>window.Storage</code> по умолчанию делегировал в Firestore-адаптер, а тот не находил документ → permission-denied → main.js показывал модалку «Запросить доступ».',
      '• <code>window.Storage.getProject/saveProject/renameProject/deleteProject</code> теперь маршрутизируют локальные id напрямую в <code>Local</code>-адаптер мимо Firestore.',
      '• <code>listMyProjects()</code> объединяет cloud + local-проекты в один список (без дублей по id), чтобы экран /projects/ показывал и облачные, и локальные.',
      '• Добавлен helper <code>isLocalProjectId(id)</code> с regex по префиксам.',
      'Файлы: js/projects.js (window.Storage wrapper, isLocalProjectId, _mergedListMyProjects).',
    ] },
    { version: '0.59.361', date: '2026-04-26', items: [
      '🔄 <b>Обратный sync embed-панель → схема.</b> Замыкает двунаправленную связь после v0.59.360.',
      '• Клик по стойке на план-зале СКС внутри embed-iframe постит <code>{type:\'rs-plan-rack-clicked\', schemeNodeId, rackId}</code> в родительский Конструктор схем.',
      '• Родитель находит узел по schemeNodeId, переключается на его страницу (если задана) и вызывает selectNode — узел выделяется, инспектор открывается.',
      '• postMessage уходит только если стойка действительно материализована из схемы (есть поле <code>schemeNodeId</code>); ручные стойки кликаются как раньше без эффекта на родителя.',
      '<b>Цикл целиком:</b> v0.59.352 (iframe-embed) → v0.59.359 (drag-resize+LS) → v0.59.360 (схема→план) → v0.59.361 (план→схема). Двусторонняя живая связь готова.',
      'Файлы: scs-design/scs-design.js (postMessage в родителя при клике на стойку с schemeNodeId), js/main.js (обработчик rs-plan-rack-clicked).',
    ] },
    { version: '0.59.360', date: '2026-04-26', items: [
      '🎯 <b>Sync схема ↔ embed-панель СКС.</b> При выборе rack-узла в Конструкторе схем соответствующая стойка на план-зале СКС подсвечивается tealiт-пульсацией.',
      '• Родитель (main.js) поллит state.selectedId каждые 250 мс. Если выбран consumer/rack — постит <code>{type:\'rs-scheme-select-rack\', schemeNodeId, tag, count}</code> в iframe scs-design.',
      '• scs-design слушает postMessage и находит все материализованные стойки с <code>schemeNodeId</code>=присланному (count&gt;1 даёт несколько). Добавляет класс <code>.scheme-flash</code> с outline+keyframes-пульсацией; первый элемент scrollIntoView(center).',
      '• При снятии выделения (или выборе не-rack-узла) — postMessage с <code>schemeNodeId:null</code> очищает подсветку.',
      '<b>Что впереди:</b> обратное направление (клик по стойке на плане → выбор узла в схеме); switch на вкладку «План» автоматически если пользователь смотрел «Связи».',
      'Файлы: js/main.js (_wireScsEmbedSelectionSync), scs-design/scs-design.js (window.addEventListener message), scs-design/scs-design.css (.scheme-flash + sd-scheme-pulse keyframes).',
    ] },
    { version: '0.59.359', date: '2026-04-26', items: [
      '↔ <b>Drag-resize и LS-память ширины embed-панели СКС.</b> Расширяет v0.59.352, где была только пошаговая кнопка ⇔ (33→50→67→80%).',
      '• Слева от панели появилась тонкая (8px) draggable-полоса. Hover — подсветка #0d9488; drag ЛКМ — плавный resize. Нижний предел 320px, верхний — vw-200px.',
      '• Во время drag поверх всего ставится прозрачный overlay (z=9999), чтобы iframe не съедал mousemove — иначе курсор «теряется» при пересечении границы.',
      '• Ширина сохраняется в LS-ключ <code>raschet.scsEmbed.width.v1</code> (0.1% шаг). При следующем toggle (Ctrl+Shift+L или кнопка из баннера) панель открывается с прежней шириной.',
      '• Кнопка ⇔ продолжает работать в пресет-режиме (33/50/67/80%) и тоже сохраняет результат.',
      'Файлы: index.html (#scs-embed-divider), js/main.js (_loadScsEmbedWidth/_saveScsEmbedWidth + _wireScsEmbedDivider).',
    ] },
    { version: '0.59.358', date: '2026-04-26', items: [
      '↗ <b>Deep-link к узлу схемы.</b> Бейдж «🔗 на схеме» в реестре IT (v0.59.357) теперь не просто открывает Конструктор, а сразу выделяет нужный узел и подсвечивает его пульсацией.',
      '• URL вида <code>/?project=&lt;pid&gt;&amp;focusNode=&lt;nodeId&gt;</code> запускает в main.js асинхронный лукап (ждём пока engine + проект загрузятся, до 5 сек), затем переключает страницу узла, вызывает <code>selectNode</code> и добавляет CSS-класс <code>.rs-flash-focus</code> с двукратной зелёной пульсацией.',
      '• Параметр <code>focusNode</code> снимается из URL через <code>history.replaceState</code> — повторная перезагрузка не сработает.',
      '• <code>scrollIntoView({block:center, inline:center, behavior:smooth})</code> на DOM-элементе узла — если канвас прокручиваем, прокрутится к нему.',
      'Файлы: js/main.js (_focusSchemeNodeFromUrl + ES-импорты state/selectNode), app.css (rs-flash-focus + keyframes), scs-config/inventory.js (schemeBadge href с focusNode).',
    ] },
    { version: '0.59.357', date: '2026-04-26', items: [
      '🔗 <b>Обратная связь схема → реестр IT.</b> В таблице inventory.html напротив S/N теперь появляется синий бейдж <b>🔗 &lt;tag&gt;</b>, если S/N или Инв.№ устройства совпадает с узлом схемы текущего проекта.',
      '• Лукап делается один раз на render: читаем <code>raschet.project.&lt;pid&gt;.engine.scheme.v1</code> и строим Map по sn/assetId.',
      '• Hover показывает имя/тег узла; клик ведёт в Конструктор схем (../index.html).',
      '• Бейдж stateless: исчезнет автоматически если узел удалят или поменяют S/N — никаких inventoryRef-полей не сохраняется.',
      '<b>Цепочка симметрии:</b> v0.59.351 (узел → бейдж «✓ в реестре IT») и теперь v0.59.357 (запись в реестре → бейдж «🔗 на схеме»). Теперь связь видна с обеих сторон.',
      '<b>Что впереди:</b> такая же обратная связь для facility-inventory; кнопка «↗ перейти к узлу» которая открывает схему и центрирует канвас на конкретном узле.',
      'Файлы: scs-config/inventory.js (loadSchemeIndexBySnAsset + schemeBadge в render).',
    ] },
    { version: '0.59.356', date: '2026-04-26', items: [
      '➕ <b>Prefill в rack.html — замыкает цепочку «узел схемы → новое устройство в стойке».</b> Финальное звено after v0.59.353/355.',
      '• rack.html теперь читает prefillTag/Name/Sn/AssetId из URL и показывает зелёный баннер сверху с этими данными и кнопкой <b>📋 Применить к последнему</b>.',
      '• Workflow: пользователь кликает в каталоге нужный тип → устройство появляется в стойке → нажимает «📋 Применить» → поля label/sn/assetId последнего устройства проставляются, страница перезагружается без prefill-параметров.',
      '• Если стойка пуста на момент клика — кнопка временно показывает предупреждение (без alert/confirm — inline UI согласно code-style).',
      '<b>Цепочка целиком (v0.59.353→355→356):</b> инспектор узла «➕ Создать запись» → inventory.html prefill-баннер → клик по стойке → rack.html prefill-баннер → клик каталога + «Применить» → запись сохраняется, при следующем рендере инспектора схемы матч сработает (v0.59.351).',
      '<b>Что впереди:</b> обратная связь «есть на схеме» в inventory.html (бейдж напротив записи, если её S/N матчится с узлом схемы); inline-создание устройства прямо из инспектора схемы без ручного клика каталога.',
      'Файлы: scs-config/rack.html (inline prefill-banner module).',
    ] },
    { version: '0.59.355', date: '2026-04-26', items: [
      '➕ <b>Prefill-баннер в реестре IT</b> — замыкает цепочку «инспектор узла → создание устройства» из v0.59.353.',
      '• inventory.html теперь читает URL-параметры <code>prefillTag, prefillName, prefillSn, prefillAssetId</code> и при их наличии показывает зелёный баннер сверху: данные узла, кнопка <b>📋 Копировать данные</b>, список стоек проекта (кнопки 🗄 &lt;tag&gt;).',
      '• Клик по стойке ведёт на <code>rack.html?id=&lt;rackId&gt;&amp;prefillTag=…&amp;prefillSn=…</code> — теги пробрасываются дальше; реальный автозаполнитель формы добавления устройства в rack.html — следующий шаг.',
      '• Кнопка ✕ убирает баннер и чистит prefill-параметры из URL (replaceState — без перезагрузки).',
      '<b>Что впереди:</b> чтение prefill в rack.html (форма «добавить устройство» предзаполняется), обратная связь «есть на схеме» в inventory-таблице (бейдж рядом с S/N).',
      'Файлы: scs-config/inventory.html (#inv-prefill-banner), scs-config/inventory.js (renderPrefillBanner).',
    ] },
    { version: '0.59.354', date: '2026-04-26', items: [
      '🗺️ <b>Виртуальные стойки из схемы — drop прямо на план зала.</b> Раньше они были видны только в /scs-config/ и требовали явного клика «Принять» перед размещением.',
      '• В палитре scs-design plan-zal теперь два сорта чипов: обычные (синие, заливка) — реальные размещённые стойки, и <b>📐 виртуальные</b> (зелёные, пунктир, метка «· из схемы») — узлы consumer/rack с count=N из Конструктора, ещё не материализованные.',
      '• Drag «📐 …»-чипа на план: <b>inline-материализация</b> (создаётся inst-* экземпляр в scs-config с тем же autoTag, что и в схеме) → стойка превращается в обычную placed-стойку и принимает позицию dropped-cell. Без отдельных модальных подтверждений.',
      '• Список виртуалов фильтруется: если узел уже материализован раньше (поле <code>schemeNodeId+schemeIndex</code> в реальной стойке совпадает) — чип не показывается, чтобы не плодить дубли.',
      '<b>Что впереди:</b> двусторонний sync план↔схема (move стойки на плане → подсветка узла на холсте); удаление узла из схемы → разрушение связи у материализованной стойки (предупреждение или auto-orphan).',
      'Файлы: scs-design/scs-design.js (palette с virt-chips, drop-handler ветка для virt, _materializeVirtualForPlan), scs-design/scs-design.css (.sd-plan-chip-virt).',
    ] },
    { version: '0.59.353', date: '2026-04-26', items: [
      '🔗 <b>Picker для ручной привязки узла к реестрам проекта</b> — продолжение v0.59.351 (auto-match по S/N).',
      '• Под полем S/N в инспекторе теперь всегда есть две кнопки: <b>«🔗 Привязать вручную…»</b> и <b>«➕ Создать запись в реестре IT»</b>. Раньше была только read-only-плашка матча.',
      '• <b>Picker</b> — модалка со списком всех IT-устройств (по всем стойкам проекта, читается из scs-config contents.v1) и позиций реестра объекта (facility-inventory). Полнотекстовый поиск по имени / S/N / Инв.№ / тегу стойки. Клик по записи — пишет её S/N и Инв.№ в текущий узел (через snapshot — Undo работает).',
      '• <b>Кнопка ➕</b> — открывает /scs-config/inventory.html в новой вкладке с prefill-параметрами (project, prefillTag, prefillName, prefillSn, prefillAssetId). Сам реестр пока эти параметры не читает — это задел; быстрый путь от «не нашёл устройство» к «создал запись».',
      '<b>Что впереди:</b> чтение prefill-* в inventory.html для автозаполнения формы добавления устройства; обратный список «связанные узлы схемы» в реестре IT.',
      'Файлы: shared/inventory-bridge.js (listAllItDevices/listAllFacilityItems), js/engine/inspector.js (модалка _openInventoryPickerForNode + кнопки в renderGeneralPanel + wire в обоих wireInspectorInputs/wireGeneralPanelInputs).',
    ] },
    { version: '0.59.352', date: '2026-04-26', items: [
      '🔗 <b>Inline iframe-embed «Проектирование СКС» в Конструкторе схем.</b> Полноценная встраиваемая панель — следующий шаг после quick-link v0.59.349.',
      '• На страницах с видом 📡 Слаботочка / 🗂 Данные в page-kind баннере появилась кнопка <b>«🔗 Панель СКС»</b>. Клик открывает выезжающую справа панель с iframe scs-design (контекст проекта пробрасывается через URL <code>?project=&from=schematic&embed=1</code>).',
      '• <b>Управление панелью:</b> кнопка ⇔ циклит ширину 33% → 50% → 67% → 80%; ↗ открывает в новой вкладке (полноэкранный режим); ✕ закрывает. Хоткей <b>Ctrl+Shift+L</b> — toggle.',
      '• <b>scs-design</b> распознаёт URL-параметр <code>embed=1</code>: скрывает свой хедер (rs-header-mount) и сжимает отступы — внутри iframe нет дублирования обвязки родителя.',
      '• Резерв «↗ В новой вкладке» рядом с «Панель СКС» сохраняется — для тех случаев, когда нужен полноэкранный модуль.',
      '<b>Что впереди:</b> двусторонняя синхронизация между холстом и СКС-панелью (выделение стойки на схеме → highlight в плане; ресайз через перетягивание разделителя; сохранение последней ширины в LS).',
      'Файлы: index.html (#scs-embed-panel), js/main.js (window.__raschetToggleScsEmbed + Ctrl+Shift+L), js/engine/render.js (renderPageKindBanner: button + wire), scs-design/index.html (embed=1 mode).',
    ] },
    { version: '0.59.351', date: '2026-04-26', items: [
      '🔍 <b>Связь объектов схемы с реестрами проекта (автоматический матч).</b> В инспекторе узла, под полями S/N и Инв.№, теперь появляется бейдж совпадения с реестрами:',
      '• 🟢 <b>«✓ Найден в реестре IT: <имя устройства> · стойка DH1.SR2»</b> — если S/N или Инв.№ узла совпадает с устройством в scs-config contents.v1. Ссылка «→ открыть» ведёт в Реестр IT-оборудования.',
      '• 🟡 <b>«✓ Найден в реестре объекта: <имя>»</b> — для facility-inventory.',
      '• 🔍 <b>«В реестрах проекта не найден»</b> — узел заполнен (S/N или Инв.№), но матча нет.',
      '<b>Архитектура:</b> матчинг автоматический, каждый раз при рендере инспектора. Никаких inventoryRef-полей на узле не добавлено — единственный «якорь» это пользовательские S/N и Инв.№. Это даёт устойчивость к удалению из реестра (бейдж пропадёт сам) и не плодит синхронизационные баги.',
      '<b>Что впереди:</b> явная привязка через picker (если S/N не совпадает, но пользователь хочет связать руками); кнопка «➕ создать запись в реестре» если матча нет; обратное отображение в реестре «есть на схеме».',
      'Файлы: shared/inventory-bridge.js (новый), js/engine/inspector.js (renderGeneralPanel: chip после S/N).',
    ] },
    { version: '0.59.350', date: '2026-04-26', items: [
      '🌐 <b>Доменные секции палитры</b> — раскрывают универсальный характер Конструктора схем без правок ядра.',
      '• <b>📡 СКС / слаботочка</b> (видна на schematic + low-voltage + data) — drag «🗄 Серверная/телеком стойка» создаёт consumer/rack узел, который автоматически развернётся в Компоновщике штучно с уникальным Tag (см. v0.59.345).',
      '• <b>❄ Климат / HVAC</b> (schematic + mechanical) — «❄ Кондиционер / CRAC».',
      '• <b>⚙️ Двигатели / приводы</b> (schematic + mechanical) — «⚙️ Двигатель / насос».',
      '• <b>💡 Освещение</b> (schematic) — «💡 Освещение».',
      'Все секции имеют data-page-kinds и автоматически диммятся на несовместимых страницах (логика из v0.59.346).',
      '• <b>js/engine/interaction.js</b> (drop-handler) — для consumer-узла с подтипом теперь записывает <code>n.subtype</code> и подставляет имя по умолчанию (Стойка/Кондиционер/Двигатель/Освещение). Без этой правки subtype терялся — DEFAULTS.consumer его не читал.',
      '<b>Что впереди:</b> отдельные node-types для пневматики/гидравлики (трубопроводы, насосы, клапаны) — потребуют расширения engine schemas, BOM, render. Пока универсальность достигается через consumer-подтипы.',
      'Файлы: index.html (4 новые pal-type секции), js/engine/interaction.js (subtype apply on drop).',
    ] },
    { version: '0.59.349', date: '2026-04-26', items: [
      '🔗 <b>Quick-link на «Проектирование СКС» из page-kind баннера.</b> На страницах с видом 📡 Слаботочка или 🗂 Данные в баннере над холстом появляется кнопка «🔗 Проектирование СКС →». Клик — переход в /scs-design/ с сохранением проекта (URL <code>?project=&from=schematic</code>) и возможностью вернуться в Конструктор по back-кнопке хедера.',
      '<b>Это первый шаг к встраиваемому блоку СКС.</b> Полноценный inline iframe-embed (как «планировка» в layout-странице) — следующая итерация: придётся аккуратно решить вопросы зум-синка, page-kind-aware рендера и общего state.',
      'Файлы: js/engine/render.js (renderPageKindBanner: extra-кнопка для low-voltage/data).',
    ] },
    { version: '0.59.348', date: '2026-04-26', items: [
      '🔗 <b>scs-design (Проектирование СКС): баннер о виртуальных стойках из схемы.</b> Если в Конструкторе схем размещены consumer/rack узлы, но соответствующие реальные экземпляры ещё не созданы — над сводкой стоек появляется синий баннер «🔗 В Конструкторе схем размещено N виртуальных стоек — Материализовать → Компоновщик шкафа». Это закрывает разрыв между схемой и план-залом: пользователь сразу видит, что часть стоек ещё не готова к проектированию связей.',
      '<b>Почему не размещаем виртуальные сразу на план-зале:</b> у них нет содержимого, корпуса и точного U — для меж-шкафных связей и расчёта длин кабелей нужны реальные данные. Материализация в scs-config даёт inst-* экземпляр с дефолтным корпусом 42U, который можно дорабатывать в Конфигураторе стойки.',
      'Файлы: scs-design/scs-design.js (renderRacksSummary: schemeBanner).',
    ] },
    { version: '0.59.347', date: '2026-04-26', items: [
      '⚡ <b>Bulk-материализация стоек из схемы + детектор orphan’ов.</b> Продолжение v0.59.345.',
      '• В заголовке группы «🔗 Стойки из схемы» появилась кнопка <b>«▸▸ Материализовать все (N)»</b>. Один клик создаёт N реальных <code>inst-*</code> экземпляров с авто-тегами; уже занятые теги пропускаются. Подтверждение через rsConfirm (без браузерного confirm).',
      '• <b>Orphan-детектор:</b> если реальная стойка была материализована из схемы (поле <code>schemeNodeId</code>), но соответствующего виртуального экземпляра больше нет (узел удалён в схеме или count уменьшен), в строке появляется бейдж «⚠ orphan» с tooltip-объяснением. Стойку при этом не удаляем автоматически — у неё может быть содержимое; решение оставлено пользователю.',
      'Файлы: scs-config/racks-list.js (groupHeader actionHtml, rowHtml orphan-флаг, materializeAllFromScheme, isOrphan-индекс).',
    ] },
    { version: '0.59.346', date: '2026-04-26', items: [
      '🌐 <b>Конструктор схем — явно универсальный.</b> Уточнение пользователя: это редактор не только электрических схем, но и гидравлики, механики, СКС, со связью со всеми объектами проекта. Архитектура уже поддерживала виды страниц (page.kind: schematic/low-voltage/data/mechanical/layout/3d) и системы по pageKinds — но это не было видно в UI.',
      '• Подзаголовок палитры: «Конструктор схем · универсальный» с tooltip про переключение видов.',
      '• Над поиском в палитре — индикатор «Страница: ⚡ Принципиальная» (или ⚙ Механика / 📡 Слаботочка / …); меняется автоматически при смене текущей страницы.',
      '• На каждой секции палитры (Источники / НКУ / РУ СН / ИБП / Потребители / Каналы / Зоны) появился атрибут <code>data-page-kinds</code>. Несовместимые с текущим видом секции дим-атся (opacity 0.45) и получают tooltip — пользователь видит, что элемент «не для этого вида», но не блокируется.',
      '• Логика — в <code>renderPageKindBanner()</code> (js/engine/render.js): один проход по секциям при смене страницы.',
      '<b>Что впереди:</b> отдельные палитры для механики (трубы/арматура/насосы), СКС (патч-панели/коммутаторы как блоки на схеме), гидравлики; встраиваемый блок «Проектирование СКС» внутрь схемы.',
      'Файлы: index.html (#pal-page-kind-bar + data-page-kinds на pal-type), js/engine/render.js (renderPageKindBanner: обновление палитры).',
    ] },
    { version: '0.59.345', date: '2026-04-26', items: [
      '🔗 <b>Стойки из схемы → штучно с уникальным Tag в Компоновщике шкафа.</b> Раньше один consumer/rack-узел в Конструкторе схем с count=N показывался как одна позиция в реестре стоек проекта. Теперь:',
      '• <b>shared/scheme-rack-bridge.js (новый)</b> — <code>loadSchemeVirtualRacks(pid)</code> читает <code>raschet.project.&lt;pid&gt;.engine.scheme.v1</code>, находит узлы <code>type=consumer + subtype=rack</code> и раскрывает count=N в N виртуальных позиций с детерминированными id (<code>scheme-&lt;nodeId&gt;-&lt;i&gt;</code>) и авто-тегами вида <code>&lt;tag&gt;-1, &lt;tag&gt;-2…</code> (если count=1 — просто <code>&lt;tag&gt;</code>).',
      '• <b>scs-config/racks-list.js</b> — отдельная группа в реестре «🔗 Стойки из схемы (Конструктор) — авто». У каждой строки кнопка «▸ Материализовать» — создаёт реальный <code>inst-*</code> экземпляр с этим тегом. После материализации виртуальная позиция автоматически скрывается (тег уже в rackTags).',
      '• Уникальность авто-тегов гарантирована раскрытием count: если в схеме нарисованы 3 узла «SR» с count=1,2,3 — в списке появятся <code>SR, SR-1, SR-2, SR-1, SR-2, SR-3</code> (дубликаты решает пользователь, переименовав узлы в схеме).',
      '<b>Что впереди:</b> размещение виртуальных стоек на план-зале scs-design без обязательной материализации; bulk-материализация всех «из схемы»; синхронизация удалённых узлов схемы (виртуальные пропадают сами, но реально материализованные требуют чистки).',
      'Файлы: shared/scheme-rack-bridge.js (новый), scs-config/racks-list.js (rowHtmlScheme + materializeFromScheme + merge in render).',
    ] },
    { version: '0.59.344', date: '2026-04-26', items: [
      '🧭 <b>Hub-aware навигация + детальный экран проекта + курируемый набор модулей.</b> По требованиям пользователя:',
      '• На <b>главном экране /hub.html</b> теперь НЕ рендерится back-кнопка и project-badge — это корневой экран. <code>shared/app-header.js</code> распознаёт moduleId=hub и пропускает push в back-stack и link-rewriter.',
      '• <b>Direct-entry режим</b> (URL без <code>?project=</code>): app-header не дописывает project-параметры на ссылки между модулями — переходы остаются «штучными», без принудительного контекста проекта.',
      '• <b>/projects/ — только перечень.</b> С карточек проекта убраны чипы 14 конфигураторов; вместо них одна кнопка «Открыть проект →» на детальный экран. Экспорт-схему/применить-схему перенесены на детальный экран.',
      '• <b>projects/project.html (новый)</b> — детальная карточка одного проекта: head со статусом/описанием/статистикой, секция «Модули проекта» (курируемый набор), секция «Действия с проектом», метаданные.',
      '• <b>Курируемый набор</b> (только то, что имеет смысл в контексте проекта): Конструктор схем, Проектирование СКС, Компоновщик шкафа, Реестр IT-оборудования, Реестр оборудования объекта, Модульный ЦОД. <b>НЕ</b> в проекте (но доступны с hub.html и из других модулей по контексту): cable, mv-config, ups-config, panel-config, pdu-config, transformer-config, suppression-config, rack-config — это «штучные» инструменты для разовых расчётов.',
      '• <b>Конструктор схем — универсальный</b> (уточнение): не только электрика, но и гидравлика, механика, СКС, связан со всеми объектами проекта. Описание модуля в карточке обновлено.',
      '• Из карточки проекта переход в любой модуль несёт <code>?project=&from=project-detail</code> — back-кнопка ведёт обратно на детальный экран.',
      '<b>Что ещё впереди:</b> серверные стойки из схемы → штучно с Tag в Компоновщик СКС, Проектирование СКС как embeddable блок внутри Конструктора схем, per-module project-gate для шаблонных конфигураторов.',
      'Файлы: shared/app-header.js (hub/projects-list awareness), shared/project-context.js (MODULE_LABELS+project-detail), projects/projects.js (chip-block→Открыть проект), projects/project.html (новый), projects/project.js (новый), projects/projects.css (стили pr-mod-card/pr-meta-table).',
    ] },
    { version: '0.59.342', date: '2026-04-26', items: [
      '🧭 <b>Project-context через URL + back-stack между конфигураторами (фундамент Фазы 1.27.7).</b> Раньше «активный проект» жил только в localStorage — переход «Конструктор схем» из карточки проекта не передавал контекст, нельзя было открыть несколько проектов в разных вкладках, а из конфигуратора нельзя было вернуться в предыдущий. Теперь:',
      '• <b>shared/project-context.js</b> (новый) — <code>getProjectContext()</code> читает <code>?project=&from=</code> из URL (приоритетнее LS); <code>buildModuleHref(href, {projectId, fromModule})</code> дописывает параметры; back-stack живёт в sessionStorage (до 8 шагов); <code>navigateBack()</code> возвращает на предыдущий модуль.',
      '• <b>shared/app-header.js</b> — автоматически: (1) пушит текущую страницу в back-stack при init; (2) рендерит project-badge с именем активного проекта (клик → /projects/); (3) рендерит ←-кнопку с лейблом предыдущего модуля; (4) перехватывает клики по <code>&lt;a&gt;</code> на другие модули и дописывает <code>?project=&from=&lt;текущий&gt;</code> на лету — все 14+ модулей получают наследование контекста бесплатно.',
      '• <b>projects/projects.js</b> — карточка ЛЮБОГО проекта (не только активного) показывает чипы всех 14 конфигураторов с готовыми <code>?project=<pid>&from=projects</code>; список расширен (cable, mv-config, ups-config, panel-config, pdu-config, transformer-config, mdc-config, suppression-config, rack-config). Клик по чипу очищает back-stack — это «корневой» переход.',
      '• <b>shared/app-header.css</b> — стили <code>.rs-back-btn</code> и <code>.rs-proj-badge</code>.',
      '<b>Что ещё впереди (Фаза 1.27.8+):</b> per-module project-gate (фильтр list-видов конфигураторов к текущему проекту, скрытие project-items в direct-entry режиме), унификация хедера в root /index.html (Конструктор схем — пока со своим editor-specific хедером).',
      'Файлы: shared/project-context.js (новый), shared/app-header.js, shared/app-header.css, projects/projects.js.',
    ] },
    { version: '0.59.278', date: '2026-04-22', items: [
      '📄 Кнопка «Копировать» у проекта: создаёт копию метаданных и всех scoped-данных (raschet.project.<pid>.*). Экземплярам стоек выдаются новые inst-* id, ссылки на них в других ключах проекта (contents, matrix, rackTags) автоматически переписываются через id-map. Глобальные данные (шаблоны корпусов, каталог IT-типов) — общие, не копируются.',
      '📄 Кнопка «📄 Копия» у мини-проекта — такой же механизм, без подтверждения (черновики быстро клонируются).',
      'Файлы: shared/project-storage.js (copyProject), projects/projects.js (кнопки + обработчики).',
    ] },
    { version: '0.59.245', date: '2026-04-22', items: [
      '🔗 В rack-config (Конфигуратор стойки) в standalone-режиме появился левый сайдбар со всеми сохранёнными типами стоек. Важно для /projects/: сайдбар видит не только глобальные шаблоны, но и конфигурации из любого проекта (full и sketch) — вход raschet.project.<pid>.rack-config.templates.v1. Проект/мини-проект проставляется чипом в строке. Так из одной точки (rack-config) можно подхватить стойку из любого проекта и использовать как основу.',
      'Подробности — в changelog rack-config v0.59.245.',
    ] },
    { version: '0.59.243', date: '2026-04-22', items: [
      '🧪 Аудит мини-проектов — на странице /projects/ внизу списка появилась свёрнутая панель «Мини-проекты (N)». Показывает все sketch-проекты, сгруппированные по ownerModule (scs-design / scs-config / mv-config / …). Для каждого — имя, статистика наполненности (узлы/стойки/связи/IT/объект), дата последнего изменения и кнопка «Удалить» (каскадно). В основной список sketches по-прежнему не попадают (v0.59.236).',
      'Зачем: мини-проекты живут только в dropdown своего модуля, и при накоплении «брошенных» черновиков их было негде увидеть/почистить централизованно. Теперь — есть.',
      'Файлы: projects/projects.js (renderSketches + panel), projects/index.html (#pr-sketches mount).',
    ] },
    { version: '0.59.242', date: '2026-04-22', items: [
      '🗑 Удаление проекта теперь каскадное: deleteProject(id) по умолчанию стирает и метаданные (raschet.projects.v1), и все scoped-данные (raschet.project.<pid>.*). Раньше scoped-ключи оставались «бесхозными» в LS и захламляли хранилище, а статистика других проектов не менялась — но данные всё равно были недоступны без метаданных.',
      '👁 Confirm-диалог удаления теперь показывает, что именно будет стёрто: «Будут стёрты project-scoped данные: ⚡N узл · 🗄N стоек · 🔗N связей · 📋N IT · 🏭N поз. объекта. Действие необратимо.» Для пустого проекта — «(в проекте нет данных — удаление безопасно)». Toast после удаления: «✔ Удалено (стёрто N ключей LS)».',
      'Флаг { keepData: true } позволяет удалить только метаданные (для миграций/админки).',
      'Файлы: shared/project-storage.js (deleteProject cascade + clearProjectData), projects/projects.js (delete handler preview + toast).',
    ] },
    { version: '0.59.241', date: '2026-04-22', items: [
      '🐛 Fix: бейджи в карточке проекта считали неправильные ключи. (1) «стоек» читал несуществующий raschet.project.<pid>.rack-config.templates.v1 — шаблоны стоек глобальны. Исправлено: считаем стойки проекта по scs-config.contents.v1 + racktags.v1 (стойка «в проекте», если есть устройства или тег). (2) «IT-устройств» читал несуществующий scs-config.inventory.v1 — теперь суммируем устройства из contents.v1 по всем стойкам. (3) «поз. объекта» читал facility-inventory.items.v1 — правильный ключ facility-inventory.v1.',
      'Ярлыки бейджей расширены до читаемых («узл. в схеме», «стоек», «связей», «IT-устройств», «поз. объекта») вместо 3-буквенных сокращений.',
      'Файлы: projects/projects.js (projectStats + statsBadges labels).',
    ] },
    { version: '0.59.240', date: '2026-04-22', items: [
      '📊 Фаза 1.27.6 — бейджи содержимого в карточке проекта. Для каждого проекта считаем: узлов в схеме (engine.scheme.v1), типов стоек (rack-config.templates.v1), меж-шкафных связей (scs-design.links.v1), позиций в реестрах IT и объекта. Показываем компактными чипсами под описанием. Если проект пустой — «· пусто». Удобно понять, какой из проектов реально наполнен, а какой — пустой контейнер.',
      'Файлы: projects/projects.js (projectStats + statsBadges + рендер в pr-project-stats).',
    ] },
    { version: '0.59.239', date: '2026-04-22', items: [
      '🛡 rack-config: защита от уменьшения U-размера стойки, если в неё уже установлено оборудование (в scs-config). При попытке уменьшить U — сканируем все ключи raschet.project.*.scs-config.contents.v1, ищем записи с этим rackId и максимальный positionU. Если новый U меньше верхнего занятого юнита — откат значения и toast: «Нельзя: в стойке размещено N устройств, верхний U{pos} не помещается в {newU}U. Сначала удалите/перенесите в Компоновщике».',
      'Файлы: rack-config/rack-config.js (readForm — guard на rc-u перед присваиванием t.u).',
      '📌 Отложено (по запросу): (1) левый sidebar рак-конфига со списком сохранённых типов стоек в standalone; (2) двустороннее размещение оборудования (front/rear rails) + учёт глубины оборудования и коллизий; (3) вид сбоку; (4) 3D-вид. Спавнены как отдельные задачи.',
    ] },
    { version: '0.59.238', date: '2026-04-22', items: [
      '🏷 Фаза 1.27.5 — статусы проектов. 5 уровней: «Черновик» (серый) · «Проектируется» (синий) · «Смонтирован» (янтарный) · «Эксплуатируется» (зелёный) · «Архив» (светло-серый, dim). Статус отображается бейджем в заголовке карточки. Меняется кнопкой «Статус ▾» — открывается inline-picker с цветными маркерами.',
      '📂 Архивные проекты скрываются из общего списка по умолчанию. Над списком — чекбокс «Показать архивные N» (счётчик). Активное значение сохраняется только в runtime (переоткрытие страницы = снова скрыты).',
      'Данные: updateProject(id, {status}) — поле уже существовало, теперь им можно управлять. Поле persist-ится в LS (raschet.projects.v1) и в Экспорт JSON проекта.',
      'Файлы: projects/projects.js (STATUSES + prStatusPicker + status-бейдж + фильтр), projects/index.html (#pr-status-filter mount).',
    ] },
    { version: '0.59.237', date: '2026-04-22', items: [
      '⚠ Project-badge в главном Конструкторе теперь показывает предупреждение, если активен мини-проект (kind="sketch"): «🧪 Мини-проект: <имя> · выбрать полноценный →». В tooltip: «Главный Конструктор рассчитан на полноценный проект. Перейдите в /projects/ и активируйте настоящий (или создайте новый)». Это закрывает edge-case после фильтра /projects/ в v0.59.236: если пользователь активировал sketch из scs-design, а потом открыл главную схему — он видит явное предупреждение.',
      'Файлы: js/engine/export.js (pkind/powner в badge + ветка sketch с жёлтым бейджем).',
    ] },
    { version: '0.59.236', date: '2026-04-22', items: [
      '🧹 /projects/ список отфильтрован: мини-проекты (kind="sketch", id с префиксом s_) больше не показываются в общем списке. Они создаются из мастеров конкретных модулей (scs-design → «＋ Мини-проект») и живут только в dropdown-переключателе этого модуля. Центр /projects/ — только настоящие полноценные проекты объекта.',
      'Файлы: projects/projects.js (render() фильтрует по kind !== "sketch").',
    ] },
    { version: '0.59.235', date: '2026-04-22', items: [
      'ℹ Project-badge в Конструкторе схем получил подсказку (tooltip + ⓘ): «Список проектов локален для этого браузера (localStorage). На другом компьютере id проектов не совпадают — одна и та же схема может быть привязана к разным проектам. Для синхронизации — Экспорт JSON в карточке проекта + Импорт на другом устройстве. Cloud-sync — Фаза 5.5».',
      'Это объясняет типовой сценарий: на ПК-А проект «25006-GEP-…», на ПК-Б «Проект по умолчанию», но схема одна и та же — потому что ensureDefaultProject() на ПК-Б создал новый локальный проект с другим id, пока раschet.scheme (legacy) был общей точкой старта.',
      'Файлы: js/engine/export.js (hint + title + ⓘ в project-badge).',
    ] },
    { version: '0.59.234', date: '2026-04-22', items: [
      '🐛 Fix: изменения в Конфигураторе ИБП (и других per-user каталогах: АКБ, щиты, трансформаторы, кабели, контрагенты, цены, логистика, библиотека элементов) «откатывались» после Ctrl+F5. Причина: shared/auth.js в setTimeout-fallback через 2 сек перезаписывал localStorage["raschet.currentUserId"] на "anonymous", если Firebase ещё не ответил. storageKey() в per-user каталогах (raschet.<кат>.v1.<uid>) резко переключался на anonymous-срез, и пользователь видел пустой / старый справочник. После возврата Firebase кеш возвращался к реальному uid, но визуальное окно «отката» оставалось.',
      'Решение: notify({definitive:false}) в таймаут-fallback не трогает LS-кеш uid — только уведомляет listener-ов что auth-state «неизвестен». Перезапись на "anonymous" теперь происходит только когда Firebase явно сообщил onAuthStateChanged(null) или SDK/конфиг недоступны (локальный режим).',
      'Файлы: shared/auth.js (cacheCurrentUserId + notify с флагом definitive). В справке ups-config добавлен раздел «Где хранятся ваши данные» с описанием per-user ключа и этого исправления.',
    ] },
    { version: '0.59.233', date: '2026-04-22', items: [
      '📚 Справочники — в левый выдвижной сайдбар. shared/reference-panels.js переписан: секции с data-reference-panel="1" автоматически переносятся в фиксированный левый drawer (420px, скрыт по умолчанию). Снаружи — узкий вертикальный таб-хэндл «📚 Справочник» слева, по клику drawer выезжает с backdrop-оверлеем. Esc / клик по backdrop / кнопка ✕ — закрыть. Состояние open/closed запоминается в localStorage на каждую страницу (raschet.refDrawer.open.v1:<path>). Применено в ups-config, panel-config, mv-config, transformer-config.',
      'Зачем: справочник — это БД, а не ежедневный инструмент. В конце страницы всё равно мешал прокруткой. Теперь основной рабочий флоу (мастер / параметры / расчёт) занимает весь экран, а справочник вызывается одним кликом.',
      'Файлы: shared/reference-panels.js (drawer + handle + backdrop + LS-persist).',
    ] },
    { version: '0.59.232', date: '2026-04-22', items: [
      '🛡 scs-config: запрет удаления/«на тележку» для оборудования с подключённым кабелем. Проверяется наличие связей в raschet.project.<pid>.scs-design.links.v1 (fromDevId/toDevId). При попытке — inline-toast «Нельзя удалить: подключено N кабелей. Сначала удалите связи в Проектирование СКС». Guard на обоих путях: [data-del] и moveToCart().',
      '📚 shared/reference-panels.js — общий auto-script: ищет элементы с data-reference-panel="1" на DOMContentLoaded и переносит их в конец родительского контейнера, с разделителем «📚 Справочники / база данных». Применён в battery, ups-config, panel-config, mv-config, transformer-config. Цель: справочники перестают занимать верхний экран, основная рабочая область видна сразу.',
      'Файлы: scs-config/scs-config.js (hasAttachedCables/countAttachedCables + guards в двух путях удаления), shared/reference-panels.js (новый), battery/index.html + ups-config/index.html + panel-config/index.html + mv-config/index.html + transformer-config/index.html (data-reference-panel="1" + подключение скрипта).',
    ] },
    { version: '0.59.230', date: '2026-04-22', items: [
      '🔀 Фаза 1.27.2 — главная схема Конструктора переведена на проектный неймспейс. Кнопки «💾 Сохр. локально» и «📂 Загр. локально» теперь сохраняют/читают ключ raschet.project.<pid>.engine.scheme.v1 активного проекта. Одноразовая миграция: если в проекте пусто, а в глобальном raschet.scheme есть схема — она копируется в активный проект при первом save/load, чтобы пользователь не потерял работу.',
      'В боковой панели Конструктора над кнопкой «💾 Сохр. локально» появился бейдж «📁 Проект: <имя> · сменить →» со ссылкой на /projects/. Если активного проекта нет — «⚠ Вне проекта · выбрать проект →».',
      'Теперь типичный сценарий переноса самостоятельной схемы в конкретный проект упрощён: (1) создать/активировать проект в /projects/, (2) открыть Конструктор — схема автоматически будет сохраняться в этот проект. Кнопки «⬇ Взять глобальную схему» / «⬆ Применить в Конструкторе» в карточке проекта остаются как ручной инструмент для нестандартных случаев.',
      'Файлы: js/engine/export.js (schemeKey() + save/loadLocalFn + project-badge), index.html (div#rs-project-badge в sidebar перед кнопками «Файл»).',
    ] },
    { version: '0.59.229', date: '2026-04-22', items: [
      '🔧 Fix футера: найден и экранирован неэкранированный апостроф в записи v0.59.183 («preset\'а»), из-за которого shared/module-changelogs.js не парсился и mountFooter падал во всех модулях с ошибкой «[footer] Unexpected identifier». Это уже второй раз такая же ошибка (первый — v0.59.128, слово «inline-select\'ы»). Файл: shared/module-changelogs.js.',
      'Блок ссылок «Все программы · Каталог · GitHub ↗» убран из нижнего футера (shared/app-footer.js): DEFAULT_LINKS = []. Навигация по платформе — через «🏠 Хаб» в шапке и /modules/. Сам футер оставлен (версия + копирайт).',
      'Правило: при добавлении новых модулей или изменении их назначения — обновлять страницу /modules/ (modules/index.html), чтобы каталог оставался полным.',
    ] },
    { version: '0.59.228', date: '2026-04-22', items: [
      '🧭 Новая страница /modules/ — полный каталог модулей платформы (включая те, что доступны только внутри проекта: «Реестр IT-оборудования», «Реестр оборудования объекта»). Сгруппировано по разделам: Управление проектом, Электротехника, Инфраструктура ЦОД, Климат и пожаротушение, Каталоги и логистика, Документация. Теги standalone / в-проекте / draft / инфо.',
      'Главное окно (hub.html) вычищено: удалены плитки «Roadmap», «История изменений», «Конфигуратор трансформатора». Вместо них — одна плитка «🧩 Модули» с ссылкой на /modules/ (туда же перенесены Roadmap и Changelog).',
      '🔀 Перенос схемы Конструктора в проект: в карточке проекта появились кнопки «⬇ Взять глобальную схему» (копирует текущую раschet.scheme в raschet.project.<pid>.engine.scheme.v1) и «⬆ Применить в Конструкторе» (перезаписывает глобальную схему проектной). Позволяет превратить самостоятельно нарисованную схему в часть проекта и наоборот — без ручной возни с LS-ключами.',
      '🧩 pdu-config: баннер «Открыть стойку →» и кнопка «Открыть Конфигуратор стойки →» в карточке PDU больше не показываются, если конфигуратор открыт как отдельное приложение (из главного окна или /modules/). Появляются только когда пришли из rack-config (document.referrer).',
      'Файлы: modules/index.html (новый), hub.html (удалены 3 плитки, добавлена «Модули»), projects/projects.js (import-scheme / apply-scheme хендлеры + 2 новые кнопки в pr-project-actions), pdu-config/pdu-config.js (renderPendingBanner фильтр по referrer).',
    ] },
    { version: '0.59.226', date: '2026-04-22', items: [
      '🧪 Мини-проекты внутри модулей: мастер меж-шкафных связей (scs-design) и внутри-шкафные связи (scs-config) теперь могут работать в рамках «мини-проекта» (kind=sketch), создаваемого прямо изнутри модуля — без обязательного похода в /projects/. Мини-проект привязан к модулю (ownerModule) и не замусоривает список «настоящих» проектов.',
      'Project-switcher в topbar scs-design: dropdown со всеми полноценными проектами (🏢) + мини-проектами СКС (🧪). Кнопка «＋ Мини-проект» — inline-модалка с именем, создаёт sketch, сразу активирует, перезагружает страницу.',
      'project-storage.js: createProject({kind, ownerModule}), createSketchForModule(moduleId, name), listProjectsForModule(moduleId). ID префикс: «p_» для full, «s_» для sketch.',
      'Фаза 1.27.4 начата — exportProject / importProject переписаны: scoped-данные собираются сканированием LS по префиксу raschet.project.<pid>. (ранее использовался неверный _raw-namespace). Полный backup/share проекта теперь реально работает.',
      'clearProjectData(pid) — очистка всех scoped данных (без удаления метаданных проекта).',
      'Файлы: shared/project-storage.js (createSketchForModule/listProjectsForModule/clearProjectData/collectScoped + correct export/import), scs-design/{scs-design.js (project-switcher + sdPrompt inline-модалка), scs-design.css (.sd-project-bar select, .sd-overlay, .sd-modal)}.',
    ] },
    { version: '0.59.225', date: '2026-04-22', items: [
      'Реестры (Реестр IT-оборудования, Реестр оборудования объекта) убраны с hub.html как самостоятельные модули. По архитектурному требованию: «модули с названием Реестр должны относиться только к проекту или к конфигурации модуля — сами по себе использоваться не могут». Доступ к ним теперь только через карточку активного проекта в /projects/ или через breadcrumbs изнутри scs-config.',
      'Баннер «📁 Проект: <имя>» добавлен в scs-config/inventory.html и facility-inventory/index.html. Если активного проекта нет — показывается предупреждение с ссылкой на /projects/.',
      'В inventory breadcrumb теперь: «📁 Проекты › 🗄 Шкафы проекта › 📋 Реестр IT» — путь обратно в проект.',
      'Файлы: hub.html (удалены плитки реестров), scs-config/{inventory.html, inventory.js, scs-config.css}, facility-inventory/index.html (инлайн модуль-скрипт с ensureDefaultProject).',
    ] },
    { version: '0.59.222', date: '2026-04-22', items: [
      '🆕 Новый модуль «📁 Проекты» — центр управления проектами объектов. Каждый проект = единица проектной работы (схема электроснабжения + СКС + шкафы + реестры + заметки). LS: raschet.projects.v1 (метаданные), raschet.activeProjectId.v1 (активный).',
      'MVP v1 (Фаза 1.27.0): создать / переименовать / удалить проект, сделать активным, экспорт/импорт JSON (schema «raschet.project/1»), бейдж «активен» у карточки. Inline-модалки (без window.prompt/confirm/alert). Автосоздание «Проекта по умолчанию» при первом открытии.',
      'Архитектурный разворот: данные проекта должны жить в проекте, конфигураторы (rack-config, mv-config, ups-config и др.) — это только библиотека шаблонов. Фаза 1.27.1-1.27.4 переведёт данные scs-design / схемы / шкафов / реестров в проектный неймспейс (raschet.project.<pid>.<module>.*) через адаптер shared/project-storage.js. Сейчас данные модулей ещё в общих ключах — миграция постепенная.',
      'Заложена архитектура для продаваемых/отдельно-деплоимых модулей (в частности «Управление объектом» — для действующих объектов с мониторингом): связь модулей через JSON-контракты со schema-version, адаптер project-storage абстрагирует LS vs HTTP. Выделено в отдельный большой финальный этап — «Фаза X» в конце ROADMAP.md (отдельный продукт, отдельный деплой, manifest.json с semver, независимые обновления, лицензирование).',
      'Файлы: projects/{index.html, projects.js, projects.css}, shared/project-storage.js (MVP API: listProjects/createProject/updateProject/deleteProject/getActiveProjectId/setActiveProjectId/ensureDefaultProject/projectKey/projectLoad/projectSave/exportProject/importProject), hub.html (плитка «📁 Проекты» первой).',
    ] },
  ],
  'scs-design': [
    { version: '0.59.325', date: '2026-04-23', items: [
      '🔀 <b>Сходимость fill-map: 2 прохода.</b> Раньше <code>computeTrayFills</code> вызывал <code>buildCableRoute</code> без <code>fillsMap</code>, а <code>drawPlanLinks</code> потом строил маршруты с ним. Как итог маршруты в fills-подсчёте и в отрисовке могли разойтись → popover канала показывал не те кабели, что на самом деле через него проходят. Теперь две прохода: 1-я без штрафа → даёт <code>prev</code>; 2-я с <code>prev</code> в качестве fill-map → стабильный результат. Тот же <code>prev</code> передаётся в <code>drawPlanLinks</code>, так что отрисовка и fills используют один и тот же маршрут.',
      '⚡ <b>Группировка в computeTrayFills.</b> Связи между одной парой стоек теперь считаются как одна группа: маршрут строится один раз, и для каждого кабеля группы <code>usedMm2</code> увеличивается на площадь его сечения. Раньше <code>buildCableRoute</code> звался N раз для N кабелей одной пары — лишняя работа.',
      '🪢 <b>Стыковка каналов T/+/L переписана.</b> Model: bbox + 4 направляющие (2 стены, 2 конца). Для каждой пары «актив + сосед» проверяем: перпендикулярные → выравнивание стен/центров при перекрытии по оси + L-углы торцов; коллинеарные → стык торцами. Радиус snap 1.8 клетки (было 1). Убран <code>Math.round</code> — float-координаты сохраняются, канал ложится ровно на стену соседа независимо от шага сетки.',
      'Файлы: scs-design/scs-design.js (computeTrayFills с prevFills + grouping; snapTrayPosition — bbox-based snap).',
    ] },
    { version: '0.59.324', date: '2026-04-23', items: [
      '🧵 <b>«Линия прохода кабелей» вместо N одинаковых путей.</b> Все связи между одной и той же парой стоек теперь сливаются в ОДНУ визуальную линию (автоматическая «виртуальная трасса», такая же как канал, только инферится). Толщина линии растёт логарифмически с количеством кабелей (log₂N × 1.4 + 2, cap 8 px). В середине — бейдж «×N» (если N&gt;1). Цвет — нейтральный серый (группа может содержать кабели разных типов). Раньше каждая связь рисовалась отдельно, накладываясь на предыдущую → визуально неразличимо, но пользователь сообщал о «нескольких параллельных путях между двумя шкафами».',
      '📏 <b>Канал обязателен, если он ближе direct-прямой.</b> Раньше <code>buildCableRoute</code> мог выбрать direct, если обход по каналу выходил длиннее. Теперь сначала фильтрация каналов: «достижимые» = те, до которых ближе, чем <code>interRack</code> (manhattan-расстояние между стойками). Если есть хоть один достижимый канал — direct ЗАПРЕЩЁН, выбор только среди tray-маршрутов. Соответствует реальной прокладке: кабели ложатся в лотки, не идут по воздуху.',
      'Эффект: (1) группы кабелей видны единой линией с подписью количества; (2) линии гарантированно используют канал, если он физически достижим; (3) <code>computeTrayFills</code> теперь корректно суммирует площади всех кабелей группы (по-прежнему per-link, а не per-group).',
      'Файлы: scs-design/scs-design.js (drawPlanLinks — groupBy пары стоек; buildCableRoute — фильтр reachable + allowDirect).',
    ] },
    { version: '0.59.323', date: '2026-04-23', items: [
      '🧮 <b>Переписан выбор трассы кабеля: min по всем кандидатам, а не эвристика.</b> Раньше <code>buildCableRoute</code> использовал правило «если ближайший канал дальше, чем расстояние между стойками — идём напрямую». Это отбрасывало канал даже в случаях, когда трасса через него была короче обходной. Теперь алгоритм строит ВСЕ кандидат-трассы (direct, single-tray для каждого канала, two-tray для каждой перпендикулярной пары), считает Manhattan-длину каждой с fill-штрафом (до 1.75× при 150%) и выбирает минимум.',
      'Эффект: кабель, который визуально идёт мимо канала (хотя заход стоит 5% длины), теперь в него заходит. Это автоматически чинит «каналы показывают 0% и нет кабелей»: через них реально проходят трассы, <code>computeTrayFills</code> видит их.',
      'Two-tray кандидаты строятся только для перпендикулярных пар (H+V), т.к. хоп между параллельными каналами вырождается (один из них доминирует).',
      'Файлы: scs-design/scs-design.js (buildCableRoute — перебор кандидатов с выбором минимума по взвешенной длине).',
    ] },
    { version: '0.59.322', date: '2026-04-23', items: [
      '🐛 <b>Fix: drag стойки сбрасывал поворот в 0°.</b> В обработчике <code>pointerup</code> сохранялось <code>{ x, y }</code> без <code>rot</code>, и после перемещения стойка «разворачивалась» в дефолтное положение, теряя предыдущий угол. Теперь rot читается из <code>p2.positions[id].rot</code> и переписывается обратно.',
      'Файлы: scs-design/scs-design.js (pointerup handler стойки).',
    ] },
    { version: '0.59.321', date: '2026-04-23', items: [
      '🐛 <b>Критический fix: стойки теперь рендерятся в физических размерах.</b> <code>getRackDimsMm()</code> читал только <code>r.widthMm</code>/<code>r.depthMm</code>, а rack-config хранит габариты в полях <code>r.width</code>/<code>r.depth</code> (целые мм из KITS: 600/800/1000). Результат — все стойки падали в fallback 600×1000 мм; при шаге сетки 0.6 м это давало 1×1.67 клеток (~40×67 px), стойки выглядели одинаковыми зелёными квадратиками независимо от реальной ширины 600/800/1000 мм.',
      '<b>Каскадные эффекты, которые одновременно чинятся:</b> (1) interRack-расстояния становятся физически корректными → <code>buildCableRoute</code> правильно выбирает заход на канал (раньше 2 близко стоящие 1×1.67-квадратика давали interRack≈0 и любой канал считался «дальше, чем стойки» → кабель шёл напрямую в обход канала). (2) <code>computeTrayFills</code> начинает считать кабели: канал видит проходящие через него линии, % заполнения и сечение отрисовываются (раньше всё было 0% и «нет кабелей»). (3) snap-к-стенам в <code>snapRackPos</code>/<code>snapTrayPosition</code> работает в реальных мм — стойка 800 мм пристыковывается к соседней 600-мм не в узел сетки, а стенка-к-стенке.',
      'Приоритет источников: <code>r.width</code> → <code>r.widthMm</code> (fallback для старых импортов) → парсинг <code>r.name</code> («600x1000x42U») → 600×1000.',
      'Файлы: scs-design/scs-design.js (getRackDimsMm — +r.width/+r.depth первым приоритетом).',
    ] },
    { version: '0.59.320', date: '2026-04-23', items: [
      '🖼 <b>PNG-экспорт плана.</b> В тулбаре plan-view добавлена кнопка «⬇ PNG» рядом с «⬇ SVG». Переиспользует тот же SVG-builder (перехватывая URL.createObjectURL и временную подмену document.body.appendChild, чтобы не скачался SVG), рендерит SVG в <code>&lt;img&gt;</code>, рисует на <code>&lt;canvas&gt;</code> с <b>×2 масштабом</b> (для ретины/печати) и экспортирует через <code>canvas.toBlob("image/png")</code>. Белый фон под SVG. В status-строке — итоговое разрешение файла.',
      'Зачем: SVG лучше для векторных презентаций/вставки в CAD, но для отчётов/email/Telegram удобнее PNG. Теперь оба варианта.',
      'Файлы: scs-design/scs-design.js (+exportPlanPng: patch-URL.createObjectURL + canvas×2); scs-design/index.html (+#sd-plan-png).',
    ] },
    { version: '0.59.319', date: '2026-04-23', items: [
      '↶ <b>Undo / Redo на plan-view.</b> Каждый <code>savePlan</code> теперь оборачивается: предыдущее состояние пушится в <code>undoStack</code> (лимит 30 снапшотов), <code>redoStack</code> сбрасывается (new branch). Кнопки «↶ Undo» и «↷ Redo» в тулбаре + горячие клавиши: <kbd>Ctrl+Z</kbd> — отмена, <kbd>Ctrl+Y</kbd> или <kbd>Ctrl+Shift+Z</kbd> — повтор. RU-раскладка (я/н) тоже работает. Стеки в памяти — переживают только сессию (после F5 пропадают; сохраняется сам plan).',
      'Зачем: после неудачного drag или Автораскладки или случайного Delete не нужно восстанавливать план руками — один Ctrl+Z откатывает.',
      'Файлы: scs-design/scs-design.js (savePlan оборачивает push в undoStack; +undoPlan/redoPlan; Ctrl+Z/Y hotkey в global keydown; wire кнопок); scs-design/index.html (+#sd-plan-undo/#sd-plan-redo в тулбаре).',
    ] },
    { version: '0.59.318', date: '2026-04-23', items: [
      '⌨ <b>Клавиатурные шорткаты на plan-view.</b> Когда стойка выделена кликом (<code>focusRackId</code>): <kbd>R</kbd> — повернуть на 90° (RU/EN раскладка: R/к), <kbd>Delete</kbd>/<kbd>Backspace</kbd> — убрать со схемы, <kbd>←</kbd>/<kbd>→</kbd>/<kbd>↑</kbd>/<kbd>↓</kbd> — nudge на 1 клетку (с <kbd>Shift</kbd> — 5 клеток). Шорткаты игнорируются, когда фокус в <code>input</code>/<code>textarea</code>/<code>select</code>/contenteditable — чтобы не мешать редактированию свойств.',
      'Файлы: scs-design/scs-design.js (global keydown listener после planWrap-wiring; проверка focusRackId + tag.name гардов).',
    ] },
    { version: '0.59.317', date: '2026-04-23', items: [
      '⇲ <b>Кнопка «Fit» — zoom к содержимому plan-view.</b> В тулбаре появилась кнопка: считает bbox всех размещённых стоек + каналов (с отступом 1 клетка), подбирает zoom так, чтобы bbox целиком попал в видимую область wrap\'а (с padding 24 px по краям), и центрирует скролл на центр bbox. Если план пуст — fallback к fitPlanZoom (весь PLAN_COLS×PLAN_ROWS).',
      'Зачем: Ctrl+wheel zoom + grab-pan — удобно для работы, но когда нужно быстро увидеть всю картину, приходилось кликать двойной клик (zoom 1:1) и скроллить руками. Теперь — один клик.',
      'Файлы: scs-design/scs-design.js (+fitPlanToContent — bbox + padPx + центрирующий скролл); scs-design/index.html (+#sd-plan-fit-content в тулбаре).',
    ] },
    { version: '0.59.316', date: '2026-04-23', items: [
      '🧲 <b>Snap каналов к стенам и углам стоек.</b> <code>snapTrayPosition</code> (раньше прилипал только к другим каналам) теперь проходит по всем стойкам на plan и притягивает: (a) по оси, перпендикулярной каналу — верхнюю/нижнюю (для H) или левую/правую (для V) стену канала к соответствующей стене стойки; (b) по оси канала — его начало и конец к левому/правому (H) или верхнему/нижнему (V) углу стойки. Толерантность 1 клетка. Поскольку стойки теперь физически точные (v0.59.313), углы не обязательно на узлах сетки — snap прилипает именно к физическому углу.',
      'Зачем: при добавлении авто-каналов или ручном размещении канал должен лежать ровно вдоль ряда стоек (над/под ним) или стыковаться с краем стойки. Раньше приходилось тянуть пиксель-в-пиксель, сейчас прилипает.',
      'Файлы: scs-design/scs-design.js (snapTrayPosition: +цикл по plan.positions с rackSizeCells; снап краёв канала к углам и стенам стойки).',
    ] },
    { version: '0.59.315', date: '2026-04-23', items: [
      '📏 <b>Scale-bar в plan-view.</b> В правом-нижнем углу wrap\'а (sticky-элемент) — классическая геодезическая шкала: чёрная полоса = 1 м (или 2/5/10 м, если шаг крупный или зум низкий) + подпись <code>1 м · шаг 0.6 м · zoom 100%</code>. Длина шкалы подбирается так, чтобы полоса была ≈110 px при текущем зуме и шаге. Обновляется при изменении шага, зума, при рендере plan. Помогает быстро оценить физические расстояния между стойками без подсчёта клеток.',
      'Файлы: scs-design/index.html (+#sd-plan-scale в sd-plan-wrap); scs-design/scs-design.js (+renderPlanScaleBar — выбор «красивой» длины из [1,2,5,10,20,50,100]; вызов при renderPlan и setPlanZoom); scs-design/scs-design.css (+.sd-plan-scale sticky overlay в правом-нижнем углу).',
    ] },
    { version: '0.59.314', date: '2026-04-23', items: [
      '🚪 <b>Индикатор передней стены стойки.</b> Толстая белая полоса (4 px, <code>inset box-shadow</code>) внутри одной из граней прямоугольника стойки показывает, куда «смотрит» фасад: <code>rot=0</code> — снизу, <code>90°</code> — слева, <code>180°</code> — сверху, <code>270°</code> — справа. Полоса поворачивается синхронно с кнопкой «⟳ поворот». На красных (over) стойках полоса сохраняется + сохраняется alert-обводка.',
      'Зачем: при компоновке важно понимать, какие стойки «смотрят друг на друга фасадом» (hot/cold aisle). После поворота 90° надпись и так поворачивается, но только по наличию фасадной полосы можно увидеть, куда именно направлен фронт.',
      'Файлы: scs-design/scs-design.js (+rot-{0/90/180/270} класс); scs-design/scs-design.css (+.sd-plan-rack.rot-N: inset shadow на соответствующей грани + overrides для .over).',
    ] },
    { version: '0.59.313', date: '2026-04-23', items: [
      '📏 <b>Физически точные размеры стойки + snap к стене соседа.</b> Было: <code>rackSizeCells</code> округляло до целых клеток — 800 мм стойка при шаге 600 мм становилась 1 клеткой (600 мм физически), и при стыковке соседних появлялся «сдвиг» 200 мм от сетки. Стало: (1) <code>rackSizeCells</code> возвращает ТОЧНЫЕ размеры в клетках (float) — без округления. (2) Позиции стоек хранятся как float (уже поддерживалось). (3) Новый <code>snapRackPos(rawX, rawY, wF, hF, selfId, plan, racks)</code> — порядок: сначала grid-snap к ближайшему целому узлу; затем, если любая стена стойки в пределах 0.5 клетки от стены соседней — <b>пристыковываем стена-к-стене</b> (углы соседа важнее узлов сетки, т.к. 800 мм ≠ кратно 600 мм).',
      '🎯 <b>Drop и drag используют новый snap.</b> Перетаскивание стойки из палитры и перемещение уже размещённой стойки по плану теперь ведут себя одинаково: курсор = угол, snap-позиция считается в реальном времени, стены к соседям прилипают.',
      'Файлы: scs-design/scs-design.js (rackSizeCells → float; +snapRackPos; pointermove на стойке — raw float + snap; drop handler — rawX/rawY + snapRackPos; collision-check с EPS для float).',
    ] },
    { version: '0.59.312', date: '2026-04-23', items: [
      '🎯 <b>Drop на plan: реальные размеры + автоматическое избежание коллизий.</b> Было: drag-n-drop стойки из палитры бросал её в <code>(x, y)</code> с clamp по жёстким <code>RACK_W_CELLS=2 / RACK_H_CELLS=1</code>, и если ячейка уже занята — стойки накладывались. Стало: (a) clamp по реальным <code>wC×hC</code> из <code>rackSizeCells</code>; (b) перед сохранением проверяем коллизию с другими стойками (их прямоугольники с учётом rot); (c) если коллизия — ищем ближайшую свободную позицию спиральным обходом (радиус 1, 2, 3…) и ставим туда. Пользователь видит стойку, «скользнувшую» в свободное место.',
      'Файлы: scs-design/scs-design.js (drop handler: rackSizeCells(dropped, rot), collides(cx,cy) через wC×hC всех других, спиральный поиск свободной клетки).',
    ] },
    { version: '0.59.311', date: '2026-04-23', items: [
      '📐 <b>autoLayout и Авто-каналы учитывают реальные размеры стоек.</b> Было: обе функции использовали жёсткие <code>RACK_W_CELLS=2</code> / <code>RACK_H_CELLS=1</code> — 800мм стойка или повёрнутая 1200×600 раскладывались как 2×1, накладываясь на соседей или оставляя пустоту. Стало: (a) autoLayout — для каждой стойки <code>rackSizeCells(r, plan, rot)</code> даёт реальные <code>wC×hC</code> в клетках; высота ряда = max(hC), ширина колонки = wC i-й стойки. rot сохраняется в новой position. (b) autoGenerateTrays — правый край H-канала = <code>max(x + wC)</code> по строке, а не <code>max(x) + 1</code>.',
      'Файлы: scs-design/scs-design.js (autoLayout: rackSizeCells в цикле + rowMaxH + сохранение rot; autoGenerateTrays: учёт wC каждой стойки при расчёте left/right).',
    ] },
    { version: '0.59.310', date: '2026-04-23', items: [
      '📋 <b>Кабельные каналы в BOM CSV.</b> После секции кабелей в <code>scs-bom-*.csv</code> теперь идёт пустая строка + таблица каналов: «Сечение канала (WхD, мм) · Шт · Σ длин, м · С запасом ×{BOM_RESERVE}, м». Группировка по размеру сечения; сортировка по убыванию суммарной длины. Длина каждого канала = <code>t.len × plan.step</code> (без коэф. трассы, т.к. сам канал прямой). Отдельно закупать можно по размеру — готово для спецификации.',
      'Файлы: scs-design/scs-design.js (exportBomCsv: +секция trays group-by WхD).',
    ] },
    { version: '0.59.309', date: '2026-04-23', items: [
      '↗ <b>Кнопка «Подогнать все» каналы.</b> В тулбаре plan-view, рядом с «⬚ Авто-каналы». Обходит все каналы; для тех, у которых <code>pct &gt; fillLimitPct</code>, увеличивает <code>widthMm/depthMm</code> с сохранением соотношения сторон так, чтобы заполнение попало в лимит (округление ceil 50×10 мм). Размеры только увеличиваются — ранее заданные «с запасом» параметры не сбрасываются. В статус-строке — количество подогнанных каналов.',
      'Зачем: когда перегружены одновременно несколько каналов (например, после Автораскладки и большого числа связей), прокликивать pop-over у каждого долго. Теперь — один клик, и все в лимите.',
      'Файлы: scs-design/scs-design.js (+fitAllTrays); scs-design/index.html (+#sd-plan-fit-all в тулбаре).',
    ] },
    { version: '0.59.308', date: '2026-04-23', items: [
      '📊 <b>Сводка по каналам в plan-info.</b> Справа в тулбаре plan-view после статистики стоек/связей/длин добавлен блок: <code>каналов: N (42% avg, ⚠ 2 перегруж.)</code>. Среднее заполнение по всем каналам + счётчик тех, у которых <code>pct &gt; fillLimitPct</code> (красным). Мгновенно видно: «ещё ок» или «пора добавить канал/подогнать сечение».',
      'Файлы: scs-design/scs-design.js (updatePlanInfo: computeTrayFills + avg/over счётчики, append в innerHTML).',
    ] },
    { version: '0.59.307', date: '2026-04-23', items: [
      '↗ <b>Кнопка «Подогнать» сечение канала под заполнение.</b> Если <code>pct &gt; fillLimitPct</code>, в шапке pop-over появляется красная кнопка «↗ Подогнать». Клик — рассчитывается нужное сечение <code>usedMm2 / (limit/100)</code>, сохраняется соотношение сторон W:D, новые размеры округляются вверх (ширина до 50 мм, глубина до 10 мм). widthMm/depthMm только увеличиваются (никогда не уменьшаются), чтобы кнопка не ломала осознанно заданные «с запасом» размеры.',
      'Зачем: раньше при перегрузке канала (красный индикатор заполнения) приходилось вручную подбирать ширину — теперь один клик.',
      'Файлы: scs-design/scs-design.js (+handler .sd-tray-fit в renderTray: sqrt(neededCross × ratio) → ceil 50; target.widthMm/depthMm = max(old, new)); scs-design/scs-design.css (+.sd-tray-fit red-ghost кнопка).',
    ] },
    { version: '0.59.306', date: '2026-04-23', items: [
      '⬚ <b>Автогенерация кабельных каналов.</b> Новая кнопка «<b>⬚ Авто-каналы</b>» в тулбаре plan-view. Одним кликом создаёт: (1) горизонтальный канал <b>200×100 мм</b> над каждым рядом стоек (группировка по y-координате, длина = от левой до правой стойки +1 клетка с краёв), (2) вертикальный <b>спинальный</b> канал 300×150 мм слева от самой левой стойки, соединяющий все ряды. Старые каналы с префиксом <code>auto-*</code> заменяются при повторном запуске; пользовательские (добавленные кнопками ↔/↕) сохраняются — можно пересоздавать авто-каналы после перестановки стоек, не теряя ручных правок.',
      'Зачем: раньше каналы надо было добавлять по одному и тянуть за ручки resize. После Автораскладки теперь один клик — и все кабели идут через корректные каналы с расчётом заполнения.',
      'Файлы: scs-design/scs-design.js (+autoGenerateTrays — группировка stacks по y, генерация H-каналов и V-spine, id=auto-h-Y / auto-v-spine); scs-design/index.html (+кнопка #sd-plan-auto-trays).',
    ] },
    { version: '0.59.305', date: '2026-04-23', items: [
      '🔍 <b>Поперечное сечение канала в pop-over.</b> При выделении канала теперь сверху списка кабелей рисуется <code>svg</code>-превью: прямоугольник <code>widthMm × depthMm</code> в масштабе + круги кабелей реального диаметра (⌀ из CABLE_DIAMETER). Упаковка — greedy shelf packing (по убыванию диаметра, полками слева-направо). Если содержимое не вмещается — рамка становится красной (<code>#dc2626</code>) и в tooltip «НЕ ВМЕЩАЕТСЯ». Подписи ширины снизу, глубины справа. Масштаб автоматически вписывает канал в 220×90 px.',
      'Зачем: проценты заполнения (42%) не дают интуиции о том, физически помещаются ли кабели. Визуализация сечения сразу показывает, достаточно ли места для ещё одного свитчевого кабеля ⌀6мм, или канал уже «забит».',
      'Файлы: scs-design/scs-design.js (+renderTrayCrossSection — greedy shelf packing + SVG; подключено в renderTray между шапкой и списком кабелей); scs-design/scs-design.css (+.sd-tray-cross — центрированный блок с нижней разделительной линией).',
    ] },
    { version: '0.59.304', date: '2026-04-23', items: [
      '🖨 <b>SVG-экспорт плана учитывает каналы, реальные размеры стоек и Manhattan-трассировку.</b> Было: кабели рисовались одной L-образной кривой через <code>(ax, ay) → (bx, ay) → (bx, by)</code>, стойки — жёстко 2×1 клетки, каналы не экспортировались. Стало: (1) каналы рисуются отдельным слоем — цветной прямоугольник по заполнению (green/cyan/amber/red) + подпись <code>⬚ L=3.6м · 100×50 · 42%</code>; (2) кабели используют тот же <code>buildCableRoute()</code>, что и в plan-view — Manhattan с заходом на ближайшие каналы и fill-weighted весом; (3) стойки рисуются по <code>rackSizeCells(r, plan, rot)</code> — физические размеры widthMm×depthMm + поворот; (4) длина кабеля — сумма сегментов маршрута × step × kRoute, не сумма проекций координат.',
      'Файлы: scs-design/scs-design.js (exportPlanSvg: +computeTrayFills+trayColor layer, buildCableRoute для кабелей, rackSizeCells для стоек, длина из route.cells).',
    ] },
    { version: '0.59.303', date: '2026-04-23', items: [
      '📐 <b>Физические размеры стоек в плане.</b> Стойка на plan-view теперь рисуется по реальным габаритам <code>widthMm × depthMm</code> (из каталога корпусов rack-config или паттерна имени «600x1200»). Ширина/глубина → количество клеток = <code>round(mm / plan.step)</code>, минимум 1×1. Под стойкой — подпись <code>600×1200</code> серым.',
      '🔄 <b>Поворот стойки 0°/90°/180°/270°.</b> На карточке стойки — маленькая круглая кнопка <code>⟳</code> (16×16, правый-верхний угол): инкремент 90°. При нечётном повороте ширина/глубина меняются местами, подпись стойки поворачивается вертикально. Rot сохраняется в <code>plan.positions[id].rot</code>. Позиция clamp-ается в границы plan при повороте.',
      '🎯 <b>Центр стойки в расчётах.</b> Введён хелпер <code>rackCenterPx(rackId, plan)</code> — возвращает центр с учётом реальных размеров и rot. Используется в: drawPlanLinks (старт/конец кабеля), computeTrayFills, computeSuggestedLength, renderTray (якори). Раньше везде было <code>(x + RACK_W_CELLS/2) × PLAN_CELL_PX</code> с жёстко зашитыми 2×1 клетки — линии шли не по центру больших стоек.',
      'Файлы: scs-design/scs-design.js (+getRackDimsMm/rackSizeCells/rackRot/rackCenterPx хелперы; getPlan нормализует positions.rot; renderPlan — использует [wC,hC] из rackSizeCells; +.sd-plan-rack-rot кнопка + handler; replace all RACK_W_CELLS/2 → rackCenterPx в 5 местах); scs-design/scs-design.css (+.sd-plan-rack-rot, +.sd-plan-rack-dim, +.sd-plan-rack.rot-tall .sd-plan-rack-label — text vertical writing-mode).',
    ] },
    { version: '0.59.301', date: '2026-04-23', items: [
      '🔧 <b>Видимые ручки изменения длины канала.</b> Было: невидимые (CSS не задан) — тянуть за край без визуальной подсказки. Стало: серые прямоугольные ручки на обоих концах канала — курсор <code>ew-resize</code> для h-канала, <code>ns-resize</code> для v-канала. Hover → синий фон.',
      '⚙️ <b>Редактор свойств канала в pop-over.</b> При выделении канала — сверху pop-over поля: <b>Ширина</b> (мм), <b>Глубина</b> (мм), <b>Лимит</b> заполнения (%). Изменения сохраняются в <code>plan.trays[]</code> и сразу пересчитывают <code>pct</code> + цветовой класс low/mid/hi/over.',
      '🛣 <b>Если канал ближе расстояния между стойками — кабель идёт через него.</b> Пороги 1.1×/1.2× (v0.59.298) отменены — они блокировали использование канала, когда он физически рядом, но давал небольшой обход. Теперь: <code>bestA.d &gt; interRack && bestB.d &gt; interRack</code> → direct; иначе — всегда через канал(ы). Это убирает ситуации «канал стоит, а кабель идёт мимо».',
      'Файлы: scs-design/scs-design.js (renderTray — propsHtml + pop-over input wiring + stopPropagation; buildCableRoute — сняты пороги cells<=directCells*1.1/1.2); scs-design/scs-design.css (.sd-plan-tray-resize-start/-end размер/курсор + .sd-tray-props — grid-форма редактора).',
    ] },
    { version: '0.59.300', date: '2026-04-23', items: [
      '📏 <b>Одинаковая высота карточек стоек независимо от заполнения.</b> Раньше карточка с большим числом multi-U устройств была короче карточки, где те же юниты заполнены одиночными 1U-ячейками: <code>.sd-unit.multi</code> считал <code>min-height = h×u-row + (h-1)×gap</code>, но <code>--u-row</code> был голые 18px контента, тогда как одиночный U-элемент добавлял ещё padding 3×2 + border 1×2 = 8px (итого 26px). Итог: 5U multi был 98px, а 5×1U = 138px — разница 40px × каждое multi-U × стойка. Фикс: <code>box-sizing: border-box</code> + <code>--u-row: 26px</code> (полная высота ряда с padding/border) + жёстко <code>height</code> не только <code>min-height</code>.',
      'Файлы: scs-design/scs-design.css (.sd-unit box-sizing + --u-row 26px, .sd-unit.multi height+min-height с учётом полного ряда).',
    ] },
    { version: '0.59.299', date: '2026-04-23', items: [
      '🖱 <b>Выбор канала и просмотр кабелей в нём.</b> Клик по телу канала (без перетаскивания) выделяет его синей рамкой и открывает под ним pop-over со списком кабелей, проходящих через канал: цветной swatch по типу, тип кабеля (cat6a / om4 / power-c13 …), диаметр в мм, концы связи (стойка → стойка). Повторный клик или клик по другому каналу — переключает выделение. Порог «клик vs drag» — 5 px перемещения.',
      'Файлы: scs-design/scs-design.js (selectedTrayId state, renderTray — popover с fillInfo.cables + имена стоек по tag/name, pointerdown/up — movedPx-трекер); scs-design/scs-design.css (.sd-plan-tray.selected, .sd-tray-popover/-h, .sd-tray-cable-row/-sw/-type/-d/-ep).',
    ] },
    { version: '0.59.298', date: '2026-04-23', items: [
      '↩️ <b>Инверсия правила трассировки.</b> Если ближайший канал дальше, чем расстояние между самими стойками — идём напрямую (заход на такой канал только удлиняет трассу). Раньше (v0.59.296) был forceTray, который заставлял идти через ближайший канал даже в ущерб длине — это неправильная логика, откатываем. Теперь канал используется только если его fishmouth-трасса ≤ 1.1× (один канал) / 1.2× (два канала) от прямой.',
      '🏷 <b>Подпись канала — метры вместо клеток.</b> Было <code>⬚ 6кл · 100×50</code> (можно прочитать как «6 кабелей»), стало <code>⬚ L=3.6м · 100×50</code>. Длина считается как <code>len × plan.step</code>. Количество кабелей по-прежнему смотрится через tooltip («Кабелей: N»).',
      'Файлы: scs-design/scs-design.js (buildCableRoute — убран forceTray, ужесточены пороги 1.1×/1.2×, ранний выход при далёком канале; renderTray — подпись с L=метры).',
    ] },
    { version: '0.59.297', date: '2026-04-23', items: [
      '🧲 <b>Прилипание каналов (T/крестовые стыки).</b> При перетаскивании канал прилипает к соседним каналам: перпендикулярные стыкуются по центральной оси (T-отвод или крест), параллельные — выравниваются по уровню и стыкуются концами (продолжение). Порог прилипания ≈ 1 клетка сетки. Во время snap канал подсвечивается зелёной рамкой <code>.snapped</code>.',
      '🎯 <b>Умный роутинг с учётом заполнения каналов.</b> <code>buildCableRoute</code> теперь принимает <code>fillsMap</code> и сортирует кандидаты по весу <code>d × (1 + fill/100 × 1.5)</code>. Канал с заполнением 90% для алгоритма выглядит в 2.35× дальше — кабель уйдёт на более свободный канал, даже если он физически чуть дальше. <code>drawPlanLinks</code> считает <code>computeTrayFills</code> один раз на перерисовку.',
      'Файлы: scs-design/scs-design.js (snapTrayPosition + интеграция в pointermove; buildCableRoute(…, fillsMap) с weighted-sort; drawPlanLinks предвычисляет fillsMap); scs-design/scs-design.css (.sd-plan-tray.snapped — зелёная рамка).',
    ] },
    { version: '0.59.296', date: '2026-04-23', items: [
      '📐 <b>Строгий Manhattan-роутинг кабелей + принуждение канала.</b> Раньше <code>buildCableRoute</code> мог давать диагональные сегменты в точке хопа между перпендикулярными каналами (H→V): строился сегмент <code>[bestA.qx, bestA.qy] → [hop.qx, hop.qy]</code> без промежуточного L-угла. Теперь все сегменты строго горизонтальные или вертикальные — через новую функцию <code>pushManhattan(pts, qx, qy, preferAxis)</code>, вставляющую L-точку при необходимости. Также: если ближайший канал ближе к стойке, чем расстояние между самими стойками (<code>bestA.d ≤ interRack</code>), кабель <b>обязан</b> идти через канал — прежний порог обхода (1.6×/2× directCells) отменяется для таких случаев. Остальной порог ослаблен до 1.8× / 2.2×, чтобы при наличии канала он использовался чаще.',
      'Файлы: scs-design/scs-design.js (buildCableRoute — переписана через pushManhattan + forceTray; nearestOnTray без изменений).',
    ] },
    { version: '0.59.295', date: '2026-04-23', items: [
      '🧹 Мастер меж-шкафных связей: убран блок «📚 Библиотека шаблонов» — в пикере теперь только стойки, реально добавленные в проект (с тегом / без тега). Библиотечные шаблоны добавляются через модуль <a href="../scs-config/">Компоновщик шкафа</a>, а здесь только их использование.',
      '📐 Высота устройств в карточках стоек соответствует реальному размеру в U. Раньше <code>d.heightU || 1</code> давало 1U, если в экземпляре устройства высота не проставлена; теперь используется fallback в каталог: <code>d.heightU || catalogType(d.typeId).heightU || 1</code>. Multi-U устройства (Dell PowerVault ME5084 5U, Cisco Nexus 2U и т.п.) теперь корректно занимают нужное число юнитов на виде.',
      'Файлы: scs-design/scs-design.js (renderLinksTab — library=[], renderRackCard — catalog-fallback для heightU в 2 местах).',
    ] },
    { version: '0.59.293', date: '2026-04-23', items: [
      '🧰 <b>Трассировка через кабельные каналы.</b> На плане зала теперь можно ставить примитив «кабельный канал» (tray) — горизонтальный/вертикальный. Две кнопки в тулбаре плана: ➕ канал ↔ / ➕ канал ↕. Канал таскается мышью, у него 4 угловых кнопки: ⟳ повернуть, −/+ изменить длину, ✕ удалить. Каналы рисуются под стойками (z-index: 3 vs 5), стиль — заштрихованный серый прямоугольник. Между стойками кабель теперь идёт не прямой L-линией, а: <code>стойка A → ближайшая точка канала → вдоль канала → ближайшая точка канала → стойка B</code>. Если у A и B ближайший канал один — трасса строится по нему; если разные — делается хоп между каналами; если каналов нет или получается длиннее прямой в 1.6×/2× — fallback на старую L-линию. Длина кабеля (<code>computeSuggestedLength</code>) теперь считается по фактической трассе × шаг × kRoute, а не по манхэттен-расстоянию центров стоек — это меняет суммарный метраж в BOM и поле «Σ с запасом» в info-строке плана. Trays сохраняются в <code>plan.trays[]</code> (id, x, y, len, orient) и входят в экспорт проекта JSON.',
      'Файлы: scs-design/scs-design.js (+tray model в getPlan, +nearestOnTray/buildCableRoute/routeCells/ptsToPath, +renderTray/addTray, computeSuggestedLength и drawPlanLinks используют маршрут через каналы); scs-design/index.html (+кнопки #sd-plan-add-tray-h / -v); scs-design/scs-design.css (+стили .sd-plan-tray).',
    ] },
    { version: '0.59.288', date: '2026-04-22', items: [
      '⚡ Валидация скорости кабеля vs скорости порта. CABLE_TYPES получили поле maxGbps: Cat.6 = 1G, Cat.6A/7 = 10G, OM3 = 40G, OM4 = 100G, OS2 = 400G (питание/coax/other — не валидируем). parseGbps(«1G»/«10G»/«100G»/«100M») читает catalog[].portSpeed. В linkCompat появляются причины «порт A 100G > max кабеля 10G» — показываются ⚠ чипом в таблице связей.',
      '🎯 Автовыбор типа кабеля при создании связи теперь учитывает требуемую скорость: RJ45 → Cat.6A при >1G, иначе Cat.6; оптика → OM3/OM4/OS2 в зависимости от needG. До этого всегда бралось Cat.6A для медь и OM4 для оптики независимо от скорости портов.',
      'Файлы: scs-design/scs-design.js (CABLE_TYPES[].maxGbps, parseGbps, linkCompat +speed-check, onUnitClick defCable по needG).',
    ] },
    { version: '0.59.287', date: '2026-04-22', items: [
      '🔍 План зала: зум и пан. Ctrl+колёсико — зум в точке курсора; кнопки −/+/1:1/⤢ (вписать). Пан — средней кнопкой мыши или Shift+ЛКМ на пустой области; полосы прокрутки также работают. Уровень зума сохраняется в plan.zoom (раскладка между визитами не теряется). Реализация через CSS `zoom` на #sd-plan-canvas; drag-n-drop и перемещение стоек компенсируют масштаб (coords / (PLAN_CELL_PX × zoom)).',
      'Файлы: scs-design/scs-design.js (PLAN_ZOOM_MIN/MAX, planZoom, applyPlanZoomStyle/setPlanZoom/fitPlanZoom, getPlan{zoom}, wheel+mouseup+mousemove handlers, компенсация zoom в drop/pointer-move); scs-design/index.html (toolbar zoom-кнопки + подсказка «Ctrl+колёсико / Shift+ЛКМ»).',
    ] },
    { version: '0.59.285', date: '2026-04-22', items: [
      '📏 Карточки стоек в мастере связей выровнены по низу (align-items: flex-end). Теперь U1 у всех стоек стоит на одной горизонтальной линии независимо от их высоты (42U рядом с 47U больше не «плавают» по центру/верху).',
      'Файлы: scs-design/scs-design.css (.sd-racks-row align-items: flex-end).',
    ] },
    { version: '0.59.283', date: '2026-04-22', items: [
      '👻 Фантомные меж-шкафные связи больше не отображаются. Показываем ТОЛЬКО «действующие» кабели — у которых оба конца указывают на inst-* стойку текущего проекта и устройства ещё присутствуют в содержимом. Сырые записи в scs-design.links.v1 остаются — если стойка/устройство вернётся (например, пересохранение scs-config), связи снова станут видимыми.',
      '📐 Карточки стоек в мастере связей теперь растут по высоте стойки целиком — убран локальный overflow-y/скролл (max-height: 640px). Вся стойка видна без внутренней полосы прокрутки.',
      '✎ На заголовке каждой карточки стойки в мастере связей добавлена кнопка-линк «✎» — открывает стойку в Компоновщике (scs-config/rack.html?rackId=<id>) для правок оборудования/геометрии.',
      'Файлы: scs-design/scs-design.js (getVisibleLinks + isLinkLive + замена getLinks() на getVisibleLinks() в renderLegend/drawLinkOverlay/renderLinksList/renderBom/renderRacksSummary(stats)/renderPlan.rackLinks/drawPlanLinks/updatePlanInfo/exportBomCsv/exportLinksCsv/exportPlanSvg; renderRackCard добавляет .sd-rack-edit); scs-design/scs-design.css (.sd-units без max-height, .sd-rack-edit стили).',
      'Примечание по защите от удаления: оборудование с подключёнными кабелями уже защищено (scs-config.js: hasAttachedCables — 708/2815). Удаление шаблонов стоек также блокируется счётчиком использующих их инстансов (rack-config v0.59.279). Прямое удаление экземпляра стойки (inst-*) в UI сейчас отсутствует — соответственно, невозможно.',
    ] },
    { version: '0.59.281', date: '2026-04-22', items: [
      '🔒 Строгий project-scope: план-зал, сводная таблица «Стойки проекта», CSV-экспорт и план-инфо теперь используют getProjectInstances() и видят только inst-* текущего проекта. Глобальные шаблоны корпусов (tpl-*) больше никогда не «просачиваются» в палитру плана, чипы мастера связей и т.п. getProjectRackIds обновлён: источник истины — inst-* активного проекта + fallback на scoped contents/tags только с inst-* префиксом.',
      '🔌 Валидация порт ↔ кабель для меж-шкафных связей. Лёгкая модель: inferPortType(dev) определяет тип порта из catalog.kind + optional catalog[i].portType + эвристика по label (SFP/fiber → lc, coax → bnc). Cable → set допустимых типов портов (cat6/6a/7 → rj45; om3/om4/os2 → lc/sc/sfp; coax → bnc/f; power-c13 → power/c13/c14; other — без валидации). В таблице связей рядом с выбором кабеля показывается красное ⚠ с причиной при несовпадении.',
      '🆕 Дефолтный тип кабеля при создании связи выбирается по типам портов на концах: LC/SFP → om4, BNC → coax, power → power-c13, иначе cat6a.',
      'Файлы: scs-design/scs-design.js (getProjectInstances, getProjectRackIds inst-only, DEFAULT_PORT_BY_KIND, CABLE_PORT_COMPAT, inferPortType, linkCompat, renderPlan/renderRacksSummary/updatePlanInfo/exportRacksCsv/exportPlanSvg → instances, onUnitClick defCable, renderLinksList warn chip).',
    ] },
    { version: '0.59.224', date: '2026-04-22', items: [
      '🔀 Фаза 1.27.3 — scs-config (содержимое шкафов, теги, корзина, склад проекта) тоже переведён на проектный неймспейс. Ключи contents/matrix/cart/rackTags/warehouse.v1 → raschet.project.<pid>.scs-config.<key>. scs-design читает эти данные тоже через проектный неймспейс (scs-design и scs-config теперь «в одном проекте»).',
      'Одноразовая миграция при первом открытии любого модуля из пары scs-config / scs-config/inventory / scs-config/racks / scs-design — глобальные ключи копируются в активный проект, старые оставлены резервом.',
      'Что осталось глобальным в scs-config: rack-config.templates.v1 (корпуса = библиотека), scs-config.catalog.v1 (каталог IT-типов), scs-config.assemblyTemplates.v1 (шаблоны сборок = библиотека).',
      'Файлы: scs-config/{scs-config.js, inventory.js, racks-list.js (rescopeToActiveProject + миграция)}, scs-design/scs-design.js (LS_CONTENTS/LS_RACKTAGS → project-scoped).',
    ] },
    { version: '0.59.223', date: '2026-04-22', items: [
      '🔀 Фаза 1.27.1 — scs-design переведён на проектный неймспейс. LS-ключи selection.v1 / links.v1 / plan.v1 теперь хранятся как raschet.project.<pid>.scs-design.<key>. Одноразовая миграция: если в новом ключе пусто, а в старом (глобальном) есть данные — автоматически копируются в активный проект при первом открытии. Старые ключи оставлены как резерв (удалятся в 1.27.4 после полного backup-экспорта).',
      'В верхней части модуля — бейдж «Активный проект: <имя>» со ссылкой на /projects для смены/управления. При отсутствии активного проекта — ссылка на создание.',
      'Смена активного проекта требует перезагрузки вкладки scs-design (реактивное переключение — в 1.27.5).',
      'Файлы: scs-design/{index.html (sd-project-bar), scs-design.js (rescopeToActiveProject + миграция + renderProjectBadge), scs-design.css (.sd-project-bar)}.',
    ] },
    { version: '0.59.221', date: '2026-04-22', items: [
      'Фильтры над таблицей меж-шкафных связей: поиск по шкафу/устройству/заметке, select-фильтр по типу кабеля, чекбокс «только без длины». Счётчик «показано/всего», кнопка сброса. Для проекта с 100+ линиями — найти «все fiber без длины в DH1» теперь в 3 клика. Фильтр живёт в памяти вкладки (не сохраняется в LS), чтобы открытие модуля всегда показывало весь журнал.',
      'Футер таблицы: «Показано N из M» (ранее просто «Всего N»).',
      'Файлы: scs-design/scs-design.js (linksQuery/linksCableFilter/linksMissingOnly state, renderLinksList: фильтр-панель + применение фильтров).',
    ] },
    { version: '0.59.220', date: '2026-04-22', items: [
      'Bulk-выделение в picker-е вкладки «Связи»: кнопка «☑ выбрать все» / «☐ снять все» — работает над текущим фильтром (если в поиске «DH1.SR» → выделит только найденные). Связка «поиск + выбрать все» превращает выбор целого ряда из DH1.SR1…SR12 в 2 клика.',
      'Esc снимает фокус с подсвеченной трассы на плане зала (не срабатывает пока курсор в input/textarea/select).',
      'Файлы: scs-design/scs-design.js (sd-picker-toggle-all + keydown Esc в DOMContentLoaded).',
    ] },
    { version: '0.59.219', date: '2026-04-22', items: [
      'Поиск по стойкам в picker-е вкладки «Связи»: поле «🔍 поиск по тегу / имени / id», фильтрует обе группы (реальные и черновики), показывает счётчик «найдено/всего», кнопка × для сброса. Работает и когда уже есть выделенные — выделенные сохраняются при фильтрации. На проектах с 20+ шкафами вместо скролла сразу DH1.SR → появляются только нужные.',
      'Файлы: scs-design/{scs-design.js (pickerQuery state, renderLinksTab: search input + filter), scs-design.css (.sd-picker-search)}.',
    ] },
    { version: '0.59.218', date: '2026-04-22', items: [
      'Клик по стойке на плане зала = фокус на её трассы: трассы этой стойки становятся жирнее и ярче (stroke-width 3.5, opacity 1.0), остальные тускнеют до 0.15. Сама стойка получает жёлтую рамку, остальные — opacity 0.35. Повторный клик снимает фокус. Drag и кнопка «✕» не триггерят фокус (move-threshold 3px, click-threshold 400 мс). На больших планах (40+ стоек) сразу видно, что приходит в конкретный шкаф.',
      'Файлы: scs-design/{scs-design.js (focusRackId, click-vs-drag detection, focus-state в drawPlanLinks), scs-design.css (.sd-plan-rack.focused/.dimmed)}.',
    ] },
    { version: '0.59.217', date: '2026-04-22', items: [
      'Расширенный hover-тултип на стойке в плане зала: загрузка U с %, устройств, количество исходящих связей с разбивкой по типам кабелей (fiber×4, utp×8, …), суммарный метраж кабеля от стойки с запасом 1.3. Метка «черновик» для стоек без тега. Помогает сразу находить перегруженные стойки и оценивать трассовую нагрузку на каждую.',
      'Файлы: scs-design/scs-design.js (tooltip в renderPlan для placed racks).',
    ] },
    { version: '0.59.216', date: '2026-04-22', items: [
      'Info-панель плана зала теперь показывает полную сводку: размещено стоек N/M, размещено связей N/M, без длины N, суммарный метраж с запасом 1.3 (учитывая и реальные lengthM, и suggested по плану), топ-3 типа кабелей по метражу. Готовность BOM видно сразу — без переключения на вкладку «Связи».',
      'Файлы: scs-design/scs-design.js (updatePlanInfo: суммарная длина + разбивка по типам).',
    ] },
    { version: '0.59.215', date: '2026-04-22', items: [
      'SVG-экспорт плана зала: на середине каждой L-трассы появилась подпись длины в метрах (манхэттен-расстояние × шаг сетки × коэф. трассы, белая плашка с цветной обводкой по типу кабеля). Сдаточный чертёж сразу читаем без ручного подписывания.',
      'Файлы: scs-design/scs-design.js (exportPlanSvg: length label на каждой трассе).',
    ] },
    { version: '0.59.214', date: '2026-04-22', items: [
      'Кнопка «⬇ Экспорт SVG» на вкладке «План зала»: сохраняет план зала как self-contained SVG — сетка 40×24 клеток, стойки с цветом по загрузке U (пусто/низкая/средняя/высокая/переполнено/черновик) и подписью тега, манхэттен-трассы кабелей в цвете типа, легенда, заголовок с датой/масштабом/коэф. трассы. Для вложения в сдаточные документы и КП — открывается в любом браузере без JS.',
      'Файлы: scs-design/{index.html, scs-design.js (+exportPlanSvg/escapeSvg)}.',
    ] },
    { version: '0.59.213', date: '2026-04-22', items: [
      'JSON-импорт/экспорт проекта СКС (вкладка «О модуле»). Файл содержит selection, links, plan — сохраняется как scs-design-YYYYMMDD-HHMM.json со схемой «raschet.scs-design/1». При импорте валидируется schema-version, несоответствие отклоняется с ошибкой.',
      'Варианты использования: backup перед большими правками; шаринг готового дизайна между ПК; «what-if» — сохранить текущее, поэкспериментировать, откатиться импортом.',
      'Содержимое стоек и сами шкафы (rack-config / scs-config) в этот файл не входят — хранятся в своих LS-ключах, отдельная ответственность.',
      'Файлы: scs-design/{index.html, scs-design.js (+exportProjectJson/importProjectJson)}.',
    ] },
    { version: '0.59.212', date: '2026-04-22', items: [
      'План зала: цвет стойки теперь кодирует загрузку U. Серый — пусто, зелёный — <70%, циан — 70-89%, оранжевый — 90-99%, красный с красной обводкой — ≥100% (overfull, помещается больше железа, чем есть юнитов). Черновики без тега — с пунктирной белой рамкой и прозрачностью. Tooltip показывает U/%, кол-во устройств и связей.',
      'Легенда цветов — под тулбаром плана. Отдельные маркеры для каждого состояния + «черновик».',
      'Файлы: scs-design/{index.html, scs-design.js, scs-design.css (.sd-plan-rack.empty/.low/.mid/.hi/.over/.draft, .sd-plan-legend)}.',
    ] },
    { version: '0.59.211', date: '2026-04-22', items: [
      'Автоподбор свободного порта при создании связи: если оба устройства многопортовые (свич / патч-панель), клик-по-клику сразу заполняет fromPort/toPort первыми свободными (ранее пользователь должен был вводить вручную в таблице).',
      '«+ ещё N связей подряд»: кнопка в статус-баре после создания первой связи между двумя многопортовыми устройствами. Inline-вход «1…N» (N = min(свободных A, свободных B)), по OK создаёт N кабелей 1:1 по возрастанию свободных портов. Работа «патч-панель 24 → свич 24» за 2 клика.',
      'Бейджы занятости портов «4/24» на устройствах в карточках стоек: нейтральный серый (свободно), жёлтый «part» (частично), зелёный «full» (всё занято). Сразу видно, что на свиче осталось 20 свободных.',
      'Файлы: scs-design/{scs-design.js (+promptBatchWire/createBatchLinks/lastLink, autoselect-port в onUnitClick), scs-design.css (+.u-pbadge)}.',
    ] },
    { version: '0.59.210', date: '2026-04-22', items: [
      'Кнопка «⊞ Автораскладка в ряды» на вкладке «План зала»: группирует стойки по префиксу тега до первой точки (DH1.SR1/DH1.SR2 → ряд DH1), сортирует внутри ряда по номеру (SR1 перед SR10), раскладывает по строкам плана с аислом в 2 клетки между рядами. Черновики без тега — в отдельный последний ряд.',
      'После автораскладки сразу работает кнопка «Применить длины» — за один клик получается BOM с реальными длинами без ручного перетаскивания каждой стойки. Для 40-стоечного зала экономит все 40 drag-ов.',
      'Файлы: scs-design/{index.html, scs-design.js (+autoLayout)}.',
    ] },
    { version: '0.59.209', date: '2026-04-22', items: [
      'Port-level linking: у устройств с `ports > 1` (коммутаторы 24×1G, патч-панели 24/48 портов и т.п.) в таблице меж-шкафных связей появились inline-инпуты «порт 1-N» под названием устройства с обоих концов связи. Поля сохраняются в scs-design.links.v1 как `fromPort`/`toPort`.',
      'Детекция конфликтов: если тот же порт на том же устройстве занят другой связью — инпут подсвечивается красным (.sd-err), tooltip поясняет «занят другой связью». Полностью не блокируем — бывают ошибки каталога, пользователь должен видеть проблему и решать сам.',
      'В подписях (tooltip SVG-линии и в самом bullet-виде) добавляется «· pN» после имени устройства. CSV «Все связи» расширен до 11 колонок с отдельными «Порт A» / «Порт B».',
      'Файлы: scs-design/{scs-design.js (+devicePorts/portsUsedOn, port-input в renderLinksList), scs-design.css (+.sd-port-in, .sd-err)}.',
    ] },
    { version: '0.59.205', date: '2026-04-22', items: [
      '⚠ Фикс: многоюнитовые устройства в карточках стоек больше не сжимаются до 1U. 2U/4U/6U-железки теперь рисуются на свою реальную высоту (h × 18px + (h-1) × 2px), с бейджем «2U/4U/…» рядом с меткой и диапазоном номеров «9-8» в колонке U. Адресация (тег) по-прежнему по нижнему U — так решили в v0.59.201.',
      'Визуальное разделение «реальные стойки» vs «шаблоны/черновики» в picker-е «Связи» и таблице «Стойки проекта»: стойки с непустым тегом → группа «🗄 Реальные стойки», без тега → «📐 Черновики / шаблоны» (жёлтая штриховка, dashed-рамка, бейдж «📐 черновик» в таблице). Порядок: сначала реальные (сорт по тегу), потом черновики.',
      'Полноценное разделение хранилищ (templates vs instances) и перенос реальных стоек в отдельный модуль — в roadmap как 1.26.2.a (архитектурная задача).',
      'Файлы: scs-design/{scs-design.js, scs-design.css}, ROADMAP.md (1.26.4.0 ✅, 1.26.2.a добавлен).',
    ] },
    { version: '0.59.204', date: '2026-04-22', items: [
      'Вкладка «План зала» заменила stub на рабочий top-down редактор: сетка 40×24 клетки, drag-n-drop стоек из палитры неразмещённых на план, pointer-drag для перемещения размещённых, удаление со схемы через ✕. Позиции сохраняются в scs-design.plan.v1.',
      'Параметры масштаба: шаг сетки в метрах (default 0.6 — типовая плитка фальшпола) и коэффициент трассы (default 1.3 — запас на спуск/подъём по стойке).',
      'Манхэттен-трассы связей рисуются поверх плана в цвете типа кабеля (L-образная: сначала по X, потом по Y). Обновляются в реальном времени при перетаскивании стойки.',
      'Кнопка «↪ Применить длины к связям без длины»: для каждой связи, у которой обе стойки размещены и lengthM не задана, считает L = cells × step × kRoute (округление 0.1 м) и записывает в scs-design.links.v1. Сразу отражается в таблице связей и BOM.',
      'Info-строка в тулбаре: «связей: N/M размещено · без длины: K» — видно прогресс заполнения.',
      'Файлы: scs-design/{index.html, scs-design.js (+LS_PLAN, +renderPlan/drawPlanLinks/applySuggestedLengths), scs-design.css (+sd-plan-*)}.',
    ] },
    { version: '0.59.203', date: '2026-04-22', items: [
      'Вкладка «Стойки проекта» заполнена реальными данными: таблица со сводкой по каждой стойке — тег, имя, занятость U (с цветной прогресс-полоской: зелёная ≤70%, жёлтая 70-90%, красная ≥90%), мощность кВт, число устройств, разбивка по kind-чипам (🔀 свичи / 🎛 патчи / 🖥 серверы / 💾 СХД / ⌨ KVM / 📺 мониторы / 🔋 ИБП / ⇋ органайзеры / ▫ другое), число меж-шкафных связей с этой стойкой.',
      'Кнопка «+ в мастер» / «✓ выбрана» в каждой строке — переключает стойку в scs-design.selection.v1, синхронизируется с чипами вкладки «Связи».',
      'CSV-экспорт сводки по стойкам (тег, U, кВт, разбивка по ролям, связей).',
      'Файлы: scs-design/{index.html, scs-design.js (+rackStats, +renderRacksSummary, +exportRacksCsv), scs-design.css (+sd-racks-table, +sd-bar, +sd-kind-chip)}.',
    ] },
    { version: '0.59.202', date: '2026-04-22', items: [
      'Кабельные органайзеры исключены из endpoint-ов меж-шкафных связей: у них нет портов, роль — только канал/трасса для будущей маршрутизации сплайна кабеля через доступные каналы стойки. В карточках стоек органайзеры теперь рендерятся с диагональной штриховкой, курсив-меткой «⇋ …», cursor:default, без data-dev-id — клик игнорируется.',
      'Миграция на старте: sanitizeLinks() удаляет все ранее сохранённые связи, где endpoint = органайзер (kind=cable-manager), и показывает статус «Удалено N связь(ей) с кабельными органайзерами».',
      'Перспектива (roadmap, 1.26.4.x): органайзеры станут waypoint-ами сплайнов — точка, через которую рисуется фактическая трасса кабеля между endpoint-ами.',
      'Файлы: scs-design/{scs-design.js (+NO_PORT_KINDS, +isOrganizer, +sanitizeLinks, +renderRackCard-branch), scs-design.css (.sd-unit.organizer)}.',
    ] },
    { version: '0.59.200', date: '2026-04-22', items: [
      'SVG-оверлей кривых Безье поверх карточек стоек: меж-шкафные связи видно как линии от устройства A к устройству B. Цвет — по типу кабеля (синий для Cat.6/6A/7, оранжевый для OM3/OM4, жёлтый для OS2, фиолетовый для Coax, красный для питания C13, серый для «Другое»). Контрольные точки кривой автоматически подбираются по горизонтальному расстоянию между карточками.',
      'Легенда цветов над таблицей связей — показывает только те типы, которые фактически используются в проекте.',
      'Зелёная подсветка устройств, участвующих в связях: сразу видно, какое железо уже подключено, а какое «висит».',
      'Перерисовка линий при скролле ряда стоек, скролле списков юнитов внутри карточек, ресайзе окна и переключении на вкладку «Связи».',
      'Файлы: scs-design/{scs-design.js, scs-design.css, index.html}.',
    ] },
    { version: '0.59.199', date: '2026-04-22', items: [
      'Кабельный журнал (BOM СКС): агрегация меж-шкафных связей по типу кабеля — количество линий, суммарная длина и длина с коэффициентом запаса 1.3 (манхэттен × запас). Отдельная колонка «без длины» — подсказка, где ещё не заполнено.',
      'CSV-экспорт двух разрезов: «Кабельный журнал» (BOM по типам) и «Все связи» (плоский список с точками подключения, кабелем, длиной, заметкой). UTF-8 + BOM для Excel.',
      'Файлы: scs-design/{scs-design.js, scs-design.css, index.html}.',
    ] },
    { version: '0.59.198', date: '2026-04-22', items: [
      'Клик-по-клику: клик на устройство в одной стойке → клик на устройство в другой = создать связь. Повторный клик по подсвеченному = отмена. Связь внутри одного шкафа блокируется с подсказкой (такое настраивается в Компоновщике шкафа).',
      'Таблица меж-шкафных связей: inline-редактирование типа кабеля (Cat.6/6A/7, OM3/OM4/OS2, Coax, C13, Other), длины в метрах, заметки, удаление. Хранилище scs-design.links.v1.',
      'Статус-строка по ходу операции: «Выбран источник» / «Связь добавлена» / «Связь внутри шкафа — не здесь».',
      'Файлы: scs-design/{scs-design.js, scs-design.css, index.html}.',
    ] },
    { version: '0.59.197', date: '2026-04-22', items: [
      'Подфаза 1.26.4 (MVP) — «Мастер меж-шкафных связей». Вкладка «Связи» читает стойки проекта из rack-config.templates.v1 + scs-config.contents.v1, позволяет отметить чекбоксами N стоек и рендерит их рядом в виде карточек с картой юнитов (занятые/пустые U). Выбор сохраняется в scs-design.selection.v1. Реакция на storage-event: если в другой вкладке поменяли компоновку — карточки перерисовываются.',
      'Добавлены вкладки «План зала» (stub), «Стойки проекта» (stub), «О модуле» (навигация по 5 модулям Подфазы 1.26).',
      'Следующие шаги: клик по юниту A + клик по юниту B = создать port↔port-связь, отрисовка линий между карточками, BOM кабелей. Заделы в комментариях scs-design.js (LS_LINKS уже зарезервирован).',
      'Файлы: scs-design/{index.html,scs-design.js (новый),scs-design.css (новый)}.',
    ] },
    { version: '0.59.196', date: '2026-04-22', items: [
      'Создан stub модуля «Проектирование СКС» (Подфаза 1.26.3). Пустая главная страница с описанием будущих вкладок (План зала / Стойки / Связи) и выделенным анонсом встроенного мастера меж-шкафных связей. Хаб уже ссылается на scs-design/ — карточка перестала вести на 404.',
      'Файлы: scs-design/index.html (новый).',
    ] },
  ],
  'facility-inventory': [
    { version: '0.59.196', date: '2026-04-22', items: [
      'Создан stub модуля «Реестр оборудования объекта» (Подфаза 1.26.5). Главная страница с картой источников данных: mv-config, ups-config, transformer-config, panel-config, mdc-config, suppression-config, rack-config, it-inventory. Наполнение реальными данными — в будущих итерациях.',
      'Файлы: facility-inventory/index.html (новый).',
    ] },
  ],
  'scs-config': [
    { version: '0.59.343', date: '2026-04-26', items: [
      '🔒 <b>Project-lock в scs-config и scs-design при входе из карточки проекта.</b> Если URL содержит <code>?project=&lt;pid&gt;</code> (вход из <code>/projects/</code>), внутримодульный switcher проекта (dropdown «Контекст: …») скрыт и заменяется подсказкой «📌 Работа в проекте — переключение контекста заблокировано». Имя проекта уже выводится в общем хедере (project-badge из v0.59.342), поэтому дублирующий dropdown избыточен и сбивал пользователя. В direct-entry режиме (без URL-параметра) поведение прежнее — dropdown активен.',
      'Файлы: scs-config/racks-list.js (renderProjectBadge: проверка URL до рендера), scs-design/scs-design.js (renderProjectBadge: тот же гард).',
    ] },
    { version: '0.59.341', date: '2026-04-26', items: [
      '🩹 <b>Фикс: пустая модалка каталога после v0.59.339.</b> Подход «host hidden → DOM-move children в modal-body на open» оказался ненадёжен — пользователь видел только заголовок-полоску. Решение: разметка каталога (фильтры + <code>#sc-catalog</code> + tools) размещена напрямую внутри <code>#sc-cat-modal-body</code>, без скрытого host. Открытие/закрытие — простой toggle <code>modal.hidden</code>. ID полей сохранены, <code>renderCatalog()</code> и drag-binding работают как обычно.',
      'Файлы: scs-config/rack.html (#sc-cat-host удалён; разметка каталога перенесена в #sc-cat-modal-body; JS upmodal упрощён до toggle hidden).',
    ] },
    { version: '0.59.340', date: '2026-04-23', items: [
      '🔍 <b>Zoom/pan на основной карте юнитов + сохранение масштаба при port-click.</b> Раньше Ctrl+wheel работал только в модалке (<code>opts.big</code>), а в основном <code>#sc-unitmap</code> зум был принудительно z=1. Когда пользователь кликал порт для патч-корда, <code>renderUnitMap()</code> перерисовывал всё, и любой UI-state сбрасывался — отсюда жалоба «нельзя увеличить во время подключения». Теперь: (а) основная карта оборачивается в <code>.sc-zoomwrap-main</code> с <code>overflow:auto</code> и max-height:70vh; (б) <code>bindZoomPan</code> универсализован под параметр <code>stateKey</code> — модалка по-прежнему держит <code>state.dlgZoom</code>, основная карта — <code>state.mapZoom</code>; (в) перед перерисовкой сохраняется <code>scrollLeft/Top</code> текущего обёртка и восстанавливается на новом — клик по порту не «прыгает» виджет в начало.',
      'Файлы: scs-config/scs-config.js (renderUnitMap — sc-zoomwrap-main + scroll preservation; bindZoomPan — параметр stateKey).',
    ] },
    { version: '0.59.339', date: '2026-04-23', items: [
      '📦 <b>Каталог Компоновщика свёрнут до кнопки «+ Открыть».</b> Раньше каталог занимал бо́льшую часть правого сайдбара (фильтры + таблица), сжимая «Тележку» и «Склад» и забирая ширину карты юнитов. Теперь в сайдбаре только кнопка «+ Открыть»; полное окно с фильтрами/поиском/U-диапазоном/drag&drop появляется в модалке (<code>#sc-cat-modal</code>, ширина до 1100px, 90vh). DOM-узлы каталога перемещаются между скрытым host-блоком и модалкой — так не теряются listeners (<code>renderCatalog</code> и drag-binding в <code>scs-config.js</code> работают с теми же id). Закрытие — кнопкой ✕, кликом по подложке или Esc.',
      'Файлы: scs-config/rack.html (sc-catalog-section → компактная карточка + sc-cat-host скрыт + sc-cat-modal с overlay).',
    ] },
    { version: '0.59.338', date: '2026-04-23', items: [
      '📐 <b>Топбар Компоновщика шкафа переехал в левый сайдбар.</b> Раньше выбор «Физический шкаф», поля Всего U / Занято / Свободно / Мощность, Тег, корпус-шаблон, готовая сборка и кнопки занимали всю ширину сверху и дублировали список «🗄 Шкафы» сбоку. Теперь это компактный вертикальный <code>&lt;details&gt;</code> «⚙ Параметры стойки» в левом сайдбаре над списком шкафов: его можно свернуть, остаются только нужные поля. Карта юнитов получает значительно больше высоты. Все ID полей сохранены — JS-биндинги <code>scs-config.js</code> работают без изменений.',
      'Файлы: scs-config/rack.html (sc-topbar → sc-topbar-side в aside.sc-racks-side).',
    ] },
    { version: '0.59.337', date: '2026-04-23', items: [
      '🤝 <b>Мини-проекты теперь общие в семействе модулей.</b> Раньше <code>listProjectsForModule(\'scs-design\')</code> возвращал только sketch-проекты с <code>ownerModule===\'scs-design\'</code>, и наоборот для scs-config — поэтому черновик, созданный в «Проектировании СКС» (Мастер меж-шкафных связей), не появлялся в «Шкафах проекта», и пользователю предлагалось создать новый. Введён конструкт <code>MODULE_FAMILIES</code> в <code>shared/project-storage.js</code>: семейство СКС = [scs-design, scs-config, scs-config-inventory, mdc-config]; семейство электрики = [schematic, panel-config, mv-config, ups-config, pdu-config, rack-config]. Теперь sketch-проект, созданный в любом модуле семейства, виден во всех остальных модулях того же семейства.',
      'Файлы: shared/project-storage.js (+_familyOf, расширение listProjectsForModule по семейству).',
    ] },
    { version: '0.59.335', date: '2026-04-23', items: [
      '🔢 <b>Фикс: «Занято оборудованием» в топбаре Компоновщика показывало 0 даже при полной стойке.</b> Раньше поле <code>#sc-rack-occ</code> выводило <code>r.occupied</code> — это число юнитов, <i>зарезервированных корпусом стойки</i> (шасси, вентиляторы), а не суммарная занятость. На скриншоте пользователя SR01 показывал «13 уст.» в сайдбаре и «62%» загрузки, но топбар — «0». Теперь вычисляется <code>computeOccupiedU(r, currentContents())</code>: объединение occupied-массива по front+rear с учётом высот устройств (<code>type.u</code> из каталога) плюс <code>r.occupied</code> сверху. Расхождение между сайдбаром и топбаром устранено.',
      'Файлы: scs-config/scs-config.js (+computeOccupiedU, замена <code>$(\'sc-rack-occ\').textContent = r.occupied</code> в двух местах).',
    ] },
    { version: '0.59.302', date: '2026-04-23', items: [
      '🔌 <b>Клики по портам → патч-корды.</b> В карте юнитов порты коммутаторов и патч-панелей теперь кликабельные (<code>.sc-port</code> с <code>data-devid</code> + <code>data-port</code>). Клик по первому порту — выделение индиго, клик по второму порту на другом устройстве — создание записи в матрице патч-кордов (<code>{a: «LabelA/p1», b: «LabelB/p2», cable, lengthM:2}</code>). Тип кабеля определяется автоматически: оптические разъёмы (LC/SC/SFP…) → om4, иначе → cat.6a. Повторный клик по тому же порту — отмена. Занятые порты подсвечены красным + курсор ⇢, в tooltip подпись «порт N · занят».',
      '📏 <b>Реальное число портов в фасаде.</b> Было: число портов ограничивалось шириной фасада (8…24 визуальных прямоугольника). Стало: рисуется ровно <code>type.ports</code> портов (1…48), ширина порта — <code>facadeW / portCount</code>. Так на 48-портовой панели видны все 48 слотов, и клики попадают в правильный номер.',
      '🔗 <b>Определение занятости портов.</b> Эндпойнты в матрице — свободный текст; парсим «Label/pN» или «Label/N» через регэксп <code>/^[\\s\\/\\-:]*p?(\\d+)/</code> после совпадения префикса label. Так подсветка «занят» работает и для ранее созданных записей.',
      'Файлы: scs-config/scs-config.js (+portsUsedForDev, +onPortClick, рендер порта с data-attrs/классами .sel/.used и stopPropagation в bindUnitMapDrag, +click-delegation на svg после bindUnitMapDrag).',
    ] },
    { version: '0.59.287', date: '2026-04-22', items: [
      '📋 В «Каталог типов оборудования» добавлена колонка «Скор.» (свободный текст: 1G/10G/40G/100G…). Значение сохраняется в catalog[i].portSpeed. Вместе с уже существующими «Порты» (количество) и «Порт» (тип разъёма: RJ45/LC/SC/SFP/BNC/F/C13/C14/power) — полный набор полей для описания сетевого порта.',
      'Файлы: scs-config/scs-config.js (renderCatalog: +колонка Скор. перед цветом, +input data-k="portSpeed"; colspan 10→11).',
    ] },
    { version: '0.59.286', date: '2026-04-22', items: [
      '← «Назад» в Компоновщике шкафа: если URL содержит ?from=scs-design|mv-config|mdc-config|projects|rack-config|hub, слева в крошках появляется линк «← Назад в «Проектирование СКС»» (подпись зависит от from). Решает сценарий: пользователь пришёл из scs-design по ✎ на карточке стойки → сконфигурировал → нажал «Назад» → вернулся туда, откуда пришёл, не блуждая по главному меню.',
      'scs-design автоматически добавляет ?from=scs-design при построении ссылки ✎ на карточке стойки (renderRackCard).',
      'Файлы: scs-config/rack.html (#sc-back-link + module-скрипт с карточкой FROM), scs-design/scs-design.js (URL ✎-кнопки + &from=scs-design).',
    ] },
    { version: '0.59.284', date: '2026-04-22', items: [
      '🏢 На странице «Шкафы проекта» появился project-bar (select активного проекта + «＋ Мини-проект» + линк в /projects/). Выбор контекста идентичен scs-design — переключение перезагружает страницу в рамках выбранного проекта/sketch.',
      '➕ Кнопка «Добавить шаблон стойки» заменена на «Новая стойка в проект». Открывает inline-wizard (имя / тег / U / ширина / глубина) и создаёт экземпляр inst-* ПРЯМО в активном проекте — без создания шаблона в глобальной библиотеке rack-config. Это закрывает корневую путаницу: стойки проекта и шаблоны корпусов — разные сущности.',
      '📐 Ссылка на rack-config сохранена как «📐 Шаблоны корпусов…» справа — подписана: «Библиотека шаблонов корпусов (общая для всех проектов)».',
      'Файлы: scs-config/index.html (project-badge mount + обновлённый sc-tools), scs-config/racks-list.js (renderProjectBadge, newRackWizard, createNewInstance, импорт rsToast/rsConfirm/rsPrompt и listProjectsForModule/createSketchForModule/setActiveProjectId/getProject).',
    ] },
    { version: '0.59.282', date: '2026-04-22', items: [
      '🔌 В каталоге типов оборудования появилась колонка «Порт» — select с вариантами (авто/RJ45/LC/SC/SFP/BNC/F/C13/C14/силовой/без портов). Значение сохраняется в catalog[i].portType и используется scs-design в inferPortType() как override перед эвристикой. «авто» (пустое значение) — оставить определение по kind + label, как раньше.',
      'Зачем: когда SFP-свитч или оптический бокс определялись как RJ45 по kind=switch, меж-шкафная связь валидировалась неправильно. Теперь можно задать физический тип порта явно, и ⚠ в scs-design пропадёт.',
      'Файлы: scs-config/scs-config.js (PORT_TYPE_OPTIONS, renderCatalog: +column, data-k="portType").',
    ] },
    { version: '0.59.280', date: '2026-04-22', items: [
      '↶ «Применить корпус» теперь обратимо: перед копированием полей шаблона в стойку сохраняется снимок (U, ширина, глубина, двери, рельсы, PDU, акссессуары, kitId, manufacturer, name, sourceTemplateId/Name) в r._corpusBackup. Рядом с кнопкой «↪ Применить корпус» появляется «↶ Вернуть» — возвращает состояние к моменту перед применением. Кнопка скрыта, если снимка нет.',
      '📋 Модалка подтверждения теперь показывает diff: «U: 42 → 47; Ширина, мм: 600 → 800; PDU: 2 → 4 …». Легко понять, что именно изменится, до клика «Применить».',
      '💾 «В новый шаблон» — новая кнопка в тулбаре: копирует текущую геометрию стойки в новый tpl-* и кладёт его в глобальный каталог rack-config (с проверкой уникальности имени). Опционально перепривязывает sourceTemplateId текущей стойки на только что созданный шаблон. Так правки «экземпляра» никогда не утекают в исходный шаблон.',
      'Файлы: scs-config/scs-config.js (CORPUS_FIELDS, snapshotCorpus, applyCorpus-diff+backup, revertCorpus, saveCorpusAsNewTemplate, renderCorpusPicker show/hide revert, bind), scs-config/rack.html (кнопки sc-corpus-revert, sc-corpus-save-as).',
    ] },
    { version: '0.59.278', date: '2026-04-22', items: [
      '📦 Этап 2 рефакторинга: экземпляры стоек (inst-*) переехали в project-scoped хранилище <code>raschet.project.&lt;pid&gt;.rack-config.instances.v1</code>. Шаблоны корпусов (tpl-* и без префикса) остались в <code>rack-config.templates.v1</code> (глобально). Одноразовая миграция при первой загрузке разбивает старый смешанный массив по id-префиксу и переносит inst-* в активный проект. Маркер <code>rack-config.instances.migrated.v1</code>.',
      '🧭 Теперь экземпляры проекта строго изолированы: удаление/копирование проекта автоматически чистит/клонирует и стойки (см. projects.js copyProject → id-map на inst-*). Два разных проекта больше не «видят» стойки друг друга даже если у них совпадают теги.',
      '🆕 shared/rack-storage.js — единая точка: loadAllRacksForActiveProject/saveAllRacksForActiveProject/loadTemplates/loadInstances/migrateLegacyInstances/cloneInstancesBetweenProjects/wipeInstancesForProject. Все модули (scs-config, racks-list, scs-design, inventory) читают/пишут через него.',
      '🔧 scs-design: createProjectRack теперь создаёт <code>inst-*</code> id (раньше tpl-*), чтобы сразу попадать в project-scope.',
      'Файлы: shared/rack-storage.js (новый), scs-config/scs-config.js (loadRacks → shared, saveRacks, applyCorpus), scs-config/racks-list.js, scs-config/inventory.js, scs-design/scs-design.js.',
    ] },
    { version: '0.59.277', date: '2026-04-22', items: [
      '🗄 Этап 1 крупного рефакторинга «стойка ↔ шаблон корпуса + project-scope». Теперь экземпляр стойки в проекте хранит ссылку <code>sourceTemplateId</code>/<code>sourceTemplateName</code> на шаблон из Конфигуратора стоек. В сайдбаре и в дропдауне «Физический шкаф» отображается label вида <code>A-02 (600x1200x42U Тип 1 · 42U)</code> — один шаблон может использоваться для многих экземпляров.',
      '🧰 В топ-баре композера добавлен новый селектор «Корпус (шаблон)» с кнопкой «↪ Применить корпус». Применение копирует геометрию (U, ширина, глубина, двери, PDU, «занято корпусом») из выбранного шаблона на текущую стойку и фиксирует <code>sourceTemplateId</code>. Содержимое (устройства) не затрагивается.',
      '🔧 racks-list.js / deployFromTemplate: при развёртывании шаблона в проект в экземпляре сохраняются <code>sourceTemplateId</code> и <code>sourceTemplateName</code>.',
      'Следующие этапы (отдельными итерациями): (2) Разделение хранения шаблонов и экземпляров + project-scope storage вместо глобального rack-config.templates.v1; (3) Копирование и удаление мини-проектов; (4) Фильтрация в scs-design (план-зал, меж-шкафные связи) строго по проекту; (5) Модель port-type / line-type в кабельных связях — совместимость портов.',
      'Файлы: scs-config/rack.html (новый селектор + кнопка), scs-config/scs-config.js (rackLabel, renderCorpusPicker, applyCorpus + хуки на rerender/rack-change), scs-config/scs-config.css (.sc-rack-card-corpus), scs-config/racks-list.js (deployFromTemplate сохраняет sourceTemplate*).',
    ] },
    { version: '0.59.276', date: '2026-04-22', items: [
      '🐛 КРИТ-ФИКС: <code>SyntaxError: Identifier \'hint\' has already been declared</code> на строке 1471 — в функции 3D-рендера переменная <code>hint</code> объявлялась дважды (первый раз на ~стр. 1047 — hint-оверлей управления камерой, второй — hint-легенда с чекбоксами видимости). Ошибка парсинга ES-модуля глушила ВЕСЬ scs-config.js ДО выполнения первой строки: пустой композер, нет каталога, нет стоек, нет обработчиков кликов (user: «шкафы есть, но при открытии пусто»). Второй <code>const hint</code> переименован в <code>legend</code>, все последующие обращения <code>hint.*</code> внутри блока — тоже. Найдено благодаря v0.59.275 boot-watchdog, показавшему текст SyntaxError в красном баннере.',
      'Файлы: scs-config/scs-config.js (строки 1470–1489: hint → legend).',
    ] },
    { version: '0.59.275', date: '2026-04-22', items: [
      '🚨 Ранний boot-watchdog в rack.html: инлайновый (non-module) скрипт ловит window.error/unhandledrejection ДО загрузки scs-config.js и через 800 мс проверяет, отрисовался ли каталог. Если модуль упал на этапе parse/import (syntax-error, 404, MIME mismatch) — показывается красный баннер с названием ошибки, источником и инструкцией (F12 / localStorage.clear). Раньше такие сбои выглядели как «пустой композер» без единого сообщения (user: «даже каталога и шаблонов нет»).',
      '🧹 Санитарная проверка сохранённого фильтра каталога: если uMin > max(heightU) каталога или uMax < 1 (исторический мусор) — фильтр сбрасывается автоматически, иначе пользователь видел пустой каталог без понимания причины.',
      'Файлы: scs-config/rack.html (инлайновый boot-watchdog), scs-config/scs-config.js (sanitize catFilter в init).',
    ] },
    { version: '0.59.274', date: '2026-04-22', items: [
      '🔗 Исправлен «пустой композер» при открытии по прямой ссылке <code>rack.html?rackId=inst-…</code>. Ранее если стойка не имела TIA-942 тега в текущем проекте, projectRacks() её фильтровал → дропдаун/сайдбар/карта оставались пустыми без объяснений (user: «не работает, страница на адресе …rackId=inst-xb7o4v0v»). Теперь:',
      '  • projectRacks() дополнительно включает стойку, id которой совпадает с URL-параметром rackId, даже без тега.',
      '  • В блоке «⚠ Проверки» появляется конкретная подсказка «Стойка <id> не имеет TIA-942 тега — присвойте тег, иначе она скрывается из сайдбара/BOM».',
      'Файлы: scs-config/scs-config.js (projectRacks URL-pin + renderWarnings no-tag banner).',
    ] },
    { version: '0.59.273', date: '2026-04-22', items: [
      '🛡 Защита от «молчаливой поломки» композера. Ранее при повреждённом localStorage или runtime-ошибке инициализации интерфейс оставался пустым без единой подсказки (user: «Компоновщик вообще сломался»). Теперь:',
      '  • init() обёрнут в try/catch — при сбое показывается красный баннер вверху страницы с сообщением ошибки и инструкцией (F12 → Console, localStorage.clear()).',
      '  • window.error/unhandledrejection перехватывают runtime-ошибки и показывают всплывающий toast + пишут в console.',
      '  • state.{racks,catalog,contents,matrix,templates,cart,rackTags,warehouse} принудительно приводятся к правильному типу (Array/Object) — защита от случаев, когда LS сохранил null/число/строку.',
      '  • В пустом каталоге из-за фильтров показывается инфо-строка «⚠ Все N записей скрыты фильтрами. Нажмите ✕ Сброс».',
      'Файлы: scs-config/scs-config.js (init try/catch + global error handlers + type guards + empty-catalog hint).',
    ] },
    { version: '0.59.272', date: '2026-04-22', items: [
      '↕ Таблица «Содержимое стойки» сортируется сверху вниз по physicalU (positionU desc). На одном U — front перед rear. Порядок в state.contents НЕ меняется; dataset.idx ссылается на оригинальный индекс, правки и удаление/дублирование работают корректно.',
      'Файлы: scs-config/scs-config.js (viewOrder в renderContents).',
    ] },
    { version: '0.59.271', date: '2026-04-22', items: [
      '⎘ Кнопка «Дублировать» в каждой строке содержимого стойки: создаёт копию устройства в ближайшем свободном U-слоте той же стороны (front/rear), с пометкой «(копия)» в названии. pduOutlet сбрасывается (slot-specific — 1 розетка = 1 устройство). Toast с U-номером размещения.',
      'Файлы: scs-config/scs-config.js (data-dup handler в renderContents).',
    ] },
    { version: '0.59.270', date: '2026-04-22', items: [
      '⌨ Горячие клавиши: `U` — переключить направление U-нумерации (bu↔td); `F` — циклически переключить вид стойки (Фронт → Тыл → Обе → Бок → 3D). Игнорируются в input/textarea/select/contentEditable и при Ctrl/Alt/Meta. Подсказки в title кнопок обновлены.',
      'Файлы: scs-config/scs-config.js (document keydown listener), scs-config/rack.html (title-подсказки с «· F» и «· клавиша U»).',
    ] },
    { version: '0.59.269', date: '2026-04-22', items: [
      '📊 Баланс по вводам PDU в панели предупреждений: для каждого feed (A/B/C/D) показывается load/cap кВт и %. Цвет по % (синий <50, зелёный 50–80, оранжевый 80–100, красный >100). Позволяет на глаз оценить балансировку 2N до того, как случится перегруз.',
      'Файлы: scs-config/scs-config.js (feedList в renderWarnings), scs-config/scs-config.css (.sc-warn-item.info).',
    ] },
    { version: '0.59.268', date: '2026-04-22', items: [
      '⚡ Новое поле «Мощность» в top-bar: сумма powerW всех устройств стойки. Если у стойки задан demandKw — показывается и % использования (цвет: >80% оранжевый, >100% красный).',
      'Файлы: scs-config/rack.html (output#sc-rack-power), scs-config/scs-config.js (renderContents: totalW/pct/color).',
    ] },
    { version: '0.59.267', date: '2026-04-22', items: [
      '📏 Новое поле «Свободно» в top-bar: показывает непрерывные свободные U-диапазоны (например «U3–U8, U15, U22–U24») с учётом «занятых стойкой» сверху и всех размещённых устройств. Обновляется при смене стойки и любой перерисовке контента (renderContents).',
      'Файлы: scs-config/rack.html (output#sc-rack-free), scs-config/scs-config.js (freeURanges + calls in renderOverview/renderContents/rack-change handler).',
    ] },
    { version: '0.59.266', date: '2026-04-22', items: [
      '✕ Кнопка «Сброс» в фильтрах каталога — разом очищает поиск, тип, U-min и U-max (и в state, и в LS, и в DOM-инпутах).',
      'Файлы: scs-config/rack.html (button#sc-cat-filter-clear), scs-config/scs-config.js (handler), scs-config/scs-config.css (.sc-btn-sm).',
    ] },
    { version: '0.59.264', date: '2026-04-22', items: [
      '💾 Фильтры каталога персистятся между сессиями: подстрока поиска, тип, U-min/U-max. Ключ localStorage `scs-config.catFilter.v1`. При открытии модуля инпуты восстанавливаются из сохранённого значения; select «Все типы» получает нужную selection после populate.',
      'Файлы: scs-config/scs-config.js (state.catFilter init из LS + saveCatFilter() в bindCatFilter + post-populate kf.value в renderCatalog).',
    ] },
    { version: '0.59.263', date: '2026-04-22', items: [
      '🔧 Критический fix: в renderSideView (📐 Бок) переменная frontClearance использовалась, но не была объявлена → ReferenceError валил рендер side-view при любом открытии. Добавлены frontClearance = railFrontOffset и rearClearance = rackDepth − railFrontOffset − railDepth. Обе зоны клиренса теперь подсвечиваются голубым/красным полупрозрачно с title-тултипами в мм.',
      'Файлы: scs-config/scs-config.js (renderSideView: fix ReferenceError).',
    ] },
    { version: '0.59.262', date: '2026-04-22', items: [
      '💾 3D: персист позиции камеры между открытиями. Ключ localStorage зависит от геометрии стойки (U × width × depth), чтобы при переходе на стойку другого размера не наследовать неподходящий кадр. Сохраняется debounced (200 мс) на controls.change; очищается таймер в _3dCleanup.',
      'Файлы: scs-config/scs-config.js (camKey + load/save в renderRack3D).',
    ] },
    { version: '0.59.261', date: '2026-04-22', items: [
      '🧊 3D-вид: двери теперь ПЕРФОРИРОВАННЫЕ (как в реальных ЦОД-стойках Rittal TS IT / APC NetShelter / Eaton) — сгенерированная canvas alpha-текстура с сеткой круглых отверстий + рамка по периметру, хромированная ручка и петли.',
      '🦵 3D: ножки по углам корпуса (регулируемые опоры, 40×50×50 мм); пол и grid опущены на высоту ножек, чтобы стойка реально стояла на полу, а не висела в нём.',
      'Файлы: scs-config/scs-config.js (mkPerfTexture → CanvasTexture + alphaMap, perfDoorMat front+rear, рамка frameMat, handleMat, feet по углам, floor/grid y = -FOOT_H).',
    ] },
    { version: '0.59.260', date: '2026-04-22', items: [
      '🔧 Каталог в Компоновщике: упростил CSS скролл-обёртки — вместо flex:1 +min-height:0 (что схлопывалось в 0 в некоторых layout-контекстах) явный max-height: 55vh + overflow-y: auto на .sc-cat-scroll. Фильтры больше не sticky внутри контейнера — они часть обычного потока секции.',
      '📐 Rack-config: мини-карта юнитов в превью теперь показывает U-номера С ДВУХ СТОРОН (как в главной Компоновщике). Вертикальные 0U-PDU распределяются по вводу: A, C — слева, B, D — справа (а не чередованием). Раскладка: [PDU_L | U#L | RACK | U#R | PDU_R].',
      '🔧 Rack-config: fix «auto-поле навсегда» — поле с меткой «=auto» больше НЕ readOnly. Пользователь может кликнуть и начать редактировать любое из 3 полей (отступ фасада / глубина рельс / отступ тыла); LRU поднимает его в manual, а auto перекочует на поле, которое трогали давнее всего. Визуально auto — зелёный фон + title-подсказка.',
      'Файлы: scs-config/scs-config.css (.sc-cat-scroll: max-height:55vh + overflow-y:auto; .sc-catalog-section без flex), rack-config/rack-config.js (renderRailFields: убрал readOnly, добавил подсветку auto; renderUnitMap: dual-side U + leftVert/rightVert split по feed A/C vs B/D).',
    ] },
    { version: '0.59.259', date: '2026-04-22', items: [
      '🔧 Fix: красная warn-полоса над переполненной PDU-зоной теперь реально показывает tooltip — <title> перенесён ВНУТРЬ <rect> (SVG-хост для title-элемента).',
      '⚠ Дублирующая текстовая проверка в блоке «Предупреждения» (sc-warn): если вводов A/C > 2 или B/D > 2 — отдельной err-строкой. Чтобы пользователь видел ошибку даже не глядя на SVG.',
      'Файлы: scs-config/scs-config.js (renderUnitMap: <g><rect><title>…; renderWarnings: pdu fit-side checks).',
    ] },
    { version: '0.59.258', date: '2026-04-22', items: [
      '🔢 U-номера теперь показываются с ОБЕИХ сторон стойки (слева и справа). Левая — text-anchor=end, правая — text-anchor=start. Нумерация синхронна.',
      '↕ Переключатель направления U-нумерации: кнопка «↕ 1↓/1↑» в режиме-баре карты юнитов. «bu» (по умолчанию, EIA-310) — 1 снизу; «td» — 1 сверху. Persist в localStorage[\'scs-config.uNumDir.v1\'].',
      '⚡ PDU разведены по сторонам: вводы A, C рисуются слева от стойки (снаружи U-номеров), B, D — справа. PDU без feed распределяются попеременно. На каждую сторону физически умещается не более 2 вертикальных 0U-PDU; если назначено больше — сверху над лишней зоной рисуется красная полоса с <title> warn-tooltip.',
      '🏷 Подписи устройств сдвинуты дальше вправо — за правую зону PDU + U-номера, чтобы не перекрываться.',
      'Раскладка: [PDU_L | U# L | RACK | U# R | PDU_R | GAP | LABEL]. svgW пересчитан; wire rightX тоже.',
      '📦 Каталог оборудования в правом сайдбаре теперь скроллится отдельно от страницы (max-height: 70vh, sticky-шапка таблицы). Добавлены фильтры: поиск по названию/id, выпадающий фильтр по типу (kind), диапазон U (от/до), счётчик «показано / всего».',
      '🧊 3D-вид: явно включено панорамирование (screen-space pan) через ПКМ, Shift+ЛКМ и стрелки; повышена скорость пана и keyPanSpeed=30. Снизу канваса hint-подсказка по управлению камерой.',
      '🧊 3D-рендер более правдоподобный: MeshStandard (PBR) вместо Lambert для рельс/корпуса/дверей/ушей/фасада/устройств, HemisphereLight (небо-пол) + ключевой + заполняющий + rim-свет, ACES-тонмаппинг, PCFSoft-тени (cast/receive у всех боксов), пол — плоскость, принимающая тени, под сеткой.',
      'Файлы: scs-config/scs-config.js (state.uNumDir, новые константы раскладки unit-map, dual-side U-rendering, split PDU leftFeeds/rightFeeds, pduFitBad warn-rect, labelX через PDU_RIGHT_X+zone, bind sc-unum-toggle; renderCatalog — state.catFilter + сборка dropdown kind + подсчёт shown/total; renderRack3D — OrbitControls.enablePan/screenSpacePanning/keyPanSpeed/listenToKeyEvents, hemisphere+rim light, ACES tone mapping, PCFSoft shadows, MeshStandard по всем материалам), scs-config/rack.html (кнопка #sc-unum-toggle, блок .sc-cat-filters + .sc-cat-scroll), scs-config/scs-config.css (.sc-catalog-section flex-column + max-height: 70vh, sticky-header таблицы, стили фильтров).',
    ] },
    { version: '0.59.257', date: '2026-04-22', items: [
      '🗂 Каталог IT-оборудования вынесен в отдельный shared/scs-catalog-data.js (по образцу shared/rack-catalog-data.js, breaker-seed.js и т.п.). Категории: GENERIC_CATALOG / AI_SERVERS_CATALOG / GP_SERVERS_CATALOG / SWITCHES_CATALOG / STORAGE_CATALOG / SECURITY_CATALOG. Единый SCS_DEFAULT_CATALOG = сумма категорий.',
      '🤖 Добавлено ~25 реальных моделей: Supermicro SYS-821GE-TNHR / 421GE-TNHR2 / AS-8125GS-TNHR / 521GE-TNRT / ARS-211GL-NHIR / 741GE-TNRT; NVIDIA DGX H100, DGX H200, Quantum-2 QM9700, Spectrum SN3700/SN5600; Cisco Nexus 9336C-FX2, 93180YC-FX3, Catalyst 9300, UCS C240 M7; Arista 7050CX3-32S, 7280R3; Dell R760/R660, PowerVault ME5084; HPE DL380/DL360 Gen11, Cray XD685; Lenovo SR650 V3; Juniper QFX5120; HPE Aruba CX 6300M; Supermicro SuperStorage 6049P; Palo Alto PA-5450.',
      '🎨 Новые kind + подробная графика: server-gpu (радиатор-рёбра сверху, ряд GPU-модулей с NVIDIA-green акцентом, LED-линейка активности), storage (grid HDD-отсеков с per-bay LED), firewall (дисплей OK + LED ряды), router (SFP-cages). В SVG и 3D.',
      '📏 Геометрия рельс — 3 связанных поля: «Отступ от фасада» + «Глубина рельс» + «Отступ от тыла» (сумма = глубина корпуса). Пользователь заполняет любые 2, третье вычисляется автоматически (зелёная метка =auto). Последнее отредактированное поле ведёт очередь LRU: auto-полем становится то, что трогали давнее всего.',
      '🧵 scs-config использует railFrontOffset из rack-config для позиции передних рельсов (не симметрично, как в v0.59.256): side-view и 3D-вид рисуют рельсы в настоящем месте, где они закреплены в корпусе.',
      '🔄 Миграция каталога: auto-append новых моделей по id при загрузке localStorage — существующие пользовательские правки не перезаписываются.',
      'Файлы: shared/scs-catalog-data.js (новый, 6 категорий + KIND_LABEL), scs-config/scs-config.js (import + auto-append миграция + новые facade-рендеры для server-gpu/storage/firewall/router), rack-config/index.html (3-поле rail-front/depth/rear), rack-config/rack-config.js (ensureRailLru / renderRailFields / onRailFieldInput / reconcileRailGeometry).',
    ] },
    { version: '0.59.256', date: '2026-04-22', items: [
      '📏 Новая настройка «Глубина рельс, мм» в Конфигураторе корпуса (rack-config): расстояние между монтажными плоскостями передних и задних 19"-рельсов. Диапазон 300…1150 мм (по умолчанию 750). Ограничение: railDepth ≤ depth − 80 (зазор на двери). Preserve-on-miss: если поле пустое или значение вне диапазона — старое t.railDepth сохраняется.',
      '🧵 Side-view в Компоновщике: рельсы теперь рисуются в корректных позициях по railDepth (не на краях корпуса). Зазор между корпусом и рельсом слегка подсвечен цветом стороны. Устройства начинаются от монтажной плоскости, а не от края корпуса.',
      '🧊 3D-вид: рельсы спозиционированы симметрично — front=(rackD−railDepth)/2, rear=front+railDepth. Устройства, уши, фасады, бейджи конфликта и полки пересчитаны относительно монтажных плоскостей.',
      '⚠ Проверка коллизий глубины теперь сравнивает depthFront + depthRear + 50 мм с railDepth (а не с полной глубиной корпуса) — ближе к физике: оборудование крепится на рельсы, а не в корпус.',
      'Файлы: rack-config/index.html (поле rc-rail-depth), rack-config/rack-config.js (default t.railDepth=750, read/write с sanity-check), scs-config/scs-config.js (renderSideView: frontRailX/rearRailX; renderRack3D: railFrontZ/railRearZ; detectDepthConflicts: сравнение с railDepth).',
    ] },
    { version: '0.59.255', date: '2026-04-22', items: [
      '🧹 Модель «Физический шкаф» прояснена: в проекте показываются ТОЛЬКО стойки с тегом (развёрнутые физические шкафы). Бестеговые «Новый шаблон 42U» из глобальной библиотеки корпусов (rack-config.templates.v1) больше не попадают ни в реестр проекта, ни в сайдбар, ни в dropdown Компоновщика. При свежем запуске из хаба реестр проекта пуст — физические шкафы создаются через «➕ Развернуть».',
      '🔒 Сайдбар Компоновщика: клик по другой стойке теперь делает явный переход (location.href на ./rack.html?rackId=…) вместо тихой подмены state.currentRackId. Случайно переключиться на чужой шкаф невозможно — URL и breadcrumb сразу это отражают.',
      '📋 Реестр шкафов: убран раздел «Черновики/шаблоны без тега» — он не относится к проекту. Empty state указывает развернуть шкаф из шаблона корпуса. Summary упрощён.',
      '🐛 projects.js: ключ rackTags читался в lowercase (racktags.v1) — счётчик шкафов проекта на Странице проектов был занижен. Исправлено на rackTags.v1.',
      '🗄 rack-config: чтение тегов теперь агрегирует все project-scoped ключи raschet.project.*.scs-config.rackTags.v1 — реальные стойки из любого проекта помечаются корректно в глобальном Конфигураторе корпуса.',
      'Файлы: scs-config/scs-config.js (projectRacks() helper, renderRackPicker/renderRacksSidebar фильтр по тегу, клик в сайдбаре = location.href), scs-config/racks-list.js (render() без drafts, новый empty state и summary), projects/projects.js (регистр ключа), rack-config/rack-config.js (renderTemplateList — агрегация tags по проектам).',
    ] },
    { version: '0.59.254', date: '2026-04-22', items: [
      '🔧 Fix 3D: отвалился после v0.59.253 — в drawFacade новые Mesh создавались через Object.assign(new Mesh(...), {position: new Vector3(...)}) и это ломало внутренний matrix Object3D (position — accessor). Добавлен helper mkMesh с position.set(); все фасадные меши переведены на него.',
      '📋 Новая раскладка SVG-карты: подписи устройств вынесены ВПРАВО за корпус стойки с тонкой линией-связкой цвета устройства. Читаемость резко выросла: длинные имена не обрезаются корпусом.',
      '⚡ Вертикальные PDU: слева от стойки рисуется полоса на каждый ввод (до 2 PDU). Розетки — круги, занятые помечены цветом ввода (по pduOutlet), свободные — серые. Сверху — подпись ввода (A/B).',
      '🔢 U-номера сдвинуты левее (x=16) — освобождено место под вертикальный PDU, сам корпус стойки автоматически сдвигается чтобы PDU легла рядом с реком.',
      'Файлы: scs-config/scs-config.js (renderUnitMap раскладка + renderRack3D mkMesh).',
    ] },
    { version: '0.59.253', date: '2026-04-22', items: [
      '🟪 Новый режим «Обе» (data-face="both"): шкаф делится пополам — левая половина фронт (синяя рамка), правая тыл (красная штриховая). Подпись сторон сверху. Центральная разделительная линия.',
      '🎯 Drop с превью: при перетаскивании из каталога/тележки/склада видно куда ляжет устройство. В режиме «Обе» превью рисуется в той половине, над которой курсор — сторона монтажа определяется X-координатой (левая → фронт, правая → тыл). Красный превью если место занято.',
      '📐 Drop в Side-view: теперь можно перетаскивать из каталога/тележки/склада прямо на вид сбоку. Сторона определяется X (левее середины → фронт, правее → тыл), U — по Y. Превью показывает реальную глубину из каталога.',
      '🖼️ Фасад устройства по type.kind: коммутатор — зелёные порты, патч-панель — жёлтые порты, PDU — синие розетки, сервер — HDD-отсеки + LED. В 3D — объёмный фасад на монтажной плоскости, в SVG — мелкие элементы внутри корпуса.',
      '🗄️ Новый kind "shelf" (полка): тонкий поддон по всей глубине с бортиком спереди, штриховка в SVG. Две дефолтные полки в каталоге (1U/400мм и 2U/600мм).',
      '⇄ Dual-side ports: у типа появился флаг portsRear (чекбокс в каталоге) — если включён, фасад рисуется и на тыльной стороне. Маркер «⇄» в подписи устройства.',
      '🔧 Fix 3D ушей: теперь это плоские пластины СНАРУЖИ рельсов на монтажной плоскости (front или rear), а не между корпусом и рельсом. Выглядят как настоящие 19" фланцы.',
      '🔧 Fix SVG ушей: узкие вертикальные полосы у самого края корпуса изнутри (а не снаружи) — как винтовые фланцы реального rack-mount.',
      'Файлы: scs-config/scs-config.js (renderUnitMap + renderRack3D + bindSideViewDrop + bindUnitMapDrop + DEFAULT_CATALOG + renderCatalog), scs-config/rack.html (data-face="both").',
    ] },
    { version: '0.59.252', date: '2026-04-22', items: [
      '🔧 Side-aware доводка: drag существующего устройства внутри стойки (pointerdown на полосе) теперь пробрасывает d.mountSide в canPlace — тыловое устройство можно двигать по тем же юнитам, что заняты фронтовым.',
      '🛒 Тележка и 📋 шаблоны сохраняют mountSide + depthMm: moveToCart переносит сторону/глубину, installFromCart восстанавливает (fallback = текущий faceMode). applyTemplate создаёт устройства с сохранённой стороной.',
      'Файлы: scs-config/scs-config.js (bindUnitMapDrag, moveToCart, installFromCart, saveTemplate, applyTemplate).',
    ] },
    { version: '0.59.251', date: '2026-04-22', items: [
      '🐛 Fix: с тыльной стороны не удавалось разместить оборудование. addToRack хардкодил mountSide="front", findFirstFreeSlot/canPlace/findNearestFreeSlot не учитывали сторону. Теперь при активном 🟥 Тыл новые устройства ставятся на заднюю сторону, и front/rear независимы по юнитам — устройство на фронте не блокирует тот же U на тыле (коллизии глубины по-прежнему ловятся отдельно).',
      '🧊 3D переделан: полноценный корпус шкафа — пол, крыша, 4 стойки-рельса (передняя пара синяя, задняя красная), боковые стенки, передняя и задняя двери. В overlay-хинте добавлены чекбоксы видимости: «стенки», «дверь фронт», «дверь тыл» — можно отключить, чтобы заглянуть внутрь.',
      '📐 «Уши» 19" на рековом оборудовании: в SVG front/rear виде появились узкие тёмные пластины слева/справа корпуса устройства (выступают за bodyW, высота = heightU); в 3D — две пластины между корпусом и рельсами, заподлицо с передней/задней плоскостью.',
      'Файлы: scs-config/scs-config.js (addToRack/findFirstFreeSlot/canPlace/findNearestFreeSlot + renderRack3D переписан + уши в renderUnitMap), scs-config/scs-config.css (.sc-3d-toggles).',
    ] },
    { version: '0.59.249', date: '2026-04-22', items: [
      '📋 BOM: добавлена колонка «Глуб., мм» — полезно для закупки (селекция шкафов по глубине оборудования).',
      '📄 CSV-экспорт расширен: в секции BOM — колонка depth; в секции TIA-тегов — столбцы «Сторона» (фронт/тыл) и «Глуб., мм» на каждое устройство.',
      'Файлы: scs-config/scs-config.js (computeBom + renderBom + exportBomCsv).',
    ] },
    { version: '0.59.248', date: '2026-04-22', items: [
      '🐛 Fix: 3D-вид не работал. Причина: OrbitControls.js на jsDelivr содержит bare-импорт `from \'three\'`, который браузер не резолвит без import-map. Переключились на esm.sh — он перезаписывает bare-спецификаторы на абсолютные URL. Теперь 🧊 3D грузится с первого клика.',
      'Файлы: scs-config/scs-config.js (loadThree — esm.sh вместо jsdelivr).',
    ] },
    { version: '0.59.247', date: '2026-04-22', items: [
      '🚨 Предупреждения разделены: U-конфликты и конфликты глубины — отдельными строками в блоке «Проверки». У depth-конфликта подсказка открыть 📐 Бок-вид.',
      '📊 В легенде Side-view — стат глубины: «max front: X мм · max rear: Y мм · зазор: Z мм». При отрицательном зазоре — красным.',
      '💾 Выбор вида (Фронт/Тыл/Бок/3D) persist-ится в scs-config.faceMode.v1 — сохраняется между перезагрузками страницы.',
      'Файлы: scs-config/scs-config.js (split warnings, depth-stats legend, faceMode persist).',
    ] },
    { version: '0.59.246', date: '2026-04-22', items: [
      '🧊 3D-вид (ЭТАП 2, PoC). Кнопка «🧊 3D» в переключателе вида. При первом клике лениво подгружается three.js@0.160 с jsDelivr (ESM); рендерится wireframe-корпус стойки + solid-боксы устройств (цвет из каталога, размеры = rackW × heightU*44.45мм × depthMm). Front-боксы у z=dMm/2, rear — у z=rackD − dMm/2. Рельсы — полупрозрачные плоскости (синяя/красная). Коллизии глубины — красная обводка бокса.',
      '🎮 Управление: OrbitControls — ЛКМ вращать, колесо zoom, ПКМ pan. Damping. Пол — GridHelper. При уходе с 3D — _3dCleanup (cancelAnimationFrame + renderer.dispose + forceContextLoss).',
      '📌 Это PoC: без текстур/теней/LOD. Достаточно чтобы визуально проверить расстановку и коллизии глубины. Оптимизации (InstancedMesh, raycaster-pick, glTF-экспорт) — отдельной итерацией.',
      'Файлы: scs-config/scs-config.js (loadThree + renderRack3D + диспетчер), scs-config/rack.html (.sc-fm-btn data-face="3d"), scs-config/scs-config.css (.sc-3d-hint).',
    ] },
    { version: '0.59.245', date: '2026-04-22', items: [
      '📐 Side-view + двустороннее размещение. Новый переключатель вида в карте юнитов: «🟦 Фронт | 🟥 Тыл | 📐 Бок». Front/Rear фильтруют устройства по mountSide; Side-view рисует профиль стойки сбоку с масштабированной глубиной — каждый девайс у своей рельсы (front = слева, rear = справа), ширина прямоугольника = его depthMm.',
      'Схема: в device добавлены mountSide («front»|«rear», default «front») и depthMm (override); в каталоге — depthMm на тип с разумными дефолтами (switch 280, server 1U=750/2U=800, PDU-подобное, патч-панель 100 мм и т.д.). Существующие записи мигрируются: depthMm добавляется, если typeof !== number (дефолт из каталога или 500/100 по kind).',
      '🚨 Depth-collision check: detectDepthConflicts(rack, devices) — для каждой пары front+rear с пересекающимся диапазоном U проверяет depthA+depthB+50мм (зазор) ≤ rack.depth. Коллизии подсвечиваются красным в таблице размещения и в Side-view (⚠). Результат включается в общий detectConflicts(). U-коллизии теперь тоже считаются ПО СТОРОНАМ: front не конфликтует с rear на тех же U, пока depth позволяет.',
      'Таблица «Размещение» получила 2 новых столбца: «Сторона» (dropdown Фронт/Тыл) и «Глуб., мм» (override, пусто = из каталога). В редакторе каталога — столбец «Глуб., мм».',
      'Файлы: scs-config/scs-config.js (faceMode state + renderSideView + detectDepthConflicts + catalog-migration + UI-колонки), scs-config/rack.html (вкладки .sc-fm-btn), scs-config/scs-config.css (.sc-fm-btn + .sc-sideview-svg).',
      '📌 3D-вид (ЭТАП 2) — отложен до отдельной задачи.',
    ] },
    { version: '0.59.244', date: '2026-04-22', items: [
      '📁 Project badge — сверху страницы показывается активный проект («📁 Проект: <имя>»). Если активен мини-проект (kind="sketch") — жёлтое предупреждение «🧪 Мини-проект: <имя> · выбрать полноценный →» с tooltip: «Шкафы, которые вы здесь создадите, будут видны только в этом черновике». Если проекта нет — красное «⚠ Вне проекта». Аналогично badge в главном Конструкторе (v0.59.237).',
      'Зачем: после v0.59.236 (фильтр sketches в /projects/) пользователь мог не понимать, какой проект активен, когда открывал scs-config. Теперь это видно сразу.',
      'Файлы: scs-config/index.html (#sc-project-badge), scs-config/scs-config.js (renderProjectBadge + вызов в init).',
    ] },
    { version: '0.59.207', date: '2026-04-22', items: [
      'Кнопка «🚀 Развернуть из шаблона» в реестре шкафов: разворачивается inline-форма с выбором исходного шаблона-корпуса (с подгруппами «📐 Шаблоны без тега» / «🗄 Клонировать корпус из реальной стойки»), полями тега (обязательно, с проверкой уникальности) и имени. Клонирует все корпусные параметры (u, width, depth, двери, PDU, заземление, accessories), присваивает новый inst-id и тег. Содержимое (железо внутри) — пустое, настраивается отдельно в rack.html.',
      'Это реализация workflow «один шаблон → N экземпляров»: теперь можно иметь один «Типовой 42U 600×1000 A+B PDU» и развернуть его как DH1.SR1, DH1.SR2, DH2.SR1 — три независимые стойки с одинаковым корпусом и разным содержимым.',
      'Файлы: scs-config/{index.html (+deploy-box), racks-list.js (+refreshDeployTemplates/deployFromTemplate), scs-config.css (+sc-err)}.',
    ] },
    { version: '0.59.206', date: '2026-04-22', items: [
      'Реестр шкафов проекта (scs-config/index.html) сгруппирован: «🗄 Реальные стойки» (с тегом) сверху, «📐 Черновики / шаблоны без тега» снизу с жёлтой подсветкой. Видно, что DH1.SR2 — это реальная стойка машзала, а «Новый шаблон 42U» — пустой черновик.',
      'Inline-кнопка «+ тег» рядом с каждым черновиком: клик → inline-input с placeholder «DH1.SR2», Enter/OK сохраняет в scs-config.rackTags.v1 и стойка мгновенно переезжает в группу «Реальные». Без диалоговых window.prompt — всё inline.',
      'Сводка внизу расширена: отдельные счётчики «🗄 Реальных» / «📐 Черновиков».',
      'Архитектурное разделение хранилищ (отдельный rack-config.instances.v1) — задача 1.26.2.a, запланировано следующей итерацией.',
      'Файлы: scs-config/{racks-list.js, index.html, scs-config.css}.',
    ] },
    { version: '0.59.201', date: '2026-04-22', items: [
      'TIA-606: адрес многоюнитовой железки больше не диапазон. Раньше 2U-устройство с positionU=43 показывалось как «DH1.SR1.U43-42», теперь — просто «DH1.SR1.U42» (нижняя точка крепления, монтажный референс). Высота устройства указывается отдельно в колонке размера, дублировать её в адресе смысла нет.',
      'Фикс применён в deviceTag() карты юнитов/таблицы размещения + в Реестре IT-оборудования (inventory.js — колонка «Тег» и «Местоположение»).',
      'Файлы: scs-config/{scs-config.js,inventory.js}, ROADMAP.md (п.1.24.30).',
    ] },
    { version: '0.59.195', date: '2026-04-22', items: [
      'Подфаза 1.26 — размежевание модулей. UI-рефактор без переноса файлов: scs-config/rack.html теперь «Компоновщик шкафа» (было «Конфигуратор шкафа» — конфликтовало с rack-config), inventory.html → «Реестр IT-оборудования». Breadcrumb-ссылки обновлены.',
      'Хаб: карточка «Конфигуратор СКС / телеком» разбита на четыре — «Компоновщик шкафа» (→ scs-config/), «Реестр IT-оборудования» (→ scs-config/inventory.html), плюс плейсхолдеры «Проектирование СКС» (→ scs-design/, будет) и «Реестр оборудования объекта» (→ facility-inventory/, будет). rack-config переименован в «Конфигуратор шкафа — корпус».',
      'ROADMAP.md: добавлена Подфаза 1.26 с картой 5 модулей и поглощением старой Подфазы 1.25 (межстоечный СКС) в виде «мастера меж-шкафных связей» внутри scs-design — без отдельного пункта в хабе.',
      'Файлы: hub.html, scs-config/{index.html,rack.html,inventory.html}, ROADMAP.md, js/engine/constants.js.',
    ] },
    { version: '0.59.194', date: '2026-04-22', items: [
      'Карта юнитов: wheel-зум срабатывает только при удержании Ctrl (или ⌘). Без Ctrl колесо мыши прокручивает страницу/контейнер как обычно — раньше любой скролл над картой ловился зумом и блокировал навигацию.',
      'Файлы: scs-config/scs-config.js (bindZoomPan — ранний return при !ctrlKey && !metaKey).',
    ] },
    { version: '0.1.1', date: '2026-04-22', items: ['Phase 1.24.3–1.24.4,1.24.7 — drag-n-drop в SVG-карте (pointer events, snap к целому U), dropdown PDU-feed из уникальных вводов стойки + dropdown PDU-outlet из развёрнутых rack.pdus[].outlets с дизеблингом занятых слотов. Hard-check перегруза ввода (сумма powerW vs rating·√3·230·cosφ·qty) и детекция дублирования розеток. «Готовая сборка» как шаблон: localStorage[\'scs-config.assemblyTemplates.v1\'], кнопки «💾 Сохранить как шаблон» / «↪ Применить» с клонированием id и обрезкой не помещающихся устройств.'] },
    { version: '0.1.0', date: '2026-04-22', items: ['Phase 1.24 MVP — первая рабочая версия. Выбор стойки из rack-config-шаблонов, каталог типов оборудования (коммутатор/патч-панель/сервер/KVM/монитор/ИБП-1U/органайзер/другое), размещение по U с авто-поиском свободной области и детекцией конфликтов (наезд / «занятые» юниты / границы), SVG-карта фронт-вью, предупреждения по мощности vs rack.demandKw и непривязанным к PDU устройствам, СКС-матрица (порт↔порт с типом кабеля и длиной), BOM + CSV, авто-укладка. Файлы: scs-config/* (новые).'] },
  ],
  'suppression-config': [
    { version: '0.59.189', date: '2026-04-22', items: [
      'Левый сайдбар дополнен секциями «Свойства» и «Конфигурации АГПТ» через shared/config-sidebar.js (sections=[properties,list]). Существующая форма установки остаётся, новый блок крепится сверху. В embedded-режиме не рендерится.',
      'Файлы: suppression-config/index.html (#sup-cfg-mount + mountConfigSidebar).',
    ] },
    { version: '0.59.39', date: '2026-04-21', items: ['Регрессионные тесты: обход кеша ES-модулей GitHub Pages (max-age=600). validation-tests.js теперь динамически импортирует ./index.js?v=<ts>, runAll() стала async. Это гарантирует свежий METHODS-реестр со вчерашнего фикса, даже если старый index.js лежит в HTTP-кеше браузера. Файлы: suppression-methods/validation-tests.js, suppression-config/suppression-config.js.'] },
    { version: '0.59.38', date: '2026-04-21', items: ['Fix регрессионных тестов: три кейса СП 485 Прил.Д (FM-200 30×3, 100×3, Novec 1230 30×3) падали с «Unknown method: sp-485-annex-d». Причина — suppression-methods/index.js не импортировал sp-485-annex-d.js, метода не было в реестре METHODS. Также validation-tests.js использовал ключ `Cn`, а compute() отдаёт концентрацию в поле `C`. Файлы: suppression-methods/{index.js,validation-tests.js}.'] },
    { version: '0.59.37', date: '2026-04-21', items: ['Phase 11.9 — регрессионные тесты. Кнопка «✓ Тесты» в тулбаре установки открывает диалог с таблицей pass/fail по 6 опорным кейсам (СП 485 Прил.Д: FM-200 30×3 и 100×3, Novec 1230 30×3; NFPA 2001 FM-200 50 м³; ISO 14520 FM-200 100 м³; СП РК IG-541 100 м³). Ожидания выведены аналитически из формул методик, допуск ±5–10 %. Ловит грубые регрессии в Ks/K1/Kalt/s(T). Файлы: suppression-methods/validation-tests.js (новый), suppression-config/{index.html,suppression-config.js,suppression-config.css}.'] },
    { version: '0.59.36', date: '2026-04-21', items: ['Phase 11.8 — мост MDC→АГПТ. В mdc-config кнопка «🔥 → АГПТ» пишет геометрию IT- и силовых модулей ЦОД в localStorage (`raschet.mdcToSuppression.v1`). suppression-config на init видит свежую запись (< 24 ч), показывает confirm и создаёт установку с двумя направлениями («IT-модули» / «Силовые модули»), где зона = модуль GDM-600 (S=widthMm·lengthMm, H=2.7 м фикс). Норматив SP485, ГОТВ HFC-227ea по умолчанию — меняется в «Параметры установки». Файлы: mdc-config/{mdc-config.js,index.html}, suppression-config/suppression-config.js (+maybeImportFromMdc).'] },
    { version: '0.59.35', date: '2026-04-21', items: ['Печать спецификации: правило @media print раньше скрывало всё, кроме #dlg-report — клик «Печать» в диалоге спецификации давал пустую страницу. Теперь в print-режиме виден любой открытый dialog[open] (отчёт или спецификация), разрешён перенос длинных таблиц. CSV-экспорт спецификации сохраняет заголовки разделов (Оборудование / Насадки / Трубы / Опоры) между блоками строк — плоский список терял привязку позиций к группе.'] },
    { version: '0.59.34', date: '2026-04-21', items: ['Отчёт: «Подготовил» автозаполняется из window.Auth (name/email). Спецификация двухуровневая: по каждой системе (в своём разделе отчёта) + общая сводная «ПО УСТАНОВКЕ» в конце — модули ГОТВ с разбивкой по направлениям, трубопровод по D×s (м + ИТОГО), насадки по кодам, опоры.'] },
    { version: '0.59.33', date: '2026-04-21', items: ['Простой поворот вниз (−Y) на колене теперь разрешён для halocarbon / CO₂ — это штатный спуск к насадку. Запрет −Y сохраняется только для T-фитинга на горизонтальной магистрали (асимметричный сток жидкая/вапор).'] },
    { version: '0.59.32', date: '2026-04-21', items: ['Округление в отчёте (L,dH → 0.01 м; площадь → мм² int; P → 0.01 МПа; G → 0.1 кг), fix float-артефактов. Помощь: термины «зона/направление/установка». Авто-DN per-zone в модульном режиме. Method-change prompt с коэффициентами и специфическими терминами для каждой нормы. Единая нумерация Raschet для всех модулей восстановлена; хедер и футер зафиксированы (position:fixed) — не скроллятся; версия и «Журнал изменений» теперь только в футере.'] },
    { version: '0.59.31', date: '2026-04-21', items: ['Toolbar 3D: кнопки «Крепления» (скрыть/показать опоры) и «Размеры» (выносные размерные линии по ISO 129-1 с засечками 45° и подписью в мм). Подключение баллонов к root-узлу (коллектор/РВД). Смягчено правило плоскостей: простой поворот вверх после горизонтального участка разрешён. Независимая версия модуля в футере.'] },
    { version: '0.59.30', date: '2026-04-21', items: ['Типовые T от стояка (прямой стояк ИЛИ горизонтальный T в одной оси); warning для асимметричного T (>50% в боковой); fix копирования зоны — в то же направление.'] },
    { version: '0.59.29', date: '2026-04-21', items: ['k1 утечек тоже по выбранной норме (СП 485 — 1.05, ISO/NFPA — 1.00); tooltip сводки показывает активные коэффициенты.'] },
    { version: '0.59.28', date: '2026-04-21', items: ['Единая методика по всем узлам (k безопасности зависит от нормы); сайдбар 3D-диалога 260→360 px, убран горизонтальный скролл.'] },
    { version: '0.59.27', date: '2026-04-21', items: ['Правило «одна плоскость на узел» смягчено: при вертикальном входящем — любые горизонтальные отводы допустимы; запрет только при горизонтальном входящем.'] },
    { version: '0.59.26', date: '2026-04-21', items: ['Fix авто-DN для halocarbon: расчёт по жидкой фазе (ρ=1200, v=12) — магистраль 8.8 кг/с даёт DN25 как в эталоне (было DN65 из-за плотности пара).'] },
    { version: '0.59.25', date: '2026-04-21', items: ['Узлы ≠ скользящие опоры: узел — кружок, скользящая — треугольник ∇ на подошве, жёсткая — квадрат с крестом.'] },
    { version: '0.59.24', date: '2026-04-21', items: ['Справка (ⓘ) расширена: явно описаны все автоматические правила — топология, авто-DN, опоры, насадки, баллон, Cн.'] },
    { version: '0.59.23', date: '2026-04-21', items: ['Промежуточные скользящие опоры на длинных прямых (гарантированный шаг ≤ supportStep(DN)).'] },
    { version: '0.59.22', date: '2026-04-21', items: ['Убран селектор DN в диалоге участка (диаметр авто); алгоритм сверен с эталонным расчётом 82.5 кг халокарбон — разбивка 22×3.5 / 28×4 / 34×3.5 совпадает.'] },
    { version: '0.59.21', date: '2026-04-21', items: ['Сн нормируется автоматически по ГОТВ+классу пожара (readonly); П и Pпр — dropdown с описаниями конструкций ограждений.'] },
    { version: '0.59.20', date: '2026-04-21', items: ['Копирование направления/зоны со схемой; общая аксонометрия зависит от типа системы; авто-DN коллектора; авто-подбор типоразмера баллона; авто-заполнение полей из активного проекта.'] },
    { version: '0.59.19', date: '2026-04-21', items: ['Реалистичные v_target для авто-DN (halocarbon 50, inert 70, CO₂ 35 м/с) — диаметры уменьшились; отчёт: таблица и формулы выровнены.'] },
    { version: '0.59.18', date: '2026-04-21', items: ['Шаг длины участка 0,05 м (ввод + drag-resize снапятся к сетке); насадок нельзя установить в узле со стыком/отводом.'] },
    { version: '0.59.17', date: '2026-04-21', items: ['Запрет крестовых соединений (в узле максимум 3 трубы = T-фитинг); warnings для старых крестовин.'] },
    { version: '0.59.16', date: '2026-04-21', items: ['Авто-подбор DN на каждое изменение (фаза агента + v_max + P_мин + монотонность); размер насадка по DN трубы и типу; авто-расстановка опор (жёсткие/скользящие) + BOM-раздел «Опоры».'] },
    { version: '0.59.15', date: '2026-04-21', items: ['Запрет от узла с насадком и смешения плоскостей; типовые обозначения насадков (R-360/R-180/радиальный); манифольд при N>1 баллоне; номера узлов N0… на 3D-схеме.'] },
    { version: '0.59.14', date: '2026-04-21', items: ['Кнопки X±/Y±/Z± блокируются для занятых направлений от выбранного узла; предупреждение о Т-отводе вниз для жидкой фазы (halocarbon).'] },
    { version: '0.59.13', date: '2026-04-21', items: ['Кнопки X±/Y±/Z± в цвет опорных осей.'] },
    { version: '0.59.12', date: '2026-04-21', items: ['Клик по трубе / drag узла меняет длину; вращение орбитит вокруг выбранного узла; метки осей крупнее.'] },
    { version: '0.59.10', date: '2026-04-21', items: ['Спецификация: одинаковая ширина столбцов; fix «undefined»; запрет построения в занятом направлении; L ≥ 10·DN между фитингами.'] },
    { version: '0.59.9', date: '2026-04-21', items: ['Инлайн-редактирование участков (L/DN/насадок) и удаление любого участка с ответвлениями.'] },
    { version: '0.59.8', date: '2026-04-21', items: ['title-подсказки ко всем полям и кнопкам (направление, зона, 3D, объект, toolbar).'] },
    { version: '0.59.7', date: '2026-04-21', items: ['module-footer во всех модулях Raschet.'] },
    {
      version: '0.59.6', date: '2026-04-21',
      items: [
        '3D-схема: свободное вращение, масштаб, Shift+панорама, фиксированные ракурсы.',
        'Редактирование трубопровода от узла (X±/Y±/Z±).',
        'Авто-подбор DN по потоку по веткам.',
        'Спецификация BOM (модули/насадки/трубы) + CSV/печать.',
        'Справка модуля и журнал изменений в футере.',
      ],
    },
    { version: '0.59.5', date: '2026-04-21', items: ['Нейтральный каталог модулей (halocarbon 42/65, inert 200/300, CO₂ HP/LP).'] },
    { version: '0.59.4', date: '2026-04-21', items: ['Отчёт адаптируется к выбранной методике; убрано упоминание сторонних программ; добавлены строки «Заказчик» / «Направление».'] },
    { version: '0.59.3', date: '2026-04-21', items: ['Расчёт по каждой зоне отдельно с суммированием mp/mg/mtr/n. N_факт из сборок с подсветкой нехватки.'] },
    { version: '0.59.2', date: '2026-04-21', items: ['UI в стиле Raschet (карточки + левый навигатор + правая сводка); гидравлика Darcy-Weisbach.'] },
    { version: '0.59.1', date: '2026-04-21', items: ['Иерархия Установка → Направления → Зоны; сборка модулей; аксонометрия.'] },
    { version: '0.59.0', date: '2026-04-20', items: ['Первая версия: расчёт mГОТВ по СП 485.1311500.2020 Прил. Д; приложение Ж (Fc).'] },
  ],

  'rack-config': [
    { version: '0.59.279', date: '2026-04-22', items: [
      '🧹 Убрано дублирование имени: поле «Название шаблона» в разделе «Идентификация» удалено — имя редактируется кнопкой «✎ переименовать» в тулбаре рядом с выпадающим списком шаблонов (в нём и так видно имя). Фактическое хранилище имени не изменилось (rc-name теперь hidden-input для совместимости).',
      '🔒 Удаление шаблона заблокировано, если на него ссылается хотя бы одна развёрнутая стойка (любой проект, по полю sourceTemplateId). Кнопка «✕ удалить» disabled + tooltip со счётчиком использований. Рядом с тулбаром показывается бейдж «· используется в N стойках» (оранжевый) или «· не используется» (серый).',
      'В выпадающем списке шаблонов к имени дописывается «· исп. N» у используемых шаблонов, чтобы сразу видеть в списке, что трогать опасно.',
      'Файлы: rack-config/index.html (hidden rc-name + новая кнопка rc-rename + span#rc-usage), rack-config/rack-config.js (countInstancesUsingTemplate, renderTemplateList usage-annotation + disable delete, deleteTemplate guard, renameTemplate + bind).',
    ] },
    { version: '0.59.265', date: '2026-04-22', items: [
      '🔢 Мини-карта юнитов теперь учитывает направление U-нумерации (`bu` снизу / `td` сверху), выбранное в scs-config — используется общий LS-ключ `scs-config.uNumDir.v1`. Единый стиль между шаблоном стойки (rack-config) и размещением в ней (scs-config).',
      'Файлы: rack-config/rack-config.js (renderUnitMapPreview: чтение uNumDir из LS + uLabel = totalU − r.u + 1 для td).',
    ] },
    { version: '0.59.260', date: '2026-04-22', items: [
      '🔧 fix: поле с меткой «=auto» больше НЕ readOnly. Пользователь может редактировать ЛЮБОЕ из 3 полей (отступ фасада / глубина рельс / отступ тыла); LRU делает редактируемое поле manual, а auto переходит на самое давнее. Визуально auto выделен зелёным фоном + title-подсказкой.',
      '📐 Мини-карта юнитов: U-номера с двух сторон стойки, вертикальные 0U-PDU раскладываются по вводу (A/C слева, B/D справа) вместо чередования.',
      'Файлы: rack-config/rack-config.js (renderRailFields без readOnly, renderUnitMap leftVert/rightVert по feed).',
    ] },
    { version: '0.59.245', date: '2026-04-22', items: [
      '📚 Левый сайдбар со списком сохранённых типов стоек — в standalone-режиме. Показывает все конфигурации из глобального каталога (rack-config.templates.v1) и из всех проектных неймспейсов (raschet.project.<pid>.rack-config.templates.v1, включая sketch-мини-проекты). Клик по строке — загружает шаблон в форму (клонируется, id пересоздаётся, так что сохранение в LS происходит только явной кнопкой «💾 Сохранить шаблон»).',
      'В каждой строке — название, U, производитель и цветной чип-источник: 🌐 global (глобальный каталог) / 🏢 project-name (полноценный проект) / 🧪 project-name (мини-проект).',
      'Поиск по имени / производителю / U / имени проекта. Авто-обновление при внешних изменениях LS (событие storage и rack-config:templates-changed).',
      'Детект standalone: нет ?nodeId=, нет ?embedded=1 / ?mode=embedded, нет window.name=raschet-embed, document.referrer не из /scs-config|scs-design|pdu-config|mdc-config/. В embedded-режиме / при открытии из узла схемы сайдбар не монтируется. Верхний dropdown «Шаблон» оставлен (backward-compat).',
      'Ширина сайдбара изменяется через общий shared/sidebar-resizer.js (--rs-sidebar-left-w). Grid формы переключается с 2 на 3 колонки через body.rc-has-left-sidebar.',
      'Публичный API window.__rackConfig.loadExternalTemplate(t) — используется сайдбаром, доступен и другим внешним потребителям. Событие rack-config:ready сигналит о готовности формы.',
      'Файлы: rack-config/rack-sidebar.js (новый, ~180 строк), rack-config/index.html (+<aside id="rc-sidebar-left"> и init-скрипт), rack-config/rack-config.css (body.rc-has-left-sidebar → 3 колонки), rack-config/rack-config.js (window.__rackConfig.loadExternalTemplate + dispatch rack-config:ready в init()).',
    ] },
    { version: '0.59.208', date: '2026-04-22', items: [
      'Dropdown «Шаблон» теперь с optgroup-разделением: «📐 Шаблоны корпуса (без тега)» vs «🗄 Реальные стойки — редактируются в scs-config» (с префиксом тега). Визуально видно, что `DH1.SR2` — это реальная развёрнутая стойка, а не шаблон.',
      'При выборе реальной стойки под тулбаром появляется жёлтый баннер-предупреждение: корпус уже привязан к содержимому в машзале, правки лучше делать через scs-config или разворачивать новый шаблон.',
      'Hub: бейджи модулей «Компоновщик шкафа» и «Проектирование СКС» переведены с «В разработке / Планируется» на «Активный». Описание scs-design обновлено под реальную фичу-матрицу (план зала, авто-длины, кабельный журнал).',
      'Файлы: rack-config/{rack-config.js, index.html}, hub.html.',
    ] },
    { version: '0.59.139', date: '2026-04-21', items: [
      'Матрёшка PDU-модалок добита окончательно. Источник был не в баннере, а в детальной карточке PDU: кнопка «Открыть Конфигуратор стойки →» делала <code>location.href = "../rack-config/"</code>, что в embed-режиме перегружало САМ iframe на rack-config, после чего пользователь мог открыть внутри этого вложенного rack-config ещё один PDU-визард. Теперь в embed-режиме эта кнопка вовсе не рисуется; вне embed — навигация идёт через <code>top.location</code>, а не через iframe. Для надёжности добавлено CSS-правило <code>body.pc-embed .pc-banner { display: none !important }</code> и ранняя установка <code>html.pc-embed-html/body.pc-embed</code> при старте, до первого рендера. Файлы: pdu-config/pdu-config.js (openDetail, IS_EMBED-блок), pdu-config/pdu-config.css.',
      'Список подходящих PDU в embed-режиме теперь скроллится сам, без скролла всего iframe-окна: добавлены flex-layout правила для <code>body.pc-embed .pc-wrap/.pc-grid/section/#pc-results</code>, а левая панель скроллится отдельно. Файл: pdu-config/pdu-config.css.'
    ] },
    { version: '0.59.138', date: '2026-04-21', items: [
      'Расширен каталог PDU (shared/catalogs/pdus.js): добавлены все типоразмеры Rittal PSM 1U (DK 7856.008/200/201/202/203/250) и PSM ZeroU — Basic (DK 7955.100/110/120/130/140), Metered (7955.300/310/320/330), Switched (7955.400/410/420/430), Monitored+Switched (7955.500/510/520/530). Также добавлен отечественный производитель <b>ЦМО</b>: 1U-блоки R-16-2P-F / 6P-F / 8S-F / 9C13-F / 6C13-3C19-F и R-32-12C13-F / 8C13-4C19-F; вертикальные PV-16A-6S / 8C13 / 24C13, PV-32A-18C13-6C19, PV-32A-24C13-6C19; управляемые R-MM/R-MS и PV-MM/MS/MB/MH — 24×C13 + 6×C19, 3ф 32А.',
      'В фильтре производителей Конфигуратора PDU ЦМО появляется автоматически (список строится динамически).'
    ] },
    { version: '0.59.137', date: '2026-04-21', items: [
      'Фикс рекурсии модалок: в embed-режиме pdu-config больше не показывает баннер «Открыть стойку →» (раньше клик по нему перегружал iframe в rack-config, внутри которого пользователь мог открыть ещё один PDU-визард и получить матрёшку из модалок). Также у ссылки проставлен target="_top" как страховка. Файл: pdu-config/pdu-config.js (renderPendingBanner).'
    ] },
    { version: '0.59.136', date: '2026-04-21', items: [
      'Кнопка помощи «?» остаётся доступна и при открытой PDU-модалке: поднимается над ней (z-index 9990 → 10060) и сдвигается вверх на 92 px, чтобы не перекрывать нижние кнопки iframe «Применить/Закрыть». При закрытии модалки возвращается на прежнее место. Файл: rack-config/rack-config.js (openPduWizardModal).'
    ] },
    { version: '0.59.134', date: '2026-04-21', items: [
      '<b>Охлаждение серверных шкафов — новая логика.</b> Убрано ошибочное «при ≥5 кВт рекомендуется крыша с вентиляторными модулями». Для серверных нагрузок ≥5 кВт рабочая практика обратная: шкаф должен быть максимально герметичен (cold/hot aisle containment), перфорируются только передняя и задняя двери, а крыша/пол/боковые стенки — глухие. Новый warn показывает конкретные «щели» в корпусе (вентиляторная крыша, отсутствующие стенки, перфорированный пол) и просит их закрыть. Файлы: rack-config/rack-config.js (проверки), rack-config/index.html (блок «Охлаждение» в справке).',
      'Поднят z-index pc-embed-bar внутри iframe Конфигуратора PDU (9600 → 10050) — нижние кнопки «Применить требования / Закрыть» больше не перекрываются футером.'
    ] },
    { version: '0.59.133', date: '2026-04-21', items: [
      'Убрана серая полоса над хедером во всех модулях: <code>body { margin: 0 }</code> добавлено в shared/app-header.css (дефолтный margin:8px браузера был виден над sticky-хедером).'
    ] },
    { version: '0.59.132', date: '2026-04-21', items: [
      '<b>Справка приведена в соответствие с текущим UI.</b> Раздел «PDU» в справке переписан под новую модель: в строке PDU — только поле «Ввод», всё остальное (кол-во / номинал / фазы / высота / розетки / SKU) задаётся в Конфигураторе PDU (🧙). Добавлено описание двух путей (🧙 Конфигуратор PDU / 📋 Каталог PDU), зелёной/жёлтой карточки под каждой строкой и dropdown стандартных типов розеток в конфигураторе. Файл: rack-config/index.html (блок mountHelp usage).'
    ] },
    { version: '0.59.131', date: '2026-04-21', items: [
      '<b>PDU-модалка поверх хедера и футера.</b> z-index поднят 9500 → 10001 (выше фиксированного футера 9989 и кнопки помощи 9990). Файл: rack-config/rack-config.css.',
      '<b>Двойной футер в PDU-модалке убран.</b> В embed-режиме (<code>?embed=1</code>) pdu-config больше не монтирует свой футер — родительский rack-config отображает единый. Файл: pdu-config/index.html.'
    ] },
    { version: '0.59.130', date: '2026-04-21', items: [
      'Кнопка помощи «?» поднята на 44 px от низа — больше не перекрывает фиксированный футер (32 px). Файл: shared/help-panel.js.'
    ] },
    { version: '0.59.129', date: '2026-04-21', items: [
      '<b>Фикс метки автомата в петле фаза-ноль.</b> Если номинал > 125 А, а характеристика осталась по умолчанию «MCB_C» — авто-переключение в «MCCB» (до 1600 А) или «ACB» (выше). Больше не будет бессмысленной строки вида «MCB_C 400А × 10» (MCB по IEC 60898 не существует в этом диапазоне). Файл: shared/calc-modules/phase-loop.js.',
      '<b>Футер выровнен по правому краю.</b> Версия Raschet и ссылка «Журнал изменений» прижаты к правому краю экрана во всех модулях. Файл: shared/module-footer.js.'
    ] },
    { version: '0.59.128', date: '2026-04-21', items: [
      '<b>Фикс футера (любой ценой).</b> Реальная причина «[footer] Unexpected identifier ы» найдена и устранена: в shared/module-changelogs.js в одной из записей psychrometrics был неэкранированный апостроф внутри кириллического слова (<code>inline-select\'ы</code>), который ломал парсер JS при загрузке всего файла — и, как следствие, mountFooter() падал во всех модулях. Заменено на <code>inline-select (для type/fromIdx/toIdx)</code>.',
      '<b>Минималистичный футер.</b> shared/module-footer.js теперь рендерит только версию Raschet и ссылку «Журнал изменений» по центру. Убраны ссылки «Все программы · Каталог · GitHub» (дублировали главное меню).',
      '<b>Строка PDU упрощена.</b> В блоке PDU стойки осталось только поле «Ввод» и две кнопки (🧙 Конфигуратор PDU / 📋 Каталог PDU). Все остальные параметры (кол-во, номинал, фазы, высота, типы розеток) задаются только в Конфигураторе PDU. Под строкой — карточка с текущими требованиями или SKU, если модель выбрана.',
      'Файлы: shared/module-changelogs.js (реальный фикс апострофа), shared/module-footer.js (упрощён), rack-config/rack-config.js (renderPduList → минимальная строка, renderPduReqsBlock расширен), pdu-config/pdu-config.js (возвращён dropdown стандартных типов розеток + «свой…»), js/engine/constants.js (0.59.128).'
    ] },
    { version: '0.59.127', date: '2026-04-21', items: [
      'Round-trip нестандартных типов розеток. Dropdown типов в строке PDU расширен (добавлены C15, C21, NEMA 5-20, NEMA L5-30), и при рендере подставляет любой тип, который уже есть в данных (например, пришёл из Конфигуратора PDU через postMessage) — даже если он не из предопределённого списка. Теперь кастомные типы не теряются при render→apply→render.',
      'Файл: rack-config/rack-config.js (renderPduList, outlets select).'
    ] },
    { version: '0.59.126', date: '2026-04-21', items: [
      '<b>Кнопка «🧙 Конфигуратор PDU →» в блоке PDU.</b> Открывает полноценный Конфигуратор PDU во встроенной модалке-iframe поверх стойки. Там задаются контекст (серверы/кВт/резерв), требования и ранжируются рекомендации. По кнопке «Выбрать» (конкретный артикул) или «⬇ Применить требования» (лист требований без SKU) результат через postMessage возвращается в конкретную строку PDU стойки — номинал, фазы, высота, розетки подставляются, SKU прописывается в спецификацию (либо блок требований — если артикул не выбран).',
      '<b>Блок требований под каждой строкой PDU.</b> Зелёная карточка с артикулом, если модель выбрана; жёлтая — если задан только лист требований (с контекстом: сколько серверов × кВт, cos φ, резерв).',
      'Каталог PDU остался как быстрый путь, но теперь это вторая кнопка (📋 Каталог PDU) рядом с wizard-кнопкой.',
      'Файлы: rack-config/rack-config.js (+openPduWizardModal, +applyPduPayload, +renderPduReqsBlock; renderPduList), rack-config/rack-config.css (+.rc-pdu-wizard-modal, +.rc-pdu-req-*), pdu-config/pdu-config.js (IS_EMBED, postToParent, injectEmbedBar, pickModel/saveLastPduRequirementsOnly → postMessage), pdu-config/pdu-config.css (+.pc-embed-bar).'
    ] },
    { version: '0.59.125', date: '2026-04-21', items: [
      'Убраны ложные warnings «Двустворчатая дверь на стойке 600 мм — нетипично». В нашей типовой конфигурации все стойки 600 мм идут с двустворчатой задней дверью — это штатный вариант, не проблема. Правило удалено из rc-validate().',
      'Файл: rack-config/rack-config.js (validateTemplate, секция 1).'
    ] },
    { version: '0.59.122', date: '2026-04-21', items: [
      '<b>Fix: главная страница зависала на «Загрузка…».</b> GitHub Pages через Jekyll игнорирует файлы с префиксом <code>_</code> → <code>shared/catalogs/_helpers.js</code> отдавался как 404, цепочка импортов <code>rack-catalog-data.js</code> ломалась, main.js не инициализировался. Добавлен <code>.nojekyll</code> в корень репо — GitHub Pages теперь отдаёт файлы как есть, без Jekyll-препроцессинга.',
      'Параллельно: ссылка «Каталог ↗» в PDU-пикере использует корректный параметр <code>?filterKind=pdu</code> вместо <code>?kind=pdu</code> (catalog.js читает именно filterKind).',
      'Файлы: .nojekyll (новый), shared/pdu-picker-modal.js (resolvedCatalogHref).'
    ] },
    { version: '0.59.121', date: '2026-04-21', items: [
      '<b>PDU picker: draggable + фикс. размер + структурированный фильтр + экшены.</b> shared/pdu-picker-modal.js переписан:',
      '— <b>Перемещаемая</b> мышью за шапку (mousedown на .pdm-head), backdrop закрывает по mousedown вне панели.',
      '— <b>Фиксированный размер</b> 1240×820 (min с vw/vh) — не прыгает при сокращении списка.',
      '— <b>Структурированный фильтр</b>: две колонки .pdm-fgroup с заголовками (Монтаж / Электрика / Розетки), легенда с разбивкой Score.',
      '— <b>Новые действия в футере</b>: «⬇ Перенести требования» (сохраняет только требования без SKU — флаг <code>requirementsOnly:true</code>), «🖨 Распечатать» (лист-требования в новом окне), «Каталог ↗» (ссылка в /catalog/?kind=pdu).',
      '— Rack-config понимает <code>requirementsOnly</code>: кнопка «⬇ Требования из Конфигуратора PDU» применяет rating/phases/height/outlets, не трогая pdu.sku.',
      'Каталоги seed собраны в отдельную папку <code>shared/catalogs/</code>: racks.js, pdus.js, rack-accessories.js, breakers.js, ups-kehua-mr33.js, battery-kehua-s3.js, _helpers.js — с README. Старые пути работают через barrel-реэкспорты.',
      'Файлы: shared/pdu-picker-modal.js (~370 строк), rack-config/rack-config.js (lastPdu: приём requirementsOnly), js/engine/constants.js (0.59.121).'
    ] },
    { version: '0.59.120', date: '2026-04-21', items: [
      '<b>Разделение seed-каталогов по типам.</b> Монолит shared/rack-catalog-data.js (493 строки, kit+pdu+acc вперемешку) разнесён на три файла — по одному на kind, плюс внутренние хелперы:',
      '— <code>shared/racks-catalog-data.js</code> — базовые комплекты стоек (KIT_CATALOG, DOOR/TOP/BASE/ENTRY/LOCK/BLANK label-таблицы, listBuiltinRacks, getLiveKitCatalog, kitById)',
      '— <code>shared/pdus-catalog-data.js</code> — PDU (PDU_CATEGORY, PDU_CATALOG, listBuiltinPdus, getLivePduCatalog, pduBySku)',
      '— <code>shared/rack-accessories-catalog-data.js</code> — аксессуары (ACC_CATEGORIES, ACCESSORY_CATALOG, listBuiltinRackAccessories, getLiveAccessoryCatalog, accBySku, accessoryMatchesRackMfg, accessoryMfgList)',
      '— <code>shared/_catalog-helpers.js</code> — общие _syncList / _slug / _ensureLib (чтобы override-слой element-library работал одинаково во всех трёх)',
      'Старый shared/rack-catalog-data.js превращён в barrel (re-export) — все существующие импорты (rack-config, pdu-config, catalog-bridge, bom.js) продолжают работать без правок. Добавлять новые модели можно теперь в профильный файл, не задевая соседей.'
    ] },
    { version: '0.59.119', date: '2026-04-21', items: [
      'Интеграция со standalone /pdu-config/: если в Конфигураторе PDU нажата кнопка «⬆ Выбрать эту модель» (в детальной карточке), сохраняется <code>raschet.lastPduConfig.v1</code>. В модалке «Каталог PDU» появляется синяя кнопка «⬇ Из Конфигуратора PDU: &lt;производитель&gt; &lt;модель&gt;» — один клик подставляет PDU в текущий ввод (со всеми параметрами: sku, rating, phases, height, outlets), учитывает галочку «Парой на A+B» и цвета корпусов A/B. Кнопка видна только если запись свежая (< 24 ч).',
      'Файл: rack-config/rack-config.js (openPduCatalogModal: чтение lastPduConfig.v1, lastPduBtn в extraFooter, apply-last handler в onExtraMount).'
    ] },
    { version: '0.59.118', date: '2026-04-21', items: [
      'Каталог базовых комплектов стоек: добавлена колонка <b>Score 0–100</b> и сортировка по убыванию — сразу видно, какой kit лучше совпадает с уже заданными параметрами. Распределение баллов: U (25: exact / 15 при ±3U), ширина (20 exact), глубина (15 exact / 8 при ±200 мм), двери перед+зад (по 10), стенки/крыша/пол (по 5), совпадение производителя по substring (5). Значение «— не важно —» у пользователя даёт полный балл (не штрафует).',
      'Файл: rack-config/rack-config.js (openKitCatalogModal: scoreKit + rows.sort + колонка «Score»).'
    ] },
    { version: '0.59.117', date: '2026-04-21', items: [
      'Интеграция конфигуратора PDU: старый inline-модал выбора PDU заменён на общий движок из /pdu-config/. Теперь в модалке:',
      '— <b>Score-ранжирование 0–100</b>: покрытие розеток (50), близость номинала (20), минимум перерасхода (15), точность по категории/высоте (10). Строки отсортированы от лучшего к худшему.',
      '— <b>Требования «≥»</b>: номинал ≥ A, C13 ≥, C19 ≥, Schuko ≥. Модели с неполным покрытием розеток скрыты.',
      '— <b>Чипсы производителей</b>: клик для переключения on/off, работает как OR-фильтр.',
      '— Предзаполнение из текущих параметров PDU (фазы/номинал/высота/розетки/категория/цвет/пара).',
      '— Подвал с опциями «Парой на A+B» и «Цвет A/B» (rack-config-специфичные) — оставлены как extraFooter.',
      'Заодно починен баг фильтра по высоте в standalone /pdu-config/: раньше сравнивалось значение option=«0U» с числом kp.height=0, ничего не совпадало — теперь option value=«0/1/2» + String(kp.height)===String(state.height).',
      'Новый модуль shared/pdu-picker-modal.js — переиспользуется из любого модуля (в будущем mv-config/mdc-config тоже могут подключить).',
      'Файлы: shared/pdu-picker-modal.js (новый), rack-config/rack-config.js (openPduCatalogModal: 135 строк inline-модала удалены, замена на тонкий враппер с extraFooter), pdu-config/pdu-config.js (фикс сравнения height), pdu-config/index.html (option value «0U»→«0»).'
    ] },
    { version: '0.59.116', date: '2026-04-21', items: [
      'Перестановка: «Каталог базовых комплектов» (стойка) перенесён ниже — после Корпуса/Дверей/Стенок/Кабельных вводов. Логика: пользователь сначала задаёт параметры, потом подбирает готовый SKU по ним (фильтр модалки уже предзаполнен этими параметрами с v0.59.110).',
      'PDU: блок «Каталог PDU» перенесён в нижнюю часть каждой PDU-карточки, после Ввода/Кол-ва/Номинала/Фаз/Высоты/Розеток. Тот же принцип — сначала параметры, потом подбор артикула под них.',
      'Заголовок поменялся с «Каталог PDU» на «Каталог PDU (подобрать по параметрам)» — явный намёк, что фильтр работает по уже заданным полям.',
      'Файлы: rack-config/index.html (перенос section «Базовый комплект»), rack-config/rack-config.js (renderPduList: rc-pdu-catalog теперь после rc-pdu-outlets).'
    ] },
    { version: '0.59.115', date: '2026-04-21', items: [
      'Панель предупреждений: сортировка по строгости (err → warn → ok) и шапка со счётчиками «⛔ ошибок: N · ⚠ предупреждений: M · ✓ ок: K». Пустой список даёт явное «Нарушений и предупреждений не найдено» вместо пустоты.',
      'Файл: rack-config/rack-config.js (renderWarnings).'
    ] },
    { version: '0.59.114', date: '2026-04-21', items: [
      'Две новые проверки совместимости: 7a) замок отмечен, но обе двери = «без двери» — err (некуда крепить); 7b) больше двух вертикальных (0U) PDU на один ввод — warn (в стойке только две боковые монтажные шины).',
      'Файл: rack-config/rack-config.js (computeWarnings: +7a/7b).'
    ] },
    { version: '0.59.113', date: '2026-04-21', items: [
      'Проверка совместимости выбранных деталей и аксессуаров (computeWarnings, 7 новых правил):',
      '1) Двустворчатые двери (double-*) на стойке <800 мм — warn (обычно только от 800 мм).',
      '2) Физическая вместимость: occupiedU + горизонтальные PDU (height>0) ≤ корпус U. Превышение = err, остаток <2U = warn «почти полностью».',
      '3) Электрозамок (lock=electro) — warn про отдельный слаботочный кабель питания 12/24В от СКУД и согласование протокола (Wiegand/OSDP).',
      '4) Kit-конфликт: если kit.includes содержит параметр, но t.<key> ≠ kit.preset.<key> — warn («в стойке будет preset, выбранное игнорируется в BOM»).',
      '5) Ролики (base=casters) + demandKw ≥ 10 кВт — warn (ролики только для перемещения при монтаже, для стационара — ножки/цоколь).',
      '6) Цоколь + кабельные вводы снизу — warn (нужен цоколь с вырезами, обычно отд. артикул, напр. Rittal 8601.035 / APC AR7570).',
      '7) Аксессуары от «чужого» производителя (accessoryMatchesRackMfg=false) — warn со списком первых 3 SKU и напоминанием про совместимость крепежа.',
      'Файл: rack-config/rack-config.js (computeWarnings: +7 блоков после «Стенки»).'
    ] },
    { version: '0.59.112', date: '2026-04-21', items: [
      'Каталог PDU: в модалке добавлены «Парой на A+B» (чекбокс) и поля «Цвет A» / «Цвет B». По умолчанию чекбокс включён для режимов 2N и N+1, если на парном вводе ещё нет PDU — после выбора SKU создаётся твин на противоположном вводе с тем же номиналом/розетками/высотой. Цвет корпуса отдельно на A и B (часто серый на основном вводе, чёрный/красный на резервном) попадает в BOM и лист требований для PDU без SKU.',
      'Ширина стойки: добавлен вариант 750 мм (есть у APC NetShelter SX) и «— не важно —» для сценариев «выбор по другим критериям». Для глубины — тоже «— не важно —».',
      'Секции «Двери», «Боковые стенки/крыша/пол», «Кабельные вводы», «Замок»: к каждому селекту добавлен пункт «— не важно —» (value="any"). BOM автоматически пропускает позицию, если значение = any (в LABEL-словарях его нет). Предупреждения об охлаждении ≥3 кВт и ≥5 кВт не срабатывают, если соответствующий параметр = any — не считаем неизвестный параметр нарушением.',
      'Файлы: rack-config/rack-config.js (openPduCatalogModal: pair/color state+UI+pick+twin; computeBom: colorNote; buildPduRequirements: «Цвет корпуса»; computeWarnings: any-guard для doorFront/doorRear/top), rack-config/index.html (rc-width +750/any, rc-depth +any, rc-door-front/rear/lock/sides/top/base/entry-type +any).'
    ] },
    { version: '0.59.110', date: '2026-04-21', items: [
      'Каталог базовых комплектов стоек: параметры, уже заданные пользователем (U / ширина / глубина), предзаполняют фильтры модалки. Добавлены колонки фильтров «Ширина, мм» и «Глубина, мм» — раньше была только U. Пользователь видит сразу только совместимые модели и может ослабить фильтр при необходимости.',
      'Каталог PDU: предзаполнение фильтров по текущим значениям PDU-строки — фазы, категория, номинал (A), высота (U). Добавлены селекторы «Номинал, A» и «Высота» — раньше были только фазы/категория/производитель. Например, для уже указанного 3ф PDU на 32 A каталог откроется на соответствующих моделях.',
      'Файлы: rack-config/rack-config.js (openKitCatalogModal + openPduCatalogModal: state init + UI grid + wires).'
    ] },
    { version: '0.59.108', date: '2026-04-21', items: [
      'ОК-сообщения о покрытии нагрузки показывают процент запаса: «2N: минимум 21.95 кВт, запас +10%» / «N+1: остаётся 30 кВт, запас +50%» / «none: сумма 25 кВт, запас +25%». Видно насколько тесно уложились в расчёт.',
      'Файл: rack-config/rack-config.js (три ok-push).'
    ] },
    { version: '0.59.107', date: '2026-04-21', items: [
      'Справка дополнена условием подавления warn «PDU завышен» (нагрузка < 3 кВт или PDU ≤ 4 кВт) — синхронизация с поведением computeWarnings/renderFeedInfo.',
      'Файл: rack-config/index.html (секция «Сверка с электрической схемой»).'
    ] },
    { version: '0.59.106', date: '2026-04-21', items: [
      'Формула «needed per feed» для режима N+1 уточнена: неявно подразумевалось, что каждый ввод должен держать полную demandKw (как в 2N), но это слишком строго. После выпадения одного ввода остальные (N−1) делят нагрузку поровну: <code>needed = demandKw / (N−1)</code>. Раньше при N+1 с 3 вводами по 20 кВт модуль мог ругаться на «PDU завышен», хотя PDU были правильно подобраны под пиковый сценарий.',
      'Файлы: rack-config/rack-config.js (computeWarnings + renderFeedInfo needOf), rack-config/index.html (справка).'
    ] },
    { version: '0.59.105', date: '2026-04-21', items: [
      'Практический floor для предупреждения «PDU завышен»: срабатывает только если нагрузка ≥ 3 кВт и номинал PDU > 4 кВт (~16 A 1ф). При малой нагрузке выбор PDU ограничен каталожной сеткой (минимум 16–32 A), и warn о «перезапасе» был бы шумом.',
      'Файлы: rack-config/rack-config.js (computeWarnings + renderFeedInfo badge).'
    ] },
    { version: '0.59.104', date: '2026-04-21', items: [
      'Убрано дублирование err о занижении PDU: для 2N/N+1 проверку занижения делает мода-специфичный блок (weakFeeds / remaining < demandKw), общая per-feed ошибка «PDU < needed» теперь срабатывает только в режиме «без резервирования», чтобы не плодить дубли. Предупреждение о завышенном PDU (>1.8×needed) остаётся во всех режимах.',
      'Файл: rack-config/rack-config.js (computeWarnings: пропуск err для redMode).'
    ] },
    { version: '0.59.103', date: '2026-04-21', items: [
      'Справка (ⓘ → Расчёты) обновлена под новую логику: описан расчёт needed per feed (2N/N+1 → полная demandKw; none → пропорц.), три независимые проверки (PDU < needed = err, PDU > 1.8·needed = warn, avail < needed = err). Явно указано, что PDU vs available больше не сравнивается.',
      'Файл: rack-config/index.html (секция «Сверка с электрической схемой»).'
    ] },
    { version: '0.59.102', date: '2026-04-21', items: [
      'Таблица «Вводы» (rc-feed-info) синхронизирована с новой логикой проверок: бейджи «PDU < нагрузки» (err), «ввод < нагрузки» (err), «PDU завышен» (warn при PDU > 1.8×нагрузки), «OK». В колонке PDU показывается «(нужно X кВт)».',
      'Файл: rack-config/rack-config.js (renderFeedInfo — needOf + 4-вариантный badge).'
    ] },
    { version: '0.59.101', date: '2026-04-21', items: [
      'Проверки PDU vs ввод переработаны. Раньше ошибка «PDU превышает доступную на вводе» срабатывала, когда номинал PDU был больше availableKw самого ввода — но это нормальная ситуация: PDU обычно имеет запас над нагрузкой, главное, что сам ввод не короче нагрузки.',
      'Новая логика:  (1) номинал PDU должен быть ≥ требуемой нагрузки на ввод (режим 2N / N+1 — полная demandKw на каждом вводе; none — пропорционально ёмкости). Занижение = err «не хватит запитать». (2) Если PDU > 1.8 × нужного — warn «сильно завышен, можно меньший типоразмер». (3) Сверка со схемой: ошибка, только если availableKw ввода меньше нужной нагрузки на этот ввод (а не номинала PDU).',
      'Файлы: rack-config/rack-config.js (computeWarnings: блок neededPerFeed + два новых чека + изменена семантика сравнения со схемой).'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка (?) с вкладками usage/calcs.'] },
    { version: '0.55.0', date: '2026-03-25', items: ['Каталог Kehua H-series + 2N / N+1 логика PDU + T-сплиттер IEC 60309.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Возврат конфигурации в узел схемы через postMessage + localStorage.'] },
    { version: '0.48.0', date: '2026-01-05', items: ['Каталог аксессуаров: Kehua Wise, APC, Rittal, Raritan/Minkels; фильтр по бренду шкафа.'] },
    { version: '0.47.0', date: '2025-12-20', items: ['Базовые комплекты с блокировкой вложенных полей; BOM одной позицией.'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Первая версия конфигуратора стойки: корпус, двери, стенки, вводы, PDU.'] },
  ],

  'mv-config': [
    { version: '0.59.188', date: '2026-04-22', items: [
      'Левый сайдбар standalone-режима: «Основные настройки» / «Свойства» / «Конфигурации РУ СН» через shared/config-sidebar.js. В embedded-режиме (body.mvc-embed) скрывается.',
      'Файлы: mv-config/index.html (main.mvc-layout + aside + mount); mv-config/mv-config.css (grid-layout).',
    ] },
    { version: '0.56.4', date: '2026-04-15', items: ['Уставки MV-реле (Ir/Isd/tsd/Ii) в TCC и селективности.'] },
    { version: '0.56.2', date: '2026-04-12', items: ['Редактор уставок MV-реле — модалка по клику на VCB-ячейке.'] },
    { version: '0.56.1', date: '2026-04-10', items: ['ABB SafeRing (typo fix); lockedId блокирует альтернативные семейства.'] },
    { version: '0.55.1', date: '2026-03-20', items: ['utility-infeed; разделение палитры НКУ / РУ СН.'] },
    { version: '0.55.0', date: '2026-03-15', items: ['RM6-builder + auto-isMv.'] },
    { version: '0.52.0', date: '2026-02-25', items: ['Первая версия MV-оборудования: RM6, SafeRing, ЩО-70 + уставки.'] },
  ],

  'pdu-config': [
    { version: '0.59.189', date: '2026-04-22', items: [
      'Левый сайдбар дополнен блоком «Свойства» + «Конфигурации PDU» через shared/config-sidebar.js. Существующая форма контекста остаётся, новый блок закреплён сверху. В embedded-режиме (?embed=1) не монтируется.',
      'Файлы: pdu-config/index.html (#pc-cfg-mount + mountConfigSidebar).',
    ] },
    { version: '0.59.126', date: '2026-04-21', items: [
      '<b>Embed-режим для iframe в Конфигураторе стойки.</b> Страница детектирует <code>?embed=1</code>: скрывает шапку и футер, внизу рендерит sticky-бар со «⬇ Применить требования» и «✕ Закрыть». Клик по «Выбрать» на строке или по «Применить требования» отправляет postMessage parent-окну (rack-config), которое применяет данные к конкретной строке PDU.',
      'Файлы: pdu-config/pdu-config.js (IS_EMBED, postToParent, injectEmbedBar), pdu-config/pdu-config.css (+.pc-embed-bar).'
    ] },
    { version: '0.59.124', date: '2026-04-21', items: [
      '<b>Динамические типы розеток.</b> Поля розеток больше не хардкод C13/C19/Schuko — грид автодетектит типы из каталога (C13, C19, Schuko, и любые новые — NEMA 5-15/20, IEC 309, C15 и т.п.). Есть поле «+ свой тип» — можно добавить произвольный тип и задать количество.',
      '<b>Фикс: модалка «Детали» теперь имеет стили.</b> Добавлены .rc-modal / .rc-modal-backdrop / .rc-modal-panel / .rc-modal-head / .rc-modal-close / .rc-modal-body в pdu-config.css — раньше ссылались на классы из rack-config.css, но те касались другого виджета и не применялись. Теперь карточка PDU открывается по центру с затемнением, заголовком и кнопкой закрытия.',
      '<b>Фикс футера.</b> В changelog-записи 0.59.123 был экранированный апостроф внутри single-quoted строки — в некоторых браузерах парсер спотыкался на «Unexpected identifier». Текст переписан без экранирования, футер снова монтируется.',
      'Файлы: pdu-config/pdu-config.js (state.outlets → map, detectedOutletTypes, renderOutletInputs, countOutlets → map, scoreCandidate), pdu-config/index.html (outlets-grid), pdu-config/pdu-config.css (+.rc-modal*, +.pc-outlets-grid), shared/module-changelogs.js (fix 0.59.123 entry).'
    ] },
    { version: '0.59.123', date: '2026-04-21', items: [
      '<b>Нормальный конфигуратор PDU, а не фильтр.</b> Полный rewrite страницы: теперь это «контекст → требования → рекомендации → действие», а не голый фильтр по справочнику.',
      '① <b>Контекст стойки</b> (акцентная секция): Серверов, кВт/сервер, C19-потребителей (GPU/blade), cos φ, система (1ф/3ф, 230/400 В), резерв (N или <b>2N</b> — два PDU A+B). Живая сводка: P<sub>rack</sub>, I<sub>rack</sub>, I<sub>треб</sub> (с запасом 1.25× по NEC 80%), рекомендуемый номинал, число розеток C13/C19 на один PDU, сколько PDU надо. Для 2N берём максимум из <code>0.6·I</code> (штатный режим) и <code>1.25·I</code> (отказ второго).',
      '② <b>Требования</b> (derived, editable): поля номинала, фаз, высоты, категории, розеток автозаполняются из контекста, можно подправить руками.',
      '③ <b>Рекомендации</b>: ranked-таблица по score (0-100), бейдж «✓ Лучшее» на первой строке, на каждой строке — кнопки <b>Детали</b> и <b>Выбрать</b>.',
      '<b>Экспорт требований:</b> «⬇ Перенести требования» (без SKU, requirementsOnly-payload в rack-config), «🖨 Печать» (стилизованный лист требований), «📄 .md» (Markdown-экспорт), «Каталог ↗» (переход в /catalog/?filterKind=pdu).',
      '<b>Футер:</b> inline-static-футер рендерится сразу в HTML, боевой mountFooter() его подменяет; при падении импорта показывается красная полоса с текстом ошибки — не молчаливая потеря UI.',
      'Файлы: pdu-config/index.html (rewrite), pdu-config/pdu-config.js (rewrite: ctx, computeFromContext, applyContextToRequirements, exportMarkdown, printRequirements, flash, row-actions), pdu-config/pdu-config.css (+ .pc-section-accent, .pc-summary-grid, .pc-btn-full, .pc-actions-row, .pc-results-head, .pc-action-bar, .pc-banner, .pc-row-best, .pc-badge-best, .pc-row-actions, .pc-flash, .pc-static-footer).'
    ] },
    { version: '0.59.122', date: '2026-04-21', items: [
      '<b>Фикс: .nojekyll в корне репо.</b> GitHub Pages по умолчанию прогоняет сайт через Jekyll, а Jekyll игнорирует файлы/папки с префиксом <code>_</code>. Из-за этого <code>shared/catalogs/_helpers.js</code> возвращал 404, barrel shared/rack-catalog-data.js валился на первом же import, вся цепочка main.js не стартовала, главная висла на «Загрузка…». Добавлен пустой файл <code>.nojekyll</code> в корень — Pages отключает Jekyll и отдаёт файлы как есть.'
    ] },
    { version: '0.59.121', date: '2026-04-21', items: [
      '<b>Переиспользуемая модалка подбора PDU.</b> shared/pdu-picker-modal.js теперь: перемещаемая мышью, фиксированный размер (не схлопывается при сокращении списка), двухколоночный фильтр с заголовками секций, легенда Score, и новые экшены в футере — «⬇ Перенести требования» (сохраняет требования без SKU через raschet.lastPduConfig.v1, флаг requirementsOnly), «🖨 Распечатать» (лист требований), «Каталог ↗» (переход в /catalog/?kind=pdu).',
      'Seed-каталоги перенесены в <code>shared/catalogs/</code> — PDU-сиды теперь в shared/catalogs/pdus.js.',
      'Файлы: shared/pdu-picker-modal.js, shared/catalogs/*, shared/rack-catalog-data.js (barrel).'
    ] },
    { version: '0.59.120', date: '2026-04-21', items: [
      '<b>Фикс фильтра: «0 из 18» → корректный подбор.</b> Стандартные PDU-сиды в shared/pdus-catalog-data.js хранят кол-во розеток в поле <code>count</code>, а standalone /pdu-config/ читал поле <code>qty</code> — из-за этого <code>countOutlets()</code> всегда возвращал нули и ни одна модель не проходила минимум по розеткам. В модалке подбора PDU Конфигуратора стойки (shared/pdu-picker-modal.js) это было исправлено раньше через <code>o.qty ?? o.count</code>; теперь та же нормализация в pdu-config.js — и detail-модал показывает правильное количество.',
      'Файл: pdu-config/pdu-config.js (countOutlets + openDetail rows).'
    ] },
    { version: '0.59.119', date: '2026-04-21', items: [
      'Standalone-пик переводит PDU в главный Конфигуратор стойки. В детальной карточке (клик на строку результата) добавлены:',
      '— <b>⬆ Выбрать эту модель</b>: сохраняет <code>raschet.lastPduConfig.v1</code> (sku, производитель, категория, фазы, номинал, высота, розетки, timestamp). В Конфигураторе стойки в модалке «Каталог PDU» появится синяя кнопка «⬇ Из Конфигуратора PDU: …» — один клик подставит модель в текущий ввод.',
      '— <b>Открыть Конфигуратор стойки →</b>: сохраняет тот же payload и сразу переходит на <code>../rack-config/</code>.',
      'Зелёная плашка-индикатор над формой: «✓ Сейчас выбрано: &lt;производитель&gt; · &lt;модель&gt; (X мин назад) · 3ф · 32 A · 0U» + кнопка «✕ Сбросить». Видна, пока запись свежая (< 24 ч), обновляется раз в минуту, переживает reload.',
      'Детальная карточка: исправлено отображение высоты (<code>0U (вертикальный)</code> вместо пустого «—» для kp.height=0).',
      'Файл: pdu-config/pdu-config.js (+saveLastPdu, +renderPendingBanner, openDetail с двумя кнопками handoff).'
    ] },
    { version: '0.59.118', date: '2026-04-21', items: [
      'Фильтр высоты заработал: option-значения сменены со строк "0U"/"1U"/"2U" на числа "0"/"1"/"2", чтобы совпадать с числовым <code>kp.height</code> из rack-catalog-data.js (seed\'ы хранят высоту как number, не string). Сравнение в scoreCandidate через <code>String(kp.height) !== String(state.height)</code> теперь одинаково работает и для модалки, и для standalone-страницы.',
      'Файлы: pdu-config/index.html (option value), pdu-config/pdu-config.js (String-compare).'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Каталог APC / Rittal / Raritan / Kehua; категории basic/metered/monitored/switched/hybrid.'] },
    { version: '0.45.0', date: '2025-11-15', items: ['Первая версия конфигуратора PDU.'] },
  ],

  'ups-config': [
    { version: '0.59.423', date: '2026-04-26', items: [
      '🩹 <b>Фикс: пустой список на шаге 2 при выборе All-in-One.</b> Раньше, если пользователь на шаге 1 выбирал тип «All-in-One», а каталог Kehua S³C AIO ещё не был загружен, шаг 2 показывал «Подходящих моделей не найдено» и предлагал «уменьшить нагрузку» — без подсказки, что нужно сначала залить справочник AIO.',
      '• <b>Inline seed-кнопка.</b> В пустом состоянии шага 2 теперь появляется кнопка <b>«📦 Загрузить каталог Kehua S³C AIO (6 моделей)»</b>, если выбран тип AIO и в справочнике нет ни одной AIO-записи. Один клик — все 6 моделей (S³C040-1106…3320, S³C050-3320, S³C100-3320) добавляются в справочник, список перерисовывается автоматически.',
      'Файлы: ups-config/ups-config.js (_renderSuitableList — extra-блок с inline seed-кнопкой при !hasAio).',
    ] },
    { version: '0.59.421', date: '2026-04-26', items: [
      '📦 <b>Новый тип ИБП «All-in-One» + каталог Kehua S³C.</b> Жалоба: «добавь новый тип ИБП ALL in One, почти как интегрированный но с своими ограничениями». В реестре <code>shared/ups-types/</code> появился четвёртый плагин <code>all-in-one.js</code> — моноблочный шкаф со встроенной АКБ Li-Ion и встроенными PDM-панелями.',
      '• <b>Ограничения All-in-One vs Integrated:</b> 1) АКБ <b>не подбирается отдельно</b> — фиксированный набор модулей в шкафу (8 для 40/50 А·ч, 4 для 100 А·ч); 2) <b>параллель не поддерживается</b> — для нагрузки > 20 кВА или резервирования N+1 / 2N модель отбрасывается из подбора (<code>pickFit</code> вернёт null); 3) PDM-панели — по <b>одному выходу на панель</b> (без 24-разъёмной разводки), чтобы не загромождать схему; 4) фазы 1:1 или 3:3 — выбираются в форме.',
      '• <b>Каталог Kehua S³C AIO:</b> новый файл <code>shared/catalogs/ups-kehua-s3-aio.js</code> с 6 моделями: S³C040-1106 (1:1, 6 кВА), S³C040-1110 (1:1, 10 кВА), S³C040-3310 (3:3, 10 кВА), S³C040-3320 (3:3, 20 кВА), S³C050-3320, S³C100-3320 (long-time backup). Кнопка <b>«📦 Kehua S³C AIO»</b> в шапке справочника рядом с «⚡ Kehua UPS» — загружает все 6 моделей одной кнопкой.',
      'Файлы: shared/ups-types/all-in-one.js (НОВЫЙ ~220 строк), shared/ups-types/index.js (+ allInOneType), shared/catalogs/ups-kehua-s3-aio.js (НОВЫЙ ~150 строк), ups-config/index.html (+ #btn-seed-kehua-aio), ups-config/ups-config.js (+ обработчик кнопки).',
      'Roadmap: v0.59.422 — рефактор «Интегрированный» рендерится как многосекционный щит (оболочка + внутренние секции, по одному порту на панель).',
    ] },
    { version: '0.59.420', date: '2026-04-26', items: [
      '🖨 <b>Печатный отчёт о подобранной конфигурации ИБП (PDF через системный диалог).</b> Жалоба: «добавь так же отчет о подобранном ИБП в PDF». На шаге 4 «Итоговая конфигурация» появилась кнопка <b>🖨 Печать (PDF)</b> рядом с «Сохранить в перечень» и «Применить к схеме». Открывает новое окно с разделами: 1) Исходные требования (нагрузка, автономия, резервирование, тип, V<sub>DC</sub>, cos φ, фазы, АКБ-выбор), 2) Подобранная конфигурация (модель, тип, frame/модули/резерв для модульного, КПД, топология IEC 62040-3, V<sub>DC</sub> мин/макс, входы/выходы), 3) Стоимость (цена за ед., количество, итого), 4) Состав комплекта BOM (если есть <code>composition[]</code>), 5) АКБ (если выбрана).',
      '• <b>CSS-правила симметричны battery-calc:</b> <code>h2 { break-after: avoid-page }</code>, секции в <code>&lt;div class="section"&gt;</code> с <code>break-inside: avoid</code>, заголовок никогда не висит в одиночестве в конце страницы.',
      'Файлы: ups-config/index.html (+#wiz-btn-print), ups-config/ups-config.js (+_printUpsReport ~140 строк, обработчик в renderWizard).',
    ] },
    { version: '0.59.407', date: '2026-04-26', items: [
      '🐛 <b>Фикс: при нагрузке 180 кВт wizard предлагал MR33 120.</b> Раньше fitter <code>modular.pickFit</code> проверял только условие <code>installed ≤ moduleSlots</code>, но игнорировал паспортную мощность модели. Если в каталоге есть «копия» записи MR33 120 с расширенным <code>moduleSlots=10</code>, fitter считал что 6×30=180 кВт умещаются — и предлагал модель, рассчитанную всего на 120 кВт. Теперь добавлен жёсткий кап: <code>working × moduleKwRated ≤ capacityKw (или frameKw)</code> — если сумма модулей превышает паспорт модели, кандидат отбрасывается. Файл: shared/ups-types/modular.js (pickFit).',
    ] },
    { version: '0.59.400', date: '2026-04-26', items: [
      '🧙 <b>Wizard ИБП реструктурирован под практический поток подбора (4 шага).</b>',
      '<b>Шаг 1.</b> Только параметры для определения самого ИБП: нагрузка kW, автономия, тип, cos φ, фазы. <b>V<sub>DC</sub> min/max убраны</b> — это параметры для подбора АКБ, а не ИБП-фрейма.',
      '<b>Шаг 2.</b> Подбор фрейма + резервирование (N / N+1 / N+2 / 2N выехало с шага 1) + <b>фильтры</b>: производитель (dropdown из распознанных), топология, диапазон мощности kW (≥/≤), текстовый поиск. Live-обновление при изменении любого фильтра. <code>_pickSuitable</code> больше не отсекает по V<sub>DC</sub> (он же не задаётся пользователем на шаге 1).',
      '<b>Шаг 3 (новый).</b> «Аккумуляторные батареи»: <code>Пропустить</code> или <code>⚡ Подобрать АКБ →</code>. Кнопка «Подобрать» открывает <code>battery/?fromUps=1&loadKw=…&vdcMin=…&vdcMax=…&autonomyMin=…&invEff=…</code> в новой вкладке + сохраняет handoff в <code>raschet.upsHandoff.v1</code>. Battery-модуль показывает баннер «Подбор АКБ для ИБП», предзаполняет форму расчёта (нагрузка, V<sub>DC</sub>, целевая автономия, КПД), и по «Применить → ИБП» возвращает выбор в <code>raschet.upsBatteryReturn.v1</code>.',
      '<b>Шаг 4 (бывший шаг 3).</b> Итог: показывает выбранный ИБП, его паспортный V<sub>DC</sub>, и подобранную АКБ или «<i>пропущены</i>». Применение → схема.',
      '🔄 <b>Возврат АКБ в wizard.</b> Окно <code>focus</code> подхватывает <code>raschet.upsBatteryReturn.v1</code>, кладёт в <code>wizState.battery</code>, разблокирует кнопку «Далее → Итог».',
      '🔋 <b>battery/initUpsHandoff()</b> — новый bootstrap при <code>?fromUps=1</code>. Параллельно работает с node-targeted-режимом ИБП (<code>?nodeId=…</code>) — баннеры разные.',
      '📊 <b>График разряда АКБ: ось X теперь линейная.</b> Раньше Math.log10 на оси времени искажал короткие времена (5 мин выглядели как полпути от 1 до 60). Y-ось остаётся log (мощность падает на порядки — иначе точки слипаются).',
      'Файлы: ups-config/index.html (~50 строк структуры wizard), ups-config/ups-config.js (~180 строк: _showStep[1..4], фильтры step2, _renderSuitableList, _goStep3 АКБ, _openBatteryPicker, _consumeUpsBatteryReturn, focus-handler), battery/index.html (без изменений HTML), battery/battery-calc.js (initUpsHandoff ~70 строк, X-ось линейная).',
    ] },
    { version: '0.59.188', date: '2026-04-22', items: [
      'Левый сайдбар standalone-режима: «Основные настройки» / «Свойства» / «Конфигурации ИБП» через shared/config-sidebar.js. Сохраняются kW/автономия/резервирование/топология wizard. В embedded-режиме (body.uc-embed) скрывается.',
      'Файлы: ups-config/index.html (main.uc-layout + aside + mount); ups-config/ups-config.css (grid-layout).',
    ] },
    { version: '0.59.176', date: '2026-04-22', items: [
      'Модуль стал КОНФИГУРАТОРОМ, а не каталогом: при открытии ups-config/ сразу виден wizard подбора (Шаг 1 — требования: мощность, автономия, резервирование N/N+1/N+2/2N, тип, V_DC, cos φ). Раньше wizard появлялся только при входе из инспектора с ?nodeId=, а все прочие точки входа («Конфигуратор ИБП» в Hub, кнопки в инспекторе) показывали только справочник — создавалось впечатление, что модуль = каталог.',
      'Файлы: ups-config/index.html (#configurator-wizard: убран display:none, обновлён page-intro на формулировку «подбор по требованиям»); ups-config/ups-config.js (DOMContentLoaded: если нет ?nodeId=, авто-запускается launchStandaloneWizard; initWizard возвращает boolean чтобы не перезапускаться дважды).',
      'Справочник моделей остаётся в секции ниже для пополнения/просмотра. Каскадный пикер и «Выбрать эту модель» работают как раньше — для случаев, когда пользователь хочет просто выбрать конкретную модель без wizard-подбора.'
    ] },
    { version: '0.59.75', date: '2026-04-21', items: [
      'Мастер подбора ИБП работает и в standalone-режиме (из Hub, без ?nodeId=). В toolbar справочника появилась кнопка «🧙 Мастер подбора» — запускает тот же 3-шаговый wizard, что и из инспектора ИБП Конструктора схем: Шаг 1 требования (мощность kW, автономия мин, резервирование N/N+1/N+2/2N, тип modular/monoblock, VDC min/max, cos φ, число фаз) → Шаг 2 подходящие модели из справочника (фильтр по типу/VDC/capacity + расчёт числа установленных модулей через _calcModules) → Шаг 3 итог (композиция + цена).',
      'На шаге 3 в standalone-режиме кнопка «✓ Выбрать эту конфигурацию» пишет тот же payload что и node-targeted режим (с полным `configuration`: frameId, upsType, capacityKw, moduleInstalled/Working/Redundant, frameKw, moduleKwRated, moduleSlots, redundancyScheme, batteryVdcMin/Max, batteryAutonomyMin, composition) в `raschet.lastUpsConfig.v1`. Wizard сворачивается, справочник показывается снова, зелёная плашка-индикатор под заголовком обновляется и показывает «<capacityKw> kW · резерв N+1 · автономия X мин».',
      'Инспектор ИБП в Конструкторе схем: кнопка «⬇ Применить из Конфигуратора» теперь применяет не только базовые поля ups-модели (applyUpsModel), но и весь `configuration` (capacityKw реальный из wizard\'а, moduleInstalled, redundancyScheme, batteryVdcMin/Max, batteryAutonomyMin, composition) — один клик даёт полностью сконфигурированный узел.',
      'Подробнее в changelog schematic 0.59.75.'
    ] },
    { version: '0.59.74', date: '2026-04-21', items: [
      'Под заголовком страницы появилась зелёная плашка «✓ Сейчас выбрано: <supplier> · <model> (X мин назад)» — показывает какая модель лежит в raschet.lastUpsConfig.v1 и ждёт применения в Конструкторе схем. Видна только в standalone-режиме (без ?nodeId=), пережидает reload страницы, обновляется после клика по «⬆ Выбрать эту модель» и раз в минуту. Кнопка «✕ Сбросить» удаляет ключ.'
    ] },
    { version: '0.59.73', date: '2026-04-21', items: [
      'Standalone-режим (из Hub, без ?nodeId=): кнопка «⬆ Выбрать эту модель» в панели «Выбранная модель» сохраняет готовый ИБП в localStorage[raschet.lastUpsConfig.v1]. Инспектор ИБП главной схемы подхватывает и применяет по кнопке «⬇ Применить из Конфигуратора».',
      'Node-targeted режим (из инспектора «⚙ Сконфигурировать подробно»): кнопка «✓ Применить к узлу на схеме» в той же панели — сразу пишет raschet.pendingUpsSelection.v1 и закрывает вкладку.',
      'Кнопки не показываются для BOM-записей (frame / power-module / battery-cabinet) — они идут в спецификацию, а не в узел ИБП.'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.46.0', date: '2025-11-28', items: ['Wizard подбора ИБП по нагрузке + резерву.'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Первая версия: каталог ИБП, интеграция с главной схемой.'] },
  ],

  'transformer-config': [
    { version: '0.59.188', date: '2026-04-22', items: [
      'Левый сайдбар standalone-режима: «Основные настройки» / «Свойства» / «Конфигурации трансформаторов» через shared/config-sidebar.js. В embedded-режиме (body.tc-embed) скрывается.',
      'Файлы: transformer-config/index.html (main.tc-layout + aside + mount); transformer-config/transformer-config.css (grid-layout).',
    ] },
    { version: '0.59.178', date: '2026-04-22', items: [
      'Модуль стал КОНФИГУРАТОРОМ, а не просто каталогом: добавлен мастер подбора (#tx-wizard) с фильтром по нагрузке (кВА + %запаса), U_HV (6/10/20/35), U_LV (230/400/690), типу (масляный/сухой по классификации серии), группе соединений (Dyn11/Yyn0/Yzn11). Результат — таблица подходящих моделей, отсортированная по утилизации, с кнопкой «Выбрать» (выделяет модель в каскадном пикере справочника).',
      'Файлы: transformer-config/index.html (#tx-wizard с form-grid + кнопки Подобрать/Сброс + #tx-wiz-results); transformer-config.js (runTxWizard, _classifyTxType по серии ТМ*/ТС* + coolingType). Требуется S_nom ≥ loadKva·(1 + reserve/100); совпадение U_HV/U_LV точное; тип и группа — фильтры по строке серии.'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Расчёт потерь Pk/P0/Uk; температурный режим.'] },
    { version: '0.45.0', date: '2025-11-15', items: ['Первая версия: сухие / масляные, Dyn11/Yyn0.'] },
  ],

  'panel-config': [
    { version: '0.59.192', date: '2026-04-22', items: [
      'Embedded-режим: при запуске конфигуратора из главной схемы (iframe, ?embedded=1) сверху показывается компактный пикер «Выберите шаблон» со списком сохранённых конфигураций. Клик по шаблону → postMessage parent-окну типа {type:\'*-config:apply\', entry}, чтобы родитель применил конфигурацию к выбранной группе элементов.',
      'Аналогично во всех 7 конфигураторах: panel/ups/transformer/mv/pdu/mdc/suppression.',
      'Файлы: */index.html (mountEmbeddedPicker в embedded-ветке).',
    ] },
    { version: '0.59.191', date: '2026-04-22', items: [
      'Клик по сохранённой конфигурации в сайдбаре теперь заполняет поля wizard (имя/тип/кВт/напряжение/IP/форма/вводы/отходящие/запас). Пропущенные поля не затираются (preserve-on-miss).',
      'Аналогично в ups-config / transformer-config / mv-config / pdu-config / mdc-config — клик по записи восстанавливает параметры wizard из payload.',
      'Файлы: panel-config/index.html, ups-config/index.html, transformer-config/index.html, mv-config/index.html, pdu-config/index.html, mdc-config/index.html.',
    ] },
    { version: '0.59.190', date: '2026-04-22', items: [
      'Config-sidebar автоматически привязывается к коду активного проекта (localStorage.raschet.activeProject.v1.code). Если проект открыт — список конфигураций фильтруется по его projectCode, новые сохраняются с этим кодом, ID = PROJ-NN вместо YYMMDD-NN. В заголовке списка показывается «@ PROJ».',
      'Концептуальная чистота: конфигурация = шаблон (тип шкафа/боковины/PDU набор), физический элемент в схеме ссылается на конфигурацию и имеет собственный ID+Tag. Catalog хранит только шаблоны.',
      'Файлы: shared/configuration-catalog.js (+getActiveProjectCode); shared/config-sidebar.js (авто-projectCode из проекта).',
    ] },
    { version: '0.59.187', date: '2026-04-22', items: [
      'Добавлена инфраструктура каталога конфигураций (shared/configuration-catalog.js) с единым API для всех 9 конфигураторов: listConfigs/getConfig/saveConfig/removeConfig/onConfigsChange/nextConfigId/isEmbeddedMode. ID по умолчанию YYMMDD-NN (дата + порядковый), при указании projectCode — PROJ-NN (код проекта + порядковый).',
      'Добавлен универсальный левый сайдбар (shared/config-sidebar.js) с тремя секциями: «Основные настройки» (слот), «Свойства» (read-only метаданные), «Перечень конфигураций» (CRUD + поиск + «+ Сохранить»). В embedded-режиме (?embedded=1 или window.name=raschet-embed) сайдбар скрывается, вместо него mountEmbeddedPicker показывает список шаблонов «Применить к группе элементов».',
      'panel-config — первый референс-модуль: main.pc-layout = grid с рис-сайдбаром слева, подключён sidebar-resizer. Сохранение конфигурации из Шага 1 wizard (имя/тип/кВт/напряжение/IP) одной кнопкой «+ Сохранить».',
      'Файлы: shared/configuration-catalog.js (новый, 188 строк); shared/config-sidebar.js (новый, 267 строк); panel-config/index.html (aside + mount); panel-config/panel-config.css (grid-layout с body.pc-embed).',
    ] },
    { version: '0.59.177', date: '2026-04-22', items: [
      'Модуль стал КОНФИГУРАТОРОМ, а не каталогом: wizard подбора щита (5 шагов) виден по умолчанию при открытии panel-config/ без ?nodeId=. Раньше wizard появлялся только при входе из инспектора узла, а все прочие точки входа показывали только справочник.',
      '_pcApplyConfiguration() теперь различает режимы: при nodeId пишет в raschet.pendingPanelSelection.v1 и закрывает вкладку (как раньше); в standalone — пишет в raschet.lastPanelConfig.v1 для последующего применения из инспектора кнопкой «⬇ Применить из Конфигуратора».',
      'Cancel на Шаге 1 в standalone сворачивает wizard и возвращает справочник вместо window.close().',
      'Файлы: panel-config/index.html (#pc-wizard: убран display:none); panel-config/panel-config.js (standalone-ветка в initWizard cancel + _pcApplyConfiguration).'
    ] },
    { version: '0.59.81', date: '2026-04-21', items: [
      'Wizard теперь видит реальные автоматы из схемы: инспектор главной схемы собирает все c.from.nodeId === n.id (исходящие) и c.to.nodeId === n.id (входящие) связи узла-щита и передаёт их в preload (incomingLines/outgoingLines с targetName, breakerInA, loadKw, threePhase, cableLabel). _pcGenerateBreakers() строит breakers-список по фактическим линиям, а не по абстрактному числу outputs.',
      'Имя автомата: «→ «Офис 1 этаж» · 15.2 kW» вместо «Отходящая линия 1». Номинал берётся из c._breakerIn (посчитан recalc) или подбирается по loadKw нагрузки за линией. Кривая: MCCB для ≥125А, MCB_C иначе. Полюса: 1P/3P по threePhase флагу связи.',
      'На шаге 3 показывается подсказка: «✓ Автоматы построены по N реальным отходящим линиям» (зелёная) или «⚠ В схеме у узла нет подключённых линий» (жёлтая, если щит в проекте ни к чему не подключён).',
      'Индикатор в инспекторе: кнопка конфигуратора показывает бейдж «✓ 1 вв / 6 отх» если panelBreakers сохранён, иначе «не сконфигурирован». Текст кнопки меняется на «Изменить конфигурацию НКУ».',
      'Файлы: js/engine/inspector/panel.js (сбор linesIn/Out из state.conns в preload + бейдж); panel-config/panel-config.js (preload.incomingLines/outgoingLines используются в _pcGenerateBreakers; подсказка на шаге 3).'
    ] },
    { version: '0.59.80', date: '2026-04-21', items: [
      'Критичный фикс: inline-позиции composition (учёт / ТТ / мониторинг / аксессуары из wizard, inline-автоматы) теперь попадают в BOM. Раньше expandComposition() пропускал всё с elementId=null (строка `if (!c.elementId) continue`), из-за чего позиции сохранялись на узле, но не попадали ни в спецификацию, ни в выгрузки XLSX/CSV.',
      'Теперь такие записи добавляются как строки с elementId=null + label + role + qty. Агрегация по label работает корректно (одинаковые ТТ 200/5 с разных автоматов объединяются по метке → нет, они остаются отдельными строками, т.к. label содержит имя автомата — что полезно для монтажной спецификации).',
      'ТТ: количество per автомат теперь корректно: 3 для 3-/4-полюсных (N без ТТ), 1 для 1-/2-полюсных. Было: qty=poles, что давало 4 ТТ для 4P автомата.',
      'Файлы: shared/bom.js (expandComposition — обработка inline-позиций); panel-config/panel-config.js (_pcBuildMeteringComposition — формула nCt).'
    ] },
    { version: '0.59.79', date: '2026-04-21', items: [
      'Повторный запуск wizard для уже сконфигурированного узла восстанавливает состояние: breakers (номиналы/типы/полюса), чекбоксы учёта (коммерческий/технический), модели счётчиков, настройки ТТ (класс, ВА, вт., охват, выборка по автоматам), мониторинг (устройство/шина/охват), принадлежности. Раньше все поля сбрасывались на дефолты.',
      'Механизм: инспектор главной схемы на каждый render узла «щит» пишет в `raschet.panelWizardPreload.v1` снимок `{nodeId, breakers, metering, ct, monitoring, accessories}`. Wizard при initPanelWizard() читает preload и — если nodeId совпадает — накладывает его на pcWizState поверх дефолтов. _pcGoStep3 больше не перезатирает breakers, если они уже загружены.',
      'Файлы: js/engine/inspector/panel.js (+write preload); panel-config/panel-config.js (read preload в initPanelWizard, guard в _pcGoStep3).'
    ] },
    { version: '0.59.78', date: '2026-04-21', items: [
      'Wizard расширен до 5 шагов: добавлен шаг «Учёт, ТТ, мониторинг, аксессуары» (между автоматами и итогом).',
      'Коммерческий учёт (АСКУЭ): чекбокс + выбор модели (Меркурий / Энергомера / Landis+Gyr / Schneider iEM3255), точка установки (до/после вводного). Включение автоматически активирует ТТ (для класса 0.5S).',
      'Технический учёт: чекбокс + модель (iEM3155/3255, PM2120, Меркурий 236, Энергомера СЕ308) + охват: «только вводные / каждая отходящая / выборочно». В режиме «выборочно» — чеклист всех автоматов.',
      'Трансформаторы тока: авто-подбор первичного номинала (стандартный ряд ГОСТ 7746 / IEC 61869-2: 50/75/100/…/4000/5000/6300 А) по правилу `primary ≥ 1.25·Iₙ автомата`. Параметры: класс точности (0.5S / 0.5 / 1 / 3 / 5P10), мощность (2.5/5/10/15/30 ВА), вторичка (5 / 1 А). Охват: вводы / каждый / выборочно. Количество ТТ per автомат = числу полюсов. Показывается live-таблица с рекомендованными номиналами.',
      'Мониторинг: устройства (мультиметр U/I/P/Q/S/cosφ, анализатор качества THD/flicker, дискр. вход, сигнальное реле) + интерфейс (Modbus RTU/TCP / сухой контакт / локальная индикация). Охват: вводы / каждый / выборочно.',
      'Принадлежности из каталога: динамические строки (название + количество + примечание) — реле контроля фаз, лампы сигнализации, вентиляторы, термостаты, замки и т.п. Позиции попадают в composition как role="accessory".',
      'Итог (шаг 5) показывает группировку по ролям (meter-commercial/meter-technical/ct/monitoring/accessory) с количеством.',
      'Payload pendingPanelSelection.v1 расширен полями configuration.metering / ct / monitoring / accessories + позиции в composition (роли: meter-commercial, meter-technical, ct, monitoring, accessory).',
      'Файлы: panel-config/index.html (+4-й шаг wizard, 5-й шаг Итог переиндексирован); panel-config/panel-config.js (расширен pcWizState, +PC_CT_PRIMARY_RATIOS / _pcPickCtPrimary, +_pcRenderStep4/_pcRefreshStep4Lists/_pcRenderAccessoryRows/_pcBuildMeteringComposition); panel-config/panel-config.css (+.pc-acc-section / .pc-acc-list / .pc-accessory-row); js/engine/index.js (_tryConsumePendingPanelSelection — сохраняет metering/ct/monitoring/accessories в node); js/engine/inspector/panel.js (read-only сводка учёта/ТТ/мониторинга в инспекторе).'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.48.0', date: '2026-01-05', items: ['Конфигуратор НКУ (wizard) + пресеты шкафов.'] },
    { version: '0.47.0', date: '2025-12-20', items: ['Первая версия: секции / модули / автоматы.'] },
  ],

  'scs-config': [
    { version: '0.55.0', date: '2026-03-15', items: ['Stub: расчёт СКС/LAN-кабельной системы.'] },
  ],

  'mdc-config': [
    { version: '0.59.189', date: '2026-04-22', items: [
      'Левый сайдбар дополнен блоком «Свойства» + «Конфигурации модульных ЦОД» через shared/config-sidebar.js. Существующий опросник остаётся, блок закреплён сверху. В embedded-режиме не монтируется.',
      'Файлы: mdc-config/index.html (#mdc-cfg-mount + mountConfigSidebar).',
    ] },
    { version: '0.59.148', date: '2026-04-21', items: ['XLSX «Объём поставки» приближён к шаблону 26003-SCO-001: блок метаданных проекта (Объект / Заказчик / Договор / Ревизия / Дата) из localStorage[\'raschet.activeProject.v1\'], section-title через merged cells, итоги по каждому разделу (позиций + Σ кол-во) и общий total в конце. Без логотипов/подписей — для полного оформления нужен xlsx-js-style. Файл: mdc-config/mdc-config.js::exportBom.'] },
    { version: '0.59.146', date: '2026-04-21', items: ['Добавлена кнопка «🔥 → АГПТ» (Phase 11.8): собирает геометрию всех IT- и силовых модулей ЦОД (кроме коридора) и передаёт в suppression-config через localStorage-мост `raschet.mdcToSuppression.v1`. Зона = модуль GDM-600 (S=widthMm·lengthMm, H=2.7 м фикс), направления — «IT-модули» / «Силовые модули». Переход в модуль АГПТ по кнопке с query ?from=mdc. Файлы: index.html (+#mdc-send-suppression), mdc-config.js (+sendToSuppression + обработчик).'] },
    { version: '0.58.87', date: '2026-04-19', items: ['MVP: wizard + зоны + planview (серверная / ИБП+АКБ / CRAC).'] },
    { version: '0.58.80', date: '2026-04-15', items: ['Типоразмеры контейнера (2400/3000 × 6058/9000/12192/15000 мм).'] },
  ],

  'battery': [
    { version: '0.59.428', date: '2026-04-26', items: [
      '🎛 <b>Селекторы вариантов S³ в battery-calc.</b> При выборе модуля Kehua S³ под пикером появляется голубой блок «Опции системы Kehua S³» с тремя выпадающими списками:',
      '• <b>Master шкаф</b>: <code>-M</code> (master с touch-screen, default), <code>-M1</code> (master с одним battery breaker на выходе), <code>-M2</code> (master, согласованный с Kehua KR modular UPS).',
      '• <b>Slave шкафы</b>: <code>-S</code> (slave с LED-индикаторами, default), <code>-S2</code> (slave для KR modular UPS).',
      '• <b>Fire-fighting</b>: <code>X</code> (с пожаротушением module-level, default — соответствует каталожным S3M040-6C-240-<b>X</b> и т.п.) или blank (без пожаротушения).',
      '🔄 <b>Live-обновление состава.</b> При смене любого селектора блок «Состав системы (автосборка)» перерисовывается мгновенно (через повторный вызов <code>doCalc()</code>) — пользователь видит как меняется модель шкафа в таблице.',
      '👁 <b>Видимость.</b> Блок появляется только при выборе модуля S³ (<code>isS3Module(b) === true</code>). Для VRLA / AGM / Gel — скрыт. Реализовано в <code>_applyBatteryLock()</code>.',
      'Файлы: battery/index.html (новый <code>#calc-s3-options</code> блок с 3 select), battery/battery-calc.js (показ/скрытие в _applyBatteryLock; чтение значений в _renderS3SystemSpecHtml; addEventListener change на 3 select → doCalc).',
    ] },
    { version: '0.59.427', date: '2026-04-26', items: [
      '🏗 <b>battery-calc показывает автосборку шкафов S³.</b> После расчёта S³-конфигурации (autonomy / required) под основным блоком теперь рендерится секция «<b>Состав системы (автосборка)</b>» с таблицей шкафов: <i>Master</i> (S3C040-6C-20-M / S3C050-4C-20-M / S3C100-1C-12-M), <i>Slave</i> при N&gt;1 и <i>Combiner</i> при N&gt;2 — по архитектуре Figure3-28 User Manual. Заполнение каждого шкафа: число модулей + число заглушек Blank Panel. Master всегда первый (включает touch-screen и BMS-контроллер).',
      '📦 <b>Таблица аксессуаров BOM.</b> Под составом шкафов — отдельная таблица аксессуаров: <i>Slave Wire Kit</i> (по 1 на каждый slave: cabinet comm wire #2 + power wire #3 + network wire #1 4.5 м + 2× RJ45), <i>Networking Device</i> (8-port switch, по 1 на каждые 7 шкафов), <i>Blank Panel</i> (по 1 на каждый пустой слот, отдельный SKU для S3M040/050 vs S3M100). Описания берутся из <code>systemDescription</code> аксессуаров в каталоге.',
      '🚦 <b>Валидация max C-rate.</b> Если расчётная мощность нагрузки превышает паспортную (rated cell discharge × Vnom × Ah × N мод.) — выводится красное предупреждение «Превышение C-rate» с подсказкой: увеличьте число модулей или выберите модель с большим C-rate (6C vs 4C vs 1C). При корректной нагрузке — серая строка «Загрузка по C-rate: X% от паспортной мощности».',
      '<b>Зачем:</b> пользователь сразу видит, сколько шкафов нужно купить и какие — без необходимости открывать User Manual. Это закрывает roadmap-пункт v0.59.427 из плана архитектурного рефакторинга АКБ.',
      'Файлы: battery/battery-calc.js (импорт s3LiIonType, новая функция _renderS3SystemSpecHtml ~50 строк, вызов в _doCalcS3 после основного блока).',
    ] },
    { version: '0.59.426', date: '2026-04-26', items: [
      '🧩 <b>Каркас плагинов типов АКБ — <code>shared/battery-types/</code>.</b> Зеркалит существующую архитектуру <code>shared/ups-types/</code>. Чтобы добавить новый тип АКБ (Pylon UP5000, Huawei LUNA, BYD B-Box и т.п.) — достаточно создать файл <code>shared/battery-types/&lt;id&gt;.js</code> с descriptor\'ом и импортировать его в <code>index.js</code>. Новый тип автоматически получит picker, автосборку шкафов, master/slave-логику, BOM-генерацию.',
      '<b>Файлы каркаса:</b>',
      '• <code>shared/battery-types/index.js</code> — реестр (<code>listBatteryTypes</code>, <code>getBatteryType</code>, <code>detectBatteryType</code>, <code>getBatteryTypeOrFallback</code>).',
      '• <code>shared/battery-types/vrla.js</code> — fallback-плагин для VRLA / AGM / Gel / NiCd / стандартных АКБ. <code>buildSystem()</code> возвращает «насыпь» блоков без шкафов (компоновка делается отдельным шкафом-калькулятором battery/).',
      '• <code>shared/battery-types/s3-li-ion.js</code> — плагин Kehua S³ Li-Ion. <code>buildSystem({module, totalModules, options})</code> по числу модулей собирает: <b>1 шкаф</b> ⇒ master <code>(-M / -M1 / -M2)</code>, <b>2…N</b> ⇒ <code>1×master + (N−1)×slave (-S / -S2)</code>, <b>N&gt;2</b> ⇒ +Combiner-шкаф. Аксессуары: <code>Slave Wire Kit</code> по числу slave, <code>Networking Device</code> по 1 на 7 шкафов, <code>Blank Panel</code> в каждый пустой слот (отдельный SKU для S3M040/050 vs S3M100). Расчёт делегируется существующему <code>shared/battery-s3-logic.js</code>.',
      '🧪 <b>Валидация max C-rate.</b> В s3-li-ion плагине метод <code>validateMaxCRate({module, loadKw, totalModules, invEff})</code>: считает rated power per module = C × V<sub>nom</sub> × Ah / 1000, умножает на <code>totalModules</code>; если пиковая мощность нагрузки превышает — возвращает <code>{ok:false, reason}</code> с подсказкой увеличить число модулей или сменить модель на более «быструю» (6C vs 1C).',
      '<b>Roadmap (не сломано в этой версии — каркас изолирован, ничто его пока не вызывает):</b> v0.59.427 — UI battery-calc и UPS battery modal начнут вызывать <code>buildSystem()</code> + показывать сводку «состав шкафов» (master/slave/combiner) и BOM-блок аксессуаров. v0.59.428 — селекторы вариантов (<code>masterVariant</code>, <code>slaveVariant</code>, <code>fireFighting</code>, <code>maxModulesPerCabinet</code> 12/20) + предупреждение от <code>validateMaxCRate</code>.',
      'Файлы: shared/battery-types/index.js (НОВЫЙ, ~50 строк), shared/battery-types/vrla.js (НОВЫЙ, ~60 строк), shared/battery-types/s3-li-ion.js (НОВЫЙ, ~180 строк).',
    ] },
    { version: '0.59.425', date: '2026-04-26', items: [
      '📚 <b>Каталог Kehua S³ обогащён данными из User Manual.</b> Все 3 модуля (S3M040/050/100) получили в <code>packaging</code> поля из Appendix A Technical Specifications: <code>dischargeRateC</code> (6/4/1), <code>chargeCurrentMaxA: 40</code>, <code>chargeCurrentDefaultA: 20</code>, <code>inputVdcCharge: \'265/±265/530\'</code>, <code>overloadProfile</code> (125–135% → 60 с, 135–150% → 30 с, &gt;150% → 0.5 с), <code>unbalancePct: 3</code>, <code>socAccuracyPct: 95</code>, <code>sohAccuracyPct: 90</code>, <code>comms: {tcpip, rs485}</code>, <code>fireControl: \'module-level\'</code>, флаги <code>coldStart/epo/selfStart/cellInsulation</code>, <code>opTempC/storageTempC/humidityPct</code>, <code>altitudeMaxM: 4000</code>, <code>derateAbove2000m: \'IEC 62040-3\'</code>, <code>noiseDb: 65</code>, <code>overVoltageLevel: 2</code>. Также добавлен список вариантов <code>cabinetVariants: [\'-M\',\'-S\',\'-S2\',\'-M1\',\'-M2\']</code> (для S3C100 — только <code>[\'-M\',\'-S\']</code>). Уточнена ёмкость S3C040 — 46 кВт·ч (было 41 — опечатка).',
      '🆕 <b>Новый раздел каталога — KEHUA_S3_ACCESSORIES.</b> 5 SKU вспомогательных элементов системы S³ согласно User Manual §2.8 + §3.8.1 + Figure3-28: <b>Combiner-шкаф</b> (применяется при <code>cabinetsCount &gt; 2</code>, шинная DC-разводка), <b>Networking Device</b> (managed switch, 8× RJ45, до 7 шкафов на устройство — при &gt;7 шкафов добавляется второе), <b>Blank Panel</b> для S3M040/050 и отдельная для S3M100 (декоративные заглушки пустых слотов), <b>Slave Wire Kit</b> (cabinet communication wire #2, cabinet power wire #3, network wire #1 4.5 м, RJ45 ×2 — по комплекту на каждый slave-шкаф; master-шкаф комплект не требует).',
      '• <b>Тип записи.</b> Все аксессуары — <code>systemSubtype: \'accessory\'</code> + <code>accessoryRole: \'combiner\'/\'networking-device\'/\'blank-panel\'/\'wire-kit\'</code>. Они НЕ участвуют в расчёте автономии и теперь скрыты из пикеров battery-calc и UPS battery modal — добавляются BOM-логикой автоматически в v0.59.426+.',
      '• <b>Архитектура master/slave для будущего расчёта (Figure3-28).</b> 1 шкаф ⇒ master (<code>-M / -M1 / -M2</code>) без slave. N шкафов ⇒ 1×master + (N−1)×slave (<code>-S / -S2</code>). При N&gt;2 — добавляется Combiner-шкаф. Master-шкаф со встроенным touch-screen, slave с LED-индикаторами. <code>-M1</code> = master с 1 battery breaker на выходе. <code>-M2/-S2</code> = модификация под Kehua KR modular UPS.',
      'Файлы: shared/catalogs/battery-kehua-s3.js (~+90 строк packaging metadata + новый раздел KEHUA_S3_ACCESSORIES + добавлены в KEHUA_S3_BATTERIES), battery/battery-calc.js (renderBatterySelector — accessory исключён из списка), js/engine/inspector/ups.js (UPS battery modal — accessory исключён из списка).',
    ] },
    { version: '0.59.424', date: '2026-04-26', items: [
      '🩹 <b>Фикс: шкафы S³ исчезли из списка моделей в battery-calc.</b> Жалоба: «для выбора АКБ серии S³ не следует в одном списке выбирать модули АКБ и фреймы — шкаф должен выбираться автоматически по количеству». Раньше в выпадающем списке «Модель АКБ» одновременно отображались модули (S3M040/050/100) и шкафы (S3C040-6C-20-MX и т.п.), что путало пользователя — выбор шкафа в качестве «модели» приводил к некорректным расчётам, т.к. ёмкость шкафа = ёмкость модуля × N.',
      '• <b>Что сделано:</b> в <code>battery/battery-calc.js</code> функция <code>renderBatterySelector()</code> теперь фильтрует <code>systemSubtype === \'cabinet\'</code> из источника списка. В пикере остаются только модули — шкаф будет собираться автоматически по количеству модулей в будущей версии (см. roadmap ниже). Аналогичный фикс в <code>js/engine/inspector/ups.js</code> сделан ранее (v0.50-v0.55).',
      '<b>Roadmap:</b> v0.59.425 — обогащение каталога S³ из User Manual (Cell discharge rate 6C/4C/1C, варианты шкафа -M/-S/-S2/-M1/-M2, max charge current, overload profile 125%/135%/150%, max parallel cabinets=15). v0.59.426 — каркас плагинов <code>shared/battery-types/</code> для бесшовного добавления новых типов модулей (как <code>shared/ups-types/</code>). v0.59.427 — авто-выбор шкафа по числу модулей + master/slave логика (1 шкаф = master; N шкафов = master + (N−1)×slave). v0.59.428 — UI-селекторы Battery rate / Fire-fighting / Max modules + валидация по max C-rate.',
      'Файлы: battery/battery-calc.js (фильтр systemSubtype в renderBatterySelector).',
    ] },
    { version: '0.59.419', date: '2026-04-26', items: [
      '🔒 <b>КПД инвертора из паспорта ИБП — теперь передаётся и блокируется.</b> Жалоба: «почему КПД инвертора не получили и заблокировали из параметров ИБП». При открытии battery-calc из инспектора схемы (<code>?nodeId=…</code>) поле «КПД инвертора, %» оставалось редактируемым со значением 96% по умолчанию, тогда как V<sub>DC</sub> мин/макс уже корректно подтягивались и блокировались. Это создавало риск получить расчёт, не соответствующий выбранной модели ИБП.',
      '• <b>Что сделано:</b> в <code>js/engine/inspector/ups.js</code> ссылка «🔋 Подобрать АКБ в калькуляторе» теперь добавляет <code>&invEff=&lt;n.efficiency&gt;</code>. В <code>battery/battery-calc.js</code> функция <code>initSchemaContext()</code> читает параметр и заполняет <code>#calc-inveff</code>, ставит <code>readOnly</code>, серый фон и подсказку «Из паспорта ИБП». Аналогично в <code>initUpsHandoff()</code> (<code>?fromUps=1</code>) — поле теперь не только заполняется, но и блокируется.',
      'Файлы: js/engine/inspector/ups.js (qp2.set invEff), battery/battery-calc.js (initSchemaContext + initUpsHandoff: lock #calc-inveff).',
    ] },
    { version: '0.59.418', date: '2026-04-26', items: [
      '📄 <b>Печатный отчёт: заголовки больше не висят в одиночестве в конце страницы.</b> Жалоба + скриншот: «не разделяй заголовок от следующего за ним текста или изображения, если нужно, переноси заголовки на следующую страницу». Раньше при печати раздел «6. Детализация в рабочей зоне» оставался в конце одной страницы, а график уезжал на следующую — некрасиво.',
      '• <b>Что сделано в CSS:</b> на <code>h2</code> добавлены <code>break-after: avoid-page</code> + <code>page-break-after: avoid</code>; каждая секция (заголовок + следующий блок: таблица / график / параграф) обёрнута в <code>&lt;div class="section"&gt;</code> с <code>break-inside: avoid</code>; на <code>.chart</code> — <code>break-inside: avoid</code>, чтобы график не разрывался; на <code>tr/thead</code> таблиц тоже <code>break-inside: avoid</code>. Логика @media print: если перед заголовком не помещается весь блок «h2 + содержимое», движок переносит h2 на следующую страницу целиком.',
      'Файл: battery/battery-calc.js (printBatteryReport: расширены @media print правила, все 6 секций обёрнуты в .section).',
    ] },
    { version: '0.59.417', date: '2026-04-26', items: [
      '🔋 <b>Расчёт АКБ Kehua S³ — теперь через тот же модуль, что и инспектор схем.</b> Жалоба: «в модуле конструктор схем подбор АКБ Литиевых намного правильней сделано, почему в основном конфигураторе не так». Раньше в standalone-калькуляторе S³-модули обсчитывались как обычные VRLA — strings × blocks, без понятия «шкаф / модулей в шкафу», без проверки паспортной мощности шкафа. Теперь при выборе S³-модуля (S3M040/050/100-…-X) включается отдельная ветка <code>_doCalcS3()</code>, которая зовёт <code>computeS3Configuration(...)</code> из <code>shared/battery-s3-logic.js</code> — единого модуля. Та же функция используется в инспекторе ИБП в схеме. Принцип DRY: исправление любой ошибки в S³-расчёте автоматически отражается в обоих местах.',
      '• <b>Авто-конфигурация шкафов и модулей.</b> Прямая задача (autonomy): N = max модулей в шкафу (минимум шкафов = минимум денег и места), C шкафов = ceil(P<sub>battery</sub>/P<sub>cabinet</sub>). Обратная задача (минимум для targetMin): <code>findMinimalS3Config()</code> перебирает C от minByPower и N от 1, возвращает первую конфигурацию, дающую ≥ targetMin минут.',
      '• <b>Что отображается:</b> «N шкаф(ов) × M модулей = K мод.», модель шкафа (S3C040-6C-20-MX и т.п.), V<sub>DC</sub> с режимом (parallel 240 / series 2×240), мощность на модуль (W), паспортная мощность шкафа и системы (кВт), предупреждение о перегрузе, ёмкость кВт·ч.',
      'Файл: battery/battery-calc.js (новая функция _doCalcS3 ~110 строк, ранний return в doCalc для S³-модулей). Импорт shared/battery-s3-logic.js.',
    ] },
    { version: '0.59.409', date: '2026-04-26', items: [
      '🧹 <b>Убран radio-переключатель «из каталога ИБП / ввести вручную».</b> Логика теперь проще и единообразнее: блок «ИБП из каталога» — необязательный пикер. Если модель выбрана — V<sub>DC</sub> мин/макс и КПД блокируются паспортом; если нет — пользователь заполняет поля формы вручную. Удалены: блок <code>calc-ups-manual-row</code> с дублирующими полями V<sub>DC</sub> мин/макс (они и так есть в основной форме после v0.59.407), radio-инпуты <code>calc-ups-mode</code>, обработчик переключения, fallback в <code>_getCurrentVdcRange</code>. Файлы: battery/index.html (~30 строк удалено), battery/battery-calc.js (упрощён _wireUpsPicker, _getCurrentVdcRange).',
    ] },
    { version: '0.59.407', date: '2026-04-26', items: [
      '🎯 <b>V<sub>DC</sub> мин/макс — отдельные видимые поля в форме.</b> Раньше они были «закопаны» внутри блока «Параметры ИБП → ввести вручную» либо просто в hint-тексте. Теперь — два поля прямо в основной форме рядом с «V<sub>DC</sub> номинальное», которое стало readonly (выбирается автоматически = N · V<sub>блока</sub>). Если ИБП выбран из каталога / handoff из конструктора схем / handoff из ИБП-конфигуратора — поля заполняются и блокируются (источник в подсказке). Если нет — пользователь редактирует напрямую, при вводе сразу обновляется hint и пересчёт рекомендации.',
      '📈 <b>График разряда показывает только выбранный End-of-Discharge.</b> Раньше выводились все 5+ кривых endV (1.6, 1.65, 1.7, 1.75, 1.8) — рабочая точка на одной из них, остальные — мусор. Теперь рисуется только ближайшая к выбранному <code>calc-endv</code> кривая. Файл: battery/battery-calc.js (_renderCalcDischargeChart).',
      'Файлы: battery/index.html (отдельные поля calc-vdcmin/calc-vdcmax + readonly calc-dcv), battery/battery-calc.js (_getCurrentVdcRange приоритет form-полей, _applyUpsPickerLock + initUpsHandoff + ctx-handoff пишут в видимые поля, wireCalcForm — input-handlers для V_DC мин/макс).',
    ] },
    { version: '0.59.406', date: '2026-04-26', items: [
      '🔧 <b>Фикс: <code>calcRequiredBlocks</code> уважает blocksPerString от вызывающего.</b> До этого функция всегда пересчитывала <code>blocksPerString = round(dcVoltage / blockVoltage)</code>, что в режиме «обратной задачи» откатывало выбор N, сделанный с учётом диапазона V<sub>DC</sub> мин/макс в v0.59.405. Теперь N берётся как есть, fallback на <code>round(dc/blockV)</code> только если N не передан. Файл: battery/battery-discharge.js (calcRequiredBlocks).',
    ] },
    { version: '0.59.405', date: '2026-04-26', items: [
      '🎯 <b>V<sub>DC</sub> мин/макс реально используется при подборе АКБ.</b> Раньше при выборе ИБП брали среднее V<sub>DC</sub> и затем <code>blocksPerString = round(V_DC_mid / V_block)</code> — диапазон min/max висел только в подсказке. Теперь алгоритм такой: <code>nMin = ceil(V_DC_min / V_block)</code>, <code>nMax = floor(V_DC_max / V_block)</code>, выбирается N (середина диапазона) и фактическое V<sub>DC</sub>=N·V<sub>блока</sub>. В результате гарантируется попадание в [V<sub>DC</sub>min, V<sub>DC</sub>max] при любом состоянии заряда. Если из-за номинала блока ни одно N не вписывается — показывается warning «Напряжение блока X В не позволяет уложить цепочку в диапазон V_DC ...». Источники V_DC: 1) UPS picker (catalog), 2) ручной ввод V_DC мин/макс, 3) handoff из ИБП-конфигуратора / схемы (<code>?vdcMin/vdcMax</code> или ctx-handoff), 4) fallback ±5% от введённого V_DC.',
      '🔢 <b>Число цепочек выбирается автоматически.</b> Поле «Цепочек параллельно» теперь readonly (серое) и показывает рассчитанное значение. Алгоритм: при <code>loadKw>0</code> ищется <i>минимальное</i> N<sub>str</sub>, при котором <code>calcAutonomy</code> даёт feasible-результат и не уходит в экстраполяцию таблицы (т.е. рабочая точка попадает внутрь характеристики производителя). Если такого N не нашлось — берётся минимум, при котором хотя бы feasible (с warning «решение получено экстраполяцией»). В режиме «обратной задачи» (требуемая автономия) auto-select оставлен <code>calcRequiredBlocks</code>, который и так перебирает strings от 1 вверх.',
      '⚖ <b>Нагрузка ≠ номинал ИБП.</b> Раньше при выборе ИБП в калькуляторе АКБ поле «Нагрузка, kW» жёстко блокировалось значением <code>capacityKw</code>. Это неверно: ИБП на 1000 кВт может питать 100 кВт нагрузку, и АКБ нужно подбирать под фактическую нагрузку, а не под максимум ИБП. Теперь поле остаётся редактируемым, в подсказке указывается «номинал ИБП X кВт — введите фактическую нагрузку», placeholder = «до X кВт», атрибут <code>max</code> — для валидации.',
      'Файлы: battery/battery-calc.js (_getCurrentVdcRange, _autoSelectStrings, _handoffVdc, doCalc — переписан подбор blocksPerString и strings, _applyUpsPickerLock — load остаётся редактируемым, initUpsHandoff/ctx-handoff — заполняют _handoffVdc), battery/index.html (calc-strings → readonly с пометкой «выбирается автоматически»).',
    ] },
    { version: '0.59.404', date: '2026-04-26', items: [
      '📈 <b>График разряда АКБ выводится после каждого расчёта с отметкой рабочей точки.</b> Под результатом — SVG-график. Если у выбранной модели есть таблица производителя — рисуются кривые по всем endV. Если выбрана «средняя модель» (без таблицы) — синтезируется одна кривая через <code>avgEfficiency(chemistry, t)</code>. Поверх кривых — красный маркер (рассчитанная точка <i>tMin × P/блок</i>) с пунктирной крестовиной до осей и подписью <code>«N мин · M W/блок»</code>. Для экстраполированных значений (вне таблицы производителя) маркер оранжевый с пометкой «(условно)». Диапазон осей автоматически расширяется на ±10% от рассчитанной точки, чтобы маркер не упирался в границу.',
      'Файлы: battery/battery-calc.js (_renderDischargeChart — параметр highlight + рендер маркера + расширение bounds, _renderCalcDischargeChart — синтез кривой если нет таблицы, _avgEffShim, doCalc — добавлен mount #calc-chart-mount).',
    ] },
    { version: '0.59.403', date: '2026-04-26', items: [
      '🔄 <b>Сортировка во всех списках АКБ.</b> Селектор «Модель АКБ», справочник, селектор VRLA-блоков для шкафа — все теперь сортируются по поставщику → V блока → ёмкости → модели (русская локаль). Раньше Kehua, Panasonic, Sonnenschein, SVC, Vision, YUASA, CSB, Vertiv шли в порядке загрузки/импорта — теперь в одном месте все Kehua, потом все Panasonic и т.д.',
      '🔋 <b>Тип АКБ автоматически выбирается и блокируется при выборе конкретной модели.</b> Раньше пользователь мог иметь Li-Ion в селекторе и VRLA в поле «Химия» — расхождение приводило к неверному fallback-расчёту. Теперь при выборе модели поле «Тип АКБ» (бывшее «Химия») сразу подставляет <code>battery.chemistry</code>, выключается и серым цветом показывает «зафиксировано». При сбросе на «— средняя модель —» снова доступно для редактирования.',
      '🏷 <b>Переименование «Химия» → «Тип АКБ».</b> Во всех местах модуля: фильтры справочника, фильтры калькулятора, поле в форме расчёта, заголовок столбца таблицы. Терминология ближе к привычной для электротехников.',
      '⚡ <b>Выбор ИБП в калькуляторе АКБ (standalone-режим).</b> В форме расчёта — новый блок «Параметры ИБП»: радиокнопка «из каталога ИБП» / «ввести вручную». В режиме «каталога» — фильтры по поставщику/типу/мощности и selector ИБП с сортировкой; при выборе ИБП поля «Нагрузка» и «КПД инвертора» блокируются и берутся из паспорта ИБП, а V<sub>DC</sub> подсвечивается зелёным с подсказкой допустимого диапазона V<sub>DC</sub> min…max. В режиме «вручную» — два поля V<sub>DC</sub> мин/макс, среднее автоматически попадает в «Напряжение блока DC». В handoff-режиме (<code>?fromUps=1</code> или <code>?fromCtx=1</code>) блок скрывается — ИБП уже определён родительским модулем.',
      'Файлы: battery/index.html (+блок Параметры ИБП ~30 строк, переименование), battery/battery-calc.js (_sortBatteries, _sortUpses, _upsFilters, _filterUpses, renderUpsPicker, _applyUpsPickerLock, _wireUpsPicker, chem-lock в _applyBatteryLock, sort в renderCatalog/renderRackBatterySelector).',
    ] },
    { version: '0.59.402', date: '2026-04-26', items: [
      '🔗 <b>Handoff из ИБП/Конструктора схем теперь корректно триггерит зависимые рендеры.</b> До этого <code>initUpsHandoff</code> и контекстный handoff из главного конструктора программно выставляли <code>el.value = …</code>, что не вызывает <code>input</code>/<code>change</code> и блок «Рекомендуемая ёмкость» не появлялся, лок V/Ah не пересчитывался при выборе модели через query-string. Теперь после set-value явно дёргаем <code>_renderCapacityRecommend()</code> и <code>_applyBatteryLock()</code>, а на <code>calc-mode</code> диспатчится <code>change</code> — поле «Целевая автономия» сразу показывается.',
      '🎯 <b>Кнопка «→ Фильтр «Ah ≥ N»» в блоке рекомендации.</b> Один клик подставляет рассчитанный минимум ёмкости в фильтр <code>calc-filter-capmin</code> и перестраивает список моделей. Удобнее, чем вручную набирать число.',
      'Файлы: battery/battery-calc.js (initUpsHandoff + ctx-handoff после set-value, _renderCapacityRecommend — кнопка apply).',
    ] },
    { version: '0.59.401', date: '2026-04-26', items: [
      '🔍 <b>Фильтры моделей АКБ в форме расчёта.</b> Над селектором «Модель АКБ» добавлена строка фильтров: текстовый поиск по поставщику/модели, выпадающие списки «Поставщик» / «Химия» / «V блока» (заполняются из реального справочника), диапазон ёмкости «Ah ≥ … Ah ≤ …», кнопка «Сбросить». Под селектором показывается «Подходит N из M моделей». Раньше при большом каталоге (Kehua + импорт + ручные) пользователь скроллил длинный <select> — теперь ищет по фильтрам.',
      '🔒 <b>Лок V блока / Ёмкости при выборе конкретной модели.</b> Когда в селекторе выбрана конкретная АКБ, поля «Напряжение одного блока» и «Ёмкость блока (fallback)» становятся read-only и подсвечиваются серым (значения берутся из карточки АКБ). Дополнительно V<sub>DC</sub>-шина округляется до ближайшего кратного V блока. При сбросе на «— средняя модель —» поля снова редактируются.',
      '💡 <b>Рекомендация ёмкости АКБ в режиме «Сколько блоков для целевого времени».</b> Зелёный блок над формой считает по энергобалансу: <code>C = (P · t / η<sub>inv</sub>) · K<sub>aging</sub> / (η<sub>chem</sub> · U<sub>DC</sub>)</code>, где K<sub>aging</sub>=1.25 (80% EoL), η<sub>VRLA</sub>≈0.70, η<sub>Li-ion</sub>≈0.93. Показывает требуемые А·ч на цепочку и ближайший стандартный номинал (50/65/75/100/125/150/200/250) — пользователь сразу видит, какой фильтр «Ah ≥» подставить в подбор.',
      '⚠ <b>Условный (экстраполированный) расчёт для запросов вне таблицы разряда производителя.</b> Если запрошенное время автономии короче самой первой точки таблицы (например, пользователь хочет 3 мин, а в таблице первая запись 5 мин), <code>interpTimeByPower</code> теперь линейно экстраполирует значение по двум первым точкам кривой и возвращает <code>{tMin, extrapolated:true}</code>. В <code>calcAutonomy</code> прокидывается флаг <code>extrapolated</code>, в результате расчёта показывается оранжевый блок «⚠ Условный расчёт. Запрошенное время разряда вне таблицы производителя — значение получено линейной экстраполяцией. Не подтверждено производителем.» Раньше такой режим возвращал 0 → «нужно больше блоков», теперь даётся честная оценка с предупреждением.',
      'Файлы: battery/index.html (+24 строки фильтров и блока «Рекомендуемая ёмкость»), battery/battery-calc.js (_calcFilters, _populateCalcFilterOptions, _filterBatteries, _applyBatteryLock, _renderCapacityRecommend, listeners в wireCalcForm, баннеры extrapolated в doCalc), battery/battery-discharge.js (interpTimeByPower → object {tMin, extrapolated} при выходе влево, calcAutonomy прокидывает флаг).',
    ] },
    { version: '0.59.400', date: '2026-04-26', items: [
      '⚡ <b>Интеграция с конфигуратором ИБП (handoff).</b> При запуске <code>battery/?fromUps=1</code> модуль читает <code>raschet.upsHandoff.v1</code> (нагрузка kW, V<sub>DC</sub> min/max, целевая автономия, КПД) и предзаполняет форму расчёта. Сверху сине-фиолетовый баннер с кнопками «Применить → ИБП» / «Отмена». «Применить» сохраняет выбор АКБ в <code>raschet.upsBatteryReturn.v1</code> и закрывает вкладку — wizard ИБП на focus подхватывает результат.',
      '📈 <b>Ось X графика разряда — линейная.</b> До этого использовалось Math.log10 — короткие времена (5–10 мин) визуально слипались возле левой границы. Теперь время по оси равномерно. Ось Y оставлена log (мощность падает на порядки — линейка её сплющит).',
      'Файлы: battery/battery-calc.js (initUpsHandoff ~70 строк, _renderDischargeChart — xOf без log10, подпись оси).',
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Первая версия: разряд АКБ, каталог банков, автономия.'] },
  ],

  'cable': [
    { version: '0.59.142', date: '2026-04-21', items: [
      'Слайдеры Ir/Isd/tsd в блоке «Координация защиты» теперь реально двигают кривую MCCB: раньше передавался только новый In, а форма оставалась стандартной C (отсюда ощущение, что «крутилки не работают»). Теперь через item.settings = {Ir,Isd,tsd,Ii} включается общий <code>shared/tcc-chart.js → tccRelayBandPoints</code> (definite-time по IEC 60255) — тот же код, что в конфигураторе РУ СН. Файл: cable/cable-calc.js (applySettings).',
      'TCC-график переведён в привычный портретный формат (520×640 вместо 650×400): X — ток, 5 декад; Y — время, 7 декад.'
    ] },
    { version: '0.59.141', date: '2026-04-21', items: ['Верхняя граница MCCB поднята с 1600 А до 3200 А: современный MCCB бывает до 3200 А (ABB Tmax T8, Schneider Compact NS). Теперь ACB подсовывается только при In>3200 А. Файлы: cable/cable-calc.js (syncBreakerCurveOptions), shared/calc-modules/phase-loop.js (авто-повышение класса).'] },
    { version: '0.59.140', date: '2026-04-21', items: ['Выпадающий «Характеристика автомата» в расчёте кабельной линии синхронизируется с подобранным номиналом In: MCB (IEC 60898-1, ≤125 А) отключается если In>125 А, MCCB отключается при выходе за его границы. Если пользовательский выбор вышел за физические границы класса — автоматически переключается на корректный. Файл: cable/cable-calc.js (syncBreakerCurveOptions).'] },
    { version: '0.56.12', date: '2026-04-17', items: ['Inline-автомат в таблице кабелей + bulk.'] },
    { version: '0.56.10', date: '2026-04-16', items: ['Фильтр по категории + сортировка столбцов.'] },
    { version: '0.56.7', date: '2026-04-14', items: ['Автоматическое уменьшенное сечение N (IEC 60364-5-52).'] },
    { version: '0.56.3', date: '2026-04-10', items: ['Per-column фильтры + bulk-edit в таблице.'] },
    { version: '0.48.0', date: '2026-01-05', items: ['Каталог типов кабелей (категории).'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Первая версия: расчёт сечений, проверка ΔU, токов КЗ.'] },
  ],

  'psychrometrics': [
    { version: '0.59.90', date: '2026-04-21', items: [
      'Вместо CSS-разворота всего SVG (v0.59.69, transform:rotate(-90deg)) — нормальный выбор формата и ориентации. В заголовке панели «Диаграмма Молье-Рамзина» теперь два селекта: Формат (A4/A3) и Ориентация (Альбомная/Книжная). Габариты SVG вычисляются по реальным мм×PPM (3 px/мм): A4 альбом 891×630, A4 книжн. 630×891, A3 альбом 1260×891, A3 книжн. 891×1260.',
      'Удалена CSS-правилка .psy-chart.rotated с transform:rotate и плашка-notice «hover отключён»: теперь hover/click-mapping и «взять параметры с графика» работают при любой ориентации, т.к. SVG не крутится через CSS.',
      'Состояние сохраняется в localStorage: psy.chartFormat, psy.chartOrient. Старый ключ psy.chartRotate игнорируется.',
      'Файлы: psychrometrics/psychrometrics.js (S.chartFormat/chartOrient, chartPageDims, renderChart читает dims, handler двух селектов), psychrometrics/index.html (два select вместо checkbox, убрана оранжевая плашка-notice), psychrometrics/psychrometrics.css (удалены .rotated/.psy-chart-rotated-note правила).'
    ] },
    { version: '0.59.70', date: '2026-04-21', items: [
      'Главный модуль: нет эффекта на psychrometrics (версия синхронизирована). См. changelog Raschet.'
    ] },
    { version: '0.59.69', date: '2026-04-21', items: [
      'Разворот диаграммы — чекбокс «↻ развернуть диаграмму (t↔d)» в заголовке панели «Диаграмма Молье-Рамзина». Переключает CSS-класс .rotated на контейнере #psy-chart, SVG получает transform: rotate(-90deg) + transform-origin: center. Привычный вид «d горизонтально, t вертикально» (Рамзин) ↔ «t горизонтально, d вертикально» (ASHRAE-стиль, как в референсных скринах). Состояние сохраняется в localStorage (psy.chartRotate).',
      'В развёрнутом виде hover-крестик и клик «взять параметры с графика» отключаются — SVG getBoundingClientRect() возвращает повёрнутый bbox, обратный маппинг пикселей в (W, T) без переписывания даст мусор. Над диаграммой появляется оранжевая плашка-notice с этой подсказкой; снятие галочки возвращает полный интерактив.',
      'Таблица-список процессов как альтернатива карточной панели. Новая кнопка-таб «▦ карточки / ☰ список» в заголовке панели «Связи». В режиме «список» рисуется компактная таблица по образцу referenced-UI (скрины пользователя): «Наименование | Тип процесса | Начальная точка (№, t, φ, L) | Конечная точка (№, t, φ, L) | Q, кВт | qw, кг/ч | ✕». Цветной pill-бейдж типа (P/C/A/S/M/R/X) слева, inline-select (для type/fromIdx/toIdx), остальные параметры read-only (берутся из computeCycle). Выбор вида сохраняется в psy.edgeView.',
      'applyEdgeViewMode() переключает display между #psy-edges (карточки) и #psy-edges-list (таблица) без повторного рендера содержимого — обе панели отрисовываются в renderEdges() параллельно. renderEdgesList() вызывает computeCycle() для получения актуальных t/φ/L/Q/qw и перерисовывается вместе с карточками.',
      'Удаление ребра и смена type/fromIdx/toIdx в таблице-списке вызывают rerenderCycle() — это обновит и таблицу, и карточки, и диаграмму одновременно.',
      'Файлы: psychrometrics.js +applyChartRotate/applyEdgeViewMode/renderEdgesList, +S.chartRotate/S.edgeView с persist в localStorage, +обработчики листа и таб-кнопок; index.html +чекбокс разворота + psy-chart-rotated-note + view-toggle в заголовке связей + #psy-edges-list; psychrometrics.css +.psy-chart.rotated/.psy-chart-rotated-note/.psy-view-btn/.psy-edges-list (header + rows + pill-бейджи типов).'
    ] },
    { version: '0.59.68', date: '2026-04-21', items: [
      'Зоны (помещения) на графовом полотне — прямоугольные подложки под узлы в стиле конструктора схем. Новая панель «Зоны (помещения)» с кнопкой «+ зона» и табличным редактором (цвет, имя, x/y, w/h). На полотне — div .psy-canvas-zone с пунктирной рамкой и полупрозрачной заливкой по цвету зоны; за заголовок перетаскивается, правый-нижний маркер растягивает размер. Зоны не участвуют в расчёте — это чистая визуальная группировка.',
      'Слой зон кладётся ПОД SVG-связями и карточками узлов (z-index 0/1/2) — узлы и стрелки остаются поверх и кликабельны. Цвет зоны задаёт и заливку (α=0.12) и рамку (α=0.7) через hexToRgba().',
      'Демо «ЦОД машзал» получил 4 сразу-готовых зоны: «Улица» (серая, слева), «Вент. камера (приток)» (голубая, верхний ряд), «Машзал ЦОД» (розовая, правый край), «Вент. камера (вытяжка)» (зелёная, нижний ряд). Узлы попадают в свои помещения автоматически по уже подобранной П-образной раскладке.',
      'Persistence: S.zones пишется в psy.cycle.v1 рядом с points/procs. При загрузке восстанавливается _zoneSeq по максимальному id, новые id не конфликтуют с сохранёнными. «Очистить» и загрузка других демо сбрасывают зоны в [].',
      'Архитектурная заметка: зоны = будущие «контейнеры/помещения» в объединённой модели с конструктором схем. Формат {id, name, cx, cy, w, h, color} совместим с rack-config/mdc-config — при слиянии (Phase 10) зоны психрометрики станут теми же зонами планировки, что и в GDM-600.',
      'Файлы: psychrometrics.js +renderZones/renderZonesPanel/attachZoneDrag/attachZoneResize/hexToRgba/wireZonesPanel, +S.zones, migration в loadCycle/saveCycle; index.html +panel зон + #psy-canvas-zones слой; psychrometrics.css +.psy-canvas-zones/.psy-canvas-zone/.psy-canvas-zone-label/.psy-canvas-zone-resize/.psy-zones-panel/.psy-zone-row.'
    ] },
    { version: '0.59.67', date: '2026-04-21', items: [
      'Узлы теперь размещаются на графовом полотне в стиле конструктора схем: абсолютные координаты p.cx/p.cy, перетаскивание мышью за заголовок карточки, SVG-слой со связями между узлами по fromIdx→toIdx. Связи рисуются плавными кривыми Безье с маркером-стрелкой в цвет процесса и круглым бейджем буквы типа (P/C/A/S/M/R/X) на середине. Для M/R дополнительно — пунктир к опорному узлу (граф-ссылка, не основной поток).',
      'Ширина карточки узла зафиксирована (200 px) через .psy-cycle .psy-point { width: 200px }. Подписи и hint-тексты переносятся (word-wrap: break-word, white-space: normal, min-width:0). Больше не вытягивают карточку по ширине при длинных именах.',
      'Сетка-подложка 20×20 px на полотне (для визуальной привязки при ручной раскладке), размер полотна 2400×1200, скроллируется. Координаты узлов сохраняются в localStorage вместе с остальным циклом.',
      'ensurePointLayout() автоматически проставляет cx/cy новым узлам и при загрузке старых сохранённых циклов (сетка 6 × N с шагом 220×260 px). Демо «ЦОД машзал» получил вручную подобранную П-образную раскладку: приточный тракт — верхний ряд, машзал — правый край, вытяжной тракт — нижний ряд.',
      'attachPointDrag() навешивается на каждую карточку при рендере: mousedown на заголовке → drag до mouseup, координаты сохраняются через saveCycle. Клик на крестик удаления или input — drag не запускается.',
      'Архитектурная заметка: модель «узел+ребро» с координатами намеренно делается совместимой с конструктором схем — при будущем объединении узлы психрометрики станут элементами общей схемы с теми же cx/cy, а рёбра — связями.'
    ] },
    { version: '0.59.66', date: '2026-04-21', items: [
      'Новый демо-цикл «ЦОД машзал (IT 200 кВт, рекуп., CRAC)» — реалистичная схема вентиляции/кондиционирования машинного зала ЦОД. 8 узлов, 7 рёбер: улица (-35 °C, 80%) → рекуператор (η=0.6) → догревной калорифер (+18 °C) → смешение со свежим воздухом (α=0.006 = 300/50000) → машзал (IT+люди, +35 °C в гор. коридоре) → CRAC (охл./осуш. до +22 °C, 50%) → вытяжка самотёком 300 м³/ч → рекуператор (отдаёт тепло приточке) → наружу. Расход воздуха 50 000 м³/ч по ASHRAE TC 9.9 (ΔT≈12 °C на стойку для 200 кВт IT). Конденсат на CRAC считается автоматически.',
      'В computeCycle() снято ограничение «ведущий сегмент = только самый первый». Теперь любой узел с явным V задаёт расход своих рёбер — нужно для графов с разными потоками на ветках (300 м³/ч свежего vs 50 000 м³/ч рециркуляции в ЦОД-демо). G_ref по-прежнему используется как fallback, когда у источника ребра V не задан.',
      'cascade() теперь делает 3 прохода вместо одного. Нужно для рёбер R/M, ссылающихся на узлы «ниже по графу» (например, рекуператор 0→1 нуждается в t₆, которая вычисляется рёбрами 3→4→5→6). Первый проход инициализирует, второй и третий — сходятся.',
      'Select «Демо-цикл…» в index.html пополнился опцией «ЦОД машзал».'
    ] },
    { version: '0.59.65', date: '2026-04-21', items: [
      'КРУПНЫЙ РЕФАКТОР: переход к графовой модели цикла. Узлы (точки состояния) и рёбра (процессы) теперь живут в отдельных панелях. Каждое ребро имеет явные поля «от узла» и «к узлу» — произвольная топология: ветвления, рециркуляция, возврат к любому узлу. Раньше процесс i всегда соединял точки (i, i+1) — теперь это только дефолт.',
      'Новая панель «Связи (процессы, рёбра графа)» под узлами, со своей кнопкой «+ связь». Каждая карточка ребра: номер, крест удаления, селекторы «от узла» / «к узлу», тип процесса, Q/qw/V, опорные точки для M/R. Линейный вид полностью сохранён (дефолт — цепочка), но теперь можно добавить отдельное ребро, скажем, 4→2 для рециркуляции.',
      'cascade() и computeCycle() теперь обходят рёбра в топологическом порядке (по fromIdx, потом по toIdx) вместо линейного цикла for i. «Ведущим» сегментом для массового расхода считается первое ребро с V на источнике. V хранится на узле-источнике (логика не менялась). Новая функция edgeOrder() в psychrometrics.js.',
      'renderChart() рисует рёбра и бейджи по fromIdx/toIdx, CSV и таблица процессов показывают `fromI+1→toI+1` вместо `i+1→i+2`. При удалении узла — reindexAfterPointDelete() сдвигает индексы рёбер и удаляет рёбра с «битыми» концами.',
      'Миграция старых сохранённых циклов (localStorage psy.cycle.v1): если у процесса нет fromIdx/toIdx — проставляем (i, i+1). Демо-пресеты тоже автопроставляют индексы при apply().',
      'index.html: контейнер #psy-edges, кнопка #psy-add-edge, изменён заголовок первой панели на «Узлы (точки состояния)» с кнопкой «+ узел» вместо «+ точка».'
    ] },
    { version: '0.59.64', date: '2026-04-21', items: [
      'При охлаждении с осушением (любой процесс, где W₂ < W₁) под стрелкой рядом с полем q_w появляется синяя плашка «💧 Конденсат: X кг/ч ≈ Y л/ч ≈ Z л/сут». Формула тривиальна: конденсат = |q_w| (кг/ч), переводим в литры по плотности воды 998 кг/м³ при 20°C, в сутки ×24. Это важное число для проектирования дренажа охладителей — сразу видно, сколько воды придётся сливать.',
      'В таблице процессов добавлена итоговая строка 💧 «Конденсат (суммарно по осушению)» — sum(|qw|) по всем сегментам с осушением, в трёх единицах (кг/ч, л/ч, л/сут). Показывается только если суммарное осушение > 1 г/ч.',
      'Новая функция fillCondensate(segs) вызывается из update() после fillComputedQW. Плашка автоматически скрывается при qw ≥ 0 (нагрев/увлажнение/адиабата без конденсации).'
    ] },
    { version: '0.59.63', date: '2026-04-21', items: [
      'Параметры точек (t, φ, d, h) больше не печатаются рядом с каждым кружком — они наезжали друг на друга при близких точках (например после калорифера и после увлажнения) и делали график нечитаемым. Теперь возле кружка только крупный номер с белой обводкой, а все параметры собраны в единой легенде «Параметры точек» в правом нижнем углу диаграммы. Новая функция plotLegend() в psychrometrics-chart.js рисует прямоугольную плашку с номером, именем точки и строкой параметров для каждой валидной точки.'
    ] },
    { version: '0.59.62', date: '2026-04-21', items: [
      'Инлайн-предупреждения под каждой стрелкой процесса: оранжевая плашка «⚠ …» появляется, если заявленный тип процесса не согласован с фактическим переходом между точками. Проверки: P (нагрев) требует d=const и t₂≥t₁ — иначе предложит C; C аналогично в обратную сторону; A (адиабат.) требует h=const и d₂≥d₁; S (паровое) требует t=const и d₂≥d₁; R требует d=const, выбранной опорной точки и согласованного знака Δt; M требует опорной точки и α∈[0..1]. Дополнительно: предупреждение о пересечении линии насыщения (φ > φ_max). Всё без блокировки ввода — пользователь видит физическое противоречие, но может оставить как есть (например, сознательно играть с настройками).',
      'Допуски проверок подобраны мягко (0.05 г/кг по d, 0.2 °C по t, 0.3 кДж/кг по h) чтобы не дёргать пользователя на численный шум от каскадного пересчёта. Новый блок data-role="proc-warn" добавлен в procArrow(); обновляется в fillProcWarnings(sts) из пайплайна update().'
    ] },
    { version: '0.59.61', date: '2026-04-21', items: [
      'КРИТИЧНЫЙ ФИКС: на диаграмме реально не было ни точек, ни линий процессов, ни бейджей, ни стрелок — хотя цикл задан и данные посчитаны. Причина: render() в psychrometrics-chart.js возвращал SVG-строку БЕЗ закрывающего тега </svg>. В renderChart() делался svg.replace(\'</svg>\', overlay + \'</svg>\') — но тега не было, replace() не находил цель, и весь overlay (точки, процессы, crosshair, бейджи) молча терялся. Браузер при innerHTML сам дописывал </svg>, поэтому «пустая» сетка с саттурационной кривой всё же рисовалась и создавалась иллюзия работающего графика. Добавлен svg += \'</svg>\' перед return в render() (файл psychrometrics-chart.js:102).'
    ] },
    { version: '0.59.60', date: '2026-04-21', items: [
      'КРИТИЧНЫЙ ФИКС: газовые константы R_да, R_в, M(сух.воздух), M(вода) больше нельзя редактировать. Пропустили флаг readOnly: true в psy-calculators.js — в результате пользователь мог случайно «испортить» константу (например R_да=2874 вместо 287,055) и получить совершенно неверные плотность/удельный объём/расход. Теперь поля отображаются серыми, readonly, с курсором not-allowed.',
      'Диаграмма при пустом цикле (нет ни одной точки с валидными t/φ) показывает явное сообщение «Нет точек — задайте t и φ хотя бы в одной карточке или выберите Демо-цикл» — раньше молча отрисовывалась пустая сетка.'
    ] },
    { version: '0.59.59', date: '2026-04-21', items: [
      'Клик по диаграмме — записывает t и φ в активную карточку точки (та, у которой пульсирует оранжевое кольцо). Быстрый способ «взять точку с графика»: кликнули по карточке для фокуса → кликнули в нужное место диаграммы → точка переехала туда. d и h при этом сбрасываются в auto и пересчитываются от новых t/φ.'
    ] },
    { version: '0.59.58', date: '2026-04-21', items: [
      'На диаграмме: в середине каждого сегмента процесса — кружок-бейдж с буквой типа (P/C/A/S/M/R/X) в цвет процесса. Легко читать последовательность преобразований не глядя на стрелки в панели цикла.'
    ] },
    { version: '0.59.57', date: '2026-04-21', items: [
      'Фокус на карточке точки подсвечивает соответствующий кружок на диаграмме пульсирующим оранжевым кольцом. Позволяет быстро понять «где эта точка на i-d» при редактировании большого цикла. Подсветка снимается при потере фокуса (focusout с задержкой 50 мс — чтобы переход между полями одной карточки не мигал).'
    ] },
    { version: '0.59.56', date: '2026-04-21', items: [
      'Пресеты демо-циклов (selectbox вместо одной кнопки): «Лето: охл./осуш. → доводчик», «Зима: нагрев → адиабат. увлажн.», «Зима + рекуператор» (показывает процесс R с утилизацией тепла вытяжки), «Рециркуляция» (процесс M со смешением). Пресеты сразу конфигурируют нужные процессы и опорные точки (recupWith/mixWith, η, α).'
    ] },
    { version: '0.59.55', date: '2026-04-21', items: [
      'Q и q_w на стрелках процессов теперь авто-заполняются вычисленными значениями, а не показывают placeholder «авто». При любом изменении точки данные процесса пересчитываются сразу в карточке — больше не нужно смотреть в таблицу «Процессы» внизу. Пользовательский ввод по-прежнему побеждает (жёлтое = задано пользователем, зелёное = вычислено), активное поле не перетирается во время редактирования (psychrometrics.js: fillComputedQW в update; psychrometrics.css: правила для data-user="").'
    ] },
    { version: '0.59.54', date: '2026-04-21', items: [
      'Диапазон осей диаграммы настраивается из «Условий объекта»: поля «Диаграмма t_min», «t_max», «d_max». По умолчанию −15…+50 °C и 30 г/кг. Зимние точки (−20, −25) помещаются при расширении. Настройки сохраняются в localStorage вместе с циклом.',
      'Подсказки в пустых точках дополнены: «…либо задайте Q или q_w на стрелке процесса выше» — видно что точку можно определить не только параметрами влажного воздуха, но и мощностью процесса.'
    ] },
    { version: '0.59.53', date: '2026-04-21', items: [
      'Fix: подключён shared/auth.js. Раньше в модуле была кнопка «Войти» без реакции — window.Auth не загружался и хедер падал в гость-режим. Теперь авторизация общая со всеми модулями Raschet (один логин на сайт).'
    ] },
    { version: '0.59.52', date: '2026-04-21', items: [
      'Кнопка «CSV» рядом с «+точка/Демо/Очистить» — экспорт таблиц «Точки» и «Процессы» в CSV (UTF-8 BOM, ; — для Excel-RU). В шапке файла: текущее P, alt, rhMax, V_base. Числа с запятой. Внизу строка «ИТОГО»: нагрев/охлаждение (кВт) и увл/осуш (кг/ч).',
      'Справка обновлена: добавлены разделы про процессы M (смешение) и R (рекуператор) с формулами.'
    ] },
    { version: '0.59.51', date: '2026-04-21', items: [
      'Цикл сохраняется в localStorage (psy.cycle.v1) — alt/P/rhMax/tEvap/vBase и все точки+процессы со всеми user-флагами и timestamp\'ами. Автосохранение на каждое update() с debounce 300 мс. При перезагрузке страницы восстанавливается последнее состояние. Кнопка «Очистить» по-прежнему сбрасывает цикл к одной точке по умолчанию (и тем самым перезаписывает сохранённое).'
    ] },
    { version: '0.59.50', date: '2026-04-21', items: [
      'Итоговая строка в таблице процессов: суммарная мощность нагрева (Q>0, красным) и охлаждения (Q<0, синим), суммарный влагоприток (qw>0, зелёным) и осушение (qw<0, фиолетовым). Подсчёт идёт по всему циклу независимо от количества ступеней.'
    ] },
    { version: '0.59.49', date: '2026-04-21', items: [
      'Рекуператор на графике: траектория d=const (вертикальный сегмент от a.T до b.T по линии W=const). Штриховая связь-опора для процессов M и R — от опорной точки к результирующей точке тем же цветом что и процесс, opacity 0.6. Теперь на i-d-диаграмме видна структура графа: какая точка используется как источник тепла/массы.'
    ] },
    { version: '0.59.48', date: '2026-04-21', items: [
      'Новый тип процесса «R · рекуператор» — сенсибельный теплообмен с опорной точкой цикла (обычно вытяжка). Параметры на стрелке: «обменивать с точкой» (select) и η (КПД по температуре, 0…1). Модель: t₂ = t₁ + η·(t_ref − t₁), W₂ = W₁ (d=const). Это минимальный примитив для типовых схем с утилизацией тепла вытяжки; конденсация на пластинах в текущей модели игнорируется (psychrometrics.js: recupControls + cascade[type==R]; psychrometrics-chart.js: arrow-R #ad1457).'
    ] },
    { version: '0.59.47', date: '2026-04-21', items: [
      'Фикс: изменение Q (или qw) на процессе C/P теперь корректно пересчитывает t₂ на точке-потомке. Раньше при tgt=Q получалось h2 без t2/W2 — forwardPoint возвращал прежнюю точку. Добавлен раздел 3.5: при C/P + только h2 → d=const (сенсибельное), t2 = (h2 − 2501·W₁)/(1.006 + 1.86·W₁). Для C, если полученное t2 ниже точки росы входа, решатель переключается на линию насыщения (Newton по h_sat(t) = h2) — охлаждение с осушением.'
    ] },
    { version: '0.59.46', date: '2026-04-21', items: [
      'КРИТИЧНЫЙ ФИКС: пустое поле d / h трактовалось как «0» из-за того что Number(\'\') === 0 (а не NaN). В результате pointState обнулял W и показывал d=0.00, h=1,006·t. Функция nNum переписана на безопасный парсинг через trim + String → Number с guard на пустую строку.',
      'Вычисленные d и h теперь ОТОБРАЖАЮТСЯ прямо в input-полях карточек точек (раньше показывалось placeholder «авто», а реальные числа были только в нижнем computed-блоке). Новая функция fillComputedDH() в update() пушит st.W·1000 и st.h в p.x / p.h для всех точек, где эти поля не заданы пользователем.'
    ] },
    { version: '0.59.45', date: '2026-04-21', items: [
      'Калькулятор: визуальный индикатор занятости слотов в заголовке каждой группы («2/2», «1/2», …). Зелёный бейдж = заполнено полностью, серый = есть свободные слоты, красный = превышение (shared/calc-widget.js + calc-widget.css: .calc-group-slots).'
    ] },
    { version: '0.59.44', date: '2026-04-21', items: [
      'Калькулятор: фикс логики блокировки 🔒. Locked поля теперь ПРАВИЛЬНО занимают слоты в бюджете группы — суммарно (locked + user) ≤ coreSize. Если coreSize=2 и одно поле залочено, пользователь может ввести максимум ОДНО свежее значение; более старые вводы автоматически понижаются до auto (shared/calc-widget.js: readKnowns, userBudget = coreSize − lockedInGroup).',
      'Защита от over-lock: если пользователь пытается залочить больше полей чем coreSize группы допускает, самый старый locked-слот освобождается и становится user (shared/calc-widget.js: change-handler чекбокса 🔒).'
    ] },
    { version: '0.59.43', date: '2026-04-21', items: [
      'Новый тип процесса «M · смешение с точкой» — массово-взвешенное смешение точки i-1 с произвольной опорной точкой цикла (любой индекс). На стрелке появляются поля «смешать с точкой» (select) и «α (доля i)» — доля по массе сухого воздуха. W и h смешиваются линейно, t восстанавливается из (h, W) = (h − 2501·W)/(1,006 + 1,86·W), φ — по RHfromW. Это минимальный графовый примитив для рециркуляции: можно замкнуть цикл, задав mixWith=0 в конце (psychrometrics.js: mixControls + cascade[type==M]).',
      'Без пользовательского ввода точка больше НЕ копирует предыдущую — показывает «—», чтобы было видно что данных нет.',
      'Смена типа процесса в select теперь вызывает перерисовку стрелки, чтобы поля смешения появлялись/скрывались сразу.',
      'Цвет стрелки M: бирюзовый #00838f (psychrometrics-chart.js: arrow-M marker).'
    ] },
    { version: '0.59.42', date: '2026-04-21', items: [
      'Новый формат: процесс содержит ТОЛЬКО тип (P/C/A/S/X) + опциональные Q (кВт) и qw (кг/ч). На карточке точки — 4 независимых поля: t, φ, d, h. Убраны селект «цель процесса» и отдельное поле значения цели на стрелке (psychrometrics.js: procArrow/pointCard).',
      'Алгоритм «самый свежий ввод побеждает»: у каждого поля отслеживается data-ts. При пересчёте cascade() собирает все пользовательские значения {t,φ,d,h} точки и {Q,qw} входящего процесса, сортирует по ts, и самое свежее становится целью forwardPoint. Остальные поля становятся «auto» и пересчитываются. Позволяет смешанный ввод: задал t на точке → d/φ/h считаются; задал Q на стрелке → t/φ/d/h следующей точки пересчитываются.',
      'pointState расширен: теперь точка может определяться комбинациями (t,φ), (t,d), (t,h) — энтальпия как известный параметр на входной точке поддерживается напрямую.',
      'Высота ↔ давление теперь связаны СИММЕТРИЧНО: правка кПа → пересчёт высоты (обратная формула ISA: h = (1 − (P/P₀)^(1/5,2559))/2,25577·10⁻⁵), правка м → пересчёт кПа. Ведомое поле определяется фокусом (psychrometrics.js: readInputs).',
      'CSS: жёлтая подсветка «ввод пользователя», зелёная «автовычислено» для t/φ/d/h/Q/qw. Подсказка в карточке точки: что задавать.'
    ] },
    { version: '0.59.41', date: '2026-04-21', items: [
      'Калькулятор: газовые константы R<sub>да</sub>=287,055, R<sub>в</sub>=461,495, M<sub>да</sub>=28,9644, M<sub>в</sub>=18,015 теперь read-only и не принимают пользовательский ввод (psy-calculators.js: readOnly:true в FIELDS; shared/calc-widget.js: отдельный режим data-mode="ro", input readonly tabindex=-1, отсутствует чекбокс 🔒, поле исключено из knowns).',
      'Атмосфера (h, P, Pₖ) в калькуляторе стала read-only и синхронизируется из «Условия объекта» главного модуля через calc.setExternalKnowns({h, P, Pk}) (index.html: sync-скрипт на input/change высоты и давления). Убрано дублирование ввода атм. давления.',
      'Исправлено: цель процесса (Q, Δt, φ₂, d₂, h₂, …) теперь ДЕЙСТВИТЕЛЬНО перезаписывает t/φ/d следующей точки. Раньше cascade() сохранял старые *User=true флаги, из-за чего задание Q=5,4 кВт не меняло t₂. Теперь при наличии proc.tgt+tgtVal сбрасываются p.tUser/rhUser/xUser=false и значения перезаписываются вычисленными (psychrometrics.js: cascade() + writeCardsFromState синхронизирует data-user с S).',
      'Crosshair: φ ограничена физическим диапазоном 0…100 %. Выше линии насыщения показывается красная пометка «перенасыщ. (выше φ=100%)», tр скрывается (psychrometrics.js: attachCrosshair).',
    ] },
    { version: '0.59.40', date: '2026-04-21', items: [
      'Диаграмма: перекрестие (crosshair) по курсору с readout t/d/φ/h/ρ/tр в координатах точки под курсором (psychrometrics.js: renderChart хранит X/Y/opts в _chartCtx + attachCrosshair инвертирует масштаб SVG → (W, T) и считает все параметры на лету).',
      'Переключатель «Русские названия параметров» в панели «Условия объекта» (index.html: #psy-ru-names + psychrometrics.js: S.showRuNames с persist в localStorage). При включении подписи показывают SI-обозначение + русское название в скобках (t → «температура», φ → «отн. влажн.», d → «влагосодерж.», h → «энтальпия», ρ → «плотность», tр → «точка росы»).',
      'Подготовка к графовой модели циклов (замыкание на любом этапе, ветвление/смешение потоков, внешний приток/выброс, рекуператоры) — выделено в отдельную итерацию v0.59.41, чтобы не ломать рабочую линейную модель.'
    ] },
    { version: '0.59.39', date: '2026-04-21', items: [
      'Имена точек цикла теперь авто-синхронизируются с предыдущим процессом: P → «После нагревателя», C → «После охл./осуш.», A → «После адиабат. увл.», S → «После пар. увл.», X → «Смешение/переход». Если пользователь сам отредактировал имя — оно сохраняется и больше не перезаписывается.',
      'У каждого процесса между точками появилась «цель процесса»: можно задать любую из величин — t₂, Δt, φ₂, d₂, Δd, h₂, Δh, Q (кВт), qw (кг/ч) — и точка 2 вычислится автоматически от точки 1 с учётом типа процесса (P: d=const, A: h=const, S: t=const, C: d=const или φ=100%, X: смешение). Пока цель не задана — точка 2 вводится пользователем как раньше.',
      'Введена per-field пометка user-ввода (data-user) для полей t, φ, d(override), имя. Если пользователь явно задал значение — cascade не затирает его; если поле «auto» — содержит вычисленное значение процессом. Клик в auto-поле оставляет текущее число, можно редактировать стрелками.'
    ] },
    { version: '0.59.38', date: '2026-04-21', items: ['Единый калькулятор параметров влажного воздуха: одно поле на параметр, все группы (Атмосфера / Состояние / Расход / Константы) связаны через общий solver. Чекбокс 🔒 у каждого поля — фиксация значения (не пересчитывается при вводе в другие). Клик на вычисленное поле не сбрасывает его — можно редактировать с текущего числа (стрелки/ввод). Полный набор параметров: h, P, Pk, t, T, φ, d, W, pв, Pнс, pда, h(энтальпия), tр, tм, v, ρ, mв (г/м³), Cpa, V (факт.), V (НУ), Gда (кг/ч и кг/с), Rда, Rв, Ma, Mv. Добавлен shared/createMultiCalc. Также в редакторе цикла V-поле ведомого сегмента теперь содержит вычисленное значение прямо в input (а не placeholder) — клик и редактирование стрелками начинается с текущего auto-V.'] },
    { version: '0.59.37', date: '2026-04-21', items: ['Сохранение массы сух. воздуха через весь цикл. Если V задан у одного процесса (ведущий) — у остальных V пересчитывается автоматически согласно ρ(t,d) на их входе: V = Gда·(1+W)/ρ. Под полем V ведомых сегментов подпись «авто: NNNN м³/ч (по массе)»; у ведущего — «Gда=XXXX кг/ч». Placeholder ведомых обновляется текущим вычисленным V. Если V не задан нигде — ведущим считается «Базовый расход V» применительно к точке 0. Физически: при нагреве воздух расширяется (ρ падает), объёмный расход растёт; при охлаждении — наоборот.'] },
    { version: '0.59.36', date: '2026-04-21', items: ['Добавлена группа калькуляторов «заполни любые известные → получи неизвестные»: T ↔ K, барометрическое давление P(h) (ISA/ГОСТ 4401-81), плотность воздуха ρ=p·M/(R·T), Pнс (Hyland-Wexler), парциальное давление pв=φ·Pнс, влагосодержание d=621,945·pв/(P−pв), точка росы, мокрый термометр, полное состояние воздуха (любые 2 из t/φ/d → h, tр, tм, v, ρ, pв), тепловая мощность Q=Gда·Δh/3600, влагоприток qw, приведение расхода к нормальным условиям. Виджет shared/calc-widget.js + shared/calc-widget.css — модульный, переиспользуемый в других модулях. Подсветка: жёлтый = введено пользователем, зелёный = вычислено автоматически. Фокус при вводе не сбрасывается.'] },
    { version: '0.59.35', date: '2026-04-21', items: ['Фикс потери фокуса при вводе в карточку точки: inputs больше не пересоздаются на каждый input-event. Обновляется только computed-блок (d/h/ρ/v/tр/tм) in-place. Полная перерисовка цикла — только при структурных изменениях (добавить/удалить точку, Очистить, Демо).'] },
    { version: '0.59.33', date: '2026-04-21', items: ['Переписан с одной точки на полноценный редактор цикла: N точек (до бесконечности) + процесс между соседними (P нагрев / C охлаждение-осушение / A адиабатическое увл. / S паровое увл. / X произвольный). Атмосферное давление автоматически из высоты над у. м. (ISA / ГОСТ 4401-81). Для каждого сегмента считаются Gда, Q (кВт) и qw (кг/ч). Диаграмма рисует все точки и цветные траектории процессов с стрелками (оранжевый/синий/зелёный/фиолет/серый). Ниже — таблица параметров по точкам (t, φ, d, h, ρ, v, tр, tм) и таблица процессов. Панель «Формулы и пояснения» развёрнута: Hyland-Wexler Pws, ASHRAE d/h/v/ρ, психрометрическое уравнение, Q = Gда·Δh/3600, qw = Gда·ΔW. Override d (г/кг) поверх φ. Обновлено shared/module-changelogs.js и psychrometrics/*.'] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.45.0', date: '2025-11-15', items: ['Первая версия: i-d диаграмма, расчёт процессов.'] },
  ],

  'logistics': [
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.40.0', date: '2025-08-15', items: ['Stub модуля логистики.'] },
  ],

  'catalog': [
    { version: '0.59.109', date: '2026-04-21', items: [
      'Предустановка фильтров по URL. При открытии каталога из инспектора узла (кнопка «📋 Выбрать из каталога») теперь сразу применяется фильтр по типу — для rack-потребителя видны только стойки (kind=rack), для кондиционера — только климатическое (kind=climate) и т.д. Раньше catalog игнорировал query-параметры и открывался на полный список (386 позиций).',
      'Поддерживаемые параметры: filterKind (канонический ELEMENT_KINDS или псевдоним rack/pdu/conditioner/hvac/cable), filterSubtype / filterRole (как подсказка для маппинга), filterSearch (или q=…). Маппинг: rack→rack, pdu→pdu, conditioner/hvac→climate, cable→cable-sku и т.д.',
      'consumer.js обновлён: вместо filterKind=consumer (не валидно) отправляет хинт rack/climate/пусто на основе subtype.',
      'Файлы: catalog/catalog.js (IIFE applyUrlFilters перед первым render), js/engine/inspector/consumer.js (сборка query-string).'
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Цены в BOM + контрагенты.'] },
    { version: '0.45.1', date: '2025-11-20', items: ['Первая версия модуля каталога.'] },
  ],

  'elements': [
    { version: '0.59.294', date: '2026-04-23', items: [
      '♻️ Переработка шлейфа НКУ и Junction Box по обратной связи: (1) Dropdown «Питание по входу» с выбором chainedFromId удалён — шлейф теперь определяется автоматически: если на входной порт щита подключено ≥2 линий, этот терминал — узел шлейфа; расширение транзитивное. В инспекторе остаётся инфо-плашка «⛓ Шлейф на входе N». (2) <code>graph.js/tryConnect</code>: к входному порту panel/junction-box теперь можно подключить до 2 линий (было — 1). Для остальных узлов по-прежнему 1. (3) Junction Box возвращён в палитру «НКУ (низкое напряжение)» как отдельный item «Клеммная коробка»; отдельная секция Junction Box удалена. (4) Если у канала junction-box есть защита — в инспекторе появляется чекбокс «вкл» для управления состоянием этого автомата/предохранителя + общий тумблер «🛠 Обслуживание — коробка полностью обесточена». В recalc эти состояния отключают соответствующие кабели (fromN/toN.maintenance, channels[i].closed===false).',
      'Файлы: index.html (пал-секция junction-box удалена, item добавлен в НКУ); js/engine/inspector.js (dropdown удалён, добавлена инфо-плашка + maintenance + per-channel closed toggle); js/engine/constants.js (chainedFromId убрано из DEFAULTS); js/engine/graph.js (tryConnect: inputMax=2 для panel/junction-box); js/engine/recalc.js (авто-детекция chain через ≥2 connections на одном терминале + junction-box maintenance/channel.closed в активности кабеля).',
    ] },
    { version: '0.59.292', date: '2026-04-23', items: [
      '⛓ Daisy-chain НКУ — шлейфовое подключение по входу. В инспекторе щита появилось поле «Питание по входу» с dropdown: «отдельная линия» (по умолчанию) или «от щита X» (из списка НКУ того же напряжения, исключая циклы). При выборе шлейфа текущий щит помечается <code>n.chainedFromId</code>. Recalc: для любого кабеля, у которого приёмник или источник — панель, участвующая в цепочке, sizingCurrent берётся по суммарной нагрузке всей цепочки (simpleDownstream корня). Это гарантирует: один автомат вышестоящего шкафа защищает ВСЕ кабели цепочки; кабели в шлейфе подбираются по наибольшей общей нагрузке. Отмечается флагом <code>c._daisyChain</code>.',
      'Файлы: js/engine/constants.js (+chainedFromId в DEFAULTS.panel), js/engine/inspector.js (+select [data-panel-chain] с анти-цикл фильтром + handler), js/engine/recalc.js (+блок daisy-chain перед selectCable: walk до корня + simpleDownstream + computeCurrentA).',
    ] },
    { version: '0.59.291', date: '2026-04-23', items: [
      '🔧 Junction Box — инспектор. В правой панели для узла junction-box появился редактор: число каналов (1-32, входы=выходы), IP, ток ошиновки, таблица каналов с чекбоксом «защита» + тип (автомат/предохранитель) + ток защиты, редактор перемычек между входами (до защиты). Меняешь N — массив channels[] и bridges[] авто-подрезается/растёт с сохранением существующих значений. Recalc: junction-box теперь walkable как passthrough в downstreamLoadKw / scenarioWalk / sectionCables (аналогично panel/channel). Подбор сечения с учётом защиты канала — в следующем шаге (3b/3c).',
      'Файлы: js/engine/inspector.js (+блок UI для n.type === \'junction-box\' + wire-handlers с ensureChannels, data-jb-* селекторы), js/engine/recalc.js (3 места: +\'junction-box\' в panel|channel-traversal).',
    ] },
    { version: '0.59.290', date: '2026-04-23', items: [
      '🔧 Junction Box — шаг 2/3: узел ставится из палитры. Добавлен DEFAULTS[\'junction-box\'] (inputs=outputs=2, channels[] с per-channel защитой, bridges[] — перемычки входов ДО защиты, ipRating=\'IP54\', capacityA=63). Палитра: новая секция «Клеммная коробка (Junction Box)» зелёного цвета. TAG_PREFIX.junction-box=\'JB\'. TYPE_CATEGORY: «Клеммные коробки». В рендере: иконка 🟩, цвет fill=#f1f8e9 / stroke=#4f7a2c. Логика подбора кабеля с учётом защиты канала — в шаге 3/3.',
      'Файлы: js/engine/constants.js (+DEFAULTS[\'junction-box\'], +TAG_PREFIX), index.html (+pal-type секция), js/engine/inspector.js (+TYPE_CATEGORY), js/engine/render.js (+icon +color).',
    ] },
    { version: '0.59.289', date: '2026-04-23', items: [
      '🆕 Добавлен kind <code>junction-box</code> (клеммная коробка) в ELEMENT_KINDS: category=equipment, pricable=true. Назначение — коробка N-вход → N-выход с клеммным соединением в каждой цепи, опциональным защитным аппаратом (автомат/предохранитель) и перемычками между входами до защиты. Это шаг 1/3 в реализации Junction Box (следующие шаги: kindProps-схема + инспектор, учёт защиты при подборе сечения отходящего кабеля).',
      'Файлы: shared/element-library.js (+junction-box после panel).',
    ] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Редактор Element-library (MVP).'] },
  ],

  'schematic': [
    { version: '0.59.336', date: '2026-04-23', items: [
      '📁 <b>Группировка схем по проектам на главной «Мои схемы».</b> Раньше все схемы лежали плоским списком; теперь они группируются по полю <code>projectId</code> (контекст-проект из <code>shared/project-storage.js</code> — тот же, что в СКС/Шкафах). Внутри каждой группы — заголовок «📁 Имя проекта · N схем» (фиолетовая полоска), без проекта — отдельная группа «📂 Без проекта». Снизу — кнопка «+ Новый проект (контекст)». На карточке схемы добавлен селект «Проект:» (только для владельца) — мгновенно перепривязывает схему к группе. Это первый шаг к параллельной работе нескольких схем в одном проекте (как в СКС: один контекст → несколько шкафов/связей; теперь — один контекст → несколько электрических схем).',
      'Файлы: js/main.js (renderCurrentTab — _renderSchemeCard + grouping by ctxProject), shared/project-storage.js (импорт listProjects/createProject), js/engine/constants.js.',
    ] },
    { version: '0.59.334', date: '2026-04-23', items: [
      '🔗 <b>Бейдж «🔗 N» и запрет × у узлов с подключёнными линиями.</b> Пользователь обнаружил, что в «Неразмещённых» часть коробок доступна к удалению (×), но на самом деле у них остались живые <code>conn</code>/<code>sysConn</code> к другим узлам — если перетащить такую коробку обратно на холст, подключения возвращаются вместе с ней. Удаление из реестра в этот момент оставит сиротские линии. Теперь: (а) в «Неразмещённых» и «Реестре» рядом со значком размещения отображается бейдж <code>🔗N</code> (жёлтый, tooltip «Подключено линий: N. Снимите линии прежде чем удалять»); (б) кнопка × НЕ рендерится у узла, если <code>connCount &gt; 0</code>; (в) в обработчиках × (и в реестре, и в неразмещённых) двойной guard: подсчёт <code>state.conns</code> + <code>state.sysConns</code> по <code>from.nodeId</code>/<code>to.nodeId</code>, при >0 — toast «имеет N подключённых линий — сначала снимите их». Это относится ко всем типам элементов (<code>source/generator/panel/ups/consumer/channel</code>), не только к клеммной коробке.',
      '🗑 <b>× в «Неразмещённых» наконец-то работает.</b> Ранее кнопка рендерилась, но обработчика клика на ней не было — × ничего не делал. Добавлен listener на <code>pal-unplaced-list</code>: <code>click</code> → <code>e.target.closest(.pal-reg-del)</code> → guard (pids=0 и connCount=0) → <code>rsConfirm</code> → <code>deleteNode({hard:true})</code>.',
      '🔎 <b>Фильтр в «Неразмещённых» (симметрично с «Реестром»).</b> Поле поиска + select «Все / Нигде / На других стр.»; state в <code>state._unpFilter</code>. Появляется только при <code>totalUnplaced &gt;= 4</code>. Фильтр-бар теперь корректно прибивается к <code>list.innerHTML</code> и его listeners подключаются; раньше разметка строилась, но в DOM не попадала.',
      'Файлы: js/engine/render.js (_nodeConnCount-helper, conn-badge в renderUnplacedPalette и renderProjectRegistry, live-listeners для #pal-unp-q/#pal-unp-place), js/engine/interaction.js (× handler в unplacedList + conn-guard в обоих delete-handler\'ах), js/engine/constants.js.',
    ] },
    { version: '0.59.333', date: '2026-04-23', items: [
      '🔗 <b>Кнопки +/− у клеммной коробки меняют входы и выходы синхронно.</b> По требованию: клеммник — это пассивный узел 1:1, количество входов обязано совпадать с количеством выходов. Раньше «+» и «−» на карточке <code>panel</code> двигали только <code>n.outputs</code>, из-за чего у <code>switchMode="terminal"</code> появлялись лишние выходы без соответствующих входов (на скриншоте PNL8: 1 цепь, но 2 выходных порта). Теперь в <code>interaction.js</code> ветка обработчика <code>[data-port-add]/[data-port-del]</code> для <code>type==="panel" && switchMode==="terminal"</code> после инкремента/декремента <code>outputs</code> выравнивает <code>inputs = outputs</code> и синхронизирует массивы <code>channelProtection[]</code> (добавляет/отрезает) и <code>channelJumpers[]</code> (отфильтровывает пары, указывающие на удалённые индексы). При удалении дополнительно проверяется, что последний ВХОДНОЙ порт не занят (раньше проверялся только выходной).',
      'Файлы: js/engine/interaction.js (portBtnEl-handler: terminal-aware sync inputs↔outputs), js/engine/constants.js.',
    ] },
    { version: '0.59.332', date: '2026-04-23', items: [
      '🗑 <b>× в «Неразмещённые».</b> Кнопка удаления появляется только у тех элементов, у которых <code>pageIds.length === 0</code> (т.е. «нигде не размещены»). Это избавляет от ходьбы во вкладку «Реестр» для удаления тех восьми коробок со скриншота, которые просто висят в проекте. У элементов, размещённых на других страницах, × не показывается — сначала снять их оттуда. Класс кнопки <code>pal-reg-del</code> уже обрабатывается существующим listener\'ом в interaction.js с confirm-диалогом.',
      '🔎 <b>Фильтр в «Реестре».</b> Над списком — поле поиска (по tag/name/type) и select «Все / Размещённые / Не размещённые». State хранится в <code>state._regFilter</code> (не в localStorage — только на сессию). Live-фильтрация без полного <code>render()</code>: по событию <code>input</code>/<code>change</code> перерисовывается только этот блок (<code>renderProjectRegistry()</code>), фокус возвращается в поле. Когда фильтр активен — рядом счётчик «отфильтрованных / всех».',
      'Файлы: js/engine/render.js (× в renderUnplacedList + filter-bar в renderProjectRegistry), js/engine/constants.js.',
    ] },
    { version: '0.59.331', date: '2026-04-23', items: [
      '🗑 <b>Корректное удаление карточек с холста и из реестра.</b> Правила: (а) удалить карточку с текущего холста можно только если к ней не подключены кабели и patch-link\'и — иначе toast «Сначала снимите кабельные линии…»; (б) хард-удалить из реестра (× в палитре «Реестр») можно только если карточка снята со всех страниц — иначе toast «…сначала снимите его со всех холстов…». Это защищает от образования орфан-кабелей и одновременного удаления общего элемента, который ещё используется на других страницах.',
      '🔄 <b>Фикс: после soft-delete карточка действительно исчезает с холста.</b> Баг: <code>state.js::isOnCurrentPage</code> возвращал <code>true</code> и для <code>pageIds === undefined</code> (legacy), и для <code>pageIds === []</code> (явно «unplaced» после soft-delete). Из-за этого удалённая карточка всё равно рендерилась на текущей странице, и пользователь видел «Delete не работает». Теперь: <code>undefined</code> → legacy-fallback (показывать везде), <code>[]</code> → «не размещён» (не показывать ни на одной странице, только в реестре), <code>[pid, ...]</code> → проверка по явному списку.',
      '🔧 <b>deleteNode вернул возвращаемое значение.</b> Теперь <code>deleteNode()</code> возвращает <code>{ blocked: "has-cables" | "on-pages", softDeleted?, pages? }</code>, чтобы caller мог показать корректный toast. Soft-delete также теперь явно дергает <code>_render/_renderInspector/_notifyChange</code> (раньше был early return без ре-рендера → ещё один источник «не работает»). Hard-delete через <code>{hard:true}</code> проверяет <code>pageIds.length === 0</code>, если нет — возвращает blocked\'on-pages\'.',
      'Файлы: js/engine/graph.js (deleteNode — cable/pages guards + return value), js/engine/state.js (isOnCurrentPage — undefined vs []), js/engine/interaction.js (Delete-key toast + registry × guard), js/engine/constants.js.',
    ] },
    { version: '0.59.330', date: '2026-04-23', items: [
      '🛑 <b>Passthrough-кабель клеммной коробки больше не получает собственного автомата.</b> Если у цепи terminal-коробки нет защиты (<code>channelProtection[i]=false</code>), отходящий кабель помечен <code>_breakerInternalSource="terminal-passthrough"</code> и теперь: (а) в инспекторе кабеля вместо блока «Защитный аппарат» (с типом/номиналом/auto-ручной/мастер) показывается пояснение «Защита — вышестоящий автомат N А» со ссылкой на upstream; (б) на канве бейдж автомата над выходным портом НЕ рисуется; (в) в link-mode (текст над линией) номинал тоже не выводится. Поведение BOM и расчёта кабеля не изменилось (<code>_breakerExcludeFromBom=true</code>, sizing — по максимуму downstream + <code>_breakerAgainstCable</code> предупреждает если upstream In > Iz).',
      '📐 <b>Про длину линии.</b> Пользователь попросил «считать вместе с верхним кабелем». Сделано через semantic: passthrough-кабель и upstream-кабель — это разные сегменты в графе, и SC/vdrop калькулятор (<code>nodeIk</code>, <code>_cableLength</code>) уже проходит цепочку сегмент-за-сегментом, суммируя импедансы и падения. Поэтому складывать длины в один кабель нельзя (был бы двойной счёт); в коде добавлен явный комментарий.',
      'Файлы: js/engine/recalc.js (комментарий о не-агрегации длины), js/engine/render.js (скрытие badge автомата для passthrough на канве и в link-mode), js/engine/inspector/conn.js (альтернативный блок «Защита — вышестоящий автомат»), js/engine/constants.js.',
    ] },
    { version: '0.59.329', date: '2026-04-23', items: [
      '🔁 <b>Миграция terminal при загрузке.</b> В <code>serialization.js</code> добавлен блок: любой <code>panel + switchMode="terminal"</code> при загрузке получает <code>inputs === outputs</code> (берётся max из двух), дозаполняет <code>channelProtection[]</code> до длины N нулями, гарантирует <code>channelJumpers=[]</code>. Legacy <code>channels[].hasProtection</code> от старого <code>junction-box</code> мигрирует в <code>channelProtection[]</code>.',
      '🏷 <b>Подпись узла-коробки.</b> Вместо «N вх / M вых» теперь «N цеп.» + опц. «защ K» (количество цепей с защитой) + «перем M» (количество перемычек). Файл: <code>js/engine/render.js</code>.',
      'Файлы: js/engine/serialization.js, js/engine/render.js, js/engine/constants.js.',
    ] },
    { version: '0.59.328', date: '2026-04-23', items: [
      '🔌 <b>Клеммная коробка — функциональная модель восстановлена.</b> Вход i идёт ровно на выход i (1:1 passthrough), а не «все на все». Количество входов = количество выходов и синхронизируется автоматически при смене «Цепей» в инспекторе. В <code>interaction.js</code> дроп из палитры инициализирует <code>inputs=outputs=2</code>, <code>channelProtection=[false,false]</code>, <code>channelJumpers=[]</code>.',
      '🛡 <b>Защитный аппарат на цепь (per-channel).</b> В инспекторе под списком «Цепи» для каждой цепи i чекбокс «защитный аппарат». При <code>channelProtection[i]=true</code> отходящий кабель защищается ЛОКАЛЬНЫМ автоматом (обычный расчёт). При <code>false</code> — наследует номинал со стороны входа того же канала: <code>_breakerInternal=true</code>, <code>_breakerInternalSource="terminal-passthrough"</code>, <code>_breakerExcludeFromBom=true</code>, <code>_breakerIn</code> = max(<code>_breakerIn</code>) входящих кабелей в той же группе. Это значит: если вышестоящий щит уже дал автомат, отдельный автомат на выходе коробки в BOM не попадает.',
      '🪢 <b>Перемычки между входами (до защиты).</b> В инспекторе чекбоксы <code>1↔2</code>, <code>2↔3</code>, ... — <code>channelJumpers: [[i,j], ...]</code>. Перемычка объединяет входы в одну общую шину (union-find). Все выходы в группе питаются от любого живого входа группы. В recalc.js (ветка <code>switchMode === "terminal"</code>) строится union-find по jumpers, затем для каждого выхода находится группа и все живые входы группы дают питание.',
      '🧵 <b>Шлейф (daisy-chain) по входам для одинакового напряжения.</b> Уже работает через общий механизм chain-terminal: когда на входном порту щита ≥2 связей, recalc.js L.1640-1712 транзитивно объединяет все участники цепи и размер кабеля берётся по <code>maxChainKw = max(simpleDownstream(pid))</code>, защита — одним вышестоящим автоматом. Для этого в <code>graph.js</code> L.229 у panel/junction-box уже <code>inputMax = 2</code>. Теперь, когда клеммная коробка — это panel, она автоматически участвует в этом механизме.',
      'Файлы: js/engine/recalc.js (ветка terminal с union-find + passthrough-защита), js/engine/inspector/panel.js (редактор цепей и перемычек, sync outputs=inputs), js/engine/interaction.js (init channelProtection/channelJumpers при дропе), js/engine/constants.js (0.59.328).',
    ] },
    { version: '0.59.327', date: '2026-04-23', items: [
      '🧹 <b>Исходный junction-box удалён, клеммная коробка = panel + switchMode="terminal".</b> Теперь это один узел с общим инспектором и общими правилами. Палитра: «Клеммная коробка» создаёт обычный <code>panel</code> и сразу ставит <code>switchMode="terminal"</code>. Старые проекты мигрируются автоматически при загрузке (<code>serialization.js</code>): <code>type="junction-box" → type="panel", switchMode="terminal"</code>, сохраняя имя и inputs/outputs.',
      '🙈 <b>Для клеммной коробки скрыты все неприменимые блоки инспектора:</b> (1) кнопка «Сконфигурировать НКУ подробно» (нет автоматов/шин); (2) «Задержки» (<code>hasAVR = sm !== "parallel" && sm !== "terminal"</code>); (3) «Система заземления на выходе» (коробка не преобразует N/PE, проходит сквозь); (4) Ксим / In (А) / Мин./Макс. запас (уже было в v0.59.326).',
      '📝 <b>Заголовок модалки и подпись узла адаптированы:</b> вместо «Параметры НКУ (LV щит)» → «Параметры клеммной коробки». Вместо «In 160 A · Макс: 0 A / 0 kW» под узлом — «Клеммная коробка · N вх / M вых».',
      'TYPE_CATEGORY для пользовательских пресетов очищен от legacy-ключа <code>junction-box</code>. DEFAULTS["junction-box"] временно оставлен (на случай импорта старого JSON до миграции loader\'а).',
      'Файлы: js/engine/inspector/panel.js, js/engine/inspector.js, js/engine/render.js, js/engine/interaction.js, js/engine/serialization.js, index.html.',
    ] },
    { version: '0.59.326', date: '2026-04-23', items: [
      '🧯 <b>Клеммная коробка в dropdown «Тип щита».</b> Новый <code>switchMode = "terminal"</code>. Управляется как обычный щит из общего списка (inspector → Параметры НКУ → Электрика → Тип щита), условия — пассивный узел: все входы проходят на все выходы (логика <code>parallel</code>, но без <code>inputBreakerStates</code> — коробка без автоматов). В панели параметров скрыты поля Ксим, In (А), Мин./Макс. запас — они не применимы. Вместо них подсказка «Клеммная коробка — пассивный узел: только клеммник, без автоматов, Ксим, запаса».',
      'recalc.js: ветка <code>n.switchMode === "parallel"</code> расширена на <code>"terminal"</code> с игнором <code>inputBreakerStates</code> (все входы живые).',
      'Файлы: js/engine/inspector/panel.js (+ option Клеммная коробка + условный рендер полей), js/engine/recalc.js (ветка parallel||terminal).',
    ] },
    { version: '0.59.193', date: '2026-04-22', items: [
      'Главная схема теперь принимает postMessage типа *-config:apply от embedded-конфигуратора (panel/ups/transformer/mv/pdu/mdc/suppression). Из сообщения {type, entry, targetNodeIds} узлы с указанными ID получают n.appliedConfig.<kind> = entry и n.appliedConfigId = entry.id. Собственный n.id и n.tag физического элемента не затрагиваются — конфигурация это отдельный шаблон, а узел на схеме лишь ссылается на него.',
      'mountEmbeddedPicker читает ?targets=id1,id2 из URL и передаёт список target-nodeId в onApply(entry, targets). URL-схема для родителя: configurator/?embedded=1&targets=nid1,nid2,nid3.',
      'Файлы: js/main.js (+applyKinds handler в postMessage-listener); shared/config-sidebar.js (+readTargets в mountEmbeddedPicker); 7× */index.html (onApply(entry, targets) + targetNodeIds в postMessage).',
    ] },
    { version: '0.59.186', date: '2026-04-22', items: [
      '<b>dialog.js самодостаточен</b>: CSS инъектится модулем при первом вызове, больше не зависит от <code>shared/styles/base.css</code> в HTML (страницы <code>catalog/</code>, <code>elements/</code>, <code>schematic/</code>, <code>logistics/</code> и др. её не подключали — раньше rsToast/rsConfirm там бы рендерились без стилей). Добавлен keydown на <code>document</code> (Enter подтверждает rsConfirm без input, Escape отменяет), автофокус на OK-кнопке. Очищены последние нативные вызовы: <code>hub.html</code> (reset layout), <code>configurator3d/index.html</code> (импорт JSON). Файлы: shared/dialog.js, hub.html, configurator3d/index.html.',
    ] },
    { version: '0.59.185', date: '2026-04-22', items: [
      '<b>Финальная зачистка нативных <code>alert/confirm/prompt</code> по проекту.</b> Все остальные модули переведены на <code>rsToast/rsConfirm/rsPrompt</code>: catalog (клон/удаление/откат/скрытие/цены/контрагенты/rollback/import-mode — 9 вызовов), logistics (3 удаления), reports (удаление шаблона, импорт, PDF/DOCX ошибки — 5), schematic (text prompt, import err — 2), elements-editor (клон/удаление/добавление/режим импорта — 4), suppression-config (методика/удаление-установки/направления/участка/насадок/аксонометрия/гидравлика/спецификация/MDC-мост — 15), js/main.js (ревизии/проекты/каталог изделий/пресеты/потребители/автофиксы/bulk-edit — 29). В проекте не осталось ни одного вызова <code>alert/confirm/prompt</code>. Файлы: catalog/catalog.js, logistics/logistics.js, reports/reports.js, schematic/schematic.js, elements/elements-editor.js, suppression-config/suppression-config.js, js/main.js.',
    ] },
    { version: '0.59.184', date: '2026-04-22', items: [
      '<b>Конфигурационные модули очищены от нативных <code>alert/confirm/prompt</code>.</b> Переведены на <code>rsToast/rsConfirm/rsPrompt</code>: rack-config (9 вызовов, шаблоны/удаление/дублирование фидов), mv-config (отмена wizard), pdu-config (outlet __custom__), mdc-config (2 alert), transformer-config (delete/save/clearCatalog), panel-config (4: del/save/clear/wiz-cancel), ups-config (6: del/edit/copy/save/clear/wiz-cancel), cable (2 alert в exportReport), battery (6: flash/del/save/clear + 2 в exportReport), shared/app-header (signOut/signIn). Callers приведены к async/await. Файлы: rack-config/rack-config.js, mv-config/mv-config.js, pdu-config/pdu-config.js, mdc-config/mdc-config.js, transformer-config/transformer-config.js, panel-config/panel-config.js, ups-config/ups-config.js, cable/cable-calc.js, battery/battery-calc.js, shared/app-header.js.',
    ] },
    { version: '0.59.183', date: '2026-04-22', items: [
      '<b>Engine полностью очищен от нативных alert/confirm/prompt.</b> Заменено на <code>rsToast/rsConfirm/rsPrompt</code> из <code>shared/dialog.js</code>: custom-systems управление (добавление параметра, удаление системы, создание новой) в <code>inspector.js</code>, сохранение узла как изделия и как preset\'а — все переведены в async. «Требуемая мощность» и «Название типа потребителя» в <code>consumer.js</code> — через <code>rsPrompt</code>. Подтверждение удаления ноды перенесено из <code>graph.js</code> в caller (<code>interaction.js</code> палитра-×) с inline-модалкой. Keyboard Delete на холсте не требует подтверждения (soft-delete в реестр, Ctrl+Z возвращает). Файлы: js/engine/inspector.js, js/engine/inspector/consumer.js, js/engine/graph.js, js/engine/interaction.js.',
    ] },
    { version: '0.59.182', date: '2026-04-22', items: [
      '<b>Единые in-page диалоги</b> (<code>shared/dialog.js</code>): <code>rsToast</code> / <code>rsConfirm</code> / <code>rsPrompt</code> — без нативных <code>alert/confirm/prompt</code>, как этого требует внутренняя политика проекта. Стили в <code>shared/styles/base.css</code> (#rs-ui-host, .rs-toast-*, .rs-modal-*). Легаси-обёртки <code>window.rsToast/rsConfirm/rsPrompt</code> доступны глобально.',
      'Заменены критичные нативные вызовы в engine: patch-link «разные системы» → <code>rsToast(\'warn\')</code> (js/engine/interaction.js:515), «Очистить схему» → <code>rsConfirm</code>, «Сохранить как…» / импорт JSON → <code>rsPrompt/rsToast</code>, ошибки страниц (linked без родителя, удаление единственной) → <code>rsToast/rsConfirm</code>, переименование этажа → <code>rsPrompt</code>. Оставшиеся prompt/confirm в <code>inspector.js</code>/<code>consumer.js</code>/<code>graph.js</code> — задача следующей итерации (требуют перевода callers в async).',
    ] },
    { version: '0.59.181', date: '2026-04-22', items: [
      'Resizable-сайдбары распространены: <code>rack-config</code> (правый превью), <code>mdc-config</code> (левый опросник), <code>suppression-config</code> (и левая форма, и правая сводка), <code>pdu-config</code> (левая форма). Все через <code>.rs-sidebar[.-left/-right]</code> + <code>.rs-sidebar-resizer</code>; ширина единая на проект через CSS-переменные <code>--rs-sidebar-left-w / --rs-sidebar-right-w</code> + localStorage (<code>raschet.rs-sidebar-left-w / -right-w</code>).',
    ] },
    { version: '0.59.180', date: '2026-04-22', items: [
      'Resizable-сайдбары во всех подпрограммах: <code>shared/sidebar-resizer.js</code> (универсальный) + CSS-переменные + localStorage. Применено в <code>scs-config/rack.html</code> (левый «Шкафы», правый «Каталог+Тележка+Склад»).',
      'Fix: intra-rack drag-n-drop юнита в пустой U не срабатывал — SVG-карта потеряла класс <code>sc-unitmap-svg</code>, pointermove.closest() не находил родителя. Класс возвращён в <code>renderUnitMap()</code>.',
      'Layout <code>scs-config/rack.html</code> перестроен: центр = карта юнитов + Размещение + СКС-матрица + Проверки + BOM; правый сайдбар = Каталог + Тележка + Склад; левый = шкафы проекта.',
    ] },
    { version: '0.59.145', date: '2026-04-21', items: [
      'Patch-link pending-подсветка: раньше жёлтое кольцо вокруг первого выбранного кружка-коннектора навешивалось прямо на DOM (setAttribute stroke/stroke-width) и слетало при любом последующем render() — например, при drag\'е другого узла или notifyChange. Теперь подсветка вычисляется в render.js по state.sysPending и переживает все перерисовки. Файлы: js/engine/render.js (ветка b.count коннекторов — +isPending +class sys-port-connector--pending +stroke/stroke-width), js/engine/interaction.js (mousedown-handler — после установки sysPending вызывается render() вместо прямой правки DOM).'
    ] },
    { version: '0.59.143', date: '2026-04-21', items: [
      '<b>Patch-link для инфо-портов (продолжение v0.58.86).</b> На страницах со слаботочными системами (data/low-voltage/video) кружки-коннекторы под капсулами-бейджами теперь можно соединять «патчкордом» 1:1. UX: клик по кружку — он подсвечивается жёлтым (pending); клик по второму кружку той же системы — между ними рисуется тонкая изогнутая цветная линия (цвет совпадает с цветом системы: RJ45 зелёный, SFP голубой, low-voltage синий, video тёмно-голубой). Повторный клик по занятому кружку удаляет его patch-link. Esc — отменить pending. Правило 1:1 жёсткое: второй patch-link на тот же кружок не создать.',
      'Данные живут в отдельной коллекции <code>state.sysConns: Map</code> (не смешивается с электрическими <code>state.conns</code>), сериализуется в проект. При удалении узла каскадно удаляются все его patch-link\'и. Файлы: js/engine/state.js (+sysConns/sysPending), js/engine/serialization.js (save/load), js/engine/graph.js (cascade delete в deleteNode), js/engine/render.js (+renderSysConns, вызывается после renderNodes — координаты кружков читаются из DOM и сдвигаются на node.x/y), js/engine/interaction.js (click-handler на .sys-port-connector, Esc), app.css (.sys-patch-link / .sys-port-connector hover).'
    ] },
    { version: '0.59.100', date: '2026-04-21', items: [
      'Кабельные каналы ограничены только кабельными системами. Раньше channel считался «универсальным» — `getNodeSystems` возвращал весь SYSTEMS_CATALOG (электрика + трубы + воздуховоды + газ + …), что позволяло задавать на канал свойства механики/HVAC/газа. Теперь channel поддерживает только кабелепроводящие системы: electrical, low-voltage, data, fire, security, video. Трубы, воздуховоды и газ из возможных систем канала исключены — для них своя инфраструктура (лотки/опоры трубопроводов / воздуховодов).',
      'Добавлена экспортируемая константа CABLE_SYSTEMS в constants.js; render.js getNodeSystems фильтрует n.systems канала через CABLE_SYSTEMS (fallback = CABLE_SYSTEMS.slice()); interaction.js в диагностике совместимости эндпоинтов для channel использует тот же набор.',
      'Файлы: js/engine/constants.js (+CABLE_SYSTEMS), js/engine/render.js (getNodeSystems branch для channel), js/engine/interaction.js (sys() helper).'
    ] },
    { version: '0.59.99', date: '2026-04-21', items: [
      'Вкладка «Общее» в модалке потребителя: добавлены две кнопки действий — «⚙ Конфигурировать» (открывает профильный конфигуратор по типу: rack-config для стоек, psychrometrics для кондиционеров, fallback-prompt «задать требования» для остальных — редирект в catalog с reqKw/reqNote) и «📋 Выбрать из каталога» (открывает catalog/ с query-параметрами filterKind/filterSubtype/filterRole/nodeId).',
      'Блокировка при привязке к каталогу (catalogLocked): при выборе изделия из select «Тип потребителя» параметры, зависящие от изделия (demandKw, cos φ, Ки, кратность пуска, запас автомата, кривая), становятся read-only с иконкой 🔒. На «Общее» появляется оранжевый баннер «🔒 Привязано к каталогу: X» с кнопкой «✎ Отвязать и редактировать». Раньше пользователь мог незаметно перекрыть каталожные значения — теперь нужно сознательно отвязать.',
      'Файлы: js/engine/inspector/consumer.js (блок «Подбор изделия» на general-панели; 6 input/select получают disabled по n.catalogLocked; cp-catalog change-handler снимает snapshot и ставит catalogLocked=true; cp-catalog-unlock — снимает флаг).'
    ] },
    { version: '0.59.98', date: '2026-04-21', items: [
      'Модалка «Параметры потребителя» — пересмотрена раскладка: над вкладками остаются только обозначение и имя (read-only, без input-полей), как в заголовке карточки. Редактируемые идентификационные поля (имя, категория, тип, количество, тип группы, серия/loadSpec) перенесены на новую вкладку «📋 Общее». Вкладка «Электрика» содержит только электрические параметры, «Габариты» — размеры. Это совпадает с поведением модалок источника/щита/ИБП, где «Общее» — отдельная вкладка.',
      'Файлы: js/engine/inspector/consumer.js (h3 без edit-полей; 3 tp-tab: general/electrical/geometry; data-panel="general" содержит name/category/catalog/count/groupMode/serial/loadSpec), app.css (удалён .tp-common — больше не используется).'
    ] },
    { version: '0.59.97', date: '2026-04-21', items: [
      'Расчёт кабеля и автомата для group individual — исправлена серьёзная ошибка сайзинга. Для индивидуальной группы с неравными нагрузками (15 / 1 / 3 кВт) каждая параллельная жила раньше получала ток Itotal/N = 29.8/3 = 9.9 А (среднее), тогда как реальный ток жилы, идущей к прибору 15 кВт, равен 23.5 А. Результат — подбирали 5×1.5 мм² и автомат 13 А там, где нужны 6 мм² и 25–32 А.',
      'Теперь для individual-группы Iper = max(I_member_i) среди членов (с учётом cos φ_i и Ки_i каждого). sizingCurrent для selectCable нормируется как maxMember × N (чтобы внутри tryWithParallel Iper = sizingCurrent/N = maxMember). Breaker per-line считается от того же c._groupMaxMemberA. Uniform-группы и одиночные потребители работают как раньше (Itotal/parallel).',
      'Файлы: js/engine/recalc.js (импорт consumerGroupItems; в подборе кабеля — вычисление _groupMaxMemberA и замена sizingCurrent; в блоке автомата — Iper = c._groupMaxMemberA || Itotal/parallel).'
    ] },
    { version: '0.59.96', date: '2026-04-21', items: [
      'Модалка «Параметры потребителя»: идентификационные и топологические поля (имя, категория, тип, количество в группе, тип группы, последовательное соединение, указание нагрузки) вынесены в общий блок .tp-common ВЫШЕ вкладок «Электрика / Габариты». Раньше они жили внутри вкладки «Электрика», что путало — «имя» и «категория» не являются электрическими параметрами. Теперь вкладки отвечают только за свою специализацию (электрика — мощность/напряжение/cosφ/Ки/кривая; габариты — размеры в мм).',
      'Для модалок источника/щита/ИБП ничего не меняется — там тот же принцип уже реализован через авто-wrap в tp-tabs с вкладкой «Общее» (renderGeneralPanel) в inspector.js.',
      'Файлы: js/engine/inspector/consumer.js (div.tp-common обёртка над name/category/catalog/count/groupMode/serial/loadSpec, открытие tp-tabs перенесено ПОСЛЕ общего блока), app.css (.tp-common padding-bottom).'
    ] },
    { version: '0.59.95', date: '2026-04-21', items: [
      'Номинальный и расчётный ток группы (individual-режим) считаются по каждому прибору отдельно — со своим cos φ и своим Ки, с фолбэком на параметры группы. Раньше использовался общий n.cosPhi / n.kUse на всю группу, что искажало ток при смешанных нагрузках (например: двигатель cosφ=0.85 + освещение cosφ=1.0 давали общий 0.92 и завышенный ток; или мотор Ки=0.8 + розетки Ки=0.3 давали среднее 0.55 на всех).',
      'Теперь формула: I = Σ computeCurrentA(P_i × Ки_i × loadFactor, U, cosφ_i, …) — fair-share по приборам.',
      'Файлы: js/engine/electrical.js (consumerNominalCurrent / consumerRatedCurrent — ветки для groupMode=individual через consumerGroupItems).'
    ] },
    { version: '0.59.94', date: '2026-04-21', items: [
      'Пусковой ток группы (individual-режим) считается по сценарию «ступенчатый пуск»: все прочие приборы работают в номинале, стартует один самый тяжёлый со своим inrushFactor. Формула: I_peak = Σ I_nom_i + (inrush_max − 1) × I_nom_max. Раньше применялся плоский n.inrushFactor ко всей группе — что завышало пик, если у членов разные кратности пуска (например, группа «двигатель 5× + освещение 1× + розетка 1×» давала 5× от Σ, а реально пик ≈ Σ + 4·I_двигателя).',
      'Файлы: js/engine/electrical.js (consumerInrushCurrent — ветка для groupMode=individual через consumerGroupItems).'
    ] },
    { version: '0.59.93', date: '2026-04-21', items: [
      'BOM-note для conn-уровневых автоматов, идущих к групповому потребителю в individual-режиме: к имени назначения добавляется пометка «[группа N приб.]». Это помогает не путать конд.-автомат группы с per-line автоматами из начинки щита (panel composition), которые wizard выдаёт на каждого члена группы отдельно.',
      'Файлы: js/engine/bom.js (проход по state.conns в buildBOM — обогащение toNote для групп).'
    ] },
    { version: '0.59.92', date: '2026-04-21', items: [
      'Группа-оболочка → отдельные линии на питающем щите. Раньше группа с 3 разными приборами давала одну отходящую линию «→ Группа · ΣkW» и один автомат. Теперь при построении preload для panel-config wizard каждый прибор группы превращается в свою outgoingLine с именем «ГруппаN — Прибор1/2/3», своим loadKw, cosPhi и curveHint. Wizard получает requirements.outputs=N и рисует N строк автоматов соответствующих номиналов.',
      'panel-config _pcCalcCurrent теперь принимает опциональный cosPhi (раньше был жёстко 0.9). _pcBuildBreakerList использует cosPhi из линии + breakerMarginPct члена + curveHint для подбора (MCB_D для двигателей из каталога, MCB_B для резистивных и т.д.).',
      'Файлы: js/engine/inspector/panel.js (+import consumerGroupItems; ветка isGroupIndividual в preload для outgoingLines), panel-config/panel-config.js (_pcCalcCurrent(kW, voltage, cosPhi?); _pcBuildBreakerList учитывает cosPhi/margin/curveHint из line).',
      'Ограничение: группа по-прежнему физически один узел с одним кабелем от щита. Если нужны реально раздельные кабели — в следующей итерации.'
    ] },
    { version: '0.59.91', date: '2026-04-21', items: [
      'Групповой потребитель (individual) — переделан из плоской таблицы «имя+kW» в карточный UI, где каждый прибор — полноценный потребитель со своими параметрами. Карточка сворачиваемая: по умолчанию видно имя + kW + кнопки (⚙/✕), кнопка ⚙ раскрывает блок с напряжением / фазностью / cos φ / Ки / кратностью пуска / запасом автомата / кривой автомата. Пустые поля наследуются от родителя-группы — чтобы не заполнять каждый раз, если все приборы одинаковые.',
      'Новый хелпер `consumerGroupItems(n)` в electrical.js возвращает массив псевдопотребителей с полным набором параметров и фолбэком на родителя. Готов к использованию panel-wizard/BOM для формирования отдельных линий на щите и своих автоматов на каждый прибор (интеграция в BOM/wizard — следующим шагом).',
      'Миграция прозрачная: старые items {name, demandKw} продолжают работать, просто без дополнительных полей (унаследуются из родителя).',
      'Файлы: js/engine/inspector/consumer.js (items-table → items-body cards; _itemCardHtml builder; _wireCard вместо навешивания на tr; apply-handler читает расширенные поля через readRich), js/engine/electrical.js (+consumerGroupItems).'
    ] },
    { version: '0.59.89', date: '2026-04-21', items: [
      'Футер модуля (фиксированная строка внизу) теперь содержит ссылки «Все программы · Каталог · GitHub» слева — раньше показывалась только версия справа, и пользователи жаловались «футера нет». Работает во всех 12 модулях сразу (shared/module-footer.js).',
      'В главном Конструкторе (корневой index.html) убран mountAppFooter: обычный app-footer с margin-top:32px не вмещается в SPA с body{overflow:hidden;height:100vh}. Ссылки теперь живут в module-footer.',
      'Файлы: shared/module-footer.js (+rs-mfoot-left с linksHtml, justify-content:space-between), index.html (убран mountAppFooter).'
    ] },
    { version: '0.59.88', date: '2026-04-21', items: [
      'Модалки параметров узла (щит / потребитель / источник) больше не «прыгают» по высоте при переключении вкладок Общее / Электрика / Габариты / Системы — закреплён min-height 560px у #panel-params-body / #consumer-params-body / #source-params-body. Контент разной длины теперь уходит в нижний свободный зазор вместо скачка всего окна.',
      'Кнопка «Параметры щита» из вкладки «Электрика» сайдбара теперь открывает модалку сразу на вкладке «Электрика», а не сбрасывает на «Общее». Добавлен публичный setModalActiveTab(nodeId, tab) в inspector.js, проброшен через btn-open-panel-params handler.',
      'Главный Конструктор (корневой index.html) получил общий app-footer с контактами / ссылками — был случайно пропущен при миграции шапки/подвала. Теперь совпадает с остальными 11 модулями.',
      'Файлы: app.css (+min-height для модал-body трёх типов), js/engine/inspector.js (+setModalActiveTab, handler btn-open-panel-params вызывает его перед openPanelParamsModal), index.html (+mountAppFooter в DOMContentLoaded).'
    ] },
    { version: '0.59.87', date: '2026-04-21', items: [
      'Модалка «Параметры НКУ»: Обозначение / Имя больше не дублируются в вкладке «Электрика» — только в «Общее» (где и должны быть идентификаторы). Раньше те же поля были в двух местах.',
      'В «Общее» для щитов (panel) убраны поля «Производитель» и «Выбранное изделие» — для НКУ это не применимо (состав собирается в конфигураторе, а не выбирается как моноблочное изделие). Заголовок секции стал «Конфигурация щита» вместо «Модель изделия».',
      'Кнопка «Конфигуратор НКУ» в вкладке «Общее» теперь передаёт полный контекст узла (nodeId, name, kind, loadKw, inputs, outputs, ip) — wizard открывается сразу в правильном состоянии, а не с нуля. То же для MV-конфигуратора (nodeId, In_A, lockedId).',
      'В «Электрика» добавлен warning-блок «⚠ Конфигурация расходится со схемой»: показывается, если (а) inputs/outputs узла не совпадает с числом автоматов «ввод»/«отход.» в конфигурации, (б) линия на каком-то порту требует больший автомат, чем стоит в конфигурации (c._breakerIn > br.inA). Кликабельная ссылка на wizard, который подхватит актуальные номиналы из схемы.',
      'Файлы: js/engine/inspector/panel.js (убраны tag/name input, hidden-зеркала для старого кода apply; +warn-блок), js/engine/inspector.js (renderGeneralPanel: isPanelNode гейтит Production/ModelRef; кнопка configurator — полные query-params для panel/panelMv).'
    ] },
    { version: '0.59.86', date: '2026-04-21', items: [
      'BOM для начинки щитов: одинаковые автоматы из разных щитов (или нескольких отходящих линий одного щита) теперь агрегируются в одну строку спецификации. Ключ = role+spec («breaker-output|63A MCB_C 4P»), а назначения каждой линии («Ввод от ВРУ», «→ «Сервера»») копятся в столбец «Примечание». Раньше каждая линия давала отдельную BOM-строку, потому что в label уходило per-line имя.',
      'Поле composition теперь содержит три поля: `label` (спец без имени линии, для отображения), `spec` (ключ агрегации, напр. «63A MCB_C 4P»), `purpose` (назначение линии). В spec хранится только техническая подпись — удобно для будущего привязывания к catalog/breaker-seed.',
      'Файлы: panel-config/panel-config.js (composition для breakers), js/engine/bom.js (aggKey = role+spec, note = panel:purpose).'
    ] },
    { version: '0.59.85', date: '2026-04-21', items: [
      'Общий футер (Raschet vX.Y.Z + Журнал изменений) теперь есть на хабе (hub.html) и в 3D-конфигураторе (configurator3d/). Раньше эти две страницы были без футера вообще — пользователь не видел ни версии, ни ссылки на changelog.',
      'Файлы: hub.html, configurator3d/index.html (вставлен `<script type="module">` с mountFooter).'
    ] },
    { version: '0.59.84', date: '2026-04-21', items: [
      'XLSX/CSV спецификация теперь включает начинку щита из panel-config wizard: автоматы, коммерческий и технический учёт, трансформаторы тока, мониторинг, аксессуары. Раньше всё это сохранялось на node.composition, попадало в отчёты (shared/bom.js), но терялось в основном экспорте BOM (engine buildBOM ограничивался одной строкой панели по panelCatalogId).',
      'Классификация по role → разделы BOM: breaker-* → «Автоматы», switch/ats → «АВР / рубильники», meter → «Счётчики», ct → «Трансформаторы тока», monitor → «Мониторинг», accessor → «Аксессуары щита». Одинаковые позиции из разных щитов агрегируются по label (ключ `panel-inline:<section>:<label>`).',
      'Файлы: js/engine/bom.js (buildBOM — новый блок для panel composition).'
    ] },
    { version: '0.59.83', date: '2026-04-21', items: [
      'Импорт JSON теперь толерантен к обоим форматам: (а) «сырая схема» (экспорт через «Экспорт JSON», файлы `__local-backup__*.json` из модалки конфликта) и (б) «Save As»-обёртка `{name, scheme}`. Раньше импорт обёртки молча ломался — deserialize не находил nodes/conns.',
      'После импорта показывается toast «Импортировано из файла»; file-input сбрасывается, чтобы повторный импорт того же файла работал без перезагрузки.',
      'Восстановление из backup: Проект → «Импорт JSON» → выбрать `<project>__local-backup__<ts>.json` из модалки конфликта — применяется к текущему документу как есть.',
      'Файлы: js/engine/export.js (file-input handler — tolerant parse + flash + reset value).'
    ] },
    { version: '0.59.82', date: '2026-04-21', items: [
      'В модалке «Удалённые изменения проекта» добавлена 4-я кнопка «💾 Сохранить локальное в файл» — скачивает текущую локальную схему (getScheme()) как JSON с именем `<project>__local-backup__<ts>.json`. Страховка на случай, если пользователь хочет принять чужую версию, но боится потерять свою.',
      'После backup модалка остаётся открытой — пользователь сам решает, жать Принять удалённые / Оставить локальные. Импорт обратно — через «Импорт JSON» в header проекта (если потребуется восстановить).',
      'Пояснения в тексте модалки: «Принять удалённые — рекомендуется, если разница большая и чужая версия новее». Снижает риск случайно перезаписать актуальную remote-версию пустой локальной.',
      'Файлы: js/main.js (_showRemoteConflictModal — кнопка mrc-backup-local + handler).'
    ] },
    { version: '0.59.77', date: '2026-04-21', items: [
      'Фикс критичного бага: удаление страницы (например, layout/план-схемы) приводило к расползанию элементов на других страницах (электрика и т.п.). Причина: в deletePage() при удалении ТЕКУЩЕЙ страницы n.x/n.y оставались от удалённой страницы, но loadPagePositions() для новой активной страницы не вызывалась. При следующем switchPage saveCurrentPagePositions() записывала эти мусорные координаты в positionsByPage[pages[0].id] — перманентная порча расположения на электрике/других страницах.',
      'Решение: (1) сохраняем позиции текущей страницы ДО мутаций (если она не удаляемая); (2) удаляем записи positionsByPage[deletedPageId] у выживших узлов — чтобы повторное создание страницы с тем же id не «вспоминало» старую раскладку; (3) если удалялась активная страница — явно вызываем loadPagePositions(newCurrentPageId) после переключения, чтобы n.x/n.y соответствовали новой активной странице.',
      'Watchdog для сохранения: кнопка «Сохранение…» больше не висит бесконечно. Если window.Storage.saveProject() не завершилась за 30 секунд (проблемы Firestore/сети) — принудительно бросаем ошибку и показываем toast с причиной. Раньше при подвисании Firestore-запроса UI оставался в saving-состоянии до перезагрузки страницы.',
      'Файлы: js/engine/export.js (deletePage, строки ~443-480); js/main.js (saveCurrent, Promise.race с 30-с таймаутом).'
    ] },
    { version: '0.59.76', date: '2026-04-21', items: [
      'Синхронизация при совместной работе (шаринг проекта): три фикса в subscribeProjectDoc-подписке и _onRemoteProjectChange.',
      '(1) Раньше «окно защиты от собственного echo» было 3 секунды от момента ПЕРЕД началом save-а (`state.lastLocalWriteAtMs`). Если save затягивался (> 3 s из-за медленной сети / большого scheme / Firestore-задержки), наш же snapshot возвращался уже за пределами окна — и ложно триггерил conflict-модалку. Теперь окно расширено до 10 секунд И дополнительно учитывается `state.saving === true` — пока наш save не завершился, любой snapshot считается echo. После save `lastLocalWriteAtMs` обновляется ещё раз — пост-save echo теперь тоже покрывается окном.',
      '(2) Авто-применение remote-схемы (`_onRemoteProjectChange`, ветка «нет локальных правок») могло прибивать состояние пользователя в середине действия: drag узла, растягивание рамки выделения, тянуть новую связь от порта, открытая модалка редактирования. Добавлена проверка `_isUserBusy()` (смотрит `state.pending` / `state.drag` / `state.marquee` + .modal без .hidden). Если busy — remote-snapshot откладывается до момента idle через таймер 3 s (+ подхватится следующим snapshot-ом).',
      '(3) Если в busy-окне прилетает несколько снапшотов подряд — храним только самый свежий (`state._pendingRemoteDoc` перезаписывается) — применится один раз, самая новая версия.',
      'Файл: js/main.js (subscribeProjectDoc callback строки ~291; _onRemoteProjectChange строки ~448; saveCurrent строка ~1022 +обновление lastLocalWriteAtMs после save).'
    ] },
    { version: '0.59.75', date: '2026-04-21', items: [
      'Мастер подбора ИБП теперь работает без предварительного перехода из инспектора узла: кнопка «🧙 Мастер подбора» в toolbar ups-config запускает 3-шаговый wizard в standalone-режиме. Результат (полный `configuration`: capacityKw, moduleInstalled, redundancyScheme, VDC, автономия, composition) сохраняется в raschet.lastUpsConfig.v1.',
      'Инспектор ИБП главной схемы: кнопка «⬇ Применить из Конфигуратора» теперь применяет весь configuration (а не только базовые поля ups-модели). applyUpsModel выставляет type/capacity/eff/cosPhi/VDC, затем сверху накладываются: capacityKw (реальный расчётный из fitInfo), moduleInstalled/Working/Redundant, frameKw, moduleKwRated, moduleSlots, redundancyScheme, batteryVdcMin/Max, batteryAutonomyMin, composition.',
      'Файлы: ups-config/index.html (+btn-wizard-standalone в toolbar); ups-config/ups-config.js (initWizard разбит на launchStandaloneWizard + _openWizard + node-targeted init; _applyConfiguration ветвится по nodeId: pendingUpsSelection vs lastUpsConfig; renderPendingBanner показывает configuration-hint); js/engine/inspector/ups.js (apply-last-config читает last.configuration и накладывает все поля).'
    ] },
    { version: '0.59.74', date: '2026-04-21', items: [
      'ups-config: видимый индикатор standalone-выбора — зелёная плашка под заголовком страницы показывает выбранную модель, ждущую применения в Конструкторе. См. changelog ups-config.'
    ] },
    { version: '0.59.73', date: '2026-04-21', items: [
      'Конфигуратор ИБП: из Hub (без ?nodeId=) открывался просто как справочник — модель можно было посмотреть, но нельзя выбрать. Добавлена кнопка «⬆ Выбрать эту модель» в панели «Выбранная модель» для готовых ИБП (не для frame/module/battery-cabinet). Клик сохраняет модель в `localStorage[raschet.lastUpsConfig.v1]`.',
      'В инспекторе ИБП Конструктора схем модалка «Параметры ИБП» теперь проверяет `raschet.lastUpsConfig.v1` и, если запись свежая (< 24 ч), показывает зелёную плашку с именем выбранной модели и двумя кнопками: «⬇ Применить из Конфигуратора» (вызывает applyUpsModel + render + notifyChange) и «✕ Забыть» (удаляет ключ).',
      'Когда ups-config открыт с ?nodeId= (из инспектора ИБП «⚙ Сконфигурировать подробно»), панель «Выбранная модель» показывает кнопку «✓ Применить к узлу на схеме» — прямой канал через старый `raschet.pendingUpsSelection.v1`, вкладка закрывается автоматически.',
      'Файлы: ups-config/ups-config.js (renderSelected — +applyBtnHtml + обработчики); js/engine/inspector/ups.js (+ плашка lastUpsConfig + +обработчики up-apply-last-config / up-clear-last-config).'
    ] },
    { version: '0.59.72', date: '2026-04-21', items: [
      'Reserve-padding под футер теперь выдаётся централизованно через mountFooter() во всех модулях: mountFooter навешивает body.rs-with-mfoot + инжектит CSS `body.rs-with-mfoot { padding-bottom: 32px }`. Это покрывает конструктор схем и все подпрограммы (ups-config, mv-config, rack-config, cable, reports, suppression-config и т.д.) — одним изменением. В app.css правило переехало на body.rs-with-mfoot вместо безусловного body.'
    ] },
    { version: '0.59.71', date: '2026-04-21', items: [
      'Fix: фиксированный module-footer (position:fixed, height:32px) перекрывал нижнюю часть холста — в частности, вкладки страниц (.page-tabs, bottom:0 в #canvas-wrap) и нижний край инспектора. Добавлен padding-bottom:32px в body (app.css ~строка 19). Теперь внутренний layout (flex column: header + main + ничего) заканчивается над футером, вкладки страниц и лист видны полностью.'
    ] },
    { version: '0.59.70', date: '2026-04-21', items: [
      'Fix: ток ИБП показывался 0 А при наличии нагрузки. Причина — две ветки `else if (n.type === \'ups\')` в одном if/else-ladder recalc.js (строки 2269 и 2381): вторая была мёртвым кодом и именно в ней устанавливались _loadA / _cosPhi / _powerP / _powerQ / _powerS. Ветки объединены в одну (около строки 2270), P/Q/cosPhi/loadA/maxLoadA теперь считаются для всех ИБП.',
      'Fix: номинальный ток ИБП на карточке считался по cos φ = 1.0 жёстко — даже для ИБП с выставленным cosPhi 0.9/0.95. Теперь используется n._cosPhi || n.cosPhi || GLOBAL.defaultCosPhi (render.js строка 1688). В результате два ИБП разной мощности с одинаковой нагрузкой теперь показывают одинаковый ток нагрузки (I = P/(√3·U·cosφ)) и разные номинальные токи (зависят от capacityKw).',
      'Fix: также _loadA / _maxLoadA / _maxLoadKw явно сбрасываются в 0 в начале recalc (строка ~885) — раньше они могли остаться от предыдущего прохода, если узел в этом проходе не попал ни в одну ветку калькулятора.',
      'UI: модалка «Параметры ИБП» — секция ручного ввода получила явный заголовок «Ручной ввод параметров» с пояснением, что ниже можно заполнить всё вручную без справочника / конфигуратора. Для модульного ИБП добавлена жёлтая подсказка: мощность считается автоматически из frame/модулей/резерва, для прямого ввода — переключить тип на «Моноблок».',
      'Файлы: js/engine/recalc.js (reset +_loadA/_maxLoadA/_maxLoadKw; объединена UPS-ветка на ~строке 2270; удалена duplicate на ~2381); js/engine/render.js (строка 1688 cosPhi); js/engine/inspector/ups.js (секция «Ручной ввод параметров»).'
    ] },
    { version: '0.56.12', date: '2026-04-17', items: ['Таблица кабелей: inline-автомат, bulk, CSV, фильтры, сорт.'] },
    { version: '0.56.0', date: '2026-04-18', items: ['Справка во всех 12 модулях; палитра НКУ / РУ СН.'] },
    { version: '0.55.5', date: '2026-03-28', items: ['TCC hover-crosshair; полосы IEC 60898.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Селективность защиты: амплитуда + время.'] },
    { version: '0.44.0', date: '2025-10-10', items: ['Element-library + schemas + MVP editor.'] },
  ],

  'reports': [
    { version: '0.56.0', date: '2026-04-18', items: ['Справка модуля.'] },
    { version: '0.50.0', date: '2026-02-10', items: ['Первая версия генератора отчётов.'] },
  ],
};
