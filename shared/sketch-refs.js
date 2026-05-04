// shared/sketch-refs.js
// =============================================================================
// Реестр ссылок sketch'a на данные других модулей Raschet.
//
// v0.60.168 (по репорту Пользователя 2026-05-04 «нам тем более нужно связывать
// файлы (данные), которые мы будем генерировать в этом модуле»):
//
// Sketch (drawio-модуль) перестаёт быть «изолированным холстом» и становится
// первоклассным participant'ом проектных данных Raschet. Любой sketch может
// ссылаться на:
//   • проект целиком (метаданные, статус, location)
//   • стойку (rack-config: instances)
//   • главную схему (Конструктор схем)
//   • конфигурацию НКУ (panel-config), ИБП (ups-config), РУ-СН (mv-config),
//     трансформатора (transformer-config)
//   • кабельную линию (cable)
//   • другой sketch (cross-link между набросками)
//
// Архитектура:
//   1. RefRegistry (этот файл) — описание типов ссылок + discovery функции
//      для перечисления доступных entity текущего проекта.
//   2. shared/sketch-refs.js хранит ref'ы в LS:
//        raschet.sketch.<pid>.<sid>.refs.v1 = [{ id, refType, refId, label, ... }]
//   3. sketch-refs UI (sketch/sketch-refs-ui.js) — picker / sidebar / insert
//      в drawio через postMessage 'merge'.
//   4. Открытие entity: каждый refType знает свой URL-builder.
//
// API:
//   getRefTypes()                       → [{ id, label, icon, ... }]
//   listEntities(refType, pid)          → [{ id, label, sublabel?, ... }]
//   loadRefs(pid, sid)                  → ссылки sketch'a
//   saveRefs(pid, sid, refs)            → сохранить
//   addRef(pid, sid, ref)               → добавить (с дедупом по refType+refId)
//   removeRef(pid, sid, refUid)         → удалить
//   buildOpenUrl(ref, pid)              → URL для перехода в исходный модуль
//   resolveLabel(refType, refId, pid)   → актуальный label (если entity
//                                         переименовали в исходном модуле)
// =============================================================================

import { listProjects, getProject, listSubProjects } from './project-storage.js';

// ───────── LS-keys ──────────────────────────────────────────────────────────

const LS_REFS = (pid, sid) => `raschet.sketch.${pid}.${sid}.refs.v1`;

// ───────── Helpers ──────────────────────────────────────────────────────────

function loadJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function uid() {
  return 'rf_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ───────── Ref types registry ───────────────────────────────────────────────
// Каждый тип знает:
//   • id, label, icon, color (для drawio-shape)
//   • discover(pid) → entities[]    — что доступно в проекте pid
//   • urlOf(refId, pid) → string    — куда вести по клику
//   • labelOf(refId, pid) → string  — актуальное имя

const REF_TYPES = [
  // ─────────── Project ────────────────────────────────────────────────────
  {
    id: 'project',
    label: 'Проект',
    icon: '📁',
    color: '#1e40af',
    fill: '#dbeafe',
    discover: () => listProjects()
      .filter(p => p.kind !== 'sketch')
      .map(p => ({
        id: p.id,
        label: p.name || '(без имени)',
        sublabel: [p.designation, p.status].filter(Boolean).join(' · '),
      })),
    urlOf: (refId) => `../projects/?focus=${encodeURIComponent(refId)}`,
    labelOf: (refId) => {
      const p = getProject(refId);
      return p ? (p.name || '(без имени)') : '(удалён)';
    },
  },

  // ─────────── Rack (rack-config / scs-config) ────────────────────────────
  {
    id: 'rack',
    label: 'Стойка',
    icon: '🗄',
    color: '#0f766e',
    fill: '#ccfbf1',
    discover: (pid) => {
      // rack-storage хранит по активному проекту → читаем напрямую LS
      try {
        const key = `raschet.project.${pid}.rack-config.instances.v1`;
        const arr = loadJson(key, null);
        if (Array.isArray(arr) && arr.length) {
          return arr.map(r => ({
            id: r.id || r.tag,
            label: r.tag || r.name || r.id || '(rack)',
            sublabel: r.templateName || r.kind || '',
          }));
        }
      } catch {}
      // Fallback: глобальный (legacy / pre-1.27.3)
      try {
        const arr = loadJson('raschet.rack-config.instances.v1', []);
        return Array.isArray(arr) ? arr.map(r => ({
          id: r.id || r.tag,
          label: r.tag || r.name || r.id || '(rack)',
          sublabel: '(global)',
        })) : [];
      } catch { return []; }
    },
    urlOf: (refId, pid) => `../rack-config/?project=${encodeURIComponent(pid)}&rack=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => {
      try {
        const arr = loadJson(`raschet.project.${pid}.rack-config.instances.v1`, [])
                 || loadJson('raschet.rack-config.instances.v1', []);
        const r = (arr || []).find(x => x.id === refId || x.tag === refId);
        return r ? (r.tag || r.name || refId) : '(удалена)';
      } catch { return refId; }
    },
  },

  // ─────────── Schematic (Конструктор схем — главная схема) ───────────────
  {
    id: 'schema',
    label: 'Главная схема',
    icon: '⚡',
    color: '#7c3aed',
    fill: '#ede9fe',
    discover: (pid) => {
      // У проекта одна главная схема
      const key = `raschet.project.${pid}.engine.scheme.v1`;
      const has = !!localStorage.getItem(key);
      if (!has) return [];
      const p = getProject(pid);
      return [{
        id: 'main',
        label: p ? `Схема: ${p.name}` : 'Главная схема',
        sublabel: 'Конструктор схем',
      }];
    },
    urlOf: (_refId, pid) => `../index.html?project=${encodeURIComponent(pid)}`,
    labelOf: (_refId, pid) => {
      const p = getProject(pid);
      return p ? `Схема: ${p.name}` : 'Главная схема';
    },
  },

  // ─────────── Schematic editor (модуль schematic — рабочая документация) ─
  {
    id: 'schematic',
    label: 'Лист РД',
    icon: '📐',
    color: '#7c3aed',
    fill: '#ede9fe',
    discover: (pid) => {
      // schematic хранит листы как массив в проектном неймспейсе
      const key = `raschet.project.${pid}.schematic.sheets.v1`;
      const arr = loadJson(key, null);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((s, i) => ({
          id: s.id || `sheet-${i}`,
          label: s.name || s.title || `Лист ${i + 1}`,
          sublabel: s.format || s.size || '',
        }));
      }
      return [];
    },
    urlOf: (refId, pid) => `../schematic/?project=${encodeURIComponent(pid)}&sheet=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => {
      const arr = loadJson(`raschet.project.${pid}.schematic.sheets.v1`, []);
      const s = (arr || []).find(x => (x.id || '') === refId);
      return s ? (s.name || s.title || refId) : refId;
    },
  },

  // ─────────── НКУ (panel-config) ─────────────────────────────────────────
  {
    id: 'panel',
    label: 'НКУ (LV щит)',
    icon: '🟧',
    color: '#c2410c',
    fill: '#ffedd5',
    discover: (pid) => discoverModuleConfig(pid, 'panel-config'),
    urlOf: (refId, pid) => `../panel-config/?project=${encodeURIComponent(pid)}&config=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => labelOfModuleConfig(refId, pid, 'panel-config'),
  },

  // ─────────── ИБП (ups-config) ───────────────────────────────────────────
  {
    id: 'ups',
    label: 'ИБП',
    icon: '🔋',
    color: '#7e22ce',
    fill: '#f3e8ff',
    discover: (pid) => discoverModuleConfig(pid, 'ups-config'),
    urlOf: (refId, pid) => `../ups-config/?project=${encodeURIComponent(pid)}&config=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => labelOfModuleConfig(refId, pid, 'ups-config'),
  },

  // ─────────── РУ СН (mv-config) ──────────────────────────────────────────
  {
    id: 'mv',
    label: 'РУ СН',
    icon: '⚙',
    color: '#b45309',
    fill: '#fef3c7',
    discover: (pid) => discoverModuleConfig(pid, 'mv-config'),
    urlOf: (refId, pid) => `../mv-config/?project=${encodeURIComponent(pid)}&config=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => labelOfModuleConfig(refId, pid, 'mv-config'),
  },

  // ─────────── Трансформатор (transformer-config) ─────────────────────────
  {
    id: 'transformer',
    label: 'Трансформатор',
    icon: '🔵',
    color: '#1d4ed8',
    fill: '#dbeafe',
    discover: (pid) => discoverModuleConfig(pid, 'transformer-config'),
    urlOf: (refId, pid) => `../transformer-config/?project=${encodeURIComponent(pid)}&config=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => labelOfModuleConfig(refId, pid, 'transformer-config'),
  },

  // ─────────── Кабельная линия (cable) ────────────────────────────────────
  {
    id: 'cable',
    label: 'Кабельная линия',
    icon: '🟧',
    color: '#ea580c',
    fill: '#ffedd5',
    discover: (pid) => {
      const key = `raschet.project.${pid}.cable.lines.v1`;
      const arr = loadJson(key, null);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((l, i) => ({
          id: l.id || `cable-${i}`,
          label: l.tag || l.name || `Линия ${i + 1}`,
          sublabel: [l.section, l.length].filter(Boolean).join(' · '),
        }));
      }
      return [];
    },
    urlOf: (refId, pid) => `../cable/?project=${encodeURIComponent(pid)}&line=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => {
      const arr = loadJson(`raschet.project.${pid}.cable.lines.v1`, []);
      const l = (arr || []).find(x => (x.id || '') === refId);
      return l ? (l.tag || l.name || refId) : refId;
    },
  },

  // ─────────── Другой sketch ──────────────────────────────────────────────
  {
    id: 'sketch',
    label: 'Sketch',
    icon: '✏',
    color: '#475569',
    fill: '#e2e8f0',
    discover: (pid) => {
      try {
        const raw = localStorage.getItem(`raschet.sketch.${pid}.list.v1`);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.map(s => ({
          id: s.id,
          label: s.name || s.id,
          sublabel: '',
        })) : [];
      } catch { return []; }
    },
    urlOf: (refId, pid) => `../sketch/?project=${encodeURIComponent(pid)}&sketch=${encodeURIComponent(refId)}`,
    labelOf: (refId, pid) => {
      try {
        const raw = localStorage.getItem(`raschet.sketch.${pid}.list.v1`);
        const arr = raw ? JSON.parse(raw) : [];
        const s = (arr || []).find(x => x.id === refId);
        return s ? (s.name || refId) : refId;
      } catch { return refId; }
    },
  },
];

// ───────── Generic helpers for module-config storage ────────────────────────
// panel-config / ups-config / mv-config / transformer-config используют общий
// формат: subproject (kind='sketch', ownerModule=<moduleId>) + конфигурация
// в проектном неймспейсе. Сначала пробуем listSubProjects, потом fallback.

function discoverModuleConfig(pid, moduleId) {
  try {
    // 1. Подпроекты текущего проекта
    const subs = listSubProjects(pid, moduleId);
    if (Array.isArray(subs) && subs.length) {
      return subs.map(s => ({
        id: s.id,
        label: s.name || s.designation || s.id,
        sublabel: s.designation || moduleId,
      }));
    }
  } catch {}

  // 2. Fallback: глобальный единственный объект «raschet.<module>.v1»
  try {
    const raw = localStorage.getItem(`raschet.${moduleId}.v1`);
    if (raw) {
      const obj = JSON.parse(raw);
      const name = obj?.config?.name || obj?.name || obj?.designation || moduleId;
      return [{ id: 'default', label: name, sublabel: '(глобальный)' }];
    }
  } catch {}

  return [];
}

function labelOfModuleConfig(refId, pid, moduleId) {
  try {
    const subs = listSubProjects(pid, moduleId);
    const s = (subs || []).find(x => x.id === refId);
    if (s) return s.name || s.designation || refId;
  } catch {}
  if (refId === 'default') {
    try {
      const obj = JSON.parse(localStorage.getItem(`raschet.${moduleId}.v1`) || 'null');
      if (obj) return obj?.config?.name || obj?.name || moduleId;
    } catch {}
  }
  return refId;
}

// ───────── Public API ───────────────────────────────────────────────────────

export function getRefTypes() {
  return REF_TYPES.map(t => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    color: t.color,
    fill: t.fill,
  }));
}

export function getRefType(refTypeId) {
  return REF_TYPES.find(t => t.id === refTypeId) || null;
}

export function listEntities(refTypeId, pid) {
  const t = getRefType(refTypeId);
  if (!t) return [];
  try { return t.discover(pid) || []; } catch { return []; }
}

export function loadRefs(pid, sid) {
  if (!pid || !sid) return [];
  const arr = loadJson(LS_REFS(pid, sid), []);
  return Array.isArray(arr) ? arr : [];
}

export function saveRefs(pid, sid, refs) {
  if (!pid || !sid) return;
  saveJson(LS_REFS(pid, sid), Array.isArray(refs) ? refs : []);
}

export function addRef(pid, sid, ref) {
  if (!ref || !ref.refType || !ref.refId) return null;
  const list = loadRefs(pid, sid);
  // Дедуп: один и тот же refType+refId — не дублируем, обновляем label.
  const existing = list.find(x => x.refType === ref.refType && x.refId === ref.refId);
  if (existing) {
    existing.label = ref.label || existing.label;
    existing.note = ref.note || existing.note;
    existing.updatedAt = Date.now();
    saveRefs(pid, sid, list);
    return existing;
  }
  const newRef = {
    id: uid(),
    refType: ref.refType,
    refId: ref.refId,
    label: ref.label || ref.refId,
    note: ref.note || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(newRef);
  saveRefs(pid, sid, list);
  return newRef;
}

export function removeRef(pid, sid, refUid) {
  const list = loadRefs(pid, sid);
  const next = list.filter(x => x.id !== refUid);
  saveRefs(pid, sid, next);
  return next;
}

export function buildOpenUrl(ref, pid) {
  const t = getRefType(ref.refType);
  if (!t) return null;
  try { return t.urlOf(ref.refId, pid); } catch { return null; }
}

export function resolveLabel(refTypeId, refId, pid) {
  const t = getRefType(refTypeId);
  if (!t) return refId;
  try { return t.labelOf(refId, pid) || refId; } catch { return refId; }
}

// ───────── Reverse lookup ──────────────────────────────────────────────────
// v0.60.169 (Phase 3.5 — reverse-link UI): по refType+refId находит все
// sketch'и (текущего проекта или всех проектов), которые ссылаются на
// данный entity. Используется в исходных модулях (rack-config / schematic
// / panel-config / ups-config / …) для отображения чипа «📎 N sketch'ей»
// у каждого referenceable объекта.

export function findSketchesReferencing(refType, refId, pid) {
  if (!refType || !refId) return [];
  // pid обязателен — sketch list per-project. Если не задан — берём активный.
  if (!pid) {
    try {
      pid = localStorage.getItem('raschet.activeProjectId.v1');
      if (pid) pid = JSON.parse(pid);
    } catch {}
  }
  if (!pid) return [];

  // Список sketches проекта
  let sketchList = [];
  try {
    const raw = localStorage.getItem(`raschet.sketch.${pid}.list.v1`);
    sketchList = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sketchList)) sketchList = [];
  } catch { sketchList = []; }

  const matches = [];
  for (const sk of sketchList) {
    if (!sk || !sk.id) continue;
    const refs = loadRefs(pid, sk.id);
    const matched = refs.filter(r => r.refType === refType && r.refId === refId);
    if (matched.length) {
      matches.push({
        sketchId: sk.id,
        sketchName: sk.name || sk.id,
        refs: matched, // обычно 1 (дедуп), но на всякий случай array
      });
    }
  }
  return matches;
}

// Вернёт URL открытия sketch'a с уже выбранным элементом (если sketch.js
// в init читает ?sketch=…). Используется для перехода из reverse-chip.
export function buildSketchOpenUrl(sketchId, pid) {
  if (!sketchId) return null;
  const params = new URLSearchParams();
  if (pid) params.set('project', pid);
  params.set('sketch', sketchId);
  return `../sketch/?${params.toString()}`;
}

// ───────── Drawio cell XML builder ──────────────────────────────────────────
// Возвращает XML-fragment, готовый к merge в drawio через postMessage:
//   { action: 'merge', xml: '<mxGraphModel>...</mxGraphModel>' }
//
// Cell — UserObject с custom-атрибутами raschet.* (drawio сохраняет их).
// Style — rounded rectangle с заливкой/контуром по типу. Двойной клик в
// drawio показывает атрибуты — пользователь видит ссылку на entity.

export function buildDrawioCellXml(ref, opts = {}) {
  const t = getRefType(ref.refType);
  if (!t) return '';
  const x = Number(opts.x || 40);
  const y = Number(opts.y || 40);
  const w = Number(opts.w || 200);
  const h = Number(opts.h || 60);
  const id = `raschet-${ref.refType}-${ref.refId}-${Math.random().toString(36).slice(2, 6)}`;
  const label = `${t.icon} ${t.label}: ${escXml(ref.label || ref.refId)}`;
  const style = [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${t.fill}`,
    `strokeColor=${t.color}`,
    'strokeWidth=2',
    'fontSize=12',
    'fontStyle=1',
    'align=center',
    'verticalAlign=middle',
    'shadow=0',
  ].join(';');

  return `<mxGraphModel><root>`
       + `<mxCell id="0"/><mxCell id="1" parent="0"/>`
       + `<UserObject id="${escAttr(id)}" label="${escAttr(label)}" `
       +   `raschet.refType="${escAttr(ref.refType)}" `
       +   `raschet.refId="${escAttr(ref.refId)}" `
       +   `raschet.refLabel="${escAttr(ref.label || ref.refId)}" `
       +   `link="${escAttr(opts.link || '')}">`
       +   `<mxCell style="${escAttr(style)}" vertex="1" parent="1">`
       +     `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`
       +   `</mxCell>`
       + `</UserObject>`
       + `</root></mxGraphModel>`;
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escXml(s) {
  return escAttr(s);
}
