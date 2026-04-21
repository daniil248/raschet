/* =========================================================================
   suppression-config.js — gas fire suppression calculator (АГПТ).
   Wires UI to pluggable methodologies in ../suppression-methods/.
   ========================================================================= */

import { AGENTS, CYLINDERS, METHODS, METHOD_LIST, run, pipingSpec, cylinderPick }
  from '../suppression-methods/index.js';

const $ = (id) => document.getElementById(id);

const S = {
  method: 'sp-rk-2022',
  agent: 'FK-5-1-12',
  V: 120, H: 3, fireClass: 'A', leakage: 'II',
  tempC: 20, altM: 200,
  cylinderV: 0,
  pipeMat: 'stainless', pipeLenOverride: 0,
};

function read() {
  const num = (id, d) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : d; };
  const str = (id, d) => $(id)?.value ?? d;
  S.method      = str('sup-method', S.method);
  S.agent       = str('sup-agent', S.agent);
  S.V           = num('sup-V', 120);
  S.H           = num('sup-H', 3);
  S.fireClass   = str('sup-class', 'A');
  S.leakage     = str('sup-leak', 'II');
  S.tempC       = num('sup-temp', 20);
  S.altM        = num('sup-alt', 200);
  S.cylinderV   = num('sup-cylinder', 0);
  S.pipeMat     = str('sup-pipe-mat', 'stainless');
  S.pipeLenOverride = num('sup-pipe-len', 0);
}

function fillSelect(id, items, current, fmt) {
  const sel = $(id);
  sel.innerHTML = items.map(i => {
    const val = fmt.value(i), lbl = fmt.label(i);
    return `<option value="${val}" ${val === current ? 'selected' : ''}>${lbl}</option>`;
  }).join('');
}

function initSelects() {
  fillSelect('sup-method', METHOD_LIST, S.method, {
    value: m => m.id, label: m => m.label,
  });
  fillSelect('sup-agent', Object.entries(AGENTS), S.agent, {
    value: ([k]) => k, label: ([k,a]) => `${k} — ${a.label}`,
  });
  syncCylinders();
  syncAgentInfo();
  syncMethodRefs();
}

function syncCylinders() {
  const a = AGENTS[$('sup-agent').value];
  const pool = CYLINDERS[a.type];
  fillSelect('sup-cylinder', [{ V: 0, label: 'авто (минимум баллонов)' }, ...pool], S.cylinderV, {
    value: c => c.V, label: c => c.label,
  });
}

function syncAgentInfo() {
  const key = $('sup-agent').value;
  const a = AGENTS[key];
  $('sup-agent-info').innerHTML = `
    ${a.type === 'halocarbon' ? 'хим. фторуглерод' : 'инертный газ'},
    ρ₂₀ = ${a.rho20} кг/м³, s₂₀ = ${a.s20} м³/кг,
    Cmin A/B = ${a.Cmin_A}/${a.Cmin_B}%, NOAEL ${a.Cmax}%.
    ${a.notes}
  `;
}

function syncMethodRefs() {
  const meta = METHODS[$('sup-method').value].META;
  $('sup-method-refs').innerHTML = `<b>Источники:</b> ${meta.refs.join('; ')}`;
}

/* ============ Рендер результата ============ */
function renderCalc(result, piping, cyl) {
  const el = $('sup-summary');
  el.innerHTML = `
    <div class="card big"><span class="label">Масса ГОТВ</span><span class="value">${result.M} кг</span></div>
    <div class="card"><span class="label">Расч. концентрация</span><span class="value">${result.C}%</span></div>
    <div class="card"><span class="label">Cmin (${result.fireClass})</span><span class="value">${result.Cmin}%</span></div>
    <div class="card"><span class="label">Объём</span><span class="value">${result.V} м³</span></div>
    <div class="card"><span class="label">Время выпуска</span><span class="value">≤ ${result.dischargeS} с</span></div>
    <div class="card"><span class="label">Массовый расход</span><span class="value">${piping.mdot} кг/с</span></div>
    <div class="card"><span class="label">Диаметр магистрали</span><span class="value">DN ${piping.DN}</span></div>
    <div class="card"><span class="label">Форсунки</span><span class="value">${piping.nozzles} шт</span></div>
    <div class="card"><span class="label">Баллонов</span><span class="value">${cyl.n} × ${cyl.label}</span></div>
    <div class="card"><span class="label">Масса на баллон</span><span class="value">${cyl.Mcyl} кг</span></div>
  `;
  const steps = [
    `<b>Методика:</b> ${METHODS[result.method].META.label}`,
    ...result.steps,
    '',
    '<b>Трубопровод:</b>',
    ...piping.notes,
    '',
    `<b>Баллоны:</b> выбрано ${cyl.label} — ${cyl.n} шт, вместимость ${cyl.Mcyl} кг/шт, суммарная масса ${(cyl.Mcyl*cyl.n).toFixed(1)} кг (треб. ${result.M} кг).`,
  ];
  $('sup-steps').innerHTML = steps.join('\n');
}

/* ============ Трубопровод (изометрия) ============ */
function renderPipe(result, piping) {
  const host = $('sup-pipe-view');
  const W = 900, H = 420;
  const ox = 60, oy = 300;  // origin
  // isometric helper
  const iso = (x, y, z) => {
    const ix = ox + (x - y) * Math.cos(Math.PI/6);
    const iy = oy + (x + y) * Math.sin(Math.PI/6) - z;
    return [ix, iy];
  };
  const room = { L: 12, W: 6, H: 3 };   // room size (units ≈ 0.5m for drawing)
  const sx = 18, sz = 40;
  const unitLen = 18;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // Room floor
  const p1 = iso(0, 0, 0), p2 = iso(room.L * unitLen/sx, 0, 0),
        p3 = iso(room.L * unitLen/sx, room.W * unitLen/sx, 0),
        p4 = iso(0, room.W * unitLen/sx, 0);
  svg += `<polygon points="${p1.join(',')} ${p2.join(',')} ${p3.join(',')} ${p4.join(',')}"
           fill="#f3f5f7" stroke="#90a4ae" stroke-width="0.8"/>`;
  // Walls
  const w1 = iso(0,0, room.H*sz), w2 = iso(room.L*unitLen/sx,0, room.H*sz),
        w3 = iso(0, room.W*unitLen/sx, room.H*sz);
  svg += `<polygon points="${p1.join(',')} ${p2.join(',')} ${w2.join(',')} ${w1.join(',')}"
           fill="#eceff1" stroke="#90a4ae" stroke-width="0.6" opacity="0.5"/>`;
  svg += `<polygon points="${p1.join(',')} ${p4.join(',')} ${w3.join(',')} ${w1.join(',')}"
           fill="#e0e6eb" stroke="#90a4ae" stroke-width="0.6" opacity="0.5"/>`;

  // Cylinders (corner)
  const cx0 = iso(0.5, 0.5, 0);
  const cyl = cylinderPick(result, S.cylinderV || undefined);
  for (let i = 0; i < Math.min(cyl.n, 8); i++) {
    const [x, y] = iso(0.5 + i*0.6, 0.5, 0);
    const [x2, y2] = iso(0.5 + i*0.6, 0.5, 60);
    svg += `<rect x="${x-7}" y="${y2}" width="14" height="${y-y2}"
             fill="#ffe0b2" stroke="#D79B00" stroke-width="0.8"/>`;
    svg += `<ellipse cx="${x}" cy="${y2}" rx="7" ry="2.5" fill="#ffd180" stroke="#D79B00" stroke-width="0.6"/>`;
  }
  svg += `<text x="${cx0[0]}" y="${cx0[1]+18}" style="font-size:10px;fill:#6b4e00;font-weight:600;">${cyl.n}×${cyl.label}</text>`;

  // Riser from cylinder to ceiling
  const [rx, ry] = iso(1.5, 0.5, 60);
  const [rx2, ry2] = iso(1.5, 0.5, room.H*sz);
  svg += `<line x1="${rx}" y1="${ry}" x2="${rx2}" y2="${ry2}" stroke="#B85450" stroke-width="2.5"/>`;

  // Ceiling main pipe
  const [mx1, my1] = iso(1.5, 0.5, room.H*sz);
  const [mx2, my2] = iso(1.5, room.W*unitLen/sx - 0.5, room.H*sz);
  svg += `<line x1="${mx1}" y1="${my1}" x2="${mx2}" y2="${my2}" stroke="#B85450" stroke-width="2.5"/>`;
  const [mx3, my3] = iso(room.L*unitLen/sx - 1, room.W*unitLen/sx/2, room.H*sz);
  svg += `<line x1="${mx1}" y1="${my1}" x2="${mx3}" y2="${my3}" stroke="#B85450" stroke-width="2.5"/>`;

  // Distribution branches to nozzles
  const nCount = piping.nozzles;
  const cols = Math.max(2, Math.ceil(Math.sqrt(nCount * room.L / room.W)));
  const rows = Math.ceil(nCount / cols);
  let placed = 0;
  for (let r = 0; r < rows && placed < nCount; r++) {
    for (let c = 0; c < cols && placed < nCount; c++) {
      const xr = 1 + (c + 0.5) * ((room.L*unitLen/sx - 2) / cols);
      const yr = 0.5 + (r + 0.5) * ((room.W*unitLen/sx - 1) / rows);
      // tap-off from main (at x=1.5 or x=room.L/2)
      const [tapX, tapY] = iso(xr, 0.5, room.H*sz);
      const [endX, endY] = iso(xr, yr, room.H*sz);
      svg += `<line x1="${tapX}" y1="${tapY}" x2="${endX}" y2="${endY}"
               stroke="#6C8EBF" stroke-width="1.6"/>`;
      // nozzle (down-arrow triangle)
      const [nx, ny] = iso(xr, yr, room.H*sz - 3);
      svg += `<circle cx="${endX}" cy="${endY}" r="3" fill="#82B366" stroke="#1e7a1e" stroke-width="0.6"/>`;
      svg += `<path d="M ${endX-2} ${endY+1} L ${endX+2} ${endY+1} L ${endX} ${endY+5} Z"
               fill="#82B366" stroke="#1e7a1e" stroke-width="0.4"/>`;
      placed++;
    }
  }

  // Legend/text
  svg += `<text x="10" y="20" style="font-size:12px;font-weight:700;fill:#263238;">
          ${METHODS[S.method].META.label} · ${result.agentLabel}</text>`;
  svg += `<text x="10" y="38" style="font-size:11px;fill:#546e7a;">
          V=${result.V}м³, M=${result.M}кг, DN${piping.DN}, ${piping.nozzles} форсунок</text>`;
  svg += `<text x="10" y="${H-8}" style="font-size:10px;fill:#78909c;">
          Изометрия (MVP). Реальная трассировка — по плану помещения.</text>`;

  svg += `</svg>`;
  host.innerHTML = svg;
}

/* ============ Спецификация ============ */
function renderSpec(result, piping, cyl) {
  const host = $('sup-spec');
  const a = AGENTS[result.agent];
  const mat = $('sup-pipe-mat').selectedOptions[0]?.textContent || '';
  const rows = [
    { code: `AGENT.${result.agent}`, name: `ГОТВ ${a.label}`, qty: cyl.Mcyl * cyl.n, unit: 'кг', note: `для ${cyl.n}×${cyl.label}` },
    { code: `CYL.${cyl.V}L`, name: `Баллон ${cyl.label}` + (a.type === 'inert' ? ` @${cyl.P}бар` : ''), qty: cyl.n, unit: 'шт', note: '' },
    { code: 'HDR', name: 'Коллектор распределительный', qty: 1, unit: 'шт', note: '' },
    { code: 'PIPE', name: `Трубопровод ${mat.split('(')[0]}, DN${piping.DN}`, qty: piping.pipeLen, unit: 'м', note: '' },
    { code: 'NZL', name: 'Форсунка-распылитель', qty: piping.nozzles, unit: 'шт', note: '' },
    { code: 'PSC', name: 'Датчик давления (пост. контроль)', qty: cyl.n, unit: 'шт', note: 'по одному на баллон' },
    { code: 'WGH', name: 'Весы контроля массы (для хим. агента)', qty: a.type === 'halocarbon' ? cyl.n : 0, unit: 'шт', note: '' },
    { code: 'ALM', name: 'Сирена-оповещатель', qty: 2, unit: 'шт', note: 'у входа и внутри' },
    { code: 'STP', name: 'Табло «ГАЗ НЕ ВХОДИ!»', qty: 1, unit: 'шт', note: 'у входа снаружи' },
    { code: 'DPR', name: 'Автоматические воздушные клапаны (зашибка)', qty: 1, unit: 'компл.', note: '' },
    { code: 'PPU', name: 'ППУ (прибор пуска газовый)', qty: 1, unit: 'шт', note: '' },
  ].filter(r => r.qty > 0);

  let html = '<h3>Спецификация комплектующих</h3>';
  html += `<p style="font-size:12px;color:#555;">Методика: <b>${METHODS[result.method].META.label}</b>.
           Помещение V=${result.V} м³, H=${S.H} м, класс пожара ${result.fireClass},
           герметичность ${result.leakage}, T=${result.tempC}°C, h=${result.altM} м.</p>`;
  html += '<table class="sup-table"><thead><tr>';
  html += '<th>№</th><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Примечание</th>';
  html += '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += `<tr><td>${i+1}</td><td>${r.code}</td><td>${r.name}</td>
             <td class="num">${r.qty}</td><td>${r.unit}</td><td>${r.note}</td></tr>`;
  });
  html += '</tbody></table>';
  host.innerHTML = html;
}

/* ============ Update ============ */
let last = null;
function update() {
  read();
  syncMethodRefs();
  syncAgentInfo();
  syncCylinders();

  const input = {
    agent: S.agent, V: S.V, fireClass: S.fireClass, leakage: S.leakage,
    tempC: S.tempC, altM: S.altM, heightM: S.H,
  };
  const result = run(S.method, input);
  const piping = pipingSpec(result, { V: S.V, heightM: S.H });
  if (S.pipeLenOverride > 0) piping.pipeLen = S.pipeLenOverride;
  const cyl = cylinderPick(result, S.cylinderV || undefined);
  last = { result, piping, cyl };

  renderCalc(result, piping, cyl);
  renderPipe(result, piping);
  renderSpec(result, piping, cyl);
}

/* ============ Экспорт XLSX ============ */
function exportXlsx() {
  if (!last) return;
  if (!window.XLSX) { alert('SheetJS не загружен'); return; }
  const { result, piping, cyl } = last;
  const a = AGENTS[result.agent];
  const meta = METHODS[result.method].META;

  const rows = [];
  rows.push(['Расчёт установки газового пожаротушения']);
  rows.push([`Методика: ${meta.label}`]);
  rows.push([`Источники: ${meta.refs.join('; ')}`]);
  rows.push([]);
  rows.push(['Исходные данные']);
  rows.push(['Защищаемый объём V, м³', result.V]);
  rows.push(['Высота H, м', S.H]);
  rows.push(['Класс пожара', result.fireClass]);
  rows.push(['Класс герметичности', result.leakage]);
  rows.push(['Температура, °C', result.tempC]);
  rows.push(['Высота над у. м., м', result.altM]);
  rows.push(['ГОТВ', a.label]);
  rows.push([]);
  rows.push(['Результаты расчёта']);
  rows.push(['Cmin, %', result.Cmin]);
  rows.push(['C расчётная, %', result.C]);
  if (result.K1 != null) rows.push(['K1 (утечки)', result.K1]);
  if (result.Ks != null) rows.push(['Ks (безопасности)', result.Ks]);
  if (result.Kt != null) rows.push(['Kt (температура)', result.Kt]);
  if (result.Kalt != null) rows.push(['Kalt (высота)', result.Kalt]);
  rows.push(['Масса ГОТВ M, кг', result.M]);
  rows.push(['Время выпуска, с', result.dischargeS]);
  rows.push([]);
  rows.push(['Ход расчёта:']);
  result.steps.forEach(s => rows.push([s]));
  rows.push([]);
  rows.push(['Трубопровод']);
  piping.notes.forEach(s => rows.push([s]));
  rows.push([]);
  rows.push(['Спецификация']);
  rows.push(['№','Код','Наименование','Кол-во','Ед.','Примечание']);
  const specRows = [
    [`AGENT.${result.agent}`, `ГОТВ ${a.label}`, cyl.Mcyl * cyl.n, 'кг', `для ${cyl.n}×${cyl.label}`],
    [`CYL.${cyl.V}L`, `Баллон ${cyl.label}`, cyl.n, 'шт', ''],
    ['HDR', 'Коллектор распределительный', 1, 'шт', ''],
    ['PIPE', `Трубопровод DN${piping.DN}`, piping.pipeLen, 'м', ''],
    ['NZL', 'Форсунка-распылитель', piping.nozzles, 'шт', ''],
    ['PSC', 'Датчик давления', cyl.n, 'шт', ''],
    ['ALM', 'Сирена-оповещатель', 2, 'шт', ''],
    ['STP', 'Табло «ГАЗ НЕ ВХОДИ»', 1, 'шт', ''],
    ['PPU', 'ППУ', 1, 'шт', ''],
  ];
  specRows.forEach((r,i) => rows.push([i+1, ...r]));

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:22},{wch:46},{wch:10},{wch:8},{wch:30}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'АГПТ');
  const fn = `AGPT_${result.method}_${result.agent}_V${result.V}_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, fn);
}

/* ============ HTML-отчёт ============ */
function exportHtml() {
  if (!last) return;
  const { result, piping, cyl } = last;
  const a = AGENTS[result.agent];
  const meta = METHODS[result.method].META;
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>АГПТ — отчёт</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;max-width:900px;margin:0 auto;color:#222;}
      h1{color:#0d47a1;} h2{color:#1565c0;border-bottom:1px solid #bbdefb;padding-bottom:4px;}
      table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px;}
      th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;}
      th{background:#eceff1;}
      pre{background:#f5f5f5;padding:10px;border-radius:4px;white-space:pre-wrap;font-size:12px;}
    </style></head><body>
    <h1>Расчёт АГПТ</h1>
    <p><b>Методика:</b> ${meta.label}<br>
       <b>Источники:</b> ${meta.refs.join('; ')}<br>
       <b>Дата:</b> ${new Date().toLocaleDateString('ru-RU')}</p>
    <h2>Исходные данные</h2>
    <table>
      <tr><td>Объём V</td><td>${result.V} м³</td></tr>
      <tr><td>Высота H</td><td>${S.H} м</td></tr>
      <tr><td>Класс пожара</td><td>${result.fireClass}</td></tr>
      <tr><td>Класс герметичности</td><td>${result.leakage}</td></tr>
      <tr><td>Температура</td><td>${result.tempC}°C</td></tr>
      <tr><td>Высота над у. м.</td><td>${result.altM} м</td></tr>
      <tr><td>ГОТВ</td><td>${a.label} (${a.type === 'halocarbon' ? 'хим.' : 'инерт.'})</td></tr>
    </table>
    <h2>Результаты</h2>
    <table>
      <tr><td>Cmin</td><td>${result.Cmin}%</td></tr>
      <tr><td>C расчётная</td><td>${result.C}%</td></tr>
      <tr><td><b>Масса ГОТВ</b></td><td><b>${result.M} кг</b></td></tr>
      <tr><td>Время выпуска</td><td>≤ ${result.dischargeS} с</td></tr>
      <tr><td>DN магистрали</td><td>${piping.DN}</td></tr>
      <tr><td>Форсунок</td><td>${piping.nozzles}</td></tr>
      <tr><td>Баллоны</td><td>${cyl.n} × ${cyl.label}</td></tr>
    </table>
    <h2>Ход расчёта</h2>
    <pre>${result.steps.join('\n')}\n\n${piping.notes.join('\n')}</pre>
    </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a_el = document.createElement('a');
  a_el.href = url; a_el.download = `AGPT_${result.method}_${result.agent}_V${result.V}.html`;
  a_el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============ Tabs ============ */
function initTabs() {
  document.querySelectorAll('.sup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sup-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $('sup-panel-calc').style.display = name === 'calc' ? '' : 'none';
      $('sup-panel-pipe').style.display = name === 'pipe' ? '' : 'none';
      $('sup-panel-spec').style.display = name === 'spec' ? '' : 'none';
    });
  });
}

/* ============ Init ============ */
function init() {
  initSelects();
  initTabs();
  const ids = ['sup-method','sup-agent','sup-V','sup-H','sup-class','sup-leak',
               'sup-temp','sup-alt','sup-cylinder','sup-pipe-mat','sup-pipe-len'];
  ids.forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', update);
    if (el.type === 'number') el.addEventListener('input', update);
  });
  $('sup-export-xlsx').addEventListener('click', exportXlsx);
  $('sup-export-html').addEventListener('click', exportHtml);
  update();
}

document.addEventListener('DOMContentLoaded', init);
