/**
 * Raschet Cloud Functions
 * =========================================================================
 * Collaboration C.9 — email-нотификации запросов доступа.
 *
 * Стратегия: используем Firebase-расширение **Trigger Email**
 * (firebase-ext/firestore-send-email), которое читает документы из
 * указанной коллекции (по умолчанию `mail`) и отправляет их через SMTP.
 * Наши триггеры НЕ шлют письма напрямую — они пишут задания в коллекцию
 * `mail`, а расширение делает рассылку. Это избавляет от необходимости
 * хранить SMTP-секреты в коде Functions.
 *
 * Срабатывает:
 *   1. onAccessRequestCreated  — владельцу проекта приходит письмо
 *      «Пользователь X запросил доступ к проекту».
 *   2. onProjectMemberAdded    — приглашённому приходит письмо
 *      «Вам открыли доступ к проекту …» (при добавлении members.{uid}).
 *   3. onRevisionCreated       — (опционально) уведомление владельца
 *      о больших снапшотах от других участников (пока не подписано).
 *
 * Установка — см. FUNCTIONS_SETUP.md.
 * =========================================================================
 */

const {onDocumentCreated, onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Публичный URL приложения (GitHub Pages). Можно переопределить через
// firebase functions:config:set app.url="…" + process.env.APP_URL.
const APP_URL = process.env.APP_URL || 'https://daniil248.github.io/raschet/';

// «От кого» для писем. Реальный адрес настраивается в расширении
// Trigger Email (SMTP sender).
const FROM_NAME = 'Raschet';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 1. Новый запрос доступа → письмо владельцу проекта.
 * Триггер: onCreate на accessRequests/{id}.
 */
exports.onAccessRequestCreated = onDocumentCreated(
  'accessRequests/{reqId}',
  async (event) => {
    const req = event.data?.data();
    if (!req || !req.ownerId || !req.projectId) return;

    // Получаем email владельца: сначала из members проекта, затем из
    // отдельной коллекции users (если её поддерживаете).
    let ownerEmail = null;
    let ownerName = '';
    try {
      const proj = await db.collection('projects').doc(req.projectId).get();
      if (!proj.exists) return;
      const pd = proj.data();
      // users collection — опциональна. Если её нет, полагаемся на
      // поле ownerEmail в самом проекте.
      if (pd.ownerEmail) ownerEmail = pd.ownerEmail;
      if (pd.ownerName) ownerName = pd.ownerName;
      if (!ownerEmail) {
        const u = await db.collection('users').doc(req.ownerId).get().catch(() => null);
        if (u && u.exists) {
          ownerEmail = u.data().email || null;
          ownerName = u.data().name || '';
        }
      }
      if (!ownerEmail) {
        console.warn('[onAccessRequestCreated] ownerEmail не найден для', req.projectId);
        return;
      }

      const projectName = pd.name || 'проект';
      const link = `${APP_URL}?project=${encodeURIComponent(req.projectId)}`;
      const requester = req.requesterName || req.requesterEmail || 'Пользователь';
      const subject = `Запрос доступа к проекту «${projectName}»`;
      const html = `
        <p>Здравствуйте${ownerName ? ', ' + esc(ownerName) : ''}!</p>
        <p><b>${esc(requester)}</b> (${esc(req.requesterEmail || '')}) запросил доступ
        к вашему проекту <b>«${esc(projectName)}»</b> в роли
        <b>${esc(req.role || 'viewer')}</b>.</p>
        <p>Чтобы подтвердить или отклонить запрос, откройте проект
        по ссылке и зайдите в раздел запросов доступа:</p>
        <p><a href="${link}">${esc(link)}</a></p>
        <p style="color:#888;font-size:12px">— ${esc(FROM_NAME)}</p>`;

      await db.collection('mail').add({
        to: [ownerEmail],
        message: {
          subject,
          html,
        },
      });
    } catch (e) {
      console.error('[onAccessRequestCreated]', e);
    }
  },
);

/**
 * 2. Добавлен участник в members.{uid} → письмо приглашённому.
 * Триггер: onUpdate на projects/{id}. Сравниваем старые и новые
 * ключи members, находим новые uids.
 */
exports.onProjectMemberAdded = onDocumentUpdated(
  'projects/{projectId}',
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const mb = before.members || {};
    const ma = after.members || {};
    const addedUids = Object.keys(ma).filter(uid => !mb[uid]);
    if (!addedUids.length) return;

    const projectName = after.name || 'проект';
    const link = `${APP_URL}?project=${encodeURIComponent(event.params.projectId)}`;

    for (const uid of addedUids) {
      const m = ma[uid];
      const to = m.email;
      if (!to) continue;
      const name = m.name || '';
      const role = m.role || 'viewer';
      const subject = `Вам открыт доступ к проекту «${projectName}»`;
      const html = `
        <p>Здравствуйте${name ? ', ' + esc(name) : ''}!</p>
        <p>Вам предоставлен доступ к проекту <b>«${esc(projectName)}»</b>
        в роли <b>${esc(role)}</b>.</p>
        <p>Открыть проект:</p>
        <p><a href="${link}">${esc(link)}</a></p>
        <p style="color:#888;font-size:12px">— ${esc(FROM_NAME)}</p>`;

      await db.collection('mail').add({
        to: [to],
        message: {subject, html},
      });
    }
  },
);
