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

const LS_PROJECTS       = 'raschet.projects.v1';          // массив метаданных
const LS_ACTIVE_PROJECT = 'raschet.activeProjectId.v1';   // id активного

const PROJECT_SCHEMA_VERSION = 1;

// Модули, которые считаются «проектными» — их данные должны жить в
// проектном неймспейсе. Остальные (rack-config/racks, mv-config/library,
// catalog, breakers, prices и т.п.) — ГЛОБАЛЬНЫЕ, не трогаем.
//
// scope = массив префиксов LS-ключей, которые в рамках фаз 1.27.1-1.27.4
// будут переведены в неймспейс. Пока это справочник для миграции.
export const PROJECT_SCOPED_KEYS = [
  // 1.27.1 — СКС
  'raschet.scs-design.links.v1',
  'raschet.scs-design.selection.v1',
  'raschet.scs-design.plan.v1',
  // 1.27.3 — содержимое шкафов и IT-реестр
  'scs-config.contents.v1',
  'scs-config.rackTags.v1',
  'scs-config.inventory.v1',
  // 1.27.3 — не-IT имущество
  'facility-inventory.v1',
  // 1.27.2 — главная схема
  'raschet.schema.v1',
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

export function createProject({ name, description = '', status = 'draft' } = {}) {
  const now = Date.now();
  const p = {
    id: uid(),
    name: name || 'Новый проект',
    description: description || '',
    status, // draft | planned | installed | operating
    schema: PROJECT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  const arr = listProjects(); arr.push(p);
  saveJson(LS_PROJECTS, arr);
  return p;
}

export function updateProject(id, patch) {
  const arr = listProjects();
  const i = arr.findIndex(p => p.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...patch, updatedAt: Date.now() };
  saveJson(LS_PROJECTS, arr);
  return arr[i];
}

export function deleteProject(id) {
  const arr = listProjects().filter(p => p.id !== id);
  saveJson(LS_PROJECTS, arr);
  if (getActiveProjectId() === id) setActiveProjectId(arr[0]?.id || null);
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
    if (!getActiveProjectId()) setActiveProjectId(arr[0].id);
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
  return `raschet.project.${pid}.${module}.${key}`;
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

export function exportProject(id) {
  const p = getProject(id); if (!p) return null;
  const data = { schema: 'raschet.project/1', project: p, scoped: {} };
  // Соберём проектные данные. В 1.27.0 это пусто (данные ещё в общих
  // ключах). Начиная с 1.27.1 — будет наполняться.
  for (const prefix of PROJECT_SCOPED_KEYS) {
    const nsKey = projectKey(p.id, '_raw', prefix);
    const v = loadJson(nsKey, null);
    if (v != null) data.scoped[prefix] = v;
  }
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function importProject(obj) {
  if (!obj || obj.schema !== 'raschet.project/1' || !obj.project) {
    throw new Error('Не похоже на проект Raschet (schema ≠ raschet.project/1)');
  }
  // Если id уже есть — сгенерируем новый, чтобы не затирать
  const existing = getProject(obj.project.id);
  const p = existing
    ? createProject({ name: obj.project.name + ' (import)', description: obj.project.description, status: obj.project.status })
    : (() => {
        const arr = listProjects(); arr.push({ ...obj.project, updatedAt: Date.now() });
        saveJson(LS_PROJECTS, arr);
        return obj.project;
      })();
  if (obj.scoped) {
    for (const [prefix, value] of Object.entries(obj.scoped)) {
      saveJson(projectKey(p.id, '_raw', prefix), value);
    }
  }
  return p;
}
