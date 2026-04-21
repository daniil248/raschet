/* =========================================================================
   mdc-config.js — Конфигуратор модульного ЦОД (серия GDM-600)
   v0.58.93 (Фаза 10.2+) — шаблонные модули из drawio «Планирование
   конфигураций».

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
  countRole, ROLE_COLORS,
} from '../shared/gdm600-templates.js';

const $ = (id) => document.getElementById(id);

// ================== СОСТОЯНИЕ ==================
const S = {
  totalRacks: 32,
  rackKw: 10,
  redundancy: 'N+1',
  autonomyMin: 15,
  ashrae: 'A2',
  scs: true, skud: true, video: true, fire: true, leak: false,
  withDgu: true,
  withTp:  true,
};

function read() {
  S.totalRacks  = Number($('mdc-total-racks').value) || 1;
  S.rackKw      = Number($('mdc-rack-kw').value) || 10;
  S.redundancy  = $('mdc-redundancy').value;
  S.autonomyMin = Number($('mdc-autonomy').value) || 15;
  S.ashrae      = $('mdc-ashrae').value;
  S.scs   = $('mdc-scs').checked;
  S.skud  = $('mdc-skud').checked;
  S.video = $('mdc-video').checked;
  S.fire  = $('mdc-fire').checked;
  S.leak  = $('mdc-leak').checked;
  S.withDgu = $('mdc-with-dgu').checked;
  S.withTp  = $('mdc-with-tp').checked;
}

/* ================== ПОДБОР МОДУЛЕЙ ================== */
function compute() {
  // 1. IT-модули — по rackKw и totalRacks
  const itTplId = pickItTemplate(S.rackKw);
  const itTpl   = MODULE_TEMPLATES[itTplId];
  const srPerItModule = countRole(itTpl, 'SR');
  const itModules = Math.ceil(S.totalRacks / srPerItModule);

  // 2. Силовые модули — пара A+B на 1600 кВт UPS,
  //    с учётом резервирования и cosφ.
  const cosPhi = 0.9;
  const redundFactor = S.redundancy === '2N' ? 2 : (S.redundancy === 'N+1' ? 1.2 : 1.0);
  const itKw = S.totalRacks * S.rackKw;
  const upsKwNeed = itKw * redundFactor;            // потребная мощность UPS
  const powerPairs = Math.max(1, Math.ceil(upsKwNeed / POWER_PAIR_KW));
  const powerModules = powerPairs * POWER_PAIR.length;  // 2 модуля на пару

  // 3. Компоновка: IT-модули подряд вдоль X + силовые в конце
  const sequence = [];
  let xCur = 0;
  for (let i = 0; i < itModules; i++) {
    const tpl = itTpl;
    sequence.push({ templateId: itTplId, x: xCur, y: 0,
                    widthMm: tpl.widthMm, lengthMm: tpl.lengthMm,
                    num: i + 1 });
    xCur += tpl.widthMm;
  }
  // Силовые: сразу после IT, сначала все A, потом все B
  for (let p = 0; p < powerPairs; p++) {
    for (const pwrId of POWER_PAIR) {
      const tpl = MODULE_TEMPLATES[pwrId];
      sequence.push({ templateId: pwrId, x: xCur, y: 0,
                      widthMm: tpl.widthMm, lengthMm: tpl.lengthMm,
                      num: (pwrId === 'MOD-PWR-A' ? p * 2 + 1 : p * 2 + 2) });
      xCur += tpl.widthMm;
    }
  }

  const buildingW = xCur;
  const buildingD = itTpl.lengthMm;

  // 4. Подсчёт итогов (оборудование во всех модулях)
  const totals = accumulate(sequence);
  totals.itModules = itModules;
  totals.powerModules = powerModules;
  totals.powerPairs = powerPairs;
  totals.itTplId = itTplId;
  totals.itKw = itKw;
  totals.upsKwInstalled = powerPairs * POWER_PAIR_KW;
  totals.upsKwNeed = upsKwNeed;
  // АКБ — через штат энергоблока POWER-1600: 10 шкафов S3 (580 кВт·ч) на 15 мин.
  const battFactor = S.autonomyMin / 21; // паспорт — 21 мин на 580 кВт·ч при 1600 кВт
  totals.batteries = Math.ceil(powerPairs * 10 * Math.max(1, battFactor));
  totals.dgu = S.withDgu ? (S.redundancy === '2N' ? powerPairs * 2 : powerPairs + 1) : 0;
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
    <div class="card"><span class="label">Силовых модулей</span><span class="value">${t.powerModules} (${t.powerPairs} пар.)</span></div>
    <div class="card"><span class="label">UPS 300 / 200 кВА</span><span class="value">${t.ups300} / ${t.ups200}</span></div>
    <div class="card"><span class="label">UPS ΣкВт</span><span class="value">${t.upsKwInstalled} кВт</span></div>
    <div class="card"><span class="label">АКБ S3 (58 кВт·ч)</span><span class="value">${t.batteries} шкафов</span></div>
    <div class="card"><span class="label">ACU 65 / inRow 25</span><span class="value">${t.acu} / ${t.acuInRow}</span></div>
    <div class="card"><span class="label">MDB / UDB / PDB</span><span class="value">${t.mdb}/${t.udb}/${t.pdb}</span></div>
    <div class="card"><span class="label">PDC / MON</span><span class="value">${t.pdc} / ${t.mon}</span></div>
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
  // Масштаб: укладываем здание в ~1200 px по ширине.
  const pad = 30;
  const targetW = 1200;
  const scale = Math.min(targetW / r.buildingW, 0.06);

  const vw = r.buildingW * scale + 2 * pad;
  const vh = r.buildingD * scale + 2 * pad + 80 /* подписи + ТП/ДГУ */;

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa">`;

  // Сетка пола 600×600 мм (светло-серая подложка — только под самим зданием)
  svg += `<g opacity="0.22">`;
  for (let gx = 0; gx <= r.buildingW; gx += 600) {
    svg += `<line x1="${pad + gx*scale}" y1="${pad}" x2="${pad + gx*scale}" y2="${pad + r.buildingD*scale}" stroke="#999" stroke-width="0.3"/>`;
  }
  for (let gy = 0; gy <= r.buildingD; gy += 600) {
    svg += `<line x1="${pad}" y1="${pad + gy*scale}" x2="${pad + r.buildingW*scale}" y2="${pad + gy*scale}" stroke="#999" stroke-width="0.3"/>`;
  }
  svg += `</g>`;

  // Модули
  for (const m of r.sequence) {
    svg += moduleSvg(m, pad, scale);
  }

  // Контур здания
  svg += `<rect x="${pad}" y="${pad}" width="${r.buildingW * scale}" height="${r.buildingD * scale}"
          fill="none" stroke="#263238" stroke-width="2"/>`;

  // ТП / ДГУ снаружи снизу
  const extraY = pad + r.buildingD * scale + 16;
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

function moduleSvg(m, pad, scale) {
  const tpl = MODULE_TEMPLATES[m.templateId];
  const x0 = pad + m.x * scale;
  const y0 = pad + m.y * scale;
  const W  = tpl.widthMm * scale;
  const D  = tpl.lengthMm * scale;

  // Фон модуля по kind
  const bg = tpl.kind === 'POWER' ? '#fff8e1'
           : tpl.kind === 'IT'    ? '#e3f2fd'
           : '#f5f5f5';
  const border = tpl.kind === 'POWER' ? '#f57f17'
               : tpl.kind === 'IT'    ? '#1565c0'
               : '#9e9e9e';

  let s = `<g>`;
  s += `<rect x="${x0}" y="${y0}" width="${W}" height="${D}"
         fill="${bg}" stroke="${border}" stroke-width="1.2"/>`;

  // Центральный коридор 1200 мм на IT-модулях (y 3500..4700 внутри)
  if (tpl.kind === 'IT') {
    const ay = 3500 * scale;
    const ah = 1200 * scale;
    s += `<rect x="${x0 + 200*scale}" y="${y0 + ay}"
           width="${W - 400*scale}" height="${ah}"
           fill="#fafafa" stroke="#bdbdbd" stroke-width="0.5" stroke-dasharray="2,2"/>`;
  }

  // Слоты
  for (const slot of tpl.slots) {
    const sx = x0 + slot.x * scale;
    const sy = y0 + slot.y * scale;
    const sw = slot.w * scale;
    const sd = slot.d * scale;
    const col = ROLE_COLORS[slot.role] || { fill: '#ccc', stroke: '#666', text: '#000' };
    s += `<rect x="${sx}" y="${sy}" width="${sw - 0.5}" height="${sd - 0.5}"
           fill="${col.fill}" stroke="${col.stroke}" stroke-width="0.6"/>`;
    // Подпись на слоте — только если достаточно места
    if (sw > 12) {
      s += `<text x="${sx + sw/2}" y="${sy + sd/2 + 2}" text-anchor="middle"
             fill="${col.text}" style="font-size:7px;font-weight:600;pointer-events:none;">${slot.role}</text>`;
    }
  }

  // Заголовок модуля
  const title = tpl.kind === 'POWER'
    ? (m.templateId === 'MOD-PWR-A' ? `PWR-A${m.num}` : `PWR-B${m.num}`)
    : tpl.kind === 'IT'    ? `IT-${m.num}`
    : 'CORR';
  s += `<text x="${x0 + W/2}" y="${y0 + 12}" text-anchor="middle"
         style="font-size:9px;font-weight:700;fill:#263238">${title}</text>`;
  s += `<text x="${x0 + W/2}" y="${y0 + D - 4}" text-anchor="middle"
         style="font-size:7px;fill:#555">${tpl.widthMm}×${tpl.lengthMm}</text>`;

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

  const rows = [];
  rows.push(['Объём поставки — модульный ЦОД GDM-600']);
  rows.push([`IT-нагрузка: ${t.itKw} кВт · стоек ${t.racks}${t.racksWide ? '+' + t.racksWide + 'w' : ''} · ${S.rackKw} кВт/стойку · резерв ${S.redundancy}`]);
  rows.push([`IT-модулей: ${t.itModules} (${t.itTplId}) · Силовых модулей: ${t.powerModules} · Автономия: ${S.autonomyMin} мин · ASHRAE ${S.ashrae}`]);
  rows.push([]);
  rows.push(['№', 'Обозначение', 'Наименование', 'Габарит, мм', 'Кол-во', 'Ед.', 'Примечание']);

  let n = 0;
  const add = (code, name, size, qty, unit, note) => {
    rows.push([++n, code, name, size || '', qty, unit || 'шт.', note || '']);
  };
  const sec = (title) => rows.push(['', `— ${title} —`]);

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

  sec('Кондиционеры');
  if (t.acu)       add('ACU.65',   'Прецизионный кондиционер 65 кВт','600×1200×2000', t.acu, 'шт.', 'ASHRAE ' + S.ashrae);
  if (t.acuInRow)  add('ACU.25ir', 'inRow кондиционер 25 кВт',     '300×1200×2000', t.acuInRow, 'шт.', '');

  sec('Силовая часть (ИБП + АКБ + щиты)');
  if (t.ups300)    add('UPS.MR33-300','ИБП Kehua MR33-300 (300 кВА)','600×1200×2000', t.ups300, 'шт.', '');
  if (t.ups200)    add('UPS.MR33-200','ИБП Kehua MR33-200 (200 кВА)','600×1200×2000', t.ups200, 'шт.', '');
  if (t.batteries) add('BAT.S3',   'Шкаф АКБ Kehua S3 (58 кВт·ч)', '600×1200×2000', t.batteries, 'шт.', `${S.autonomyMin} мин автономии`);
  if (t.mdb)       add('MDB',      'Щит MDB',                      '600×1200×2000', t.mdb, 'шт.', '');
  if (t.udb)       add('UDB',      'Щит UDB',                      '600×1200×2000', t.udb, 'шт.', '');
  if (t.pdb)       add('PDB',      'Щит PDB',                      '600×1200×2000', t.pdb, 'шт.', '');

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

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [ { wch: 4 }, { wch: 22 }, { wch: 46 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 28 } ];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Объём поставки');
  const fname = `MDC_GDM600_${t.itKw}kW_${t.racks}racks_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, fname);
}

/* ================== INIT ================== */
function init() {
  const ids = ['mdc-total-racks','mdc-rack-kw',
               'mdc-redundancy','mdc-autonomy','mdc-ashrae',
               'mdc-scs','mdc-skud','mdc-video','mdc-fire','mdc-leak',
               'mdc-with-dgu','mdc-with-tp'];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', update);
    if (el.type === 'number' || el.type === 'text') el.addEventListener('input', update);
  }
  $('mdc-export-bom').addEventListener('click', exportBom);
  update();
}

document.addEventListener('DOMContentLoaded', init);
