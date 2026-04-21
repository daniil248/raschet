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
  showRuNames: (() => { try { return localStorage.getItem('psy.showRuNames') === '1'; } catch { return false; } })(),
  points: [
    { name: 'Наружный (зима)', nameUser: true, t: -20, tUser: true, rh: 85, rhUser: true, x: '', V: '' },
    { name: 'После калорифера', t: 22, tUser: true, rh: 18, rhUser: true, x: '', V: '' },
    { name: 'После увлажн.',    t: 18, tUser: true, rh: 45, rhUser: true, x: '', V: '' },
  ],
  procs: [
    { type: 'P', tgt: '', tgtVal: '' },    // 1→2 нагрев
    { type: 'A', tgt: '', tgtVal: '' },    // 2→3 адиабат. увл.
  ],
};

const PROC_TYPES = [
  { v: 'none', t: '— (разрыв)'                            },
  { v: 'P',    t: 'P · нагрев (d=const)'                  },
  { v: 'C',    t: 'C · охлаждение / осушение'             },
  { v: 'A',    t: 'A · адиабат. увл. (h=const)'           },
  { v: 'S',    t: 'S · паровое увл. (t=const)'            },
  { v: 'X',    t: 'X · произвольный'                      },
];

const PROC_COLOR = {
  none: '#b0bec5', P: '#e65100', C: '#0277bd', A: '#2e7d32', S: '#6a1b9a', X: '#424242',
};

/* Авто-имя исходящей точки из типа предыдущего процесса */
const PROC_NAME_OUT = {
  P: 'После нагревателя',
  C: 'После охл./осуш.',
  A: 'После адиабат. увл.',
  S: 'После пар. увл.',
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
function nNum(v, d=NaN) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Расчёт state для точки с учётом override по d (x в г/кг) */
function pointState(p, P) {
  const t  = nNum(p.t);
  let rh   = nNum(p.rh);
  const xG = nNum(p.x); // override d в г/кг
  if (!Number.isFinite(t)) return null;
  if (Number.isFinite(xG)) {
    const W = xG / 1000;
    const rhFromX = clamp(100 * W * P / (0.621945 + W) / Pws(t), 0, 200);
    return state(t, rhFromX / 100, P);
  }
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
  const ru = S.showRuNames;
  const L = {
    t:   `t, °C${ru?' <em style="color:#90a4ae;font-style:normal">(температура)</em>':''}`,
    rh:  `φ, %${ru?' <em style="color:#90a4ae;font-style:normal">(отн. влажн.)</em>':''}`,
    d:   `d (override), г/кг${ru?' <em style="color:#90a4ae;font-style:normal">(влагосодерж.)</em>':''}`,
  };
  el.innerHTML = `
    <div class="psy-point-header">
      <span>Точка ${i+1}</span>
      <button type="button" class="pt-del" title="Удалить точку" data-act="del" data-i="${i}">✕</button>
    </div>
    <label>Имя<input type="text" data-col="name" data-i="${i}" data-user="${du('name')}" value="${escAttr(p.name || '')}"></label>
    <label>${L.t}<input type="number" data-col="t" data-i="${i}" data-user="${du('t')}" value="${p.t ?? ''}" step="0.1"></label>
    <label>${L.rh}<input type="number" data-col="rh" data-i="${i}" data-user="${du('rh')}" value="${p.rh ?? ''}" step="1" min="0" max="100"></label>
    <label>${L.d}<input type="number" data-col="x" data-i="${i}" data-user="${du('x')}" value="${p.x ?? ''}" step="0.1" placeholder="авто из φ"></label>
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
  const tgt = pr.tgt || '';
  const tgtUnit = PROC_TARGETS.find(x => x.v === tgt)?.u || '';
  el.innerHTML = `
    <div class="arr-label">${i+1} → ${i+2}</div>
    <select data-col="proc-type" data-i="${i}">
      ${PROC_TYPES.map(pt => `<option value="${pt.v}" ${pr.type===pt.v?'selected':''}>${pt.t}</option>`).join('')}
    </select>
    <div class="arr" data-role="arr" style="color:${PROC_COLOR[pr.type]||'#607080'}">↓</div>
    <label style="font-size:10px;color:#666;margin-top:4px">цель процесса
      <select data-col="tgt" data-i="${i}">
        ${PROC_TARGETS.map(pt => `<option value="${pt.v}" ${tgt===pt.v?'selected':''}>${pt.t}${pt.u?' ('+pt.u+')':''}</option>`).join('')}
      </select>
    </label>
    <input type="number" data-col="tgtVal" data-i="${i}" value="${pr.tgtVal ?? ''}"
      step="0.1" placeholder="${tgt ? 'значение '+tgtUnit : 'нет цели'}"
      ${tgt ? '' : 'disabled'} style="margin-top:2px">
    <label style="font-size:10px;color:#666;margin-top:4px">V процесса, м³/ч
      <input type="number" data-col="V" data-i="${i}" data-user="${hasUserV?'1':''}" value="${hasUserV?userV:''}" step="100">
      <span class="v-auto" data-role="v-auto" style="font-size:10px;color:#2e7d32;display:block;margin-top:2px;"></span>
    </label>
  `;
  return el;
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
      computed.innerHTML = `<span style="color:#c62828">Нет данных: укажите t и φ (или d).</span>`;
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
  S.alt    = nNum($('psy-alt').value, 0);
  // Если пользователь сам меняет кПа — берём его; иначе высоту
  const altActive = document.activeElement?.id === 'psy-alt';
  const pActive   = document.activeElement?.id === 'psy-P-kpa';
  if (altActive || !pActive) {
    S.P = pressureAtAltitude(S.alt);
    $('psy-P-kpa').value = (S.P/1000).toFixed(3);
  } else {
    S.P = nNum($('psy-P-kpa').value, 101.325) * 1000;
  }
  S.rhMax  = nNum($('psy-rhmax').value, 100);
  S.tEvap  = nNum($('psy-tevap').value, 15);
  S.vBase  = nNum($('psy-vbase').value, 10000);

  $$('#psy-cycle [data-col]').forEach(el => {
    const col = el.dataset.col;
    const i   = +el.dataset.i;
    const v   = el.value;
    const isUser = el.dataset.user === '1';
    if (col === 'proc-type') { S.procs[i] = S.procs[i] || {}; S.procs[i].type = v; }
    else if (col === 'tgt')    { S.procs[i] = S.procs[i] || {}; S.procs[i].tgt = v; }
    else if (col === 'tgtVal') { S.procs[i] = S.procs[i] || {}; S.procs[i].tgtVal = v; }
    else if (col === 'V')    {
      S.points[i] = S.points[i] || {};
      // Только если пользователь реально ввёл значение (data-user="1") —
      // считаем его ведущим. Иначе — это просто отображение автосчитанного V.
      if (isUser && v !== '') S.points[i].V = v;
      else S.points[i].V = '';
    }
    else if (col === 'name' || col === 't' || col === 'rh' || col === 'x') {
      // data-user определяет, был ли ввод пользовательским. Если да — сохраняем
      // значение и поднимаем <col>User=true. Если нет — это DOM-отражение
      // авто-вычисленного, не трогаем S.points[i][col] (его задал cascade).
      S.points[i] = S.points[i] || {};
      if (isUser) { S.points[i][col] = v; S.points[i][col + 'User'] = true; }
      else        { S.points[i][col + 'User'] = false; }
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

  /* 4. Специальная логика C (охлаждение с осушением) */
  if (proc.type === 'C') {
    if (W2 == null && t2 != null) {
      // если t2 ниже точки росы a — идём по φ=100% (с осушением)
      if (t2 < a.Td - 0.05) W2 = humidityRatio(t2, 1.0, P);
      else W2 = a.W;   // сухое охлаждение
    }
    if (t2 == null && W2 != null) {
      // если W2 < a.W — это осушение; t2 = температура насыщения при этом W
      if (W2 < a.W - 1e-6) t2 = dewPointFromW(W2, P);
      else t2 = a.T; // нечего делать
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
    // Forward-compute если задана цель и точка i-1 валидна
    const aState = pointState(S.points[i-1], S.P);
    if (!aState) continue;
    if (proc.tgt && proc.tgtVal !== '' && proc.tgtVal != null) {
      // V сегмента: если у i-1 задан user V — используем, иначе через S.vBase
      let V_seg = nNum(S.points[i-1].V);
      if (!(V_seg > 0)) {
        // для простоты используем базовый (cascade до mass-balance)
        V_seg = S.vBase;
      }
      const bState = forwardPoint(aState, proc, V_seg, S.P);
      if (bState) {
        // Записываем в S.points[i] computed t/rh/x (без user-флага)
        if (!p.tUser)  p.t  = Number(bState.T.toFixed(2));
        if (!p.rhUser) p.rh = Number(bState.RH.toFixed(2));
        if (!p.xUser)  p.x  = '';   // расчёт идёт от φ, override чистим
      }
    }
  }
}

/* Записывает S.points значения в DOM input'ы (только auto-поля). */
function writeCardsFromState() {
  S.points.forEach((p, i) => {
    const card = document.querySelector(`.psy-point[data-point-idx="${i}"]`);
    if (!card) return;
    ['name','t','rh','x'].forEach(col => {
      const inp = card.querySelector(`[data-col="${col}"]`);
      if (!inp) return;
      const isUser = inp.dataset.user === '1';
      if (isUser) return;  // не перезаписываем ввод пользователя
      if (document.activeElement === inp) return;
      const v = p[col];
      inp.value = (v == null || v === '') ? '' : String(v);
    });
  });
  // Обновляем placeholder и состояние tgtVal/tgt у стрелок
  S.procs.forEach((pr, i) => {
    const arr = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"]`);
    if (!arr) return;
    const tgt = pr.tgt || '';
    const tgtInp = arr.querySelector('input[data-col="tgtVal"]');
    if (tgtInp) {
      if (tgt === '') { tgtInp.disabled = true; tgtInp.placeholder = 'нет цели'; }
      else {
        tgtInp.disabled = false;
        const u = PROC_TARGETS.find(x => x.v === tgt)?.u || '';
        tgtInp.placeholder = 'значение ' + u;
      }
    }
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
  const { svg, X, Y, opts } = render(null, { P: S.P });
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
    // Значения: W -> pv -> phi; h; rho
    const pv = W * S.P / (0.621945 + W);
    const phi = Math.max(0, Math.min(200, 100 * pv / Pws(T)));
    const h_v = 1.006 * T + W * (2501 + 1.86 * T);
    const v_sp = 287.055 * (T + 273.15) * (1 + 1.6078 * W) / S.P;
    const rho = (1 + W) / v_sp;
    const Td = (phi > 0.01) ? dewPointFromW(W, S.P) : -999;
    if (readout) {
      const ru = S.showRuNames;
      readout.innerHTML =
        `<b>t</b>${ru?' (темп.)':''} = ${T.toFixed(1)} °C<br>` +
        `<b>d</b>${ru?' (влагосодерж.)':''} = ${(W*1000).toFixed(2)} г/кг<br>` +
        `<b>φ</b>${ru?' (отн. влажн.)':''} = ${phi.toFixed(1)} %<br>` +
        `<b>h</b>${ru?' (энтальпия)':''} = ${h_v.toFixed(2)} кДж/кг<br>` +
        `<b>ρ</b>${ru?' (плотность)':''} = ${rho.toFixed(3)} кг/м³` +
        (Td > -900 ? `<br><b>t<sub>р</sub></b>${ru?' (точка росы)':''} = ${Td.toFixed(1)} °C` : '');
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
  S.points = [
    { name: 'Лето наружный',  nameUser: true, t: 35, tUser: true, rh: 50, rhUser: true, x: '', V: '' },
    { name: 'После охл./осуш.', t: 14, tUser: true, rh: 97, rhUser: true, x: '', V: '' },
    { name: 'После доводчика',  t: 22, tUser: true, rh: 48, rhUser: true, x: '', V: '' },
  ];
  S.procs = [ { type:'C', tgt:'', tgtVal:'' }, { type:'P', tgt:'', tgtVal:'' } ];
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
}

/* ========================================================================
   Main
   ======================================================================== */
/* Полный пересчёт БЕЗ пересоздания inputs (чтобы не терять фокус). */
function update() {
  readInputs();
  cascade();                  // авто-имена + forward-compute точек по цели процесса
  writeCardsFromState();      // пушим S → DOM для auto-полей (t, φ, имя) без user-флага
  refreshComputedInCards();
  const { sts, segs, primaryIdx } = computeCycle();
  refreshAutoV(segs, primaryIdx);
  renderResults(sts, segs);
  renderChart(sts);
}
/* Пересоздание цикла (добавить/удалить точку / загрузка демо). */
function rerenderCycle() {
  renderCycle();
  update();
}

function wire() {
  syncTopInputs();
  renderFormulas();
  renderCycle();
  update();

  // Верхние поля
  ['psy-alt','psy-P-kpa','psy-rhmax','psy-tevap','psy-vbase'].forEach(id => {
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
    if (col && ['V','name','t','rh','x'].includes(col)) {
      e.target.dataset.user = '1';
    }
    update();
  });
  $('psy-cycle').addEventListener('change', (e) => {
    // select (proc-type, tgt) не помечаем user — это мета
    update();
  });
  // Blur на V с пустым значением → снимаем user-флаг (поле снова auto)
  $('psy-cycle').addEventListener('blur', (e) => {
    if (e.target?.dataset?.col === 'V' && e.target.value.trim() === '') {
      e.target.dataset.user = '';
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
    const last = S.points[S.points.length-1];
    S.points.push({ name:'', t: last?.t ?? 22, rh: last?.rh ?? 50, x:'', V:'' });
    S.procs.push({ type: 'X', tgt:'', tgtVal:'' });
    rerenderCycle();
  });
  $('psy-clear').addEventListener('click', () => {
    S.points = [{ name:'Точка 1', nameUser:true, t: 22, tUser:true, rh: 50, rhUser:true, x: '', V: '' }];
    S.procs = [];
    rerenderCycle();
  });
  $('psy-demo').addEventListener('click', loadDemo);
}

document.addEventListener('DOMContentLoaded', wire);
