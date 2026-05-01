/* shared/draggable-modal.js — универсальный helper для перетаскиваемых
   модалок. По проектной директиве (v0.59.966):
   «все модальные окна кроме модальных окон предупреждений должны быть
   перемещаемые, это для всего проекта».

   Использование:
     import { makeDraggable } from '../shared/draggable-modal.js';
     // overlay создан, modal + head внутри
     makeDraggable(overlay, '.my-modal', '.my-modal-head');

   ИСКЛЮЧЕНИЕ: модалки-предупреждения (alert-style) перемещать НЕ нужно —
   их обычно надо подтвердить «здесь и сейчас», перемещение лишнее.

   Реализация: cursor:move на header, mousedown→drag, mousemove→
   обновление .left/.top, mouseup→cleanup. CSS переключает overlay в
   flex-start (вместо center) и modal в absolute-position для свободного
   перемещения.
*/

export function makeDraggable(overlay, modalSel, headSel) {
  const modal = typeof modalSel === 'string' ? overlay.querySelector(modalSel) : modalSel;
  const head  = typeof headSel  === 'string' ? overlay.querySelector(headSel)  : headSel;
  if (!modal || !head) return;
  head.style.cursor = 'move';
  head.style.userSelect = 'none';
  let dragging = false, sx = 0, sy = 0, dx = 0, dy = 0;
  const onDown = (e) => {
    if (e.target.closest('button, input, select, textarea, a')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const rect = modal.getBoundingClientRect();
    dx = rect.left; dy = rect.top;
    modal.style.position = 'absolute';
    modal.style.left = dx + 'px';
    modal.style.top  = dy + 'px';
    modal.style.margin = '0';
    overlay.style.alignItems = 'flex-start';
    overlay.style.justifyContent = 'flex-start';
    document.body.classList.add('rs-dragging');
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    modal.style.left = (dx + e.clientX - sx) + 'px';
    modal.style.top  = (dy + e.clientY - sy) + 'px';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('rs-dragging');
  };
  head.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // Cleanup когда overlay удаляется из DOM
  const obs = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
}

/* autoApply — добавляет drag ВСЕМ модалкам по селекторам, использует
   MutationObserver для новых модалок. Достаточно вызвать ОДИН раз
   при загрузке модуля. */
export function autoApply(modalConfigs) {
  // modalConfigs: [{ overlay: '.x-overlay', modal: '.x-modal', head: '.x-head' }, ...]
  const apply = () => {
    for (const cfg of modalConfigs) {
      document.querySelectorAll(cfg.overlay).forEach(o => {
        if (o._dragWired) return;
        o._dragWired = true;
        makeDraggable(o, cfg.modal, cfg.head);
      });
    }
  };
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(document.body, { childList: true, subtree: true });
}
