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

  // Проверка: поместятся ли все стойки в заданные модули?
  // Серверный ряд: стойка 600 мм × (count модулей × (длина - 2 × 600 кондёры))
  const ZONE_CRAC_LEN = 1200;  // мм, зона с торца (CRAC)
  const ZONE_UPS_LEN  = 2400;  // зона ИБП+АКБ
  const serverZoneLen = (S.length - ZONE_CRAC_LEN - ZONE_UPS_LEN) * S.count;
  const racksFit = Math.floor(serverZoneLen / 600) * 2; // два ряда (холодный коридор)
  const racksOk = racksFit >= racksNeeded;

  return {
    racksNeeded, racksFit, racksOk,
    upsKva, upsShelves, battShelves,
    cracN, cracRedund,
    serverZoneLen,
  };
}

/* ================== СВОДКА ================== */
function renderSummary(r) {
  const el = $('mdc-summary');
  el.innerHTML = `
    <div class="card"><span class="label">IT-нагрузка</span><span class="value">${S.itKw} кВт</span></div>
    <div class="card"><span class="label">Стоек нужно</span><span class="value">${r.racksNeeded}</span></div>
    <div class="card ${r.racksOk ? 'ok' : 'warn'}">
      <span class="label">Стоек помещается</span>
      <span class="value">${r.racksFit} ${r.racksOk ? '✓' : '✗ мало'}</span>
    </div>
    <div class="card"><span class="label">ИБП-мощность</span><span class="value">${r.upsKva} кВА</span></div>
    <div class="card"><span class="label">Шкафов ИБП</span><span class="value">${r.upsShelves}</span></div>
    <div class="card"><span class="label">АКБ-шкафов</span><span class="value">${r.battShelves}</span></div>
    <div class="card"><span class="label">CRAC (с резервом)</span><span class="value">${r.cracRedund}</span></div>
    <div class="card"><span class="label">Модулей ЦОД</span><span class="value">${S.count} × ${S.length} мм</span></div>
  `;
}

/* ================== ПЛАНИРОВКА (SVG top-view) ================== */
function renderPlan(r) {
  const host = $('mdc-plan');
  const scale = 0.07; // 1мм → 0.07px  (12000мм ≈ 840px)
  const W_total = S.length * S.count;
  const H_total = S.width;
  const vw = Math.max(600, W_total * scale + 80);
  const vh = Math.max(200, H_total * scale + 80);

  let svg = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`;

  // Внешний контур всех модулей
  const ox = 40, oy = 30;
  for (let m = 0; m < S.count; m++) {
    const x = ox + m * S.length * scale;
    svg += `<rect class="wall" x="${x}" y="${oy}" width="${S.length * scale}" height="${H_total * scale}"/>`;

    // Зоны (внутри одного модуля): CRAC | серверы | сервис | ИБП+АКБ
    const ZX_CRAC = 1200;   // мм
    const ZX_UPS  = 2400;   // мм
    const serverLen = S.length - ZX_CRAC - ZX_UPS;
    const svc_mm    = Math.max(800, S.width >= 3000 ? 1200 : 900); // коридор по ширине

    // CRAC зона (слева по длине)
    svg += `<rect class="zone-crac" x="${x}" y="${oy}" width="${ZX_CRAC * scale}" height="${H_total * scale}"/>`;
    // Серверная зона (центр)
    const srvX = x + ZX_CRAC * scale;
    const srvW = serverLen * scale;
    svg += `<rect class="zone-srv" x="${srvX}" y="${oy}" width="${srvW}" height="${H_total * scale}"/>`;
    // Сервисный коридор (полоса в середине серверной зоны по ширине)
    const svcY = oy + (H_total - svc_mm) / 2 * scale;
    svg += `<rect class="zone-svc" x="${srvX}" y="${svcY}" width="${srvW}" height="${svc_mm * scale}"/>`;
    // ИБП+АКБ (справа по длине)
    const upsX = srvX + srvW;
    svg += `<rect class="zone-ups" x="${upsX}" y="${oy}" width="${ZX_UPS * scale}" height="${H_total * scale}"/>`;

    // Подписи зон
    svg += `<text class="zone-label" x="${x + ZX_CRAC*scale/2}" y="${oy - 8}" text-anchor="middle">CRAC</text>`;
    svg += `<text class="zone-label" x="${srvX + srvW/2}" y="${oy - 8}" text-anchor="middle">Серверная</text>`;
    svg += `<text class="zone-label" x="${upsX + ZX_UPS*scale/2}" y="${oy - 8}" text-anchor="middle">ИБП+АКБ</text>`;

    // CRAC-модули (колонка в зоне слева)
    const cracPerMod = Math.ceil(r.cracRedund / S.count);
    const cracW = 900 * scale;  // ширина одного кондёра
    const cracH = (H_total / cracPerMod) * scale - 6;
    for (let i = 0; i < cracPerMod; i++) {
      svg += `<rect class="crac" x="${x + 100*scale}" y="${oy + (i+0.1)*H_total/cracPerMod*scale}"
                     width="${cracW}" height="${cracH}"/>`;
    }

    // Серверные стойки — два ряда по 600мм
    const rowTopY  = oy + 100 * scale;
    const rowBotY  = oy + (H_total - 600 - 100) * scale;
    const racksInRow = Math.floor(serverLen / 600);
    const racksInThisMod = Math.min(racksInRow * 2, r.racksNeeded - m * racksInRow * 2);
    for (let i = 0; i < racksInRow && i * 2 < racksInThisMod; i++) {
      svg += `<rect class="rack" x="${srvX + i*600*scale + 2}" y="${rowTopY}"
                    width="${600*scale - 3}" height="${600*scale - 3}"/>`;
      if (i * 2 + 1 < racksInThisMod) {
        svg += `<rect class="rack" x="${srvX + i*600*scale + 2}" y="${rowBotY}"
                      width="${600*scale - 3}" height="${600*scale - 3}"/>`;
      }
    }

    // ИБП + АКБ шкафы (800мм глубиной, ширина 600мм)
    const upsPerMod = Math.ceil(r.upsShelves / S.count);
    const battPerMod = Math.ceil(r.battShelves / S.count);
    let uy = oy + 100 * scale;
    for (let i = 0; i < upsPerMod; i++) {
      svg += `<rect class="ups" x="${upsX + 200*scale}" y="${uy}" width="${800*scale}" height="${600*scale - 4}"/>`;
      uy += 600 * scale + 2;
    }
    for (let i = 0; i < battPerMod && uy + 600*scale < oy + H_total*scale; i++) {
      svg += `<rect class="battery" x="${upsX + 200*scale}" y="${uy}" width="${800*scale}" height="${600*scale - 4}"/>`;
      uy += 600 * scale + 2;
    }
  }

  // Габаритные размеры
  svg += `<text class="dim" x="${ox}" y="${oy + H_total*scale + 20}">
            Длина: ${W_total} мм  ·  Ширина: ${S.width} мм  ·  H внутри 2700 мм
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
function sendToMain() {
  alert('Передача в главную схему будет подключена после стабилизации каталога модулей.');
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
  $('mdc-send-main').addEventListener('click', sendToMain);
  update();
}

document.addEventListener('DOMContentLoaded', init);
