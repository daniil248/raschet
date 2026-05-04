// =============================================================================
// sketch/sketch.js — интеграция с drawio (jgraph/drawio).
// =============================================================================
// v0.60.166 (по репорту Пользователя 2026-05-04 «давай drawio просто заберем
// с гитхаба и интегрируем в наш продукт https://github.com/jgraph/drawio,
// вместо нашего псевдо drawio» + «обновлять так же будем с гитхаба»):
//
// Используем ОФИЦИАЛЬНЫЙ drawio через embed iframe + postMessage protocol.
// Документация: https://www.drawio.com/doc/faq/embed-mode
//
// Источник drawio:
//   1. ПЕРВЫЙ ПРИОРИТЕТ — self-hosted в ./drawio-app/index.html.
//      Скрипт обновления: sketch/update-drawio.sh выкачивает релиз
//      с https://github.com/jgraph/drawio. Версия в drawio-app/VERSION.
//   2. FALLBACK — https://embed.diagrams.net (официальный hosted
//      drawio, авто-обновляется мейнтейнерами).
//
// Состояние храним per-project per-sketch:
//   raschet.sketch.<pid>.<sketchId>.v2 — XML-данные drawio (mxGraph)
//   raschet.sketch.<pid>.list.v1 — список sketches { id, name, createdAt }
//
// Communication protocol (drawio embed JSON):
//   • drawio → app:  { event: 'init' }            // готов принимать данные
//   • app → drawio:  { action: 'load', xml: '...', autosave: 1 }
//   • drawio → app:  { event: 'save', xml: '...' }   // user pressed save
//   • drawio → app:  { event: 'autosave', xml: '...' } // periodic auto-save
//   • drawio → app:  { event: 'export', data: '...', format: 'svg|png' }
//   • drawio → app:  { event: 'exit' }
//   • app → drawio:  { action: 'export', format: 'xmlsvg' | 'xmlpng' }
// =============================================================================

import { rsToast, rsConfirm, rsPrompt } from '../shared/dialog.js';
import { getActiveProjectId } from '../shared/project-storage.js';

const _pid = (() => { try { return getActiveProjectId() || 'default'; } catch { return 'default'; } })();

// LS-keys
const LS_LIST = `raschet.sketch.${_pid}.list.v1`;
const lsKey = (sid) => `raschet.sketch.${_pid}.${sid}.v2`;

// State
let _activeSketchId = null;
let _modified = false;
let _drawioReady = false;
let _pendingLoad = null;

const $ = (id) => document.getElementById(id);

// ─── Source resolution: self-hosted vs CDN ──────────────────────────────────
async function resolveDrawioSrc() {
  // Try self-hosted ./drawio-app/index.html first (HEAD-check).
  const localPath = './drawio-app/index.html';
  try {
    const res = await fetch(localPath, { method: 'HEAD', cache: 'no-cache' });
    if (res.ok) {
      const params = '?embed=1&proto=json&spin=1&modified=unsavedChanges'
        + '&keepmodified=1&saveAndExit=0&noSaveBtn=0&libraries=1&ui=kennedy&lang=ru';
      return localPath + params;
    }
  } catch {}
  // Fallback: official hosted drawio (embed.diagrams.net).
  return 'https://embed.diagrams.net/?embed=1&proto=json&spin=1'
       + '&modified=unsavedChanges&keepmodified=1&saveAndExit=0'
       + '&noSaveBtn=0&libraries=1&ui=kennedy&lang=ru';
}

// ─── Sketches list (project-scoped) ────────────────────────────────────────
function loadSketchList() {
  try {
    const raw = localStorage.getItem(LS_LIST);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveSketchList(arr) {
  try { localStorage.setItem(LS_LIST, JSON.stringify(arr)); } catch {}
}
function loadSketchXml(sid) {
  try { return localStorage.getItem(lsKey(sid)) || ''; } catch { return ''; }
}
function saveSketchXml(sid, xml) {
  try { localStorage.setItem(lsKey(sid), String(xml || '')); } catch {}
}
function deleteSketchXml(sid) {
  try { localStorage.removeItem(lsKey(sid)); } catch {}
}

function ensureDefaultSketch() {
  let list = loadSketchList();
  if (!list.length) {
    const sid = 'sk-' + Date.now().toString(36);
    list = [{ id: sid, name: 'Sketch 1', createdAt: Date.now() }];
    saveSketchList(list);
  }
  return list;
}

// ─── UI rendering ───────────────────────────────────────────────────────────
function renderSketchSelect() {
  const sel = $('sk-sketch-sel');
  if (!sel) return;
  const list = loadSketchList();
  sel.innerHTML = list.map(s =>
    `<option value="${s.id}"${s.id === _activeSketchId ? ' selected' : ''}>${escAttr(s.name)}</option>`
  ).join('');
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(text) {
  const el = $('sk-status-text');
  if (el) el.textContent = text;
}

function setLoadingVisible(visible) {
  const el = $('sk-drawio-loading');
  if (el) el.classList.toggle('hidden', !visible);
}

// ─── Drawio postMessage protocol ────────────────────────────────────────────
function postToDrawio(msg) {
  const iframe = $('sk-drawio-iframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
}

function loadActiveIntoDrawio() {
  if (!_drawioReady) {
    _pendingLoad = true;
    return;
  }
  if (!_activeSketchId) return;
  const xml = loadSketchXml(_activeSketchId) || _emptyDiagram();
  postToDrawio({
    action: 'load',
    xml,
    autosave: 1,
  });
  _modified = false;
  setStatus(`✓ ${_currentSketchName()} загружен`);
}

function _currentSketchName() {
  const list = loadSketchList();
  return (list.find(s => s.id === _activeSketchId)?.name) || 'Sketch';
}

function _emptyDiagram() {
  return '<mxfile><diagram name="Page-1" id="initial">'
       + '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">'
       + '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root>'
       + '</mxGraphModel></diagram></mxfile>';
}

window.addEventListener('message', (ev) => {
  // drawio embed sends JSON strings.
  if (typeof ev.data !== 'string' || !ev.data.startsWith('{')) return;
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  switch (msg.event) {
    case 'init':
      _drawioReady = true;
      setLoadingVisible(false);
      if (_pendingLoad) {
        _pendingLoad = null;
        loadActiveIntoDrawio();
      }
      break;
    case 'save':
    case 'autosave':
      if (msg.xml && _activeSketchId) {
        saveSketchXml(_activeSketchId, msg.xml);
        _modified = false;
        const ts = new Date().toLocaleTimeString('ru-RU');
        setStatus(`✓ Сохранено в ${ts}`);
      }
      break;
    case 'export':
      _handleExportResponse(msg);
      break;
    case 'exit':
      // Editor требует выхода (мы embed — игнорируем; iframe persists).
      break;
    case 'configure':
      // drawio ready for config — currently не отправляем custom config.
      break;
    default:
      // ignore
  }
});

let _exportPendingCb = null;
function _handleExportResponse(msg) {
  if (!_exportPendingCb) return;
  const cb = _exportPendingCb;
  _exportPendingCb = null;
  cb(msg);
}

function exportFromDrawio(format) {
  return new Promise((resolve) => {
    _exportPendingCb = (msg) => resolve(msg);
    postToDrawio({ action: 'export', format });
    // Timeout-safety
    setTimeout(() => {
      if (_exportPendingCb) {
        _exportPendingCb = null;
        resolve(null);
      }
    }, 10000);
  });
}

// ─── Toolbar handlers ───────────────────────────────────────────────────────
function wireToolbar() {
  $('sk-save-btn')?.addEventListener('click', () => {
    // Trigger drawio's internal save event.
    postToDrawio({ action: 'export', format: 'xml' });
    // Drawio responds with 'export' event; handler saves to LS.
    // Дополнительно: «save» event тоже триггерится из drawio. На всякий
    // случай явно просим export xml (синоним save для embed mode).
    rsToast('Сохраняю…', 'info');
  });

  $('sk-export-svg')?.addEventListener('click', async () => {
    const r = await exportFromDrawio('xmlsvg');
    if (r && r.data) {
      _downloadDataUri(r.data, _currentSketchName() + '.svg');
    } else { rsToast('Ошибка экспорта SVG', 'err'); }
  });
  $('sk-export-png')?.addEventListener('click', async () => {
    const r = await exportFromDrawio('xmlpng');
    if (r && r.data) {
      _downloadDataUri(r.data, _currentSketchName() + '.png');
    } else { rsToast('Ошибка экспорта PNG', 'err'); }
  });
  $('sk-export-xml')?.addEventListener('click', async () => {
    const r = await exportFromDrawio('xml');
    if (r && r.xml) {
      _downloadText(r.xml, _currentSketchName() + '.drawio', 'application/xml');
    } else { rsToast('Ошибка экспорта XML', 'err'); }
  });

  $('sk-import-xml')?.addEventListener('click', () => $('sk-import-file').click());
  $('sk-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Replace current diagram.
      saveSketchXml(_activeSketchId, text);
      loadActiveIntoDrawio();
      rsToast(`✓ Импорт: ${file.name}`, 'ok');
    } catch (err) {
      rsToast('Ошибка импорта: ' + (err.message || err), 'err');
    }
    e.target.value = '';
  });

  $('sk-sketch-sel')?.addEventListener('change', (e) => {
    const sid = e.target.value;
    if (!sid || sid === _activeSketchId) return;
    _activeSketchId = sid;
    loadActiveIntoDrawio();
  });

  $('sk-new-sketch')?.addEventListener('click', async () => {
    const name = await rsPrompt('Имя нового sketch:', `Sketch ${loadSketchList().length + 1}`);
    if (!name || !name.trim()) return;
    const sid = 'sk-' + Date.now().toString(36);
    const list = loadSketchList();
    list.push({ id: sid, name: name.trim(), createdAt: Date.now() });
    saveSketchList(list);
    saveSketchXml(sid, _emptyDiagram());
    _activeSketchId = sid;
    renderSketchSelect();
    loadActiveIntoDrawio();
    rsToast(`✓ Создан «${name.trim()}»`, 'ok');
  });

  $('sk-rename-sketch')?.addEventListener('click', async () => {
    if (!_activeSketchId) return;
    const list = loadSketchList();
    const cur = list.find(s => s.id === _activeSketchId);
    if (!cur) return;
    const name = await rsPrompt('Новое имя:', cur.name);
    if (!name || !name.trim()) return;
    cur.name = name.trim();
    saveSketchList(list);
    renderSketchSelect();
    rsToast('✓ Переименовано', 'ok');
  });

  $('sk-delete-sketch')?.addEventListener('click', async () => {
    if (!_activeSketchId) return;
    const list = loadSketchList();
    const cur = list.find(s => s.id === _activeSketchId);
    if (!cur) return;
    const ok = await rsConfirm(`Удалить «${cur.name}»?`, 'Действие необратимо.', { okLabel: 'Удалить', cancelLabel: 'Отмена' });
    if (!ok) return;
    deleteSketchXml(_activeSketchId);
    const next = list.filter(s => s.id !== _activeSketchId);
    if (!next.length) {
      // Создаём дефолтный, чтобы всегда был хотя бы один.
      const sid = 'sk-' + Date.now().toString(36);
      next.push({ id: sid, name: 'Sketch 1', createdAt: Date.now() });
      _activeSketchId = sid;
    } else {
      _activeSketchId = next[0].id;
    }
    saveSketchList(next);
    renderSketchSelect();
    loadActiveIntoDrawio();
    rsToast('✓ Удалено', 'info');
  });

  // Ctrl+S = save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      $('sk-save-btn')?.click();
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function _downloadDataUri(dataUri, filename) {
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}
function _downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  _downloadDataUri(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Init ───────────────────────────────────────────────────────────────────
async function init() {
  ensureDefaultSketch();
  const list = loadSketchList();
  _activeSketchId = list[0]?.id;
  renderSketchSelect();
  wireToolbar();

  // Resolve drawio source: self-hosted first, fallback to embed.diagrams.net.
  setLoadingVisible(true);
  setStatus('Загрузка drawio…');
  const src = await resolveDrawioSrc();
  const isLocal = !src.startsWith('http');
  setStatus(isLocal
    ? '✓ drawio (self-hosted)'
    : '✓ drawio (embed.diagrams.net)');
  const iframe = $('sk-drawio-iframe');
  if (iframe) iframe.src = src;

  // Если drawio не отвечает init за 8 сек — подсказка о fallback.
  setTimeout(() => {
    if (!_drawioReady) {
      setStatus('⚠ drawio долго не отвечает. Проверьте интернет.');
    }
  }, 8000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
