// =========================================================================
// shared/pdu-picker-modal.js  (v0.59.121)
//
// Модальный подбор PDU. Переписано:
//  • перемещаемый заголовок (драг за шапку);
//  • фиксированный размер — не "пляшет" при изменении числа строк;
//  • чистый структурированный фильтр-требование (2 колонки: слева — параметры,
//    справа — чипсы производителя + легенда score);
//  • 4 действия в подвале: «выбрать модель» (по строке), «перенести
//    только требования», «распечатать требования», «открыть каталог».
//
// API — прежний (onPick / onClear / extraFooter). Добавлено:
//   onTransferReqs?: (state) => void  — «⬇ Перенести только требования»
//   onPrint?:        (state) => void  — «🖨 Распечатать» (если не передано —
//                                       используем дефолтный print-view)
//   catalogHref?:    string           — ссылка на интерфейс каталога
//                                       (по умолчанию: <base>/catalog/?kind=pdu)
// =========================================================================

import { listElements } from './element-library.js';
import { initCatalogBridge, syncLegacyToLibrary } from './catalog-bridge.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CATEGORY_LABEL = {
  basic: 'Basic', metered: 'Metered', monitored: 'Monitored',
  switched: 'Switched', hybrid: 'Hybrid',
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

// ————— Default print-view —————
function defaultPrintRequirements(st) {
  const lines = [
    `<h2 style="margin:0 0 12px 0">Лист требований к PDU</h2>`,
    `<table style="border-collapse:collapse;font:13px/1.4 sans-serif">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Фазы</td><td><b>${esc(st.phases === 'any' ? 'Любое' : st.phases + 'ф')}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Номинал</td><td><b>≥ ${st.rating} A</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Высота</td><td><b>${esc(st.height === 'any' ? 'Любая' : (st.height === '0' || st.height === 0 ? '0U (вертик.)' : st.height + 'U'))}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Категория</td><td><b>${esc(CATEGORY_LABEL[st.category] || (st.category === 'any' ? 'Любая' : st.category))}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">C13</td><td><b>≥ ${st.outlets.c13}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">C19</td><td><b>≥ ${st.outlets.c19}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Schuko</td><td><b>≥ ${st.outlets.schuko}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Производители</td><td><b>${st.mfgs.size ? esc(Array.from(st.mfgs).join(', ')) : 'Любой'}</b></td></tr>
    </table>`,
    `<p style="margin-top:16px;font:11px/1.4 sans-serif;color:#888">Лист требований · Raschet · ${new Date().toLocaleDateString()}</p>`,
  ];
  const w = window.open('', '_blank', 'width=600,height=700');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Лист требований PDU</title></head><body style="padding:24px;font-family:sans-serif">${lines.join('')}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 100);
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
    onTransferReqs = null,
    onPrint = null,
    catalogHref = null,
  } = opts || {};

  // Вычисляем URL на каталог (если явно не задан) — относительный, работает
  // из любой подпрограммы. Текущий path: /raschet/<module>/ → ../catalog/
  let resolvedCatalogHref = catalogHref;
  if (!resolvedCatalogHref) {
    const p = location.pathname;
    const m = p.match(/^(.*?\/raschet\/)/);
    resolvedCatalogHref = (m ? m[1] : '../') + 'catalog/?filterKind=pdu';
  }

  const back = document.createElement('div');
  back.className = 'pdm-back';
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  // Фиксированный размер: 1200×80vh. Позиция — центр; после drag'а —
  // абсолютная. Min-height гарантирует, что модалка не схлопнется при
  // пустом результате.
  box.className = 'pdm-box';
  box.style.cssText = [
    'background:var(--rs-bg-card, #fff)',
    'color:var(--rs-fg, #1f2430)',
    'border-radius:10px',
    'width:min(1240px, 96vw)',
    'height:min(820px, 88vh)',
    'display:flex',
    'flex-direction:column',
    'box-shadow:0 20px 60px rgba(0,0,0,.4)',
    'position:relative',
  ].join(';');
  back.appendChild(box);
  document.body.appendChild(back);

  // Loading state
  box.innerHTML = `<div style="padding:40px;text-align:center;color:#888">Загрузка каталога PDU…</div>`;
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
        <tr data-sku="${esc(kp.sku || p.variant || p.id)}"${sel?' class="pdm-row-sel"':''}>
          <td><code style="font-size:11px">${esc(kp.sku || p.variant || p.id)}</code><br><span style="font-size:11px;color:#888">${esc(p.manufacturer || '—')}</span></td>
          <td>${esc(p.label)}</td>
          <td style="font-size:11px">${esc(CATEGORY_LABEL[kp.category] || kp.category || '—')}</td>
          <td style="font-size:11px">${kp.phases || '—'}ф · ${r.rating} A · ${kp.height === 0 || kp.height === '0' ? '0U верт.' : (kp.height ? kp.height + 'U' : '—')}</td>
          <td style="font-size:11px">${esc(outletsStr)}</td>
          <td style="white-space:nowrap"><b>${r.score}</b><span class="pdm-bar"><i style="width:${r.score}%"></i></span></td>
          <td><button type="button" class="pdm-btn ${sel?'pdm-btn-primary':''}" data-pdm-pick="${esc(kp.sku || p.variant || p.id)}">${sel?'✓':'Выбрать'}</button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;padding:40px;color:#888">
      Нет моделей под требования. Снизьте номинал, сбросьте фильтр производителя или уменьшите число розеток.
    </td></tr>`;

    box.innerHTML = `
      <style>
        .pdm-box * { box-sizing:border-box }
        .pdm-head {
          padding:12px 20px;border-bottom:1px solid #e0e3ea;display:flex;
          justify-content:space-between;align-items:center;gap:10px;
          cursor:move;user-select:none;background:#f8fafd;border-radius:10px 10px 0 0;
        }
        .pdm-head h3 { margin:0;font-size:15px;font-weight:600;color:#1f2430 }
        .pdm-head .pdm-sub { font-size:11px;color:#607080;font-weight:400;margin-left:8px }
        .pdm-filter {
          padding:14px 20px;border-bottom:1px solid #e0e3ea;
          display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr);gap:20px;
          align-items:start;background:#fcfdff;flex:0 0 auto;
        }
        .pdm-fgroup { margin-bottom:8px }
        .pdm-fgroup-h {
          font-size:10px;text-transform:uppercase;letter-spacing:0.4px;
          color:#607080;margin-bottom:6px;font-weight:600;
        }
        .pdm-row-grid { display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px }
        .pdm-field { display:flex;flex-direction:column;gap:3px;font-size:11px }
        .pdm-field > span { color:#607080;font-size:10px;letter-spacing:0.3px }
        .pdm-field select, .pdm-field input {
          font:inherit;font-size:13px;padding:6px 8px;
          border:1px solid #cfd6e0;border-radius:4px;background:#fff;color:#1f2430;
        }
        .pdm-field select:focus, .pdm-field input:focus { outline:2px solid #1976d2;outline-offset:-1px;border-color:#1976d2 }
        .pdm-legend { font-size:11px;color:#607080;line-height:1.55;background:#f0f4fa;padding:8px 10px;border-radius:5px;border:1px solid #d9e1ee }
        .pdm-legend b { color:#0d47a1 }

        .pdm-chip {
          font-size:11px;padding:3px 10px;border:1px solid #cfd6e0;border-radius:14px;
          cursor:pointer;background:#fff;color:#1f2430;
        }
        .pdm-chip:hover { border-color:#1976d2;color:#1976d2 }
        .pdm-chip.on { background:#1976d2;color:#fff;border-color:#1976d2 }
        .pdm-chips { display:flex;flex-wrap:wrap;gap:6px }

        .pdm-btn {
          font-size:12px;padding:5px 10px;border:1px solid #cfd6e0;border-radius:4px;
          background:#fff;color:#1f2430;cursor:pointer;font-family:inherit;
        }
        .pdm-btn:hover { border-color:#1976d2 }
        .pdm-btn-primary { background:#1976d2;color:#fff;border-color:#1976d2 }
        .pdm-btn-primary:hover { background:#1565c0;border-color:#1565c0 }
        .pdm-btn-ghost { border-color:transparent;color:#455a64 }
        .pdm-btn-ghost:hover { background:#eceff1;border-color:transparent;color:#1565c0 }
        .pdm-close { background:transparent;border:none;font-size:20px;color:#546e7a;padding:2px 8px;cursor:pointer;border-radius:4px }
        .pdm-close:hover { background:#eceff1;color:#c62828 }

        .pdm-bar { display:inline-block;width:50px;height:5px;background:#eee;border-radius:3px;overflow:hidden;margin-left:6px;vertical-align:middle }
        .pdm-bar > i { display:block;height:100%;background:#4caf50 }

        .pdm-body { flex:1 1 auto;overflow:auto;padding:4px 20px 12px 20px }
        .pdm-table { width:100%;border-collapse:collapse;font-size:12px }
        .pdm-table th, .pdm-table td { padding:7px 8px;border-bottom:1px solid #eef0f4;vertical-align:top;text-align:left }
        .pdm-table th { background:#f7f9fc;font-size:10px;text-transform:uppercase;letter-spacing:0.3px;color:#607080;position:sticky;top:0;z-index:1 }
        .pdm-table tr.pdm-row-sel { background:#e3f2fd }
        .pdm-table tr:hover:not(.pdm-row-sel) { background:#fafbfd }

        .pdm-foot {
          padding:10px 16px;border-top:1px solid #e0e3ea;background:#f8fafd;
          display:flex;align-items:center;gap:10px;flex-wrap:wrap;
          border-radius:0 0 10px 10px;
        }
        .pdm-foot .pdm-sp { flex:1 }
      </style>

      <!-- ——— DRAG HEADER ——— -->
      <div class="pdm-head" id="pdm-head">
        <div>
          <h3>${esc(title)}<span class="pdm-sub">· найдено: ${candidates.length} из ${pdus.length}</span></h3>
        </div>
        <button type="button" class="pdm-close" id="pdm-close" title="Закрыть">×</button>
      </div>

      <!-- ——— FILTER ——— -->
      <div class="pdm-filter">
        <div>
          <div class="pdm-fgroup">
            <div class="pdm-fgroup-h">Требования</div>
            <div class="pdm-row-grid">
              <label class="pdm-field"><span>Фаз</span>
                <select id="pdm-ph">
                  <option value="any" ${st.phases==='any'?'selected':''}>Любое</option>
                  <option value="1" ${st.phases==='1'?'selected':''}>1ф</option>
                  <option value="3" ${st.phases==='3'?'selected':''}>3ф</option>
                </select>
              </label>
              <label class="pdm-field"><span>Номинал, A ≥</span>
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
          </div>
          <div class="pdm-fgroup">
            <div class="pdm-fgroup-h">Категория</div>
            <label class="pdm-field">
              <select id="pdm-cat">
                <option value="any" ${st.category==='any'?'selected':''}>Любая</option>
                <option value="basic" ${st.category==='basic'?'selected':''}>Basic (без измерений)</option>
                <option value="metered" ${st.category==='metered'?'selected':''}>Metered (ввод)</option>
                <option value="monitored" ${st.category==='monitored'?'selected':''}>Monitored (per-outlet)</option>
                <option value="switched" ${st.category==='switched'?'selected':''}>Switched (удалённое упр.)</option>
                <option value="hybrid" ${st.category==='hybrid'?'selected':''}>Hybrid</option>
              </select>
            </label>
          </div>
          <div class="pdm-fgroup" style="margin-bottom:0">
            <div class="pdm-fgroup-h">Минимум розеток</div>
            <div class="pdm-row-grid">
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
        </div>
        <div>
          <div class="pdm-fgroup">
            <div class="pdm-fgroup-h">Производитель · клик переключает on/off</div>
            <div class="pdm-chips">${chipsHtml || '<span style="font-size:11px;color:#888">Нет данных</span>'}</div>
          </div>
          <div class="pdm-legend">
            <b>Score 0–100:</b> покрытие розеток (50), близость номинала (20), минимум перерасхода (15), точность по категории/высоте (10). Модели с неполным покрытием розеток скрыты — уменьшите минимумы, если ничего не найдено.
          </div>
        </div>
      </div>

      <!-- ——— TABLE ——— -->
      <div class="pdm-body">
        <table class="pdm-table">
          <thead><tr>
            <th>SKU / Производитель</th><th>Модель</th><th>Категория</th><th>Параметры</th><th>Розетки</th><th>Score</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <!-- ——— FOOTER: actions ——— -->
      <div class="pdm-foot">
        <button type="button" class="pdm-btn" id="pdm-clear">— Произвольная (лист требований) —</button>
        <button type="button" class="pdm-btn" id="pdm-transfer" title="Сохранить только требования (без конкретной модели) — rack-config применит rating/phases/height/outlets к PDU, не задавая SKU.">⬇ Перенести требования</button>
        <button type="button" class="pdm-btn" id="pdm-print" title="Распечатать лист требований (новая вкладка → диалог печати)">🖨 Распечатать</button>
        <a class="pdm-btn pdm-btn-ghost" href="${esc(resolvedCatalogHref)}" target="_blank" rel="noopener" title="Открыть интерфейс управления каталогом (новая вкладка)">Каталог ↗</a>
        <div id="pdm-extra" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${extraFooter}</div>
        <div class="pdm-sp"></div>
        <button type="button" class="pdm-btn" id="pdm-cancel">Закрыть</button>
      </div>
    `;

    // ——— wire ———
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
    bind('#pdm-transfer', 'click', () => {
      if (onTransferReqs) onTransferReqs(_snapshot(st));
      else _saveLastPduReqs(st);
      close();
    });
    bind('#pdm-print', 'click', () => {
      if (onPrint) onPrint(_snapshot(st));
      else defaultPrintRequirements(st);
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

    // ——— drag ———
    _wireDrag(box, box.querySelector('#pdm-head'));

    if (onExtraMount) onExtraMount(box);
  }

  render();
  // Backdrop click закрывает только если клик именно по подложке, а не
  // внутри box (чтобы draggable click не ловил false-close).
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
}

// ===== helpers =====

function _snapshot(st) {
  return {
    phases: st.phases,
    rating: st.rating,
    height: st.height,
    category: st.category,
    outlets: { ...st.outlets },
    mfgs: Array.from(st.mfgs),
  };
}

function _saveLastPduReqs(st) {
  try {
    localStorage.setItem('raschet.lastPduConfig.v1', JSON.stringify({
      sku: '',
      requirementsOnly: true,
      manufacturer: '',
      label: 'Лист требований',
      category: st.category === 'any' ? '' : st.category,
      phases: st.phases === 'any' ? 0 : Number(st.phases) || 0,
      rating: Number(st.rating) || 0,
      height: st.height === 'any' ? null : (Number(st.height) || 0),
      outlets: [
        st.outlets.c13 ? { type: 'C13', count: st.outlets.c13 } : null,
        st.outlets.c19 ? { type: 'C19', count: st.outlets.c19 } : null,
        st.outlets.schuko ? { type: 'Schuko', count: st.outlets.schuko } : null,
      ].filter(Boolean),
      selectedAt: Date.now(),
    }));
  } catch {}
}

// ——— Drag-behavior для шапки модалки ———
// Смена позиционирования с flex-центрирования на absolute top/left при
// первом drag'е. После — position:fixed + left/top в px.
function _wireDrag(box, head) {
  if (!head) return;
  let dragging = false, dx = 0, dy = 0;
  head.addEventListener('mousedown', (e) => {
    // Клик по крестику / кнопке — не начинаем drag
    if (e.target.closest('button, a, input, select')) return;
    dragging = true;
    const rect = box.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    // Снимаем flex-центрирование у backdrop'а, фиксируем box абсолютно.
    const back = box.parentElement;
    if (back && back.style.alignItems !== 'flex-start') {
      back.style.alignItems = 'flex-start';
      back.style.justifyContent = 'flex-start';
      box.style.position = 'absolute';
      box.style.left = rect.left + 'px';
      box.style.top  = rect.top + 'px';
      box.style.margin = '0';
    }
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy));
    box.style.left = x + 'px';
    box.style.top  = y + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
  });
}
