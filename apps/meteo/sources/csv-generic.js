// meteo/sources/csv-generic.js — v0.59.899
// Универсальный CSV-импорт. В отличие от rp5.js (заточен под формат
// «Местное время в …», «;», «DD.MM.YYYY HH:MM»), этот плагин работает с
// любым CSV — пользователь сам выбирает разделитель и маппит колонки
// (time / T / RH / wind / windDir).
//
// Поддерживается:
//   — auto-detect разделителя (`;` / `,` / `\t`) по первой строке;
//   — column-mapper UI: dropdown для каждой системной колонки → выбор
//     из заголовков файла;
//   — формат времени: ISO 8601, «DD.MM.YYYY HH:MM», «MM/DD/YYYY HH:MM»,
//     unix timestamp в секундах, Excel serial date.

import { register } from './registry.js';

register({
  id: 'csv-generic',
  label: '📋 CSV / TSV (универсальный)',
  description: 'Любой CSV/TSV с почасовыми данными. Auto-detect разделителя + ручной маппинг колонок.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, readFileAsText, escAttr, escHtml } = ctx.util;

    // Шаг 1: загрузка файла + распознавание заголовков
    const filePicked = await new Promise((resolve) => {
      modalOpen(`<h3>📋 CSV / TSV: выбор файла</h3>`, `
        <p class="muted" style="font-size:11.5px">Любой текстовый CSV с почасовыми/посуточными метеоданными. Поддерживаются разделители <code>; , \\t</code>; кодировка UTF-8 (если CP1251 — конвертируйте файл заранее).</p>
        <label>Название датасета:<input type="text" id="csv-name" value="CSV import"></label>
        <label>Локация (название):<input type="text" id="csv-loc" placeholder="например: Алматы"></label>
        <label>Lat / Lon:<input type="text" id="csv-latlon" placeholder="43.222, 76.851 (опционально)"></label>
        <label>Файл:<input type="file" id="csv-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
      `, async () => {
        const fileEl = document.getElementById('csv-file');
        if (!fileEl.files || !fileEl.files[0]) { toast('Выберите файл.', 'warn'); return null; }
        const file = fileEl.files[0];
        const name = document.getElementById('csv-name').value.trim() || 'CSV import';
        const locationName = document.getElementById('csv-loc').value.trim();
        const latlonStr = document.getElementById('csv-latlon').value.trim();
        let lat = null, lon = null;
        if (latlonStr) {
          const m = latlonStr.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
          if (m) { lat = Number(m[1]); lon = Number(m[2]); }
        }
        try {
          const text = await readFileAsText(file, 'utf-8');
          const parsed = sniffCsv(text);
          if (!parsed.headers.length) { toast('Не удалось распознать заголовки.', 'warn'); return null; }
          return { name, locationName, lat, lon, parsed };
        } catch (e) {
          toast(`Ошибка чтения файла: ${e.message || e}`, 'warn');
          return null;
        }
      }).then(resolve);
    });
    if (!filePicked) return null;

    // Шаг 2: column-mapper UI
    const { name, locationName, lat, lon, parsed } = filePicked;
    const headers = parsed.headers;
    const guessIdx = (regex) => headers.findIndex(h => regex.test(h));
    const guess = {
      time: guessIdx(/time|date|дат|время/i),
      T: guessIdx(/^t$|^Т$|temp|темп/i),
      RH: guessIdx(/^u$|humid|влаж|^rh$/i),
      wind: guessIdx(/wind.*speed|^ff$|ветер|скор/i),
      windDir: guessIdx(/wind.*dir|^dd$|направ/i),
    };
    const mkSelect = (id, defaultIdx) => `<select id="${id}">
      <option value="-1">— нет —</option>
      ${headers.map((h, i) => `<option value="${i}"${i === defaultIdx ? ' selected' : ''}>${escHtml(h)}</option>`).join('')}
    </select>`;

    return modalOpen(`<h3>📋 CSV: маппинг колонок</h3>`, `
      <p class="muted" style="font-size:11.5px">Найдено ${headers.length} колонок, ${parsed.rows.length} строк. Сопоставьте колонки файла с системными полями. Обязательны: <b>Время</b> и <b>Температура</b>.</p>
      <label>🕐 Время (timestamp):${mkSelect('csv-col-time', guess.time)}</label>
      <label>🌡 T, °C:${mkSelect('csv-col-T', guess.T)}</label>
      <label>💧 RH, %:${mkSelect('csv-col-RH', guess.RH)}</label>
      <label>💨 Скорость ветра, м/с:${mkSelect('csv-col-wind', guess.wind)}</label>
      <label>🧭 Направление ветра, °:${mkSelect('csv-col-windDir', guess.windDir)}</label>
      <p class="muted" style="font-size:11.5px">Поддерживаемые форматы времени: ISO (<code>2026-01-15T12:00</code>), «DD.MM.YYYY HH:MM», «MM/DD/YYYY HH:MM», unix-timestamp.</p>
    `, async () => {
      const idxTime = Number(document.getElementById('csv-col-time').value);
      const idxT = Number(document.getElementById('csv-col-T').value);
      const idxRH = Number(document.getElementById('csv-col-RH').value);
      const idxW = Number(document.getElementById('csv-col-wind').value);
      const idxWD = Number(document.getElementById('csv-col-windDir').value);
      if (idxTime < 0 || idxT < 0) {
        toast('Колонки «Время» и «Температура» обязательны.', 'warn');
        return null;
      }
      const hourly = [];
      for (const row of parsed.rows) {
        const tStr = row[idxTime];
        if (!tStr) continue;
        const iso = parseTimestamp(tStr);
        if (!iso) continue;
        const T = parseFloat(String(row[idxT]).replace(',', '.'));
        if (!Number.isFinite(T)) continue;
        const rec = { t: iso, T };
        if (idxRH >= 0) {
          const v = parseFloat(String(row[idxRH] || '').replace(',', '.'));
          rec.RH = Number.isFinite(v) ? v : null;
        }
        if (idxW >= 0) {
          const v = parseFloat(String(row[idxW] || '').replace(',', '.'));
          rec.wind = Number.isFinite(v) ? v : null;
        }
        if (idxWD >= 0) {
          const v = parseFloat(String(row[idxWD] || '').replace(',', '.'));
          rec.windDir = Number.isFinite(v) ? v : null;
        }
        hourly.push(rec);
      }
      hourly.sort((a, b) => a.t.localeCompare(b.t));
      if (!hourly.length) {
        toast('Не получилось распарсить ни одной строки. Проверьте маппинг и формат времени.', 'warn');
        return null;
      }
      const stats = computeStats(hourly);
      return {
        name, source: 'csv',
        lat, lon, locationName,
        dateFrom: hourly[0].t.slice(0, 10),
        dateTo: hourly[hourly.length - 1].t.slice(0, 10),
        hourly, stats,
      };
    });
  },
});

// Auto-detect разделителя + headers + rows
function sniffCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [], delimiter: ';' };
  // Найти первую строку с приемлемым кол-вом разделителей.
  let headerIdx = 0;
  let delim = ';';
  // Auto-detect: считаем встречаемость каждого в первых 5 строках
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    counts[';'] += (lines[i].match(/;/g) || []).length;
    counts[','] += (lines[i].match(/,/g) || []).length;
    counts['\t'] += (lines[i].match(/\t/g) || []).length;
  }
  delim = Object.entries(counts).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  // Найти строку, содержащую заголовки (обычно 1-я с непустыми значениями)
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cells = splitLine(lines[i], delim);
    // Если ≥2 непустые ячейки и все можно интерпретировать как заголовки (не числа)
    const nonNum = cells.filter(c => c && isNaN(parseFloat(c.replace(',', '.')))).length;
    if (cells.length >= 2 && nonNum >= cells.length / 2) {
      headerIdx = i;
      break;
    }
  }
  const headers = splitLine(lines[headerIdx], delim).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim).map(c => c.replace(/^"|"$/g, '').trim());
    if (cells.some(c => c)) rows.push(cells);
  }
  return { headers, rows, delimiter: delim };
}

function splitLine(line, delim) {
  const out = [];
  let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; cur += ch; }
    else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseTimestamp(s) {
  s = String(s).trim();
  if (!s) return null;
  // ISO 8601
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace(' ', 'T').slice(0, 19);
  // DD.MM.YYYY HH:MM
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
  // MM/DD/YYYY HH:MM (US)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}:00`;
  // Unix timestamp в секундах
  const num = Number(s);
  if (Number.isFinite(num) && num > 1e9 && num < 4e9) {
    return new Date(num * 1000).toISOString().slice(0, 19);
  }
  // Excel serial date (≈1.0 = 1899-12-31, плавающее)
  if (Number.isFinite(num) && num > 30000 && num < 80000) {
    const ms = (num - 25569) * 86400 * 1000;  // 25569 = days from 1899-12-30 to 1970-01-01
    return new Date(ms).toISOString().slice(0, 19);
  }
  return null;
}
