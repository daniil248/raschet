// =============================================================================
// shared/wheel-zoom.js — универсальный wheel-handler с Ctrl+scroll и cursor-anchored зум
// =============================================================================
// Принцип (зафиксирован Пользователем 2026-05-02):
//   • Без Ctrl/Cmd — wheel НЕ перехватывается, страница скроллится нативно.
//   • Ctrl+wheel (или Cmd на Mac) — zoom с anchor под курсором: world-точка
//     под мышью остаётся на месте после изменения масштаба.
//
// API:
//   attachWheelZoom(targetEl, {
//     getZoom:    () => number,
//     getPan:     () => ({x, y}),     // pan в SCREEN-координатах относительно targetEl
//     setZoomPan: (zoom, pan) => void,
//     min: 0.1, max: 5,                // лимиты
//     step: 1.1,                       // multiplier per wheel notch
//   })
//
// Возвращает функцию detach() для снятия слушателя.

/**
 * @param {HTMLElement} el
 * @param {object} opts
 *   @param {function():number} opts.getZoom
 *   @param {function():{x,y}} opts.getPan
 *   @param {function(number, {x,y})} opts.setZoomPan
 *   @param {number=} opts.min
 *   @param {number=} opts.max
 *   @param {number=} opts.step
 * @returns {function()} detach
 */
export function attachWheelZoom(el, opts) {
  if (!el || !opts || typeof opts.setZoomPan !== 'function') return () => {};
  const min = opts.min ?? 0.1;
  const max = opts.max ?? 5;
  const step = opts.step ?? 1.1;

  function onWheel(e) {
    // По требованию: zoom только при нажатии Ctrl/Cmd. Без модификатора —
    // дать странице нативно проскроллиться.
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;   // screen-координаты курсора в el
    const cy = e.clientY - rect.top;

    const oldZoom = opts.getZoom() || 1;
    const factor = -e.deltaY > 0 ? step : 1 / step;
    const newZoom = Math.max(min, Math.min(max, oldZoom * factor));
    if (newZoom === oldZoom) return;

    const oldPan = opts.getPan() || { x: 0, y: 0 };
    // Anchor: точка под курсором (cx, cy) в world-координатах:
    //   world = (screen - pan) / zoom
    // После zoom-change хотим: (cx - newPan) / newZoom == (cx - oldPan) / oldZoom
    //   newPan = cx - (cx - oldPan) * (newZoom / oldZoom)
    const k = newZoom / oldZoom;
    const newPan = {
      x: cx - (cx - oldPan.x) * k,
      y: cy - (cy - oldPan.y) * k,
    };
    opts.setZoomPan(newZoom, newPan);
  }

  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
