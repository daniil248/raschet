/* =========================================================================
   suppression-config.js — АГПТ: иерархическая модель
   Установка → (Сборка модулей | Направления → Зоны) + Аксонометрия + Отчёт.

   Персистентность: localStorage 'raschet.sup.installations.v1'
   ========================================================================= */

import { AGENTS } from '../suppression-methods/agents.js';
import { MODULE_SERIES, SERIES_LIST, listVariants, findVariant }
  from '../suppression-methods/modules-catalog.js';
import * as Annex from '../suppression-methods/sp-485-annex-d.js';
import { buildReport } from '../suppression-methods/report-text.js';

const $ = id => document.getElementById(id);
const LS_KEY = 'raschet.sup.installations.v1';

/* ------------------- State ------------------- */
const S = {
  installations: {},   // id → installation
  currentId: null,
  selected: { kind: 'inst', dirId: null }, // kind: 'inst' | 'asm' | 'dir'
  isoDirId: null,
  isoSelSeg: null,
  isoShowNums: true,
  isoShowNozz: true,
};

function loadAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveAll() { localStorage.setItem(LS_KEY, JSON.stringify(S.installations)); }

function newId(prefix = '') { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function currentInst() { return S.installations[S.currentId]; }

/* ------------------- Defaults ------------------- */
function defaultInstallation() {
  const agent = 'HFC-227ea';
  const series = 'МГП-Консул';
  const variants = listVariants(series);
  const moduleCode = variants[0]?.code || '';
  return {
    id: newId('inst-'),
    name: 'Установка 1',
    elevation: 0,
    norm: 'sp-485-annex-d',
    agent,
    series,
    moduleCode,
    installType: 'modular',
    site: { name: '', address: '', contract: '', customer: '', info: '' },
    author: '',
    directions: [],
    assemblies: [],
    pu: [],
    createdAt: Date.now(),
    calcNo: '0001-G',
  };
}

function defaultDirection(n = 1) {
  return {
    id: newId('dir-'), name: `Направление ${n}`,
    type: 'volume',
    tmin: 20, feedTime: 10, smoke: true,
    fire: 'EI30', mount: 'wall',
    exhaust: 'outside', exhaustDist: 10,
    prelief: true, exec: 'standard',
    fireClass: 'A2', leakage: 'II',
    zones: [],
    pipeline: [],
  };
}

function defaultZone(n = 1) {
  return {
    id: newId('z-'), name: `зона ${n}`,
    S: 15, H: 3, Cn: 7.2, fs: 0, P: 0.4, Ppr: 0.003,
  };
}

/* ------------------- Welcome + open ------------------- */
function showWelcome() { $('sup-welcome').hidden = false; $('sup-ws').hidden = true; }
function showWorkspace() { $('sup-welcome').hidden = true; $('sup-ws').hidden = false; renderAll(); }

function initWelcome() {
  $('sup-w-create').addEventListener('click', () => openInstDialog(null));
  $('sup-w-open').addEventListener('click', () => {
    const list = $('open-list');
    const items = Object.values(S.installations).sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    if (!items.length) { list.innerHTML = '<li style="color:#888;">Нет сохранённых установок</li>'; }
    else {
      list.innerHTML = items.map(i => `
        <li data-id="${i.id}">
          <span class="name">${i.name}</span>
          <span class="date">${new Date(i.createdAt).toLocaleDateString('ru-RU')}</span>
          <span class="del" data-del="${i.id}" title="Удалить">✕</span>
        </li>`).join('');
      list.onclick = (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
          e.stopPropagation();
          if (confirm('Удалить установку?')) {
            delete S.installations[del.dataset.del];
            saveAll();
            $('sup-w-open').click();
          }
          return;
        }
        const li = e.target.closest('li[data-id]');
        if (li) { S.currentId = li.dataset.id; $('dlg-open').close(); showWorkspace(); }
      };
    }
    $('dlg-open').showModal();
  });
}

/* ------------------- Installation dialog ------------------- */
function fillSelect(sel, items, current) {
  sel.innerHTML = items.map(i =>
    `<option value="${i.value}"${i.value === current ? ' selected' : ''}>${i.label}</option>`
  ).join('');
}

function setupInstFormSelects(currentValues = {}) {
  fillSelect($('f-agent'),
    Object.entries(AGENTS).map(([k,v]) => ({ value:k, label:v.label })),
    currentValues.agent);
  fillSelect($('f-series'),
    SERIES_LIST.map(s => ({ value:s.id, label:`${s.id} — ${s.manufacturer}` })),
    currentValues.series);
  const vars = listVariants($('f-series').value);
  fillSelect($('f-module'),
    vars.map(v => ({ value:v.code, label:`${v.code} (${v.ob} л)` })),
    currentValues.moduleCode);
}

function openInstDialog(existingId) {
  const dlg = $('dlg-inst');
  const existing = existingId ? S.installations[existingId] : null;
  $('dlg-inst-h').textContent = existing ? 'Установка: редактирование' : 'Установка: создание';
  setupInstFormSelects(existing || {});
  $('f-series').onchange = () => {
    const vars = listVariants($('f-series').value);
    fillSelect($('f-module'), vars.map(v => ({ value:v.code, label:`${v.code} (${v.ob} л)` })), null);
  };
  $('f-name').value = existing?.name ?? '';
  $('f-elev').value = existing?.elevation ?? 0;
  $('f-norm').value = existing?.norm ?? 'sp-485-annex-d';
  document.querySelectorAll('input[name="f-inst"]').forEach(r => r.checked = (r.value === (existing?.installType || 'modular')));
  $('f-site-name').value = existing?.site?.name ?? '';
  $('f-site-addr').value = existing?.site?.address ?? '';
  $('f-site-contract').value = existing?.site?.contract ?? '';
  $('f-site-customer').value = existing?.site?.customer ?? '';
  $('f-site-info').value = existing?.site?.info ?? '';

  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', function onClose() {
    dlg.removeEventListener('close', onClose);
    if (dlg.returnValue !== 'ok') return;
    const base = existing || defaultInstallation();
    Object.assign(base, {
      name: $('f-name').value.trim() || 'Установка',
      elevation: +$('f-elev').value || 0,
      norm: $('f-norm').value,
      agent: $('f-agent').value,
      series: $('f-series').value,
      moduleCode: $('f-module').value,
      installType: document.querySelector('input[name="f-inst"]:checked').value,
      site: {
        name: $('f-site-name').value,
        address: $('f-site-addr').value,
        contract: $('f-site-contract').value,
        customer: $('f-site-customer').value,
        info: $('f-site-info').value,
      },
    });
    if (!existing) {
      base.calcNo = `${String(Object.keys(S.installations).length+1).padStart(4,'0')}-G`;
      S.installations[base.id] = base;
      S.currentId = base.id;
    }
    saveAll();
    showWorkspace();
  });
}

/* ------------------- Tree ------------------- */
function renderTree() {
  const inst = currentInst();
  if (!inst) return;
  const tree = $('sup-tree');
  const active = (k, d) => (S.selected.kind === k && S.selected.dirId === d) ? 'active' : '';
  const items = [];
  items.push(`<li class="branch ${active('inst', null)}" data-kind="inst">▾ ${esc(inst.name)}</li>`);
  items.push(`<li class="${active('asm', null)}" data-kind="asm">Сборка модулей</li>`);
  items.push(`<li class="branch">▾ Направления</li>`);
  inst.directions.forEach(d => {
    items.push(`<li class="${active('dir', d.id)}" data-kind="dir" data-id="${d.id}">${esc(d.name)}</li>`);
  });
  items.push(`<li class="leaf-add" data-kind="add-dir">+ Добавить</li>`);
  tree.innerHTML = items.join('');
  tree.onclick = (e) => {
    const li = e.target.closest('li[data-kind]');
    if (!li) return;
    if (li.dataset.kind === 'add-dir') { openDirDialog(null); return; }
    S.selected = { kind: li.dataset.kind, dirId: li.dataset.id || null };
    renderAll();
  };
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

/* ------------------- Views ------------------- */
function renderAll() {
  renderTree();
  renderRight();
  const { kind } = S.selected;
  show('sup-view-inst', kind === 'inst');
  show('sup-view-asm',  kind === 'asm');
  show('sup-view-dir',  kind === 'dir');
  if (kind === 'inst') renderInstView();
  if (kind === 'asm')  renderAsmView();
  if (kind === 'dir')  renderDirView();
  renderWarnings();
}

function show(id, on) { $(id).hidden = !on; }

function renderInstView() {
  const inst = currentInst();
  $('sup-inst-title').textContent = inst.name;
  const tb = document.querySelector('#sup-dir-tbl tbody');
  tb.innerHTML = inst.directions.map(d => {
    const r = computeDir(d) || {};
    const nozz = (d.pipeline || []).filter(p => p.nozzle && p.nozzle !== 'none').length;
    return `<tr data-id="${d.id}">
      <td><a href="#" class="dir-lnk" data-id="${d.id}">${esc(d.name)}</a></td>
      <td class="num">${r.mg ?? '—'}</td>
      <td class="num">${r.n ?? '—'}</td>
      <td class="num">${r.tpd ?? '—'}</td>
      <td class="num">${nozz}</td>
      <td class="num">${r.Fc ?? '—'}</td>
    </tr>`;
  }).join('');
  tb.onclick = (e) => {
    const a = e.target.closest('.dir-lnk');
    if (a) { e.preventDefault(); S.selected = { kind:'dir', dirId: a.dataset.id }; renderAll(); }
  };
}

function renderAsmView() {
  const inst = currentInst();
  // Авто-сборка: по одной батарее на направление, кол-во основных = n_calc
  if (!inst.assemblies.length) {
    inst.assemblies = inst.directions.map((d, i) => {
      const r = computeDir(d);
      return {
        id: newId('asm-'), idx: i+1,
        main: r?.n || 1, reserve: 0, twoRow: false,
        collectorL: 0, collectorDN: 40, backupNo: '',
        dirId: d.id,
      };
    });
  }
  const tb = document.querySelector('#sup-asm-tbl tbody');
  tb.innerHTML = inst.assemblies.map((a, i) => `
    <tr data-id="${a.id}">
      <td>${i+1}</td>
      <td><input type="number" data-f="main" value="${a.main}" min="0" style="width:60px;"></td>
      <td><input type="number" data-f="reserve" value="${a.reserve}" min="0" style="width:60px;"></td>
      <td><input type="checkbox" data-f="twoRow" ${a.twoRow?'checked':''}></td>
      <td><input type="number" data-f="collectorL" value="${a.collectorL}" step="0.1" style="width:70px;"></td>
      <td><input type="number" data-f="collectorDN" value="${a.collectorDN}" min="15" style="width:60px;"></td>
      <td><input type="text" data-f="backupNo" value="${a.backupNo||''}" style="width:40px;"></td>
      <td><button class="sup-ibtn sup-danger" data-del="${a.id}">✕</button></td>
    </tr>`).join('');
  tb.oninput = (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = inst.assemblies.find(x => x.id === tr.dataset.id); if (!a) return;
    const f = e.target.dataset.f;
    a[f] = e.target.type === 'checkbox' ? e.target.checked
         : e.target.type === 'number' ? +e.target.value : e.target.value;
    saveAll();
  };
  tb.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      inst.assemblies = inst.assemblies.filter(a => a.id !== del.dataset.del);
      saveAll(); renderAsmView();
    }
  };
  // ПУ
  const pu = document.querySelector('#sup-pu-tbl tbody');
  pu.innerHTML = inst.directions.map(d => {
    const r = computeDir(d);
    return `<tr><td>${esc(d.name)}</td><td class="num">${r?.n||0}</td><td class="num">${r?.n||0}</td></tr>`;
  }).join('');
}

function renderDirView() {
  const inst = currentInst();
  const dir = inst.directions.find(d => d.id === S.selected.dirId);
  if (!dir) { S.selected = { kind:'inst', dirId:null }; return renderAll(); }
  $('sup-dir-title').textContent = dir.name;
  // zones
  const grid = $('sup-zones-grid');
  grid.innerHTML = dir.zones.map(z => `
    <div class="sup-zone-card" data-id="${z.id}">
      <span class="zone-del" data-del="${z.id}" style="float:right;color:#c62828;cursor:pointer;">✕</span>
      <span class="zt">${esc(z.name)}</span>
      <span class="zx">S = ${z.S} м² × H = ${z.H} м (V = ${(z.S*z.H).toFixed(1)} м³)</span>
      <span class="zx">Cн = ${z.Cn}%, fs = ${z.fs} м², П = ${z.P}</span>
    </div>`).join('');
  grid.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      dir.zones = dir.zones.filter(z => z.id !== del.dataset.del);
      saveAll(); renderAll(); return;
    }
    const c = e.target.closest('.sup-zone-card');
    if (c) openZoneDialog(dir, c.dataset.id);
  };
  // summary
  const r = computeDir(dir);
  setVal('sup-s-Mcalc', r?.mp ?? '—');
  setVal('sup-s-Mfact', r?.mg ?? '—');
  setVal('sup-s-Ncalc', r?.n ?? '—');
  setVal('sup-s-Nfact', r?.n ?? '—');
  setVal('sup-s-Mmin',  r?.Mmin ?? '—');
  setVal('sup-s-KZ',    r ? (r.mg / (r.n * r.ob)).toFixed(3) : '—');
  setVal('sup-s-Mpipe', r?.mtr ?? '—');
  setVal('sup-s-Mres',  r ? (r.n * r.m1).toFixed(2) : '—');
  setVal('sup-s-tpd',   r?.tpd ?? '—');
  setVal('sup-s-Fc',    r?.Fc ?? '—');
}
function setVal(id, v) { $(id).value = v; }

function renderRight() {
  const inst = currentInst();
  if (!inst) return;
  const a = AGENTS[inst.agent];
  const normLabel = {
    'sp-485-annex-d':'СП 485 Прил. Д',
    'sp-rk-2022':'СП РК 2.02-102-2022',
    'nfpa-2001':'NFPA 2001',
    'iso-14520':'ISO 14520',
  }[inst.norm] || inst.norm;
  $('i-norm').textContent = normLabel;
  $('i-agent').textContent = a?.label || '—';
  $('i-mod').textContent = inst.moduleCode || '—';
  $('i-elev').textContent = inst.elevation;
  $('i-ndir').textContent = inst.directions.length;
  let ntotal = 0, mtotal = 0;
  inst.directions.forEach(d => { const r = computeDir(d); if (r) { ntotal += r.n; mtotal += r.mg; } });
  $('i-ntotal').textContent = ntotal;
  $('i-mtotal').textContent = mtotal.toFixed(1);
}

/* ------------------- Warnings ------------------- */
function renderWarnings() {
  const inst = currentInst();
  const ul = $('sup-warn'); const items = [];
  if (!inst.directions.length) items.push('Нет направлений. Добавьте хотя бы одно.');
  inst.directions.forEach(d => {
    if (!d.zones.length) items.push(`«${d.name}»: нет зон.`);
    d.zones.forEach(z => {
      const paramMax = 0.022;
      const param = z.fs > 0 ? (z.fs / (z.S * z.H)) : 0;
      if (param > paramMax)
        items.push(`«${d.name}» / «${z.name}»: параметр негерметичности (${param.toFixed(4)} м⁻¹) превышает допустимый (${paramMax}).`);
    });
    if (!d.pipeline.length) items.push(`«${d.name}»: присутствует незакрытый трубопровод.`);
  });
  ul.innerHTML = items.map(x => `<li>${esc(x)}</li>`).join('') || `<li style="color:#2e7d32;list-style:none;">Без замечаний ✓</li>`;
}

/* ------------------- Computation ------------------- */
function computeDir(dir) {
  const inst = currentInst();
  if (!inst || !dir.zones.length) return null;
  // Суммарный объём по всем зонам, берём параметры 1-й зоны как репрезентативные
  const z = dir.zones[0];
  const totalS = dir.zones.reduce((a,b) => a + (b.S||0), 0);
  const avgH = dir.zones.reduce((a,b) => a + (b.H||0)*((b.S||0)), 0) / Math.max(1, totalS);
  try {
    const obtr = (dir.pipeline || []).reduce((acc, p) => {
      const dn = +p.DN || 0; const L = +p.L || 0;
      // Литры: A (м²) · L (м) · 1000
      return acc + Math.PI * Math.pow(dn/2000, 2) * L * 1000;
    }, 0);
    const r = Annex.compute({
      agent: inst.agent,
      sp: totalS, h: avgH || z.H,
      tm: dir.tmin, hm: inst.elevation || 0,
      fs: z.fs, paramp: +z.P,
      cn: z.Cn,
      tp: dir.feedTime,
      fireClass: dir.fireClass,
      moduleCode: inst.moduleCode,
      obtr: +obtr.toFixed(2),
    });
    const relief = Annex.reliefArea({
      mp: r.mp, r1: r.r1, tpd: r.tpd,
      tm: r.inputs.tm, hm: r.inputs.hm, piz: z.Ppr, fs: r.inputs.fs,
    });
    return { ...r, Fc: relief.Fc };
  } catch (e) {
    console.warn('computeDir error:', e);
    return null;
  }
}

/* ------------------- Direction dialog ------------------- */
function openDirDialog(existingId) {
  const inst = currentInst();
  const dlg = $('dlg-dir');
  const existing = existingId ? inst.directions.find(d => d.id === existingId) : null;
  $('dlg-dir-h').textContent = existing ? 'Направление: редактирование' : 'Направление: создание';
  const d = existing || defaultDirection(inst.directions.length + 1);
  $('d-name').value = d.name;
  document.querySelectorAll('input[name="d-type"]').forEach(r => r.checked = (r.value === d.type));
  $('d-tmin').value = d.tmin;
  $('d-feed').value = d.feedTime;
  $('d-smoke').checked = d.smoke;
  $('d-fire').value = d.fire;
  $('d-mount').value = d.mount;
  $('d-exh').value = d.exhaust;
  $('d-exh-d').value = d.exhaustDist;
  $('d-prelief').checked = d.prelief;
  $('d-exec').value = d.exec;
  $('d-class').value = d.fireClass;
  $('d-leak').value = d.leakage;
  dlg.returnValue = ''; dlg.showModal();
  dlg.addEventListener('close', function onC() {
    dlg.removeEventListener('close', onC);
    if (dlg.returnValue !== 'ok') return;
    Object.assign(d, {
      name: $('d-name').value.trim() || d.name,
      type: document.querySelector('input[name="d-type"]:checked').value,
      tmin: +$('d-tmin').value, feedTime: +$('d-feed').value,
      smoke: $('d-smoke').checked, fire: $('d-fire').value,
      mount: $('d-mount').value, exhaust: $('d-exh').value,
      exhaustDist: +$('d-exh-d').value, prelief: $('d-prelief').checked,
      exec: $('d-exec').value, fireClass: $('d-class').value, leakage: $('d-leak').value,
    });
    if (!existing) { inst.directions.push(d); S.selected = { kind:'dir', dirId: d.id }; }
    inst.assemblies = []; // пересобрать автоматически
    saveAll(); renderAll();
  });
}

/* ------------------- Zone dialog ------------------- */
function openZoneDialog(dir, existingId) {
  const dlg = $('dlg-zone');
  const existing = existingId ? dir.zones.find(z => z.id === existingId) : null;
  $('dlg-zone-h').textContent = existing ? 'Зона: редактирование' : 'Зона: создание';
  const z = existing || defaultZone(dir.zones.length + 1);
  $('z-name').value = z.name; $('z-S').value = z.S; $('z-H').value = z.H;
  $('z-Cn').value = z.Cn; $('z-fs').value = z.fs; $('z-P').value = z.P; $('z-Ppr').value = z.Ppr;
  dlg.returnValue = ''; dlg.showModal();
  dlg.addEventListener('close', function onC() {
    dlg.removeEventListener('close', onC);
    if (dlg.returnValue !== 'ok') return;
    Object.assign(z, {
      name: $('z-name').value.trim() || z.name,
      S: +$('z-S').value, H: +$('z-H').value,
      Cn: +$('z-Cn').value, fs: +$('z-fs').value,
      P: +$('z-P').value, Ppr: +$('z-Ppr').value,
    });
    if (!existing) dir.zones.push(z);
    saveAll(); renderAll();
  });
}

/* ------------------- Axonometric ------------------- */
const ISO = { ox: 120, oy: 420, sx: Math.cos(Math.PI/6), sy: Math.sin(Math.PI/6), scale: 30 };

function iso3(p) {
  // p: {x,y,z} in "grid units" → SVG (px)
  const x = ISO.ox + (p.x - p.z) * ISO.sx * ISO.scale;
  const y = ISO.oy + (p.x + p.z) * ISO.sy * ISO.scale - p.y * ISO.scale;
  return { x, y };
}

function buildPipeCoords(pipeline) {
  // Segments have axis (x/y/z + direction) and L (length, m)
  // Build cumulative path from origin (0,0,0)
  let cur = { x: 0, y: 0, z: 0 };
  return pipeline.map(p => {
    const axis = (p.axis || 'x');
    const dir = axis.startsWith('-') ? -1 : 1;
    const axn = axis.replace('-','');
    const d = dir * (+p.L || 0);
    const start = { ...cur };
    cur = { ...cur, [axn]: cur[axn] + d };
    const end = { ...cur };
    return { seg: p, start, end };
  });
}

function renderIso(dirId) {
  const inst = currentInst();
  const pipe = dirId
    ? (inst.directions.find(d => d.id === dirId)?.pipeline || [])
    : inst.directions.flatMap(d => d.pipeline || []);
  const coords = buildPipeCoords(pipe);
  const W = 900, H = 580;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;">`;
  // axes
  const O = iso3({x:0,y:0,z:0});
  svg += `<g stroke-width="1">
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:1.5,y:0,z:0}).x}" y2="${iso3({x:1.5,y:0,z:0}).y}" stroke="#2e7d32"/>
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:0,y:0,z:1.5}).x}" y2="${iso3({x:0,y:0,z:1.5}).y}" stroke="#2e7d32"/>
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:0,y:1.5,z:0}).x}" y2="${iso3({x:0,y:1.5,z:0}).y}" stroke="#c62828"/>
  </g>`;
  // cylinders at origin
  const Cb = iso3({x:0, y:0, z:0});
  svg += `<g fill="#e57373" stroke="#b71c1c" stroke-width="1.5">
    <rect x="${Cb.x-20}" y="${Cb.y-4}" width="14" height="40" rx="4"/>
    <rect x="${Cb.x-2}"  y="${Cb.y-4}" width="14" height="40" rx="4"/>
  </g>`;
  // segments
  let totalVol = 0;
  coords.forEach(({ seg, start, end }, idx) => {
    const A = iso3(start), B = iso3(end);
    const hasNoz = seg.nozzle && seg.nozzle !== 'none';
    const stroke = hasNoz ? '#c62828' : '#d32f2f';
    svg += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${stroke}" stroke-width="1.4"/>`;
    if (S.isoShowNums) {
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 6;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" style="font-size:10px;fill:#333;">${idx+1}</text>`;
    }
    if (hasNoz && S.isoShowNozz) {
      svg += `<circle cx="${B.x}" cy="${B.y}" r="5" fill="none" stroke="#1565c0" stroke-width="1.4"/>
              <circle cx="${B.x}" cy="${B.y}" r="2" fill="#1565c0"/>`;
    }
    // volume: cylinder V = π·(DN/2000)²·L·1000 [L]
    const dn = +seg.DN || 22;
    totalVol += Math.PI * Math.pow(dn/2000, 2) * (+seg.L || 0) * 1000;
  });
  svg += `</svg>`;
  $('iso-canvas').innerHTML = svg;
  $('iso-vtr').innerHTML = `V<sub>тр</sub> = ${(totalVol/1000).toFixed(3)} м³`;

  // seg list
  const list = $('seg-list');
  list.innerHTML = pipe.map((p, i) => `
    <div class="seg-item ${p.id === S.isoSelSeg ? 'sel' : ''}" data-id="${p.id}">
      <span class="seg-no">${i+1}</span>
      <span>${p.axis} · ${p.L} м · DN${p.DN} · ${p.nozzle || '—'}</span>
    </div>`).join('');
  list.onclick = (e) => {
    const it = e.target.closest('.seg-item');
    if (it) { S.isoSelSeg = it.dataset.id; fillSegForm(); renderIso(S.isoDirId); }
  };
}

function fillSegForm() {
  const inst = currentInst();
  const pipe = S.isoDirId
    ? (inst.directions.find(d => d.id === S.isoDirId)?.pipeline || [])
    : inst.directions.flatMap(d => d.pipeline || []);
  const p = pipe.find(x => x.id === S.isoSelSeg);
  if (!p) return;
  $('seg-L').value = p.L; $('seg-DN').value = p.DN;
  $('seg-noz').value = p.nozzle || 'none'; $('seg-ax').value = p.axis || 'x';
}

function openIso(dirId) {
  S.isoDirId = dirId;
  S.isoSelSeg = null;
  renderIso(dirId);
  $('dlg-iso').showModal();
}

/* ------------------- Report ------------------- */
function openReport() {
  const inst = currentInst();
  if (!inst.directions.length) { alert('Нет направлений для расчёта.'); return; }
  const reports = inst.directions.map((d, i) => {
    const r = computeDirForReport(d);
    if (!r) return `Направление "${d.name}": недостаточно данных для расчёта.\n`;
    const piping = buildPipingSummary(d);
    return buildReport({
      installation: inst, direction: d, zone: d.zones[0],
      result: r, piping, calcNo: `${inst.calcNo}·${i+1}`,
    });
  });
  $('rep-body').textContent = reports.join('\n\n' + '═'.repeat(72) + '\n\n');
  $('dlg-report').showModal();
}

function computeDirForReport(dir) {
  const r = computeDir(dir);
  return r;
}

function buildPipingSummary(dir) {
  const pipe = dir.pipeline || [];
  const segments = pipe.map((p, i) => ({
    id: i+1, OD: dnToOD(+p.DN).OD, wall: dnToOD(+p.DN).w,
    DN: p.DN, L: p.L, dH: 0, area: p.nozzle && p.nozzle !== 'none' ? 24 : '',
    P: '', G: '',
  }));
  const totalByDN = {};
  let volL = 0;
  pipe.forEach(p => {
    const OD = dnToOD(+p.DN); const key = `${OD.OD}×${OD.w}`;
    totalByDN[key] = +((totalByDN[key] || 0) + (+p.L||0)).toFixed(1);
    volL += Math.PI * Math.pow((+p.DN)/2000, 2) * (+p.L||0) * 1000;
  });
  const nozzles = {};
  pipe.filter(p => p.nozzle && p.nozzle !== 'none').forEach(p => {
    const k = `Насадок-${p.nozzle}`;
    nozzles[k] = (nozzles[k] || 0) + 1;
  });
  return {
    segments, totalByDN,
    totalVolumeL: +volL.toFixed(2),
    nozzles: Object.entries(nozzles).map(([code, count]) => ({ code, count })),
  };
}

function dnToOD(dn) {
  const map = {
    15: { OD: 22, w: 2.5 }, 20: { OD: 28, w: 3 }, 22: { OD: 22, w: 3.5 },
    25: { OD: 34, w: 3.5 }, 28: { OD: 28, w: 4 }, 32: { OD: 42, w: 3.5 },
    34: { OD: 34, w: 3.5 }, 40: { OD: 48, w: 4 }, 50: { OD: 57, w: 4 },
    65: { OD: 76, w: 5 }, 80: { OD: 89, w: 5 }, 100: { OD: 108, w: 5 },
  };
  return map[dn] || { OD: dn, w: 3 };
}

/* ------------------- Init ------------------- */
function init() {
  S.installations = loadAll();
  initWelcome();

  $('sup-inst-edit').addEventListener('click', () => openInstDialog(S.currentId));
  $('sup-add-dir').addEventListener('click', () => openDirDialog(null));
  $('sup-add-zone').addEventListener('click', () => {
    const dir = currentInst().directions.find(d => d.id === S.selected.dirId);
    if (dir) openZoneDialog(dir);
  });
  $('sup-dir-edit').addEventListener('click', () => openDirDialog(S.selected.dirId));
  $('sup-dir-del').addEventListener('click', () => {
    const inst = currentInst();
    if (!confirm('Удалить направление?')) return;
    inst.directions = inst.directions.filter(d => d.id !== S.selected.dirId);
    inst.assemblies = [];
    S.selected = { kind:'inst', dirId:null };
    saveAll(); renderAll();
  });
  $('sup-iso-all').addEventListener('click', () => openIso(null));
  $('sup-dir-iso').addEventListener('click', () => openIso(S.selected.dirId));
  $('sup-asm-iso').addEventListener('click', () => openIso(null));
  $('sup-asm-auto').addEventListener('click', () => { currentInst().assemblies = []; saveAll(); renderAll(); });
  $('sup-asm-add').addEventListener('click', () => {
    const inst = currentInst();
    inst.assemblies.push({ id: newId('asm-'), main: 1, reserve: 0, twoRow:false, collectorL:0, collectorDN:40, backupNo:'' });
    saveAll(); renderAsmView();
  });
  $('sup-auto-dn').addEventListener('click', () => {
    const inst = currentInst();
    inst.directions.forEach(d => {
      const r = computeDir(d); if (!r) return;
      // Simple rule: main DN from mass flow m˙ = mg/tpd, velocity 35 m/s
      const mdot = r.mg / (r.tpd || 10);
      const rho = 7; const vel = 35;
      const IDmm = Math.sqrt(4 * (mdot / (rho * vel)) / Math.PI) * 1000;
      const DN = [15,20,22,25,28,32,34,40,50,65,80,100].find(x => x >= IDmm) || 100;
      (d.pipeline || []).forEach(p => p.DN = p.DN || DN);
    });
    saveAll(); renderAll();
  });
  $('sup-spec').addEventListener('click', () => {
    // reuse report — на вкладке отображает спецификации
    openReport();
  });
  $('sup-report').addEventListener('click', openReport);
  $('rep-copy').addEventListener('click', () => navigator.clipboard.writeText($('rep-body').textContent));
  $('rep-save').addEventListener('click', () => {
    const blob = new Blob([$('rep-body').textContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `АГПТ_${currentInst().calcNo}.txt`;
    a.click();
  });
  $('rep-print').addEventListener('click', () => window.print());

  // Axonometric
  $('seg-add').addEventListener('click', () => {
    const inst = currentInst();
    const target = S.isoDirId
      ? inst.directions.find(d => d.id === S.isoDirId)
      : inst.directions[0];
    if (!target) { alert('Добавьте направление.'); return; }
    const seg = {
      id: newId('s-'), axis: $('seg-ax').value, L: +$('seg-L').value || 1,
      DN: +$('seg-DN').value, nozzle: $('seg-noz').value,
    };
    target.pipeline.push(seg); S.isoSelSeg = seg.id;
    saveAll(); renderIso(S.isoDirId); fillSegForm();
  });
  $('seg-del').addEventListener('click', () => {
    const inst = currentInst();
    const target = S.isoDirId
      ? inst.directions.find(d => d.id === S.isoDirId)
      : null;
    if (!target || !S.isoSelSeg) return;
    target.pipeline = target.pipeline.filter(p => p.id !== S.isoSelSeg);
    S.isoSelSeg = null;
    saveAll(); renderIso(S.isoDirId);
  });
  ['seg-L','seg-DN','seg-noz','seg-ax'].forEach(id => {
    $(id).addEventListener('change', () => {
      const inst = currentInst();
      const target = S.isoDirId
        ? inst.directions.find(d => d.id === S.isoDirId)
        : inst.directions[0];
      const p = target?.pipeline.find(x => x.id === S.isoSelSeg);
      if (!p) return;
      p.L = +$('seg-L').value; p.DN = +$('seg-DN').value;
      p.nozzle = $('seg-noz').value; p.axis = $('seg-ax').value;
      saveAll(); renderIso(S.isoDirId);
    });
  });
  $('iso-toggle-nums').addEventListener('click', () => { S.isoShowNums = !S.isoShowNums; renderIso(S.isoDirId); });
  $('iso-toggle-nozz').addEventListener('click', () => { S.isoShowNozz = !S.isoShowNozz; renderIso(S.isoDirId); });

  // Start: if no current installation, welcome
  if (!S.currentId || !S.installations[S.currentId]) showWelcome();
  else showWorkspace();
}

document.addEventListener('DOMContentLoaded', init);
