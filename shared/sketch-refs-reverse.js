// shared/sketch-refs-reverse.js
// =============================================================================
// Reverse-link UI: чип «📎 N sketch'ей» рядом с referenceable entity.
//
// v0.60.169 (Phase 3.5, по ROADMAP — продолжение v0.60.168):
//
// В исходных модулях (rack-config / schematic / panel-config / ups-config /
// mv-config / transformer-config / cable / projects), где Пользователь
// смотрит на конкретный объект (стойку, лист РД, конфигурацию НКУ, …),
// показывается небольшой чип:
//
//     📎 2 sketch'a   ← клик показывает popover со списком
//
// Click открывает popover с именами sketch'ей, click по имени — переход
// в sketch с уже подсвеченным объектом.
//
// API:
//   mountReverseLinkChip({ container, refType, refId, pid })
//     → возвращает HTMLElement чипа (вставлен в container).
//     Перерендерится auto при storage-event (другая вкладка добавила ref).
//
//   refreshAllChips()  — пересчитать все mounted чипы (после save/изменения
//                        в текущей вкладке).
// =============================================================================

import { findSketchesReferencing, buildSketchOpenUrl, getRefType } from './sketch-refs.js';

const _mounted = new Set(); // живые чипы для refreshAllChips

// CSS — инжектим один раз на страницу
let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.id = 'sketch-refs-reverse-css';
  style.textContent = `
    .sk-rev-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: 1px solid #93c5fd;
      background: #eff6ff;
      color: #1e40af;
      border-radius: 12px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      vertical-align: middle;
      user-select: none;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
      position: relative;
    }
    .sk-rev-chip:hover { background: #dbeafe; border-color: #60a5fa; }
    .sk-rev-chip.sk-rev-chip-empty {
      border-style: dashed;
      border-color: #cbd5e1;
      color: #94a3b8;
      background: transparent;
    }
    .sk-rev-chip.sk-rev-chip-empty:hover {
      border-color: #93c5fd;
      color: #1e40af;
      background: #eff6ff;
    }
    .sk-rev-chip-icon { font-size: 12px; }
    .sk-rev-popover {
      position: fixed;
      z-index: 2000;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      min-width: 240px;
      max-width: 320px;
      max-height: 320px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .sk-rev-popover-head {
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f9fafb;
      font-size: 12px;
      font-weight: 600;
      color: #1e40af;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sk-rev-popover-head button {
      border: 0; background: none; cursor: pointer;
      color: #64748b; font-size: 14px; padding: 0 4px;
    }
    .sk-rev-popover-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }
    .sk-rev-popover-item {
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      color: #0f172a;
    }
    .sk-rev-popover-item:hover { background: #eff6ff; }
    .sk-rev-popover-item-icon { font-size: 13px; }
    .sk-rev-popover-empty {
      padding: 16px 12px;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.4;
    }
    .sk-rev-popover-foot {
      padding: 6px 10px;
      border-top: 1px solid #e2e8f0;
      background: #f9fafb;
      font-size: 11px;
      color: #64748b;
      text-align: center;
    }
    .sk-rev-popover-foot a {
      color: #1e40af;
      text-decoration: none;
      font-weight: 500;
    }
    .sk-rev-popover-foot a:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
}

// Глобальный listener для closing popover'ов
let _activePopover = null;
function closePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
}
document.addEventListener('click', (e) => {
  if (!_activePopover) return;
  if (_activePopover.contains(e.target)) return;
  // Если клик по чипу-родителю — не закрываем (toggle сам разрулит)
  if (e.target.closest('.sk-rev-chip')) return;
  closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _activePopover) closePopover();
});

// Storage event — другая вкладка изменила refs → обновить все чипы
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (e.key.includes('.refs.v1') || e.key.includes('.list.v1')) {
    refreshAllChips();
  }
});

// ───────── Public API ───────────────────────────────────────────────────────

/**
 * Вставляет в container чип «📎 N sketch'ей» для данного entity.
 * @param {Object} opts
 * @param {HTMLElement} opts.container - куда вставить чип
 * @param {string} opts.refType - тип (rack/panel/ups/...)
 * @param {string} opts.refId - id entity
 * @param {string} [opts.pid] - проект (опционально, по умолчанию активный)
 * @param {boolean} [opts.hideEmpty] - скрыть чип если 0 ссылок (default: false — показывать «➕ Sketch»)
 * @returns {HTMLElement} - smonted чип
 */
export function mountReverseLinkChip(opts = {}) {
  ensureCss();
  const { container, refType, refId, pid, hideEmpty = false } = opts;
  if (!container || !refType || !refId) return null;

  const chip = document.createElement('span');
  chip.className = 'sk-rev-chip';
  chip.dataset.refType = refType;
  chip.dataset.refId = refId;
  if (pid) chip.dataset.pid = pid;
  chip.dataset.hideEmpty = hideEmpty ? '1' : '0';

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_activePopover && _activePopover.dataset.ownerKey === chipKey(chip)) {
      closePopover();
      return;
    }
    closePopover();
    showPopoverFor(chip);
  });

  container.appendChild(chip);
  _mounted.add(chip);
  renderChip(chip);

  // Auto-cleanup if removed from DOM (lazy GC при следующем refresh)
  return chip;
}

export function refreshAllChips() {
  // Чистим dead nodes
  for (const c of [..._mounted]) {
    if (!c.isConnected) _mounted.delete(c);
  }
  for (const c of _mounted) renderChip(c);
}

// ───────── Internals ────────────────────────────────────────────────────────

function chipKey(chip) {
  return `${chip.dataset.refType}::${chip.dataset.refId}::${chip.dataset.pid || ''}`;
}

function renderChip(chip) {
  const refType = chip.dataset.refType;
  const refId = chip.dataset.refId;
  const pid = chip.dataset.pid || undefined;
  const hideEmpty = chip.dataset.hideEmpty === '1';
  const matches = findSketchesReferencing(refType, refId, pid);
  const n = matches.length;

  if (n === 0) {
    if (hideEmpty) {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = '';
    chip.classList.add('sk-rev-chip-empty');
    chip.innerHTML = `
      <span class="sk-rev-chip-icon">📎</span>
      <span>нет sketch'ей</span>`;
    chip.title = 'Этот объект пока не упоминается ни в одном sketch\'е проекта. Откройте sketch и добавьте связь.';
    return;
  }
  chip.style.display = '';
  chip.classList.remove('sk-rev-chip-empty');
  chip.innerHTML = `
    <span class="sk-rev-chip-icon">📎</span>
    <span>${n} ${ruPluralSketches(n)}</span>`;
  chip.title = `Этот объект упоминается в ${n} sketch${n === 1 ? '\'е' : '\'ах'} текущего проекта. Кликните для списка.`;
}

function ruPluralSketches(n) {
  // 1 sketch / 2-4 sketch'a / 5+ sketch'ей
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'sketch';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'sketch\'a';
  return 'sketch\'ей';
}

function showPopoverFor(chip) {
  const refType = chip.dataset.refType;
  const refId = chip.dataset.refId;
  const pid = chip.dataset.pid || undefined;
  const matches = findSketchesReferencing(refType, refId, pid);
  const t = getRefType(refType);

  const pop = document.createElement('div');
  pop.className = 'sk-rev-popover';
  pop.dataset.ownerKey = chipKey(chip);

  let bodyHtml;
  if (matches.length === 0) {
    bodyHtml = `
      <div class="sk-rev-popover-empty">
        <div style="font-size:18px;margin-bottom:6px">📎</div>
        <div>Этот объект пока не упоминается<br>в sketch'ах проекта</div>
      </div>`;
  } else {
    bodyHtml = `<div class="sk-rev-popover-list">` +
      matches.map(m => `
        <div class="sk-rev-popover-item" data-sketch-id="${escAttr(m.sketchId)}">
          <span class="sk-rev-popover-item-icon">✏</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escHtml(m.sketchName)}</span>
          <span style="color:#64748b;font-size:11px">↗</span>
        </div>
      `).join('') +
      `</div>`;
  }

  pop.innerHTML = `
    <div class="sk-rev-popover-head">
      <span>${t ? t.icon + ' ' : ''}Где используется</span>
      <button type="button" data-act="close" title="Закрыть">✕</button>
    </div>
    ${bodyHtml}
    <div class="sk-rev-popover-foot">
      <a href="../sketch/${pid ? '?project=' + encodeURIComponent(pid) : ''}" target="_blank">Открыть модуль Скетч ↗</a>
    </div>
  `;

  // Position near chip
  document.body.appendChild(pop);
  positionPopover(pop, chip);

  pop.querySelectorAll('[data-sketch-id]').forEach(it => {
    it.addEventListener('click', () => {
      const sid = it.getAttribute('data-sketch-id');
      const url = buildSketchOpenUrl(sid, pid);
      if (url) window.open(url, '_blank');
      closePopover();
    });
  });
  pop.querySelector('[data-act="close"]')?.addEventListener('click', closePopover);

  _activePopover = pop;
}

function positionPopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const popW = pop.offsetWidth || 280;
  const popH = pop.offsetHeight || 200;
  let left = r.left;
  let top = r.bottom + 6;
  // Подстраиваем чтобы не вылезало за viewport
  if (left + popW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - popW - 8);
  }
  if (top + popH > window.innerHeight - 8) {
    top = Math.max(8, r.top - popH - 6);
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
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
