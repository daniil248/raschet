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
import './nbu-ua.js';            // НБ Украины (Phase 22.6)
import './nbrb-by.js';           // НБ Беларуси (Phase 22.6)
import './frankfurter.js';       // ECB через Frankfurter.app
import './exchangerate-host.js'; // open.er-api.com (USD base, fallback)
