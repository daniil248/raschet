// =========================================================================
// meteo.js — v0.59.894 (Etap C, plugin-arch)
//
// Stand-alone модуль метеоданных. Хранит набор «датасетов» (наборов
// почасовых метеоизмерений) внутри активного проекта.
//
// Архитектура:
//   meteo.js              — UI-ядро: список датасетов, активный, гистограмма.
//   meteo/util.js         — общие утилиты (computeStats, modalOpen, toast).
//   meteo/sources/        — плагины источников. Каждый файл = отдельный
//                           источник, регистрирующийся через registry. Чтобы
//                           добавить новый — кладёте файл, импортируете в
//                           sources/index.js, и кнопка появляется в UI.
//
// Data shape (dataset):
//   { id, name, source, lat, lon, locationName, dateFrom, dateTo,
//     hourly: [{ t: ISO, T: °C, RH: %, wind: m/s }],
//     stats: { tmin, tmax, tmean, t99, freecoolHours, n },
//     activeForProject: bool, createdAt }
//
// LS keys:
//   raschet.project.<pid>.meteo.datasets.v1
//   raschet.project.<pid>.meteo.activeId.v1
// =========================================================================

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';
import * as util from './util.js';
import { getAll as getSources } from './sources/index.js';

const $ = (id) => document.getElementById(id);

let _pid = null;
let _datasets = [];
let _activeId = null;

const KEY_DATA = ['meteo', 'datasets.v1'];
const KEY_ACTIVE = ['meteo', 'activeId.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try { const raw = localStorage.getItem(projectKey(_pid, ...suffix)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}

function persist() {
  saveJson(KEY_DATA, _datasets);
  saveJson(KEY_ACTIVE, _activeId);
}

// ─── Render: sources buttons (генерируется автоматически из registry)
function renderImportButtons() {
  const aside = document.querySelector('.mt-sidebar');
  if (!aside) return;
  // Найдём секцию «Импорт» — она содержит mt-import-* кнопки. Очистим всё,
  // что было в HTML по умолчанию, и сгенерим из плагинов.
  const importSection = aside.querySelector('.mt-section:nth-child(2)');
  if (!importSection) return;
  const sources = getSources();
  importSection.innerHTML = `<h3>➕ Импорт</h3>` + sources.map(s =>
    `<button type="button" class="mt-action-btn" data-src-id="${util.escAttr(s.id)}" title="${util.escAttr(s.description || '')}">${util.escHtml(s.label)}</button>`
  ).join('') + (sources.length === 0 ? '<div class="mt-empty-list">Нет зарегистрированных источников.</div>' : '');

  importSection.querySelectorAll('button[data-src-id]').forEach(btn => {
    btn.addEventListener('click', () => importViaSource(btn.dataset.srcId));
  });
}

async function importViaSource(srcId) {
  const sources = getSources();
  const src = sources.find(s => s.id === srcId);
  if (!src) return;
  const ctx = { util };
  const ds = await src.createDataset(ctx);
  if (!ds) return;
  // Финализируем
  const dataset = {
    id: util.newId('ds'),
    activeForProject: !_datasets.some(d => d.activeForProject),
    createdAt: Date.now(),
    ...ds,
  };
  _datasets.unshift(dataset);
  _activeId = dataset.id;
  persist();
  renderDatasetsList();
  renderActive();
  util.toast(`Загружено ${(ds.hourly || []).length} строк (${ds.stats?.tmin}…${ds.stats?.tmax} °C)`, 'ok');
}

// ─── Render: список датасетов
function renderDatasetsList() {
  const root = $('mt-datasets-list');
  if (!root) return;
  if (!_datasets.length) {
    root.innerHTML = '<div class="mt-empty-list">Нет датасетов.<br>Используйте кнопки ➕ Импорт.</div>';
    return;
  }
  const SRC_ICONS = {
    'open-meteo': '🌐', 'rp5': '📥', 'manual': '✏',
  };
  root.innerHTML = _datasets.map(d => {
    const star = d.activeForProject ? '⭐ ' : '';
    const cls = d.id === _activeId ? 'mt-dataset-row active' : 'mt-dataset-row';
    const period = `${d.dateFrom || '?'} … ${d.dateTo || '?'}`;
    const srcIcon = SRC_ICONS[d.source] || '📊';
    return `<div class="${cls}" data-id="${util.escAttr(d.id)}">
      <span class="mt-dataset-name">${star}${util.escHtml(d.name)}</span>
      <span class="mt-dataset-meta">${srcIcon} ${util.escHtml(d.source)} · ${util.escHtml(period)}</span>
      <span class="mt-dataset-actions">
        <button type="button" data-act="activate" data-id="${util.escAttr(d.id)}" title="Сделать активным для проекта">⭐</button>
        <button type="button" data-act="rename" data-id="${util.escAttr(d.id)}" title="Переименовать">✏</button>
        <button type="button" data-act="delete" data-id="${util.escAttr(d.id)}" title="Удалить">🗑</button>
      </span>
    </div>`;
  }).join('');
}

// ─── Render: активный датасет (правая панель)
function renderActive() {
  const d = _datasets.find(x => x.id === _activeId);
  const empty = $('mt-empty');
  const pane = $('mt-active-pane');
  if (!d) {
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    $('mt-active-name').textContent = '— нет датасета —';
    $('mt-active-meta').textContent = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  const star = d.activeForProject ? ' ⭐' : '';
  $('mt-active-name').textContent = d.name + star;
  $('mt-active-meta').textContent = `${d.locationName || ''} · ${d.lat ? d.lat.toFixed(3) : '—'}, ${d.lon ? d.lon.toFixed(3) : '—'} · ${d.dateFrom || ''}—${d.dateTo || ''} · ${(d.hourly || []).length} записей`;

  const s = d.stats || util.computeStats(d.hourly || []);
  $('mt-kpi-tmean').textContent = `${s.tmean} °C`;
  $('mt-kpi-tmin').textContent = `${s.tmin} °C`;
  $('mt-kpi-tmax').textContent = `${s.tmax} °C`;
  $('mt-kpi-t99').textContent = `${s.t99} °C`;
  $('mt-kpi-fc').textContent = `${s.freecoolHours} ч`;
  $('mt-kpi-n').textContent = `${s.n}`;

  drawHistogram(d);
  drawSummary(d, s);
}

function drawHistogram(d) {
  const cvs = $('mt-hist-canvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const temps = (d.hourly || []).map(h => Number(h.T)).filter(Number.isFinite);
  if (!temps.length) return;
  const tmin = Math.floor(Math.min(...temps));
  const tmax = Math.ceil(Math.max(...temps));
  const bins = [];
  for (let t = tmin; t <= tmax; t++) bins.push({ t, count: 0 });
  for (const v of temps) {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor(v - tmin)));
    bins[idx].count++;
  }
  const maxCount = Math.max(...bins.map(b => b.count));
  const padL = 40, padR = 10, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / bins.length;
  // FreeCool zone (T<14°C) — зелёная подложка
  const fc14idx = bins.findIndex(b => b.t > 14);
  if (fc14idx > 0) {
    ctx.fillStyle = 'rgba(22, 163, 74, 0.08)';
    ctx.fillRect(padL, padT, fc14idx * bw, plotH);
  }
  ctx.fillStyle = '#3b82f6';
  bins.forEach((b, i) => {
    const x = padL + i * bw;
    const h = (b.count / maxCount) * plotH;
    ctx.fillRect(x + 1, padT + plotH - h, Math.max(1, bw - 2), h);
  });
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].t % 5 === 0) {
      const x = padL + i * bw + bw / 2;
      ctx.fillText(bins[i].t + '°', x, H - 6);
    }
  }
  ctx.textAlign = 'right';
  ctx.fillText(maxCount, padL - 4, padT + 10);
  ctx.fillText('0', padL - 4, padT + plotH);
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH); ctx.lineTo(W - padR, padT + plotH);
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
  ctx.stroke();
}

function drawSummary(d, s) {
  const sum = $('mt-summary');
  if (!sum) return;
  const cdd = (d.hourly || []).reduce((acc, h) => acc + Math.max(0, (Number(h.T) || 0) - 18), 0) / 24;
  const hdd = (d.hourly || []).reduce((acc, h) => acc + Math.max(0, 18 - (Number(h.T) || 0)), 0) / 24;
  const sortedT = [...(d.hourly || []).map(h => Number(h.T)).filter(Number.isFinite)].sort((a, b) => a - b);
  const t1 = sortedT.length ? sortedT[Math.floor(sortedT.length * 0.01)] : '—';
  sum.innerHTML = `<table>
    <tbody>
      <tr><th>Источник</th><td>${util.escHtml(d.source)}</td></tr>
      <tr><th>Локация</th><td>${util.escHtml(d.locationName || '')} (${d.lat?.toFixed(3) || '—'}, ${d.lon?.toFixed(3) || '—'})</td></tr>
      <tr><th>Период</th><td>${util.escHtml(d.dateFrom || '')} — ${util.escHtml(d.dateTo || '')}</td></tr>
      <tr><th>HDD (база 18 °C)</th><td class="num">${hdd.toFixed(0)} °C·сут</td></tr>
      <tr><th>CDD (база 18 °C)</th><td class="num">${cdd.toFixed(0)} °C·сут</td></tr>
      <tr><th>Часы FreeCool (T &lt; 14 °C)</th><td class="num">${s.freecoolHours} ч (${(s.freecoolHours / Math.max(1, s.n) * 100).toFixed(1)}%)</td></tr>
      <tr><th>T 1% (≈ tmin расчётная)</th><td class="num">${typeof t1 === 'number' ? t1.toFixed(1) : t1} °C</td></tr>
    </tbody>
  </table>`;
}

// ─── Init
function init() {
  _pid = ensureDefaultProject();
  _datasets = loadJson(KEY_DATA, []) || [];
  _activeId = loadJson(KEY_ACTIVE, null);
  if (_activeId && !_datasets.some(d => d.id === _activeId)) _activeId = _datasets[0]?.id || null;

  renderImportButtons();
  renderDatasetsList();
  renderActive();

  $('mt-datasets-list').addEventListener('click', async (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const id = actBtn.dataset.id;
      const act = actBtn.dataset.act;
      if (act === 'activate') {
        for (const d of _datasets) d.activeForProject = (d.id === id);
        persist(); renderDatasetsList(); renderActive();
        util.toast('Датасет помечен ⭐ для проекта', 'ok');
      } else if (act === 'rename') {
        const d = _datasets.find(x => x.id === id);
        if (!d) return;
        const newName = await mtPrompt('Новое название', d.name);
        if (newName == null) return;
        d.name = newName.trim() || d.name;
        persist(); renderDatasetsList(); renderActive();
      } else if (act === 'delete') {
        const ok = await mtConfirm(`Удалить датасет «${_datasets.find(x => x.id === id)?.name}»?`);
        if (!ok) return;
        _datasets = _datasets.filter(d => d.id !== id);
        if (_activeId === id) _activeId = _datasets[0]?.id || null;
        persist(); renderDatasetsList(); renderActive();
      }
      return;
    }
    const row = e.target.closest('.mt-dataset-row');
    if (row) {
      _activeId = row.dataset.id;
      persist();
      renderDatasetsList(); renderActive();
    }
  });
}

function mtConfirm(msg, title = 'Подтверждение') {
  return util.modalOpen(`<h3>${util.escHtml(title)}</h3>`, `<p>${util.escHtml(msg)}</p>`, async () => true);
}
function mtPrompt(label, def = '') {
  return util.modalOpen(`<h3>Ввод значения</h3>`,
    `<label>${util.escHtml(label)}:<input type="text" id="mt-prompt-input" value="${util.escAttr(def)}" autofocus></label>`,
    async () => {
      const val = document.getElementById('mt-prompt-input').value;
      return val;
    });
}

document.addEventListener('DOMContentLoaded', init);
