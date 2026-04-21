/* =========================================================================
   mdc-config.js — Конфигуратор модульного ЦОД (серия GDM-600)
   v0.58.96 (Фаза 10.2+) — торцевые стены 175 мм, рама длинной стороны
   50 мм со стойками 600 мм, фальшпол с центровкой и полуплиткой 300 мм,
   тамбур как настоящий MOD-CORRIDOR, ODU на балконе (3 вида выдува),
   климат/cosφ/загрузка ИБП/резерв масштабирования/Li-ion АКБ,
   АГПТ-трубопровод L-образно в каждом модуле.

   МОДЕЛЬ ДАННЫХ:
     ЦОД = последовательность модулей, пристыкованных длинными сторонами.
     Каждый модуль — 3000×7200 или 2400×7200 мм внутреннего габарита,
     высота 2700 мм от фальшпола. Модули — типовые из каталога
     shared/gdm600-templates.js (10 шаблонов: 2 POWER + 7 IT + 1 коридор).

   Координаты слотов в каждом шаблоне зафиксированы (точки установки
   оборудования), но тип оборудования в каждом слоте может меняться
   в пределах swappable[]. Сетка пола — 600×600 мм.

   ВХОДНЫЕ ДАННЫЕ:
     • количество стоек (SR)
     • мощность на стойку, кВт
     • резервирование, автономия, ASHRAE
     • наличие ТП / ДГУ, слаботочка
   Шаблон IT-модуля подбирается по rackKw, количество модулей —
   по totalRacks. Силовые модули — пара A+B (=1600 кВт), масштабируются.
   ========================================================================= */

import {
  MODULE_TEMPLATES, pickItTemplate, POWER_PAIR, POWER_PAIR_KW,
  countRole, ROLE_COLORS, COMPONENT_SVG, COMPONENT_SPECS,
} from '../shared/gdm600-templates.js';

const $ = (id) => document.getElementById(id);

// ================== КОНСТАНТЫ КОМПОНОВКИ ==================
// Модуль = короб: по короткой стороне — торцевые стены 175 мм (сэндвич).
// По длинной стороне — стены как таковой нет, только рама 50 мм со
// стойками с шагом 600 мм (= шагу фальшпола). Между соседними модулями
// зазор 20 мм. Плитка фальшпола 600×600, отцентрована по центру
// модуля, от фальшпола до внутренней стенки — 5 мм по периметру.
const END_WALL_MM      = 175;  // торцевая стена (короткая сторона)
const FRAME_MM         = 50;   // рама на длинной стороне (со стойками)
const POST_STEP_MM     = 600;  // шаг стоек рамы (= шагу фальшпола)
const CABINET_GAP_MM   = 5;    // зазор шкаф ↔ торцевая стена
const BETWEEN_MODS_MM  = 20;   // зазор между соседними модулями
const FLOOR_TILE_MM    = 600;  // плитка фальшпола
const FLOOR_PERIM_MM   = 5;    // зазор фальшпол ↔ внутренняя стенка

// ================== СОСТОЯНИЕ ==================
const S = {
  totalRacks: 32, rackKw: 10, redundancy: 'N+1',
  autonomyMin: 15, battTech: 'VRLA',
  cosPhi: 0.9, upsLoadPct: 80, scaleReservePct: 20,
  layoutVariant: 'A',
  ashrae: 'A2', tmax: 32, tmin: -28, elev: 200, humidity: 'norm',
  oduType: 'horiz-axial',
  scs: true, skud: true, video: true, fire: true, leak: false,
  withDgu: true, withTp: true,
};

function read() {
  const num = (id, def) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : def; };
  const str = (id, def) => $(id)?.value ?? def;
  const chk = (id)      => !!$(id)?.checked;
  S.totalRacks   = num('mdc-total-racks', 1) || 1;
  S.rackKw       = num('mdc-rack-kw', 10) || 10;
  S.redundancy   = str('mdc-redundancy', 'N+1');
  S.autonomyMin  = num('mdc-autonomy', 15);
  S.battTech     = str('mdc-batt-tech', 'VRLA');
  S.cosPhi       = num('mdc-cosphi', 0.9);
  S.upsLoadPct   = num('mdc-ups-load', 80);
  S.scaleReservePct = num('mdc-scale-reserve', 20);
  S.layoutVariant = str('mdc-layout-variant', 'A');
  S.ashrae       = str('mdc-ashrae', 'A2');
  S.tmax         = num('mdc-tmax', 32);
  S.tmin         = num('mdc-tmin', -28);
  S.elev         = num('mdc-elev', 200);
  S.humidity     = str('mdc-humidity', 'norm');
  S.oduType      = str('mdc-odu-type', 'horiz-axial');
  S.scs   = chk('mdc-scs');
  S.skud  = chk('mdc-skud');
  S.video = chk('mdc-video');
  S.fire  = chk('mdc-fire');
  S.leak  = chk('mdc-leak');
  S.withDgu = chk('mdc-with-dgu');
  S.withTp  = chk('mdc-with-tp');
}

/* ================== ПОДБОР МОДУЛЕЙ ==================
   UPS-счёт чувствителен к нагрузке:
     • считаем nUps300 из расчёта 300 кВА ≈ 270 кВт на модуль (cosφ 0.9),
       округляем вверх по потребной UPS-мощности;
     • модули MOD-PWR-A содержат 2 UPS 300 + 2 UPS 200, MOD-PWR-B — 2 UPS 300.
       Считаем сколько PWR-A достаточно, при избытке добавляем PWR-B.
     • при 2N удваиваем.
   ========================================================================= */
function compute() {
  const itTplId = pickItTemplate(S.rackKw);
  const itTpl   = MODULE_TEMPLATES[itTplId];
  const srPerItModule = countRole(itTpl, 'SR') + countRole(itTpl, 'SR-wide');
  const itModules = Math.max(1, Math.ceil(S.totalRacks / srPerItModule));

  const redundFactor = S.redundancy === '2N' ? 2
                     : S.redundancy === 'N+1' ? 1.2 : 1.0;
  const itKw = S.totalRacks * S.rackKw;
  // UPS номинал по нагрузке / загрузка(%) × резерв масштабирования × резерв(N/N+1/2N).
  const loadFactor = Math.max(0.3, Math.min(1.0, S.upsLoadPct / 100));
  const scaleFactor = 1 + Math.max(0, S.scaleReservePct) / 100;
  const upsKwNeed = Math.ceil(itKw * redundFactor * scaleFactor / loadFactor);

  // MOD-PWR-A даёт 2×300+2×200 = 1000 кВт UPS, MOD-PWR-B даёт 2×300 = 600 кВт.
  // Подбираем минимальный комплект, покрывающий upsKwNeed.
  const A_KW = 1000, B_KW = 600;
  let modA = 0, modB = 0, remain = upsKwNeed;
  while (remain > 0) {
    if (remain >= A_KW || modA === modB) { modA++; remain -= A_KW; }
    else                                 { modB++; remain -= B_KW; }
  }
  // не допускаем «одинокий» PWR-B — всегда хотя бы один PWR-A впереди
  if (modA === 0 && modB > 0) { modA = 1; modB = Math.max(0, modB - 1); }
  const powerModules = modA + modB;

  // Последовательность модулей. Каждый модуль занимает (widthMm + 2*FRAME_MM)
  // по X (рама с обеих длинных сторон), между соседями — BETWEEN_MODS_MM.
  // Коридор — отдельный модуль (MOD-CORRIDOR-2400) между IT и силовыми.
  const sequence = [];
  let xCur = 0;
  const step = (w) => w + 2 * FRAME_MM + BETWEEN_MODS_MM;
  for (let i = 0; i < itModules; i++) {
    sequence.push({ templateId: itTplId, x: xCur, y: 0, num: i + 1 });
    xCur += step(itTpl.widthMm);
  }
  // Коридор — как обычный модуль
  const corrTplId = 'MOD-CORRIDOR-2400';
  const corrTpl = MODULE_TEMPLATES[corrTplId];
  sequence.push({ templateId: corrTplId, x: xCur, y: 0, num: 1 });
  xCur += step(corrTpl.widthMm);
  for (let i = 0; i < modA; i++) {
    sequence.push({ templateId: 'MOD-PWR-A', x: xCur, y: 0, num: i + 1 });
    xCur += step(MODULE_TEMPLATES['MOD-PWR-A'].widthMm);
  }
  for (let i = 0; i < modB; i++) {
    sequence.push({ templateId: 'MOD-PWR-B', x: xCur, y: 0, num: i + 1 });
    xCur += step(MODULE_TEMPLATES['MOD-PWR-B'].widthMm);
  }

  const buildingW = xCur - BETWEEN_MODS_MM;
  const buildingD = itTpl.lengthMm + 2 * END_WALL_MM;

  const totals = accumulate(sequence);
  totals.itModules    = itModules;
  totals.powerModules = powerModules;
  totals.modA = modA;
  totals.modB = modB;
  totals.itTplId = itTplId;
  totals.itKw = itKw;
  totals.upsKwNeed = upsKwNeed;
  totals.upsKwInstalled = modA * A_KW + modB * B_KW;

  // Климатическая поправка производительности ACU:
  //  • номинал ACU указывается при Tвх=35°C; при Tmax > 35°C — линейная
  //    деградация ≈2 %/°C (компрессор/конденсатор).
  //  • высота > 1000 м — деградация ~1 %/100 м (плотность воздуха ODU).
  //  • высокая влажность — +5 % к тепловой нагрузке (лат. тепло).
  const derateTemp = Math.max(0, S.tmax - 35) * 0.02;
  const derateAlt  = Math.max(0, S.elev - 1000) / 100 * 0.01;
  const humidityLoad = S.humidity === 'high' ? 1.05 : (S.humidity === 'low' ? 0.98 : 1.0);
  const climateFactor = humidityLoad / Math.max(0.6, 1 - derateTemp - derateAlt);
  // Резервирование холода: N→1.0, N+1→+1 ACU на каждые 3 штатных, 2N→×2
  const coolRedund = S.redundancy === '2N' ? 2 : (S.redundancy === 'N+1' ? 4/3 : 1);
  totals.climateFactor  = +climateFactor.toFixed(3);
  totals.acuRequired    = Math.ceil(totals.acu * coolRedund * climateFactor);
  totals.acuInRowRequired = Math.ceil(totals.acuInRow * coolRedund * climateFactor);

  // АКБ: VRLA — Kehua S3, 3 шкафа на 300 кВА @ 15 мин, 2 шкафа на 200 кВА.
  //      Li-ion LFP — плотнее в ~2.5×, считаем 1 шкаф на 300 и 1 на 200.
  const battFactor = S.autonomyMin / 15;
  if (S.battTech === 'LiFePO4') {
    totals.battLi  = Math.ceil((totals.ups300 * 1 + totals.ups200 * 1) * battFactor);
    totals.batteries = 0;
  } else {
    totals.batteries = Math.ceil(totals.ups300 * 3 * battFactor
                               + totals.ups200 * 2 * battFactor);
    totals.battLi = 0;
  }

  // AHU — 1 шт на каждые 2 IT-модуля (вытяжка+приточка).
  totals.ahu = Math.max(1, Math.ceil(itModules / 2));
  // ODU — по ACU-65 (1:1) + по 4 inRow на 1 ODU.
  totals.odu = totals.acu + Math.ceil(totals.acuInRow / 4);
  // АГПТ: 1 баллон на IT-модуль + 1 на пару силовых.
  totals.agptCyl  = itModules + Math.max(1, Math.ceil(powerModules / 2));
  totals.agptPipe = Math.round(buildingW / 1000); // метры магистрали

  totals.dgu = S.withDgu ? (S.redundancy === '2N' ? Math.max(2, powerModules)
                                                  : Math.max(2, Math.ceil(powerModules / 2) + 1))
                         : 0;
  totals.tp  = S.withTp ? 1 : 0;

  return { sequence, buildingW, buildingD, totals };
}

function accumulate(sequence) {
  const byRole = {};
  let ups300 = 0, ups200 = 0;
  for (const m of sequence) {
    const tpl = MODULE_TEMPLATES[m.templateId];
    for (const s of tpl.slots) {
      byRole[s.role] = (byRole[s.role] || 0) + 1;
      if (s.role === 'UPS') {
        if ((s.label || '').includes('300')) ups300++;
        else if ((s.label || '').includes('200')) ups200++;
      }
    }
  }
  return {
    byRole,
    racks:   byRole['SR'] || 0,
    racksWide: byRole['SR-wide'] || 0,
    acu:     (byRole['ACU'] || 0),
    acuInRow:(byRole['ACU-inrow'] || 0),
    ups300, ups200,
    upsTotal: ups300 + ups200,
    mdb: byRole['MDB'] || 0,
    udb: byRole['UDB'] || 0,
    pdb: byRole['PDB'] || 0,
    pdc: byRole['PDC'] || 0,
    mon: byRole['MON'] || 0,
  };
}

/* ================== СВОДКА ================== */
function renderSummary(r) {
  const t = r.totals;
  const el = $('mdc-summary');
  const itTpl = MODULE_TEMPLATES[t.itTplId];
  const overload = S.rackKw > (itTpl.itKwPerRack || 100);
  el.innerHTML = `
    <div class="card"><span class="label">IT-стоек</span><span class="value">${t.racks}${t.racksWide ? ' + ' + t.racksWide + 'w' : ''}</span></div>
    <div class="card"><span class="label">IT-нагрузка</span><span class="value">${t.itKw} кВт</span></div>
    <div class="card ${overload ? 'warn' : 'ok'}">
      <span class="label">IT-модулей</span>
      <span class="value">${t.itModules}${overload ? ' ⚠' : ''}</span>
    </div>
    <div class="card"><span class="label">Силовых модулей</span><span class="value">${t.powerModules} (A:${t.modA}+B:${t.modB})</span></div>
    <div class="card"><span class="label">UPS 300 / 200 кВА</span><span class="value">${t.ups300} / ${t.ups200}</span></div>
    <div class="card"><span class="label">UPS Σ (нужно / уст.)</span><span class="value">${t.upsKwNeed} / ${t.upsKwInstalled} кВт</span></div>
    ${t.batteries ? `<div class="card"><span class="label">АКБ S3 (58 кВт·ч)</span><span class="value">${t.batteries}</span></div>` : ''}
    ${t.battLi    ? `<div class="card"><span class="label">АКБ Li-ion LFP</span><span class="value">${t.battLi}</span></div>` : ''}
    <div class="card"><span class="label">ACU 65 (уст. / треб.)</span><span class="value">${t.acu} / ${t.acuRequired}</span></div>
    <div class="card"><span class="label">inRow 25 (уст. / треб.)</span><span class="value">${t.acuInRow} / ${t.acuInRowRequired}</span></div>
    <div class="card"><span class="label">Климат-коэфф.</span><span class="value">×${t.climateFactor}</span></div>
    <div class="card"><span class="label">AHU / ODU</span><span class="value">${t.ahu} / ${t.odu}</span></div>
    <div class="card"><span class="label">MDB / UDB / PDB</span><span class="value">${t.mdb}/${t.udb}/${t.pdb}</span></div>
    <div class="card"><span class="label">PDC / MON</span><span class="value">${t.pdc} / ${t.mon}</span></div>
    <div class="card"><span class="label">АГПТ баллоны / труба</span><span class="value">${t.agptCyl} / ${t.agptPipe} м</span></div>
    ${t.dgu ? `<div class="card"><span class="label">ДГУ</span><span class="value">${t.dgu}</span></div>` : ''}
    ${t.tp  ? `<div class="card"><span class="label">ТП 10/0.4</span><span class="value">${t.tp}</span></div>` : ''}
    <div class="card"><span class="label">Здание (внутр.)</span><span class="value">${r.buildingW} × ${r.buildingD} мм</span></div>
    <div class="card"><span class="label">Шаблон IT</span><span class="value" style="font-size:11px">${t.itTplId}</span></div>
  `;
  if (overload) {
    el.innerHTML += `<div style="grid-column: 1/-1; color:#e65100; font-size:11px; padding:4px;">
      ⚠ rackKw (${S.rackKw} кВт) выше паспорта выбранного шаблона (${itTpl.itKwPerRack} кВт/стойку).
    </div>`;
  }
}

/* ================== ПЛАНИРОВКА (SVG) ================== */
function renderPlan(r) {
  const host = $('mdc-plan');
  const padTop = 80;
  const padSide = 30;
  const padRight = 80;
  const pad = padSide;
  const targetW = 1200;
  const scale = Math.min(targetW / r.buildingW, 0.06);

  const vw = r.buildingW * scale + padSide + padRight;
  // Внизу — балкон с ODU
  const balconyH = 90;
  const vh = r.buildingD * scale + padTop + balconyH + 60;

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa">`;

  // Модули (каждый модуль сам рисует свой фальшпол, раму, стойки и стены)
  for (const m of r.sequence) {
    svg += moduleSvg(m, pad, scale, padTop);
  }

  // АГПТ-трубопровод — внутри каждого IT/POWER-модуля, L-образно
  // соединяет баллон (внизу/в углу) с форсунками через потолочную
  // магистраль. Маршрут: от баллона вертикально вверх до потолочной
  // точки, далее горизонтально к стояку, вертикально вниз к торцу.
  for (const m of r.sequence) {
    const tpl = MODULE_TEMPLATES[m.templateId];
    if (tpl.kind !== 'IT' && tpl.kind !== 'POWER') continue;
    const innerX0 = pad + m.x * scale + FRAME_MM * scale;
    const innerY0 = padTop + END_WALL_MM * scale;
    const Wi = tpl.widthMm * scale;
    const Di = tpl.lengthMm * scale;
    // Стояк АГПТ — строго по центру модуля. Баллон — с той же стороны,
    // что и «целая плитка 600»: variant A — снизу, variant B — сверху.
    const halfAtTop = S.layoutVariant === 'B';
    const cylX = innerX0 + Wi - 400*scale/2 - CABINET_GAP_MM*scale;
    const cylY = halfAtTop ? (innerY0 + 200*scale + 400*scale/2)
                           : (innerY0 + Di - 400*scale/2 - 100*scale);
    const riserX = innerX0 + Wi / 2;                  // строго по центру
    const nearY  = halfAtTop ? (innerY0 + 600*scale) : (innerY0 + Di - 600*scale);
    const farY   = halfAtTop ? (innerY0 + Di - 300*scale) : (innerY0 + 300*scale);
    const poly = [
      `${cylX},${cylY}`,
      `${cylX},${nearY}`,
      `${riserX},${nearY}`,
      `${riserX},${farY}`,
    ].join(' ');
    svg += `<polyline points="${poly}" fill="none" stroke="#B85450"
             stroke-width="1.6" stroke-linejoin="round"/>`;
    svg += `<circle cx="${cylX}" cy="${cylY}" r="1.4" fill="#B85450"/>`;
    svg += `<circle cx="${riserX}" cy="${farY}" r="1.4" fill="#B85450"/>`;
  }

  // AHU — снаружи сверху над зданием
  const ahuW = 800 * scale, ahuD = 1200 * scale;
  for (let i = 0; i < r.totals.ahu; i++) {
    const ahuX = pad + (1500 + i * 3500) * scale;
    const ahuY = padTop - ahuD - 4;
    if (ahuY < 2) break;
    svg += `<g>${COMPONENT_SVG.AHU(ahuX, ahuY, ahuW, ahuD)}
            <text x="${ahuX + ahuW/2}" y="${ahuY - 2}" text-anchor="middle"
             style="font-size:7px;fill:#6C8EBF;font-weight:600;">AHU-${i+1}</text></g>`;
  }

  // ODU — балкон снизу здания. 3 варианта:
  //  horiz-axial — осевой, горизонт. выдув (круг + вентилятор)
  //  horiz-radial — радиальный, горизонт. выдув (прямоугольный кожух)
  //  vert — вертикальный выдув (квадрат с решёткой сверху)
  const balconyY = padTop + r.buildingD * scale + 10;
  const balconyW = r.buildingW * scale;
  svg += `<rect x="${pad}" y="${balconyY}" width="${balconyW}" height="${balconyH - 10}"
          fill="#fafafa" stroke="#90a4ae" stroke-width="0.8" stroke-dasharray="4,3"/>`;
  svg += `<text x="${pad + 4}" y="${balconyY + 10}" style="font-size:8px;fill:#546e7a;font-weight:600;">БАЛКОН (ODU)</text>`;
  const oduCount = r.totals.odu;
  const oduGap = 4;
  const oduW = S.oduType === 'vert' ? 60 : 72;
  const oduH = S.oduType === 'vert' ? 60 : 50;
  for (let i = 0; i < oduCount; i++) {
    const perRow = Math.max(1, Math.floor((balconyW - 40) / (oduW + oduGap)));
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const ox = pad + 20 + col * (oduW + oduGap);
    const oy = balconyY + 14 + row * (oduH + oduGap);
    if (S.oduType === 'horiz-axial') {
      svg += COMPONENT_SVG.ODU(ox, oy, oduW, oduH);
    } else if (S.oduType === 'horiz-radial') {
      svg += `<rect x="${ox}" y="${oy}" width="${oduW}" height="${oduH}" fill="#e3f2fd" stroke="#1976d2" stroke-width="0.8"/>
              <rect x="${ox + oduW - 6}" y="${oy + 6}" width="4" height="${oduH - 12}" fill="#90caf9" stroke="#1976d2" stroke-width="0.4"/>
              <text x="${ox + oduW/2 - 3}" y="${oy + oduH/2 + 2}" text-anchor="middle" style="font-size:5px;fill:#0d47a1;">radial→</text>`;
    } else { // vert
      svg += `<rect x="${ox}" y="${oy}" width="${oduW}" height="${oduH}" fill="#e3f2fd" stroke="#1976d2" stroke-width="0.8"/>`;
      for (let k = 0; k < 4; k++) svg += `<line x1="${ox + 6 + k*(oduW-12)/3}" y1="${oy + 4}" x2="${ox + 6 + k*(oduW-12)/3}" y2="${oy + oduH - 4}" stroke="#64b5f6" stroke-width="0.5"/>`;
      svg += `<text x="${ox + oduW/2}" y="${oy + oduH/2 + 2}" text-anchor="middle" style="font-size:5px;fill:#0d47a1;">↑vert</text>`;
    }
  }

  // ТП / ДГУ — ещё ниже, под балконом
  const extraY = balconyY + balconyH + 8;
  let extraX = pad;
  if (r.totals.tp) {
    const ew = 4000 * scale, eh = 2500 * scale;
    svg += `<rect x="${extraX}" y="${extraY}" width="${ew}" height="${eh}"
            fill="#fff3e0" stroke="#f57c00" stroke-width="1.5" rx="2"/>`;
    svg += `<text class="zone-label" x="${extraX + ew/2}" y="${extraY + eh/2 + 4}"
            text-anchor="middle">ТП 10/0.4</text>`;
    extraX += ew + 10;
  }
  for (let i = 0; i < r.totals.dgu; i++) {
    const ew = 3500 * scale, eh = 2500 * scale;
    svg += `<rect x="${extraX}" y="${extraY}" width="${ew}" height="${eh}"
            fill="#ffe0b2" stroke="#e65100" stroke-width="1.5" rx="2"/>`;
    svg += `<text class="zone-label" x="${extraX + ew/2}" y="${extraY + eh/2 + 4}"
            text-anchor="middle">ДГУ-${i+1}</text>`;
    extraX += ew + 6;
  }

  svg += `<text class="dim" x="${pad}" y="${vh - 6}">
    Здание ${r.buildingW}×${r.buildingD} мм · сетка 600×600 · H 2700 внутри · все шкафы 600/800/300 × 1200 мм
  </text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
}

function moduleSvg(m, pad, scale, padTop) {
  const tpl = MODULE_TEMPLATES[m.templateId];
  // outerX0/outerY0 — внешний габарит с рамой и торцевыми стенами
  const outerX0 = pad + m.x * scale;
  const outerY0 = (padTop || pad);
  const Wi = tpl.widthMm * scale;          // внутренняя ширина
  const Di = tpl.lengthMm * scale;         // внутренняя длина
  const endW = END_WALL_MM * scale;        // торцевая стена
  const frm  = FRAME_MM * scale;           // рама длинной стороны
  const gap  = CABINET_GAP_MM * scale;
  const floorPerim = FLOOR_PERIM_MM * scale;
  const Wo = Wi + 2 * frm;                 // внешняя ширина
  const Do = Di + 2 * endW;                // внешняя длина
  // внутренний угол (начало рабочего пространства)
  const innerX0 = outerX0 + frm;
  const innerY0 = outerY0 + endW;

  const bg = tpl.kind === 'POWER' ? '#fffdf5'
           : tpl.kind === 'IT'    ? '#f5f9ff'
           : '#eef3ee';
  const borderColor = tpl.kind === 'POWER' ? '#f57f17'
                    : tpl.kind === 'IT'    ? '#1565c0'
                    : '#558b2f';

  let s = `<g>`;
  // === Внутреннее пространство (фон, на нём будет фальшпол) ===
  s += `<rect x="${innerX0}" y="${innerY0}" width="${Wi}" height="${Di}"
         fill="${bg}" stroke="${borderColor}" stroke-width="0.6"/>`;

  // === Торцевые стены (сэндвич) ===
  s += `<rect x="${outerX0}" y="${outerY0}" width="${Wo}" height="${endW}"
         fill="#37474f" stroke="#263238" stroke-width="0.4"/>`;
  s += `<rect x="${outerX0}" y="${innerY0 + Di}" width="${Wo}" height="${endW}"
         fill="#37474f" stroke="#263238" stroke-width="0.4"/>`;

  // === Рама длинной стороны (50 мм, с видимыми стойками по шагу 600 мм) ===
  // Рамы сверху и снизу — два вертикальных прямоугольника по длине модуля.
  s += `<rect x="${outerX0}" y="${innerY0}" width="${frm}" height="${Di}"
         fill="#eceff1" stroke="#90a4ae" stroke-width="0.4"/>`;
  s += `<rect x="${outerX0 + frm + Wi}" y="${innerY0}" width="${frm}" height="${Di}"
         fill="#eceff1" stroke="#90a4ae" stroke-width="0.4"/>`;
  // Ряды и коридор зависят от варианта размещения (A/B).
  // Вариант A: сверху 1800 (3 плитки) + ряд1 1200 + коридор 1200 + ряд2 1200
  //            + снизу 1500 (2.5 плитки, полуплитка снизу)
  // Вариант B: сверху 1500 (2.5, полуплитка сверху) + ряд1 1200 + коридор 1200
  //            + ряд2 1200 + снизу 1800 (3 плитки)
  const halfAtTop = S.layoutVariant === 'B';
  const row1Y_mm = halfAtTop ? 1500 : 2100;
  const row2Y_mm = row1Y_mm + 1200 + 1200;   // ряд1(1200) + коридор(1200)
  const corrY_mm = row1Y_mm + 1200;
  const row1Y = row1Y_mm * scale;
  const row2Y = row2Y_mm * scale;
  const corrY = corrY_mm * scale;
  const corrH = 1200 * scale;

  // Стойки рамы 50×100 мм с шагом 600 мм (по границам плиток), но НЕ в
  // зоне коридора — там проход не должен сужаться.
  const postStep = POST_STEP_MM * scale;
  const halfTile0 = (FLOOR_TILE_MM / 2) * scale;
  const postLen = 100 * scale;            // стойка 100 мм вдоль длины модуля
  // Первая стойка: для варианта B (полуплитка сверху) — на 300 от верха;
  //                для варианта A (целая сверху) — на 600 от верха.
  const firstPostY = halfAtTop ? halfTile0 : (FLOOR_TILE_MM * scale);
  for (let py = floorPerim + firstPostY; py < Di - 2; py += postStep) {
    // пропустить стойки, попадающие в коридор между рядами
    if (py + postLen/2 > corrY && py - postLen/2 < corrY + corrH) continue;
    s += `<rect x="${outerX0}" y="${innerY0 + py - postLen/2}"
           width="${frm}" height="${postLen}" fill="#455a64"/>`;
    s += `<rect x="${outerX0 + frm + Wi}" y="${innerY0 + py - postLen/2}"
           width="${frm}" height="${postLen}" fill="#455a64"/>`;
  }

  // === Фальшпол 600×600, отцентрован, 5 мм зазор от внутренней границы ===
  // Рабочая зона пола: (innerX0+floorPerim, innerY0+floorPerim) размером
  // (Wi - 2*floorPerim) × (Di - 2*floorPerim). Целая плитка с одной
  // стороны, половинка 300 с другой.
  const floorX = innerX0 + floorPerim;
  const floorY = innerY0 + floorPerim;
  const floorW = Wi - 2 * floorPerim;
  const floorD = Di - 2 * floorPerim;
  const tile   = FLOOR_TILE_MM * scale;
  const halfTile = tile / 2;
  // Смещение по X: первая плитка — целая, последняя — половинка (300).
  // Сетка по X
  s += `<rect x="${floorX}" y="${floorY}" width="${floorW}" height="${floorD}"
         fill="#f3f5f7" stroke="#cdd4da" stroke-width="0.35"/>`;
  // Вертикальные линии сетки
  let gx = tile;
  while (gx < floorW) {
    s += `<line x1="${floorX + gx}" y1="${floorY}" x2="${floorX + gx}" y2="${floorY + floorD}"
           stroke="#cdd4da" stroke-width="0.3"/>`;
    gx += tile;
  }
  // Горизонтальные линии фальшпола — в зависимости от варианта:
  //   B: полуплитка 300 мм у верхнего края
  //   A: полуплитка 300 мм у нижнего края
  if (halfAtTop) {
    s += `<line x1="${floorX}" y1="${floorY + halfTile}" x2="${floorX + floorW}" y2="${floorY + halfTile}"
           stroke="#90a4ae" stroke-width="0.4"/>`;
    let gy = halfTile + tile;
    while (gy < floorD - 0.5) {
      s += `<line x1="${floorX}" y1="${floorY + gy}" x2="${floorX + floorW}" y2="${floorY + gy}"
             stroke="#cdd4da" stroke-width="0.3"/>`;
      gy += tile;
    }
  } else {
    let gy = tile;
    while (gy < floorD - halfTile - 0.5) {
      s += `<line x1="${floorX}" y1="${floorY + gy}" x2="${floorX + floorW}" y2="${floorY + gy}"
             stroke="#cdd4da" stroke-width="0.3"/>`;
      gy += tile;
    }
    s += `<line x1="${floorX}" y1="${floorY + floorD - halfTile}" x2="${floorX + floorW}" y2="${floorY + floorD - halfTile}"
           stroke="#90a4ae" stroke-width="0.4"/>`;
  }

  // === Корпусные детали ===
  if (tpl.kind === 'IT') {
    // Центральный проход 1200 мм между рядами (положение зависит от варианта)
    s += `<rect x="${innerX0}" y="${innerY0 + corrY}"
           width="${Wi}" height="${corrH}"
           fill="none" stroke="#bdbdbd" stroke-width="0.4" stroke-dasharray="2,2"/>`;
    // Дверь входа 900 мм в нижней торцевой стене
    const doorW = 900 * scale;
    const dx = outerX0 + Wo/2 - doorW/2;
    s += `<rect x="${dx}" y="${innerY0 + Di}" width="${doorW}" height="${endW}"
           fill="#a1887f" stroke="#5d4037" stroke-width="0.4"/>`;
    s += `<path d="M ${dx} ${innerY0 + Di + endW} a ${doorW} ${doorW} 0 0 0 ${doorW} 0"
           fill="none" stroke="#8d6e63" stroke-width="0.5" stroke-dasharray="1.5,1"/>`;
  }

  if (tpl.kind === 'CORRIDOR') {
    // Перегородка 150 мм поперёк (по центру длины) — делит транзит надвое.
    const partW = 150 * scale;
    s += `<rect x="${innerX0}" y="${innerY0 + Di/2 - partW/2}"
           width="${Wi}" height="${partW}" fill="#cfd8dc" stroke="#78909c" stroke-width="0.4"/>`;
    // Двери с каждой стороны
    const doorW = 900 * scale;
    for (const ySide of [outerY0, innerY0 + Di]) {
      const dx = outerX0 + Wo/2 - doorW/2;
      s += `<rect x="${dx}" y="${ySide}" width="${doorW}" height="${endW}"
             fill="#a1887f" stroke="#5d4037" stroke-width="0.4"/>`;
      if (ySide === outerY0) {
        s += `<path d="M ${dx} ${outerY0 + endW} a ${doorW} ${doorW} 0 0 1 ${doorW} 0"
               fill="none" stroke="#8d6e63" stroke-width="0.5" stroke-dasharray="1.5,1"/>`;
      } else {
        s += `<path d="M ${dx} ${innerY0 + Di + endW} a ${doorW} ${doorW} 0 0 0 ${doorW} 0"
               fill="none" stroke="#8d6e63" stroke-width="0.5" stroke-dasharray="1.5,1"/>`;
      }
    }
    s += `<text x="${outerX0 + Wo/2}" y="${innerY0 + Di/2 + 2}" text-anchor="middle"
           style="font-size:7px;font-weight:600;fill:#37474f;">ТАМБУР</text>`;
  }

  // === Слоты (оборудование) ===
  // Шкафы отстоят от торцевых стен на 5 мм (gap). JB — на торцевой стене.
  // Y-позиция рядов переопределяется под выбранный вариант A/B:
  //   шаблонные y=2300 → ряд1 (row1Y_mm); y=4700 → ряд2 (row2Y_mm).
  const remapY = (yMm) => {
    if (tpl.kind !== 'IT') return yMm;
    if (yMm < 3500) return row1Y_mm;       // верхний ряд
    if (yMm < 6000) return row2Y_mm;       // нижний ряд
    return yMm;
  };
  for (const slot of tpl.slots) {
    const isJb = slot.role === 'JB' || /JB/.test(slot.label || '');
    const sx = innerX0 + slot.x * scale;
    const slotTopY_mm = remapY(slot.y);
    const slotBotY_mm = slotTopY_mm + slot.d;
    const topAdj = slot.y === 0 ? gap : 0;
    const botAdj = slotBotY_mm >= tpl.lengthMm ? gap : 0;
    let sy = innerY0 + slotTopY_mm * scale + topAdj;
    let sd = slot.d * scale - topAdj - botAdj;
    const sw = slot.w * scale;
    if (isJb) {
      // JB рисуем на верхней торцевой стене, протыкая наружу
      const jbx = innerX0 + slot.x * scale;
      const jby = outerY0;
      s += `<rect x="${jbx}" y="${jby}" width="${sw}" height="${endW}"
             fill="#ffcdd2" stroke="#c62828" stroke-width="0.5"/>`;
      s += `<text x="${jbx + sw/2}" y="${jby + endW/2 + 2}" text-anchor="middle"
             style="font-size:6px;font-weight:700;fill:#b71c1c;">JB</text>`;
      continue;
    }
    const drawer = COMPONENT_SVG[slot.role];
    if (drawer) {
      s += drawer(sx, sy, Math.max(2, sw - 0.3), Math.max(2, sd - 0.3));
    } else {
      const col = ROLE_COLORS[slot.role] || { fill: '#ccc', stroke: '#666', text: '#000' };
      s += `<rect x="${sx}" y="${sy}" width="${Math.max(2, sw - 0.3)}" height="${Math.max(2, sd - 0.3)}"
             fill="${col.fill}" stroke="${col.stroke}" stroke-width="0.6"/>`;
    }
    if (sw > 14) {
      s += `<text x="${sx + sw/2}" y="${sy + sd - 3}" text-anchor="middle"
             fill="#000" style="font-size:6px;font-weight:600;pointer-events:none;opacity:0.7;">${slot.role}</text>`;
    }
  }

  // АГПТ-баллон — 1 шт в IT-модулях, в углу со стороны целой плитки 600 мм
  // (variant A: снизу; variant B: сверху).
  if (tpl.kind === 'IT') {
    const cylW = 400 * scale, cylD = 400 * scale;
    const cx = innerX0 + Wi - cylW - gap;
    const cy = halfAtTop ? (innerY0 + 200 * scale)
                         : (innerY0 + Di - cylD - 100 * scale);
    s += COMPONENT_SVG['AGPT-cyl'](cx, cy, cylW, cylD);
  }

  // Заголовок — на верхней торцевой стене
  const title = tpl.kind === 'POWER'
    ? (m.templateId === 'MOD-PWR-A' ? `PWR-A${m.num}` : `PWR-B${m.num}`)
    : tpl.kind === 'IT' ? `IT-${m.num}` : 'CORR';
  s += `<text x="${outerX0 + Wo/2}" y="${outerY0 + endW*0.65}" text-anchor="middle"
         style="font-size:8px;font-weight:700;fill:#eceff1">${title}</text>`;

  s += `</g>`;
  return s;
}

/* ================== UPDATE ================== */
function update() {
  read();
  const r = compute();
  renderSummary(r);
  renderPlan(r);
  window.__mdc = r;  // для отладки в консоли
}

/* ================== ЭКСПОРТ BOM (XLSX) ================== */
function exportBom() {
  if (typeof window === 'undefined' || !window.XLSX) {
    alert('SheetJS не загружен. Проверьте интернет-подключение (CDN).');
    return;
  }
  const r = compute();
  const t = r.totals;

  // Метаданные активного проекта (если открыт через главный Конструктор)
  let proj = null;
  try { proj = JSON.parse(localStorage.getItem('raschet.activeProject.v1') || 'null'); } catch {}

  const rows = [];
  const merges = [];
  const pushTitle = (text) => {
    const rowIdx = rows.length;
    rows.push([text, '', '', '', '', '', '']);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 6 } });
  };
  pushTitle('ОБЪЁМ ПОСТАВКИ — МОДУЛЬНЫЙ ЦОД GDM-600');

  // Блок метаданных (шаблон 26003-SCO): Объект / Заказчик / Договор / Дата / Ревизия
  const metaRow = (label, value) => rows.push([label, value || '—', '', '', '', '', '']);
  metaRow('Объект',   proj?.site?.name || proj?.site || '');
  metaRow('Заказчик', proj?.customer || proj?.client || '');
  metaRow('Договор',  proj?.contract || '');
  metaRow('Ревизия',  proj?.revision || 'A');
  metaRow('Дата',     new Date().toLocaleDateString('ru-RU'));
  rows.push([]);

  pushTitle(`IT-нагрузка: ${t.itKw} кВт · стоек ${t.racks}${t.racksWide ? '+' + t.racksWide + 'w' : ''} · ${S.rackKw} кВт/стойку · резерв ${S.redundancy}`);
  pushTitle(`IT-модулей: ${t.itModules} (${t.itTplId}) · Силовых модулей: ${t.powerModules} · Автономия: ${S.autonomyMin} мин · ASHRAE ${S.ashrae}`);
  rows.push([]);
  rows.push(['№', 'Обозначение', 'Наименование', 'Габарит, мм', 'Кол-во', 'Ед.', 'Примечание']);

  let n = 0;
  let secStartIdx = -1;
  let secQtyCount = 0;
  let secItemCount = 0;
  const closeSection = () => {
    if (secStartIdx < 0) return;
    rows.push(['', '', `Итого по разделу (позиций):`, '', secItemCount, 'поз.', `Σ кол-во: ${secQtyCount}`]);
    rows.push([]);
    secStartIdx = -1;
    secQtyCount = 0;
    secItemCount = 0;
  };
  const add = (code, name, size, qty, unit, note) => {
    rows.push([++n, code, name, size || '', qty, unit || 'шт.', note || '']);
    secQtyCount += Number(qty) || 0;
    secItemCount++;
  };
  const sec = (title) => {
    closeSection();
    const rowIdx = rows.length;
    rows.push([`— ${title} —`, '', '', '', '', '', '']);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 6 } });
    secStartIdx = rows.length;
  };

  // === Модули (как компл.) ===
  sec(`Модули`);
  // Сгруппировать модули по templateId
  const tplCount = {};
  for (const m of r.sequence) tplCount[m.templateId] = (tplCount[m.templateId] || 0) + 1;
  for (const [tplId, cnt] of Object.entries(tplCount)) {
    const tpl = MODULE_TEMPLATES[tplId];
    add(tplId, tpl.label, `${tpl.widthMm}×${tpl.lengthMm}×2700`, cnt, 'компл.', '');
  }

  // === Оборудование (по ролям, из сумм) ===
  sec('IT-шкафы и стойки');
  if (t.racks)     add('SR.42U',   'Серверная стойка 42U',        '600×1200×2000', t.racks, 'шт.', `${S.rackKw} кВт/стойку`);
  if (t.racksWide) add('SR.wide',  'Серверная стойка 800 мм (HPC)','800×1200×2000', t.racksWide, 'шт.', '');
  if (t.pdc)       add('PDC',      'Распределитель модуля PDC',    '600×1200×2000', t.pdc, 'шт.', '');
  if (t.mon)       add('MON',      'Шкаф мониторинга',             '600×1200×2000', t.mon, 'шт.', '');

  sec('Кондиционеры и вентиляция');
  if (t.acuRequired)      add('ACU.65',   'Прецизионный кондиционер 65 кВт','600×1200×2000', t.acuRequired, 'шт.', `ASHRAE ${S.ashrae}; ${t.acu} штатно + резерв ${S.redundancy}`);
  if (t.acuInRowRequired) add('ACU.25ir', 'inRow кондиционер 25 кВт',     '300×1200×2000', t.acuInRowRequired, 'шт.', `${t.acuInRow} штатно + резерв ${S.redundancy}`);
  if (t.ahu)       add('AHU',      'Вентустановка (AHU)',          '800×1200',      t.ahu, 'шт.', 'приточно-вытяжная');
  if (t.odu) {
    const oduName = S.oduType === 'vert' ? 'Конденсатор, вертикальный выдув'
                  : S.oduType === 'horiz-radial' ? 'Конденсатор, радиальный, горизонт. выдув'
                  : 'Конденсатор, осевой, горизонт. выдув';
    add('ODU',      oduName,   '900×900', t.odu, 'шт.', 'на балконе');
  }

  sec('Силовая часть (ИБП + АКБ + щиты)');
  if (t.ups300)    add('UPS.MR33-300','ИБП Kehua MR33-300 (300 кВА)','600×1200×2000', t.ups300, 'шт.', '');
  if (t.ups200)    add('UPS.MR33-200','ИБП Kehua MR33-200 (200 кВА)','600×1200×2000', t.ups200, 'шт.', '');
  if (t.batteries) add('BAT.S3',   'Шкаф АКБ Kehua S3 (VRLA, 58 кВт·ч)', '600×1200×2000', t.batteries, 'шт.', `${S.autonomyMin} мин автономии`);
  if (t.battLi)    add('BAT.LFP',  'Шкаф АКБ Li-ion LFP',           '600×1200×2000', t.battLi,    'шт.', `${S.autonomyMin} мин автономии`);
  if (t.mdb)       add('MDB',      'Щит MDB',                      '600×1200×2000', t.mdb, 'шт.', '');
  if (t.udb)       add('UDB',      'Щит UDB',                      '600×1200×2000', t.udb, 'шт.', '');
  if (t.pdb)       add('PDB',      'Щит PDB',                      '600×1200×2000', t.pdb, 'шт.', '');

  if (S.fire) {
    sec('Система АГПТ (автоматическое газовое пожаротушение)');
    add('AGPT.cyl',  'Баллон АГПТ с газом-ингибитором',       '400×400 Ø', t.agptCyl, 'шт.', '1 баллон на модуль');
    add('AGPT.pipe', 'Трубопровод АГПТ (магистраль)',         'DN25',      t.agptPipe, 'м', 'прокладка по модулям');
    add('AGPT.nozzle','Форсунка-распылитель',                  '',          t.agptCyl * 2, 'шт.', '2 форсунки на модуль');
  }

  if (t.tp || t.dgu) {
    sec('Внешние блоки');
    if (t.tp)  add('TP.10/0.4', 'Трансформаторная подстанция 10/0.4 кВ', '', t.tp, 'компл.', '');
    if (t.dgu) add('DGU', 'Дизель-генераторная установка', '', t.dgu, 'шт.', `резерв ${S.redundancy}`);
  }

  const lowNum = t.racks + t.powerModules;
  const low = [];
  if (S.scs)   low.push(['SCS',  'СКС: патч-панели + коммутация',        t.racks,  'на стойку']);
  if (S.skud)  low.push(['SKUD', 'СКУД (вход + модули)',                 lowNum, 'на модуль']);
  if (S.video) low.push(['CCTV', 'Видеонаблюдение (2 камеры на модуль)', 2 * lowNum, '']);
  if (S.fire)  low.push(['FIRE', 'Газовое пожаротушение',                lowNum, 'на модуль']);
  if (S.leak)  low.push(['LEAK', 'Контроль протечек',                    lowNum, 'на модуль']);
  if (low.length) {
    sec('Слаботочные системы');
    for (const [c, nm, q, note] of low) add(c, nm, '', q, 'компл.', note);
  }

  // Закрываем последнюю секцию и добавляем общий итог
  closeSection();
  rows.push([]);
  const totalRowIdx = rows.length;
  rows.push(['ВСЕГО ПОЗИЦИЙ:', n, '', '', '', '', '']);
  merges.push({ s: { r: totalRowIdx, c: 1 }, e: { r: totalRowIdx, c: 6 } });

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [ { wch: 4 }, { wch: 22 }, { wch: 46 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 28 } ];
  ws['!merges'] = merges;
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Объём поставки');
  const fname = `MDC_GDM600_${t.itKw}kW_${t.racks}racks_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, fname);
}

/* ================== INIT ================== */
function init() {
  const ids = ['mdc-total-racks','mdc-rack-kw','mdc-redundancy',
               'mdc-autonomy','mdc-batt-tech','mdc-cosphi','mdc-ups-load','mdc-scale-reserve',
               'mdc-layout-variant',
               'mdc-ashrae','mdc-tmax','mdc-tmin','mdc-elev','mdc-humidity','mdc-odu-type',
               'mdc-scs','mdc-skud','mdc-video','mdc-fire','mdc-leak',
               'mdc-with-dgu','mdc-with-tp'];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', update);
    if (el.type === 'number' || el.type === 'text') el.addEventListener('input', update);
  }
  $('mdc-export-bom').addEventListener('click', exportBom);
  $('mdc-send-suppression')?.addEventListener('click', sendToSuppression);
  update();
}

/* ================== BRIDGE: MDC → АГПТ (Phase 11.8) ==================
   Передаём в suppression-config геометрию IT- и силовых модулей как
   готовые зоны пожаротушения. Формат — единый localStorage-мост
   'raschet.mdcToSuppression.v1'. suppression-config на init проверяет
   ключ и, если запись свежая (< 24 ч), предлагает создать установку.
   Высота помещения — фиксированная H=2700 мм внутри модуля GDM-600
   (от фальшпола до потолка). Площадь S = (widthMm × lengthMm) / 1e6. */
function sendToSuppression() {
  const r = compute();
  const H = 2.7; // м, внутренняя высота GDM-600 от фальшпола
  const zonesByDir = { IT: [], POWER: [] };
  for (const m of r.sequence) {
    const tpl = MODULE_TEMPLATES[m.templateId];
    if (!tpl || tpl.kind === 'CORRIDOR') continue;
    const Sm2 = +(tpl.widthMm * tpl.lengthMm / 1e6).toFixed(2);
    const label = tpl.kind === 'POWER'
      ? (m.templateId === 'MOD-PWR-A' ? `PWR-A${m.num}` : `PWR-B${m.num}`)
      : `IT-${m.num}`;
    zonesByDir[tpl.kind].push({
      name: label, templateId: m.templateId,
      S: Sm2, H, V: +(Sm2 * H).toFixed(2),
      fireClass: tpl.kind === 'POWER' ? 'A' : 'A', // кабели/серверы — класс А (ТД)
    });
  }
  const project = `ЦОД GDM-600 · ${r.totals.itKw} кВт · стоек ${r.totals.racks}${r.totals.racksWide ? '+' + r.totals.racksWide + 'w' : ''}`;
  const payload = {
    version: 1,
    createdAt: Date.now(),
    source: 'mdc-config',
    project,
    installations: [{
      name: `АГПТ · ${project}`,
      norm: 'SP485',         // дефолтный норматив — пользователь сможет сменить
      agent: 'HFC-227ea',    // FM-200, типовой для ЦОД
      directions: [
        { name: 'IT-модули',    kind: 'common', zones: zonesByDir.IT },
        { name: 'Силовые модули', kind: 'common', zones: zonesByDir.POWER },
      ].filter(d => d.zones.length > 0),
    }],
  };
  try {
    localStorage.setItem('raschet.mdcToSuppression.v1', JSON.stringify(payload));
  } catch (err) {
    alert('Не удалось записать данные в localStorage: ' + err.message);
    return;
  }
  // Открываем модуль АГПТ. Суп-модуль при init прочитает ключ и предложит
  // импорт.
  location.href = '../suppression-config/?from=mdc';
}

document.addEventListener('DOMContentLoaded', init);
