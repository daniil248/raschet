// ======================================================================
// battery-calc.js — главный UI подпрограммы «Расчёт АКБ».
// Состоит из двух вкладок:
//   1. Справочник АКБ — загрузка XLSX, просмотр/удаление моделей
//   2. Расчёт разряда — выбор АКБ + параметры нагрузки → автономия
// ======================================================================

import { listBatteries, addBattery, removeBattery, clearCatalog, getBattery } from './battery-catalog.js';
import { parseBatteryXlsx } from './battery-data-parser.js';
import { calcAutonomy, calcRequiredBlocks } from './battery-discharge.js';

const fmt = (n, d = 2) => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(d);
};
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// ================= Каталог =================
function renderCatalog() {
  const wrap = document.getElementById('catalog-list');
  if (!wrap) return;
  const list = listBatteries();
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">Справочник пуст. Загрузите XLSX-файлы через «+ Загрузить» или используйте расчёт по усреднённой модели.</div>`;
    return;
  }
  const h = ['<table class="cat-table">'];
  h.push('<thead><tr><th>Поставщик</th><th>Модель</th><th>Химия</th><th>Блок</th><th>Ёмкость</th><th>Точек</th><th>Источник</th><th></th></tr></thead>');
  h.push('<tbody>');
  for (const b of list) {
    h.push(`<tr data-id="${escHtml(b.id)}">
      <td>${escHtml(b.supplier)}</td>
      <td><b>${escHtml(b.type)}</b></td>
      <td>${escHtml(b.chemistry || '—')}</td>
      <td>${fmt(b.blockVoltage)} В</td>
      <td>${b.capacityAh != null ? fmt(b.capacityAh) + ' А·ч' : '—'}</td>
      <td>${b.dischargeTable?.length || 0}</td>
      <td class="src">${escHtml(b.source || '')}</td>
      <td><button class="btn-sm btn-del" data-del="${escHtml(b.id)}">Удалить</button></td>
    </tr>`);
  }
  h.push('</tbody></table>');
  wrap.innerHTML = h.join('');
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del;
      if (!confirm('Удалить эту запись из справочника?')) return;
      removeBattery(id);
      renderCatalog();
      renderBatterySelector();
      flash('Удалено');
    });
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let addedModels = 0, failedFiles = 0;
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const entries = parseBatteryXlsx(buf, file.name);
      for (const e of entries) {
        addBattery(e);
        addedModels++;
      }
    } catch (e) {
      console.error('Failed to parse', file.name, e);
      failedFiles++;
    }
  }
  renderCatalog();
  renderBatterySelector();
  if (addedModels) flash(`Добавлено моделей: ${addedModels}${failedFiles ? ` (ошибок файлов: ${failedFiles})` : ''}`, 'success');
  else flash(`Не удалось распознать ни одного файла`, 'error');
}

function wireUpload() {
  const input = document.getElementById('upload-input');
  const dropZone = document.getElementById('upload-zone');
  if (!input || !dropZone) return;
  input.addEventListener('change', () => handleFiles(input.files));
  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('hover');
    handleFiles(e.dataTransfer.files);
  });

  const clrBtn = document.getElementById('btn-clear-catalog');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    if (!confirm('Очистить весь справочник АКБ?')) return;
    clearCatalog();
    renderCatalog();
    renderBatterySelector();
    flash('Справочник очищен');
  });
}

// ================= Селектор батареи в калькуляторе =================
function renderBatterySelector() {
  const sel = document.getElementById('calc-battery');
  if (!sel) return;
  const list = listBatteries();
  const cur = sel.value;
  let h = '<option value="">— средняя модель (без таблицы) —</option>';
  for (const b of list) {
    h += `<option value="${escHtml(b.id)}">${escHtml(b.supplier)} · ${escHtml(b.type)} (${fmt(b.blockVoltage)} В / ${b.capacityAh != null ? fmt(b.capacityAh) + ' А·ч' : '—'})</option>`;
  }
  sel.innerHTML = h;
  if (cur) sel.value = cur;
}

// ================= Расчёт =================
function doCalc() {
  const out = document.getElementById('calc-result');
  if (!out) return;
  const get = id => document.getElementById(id);
  const battery = get('calc-battery').value ? getBattery(get('calc-battery').value) : null;
  const chemistry = get('calc-chem').value;
  const loadKw = Number(get('calc-load').value) || 0;
  const dcVoltage = Number(get('calc-dcv').value) || 0;
  const strings = Math.max(1, Number(get('calc-strings').value) || 1);
  const endV = Number(get('calc-endv').value) || 1.75;
  const invEff = Math.max(0.5, Math.min(1, (Number(get('calc-inveff').value) || 94) / 100));
  const mode = get('calc-mode').value;
  const targetMin = Number(get('calc-target').value) || 10;
  const capacityAh = Number(get('calc-capAh').value) || 100;

  // Блоков в цепочке определяем из dcVoltage / blockVoltage
  const blockV = battery ? battery.blockVoltage : (Number(get('calc-blockv').value) || 12);
  const blocksPerString = Math.max(1, Math.round(dcVoltage / blockV) || 1);

  let html = '';
  if (mode === 'autonomy') {
    // Прямая задача: дано — сколько блоков, нагрузка → автономия
    const r = calcAutonomy({
      battery, loadKw, dcVoltage, strings, blocksPerString,
      endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
    });
    html += `<div class="result-block">`;
    html += `<div class="result-title">Автономия системы</div>`;
    html += `<div class="result-value">${Number.isFinite(r.autonomyMin) ? fmt(r.autonomyMin) + ' мин' : '∞'}</div>`;
    html += `<div class="result-sub">Метод: <b>${r.method === 'table' ? 'по таблице АКБ' : 'усреднённая модель'}</b></div>`;
    html += `<div class="result-sub">На блок: <b>${fmt(r.blockPowerW)} W</b>, всего блоков: <b>${strings * blocksPerString}</b> (${strings} × ${blocksPerString})</div>`;
    if (r.warnings.length) html += r.warnings.map(w => `<div class="warn">⚠ ${escHtml(w)}</div>`).join('');
    html += `</div>`;
  } else {
    // Обратная задача: дано — нагрузка + целевое время → сколько блоков
    const found = calcRequiredBlocks({
      battery, loadKw, dcVoltage, endV, invEff, chemistry,
      capacityAh: battery ? battery.capacityAh : capacityAh,
      blocksPerString,
      targetMin,
    });
    if (found) {
      html += `<div class="result-block">`;
      html += `<div class="result-title">Минимум блоков для автономии ≥ ${targetMin} мин</div>`;
      html += `<div class="result-value">${found.totalBlocks}</div>`;
      html += `<div class="result-sub">Цепочек: <b>${found.strings}</b> × блоков в цепочке: <b>${found.blocksPerString}</b></div>`;
      html += `<div class="result-sub">Реальная автономия: <b>${fmt(found.result.autonomyMin)} мин</b>, метод: <b>${found.result.method === 'table' ? 'по таблице' : 'среднее'}</b></div>`;
      html += `</div>`;
    } else {
      html += `<div class="result-block error">Не удалось подобрать конфигурацию в пределах 2000 блоков. Проверьте нагрузку / параметры.</div>`;
    }
  }
  out.innerHTML = html;
}

function wireCalcForm() {
  const form = document.getElementById('calc-form');
  if (!form) return;
  form.addEventListener('submit', e => { e.preventDefault(); doCalc(); });
  // Пересчёт при смене режима
  const modeSel = document.getElementById('calc-mode');
  modeSel.addEventListener('change', () => {
    document.querySelectorAll('[data-mode-only]').forEach(el => {
      const wanted = el.dataset.modeOnly;
      el.style.display = (wanted === modeSel.value) ? '' : 'none';
    });
  });
  modeSel.dispatchEvent(new Event('change'));
}

// ================= Вкладки =================
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

// ================= Bootstrap =================
window.addEventListener('DOMContentLoaded', () => {
  wireTabs();
  wireUpload();
  wireCalcForm();
  renderCatalog();
  renderBatterySelector();
});
