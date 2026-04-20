/* =========================================================================
   mdc-config.js — Конфигуратор модульного ЦОД (GDM-600-series)
   v0.58.89 — унификация шкафов под 600×1200×42U

   Модель (на основании drawio 26003/25006):
   - Модули стыкуются длинными сторонами (side-by-side), образуют общую
     ширину здания. Длина = длина одного модуля, ширина здания = Σ ширин.
   - Внутри модуля (ширина 2400 или 3000 мм, внутренняя, без стенок):
     два ряда шкафов 600×1200×42U (для 3000 мм) или один ряд (для 2400 мм),
     между рядами/у стены — аисль.
   - Все шкафы одинакового габарита 600×1200 (стойки, inRow-кондиционеры,
     ИБП, АКБ). Различие только по роли и цвету.
   - ИБП — Kehua MR33 200/300 kVA с батареями S3.

   Источники:
   - 26003 (Технопарк Алатау): 2 модуля 3100×7300, 2 ряда шкафов внутри.
   - 25006 (TBC Ташкент): до 15 модулей 3100×7300 в несколько рядов.
   ========================================================================= */

const $ = (id) => document.getElementById(id);

// ================== КОНСТАНТЫ ==================
const CAB_W = 600;    // мм, ширина шкафа (= шаг вдоль длины модуля)
const CAB_D = 1200;   // мм, глубина шкафа (= размер по ширине модуля)
const AISLE_MIN = 600;  // мин. ширина горячего прохода между рядами

// Kehua MR33 + S3 — spec из открытых данных (уточнить в след. итерации):
// - MR33-200: номинал 200 kVA, 600×1100×2000 мм (считаем 600×1200 в плане)
// - MR33-300: номинал 300 kVA, 600×1100×2000 мм
// - S3 battery cabinet: 600×1200×2000, вмещает 40 VRLA блоков 12V/100Ah
//   даёт ≈ 40 × 12V × 100Ah = 48 кВт·ч ≈ 200 kVA на 15 мин при DOD 0.7
const UPS_CATALOG = {
  'kehua-mr33-200': { kva: 200, label: 'Kehua MR33-200', footprint: [CAB_W, CAB_D] },
  'kehua-mr33-300': { kva: 300, label: 'Kehua MR33-300', footprint: [CAB_W, CAB_D] },
};
// Батарейный шкаф S3: на 15 мин при 200 kVA — 1 шкаф, на 300 kVA — 2 шкафа.
const BATT_KVA_PER_CAB_15MIN = 200;  // kVA на шкаф S3 при 15 мин

const S = {
  width: 3000,
  length: 12192,
  count: 2,                // авто-пересчитывается, если autoCount=true
  autoCount: true,
  itKw: 600,
  rackKw: 30,
  redundancy: 'N+1',
  upsSeries: 'kehua-mr33-300',
  autonomyMin: 15,
  cracType: 'inrow-dx',
  ashrae: 'A2',
  scs: true, skud: true, video: true, fire: true, leak: false,
};

function read() {
  S.width        = Number($('mdc-width').value) || 3000;
  S.length       = Number($('mdc-length').value) || 12192;
  S.autoCount    = $('mdc-auto-count').checked;
  S.count        = S.autoCount ? S.count : (Number($('mdc-count').value) || 1);
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

/* ================== ГЕОМЕТРИЯ МОДУЛЯ ================== */
// Сколько рядов шкафов помещается по ширине модуля.
// 3000 мм: 1200 (ряд A) + 600 (аисль) + 1200 (ряд B) = 3000 → 2 ряда
// 2400 мм: 1200 (ряд) + 1200 (аисль) = 2400 → 1 ряд
function rowsPerModule(width) {
  return width >= (2 * CAB_D + AISLE_MIN) ? 2 : 1;
}
// Слотов шкафа по длине модуля = floor(length / 600)
function slotsPerRow(length) {
  return Math.floor(length / CAB_W);
}

/* ================== РАСЧЁТ ================== */
function compute() {
  // --- Стойки ---
  const racksNeeded = Math.ceil(S.itKw / Math.max(1, S.rackKw));

  // --- ИБП-мощность ---
  const cosPhi = 0.9;
  const redundFactor = S.redundancy === '2N' ? 2 : (S.redundancy === 'N+1' ? 1.2 : 1.0);
  const upsKvaNeeded = Math.ceil((S.itKw / cosPhi) * redundFactor / 50) * 50;

  // --- ИБП-шкафы (Kehua MR33) ---
  const ups = UPS_CATALOG[S.upsSeries] || UPS_CATALOG['kehua-mr33-300'];
  const upsShelves = Math.ceil(upsKvaNeeded / ups.kva);

  // --- АКБ S3 ---
  // Один S3 покрывает BATT_KVA_PER_CAB_15MIN × (15/autonomyMin)
  const battShelves = Math.ceil(
    upsKvaNeeded * (S.autonomyMin / 15) / BATT_KVA_PER_CAB_15MIN
  );

  // --- CRAC (inRow в шкафу 600×1200) ---
  // Типовая inRow-холодопроизводительность: 40 кВт/шкаф DX, 60 — CW, 80 — freecooling.
  const cracKwPerUnit = (S.cracType === 'inrow-cw') ? 60 :
                        (S.cracType === 'freecooling') ? 80 :
                        (S.cracType === 'perimeter-dx') ? 100 : 40;
  const cracN = Math.ceil(S.itKw / cracKwPerUnit);
  const cracRedund = S.redundancy === '2N' ? cracN * 2 : (cracN + 1);

  // --- Всего шкафов в плане ---
  const totalCabs = racksNeeded + upsShelves + battShelves +
                    ((S.cracType === 'perimeter-dx') ? 0 : cracRedund);

  // --- Автоподбор количества модулей ---
  const rows = rowsPerModule(S.width);
  const slotsL = slotsPerRow(S.length);
  const slotsPerMod = rows * slotsL;
  // Зарезервируем торцы модуля (2 слота = 1200 мм) под дверь/щиты
  const usableSlotsPerMod = Math.max(0, slotsPerMod - 2);
  let countNeeded = Math.max(1, Math.ceil(totalCabs / Math.max(1, usableSlotsPerMod)));
  if (S.autoCount) S.count = countNeeded;

  const totalSlots = usableSlotsPerMod * S.count;
  const fitOk = totalSlots >= totalCabs;

  return {
    racksNeeded, upsKvaNeeded, upsShelves, battShelves,
    cracN, cracRedund, cracKwPerUnit,
    totalCabs, totalSlots, fitOk, countNeeded,
    rows, slotsL, slotsPerMod, usableSlotsPerMod,
    upsModel: ups.label, upsKvaEach: ups.kva,
  };
}

/* ================== СВОДКА ================== */
function renderSummary(r) {
  const el = $('mdc-summary');
  el.innerHTML = `
    <div class="card"><span class="label">IT-нагрузка</span><span class="value">${S.itKw} кВт</span></div>
    <div class="card"><span class="label">Стоек</span><span class="value">${r.racksNeeded}</span></div>
    <div class="card"><span class="label">ИБП</span><span class="value">${r.upsShelves}× ${r.upsModel}</span></div>
    <div class="card"><span class="label">АКБ S3</span><span class="value">${r.battShelves} шкафа</span></div>
    <div class="card"><span class="label">CRAC (${r.cracKwPerUnit} кВт/шк.)</span><span class="value">${r.cracRedund}</span></div>
    <div class="card"><span class="label">Шкафов всего</span><span class="value">${r.totalCabs}</span></div>
    <div class="card ${r.fitOk ? 'ok' : 'warn'}">
      <span class="label">Модулей нужно</span>
      <span class="value">${S.count} ${r.fitOk ? '✓' : '✗'}</span>
    </div>
    <div class="card"><span class="label">Здание</span><span class="value">${S.length} × ${S.width * S.count} мм</span></div>
  `;
}

/* ================== ПЛАНИРОВКА (SVG top-view) ================== */
// Сетка шкафов: по длине slotsL позиций × rows рядов × count модулей.
// Заполнение порядком: [UPS (от правого торца) | BATT | CRAC inRow | RACKS] —
// ИБП и АКБ группируются у одного торца (справа), стойки и inRow-CRAC
// чередуются в остальной части. Т.к. все шкафы 600×1200 — планировка
// получается компактной и наглядной.
function renderPlan(r) {
  const host = $('mdc-plan');
  const scale = 0.055;

  const L = S.length;
  const W = S.width * S.count;   // суммарная ширина здания
  const ox = 40, oy = 36;
  const vw = Math.max(700, L * scale + 2 * ox);
  const vh = Math.max(260, W * scale + 2 * oy + 30);

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`;

  // Внешний контур
  svg += `<rect class="wall" x="${ox}" y="${oy}" width="${L*scale}" height="${W*scale}"/>`;

  // Фоновая заливка модулей (слегка)
  for (let m = 0; m < S.count; m++) {
    svg += `<rect x="${ox}" y="${oy + m*S.width*scale}"
                   width="${L*scale}" height="${S.width*scale}"
                   fill="${m%2 ? '#fafafa' : '#f5f5f5'}" stroke="none"/>`;
  }

  // Генерация списка объектов в порядке: racks, cracs, ups, batts
  // Индекс слота: 0..(rows×slotsL×count−1).
  // Сначала UPS+BATT занимают правый торец (последние слоты), потом CRAC
  // распределяется равномерно в оставшихся, потом racks заполняют остальное.
  const rows = r.rows;
  const slotsL = r.slotsL;
  const slotsPerMod = rows * slotsL;

  // Зарезервируем по 1 слоту на торец модуля (дверь/щит) — не размещаем.
  // Пока без щитов — показываем пустые торцевые слоты полосой.
  const items = [];  // { cls, label }

  // Ставим UPS + BATT слитно справа
  const upsBlock = [];
  for (let i = 0; i < r.upsShelves; i++) upsBlock.push({ cls: 'ups', label: 'ИБП' });
  for (let i = 0; i < r.battShelves; i++) upsBlock.push({ cls: 'battery', label: 'АКБ' });

  // Ставим CRAC
  const cracBlock = [];
  const cracCount = (S.cracType === 'perimeter-dx') ? 0 : r.cracRedund;
  for (let i = 0; i < cracCount; i++) cracBlock.push({ cls: 'crac', label: 'CRAC' });

  // Стойки
  const rackBlock = [];
  for (let i = 0; i < r.racksNeeded; i++) rackBlock.push({ cls: 'rack', label: 'RACK' });

  // Сборка: racks + crac (интерлив), потом UPS справа
  const middle = [];
  if (cracBlock.length && rackBlock.length) {
    // Равномерно вставляем CRAC между стойками: 1 CRAC на N стоек.
    const ratio = rackBlock.length / cracBlock.length;
    let ri = 0, ci = 0;
    while (ri < rackBlock.length || ci < cracBlock.length) {
      // сколько стоек до следующего CRAC
      const nextCracAt = Math.round((ci + 0.5) * ratio);
      while (ri < rackBlock.length && ri < nextCracAt) middle.push(rackBlock[ri++]);
      if (ci < cracBlock.length) middle.push(cracBlock[ci++]);
    }
  } else {
    middle.push(...rackBlock, ...cracBlock);
  }
  const allItems = [...middle, ...upsBlock];

  // Раскладка по сетке: для каждого модуля — снизу ряд B, сверху ряд A.
  // Слот i: row = i % rows; col = Math.floor(i / rows) (в пределах модуля)
  const cabW = CAB_W * scale;
  const cabH = CAB_D * scale;
  // Y-позиция ряда r (0 = ряд A вверху, 1 = ряд B внизу) в рамках модуля
  const rowY = (mod, rowIdx) => {
    const yTop = mod * S.width;
    if (rows === 1) return yTop + 0;                       // ряд у верхней стены
    return (rowIdx === 0) ? yTop : yTop + S.width - CAB_D; // A вверху, B внизу
  };

  let placed = 0;
  for (let m = 0; m < S.count && placed < allItems.length; m++) {
    for (let col = 0; col < slotsL && placed < allItems.length; col++) {
      // пропустим первый и последний слот модуля (резерв под торец-щит)
      if (col === 0 || col === slotsL - 1) continue;
      for (let rr = 0; rr < rows && placed < allItems.length; rr++) {
        const it = allItems[placed++];
        const x = ox + (col * CAB_W) * scale;
        const y = oy + rowY(m, rr) * scale;
        svg += `<rect class="${it.cls}" x="${x}" y="${y}" width="${cabW - 1}" height="${cabH - 1}"/>`;
      }
    }
  }

  // Перимeтральные CRAC (если выбран тип perimeter-dx) — большие шкафы у торца
  if (S.cracType === 'perimeter-dx') {
    const nBig = Math.max(1, Math.ceil(r.cracRedund / 4));
    const gapY = W / nBig;
    for (let i = 0; i < nBig; i++) {
      svg += `<rect class="crac" x="${ox + 100*scale}" y="${oy + (i*gapY + 150)*scale}"
                     width="${900*scale}" height="${Math.min(2400, gapY-300)*scale}"/>`;
    }
  }

  // Разделители между модулями (пунктир)
  for (let m = 1; m < S.count; m++) {
    const y = oy + m*S.width*scale;
    svg += `<line x1="${ox}" y1="${y}" x2="${ox + L*scale}" y2="${y}"
                  stroke="#888" stroke-width="1" stroke-dasharray="4,4"/>`;
  }

  // Подписи модулей (слева)
  for (let m = 0; m < S.count; m++) {
    svg += `<text class="dim" x="${ox + 6}" y="${oy + (m*S.width + 14)*scale}">
              М${m+1}  (${S.width}×${L} мм)
            </text>`;
  }

  // Легенда габаритов
  svg += `<text class="dim" x="${ox}" y="${oy + W*scale + 22}">
            Здание: ${L} × ${W} мм  ·  H внутри 2700 мм  ·  модулей: ${S.count}  ·  шкафов 600×1200×42U: ${r.totalCabs}
          </text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
}

/* ================== UPDATE ================== */
function update() {
  read();
  const r = compute();
  // синхронизируем input count, если авто
  if (S.autoCount && $('mdc-count').value !== String(S.count)) {
    $('mdc-count').value = S.count;
  }
  $('mdc-count').disabled = S.autoCount;
  renderSummary(r);
  renderPlan(r);
}

/* ================== ЭКСПОРТ (stub) ================== */
function exportBom() {
  alert('BOM-экспорт будет подключён в следующей подфазе 10.3.');
}

/* ================== INIT ================== */
function init() {
  const ids = ['mdc-width','mdc-length','mdc-count','mdc-auto-count',
               'mdc-it-kw','mdc-rack-kw',
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
