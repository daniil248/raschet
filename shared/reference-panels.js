// shared/reference-panels.js
// v0.59.233: справочные панели переносятся в левый выдвижной сайдбар.
// Любая секция с атрибутом data-reference-panel="1" автоматически
// извлекается из потока и монтируется в drawer слева. По умолчанию drawer
// свёрнут; открывается кликом по узкому вертикальному таб-хэндлу «📚 Справочник».
// Состояние (open/closed) запоминается в localStorage на страницу.
// v0.59.232 (deprecated): перенос в конец родителя. Оставлен fallback: если
// drawer не смонтирован (например, iframe без body), просто сдвигаем в конец.

const LS_KEY = 'raschet.refDrawer.open.v1:' + (location.pathname || '/');

function buildDrawer() {
  if (document.getElementById('rs-ref-drawer')) return document.getElementById('rs-ref-drawer');

  const style = document.createElement('style');
  style.textContent = `
    #rs-ref-drawer{position:fixed;left:0;top:0;bottom:0;width:420px;max-width:90vw;
      background:#f8fafc;border-right:1px solid #cbd5e1;box-shadow:2px 0 12px rgba(0,0,0,.08);
      transform:translateX(-100%);transition:transform .22s ease;z-index:9998;
      display:flex;flex-direction:column;overflow:hidden}
    #rs-ref-drawer.is-open{transform:translateX(0)}
    #rs-ref-drawer .rs-ref-head{flex:0 0 auto;padding:10px 14px;border-bottom:1px solid #e2e8f0;
      display:flex;align-items:center;gap:8px;background:#fff;font-weight:600;color:#334155}
    #rs-ref-drawer .rs-ref-head .rs-ref-title{flex:1;font-size:13px;letter-spacing:.3px}
    #rs-ref-drawer .rs-ref-head button{background:#e2e8f0;border:0;border-radius:6px;
      padding:4px 10px;cursor:pointer;font-size:12px;color:#334155}
    #rs-ref-drawer .rs-ref-head button:hover{background:#cbd5e1}
    #rs-ref-drawer .rs-ref-body{flex:1;overflow:auto;padding:12px}
    #rs-ref-drawer .rs-ref-body > section + section{margin-top:16px}
    #rs-ref-handle{position:fixed;left:0;top:50%;transform:translateY(-50%);
      background:#1e293b;color:#fff;border:0;border-radius:0 10px 10px 0;
      padding:12px 6px;cursor:pointer;z-index:9997;writing-mode:vertical-rl;
      text-orientation:mixed;font-size:12px;letter-spacing:1px;box-shadow:2px 0 6px rgba(0,0,0,.15)}
    #rs-ref-handle:hover{background:#0f172a}
    #rs-ref-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.35);
      opacity:0;pointer-events:none;transition:opacity .22s;z-index:9996}
    #rs-ref-backdrop.is-open{opacity:1;pointer-events:auto}
  `;
  document.head.appendChild(style);

  const drawer = document.createElement('aside');
  drawer.id = 'rs-ref-drawer';
  drawer.setAttribute('aria-label', 'Справочники');
  drawer.innerHTML = `
    <div class="rs-ref-head">
      <span class="rs-ref-title">📚 Справочники / база данных</span>
      <button type="button" id="rs-ref-close" title="Закрыть">✕ Закрыть</button>
    </div>
    <div class="rs-ref-body" id="rs-ref-body"></div>
  `;
  document.body.appendChild(drawer);

  const backdrop = document.createElement('div');
  backdrop.id = 'rs-ref-backdrop';
  document.body.appendChild(backdrop);

  const handle = document.createElement('button');
  handle.id = 'rs-ref-handle';
  handle.type = 'button';
  handle.title = 'Открыть справочники';
  handle.textContent = '📚 Справочник';
  document.body.appendChild(handle);

  function setOpen(open) {
    drawer.classList.toggle('is-open', !!open);
    backdrop.classList.toggle('is-open', !!open);
    try { localStorage.setItem(LS_KEY, open ? '1' : '0'); } catch {}
  }
  handle.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  drawer.querySelector('#rs-ref-close').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false); });

  try { if (localStorage.getItem(LS_KEY) === '1') setOpen(true); } catch {}
  return drawer;
}

function move() {
  const refs = Array.from(document.querySelectorAll('[data-reference-panel="1"]'));
  if (!refs.length) return;
  if (!document.body) return;

  const drawer = buildDrawer();
  const body = drawer.querySelector('#rs-ref-body');
  refs.forEach(el => { body.appendChild(el); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', move);
} else {
  move();
}
