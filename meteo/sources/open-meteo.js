// meteo/sources/open-meteo.js
// Источник: Open-Meteo Historical Weather API (бесплатно, без авторизации).
// docs: https://open-meteo.com/en/docs/historical-weather-api

import { register } from './registry.js';

register({
  id: 'open-meteo',
  label: '🌐 Open-Meteo REST',
  description: 'Бесплатный публичный API. По координатам и периоду.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, escAttr } = ctx.util;
    const last = (() => {
      try { return JSON.parse(localStorage.getItem('raschet.meteo.last-loc.v1') || 'null'); }
      catch { return null; }
    })() || { lat: 51.169, lon: 71.449, name: 'Астана' };
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

    return modalOpen(`<h3>🌐 Open-Meteo REST</h3>`, `
      <label>Название (метка):<input type="text" id="om-name" value="${escAttr((last.name || '') + ' ' + yearAgo + '..' + today)}"></label>
      <label>Широта (lat):<input type="number" step="0.0001" id="om-lat" value="${last.lat}"></label>
      <label>Долгота (lon):<input type="number" step="0.0001" id="om-lon" value="${last.lon}"></label>
      <label>Название локации:<input type="text" id="om-loc" value="${escAttr(last.name || '')}"></label>
      <label>Дата с:<input type="date" id="om-from" value="${yearAgo}"></label>
      <label>Дата по:<input type="date" id="om-to" value="${today}"></label>
      <p class="muted" style="font-size:11.5px">Запрос почасовой температуры, влажности, ветра. Период до года ~3000 строк, обычно ≤2с.</p>
    `, async () => {
      const name = document.getElementById('om-name').value.trim() || 'Open-Meteo';
      const lat = Number(document.getElementById('om-lat').value);
      const lon = Number(document.getElementById('om-lon').value);
      const locationName = document.getElementById('om-loc').value.trim();
      const dateFrom = document.getElementById('om-from').value;
      const dateTo = document.getElementById('om-to').value;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !dateFrom || !dateTo) {
        toast('Введите корректные lat, lon и обе даты.', 'warn');
        return null;
      }
      try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateFrom}&end_date=${dateTo}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) { toast(`Open-Meteo ${res.status}: ${res.statusText}`, 'warn'); return null; }
        const json = await res.json();
        const times = json.hourly?.time || [];
        const T = json.hourly?.temperature_2m || [];
        const RH = json.hourly?.relative_humidity_2m || [];
        const W = json.hourly?.wind_speed_10m || [];
        const hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i], wind: W[i] }));
        if (!hourly.length) { toast('API вернул пустой ряд.', 'warn'); return null; }
        try { localStorage.setItem('raschet.meteo.last-loc.v1', JSON.stringify({ lat, lon, name: locationName })); } catch {}
        const stats = computeStats(hourly);
        return {
          name, source: 'open-meteo',
          lat, lon, locationName,
          dateFrom, dateTo,
          hourly, stats,
        };
      } catch (e) {
        toast(`Ошибка: ${e.message || e}`, 'warn');
        return null;
      }
    });
  },
});
