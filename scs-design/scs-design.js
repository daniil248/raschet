/* ============================================================
   scs-design.js — Проектирование СКС (Подфаза 1.26)
   Первая итерация: вкладка «Связи» с мастером меж-шкафных связей.
   Читаем стойки из LS_RACK и контент из LS_CONTENTS (общие с
   scs-config), позволяем выбрать N стоек и увидеть их рядом.
   Сами port↔port-связи — следующая итерация.
   ============================================================ */

const LS_RACK      = 'rack-config.templates.v1';    // шаблоны корпусов
const LS_CONTENTS  = 'scs-config.contents.v1';      // { [rackId]: [dev] }
const LS_RACKTAGS  = 'scs-config.rackTags.v1';      // { [rackId]: tag }
const LS_SELECTION = 'scs-design.selection.v1';     // последний выбор стоек
const LS_LINKS     = 'scs-design.links.v1';         // [link] — будущее

function loadJson(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function getRacks() {
  const racks = loadJson(LS_RACK, []);
  return Array.isArray(racks) ? racks : [];
}
function getRackTag(rackId) {
  const tags = loadJson(LS_RACKTAGS, {});
  return tags && typeof tags === 'object' ? tags[rackId] || '' : '';
}
function getContents(rackId) {
  const all = loadJson(LS_CONTENTS, {});
  const arr = all && typeof all === 'object' ? all[rackId] : null;
  return Array.isArray(arr) ? arr : [];
}
function rackLabel(r) {
  const tag = getRackTag(r.id);
  const name = r.name || 'Без имени';
  return tag ? `${tag} · ${name}` : name;
}

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

/* ---------- Вкладка Links ---------- */
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
    return;
  }
  empty.style.display = 'none';

  const selected = new Set(loadJson(LS_SELECTION, []));
  picker.innerHTML = racks.map(r => {
    const on = selected.has(r.id);
    const label = rackLabel(r);
    const tag = getRackTag(r.id);
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
}

function renderSelected(selected, racks) {
  const row = document.getElementById('sd-racks-row');
  const arr = racks.filter(r => selected.has(r.id));
  if (!arr.length) {
    row.innerHTML = `<div class="sd-empty-state">Выберите чекбоксами стойки выше — они появятся здесь рядом для проектирования связей.</div>`;
    return;
  }
  row.innerHTML = arr.map(r => renderRackCard(r)).join('');
}

function renderRackCard(r) {
  const u = +r.u || 42;
  const devices = getContents(r.id);
  const tag = getRackTag(r.id);
  const occupancy = Array.from({ length: u + 1 }, () => null); // index 1..u
  devices.forEach(d => {
    const top = +d.positionU || 1;
    const h = +d.heightU || 1;
    for (let i = 0; i < h; i++) {
      const idx = top - i;
      if (idx >= 1 && idx <= u && !occupancy[idx]) {
        occupancy[idx] = { dev: d, isTop: i === 0, span: h };
      }
    }
  });

  const units = [];
  for (let i = 1; i <= u; i++) {
    const cell = occupancy[i];
    if (cell && cell.isTop) {
      units.push(`<div class="sd-unit" title="${escapeAttr(cell.dev.label || cell.dev.typeId || '')}">
        <span class="u-num">${i}</span>
        <span class="u-label">${escapeHtml(cell.dev.label || cell.dev.typeId || '—')}</span>
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
  // При смене данных в других вкладках/модулях — перерисовка
  window.addEventListener('storage', (e) => {
    if ([LS_RACK, LS_CONTENTS, LS_RACKTAGS].includes(e.key)) renderLinksTab();
  });
});
