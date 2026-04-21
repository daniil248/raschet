// =========================================================================
// shared/pdu-picker-modal.js
//
// Модальный подбор PDU с ранжированием по требованиям (фазы/номинал/
// высота/категория/розетки/производитель). Тот же движок, что в
// отдельном модуле /pdu-config/, но в модалке — можно вызывать из
// rack-config, mv-config, mdc-config, не открывая новую вкладку.
//
// Использование:
//
//   import { openPduPickerModal } from '../shared/pdu-picker-modal.js';
//   openPduPickerModal({
//     initial: { phases:'3', rating:32, height:'0U', outlets:{c13:16,c19:4,schuko:0} },
//     extraFooter: '<label>...</label>', // HTML-строка (пара, цвета)
//     onExtraMount: box => { ... привязать хэндлеры к extraFooter ... },
//     onPick: ({ sku, pdu, state }) => { ... },
//     onClear: () => { ... }, // «Произвольная»
//   });
//
// =========================================================================

import { listElements } from './element-library.js';
import { initCatalogBridge, syncLegacyToLibrary } from './catalog-bridge.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CATEGORY_LABEL = {
  basic: 'Basic',
  metered: 'Metered',
  monitored: 'Monitored',
  switched: 'Switched',
  hybrid: 'Hybrid',
};

let _pdusCache = null;
async function loadPdus() {
  if (_pdusCache) return _pdusCache;
  initCatalogBridge();
  await syncLegacyToLibrary();
  _pdusCache = listElements({ kind: 'pdu' });
  return _pdusCache;
}

function countOutlets(pdu) {
  const outlets = (pdu.kindProps && pdu.kindProps.outlets) || [];
  let c13 = 0, c19 = 0, schuko = 0, other = 0;
  for (const o of outlets) {
    const type = String(o.type || '').toLowerCase();
    const qty = Number(o.qty ?? o.count) || 0;
    if (type === 'c13') c13 += qty;
    else if (type === 'c19') c19 += qty;
    else if (type === 'schuko' || type === 'cee7/4' || type === 'cee7') schuko += qty;
    else other += qty;
  }
  return { c13, c19, schuko, other, total: c13 + c19 + schuko + other };
}

function scoreCandidate(pdu, st) {
  const kp = pdu.kindProps || {};
  const el = pdu.electrical || {};
  if (st.phases !== 'any' && String(kp.phases || el.phases || '') !== String(st.phases)) return null;
  if (st.category !== 'any' && kp.category !== st.category) return null;
  if (st.height !== 'any' && String(kp.height) !== String(st.height)) return null;
  if (st.mfgs.size > 0 && !st.mfgs.has(pdu.manufacturer)) return null;
  const rating = Number(kp.rating || el.capacityA || 0);
  if (rating < st.rating) return null;

  const has = countOutlets(pdu);
  const need = st.outlets;
  const covC13    = need.c13 === 0    ? 1 : Math.min(1, has.c13    / need.c13);
  const covC19    = need.c19 === 0    ? 1 : Math.min(1, has.c19    / need.c19);
  const covSchuko = need.schuko === 0 ? 1 : Math.min(1, has.schuko / need.schuko);
  const covAll = (covC13 + covC19 + covSchuko) / 3;
  if (covAll < 1 && (need.c13 || need.c19 || need.schuko)) return null;

  let score = 50 * covAll;
  const ratingRatio = st.rating > 0 ? st.rating / rating : 1;
  score += 20 * Math.max(0, Math.min(1, ratingRatio));
  const needTotal = need.c13 + need.c19 + need.schuko;
  const overhead = needTotal > 0 ? Math.max(0, has.total - needTotal) / Math.max(1, has.total) : 0;
  score += 15 * (1 - overhead);
  if (st.category !== 'any') score += 5;
  if (st.height !== 'any') score += 5;

  return { score: Math.min(100, Math.round(score)), outlets: has, rating };
}

// === Главная экспортируемая функция ===
export async function openPduPickerModal(opts) {
  const {
    initial = {},
    title = 'Подбор PDU',
    selectedSku = '',
    extraFooter = '',
    onExtraMount = null,
    onPick = null,
    onClear = null,
  } = opts || {};

  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--rs-bg-card, #fff);color:var(--rs-fg, #333);border-radius:10px;max-width:1200px;width:96%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  back.appendChild(box);
  document.body.appendChild(back);

  // Loading
  box.innerHTML = `<div style="padding:40px;text-align:center;color:var(--rs-fg-muted)">Загрузка каталога PDU…</div>`;
  let pdus = [];
  try {
    pdus = await loadPdus();
  } catch (e) {
    box.innerHTML = `<div style="padding:40px;text-align:center;color:#c62828">Ошибка загрузки PDU: ${esc(e.message || e)}</div>`;
    return;
  }

  const allMfgs = Array.from(new Set(pdus.map(p => p.manufacturer).filter(Boolean))).sort();

  const st = {
    phases: initial.phases != null ? String(initial.phases) : '3',
    rating: Number(initial.rating) || 0,
    height: initial.height || 'any',
    category: initial.category || 'any',
    outlets: {
      c13: Number(initial.outlets && initial.outlets.c13) || 0,
      c19: Number(initial.outlets && initial.outlets.c19) || 0,
      schuko: Number(initial.outlets && initial.outlets.schuko) || 0,
    },
    mfgs: new Set(initial.mfgs || []),
  };

  function close() { back.remove(); }

  function render() {
    const candidates = [];
    for (const p of pdus) {
      const s = scoreCandidate(p, st);
      if (s) candidates.push({ pdu: p, ...s });
    }
    candidates.sort((a, b) => b.score - a.score);

    const chipsHtml = allMfgs.map(m =>
      `<button type="button" class="pdm-chip${st.mfgs.has(m) ? ' on' : ''}" data-mfg="${esc(m)}">${esc(m)}</button>`
    ).join('');

    const rows = candidates.length ? candidates.map(r => {
      const p = r.pdu;
      const kp = p.kindProps || {};
      const sel = selectedSku && (kp.sku === selectedSku || p.id === selectedSku);
      const outletsStr = [
        r.outlets.c13 ? `C13×${r.outlets.c13}` : '',
        r.outlets.c19 ? `C19×${r.outlets.c19}` : '',
        r.outlets.schuko ? `Schuko×${r.outlets.schuko}` : '',
        r.outlets.other ? `+${r.outlets.other} др.` : '',
      ].filter(Boolean).join(' · ');
      return `
        <tr data-sku="${esc(kp.sku || p.variant || p.id)}"${sel?' style="background:var(--rs-accent-bg, #e3f2fd)"':''}>
          <td><code style="font-size:11px">${esc(kp.sku || p.variant || p.id)}</code><br><span style="font-size:11px;color:var(--rs-fg-muted, #888)">${esc(p.manufacturer || '—')}</span></td>
          <td>${esc(p.label)}</td>
          <td style="font-size:11px">${esc(CATEGORY_LABEL[kp.category] || kp.category || '—')}</td>
          <td style="font-size:11px">${kp.phases || '—'}ф · ${r.rating} A · ${kp.height === 0 || kp.height === '0' ? '0U верт.' : (kp.height ? kp.height + 'U' : '—')}</td>
          <td style="font-size:11px">${esc(outletsStr)}</td>
          <td style="white-space:nowrap"><b>${r.score}</b><span class="pdm-bar"><i style="width:${r.score}%"></i></span></td>
          <td><button type="button" class="pdm-btn ${sel?'pdm-btn-primary':''}" data-pdm-pick="${esc(kp.sku || p.variant || p.id)}">${sel?'✓':'Выбрать'}</button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--rs-fg-muted, #888)">
      Нет моделей под требования. Снизьте rating, сбросьте фильтр производителя или уменьшите число розеток.
    </td></tr>`;

    box.innerHTML = `
      <style>
        .pdm-chip { font-size:11px;padding:3px 9px;border:1px solid var(--rs-border, #ccc);border-radius:14px;cursor:pointer;background:var(--rs-bg-card, #fff);color:var(--rs-fg, #333) }
        .pdm-chip.on { background:#1976d2;color:#fff;border-color:#1976d2 }
        .pdm-btn { font-size:12px;padding:5px 10px;border:1px solid var(--rs-border, #ccc);border-radius:4px;background:var(--rs-bg-card, #fff);color:var(--rs-fg, #333);cursor:pointer }
        .pdm-btn-primary { background:#1976d2;color:#fff;border-color:#1976d2 }
        .pdm-bar { display:inline-block;width:50px;height:5px;background:#eee;border-radius:3px;overflow:hidden;margin-left:6px;vertical-align:middle }
        .pdm-bar > i { display:block;height:100%;background:#4caf50 }
        .pdm-table { width:100%;border-collapse:collapse;font-size:12px }
        .pdm-table th, .pdm-table td { padding:6px 8px;border-bottom:1px solid var(--rs-border-hair, #eee);vertical-align:top;text-align:left }
        .pdm-table th { background:var(--rs-bg-soft, #f7f7f7);font-size:10px;text-transform:uppercase;letter-spacing:0.3px;color:var(--rs-fg-muted, #888) }
        .pdm-field { display:flex;flex-direction:column;gap:3px;font-size:11px }
        .pdm-field > span { color:var(--rs-fg-muted, #888);text-transform:uppercase;font-size:10px;letter-spacing:0.3px }
        .pdm-field select, .pdm-field input { font:inherit;font-size:13px;padding:5px 7px;border:1px solid var(--rs-border, #ccc);border-radius:3px;background:var(--rs-bg-card, #fff);color:var(--rs-fg, #333) }
      </style>
      <div style="padding:14px 20px;border-bottom:1px solid var(--rs-border-soft, #eee);display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:15px">${esc(title)} <span style="font-weight:400;font-size:12px;color:var(--rs-fg-muted, #888)">· найдено: ${candidates.length} из ${pdus.length}</span></h3>
        <button type="button" class="pdm-btn" id="pdm-close">✕</button>
      </div>
      <div style="padding:12px 20px;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,2fr);gap:16px;border-bottom:1px solid var(--rs-border-soft, #eee);align-items:start">
        <div>
          <div style="font-size:11px;color:var(--rs-fg-muted, #888);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Требования</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
            <label class="pdm-field"><span>Фаз</span>
              <select id="pdm-ph">
                <option value="any" ${st.phases==='any'?'selected':''}>Любое</option>
                <option value="1" ${st.phases==='1'?'selected':''}>1ф</option>
                <option value="3" ${st.phases==='3'?'selected':''}>3ф</option>
              </select>
            </label>
            <label class="pdm-field"><span>Номинал, A (≥)</span>
              <input id="pdm-rat" type="number" min="0" max="125" step="1" value="${st.rating}">
            </label>
            <label class="pdm-field"><span>Высота</span>
              <select id="pdm-h">
                <option value="any" ${st.height==='any'?'selected':''}>Любая</option>
                <option value="0" ${String(st.height)==='0'?'selected':''}>0U (верт.)</option>
                <option value="1" ${String(st.height)==='1'?'selected':''}>1U</option>
                <option value="2" ${String(st.height)==='2'?'selected':''}>2U</option>
              </select>
            </label>
          </div>
          <label class="pdm-field" style="margin-bottom:8px"><span>Категория</span>
            <select id="pdm-cat">
              <option value="any" ${st.category==='any'?'selected':''}>Любая</option>
              <option value="basic" ${st.category==='basic'?'selected':''}>Basic (без измерений)</option>
              <option value="metered" ${st.category==='metered'?'selected':''}>Metered (ввод)</option>
              <option value="monitored" ${st.category==='monitored'?'selected':''}>Monitored (per-outlet)</option>
              <option value="switched" ${st.category==='switched'?'selected':''}>Switched (удалённое упр.)</option>
              <option value="hybrid" ${st.category==='hybrid'?'selected':''}>Hybrid</option>
            </select>
          </label>
          <div style="font-size:11px;color:var(--rs-fg-muted, #888);text-transform:uppercase;letter-spacing:0.3px;margin:8px 0 4px">Минимум розеток</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            <label class="pdm-field"><span>C13 ≥</span>
              <input id="pdm-c13" type="number" min="0" max="48" value="${st.outlets.c13}">
            </label>
            <label class="pdm-field"><span>C19 ≥</span>
              <input id="pdm-c19" type="number" min="0" max="24" value="${st.outlets.c19}">
            </label>
            <label class="pdm-field"><span>Schuko ≥</span>
              <input id="pdm-sch" type="number" min="0" max="24" value="${st.outlets.schuko}">
            </label>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--rs-fg-muted, #888);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Производитель (клик — переключить)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${chipsHtml}</div>
          <div style="margin-top:12px;font-size:11px;color:var(--rs-fg-muted, #888);line-height:1.5">
            <b>Score 0–100:</b> покрытие розеток (50), близость номинала (20), минимум перерасхода (15), точность по категории/высоте (10).
            Модели с неполным покрытием розеток скрыты — уменьшите минимумы, если ничего не найдено.
          </div>
        </div>
      </div>
      <div style="overflow:auto;flex:1 1 auto;padding:4px 20px 12px 20px">
        <table class="pdm-table">
          <thead><tr>
            <th>SKU / Производитель</th><th>Модель</th><th>Категория</th><th>Параметры</th><th>Розетки</th><th>Score</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--rs-border-soft, #eee);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
        <button type="button" class="pdm-btn" id="pdm-clear">— Произвольная (лист требований) —</button>
        <div id="pdm-extra" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${extraFooter}</div>
        <button type="button" class="pdm-btn" id="pdm-cancel">Закрыть</button>
      </div>
    `;

    // wire
    const bind = (id, ev, fn) => {
      const e = box.querySelector(id);
      if (e) e.addEventListener(ev, fn);
    };
    bind('#pdm-close', 'click', close);
    bind('#pdm-cancel', 'click', close);
    bind('#pdm-clear', 'click', () => {
      if (onClear) onClear();
      else if (onPick) onPick({ sku: '', pdu: null, state: st });
      close();
    });
    bind('#pdm-ph',  'change', e => { st.phases = e.target.value; render(); });
    bind('#pdm-rat', 'change', e => { st.rating = Number(e.target.value) || 0; render(); });
    bind('#pdm-h',   'change', e => { st.height = e.target.value; render(); });
    bind('#pdm-cat', 'change', e => { st.category = e.target.value; render(); });
    bind('#pdm-c13', 'change', e => { st.outlets.c13 = Number(e.target.value) || 0; render(); });
    bind('#pdm-c19', 'change', e => { st.outlets.c19 = Number(e.target.value) || 0; render(); });
    bind('#pdm-sch', 'change', e => { st.outlets.schuko = Number(e.target.value) || 0; render(); });
    box.querySelectorAll('.pdm-chip').forEach(btn => {
      btn.onclick = () => {
        const m = btn.dataset.mfg;
        if (st.mfgs.has(m)) st.mfgs.delete(m); else st.mfgs.add(m);
        render();
      };
    });
    box.querySelectorAll('[data-pdm-pick]').forEach(btn => {
      btn.onclick = () => {
        const sku = btn.dataset.pdmPick;
        const pdu = pdus.find(p => (p.kindProps && p.kindProps.sku) === sku || p.variant === sku || p.id === sku);
        if (onPick) onPick({ sku, pdu, state: st });
        close();
      };
    });
    if (onExtraMount) onExtraMount(box);
  }

  render();
  back.addEventListener('click', e => { if (e.target === back) close(); });
}
