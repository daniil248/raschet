/* =========================================================================
   mdc-config.js — Конфигуратор модульного ЦОД (серия GDM-600)
   v0.58.90 (Фаза 10.2) — готовые продукты из drawio-референсов

   ВХОДНЫЕ ДАННЫЕ (от пользователя):
     1) Количество стоек
     2) Мощность на стойку, кВт
   Остальное рассчитывается автоматически.

   КАТАЛОГ ГОТОВЫХ ПРОДУКТОВ (из drawio 26003/25006/26009):
   ───────────────────────────────────────────────────────────
   IT-HALL-300        Машзал 300 кВт:
                      22 стойки (2 ряда × 11) + 10 inRow-ACU 65кВт
                      + 4 PDC + 1 MonitoringRack + 2 AisleDoor
                      Габарит: 7700×7300 (3 модуля × 2500-3100)
   POWER-1600         Энергоблок 1600 кВт (Kehua MR33):
                      6 UPS (4×MR33-300 + 2×MR33-200) = 1600 кВт
                      10 АКБ S3 (58 кВт·ч каждая, 580 кВт·ч всего)
                      4 inRow-ACU + 2 MDB + UDB-IT + UDB-M-IT
                      + UDB-AI + PDB-M-AI + MonitoringRack + 10 JB
                      ODU-полка 6200×2000 снаружи
                      Габарит: 8700×7300

   Референс-площадка 26009 QazCloud:
     4 × IT-HALL-300 (2×2 сетка) + 2 × POWER-1600 + 4 ДГУ + ТП 10/0.4
   ========================================================================= */

const $ = (id) => document.getElementById(id);

// ================== КАТАЛОГ МОДУЛЬНЫХ ПРОДУКТОВ ==================
const CAB_W = 600, CAB_D = 1200;
const CATALOG = {
  'IT-HALL-300': {
    kind: 'IT',
    label: 'Машзал 300 кВт (22 стойки)',
    widthMm: 7700,           // 2 ряда стоек + центральный горячий коридор
    lengthMm: 7300,
    itKwRated: 300,
    racks: 22,
    acu: 10,                 // inRow 65 кВт
    acuKwEach: 65,
    pdc: 4,
    monitoring: 1,
    aisleDoors: 2,
    // Визуальная раскладка: две длинные полосы по лицевым сторонам стоек.
    // Ряд: pattern 11 позиций (8 стоек + 3 ACU) × 2 ряда = 16 SR + 6 ACU.
    // Но паспорт — 22 SR + 10 ACU (торцевые карманы). Визуализируем как
    // 2 ряда по 11 стоек + 5 ACU в середине ряда.
  },
  'POWER-1600': {
    kind: 'POWER',
    label: 'Энергоблок 1600 кВт (Kehua MR33)',
    widthMm: 8700,
    lengthMm: 7300,
    upsKw: 1600,
    upsUnits: [
      { sku: 'Kehua MR33-300', kw: 300, count: 4 },
      { sku: 'Kehua MR33-200', kw: 200, count: 2 },
    ],
    batteries: { sku: 'Kehua S3', kwhEach: 58, count: 10, totalKwh: 580 },
    acu: 4,                  // для охлаждения самого энергоблока
    acuKwEach: 65,
    mdb: 2,
    udbIt: 1,
    udbMit: 1,
    udbAi: 1,
    pdbMai: 1,
    monitoring: 1,
    jb: 10,
    oduBay: { widthMm: 6200, lengthMm: 2000 },
  },
};

// ================== СОСТОЯНИЕ ==================
const S = {
  totalRacks: 88,            // входной параметр: всего стоек в проекте
  rackKw: 15,                // входной параметр: кВт на стойку
  redundancy: 'N+1',
  autonomyMin: 15,
  ashrae: 'A2',
  scs: true, skud: true, video: true, fire: true, leak: false,
  withDgu: true,
  withTp:  true,
};

function read() {
  S.totalRacks  = Number($('mdc-total-racks').value) || 1;
  S.rackKw      = Number($('mdc-rack-kw').value) || 15;
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

/* ================== РАСЧЁТ ================== */
function compute() {
  const it = CATALOG['IT-HALL-300'];
  const pw = CATALOG['POWER-1600'];

  // --- Подбор IT-модулей (машзалов) ---
  // 22 стойки на машзал — фиксированный типоразмер.
  const itHalls = Math.ceil(S.totalRacks / it.racks);
  // Полезная мощность проекта
  const itKw = S.totalRacks * S.rackKw;
  // Средняя загрузка машзала
  const avgKwPerHall = itKw / itHalls;
  // Предупреждение, если превышает паспорт 300 кВт
  const overload = avgKwPerHall > it.itKwRated;

  // --- Подбор энергоблоков ---
  // Учитываем резервирование и КПД ИБП/cos phi
  const cosPhi = 0.9;
  const redundFactor = S.redundancy === '2N' ? 2 : (S.redundancy === 'N+1' ? 1.2 : 1.0);
  const upsKvaTotal  = Math.ceil(itKw / cosPhi * redundFactor / 50) * 50;
  // Один энергоблок = 1600 кВт UPS (1778 кВА)
  const powerBlocks = Math.ceil(upsKvaTotal / (pw.upsKw / cosPhi));

  // --- Автономия АКБ ---
  // Паспорт 580 кВт·ч на энергоблок на 100% нагрузки = 580/1600×60 ≈ 21 мин.
  // Для заявленной автономии: коэффициент
  const battFactor = S.autonomyMin / 21;     // > 1 → нужны доп. шкафы
  const extraBatt  = battFactor > 1
    ? Math.ceil(powerBlocks * pw.batteries.count * (battFactor - 1))
    : 0;

  // --- Итоговые количества по всем блокам ---
  const totals = {
    itHalls,
    powerBlocks,
    itKw,
    upsKvaTotal,
    racks: itHalls * it.racks,
    acu: itHalls * it.acu + powerBlocks * pw.acu,
    ups: powerBlocks * (pw.upsUnits[0].count + pw.upsUnits[1].count),
    upsMr33_300: powerBlocks * pw.upsUnits[0].count,
    upsMr33_200: powerBlocks * pw.upsUnits[1].count,
    batteries: powerBlocks * pw.batteries.count + extraBatt,
    mdb: powerBlocks * pw.mdb,
    udbIt: powerBlocks * pw.udbIt,
    udbMit: powerBlocks * pw.udbMit,
    udbAi: powerBlocks * pw.udbAi,
    pdbMai: powerBlocks * pw.pdbMai,
    pdc: itHalls * it.pdc,
    monitoring: itHalls * it.monitoring + powerBlocks * pw.monitoring,
    jb: powerBlocks * pw.jb,
    // ДГУ: 1 на энергоблок + 1 резерв, с учётом N+1 / 2N
    dgu: S.withDgu
      ? (S.redundancy === '2N' ? powerBlocks * 2 : powerBlocks + 1)
      : 0,
    tp: S.withTp ? 1 : 0,
  };

  // --- Габариты площадки ---
  // IT-часть: itHalls = 1..2 → 1 ряд, 3..4 → 2×2, 5..6 → 3×2, и т.д.
  const itCols = Math.ceil(Math.sqrt(itHalls));
  const itRows = Math.ceil(itHalls / itCols);
  const itBuildMm = { w: itCols * it.widthMm, d: itRows * it.lengthMm };
  const pwBuildMm = { w: powerBlocks * pw.widthMm, d: pw.lengthMm };
  const siteMm = {
    w: Math.max(itBuildMm.w, pwBuildMm.w) + 4000 /*отступы*/,
    d: itBuildMm.d + pwBuildMm.d + 6000,
  };

  return {
    totals, overload, itCols, itRows,
    itBuildMm, pwBuildMm, siteMm,
    avgKwPerHall, battFactor, extraBatt,
  };
}

/* ================== СВОДКА ================== */
function renderSummary(r) {
  const t = r.totals;
  const el = $('mdc-summary');
  el.innerHTML = `
    <div class="card"><span class="label">Стоек всего</span><span class="value">${t.racks}</span></div>
    <div class="card"><span class="label">IT-нагрузка</span><span class="value">${t.itKw} кВт</span></div>
    <div class="card ${r.overload ? 'warn' : 'ok'}">
      <span class="label">Машзалов (по 22 стойки)</span>
      <span class="value">${t.itHalls}${r.overload ? ' ⚠' : ''}</span>
    </div>
    <div class="card"><span class="label">Энергоблоков 1600 кВт</span><span class="value">${t.powerBlocks}</span></div>
    <div class="card"><span class="label">Kehua MR33-300</span><span class="value">${t.upsMr33_300} шт.</span></div>
    <div class="card"><span class="label">Kehua MR33-200</span><span class="value">${t.upsMr33_200} шт.</span></div>
    <div class="card"><span class="label">АКБ Kehua S3</span><span class="value">${t.batteries} шкафов</span></div>
    <div class="card"><span class="label">inRow-ACU (65 кВт)</span><span class="value">${t.acu}</span></div>
    <div class="card"><span class="label">MDB / UDB / PDC</span><span class="value">${t.mdb}/${t.udbIt + t.udbMit + t.udbAi + t.pdbMai}/${t.pdc}</span></div>
    ${t.dgu ? `<div class="card"><span class="label">ДГУ</span><span class="value">${t.dgu} шт.</span></div>` : ''}
    ${t.tp  ? `<div class="card"><span class="label">ТП 10/0.4</span><span class="value">${t.tp}</span></div>` : ''}
    <div class="card"><span class="label">Площадка</span><span class="value">${r.siteMm.w} × ${r.siteMm.d} мм</span></div>
  `;
  if (r.overload) {
    el.innerHTML += `<div style="grid-column: 1/-1; color:#e65100; font-size:11px; padding:4px;">
      ⚠ средняя мощность на машзал ${Math.round(r.avgKwPerHall)} кВт превышает паспортные 300 кВт.
         Уменьшите кВт/стойку или увеличьте число стоек (больше машзалов).
    </div>`;
  }
}

/* ================== ПЛАНИРОВКА (SVG) ==================
   Компоновка по drawio-референсу 26009 QazCloud:
   IT-блок (2×2 машзала) слева, энергоблоки в ряд справа,
   ТП и ДГУ — наружные блоки снизу. Единственный пользовательский
   вход = число стоек + кВт/стойку → всё остальное детерминировано.
   ======================================================= */
function renderPlan(r) {
  const host = $('mdc-plan');
  const it = CATALOG['IT-HALL-300'];
  const pw = CATALOG['POWER-1600'];
  const t  = r.totals;

  // Масштаб: делаем так, чтобы самый большой габарит уложился в 1100px.
  const rawW = Math.max(r.itBuildMm.w + r.pwBuildMm.w + 4000, 20000);
  const rawD = Math.max(r.itBuildMm.d, r.pwBuildMm.d) + 12000;
  const scale = Math.min(1100 / rawW, 0.05);

  const ox = 20, oy = 30;
  const itX0 = ox;
  const itY0 = oy;
  // Энергоблоки пристыкованы справа к IT-блоку
  const pwX0 = itX0 + r.itBuildMm.w * scale + 1500 * scale;
  const pwY0 = oy;

  const vw = Math.max(pwX0 + r.pwBuildMm.w * scale,
                      itX0 + r.itBuildMm.w * scale) + 2 * ox;
  const vh = Math.max(r.itBuildMm.d, r.pwBuildMm.d) * scale
           + 8000 * scale /*ТП/ДГУ*/ + 2 * oy + 40;

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa">`;

  // === IT-блок: 2×N сетка машзалов ===
  let num = 1;
  for (let row = 0; row < r.itRows; row++) {
    for (let col = 0; col < r.itCols; col++) {
      if (num > t.itHalls) break;
      const x = itX0 + col * it.widthMm * scale;
      const y = itY0 + row * it.lengthMm * scale;
      svg += hallSvg(x, y, it, scale, num);
      num++;
    }
  }

  // === Энергоблоки в колонку справа ===
  for (let i = 0; i < t.powerBlocks; i++) {
    const x = pwX0;
    const y = pwY0 + i * pw.lengthMm * scale;
    svg += powerSvg(x, y, pw, scale, i + 1, t);
  }

  // === ТП / ДГУ снизу ===
  const extraY = oy + Math.max(r.itBuildMm.d, r.pwBuildMm.d) * scale + 30;
  let extraX = ox;
  if (t.tp) {
    const ew = 4000 * scale, eh = 3000 * scale;
    svg += `<rect x="${extraX}" y="${extraY}" width="${ew}" height="${eh}"
            fill="#fff3e0" stroke="#f57c00" stroke-width="1.5" rx="2"/>`;
    svg += `<text class="zone-label" x="${extraX + ew/2}" y="${extraY + eh/2 + 4}"
            text-anchor="middle">ТП 10/0.4</text>`;
    extraX += ew + 10;
  }
  for (let i = 0; i < t.dgu; i++) {
    const ew = 3500 * scale, eh = 3000 * scale;
    svg += `<rect x="${extraX}" y="${extraY}" width="${ew}" height="${eh}"
            fill="#ffe0b2" stroke="#e65100" stroke-width="1.5" rx="2"/>`;
    svg += `<text class="zone-label" x="${extraX + ew/2}" y="${extraY + eh/2 + 4}"
            text-anchor="middle">ДГУ-${i+1}</text>`;
    extraX += ew + 8;
  }

  svg += `<text class="dim" x="${ox}" y="${vh - 6}">
    Площадка ~ ${r.siteMm.w} × ${r.siteMm.d} мм ·
    H внутри 2700 мм · все шкафы 600×1200×42U ·
    компоновка по drawio 26009 QazCloud
  </text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
}

/* Машзал 300 кВт (по drawio 26009 IT-HALL-A):
   габарит 7700×7300 мм, внутри:
   ─ 2 длинные полосы стоек по 8 SR + 2 ACU + торцевые PDC,
   ─ центральный холодный коридор ~2000 мм,
   ─ в торцах по двери коридора (AisleDoor). */
function hallSvg(x, y, it, scale, num) {
  const W = it.widthMm * scale, D = it.lengthMm * scale;
  const cw = CAB_W * scale, cd = CAB_D * scale;
  let s = `<g>`;
  // стены
  s += `<rect x="${x}" y="${y}" width="${W}" height="${D}"
        fill="#e3f2fd" stroke="#1565c0" stroke-width="1.5" rx="2"/>`;
  // центральный холодный коридор (визуальная полоса)
  const aisleH = 2000 * scale;
  s += `<rect x="${x + 500 * scale}" y="${y + D/2 - aisleH/2}"
        width="${W - 1000 * scale}" height="${aisleH}"
        fill="#f5f5f5" stroke="none"/>`;

  // два ряда стоек (лицом к коридору) + ACU через каждые 4 стойки
  // ряд: PDC + 11 позиций (SR/ACU) + PDC = всего 13 шкафов × 600 = 7800 мм
  // помещается в 7700 → сжимаем шаг до 590 мм для визуала
  const perRow = 13;
  const step = (W - 200 * scale) / perRow;
  for (let row = 0; row < 2; row++) {
    const ry = row === 0
      ? y + D/2 - aisleH/2 - cd           // верхний ряд ПРИЖАТ к коридору
      : y + D/2 + aisleH/2;                // нижний ряд ПРИЖАТ к коридору
    for (let i = 0; i < perRow; i++) {
      const cx = x + 100 * scale + i * step;
      let cls;
      if (i === 0 || i === perRow - 1)     cls = 'ups';     // PDC по краям
      else if ((i - 1) % 4 === 3)          cls = 'crac';    // ACU каждая 4-я
      else                                 cls = 'rack';    // серверная стойка
      s += `<rect class="${cls}" x="${cx}" y="${ry}" width="${cw - 1}" height="${cd - 1}"/>`;
    }
  }

  // Торцевые двери холодного коридора
  s += `<line x1="${x + 400*scale}" y1="${y + D/2}" x2="${x + 700*scale}" y2="${y + D/2}"
        stroke="#1976d2" stroke-width="2"/>`;
  s += `<line x1="${x + W - 700*scale}" y1="${y + D/2}" x2="${x + W - 400*scale}" y2="${y + D/2}"
        stroke="#1976d2" stroke-width="2"/>`;

  // Заголовки
  s += `<text class="zone-label" x="${x + W/2}" y="${y + 16}" text-anchor="middle">Машзал ${num}</text>`;
  s += `<text class="dim" x="${x + W/2}" y="${y + D - 6}" text-anchor="middle">${it.widthMm}×${it.lengthMm} мм · 300 кВт · 22 SR + 10 ACU</text>`;
  s += `</g>`;
  return s;
}

/* Энергоблок 1600 кВт (по drawio 26009 POWER-BLOCK):
   габарит 8700×7300 мм. Расположение:
   ─ ряд 1 (вверху): 6 UPS (4×MR33-300 + 2×MR33-200)
   ─ ряд 2: 10 АКБ S3
   ─ ряд 3: 4 ACU + 2 MDB + 4 UDB/PDB + Monitoring
   ─ ODU-полка 6200×2000 показана наружным прямоугольником. */
function powerSvg(x, y, pw, scale, num, totals) {
  const W = pw.widthMm * scale, D = pw.lengthMm * scale;
  const cw = CAB_W * scale, cd = CAB_D * scale;
  let s = `<g>`;
  s += `<rect x="${x}" y="${y}" width="${W}" height="${D}"
        fill="#fff8e1" stroke="#f57f17" stroke-width="1.5" rx="2"/>`;

  // — Ряд 1: UPS —
  const upsCount = 6;
  const upsStep = (W - 400 * scale) / upsCount;
  for (let i = 0; i < upsCount; i++) {
    const cx = x + 200 * scale + i * upsStep;
    const cy = y + 700 * scale;
    s += `<rect class="ups" x="${cx}" y="${cy}" width="${cw - 1}" height="${cd - 1}"/>`;
    s += `<text class="dim" x="${cx + cw/2}" y="${cy + cd/2 + 3}" text-anchor="middle"
          style="font-size:8px;fill:#fff;">${i < 4 ? '300' : '200'}</text>`;
  }

  // — Ряд 2: АКБ S3 —
  const batCount = 10;
  const batStep = (W - 400 * scale) / batCount;
  for (let i = 0; i < batCount; i++) {
    const cx = x + 200 * scale + i * batStep;
    const cy = y + 2700 * scale;
    s += `<rect class="battery" x="${cx}" y="${cy}" width="${cw - 1}" height="${cd - 1}"/>`;
  }

  // — Ряд 3: ACU + щиты —
  // 4 ACU слева, 2 MDB, UDB-IT, UDB-M-IT, UDB-AI, PDB-M-AI, Monitoring — всего 11
  const row3 = [
    ['crac','ACU'],['crac','ACU'],['crac','ACU'],['crac','ACU'],
    ['rack','MDB'],['rack','MDB'],
    ['rack','UDB-IT'],['rack','UDB-MIT'],['rack','UDB-AI'],['rack','PDB-MAI'],
    ['ups','MON'],
  ];
  const r3step = (W - 400 * scale) / row3.length;
  for (let i = 0; i < row3.length; i++) {
    const cx = x + 200 * scale + i * r3step;
    const cy = y + 4700 * scale;
    s += `<rect class="${row3[i][0]}" x="${cx}" y="${cy}" width="${cw - 1}" height="${cd - 1}"/>`;
    s += `<text class="dim" x="${cx + cw/2}" y="${cy + cd + 10}" text-anchor="middle"
          style="font-size:7px;">${row3[i][1]}</text>`;
  }

  // — ODU-полка справа снаружи —
  const oduW = pw.oduBay.widthMm * scale, oduH = pw.oduBay.lengthMm * scale;
  s += `<rect x="${x + W - oduW - 100*scale}" y="${y + D - oduH - 100*scale}"
        width="${oduW}" height="${oduH}"
        fill="#ffccbc" stroke="#d84315" stroke-width="1" stroke-dasharray="3,2" rx="2"/>`;
  s += `<text class="dim" x="${x + W - oduW/2 - 100*scale}" y="${y + D - oduH/2 - 100*scale + 3}"
        text-anchor="middle">ODU-полка</text>`;

  s += `<text class="zone-label" x="${x + W/2}" y="${y + 16}" text-anchor="middle">Энергоблок ${num}</text>`;
  s += `<text class="dim" x="${x + W/2}" y="${y + 30}" text-anchor="middle">${pw.widthMm}×${pw.lengthMm} мм · 1600 кВт · 580 кВт·ч</text>`;
  s += `</g>`;
  return s;
}

/* ================== UPDATE ================== */
function update() {
  read();
  const r = compute();
  renderSummary(r);
  renderPlan(r);
}

/* ================== ЭКСПОРТ BOM (XLSX) ==================
   «Объём поставки» в стиле 26003-…-SCO-001: разделы (IT-залы / энергоблоки
   / внешние блоки / слаботочка), колонки № / Обозначение / Наименование /
   Габарит / Кол-во / Ед.изм. / Примечание.
   ======================================================= */
function exportBom() {
  if (typeof window === 'undefined' || !window.XLSX) {
    alert('SheetJS не загружен. Проверьте интернет-подключение (CDN).');
    return;
  }
  const r = compute();
  const t = r.totals;
  const it = CATALOG['IT-HALL-300'];
  const pw = CATALOG['POWER-1600'];

  const rows = [];
  rows.push(['Объём поставки — модульный ЦОД GDM-600']);
  rows.push([`IT-нагрузка: ${t.itKw} кВт · стоек ${t.racks} · ${S.rackKw} кВт/стойку · резерв ${S.redundancy}`]);
  rows.push([`Машзалов: ${t.itHalls} · Энергоблоков: ${t.powerBlocks} · Автономия: ${S.autonomyMin} мин · ASHRAE ${S.ashrae}`]);
  rows.push([]);
  rows.push(['№', 'Обозначение', 'Наименование', 'Габарит, мм', 'Кол-во', 'Ед.', 'Примечание']);

  let n = 0;
  const add = (code, name, size, qty, unit, note) => {
    rows.push([++n, code, name, size || '', qty, unit || 'шт.', note || '']);
  };
  const sec = (title) => rows.push(['', `— ${title} —`]);

  // === 1. IT-залы ===
  sec(`Машзалы IT-HALL-300 (${t.itHalls} шт.)`);
  add('IT-HALL-300', 'Модуль машзала 300 кВт (компоновка)',
      `${it.widthMm}×${it.lengthMm}×2700`, t.itHalls, 'компл.',
      '22 стойки + 10 ACU + 4 PDC + Monitoring');
  add('SR.42U', 'Серверная стойка 42U',
      '600×1200×2000', t.racks, 'шт.',
      `${S.rackKw} кВт/стойку`);
  add('ACU.inRow.65', 'Кондиционер inRow DX 65 кВт',
      '600×1200×2000', t.itHalls * it.acu, 'шт.',
      `${it.acu} на машзал (N+1)`);
  add('PDC', 'Распределительный шкаф PDC',
      '600×1200×2000', t.pdc, 'шт.', `4 на машзал`);
  add('MON.IT', 'Шкаф мониторинга машзала',
      '600×1200×2000', t.itHalls * it.monitoring, 'шт.', '');
  add('DOOR.AISLE', 'Торцевая дверь холодного коридора',
      '', t.itHalls * it.aisleDoors, 'шт.', '2 на машзал');

  // === 2. Энергоблоки ===
  sec(`Энергоблоки POWER-1600 (${t.powerBlocks} шт.)`);
  add('POWER-1600', 'Модуль энергоблока 1600 кВт (компоновка)',
      `${pw.widthMm}×${pw.lengthMm}×2700`, t.powerBlocks, 'компл.',
      'UPS + АКБ + ACU + щиты + ODU-полка');
  add('UPS.MR33-300', 'ИБП Kehua MR33-300 (300 кВА)',
      '600×1200×2000', t.upsMr33_300, 'шт.', '');
  add('UPS.MR33-200', 'ИБП Kehua MR33-200 (200 кВА)',
      '600×1200×2000', t.upsMr33_200, 'шт.', '');
  add('BAT.S3', 'Шкаф АКБ Kehua S3 (58 кВт·ч)',
      '600×1200×2000', t.batteries, 'шт.',
      `${S.autonomyMin} мин автономии` + (r.extraBatt ? ` (+${r.extraBatt} доп.)` : ''));
  add('ACU.inRow.65.PW', 'Кондиционер inRow DX 65 кВт (для UPS/АКБ)',
      '600×1200×2000', t.powerBlocks * pw.acu, 'шт.',
      `${pw.acu} на энергоблок`);
  add('MDB', 'Главный распределительный щит MDB',
      '600×1200×2000', t.mdb, 'шт.', '2 на энергоблок');
  add('UDB.IT', 'Щит UDB-IT (распределение на IT)',
      '600×1200×2000', t.udbIt, 'шт.', '');
  add('UDB.M-IT', 'Щит UDB-M-IT (механика IT)',
      '600×1200×2000', t.udbMit, 'шт.', '');
  add('UDB.AI', 'Щит UDB-AI (общепроходные потребители)',
      '600×1200×2000', t.udbAi, 'шт.', '');
  add('PDB.M-AI', 'Щит PDB-M-AI',
      '600×1200×2000', t.pdbMai, 'шт.', '');
  add('MON.PW', 'Шкаф мониторинга энергоблока',
      '600×1200×2000', t.powerBlocks * pw.monitoring, 'шт.', '');
  add('JB', 'Соединительная коробка (Junction Box)',
      '', t.jb, 'шт.', '10 на энергоблок');
  add('ODU.BAY', 'ODU-полка (наружные блоки DX)',
      `${pw.oduBay.widthMm}×${pw.oduBay.lengthMm}`, t.powerBlocks, 'компл.',
      'наружный монтаж');

  // === 3. Внешние блоки ===
  if (t.tp || t.dgu) {
    sec('Внешние блоки');
    if (t.tp)  add('TP.10/0.4', 'Трансформаторная подстанция 10/0.4 кВ', '', t.tp, 'компл.', '');
    if (t.dgu) add('DGU', 'Дизель-генераторная установка', '', t.dgu, 'шт.', `резерв ${S.redundancy}`);
  }

  // === 4. Слаботочные системы ===
  const low = [];
  if (S.scs)   low.push(['SCS',   'СКС: патч-панели + коммутация',         t.racks,    'комплект на стойку']);
  if (S.skud)  low.push(['SKUD',  'СКУД (вход + модули)',                   t.itHalls + t.powerBlocks, 'на модуль']);
  if (S.video) low.push(['CCTV',  'Видеонаблюдение (2 камеры на модуль)',   2 * (t.itHalls + t.powerBlocks), '']);
  if (S.fire)  low.push(['FIRE',  'Газовое пожаротушение',                  t.itHalls + t.powerBlocks, 'на модуль']);
  if (S.leak)  low.push(['LEAK',  'Контроль протечек',                      t.itHalls + t.powerBlocks, 'на модуль']);
  if (low.length) {
    sec('Слаботочные системы');
    for (const [c, nm, q, note] of low) add(c, nm, '', q, 'компл.', note);
  }

  // === Лист ===
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 }, { wch: 16 }, { wch: 44 }, { wch: 18 },
    { wch: 8 }, { wch: 8 }, { wch: 28 },
  ];
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
    if (el) el.addEventListener('change', update);
    if (el && (el.type === 'number' || el.type === 'text')) el.addEventListener('input', update);
  }
  $('mdc-export-bom').addEventListener('click', exportBom);
  update();
}

document.addEventListener('DOMContentLoaded', init);
