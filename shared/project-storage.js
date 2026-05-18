// shared/project-storage.js
// ============================================================================
// Единая точка доступа к метаданным проектов и проектному неймспейсу LS.
//
// Архитектурная роль:
//   В Raschet 0.59.x данные модулей (схема, СКС, шкафы, IT-реестр) лежат
//   в общих LS-ключах без привязки к проекту. Фаза 1.27 поэтапно переводит
//   их в проектный неймспейс:  raschet.project.<pid>.<module>.<key>.vN.
//
//   Чтобы это было возможно без глобального рефакторинга, все модули
//   должны обращаться к проектным данным через этот адаптер. Прямой
//   доступ к localStorage по-прежнему допустим для ГЛОБАЛЬНЫХ данных
//   (библиотеки / каталоги / настройки UI), но не для проектных.
//
// Почему это важно (ответ на требование пользователя от 2026-04-22):
//   1. «Все данные проекта — в проекте, не в конфигураторах».
//      Конфигуратор (rack-config, mv-config, …) — библиотека шаблонов.
//      Данные конкретного объекта — внутри проекта. Этот адаптер
//      разделяет хранилища физически через префикс ключа.
//   2. «Проектируемый объект vs действующий объект».
//      Проекту ставится статус (draft/planned/installed/operating).
//      Модуль «Управление объектом» оперирует проектами в статусах
//      installed/operating и может жить отдельно от проектировщика.
//   3. «Продавать/деплоить модули отдельно, с возможностью обновления».
//      Модули общаются только через JSON-контракты (schema-version в
//      каждом ключе) — это позволяет:
//      — разместить «Управление объектом» на отдельном сервере;
//      — обновлять модуль по своему циклу, пока версия schema совместима;
//      — обмениваться данными через import/export JSON или backend API,
//        не завися от реализации хранилища.
//      Сейчас транспорт = localStorage. В Фазе 5.5 / 1.28 адаптер
//      переключается на HTTP (Supabase / свой backend) без правок
//      в модулях, пока контракт методов сохраняется.
// ============================================================================

// ---------------- Константы ----------------

// Корень LS-неймспейса всего приложения. ЕДИНАЯ точка истины:
// будущее переименование продукта/проекта = смена ЭТОЙ строки + одноразовая
// LS-миграция старый-префикс → новый (см. RENAME.md). Все построители
// ключей ниже (projectKey, префиксы, sketch, copy/scan) идут через APP_NS,
// поэтому подавляющая часть данных пользователя переезжает автоматически.
// ВАЖНО: schema-id экспортируемого JSON (`raschet.project/1`) — стабильный
// wire-format, НЕ привязан к APP_NS (иначе сломается импорт ранее
// экспортированных файлов). См. exportProject/importProject ниже.
export const APP_NS = 'getools';
const NS = (suffix) => `${APP_NS}.${suffix}`;

// Переименование продукта Raschet → Genesis Engineering Tools (GE Tools).
// Одноразовая идемпотентная LS-миграция префикса (RENAME.md §2): копируем
// `raschet.<rest>` → `<APP_NS>.<rest>` ТОЛЬКО если целевого ключа ещё нет
// (не затираем новые данные). Старые ключи НЕ удаляем — rollback-safe,
// чистка старого префикса — отдельной поздней версией. Выполняется при
// загрузке модуля ПЕРВЫМ (до построителей ключей и нижних backfill-IIFE),
// т.к. весь LS-неймспейс уже читается через APP_NS. Покрывает и сырые
// `raschet.*` литералы (R2-долг) — миграция по строковому префиксу, не
// по коду. Schema-id экспорта (`raschet.project/1`) — стабильный
// wire-format, НАМЕРЕННО не мигрирует (см. exportProject/importProject).
(function _migrateNsFromRaschet() {
  try {
    const OLD = 'raschet';
    if (APP_NS === OLD) return;
    const GUARD = `${APP_NS}.migratedFrom.${OLD}.v1`;
    if (localStorage.getItem(GUARD) === '1') return;
    const oldPrefix = OLD + '.';
    const newPrefix = APP_NS + '.';
    const pairs = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(oldPrefix)) continue;
      const nk = newPrefix + k.slice(oldPrefix.length);
      if (localStorage.getItem(nk) == null) pairs.push([nk, localStorage.getItem(k)]);
    }
    pairs.forEach(([nk, v]) => { try { localStorage.setItem(nk, v); } catch {} });
    localStorage.setItem(GUARD, '1');
    if (pairs.length) {
      console.info(`[project-storage] LS-неймспейс мигрирован raschet→${APP_NS}: ${pairs.length} ключей перенесено (старые сохранены, чистка — позже).`);
    }
  } catch (e) { /* best-effort: не блокируем загрузку приложения */ }
})();

const LS_PROJECTS       = NS('projects.v1');          // массив метаданных
const LS_ACTIVE_PROJECT = NS('activeProjectId.v1');   // id активного

const PROJECT_SCHEMA_VERSION = 1;

// Модули, которые считаются «проектными» — их данные должны жить в
// проектном неймспейсе. Остальные (rack-config/racks, mv-config/library,
// catalog, breakers, prices и т.п.) — ГЛОБАЛЬНЫЕ, не трогаем.
//
// scope = массив префиксов LS-ключей, которые в рамках фаз 1.27.1-1.27.4
// будут переведены в неймспейс. Пока это справочник для миграции.
export const PROJECT_SCOPED_KEYS = [
  // 1.27.1 — СКС
  NS('scs-design.links.v1'),
  NS('scs-design.selection.v1'),
  NS('scs-design.plan.v1'),
  // 1.27.3 — содержимое шкафов и IT-реестр
  'scs-config.contents.v1',
  'scs-config.rackTags.v1',
  'scs-config.inventory.v1',
  // 1.27.3 — не-IT имущество
  'facility-inventory.v1',
  // 1.27.2 — главная схема
  NS('schema.v1'),
];

// ---------------- LS utils ----------------

function loadJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return 'p_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ---------------- CRUD проектов ----------------

export function listProjects() {
  const arr = loadJson(LS_PROJECTS, []);
  return Array.isArray(arr) ? arr : [];
}

export function getProject(id) {
  return listProjects().find(p => p.id === id) || null;
}

export function createProject({ name, description = '', status = 'draft', kind = 'full', ownerModule = null, parentProjectId = null, designation = '', entityKind = null } = {}) {
  const now = Date.now();
  // v0.60.760 (8.0-D / спека «Проект›Конфигурация›Вариант»): тип сущности.
  // 'object' = проект-комплекс (мультидисц., полная карточка);
  // 'discipline' = одна дисциплина (слим-карточка) — конфигурация (есть
  // parentProjectId) либо самостоятельный 1-дисц. проект (нет родителя).
  // Иммутабелен. Если не задан — выводим из kind (sketch⇒discipline,
  // full⇒object), чтобы прежние вызовы не менять (backward-compat).
  const _ek = (entityKind === 'object' || entityKind === 'discipline')
    ? entityKind
    : (kind === 'sketch' ? 'discipline' : 'object');
  const p = {
    id: (kind === 'sketch' ? 's_' : 'p_') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4),
    name: name || (kind === 'sketch' ? 'Мини-проект' : 'Новый проект'),
    description: description || '',
    status, // draft | planned | installed | operating
    kind,   // full — полноценный; sketch — лёгкий мини-проект внутри модуля
    entityKind: _ek, // 'object' | 'discipline' (immutable, спека 8.0)
    ownerModule, // для sketch: какой модуль создал ('scs-design', 'scs-config', ...)
    // v0.59.372: подпроекты внутри родительского проекта. parentProjectId
    // ссылается на full-проект (объект-контейнер). designation — короткий
    // код подпроекта в рамках родителя ('СКС-1', 'PIPING-A' и т.п.) для
    // обозначения в чертежах/обозначениях.
    parentProjectId: parentProjectId || null,
    designation: designation || '',
    schema: PROJECT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  const arr = listProjects(); arr.push(p);
  saveJson(LS_PROJECTS, arr);
  return p;
}

// v0.59.372: подпроекты — sketch-проекты с parentProjectId, привязанные
// к родительскому full-проекту И к семейству модуля. Например, СКС-проект
// внутри парентa «25013_Qarmet Темиртау» — это отдельная сущность с
// собственным обозначением (designation), но scoped LS-данные лежат под
// id подпроекта (не родителя).
// v0.59.565: 3-й параметр { strict: true } — фильтр строго по
// ownerModule===moduleId (без family). Нужно для UI карточки /projects/,
// где плитка «Модульные ЦОД» не должна показывать scs-design подпроекты
// и наоборот, иначе один и тот же sub появлялся бы в нескольких плитках
// (т.к. family включает все 4 модуля семейства).
export function listSubProjects(parentProjectId, moduleId, opts = {}) {
  if (!parentProjectId) return [];
  if (opts.strict) {
    return listProjects().filter(p =>
      p.parentProjectId === parentProjectId &&
      p.kind === 'sketch' &&
      p.ownerModule === moduleId
    );
  }
  const fam = _familyOf(moduleId);
  return listProjects().filter(p =>
    p.parentProjectId === parentProjectId &&
    p.kind === 'sketch' &&
    fam.includes(p.ownerModule)
  );
}

// v0.59.372: создать подпроект внутри родительского. Возвращает созданный
// объект. Имя/обозначение задаёт пользователь; ownerModule = тот модуль,
// откуда был открыт мастер.
export function createSubProject(parentProjectId, moduleId, { name, designation = '' } = {}) {
  const sub = createProject({
    name: name || `Вариант ${moduleId}`,
    description: `Вариант «${designation || moduleId}» внутри проекта ${parentProjectId}.`,
    kind: 'sketch',
    ownerModule: moduleId,
    parentProjectId,
    designation,
  });
  // v0.60.606: подпроект — это работа ВНУТРИ родительского объекта, а не
  // независимый проект «с нуля». Наследуем идентичность площадки из
  // родительского full-проекта: location (правило feedback_project_location —
  // задаётся ОДИН раз на объекте, читается всеми модулями/подпроектами),
  // а также customer/category, чтобы карточка подпроекта и calc-модули
  // (meteo/cooling/ID-диаграмма) не открывались пустыми «со своими новыми
  // данными». Локально (deep-clone) — отвязано от мутаций родителя; правило
  // «менять координаты в модулях нельзя» сохраняется (read-only вниз).
  try {
    const par = parentProjectId ? getProject(parentProjectId) : null;
    if (par) {
      const patch = {};
      if (par.location && typeof par.location === 'object') {
        patch.location = JSON.parse(JSON.stringify(par.location));
      }
      if (par.customer && !sub.customer) patch.customer = par.customer;
      if (par.category && !sub.category) patch.category = par.category;
      if (Object.keys(patch).length) {
        const updated = updateProject(sub.id, patch);
        if (updated) return updated;
      }
    }
  } catch (e) { /* best-effort: подпроект всё равно создан */ }
  return sub;
}

// Мини-проект для модуля — создаёт sketch-проект, привязанный к модулю.
// Используется из scs-design/scs-config чтобы работать автономно без
// обязательного создания полноценного проекта в /projects/.
export function createSketchForModule(moduleId, name) {
  return createProject({
    name: name || `Вариант ${moduleId}`,
    description: `Вариант, созданный из модуля «${moduleId}» для быстрой прикидки без полноценного проекта.`,
    kind: 'sketch',
    ownerModule: moduleId,
  });
}

// v0.59.337: семейства модулей. Mini-проект, созданный в одном модуле
// семейства, должен быть виден во всех остальных — иначе пользователь
// в scs-design создал черновик, перешёл в scs-config и не видит его
// (хотя данные там общие). Каноничный moduleId внутри семейства —
// первый в массиве (используется для фильтрации записи).
const MODULE_FAMILIES = [
  ['scs-design', 'scs-config', 'scs-config-inventory', 'mdc-config'],
  // electric-семейство (главная схема + ИБП/НКУ/MV/PDU/конфигуратор стойки)
  ['schematic', 'panel-config', 'mv-config', 'ups-config', 'pdu-config', 'rack-config'],
];
function _familyOf(moduleId) {
  return MODULE_FAMILIES.find(f => f.includes(moduleId)) || [moduleId];
}

// Все проекты, доступные для активации в данном модуле: все full-проекты
// + sketch-проекты, принадлежащие этому модулю или любому модулю того же
// семейства (см. MODULE_FAMILIES).
export function listProjectsForModule(moduleId) {
  const fam = _familyOf(moduleId);
  return listProjects().filter(p => p.kind !== 'sketch' || fam.includes(p.ownerModule));
}

export function updateProject(id, patch) {
  const arr = listProjects();
  const i = arr.findIndex(p => p.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...patch, updatedAt: Date.now() };
  saveJson(LS_PROJECTS, arr);
  return arr[i];
}

// ===========================================================================
// v0.60.754 — ROADMAP 8.0-A: семантика «выбранный / резервный» ВАРИАНТ.
// Директива Пользователя: под-проект = ВАРИАНТ внутри проекта, как подбор
// холода/ИБП (выбранный ★ + резервный). Это АДДИТИВНЫЙ слой метаданных на
// объекте варианта (поле variantRole в projects.v1) — НЕ трогает namespace
// данных, НЕ мигрирует ничего (нулевой риск; полное слияние namespace —
// отдельный поздний инкремент 8.0-C, если понадобится). Ограничение: в
// рамках (родитель + семейство модуля) ровно один selected и максимум один
// reserve — как isMainVariant single-select в configuration-catalog.
// Отсутствие поля = роль не задана (нейтрально; preserve-on-miss).
// ===========================================================================
export const VARIANT_ROLES = ['selected', 'reserve'];

// Варианты родителя в рамках семейства модуля (sketch с parentProjectId),
// аннотированные ролью; сортировка selected → reserve → прочие (по дате).
export function listVariants(parentProjectId, moduleId) {
  const subs = listSubProjects(parentProjectId, moduleId) || [];
  const rank = (v) => (v === 'selected' ? 0 : (v === 'reserve' ? 1 : 2));
  return subs
    .map(s => ({ ...s, variantRole: VARIANT_ROLES.includes(s && s.variantRole) ? s.variantRole : null }))
    .sort((a, b) => rank(a.variantRole) - rank(b.variantRole) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getVariantRole(subId) {
  const p = subId ? getProject(subId) : null;
  return (p && VARIANT_ROLES.includes(p.variantRole)) ? p.variantRole : null;
}

// Назначить роль варианту. role ∈ 'selected'|'reserve'|null. Single-select
// в рамках (parentProjectId + семейство ownerModule): назначение selected/
// reserve снимает ту же роль с siblings. null — снять роль. Аддитивно,
// preserve-on-miss (прочие поля variant'а не трогаем). Возвращает обновл.
export function setVariantRole(subId, role) {
  const sub = subId ? getProject(subId) : null;
  if (!sub || sub.kind !== 'sketch') return null;
  if (role !== null && !VARIANT_ROLES.includes(role)) return null;
  if (role && sub.parentProjectId) {
    const fam = _familyOf(sub.ownerModule);
    const siblings = listProjects().filter(p =>
      p && p.kind === 'sketch' &&
      p.parentProjectId === sub.parentProjectId &&
      fam.includes(p.ownerModule) &&
      p.id !== sub.id &&
      p.variantRole === role);
    for (const s of siblings) updateProject(s.id, { variantRole: null });
  }
  return updateProject(subId, { variantRole: role });
}

// ===========================================================================
// v0.60.760 — 8.0-D (FR1): тип сущности «Проект › Конфигурация › Вариант».
// Аддитивно; для legacy без поля entityKind — инференс из kind (sketch⇒
// discipline, full⇒object). Конфигурация = discipline + parentProjectId;
// 1-дисциплинарный проект = discipline без родителя; объект = object.
// Только чтение/классификация — namespace данных НЕ трогается (спека FR6).
// 0 потребителей в этом деплое (cache-safe §6a) — UI подключается далее.
// ===========================================================================
export function entityKindOf(p) {
  if (!p || typeof p !== 'object') return 'object';
  if (p.entityKind === 'object' || p.entityKind === 'discipline') return p.entityKind;
  return p.kind === 'sketch' ? 'discipline' : 'object';
}
export function isObjectProject(p) { return entityKindOf(p) === 'object'; }
// Конфигурация: одна дисциплина ВНУТРИ проекта-объекта (есть родитель).
export function isConfiguration(p) {
  return entityKindOf(p) === 'discipline' && !!(p && p.parentProjectId);
}
// Самостоятельный 1-дисциплинарный проект: дисциплина без родителя.
export function isDisciplineProject(p) {
  return entityKindOf(p) === 'discipline' && !(p && p.parentProjectId);
}
// Любая «слим»-сущность (конфигурация ИЛИ 1-дисц. проект) — слим-карточка.
export function isSlimEntity(p) { return entityKindOf(p) === 'discipline'; }
// Каноничная дисциплина сущности (по ownerModule-семейству); object → null.
export function projectDisciplineOf(p) {
  if (!p || entityKindOf(p) !== 'discipline') return null;
  const m = p.ownerModule || null;
  if (!m) return null;
  const fam = _familyOf(m);
  return fam[0] || m;
}

// v0.59.278: копирование проекта. Копирует метаданные (name + «(копия)») и
// ВСЕ scoped-данные (raschet.project.<srcPid>.* → raschet.project.<dstPid>.*).
// Возвращает объект созданного проекта. Не переносит неявные зависимости
// между id внутри данных — например, если в content.v1 есть ссылки на
// id устройств из другого источника, они сохранятся как есть.
// Для rack instances (raschet.project.<pid>.rack-config.instances.v1) при
// копировании генерируются новые inst-* id и ссылки в других scoped-ключах
// (scs-config.contents/matrix/rackTags) автоматически переписываются.
export function copyProject(srcId, { nameSuffix = ' (копия)', kind } = {}) {
  const src = getProject(srcId);
  if (!src) return null;
  const dst = createProject({
    name: (src.name || 'Проект') + nameSuffix,
    description: src.description || '',
    status: 'draft',
    kind: kind || src.kind || 'full',
    ownerModule: src.ownerModule || null,
  });
  // Сканируем LS, собираем все ключи srcPid и записываем под dstPid.
  const srcPrefix = `${APP_NS}.project.${src.id}.`;
  const dstPrefix = `${APP_NS}.project.${dst.id}.`;
  const payload = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(srcPrefix)) {
        payload.push([k.slice(srcPrefix.length), localStorage.getItem(k)]);
      }
    }
  } catch {}
  // Если есть экземпляры стоек — создаём id-карту (inst-* в новом проекте).
  // Ключ `rack-config.instances.v1` обрабатываем первым, чтобы id-map был готов,
  // потом прогоняем остальные ключи через него (замена подстроки безопасна:
  // inst-xxxxxxxx уникален в LS).
  const idMap = {};
  const rest = [];
  payload.forEach(([rel, raw]) => {
    if (rel === 'rack-config.instances.v1' && raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const remapped = arr.map(r => {
            if (!r || !r.id) return r;
            const nid = 'inst-' + Math.random().toString(36).slice(2, 10);
            idMap[r.id] = nid;
            return { ...r, id: nid };
          });
          try { localStorage.setItem(dstPrefix + rel, JSON.stringify(remapped)); } catch {}
        } else {
          try { localStorage.setItem(dstPrefix + rel, raw); } catch {}
        }
      } catch { try { localStorage.setItem(dstPrefix + rel, raw); } catch {} }
    } else {
      rest.push([rel, raw]);
    }
  });
  // Переписать inst-id в остальных scoped-ключах (если они ссылаются).
  rest.forEach(([rel, raw]) => {
    let out = raw;
    if (out && Object.keys(idMap).length) {
      try {
        let s = out;
        for (const [oldId, newId] of Object.entries(idMap)) {
          // regex для точного матча (по кавычкам — все id хранятся как JSON-строки)
          s = s.split(oldId).join(newId);
        }
        out = s;
      } catch {}
    }
    try { localStorage.setItem(dstPrefix + rel, out); } catch {}
  });
  // v0.60.174: копируем sketch'и проекта (другой namespace
  // raschet.sketch.<pid>.*). Sketch-id'ы оставляем — они уникальны в LS,
  // конфликта с другими проектами нет, plus refs внутри sketch'a ссылаются
  // на entity того же проекта (которые могли быть переименованы через idMap).
  // Прогоняем sketch-данные через idMap rack instances для consistency.
  const srcSkPrefix = `${APP_NS}.sketch.${src.id}.`;
  const dstSkPrefix = `${APP_NS}.sketch.${dst.id}.`;
  const skKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(srcSkPrefix)) skKeys.push(k);
    }
  } catch {}
  skKeys.forEach(srcKey => {
    const rel = srcKey.slice(srcSkPrefix.length);
    let raw = localStorage.getItem(srcKey);
    if (raw && Object.keys(idMap).length) {
      try {
        let s = raw;
        for (const [oldId, newId] of Object.entries(idMap)) s = s.split(oldId).join(newId);
        raw = s;
      } catch {}
    }
    try { localStorage.setItem(dstSkPrefix + rel, raw); } catch {}
  });
  updateProject(dst.id, {});
  return dst;
}

// v0.59.242: по умолчанию удаляем и scoped-данные проекта (иначе они
// становятся «бесхозными» в LS). Передать { keepData: true } чтобы только
// убрать метаданные.
export function deleteProject(id, { keepData = false } = {}) {
  let removedKeys = 0;
  if (!keepData) {
    try { removedKeys = clearProjectData(id); } catch {}
  }
  const arr = listProjects().filter(p => p.id !== id);
  saveJson(LS_PROJECTS, arr);
  if (getActiveProjectId() === id) setActiveProjectId(arr[0]?.id || null);
  return { removedKeys };
}

// ---------------- Активный проект ----------------

export function getActiveProjectId() {
  try { return localStorage.getItem(LS_ACTIVE_PROJECT) || null; }
  catch { return null; }
}

export function setActiveProjectId(id) {
  if (id == null) localStorage.removeItem(LS_ACTIVE_PROJECT);
  else localStorage.setItem(LS_ACTIVE_PROJECT, id);
}

export function ensureDefaultProject() {
  const arr = listProjects();
  if (arr.length) {
    // v0.60.106 FIX: возвращать АКТИВНЫЙ проект, а не arr[0]. Раньше при
    // наличии нескольких проектов всегда возвращался первый по списку,
    // даже если getActiveProjectId() указывал на другой → переключение
    // проекта через project-context badge не имело эффекта в модулях,
    // которые делают `_pid = ensureDefaultProject()`.
    const aid = getActiveProjectId();
    if (aid) {
      const cur = arr.find(p => p && p.id === aid);
      if (cur) return cur;
    }
    setActiveProjectId(arr[0].id);
    return arr[0];
  }
  const p = createProject({
    name: 'Проект по умолчанию',
    description: 'Создан автоматически. Содержит все существующие данные СКС, схемы и шкафов до начала проектного неймспейса (Фаза 1.27).',
  });
  setActiveProjectId(p.id);
  return p;
}

// ---------------- Проектный неймспейс (заготовка под 1.27.1+) ----------------

// Ключ для данных модуля в рамках проекта.
// Пример: projectKey('scs-design', 'links.v1') → 'raschet.project.p_x4y2z8.scs-design.links.v1'
export function projectKey(pid, module, key) {
  if (!pid) pid = getActiveProjectId() || 'default';
  return `${APP_NS}.project.${pid}.${module}.${key}`;
}

// Префиксы для startsWith/итерации по LS (вместо сырых `raschet.project.…`
// литералов — R2 + единый rename-seam APP_NS). Байт-идентичны прежним
// литералам: projectPrefix(pid)        === `raschet.project.${pid}.`
//            projectModulePrefix(p,m)  === `raschet.project.${p}.${m}.`
// v0.60.558 — деплой A (только export, потребители НЕ импортируют, см.
// CONTRIBUTING §6a cache-safe); потребители переключаются деплоем B.
export function projectPrefix(pid) {
  if (!pid) pid = getActiveProjectId() || 'default';
  return `${APP_NS}.project.${pid}.`;
}
export function projectModulePrefix(pid, module) {
  if (!pid) pid = getActiveProjectId() || 'default';
  return `${APP_NS}.project.${pid}.${module}.`;
}

// Прозрачное чтение/запись в проектный неймспейс. В 1.27.1 adapter'ы в
// модулях (scs-design и т.д.) вызывают projectLoad/projectSave вместо
// loadJson/saveJson напрямую.
export function projectLoad(pid, module, key, fallback) {
  return loadJson(projectKey(pid, module, key), fallback);
}
export function projectSave(pid, module, key, value) {
  saveJson(projectKey(pid, module, key), value);
  if (pid) updateProject(pid, {}); // bump updatedAt
}

// Sketch'и проекта живут в ОТДЕЛЬНОМ namespace raschet.sketch.<pid>.*
// (не projectKey). Шов владеет этим ключом — потребители (projects/
// project.js и др.) читают список sketch'ей через этот аксессор, а
// не сырым литералом (Фаза 2, минимальный шаг). Всегда массив.
export function loadSketchList(pid) {
  const arr = loadJson(`${APP_NS}.sketch.${pid}.list.v1`, []);
  return Array.isArray(arr) ? arr : [];
}

// ---------------- Export / Import ----------------
// Формат — JSON со schema-версией, чтобы продаваемые отдельно модули
// (Управление объектом и т.п.) могли читать проект независимо от того,
// откуда экспорт (LS / HTTP / backend).

// Сбор всех scoped ключей проекта: сканируем LS по префиксу
// raschet.project.<pid>. и собираем относительные ключи как `<module>.<key>`.
function collectScoped(pid) {
  const scoped = {};
  const prefix = `${APP_NS}.project.${pid}.`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const rel = k.slice(prefix.length); // напр. "scs-design.links.v1"
      const raw = localStorage.getItem(k);
      try { scoped[rel] = JSON.parse(raw); } catch { scoped[rel] = raw; }
    }
  } catch {}
  return scoped;
}

// v0.60.174 (по необходимости — sketch'и не были частью export'а):
// собираем ВСЕ sketch'и проекта (raschet.sketch.<pid>.* — другой namespace!)
// и их refs (raschet.sketch.<pid>.<sid>.refs.v1). Без этого при export+import
// sketch'и теряются и связи с другими модулями обрываются.
function collectSketches(pid) {
  const sketches = {};
  const prefix = `${APP_NS}.sketch.${pid}.`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const rel = k.slice(prefix.length); // "list.v1" / "<sid>.v2" / "<sid>.refs.v1"
      const raw = localStorage.getItem(k);
      try { sketches[rel] = JSON.parse(raw); } catch { sketches[rel] = raw; }
    }
  } catch {}
  return sketches;
}

export function exportProject(id) {
  const p = getProject(id); if (!p) return null;
  const data = {
    // ВНИМАНИЕ: 'raschet.project/1' — стабильный wire-format ID экспортного
    // JSON, НАМЕРЕННО не через APP_NS. Переименование продукта НЕ меняет его,
    // иначе ранее экспортированные пользователями файлы перестанут импор-
    // тироваться. См. RENAME.md.
    schema: 'raschet.project/1',
    exportedAt: Date.now(),
    project: p,
    scoped: collectScoped(p.id),
    // v0.60.174: sketch'и в отдельном поле (другой namespace в LS).
    // Schema-version inline для backward-compat: старые импортёры просто
    // проигнорируют поле sketches.
    sketches: collectSketches(p.id),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function importProject(obj) {
  if (!obj || obj.schema !== 'raschet.project/1' || !obj.project) {
    throw new Error('Не похоже на проект GE Tools (schema ≠ raschet.project/1)');
  }
  // Если id уже есть — создадим новый, чтобы не затирать существующий.
  const existing = getProject(obj.project.id);
  const p = existing
    ? createProject({ name: (obj.project.name || 'Проект') + ' (import)', description: obj.project.description, status: obj.project.status })
    : (() => {
        const arr = listProjects(); arr.push({ ...obj.project, updatedAt: Date.now() });
        saveJson(LS_PROJECTS, arr);
        return obj.project;
      })();
  if (obj.scoped && typeof obj.scoped === 'object') {
    const prefix = `${APP_NS}.project.${p.id}.`;
    for (const [rel, value] of Object.entries(obj.scoped)) {
      try { localStorage.setItem(prefix + rel, JSON.stringify(value)); } catch {}
    }
  }
  // v0.60.174: восстановление sketch'ей (если были экспортированы).
  if (obj.sketches && typeof obj.sketches === 'object') {
    const prefix = `${APP_NS}.sketch.${p.id}.`;
    for (const [rel, value] of Object.entries(obj.sketches)) {
      try { localStorage.setItem(prefix + rel, JSON.stringify(value)); } catch {}
    }
  }
  return p;
}

// Удаляет все scoped-данные проекта (но не метаданные). Использование —
// «очистить проект» в UI. Метаданные удаляются отдельно через deleteProject().
// v0.60.174: также чистим sketch'и проекта (raschet.sketch.<pid>.* — другой
// namespace, не подпадал под общий префикс).
export function clearProjectData(pid) {
  const prefix1 = `${APP_NS}.project.${pid}.`;
  const prefix2 = `${APP_NS}.sketch.${pid}.`;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith(prefix1) || k.startsWith(prefix2))) toRemove.push(k);
  }
  toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  return toRemove.length;
}

// v0.60.607: разовый идемпотентный бэкафилл для подпроектов, созданных
// ДО v0.60.606 (createSubProject тогда не наследовал площадку). Репорт
// Пользователя: «МЦОД-1» внутри проекта Qarmet открывался с пустой
// локацией. Чиним существующие: для sketch с parentProjectId без своей
// location — копируем location (deep) + customer/category из родителя.
// Preserve-on-miss: только пустые поля, заполненные не трогаем (правило
// user-params-sacred). Guard-флаг — чтобы не сканировать на каждый импорт;
// сама операция идемпотентна. Без новых экспортов (single-deploy safe §6a).
(function _backfillSubProjectSiteIdentity() {
  try {
    const GUARD = `${APP_NS}.migrate.subProjSite.v1`;
    if (localStorage.getItem(GUARD) === '1') return;
    const arr = listProjects();
    if (!Array.isArray(arr) || !arr.length) { localStorage.setItem(GUARD, '1'); return; }
    const byId = new Map(arr.map(p => [p.id, p]));
    let changed = 0;
    for (const p of arr) {
      if (!p || p.kind !== 'sketch' || !p.parentProjectId) continue;
      const par = byId.get(p.parentProjectId);
      if (!par) continue;
      if ((!p.location || typeof p.location !== 'object') && par.location && typeof par.location === 'object') {
        p.location = JSON.parse(JSON.stringify(par.location));
        changed++;
      }
      if (!p.customer && par.customer) { p.customer = par.customer; changed++; }
      if (!p.category && par.category) { p.category = par.category; changed++; }
    }
    if (changed) {
      saveJson(LS_PROJECTS, arr);
      console.info(`[project-storage v0.60.607] Бэкафилл площадки подпроектов: ${changed} полей заполнено из родителей.`);
    }
    localStorage.setItem(GUARD, '1');
  } catch (e) { /* best-effort миграция — не блокируем загрузку */ }
})();
