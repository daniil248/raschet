// =============================================================================
// shared/subscriptions.js — v0.60.131 (Phase 44 START)
// =============================================================================
// Управление подписками per-module. Позволяет продавать платформу как
// модульную: пользователь подписывается на нужные модули, остальные
// показываются «🔒 заблокирован — активируйте план».
//
// По запросу Пользователя 2026-05-04: «хочется поддерживать мульти модули
// чтобы подавать подписку на модули».
//
// =============================================================================
// ПРИНЦИПЫ
// =============================================================================
//
// 1. Plan-tiers: free / starter / pro / enterprise — пресеты для типичных
//    клиентов. + 'custom' для индивидуальных конфигураций.
// 2. Per-module override: даже на free-плане можно дополнительно подключить
//    cooling за отдельную плату → modules: ['cooling'].
// 3. Trial: 14-дневный триал любого плана с auto-rollback на free после
//    expiresAt.
// 4. Soft enforcement: модуль показывается в реестре с локом 🔒, прямой URL
//    открывается с upsell-модалкой. НЕ криптографическая защита (это для
//    бизнес-стимула, не security).
// 5. LS-key: raschet.subscription.v1. В будущем — серверная валидация
//    через Firebase Cloud Function.
// 6. **Calc-зависимости включаются АВТОМАТИЧЕСКИ** (по запросу Пользователя
//    2026-05-04: «зависящие модули расчёта должны попадать в доступ
//    автоматически, но без графического отображения»).
//
//    Принцип: модули делятся на 2 категории по полю `kind` в modules.json:
//      - 'ui'        — пользовательский модуль с интерфейсом (карточка
//                       в /modules/index.html, subscription-check, иконка
//                       в hub). Продаётся отдельным SKU.
//      - 'calc-lib'  — pure-calc библиотека без UI (cooling/calc/*,
//                       dgu-config/calc/*, shared/calc-modules/*,
//                       psychro-formulas, и т.д.). НЕ требует подписки —
//                       подключается через ES-import в любом UI-модуле,
//                       которому она нужна. Не показывается в реестре
//                       как отдельная карточка.
//
//    Субscription-check вызывается ТОЛЬКО для kind='ui' модулей при
//    открытии их index.html (через requireModuleAccess). Calc-libs
//    свободно импортируются через ES module — нет проверок на доступ.
//
//    Пример: пользователь подписан на dgu-config (UI). dgu-config
//    использует shared/auto-norm.js (calc-lib) и cooling/calc/psychro-
//    formulas.js (calc-lib). Обе автоматически работают без доп.
//    подписки на cooling.
//
// =============================================================================
// СТРУКТУРА ДАННЫХ
// =============================================================================
//
//   localStorage['raschet.subscription.v1'] = {
//     plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'custom',
//     expiresAt: 1735689600000,    // null = бессрочно
//     modules: ['cooling', 'tech-workspace'],  // override per-module access
//     userId: 'user@email.com',     // для логов
//     activatedAt: 1700000000000,
//   }
// =============================================================================

const LS_KEY = 'raschet.subscription.v1';

/**
 * План-каталог. Описывает что входит в каждый тариф.
 * При появлении новой коммерческой модели — править здесь.
 *
 * Категории:
 *   free       — базовое (одиночные расчёты, без проектного управления).
 *   starter    — малому бизнесу (1 проект, базовые модули).
 *   pro        — полная функциональность кроме enterprise-фич.
 *   enterprise — + Cloud Sync + Org + custom-сценарии.
 *   custom     — только то что в .modules[] (индивидуальные подписки).
 */
export const PLANS = {
  free: {
    label: '🆓 Free',
    price: 0,
    description: 'Одиночные расчёты, без проектов и облачной синхронизации.',
    modules: [
      'cable', 'battery', 'psychrometrics', 'meteo',
    ],
    limits: { projectsCount: 0, cloudSync: false },
  },
  starter: {
    label: '🚀 Starter',
    price: 9900,
    description: 'Для малых проектов: до 3 проектов, базовые конфигураторы.',
    modules: [
      'cable', 'battery', 'psychrometrics', 'meteo',
      'projects', 'schematic', 'ups-config', 'panel-config',
      'transformer-config', 'rack-config',
    ],
    limits: { projectsCount: 3, cloudSync: false },
  },
  pro: {
    label: '⭐ Pro',
    price: 29900,
    description: 'Полная функциональность для подрядчиков и проектных бюро.',
    modules: ['*'],   // все модули
    limits: { projectsCount: -1, cloudSync: true, orgFeatures: false },
  },
  enterprise: {
    label: '🏢 Enterprise',
    price: 79900,
    description: 'Команды и интеграции: Org-уровень, Cloud Sync, custom-сценарии, поддержка.',
    modules: ['*'],
    limits: { projectsCount: -1, cloudSync: true, orgFeatures: true, customWizards: true, support: 'priority' },
  },
  custom: {
    label: '🎯 Custom',
    price: null,    // договорная
    description: 'Индивидуальный набор модулей под задачи заказчика.',
    modules: [],   // override через subscription.modules[]
    limits: { projectsCount: -1, cloudSync: false },
  },
};

/**
 * Прочитать текущую подписку. Возвращает объект или fallback на free.
 */
export function getSubscription() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        // Проверка на истечение
        if (s.expiresAt && s.expiresAt < Date.now()) {
          // Триал/период истёк — fallback на free, но сохраняем history
          return { ...s, plan: 'free', expired: true, originalPlan: s.plan };
        }
        return s;
      }
    }
  } catch {}
  // Default — free
  return { plan: 'free', expiresAt: null, modules: [], activatedAt: Date.now() };
}

/**
 * Сохранить подписку. Используется при активации триала, покупке,
 * админ-override.
 */
export function saveSubscription(sub) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sub || {})); }
  catch (e) { console.warn('[subscription] save failed:', e); }
}

/**
 * Internal-user check (для internalOnly модулей).
 *
 * v0.60.133: По запросу Пользователя 2026-05-04: «часть модулей будут
 * доступны только внутри организации. модули которые дают функциональное
 * преимущество, например модуль проекты не планируется пока делать
 * доступным по подписке, только внутрикорпоративное использование».
 *
 * Internal-flag — отдельный от subscription. Хранится в LS-ключе
 * <code>raschet.internal.v1</code>. Активируется через master-токен или
 * Firebase auth-claim. Ни один subscription-tier не открывает internal-
 * модули — это разделение «продукт vs внутренний инструмент».
 */
const LS_INTERNAL = 'raschet.internal.v1';
const LS_INTERNAL_ROLE = 'raschet.internal.role.v1';

export function isInternalUser() {
  try {
    const v = localStorage.getItem(LS_INTERNAL);
    if (v === '1' || v === 'true') return true;
  } catch {}
  // В будущем (Phase 44.4): server-side check через Firebase auth.users[uid].internal.
  return false;
}
export function setInternalUser(flag) {
  try {
    if (flag) localStorage.setItem(LS_INTERNAL, '1');
    else localStorage.removeItem(LS_INTERNAL);
  } catch {}
}

/**
 * v0.60.133: Роли внутри организации.
 *
 * По запросу Пользователя 2026-05-04: «В модуле Проекты только менеджер
 * проектов или ГИП может создавать проекты».
 *
 * Роли применяются ТОЛЬКО к internal-users (для коммерческих клиентов
 * есть subscription / Phase 41 org-roles owner/admin/member/viewer).
 *
 * Permissions:
 *   canCreateProjects   — создание новых проектов в /projects/
 *   canDeleteProjects   — удаление проектов
 *   canEditEconomics    — изменение тарифа/валюты/НДС в свойствах проекта
 *   canApproveVariants  — утверждение вариантов концепции в TW
 *   canPromoteOrgItems  — promote шаблонов работ / прайсов в org-каталог
 */
export const ROLES = {
  manager: {
    label: '👑 Менеджер проектов',
    description: 'Полный доступ: создание / удаление проектов, утверждение вариантов, экономика, promote в org.',
    permissions: {
      canCreateProjects: true, canDeleteProjects: true,
      canEditEconomics: true, canApproveVariants: true,
      canPromoteOrgItems: true,
    },
  },
  gip: {
    label: '🛠 ГИП',
    description: 'Главный Инженер Проекта: создание / утверждение, экономика, инженерные решения.',
    permissions: {
      canCreateProjects: true, canDeleteProjects: true,
      canEditEconomics: true, canApproveVariants: true,
      canPromoteOrgItems: true,
    },
  },
  engineer: {
    label: '👤 Инженер',
    description: 'Работа в существующих проектах: схемы, расчёты, спецификации. Создание проектов — нет.',
    permissions: {
      canCreateProjects: false, canDeleteProjects: false,
      canEditEconomics: false, canApproveVariants: false,
      canPromoteOrgItems: false,
    },
  },
  viewer: {
    label: '👁 Наблюдатель',
    description: 'Только просмотр. Используется для показа клиентам / суб-подрядчикам.',
    permissions: {
      canCreateProjects: false, canDeleteProjects: false,
      canEditEconomics: false, canApproveVariants: false,
      canPromoteOrgItems: false,
    },
  },
};

/**
 * Текущая роль internal-пользователя. Default 'engineer'.
 * Возвращает null если не internal-user (роли неприменимы).
 */
export function currentRole() {
  if (!isInternalUser()) return null;
  try {
    const r = localStorage.getItem(LS_INTERNAL_ROLE);
    if (r && ROLES[r]) return r;
  } catch {}
  return 'engineer';
}

export function setRole(role) {
  if (!ROLES[role]) throw new Error('[role] unknown role: ' + role);
  try { localStorage.setItem(LS_INTERNAL_ROLE, role); } catch {}
}

/**
 * Проверка permission. Для не-internal users возвращает false для всех
 * permission'ов (роли неприменимы — внешние клиенты управляются через
 * subscription).
 *
 * @param {string} perm — id permission'а из ROLES.*.permissions
 * @returns {boolean}
 */
export function hasPermission(perm) {
  const role = currentRole();
  if (!role) return false;
  return !!ROLES[role]?.permissions?.[perm];
}

/**
 * Имеет ли пользователь доступ к модулю?
 *
 * @param {string} moduleId — id модуля из modules.json
 * @param {object} [moduleManifest] — опционально, manifest-запись для проверки internalOnly
 * @returns {boolean}
 */
export function hasModuleAccess(moduleId, moduleManifest) {
  if (!moduleId) return true;  // пустой id = нет проверки
  // v0.60.133: internal-only модули доступны ТОЛЬКО internal-пользователям.
  // Никакой subscription-tier их не открывает.
  if (moduleManifest && moduleManifest.internalOnly) {
    return isInternalUser();
  }
  // v0.60.140: internal-Пользователь = сотрудник компании-разработчика =>
  // полный доступ ко ВСЕМ модулям, в том числе вне его подписки. По репорту
  // Пользователя 2026-05-04: «как мне самому теперь использовать все
  // модули???». Раньше тумблер «Internal» открывал только internalOnly,
  // что было непоследовательно — внутренний Пользователь имеет любые роли
  // в системе (разработка, тестирование, поддержка), ему нужен full-access.
  if (isInternalUser()) return true;
  const sub = getSubscription();
  const plan = PLANS[sub.plan] || PLANS.free;
  // 1) Проверка по plan.modules
  if (plan.modules.includes('*')) return true;
  if (plan.modules.includes(moduleId)) return true;
  // 2) Проверка по subscription.modules[] (override)
  if (Array.isArray(sub.modules) && sub.modules.includes(moduleId)) return true;
  return false;
}

/**
 * Получить минимальный план для модуля. Используется для upsell-сообщения
 * («доступно от плана Starter»).
 *
 * @returns {string} id плана или null если только custom
 */
export function minPlanForModule(moduleId) {
  const order = ['free', 'starter', 'pro', 'enterprise'];
  for (const planId of order) {
    const p = PLANS[planId];
    if (p.modules.includes('*') || p.modules.includes(moduleId)) return planId;
  }
  return null;  // только custom
}

/**
 * Активировать триал плана. По умолчанию 14 дней.
 * @returns обновлённая подписка
 */
export function activateTrial(planId, days = 14) {
  if (!PLANS[planId]) throw new Error('[subscription] unknown plan: ' + planId);
  const sub = {
    plan: planId,
    expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
    modules: [],
    activatedAt: Date.now(),
    isTrial: true,
  };
  saveSubscription(sub);
  return sub;
}

/**
 * Лейбл текущего плана для UI («⭐ Pro · триал до 18.05.2026»).
 */
export function planBadge() {
  const sub = getSubscription();
  const plan = PLANS[sub.plan] || PLANS.free;
  let txt = plan.label;
  if (sub.isTrial && sub.expiresAt) {
    const days = Math.ceil((sub.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    txt += ` · триал ${days > 0 ? days + ' дн.' : 'истёк'}`;
  } else if (sub.expired) {
    txt += ' · истёк (откат на free)';
  }
  return txt;
}

/**
 * UI: показать модалку «модуль заблокирован» с предложением upgrade'а.
 * Возвращает Promise<boolean> — true если активировал триал.
 *
 * v0.60.133: для internal-only модулей показывает другую модалку без
 * upsell'а — модуль НЕ продаётся, только внутрикорпоративное использование.
 */
export async function showLockedModal(moduleId, moduleName, moduleManifest) {
  // v0.60.133: internal-only модули — особое сообщение.
  if (moduleManifest && moduleManifest.internalOnly) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font:14px/1.5 system-ui,sans-serif';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.3);max-width:520px;width:100%;overflow:hidden">
          <div style="padding:16px 20px;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff">
            <h3 style="margin:0;font-size:18px">🏢 Корпоративный модуль</h3>
            <div style="font-size:13px;opacity:0.9;margin-top:4px">${moduleName || moduleId}</div>
          </div>
          <div style="padding:18px 20px">
            <p style="margin:0 0 12px">Этот модуль доступен <b>только для внутрикорпоративного использования</b>. Не входит в коммерческие подписки.</p>
            <p class="muted" style="font-size:12.5px;color:#64748b;margin:0 0 14px">
              Модуль предназначен для управления проектами разработчика платформы и не продаётся отдельно. Если вы сотрудник компании-разработчика — обратитесь к администратору для активации corporate-доступа.
            </p>
            <p class="muted" style="font-size:11.5px;color:#9ca3af">
              Технически: <code>localStorage.setItem('raschet.internal.v1', '1')</code> через DevTools для самостоятельной активации (developer mode).
            </p>
            <button type="button" id="sub-cancel-btn" style="width:100%;padding:10px;margin-top:8px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font:inherit;color:#374151">Понятно</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('#sub-cancel-btn')?.addEventListener('click', () => close(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    });
  }

  const minPlan = minPlanForModule(moduleId);
  const planLabel = minPlan ? PLANS[minPlan].label : 'Custom';
  const sub = getSubscription();

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font:14px/1.5 system-ui,sans-serif';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.3);max-width:520px;width:100%;overflow:hidden">
        <div style="padding:16px 20px;background:linear-gradient(135deg,#1e3a8a,#3730a3);color:#fff">
          <h3 style="margin:0;font-size:18px">🔒 Модуль недоступен</h3>
          <div style="font-size:13px;opacity:0.9;margin-top:4px">${moduleName || moduleId}</div>
        </div>
        <div style="padding:18px 20px">
          <p style="margin:0 0 12px">Этот модуль доступен начиная с плана <b>${planLabel}</b>.</p>
          <p class="muted" style="font-size:12.5px;color:#64748b;margin:0 0 14px">
            Текущий план: <b>${PLANS[sub.plan]?.label || sub.plan}</b>${sub.isTrial ? ' (триал)' : ''}.
          </p>
          ${minPlan && !sub.isTrial ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" id="sub-trial-btn" style="flex:1;padding:10px 16px;background:#16a34a;color:#fff;border:0;border-radius:6px;cursor:pointer;font:inherit;font-weight:600">🎁 Попробовать ${planLabel} 14 дней</button>
              <button type="button" id="sub-buy-btn" style="flex:1;padding:10px 16px;background:#1d4ed8;color:#fff;border:0;border-radius:6px;cursor:pointer;font:inherit;font-weight:600">💳 Купить план</button>
            </div>
          ` : `
            <p style="font-size:12px;color:#dc2626">Триал недоступен (уже использовался). Свяжитесь с менеджером для покупки.</p>
          `}
          <button type="button" id="sub-cancel-btn" style="width:100%;padding:8px;background:transparent;border:0;cursor:pointer;color:#64748b;margin-top:10px;font-size:12px">Отмена</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#sub-cancel-btn')?.addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('#sub-trial-btn')?.addEventListener('click', () => {
      try {
        activateTrial(minPlan, 14);
        alert(`✓ Триал ${planLabel} активирован на 14 дней. Перезагрузите страницу.`);
        close(true);
        location.reload();
      } catch (e) {
        alert('Ошибка активации триала: ' + (e.message || e));
        close(false);
      }
    });
    overlay.querySelector('#sub-buy-btn')?.addEventListener('click', () => {
      // Заглушка для платёжной страницы. В будущем — Stripe / ЮKassa /
      // Cloudpayments / Tinkoff Acquiring.
      alert('💳 Платёжная интеграция в разработке. Свяжитесь с менеджером:\n\nemail: sales@raschet.app');
      close(false);
    });
  });
}

/**
 * Защита маршрута модуля. Вызывать в начале <module>/index.html scripts.
 * Если нет доступа — показывает модалку и блокирует загрузку.
 *
 *   import { requireModuleAccess } from '../shared/subscriptions.js';
 *   if (!await requireModuleAccess('cooling', 'Подбор холодильных систем')) {
 *     // блокируем рендер
 *     return;
 *   }
 */
// v0.60.137: requireModuleAccess для defence-in-depth в <module>/index.html.
// Раньше принимал только id+name; теперь опционально manifest или auto-fetch
// modules.json и передаёт его в hasModuleAccess/showLockedModal — нужно
// для проверки internalOnly (без manifest проверка идёт только по подписке).
let _manifestCache = null;
async function _fetchManifest() {
  if (_manifestCache) return _manifestCache;
  try {
    // Путь до modules.json относительно текущего модуля. Каждый модуль —
    // в своём подкаталоге, корневой — modules.json в parent.
    const res = await fetch('../modules.json').catch(() => fetch('./modules.json'));
    if (!res || !res.ok) return null;
    _manifestCache = await res.json();
    return _manifestCache;
  } catch { return null; }
}

export async function requireModuleAccess(moduleId, moduleName, moduleManifest = null) {
  let manifest = moduleManifest;
  if (!manifest) {
    const m = await _fetchManifest();
    if (m) manifest = (m.modules || []).find(x => x.id === moduleId) || null;
  }
  if (hasModuleAccess(moduleId, manifest)) return true;
  await showLockedModal(moduleId, moduleName, manifest);
  // Если триал активировали — будет reload и второй проход.
  return hasModuleAccess(moduleId, manifest);
}
