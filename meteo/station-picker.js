// meteo/station-picker.js — v0.59.910
// Универсальный picker метеостанции с двумя режимами:
//   1. Список с поиском по имени/коду/стране
//   2. Карта (Leaflet, OpenStreetMap tiles, lazy-loaded из CDN)
// Возвращает { id, name, country, lat, lon } или null.
//
// v0.59.910: self-contained — стили инжектятся на лету при первом использовании.
// Раньше picker полагался на meteo/meteo.css; при использовании из других
// модулей (psychrometrics, tech-workspace) стили не подгружались и picker
// рендерился inline-блоком на странице вместо modal-overlay.

import { STATIONS, findStation, countryLabel, nearestStations } from './stations/wmo-list.js';
import { escHtml, escAttr } from './util.js';

let _leafletLoaded = false;
let _leafletLoading = null;
let _stylesInjected = false;

const PICKER_STYLES = `
.mt-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  z-index: 10000; display: flex; align-items: center; justify-content: center;
  font-family: system-ui, sans-serif;
}
.mt-station-picker {
  background: #fff; border-radius: 8px;
  width: min(800px, 95vw); height: 80vh; max-height: 600px;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.25);
}
.mt-station-picker .mt-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
}
.mt-station-picker .mt-modal-head h3 { margin: 0; font-size: 15px; color: #111827; font-weight: 600; }
.mt-sp-modes { display: flex; gap: 4px; padding: 3px; background: #f3f4f6; border-radius: 5px; }
.mt-sp-mode {
  padding: 5px 12px; background: transparent; border: 1px solid transparent;
  border-radius: 4px; cursor: pointer; font-size: 12px; color: #6b7280; font-weight: 500;
  font-family: inherit;
}
.mt-sp-mode:hover { background: #fff; color: #111827; }
.mt-sp-mode.active { background: #fff; color: #1e40af; border-color: #93c5fd; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.mt-sp-body { flex: 1; display: flex; flex-direction: column; padding: 0; overflow: hidden; min-height: 0; }
.mt-sp-search-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid #f3f4f6;
}
.mt-sp-search {
  flex: 1; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 4px;
  font-size: 13px; font-family: inherit;
}
.mt-sp-search:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,0.15); }
.mt-sp-count { font-size: 11.5px; color: #6b7280; white-space: nowrap; }
.mt-sp-list {
  flex: 1; overflow-y: auto; padding: 4px 8px 8px;
  min-height: 0;
}
.mt-sp-row {
  display: grid; grid-template-columns: 1fr auto auto auto; gap: 4px 12px;
  width: 100%; padding: 8px 12px;
  background: #fff; border: 1px solid transparent; border-radius: 4px;
  cursor: pointer; font: inherit; font-size: 12.5px; text-align: left;
  align-items: center; color: #111827;
  margin-bottom: 2px;
}
.mt-sp-row:hover { background: #eff6ff; border-color: #93c5fd; }
.mt-sp-name { font-weight: 600; color: #111827; }
.mt-sp-country { font-size: 11.5px; color: #6b7280; white-space: nowrap; }
.mt-sp-coords { font-size: 11px; color: #6b7280; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mt-sp-id { font-family: monospace; font-size: 10.5px; color: #9aa3b5; }
.mt-sp-map { flex: 1; min-height: 400px; }
.mt-sp-map-loading { padding: 20px; text-align: center; color: #6b7280; }
.mt-sp-hint { font-size: 11px; color: #6b7280; }
.mt-station-picker .mt-modal-actions {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-top: 1px solid #f3f4f6;
}
.mt-station-picker .mt-modal-btn {
  padding: 7px 14px; border: 1px solid #d1d5db; background: #fff; color: #374151;
  border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit;
}
.mt-station-picker .mt-modal-btn:hover { background: #f9fafb; }
.mt-empty-list { padding: 16px; text-align: center; color: #9ca3af; font-style: italic; font-size: 12px; }

/* Nearest-stations popup (на клик по карте) */
.mt-sp-near-popup { font: 12px system-ui; max-width: 320px; }
.mt-sp-near-popup b { font-size: 13px; color: #111827; }
.mt-sp-near-list { display: flex; flex-direction: column; gap: 2px; margin: 8px 0; max-height: 280px; overflow-y: auto; }
.mt-sp-near-row {
  display: grid; grid-template-columns: auto 1fr; gap: 8px;
  align-items: center; padding: 6px 8px;
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;
  cursor: pointer; font-size: 11.5px;
}
.mt-sp-near-row:hover { background: #eff6ff; border-color: #93c5fd; }
.mt-sp-near-letter {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: #dc2626; color: #fff; border-radius: 50%;
  font-weight: 700; font-size: 12px;
}
.mt-sp-near-name { line-height: 1.4; }
.mt-sp-pick-here-btn {
  width: 100%; padding: 5px 10px;
  background: #fff; border: 1px solid #4f46e5; color: #4f46e5;
  border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;
}
.mt-sp-pick-here-btn:hover { background: #eef2ff; }
`;

function injectStyles() {
  if (_stylesInjected) return;
  if (document.querySelector('style[data-station-picker]')) { _stylesInjected = true; return; }
  const style = document.createElement('style');
  style.dataset.stationPicker = '1';
  style.textContent = PICKER_STYLES;
  document.head.appendChild(style);
  _stylesInjected = true;
}

function loadLeaflet() {
  if (_leafletLoaded) return Promise.resolve(window.L);
  if (_leafletLoading) return _leafletLoading;
  _leafletLoading = new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.dataset.leaflet = '1';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    // JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.onload = () => { _leafletLoaded = true; resolve(window.L); };
    script.onerror = () => reject(new Error('Не удалось загрузить Leaflet (нет интернета или CDN недоступен)'));
    document.head.appendChild(script);
  });
  return _leafletLoading;
}

export function pickStation(opts = {}) {
  injectStyles();  // v0.59.910: гарантировать что стили подгружены
  // v0.59.966: универсальный drag для модалок (shared/draggable-modal.js).
  // По проектной директиве: «все модальные окна кроме предупреждений
  // должны быть перемещаемые».
  import('../shared/draggable-modal.js').then(m => {
    m.autoApply([{ overlay: '.mt-modal-overlay', modal: '.mt-modal', head: '.mt-modal-head' }]);
  }).catch(() => {});
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mt-modal-overlay';
    overlay.innerHTML = `<div class="mt-modal mt-station-picker" role="dialog" aria-modal="true">
      <div class="mt-modal-head">
        <h3>${escHtml(opts.title || '🌐 Выбор метеостанции')}</h3>
        <div class="mt-sp-modes">
          <button type="button" class="mt-sp-mode active" data-mode="list">📋 Список</button>
          <button type="button" class="mt-sp-mode" data-mode="map">🗺 Карта</button>
        </div>
      </div>
      <div class="mt-modal-body mt-sp-body">
        <div class="mt-sp-search-row">
          <input type="text" class="mt-sp-search" placeholder="🔍 Поиск по городу / коду / стране..." autofocus>
          <span class="muted mt-sp-count">${STATIONS.length}</span>
        </div>
        <div class="mt-sp-list" id="mt-sp-list"></div>
        <div class="mt-sp-map" id="mt-sp-map" hidden></div>
      </div>
      <div class="mt-modal-actions">
        <span class="muted mt-sp-hint">Не нашли свой город? Введите координаты вручную (кнопка ниже).</span>
        <span style="flex:1"></span>
        <button type="button" class="mt-modal-btn mt-sp-manual">✏ Ввести вручную</button>
        <button type="button" class="mt-modal-btn mt-modal-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.mt-modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('.mt-sp-manual').addEventListener('click', () => close({ manual: true }));

    // Список (режим по умолчанию)
    const renderList = (q) => {
      const matches = findStation(q);
      const list = overlay.querySelector('#mt-sp-list');
      list.innerHTML = matches.length === 0
        ? '<div class="mt-empty-list">Ничего не найдено. Попробуйте «Москва», «Almaty», «UAAA», «KZ».</div>'
        : matches.map(s => `<button type="button" class="mt-sp-row" data-id="${escAttr(s.id || '')}" data-name="${escAttr(s.name)}" data-lat="${s.lat}" data-lon="${s.lon}">
            <span class="mt-sp-name">${escHtml(s.name)}</span>
            <span class="mt-sp-country">${escHtml(countryLabel(s.country))}</span>
            <span class="mt-sp-coords">${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}</span>
            <span class="mt-sp-id muted">${escHtml(s.id || '')}</span>
          </button>`).join('');
      overlay.querySelector('.mt-sp-count').textContent = `${matches.length} из ${STATIONS.length}`;
      list.querySelectorAll('.mt-sp-row').forEach(row => {
        row.addEventListener('click', () => {
          // v0.59.911: include elev (m above sea level) — нужно для psychrometrics
          // и других модулей чтобы автозаполнить atmospheric pressure.
          const station = matches.find(m => String(m.id || '') === row.dataset.id) ||
                          matches.find(m => Math.abs(m.lat - Number(row.dataset.lat)) < 0.001);
          close({
            id: row.dataset.id || null,
            name: row.dataset.name,
            lat: Number(row.dataset.lat),
            lon: Number(row.dataset.lon),
            country: station?.country || '',
            elev: station?.elev ?? null,
          });
        });
      });
    };
    renderList('');
    const search = overlay.querySelector('.mt-sp-search');
    search.addEventListener('input', () => renderList(search.value));

    // Режимы
    let mapInstance = null;
    overlay.querySelectorAll('.mt-sp-mode').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        overlay.querySelectorAll('.mt-sp-mode').forEach(b => b.classList.toggle('active', b === btn));
        overlay.querySelector('#mt-sp-list').hidden = (mode !== 'list');
        overlay.querySelector('#mt-sp-map').hidden = (mode !== 'map');
        overlay.querySelector('.mt-sp-search-row').hidden = (mode !== 'list');
        if (mode === 'map' && !mapInstance) {
          const mapEl = overlay.querySelector('#mt-sp-map');
          mapEl.innerHTML = '<div class="mt-sp-map-loading">Загрузка карты…</div>';
          try {
            const L = await loadLeaflet();
            mapEl.innerHTML = '';
            mapInstance = L.map(mapEl, { center: [45, 50], zoom: 3 });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap',
              maxZoom: 13,
            }).addTo(mapInstance);
            // Маркеры на каждую станцию
            STATIONS.forEach(s => {
              const marker = L.circleMarker([s.lat, s.lon], {
                radius: 5, color: '#1e40af', fillColor: '#3b82f6', fillOpacity: 0.7, weight: 1,
              }).addTo(mapInstance);
              marker.bindTooltip(`<b>${escHtml(s.name)}</b><br>${escHtml(countryLabel(s.country))}<br>${s.lat.toFixed(2)}, ${s.lon.toFixed(2)} ${s.id ? `· ${escHtml(s.id)}` : ''}`);
              marker.on('click', () => {
                close({
                  id: s.id || null,
                  name: s.name,
                  lat: s.lat, lon: s.lon, country: s.country,
                  elev: s.elev ?? null,
                });
              });
            });
            // Клик по карте → показать ближайшие станции (как ashrae-meteo.info)
            let clickPin = null;
            mapInstance.on('click', (e) => {
              if (clickPin) clickPin.remove();
              clickPin = L.marker([e.latlng.lat, e.latlng.lng]).addTo(mapInstance);
              const nearest = nearestStations(e.latlng.lat, e.latlng.lng, 10);
              const nearestRows = nearest.map((s, i) => {
                const letter = String.fromCharCode(65 + i);
                return `<div class="mt-sp-near-row" data-near-i="${i}">
                  <span class="mt-sp-near-letter">${letter}</span>
                  <span class="mt-sp-near-name"><b>${escHtml(s.name)}</b><br>${escHtml(countryLabel(s.country))} · <span class="muted">${s.distanceKm.toFixed(0)} км</span>${s.wmo ? ' · WMO ' + s.wmo : ''}${s.id ? ' · ' + s.id : ''}</span>
                </div>`;
              }).join('');
              clickPin.bindPopup(
                `<div class="mt-sp-near-popup">
                  <b>📍 Ближайшие станции</b>
                  <span class="muted" style="font-size:10.5px">от точки ${e.latlng.lat.toFixed(2)}, ${e.latlng.lng.toFixed(2)}</span>
                  <div class="mt-sp-near-list">${nearestRows}</div>
                  <button type="button" class="mt-sp-pick-here-btn">✓ Использовать произвольную точку</button>
                </div>`,
                { closeButton: true, maxWidth: 360, minWidth: 320 }
              ).openPopup();
              setTimeout(() => {
                document.querySelectorAll('.mt-sp-near-row').forEach(row => {
                  row.addEventListener('click', () => {
                    const i = Number(row.dataset.nearI);
                    const s = nearest[i];
                    if (s) close({ id: s.id || null, name: s.name, lat: s.lat, lon: s.lon, country: s.country, elev: s.elev ?? null });
                  });
                });
                const btnHere = document.querySelector('.mt-sp-pick-here-btn');
                if (btnHere) btnHere.addEventListener('click', () => {
                  close({
                    id: null,
                    name: `Точка ${e.latlng.lat.toFixed(2)}, ${e.latlng.lng.toFixed(2)}`,
                    lat: e.latlng.lat, lon: e.latlng.lng, country: '',
                  });
                });
              }, 100);
            });
            // Force resize after appending
            setTimeout(() => mapInstance.invalidateSize(), 100);
          } catch (e) {
            mapEl.innerHTML = `<div class="mt-empty-list" style="padding:20px">⚠ ${escHtml(e.message)}<br><br>Используйте поиск в списке.</div>`;
          }
        } else if (mode === 'map' && mapInstance) {
          setTimeout(() => mapInstance.invalidateSize(), 100);
        }
      });
    });
  });
}
