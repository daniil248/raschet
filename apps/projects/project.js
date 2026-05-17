// projects/project.js — детальная карточка одного проекта.
// v0.59.344+: отдельный экран с курируемым набором модулей. Запускается
// по ссылке project.html?project=<pid> с /projects/. Все ссылки на модули
// несут ?project=<pid>&from=projects (вернёт пользователя именно сюда).

import {
  listProjects, getProject, updateProject, deleteProject, copyProject,
  setActiveProjectId, getActiveProjectId, exportProject,
  // v0.59.373: подпроекты — артефакты внутри родителя (схемы, СКС, шкафы).
  listSubProjects, createSubProject,
  // v0.59.862: hide-when-empty — для определения «есть ли данные модуля».
  projectKey,
  // Фаза 2 (R2): чтение/запись чужих module-scoped данных через шов
  // (projectLoad/projectSave — централизовано, типобезоп., bump updatedAt).
  projectLoad,
  projectSave,
  // Фаза 2: список sketch'ей через шов, не сырым литералом.
  loadSketchList,
} from 'shared/project-storage.js';
import { buildModuleHref, clearNavStack } from 'shared/project-context.js';
import {
  DEFAULT_COMPANY, loadRawProfile, saveProjectCompanyProfile, loadEffectiveCompanyProfile,
  onCompanyProfileChange,
} from 'shared/company-profile.js';
// v0.60.142: «📋 Действующие нормативы» badges под местоположением проекта.
// Visible reference какие стандарты будут применены в каждом расчётном модуле.
import { NORM_MATRIX, detectCountryCode, countryLabel } from 'shared/auto-norm.js';
// X.4.2 (v0.60.580): членство узлов схемы в дисциплинах + расчётный
// роутинг. Размещено в проектном cross-discipline view (НЕ в Конструкторе
// — он остаётся чистой электрикой, решение v0.60.277/278). Использует
// контракт-реестр shared/disciplines.js (давно развёрнут — static import
// cache-safe). projects читает/пишет engine-scheme через projectKey
// (санкционированный helper, не сырой LS): read-modify-write, трогаем
// только node.disciplines, остальное сохраняем байт-в-байт.
import {
  listDisciplines, nodeDisciplines, getDiscipline, DEFAULT_DISCIPLINE,
  calcLibSpecifier,
} from 'shared/disciplines.js';
// X.4.4-producer B2 (v0.60.583): сводный мультидисциплинарный отчёт
// строго через reports-пайплайн (memory: reports-only-via-reports) —
// cross-discipline.js собирает blocks[], shared/report рисует/экспортит.
// Оба модуля давно развёрнуты (cross-discipline.js v0.60.579) → static
// import cache-safe. Отчёт — через общий конвейер shared/report/
// compose.js (composeReport), грузится лениво при экспорте.
import { buildCrossDisciplineReport } from 'shared/report/cross-discipline.js';
// v0.60.171 (Phase 3.5): «🔗 Sketch'и проекта и их связи» — обзорный раздел
// в карточке проекта. Перечисляет все sketch'и + entity, на которые они
// ссылаются. resolveLabel — actual-label из исходного модуля (если
// переименовали — обновляется). buildOpenUrl — переход в исходный модуль.
import {
  loadRefs, getRefType, resolveLabel, buildOpenUrl, buildSketchOpenUrl,
} from 'shared/sketch-refs.js';

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

// v0.60.142: visible reference того, какие нормативы будут применены в
// расчётных модулях согласно country проекта. Helper-метки для каждого
// domain в NORM_MATRIX. Применяется как чек-лист для аудита и для
// объяснения Пользователю «почему именно эти стандарты».
const NORM_DOMAIN_LABELS = {
  suppression: '🔥 АГПТ',
  cable:       '🔌 Кабель',
  scs:         '🌐 СКС',
  cooling:     '❄ Климат',
  panel:       '⚡ НКУ',
  mv:          '⚡ РУ СН',
  battery:     '🔋 АКБ',
  dgu:         '⚡ ДГУ',
};
// Человекочитаемые названия для norm-id из auto-norm.js NORM_MATRIX.
const NORM_LABELS = {
  'sp-rk-2022':     'СП РК 2.02-102-2022',
  'sp-485-annex-d': 'СП 485 Прил. Д',
  'nfpa-2001':      'NFPA 2001',
  'iso-14520':      'ISO 14520',
  'iec-60364':      'IEC 60364',
  'pue-7':          'ПУЭ-7 / СП 76',
  'nec':            'NEC (NFPA 70)',
  'iso-24764':      'ISO/IEC 24764',
  'gost-r-53246':   'ГОСТ Р 53246',
  'tia-942':        'TIA-942-C',
  'sp-60':          'СП 60.13330',
  'ashrae-tc99':    'ASHRAE TC 9.9',
  'en-12831':       'EN 12831',
  'iec-61439':      'IEC 61439',
  'ul-891':         'UL 891 / UL 67',
  'iec-62271':      'IEC 62271',
  'ieee-c37':       'IEEE C37.20',
  'iec-62485':      'IEC 62485',
  'gost-iec-62485': 'ГОСТ IEC 62485',
  'ieee-1187':      'IEEE 1187',
  'iso-8528':       'ISO 8528-1',
  'epa-tier4':      'EPA Tier 4 / NFPA 110',
};
function _renderNormBadgesForCountry(country) {
  if (!country) return '';
  const code = detectCountryCode(country);
  if (!code) return '';
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[m]));
  // Собираем nrom для каждого domain — только те, где есть запись для country.
  const items = [];
  for (const [domain, label] of Object.entries(NORM_DOMAIN_LABELS)) {
    const map = NORM_MATRIX[domain];
    if (!map) continue;
    const normId = map[code];
    if (!normId) continue;
    const normLabel = NORM_LABELS[normId] || normId;
    items.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:10px;font-size:11px;white-space:nowrap" title="${esc(domain)} — авто-выбор по стране проекта">${esc(label)}: <b>${esc(normLabel)}</b></span>`);
  }
  if (!items.length) return '';
  return `
    <div style="margin-top:10px;padding:8px 10px;background:#f0f9ff;border:1px dashed #bae6fd;border-radius:4px">
      <div style="font-size:11.5px;color:#075985;font-weight:600;margin-bottom:6px" title="Какие нормативные документы будут применены в расчётных модулях согласно стране проекта (${esc(countryLabel(code))}). Override на уровне модуля разрешён.">📋 Действующие нормативы по стране проекта (${esc(countryLabel(code))})</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${items.join('')}</div>
      <p class="muted" style="font-size:10.5px;margin:6px 0 0;color:#475569">Override в каждом модуле через локальный dropdown «Методика». Изменение страны → изменение всех нормативов.</p>
    </div>
  `;
}

// v0.60.171 (Phase 3.5 follow-up): обзор всех sketch'ей проекта и их связей.
// Вместо чипа возле каждого entity (3.5.1-3.5.4) — единая страница в карточке
// проекта: «sketch X ссылается на: [стойка R-12] [НКУ A-1] [главную схему]».
// Группировка по sketch'у. Click на ссылку → открывает исходный модуль.
function renderProjectSketchRefs(p, host) {
  const pid = p.id;
  const sketchList = loadSketchList(pid);

  if (!sketchList.length) {
    host.innerHTML = `
      <div class="pr-empty" style="padding:14px;color:#64748b;font-size:13px">
        В этом проекте пока нет sketch'ей.
        <a href="../sketch/?project=${esc(pid)}" target="_blank" style="color:#1e40af;font-weight:500">Открыть модуль Скетч ↗</a>
      </div>`;
    return;
  }

  // Собираем для каждого sketch'a его refs
  const sketchData = sketchList.map(sk => {
    const refs = loadRefs(pid, sk.id);
    return { sketch: sk, refs };
  });

  // Total stats
  const totalRefs = sketchData.reduce((sum, s) => sum + s.refs.length, 0);

  let html = `
    <div style="margin-bottom:10px;font-size:12px;color:#64748b">
      ${sketchList.length} sketch${sketchList.length === 1 ? '' : 'ей'} ·
      ${totalRefs} связ${totalRefs === 1 ? 'ь' : (totalRefs >= 2 && totalRefs <= 4 ? 'и' : 'ей')} с данными модулей ·
      <a href="../sketch/?project=${esc(pid)}" target="_blank" style="color:#1e40af;font-weight:500">Открыть модуль Скетч ↗</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">`;

  for (const { sketch, refs } of sketchData) {
    const sketchUrl = buildSketchOpenUrl(sketch.id, pid);
    html += `
      <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;background:#f8fafc">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${refs.length ? '8px' : '0'}">
          <span style="font-size:14px">✏</span>
          <a href="${esc(sketchUrl)}" target="_blank"
             style="font-weight:600;color:#0f172a;text-decoration:none;flex:1;font-size:13.5px"
             title="Открыть sketch в новой вкладке">${esc(sketch.name || sketch.id)}</a>
          ${refs.length === 0
            ? '<span style="color:#94a3b8;font-size:11px;font-style:italic">нет связей</span>'
            : `<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">📎 ${refs.length}</span>`}
        </div>`;
    if (refs.length) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
      for (const ref of refs) {
        const t = getRefType(ref.refType);
        const liveLabel = (() => {
          try { return resolveLabel(ref.refType, ref.refId, pid) || ref.label; }
          catch { return ref.label; }
        })();
        const stale = liveLabel === '(удалён)' || liveLabel === '(удалена)';
        const url = buildOpenUrl(ref, pid);
        const fill = t ? t.fill : '#f1f5f9';
        const color = t ? t.color : '#475569';
        const icon = t ? t.icon : '?';
        html += `
          <a href="${esc(url || '#')}" target="_blank"
             style="display:inline-flex;align-items:center;gap:5px;
                    padding:3px 10px;border-radius:12px;
                    background:${fill};color:${color};
                    text-decoration:none;font-size:11.5px;font-weight:500;
                    border:1px solid ${color};${stale ? 'opacity:0.6;text-decoration:line-through' : ''}"
             title="${esc(t ? t.label : ref.refType)}: ${esc(liveLabel)}${ref.note ? ' — ' + esc(ref.note) : ''}${stale ? ' (объект удалён в источнике)' : ''}">
            <span>${icon}</span>
            <span>${esc(liveLabel)}</span>
            ${stale ? '<span style="color:#b45309">⚠</span>' : ''}
          </a>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  host.innerHTML = html;
}

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
      <label title="Уточнение / описание типа (например «МЦОД-50», «Серверная Stage 2», «Корпус B»). Свободный текст. Используется в отчётах для контекста.">
        <span style="font-size:11.5px;color:#475569;display:block">Тип (уточнение):</span>
        <input type="text" data-req="objectType" value="${esc(r.objectType || '')}" placeholder="напр. МЦОД-50, Корпус B" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px">
      </label>
    </div>
    <!-- v0.60.284: objectKind — enum-selector (категория объекта). Определяет
         шаблон Технолога объекта (какие разделы активны). Project-bound.
         Хранится в project.objectKind (не в requisites — это структурное поле). -->
    <div style="margin:0 0 14px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px">
      <label title="Категория объекта (enum) — определяет шаблон активных разделов в «Технологе объекта». Свободное описание типа — поле «Тип (уточнение)» выше.">
        <span style="font-size:11.5px;color:#075985;font-weight:600;display:block;margin-bottom:4px">🏷 Категория объекта (тип):</span>
        <select data-prop="objectKind" style="width:100%;padding:6px 8px;border:1px solid #0ea5e9;border-radius:3px;font:inherit;background:#fff">
          <option value="datacenter"${(p.objectKind || 'datacenter') === 'datacenter' ? ' selected' : ''}>🏢 ЦОД (Дата-центр)</option>
          <option value="factory"${p.objectKind === 'factory' ? ' selected' : ''}>🏭 Завод (производство)</option>
          <option value="pump-station"${p.objectKind === 'pump-station' ? ' selected' : ''}>💧 Насосная станция</option>
          <option value="office"${p.objectKind === 'office' ? ' selected' : ''}>🏢 Офис</option>
          <option value="custom"${p.objectKind === 'custom' ? ' selected' : ''}>✏ Свой шаблон</option>
        </select>
      </label>
      <p class="muted" style="font-size:11px;margin:6px 0 0;color:#475569">
        Полноценно работает <b>«🏢 ЦОД»</b>. Для остальных категорий разделы Технолога объекта пока показывают warning «в разработке (Phase 47.1.4)».
      </p>
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
      <!-- v0.60.450: параметры площадки для дерейтинга — единый источник для
           подборов (ИБП/АКБ/…). data-loc → автосейв в project.location. -->
      <div style="margin-top:10px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px">
        <div style="font-size:11.5px;color:#075985;font-weight:600;text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px" title="Высота над уровнем моря и максимальная температура среды — для дерейтинга оборудования. Передаются в подборы (ИБП/АКБ) как условия из проекта.">🏔 Параметры площадки (дерейтинг)</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="font-size:12px;color:#475569;display:flex;flex-direction:column;gap:3px" title="Высота над уровнем моря места установки. Выше 1000 м — дерейтинг мощности ИБП (IEC 62040-3, ≈ −1%/100 м). Передаётся в подбор как условие «из проекта».">Высота установки, м
            <input type="number" step="50" data-loc="elevationM" value="${loc.elevationM ?? ''}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px;width:130px">
          </label>
          <label style="font-size:12px;color:#475569;display:flex;flex-direction:column;gap:3px" title="Максимальная температура воздуха в помещении/на площадке. Выше +25…+30 °C — температурный дерейтинг (мощность/ресурс АКБ). Передаётся в подбор как условие «из проекта».">Макс. темп. среды, °C
            <input type="number" step="1" data-loc="ambientMaxC" value="${loc.ambientMaxC ?? ''}" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px;width:130px">
          </label>
        </div>
      </div>
      ${_renderNormBadgesForCountry(loc.country)}
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
    ${renderCompanyOverrideSection(p)}
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
  // v0.60.284: data-prop для project-level полей (objectKind и т.п.).
  host.querySelectorAll('[data-prop]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.prop;
      const val = inp.value;
      updateProject(p.id, { [field]: val });
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
        const nav = await import('shared/module-nav.js');
        nav.openEmbed(location.pathname + location.search, '../meteo/', `Свойства проекта «${p.name}»`);
      } catch (e) { prToast('Ошибка: ' + e.message, 'error'); }
    });
  }

  // v0.60.10: «🗺 Выбрать на карте» — Leaflet/OpenStreetMap picker
  const pickMapBtn = host.querySelector('#pr-pick-map');
  if (pickMapBtn) {
    pickMapBtn.addEventListener('click', () => openMapPicker(p));
  }

  // v0.60.30: company-profile override (Phase 24.5)
  wireCompanyOverrideSection(p, host);
}

/* v0.60.30 (Phase 24.5): рендер секции «Реквизиты компании-исполнителя
   (override для этого проекта)». Если override выключен — берутся
   глобальные реквизиты (шестерёнка ⚙ → Реквизиты организации).
   Если включён — здесь свои значения для этого проекта (например,
   другое юр.лицо для конкретного клиента). */
function renderCompanyOverrideSection(p) {
  const profile = loadRawProfile(p.id);
  const overrideEnabled = profile.overrideEnabled === true;
  const f = (id, label, value, opts = {}) => `
    <label class="pr-cf-field" title="${esc(opts.tip || '')}">
      <span style="font-size:11.5px;color:#475569;display:block">${esc(label)}</span>
      <input type="${opts.type || 'text'}" data-cf="${id}" value="${esc(value || '')}" placeholder="${esc(opts.placeholder || '')}" ${overrideEnabled ? '' : 'disabled'} style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px${overrideEnabled ? '' : ';background:#f8fafc;color:#94a3b8;cursor:not-allowed'}">
    </label>
  `;
  const effective = loadEffectiveCompanyProfile(p.id);
  const isFallback = !overrideEnabled;
  // v0.60.100: если override выключен — скрываем блок полей ввода целиком
  // (раньше показывали disabled-серыми, но Пользователь попросил не выводить вовсе).
  const fieldsBlock = overrideEnabled ? `
    <div class="pr-cf-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 12px">
      ${f('name', 'Название организации', profile.name, { placeholder: 'ТОО «...» / ООО «...»', tip: 'Полное наименование юр.лица.' })}
      ${f('address', 'Юридический адрес', profile.address, { placeholder: '050000, г. Алматы, ул. ...', tip: 'Адрес для шапки документов.' })}
      ${f('phone', 'Телефон', profile.phone, { placeholder: '+7 (...)', tip: 'Контактный телефон.' })}
      ${f('email', 'Email', profile.email, { type: 'email', placeholder: 'info@company.kz', tip: 'Email для деловой переписки.' })}
      ${f('website', 'Сайт', profile.website, { placeholder: 'https://company.kz', tip: 'Корпоративный сайт.' })}
      ${f('bin', 'БИН / ИНН', profile.bin, { placeholder: '12 цифр', tip: 'БИН (KZ) или ИНН (RU).' })}
      ${f('director', 'Руководитель', profile.director, { placeholder: 'Иванов И.И.', tip: 'ФИО для подписей в КП.' })}
    </div>
    <label class="pr-cf-field" style="display:block;margin-top:8px" title="Банковские реквизиты для счёт-фактуры.">
      <span style="font-size:11.5px;color:#475569;display:block">Банковские реквизиты</span>
      <textarea data-cf="bankRequisites" rows="3" placeholder="АО «Банк» БИК ... ИИК ..." style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;resize:vertical">${esc(profile.bankRequisites || '')}</textarea>
    </label>
    <p class="muted" style="font-size:11px;margin-top:6px">
      💡 Эффективный профиль для проекта: <b>${esc(effective.name || '(не заполнено)')} (project override)</b>
    </p>
  ` : '';
  return `
    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:14px 0">
    <h4 style="margin:0 0 8px;font-size:12.5px;color:#075985;text-transform:uppercase;letter-spacing:0.4px" title="Реквизиты компании-исполнителя для шапки КП и договоров. По умолчанию используются глобальные (⚙ → Реквизиты организации). Можно переопределить для этого проекта.">🏢 Реквизиты компании-исполнителя</h4>
    <div class="pr-cf-banner" style="padding:8px 12px;background:${overrideEnabled ? '#dbeafe' : '#fef3c7'};border:1px solid ${overrideEnabled ? '#93c5fd' : '#fcd34d'};border-radius:4px;margin-bottom:10px;font-size:12px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pr-cf-override" ${overrideEnabled ? 'checked' : ''}>
        <b>Использовать особые реквизиты для этого проекта</b>
      </label>
      <p class="muted" style="font-size:11px;margin:4px 0 0">
        ${overrideEnabled
          ? '✏ Override включён — заполните поля ниже. Эти значения будут использоваться в КП клиенту для ЭТОГО проекта.'
          : `📋 Используются глобальные реквизиты: <b>${esc(effective.name || '(не заполнены — заполните в ⚙ → Реквизиты организации)')}</b>.`}
      </p>
    </div>
    ${fieldsBlock}
  `;
}

function wireCompanyOverrideSection(p, host) {
  const overrideChk = host.querySelector('#pr-cf-override');
  if (overrideChk) {
    overrideChk.addEventListener('change', () => {
      const cur = loadRawProfile(p.id);
      cur.overrideEnabled = overrideChk.checked;
      saveProjectCompanyProfile(p.id, cur);
      // Re-render чтобы обновить disabled state и баннер
      const propsHost = document.getElementById('pr-detail-properties');
      if (propsHost) renderProjectProperties(p, propsHost);
      prToast(overrideChk.checked
        ? 'Project-override включён. Заполните поля ниже.'
        : 'Project-override выключен. Используются глобальные реквизиты.');
    });
  }
  host.querySelectorAll('[data-cf]').forEach(inp => {
    inp.addEventListener('change', () => {
      const cur = loadRawProfile(p.id);
      cur[inp.dataset.cf] = inp.value;
      saveProjectCompanyProfile(p.id, cur);
    });
  });
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
    href: '../../index.html',
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
  {
    // v0.60.44: Service module — добавлен в карточку проекта по требованию
    id: 'service',
    href: '../service/',
    icon: '🛠',
    label: 'Сервис: монтаж и ТО',
    desc: 'Расчёт стоимости монтажа и техобслуживания: себестоимость + клиент-цена с маржой и НДС. Импорт работ из cooling-подборов проекта (1 клик). Per-cell валюты. Каталог типовых работ. Экспорт КП клиенту с настраиваемым шаблоном.',
    color: '#ea580c',
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

// v0.60.94 (Phase 39): Lifecycle states по ISO 15288 / PLM. 8 состояний от
// концепции до вывода из эксплуатации. Дополняет существующий p.status
// (5 базовых) более детальной классификацией.
const LCM_STATES = [
  { id: 'concept',      label: 'Концепция',          icon: '💡', color: '#7c3aed', bg: '#ede9fe', desc: 'Идея, первичные требования. TW concept-вариант.' },
  { id: 'sketch',       label: 'Эскиз / П',          icon: '✏', color: '#0369a1', bg: '#dbeafe', desc: 'Концепция готова, оформление по ГОСТ Р 21.501.' },
  { id: 'working',      label: 'Рабочая (РД)',       icon: '📐', color: '#1d4ed8', bg: '#dbeafe', desc: 'Детальное проектирование. Схемы / СКС / BOM.' },
  { id: 'construction', label: 'Монтаж',             icon: '🔨', color: '#b45309', bg: '#fef3c7', desc: 'Выполнение работ на объекте. Service install-наряды.' },
  { id: 'commissioning',label: 'ПНР',                icon: '⚙', color: '#92400e', bg: '#fed7aa', desc: 'Пусконаладочные работы. Тесты, испытания.' },
  { id: 'operation',    label: 'Эксплуатация',       icon: '✅', color: '#047857', bg: '#d1fae5', desc: 'Рабочий режим. Asset registry + maintenance schedule.' },
  { id: 'upgrade',      label: 'Модернизация',       icon: '🔄', color: '#0891b2', bg: '#cffafe', desc: 'Обновление систем. Revision sketch на основе as-built.' },
  { id: 'decommission', label: 'Decommission',       icon: '🛑', color: '#991b1b', bg: '#fee2e2', desc: 'Вывод из эксплуатации. Документация утилизации.' },
];
function lcmStateMeta(id) {
  return LCM_STATES.find(s => s.id === id) || LCM_STATES[0];
}
function _deriveLcmFromStatus(status) {
  // Backward-compat mapping существующего status → LCM state.
  const map = {
    'draft':     'concept',
    'planned':   'working',
    'installed': 'commissioning',
    'operating': 'operation',
    'archived':  'decommission',
  };
  return map[status || 'draft'] || 'concept';
}

// v0.60.98 (Пользователь 2026-05-03 «курс наверное вынести с датой курса.
// А тариф на электроэнергию синхронизировать или объединить для всего
// проекта»): экономика на уровне проекта — единый источник для всех модулей.
// Раньше cooling/service имели свои tariff/currency/ratesDate — теперь
// читают из project.economics при работе с проектом.
const PROJECT_CURRENCIES = [
  { code: '₽',   iso: 'RUB', label: 'RUB · российский рубль' },
  { code: '$',   iso: 'USD', label: 'USD · доллар США' },
  { code: '€',   iso: 'EUR', label: 'EUR · евро' },
  { code: '₸',   iso: 'KZT', label: 'KZT · тенге' },
  { code: '¥',   iso: 'CNY', label: 'CNY · юань' },
  { code: '£',   iso: 'GBP', label: 'GBP · фунт' },
  { code: 'Br',  iso: 'BYN', label: 'BYN · бел. рубль' },
  { code: '₺',   iso: 'TRY', label: 'TRY · лира' },
  { code: '₴',   iso: 'UAH', label: 'UAH · гривна' },
  { code: 'CHF', iso: 'CHF', label: 'CHF · франк' },
];
// v0.60.112: пресеты НДС по месту поставки. По репорту Пользователя
// 2026-05-04: «НДС должен быть настраиваемым и привязанным к проекту или
// месту поставки, нужно его учитывать в КП или нет. В РК с начала 2026
// года НДС 16%. но для КП за рубеж мы должны давать стоимость без НДС».
const VAT_PRESETS = [
  { id: 'kz-2026',    label: '🇰🇿 Казахстан 2026+ (16%)',   pct: 16, enabled: true,  jurisdiction: 'KZ' },
  { id: 'kz-pre2026', label: '🇰🇿 Казахстан до 2026 (12%)', pct: 12, enabled: true,  jurisdiction: 'KZ' },
  { id: 'ru',         label: '🇷🇺 Россия (20%)',            pct: 20, enabled: true,  jurisdiction: 'RU' },
  { id: 'by',         label: '🇧🇾 Беларусь (20%)',          pct: 20, enabled: true,  jurisdiction: 'BY' },
  { id: 'export',     label: '🌍 Экспорт (без НДС)',         pct: 0,  enabled: false, jurisdiction: 'export' },
  { id: 'custom',     label: '⚙ Пользовательский',           pct: 0,  enabled: true,  jurisdiction: 'custom' },
];
function _detectVatPreset(vat) {
  if (!vat || !vat.enabled) return 'export';
  const found = VAT_PRESETS.find(p => p.enabled && p.pct === Number(vat.pct) && p.id !== 'custom');
  return found ? found.id : 'custom';
}

function renderProjectEconomics(p, host) {
  const e = p.economics || {};
  const today = new Date().toISOString().slice(0, 10);
  const tariff = e.tariffPerKwh != null ? e.tariffPerKwh : 7.5;
  const tariffCurrency = e.tariffCurrency || '₽';
  const displayCurrency = e.displayCurrency || '₽';
  const ratesDate = e.ratesDate || today;
  // v0.60.112: НДС — настраиваемый, default = KZ 2026 (16%, enabled).
  // Если у проекта vat не задан — берём KZ-2026 как разумный дефолт для
  // существующих проектов (старые с vatPct=12 у нарядов будут продолжать
  // работать через order-level override).
  const vat = e.vat || { pct: 16, enabled: true, label: 'НДС' };
  const vatPreset = _detectVatPreset(vat);
  host.innerHTML = `
    <p class="muted" style="font-size:11.5px;margin:0 0 10px">Эти параметры применяются ко всем calc-модулям проекта (cooling, service, tech-workspace, genset-config). Изменение здесь — единая точка обновления.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px">
      <label title="Валюта проекта — в ней отображаются и считаются все CAPEX/OPEX/TCO. Если оборудование закуплено в другой валюте — будет конвертация по курсу на «Дата курса».">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">Валюта проекта:</span>
        <select id="pr-eco-disp-cur" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
          ${PROJECT_CURRENCIES.map(c => `<option value="${esc(c.code)}"${c.code === displayCurrency ? ' selected' : ''} title="${esc(c.label)}">${esc(c.code)} — ${esc(c.label)}</option>`).join('')}
        </select>
      </label>
      <label title="Тариф на электроэнергию (за кВт·ч) — используется в OPEX-расчёте cooling и других модулей. Можно ввести в любой валюте — для расчётов будет авто-пересчитан в валюту проекта по курсу.">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">Тариф на эл-во (/кВт·ч):</span>
        <span style="display:flex;gap:4px">
          <input type="number" id="pr-eco-tariff" min="0" step="0.001" value="${tariff}" style="flex:1;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
          <select id="pr-eco-tariff-cur" style="padding:5px 6px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;min-width:60px">
            ${PROJECT_CURRENCIES.map(c => `<option value="${esc(c.code)}"${c.code === tariffCurrency ? ' selected' : ''}>${esc(c.code)}</option>`).join('')}
          </select>
        </span>
      </label>
      <label title="Дата на которую брать курсы валют. Применяется ко ВСЕМ конвертациям в проекте. Default = сегодня.">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">📅 Дата курса:</span>
        <input type="date" id="pr-eco-rates-date" value="${esc(ratesDate)}" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
      </label>
    </div>
    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:14px 0">
    <h4 style="margin:0 0 8px;font-size:12.5px;color:#075985;text-transform:uppercase;letter-spacing:0.4px" title="НДС / VAT — налог на добавленную стоимость. Привязан к месту поставки (юрисдикции). Для экспортных КП обычно ставится «Экспорт (без НДС)».">📊 НДС / налогообложение</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px">
      <label title="Пресет места поставки — автоматически проставляет ставку НДС и флаг включения в КП. Меняется в РК с 2026: 12% → 16%. Для экспортных КП — «Экспорт (без НДС)».">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">Юрисдикция / пресет:</span>
        <select id="pr-eco-vat-preset" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
          ${VAT_PRESETS.map(vp => `<option value="${esc(vp.id)}"${vp.id === vatPreset ? ' selected' : ''} title="Ставка ${vp.pct}%, включён: ${vp.enabled ? 'да' : 'нет'}">${esc(vp.label)}</option>`).join('')}
        </select>
      </label>
      <label title="Ставка НДС в %. При выборе пресета — заполняется автоматически. «Пользовательский» позволяет ввести любую ставку.">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">Ставка НДС, %:</span>
        <input type="number" id="pr-eco-vat-pct" min="0" max="50" step="0.5" value="${Number(vat.pct) || 0}" ${vatPreset !== 'custom' ? 'readonly style="background:#f8fafc;color:#64748b;cursor:not-allowed;width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px"' : 'style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px"'}>
      </label>
      <label title="Если включено — НДС выводится в шапке КП (отдельной строкой) и добавляется к итогу. Если выключено — клиент видит «Стоимость без НДС» и итог = чистая клиент-цена. Для экспортных КП — выключить.">
        <span style="font-size:11.5px;color:#475569;display:block;margin-bottom:3px">Учитывать в КП:</span>
        <label style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;cursor:pointer;font-size:13px">
          <input type="checkbox" id="pr-eco-vat-enabled"${vat.enabled ? ' checked' : ''}>
          <span>${vat.enabled ? '✓ Включён в итог' : '✗ Без НДС (экспорт)'}</span>
        </label>
      </label>
    </div>
    <p class="muted" style="font-size:11px;margin:8px 0 0">💡 При первом сохранении значения станут default для всех модулей проекта. Существующие cooling/service могут сохранять свои override-значения локально.</p>
  `;

  // Auto-save on change
  const dispCur = host.querySelector('#pr-eco-disp-cur');
  const tariffInp = host.querySelector('#pr-eco-tariff');
  const tariffCur = host.querySelector('#pr-eco-tariff-cur');
  const ratesInp = host.querySelector('#pr-eco-rates-date');
  const vatPresetSel = host.querySelector('#pr-eco-vat-preset');
  const vatPctInp = host.querySelector('#pr-eco-vat-pct');
  const vatEnabledChk = host.querySelector('#pr-eco-vat-enabled');
  function saveEconomics() {
    const presetId = vatPresetSel?.value || 'custom';
    const preset = VAT_PRESETS.find(vp => vp.id === presetId);
    const vatNext = (preset && preset.id !== 'custom')
      ? { pct: preset.pct, enabled: preset.enabled, jurisdiction: preset.jurisdiction, label: 'НДС' }
      : { pct: Number(vatPctInp?.value) || 0, enabled: !!vatEnabledChk?.checked, jurisdiction: 'custom', label: 'НДС' };
    const next = {
      displayCurrency: dispCur.value,
      tariffPerKwh: Number(tariffInp.value) || 0,
      tariffCurrency: tariffCur.value,
      ratesDate: ratesInp.value || today,
      vat: vatNext,
      updatedAt: Date.now(),
    };
    updateProject(p.id, { economics: next });
    prToast('💰 Экономика проекта обновлена', 'info');
  }
  if (dispCur) dispCur.addEventListener('change', saveEconomics);
  if (tariffInp) tariffInp.addEventListener('change', saveEconomics);
  if (tariffCur) tariffCur.addEventListener('change', saveEconomics);
  if (ratesInp) ratesInp.addEventListener('change', saveEconomics);
  // VAT controls: при смене пресета — re-render чтобы переключить readonly state.
  if (vatPresetSel) vatPresetSel.addEventListener('change', () => {
    const presetId = vatPresetSel.value;
    const preset = VAT_PRESETS.find(vp => vp.id === presetId);
    if (preset && preset.id !== 'custom') {
      // Сразу применяем пресет — pct/enabled из presetа.
      const next = {
        displayCurrency: dispCur.value,
        tariffPerKwh: Number(tariffInp.value) || 0,
        tariffCurrency: tariffCur.value,
        ratesDate: ratesInp.value || today,
        vat: { pct: preset.pct, enabled: preset.enabled, jurisdiction: preset.jurisdiction, label: 'НДС' },
        updatedAt: Date.now(),
      };
      updateProject(p.id, { economics: next });
    }
    renderProjectEconomics(p, host);  // re-render с новым preset / readonly
  });
  if (vatPctInp) vatPctInp.addEventListener('change', saveEconomics);
  if (vatEnabledChk) vatEnabledChk.addEventListener('change', saveEconomics);
}

// v0.60.97 (Phase 38.1 START): План-график задач проекта.
// Минимальная версия: список задач с CRUD. Gantt + critical path — TODO 38.3.
const PLAN_DISCIPLINES = [
  { id: 'concept',     label: '💡 Концепция',          color: '#7c3aed' },
  { id: 'electrical',  label: '⚡ Электрика',          color: '#1d4ed8' },
  { id: 'low-voltage', label: '🌐 Слаботочка / СКС',   color: '#0d9488' },
  { id: 'cooling',     label: '❄ Климат',              color: '#0891b2' },
  { id: 'fire-safety', label: '🔥 Безопасность',       color: '#b91c1c' },
  { id: 'mechanical',  label: '⚙ Механика',            color: '#92400e' },
  { id: 'arch',        label: '🏛 Архитектура',         color: '#475569' },
  { id: 'commissioning',label: '🔧 ПНР / monitoring',  color: '#047857' },
  { id: 'other',       label: '📋 Прочее',             color: '#64748b' },
];
const PLAN_STATUSES = [
  { id: 'todo',        label: '○ Не начата',  color: '#64748b' },
  { id: 'in-progress', label: '🔵 В работе',  color: '#1d4ed8' },
  { id: 'review',      label: '🟡 На проверке', color: '#b45309' },
  { id: 'done',        label: '✅ Завершено', color: '#15803d' },
  { id: 'blocked',     label: '🛑 Заблокирована', color: '#991b1b' },
];

// Фаза 2 (R2): план задач — собственный namespace модуля projects;
// доступ через шов (projectLoad/projectSave), не сырой LS.
function _loadPlanTasks(pid) {
  const arr = projectLoad(pid, 'plan', 'tasks.v1', []);
  return Array.isArray(arr) ? arr : [];
}
function _savePlanTasks(pid, tasks) {
  try { projectSave(pid, 'plan', 'tasks.v1', tasks); }
  catch (e) { console.warn('[plan] save failed:', e); }
}
function _newTaskId() { return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// v0.60.290 (Этап 1.4 Phase 47): этапы реализации проекта.
// По плану обсуждённой архитектуры 2026-05-06: «стандартный набор с
// возможностью добавлять этапы в любом месте». Этапы хранятся в
// project.implStages — массив, можно расставлять / переименовывать /
// удалять / вставлять между.
// v0.60.293 (по запросу Пользователя 2026-05-06: «мне нужно добавить
// производство. И сделать этот план настраиваемым»):
// Стандартный набор этапов расширен — добавлен «Производство» (заказ /
// изготовление оборудования) между РД и Монтажом. План полностью
// настраиваемый: rename / insert / delete / status-cycle уже есть с
// v0.60.290 (Этап 1.4); Этап 1.4-fix v0.60.293 — разрешает редактирование
// в local-mode (где role=guest) и для editor (не только owner).
const IMPL_STAGES_DEFAULT = [
  { id: 'concept', name: 'Концепция', icon: '💡', status: 'pending' },
  { id: 'sketch', name: 'Эскиз (П)', icon: '✏', status: 'pending' },
  { id: 'docs', name: 'РД (рабочая)', icon: '📐', status: 'pending' },
  { id: 'production', name: 'Производство', icon: '🏗', status: 'pending' },
  { id: 'install', name: 'Монтаж', icon: '🔧', status: 'pending' },
  { id: 'commissioning', name: 'ПНР', icon: '🚀', status: 'pending' },
  { id: 'operation', name: 'Эксплуатация', icon: '🏭', status: 'pending' },
];
const IMPL_STATUS_META = {
  pending: { label: 'не начат', icon: '⚪', color: '#94a3b8', bg: '#f1f5f9' },
  active:  { label: 'в работе', icon: '🔵', color: '#1d4ed8', bg: '#dbeafe' },
  done:    { label: 'завершён', icon: '✅', color: '#15803d', bg: '#dcfce7' },
  skipped: { label: 'пропущен', icon: '⊘', color: '#6b7280', bg: '#f3f4f6' },
};
function _newStageId() { return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

// v0.60.292 (Этап 1.5.1): helper для метаданных в Сводке.
function _summaryCard(icon, label, value, sub) {
  return `<div style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px">
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-bottom:3px">
      <span>${icon}</span><span>${label}</span>
    </div>
    <div style="font-size:13.5px;color:#0f172a;font-weight:600">${value}</div>
    ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}
function _getImplStages(p) {
  if (Array.isArray(p.implStages)) return p.implStages;
  // На первом обращении создаём дефолтный набор (не сохраняем сразу — только при изменении).
  return IMPL_STAGES_DEFAULT.map(s => ({ ...s, id: _newStageId() }));
}
function _saveImplStages(pid, stages) {
  try { updateProject(pid, { implStages: stages }); }
  catch (e) { console.warn('[stages] save failed:', e); }
}
function _renderImplStagesBlock(p) {
  const stages = _getImplStages(p);
  // v0.60.297 (по репорту Пользователя 2026-05-06: «сделай меня владельцем мне
  // нужно менять параметры»): getProject из shared/project-storage.js читает
  // local LS — это данные Пользователя, он ИХ владелец. Storage.isCloud
  // означает «Firebase авторизация активна», но не «этот проект — облачный».
  // Поэтому default 'owner' для всех LS-загруженных проектов. Cloud-only
  // role-checks применяются ТОЛЬКО для Firebase-операций (visibility, members).
  const role = p._role || 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  const ro = !canEdit;
  // Visual timeline: dots с горизонтальной линией.
  const dotsHtml = stages.map((s, idx) => {
    const meta = IMPL_STATUS_META[s.status] || IMPL_STATUS_META.pending;
    const isLast = idx === stages.length - 1;
    return `<div style="display:flex;align-items:center;flex:${isLast ? '0 0 auto' : '1 1 auto'}">
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:80px">
        <button type="button" data-stage-cycle="${esc(s.id)}" ${ro ? 'disabled' : ''}
                title="${esc(meta.label)}. ${ro ? '' : 'Клик — переключить статус (не начат → в работе → завершён → пропущен → не начат).'}"
                style="width:32px;height:32px;border-radius:50%;border:2px solid ${meta.color};background:${meta.bg};color:${meta.color};cursor:${ro ? 'default' : 'pointer'};font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">
          ${meta.icon}
        </button>
        <div style="font-size:11px;font-weight:600;color:#0f172a;text-align:center;line-height:1.3">${s.icon || ''} ${esc(s.name)}</div>
        <div style="font-size:10px;color:${meta.color}">${esc(meta.label)}</div>
        ${ro ? '' : `<div style="display:flex;gap:2px;margin-top:2px">
          <button type="button" data-stage-rename="${esc(s.id)}" title="Переименовать" style="font-size:10px;padding:1px 4px;background:#fff;border:1px solid #cbd5e1;border-radius:3px;cursor:pointer">✏</button>
          <button type="button" data-stage-insert-after="${esc(s.id)}" title="Вставить этап после" style="font-size:10px;padding:1px 4px;background:#fff;border:1px solid #cbd5e1;border-radius:3px;cursor:pointer">+</button>
          ${stages.length > 1 ? `<button type="button" data-stage-delete="${esc(s.id)}" title="Удалить этап" style="font-size:10px;padding:1px 4px;background:#fff;border:1px solid #fecaca;color:#b91c1c;border-radius:3px;cursor:pointer">×</button>` : ''}
        </div>`}
      </div>
      ${!isLast ? `<div style="flex:1;height:2px;background:${meta.color};opacity:0.4;min-width:20px"></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="pr-impl-stages" style="margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <h4 style="margin:0;font-size:14px;color:#0f172a">🎯 Этапы реализации</h4>
      <span class="muted" style="font-size:11px">${stages.filter(s => s.status === 'done').length} / ${stages.length} завершено</span>
      ${ro ? '' : `<button type="button" id="pr-stage-reset" title="Сбросить к стандартному набору этапов" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer">↺ дефолт</button>`}
    </div>
    <div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:8px 4px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
      ${dotsHtml}
    </div>
    ${ro ? '<p class="muted" style="font-size:11px;margin:6px 0 0">⚠ Только owner / editor проекта может менять этапы. Текущая роль: <b>' + esc(p._role || 'owner') + '</b>. Для редактирования откройте проект как владелец.</p>' : ''}
  </div>`;
}
function _wireImplStagesBlock(p, host) {
  const stages = _getImplStages(p);
  // Cycle status on dot click.
  host.querySelectorAll('[data-stage-cycle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-stage-cycle');
      const s = stages.find(x => x.id === id);
      if (!s) return;
      const order = ['pending', 'active', 'done', 'skipped'];
      const cur = s.status || 'pending';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      s.status = next;
      const now = Date.now();
      if (next === 'active' && !s.startedAt) s.startedAt = now;
      if (next === 'done' && !s.finishedAt) s.finishedAt = now;
      if (next === 'pending') { delete s.startedAt; delete s.finishedAt; }
      _saveImplStages(p.id, stages);
      render();
    });
  });
  host.querySelectorAll('[data-stage-rename]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-stage-rename');
      const s = stages.find(x => x.id === id);
      if (!s) return;
      const newName = await prPrompt('Новое название этапа:', s.name);
      if (!newName || newName === s.name) return;
      s.name = newName.trim();
      _saveImplStages(p.id, stages);
      render();
    });
  });
  host.querySelectorAll('[data-stage-insert-after]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-stage-insert-after');
      const idx = stages.findIndex(x => x.id === id);
      if (idx < 0) return;
      const newName = await prPrompt('Название нового этапа:', 'Новый этап');
      if (!newName) return;
      stages.splice(idx + 1, 0, { id: _newStageId(), name: newName.trim(), icon: '⚙', status: 'pending' });
      _saveImplStages(p.id, stages);
      render();
    });
  });
  host.querySelectorAll('[data-stage-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-stage-delete');
      const s = stages.find(x => x.id === id);
      if (!s) return;
      if (!await prConfirm(`Удалить этап «${s.name}»?`, 'Этапы — структурные milestones, обычно соответствуют стандартным стадиям проектирования.')) return;
      const idx = stages.findIndex(x => x.id === id);
      if (idx >= 0) stages.splice(idx, 1);
      _saveImplStages(p.id, stages);
      render();
    });
  });
  const resetBtn = host.querySelector('#pr-stage-reset');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (!await prConfirm('Сбросить этапы к стандартному набору?', 'Текущие этапы будут заменены на: ' + IMPL_STAGES_DEFAULT.map(s => s.name).join(' → '))) return;
    const fresh = IMPL_STAGES_DEFAULT.map(s => ({ ...s, id: _newStageId() }));
    _saveImplStages(p.id, fresh);
    render();
  });
}

// v0.60.498 (Roadmap 47.2.7-followup): расчёт критического пути (CPM).
// Длительность = (endDate − startDate) в днях (мин. 1; default 7 если
// дат нет). deps[] — id задач-предшественников (finish→start). Прямой
// проход (ES/EF) + обратный (LS/LF) → slack; slack≈0 → critical.
// Циклы безопасны: топосорт через Kahn, узлы в цикле помечаются
// non-critical (и возвращается флаг hasCycle).
function _computeCriticalPath(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const dur = (t) => {
    if (t.startDate && t.endDate) {
      const d = (new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86400e3;
      return Math.max(1, Math.round(d));
    }
    return 7;
  };
  // Граф зависимостей (только валидные id).
  const preds = new Map();
  const succs = new Map();
  for (const t of tasks) { preds.set(t.id, []); succs.set(t.id, []); }
  for (const t of tasks) {
    for (const d of (Array.isArray(t.deps) ? t.deps : [])) {
      if (d === t.id || !byId.has(d)) continue;
      preds.get(t.id).push(d);
      succs.get(d).push(t.id);
    }
  }
  // Kahn topo-sort.
  const indeg = new Map(tasks.map(t => [t.id, preds.get(t.id).length]));
  const q = tasks.filter(t => indeg.get(t.id) === 0).map(t => t.id);
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const s of succs.get(id)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) q.push(s);
    }
  }
  const hasCycle = order.length !== tasks.length;
  // Forward pass: ES/EF (в днях от 0).
  const ES = new Map(), EF = new Map();
  for (const id of order) {
    const t = byId.get(id);
    const es = preds.get(id).reduce((m, p) => Math.max(m, EF.get(p) ?? 0), 0);
    ES.set(id, es);
    EF.set(id, es + dur(t));
  }
  const projEnd = order.reduce((m, id) => Math.max(m, EF.get(id) ?? 0), 0);
  // Backward pass: LF/LS.
  const LF = new Map(), LS = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id);
    const lf = succs.get(id).length
      ? succs.get(id).reduce((m, s) => Math.min(m, LS.get(s) ?? projEnd), Infinity)
      : projEnd;
    LF.set(id, lf);
    LS.set(id, lf - dur(t));
  }
  const res = new Map();
  for (const t of tasks) {
    const inOrder = order.includes(t.id);
    const slack = inOrder ? Math.round((LS.get(t.id) ?? 0) - (ES.get(t.id) ?? 0)) : null;
    res.set(t.id, {
      critical: inOrder && slack !== null && slack <= 0,
      slackDays: slack,
      durDays: dur(t),
      es: ES.get(t.id) ?? null,
    });
  }
  return { map: res, hasCycle, projEnd };
}

// v0.60.498 (Roadmap 47.2.7-followup): полноценный in-page редактор
// задачи (раньше .pr-task-edit только переименовывал через prPrompt).
// Поля: название, дисциплина, статус, старт, срок, зависимости
// (чекбоксы остальных задач — predecessors для CPM).
function _openTaskEditModal(p, task, onSaved) {
  const arr = _loadPlanTasks(p.id);
  const others = arr.filter(x => x.id !== task.id);
  const deps = new Set(Array.isArray(task.deps) ? task.deps : []);
  const overlay = document.createElement('div');
  overlay.className = 'pr-overlay';
  overlay.innerHTML = `
    <div class="pr-modal" style="max-width:520px;width:100%">
      <h3>✎ Задача плана</h3>
      <label class="pr-modal-label">Название</label>
      <input type="text" id="te-title" class="pr-modal-input" value="${esc(task.title || '')}">
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <label style="flex:1;min-width:140px;font-size:11px;color:#64748b">Дисциплина
          <select id="te-disc" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            ${PLAN_DISCIPLINES.map(d => `<option value="${d.id}"${d.id === (task.discipline || 'other') ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
          </select>
        </label>
        <label style="flex:1;min-width:140px;font-size:11px;color:#64748b">Статус
          <select id="te-status" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
            ${PLAN_STATUSES.map(s => `<option value="${s.id}"${s.id === (task.status || 'todo') ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <label style="flex:1;font-size:11px;color:#64748b">Старт
          <input type="date" id="te-start" value="${esc(task.startDate || '')}" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
        </label>
        <label style="flex:1;font-size:11px;color:#64748b">Срок
          <input type="date" id="te-end" value="${esc(task.endDate || '')}" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
        </label>
      </div>
      <label class="pr-modal-label" style="margin-top:10px">Зависит от (предшественники для критического пути)</label>
      <div style="max-height:160px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px;padding:6px">
        ${others.length ? others.map(o => `<label style="display:flex;align-items:center;gap:7px;padding:3px 4px;font-size:12px;cursor:pointer">
          <input type="checkbox" class="te-dep" value="${esc(o.id)}"${deps.has(o.id) ? ' checked' : ''}>
          <span>${esc(o.title || '—')}</span>
        </label>`).join('') : '<span class="muted" style="font-size:12px">Других задач нет.</span>'}
      </div>
      <div class="pr-modal-actions">
        <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
        <button type="button" class="pr-btn-primary" data-act="yes">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { close(); return; }
    const act = e.target.dataset?.act;
    if (act === 'no') { close(); return; }
    if (act === 'yes') {
      const fresh = _loadPlanTasks(p.id);
      const tt = fresh.find(x => x.id === task.id);
      if (!tt) { close(); return; }
      tt.title = (overlay.querySelector('#te-title').value || '').trim() || tt.title;
      tt.discipline = overlay.querySelector('#te-disc').value || 'other';
      tt.status = overlay.querySelector('#te-status').value || 'todo';
      if (tt.status === 'done') tt.progressPct = 100;
      tt.startDate = overlay.querySelector('#te-start').value || null;
      tt.endDate = overlay.querySelector('#te-end').value || null;
      tt.deps = [...overlay.querySelectorAll('.te-dep:checked')].map(i => i.value);
      _savePlanTasks(p.id, fresh);
      close();
      if (typeof onSaved === 'function') onSaved();
    }
  });
}

// v0.60.295 (Этап 1.4-followup по запросу Пользователя 2026-05-06: «для
// плана нужно организовать диаграмму Ганта»):
// Простая SVG Gantt-диаграмма с временной осью (auto-scale по диапазону
// задач), горизонтальными bar'ами по дисциплинам, цвет = discipline,
// прозрачность = status. Этапы реализации (impl-stages) показаны как
// vertical milestone lines на оси.
// v0.60.498 (47.2.7-followup): + критический путь (CPM, красная подсветка),
// стрелки зависимостей, day-сетка для коротких диапазонов, drag-move /
// resize правого края bar'ов мышью.
function _renderGanttChart(tasks, p) {
  // Собираем диапазон дат: от min startDate (или createdAt) до max endDate.
  const dates = [];
  for (const t of tasks) {
    if (t.startDate) dates.push(new Date(t.startDate).getTime());
    if (t.endDate) dates.push(new Date(t.endDate).getTime());
    if (!t.startDate && !t.endDate && t.createdAt) dates.push(t.createdAt);
  }
  if (!dates.length) {
    return `<div style="padding:14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;text-align:center;color:#64748b;font-size:12.5px;margin-bottom:14px">
      📊 Gantt: задайте даты начала/окончания у задач — диаграмма появится автоматически.
    </div>`;
  }
  let minMs = Math.min(...dates);
  let maxMs = Math.max(...dates);
  // Расширим диапазон на 10% с каждой стороны (визуальный air).
  const span = Math.max(7 * 86400e3, maxMs - minMs); // мин. 7 дней
  minMs -= span * 0.05;
  maxMs += span * 0.05;
  const totalMs = maxMs - minMs;
  // Определяем тики оси (months или weeks в зависимости от диапазона).
  const totalDays = totalMs / 86400e3;
  const useMonths = totalDays > 60;
  const ticks = [];
  const startTick = new Date(minMs);
  if (useMonths) {
    startTick.setUTCDate(1); startTick.setUTCHours(0, 0, 0, 0);
    let t = startTick.getTime();
    while (t < maxMs) {
      ticks.push(t);
      const d = new Date(t);
      d.setUTCMonth(d.getUTCMonth() + 1);
      t = d.getTime();
    }
  } else {
    // weeks
    startTick.setUTCDay = startTick.setUTCDay || (() => {});
    const day = startTick.getUTCDay();
    startTick.setUTCDate(startTick.getUTCDate() - day + 1); // понедельник
    startTick.setUTCHours(0, 0, 0, 0);
    let t = startTick.getTime();
    while (t < maxMs) { ticks.push(t); t += 7 * 86400e3; }
  }
  // Группировка задач по дисциплинам (только с datами).
  const grouped = {};
  for (const t of tasks) {
    const d = t.discipline || 'other';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(t);
  }
  const disciplinesUsed = PLAN_DISCIPLINES.filter(d => grouped[d.id]?.length > 0);
  // Layout
  const W = 1100;
  const padL = 200; // место под labels дисциплин
  const padR = 20;
  const padT = 40;  // место под date axis
  const padB = 30;
  const rowH = 28;
  const rowGap = 2;
  const totalH = padT + padB + disciplinesUsed.reduce((s, d) => s + grouped[d.id].length * (rowH + rowGap), 0);
  const innerW = W - padL - padR;
  const x = (ms) => padL + ((ms - minMs) / totalMs) * innerW;
  // Today line.
  const nowMs = Date.now();
  const showToday = nowMs >= minMs && nowMs <= maxMs;
  // SVG building.
  const fmtTick = (ms) => {
    const d = new Date(ms);
    if (useMonths) return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  let svg = `<svg width="100%" viewBox="0 0 ${W} ${totalH}" style="display:block;background:#fff;border:1px solid #e5e7eb;border-radius:6px" preserveAspectRatio="xMinYMin meet">`;
  // Tick lines + labels
  for (const tk of ticks) {
    const tx = x(tk);
    svg += `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${totalH - padB}" stroke="#f1f5f9" stroke-width="1"/>`;
    svg += `<text x="${tx}" y="${padT - 8}" font-size="10" fill="#64748b" text-anchor="middle">${fmtTick(tk)}</text>`;
  }
  // Implementation stages — vertical milestone lines.
  const stages = _getImplStages(p);
  for (const s of stages) {
    if (s.finishedAt && s.finishedAt >= minMs && s.finishedAt <= maxMs) {
      const sx = x(s.finishedAt);
      svg += `<line x1="${sx}" y1="${padT}" x2="${sx}" y2="${totalH - padB}" stroke="#15803d" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>`;
      svg += `<text x="${sx + 3}" y="${padT - 22}" font-size="9" fill="#15803d" font-weight="600">${esc(s.icon || '')} ${esc(s.name)} ✓</text>`;
    }
  }
  // Today line
  if (showToday) {
    const tx = x(nowMs);
    svg += `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${totalH - padB}" stroke="#dc2626" stroke-width="1.5" opacity="0.7"/>`;
    svg += `<text x="${tx + 3}" y="${totalH - padB + 12}" font-size="10" fill="#dc2626" font-weight="600">сегодня</text>`;
  }
  // v0.60.498: day sub-grid для коротких диапазонов (multi-day overlay).
  if (totalDays <= 21) {
    const d0 = new Date(minMs); d0.setUTCHours(0, 0, 0, 0);
    for (let dt = d0.getTime(); dt < maxMs; dt += 86400e3) {
      if (dt < minMs) continue;
      const dx = x(dt);
      svg += `<line x1="${dx}" y1="${padT}" x2="${dx}" y2="${totalH - padB}" stroke="#f8fafc" stroke-width="1"/>`;
    }
  }
  // v0.60.498: критический путь (CPM).
  const cpm = _computeCriticalPath(tasks);
  const cMap = cpm.map;
  // Task bars (+ запоминаем геометрию для стрелок зависимостей).
  const barGeom = {}; // id → { x1, x2, yMid, y, h }
  let y = padT;
  for (const disc of disciplinesUsed) {
    const arr = grouped[disc.id];
    // Discipline label group (на левой панели, перед первой задачей дисциплины).
    svg += `<text x="${padL - 8}" y="${y + 14}" font-size="11" fill="${disc.color}" font-weight="600" text-anchor="end">${esc(disc.label)}</text>`;
    for (const t of arr) {
      const sMs = t.startDate ? new Date(t.startDate).getTime() : (t.createdAt || nowMs);
      const eMs = t.endDate ? new Date(t.endDate).getTime() : sMs + 7 * 86400e3;
      const x1 = x(sMs);
      const x2 = x(Math.max(eMs, sMs + 86400e3 * 0.5)); // мин. ширина 0.5 дня
      const w = Math.max(2, x2 - x1);
      const stMeta = PLAN_STATUSES.find(s => s.id === t.status) || PLAN_STATUSES[0];
      const opacity = t.status === 'done' ? 0.85 : (t.status === 'blocked' ? 0.7 : (t.status === 'todo' ? 0.5 : 0.95));
      const crit = cMap.get(t.id)?.critical;
      const stroke = crit ? '#dc2626' : (t.status === 'done' ? '#15803d' : (t.status === 'blocked' ? '#991b1b' : disc.color));
      const barY = y + 4, barH = rowH - 8;
      barGeom[t.id] = { x1, x2: x1 + w, yMid: barY + barH / 2, y: barY, h: barH, critical: !!crit };
      const slack = cMap.get(t.id)?.slackDays;
      svg += `<g class="tw-gantt-bar" data-task-id="${esc(t.id)}" data-x1="${x1.toFixed(2)}" data-w="${w.toFixed(2)}" data-y="${barY}" data-h="${barH}" style="cursor:grab">
        <rect class="tw-gantt-bar-rect" x="${x1}" y="${barY}" width="${w}" height="${barH}" rx="3" fill="${disc.color}" opacity="${opacity}" stroke="${stroke}" stroke-width="${crit ? 2 : 1}"/>
        <text x="${x1 + 5}" y="${y + 17}" font-size="11" fill="#fff" font-weight="500" style="pointer-events:none">${crit ? '★ ' : ''}${esc(t.title.slice(0, 38))}${t.title.length > 38 ? '…' : ''}</text>
        <rect class="tw-gantt-resize" data-task-id="${esc(t.id)}" x="${(x1 + w - 5).toFixed(2)}" y="${barY}" width="6" height="${barH}" fill="transparent" style="cursor:ew-resize"/>
        <title>${esc(t.title)} · ${esc(stMeta.label)}${t.startDate ? ` · ${esc(t.startDate)} → ${esc(t.endDate || '?')}` : ''}${crit ? ' · 🔴 критический путь' : (slack != null ? ` · резерв ${slack} дн` : '')}</title>
      </g>`;
      y += rowH + rowGap;
    }
  }
  // v0.60.498: стрелки зависимостей (finish→start). Красные если обе
  // задачи на критическом пути, иначе серые.
  svg += `<defs>
    <marker id="tw-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8"/></marker>
    <marker id="tw-arr-c" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#dc2626"/></marker>
  </defs>`;
  for (const t of tasks) {
    const g2 = barGeom[t.id];
    if (!g2) continue;
    for (const dId of (Array.isArray(t.deps) ? t.deps : [])) {
      const g1 = barGeom[dId];
      if (!g1) continue;
      const isC = g1.critical && g2.critical;
      const col = isC ? '#dc2626' : '#94a3b8';
      const sx = g1.x2, sy = g1.yMid, ex = g2.x1 - 6, ey = g2.yMid;
      const midX = Math.max(sx + 12, (sx + ex) / 2);
      svg += `<path d="M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}" fill="none" stroke="${col}" stroke-width="${isC ? 1.6 : 1.1}" opacity="0.75" marker-end="url(#${isC ? 'tw-arr-c' : 'tw-arr'})"/>`;
    }
  }
  svg += `</svg>`;
  const critCount = [...cMap.values()].filter(v => v.critical).length;
  return `<div class="tw-gantt-wrap" style="margin:14px 0;padding:6px 0"
      data-pid="${esc(p.id)}" data-min-ms="${Math.round(minMs)}" data-total-ms="${Math.round(totalMs)}"
      data-inner-w="${innerW}" data-pad-l="${padL}" data-svg-w="${W}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <h4 style="margin:0;font-size:13px;color:#0f172a">📊 Диаграмма Ганта</h4>
      <span class="muted" style="font-size:11px">диапазон: ${fmtTick(minMs)} — ${fmtTick(maxMs)} · ${disciplinesUsed.length} дисциплин · ${tasks.length} задач${showToday ? ' · 🔴 сегодня' : ''}${critCount ? ` · ★ ${critCount} на крит. пути` : ''}${cpm.hasCycle ? ' · ⚠ цикл зависимостей' : ''}</span>
    </div>
    <div style="overflow-x:auto;background:#f8fafc;padding:4px;border-radius:6px">${svg}</div>
    <p class="muted" style="font-size:11px;margin:6px 0 0">
      Bars — задачи (цвет дисциплины, прозрачность = статус). <b>★ красная обводка</b> — критический путь
      (slack = 0; CPM по deps + длительностям). Стрелки — зависимости (красные на крит. пути).
      Перетаскивание bar мышью сдвигает задачу; правый край — меняет срок (snap по дням).
      Зелёные пунктир — завершённые этапы, красная вертикаль — сегодня.
    </p>
  </div>`;
}

// v0.60.498 (Roadmap 47.2.7-followup): drag-move / resize-end для bar'ов
// Ганта мышью (pointer events). Координаты SVG масштабируются (viewBox
// W=1100 → клиентская ширина), поэтому переводим Δpx клиента в дни через
// scale = clientW / svgW. Snap по дням; на drop — пишем start/endDate и
// перерисовываем (renderProjectPlan через onChange).
function _wireGanttInteractions(host, p, onChange) {
  // Снять предыдущий window-listener (host.innerHTML пересоздаётся —
  // старый wrap отвязан, но window-listener иначе копится).
  try { if (host._twGanttCleanup) host._twGanttCleanup(); } catch {}
  const wrap = host.querySelector('.tw-gantt-wrap');
  if (!wrap) return;
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const minMs = Number(wrap.dataset.minMs) || 0;
  const totalMs = Number(wrap.dataset.totalMs) || 1;
  const innerW = Number(wrap.dataset.innerW) || 1;
  const svgW = Number(wrap.dataset.svgW) || 1100;
  const DAY = 86400e3;
  let drag = null; // { id, mode, startX, sMs0, eMs0 }
  const pxPerDay = () => {
    const scale = (svg.getBoundingClientRect().width || svgW) / svgW;
    return (innerW / (totalMs / DAY)) * scale;
  };
  const onDown = (e) => {
    const resize = e.target.closest('.tw-gantt-resize');
    const g = e.target.closest('.tw-gantt-bar');
    if (!g) return;
    const id = g.dataset.taskId;
    const arr = _loadPlanTasks(p.id);
    const t = arr.find(x => x.id === id);
    if (!t) return;
    const sMs0 = t.startDate ? new Date(t.startDate).getTime() : Date.now();
    const eMs0 = t.endDate ? new Date(t.endDate).getTime() : sMs0 + 7 * DAY;
    drag = { id, mode: resize ? 'resize' : 'move', startX: e.clientX, sMs0, eMs0 };
    g.style.cursor = resize ? 'ew-resize' : 'grabbing';
    e.preventDefault();
  };
  const onUp = (e) => {
    if (!drag) return;
    const dDays = Math.round((e.clientX - drag.startX) / (pxPerDay() || 1));
    drag._dDays = dDays;
    const arr = _loadPlanTasks(p.id);
    const t = arr.find(x => x.id === drag.id);
    if (t && dDays !== 0) {
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      if (drag.mode === 'move') {
        t.startDate = iso(drag.sMs0 + dDays * DAY);
        t.endDate = iso(drag.eMs0 + dDays * DAY);
      } else {
        const ne = Math.max(drag.sMs0 + DAY, drag.eMs0 + dDays * DAY);
        if (!t.startDate) t.startDate = iso(drag.sMs0);
        t.endDate = iso(ne);
      }
      _savePlanTasks(p.id, arr);
      drag = null;
      if (typeof onChange === 'function') onChange();
      return;
    }
    drag = null;
  };
  svg.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  // Снимаем window-listener при следующем ре-рендере (host очищается).
  host._twGanttCleanup = () => window.removeEventListener('pointerup', onUp);
}

function renderProjectPlan(p, host) {
  const tasks = _loadPlanTasks(p.id);
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in-progress').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const progress = total > 0 ? Math.round(done / total * 100) : 0;

  // Group by discipline
  const grouped = {};
  for (const t of tasks) {
    const d = t.discipline || 'other';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(t);
  }

  const summaryHtml = total > 0 ? `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
      <span><b>${total}</b> задач</span>
      <span style="color:#15803d">✅ ${done} выполнено</span>
      <span style="color:#1d4ed8">🔵 ${inProgress} в работе</span>
      ${blocked > 0 ? `<span style="color:#991b1b">🛑 ${blocked} заблок.</span>` : ''}
      <span style="margin-left:auto">Прогресс: <b>${progress}%</b></span>
      <div style="width:120px;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden">
        <div style="width:${progress}%;height:100%;background:#15803d;transition:width 0.3s"></div>
      </div>
    </div>
  ` : `<p class="muted" style="margin-bottom:10px;font-size:12px">Задач пока нет. Добавьте первую — она появится в списке ниже.</p>`;

  const discChips = PLAN_DISCIPLINES.map(d => `<option value="${d.id}">${esc(d.label)}</option>`).join('');
  const statChips = PLAN_STATUSES.map(s => `<option value="${s.id}"${s.id === 'todo' ? ' selected' : ''}>${esc(s.label)}</option>`).join('');

  let groupsHtml = '';
  if (total > 0) {
    for (const disc of PLAN_DISCIPLINES) {
      const arr = grouped[disc.id];
      if (!arr || !arr.length) continue;
      const rows = arr.map(t => {
        const stMeta = PLAN_STATUSES.find(s => s.id === t.status) || PLAN_STATUSES[0];
        const dueWarn = t.endDate && new Date(t.endDate) < new Date() && t.status !== 'done';
        return `<tr data-task-id="${esc(t.id)}" style="border-bottom:1px solid #f1f5f9">
          <td style="padding:5px 8px"><b>${esc(t.title || '—')}</b></td>
          <td style="padding:5px 8px">
            <select class="pr-task-status" data-task-id="${esc(t.id)}" style="padding:2px 4px;font-size:11.5px;border:1px solid #cbd5e1;border-radius:3px">
              ${PLAN_STATUSES.map(s => `<option value="${s.id}"${s.id === t.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </td>
          <td style="padding:5px 8px;font-size:11.5px;color:${dueWarn ? '#991b1b' : '#475569'}" title="${dueWarn ? 'Просрочена!' : 'Дата окончания'}">${esc(t.endDate || '—')}</td>
          <td style="padding:5px 8px;text-align:right">
            <button type="button" class="pr-task-edit" data-task-id="${esc(t.id)}" title="Редактировать" style="padding:2px 6px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer">✎</button>
            <button type="button" class="pr-task-del" data-task-id="${esc(t.id)}" title="Удалить" style="padding:2px 6px;font-size:11px;border:1px solid #fecaca;background:#fee2e2;color:#991b1b;border-radius:3px;cursor:pointer">×</button>
          </td>
        </tr>`;
      }).join('');
      groupsHtml += `<div style="margin-bottom:12px">
        <h4 style="margin:0 0 4px;font-size:12.5px;color:${disc.color}">${esc(disc.label)} <span class="muted">·${arr.length}</span></h4>
        <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }
  }

  // v0.60.290 (Этап 1.4 Phase 47): этапы реализации в plan-tab.
  const stagesHtml = _renderImplStagesBlock(p);
  host.innerHTML = `
    ${stagesHtml}
    <h4 style="margin:18px 0 10px;font-size:14px;color:#0f172a;border-top:1px solid #e5e7eb;padding-top:14px">📅 План-график задач</h4>
    ${summaryHtml}
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin-bottom:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
      <input type="text" id="pr-task-title" placeholder="Название задачи..." style="flex:1;min-width:200px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">
      <select id="pr-task-disc" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">
        ${discChips}
      </select>
      <select id="pr-task-status" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">
        ${statChips}
      </select>
      <!-- v0.60.295: startDate для Gantt-диаграммы. -->
      <label style="font-size:11px;color:#64748b;display:flex;flex-direction:column;gap:1px">
        старт
        <input type="date" id="pr-task-start" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">
      </label>
      <label style="font-size:11px;color:#64748b;display:flex;flex-direction:column;gap:1px">
        срок
        <input type="date" id="pr-task-due" style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px">
      </label>
      <button type="button" id="pr-task-add" class="pr-btn-sel" style="background:#1d4ed8;color:#fff;border:none">+ Добавить</button>
    </div>
    ${total > 0 ? _renderGanttChart(tasks, p) : ''}
    ${groupsHtml || ''}
  `;

  // Handlers
  const addBtn = host.querySelector('#pr-task-add');
  if (addBtn) addBtn.addEventListener('click', () => {
    const title = host.querySelector('#pr-task-title').value.trim();
    if (!title) { prToast('Введите название задачи', 'error'); return; }
    const t = {
      id: _newTaskId(),
      title,
      discipline: host.querySelector('#pr-task-disc').value || 'other',
      status: host.querySelector('#pr-task-status').value || 'todo',
      // v0.60.295: startDate + endDate для Gantt-диаграммы.
      startDate: host.querySelector('#pr-task-start')?.value || null,
      endDate: host.querySelector('#pr-task-due').value || null,
      progressPct: 0,
      createdAt: Date.now(),
    };
    const arr = _loadPlanTasks(p.id);
    arr.push(t);
    _savePlanTasks(p.id, arr);
    prToast(`✓ Задача «${title}» добавлена`);
    renderProjectPlan(p, host);
  });

  // Status change
  host.querySelectorAll('.pr-task-status').forEach(sel => {
    sel.addEventListener('change', e => {
      const id = e.target.dataset.taskId;
      const arr = _loadPlanTasks(p.id);
      const t = arr.find(x => x.id === id);
      if (!t) return;
      t.status = e.target.value;
      if (t.status === 'done') t.progressPct = 100;
      _savePlanTasks(p.id, arr);
      renderProjectPlan(p, host);
    });
  });

  // Delete
  host.querySelectorAll('.pr-task-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.taskId;
      const arr = _loadPlanTasks(p.id);
      const t = arr.find(x => x.id === id);
      if (!t) return;
      // v0.60.139: replaced confirm() with prConfirm (no browser dialogs).
      const ok = await prConfirm('Удалить задачу?', `Удалить задачу «${t.title}»?`);
      if (!ok) return;
      _savePlanTasks(p.id, arr.filter(x => x.id !== id));
      prToast('✓ Удалена', 'info');
      renderProjectPlan(p, host);
    });
  });

  // v0.60.498: Edit → полноценный редактор (название/дисциплина/статус/
  // даты/зависимости для критического пути), вместо rename-only prompt.
  host.querySelectorAll('.pr-task-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.taskId;
      const t = _loadPlanTasks(p.id).find(x => x.id === id);
      if (!t) return;
      _openTaskEditModal(p, t, () => renderProjectPlan(p, host));
    });
  });

  // v0.60.498: drag-move / resize bar'ов Ганта мышью.
  _wireGanttInteractions(host, p, () => renderProjectPlan(p, host));

  // v0.60.290 (Этап 1.4): wire-up для блока «🎯 Этапы реализации».
  _wireImplStagesBlock(p, host);
}

// v0.60.96 (Phase 39.2): per-state checklists. Что должно быть у проекта,
// чтобы перейти в данное состояние. <code>artifacts</code> — массив проверок,
// каждая возвращает {ok:bool, label, hint} по чтению LS-данных проекта.
const LCM_CHECKLISTS = {
  concept: [
    { label: 'Концепция в Технологе ЦОД', hint: 'Хотя бы один вариант с заполненным «🏷 Объект»',
      check: (pid) => {
        try {
          const v = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
          return Array.isArray(v) && v.length > 0;
        } catch { return false; }
      } },
    { label: 'Локация объекта',
      hint: 'Координаты заполнены в свойствах проекта',
      check: (pid) => { const p = listProjects().find(x => x.id === pid); return !!(p?.location?.lat && p?.location?.lon); } },
  ],
  sketch: [
    { label: 'Реквизиты заказчика',
      hint: 'p.requisites.code/customer/address заполнены',
      check: (pid) => { const p = listProjects().find(x => x.id === pid); return !!(p?.requisites?.code && p?.requisites?.customer); } },
    { label: 'Утверждённый вариант концепции',
      hint: 'В TW есть variant с approvedAt',
      check: (pid) => {
        try {
          const v = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
          return Array.isArray(v) && v.some(x => x.approvedAt);
        } catch { return false; }
      } },
    { label: 'IT-нагрузка > 0',
      hint: 'rackGroups.count × kwPerRack > 0',
      check: (pid) => {
        try {
          const v = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
          if (!Array.isArray(v)) return false;
          const primary = v.find(x => x.primary) || v[0];
          if (!primary?.concept?.rackGroups) return false;
          const itKw = primary.concept.rackGroups.reduce((s, rg) => s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0), 0);
          return itKw > 0;
        } catch { return false; }
      } },
  ],
  working: [
    { label: 'Главная схема (schematic)',
      hint: 'Хотя бы один узел в схеме',
      check: (pid) => {
        try {
          const sch = projectLoad(pid, 'engine', 'scheme.v1', {});
          return Array.isArray(sch.nodes) && sch.nodes.length > 0;
        } catch { return false; }
      } },
    { label: 'Подбор холодильных систем',
      hint: 'Хотя бы один cooling-подбор с ★ вариантом',
      check: (pid) => {
        try {
          const s = projectLoad(pid, 'cooling', 'selections.v1', []);
          return Array.isArray(s) && s.some(x => x.options?.length > 0);
        } catch { return false; }
      } },
    { label: 'Метеоданные загружены',
      hint: 'Активный climate dataset в meteo',
      check: (pid) => {
        try {
          const ds = projectLoad(pid, 'meteo', 'datasets.v1', []);
          return Array.isArray(ds) && ds.length > 0;
        } catch { return false; }
      } },
    { label: 'СКС-проект (если есть)',
      hint: 'scs-design.scs (опционально для электр.-only)',
      check: (pid) => {
        try {
          const scs = projectLoad(pid, 'scs-design', 'scs.v1', null);
          if (scs == null) return false;
          if (Array.isArray(scs)) return scs.length > 0;
          if (typeof scs === 'object') return Object.keys(scs).length > 0;
          return true;
        } catch { return false; }
      }, optional: true },
  ],
  construction: [
    { label: 'Монтажные наряды (service)',
      hint: 'service.orders с type=install',
      check: (pid) => {
        try {
          const o = projectLoad(pid, 'service', 'orders.v1', []);
          return Array.isArray(o) && o.some(x => x.type === 'install');
        } catch { return false; }
      } },
  ],
  commissioning: [
    { label: 'ПНР наряды или акты',
      hint: 'service.orders type=one-off с пометкой ПНР',
      check: () => false, optional: true },
  ],
  operation: [
    { label: 'Регламентное ТО запланировано',
      hint: 'service.orders с type=maintenance',
      check: (pid) => {
        try {
          const o = projectLoad(pid, 'service', 'orders.v1', []);
          return Array.isArray(o) && o.some(x => x.type === 'maintenance');
        } catch { return false; }
      } },
    { label: 'Asset registry (facility-inventory)',
      hint: 'Реестр оборудования объекта заполнен',
      check: (pid) => {
        try {
          const fi = projectLoad(pid, 'facility-inventory', 'items.v1', []);
          return Array.isArray(fi) && fi.length > 0;
        } catch { return false; }
      }, optional: true },
  ],
  upgrade: [
    { label: 'Создан upgrade-вариант',
      hint: 'TW variant с approvedAt и parentRevision (TODO Phase 39.5)',
      check: () => false, optional: true },
  ],
  decommission: [
    { label: 'Документация утилизации',
      hint: 'TODO Phase 39.6',
      check: () => false, optional: true },
  ],
};

function _renderChecklist(stateId, pid) {
  const items = LCM_CHECKLISTS[stateId] || [];
  if (!items.length) return '<p class="muted" style="font-size:11px">Нет требований для этого состояния.</p>';
  return `<div style="margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
    <div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px">Что нужно для перехода:</div>
    ${items.map(it => {
      const ok = it.check(pid);
      const icon = ok ? '✅' : (it.optional ? '⏸' : '❌');
      const color = ok ? '#15803d' : (it.optional ? '#94a3b8' : '#b91c1c');
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:${color}">
        <span>${icon}</span>
        <span style="flex:1">
          <b>${esc(it.label)}</b>${it.optional ? ' <span style="font-size:10.5px;font-weight:400;color:#94a3b8">(опц.)</span>' : ''}
          <span style="display:block;font-size:10.5px;color:#64748b">${esc(it.hint)}</span>
        </span>
      </div>`;
    }).join('')}
  </div>`;
}

// v0.60.94/96: picker для lifecycle state. v0.60.96 добавлен per-state
// checklist (что нужно для каждой стадии — auto-detection из LS-данных).
function prLcmStatePicker(current, pid) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    const rows = LCM_STATES.map(s => {
      const isCurrent = s.id === current;
      const checklistHtml = pid ? _renderChecklist(s.id, pid) : '';
      return `<div class="pr-lcm-card" style="border:1px solid ${isCurrent ? s.color : '#e2e8f0'};background:${isCurrent ? s.bg : '#fff'};border-radius:8px;margin-bottom:8px;overflow:hidden">
        <button type="button" class="pr-lcm-row" data-id="${s.id}" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;background:transparent;cursor:pointer;text-align:left">
          <span style="font-size:18px">${s.icon}</span>
          <span style="flex:1">
            <b style="color:${s.color}">${s.label}</b>
            <span style="display:block;font-size:11px;color:#64748b;margin-top:2px">${s.desc}</span>
          </span>
          ${isCurrent ? '<span style="color:' + s.color + ';font-size:12px;font-weight:600">✓ текущий</span>' : '<span style="color:#94a3b8;font-size:12px">→ перевести</span>'}
        </button>
        ${checklistHtml ? '<div style="padding:0 12px 10px">' + checklistHtml + '</div>' : ''}
      </div>`;
    }).join('');
    overlay.innerHTML = `
      <div class="pr-modal" style="max-width:600px;max-height:90vh;overflow-y:auto">
        <h3>🔄 Жизненный цикл объекта (Phase 39)</h3>
        <p class="muted" style="font-size:12px;margin:6px 0 12px">ISO 15288 / PLM: 8 состояний от концепции до decommission. Под каждым — checklist (что нужно для перехода). ✅ выполнено · ❌ обязательное · ⏸ опц.</p>
        <div>${rows}</div>
        <div class="pr-modal-actions"><button type="button" class="pr-btn-sel" data-act="no">Закрыть</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      const row = e.target.closest('.pr-lcm-row');
      if (row) done(row.dataset.id);
      if (e.target.dataset?.act === 'no') done(null);
    });
  });
}

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
    const sch = projectLoad(pid, 'engine', 'scheme.v1', null);
    if (sch && Array.isArray(sch.nodes)) s.nodes = sch.nodes.length;
  } catch {}
  try {
    // v0.59.379: предпочитаем считать по реальным экземплярам стоек проекта
    // (rack-config.instances.v1), а не по orphan-данным contents/rackTags.
    const inst = projectLoad(pid, 'rack-config', 'instances.v1', []);
    const nInst = Array.isArray(inst) ? inst.length : 0;
    if (nInst > 0) {
      s.racks = nInst;
    } else {
      const cont = projectLoad(pid, 'scs-config', 'contents.v1', {}) || {};
      const tags = projectLoad(pid, 'scs-config', 'rackTags.v1', {}) || {};
      const ids = new Set();
      try { Object.keys(cont).forEach(k => { if (Array.isArray(cont[k]) && cont[k].length) ids.add(k); }); } catch {}
      try { Object.keys(tags).forEach(k => { if ((tags[k] || '').trim()) ids.add(k); }); } catch {}
      s.racks = ids.size;
    }
  } catch {}
  try {
    const ln = projectLoad(pid, 'scs-design', 'links.v1', []);
    if (Array.isArray(ln)) s.links = ln.length;
  } catch {}
  try {
    const cont = projectLoad(pid, 'scs-config', 'contents.v1', {}) || {};
    s.inventory = Object.values(cont).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  } catch {}
  try {
    const o = projectLoad(pid, 'facility-inventory', 'v1', null);
    if (Array.isArray(o)) s.facility = o.length;
    else if (o && Array.isArray(o.items)) s.facility = o.items.length;
  } catch {}
  return s;
}

/* ---------- Получаем pid из URL ---------- */
// v0.60.610 (репорт Пользователя: переключение проекта через плашку
// в шапке открывает пустую карточку, а через /projects/ — работает).
// Причина: shared/app-header.js при switch ставит активный проект и
// перезагружает БЕЗ ?project= (чтобы calc-модули не залипали в URL-mode);
// карточка же читала ТОЛЬКО ?project= → без параметра pid=null → пусто.
// Фикс: fallback на getActiveProjectId() (как во всех calc-модулях),
// явный ?project= по-прежнему имеет приоритет (открытие из /projects/).
function getPid() {
  try {
    const url = new URLSearchParams(location.search).get('project');
    if (url) return url;
  } catch {}
  try {
    const a = getActiveProjectId();
    return (a && getProject(a)) ? a : null;
  } catch { return null; }
}

/* ---------- Rendering ---------- */

// v0.60.110: guard против сброса несохранённого ввода при background re-render
// (Auth.onAuthChange срабатывает при silent-refresh токена Firebase даже когда
// проект не менялся). По репорту Пользователя 2026-05-04: «значение некоторых
// полей постоянно сбрасывается».
//
// Стратегия:
//   1. Перед replace-innerHTML захватываем активный input (если есть фокус
//      внутри detail-page) — его data-req/data-cf/data-eco-* + value + caret.
//   2. После render() ищем тот же input и восстанавливаем value + focus + caret.
//
// Также: если у активного input есть несохранённый ввод (value ≠ stored),
// сначала эмитим change-событие, чтобы handler сохранил данные.
function _captureActiveInput() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (!(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement)) return null;
  // Берём только поля под data-detail-* зоной (не toolbar / picker).
  const root = a.closest('#pr-detail-properties, #pr-detail-economics, #pr-detail-plan, #pr-detail-meta, #pr-detail-modules, #pr-detail-actions');
  if (!root) return null;
  const ds = a.dataset || {};
  // Уникальный селектор по data-* атрибуту
  let selector = null;
  for (const k of Object.keys(ds)) {
    selector = `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${ds[k]}"]`;
    break;
  }
  if (!selector) selector = a.id ? `#${a.id}` : null;
  if (!selector) return null;
  return {
    selector,
    rootId: root.id,
    value: a.value,
    selStart: a.selectionStart,
    selEnd: a.selectionEnd,
  };
}

function _restoreActiveInput(snap) {
  if (!snap) return;
  // Находим input по selector внутри его root
  const root = document.getElementById(snap.rootId);
  if (!root) return;
  const target = root.querySelector(snap.selector);
  if (!target) return;
  // Восстанавливаем только если input существует и имеет тот же тип
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  // Если в новом DOM-значении значение отличается от того что юзер набрал —
  // он, очевидно, не успел сохранить. Восстанавливаем НАБРАННОЕ.
  if (target.value !== snap.value) {
    target.value = snap.value;
  }
  try { target.focus(); } catch {}
  try {
    if (snap.selStart != null) target.setSelectionRange(snap.selStart, snap.selEnd ?? snap.selStart);
  } catch {}
}

function render() {
  // v0.60.110: запоминаем focused input чтобы не потерять несохранённый ввод
  // при background re-render (auth-change, etc.).
  const _activeInputSnap = _captureActiveInput();
  const pid = getPid();
  const p = pid ? getProject(pid) : null;

  const headHost = document.getElementById('pr-detail-head');
  const propsHost = document.getElementById('pr-detail-properties');
  const modulesHost = document.getElementById('pr-detail-modules');
  const actionsHost = document.getElementById('pr-detail-actions');
  const economicsHost = document.getElementById('pr-detail-economics'); // v0.60.98
  const planHost = document.getElementById('pr-detail-plan'); // v0.60.97 Phase 38
  const metaHost = document.getElementById('pr-detail-meta');
  const teamHost = document.getElementById('pr-detail-team'); // v0.60.289
  const summaryHost = document.getElementById('pr-detail-summary'); // v0.60.292
  const equipmentHost = document.getElementById('pr-detail-equipment'); // v0.60.293
  const validationHost = document.getElementById('pr-detail-validation'); // v0.60.296
  const approvalsHost = document.getElementById('pr-detail-approvals'); // v0.60.302

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
  // v0.60.94 (Phase 39 START): lifecycle state по ISO 15288.
  const lcm = lcmStateMeta(p.lifecycleState || _deriveLcmFromStatus(p.status));
  const s = projectStats(p.id);

  if (headHost) {
    headHost.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h1 style="margin:0;font-size:24px">${esc(p.name || '(без имени)')}</h1>
            <span class="pr-badge-status" style="background:${st.bg};color:${st.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer" title="Статус проекта (упрощённый, 5 значений). Клик — изменить.">${esc(st.label)}</span>
            <button type="button" class="pr-badge-lcm" data-act="change-lcm" style="background:${lcm.bg};color:${lcm.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${lcm.color}33;font-family:inherit"
                    title="Жизненный цикл объекта по ISO 15288 (8 значений: концепция → ... → decommission). ${esc(lcm.desc)}. Phase 39. Клик — изменить.">${lcm.icon} ${esc(lcm.label)}</button>
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
    // v0.60.94: handler для LCM-бейджа.
    const lcmBtn = headHost.querySelector('[data-act="change-lcm"]');
    if (lcmBtn) {
      lcmBtn.addEventListener('click', async () => {
        const cur = p.lifecycleState || _deriveLcmFromStatus(p.status);
        const next = await prLcmStatePicker(cur, p.id);
        if (next == null || next === cur) return;
        updateProject(p.id, { lifecycleState: next });
        prToast(`🔄 Жизненный цикл: ${lcmStateMeta(next).icon} ${lcmStateMeta(next).label}`);
        render();
      });
    }
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
      const arr = projectLoad(p.id, 'cooling', 'selections.v1', []);
      subCoolings = Array.isArray(arr) ? arr.map(s => ({
        id: s.id, name: s.name,
        meta: `${s.options?.length || 0} вариант${(s.options?.length === 1) ? '' : 'ов'}${s.mainOptionId ? ', есть ★' : ''}`,
      })) : [];
    } catch { subCoolings = []; }
    // v0.60.44: service orders в проекте — multi-instance.
    let subServiceOrders = [];
    try {
      const arr = projectLoad(p.id, 'service', 'orders.v1', []);
      subServiceOrders = Array.isArray(arr) ? arr.map(o => ({
        id: o.id, name: o.name || '(без имени)',
        meta: `${o.type || 'install'} · ${o.positions?.length || 0} позиций · ${o.date || ''}`,
      })) : [];
    } catch { subServiceOrders = []; }

    // v0.59.862: «Карточка модуля появляется только когда есть данные».
    // Singleton-модули (Технолог ЦОД, IT-инвентарь, реестр объекта) видимы
    // если в LS есть их данные; multi-instance (схемы/СКС/шкафы/МЦОД) —
    // если есть подпроекты или (для схемы) Storage-схемы привязаны через
    // scheme.projectId. Те, у которых данных нет — доступны через
    // «+ Добавить ▾».
    const _hasContent = (v) => {
      try {
        if (v == null) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        return true;
      } catch { return false; }
    };
    const hasTechWorkspace = _hasContent(projectLoad(p.id, 'tech-workspace', 'variants.v1', null));
    const hasInventoryIT   = _hasContent(projectLoad(p.id, 'scs-config', 'inventory.v1', null));
    const hasFacilityInv   = _hasContent(projectLoad(p.id, 'facility-inventory', 'v1', null));
    // SCS legacy-данные в parent namespace (см. async-блок ниже).
    const hasScsLegacy = (() => {
      try {
        const links = projectLoad(p.id, 'scs-design', 'links.v1', null);
        const plan  = projectLoad(p.id, 'scs-design', 'plan.v1', null);
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
        href: '../../index.html',
        visible: subSchemes.length > 0, // м.б. дополнено async-Storage
        latent: true,
        addLabel: '⚡ Добавить схему',
        bodyHtml: renderSubList(subSchemes, '../../index.html', '⚡'),
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
        // v0.60.44: Service module card в карточке проекта (по требованию).
        id: 'service', type: 'multi',
        title: '🛠 Сервис: монтаж и ТО', count: subServiceOrders.length,
        color: '#ea580c',
        href: '../service/',
        visible: subServiceOrders.length > 0,
        latent: true,
        addLabel: '🛠 Добавить сервисный наряд',
        bodyHtml: subServiceOrders.length
          ? subServiceOrders.map(o => `
              <div class="pr-sub-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
                <span style="font-size:16px">🛠</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(o.name)} — ${esc(o.meta)}">${esc(o.name)}</span>
                <span class="muted" style="font-size:11px">${esc(o.meta)}</span>
                <a href="${esc(buildModuleHref('../service/', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px" title="Открыть наряд в модуле «Сервис: монтаж и ТО»">Открыть →</a>
              </div>`).join('')
          : `<a href="${esc(buildModuleHref('../service/', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel" style="display:inline-block;text-decoration:none;padding:5px 10px;font-size:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:4px">🛠 Открыть Сервис →</a>`,
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

      ${(() => {
        // v0.60.511 (Roadmap 47.4.4): расчёты/модули сгруппированы по
        // инженерной дисциплине. Электротехнические (схема: cable/breaker/
        // UPS/DGU) рядом друг с другом; ОВК/холод — отдельно; концепция,
        // слаботочка/СКС, реестры/сервис — своими группами. Дисциплина
        // схемы (scheme.discipline, Phase 47.4.1) задаётся в Конструкторе.
        const MOD_DISC = {
          'tech-workspace': 'concept', 'mdc-config': 'concept',
          'schematic': 'electrical',
          'scs-design': 'lowvolt', 'scs-config': 'lowvolt',
          'cooling': 'hvac',
          'service': 'common', 'inventory-it': 'common', 'facility-inventory': 'common',
        };
        const DISC_ORDER = [
          ['concept',    '🧮 Концепция объекта'],
          ['electrical', '⚡ Электротехнические расчёты'],
          ['hvac',       '❄ Холодоснабжение / ОВК'],
          ['lowvolt',    '🔗 Слаботочные системы / СКС'],
          ['common',     '📦 Реестры и сервис'],
        ];
        const shown = MODULES.filter(m => m.visible || m.latent);
        const groups = DISC_ORDER.map(([key, label]) => {
          const mods = shown.filter(m => (MOD_DISC[m.id] || 'common') === key);
          if (!mods.length) return '';
          return `<div class="pr-disc-group" data-disc="${key}" style="margin-bottom:18px">
            <h4 style="margin:0 0 8px;font-size:12.5px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0;padding-bottom:5px">${label}</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
              ${mods.map(moduleCardHtml).join('')}
            </div>
          </div>`;
        }).filter(Boolean).join('');
        return groups || `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">${shown.map(moduleCardHtml).join('')}</div>`;
      })()}`;

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
      'schematic':          { kind: 'multi-storage',    label: 'схема',         href: '../../index.html',     defaultDesig: 'Схема-1', defaultName: 'Схема' },
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
      const scsLinksRaw = localStorage.getItem(projectKey(p.id, 'scs-design', 'links.v1'));
      const scsPlanRaw  = localStorage.getItem(projectKey(p.id, 'scs-design', 'plan.v1'));
      let scsLinks = []; let hasPlan = false;
      try { scsLinks = scsLinksRaw ? (JSON.parse(scsLinksRaw) || []) : []; } catch {}
      try { const o = scsPlanRaw ? JSON.parse(scsPlanRaw) : null; hasPlan = !!(o && (o.items || []).length); } catch {}
      if ((Array.isArray(scsLinks) && scsLinks.length) || hasPlan) {
        // v0.60.208 (по репорту Пользователя 2026-05-04 «постоянно появляется
        // легаси СКС»): если у проекта УЖЕ есть scs-design подпроект,
        // автоматически переносим parent.scs-design.* → sub.scs-design.*
        // без UI и без badge'а. Раньше badge висел постоянно, требуя ручного
        // клика «🔀 Объединить» каждый раз.
        // Используем listSubProjects напрямую (синхронно), без import().
        try {
          const existingSubs = listSubProjects(p.id, 'scs-design');
          if (existingSubs && existingSubs[0] && existingSubs[0].id) {
            const dest = existingSubs[0];
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
                // Если destination уже имеет ключ — не перезаписываем (sub
                // важнее parent), parent просто удаляем.
                const dstKey = subPrefix + k.slice(prefix.length);
                if (!localStorage.getItem(dstKey)) {
                  localStorage.setItem(dstKey, v);
                }
                localStorage.removeItem(k);
                moved++;
              } catch (e) {}
            }
            if (moved > 0) {
              console.info(`[project.js] auto-merged ${moved} legacy SCS keys into sub-project ${dest.id}`);
              // Обновляем локальные переменные чтобы пропустить badge.
              scsLinks = [];
              hasPlan = false;
            }
          }
        } catch (e) { console.warn('[project.js] auto-merge legacy scs failed:', e); }
      }
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
            const ps = await import('shared/project-storage.js');
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
      const instRaw    = localStorage.getItem(projectKey(p.id, 'rack-config', 'instances.v1'));
      const rcContents = localStorage.getItem(projectKey(p.id, 'scs-config', 'contents.v1'));
      const rcTags     = localStorage.getItem(projectKey(p.id, 'scs-config', 'rackTags.v1'));
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
      localStorage.setItem(projectKey(p.id, 'engine', 'scheme.v1'), raw);
      updateProject(p.id, {});
      prToast('✔ Схема скопирована в проект');
      render();
    });
    actionsHost.querySelector('[data-act="apply-scheme"]').addEventListener('click', async () => {
      const key = projectKey(p.id, 'engine', 'scheme.v1');
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

  // v0.60.98: рендер экономики проекта (тариф/валюта/дата курса)
  if (economicsHost) renderProjectEconomics(p, economicsHost);
  // v0.60.97 (Phase 38.1 START): рендер плана задач
  if (planHost) renderProjectPlan(p, planHost);
  // v0.60.171 (Phase 3.5): обзор всех sketch'ей проекта и их связей
  const sketchRefsHost = document.getElementById('pr-detail-sketch-refs');
  if (sketchRefsHost) renderProjectSketchRefs(p, sketchRefsHost);

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

  // v0.60.289 (Этап 1.3 Phase 47): team-tab content — visibility 3 уровня.
  // Members management (invite/remove/roles) пока через стандартный «Поделиться»
  // в Конструкторе схем (Этап 1.4 интегрирует здесь).
  if (teamHost) {
    // v0.60.297: getProject из shared/project-storage.js читает local LS —
    // данные Пользователя, он ИХ владелец. См. комментарий в _renderImplStagesBlock.
    // Storage.isCloud показывается отдельно (для UI cloud-only фич — visibility, invites).
    const isCloud = !!(window.Storage && window.Storage.isCloud);
    const role = p._role || 'owner';
    const isOwner = role === 'owner';
    const vis = p.visibility || 'private';
    const VIS_OPTS = [
      { id: 'private', icon: '🔒', label: 'Private', desc: 'Видят только участники проекта (members + owner). Default.' },
      { id: 'discoverable', icon: '👁', label: 'Discoverable', desc: 'Виден в общем каталоге проектов; для входа нужен запрос доступа (owner одобряет).' },
      { id: 'public', icon: '🌐', label: 'Public', desc: 'Виден всем; любой залогиненный может присоединиться без подтверждения.' },
    ];
    // v0.60.294 (по архитектурному уточнению Пользователя 2026-05-06: «здесь о
    // каком конструкторе идет речь? если о конструкторе схем, то подход не
    // правильный. Мы в проект добавляем участников и назначаем им роли, и
    // тогда электрик может открыть или создать схему в конструкторе»):
    // Полное управление участниками прямо в карточке проекта. Роли —
    // дисциплинарные (admin / gip / electrician / mechanic / technologist /
    // scs / viewer). После назначения участник открывает СВОЙ модуль
    // (Конструктор схем для электрика, Технолог объекта для технолога и т.п.).
    const ROLE_OPTS = [
      { id: 'admin',        icon: '⚙', label: 'Admin (полный доступ)', desc: 'Может всё: настройки проекта, члены, все дисциплины' },
      { id: 'gip',          icon: '🧐', label: 'ГИП', desc: 'Главный инженер: согласование, проверка, координация дисциплин' },
      { id: 'electrician',  icon: '⚡', label: 'Электрик', desc: 'Конструктор электрических схем, BOM электрики' },
      { id: 'mechanic',     icon: '🔧', label: 'Механик', desc: 'Механика, гидравлика, ОВК (когда модуль появится)' },
      { id: 'technologist', icon: '🏗', label: 'Технолог', desc: 'Технолог объекта (концепция, варианты, рестрировки)' },
      { id: 'scs',          icon: '🔗', label: 'СКС', desc: 'СКС-design, межстоечные связи, кабель-журнал слаботочки' },
      { id: 'viewer',       icon: '👁', label: 'Viewer (только просмотр)', desc: 'Read-only во всех модулях' },
    ];
    const ROLE_LABEL = Object.fromEntries(ROLE_OPTS.map(r => [r.id, r.icon + ' ' + r.label]));
    const members = p.members || {};
    const memberRows = Object.entries(members);
    const ownerUid = p.ownerId;
    const accessRequests = Array.isArray(p._accessRequests) ? p._accessRequests : [];
    // v0.60.297: «Claim ownership» — для случая когда у проекта _role≠owner
    // (orphan, импорт из cloud, потеря metadata). Локально пользователь ВСЕГДА
    // владеет своим LS, так что claim делаем без подтверждений.
    const showClaim = !isOwner || (isCloud && !ownerUid) || p._importedFromCloud;

    teamHost.innerHTML = `
      ${showClaim ? `
        <div style="margin-bottom:18px;padding:12px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:5px">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <span style="font-size:18px">👑</span>
            <div style="flex:1">
              <div style="font-weight:600;color:#78350f;margin-bottom:3px">Стать владельцем проекта</div>
              <div style="font-size:12px;color:#78350f;line-height:1.5;margin-bottom:8px">
                Текущая роль: <b>${esc(role)}</b>${ownerUid ? ` · ownerId: <code>${esc(String(ownerUid).slice(0, 12))}</code>` : ' · ownerId не задан'}.
                ${p._importedFromCloud ? 'Проект восстановлен из облака без metadata; вернуть владение можно нажав кнопку.' : 'Если вы основной пользователь этого проекта — назначьте себя владельцем.'}
              </div>
              <button type="button" id="pr-team-claim-btn" style="padding:6px 14px;background:#d97706;color:#fff;border:0;border-radius:3px;cursor:pointer;font:inherit;font-size:13px;font-weight:500">👑 Сделать меня владельцем</button>
            </div>
          </div>
        </div>
      ` : ''}
      <div style="margin-bottom:22px">
        <h4 style="margin:0 0 10px;font-size:14px;color:#0f172a">🔐 Видимость проекта</h4>
        ${!isCloud
          ? `<p class="muted" style="font-size:12px;margin:0 0 8px">Доступно только в облачном режиме (Firebase). В локальном режиме все проекты — private.</p>`
          : ''
        }
        <div style="display:flex;flex-direction:column;gap:6px">
          ${VIS_OPTS.map(o => `
            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid ${o.id === vis ? '#0ea5e9' : '#cbd5e1'};border-radius:5px;cursor:${isOwner && isCloud ? 'pointer' : 'not-allowed'};background:${o.id === vis ? '#f0f9ff' : '#fff'};${!isOwner || !isCloud ? 'opacity:0.6' : ''}">
              <input type="radio" name="pr-vis" value="${esc(o.id)}"${o.id === vis ? ' checked' : ''}${(!isOwner || !isCloud) ? ' disabled' : ''} style="margin-top:3px">
              <div style="flex:1">
                <div style="font-weight:600">${o.icon} ${esc(o.label)}</div>
                <div class="muted" style="font-size:11.5px;color:#64748b;margin-top:2px">${esc(o.desc)}</div>
              </div>
            </label>
          `).join('')}
        </div>
        ${!isOwner ? `<p class="muted" style="font-size:11px;margin:8px 0 0;color:#92400e">⚠ Только владелец проекта может менять видимость. Текущая роль: <b>${esc(role)}</b>.</p>` : ''}
      </div>

      <div style="margin-bottom:18px">
        <h4 style="margin:0 0 10px;font-size:14px;color:#0f172a">👥 Команда проекта</h4>
        <p class="muted" style="font-size:12px;margin:0 0 12px;line-height:1.5">
          Owner / ГИП проекта добавляет участников по email и назначает дисциплинарную роль.
          После добавления участник открывает СВОЙ модуль (электрик → Конструктор схем,
          технолог → Технолог объекта, СКС → СКС-design и т.п.). Доступ контролируется через Firebase rules.
        </p>

        ${!isCloud
          ? `<div style="padding:10px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;font-size:12.5px;color:#78350f">
              ⚠ Команда — только в облачном режиме (Firebase). В local-mode проект работает single-user.
            </div>`
          : `
            <!-- Список participants -->
            <div style="margin-bottom:12px">
              <table style="width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;overflow:hidden">
                <thead style="background:#f8fafc">
                  <tr>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Email / UID</th>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569;width:240px">Роль</th>
                    <th style="text-align:right;padding:8px 10px;border-bottom:1px solid #cbd5e1;width:80px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${ownerUid
                    ? `<tr>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">⭐ <b>${esc(p.ownerEmail || ownerUid.slice(0, 12))}</b> <span class="muted" style="font-size:11px">(владелец)</span></td>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">⚙ Admin (всегда)</td>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">—</td>
                      </tr>`
                    : ''
                  }
                  ${memberRows.length > 0
                    ? memberRows.map(([uid, m]) => `<tr>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">${esc(m.email || uid.slice(0, 12))}</td>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">
                          ${isOwner
                            ? `<select data-team-role="${esc(uid)}" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:3px;width:100%">
                                ${ROLE_OPTS.map(r => `<option value="${esc(r.id)}"${r.id === (m.role || 'viewer') ? ' selected' : ''}>${r.icon} ${esc(r.label)}</option>`).join('')}
                              </select>`
                            : esc(ROLE_LABEL[m.role] || m.role || 'viewer')
                          }
                        </td>
                        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right">
                          ${isOwner ? `<button type="button" data-team-remove="${esc(uid)}" style="padding:3px 10px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:3px;cursor:pointer">Удалить</button>` : ''}
                        </td>
                      </tr>`).join('')
                    : (!ownerUid ? `<tr><td colspan="3" style="padding:14px;text-align:center;color:#94a3b8;font-style:italic">Команда пуста</td></tr>` : '')
                  }
                </tbody>
              </table>
            </div>

            ${isOwner ? `
              <!-- Invite form -->
              <div style="padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:5px">
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
                  <label style="flex:1;min-width:200px">
                    <div style="font-size:11.5px;color:#475569;margin-bottom:3px">Email участника:</div>
                    <input type="email" id="pr-team-invite-email" placeholder="user@example.com" style="width:100%;padding:6px 8px;border:1px solid #0ea5e9;border-radius:3px;font:inherit;font-size:13px">
                  </label>
                  <label style="min-width:200px">
                    <div style="font-size:11.5px;color:#475569;margin-bottom:3px">Роль:</div>
                    <select id="pr-team-invite-role" style="width:100%;padding:6px 8px;border:1px solid #0ea5e9;border-radius:3px;font:inherit;font-size:13px">
                      ${ROLE_OPTS.map(r => `<option value="${esc(r.id)}"${r.id === 'electrician' ? ' selected' : ''}>${r.icon} ${esc(r.label)}</option>`).join('')}
                    </select>
                  </label>
                  <button type="button" id="pr-team-invite-btn" style="padding:6px 14px;background:#0ea5e9;color:#fff;border:0;border-radius:3px;cursor:pointer;font:inherit;font-size:13px;font-weight:500">+ Пригласить</button>
                </div>
              </div>
            ` : `<p class="muted" style="font-size:11px;margin:8px 0 0;color:#92400e">⚠ Только владелец может приглашать и менять роли.</p>`}

            ${accessRequests.length > 0 && isOwner ? `
              <!-- Pending access requests -->
              <div style="margin-top:14px;padding:12px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:5px">
                <div style="font-weight:600;color:#78350f;margin-bottom:8px">📩 Запросы доступа (${accessRequests.length})</div>
                ${accessRequests.map(r => `
                  <div style="display:flex;gap:8px;align-items:center;padding:6px 0;font-size:12.5px;border-top:1px solid #fde68a">
                    <span style="flex:1">${esc(r.email || r.uid)}</span>
                    <button type="button" data-team-approve="${esc(r.id)}" data-role="electrician" style="padding:3px 10px;font-size:11px;border:1px solid #15803d;background:#dcfce7;color:#15803d;border-radius:3px;cursor:pointer">✓ Принять</button>
                    <button type="button" data-team-deny="${esc(r.id)}" style="padding:3px 10px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:3px;cursor:pointer">✕ Отклонить</button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          `
        }
      </div>
    `;
    // v0.60.297: «Claim ownership» button.
    const claimBtn = teamHost.querySelector('#pr-team-claim-btn');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        // В local LS просто выставляем _role:'owner' и ownerId:'local' (если пусто).
        // Для cloud orphan-проектов меняем только локальную копию (Firebase rules
        // не позволят писать чужой проект, но локально пользователь работает
        // с LS-копией через shared/project-storage.js).
        const patch = { _role: 'owner' };
        if (!p.ownerId) patch.ownerId = 'local';
        try {
          updateProject(p.id, patch);
          prToast('✔ Вы теперь владелец проекта', 'ok');
          render();
        } catch (e) {
          prToast('Ошибка: ' + (e.message || e), 'err');
        }
      });
    }

    // Wire visibility radio change handler.
    if (isOwner && isCloud) {
      teamHost.querySelectorAll('input[name="pr-vis"]').forEach(radio => {
        radio.addEventListener('change', async () => {
          const v = radio.value;
          if (v === p.visibility) return;
          try {
            await window.Storage.setVisibility(p.id, v);
            p.visibility = v;
            prToast(`✔ Видимость: ${VIS_OPTS.find(o => o.id === v)?.label || v}`, 'ok');
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
    }
    // v0.60.294: invite / remove / role-change / approve / deny handlers.
    if (isOwner && isCloud) {
      const inviteBtn = teamHost.querySelector('#pr-team-invite-btn');
      if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
          const email = (teamHost.querySelector('#pr-team-invite-email')?.value || '').trim().toLowerCase();
          const role = teamHost.querySelector('#pr-team-invite-role')?.value || 'electrician';
          if (!email) { prToast('Введите email', 'warn'); return; }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { prToast('Неверный формат email', 'err'); return; }
          try {
            await window.Storage.shareProject(p.id, email, role);
            prToast(`✔ Приглашён: ${email} (${ROLE_LABEL[role] || role})`, 'ok');
            // Reload project meta to get updated members.
            const fresh = await window.Storage.getProject(p.id);
            if (fresh) Object.assign(p, fresh);
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      }
      teamHost.querySelectorAll('[data-team-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.getAttribute('data-team-remove');
          if (!await prConfirm('Удалить участника?', 'Участник потеряет доступ к проекту во всех модулях.')) return;
          try {
            await window.Storage.unshareMember(p.id, uid);
            prToast('✔ Участник удалён', 'ok');
            const fresh = await window.Storage.getProject(p.id);
            if (fresh) Object.assign(p, fresh);
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
      teamHost.querySelectorAll('[data-team-role]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const uid = sel.getAttribute('data-team-role');
          const newRole = sel.value;
          // Существующий API shareProject принимает (pid, email, role) — для смены роли
          // нужен email. Достаём из members[uid].email.
          const m = (p.members || {})[uid];
          if (!m || !m.email) { prToast('Email участника не найден — переоткройте проект', 'warn'); return; }
          try {
            await window.Storage.shareProject(p.id, m.email, newRole);
            prToast(`✔ Роль изменена: ${ROLE_LABEL[newRole] || newRole}`, 'ok');
            const fresh = await window.Storage.getProject(p.id);
            if (fresh) Object.assign(p, fresh);
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
      teamHost.querySelectorAll('[data-team-approve]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId = btn.getAttribute('data-team-approve');
          const role = btn.getAttribute('data-role') || 'electrician';
          try {
            await window.Storage.approveRequest(reqId, role);
            prToast('✔ Доступ выдан', 'ok');
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
      teamHost.querySelectorAll('[data-team-deny]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId = btn.getAttribute('data-team-deny');
          try {
            await window.Storage.denyRequest(reqId);
            prToast('Запрос отклонён', 'ok');
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
    }
  }

  // v0.60.292 (Этап 1.5.1 Phase 47): Cross-discipline сводка проекта.
  // Минимальный viable view: метрики из existing modules. Будущие подэтапы
  // (47.2.3-47.2.6): полный equipment list / validation / approval checklist.
  if (summaryHost) {
    // Фаза 2 (R2): cross-module чтение — через шов projectLoad (был _readJSON).
    const pid = p.id;
    // ⚡ Конструктор схем
    const scheme = projectLoad(pid, 'engine', 'scheme.v1', null);
    const schemeNodes = scheme?.nodes ? (Array.isArray(scheme.nodes) ? scheme.nodes.length : Object.keys(scheme.nodes).length) : 0;
    const schemeConns = scheme?.conns ? (Array.isArray(scheme.conns) ? scheme.conns.length : Object.keys(scheme.conns).length) : 0;
    // 🏗 Технолог объекта
    const twVariants = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
    const twActiveId = (() => { try { return projectLoad(pid, 'tech-workspace', 'activeVariantId.v1', ''); } catch { return null; } })();
    const twActive = Array.isArray(twVariants) ? twVariants.find(v => v.id === twActiveId) || twVariants[0] : null;
    const twRacks = twActive?.concept?.rackGroups ? twActive.concept.rackGroups.reduce((s, rg) => s + (Number(rg.count) || 0), 0) : 0;
    const twUps = twActive?.concept?.upsSystems ? twActive.concept.upsSystems.reduce((s, u) => s + (Number(u.count) || 0), 0) : 0;
    const twCool = twActive?.concept?.coolingUnits ? twActive.concept.coolingUnits.reduce((s, c) => s + (Number(c.count) || 0), 0) : 0;
    // 🔗 СКС
    const scsLinks = projectLoad(pid, 'scs-design', 'snapshot', null);
    const scsCount = scsLinks?.links ? (Array.isArray(scsLinks.links) ? scsLinks.links.length : 0) : 0;
    // Метаданные проекта
    const ok = p.objectKind || 'datacenter';
    const KIND_LABEL = { datacenter: '🏢 ЦОД', factory: '🏭 Завод', 'pump-station': '💧 Насосная', office: '🏢 Офис', custom: '✏ Свой' };
    const stages = _getImplStages(p);
    const stagesDone = stages.filter(s => s.status === 'done').length;
    const stagesActive = stages.filter(s => s.status === 'active').length;

    summaryHost.innerHTML = `
      <p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.6">
        Cross-discipline view проекта. Объединяет данные из <b>Конструктора схем</b>,
        <b>Технолога объекта</b>, <b>СКС-design</b> и других модулей. Read-mostly view для
        ГИП / Администратора проекта. Полная функциональность (валидация схем, проверка
        расчётов, согласование разделов) — Этапы 1.5.2-1.5.5 Phase 47.
      </p>

      <h4 style="margin:0 0 8px;font-size:13px;color:#0f172a">Метаданные проекта</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:18px">
        ${_summaryCard('🏷', 'Категория', KIND_LABEL[ok] || ok, '')}
        ${_summaryCard('🌍', 'Локация', p.location?.city || '<i>не задано</i>', p.location?.country || '')}
        ${_summaryCard('🎯', 'Этапы реализации', `${stagesDone} / ${stages.length} завершено`, stagesActive > 0 ? `${stagesActive} в работе` : '')}
        ${_summaryCard('🔐', 'Видимость', { private: '🔒 Private', discoverable: '👁 Discoverable', public: '🌐 Public', link: '🔗 Link' }[p.visibility || 'private'] || 'Private', '')}
      </div>

      <h4 style="margin:0 0 8px;font-size:13px;color:#0f172a">Дисциплины</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:18px">
        <div style="padding:14px 16px;background:#fff;border:1px solid #e0e7ee;border-left:4px solid #f59e0b;border-radius:6px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:18px">⚡</span>
            <h5 style="margin:0;font-size:13.5px;color:#92400e">Конструктор электрических схем</h5>
            <a href="../index.html?project=${esc(pid)}" target="_blank" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #f59e0b;background:#fef3c7;color:#92400e;border-radius:3px;text-decoration:none">↪ открыть</a>
          </div>
          ${schemeNodes > 0 ? `
            <div style="font-size:12px;color:#475569;line-height:1.7">
              <b>${schemeNodes}</b> узлов · <b>${schemeConns}</b> кабелей
            </div>
          ` : '<div style="font-size:12px;color:#94a3b8;font-style:italic">Схема не создана</div>'}
        </div>

        <div style="padding:14px 16px;background:#fff;border:1px solid #e0e7ee;border-left:4px solid #7c3aed;border-radius:6px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:18px">🏗</span>
            <h5 style="margin:0;font-size:13.5px;color:#5b21b6">Технолог объекта</h5>
            <a href="../tech-workspace/?project=${esc(pid)}" target="_blank" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;border-radius:3px;text-decoration:none">↪ открыть</a>
          </div>
          ${Array.isArray(twVariants) && twVariants.length > 0 ? `
            <div style="font-size:12px;color:#475569;line-height:1.7">
              <b>${twVariants.length}</b> вариант(ов) концепции · активный: <b>${esc(twActive?.name || '?')}</b>
              <br>${twRacks} стоек · ${twUps} ИБП · ${twCool} кондиционеров
            </div>
          ` : '<div style="font-size:12px;color:#94a3b8;font-style:italic">Концепция не создана</div>'}
        </div>

        <div style="padding:14px 16px;background:#fff;border:1px solid #e0e7ee;border-left:4px solid #0891b2;border-radius:6px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:18px">🔗</span>
            <h5 style="margin:0;font-size:13.5px;color:#155e75">СКС-design</h5>
            <a href="../scs-design/?project=${esc(pid)}" target="_blank" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #0891b2;background:#cffafe;color:#155e75;border-radius:3px;text-decoration:none">↪ открыть</a>
          </div>
          ${scsCount > 0 ? `
            <div style="font-size:12px;color:#475569;line-height:1.7"><b>${scsCount}</b> межстоечных связей</div>
          ` : '<div style="font-size:12px;color:#94a3b8;font-style:italic">СКС-связи не заданы</div>'}
        </div>
      </div>

      <h4 style="margin:0 0 8px;font-size:13px;color:#0f172a">🚧 В разработке (Этап 1.5)</h4>
      <div style="padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;color:#78350f;font-size:12.5px;line-height:1.7">
        Будущие подэтапы:<br>
        • <b>1.5.2</b>: cross-discipline equipment list (объединяет позиции из Конструктора и Технолога; все возможные порты по системам)<br>
        • <b>1.5.3</b>: проверка корректности схем (висячие связи, перегруз, дубли портов)<br>
        • <b>1.5.4</b>: проверка расчётов (ΔU, токи, селективность; cooling vs IT; cross-discipline баланс)<br>
        • <b>1.5.5</b>: согласование разделов (✓ checklist с timestamp + подписью + историей ревизий)
      </div>
    `;
  }

  // X.4.2 (v0.60.580): членство узлов схемы в дисциплинах + расчётный
  // роутинг. Хост — проектный cross-discipline view (Конструктор не
  // трогаем). Read-modify-write engine-scheme через projectKey: меняем
  // ТОЛЬКО node.disciplines, остальное сохраняем как было.
  if (summaryHost) {
    const pid = p.id;
    let schemeRaw = null;
    try { schemeRaw = projectLoad(pid, 'engine', 'scheme.v1', null); }
    catch { schemeRaw = null; }
    let nodes = [];
    if (schemeRaw && schemeRaw.nodes) {
      nodes = Array.isArray(schemeRaw.nodes) ? schemeRaw.nodes : Object.values(schemeRaw.nodes);
    }
    const projDisc = (schemeRaw && schemeRaw.project && schemeRaw.project.discipline) || DEFAULT_DISCIPLINE;
    const meaningful = nodes.filter(n => n && n.type && n.type !== 'channel' && n.type !== 'zone');
    const choices = listDisciplines({ onlyReady: true }); // electrical + hydraulic/hvac/gas/suppression
    const CAP = 200;
    const shown = meaningful.slice(0, CAP);

    if (meaningful.length) {
      const projDLbl = (getDiscipline(projDisc) || getDiscipline(DEFAULT_DISCIPLINE));
      const rows = shown.map((n, i) => {
        const eff = nodeDisciplines(n, projDisc);
        const id = String(n.id || ('idx' + i));
        const tag = n.tag || n.id || '—';
        const nm = n.name ? ` · ${esc(n.name)}` : '';
        const boxes = choices.map(d => {
          const on = eff.includes(d.id);
          return `<label style="display:inline-flex;align-items:center;gap:3px;margin:0 8px 2px 0;font-size:11.5px;white-space:nowrap" title="${esc(d.label)} (${esc(d.units)})">
            <input type="checkbox" class="xd-disc-box" data-node="${esc(id)}" data-disc="${esc(d.id)}"${on ? ' checked' : ''}>
            ${d.icon} ${esc(d.label)}</label>`;
        }).join('');
        return `<tr style="border-top:1px solid #eef1f5">
          <td style="padding:5px 8px;font-size:12px;vertical-align:top;white-space:nowrap"><b>${esc(tag)}</b>${nm}<br><span class="muted" style="font-size:10.5px">${esc(n.type)}</span></td>
          <td style="padding:5px 8px">${boxes}</td>
        </tr>`;
      }).join('');

      const usedIds = new Set();
      for (const n of meaningful) nodeDisciplines(n, projDisc).forEach(x => usedIds.add(x));
      const routeRows = [...usedIds].map(idd => {
        const d = getDiscipline(idd);
        const spec = calcLibSpecifier(idd);
        const engine = spec
          ? `<code style="font-size:11px">${esc(spec)}</code>`
          : (idd === 'electrical'
            ? '<span class="muted" style="font-size:11px">CORE — js/calc (Конструктор)</span>'
            : '<span class="muted" style="font-size:11px">движок не готов</span>');
        return `<tr style="border-top:1px solid #eef1f5">
          <td style="padding:5px 8px;font-size:12px">${d ? d.icon + ' ' + esc(d.label) : esc(idd)}</td>
          <td style="padding:5px 8px;font-size:12px">${d ? esc(d.units) : ''}</td>
          <td style="padding:5px 8px">${engine}</td></tr>`;
      }).join('');

      summaryHost.insertAdjacentHTML('beforeend', `
        <h4 style="margin:18px 0 8px;font-size:13px;color:#0f172a">🧩 Дисциплины узлов схемы
          <span class="help-icon" title="X.4.2: узел может участвовать в нескольких инженерных дисциплинах (cross-discipline). По умолчанию узел принадлежит дисциплине проекта (${esc(projDLbl ? projDLbl.label : projDisc)}). Здесь, в проектном контексте, ГИП назначает членство — Конструктор схем остаётся чистой электрикой. Поле node.disciplines[] сохраняется в схему и переживает перезагрузку." tabindex="0">?</span>
        </h4>
        <p class="muted" style="font-size:11.5px;margin:0 0 8px;line-height:1.6">
          Узлов: <b>${meaningful.length}</b>${meaningful.length > CAP ? ` (показаны первые ${CAP})` : ''}.
          Пусто = принадлежит дисциплине проекта (<b>${esc(projDLbl ? projDLbl.label : projDisc)}</b>).
          Расчётный движок дисциплины — таблица «Роутинг» ниже.
        </p>
        <div style="overflow:auto;border:1px solid #e0e7ee;border-radius:6px;max-height:340px">
          <table style="width:100%;border-collapse:collapse;background:#fff">
            <thead><tr style="background:#f8fafc;position:sticky;top:0">
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#475569">Узел</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#475569">Членство в дисциплинах</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin:8px 0 18px">
          <button id="xd-disc-save" style="font-size:12px;padding:6px 14px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:4px;cursor:pointer">💾 Сохранить членство</button>
          <span id="xd-disc-status" class="muted" style="font-size:11.5px"></span>
        </div>
        <h4 style="margin:0 0 8px;font-size:13px;color:#0f172a">🔀 Расчётный роутинг по дисциплинам</h4>
        <div style="overflow:auto;border:1px solid #e0e7ee;border-radius:6px;margin-bottom:18px">
          <table style="width:100%;border-collapse:collapse;background:#fff">
            <thead><tr style="background:#f8fafc">
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#475569">Дисциплина</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#475569">Базовые величины</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#475569">Расчётный движок</th>
            </tr></thead>
            <tbody>${routeRows}</tbody>
          </table>
        </div>
      `);

      const saveBtn = summaryHost.querySelector('#xd-disc-save');
      const statusEl = summaryHost.querySelector('#xd-disc-status');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const setStatus = (m, ok) => { if (statusEl) { statusEl.textContent = m; statusEl.style.color = ok ? '#166534' : '#b91c1c'; } };
        let fresh = null;
        try { fresh = projectLoad(pid, 'engine', 'scheme.v1', null); }
        catch { fresh = null; }
        if (!fresh || !fresh.nodes) { setStatus('Схема не найдена или изменилась — обновите страницу.', false); return; }
        const isArr = Array.isArray(fresh.nodes);
        const byId = new Map();
        (isArr ? fresh.nodes : Object.values(fresh.nodes)).forEach(nd => { if (nd && nd.id != null) byId.set(String(nd.id), nd); });
        const sel = new Map(); // nodeId → Set(discId)
        summaryHost.querySelectorAll('.xd-disc-box').forEach(cb => {
          const nid = cb.getAttribute('data-node');
          if (!sel.has(nid)) sel.set(nid, new Set());
          if (cb.checked) sel.get(nid).add(cb.getAttribute('data-disc'));
        });
        let changed = 0;
        for (const [nid, picked] of sel) {
          const nd = byId.get(nid);
          if (!nd) continue;
          // Каноничный порядок = порядок choices.
          const ordered = choices.map(d => d.id).filter(x => picked.has(x));
          const isJustProject = ordered.length === 1 && ordered[0] === projDisc;
          if (ordered.length === 0 || isJustProject) {
            if (nd.disciplines !== undefined) { delete nd.disciplines; changed++; }
          } else {
            const prev = Array.isArray(nd.disciplines) ? nd.disciplines.join(',') : '';
            if (prev !== ordered.join(',')) { nd.disciplines = ordered; changed++; }
          }
        }
        if (!changed) { setStatus('Изменений нет.', true); return; }
        try {
          localStorage.setItem(projectKey(pid, 'engine', 'scheme.v1'), JSON.stringify(fresh));
          setStatus(`✓ Сохранено: затронуто узлов — ${changed}. Применится при следующей загрузке Конструктора.`, true);
        } catch (e) {
          setStatus('Ошибка записи в хранилище: ' + (e && e.message || e), false);
        }
      });

      // ── X.4.4-producer Increment B1 (v0.60.582): расчёт по дисциплинам ──
      // Узел с не-электрической ready-дисциплиной → авто-форма из
      // META.inputs выбранной методики → run() → результат + сохранение
      // node.disciplineParams (round-trip бесплатный, stripRuntime).
      const calcNodes = meaningful.filter(n => {
        const eff = nodeDisciplines(n, projDisc);
        return eff.some(id => id !== 'electrical' && calcLibSpecifier(id));
      });
      if (calcNodes.length) {
        const libCache = new Map(); // spec → module
        const loadLib = async (spec) => {
          if (libCache.has(spec)) return libCache.get(spec);
          const url = new URL('../../lib/' + spec, location.href).href;
          const m = await import(url);
          libCache.set(spec, m);
          return m;
        };
        const nodeOpts = calcNodes.map(n =>
          `<option value="${esc(String(n.id))}">${esc(n.tag || n.id)}${n.name ? ' · ' + esc(n.name) : ''} (${esc(n.type)})</option>`).join('');
        summaryHost.insertAdjacentHTML('beforeend', `
          <h4 style="margin:0 0 8px;font-size:13px;color:#0f172a">🧮 Расчёт по дисциплинам
            <span class="help-icon" title="X.4.4: для узла, входящего в не-электрическую дисциплину, выберите методику lib/<id>-methods, заполните параметры (схема META.inputs) и выполните расчёт. Параметры сохраняются в node.disciplineParams и переживают перезагрузку Конструктора." tabindex="0">?</span>
          </h4>
          <div style="border:1px solid #e0e7ee;border-radius:6px;padding:12px;background:#fff;margin-bottom:18px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
              <label style="font-size:11.5px;color:#475569">Узел<br><select id="xdc-node" style="font-size:12px;padding:4px 6px;min-width:200px">${nodeOpts}</select></label>
              <label style="font-size:11.5px;color:#475569">Дисциплина<br><select id="xdc-disc" style="font-size:12px;padding:4px 6px;min-width:150px"></select></label>
              <label style="font-size:11.5px;color:#475569">Методика<br><select id="xdc-method" style="font-size:12px;padding:4px 6px;min-width:200px"></select></label>
            </div>
            <div id="xdc-form" style="display:flex;flex-wrap:wrap;gap:8px 14px;margin-bottom:10px"></div>
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
              <button id="xdc-run" style="font-size:12px;padding:6px 14px;border:1px solid #059669;background:#059669;color:#fff;border-radius:4px;cursor:pointer">▶ Рассчитать</button>
              <button id="xdc-save" style="font-size:12px;padding:6px 14px;border:1px solid #2563eb;background:#fff;color:#2563eb;border-radius:4px;cursor:pointer">💾 Сохранить параметры</button>
              <span id="xdc-status" class="muted" style="font-size:11.5px"></span>
            </div>
            <div id="xdc-result" style="font-size:12px"></div>
            <hr style="border:0;border-top:1px solid #eef1f5;margin:12px 0">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <button id="xdc-report" style="font-size:12px;padding:6px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:4px;cursor:pointer">📑 Сводный мультидисциплинарный отчёт</button>
              <span id="xdc-rep-status" class="muted" style="font-size:11.5px">Собирает сохранённые node.disciplineParams всех узлов → отчёт через модуль reports.</span>
            </div>
          </div>
        `);

        const elNode = summaryHost.querySelector('#xdc-node');
        const elDisc = summaryHost.querySelector('#xdc-disc');
        const elMethod = summaryHost.querySelector('#xdc-method');
        const elForm = summaryHost.querySelector('#xdc-form');
        const elRes = summaryHost.querySelector('#xdc-result');
        const elSt = summaryHost.querySelector('#xdc-status');
        const cStat = (m, ok) => { elSt.textContent = m; elSt.style.color = ok ? '#166534' : '#b91c1c'; };
        const nodeById = id => calcNodes.find(n => String(n.id) === String(id));
        const readScheme = () => { try { return projectLoad(pid, 'engine', 'scheme.v1', null); } catch { return null; } };
        const savedParams = (nid, disc, mid) => {
          const fr = readScheme(); if (!fr || !fr.nodes) return null;
          const arr = Array.isArray(fr.nodes) ? fr.nodes : Object.values(fr.nodes);
          const nd = arr.find(x => x && String(x.id) === String(nid));
          return nd && nd.disciplineParams && nd.disciplineParams[disc] && nd.disciplineParams[disc][mid] || null;
        };

        function fillDisc() {
          const n = nodeById(elNode.value);
          const eff = n ? nodeDisciplines(n, projDisc) : [];
          const ds = eff.filter(id => id !== 'electrical' && calcLibSpecifier(id));
          elDisc.innerHTML = ds.map(id => { const d = getDiscipline(id); return `<option value="${esc(id)}">${d ? d.icon + ' ' + esc(d.label) : esc(id)}</option>`; }).join('');
          fillMethods();
        }
        async function fillMethods() {
          elMethod.innerHTML = '<option>…</option>'; elForm.innerHTML = ''; elRes.innerHTML = '';
          const disc = elDisc.value; const spec = calcLibSpecifier(disc);
          if (!spec) { elMethod.innerHTML = ''; return; }
          try {
            const M = await loadLib(spec);
            elMethod.innerHTML = (M.METHOD_LIST || []).map(m => `<option value="${esc(m.id)}">${esc(m.label || m.id)}</option>`).join('');
            buildForm();
          } catch (e) { cStat('Не удалось загрузить движок: ' + (e && e.message || e), false); }
        }
        async function buildForm() {
          elForm.innerHTML = ''; elRes.innerHTML = '';
          const disc = elDisc.value, mid = elMethod.value, spec = calcLibSpecifier(disc);
          if (!spec || !mid) return;
          const M = await loadLib(spec);
          const meta = (M.METHOD_LIST || []).find(m => m.id === mid);
          const fields = meta && Array.isArray(meta.inputs) ? meta.inputs : [];
          const prev = savedParams(elNode.value, disc, mid) || {};
          elForm.innerHTML = fields.map(f => {
            const v = (prev[f.key] != null) ? prev[f.key] : f.default;
            const lbl = `${esc(f.label)}${f.unit ? ' <span class="muted">(' + esc(f.unit) + ')</span>' : ''}${f.required ? ' *' : ''}`;
            if (f.type === 'select') {
              const opts = (f.options || []).map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
              return `<label style="font-size:11.5px;color:#475569">${lbl}<br><select data-fk="${esc(f.key)}" style="font-size:12px;padding:3px 6px;min-width:140px">${opts}</select></label>`;
            }
            return `<label style="font-size:11.5px;color:#475569">${lbl}<br><input type="number" step="any" data-fk="${esc(f.key)}" value="${esc(String(v))}" style="font-size:12px;padding:3px 6px;width:120px"></label>`;
          }).join('') || '<span class="muted" style="font-size:11.5px">У методики нет описанных входов.</span>';
        }
        const gather = () => {
          const o = {};
          elForm.querySelectorAll('[data-fk]').forEach(el => {
            const k = el.getAttribute('data-fk');
            o[k] = (el.tagName === 'SELECT') ? el.value
              : (el.value === '' ? '' : Number(el.value));
          });
          return o;
        };

        elNode.addEventListener('change', fillDisc);
        elDisc.addEventListener('change', fillMethods);
        elMethod.addEventListener('change', buildForm);

        summaryHost.querySelector('#xdc-run').addEventListener('click', async () => {
          const disc = elDisc.value, mid = elMethod.value, spec = calcLibSpecifier(disc);
          if (!spec || !mid) { cStat('Выберите дисциплину и методику.', false); return; }
          try {
            const M = await loadLib(spec);
            const r = M.run(mid, gather());
            const rows = Object.entries(r).filter(([k, v]) =>
              k !== 'method' && k !== 'inputs' && k !== 'steps' &&
              (typeof v === 'number' || typeof v === 'string'))
              .map(([k, v]) => `<tr><td style="padding:3px 8px;color:#475569">${esc(k)}</td><td style="padding:3px 8px"><b>${typeof v === 'number' ? (Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4) : esc(String(v))}</b></td></tr>`).join('');
            const steps = Array.isArray(r.steps) ? `<ol style="margin:6px 0 0 18px;font-size:11.5px;color:#475569">${r.steps.map(s => `<li>${esc(String(s))}</li>`).join('')}</ol>` : '';
            elRes.innerHTML = `<div style="margin-top:6px"><table style="border-collapse:collapse;background:#f8fafc;border:1px solid #e0e7ee;border-radius:4px">${rows}</table>${steps}</div>`;
            cStat('✓ Рассчитано.', true);
          } catch (e) { cStat('Ошибка расчёта: ' + (e && e.message || e), false); }
        });

        summaryHost.querySelector('#xdc-save').addEventListener('click', () => {
          const nid = elNode.value, disc = elDisc.value, mid = elMethod.value;
          if (!disc || !mid) { cStat('Нечего сохранять.', false); return; }
          const fr = readScheme();
          if (!fr || !fr.nodes) { cStat('Схема не найдена — обновите страницу.', false); return; }
          const isArr = Array.isArray(fr.nodes);
          const arr = isArr ? fr.nodes : Object.values(fr.nodes);
          const nd = arr.find(x => x && String(x.id) === String(nid));
          if (!nd) { cStat('Узел не найден в схеме.', false); return; }
          if (!nd.disciplineParams || typeof nd.disciplineParams !== 'object') nd.disciplineParams = {};
          if (!nd.disciplineParams[disc] || typeof nd.disciplineParams[disc] !== 'object') nd.disciplineParams[disc] = {};
          nd.disciplineParams[disc][mid] = gather();
          try {
            localStorage.setItem(projectKey(pid, 'engine', 'scheme.v1'), JSON.stringify(fr));
            cStat('✓ Параметры сохранены в узел (применятся при загрузке Конструктора).', true);
          } catch (e) { cStat('Ошибка записи: ' + (e && e.message || e), false); }
        });

        const repSt = (m, ok) => { const e = summaryHost.querySelector('#xdc-rep-status'); if (e) { e.textContent = m; e.style.color = ok == null ? '' : (ok ? '#166534' : '#b91c1c'); } };
        summaryHost.querySelector('#xdc-report').addEventListener('click', async () => {
          repSt('Сбор результатов…', null);
          const fr = readScheme();
          if (!fr || !fr.nodes) { repSt('Схема не найдена — обновите страницу.', false); return; }
          const arr = Array.isArray(fr.nodes) ? fr.nodes : Object.values(fr.nodes);
          const sections = [];
          let errCount = 0;
          for (const nd of arr) {
            if (!nd || !nd.disciplineParams || typeof nd.disciplineParams !== 'object') continue;
            const tag = nd.tag || nd.id || '—';
            for (const [disc, methods] of Object.entries(nd.disciplineParams)) {
              const spec = calcLibSpecifier(disc);
              if (!spec || !methods || typeof methods !== 'object') continue;
              let M; try { M = await loadLib(spec); } catch { errCount++; continue; }
              for (const [mid, inputs] of Object.entries(methods)) {
                try {
                  const r = M.run(mid, inputs || {});
                  const meta = (M.METHOD_LIST || []).find(x => x.id === mid);
                  const rows = Object.entries(r).filter(([k, v]) =>
                    k !== 'method' && k !== 'inputs' && k !== 'steps' &&
                    (typeof v === 'number' || typeof v === 'string'))
                    .map(([k, v]) => [k, (typeof v === 'number' && !Number.isInteger(v)) ? Math.round(v * 1e4) / 1e4 : v]);
                  sections.push({
                    disciplineId: disc,
                    methodLabel: `${meta ? meta.label : mid} · узел ${tag}`,
                    rows, steps: Array.isArray(r.steps) ? r.steps : [],
                  });
                } catch { errCount++; }
              }
            }
          }
          if (!sections.length) { repSt('Нет сохранённых параметров расчёта (сохраните их кнопкой выше хотя бы по одному узлу).', false); return; }
          try {
            const blocks = buildCrossDisciplineReport({
              title: 'Сводный мультидисциплинарный расчёт',
              intro: 'Автоматически сформировано из сохранённых параметров узлов схемы (node.disciplineParams). Дисциплины и движки — реестр shared/disciplines.js.',
              project: { designation: p.designation || '', name: p.name || '' },
              sections,
            });
            repSt(`✓ Отчёт собран: секций — ${sections.length}${errCount ? `, пропущено с ошибкой — ${errCount}` : ''}. Выберите шаблон…`, true);
            const { composeReport } = await import('shared/report/compose.js');
            await composeReport({
              tags: ['projects', 'мультидисциплина', 'общее'],
              title: 'Сводный мультидисциплинарный расчёт',
              author: p.author || '',
              build: () => blocks,
            });
          } catch (e) {
            repSt('Ошибка формирования отчёта: ' + (e && e.message || e), false);
          }
        });

        fillDisc(); // инициализация цепочки селектов
      }
    }
  }

  // v0.60.293 (Этап 1.5.2 Phase 47): cross-discipline equipment list.
  // Объединяет оборудование из Конструктора схем (engine.scheme.v1) и
  // Технолога объекта (tech-workspace.variants.v1). Read-only view для
  // ГИП / Администратора — все позиции в одном месте, можно увидеть какие
  // позиции есть в одной дисциплине но отсутствуют в другой.
  if (equipmentHost) {
    // Фаза 2 (R2): cross-module чтение — через шов projectLoad (был _readJSON).
    const pid = p.id;
    const scheme = projectLoad(pid, 'engine', 'scheme.v1', null);
    const twVariants = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
    const twActiveId = (() => { try { return projectLoad(pid, 'tech-workspace', 'activeVariantId.v1', ''); } catch { return null; } })();
    const twActive = Array.isArray(twVariants) ? twVariants.find(v => v.id === twActiveId) || twVariants[0] : null;

    // ── 1. Из Конструктора схем ──
    // scheme.nodes может быть Array или Object (ключ=id). Нормализуем.
    let schemeNodes = [];
    if (scheme?.nodes) {
      schemeNodes = Array.isArray(scheme.nodes) ? scheme.nodes : Object.values(scheme.nodes);
    }
    const NODE_TYPE_LABEL = {
      source: '⚡ Источник', generator: '🔋 Генератор', ups: '🔌 ИБП',
      panel: '🗂 Щит', 'consumer-container': '📦 Группа', consumer: '💡 Потребитель',
      'junction-box': '📦 Клеммная', channel: '🔗 Канал', zone: '🏢 Зона',
    };
    const constructorItems = schemeNodes
      .filter(n => n && n.type && n.type !== 'channel' && n.type !== 'zone')
      .map(n => {
        const tag = n.tag || n.id || '';
        const name = n.name || '';
        const typeLbl = NODE_TYPE_LABEL[n.type] || n.type;
        const specs = [];
        if (n.capacityKw) specs.push(`${n.capacityKw} кВт`);
        if (n.snomKva) specs.push(`${n.snomKva} кВА`);
        if (n.demandKw) specs.push(`${n.demandKw} кВт`);
        if (n.count && n.count > 1) specs.push(`×${n.count}`);
        if (n.capacityA) specs.push(`In=${n.capacityA} А`);
        return { tag, name, type: n.type, typeLbl, specs: specs.join(' · ') };
      })
      .sort((a, b) => (a.tag || '').localeCompare(b.tag || '', undefined, { numeric: true }));

    // ── 2. Из Технолога объекта (active variant) ──
    const twItems = [];
    if (twActive?.concept) {
      const c = twActive.concept;
      for (const rg of (c.rackGroups || [])) {
        if (!rg.count) continue;
        twItems.push({
          tag: rg.tagPrefix || rg.name || 'SR',
          name: rg.name || '',
          type: 'rack-group',
          typeLbl: '🗄 Стойка',
          qty: rg.count,
          specs: `${rg.kwPerRack || 0} кВт/стойку · ${rg.profile || ''}`,
          modelRef: rg.modelRef ? `${rg.modelRef.manufacturer || ''} ${rg.modelRef.model || ''}`.trim() : null,
        });
      }
      for (const us of (c.upsSystems || [])) {
        if (!us.count) continue;
        twItems.push({
          tag: us.tagPrefix || us.name || 'UPS',
          name: us.name || '',
          type: 'ups-system',
          typeLbl: '🔌 ИБП-система',
          qty: us.count,
          specs: `${us.ratedKva || 0} кВА · ${us.purpose || ''} · ${us.redundancy || ''}`,
          modelRef: us.modelRef ? `${us.modelRef.manufacturer || ''} ${us.modelRef.model || ''}`.trim() : null,
        });
      }
      for (const cu of (c.coolingUnits || [])) {
        if (!cu.count) continue;
        twItems.push({
          tag: cu.tagPrefix || cu.name || 'AC',
          name: cu.name || '',
          type: 'cooling-unit',
          typeLbl: '❄ Кондиционер',
          qty: cu.count,
          specs: `${cu.kwPerUnit || 0} кВт холода · ${cu.type || ''} · ${cu.redundancy || ''}`,
          modelRef: cu.modelRef ? `${cu.modelRef.manufacturer || ''} ${cu.modelRef.model || ''}`.trim() : null,
        });
      }
      if (c.feed?.tp?.needed) {
        twItems.push({
          tag: 'TP',
          name: 'Трансформатор подстанции',
          type: 'tp',
          typeLbl: '⚡ ТП',
          qty: c.feed.tp.redundancy === '2' || c.feed.tp.redundancy === '2-avr' ? 2 : 1,
          specs: `${c.feed.tp.kva || 0} кВА · ${c.feed.tp.redundancy || ''}`,
          modelRef: c.feed.tp.modelRef ? `${c.feed.tp.modelRef.manufacturer || ''} ${c.feed.tp.modelRef.model || ''}`.trim() : null,
        });
      }
      if (c.feed?.dgu?.needed) {
        twItems.push({
          tag: 'GE',
          name: 'Дизельный генератор',
          type: 'dgu',
          typeLbl: '🔋 ДГУ',
          qty: c.feed.dgu.redundancy === '2N' ? 2 : (c.feed.dgu.redundancy === 'N+1' ? 2 : 1),
          specs: `${c.feed.dgu.kw || 0} кВт · ${c.feed.dgu.mode || ''}`,
          modelRef: c.feed.dgu.modelRef ? `${c.feed.dgu.modelRef.manufacturer || ''} ${c.feed.dgu.modelRef.model || ''}`.trim() : null,
        });
      }
    }

    const totalConstructor = constructorItems.length;
    const totalTw = twItems.length;
    const tableHtml = (items, sourceLabel, sourceColor) => {
      if (!items.length) return `<p class="muted" style="font-size:12px;font-style:italic">Нет позиций.</p>`;
      return `<table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <thead style="background:#f8fafc">
          <tr>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Tag</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Имя</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Тип</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Кол-во</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Характеристики</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #cbd5e1;font-weight:600;color:#475569">Модель</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">${esc(it.tag || '—')}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">${esc(it.name || '')}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:${sourceColor}">${esc(it.typeLbl || it.type || '')}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right">${it.qty || 1}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:11.5px">${esc(it.specs || '')}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:${it.modelRef ? '#15803d' : '#94a3b8'};font-size:11.5px">${it.modelRef ? esc(it.modelRef) : '<i>не привязана</i>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    };

    // ── 3. Cross-reference: общие теги ──
    const tagsConstr = new Set(constructorItems.map(it => (it.tag || '').toUpperCase()).filter(Boolean));
    const tagsTw = new Set(twItems.map(it => (it.tag || '').toUpperCase()).filter(Boolean));
    const sharedTags = [...tagsConstr].filter(t => tagsTw.has(t));

    equipmentHost.innerHTML = `
      <p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.6">
        Объединённый перечень оборудования проекта из <b>Конструктора схем</b> (детальная электрическая модель)
        и <b>Технолога объекта</b> (концепция со счётчиками). Read-only view для ГИП / Администратора.
        Привязка модели (выбранный артикул из каталога) показана отдельной колонкой.
      </p>

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:12.5px">
        <span><b>${totalConstructor}</b> позиций в Конструкторе</span>
        <span><b>${totalTw}</b> позиций в Технологе</span>
        ${sharedTags.length > 0 ? `<span style="color:#15803d">✓ <b>${sharedTags.length}</b> совпадений по тегу</span>` : ''}
      </div>

      <h4 style="margin:14px 0 8px;font-size:13px;color:#92400e">⚡ Из Конструктора электрических схем (${totalConstructor})</h4>
      ${tableHtml(constructorItems, 'Конструктор', '#92400e')}

      <h4 style="margin:18px 0 8px;font-size:13px;color:#5b21b6">🏗 Из Технолога объекта · вариант: «${esc(twActive?.name || '?')}» (${totalTw})</h4>
      ${tableHtml(twItems, 'Технолог', '#5b21b6')}

      ${sharedTags.length > 0 ? `
        <h4 style="margin:18px 0 8px;font-size:13px;color:#15803d">🔗 Cross-reference: совпадение по тегу (${sharedTags.length})</h4>
        <p class="muted" style="font-size:11.5px;margin:0 0 8px">Позиции с одинаковым тегом в обеих дисциплинах. Best-effort-matching — реальное соответствие может требовать ручной проверки.</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${sharedTags.map(t => `<span style="padding:3px 10px;background:#dcfce7;border:1px solid #86efac;border-radius:3px;font-size:11.5px;color:#15803d;font-weight:600">${esc(t)}</span>`).join('')}
        </div>
      ` : ''}

      <div style="margin-top:18px;padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;color:#78350f;font-size:12.5px;line-height:1.7">
        🚧 <b>В разработке (Phase 47.2.3+)</b>: автоматическое сведение позиций между дисциплинами
        (детект «один логический рак ID#42 в TW = consumer-container в Конструкторе»),
        порты по системам (⚡ электрика / 🌊 трубы / 💨 ОВК), пересечение с СКС-связями.
      </div>
    `;
  }

  // v0.60.296 (Этап 1.5.3 Phase 47): Проверки корректности схем + cross-discipline.
  // Минимальный viable view: статические проверки на основе сохранённой схемы
  // (без полного recalc). Полная валидация (с расчётом нагрузок, ΔU, селективности)
  // — в Конструкторе схем через Ctrl+Shift+I (Project Issues modal).
  if (validationHost) {
    // Фаза 2 (R2): cross-module чтение — через шов projectLoad (был _readJSON).
    const pid = p.id;
    const scheme = projectLoad(pid, 'engine', 'scheme.v1', null);
    const twVariants = projectLoad(pid, 'tech-workspace', 'variants.v1', []);
    const twActiveId = (() => { try { return projectLoad(pid, 'tech-workspace', 'activeVariantId.v1', ''); } catch { return null; } })();
    const twActive = Array.isArray(twVariants) ? twVariants.find(v => v.id === twActiveId) || twVariants[0] : null;

    const issues = []; // { level: 'error'|'warn'|'info', area, msg, hint }

    // ── 1. Конструктор схем — статические проверки ──
    let schemeNodes = [];
    let schemeConns = [];
    if (scheme?.nodes) {
      schemeNodes = Array.isArray(scheme.nodes) ? scheme.nodes : Object.values(scheme.nodes);
    }
    if (scheme?.conns) {
      schemeConns = Array.isArray(scheme.conns) ? scheme.conns : Object.values(scheme.conns);
    }
    if (schemeNodes.length === 0) {
      issues.push({ level: 'info', area: '⚡ Конструктор', msg: 'Схема пустая', hint: 'Откройте Конструктор схем и создайте принципиальную схему.' });
    } else {
      // Дубли тегов
      const tagMap = new Map();
      for (const n of schemeNodes) {
        if (!n || !n.tag) continue;
        if (n.type === 'zone' || n.type === 'channel') continue;
        const tag = String(n.tag);
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag).push(n);
      }
      for (const [tag, nodes] of tagMap) {
        if (nodes.length > 1) {
          issues.push({ level: 'error', area: '⚡ Конструктор', msg: `Дубль тега: ${tag} × ${nodes.length}`, hint: 'Тег должен быть уникален. Откройте Конструктор → Ctrl+F для поиска.' });
        }
      }
      // Orphan consumers — без incoming conn (если type='consumer' и нет parent в conn.to)
      const incomingMap = new Map();
      for (const c of schemeConns) {
        if (!c || !c.to?.nodeId) continue;
        if (!incomingMap.has(c.to.nodeId)) incomingMap.set(c.to.nodeId, 0);
        incomingMap.set(c.to.nodeId, incomingMap.get(c.to.nodeId) + 1);
      }
      let orphanConsumers = 0;
      for (const n of schemeNodes) {
        if (n.type !== 'consumer') continue;
        if (!incomingMap.has(n.id) || incomingMap.get(n.id) === 0) {
          orphanConsumers++;
        }
      }
      if (orphanConsumers > 0) {
        issues.push({ level: 'warn', area: '⚡ Конструктор', msg: `Orphan-потребителей: ${orphanConsumers}`, hint: 'Потребитель без питающего щита — проверьте что все consumer-узлы подключены.' });
      }
      // Sources count
      const sources = schemeNodes.filter(n => n.type === 'source' || n.type === 'generator');
      if (sources.length === 0) {
        issues.push({ level: 'error', area: '⚡ Конструктор', msg: 'Нет источника питания', hint: 'Добавьте Source (городская сеть / ТП / автономный) или Generator (ДГУ).' });
      }
    }

    // ── 2. Технолог объекта — статические проверки ──
    if (!twActive) {
      issues.push({ level: 'info', area: '🏗 Технолог', msg: 'Концепция не создана', hint: 'Откройте Технолог объекта и создайте вариант концепции.' });
    } else {
      const c = twActive.concept;
      if (!c) {
        issues.push({ level: 'error', area: '🏗 Технолог', msg: 'Активный вариант пустой (нет concept)', hint: 'Возможно, миграция данных. Откройте TW и пересоздайте вариант.' });
      } else {
        const racks = c.rackGroups?.reduce((s, rg) => s + (Number(rg.count) || 0), 0) || 0;
        const itKw = c.rackGroups?.reduce((s, rg) => s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0), 0) || 0;
        const upsKw = c.upsSystems?.filter(u => u.purpose === 'it' || u.purpose === 'mixed').reduce((s, u) => s + (Number(u.count) || 0) * (Number(u.ratedKva) || 0) * 0.95, 0) || 0;
        const coolKw = c.coolingUnits?.reduce((s, cu) => s + (Number(cu.count) || 0) * (Number(cu.kwPerUnit) || 0), 0) || 0;
        if (racks > 0 && upsKw < itKw && itKw > 0) {
          issues.push({ level: 'warn', area: '🏗 Технолог', msg: `ИБП IT недостаточен`, hint: `IT-нагрузка ${itKw.toFixed(1)} кВт > доступной ИБП ${upsKw.toFixed(1)} кВт. Добавьте/увеличьте ИБП-систему purpose='it'.` });
        }
        if (racks > 0 && coolKw < itKw && itKw > 0) {
          issues.push({ level: 'warn', area: '🏗 Технолог', msg: 'Холод недостаточен', hint: `IT-нагрузка ${itKw.toFixed(1)} кВт > холода ${coolKw.toFixed(1)} кВт. Добавьте кондиционеры или увеличьте мощность.` });
        }
        // Не привязаны модели — info
        const noModels = (c.rackGroups || []).filter(rg => !rg.modelRef && rg.count > 0).length
                       + (c.upsSystems || []).filter(us => !us.modelRef && us.count > 0).length
                       + (c.coolingUnits || []).filter(cu => !cu.modelRef && cu.count > 0).length;
        if (noModels > 0) {
          issues.push({ level: 'info', area: '🏗 Технолог', msg: `${noModels} позиций без модели из каталога`, hint: 'На стадии концепции — нормально. На РД нужно привязать конкретные артикулы (📦 Привязать модель).' });
        }
      }
    }

    // ── 3. Cross-discipline — общие проверки ──
    if (schemeNodes.length > 0 && twActive?.concept) {
      const tagsConstr = new Set(schemeNodes.map(n => (n.tag || '').toUpperCase()).filter(Boolean));
      const twRackTags = new Set();
      for (const rg of (twActive.concept.rackGroups || [])) {
        if (rg.tagPrefix) twRackTags.add(String(rg.tagPrefix).toUpperCase());
      }
      const matchedTags = [...twRackTags].filter(t => tagsConstr.has(t)).length;
      if (twRackTags.size > 0 && matchedTags === 0) {
        issues.push({ level: 'warn', area: '🔗 Cross', msg: 'Теги стоек TW и Конструктора не пересекаются', hint: 'Возможно, стойки в TW и в Конструкторе — разные сущности. Если они должны быть согласованы — приведите тэги в соответствие.' });
      }
    }

    // ── 4. Cross-discipline баланс мощностей (Этап 1.5.4) ──
    // По плану архитектуры 2026-05-06 + ROADMAP Phase 47.2.9.
    // Проверки: TW vs Конструктор IT-нагрузка, общая капасити источника,
    // PUE consistency, тепловой баланс (cooling ≥ IT + UPS losses).
    if (schemeNodes.length > 0 && twActive?.concept) {
      const c = twActive.concept;
      // Constructor IT load — суммируем consumer demandKw с system='it' или
      // подключённые downstream от UPS-узлов.
      let constrItKw = 0;
      let constrTotalKw = 0;
      for (const n of schemeNodes) {
        if (n.type !== 'consumer') continue;
        const kw = (Number(n.demandKw) || 0) * (Number(n.count) || 1);
        constrTotalKw += kw;
        const sys = Array.isArray(n.systems) ? n.systems : [];
        if (sys.includes('it') || n.consumerSubtype === 'rack' || n.consumerSubtype === 'it_load') {
          constrItKw += kw;
        }
      }
      // TW IT-нагрузка
      const twItKw = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0), 0);
      // TW UPS / cooling
      const twUpsKwAvail = (c.upsSystems || [])
        .filter(u => u.purpose === 'it' || u.purpose === 'mixed')
        .reduce((s, u) => s + (Number(u.count) || 0) * (Number(u.ratedKva) || 0) * 0.95, 0);
      const twCoolKw = (c.coolingUnits || []).reduce((s, cu) => s + (Number(cu.count) || 0) * (Number(cu.kwPerUnit) || 0), 0);

      // 4.1 IT-нагрузка: TW vs Constructor
      if (twItKw > 0 && constrItKw > 0) {
        const diff = Math.abs(twItKw - constrItKw);
        const pctDiff = (diff / Math.max(twItKw, constrItKw)) * 100;
        if (pctDiff > 20) {
          issues.push({ level: 'warn', area: '⚖ Баланс IT', msg: `IT-нагрузки расходятся: TW ${twItKw.toFixed(1)} кВт ≠ Конструктор ${constrItKw.toFixed(1)} кВт (Δ ${pctDiff.toFixed(0)}%)`, hint: 'Технолог и Конструктор должны быть согласованы по IT-нагрузке. Проверьте rackGroups vs consumer-узлы.' });
        }
      } else if (twItKw > 0 && constrItKw === 0 && schemeNodes.some(n => n.type === 'consumer')) {
        issues.push({ level: 'info', area: '⚖ Баланс IT', msg: `Конструктор не содержит IT-потребителей (system='it' / subtype='rack'), хотя в TW заявлено ${twItKw.toFixed(1)} кВт`, hint: 'Пометьте IT-стойки в Конструкторе через systems: ["it"] или consumerSubtype: "rack".' });
      }

      // 4.2 Тепловой баланс cooling ≥ IT + UPS_losses + 5% освещение/auxes
      if (twItKw > 0) {
        const upsLosses = (c.upsSystems || [])
          .filter(u => u.purpose === 'it' || u.purpose === 'mixed')
          .reduce((s, u) => {
            const eff = (Number(u.efficiency) || 95) / 100;
            const load = (Number(u.count) || 0) * (Number(u.ratedKva) || 0) * 0.95;
            return s + load * (1 - eff);
          }, 0);
        const auxKw = twItKw * 0.05;
        const totalHeatKw = twItKw + upsLosses + auxKw;
        if (twCoolKw > 0 && twCoolKw < totalHeatKw) {
          issues.push({ level: 'warn', area: '⚖ Тепло', msg: `Cooling ${twCoolKw.toFixed(1)} кВт < тепло ${totalHeatKw.toFixed(1)} кВт (IT ${twItKw.toFixed(1)} + UPS-потери ${upsLosses.toFixed(1)} + aux ${auxKw.toFixed(1)})`, hint: 'Холодопроизводительность должна покрывать IT-нагрузку плюс потери ИБП и вспомогательное оборудование. Добавьте кондиционеры или увеличьте мощность.' });
        }
      }

      // 4.3 PUE consistency: TW PUE × IT_load = total facility load
      const twPueTarget = Number(c.pueTarget) || 0;
      if (twPueTarget > 1.0 && twItKw > 0 && constrTotalKw > 0) {
        const expectedTotal = twItKw * twPueTarget;
        const actualTotal = constrTotalKw;
        const pctDiff = Math.abs(actualTotal - expectedTotal) / expectedTotal * 100;
        if (pctDiff > 25) {
          issues.push({ level: 'info', area: '⚖ PUE', msg: `PUE расходится: target ${twPueTarget.toFixed(2)} → ожидаемая total ${expectedTotal.toFixed(1)} кВт, в Конструкторе ${actualTotal.toFixed(1)} кВт`, hint: `Total = IT × PUE. Если Конструктор показывает другую сумму — обновите PUE в TW или проверьте полноту учёта потребителей.` });
        }
      }

      // 4.4 Источник питания vs суммарная нагрузка
      const sources = schemeNodes.filter(n => n.type === 'source' || n.type === 'generator');
      let sourceKwAvail = 0;
      for (const s of sources) {
        if (s.sourceSubtype === 'transformer' || s.type === 'source') {
          const sn = (Number(s.snomKva) || 0) * (Number(s.cosPhi) || 0.92);
          sourceKwAvail += sn;
        } else if (s.type === 'generator') {
          const sn = (Number(s.snomKva) || 0) * (Number(s.cosPhi) || 0.8);
          sourceKwAvail += sn;
        }
      }
      if (sourceKwAvail > 0 && constrTotalKw > sourceKwAvail) {
        issues.push({ level: 'error', area: '⚖ Источник', msg: `Нагрузка ${constrTotalKw.toFixed(1)} кВт > источник ${sourceKwAvail.toFixed(1)} кВт`, hint: 'Суммарная установленная мощность потребителей превышает мощность источников (трансформаторов / генераторов). Увеличьте Snom или уменьшите load.' });
      } else if (sourceKwAvail > 0 && constrTotalKw > sourceKwAvail * 0.85) {
        issues.push({ level: 'warn', area: '⚖ Источник', msg: `Загрузка источника ${(constrTotalKw / sourceKwAvail * 100).toFixed(0)}% (нагрузка ${constrTotalKw.toFixed(1)} / ${sourceKwAvail.toFixed(1)} кВт)`, hint: 'Загрузка источника > 85% — рекомендуется резерв 15-20% для пиков и расширения.' });
      }

      // 4.5 ИБП Технолога vs ИБП Конструктора (по узлам type='ups')
      const constrUpsKw = schemeNodes
        .filter(n => n.type === 'ups')
        .reduce((s, u) => s + (Number(u.capacityKw) || 0) * (Number(u.count) || 1), 0);
      if (twUpsKwAvail > 0 && constrUpsKw > 0) {
        const diff = Math.abs(twUpsKwAvail - constrUpsKw);
        const pctDiff = (diff / Math.max(twUpsKwAvail, constrUpsKw)) * 100;
        if (pctDiff > 25) {
          issues.push({ level: 'warn', area: '⚖ ИБП', msg: `ИБП-мощности расходятся: TW ${twUpsKwAvail.toFixed(1)} кВт ≠ Конструктор ${constrUpsKw.toFixed(1)} кВт (Δ ${pctDiff.toFixed(0)}%)`, hint: 'Технолог и Конструктор должны иметь одинаковую заявленную мощность ИБП.' });
        }
      } else if (twUpsKwAvail > 0 && constrUpsKw === 0) {
        issues.push({ level: 'info', area: '⚖ ИБП', msg: `В Технологе заявлены ИБП на ${twUpsKwAvail.toFixed(1)} кВт, в Конструкторе нет узлов type='ups'`, hint: 'Добавьте ИБП-узлы в Конструктор для электрической схемы (без них кабельный расчёт не учтёт UPS-байпас и резервирование).' });
      }
    }

    // Метаданные проекта — пустые поля
    if (!p.location?.city && !p.location?.lat) {
      issues.push({ level: 'info', area: '🏷 Проект', msg: 'Локация не задана', hint: 'Закладка «Общее» → задайте город / координаты. Используется в meteo / cooling расчётах.' });
    }
    if (!p.requisites?.code) {
      issues.push({ level: 'info', area: '🏷 Проект', msg: 'Шифр проекта не задан', hint: 'Закладка «Общее» → реквизиты → «Обозначение / шифр». Печатается в шапке всех чертежей.' });
    }

    // ── 5. Снапшот проблем Конструктора (Roadmap 47.2.8) ──
    // Категории, требующие живого recalc (защита кабелей, селективность,
    // N-1, перегрузы) — карточка проекта пересчитать их статически не может
    // (underscore-флаги stripRuntime убирает из сохранённой схемы). Берём
    // компактный снапшот, который Конструктор пишет при каждом изменении.
    const issuesSnap = projectLoad(pid, 'engine', 'issues.v1', null);
    if (issuesSnap && Array.isArray(issuesSnap.cats) && issuesSnap.cats.length) {
      let ago = '';
      try {
        const ms = Date.now() - (Number(issuesSnap.ts) || 0);
        const min = Math.floor(ms / 60000);
        ago = min < 1 ? 'только что' : min < 60 ? `${min} мин назад`
          : min < 1440 ? `${Math.floor(min / 60)} ч назад`
          : `${Math.floor(min / 1440)} дн назад`;
      } catch {}
      for (const cat of issuesSnap.cats) {
        issues.push({
          level: cat.level === 'error' ? 'error' : 'warn',
          area: '⚡ Конструктор (расчёт)',
          msg: `${cat.label} × ${cat.count}`,
          hint: `По последнему расчёту в Конструкторе (${ago || 'дата неизв.'}). Откройте Конструктор схем → Ctrl+Shift+I для деталей и авто-фикса.`,
        });
      }
    } else if (scheme?.nodes && (Array.isArray(scheme.nodes) ? scheme.nodes.length : Object.keys(scheme.nodes).length)) {
      issues.push({ level: 'info', area: '⚡ Конструктор (расчёт)', msg: 'Снапшот расчёта отсутствует', hint: 'Откройте Конструктор схем (любое изменение пересчитает) — после этого здесь появятся проблемы защиты кабелей / селективности / N-1.' });
    }

    // Визуализация
    const errors = issues.filter(i => i.level === 'error');
    const warns = issues.filter(i => i.level === 'warn');
    const infos = issues.filter(i => i.level === 'info');
    const LEVEL_META = {
      error: { icon: '❌', color: '#b91c1c', bg: '#fee2e2', label: 'Ошибка' },
      warn:  { icon: '⚠', color: '#b45309', bg: '#fef3c7', label: 'Предупр.' },
      info:  { icon: 'ℹ', color: '#1e40af', bg: '#dbeafe', label: 'Инфо' },
    };
    const renderIssue = (i) => {
      const m = LEVEL_META[i.level];
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:${m.bg};border-left:3px solid ${m.color};border-radius:3px;font-size:12.5px">
        <span style="font-size:14px;color:${m.color};flex:0 0 auto">${m.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:${m.color}">${esc(i.area)} · ${esc(i.msg)}</div>
          <div style="font-size:11.5px;color:#475569;margin-top:2px">${esc(i.hint)}</div>
        </div>
      </div>`;
    };

    validationHost.innerHTML = `
      <p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.6">
        Статические проверки проекта: дубли тегов, orphan-узлы, недостаточные мощности (ИБП vs IT,
        холод vs IT), пустые поля метаданных. Плюс <b>снапшот расчёта Конструктора</b> (защита
        кабелей, селективность защит, N-1, перегрузы) — по последнему пересчёту схемы.
        Для деталей и авто-фикса этих пунктов — откройте Конструктор схем
        → <b>Ctrl+Shift+I</b> (полная Project Issues modal).
      </p>

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:13px">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#fee2e2;color:#b91c1c;border-radius:4px;font-weight:600">❌ Ошибок: ${errors.length}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#fef3c7;color:#b45309;border-radius:4px;font-weight:600">⚠ Предупр.: ${warns.length}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#dbeafe;color:#1e40af;border-radius:4px;font-weight:600">ℹ Инфо: ${infos.length}</span>
        <a href="../index.html?project=${esc(pid)}#issues" target="_blank" style="margin-left:auto;font-size:12px;padding:5px 12px;background:#fff;border:1px solid #cbd5e1;color:#1e40af;border-radius:4px;text-decoration:none">↪ Полная проверка в Конструкторе (Ctrl+Shift+I)</a>
      </div>

      ${issues.length === 0
        ? `<div style="padding:20px;background:#f0fdf4;border-left:3px solid #15803d;border-radius:4px;color:#15803d;font-size:14px;text-align:center">✅ <b>Все статические проверки пройдены</b><br><span class="muted" style="font-size:12px">Запустите полную проверку в Конструкторе для глубокого анализа.</span></div>`
        : `<div style="display:flex;flex-direction:column;gap:6px">
            ${[...errors, ...warns, ...infos].map(renderIssue).join('')}
          </div>`
      }

      <div style="margin-top:18px;padding:14px 16px;background:#dbeafe;border-left:3px solid #1e40af;border-radius:4px;color:#1e3a8a;font-size:12.5px;line-height:1.7">
        ℹ Согласование разделов (signature + revision history) — в табе <b>«✓ Согласование»</b>.
        Глубокие проверки (ΔU, селективность, TCC) — в Конструкторе через <b>Ctrl+Shift+I</b>.
      </div>
    `;
  }

  // v0.60.302 (Этап 1.5.5 Phase 47): Согласование разделов ГИПом.
  // По плану архитектуры 2026-05-06 + ROADMAP Phase 47.2.10.
  // Storage: project.approvals = { sectionId: { status, signedByUid,
  // signedByEmail, timestamp, revision, comment, history: [...] } }
  // Status: 'pending' | 'approved' | 'rejected' | 'needs-revision'.
  if (approvalsHost) {
    const isCloud = !!(window.Storage && window.Storage.isCloud);
    const role = p._role || 'owner';
    const canApprove = role === 'owner' || role === 'gip' || role === 'admin';
    const SECTIONS = [
      { id: 'electrical',     icon: '⚡', label: 'Электрическая часть',  desc: 'Схемы, кабели, защиты, ИБП, ДГУ — Конструктор схем' },
      { id: 'technological',  icon: '🏗', label: 'Технологическая часть', desc: 'Концепция, варианты, помещения, стойки — Технолог объекта' },
      { id: 'scs',            icon: '🔗', label: 'СКС / слаботочка',      desc: 'СКС-design, патч-панели, кабель-журнал' },
      { id: 'cooling',        icon: '❄', label: 'Холодоснабжение',        desc: 'Кондиционеры, теплоотвод, баланс холода' },
      { id: 'economics',      icon: '💰', label: 'Экономика',              desc: 'BOM, КП, ведомость, сметы' },
      { id: 'plan',           icon: '📅', label: 'План-график',            desc: 'Календарный план, milestones, Гантт' },
      { id: 'validation',     icon: '🛡', label: 'Проверки',                desc: 'Статические + cross-discipline проверки' },
    ];
    const approvals = (p.approvals && typeof p.approvals === 'object') ? p.approvals : {};
    const STATUS_META = {
      pending:         { icon: '⏳', label: 'Не согласовано', color: '#475569', bg: '#f1f5f9' },
      approved:        { icon: '✓',  label: 'Согласовано',    color: '#15803d', bg: '#dcfce7' },
      rejected:        { icon: '✕',  label: 'Отклонено',      color: '#b91c1c', bg: '#fee2e2' },
      'needs-revision': { icon: '🔄', label: 'На доработку',   color: '#b45309', bg: '#fef3c7' },
    };
    const fmtTime = (ts) => {
      if (!ts) return '';
      try { return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
      catch { return String(ts); }
    };
    const totalSections = SECTIONS.length;
    const approvedCount = SECTIONS.filter(s => approvals[s.id]?.status === 'approved').length;
    const pendingCount = SECTIONS.filter(s => !approvals[s.id] || approvals[s.id].status === 'pending').length;
    const rejectedCount = SECTIONS.filter(s => approvals[s.id]?.status === 'rejected' || approvals[s.id]?.status === 'needs-revision').length;
    const renderSectionCard = (sec) => {
      const a = approvals[sec.id] || { status: 'pending' };
      const sm = STATUS_META[a.status] || STATUS_META.pending;
      const rev = Number(a.revision) || 0;
      const history = Array.isArray(a.history) ? a.history : [];
      return `<div style="padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${sm.color};border-radius:5px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:18px">${sec.icon}</span>
              <h5 style="margin:0;font-size:14px;color:#0f172a">${esc(sec.label)}</h5>
              <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:${sm.bg};color:${sm.color};border-radius:10px;font-size:11px;font-weight:600">${sm.icon} ${esc(sm.label)}</span>
              ${rev > 0 ? `<span class="muted" style="font-size:11px;color:#64748b">rev ${rev}</span>` : ''}
            </div>
            <div class="muted" style="font-size:11.5px;color:#64748b;margin-bottom:6px">${esc(sec.desc)}</div>
            ${a.signedByEmail || a.timestamp ? `
              <div style="font-size:11.5px;color:#475569">
                ${a.signedByEmail ? `<b>Подписал:</b> ${esc(a.signedByEmail)}` : ''}
                ${a.timestamp ? ` · <b>${fmtTime(a.timestamp)}</b>` : ''}
              </div>
            ` : ''}
            ${a.comment ? `<div style="margin-top:6px;padding:6px 10px;background:#f8fafc;border-radius:3px;font-size:12px;color:#334155;font-style:italic">«${esc(a.comment)}»</div>` : ''}
          </div>
          ${canApprove ? `
            <div style="display:flex;gap:4px;flex-wrap:wrap;align-self:center">
              <button type="button" data-approve="${esc(sec.id)}" title="Подписать раздел: статус → ✓ Согласовано, revision++"
                      style="padding:5px 12px;font-size:12px;border:1px solid #15803d;background:${a.status === 'approved' ? '#dcfce7' : '#fff'};color:#15803d;border-radius:3px;cursor:pointer;font-weight:500">✓ Согласовать</button>
              <button type="button" data-reject="${esc(sec.id)}" title="Отклонить: статус → ✕ Отклонено"
                      style="padding:5px 12px;font-size:12px;border:1px solid #fecaca;background:${a.status === 'rejected' ? '#fee2e2' : '#fff'};color:#b91c1c;border-radius:3px;cursor:pointer">✕ Отклонить</button>
              <button type="button" data-revise="${esc(sec.id)}" title="Отправить на доработку: статус → 🔄 На доработку"
                      style="padding:5px 12px;font-size:12px;border:1px solid #fde68a;background:${a.status === 'needs-revision' ? '#fef3c7' : '#fff'};color:#b45309;border-radius:3px;cursor:pointer">🔄 Доработка</button>
              ${a.status && a.status !== 'pending' ? `
                <button type="button" data-reset="${esc(sec.id)}" title="Сбросить статус (revision сохраняется в history)"
                        style="padding:5px 10px;font-size:11px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:3px;cursor:pointer">↺</button>
              ` : ''}
            </div>
          ` : ''}
        </div>
        ${history.length > 0 ? `
          <details style="margin-top:10px">
            <summary style="cursor:pointer;font-size:11.5px;color:#64748b;font-weight:500">📋 История изменений (${history.length})</summary>
            <div style="margin-top:6px;padding:8px 12px;background:#f8fafc;border-radius:3px;font-size:11.5px;color:#475569;line-height:1.7">
              ${history.slice().reverse().map(h => `
                <div style="padding:3px 0;border-bottom:1px dotted #e5e7eb">
                  ${(STATUS_META[h.status] || STATUS_META.pending).icon} <b>${esc((STATUS_META[h.status] || STATUS_META.pending).label)}</b>
                  ${h.signedByEmail ? ` · ${esc(h.signedByEmail)}` : ''}
                  ${h.timestamp ? ` · ${fmtTime(h.timestamp)}` : ''}
                  ${h.comment ? `<div style="font-style:italic;color:#64748b;margin-left:18px">«${esc(h.comment)}»</div>` : ''}
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}
      </div>`;
    };
    approvalsHost.innerHTML = `
      <p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.6">
        ГИП / владелец проекта согласовывает разделы пакета. Каждый раздел имеет статус
        (⏳ не согласовано / ✓ согласовано / ✕ отклонено / 🔄 на доработку), подпись
        (uid + email), timestamp, revision-номер и историю всех изменений (append-only).
      </p>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:13px">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#dcfce7;color:#15803d;border-radius:4px;font-weight:600">✓ Согласовано: ${approvedCount} / ${totalSections}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#f1f5f9;color:#475569;border-radius:4px;font-weight:600">⏳ Ожидают: ${pendingCount}</span>
        ${rejectedCount > 0 ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#fee2e2;color:#b91c1c;border-radius:4px;font-weight:600">✕ Возвращено: ${rejectedCount}</span>` : ''}
        ${approvedCount === totalSections
          ? `<span style="margin-left:auto;padding:5px 14px;background:#15803d;color:#fff;border-radius:4px;font-weight:600;font-size:13px">🎉 Все разделы согласованы</span>`
          : ''
        }
      </div>
      ${!canApprove ? `
        <div style="padding:10px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;font-size:12.5px;color:#78350f;margin-bottom:12px">
          ⚠ Только владелец / ГИП / admin может менять статус разделов. Текущая роль: <b>${esc(role)}</b>.
        </div>
      ` : ''}
      <div>
        ${SECTIONS.map(renderSectionCard).join('')}
      </div>
    `;
    if (canApprove) {
      const _signApply = async (sectionId, newStatus, label) => {
        const cur = approvals[sectionId] || { status: 'pending', revision: 0, history: [] };
        const comment = (newStatus === 'rejected' || newStatus === 'needs-revision')
          ? await prPrompt(`${label}: причина (комментарий)`, '')
          : await prPrompt(`${label}: комментарий (опционально)`, '');
        if (comment === null) return; // cancel
        const u = (window.Auth && window.Auth.currentUser) || null;
        const signedByUid = u?.uid || 'local';
        const signedByEmail = u?.email || (isCloud ? 'unknown' : 'локальный пользователь');
        const now = Date.now();
        const newRev = (Number(cur.revision) || 0) + (newStatus === 'approved' ? 1 : 0);
        const entry = {
          status: newStatus,
          signedByUid,
          signedByEmail,
          timestamp: now,
          revision: newRev,
          comment: comment || '',
        };
        const history = Array.isArray(cur.history) ? cur.history.slice() : [];
        history.push(entry);
        const updatedApprovals = {
          ...approvals,
          [sectionId]: { ...entry, history },
        };
        try {
          updateProject(p.id, { approvals: updatedApprovals });
          prToast(`${label}: ${SECTIONS.find(s => s.id === sectionId)?.label || sectionId}`, 'ok');
          render();
        } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
      };
      approvalsHost.querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', () => _signApply(btn.getAttribute('data-approve'), 'approved', '✓ Согласовано'));
      });
      approvalsHost.querySelectorAll('[data-reject]').forEach(btn => {
        btn.addEventListener('click', () => _signApply(btn.getAttribute('data-reject'), 'rejected', '✕ Отклонено'));
      });
      approvalsHost.querySelectorAll('[data-revise]').forEach(btn => {
        btn.addEventListener('click', () => _signApply(btn.getAttribute('data-revise'), 'needs-revision', '🔄 На доработку'));
      });
      approvalsHost.querySelectorAll('[data-reset]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sectionId = btn.getAttribute('data-reset');
          const cur = approvals[sectionId];
          if (!cur) return;
          if (!await prConfirm('Сбросить статус раздела?', 'История ревизий сохранится. Раздел вернётся к статусу «не согласовано».')) return;
          const history = Array.isArray(cur.history) ? cur.history.slice() : [];
          history.push({
            status: 'pending',
            signedByUid: (window.Auth?.currentUser?.uid) || 'local',
            signedByEmail: (window.Auth?.currentUser?.email) || 'локальный пользователь',
            timestamp: Date.now(),
            revision: cur.revision || 0,
            comment: '(статус сброшен)',
          });
          const updatedApprovals = { ...approvals, [sectionId]: { status: 'pending', revision: cur.revision || 0, history } };
          try {
            updateProject(p.id, { approvals: updatedApprovals });
            prToast('↺ Статус сброшен', 'ok');
            render();
          } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
        });
      });
    }
  }

  // v0.60.110: восстановить focused input после re-render. Делаем синхронно
  // (на этом же тике) чтобы не моргнуть пустым значением.
  _restoreActiveInput(_activeInputSnap);
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
      const nav = await import('shared/module-nav.js');
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
  // v0.60.35: подписка на изменения company-profile (по репорту: «реквизиты
  // автоматически не обновляются»). Вызывается при сохранении в global-
  // settings или per-project override → re-render свойств проекта.
  try {
    onCompanyProfileChange(() => {
      try {
        const propsHost = document.getElementById('pr-detail-properties');
        const pid = getPid();
        const p = pid ? getProject(pid) : null;
        if (propsHost && p) renderProjectProperties(p, propsHost);
      } catch (e) { console.warn('[project.js] company-profile re-render failed:', e); }
    });
  } catch {}
  // Также DOM-event если company-profile меняется в другой вкладке (storage event).
  window.addEventListener('storage', (ev) => {
    if (!ev.key) return;
    if (ev.key === 'raschet.companyProfile.global.v1' || ev.key.includes('.companyProfile.v1')) {
      try {
        const propsHost = document.getElementById('pr-detail-properties');
        const pid = getPid();
        const p = pid ? getProject(pid) : null;
        if (propsHost && p) renderProjectProperties(p, propsHost);
      } catch (e) { console.warn('[project.js] storage-event re-render failed:', e); }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAfterDom);
} else {
  // DOM уже готов — запускаем сразу (type="module" deferred + page parsed).
  _initAfterDom();
}
