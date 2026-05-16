// meteo/util.js — общие утилиты, доступные источникам и UI.
// v0.59.894 (Etap C, plugin-arch)

export const newId = (p) => p + '-' + Math.random().toString(36).slice(2, 10);

// Базовые статистики по hourly[] (T в °C).
export function computeStats(hourly) {
  if (!Array.isArray(hourly) || !hourly.length) return { tmin: 0, tmax: 0, tmean: 0, t99: 0, freecoolHours: 0, n: 0 };
  const temps = hourly.map(h => Number(h.T)).filter(Number.isFinite);
  if (!temps.length) return { tmin: 0, tmax: 0, tmean: 0, t99: 0, freecoolHours: 0, n: 0 };
  const sorted = [...temps].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    tmin: Math.round(sorted[0] * 10) / 10,
    tmax: Math.round(sorted[n - 1] * 10) / 10,
    tmean: Math.round((sum / n) * 10) / 10,
    t99: Math.round(sorted[Math.min(n - 1, Math.floor(n * 0.99))] * 10) / 10,
    freecoolHours: temps.filter(t => t < 14).length,
    n,
  };
}

export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const escAttr = escHtml;

// Inline modal-builder. Источник вызывает modalOpen(...) с body-разметкой и
// async-обработчиком, который возвращает либо готовый dataset (закроет модалку)
// либо null/false (модалка остаётся, чтобы пользователь поправил ввод).
export function modalOpen(headHtml, bodyHtml, onOk) {
  const overlay = document.createElement('div');
  overlay.className = 'mt-modal-overlay';
  overlay.innerHTML = `<div class="mt-modal" role="dialog">
    <div class="mt-modal-head">${headHtml}</div>
    <div class="mt-modal-body">${bodyHtml}</div>
    <div class="mt-modal-actions">
      <button type="button" class="mt-modal-btn mt-modal-cancel">Отмена</button>
      <button type="button" class="mt-modal-btn mt-modal-ok">OK</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  let resolveFn;
  const promise = new Promise(res => { resolveFn = res; });
  const close = (val) => { overlay.remove(); resolveFn(val); };
  overlay.querySelector('.mt-modal-cancel').addEventListener('click', () => close(null));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
  overlay.querySelector('.mt-modal-ok').addEventListener('click', async () => {
    const okBtn = overlay.querySelector('.mt-modal-ok');
    okBtn.textContent = '…'; okBtn.disabled = true;
    const result = await onOk(overlay);
    if (result) close(result);
    else { okBtn.textContent = 'OK'; okBtn.disabled = false; }
  });
  return promise;
}

export function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `mt-toast mt-toast-${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2800);
}

export function readFileAsText(file, encoding = 'utf-8') {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file, encoding);
  });
}
