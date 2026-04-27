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
}

/** Выйти из проектного режима — adapter'ы возвращаются к default-фабрикам. */
export function teardownProject() {
  for (const b of PROJECT_ADAPTER_BINDINGS) clearAdapter(b.moduleId);
  if (typeof window !== 'undefined') delete window.__raschet_project_pid;
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
