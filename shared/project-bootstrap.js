// ======================================================================
// shared/project-bootstrap.js — единая точка входа в проектный режим.
//
// Конфигуратор импортирует ТОЛЬКО shared/data-adapter.js. Если страница
// открыта в проектном режиме (ставит pid через bootstrapProject(pid)),
// project-bootstrap.js ПЕРЕД инициализацией конфигуратора регистрирует
// POR-backed adapter'ы для каждого moduleId.
//
// Использование (из hub.html / projects/index.html / любой entry-page,
// которая открывает конфигуратор внутри проекта):
//
//   <script type="module">
//     import { bootstrapProject } from '../shared/project-bootstrap.js';
//     const pid = new URLSearchParams(location.search).get('project');
//     if (pid) bootstrapProject(pid);
//   </script>
//   <script type="module" src="./rack-config.js"></script>
//
// КОНФИГУРАТОР НЕ ИМПОРТИРУЕТ ЭТОТ ФАЙЛ. Конфигуратор не знает про проекты.
// ======================================================================

import { setAdapter, clearAdapter } from './data-adapter.js';
import { createPorAdapter, createPorDomainAdapter } from './por-adapters.js';
// engine-por-mirror импортируется ленивo в bootstrapProject — engine
// подгружается не на всех страницах (rack-config / scs-config работают
// без engine), а engine-por-mirror импортирует js/engine/state.js.

// Маппинг moduleId → {type|domain}. Каждая запись определяет, как
// проектный слой подменяет adapter для конкретного конфигуратора.
//
// Расширяется по мере миграции конфигураторов на DataAdapter-pattern.
const PROJECT_ADAPTER_BINDINGS = [
  // rack-config работает с POR-объектами type='rack'.
  // По умолчанию update идёт в domains.mechanical (габариты — основной use-case).
  { moduleId: 'rack-config', kind: 'type', type: 'rack', defaultDomain: 'mechanical', useFactory: true },

  // scs-config: список стоек. Те же rack POR-объекты, но дефолтный домен — scs.
  // Чтобы при update(rackId, { contents: [...] }) патч шёл в domains.scs.contents.
  { moduleId: 'scs-config-racks', kind: 'type', type: 'rack', defaultDomain: 'scs' },

  // scs-config: ВСЕ объекты с domain='scs' (включая outlets / patch-panels / kabel).
  { moduleId: 'scs-config-all', kind: 'domain', domain: 'scs' },

  // suppression-config: fire-zones.
  { moduleId: 'suppression-config-zones', kind: 'type', type: 'fire-zone', defaultDomain: 'suppression', useFactory: true },

  // mdc-config: пока без явного binding — будет добавлен при миграции.
];

/**
 * Активировать проектный режим для указанного pid. Подменяет adapter'ы
 * всем зарегистрированным moduleId на POR-backed.
 *
 * Вызывается в HEAD страницы ДО загрузки скриптов конфигуратора.
 */
export function bootstrapProject(pid) {
  if (!pid) return;
  // v0.59.508: при первом bootstrap-е любого pid — мигрируем legacy
  // rack-instances этого проекта в POR (если ещё не мигрировали).
  // Запускается до setAdapter, чтобы adapter увидел уже мигрированные
  // данные. Дедуп по legacyRackId.
  try {
    import('./legacy-rack-migration.js').then(mod => {
      const r = mod.migrateProjectLegacyRacks(pid);
      if (r && r.created > 0) {
        console.info(`[bootstrap] legacy racks for pid=${pid}: +${r.created} POR-объектов`);
      }
    }).catch(() => {});
  } catch {}
  for (const b of PROJECT_ADAPTER_BINDINGS) {
    let adapter = null;
    if (b.kind === 'type') {
      adapter = createPorAdapter(pid, b.type, {
        defaultDomain: b.defaultDomain,
        useFactory:    b.useFactory,
      });
    } else if (b.kind === 'domain') {
      adapter = createPorDomainAdapter(pid, b.domain);
    }
    if (adapter) setAdapter(b.moduleId, adapter);
  }
  if (typeof window !== 'undefined') {
    window.__raschet_project_pid = pid;
  }
  // Engine mirror — активируем только если engine реально загружен на
  // этой странице (window.Raschet есть). Иначе lazy-import упадёт на
  // js/engine/state.js (его нет в rack-config / scs-config / etc.)
  // Ждём DOMContentLoaded, т.к. engine может ещё инициализироваться.
  if (typeof window !== 'undefined') {
    const tryEnableMirror = () => {
      if (!window.Raschet) return false;
      import('./engine-por-mirror.js')
        .then(mod => { try { mod.enableEngineMirror(pid); } catch (e) { console.warn('[bootstrap] engine mirror failed:', e); } })
        .catch(() => {});
      return true;
    };
    if (!tryEnableMirror()) {
      // Если Raschet ещё не появился — подождём.
      const check = setInterval(() => {
        if (tryEnableMirror()) clearInterval(check);
      }, 200);
      setTimeout(() => clearInterval(check), 8000);  // give up after 8s
    }
  }
}

/** Выйти из проектного режима — adapter'ы возвращаются к default-фабрикам. */
export function teardownProject() {
  for (const b of PROJECT_ADAPTER_BINDINGS) clearAdapter(b.moduleId);
  if (typeof window !== 'undefined') delete window.__raschet_project_pid;
  // Снимаем engine mirror если был активен.
  if (typeof window !== 'undefined' && window.RaschetEnginePorMirror) {
    try { window.RaschetEnginePorMirror.disableEngineMirror(); } catch {}
  }
}

/**
 * Зарегистрировать дополнительный binding (например когда внешний
 * модуль/плагин добавляет свой POR-type и хочет, чтобы соответствующий
 * конфигуратор работал в проектном режиме).
 */
export function addProjectAdapterBinding(binding) {
  if (!binding || !binding.moduleId) return;
  PROJECT_ADAPTER_BINDINGS.push(binding);
}

if (typeof window !== 'undefined') {
  window.RaschetProjectBootstrap = { bootstrapProject, teardownProject, addProjectAdapterBinding };
}
