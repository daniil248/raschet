/* ============================================================
   scs-design.js — Проектирование СКС (Подфаза 1.26)
   Вкладка «Связи» — мастер меж-шкафных связей:
   • выбор N стоек из проекта → карточки рядом,
   • клик по юниту A → клик по юниту B → создать связь,
   • список связей с типом кабеля и удалением.
   ============================================================ */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CATALOG   = 'scs-config.catalog.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_RACKTAGS  = 'scs-config.rackTags.v1';
const LS_SELECTION = 'scs-design.selection.v1';
const LS_LINKS     = 'scs-design.links.v1';
const LS_PLAN      = 'scs-design.plan.v1'; // { step, kRoute, positions:{[rackId]:{x,y}} }

/* Типы оборудования, у которых нет портов — могут служить только каналом
   для трассировки сплайна, но не endpoint-ом связи. */
const NO_PORT_KINDS = new Set(['cable-manager']);

const CABLE_TYPES = [
  { id: 'cat6',      label: 'Cat.6 U/UTP',     color: '#1976d2' },
  { id: 'cat6a',     label: 'Cat.6A F/UTP',    color: '#1565c0' },
  { id: 'cat7',      label: 'Cat.7 S/FTP',     color: '#0d47a1' },
  { id: 'om3',       label: 'OM3 LC-LC',       color: '#ea580c' },
  { id: 'om4',       label: 'OM4 LC-LC',       color: '#c2410c' },
  { id: 'os2',       label: 'OS2 LC-LC',       color: '#facc15' },
  { id: 'coax',      label: 'Coax / RF',       color: '#7c3aed' },
  { id: 'power-c13', label: 'Питание C13/C14', color: '#dc2626' },
  { id: 'other',     label: 'Другое',          color: '#64748b' },
];
const CABLE_COLOR = id => (CABLE_TYPES.find(c => c.id === id)?.color) || '#64748b';

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
function getCatalog() { const c = loadJson(LS_CATALOG, []); return Array.isArray(c) ? c : []; }
function catalogType(typeId) { return getCatalog().find(t => t.id === typeId) || null; }
function isOrganizer(dev) {
  if (!dev) return false;
  const t = catalogType(dev.typeId);
  return !!(t && NO_PORT_KINDS.has(t.kind));
}

/* Очистка некорректных связей: endpoint = безпортовое устройство (органайзер
   и т.п.). Запускается один раз при инициализации. Возвращает число удалённых. */
function sanitizeLinks() {
  const cur = getLinks();
  if (!cur.length) return 0;
  const keep = cur.filter(l => {
    const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
    const to = getContents(l.toRackId).find(x => x.id === l.toDevId);
    // Если устройство удалено (from/to === undefined) — оставляем, это отдельная
    // проблема «battle damaged» связи. Фильтруем только явные органайзеры.
    if (from && isOrganizer(from)) return false;
    if (to && isOrganizer(to)) return false;
    return true;
  });
  const removed = cur.length - keep.length;
  if (removed > 0) setLinks(keep);
  return removed;
}
function deviceLabel(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId);
  return d ? (d.label || d.typeId || devId) : '(удалено)';
}
function devicePorts(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId); if (!d) return 0;
  const t = catalogType(d.typeId);
  return (t && +t.ports) || 0;
}
function portsUsedOn(rackId, devId, excludeLinkId) {
  const used = new Set();
  getLinks().forEach(l => {
    if (excludeLinkId && l.id === excludeLinkId) return;
    if (l.fromRackId === rackId && l.fromDevId === devId && l.fromPort) used.add(+l.fromPort);
    if (l.toRackId === rackId && l.toDevId === devId && l.toPort) used.add(+l.toPort);
  });
  return used;
}
function rackLabel(r) {
  const tag = getRackTag(r.id);
  const name = r.name || 'Без имени';
  return tag ? `${tag} · ${name}` : name;
}
function newId() { return 'ln_' + Math.random().toString(36).slice(2, 10); }

/* ---------- UI state ---------- */
let linkStart = null; // { rackId, devId, label }
let lastLink = null;  // { fromRackId, fromDevId, toRackId, toDevId } — для batch wire

function promptBatchWire() {
  if (!lastLink) return;
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  if (pFrom <= 1 || pTo <= 1) return;
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const freeFrom = pFrom - usedFrom.size;
  const freeTo   = pTo   - usedTo.size;
  const maxCount = Math.min(freeFrom, freeTo);
  if (maxCount <= 0) { updateStatus(`⚠ Нет свободных портов для продолжения.`); return; }

  const st = document.getElementById('sd-status');
  if (!st) return;
  st.innerHTML = `
    <span>+ связей (1…${maxCount}):</span>
    <input id="sd-batch-n" type="number" min="1" max="${maxCount}" value="${maxCount}" style="width:60px;margin:0 6px;padding:2px 4px">
    <button id="sd-batch-ok" class="sd-btn-sel">Создать</button>
    <button id="sd-batch-cancel" class="sd-btn-sel" style="margin-left:4px">Отмена</button>
  `;
  st.style.display = '';
  document.getElementById('sd-batch-n').focus();
  document.getElementById('sd-batch-ok').addEventListener('click', () => {
    const n = Math.max(1, Math.min(maxCount, +document.getElementById('sd-batch-n').value || 1));
    createBatchLinks(n);
  });
  document.getElementById('sd-batch-cancel').addEventListener('click', () => updateStatus(''));
}

function createBatchLinks(n) {
  if (!lastLink || n <= 0) return;
  const links = getLinks();
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  const fromSeq = [];
  for (let p = 1; p <= pFrom && fromSeq.length < n; p++) if (!usedFrom.has(p)) fromSeq.push(p);
  const toSeq = [];
  for (let p = 1; p <= pTo && toSeq.length < n; p++) if (!usedTo.has(p)) toSeq.push(p);
  const count = Math.min(fromSeq.length, toSeq.length);
  const fromLabel = deviceLabel(lastLink.fromRackId, lastLink.fromDevId);
  const toLabel = deviceLabel(lastLink.toRackId, lastLink.toDevId);
  for (let i = 0; i < count; i++) {
    links.push({
      id: newId(),
      fromRackId: lastLink.fromRackId, fromDevId: lastLink.fromDevId, fromLabel,
      toRackId: lastLink.toRackId, toDevId: lastLink.toDevId, toLabel,
      fromPort: fromSeq[i], toPort: toSeq[i],
      cableType: 'cat6a', lengthM: null, note: '', createdAt: Date.now(),
    });
  }
  setLinks(links);
  updateStatus(`✔ Добавлено ${count} связей подряд (порты A:${fromSeq[0]}-${fromSeq[count-1]} ↔ B:${toSeq[0]}-${toSeq[count-1]}).`);
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
  renderLegend();
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
      if (key === 'links') scheduleOverlay();
      if (key === 'racks') renderRacksSummary();
      if (key === 'plan')  renderPlan();
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
  const real = racks.filter(r => (getRackTag(r.id) || '').trim());
  const drafts = racks.filter(r => !(getRackTag(r.id) || '').trim());
  const chipHtml = r => {
    const on = selected.has(r.id);
    const label = rackLabel(r);
    return `<label class="sd-rack-chip ${on ? 'on' : ''}" data-id="${r.id}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`;
  };
  const parts = [];
  if (real.length) {
    parts.push(`<div class="sd-rack-group-h">🗄 Реальные стойки (${real.length})</div>`);
    parts.push(`<div class="sd-rack-group">${real.map(chipHtml).join('')}</div>`);
  }
  if (drafts.length) {
    parts.push(`<div class="sd-rack-group-h draft">📐 Черновики / шаблоны без тега (${drafts.length})</div>`);
    parts.push(`<div class="sd-rack-group draft">${drafts.map(chipHtml).join('')}</div>`);
  }
  picker.innerHTML = parts.join('');

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
  renderLegend();
}

function renderLegend() {
  const host = document.getElementById('sd-legend'); if (!host) return;
  const used = new Set(getLinks().map(l => l.cableType || 'other'));
  if (!used.size) { host.innerHTML = ''; return; }
  host.innerHTML = '<span class="muted">Цвета кабелей:</span>' + CABLE_TYPES
    .filter(t => used.has(t.id))
    .map(t => `<span class="lg"><span class="lg-dot" style="background:${t.color}"></span>${escapeHtml(t.label)}</span>`)
    .join('');
}

function renderSelected(selected, racks) {
  const row = document.getElementById('sd-racks-row');
  const arr = racks.filter(r => selected.has(r.id));
  if (!arr.length) {
    row.innerHTML = `<div class="sd-empty-state">Выберите чекбоксами стойки выше — они появятся здесь рядом для проектирования связей.</div>`;
    drawLinkOverlay();
    return;
  }
  row.innerHTML = arr.map(r => renderRackCard(r)).join('');

  // клик по юниту — логика link-start / link-end
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    el.addEventListener('click', () => onUnitClick(el));
  });

  // подсветить устройства, участвующие в связях
  const links = getLinks();
  const involved = new Set();
  links.forEach(l => {
    involved.add(l.fromRackId + '|' + l.fromDevId);
    involved.add(l.toRackId + '|' + l.toDevId);
  });
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    const key = el.dataset.rackId + '|' + el.dataset.devId;
    el.classList.toggle('linked', involved.has(key));
  });

  drawLinkOverlay();
}

/* ---------- SVG overlay: кривые Безье между устройствами ---------- */
function drawLinkOverlay() {
  const svg = document.getElementById('sd-links-svg');
  const wrap = svg?.parentElement;
  const row = document.getElementById('sd-racks-row');
  if (!svg || !wrap || !row) return;
  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

  const getCenter = (rackId, devId, side) => {
    const el = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"][data-dev-id="${CSS.escape(devId)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const y = r.top - wrapRect.top + r.height / 2;
    const x = side === 'left' ? (r.left - wrapRect.left) : (r.right - wrapRect.left);
    return { x, y };
  };

  const cardXCenter = rackId => {
    const firstUnit = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"]`)
      || row.querySelector(`.sd-rack-card:has([data-rack-id="${CSS.escape(rackId)}"])`);
    if (!firstUnit) return null;
    const card = firstUnit.closest('.sd-rack-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return (r.left + r.right) / 2 - wrapRect.left;
  };

  const parts = [];
  const links = getLinks();
  links.forEach(l => {
    const fromCenter = cardXCenter(l.fromRackId);
    const toCenter = cardXCenter(l.toRackId);
    if (fromCenter == null || toCenter == null) return;
    const fromSide = fromCenter < toCenter ? 'right' : 'left';
    const toSide   = fromCenter < toCenter ? 'left'  : 'right';
    const A = getCenter(l.fromRackId, l.fromDevId, fromSide);
    const B = getCenter(l.toRackId, l.toDevId, toSide);
    if (!A || !B) return;
    const dx = Math.abs(B.x - A.x);
    const bend = Math.max(40, dx * 0.35);
    const c1x = A.x + (fromSide === 'right' ? bend : -bend);
    const c2x = B.x + (toSide === 'right' ? bend : -bend);
    const color = CABLE_COLOR(l.cableType);
    const fromTxt = getRackShortLabel(l.fromRackId) + ' · ' + deviceLabel(l.fromRackId, l.fromDevId) + (l.fromPort ? ` p${l.fromPort}` : '');
    const toTxt   = getRackShortLabel(l.toRackId)   + ' · ' + deviceLabel(l.toRackId,   l.toDevId)   + (l.toPort   ? ` p${l.toPort}`   : '');
    parts.push(`<path class="sd-link-path" d="M ${A.x} ${A.y} C ${c1x} ${A.y}, ${c2x} ${B.y}, ${B.x} ${B.y}" stroke="${color}"><title>${escapeAttr(fromTxt + ' ↔ ' + toTxt)}</title></path>`);
  });
  svg.innerHTML = parts.join('');
}

// Перерисовка линий при скролле/ресайзе
let overlayRaf = 0;
function scheduleOverlay() {
  if (overlayRaf) return;
  overlayRaf = requestAnimationFrame(() => { overlayRaf = 0; drawLinkOverlay(); });
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
      const h = +d.heightU || 1;
      // занимаемый диапазон: от top (i) до bottom (i - h + 1)
      const bottom = i - h + 1;
      const uRange = h > 1 ? `${i}-${bottom}` : `${i}`;
      const hBadge = h > 1 ? `<span class="u-hbadge">${h}U</span>` : '';
      // multi-U: высота = h × unit-row-height + (h-1) × gap. Рассчитывается через CSS var.
      const style = h > 1 ? ` style="--u-span:${h}"` : '';
      const organizer = isOrganizer(d);
      if (organizer) {
        units.push(`<div class="sd-unit organizer${h>1?' multi':''}"${style} title="Кабельный органайзер — только трассировка, не endpoint">
          <span class="u-num">${uRange}</span>
          <span class="u-label">⇋ ${escapeHtml(d.label || d.typeId || 'Органайзер')}${hBadge}</span>
        </div>`);
      } else {
        const isStart = linkStart && linkStart.rackId === r.id && linkStart.devId === d.id;
        const ports = devicePorts(r.id, d.id);
        const used = ports ? portsUsedOn(r.id, d.id).size : 0;
        const portBadge = ports > 1
          ? `<span class="u-pbadge${used >= ports ? ' full' : used ? ' part' : ''}" title="${used} из ${ports} портов занято">${used}/${ports}</span>`
          : '';
        units.push(`<div class="sd-unit${h>1?' multi':''}${isStart ? ' sel' : ''}"${style} data-rack-id="${escapeAttr(r.id)}" data-dev-id="${escapeAttr(d.id)}" title="${escapeAttr(d.label || d.typeId || '')}">
          <span class="u-num">${uRange}</span>
          <span class="u-label">${escapeHtml(d.label || d.typeId || '—')}${hBadge}${portBadge}</span>
        </div>`);
      }
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
  const pFrom = devicePorts(linkStart.rackId, linkStart.devId);
  const pTo   = devicePorts(rackId, devId);
  // Если оба устройства многопортовые — автоподбор первых свободных портов
  const usedFrom = portsUsedOn(linkStart.rackId, linkStart.devId);
  const usedTo   = portsUsedOn(rackId, devId);
  const firstFree = (max, used) => {
    for (let p = 1; p <= max; p++) if (!used.has(p)) return p;
    return null;
  };
  const fromPort = pFrom > 1 ? firstFree(pFrom, usedFrom) : null;
  const toPort   = pTo   > 1 ? firstFree(pTo,   usedTo)   : null;
  const newLink = {
    id: newId(),
    fromRackId: linkStart.rackId, fromDevId: linkStart.devId, fromLabel: linkStart.label,
    toRackId: rackId, toDevId: devId, toLabel: label,
    fromPort, toPort,
    cableType: 'cat6a',
    lengthM: null,
    note: '',
    createdAt: Date.now(),
  };
  links.push(newLink);
  setLinks(links);
  lastLink = { fromRackId: linkStart.rackId, fromDevId: linkStart.devId, toRackId: rackId, toDevId: devId };
  linkStart = null;
  const portInfo = (fromPort || toPort)
    ? ` (${fromPort ? 'A:p'+fromPort : 'A'} ↔ ${toPort ? 'B:p'+toPort : 'B'})`
    : '';
  const batchBtn = (pFrom > 1 && pTo > 1)
    ? ` <button id="sd-batch-btn" class="sd-btn-sel" style="margin-left:8px">+ ещё N связей подряд</button>`
    : '';
  updateStatus(`✔ Связь добавлена: <b>${escapeHtml(label)}</b>${portInfo}. Всего: ${links.length}.${batchBtn}`);
  document.getElementById('sd-batch-btn')?.addEventListener('click', promptBatchWire);
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
    renderBom();
    return;
  }
  const opts = CABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  // сначала таблицу нарисуем, BOM — отдельной функцией
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
        ${links.map((l, i) => {
          const fromMax = devicePorts(l.fromRackId, l.fromDevId);
          const toMax   = devicePorts(l.toRackId,   l.toDevId);
          const fromUsed = portsUsedOn(l.fromRackId, l.fromDevId, l.id);
          const toUsed   = portsUsedOn(l.toRackId,   l.toDevId,   l.id);
          const fromDup = l.fromPort && fromUsed.has(+l.fromPort);
          const toDup   = l.toPort   && toUsed.has(+l.toPort);
          const portInput = (who, max, dup, val) => max > 1
            ? `<input class="sd-port-in${dup ? ' sd-err' : ''}" data-act="${who}-port" type="number" min="1" max="${max}" value="${val == null ? '' : val}" placeholder="порт 1-${max}" style="width:78px;font-size:11px;margin-top:3px" title="Физический порт на устройстве (1…${max})${dup ? ' — конфликт: занят другой связью' : ''}">`
            : '';
          return `
          <tr data-id="${escapeAttr(l.id)}">
            <td>${i + 1}</td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.fromRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.fromRackId, l.fromDevId))}${l.fromPort ? ` · <b>p${l.fromPort}</b>` : ''}</div>
              ${portInput('from', fromMax, fromDup, l.fromPort)}
            </td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.toRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.toRackId, l.toDevId))}${l.toPort ? ` · <b>p${l.toPort}</b>` : ''}</div>
              ${portInput('to', toMax, toDup, l.toPort)}
            </td>
            <td>
              <select data-act="cable">${opts.replace(`value="${l.cableType}"`, `value="${l.cableType}" selected`)}</select>
            </td>
            <td><input type="number" min="0" step="0.1" value="${l.lengthM == null ? '' : l.lengthM}" data-act="length" style="width:80px"></td>
            <td><input type="text" value="${escapeAttr(l.note || '')}" data-act="note" placeholder="—"></td>
            <td><button data-act="del" class="sd-btn-del" title="Удалить связь">✕</button></td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
    <div class="sd-links-footer muted">Всего связей: ${links.length}. Хранилище: <code>scs-design.links.v1</code>.</div>
  `;
  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="cable"]').addEventListener('change', e => { updateLink(id, { cableType: e.target.value }); drawLinkOverlay(); });
    tr.querySelector('[data-act="length"]').addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { lengthM: v === '' ? null : +v });
    });
    tr.querySelector('[data-act="note"]').addEventListener('change', e => updateLink(id, { note: e.target.value }));
    tr.querySelector('[data-act="from-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { fromPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="to-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { toPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const cur = getLinks().filter(x => x.id !== id);
      setLinks(cur);
      renderLinksList();
      renderBom();
      renderLegend();
      // перерисовать подсветку linked в карточках
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
    });
  });
  renderBom();
}
/* ---------- BOM (cable journal) ---------- */
const BOM_RESERVE = 1.3; // коэфф. запаса длины

function renderBom() {
  const host = document.getElementById('sd-bom'); if (!host) return;
  const links = getLinks();
  if (!links.length) { host.innerHTML = `<div class="muted">Пока нет связей — BOM пуст.</div>`; return; }

  const byType = new Map();
  let totalLinesAll = 0, totalLenAll = 0, totalLenRawAll = 0, withoutLen = 0;
  for (const l of links) {
    totalLinesAll++;
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const row = byType.get(t);
    row.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) {
      row.lenRaw += +l.lengthM;
      totalLenRawAll += +l.lengthM;
    } else {
      row.withoutLen++;
      withoutLen++;
    }
  }
  const rows = [];
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  for (const [t, r] of byType.entries()) {
    const lenWithRes = r.lenRaw * BOM_RESERVE;
    totalLenAll += lenWithRes;
    rows.push(`<tr>
      <td>${escapeHtml(cableLabel(t))}</td>
      <td class="num">${r.lines}</td>
      <td class="num">${r.lenRaw ? r.lenRaw.toFixed(1) : '—'}</td>
      <td class="num">${r.lenRaw ? lenWithRes.toFixed(1) : '—'}</td>
      <td class="num">${r.withoutLen || ''}</td>
    </tr>`);
  }
  host.innerHTML = `
    <table class="sd-bom-table">
      <thead><tr>
        <th>Тип кабеля</th>
        <th class="num">Линий</th>
        <th class="num">Σ длин, м</th>
        <th class="num">С запасом ×${BOM_RESERVE}, м</th>
        <th class="num">Без длины</th>
      </tr></thead>
      <tbody>
        ${rows.join('')}
        <tr class="total">
          <td>Итого</td>
          <td class="num">${totalLinesAll}</td>
          <td class="num">${totalLenRawAll ? totalLenRawAll.toFixed(1) : '—'}</td>
          <td class="num">${totalLenAll ? totalLenAll.toFixed(1) : '—'}</td>
          <td class="num">${withoutLen || ''}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/* ---------- Tab «Стойки проекта» ---------- */
const KIND_ICON = {
  'switch':        { icon: '🔀', label: 'Свичи' },
  'patch-panel':   { icon: '🎛', label: 'Патч-панели' },
  'server':        { icon: '🖥', label: 'Серверы' },
  'storage':       { icon: '💾', label: 'СХД' },
  'kvm':           { icon: '⌨', label: 'KVM' },
  'monitor':       { icon: '📺', label: 'Мониторы' },
  'ups':           { icon: '🔋', label: 'ИБП-1U' },
  'cable-manager': { icon: '⇋',  label: 'Органайзеры' },
  'other':         { icon: '▫',  label: 'Другое' },
};

function rackStats(rack) {
  const u = +rack.u || 42;
  const devices = getContents(rack.id);
  let usedU = 0, powerW = 0;
  const byKind = {};
  for (const d of devices) {
    const t = catalogType(d.typeId);
    const h = +d.heightU || (t && +t.heightU) || 1;
    usedU += h;
    powerW += (+d.powerW) || (t && +t.powerW) || 0;
    const kind = (t && t.kind) || 'other';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  const links = getLinks().filter(l => l.fromRackId === rack.id || l.toRackId === rack.id);
  return { u, usedU, freeU: Math.max(0, u - usedU), powerW, devCount: devices.length, byKind, linkCount: links.length };
}

function renderRacksSummary() {
  const host = document.getElementById('sd-racks-summary');
  if (!host) return;
  const racks = getRacks();
  if (!racks.length) {
    host.innerHTML = `<div class="sd-empty-state">
      В проекте ещё нет шкафов. Создайте их в
      <a href="../rack-config/">Конфигураторе шкафа — корпус</a> (шаблоны)
      и наполните в <a href="../scs-config/">Компоновщике шкафа</a>.
    </div>`;
    return;
  }
  const kinds = Object.keys(KIND_ICON);
  const selected = new Set(loadJson(LS_SELECTION, []));

  // Сначала стойки с тегом (реальные), затем без тега (черновики/шаблоны)
  const sorted = racks.slice().sort((a, b) => {
    const ta = (getRackTag(a.id) || '').trim();
    const tb = (getRackTag(b.id) || '').trim();
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return ta.localeCompare(tb) || (a.name || '').localeCompare(b.name || '');
  });
  const rows = sorted.map(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    const fillPct = Math.round((s.usedU / s.u) * 100);
    const fillCls = fillPct >= 90 ? ' over' : fillPct >= 70 ? ' hi' : '';
    const breakdown = kinds
      .filter(k => s.byKind[k])
      .map(k => `<span class="sd-kind-chip" title="${escapeAttr(KIND_ICON[k].label)}">${KIND_ICON[k].icon} ${s.byKind[k]}</span>`)
      .join('') || '<span class="muted">—</span>';
    const isSel = selected.has(r.id);
    const draft = !tag.trim();
    return `<tr data-id="${escapeAttr(r.id)}"${draft ? ' class="draft"' : ''} title="${draft ? 'Без тега — черновик/шаблон, не реальная стойка' : ''}">
      <td>${draft ? '<span class="sd-draft-badge" title="Нет тега">📐 черновик</span>' : `<code>${escapeHtml(tag)}</code>`}</td>
      <td>${escapeHtml(r.name || 'Без имени')}</td>
      <td class="num">${s.usedU}/${s.u}
        <div class="sd-bar"><div class="sd-bar-fill${fillCls}" style="width:${Math.min(100, fillPct)}%"></div></div>
      </td>
      <td class="num">${s.powerW ? (s.powerW / 1000).toFixed(2) + ' кВт' : '—'}</td>
      <td class="num">${s.devCount}</td>
      <td class="kinds">${breakdown}</td>
      <td class="num">${s.linkCount || '<span class="muted">—</span>'}</td>
      <td>
        <button type="button" class="sd-btn-sel ${isSel ? 'on' : ''}" data-act="toggle-sel">${isSel ? '✓ выбрана' : '+ в мастер'}</button>
        <a href="../scs-config/rack.html?rackId=${encodeURIComponent(r.id)}" class="sd-btn-sel" style="text-decoration:none;margin-left:4px">открыть</a>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = `<table class="sd-racks-table">
    <thead><tr>
      <th>Тег</th><th>Имя</th><th class="num">U</th><th class="num">Мощность</th>
      <th class="num">Устр.</th><th>Разбивка</th><th class="num">Связей</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="toggle-sel"]')?.addEventListener('click', () => {
      const sel = new Set(loadJson(LS_SELECTION, []));
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      saveJson(LS_SELECTION, Array.from(sel));
      renderRacksSummary();
      renderLinksTab(); // обновить чипы в мастере
    });
  });
}

function exportRacksCsv() {
  const racks = getRacks();
  const rows = [['Тег', 'Имя', 'U занято', 'U всего', 'U свободно', 'Мощность, кВт', 'Устройств', 'Свичи', 'Патч-панели', 'Серверы', 'ИБП-1U', 'Органайзеры', 'Другое', 'Связей']];
  racks.forEach(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    rows.push([
      tag, r.name || '', s.usedU, s.u, s.freeU,
      s.powerW ? (s.powerW / 1000).toFixed(2) : '',
      s.devCount,
      s.byKind['switch'] || 0, s.byKind['patch-panel'] || 0, s.byKind['server'] || 0,
      s.byKind['ups'] || 0, s.byKind['cable-manager'] || 0, s.byKind['other'] || 0,
      s.linkCount,
    ]);
  });
  downloadCsv('scs-racks-' + dateStamp() + '.csv', rows);
}

/* ---------- Tab «План зала» ---------- */
const PLAN_DEFAULT = { step: 0.6, kRoute: 1.3, positions: {} };
const PLAN_CELL_PX = 24; // одна клетка = 24 px на экране
const PLAN_COLS = 40, PLAN_ROWS = 24;
const RACK_W_CELLS = 2; // прямоугольник стойки 2×1 клетки
const RACK_H_CELLS = 1;

function getPlan() {
  const p = loadJson(LS_PLAN, PLAN_DEFAULT);
  return {
    step: +p?.step || PLAN_DEFAULT.step,
    kRoute: +p?.kRoute || PLAN_DEFAULT.kRoute,
    positions: (p && p.positions && typeof p.positions === 'object') ? p.positions : {},
  };
}
function savePlan(p) { saveJson(LS_PLAN, p); }

function manhattanCells(a, b) {
  // центр прямоугольника стойки
  const ax = a.x + RACK_W_CELLS / 2, ay = a.y + RACK_H_CELLS / 2;
  const bx = b.x + RACK_W_CELLS / 2, by = b.y + RACK_H_CELLS / 2;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function renderPlan() {
  const canvas = document.getElementById('sd-plan-canvas');
  const palette = document.getElementById('sd-plan-palette');
  const info = document.getElementById('sd-plan-info');
  const stepIn = document.getElementById('sd-plan-step');
  const krIn = document.getElementById('sd-plan-kroute');
  if (!canvas || !palette) return;

  const plan = getPlan();
  if (stepIn) stepIn.value = plan.step;
  if (krIn) krIn.value = plan.kRoute;

  const racks = getRacks();
  const placed = racks.filter(r => plan.positions[r.id]);
  const unplaced = racks.filter(r => !plan.positions[r.id]);

  // Палитра
  palette.innerHTML = unplaced.length
    ? unplaced.map(r => `<span class="sd-plan-chip" draggable="true" data-id="${escapeAttr(r.id)}">${escapeHtml(getRackShortLabel(r.id))}</span>`).join('')
    : '<span class="muted">Все стойки размещены на плане.</span>';

  palette.querySelectorAll('.sd-plan-chip').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/sd-rack', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // Canvas
  canvas.style.width = (PLAN_COLS * PLAN_CELL_PX) + 'px';
  canvas.style.height = (PLAN_ROWS * PLAN_CELL_PX) + 'px';
  canvas.style.backgroundSize = `${PLAN_CELL_PX}px ${PLAN_CELL_PX}px`;
  canvas.innerHTML = '';

  // SVG слой для линий связей
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sd-plan-svg');
  svg.setAttribute('width', PLAN_COLS * PLAN_CELL_PX);
  svg.setAttribute('height', PLAN_ROWS * PLAN_CELL_PX);
  canvas.appendChild(svg);

  // Размещённые стойки
  placed.forEach(r => {
    const pos = plan.positions[r.id];
    const s = rackStats(r);
    const pct = s.u ? Math.round((s.usedU / s.u) * 100) : 0;
    let cls = '';
    if (pct >= 100) cls = ' over';
    else if (pct >= 90) cls = ' hi';
    else if (pct >= 70) cls = ' mid';
    else if (pct > 0) cls = ' low';
    else cls = ' empty';
    const tag = getRackTag(r.id);
    const isDraft = !tag.trim();
    const div = document.createElement('div');
    div.className = 'sd-plan-rack' + cls + (isDraft ? ' draft' : '');
    div.dataset.id = r.id;
    div.style.left = (pos.x * PLAN_CELL_PX) + 'px';
    div.style.top = (pos.y * PLAN_CELL_PX) + 'px';
    div.style.width = (RACK_W_CELLS * PLAN_CELL_PX) + 'px';
    div.style.height = (RACK_H_CELLS * PLAN_CELL_PX) + 'px';
    div.title = `${tag || r.name || r.id}\nU: ${s.usedU}/${s.u} (${pct}%)\nУстр.: ${s.devCount} · Связей: ${s.linkCount}`;
    div.innerHTML = `<span class="sd-plan-rack-label">${escapeHtml(tag || r.name || r.id)}</span>
      <button type="button" class="sd-plan-rm" title="Убрать со схемы">✕</button>`;
    canvas.appendChild(div);

    // drag для перемещения
    let dragging = false, startX = 0, startY = 0, startCell = null;
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('sd-plan-rm')) return;
      dragging = true;
      div.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      startCell = { x: pos.x, y: pos.y };
      div.classList.add('dragging');
    });
    div.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = Math.round((e.clientX - startX) / PLAN_CELL_PX);
      const dy = Math.round((e.clientY - startY) / PLAN_CELL_PX);
      const nx = Math.max(0, Math.min(PLAN_COLS - RACK_W_CELLS, startCell.x + dx));
      const ny = Math.max(0, Math.min(PLAN_ROWS - RACK_H_CELLS, startCell.y + dy));
      div.style.left = (nx * PLAN_CELL_PX) + 'px';
      div.style.top = (ny * PLAN_CELL_PX) + 'px';
      pos.x = nx; pos.y = ny;
      drawPlanLinks(svg, plan);
    });
    div.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      div.classList.remove('dragging');
      const p2 = getPlan();
      p2.positions[r.id] = { x: pos.x, y: pos.y };
      savePlan(p2);
      updatePlanInfo();
    });
    div.querySelector('.sd-plan-rm').addEventListener('click', () => {
      const p2 = getPlan();
      delete p2.positions[r.id];
      savePlan(p2);
      renderPlan();
    });
  });

  // Drop target
  canvas.addEventListener('dragover', e => {
    if (Array.from(e.dataTransfer.types).includes('text/sd-rack')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  canvas.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/sd-rack');
    if (!id) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(PLAN_COLS - RACK_W_CELLS, Math.floor((e.clientX - rect.left) / PLAN_CELL_PX)));
    const y = Math.max(0, Math.min(PLAN_ROWS - RACK_H_CELLS, Math.floor((e.clientY - rect.top) / PLAN_CELL_PX)));
    const p2 = getPlan();
    p2.positions[id] = { x, y };
    savePlan(p2);
    renderPlan();
  });

  drawPlanLinks(svg, plan);
  updatePlanInfo();
}

function drawPlanLinks(svg, plan) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const links = getLinks();
  links.forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    const ax = (a.x + RACK_W_CELLS / 2) * PLAN_CELL_PX;
    const ay = (a.y + RACK_H_CELLS / 2) * PLAN_CELL_PX;
    const bx = (b.x + RACK_W_CELLS / 2) * PLAN_CELL_PX;
    const by = (b.y + RACK_H_CELLS / 2) * PLAN_CELL_PX;
    // L-образная манхэттен-трасса
    const color = CABLE_COLOR(l.cableType);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${ax} ${ay} L ${bx} ${ay} L ${bx} ${by}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', '0.7');
    svg.appendChild(path);
  });
}

function computeSuggestedLength(link, plan) {
  const a = plan.positions[link.fromRackId];
  const b = plan.positions[link.toRackId];
  if (!a || !b) return null;
  const cells = manhattanCells(a, b);
  return cells * plan.step * plan.kRoute;
}

function updatePlanInfo() {
  const info = document.getElementById('sd-plan-info');
  if (!info) return;
  const plan = getPlan();
  const links = getLinks();
  const total = links.length;
  const withPos = links.filter(l => plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  const missing = links.filter(l => (l.lengthM == null) && plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  info.innerHTML = `связей: <b>${withPos}</b>/${total} размещено · без длины: <b>${missing}</b>`;
}

function applySuggestedLengths() {
  const plan = getPlan();
  const links = getLinks();
  let n = 0;
  links.forEach(l => {
    if (l.lengthM != null) return;
    const len = computeSuggestedLength(l, plan);
    if (len != null) { l.lengthM = Math.round(len * 10) / 10; n++; }
  });
  setLinks(links);
  updateStatus(`✔ Заполнено длин: ${n}. Масштаб ${plan.step} м/клетка × коэф. ${plan.kRoute}.`);
  renderLinksList();
  updatePlanInfo();
  drawLinkOverlay();
}

function resetPlan() {
  savePlan({ ...getPlan(), positions: {} });
  renderPlan();
}

/* Автораскладка: реальные стойки с тегом группируются по «ряду» — префиксу
   до первой точки (например, DH1.SR1/DH1.SR2 → ряд DH1). Каждый ряд —
   отдельная строка плана, стойки вдоль неё. Черновики (без тега) — в отдельный
   последний ряд. Ряды разделены 2 клетками аисла. */
function autoLayout() {
  const racks = getRacks();
  if (!racks.length) return;
  const plan = getPlan();
  const tags = {};
  racks.forEach(r => { tags[r.id] = (getRackTag(r.id) || '').trim(); });

  const rows = new Map(); // rowKey -> [rackIds]
  racks.forEach(r => {
    const tag = tags[r.id];
    let key;
    if (!tag) key = '__draft__';
    else {
      const dot = tag.indexOf('.');
      key = dot > 0 ? tag.slice(0, dot) : tag;
    }
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(r);
  });

  // В рамках ряда сортируем по тегу (SR1 перед SR2…)
  for (const arr of rows.values()) {
    arr.sort((a, b) => (tags[a.id] || '').localeCompare(tags[b.id] || '', 'ru', { numeric: true }));
  }

  const positions = {};
  const rowKeys = Array.from(rows.keys()).sort((a, b) => {
    if (a === '__draft__') return 1;
    if (b === '__draft__') return -1;
    return a.localeCompare(b, 'ru', { numeric: true });
  });
  const rowGap = 2;  // клетки между рядами (hot/cold aisle approximation)
  const colGap = 0;  // соседние стойки впритык
  const rackW = RACK_W_CELLS + colGap;
  const maxCols = Math.floor((PLAN_COLS - 1) / rackW) || 1;
  let curRow = 1;
  rowKeys.forEach(key => {
    const arr = rows.get(key);
    let col = 1;
    arr.forEach(r => {
      if (col + RACK_W_CELLS > PLAN_COLS) {
        // перенос на следующую подстроку
        col = 1;
        curRow += RACK_H_CELLS + rowGap;
      }
      positions[r.id] = { x: col, y: curRow };
      col += rackW;
    });
    curRow += RACK_H_CELLS + rowGap;
  });

  savePlan({ ...plan, positions });
  renderPlan();
  updateStatus(`✔ Автораскладка: ${Object.keys(positions).length} стоек размещено в ${rowKeys.length} рядов.`);
}

/* ---------- CSV export ---------- */
function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  // BOM для Excel + UTF-8
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function exportBomCsv() {
  const links = getLinks();
  const byType = new Map();
  for (const l of links) {
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const r = byType.get(t);
    r.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) r.lenRaw += +l.lengthM;
    else r.withoutLen++;
  }
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['Тип кабеля', 'Линий', 'Σ длин, м', `С запасом ×${BOM_RESERVE}, м`, 'Без длины']];
  for (const [t, r] of byType.entries()) {
    rows.push([cableLabel(t), r.lines, r.lenRaw.toFixed(1), (r.lenRaw * BOM_RESERVE).toFixed(1), r.withoutLen || '']);
  }
  downloadCsv('scs-bom-' + dateStamp() + '.csv', rows);
}

function exportLinksCsv() {
  const links = getLinks();
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['#', 'Шкаф A', 'Устройство A', 'Порт A', 'Шкаф B', 'Устройство B', 'Порт B', 'Кабель', 'Длина, м', 'С запасом, м', 'Заметка']];
  links.forEach((l, i) => {
    const len = l.lengthM != null && !Number.isNaN(+l.lengthM) ? +l.lengthM : null;
    rows.push([
      i + 1,
      getRackShortLabel(l.fromRackId),
      deviceLabel(l.fromRackId, l.fromDevId),
      l.fromPort || '',
      getRackShortLabel(l.toRackId),
      deviceLabel(l.toRackId, l.toDevId),
      l.toPort || '',
      cableLabel(l.cableType),
      len == null ? '' : len.toFixed(1),
      len == null ? '' : (len * BOM_RESERVE).toFixed(1),
      l.note || '',
    ]);
  });
  downloadCsv('scs-links-' + dateStamp() + '.csv', rows);
}
/* ---------- Project JSON import / export ---------- */
const PROJECT_SCHEMA = 'raschet.scs-design/1';

function exportProjectJson() {
  const payload = {
    schema: PROJECT_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: (document.querySelector('[data-app-version]')?.textContent || '').trim(),
    selection: loadJson(LS_SELECTION, []),
    links: getLinks(),
    plan: getPlan(),
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scs-design-${dateStamp()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  const st = document.getElementById('sd-import-status');
  if (st) st.textContent = `✔ Сохранено: ${payload.links.length} связей · ${Object.keys(payload.plan.positions || {}).length} позиций · ${payload.selection.length} выбр.стоек`;
}

function importProjectJson(file) {
  const st = document.getElementById('sd-import-status');
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj || obj.schema !== PROJECT_SCHEMA) {
        if (st) st.textContent = `⚠ Не похоже на проект SCS (schema ≠ ${PROJECT_SCHEMA}).`;
        return;
      }
      if (Array.isArray(obj.selection)) saveJson(LS_SELECTION, obj.selection);
      if (Array.isArray(obj.links)) setLinks(obj.links);
      if (obj.plan && typeof obj.plan === 'object') savePlan(obj.plan);
      if (st) st.textContent = `✔ Импортировано: ${(obj.links || []).length} связей · ${Object.keys((obj.plan && obj.plan.positions) || {}).length} позиций · ${(obj.selection || []).length} выбр.стоек`;
      renderLinksTab();
      renderPlan();
      renderRacksSummary();
    } catch (err) {
      if (st) st.textContent = `⚠ Ошибка чтения: ${err.message}`;
    }
  };
  rd.readAsText(file);
}

function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function updateLink(id, patch) {
  const cur = getLinks();
  const i = cur.findIndex(x => x.id === id);
  if (i < 0) return;
  cur[i] = { ...cur[i], ...patch };
  setLinks(cur);
  renderBom();
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
  const cleaned = sanitizeLinks();
  renderLinksTab();
  if (cleaned > 0) {
    updateStatus(`⚠ Удалено ${cleaned} связь(ей) с кабельными органайзерами — у них нет портов, они используются только для трассировки.`);
  }
  document.getElementById('sd-export-csv')?.addEventListener('click', exportBomCsv);
  document.getElementById('sd-export-links-csv')?.addEventListener('click', exportLinksCsv);
  document.getElementById('sd-racks-csv')?.addEventListener('click', exportRacksCsv);
  document.getElementById('sd-plan-apply')?.addEventListener('click', applySuggestedLengths);
  document.getElementById('sd-plan-reset')?.addEventListener('click', resetPlan);
  document.getElementById('sd-plan-autolay')?.addEventListener('click', autoLayout);
  document.getElementById('sd-export-json')?.addEventListener('click', exportProjectJson);
  const importBtn = document.getElementById('sd-import-json');
  const importFile = document.getElementById('sd-import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) importProjectJson(f);
      e.target.value = '';
    });
  }
  document.getElementById('sd-plan-step')?.addEventListener('change', e => {
    const p = getPlan(); p.step = Math.max(0.1, +e.target.value || PLAN_DEFAULT.step); savePlan(p); updatePlanInfo();
  });
  document.getElementById('sd-plan-kroute')?.addEventListener('change', e => {
    const p = getPlan(); p.kRoute = Math.max(1.0, +e.target.value || PLAN_DEFAULT.kRoute); savePlan(p); updatePlanInfo();
  });
  window.addEventListener('storage', (e) => {
    if ([LS_RACK, LS_CONTENTS, LS_RACKTAGS, LS_LINKS].includes(e.key)) renderLinksTab();
  });
  // пересчёт линий при скролле ряда стоек, скролле юнитов внутри карточки и ресайзе окна
  document.getElementById('sd-racks-row')?.addEventListener('scroll', scheduleOverlay, true);
  window.addEventListener('resize', scheduleOverlay);
});
