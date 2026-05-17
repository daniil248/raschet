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
export const APP_NS = 'raschet';
const NS = (suffix) => `${APP_NS}.${suffix}`;

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

export function createProject({ name, description = '', status = 'draft', kind = 'full', ownerModule = null, parentProjectId = null, designation = '' } = {}) {
  const now = Date.now();
  const p = {
    id: (kind === 'sketch' ? 's_' : 'p_') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4),
    name: name || (kind === 'sketch' ? 'Мини-проект' : 'Новый проект'),
    description: description || '',
    status, // draft | planned | installed | operating
    kind,   // full — полноценный; sketch — лёгкий мини-проект внутри модуля
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
  return createProject({
    name: name || `Подпроект ${moduleId}`,
    description: `Подпроект «${designation || moduleId}» внутри проекта ${parentProjectId}.`,
    kind: 'sketch',
    ownerModule: moduleId,
    parentProjectId,
    designation,
  });
}

// Мини-проект для модуля — создаёт sketch-проект, привязанный к модулю.
// Используется из scs-design/scs-config чтобы работать автономно без
// обязательного создания полноценного проекта в /projects/.
export function createSketchForModule(moduleId, name) {
  return createProject({
    name: name || `Черновик ${moduleId}`,
    description: `Мини-проект, созданный из модуля «${moduleId}» для быстрой прикидки без полноценного проекта.`,
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
    throw new Error('Не похоже на проект Raschet (schema ≠ raschet.project/1)');
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
