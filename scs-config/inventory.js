/* inventory.js — реестр всего оборудования проекта.
   Источники: state.contents (в шкафах), state.cart (тележка), state.warehouse (склад).
   Редактируемые поля: sn, status, note, maintMonths, lastMaintAt. Сохраняются
   обратно в тот же источник (mutation по id). */

import { ensureDefaultProject, getActiveProjectId, getProject, projectKey } from '../shared/project-storage.js';
// v0.59.278: project-scoped экземпляры стоек.
import { loadAllRacksForActiveProject, migrateLegacyInstances, LS_TEMPLATES_GLOBAL } from '../shared/rack-storage.js';

function renderProjectBanner() {
  const host = document.getElementById('pr-project-banner'); if (!host) return;
  const pid = getActiveProjectId();
  const p = pid ? getProject(pid) : null;
  if (!p) {
    host.innerHTML = `⚠ Реестр работает только в контексте проекта. <a href="../projects/">Создать/выбрать проект →</a>`;
    return;
  }
  const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  host.innerHTML = `📁 Проект: <b>${esc(p.name)}</b> <span class="muted">· id <code>${esc(p.id)}</code></span> <a href="../projects/" style="margin-left:8px">→ сменить</a>`;
}

const LS_RACK    = LS_TEMPLATES_GLOBAL;
const LS_CATALOG = 'scs-config.catalog.v1';

// Проектные ключи — выставляются в rescope при загрузке.
let LS_CONTENTS  = 'scs-config.contents.v1';
let LS_RACKTAGS  = 'scs-config.rackTags.v1';
let LS_CART      = 'scs-config.cart.v1';
let LS_WAREHOUSE = 'scs-config.warehouse.v1';

(function rescope(){
  ensureDefaultProject();
  const pid = getActiveProjectId();
  LS_CONTENTS  = projectKey(pid, 'scs-config', 'contents.v1');
  LS_RACKTAGS  = projectKey(pid, 'scs-config', 'rackTags.v1');
  LS_CART      = projectKey(pid, 'scs-config', 'cart.v1');
  LS_WAREHOUSE = projectKey(pid, 'scs-config', 'warehouse.v1');
  // миграция тут не нужна — scs-config.js её уже выполнит первым.
})();

const $ = id => document.getElementById(id);
const loadJson = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch { return f; } };
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

const STATUS = {
  active:         { icon: '🟢', label: 'Активен' },
  standby:        { icon: '🟡', label: 'Резерв' },
  maintenance:    { icon: '🛠', label: 'Обслуживание' },
  decommissioned: { icon: '⚫', label: 'Списан' },
};

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function dateToInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtAge(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return 'сегодня';
  if (days < 30) return `${days} дн. назад`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} мес. назад`;
  return `${Math.floor(months / 12)} г. назад`;
}

// v0.59.357: «обратная связь схема → реестр». Строим map по S/N и Инв.№ из
// узлов scheme.v1 проекта, чтобы в строке устройства показать бейдж
// «🔗 на схеме: <tag>».
function loadSchemeIndexBySnAsset(pid) {
  const out = { sn: new Map(), asset: new Map() };
  if (!pid) return out;
  let scheme;
  try { scheme = JSON.parse(localStorage.getItem(projectKey(pid, 'engine', 'scheme.v1')) || 'null'); } catch { scheme = null; }
  const nodes = scheme && Array.isArray(scheme.nodes) ? scheme.nodes : [];
  for (const n of nodes) {
    if (!n) continue;
    const ref = { id: n.id, tag: n.tag || '', name: n.name || '' };
    const sn = (n.serialNo || '').trim();
    const aid = (n.assetId || '').trim();
    if (sn) out.sn.set(sn, ref);
    if (aid) out.asset.set(aid, ref);
  }
  return out;
}

function collect() {
  migrateLegacyInstances();
  const racks     = loadAllRacksForActiveProject();
  const catalog   = loadJson(LS_CATALOG, []);
  const contents  = loadJson(LS_CONTENTS, {});
  const tags      = loadJson(LS_RACKTAGS, {});
  const cart      = loadJson(LS_CART, []);
  const warehouse = loadJson(LS_WAREHOUSE, []);
  const catBy = Object.fromEntries(catalog.map(c => [c.id, c]));
  const rackBy = Object.fromEntries(racks.map(r => [r.id, r]));

  const rows = [];

  // В шкафах
  Object.entries(contents).forEach(([rackId, devs]) => {
    const r = rackBy[rackId]; if (!r) return;
    const tag = (tags[rackId] || '').trim();
    (devs || []).forEach(d => {
      const t = catBy[d.typeId];
      const h = t ? (t.heightU || 1) : 1;
      const devTag = tag ? `${tag}.U${d.positionU - h + 1}` : '';
      rows.push({
        loc: 'rack',
        locLabel: `<a href="./rack.html?rackId=${encodeURIComponent(rackId)}">${esc(r.name)} · U${d.positionU - h + 1}</a>`,
        tag: devTag,
        item: d,
        type: t,
        source: { kind: 'rack', rackId },
      });
    });
  });

  // В тележке
  cart.forEach(d => {
    const t = catBy[d.typeId];
    rows.push({
      loc: 'cart',
      locLabel: '🛒 Тележка',
      tag: '',
      item: d,
      type: t,
      source: { kind: 'cart' },
    });
  });

  // На складе
  warehouse.forEach(d => {
    const t = catBy[d.typeId];
    rows.push({
      loc: 'warehouse',
      locLabel: `📦 Склад${d.address ? ' · <code>' + esc(d.address) + '</code>' : ''}`,
      tag: '',
      item: d,
      type: t,
      source: { kind: 'warehouse' },
    });
  });

  return rows;
}

function writeBack(source, id, patch) {
  if (source.kind === 'rack') {
    const contents = loadJson(LS_CONTENTS, {});
    const devs = contents[source.rackId] || [];
    const d = devs.find(x => x.id === id);
    if (d) { Object.assign(d, patch); saveJson(LS_CONTENTS, contents); }
  } else if (source.kind === 'cart') {
    const cart = loadJson(LS_CART, []);
    const d = cart.find(x => x.id === id);
    if (d) { Object.assign(d, patch); saveJson(LS_CART, cart); }
  } else if (source.kind === 'warehouse') {
    const wh = loadJson(LS_WAREHOUSE, []);
    const d = wh.find(x => x.id === id);
    if (d) { Object.assign(d, patch); saveJson(LS_WAREHOUSE, wh); }
  }
}

function render() {
  const q = $('flt-q').value.toLowerCase().trim();
  const locF = $('flt-loc').value;
  const stF = $('flt-status').value;
  const rows = collect().filter(row => {
    if (locF && row.loc !== locF) return false;
    const st = row.item.status || 'active';
    if (stF && st !== stF) return false;
    if (q) {
      const hay = [row.item.label, row.item.sn, row.tag, row.item.note, row.type?.label, row.locLabel].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $('count').textContent = `Найдено: ${rows.length}`;

  const tb = $('inv-tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center;padding:16px">Нет записей по фильтру.</td></tr>`;
    return;
  }

  const now = Date.now();
  const MS_MONTH = 30 * 86400000;
  const schemeIdx = loadSchemeIndexBySnAsset(getActiveProjectId());
  tb.innerHTML = rows.map((row, i) => {
    const d = row.item;
    // v0.59.357: бейдж «🔗 на схеме» если S/N или Инв.№ матчится с узлом
    const sn = (d.sn || '').trim();
    const aid = (d.assetId || d.address || '').trim();
    const schemeMatch = (sn && schemeIdx.sn.get(sn)) || (aid && schemeIdx.asset.get(aid)) || null;
    // v0.59.358: deep-link с ?focusNode — выделяет узел и flash'ит его при загрузке схемы
    const schemeHref = schemeMatch
      ? `../index.html?project=${encodeURIComponent(getActiveProjectId() || '')}&focusNode=${encodeURIComponent(schemeMatch.id)}`
      : '';
    const schemeBadge = schemeMatch
      ? `<a href="${esc(schemeHref)}" title="Перейти к узлу схемы: ${esc(schemeMatch.tag || schemeMatch.name || schemeMatch.id)}" style="display:inline-block;margin-left:4px;padding:1px 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:3px;font-size:10px;color:#1e40af;text-decoration:none;vertical-align:middle">🔗 ${esc(schemeMatch.tag || 'схема')}</a>`
      : '';
    const st = d.status || 'active';
    const statusOpts = Object.entries(STATUS).map(([k, v]) =>
      `<option value="${k}"${st===k?' selected':''}>${v.icon} ${v.label}</option>`).join('');
    // подсветка ТО: overdue (красноватый) если lastMaintAt + maintMonths прошёл;
    // due-soon (жёлтый) если до конца регламента ≤ 14 дней; также если регламент
    // задан, но даты последнего ТО нет — due-soon.
    let rowCls = '';
    if (d.maintMonths && d.lastMaintAt) {
      const nextDue = d.lastMaintAt + d.maintMonths * MS_MONTH;
      if (nextDue < now) rowCls = ' class="inv-overdue"';
      else if (nextDue < now + 14 * 86400000) rowCls = ' class="inv-due-soon"';
    } else if (d.maintMonths && !d.lastMaintAt) {
      rowCls = ' class="inv-due-soon"';
    }
    return `<tr data-i="${i}"${rowCls}>
      <td>${row.tag ? `<code>${esc(row.tag)}</code>` : '<span class="muted">—</span>'}</td>
      <td>${esc(d.label || '')}</td>
      <td>${esc(row.type?.label || '—')}</td>
      <td>${row.locLabel}</td>
      <td><input data-k="sn" value="${esc(d.sn||'')}" placeholder="—" style="width:120px">${schemeBadge}</td>
      <td><select data-k="status">${statusOpts}</select></td>
      <td><input data-k="maintMonths" type="number" min="0" step="1" value="${d.maintMonths ?? ''}" placeholder="—" style="width:60px"></td>
      <td><input data-k="lastMaintAt" type="date" value="${dateToInput(d.lastMaintAt)}"></td>
      <td><input data-k="note" value="${esc(d.note||'')}" placeholder="—" style="width:160px"></td>
      <td>${d.storedAt ? `<span title="${fmtDate(d.storedAt)}">${fmtAge(d.storedAt)}</span>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('tr[data-i]').forEach(tr => {
    const row = rows[+tr.dataset.i];
    tr.querySelectorAll('[data-k]').forEach(el => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        let v = el.value;
        if (k === 'maintMonths') v = v === '' ? null : +v;
        if (k === 'lastMaintAt') v = v ? new Date(v + 'T00:00:00').getTime() : null;
        writeBack(row.source, row.item.id, { [k]: v });
      });
    });
  });
}

function exportCsv() {
  const rows = collect();
  const header = ['Тег','Название','Тип','Место','S/N','Статус','Регламент (мес)','Последнее ТО','Заметка','Поступил'];
  const lines = [header.join(';')];
  rows.forEach(row => {
    const d = row.item;
    lines.push([
      row.tag,
      d.label || '',
      row.type?.label || '',
      row.locLabel.replace(/<[^>]+>/g, ''),
      d.sn || '',
      STATUS[d.status || 'active']?.label || '',
      d.maintMonths ?? '',
      fmtDate(d.lastMaintAt),
      (d.note || '').replace(/;/g, ','),
      fmtDate(d.storedAt),
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventory-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

['flt-q','flt-loc','flt-status'].forEach(id => $(id).addEventListener('input', render));
$('csv').addEventListener('click', exportCsv);
window.addEventListener('storage', render);
renderProjectBanner();
render();

// v0.59.355: prefill-баннер. Если URL содержит ?prefillTag=…&prefillName=…&
// prefillSn=…&prefillAssetId=… (приходят из инспектора Конструктора схем
// при клике «➕ Создать запись в реестре IT» — см. v0.59.353), показываем
// баннер с этими данными и список стоек проекта. Клик по стойке открывает
// её редактор с теми же параметрами в URL — чтобы rack.html (отдельный
// шаг) мог автозаполнить форму добавления устройства.
function renderPrefillBanner() {
  const host = document.getElementById('inv-prefill-banner');
  if (!host) return;
  let q;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const pTag = (q.get('prefillTag') || '').trim();
  const pName = (q.get('prefillName') || '').trim();
  const pSn = (q.get('prefillSn') || '').trim();
  const pAsset = (q.get('prefillAssetId') || '').trim();
  if (!pTag && !pName && !pSn && !pAsset) {
    host.style.display = 'none';
    return;
  }
  const racks = loadAllRacksForActiveProject();
  const tags = loadJson(LS_RACKTAGS, {});
  const fwd = new URLSearchParams();
  if (pTag) fwd.set('prefillTag', pTag);
  if (pName) fwd.set('prefillName', pName);
  if (pSn) fwd.set('prefillSn', pSn);
  if (pAsset) fwd.set('prefillAssetId', pAsset);
  const rackList = racks.map(r => {
    const t = (tags[r.id] || '').trim() || '(без тега)';
    const href = `./rack.html?id=${encodeURIComponent(r.id)}&${fwd.toString()}`;
    return `<a href="${esc(href)}" class="sc-btn" style="text-decoration:none">🗄 ${esc(t)}</a>`;
  }).join(' ');
  const fields = [
    pTag ? `<b>Тег:</b> ${esc(pTag)}` : '',
    pName ? `<b>Имя:</b> ${esc(pName)}` : '',
    pSn ? `<b>S/N:</b> <code>${esc(pSn)}</code>` : '',
    pAsset ? `<b>Инв.№:</b> <code>${esc(pAsset)}</code>` : '',
  ].filter(Boolean).join(' · ');
  host.style.display = '';
  host.style.cssText = 'display:block;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:12px 14px;margin:8px 0';
  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <b style="color:#065f46">➕ Создание записи для узла из схемы</b>
      <button type="button" id="inv-prefill-copy" class="sc-btn" style="margin-left:auto">📋 Копировать данные</button>
      <button type="button" id="inv-prefill-close" style="background:none;border:0;font-size:16px;cursor:pointer;color:#065f46">×</button>
    </div>
    <div style="margin-bottom:8px;color:#065f46">${fields}</div>
    ${racks.length
      ? `<div style="font-size:12px;color:#065f46;margin-bottom:4px">Откройте стойку, в которой будет создано устройство:</div>
         <div style="display:flex;gap:6px;flex-wrap:wrap">${rackList}</div>`
      : `<div class="muted" style="font-size:12px">В проекте пока нет стоек — <a href="./index.html">создайте стойку</a>.</div>`
    }
  `;
  document.getElementById('inv-prefill-close')?.addEventListener('click', () => {
    host.style.display = 'none';
    try {
      const url = new URL(location.href);
      ['prefillTag','prefillName','prefillSn','prefillAssetId'].forEach(k => url.searchParams.delete(k));
      history.replaceState(null, '', url.toString());
    } catch {}
  });
  document.getElementById('inv-prefill-copy')?.addEventListener('click', () => {
    const txt = [
      pTag ? `Тег: ${pTag}` : '',
      pName ? `Имя: ${pName}` : '',
      pSn ? `S/N: ${pSn}` : '',
      pAsset ? `Инв.№: ${pAsset}` : '',
    ].filter(Boolean).join('\n');
    try { navigator.clipboard.writeText(txt); } catch {}
    const btn = document.getElementById('inv-prefill-copy');
    if (btn) { btn.textContent = '✓ Скопировано'; setTimeout(() => btn.textContent = '📋 Копировать данные', 1500); }
  });
}
renderPrefillBanner();
