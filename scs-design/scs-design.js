/* ============================================================
   scs-design.js — Проектирование СКС (Подфаза 1.26)
   Вкладка «Связи» — мастер меж-шкафных связей:
   • выбор N стоек из проекта → карточки рядом,
   • клик по юниту A → клик по юниту B → создать связь,
   • список связей с типом кабеля и удалением.
   ============================================================ */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_RACKTAGS  = 'scs-config.rackTags.v1';
const LS_SELECTION = 'scs-design.selection.v1';
const LS_LINKS     = 'scs-design.links.v1';

const CABLE_TYPES = [
  { id: 'cat6', label: 'Cat.6 U/UTP' },
  { id: 'cat6a', label: 'Cat.6A F/UTP' },
  { id: 'cat7', label: 'Cat.7 S/FTP' },
  { id: 'om3', label: 'OM3 LC-LC' },
  { id: 'om4', label: 'OM4 LC-LC' },
  { id: 'os2', label: 'OS2 LC-LC' },
  { id: 'coax', label: 'Coax / RF' },
  { id: 'power-c13', label: 'Питание C13/C14' },
  { id: 'other', label: 'Другое' },
];

/* ---------- storage ---------- */
function loadJson(key, fb) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; }
  catch { return fb; }
}
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function getRacks() { const r = loadJson(LS_RACK, []); return Array.isArray(r) ? r : []; }
function getRackTag(id) { const t = loadJson(LS_RACKTAGS, {}); return (t && typeof t === 'object') ? (t[id] || '') : ''; }
function getContents(id) {
  const all = loadJson(LS_CONTENTS, {});
  const a = all && typeof all === 'object' ? all[id] : null;
  return Array.isArray(a) ? a : [];
}
function getLinks() { const l = loadJson(LS_LINKS, []); return Array.isArray(l) ? l : []; }
function setLinks(arr) { saveJson(LS_LINKS, arr); }
function rackById(id) { return getRacks().find(r => r.id === id); }
function deviceLabel(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId);
  return d ? (d.label || d.typeId || devId) : '(удалено)';
}
function rackLabel(r) {
  const tag = getRackTag(r.id);
  const name = r.name || 'Без имени';
  return tag ? `${tag} · ${name}` : name;
}
function newId() { return 'ln_' + Math.random().toString(36).slice(2, 10); }

/* ---------- UI state ---------- */
let linkStart = null; // { rackId, devId, label }

/* ---------- Tabs ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.sd-tab');
  const panels = document.querySelectorAll('.sd-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
    });
  });
}

/* ---------- Links tab ---------- */
function renderLinksTab() {
  const picker = document.getElementById('sd-rack-picker');
  const row = document.getElementById('sd-racks-row');
  const empty = document.getElementById('sd-empty');
  const racks = getRacks();

  if (!racks.length) {
    picker.innerHTML = '';
    row.innerHTML = '';
    empty.style.display = '';
    empty.innerHTML = `
      <p>В проекте ещё нет шкафов. Сначала создайте их:</p>
      <p>→ <a href="../rack-config/">Конфигуратор шкафа — корпус</a> (шаблоны)<br>
      → <a href="../scs-config/">Шкафы проекта</a> (наполнение).</p>
    `;
    renderLinksList();
    return;
  }
  empty.style.display = 'none';

  const selected = new Set(loadJson(LS_SELECTION, []));
  picker.innerHTML = racks.map(r => {
    const on = selected.has(r.id);
    const label = rackLabel(r);
    return `<label class="sd-rack-chip ${on ? 'on' : ''}" data-id="${r.id}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`;
  }).join('');

  picker.querySelectorAll('.sd-rack-chip').forEach(chip => {
    const id = chip.dataset.id;
    const input = chip.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) selected.add(id); else selected.delete(id);
      saveJson(LS_SELECTION, Array.from(selected));
      chip.classList.toggle('on', input.checked);
      renderSelected(selected, racks);
    });
  });

  renderSelected(selected, racks);
  renderLinksList();
}

function renderSelected(selected, racks) {
  const row = document.getElementById('sd-racks-row');
  const arr = racks.filter(r => selected.has(r.id));
  if (!arr.length) {
    row.innerHTML = `<div class="sd-empty-state">Выберите чекбоксами стойки выше — они появятся здесь рядом для проектирования связей.</div>`;
    return;
  }
  row.innerHTML = arr.map(r => renderRackCard(r)).join('');

  // клик по юниту — логика link-start / link-end
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    el.addEventListener('click', () => onUnitClick(el));
  });
}

function renderRackCard(r) {
  const u = +r.u || 42;
  const devices = getContents(r.id);
  const tag = getRackTag(r.id);
  const occupancy = Array.from({ length: u + 1 }, () => null);
  devices.forEach(d => {
    const top = +d.positionU || 1;
    const h = +d.heightU || 1;
    for (let i = 0; i < h; i++) {
      const idx = top - i;
      if (idx >= 1 && idx <= u && !occupancy[idx]) {
        occupancy[idx] = { dev: d, isTop: i === 0 };
      }
    }
  });

  const units = [];
  for (let i = 1; i <= u; i++) {
    const cell = occupancy[i];
    if (cell && cell.isTop) {
      const d = cell.dev;
      const isStart = linkStart && linkStart.rackId === r.id && linkStart.devId === d.id;
      units.push(`<div class="sd-unit${isStart ? ' sel' : ''}" data-rack-id="${escapeAttr(r.id)}" data-dev-id="${escapeAttr(d.id)}" title="${escapeAttr(d.label || d.typeId || '')}">
        <span class="u-num">${i}</span>
        <span class="u-label">${escapeHtml(d.label || d.typeId || '—')}</span>
      </div>`);
    } else if (!cell) {
      units.push(`<div class="sd-unit empty"><span class="u-num">${i}</span><span class="u-label">·</span></div>`);
    }
  }

  return `<div class="sd-rack-card">
    <div class="sd-rack-head">
      <span>${escapeHtml(r.name || 'Без имени')}</span>
      <span class="tag">${escapeHtml(tag || '—')}</span>
    </div>
    <div class="sd-units">${units.join('')}</div>
  </div>`;
}

function onUnitClick(el) {
  const rackId = el.dataset.rackId;
  const devId = el.dataset.devId;
  const label = el.querySelector('.u-label').textContent.trim();
  if (!linkStart) {
    linkStart = { rackId, devId, label };
    el.classList.add('sel');
    updateStatus(`Выбран источник: <b>${escapeHtml(label)}</b> (${escapeHtml(getRackShortLabel(rackId))}). Кликните на целевое устройство в другой стойке.`);
    return;
  }
  if (linkStart.rackId === rackId && linkStart.devId === devId) {
    // повторный клик по тому же — отмена
    linkStart = null;
    el.classList.remove('sel');
    updateStatus('');
    return;
  }
  if (linkStart.rackId === rackId) {
    updateStatus(`⚠ Связь внутри одного шкафа — настраивается в <a href="../scs-config/">Компоновщике шкафа</a>, не здесь.`);
    return;
  }
  // создать связь
  const links = getLinks();
  links.push({
    id: newId(),
    fromRackId: linkStart.rackId, fromDevId: linkStart.devId, fromLabel: linkStart.label,
    toRackId: rackId, toDevId: devId, toLabel: label,
    cableType: 'cat6a',
    lengthM: null,
    note: '',
    createdAt: Date.now(),
  });
  setLinks(links);
  linkStart = null;
  updateStatus(`✔ Связь добавлена: <b>${escapeHtml(label)}</b> ↔ выбранное устройство. Всего связей: ${links.length}.`);
  // перерисовать стойки (чтобы снять подсветку) и список
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
}

function getRackShortLabel(rackId) {
  const r = rackById(rackId); if (!r) return rackId;
  const tag = getRackTag(rackId);
  return tag || r.name || rackId;
}

function updateStatus(html) {
  const el = document.getElementById('sd-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

/* ---------- Links list ---------- */
function renderLinksList() {
  const host = document.getElementById('sd-links-list');
  if (!host) return;
  const links = getLinks();
  if (!links.length) {
    host.innerHTML = `<div class="sd-empty-state">Пока нет ни одной меж-шкафной связи. Кликните на устройство в одной стойке, затем на устройство в другой — появится связь.</div>`;
    return;
  }
  const opts = CABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  host.innerHTML = `
    <table class="sd-links-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Откуда (шкаф → устройство)</th>
          <th>Куда (шкаф → устройство)</th>
          <th>Кабель</th>
          <th>Длина, м</th>
          <th>Заметка</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${links.map((l, i) => `
          <tr data-id="${escapeAttr(l.id)}">
            <td>${i + 1}</td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.fromRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.fromRackId, l.fromDevId))}</div>
            </td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.toRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.toRackId, l.toDevId))}</div>
            </td>
            <td>
              <select data-act="cable">${opts.replace(`value="${l.cableType}"`, `value="${l.cableType}" selected`)}</select>
            </td>
            <td><input type="number" min="0" step="0.1" value="${l.lengthM == null ? '' : l.lengthM}" data-act="length" style="width:80px"></td>
            <td><input type="text" value="${escapeAttr(l.note || '')}" data-act="note" placeholder="—"></td>
            <td><button data-act="del" class="sd-btn-del" title="Удалить связь">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="sd-links-footer muted">Всего связей: ${links.length}. Хранилище: <code>scs-design.links.v1</code>.</div>
  `;
  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="cable"]').addEventListener('change', e => updateLink(id, { cableType: e.target.value }));
    tr.querySelector('[data-act="length"]').addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { lengthM: v === '' ? null : +v });
    });
    tr.querySelector('[data-act="note"]').addEventListener('change', e => updateLink(id, { note: e.target.value }));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const cur = getLinks().filter(x => x.id !== id);
      setLinks(cur);
      renderLinksList();
    });
  });
}
function updateLink(id, patch) {
  const cur = getLinks();
  const i = cur.findIndex(x => x.id === id);
  if (i < 0) return;
  cur[i] = { ...cur[i], ...patch };
  setLinks(cur);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  renderLinksTab();
  window.addEventListener('storage', (e) => {
    if ([LS_RACK, LS_CONTENTS, LS_RACKTAGS, LS_LINKS].includes(e.key)) renderLinksTab();
  });
});
