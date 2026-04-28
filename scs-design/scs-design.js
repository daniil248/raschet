/* ============================================================
   scs-design.js — Проектирование СКС (Подфаза 1.26)
   Вкладка «Связи» — мастер меж-шкафных связей:
   • выбор N стоек из проекта → карточки рядом,
   • клик по юниту A → клик по юниту B → создать связь,
   • список связей с типом кабеля и удалением.
   ============================================================ */

import {
  ensureDefaultProject, getActiveProjectId, setActiveProjectId, getProject, projectKey,
  listProjectsForModule, createSketchForModule,
  // v0.59.372: подпроекты внутри родительского.
  listSubProjects, createSubProject
} from '../shared/project-storage.js';
// v0.59.278: project-scoped экземпляры стоек (см. shared/rack-storage.js).
import {
  loadAllRacksForActiveProject, saveAllRacksForActiveProject, migrateLegacyInstances,
  LS_TEMPLATES_GLOBAL
} from '../shared/rack-storage.js';
// v0.59.348: stickers-baner о виртуальных стойках из схемы.
import { loadSchemeVirtualRacks, loadPorGroupVirtualRacks } from '../shared/scheme-rack-bridge.js';
// v0.59.578: жадно импортируем POR — иначе window.RaschetPOR undefined,
// rack-storage._loadPorRacks возвращает [], в picker'е НЕ видны POR-стойки
// родителя (16 шт. SR01-08, MR01, CR01 у тестового проекта).
import '../shared/por.js';
import '../shared/por-types/index.js';

const LS_RACK      = LS_TEMPLATES_GLOBAL;              // для совместимости storage-listener
const LS_CATALOG   = 'scs-config.catalog.v1';          // глобальный каталог IT
// LS_CONTENTS / LS_RACKTAGS переведены на проектный неймспейс (1.27.3).
let LS_CONTENTS    = 'scs-config.contents.v1';
let LS_RACKTAGS    = 'scs-config.rackTags.v1';

// Проектные данные — в неймспейсе активного проекта.
// Ключи инициализируются в rescopeToActiveProject() один раз при запуске.
let LS_SELECTION = 'scs-design.selection.v1';
let LS_LINKS     = 'scs-design.links.v1';
let LS_PLAN      = 'scs-design.plan.v1';

// Старые (глобальные) ключи — для одноразовой миграции в активный проект.
const OLD_KEYS = {
  selection: 'scs-design.selection.v1',
  links:     'scs-design.links.v1',
  plan:      'scs-design.plan.v1',
};

// v0.59.556: миграция legacy-СКС (данные под id parent project'а) в
// под-проект. Копирует все raschet.project.<parentPid>.scs-design.* ключи
// в raschet.project.<subPid>.scs-design.*; удаляет источник.
// v0.59.557: smart-merge — если назначение «пустое», источник
// записывается. Иначе пропускается.
// v0.59.565: + опции { force: true } для перезаписи dest и { mergeArrays:
// true } для слияния массивов источника+приёмника по id.
function _isEmptyValue(raw) {
  if (raw == null) return true;
  try {
    const v = JSON.parse(raw);
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 0) return true;
      // частный случай scs-design.plan.v1: { items: [] } считаем пустым
      if (keys.length === 1 && keys[0] === 'items' && Array.isArray(v.items) && v.items.length === 0) return true;
    }
    return false;
  } catch { return false; }
}
function _migrateLegacyScsToSub(parentPid, subPid, opts = {}) {
  if (!parentPid || !subPid || parentPid === subPid) return [];
  const force = opts.force === true;
  const prefix = `raschet.project.${parentPid}.scs-design.`;
  const subPrefix = `raschet.project.${subPid}.scs-design.`;
  const toMove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) toMove.push(k);
  }
  const moved = [];
  const skipped = [];
  for (const k of toMove) {
    const newKey = subPrefix + k.slice(prefix.length);
    const destVal = localStorage.getItem(newKey);
    const destEmpty = _isEmptyValue(destVal);
    if (!destEmpty && !force) { skipped.push({ k, reason: 'dest non-empty' }); continue; }
    const val = localStorage.getItem(k);
    if (val == null) continue;
    try {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(k);
      moved.push(k);
    } catch (e) { console.warn('[scs-design] migrate failed for', k, e); }
  }
  if (moved.length) console.info(`[scs-design] legacy → sub ${subPid}${force?' [FORCE]':''}: перенесено ${moved.length} ключей`, moved);
  if (skipped.length) console.warn(`[scs-design] legacy → sub ${subPid}: пропущено ${skipped.length} (dest не пуст)`, skipped);
  return moved;
}

function renderProjectBadge(pid) {
  const host = document.getElementById('sd-project-badge');
  if (!host) return;
  // v0.59.570: оборачиваем всё в try/catch — раньше тихий throw приводил
  // к пустому badge, и пользователь оказывался без UI смены проекта.
  try {
    return _renderProjectBadgeImpl(pid, host);
  } catch (e) {
    console.error('[scs-design] renderProjectBadge crashed:', e, e?.stack);
    host.innerHTML = `<span style="color:#b91c1c;font-size:12px">⚠ Ошибка инициализации шапки: ${String(e.message || e).slice(0, 200)} — <a href="../projects/" style="color:#1565c0">→ к списку проектов</a></span>`;
  }
}
function _renderProjectBadgeImpl(pid, host) {
  const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  const projects = listProjectsForModule('scs-design');
  const p = pid ? getProject(pid) : null;

  // v0.59.343: если модуль открыт из карточки проекта (URL содержит
  // ?project=&from=projects), переключатель проекта недоступен — контекст
  // зафиксирован. Имя проекта уже выводится в общем хедере (project-badge).
  // В direct-entry режиме (без URL-параметра) показываем dropdown как раньше.
  let urlPid = null;
  try { urlPid = new URLSearchParams(location.search).get('project'); } catch {}
  const lockedFromUrl = !!urlPid;

  // v0.59.372: СКС-проект больше не пара «как полноценный, так и мини».
  // Это всегда подпроект (sketch с parentProjectId) внутри родительского
  // full-проекта со своим обозначением (designation, например «СКС-1»).
  // - Если URL передал ?project=parentId → родитель залочен, выбираем
  //   подпроект внутри него или создаём новый.
  // - Без URL → выбираем родителя из списка full-проектов, потом подпроект.
  // v0.59.531: orphan-sketches (kind='sketch' без parentProjectId), созданные
  // до v0.59.372, всё ещё валидны как «мини-проект СКС без родителя». Их
  // нельзя терять. Включаем в parent-dropdown отдельной optgroup-ой; при
  // выборе orphan-sketch активируем его как самостоятельный контекст СКС
  // (legacy/standalone режим).
  // v0.59.567: лояльный фильтр — undefined kind считается 'full'. Раньше
  // строгий x.kind === 'full' вырезал legacy-проекты без поля kind (созданные
  // до v0.59.... когда kind ещё не было обязательным), и они не появлялись
  // в dropdown'е. Теперь как и в /projects/ — (kind||'full') === 'full'.
  const fullProjects = projects.filter(x => (x.kind || 'full') === 'full' &&
    !(typeof x.id === 'string' && x.id.startsWith('lp_')) &&
    !('scheme' in x) && !('memberUids' in x));
  const orphanSketches = projects.filter(x => x.kind === 'sketch' && !x.parentProjectId);
  let parentPid = urlPid;
  // v0.59.573: КРИТИЧНО — если urlPid указывает на SUB (kind='sketch' с
  // parentProjectId), резолвим до настоящего parent.
  // v0.59.574: РЕКУРСИВНО — если parent ALSO sub (chain из бага v0.59.572),
  // продолжаем подниматься до full-project. Без этого fix v0.59.573
  // промотал URL=sub до его parent (=другой sub, из chain), и листинг
  // sub'ов того chain-sub'а был пуст → снова auto-create. Цикл продолжался
  // создавать новых sub'ов под sub'ом.
  if (parentPid) {
    let depth = 0;
    while (depth++ < 100) {
      const urlProj = getProject(parentPid);
      if (urlProj && urlProj.kind === 'sketch' && urlProj.parentProjectId) {
        parentPid = urlProj.parentProjectId;
      } else {
        break;
      }
    }
  }
  // Если активный проект сам — sketch с parentProjectId, наследуем родителя.
  if (!parentPid && p && p.kind === 'sketch' && p.parentProjectId) {
    parentPid = p.parentProjectId;
  }
  // Если активный — orphan-sketch (без родителя) — он сам себе «parent».
  const activeIsOrphan = !!(p && p.kind === 'sketch' && !p.parentProjectId);
  if (!parentPid && activeIsOrphan) {
    parentPid = p.id;
  }
  // Без явного родителя — пробуем первый доступный full.
  if (!parentPid && fullProjects[0]) parentPid = fullProjects[0].id;

  const parent = parentPid ? getProject(parentPid) : null;
  const parentIsOrphan = !!(parent && parent.kind === 'sketch' && !parent.parentProjectId);
  const subs = (parent && !parentIsOrphan) ? listSubProjects(parent.id, 'scs-design') : [];
  const activeSubId = (p && p.parentProjectId === (parent?.id || null)) ? p.id : '';

  const parentSel = lockedFromUrl
    ? `<b>${esc(parent?.name || '?')}</b>`
    : `<select id="sd-parent-switcher" title="Родительский проект-объект">${
        (fullProjects.length ? `<optgroup label="🏢 Проекты">${
          fullProjects.map(x => `<option value="${esc(x.id)}"${x.id === parent?.id ? ' selected' : ''}>${esc(x.name || '(без имени)')}</option>`).join('')
        }</optgroup>` : '')
      }${
        (orphanSketches.length ? `<optgroup label="🧪 Мини-проекты СКС (без родителя)">${
          orphanSketches.map(x => `<option value="${esc(x.id)}"${x.id === parent?.id ? ' selected' : ''}>${esc(x.name || '(без имени)')}</option>`).join('')
        }</optgroup>` : '')
      }</select>`;

  // v0.59.378: legacy-режим — данные scs-design лежат под id родителя.
  // v0.59.557: детекция теперь не зависит от subs.length и активного pid —
  // если в LS есть legacy-ключи parent'а с реальным контентом, считаем
  // legacy-данные присутствующими и запускаем миграцию (см. ниже). Это
  // покрывает случай «есть и СКС-1 sub, и старые links/plan под parent».
  let legacyActive = false;
  try {
    if (parent) {
      const linksRaw = localStorage.getItem(`raschet.project.${parent.id}.scs-design.links.v1`);
      const planRaw  = localStorage.getItem(`raschet.project.${parent.id}.scs-design.plan.v1`);
      const hasLinks = !!(linksRaw && (() => { try { return (JSON.parse(linksRaw) || []).length > 0; } catch { return false; } })());
      const hasPlan  = !!(planRaw  && (() => { try { const o = JSON.parse(planRaw); return !!(o && (o.items || []).length); } catch { return false; } })());
      legacyActive = hasLinks || hasPlan;
    }
  } catch {}

  // v0.59.556: legacy-режим автоматически мигрируется в под-проект.
  // v0.59.557: reload+return ТОЛЬКО если что-то реально перенеслось.
  // v0.59.564: session-flag предотвращает повторные попытки за вкладку.
  //   Без флага renderProjectBadge на каждом ре-рендере (storage-event,
  //   tab-switch, …) запускал миграцию заново, и при «dest не пуст»
  //   спамил console.warn сотнями раз → подвисание UI-потока.
  // v0.59.565: после миграционной попытки фиксируем, остался ли legacy
  // в parent'е (если migration пропустила некоторые ключи). Кнопка
  // «🔀 Принять legacy» в badge зовёт force-merge.
  let legacyStuckAfterAttempt = false;
  if (legacyActive && parent && !parentIsOrphan) {
    const _attemptedFlag = `raschet.scs-design.legacy-migrate-attempted.${parent.id}.session`;
    let alreadyAttempted = (() => {
      try { return sessionStorage.getItem(_attemptedFlag) === '1'; } catch { return false; }
    })();
    // v0.59.569: если флаг попытки стоит, но sub так и не создан — в прошлый
    // раз createSubProject упал/вернул null. Сбрасываем флаг и пробуем снова.
    // Без этого пользователь застревает в state «subs=0 + legacy stuck»
    // навечно (видит кнопки «Создать СКС» + «Принять legacy», но ни одна
    // не работает корректно).
    if (alreadyAttempted && subs.length === 0) {
      console.info('[scs-design] previous migrate attempt left no sub — resetting flag for retry');
      try { sessionStorage.removeItem(_attemptedFlag); } catch {}
      alreadyAttempted = false;
    }
    if (alreadyAttempted) {
      // Уже пробовали — значит legacy «застрял»: показываем кнопку force-merge.
      legacyStuckAfterAttempt = true;
    }
    if (!alreadyAttempted) {
      try {
        let dest = subs[0];
        let createdSub = false;
        // v0.59.576: НЕ auto-create sub если его нет. Иначе пользователь
        // удаляет sub → возвращается → sub создан заново → 5+ раз цикл.
        // Если sub'а нет — выходим, пользователь увидит «🔀 Принять legacy»
        // кнопку (legacyStuckAfterAttempt=true) которая создаст sub +
        // мигрирует ОДНИМ explicit-кликом.
        if (!dest) {
          legacyStuckAfterAttempt = true;
          try { sessionStorage.setItem(_attemptedFlag, '1'); } catch {}
          // Возвращаемся в outer if без миграции и reload.
        }
        if (dest && dest.id) {
          const moved = _migrateLegacyScsToSub(parent.id, dest.id);
          // Помечаем попытку — независимо от результата, чтобы не повторять.
          try { sessionStorage.setItem(_attemptedFlag, '1'); } catch {}
          if (moved.length || createdSub) {
            console.info(`[scs-design] auto-migrated legacy → sub ${dest.id}, moved ${moved.length} keys, createdSub=${createdSub}; reloading`);
            setActiveProjectId(dest.id);
            // v0.59.572: обновляем URL ?project=subId перед reload, иначе
            // project-context.js синкает URL → active на parent и цикл.
            try {
              const url = new URL(location.href);
              url.searchParams.set('project', dest.id);
              history.replaceState(null, '', url.toString());
            } catch {}
            location.reload();
            return;
          }
          // dest существовал и не пуст — миграция не выполнилась.
          // Логируем ОДИН раз благодаря флагу выше.
          console.warn(`[scs-design] legacy data persists in parent ${parent.id} — sub ${dest.id} already has content; manual merge required`);
          legacyStuckAfterAttempt = true;
        }
      } catch (e) {
        try { sessionStorage.setItem(_attemptedFlag, '1'); } catch {}
        console.warn('[scs-design] auto-migrate legacy failed:', e);
        legacyStuckAfterAttempt = true;
      }
    }
  }

  // v0.59.556: если у parent ровно 1 под-проект — авто-активируем его
  // (когда зашли по ?project=parentId). Иначе данные уйдут в legacy.
  // v0.59.572: КРИТИЧНО — также обновляем URL `?project=subId`. Иначе
  // shared/project-context.js на следующем рендере опять синкает URL →
  // active=parent, и наш auto-activate сработает заново → INFINITE LOOP.
  // Используем history.replaceState (без перезагрузки) чтобы URL уже был
  // правильным к моменту следующего рендера.
  if (parent && !parentIsOrphan && subs.length === 1 && pid === parent.id) {
    try {
      setActiveProjectId(subs[0].id);
      try {
        const url = new URL(location.href);
        url.searchParams.set('project', subs[0].id);
        history.replaceState(null, '', url.toString());
      } catch {}
      location.reload();
      return;
    } catch (e) { console.warn('[scs-design] auto-activate single sub failed:', e); }
  }

  // v0.59.561 → v0.59.576: auto-create-default-sub УДАЛЁН.
  // Жалоба пользователя «удалил уже 5 раз и они вновь появляются» — корень
  // в этом блоке. Каждый раз при открытии scs-design без sub'а создавался
  // новый. Теперь — нет. Если у пользователя нет sub'а, в шапке покажется
  // кнопка «➕ Создать СКС» (subBlockHtml ниже), которую он нажмёт
  // сознательно. Никаких auto-create.
  // Для legacy-миграции тоже: если нет sub и есть legacy → НЕ создавать sub
  // молча. Block legacy-migrate в верхней части уже не пытается auto-create
  // (см. v0.59.557+) если legacyStuckAfterAttempt.

  // v0.59.531: для orphan-sketch родителем является сам sketch — у него
  // нет подпроектов, и кнопку «+ Новый СКС-проект» здесь скрываем (нельзя
  // создать sub под sketch'ом без full-родителя).
  // v0.59.556: новая логика отображения «СКС-проект» поля:
  //   - parentIsOrphan: статичный текст «мини-проект».
  //   - subs.length === 0 (нет легаси, нет sub): только кнопка «➕ Создать СКС».
  //   - subs.length === 1: показываем имя как статичный label + маленькая ➕ кнопка
  //     рядом (для редкого случая, когда нужно 2+ вариантов СКС). Никакого
  //     dropdown'а, чтобы пользователь не путался / не сменил случайно.
  //   - subs.length >= 2: полноценный dropdown.
  let subBlockHtml;
  if (parentIsOrphan) {
    subBlockHtml = `<span class="muted" style="margin-left:8px">— мини-проект (без подпроектов) —</span>`;
  } else if (subs.length === 0) {
    subBlockHtml = `<button type="button" class="sd-btn-sel" id="sd-sub-new" style="margin-left:8px" title="Создать СКС-подпроект внутри выбранного проекта">＋ Создать СКС</button>`;
  } else if (subs.length === 1) {
    const s = subs[0];
    // v0.59.558: при одном sub без designation и с именем «СКС»
    // (default из автомиграции) — дублирование «СКС: СКС» некрасиво.
    // Показываем просто chip с иконкой ⊞ и именем; если есть
    // designation — добавляем его в скобках.
    const nm = (s.name || 'СКС').trim();
    const desigPart = s.designation ? ` <span class="muted" style="font-size:11px">[${esc(s.designation)}]</span>` : '';
    subBlockHtml = `<span style="margin-left:14px;padding:2px 8px;background:#dbeafe;color:#1e3a8a;border-radius:4px;font-size:12px;font-weight:500" title="СКС-подпроект: ${esc(nm)}${s.designation ? ' (обозначение ' + esc(s.designation) + ')' : ''}">⊞ ${esc(nm)}${desigPart}</span>` +
      `<button type="button" class="sd-btn-sel" id="sd-sub-new" title="Добавить ещё один вариант СКС в этом проекте (например, для альтернативного решения)" style="margin-left:6px;font-size:11px;padding:2px 8px">＋ ещё вариант СКС</button>`;
  } else {
    const subOpts = subs.map(s => {
      const labelDesig = s.designation ? `[${esc(s.designation)}] ` : '';
      return `<option value="${esc(s.id)}"${s.id === activeSubId ? ' selected' : ''}>${labelDesig}${esc(s.name || '(без имени)')}</option>`;
    }).join('');
    subBlockHtml = `<span class="muted" style="margin-left:14px">СКС-проект:</span>
      <select id="sd-subproject-switcher" title="Выберите вариант СКС внутри проекта">${subOpts}</select>
      <button type="button" class="sd-btn-sel" id="sd-sub-new" title="Добавить ещё один вариант СКС">＋</button>`;
  }

  // v0.59.565: warning о застрявшем legacy + кнопка force-merge.
  const stuckBlockHtml = legacyStuckAfterAttempt && !parentIsOrphan && parent
    ? `<button type="button" id="sd-force-merge-legacy" title="Перенести legacy-данные родителя в выбранный СКС-подпроект, перезаписав существующие. Используйте если auto-migration пропустил данные." style="margin-left:8px;font-size:11px;padding:3px 10px;background:#fbbf24;border:1px solid #f59e0b;color:#78350f;border-radius:4px;cursor:pointer">🔀 Принять legacy</button>`
    : '';
  host.innerHTML = `
    <span class="muted">Проект:</span>
    ${parentSel}
    ${subBlockHtml}
    ${stuckBlockHtml}
    <a href="../projects/" style="margin-left:auto">→ управлять проектами</a>
  `;

  document.getElementById('sd-parent-switcher')?.addEventListener('change', e => {
    // При смене родителя — активируем первый подпроект под ним (или ничего).
    // v0.59.531: для orphan-sketch (kind='sketch' без parentProjectId) —
    // активируем сам sketch (он и есть контекст), под-проектов у него нет.
    const newParent = e.target.value;
    const np = getProject(newParent);
    if (np && np.kind === 'sketch' && !np.parentProjectId) {
      setActiveProjectId(newParent);
    } else {
      const newSubs = listSubProjects(newParent, 'scs-design');
      if (newSubs[0]) setActiveProjectId(newSubs[0].id);
      else {
        // Подпроекта ещё нет — оставляем активным сам родитель временно,
        // но scoped-данные будут лежать под id родителя. Лучше попросить
        // пользователя сразу создать подпроект.
        setActiveProjectId(newParent);
      }
    }
    location.reload();
  });
  document.getElementById('sd-subproject-switcher')?.addEventListener('change', e => {
    if (!e.target.value) return;
    setActiveProjectId(e.target.value);
    location.reload();
  });
  document.getElementById('sd-sub-new')?.addEventListener('click', async () => {
    if (!parent) {
      // Без родителя — попросить выбрать его в dropdown'е выше.
      const ph = document.createElement('div');
      ph.textContent = 'Сначала выберите родительский проект.';
      ph.style.cssText = 'position:fixed;top:60px;right:20px;background:#0f172a;color:#fff;padding:10px 14px;border-radius:6px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
      document.body.appendChild(ph);
      setTimeout(() => ph.remove(), 2500);
      return;
    }
    const name = await sdPrompt('Новый СКС-подпроект', `Имя внутри проекта «${parent.name}»`, 'СКС');
    if (!name) return;
    const designation = await sdPrompt('Обозначение', 'Короткий код подпроекта (напр. СКС-1)', 'СКС-1');
    const sp = createSubProject(parent.id, 'scs-design', { name, designation: designation || '' });
    setActiveProjectId(sp.id);
    location.reload();
  });
  // v0.59.565: force-merge legacy → активный sub. Перезаписывает
  // существующие ключи sub'а данными из parent.scs-design.* и удаляет
  // их из parent.
  // v0.59.568: если sub'а нет — создаём «СКС» сами; полностью самодостаточная
  // кнопка (не требует предварительного создания sub'а пользователем).
  document.getElementById('sd-force-merge-legacy')?.addEventListener('click', async () => {
    if (!parent || parentIsOrphan) return;
    let dest = subs[0] || (p && p.parentProjectId === parent.id ? p : null);
    let createdSub = false;
    if (!dest) {
      try {
        dest = createSubProject(parent.id, 'scs-design', { name: 'СКС', designation: '' });
        createdSub = true;
      } catch (e) {
        console.warn('[scs-design] force-merge: create sub failed:', e);
        const ph = document.createElement('div');
        ph.textContent = 'Не удалось создать СКС-подпроект: ' + (e.message || e);
        ph.style.cssText = 'position:fixed;top:60px;right:20px;background:#0f172a;color:#fff;padding:10px 14px;border-radius:6px;z-index:9999';
        document.body.appendChild(ph);
        setTimeout(() => ph.remove(), 3500);
        return;
      }
    }
    if (!dest || !dest.id) return;
    const ok = confirm(
      `Принять legacy-данные из родителя «${parent.name}» в подпроект «${dest.name || dest.designation || 'СКС'}»?\n\n` +
      (createdSub ? 'СКС-подпроект будет создан автоматически.\n' : '') +
      `Существующие ключи подпроекта будут ПЕРЕЗАПИСАНЫ данными родителя.`
    );
    if (!ok) {
      // Если только что создали sub, но юзер отменил merge — оставляем sub
      // (можно использовать как пустой контейнер). Reset session flag.
      try { sessionStorage.removeItem(`raschet.scs-design.legacy-migrate-attempted.${parent.id}.session`); } catch {}
      return;
    }
    const moved = _migrateLegacyScsToSub(parent.id, dest.id, { force: true });
    console.info(`[scs-design] force-merge: createdSub=${createdSub}, moved=${moved.length}`);
    // Сбрасываем session-flag, чтобы при следующем заходе не было
    // «застрял» предупреждения.
    try {
      sessionStorage.removeItem(`raschet.scs-design.legacy-migrate-attempted.${parent.id}.session`);
    } catch {}
    setActiveProjectId(dest.id);
    location.reload();
  });
}

// Wizard создания стойки в проект: имя, высота U, опционально базовая
// комплектация (патч-панель + коммутатор 1U). Возвращает null при отмене.
function sdRackWizard() {
  return new Promise(res => {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-modal" style="min-width:360px">
        <h3 style="margin:0 0 10px">＋ Новая стойка в проект</h3>
        <label style="display:block;margin:8px 0 4px;color:#cbd5e1;font-size:13px">Имя</label>
        <input type="text" id="rw-name" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="Стойка A-01" autocomplete="off">
        <label style="display:block;margin:10px 0 4px;color:#cbd5e1;font-size:13px">Тег (A-01, RACK-A1…) — можно пусто</label>
        <input type="text" id="rw-tag" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="A-01" autocomplete="off">
        <label style="display:block;margin:10px 0 4px;color:#cbd5e1;font-size:13px">Высота, U</label>
        <select id="rw-u" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569">
          <option>12</option><option>18</option><option>24</option><option>32</option><option selected>42</option><option>47</option>
        </select>
        <label style="display:flex;align-items:center;gap:8px;margin:14px 0 4px;color:#cbd5e1;font-size:13px;cursor:pointer">
          <input type="checkbox" id="rw-basic" checked>
          <span>Базовая комплектация: 1× патч-панель 24 порта (U1) + 1× коммутатор 24 порта (U2) + 1× 1U-органайзер (U3)</span>
        </label>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="sd-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="sd-btn-export" data-act="yes">Создать</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rw-name').focus();
    overlay.querySelector('#rw-name').select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) return done(null);
      if (e.target.dataset?.act === 'no') return done(null);
      if (e.target.dataset?.act === 'yes') {
        const name = (overlay.querySelector('#rw-name').value || '').trim();
        if (!name) { overlay.querySelector('#rw-name').focus(); return; }
        done({
          name,
          tag: (overlay.querySelector('#rw-tag').value || '').trim(),
          u: +overlay.querySelector('#rw-u').value || 42,
          basic: overlay.querySelector('#rw-basic').checked,
        });
      }
    });
  });
}

// Создать стойку в проекте: добавить шаблон в библиотеку, создать запись
// в contents (с опциональной базовой комплектацией) и тег. Возвращает id.
function createProjectRack(opts) {
  // v0.59.278: новый экземпляр в проекте должен иметь префикс 'inst-',
  // чтобы попадать в project-scoped хранилище, а не глобальные шаблоны.
  const id = 'inst-' + Math.random().toString(36).slice(2, 10);
  const racks = getRacks();
  racks.push({
    id, name: opts.name, manufacturer: '', kitId: '',
    u: opts.u || 42, width: 600, depth: 1000,
    doorFront: 'mesh', doorRear: 'double-mesh', doorWithLock: true,
    lock: 'key', sides: 'pair-sku', top: 'vent', base: 'feet',
    comboTopBase: false, entryTop: 2, entryBot: 2, entryType: 'brush',
    occupied: 0, blankType: '1U-solid',
    demandKw: 5, cosphi: 0.9, pduRedundancy: '2N', pdus: [],
  });
  try { saveAllRacksForActiveProject(racks); } catch (e) { saveJson(LS_RACK, racks); }

  // contents в проекте
  const all = loadJson(LS_CONTENTS, {});
  const devices = [];
  if (opts.basic) {
    const cat = getCatalog();
    const findByKind = k => cat.find(t => t.kind === k);
    const patch  = findByKind('patch-panel');
    const sw     = findByKind('switch');
    const cm     = findByKind('cable-manager');
    const mkDev = (typeId, label, uStart, heightU, ports) => ({
      id: 'd-' + Math.random().toString(36).slice(2, 9),
      typeId: typeId || '', label, uStart, heightU: heightU || 1,
      ports: ports || 0, powerW: 0,
    });
    devices.push(mkDev(patch?.id, 'Патч-панель 24', 1, 1, 24));
    devices.push(mkDev(sw?.id,    'Коммутатор 24', 2, 1, 24));
    devices.push(mkDev(cm?.id,    'Органайзер 1U', 3, 1, 0));
  }
  all[id] = devices;
  saveJson(LS_CONTENTS, all);

  // тег в проекте
  if (opts.tag) {
    const tags = loadJson(LS_RACKTAGS, {});
    tags[id] = opts.tag;
    saveJson(LS_RACKTAGS, tags);
  }
  return id;
}

// «В проекте» = либо есть запись в contents активного проекта, либо есть
// тег в racktags активного проекта (пустая стойка, но явно названа).
function getProjectRackIds() {
  // v0.59.281: источник истины — экземпляры активного проекта (inst-*)
  // из project-scoped хранилища + fallback на legacy-contents/tags (на случай
  // миграций). Глобальные шаблоны (tpl-*) никогда сюда не попадают.
  // v0.59.550: + виртуалы (id 'scheme-*' / 'por-group-*') считаются «в проекте»
  // — они происходят из engine-схемы / POR этого проекта. На чек чипа они
  // материализуются в inst-*.
  const ids = new Set();
  try { getProjectInstances().forEach(r => { if (r && r.id) ids.add(r.id); }); } catch {}
  const byContent = loadJson(LS_CONTENTS, {});
  const byTag     = loadJson(LS_RACKTAGS, {});
  Object.keys(byContent || {}).forEach(id => { if (String(id).startsWith('inst-')) ids.add(id); });
  Object.keys(byTag || {}).forEach(id => {
    if (String(id).startsWith('inst-') && (byTag[id] || '').trim()) ids.add(id);
  });
  try {
    // v0.59.568: schemePid = parent если active=sub, иначе active.
    const activePid = getActiveProjectId();
    const activeProj = activePid ? getProject(activePid) : null;
    const schemePid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
      ? activeProj.parentProjectId
      : activePid;
    if (schemePid) {
      loadSchemeVirtualRacks(schemePid).forEach(v => ids.add(v.id));
      loadPorGroupVirtualRacks(schemePid).forEach(v => ids.add(v.id));
    }
  } catch {}
  return ids;
}

function sdPrompt(title, label, initial = '') {
  return new Promise(res => {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-modal">
        <h3 style="margin:0 0 8px">${esc(title)}</h3>
        <label style="display:block;margin:6px 0 4px;color:#cbd5e1;font-size:13px">${esc(label)}</label>
        <input type="text" style="width:100%;padding:8px 10px;border-radius:6px;background:#1f2937;color:#f1f5f9;border:1px solid #475569;box-sizing:border-box" value="${esc(initial)}">
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="sd-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="sd-btn-export" data-act="yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus(); input.select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      if (e.target.dataset?.act === 'yes') done((input.value || '').trim() || null);
      if (e.target.dataset?.act === 'no')  done(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  done((input.value || '').trim() || null);
      if (e.key === 'Escape') done(null);
    });
  });
}

function rescopeToActiveProject() {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  LS_SELECTION = projectKey(pid, 'scs-design', 'selection.v1');
  LS_LINKS     = projectKey(pid, 'scs-design', 'links.v1');
  LS_PLAN      = projectKey(pid, 'scs-design', 'plan.v1');
  // scs-config shared проектные ключи (1.27.3) — читаем уже из проектного неймспейса.
  LS_CONTENTS  = projectKey(pid, 'scs-config', 'contents.v1');
  LS_RACKTAGS  = projectKey(pid, 'scs-config', 'rackTags.v1');
  // Одноразовая миграция: если в новом ключе пусто, а в старом есть — копируем.
  const pairs = [
    [OLD_KEYS.selection, LS_SELECTION],
    [OLD_KEYS.links,     LS_LINKS],
    [OLD_KEYS.plan,      LS_PLAN],
  ];
  let migrated = 0;
  for (const [oldK, newK] of pairs) {
    if (oldK === newK) continue; // если проект ещё не создан и ключ совпал — пропустим
    try {
      const newExists = localStorage.getItem(newK) != null;
      const oldVal = localStorage.getItem(oldK);
      if (!newExists && oldVal != null) {
        localStorage.setItem(newK, oldVal);
        migrated++;
      }
    } catch {}
  }
  return { pid, migrated };
}

/* Типы оборудования, у которых нет портов — могут служить только каналом
   для трассировки сплайна, но не endpoint-ом связи. */
const NO_PORT_KINDS = new Set(['cable-manager']);

const CABLE_TYPES = [
  // maxGbps — практический потолок скорости кабеля (NULL = неприменимо).
  // diameterMm — внешний диаметр оболочки кабеля (для расчёта заполнения
  // кабельного канала). Типовые значения производителей.
  { id: 'cat6',      label: 'Cat.6 U/UTP',     color: '#1976d2', maxGbps: 1,    diameterMm: 6.2 },
  { id: 'cat6a',     label: 'Cat.6A F/UTP',    color: '#1565c0', maxGbps: 10,   diameterMm: 7.5 },
  { id: 'cat7',      label: 'Cat.7 S/FTP',     color: '#0d47a1', maxGbps: 10,   diameterMm: 8.0 },
  { id: 'om3',       label: 'OM3 LC-LC',       color: '#ea580c', maxGbps: 40,   diameterMm: 3.0 },
  { id: 'om4',       label: 'OM4 LC-LC',       color: '#c2410c', maxGbps: 100,  diameterMm: 3.0 },
  { id: 'os2',       label: 'OS2 LC-LC',       color: '#facc15', maxGbps: 400,  diameterMm: 3.0 },
  { id: 'coax',      label: 'Coax / RF',       color: '#7c3aed', maxGbps: null, diameterMm: 7.0 },
  { id: 'power-c13', label: 'Питание C13/C14', color: '#dc2626', maxGbps: null, diameterMm: 10.0 },
  { id: 'other',     label: 'Другое',          color: '#64748b', maxGbps: null, diameterMm: 8.0 },
];
const CABLE_DIAMETER = id => (CABLE_TYPES.find(c => c.id === id)?.diameterMm) || 8.0;
/* Разбор скорости устройства (portSpeed из каталога) в Гбит/с.
   Принимает: «1G», «10G», «40G», «100G», «400G», «1 Gbps», «100M»→0.1. */
function parseGbps(s) {
  if (!s) return null;
  const m = String(s).match(/([\d.]+)\s*(g|m|k)?/i);
  if (!m) return null;
  const v = +m[1]; if (!Number.isFinite(v)) return null;
  const u = (m[2] || 'g').toLowerCase();
  return u === 'k' ? v / 1e6 : u === 'm' ? v / 1000 : v;
}
const CABLE_COLOR = id => (CABLE_TYPES.find(c => c.id === id)?.color) || '#64748b';

/* v0.59.281: лёгкая модель типов портов для валидации меж-шкафных связей.
   Полноценное моделирование портов (RJ45/LC/SC/SFP/BNC/…) — тема Phase
   1.1.3 (element-library). Пока — эвристика по kind каталога + optional
   override в catalog[i].portType. */
const DEFAULT_PORT_BY_KIND = {
  'switch': 'rj45',
  'patch-panel': 'rj45',
  'server': 'rj45',
  'ups': 'power',
  'cable-manager': null,
  'kvm': 'rj45',
  'firewall': 'rj45',
  'router': 'rj45',
  'other': 'rj45',
};

/* Кабель → какие типы портов допустимы на обоих концах. */
const CABLE_PORT_COMPAT = {
  'cat6':  new Set(['rj45']),
  'cat6a': new Set(['rj45']),
  'cat7':  new Set(['rj45']),
  'om3':   new Set(['lc', 'sc', 'sfp']),
  'om4':   new Set(['lc', 'sc', 'sfp']),
  'os2':   new Set(['lc', 'sc', 'sfp']),
  'coax':  new Set(['bnc', 'f']),
  'power-c13': new Set(['c13', 'c14', 'power']),
  'other': null, // 'other' пропускаем — не валидируем
};

function inferPortType(dev) {
  if (!dev) return null;
  const t = catalogType(dev.typeId);
  if (!t) return null;
  if (t.portType) return String(t.portType).toLowerCase();
  const hint = ((t.label || '') + ' ' + (dev.label || '')).toLowerCase();
  if (/\bsfp|\bfib|оптик|lc[-\s]|\blc\b/.test(hint)) return 'lc';
  if (/\bкоакс|\bcoax|bnc/.test(hint)) return 'bnc';
  return DEFAULT_PORT_BY_KIND[t.kind] || 'rj45';
}

/* Возвращает { ok, reason } для меж-шкафной связи. */
function linkCompat(l) {
  if (!l) return { ok: true };
  const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
  const to   = getContents(l.toRackId  ).find(x => x.id === l.toDevId);
  const pa = inferPortType(from);
  const pb = inferPortType(to);
  const ct = l.cableType || '';
  const compat = CABLE_PORT_COMPAT[ct];
  const reasons = [];
  if (pa && pb && pa !== pb) reasons.push(`несовпадение типов портов (A: ${pa}, B: ${pb})`);
  if (compat) {
    if (pa && !compat.has(pa)) reasons.push(`порт A «${pa}» не подходит для «${ct}»`);
    if (pb && !compat.has(pb)) reasons.push(`порт B «${pb}» не подходит для «${ct}»`);
  }
  // Валидация скорости: кабель не должен быть «тоньше» чем порт устройства.
  const cable = CABLE_TYPES.find(c => c.id === ct);
  const maxG = cable?.maxGbps;
  if (maxG != null) {
    const fromT = from ? catalogType(from.typeId) : null;
    const toT   = to   ? catalogType(to.typeId)   : null;
    const sA = parseGbps(fromT?.portSpeed);
    const sB = parseGbps(toT?.portSpeed);
    if (sA != null && sA > maxG) reasons.push(`порт A ${sA}G > max кабеля ${maxG}G`);
    if (sB != null && sB > maxG) reasons.push(`порт B ${sB}G > max кабеля ${maxG}G`);
  }
  return { ok: reasons.length === 0, reason: reasons.join('; '), portA: pa, portB: pb };
}

/* ---------- storage ---------- */
function loadJson(key, fb) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; }
  catch { return fb; }
}
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function getRacks() {
  // v0.59.278: шаблоны глобальные + экземпляры активного проекта.
  // v0.59.550: + виртуальные стойки (из схемы / POR-группы).
  // v0.59.568: scheme/POR-data живут в namespace РОДИТЕЛЯ, а не sub'а.
  // Если активен sub-project (kind='sketch' с parentProjectId) — берём
  // virtuals из parent.id, иначе из active pid. Без этого виртуалы
  // SR1-1..SR1-8 не появлялись в Мастере связей после auto-redirect
  // в sub (v0.59.556).
  try {
    migrateLegacyInstances();
    const real = loadAllRacksForActiveProject() || [];
    const activePid = getActiveProjectId();
    const activeProj = activePid ? getProject(activePid) : null;
    const schemePid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
      ? activeProj.parentProjectId
      : activePid;
    const sV = schemePid ? loadSchemeVirtualRacks(schemePid) : [];
    const pV = schemePid ? loadPorGroupVirtualRacks(schemePid) : [];
    const seen = new Set(real.map(r => r && r.id).filter(Boolean));
    const seenV = new Set(sV.map(v => v.id));
    const out = real.slice();
    for (const v of sV) { if (!seen.has(v.id)) { seen.add(v.id); out.push(v); } }
    for (const v of pV) { if (!seen.has(v.id) && !seenV.has(v.id)) { seen.add(v.id); out.push(v); } }
    return out;
  }
  catch { const r = loadJson(LS_RACK, []); return Array.isArray(r) ? r : []; }
}
// v0.59.577: getRackTag fallback — для POR-стоек (id='por_legacy_*' или
// virtuals 'scheme-*'/'por-group-*') tag живёт в самом rack-объекте,
// не в state.rackTags. Без fallback'а POR-стойки не считались
// «помеченными», и filter «Стойки проекта — с тегом» их отбрасывал →
// в picker'е была видна только часть стоек.
function getRackTag(id) {
  const t = loadJson(LS_RACKTAGS, {});
  const fromMap = (t && typeof t === 'object') ? (t[id] || '') : '';
  if (fromMap) return fromMap;
  // Fallback: ищем тег прямо в массиве racks (для POR/virtuals).
  try {
    const racks = getRacks();
    const r = racks.find(x => x && x.id === id);
    if (r) return (r.tag || r.autoTag || '').trim();
  } catch {}
  return '';
}
function getContents(id) {
  const all = loadJson(LS_CONTENTS, {});
  const a = all && typeof all === 'object' ? all[id] : null;
  return Array.isArray(a) ? a : [];
}
function getLinks() { const l = loadJson(LS_LINKS, []); return Array.isArray(l) ? l : []; }
function setLinks(arr) { saveJson(LS_LINKS, arr); }
/* v0.59.283: фантомные связи (endpoint на tpl-*, на стойку чужого проекта
   или на удалённое устройство) НЕ показываются в UI Проектирования СКС —
   отображаются только «действующие» кабели. В storage исходные записи
   остаются: если стойка/устройство вернётся, связь снова станет видимой. */
function isLinkLive(l, instIds) {
  if (!instIds.has(l.fromRackId) || !instIds.has(l.toRackId)) return false;
  const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
  const to   = getContents(l.toRackId).find(x => x.id === l.toDevId);
  return !!from && !!to;
}
function getVisibleLinks() {
  const raw = getLinks();
  if (!raw.length) return raw;
  const instIds = new Set(getProjectInstances().map(r => r.id));
  return raw.filter(l => isLinkLive(l, instIds));
}
function rackById(id) { return getRacks().find(r => r.id === id); }

/* v0.59.281: строгий project-scope для модуля проектирования СКС.
   Плейсмент на план-зал, меж-шкафные связи и т.п. должны работать ТОЛЬКО
   с развёрнутыми стойками текущего проекта (id = inst-*). Глобальные
   шаблоны (tpl-*) — это дизайны корпусов, их не размещают в зал. */
function getProjectInstances() {
  // v0.59.584: на план-зал и в «Стойки проекта» включаем не только inst-*
  // (реальные экземпляры из scs-config), но и POR-стойки (_source='por').
  // Без этого после миграции legacy → POR пользователь видит «10 шт» в picker
  // (там фильтр уже пропускает POR), но 0 на плане и в сводке.
  // Виртуалы (id 'scheme-*' / 'por-group-*') исключаем — их материализуют
  // отдельным флоу.
  return getRacks().filter(r => {
    if (!r || !r.id) return false;
    if (String(r.id).startsWith('scheme-') || String(r.id).startsWith('por-group-')) return false;
    if (String(r.id).startsWith('inst-')) return true;
    if (r._source === 'por') return true;
    return false;
  });
}

/* v0.59.354: материализация виртуальной (из схемы) стойки прямо на плане
   зала — пользователь перетаскивает чип «📐 …», он становится реальным
   inst-*-экземпляром в scs-config (как при clicks «Принять» в racks-list).
   Возвращает id созданной стойки или null при ошибке. */
function _materializeVirtualForPlan(virtId, tag) {
  if (!virtId || !tag) return null;
  const tags = loadJson(LS_RACKTAGS, {});
  const tagInUse = Object.values(tags).some(t => (t || '').trim() === tag);
  if (tagInUse) {
    console.warn('[scs-design] tag busy: ' + tag);
    return null;
  }
  // v0.59.544: ищем virtId и среди scheme-, и среди POR-group-виртуалов.
  // v0.59.568: schemePid = parent если active=sub.
  const activePid = getActiveProjectId();
  const activeProj = activePid ? getProject(activePid) : null;
  const pid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
    ? activeProj.parentProjectId
    : activePid;
  const schemeVs = loadSchemeVirtualRacks(pid);
  const porGroupVs = loadPorGroupVirtualRacks(pid);
  const v = schemeVs.find(x => x.id === virtId) || porGroupVs.find(x => x.id === virtId);
  if (!v) {
    console.warn('[scs-design] virtual rack not found: ' + virtId);
    return null;
  }
  const racks = (function(){ try { return loadAllRacksForActiveProject(); } catch { return []; } })();
  const inst = {
    id: 'inst-' + Math.random().toString(36).slice(2, 10),
    name: v.name,
    u: v.u || 42,
    occupied: v.occupied || 0,
    comment: v.fromPorGroup
      ? `Материализовано из POR-группы ${new Date().toISOString().slice(0, 10)} (group ${v.porGroupId}, slot ${v.porGroupSlot}/${v.schemeTotal})`
      : `Материализовано из схемы ${new Date().toISOString().slice(0, 10)} (узел ${v.schemeNodeId}, экземпляр ${v.schemeIndex}/${v.schemeTotal})`,
    schemeNodeId: v.schemeNodeId,
    schemeIndex: v.schemeIndex,
  };
  racks.push(inst);
  try { saveAllRacksForActiveProject(racks); } catch { saveJson(LS_RACK, racks); }
  tags[inst.id] = tag;
  saveJson(LS_RACKTAGS, tags);
  return inst.id;
}
function getCatalog() { const c = loadJson(LS_CATALOG, []); return Array.isArray(c) ? c : []; }
function catalogType(typeId) { return getCatalog().find(t => t.id === typeId) || null; }
function isOrganizer(dev) {
  if (!dev) return false;
  const t = catalogType(dev.typeId);
  return !!(t && NO_PORT_KINDS.has(t.kind));
}

/* Очистка некорректных связей: endpoint = безпортовое устройство (органайзер
   и т.п.). Запускается один раз при инициализации. Возвращает число удалённых. */
function sanitizeLinks() {
  const cur = getLinks();
  if (!cur.length) return 0;
  const keep = cur.filter(l => {
    const from = getContents(l.fromRackId).find(x => x.id === l.fromDevId);
    const to = getContents(l.toRackId).find(x => x.id === l.toDevId);
    // Если устройство удалено (from/to === undefined) — оставляем, это отдельная
    // проблема «battle damaged» связи. Фильтруем только явные органайзеры.
    if (from && isOrganizer(from)) return false;
    if (to && isOrganizer(to)) return false;
    return true;
  });
  const removed = cur.length - keep.length;
  if (removed > 0) setLinks(keep);
  return removed;
}
function deviceLabel(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId);
  return d ? (d.label || d.typeId || devId) : '(удалено)';
}
function devicePorts(rackId, devId) {
  const d = getContents(rackId).find(x => x.id === devId); if (!d) return 0;
  const t = catalogType(d.typeId);
  return (t && +t.ports) || 0;
}
function portsUsedOn(rackId, devId, excludeLinkId) {
  const used = new Set();
  getLinks().forEach(l => {
    if (excludeLinkId && l.id === excludeLinkId) return;
    if (l.fromRackId === rackId && l.fromDevId === devId && l.fromPort) used.add(+l.fromPort);
    if (l.toRackId === rackId && l.toDevId === devId && l.toPort) used.add(+l.toPort);
  });
  return used;
}
function rackLabel(r) {
  // v0.59.550: для виртуалов — autoTag как effective tag (он не в LS_RACKTAGS).
  let tag = getRackTag(r.id);
  if (!tag && r && (r.fromScheme || r.fromPorGroup) && r.autoTag) tag = r.autoTag;
  const name = r.name || 'Без имени';
  const suffix = (r && (r.fromScheme || r.fromPorGroup))
    ? (r.fromPorGroup ? ' · ⊞ из группы' : ' · 🔗 из схемы')
    : '';
  return (tag ? `${tag} · ${name}` : name) + suffix;
}
function newId() { return 'ln_' + Math.random().toString(36).slice(2, 10); }

/* ---------- UI state ---------- */
let linkStart = null; // { rackId, devId, label } — первое выделенное устройство
// v0.59.592: второе выделенное устройство (потенциальная цель связи). Связь
// НЕ создаётся автоматически — юзер должен явно нажать «🔗 Создать связь».
// До этого клики просто выделяли/снимали выделение.
let linkEnd = null;   // { rackId, devId, label }
let lastLink = null;  // { fromRackId, fromDevId, toRackId, toDevId } — для batch wire

function promptBatchWire() {
  if (!lastLink) return;
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  if (pFrom <= 1 || pTo <= 1) return;
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const freeFrom = pFrom - usedFrom.size;
  const freeTo   = pTo   - usedTo.size;
  const maxCount = Math.min(freeFrom, freeTo);
  if (maxCount <= 0) { updateStatus(`⚠ Нет свободных портов для продолжения.`); return; }

  const st = document.getElementById('sd-status');
  if (!st) return;
  st.innerHTML = `
    <span>+ связей (1…${maxCount}):</span>
    <input id="sd-batch-n" type="number" min="1" max="${maxCount}" value="${maxCount}" style="width:60px;margin:0 6px;padding:2px 4px">
    <button id="sd-batch-ok" class="sd-btn-sel">Создать</button>
    <button id="sd-batch-cancel" class="sd-btn-sel" style="margin-left:4px">Отмена</button>
  `;
  st.style.display = '';
  document.getElementById('sd-batch-n').focus();
  document.getElementById('sd-batch-ok').addEventListener('click', () => {
    const n = Math.max(1, Math.min(maxCount, +document.getElementById('sd-batch-n').value || 1));
    createBatchLinks(n);
  });
  document.getElementById('sd-batch-cancel').addEventListener('click', () => updateStatus(''));
}

function createBatchLinks(n) {
  if (!lastLink || n <= 0) return;
  const links = getLinks();
  const usedFrom = portsUsedOn(lastLink.fromRackId, lastLink.fromDevId);
  const usedTo   = portsUsedOn(lastLink.toRackId,   lastLink.toDevId);
  const pFrom = devicePorts(lastLink.fromRackId, lastLink.fromDevId);
  const pTo   = devicePorts(lastLink.toRackId,   lastLink.toDevId);
  const fromSeq = [];
  for (let p = 1; p <= pFrom && fromSeq.length < n; p++) if (!usedFrom.has(p)) fromSeq.push(p);
  const toSeq = [];
  for (let p = 1; p <= pTo && toSeq.length < n; p++) if (!usedTo.has(p)) toSeq.push(p);
  const count = Math.min(fromSeq.length, toSeq.length);
  const fromLabel = deviceLabel(lastLink.fromRackId, lastLink.fromDevId);
  const toLabel = deviceLabel(lastLink.toRackId, lastLink.toDevId);
  // v0.59.588: batchId группирует связи одного "+N подряд", чтобы юзер мог
  // одной кнопкой откатить пакет — раньше приходилось удалять каждую связь
  // по одной из таблицы.
  const batchId = 'batch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const newIds = [];
  for (let i = 0; i < count; i++) {
    const lid = newId();
    newIds.push(lid);
    links.push({
      id: lid,
      fromRackId: lastLink.fromRackId, fromDevId: lastLink.fromDevId, fromLabel,
      toRackId: lastLink.toRackId, toDevId: lastLink.toDevId, toLabel,
      fromPort: fromSeq[i], toPort: toSeq[i],
      cableType: 'cat6a', lengthM: null, note: '', createdAt: Date.now(),
      batchId,
    });
  }
  setLinks(links);
  // v0.59.588: статус-баннер с кнопкой «↶ Отменить пакет».
  const st = document.getElementById('sd-status');
  if (st) {
    st.innerHTML = `
      <div class="sd-status-batch">
        ✓ Добавлено ${count} связей подряд (порты A:${fromSeq[0]}-${fromSeq[count-1]} ↔ B:${toSeq[0]}-${toSeq[count-1]}).
        <button type="button" class="sd-btn-sel" id="sd-batch-undo" data-batch="${batchId}" style="margin-left:10px;background:#fee2e2;color:#991b1b;border-color:#fca5a5">↶ Отменить пакет (${count})</button>
      </div>`;
    st.style.display = '';
    document.getElementById('sd-batch-undo')?.addEventListener('click', () => {
      const ids = new Set(newIds);
      setLinks(getLinks().filter(l => !ids.has(l.id)));
      updateStatus(`✔ Откатили пакет: удалено ${ids.size} связей.`);
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
      renderLinksList();
      renderLegend();
      renderBom();
    });
  }
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
  renderLegend();
}

/* ---------- Tabs ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.sd-tab');
  const panels = document.querySelectorAll('.sd-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
      if (key === 'links') scheduleOverlay();
      if (key === 'racks') renderRacksSummary();
      if (key === 'plan')  renderPlan();
    });
  });
}

/* ---------- Links tab ---------- */
function renderLinksTab() {
  const picker = document.getElementById('sd-rack-picker');
  const row = document.getElementById('sd-racks-row');
  const empty = document.getElementById('sd-empty');
  const racks = getRacks();

  if (!racks.length) {
    picker.innerHTML = '';
    row.innerHTML = '';
    empty.style.display = '';
    empty.innerHTML = `
      <p>В проекте ещё нет шкафов. Сначала создайте их:</p>
      <p>→ <a href="../rack-config/">Конфигуратор шкафа — корпус</a> (шаблоны)<br>
      → <a href="../scs-config/?from=scs-design">Компоновщик шкафа</a> (наполнение).</p>
    `;
    renderLinksList();
    return;
  }
  empty.style.display = 'none';

  const selected = new Set(loadJson(LS_SELECTION, []));
  const q = (pickerQuery || '').trim().toLowerCase();
  const matches = r => {
    if (!q) return true;
    const tag = (getRackTag(r.id) || '').toLowerCase();
    const name = (r.name || '').toLowerCase();
    return tag.includes(q) || name.includes(q) || r.id.toLowerCase().includes(q);
  };
  // Фаза 1.27.4+: разделение «стойки проекта» vs «библиотека шаблонов».
  // В проекте = есть запись в LS_CONTENTS или тег в LS_RACKTAGS (оба scope'ятся
  // по pid). Библиотечные шаблоны = всё остальное. Библиотеку показываем
  // свернутой — кликом она добавляется в проект (создаётся пустая запись
  // contents), и стойка всплывает наверх в «Стойки проекта».
  const projIds = getProjectRackIds();
  // v0.59.577: POR-стойки (_source='por') считаются «в проекте» по умолчанию —
  // они приходят из POR родителя (с моим fallback v0.59.575). Без этого
  // 16 POR-стоек SR01-08, MR01, CR01 не попадали в picker.
  const inProject  = racks.filter(r => projIds.has(r.id) || r._source === 'por').filter(matches);
  const library    = []; // v0.59.295: библиотека шаблонов убрана из мастера связей
  // v0.59.550: разделяем real / virtual / draft. Виртуал = fromScheme или
  // fromPorGroup. Draft = нет тега и не виртуал.
  const real       = inProject.filter(r => (getRackTag(r.id) || '').trim() && !(r.fromScheme || r.fromPorGroup));
  const virtuals   = inProject.filter(r => r && (r.fromScheme || r.fromPorGroup));
  const drafts     = inProject.filter(r => !(getRackTag(r.id) || '').trim() && !(r.fromScheme || r.fromPorGroup));
  const chipHtml = r => {
    const on = selected.has(r.id);
    const label = rackLabel(r);
    // v0.59.581: × кнопка удаления стойки если она не задействована
    // в других модулях (engine schema, scs-config contents и т.п.).
    return `<label class="sd-rack-chip ${on ? 'on' : ''}" data-id="${r.id}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
      <button type="button" class="sd-rack-chip-del" data-del-id="${escapeAttr(r.id)}" title="Удалить стойку из проекта (только если не задействована в других модулях)" onclick="event.stopPropagation();event.preventDefault();" style="margin-left:6px;background:transparent;border:0;color:#b91c1c;cursor:pointer;font-size:14px;font-weight:bold;padding:0 4px">×</button>
    </label>`;
  };
  const parts = [];
  // поиск
  const totalAll = racks.length;
  const shown = [...real, ...virtuals, ...drafts, ...library];
  const totalShown = shown.length;
  const allShownSelected = totalShown > 0 && shown.every(r => selected.has(r.id));
  parts.push(`<div class="sd-picker-search">
    <input type="search" id="sd-picker-q" placeholder="🔍 поиск по тегу / имени / id" value="${escapeHtml(pickerQuery || '')}" autocomplete="off">
    <span class="muted">${q ? `${totalShown}/${totalAll}` : `${totalAll} шт.`}</span>
    ${totalShown > 0 ? `<button type="button" class="sd-btn-sel" id="sd-picker-toggle-all" title="Выбрать/снять все ${q ? 'найденные' : ''}">${allShownSelected ? '☐ снять все' : '☑ выбрать все'}</button>` : ''}
    ${q ? '<button type="button" class="sd-btn-sel" id="sd-picker-clear">×</button>' : ''}
    <button type="button" class="sd-btn-export" id="sd-new-rack" title="Создать новую стойку в этом проекте (имя/тег/U, опционально — базовое оборудование)">＋ Новая стойка</button>
  </div>`);
  if (real.length) {
    parts.push(`<div class="sd-rack-group-h">🗄 Стойки проекта — с тегом (${real.length})</div>`);
    parts.push(`<div class="sd-rack-group">${real.map(chipHtml).join('')}</div>`);
  }
  if (virtuals.length) {
    parts.push(`<div class="sd-rack-group-h" style="background:#eff6ff;color:#1e3a8a">🔗 Виртуалы из схемы / POR-группы (${virtuals.length}) — клик материализует в inst-*</div>`);
    parts.push(`<div class="sd-rack-group">${virtuals.map(chipHtml).join('')}</div>`);
  }
  if (drafts.length) {
    parts.push(`<div class="sd-rack-group-h draft">📐 Стойки проекта — без тега / черновики (${drafts.length})</div>`);
    parts.push(`<div class="sd-rack-group draft">${drafts.map(chipHtml).join('')}</div>`);
  }
  if (library.length) {
    parts.push(`<div class="sd-rack-group-h" style="opacity:.7">📚 Библиотека шаблонов (${library.length}) — клик добавит в проект</div>`);
    parts.push(`<div class="sd-rack-group" style="opacity:.75">${library.map(chipHtml).join('')}</div>`);
  }
  if (!real.length && !virtuals.length && !drafts.length && !library.length && q) {
    parts.push(`<div class="sd-empty-state" style="padding:8px">Ничего не найдено по «${escapeHtml(q)}». Проверьте раскладку или очистите поиск.</div>`);
  }
  picker.innerHTML = parts.join('');

  const qInput = document.getElementById('sd-picker-q');
  if (qInput) {
    qInput.addEventListener('input', e => {
      pickerQuery = e.target.value;
      renderLinksTab();
      // вернуть фокус в поле после re-render
      const q2 = document.getElementById('sd-picker-q');
      if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
    });
  }
  document.getElementById('sd-picker-clear')?.addEventListener('click', () => {
    pickerQuery = '';
    renderLinksTab();
  });
  document.getElementById('sd-picker-toggle-all')?.addEventListener('click', () => {
    if (allShownSelected) shown.forEach(r => selected.delete(r.id));
    else shown.forEach(r => selected.add(r.id));
    saveJson(LS_SELECTION, Array.from(selected));
    renderLinksTab();
  });

  // Кнопка «＋ Новая стойка»: создать и сразу выбрать в мастер
  document.getElementById('sd-new-rack')?.addEventListener('click', async () => {
    const opts = await sdRackWizard();
    if (!opts) return;
    const newId = createProjectRack(opts);
    const sel = new Set(loadJson(LS_SELECTION, []));
    sel.add(newId);
    saveJson(LS_SELECTION, Array.from(sel));
    renderLinksTab();
  });

  picker.querySelectorAll('.sd-rack-chip').forEach(chip => {
    const id = chip.dataset.id;
    const input = chip.querySelector('input');
    input.addEventListener('change', () => {
      // v0.59.550: если выбирают виртуал — материализуем перед добавлением
      // в selection. Связи (кабели) тянутся между УСТРОЙСТВАМИ внутри стоек,
      // поэтому виртуал без contents бесполезен; материализация даёт реальный
      // inst-* с тегом=autoTag, контент пользователь добавит позже в Компоновщике.
      const isVirt = String(id).startsWith('scheme-') || String(id).startsWith('por-group-');
      if (input.checked && isVirt) {
        const r = racks.find(x => x.id === id);
        const tag = r && r.autoTag ? r.autoTag : '';
        if (!tag) { input.checked = false; return; }
        const newId = materializeFromVirtual(id, tag);
        if (!newId) { input.checked = false; return; }
        selected.add(newId);
        saveJson(LS_SELECTION, Array.from(selected));
        renderLinksTab(); // полный re-render — список racks обновится
        return;
      }
      // Если пользователь выбирает стойку из библиотеки — автоматически
      // добавляем её в проект (пустая запись contents), чтобы в следующий
      // раз она показалась в группе «Стойки проекта».
      if (input.checked && !projIds.has(id)) {
        const all = loadJson(LS_CONTENTS, {});
        if (!all[id]) { all[id] = []; saveJson(LS_CONTENTS, all); }
      }
      if (input.checked) selected.add(id); else selected.delete(id);
      saveJson(LS_SELECTION, Array.from(selected));
      chip.classList.toggle('on', input.checked);
      renderSelected(selected, racks);
    });
  });

  // v0.59.581: handler × кнопки — удалить стойку из проекта если не задействована.
  picker.querySelectorAll('.sd-rack-chip-del').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const rackId = btn.dataset.delId;
      const r = racks.find(x => x.id === rackId);
      if (!r) return;
      const label = (getRackTag(rackId) || r.name || rackId);
      const usage = _checkRackUsage(r);
      if (usage.blocked.length) {
        const ph = document.createElement('div');
        ph.style.cssText = 'position:fixed;top:60px;right:20px;background:#b91c1c;color:#fff;padding:12px 16px;border-radius:6px;z-index:9999;max-width:420px;box-shadow:0 4px 12px rgba(0,0,0,.3)';
        ph.innerHTML = `<b>Нельзя удалить «${escapeHtml(label)}»</b><br>Задействована в: ${usage.blocked.join(', ')}.<br>Снимите её сначала там.`;
        document.body.appendChild(ph);
        setTimeout(() => ph.remove(), 5500);
        return;
      }
      const ok = await sdConfirmDelete(label, usage.warnings);
      if (!ok) return;
      _hardDeleteRack(r);
      renderLinksTab();
    });
  });

  renderSelected(selected, racks);
  renderLinksList();
  renderLegend();
}

// v0.59.581: проверка использования стойки в текущем модуле и других.
// ТЗ юзера: «если в стойке размещено оборудование, которое подключено
// к другому оборудованию (без разницы в каком модуле) то стойку удалять
// нельзя».
// blocked[] — реальные внешние связи (block delete).
// warnings[] — присутствуют изолированные данные (cascade-очистка ок).
function _checkRackUsage(r) {
  const blocked = [];
  const warnings = [];
  const rackId = r.id;
  // 1. SCS-design links — fromRackId/toRackId === rackId означает что
  //    оборудование стойки подключено к оборудованию ДРУГОЙ стойки.
  const links = getLinks();
  const linksUsing = links.filter(l => l.fromRackId === rackId || l.toRackId === rackId);
  if (linksUsing.length) {
    blocked.push(`СКС-связи (${linksUsing.length} шт.)`);
  }
  // 2. Engine schema — если у стойки есть porObjectId, проверяем engine
  //    state.conns на links from/to этого узла. Engine в scs-design не
  //    загружен напрямую, но если присутствует scheme в LS родителя —
  //    можем читать.
  try {
    const pid = getActiveProjectId();
    const activeProj = pid ? getProject(pid) : null;
    const schemePid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
      ? activeProj.parentProjectId
      : pid;
    if (schemePid && r.porObjectId) {
      const schKey = `raschet.project.${schemePid}.engine.scheme.v1`;
      const sch = loadJson(schKey, null);
      if (sch && Array.isArray(sch.nodes)) {
        // Найти engine-узел с этим porObjectId.
        const engineNode = sch.nodes.find(n => n && n.porObjectId === r.porObjectId);
        if (engineNode && Array.isArray(sch.connections)) {
          const engConns = sch.connections.filter(c =>
            c?.from?.nodeId === engineNode.id || c?.to?.nodeId === engineNode.id);
          if (engConns.length) {
            blocked.push(`электрических связей в схеме (${engConns.length} шт.)`);
          }
        }
      }
    }
  } catch {}
  // 3. scs-config contents — устройства в стойке (warning, не блок).
  try {
    const allContents = loadJson(LS_CONTENTS, {});
    const devs = Array.isArray(allContents[rackId]) ? allContents[rackId] : [];
    if (devs.length) warnings.push(`устройств в Компоновщике (${devs.length} шт.)`);
  } catch {}
  return { blocked, warnings };
}

// v0.59.581: каскадное hard-удаление стойки: POR-объект (через RaschetPOR),
// rack-config instance (LS), state.rackTags, scs-config contents/matrix.
function _hardDeleteRack(r) {
  const rackId = r.id;
  // 1. POR-объект (если есть _source='por' или porObjectId).
  try {
    if (typeof window !== 'undefined' && window.RaschetPOR) {
      const pid = getActiveProjectId();
      const activeProj = pid ? getProject(pid) : null;
      const targetPid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
        ? activeProj.parentProjectId
        : pid;
      // POR id — может быть r.porObjectId или сам r.id (если он por_legacy_*).
      const porIds = [r.porObjectId, r.id].filter(Boolean);
      for (const pid2 of porIds) {
        try { window.RaschetPOR.removeObject(targetPid, pid2); } catch {}
      }
    }
  } catch (e) { console.warn('[scs-design] del POR failed:', e); }
  // 2. rack-config instance (LS).
  try {
    const pid = getActiveProjectId();
    const activeProj = pid ? getProject(pid) : null;
    const targetPid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
      ? activeProj.parentProjectId
      : pid;
    if (targetPid) {
      const instKey = `raschet.project.${targetPid}.rack-config.instances.v1`;
      const arr = loadJson(instKey, []);
      const filtered = (Array.isArray(arr) ? arr : []).filter(x => x && x.id !== rackId);
      if (filtered.length !== arr.length) localStorage.setItem(instKey, JSON.stringify(filtered));
    }
  } catch (e) { console.warn('[scs-design] del instance failed:', e); }
  // 3. scs-config rackTags / contents / matrix (текущий sub).
  try {
    const tags = loadJson(LS_RACKTAGS, {});
    if (tags[rackId]) { delete tags[rackId]; saveJson(LS_RACKTAGS, tags); }
  } catch {}
  try {
    const contents = loadJson(LS_CONTENTS, {});
    if (contents[rackId]) { delete contents[rackId]; saveJson(LS_CONTENTS, contents); }
  } catch {}
}

// in-page confirm dialog
// v0.59.588: общий inline-confirm для произвольных подтверждений (не только
// удаления стоек). Использует тот же стиль модалки что и sdConfirmDelete.
function sdConfirmInline(message, opts) {
  return new Promise(res => {
    const o = opts || {};
    const okLabel = o.okLabel || 'Удалить';
    const noLabel = o.noLabel || 'Отмена';
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
    back.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:18px 22px;min-width:380px;max-width:520px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;color:#0f172a">
        <div style="font-size:14px;color:#1f2937;margin-bottom:14px">${escapeHtml(message)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" data-act="no" style="padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer">${escapeHtml(noLabel)}</button>
          <button type="button" data-act="yes" style="padding:6px 14px;border:1px solid #b91c1c;border-radius:6px;background:#b91c1c;color:#fff;cursor:pointer">${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = (v) => { back.remove(); res(v); };
    back.addEventListener('click', e => {
      if (e.target === back) close(false);
      const a = e.target.dataset?.act;
      if (a === 'yes') close(true);
      if (a === 'no') close(false);
    });
  });
}

function sdConfirmDelete(label, warnings) {
  return new Promise(res => {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
    const warnHtml = warnings && warnings.length
      ? `<div style="margin-top:8px;padding:8px 10px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;color:#92400e;font-size:12px">⚠ Также будут стёрты: ${warnings.join(', ')}</div>`
      : '';
    back.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:18px 22px;min-width:380px;max-width:480px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;color:#0f172a">
        <div style="font-size:15px;font-weight:600;margin-bottom:10px;color:#b91c1c">🗑 Удалить «${escapeHtml(label)}»?</div>
        <div style="color:#475569">Стойка не задействована в других модулях. Будет удалена из POR и Реестра проекта. Действие необратимо.</div>
        ${warnHtml}
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" data-act="no" style="padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer">Отмена</button>
          <button type="button" data-act="yes" style="padding:6px 14px;border:1px solid #b91c1c;border-radius:6px;background:#b91c1c;color:#fff;cursor:pointer">Удалить</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = (v) => { back.remove(); res(v); };
    back.addEventListener('click', e => {
      if (e.target === back) close(false);
      const a = e.target.dataset?.act;
      if (a === 'yes') close(true);
      if (a === 'no') close(false);
    });
  });
}

function renderLegend() {
  const host = document.getElementById('sd-legend'); if (!host) return;
  const used = new Set(getVisibleLinks().map(l => l.cableType || 'other'));
  if (!used.size) { host.innerHTML = ''; return; }
  host.innerHTML = '<span class="muted">Цвета кабелей:</span>' + CABLE_TYPES
    .filter(t => used.has(t.id))
    .map(t => `<span class="lg"><span class="lg-dot" style="background:${t.color}"></span>${escapeHtml(t.label)}</span>`)
    .join('');
}

function renderSelected(selected, racks) {
  const row = document.getElementById('sd-racks-row');
  // v0.59.590: используем порядок из LS_SELECTION (массив), а не порядок
  // racks. Это сохраняет user-defined ordering при drag-reorder.
  const selectionArr = loadJson(LS_SELECTION, []);
  const racksById = new Map(racks.map(r => [r.id, r]));
  const arr = selectionArr.map(id => racksById.get(id)).filter(Boolean);
  // Добавляем оставшиеся выбранные racks, которых нет в selectionArr (защита
  // на случай если кто-то добавил id в Set, минуя массив).
  for (const r of racks) {
    if (selected.has(r.id) && !selectionArr.includes(r.id)) arr.push(r);
  }
  if (!arr.length) {
    row.innerHTML = `<div class="sd-empty-state">Выберите чекбоксами стойки в левой панели — они появятся здесь рядом для проектирования связей.</div>`;
    drawLinkOverlay();
    return;
  }
  row.innerHTML = arr.map(r => renderRackCard(r)).join('');

  // клик по юниту — логика link-start / link-end
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    el.addEventListener('click', () => onUnitClick(el));
  });

  // подсветить устройства, участвующие в связях
  const links = getLinks();
  const involved = new Set();
  links.forEach(l => {
    involved.add(l.fromRackId + '|' + l.fromDevId);
    involved.add(l.toRackId + '|' + l.toDevId);
  });
  row.querySelectorAll('.sd-unit[data-dev-id]').forEach(el => {
    const key = el.dataset.rackId + '|' + el.dataset.devId;
    el.classList.toggle('linked', involved.has(key));
  });

  // v0.59.590: drag-and-drop reorder. HTML5 drag API: dragstart на карточке
  // сохраняет id источника, dragover на другой карточке подсвечивает место
  // вставки (before/after по horizontal middle), drop переставляет в массиве
  // LS_SELECTION и сохраняет.
  let dragSrcId = null;
  row.querySelectorAll('.sd-rack-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      // запускаем drag только если grip захвачен (или вообще с заголовка)
      if (e.target.closest('.sd-unit') || e.target.closest('.sd-rack-edit')) {
        e.preventDefault();
        return;
      }
      dragSrcId = card.dataset.rackCardId;
      card.classList.add('dragging-reorder');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/sd-rack-reorder', dragSrcId); } catch {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging-reorder');
      row.querySelectorAll('.drop-target-before,.drop-target-after').forEach(el => {
        el.classList.remove('drop-target-before', 'drop-target-after');
      });
    });
    card.addEventListener('dragover', (e) => {
      if (!dragSrcId) return;
      const tgtId = card.dataset.rackCardId;
      if (!tgtId || tgtId === dragSrcId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = card.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      // Очищаем все маркеры и ставим текущему — для визуального фидбека.
      row.querySelectorAll('.drop-target-before,.drop-target-after').forEach(el => {
        el.classList.remove('drop-target-before', 'drop-target-after');
      });
      card.classList.add(before ? 'drop-target-before' : 'drop-target-after');
    });
    card.addEventListener('drop', (e) => {
      if (!dragSrcId) return;
      const tgtId = card.dataset.rackCardId;
      if (!tgtId || tgtId === dragSrcId) return;
      e.preventDefault();
      // Переставляем dragSrcId перед/после tgtId в массиве LS_SELECTION.
      const cur = loadJson(LS_SELECTION, []);
      const arrCur = cur.filter(id => id !== dragSrcId);
      const idx = arrCur.indexOf(tgtId);
      if (idx < 0) return;
      const r = card.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      arrCur.splice(before ? idx : idx + 1, 0, dragSrcId);
      saveJson(LS_SELECTION, arrCur);
      const sel = new Set(arrCur);
      renderSelected(sel, getRacks());
      renderLinksTab();
    });
  });

  drawLinkOverlay();
}

/* ---------- SVG overlay: кривые Безье между устройствами ---------- */
function drawLinkOverlay() {
  const svg = document.getElementById('sd-links-svg');
  const wrap = svg?.parentElement;
  const row = document.getElementById('sd-racks-row');
  if (!svg || !wrap || !row) return;
  // v0.59.589: видимость управляется кнопкой 👁; при false просто очищаем SVG.
  if (!linksOverlayVisible) {
    svg.innerHTML = '';
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

  const getCenter = (rackId, devId, side) => {
    const el = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"][data-dev-id="${CSS.escape(devId)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const y = r.top - wrapRect.top + r.height / 2;
    const x = side === 'left' ? (r.left - wrapRect.left) : (r.right - wrapRect.left);
    return { x, y };
  };

  const cardXCenter = rackId => {
    const firstUnit = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(rackId)}"]`)
      || row.querySelector(`.sd-rack-card:has([data-rack-id="${CSS.escape(rackId)}"])`);
    if (!firstUnit) return null;
    const card = firstUnit.closest('.sd-rack-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return (r.left + r.right) / 2 - wrapRect.left;
  };

  const parts = [];
  const links = getVisibleLinks();
  links.forEach(l => {
    const fromCenter = cardXCenter(l.fromRackId);
    const toCenter = cardXCenter(l.toRackId);
    if (fromCenter == null || toCenter == null) return;
    const fromSide = fromCenter < toCenter ? 'right' : 'left';
    const toSide   = fromCenter < toCenter ? 'left'  : 'right';
    const A = getCenter(l.fromRackId, l.fromDevId, fromSide);
    const B = getCenter(l.toRackId, l.toDevId, toSide);
    if (!A || !B) return;
    const dx = Math.abs(B.x - A.x);
    const bend = Math.max(40, dx * 0.35);
    const c1x = A.x + (fromSide === 'right' ? bend : -bend);
    const c2x = B.x + (toSide === 'right' ? bend : -bend);
    // v0.59.589: провисающие линии (как реальные кабели). Контрольные точки
    // опускаются ниже эндпойнтов на sag — получается catenary-подобная форма.
    // sag растёт пропорционально расстоянию между стойками, но капается
    // потолком, чтобы при близких устройствах кабель не свисал слишком низко.
    const sag = linksSagEnabled ? Math.min(120, Math.max(20, dx * 0.18)) : 0;
    const c1y = A.y + sag;
    const c2y = B.y + sag;
    const color = CABLE_COLOR(l.cableType);
    const fromTxt = getRackShortLabel(l.fromRackId) + ' · ' + deviceLabel(l.fromRackId, l.fromDevId) + (l.fromPort ? ` p${l.fromPort}` : '');
    const toTxt   = getRackShortLabel(l.toRackId)   + ' · ' + deviceLabel(l.toRackId,   l.toDevId)   + (l.toPort   ? ` p${l.toPort}`   : '');
    const isSel = linksSelected.has(l.id);
    parts.push(`<path class="sd-link-path${isSel ? ' selected' : ''}" data-link-id="${escapeAttr(l.id)}" d="M ${A.x} ${A.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${B.x} ${B.y}" stroke="${color}" style="cursor:pointer"><title>${escapeAttr(fromTxt + ' ↔ ' + toTxt)} (клик: выделить связь, Shift+клик — добавить)</title></path>`);
  });
  svg.innerHTML = parts.join('');
  // v0.59.590: клик по линии — выделение связи в таблице (Shift = добавить).
  svg.querySelectorAll('path[data-link-id]').forEach(p => {
    p.addEventListener('click', e => {
      e.stopPropagation();
      const id = p.dataset.linkId;
      if (!id) return;
      if (!e.shiftKey) linksSelected.clear();
      if (linksSelected.has(id)) linksSelected.delete(id);
      else linksSelected.add(id);
      renderLinksList();
      drawLinkOverlay();
      // прокрутить таблицу к выбранной строке
      const tr = document.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

// Перерисовка линий при скролле/ресайзе
let overlayRaf = 0;
function scheduleOverlay() {
  if (overlayRaf) return;
  overlayRaf = requestAnimationFrame(() => { overlayRaf = 0; drawLinkOverlay(); });
}

function renderRackCard(r) {
  const u = +r.u || 42;
  const devices = getContents(r.id);
  const tag = getRackTag(r.id);
  const occupancy = Array.from({ length: u + 1 }, () => null);
  devices.forEach(d => {
    const top = +d.positionU || 1;
    const t = catalogType(d.typeId);
    const h = +d.heightU || (t && +t.heightU) || 1;
    for (let i = 0; i < h; i++) {
      const idx = top - i;
      if (idx >= 1 && idx <= u && !occupancy[idx]) {
        occupancy[idx] = { dev: d, isTop: i === 0 };
      }
    }
  });

  const units = [];
  for (let i = 1; i <= u; i++) {
    const cell = occupancy[i];
    if (cell && cell.isTop) {
      const d = cell.dev;
      const tc = catalogType(d.typeId);
      const h = +d.heightU || (tc && +tc.heightU) || 1;
      // занимаемый диапазон: от top (i) до bottom (i - h + 1)
      const bottom = i - h + 1;
      const uRange = h > 1 ? `${i}-${bottom}` : `${i}`;
      const hBadge = h > 1 ? `<span class="u-hbadge">${h}U</span>` : '';
      // multi-U: высота = h × unit-row-height + (h-1) × gap. Рассчитывается через CSS var.
      const style = h > 1 ? ` style="--u-span:${h}"` : '';
      const organizer = isOrganizer(d);
      if (organizer) {
        units.push(`<div class="sd-unit organizer${h>1?' multi':''}"${style} title="Кабельный органайзер — только трассировка, не endpoint">
          <span class="u-num">${uRange}</span>
          <span class="u-label">⇋ ${escapeHtml(d.label || d.typeId || 'Органайзер')}${hBadge}</span>
        </div>`);
      } else {
        // v0.59.592: подсветка А/B сохраняется при перерисовке rack-карточек.
        const isStart = linkStart && linkStart.rackId === r.id && linkStart.devId === d.id;
        const isEnd   = linkEnd   && linkEnd.rackId   === r.id && linkEnd.devId   === d.id;
        const selCls = isStart ? ' sel' : (isEnd ? ' sel-end' : '');
        const ports = devicePorts(r.id, d.id);
        const used = ports ? portsUsedOn(r.id, d.id).size : 0;
        const portBadge = ports > 1
          ? `<span class="u-pbadge${used >= ports ? ' full' : used ? ' part' : ''}" title="${used} из ${ports} портов занято">${used}/${ports}</span>`
          : '';
        units.push(`<div class="sd-unit${h>1?' multi':''}${selCls}"${style} data-rack-id="${escapeAttr(r.id)}" data-dev-id="${escapeAttr(d.id)}" title="${escapeAttr(d.label || d.typeId || '')}">
          <span class="u-num">${uRange}</span>
          <span class="u-label">${escapeHtml(d.label || d.typeId || '—')}${hBadge}${portBadge}</span>
        </div>`);
      }
    } else if (!cell) {
      units.push(`<div class="sd-unit empty"><span class="u-num">${i}</span><span class="u-label">·</span></div>`);
    }
  }

  // v0.59.283: кнопка ✎ ведёт в Компоновщик шкафа (rack.html) с этим rackId.
  const editBtn = `<a class="sd-rack-edit" href="../scs-config/rack.html?rackId=${encodeURIComponent(r.id)}&from=scs-design" title="Редактировать стойку в Компоновщике (мастере)" onclick="event.stopPropagation()">✎</a>`;
  // v0.59.590: drag-handle для перестановки стоек в мастере связей.
  return `<div class="sd-rack-card" data-rack-card-id="${escapeAttr(r.id)}" draggable="true">
    <div class="sd-rack-head sd-rack-card-handle" title="Перетащите карточку стойки, чтобы изменить порядок в мастере связей">
      <span style="display:flex;align-items:center;gap:4px;flex:1;min-width:0">
        <span class="sd-rack-card-grip" style="cursor:grab;color:#94a3b8;font-size:14px;line-height:1;user-select:none" title="Перетащить">⋮⋮</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name || 'Без имени')}</span>${editBtn}</span>
      <span class="tag">${escapeHtml(tag || '—')}</span>
    </div>
    <div class="sd-units">${units.join('')}</div>
  </div>`;
}

// v0.59.592: клик по устройству = ВЫБОР, не автоматическое создание связи.
// Юзер: «клик на оборудовании с портами не должен запускать подключение
// к портам, а только выбор оборудования».
// UX:
//   1-й клик  → linkStart = устройство A, подсветка
//   2-й клик по тому же → снять выделение
//   2-й клик по другому в той же стойке → переключить linkStart на новое
//     (внутри-стоечные связи делаются в Компоновщике, не здесь).
//   2-й клик по другому в ДРУГОЙ стойке → linkEnd = устройство B; обе
//     подсвечены. Связь НЕ создаётся — в статус-баре кнопка
//     «🔗 Создать связь A → B» (юзер явно подтверждает).
//   3-й клик по любому → если уже двое выбрано, переключаем linkEnd либо
//     заменяем linkStart (зависит от логики).
function onUnitClick(el) {
  const rackId = el.dataset.rackId;
  const devId = el.dataset.devId;
  const label = el.querySelector('.u-label').textContent.trim();

  // Нет выбора → выделить как A.
  if (!linkStart) {
    linkStart = { rackId, devId, label };
    linkEnd = null;
    _refreshSelectionUI();
    return;
  }
  // Клик по тому же устройству, что A → снять выделение.
  if (linkStart.rackId === rackId && linkStart.devId === devId) {
    linkStart = linkEnd; // если есть B, оно становится A
    linkEnd = null;
    _refreshSelectionUI();
    return;
  }
  // Клик по B (если есть) → снять B (отмена пары).
  if (linkEnd && linkEnd.rackId === rackId && linkEnd.devId === devId) {
    linkEnd = null;
    _refreshSelectionUI();
    return;
  }
  // Клик по устройству в той же стойке что A → внутри-шкафная связь
  // не делается здесь, сообщаем + переключаем A на новое устройство.
  if (linkStart.rackId === rackId && !linkEnd) {
    linkStart = { rackId, devId, label };
    updateStatus(`⚠ Связь внутри одного шкафа — настраивается в <a href="../scs-config/?from=scs-design">Компоновщике шкафа</a>. Здесь выбрано <b>${escapeHtml(label)}</b>.`);
    _refreshSelectionUI(true /* keep status */);
    return;
  }
  // Клик по третьему устройству → перезаписываем B.
  linkEnd = { rackId, devId, label };
  _refreshSelectionUI();
}

// v0.59.592: обновить визуал выделения + статус-бар с кнопкой «🔗 Создать
// связь». Опция keepStatus — не перезаписывать уже выставленный статус
// (например, после warning-а про внутри-шкафную связь).
function _refreshSelectionUI(keepStatus) {
  const row = document.getElementById('sd-racks-row');
  if (row) {
    row.querySelectorAll('.sd-unit.sel,.sd-unit.sel-end').forEach(el => el.classList.remove('sel', 'sel-end'));
    if (linkStart) {
      const sel = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(linkStart.rackId)}"][data-dev-id="${CSS.escape(linkStart.devId)}"]`);
      if (sel) sel.classList.add('sel');
    }
    if (linkEnd) {
      const sel = row.querySelector(`.sd-unit[data-rack-id="${CSS.escape(linkEnd.rackId)}"][data-dev-id="${CSS.escape(linkEnd.devId)}"]`);
      if (sel) sel.classList.add('sel-end');
    }
  }
  if (keepStatus) return;
  if (linkStart && linkEnd) {
    const aLabel = `${getRackShortLabel(linkStart.rackId)} · ${escapeHtml(linkStart.label)}`;
    const bLabel = `${getRackShortLabel(linkEnd.rackId)} · ${escapeHtml(linkEnd.label)}`;
    updateStatus(`✔ Выбрано: <b>${aLabel}</b> ↔ <b>${bLabel}</b>. <button id="sd-link-create" class="sd-btn-sel" style="margin-left:8px;background:#dbeafe;color:#1e40af;border-color:#93c5fd">🔗 Создать связь</button> <button id="sd-link-cancel" class="sd-btn-sel" style="margin-left:4px">✕ Отмена</button>`);
    document.getElementById('sd-link-create')?.addEventListener('click', _createLinkFromSelection);
    document.getElementById('sd-link-cancel')?.addEventListener('click', () => {
      linkStart = null; linkEnd = null; _refreshSelectionUI();
    });
  } else if (linkStart) {
    updateStatus(`Выбрано: <b>${escapeHtml(linkStart.label)}</b> (${escapeHtml(getRackShortLabel(linkStart.rackId))}). Кликните на устройство в другой стойке для пары.`);
  } else {
    updateStatus('');
  }
}

// v0.59.592: создать связь из текущей пары выбранных устройств.
// Раньше эта логика была встроена в onUnitClick; теперь — отдельная функция,
// вызывается явно по кнопке «🔗 Создать связь».
function _createLinkFromSelection() {
  if (!linkStart || !linkEnd) return;
  if (linkStart.rackId === linkEnd.rackId) {
    updateStatus(`⚠ Связь внутри одного шкафа — настраивается в <a href="../scs-config/?from=scs-design">Компоновщике шкафа</a>, не здесь.`);
    return;
  }
  const links = getLinks();
  const pFrom = devicePorts(linkStart.rackId, linkStart.devId);
  const pTo   = devicePorts(linkEnd.rackId,   linkEnd.devId);
  const usedFrom = portsUsedOn(linkStart.rackId, linkStart.devId);
  const usedTo   = portsUsedOn(linkEnd.rackId,   linkEnd.devId);
  const firstFree = (max, used) => {
    for (let p = 1; p <= max; p++) if (!used.has(p)) return p;
    return null;
  };
  const fromPort = pFrom > 1 ? firstFree(pFrom, usedFrom) : null;
  const toPort   = pTo   > 1 ? firstFree(pTo,   usedTo)   : null;
  const fromDev = getContents(linkStart.rackId).find(x => x.id === linkStart.devId);
  const toDev   = getContents(linkEnd.rackId).find(x => x.id === linkEnd.devId);
  const pTypeA = inferPortType(fromDev), pTypeB = inferPortType(toDev);
  const fromT = fromDev ? catalogType(fromDev.typeId) : null;
  const toT   = toDev   ? catalogType(toDev.typeId)   : null;
  const sA = parseGbps(fromT?.portSpeed);
  const sB = parseGbps(toT?.portSpeed);
  const needG = Math.max(sA || 0, sB || 0);
  let defCable = 'cat6a';
  if (pTypeA === 'lc' || pTypeB === 'lc' || pTypeA === 'sfp' || pTypeB === 'sfp') {
    defCable = needG > 100 ? 'os2' : needG > 40 ? 'om4' : needG > 10 ? 'om4' : 'om3';
  } else if (pTypeA === 'bnc' || pTypeB === 'bnc') defCable = 'coax';
  else if (pTypeA === 'power' || pTypeB === 'power') defCable = 'power-c13';
  else if (needG > 1) defCable = 'cat6a';
  else defCable = 'cat6';
  const newLink = {
    id: newId(),
    fromRackId: linkStart.rackId, fromDevId: linkStart.devId, fromLabel: linkStart.label,
    toRackId: linkEnd.rackId, toDevId: linkEnd.devId, toLabel: linkEnd.label,
    fromPort, toPort,
    cableType: defCable,
    lengthM: null,
    note: '',
    createdAt: Date.now(),
  };
  links.push(newLink);
  setLinks(links);
  lastLink = { fromRackId: linkStart.rackId, fromDevId: linkStart.devId, toRackId: linkEnd.rackId, toDevId: linkEnd.devId };
  const aLabel = linkStart.label;
  const portInfo = (fromPort || toPort)
    ? ` (${fromPort ? 'A:p'+fromPort : 'A'} ↔ ${toPort ? 'B:p'+toPort : 'B'})`
    : '';
  const batchBtn = (pFrom > 1 && pTo > 1)
    ? ` <button id="sd-batch-btn" class="sd-btn-sel" style="margin-left:8px">+ ещё N связей подряд</button>`
    : '';
  linkStart = null; linkEnd = null;
  updateStatus(`✔ Связь добавлена: <b>${escapeHtml(aLabel)}</b>${portInfo}. Всего: ${links.length}.${batchBtn}`);
  document.getElementById('sd-batch-btn')?.addEventListener('click', promptBatchWire);
  const selected = new Set(loadJson(LS_SELECTION, []));
  renderSelected(selected, getRacks());
  renderLinksList();
}

function getRackShortLabel(rackId) {
  const r = rackById(rackId); if (!r) return rackId;
  const tag = getRackTag(rackId);
  return tag || r.name || rackId;
}

function updateStatus(html) {
  const el = document.getElementById('sd-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

/* ---------- Links list ---------- */
function renderLinksList() {
  const host = document.getElementById('sd-links-list');
  if (!host) return;
  const allLinks = getVisibleLinks();
  if (!allLinks.length) {
    host.innerHTML = `<div class="sd-empty-state">Пока нет ни одной действующей меж-шкафной связи. Кликните на устройство в одной стойке, затем на устройство в другой — появится связь.</div>`;
    renderBom();
    return;
  }
  // фильтр: поиск (шкаф/устройство/заметка) + тип кабеля + источник + цель + только без длины
  // v0.59.588: фильтры источника/цели + кросс-зависимость по MEMORY-правилу
  // (опции каждого select зависят от значений ВСЕХ остальных фильтров).
  const q = (linksQuery || '').trim().toLowerCase();
  const ct = linksCableFilter || '';
  const fromR = linksFromRackFilter || '';
  const toR = linksToRackFilter || '';
  const missingOnly = !!linksMissingOnly;
  const linkMatchesQuery = l => {
    if (!q) return true;
    const hay = [
      getRackShortLabel(l.fromRackId), deviceLabel(l.fromRackId, l.fromDevId),
      getRackShortLabel(l.toRackId),   deviceLabel(l.toRackId,   l.toDevId),
      l.note || ''
    ].join(' ').toLowerCase();
    return hay.includes(q);
  };
  // Полный фильтр (для итоговой таблицы):
  const linkMatches = l => {
    if (ct && (l.cableType || '') !== ct) return false;
    if (missingOnly && l.lengthM != null) return false;
    if (fromR && l.fromRackId !== fromR) return false;
    if (toR && l.toRackId !== toR) return false;
    if (!linkMatchesQuery(l)) return false;
    return true;
  };
  // Кросс-зависимые опции: для каждого фильтра берём всех кандидатов из
  // allLinks при отключённом ИМЕННО ЭТОМ фильтре. Так если выбран from=CR01,
  // в to-select показываются только те racks, которые связаны с CR01;
  // и наоборот — если выбран ct='cat6a', from/to сужаются.
  const matchesExceptFrom = l => {
    if (ct && (l.cableType || '') !== ct) return false;
    if (missingOnly && l.lengthM != null) return false;
    if (toR && l.toRackId !== toR) return false;
    return linkMatchesQuery(l);
  };
  const matchesExceptTo = l => {
    if (ct && (l.cableType || '') !== ct) return false;
    if (missingOnly && l.lengthM != null) return false;
    if (fromR && l.fromRackId !== fromR) return false;
    return linkMatchesQuery(l);
  };
  const matchesExceptCable = l => {
    if (missingOnly && l.lengthM != null) return false;
    if (fromR && l.fromRackId !== fromR) return false;
    if (toR && l.toRackId !== toR) return false;
    return linkMatchesQuery(l);
  };
  const links = allLinks.filter(linkMatches);

  const fromIds = Array.from(new Set(allLinks.filter(matchesExceptFrom).map(l => l.fromRackId))).sort((a, b) => {
    const ta = getRackShortLabel(a) || a;
    const tb = getRackShortLabel(b) || b;
    return String(ta).localeCompare(String(tb), 'ru', { numeric: true });
  });
  const toIds = Array.from(new Set(allLinks.filter(matchesExceptTo).map(l => l.toRackId))).sort((a, b) => {
    const ta = getRackShortLabel(a) || a;
    const tb = getRackShortLabel(b) || b;
    return String(ta).localeCompare(String(tb), 'ru', { numeric: true });
  });
  const cableIdsAvailable = new Set(allLinks.filter(matchesExceptCable).map(l => l.cableType || ''));

  const fromOpts = ['<option value="">все источники</option>'].concat(
    fromIds.map(id => `<option value="${escapeAttr(id)}" ${fromR === id ? 'selected' : ''}>${escapeHtml(getRackShortLabel(id) || id)}</option>`)
  ).join('');
  const toOpts = ['<option value="">все цели</option>'].concat(
    toIds.map(id => `<option value="${escapeAttr(id)}" ${toR === id ? 'selected' : ''}>${escapeHtml(getRackShortLabel(id) || id)}</option>`)
  ).join('');
  const cableOpts = ['<option value="">все типы</option>'].concat(
    CABLE_TYPES.filter(t => cableIdsAvailable.has(t.id) || ct === t.id).map(t =>
      `<option value="${t.id}" ${ct === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
    )
  ).join('');
  const opts = CABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  const anyFilter = q || ct || missingOnly || fromR || toR;
  // v0.59.590: чистка stale-id'шников из linksSelected (если связи были удалены).
  const validIds = new Set(allLinks.map(l => l.id));
  for (const id of Array.from(linksSelected)) if (!validIds.has(id)) linksSelected.delete(id);
  const visibleIds = links.map(l => l.id);
  const visibleSelectedCount = visibleIds.filter(id => linksSelected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const selectedCount = linksSelected.size;
  // v0.59.590: bulk-toolbar появляется при size >= 1. Действия:
  //   🗑 удалить N — удалить выделенные связи
  //   тип кабеля — сменить cableType у всех выделенных
  //   длина — задать lengthM у всех выделенных
  //   ✕ снять — сбросить выделение
  const bulkBar = selectedCount > 0
    ? `<div class="sd-links-bulk-bar" style="margin:6px 0;padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px">
        <b style="color:#1e3a8a">Выделено: ${selectedCount}</b>
        <select id="sd-links-bulk-cable" title="Сменить тип кабеля у выделенных">
          <option value="">— сменить кабель —</option>
          ${CABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}
        </select>
        <label style="display:inline-flex;align-items:center;gap:4px">
          Длина: <input type="number" min="0" step="0.1" id="sd-links-bulk-length" placeholder="м" style="width:70px">
          <button type="button" class="sd-btn-sel" id="sd-links-bulk-length-apply">Применить</button>
        </label>
        <button type="button" class="sd-btn-sel" id="sd-links-bulk-del" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5" title="Удалить выделенные связи">🗑 удалить ${selectedCount}</button>
        <button type="button" class="sd-btn-sel" id="sd-links-bulk-clear" title="Снять выделение">✕ снять</button>
      </div>`
    : '';
  // Excel-style фильтры — каждый ПРЯМО НАД соответствующим столбцом
  // (см. MEMORY: feedback_column_filters.md).
  const summaryRow = `<div class="muted" style="font-size:11px;margin:4px 0;display:flex;gap:8px;align-items:center">
      <span>${anyFilter ? `Показано ${links.length}/${allLinks.length}` : `Всего ${allLinks.length} связей`}</span>
      ${anyFilter ? '<button type="button" class="sd-btn-sel" id="sd-links-clear">× сброс фильтров</button>' : ''}
      ${anyFilter && links.length && selectedCount === 0 ? `<button type="button" class="sd-btn-sel" id="sd-links-bulk-del-filtered" style="background:#fef3c7;color:#854d0e;border-color:#fde68a" title="Удалить все ${links.length} связей под фильтром">🗑 удалить отфильтрованные (${links.length})</button>` : ''}
    </div>`;
  host.innerHTML = `
    ${summaryRow}
    ${bulkBar}
    <table class="sd-links-table">
      <thead>
        <tr class="sd-links-filter-row">
          <th><input type="checkbox" id="sd-links-sel-all" title="Выделить всё видимое" ${allVisibleSelected ? 'checked' : ''}></th>
          <th></th>
          <th><select id="sd-links-from" title="Фильтр по источнику (откуда)">${fromOpts}</select></th>
          <th><select id="sd-links-to" title="Фильтр по цели (куда)">${toOpts}</select></th>
          <th><select id="sd-links-ct" title="Тип кабеля">${cableOpts}</select></th>
          <th><label class="muted" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap"><input type="checkbox" id="sd-links-missing" ${missingOnly ? 'checked' : ''}> без длины</label></th>
          <th><input type="search" id="sd-links-q" placeholder="🔍 поиск" value="${escapeHtml(linksQuery || '')}" autocomplete="off" style="width:100%;min-width:120px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;font-size:11px"></th>
          <th></th>
        </tr>
        <tr>
          <th><input type="checkbox" disabled style="visibility:hidden"></th>
          <th>#</th>
          <th>Откуда (шкаф → устройство)</th>
          <th>Куда (шкаф → устройство)</th>
          <th>Кабель</th>
          <th>Длина, м</th>
          <th>Заметка</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${links.map((l, i) => {
          const fromMax = devicePorts(l.fromRackId, l.fromDevId);
          const toMax   = devicePorts(l.toRackId,   l.toDevId);
          const fromUsed = portsUsedOn(l.fromRackId, l.fromDevId, l.id);
          const toUsed   = portsUsedOn(l.toRackId,   l.toDevId,   l.id);
          const fromDup = l.fromPort && fromUsed.has(+l.fromPort);
          const toDup   = l.toPort   && toUsed.has(+l.toPort);
          const portInput = (who, max, dup, val) => max > 1
            ? `<input class="sd-port-in${dup ? ' sd-err' : ''}" data-act="${who}-port" type="number" min="1" max="${max}" value="${val == null ? '' : val}" placeholder="порт 1-${max}" style="width:78px;font-size:11px;margin-top:3px" title="Физический порт на устройстве (1…${max})${dup ? ' — конфликт: занят другой связью' : ''}">`
            : '';
          const isSelected = linksSelected.has(l.id);
          return `
          <tr data-id="${escapeAttr(l.id)}" class="${isSelected ? 'sd-row-selected' : ''}">
            <td><input type="checkbox" data-act="select-row" ${isSelected ? 'checked' : ''}></td>
            <td>${i + 1}</td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.fromRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.fromRackId, l.fromDevId))}${l.fromPort ? ` · <b>p${l.fromPort}</b>` : ''}</div>
              ${portInput('from', fromMax, fromDup, l.fromPort)}
            </td>
            <td>
              <div><b>${escapeHtml(getRackShortLabel(l.toRackId))}</b></div>
              <div class="muted">${escapeHtml(deviceLabel(l.toRackId, l.toDevId))}${l.toPort ? ` · <b>p${l.toPort}</b>` : ''}</div>
              ${portInput('to', toMax, toDup, l.toPort)}
            </td>
            <td>
              <select data-act="cable">${opts.replace(`value="${l.cableType}"`, `value="${l.cableType}" selected`)}</select>
              ${(() => {
                const c = linkCompat(l);
                if (c.ok) return '';
                return `<div class="sd-link-warn" style="margin-top:4px;font-size:11px;color:#b91c1c" title="${escapeAttr(c.reason)}">⚠ ${escapeHtml(c.reason)}</div>`;
              })()}
            </td>
            <td><input type="number" min="0" step="0.1" value="${l.lengthM == null ? '' : l.lengthM}" data-act="length" style="width:80px"></td>
            <td><input type="text" value="${escapeAttr(l.note || '')}" data-act="note" placeholder="—"></td>
            <td><button data-act="del" class="sd-btn-del" title="Удалить связь">✕</button></td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
    <div class="sd-links-footer muted">Показано: ${links.length} из ${allLinks.length}. Хранилище: <code>scs-design.links.v1</code>.</div>
  `;
  // v0.59.590: индетерминантное состояние «выбрать всё» — когда часть выбрана.
  const selAll = document.getElementById('sd-links-sel-all');
  if (selAll) selAll.indeterminate = someVisibleSelected;
  const qInput = document.getElementById('sd-links-q');
  if (qInput) qInput.addEventListener('input', e => {
    linksQuery = e.target.value;
    renderLinksList();
    const q2 = document.getElementById('sd-links-q');
    if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
  });
  document.getElementById('sd-links-ct')?.addEventListener('change', e => { linksCableFilter = e.target.value; renderLinksList(); });
  document.getElementById('sd-links-from')?.addEventListener('change', e => { linksFromRackFilter = e.target.value; renderLinksList(); });
  document.getElementById('sd-links-to')?.addEventListener('change', e => { linksToRackFilter = e.target.value; renderLinksList(); });
  document.getElementById('sd-links-missing')?.addEventListener('change', e => { linksMissingOnly = e.target.checked; renderLinksList(); });
  document.getElementById('sd-links-clear')?.addEventListener('click', () => {
    linksQuery = ''; linksCableFilter = ''; linksMissingOnly = false;
    linksFromRackFilter = ''; linksToRackFilter = '';
    renderLinksList();
  });
  // v0.59.590: per-row checkbox toggling.
  host.querySelectorAll('input[data-act="select-row"]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const tr = cb.closest('tr');
      const id = tr?.dataset.id;
      if (!id) return;
      if (cb.checked) linksSelected.add(id);
      else linksSelected.delete(id);
      renderLinksList();
      drawLinkOverlay(); // обновить подсветку SVG-линий
    });
  });
  // Клик по строке (вне input/button/select) тоже toggle-ит выделение.
  host.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      const t = e.target;
      if (!t) return;
      if (t.closest('input,button,select,textarea,a')) return;
      const id = tr.dataset.id;
      if (!id) return;
      if (linksSelected.has(id)) linksSelected.delete(id);
      else linksSelected.add(id);
      renderLinksList();
      drawLinkOverlay();
    });
  });
  // Select all / none для видимых.
  document.getElementById('sd-links-sel-all')?.addEventListener('change', e => {
    if (e.target.checked) visibleIds.forEach(id => linksSelected.add(id));
    else visibleIds.forEach(id => linksSelected.delete(id));
    renderLinksList();
    drawLinkOverlay();
  });
  // Bulk: смена кабеля у выделенных.
  document.getElementById('sd-links-bulk-cable')?.addEventListener('change', e => {
    const newCable = e.target.value;
    if (!newCable) return;
    const ids = new Set(linksSelected);
    setLinks(getLinks().map(l => ids.has(l.id) ? { ...l, cableType: newCable } : l));
    updateStatus(`✔ Тип кабеля «${newCable}» применён к ${ids.size} связям.`);
    renderLinksList();
    renderLegend();
    renderBom();
    drawLinkOverlay();
  });
  // Bulk: задать длину у выделенных.
  document.getElementById('sd-links-bulk-length-apply')?.addEventListener('click', () => {
    const inp = document.getElementById('sd-links-bulk-length');
    if (!inp) return;
    const v = inp.value;
    const lengthM = v === '' ? null : Math.max(0, +v);
    if (Number.isNaN(lengthM)) { updateStatus('⚠ Длина: некорректное значение.'); return; }
    const ids = new Set(linksSelected);
    setLinks(getLinks().map(l => ids.has(l.id) ? { ...l, lengthM } : l));
    updateStatus(`✔ Длина ${lengthM == null ? '— (очищена)' : lengthM + ' м'} применена к ${ids.size} связям.`);
    renderLinksList();
    renderBom();
  });
  // Bulk: удалить выделенные.
  document.getElementById('sd-links-bulk-del')?.addEventListener('click', () => {
    const n = linksSelected.size;
    if (!n) return;
    sdConfirmInline(`Удалить ${n} выделенных связей? Действие необратимо.`).then(ok => {
      if (!ok) return;
      const ids = new Set(linksSelected);
      setLinks(getLinks().filter(l => !ids.has(l.id)));
      linksSelected.clear();
      updateStatus(`✔ Удалено ${ids.size} связей.`);
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
      renderLinksList();
      renderLegend();
      renderBom();
      drawLinkOverlay();
    });
  });
  // Снять выделение.
  document.getElementById('sd-links-bulk-clear')?.addEventListener('click', () => {
    linksSelected.clear();
    renderLinksList();
    drawLinkOverlay();
  });
  // v0.59.588: удалить всё под фильтром (когда ничего не выделено).
  document.getElementById('sd-links-bulk-del-filtered')?.addEventListener('click', () => {
    sdConfirmInline(`Удалить ${links.length} связей, попадающих под текущий фильтр? Действие необратимо.`).then(ok => {
      if (!ok) return;
      const ids = new Set(links.map(l => l.id));
      setLinks(getLinks().filter(l => !ids.has(l.id)));
      updateStatus(`✔ Удалено ${ids.size} связей по фильтру.`);
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
      renderLinksList();
      renderLegend();
      renderBom();
      drawLinkOverlay();
    });
  });
  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="cable"]').addEventListener('change', e => { updateLink(id, { cableType: e.target.value }); drawLinkOverlay(); });
    tr.querySelector('[data-act="length"]').addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { lengthM: v === '' ? null : +v });
    });
    tr.querySelector('[data-act="note"]').addEventListener('change', e => updateLink(id, { note: e.target.value }));
    tr.querySelector('[data-act="from-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { fromPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="to-port"]')?.addEventListener('change', e => {
      const v = e.target.value; updateLink(id, { toPort: v === '' ? null : +v });
      renderLinksList();
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const cur = getLinks().filter(x => x.id !== id);
      setLinks(cur);
      renderLinksList();
      renderBom();
      renderLegend();
      // перерисовать подсветку linked в карточках
      const selected = new Set(loadJson(LS_SELECTION, []));
      renderSelected(selected, getRacks());
    });
  });
  renderBom();
}
/* ---------- BOM (cable journal) ---------- */
const BOM_RESERVE = 1.3; // коэфф. запаса длины

function renderBom() {
  const host = document.getElementById('sd-bom'); if (!host) return;
  const links = getVisibleLinks();
  if (!links.length) { host.innerHTML = `<div class="muted">Пока нет связей — BOM пуст.</div>`; return; }

  const byType = new Map();
  let totalLinesAll = 0, totalLenAll = 0, totalLenRawAll = 0, withoutLen = 0;
  for (const l of links) {
    totalLinesAll++;
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const row = byType.get(t);
    row.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) {
      row.lenRaw += +l.lengthM;
      totalLenRawAll += +l.lengthM;
    } else {
      row.withoutLen++;
      withoutLen++;
    }
  }
  const rows = [];
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  for (const [t, r] of byType.entries()) {
    const lenWithRes = r.lenRaw * BOM_RESERVE;
    totalLenAll += lenWithRes;
    rows.push(`<tr>
      <td>${escapeHtml(cableLabel(t))}</td>
      <td class="num">${r.lines}</td>
      <td class="num">${r.lenRaw ? r.lenRaw.toFixed(1) : '—'}</td>
      <td class="num">${r.lenRaw ? lenWithRes.toFixed(1) : '—'}</td>
      <td class="num">${r.withoutLen || ''}</td>
    </tr>`);
  }
  host.innerHTML = `
    <table class="sd-bom-table">
      <thead><tr>
        <th>Тип кабеля</th>
        <th class="num">Линий</th>
        <th class="num">Σ длин, м</th>
        <th class="num">С запасом ×${BOM_RESERVE}, м</th>
        <th class="num">Без длины</th>
      </tr></thead>
      <tbody>
        ${rows.join('')}
        <tr class="total">
          <td>Итого</td>
          <td class="num">${totalLinesAll}</td>
          <td class="num">${totalLenRawAll ? totalLenRawAll.toFixed(1) : '—'}</td>
          <td class="num">${totalLenAll ? totalLenAll.toFixed(1) : '—'}</td>
          <td class="num">${withoutLen || ''}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/* ---------- Tab «Стойки проекта» ---------- */
const KIND_ICON = {
  'switch':        { icon: '🔀', label: 'Свичи' },
  'patch-panel':   { icon: '🎛', label: 'Патч-панели' },
  'server':        { icon: '🖥', label: 'Серверы' },
  'storage':       { icon: '💾', label: 'СХД' },
  'kvm':           { icon: '⌨', label: 'KVM' },
  'monitor':       { icon: '📺', label: 'Мониторы' },
  'ups':           { icon: '🔋', label: 'ИБП-1U' },
  'cable-manager': { icon: '⇋',  label: 'Органайзеры' },
  'other':         { icon: '▫',  label: 'Другое' },
};

function rackStats(rack) {
  const u = +rack.u || 42;
  const devices = getContents(rack.id);
  let usedU = 0, powerW = 0;
  const byKind = {};
  for (const d of devices) {
    const t = catalogType(d.typeId);
    const h = +d.heightU || (t && +t.heightU) || 1;
    usedU += h;
    powerW += (+d.powerW) || (t && +t.powerW) || 0;
    const kind = (t && t.kind) || 'other';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  const links = getVisibleLinks().filter(l => l.fromRackId === rack.id || l.toRackId === rack.id);
  return { u, usedU, freeU: Math.max(0, u - usedU), powerW, devCount: devices.length, byKind, linkCount: links.length };
}

function renderRacksSummary() {
  const host = document.getElementById('sd-racks-summary');
  if (!host) return;
  // v0.59.281: сводка — только проектные стойки (inst-*). Глобальные шаблоны
  // корпусов здесь не показываем, это не «стойки в зале».
  const racks = getProjectInstances();

  // v0.59.348: баннер о виртуальных стойках «из схемы» (consumer/rack узлы
  // в Конструкторе схем).
  // v0.59.568: schemePid = parent если active=sub.
  const activePid = getActiveProjectId();
  const activeProj = activePid ? getProject(activePid) : null;
  const pid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
    ? activeProj.parentProjectId
    : activePid;
  // v0.59.544: + POR consumer-group виртуалы (дедуп по id).
  const _schVs = (() => { try { return loadSchemeVirtualRacks(pid) || []; } catch { return []; } })();
  const _porGVs = (() => { try { return loadPorGroupVirtualRacks(pid) || []; } catch { return []; } })();
  const _seenVids = new Set(_schVs.map(v => v.id));
  const virtuals = [..._schVs, ..._porGVs.filter(v => !_seenVids.has(v.id))];
  // Считаем нескрытые: тег ещё не занят реальной стойкой
  const tags = loadJson(LS_RACKTAGS, {});
  const usedTags = new Set(Object.values(tags).map(t => (t || '').trim()).filter(Boolean));
  const unmaterialized = virtuals.filter(v => !usedTags.has(v.autoTag));
  const schemeBanner = unmaterialized.length
    ? `<div style="margin-bottom:10px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:13px;color:#1e3a8a">
        🔗 В Конструкторе схем размещено <b>${unmaterialized.length}</b> ${unmaterialized.length === 1 ? 'виртуальная стойка' : (unmaterialized.length < 5 ? 'виртуальные стойки' : 'виртуальных стоек')} — они пока не участвуют в плане зала и связях. <a href="../scs-config/?from=scs-design" style="color:#1d4ed8;font-weight:600">Материализовать → Компоновщик шкафа</a>
      </div>`
    : '';

  if (!racks.length) {
    host.innerHTML = schemeBanner + `<div class="sd-empty-state">
      В проекте ещё нет шкафов. Создайте их в
      <a href="../rack-config/">Конфигураторе шкафа — корпус</a> (шаблоны)
      и наполните в <a href="../scs-config/?from=scs-design">Компоновщике шкафа</a>.
      ${unmaterialized.length ? '<br>Либо материализуйте виртуальные стойки из схемы (см. баннер выше).' : ''}
    </div>`;
    return;
  }
  const kinds = Object.keys(KIND_ICON);
  const selected = new Set(loadJson(LS_SELECTION, []));

  // Сначала стойки с тегом (реальные), затем без тега (черновики/шаблоны)
  const sorted = racks.slice().sort((a, b) => {
    const ta = (getRackTag(a.id) || '').trim();
    const tb = (getRackTag(b.id) || '').trim();
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return ta.localeCompare(tb) || (a.name || '').localeCompare(b.name || '');
  });
  const rows = sorted.map(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    const fillPct = Math.round((s.usedU / s.u) * 100);
    const fillCls = fillPct >= 90 ? ' over' : fillPct >= 70 ? ' hi' : '';
    const breakdown = kinds
      .filter(k => s.byKind[k])
      .map(k => `<span class="sd-kind-chip" title="${escapeAttr(KIND_ICON[k].label)}">${KIND_ICON[k].icon} ${s.byKind[k]}</span>`)
      .join('') || '<span class="muted">—</span>';
    const isSel = selected.has(r.id);
    const draft = !tag.trim();
    return `<tr data-id="${escapeAttr(r.id)}"${draft ? ' class="draft"' : ''} title="${draft ? 'Без тега — черновик/шаблон, не реальная стойка' : ''}">
      <td>${draft ? '<span class="sd-draft-badge" title="Нет тега">📐 черновик</span>' : `<code>${escapeHtml(tag)}</code>`}</td>
      <td>${escapeHtml(r.name || 'Без имени')}</td>
      <td class="num">${s.usedU}/${s.u}
        <div class="sd-bar"><div class="sd-bar-fill${fillCls}" style="width:${Math.min(100, fillPct)}%"></div></div>
      </td>
      <td class="num">${s.powerW ? (s.powerW / 1000).toFixed(2) + ' кВт' : '—'}</td>
      <td class="num">${s.devCount}</td>
      <td class="kinds">${breakdown}</td>
      <td class="num">${s.linkCount || '<span class="muted">—</span>'}</td>
      <td>
        <button type="button" class="sd-btn-sel ${isSel ? 'on' : ''}" data-act="toggle-sel">${isSel ? '✓ выбрана' : '+ в мастер'}</button>
        <a href="../scs-config/rack.html?rackId=${encodeURIComponent(r.id)}&from=scs-design" class="sd-btn-sel" style="text-decoration:none;margin-left:4px">открыть</a>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = schemeBanner + `<table class="sd-racks-table">
    <thead><tr>
      <th>Тег</th><th>Имя</th><th class="num">U</th><th class="num">Мощность</th>
      <th class="num">Устр.</th><th>Разбивка</th><th class="num">Связей</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  host.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="toggle-sel"]')?.addEventListener('click', () => {
      const sel = new Set(loadJson(LS_SELECTION, []));
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      saveJson(LS_SELECTION, Array.from(sel));
      renderRacksSummary();
      renderLinksTab(); // обновить чипы в мастере
    });
  });
}

function exportRacksCsv() {
  const racks = getProjectInstances();
  const rows = [['Тег', 'Имя', 'U занято', 'U всего', 'U свободно', 'Мощность, кВт', 'Устройств', 'Свичи', 'Патч-панели', 'Серверы', 'ИБП-1U', 'Органайзеры', 'Другое', 'Связей']];
  racks.forEach(r => {
    const s = rackStats(r);
    const tag = getRackTag(r.id);
    rows.push([
      tag, r.name || '', s.usedU, s.u, s.freeU,
      s.powerW ? (s.powerW / 1000).toFixed(2) : '',
      s.devCount,
      s.byKind['switch'] || 0, s.byKind['patch-panel'] || 0, s.byKind['server'] || 0,
      s.byKind['ups'] || 0, s.byKind['cable-manager'] || 0, s.byKind['other'] || 0,
      s.linkCount,
    ]);
  });
  downloadCsv('scs-racks-' + dateStamp() + '.csv', rows);
}

/* ---------- Tab «План зала» ---------- */
const PLAN_DEFAULT = { step: 0.6, kRoute: 1.3, positions: {}, zoom: 1, trays: [] };
// v0.59.589: толщина канала рендерится в НАТУРАЛЬНОМ масштабе по widthMm
// (запрос юзера: «ширину канала сделай как он есть в натуральную величину,
// учитывая масштаб»). До этого все каналы были TRAY_W_CELLS=1 клетка = 600мм
// при step=0.6, что закрывало всю ширину прохода. Минимальная отрисовка
// 4px чтобы канал оставался кликабельным.
const TRAY_W_CELLS = 1; // legacy default — fallback если widthMm отсутствует
function trayWidthCells(t, plan) {
  const w = (t && +t.widthMm) || 100;
  const step = (plan && +plan.step) || 0.6;
  // ширина в клетках = widthMm / 1000 / step. Минимум 4px эквивалент.
  const minCells = 4 / PLAN_CELL_PX;
  return Math.max(minCells, w / 1000 / step);
}
function trayWidthPx(t, plan) {
  return trayWidthCells(t, plan) * PLAN_CELL_PX;
}
// v0.59.591: габариты плана не зависят от шага сетки (запрос юзера: «шаг
// сетки не должен менять габариты плана, только размер сетки»). Решение:
//   PIXELS_PER_METER — константа конвертации физического метра в пиксели.
//   PLAN_CELL_PX = step × PIXELS_PER_METER — мутирует при смене step.
//   PLAN_COLS / PLAN_ROWS — мутируют так, чтобы canvas px размер оставался
//   константным (CANVAS_AREA_M_W × PIXELS_PER_METER).
//   Позиции (pos.x, pos.y, tray.x/y/len) хранятся в КЛЕТКАХ; при смене
//   step все позиции пересчитываются на factor=oldStep/newStep, чтобы
//   физическое (в метрах) положение объектов сохранилось.
const PIXELS_PER_METER = 40;
const CANVAS_AREA_M_W = 24;   // 24 метра ширины плана = 960 px
const CANVAS_AREA_M_H = 14.4; // 14.4 метра высоты плана = 576 px
let PLAN_CELL_PX = 24;        // обновляется в updatePlanGrid()
let PLAN_COLS = 40, PLAN_ROWS = 24;
// v0.59.591: пересчитать grid-параметры под текущий plan.step. Вызывается
// в начале renderPlan() и в step-change handler.
function updatePlanGrid(plan) {
  const step = (plan && +plan.step) || 0.6;
  PLAN_CELL_PX = Math.max(2, PIXELS_PER_METER * step);
  PLAN_COLS = Math.max(8, Math.ceil(CANVAS_AREA_M_W / step));
  PLAN_ROWS = Math.max(6, Math.ceil(CANVAS_AREA_M_H / step));
}
const PLAN_ZOOM_MIN = 0.25, PLAN_ZOOM_MAX = 4;
let planZoom = 1;
let selectedTrayId = null;
const RACK_W_CELLS = 2; // legacy фолбэк, если нет физических размеров
const RACK_H_CELLS = 1;

// v0.59.303: извлечение физических размеров стойки (widthMm × depthMm).
// Источники в порядке приоритета: r.widthMm/r.depthMm → парсинг r.name
// (шаблон «600x1200x42U» или «800×1000»). Фолбэк 600×1000.
function getRackDimsMm(r) {
  // v0.59.321: rack-config хранит ширину/глубину в полях r.width / r.depth
  // (целые мм, например 600/1000). Поля widthMm/depthMm — fallback на случай
  // старых инстансов / импорта. Парсинг name — последний резерв.
  let w = +r?.width || +r?.widthMm || 0;
  let d = +r?.depth || +r?.depthMm || 0;
  if ((!w || !d) && r?.name) {
    const m = String(r.name).match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
    if (m) { w = w || +m[1]; d = d || +m[2]; }
  }
  return { widthMm: w || 600, depthMm: d || 1000 };
}

// Размер стойки в клетках плана с учётом поворота (0/90/180/270°).
// v0.59.313: возвращает ТОЧНЫЕ размеры стойки в клетках (float), без округления.
// Раньше делалось Math.round → стойка 800 мм при шаге 600 мм становилась 1
// клеткой (600 мм физически), после чего соседняя стойка вплотную оказывалась в
// 400 мм, а не 0 мм. Теперь wC/hC — float, рендер и коллизии — физически точные,
// а snap-к-узлу-сетки выполняется отдельно при drop/drag.
function rackSizeCells(r, plan, rot) {
  const { widthMm, depthMm } = getRackDimsMm(r);
  const step = (plan && +plan.step) || 0.6;
  let wC = Math.max(0.1, widthMm / 1000 / step);
  let hC = Math.max(0.1, depthMm / 1000 / step);
  if (rot === 90 || rot === 270) { const t = wC; wC = hC; hC = t; }
  return [wC, hC];
}

// v0.59.313: snap-позиции стойки.
// Порядок: (1) grid-snap к ближайшему целому узлу сетки; (2) если стена стойки
// в пределах толерантности от стены соседней стойки — пристыковываем стена-к-
// стене (соседний угол важнее узла сетки, т.к. 800 мм стойка ≠ целому числу
// клеток при шаге 600 мм). Возвращает [x, y] в клетках (float).
function snapRackPos(rawX, rawY, wF, hF, selfId, plan, racks) {
  const TOL = 0.5; // толерантность snap-к-соседу, в клетках
  let sx = Math.round(rawX);
  let sy = Math.round(rawY);
  for (const [oid, op] of Object.entries(plan.positions || {})) {
    if (oid === selfId) continue;
    const or = racks.find(rr => rr.id === oid);
    if (!or) continue;
    const orot = ((+op.rot) || 0) % 360;
    const [owF, ohF] = rackSizeCells(or, plan, orot);
    const oL = +op.x, oR = +op.x + owF;
    const oT = +op.y, oB = +op.y + ohF;
    // Горизонтальный snap: нужно пересечение по y
    const curT = rawY, curB = rawY + hF;
    const yOverlap = !(curB <= oT - 0.001 || curT >= oB + 0.001);
    if (yOverlap) {
      if (Math.abs(rawX - oR) < TOL) sx = oR;            // левая стена → правый край соседа
      else if (Math.abs((rawX + wF) - oL) < TOL) sx = oL - wF; // правая → левый край соседа
    }
    const curL = rawX, curR = rawX + wF;
    const xOverlap = !(curR <= oL - 0.001 || curL >= oR + 0.001);
    if (xOverlap) {
      if (Math.abs(rawY - oB) < TOL) sy = oB;
      else if (Math.abs((rawY + hF) - oT) < TOL) sy = oT - hF;
    }
  }
  sx = Math.max(0, Math.min(PLAN_COLS - wF, sx));
  sy = Math.max(0, Math.min(PLAN_ROWS - hF, sy));
  return [sx, sy];
}

function rackRot(plan, rackId) {
  const p = plan?.positions?.[rackId];
  return ((p && +p.rot) || 0) % 360;
}

// Центр стойки (в пикселях плана) с учётом её размеров и поворота.
function rackCenterPx(rackId, plan) {
  const pos = plan?.positions?.[rackId];
  if (!pos) return null;
  const r = getRacks().find(x => x.id === rackId);
  if (!r) return [(pos.x + RACK_W_CELLS/2) * PLAN_CELL_PX, (pos.y + RACK_H_CELLS/2) * PLAN_CELL_PX];
  const [wC, hC] = rackSizeCells(r, plan, pos.rot || 0);
  return [(pos.x + wC/2) * PLAN_CELL_PX, (pos.y + hC/2) * PLAN_CELL_PX];
}

function getPlan() {
  const p = loadJson(LS_PLAN, PLAN_DEFAULT);
  const out = {
    step: +p?.step || PLAN_DEFAULT.step,
    kRoute: +p?.kRoute || PLAN_DEFAULT.kRoute,
    positions: (p && p.positions && typeof p.positions === 'object') ? (() => {
      // v0.59.303: нормализация positions — поддержка поля rot (0/90/180/270).
      const out = {};
      for (const [id, pos] of Object.entries(p.positions)) {
        if (!pos || typeof pos !== 'object') continue;
        let rot = +pos.rot || 0;
        rot = ((rot % 360) + 360) % 360;
        if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) rot = 0;
        out[id] = { x: +pos.x || 0, y: +pos.y || 0, rot };
      }
      return out;
    })() : {},
    zoom: (p && +p.zoom > 0) ? Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, +p.zoom)) : 1,
    trays: Array.isArray(p?.trays) ? p.trays.map(t => ({
      id: String(t.id || ('tr-' + Math.random().toString(36).slice(2, 8))),
      x: Math.max(0, Math.min(PLAN_COLS - 1, +t.x || 0)),
      y: Math.max(0, Math.min(PLAN_ROWS - 1, +t.y || 0)),
      len: Math.max(2, Math.min(Math.max(PLAN_COLS, PLAN_ROWS), +t.len || 6)),
      orient: t.orient === 'v' ? 'v' : 'h',
      // Размеры поперечного сечения канала (мм). Дефолт — 100×50.
      widthMm: +t.widthMm > 0 ? +t.widthMm : 100,
      depthMm: +t.depthMm > 0 ? +t.depthMm : 50,
      // Макс. допустимое заполнение (%), 40 по умолчанию (IEC/РЭ).
      fillLimitPct: +t.fillLimitPct > 0 ? +t.fillLimitPct : 40,
    })) : [],
  };
  planZoom = out.zoom;
  return out;
}
// v0.59.319: undo/redo для plan. Перед каждым savePlan пушим текущее
// состояние в undoStack, redoStack сбрасывается (new branch). Стек ограничен
// 30 снапшотами. В memory, без persistence — переживает только сессию.
const UNDO_LIMIT = 30;
const undoStack = [];
const redoStack = [];
function savePlan(p) {
  try {
    const prev = loadJson(LS_PLAN, PLAN_DEFAULT);
    undoStack.push(JSON.stringify(prev));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  } catch (_) { /* не блокируем запись из-за ошибки undo */ }
  saveJson(LS_PLAN, p);
}
function undoPlan() {
  if (!undoStack.length) { updateStatus('⚠ Нет действий для отмены.'); return; }
  const cur = loadJson(LS_PLAN, PLAN_DEFAULT);
  redoStack.push(JSON.stringify(cur));
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  const prevJson = undoStack.pop();
  saveJson(LS_PLAN, JSON.parse(prevJson));
  planZoom = (+JSON.parse(prevJson).zoom) || 1;
  renderPlan();
  updateStatus(`↶ Отменено. В стеке осталось: ${undoStack.length}.`);
}
function redoPlan() {
  if (!redoStack.length) { updateStatus('⚠ Нет действий для повтора.'); return; }
  const cur = loadJson(LS_PLAN, PLAN_DEFAULT);
  undoStack.push(JSON.stringify(cur));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  const nextJson = redoStack.pop();
  saveJson(LS_PLAN, JSON.parse(nextJson));
  planZoom = (+JSON.parse(nextJson).zoom) || 1;
  renderPlan();
  updateStatus(`↷ Повторено. В redo-стеке осталось: ${redoStack.length}.`);
}
function applyPlanZoomStyle() {
  const canvas = document.getElementById('sd-plan-canvas');
  if (!canvas) return;
  // Используем CSS `zoom` вместо `transform: scale`, чтобы scrollbars во wrap
  // корректно расширялись по размеру отмасштабированного канваса.
  canvas.style.zoom = String(planZoom);
  // v0.59.590: counter-scale для подписей — текст не «увеличивается» при
  // zoom in/out (юзер: «без увеличения подписей»). Подписи остаются
  // постоянного размера в пикселях экрана независимо от zoom уровня —
  // как в нормальных CAD-инструментах.
  const inv = planZoom > 0 ? (1 / planZoom) : 1;
  canvas.style.setProperty('--plan-zoom-inv', String(inv));
  const val = document.getElementById('sd-plan-zoom-val');
  if (val) val.textContent = Math.round(planZoom * 100) + '%';
}
function setPlanZoom(z, anchor) {
  const clamp = Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, z));
  const wrap = document.querySelector('.sd-plan-wrap');
  let anchorX, anchorY, prevSL, prevST;
  if (wrap && anchor) {
    prevSL = wrap.scrollLeft; prevST = wrap.scrollTop;
    const rect = wrap.getBoundingClientRect();
    anchorX = anchor.clientX - rect.left + prevSL;
    anchorY = anchor.clientY - rect.top + prevST;
  }
  const prev = planZoom;
  planZoom = clamp;
  const plan = getPlan();
  plan.zoom = clamp;
  savePlan(plan);
  applyPlanZoomStyle();
  renderPlanScaleBar(plan); // v0.59.315: синхронизация scale-bar при изменении zoom
  if (wrap && anchor && prev > 0) {
    const k = clamp / prev;
    wrap.scrollLeft = anchorX * k - (anchor.clientX - wrap.getBoundingClientRect().left);
    wrap.scrollTop  = anchorY * k - (anchor.clientY - wrap.getBoundingClientRect().top);
  }
}
function fitPlanZoom() {
  const wrap = document.querySelector('.sd-plan-wrap');
  if (!wrap) return;
  const pad = 16;
  const zx = (wrap.clientWidth  - pad) / (PLAN_COLS * PLAN_CELL_PX);
  const zy = (wrap.clientHeight - pad) / (PLAN_ROWS * PLAN_CELL_PX);
  setPlanZoom(Math.min(zx, zy));
}

// v0.59.317: Fit to content — зум и скролл до bbox размещённых стоек + каналов.
// Если на плане пусто — fallback к fitPlanZoom (весь план).
function fitPlanToContent() {
  const wrap = document.querySelector('.sd-plan-wrap');
  if (!wrap) return;
  const plan = getPlan();
  const racks = getRacks();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [rid, pos] of Object.entries(plan.positions || {})) {
    const r = racks.find(x => x.id === rid); if (!r) continue;
    const [wF, hF] = rackSizeCells(r, plan, ((+pos.rot) || 0) % 360);
    minX = Math.min(minX, +pos.x);
    minY = Math.min(minY, +pos.y);
    maxX = Math.max(maxX, +pos.x + wF);
    maxY = Math.max(maxY, +pos.y + hF);
  }
  (plan.trays || []).forEach(t => {
    const w = t.orient === 'h' ? t.len : 1;
    const h = t.orient === 'v' ? t.len : 1;
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + w);
    maxY = Math.max(maxY, t.y + h);
  });
  if (!isFinite(minX) || !isFinite(minY)) { fitPlanZoom(); return; }
  const pad = 1; // клеток отступ вокруг
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(PLAN_COLS, maxX + pad);
  maxY = Math.min(PLAN_ROWS, maxY + pad);
  const bw = (maxX - minX) * PLAN_CELL_PX;
  const bh = (maxY - minY) * PLAN_CELL_PX;
  const padPx = 24;
  const zx = (wrap.clientWidth  - padPx * 2) / bw;
  const zy = (wrap.clientHeight - padPx * 2) / bh;
  const z = Math.min(zx, zy, PLAN_ZOOM_MAX);
  setPlanZoom(Math.max(PLAN_ZOOM_MIN, z));
  // скролл к левому-верхнему углу bbox
  const rectW = wrap.clientWidth, rectH = wrap.clientHeight;
  const cx = (minX + maxX) / 2 * PLAN_CELL_PX * z;
  const cy = (minY + maxY) / 2 * PLAN_CELL_PX * z;
  wrap.scrollLeft = Math.max(0, cx - rectW / 2);
  wrap.scrollTop  = Math.max(0, cy - rectH / 2);
}

function manhattanCells(a, b) {
  // центр прямоугольника стойки
  const ax = a.x + RACK_W_CELLS / 2, ay = a.y + RACK_H_CELLS / 2;
  const bx = b.x + RACK_W_CELLS / 2, by = b.y + RACK_H_CELLS / 2;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function renderPlan() {
  const canvas = document.getElementById('sd-plan-canvas');
  const palette = document.getElementById('sd-plan-palette');
  const info = document.getElementById('sd-plan-info');
  const stepIn = document.getElementById('sd-plan-step');
  const krIn = document.getElementById('sd-plan-kroute');
  if (!canvas || !palette) return;

  const plan = getPlan();
  // v0.59.591: пересчёт PLAN_CELL_PX / PLAN_COLS / PLAN_ROWS под текущий step.
  updatePlanGrid(plan);
  if (stepIn) stepIn.value = plan.step;
  if (krIn) krIn.value = plan.kRoute;

  // v0.59.281: на план-зал размещаем только экземпляры текущего проекта.
  // Глобальные шаблоны (tpl-*) — это дизайны корпусов, не реальные шкафы.
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  const unplaced = racks.filter(r => !plan.positions[r.id]);

  // v0.59.354: виртуальные стойки из схемы (consumer/rack узлы), которые
  // ещё не материализованы в scs-config. Показываем их в палитре отдельным
  // блоком — при drop материализуются inline (создаётся real-instance).
  // v0.59.544: + POR consumer-group rack-members (анонимные слоты ×N).
  // v0.59.568: schemePid = parent если active=sub.
  const activePid = getActiveProjectId();
  const activeProj = activePid ? getProject(activePid) : null;
  const pid = (activeProj && activeProj.kind === 'sketch' && activeProj.parentProjectId)
    ? activeProj.parentProjectId
    : activePid;
  const schemeVs = loadSchemeVirtualRacks(pid);
  const porGroupVs = loadPorGroupVirtualRacks(pid);
  const seenIds = new Set(schemeVs.map(v => v.id));
  const allVirtuals = [...schemeVs, ...porGroupVs.filter(v => !seenIds.has(v.id))];
  const usedTags = new Set();
  racks.forEach(r => {
    const t = (getRackTag(r.id) || '').trim().toLowerCase();
    if (t) usedTags.add(t);
  });
  const virtualsOnly = allVirtuals.filter(v => !usedTags.has((v.autoTag || '').trim().toLowerCase()));

  // Палитра
  const realChips = unplaced.map(r => `<span class="sd-plan-chip" draggable="true" data-id="${escapeAttr(r.id)}">${escapeHtml(getRackShortLabel(r.id))}</span>`).join('');
  const virtChips = virtualsOnly.map(v => {
    const icon = v.fromPorGroup ? '⊞' : '📐';
    const src  = v.fromPorGroup ? 'из группы' : 'из схемы';
    const titleSrc = v.fromPorGroup
      ? `POR-группа ${v.porGroupId}, slot ${v.porGroupSlot}/${v.schemeTotal}`
      : `узел ${v.schemeNodeId}, ${v.schemeIndex}/${v.schemeTotal}`;
    return `<span class="sd-plan-chip sd-plan-chip-virt" draggable="true" data-virt-id="${escapeAttr(v.id)}" data-virt-tag="${escapeAttr(v.autoTag)}" title="Виртуальная стойка (${escapeAttr(titleSrc)}). При drop будет материализована.">${icon} ${escapeHtml(v.autoTag)} <small>· ${src}</small></span>`;
  }).join('');
  if (!realChips && !virtChips) {
    palette.innerHTML = '<span class="muted">Все стойки размещены на плане.</span>';
  } else {
    palette.innerHTML = realChips + (realChips && virtChips ? '<span class="muted" style="margin:0 6px">·</span>' : '') + virtChips;
  }

  palette.querySelectorAll('.sd-plan-chip').forEach(el => {
    el.addEventListener('dragstart', e => {
      // v0.59.354: virtual-chip несёт virt-id + tag, real-chip — просто id
      if (el.classList.contains('sd-plan-chip-virt')) {
        e.dataTransfer.setData('text/sd-rack-virt', el.dataset.virtId + '|' + el.dataset.virtTag);
      } else {
        e.dataTransfer.setData('text/sd-rack', el.dataset.id);
      }
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // Canvas
  canvas.style.width = (PLAN_COLS * PLAN_CELL_PX) + 'px';
  canvas.style.height = (PLAN_ROWS * PLAN_CELL_PX) + 'px';
  canvas.style.backgroundSize = `${PLAN_CELL_PX}px ${PLAN_CELL_PX}px`;
  canvas.innerHTML = '';

  // SVG слой для линий связей
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('sd-plan-svg');
  svg.setAttribute('width', PLAN_COLS * PLAN_CELL_PX);
  svg.setAttribute('height', PLAN_ROWS * PLAN_CELL_PX);
  canvas.appendChild(svg);

  // Кабельные каналы (trays) — рисуем ДО стоек, чтобы стойки были сверху
  (plan.trays || []).forEach(t => renderTray(canvas, svg, t, plan));

  // Размещённые стойки
  placed.forEach(r => {
    const pos = plan.positions[r.id];
    const s = rackStats(r);
    const pct = s.u ? Math.round((s.usedU / s.u) * 100) : 0;
    let cls = '';
    if (pct >= 100) cls = ' over';
    else if (pct >= 90) cls = ' hi';
    else if (pct >= 70) cls = ' mid';
    else if (pct > 0) cls = ' low';
    else cls = ' empty';
    const tag = getRackTag(r.id);
    const isDraft = !tag.trim();
    const div = document.createElement('div');
    div.className = 'sd-plan-rack' + cls + (isDraft ? ' draft' : '');
    div.dataset.id = r.id;
    const rot = rackRot(plan, r.id);
    const [wC, hC] = rackSizeCells(r, plan, rot);
    const dims = getRackDimsMm(r);
    div.style.left = (pos.x * PLAN_CELL_PX) + 'px';
    div.style.top = (pos.y * PLAN_CELL_PX) + 'px';
    div.style.width = (wC * PLAN_CELL_PX) + 'px';
    div.style.height = (hC * PLAN_CELL_PX) + 'px';
    if (rot === 90 || rot === 270) div.classList.add('rot-tall');
    div.classList.add('rot-' + rot); // v0.59.314: индикатор передней стены
    // подробный тултип: + исходящие связи и метраж от этой стойки
    const rackLinks = getVisibleLinks().filter(l => l.fromRackId === r.id || l.toRackId === r.id);
    let fromM = 0;
    rackLinks.forEach(l => {
      const len = (l.lengthM != null) ? l.lengthM : computeSuggestedLength(l, plan);
      if (len != null) fromM += len * 1.3;
    });
    const byType = new Map();
    rackLinks.forEach(l => { byType.set(l.cableType || '—', (byType.get(l.cableType || '—') || 0) + 1); });
    const typesStr = Array.from(byType.entries()).map(([k, v]) => `${k}×${v}`).join(', ');
    div.title = `${tag || r.name || r.id}${isDraft ? ' [черновик]' : ''}
U: ${s.usedU}/${s.u} (${pct}%) · Устр.: ${s.devCount}
Связей: ${rackLinks.length}${typesStr ? ' (' + typesStr + ')' : ''}
Кабеля от стойки: ~${Math.round(fromM)} м (с запасом 1.3)`;
    div.innerHTML = `<span class="sd-plan-rack-label">${escapeHtml(tag || r.name || r.id)} <small class="sd-plan-rack-dim">${dims.widthMm}×${dims.depthMm}${rot?` · ${rot}°`:''}</small></span>
      <button type="button" class="sd-plan-rack-rot" title="Повернуть на 90°">⟳</button>
      <button type="button" class="sd-plan-rm" title="Убрать со схемы">✕</button>`;
    canvas.appendChild(div);

    // drag для перемещения
    let dragging = false, startX = 0, startY = 0, startCell = null;
    div.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('sd-plan-rm')) return;
      if (e.target.classList.contains('sd-plan-rack-rot')) return;
      dragging = true;
      div.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      startCell = { x: pos.x, y: pos.y };
      div.classList.add('dragging');
    });
    div.addEventListener('pointermove', e => {
      if (!dragging) return;
      const z = planZoom || 1;
      // v0.59.313: raw-позиция в float-клетках + snap (grid + neighbor-edge)
      const rawX = startCell.x + (e.clientX - startX) / (PLAN_CELL_PX * z);
      const rawY = startCell.y + (e.clientY - startY) / (PLAN_CELL_PX * z);
      const [nx, ny] = snapRackPos(rawX, rawY, wC, hC, r.id, plan, getRacks());
      div.style.left = (nx * PLAN_CELL_PX) + 'px';
      div.style.top = (ny * PLAN_CELL_PX) + 'px';
      pos.x = nx; pos.y = ny;
      drawPlanLinks(svg, plan);
    });
    div.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      div.classList.remove('dragging');
      const p2 = getPlan();
      // v0.59.322: сохраняем rot — раньше drag сбрасывал поворот в 0.
      const prev = p2.positions[r.id] || {};
      p2.positions[r.id] = { x: pos.x, y: pos.y, rot: (+prev.rot) || 0 };
      savePlan(p2);
      updatePlanInfo();
    });
    div.querySelector('.sd-plan-rm').addEventListener('click', (e) => {
      e.stopPropagation();
      const p2 = getPlan();
      delete p2.positions[r.id];
      savePlan(p2);
      if (focusRackId === r.id) focusRackId = null;
      renderPlan();
    });
    // v0.59.303: поворот стойки на 90°
    div.querySelector('.sd-plan-rack-rot').addEventListener('click', (e) => {
      e.stopPropagation();
      const p2 = getPlan();
      const cur = p2.positions[r.id] || { x: pos.x, y: pos.y, rot: 0 };
      const nextRot = (cur.rot + 90) % 360;
      // после поворота пересчитаем размеры, проверим границы
      const [nwC, nhC] = rackSizeCells(r, p2, nextRot);
      cur.rot = nextRot;
      cur.x = Math.max(0, Math.min(PLAN_COLS - nwC, cur.x));
      cur.y = Math.max(0, Math.min(PLAN_ROWS - nhC, cur.y));
      p2.positions[r.id] = cur;
      savePlan(p2);
      renderPlan();
    });
    // click (без drag) = фокус на трассы этой стойки
    let downAt = 0, downPt = null;
    div.addEventListener('pointerdown', e => { downAt = Date.now(); downPt = { x: e.clientX, y: e.clientY }; });
    div.addEventListener('click', e => {
      if (e.target.classList.contains('sd-plan-rm')) return;
      const dx = Math.abs(e.clientX - (downPt?.x || 0));
      const dy = Math.abs(e.clientY - (downPt?.y || 0));
      const dt = Date.now() - downAt;
      if (dx > 3 || dy > 3 || dt > 400) return; // это был drag, не клик
      focusRackId = (focusRackId === r.id) ? null : r.id;
      document.querySelectorAll('.sd-plan-rack').forEach(el => {
        el.classList.toggle('focused', el.dataset.id === focusRackId);
        el.classList.toggle('dimmed', focusRackId && el.dataset.id !== focusRackId);
      });
      drawPlanLinks(svg, getPlan());
      // v0.59.361: если работаем внутри embed-iframe — оповестить родителя
      // (Конструктор схем) о клике по стойке. Родитель выберет соответствующий
      // rack-узел в схеме (если стойка матерализована из узла со schemeNodeId).
      try {
        if (window.parent && window.parent !== window && r.schemeNodeId) {
          window.parent.postMessage({
            type: 'rs-plan-rack-clicked',
            schemeNodeId: r.schemeNodeId,
            rackId: r.id,
          }, '*');
        }
      } catch {}
    });
    if (focusRackId === r.id) div.classList.add('focused');
    else if (focusRackId) div.classList.add('dimmed');
  });

  // Drop target
  canvas.addEventListener('dragover', e => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('text/sd-rack') || types.includes('text/sd-rack-virt')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  canvas.addEventListener('drop', e => {
    let id = e.dataTransfer.getData('text/sd-rack');
    // v0.59.354: drop виртуальной стойки — материализуем inline и переходим к
    // обычному размещению с уже-настоящим id.
    if (!id) {
      const virtPayload = e.dataTransfer.getData('text/sd-rack-virt');
      if (virtPayload) {
        const sep = virtPayload.indexOf('|');
        const virtId = sep >= 0 ? virtPayload.slice(0, sep) : virtPayload;
        const tag = sep >= 0 ? virtPayload.slice(sep + 1) : '';
        id = _materializeVirtualForPlan(virtId, tag);
        if (!id) { e.preventDefault(); return; }
      }
    }
    if (!id) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // CSS `zoom` увеличивает rect в N раз, компенсируем делением на planZoom.
    const z = planZoom || 1;
    // v0.59.313: drop с реальными размерами, grid+neighbor snap и avoid-overlap
    const p2 = getPlan();
    const racksNow = getRacks();
    const dropped = racksNow.find(r => r.id === id);
    const rot = rackRot(p2, id);
    const [wC, hC] = dropped ? rackSizeCells(dropped, p2, rot) : [2, 1];
    // raw float-позиция (курсор = угол), снап сначала к сетке, затем к соседу.
    const rawX = (e.clientX - rect.left) / (PLAN_CELL_PX * z);
    const rawY = (e.clientY - rect.top) / (PLAN_CELL_PX * z);
    let [x, y] = snapRackPos(rawX, rawY, wC, hC, id, p2, racksNow);
    // Проверка коллизий — если накрыли соседа, ищем свободную клетку по спирали.
    const collides = (cx, cy) => {
      for (const [otherId, op] of Object.entries(p2.positions || {})) {
        if (otherId === id) continue;
        const or = racksNow.find(r => r.id === otherId);
        if (!or) continue;
        const orot = ((+op.rot) || 0) % 360;
        const [owC, ohC] = rackSizeCells(or, p2, orot);
        const EPS = 0.01;
        if (cx + EPS < (+op.x) + owC && cx + wC - EPS > (+op.x) &&
            cy + EPS < (+op.y) + ohC && cy + hC - EPS > (+op.y)) return true;
      }
      return false;
    };
    if (collides(x, y)) {
      outer: for (let radius = 1; radius <= Math.max(PLAN_COLS, PLAN_ROWS); radius++) {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dy) !== radius && Math.abs(dx) !== radius) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx + wC > PLAN_COLS || ny + hC > PLAN_ROWS) continue;
          if (!collides(nx, ny)) { x = nx; y = ny; break outer; }
        }
      }
    }
    p2.positions[id] = { x, y, rot };
    savePlan(p2);
    renderPlan();
  });

  drawPlanLinks(svg, plan);
  updatePlanInfo();
  applyPlanZoomStyle();
  renderPlanScaleBar(plan);
}

// v0.59.315: Scale bar — небольшой индикатор масштаба в правом-нижнем углу
// plan-wrap: чёрная полоса 1 м (или 5 м, если шаг крупный) с подписью.
// Берётся физическая длина по plan.step и зуму.
function renderPlanScaleBar(plan) {
  const el = document.getElementById('sd-plan-scale');
  if (!el) return;
  const step = plan.step || 0.6; // м/клетка
  const zoom = planZoom || 1;
  const pxPerM = (PLAN_CELL_PX / step) * zoom;
  // Подберём «красивую» длину шкалы: 1 м, 2 м, 5 м, 10 м, 20 м…
  const targetPx = 110;
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  let chosen = candidates[0];
  for (const c of candidates) {
    if (c * pxPerM <= targetPx * 1.3) chosen = c;
    else break;
  }
  const widthPx = chosen * pxPerM;
  el.innerHTML = `<div class="sd-plan-scale-bar" style="width:${widthPx.toFixed(0)}px"></div>
    <div class="sd-plan-scale-label">${chosen} м · шаг ${step} м · zoom ${(zoom * 100).toFixed(0)}%</div>`;
}

let focusRackId = null;
let pickerQuery = '';
let linksQuery = '';
let linksCableFilter = '';
let linksMissingOnly = false;
// v0.59.588: фильтры источника / цели в таблице связей. Кросс-зависимы
// со всеми остальными фильтрами (см. MEMORY: cross-filter selects).
let linksFromRackFilter = '';
let linksToRackFilter = '';
// v0.59.589: видимость overlay-линий + провисание (как у реальных кабелей).
let linksOverlayVisible = (() => {
  try { return localStorage.getItem('scs-design.linksOverlay.visible.v1') !== '0'; } catch { return true; }
})();
let linksSagEnabled = (() => {
  try { return localStorage.getItem('scs-design.linksOverlay.sag.v1') !== '0'; } catch { return true; }
})();
// v0.59.590: выбор связей для bulk-edit (Set<linkId>). Кликом по строке /
// SVG-линии переключается выделение; bulk-toolbar появляется при size >= 1.
let linksSelected = new Set();

// Ближайшая точка на отрезке tray к точке (px, py). Возвращает {qx, qy, d, tray}.
// tray = {x, y, len, orient} в КЛЕТКАХ; точки возвращаем в px (центр клетки).
function nearestOnTray(px, py, t) {
  const cx0 = (t.x + 0.5) * PLAN_CELL_PX;
  const cy0 = (t.y + 0.5) * PLAN_CELL_PX;
  let qx, qy;
  if (t.orient === 'h') {
    const x1 = cx0;
    const x2 = (t.x + t.len - 1 + 0.5) * PLAN_CELL_PX;
    qx = Math.max(x1, Math.min(x2, px));
    qy = cy0;
  } else {
    const y1 = cy0;
    const y2 = (t.y + t.len - 1 + 0.5) * PLAN_CELL_PX;
    qx = cx0;
    qy = Math.max(y1, Math.min(y2, py));
  }
  const d = Math.abs(px - qx) + Math.abs(py - qy);
  return { qx, qy, d, tray: t };
}

// v0.59.297 / v0.59.325: прилипание каналов друг к другу (T/+ стыки).
// Модель: у каждого канала 4 «направляющих» — 2 стены и 2 конца. При drag
// сравниваем каждую направляющую активного канала с направляющими соседей
// (по перпендикулярной координате) и со СТЕНОЙ/осью соседа, если он
// перпендикулярный. Радиус snap расширен до 1.8 клетки для удобства.
// Float-координаты сохраняются (не Math.round).
function snapTrayPosition(t, nx, ny, plan) {
  // v0.59.589: SNAP уменьшен с 1.8 до 0.6 клетки чтобы канал НЕ «прилипал»
  // насильно — юзер: «не могу разместить между или над стойками». При большом
  // SNAP канал шириной 100 мм (≈4 px) не помещался в проход и его уносило
  // к стене стойки.
  const SNAP = 0.6;
  const trayW = trayWidthCells(t, plan); // натуральная ширина в клетках
  const others = (plan.trays || []).filter(o => o.id !== t.id);
  let snapped = false;
  const isH = t.orient === 'h';
  // bbox активного канала
  const tL = nx, tR = nx + (isH ? t.len : trayW);
  const tT = ny, tB = ny + (isH ? trayW : t.len);
  const tCx = (tL + tR) / 2, tCy = (tT + tB) / 2;
  for (const o of others) {
    const oH = o.orient === 'h';
    const oW = trayWidthCells(o, plan);
    const oL = o.x, oR = o.x + (oH ? o.len : oW);
    const oT = o.y, oB = o.y + (oH ? oW : o.len);
    const oCx = (oL + oR) / 2, oCy = (oT + oB) / 2;

    if (isH && !oH) {
      const overlapX = oCx >= tL - SNAP && oCx <= tR + SNAP;
      if (overlapX) {
        if (Math.abs(tT - oT) <= SNAP)      { ny = oT; snapped = true; }
        else if (Math.abs(tB - oB) <= SNAP) { ny = oB - trayW; snapped = true; }
        else if (Math.abs(tCy - oCy) <= SNAP) { ny = oCy - trayW / 2; snapped = true; }
      }
      if (Math.abs(tR - oL) <= SNAP) { nx = oL - t.len; snapped = true; }
      else if (Math.abs(tL - oR) <= SNAP) { nx = oR; snapped = true; }
      else if (Math.abs(tR - oR) <= SNAP) { nx = oR - t.len; snapped = true; }
      else if (Math.abs(tL - oL) <= SNAP) { nx = oL; snapped = true; }
    } else if (!isH && oH) {
      const overlapY = oCy >= tT - SNAP && oCy <= tB + SNAP;
      if (overlapY) {
        if (Math.abs(tL - oL) <= SNAP)      { nx = oL; snapped = true; }
        else if (Math.abs(tR - oR) <= SNAP) { nx = oR - trayW; snapped = true; }
        else if (Math.abs(tCx - oCx) <= SNAP) { nx = oCx - trayW / 2; snapped = true; }
      }
      if (Math.abs(tB - oT) <= SNAP) { ny = oT - t.len; snapped = true; }
      else if (Math.abs(tT - oB) <= SNAP) { ny = oB; snapped = true; }
      else if (Math.abs(tB - oB) <= SNAP) { ny = oB - t.len; snapped = true; }
      else if (Math.abs(tT - oT) <= SNAP) { ny = oT; snapped = true; }
    } else if (isH && oH) {
      if (Math.abs(tT - oT) <= SNAP) { ny = oT; snapped = true; }
      else if (Math.abs(tB - oB) <= SNAP) { ny = oB - trayW; snapped = true; }
      if (Math.abs(tL - oR) <= SNAP) { nx = oR; snapped = true; }
      else if (Math.abs(tR - oL) <= SNAP) { nx = oL - t.len; snapped = true; }
    } else {
      if (Math.abs(tL - oL) <= SNAP) { nx = oL; snapped = true; }
      else if (Math.abs(tR - oR) <= SNAP) { nx = oR - trayW; snapped = true; }
      if (Math.abs(tT - oB) <= SNAP) { ny = oB; snapped = true; }
      else if (Math.abs(tB - oT) <= SNAP) { ny = oT - t.len; snapped = true; }
    }
  }
  // v0.59.589: snap к стенам/углам стоек — только если канал достаточно
  // близко (SNAP=0.6 клетки). Канал может проходить над стойками или между
  // ними, snap его не выталкивает.
  const racksList = getRacks();
  for (const [rid, rp] of Object.entries(plan.positions || {})) {
    const rr = racksList.find(x => x.id === rid);
    if (!rr) continue;
    const rrot = ((+rp.rot) || 0) % 360;
    const [rwF, rhF] = rackSizeCells(rr, plan, rrot);
    const rL = +rp.x, rR = +rp.x + rwF;
    const rT = +rp.y, rB = +rp.y + rhF;
    if (isH) {
      if (Math.abs(ny - rB) <= SNAP) { ny = rB; snapped = true; }
      else if (Math.abs(ny + trayW - rT) <= SNAP) { ny = rT - trayW; snapped = true; }
      if (Math.abs(nx - rL) <= SNAP) { nx = rL; snapped = true; }
      else if (Math.abs(nx - rR) <= SNAP) { nx = rR; snapped = true; }
      if (Math.abs((nx + t.len) - rR) <= SNAP) { nx = rR - t.len; snapped = true; }
      else if (Math.abs((nx + t.len) - rL) <= SNAP) { nx = rL - t.len; snapped = true; }
    } else {
      if (Math.abs(nx - rR) <= SNAP) { nx = rR; snapped = true; }
      else if (Math.abs(nx + trayW - rL) <= SNAP) { nx = rL - trayW; snapped = true; }
      if (Math.abs(ny - rT) <= SNAP) { ny = rT; snapped = true; }
      else if (Math.abs(ny - rB) <= SNAP) { ny = rB; snapped = true; }
      if (Math.abs((ny + t.len) - rB) <= SNAP) { ny = rB - t.len; snapped = true; }
      else if (Math.abs((ny + t.len) - rT) <= SNAP) { ny = rT - t.len; snapped = true; }
    }
  }
  const wCells = isH ? t.len : trayW;
  const hCells = isH ? trayW : t.len;
  nx = Math.max(0, Math.min(PLAN_COLS - wCells, nx));
  ny = Math.max(0, Math.min(PLAN_ROWS - hCells, ny));
  return { x: nx, y: ny, snapped };
}

// Строит трассу A → ближайшая точка канала → вдоль канала → ближайшая к B → B.
// Если каналы у A и B совпадают → трасса через него; если нет — двойной канал;
// если каналов нет или они слишком далеко → прямая L-линия.
// Возвращает массив точек [[x,y], ...] и суммарную длину в клетках.
// Чистый Manhattan-сегмент от P→Q. Если (px,py) и (qx,qy) различаются по обеим
// осям — добавляется L-точка (qx,py) (или (px,qy)) так, чтобы все сегменты были
// строго горизонтальные или вертикальные.
function pushManhattan(pts, qx, qy, preferAxis /* 'h'|'v' */) {
  const last = pts[pts.length - 1];
  const [lx, ly] = last;
  if (lx === qx && ly === qy) return;
  if (lx === qx || ly === qy) { pts.push([qx, qy]); return; }
  // нужен L-угол
  if (preferAxis === 'v') pts.push([lx, qy]);
  else pts.push([qx, ly]);
  pts.push([qx, qy]);
}

// Строит трассу A → ближайшая точка канала → вдоль канала → ближайшая к B → B.
// v0.59.296: строгий Manhattan (без диагоналей) + принуждение канала, если он
// ближе, чем расстояние между самими стойками.
function buildCableRoute(ax, ay, bx, by, trays, fillsMap) {
  const direct = [[ax, ay]];
  pushManhattan(direct, bx, by, 'h');
  const directCells = (Math.abs(ax - bx) + Math.abs(ay - by)) / PLAN_CELL_PX;
  if (!trays || !trays.length) return { pts: direct, cells: directCells, viaTray: false, trayIds: [] };

  // v0.59.322: вместо эвристики «bestA.d > interRack» строим КАЖДУЮ кандидат-трассу
  // (direct, single-tray для каждого канала, two-tray для каждой пары) и выбираем
  // минимум по длине с учётом fill-штрафа. Так канал «рядом» гарантированно
  // используется, если через него выходит короче/сопоставимо с обходом.
  const fillPenalty = tid => {
    if (!fillsMap) return 1;
    const f = fillsMap.get(tid);
    if (!f) return 1;
    const pct = Math.max(0, Math.min(150, f.pct || 0));
    return 1 + (pct / 100) * 0.5; // до 1.75× штраф при 150%
  };

  const buildSingle = (t, qA, qB) => {
    const pts = [[ax, ay]];
    const isH = t.orient === 'h';
    if (isH) {
      pushManhattan(pts, qA.qx, ay, 'h');
      pushManhattan(pts, qA.qx, qA.qy, 'v');
      pushManhattan(pts, qB.qx, qB.qy, 'h');
      pushManhattan(pts, qB.qx, by, 'v');
    } else {
      pushManhattan(pts, ax, qA.qy, 'v');
      pushManhattan(pts, qA.qx, qA.qy, 'h');
      pushManhattan(pts, qB.qx, qB.qy, 'v');
      pushManhattan(pts, bx, qB.qy, 'h');
    }
    pushManhattan(pts, bx, by, isH ? 'h' : 'v');
    return pts;
  };

  const buildTwo = (tA, tB, qA, qB) => {
    const pts = [[ax, ay]];
    const aH = tA.orient === 'h';
    const bH = tB.orient === 'h';
    if (aH) { pushManhattan(pts, qA.qx, ay, 'h'); pushManhattan(pts, qA.qx, qA.qy, 'v'); }
    else    { pushManhattan(pts, ax, qA.qy, 'v'); pushManhattan(pts, qA.qx, qA.qy, 'h'); }
    const hop = nearestOnTray(qA.qx, qA.qy, tB);
    if (aH) pushManhattan(pts, hop.qx, qA.qy, 'h');
    else    pushManhattan(pts, qA.qx, hop.qy, 'v');
    pushManhattan(pts, hop.qx, hop.qy, aH ? 'v' : 'h');
    pushManhattan(pts, qB.qx, qB.qy, bH ? 'h' : 'v');
    if (bH) { pushManhattan(pts, qB.qx, by, 'v'); pushManhattan(pts, bx, by, 'h'); }
    else    { pushManhattan(pts, bx, qB.qy, 'h'); pushManhattan(pts, bx, by, 'v'); }
    return pts;
  };

  const interRack = Math.abs(ax - bx) + Math.abs(ay - by);

  // v0.59.590: правило по запросу юзера (feedback_cable_routing.md):
  // «при любой возможности провести линию по кабельной трассе, нужно делать
  // через трассу, за редким исключением когда две стойки рядом и до ближайшей
  // трассы дальше чем до соседней стойки».
  //
  // Реализация: distA = ближайшее расстояние от A до любой трассы,
  // distB = от B. minTrayDist = min(distA, distB). Direct разрешён ТОЛЬКО
  // если стойки реально ближе друг к другу, чем любая из них до трассы:
  //   allowDirect = interRack < minTrayDist
  // В остальных случаях кабель ОБЯЗАН идти через трассу (даже если обход
  // через неё длиннее).
  let distA = Infinity, distB = Infinity;
  for (const t of trays) {
    const qA = nearestOnTray(ax, ay, t);
    const qB = nearestOnTray(bx, by, t);
    if (qA.d < distA) distA = qA.d;
    if (qB.d < distB) distB = qB.d;
  }
  const minTrayDist = Math.min(distA, distB);
  const allowDirect = interRack < minTrayDist;
  const reachable = trays; // все трассы — кандидаты для маршрута

  let best = allowDirect
    ? { pts: direct, cells: directCells, weighted: directCells, viaTray: false, trayIds: [] }
    : { pts: null, cells: Infinity, weighted: Infinity, viaTray: true, trayIds: [] };

  const pool = allowDirect ? trays : reachable;

  // single-tray кандидаты
  for (const t of pool) {
    const qA = nearestOnTray(ax, ay, t);
    const qB = nearestOnTray(bx, by, t);
    const pts = buildSingle(t, qA, qB);
    const cells = routeCells(pts);
    const w = cells * fillPenalty(t.id);
    if (w < best.weighted) best = { pts, cells, weighted: w, viaTray: true, trayIds: [t.id] };
  }

  // two-tray кандидаты — только для ПЕРПЕНДИКУЛЯРНЫХ пар (H+V).
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      const tA = pool[i], tB = pool[j];
      if (tA.orient === tB.orient) continue;
      const qA = nearestOnTray(ax, ay, tA);
      const qB = nearestOnTray(bx, by, tB);
      const pts = buildTwo(tA, tB, qA, qB);
      const cells = routeCells(pts);
      const w = cells * Math.max(fillPenalty(tA.id), fillPenalty(tB.id));
      if (w < best.weighted) best = { pts, cells, weighted: w, viaTray: true, trayIds: [tA.id, tB.id] };
    }
  }

  if (!best.pts) {
    // safety: reachable был не пуст, но ни single/two-tray не собрался — fallback direct
    return { pts: direct, cells: directCells, viaTray: false, trayIds: [] };
  }
  return { pts: best.pts, cells: best.cells, viaTray: best.viaTray, trayIds: best.trayIds };
}

// Вычисляет заполнение каждого канала: сумма площадей сечений проходящих
// через него кабелей / полезная площадь канала.
// v0.59.325: accepts optional prevFills для сходимости (1-я проходка без
// штрафа → 2-я с ним). Также группирует связи по паре стоек, строит route
// ОДИН раз на группу и умножает area × N.
function computeTrayFills(plan, prevFills) {
  const fills = new Map();
  (plan.trays || []).forEach(t => {
    const crossMm2 = (t.widthMm || 100) * (t.depthMm || 50);
    fills.set(t.id, { tray: t, crossMm2, usedMm2: 0, pct: 0, cables: [] });
  });
  const links = getVisibleLinks();
  const trays = plan.trays || [];
  // группировка по неупорядоченной паре — один route на группу
  const groups = new Map();
  links.forEach(l => {
    if (!plan.positions[l.fromRackId] || !plan.positions[l.toRackId]) return;
    const key = [l.fromRackId, l.toRackId].sort().join('|');
    if (!groups.has(key)) groups.set(key, { fromRackId: l.fromRackId, toRackId: l.toRackId, links: [] });
    groups.get(key).links.push(l);
  });
  groups.forEach(g => {
    const [ax, ay] = rackCenterPx(g.fromRackId, plan);
    const [bx, by] = rackCenterPx(g.toRackId, plan);
    const route = buildCableRoute(ax, ay, bx, by, trays, prevFills);
    if (!route.viaTray) return;
    g.links.forEach(l => {
      const d = CABLE_DIAMETER(l.cableType);
      const area = Math.PI * (d / 2) * (d / 2);
      route.trayIds.forEach(tid => {
        const f = fills.get(tid);
        if (!f) return;
        f.usedMm2 += area;
        f.cables.push({ linkId: l.id, type: l.cableType, diameterMm: d });
      });
    });
  });
  fills.forEach(f => { f.pct = f.crossMm2 > 0 ? (f.usedMm2 / f.crossMm2) * 100 : 0; });
  return fills;
}

// v0.59.305: SVG-визуализация поперечного сечения канала.
// Прямоугольник widthMm×depthMm в масштабе + круги кабелей (greedy shelf packing,
// ряды слева-направо + wrap). Масштаб выбирается так, чтобы вся графика
// вписалась в ~220×90 px при любых размерах канала. Возвращает готовый
// <div class="sd-tray-cross"> с inline SVG и подписями.
function renderTrayCrossSection(t, fillInfo) {
  const wMm = Math.max(20, t.widthMm || 100);
  const hMm = Math.max(20, t.depthMm || 50);
  const cables = (fillInfo && Array.isArray(fillInfo.cables)) ? fillInfo.cables.slice() : [];
  const MAX_W = 220, MAX_H = 90;
  const scale = Math.min(MAX_W / wMm, MAX_H / hMm);
  const boxW = wMm * scale;
  const boxH = hMm * scale;
  const pad = 6;
  const svgW = boxW + pad * 2 + 42; // место под вертикальную подпись глубины справа
  const svgH = boxH + pad * 2 + 18; // место под подпись ширины снизу
  // Greedy shelf packing: сортируем по убыванию диаметра, укладываем слева→направо
  // в «полки» высотой = maxD текущей полки. Если не влезает в ширину — следующая полка.
  const sorted = cables.map(c => ({ ...c })).sort((a, b) => (b.diameterMm || 0) - (a.diameterMm || 0));
  const placed = [];
  let cx = 0, cy = 0, rowH = 0;
  sorted.forEach(c => {
    const d = Math.max(1, c.diameterMm || 0);
    if (cx + d > wMm) { cy += rowH; cx = 0; rowH = 0; }
    placed.push({ cx: cx + d / 2, cy: cy + d / 2, d, type: c.type });
    cx += d;
    if (d > rowH) rowH = d;
  });
  const circles = placed.map(p => {
    const px = pad + p.cx * scale;
    const py = pad + p.cy * scale;
    const pr = (p.d / 2) * scale;
    const col = CABLE_COLOR(p.type);
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${Math.max(1, pr).toFixed(1)}" fill="${col}" fill-opacity="0.6" stroke="${col}" stroke-width="0.7"/>`;
  }).join('');
  const overflow = cy + rowH > hMm;
  const boxStroke = overflow ? '#dc2626' : '#64748b';
  const widthLabel = `${wMm} мм`;
  const depthLabel = `${hMm} мм`;
  return `<div class="sd-tray-cross" title="Поперечное сечение канала ${wMm}×${hMm} мм, пакинг ${placed.length} кабелей${overflow ? ' — НЕ ВМЕЩАЕТСЯ' : ''}">
    <svg xmlns="http://www.w3.org/2000/svg" width="${svgW.toFixed(0)}" height="${svgH.toFixed(0)}" viewBox="0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}">
      <rect x="${pad}" y="${pad}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" fill="#f8fafc" stroke="${boxStroke}" stroke-width="1.2"/>
      ${circles}
      <text x="${(pad + boxW/2).toFixed(1)}" y="${(pad + boxH + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="#475569">${widthLabel}</text>
      <text x="${(pad + boxW + 6).toFixed(1)}" y="${(pad + boxH/2 + 3).toFixed(1)}" font-size="9" fill="#475569">${depthLabel}</text>
    </svg>
  </div>`;
}

function routeCells(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  }
  return len / PLAN_CELL_PX;
}

function ptsToPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
  return d;
}

function drawPlanLinks(svg, plan) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const links = getVisibleLinks();
  const trays = plan.trays || [];
  // v0.59.325: 2-проходная сходимость — 1-й раз без штрафа, 2-й с ним.
  const fillsMap = trays.length
    ? computeTrayFills(plan, computeTrayFills(plan))
    : null;

  // v0.59.324: группируем связи по неупорядоченной паре стоек и рисуем ОДНУ
  // «линию прохода кабелей» на пару. Все правила маршрутизации одинаковые
  // (одни и те же rack-центры + каналы + fill-штраф) → все кабели пары идут
  // по одному маршруту. Раньше каждая связь рисовалась отдельной линией
  // (N одинаковых путей поверх друг друга, сдвиг только из-за сглаживания).
  const groups = new Map();
  links.forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    const key = [l.fromRackId, l.toRackId].sort().join('|');
    if (!groups.has(key)) {
      groups.set(key, { fromRackId: l.fromRackId, toRackId: l.toRackId, links: [] });
    }
    groups.get(key).links.push(l);
  });

  let directCount = 0;
  groups.forEach(g => {
    const [ax, ay] = rackCenterPx(g.fromRackId, plan);
    const [bx, by] = rackCenterPx(g.toRackId, plan);
    const route = buildCableRoute(ax, ay, bx, by, trays, fillsMap);
    const n = g.links.length;
    const isFocused = focusRackId && (g.fromRackId === focusRackId || g.toRackId === focusRackId);
    const dimmed = focusRackId && !isFocused;
    // v0.59.591: visual warning для direct-маршрутов (без трассы) — red dashed
    // line. Direct допустим только когда стойки ближе друг другу, чем до
    // ближайшей трассы (см. feedback_cable_routing.md). Если есть трассы
    // на плане и кабель всё равно ушёл direct — это исключение, юзер видит.
    const isDirect = !route.viaTray && trays.length > 0;
    if (isDirect) directCount++;
    const color = isDirect ? '#dc2626' : '#475569';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ptsToPath(route.pts));
    path.setAttribute('stroke', color);
    const baseW = Math.min(8, 2 + Math.log2(Math.max(1, n)) * 1.4);
    path.setAttribute('stroke-width', String(isFocused ? baseW + 1.5 : baseW));
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', dimmed ? '0.15' : (isFocused ? '1' : '0.7'));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if (isDirect) {
      path.setAttribute('stroke-dasharray', '8,4');
      // tooltip с объяснением, почему линия красная
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `⚠ Direct-маршрут (без трассы). Стойки расположены ближе друг к другу, чем до ближайшей трассы — это допустимое исключение из правила.`;
      path.appendChild(t);
    }
    svg.appendChild(path);
    // бейдж с количеством кабелей в группе (показываем только если >1)
    if (n > 1 && route.pts.length >= 2) {
      const mid = Math.floor(route.pts.length / 2);
      const p0 = route.pts[mid - 1] || route.pts[0];
      const p1 = route.pts[mid] || route.pts[route.pts.length - 1];
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const label = `×${n}`;
      const padX = 4, padY = 2;
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(mx));
      txt.setAttribute('y', String(my + 3));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '10');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('fill', '#0f172a');
      txt.textContent = label;
      const approxW = label.length * 6 + padX * 2;
      const approxH = 14 + padY;
      bg.setAttribute('x', String(mx - approxW / 2));
      bg.setAttribute('y', String(my - approxH / 2));
      bg.setAttribute('width', String(approxW));
      bg.setAttribute('height', String(approxH));
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', '#fff');
      bg.setAttribute('stroke', '#cbd5e1');
      bg.setAttribute('stroke-width', '1');
      bg.setAttribute('opacity', dimmed ? '0.2' : '0.95');
      svg.appendChild(bg);
      svg.appendChild(txt);
    }
  });
  // v0.59.591: индикатор в углу — кол-во direct-маршрутов (если есть).
  // Юзер сразу видит сколько связей идёт без трассы, чтобы добавить трассы
  // или согласиться, что эти исключения допустимы.
  const indicator = document.getElementById('sd-plan-direct-info');
  if (indicator) {
    if (directCount > 0 && trays.length > 0) {
      indicator.textContent = `⚠ ${directCount} direct (без трассы — красные линии)`;
      indicator.style.display = '';
    } else {
      indicator.textContent = '';
      indicator.style.display = 'none';
    }
  }
}

function computeSuggestedLength(link, plan) {
  const a = plan.positions[link.fromRackId];
  const b = plan.positions[link.toRackId];
  if (!a || !b) return null;
  const [ax, ay] = rackCenterPx(link.fromRackId, plan);
  const [bx, by] = rackCenterPx(link.toRackId, plan);
  const route = buildCableRoute(ax, ay, bx, by, plan.trays || []);
  return route.cells * plan.step * plan.kRoute;
}

// Рендер кабельного канала (tray) на плане
function renderTray(canvas, svg, t, plan, fillInfo) {
  const div = document.createElement('div');
  div.className = 'sd-plan-tray' + (t.orient === 'v' ? ' v' : ' h');
  div.dataset.id = t.id;
  // v0.59.589: ширина в натуральном масштабе по widthMm.
  const wPx = trayWidthPx(t, plan);
  const w = (t.orient === 'h' ? t.len * PLAN_CELL_PX : wPx);
  const h = (t.orient === 'v' ? t.len * PLAN_CELL_PX : wPx);
  div.style.left = (t.x * PLAN_CELL_PX) + 'px';
  div.style.top = (t.y * PLAN_CELL_PX) + 'px';
  div.style.width = w + 'px';
  div.style.height = h + 'px';
  const pct = fillInfo ? Math.round(fillInfo.pct) : 0;
  const limit = t.fillLimitPct || 40;
  let fillClass = '';
  if (pct >= 100) fillClass = ' over';
  else if (pct >= limit) fillClass = ' hi';
  else if (pct >= limit * 0.7) fillClass = ' mid';
  else if (pct > 0) fillClass = ' low';
  div.className += fillClass;
  div.title = `Кабельный канал · ${t.orient === 'h' ? '↔' : '↕'} · ${t.len} кл ≈ ${(t.len * plan.step).toFixed(1)} м · ${t.widthMm}×${t.depthMm} мм\n` +
    `Заполнение: ${pct}% (${(fillInfo?.usedMm2 || 0).toFixed(0)} / ${(fillInfo?.crossMm2 || 0).toFixed(0)} мм², лимит ${limit}%)\n` +
    `Кабелей: ${fillInfo?.cables.length || 0}`;
  const isSelected = selectedTrayId === t.id;
  if (isSelected) div.classList.add('selected');
  // v0.59.301: редактор свойств канала (ширина/глубина/лимит заполнения)
  const propsHtml = isSelected ? `<div class="sd-tray-props">
    <label>Ширина</label><input type="number" min="20" step="10" value="${t.widthMm}" data-prop="widthMm"><span class="u">мм</span>
    <label>Глубина</label><input type="number" min="20" step="10" value="${t.depthMm}" data-prop="depthMm"><span class="u">мм</span>
    <label>Лимит</label><input type="number" min="10" max="100" step="5" value="${t.fillLimitPct || 40}" data-prop="fillLimitPct"><span class="u">%</span>
  </div>` : '';
  // v0.59.299: выделение → показать список кабелей в всплывающем pop-over
  let cablesHtml = '';
  if (isSelected && fillInfo && fillInfo.cables && fillInfo.cables.length) {
    const rackNameOf = id => {
      const r = getRacks().find(x => x.id === id);
      const tag = getRackTag(id);
      return tag || (r && r.name) || id;
    };
    const rows = fillInfo.cables.map(c => {
      const lk = (getLinks().find(x => x.id === c.linkId)) || {};
      const fromN = rackNameOf(lk.fromRackId);
      const toN = rackNameOf(lk.toRackId);
      const color = CABLE_COLOR(c.type);
      return `<div class="sd-tray-cable-row">
        <span class="sd-tray-cable-sw" style="background:${color}"></span>
        <span class="sd-tray-cable-type">${escapeHtml(c.type)}</span>
        <span class="sd-tray-cable-d">⌀${(c.diameterMm||0).toFixed(1)}мм</span>
        <span class="sd-tray-cable-ep">${escapeHtml(fromN)} → ${escapeHtml(toN)}</span>
      </div>`;
    }).join('');
    // v0.59.305: визуализация поперечного сечения канала — прямоугольник
    // widthMm×depthMm в масштабе + круги кабелей (greedy shelf packing).
    const crossSvg = renderTrayCrossSection(t, fillInfo);
    cablesHtml = `<div class="sd-tray-popover">
      ${propsHtml}
      <div class="sd-tray-popover-h">Кабелей: ${fillInfo.cables.length} · ${pct}% · лимит ${limit}%
        ${pct > limit ? `<button type="button" class="sd-tray-fit" title="Увеличить сечение канала до ${limit}% лимита">↗ Подогнать</button>` : ''}
      </div>
      ${crossSvg}
      ${rows}
    </div>`;
  } else if (isSelected) {
    cablesHtml = `<div class="sd-tray-popover">
      ${propsHtml}
      <div class="sd-tray-popover-h">В этом канале пока нет кабелей</div>
    </div>`;
  }
  div.innerHTML = `<span class="sd-plan-tray-label">⬚ L=${(t.len * plan.step).toFixed(1)}м · ${t.widthMm}×${t.depthMm} · <b class="sd-tray-fill-pct">${pct}%</b></span>
    <button type="button" class="sd-plan-tray-rot" title="Повернуть">⟳</button>
    <button type="button" class="sd-plan-tray-rm" title="Удалить">✕</button>
    <div class="sd-plan-tray-resize sd-plan-tray-resize-start" title="Растянуть/сократить (перетащите)"></div>
    <div class="sd-plan-tray-resize sd-plan-tray-resize-end" title="Растянуть/сократить (перетащите)"></div>
    ${cablesHtml}`;
  canvas.appendChild(div);

  // drag
  let dragging = false, sx = 0, sy = 0, sCell = null, movedPx = 0;
  div.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.target.classList && e.target.classList.contains('sd-plan-tray-resize')) return;
    dragging = true;
    movedPx = 0;
    div.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    sCell = { x: t.x, y: t.y };
    div.classList.add('dragging');
  });
  div.addEventListener('pointermove', e => {
    if (!dragging) return;
    const z = planZoom || 1;
    movedPx = Math.max(movedPx, Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy));
    const dx = Math.round((e.clientX - sx) / (PLAN_CELL_PX * z));
    const dy = Math.round((e.clientY - sy) / (PLAN_CELL_PX * z));
    const wCells = (t.orient === 'h' ? t.len : TRAY_W_CELLS);
    const hCells = (t.orient === 'v' ? t.len : TRAY_W_CELLS);
    let nx = Math.max(0, Math.min(PLAN_COLS - wCells, sCell.x + dx));
    let ny = Math.max(0, Math.min(PLAN_ROWS - hCells, sCell.y + dy));
    // v0.59.297: snap к соседним каналам (T/крестовые стыки).
    const snapped = snapTrayPosition(t, nx, ny, plan);
    nx = snapped.x; ny = snapped.y;
    div.classList.toggle('snapped', snapped.snapped);
    div.style.left = (nx * PLAN_CELL_PX) + 'px';
    div.style.top = (ny * PLAN_CELL_PX) + 'px';
    t.x = nx; t.y = ny;
    drawPlanLinks(svg, plan);
  });
  div.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    div.classList.remove('dragging');
    // Клик без реального перемещения → выделить/снять выделение + показать кабели
    if (movedPx < 5) {
      selectedTrayId = (selectedTrayId === t.id) ? null : t.id;
      renderPlan();
      return;
    }
    const p2 = getPlan();
    const target = (p2.trays || []).find(x => x.id === t.id);
    if (target) { target.x = t.x; target.y = t.y; savePlan(p2); }
    updatePlanInfo();
  });

  div.querySelector('.sd-plan-tray-rm').addEventListener('click', e => {
    e.stopPropagation();
    const p2 = getPlan();
    p2.trays = (p2.trays || []).filter(x => x.id !== t.id);
    savePlan(p2); renderPlan();
  });
  div.querySelector('.sd-plan-tray-rot').addEventListener('click', e => {
    e.stopPropagation();
    const p2 = getPlan();
    const target = (p2.trays || []).find(x => x.id === t.id);
    if (!target) return;
    target.orient = target.orient === 'h' ? 'v' : 'h';
    const w = target.orient === 'h' ? target.len : TRAY_W_CELLS;
    const h = target.orient === 'v' ? target.len : TRAY_W_CELLS;
    target.x = Math.max(0, Math.min(PLAN_COLS - w, target.x));
    target.y = Math.max(0, Math.min(PLAN_ROWS - h, target.y));
    savePlan(p2); renderPlan();
  });

  // Ручное растягивание за края канала
  const wireResize = (handle, isEnd) => {
    if (!handle) return;
    let drag = null;
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      drag = { sx: e.clientX, sy: e.clientY, sLen: t.len, sX: t.x, sY: t.y };
    });
    handle.addEventListener('pointermove', e => {
      if (!drag) return;
      const z = planZoom || 1;
      const dx = Math.round((e.clientX - drag.sx) / (PLAN_CELL_PX * z));
      const dy = Math.round((e.clientY - drag.sy) / (PLAN_CELL_PX * z));
      const along = (t.orient === 'h') ? dx : dy;
      if (isEnd) {
        // тянем конец → меняется только len
        const maxLen = (t.orient === 'h') ? (PLAN_COLS - drag.sX) : (PLAN_ROWS - drag.sY);
        t.len = Math.max(2, Math.min(maxLen, drag.sLen + along));
      } else {
        // тянем начало → сдвигаем x/y и уменьшаем/увеличиваем len
        const newLen = Math.max(2, drag.sLen - along);
        const delta = drag.sLen - newLen;
        if (t.orient === 'h') t.x = Math.max(0, drag.sX + delta);
        else t.y = Math.max(0, drag.sY + delta);
        t.len = newLen;
      }
      const wPx = (t.orient === 'h' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
      const hPx = (t.orient === 'v' ? t.len : TRAY_W_CELLS) * PLAN_CELL_PX;
      div.style.left = (t.x * PLAN_CELL_PX) + 'px';
      div.style.top = (t.y * PLAN_CELL_PX) + 'px';
      div.style.width = wPx + 'px';
      div.style.height = hPx + 'px';
      drawPlanLinks(svg, plan);
    });
    handle.addEventListener('pointerup', e => {
      if (!drag) return;
      drag = null;
      handle.releasePointerCapture(e.pointerId);
      const p2 = getPlan();
      const target = (p2.trays || []).find(x => x.id === t.id);
      if (target) { target.x = t.x; target.y = t.y; target.len = t.len; savePlan(p2); }
      renderPlan();
    });
  };
  wireResize(div.querySelector('.sd-plan-tray-resize-start'), false);
  wireResize(div.querySelector('.sd-plan-tray-resize-end'), true);

  // v0.59.301: pop-over — не начинать drag/select по клику внутри него
  const pop = div.querySelector('.sd-tray-popover');
  if (pop) {
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    pop.addEventListener('click', e => e.stopPropagation());
    // v0.59.307: кнопка «↗ Подогнать» — увеличивает widthMm (при необходимости
    // и depthMm) до тех пор, пока pct ≤ fillLimitPct, округляя до 10 мм вверх.
    const fitBtn = pop.querySelector('.sd-tray-fit');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        const p2 = getPlan();
        const target = (p2.trays || []).find(x => x.id === t.id);
        if (!target) return;
        const usedMm2 = (fillInfo?.usedMm2) || 0;
        const limit = (target.fillLimitPct || 40) / 100;
        if (limit <= 0 || usedMm2 <= 0) return;
        const neededCross = usedMm2 / limit;
        // сохраняем соотношение сторон, округляем ширину вверх до 50 мм
        const ratio = (target.widthMm || 100) / Math.max(1, target.depthMm || 50);
        let newW = Math.sqrt(neededCross * ratio);
        newW = Math.ceil(newW / 50) * 50;
        let newD = Math.ceil((neededCross / newW) / 10) * 10;
        target.widthMm = Math.max(target.widthMm || 100, newW);
        target.depthMm = Math.max(target.depthMm || 50, newD);
        savePlan(p2); renderPlan();
      });
    }
    pop.querySelectorAll('input[data-prop]').forEach(inp => {
      inp.addEventListener('change', () => {
        const p2 = getPlan();
        const target = (p2.trays || []).find(x => x.id === t.id);
        if (!target) return;
        const prop = inp.dataset.prop;
        const v = +inp.value || 0;
        if (prop === 'widthMm') target.widthMm = Math.max(20, v);
        else if (prop === 'depthMm') target.depthMm = Math.max(20, v);
        else if (prop === 'fillLimitPct') target.fillLimitPct = Math.max(10, Math.min(100, v));
        savePlan(p2); renderPlan();
      });
    });
  }
}

function addTray(orient) {
  const p2 = getPlan();
  if (!Array.isArray(p2.trays)) p2.trays = [];
  const id = 'tr-' + Math.random().toString(36).slice(2, 8);
  const len = 6;
  // спавним в центре и двигаем левее/выше, если не влезает
  let x = Math.max(0, Math.floor((PLAN_COLS - (orient === 'h' ? len : 1)) / 2));
  let y = Math.max(0, Math.floor((PLAN_ROWS - (orient === 'v' ? len : 1)) / 2));
  p2.trays.push({ id, x, y, len, orient });
  savePlan(p2); renderPlan();
}

function updatePlanInfo() {
  const info = document.getElementById('sd-plan-info');
  if (!info) return;
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]).length;
  const links = getVisibleLinks();
  const total = links.length;
  const withPos = links.filter(l => plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  const missing = links.filter(l => (l.lengthM == null) && plan.positions[l.fromRackId] && plan.positions[l.toRackId]).length;
  // суммарная длина с коэф. по типам (берём реальные lengthM, а где нет — suggested)
  const byType = new Map();
  let totalM = 0;
  links.forEach(l => {
    const len = (l.lengthM != null) ? l.lengthM : computeSuggestedLength(l, plan);
    if (len == null) return;
    const v = len * 1.3; // запас на спуск/подъём как в BOM
    const k = l.cableType || '—';
    byType.set(k, (byType.get(k) || 0) + v);
    totalM += v;
  });
  const typeStr = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${Math.round(v)}м`)
    .join(' · ');
  // v0.59.308: сводка по каналам — среднее заполнение + переполненные
  const trays = plan.trays || [];
  let trayStr = '';
  if (trays.length) {
    const fills = computeTrayFills(plan);
    let sum = 0, n = 0, over = 0;
    trays.forEach(t => {
      const f = fills.get(t.id);
      if (!f) return;
      sum += f.pct; n++;
      if (f.pct > (t.fillLimitPct || 40)) over++;
    });
    const avg = n ? Math.round(sum / n) : 0;
    trayStr = ` · каналов: <b>${trays.length}</b> (${avg}% avg${over ? `, <span style="color:#dc2626">⚠ ${over} перегруж.</span>` : ''})`;
  }
  info.innerHTML = `стоек: <b>${placed}</b>/${racks.length} · связей: <b>${withPos}</b>/${total} · без длины: <b>${missing}</b> · Σ с запасом: <b>${Math.round(totalM)}м</b>${typeStr ? ' (' + typeStr + ')' : ''}${trayStr}`;
}

function applySuggestedLengths() {
  const plan = getPlan();
  const links = getLinks();
  let n = 0;
  links.forEach(l => {
    if (l.lengthM != null) return;
    const len = computeSuggestedLength(l, plan);
    if (len != null) { l.lengthM = Math.round(len * 10) / 10; n++; }
  });
  setLinks(links);
  updateStatus(`✔ Заполнено длин: ${n}. Масштаб ${plan.step} м/клетка × коэф. ${plan.kRoute}.`);
  renderLinksList();
  updatePlanInfo();
  drawLinkOverlay();
}

function resetPlan() {
  savePlan({ ...getPlan(), positions: {} });
  renderPlan();
}

function exportPlanSvg() {
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  if (!placed.length) { updateStatus('⚠ План пуст — нечего экспортировать. Используйте «⊞ Автораскладка» или перетащите стойки.'); return; }

  const W = PLAN_COLS * PLAN_CELL_PX;
  const H = PLAN_ROWS * PLAN_CELL_PX;
  const rackFill = pct => {
    if (pct === 0) return '#94a3b8';
    if (pct < 70)  return '#10b981';
    if (pct < 90)  return '#0891b2';
    if (pct < 100) return '#f59e0b';
    return '#dc2626';
  };

  // Заголовок/рамка
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W + 40}" height="${H + 80}" viewBox="0 0 ${W + 40} ${H + 80}" font-family="-apple-system,Segoe UI,Arial,sans-serif">`);
  lines.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  lines.push(`<text x="20" y="26" font-size="16" font-weight="600" fill="#1f2937">План зала СКС · ${new Date().toLocaleDateString('ru')} · шаг ${plan.step} м × коэф.${plan.kRoute}</text>`);

  // Сетка
  const gx = 20, gy = 46;
  lines.push(`<g transform="translate(${gx},${gy})">`);
  lines.push(`<rect width="${W}" height="${H}" fill="#fafafa" stroke="#d4d8e0"/>`);
  const gridParts = [];
  for (let c = 1; c < PLAN_COLS; c++) gridParts.push(`<line x1="${c*PLAN_CELL_PX}" y1="0" x2="${c*PLAN_CELL_PX}" y2="${H}" stroke="#e5e7eb" stroke-width="0.5"/>`);
  for (let r = 1; r < PLAN_ROWS; r++) gridParts.push(`<line x1="0" y1="${r*PLAN_CELL_PX}" x2="${W}" y2="${r*PLAN_CELL_PX}" stroke="#e5e7eb" stroke-width="0.5"/>`);
  lines.push(gridParts.join(''));

  // v0.59.304: Каналы (trays) — рисуем ДО кабелей, чтобы кабели визуально шли
  // поверх. Цвет заливки — по заполнению (green/cyan/amber/red).
  const trayFillsMap = computeTrayFills(plan);
  const trayColor = pct => {
    if (pct < 30) return '#10b981';
    if (pct < 60) return '#0891b2';
    if (pct < 90) return '#f59e0b';
    return '#dc2626';
  };
  (plan.trays || []).forEach(t => {
    const fi = trayFillsMap.get(t.id) || { pct: 0 };
    const isH = t.orient !== 'v';
    const x = t.x * PLAN_CELL_PX;
    const y = t.y * PLAN_CELL_PX;
    const w = isH ? t.len * PLAN_CELL_PX : PLAN_CELL_PX;
    const h = isH ? PLAN_CELL_PX : t.len * PLAN_CELL_PX;
    const col = trayColor(fi.pct);
    lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" opacity="0.18" stroke="${col}" stroke-width="1" stroke-dasharray="3 2" rx="1"/>`);
    const lenM = (t.len * plan.step).toFixed(1);
    const lbl = `⬚ L=${lenM}м · ${t.widthMm}×${t.depthMm} · ${Math.round(fi.pct)}%`;
    const lx = x + w / 2, ly = y + h / 2;
    lines.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="9" fill="#475569">${escapeSvg(lbl)}</text>`);
  });

  // Кабели (Manhattan через каналы) + подписи длин — только действующие
  getVisibleLinks().forEach(l => {
    const a = plan.positions[l.fromRackId];
    const b = plan.positions[l.toRackId];
    if (!a || !b) return;
    // v0.59.303: центр стойки с учётом её физических размеров и поворота.
    const [ax, ay] = rackCenterPx(l.fromRackId, plan);
    const [bx, by] = rackCenterPx(l.toRackId, plan);
    const color = CABLE_COLOR(l.cableType);
    // v0.59.304: используем ту же Manhattan-трассу через каналы, что и на экране.
    const route = buildCableRoute(ax, ay, bx, by, plan.trays || [], trayFillsMap);
    const pts = route.pts || [[ax, ay], [bx, by]];
    const d = pts.map((p, i) => (i ? 'L ' : 'M ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    lines.push(`<path d="${d}" stroke="${color}" stroke-width="2" fill="none" opacity="0.8"/>`);
    const lenM = ((route.cells || 0) * plan.step * plan.kRoute).toFixed(1);
    const mid = pts[Math.floor(pts.length / 2)];
    const lx = mid[0], ly = mid[1];
    lines.push(`<rect x="${lx - 18}" y="${ly - 7}" width="36" height="14" rx="2" fill="#ffffff" stroke="${color}" stroke-width="0.5" opacity="0.92"/>`);
    lines.push(`<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="9" fill="#1f2937">${lenM} м</text>`);
  });

  // Стойки
  placed.forEach(r => {
    const pos = plan.positions[r.id];
    const s = rackStats(r);
    const pct = s.u ? Math.round((s.usedU / s.u) * 100) : 0;
    const fill = rackFill(pct);
    const tag = getRackTag(r.id);
    const isDraft = !tag.trim();
    // v0.59.304: физические размеры + поворот.
    const rot = rackRot(plan, r.id);
    const [wC, hC] = rackSizeCells(r, plan, rot);
    const x = pos.x * PLAN_CELL_PX;
    const y = pos.y * PLAN_CELL_PX;
    const w = wC * PLAN_CELL_PX;
    const h = hC * PLAN_CELL_PX;
    const textFill = pct >= 70 && pct < 90 ? '#1f2937' : '#ffffff';
    const strokeAttr = isDraft ? ' stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3 2"' : '';
    const opacityAttr = isDraft ? ' opacity="0.75"' : '';
    lines.push(`<g${opacityAttr}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"${strokeAttr}/><text x="${x + w/2}" y="${y + h/2 + 3}" text-anchor="middle" font-size="9" font-weight="600" fill="${textFill}">${escapeSvg(tag || r.name || r.id)}</text></g>`);
  });

  lines.push(`</g>`);

  // Легенда
  const ly = gy + H + 10;
  const legendItems = [
    { color: '#94a3b8', label: 'пусто' },
    { color: '#10b981', label: '<70%' },
    { color: '#0891b2', label: '70-89%' },
    { color: '#f59e0b', label: '90-99%' },
    { color: '#dc2626', label: '≥100%' },
  ];
  let lx = gx;
  legendItems.forEach(it => {
    lines.push(`<rect x="${lx}" y="${ly}" width="18" height="10" fill="${it.color}" rx="1"/>`);
    lines.push(`<text x="${lx + 22}" y="${ly + 9}" font-size="11" fill="#475569">${escapeSvg(it.label)}</text>`);
    lx += 22 + (it.label.length * 6) + 14;
  });

  lines.push(`</svg>`);
  const svg = lines.join('\n');
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scs-plan-${dateStamp()}.svg`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  updateStatus(`✔ План экспортирован: ${placed.length} стоек, ${getVisibleLinks().length} связей.`);
  return { svg, W: W + 40, H: H + 80, racks: placed.length, links: getVisibleLinks().length };
}

// v0.59.320: PNG-экспорт через растеризацию SVG в <canvas>.
// Переиспользует тот же SVG-билдер (exportPlanSvg с перехватом download).
function exportPlanPng() {
  const plan = getPlan();
  const racks = getProjectInstances();
  const placed = racks.filter(r => plan.positions[r.id]);
  if (!placed.length) { updateStatus('⚠ План пуст — нечего экспортировать.'); return; }
  // Перехватываем download: временно подменяем HTMLAnchorElement.click,
  // перехватываем URL созданный через URL.createObjectURL, читаем blob как SVG,
  // рендерим в canvas и экспортируем PNG.
  const origCreate = URL.createObjectURL;
  let svgBlob = null;
  URL.createObjectURL = (b) => { svgBlob = b; return 'javascript:void(0)'; };
  const origAppendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = (el) => { if (el.tagName !== 'A') origAppendChild(el); return el; };
  try { exportPlanSvg(); } finally {
    URL.createObjectURL = origCreate;
    document.body.appendChild = origAppendChild;
  }
  if (!svgBlob) { updateStatus('⚠ PNG: не удалось сгенерировать SVG.'); return; }
  const scale = 2; // ретина-масштаб для чёткости
  svgBlob.text().then(svgText => {
    const img = new Image();
    const blobUrl = origCreate(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { updateStatus('⚠ PNG: canvas.toBlob вернул пусто.'); return; }
        const url = origCreate(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `scs-plan-${dateStamp()}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); URL.revokeObjectURL(blobUrl); }, 0);
        updateStatus(`✔ PNG экспортирован (${canvas.width}×${canvas.height}).`);
      }, 'image/png');
    };
    img.onerror = () => { updateStatus('⚠ PNG: <img> не смог загрузить SVG.'); URL.revokeObjectURL(blobUrl); };
    img.src = blobUrl;
  });
}

function escapeSvg(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* v0.59.585: Автораскладка по ТЗ — стандартные ряды с коридором 1200 мм
   и нумерацией «по одному» право-лево-право-лево.

   Логика:
   1. ВСЕ стойки сортируются по тегу (numeric, SR01 < SR02 < … < SR10 < CR01).
      Без тега (черновики) сортируются в конец по id.
   2. По чтению последовательности: чётный индекс (0, 2, 4 …) → Ряд A (верх),
      нечётный (1, 3, 5 …) → Ряд B (низ). Так номера 1, 2, 3, 4, 5 … ложатся
      «право-лево-право-лево».
   3. Стойки в каждом ряду идут впритык по X. Когда ряд A упирается в правый
      край плана — оба ряда переносятся вниз (сначала ряд B текущей пары
      замыкается, затем после groupGap начинается новая пара рядов).
   4. Расстояние между рядом A и рядом B (одной пары) = 1200 мм (cold/hot
      aisle, рассчитано из plan.step). Между разными ПАРАМИ рядов — 2 клетки.
*/
function autoLayout() {
  const racks = getRacks();
  if (!racks.length) return;
  const plan = getPlan();
  const tags = {};
  racks.forEach(r => { tags[r.id] = (getRackTag(r.id) || '').trim(); });

  // Глобальная сортировка: тегованные сначала (numeric), без тега — в конец.
  const sorted = racks.slice().sort((a, b) => {
    const ta = tags[a.id] || '';
    const tb = tags[b.id] || '';
    if (!!ta !== !!tb) return ta ? -1 : 1;
    if (ta && tb) return ta.localeCompare(tb, 'ru', { numeric: true });
    return (a.id || '').localeCompare(b.id || '');
  });

  const positions = {};
  const step = (plan && +plan.step) || 0.6;          // м/клетка
  const aisleCells = Math.max(1, Math.round(1.2 / step)); // 1200 мм коридор
  const pairGap = 2;                                 // клеток между парами рядов
  const colGap = 0;                                  // соседние стойки впритык

  // sizeOf(r) — размеры стойки в клетках с учётом текущего rot.
  const sizeOf = (r) => {
    const rot = rackRot(plan, r.id);
    const [wC, hC] = rackSizeCells(r, plan, rot);
    return { wC, hC: Math.max(1, Math.ceil(hC)), rot };
  };

  // Размещаем парами: сначала идём по A, потом B, X-координаты совпадают.
  // При переполнении A → закрываем текущую пару, открываем новую ниже.
  let baseY = 1;            // верх текущей пары рядов (Y ряда A)
  let colA = 1;             // текущая X-позиция в ряду A
  let pairIndex = 0;        // 0 = ждём rack для A, 1 = ждём rack для B
  let pendingA = null;      // последняя положенная A-стойка (для совпадения X у B)
  let rowAMaxH = 1;         // макс. высота ряда A текущей пары
  let rowBMaxH = 1;         // макс. высота ряда B текущей пары

  // Открываем новую пару рядов: переносим baseY ниже и сбрасываем колонки.
  const closePair = () => {
    baseY = baseY + rowAMaxH + aisleCells + rowBMaxH + pairGap;
    colA = 1;
    pendingA = null;
    pairIndex = 0;
    rowAMaxH = 1;
    rowBMaxH = 1;
  };

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const sz = sizeOf(r);

    if (pairIndex === 0) {
      // Кладём в ряд A.
      if (colA + sz.wC > PLAN_COLS + 1) {
        // Не помещается — закрываем пару (хотя бы с одной A-стойкой).
        closePair();
      }
      positions[r.id] = { x: colA, y: baseY, rot: sz.rot };
      pendingA = { x: colA, wC: sz.wC, hC: sz.hC };
      if (sz.hC > rowAMaxH) rowAMaxH = sz.hC;
      colA += sz.wC + colGap;
      pairIndex = 1;
    } else {
      // Кладём в ряд B — X-позиция совпадает с парной A-стойкой,
      // Y = baseY + rowAMaxH + aisleCells.
      const xB = pendingA ? pendingA.x : 1;
      const yB = baseY + rowAMaxH + aisleCells;
      positions[r.id] = { x: xB, y: yB, rot: sz.rot };
      if (sz.hC > rowBMaxH) rowBMaxH = sz.hC;
      pairIndex = 0;
    }
  }

  // Если последняя стойка ушла в A без пары B — фиксируем B-высоту = 1, чтобы
  // отступ для следующих авторасклад был корректным (положительным).

  savePlan({ ...plan, positions });
  renderPlan();
  updateStatus(`✔ Автораскладка: ${Object.keys(positions).length} стоек, коридор 1200 мм, нумерация право-лево-право-лево.`);
}

/* v0.59.306: автогенерация каналов.
   Стратегия: группируем стойки по y-координате (ряды), для каждого ряда строим
   горизонтальный канал прямо над рядом (y = rowY - 1) длиной от самой левой до
   самой правой стойки + 1 клетка с каждого края. Затем — один вертикальный
   спинальный канал в самой левой доступной колонке, соединяющий все ряды.
   Старые trays c id начинающимся на `auto-` заменяются; пользовательские
   (добавленные вручную) сохраняются. */
function autoGenerateTrays() {
  const plan = getPlan();
  const positions = plan.positions || {};
  const entries = Object.entries(positions);
  if (!entries.length) { updateStatus('⚠ На плане нет стоек — автогенерация каналов невозможна.'); return; }
  // группировка по y-координате
  const racksList = getRacks();
  const byId = new Map(racksList.map(r => [r.id, r]));
  const rows = new Map();
  entries.forEach(([id, p]) => {
    const y = p.y | 0;
    if (!rows.has(y)) rows.set(y, []);
    const r = byId.get(id);
    const rot = ((+p.rot) || 0) % 360;
    const [wC] = r ? rackSizeCells(r, plan, rot) : [1, 1];
    rows.get(y).push({ id, x: p.x | 0, w: wC });
  });
  const newTrays = [];
  const sortedRowsY = Array.from(rows.keys()).sort((a, b) => a - b);
  let minLeft = Infinity, maxRight = -Infinity;
  sortedRowsY.forEach(y => {
    const row = rows.get(y);
    const left = Math.min(...row.map(r => r.x));
    const right = Math.max(...row.map(r => r.x + r.w)); // правый край последней стойки
    const lenCells = Math.max(2, right - left + 2); // +1 клетка по краям
    const trayY = Math.max(0, y - 1); // над рядом
    newTrays.push({
      id: 'auto-h-' + y,
      orient: 'h',
      x: Math.max(0, left - 1),
      y: trayY,
      len: Math.min(lenCells, PLAN_COLS - Math.max(0, left - 1)),
      widthMm: 200, depthMm: 100, fillLimitPct: 40,
    });
    if (left < minLeft) minLeft = left;
    if (right > maxRight) maxRight = right;
  });
  // вертикальный спинальный канал слева
  if (sortedRowsY.length >= 2) {
    const topY = Math.max(0, sortedRowsY[0] - 1);
    const botY = sortedRowsY[sortedRowsY.length - 1] + 1;
    const spineX = Math.max(0, minLeft - 2);
    newTrays.push({
      id: 'auto-v-spine',
      orient: 'v',
      x: spineX,
      y: topY,
      len: Math.max(2, botY - topY + 1),
      widthMm: 300, depthMm: 150, fillLimitPct: 40,
    });
  }
  // сохраняем: заменяем все auto-*, оставляем пользовательские
  const userTrays = (plan.trays || []).filter(t => !String(t.id || '').startsWith('auto-'));
  savePlan({ ...plan, trays: [...userTrays, ...newTrays] });
  renderPlan();
  updateStatus(`✔ Авто-каналы: ${newTrays.length} канал(а/ов) сгенерировано по ${sortedRowsY.length} рядам.`);
}

/* v0.59.309: подогнать сечения ВСЕХ перегруженных каналов одним кликом.
   Для каждого канала с pct > fillLimitPct: neededCross = usedMm2 / (limit/100),
   затем новые W/D с сохранением соотношения сторон, округление ceil(W/50)×50 и
   ceil(D/10)×10. Размеры только увеличиваются (никогда не уменьшаются). */
function fitAllTrays() {
  const plan = getPlan();
  const trays = plan.trays || [];
  if (!trays.length) { updateStatus('⚠ На плане нет каналов — нечего подгонять.'); return; }
  const fills = computeTrayFills(plan);
  let fixed = 0;
  trays.forEach(t => {
    const f = fills.get(t.id);
    if (!f) return;
    const limit = (t.fillLimitPct || 40) / 100;
    if (limit <= 0 || f.pct <= (t.fillLimitPct || 40)) return;
    const usedMm2 = f.usedMm2 || 0;
    if (usedMm2 <= 0) return;
    const neededCross = usedMm2 / limit;
    const ratio = (t.widthMm || 100) / Math.max(1, t.depthMm || 50);
    let newW = Math.sqrt(neededCross * ratio);
    newW = Math.ceil(newW / 50) * 50;
    let newD = Math.ceil((neededCross / newW) / 10) * 10;
    const oldW = t.widthMm || 100, oldD = t.depthMm || 50;
    t.widthMm = Math.max(oldW, newW);
    t.depthMm = Math.max(oldD, newD);
    if (t.widthMm !== oldW || t.depthMm !== oldD) fixed++;
  });
  if (!fixed) { updateStatus('✓ Все каналы в пределах лимита — подгонка не требуется.'); return; }
  savePlan(plan);
  renderPlan();
  updateStatus(`✔ Подогнано ${fixed} канал(а/ов): сечение увеличено до лимита заполнения.`);
}

/* ---------- CSV export ---------- */
function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  // BOM для Excel + UTF-8
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function exportBomCsv() {
  const links = getVisibleLinks();
  const byType = new Map();
  for (const l of links) {
    const t = l.cableType || 'other';
    if (!byType.has(t)) byType.set(t, { lines: 0, lenRaw: 0, withoutLen: 0 });
    const r = byType.get(t);
    r.lines++;
    if (l.lengthM != null && !Number.isNaN(+l.lengthM)) r.lenRaw += +l.lengthM;
    else r.withoutLen++;
  }
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['Тип кабеля', 'Линий', 'Σ длин, м', `С запасом ×${BOM_RESERVE}, м`, 'Без длины']];
  for (const [t, r] of byType.entries()) {
    rows.push([cableLabel(t), r.lines, r.lenRaw.toFixed(1), (r.lenRaw * BOM_RESERVE).toFixed(1), r.withoutLen || '']);
  }
  // v0.59.310: секция «Кабельные каналы» — группировка по размеру сечения
  const plan = getPlan();
  const trays = plan.trays || [];
  if (trays.length) {
    const bySize = new Map();
    trays.forEach(t => {
      const key = `${t.widthMm || 100}×${t.depthMm || 50}`;
      const lenM = (t.len || 0) * plan.step;
      if (!bySize.has(key)) bySize.set(key, { count: 0, totalM: 0 });
      const r = bySize.get(key);
      r.count++;
      r.totalM += lenM;
    });
    rows.push([]);
    rows.push(['Сечение канала, мм', 'Шт', 'Σ длин, м', `С запасом ×${BOM_RESERVE}, м`, '']);
    Array.from(bySize.entries())
      .sort((a, b) => b[1].totalM - a[1].totalM)
      .forEach(([size, r]) => {
        rows.push([size, r.count, r.totalM.toFixed(1), (r.totalM * BOM_RESERVE).toFixed(1), '']);
      });
  }
  downloadCsv('scs-bom-' + dateStamp() + '.csv', rows);
}

function exportLinksCsv() {
  const links = getVisibleLinks();
  const cableLabel = id => (CABLE_TYPES.find(c => c.id === id)?.label) || id;
  const rows = [['#', 'Шкаф A', 'Устройство A', 'Порт A', 'Шкаф B', 'Устройство B', 'Порт B', 'Кабель', 'Длина, м', 'С запасом, м', 'Заметка']];
  links.forEach((l, i) => {
    const len = l.lengthM != null && !Number.isNaN(+l.lengthM) ? +l.lengthM : null;
    rows.push([
      i + 1,
      getRackShortLabel(l.fromRackId),
      deviceLabel(l.fromRackId, l.fromDevId),
      l.fromPort || '',
      getRackShortLabel(l.toRackId),
      deviceLabel(l.toRackId, l.toDevId),
      l.toPort || '',
      cableLabel(l.cableType),
      len == null ? '' : len.toFixed(1),
      len == null ? '' : (len * BOM_RESERVE).toFixed(1),
      l.note || '',
    ]);
  });
  downloadCsv('scs-links-' + dateStamp() + '.csv', rows);
}
/* ---------- Project JSON import / export ---------- */
const PROJECT_SCHEMA = 'raschet.scs-design/1';

function exportProjectJson() {
  const payload = {
    schema: PROJECT_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: (document.querySelector('[data-app-version]')?.textContent || '').trim(),
    selection: loadJson(LS_SELECTION, []),
    links: getLinks(),
    plan: getPlan(),
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scs-design-${dateStamp()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  const st = document.getElementById('sd-import-status');
  if (st) st.textContent = `✔ Сохранено: ${payload.links.length} связей · ${Object.keys(payload.plan.positions || {}).length} позиций · ${payload.selection.length} выбр.стоек`;
}

function importProjectJson(file) {
  const st = document.getElementById('sd-import-status');
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj || obj.schema !== PROJECT_SCHEMA) {
        if (st) st.textContent = `⚠ Не похоже на проект SCS (schema ≠ ${PROJECT_SCHEMA}).`;
        return;
      }
      if (Array.isArray(obj.selection)) saveJson(LS_SELECTION, obj.selection);
      if (Array.isArray(obj.links)) setLinks(obj.links);
      if (obj.plan && typeof obj.plan === 'object') savePlan(obj.plan);
      if (st) st.textContent = `✔ Импортировано: ${(obj.links || []).length} связей · ${Object.keys((obj.plan && obj.plan.positions) || {}).length} позиций · ${(obj.selection || []).length} выбр.стоек`;
      renderLinksTab();
      renderPlan();
      renderRacksSummary();
    } catch (err) {
      if (st) st.textContent = `⚠ Ошибка чтения: ${err.message}`;
    }
  };
  rd.readAsText(file);
}

function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function updateLink(id, patch) {
  const cur = getLinks();
  const i = cur.findIndex(x => x.id === id);
  if (i < 0) return;
  cur[i] = { ...cur[i], ...patch };
  setLinks(cur);
  renderBom();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const { pid, migrated } = rescopeToActiveProject();
  renderProjectBadge(pid);
  if (migrated > 0) {
    updateStatus(`ℹ Данные СКС перенесены в активный проект (перенесено ключей: ${migrated}). Старые глобальные ключи оставлены как резерв.`);
  }
  setupTabs();
  const cleaned = sanitizeLinks();
  renderLinksTab();
  // Esc — снять фокус с трассы на плане
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (focusRackId) {
      focusRackId = null;
      renderPlan();
    }
  });
  if (cleaned > 0) {
    updateStatus(`⚠ Удалено ${cleaned} связь(ей) с кабельными органайзерами — у них нет портов, они используются только для трассировки.`);
  }
  document.getElementById('sd-export-csv')?.addEventListener('click', exportBomCsv);
  document.getElementById('sd-export-links-csv')?.addEventListener('click', exportLinksCsv);
  document.getElementById('sd-racks-csv')?.addEventListener('click', exportRacksCsv);
  document.getElementById('sd-plan-apply')?.addEventListener('click', applySuggestedLengths);
  document.getElementById('sd-plan-reset')?.addEventListener('click', resetPlan);
  document.getElementById('sd-plan-autolay')?.addEventListener('click', autoLayout);
  document.getElementById('sd-plan-svg')?.addEventListener('click', exportPlanSvg);
  document.getElementById('sd-plan-png')?.addEventListener('click', exportPlanPng);
  document.getElementById('sd-plan-add-tray-h')?.addEventListener('click', () => addTray('h'));
  document.getElementById('sd-plan-add-tray-v')?.addEventListener('click', () => addTray('v'));
  document.getElementById('sd-plan-auto-trays')?.addEventListener('click', autoGenerateTrays);
  document.getElementById('sd-plan-fit-all')?.addEventListener('click', fitAllTrays);
  document.getElementById('sd-plan-fit-content')?.addEventListener('click', fitPlanToContent);
  document.getElementById('sd-plan-undo')?.addEventListener('click', undoPlan);
  document.getElementById('sd-plan-redo')?.addEventListener('click', redoPlan);
  // v0.59.295: zoom/pan только мышью (кнопки убраны). Двойной клик = 1:1.
  const planWrap = document.querySelector('.sd-plan-wrap');
  if (planWrap) {
    // Ctrl+wheel zoom
    planWrap.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setPlanZoom(planZoom * delta, { clientX: e.clientX, clientY: e.clientY });
    }, { passive: false });
    // Middle-button / Shift+LMB grab-pan
    let panStart = null;
    planWrap.addEventListener('mousedown', e => {
      const isMiddle = e.button === 1;
      const isShiftLeft = e.button === 0 && e.shiftKey;
      // Shift+LMB на пустом канвасе (не на стойке/кнопке)
      const onRack = e.target.closest('.sd-plan-rack, .sd-plan-chip, button, input');
      if (!(isMiddle || (isShiftLeft && !onRack))) return;
      e.preventDefault();
      panStart = { x: e.clientX, y: e.clientY, sl: planWrap.scrollLeft, st: planWrap.scrollTop };
      planWrap.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      if (!panStart) return;
      planWrap.scrollLeft = panStart.sl - (e.clientX - panStart.x);
      planWrap.scrollTop  = panStart.st - (e.clientY - panStart.y);
    });
    window.addEventListener('mouseup', () => {
      if (!panStart) return;
      panStart = null;
      planWrap.style.cursor = '';
    });
    // Dblclick на пустом месте канваса — reset зума на 1:1
    planWrap.addEventListener('dblclick', e => {
      const onItem = e.target.closest('.sd-plan-rack, .sd-plan-tray, .sd-plan-chip, button, input');
      if (onItem) return;
      setPlanZoom(1);
    });
    // v0.59.318: клавиатурные шорткаты при активном focusRackId.
    // R — повернуть на 90°, Delete — убрать со схемы, стрелки — nudge на 1 клетку.
    // Игнорируем, когда фокус в <input> / <textarea> / contenteditable.
    document.addEventListener('keydown', e => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable);
      // v0.59.319: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo на plan-view.
      // Только если активна вкладка plan (sd-plan-wrap визуально показан).
      const planVisible = !!document.querySelector('.sd-plan-wrap')?.offsetParent;
      if (!typing && planVisible && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
          if (e.shiftKey) redoPlan(); else undoPlan();
          e.preventDefault(); return;
        }
        if (e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н') {
          redoPlan(); e.preventDefault(); return;
        }
      }
      if (!focusRackId) return;
      if (typing) return;
      const p2 = getPlan();
      const cur = p2.positions[focusRackId];
      if (!cur) return;
      const r = getRacks().find(x => x.id === focusRackId);
      if (!r) return;
      const [wF, hF] = rackSizeCells(r, p2, cur.rot || 0);
      let handled = false;
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        const nextRot = ((+cur.rot || 0) + 90) % 360;
        const [nwF, nhF] = rackSizeCells(r, p2, nextRot);
        cur.rot = nextRot;
        cur.x = Math.max(0, Math.min(PLAN_COLS - nwF, cur.x));
        cur.y = Math.max(0, Math.min(PLAN_ROWS - nhF, cur.y));
        savePlan(p2); renderPlan(); handled = true;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        delete p2.positions[focusRackId];
        focusRackId = null;
        savePlan(p2); renderPlan(); handled = true;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowLeft')  cur.x = Math.max(0, cur.x - step);
        if (e.key === 'ArrowRight') cur.x = Math.min(PLAN_COLS - wF, cur.x + step);
        if (e.key === 'ArrowUp')    cur.y = Math.max(0, cur.y - step);
        if (e.key === 'ArrowDown')  cur.y = Math.min(PLAN_ROWS - hF, cur.y + step);
        savePlan(p2); renderPlan(); handled = true;
      }
      if (handled) e.preventDefault();
    });
  }
  document.getElementById('sd-export-json')?.addEventListener('click', exportProjectJson);
  const importBtn = document.getElementById('sd-import-json');
  const importFile = document.getElementById('sd-import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) importProjectJson(f);
      e.target.value = '';
    });
  }
  document.getElementById('sd-plan-step')?.addEventListener('change', e => {
    // v0.59.591: при смене шага сетки физические габариты плана и положения
    // объектов сохраняются (юзер: «шаг сетки не должен менять габариты
    // плана, только размер сетки»). Реализация:
    //   1. PLAN_CELL_PX = step × PIXELS_PER_METER — размер клетки на экране
    //      МЕНЬШЕ при меньшем шаге (визуально плотнее сетка).
    //   2. PLAN_COLS / PLAN_ROWS пересчитываются так, чтобы canvas px размер
    //      = CANVAS_AREA_M × PIXELS_PER_METER (стабилен).
    //   3. Все позиции (cells) умножаются на factor=oldStep/newStep так,
    //      что cells × newStep = old_cells × oldStep ⇒ физическая координата
    //      в метрах сохраняется.
    const p = getPlan();
    const oldStep = +p.step || 0.6;
    const newStep = Math.max(0.05, +e.target.value || PLAN_DEFAULT.step);
    if (oldStep !== newStep) {
      const factor = oldStep / newStep;
      for (const id of Object.keys(p.positions || {})) {
        const pos = p.positions[id];
        if (pos) {
          pos.x = (+pos.x || 0) * factor;
          pos.y = (+pos.y || 0) * factor;
        }
      }
      for (const t of (p.trays || [])) {
        t.x = (+t.x || 0) * factor;
        t.y = (+t.y || 0) * factor;
        t.len = (+t.len || 0) * factor;
      }
    }
    p.step = newStep;
    savePlan(p);
    renderPlan();
  });
  document.getElementById('sd-plan-kroute')?.addEventListener('change', e => {
    const p = getPlan();
    p.kRoute = Math.max(1.0, +e.target.value || PLAN_DEFAULT.kRoute);
    savePlan(p);
    updatePlanInfo();
  });
  // v0.59.589: toggle видимости overlay-линий + переключатель провисания.
  const toggleVisBtn = document.getElementById('sd-links-toggle-vis');
  const updateToggleLabel = () => {
    if (toggleVisBtn) toggleVisBtn.textContent = linksOverlayVisible ? '👁 Скрыть связи' : '👁 Показать связи';
  };
  updateToggleLabel();
  toggleVisBtn?.addEventListener('click', () => {
    linksOverlayVisible = !linksOverlayVisible;
    try { localStorage.setItem('scs-design.linksOverlay.visible.v1', linksOverlayVisible ? '1' : '0'); } catch {}
    updateToggleLabel();
    drawLinkOverlay();
  });
  // Hotkey 'L' переключает видимость overlay-связей (если фокус не в инпуте).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'l' && e.key !== 'L') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleVisBtn?.click();
  });
  // v0.59.593: Esc снимает выделение A/B; Enter создаёт связь если выбрана пара.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'Escape' && (linkStart || linkEnd)) {
      e.preventDefault();
      linkStart = null; linkEnd = null;
      _refreshSelectionUI();
    } else if (e.key === 'Enter' && linkStart && linkEnd) {
      e.preventDefault();
      _createLinkFromSelection();
    }
  });
  const sagCb = document.getElementById('sd-links-sag');
  if (sagCb) {
    sagCb.checked = linksSagEnabled;
    sagCb.addEventListener('change', e => {
      linksSagEnabled = !!e.target.checked;
      try { localStorage.setItem('scs-design.linksOverlay.sag.v1', linksSagEnabled ? '1' : '0'); } catch {}
      drawLinkOverlay();
    });
  }
  window.addEventListener('storage', (e) => {
    if ([LS_RACK, LS_CONTENTS, LS_RACKTAGS, LS_LINKS].includes(e.key)) renderLinksTab();
  });
  // пересчёт линий при скролле ряда стоек, скролле юнитов внутри карточки и ресайзе окна
  document.getElementById('sd-racks-row')?.addEventListener('scroll', scheduleOverlay, true);
  window.addEventListener('resize', scheduleOverlay);

  // v0.59.360: sync «выбран rack-узел в схеме → подсветка стойки на плане».
  // Родитель (Конструктор схем) шлёт postMessage с schemeNodeId; находим
  // соответствующую размещённую стойку и flash'им её в plan-canvas.
  window.addEventListener('message', e => {
    const d = e && e.data;
    if (!d || d.type !== 'rs-scheme-select-rack') return;
    const canvas = document.getElementById('sd-plan-canvas');
    if (!canvas) return;
    // снять предыдущую подсветку
    canvas.querySelectorAll('.sd-plan-rack.scheme-flash').forEach(el => el.classList.remove('scheme-flash'));
    if (!d.schemeNodeId) return;
    // найти все материализованные стойки этого узла (может быть несколько при count>1)
    const racks = getProjectInstances().filter(r => r.schemeNodeId === d.schemeNodeId);
    if (!racks.length) return;
    let scrolled = false;
    racks.forEach(r => {
      const el = canvas.querySelector(`.sd-plan-rack[data-id="${CSS.escape(r.id)}"]`);
      if (el) {
        el.classList.add('scheme-flash');
        if (!scrolled && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          scrolled = true;
        }
      }
    });
  });
});
