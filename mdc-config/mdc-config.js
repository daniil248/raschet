/* =========================================================================
   mdc-config.js — Конфигуратор модульного ЦОД (GDM-600)

   MVP v0.58.87 (Фаза 1.21.1):
   - Wizard: ширина 2400/3000 мм, длина 6058/9000/12192/15000 мм,
     IT-нагрузка, резервирование, ИБП, CRAC, слаботочка.
   - Расчёт числа стоек, ИБП-шкафов, АКБ-шкафов, CRAC-модулей.
   - Top-view SVG планировка с 4 зонами:
     [CRAC | серверная | сервисный коридор | ИБП+АКБ]
   - Пока без BOM-экспорта (заглушка), без каталога GDM600K из PDF.
     Каталог будет импортирован на следующей итерации из drawio-файлов.
   ========================================================================= */

const $ = (id) => document.getElementById(id);

const S = {
  width: 3000,
  length: 12192,
  count: 1,
  itKw: 600,
  rackKw: 30,
  redundancy: 'N+1',
  upsSeries: 'gdm600k',
  autonomyMin: 15,
  cracType: 'inrow-dx',
  ashrae: 'A2',
  scs: true, skud: true, video: true, fire: true, leak: false,
};

function read() {
  S.width        = Number($('mdc-width').value) || 3000;
  S.length       = Number($('mdc-length').value) || 12192;
  S.count        = Number($('mdc-count').value) || 1;
  S.itKw         = Number($('mdc-it-kw').value) || 600;
  S.rackKw       = Number($('mdc-rack-kw').value) || 30;
  S.redundancy   = $('mdc-redundancy').value;
  S.upsSeries    = $('mdc-ups-series').value;
  S.autonomyMin  = Number($('mdc-autonomy').value) || 15;
  S.cracType     = $('mdc-crac-type').value;
  S.ashrae       = $('mdc-ashrae').value;
  S.scs   = $('mdc-scs').checked;
  S.skud  = $('mdc-skud').checked;
  S.video = $('mdc-video').checked;
  S.fire  = $('mdc-fire').checked;
  S.leak  = $('mdc-leak').checked;
}

/* ================== РАСЧЁТ ================== */
function compute() {
  // Стойки
  const racksNeeded = Math.ceil(S.itKw / Math.max(1, S.rackKw));
  // Резервирование стоек не требуется, но охлаждение — требуется
  // ИБП-мощность с учётом cos phi и резервирования:
  const cosPhi = 0.9;
  const redundFactor = S.redundancy === '2N' ? 2 : (S.redundancy === 'N+1' ? 1.2 : 1.0);
  const upsKva = Math.ceil((S.itKw / cosPhi) * redundFactor / 50) * 50;
  // Типовой модуль GDM-600K — до 600 кВт/шкаф, MR33 — до 1200.
  const upsShelfKw = (S.upsSeries === 'gdm600k') ? 600 :
                     (S.upsSeries === 'kehua-mr33') ? 1200 : 600;
  const upsShelves = Math.ceil((upsKva * cosPhi) / upsShelfKw);
  // АКБ: упрощённо 3.5 кВт на батарейный шкаф на 15 мин / 75 VRLA блоков
  const battPerShelfKw15 = 3.5;
  const battShelves = Math.ceil((upsKva * cosPhi) * (S.autonomyMin / 15) / battPerShelfKw15);
  // CRAC: inRow 40 кВт / модуль; perimeter ~ 100 кВт/модуль
  const cracKwPerUnit = (S.cracType === 'perimeter-dx') ? 100 :
                        (S.cracType === 'freecooling')  ? 80  : 40;
  const cracN = Math.ceil(S.itKw / cracKwPerUnit);
  const cracRedund = S.redundancy === '2N' ? cracN : Math.max(cracN + 1, Math.ceil(cracN * 1.2));

  // Проверка: поместятся ли все стойки? Модули стыкуются по ширине,
  // в каждом модуле 2 ряда стоек (back-to-back) длиной (S.length − CRAC − UPS).
  const ZONE_CRAC_LEN = 1500;  // мм, зона CRAC у торца
  const ZONE_UPS_LEN  = 2400;  // зона ИБП+АКБ у другого торца
  const serverLenPerMod = Math.max(0, S.length - ZONE_CRAC_LEN - ZONE_UPS_LEN);
  const racksPerRow     = Math.floor(serverLenPerMod / 600);
  const racksFit        = racksPerRow * 2 * S.count;
  const racksOk         = racksFit >= racksNeeded;
  // Вместимость inRow-ACU: по 1 ACU на 1200 мм в среднем ряду, по рядам на модуль
  const acuPerMod       = Math.floor(serverLenPerMod / 1200);
  const acuCap          = acuPerMod * S.count;
  const acuOk           = (S.cracType === 'inrow-dx' || S.cracType === 'inrow-cw')
                        ? (acuCap >= cracRedund) : true;

  return {
    racksNeeded, racksFit, racksOk,
    upsKva, upsShelves, battShelves,
    cracN, cracRedund, acuCap, acuOk,
    serverLenPerMod, racksPerRow,
  };
}

/* ================== СВОДКА ================== */
function renderSummary(r) {
  const el = $('mdc-summary');
  el.innerHTML = `
    <div class="card"><span class="label">IT-нагрузка</span><span class="value">${S.itKw} кВт</span></div>
    <div class="card"><span class="label">Стоек нужно</span><span class="value">${r.racksNeeded}</span></div>
    <div class="card ${r.racksOk ? 'ok' : 'warn'}">
      <span class="label">Мест для стоек</span>
      <span class="value">${r.racksFit} ${r.racksOk ? '✓' : '✗ мало'}</span>
    </div>
    <div class="card"><span class="label">ИБП-мощность</span><span class="value">${r.upsKva} кВА</span></div>
    <div class="card"><span class="label">Шкафов ИБП</span><span class="value">${r.upsShelves}</span></div>
    <div class="card"><span class="label">АКБ-шкафов</span><span class="value">${r.battShelves}</span></div>
    <div class="card ${r.acuOk ? 'ok' : 'warn'}">
      <span class="label">CRAC (с резервом)</span>
      <span class="value">${r.cracRedund}${r.acuOk ? '' : ' ✗'}</span>
    </div>
    <div class="card"><span class="label">Здание</span><span class="value">${S.length} × ${S.width * S.count} мм</span></div>
  `;
}

/* ================== ПЛАНИРОВКА (SVG top-view) ================== */
// Модель:
// - Модули стыкуются по ШИРОКОЙ стороне (борт-в-борт): общая ширина
//   здания = S.width × S.count, длина общая = S.length.
// - Ширина 2400/3000 мм указана ВНУТРИ, без стенок (рисуем чистый интерьер).
// - Внутри каждого модуля по длине зоны: [CRAC | серверная | ИБП+АКБ].
// - В серверной — два ряда стоек (back-to-back) + средний ряд inRow-ACU,
//   как в референсах 26003 и 25006 (Top row 6×SR, Mid 4×ACU, Bot 6×SR).
// - Количество стоек и CRAC определяется РАСЧЁТОМ из IT-мощности и
//   kW/стойку — заполнение идёт слева направо через все модули.
function renderPlan(r) {
  const host = $('mdc-plan');
  const scale = 0.055;

  const L = S.length;                  // длина сборки (общая для всех модулей)
  const W = S.width * S.count;         // суммарная ширина (стыковка боками)
  const ox = 40, oy = 40;
  const vw = Math.max(700, L * scale + 2 * ox);
  const vh = Math.max(260, W * scale + 2 * oy + 30);

  // Зоны по длине
  const ZX_CRAC = 1500;
  const ZX_UPS  = 2400;
  const serverLen = Math.max(3000, L - ZX_CRAC - ZX_UPS);

  // Геометрия внутри модуля по ширине (transverse):
  // [ряд стоек A 1200 | ACU 300 | ряд стоек B 1200]. Остальное — служебные
  // проходы (снаружи и между рядами). Для 2400 мм ACU ужимается до 200 мм,
  // проходы — до 100 мм.
  const RACK_DEPTH = 1200;
  const ACU_DEPTH  = S.width >= 3000 ? 300 : 200;
  const sidePad = Math.max(50, (S.width - RACK_DEPTH*2 - ACU_DEPTH) / 2);

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`;

  // === Общие плановые зоны (раскрашиваем по всей ширине сборки) ===
  // CRAC end
  svg += `<rect class="zone-crac" x="${ox}" y="${oy}" width="${ZX_CRAC*scale}" height="${W*scale}"/>`;
  // Серверная
  const srvX = ox + ZX_CRAC*scale;
  const srvW = serverLen * scale;
  svg += `<rect class="zone-srv"  x="${srvX}" y="${oy}" width="${srvW}" height="${W*scale}"/>`;
  // ИБП+АКБ
  const upsX = srvX + srvW;
  svg += `<rect class="zone-ups"  x="${upsX}" y="${oy}" width="${ZX_UPS*scale}" height="${W*scale}"/>`;

  // Подписи зон (сверху)
  svg += `<text class="zone-label" x="${ox + ZX_CRAC*scale/2}" y="${oy - 10}" text-anchor="middle">CRAC</text>`;
  svg += `<text class="zone-label" x="${srvX + srvW/2}"        y="${oy - 10}" text-anchor="middle">Серверная</text>`;
  svg += `<text class="zone-label" x="${upsX + ZX_UPS*scale/2}" y="${oy - 10}" text-anchor="middle">ИБП + АКБ</text>`;

  // === Расставляем стойки и inRow-ACU ===
  // Шаг стойки по длине — 600 мм (плюс маленький зазор).
  const RACK_STEP = 600;
  const racksPerRow = Math.floor(serverLen / RACK_STEP);   // максимум в одном ряду
  // 2 ряда × количество модулей — всего мест для стоек.
  const rowsCount = 2 * S.count;
  const racksTotalCap = racksPerRow * rowsCount;
  const racksToPlace  = Math.min(r.racksNeeded, racksTotalCap);

  // inRow-ACU шаг — 1200 мм (1 ACU ≈ 4 стойкам). Авто-количество из расчёта.
  const acuPerRow      = Math.floor(serverLen / 1200);
  const acuRowsCount   = rowsCount / 2;                      // один ACU-ряд на стык двух рядов стоек
  const acuTotalCap    = acuPerRow * acuRowsCount;
  const acuNeeded      = Math.min(r.cracRedund, acuTotalCap);

  // Позиции рядов (y в мм от верха сборки):
  // Модуль m: центр ACU в y = m*S.width + S.width/2
  //           ряд A стоек: y = m*S.width + sidePad
  //           ряд B стоек: y = m*S.width + S.width - sidePad - RACK_DEPTH
  // Ряды стоек раскладываем ПО-ОЧЕРЕДИ через все модули (заполнение сверху вниз).
  const rackSlots = []; // { xMm, yMm }
  const acuSlots  = [];
  for (let m = 0; m < S.count; m++) {
    const yTop = m * S.width;
    const yRowA  = yTop + sidePad;
    const yRowB  = yTop + S.width - sidePad - RACK_DEPTH;
    const yAcu   = yTop + sidePad + RACK_DEPTH;     // между рядами A и B
    for (let i = 0; i < racksPerRow; i++) {
      rackSlots.push({ xMm: ZX_CRAC + i*RACK_STEP, yMm: yRowA, row: 'A', mod: m });
    }
    for (let i = 0; i < racksPerRow; i++) {
      rackSlots.push({ xMm: ZX_CRAC + i*RACK_STEP, yMm: yRowB, row: 'B', mod: m });
    }
    for (let i = 0; i < acuPerRow; i++) {
      acuSlots.push({ xMm: ZX_CRAC + i*1200 + 150, yMm: yAcu, mod: m });
    }
  }

  // Рисуем стойки
  for (let i = 0; i < racksToPlace; i++) {
    const sl = rackSlots[i];
    svg += `<rect class="rack" x="${ox + sl.xMm*scale}" y="${oy + sl.yMm*scale}"
                   width="${600*scale - 1}" height="${RACK_DEPTH*scale - 2}"/>`;
  }

  // Рисуем ACU — equally spread между 0 и acuTotalCap
  if (acuNeeded > 0 && acuTotalCap > 0) {
    const step = acuTotalCap / acuNeeded;
    for (let i = 0; i < acuNeeded; i++) {
      const idx = Math.min(acuTotalCap - 1, Math.round(i * step));
      const sl = acuSlots[idx];
      svg += `<rect class="crac" x="${ox + sl.xMm*scale}" y="${oy + sl.yMm*scale}"
                     width="${900*scale}" height="${ACU_DEPTH*scale - 1}"/>`;
    }
  }

  // === CRAC end (периметральные или приточка) — пара шкафов у торцевой стены ===
  // Если тип perimeter/freecooling — ставим их в CRAC-зоне.
  if (S.cracType === 'perimeter-dx' || S.cracType === 'freecooling') {
    const nBigCrac = Math.max(1, Math.ceil(r.cracRedund / 4));
    const stepY = W / nBigCrac;
    for (let i = 0; i < nBigCrac; i++) {
      svg += `<rect class="crac" x="${ox + 150*scale}" y="${oy + (i*stepY + 200)*scale}"
                     width="${900*scale}" height="${Math.min(2500, stepY-400)*scale}"/>`;
    }
  }

  // === ИБП-шкафы и АКБ-шкафы — в правой зоне, ряд по длине ===
  // Шаг по длине 600 мм; два ряда по ширине (если S.width ≥ 2400).
  const upsStep = 600;
  const upsPerRowPerMod = Math.floor(ZX_UPS / upsStep);    // = 4
  const upsRowCnt = 2 * S.count;
  const upsCap = upsPerRowPerMod * upsRowCnt;
  const upsToPlace  = Math.min(r.upsShelves, upsCap);
  const battToPlace = Math.min(r.battShelves, upsCap - upsToPlace);
  // Индексы: сначала UPS, затем battery
  let placed = 0;
  for (let m = 0; m < S.count; m++) {
    for (let row = 0; row < 2; row++) {
      const yRow = (row === 0) ? m*S.width + sidePad : m*S.width + S.width - sidePad - RACK_DEPTH;
      for (let i = 0; i < upsPerRowPerMod; i++) {
        if (placed >= upsToPlace + battToPlace) break;
        const cls = (placed < upsToPlace) ? 'ups' : 'battery';
        const xMm = L - ZX_UPS + i*upsStep + 100;
        svg += `<rect class="${cls}" x="${ox + xMm*scale}" y="${oy + yRow*scale}"
                       width="${upsStep*scale - 3}" height="${RACK_DEPTH*scale - 2}"/>`;
        placed++;
      }
    }
  }

  // === Разделители между модулями (пунктир) + подпись № модуля ===
  for (let m = 1; m < S.count; m++) {
    const y = oy + m*S.width*scale;
    svg += `<line x1="${ox}" y1="${y}" x2="${ox + L*scale}" y2="${y}"
                  stroke="#888" stroke-width="1" stroke-dasharray="4,4"/>`;
  }
  for (let m = 0; m < S.count; m++) {
    svg += `<text class="dim" x="${ox + 6}" y="${oy + (m*S.width + 14)*scale}">М${m+1}  (${S.width}×${L} мм)</text>`;
  }

  // === Габаритные линии снаружи ===
  svg += `<text class="dim" x="${ox}" y="${oy + W*scale + 22}">
            Здание: ${L} × ${W} мм  ·  H внутри 2700 мм  ·  модулей: ${S.count}
          </text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
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
  alert('BOM-экспорт будет подключён после импорта каталога GDM-600K (drawio → JSON).');
}
/* ================== INIT ================== */
function init() {
  const ids = ['mdc-width','mdc-length','mdc-count','mdc-it-kw','mdc-rack-kw',
               'mdc-redundancy','mdc-ups-series','mdc-autonomy',
               'mdc-crac-type','mdc-ashrae',
               'mdc-scs','mdc-skud','mdc-video','mdc-fire','mdc-leak'];
  for (const id of ids) {
    const el = $(id);
    if (el) el.addEventListener('change', update);
    if (el && (el.type === 'number' || el.type === 'text')) el.addEventListener('input', update);
  }
  $('mdc-export-bom').addEventListener('click', exportBom);
  update();
}

document.addEventListener('DOMContentLoaded', init);
