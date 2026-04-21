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
  RHO_NORMAL,
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
  points: [
    { name: 'Наружный (зима)', t: -20, rh: 85, x: '', V: '' },
    { name: 'После калорифера', t: 22,  rh: 18, x: '', V: '' },
    { name: 'После увлажн.',    t: 18,  rh: 45, x: '', V: '' },
  ],
  procs: [
    { type: 'P' },    // 1→2 нагрев
    { type: 'A' },    // 2→3 адиабат. увл.
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
  el.innerHTML = `
    <div class="psy-point-header">
      <span>Точка ${i+1}</span>
      <button type="button" class="pt-del" title="Удалить точку" data-act="del" data-i="${i}">✕</button>
    </div>
    <label>Имя<input type="text" data-col="name" data-i="${i}" value="${escAttr(p.name || '')}"></label>
    <label>t, °C<input type="number" data-col="t" data-i="${i}" value="${p.t ?? ''}" step="0.1"></label>
    <label>φ, %<input type="number" data-col="rh" data-i="${i}" value="${p.rh ?? ''}" step="1" min="0" max="100"></label>
    <label>d (override), г/кг<input type="number" data-col="x" data-i="${i}" value="${p.x ?? ''}" step="0.1" placeholder="авто из φ"></label>
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
  el.innerHTML = `
    <div class="arr-label">${i+1} → ${i+2}</div>
    <select data-col="proc-type" data-i="${i}">
      ${PROC_TYPES.map(pt => `<option value="${pt.v}" ${pr.type===pt.v?'selected':''}>${pt.t}</option>`).join('')}
    </select>
    <div class="arr" data-role="arr" style="color:${PROC_COLOR[pr.type]||'#607080'}">↓</div>
    <label style="font-size:10px;color:#666">V процесса, м³/ч
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
    if (col === 'proc-type') { S.procs[i] = S.procs[i] || {}; S.procs[i].type = v; }
    else if (col === 'V')    {
      S.points[i] = S.points[i] || {};
      // Только если пользователь реально ввёл значение (data-user="1") —
      // считаем его ведущим. Иначе — это просто отображение автосчитанного V.
      if (el.dataset.user === '1' && v !== '') S.points[i].V = v;
      else S.points[i].V = '';
    }
    else if (col === 'name') { S.points[i] = S.points[i] || {}; S.points[i].name = v; }
    else                     { S.points[i] = S.points[i] || {}; S.points[i][col] = v; }
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
function renderChart(sts) {
  const host = $('psy-chart');
  const { svg, X, Y } = render(null, { P: S.P });
  const ctx = { X, Y };
  let overlay = arrowDefs();
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
    { name: 'Лето наружный',  t: 35, rh: 50, x: '', V: '' },
    { name: 'После охл./осуш.', t: 14, rh: 97, x: '', V: '' },
    { name: 'После доводчика',  t: 22, rh: 48, x: '', V: '' },
  ];
  S.procs = [ { type:'C' }, { type:'P' } ];
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

  // Делегирование событий в зоне цикла
  $('psy-cycle').addEventListener('input', (e) => {
    // Помечаем V-поле как user-ввод только при реальном вводе
    if (e.target?.dataset?.col === 'V') e.target.dataset.user = '1';
    update();
  });
  $('psy-cycle').addEventListener('change', update);
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
    S.procs.push({ type: 'X' });
    rerenderCycle();
  });
  $('psy-clear').addEventListener('click', () => {
    S.points = [{ name:'Точка 1', t: 22, rh: 50, x:'', V:'' }];
    S.procs = [];
    rerenderCycle();
  });
  $('psy-demo').addEventListener('click', loadDemo);
}

document.addEventListener('DOMContentLoaded', wire);
