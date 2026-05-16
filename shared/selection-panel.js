// =============================================================================
// shared/selection-panel.js — универсальная панель ПОДБОРА (условия + TCO)
// =============================================================================
// v0.60.428. По запросу Пользователя 2026-05-15: «подбор ИБП и АКБ должен
// быть выполнен как подбор холодильных систем — в самом подборе все УСЛОВИЯ,
// а в вариантах конкретные решения, со сравнениями, TCO, CAPEX, OPEX».
//
// Самодостаточный компонент (свои инлайн-стили, без внешнего CSS, без модалок).
// Используется в ups-config (Фаза 2) и battery (Фаза 3). Расчётная модель —
// shared/calc/capex-tco.js (та же, что в подборе холода).
//
// Хранение условий/финансов подбора — запись подбора в
// shared/configuration-catalog.js (getSelectionMeta/saveSelectionMeta).
// Варианты — обычные ConfigEntry с этим selectionName.
//
// Модуль-хозяин предоставляет:
//   requirementsSchema — описание полей УСЛОВИЙ подбора;
//   variantEconomics(entry, selEco) → { costItems[]|eco, annualEnergyKwh } —
//     как из конкретного варианта получить экономику (CAPEX-статьи + годовое
//     потребление для OPEX-энергии). selEco несёт срок/ставку/эскалации/валюту.
// =============================================================================

import {
  getSelectionMeta, saveSelectionMeta, ensureSelectionMeta,
  listSelectionMetas, listConfigs, onConfigsChange,
  getConfig, saveConfig, setMainVariant,
} from './configuration-catalog.js';
import {
  DEFAULT_ECONOMICS, computeTco, discountedPaybackYears, convertEcoToCurrency,
  computeEcoTotals,
} from './calc/capex-tco.js';
import { CURRENCIES, fmtMoney } from './money.js';
import { openCostItemsModal } from './ui/cost-items-modal.js';
import { getProject, getActiveProjectId } from './project-storage.js';
// v0.60.458: централизованные курсы валют на дату (общий провайдер).
import { makeConvertFn } from './currency-rates/provider.js';
import { listSources, getActiveSourceId } from './currency-rates/index.js';

// v0.60.440: стили .rsp-* вынесены в ЕДИНУЮ ТЕМУ
// shared/styles/selection-theme.css (один источник для ups/battery/cooling,
// «меняется одним комплектом css»). Модуль больше НЕ инжектит CSS.
// Страховка: если тему забыли подключить <link>'ом — добавим её.
function injectCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rs-selection-theme-link')
    || document.querySelector('link[href*="selection-theme.css"]')) return;
  try {
    const base = (document.querySelector('link[href*="shared/styles/base.css"]')?.getAttribute('href') || '')
      .replace(/base\.css.*$/, '');
    const l = document.createElement('link');
    l.id = 'rs-selection-theme-link';
    l.rel = 'stylesheet';
    l.href = (base || '../shared/styles/') + 'selection-theme.css';
    document.head.appendChild(l);
  } catch {}
}

const FIN_FIELDS = [
  { key: 'tariff',              label: 'Тариф на э/э, /кВт·ч', step: 0.01, tip: 'Стоимость 1 кВт·ч для расчёта OPEX-энергии (потери КПД ИБП и т.п.). В валюте подбора.' },
  { key: 'projectLifetimeYears',label: 'Срок проекта, лет',    step: 1,    tip: 'Горизонт расчёта TCO/NPV (ISO 15686-5 Life-Cycle Costing).' },
  { key: 'discountRatePct',     label: 'Ставка дисконт., %',   step: 0.5,  tip: 'Годовая ставка дисконтирования для приведения будущих OPEX к году 0.' },
  { key: 'escalationEnergyPct', label: 'Эскалация энергии, %', step: 0.5,  tip: 'Годовой рост тарифа на электроэнергию.' },
  { key: 'escalationMaintPct',  label: 'Эскалация ТО, %',      step: 0.5,  tip: 'Годовой рост стоимости обслуживания.' },
];

/**
 * @param {object} o
 *  @param {string} o.kind                  — 'ups' | 'battery' | …
 *  @param {HTMLElement} o.mountEl
 *  @param {string|null} o.projectCode
 *  @param {function():string|null} o.getActiveSelectionName
 *  @param {Array} o.requirementsSchema     — [{key,label,unit?,type?,options?,step?,tip?}]
 *  @param {function(entry,selEco):object} o.variantEconomics
 *  @param {function(entry):string} [o.variantLabel]
 *  @param {function({host,entry,req,kind,save,refresh}):void} [o.variantSpec]
 *      — B2.2 i2: хост рисует выбор конкретной модели во вкладке Spec
 *        варианта (каскад поставщик→серия→модель + резерв), фильтруя по
 *        допустимым типам подбора. save({payload?,label?}) — тихое
 *        сохранение без перерисовки панели.
 *  @param {function|null} [o.convertFn]
 */
export function mountSelectionPanel(o) {
  injectCss();
  const mountEl = o.mountEl;
  if (!mountEl) return { refresh() {}, setSelection() {} };
  const kind = o.kind;
  let pc = o.projectCode || null; // v0.60.434: меняется при смене контекста
  let activeTab = 'general';
  // v0.60.455 (B2.2 i1): зона варианта = cooling-style вкладки в этой же
  // панели (а не старый wizard). scopeMode: 'selection' | 'variant'.
  let scopeMode = 'selection';
  let activeVariantId = null;
  let variantTab = 'spec';
  let selName = (typeof o.getActiveSelectionName === 'function' ? o.getActiveSelectionName() : null) || null;

  // v0.60.458: централизованный курс валют на дату. convertFn берётся из
  // общего провайдера (shared/currency-rates) и кэшируется по дате —
  // повторно не грузится, пока Пользователь не сменит дату/источник или
  // не нажмёт «Обновить курс» (force). До загрузки — o.convertFn (если был).
  let _rateDate = new Date().toISOString().slice(0, 10);
  let _rateSourceId = null;            // null = активный источник
  let _convertFn = (typeof o.convertFn === 'function') ? o.convertFn : null;
  let _rateInfo = null;                // {date,sourceId,cached,base,error}
  let _ratesLoading = false;
  let _ratesReqId = 0;

  async function loadRates(force) {
    const myId = ++_ratesReqId;
    _ratesLoading = true;
    try { render(); } catch {}
    let r;
    try {
      r = await makeConvertFn({ date: _rateDate, sourceId: _rateSourceId, force: !!force });
    } catch (e) {
      r = { convertFn: () => null, error: (e && e.message) || String(e) };
    }
    if (myId !== _ratesReqId) return;  // устаревший ответ — игнорируем
    _convertFn = r.convertFn || _convertFn;
    _rateInfo = r;
    _ratesLoading = false;
    try { render(); } catch {}
  }

  function ratesBarHtml() {
    let srcs = [];
    try { srcs = listSources(); } catch {}
    let actId = _rateSourceId;
    if (!actId) { try { actId = getActiveSourceId(); } catch { actId = ''; } }
    const opts = srcs.map(s =>
      `<option value="${escH(s.id)}"${s.id === actId ? ' selected' : ''}>${escH(s.label || s.id)}</option>`).join('')
      || '<option value="">— нет источников —</option>';
    const st = _ratesLoading ? '⏳ загрузка курса…'
      : (_rateInfo && _rateInfo.error) ? '⚠ курс не загружен (значения без конвертации)'
      : (_rateInfo ? (_rateInfo.cached ? '✓ курс из кэша' : '✓ курс загружен')
        + (_rateInfo.base ? ` · база ${escH(_rateInfo.base)}` : '') : '— курс не запрошен');
    return `<div class="rsp-note rsp-rates-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px">
      <span title="Курс валют берётся из ЦЕНТРАЛИЗОВАННОГО справочника (shared/currency-rates) на указанную дату. Кэшируется по дате — повторно не загружается, пока дата/источник не изменены или не нажата «Обновить курс».">💱 Курс на дату</span>
      <input type="date" data-rate="date" value="${escH(_rateDate)}" title="Дата курса валют. Курсы кэшируются по дате; смена даты — новый запрос (один раз на дату).">
      <select data-rate="source" title="Источник курсов валют (нац. банк / провайдер). Единый для всей программы.">${opts}</select>
      <button type="button" class="rs-cs-btn" data-rate="refresh" title="Принудительно перезапросить курс на эту дату (обновить кэш).">↻ Обновить курс</button>
      <span style="color:#64748b">${st}</span>
    </div>`;
  }

  function bindRateBar() {
    mountEl.querySelectorAll('[data-rate]').forEach(el => {
      const kindAttr = el.getAttribute('data-rate');
      if (kindAttr === 'date') el.addEventListener('change', () => {
        _rateDate = el.value || _rateDate; loadRates(false);
      });
      else if (kindAttr === 'source') el.addEventListener('change', () => {
        _rateSourceId = el.value || null; loadRates(false);
      });
      else if (kindAttr === 'refresh') el.addEventListener('click', () => loadRates(true));
    });
  }
  // Активная convertFn для расчётов/модалки (провайдер → fallback o.convertFn).
  const cvFn = () => _convertFn || cvFn();

  function selEcoOf(meta) {
    return { ...DEFAULT_ECONOMICS, tariff: 0, ...(meta && meta.eco || {}) };
  }

  // v0.60.436: если подбор привязан к проекту (pc задан) — цена э/э, валюта
  // и прочие фин-параметры берутся ИЗ ПРОЕКТА (свойства проекта → 💰
  // Экономика). Каскад как в cooling/таксы: project.economics → fallback.
  // В разовом подборе (standalone, pc=null) — параметры задаются вручную.
  function projEco() {
    if (!pc) return null;
    try {
      const p = getProject(getActiveProjectId());
      const e = p && p.economics;
      if (!e) return null;
      const out = {};
      if (typeof e.displayCurrency === 'string' && e.displayCurrency) out.currency = e.displayCurrency;
      if (Number.isFinite(Number(e.tariffPerKwh))) out.tariff = Number(e.tariffPerKwh);
      for (const k of ['projectLifetimeYears', 'discountRatePct', 'escalationEnergyPct', 'escalationMaintPct']) {
        if (Number.isFinite(Number(e[k]))) out[k] = Number(e[k]);
      }
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }
  // Действующие фин-параметры для расчёта/отображения: проект перекрывает
  // сохранённые в подборе значения для тех полей, что заданы в проекте.
  function effEco(meta) {
    const base = selEcoOf(meta);
    const pe = projEco();
    return pe ? { ...base, ...pe } : base;
  }
  // v0.60.450: УСЛОВИЯ из проекта (параметры площадки). Если подбор привязан
  // к проекту и в карточке заданы высота/макс.темп.среды — они идут в
  // условия подбора как «из проекта» (read-only), иначе задаются вручную.
  function projReq() {
    if (!pc) return null;
    try {
      const p = getProject(getActiveProjectId());
      const loc = p && p.location;
      if (!loc) return null;
      const out = {};
      if (Number.isFinite(Number(loc.elevationM))) out.altitudeM = Number(loc.elevationM);
      if (Number.isFinite(Number(loc.ambientMaxC))) out.ambientMaxC = Number(loc.ambientMaxC);
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }

  function persist(patch) {
    if (!selName) return;
    ensureSelectionMeta(kind, { projectCode: pc, selectionName: selName },
      { requirements: {}, eco: { ...DEFAULT_ECONOMICS, tariff: 0 } });
    saveSelectionMeta(kind, { projectCode: pc, selectionName: selName, ...patch });
  }

  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderGeneral(meta) {
    const req = (meta && meta.requirements) || {};
    const eco = effEco(meta);
    const pe = projEco() || {};
    const lockedNote = (k) => (k in pe)
      ? ` title="🔒 Значение из проекта (свойства проекта → 💰 Экономика). Для разового подбора переключите «Контекст подбора»."` : '';
    const lockAttr = (k) => (k in pe) ? ' disabled' : '';
    // v0.60.438: для модулей с wizard'ом (ИБП) УСЛОВИЯ задаются в «Шаг 1.
    // Требования» — единый источник; в панели они только для просмотра.
    const roCond = !!o.conditionsReadOnly;
    const roAttr = roCond ? ' disabled' : '';
    const pr = projReq() || {};   // v0.60.450: условия из проекта (площадка)
    const reqHtml = (o.requirementsSchema || []).map(f => {
      const fromProj = (f.key in pr);
      const v = fromProj ? pr[f.key] : req[f.key];
      const lk = (roAttr || (fromProj ? ' disabled' : ''));
      const projTag = fromProj ? '<span class="rsp-field-lock">🔒 из проекта</span>' : '';
      const projTitle = fromProj ? ' title="🔒 Значение из проекта (свойства проекта → 🏔 Параметры площадки). Для ручного ввода переключите на «Разовый подбор»."' : '';
      if (f.type === 'multiselect') {
        // v0.60.451: выбор НЕСКОЛЬКИХ допустимых значений (чекбоксы).
        // Пусто = «любой» (ограничения нет). Хранится массивом.
        const sel = Array.isArray(v) ? v.map(String) : [];
        const dis = lk ? ' disabled' : '';
        const boxes = (f.options || []).map(op => {
          const val = typeof op === 'string' ? op : op.value;
          const lab = typeof op === 'string' ? op : op.label;
          const on = sel.includes(String(val));
          return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#334155;margin-right:10px;white-space:nowrap">
            <input type="checkbox" data-reqmulti="${escH(f.key)}" value="${escH(val)}"${on ? ' checked' : ''}${dis}> ${escH(lab)}</label>`;
        }).join('');
        return `<div class="rsp-field" title="${escH(f.tip || '')}" style="grid-column:1/-1">${escH(f.label)}${f.unit ? ', ' + escH(f.unit) : ''}${projTag}
          <div style="display:flex;flex-wrap:wrap;gap:2px 0;margin-top:auto;padding:5px 0">${boxes}<span style="font-size:11px;color:#94a3b8;align-self:center">${sel.length ? '' : '(пусто = любой)'}</span></div></div>`;
      }
      if (f.type === 'select') {
        const opts = (f.options || []).map(op => {
          const val = typeof op === 'string' ? op : op.value;
          const lab = typeof op === 'string' ? op : op.label;
          return `<option value="${escH(val)}"${String(v) === String(val) ? ' selected' : ''}>${escH(lab)}</option>`;
        }).join('');
        return `<label class="rsp-field" title="${escH(f.tip || '')}">${escH(f.label)}${f.unit ? ', ' + escH(f.unit) : ''}${projTag}
          <select data-req="${escH(f.key)}"${lk}${projTitle}>${opts}</select></label>`;
      }
      const type = f.type === 'text' ? 'text' : 'number';
      return `<label class="rsp-field" title="${escH(f.tip || '')}">${escH(f.label)}${f.unit ? ', ' + escH(f.unit) : ''}${projTag}
        <input type="${type}" data-req="${escH(f.key)}" ${f.step ? `step="${f.step}"` : ''} value="${escH(v == null ? '' : v)}"${lk}${projTitle}></label>`;
    }).join('');

    const curOpts = CURRENCIES.map(c =>
      `<option value="${c.code}"${c.code === (eco.currency || '₸') ? ' selected' : ''} title="${escH(c.label)}">${c.code}</option>`).join('');
    const finHtml = FIN_FIELDS.map(f =>
      `<label class="rsp-field" title="${escH(f.tip)}">${escH(f.label)}${(f.key in pe) ? '<span class="rsp-field-lock">🔒 из проекта</span>' : ''}
        <input type="number" data-eco="${f.key}" step="${f.step}" value="${escH(eco[f.key] == null ? '' : eco[f.key])}"${lockAttr(f.key)}${lockedNote(f.key)}></label>`).join('');
    const curLocked = ('currency' in pe);

    return `
      <div class="rsp-sec-title" title="Общие УСЛОВИЯ подбора — одинаковы для всех вариантов. Конкретные решения задаются в вариантах.">📋 Условия подбора${roCond ? ' <span style="color:#64748b;font-weight:400;font-size:11px">(из «Шаг 1. Требования»)</span>' : ''}</div>
      ${roCond ? `<div class="rsp-note" style="margin:0 0 8px">ℹ Условия подбора задаются в «Шаг 1. Требования к ИБП» Конфигуратора (одинаковы для всех вариантов). Здесь — только просмотр; при сохранении варианта они записываются в подбор.</div>` : ''}
      <div class="rsp-grid">${reqHtml || '<span class="rsp-empty">Нет полей условий — заполните «Шаг 1. Требования» и сохраните вариант.</span>'}</div>
      <div class="rsp-divider"></div>
      <div class="rsp-sec-title" title="Финансовые параметры — общие для всех вариантов, чтобы сравнение TCO было на одинаковых условиях (как в «Подбор холода»).">💰 Финансовые параметры (общие для всех вариантов)</div>
      <div class="rsp-grid">
        <label class="rsp-field" title="Валюта подбора — все CAPEX/OPEX/TCO приводятся к ней по курсу.">Валюта подбора${curLocked ? '<span class="rsp-field-lock">🔒 из проекта</span>' : ''}
          <select data-eco="currency"${curLocked ? ' disabled title="🔒 Валюта из проекта (свойства проекта → 💰 Экономика)."' : ''}>${curOpts}</select></label>
        ${finHtml}
      </div>
      <div class="rsp-note">${Object.keys(pe).length
        ? 'ℹ Подбор привязан к проекту: цена э/э, валюта и фин-параметры берутся из свойств проекта (💰 Экономика) и здесь только для просмотра. Для ручного ввода переключите «Контекст подбора» → «Разовый подбор».'
        : 'ℹ Условия и финансы хранятся на уровне ПОДБОРА. Варианты сравниваются на одинаковых условиях во вкладке «📈 TCO / Сравнение».'}</div>
    `;
  }

  function renderCompare(meta) {
    const eco = effEco(meta);
    const req = (meta && meta.requirements) || {};
    const cur = eco.currency || '₸';
    const variants = listConfigs(kind, { projectCode: pc, selectionName: selName });
    if (!variants.length) {
      return `<div class="rsp-empty">В подборе «${escH(selName)}» пока нет вариантов.<br>Сохраните решение как вариант этого подбора.</div>`;
    }
    const rows = variants.map(v => {
      let ec = {};
      try { ec = o.variantEconomics(v, eco, req) || {}; } catch { ec = {}; }
      // v0.60.433: цены, введённые Пользователем вручную во вкладке
      // «💰 CAPEX (по вариантам)», имеют приоритет над авто-выводом из payload.
      const storedCI = (v.eco && Array.isArray(v.eco.costItems) && v.eco.costItems.length)
        ? v.eco.costItems : null;
      const ecoForCalc = ec.eco
        ? ec.eco
        : { ...eco, costItems: storedCI || (Array.isArray(ec.costItems) ? ec.costItems : []) };
      const flat = convertEcoToCurrency(ecoForCalc, cur, cvFn());
      const t = computeTco({
        annualEnergyKwh: Number(ec.annualEnergyKwh) || 0,
        tariffRubKwh: Number(eco.tariff) || 0,
        eco: flat,
      });
      // v0.60.429: ступенчатые CAPEX-события (замена АКБ при сроке службы <
      // срока проекта и т.п.). amount уже в валюте подбора. Дисконтируем по
      // ставке и добавляем в TCO/raw/среднее; в payback-поток (yearlyOpex)
      // добавляем недисконтированную сумму в соответствующий год — так
      // discountedPaybackYears учтёт замену корректно.
      const events = Array.isArray(ec.extraCapexEvents) ? ec.extraCapexEvents : [];
      if (events.length) {
        const rr = (Number(t.discountRatePct) || 0) / 100;
        let addDisc = 0, addRaw = 0;
        for (const evp of events) {
          const yr = Math.round(Number(evp.year) || 0);
          const amt = Number(evp.amount) || 0;
          if (yr < 1 || yr > t.projectLifetimeYears || amt <= 0) continue;
          addDisc += amt / Math.pow(1 + rr, yr);
          addRaw += amt;
          const ye = t.yearlyOpex.find(y => y.year === yr);
          if (ye) { ye.totalRub += amt; ye.cumDiscounted += amt / Math.pow(1 + rr, yr); }
        }
        if (addDisc || addRaw) {
          t.tco += addDisc;
          t.tcoUndiscounted += addRaw;
          t.averageRubPerYear = t.tco / t.projectLifetimeYears;
          t._replacementNote = true;
        }
      }
      return { v, t, isMain: !!v.isMainVariant };
    });
    const main = rows.find(r => r.isMain) || rows[0];
    const best = { capex: Math.min(...rows.map(r => r.t.capex)), tco: Math.min(...rows.map(r => r.t.tco)) };
    const lblOf = (entry) => (typeof o.variantLabel === 'function' ? o.variantLabel(entry) : (entry.label || entry.id));

    // v0.60.446: график «TCO по годам — все варианты подбора» (как в
    // «Подбор холода»). Кумулятивные дисконтированные затраты по годам:
    // год 0 = CAPEX; год t = cumDiscounted (включает CAPEX, см. computeTco).
    // Самодостаточный SVG (без Chart.js).
    const N = (main ? main.t.projectLifetimeYears : eco.projectLifetimeYears) || 10;
    const PAL = ['#1e40af', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#be185d'];
    const series = rows.map((r, i) => {
      const pts = [{ x: 0, y: r.t.capex }];
      const yo = r.t.yearlyOpex || [];
      for (let t = 1; t <= N; t++) {
        const ye = yo.find(z => z.year === t);
        pts.push({ x: t, y: ye ? ye.cumDiscounted : (pts[pts.length - 1].y) });
      }
      return { name: lblOf(r.v), isMain: r.isMain, color: PAL[i % PAL.length], pts };
    });
    const maxY = Math.max(1, ...series.flatMap(s => s.pts.map(p => p.y)));
    const W = 640, H = 230, padL = 64, padR = 12, padT = 12, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const sx = (x) => padL + (x / N) * plotW;
    const sy = (y) => padT + plotH - (y / maxY) * plotH;
    const gridY = 4;
    let gridSvg = '';
    for (let g = 0; g <= gridY; g++) {
      const yy = padT + plotH - (g / gridY) * plotH;
      const val = (g / gridY) * maxY;
      gridSvg += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`
        + `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${escH(fmtMoney(val, cur))}</text>`;
    }
    let xticks = '';
    const xstep = N <= 12 ? 1 : Math.ceil(N / 10);
    for (let t = 0; t <= N; t += xstep) {
      xticks += `<text x="${sx(t).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#94a3b8">${t}</text>`;
    }
    const lines = series.map(s => {
      const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.isMain ? 2.5 : 1.5}"${s.isMain ? '' : ' stroke-dasharray="4 3"'}/>`;
    }).join('');
    const legend = series.map(s =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;color:#475569">
        <span style="width:14px;height:0;border-top:3px ${s.isMain ? 'solid' : 'dashed'} ${s.color};display:inline-block"></span>
        ${s.isMain ? '★ ' : ''}${escH(s.name)}</span>`).join('');
    const chartSvg = `
      <div class="rsp-sec-title" title="Кумулятивные дисконтированные затраты владения по годам для каждого варианта. Год 0 = CAPEX. Чем ниже линия — тем дешевле владение.">📈 TCO по годам — все варианты подбора</div>
      <div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:420px;height:${H}px;background:#fff;border:1px solid var(--sel-bd,#e2e8f0);border-radius:6px">
        ${gridSvg}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#cbd5e1"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#cbd5e1"/>
        ${xticks}
        <text x="${(padL + (W - padR)) / 2}" y="${H - 0}" text-anchor="middle" font-size="9" fill="#64748b">Год проекта</text>
        ${lines}
      </svg></div>
      <div style="margin:6px 0 14px;display:flex;flex-wrap:wrap">${legend}</div>`;

    const body = rows.map(r => {
      const pay = (main && r.v.id !== main.v.id) ? discountedPaybackYears(r.t, main.t) : null;
      const op1 = r.t.yearlyOpex && r.t.yearlyOpex[0] ? r.t.yearlyOpex[0].totalRub : 0;
      const payTxt = !pay ? (r.isMain ? '— (база)' : '—')
        : pay.neverPaysBack ? `> ${r.t.projectLifetimeYears} лет`
        : `${pay.exact.toFixed(1)} лет`;
      return `<tr class="${r.isMain ? 'rsp-main' : ''}">
        <td class="rsp-lft">${r.isMain ? '★ ' : ''}${escH(lblOf(r.v))}</td>
        <td class="${r.t.capex === best.capex ? 'rsp-best' : ''}">${fmtMoney(r.t.capex, cur)}</td>
        <td>${fmtMoney(op1, cur)}</td>
        <td class="${r.t.tco === best.tco ? 'rsp-best' : ''}">${fmtMoney(r.t.tco, cur)}</td>
        <td>${fmtMoney(r.t.averageRubPerYear, cur)}</td>
        <td>${payTxt}</td>
      </tr>`;
    }).join('');

    return `
      ${ratesBarHtml()}
      ${chartSvg}
      <div class="rsp-sec-title" title="Технико-экономическое сравнение вариантов подбора. TCO = CAPEX + Σ дисконтированных OPEX за срок проекта (ISO 15686-5).">⚖ Финансовая сводка по вариантам · TCO ${main ? main.t.projectLifetimeYears : eco.projectLifetimeYears} лет</div>
      <table class="rsp-table">
        <thead><tr>
          <th class="rsp-lft" title="Вариант подбора. ★ — основной (база для срока окупаемости).">Вариант</th>
          <th title="Капитальные затраты, год 0 (оборудование + монтаж).">CAPEX</th>
          <th title="Операционные затраты за 1-й год (энергия потерь + ТО).">OPEX (год 1)</th>
          <th title="Total Cost of Ownership = CAPEX + Σ дисконтированных OPEX.">TCO (NPV)</th>
          <th title="Среднегодовая стоимость владения = TCO / срок.">Σ/год</th>
          <th title="Дисконтированный срок окупаемости относительно ★ основного варианта.">Окупаемость</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="rsp-note">ℹ Зелёным выделены лучшие значения по CAPEX и TCO. Окупаемость считается относительно ★ основного варианта (отметьте ★ в сайдбаре).</div>
    `;
  }

  // v0.60.433: вкладка «💰 CAPEX (по вариантам)» — Пользователь вводит
  // конкретные цены каждого варианта (оборудование / монтаж / ТО-год +
  // валюта). Хранится в самом варианте: entry.eco.costItems[0]. Эти цены
  // приоритетнее авто-вывода из payload (см. storedCI в renderCompare).
  function ciOf(entry) {
    const ci = entry.eco && Array.isArray(entry.eco.costItems) && entry.eco.costItems[0];
    return ci || null;
  }
  function renderCapex(meta) {
    const eco = effEco(meta);
    const cur0 = eco.currency || '₸';
    const variants = listConfigs(kind, { projectCode: pc, selectionName: selName });
    if (!variants.length) {
      return `<div class="rsp-empty">В подборе «${escH(selName)}» нет вариантов. Создайте решение и сохраните кнопкой «+ Вариант».</div>`;
    }
    const rowsH = variants.map(v => {
      const ci = ciOf(v);                       // entry.eco.costItems (если задан)
      let costItems = (v.eco && Array.isArray(v.eco.costItems) && v.eco.costItems.length)
        ? v.eco.costItems : null;
      let isAuto = false;
      if (!costItems) {
        isAuto = true;
        try { const e = o.variantEconomics(v, eco, (meta && meta.requirements) || {}) || {};
          costItems = Array.isArray(e.costItems) ? e.costItems : []; } catch { costItems = []; }
      }
      const t = computeEcoTotals({ costItems, currency: cur0 }, cur0, cvFn());
      const nRows = costItems.length;
      return `<tr data-cap-id="${escH(v.id)}">
        <td class="rsp-lft">${v.isMainVariant ? '★ ' : ''}${escH(v.label || v.id)}${isAuto ? ' <span style="color:#94a3b8">(авто)</span>' : ''}</td>
        <td>${fmtMoney(t.equipmentCost, cur0)}</td>
        <td>${fmtMoney(t.installationCost, cur0)}</td>
        <td>${fmtMoney(t.maintenanceRubPerYear, cur0)}</td>
        <td><b>${fmtMoney(t.equipmentCost + t.installationCost, cur0)}</b></td>
        <td><button type="button" class="rs-cs-btn" data-cap-edit="${escH(v.id)}" title="Открыть таблицу состава оборудования (построчно, цена+валюта на пункт) — как в «Подбор холода».">✏ Состав (${nRows})</button></td>
      </tr>`;
    }).join('');
    return `
      <div class="rsp-sec-title" title="Цены каждого варианта построчно (Состав оборудования) — как в «Подбор холода». Σ Оборудование+Монтаж = CAPEX (год 0); ТО/год → OPEX (с эскалацией из «Свойства подбора»).">💰 CAPEX по вариантам · валюта подбора ${escH(cur0)}</div>
      <table class="rsp-table">
        <thead><tr>
          <th class="rsp-lft" title="Вариант подбора.">Вариант</th>
          <th title="Σ Оборудование (в валюте подбора).">Оборудование</th>
          <th title="Σ Монтаж/ПНР.">Монтаж/ПНР</th>
          <th title="Σ ТО за год.">ТО за год</th>
          <th title="CAPEX год 0 = Оборудование + Монтаж.">CAPEX</th>
          <th title="Редактировать построчный состав статей (цена+валюта на пункт).">Состав</th>
        </tr></thead>
        <tbody>${rowsH}</tbody>
      </table>
      <div class="rsp-note">ℹ «(авто)» — цены ещё не заданы, показана оценка из параметров. Кнопка «✏ Состав» открывает построчную таблицу (цена и валюта на каждый пункт) — единый редактор, как в «Подбор холода». Итоги CAPEX/OPEX/TCO — во вкладке «📈 TCO / Сравнение».</div>
    `;
  }

  // v0.60.455 (B2.2 i1): read-only баннер УСЛОВИЙ ПОДБОРА для зоны варианта.
  function condBannerHtml(meta) {
    const req = (meta && meta.requirements) || {};
    const pr = projReq() || {};
    const parts = (o.requirementsSchema || []).map(f => {
      let v = (f.key in pr) ? pr[f.key] : req[f.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
      if (f.type === 'multiselect') {
        const map = {}; (f.options || []).forEach(op => { const val = typeof op === 'string' ? op : op.value; const lab = typeof op === 'string' ? op : op.label; map[val] = lab; });
        v = (Array.isArray(v) ? v : [v]).map(x => map[x] || x).join('/');
      } else if (f.type === 'select') {
        const op = (f.options || []).find(x => String(typeof x === 'string' ? x : x.value) === String(v));
        v = op ? (typeof op === 'string' ? op : op.label) : v;
      }
      return `${escH(f.label)}: <b>${escH(v)}</b>${f.unit ? ' ' + escH(f.unit) : ''}`;
    }).filter(Boolean);
    return `<div class="rsp-note" style="margin:0 0 12px;background:var(--sel-accent-bg,#eef2ff);border-color:var(--sel-accent-bd,#c7d2fe);color:var(--sel-accent-ink,#3730a3)">
      📋 Условия подбора (общие, задаются в зоне ПОДБОРА): ${parts.join(' · ') || '—'}
      <button type="button" data-var-act="back" style="margin-left:8px;padding:3px 9px;font-size:11px;background:#fff;border:1px solid var(--sel-accent-bd,#c7d2fe);border-radius:4px;color:var(--sel-accent-ink,#3730a3);cursor:pointer">↩ К условиям подбора</button>
    </div>`;
  }

  // v0.60.455 (B2.2 i1): зона ВАРИАНТА — cooling-style вкладки.
  function renderVariant(meta) {
    const entry = activeVariantId ? getConfig(kind, activeVariantId) : null;
    if (!entry) { scopeMode = 'selection'; return renderGeneral(meta); }
    const eco = effEco(meta);
    const cur0 = eco.currency || '₸';
    const ci = (entry.eco && Array.isArray(entry.eco.costItems) && entry.eco.costItems.length)
      ? entry.eco.costItems : null;
    let items = ci;
    if (!items) { try { const e = o.variantEconomics(entry, eco, (meta && meta.requirements) || {}) || {}; items = Array.isArray(e.costItems) ? e.costItems : []; } catch { items = []; } }
    const t = computeEcoTotals({ costItems: items, currency: cur0 }, cur0, cvFn());
    const p = entry.payload || {};
    let body = '';
    if (variantTab === 'spec') {
      // v0.60.464 (B2.2 i2): хост-модуль сам рисует выбор конкретной
      // модели (каскад поставщик→серия→модель + резерв), фильтруя по
      // допустимым типам подбора. selection-panel остаётся generic —
      // даёт контейнер [data-vspec-host] и колбэк сохранения payload.
      const hasSpec = typeof o.variantSpec === 'function';
      body = `<div class="rsp-sec-title">⚙ Spec — конкретное решение варианта</div>
        <div class="rsp-grid">
          <label class="rsp-field">Название варианта<input type="text" data-var="label" value="${escH(entry.label || '')}"></label>
        </div>
        ${hasSpec
          ? `<div data-vspec-host style="margin-top:10px"></div>`
          : `<div class="rsp-note">ℹ Текущее: <b>${escH(p.upsSupplier || '')} ${escH(p.upsModel || p.upsId || entry.label || '—')}</b>${p.capacityKw ? ' · ' + escH(p.capacityKw) + ' кВт' : ''}.</div>`}`;
    } else if (variantTab === 'akb') {
      body = `<div class="rsp-sec-title">🔋 АКБ варианта</div>
        <div class="rsp-note">ℹ Выбор/пропуск АКБ и мост к модулю «Расчёт АКБ» — инкремент i3. Текущее: <b>${escH(p.batteryChoice === 'skip' ? 'без АКБ' : (p.battery ? ((p.battery.supplier || '') + ' ' + (p.battery.model || '')) : '— не задано'))}</b>.</div>`;
    } else if (variantTab === 'capex') {
      body = `${ratesBarHtml()}<div class="rsp-sec-title" title="Построчный состав статей затрат варианта — цена+валюта на пункт, как в «Подбор холода».">💰 CAPEX варианта · валюта ${escH(cur0)}</div>
        <table class="rsp-table"><tbody>
          <tr><td class="rsp-lft">Σ Оборудование</td><td>${fmtMoney(t.equipmentCost, cur0)}</td></tr>
          <tr><td class="rsp-lft">Σ Монтаж/ПНР</td><td>${fmtMoney(t.installationCost, cur0)}</td></tr>
          <tr><td class="rsp-lft">Σ ТО за год</td><td>${fmtMoney(t.maintenanceRubPerYear, cur0)}</td></tr>
          <tr class="rsp-main"><td class="rsp-lft"><b>CAPEX (год 0)</b></td><td><b>${fmtMoney(t.equipmentCost + t.installationCost, cur0)}</b></td></tr>
        </tbody></table>
        <div style="margin-top:10px"><button type="button" class="rs-cs-btn rs-cs-btn-primary" data-cap-edit="${escH(entry.id)}">✏ Редактировать состав (${items.length})</button></div>
        <div class="rsp-note">ℹ Построчная таблица: Статья / Кол-во / Оборудование / Монтаж+ПНР / ТО за год — цена и валюта на каждый пункт (единый редактор, как cooling). Хранится в этом варианте.</div>`;
    } else { // итог
      body = `<div class="rsp-sec-title">🧾 Итог варианта</div>
        <table class="rsp-table"><tbody>
          <tr><td class="rsp-lft">Вариант</td><td>${escH(entry.label || entry.id)}${entry.isMainVariant ? ' · <b style="color:#16a34a">★ основной</b>' : ''}</td></tr>
          <tr><td class="rsp-lft">CAPEX (год 0)</td><td><b>${fmtMoney(t.equipmentCost + t.installationCost, cur0)}</b></td></tr>
        </tbody></table>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          ${entry.isMainVariant ? '' : `<button type="button" class="rs-cs-btn" data-var-act="setmain">★ Сделать основным</button>`}
          <button type="button" class="rs-cs-btn" data-var-act="compare">📈 К сравнению вариантов</button>
        </div>
        <div class="rsp-note">ℹ «Применить к схеме» / печать (мост к существующей логике) — инкремент i4. Сейчас вариант сохраняется автоматически (имя — во вкладке Spec).</div>`;
    }
    const tab = (id, lbl) => `<div class="rsp-tab ${variantTab === id ? 'active' : ''}" data-vtab="${id}">${lbl}</div>`;
    return `__VARIANT__
      <div class="rsp-head">
        <h3 title="Редактирование конкретного варианта подбора.">📋 Подбор «${escH(selName)}» → Вариант «${escH(entry.label || entry.id)}»</h3>
        <span class="rsp-sub">${escH(o.kind)} · вариант</span>
      </div>
      <div class="rsp-tabs">${tab('spec', '⚙ Spec')}${tab('akb', '🔋 АКБ')}${tab('capex', '💰 CAPEX (входные)')}${tab('itog', '🧾 Итог')}</div>
      <div class="rsp-body">${condBannerHtml(meta)}${body}</div>`;
  }

  // v0.60.430: авто-выбор активного подбора, если явный ещё не задан —
  // самый свежий по записи подбора, иначе по самому свежему варианту.
  // Чтобы панель не была пустой при заходе/после сохранения из wizard.
  function autoSelName() {
    const metas = listSelectionMetas(kind, { projectCode: pc });
    if (metas && metas.length) return metas[0].selectionName || null;
    const cfgs = listConfigs(kind, { projectCode: pc });
    for (const c of cfgs) {
      const s = String(c.selectionName || '').trim();
      if (s) return s;
    }
    return null;
  }

  function render() {
    const explicit = (typeof o.getActiveSelectionName === 'function' ? o.getActiveSelectionName() : selName) || selName;
    selName = explicit || autoSelName();
    if (!selName) {
      mountEl.innerHTML = `<div class="rsp-wrap"><div class="rsp-body"><div class="rsp-empty">Выберите или создайте ПОДБОР в сайдбаре слева, чтобы задать условия и сравнить варианты по TCO/CAPEX/OPEX.</div></div></div>`;
      return;
    }
    const meta = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
    if (scopeMode === 'variant' && activeVariantId) {
      const vinner = renderVariant(meta);
      if (typeof vinner === 'string' && vinner.startsWith('__VARIANT__')) {
        mountEl.innerHTML = `<div class="rsp-wrap">${vinner.slice('__VARIANT__'.length)}</div>`;
        mountEl.querySelectorAll('.rsp-tab[data-vtab]').forEach(t =>
          t.addEventListener('click', () => { variantTab = t.dataset.vtab; render(); }));
        mountEl.querySelectorAll('[data-var]').forEach(inp => inp.addEventListener('change', () => {
          const e = getConfig(kind, activeVariantId); if (!e) return;
          saveConfig(kind, { ...e, [inp.dataset.var]: inp.value });
        }));
        mountEl.querySelectorAll('[data-var-act]').forEach(b => b.addEventListener('click', () => {
          const act = b.dataset.varAct;
          if (act === 'back') { scopeMode = 'selection'; activeTab = 'general'; render();
            try { window.dispatchEvent(new CustomEvent('rs-cs-focus', { detail: { kind, scope: 'selection', selectionName: selName } })); } catch {} }
          else if (act === 'compare') { scopeMode = 'selection'; activeTab = 'compare'; render();
            try { window.dispatchEvent(new CustomEvent('rs-cs-focus', { detail: { kind, scope: 'selection', selectionName: selName } })); } catch {} }
          else if (act === 'setmain') { try { setMainVariant(kind, selName, activeVariantId); } catch {} render(); }
        }));
        _bindCapEdit();
        bindRateBar();
        // v0.60.464 (B2.2 i2): хост рисует Spec-выбор модели в [data-vspec-host].
        if (variantTab === 'spec' && typeof o.variantSpec === 'function') {
          const host = mountEl.querySelector('[data-vspec-host]');
          if (host) {
            try {
              o.variantSpec({
                host,
                entry: getConfig(kind, activeVariantId) || {},
                req: (meta && meta.requirements) || {},
                kind,
                // Тихое сохранение payload/label варианта БЕЗ перерисовки
                // панели (иначе теряется состояние каскада-пикера).
                save(patch) {
                  const e = getConfig(kind, activeVariantId);
                  if (!e) return;
                  const ne = { ...e };
                  if (patch && patch.payload) ne.payload = { ...(e.payload || {}), ...patch.payload };
                  if (patch && patch.label != null) ne.label = patch.label;
                  saveConfig(kind, ne);
                },
                refresh: render,
              });
            } catch (e) { console.warn('[selection-panel] variantSpec failed', e); }
          }
        }
        return;
      }
    }
    // v0.60.456: CAPEX убран из ПОДБОР-зоны — цена задаётся в ВАРИАНТЕ
    // (вкладка CAPEX варианта: построчно, цена за 1 элемент × Кол-во ×
    // своя валюта на пункт → стоимость на всём объекте). В подборе —
    // только условия и сравнение.
    if (activeTab === 'capex') activeTab = 'general';
    const inner = activeTab === 'general' ? renderGeneral(meta) : renderCompare(meta);
    mountEl.innerHTML = `
      <div class="rsp-wrap">
        <div class="rsp-head">
          <h3 title="Активный подбор. Условия — общие для всех вариантов; цены — в вариантах.">📋 Подбор «${escH(selName)}»</h3>
          <span class="rsp-sub">${escH(o.kind)} · условия + TCO</span>
        </div>
        <div class="rsp-tabs">
          <div class="rsp-tab ${activeTab === 'general' ? 'active' : ''}" data-tab="general" title="Общие условия подбора и финансовые параметры.">📋 Свойства подбора</div>
          <div class="rsp-tab ${activeTab === 'compare' ? 'active' : ''}" data-tab="compare" title="Сравнение вариантов: CAPEX / OPEX / TCO / окупаемость.">📈 TCO / Сравнение</div>
        </div>
        <div class="rsp-body">${inner}</div>
      </div>`;

    mountEl.querySelectorAll('.rsp-tab[data-tab]').forEach(t => t.addEventListener('click', () => {
      activeTab = t.dataset.tab; render();
    }));
    mountEl.querySelectorAll('[data-req]').forEach(inp => {
      inp.addEventListener('change', () => {
        const m = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
        const req = { ...((m && m.requirements) || {}) };
        const k = inp.dataset.req;
        req[k] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        persist({ requirements: req });
      });
    });
    // v0.60.451: мультивыбор допустимых типов (чекбоксы) → массив.
    const _multiKeys = new Set([...mountEl.querySelectorAll('[data-reqmulti]')].map(i => i.dataset.reqmulti));
    _multiKeys.forEach(key => {
      mountEl.querySelectorAll(`[data-reqmulti="${key}"]`).forEach(cb => {
        cb.addEventListener('change', () => {
          const m = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
          const req = { ...((m && m.requirements) || {}) };
          req[key] = [...mountEl.querySelectorAll(`[data-reqmulti="${key}"]:checked`)].map(x => x.value);
          persist({ requirements: req });
          // НЕ перерисовываем — иначе теряются фокус и состояние соседних
          // чекбоксов при быстром выборе нескольких типов.
        });
      });
    });
    mountEl.querySelectorAll('[data-eco]').forEach(inp => {
      inp.addEventListener('change', () => {
        const m = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
        const eco = { ...selEcoOf(m) };
        const k = inp.dataset.eco;
        eco[k] = inp.tagName === 'SELECT' ? inp.value : (inp.value === '' ? '' : Number(inp.value));
        persist({ eco });
        if (activeTab === 'compare') render();
      });
    });
    _bindCapEdit();
    bindRateBar();
  }

  // v0.60.454/455: «✏ Состав» — построчный редактор статей затрат варианта
  // (единый shared/ui/cost-items-modal.js, как «Подбор холода»). Используется
  // и в подбор-зоне (список вариантов), и в зоне варианта (вкладка CAPEX).
  function _bindCapEdit() {
    mountEl.querySelectorAll('[data-cap-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-cap-edit');
        const entry = getConfig(kind, id);
        if (!entry) return;
        const m = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
        const cur0 = (effEco(m).currency) || '₸';
        let start = (entry.eco && Array.isArray(entry.eco.costItems) && entry.eco.costItems.length)
          ? entry.eco.costItems : null;
        if (!start) {
          try { const e = o.variantEconomics(entry, effEco(m), (m && m.requirements) || {}) || {};
            start = Array.isArray(e.costItems) ? e.costItems : []; } catch { start = []; }
        }
        const res = await openCostItemsModal(start, cur0, cvFn());
        if (res == null) return;
        saveConfig(kind, { ...entry, eco: { ...(entry.eco || {}), costItems: res } });
        render();
      });
    });
  }

  // Перерисовка при изменении конфигураций: на вкладке сравнения всегда;
  // и когда подбор ещё не выбран — чтобы подхватить только что созданный
  // (в т.ч. сохранение из wizard, минующее сайдбар).
  const off = onConfigsChange(kind, () => { if (activeTab === 'compare' || !selName) render(); });
  render();
  // v0.60.458: подгрузить курс на сегодня из централизованного кэша
  // (повторно не грузится — берётся из LS, если дата уже была).
  loadRates(false);

  return {
    refresh: render,
    setSelection(name) { selName = name || null; scopeMode = 'selection'; render(); },
    setProjectCode(v) { pc = v || null; selName = null; scopeMode = 'selection'; render(); },
    // v0.60.455 (B2.2 i1): зона варианта в самой панели (cooling-style).
    setVariant(id) { activeVariantId = id || null; scopeMode = id ? 'variant' : 'selection'; variantTab = 'spec'; render(); },
    setScopeSelection() { scopeMode = 'selection'; render(); },
    destroy() { try { off && off(); } catch {} },
  };
}
