/* psychrometrics.js — UI wiring: cycle-of-points editor + Mollier chart.
   Модель:
     cycle.points[i] = { name, t, rh, x? (override d г/кг), V? (V м³/ч на сегмент)}
     cycle.procs[i]  = { type }  — процесс i→(i+1), где type ∈
        'none' | 'P' (нагрев, d=const) | 'C' (охлаждение/осушение)
        | 'A' (адиабат. увлажнение, h=const) | 'S' (паровое увл., t=const)
        | 'X' (свободный, без ограничений) — просто соединить точки
*/
import {
  state, RHfromW, humidityRatio, Pws, enthalpy, TfromHW,
  pressureAtAltitude, processPowerKW, processMoistureKgH,
  RHO_NORMAL, dewPointFromW,
} from './psychrometrics-core.js';
import { render, plotPoint, plotProcess, arrowDefs } from './psychrometrics-chart.js';

const $  = (id) => document.getElementById(id);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* --- Состояние --- */
const S = {
  alt: 0,             // м
  P: 101325,          // Па
  rhMax: 100,         // %
  tEvap: 15,          // °C
  vBase: 10000,       // м³/ч
  tMinChart: -15,     // °C — нижняя граница оси t на диаграмме
  tMaxChart: 50,      // °C — верхняя граница оси t
  dMaxChart: 30,      // г/кг — правая граница оси d
  showRuNames: (() => { try { return localStorage.getItem('psy.showRuNames') === '1'; } catch { return false; } })(),
  points: [
    { name: 'Наружный (зима)', nameUser: true, t: -20, tUser: true, tTs: 1, rh: 85, rhUser: true, rhTs: 1, x: '', h: '', V: '' },
    { name: 'После калорифера', t: '', rh: '', x: '', h: '', V: '' },
    { name: 'После увлажн.',    t: '', rh: '', x: '', h: '', V: '' },
  ],
  procs: [
    { type: 'P', Q: '', qw: '' },          // 1→2 нагрев
    { type: 'A', Q: '', qw: '' },          // 2→3 адиабат. увл.
  ],
};

const PROC_TYPES = [
  { v: 'none', t: '— (разрыв)'                            },
  { v: 'P',    t: 'P · нагрев (d=const)'                  },
  { v: 'C',    t: 'C · охлаждение / осушение'             },
  { v: 'A',    t: 'A · адиабат. увл. (h=const)'           },
  { v: 'S',    t: 'S · паровое увл. (t=const)'            },
  { v: 'M',    t: 'M · смешение с точкой'                 },
  { v: 'R',    t: 'R · рекуператор (теплообмен с точкой)'  },
  { v: 'X',    t: 'X · произвольный'                      },
];

const PROC_COLOR = {
  none: '#b0bec5', P: '#e65100', C: '#0277bd', A: '#2e7d32', S: '#6a1b9a', M: '#00838f', R: '#ad1457', X: '#424242',
};

/* Авто-имя исходящей точки из типа предыдущего процесса */
const PROC_NAME_OUT = {
  P: 'После нагревателя',
  C: 'После охл./осуш.',
  A: 'После адиабат. увл.',
  S: 'После пар. увл.',
  M: 'После смешения',
  R: 'После рекуператора',
  X: 'Смешение/переход',
  none: '',
};

/* Цели процесса: любую ОДНУ величину можно задать — точка 2 рассчитается */
const PROC_TARGETS = [
  { v: '',     t: '— (ввод точки)',  u: '' },
  { v: 't2',   t: 't₂',               u: '°C' },
  { v: 'dt',   t: 'Δt',               u: '°C' },
  { v: 'phi2', t: 'φ₂',               u: '%' },
  { v: 'd2',   t: 'd₂',               u: 'г/кг' },
  { v: 'dd',   t: 'Δd',               u: 'г/кг' },
  { v: 'h2',   t: 'h₂',               u: 'кДж/кг' },
  { v: 'dh',   t: 'Δh',               u: 'кДж/кг' },
  { v: 'Q',    t: 'Q (мощн.)',        u: 'кВт' },
  { v: 'qw',   t: 'qw (влагопр.)',    u: 'кг/ч' },
];

/* Обратная Hyland-Wexler: по Pws → t (Ньютон по ln) */
function invertPws(pwsTarget) {
  let t = 20;
  for (let i = 0; i < 60; i++) {
    const f = Math.log(Pws(t)) - Math.log(Math.max(1e-3, pwsTarget));
    const df = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
    const s = f / df; t -= s;
    if (Math.abs(s) < 1e-4) break;
  }
  return t;
}

/* ========================================================================
   Утилиты
   ======================================================================== */
/* Безопасный парсер числа.
   КРИТИЧНО: Number('') === 0 (а не NaN), что ломало pointState:
   пустое поле d трактовалось как «d=0» и обнуляло W. */
function nNum(v, d=NaN) {
  if (v == null) return d;
  const s = String(v).trim();
  if (s === '') return d;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Расчёт state для точки. Допустимые комбинации:
     (t, φ)   — стандарт
     (t, d)   — через override d (г/кг)
     (t, h)   — из энтальпии находим W
   Возвращает state или null, если данных недостаточно. */
function pointState(p, P) {
  const t  = nNum(p.t);
  const rh = nNum(p.rh);
  const xG = nNum(p.x);   // d, г/кг
  const h  = nNum(p.h);   // энтальпия, кДж/кг
  if (!Number.isFinite(t)) return null;
  // 1. d override
  if (Number.isFinite(xG)) {
    const W = xG / 1000;
    const rhFromX = clamp(100 * W * P / (0.621945 + W) / Pws(t), 0, 200);
    return state(t, rhFromX / 100, P);
  }
  // 2. Энтальпия
  if (Number.isFinite(h)) {
    const W = (h - 1.006 * t) / (2501 + 1.86 * t);
    if (Number.isFinite(W) && W >= 0) {
      const rhFromH = clamp(100 * W * P / (0.621945 + W) / Pws(t), 0, 200);
      return state(t, rhFromH / 100, P);
    }
  }
  // 3. Стандарт: t + φ
  if (!Number.isFinite(rh)) return null;
  return state(t, clamp(rh, 0, 100) / 100, P);
}

/* ========================================================================
   Рендер редактора цикла
   ======================================================================== */
function renderCycle() {
  const host = $('psy-cycle');
  host.innerHTML = '';
  S.points.forEach((p, i) => {
    host.appendChild(pointCard(p, i));
    if (i < S.points.length - 1) {
      host.appendChild(procArrow(S.procs[i] || (S.procs[i]={type:'P'}), i));
    }
  });
}

function pointCard(p, i) {
  const el = document.createElement('div');
  el.className = 'psy-point';
  el.dataset.pointIdx = String(i);
  const du = (f) => p[f+'User'] ? '1' : '';
  const ts = (f) => Number.isFinite(+p[f+'Ts']) ? String(p[f+'Ts']) : '0';
  const ru = S.showRuNames;
  const L = {
    t:   `t, °C${ru?' <em style="color:#90a4ae;font-style:normal">(температура)</em>':''}`,
    rh:  `φ, %${ru?' <em style="color:#90a4ae;font-style:normal">(отн. влажн.)</em>':''}`,
    d:   `d, г/кг${ru?' <em style="color:#90a4ae;font-style:normal">(влагосодерж.)</em>':''}`,
    h:   `h, кДж/кг${ru?' <em style="color:#90a4ae;font-style:normal">(энтальпия)</em>':''}`,
  };
  const hint = i === 0
    ? `<span class="pt-hint">Начало цикла: задайте любые 2 из {t, φ, d, h}.</span>`
    : `<span class="pt-hint">Задайте любую из {t, φ, d, h} — остальное посчитается от процесса ${i}→${i+1}. Либо задайте Q или q<sub>w</sub> на стрелке выше.</span>`;
  el.innerHTML = `
    <div class="psy-point-header">
      <span>Точка ${i+1}</span>
      <button type="button" class="pt-del" title="Удалить точку" data-act="del" data-i="${i}">✕</button>
    </div>
    <label>Имя<input type="text" data-col="name" data-i="${i}" data-user="${du('name')}" value="${escAttr(p.name || '')}"></label>
    <label>${L.t}<input type="number" data-col="t" data-i="${i}" data-user="${du('t')}" data-ts="${ts('t')}" value="${p.t ?? ''}" step="0.1"></label>
    <label>${L.rh}<input type="number" data-col="rh" data-i="${i}" data-user="${du('rh')}" data-ts="${ts('rh')}" value="${p.rh ?? ''}" step="1" min="0" max="100"></label>
    <label>${L.d}<input type="number" data-col="x" data-i="${i}" data-user="${du('x')}" data-ts="${ts('x')}" value="${p.x ?? ''}" step="0.1" placeholder="авто"></label>
    <label>${L.h}<input type="number" data-col="h" data-i="${i}" data-user="${du('h')}" data-ts="${ts('h')}" value="${p.h ?? ''}" step="0.1" placeholder="авто"></label>
    ${hint}
    <div class="pt-computed" data-role="pt-computed"></div>
  `;
  return el;
}

function procArrow(pr, i) {
  const el = document.createElement('div');
  el.className = 'psy-proc-arrow';
  el.dataset.procIdx = String(i);
  const userV = S.points[i].V;
  const hasUserV = userV != null && userV !== '';
  const duQ  = pr.Qs  ? '1' : '';
  const duQw = pr.qws ? '1' : '';
  const tsQ  = Number.isFinite(+pr.Qts)  ? String(pr.Qts)  : '0';
  const tsQw = Number.isFinite(+pr.qwts) ? String(pr.qwts) : '0';
  el.innerHTML = `
    <div class="arr-label">${i+1} → ${i+2}</div>
    <select data-col="proc-type" data-i="${i}">
      ${PROC_TYPES.map(pt => `<option value="${pt.v}" ${pr.type===pt.v?'selected':''}>${pt.t}</option>`).join('')}
    </select>
    <div class="arr" data-role="arr" style="color:${PROC_COLOR[pr.type]||'#607080'}">↓</div>
    <label style="font-size:10px;color:#666;margin-top:4px">Q, кВт
      <input type="number" data-col="Q" data-i="${i}" data-user="${duQ}" data-ts="${tsQ}" value="${pr.Q ?? ''}" step="0.1" placeholder="авто">
    </label>
    <label style="font-size:10px;color:#666;margin-top:2px">q<sub>w</sub>, кг/ч
      <input type="number" data-col="qw" data-i="${i}" data-user="${duQw}" data-ts="${tsQw}" value="${pr.qw ?? ''}" step="0.1" placeholder="авто">
    </label>
    <label style="font-size:10px;color:#666;margin-top:4px">V процесса, м³/ч
      <input type="number" data-col="V" data-i="${i}" data-user="${hasUserV?'1':''}" value="${hasUserV?userV:''}" step="100" placeholder="авто (масса)">
      <span class="v-auto" data-role="v-auto" style="font-size:10px;color:#2e7d32;display:block;margin-top:2px;"></span>
    </label>
    ${pr.type === 'M' ? mixControls(pr, i) : ''}
    ${pr.type === 'R' ? recupControls(pr, i) : ''}
  `;
  return el;
}

/* Поля для процесса «R» (рекуператор): опорная точка (вытяжка) + КПД η (по t).
   Модель: t₂ = t₁ + η·(t_ref − t₁), W₂ = W₁ (сенсибельная модель). */
function recupControls(pr, i) {
  const rw = (pr.recupWith ?? '').toString();
  const eff = (pr.recupEff ?? '0.6').toString();
  const opts = S.points.map((pp, pi) =>
    `<option value="${pi}" ${String(pi)===rw?'selected':''}>${pi+1}. ${escAttr((pp.name||'').slice(0,16))}</option>`
  ).join('');
  return `
    <label style="font-size:10px;color:#ad1457;margin-top:4px;border-top:1px dashed #f48fb1;padding-top:4px" title="Опорная точка — поток, отдающий тепло (обычно вытяжка).">обменивать с точкой
      <select data-col="recupWith" data-i="${i}">
        <option value="">— выбрать —</option>${opts}
      </select>
    </label>
    <label style="font-size:10px;color:#ad1457;margin-top:2px" title="КПД рекуператора по температуре (0…1). t₂ = t₁ + η·(t_ref − t₁), d=const.">η (по t)
      <input type="number" data-col="recupEff" data-i="${i}" value="${eff}" step="0.05" min="0" max="1">
    </label>
  `;
}

/* Поля для процесса «M» (смешение): опорная точка + доля α */
function mixControls(pr, i) {
  const mw = (pr.mixWith ?? '').toString();
  const mr = (pr.mixRatio ?? '0.5').toString();
  const opts = S.points.map((pp, pi) =>
    `<option value="${pi}" ${String(pi)===mw?'selected':''}>${pi+1}. ${escAttr((pp.name||'').slice(0,16))}</option>`
  ).join('');
  return `
    <label style="font-size:10px;color:#00838f;margin-top:4px;border-top:1px dashed #b0bec5;padding-top:4px">смешать с точкой
      <select data-col="mixWith" data-i="${i}">
        <option value="">— выбрать —</option>${opts}
      </select>
    </label>
    <label style="font-size:10px;color:#00838f;margin-top:2px" title="Доля (по массе) входящего потока от точки ${i+1} в смеси. Остальное — от опорной точки.">α (доля ${i+1})
      <input type="number" data-col="mixRatio" data-i="${i}" value="${mr}" step="0.05" min="0" max="1">
    </label>
  `;
}

/* --- Обновляет только computed-блоки карточек БЕЗ пересоздания input'ов.
   Так мы не теряем фокус при вводе. */
function refreshComputedInCards() {
  S.points.forEach((p, i) => {
    const card = document.querySelector(`.psy-point[data-point-idx="${i}"]`);
    if (!card) return;
    const st = pointState(p, S.P);
    const computed = card.querySelector('[data-role="pt-computed"]');
    card.classList.toggle('invalid', !!(st && st.RH > S.rhMax + 0.1));
    if (!computed) return;
    if (!st) {
      computed.innerHTML = i === 0
        ? `<span style="color:#c62828">Начало цикла: задайте любые 2 из (t, φ, d, h).</span>`
        : `<span style="color:#c62828">Задайте любую из (t, φ, d, h) — остальное посчитается от процесса ${i}→${i+1}. Либо задайте Q или q<sub>w</sub> на стрелке процесса выше.</span>`;
    } else {
      computed.innerHTML =
        `<b>d</b>=${(st.W*1000).toFixed(2)} г/кг · <b>h</b>=${st.h.toFixed(2)} кДж/кг<br>` +
        `<b>ρ</b>=${st.rho.toFixed(3)} · <b>v</b>=${st.v.toFixed(4)} · ` +
        `<b>t<sub>р</sub></b>=${st.Td.toFixed(1)} · <b>t<sub>м</sub></b>=${st.Twb.toFixed(1)}`;
    }
  });
  // Цвет стрелки процесса
  S.procs.forEach((pr, i) => {
    const arr = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"] [data-role="arr"]`);
    if (arr) arr.style.color = PROC_COLOR[pr.type] || '#607080';
  });
}

/* Обновить подписи «автоматический V» под полями V, когда сегмент ведомый.
   Также кладём вычисленное V прямо в input.value (НЕ помечая как user),
   чтобы пользователь мог редактировать с текущего числа (стрелки/ввод). */
function refreshAutoV(segs, primaryIdx) {
  if (!segs) return;
  segs.forEach((s, i) => {
    const wrap = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"] [data-role="v-auto"]`);
    const inp  = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"] input[data-col="V"]`);
    if (!s) { if (wrap) wrap.textContent = ''; return; }
    if (s.derived) {
      if (wrap) { wrap.textContent = `авто: ${s.V.toFixed(0)} м³/ч (по массе)`; wrap.style.color = '#2e7d32'; }
      if (inp && inp.dataset.user !== '1') {
        // подставляем вычисленное значение, не дёргая каретку у фокуса
        if (document.activeElement !== inp) inp.value = s.V.toFixed(0);
        else if (inp.value.trim() === '') inp.value = s.V.toFixed(0);
      }
    } else {
      if (wrap) { wrap.textContent = `ведущий · Gда=${s.G.toFixed(0)} кг/ч`; wrap.style.color = '#1565c0'; }
    }
  });
}

function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

/* ========================================================================
   Чтение DOM → state
   ======================================================================== */
function readInputs() {
  // Высота ↔ давление связаны симметрично (ISA/ГОСТ 4401-81):
  //   P(h) = P₀·(1 − 2,25577·10⁻⁵·h)^5,2559
  //   h(P) = (1 − (P/P₀)^(1/5,2559)) / 2,25577·10⁻⁵
  // Ведомым становится то поле, которое НЕ в фокусе.
  const altActive = document.activeElement?.id === 'psy-alt';
  const pActive   = document.activeElement?.id === 'psy-P-kpa';
  if (pActive && !altActive) {
    // Пользователь правит давление → пересчитываем высоту
    S.P = nNum($('psy-P-kpa').value, 101.325) * 1000;
    const r = S.P / 101325;
    S.alt = (r > 0 && r <= 1.5)
      ? (1 - Math.pow(r, 1 / 5.2559)) / 2.25577e-5
      : 0;
    $('psy-alt').value = Math.round(S.alt);
  } else {
    // В фокусе высота (или ни одно из двух) → давление ведомое
    S.alt = nNum($('psy-alt').value, 0);
    S.P = pressureAtAltitude(S.alt);
    $('psy-P-kpa').value = (S.P / 1000).toFixed(3);
  }
  S.rhMax  = nNum($('psy-rhmax').value, 100);
  S.tEvap  = nNum($('psy-tevap').value, 15);
  S.vBase  = nNum($('psy-vbase').value, 10000);
  const tmin = nNum($('psy-tmin-chart')?.value, -15);
  const tmax = nNum($('psy-tmax-chart')?.value, 50);
  const dmax = nNum($('psy-dmax-chart')?.value, 30);
  if (tmin < tmax - 5) { S.tMinChart = tmin; S.tMaxChart = tmax; }
  if (dmax >= 5)       { S.dMaxChart = dmax; }

  $$('#psy-cycle [data-col]').forEach(el => {
    const col = el.dataset.col;
    const i   = +el.dataset.i;
    const v   = el.value;
    const isUser = el.dataset.user === '1';
    const ts = Number(el.dataset.ts) || 0;
    if (col === 'proc-type') { S.procs[i] = S.procs[i] || {}; S.procs[i].type = v; }
    else if (col === 'mixWith')   { S.procs[i] = S.procs[i] || {}; S.procs[i].mixWith   = v; }
    else if (col === 'mixRatio')  { S.procs[i] = S.procs[i] || {}; S.procs[i].mixRatio  = v; }
    else if (col === 'recupWith') { S.procs[i] = S.procs[i] || {}; S.procs[i].recupWith = v; }
    else if (col === 'recupEff')  { S.procs[i] = S.procs[i] || {}; S.procs[i].recupEff  = v; }
    else if (col === 'Q' || col === 'qw') {
      S.procs[i] = S.procs[i] || {};
      if (isUser && v !== '') {
        S.procs[i][col] = v;
        S.procs[i][col + 's']  = true;    // *s — flag
        S.procs[i][col + 'ts'] = ts;
      } else {
        S.procs[i][col] = '';
        S.procs[i][col + 's']  = false;
        S.procs[i][col + 'ts'] = 0;
      }
    }
    else if (col === 'V') {
      S.points[i] = S.points[i] || {};
      if (isUser && v !== '') S.points[i].V = v;
      else S.points[i].V = '';
    }
    else if (col === 'name' || col === 't' || col === 'rh' || col === 'x' || col === 'h') {
      S.points[i] = S.points[i] || {};
      if (isUser) {
        S.points[i][col] = v;
        S.points[i][col + 'User'] = true;
        if (col !== 'name') S.points[i][col + 'Ts'] = ts;
      } else {
        S.points[i][col + 'User'] = false;
        if (col !== 'name') S.points[i][col + 'Ts'] = 0;
      }
    }
  });
}

/* ========================================================================
   Forward-compute: по a (state) + proc (type+tgt+tgtVal) + V + P → state b
   ======================================================================== */
function forwardPoint(a, proc, V, P) {
  const tgt = proc.tgt;
  const val = nNum(proc.tgtVal);
  if (!tgt || !Number.isFinite(val)) return null;

  const Gda = V * a.rho / (1 + a.W);  // кг_да/ч (от точки a)
  let t2 = null, W2 = null, h2 = null;

  /* 1. Инвариант процесса */
  if (proc.type === 'P') W2 = a.W;
  else if (proc.type === 'A') h2 = a.h;
  else if (proc.type === 'S') t2 = a.T;
  // C и X — без жёсткого инварианта (C обработаем отдельно)

  /* 2. Цель */
  switch (tgt) {
    case 't2':  t2 = val; break;
    case 'dt':  t2 = a.T + val; break;
    case 'd2':  W2 = val / 1000; break;
    case 'dd':  W2 = a.W + val / 1000; break;
    case 'h2':  h2 = val; break;
    case 'dh':  h2 = a.h + val; break;
    case 'Q':   if (Gda > 0) h2 = a.h + val * 3600 / Gda; break;
    case 'qw':  if (Gda > 0) W2 = a.W + val / Gda; break;
    case 'phi2': {
      const phi = val / 100;
      if (proc.type === 'P') {
        const pv = a.W * P / (0.621945 + a.W);
        t2 = invertPws(pv / Math.max(1e-4, phi));
        W2 = a.W;
      } else if (proc.type === 'S') {
        t2 = a.T;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      } else if (proc.type === 'A') {
        let tt = a.T - 3;
        for (let it = 0; it < 40; it++) {
          const pv = phi * Pws(tt);
          const W_try = 0.621945 * pv / (P - pv);
          const h_try = 1.006 * tt + W_try * (2501 + 1.86 * tt);
          const tt2 = tt + 0.05;
          const pv2 = phi * Pws(tt2);
          const W2x = 0.621945 * pv2 / (P - pv2);
          const h2x = 1.006 * tt2 + W2x * (2501 + 1.86 * tt2);
          const f = h_try - a.h;
          const df = (h2x - h_try) / 0.05;
          if (Math.abs(df) < 1e-8) break;
          const s = f / df; tt -= s;
          if (Math.abs(s) < 1e-3) break;
        }
        t2 = tt;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      } else if (proc.type === 'C') {
        // C + φ2: охлаждение, конечная φ на насыщении — лучше сделать t2 из d=a.W
        t2 = invertPws((a.W * P / (0.621945 + a.W)) / Math.max(1e-4, phi));
        W2 = a.W;  // без осушения
      } else {
        // X: принимаем t2 = a.T (без изменения), W по φ
        t2 = a.T;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      }
      break;
    }
  }

  /* 3. Замыкание: h ↔ t/W */
  if (t2 == null && W2 != null && h2 != null) t2 = (h2 - 2501 * W2) / (1.006 + 1.86 * W2);
  if (W2 == null && t2 != null && h2 != null) W2 = (h2 - 1.006 * t2) / (2501 + 1.86 * t2);

  /* 3.5. Для C: если после применения цели остались h2 + ни t2 ни W2
     (например tgt=Q или tgt=h2) — предполагаем d=const (сенсибельное охл.).
     Если при этом t2 < Td → переключаемся на линию насыщения и ищем t,
     при котором h(t, Ws(t)) = h2 (охлаждение с осушением).
     Аналогично для P при неполном состоянии: считаем d=const. */
  if ((proc.type === 'C' || proc.type === 'P') && t2 == null && W2 == null && h2 != null) {
    W2 = a.W;
    t2 = (h2 - 2501 * W2) / (1.006 + 1.86 * W2);
    if (proc.type === 'C' && t2 < a.Td - 0.05) {
      // Newton по t на линии насыщения: h_sat(t) = 1.006·t + Ws(t)·(2501+1.86·t)
      let tt = a.Td - 1;
      for (let it = 0; it < 60; it++) {
        const Ws  = humidityRatio(tt, 1.0, P);
        const hh  = 1.006 * tt + Ws * (2501 + 1.86 * tt);
        const tt2 = tt + 0.05;
        const Ws2 = humidityRatio(tt2, 1.0, P);
        const hh2 = 1.006 * tt2 + Ws2 * (2501 + 1.86 * tt2);
        const f = hh - h2;
        const df = (hh2 - hh) / 0.05;
        if (Math.abs(df) < 1e-8) break;
        const s = f / df; tt -= s;
        if (Math.abs(s) < 1e-3) break;
      }
      t2 = tt;
      W2 = humidityRatio(t2, 1.0, P);
    }
  }

  /* 4. Специальная логика C (охлаждение с осушением) */
  if (proc.type === 'C') {
    if (W2 == null && t2 != null) {
      if (t2 < a.Td - 0.05) W2 = humidityRatio(t2, 1.0, P);
      else W2 = a.W;
    }
    if (t2 == null && W2 != null) {
      if (W2 < a.W - 1e-6) t2 = dewPointFromW(W2, P);
      else t2 = a.T;
    }
  }

  /* 5. X: если не хватает одной переменной — нельзя */
  if (proc.type === 'X') {
    if (t2 == null || W2 == null) return null;
  }

  if (t2 == null || W2 == null) return null;
  // Ограничиваем W в пределах насыщения (строгое условие)
  const Ws = humidityRatio(t2, 1.0, P);
  if (W2 > Ws * 1.001) W2 = Ws;
  if (W2 < 0) W2 = 0;
  return state(t2, Math.max(0, Math.min(1, RHfromW(t2, W2, P))), P);
}

/* ========================================================================
   Cascade: авто-имена + forward-compute точки 2+ если задана цель процесса
   ======================================================================== */
function cascade() {
  for (let i = 1; i < S.points.length; i++) {
    const proc = S.procs[i-1] || { type: 'P' };
    const p = S.points[i];
    // Авто-имя
    if (!p.nameUser) {
      p.name = PROC_NAME_OUT[proc.type] || '';
    }
    const aState = pointState(S.points[i-1], S.P);
    if (!aState) continue;

    // Процесс «смешение»: точка i = α·(точка i-1) + (1-α)·(точка mixWith),
    // mass-weighted по сухому воздуху (W и h как удельные — смешиваются по Gда).
    if (proc.type === 'M') {
      const srcIdx = parseInt(proc.mixWith, 10);
      const alpha  = Math.max(0, Math.min(1, parseFloat(proc.mixRatio)));
      if (Number.isFinite(srcIdx) && srcIdx >= 0 && srcIdx < S.points.length && srcIdx !== i) {
        const bSrc = pointState(S.points[srcIdx], S.P);
        if (bSrc && Number.isFinite(alpha)) {
          const W_mix = alpha * aState.W + (1 - alpha) * bSrc.W;
          const h_mix = alpha * aState.h + (1 - alpha) * bSrc.h;
          // Из h и W находим t: t = (h - 2501·W)/(1.006 + 1.86·W)
          const t_mix = (h_mix - 2501 * W_mix) / (1.006 + 1.86 * W_mix);
          const rh_mix = Math.max(0, Math.min(100, RHfromW(t_mix, W_mix, S.P) * 100));
          // Для смешения все поля точки i — «авто», user-input перекрывает
          const anyUser = p.tUser || p.rhUser || p.xUser || p.hUser;
          if (!anyUser) {
            p.t = Number(t_mix.toFixed(2));
            p.rh = Number(rh_mix.toFixed(2));
            p.x = Number((W_mix * 1000).toFixed(3));
            p.h = Number(h_mix.toFixed(3));
          }
          continue;
        }
      }
    }

    // Процесс «рекуператор»: t₂ = t₁ + η·(t_ref − t₁), W₂ = W₁.
    // Сенсибельная модель (без конденсата). Если t₂ опускается ниже точки
    // росы входа — clamp по насыщению при d=const (конденсация на пластинах
    // в данной MVP-модели игнорируется — это отдельная задача).
    if (proc.type === 'R') {
      const srcIdx = parseInt(proc.recupWith, 10);
      const eta    = Math.max(0, Math.min(1, parseFloat(proc.recupEff)));
      if (Number.isFinite(srcIdx) && srcIdx >= 0 && srcIdx < S.points.length && srcIdx !== i) {
        const bSrc = pointState(S.points[srcIdx], S.P);
        if (bSrc && Number.isFinite(eta)) {
          const t2 = aState.T + eta * (bSrc.T - aState.T);
          const W2 = aState.W;
          const rh2 = Math.max(0, Math.min(100, RHfromW(t2, W2, S.P) * 100));
          const h2  = 1.006 * t2 + W2 * (2501 + 1.86 * t2);
          const anyUser = p.tUser || p.rhUser || p.xUser || p.hUser;
          if (!anyUser) {
            p.t = Number(t2.toFixed(2));
            p.rh = Number(rh2.toFixed(2));
            p.x = Number((W2 * 1000).toFixed(3));
            p.h = Number(h2.toFixed(3));
          }
          continue;
        }
      }
    }

    // Собираем кандидаты на «цель» — всё, что пользователь задал вручную.
    // Побеждает самый свежий по timestamp.
    const cands = [];
    if (p.tUser  && p.t  !== '' && p.t  != null) cands.push({ tgt: 't2',   val: nNum(p.t),  ts: +p.tTs  || 0 });
    if (p.rhUser && p.rh !== '' && p.rh != null) cands.push({ tgt: 'phi2', val: nNum(p.rh), ts: +p.rhTs || 0 });
    if (p.xUser  && p.x  !== '' && p.x  != null) cands.push({ tgt: 'd2',   val: nNum(p.x),  ts: +p.xTs  || 0 });
    if (p.hUser  && p.h  !== '' && p.h  != null) cands.push({ tgt: 'h2',   val: nNum(p.h),  ts: +p.hTs  || 0 });
    if (proc.Qs  && proc.Q  !== '' && proc.Q  != null) cands.push({ tgt: 'Q',  val: nNum(proc.Q),  ts: +proc.Qts  || 0 });
    if (proc.qws && proc.qw !== '' && proc.qw != null) cands.push({ tgt: 'qw', val: nNum(proc.qw), ts: +proc.qwts || 0 });

    if (!cands.length) {
      // Нет ни одного пользовательского входа ни на точке, ни на процессе.
      // Оставляем точку как есть — ничего не «подсасываем» от предыдущей.
      continue;
    }

    cands.sort((a, b) => b.ts - a.ts);
    const winner = cands[0];

    // V сегмента
    let V_seg = nNum(S.points[i-1].V);
    if (!(V_seg > 0)) V_seg = S.vBase;

    const bState = forwardPoint(aState, { type: proc.type, tgt: winner.tgt, tgtVal: winner.val }, V_seg, S.P);
    if (!bState) continue;

    // Победитель остаётся user; остальные кандидаты — пересчитываются (user=false).
    ['t','rh','x','h'].forEach(f => {
      const tgtMap = { t:'t2', rh:'phi2', x:'d2', h:'h2' };
      if (tgtMap[f] !== winner.tgt) { p[f + 'User'] = false; p[f + 'Ts'] = 0; }
    });
    if (winner.tgt !== 'Q')  { proc.Qs  = false; proc.Qts  = 0; proc.Q  = ''; }
    if (winner.tgt !== 'qw') { proc.qws = false; proc.qwts = 0; proc.qw = ''; }

    writeComputed(p, bState);

    // «Победитель» сам себя не перезаписывает (user-значение сохраняется как есть).
    if (winner.tgt === 't2')   { p.t  = nNum(p.t); }
    if (winner.tgt === 'phi2') { p.rh = nNum(p.rh); }
    if (winner.tgt === 'd2')   { p.x  = nNum(p.x); }
    if (winner.tgt === 'h2')   { p.h  = nNum(p.h); }
  }
}

/* Записать все поля t/rh/x/h в точку из state (без поднятия user). */
function writeComputed(p, st) {
  p.t  = Number(st.T.toFixed(2));
  p.rh = Number(st.RH.toFixed(2));
  p.x  = Number((st.W * 1000).toFixed(3));
  p.h  = Number(st.h.toFixed(3));
}


/* Для каждой точки: если pointState валиден и d/h не введены пользователем —
   вписываем вычисленные значения в p.x / p.h (без user-флага). Это нужно,
   чтобы в input-полях «d» и «h» отображались посчитанные значения, а не
   placeholder «авто». */
function fillComputedDH() {
  S.points.forEach(p => {
    const st = pointState(p, S.P);
    if (!st) return;
    if (!p.xUser) p.x = Number((st.W * 1000).toFixed(3));
    if (!p.hUser) p.h = Number(st.h.toFixed(3));
    // Заодно синхронизируем t/rh, если они не введены пользователем
    // (например после override по d — φ пересчитался)
    if (!p.tUser)  p.t  = Number(st.T.toFixed(2));
    if (!p.rhUser) p.rh = Number(st.RH.toFixed(2));
  });
}

/* Записывает S.points значения в DOM input'ы (только auto-поля). */
function writeCardsFromState() {
  S.points.forEach((p, i) => {
    const card = document.querySelector(`.psy-point[data-point-idx="${i}"]`);
    if (!card) return;
    ['name','t','rh','x','h'].forEach(col => {
      const inp = card.querySelector(`[data-col="${col}"]`);
      if (!inp) return;
      // S — источник истины. Синхронизируем data-user/data-ts.
      if (!p[col + 'User']) { inp.dataset.user = ''; inp.dataset.ts = '0'; }
      const isUser = inp.dataset.user === '1';
      if (isUser) return;
      if (document.activeElement === inp) return;
      const v = p[col];
      inp.value = (v == null || v === '') ? '' : String(v);
    });
  });
  // Стрелки: синхронизируем Q, qw (user/ts) с моделью
  S.procs.forEach((pr, i) => {
    const arr = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"]`);
    if (!arr) return;
    ['Q','qw'].forEach(col => {
      const inp = arr.querySelector(`input[data-col="${col}"]`);
      if (!inp) return;
      const userFlag = col === 'Q' ? pr.Qs : pr.qws;
      if (!userFlag) {
        inp.dataset.user = ''; inp.dataset.ts = '0';
        if (document.activeElement !== inp) inp.value = '';
      }
    });
  });
}

/* ========================================================================
   Считаем все точки; для каждого процесса — тепло и влагоприток
   ======================================================================== */
function computeCycle() {
  const sts = S.points.map(p => pointState(p, S.P));
  const segs = [];

  /* Сохранение массы: через весь цикл течёт одна и та же масса сух. воздуха
     G_da [кг/ч] = V·ρ/(1+W). Если у какого-то сегмента V задан — он «ведущий»,
     остальные сегменты пересчитывают V = G_da·(1+W)/ρ от СВОЕГО входного
     состояния (т.к. при нагреве ρ падает → V растёт).  Если V не задан
     нигде — ведущим считаем базовый расход S.vBase, приложенный к точке 0. */
  let primaryIdx = -1;
  for (let i = 0; i < S.points.length - 1; i++) {
    if (nNum(S.points[i].V) > 0) { primaryIdx = i; break; }
  }
  let G_ref = 0;  // кг_да/ч — опорный массовый расход
  if (primaryIdx >= 0 && sts[primaryIdx]) {
    const a = sts[primaryIdx];
    const V = nNum(S.points[primaryIdx].V);
    G_ref = V * a.rho / (1 + a.W);
  } else if (sts[0]) {
    G_ref = S.vBase * sts[0].rho / (1 + sts[0].W);
  }

  for (let i = 0; i < S.points.length - 1; i++) {
    const a = sts[i], b = sts[i+1];
    if (!a || !b) { segs.push(null); continue; }
    const pr = S.procs[i] || { type: 'P' };
    const userV = nNum(S.points[i].V);
    const hasOwnV = i === primaryIdx && Number.isFinite(userV) && userV > 0;
    let V;
    if (hasOwnV) {
      V = userV;
    } else if (G_ref > 0) {
      V = G_ref * (1 + a.W) / a.rho;   // derived от массы
    } else {
      V = S.vBase;
    }
    const G  = V * a.rho / (1 + a.W);
    const Q  = processPowerKW(a, b, V);
    const qw = processMoistureKgH(a, b, V);
    segs.push({
      type: pr.type, V, Q, qw, G,
      derived: !hasOwnV,
      dT: +(b.T - a.T).toFixed(2),
      dW: +((b.W - a.W)*1000).toFixed(3),
      dh: +(b.h - a.h).toFixed(2),
    });
  }
  return { sts, segs, primaryIdx };
}

/* ========================================================================
   Рендер результатов
   ======================================================================== */
function renderResults(sts, segs) {
  const b1 = $('psy-output-body'); b1.innerHTML = '';
  sts.forEach((st, i) => {
    const name = S.points[i].name || `P${i+1}`;
    const warn = st && st.RH > S.rhMax + 0.1
      ? ` style="background:#ffebee;color:#c62828;"` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td${warn}>${i+1}</td><td>${escHtml(name)}</td>
      ${st ? `
        <td>${st.T.toFixed(1)}</td>
        <td>${st.RH.toFixed(1)}</td>
        <td>${(st.W*1000).toFixed(2)}</td>
        <td>${st.h.toFixed(2)}</td>
        <td>${st.rho.toFixed(3)}</td>
        <td>${st.v.toFixed(4)}</td>
        <td>${st.Td.toFixed(1)}</td>
        <td>${st.Twb.toFixed(1)}</td>
      ` : `<td colspan="8" style="text-align:center;color:#999">—</td>`}
    `;
    b1.appendChild(tr);
  });

  const b2 = $('psy-proc-body'); b2.innerHTML = '';
  let sumQheat = 0, sumQcool = 0, sumQwHum = 0, sumQwDeh = 0;
  segs.forEach((s) => {
    if (!s) return;
    if (s.Q > 0)  sumQheat += s.Q;
    if (s.Q < 0)  sumQcool += -s.Q;
    if (s.qw > 0) sumQwHum += s.qw;
    if (s.qw < 0) sumQwDeh += -s.qw;
  });
  segs.forEach((s, i) => {
    if (!s) {
      b2.insertAdjacentHTML('beforeend',
        `<tr><td>${i+1}→${i+2}</td><td colspan="9" style="text-align:center;color:#999">—</td></tr>`);
      return;
    }
    const label = PROC_TYPES.find(p => p.v === s.type)?.t || s.type;
    const sign  = s.Q > 0.05 ? 'нагрев/увл.' : s.Q < -0.05 ? 'охл./осуш.' : '≈0';
    b2.insertAdjacentHTML('beforeend', `
      <tr style="background:${PROC_COLOR[s.type]||'#eee'}14">
        <td>${i+1}→${i+2}</td><td>${label}</td>
        <td>${s.V.toFixed(0)}</td>
        <td>${s.dT.toFixed(2)}</td>
        <td>${s.dW.toFixed(3)}</td>
        <td>${s.dh.toFixed(2)}</td>
        <td>${s.G.toFixed(0)}</td>
        <td style="color:${s.Q>0?'#c62828':'#0277bd'};font-weight:600">${s.Q.toFixed(2)}</td>
        <td style="color:${s.qw>0?'#2e7d32':'#6a1b9a'}">${s.qw.toFixed(3)}</td>
        <td style="font-size:10px;color:#555">${sign}</td>
      </tr>
    `);
  });
  // Итоговая строка: суммы Q (нагрев / охл) и qw (увл / осуш)
  const anyProc = segs.some(s => s);
  if (anyProc) {
    b2.insertAdjacentHTML('beforeend', `
      <tr style="background:#eceff1;font-weight:700;border-top:2px solid #90a4ae">
        <td colspan="7" style="text-align:right;color:#37474f">ИТОГО по циклу:</td>
        <td style="color:#c62828" title="Суммарная мощность нагрева/увл. (Q>0)">
          +${sumQheat.toFixed(2)}<br><span style="font-weight:400;font-size:10px;color:#0277bd">−${sumQcool.toFixed(2)}</span>
        </td>
        <td style="color:#2e7d32" title="Суммарный влагоприток (qw>0) / осушение (qw<0)">
          +${sumQwHum.toFixed(3)}<br><span style="font-weight:400;font-size:10px;color:#6a1b9a">−${sumQwDeh.toFixed(3)}</span>
        </td>
        <td style="font-size:10px;color:#37474f">нагрев/охл.<br>увл./осуш.</td>
      </tr>
    `);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

/* ========================================================================
   Диаграмма
   ======================================================================== */
let _chartCtx = null;  // {X, Y, opts} последнего рендера — для crosshair
function renderChart(sts) {
  const host = $('psy-chart');
  const { svg, X, Y, opts } = render(null, {
    P: S.P,
    T_min: S.tMinChart, T_max: S.tMaxChart,
    W_max: S.dMaxChart / 1000,
  });
  const ctx = { X, Y };
  _chartCtx = { X, Y, opts };
  let overlay = arrowDefs();
  // crosshair layer (обновляется в mousemove)
  overlay += `<g id="psy-xhair" style="display:none;pointer-events:none;">
    <line class="psy-xh-v" stroke="#c62828" stroke-width="0.6" stroke-dasharray="3,2"/>
    <line class="psy-xh-h" stroke="#c62828" stroke-width="0.6" stroke-dasharray="3,2"/>
    <circle class="psy-xh-dot" r="3" fill="#c62828" stroke="#fff" stroke-width="1"/>
  </g>`;
  // сегменты
  for (let i = 0; i < sts.length - 1; i++) {
    const a = sts[i], b = sts[i+1];
    const pr = S.procs[i] || { type: 'P' };
    if (!a || !b || pr.type === 'none') continue;
    const color = PROC_COLOR[pr.type] || '#0d47a1';
    overlay += drawProcessPath(ctx, a, b, pr.type, color);
    // Штриховая связь с опорной точкой для M/R (визуализация графа)
    if (pr.type === 'M' || pr.type === 'R') {
      const refKey = pr.type === 'M' ? pr.mixWith : pr.recupWith;
      const refIdx = parseInt(refKey, 10);
      if (Number.isFinite(refIdx) && sts[refIdx]) {
        const r = sts[refIdx];
        overlay += `<line x1="${X(r.W)}" y1="${Y(r.T)}" x2="${X(b.W)}" y2="${Y(b.T)}"
                     stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>`;
      }
    }
  }
  sts.forEach((st, i) => {
    if (!st) return;
    overlay += plotPoint(ctx, st, String(i+1), '#0d47a1');
  });
  host.innerHTML = svg.replace('</svg>', overlay + '</svg>');
  // Readout overlay (div над svg)
  let readout = host.querySelector('.psy-xh-readout');
  if (!readout) {
    readout = document.createElement('div');
    readout.className = 'psy-xh-readout';
    readout.style.cssText = 'position:absolute;pointer-events:none;background:rgba(255,255,255,0.95);border:1px solid #c62828;border-radius:3px;padding:3px 6px;font:11px/1.4 Consolas,monospace;color:#263238;display:none;box-shadow:0 1px 3px rgba(0,0,0,0.15);white-space:nowrap;z-index:5;';
    host.style.position = 'relative';
    host.appendChild(readout);
  }
  attachCrosshair(host);
}

function attachCrosshair(host) {
  if (host._xhWired) return;
  host._xhWired = true;
  const onMove = (e) => {
    if (!_chartCtx) return;
    const svg = host.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = vb.width / rect.width, sy = vb.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top)  * sy;
    const { opts } = _chartCtx;
    const plotW = opts.width - opts.marginL - opts.marginR;
    const plotH = opts.height - opts.marginT - opts.marginB;
    // Инвертируем X и Y
    const W = opts.W_min + (px - opts.marginL) / plotW * (opts.W_max - opts.W_min);
    const T = opts.T_max - (py - opts.marginT) / plotH * (opts.T_max - opts.T_min);
    const g = svg.querySelector('#psy-xhair');
    const readout = host.querySelector('.psy-xh-readout');
    // Вне поля графика — скрыть
    if (W < opts.W_min || W > opts.W_max || T < opts.T_min || T > opts.T_max) {
      if (g) g.style.display = 'none';
      if (readout) readout.style.display = 'none';
      return;
    }
    // Обновляем крестик
    if (g) {
      g.style.display = '';
      const v = g.querySelector('.psy-xh-v');
      const h = g.querySelector('.psy-xh-h');
      const d = g.querySelector('.psy-xh-dot');
      v.setAttribute('x1', px); v.setAttribute('x2', px);
      v.setAttribute('y1', opts.marginT); v.setAttribute('y2', opts.marginT + plotH);
      h.setAttribute('y1', py); h.setAttribute('y2', py);
      h.setAttribute('x1', opts.marginL); h.setAttribute('x2', opts.marginL + plotW);
      d.setAttribute('cx', px); d.setAttribute('cy', py);
    }
    // Значения: W -> pv -> phi; h; rho. φ в физическом диапазоне [0..100].
    // Если точка выше линии насыщения — это «перенасыщ.» (нефизично).
    const pv = W * S.P / (0.621945 + W);
    const phi_raw = 100 * pv / Pws(T);
    const phi = Math.max(0, Math.min(100, phi_raw));
    const supersat = phi_raw > 100.5;
    const h_v = 1.006 * T + W * (2501 + 1.86 * T);
    const v_sp = 287.055 * (T + 273.15) * (1 + 1.6078 * W) / S.P;
    const rho = (1 + W) / v_sp;
    const Td = (phi > 0.01) ? dewPointFromW(W, S.P) : -999;
    if (readout) {
      const ru = S.showRuNames;
      const phiStr = supersat
        ? `<span style="color:#c62828">перенасыщ. (выше φ=100%)</span>`
        : `${phi.toFixed(1)} %`;
      readout.innerHTML =
        `<b>t</b>${ru?' (темп.)':''} = ${T.toFixed(1)} °C<br>` +
        `<b>d</b>${ru?' (влагосодерж.)':''} = ${(W*1000).toFixed(2)} г/кг<br>` +
        `<b>φ</b>${ru?' (отн. влажн.)':''} = ${phiStr}<br>` +
        `<b>h</b>${ru?' (энтальпия)':''} = ${h_v.toFixed(2)} кДж/кг<br>` +
        `<b>ρ</b>${ru?' (плотность)':''} = ${rho.toFixed(3)} кг/м³` +
        (Td > -900 && !supersat ? `<br><b>t<sub>р</sub></b>${ru?' (точка росы)':''} = ${Td.toFixed(1)} °C` : '');
      // позиция: смещаем от курсора, учитываем границы
      const hostRect = host.getBoundingClientRect();
      let lx = e.clientX - hostRect.left + 12;
      let ly = e.clientY - hostRect.top + 12;
      readout.style.display = 'block';
      // после display считаем размер
      const rw = readout.offsetWidth, rh = readout.offsetHeight;
      if (lx + rw > hostRect.width - 4)  lx = e.clientX - hostRect.left - rw - 12;
      if (ly + rh > hostRect.height - 4) ly = e.clientY - hostRect.top - rh - 12;
      readout.style.left = lx + 'px';
      readout.style.top  = ly + 'px';
    }
  };
  const onLeave = () => {
    const svg = host.querySelector('svg');
    const g = svg && svg.querySelector('#psy-xhair');
    if (g) g.style.display = 'none';
    const readout = host.querySelector('.psy-xh-readout');
    if (readout) readout.style.display = 'none';
  };
  host.addEventListener('mousemove', onMove);
  host.addEventListener('mouseleave', onLeave);
}

/* Промежуточные точки, чтобы линия процесса шла по реалистичной траектории */
function drawProcessPath(ctx, a, b, type, color) {
  const { X, Y } = ctx;
  const pts = [[X(a.W), Y(a.T)]];
  if (type === 'P') {
    // d = const, прямая по W=const (вертикаль в Wxx координатах)
    pts.push([X(a.W), Y(b.T)]);
  } else if (type === 'A') {
    // h = const → t(W) = (h - 2501·W)/(1.006+1.86·W). Интерполируем.
    const h = a.h;
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
      const W = a.W + (b.W - a.W) * (k/steps);
      const t = (h - 2501*W) / (1.006 + 1.86*W);
      pts.push([X(W), Y(t)]);
    }
  } else if (type === 'S') {
    // t ≈ const
    pts.push([X(b.W), Y(a.T)]);
  } else if (type === 'M') {
    // Смешение: прямая от a к b (линия смеси — отрезок на плоскости)
    pts.push([X(b.W), Y(b.T)]);
  } else if (type === 'R') {
    // Рекуператор: d=const (W=const), по вертикали до b.T
    pts.push([X(a.W), Y(b.T)]);
  } else if (type === 'C') {
    // охлаждение с осушением: если dW < 0 — сначала по W=const до tр, затем по φ=100%
    if (b.W < a.W - 1e-6) {
      const Tdew = a.Td;
      pts.push([X(a.W), Y(Tdew)]);
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        const T = Tdew + (b.T - Tdew) * (k/steps);
        const W = humidityRatio(T, 1.0, a.P);
        pts.push([X(W), Y(T)]);
      }
    } else {
      pts.push([X(b.W), Y(b.T)]);  // сухое охлаждение
    }
  }
  // конец
  pts.push([X(b.W), Y(b.T)]);
  return `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none"
           stroke="${color}" stroke-width="2.2" stroke-linejoin="round"
           marker-end="url(#arrow-${type})"/>`;
}

/* ========================================================================
   Формулы и пояснение
   ======================================================================== */
function renderFormulas() {
  $('psy-formulas').innerHTML = `
    <h4>1. Атмосферное давление на высоте</h4>
    <div class="f-row"><code>P(h) = P<sub>0</sub>·(1 − 2,25577·10⁻⁵·h)<sup>5,2559</sup></code>
      <span>Международная стандартная атмосфера (ISA / ГОСТ 4401-81). P<sub>0</sub> = 101 325 Па.
      Давление влияет на d, ρ, ось абсолютной влажности и φ = Pпар/Pнас.</span></div>

    <h4>2. Давление насыщения Pₙ(t) — Hyland–Wexler 1983 (ASHRAE Fundamentals 2021)</h4>
    <div class="f-row"><code>ln P<sub>ws</sub> = C<sub>8</sub>/T + C<sub>9</sub> + C<sub>10</sub>T + C<sub>11</sub>T² + C<sub>12</sub>T³ + C<sub>13</sub>lnT</code>
      <span>Для T ≥ 273,15 К (вода). Для льда — другой полином. Более точная формулировка, чем Magnus/СП 50.13330.</span></div>

    <h4>3. Парциальное давление пара и влагосодержание</h4>
    <div class="f-row"><code>Pпар = φ·Pₙ(t)</code>
      <span>φ [0..1] — относительная влажность.</span></div>
    <div class="f-row"><code>d = 621,945 · Pпар / (Pатм − Pпар)   [г воды / кг сух. возд.]</code>
      <span>621,945 = 1000·Mвода/Mвоздух = 1000·18,015/28,966. ASHRAE стандарт.</span></div>
    <div class="f-row"><code>φ = d·Pатм / [Pₙ(t)·(621,945 + d)]</code>
      <span>Обратная формула — если задано d (override).</span></div>

    <h4>4. Энтальпия влажного воздуха</h4>
    <div class="f-row"><code>h = 1,006·t + d/1000·(2501 + 1,86·t)   [кДж/кг сух. возд.]</code>
      <span>1,006 — теплоёмкость сух. воздуха; 2501 — теплота парообразования при 0 °C; 1,86 — теплоёмкость пара.</span></div>

    <h4>5. Плотность и удельный объём</h4>
    <div class="f-row"><code>v = R<sub>a</sub>·T·(1 + 1,6078·W) / P,  R<sub>a</sub> = 287,055 Дж/(кг·К)</code>
      <span>Удельный объём на 1 кг сух. возд.</span></div>
    <div class="f-row"><code>ρ = (1 + W) / v</code>
      <span>Плотность влажного воздуха.</span></div>

    <h4>6. Температура точки росы и мокрого термометра</h4>
    <div class="f-row"><code>t<sub>р</sub>: решение Pₙ(t<sub>р</sub>) = Pпар</code>
      <span>Ньютон-итерация с начальным приближением Magnus. При t<sub>р</sub> выпадает конденсат.</span></div>
    <div class="f-row"><code>W = [(2501 − 2,326·t<sub>м</sub>)·Wₛ(t<sub>м</sub>) − 1,006·(t − t<sub>м</sub>)] / (2501 + 1,86·t − 4,186·t<sub>м</sub>)</code>
      <span>Психрометрическое уравнение. t<sub>м</sub> ищется итеративно (ASHRAE).</span></div>

    <h4>7. Процессы между точками</h4>
    <div class="f-row"><code>P (нагрев):  d=const, Δh = 1,006·Δt + 1,86·d/1000·Δt  →  Q > 0</code>
      <span>Паспортные электрические / водяные калориферы. Сенсибельная нагрузка.</span></div>
    <div class="f-row"><code>C (охлаждение/осушение): до t<sub>р</sub> d=const, затем по φ=100% к t<sub>коил</sub></code>
      <span>Если температура ниже точки росы — выпадает конденсат, Δd &lt; 0, Q &lt; 0 (полная нагрузка = сенсибельная + латентная).</span></div>
    <div class="f-row"><code>A (адиабат. увл.):  h=const, d растёт → t падает</code>
      <span>Форсуночные камеры, сотовые испарители. Предел — t<sub>м</sub> (насыщение по линии h=const).</span></div>
    <div class="f-row"><code>S (паровое увл.):  t≈const, d растёт</code>
      <span>Паровые увлажнители. Приблизительно изотермический процесс (пар при 100 °C даёт малое приращение t).</span></div>
    <div class="f-row"><code>X (произвольный):  просто соединяет две точки</code>
      <span>Для рециркуляции/смешения или произвольных переходов.</span></div>

    <h4>8. Тепловая мощность и влагоприток процесса</h4>
    <div class="f-row"><code>G<sub>да</sub> = V · ρ<sub>да</sub> = V · ρ / (1 + W)   [кг/ч]</code>
      <span>Массовый расход сух. воздуха. V — объёмный расход м³/ч.</span></div>
    <div class="f-row"><code>Q = G<sub>да</sub>/3600 · Δh   [кВт]</code>
      <span>Полная тепловая нагрузка (сенсибельная + латентная). Δh в кДж/кг.</span></div>
    <div class="f-row"><code>q<sub>w</sub> = G<sub>да</sub> · ΔW   [кг/ч]</code>
      <span>Массовый влагоприток/осушение. ΔW в кг/кг.</span></div>

    <div class="note">Точность: Hyland-Wexler + ASHRAE-формы обеспечивают ±0,1% в диапазоне −40…+50 °C. Ниже −20 °C — используется ветка над льдом.</div>
  `;
}

/* ========================================================================
   Демо-циклы и действия
   ======================================================================== */
function loadDemo() {
  S.alt = 0; S.P = 101325; S.rhMax = 100; S.tEvap = 15; S.vBase = 10000;
  const now = performance.now();
  S.points = [
    { name: 'Лето наружный',  nameUser: true, t: 35, tUser: true, tTs: now, rh: 50, rhUser: true, rhTs: now, x: '', h: '', V: '' },
    { name: '',               t: 14, tUser: true, tTs: now+1, rh: '', x: '', h: '', V: '' },
    { name: '',               t: 22, tUser: true, tTs: now+2, rh: '', x: '', h: '', V: '' },
  ];
  S.procs = [ { type:'C', Q:'', qw:'' }, { type:'P', Q:'', qw:'' } ];
  syncTopInputs();
  renderCycle();
  update();
}

function syncTopInputs() {
  $('psy-alt').value    = S.alt;
  $('psy-P-kpa').value  = (S.P/1000).toFixed(3);
  $('psy-rhmax').value  = S.rhMax;
  $('psy-tevap').value  = S.tEvap;
  $('psy-vbase').value  = S.vBase;
  if ($('psy-tmin-chart')) $('psy-tmin-chart').value = S.tMinChart;
  if ($('psy-tmax-chart')) $('psy-tmax-chart').value = S.tMaxChart;
  if ($('psy-dmax-chart')) $('psy-dmax-chart').value = S.dMaxChart;
}

/* ========================================================================
   Main
   ======================================================================== */
/* Полный пересчёт БЕЗ пересоздания inputs (чтобы не терять фокус). */
function update() {
  readInputs();
  cascade();                  // авто-имена + forward-compute точек по цели процесса
  fillComputedDH();           // для каждой точки: если d/h не user — вписываем вычисленное
  writeCardsFromState();      // пушим S → DOM для auto-полей без user-флага
  refreshComputedInCards();
  const { sts, segs, primaryIdx } = computeCycle();
  refreshAutoV(segs, primaryIdx);
  renderResults(sts, segs);
  renderChart(sts);
  saveCycle();
}

/* ========================================================================
   Persistence — весь цикл в localStorage (psy.cycle.v1)
   ======================================================================== */
const LS_KEY = 'psy.cycle.v1';
let _saveTimer = null;
function saveCycle() {
  if (_saveTimer) return;             // debounce 300ms
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const payload = {
        v: 1,
        alt: S.alt, P: S.P, rhMax: S.rhMax, tEvap: S.tEvap, vBase: S.vBase,
        tMinChart: S.tMinChart, tMaxChart: S.tMaxChart, dMaxChart: S.dMaxChart,
        points: S.points, procs: S.procs,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }, 300);
}
function loadCycle() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || !Array.isArray(o.points) || !Array.isArray(o.procs)) return false;
    if (Number.isFinite(o.alt))   S.alt   = o.alt;
    if (Number.isFinite(o.P))     S.P     = o.P;
    if (Number.isFinite(o.rhMax)) S.rhMax = o.rhMax;
    if (Number.isFinite(o.tEvap)) S.tEvap = o.tEvap;
    if (Number.isFinite(o.vBase)) S.vBase = o.vBase;
    if (Number.isFinite(o.tMinChart)) S.tMinChart = o.tMinChart;
    if (Number.isFinite(o.tMaxChart)) S.tMaxChart = o.tMaxChart;
    if (Number.isFinite(o.dMaxChart)) S.dMaxChart = o.dMaxChart;
    S.points = o.points;
    S.procs  = o.procs;
    return true;
  } catch { return false; }
}
/* Пересоздание цикла (добавить/удалить точку / загрузка демо). */
function rerenderCycle() {
  renderCycle();
  update();
}

function wire() {
  loadCycle();                // восстановить цикл из localStorage до синка UI
  syncTopInputs();
  renderFormulas();
  renderCycle();
  update();

  // Верхние поля
  ['psy-alt','psy-P-kpa','psy-rhmax','psy-tevap','psy-vbase','psy-tmin-chart','psy-tmax-chart','psy-dmax-chart'].forEach(id => {
    $(id).addEventListener('input', update);
    $(id).addEventListener('change', update);
  });

  // Переключатель русских названий
  const ruCb = $('psy-ru-names');
  if (ruCb) {
    ruCb.checked = !!S.showRuNames;
    ruCb.addEventListener('change', () => {
      S.showRuNames = ruCb.checked;
      try { localStorage.setItem('psy.showRuNames', S.showRuNames ? '1' : '0'); } catch {}
      rerenderCycle();
    });
  }

  // Делегирование событий в зоне цикла.
  // Любой РЕАЛЬНЫЙ ввод в текстовые/числовые поля помечает поле как
  // пользовательский ввод (data-user="1"), чтобы cascade не затирал его.
  $('psy-cycle').addEventListener('input', (e) => {
    const col = e.target?.dataset?.col;
    if (col && ['V','name','t','rh','x','h','Q','qw'].includes(col)) {
      e.target.dataset.user = '1';
      e.target.dataset.ts = String(performance.now());
    }
    update();
  });
  $('psy-cycle').addEventListener('change', (e) => {
    const col = e.target?.dataset?.col;
    // Смена типа процесса → перерисовка (поля смешения появляются/уходят)
    if (col === 'proc-type') {
      const i = +e.target.dataset.i;
      S.procs[i] = S.procs[i] || {};
      S.procs[i].type = e.target.value;
      rerenderCycle();
      return;
    }
    update();
  });
  // Blur с пустым значением → снимаем user-флаг (поле снова auto)
  $('psy-cycle').addEventListener('blur', (e) => {
    const col = e.target?.dataset?.col;
    if (!col) return;
    if (['V','t','rh','x','h','Q','qw'].includes(col) && e.target.value.trim() === '') {
      e.target.dataset.user = '';
      e.target.dataset.ts = '0';
      update();
    }
  }, true);
  $('psy-cycle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="del"]');
    if (!b) return;
    const i = +b.dataset.i;
    S.points.splice(i, 1);
    if (i < S.procs.length) S.procs.splice(i, 1);
    else if (S.procs.length) S.procs.pop();
    rerenderCycle();
  });

  $('psy-add').addEventListener('click', () => {
    S.points.push({ name:'', t:'', rh:'', x:'', h:'', V:'' });
    S.procs.push({ type: 'X', Q:'', qw:'' });
    rerenderCycle();
  });
  $('psy-clear').addEventListener('click', () => {
    const now = performance.now();
    S.points = [{ name:'Точка 1', nameUser:true, t: 22, tUser:true, tTs: now, rh: 50, rhUser:true, rhTs: now, x: '', h:'', V: '' }];
    S.procs = [];
    rerenderCycle();
  });
  $('psy-demo').addEventListener('click', loadDemo);
  const btnCsv = $('psy-csv');
  if (btnCsv) btnCsv.addEventListener('click', exportCsv);
}

/* Экспорт точек и процессов в CSV (UTF-8 BOM, ';' — для Excel-RU). */
function exportCsv() {
  const { sts, segs } = computeCycle();
  const sep = ';';
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(`# i-d диаграмма — экспорт ${new Date().toISOString().slice(0,19).replace('T',' ')}`);
  lines.push(`# P = ${(S.P/1000).toFixed(3)} кПа; alt = ${S.alt} м; rhMax = ${S.rhMax}%; V_base = ${S.vBase} м³/ч`);
  lines.push('');
  lines.push('## Точки');
  lines.push(['№','Имя','t,°C','φ,%','d,г/кг','h,кДж/кг','ρ,кг/м³','v,м³/кг','tр,°C','tм,°C'].join(sep));
  sts.forEach((st, i) => {
    if (!st) { lines.push([i+1, q(S.points[i]?.name||''), '—','—','—','—','—','—','—','—'].join(sep)); return; }
    lines.push([
      i+1, q(S.points[i]?.name||''),
      st.T.toFixed(2), st.RH.toFixed(1),
      (st.W*1000).toFixed(3), st.h.toFixed(2),
      st.rho.toFixed(3), st.v.toFixed(4),
      st.Td.toFixed(2), st.Twb.toFixed(2),
    ].map(x => String(x).replace('.', ',')).join(sep));
  });
  lines.push('');
  lines.push('## Процессы');
  lines.push(['№','Тип','V,м³/ч','ΔT,°C','Δd,г/кг','Δh,кДж/кг','Gда,кг/ч','Q,кВт','qw,кг/ч'].join(sep));
  let sQh=0,sQc=0,sWh=0,sWd=0;
  segs.forEach((s, i) => {
    if (!s) { lines.push([`${i+1}→${i+2}`, '—','','','','','','',''].join(sep)); return; }
    if (s.Q>0) sQh += s.Q; else sQc += -s.Q;
    if (s.qw>0) sWh += s.qw; else sWd += -s.qw;
    const label = PROC_TYPES.find(p=>p.v===s.type)?.t || s.type;
    lines.push([
      `${i+1}→${i+2}`, q(label),
      s.V.toFixed(0), s.dT.toFixed(2), s.dW.toFixed(3), s.dh.toFixed(2),
      s.G.toFixed(0), s.Q.toFixed(2), s.qw.toFixed(3),
    ].map(x => String(x).replace('.', ',')).join(sep));
  });
  lines.push('');
  lines.push(['ИТОГО', '', '', '', '', '', '',
              `нагрев: +${sQh.toFixed(2)} / охл: −${sQc.toFixed(2)}`,
              `увл: +${sWh.toFixed(3)} / осуш: −${sWd.toFixed(3)}`].join(sep));
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `id-diagram-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

document.addEventListener('DOMContentLoaded', wire);
