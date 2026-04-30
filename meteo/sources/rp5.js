// meteo/sources/rp5.js
// Источник: ручная загрузка CSV/TSV с rp5.kz / rp5.ru.
// rp5 не имеет публичного API — пользователь скачивает архив вручную через
// «Архив погоды → Скачать» и подгружает файлом.
//
// Формат CSV: semicolon-separated. Кодировка обычно UTF-8 (новый формат)
// или CP1251 (старый). Заголовок: «Местное время в <город>», «T», «Po», «P»,
// «Pa», «U», «DD», «Ff», «ff10», «ff3», «N», «WW», «W'W'», «c», «Nh», «H»,
// «VV», «Td», «RRR», «tR», «E», «Tg», «E'», «sss».
// Время: «DD.MM.YYYY HH:MM».

import { register } from './registry.js';

register({
  id: 'rp5',
  label: '📥 Файл rp5 (CSV)',
  description: 'Ручная загрузка архива rp5.kz / rp5.ru. Парсер semicolon-CSV.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, readFileAsText, escAttr } = ctx.util;
    return modalOpen(`<h3>📥 Файл rp5 (CSV)</h3>`, `
      <p class="muted" style="font-size:11.5px">На rp5.ru/rp5.kz: «Архив погоды» → «Скачать». Поддерживается CSV (semicolon, UTF-8).</p>
      <label>Название датасета:<input type="text" id="rp5-name" value="rp5 dataset"></label>
      <label>Локация:<input type="text" id="rp5-loc" placeholder="Алматы / WMO 36870"></label>
      <label>Lat / Lon (опционально):<input type="text" id="rp5-latlon" placeholder="43.222, 76.851"></label>
      <label>Файл CSV:<input type="file" id="rp5-file" accept=".csv,.txt,text/csv"></label>
    `, async () => {
      const name = document.getElementById('rp5-name').value.trim() || 'rp5 dataset';
      const locationName = document.getElementById('rp5-loc').value.trim();
      const latlonStr = document.getElementById('rp5-latlon').value.trim();
      let lat = null, lon = null;
      if (latlonStr) {
        const m = latlonStr.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (m) { lat = Number(m[1]); lon = Number(m[2]); }
      }
      const fileEl = document.getElementById('rp5-file');
      if (!fileEl.files || !fileEl.files[0]) { toast('Выберите CSV-файл.', 'warn'); return null; }
      try {
        const text = await readFileAsText(fileEl.files[0], 'utf-8');
        const parsed = parseRp5Csv(text);
        if (!parsed.hourly.length) {
          toast(`Не удалось распознать. Заголовки: ${parsed.detectedHeaders.slice(0,8).join(', ') || '—'}.`, 'warn');
          return null;
        }
        const stats = computeStats(parsed.hourly);
        return {
          name, source: 'rp5',
          lat, lon, locationName,
          dateFrom: parsed.hourly[0].t.slice(0, 10),
          dateTo: parsed.hourly[parsed.hourly.length - 1].t.slice(0, 10),
          hourly: parsed.hourly, stats,
        };
      } catch (e) {
        toast(`Ошибка парсинга: ${e.message || e}`, 'warn');
        return null;
      }
    });
  },
});

function parseRp5Csv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/Местное время|Local time|date.*time/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      if (lines[i].includes(';') && /\bT\b|\bТ\b|temperature/i.test(lines[i])) { headerIdx = i; break; }
    }
  }
  if (headerIdx < 0) return { hourly: [], detectedHeaders: [] };
  const headers = splitCsv(lines[headerIdx]).map(h => h.replace(/^"|"$/g, '').trim());
  const idxTime = headers.findIndex(h => /Местное время|Local time|date|time/i.test(h));
  const idxT = headers.findIndex((h, i) => i !== idxTime && (h === 'T' || h === 'Т' || /^temperature/i.test(h)));
  const idxRH = headers.findIndex(h => h === 'U' || /humidity/i.test(h));
  const idxW = headers.findIndex(h => h === 'Ff' || /wind/i.test(h));
  if (idxTime < 0 || idxT < 0) return { hourly: [], detectedHeaders: headers };

  const hourly = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]).map(c => c.replace(/^"|"$/g, '').trim());
    const tStr = cols[idxTime];
    if (!tStr) continue;
    const iso = parseRp5DateTime(tStr);
    if (!iso) continue;
    const T = parseFloat(String(cols[idxT]).replace(',', '.'));
    if (!Number.isFinite(T)) continue;
    const RH = idxRH >= 0 ? parseFloat(String(cols[idxRH]).replace(',', '.')) : null;
    const wind = idxW >= 0 ? parseFloat(String(cols[idxW]).replace(',', '.')) : null;
    hourly.push({ t: iso, T, RH: Number.isFinite(RH) ? RH : null, wind: Number.isFinite(wind) ? wind : null });
  }
  hourly.sort((a, b) => a.t.localeCompare(b.t));
  return { hourly, detectedHeaders: headers };
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
