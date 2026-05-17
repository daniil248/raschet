// sketch/sketch-refs-ui.js
// =============================================================================
// UI для связи sketch'ей с данными других модулей Raschet.
//
// v0.60.168 (по репорту Пользователя 2026-05-04 «нам тем более нужно связывать
// файлы (данные), которые мы будем генерировать в этом модуле»):
//
// Компоненты:
//   1. Sidebar (collapsible) справа — список текущих refs sketch'a.
//      По каждой ссылке:
//        • тип (icon + цвет)
//        • актуальный label (resolveLabel — если в исходном модуле
//          переименовали entity, обновляется)
//        • действия: 🔗 открыть | ➕ вставить в холст | 🗑 удалить
//   2. Picker modal — выбор entity для добавления.
//        • dropdown типов (Проект / Стойка / Главная схема / НКУ / ...)
//        • список доступных entity текущего проекта
//        • кнопка «Добавить» → addRef + вставить в drawio
//
// Интеграция с drawio:
//   На каждый ref → buildDrawioCellXml → postMessage {action:'merge', xml}.
//   Cell — UserObject с raschet.refType / raschet.refId / raschet.refLabel,
//   они сохраняются в XML самого диаграммы (drawio переносит unknown
//   атрибуты UserObject через export/import).
// =============================================================================

import { rsToast, rsConfirm } from 'shared/dialog.js';
import {
  getRefTypes,
  getRefType,
  listEntities,
  loadRefs,
  addRef,
  removeRef,
  buildOpenUrl,
  resolveLabel,
  buildDrawioCellXml,
} from 'shared/sketch-refs.js';

// ───────── Module state (set by setContext from sketch.js) ──────────────────

let _ctx = {
  pid: null,
  getActiveSketchId: () => null,
  postToDrawio: (_msg) => {},
};

export function setContext(ctx) {
  _ctx = { ..._ctx, ...ctx };
}

const $ = (id) => document.getElementById(id);

// v0.60.173: URL-builder и человекочитаемое имя модуля по refType. Используется
// в picker'е, когда entity list пуст — Пользователь видит «Открыть модуль X ↗»
// и может сразу пойти создать первую запись.
const MODULE_URL_BY_REF_TYPE = {
  project: (pid) => `../projects/project.html?project=${encodeURIComponent(pid || '')}`,
  rack: (pid) => `../rack-config/?project=${encodeURIComponent(pid || '')}`,
  schema: (pid) => `../index.html?project=${encodeURIComponent(pid || '')}`,
  schematic: (pid) => `../schematic/?project=${encodeURIComponent(pid || '')}`,
  panel: (pid) => `../panel-config/?project=${encodeURIComponent(pid || '')}`,
  ups: (pid) => `../ups-config/?project=${encodeURIComponent(pid || '')}`,
  mv: (pid) => `../mv-config/?project=${encodeURIComponent(pid || '')}`,
  transformer: (pid) => `../transformer-config/?project=${encodeURIComponent(pid || '')}`,
  cable: (pid) => `../cable/?project=${encodeURIComponent(pid || '')}`,
  sketch: (pid) => `../sketch/?project=${encodeURIComponent(pid || '')}`,
};
const MODULE_NAME_BY_REF_TYPE = {
  project: 'Проекты',
  rack: 'Конфигуратор стойки',
  schema: 'Конструктор схем',
  schematic: 'Схема принципиальная',
  panel: 'Конфигуратор НКУ',
  ups: 'Конфигуратор ИБП',
  mv: 'Конфигуратор РУ СН',
  transformer: 'Конфигуратор трансформатора',
  cable: 'Расчёт кабельной линии',
  sketch: 'Скетч',
};

// ───────── Public render API ────────────────────────────────────────────────

export function renderRefsSidebar() {
  const host = $('sk-refs-sidebar');
  if (!host) return;
  const sid = _ctx.getActiveSketchId();
  if (!sid) {
    host.innerHTML = '<div class="sk-refs-empty">Sketch не выбран</div>';
    updateRefsCountBadge(0);
    return;
  }
  const refs = loadRefs(_ctx.pid, sid);
  updateRefsCountBadge(refs.length);

  if (!refs.length) {
    host.innerHTML = `
      <div class="sk-refs-empty">
        <div style="font-size:18px;margin-bottom:6px">🔗</div>
        <div><b>Связи отсутствуют</b></div>
        <div style="margin-top:6px;color:#94a3b8;font-size:11px">
          Добавьте ссылку на стойку, схему, конфигурацию НКУ, ИБП и др. —
          она сохранится с этим sketch'ом и будет вставлена в холст
          как метка-ссылка.
        </div>
        <button type="button" class="sk-refs-add-btn" id="sk-refs-add-1"
          style="margin-top:12px">＋ Добавить связь</button>
      </div>`;
    $('sk-refs-add-1')?.addEventListener('click', openPickerModal);
    return;
  }

  const html = [
    `<div class="sk-refs-toolbar">
       <button type="button" class="sk-refs-add-btn" id="sk-refs-add-2"
         title="Добавить новую связь с данными другого модуля">＋ Добавить связь</button>
     </div>`,
    `<div class="sk-refs-list">`,
    ...refs.map(ref => renderRefCard(ref)),
    `</div>`,
  ].join('');
  host.innerHTML = html;

  $('sk-refs-add-2')?.addEventListener('click', openPickerModal);
  host.querySelectorAll('[data-act="open"]').forEach(b => {
    b.addEventListener('click', (e) => {
      const uid = e.currentTarget.getAttribute('data-uid');
      const ref = loadRefs(_ctx.pid, _ctx.getActiveSketchId()).find(r => r.id === uid);
      if (!ref) return;
      const url = buildOpenUrl(ref, _ctx.pid);
      if (url) window.open(url, '_blank');
      else rsToast('Не удалось построить URL для перехода', 'err');
    });
  });
  host.querySelectorAll('[data-act="insert"]').forEach(b => {
    b.addEventListener('click', (e) => {
      const uid = e.currentTarget.getAttribute('data-uid');
      const ref = loadRefs(_ctx.pid, _ctx.getActiveSketchId()).find(r => r.id === uid);
      if (!ref) return;
      insertRefIntoDrawio(ref);
    });
  });
  host.querySelectorAll('[data-act="remove"]').forEach(b => {
    b.addEventListener('click', async (e) => {
      const uid = e.currentTarget.getAttribute('data-uid');
      const ref = loadRefs(_ctx.pid, _ctx.getActiveSketchId()).find(r => r.id === uid);
      if (!ref) return;
      const ok = await rsConfirm(
        `Удалить связь?`,
        `${typeIconLabel(ref.refType)}: «${ref.label}»\n\nИз диаграммы метку нужно удалить вручную (если была вставлена).`,
        { okLabel: 'Удалить', cancelLabel: 'Отмена' }
      );
      if (!ok) return;
      removeRef(_ctx.pid, _ctx.getActiveSketchId(), uid);
      renderRefsSidebar();
      rsToast('✓ Связь удалена', 'info');
    });
  });
}

function renderRefCard(ref) {
  const t = getRefType(ref.refType) || { icon: '?', label: 'Unknown', color: '#64748b', fill: '#f1f5f9' };
  // Резолвим актуальный label (если entity переименовали в исходном модуле)
  let liveLabel = ref.label;
  try {
    liveLabel = resolveLabel(ref.refType, ref.refId, _ctx.pid) || ref.label;
  } catch {}
  const stale = liveLabel === '(удалён)' || liveLabel === '(удалена)';
  return `
    <div class="sk-refs-card" style="border-left-color:${t.color};background:${t.fill}">
      <div class="sk-refs-card-head">
        <span class="sk-refs-icon" title="${escAttr(t.label)}">${t.icon}</span>
        <span class="sk-refs-type" style="color:${t.color}">${escHtml(t.label)}</span>
        ${stale ? '<span class="sk-refs-stale" title="Исходный объект удалён в другом модуле">⚠</span>' : ''}
      </div>
      <div class="sk-refs-label" title="${escAttr(liveLabel)}">${escHtml(liveLabel)}</div>
      ${ref.note ? `<div class="sk-refs-note">${escHtml(ref.note)}</div>` : ''}
      <div class="sk-refs-actions">
        <button type="button" data-act="open" data-uid="${escAttr(ref.id)}"
          title="Открыть исходный модуль с этим объектом">🔗 Открыть</button>
        <button type="button" data-act="insert" data-uid="${escAttr(ref.id)}"
          title="Вставить метку-ссылку в drawio-холст">➕ В холст</button>
        <button type="button" data-act="remove" data-uid="${escAttr(ref.id)}"
          title="Удалить связь (метку из холста удалить вручную)">🗑</button>
      </div>
    </div>`;
}

function typeIconLabel(refTypeId) {
  const t = getRefType(refTypeId);
  return t ? `${t.icon} ${t.label}` : refTypeId;
}

function updateRefsCountBadge(n) {
  const el = $('sk-refs-count');
  if (el) el.textContent = n > 0 ? String(n) : '';
}

// ───────── Picker modal ─────────────────────────────────────────────────────

function openPickerModal() {
  const host = $('sk-refs-modal-host');
  if (!host) return;
  const types = getRefTypes();
  host.innerHTML = `
    <div class="sk-refs-modal-backdrop" id="sk-refs-modal-bd">
      <div class="sk-refs-modal" role="dialog" aria-modal="true">
        <div class="sk-refs-modal-head">
          <span>🔗 Добавить связь</span>
          <button type="button" id="sk-refs-modal-close" title="Закрыть">✕</button>
        </div>
        <div class="sk-refs-modal-body">
          <label class="sk-refs-modal-label">Тип связи:</label>
          <select id="sk-refs-modal-type">
            ${types.map(t => `<option value="${escAttr(t.id)}">${t.icon} ${escHtml(t.label)}</option>`).join('')}
          </select>
          <label class="sk-refs-modal-label" style="margin-top:10px">Объект:</label>
          <div id="sk-refs-modal-list" class="sk-refs-modal-list"></div>
          <label class="sk-refs-modal-label" style="margin-top:10px">Заметка (опционально):</label>
          <input type="text" id="sk-refs-modal-note"
            placeholder="например: «питание основного коридора»">
        </div>
        <div class="sk-refs-modal-foot">
          <span class="sk-refs-modal-hint">Связь сохранится с sketch'ом.
            Если поставить галочку «вставить в холст» — добавится также метка-ссылка.</span>
          <label class="sk-refs-modal-check">
            <input type="checkbox" id="sk-refs-modal-insert" checked>
            <span>вставить в холст</span>
          </label>
          <button type="button" id="sk-refs-modal-cancel">Отмена</button>
          <button type="button" id="sk-refs-modal-ok" class="sk-refs-modal-primary">Добавить</button>
        </div>
      </div>
    </div>`;

  let selectedEntityId = null;
  const renderList = () => {
    const typeSel = $('sk-refs-modal-type');
    const listEl = $('sk-refs-modal-list');
    if (!typeSel || !listEl) return;
    const refType = typeSel.value;
    const entities = listEntities(refType, _ctx.pid);
    if (!entities.length) {
      // v0.60.173: для пустого списка показываем прямую ссылку «Открыть
      // модуль» — Пользователь идёт создавать entity и возвращается.
      const moduleUrl = MODULE_URL_BY_REF_TYPE[refType];
      const moduleName = MODULE_NAME_BY_REF_TYPE[refType] || refType;
      const link = moduleUrl
        ? `<a href="${escAttr(moduleUrl(_ctx.pid))}" target="_blank"
             style="display:inline-block;margin-top:8px;padding:6px 12px;
                    background:#1e40af;color:#fff;border-radius:4px;
                    text-decoration:none;font-size:12.5px;font-weight:500">
            Открыть «${escHtml(moduleName)}» ↗
           </a>`
        : '';
      listEl.innerHTML = `<div class="sk-refs-modal-empty">
        Нет доступных объектов в проекте.<br>
        <span style="color:#94a3b8;font-size:11px">
          Создайте их в соответствующем модуле и вернитесь сюда.
        </span><br>${link}</div>`;
      selectedEntityId = null;
      return;
    }
    listEl.innerHTML = entities.map(e => `
      <div class="sk-refs-modal-item" data-id="${escAttr(e.id)}">
        <div class="sk-refs-modal-item-label">${escHtml(e.label)}</div>
        ${e.sublabel ? `<div class="sk-refs-modal-item-sub">${escHtml(e.sublabel)}</div>` : ''}
      </div>
    `).join('');
    listEl.querySelectorAll('[data-id]').forEach(it => {
      it.addEventListener('click', () => {
        listEl.querySelectorAll('[data-id]').forEach(x => x.classList.remove('selected'));
        it.classList.add('selected');
        selectedEntityId = it.getAttribute('data-id');
      });
    });
    // Auto-select first
    const first = listEl.querySelector('[data-id]');
    if (first) {
      first.classList.add('selected');
      selectedEntityId = first.getAttribute('data-id');
    }
  };

  $('sk-refs-modal-type')?.addEventListener('change', renderList);
  renderList();

  const close = () => host.innerHTML = '';
  $('sk-refs-modal-close')?.addEventListener('click', close);
  $('sk-refs-modal-cancel')?.addEventListener('click', close);
  $('sk-refs-modal-bd')?.addEventListener('click', (e) => {
    if (e.target === $('sk-refs-modal-bd')) close();
  });

  $('sk-refs-modal-ok')?.addEventListener('click', () => {
    const refType = $('sk-refs-modal-type')?.value;
    if (!refType || !selectedEntityId) {
      rsToast('Выберите объект', 'warn');
      return;
    }
    const entities = listEntities(refType, _ctx.pid);
    const entity = entities.find(e => e.id === selectedEntityId);
    if (!entity) { rsToast('Объект не найден', 'err'); return; }
    const note = $('sk-refs-modal-note')?.value?.trim() || '';
    const sid = _ctx.getActiveSketchId();
    if (!sid) { rsToast('Sketch не выбран', 'err'); return; }
    const newRef = addRef(_ctx.pid, sid, {
      refType,
      refId: entity.id,
      label: entity.label,
      note,
    });
    if (!newRef) { rsToast('Ошибка добавления связи', 'err'); return; }
    if ($('sk-refs-modal-insert')?.checked) {
      insertRefIntoDrawio(newRef);
    }
    renderRefsSidebar();
    rsToast(`✓ Связь добавлена: ${entity.label}`, 'ok');
    close();
  });
}

// ───────── Insert into drawio ───────────────────────────────────────────────

function insertRefIntoDrawio(ref) {
  const url = buildOpenUrl(ref, _ctx.pid) || '';
  // Координаты примерные — drawio при merge сам не двигает, но мы хотя бы
  // не накладываем все cells друг на друга → распределяем по small grid.
  const idx = (loadRefs(_ctx.pid, _ctx.getActiveSketchId()) || []).findIndex(r => r.id === ref.id);
  const x = 40 + (idx % 3) * 220;
  const y = 40 + Math.floor(idx / 3) * 80;
  const xml = buildDrawioCellXml(ref, { x, y, w: 200, h: 60, link: url });
  if (!xml) return;
  _ctx.postToDrawio({ action: 'merge', xml });
  rsToast('✓ Метка-ссылка вставлена в холст', 'ok');
}

// ───────── Helpers ──────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
