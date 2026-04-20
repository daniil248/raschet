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

/* ================== ПЛАНИРОВКА (SVG) ================== */
function renderPlan(r) {
  const host = $('mdc-plan');
  const scale = 0.035;
  const it = CATALOG['IT-HALL-300'];
  const pw = CATALOG['POWER-1600'];

  // IT-часть сверху (itCols × itRows), энергоблоки снизу, справа по длине
  const ox = 30, oy = 30;
  const itW = r.itCols * it.widthMm;
  const itD = r.itRows * it.lengthMm;
  const pwW = r.totals.powerBlocks * pw.widthMm;
  const pwD = pw.lengthMm;
  const totalW = Math.max(itW, pwW) + 60;
  const totalD = itD + pwD + 120;

  const vw = totalW * scale + 2 * ox;
  const vh = totalD * scale + 2 * oy + 30;

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`;

  // === IT-часть ===
  let halls = r.totals.itHalls;
  const itX0 = ox + (totalW - itW) / 2;
  const itY0 = oy;
  for (let row = 0; row < r.itRows && halls > 0; row++) {
    for (let col = 0; col < r.itCols && halls > 0; col++) {
      const x = itX0 + col * it.widthMm * scale;
      const y = itY0 + row * it.lengthMm * scale;
      drawItHall(x, y, it, scale, svg = svg + '');  // placeholder
      svg += hallSvg(x, y, it, scale, halls === r.totals.itHalls - (row * r.itCols + col));
      halls--;
    }
  }

  // === Энергоблоки ===
  const pwX0 = ox + (totalW - pwW) / 2;
  const pwY0 = itY0 + itD * scale + 60;
  for (let i = 0; i < r.totals.powerBlocks; i++) {
    const x = pwX0 + i * pw.widthMm * scale;
    const y = pwY0;
    svg += powerSvg(x, y, pw, scale, i + 1);
  }

  // === ТП / ДГУ — обозначения внизу ===
  let extraY = pwY0 + pwD * scale + 20;
  if (r.totals.tp) {
    svg += `<rect x="${ox}" y="${extraY}" width="${3000 * scale}" height="${3000 * scale}"
            fill="#fff3e0" stroke="#f57c00" stroke-width="1.5"/>`;
    svg += `<text class="zone-label" x="${ox + 1500*scale}" y="${extraY + 1500*scale}"
            text-anchor="middle">ТП 10/0.4</text>`;
  }
  if (r.totals.dgu > 0) {
    const dguX = ox + 3500 * scale;
    for (let i = 0; i < r.totals.dgu; i++) {
      const x = dguX + i * 3500 * scale;
      svg += `<rect x="${x}" y="${extraY}" width="${3000 * scale}" height="${3000 * scale}"
              fill="#ffe0b2" stroke="#e65100" stroke-width="1.5"/>`;
      svg += `<text class="zone-label" x="${x + 1500*scale}" y="${extraY + 1500*scale}"
              text-anchor="middle">ДГУ${i+1}</text>`;
    }
  }

  // Габариты
  svg += `<text class="dim" x="${ox}" y="${vh - 8}">
    Площадка ~ ${r.siteMm.w} × ${r.siteMm.d} мм
    · H внутри 2700 мм
    · все шкафы 600×1200×42U
  </text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
}

function hallSvg(x, y, it, scale, num) {
  const W = it.widthMm * scale, D = it.lengthMm * scale;
  let s = `<g>`;
  s += `<rect x="${x}" y="${y}" width="${W}" height="${D}"
        fill="#e3f2fd" stroke="#1565c0" stroke-width="1.5"/>`;
  // Два ряда стоек по 11 шт., ACU между ними
  const perRow = 11;
  for (let r = 0; r < 2; r++) {
    const ry = r === 0 ? y + 800 * scale : y + (it.lengthMm - 800 - CAB_D) * scale;
    for (let i = 0; i < perRow; i++) {
      const cx = x + (400 + i * 650) * scale;
      const isAcu = (i % 4 === 2);   // каждая 3-я позиция — ACU
      s += `<rect class="${isAcu ? 'crac' : 'rack'}" x="${cx}" y="${ry}"
            width="${CAB_W * scale - 1}" height="${CAB_D * scale - 1}"/>`;
    }
  }
  // PDC по 2 штуки с торцов (верх и низ серверного ряда)
  const pdcXs = [x + 100 * scale, x + (it.widthMm - 800) * scale];
  for (const px of pdcXs) {
    s += `<rect class="ups" x="${px}" y="${y + 600*scale}" width="${CAB_W*scale}" height="${CAB_D*scale}"/>`;
    s += `<rect class="ups" x="${px}" y="${y + (it.lengthMm - 1800)*scale}" width="${CAB_W*scale}" height="${CAB_D*scale}"/>`;
  }
  // Подпись
  s += `<text class="zone-label" x="${x + W/2}" y="${y + 22}" text-anchor="middle">Машзал ${num}</text>`;
  s += `<text class="dim" x="${x + W/2}" y="${y + 36}" text-anchor="middle">${it.widthMm}×${it.lengthMm} мм · 300 кВт</text>`;
  s += `</g>`;
  return s;
}

function powerSvg(x, y, pw, scale, num) {
  const W = pw.widthMm * scale, D = pw.lengthMm * scale;
  let s = `<g>`;
  s += `<rect x="${x}" y="${y}" width="${W}" height="${D}"
        fill="#fff8e1" stroke="#f57f17" stroke-width="1.5"/>`;
  // 6 UPS вверху
  for (let i = 0; i < 6; i++) {
    const cx = x + (400 + i * 700) * scale;
    const sku = i < 4 ? 'ups' : 'ups';   // все ИБП цвет .ups; 4× MR33-300, 2× MR33-200
    s += `<rect class="${sku}" x="${cx}" y="${y + 500*scale}" width="${CAB_W*scale - 1}" height="${CAB_D*scale - 1}"/>`;
  }
  // 10 АКБ в средней полосе
  for (let i = 0; i < 10; i++) {
    const cx = x + (350 + i * 700) * scale;
    s += `<rect class="battery" x="${cx}" y="${y + 2200*scale}" width="${CAB_W*scale - 1}" height="${CAB_D*scale - 1}"/>`;
  }
  // 4 ACU + щиты (MDB/UDB/PDB) внизу
  for (let i = 0; i < 4; i++) {
    const cx = x + (400 + i * 700) * scale;
    s += `<rect class="crac" x="${cx}" y="${y + 3900*scale}" width="${CAB_W*scale - 1}" height="${CAB_D*scale - 1}"/>`;
  }
  for (let i = 0; i < 6; i++) {   // 2 MDB + UDB-IT + UDB-M-IT + UDB-AI + PDB-M-AI
    const cx = x + (3200 + i * 700) * scale;
    s += `<rect class="rack" x="${cx}" y="${y + 3900*scale}" width="${CAB_W*scale - 1}" height="${CAB_D*scale - 1}"/>`;
  }
  // Подписи
  s += `<text class="zone-label" x="${x + W/2}" y="${y + 22}" text-anchor="middle">Энергоблок ${num}</text>`;
  s += `<text class="dim" x="${x + W/2}" y="${y + 36}" text-anchor="middle">${pw.widthMm}×${pw.lengthMm} мм · 1600 кВт UPS · 580 кВт·ч</text>`;
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

/* ================== ЭКСПОРТ (stub) ================== */
function exportBom() {
  alert('BOM-экспорт XLSX будет подключён в подфазе 10.4.');
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
