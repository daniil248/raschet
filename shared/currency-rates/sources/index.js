// =============================================================================
// shared/currency-rates/sources/index.js — реестр плагинов источников
// =============================================================================
// Side-effect imports — каждый плагин при загрузке регистрируется через
// register() в shared/currency-rates/index.js.
//
// Чтобы добавить новый источник: создайте файл `<name>.js` с register({...})
// и добавьте сюда `import './<name>.js'`.

import './nbk-rk.js';            // Национальный банк РК (default)
import './cbr-rf.js';            // ЦБ РФ
import './frankfurter.js';       // ECB через Frankfurter.app
import './exchangerate-host.js'; // exchangerate.host (USD base)
