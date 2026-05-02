// projects/project.js — детальная карточка одного проекта.
// v0.59.344+: отдельный экран с курируемым набором модулей. Запускается
// по ссылке project.html?project=<pid> с /projects/. Все ссылки на модули
// несут ?project=<pid>&from=projects (вернёт пользователя именно сюда).

import {
  listProjects, getProject, updateProject, deleteProject, copyProject,
  setActiveProjectId, exportProject,
  // v0.59.373: подпроекты — артефакты внутри родителя (схемы, СКС, шкафы).
  listSubProjects, createSubProject,
  // v0.59.862: hide-when-empty — для определения «есть ли данные модуля».
  projectKey,
} from '../shared/project-storage.js';
import { buildModuleHref, clearNavStack } from '../shared/project-context.js';

/* ---------- inline modal / toast ---------- */
function prToast(msg, kind = 'info') {
  const host = document.getElementById('pr-toast-host') || (() => {
    const h = document.createElement('div'); h.id = 'pr-toast-host'; document.body.appendChild(h); return h;
  })();
  const el = document.createElement('div');
  el.className = 'pr-toast pr-toast-' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('leave'), 2500);
  setTimeout(() => el.remove(), 3000);
}
function prConfirm(title, text) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${esc(title)}</h3>
        <p class="muted">${esc(text)}</p>
        <div class="pr-modal-actions">
          <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="pr-btn-danger" data-act="yes">Подтвердить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.remove(); res(false); }
      const act = e.target.dataset?.act;
      if (act === 'yes') { overlay.remove(); res(true); }
      if (act === 'no')  { overlay.remove(); res(false); }
    });
  });
}
function prPrompt(title, label, initial = '') {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${esc(title)}</h3>
        <label class="pr-modal-label">${esc(label)}</label>
        <input type="text" class="pr-modal-input" value="${esc(initial)}">
        <div class="pr-modal-actions">
          <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="pr-btn-primary" data-act="yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus(); input.select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      const act = e.target.dataset?.act;
      if (act === 'yes') done(input.value.trim() || null);
      if (act === 'no')  done(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
  });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- v0.60.2: Свойства проекта — местоположение + multi-location ----------
   По требованию (2026-05-02):
     • «В свойствах проекта (основные данные) нужно сразу выбирать место
       расположения, чтобы сразу передавать данные во все расчётные модули.»
     • «Будут встречаться проекты с возможностью выбора разных мест,
       например для разработки типовых решений и проверки их для разных
       мест и условий эксплуатации.»

   Модель:
     project.locationMode: 'single' | 'multi' (default 'single')
     project.location: { city, country, lat, lon }                     // single
     project.locations: [{ id, name, city, country, lat, lon, isPrimary }]  // multi

   Calc-модули (meteo, cooling, psychrometrics) читают через project-storage
   и используют location/locations + activeLocationId. Смотри memory
   feedback_project_location.md и ROADMAP Phase 22.13.
*/
function renderProjectProperties(p, host) {
  // v0.60.10: реквизиты проекта + локация. По требованию: «так же добавить
  // прочие данные проекта, полный адрес, эти данные должны быть там, в
  // свойствах проекта». Реквизиты хранятся в project.requisites (object),
  // чтобы не засорять плоский project namespace.
  const r = p.requisites || {};
  const requisitesHtml = `
    <div class="pr-req-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 12px;margin-bottom:14px">
      <label title="Шифр проекта (короткий код по системе ГИП заказчика). Обычно пишется в шапке всех чертежей. Пример: 25013-GEP-ENG-ELC-901.">
        <span style="font-size:11.5px;color:#475569;display:block">Обозначение / шифр:</span>
        <input type="text" data-req="code" value="${esc(r.code || '')}" placeholder="напр. 25013-GEP-ENG-ELC-901" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label title="Заказчик / клиент (юр. или физ. лицо). Выводится в шапке отчёта и BOM.">
        <span style="font-size:11.5px;color:#475569;display:block">Заказчик:</span>
        <input type="text" data-req="customer" value="${esc(r.customer || '')}" placeholder="напр. Qarmet" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label title="Объект / адрес объекта. Полный адрес — улица, город, страна. Используется в шапке отчёта.">
        <span style="font-size:11.5px;color:#475569;display:block">Объект / адрес:</span>
        <input type="text" data-req="address" value="${esc(r.address || '')}" placeholder="напр. г. Темиртау, ул. Заводская 1" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label title="Стадия проектирования: ТЭО / П (Проект) / РД (Рабочая документация) / EPC / ввод в эксплуатацию.">
        <span style="font-size:11.5px;color:#475569;display:block">Стадия:</span>
        <input type="text" data-req="stage" value="${esc(r.stage || '')}" placeholder="напр. П / РД" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label title="ГИП (Главный Инженер Проекта) или ответственный исполнитель.">
        <span style="font-size:11.5px;color:#475569;display:block">ГИП / исполнитель:</span>
        <input type="text" data-req="gip" value="${esc(r.gip || '')}" placeholder="напр. Малыхин Д." style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
      <label title="Тип/категория объекта (ЦОД, серверная, диспетчерская, электрощитовая, и т.п.). Используется в отчётах для контекста.">
        <span style="font-size:11.5px;color:#475569;display:block">Тип объекта:</span>
        <input type="text" data-req="objectType" value="${esc(r.objectType || '')}" placeholder="напр. МЦОД / серверная" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
    </div>
    <label title="Развёрнутое описание проекта: цель, особенности, ключевые требования. Выводится в общей шапке отчёта.">
      <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:4px">Общее описание:</span>
      <textarea data-req="description" rows="3" placeholder="Краткое описание проекта — цели, состав, особенности." style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12.5px;resize:vertical">${esc(r.description || '')}</textarea>
    </label>
    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:14px 0">
    <h4 style="margin:0 0 8px;font-size:12.5px;color:#075985;text-transform:uppercase;letter-spacing:0.4px" title="Местоположение объекта — задаётся выбором датасета из модуля Метеоданные. Передаётся во все calc-модули (cooling, психрометрия) автоматически.">📍 Местоположение объекта</h4>
  `;

  const mode = p.locationMode || 'single';
  let bodyHtml = '';
  if (mode === 'single') {
    const loc = p.location || { city: '', country: '', lat: '', lon: '' };
    const hasLoc = !!(loc.city || loc.lat);
    bodyHtml = `
      <div class="pr-loc-display" style="padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;margin-bottom:8px">
        ${hasLoc
          ? `<div style="font-size:13px;font-weight:600;color:#075985">📍 ${esc(loc.city || '?')}${loc.country ? `, ${esc(loc.country)}` : ''}</div>
             <div style="font-size:11.5px;color:#475569;margin-top:3px">Координаты: ${loc.lat ?? '?'}, ${loc.lon ?? '?'}</div>`
          : `<div style="font-size:12.5px;color:#92400e">⚠ Местоположение не задано. Выберите датасет из модуля Метеоданные.</div>`
        }
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="pr-pick-meteo-loc" class="pr-btn-sel" style="font-size:12px;padding:6px 14px"
                title="Открыть модуль «Метеоданные» в embed-режиме: выберите нужный датасет (или загрузите новый по координатам), нажмите «✓ Применить и вернуться» — координаты заполнятся автоматически.">📅 Выбрать из Метеоданных →</button>
        <button type="button" id="pr-pick-map" class="pr-btn-sel" style="font-size:12px;padding:6px 14px"
                title="Выбрать точку на карте OpenStreetMap. Для привязки к конкретному месту, разработки трасс и внеплощадочных кабельных линий.">🗺 Выбрать на карте</button>
      </div>
      <p class="muted" style="font-size:11px;margin:8px 0 0">
        💡 Эта локация автоматически передаётся во все calc-модули проекта (Метеоданные, Подбор холодильных систем, ID-диаграмма). Менять координаты в модулях нельзя — только здесь.
      </p>
    `;
  } else {
    const locs = Array.isArray(p.locations) ? p.locations : [];
    bodyHtml = `
      <p class="muted" style="font-size:11.5px;margin:0 0 8px">
        🌍 Multi-location проект: для разработки типовых решений и проверки на разных площадках. Calc-модули показывают selector «Локация» в боковой панели и считают для выбранной.
      </p>
      <div id="pr-locs-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
        ${locs.length ? locs.map(L => `
          <div class="pr-loc-row" data-loc-id="${esc(L.id)}" style="display:grid;grid-template-columns:auto 1fr 110px 90px 90px auto;gap:6px;align-items:center;padding:6px 8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;font-size:12px">
            <button type="button" data-act="loc-primary" data-id="${esc(L.id)}" title="${L.isPrimary ? '★ Основная локация' : 'Сделать основной'}" style="background:none;border:none;cursor:pointer;font-size:14px;color:${L.isPrimary ? '#f59e0b' : '#94a3b8'}">★</button>
            <input type="text" data-locm="name" data-id="${esc(L.id)}" value="${esc(L.name || L.city || '')}" placeholder="Имя локации" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            <input type="text" data-locm="city" data-id="${esc(L.id)}" value="${esc(L.city || '')}" placeholder="Город" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            <input type="number" step="0.001" data-locm="lat" data-id="${esc(L.id)}" value="${L.lat ?? ''}" placeholder="lat" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            <input type="number" step="0.001" data-locm="lon" data-id="${esc(L.id)}" value="${L.lon ?? ''}" placeholder="lon" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            <button type="button" data-act="loc-del" data-id="${esc(L.id)}" title="Удалить локацию" style="background:none;border:none;cursor:pointer;color:#dc2626">🗑</button>
          </div>`).join('') : '<div class="muted" style="font-size:12px;padding:6px">Локаций пока нет.</div>'}
      </div>
      <button type="button" id="pr-loc-add" class="pr-btn-sel" style="font-size:12px;padding:5px 12px" title="Добавить новую локацию в этот multi-проект.">+ Добавить локацию</button>
    `;
  }
  host.innerHTML = `
    ${requisitesHtml}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:12.5px;color:#475569" title="Single — одна локация для всего проекта (типовое использование). Multi — несколько локаций (для разработки типовых решений и проверки в разных климат-зонах).">Режим:</span>
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px" title="Одна локация на весь проект. Calc-модули используют её и не позволяют менять.">
        <input type="radio" name="pr-loc-mode" value="single"${mode === 'single' ? ' checked' : ''}> Single (одна локация)
      </label>
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px" title="Несколько локаций в проекте — для разработки типовых решений и проверки в разных климат-зонах. Calc-модули показывают selector локации.">
        <input type="radio" name="pr-loc-mode" value="multi"${mode === 'multi' ? ' checked' : ''}> Multi (несколько локаций)
      </label>
    </div>
    ${bodyHtml}
  `;

  // Wire mode toggle
  host.querySelectorAll('input[name="pr-loc-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const newMode = r.value;
      if (newMode === p.locationMode) return;
      // Миграция: при переходе single→multi — превращаем единственную локацию в первую запись.
      // multi→single — берём primary либо первую.
      let patch = { locationMode: newMode };
      if (newMode === 'multi') {
        const cur = p.location || {};
        const seedLocs = (Array.isArray(p.locations) && p.locations.length)
          ? p.locations
          : [{ id: 'loc-' + Date.now(), name: cur.city || 'Локация 1', city: cur.city || '', country: cur.country || '', lat: cur.lat ?? null, lon: cur.lon ?? null, isPrimary: true }];
        patch.locations = seedLocs;
      } else {
        const primary = (p.locations || []).find(L => L.isPrimary) || (p.locations || [])[0];
        if (primary) patch.location = { city: primary.city, country: primary.country, lat: primary.lat, lon: primary.lon };
      }
      updateProject(p.id, patch);
      render();   // re-render
    });
  });

  // Wire requisites field changes (project.requisites = {code, customer, address, stage, gip, objectType, description})
  host.querySelectorAll('[data-req]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.req;
      const val = inp.value;
      const requisites = { ...(p.requisites || {}), [field]: val };
      updateProject(p.id, { requisites });
    });
  });

  // Wire single-mode field changes (legacy — оставлено для multi-mode совместимости)
  host.querySelectorAll('[data-loc]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.loc;
      const val = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
      const loc = { ...(p.location || {}), [field]: val };
      updateProject(p.id, { location: loc });
      prToast('✔ Локация обновлена');
    });
  });

  // v0.60.10: «📅 Выбрать из Метеоданных» — embed-pattern
  const pickMeteoBtn = host.querySelector('#pr-pick-meteo-loc');
  if (pickMeteoBtn) {
    pickMeteoBtn.addEventListener('click', async () => {
      try {
        const nav = await import('../shared/module-nav.js');
        nav.openEmbed(location.pathname + location.search, '../meteo/', `Свойства проекта «${p.name}»`);
      } catch (e) { prToast('Ошибка: ' + e.message, 'error'); }
    });
  }

  // v0.60.10: «🗺 Выбрать на карте» — Leaflet/OpenStreetMap picker
  const pickMapBtn = host.querySelector('#pr-pick-map');
  if (pickMapBtn) {
    pickMapBtn.addEventListener('click', () => openMapPicker(p));
  }
}

/* v0.60.10: Picker точки на карте OpenStreetMap (Leaflet).
   По требованию Пользователя 2026-05-02: «для проекта так же добавь
   выбор точки на карте. для привязки к конкретному месту и разработки
   кабельных трасс внеплощадочных. можно интегрировать с openstreetmap».
   Открывает модалку с картой + click для выбора координат.
   После выбора пишет в project.location {city: '', lat, lon}. Reverse-
   geocoding (для авто-заполнения city/country) — TODO в Phase 22.13.x. */
function openMapPicker(p) {
  if (typeof L === 'undefined') { prToast('Leaflet не загрузился (проверьте интернет)', 'error'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'pr-overlay';
  overlay.innerHTML = `
    <div class="pr-modal" style="max-width:720px;width:92vw">
      <h3>🗺 Выбор точки на карте</h3>
      <p class="muted" style="font-size:12px;margin:0 0 8px">Кликните по карте для выбора координат. Координаты заполнятся в свойствах проекта.</p>
      <div id="pr-map-host" style="width:100%;height:420px;border:1px solid #cbd5e1;border-radius:4px"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap">
        <span id="pr-map-coords" style="font-size:12px;color:#475569">Координаты: не выбраны</span>
        <div style="display:flex;gap:6px">
          <button type="button" class="pr-btn-cancel" id="pr-map-cancel">Отмена</button>
          <button type="button" class="pr-btn-primary" id="pr-map-apply" disabled>Применить</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const cur = p.location || {};
  const startLat = cur.lat || 51.0;
  const startLon = cur.lon || 71.0;
  const map = L.map(overlay.querySelector('#pr-map-host')).setView([startLat, startLon], cur.lat ? 12 : 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  let marker = null;
  if (cur.lat && cur.lon) {
    marker = L.marker([cur.lat, cur.lon]).addTo(map);
    overlay.querySelector('#pr-map-coords').textContent = `Координаты: ${cur.lat.toFixed(4)}, ${cur.lon.toFixed(4)}`;
    overlay.querySelector('#pr-map-apply').disabled = false;
  }
  let pickedLat = cur.lat, pickedLon = cur.lon;
  map.on('click', (e) => {
    pickedLat = +e.latlng.lat.toFixed(4);
    pickedLon = +e.latlng.lng.toFixed(4);
    if (marker) marker.setLatLng([pickedLat, pickedLon]);
    else marker = L.marker([pickedLat, pickedLon]).addTo(map);
    overlay.querySelector('#pr-map-coords').textContent = `Координаты: ${pickedLat}, ${pickedLon}`;
    overlay.querySelector('#pr-map-apply').disabled = false;
  });
  overlay.querySelector('#pr-map-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pr-map-apply').addEventListener('click', () => {
    if (!Number.isFinite(pickedLat) || !Number.isFinite(pickedLon)) return;
    const loc = { ...(p.location || {}), lat: pickedLat, lon: pickedLon };
    updateProject(p.id, { location: loc });
    prToast(`✔ Координаты применены: ${pickedLat}, ${pickedLon}`);
    overlay.remove();
    render();
  });
  // Trigger resize в случае если карта рендерится в скрытом контейнере (pre-modal)
  setTimeout(() => map.invalidateSize(), 100);

  // Wire multi-mode field changes / add / delete / set-primary
  host.querySelectorAll('[data-locm]').forEach(inp => {
    inp.addEventListener('change', () => {
      const id = inp.dataset.id;
      const field = inp.dataset.locm;
      const val = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
      const locs = (p.locations || []).map(L => L.id === id ? { ...L, [field]: val } : L);
      updateProject(p.id, { locations: locs });
    });
  });
  const addLocBtn = host.querySelector('#pr-loc-add');
  if (addLocBtn) addLocBtn.addEventListener('click', () => {
    const locs = [...(p.locations || [])];
    const newLoc = { id: 'loc-' + Date.now(), name: 'Локация ' + (locs.length + 1), city: '', country: '', lat: null, lon: null, isPrimary: !locs.length };
    locs.push(newLoc);
    updateProject(p.id, { locations: locs });
    render();
  });
  host.querySelectorAll('[data-act="loc-primary"]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      const locs = (p.locations || []).map(L => ({ ...L, isPrimary: L.id === id }));
      updateProject(p.id, { locations: locs });
      render();
    });
  });
  host.querySelectorAll('[data-act="loc-del"]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const L = (p.locations || []).find(x => x.id === id);
      if (!L) return;
      const ok = await prConfirm(`Удалить локацию «${L.name || L.city}»?`, 'Calc-модули, использовавшие эту локацию, переключатся на ★ основную.');
      if (!ok) return;
      const locs = (p.locations || []).filter(x => x.id !== id);
      // Если удалили primary — назначим primary первой оставшейся.
      if (L.isPrimary && locs.length) locs[0].isPrimary = true;
      updateProject(p.id, { locations: locs });
      render();
    });
  });
}

/* ---------- Курируемый набор модулей проекта ----------
   Только то, что имеет смысл В КОНТЕКСТЕ ПРОЕКТА:
   - Конструктор схем (универсальный — электрика, гидравлика, механика,
     СКС; со связью со всеми объектами проекта)
   - Проектирование СКС (меж-шкафные связи + план зала; также может быть
     встроен как блок внутрь Конструктора схем)
   - Компоновщик шкафа (содержимое экземпляров)
   - Реестр IT-оборудования (S/N, IP, MAC)
   - Реестр оборудования объекта (мебель, ЗИП)
   - Модульный ЦОД (если объект — МДЦ)

   НЕ показываем здесь: cable, mv-config, ups-config, panel-config,
   pdu-config, transformer-config, suppression-config, rack-config —
   они «штучные», запускаются с hub.html для разовых расчётов или
   из других модулей по контексту (например, кнопка «Расчёт кабеля»
   на узле схемы откроет cable с уже подставленными параметрами). */
const PROJECT_MODULES = [
  {
    id: 'tech-workspace',
    href: '../tech-workspace/',
    icon: '🧮',
    label: 'Технолог ЦОД',
    desc: 'Предпроектная стадия: концепция объекта (стойки, IT-нагрузка, ИБП, климат, ввод ТП/ДГУ, площади), multi-variant compare, handoff в schematic/scs-design/mdc-config.',
    color: '#7c3aed',
  },
  {
    id: 'schematic',
    href: '../index.html',
    icon: '⚡',
    label: 'Конструктор схем',
    desc: 'Любые схемы объекта: электрика, гидравлика, механика, СКС. Связан со всеми объектами проекта (стойки, шкафы, реестры).',
    color: '#1d4ed8',
  },
  {
    id: 'scs-design',
    href: '../scs-design/',
    icon: '🔗',
    label: 'Проектирование СКС',
    desc: 'Меж-шкафные связи, план зала, кабельный журнал. Может быть встроена в схему как блок.',
    color: '#0d9488',
  },
  {
    id: 'scs-config',
    href: '../scs-config/',
    icon: '🗄',
    label: 'Компоновщик шкафа',
    desc: 'Содержимое каждого экземпляра шкафа. Серверные стойки из схемы попадают сюда штучно с уникальным Tag.',
    color: '#7c3aed',
  },
  {
    id: 'scs-config-inventory',
    href: '../scs-config/inventory.html',
    icon: '📦',
    label: 'Реестр IT-оборудования',
    desc: 'S/N, IP, MAC, инвентарные номера серверов, свичей, патч-панелей.',
    color: '#0891b2',
  },
  {
    id: 'facility-inventory',
    href: '../facility-inventory/',
    icon: '🏭',
    label: 'Реестр оборудования объекта',
    desc: 'Не-IT имущество: мебель, стеллажи, ЗИП, КИПиА, инструмент.',
    color: '#b45309',
  },
  {
    id: 'mdc-config',
    href: '../mdc-config/',
    icon: '🏗',
    label: 'Модульный ЦОД',
    desc: 'Если объект — МДЦ (GDM-600): wizard зон, расстановка стоек/ИБП/кондёров, top-view.',
    color: '#be185d',
  },
  {
    id: 'cooling',
    href: '../cooling/',
    icon: '❄',
    label: 'Подбор холодильных систем',
    desc: 'Технико-экономическое сравнение чиллеров (CHW), DX-систем, free-cooling и CRAC. CAPEX/OPEX/TCO/payback по климатическим данным проекта. Несколько подборов разных систем, в каждом — варианты с ★-основным.',
    color: '#0891b2',
  },
];

/* ---------- Статусы ---------- */
const STATUSES = [
  { id: 'draft',     label: 'Черновик',        color: '#64748b', bg: '#e2e8f0' },
  { id: 'planned',   label: 'Проектируется',   color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'installed', label: 'Смонтирован',     color: '#b45309', bg: '#fef3c7' },
  { id: 'operating', label: 'Эксплуатируется', color: '#047857', bg: '#d1fae5' },
  { id: 'archived',  label: 'Архив',           color: '#475569', bg: '#f1f5f9' },
];
function statusMeta(id) { return STATUSES.find(s => s.id === id) || STATUSES[0]; }

function prStatusPicker(current) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    const rows = STATUSES.map(s => `
      <button type="button" class="pr-status-row" data-id="${s.id}" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:1px solid ${s.id === current ? s.color : '#e2e8f0'};background:${s.id === current ? s.bg : '#fff'};border-radius:8px;cursor:pointer;margin-bottom:6px;text-align:left">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color}"></span>
        <b style="color:${s.color}">${s.label}</b>
        ${s.id === current ? '<span style="margin-left:auto;color:' + s.color + ';font-size:12px">✓ текущий</span>' : ''}
      </button>`).join('');
    overlay.innerHTML = `
      <div class="pr-modal" style="max-width:420px">
        <h3>Статус проекта</h3>
        <div style="margin:10px 0">${rows}</div>
        <div class="pr-modal-actions"><button type="button" class="pr-btn-sel" data-act="no">Закрыть</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      const row = e.target.closest('.pr-status-row');
      if (row) done(row.dataset.id);
      if (e.target.dataset?.act === 'no') done(null);
    });
  });
}

/* ---------- Статистика проекта ---------- */
function projectStats(pid) {
  const s = { nodes: 0, racks: 0, links: 0, inventory: 0, facility: 0 };
  try {
    const sch = localStorage.getItem(`raschet.project.${pid}.engine.scheme.v1`);
    if (sch) { try { s.nodes = (JSON.parse(sch).nodes || []).length; } catch {} }
  } catch {}
  try {
    // v0.59.379: предпочитаем считать по реальным экземплярам стоек проекта
    // (rack-config.instances.v1), а не по orphan-данным contents/rackTags.
    const inst = localStorage.getItem(`raschet.project.${pid}.rack-config.instances.v1`);
    let nInst = 0;
    try { const arr = inst ? JSON.parse(inst) : []; nInst = Array.isArray(arr) ? arr.length : 0; } catch {}
    if (nInst > 0) {
      s.racks = nInst;
    } else {
      const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
      const tags = localStorage.getItem(`raschet.project.${pid}.scs-config.rackTags.v1`);
      const ids = new Set();
      try { const o = cont ? JSON.parse(cont) : {}; Object.keys(o || {}).forEach(k => { if (Array.isArray(o[k]) && o[k].length) ids.add(k); }); } catch {}
      try { const o = tags ? JSON.parse(tags) : {}; Object.keys(o || {}).forEach(k => { if ((o[k] || '').trim()) ids.add(k); }); } catch {}
      s.racks = ids.size;
    }
  } catch {}
  try {
    const ln = localStorage.getItem(`raschet.project.${pid}.scs-design.links.v1`);
    if (ln) { try { s.links = (JSON.parse(ln) || []).length; } catch {} }
  } catch {}
  try {
    const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
    if (cont) { try { const o = JSON.parse(cont) || {}; s.inventory = Object.values(o).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0); } catch {} }
  } catch {}
  try {
    const f = localStorage.getItem(`raschet.project.${pid}.facility-inventory.v1`);
    if (f) {
      try {
        const o = JSON.parse(f);
        if (Array.isArray(o)) s.facility = o.length;
        else if (o && Array.isArray(o.items)) s.facility = o.items.length;
      } catch {}
    }
  } catch {}
  return s;
}

/* ---------- Получаем pid из URL ---------- */
function getPid() {
  try { return new URLSearchParams(location.search).get('project') || null; }
  catch { return null; }
}

/* ---------- Rendering ---------- */
function render() {
  const pid = getPid();
  const p = pid ? getProject(pid) : null;

  const headHost = document.getElementById('pr-detail-head');
  const propsHost = document.getElementById('pr-detail-properties');
  const modulesHost = document.getElementById('pr-detail-modules');
  const actionsHost = document.getElementById('pr-detail-actions');
  const metaHost = document.getElementById('pr-detail-meta');

  if (!p) {
    if (headHost) headHost.innerHTML = `
      <div class="pr-empty">
        Проект не найден. <a href="./">← назад к списку проектов</a>
      </div>`;
    if (propsHost) propsHost.innerHTML = '';
    if (modulesHost) modulesHost.innerHTML = '';
    if (actionsHost) actionsHost.innerHTML = '';
    if (metaHost) metaHost.innerHTML = '';
    return;
  }

  const st = statusMeta(p.status || 'draft');
  const s = projectStats(p.id);

  if (headHost) {
    headHost.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h1 style="margin:0;font-size:24px">${esc(p.name || '(без имени)')}</h1>
            <span class="pr-badge-status" style="background:${st.bg};color:${st.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${esc(st.label)}</span>
            ${p.kind === 'sketch' ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">🧪 Мини-проект</span>' : ''}
          </div>
          ${p.description ? `<p style="margin:10px 0 0;color:#475569">${esc(p.description)}</p>` : '<p class="muted" style="margin:10px 0 0;font-style:italic">Описание не задано</p>'}
        </div>
        <div>
          <a href="./" class="pr-btn-sel">← к списку проектов</a>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:6px">
        ${badgeChip('⚡', s.nodes,     'узлов в схеме',           '#dbeafe', '#1d4ed8')}
        ${badgeChip('🗄', s.racks,     'стоек',                   '#ede9fe', '#7c3aed')}
        ${badgeChip('🔗', s.links,     'СКС-связей',              '#cffafe', '#0e7490')}
        ${badgeChip('📦', s.inventory, 'IT-устройств',            '#e0f2fe', '#0369a1')}
        ${badgeChip('🏭', s.facility,  'позиций объекта',         '#fef3c7', '#a16207')}
      </div>`;
  }

  if (modulesHost) {
    // v0.59.373: вместо плоских плашек конфигураторов — модель «артефактов»
    // внутри проекта. Кнопка «+ Добавить» создаёт подпроект (sketch с
    // parentProjectId) нужного типа: схема / СКС / шкаф. Реестры (IT и
    // объект) — singleton'ы проекта, выводятся отдельными кнопками.
    // v0.59.565: strict=true — каждая плитка показывает СВОИ subs, без
    // межсемейного «протекания» (раньше mdc-config плитка показывала и
    // v0.60.2: render Свойств проекта (location + multi-location toggle).
    if (propsHost) renderProjectProperties(p, propsHost);

    // scs-design subs из-за общего MODULE_FAMILIES).
    const subSchemes  = listSubProjects(p.id, 'schematic',  { strict: true });
    const subScs      = listSubProjects(p.id, 'scs-design', { strict: true });
    const subRacks    = listSubProjects(p.id, 'scs-config', { strict: true });
    const subMdc      = listSubProjects(p.id, 'mdc-config', { strict: true });
    // v0.59.997: подборы холодильных систем хранятся не как sub-projects,
    // а как массив в LS-bucket cooling.selections.v1 проекта. Читаем напрямую.
    let subCoolings = [];
    try {
      const raw = localStorage.getItem(projectKey(p.id, 'cooling', 'selections.v1'));
      const arr = raw ? JSON.parse(raw) : [];
      subCoolings = Array.isArray(arr) ? arr.map(s => ({
        id: s.id, name: s.name,
        meta: `${s.options?.length || 0} вариант${(s.options?.length === 1) ? '' : 'ов'}${s.mainOptionId ? ', есть ★' : ''}`,
      })) : [];
    } catch { subCoolings = []; }

    // v0.59.862: «Карточка модуля появляется только когда есть данные».
    // Singleton-модули (Технолог ЦОД, IT-инвентарь, реестр объекта) видимы
    // если в LS есть их данные; multi-instance (схемы/СКС/шкафы/МЦОД) —
    // если есть подпроекты или (для схемы) Storage-схемы привязаны через
    // scheme.projectId. Те, у которых данных нет — доступны через
    // «+ Добавить ▾».
    const _lsHasContent = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const v = JSON.parse(raw);
        if (Array.isArray(v)) return v.length > 0;
        if (v && typeof v === 'object') return Object.keys(v).length > 0;
        return v != null;
      } catch { return false; }
    };
    const hasTechWorkspace = _lsHasContent(projectKey(p.id, 'tech-workspace', 'variants.v1'));
    const hasInventoryIT   = _lsHasContent(projectKey(p.id, 'scs-config', 'inventory.v1'));
    const hasFacilityInv   = _lsHasContent(projectKey(p.id, 'facility-inventory', 'v1'));
    // SCS legacy-данные в parent namespace (см. async-блок ниже).
    const hasScsLegacy = (() => {
      try {
        const links = JSON.parse(localStorage.getItem(projectKey(p.id, 'scs-design', 'links.v1')) || 'null');
        const plan  = JSON.parse(localStorage.getItem(projectKey(p.id, 'scs-design', 'plan.v1')) || 'null');
        return (Array.isArray(links) && links.length) || (plan && (plan.items || []).length);
      } catch { return false; }
    })();

    const renderSubList = (subs, modHref, icon) => {
      if (!subs.length) return '';
      return subs.map(sp => {
        const href = buildModuleHref(modHref, { projectId: sp.id, fromModule: 'projects' });
        const desig = sp.designation ? `<span style="background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-right:6px">${esc(sp.designation)}</span>` : '';
        return `
        <div class="pr-sub-row" data-sub-id="${esc(sp.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
          <span style="font-size:16px">${icon}</span>
          ${desig}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sp.name || '(без имени)')}</span>
          <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px">Открыть →</a>
          <button type="button" class="pr-btn-sel" data-act="rename-sub" style="font-size:12px;padding:3px 8px">✎</button>
          <button type="button" class="pr-btn-danger" data-act="delete-sub" style="font-size:12px;padding:3px 8px">✕</button>
        </div>`;
      }).join('');
    };

    // v0.59.862: единый список модулей проекта. type=multi → можно создать
    // несколько; type=singleton → один экземпляр на проект. visible flag
    // решает, рендерить ли карточку. «hidden» модули доступны через
    // «+ Добавить ▾». Свойство `latent` для schematic/scs-design — карточка
    // может «просветиться» позже (через async _enrichGroup): держим её
    // в DOM, но display:none, на случай если данные появятся.
    const MODULES = [
      {
        id: 'tech-workspace', type: 'singleton',
        title: '🧮 Технолог ЦОД', subtitle: 'концепция',
        color: '#7c3aed', accent: '#ede9fe', border: '#c4b5fd',
        href: '../tech-workspace/',
        visible: hasTechWorkspace,
        addLabel: '🧮 Технолог ЦОД (концепция)',
        bodyHtml: `<div style="font-size:12px;color:#475569;margin-bottom:8px">Концепция стоек, IT-нагрузка, ИБП, климат. Multi-variant compare и handoff в схему/СКС.</div>
                   <a href="${esc(buildModuleHref('../tech-workspace/', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel" style="display:inline-block;text-decoration:none;padding:5px 10px;font-size:12px;background:#ede9fe;color:#6d28d9;border:1px solid #c4b5fd;border-radius:4px">Открыть Технолог ЦОД →</a>`,
      },
      {
        id: 'schematic', type: 'multi',
        title: '⚡ Схемы', count: subSchemes.length,
        color: '#1d4ed8',
        href: '../index.html',
        visible: subSchemes.length > 0, // м.б. дополнено async-Storage
        latent: true,
        addLabel: '⚡ Добавить схему',
        bodyHtml: renderSubList(subSchemes, '../index.html', '⚡'),
      },
      {
        id: 'scs-design', type: 'multi',
        title: '🔗 СКС-проекты', count: subScs.length,
        color: '#0d9488',
        href: '../scs-design/',
        visible: subScs.length > 0 || hasScsLegacy,
        latent: true,
        addLabel: '🔗 Добавить СКС-проект',
        bodyHtml: renderSubList(subScs, '../scs-design/', '🔗'),
      },
      {
        id: 'scs-config', type: 'multi',
        title: '🗄 Компоновки шкафов', count: subRacks.length,
        color: '#7c3aed',
        href: '../scs-config/',
        visible: subRacks.length > 0,
        addLabel: '🗄 Добавить шкаф (компоновка)',
        bodyHtml: renderSubList(subRacks, '../scs-config/', '🗄'),
      },
      {
        id: 'mdc-config', type: 'multi',
        title: '🏗 Модульные ЦОД', count: subMdc.length,
        color: '#be185d',
        href: '../mdc-config/',
        visible: subMdc.length > 0,
        addLabel: '🏗 Добавить модульный ЦОД',
        bodyHtml: renderSubList(subMdc, '../mdc-config/', '🏗'),
      },
      {
        id: 'cooling', type: 'multi',
        title: '❄ Подборы холодильных систем', count: subCoolings.length,
        color: '#0891b2',
        href: '../cooling/',
        visible: subCoolings.length > 0,
        addLabel: '❄ Добавить подбор холодильных систем',
        bodyHtml: subCoolings.length
          ? subCoolings.map(s => `
              <div class="pr-sub-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
                <span style="font-size:16px">❄</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name)} — ${esc(s.meta)}">${esc(s.name)}</span>
                <span class="muted" style="font-size:11px">${esc(s.meta)}</span>
                <a href="${esc(buildModuleHref('../cooling/', { projectId: p.id, fromModule: 'projects', openSelection: s.id }))}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px" title="Открыть этот подбор в модуле «Подбор холодильных систем»">Открыть →</a>
              </div>`).join('')
          : '',
      },
      {
        id: 'inventory-it', type: 'singleton',
        title: '📦 Реестр IT-оборудования', subtitle: '',
        color: '#0369a1', accent: '#e0f2fe', border: '#7dd3fc',
        href: '../scs-config/inventory.html',
        visible: hasInventoryIT,
        addLabel: '📦 Реестр IT-оборудования',
        bodyHtml: `<div style="font-size:12px;color:#475569;margin-bottom:8px">S/N, IP, MAC экземпляров серверов и свичей.</div>
                   <a href="${esc(buildModuleHref('../scs-config/inventory.html', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel" style="display:inline-block;text-decoration:none;padding:5px 10px;font-size:12px;background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;border-radius:4px">Открыть реестр →</a>`,
      },
      {
        id: 'facility-inventory', type: 'singleton',
        title: '🏭 Реестр оборудования объекта', subtitle: '',
        color: '#a16207', accent: '#fef3c7', border: '#fcd34d',
        href: '../facility-inventory/',
        visible: hasFacilityInv,
        addLabel: '🏭 Реестр оборудования объекта',
        bodyHtml: `<div style="font-size:12px;color:#475569;margin-bottom:8px">Не-IT имущество: мебель, стеллажи, ЗИП.</div>
                   <a href="${esc(buildModuleHref('../facility-inventory/', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel" style="display:inline-block;text-decoration:none;padding:5px 10px;font-size:12px;background:#fef3c7;color:#a16207;border:1px solid #fcd34d;border-radius:4px">Открыть реестр →</a>`,
      },
    ];

    // v0.59.862: пункты для меню «+ Добавить ▾».
    // Multi — всегда; Singleton — только если карточки ещё нет.
    const addMenuItems = MODULES.filter(m => m.type === 'multi' || !m.visible);

    const moduleCardHtml = (m) => {
      // latent: карточка в DOM, но display:none, готова просветиться
      // позже из async-загрузчика (Storage-схемы / SCS-legacy).
      const hidden = !m.visible;
      const display = hidden ? 'display:none;' : '';
      const countSpan = m.type === 'multi'
        ? ` <span class="muted" style="font-weight:400">· ${m.count || 0}</span>`
        : (m.subtitle ? ` <span class="muted" style="font-weight:400">· ${esc(m.subtitle)}</span>` : '');
      return `<div class="pr-art-group" data-kind="${esc(m.id)}" style="${display}padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-weight:600;font-size:13px;color:${m.color};margin-bottom:8px">${m.title}${countSpan}</div>
        ${m.bodyHtml}
      </div>`;
    };

    modulesHost.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <div style="position:relative">
          <button type="button" class="pr-btn-primary" id="pr-add-btn">＋ Добавить ▾</button>
          <div id="pr-add-menu" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:10;min-width:280px">
            ${addMenuItems.map((m, i) => `<button type="button" data-add="${esc(m.id)}" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-size:13px;${i > 0 ? 'border-top:1px solid #f1f5f9;' : ''}">${esc(m.addLabel || m.title)}</button>`).join('')}
            ${addMenuItems.length === 0 ? '<div class="muted" style="padding:10px 14px;font-size:12px">Все модули уже подключены — добавьте новый подпроект из карточки модуля.</div>' : ''}
          </div>
        </div>
      </div>

      ${MODULES.every(m => !m.visible) ? `
        <div id="pr-empty-modules" style="text-align:center;padding:24px;color:#64748b;background:#f1f5f9;border-radius:8px;border:1px dashed #cbd5e1;margin-bottom:14px">
          <div style="font-size:14px;margin-bottom:6px">📦 В проекте пока нет данных</div>
          <div style="font-size:12px">Нажмите «＋ Добавить ▾» вверху, чтобы начать с концепции (Технолог ЦОД), схемы, СКС или шкафа.</div>
        </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
        ${MODULES.filter(m => m.visible || m.latent).map(moduleCardHtml).join('')}
      </div>`;

    // — меню «+ Добавить ▾»
    const addBtn = modulesHost.querySelector('#pr-add-btn');
    const addMenu = modulesHost.querySelector('#pr-add-menu');
    addBtn?.addEventListener('click', e => {
      e.stopPropagation();
      addMenu.style.display = addMenu.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => { if (addMenu) addMenu.style.display = 'none'; });
    // v0.59.862: addOpts расширен singletons (kind=singleton — просто
    // navigate в модуль; данные создадутся при первом сейве).
    const addOpts = {
      'schematic':          { kind: 'multi-storage',    label: 'схема',         href: '../index.html',     defaultDesig: 'Схема-1', defaultName: 'Схема' },
      'scs-design':         { kind: 'multi-sub',        label: 'СКС-проект',    href: '../scs-design/',    defaultDesig: 'СКС-1',   defaultName: 'СКС-проект' },
      'scs-config':         { kind: 'multi-sub',        label: 'шкаф',          href: '../scs-config/',    defaultDesig: 'Ш-1',     defaultName: 'Компоновка шкафа' },
      'mdc-config':         { kind: 'multi-sub',        label: 'модульный ЦОД', href: '../mdc-config/',    defaultDesig: 'МЦОД-1',  defaultName: 'Модульный ЦОД' },
      'tech-workspace':     { kind: 'singleton',        label: 'Технолог ЦОД',  href: '../tech-workspace/' },
      'inventory-it':       { kind: 'singleton',        label: 'Реестр IT-оборудования', href: '../scs-config/inventory.html' },
      'facility-inventory': { kind: 'singleton',        label: 'Реестр оборудования объекта', href: '../facility-inventory/' },
      'cooling':            { kind: 'multi-cooling',    label: 'подбор холодильных систем', href: '../cooling/', defaultName: 'Подбор холодильных систем' },
    };
    modulesHost.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        addMenu.style.display = 'none';
        const moduleId = btn.dataset.add;
        const opt = addOpts[moduleId];
        if (!opt) return;

        // v0.59.862: singleton — просто открываем модуль с projectId родителя.
        if (opt.kind === 'singleton') {
          try { clearNavStack(); } catch {}
          location.href = buildModuleHref(opt.href, { projectId: p.id, fromModule: 'projects' });
          return;
        }

        const name = await prPrompt(`Добавить ${opt.label}`, 'Имя', opt.defaultName);
        if (name == null) return;

        // v0.59.375: для «схемы» используем настоящий window.Storage —
        // создаём legacy-схему и привязываем к проекту через
        // scheme.projectId. Так схема видна и на главной «Мои схемы»,
        // и на странице проекта (без двойного списка sub-проектов).
        // v0.59.997: «multi-cooling» — создаёт новый подбор в LS-bucket
        // cooling.selections.v1 этого проекта, затем редиректит в cooling.
        if (opt.kind === 'multi-cooling') {
          try {
            const key = projectKey(p.id, 'cooling', 'selections.v1');
            const activeKey = projectKey(p.id, 'cooling', 'activeSelectionId.v1');
            const arr = JSON.parse(localStorage.getItem(key) || '[]');
            const newSel = {
              id: 'sel-' + Date.now(),
              name: name.trim() || opt.defaultName,
              mainOptionId: null,
              activeOptionId: null,
              options: [],
            };
            arr.push(newSel);
            localStorage.setItem(key, JSON.stringify(arr));
            localStorage.setItem(activeKey, JSON.stringify(newSel.id));
            setActiveProjectId(p.id);
            prToast(`✔ Создан подбор «${newSel.name}»`);
            try { clearNavStack(); } catch {}
            location.href = buildModuleHref(opt.href, { projectId: p.id, fromModule: 'projects' });
          } catch (e) {
            console.error('[+ Подбор холодильных систем]', e);
            prToast('Ошибка создания подбора: ' + (e.message || e), 'error');
          }
          return;
        }

        if (opt.kind === 'multi-storage') {
          try {
            if (!window.Storage || typeof window.Storage.createProject !== 'function') {
              prToast('Storage не готов — попробуйте позже', 'error'); return;
            }
            const created = await window.Storage.createProject(name, null);
            if (!created || !created.id) throw new Error('createProject не вернул id');
            await window.Storage.saveProject(created.id, { projectId: p.id });
            prToast(`✔ Создана схема «${name}»`);
            try { clearNavStack(); } catch {}
            location.href = '../index.html?project=' + encodeURIComponent(created.id) + '&from=projects&fromCtx=' + encodeURIComponent(p.id);
          } catch (e) {
            console.error('[+ Добавить схему]', e);
            prToast('Ошибка создания схемы: ' + (e.message || e), 'error');
          }
          return;
        }

        const designation = await prPrompt('Обозначение', `Короткий код в рамках проекта (напр. ${opt.defaultDesig})`, opt.defaultDesig);
        const sp = createSubProject(p.id, moduleId, { name, designation: designation || '' });
        setActiveProjectId(sp.id);
        prToast(`✔ Создан подпроект «${sp.name}»`);
        try { clearNavStack(); } catch {}
        location.href = buildModuleHref(opt.href, { projectId: sp.id, fromModule: 'projects' });
      });
    });

    // — переименовать / удалить подпроект
    modulesHost.querySelectorAll('.pr-sub-row [data-act="rename-sub"]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.closest('.pr-sub-row')?.dataset.subId;
        const sp = id ? getProject(id) : null; if (!sp) return;
        const name = await prPrompt('Переименовать подпроект', 'Имя', sp.name || '');
        if (name == null) return;
        const designation = await prPrompt('Обозначение', 'Короткий код', sp.designation || '');
        updateProject(id, { name, designation: designation || '' });
        prToast('✔ Обновлено');
        render();
      });
    });
    modulesHost.querySelectorAll('.pr-sub-row [data-act="delete-sub"]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.closest('.pr-sub-row')?.dataset.subId;
        const sp = id ? getProject(id) : null; if (!sp) return;
        const ok = await prConfirm(
          `Удалить подпроект «${sp.name}»?`,
          'Удалятся метаданные и все scoped-данные подпроекта (raschet.project.' + sp.id + '.*). Действие необратимо.'
        );
        if (!ok) return;
        const { removedKeys } = deleteProject(id);
        prToast(`✔ Удалено${removedKeys ? ' (' + removedKeys + ' ключей LS)' : ''}`);
        render();
      });
    });

    // Сбрасываем back-stack при переходе.
    modulesHost.querySelectorAll('a[href]').forEach(a => {
      a.addEventListener('click', () => { try { clearNavStack(); } catch {} });
    });

    // v0.59.377: helper — заменить empty-hint и обновить счётчик группы.
    // v0.59.862: latent-карточка (display:none на старте) — un-hide когда
    // приходят async-данные. Также убираем «+ Добавить → схему» и т.д.
    // из меню «+ Добавить ▾», т.к. модуль теперь имеет данные (для multi
    // он остаётся, для singleton — убираем).
    const _enrichGroup = (kindAttr, addedRowsHtml, addedCount) => {
      if (!addedRowsHtml) return;
      const grp = modulesHost.querySelector(`.pr-art-group[data-kind="${kindAttr}"]`);
      if (!grp) return;
      // un-hide карточку если она была latent
      if (grp.style.display === 'none') grp.style.display = '';
      // спрятать «В проекте пока нет данных», если она была показана
      const emptyHint = modulesHost.querySelector('#pr-empty-modules');
      if (emptyHint) emptyHint.remove();
      // убрать «X нет — нажмите…»
      const placeholder = Array.from(grp.children).find(c => c.classList && c.classList.contains('muted'));
      if (placeholder) placeholder.remove();
      grp.insertAdjacentHTML('beforeend', addedRowsHtml);
      grp.querySelectorAll('a[href]').forEach(a => {
        a.addEventListener('click', () => { try { clearNavStack(); } catch {} });
      });
      // обновить счётчик в шапке
      const headSpan = grp.querySelector('div .muted');
      if (headSpan) {
        const m = (headSpan.textContent || '').match(/(\d+)/);
        const cur = m ? +m[1] : 0;
        headSpan.textContent = '· ' + (cur + addedCount);
      }
    };

    // v0.59.374/377/523: показываем в группе «Схемы» Storage-схемы
    // (то, что видно на главной «Мои схемы» и привязано к этому проекту
    // через scheme.projectId === p.id). Раньше использовался async
    // window.Storage.listMyProjects(), но он зависел от Storage init и
    // мог не вернуть данные вовремя. Теперь читаем напрямую из LS
    // (raschet.projects.v1) синхронно — тот же массив записей. Storage-
    // схемы детектируются по lp_-префиксу или Storage-полям
    // (scheme/memberUids/ownerEmail), исключая project-контейнеры.
    // v0.59.525: схемы могут жить ЛИБО в LS (Local mode), ЛИБО в
    // Firestore (cloud mode). Раньше я переписал на sync listProjects()
    // — это сломало cloud-режим (схемы там, LS пуст). Теперь используем
    // window.Storage.listMyProjects() async с ожиданием:
    //   1. Storage init готов (typeof === 'function')
    //   2. Если cloud-режим в принципе доступен (Firebase) — ждём auth
    //      готовности (Storage.isCloud = true) до 5 сек.
    //
    // p.id здесь — id проекта-контейнера. Схемы привязаны через
    // scheme.projectId === p.id (или legacy parentProjectId).
    (async () => {
      const _isCtx = (s) => {
        if (!s || typeof s.id !== 'string') return false;
        if (s.id.startsWith('p_') || s.id.startsWith('s_')) return true;
        if (s.kind === 'full' || s.kind === 'sketch') return true;
        return false;
      };
      try {
        // Ждём Storage. Если Firebase compat загружен (window.firebase) —
        // ждём пока Storage.isCloud станет true (auth state resolved).
        // Иначе — Local-режим, можно сразу.
        const start = Date.now();
        const hasFirebase = (typeof window.firebase !== 'undefined');
        while (Date.now() - start < 5000) {
          if (!window.Storage || typeof window.Storage.listMyProjects !== 'function') {
            await new Promise(r => setTimeout(r, 100)); continue;
          }
          if (hasFirebase && !window.Storage.isCloud) {
            // Возможно, ещё подключается. Ждём.
            await new Promise(r => setTimeout(r, 100)); continue;
          }
          break; // готово
        }
        if (!window.Storage || typeof window.Storage.listMyProjects !== 'function') {
          console.warn('[project.js] Storage не готов даже после 5с'); return;
        }

        const all = await window.Storage.listMyProjects();
        const mine = (all || []).filter(s => {
          if (!s || !s.id) return false;
          if (_isCtx(s)) return false;
          const sp = s.projectId || s.parentProjectId || '';
          return sp === p.id;
        });
        // Диагностика
        try {
          console.info(`[project.js] schemes load: pid=${p.id} mode=${window.Storage.mode} total=${(all||[]).length} mine=${mine.length}`);
        } catch {}
        if (!mine.length) return;
        const rowsHtml = mine.map(s => {
          const href = '../index.html?project=' + encodeURIComponent(s.id) + '&from=projects&fromCtx=' + encodeURIComponent(p.id);
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
            <span style="font-size:16px">⚡</span>
            <span style="background:#10b981;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">схема</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name || '')}">${esc(s.name || '(без имени)')}</span>
            <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px;text-decoration:none">Открыть →</a>
          </div>`;
        }).join('');
        _enrichGroup('schematic', rowsHtml, mine.length);
      } catch (e) { console.warn('[project.js] schemes load failed', e); }
    })();

    // v0.59.377: legacy-СКС в этом проекте — данные лежат под
    // raschet.project.<p.id>.scs-design.links.v1 (без подпроекта).
    // Если они есть — показываем единичную «СКС-проект (в проекте)» строку.
    // v0.59.556: legacy-режим устаревает. Авто-миграция выполняется в
    // scs-design.js при первом заходе в проект. Здесь просто показываем
    // строку — но без «костыльных» отметок «в проекте»: если данные
    // legacy остались, scs-design сам перенесёт их в default sub-project
    // (без явного шага создания), пользователь увидит уже единый «СКС».
    try {
      const scsLinksRaw = localStorage.getItem(`raschet.project.${p.id}.scs-design.links.v1`);
      const scsPlanRaw  = localStorage.getItem(`raschet.project.${p.id}.scs-design.plan.v1`);
      let scsLinks = []; let hasPlan = false;
      try { scsLinks = scsLinksRaw ? (JSON.parse(scsLinksRaw) || []) : []; } catch {}
      try { const o = scsPlanRaw ? JSON.parse(scsPlanRaw) : null; hasPlan = !!(o && (o.items || []).length); } catch {}
      if ((Array.isArray(scsLinks) && scsLinks.length) || hasPlan) {
        const href = '../scs-design/?project=' + encodeURIComponent(p.id) + '&from=projects';
        const meta = `${scsLinks.length} связ${scsLinks.length === 1 ? 'ь' : (scsLinks.length < 5 ? 'и' : 'ей')}` + (hasPlan ? ' · план' : '');
        // v0.59.571: дублирующая legacy-строка — реальные данные ещё в parent
        // namespace, но также есть подпроект scs-design (видим пользователю
        // как «2 строки в плитке СКС-проекты»). Кнопка «🔀 Объединить» зовёт
        // force-merge: переносит ключи parent→sub и перерисовывает.
        const rowHtml = `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;margin-bottom:4px">
          <span style="font-size:16px">🔗</span>
          <span style="flex:1;min-width:0">СКС <span class="muted" style="font-size:11px">· ${esc(meta)} (legacy в родителе)</span></span>
          <button type="button" class="pr-btn-sel" data-act="merge-legacy-scs" data-pid="${esc(p.id)}" title="Перенести legacy-данные СКС родителя в существующий или новый подпроект СКС. Дубликаты «СКС» в карточке исчезнут — останется один с этими 11 связями." style="font-size:12px;padding:3px 10px;background:#fbbf24;border-color:#f59e0b;color:#78350f">🔀 Объединить</button>
          <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px;text-decoration:none">Открыть →</a>
        </div>`;
        _enrichGroup('scs-design', rowHtml, 1);
        // v0.59.571: handler «🔀 Объединить» — force-merge parent.scs-design.*
        // → существующий sub (или создать). После — re-render карточки.
        const mergeBtn = modulesHost.querySelector('[data-act="merge-legacy-scs"][data-pid="' + p.id + '"]');
        if (mergeBtn) mergeBtn.addEventListener('click', async () => {
          try {
            const ps = await import('../shared/project-storage.js');
            // Найдём или создадим sub.
            const existingSubs = ps.listSubProjects(p.id, 'scs-design');
            let dest = existingSubs[0];
            let createdSub = false;
            if (!dest) {
              dest = ps.createSubProject(p.id, 'scs-design', { name: 'СКС', designation: '' });
              createdSub = true;
            }
            if (!dest || !dest.id) { prToast('Не удалось создать/найти СКС-подпроект', 'error'); return; }
            // Force-merge: копируем все scs-design.* ключи parent → sub, удаляем источник.
            const prefix = 'raschet.project.' + p.id + '.scs-design.';
            const subPrefix = 'raschet.project.' + dest.id + '.scs-design.';
            const toMove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix)) toMove.push(k);
            }
            let moved = 0;
            for (const k of toMove) {
              const v = localStorage.getItem(k);
              if (v == null) continue;
              try {
                localStorage.setItem(subPrefix + k.slice(prefix.length), v);
                localStorage.removeItem(k);
                moved++;
              } catch (e) { console.warn('[project.js] merge failed for', k, e); }
            }
            // Сбросить session-flag scs-design'а, чтобы при заходе он не считал legacy «застрявшим».
            try { sessionStorage.removeItem('raschet.scs-design.legacy-migrate-attempted.' + p.id + '.session'); } catch {}
            prToast(`✔ Объединено: перенесено ${moved} ключей в подпроект «${dest.name || 'СКС'}»${createdSub ? ' (создан)' : ''}`);
            render();
          } catch (e) {
            console.error('[project.js] merge-legacy-scs failed:', e);
            prToast('Ошибка объединения: ' + (e.message || e), 'error');
          }
        });
      }
    } catch (e) { console.warn('[project.js] legacy scs-design check failed', e); }

    // v0.59.377/379: стойки в этом проекте.
    // — экземпляры (физические стойки) — raschet.project.<p.id>.rack-config.instances.v1
    //   (см. shared/rack-storage.js — instancesKey()).
    // — также учитываем legacy: rackId, под которыми есть contents/rackTags
    //   (это данные размещения и тегов; инстансы могли быть удалены, а содержимое осталось).
    try {
      const instRaw    = localStorage.getItem(`raschet.project.${p.id}.rack-config.instances.v1`);
      const rcContents = localStorage.getItem(`raschet.project.${p.id}.scs-config.contents.v1`);
      const rcTags     = localStorage.getItem(`raschet.project.${p.id}.scs-config.rackTags.v1`);
      let nInstances = 0;
      try { const arr = instRaw ? JSON.parse(instRaw) : []; nInstances = Array.isArray(arr) ? arr.length : 0; } catch {}
      const orphanIds = new Set();
      try { const o = rcContents ? JSON.parse(rcContents) : {}; Object.keys(o || {}).forEach(k => { if (Array.isArray(o[k]) && o[k].length) orphanIds.add(k); }); } catch {}
      try { const o = rcTags ? JSON.parse(rcTags) : {}; Object.keys(o || {}).forEach(k => { if ((o[k] || '').trim()) orphanIds.add(k); }); } catch {}
      const total = Math.max(nInstances, orphanIds.size);
      if (total > 0) {
        const meta = nInstances > 0
          ? `${nInstances} физических стоек`
          : `${orphanIds.size} стоек (только размещение/теги — экземпляры отсутствуют, проверьте миграцию)`;
        const href = '../scs-config/?project=' + encodeURIComponent(p.id) + '&from=projects';
        const rowHtml = `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
          <span style="font-size:16px">🗄</span>
          <span style="background:#7c3aed;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">в проекте</span>
          <span style="flex:1;min-width:0">Шкафы проекта <span class="muted" style="font-size:11px">· ${esc(meta)}</span></span>
          <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px;text-decoration:none">Открыть →</a>
        </div>`;
        _enrichGroup('scs-config', rowHtml, 1);
      }
    } catch (e) { console.warn('[project.js] legacy scs-config check failed', e); }
  }

  if (actionsHost) {
    actionsHost.innerHTML = `
      <button type="button" class="pr-btn-sel" data-act="status">Статус: ${esc(st.label)} ▾</button>
      <button type="button" class="pr-btn-sel" data-act="rename">Переименовать</button>
      <button type="button" class="pr-btn-sel" data-act="describe">Изменить описание</button>
      <button type="button" class="pr-btn-sel" data-act="import-scheme" title="Скопировать текущую глобальную схему Конструктора в этот проект">⬇ Взять глобальную схему</button>
      <button type="button" class="pr-btn-sel" data-act="apply-scheme" title="Применить схему проекта к главному Конструктору (перезапишет глобальную схему!)">⬆ Применить в Конструкторе</button>
      <button type="button" class="pr-btn-sel" data-act="export">Экспорт JSON</button>
      <button type="button" class="pr-btn-sel" data-act="copy">📄 Копировать проект</button>
      <button type="button" class="pr-btn-sel" data-act="activate">Сделать активным</button>
      <button type="button" class="pr-btn-danger" data-act="delete" style="margin-left:auto">Удалить проект</button>
    `;
    actionsHost.querySelector('[data-act="status"]').addEventListener('click', async () => {
      const next = await prStatusPicker(p.status || 'draft');
      if (next == null || next === p.status) return;
      updateProject(p.id, { status: next });
      prToast('✔ Статус: ' + statusMeta(next).label);
      render();
    });
    actionsHost.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const name = await prPrompt('Переименовать проект', 'Новое имя', p.name || '');
      if (name == null) return;
      updateProject(p.id, { name });
      prToast('✔ Обновлено');
      render();
    });
    actionsHost.querySelector('[data-act="describe"]').addEventListener('click', async () => {
      const desc = await prPrompt('Описание проекта', 'Адрес, клиент, контакты и т.п.', p.description || '');
      if (desc == null) return;
      updateProject(p.id, { description: desc });
      prToast('✔ Описание обновлено');
      render();
    });
    actionsHost.querySelector('[data-act="import-scheme"]').addEventListener('click', async () => {
      const raw = localStorage.getItem('raschet.scheme');
      if (!raw) { prToast('⚠ Глобальная схема Конструктора пуста', 'err'); return; }
      const ok = await prConfirm(
        'Взять глобальную схему в проект?',
        'В этот проект скопируется текущее содержимое главного Конструктора схем. Существующая схема проекта (если есть) будет перезаписана.'
      );
      if (!ok) return;
      localStorage.setItem(`raschet.project.${p.id}.engine.scheme.v1`, raw);
      updateProject(p.id, {});
      prToast('✔ Схема скопирована в проект');
      render();
    });
    actionsHost.querySelector('[data-act="apply-scheme"]').addEventListener('click', async () => {
      const key = `raschet.project.${p.id}.engine.scheme.v1`;
      const raw = localStorage.getItem(key);
      if (!raw) { prToast('⚠ В проекте нет схемы. Сначала «⬇ Взять глобальную схему»', 'err'); return; }
      const ok = await prConfirm(
        'Применить схему проекта в Конструкторе?',
        'Текущая глобальная схема Конструктора будет ПЕРЕЗАПИСАНА схемой этого проекта. Действие необратимо без backup.'
      );
      if (!ok) return;
      localStorage.setItem('raschet.scheme', raw);
      prToast('✔ Схема применена. Откройте Конструктор схем для проверки.');
    });
    actionsHost.querySelector('[data-act="export"]').addEventListener('click', () => {
      const blob = exportProject(p.id);
      if (!blob) { prToast('⚠ Проект не найден', 'err'); return; }
      const safe = (p.name || p.id).replace(/[^\w\-]+/g, '_').slice(0, 40);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      a.download = `project-${safe}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      prToast('✔ JSON сохранён');
    });
    actionsHost.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      const ok = await prConfirm(
        `Создать копию проекта «${p.name}»?`,
        'Скопируются метаданные и все scoped-данные.'
      );
      if (!ok) return;
      const copy = copyProject(p.id);
      if (!copy) { prToast('⚠ Копирование не удалось', 'err'); return; }
      prToast(`✔ Создана копия «${copy.name}»`);
      // Перейти к карточке копии.
      location.href = 'project.html?project=' + encodeURIComponent(copy.id);
    });
    actionsHost.querySelector('[data-act="activate"]').addEventListener('click', () => {
      setActiveProjectId(p.id);
      prToast('✔ Проект сделан активным');
      render();
    });
    actionsHost.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      const ok = await prConfirm(
        `Удалить проект «${p.name}»?`,
        'Удалятся метаданные и все scoped-данные (raschet.project.' + p.id + '.*). Действие необратимо.'
      );
      if (!ok) return;
      const { removedKeys } = deleteProject(p.id);
      prToast(`✔ Удалено${removedKeys ? ' (стёрто ' + removedKeys + ' ключей LS)' : ''}`);
      // Возврат к списку.
      setTimeout(() => { location.href = './'; }, 700);
    });
  }

  if (metaHost) {
    metaHost.innerHTML = `
      <table class="pr-meta-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <tbody>
          <tr><td style="padding:6px 10px;color:#64748b;width:160px">ID</td><td style="padding:6px 10px"><code>${esc(p.id)}</code></td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Создан</td><td style="padding:6px 10px">${fmtDate(p.createdAt)}</td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Изменён</td><td style="padding:6px 10px">${fmtDate(p.updatedAt)}</td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Тип</td><td style="padding:6px 10px">${p.kind === 'sketch' ? '🧪 Мини-проект' : '🏢 Полноценный проект'}</td></tr>
          ${p.ownerModule ? `<tr><td style="padding:6px 10px;color:#64748b">Создан в модуле</td><td style="padding:6px 10px">${esc(p.ownerModule)}</td></tr>` : ''}
        </tbody>
      </table>`;
  }
}

function badgeChip(icon, n, label, bg, fg) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${fg};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${icon} ${n} <span style="opacity:.8;font-weight:400">${label}</span></span>`;
}

/* ---------- init ---------- */
// v0.59.527: инициализация на module-load (НЕ ждём DOMContentLoaded —
// type="module" скрипты выполняются после парсинга DOM, событие могло
// уже сработать или вот-вот сработает; addEventListener поздно). Auth.init
// вызывается сразу; render() — после DOMContentLoaded или сразу если он
// уже прошёл.
console.info('[project.js] module loaded, document.readyState=', document.readyState);
try {
  if (window.Auth && typeof window.Auth.init === 'function') {
    console.info('[project.js] calling window.Auth.init()');
    window.Auth.init();
  } else {
    console.warn('[project.js] window.Auth not available at module load');
  }
} catch (e) { console.warn('[project.js] Auth.init failed:', e); }

function _initAfterDom() {
  console.info('[project.js] _initAfterDom run');
  // Синхронизируем активный проект — чтобы старые модули, читающие
  // getActiveProjectId(), видели тот же контекст.
  const pid = getPid();
  if (pid && getProject(pid)) setActiveProjectId(pid);

  // v0.60.10 (Phase 22.13): получаем payload из embed-вызова Метеоданных
  // (через ?navResult=<sid>). Если пришёл — записываем lat/lon/locationName
  // в project.location.
  (async () => {
    try {
      const nav = await import('../shared/module-nav.js');
      const result = nav.readEmbedResult();
      if (result && pid && Number.isFinite(result.lat) && Number.isFinite(result.lon)) {
        const proj = getProject(pid);
        if (proj) {
          const loc = {
            ...(proj.location || {}),
            lat: result.lat,
            lon: result.lon,
            city: result.locationName || proj.location?.city || '',
          };
          updateProject(pid, { location: loc });
          prToast(`✔ Локация принята из Метеоданных: ${loc.city || `${result.lat}, ${result.lon}`}`);
          render();
        }
      }
    } catch (e) { console.warn('[project.js] readEmbedResult failed:', e); }
  })();

  render();

  // Re-render когда Auth state resolved — иначе сначала рендер в local
  // mode, потом cloud Storage появится но render не повторится.
  try {
    if (window.Auth && typeof window.Auth.onAuthChange === 'function') {
      window.Auth.onAuthChange(() => {
        console.info('[project.js] onAuthChange → re-render');
        try { render(); } catch (e) { console.warn('[project.js] re-render on auth-change failed:', e); }
      });
    }
  } catch {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAfterDom);
} else {
  // DOM уже готов — запускаем сразу (type="module" deferred + page parsed).
  _initAfterDom();
}
