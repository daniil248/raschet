/* racks-list.js — реестр шкафов проекта (scs-config/index.html).
   Группировка: реальные стойки (есть тег) vs черновики/шаблоны (нет тега).
   Клик по строке → переход в rack.html?rackId=<id>.
   Inline-действие «присвоить тег» — быстро превращает черновик в реальную стойку. */

import {
  ensureDefaultProject, getActiveProjectId, setActiveProjectId, getProject,
  listProjectsForModule, createSketchForModule, projectKey
} from '../shared/project-storage.js';
import { rsToast, rsConfirm, rsPrompt } from '../shared/dialog.js';
// v0.59.278: project-scoped экземпляры стоек.
import {
  loadAllRacksForActiveProject, saveAllRacksForActiveProject, migrateLegacyInstances,
  LS_TEMPLATES_GLOBAL
} from '../shared/rack-storage.js';
// v0.59.345: «стойки из схемы» — индивидуальные виртуальные экземпляры
// для consumer/rack узлов с count=N в Конструкторе схем.
// v0.59.532: + POR consumer-group rack-membership (анонимные слоты ×N).
import { loadSchemeVirtualRacks, loadPorGroupVirtualRacks, mergeWithSchemeRacks } from '../shared/scheme-rack-bridge.js';

const LS_RACK    = LS_TEMPLATES_GLOBAL;
const LS_CATALOG = 'scs-config.catalog.v1';

// Проектные ключи — rescope при загрузке.
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
})();

const $ = id => document.getElementById(id);
const loadJson = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch { return f; } };
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const escapeHtml = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

// v0.59.587: пробрасываем ?from=<module> в ссылки на rack.html, чтобы
// breadcrumb «← Назад в Проектирование СКС» работал при цепочке
// scs-design → scs-config/index.html → rack.html. Раньше из-за обрыва
// цепочки на index.html ссылка ?from= терялась, и пользователь не мог
// вернуться в исходный модуль одним кликом.
function _fromQuery() {
  try {
    const q = new URLSearchParams(location.search);
    const f = (q.get('from') || '').trim().toLowerCase();
    if (!f) return '';
    if (!/^[a-z0-9-]{1,32}$/.test(f)) return '';
    return f;
  } catch { return ''; }
}
function _withFrom(url) {
  const f = _fromQuery();
  if (!f) return url;
  return url + (url.includes('?') ? '&' : '?') + 'from=' + encodeURIComponent(f);
}

function rowHtmlScheme(r, tag, devs, catalog) {
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
  return `<tr data-rackid="${r.id}" class="rl-scheme">
    <td><code style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:3px" title="Авто-тег из схемы (count=${r.schemeTotal||1})">${escapeHtml(tag)}</code></td>
    <td>${escapeHtml(r.name || 'Серверная стойка')} <span class="muted" style="font-size:11px">· из схемы</span></td>
    <td>${full}</td>
    <td>${corpus}</td>
    <td>${devs.length}</td>
    <td>${bar}</td>
    <td>
      <button class="sc-btn sc-btn-sm" data-act="materialize" data-virtid="${r.id}" data-tag="${escapeHtml(tag)}" title="Создать реальный экземпляр стойки с этим тегом" style="padding:2px 8px;font-size:11px">▸ Материализовать</button>
    </td>
  </tr>`;
}

function rowHtml(r, tag, devs, catalog, orphan = false) {
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
  const orphanBadge = orphan
    ? ` <span title="Соответствующего узла в схеме больше нет (узел удалён или count уменьшен). Стойку можно оставить или удалить вручную." style="background:#fef3c7;color:#b45309;font-size:10px;padding:1px 6px;border-radius:3px;margin-left:4px">⚠ orphan</span>`
    : '';
  return `<tr data-rackid="${r.id}" style="cursor:pointer"${tag ? '' : ' class="rl-draft"'}>
    <td>${tagCell}</td>
    <td>${escapeHtml(r.name || 'Без имени')}${orphanBadge}</td>
    <td>${full}</td>
    <td>${corpus}</td>
    <td>${devs.length}</td>
    <td>${bar}</td>
    <td>
      <a class="sc-btn" href="${_withFrom('./rack.html?rackId=' + encodeURIComponent(r.id))}">▶ Открыть</a>
    </td>
  </tr>`;
}

function groupHeader(title, n, extraCls = '', actionHtml = '') {
  return `<tr class="rl-group-h ${extraCls}">
    <td colspan="7" style="background:#f1f5f9;font-weight:600;padding:6px 10px;color:#1f2937">
      ${title} <span class="muted" style="font-weight:400">· ${n}</span>
      ${actionHtml ? `<span style="float:right;font-weight:400">${actionHtml}</span>` : ''}
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
  migrateLegacyInstances();
  const racks = loadAllRacksForActiveProject();
  const contents = loadJson(LS_CONTENTS, {});
  const tags = loadJson(LS_RACKTAGS, {});
  const catalog = loadJson(LS_CATALOG, []);
  const cart = loadJson(LS_CART, []);
  const warehouse = loadJson(LS_WAREHOUSE, []);

  const tbody = $('racks-tbody');
  // v0.59.255: проект видит ТОЛЬКО физические шкафы (с тегом).
  // Шаблоны корпусов без тега — это глобальная библиотека корпусов, она
  // живёт в Конфигураторе стойки, а не в реестре проекта.
  const real = racks.filter(r => (tags[r.id] || '').trim());

  // v0.59.345: «стойки из схемы» — раскрытые consumer/rack узлы (count=N → N
  // позиций с уникальными авто-тегами). Если пользователь уже материализовал
  // позицию (есть реальная стойка с тем же тегом) — виртуальная скрывается.
  // v0.59.533: + POR consumer-group rack-membership (анонимные слоты ×N).
  const pid = getActiveProjectId();
  const schemeVirtuals = loadSchemeVirtualRacks(pid);
  const porGroupVirtuals = loadPorGroupVirtualRacks(pid);
  // dedup: если scheme-virtual и por-group-virtual ссылаются на один и тот же
  // объект (по id) — оставляем scheme-virtual (engine-узел авторитетнее).
  const seenVids = new Set(schemeVirtuals.map(v => v.id));
  const virtuals = [
    ...schemeVirtuals,
    ...porGroupVirtuals.filter(v => !seenVids.has(v.id)),
  ];
  const { merged: visibleVirtuals } = (() => {
    const m = mergeWithSchemeRacks([], tags, virtuals); // только virtuals не-перекрытые
    // mergeWithSchemeRacks возвращает realRacks ⊕ virtuals; нам тут нужны только virtuals.
    return { merged: m.merged };
  })();

  if (!real.length && !visibleVirtuals.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">
      В проекте нет физических шкафов. Разверните шкаф из шаблона корпуса (кнопка «➕ Развернуть» выше) — задайте тег (например, <code>DH1.SR2</code>) и имя.<br>
      Либо разместите серверную стойку в Конструкторе схем — она появится здесь автоматически.
    </td></tr>`;
    $('summary').innerHTML = '';
    return;
  }

  const parts = [];
  // v0.59.347: индекс «живых» виртуальных схема-стоек по schemeNodeId+index
  // — если у материализованной стойки соответствующая виртуальная исчезла,
  // показываем «orphan» бейдж.
  const liveSchemeKeys = new Set(virtuals.map(v => `${v.schemeNodeId}#${v.schemeIndex}`));
  const isOrphan = (r) => !!r.schemeNodeId && !liveSchemeKeys.has(`${r.schemeNodeId}#${r.schemeIndex || 1}`);

  if (real.length) {
    parts.push(groupHeader('🗄 Физические шкафы проекта', real.length));
    parts.push(real.map(r => rowHtml(r, tags[r.id] || '', contents[r.id] || [], catalog, isOrphan(r))).join(''));
  }
  if (visibleVirtuals.length) {
    const bulkBtn = `<button type="button" class="sc-btn sc-btn-sm" data-act="materialize-all" title="Создать реальные экземпляры для всех ${visibleVirtuals.length} виртуальных стоек разом" style="font-size:11px;padding:2px 8px">▸▸ Материализовать все (${visibleVirtuals.length})</button>`;
    parts.push(groupHeader('🔗 Стойки из схемы (Конструктор) — авто', visibleVirtuals.length, '', bulkBtn));
    parts.push(visibleVirtuals.map(r => rowHtmlScheme(r, r.autoTag, contents[r.id] || [], catalog)).join(''));
  }
  tbody.innerHTML = parts.join('');

  // navigation — реальные открываются в rack.html; виртуальные не открываются
  // (нет содержимого/корпуса), пользователь сначала материализует.
  tbody.querySelectorAll('tr[data-rackid]:not(.rl-scheme)').forEach(tr => {
    tr.addEventListener('click', ev => {
      if (ev.target.closest('a,button,input')) return;
      location.href = _withFrom(`./rack.html?rackId=${encodeURIComponent(tr.dataset.rackid)}`);
    });
  });

  // inline tag assignment
  tbody.querySelectorAll('[data-act="assign-tag"]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); promptTag(btn.dataset.rackid); });
  });
  tbody.querySelectorAll('[data-act="save-tag"]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); saveTag(btn.dataset.rackid); });
  });

  // v0.59.345: материализация виртуальной (из схемы) → создаёт inst-* запись
  // с тем же tag, после чего виртуальная скрывается из списка автоматически.
  tbody.querySelectorAll('[data-act="materialize"]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); materializeFromScheme(btn.dataset.virtid, btn.dataset.tag); });
  });
  // v0.59.347: bulk-материализация всех виртуальных одной кнопкой.
  tbody.querySelectorAll('[data-act="materialize-all"]').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const ok = await rsConfirm(
        'Материализовать все стойки из схемы?',
        `Будет создано ${visibleVirtuals.length} реальных экземпляров (inst-*) с авто-тегами. Можно потом править имя/корпус через Конфигуратор стойки.`
      );
      if (!ok) return;
      materializeAllFromScheme();
    });
  });

  // totals
  let totalU = 0, totalUsedU = 0, totalDevices = 0;
  for (const r of real) {
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
      <span>🗄 Физических шкафов: <b>${real.length}</b></span>
      ${visibleVirtuals.length ? `<span>🔗 Из схемы: <b>${visibleVirtuals.length}</b></span>` : ''}
      <span>Всего U: <b>${totalU}</b></span>
      <span>Занято U: <b>${totalUsedU}</b></span>
      <span>Устройств в стойках: <b>${totalDevices}</b></span>
      <span>В тележке: <b>${cart.length}</b></span>
      <span>На складе: <b>${warehouse.length}</b></span>
    </div>
  `;
}

/* ---------- v0.59.345: Materialize virtual scheme-rack ----------
   Создаёт реальный inst-* экземпляр с тем же тегом, что и виртуальная
   позиция «из схемы». Корпус берём дефолтный (42U); пользователь сможет
   позже сменить через rack-config. */
function materializeFromScheme(virtId, tag) {
  if (!virtId || !tag) return;
  // Уникальность тега
  const tags = loadJson(LS_RACKTAGS, {});
  const tagInUse = Object.values(tags).some(t => (t || '').trim() === tag);
  if (tagInUse) {
    rsToast('Тег ' + tag + ' уже занят — материализация отменена', 'error');
    return;
  }
  const pid = getActiveProjectId();
  // v0.59.533: ищем virtual и в scheme-, и в POR-group-источниках.
  const schemeVs = loadSchemeVirtualRacks(pid);
  const porGroupVs = loadPorGroupVirtualRacks(pid);
  const v = schemeVs.find(x => x.id === virtId) || porGroupVs.find(x => x.id === virtId);
  if (!v) { rsToast('Виртуальная стойка не найдена (схема/группа изменилась?)', 'error'); render(); return; }

  const racks = loadAllRacksForActiveProject();
  const inst = {
    id: 'inst-' + Math.random().toString(36).slice(2, 10),
    name: v.name,
    u: v.u || 42,
    occupied: v.occupied || 0,
    comment: v.fromPorGroup
      ? `Материализовано из POR-группы ${new Date().toISOString().slice(0, 10)} (group ${v.porGroupId}, slot ${v.porGroupSlot}/${v.schemeTotal})`
      : `Материализовано из схемы ${new Date().toISOString().slice(0, 10)} (узел ${v.schemeNodeId}, экземпляр ${v.schemeIndex}/${v.schemeTotal})`,
    schemeNodeId: v.schemeNodeId,
    schemeIndex: v.schemeIndex,
  };
  racks.push(inst);
  saveAllRacksForActiveProject(racks);
  tags[inst.id] = tag;
  saveJson(LS_RACKTAGS, tags);
  // v0.59.537: переносим contents/matrix от виртуала к новому inst-*.
  // Иначе труд пользователя (PDU, устройства, патч-корды), вложенный в
  // виртуальную стойку до материализации, был бы потерян (виртуал после
  // материализации скрывается mergeWithSchemeRacks по tag-overlap).
  try {
    const contents = loadJson(LS_CONTENTS, {});
    const matrix = loadJson('scs-config.matrix.v1', {});
    const matKeyProj = (() => {
      try {
        const pid = getActiveProjectId();
        return pid ? `raschet.project.${pid}.scs-config.matrix.v1` : null;
      } catch { return null; }
    })();
    const matrixProj = matKeyProj ? loadJson(matKeyProj, {}) : null;
    if (contents[virtId] && Array.isArray(contents[virtId])) {
      contents[inst.id] = contents[virtId];
      delete contents[virtId];
      saveJson(LS_CONTENTS, contents);
    }
    if (matrixProj && matrixProj[virtId] && Array.isArray(matrixProj[virtId])) {
      matrixProj[inst.id] = matrixProj[virtId];
      delete matrixProj[virtId];
      saveJson(matKeyProj, matrixProj);
    }
  } catch (e) { console.warn('[racks-list] contents transfer failed:', e); }
  rsToast('Стойка ' + tag + ' материализована (контент перенесён)', 'ok');
  render();
}

/* v0.59.347: bulk-материализация — все виртуальные «из схемы» сразу.
   v0.59.533: + POR-group виртуалы (id с дедупом). */
function materializeAllFromScheme() {
  const pid = getActiveProjectId();
  const schemeVs = loadSchemeVirtualRacks(pid);
  const porGroupVs = loadPorGroupVirtualRacks(pid);
  const seenVids = new Set(schemeVs.map(v => v.id));
  const virtuals = [...schemeVs, ...porGroupVs.filter(v => !seenVids.has(v.id))];
  if (!virtuals.length) return;
  const tags = loadJson(LS_RACKTAGS, {});
  const usedTags = new Set(Object.values(tags).map(t => (t || '').trim()).filter(Boolean));
  const racks = loadAllRacksForActiveProject();
  // v0.59.537: для bulk также переносим contents/matrix от виртуалов.
  const contents = loadJson(LS_CONTENTS, {});
  const matKeyProj = (() => {
    try {
      const _pid = getActiveProjectId();
      return _pid ? `raschet.project.${_pid}.scs-config.matrix.v1` : null;
    } catch { return null; }
  })();
  const matrixProj = matKeyProj ? loadJson(matKeyProj, {}) : null;
  let created = 0, skipped = 0, contentMoved = 0;
  for (const v of virtuals) {
    if (usedTags.has(v.autoTag)) { skipped++; continue; }
    const inst = {
      id: 'inst-' + Math.random().toString(36).slice(2, 10),
      name: v.name,
      u: v.u || 42,
      occupied: v.occupied || 0,
      comment: v.fromPorGroup
        ? `Материализовано из POR-группы ${new Date().toISOString().slice(0, 10)} (group ${v.porGroupId}, ${v.porGroupSlot}/${v.schemeTotal})`
        : `Материализовано из схемы ${new Date().toISOString().slice(0, 10)} (узел ${v.schemeNodeId}, ${v.schemeIndex}/${v.schemeTotal})`,
      schemeNodeId: v.schemeNodeId,
      schemeIndex: v.schemeIndex,
    };
    racks.push(inst);
    tags[inst.id] = v.autoTag;
    usedTags.add(v.autoTag);
    if (contents[v.id] && Array.isArray(contents[v.id])) {
      contents[inst.id] = contents[v.id];
      delete contents[v.id];
      contentMoved++;
    }
    if (matrixProj && matrixProj[v.id] && Array.isArray(matrixProj[v.id])) {
      matrixProj[inst.id] = matrixProj[v.id];
      delete matrixProj[v.id];
    }
    created++;
  }
  saveAllRacksForActiveProject(racks);
  saveJson(LS_RACKTAGS, tags);
  saveJson(LS_CONTENTS, contents);
  if (matKeyProj && matrixProj) saveJson(matKeyProj, matrixProj);
  const msg = created
    ? `Создано ${created} стоек${contentMoved ? ` · перенесён контент ${contentMoved}` : ''}${skipped ? ` (${skipped} пропущено — теги заняты)` : ''}`
    : 'Все теги уже заняты — нечего материализовать';
  rsToast(msg, created ? 'ok' : 'info');
  render();
}

/* ---------- Deploy-from-template ---------- */
function refreshDeployTemplates() {
  const racks = loadAllRacksForActiveProject();
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

  const racks = loadAllRacksForActiveProject();
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
  // v0.59.277: сохраняем ссылку на исходный шаблон корпуса, чтобы в композере
  // показывался label вида «A-02 (600x1200x42U Тип 1)» и можно было позже
  // пере-синхронизировать геометрию при правках шаблона.
  clone.sourceTemplateId = src.id;
  clone.sourceTemplateName = src.name || src.id;
  racks.push(clone);
  // v0.59.278: saveAllRacksForActiveProject разложит по ключам — inst-* в проект.
  saveAllRacksForActiveProject(racks);
  tags[clone.id] = tag;
  saveJson(LS_RACKTAGS, tags);

  // Сброс формы
  $('deploy-box').style.display = 'none';
  if (tagIn) { tagIn.value = ''; tagIn.classList.remove('sc-err'); }
  if (nameIn) nameIn.value = '';
  render();
}

/* ---------- v0.59.284: Project bar + "Новая стойка в проект" wizard ---------- */
function renderProjectBadge() {
  const host = $('sc-project-badge');
  if (!host) return;
  const pid = getActiveProjectId();
  const projects = listProjectsForModule('scs-config');
  const p = pid ? getProject(pid) : null;

  // v0.59.343: вошли с ?project= — контекст зафиксирован, dropdown скрыт.
  let urlPid = null;
  try { urlPid = new URLSearchParams(location.search).get('project'); } catch {}
  if (urlPid) {
    host.innerHTML = `
      <span class="muted">📌 Работа в проекте — переключение контекста заблокировано.</span>
      <a href="../projects/" style="margin-left:auto;float:right">→ к списку проектов</a>
    `;
    return;
  }

  const opts = projects.map(x => {
    const label = (x.kind === 'sketch' ? '🧪 ' : '🏢 ') + (x.name || '(без имени)');
    return `<option value="${escapeHtml(x.id)}" ${x.id === pid ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  host.innerHTML = `
    <span class="muted">Контекст:</span>
    <select id="sc-project-switcher" title="Активный проект или мини-проект СКС" style="font:inherit;padding:3px 6px;margin-left:6px">${opts}</select>
    <button type="button" class="sc-btn sc-btn-sm" id="sc-project-new-sketch" title="Создать мини-проект СКС" style="margin-left:6px;padding:3px 10px">＋ Мини-проект</button>
    ${p ? `<span class="muted" style="margin-left:8px">${p.kind === 'sketch' ? '· 🧪 черновик' : '· 🏢 полноценный проект'}</span>` : ''}
    <a href="../projects/" style="margin-left:auto;float:right">→ управлять проектами</a>
  `;
  $('sc-project-switcher')?.addEventListener('change', e => {
    setActiveProjectId(e.target.value);
    location.reload();
  });
  $('sc-project-new-sketch')?.addEventListener('click', async () => {
    const name = await rsPrompt({ title: 'Создать мини-проект СКС', message: 'Имя черновика', defaultValue: 'Черновик СКС', okLabel: 'Создать' });
    if (!name) return;
    const sp = createSketchForModule('scs-config', name);
    setActiveProjectId(sp.id);
    location.reload();
  });
}

/* Inline-wizard: создаёт inst-* прямо в активном проекте (не шаблон!).
   Шаблоны корпусов — отдельная сущность в Конфигураторе стойки. */
function newRackWizard() {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:18px 22px;min-width:380px;max-width:480px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;color:#0f172a">
        <div style="font-size:15px;font-weight:600;margin-bottom:10px">➕ Новая стойка в проект</div>
        <label style="display:block;margin:8px 0 4px;color:#475569">Имя</label>
        <input type="text" id="nrw-name" value="Стойка A-01" style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit">
        <label style="display:block;margin:10px 0 4px;color:#475569">Тег (TIA-942, напр. DH1.SR2) — можно пусто</label>
        <input type="text" id="nrw-tag" value="" maxlength="24" style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit">
        <div style="display:flex;gap:10px;margin-top:10px">
          <label style="flex:1"><span style="display:block;color:#475569;margin-bottom:4px">Высота, U</span>
            <select id="nrw-u" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit">
              <option>18</option><option>24</option><option>32</option><option selected>42</option><option>47</option>
            </select>
          </label>
          <label style="flex:1"><span style="display:block;color:#475569;margin-bottom:4px">Ширина, мм</span>
            <select id="nrw-w" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit">
              <option selected>600</option><option>800</option>
            </select>
          </label>
          <label style="flex:1"><span style="display:block;color:#475569;margin-bottom:4px">Глубина, мм</span>
            <select id="nrw-d" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit">
              <option>800</option><option selected>1000</option><option>1200</option>
            </select>
          </label>
        </div>
        <div class="muted" style="margin-top:8px;color:#64748b;font-size:12px">
          Стойка создаётся как экземпляр проекта (inst-*) — шаблон в глобальной
          библиотеке НЕ создаётся. Дальнейшая настройка (PDU, устройства,
          заземление) — в Компоновщике (rack.html) либо в Конфигураторе стойки.
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="sc-btn" data-act="no">Отмена</button>
          <button type="button" class="sc-btn" style="background:#2563eb;color:#fff;border-color:#2563eb" data-act="yes">Создать</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const name = overlay.querySelector('#nrw-name');
    name.focus(); name.select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) return done(null);
      if (e.target.dataset?.act === 'no') return done(null);
      if (e.target.dataset?.act === 'yes') {
        const n = (overlay.querySelector('#nrw-name').value || '').trim();
        if (!n) { name.focus(); return; }
        done({
          name: n,
          tag: (overlay.querySelector('#nrw-tag').value || '').trim(),
          u: +overlay.querySelector('#nrw-u').value || 42,
          width: +overlay.querySelector('#nrw-w').value || 600,
          depth: +overlay.querySelector('#nrw-d').value || 1000,
        });
      }
    });
  });
}

async function createNewInstance() {
  const data = await newRackWizard();
  if (!data) return;
  // tag uniqueness (across current project)
  if (data.tag) {
    const tags = loadJson(LS_RACKTAGS, {});
    const dup = Object.entries(tags).some(([, t]) => (t || '').trim().toLowerCase() === data.tag.toLowerCase());
    if (dup) { rsToast(`Тег «${data.tag}» уже занят в этом проекте.`, 'warn'); return; }
  }
  const racks = loadAllRacksForActiveProject();
  const id = 'inst-' + Math.random().toString(36).slice(2, 10);
  racks.push({
    id,
    name: data.name,
    u: data.u,
    width: data.width,
    depth: data.depth,
    occupied: 0,
    doorFront: 'metal',
    doorRear: 'metal',
    comment: `Создано в «Шкафы проекта» ${new Date().toISOString().slice(0, 10)}`,
  });
  saveAllRacksForActiveProject(racks);
  if (data.tag) {
    const tags = loadJson(LS_RACKTAGS, {});
    tags[id] = data.tag;
    saveJson(LS_RACKTAGS, tags);
  }
  rsToast(`✔ Создана стойка «${data.name}».`, 'ok');
  render();
}

renderProjectBadge();
$('btn-new-rack')?.addEventListener('click', createNewInstance);

// v0.59.376: ссылка из rack.html «➕ Новая» ведёт сюда с ?new=1 — авто-
// открываем wizard. После сценария убираем флаг, чтобы перезагрузка не
// триггерила его повторно.
try {
  const _u = new URLSearchParams(location.search);
  if (_u.get('new') === '1') {
    _u.delete('new');
    const _qs = _u.toString();
    history.replaceState(null, '', location.pathname + (_qs ? '?' + _qs : ''));
    setTimeout(() => { createNewInstance(); }, 50);
  }
} catch {}

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
