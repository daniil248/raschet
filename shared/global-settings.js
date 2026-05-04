// ======================================================================
// shared/global-settings.js
// Единый источник правды для глобальных настроек платформы Raschet.
// Раньше настройки жили только в js/engine/constants.js (GLOBAL) и
// загружались из localStorage в main.js, но подпрограммы (battery/,
// ups-config/, panel-config/, transformer-config/, cable/) читали их
// по-разному или не читали вовсе. Из-за этого в «Справочнике» в
// модалке настроек были «400V 3P+N+PE», а в пикере источника «400 V · 3ph»
// — разные данные.
//
// Теперь:
//   — один ключ localStorage: 'raschet.global.v1'
//   — одна функция loadGlobal() / saveGlobal() / getGlobal() — работает
//     и в главном приложении, и в любой подпрограмме
//   — одна модалка openSettingsModal() — вызывается из шестерёнки в
//     хедере (shared/app-header.js) на любой странице
//
// Никаких зависимостей от js/engine/ здесь нет — модуль чистый и не
// ломает автономность подпрограмм.
// ======================================================================

import {
  getAutoBackupSettings, setAutoBackupSettings, getLastBackupInfo,
  pickBackupFolder, downloadBackup, writeBackupToFolder,
  startAutoBackupTimer, stopAutoBackupTimer,
} from './backup.js';
import {
  DEFAULT_COMPANY, loadRawProfile, saveGlobalCompanyProfile,
} from './company-profile.js';
// v0.60.115 (Phase 41 START): организация + расширение company-секции.
import {
  CURRENCIES, getOrgProfile, saveOrgProfile,
  resolveDefaultCurrencyWithSource, resolveDefaultVatWithSource,
} from './currency-defaults.js';
// v0.60.132 (Phase 44.3): подписки.
// v0.60.135: + ROLES, isInternalUser, currentRole, setRole, setInternalUser
// для секции «🏢 Внутрикорпоративный доступ» и «👤 Роль в организации».
import {
  PLANS, getSubscription, saveSubscription, activateTrial, planBadge,
  ROLES, isInternalUser, setInternalUser, currentRole, setRole,
} from './subscriptions.js';

const STORAGE_KEY = 'raschet.global.v1';

// Дефолты — минимальный набор, нужный всем подпрограммам. Главный
// пакет (js/engine/constants.js) расширяет этот объект своими полями,
// которые здесь не перечислены.
export const DEFAULTS = {
  voltageLevels: [
    { vLL: 400,   vLN: 230,   phases: 3, hz: 50, category: 'lv', builtin: true },
    { vLL: 690,   vLN: 400,   phases: 3, hz: 50, category: 'lv', builtin: true },
    { vLL: 10000, vLN: 5774,  phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 6000,  vLN: 3464,  phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 35000, vLN: 20207, phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 110,   vLN: 110,   phases: 1, hz: 50, category: 'lv', builtin: true },
    { vLL: 48,    vLN: 48,    phases: 1, hz: 0, dcPoles: 2, category: 'dc', builtin: true },
  ],
  defaultCosPhi: 0.92,
  defaultAmbient: 30,
  defaultMaterial: 'Cu',
  defaultInsulation: 'PVC',
  defaultCableType: 'multi',
  defaultInstallMethod: 'B1',
  maxCableSize: 240,
  maxParallelAuto: 10,
  maxVdropPct: 5,
  calcMethod: 'iec',
  parallelProtection: 'individual',
  earthingSystem: 'TN-S',
  breakerMinMarginPct: 0,
  showHelp: true,
  allowReducedNeutral: false,
  autoCenterOnSelect: false,
};

const listeners = new Set();
let _cache = null;

/**
 * Форматирует уровень напряжения в единый читаемый вид (SI-единицы).
 * То же самое, что в js/engine/electrical.js#formatVoltageLevelLabel,
 * но доступно из подпрограмм без импорта engine.
 */
export function formatVoltageLevelLabel(lv) {
  if (!lv) return '—';
  const vLL = Number(lv.vLL) || 0;
  const vLN = Number(lv.vLN) || 0;
  const hz = typeof lv.hz === 'number' ? lv.hz : 50;
  const isDC = lv.dc === true || hz === 0;
  const isHV = vLL >= 1000;
  const fmtV = (v) => isHV
    ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : v % 100 === 0 ? 1 : 3)
    : String(v);
  const unit = isHV ? 'kV' : 'V';
  if (isDC) {
    const poles = Number(lv.dcPoles) || 2;
    return poles > 2 ? `±${fmtV(vLL / 2)} ${unit} DC` : `${fmtV(vLL)} ${unit} DC`;
  }
  if (isHV) return `${fmtV(vLL)} ${unit} ${hz} Hz`;
  const voltPart = vLN && vLN !== vLL ? `${fmtV(vLL)}/${fmtV(vLN)}` : `${fmtV(vLL)}`;
  return `${voltPart} ${unit} ${hz} Hz`;
}

/**
 * Миграция уровней напряжения: удаляет label/phases, dc→hz:0, дефолт hz:50.
 */
function _migrateVoltageLevels(obj) {
  if (obj && Array.isArray(obj.voltageLevels)) {
    for (const lv of obj.voltageLevels) {
      if (!lv) continue;
      if ('label' in lv) delete lv.label;
      if (lv.dc && (lv.hz === undefined || lv.hz === null)) lv.hz = 0;
      delete lv.dc;
      if (typeof lv.hz !== 'number') lv.hz = 50;
      if (lv.hz === 0 && lv.vLL !== lv.vLN) lv.hz = 50;
      if (typeof lv.phases !== 'number') lv.phases = (lv.hz === 0) ? 1 : 3;
      if (!lv.category || !['lv','mv','hv','dc'].includes(lv.category)) {
        if (lv.hz === 0) lv.category = 'dc';
        else if (lv.vLL > 35000) lv.category = 'hv';
        else if (lv.vLL >= 1000) lv.category = 'mv';
        else lv.category = 'lv';
      }
    }
    // Удаляем legacy 230/230 1ph
    const idx230 = obj.voltageLevels.findIndex(lv => lv.vLL === 230 && lv.vLN === 230 && lv.hz !== 0);
    if (idx230 >= 0) obj.voltageLevels.splice(idx230, 1);
    // Пометить базовые уровни (400, 690, 10k, 6k, 35k, 110, 48DC) как builtin
    const builtinVLL = new Set([400, 690, 10000, 6000, 35000, 110, 48]);
    for (const lv of obj.voltageLevels) {
      if (lv && builtinVLL.has(lv.vLL) && !('builtin' in lv)) lv.builtin = true;
    }
  }
  return obj;
}

/**
 * Загружает настройки из localStorage и мёржит с дефолтами. Кэширует
 * результат в памяти. Вызов идемпотентный.
 */
export function loadGlobal() {
  if (_cache) return _cache;
  let saved = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch { /* bad json — игнор */ }
  _migrateVoltageLevels(saved);
  _cache = { ...DEFAULTS, ...saved };
  // voltageLevels — массив, глубокий merge: если в saved есть свой
  // массив, используем его целиком (пользователь мог удалить дефолтные)
  if (Array.isArray(saved.voltageLevels)) {
    _cache.voltageLevels = saved.voltageLevels;
  }
  return _cache;
}

/**
 * Возвращает текущий объект настроек (без загрузки из localStorage
 * повторно, если уже кэширован).
 */
export function getGlobal() {
  return _cache || loadGlobal();
}

/**
 * Частичное обновление. Сохраняет в localStorage, обновляет кэш,
 * уведомляет слушателей. Если в главном приложении подключён
 * window.Raschet.setGlobal — тоже его дёрнем для консистентности.
 */
let _inSaveGlobal = false;
export function saveGlobal(partial) {
  const next = { ...(getGlobal()), ...partial };
  _cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) { console.warn('[global-settings] save failed', e); }
  // Синхронизация с main-app (если запущено оно). Защита от
  // бесконечной рекурсии: engine.setGlobal → saveGlobal → engine.setGlobal.
  // Guard _inSaveGlobal выставляется на время вызова и сбрасывается в finally.
  if (!_inSaveGlobal) {
    _inSaveGlobal = true;
    try {
      if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
        window.Raschet.setGlobal(next);
      }
    } catch { /* ignore */ }
    finally { _inSaveGlobal = false; }
  }
  for (const cb of listeners) { try { cb(next); } catch (e) { console.error(e); } }
  return next;
}

/**
 * Подписка на изменения. Возвращает функцию отписки.
 */
export function onGlobalChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ================== Модалка настроек ==================
// Не зависит от js/engine/. Рисует собственный overlay + карточку,
// удаляет себя по Escape / клику на фон. Для простоты здесь — только
// управление справочником уровней напряжения (самая частая причина
// разночтений между подпрограммами). Остальные настройки (метод
// расчёта, коэффициенты) редактируются в родной settings-modal
// главного приложения — шестерёнка на hub.html показывает только
// общие настройки платформы.

function _css() {
  if (document.getElementById('rs-global-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'rs-global-settings-css';
  s.textContent = `
    .rs-gs-overlay { position: fixed; inset: 0; background: rgba(20,24,32,.45); z-index: 9999; display: flex; align-items: center; justify-content: center; }
    .rs-gs-card { background: #fff; border-radius: 12px; min-width: 560px; max-width: 780px; max-height: 90vh; overflow: auto; box-shadow: 0 12px 48px rgba(0,0,0,.25); font-family: -apple-system,"Segoe UI",Roboto,sans-serif; }
    .rs-gs-head { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; border-bottom: 1px solid #e0e3ea; }
    .rs-gs-head h3 { font-size: 16px; font-weight: 600; color: #1f2430; margin: 0; }
    .rs-gs-close { background: transparent; border: none; font-size: 22px; cursor: pointer; color: #6b7280; }
    .rs-gs-body { padding: 16px 18px; }
    .rs-gs-body h4 { font-size: 13px; color: #1f2430; margin: 14px 0 8px; font-weight: 600; }
    .rs-gs-body h4:first-child { margin-top: 0; }
    .rs-gs-body table { width: 100%; font-size: 12px; border-collapse: collapse; }
    .rs-gs-body th { background:#f4f5f7; padding: 6px 4px; text-align:left; font-weight:600; color:#1f2430; font-size: 11px; }
    .rs-gs-body td { padding: 4px; border-bottom: 1px solid #eef0f3; }
    .rs-gs-body input[type=number], .rs-gs-body input[type=text] { width:100%; padding:5px 7px; border:1px solid #d6dae2; border-radius:4px; font-size:12px; }
    .rs-gs-body input[type=number].compact { width: 64px; }
    .rs-gs-body .label-cell { font-family: ui-monospace,Consolas,monospace; color:#1976d2; font-weight:600; font-size:12px; }
    .rs-gs-body .btn { display:inline-block; padding:6px 12px; border-radius:6px; border:1px solid #d6dae2; background:#fff; font-size:12px; cursor:pointer; color:#1f2430; }
    .rs-gs-body .btn:hover { background:#f4f5f7; }
    .rs-gs-body .btn.primary { background:#1976d2; color:#fff; border-color:#1976d2; }
    .rs-gs-body .btn.primary:hover { background:#1565c0; }
    .rs-gs-body .btn.danger { color:#c62828; }
    .rs-gs-body .add-row { margin-top: 8px; text-align: right; }
    .rs-gs-body .muted { color:#6b7280; font-size:11px; line-height:1.5; }
    .rs-gs-foot { padding: 12px 18px; border-top: 1px solid #e0e3ea; display:flex; justify-content: flex-end; gap: 8px; }
  `;
  document.head.appendChild(s);
}

// Проверяет используется ли уровень напряжения idx хотя бы одним узлом
function _isVoltageLevelUsed(idx) {
  try {
    if (window.Raschet && window.Raschet._state) {
      for (const n of window.Raschet._state.nodes.values()) {
        if (n.voltageLevelIdx === idx) return true;
        if (n.inputVoltageLevelIdx === idx) return true;
      }
    }
  } catch { /* no main app */ }
  return false;
}

function _renderVoltageTable(container) {
  const G = getGlobal();
  const levels = G.voltageLevels || [];
  let html = '<table><tr><th>Отформатировано</th><th>V<sub>LL</sub> (V)</th><th>V<sub>LN</sub> (V)</th><th>Hz</th><th>DC полюса</th><th></th></tr>';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    const hz = typeof lv.hz === 'number' ? lv.hz : 50;
    const isDC = hz === 0;
    const isBuiltin = !!lv.builtin;
    const isUsed = _isVoltageLevelUsed(i);
    const canDelete = !isBuiltin && !isUsed;
    html += `<tr>
      <td><span class="label-cell">${formatVoltageLevelLabel(lv)}</span>${isBuiltin ? '<span style="font-size:9px;color:#999;margin-left:4px">базовый</span>' : ''}${!isBuiltin && isUsed ? '<span style="font-size:9px;color:#e65100;margin-left:4px">используется</span>' : ''}</td>
      <td><input type="number" data-vl="${i}" data-vl-field="vLL" value="${lv.vLL}" class="compact"></td>
      <td><input type="number" data-vl="${i}" data-vl-field="vLN" value="${lv.vLN}" class="compact"></td>
      <td><input type="number" data-vl="${i}" data-vl-field="hz" value="${hz}" class="compact" min="0" step="1" title="0 = DC"></td>
      <td>${isDC ? `<input type="number" data-vl="${i}" data-vl-field="dcPoles" value="${lv.dcPoles || 2}" class="compact" min="2" max="3" step="1">` : '<span class="muted">—</span>'}</td>
      <td style="text-align:right">${canDelete ? `<button type="button" class="btn danger" data-vl-del="${i}" title="Удалить">×</button>` : ''}</td>
    </tr>`;
  }
  html += '</table>';
  html += '<div class="add-row"><button type="button" class="btn" id="rs-gs-add-vl">+ Добавить уровень</button></div>';
  container.innerHTML = html;

  container.querySelectorAll('[data-vl]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.vl);
      const field = inp.dataset.vlField;
      const G2 = getGlobal();
      if (!G2.voltageLevels[idx]) return;
      G2.voltageLevels[idx][field] = Number(inp.value);
      saveGlobal({ voltageLevels: G2.voltageLevels });
      _renderVoltageTable(container);
    });
  });
  container.querySelectorAll('[data-vl-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.vlDel);
      const G2 = getGlobal();
      G2.voltageLevels.splice(idx, 1);
      saveGlobal({ voltageLevels: G2.voltageLevels });
      _renderVoltageTable(container);
    });
  });
  const addBtn = container.querySelector('#rs-gs-add-vl');
  if (addBtn) addBtn.addEventListener('click', () => {
    const G2 = getGlobal();
    G2.voltageLevels.push({ vLL: 400, vLN: 230, hz: 50 });
    saveGlobal({ voltageLevels: G2.voltageLevels });
    _renderVoltageTable(container);
  });
}

// v0.59.855: секция авто-бэкапа в модалке настроек.
function _renderBackupSection(host) {
  const settings = getAutoBackupSettings();
  const last = getLastBackupInfo();
  const fsaSupport = ('showDirectoryPicker' in window);
  const lastInfo = last
    ? `<div class="muted" style="font-size:12px;margin-top:4px">Последний бэкап: <b>${new Date(last.at).toLocaleString()}</b> (${last.keys || '?'} ключей${last.fileName ? ', ' + last.fileName : ''})</div>`
    : '<div class="muted" style="font-size:12px;margin-top:4px">Бэкапов ещё не делалось.</div>';
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:6px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" id="rs-gs-backup-now" style="padding:6px 14px;background:#16a34a;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:500">💾 Сделать бэкап сейчас (скачать)</button>
        ${fsaSupport ? `<button type="button" id="rs-gs-pick-folder" style="padding:6px 14px;background:#2563eb;color:#fff;border:0;border-radius:4px;cursor:pointer">📁 Выбрать папку для авто-бэкапа</button>` : ''}
      </div>
      ${!fsaSupport ? '<div class="muted" style="font-size:11px;color:#92400e">⚠ Авто-бэкап в папку требует File System Access API. Браузер не поддерживает (Safari/Firefox). Используйте «Бэкап сейчас» вручную.</div>' : ''}

      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="rs-gs-auto-enabled" ${settings.enabled ? 'checked' : ''} ${!fsaSupport ? 'disabled' : ''}>
        <span>Включить авто-бэкап в выбранную папку</span>
      </label>

      <div style="display:flex;align-items:center;gap:8px;font-size:13px">
        <label>Интервал:
          <input type="number" id="rs-gs-auto-interval" min="5" max="1440" step="5" value="${settings.intervalMin || 60}" style="width:70px;padding:4px;border:1px solid #cbd5e1;border-radius:3px"> мин
        </label>
      </div>

      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="rs-gs-auto-on-close" ${settings.onClose ? 'checked' : ''} ${!fsaSupport ? 'disabled' : ''}>
        <span>Доп. бэкап при закрытии вкладки (best-effort)</span>
      </label>

      ${lastInfo}
    </div>
  `;

  const refresh = () => _renderBackupSection(host);

  // Бэкап сейчас (всегда работает — скачивает .json)
  host.querySelector('#rs-gs-backup-now')?.addEventListener('click', () => {
    try {
      const v = (window.RASCHET_VERSION) || '';
      const r = downloadBackup({ appVersion: v });
      alert(`✓ Бэкап скачан: ${r.keyCount} ключей.`);
      refresh();
    } catch (e) { alert('Ошибка: ' + (e.message || e)); }
  });

  // Выбрать папку
  host.querySelector('#rs-gs-pick-folder')?.addEventListener('click', async () => {
    try {
      await pickBackupFolder();
      const v = (window.RASCHET_VERSION) || '';
      const r = await writeBackupToFolder({ appVersion: v });
      alert(`✓ Папка выбрана. Тестовый бэкап записан: ${r.fileName} (${r.keyCount} ключей).`);
      refresh();
    } catch (e) { alert('Не удалось: ' + (e.message || e)); }
  });

  // Toggle enabled
  host.querySelector('#rs-gs-auto-enabled')?.addEventListener('change', e => {
    setAutoBackupSettings({ enabled: !!e.target.checked });
    if (e.target.checked) {
      const v = (window.RASCHET_VERSION) || '';
      startAutoBackupTimer({ appVersion: v });
    } else {
      stopAutoBackupTimer();
    }
  });

  // Interval input
  host.querySelector('#rs-gs-auto-interval')?.addEventListener('change', e => {
    const m = Math.max(5, Math.min(1440, Number(e.target.value) || 60));
    setAutoBackupSettings({ intervalMin: m });
    e.target.value = m;
    // Перезапустить таймер с новым интервалом, если включён.
    if (getAutoBackupSettings().enabled) {
      const v = (window.RASCHET_VERSION) || '';
      startAutoBackupTimer({ appVersion: v });
    }
  });

  // Toggle on-close
  host.querySelector('#rs-gs-auto-on-close')?.addEventListener('change', e => {
    setAutoBackupSettings({ onClose: !!e.target.checked });
  });
}

/* v0.60.27: рендер секции «Реквизиты организации». v0.60.115 расширено
   default-currency и default-vat (TODO с v0.60.112). */
function _renderCompanySection(host) {
  const profile = loadRawProfile(null);
  const escAttr = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escHtml = escAttr;
  const f = (id, label, value, opts = {}) => `
    <label class="rs-gs-cf-field" title="${escAttr(opts.tip || '')}" style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151">
      <span style="font-weight:500">${escHtml(label)}</span>
      <input type="${opts.type || 'text'}" data-cf="${id}" value="${escAttr(value || '')}" placeholder="${escAttr(opts.placeholder || '')}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
    </label>
  `;
  // v0.60.115: default currency / vat для компании. Используются в каскаде
  // resolveDefaultCurrency / resolveDefaultVat (project → company → org →
  // user → fallback). Если поле пустое — компания не задаёт свой default,
  // используется уровень выше (org или user).
  const defCur = profile.defaultCurrency || '';
  const defVat = profile.defaultVat || null;
  const VAT_PRESETS = [
    { id: '',          label: '— не задано (наследовать) —', pct: 0,  enabled: true,  jurisdiction: '' },
    { id: 'kz-2026',   label: '🇰🇿 Казахстан 2026+ (16%)',   pct: 16, enabled: true,  jurisdiction: 'KZ' },
    { id: 'kz-pre2026',label: '🇰🇿 Казахстан до 2026 (12%)', pct: 12, enabled: true,  jurisdiction: 'KZ' },
    { id: 'ru',        label: '🇷🇺 Россия (20%)',            pct: 20, enabled: true,  jurisdiction: 'RU' },
    { id: 'by',        label: '🇧🇾 Беларусь (20%)',          pct: 20, enabled: true,  jurisdiction: 'BY' },
    { id: 'export',    label: '🌍 Экспорт (без НДС)',        pct: 0,  enabled: false, jurisdiction: 'export' },
    { id: 'custom',    label: '⚙ Пользовательский',          pct: 0,  enabled: true,  jurisdiction: 'custom' },
  ];
  function detectVatPreset(vat) {
    if (!vat) return '';
    if (!vat.enabled) return 'export';
    const found = VAT_PRESETS.find(p => p.enabled && p.id !== '' && p.id !== 'custom' && p.pct === Number(vat.pct));
    return found ? found.id : 'custom';
  }
  const vatPreset = detectVatPreset(defVat);
  host.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 12px">
      ${f('name', 'Название организации', profile.name, { placeholder: 'ТОО «...» / ООО «...»', tip: 'Полное наименование юридического лица. Отображается в шапке КП.' })}
      ${f('address', 'Юридический адрес', profile.address, { placeholder: '050000, г. Алматы, ул. ...', tip: 'Адрес для шапки документов.' })}
      ${f('phone', 'Телефон', profile.phone, { placeholder: '+7 (...)', tip: 'Контактный телефон для клиентов.' })}
      ${f('email', 'Email', profile.email, { type: 'email', placeholder: 'info@company.kz', tip: 'Email для деловой переписки.' })}
      ${f('website', 'Сайт', profile.website, { placeholder: 'https://company.kz', tip: 'Корпоративный сайт.' })}
      ${f('bin', 'БИН / ИНН', profile.bin, { placeholder: '12 цифр', tip: 'БИН (KZ) или ИНН (RU). Используется в счёт-фактурах.' })}
      ${f('director', 'Руководитель', profile.director, { placeholder: 'Иванов И.И.', tip: 'ФИО руководителя для подписей в КП и договорах.' })}
    </div>
    <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151;margin-top:8px"
           title="Банковские реквизиты для счёта-фактуры. Многострочно, форматирование сохраняется в КП.">
      <span style="font-weight:500">Банковские реквизиты</span>
      <textarea data-cf="bankRequisites" rows="3" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;resize:vertical" placeholder="АО «Банк» БИК ... ИИК ...">${escHtml(profile.bankRequisites)}</textarea>
    </label>
    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:14px 0">
    <h5 style="margin:0 0 8px;font-size:12px;color:#075985;text-transform:uppercase;letter-spacing:0.4px" title="Default-параметры компании по валюте и налогам. Применяются ко всем проектам этой компании, если в свойствах проекта явно не задано иное. Каскад: project → company → org → user → fallback.">💱 Финансовые дефолты компании</h5>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 12px">
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Валюта по умолчанию для проектов и КП этой компании. Если у конкретного проекта валюта задана явно — используется она; иначе подтягивается отсюда. Пусто = использовать org / user default.">
        <span style="font-weight:500">Валюта по умолчанию:</span>
        <select data-cf="defaultCurrency" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
          <option value=""${defCur === '' ? ' selected' : ''}>— не задано (наследовать) —</option>
          ${CURRENCIES.map(c => `<option value="${escAttr(c.code)}"${c.code === defCur ? ' selected' : ''} title="${escAttr(c.label)}">${escAttr(c.code)} — ${escAttr(c.label)}</option>`).join('')}
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Юрисдикция / пресет НДС по умолчанию для компании. Применяется к новым проектам если в свойствах не задано иное.">
        <span style="font-weight:500">📊 НДС по умолчанию:</span>
        <select data-cf="vatPreset" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
          ${VAT_PRESETS.map(vp => `<option value="${escAttr(vp.id)}"${vp.id === vatPreset ? ' selected' : ''}>${escHtml(vp.label)}</option>`).join('')}
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Ставка НДС, %. Доступно для редактирования только при «Пользовательский» пресете.">
        <span style="font-weight:500">Ставка НДС, %:</span>
        <input type="number" data-cf="vatPct" min="0" max="50" step="0.5" value="${defVat ? Number(defVat.pct) || 0 : 0}" ${vatPreset !== 'custom' ? 'readonly style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px;background:#f8fafc;color:#64748b;cursor:not-allowed"' : 'style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px"'}>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Если включено — НДС добавляется в итог КП. Выключено = «без НДС» (для экспортных клиентов).">
        <span style="font-weight:500">Учитывать в КП:</span>
        <label style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;cursor:pointer;font-size:12.5px">
          <input type="checkbox" data-cf="vatEnabled"${defVat?.enabled !== false ? ' checked' : ''}>
          <span>${defVat?.enabled !== false ? '✓ Включён' : '✗ Без НДС'}</span>
        </label>
      </label>
    </div>
    <p class="muted" style="font-size:11px;margin:6px 0 0">
      💡 Изменения сохраняются автоматически при потере фокуса. Per-project override настраивается в Свойствах проекта (📊 НДС / 💰 Экономика).
    </p>
  `;
  // v0.60.115: пресеты VAT — при выборе сразу применяем pct/enabled.
  function saveVatPreset() {
    const presetSel = host.querySelector('[data-cf="vatPreset"]');
    const presetId = presetSel?.value || '';
    if (!presetId) {
      // «не задано» → defaultVat=null (наследовать с уровня выше).
      const cur = loadRawProfile(null);
      cur.defaultVat = null;
      saveGlobalCompanyProfile(cur);
      _renderCompanySection(host);  // re-render
      return;
    }
    const preset = VAT_PRESETS.find(p => p.id === presetId);
    if (!preset || preset.id === 'custom') {
      // Custom: значения берём из vatPct/vatEnabled inputs.
      const pctInp = host.querySelector('[data-cf="vatPct"]');
      const enChk = host.querySelector('[data-cf="vatEnabled"]');
      const cur = loadRawProfile(null);
      cur.defaultVat = {
        pct: Number(pctInp?.value) || 0,
        enabled: !!enChk?.checked,
        jurisdiction: 'custom',
        label: 'НДС',
      };
      saveGlobalCompanyProfile(cur);
      return;
    }
    const cur = loadRawProfile(null);
    cur.defaultVat = {
      pct: preset.pct,
      enabled: preset.enabled,
      jurisdiction: preset.jurisdiction,
      label: 'НДС',
    };
    saveGlobalCompanyProfile(cur);
    _renderCompanySection(host);  // re-render с новым preset / readonly
  }
  host.addEventListener('change', (ev) => {
    const inp = ev.target.closest('[data-cf]');
    if (!inp) return;
    const fieldId = inp.dataset.cf;
    if (fieldId === 'vatPreset') { saveVatPreset(); return; }
    if (fieldId === 'vatPct' || fieldId === 'vatEnabled') {
      // Применяется только если preset === custom (поле не readonly).
      saveVatPreset();
      return;
    }
    const cur = loadRawProfile(null);
    cur[fieldId] = (inp.type === 'checkbox') ? inp.checked : inp.value;
    saveGlobalCompanyProfile(cur);
  });
}

/* v0.60.132 (Phase 44.3): рендер секции «Подписка». Управление планом
   подписки + активация триала + просмотр доступных модулей. */
function _renderSubscriptionSection(host) {
  const escAttr = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escHtml = escAttr;
  const sub = getSubscription();
  const curPlanId = sub.plan || 'free';
  const curPlan = PLANS[curPlanId] || PLANS.free;
  const isTrial = !!sub.isTrial && sub.expiresAt && sub.expiresAt > Date.now();
  const trialDaysLeft = isTrial ? Math.ceil((sub.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : 0;
  const expired = sub.expired === true;

  // Плашка текущего плана
  const planBgColor = isTrial ? '#fef3c7' : (curPlanId === 'free' ? '#f3f4f6' : '#dbeafe');
  const planTextColor = isTrial ? '#92400e' : (curPlanId === 'free' ? '#6b7280' : '#1e40af');

  // Список планов с галочкой текущего
  const planRows = Object.entries(PLANS).filter(([id]) => id !== 'custom').map(([planId, p]) => {
    const isCurrent = planId === curPlanId;
    const moduleCount = p.modules.includes('*') ? 'все' : p.modules.length;
    const trialBtn = !isCurrent && !isTrial && curPlanId === 'free' && planId !== 'free'
      ? `<button type="button" class="rs-gs-trial-btn" data-plan="${escAttr(planId)}" style="padding:4px 10px;background:#16a34a;color:#fff;border:0;border-radius:4px;cursor:pointer;font:inherit;font-size:11px">🎁 Триал 14 дн.</button>`
      : '';
    return `<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:8px 12px;margin:4px 0;background:${isCurrent ? '#dbeafe' : '#fff'};border:1px solid ${isCurrent ? '#93c5fd' : '#e2e8f0'};border-radius:5px">
      <span style="font-weight:600;color:${isCurrent ? '#1e40af' : '#0f172a'}">${escHtml(p.label)}${isCurrent ? ' ✓' : ''}</span>
      <span class="muted" style="font-size:11.5px">${escHtml(p.description)}</span>
      <span class="muted" style="font-size:11px;white-space:nowrap">${moduleCount} модулей</span>
      <span style="font-size:11.5px;font-weight:600;min-width:80px;text-align:right">${p.price === 0 ? '<span style="color:#15803d">бесплатно</span>' : (p.price ? p.price.toLocaleString('ru-RU') + ' ₽/мес' : '<span class="muted">договорная</span>')}</span>
      ${trialBtn ? `<div style="grid-column:1/-1;text-align:right">${trialBtn}</div>` : ''}
    </div>`;
  }).join('');

  host.innerHTML = `
    <div style="padding:10px 14px;background:${planBgColor};border:1px solid ${planTextColor}33;border-radius:5px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:600;color:${planTextColor}">🎫 ${escHtml(curPlan.label)}</span>
        ${isTrial ? `<span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600">ТРИАЛ · ${trialDaysLeft} дн.</span>` : ''}
        ${expired ? `<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600">ИСТЁК → free</span>` : ''}
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:4px;color:${planTextColor}AA">${escHtml(curPlan.description)}</div>
      ${isTrial ? `<div class="muted" style="font-size:11px;margin-top:6px;color:#92400e">⏰ Триал заканчивается ${new Date(sub.expiresAt).toLocaleDateString('ru-RU')}. После — auto-rollback на free.</div>` : ''}
    </div>

    <div style="margin-bottom:8px">
      <h5 style="margin:0 0 6px;font-size:12px;color:#075985;text-transform:uppercase;letter-spacing:0.4px">Доступные планы</h5>
      ${planRows}
    </div>

    <p class="muted" style="font-size:11px;margin:8px 0 0">
      💡 Soft-enforcement: подписка проверяется только в client-side. Calc-библиотеки (cooling/calc, shared/auto-norm, js/methods и т.д.) <b>авто-включаются</b> вместе с любым UI-модулем который их использует — без отдельной подписки.
    </p>
    <p class="muted" style="font-size:11px;margin:4px 0 0">
      🚧 Платёжная интеграция (Stripe/ЮKassa/Tinkoff) — Phase 44.4 TODO.
      Сейчас доступен только триал и manual override через DevTools (для разработчиков).
    </p>
  `;

  // Wire trial buttons
  host.querySelectorAll('.rs-gs-trial-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const planId = btn.dataset.plan;
      try {
        activateTrial(planId, 14);
        rsToast(`✓ Триал ${PLANS[planId]?.label || planId} активирован на 14 дней. Перезагружаем…`, 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        rsToast('Ошибка активации триала: ' + (e.message || e), 'error');
      }
    });
  });
}

/* v0.60.135 (Phase 44.3 расширение): рендер секции «Внутрикорпоративный
   доступ + роль». По двум требованиям Пользователя 2026-05-04:
     • «часть модулей будут доступны только внутри организации»
     • «В модуле Проекты только менеджер проектов или ГИП могут
        создавать проекты»
   Тумблер «Я сотрудник организации (internal-user)» открывает доступ к
   internalOnly-модулям (reports, logistics, projects). Селектор роли
   определяет permissions (canCreateProjects и др.). */
function _renderInternalRoleSection(host) {
  const escAttr = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escHtml = escAttr;
  const internal = isInternalUser();
  const role = currentRole();

  const internalToggle = `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${internal ? '#dcfce7' : '#f3f4f6'};border:1px solid ${internal ? '#86efac' : '#e2e8f0'};border-radius:5px;cursor:pointer;font-size:12.5px">
      <input type="checkbox" id="rs-gs-internal-toggle" ${internal ? 'checked' : ''}>
      <span><b>${internal ? '🏢 Внутрикорпоративный режим включён' : '🌐 Внешний клиент'}</b></span>
      <span class="muted" style="font-size:11px;margin-left:auto">${internal ? 'доступны internal-модули (reports, logistics, projects)' : 'только модули из подписки'}</span>
    </label>
  `;

  // Селектор роли — только если internal=true
  const roleRows = internal
    ? Object.entries(ROLES).map(([rid, def]) => {
        const isCur = rid === role;
        const perms = def.permissions || {};
        const permTags = [];
        if (perms.canCreateProjects) permTags.push('создание');
        if (perms.canDeleteProjects) permTags.push('удаление');
        if (perms.canEditEconomics) permTags.push('экономика');
        if (perms.canApproveVariants) permTags.push('утверждение');
        if (perms.canPromoteOrgItems) permTags.push('publish→org');
        const permsHtml = permTags.length
          ? permTags.map(t => `<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px;font-size:10.5px;margin-right:3px">${escHtml(t)}</span>`).join('')
          : '<span class="muted" style="font-size:11px">read-only</span>';
        return `<button type="button" class="rs-gs-role-row" data-role="${escAttr(rid)}" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;margin:3px 0;background:${isCur ? '#dbeafe' : '#fff'};border:1px solid ${isCur ? '#93c5fd' : '#e2e8f0'};border-radius:5px;cursor:pointer;font:inherit;font-size:12.5px;text-align:left">
          <span style="font-weight:600;color:${isCur ? '#1e40af' : '#0f172a'};min-width:170px">${escHtml(def.label)}${isCur ? ' ✓' : ''}</span>
          <span style="flex:1">${permsHtml}</span>
        </button>`;
      }).join('')
    : '';

  host.innerHTML = `
    <p class="muted" style="font-size:11.5px;margin:0 0 8px">
      Внутрикорпоративный режим открывает internal-модули, не входящие в коммерческие подписки (📋 Реестр проектов, 📊 Шаблоны отчётов, 🚚 Логистика). Роль внутри организации определяет permissions (создание / удаление / утверждение / экономика).
    </p>
    ${internalToggle}
    ${internal ? `
      <div style="margin-top:12px">
        <h5 style="margin:0 0 6px;font-size:12px;color:#075985;text-transform:uppercase;letter-spacing:0.4px">👤 Ваша роль в организации</h5>
        ${roleRows}
        <p class="muted" style="font-size:11px;margin:8px 0 0">
          🚧 В реальной мульти-Пользовательской системе роль будет назначаться администратором организации (Phase 41.5+). Сейчас — локальный self-select для тестирования и однопользовательских установок.
        </p>
      </div>
    ` : `
      <p class="muted" style="font-size:11px;margin:8px 0 0">
        💡 Включите тумблер если вы сотрудник организации, разворачивающей Raschet on-premise. Внешним клиентам internal-модули недоступны (даже на Enterprise-плане), их функция — внутрикорпоративный аудит/менеджмент проектов.
      </p>
    `}
  `;

  // Wire toggle
  const toggle = host.querySelector('#rs-gs-internal-toggle');
  if (toggle) {
    toggle.addEventListener('change', () => {
      try {
        setInternalUser(toggle.checked);
        // Re-render всю секцию (показать/скрыть селектор роли)
        _renderInternalRoleSection(host);
        rsToast(toggle.checked ? '✓ Internal-режим включён. Доступны internal-модули.' : 'Internal-режим выключен.', 'success');
      } catch (e) {
        rsToast('Ошибка: ' + (e.message || e), 'error');
      }
    });
  }

  // Wire role selector
  host.querySelectorAll('.rs-gs-role-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.role;
      if (!rid || !ROLES[rid]) return;
      try {
        setRole(rid);
        _renderInternalRoleSection(host);
        rsToast(`✓ Роль изменена: ${ROLES[rid].label}`, 'success');
      } catch (e) {
        rsToast('Ошибка: ' + (e.message || e), 'error');
      }
    });
  });
}

/* v0.60.115 (Phase 41 START): рендер секции «Организация».
   Группа людей с общими настройками (валюта/налоги по умолчанию,
   общий каталог шаблонов, brand). Полный multi-user — Phase 40 Cloud Sync. */
function _renderOrgSection(host) {
  const escAttr = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escHtml = escAttr;
  const org = getOrgProfile() || {};
  host.innerHTML = `
    <p class="muted" style="font-size:11.5px;margin:0 0 10px">
      Организация — группа людей с общими проектами, шаблонами и данными.
      Phase 41 START: пока локально (один org per устройство), мульти-пользователь
      будет в Phase 40 (Cloud Sync). Каскад: project → company → <b>org</b> → user → fallback.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 12px">
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Имя команды/организации. Например, «ГенезисЭнерго» или «Отдел проектирования ЦОД».">
        <span style="font-weight:500">Имя организации:</span>
        <input type="text" data-org="name" value="${escAttr(org.name || '')}" placeholder="ГенезисЭнерго / Отдел ЦОД / ..." style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Страна организации. Используется для подсказки юрисдикции по умолчанию.">
        <span style="font-weight:500">Страна:</span>
        <input type="text" data-org="country" value="${escAttr(org.country || '')}" placeholder="Казахстан / Россия / ..." style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151" title="Часовой пояс — для timestamps в журнале изменений и КП. Например, Asia/Almaty или Europe/Moscow.">
        <span style="font-weight:500">Часовой пояс:</span>
        <input type="text" data-org="timezone" value="${escAttr(org.timezone || '')}" placeholder="Asia/Almaty / Europe/Moscow / ..." style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px">
      </label>
    </div>
    <p class="muted" style="font-size:11px;margin:8px 0 0">
      🚧 Phase 41.2-41.5 (общий каталог шаблонов, роли, мульти-org switcher) — следующими итерациями. Сейчас — базовые поля для каскада (currency / vat).
    </p>
  `;
  host.addEventListener('change', (ev) => {
    const inp = ev.target.closest('[data-org]');
    if (!inp) return;
    const cur = getOrgProfile() || {};
    cur[inp.dataset.org] = (inp.type === 'checkbox') ? inp.checked : inp.value;
    saveOrgProfile(cur);
  });
}

/**
 * Открыть модалку глобальных настроек. Не зависит от наличия main-app.
 */
export function openSettingsModal() {
  loadGlobal();
  _css();
  // Закрыть предыдущую, если была
  document.querySelectorAll('.rs-gs-overlay').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'rs-gs-overlay';
  overlay.innerHTML = `
    <div class="rs-gs-card" role="dialog" aria-label="Глобальные настройки">
      <div class="rs-gs-head">
        <h3>⚙ Глобальные настройки платформы</h3>
        <button type="button" class="rs-gs-close" aria-label="Закрыть">×</button>
      </div>
      <div class="rs-gs-body">
        <h4>🎫 Подписка</h4>
        <div class="muted" style="margin-bottom:8px" title="Текущий план подписки и доступные модули. Soft-enforcement (бизнес-стимул); calc-libs включены автоматически.">Управление подпиской на модули. Phase 44 v0.60.131+.</div>
        <div id="rs-gs-subscription-section" style="margin-bottom:18px"></div>

        <h4>🏢 Внутрикорпоративный доступ + роль</h4>
        <div class="muted" style="margin-bottom:8px" title="Internal-режим открывает доступ к internalOnly-модулям (📋 Реестр проектов, 📊 Шаблоны отчётов, 🚚 Логистика), не входящим в коммерческие подписки. Роль внутри организации определяет permissions (canCreateProjects и др.).">Внутрикорпоративные модули + роль внутри организации. Phase 44 v0.60.133+.</div>
        <div id="rs-gs-internal-section" style="margin-bottom:18px"></div>

        <h4>🏢 Реквизиты компании-исполнителя</h4>
        <div class="muted" style="margin-bottom:8px" title="Реквизиты компании-исполнителя для шапки КП клиенту, договоров и отчётов. Сохраняются глобально для всех проектов; per-project override настраивается в свойствах проекта.">Реквизиты для шапки КП и договоров. Используются модулем «🛠 Сервис: монтаж и ТО» при экспорте КП клиенту. v0.60.115: добавлены default-валюта и default-НДС для каскада в калькуляторах.</div>
        <div id="rs-gs-company-section" style="margin-bottom:18px"></div>

        <h4>👥 Организация (Phase 41 START)</h4>
        <div class="muted" style="margin-bottom:8px" title="Организация — группа людей с общими проектами и настройками. Уровень между «компанией» (юр.лицом) и «пользователем». Для каскада общих параметров (валюта / НДС / бренд / шаблоны).">Команда / отдел проектирования. Каскадные параметры используются если ни проект, ни компания их не задают.</div>
        <div id="rs-gs-org-section" style="margin-bottom:18px"></div>

        <h4>💾 Резервное копирование</h4>
        <div class="muted" style="margin-bottom:8px">Защита от потери данных. Раз в час (или другой интервал) приложение автоматически записывает JSON-бэкап в выбранную папку.</div>
        <div id="rs-gs-backup-section" style="margin-bottom:18px"></div>

        <h4>Справочник уровней напряжения</h4>
        <div class="muted">Единый источник для всех подпрограмм платформы. Метка формируется автоматически из V<sub>LL</sub> / phases / DC — изменения видны во всех модулях сразу.</div>
        <div id="rs-gs-voltage-table" style="margin-top:10px"></div>
      </div>
      <div class="rs-gs-foot">
        <button type="button" class="btn primary" data-gs-close>Готово</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const tableHost = overlay.querySelector('#rs-gs-voltage-table');
  _renderVoltageTable(tableHost);

  // v0.59.855: секция авто-бэкапа.
  const backupHost = overlay.querySelector('#rs-gs-backup-section');
  if (backupHost) _renderBackupSection(backupHost);

  // v0.60.27: секция реквизитов организации.
  const companyHost = overlay.querySelector('#rs-gs-company-section');
  if (companyHost) _renderCompanySection(companyHost);

  // v0.60.115 (Phase 41 START): секция «Организация».
  const orgHost = overlay.querySelector('#rs-gs-org-section');
  if (orgHost) _renderOrgSection(orgHost);

  // v0.60.132 (Phase 44.3): секция «Подписка».
  const subHost = overlay.querySelector('#rs-gs-subscription-section');
  if (subHost) _renderSubscriptionSection(subHost);

  // v0.60.135 (Phase 44.3 расширение): секция «Внутрикорпоративный доступ + роль».
  const internalHost = overlay.querySelector('#rs-gs-internal-section');
  if (internalHost) _renderInternalRoleSection(internalHost);

  const close = () => overlay.remove();
  overlay.querySelector('.rs-gs-close').addEventListener('click', close);
  overlay.querySelector('[data-gs-close]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
}
