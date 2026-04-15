// ======================================================================
// shared/calc-modules/index.js
// Точка входа единого реестра расчётных модулей. Импортируй это
// вместо отдельных файлов — модули автоматически зарегистрируются
// при первой загрузке, и listModules()/runModules() вернут их все.
//
//   import { runModules, listModules } from '../shared/calc-modules/index.js';
//
// Если нужна более тонкая настройка — импортируй registry.js напрямую
// и регистрируй подмножество модулей.
// ======================================================================

import { registerModule, runModules, listModules, getModule } from './registry.js';
import { ampacityModule }     from './ampacity.js';
import { vdropModule }        from './vdrop.js';
import { economicModule }     from './economic.js';
import { shortCircuitModule } from './short-circuit.js';
import { phaseLoopModule }    from './phase-loop.js';

// Регистрируем в каноническом порядке (order внутри модулей задаёт
// финальную сортировку в отчёте). Порядок регистрации не важен, но
// помогает читать код.
registerModule(ampacityModule);       // mandatory, order 10
registerModule(vdropModule);          // mandatory, order 20
registerModule(economicModule);       // optional,  order 30
registerModule(shortCircuitModule);   // mandatory, order 40
registerModule(phaseLoopModule);      // mandatory, order 50

export { runModules, listModules, getModule };
