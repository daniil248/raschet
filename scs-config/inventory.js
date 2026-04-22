/* inventory.js — реестр всего оборудования проекта.
   Источники: state.contents (в шкафах), state.cart (тележка), state.warehouse (склад).
   Редактируемые поля: sn, status, note, maintMonths, lastMaintAt. Сохраняются
   обратно в тот же источник (mutation по id). */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CATALOG   = 'scs-config.catalog.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_RACKTAGS  = 'scs-config.rackTags.v1';
const LS_CART      = 'scs-config.cart.v1';
const LS_WAREHOUSE = 'scs-config.warehouse.v1';

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

function collect() {
  const racks     = loadJson(LS_RACK, []);
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
      const devTag = tag ? (h > 1 ? `${tag}.U${d.positionU}-${d.positionU - h + 1}` : `${tag}.U${d.positionU}`) : '';
      rows.push({
        loc: 'rack',
        locLabel: `<a href="./rack.html?rackId=${encodeURIComponent(rackId)}">${esc(r.name)} · U${d.positionU}</a>`,
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

  tb.innerHTML = rows.map((row, i) => {
    const d = row.item;
    const st = d.status || 'active';
    const statusOpts = Object.entries(STATUS).map(([k, v]) =>
      `<option value="${k}"${st===k?' selected':''}>${v.icon} ${v.label}</option>`).join('');
    return `<tr data-i="${i}">
      <td>${row.tag ? `<code>${esc(row.tag)}</code>` : '<span class="muted">—</span>'}</td>
      <td>${esc(d.label || '')}</td>
      <td>${esc(row.type?.label || '—')}</td>
      <td>${row.locLabel}</td>
      <td><input data-k="sn" value="${esc(d.sn||'')}" placeholder="—" style="width:120px"></td>
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
render();
