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

const STORAGE_KEY = 'raschet.global.v1';

// Дефолты — минимальный набор, нужный всем подпрограммам. Главный
// пакет (js/engine/constants.js) расширяет этот объект своими полями,
// которые здесь не перечислены.
export const DEFAULTS = {
  voltageLevels: [
    { vLL: 400,   vLN: 230,   phases: 3, hz: 50 },
    { vLL: 690,   vLN: 400,   phases: 3, hz: 50 },
    { vLL: 10000, vLN: 5774,  phases: 3, hz: 50 },
    { vLL: 6000,  vLN: 3464,  phases: 3, hz: 50 },
    { vLL: 35000, vLN: 20207, phases: 3, hz: 50 },
    { vLL: 110,   vLN: 110,   phases: 1, hz: 50 },
    { vLL: 48,    vLN: 48,    phases: 1, hz: 0, dcPoles: 2 },
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
export function saveGlobal(partial) {
  const next = { ...(getGlobal()), ...partial };
  _cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) { console.warn('[global-settings] save failed', e); }
  // Синхронизация с main-app (если запущено оно)
  try {
    if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
      window.Raschet.setGlobal(next);
    }
  } catch { /* ignore */ }
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

function _renderVoltageTable(container) {
  const G = getGlobal();
  const levels = G.voltageLevels || [];
  let html = '<table><tr><th>Отформатировано</th><th>V<sub>LL</sub> (V)</th><th>V<sub>LN</sub> (V)</th><th>Hz</th><th>DC полюса</th><th></th></tr>';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    const hz = typeof lv.hz === 'number' ? lv.hz : 50;
    const isDC = hz === 0;
    html += `<tr>
      <td><span class="label-cell">${formatVoltageLevelLabel(lv)}</span></td>
      <td><input type="number" data-vl="${i}" data-vl-field="vLL" value="${lv.vLL}" class="compact"></td>
      <td><input type="number" data-vl="${i}" data-vl-field="vLN" value="${lv.vLN}" class="compact"></td>
      <td><input type="number" data-vl="${i}" data-vl-field="hz" value="${hz}" class="compact" min="0" step="1" title="0 = DC"></td>
      <td>${isDC ? `<input type="number" data-vl="${i}" data-vl-field="dcPoles" value="${lv.dcPoles || 2}" class="compact" min="2" max="3" step="1">` : '<span class="muted">—</span>'}</td>
      <td style="text-align:right"><button type="button" class="btn danger" data-vl-del="${i}" title="Удалить">×</button></td>
    </tr>`;
  }
  html += '</table>';
  html += '<div class="add-row"><button type="button" class="btn" id="rs-gs-add-vl">+ Добавить уровень</button></div>';
  container.innerHTML = html;

  container.querySelectorAll('[data-vl]').forEach(inp => {
    inp.addEventListener('input', () => {
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

  const close = () => overlay.remove();
  overlay.querySelector('.rs-gs-close').addEventListener('click', close);
  overlay.querySelector('[data-gs-close]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
}
