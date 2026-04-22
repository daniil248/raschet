// =========================================================================
// shared/sidebar-resizer.js (v0.59.180)
// Универсальный resizable sidebar для всех подпрограмм. Привязывает
// перетаскиваемую ручку (.rs-sidebar-resizer) к любому <aside> с классом
// .rs-sidebar-left / .rs-sidebar-right. Ширина пишется в CSS-переменную
// (--rs-sidebar-left-w / --rs-sidebar-right-w) на :root и сохраняется в
// localStorage, чтобы значение было единым для всех подпрограмм.
//
// Использование:
//   import { mountSidebarResizers } from '../shared/sidebar-resizer.js';
//   mountSidebarResizers();  // на DOMContentLoaded — пройтись по всем
//                            // .rs-sidebar в документе и привязать ручки.
//
// Ограничения ширины — из CSS-переменных (--rs-sidebar-min-w/max-w),
// fallback 180…560 px.
// =========================================================================

const LS_LEFT  = 'raschet.rs-sidebar-left-w';
const LS_RIGHT = 'raschet.rs-sidebar-right-w';

function readRange() {
  const cs = getComputedStyle(document.documentElement);
  const min = parseInt(cs.getPropertyValue('--rs-sidebar-min-w'), 10) || 180;
  const max = parseInt(cs.getPropertyValue('--rs-sidebar-max-w'), 10) || 560;
  return { min, max };
}

function applySavedWidths() {
  const { min, max } = readRange();
  try {
    const l = parseInt(localStorage.getItem(LS_LEFT) || '0', 10);
    if (l >= min && l <= max) {
      document.documentElement.style.setProperty('--rs-sidebar-left-w', l + 'px');
    }
  } catch {}
  try {
    const r = parseInt(localStorage.getItem(LS_RIGHT) || '0', 10);
    if (r >= min && r <= max) {
      document.documentElement.style.setProperty('--rs-sidebar-right-w', r + 'px');
    }
  } catch {}
}

function bindResizer(sidebar) {
  const handle = sidebar.querySelector(':scope > .rs-sidebar-resizer');
  if (!handle) return;
  const isRight = sidebar.classList.contains('rs-sidebar-right');
  const cssVar = isRight ? '--rs-sidebar-right-w' : '--rs-sidebar-left-w';
  const lsKey  = isRight ? LS_RIGHT : LS_LEFT;

  let startX = 0, startW = 0, dragging = false;

  handle.addEventListener('mousedown', ev => {
    ev.preventDefault();
    dragging = true;
    startX = ev.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add('rs-dragging');
    document.body.classList.add('rs-sidebar-resizing');
  });

  document.addEventListener('mousemove', ev => {
    if (!dragging) return;
    const { min, max } = readRange();
    const dx = ev.clientX - startX;
    const newW = Math.max(min, Math.min(max, startW + (isRight ? -dx : dx)));
    document.documentElement.style.setProperty(cssVar, newW + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('rs-dragging');
    document.body.classList.remove('rs-sidebar-resizing');
    try {
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
      const { min, max } = readRange();
      if (w >= min && w <= max) localStorage.setItem(lsKey, String(w));
    } catch {}
    // разослать событие: чувствительные к размерам компоненты могут перерисоваться
    try { window.dispatchEvent(new Event('resize')); } catch {}
  });
}

export function mountSidebarResizers(root = document) {
  applySavedWidths();
  const list = root.querySelectorAll('.rs-sidebar');
  list.forEach(bindResizer);
}

// Автозапуск, если скрипт подключён как module без явного вызова.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountSidebarResizers());
  } else {
    mountSidebarResizers();
  }
}
