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
  listConfigs, onConfigsChange,
} from './configuration-catalog.js';
import {
  DEFAULT_ECONOMICS, computeTco, discountedPaybackYears, convertEcoToCurrency,
} from './calc/capex-tco.js';
import { CURRENCIES, fmtMoney } from './money.js';

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
  .rsp-wrap{border:2px solid #6366f1;border-radius:8px;margin:16px 0;background:#fff;font:13px/1.45 system-ui,sans-serif}
  .rsp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#eef2ff;border-bottom:1px solid #c7d2fe;border-radius:6px 6px 0 0}
  .rsp-head h3{margin:0;font-size:15px;color:#3730a3}
  .rsp-sub{font-size:12px;color:#6366f1}
  .rsp-tabs{display:flex;gap:4px;padding:8px 14px 0;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
  .rsp-tab{padding:7px 14px;border:1px solid #e2e8f0;border-bottom:none;border-radius:6px 6px 0 0;background:#f8fafc;cursor:pointer;font-size:12.5px;color:#475569}
  .rsp-tab.active{background:#fff;color:#3730a3;font-weight:600;border-color:#c7d2fe}
  .rsp-body{padding:14px}
  .rsp-sec-title{font-weight:600;color:#334155;margin:4px 0 8px;font-size:13px}
  .rsp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
  .rsp-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#475569}
  .rsp-field input,.rsp-field select{padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font:inherit}
  .rsp-note{font-size:11.5px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:7px 10px;margin:10px 0 0}
  .rsp-empty{color:#64748b;text-align:center;padding:26px 10px;font-size:13px}
  .rsp-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
  .rsp-table th,.rsp-table td{border:1px solid #e2e8f0;padding:6px 8px;text-align:right;white-space:nowrap}
  .rsp-table th{background:#f1f5f9;color:#334155;font-weight:600;text-align:right}
  .rsp-table td.rsp-lft,.rsp-table th.rsp-lft{text-align:left}
  .rsp-table tr.rsp-main td{background:#fffbeb}
  .rsp-best{background:#dcfce7!important;font-weight:700;color:#166534}
  .rsp-divider{height:1px;background:#e2e8f0;margin:14px 0}
  `;
  document.head.appendChild(s);
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
 *  @param {function|null} [o.convertFn]
 */
export function mountSelectionPanel(o) {
  injectCss();
  const mountEl = o.mountEl;
  if (!mountEl) return { refresh() {}, setSelection() {} };
  const kind = o.kind;
  const pc = o.projectCode || null;
  let activeTab = 'general';
  let selName = (typeof o.getActiveSelectionName === 'function' ? o.getActiveSelectionName() : null) || null;

  function selEcoOf(meta) {
    return { ...DEFAULT_ECONOMICS, tariff: 0, ...(meta && meta.eco || {}) };
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
    const eco = selEcoOf(meta);
    const reqHtml = (o.requirementsSchema || []).map(f => {
      const v = req[f.key];
      if (f.type === 'select') {
        const opts = (f.options || []).map(op => {
          const val = typeof op === 'string' ? op : op.value;
          const lab = typeof op === 'string' ? op : op.label;
          return `<option value="${escH(val)}"${String(v) === String(val) ? ' selected' : ''}>${escH(lab)}</option>`;
        }).join('');
        return `<label class="rsp-field" title="${escH(f.tip || '')}">${escH(f.label)}${f.unit ? ', ' + escH(f.unit) : ''}
          <select data-req="${escH(f.key)}">${opts}</select></label>`;
      }
      const type = f.type === 'text' ? 'text' : 'number';
      return `<label class="rsp-field" title="${escH(f.tip || '')}">${escH(f.label)}${f.unit ? ', ' + escH(f.unit) : ''}
        <input type="${type}" data-req="${escH(f.key)}" ${f.step ? `step="${f.step}"` : ''} value="${escH(v == null ? '' : v)}"></label>`;
    }).join('');

    const curOpts = CURRENCIES.map(c =>
      `<option value="${c.code}"${c.code === (eco.currency || '₸') ? ' selected' : ''} title="${escH(c.label)}">${c.code}</option>`).join('');
    const finHtml = FIN_FIELDS.map(f =>
      `<label class="rsp-field" title="${escH(f.tip)}">${escH(f.label)}
        <input type="number" data-eco="${f.key}" step="${f.step}" value="${escH(eco[f.key] == null ? '' : eco[f.key])}"></label>`).join('');

    return `
      <div class="rsp-sec-title" title="Общие УСЛОВИЯ подбора — одинаковы для всех вариантов. Конкретные решения задаются в вариантах.">📋 Условия подбора</div>
      <div class="rsp-grid">${reqHtml || '<span class="rsp-empty">Нет полей условий</span>'}</div>
      <div class="rsp-divider"></div>
      <div class="rsp-sec-title" title="Финансовые параметры — общие для всех вариантов, чтобы сравнение TCO было на одинаковых условиях (как в «Подбор холода»).">💰 Финансовые параметры (общие для всех вариантов)</div>
      <div class="rsp-grid">
        <label class="rsp-field" title="Валюта подбора — все CAPEX/OPEX/TCO приводятся к ней по курсу.">Валюта подбора
          <select data-eco="currency">${curOpts}</select></label>
        ${finHtml}
      </div>
      <div class="rsp-note">ℹ Условия и финансы хранятся на уровне ПОДБОРА. Варианты сравниваются на одинаковых условиях во вкладке «📈 TCO / Сравнение».</div>
    `;
  }

  function renderCompare(meta) {
    const eco = selEcoOf(meta);
    const req = (meta && meta.requirements) || {};
    const cur = eco.currency || '₸';
    const variants = listConfigs(kind, { projectCode: pc, selectionName: selName });
    if (!variants.length) {
      return `<div class="rsp-empty">В подборе «${escH(selName)}» пока нет вариантов.<br>Сохраните решение как вариант этого подбора.</div>`;
    }
    const rows = variants.map(v => {
      let ec = {};
      try { ec = o.variantEconomics(v, eco, req) || {}; } catch { ec = {}; }
      const ecoForCalc = ec.eco
        ? ec.eco
        : { ...eco, costItems: Array.isArray(ec.costItems) ? ec.costItems : [] };
      const flat = convertEcoToCurrency(ecoForCalc, cur, o.convertFn || null);
      const t = computeTco({
        annualEnergyKwh: Number(ec.annualEnergyKwh) || 0,
        tariffRubKwh: Number(eco.tariff) || 0,
        eco: flat,
      });
      return { v, t, isMain: !!v.isMainVariant };
    });
    const main = rows.find(r => r.isMain) || rows[0];
    const best = { capex: Math.min(...rows.map(r => r.t.capex)), tco: Math.min(...rows.map(r => r.t.tco)) };
    const lblOf = (entry) => (typeof o.variantLabel === 'function' ? o.variantLabel(entry) : (entry.label || entry.id));

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
      <div class="rsp-sec-title" title="Технико-экономическое сравнение вариантов подбора. TCO = CAPEX + Σ дисконтированных OPEX за срок проекта (ISO 15686-5).">⚖ Сравнение вариантов · TCO ${main ? main.t.projectLifetimeYears : eco.projectLifetimeYears} лет</div>
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

  function render() {
    selName = (typeof o.getActiveSelectionName === 'function' ? o.getActiveSelectionName() : selName) || selName;
    if (!selName) {
      mountEl.innerHTML = `<div class="rsp-wrap"><div class="rsp-body"><div class="rsp-empty">Выберите или создайте ПОДБОР в сайдбаре слева, чтобы задать условия и сравнить варианты по TCO/CAPEX/OPEX.</div></div></div>`;
      return;
    }
    const meta = getSelectionMeta(kind, { projectCode: pc, selectionName: selName });
    const inner = activeTab === 'general' ? renderGeneral(meta) : renderCompare(meta);
    mountEl.innerHTML = `
      <div class="rsp-wrap">
        <div class="rsp-head">
          <h3 title="Активный подбор. Условия — общие для всех вариантов.">📋 Подбор «${escH(selName)}»</h3>
          <span class="rsp-sub">${escH(o.kind)} · условия + TCO</span>
        </div>
        <div class="rsp-tabs">
          <div class="rsp-tab ${activeTab === 'general' ? 'active' : ''}" data-tab="general" title="Общие условия подбора и финансовые параметры.">📋 Свойства подбора</div>
          <div class="rsp-tab ${activeTab === 'compare' ? 'active' : ''}" data-tab="compare" title="Сравнение вариантов: CAPEX / OPEX / TCO / окупаемость.">📈 TCO / Сравнение</div>
        </div>
        <div class="rsp-body">${inner}</div>
      </div>`;

    mountEl.querySelectorAll('.rsp-tab').forEach(t => t.addEventListener('click', () => {
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
  }

  const off = onConfigsChange(kind, () => { if (activeTab === 'compare') render(); });
  render();

  return {
    refresh: render,
    setSelection(name) { selName = name || null; render(); },
    destroy() { try { off && off(); } catch {} },
  };
}
