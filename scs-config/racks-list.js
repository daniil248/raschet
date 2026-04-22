/* racks-list.js — реестр шкафов проекта (scs-config/index.html).
   Только просмотр, без drag. Клик по строке → переход в rack.html?rackId=<id>. */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_RACKTAGS  = 'scs-config.rackTags.v1';
const LS_CATALOG   = 'scs-config.catalog.v1';
const LS_CART      = 'scs-config.cart.v1';
const LS_WAREHOUSE = 'scs-config.warehouse.v1';

const $ = id => document.getElementById(id);
const loadJson = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch { return f; } };
const escapeHtml = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

function render() {
  const racks = loadJson(LS_RACK, []);
  const contents = loadJson(LS_CONTENTS, {});
  const tags = loadJson(LS_RACKTAGS, {});
  const catalog = loadJson(LS_CATALOG, []);
  const cart = loadJson(LS_CART, []);
  const warehouse = loadJson(LS_WAREHOUSE, []);

  const tbody = $('racks-tbody');
  if (!racks.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">
      Нет шаблонов стоек. Создайте стойку в <a href="../rack-config/">Конфигураторе стойки</a>.
    </td></tr>`;
  } else {
    let totalU = 0, totalUsedU = 0, totalDevices = 0;
    tbody.innerHTML = racks.map(r => {
      const devs = contents[r.id] || [];
      const usedU = devs.reduce((s, d) => {
        const t = catalog.find(c => c.id === d.typeId);
        return s + (t ? (t.heightU || 1) : 1);
      }, 0);
      const tag = tags[r.id] || '';
      const corpus = r.occupied || 0;
      const full = r.u || 0;
      const occPct = full ? Math.round(((usedU + corpus) / full) * 100) : 0;
      totalU += full; totalUsedU += usedU + corpus; totalDevices += devs.length;
      const bar = `<div style="background:#e5e7eb;border-radius:4px;width:100px;height:10px;overflow:hidden;display:inline-block">
        <div style="width:${occPct}%;height:100%;background:${occPct>90?'#dc2626':occPct>70?'#f59e0b':'#10b981'}"></div>
      </div> <span class="muted">${occPct}%</span>`;
      return `<tr data-rackid="${r.id}" style="cursor:pointer">
        <td>${tag ? `<code>${escapeHtml(tag)}</code>` : '<span class="muted">—</span>'}</td>
        <td>${escapeHtml(r.name || 'Без имени')}</td>
        <td>${full}</td>
        <td>${corpus}</td>
        <td>${devs.length}</td>
        <td>${bar}</td>
        <td>
          <a class="sc-btn" href="./rack.html?rackId=${encodeURIComponent(r.id)}">▶ Открыть</a>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('tr[data-rackid]').forEach(tr => {
      tr.addEventListener('click', ev => {
        if (ev.target.closest('a,button')) return;
        location.href = `./rack.html?rackId=${encodeURIComponent(tr.dataset.rackid)}`;
      });
    });

    $('summary').innerHTML = `
      <div class="muted" style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px">
        <span>Всего шкафов: <b>${racks.length}</b></span>
        <span>Всего U: <b>${totalU}</b></span>
        <span>Занято U: <b>${totalUsedU}</b></span>
        <span>Устройств в стойках: <b>${totalDevices}</b></span>
        <span>В тележке: <b>${cart.length}</b></span>
        <span>На складе: <b>${warehouse.length}</b></span>
      </div>
    `;
  }
}

render();
window.addEventListener('storage', render);
