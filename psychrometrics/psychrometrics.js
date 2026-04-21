/* psychrometrics.js — UI wiring for ID chart */
import { state, heat, coolDehumidify, humidifyAdiabatic, humidifySteam, mix }
  from './psychrometrics-core.js';
import { render, plotPoint, plotProcess, arrowDefs } from './psychrometrics-chart.js';

const $ = (id) => document.getElementById(id);

const S = {
  T1: 22, RH1: 50, P: 101325,
  proc: 'none', p1: 10, bf: 0.15, wtarget: 10,
  T2: -10, RH2: 80, mix: 0.3,
};

function read() {
  const n = (id, d) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : d; };
  const s = (id, d) => $(id)?.value ?? d;
  S.T1 = n('psy-T1', 22);   S.RH1 = n('psy-RH1', 50);
  S.P  = n('psy-P', 101325);
  S.proc = s('psy-proc', 'none');
  S.p1 = n('psy-p1', 10);   S.bf = n('psy-bf', 0.15);
  S.wtarget = n('psy-wtarget', 10);
  S.T2 = n('psy-T2', -10);  S.RH2 = n('psy-RH2', 80);
  S.mix = n('psy-mix', 0.3);
}

function syncFieldsVisibility() {
  const proc = $('psy-proc').value;
  document.querySelectorAll('[data-for]').forEach(el => {
    const list = el.dataset.for.split(/\s+/);
    el.style.display = list.includes(proc) ? '' : 'none';
  });
  $('psy-state2-wrap').style.display = proc === 'none' ? 'none' : '';
}

function renderCard(id, st) {
  $(id).innerHTML = `
    <div class="card"><span class="label">t</span><span class="value">${st.T} °C</span></div>
    <div class="card"><span class="label">φ</span><span class="value">${st.RH} %</span></div>
    <div class="card"><span class="label">d (W)</span><span class="value">${(st.W*1000).toFixed(2)} г/кг</span></div>
    <div class="card"><span class="label">h</span><span class="value">${st.h} кДж/кг</span></div>
    <div class="card"><span class="label">t_р (dew)</span><span class="value">${st.Td} °C</span></div>
    <div class="card"><span class="label">t_м (wet)</span><span class="value">${st.Twb} °C</span></div>
    <div class="card"><span class="label">ρ</span><span class="value">${st.rho} кг/м³</span></div>
    <div class="card"><span class="label">v</span><span class="value">${st.v} м³/кг</span></div>
  `;
}

function computeProcess(st1) {
  switch (S.proc) {
    case 'heat':        return heat(st1, S.p1);
    case 'cool':        return heat(st1, -Math.abs(S.p1));
    case 'cool-dhu':    return coolDehumidify(st1, S.p1, S.bf);
    case 'humid-ad':    return humidifyAdiabatic(st1, S.wtarget / 1000);
    case 'humid-steam': return humidifySteam(st1, S.wtarget / 1000);
    case 'mix': {
      const st2 = state(S.T2, S.RH2 / 100, S.P);
      return mix(st1, 1 - S.mix, st2, S.mix);
    }
    default: return null;
  }
}

function update() {
  read();
  syncFieldsVisibility();

  const st1 = state(S.T1, S.RH1 / 100, S.P);
  renderCard('psy-state1', st1);

  const st2 = computeProcess(st1);
  if (st2) renderCard('psy-state2', st2);

  // Draw chart
  const host = $('psy-chart');
  const { svg, X, Y } = render(null, { P: S.P });
  const ctx = { X, Y };
  let overlay = arrowDefs();
  overlay += plotPoint(ctx, st1, '1', '#0d47a1');
  if (st2) {
    overlay += plotPoint(ctx, st2, '2', '#c62828');
    overlay += plotProcess(ctx, [st1, st2], '#0d47a1');
  }
  // Insert overlay just before closing </svg>
  host.innerHTML = svg.replace('</svg>', overlay + '</svg>');
}

function init() {
  const ids = ['psy-T1','psy-RH1','psy-P','psy-proc','psy-p1','psy-bf',
               'psy-wtarget','psy-T2','psy-RH2','psy-mix'];
  ids.forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', update);
    if (el.type === 'number') el.addEventListener('input', update);
  });
  update();
}
document.addEventListener('DOMContentLoaded', init);
