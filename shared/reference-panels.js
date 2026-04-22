// shared/reference-panels.js
// v0.59.232: универсальный перенос «справочных» панелей в конец контента.
// Любая секция с атрибутом data-reference-panel="1" автоматически
// перемещается в конец своего родителя при DOMContentLoaded.
// Справочник — БД, а не основной инструмент; основной флоу страницы
// (мастер / расчёт / конфиг) должен быть сверху, справочник — внизу.
// Перед перенесёнными секциями вставляется разделитель «Справочники».
// Полноценный перенос в левый сайдбар — отдельная UI-фаза.

function move() {
  const refs = Array.from(document.querySelectorAll('[data-reference-panel="1"]'));
  if (!refs.length) return;
  // Группируем по родителю, чтобы вставлять один разделитель на parent.
  const byParent = new Map();
  refs.forEach(el => {
    const p = el.parentNode; if (!p) return;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(el);
  });
  byParent.forEach((list, parent) => {
    // Разделитель
    const hr = document.createElement('div');
    hr.className = 'rs-ref-divider';
    hr.style.cssText = 'margin:24px 0 10px;padding:8px 12px;border-top:2px dashed #cbd5e1;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600';
    hr.textContent = '📚 Справочники / база данных';
    parent.appendChild(hr);
    list.forEach(el => parent.appendChild(el));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', move);
} else {
  move();
}
