// meteo/sources/rp5.js — v0.59.914
// Источник: ручная загрузка CSV/TSV с rp5.kz / rp5.ru.
// rp5 не имеет публичного API — пользователь скачивает архив вручную через
// «Архив погоды → Скачать» и подгружает файлом (или несколькими файлами по
// годам — типичный паттерн загрузки).
//
// v0.59.914: радикальный rewrite по требованию пользователя:
//   «добавь загрузку нескольких файлов, допустим по годам, посмотри и все
//    данные включая номер метеостанции вытащи из файлов и их имен. не
//    проси пользователя вводить данные где он может ошибиться».
//
// Auto-detect:
//   1. Имя файла: «38457.01.01.2019.31.12.2019.1.0.0.ru.utf8.00000000.xls»
//      → WMO 38457 (первое поле, 4–5 цифр).
//   2. WMO → каталог станций (getStationByWmo) → name/lat/lon/country.
//   3. Если в каталоге нет — пытаемся вытащить название города из шапки CSV
//      (комментарии # / заголовок «Местное время в <город>»).
//   4. Несколько файлов сливаются по времени, дедуп по timestamp.
//
// Формат файлов rp5: semicolon-separated CSV (расширение .xls — legacy).
// Кодировка обычно UTF-8 (новый формат) или CP1251 (старый).

import { register } from './registry.js';
import { getStationByWmo } from '../stations/wmo-list.js';

register({
  id: 'rp5',
  label: '📥 Файлы rp5 (auto-detect)',
  description: 'Загрузка одного или нескольких файлов с rp5.kz/rp5.ru. WMO станции и город определяются автоматически из имени файла и шапки CSV.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, readFileAsText, escAttr, escHtml } = ctx.util;

    return modalOpen(`<h3>📥 Файлы rp5 (auto-detect)</h3>`, `
      <p class="muted" style="font-size:12px;line-height:1.5">На rp5.ru/rp5.kz: «Архив погоды» → «Скачать архив». <b>Можно загружать несколько файлов сразу</b> (например архив по каждому году отдельно — Ctrl+click для multi-select).</p>
      <p class="muted" style="font-size:12px;line-height:1.5">Из имени файла <code>38457.01.01.2019.31.12.2019.*</code> и шапки CSV автоматически извлекаются: WMO станции, название города, lat/lon (если станция в каталоге), период.</p>
      <label>Файлы (выберите 1 или несколько):
        <input type="file" id="rp5-files" accept=".csv,.tsv,.txt,.xls,text/csv,text/tab-separated-values" multiple>
      </label>
      <div id="rp5-preview" style="margin-top:8px;font-size:11.5px;color:#374151"></div>
    `, async () => {
      const fileEl = document.getElementById('rp5-files');
      if (!fileEl.files || !fileEl.files.length) { toast('Выберите хотя бы один файл.', 'warn'); return null; }
      const files = [...fileEl.files];
      try {
        // Парсим все файлы и собираем hourly + meta
        const all = [];
        let detectedWmo = null, detectedCity = null;
        const periodFromFiles = [];
        for (const file of files) {
          const text = await readFileAsText(file, 'utf-8');
          const parsed = parseRp5Csv(text);
          // WMO из имени файла
          const wmoMatch = file.name.match(/^(\d{4,5})\./);
          const fileWmo = wmoMatch ? wmoMatch[1] : null;
          if (fileWmo && !detectedWmo) detectedWmo = fileWmo;
          // Период из имени файла
          const periodMatch = file.name.match(/^\d{4,5}\.(\d{2}\.\d{2}\.\d{4})\.(\d{2}\.\d{2}\.\d{4})\./);
          if (periodMatch) periodFromFiles.push({ from: periodMatch[1], to: periodMatch[2] });
          // City из шапки CSV
          if (!detectedCity) detectedCity = parsed.cityFromHeader;
          if (parsed.hourly.length) all.push(...parsed.hourly);
        }
        if (!all.length) { toast('Не удалось распарсить ни одной записи. Проверьте формат файлов rp5.', 'warn'); return null; }
        // Дедуп по timestamp + sort по времени
        const byTs = new Map();
        for (const h of all) byTs.set(h.t, h);  // последняя запись с тем же ts перезаписывает
        const hourly = [...byTs.values()].sort((a, b) => a.t.localeCompare(b.t));

        // Lookup WMO в каталоге
        const station = detectedWmo ? getStationByWmo(detectedWmo) : null;
        const stationName = station?.name || detectedCity || `WMO ${detectedWmo || '?'}`;
        const lat = station?.lat || null;
        const lon = station?.lon || null;
        const country = station?.country || '';
        const datasetName = `rp5 ${stationName} (${hourly[0].t.slice(0,10)}…${hourly[hourly.length-1].t.slice(0,10)})`;

        const stats = computeStats(hourly);
        toast(`✓ ${files.length} файл(ов) · ${hourly.length} часов · ${stationName}${detectedWmo ? ` (WMO ${detectedWmo})` : ''}${station ? '' : ' [не в каталоге]'}`, 'ok');
        return {
          name: datasetName, source: 'rp5',
          lat, lon,
          locationName: stationName,
          country,
          stationId: detectedWmo || null,
          dateFrom: hourly[0].t.slice(0, 10),
          dateTo: hourly[hourly.length - 1].t.slice(0, 10),
          hourly, stats,
        };
      } catch (e) {
        toast(`Ошибка парсинга: ${e.message || e}`, 'warn');
        return null;
      }
    });
  },
});

// ─── rp5 CSV parser
// Возвращает { hourly: [...], cityFromHeader: '...' }
function parseRp5Csv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  // Шаг 1: вытащить название города из шапки (комментарий # или заголовок).
  let cityFromHeader = null;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const ln = lines[i];
    // Шаблон: «# Метеостанция: Алматы (УТАА), синоптический индекс 36870»
    let m = ln.match(/Метеостанция[\s:]+([^,()\n]+)/i);
    if (m) { cityFromHeader = m[1].trim(); break; }
    // Шаблон: "Местное время в Алматы (Аэропорт)"
    m = ln.match(/Местное время в\s+([^"\n;]+)/i);
    if (m) { cityFromHeader = m[1].trim(); break; }
    // Альтернативный шаблон: «station_name=Almaty»
    m = ln.match(/station[_\s]?name[\s:=]+([^\n;]+)/i);
    if (m) { cityFromHeader = m[1].trim(); break; }
  }
  // Шаг 2: найти строку заголовков
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/Местное время|Local time|date.*time/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      if (lines[i].includes(';') && /\bT\b|\bТ\b|temperature/i.test(lines[i])) { headerIdx = i; break; }
    }
  }
  if (headerIdx < 0) return { hourly: [], cityFromHeader };
  const headers = splitCsv(lines[headerIdx]).map(h => h.replace(/^"|"$/g, '').trim());
  const idxTime = headers.findIndex(h => /Местное время|Local time|date|time/i.test(h));
  const idxT = headers.findIndex((h, i) => i !== idxTime && (h === 'T' || h === 'Т' || /^temperature/i.test(h)));
  const idxRH = headers.findIndex(h => h === 'U' || /humidity/i.test(h));
  const idxW = headers.findIndex(h => h === 'Ff' || /wind/i.test(h));
  const idxWD = headers.findIndex(h => h === 'DD' || /wind.*dir/i.test(h));
  if (idxTime < 0 || idxT < 0) return { hourly: [], cityFromHeader };

  const hourly = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsv(lines[i]).map(c => c.replace(/^"|"$/g, '').trim());
    const tStr = cols[idxTime];
    if (!tStr) continue;
    const iso = parseRp5DateTime(tStr);
    if (!iso) continue;
    const T = parseFloat(String(cols[idxT]).replace(',', '.'));
    if (!Number.isFinite(T)) continue;
    const RH = idxRH >= 0 ? parseFloat(String(cols[idxRH]).replace(',', '.')) : null;
    const wind = idxW >= 0 ? parseFloat(String(cols[idxW]).replace(',', '.')) : null;
    // Wind direction в rp5 — обычно текстовая строка («штиль», «С», «СВ», и т.п.)
    // Для wind rose нужен числовой угол. Преобразуем основные направления.
    let windDir = null;
    if (idxWD >= 0) {
      const wdStr = String(cols[idxWD] || '').trim();
      windDir = parseWindDir(wdStr);
    }
    hourly.push({
      t: iso, T,
      RH: Number.isFinite(RH) ? RH : null,
      wind: Number.isFinite(wind) ? wind : null,
      windDir: Number.isFinite(windDir) ? windDir : null,
    });
  }
  hourly.sort((a, b) => a.t.localeCompare(b.t));
  return { hourly, cityFromHeader };
}

function splitCsv(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; cur += ch; }
    else if (ch === ';' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseRp5DateTime(s) {
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace(' ', 'T');
  return null;
}

// rp5 направление ветра — строка типа «штиль», «С», «СВ», «ВСВ», «ЮЗ» и т.п.
// Возвращаем угол в градусах (0=С, 90=В, 180=Ю, 270=З) или null.
const WIND_DIR_DEG = {
  'штиль': null, 'calm': null, '': null,
  'с': 0, 'ссв': 22.5, 'св': 45, 'всв': 67.5,
  'в': 90, 'вюв': 112.5, 'юв': 135, 'ююв': 157.5,
  'ю': 180, 'ююз': 202.5, 'юз': 225, 'зюз': 247.5,
  'з': 270, 'зсз': 292.5, 'сз': 315, 'ссз': 337.5,
  'n': 0, 'nne': 22.5, 'ne': 45, 'ene': 67.5,
  'e': 90, 'ese': 112.5, 'se': 135, 'sse': 157.5,
  's': 180, 'ssw': 202.5, 'sw': 225, 'wsw': 247.5,
  'w': 270, 'wnw': 292.5, 'nw': 315, 'nnw': 337.5,
};
function parseWindDir(s) {
  s = String(s || '').toLowerCase().trim();
  if (!s) return null;
  // Численное значение?
  const num = parseFloat(s.replace(',', '.'));
  if (Number.isFinite(num) && num >= 0 && num <= 360) return num;
  // Извлечь короткое направление из длинной строки типа «Ветер, дующий с запада-юго-запада»
  // Берём короткое значение из карты
  if (s in WIND_DIR_DEG) return WIND_DIR_DEG[s];
  // Поиск короткого ключа в строке
  for (const key of Object.keys(WIND_DIR_DEG)) {
    if (key && new RegExp(`\\b${key}\\b`, 'i').test(s)) return WIND_DIR_DEG[key];
  }
  return null;
}
