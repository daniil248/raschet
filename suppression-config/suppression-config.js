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
import { computeHydraulic, recommendDN } from '../suppression-methods/hydraulics.js';
import { mountHelp } from '../shared/help-panel.js';
import { mountFooter } from '../shared/module-footer.js';
import { APP_VERSION } from '../js/engine/constants.js';
import { MODULE_CHANGELOG } from './changelog.js';

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
  const series = 'halocarbon-42bar';
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
    SERIES_LIST.map(s => ({ value:s.id, label:s.label })), v.series);
  const vars = listVariants($('f-series').value);
  fillSelect($('f-module'),
    vars.map(x => ({ value:x.code, label:`${x.ob} л · DN${x.DN} · ${x.pressure_bar} бар` })),
    v.moduleCode);
}

/* ------------------- Installation dialog ------------------- */
function openInstDialog(existingId) {
  const dlg = $('dlg-inst');
  const existing = existingId ? S.installations[existingId] : null;
  $('dlg-inst-h').textContent = existing ? 'Установка: редактирование' : 'Установка: создание';
  setupInstFormSelects(existing || {});
  $('f-series').onchange = () => {
    const vars = listVariants($('f-series').value);
    fillSelect($('f-module'),
      vars.map(x => ({ value:x.code, label:`${x.ob} л · DN${x.DN} · ${x.pressure_bar} бар` })), null);
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

  // Авто-пересчёт DN по всем направлениям (при любой перерисовке — изменения
  // зон / агента / модуля автоматически меняют расход и диаметры).
  (inst.directions || []).forEach(d => autoDnForDirection(d));

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
    // Fitting-distance: min straight run 10·DN до/после фитингов.
    collectFittingWarnings(d).forEach(w => items.push({ t:`«${d.name}»: ${w}`, cls:'warn' }));
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

/* ------------------- 3D scheme ------------------- */
// Rotation state
const V3 = {
  yaw: Math.PI/6, pitch: Math.PI/7, zoom: 1, panX: 0, panY: 0,
  showNums: true, showNozz: true, showNodes: true,
  selectedNode: 'root',  // 'root' or segment.id (endpoint of that segment)
  scale: 60,             // px per metre at zoom=1
};
const VIEW_PRESETS = {
  iso:   { yaw:  Math.PI/6, pitch: Math.PI/7 },
  top:   { yaw:  0,         pitch: Math.PI/2 - 0.001 },
  front: { yaw:  0,         pitch: 0 },
  side:  { yaw:  Math.PI/2, pitch: 0 },
};

/** Компоненты оси из строки 'x'|'-x'|'y'... */
function axisVec(a) {
  const sgn = a.startsWith('-') ? -1 : 1;
  const n = a.replace('-','');
  return { x: n==='x'?sgn:0, y: n==='y'?sgn:0, z: n==='z'?sgn:0 };
}

/** Поворот точки (x,y,z): сначала yaw вокруг Y, потом pitch вокруг X. */
function rot3(p) {
  const cy = Math.cos(V3.yaw), sy = Math.sin(V3.yaw);
  const cp = Math.cos(V3.pitch), sp = Math.sin(V3.pitch);
  // yaw around Y
  const x1 =  p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const y1 =  p.y;
  // pitch around X
  const y2 =  y1 * cp - z1 * sp;
  const z2 =  y1 * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
}

/** 3D точка (в метрах) → SVG пиксели. */
function proj(p, W, H) {
  const r = rot3(p);
  const s = V3.scale * V3.zoom;
  return {
    x: W/2 + r.x * s + V3.panX,
    y: H/2 - r.y * s + V3.panY,
    depth: r.z,
  };
}

/** Построить карту узлов (nodeId → {x,y,z}) из pipeline. */
function buildNodes(pipeline) {
  const nodes = new Map();
  nodes.set('root', { x:0, y:0, z:0 });
  pipeline.forEach(seg => {
    const start = nodes.get(seg.parent || 'root') || { x:0, y:0, z:0 };
    const v = axisVec(seg.axis || 'x');
    const L = +seg.L || 0;
    nodes.set(seg.id, { x: start.x + v.x*L, y: start.y + v.y*L, z: start.z + v.z*L });
  });
  return nodes;
}

function renderIso(dirId) {
  const inst = currentInst();
  const pipe = dirId
    ? (inst.directions.find(d => d.id === dirId)?.pipeline || [])
    : inst.directions.flatMap(d => d.pipeline || []);
  // Ensure `parent` exists (back-compat: linear chain)
  for (let i = 0; i < pipe.length; i++) {
    if (pipe[i].parent === undefined) pipe[i].parent = i === 0 ? 'root' : pipe[i-1].id;
  }
  const nodes = buildNodes(pipe);
  const W = 900, H = 580;
  const P = p => proj(p, W, H);

  // Auto-fit on first render when zoom is default
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;cursor:grab;">`;

  // Axes from origin (length 1 m each)
  const O = P({x:0,y:0,z:0});
  const ax = P({x:1,y:0,z:0}), ay = P({x:0,y:1,z:0}), az = P({x:0,y:0,z:1});
  svg += `<g stroke-width="1.5">
    <line x1="${O.x}" y1="${O.y}" x2="${ax.x}" y2="${ax.y}" stroke="#2e7d32"/>
    <line x1="${O.x}" y1="${O.y}" x2="${ay.x}" y2="${ay.y}" stroke="#c62828"/>
    <line x1="${O.x}" y1="${O.y}" x2="${az.x}" y2="${az.y}" stroke="#1565c0"/>
    <text x="${ax.x+6}" y="${ax.y+6}" font-size="20" font-weight="700" fill="#2e7d32" paint-order="stroke" stroke="#fff" stroke-width="3">X</text>
    <text x="${ay.x+6}" y="${ay.y-4}" font-size="20" font-weight="700" fill="#c62828" paint-order="stroke" stroke="#fff" stroke-width="3">Y</text>
    <text x="${az.x+6}" y="${az.y+6}" font-size="20" font-weight="700" fill="#1565c0" paint-order="stroke" stroke="#fff" stroke-width="3">Z</text>
  </g>`;

  // Cylinders at root: если у направления есть сборки — рисуем манифольд
  // (N баллонов в ряд + горизонтальная подводящая труба). Иначе одиночный.
  {
    let nCyl = 1;
    if (dirId && inst.assemblies) {
      const asm = inst.assemblies.filter(a => a.dirId === dirId);
      nCyl = Math.max(1, asm.reduce((a, x) => a + (+x.main || 0) + (+x.reserve || 0), 0));
    }
    const shown = Math.min(nCyl, 8);
    const w = 12, gap = 6, h = 38;
    const total = shown * w + (shown - 1) * gap;
    const x0 = O.x - total - 12;  // manifold слева от коллектора
    svg += `<g fill="#e57373" stroke="#b71c1c" stroke-width="1.4">`;
    for (let i = 0; i < shown; i++) {
      const xi = x0 + i * (w + gap);
      svg += `<rect x="${xi}" y="${O.y - h + 2}" width="${w}" height="${h}" rx="3"/>`;
      // патрубок от баллона к манифольду
      svg += `<line x1="${xi + w/2}" y1="${O.y - h + 2}" x2="${xi + w/2}" y2="${O.y - h - 4}" stroke="#b71c1c" stroke-width="1.4"/>`;
    }
    svg += `</g>`;
    if (shown > 1) {
      // манифольд (горизонтальная труба) + отвод к коллектору
      svg += `<line x1="${x0 + w/2}" y1="${O.y - h - 4}" x2="${x0 + total - w/2}" y2="${O.y - h - 4}" stroke="#455a64" stroke-width="3"/>`;
      svg += `<line x1="${x0 + total - w/2}" y1="${O.y - h - 4}" x2="${O.x}" y2="${O.y - h - 4}" stroke="#455a64" stroke-width="3"/>`;
      svg += `<line x1="${O.x}" y1="${O.y - h - 4}" x2="${O.x}" y2="${O.y}" stroke="#455a64" stroke-width="3"/>`;
    }
    if (nCyl > shown) {
      svg += `<text x="${x0 - 6}" y="${O.y - h/2 + 4}" text-anchor="end" font-size="10" fill="#b71c1c" font-weight="600">×${nCyl}</text>`;
    }
  }

  // Опоры трубопровода (жёсткие/скользящие) — автоматический расчёт.
  const supports = computeSupports(pipe, nodes);

  // Segments
  let totalVol = 0;
  const segsRender = pipe.map(seg => {
    const a = nodes.get(seg.parent || 'root'), b = nodes.get(seg.id);
    const A = P(a), B = P(b);
    const dn = +seg.DN || 22;
    totalVol += Math.PI * Math.pow(dn/2000, 2) * (+seg.L || 0) * 1000;
    return { seg, a, b, A, B, depth: (A.depth+B.depth)/2 };
  }).sort((a,b) => a.depth - b.depth);  // painter's algorithm

  segsRender.forEach(({ seg, A, B }, idx) => {
    const hasNoz = seg.nozzle && seg.nozzle !== 'none';
    const sel = seg.id === V3.selectedNode;
    const stroke = sel ? '#1565c0' : (hasNoz ? '#c62828' : '#d32f2f');
    const sw = sel ? 3 : 2;
    // Широкий прозрачный хит-слой + видимая линия
    svg += `<line class="iso-seg-hit" data-seg="${seg.id}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="transparent" stroke-width="12" style="cursor:pointer;"/>`;
    svg += `<line class="iso-seg" data-seg="${seg.id}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${stroke}" stroke-width="${sw}" pointer-events="none"/>`;
    if (V3.showNums) {
      const mx = (A.x+B.x)/2, my = (A.y+B.y)/2 - 6;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="#333" pointer-events="none">${idx+1}</text>`;
    }
    if (hasNoz && V3.showNozz) {
      // Размер насадка: подпись рядом с символом
      const nozDN = nozzleSize(+seg.DN, seg.nozzle);
      // Типовое обозначение насадка по СП 485 / NFPA 2001:
      //  R-360 — окружность + 8 радиальных лучей (распыл во все стороны);
      //  R-180 — полуокружность + 4 луча (односторонний распыл, направление = ось участка);
      //  radial — окружность + крест (4 луча).
      const C = { x: B.x, y: B.y };
      const color = '#1565c0';
      const R = 7;
      if (seg.nozzle === 'R-360') {
        svg += `<circle cx="${C.x}" cy="${C.y}" r="${R}" fill="#fff" stroke="${color}" stroke-width="1.5" pointer-events="none"/>`;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          const x1 = C.x + Math.cos(a) * (R - 1), y1 = C.y + Math.sin(a) * (R - 1);
          const x2 = C.x + Math.cos(a) * (R + 4), y2 = C.y + Math.sin(a) * (R + 4);
          svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.4" pointer-events="none"/>`;
        }
        svg += `<circle cx="${C.x}" cy="${C.y}" r="1.8" fill="${color}" pointer-events="none"/>`;
      } else if (seg.nozzle === 'R-180') {
        // направление распыла = направление участка (A→B)
        const dx = B.x - A.x, dy = B.y - A.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / len, ny = dy / len;              // ось участка (вперёд)
        const base = Math.atan2(ny, nx);                  // угол оси
        // полукруг: от угла base-90° до base+90°, открытый «вперёд»
        const a1 = base - Math.PI / 2, a2 = base + Math.PI / 2;
        const p1x = C.x + Math.cos(a1) * R, p1y = C.y + Math.sin(a1) * R;
        const p2x = C.x + Math.cos(a2) * R, p2y = C.y + Math.sin(a2) * R;
        svg += `<path d="M ${p1x} ${p1y} A ${R} ${R} 0 0 1 ${p2x} ${p2y} Z" fill="#fff" stroke="${color}" stroke-width="1.5" pointer-events="none"/>`;
        for (let k = 0; k < 4; k++) {
          const a = base - Math.PI / 2 + (k + 0.5) * Math.PI / 4;
          const x1 = C.x + Math.cos(a) * (R - 1), y1 = C.y + Math.sin(a) * (R - 1);
          const x2 = C.x + Math.cos(a) * (R + 4), y2 = C.y + Math.sin(a) * (R + 4);
          svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.4" pointer-events="none"/>`;
        }
      } else {
        // radial / прочее — окружность с крестом (4 луча)
        svg += `<circle cx="${C.x}" cy="${C.y}" r="${R}" fill="#fff" stroke="${color}" stroke-width="1.5" pointer-events="none"/>`;
        [0, Math.PI/2, Math.PI, 3*Math.PI/2].forEach(a => {
          const x1 = C.x + Math.cos(a) * (R - 1), y1 = C.y + Math.sin(a) * (R - 1);
          const x2 = C.x + Math.cos(a) * (R + 4), y2 = C.y + Math.sin(a) * (R + 4);
          svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.4" pointer-events="none"/>`;
        });
        svg += `<circle cx="${C.x}" cy="${C.y}" r="1.8" fill="${color}" pointer-events="none"/>`;
      }
      // Подпись размера + тип
      svg += `<text x="${C.x + R + 8}" y="${C.y + 12}" font-size="10" font-weight="600" fill="#0d47a1" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${nozDN} ${esc(seg.nozzle)}</text>`;
    }
  });

  // Nodes (after segments) + номера узлов (N0 = root, далее по порядку pipeline)
  if (V3.showNodes) {
    const nodeIdx = new Map([['root', 0]]);
    pipe.forEach((s, i) => nodeIdx.set(s.id, i + 1));
    for (const [id, p] of nodes) {
      const P2 = P(p);
      const sel = id === V3.selectedNode;
      const r = sel ? 7 : 4;
      const fill = id === 'root' ? '#1565c0' : (sel ? '#1565c0' : '#fff');
      svg += `<circle class="iso-node" data-node="${id}" cx="${P2.x}" cy="${P2.y}" r="${r}"
               fill="${fill}" stroke="#0d47a1" stroke-width="${sel?2:1.2}" style="cursor:pointer;"/>`;
      if (V3.showNums) {
        const n = nodeIdx.get(id) ?? '';
        svg += `<text x="${P2.x + (sel?10:7)}" y="${P2.y - (sel?9:6)}" font-size="11" font-weight="600" fill="#0d47a1" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">N${n}</text>`;
      }
    }
  }

  // Опоры (рисуем поверх труб, но под узлами)
  if (V3.showSupports !== false) {
    supports.forEach(sup => {
      const seg = pipe.find(s => s.id === sup.segId); if (!seg) return;
      const a = nodes.get(seg.parent || 'root'), b = nodes.get(seg.id);
      if (!a || !b) return;
      const p3 = { x: a.x + (b.x - a.x) * sup.t, y: a.y + (b.y - a.y) * sup.t, z: a.z + (b.z - a.z) * sup.t };
      const pp = P(p3);
      if (sup.type === 'rigid') {
        svg += `<rect x="${pp.x-4}" y="${pp.y-4}" width="8" height="8" fill="#f9a825" stroke="#6d4c00" stroke-width="1.2" pointer-events="none"><title>Жёсткая (неподвижная) опора</title></rect>`;
      } else {
        svg += `<circle cx="${pp.x}" cy="${pp.y}" r="4.5" fill="#fff" stroke="#6d4c00" stroke-width="1.2" pointer-events="none"><title>Скользящая (подвижная) опора</title></circle>`;
      }
    });
  }

  // For selected node — draw axis arrows to preview direction
  if (V3.selectedNode && nodes.has(V3.selectedNode)) {
    const np = nodes.get(V3.selectedNode);
    const LN = 0.6;  // arrow length, metres
    [['x',  '#2e7d32'], ['-x', '#2e7d32'],
     ['y',  '#c62828'], ['-y', '#c62828'],
     ['z',  '#1565c0'], ['-z', '#1565c0']].forEach(([ax, col]) => {
      const v = axisVec(ax);
      const endP = P({ x: np.x + v.x*LN, y: np.y + v.y*LN, z: np.z + v.z*LN });
      const startP = P(np);
      svg += `<line x1="${startP.x}" y1="${startP.y}" x2="${endP.x}" y2="${endP.y}"
                stroke="${col}" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
    });
  }

  svg += `</svg>`;
  $('iso-canvas').innerHTML = svg;
  $('iso-vtr').innerHTML = `V<sub>тр</sub> = ${(totalVol/1000).toFixed(3)} м³`;

  // Node info
  const np = nodes.get(V3.selectedNode);
  if (np) {
    $('iso-node-info').innerHTML = `<b>${V3.selectedNode === 'root' ? 'Коллектор (0, 0, 0)' : 'Узел ' + V3.selectedNode.slice(-5)}</b>
      <br>X = ${np.x.toFixed(2)} м · Y = ${np.y.toFixed(2)} м · Z = ${np.z.toFixed(2)} м`;
  } else $('iso-node-info').textContent = '— не выбран —';

  // Disable axis buttons for directions that are already occupied
  // (either same-axis child or reverse of incoming parent).
  ['x','-x','y','-y','z','-z'].forEach(ax => {
    const btn = document.querySelector(`[data-axis="${ax}"]`);
    if (!btn) return;
    const reason = findAxisConflict(pipe, V3.selectedNode, ax);
    btn.disabled = !!reason;
    btn.title = reason || `Добавить участок в направлении ${ax}.`;
  });

  // Segment list — inline edit + delete per row
  const list = $('seg-list');
  const DN_OPTS = [15,20,22,25,28,32,34,40,50,65,80,100];
  const NOZ_OPTS = [['none','—'],['R-360','R-360'],['R-180','R-180'],['radial','радиальный']];
  list.innerHTML = pipe.map((p, i) => {
    const isSel = p.id === V3.selectedNode;
    const dnSel = DN_OPTS.map(dn => `<option ${+p.DN===dn?'selected':''}>${dn}</option>`).join('');
    const nozSel = NOZ_OPTS.map(([v,t]) => `<option value="${v}" ${p.nozzle===v?'selected':''}>${t}</option>`).join('');
    return `<div class="seg-item ${isSel?'sel':''}" data-id="${p.id}">
      <span class="seg-no" title="Кликните, чтобы выбрать узел в конце этого участка">${i+1}</span>
      <span class="seg-axis" title="Направление участка">${p.axis}</span>
      <input type="number" class="seg-edit" data-f="L" value="${(+p.L).toFixed(2)}" step="0.05" min="0.05" title="Длина участка, м (шаг 0,05 м)" style="width:62px;">
      <span class="seg-dn" title="Диаметр подбирается автоматически по расходу, фазе агента и давлению перед насадками">DN${p.DN}</span>
      <select class="seg-edit" data-f="nozzle" title="Насадок на конце">${nozSel}</select>
      <button type="button" class="sup-ibtn sup-danger seg-del-one" data-id="${p.id}" title="Удалить этот участок и все его ответвления">✕</button>
    </div>`;
  }).join('') || `<div style="color:#888;padding:8px;">Нет участков. Выберите узел и направление.</div>`;

  // Click row → select node
  list.onclick = (e) => {
    if (e.target.closest('.seg-edit') || e.target.closest('.seg-del-one')) return;
    const it = e.target.closest('.seg-item');
    if (it) { V3.selectedNode = it.dataset.id; renderIso(S.isoDirId); }
  };
  // Inline edit
  list.onchange = (e) => {
    const inp = e.target.closest('.seg-edit');
    if (!inp) return;
    const it = inp.closest('.seg-item'); if (!it) return;
    const seg = pipe.find(p => p.id === it.dataset.id); if (!seg) return;
    const f = inp.dataset.f;
    if (f === 'L') {
      const raw = Math.max(0.05, +inp.value || 0.05);
      seg.L = Math.round(raw / 0.05) * 0.05;              // снап к 0,05 м
    }
    else if (f === 'nozzle') {
      if (inp.value !== 'none') {
        // Насадок можно ставить только в листовом узле (нет отводов)
        const hasKids = pipe.some(x => (x.parent || 'root') === seg.id);
        if (hasKids) {
          alert('Нельзя установить насадок: от этого узла уже отходят участки (стык/отвод). Насадок ставится только на тупиковом конце.');
          inp.value = seg.nozzle || 'none';
          return;
        }
      }
      seg.nozzle = inp.value;
    }
    // DN вручную не редактируется — авто-пересчёт
    const inst = currentInst();
    const target = S.isoDirId ? inst.directions.find(d => d.id === S.isoDirId) : null;
    if (target) onPipelineChange(target); else saveAll();
    renderIso(S.isoDirId);
  };
  // Delete any segment + its subtree
  list.querySelectorAll('.seg-del-one').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const inst = currentInst();
      const target = S.isoDirId
        ? inst.directions.find(d => d.id === S.isoDirId)
        : null;
      if (!target) return;
      const descCount = countDescendants(target.pipeline, id);
      const msg = descCount > 0
        ? `Удалить участок и ${descCount} дочерних? (всего ${descCount+1})`
        : 'Удалить этот участок?';
      if (!confirm(msg)) return;
      removeSegAndDescendants(target, id);
      if (V3.selectedNode === id) V3.selectedNode = 'root';
      onPipelineChange(target); renderIso(S.isoDirId);
    });
  });

}

function fitView(dirId) {
  const inst = currentInst();
  const pipe = dirId
    ? (inst.directions.find(d => d.id === dirId)?.pipeline || [])
    : inst.directions.flatMap(d => d.pipeline || []);
  const nodes = buildNodes(pipe);
  const pts = [...nodes.values()];
  if (!pts.length) { V3.zoom = 1; V3.panX = 0; V3.panY = 0; return; }
  const rpts = pts.map(p => rot3(p));
  const minX = Math.min(...rpts.map(p => p.x), 0);
  const maxX = Math.max(...rpts.map(p => p.x), 0);
  const minY = Math.min(...rpts.map(p => p.y), 0);
  const maxY = Math.max(...rpts.map(p => p.y), 0);
  const W = 900, H = 580, pad = 60;
  const spanX = Math.max(0.5, maxX - minX);
  const spanY = Math.max(0.5, maxY - minY);
  const scaleX = (W - 2*pad) / spanX / V3.scale;
  const scaleY = (H - 2*pad) / spanY / V3.scale;
  V3.zoom = Math.max(0.2, Math.min(4, Math.min(scaleX, scaleY)));
  V3.panX = -(minX + maxX) / 2 * V3.scale * V3.zoom;
  V3.panY =  (minY + maxY) / 2 * V3.scale * V3.zoom;
}

function openIso(dirId) {
  S.isoDirId = dirId;
  V3.selectedNode = 'root';
  fitView(dirId);
  $('dlg-iso').showModal();
  renderIso(dirId);
}

/* Setup of dialog-wide event handlers (once at init). */
function setupIsoHandlers() {
  const canvas = $('iso-canvas');
  const W = 900, H = 580;

  // Экранная позиция точки p при заданных yaw/pitch и pan (для orbit).
  function screenOf(p, yaw, pitch, panX, panY) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 =  p.x*cy + p.z*sy;
    const z1 = -p.x*sy + p.z*cy;
    const y1 =  p.y;
    const y2 =  y1*cp - z1*sp;
    const s = V3.scale * V3.zoom;
    return { x: W/2 + x1*s + panX, y: H/2 - y2*s + panY };
  }

  // Текущая мировая точка выбранного узла (для orbit-rotate).
  function selectedNodePos() {
    const inst = currentInst();
    const pipe = S.isoDirId
      ? (inst.directions.find(d => d.id === S.isoDirId)?.pipeline || [])
      : inst.directions.flatMap(d => d.pipeline || []);
    const nodes = buildNodes(pipe);
    return nodes.get(V3.selectedNode) || { x:0, y:0, z:0 };
  }

  let mode = null; // 'rotate' | 'pan' | 'resize'
  let lastX = 0, lastY = 0;
  let resizeSegId = null;

  canvas.addEventListener('pointerdown', (e) => {
    // Перетаскивание узла = изменение длины родительского участка.
    const nodeEl = e.target.closest('.iso-node');
    if (nodeEl && nodeEl.dataset.node !== 'root') {
      const nodeId = nodeEl.dataset.node;
      V3.selectedNode = nodeId;
      // Находим входящий участок (его длину и будем менять).
      const inst = currentInst();
      const target = S.isoDirId ? inst.directions.find(d => d.id === S.isoDirId) : null;
      const seg = target?.pipeline.find(s => s.id === nodeId);
      if (seg) {
        mode = 'resize'; resizeSegId = seg.id;
        lastX = e.clientX; lastY = e.clientY;
        canvas.style.cursor = 'ew-resize';
        canvas.setPointerCapture(e.pointerId);
        renderIso(S.isoDirId);
        e.stopPropagation();
        return;
      }
    }
    if (nodeEl) {
      // Клик по root — просто выбрать.
      V3.selectedNode = nodeEl.dataset.node;
      renderIso(S.isoDirId);
      return;
    }
    // Клик по участку — выделить его (endpoint становится selectedNode).
    const segEl = e.target.closest('.iso-seg-hit');
    if (segEl) {
      V3.selectedNode = segEl.dataset.seg;
      renderIso(S.isoDirId);
      return;
    }
    // Иначе вращение / панорамирование фона.
    mode = e.shiftKey ? 'pan' : 'rotate';
    lastX = e.clientX; lastY = e.clientY;
    canvas.style.cursor = mode === 'pan' ? 'move' : 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (mode === 'pan') {
      V3.panX += dx; V3.panY += dy;
      renderIso(S.isoDirId);
      return;
    }

    if (mode === 'rotate') {
      // Orbit вокруг выбранного узла: пересчитываем pan так, чтобы
      // экранная позиция узла не изменилась после поворота.
      const anchor = selectedNodePos();
      const before = screenOf(anchor, V3.yaw, V3.pitch, V3.panX, V3.panY);
      const newYaw   = V3.yaw + dx * 0.01;
      let newPitch = V3.pitch + dy * 0.01;
      newPitch = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, newPitch));
      const after = screenOf(anchor, newYaw, newPitch, V3.panX, V3.panY);
      V3.yaw = newYaw; V3.pitch = newPitch;
      V3.panX += before.x - after.x;
      V3.panY += before.y - after.y;
      renderIso(S.isoDirId);
      return;
    }

    if (mode === 'resize' && resizeSegId) {
      const inst = currentInst();
      const target = S.isoDirId ? inst.directions.find(d => d.id === S.isoDirId) : null;
      const seg = target?.pipeline.find(s => s.id === resizeSegId);
      if (!seg) return;
      // Скринная проекция оси участка.
      const v = axisVec(seg.axis);
      const r = rot3(v);
      const s = V3.scale * V3.zoom;
      const ux = r.x * s, uy = -r.y * s;     // инверсия Y на экране
      const len2 = ux*ux + uy*uy;
      if (len2 < 1) return;
      const dL = (dx * ux + dy * uy) / len2;
      const Lraw = Math.max(0.05, seg.L + dL);
      seg.L = Math.round(Lraw / 0.05) * 0.05;            // снап к 0,05 м
      onPipelineChange(target);
      renderIso(S.isoDirId);
      return;
    }
  });

  const endDrag = () => {
    mode = null; resizeSegId = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.15 : 1/1.15;
    V3.zoom = Math.max(0.1, Math.min(10, V3.zoom * k));
    renderIso(S.isoDirId);
  }, { passive: false });

  // View presets
  document.querySelectorAll('[data-view]').forEach(b => {
    b.addEventListener('click', () => {
      const p = VIEW_PRESETS[b.dataset.view]; if (!p) return;
      V3.yaw = p.yaw; V3.pitch = p.pitch;
      renderIso(S.isoDirId);
    });
  });

  // Axis direction buttons — add new segment from selected node
  document.querySelectorAll('[data-axis]').forEach(b => {
    b.addEventListener('click', () => {
      const inst = currentInst();
      const target = S.isoDirId
        ? inst.directions.find(d => d.id === S.isoDirId)
        : inst.directions[0];
      if (!target) { alert('Нет направления.'); return; }
      const axis = b.dataset.axis;
      // Запрет построения по уже занятому направлению от текущего узла.
      const conflict = findAxisConflict(target.pipeline, V3.selectedNode, axis);
      if (conflict) { alert(conflict); return; }
      // Снап длины к шагу 0,05 м
      const Lraw = Math.max(0.05, +$('seg-L').value || 1);
      const Lsnap = Math.round(Lraw / 0.05) * 0.05;
      // Насадок — только если существующий узел-родитель не станет «стыком»
      // (у него на момент добавления уже есть хотя бы один ребёнок → нельзя).
      let noz = $('seg-noz').value;
      if (noz && noz !== 'none') {
        // Оставляем — это конец НОВОГО участка, а у нового конца детей нет.
      }
      const seg = {
        id: newId('s-'), parent: V3.selectedNode,
        axis, L: Lsnap,
        DN: +$('seg-DN').value, nozzle: noz,
      };
      target.pipeline.push(seg);
      V3.selectedNode = seg.id;
      onPipelineChange(target);                     // авто-DN
      // Мягкое предупреждение о слишком короткой прямой между фитингами.
      const warns = collectFittingWarnings(target);
      renderIso(S.isoDirId);
      if (warns.length) console.warn('[АГПТ] fitting-distance:', warns);
    });
  });

  $('seg-del').addEventListener('click', () => {
    const inst = currentInst();
    const target = S.isoDirId
      ? inst.directions.find(d => d.id === S.isoDirId)
      : null;
    if (!target || !target.pipeline.length) return;
    if (!confirm('Удалить последний добавленный участок?')) return;
    // Find last segment; if it is currently selected endpoint, clear selection
    const last = target.pipeline.pop();
    if (V3.selectedNode === last.id) V3.selectedNode = last.parent || 'root';
    // Remove any segments that referenced it as parent (branches)
    target.pipeline = target.pipeline.filter(p => p.parent !== last.id);
    saveAll(); renderIso(S.isoDirId);
  });

  $('iso-toggle-nums').addEventListener('click',  () => { V3.showNums  = !V3.showNums;  renderIso(S.isoDirId); });
  $('iso-toggle-nozz').addEventListener('click',  () => { V3.showNozz  = !V3.showNozz;  renderIso(S.isoDirId); });
  $('iso-toggle-nodes').addEventListener('click', () => { V3.showNodes = !V3.showNodes; renderIso(S.isoDirId); });
  $('iso-zoom-fit').addEventListener('click', () => { fitView(S.isoDirId); renderIso(S.isoDirId); });
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

/* ------------------- Auto-DN per segment ------------------- */
/** Считает, сколько насадков-потомков у каждого узла.
 *  Сегмент переносит поток = (число насадков-потомков) / (всего насадков) * m_dot_total. */
function countNozzlesDownstream(pipeline) {
  const childrenByParent = new Map();
  pipeline.forEach(s => {
    const k = s.parent || 'root';
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k).push(s);
  });
  const memo = new Map();
  function count(segId) {
    if (memo.has(segId)) return memo.get(segId);
    const kids = childrenByParent.get(segId) || [];
    const seg = pipeline.find(x => x.id === segId);
    const self = (seg?.nozzle && seg.nozzle !== 'none') ? 1 : 0;
    const sum = self + kids.reduce((a, k) => a + count(k.id), 0);
    memo.set(segId, sum); return sum;
  }
  pipeline.forEach(s => count(s.id));
  return memo;
}

/** Минимально допустимая длина прямого участка между фитингами (СП 485 — 10·DN).
 *  Возврат в метрах. */
function minStraightRun(dn) {
  return Math.max(0.05, 10 * (+dn || 0) / 1000);
}

/** Максимальный шаг между креплениями стальной трубы, м
 *  (общестроительные нормы + СП 485: не более из строительных и технических). */
function supportStep(dn) {
  const t = { 15:2.0, 20:2.5, 25:2.5, 32:3.0, 40:3.5, 50:4.0, 65:4.5, 80:5.0, 100:6.0 };
  return t[+dn] || 3.0;
}

/** Диаметр отверстия/присоединения насадка по диаметру трубы и типу:
 *   R-360 (потолочный, 360°): DN = DN трубы (равное проходное сечение);
 *   R-180 (боковой): на 1 шаг меньше DN трубы (ограниченный угол);
 *   radial: равен DN трубы.
 *  Возвращает строку "DN15" и т.п. */
function nozzleSize(pipeDn, type) {
  const list = DN_LIST.slice(); // [15,20,25,32,40,50,65,80,100]
  const i = Math.max(0, list.indexOf(+pipeDn));
  if (type === 'R-180') return 'DN' + (list[Math.max(0, i - 1)] || pipeDn);
  return 'DN' + pipeDn;
}

/** Автоматическая расстановка опор трубопровода.
 *   Правила:
 *    — на каждом фитинг-узле (поворот, тройник, конец-насадок) — жёсткая опора
 *      со стороны каждого подходящего сегмента, на 0.3 м от фитинга
 *      (не ближе 10% длины и не дальше середины);
 *    — вдоль прямых участков — скользящие опоры с шагом supportStep(DN);
 *    — первый и последний «скользящие» точки не ближе 0.3 м к концам.
 *   Возвращает массив { segId, t ∈ (0..1), type: 'rigid'|'slide' }. */
function computeSupports(pipeline, nodes) {
  const result = [];
  const fitting = nodesWithFitting(pipeline);
  const endsAtNozzle = new Set(pipeline.filter(s => s.nozzle && s.nozzle !== 'none').map(s => s.id));
  pipeline.forEach(s => {
    const L = +s.L || 0; if (L <= 0.01) return;
    const step = supportStep(+s.DN || 25);
    const pad = Math.min(0.3, L * 0.1);
    // Жёсткая опора возле фитинга со стороны старта (parent)
    const startFit = fitting.has(s.parent || 'root') || (s.parent || 'root') === 'root';
    if (startFit && L > pad * 2) result.push({ segId: s.id, t: pad / L, type: 'rigid' });
    // Жёсткая опора возле фитинга/насадка со стороны конца (seg.id)
    const endFit = fitting.has(s.id) || endsAtNozzle.has(s.id);
    if (endFit && L > pad * 2) result.push({ segId: s.id, t: (L - pad) / L, type: 'rigid' });
    // Скользящие опоры по шагу вдоль участка (между жёсткими)
    const startT = startFit ? pad / L : 0;
    const endT   = endFit   ? (L - pad) / L : 1;
    const innerL = L * (endT - startT);
    if (innerL > step) {
      const n = Math.floor(innerL / step);
      const gap = innerL / (n + 1);
      for (let k = 1; k <= n; k++) {
        result.push({ segId: s.id, t: startT + (k * gap) / L, type: 'slide' });
      }
    }
  });
  return result;
}

/** Узлы, где установлен фитинг (поворот или тройник):
 *   — любой узел, являющийся parent'ом для ≥1 сегмента, И при этом сам
 *     является концом другого сегмента ИЛИ имеет ≥2 детей ИЛИ смена оси.
 *   Возвращает Set(nodeId). */
function nodesWithFitting(pipeline) {
  const fitting = new Set();
  const childrenByParent = new Map();
  pipeline.forEach(s => {
    const k = s.parent || 'root';
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k).push(s);
  });
  for (const [parentId, kids] of childrenByParent) {
    const parentSeg = parentId === 'root' ? null : pipeline.find(s => s.id === parentId);
    if (kids.length >= 2) { fitting.add(parentId); continue; }          // тройник / крест
    if (parentSeg && kids[0] && kids[0].axis !== parentSeg.axis) {      // поворот
      fitting.add(parentId);
    }
  }
  return fitting;
}

/** Возвращает массив сообщений-предупреждений про слишком короткие прямые
 *  участки между фитингами (СП 485 — L ≥ 10·DN) и про T-отводы вниз
 *  для агентов с жидкой фазой (halocarbon, CO₂). */
function collectFittingWarnings(dir) {
  const pipe = dir.pipeline || [];
  const fitting = nodesWithFitting(pipe);
  const out = [];
  pipe.forEach((s, i) => {
    const Lmin = minStraightRun(s.DN);
    const startAtFitting = fitting.has(s.parent || 'root');
    const endAtFitting   = fitting.has(s.id);
    if ((startAtFitting || endAtFitting) && (+s.L || 0) < Lmin) {
      out.push(`участок #${i+1} (DN${s.DN}) длиной ${(+s.L||0).toFixed(2)} м — < 10·DN = ${Lmin.toFixed(2)} м между фитингами.`);
    }
  });
  // Крестовые узлы (4+ трубы в одной точке).
  const inc = new Map();               // nodeId → incoming seg count (0..1)
  const kids = new Map();               // nodeId → outgoing seg count
  pipe.forEach(s => {
    inc.set(s.id, 1);                   // каждый seg «приходит» в свой конец
    const p = s.parent || 'root';
    kids.set(p, (kids.get(p) || 0) + 1);
  });
  const allNodes = new Set(['root', ...pipe.map(s => s.id)]);
  const nodeIdx = new Map([['root', 0]]);
  pipe.forEach((s, i) => nodeIdx.set(s.id, i + 1));
  allNodes.forEach(id => {
    const total = (inc.get(id) || 0) + (kids.get(id) || 0);
    if (total >= 4) {
      out.push(`узел N${nodeIdx.get(id)} — крестовое соединение (${total} труб); по СП 485 / FSSA допускаются только T-фитинги, замените на два T в соседних точках.`);
    }
  });

  // T-отвод вниз для жидкой фазы.
  const inst = currentInst();
  const a = inst && AGENTS[inst.agent];
  if (a && a.type === 'halocarbon') {
    pipe.forEach((s, i) => {
      if (s.axis !== '-y') return;
      const parentId = s.parent || 'root';
      const siblings = pipe.filter(x => (x.parent || 'root') === parentId && x.id !== s.id);
      const parentSeg = parentId === 'root' ? null : pipe.find(x => x.id === parentId);
      const parentHorizontal = !parentSeg || !['y','-y'].includes(parentSeg.axis);
      const hasHorizSibling = siblings.some(x => !['y','-y'].includes(x.axis));
      if (parentHorizontal && (hasHorizSibling || siblings.length)) {
        out.push(`участок #${i+1}: T-отвод вниз (-Y) от горизонтали для ${a.label} (жидкая фаза) не рекомендуется — отвод должен быть сверху магистрали.`);
      }
    });
  }
  return out;
}

/** Возвращает сообщение, если от узла `nodeId` в направлении `axis` нельзя
 * проложить участок (уже есть дочерний в этом направлении, или это инверсия
 * входящего участка = пойдёт обратно в родителя). Иначе null. */
function findAxisConflict(pipeline, nodeId, axis) {
  // 1) Если узел оканчивается насадком — от него нельзя продолжать трубопровод.
  if (nodeId && nodeId !== 'root') {
    const self = pipeline.find(s => s.id === nodeId);
    if (self && self.nozzle && self.nozzle !== 'none') {
      return `На узле установлен насадок (${self.nozzle}). От насадка нельзя продолжать трубопровод — выберите другой узел.`;
    }
  }
  // 2) Уже есть дочерний участок в этом же направлении.
  const sameDir = pipeline.find(s => (s.parent || 'root') === nodeId && s.axis === axis);
  if (sameDir) {
    return `От этого узла уже построен участок в направлении ${axis}. Выберите другое направление или другой узел.`;
  }
  // 3) Обратное направление входящего участка = шаг «назад» в родителя.
  const isVert = a => a === 'y' || a === '-y';
  let incoming = null;
  if (nodeId && nodeId !== 'root') {
    incoming = pipeline.find(s => s.id === nodeId) || null;
    if (incoming) {
      const inv = incoming.axis.startsWith('-') ? incoming.axis.slice(1) : '-' + incoming.axis;
      if (axis === inv) {
        return `Направление ${axis} противоположно входящему участку (${incoming.axis}) и ведёт обратно по той же линии. Удалите или продлите существующий участок.`;
      }
    }
  }
  // 3a) Крестовое соединение недопустимо: в одном узле максимум T-фитинг
  //     = 3 подходящих трубы (вход + проход + отвод). 4-я = крест.
  const childrenNow = pipeline.filter(s => (s.parent || 'root') === nodeId).length;
  const total = (incoming ? 1 : 0) + childrenNow + 1;      // +1 = новый участок
  if (total > 3) {
    return `В узле уже сходятся ${(incoming ? 1 : 0) + childrenNow} трубы — добавление ещё одной даст крестовое соединение (не допускается по СП 485 / FSSA — используйте T-фитинги).`;
  }

  // 4) Смешение плоскостей: от узла, где уже есть горизонтальные отводы,
  //    нельзя пускать вертикальный (и наоборот). Учитываем и входящий участок.
  const children = pipeline.filter(s => (s.parent || 'root') === nodeId);
  const related  = incoming ? [incoming, ...children] : children;
  if (related.length) {
    const anyHoriz = related.some(s => !isVert(s.axis));
    const anyVert  = related.some(s =>  isVert(s.axis));
    if (isVert(axis) && anyHoriz) {
      return `От этого узла уже идут горизонтальные участки — вертикальный отвод в этом же узле не допускается (см. СП 485: фитинги одной плоскости).`;
    }
    if (!isVert(axis) && anyVert) {
      return `От этого узла уже идёт вертикальный участок — горизонтальный отвод в этом же узле не допускается (см. СП 485: фитинги одной плоскости).`;
    }
  }
  return null;
}

/** Удалить участок и все его ответвления (рекурсивно по parent-связям). */
function removeSegAndDescendants(dir, segId) {
  const toRemove = new Set([segId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of dir.pipeline) {
      if (!toRemove.has(s.id) && toRemove.has(s.parent)) {
        toRemove.add(s.id); grew = true;
      }
    }
  }
  dir.pipeline = dir.pipeline.filter(s => !toRemove.has(s.id));
}

/** Сколько дочерних участков будет удалено вместе с segId (не считая его самого). */
function countDescendants(pipeline, segId) {
  const toRemove = new Set([segId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of pipeline) {
      if (!toRemove.has(s.id) && toRemove.has(s.parent)) {
        toRemove.add(s.id); grew = true;
      }
    }
  }
  return toRemove.size - 1;
}

/** Подбор DN для всех участков направления с учётом:
 *   — топологии (магистраль несёт поток всех своих насадков, отвод — своих);
 *   — типа агента (жидкая/газовая фаза) через целевую скорость;
 *   — фактической гидравлики (итерация по computeHydraulic):
 *       если v > v_max или P_вых < P_min — увеличиваем DN у самого «узкого»
 *       участка на шаг ряда и пересчитываем.
 *   — правила «DN не растёт вниз по течению» (отвод ≤ магистраль).
 *   Пользователю диаметры НЕ вводятся вручную — вызывается на каждое
 *   изменение трубопровода. */
const DN_LIST = [15, 20, 25, 32, 40, 50, 65, 80, 100];

function autoDnForDirection(dir) {
  const pipe = dir.pipeline || [];
  if (!pipe.length) return;
  const r = computeDir(dir); if (!r) return;
  const inst = currentInst();
  const a = inst && AGENTS[inst.agent];

  // Целевая скорость по фазе агента (FSSA Pipe Design 2012 / ISO 14520):
  //   halocarbon — расчёт ведётся по плотности пара (ρ ≈ 7 кг/м³);
  //                допустимая скорость 40–60 м/с, целим 50;
  //   inert      — газ, допустимо до 80 м/с, целим 70;
  //   CO₂        — жидко-паровой, целим 35.
  const vTarget = (a?.type === 'inert') ? 70 : (a?.type === 'co2') ? 35 : 50;
  const totalMdot = r.mg / (r.tpd || 10);
  const totalNozz = pipe.filter(p => p.nozzle && p.nozzle !== 'none').length || 1;
  const rho = r.r2 || 7;
  const counts = countNozzlesDownstream(pipe);

  // 1) Первичный подбор по массовому расходу ветви.
  pipe.forEach(s => {
    const nz = counts.get(s.id) || 1;
    const mdot = totalMdot * (nz / totalNozz);
    s.DN = recommendDN(mdot, rho, vTarget);
  });

  // 2) Соблюдение монотонности: DN ребёнка ≤ DN родителя (магистраль всегда
  //    не меньше любого своего отвода).
  const byId = new Map(pipe.map(s => [s.id, s]));
  // топологический порядок от корня
  const ordered = [];
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const p = byId.get(id); if (!p) return;
    visit(p.parent || 'root-noop'); ordered.push(p);
  }
  pipe.forEach(s => visit(s.id));
  // сначала проход от листьев к корню: поднять DN родителя до макс. DN детей
  [...ordered].reverse().forEach(s => {
    const parent = byId.get(s.parent);
    if (parent && +parent.DN < +s.DN) parent.DN = s.DN;
  });

  // 3) Итеративная проверка по computeHydraulic: пока не ОК — увеличиваем
  //    DN участка с максимальной скоростью (но не выше 100).
  const mod = findVariant(r.moduleCode);
  for (let iter = 0; iter < 10; iter++) {
    const h = computeHydraulic({
      pipeline: pipe, agent: inst.agent, moduleCode: r.moduleCode,
      mg: r.mg, tp: r.tpd || a?.dischargeS || 10, r2: rho,
    });
    const tooFast = h.segments.filter(x => x.v > vTarget);
    const pressureLow = mod ? (h.P_out_bar < (mod.pmin_atm || 6) * 1.013) : false;
    if (!tooFast.length && !pressureLow) break;
    // выбираем участок-кандидат (самая большая v · L — где больше всего потерь)
    const worst = h.segments.slice().sort((a, b) => (b.v * b.L) - (a.v * a.L))[0];
    if (!worst) break;
    const seg = byId.get(worst.id); if (!seg) break;
    const idx = DN_LIST.indexOf(+seg.DN);
    if (idx < 0 || idx >= DN_LIST.length - 1) break;    // нельзя больше
    seg.DN = DN_LIST[idx + 1];
    // снова подтягиваем родителей
    [...ordered].reverse().forEach(s => {
      const parent = byId.get(s.parent);
      if (parent && +parent.DN < +s.DN) parent.DN = s.DN;
    });
  }
}

/** Вызывается после ЛЮБОГО изменения трубопровода направления:
 *   пересчитывает DN всех участков и сохраняет. */
function onPipelineChange(dir) {
  if (!dir) return;
  autoDnForDirection(dir);
  saveAll();
}

/* ------------------- Specification ------------------- */
function buildSpecRows() {
  const inst = currentInst();
  const rows = {
    modules: {},        // code → {qty, ob, p}
    nozzles: {},        // "type DN15" → qty
    pipes: {},          // "OD×wall" → meters
    supports: {},       // "type DN25" → qty
  };
  inst.directions.forEach(d => {
    const r = computeDir(d);
    if (r) {
      const mod = findVariant(r.moduleCode);
      const key = r.moduleCode;
      rows.modules[key] = rows.modules[key] || { qty: 0, ob: mod?.ob, p: mod?.pressure_bar };
      rows.modules[key].qty += r.n;
    }
    const pipe = d.pipeline || [];
    pipe.forEach(p => {
      if (p.nozzle && p.nozzle !== 'none') {
        const nk = `${p.nozzle} ${nozzleSize(+p.DN, p.nozzle)}`;
        rows.nozzles[nk] = (rows.nozzles[nk] || 0) + 1;
      }
      const od = dnToOD(+p.DN);
      const key = `${od.OD}×${od.w} (DN${p.DN})`;
      rows.pipes[key] = +((rows.pipes[key] || 0) + (+p.L || 0)).toFixed(2);
    });
    // Опоры — по одной записи на каждый маркер (группируем по типу+DN).
    const nodes = buildNodes(pipe);
    computeSupports(pipe, nodes).forEach(sup => {
      const seg = pipe.find(s => s.id === sup.segId); if (!seg) return;
      const kind = sup.type === 'rigid' ? 'Жёсткая' : 'Скользящая';
      const key = `${kind} опора DN${seg.DN}`;
      rows.supports[key] = (rows.supports[key] || 0) + 1;
    });
  });
  // Add assemblies info (коллекторы)
  inst.assemblies.forEach(a => {
    if (a.collectorL > 0) {
      const od = dnToOD(+a.collectorDN);
      const key = `${od.OD}×${od.w} (DN${a.collectorDN}) коллектор`;
      rows.pipes[key] = +((rows.pipes[key] || 0) + a.collectorL).toFixed(2);
    }
  });
  return rows;
}

function openSpec() {
  const inst = currentInst();
  if (!inst.directions.length) { alert('Нет направлений.'); return; }
  const r = buildSpecRows();
  let no = 1;
  const COLGROUP = `<colgroup>
      <col style="width:48px"><col><col style="width:90px"><col style="width:60px"><col style="width:280px">
    </colgroup>`;
  const section = (title, items) => items.length ? `
    <h3 style="color:#0d47a1;margin:12px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.4px;">${title}</h3>
    <table class="sup-tbl sup-spec-tbl">
      ${COLGROUP}
      <thead><tr><th>№</th><th>Наименование</th><th class="num">Кол-во</th><th>Ед.</th><th>Примечание</th></tr></thead>
      <tbody>${items.map(r => `<tr>
        <td>${no++}</td><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td>${r.unit}</td><td>${esc(r.note||'')}</td></tr>`).join('')}</tbody>
    </table>` : '';

  const modItems = Object.entries(r.modules).map(([code, v]) => ({
    name: `Модуль газового пожаротушения ${code}`,
    qty: v.qty, unit: 'шт.',
    note: `${v.ob||'—'} л · ${v.p||'—'} бар`,
  }));
  const nozItems = Object.entries(r.nozzles).map(([code, q]) => ({
    name: `Насадок ${code}`, qty: q, unit: 'шт.', note: '',
  }));
  const pipeItems = Object.entries(r.pipes).sort().map(([key, m]) => ({
    name: `Труба стальная ${key}`, qty: m, unit: 'м', note: '',
  }));
  const supItems = Object.entries(r.supports).sort().map(([key, q]) => ({
    name: key, qty: q, unit: 'шт.',
    note: key.startsWith('Жёсткая') ? 'неподвижная (у фитингов/насадков)' : 'подвижная (вдоль прямых)',
  }));

  const html = `
    <div style="font-size:13px;color:#333;margin-bottom:10px;">
      <b>${esc(inst.name)}</b> · Расчёт № ${esc(inst.calcNo)}<br>
      Объект: ${esc(inst.site?.name || inst.site?.address || '—')}
    </div>
    ${section('Оборудование', modItems)}
    ${section('Насадки', nozItems)}
    ${section('Трубы', pipeItems)}
    ${section('Опоры трубопровода', supItems)}
  `;
  $('spec-body').innerHTML = html;
  $('dlg-spec').showModal();
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
    inst.directions.forEach(d => autoDnForDirection(d));
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

  // 3D scheme handlers
  setupIsoHandlers();

  // Specification
  $('sup-spec').addEventListener('click', openSpec);
  $('spec-copy').addEventListener('click', () => navigator.clipboard.writeText($('spec-body').innerText));
  $('spec-csv').addEventListener('click', () => {
    const rows = [...$('spec-body').querySelectorAll('table tr')].map(tr =>
      [...tr.children].map(td => `"${td.textContent.replace(/"/g,'""').trim()}"`).join(';')
    ).join('\r\n');
    const blob = new Blob(['\ufeff' + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `АГПТ_спец_${currentInst().calcNo}.csv`; a.click();
  });
  $('spec-print').addEventListener('click', () => window.print());

  // Help + footer
  mountHelp({
    module: 'suppression',
    title: 'АГПТ — расчёт газового пожаротушения',
    usage: `
      <h4>Как пользоваться</h4>
      <ol>
        <li><b>Установка</b> — корневая сущность. Задайте норматив (СП 485 / СП РК / NFPA / ISO), ГОТВ и серию модулей.</li>
        <li><b>Направление</b> — область тушения с общими модулями. Добавляется через «+ Направление». Создаётся со скелетом трубопровода по умолчанию.</li>
        <li><b>Зона</b> — геометрия помещения: S, H, концентрация Cн, проёмы fs, параметр П. Направление может содержать несколько зон (расчёт суммируется).</li>
        <li><b>Расчёт</b> — карточки в центре показывают mp/mg/n/Fc автоматически после ввода зон.</li>
        <li><b>3D-схема</b> (кнопка «Аксонометрия») — интерактивная. Кликом выбирается узел, кнопкой направления + длиной добавляется участок. Тянуть — вращать, Shift+тянуть — панорамировать.</li>
        <li><b>«Диаметры авто»</b> — подбор DN по расходу через каждый участок.</li>
        <li><b>«Гидравлика»</b> — Darcy-Weisbach с проверкой P_вых ≥ P_min.</li>
        <li><b>«Спецификация»</b> — сводный BOM (модули, насадки, трубы) с экспортом CSV.</li>
      </ol>
      <h4>Подсказки</h4>
      <ul>
        <li>Наведите курсор на <b>ⓘ</b> у поля — там пояснения и типовые значения.</li>
        <li>Параметр П: 0.4 — стандарт; 0.65 — проёмы в потолке; 0.1 — в полу.</li>
        <li>Для Cн используйте Cmin · 1.2 (СП 485 п. 9.1.1).</li>
      </ul>
    `,
    calcs: `
      <h4>Формулы</h4>
      <p><b>Нормативная масса (СП 485 Прил. Д):</b></p>
      <ul>
        <li>r1 = r0 · k3 · 293 / (273 + tm) — плотность паров при tm и hm</li>
        <li>k2 = П · fs/(S·h) · tp · √h — потери через проёмы</li>
        <li>mp = S · h · r1 · (1 + k2) · Cн / (100 − Cн)</li>
      </ul>
      <p><b>Количество модулей и расчётная масса:</b></p>
      <ul>
        <li>m1 = mb + ob · r2 / 1000, r2 = r1 · pmin / 2</li>
        <li>mtr = obtr · r2 / 1000</li>
        <li>n = ⌈(mp + mtr) / (kz · ob / k1 − m1)⌉</li>
        <li>mg = k1 · (mp + mtr + n · m1)</li>
      </ul>
      <p><b>Площадь сброса Fc (СП 485 Прил. Ж):</b></p>
      <ul>
        <li>pa = 0.1·k2alt МПа, ρв = 1.2·k2alt·293/(273+tm)</li>
        <li>Fc ≥ [1.2·k3·mp / (0.7·1.05·tpd·r1)] · √[ρв / (7·10⁶·pa·((piz+pa)/pa)^(2/7) − 1)] − fs</li>
      </ul>
      <p><b>Гидравлика (Darcy-Weisbach + Альтшуль):</b></p>
      <ul>
        <li>λ = 0.11 · (Δ/D + 68/Re)^0.25</li>
        <li>ΔP = λ · (L/D) · ρ·v²/2 + ζ · ρ·v²/2</li>
      </ul>
    `,
  });
  mountFooter({
    appVersion: APP_VERSION,
    moduleId: 'suppression',
    moduleTitle: 'АГПТ',
    entries: MODULE_CHANGELOG,
  });

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
