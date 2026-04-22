/* racks-list.js — реестр шкафов проекта (scs-config/index.html).
   Группировка: реальные стойки (есть тег) vs черновики/шаблоны (нет тега).
   Клик по строке → переход в rack.html?rackId=<id>.
   Inline-действие «присвоить тег» — быстро превращает черновик в реальную стойку. */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_RACKTAGS  = 'scs-config.rackTags.v1';
const LS_CATALOG   = 'scs-config.catalog.v1';
const LS_CART      = 'scs-config.cart.v1';
const LS_WAREHOUSE = 'scs-config.warehouse.v1';

const $ = id => document.getElementById(id);
const loadJson = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch { return f; } };
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const escapeHtml = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

function rowHtml(r, tag, devs, catalog) {
  const usedU = devs.reduce((s, d) => {
    const t = catalog.find(c => c.id === d.typeId);
    return s + (t ? (t.heightU || 1) : 1);
  }, 0);
  const corpus = r.occupied || 0;
  const full = r.u || 0;
  const occPct = full ? Math.round(((usedU + corpus) / full) * 100) : 0;
  const bar = `<div style="background:#e5e7eb;border-radius:4px;width:100px;height:10px;overflow:hidden;display:inline-block">
    <div style="width:${occPct}%;height:100%;background:${occPct>90?'#dc2626':occPct>70?'#f59e0b':'#10b981'}"></div>
  </div> <span class="muted">${occPct}%</span>`;
  const tagCell = tag
    ? `<code>${escapeHtml(tag)}</code>`
    : `<button class="sc-btn sc-btn-sm" data-act="assign-tag" data-rackid="${r.id}" title="Присвоить тег (например, DH1.SR2) — стойка станет реальной" style="padding:2px 8px;font-size:11px">+ тег</button>`;
  return `<tr data-rackid="${r.id}" style="cursor:pointer"${tag ? '' : ' class="rl-draft"'}>
    <td>${tagCell}</td>
    <td>${escapeHtml(r.name || 'Без имени')}</td>
    <td>${full}</td>
    <td>${corpus}</td>
    <td>${devs.length}</td>
    <td>${bar}</td>
    <td>
      <a class="sc-btn" href="./rack.html?rackId=${encodeURIComponent(r.id)}">▶ Открыть</a>
    </td>
  </tr>`;
}

function groupHeader(title, n, extraCls = '') {
  return `<tr class="rl-group-h ${extraCls}">
    <td colspan="7" style="background:#f1f5f9;font-weight:600;padding:6px 10px;color:#1f2937">
      ${title} <span class="muted" style="font-weight:400">· ${n}</span>
    </td>
  </tr>`;
}

function promptTag(rackId) {
  // Avoid browser dialogs — inline prompt via simple input swap.
  const tr = document.querySelector(`tr[data-rackid="${rackId}"]`);
  if (!tr) return;
  const btn = tr.querySelector('[data-act="assign-tag"]');
  if (!btn) return;
  const cell = btn.parentElement;
  cell.innerHTML = `<input type="text" placeholder="DH1.SR2" maxlength="24"
    style="width:90px;font:inherit;font-size:12px;padding:2px 6px;border:1px solid #3b82f6;border-radius:4px">
    <button class="sc-btn sc-btn-sm" data-act="save-tag" data-rackid="${rackId}" style="padding:2px 6px;font-size:11px;margin-left:2px">OK</button>`;
  const input = cell.querySelector('input');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') cell.querySelector('[data-act="save-tag"]').click();
    if (e.key === 'Escape') render();
  });
}

function saveTag(rackId) {
  const tr = document.querySelector(`tr[data-rackid="${rackId}"]`);
  const input = tr?.querySelector('input');
  if (!input) return;
  const val = (input.value || '').trim();
  if (!val) { render(); return; }
  const tags = loadJson(LS_RACKTAGS, {});
  tags[rackId] = val;
  saveJson(LS_RACKTAGS, tags);
  render();
}

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
      Нет шаблонов стоек. Создайте стойку в <a href="../rack-config/">Конфигураторе шкафа — корпус</a>.
    </td></tr>`;
    $('summary').innerHTML = '';
    return;
  }

  const real = racks.filter(r => (tags[r.id] || '').trim());
  const drafts = racks.filter(r => !(tags[r.id] || '').trim());

  const parts = [];
  if (real.length) {
    parts.push(groupHeader('🗄 Реальные стойки (с тегом)', real.length));
    parts.push(real.map(r => rowHtml(r, tags[r.id] || '', contents[r.id] || [], catalog)).join(''));
  }
  if (drafts.length) {
    parts.push(groupHeader('📐 Черновики / шаблоны без тега', drafts.length, 'draft'));
    parts.push(drafts.map(r => rowHtml(r, '', contents[r.id] || [], catalog)).join(''));
  }
  tbody.innerHTML = parts.join('');

  // navigation
  tbody.querySelectorAll('tr[data-rackid]').forEach(tr => {
    tr.addEventListener('click', ev => {
      if (ev.target.closest('a,button,input')) return;
      location.href = `./rack.html?rackId=${encodeURIComponent(tr.dataset.rackid)}`;
    });
  });

  // inline tag assignment
  tbody.querySelectorAll('[data-act="assign-tag"]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); promptTag(btn.dataset.rackid); });
  });
  tbody.querySelectorAll('[data-act="save-tag"]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); saveTag(btn.dataset.rackid); });
  });

  // totals
  let totalU = 0, totalUsedU = 0, totalDevices = 0;
  for (const r of racks) {
    const devs = contents[r.id] || [];
    const usedU = devs.reduce((s, d) => {
      const t = catalog.find(c => c.id === d.typeId);
      return s + (t ? (t.heightU || 1) : 1);
    }, 0);
    totalU += r.u || 0;
    totalUsedU += usedU + (r.occupied || 0);
    totalDevices += devs.length;
  }
  $('summary').innerHTML = `
    <div class="muted" style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px">
      <span>🗄 Реальных: <b>${real.length}</b></span>
      <span>📐 Черновиков: <b>${drafts.length}</b></span>
      <span>Всего U: <b>${totalU}</b></span>
      <span>Занято U: <b>${totalUsedU}</b></span>
      <span>Устройств в стойках: <b>${totalDevices}</b></span>
      <span>В тележке: <b>${cart.length}</b></span>
      <span>На складе: <b>${warehouse.length}</b></span>
    </div>
  `;
}

/* ---------- Deploy-from-template ---------- */
function refreshDeployTemplates() {
  const racks = loadJson(LS_RACK, []);
  const tags = loadJson(LS_RACKTAGS, {});
  const contents = loadJson(LS_CONTENTS, {});
  const sel = $('deploy-template');
  if (!sel) return;
  // Кандидаты — все стойки (любая может служить корпусом), но с маркировкой:
  // шаблоны (без тега, пустые) первыми; реальные с тегом — в конце и
  // помечены «клонировать корпус из …».
  const templates = racks.filter(r => !(tags[r.id] || '').trim());
  const real = racks.filter(r => (tags[r.id] || '').trim());
  const fmt = r => {
    const devs = contents[r.id] || [];
    return `${r.name || 'Без имени'} · ${r.u || 42}U${devs.length ? ` (в корпусе ${devs.length} устр.)` : ''}`;
  };
  const opts = [];
  if (templates.length) {
    opts.push('<optgroup label="📐 Шаблоны (без тега)">');
    templates.forEach(r => opts.push(`<option value="${r.id}">${escapeHtml(fmt(r))}</option>`));
    opts.push('</optgroup>');
  }
  if (real.length) {
    opts.push('<optgroup label="🗄 Клонировать корпус из реальной стойки">');
    real.forEach(r => opts.push(`<option value="${r.id}">${escapeHtml((tags[r.id] || '') + ' · ' + fmt(r))}</option>`));
    opts.push('</optgroup>');
  }
  if (!opts.length) {
    sel.innerHTML = '<option value="">— нет шаблонов, создайте в rack-config —</option>';
  } else {
    sel.innerHTML = opts.join('');
  }
}

function deployFromTemplate() {
  const sel = $('deploy-template');
  const tagIn = $('deploy-tag');
  const nameIn = $('deploy-name');
  const srcId = sel?.value || '';
  const tag = (tagIn?.value || '').trim();
  const name = (nameIn?.value || '').trim();
  if (!srcId) { tagIn && tagIn.focus(); return; }
  if (!tag) { tagIn?.focus(); tagIn?.classList.add('sc-err'); return; }

  const racks = loadJson(LS_RACK, []);
  const tags = loadJson(LS_RACKTAGS, {});
  const src = racks.find(r => r.id === srcId);
  if (!src) return;

  // Проверка уникальности тега
  const tagInUse = Object.entries(tags).some(([rid, t]) => (t || '').trim() === tag && rid !== srcId);
  if (tagInUse) {
    tagIn?.classList.add('sc-err');
    tagIn?.focus();
    return;
  }

  // Клон корпуса: все поля кроме id и comment; contents не копируем.
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = 'inst-' + Math.random().toString(36).slice(2, 10);
  clone.name = name || `${src.name || 'Стойка'} (${tag})`;
  clone.comment = `Развёрнуто из «${src.name || src.id}» ${new Date().toISOString().slice(0, 10)}`;
  racks.push(clone);
  saveJson(LS_RACK, racks);
  tags[clone.id] = tag;
  saveJson(LS_RACKTAGS, tags);

  // Сброс формы
  $('deploy-box').style.display = 'none';
  if (tagIn) { tagIn.value = ''; tagIn.classList.remove('sc-err'); }
  if (nameIn) nameIn.value = '';
  render();
}

const deployBtn = $('btn-deploy');
if (deployBtn) {
  deployBtn.addEventListener('click', () => {
    const box = $('deploy-box');
    const show = box.style.display === 'none';
    box.style.display = show ? '' : 'none';
    if (show) refreshDeployTemplates();
  });
}
$('btn-deploy-cancel')?.addEventListener('click', () => { $('deploy-box').style.display = 'none'; });
$('btn-deploy-go')?.addEventListener('click', deployFromTemplate);

render();
window.addEventListener('storage', render);
