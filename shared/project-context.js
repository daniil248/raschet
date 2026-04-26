// ======================================================================
// shared/project-context.js
// Единый источник правды о «в каком проекте сейчас работаем».
//
// Источник: URL-параметры ?project=<pid>&from=<moduleId>.
// URL — приоритетнее localStorage. Это даёт два режима работы:
//
//   1) «Из проекта» — пользователь кликнул конфигуратор на странице
//      /projects/. URL содержит project=<pid>. Конфигуратор должен
//      показывать ТОЛЬКО элементы этого проекта; «+ Новый» — создаёт
//      запись внутри проекта.
//
//   2) «Прямой вход» — пользователь зашёл напрямую (через /hub.html
//      или закладку). URL без project=. Конфигуратор работает в режиме
//      «библиотека шаблонов»: проектные элементы НЕ видны, создавать
//      их нельзя.
//
// Дополнительно: ?from=<moduleId> формирует «хлебную крошку назад»,
// чтобы при переходе из конфигуратора A в B можно было вернуться в A.
// Стек хранится в sessionStorage (живёт до закрытия вкладки).
// ======================================================================

import { getProject, getActiveProjectId, setActiveProjectId } from './project-storage.js';

const SS_BACK_STACK = 'raschet.projectNav.backStack.v1';
const MAX_STACK = 8;

// ---------------- URL parsing ----------------

/** Текущий project-context, прочитанный из URL. */
export function getProjectContext() {
  let projectId = null, fromModule = null;
  try {
    const sp = new URLSearchParams(location.search);
    projectId = sp.get('project') || null;
    fromModule = sp.get('from') || null;
  } catch {}
  // Если URL содержит project — синхронизируем глобальный «активный проект»,
  // чтобы существующие модули (которые читают getActiveProjectId) видели
  // тот же проект.
  if (projectId && projectId !== getActiveProjectId()) {
    try { setActiveProjectId(projectId); } catch {}
  }
  return {
    projectId,
    fromModule,
    /** есть ли валидный проект в URL */
    hasProjectFromUrl: !!projectId,
    /** проект существует в LS */
    projectExists: !!(projectId && getProject(projectId)),
  };
}

/** Имя модуля по id для подписей в breadcrumb. */
export const MODULE_LABELS = {
  'projects':              'Проекты',
  'schematic':             '⚡ Конструктор схем',
  'cable':                 '🧮 Расчёт кабельной линии',
  'scs-design':            '🔗 Проектирование СКС',
  'scs-config':            '🗄 Компоновщик шкафа',
  'scs-config-inventory':  '📦 Реестр IT-оборудования',
  'facility-inventory':    '🏭 Реестр оборудования объекта',
  'rack-config':           '🗄 Конфигуратор стойки',
  'mv-config':             '⚡ РУ СН',
  'ups-config':            '🔋 Конфигуратор ИБП',
  'panel-config':          '🔌 Конфигуратор щита',
  'pdu-config':            '🔌 Конфигуратор PDU',
  'transformer-config':    '🔄 Конфигуратор трансформатора',
  'mdc-config':            '🏗 Модульный ЦОД',
  'suppression-config':    '🔥 АГПТ',
  'hub':                   '🏠 Программы',
};
export function moduleLabel(id) { return MODULE_LABELS[id] || id || ''; }

// ---------------- URL builders ----------------

/**
 * Построить ссылку на другой модуль с сохранением project-context.
 * @param {string} href — относительный URL модуля (напр. '../scs-config/')
 * @param {Object} opts
 * @param {string} [opts.projectId] — id проекта (если null → не добавляем)
 * @param {string} [opts.fromModule] — id текущего модуля (для back-кнопки)
 */
export function buildModuleHref(href, opts = {}) {
  const { projectId, fromModule } = opts;
  if (!projectId && !fromModule) return href;
  // Сохраняем относительность href: разбираем строку «как есть».
  const [pathPart, hashPart = ''] = String(href).split('#');
  const [path, queryPart = ''] = pathPart.split('?');
  const sp = new URLSearchParams(queryPart);
  if (projectId) sp.set('project', projectId);
  if (fromModule) sp.set('from', fromModule);
  const qs = sp.toString();
  return path + (qs ? '?' + qs : '') + (hashPart ? '#' + hashPart : '');
}

// ---------------- Back-stack (sessionStorage) ----------------

function readStack() {
  try { return JSON.parse(sessionStorage.getItem(SS_BACK_STACK) || '[]'); }
  catch { return []; }
}
function writeStack(arr) {
  try { sessionStorage.setItem(SS_BACK_STACK, JSON.stringify(arr.slice(-MAX_STACK))); }
  catch {}
}

/** Запушить текущую страницу в back-stack (вызывается при init модуля). */
export function pushNavStep({ moduleId, projectId, url }) {
  if (!moduleId) return;
  const stack = readStack();
  const last = stack[stack.length - 1];
  // Не дублируем если последняя запись = эта же страница.
  if (last && last.moduleId === moduleId && last.url === url) return;
  stack.push({ moduleId, projectId: projectId || null, url: url || location.href, at: Date.now() });
  writeStack(stack);
}

/** Получить предыдущий шаг (для back-кнопки). */
export function getPreviousStep() {
  const stack = readStack();
  return stack.length > 1 ? stack[stack.length - 2] : null;
}

/** Очистить стек (например, при возврате на /projects/). */
export function clearNavStack() { writeStack([]); }

// ---------------- Высокоуровневая навигация ----------------

/**
 * Перейти на другой модуль, сохранив project-context.
 * @param {string} href — целевой URL
 * @param {string} fromModule — id текущего модуля
 */
export function navigateToModule(href, fromModule) {
  const ctx = getProjectContext();
  const url = buildModuleHref(href, {
    projectId: ctx.projectId,
    fromModule,
  });
  location.href = url;
}

/**
 * Вернуться на предыдущий модуль из стека или на /projects/ если стек пуст.
 * @param {string} [defaultHref='../projects/'] — куда идти если стека нет
 */
export function navigateBack(defaultHref = '../projects/') {
  const prev = getPreviousStep();
  if (prev && prev.url) {
    // Удаляем текущий шаг и возвращаемся к предыдущему.
    const stack = readStack();
    stack.pop();
    writeStack(stack);
    location.href = prev.url;
    return;
  }
  // Fallback: домашний URL с проектом если он есть.
  const ctx = getProjectContext();
  location.href = ctx.projectId
    ? buildModuleHref(defaultHref, { projectId: ctx.projectId })
    : defaultHref;
}
