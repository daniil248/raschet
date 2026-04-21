/* =========================================================================
   suppression-config.js — АГПТ: иерархическая модель
   Установка → (Сборка модулей | Направления → Зоны) + Аксонометрия + Отчёт.
   UI в стиле Raschet (карточки + левый навигатор + правая сводка).

   Персистентность: localStorage 'raschet.sup.installations.v1'
   ========================================================================= */

import { AGENTS } from '../suppression-methods/agents.js';
import { MODULE_SERIES, SERIES_LIST, listVariants, findVariant }
  from '../suppression-methods/modules-catalog.js';
import * as Annex from '../suppression-methods/sp-485-annex-d.js';
import { buildReport } from '../suppression-methods/report-text.js';
import { computeHydraulic } from '../suppression-methods/hydraulics.js';

const $ = id => document.getElementById(id);
const LS_KEY = 'raschet.sup.installations.v1';

/* ------------------- State ------------------- */
const S = {
  installations: {},
  currentId: null,
  selected: { kind: 'inst', dirId: null }, // 'inst'|'asm'|'dir'
  isoDirId: null,
  isoSelSeg: null,
  isoShowNums: true,
  isoShowNozz: true,
};

function loadAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveAll() { localStorage.setItem(LS_KEY, JSON.stringify(S.installations)); }
function newId(p = '') { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function currentInst() { return S.installations[S.currentId]; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

/* ------------------- Defaults ------------------- */
function defaultInstallation() {
  const agent = 'HFC-227ea';
  const series = 'МГП-Консул';
  const variants = listVariants(series);
  return {
    id: newId('inst-'), name: 'Установка 1', elevation: 0,
    norm: 'sp-485-annex-d', agent, series, moduleCode: variants[0]?.code || '',
    installType: 'modular',
    site: { name:'', address:'', contract:'', customer:'', info:'' },
    directions: [], assemblies: [], pu: [],
    createdAt: Date.now(), calcNo: '0001-G',
  };
}
function defaultDirection(n = 1) {
  return {
    id: newId('dir-'), name: `Направление ${n}`, type: 'volume',
    tmin: 20, feedTime: 10, smoke: true, fire: 'EI30', mount: 'wall',
    exhaust: 'outside', exhaustDist: 10, prelief: true, exec: 'standard',
    fireClass: 'A2', leakage: 'II', zones: [], pipeline: [],
  };
}
function defaultZone(n = 1) {
  return { id: newId('z-'), name: `зона ${n}`, S:15, H:3, Cn:7.2, fs:0, P:0.4, Ppr:0.003 };
}

/* ------------------- Inst dialog helpers ------------------- */
function fillSelect(sel, items, current) {
  sel.innerHTML = items.map(i =>
    `<option value="${i.value}"${i.value === current ? ' selected' : ''}>${i.label}</option>`).join('');
}
function setupInstFormSelects(v = {}) {
  fillSelect($('f-agent'),
    Object.entries(AGENTS).map(([k,x]) => ({ value:k, label:x.label })), v.agent);
  fillSelect($('f-series'),
    SERIES_LIST.map(s => ({ value:s.id, label:`${s.id} — ${s.manufacturer}` })), v.series);
  const vars = listVariants($('f-series').value);
  fillSelect($('f-module'),
    vars.map(x => ({ value:x.code, label:`${x.code} (${x.ob} л)` })), v.moduleCode);
}

/* ------------------- Installation dialog ------------------- */
function openInstDialog(existingId) {
  const dlg = $('dlg-inst');
  const existing = existingId ? S.installations[existingId] : null;
  $('dlg-inst-h').textContent = existing ? 'Установка: редактирование' : 'Установка: создание';
  setupInstFormSelects(existing || {});
  $('f-series').onchange = () => {
    const vars = listVariants($('f-series').value);
    fillSelect($('f-module'), vars.map(x => ({ value:x.code, label:`${x.code} (${x.ob} л)` })), null);
  };
  $('f-name').value = existing?.name ?? '';
  $('f-elev').value = existing?.elevation ?? 0;
  $('f-norm').value = existing?.norm ?? 'sp-485-annex-d';
  document.querySelectorAll('input[name="f-inst"]').forEach(r =>
    r.checked = (r.value === (existing?.installType || 'modular')));
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
      S.selected = { kind:'inst', dirId:null };
    }
    saveAll(); renderAll();
  }, { once: true });
}

/* ------------------- Open dialog ------------------- */
function openOpenDialog() {
  const list = $('open-list');
  const items = Object.values(S.installations).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
  if (!items.length) {
    list.innerHTML = '<li style="color:#888;list-style:none;">Нет сохранённых установок</li>';
  } else {
    list.innerHTML = items.map(i => `
      <li data-id="${i.id}">
        <span class="name">${esc(i.name)}</span>
        <span class="date">${new Date(i.createdAt).toLocaleDateString('ru-RU')}</span>
        <span class="del" data-del="${i.id}" title="Удалить">✕</span>
      </li>`).join('');
    list.onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        if (confirm('Удалить установку?')) {
          delete S.installations[del.dataset.del]; saveAll(); openOpenDialog();
        }
        return;
      }
      const li = e.target.closest('li[data-id]');
      if (li) {
        S.currentId = li.dataset.id;
        S.selected = { kind:'inst', dirId:null };
        $('dlg-open').close(); renderAll();
      }
    };
  }
  $('dlg-open').showModal();
}

/* ------------------- Navigator ------------------- */
function renderNav() {
  const inst = currentInst(); if (!inst) return;
  const nav = $('sup-nav');
  const active = k => S.selected.kind === k ? 'active' : '';
  nav.innerHTML = `
    <li data-kind="inst" class="${active('inst')}">Установка (обзор)</li>
    <li data-kind="asm"  class="${active('asm')}">Сборка модулей</li>
  `;
  nav.onclick = (e) => {
    const li = e.target.closest('li[data-kind]');
    if (!li) return;
    S.selected = { kind: li.dataset.kind, dirId: null };
    renderAll();
  };

  const dirs = $('sup-nav-dirs');
  const actD = id => (S.selected.kind === 'dir' && S.selected.dirId === id) ? 'active' : '';
  dirs.innerHTML = inst.directions.map(d => `
    <li class="${actD(d.id)}" data-id="${d.id}">
      ${esc(d.name)}
      <button class="sup-ibtn sup-danger" data-del="${d.id}" title="Удалить">✕</button>
    </li>`).join('') + `<li class="sup-add" data-add="1">+ Добавить направление</li>`;
  dirs.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm('Удалить направление?')) return;
      inst.directions = inst.directions.filter(d => d.id !== del.dataset.del);
      inst.assemblies = [];
      if (S.selected.dirId === del.dataset.del) S.selected = { kind:'inst', dirId:null };
      saveAll(); renderAll(); return;
    }
    if (e.target.closest('[data-add]')) { openDirDialog(null); return; }
    const li = e.target.closest('li[data-id]');
    if (li) { S.selected = { kind:'dir', dirId: li.dataset.id }; renderAll(); }
  };

  // Zones block visible only when direction selected
  const zSec = $('sup-zones-section');
  if (S.selected.kind === 'dir') {
    const dir = inst.directions.find(d => d.id === S.selected.dirId);
    if (dir) {
      zSec.hidden = false;
      const ul = $('sup-nav-zones');
      ul.innerHTML = dir.zones.map(z => `
        <li data-id="${z.id}">
          ${esc(z.name)} <span style="color:#888;font-size:11px;">(${z.S}×${z.H})</span>
          <button class="sup-ibtn sup-danger" data-del="${z.id}" title="Удалить">✕</button>
        </li>`).join('') + `<li class="sup-add" data-add="1">+ Добавить зону</li>`;
      ul.onclick = (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
          e.stopPropagation();
          dir.zones = dir.zones.filter(z => z.id !== del.dataset.del);
          saveAll(); renderAll(); return;
        }
        if (e.target.closest('[data-add]')) { openZoneDialog(dir, null); return; }
        const li = e.target.closest('li[data-id]');
        if (li) openZoneDialog(dir, li.dataset.id);
      };
    } else zSec.hidden = true;
  } else zSec.hidden = true;
}

/* ------------------- Views ------------------- */
function renderAll() {
  const inst = currentInst();
  if (!inst) {
    $('sup-inst-name').textContent = '— не выбрано —';
    $('sup-inst-meta').textContent = 'Создайте установку, чтобы начать.';
    $('inst-title').textContent = '—';
    ['view-inst','view-asm','view-dir'].forEach(id => $(id).hidden = true);
    return;
  }
  $('sup-inst-name').textContent = inst.name;
  $('sup-inst-meta').textContent = `${inst.agent} · ${inst.moduleCode || '—'} · расчёт ${inst.calcNo}`;

  renderNav();
  renderRight();
  const k = S.selected.kind;
  show('view-inst', k === 'inst');
  show('view-asm',  k === 'asm');
  show('view-dir',  k === 'dir');
  if (k === 'inst') renderInstView();
  if (k === 'asm')  renderAsmView();
  if (k === 'dir')  renderDirView();
  renderWarnings();
}
function show(id, on) { $(id).hidden = !on; }

function cardHtml(label, value, cls='') {
  return `<div class="card ${cls}"><span class="label">${esc(label)}</span><span class="value">${value}</span></div>`;
}

function renderInstView() {
  const inst = currentInst();
  $('inst-title').textContent = `${inst.name} · ${inst.site.name || ''}`.trim();
  let ntotal = 0, mtotal = 0;
  inst.directions.forEach(d => { const r = computeDir(d); if (r) { ntotal += r.n; mtotal += r.mg; } });
  const cards = [
    cardHtml('Норматив', inst.norm),
    cardHtml('ГОТВ', AGENTS[inst.agent]?.label || inst.agent),
    cardHtml('Модуль', inst.moduleCode || '—'),
    cardHtml('Направлений', inst.directions.length),
    cardHtml('Модулей ∑', ntotal),
    cardHtml('Масса ГОТВ ∑, кг', mtotal.toFixed(1)),
  ];
  $('inst-cards').innerHTML = cards.join('');

  const tb = document.querySelector('#dir-tbl tbody');
  tb.innerHTML = inst.directions.map(d => {
    const r = computeDir(d) || {};
    const nz = (d.pipeline || []).filter(p => p.nozzle && p.nozzle !== 'none').length;
    return `<tr data-id="${d.id}" data-clickable>
      <td>${esc(d.name)}</td>
      <td class="num">${r.mg ?? '—'}</td>
      <td class="num">${r.n ?? '—'}</td>
      <td class="num">${r.tpd ?? '—'}</td>
      <td class="num">${nz}</td>
      <td class="num">${r.Fc ?? '—'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="color:#888;text-align:center;">Нет направлений</td></tr>`;
  tb.onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) { S.selected = { kind:'dir', dirId: tr.dataset.id }; renderAll(); }
  };
}

function renderAsmView() {
  const inst = currentInst();
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
  const tb = document.querySelector('#asm-tbl tbody');
  tb.innerHTML = inst.assemblies.map((a, i) => {
    const dirName = inst.directions.find(d => d.id === a.dirId)?.name || '—';
    return `<tr data-id="${a.id}">
      <td>${i+1}</td>
      <td>${esc(dirName)}</td>
      <td class="num"><input type="number" data-f="main" value="${a.main}" min="0" style="width:60px;"></td>
      <td class="num"><input type="number" data-f="reserve" value="${a.reserve}" min="0" style="width:60px;"></td>
      <td><input type="checkbox" data-f="twoRow" ${a.twoRow?'checked':''}></td>
      <td class="num"><input type="number" data-f="collectorL" value="${a.collectorL}" step="0.1" style="width:70px;"></td>
      <td class="num"><input type="number" data-f="collectorDN" value="${a.collectorDN}" min="15" style="width:60px;"></td>
      <td><input type="text" data-f="backupNo" value="${a.backupNo||''}" style="width:40px;"></td>
      <td><button class="sup-ibtn sup-danger" data-del="${a.id}">✕</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="color:#888;text-align:center;">Нет батарей</td></tr>`;
  tb.onchange = (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = inst.assemblies.find(x => x.id === tr.dataset.id); if (!a) return;
    const f = e.target.dataset.f; if (!f) return;
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
  const pu = document.querySelector('#pu-tbl tbody');
  pu.innerHTML = inst.directions.map(d => {
    const r = computeDir(d);
    const nCalc = r?.n || 0;
    const asm = inst.assemblies.filter(a => a.dirId === d.id);
    const nFact = asm.reduce((a, x) => a + (+x.main || 0), 0);
    const cls = nFact < nCalc ? 'style="color:#c62828;font-weight:600;"' : '';
    return `<tr><td>${esc(d.name)}</td><td class="num">${nCalc}</td><td class="num" ${cls}>${nFact}</td></tr>`;
  }).join('') || `<tr><td colspan="3" style="color:#888;text-align:center;">—</td></tr>`;
}

function renderDirView() {
  const inst = currentInst();
  const dir = inst.directions.find(d => d.id === S.selected.dirId);
  if (!dir) { S.selected = { kind:'inst', dirId:null }; return renderAll(); }
  $('dir-title').textContent = dir.name;

  const totalS = dir.zones.reduce((a,z) => a + (z.S||0), 0);
  const totalV = dir.zones.reduce((a,z) => a + (z.S||0)*(z.H||0), 0);
  $('dir-cards').innerHTML = [
    cardHtml('Тип', dir.type === 'volume' ? 'Объёмное' : 'Локальное'),
    cardHtml('Tмин, °C', dir.tmin),
    cardHtml('t подачи, с', dir.feedTime),
    cardHtml('Класс пожара', dir.fireClass),
    cardHtml('Зон', dir.zones.length),
    cardHtml('ΣS, м²', totalS.toFixed(1)),
    cardHtml('ΣV, м³', totalV.toFixed(1)),
    cardHtml('Герметичность', dir.leakage),
  ].join('');

  const grid = $('zones-grid');
  grid.innerHTML = dir.zones.map(z => `
    <div class="sup-zone" data-id="${z.id}">
      <span class="zdel" data-del="${z.id}">✕</span>
      <span class="zt">${esc(z.name)}</span>
      <span class="zx">S = ${z.S} м² × H = ${z.H} м (V = ${(z.S*z.H).toFixed(1)} м³)</span>
      <span class="zx">Cн = ${z.Cn}%, fs = ${z.fs} м², П = ${z.P}</span>
    </div>`).join('') || `<div style="color:#888;">Нет зон. Добавьте зону.</div>`;
  grid.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      dir.zones = dir.zones.filter(z => z.id !== del.dataset.del);
      saveAll(); renderAll(); return;
    }
    const c = e.target.closest('.sup-zone');
    if (c) openZoneDialog(dir, c.dataset.id);
  };

  const r = computeDir(dir);
  const nozz = (dir.pipeline || []).filter(p => p.nozzle && p.nozzle !== 'none').length;
  const pipeL = (dir.pipeline || []).reduce((a,p) => a + (+p.L || 0), 0);
  $('dir-sum').innerHTML = r ? [
    cardHtml('Mp (расчётная), кг', r.mp),
    cardHtml('Mг (заправка), кг', r.mg),
    cardHtml('Модулей N', r.n),
    cardHtml('Остаток m₁, кг', r.m1),
    cardHtml('Mтр, кг', r.mtr),
    cardHtml('tпд, с', r.tpd),
    cardHtml('r₁ / r₂', `${r.r1} / ${r.r2}`),
    cardHtml('Fc, м²', r.Fc, r.Fc > 0.1 ? 'warn' : ''),
    cardHtml('Насадков', nozz),
    cardHtml('L трубопровода, м', pipeL.toFixed(1)),
  ].join('') : `<div style="color:#888;grid-column:1/-1;">Недостаточно данных для расчёта (нет зон).</div>`;
}

function renderRight() {
  const inst = currentInst(); if (!inst) return;
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

function renderWarnings() {
  const inst = currentInst();
  const ul = $('sup-warn'); const items = [];
  if (!inst.directions.length) items.push({ t:'Нет направлений. Добавьте хотя бы одно.', cls:'' });
  inst.directions.forEach(d => {
    if (!d.zones.length) items.push({ t:`«${d.name}»: нет зон.`, cls:'' });
    d.zones.forEach(z => {
      const paramMax = 0.022;
      const param = z.fs > 0 ? (z.fs / (z.S * z.H)) : 0;
      if (param > paramMax)
        items.push({ t:`«${d.name}» / «${z.name}»: параметр негерметичности (${param.toFixed(4)} м⁻¹) > ${paramMax}.`, cls:'err' });
    });
    // N_fact < N_calc
    const r = computeDir(d);
    if (r) {
      const asm = inst.assemblies.filter(a => a.dirId === d.id);
      const nFact = asm.reduce((a, x) => a + (+x.main || 0), 0);
      if (nFact && nFact < r.n)
        items.push({ t:`«${d.name}»: модулей по сборке ${nFact}, требуется ${r.n}.`, cls:'err' });
    }
    // pipeline sanity: only warn if explicitly emptied
    if ((d.pipeline || []).length &&
        !d.pipeline.some(p => p.nozzle && p.nozzle !== 'none'))
      items.push({ t:`«${d.name}»: в трубопроводе нет насадков.`, cls:'' });
  });
  if (!items.length) items.push({ t:'Без замечаний', cls:'ok' });
  ul.innerHTML = items.map(x => `<li class="${x.cls}">${esc(x.t)}</li>`).join('');
}

/* ------------------- Computation ------------------- */
/** Per-zone compute + aggregate over direction. */
function computeDir(dir) {
  const inst = currentInst();
  if (!inst || !dir.zones.length) return null;
  try {
    const obtrTotal = (dir.pipeline || []).reduce((acc, p) => {
      const dn = +p.DN || 0, L = +p.L || 0;
      return acc + Math.PI * Math.pow(dn/2000, 2) * L * 1000;
    }, 0);
    // split pipe volume proportional to zone volume
    const totalV = dir.zones.reduce((a,z) => a + (z.S||0)*(z.H||0), 0) || 1;
    const zoneResults = dir.zones.map(z => {
      const V = (z.S||0) * (z.H||0);
      const obtrZ = obtrTotal * V / totalV;
      const r = Annex.compute({
        agent: inst.agent, sp: z.S, h: z.H,
        tm: dir.tmin, hm: inst.elevation || 0,
        fs: z.fs, paramp: +z.P, cn: z.Cn, tp: dir.feedTime,
        fireClass: dir.fireClass, moduleCode: inst.moduleCode,
        obtr: +obtrZ.toFixed(2),
      });
      const rel = Annex.reliefArea({
        mp: r.mp, r1: r.r1, tpd: r.tpd,
        tm: r.inputs.tm, hm: r.inputs.hm, piz: z.Ppr, fs: r.inputs.fs,
      });
      return { zone: z, r, Fc: rel.Fc };
    });
    // aggregate: summable quantities are summed; representative params taken from max-mp zone
    const sum = (k) => zoneResults.reduce((a, x) => a + (+x.r[k] || 0), 0);
    const maxMp = zoneResults.reduce((a,b) => (b.r.mp > a.r.mp ? b : a), zoneResults[0]);
    const mp  = +sum('mp').toFixed(1);
    const mtr = +sum('mtr').toFixed(3);
    const n   = zoneResults.reduce((a,x) => a + x.r.n, 0);
    const mg  = +sum('mg').toFixed(1);
    const m1  = +(mg - mp - mtr).toFixed(2);
    const Fc  = +zoneResults.reduce((a,x) => Math.max(a, x.Fc), 0).toFixed(4);
    const tpd = maxMp.r.tpd;
    const r1  = maxMp.r.r1, r2 = maxMp.r.r2, ob = maxMp.r.ob, mb = maxMp.r.mb;
    const kz_max = maxMp.r.kz_max, Mmin = mp;
    return {
      ...maxMp.r, // for any consumers needing scalar fallbacks
      mp, mg, n, m1, mtr, Fc, tpd, r1, r2, ob, mb, kz_max, Mmin,
      zoneResults,
    };
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
  $('d-tmin').value = d.tmin; $('d-feed').value = d.feedTime;
  $('d-smoke').checked = d.smoke; $('d-fire').value = d.fire;
  $('d-mount').value = d.mount; $('d-exh').value = d.exhaust;
  $('d-exh-d').value = d.exhaustDist; $('d-prelief').checked = d.prelief;
  $('d-exec').value = d.exec; $('d-class').value = d.fireClass; $('d-leak').value = d.leakage;
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
    if (!existing) {
      inst.directions.push(d);
      if (!d.pipeline.length) d.pipeline = defaultPipelineSkeleton(d);
      S.selected = { kind:'dir', dirId: d.id };
    }
    inst.assemblies = [];
    saveAll(); renderAll();
  }, { once: true });
}

/** Типовой скелет трубопровода: коллектор + отвод на насадок по умолчанию. */
function defaultPipelineSkeleton(dir) {
  return [
    { id: newId('s-'), axis: 'x', L: 2.0, DN: 40, nozzle: 'none' },   // магистраль
    { id: newId('s-'), axis: 'y', L: 2.5, DN: 25, nozzle: 'none' },   // стояк
    { id: newId('s-'), axis: 'z', L: 1.5, DN: 20, nozzle: 'R-360' },  // насадок
  ];
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
  }, { once: true });
}

/* ------------------- Axonometric ------------------- */
const ISO = { ox: 120, oy: 420, sx: Math.cos(Math.PI/6), sy: Math.sin(Math.PI/6), scale: 30 };
function iso3(p) {
  const x = ISO.ox + (p.x - p.z) * ISO.sx * ISO.scale;
  const y = ISO.oy + (p.x + p.z) * ISO.sy * ISO.scale - p.y * ISO.scale;
  return { x, y };
}
function buildPipeCoords(pipeline) {
  let cur = { x:0, y:0, z:0 };
  return pipeline.map(p => {
    const axis = (p.axis || 'x');
    const dir = axis.startsWith('-') ? -1 : 1;
    const axn = axis.replace('-','');
    const d = dir * (+p.L || 0);
    const start = { ...cur };
    cur = { ...cur, [axn]: cur[axn] + d };
    return { seg: p, start, end: { ...cur } };
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
  const O = iso3({x:0,y:0,z:0});
  svg += `<g stroke-width="1">
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:1.5,y:0,z:0}).x}" y2="${iso3({x:1.5,y:0,z:0}).y}" stroke="#2e7d32"/>
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:0,y:0,z:1.5}).x}" y2="${iso3({x:0,y:0,z:1.5}).y}" stroke="#2e7d32"/>
    <line x1="${O.x}" y1="${O.y}" x2="${iso3({x:0,y:1.5,z:0}).x}" y2="${iso3({x:0,y:1.5,z:0}).y}" stroke="#c62828"/>
  </g>`;
  const Cb = iso3({x:0,y:0,z:0});
  svg += `<g fill="#e57373" stroke="#b71c1c" stroke-width="1.5">
    <rect x="${Cb.x-20}" y="${Cb.y-4}" width="14" height="40" rx="4"/>
    <rect x="${Cb.x-2}"  y="${Cb.y-4}" width="14" height="40" rx="4"/>
  </g>`;
  let totalVol = 0;
  coords.forEach(({ seg, start, end }, idx) => {
    const A = iso3(start), B = iso3(end);
    const hasNoz = seg.nozzle && seg.nozzle !== 'none';
    const stroke = hasNoz ? '#c62828' : '#d32f2f';
    svg += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${stroke}" stroke-width="1.4"/>`;
    if (S.isoShowNums) {
      const mx = (A.x+B.x)/2, my = (A.y+B.y)/2 - 6;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" style="font-size:10px;fill:#333;">${idx+1}</text>`;
    }
    if (hasNoz && S.isoShowNozz) {
      svg += `<circle cx="${B.x}" cy="${B.y}" r="5" fill="none" stroke="#1565c0" stroke-width="1.4"/>
              <circle cx="${B.x}" cy="${B.y}" r="2" fill="#1565c0"/>`;
    }
    const dn = +seg.DN || 22;
    totalVol += Math.PI * Math.pow(dn/2000, 2) * (+seg.L || 0) * 1000;
  });
  svg += `</svg>`;
  $('iso-canvas').innerHTML = svg;
  $('iso-vtr').innerHTML = `V<sub>тр</sub> = ${(totalVol/1000).toFixed(3)} м³`;

  const list = $('seg-list');
  list.innerHTML = pipe.map((p, i) => `
    <div class="seg-item ${p.id === S.isoSelSeg ? 'sel' : ''}" data-id="${p.id}">
      <span class="seg-no">${i+1}</span>
      <span>${p.axis} · ${p.L} м · DN${p.DN} · ${p.nozzle || '—'}</span>
    </div>`).join('') || `<div style="color:#888;padding:8px;">Нет участков. Добавьте.</div>`;
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
  S.isoDirId = dirId; S.isoSelSeg = null;
  renderIso(dirId); $('dlg-iso').showModal();
}

/* ------------------- Hydraulics ------------------- */
function openHydraulic() {
  const inst = currentInst();
  if (!inst.directions.length) { alert('Нет направлений.'); return; }
  const parts = inst.directions.map(d => {
    const r = computeDir(d);
    if (!r) return `<h3 style="color:#0d47a1;">${esc(d.name)}</h3><div style="color:#888;">Нет данных.</div>`;
    const h = computeHydraulic({
      pipeline: d.pipeline || [],
      agent: inst.agent, moduleCode: inst.moduleCode,
      mg: r.mg, tp: r.tpd, r2: r.r2,
    });
    const rows = h.segments.map(s => `<tr>
      <td>${s.idx}</td><td>DN${s.DN}</td><td class="num">${s.L}</td>
      <td class="num">${s.mdot}</td><td class="num">${s.v}</td>
      <td class="num">${s.Re}</td><td class="num">${s.lambda}</td>
      <td class="num">${s.dPlin}</td><td class="num">${s.dPloc}</td>
      <td class="num">${s.dP}</td><td>${s.nozzle}</td></tr>`).join('') ||
      `<tr><td colspan="11" style="color:#888;text-align:center;">Нет участков трубопровода</td></tr>`;
    return `
      <h3 style="color:#0d47a1;margin:8px 0 4px;">${esc(d.name)}</h3>
      <div class="sup-cards">
        ${cardHtml('ΣΔP, бар', h.dPtotalBar)}
        ${cardHtml('v_max, м/с', h.vMax)}
        ${cardHtml('Re_min', h.reMin)}
        ${cardHtml('P_вх, бар', h.P_in_bar)}
        ${cardHtml('P_вых, бар', h.P_out_bar, h.ok ? '' : 'err')}
        ${cardHtml('P_min, бар', h.P_min_required_bar.toFixed(1))}
      </div>
      <table class="sup-tbl">
        <thead><tr>
          <th>№</th><th>DN</th><th class="num">L, м</th>
          <th class="num">ṁ, кг/с</th><th class="num">v, м/с</th>
          <th class="num">Re</th><th class="num">λ</th>
          <th class="num">ΔP_лин, Па</th><th class="num">ΔP_лок, Па</th>
          <th class="num">ΔP, Па</th><th>Насадок</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>
      <ul class="sup-warn" style="margin-top:6px;">
        ${h.steps.map(s => `<li class="${s.startsWith('✓')?'ok':s.startsWith('✗')?'err':''}" style="color:#333;">${esc(s)}</li>`).join('')}
      </ul>`;
  });
  $('hydr-body').innerHTML = parts.join('<hr style="margin:12px 0;border:none;border-top:1px dashed #ccc;">');
  $('dlg-hydr').showModal();
}

/* ------------------- Report ------------------- */
function openReport() {
  const inst = currentInst();
  if (!inst.directions.length) { alert('Нет направлений для расчёта.'); return; }
  const reports = inst.directions.map((d, i) => {
    const r = computeDir(d);
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
function buildPipingSummary(dir) {
  const pipe = dir.pipeline || [];
  const segments = pipe.map((p, i) => ({
    id: i+1, OD: dnToOD(+p.DN).OD, wall: dnToOD(+p.DN).w,
    DN: p.DN, L: p.L, dH: 0,
    area: p.nozzle && p.nozzle !== 'none' ? 24 : '', P:'', G:'',
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
    15:{OD:22,w:2.5}, 20:{OD:28,w:3}, 22:{OD:22,w:3.5}, 25:{OD:34,w:3.5},
    28:{OD:28,w:4}, 32:{OD:42,w:3.5}, 34:{OD:34,w:3.5}, 40:{OD:48,w:4},
    50:{OD:57,w:4}, 65:{OD:76,w:5}, 80:{OD:89,w:5}, 100:{OD:108,w:5},
  };
  return map[dn] || { OD: dn, w: 3 };
}

/* ------------------- Init ------------------- */
function init() {
  S.installations = loadAll();

  // Header actions
  $('sup-inst-edit').addEventListener('click', () => {
    if (S.currentId) openInstDialog(S.currentId); else openInstDialog(null);
  });
  $('sup-inst-open').addEventListener('click', openOpenDialog);
  $('sup-inst-new').addEventListener('click', () => openInstDialog(null));
  $('open-new').addEventListener('click', () => { $('dlg-open').close(); openInstDialog(null); });

  // Inst view actions
  $('sup-add-dir').addEventListener('click', () => openDirDialog(null));
  $('sup-iso-all').addEventListener('click', () => openIso(null));
  $('sup-auto-dn').addEventListener('click', () => {
    const inst = currentInst();
    inst.directions.forEach(d => {
      const r = computeDir(d); if (!r) return;
      const mdot = r.mg / (r.tpd || 10);
      const rho = 7, vel = 35;
      const IDmm = Math.sqrt(4 * (mdot / (rho * vel)) / Math.PI) * 1000;
      const DN = [15,20,22,25,28,32,34,40,50,65,80,100].find(x => x >= IDmm) || 100;
      (d.pipeline || []).forEach(p => p.DN = p.DN || DN);
    });
    saveAll(); renderAll();
  });
  $('sup-hydraulic').addEventListener('click', openHydraulic);
  $('sup-report').addEventListener('click', openReport);

  // Asm actions
  $('asm-auto').addEventListener('click', () => { currentInst().assemblies = []; saveAll(); renderAll(); });
  $('asm-add').addEventListener('click', () => {
    const inst = currentInst();
    inst.assemblies.push({
      id: newId('asm-'), main:1, reserve:0, twoRow:false,
      collectorL:0, collectorDN:40, backupNo:'',
      dirId: inst.directions[0]?.id || null,
    });
    saveAll(); renderAsmView();
  });
  $('asm-iso').addEventListener('click', () => openIso(null));

  // Dir actions
  $('dir-edit').addEventListener('click', () => openDirDialog(S.selected.dirId));
  $('dir-del').addEventListener('click', () => {
    const inst = currentInst();
    if (!confirm('Удалить направление?')) return;
    inst.directions = inst.directions.filter(d => d.id !== S.selected.dirId);
    inst.assemblies = [];
    S.selected = { kind:'inst', dirId:null };
    saveAll(); renderAll();
  });
  $('dir-add-zone').addEventListener('click', () => {
    const dir = currentInst().directions.find(d => d.id === S.selected.dirId);
    if (dir) openZoneDialog(dir, null);
  });
  $('dir-iso').addEventListener('click', () => openIso(S.selected.dirId));

  // Left zone add
  $('sup-add-zone').addEventListener('click', () => {
    const dir = currentInst().directions.find(d => d.id === S.selected.dirId);
    if (dir) openZoneDialog(dir, null);
  });

  // Report toolbar
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

  // Choose current installation or prompt create
  const ids = Object.keys(S.installations);
  if (ids.length) {
    S.currentId = ids.sort((a,b) => (S.installations[b].createdAt||0)-(S.installations[a].createdAt||0))[0];
    renderAll();
  } else {
    renderAll();
    openInstDialog(null);
  }
}

document.addEventListener('DOMContentLoaded', init);
