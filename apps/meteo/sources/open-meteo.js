// meteo/sources/open-meteo.js — v0.59.898
// Источник: Open-Meteo Historical Weather API.
// Поддерживает выбор локации через picker (карта/список) или вручную.

import { register } from './registry.js';
import { pickStation } from '../../station-picker.js';

register({
  id: 'open-meteo',
  label: '🌐 Open-Meteo REST',
  description: 'Бесплатный публичный API. Выбор станции на карте или списком, либо ручной ввод координат.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, escAttr } = ctx.util;

    // Шаг 1: выбор локации через picker
    const picked = await pickStation({ title: '🌐 Open-Meteo: выбор локации' });
    if (!picked) return null;

    // Если юзер выбрал «✏ Ввести вручную» — открываем форму с ручным lat/lon
    let lat, lon, locationName;
    if (picked.manual) {
      const last = (() => {
        try { return JSON.parse(localStorage.getItem('raschet.meteo.last-loc.v1') || 'null'); }
        catch { return null; }
      })() || { lat: 51.169, lon: 71.449, name: 'Астана' };
      const today = new Date().toISOString().slice(0, 10);
      const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      return modalOpen(`<h3>🌐 Open-Meteo (ручные координаты)</h3>`, `
        <label>Название (метка):<input type="text" id="om-name" value="${escAttr((last.name || '') + ' ' + yearAgo + '..' + today)}"></label>
        <label>Широта (lat):<input type="number" step="0.0001" id="om-lat" value="${last.lat}"></label>
        <label>Долгота (lon):<input type="number" step="0.0001" id="om-lon" value="${last.lon}"></label>
        <label>Название локации:<input type="text" id="om-loc" value="${escAttr(last.name || '')}"></label>
        <label>Дата с:<input type="date" id="om-from" value="${yearAgo}"></label>
        <label>Дата по:<input type="date" id="om-to" value="${today}"></label>
      `, async () => fetchOpenMeteo({
        ctx, name: document.getElementById('om-name').value,
        lat: Number(document.getElementById('om-lat').value),
        lon: Number(document.getElementById('om-lon').value),
        locationName: document.getElementById('om-loc').value,
        dateFrom: document.getElementById('om-from').value,
        dateTo: document.getElementById('om-to').value,
      }));
    }

    lat = picked.lat;
    lon = picked.lon;
    locationName = picked.name;
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

    // Шаг 2: выбор периода (станция уже выбрана)
    return modalOpen(`<h3>🌐 Open-Meteo: ${escAttr(locationName)}</h3>`, `
      <p class="muted" style="font-size:11.5px">Выбрана станция <b>${escAttr(locationName)}</b> (${lat.toFixed(3)}, ${lon.toFixed(3)})${picked.id ? ` · ICAO ${escAttr(picked.id)}` : ''}.</p>
      <label>Название датасета:<input type="text" id="om-name" value="${escAttr(locationName + ' ' + yearAgo + '..' + today)}"></label>
      <label>Дата с:<input type="date" id="om-from" value="${yearAgo}"></label>
      <label>Дата по:<input type="date" id="om-to" value="${today}"></label>
      <p class="muted" style="font-size:11.5px">Запрос почасовой температуры, влажности, ветра. До года — обычно ≤2с.</p>
    `, async () => fetchOpenMeteo({
      ctx,
      name: document.getElementById('om-name').value || locationName,
      lat, lon, locationName,
      dateFrom: document.getElementById('om-from').value,
      dateTo: document.getElementById('om-to').value,
      stationId: picked.id || null,
    }));
  },
});

async function fetchOpenMeteo({ ctx, name, lat, lon, locationName, dateFrom, dateTo, stationId = null }) {
  const { computeStats, toast } = ctx.util;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !dateFrom || !dateTo) {
    toast('Введите корректные lat, lon и обе даты.', 'warn');
    return null;
  }
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateFrom}&end_date=${dateTo}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) { toast(`Open-Meteo ${res.status}: ${res.statusText}`, 'warn'); return null; }
    const json = await res.json();
    const times = json.hourly?.time || [];
    const T = json.hourly?.temperature_2m || [];
    const RH = json.hourly?.relative_humidity_2m || [];
    const W = json.hourly?.wind_speed_10m || [];
    const WD = json.hourly?.wind_direction_10m || [];
    const hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i], wind: W[i], windDir: WD[i] }));
    if (!hourly.length) { toast('API вернул пустой ряд.', 'warn'); return null; }
    try { localStorage.setItem('raschet.meteo.last-loc.v1', JSON.stringify({ lat, lon, name: locationName })); } catch {}
    const stats = computeStats(hourly);
    return {
      name: name || locationName,
      source: 'open-meteo',
      lat, lon, locationName, stationId,
      dateFrom, dateTo, hourly, stats,
    };
  } catch (e) {
    toast(`Ошибка: ${e.message || e}`, 'warn');
    return null;
  }
}
