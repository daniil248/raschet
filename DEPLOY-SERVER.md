# GE Tools — развёртывание на сервере Timeweb (VPS) + уход от Firebase

> Двойной деплой ОБЯЗАТЕЛЕН: каждое изменение → git **и** сервер
> (`getools/`). Рассинхрона быть не должно (memory:dual_deploy_server).
> Секреты НИКОГДА не в git: реальные доступы —
> `~/.claude/projects/D--Works-ClaudeProject-raschet/server-access.env`.

## Цель
Заменить GitHub Pages + Firebase на самостоятельный VPS (Timeweb):
- статика GE Tools (nginx, каталог `getools/`);
- PostgreSQL (все данные — вместо Firestore);
- Node-бэкенд `server/` (Auth вместо Firebase Auth, Email вместо
  Cloud Functions);
- git-история — `origin` остаётся, плюс зеркало рабочего дерева на сервер.

## Стек: VPS · nginx · PostgreSQL · Node 20 · systemd · TLS · UFW

## A. Провижининг VPS (один раз, при первом SSH)
```bash
# 1. Базовое
apt update && apt -y upgrade
apt -y install nginx postgresql nodejs npm git rsync ufw certbot python3-certbot-nginx
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# 2. PostgreSQL
sudo -u postgres psql -c "CREATE USER getools WITH PASSWORD '<DB_PASSWORD>';"
sudo -u postgres psql -c "CREATE DATABASE getools OWNER getools;"
psql "postgres://getools:<DB_PASSWORD>@127.0.0.1:5432/getools" -f ~/getools/server/db/schema.sql

# 3. Каталог проекта (раздаётся nginx)
mkdir -p ~/getools           # сюда rsync-ит tools/deploy.sh

# 4. Backend
cd ~/getools/server && npm ci --omit=dev
cp .env.example .env && nano .env   # DATABASE_URL/JWT_SECRET/SMTP/APP_URL
```

### systemd-сервис бэкенда (`/etc/systemd/system/getools-api.service`)
```ini
[Unit]
Description=GE Tools API
After=network.target postgresql.service
[Service]
WorkingDirectory=/root/getools/server
EnvironmentFile=/root/getools/server/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=root
[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now getools-api
```

### nginx (`/etc/nginx/sites-available/getools`)
```nginx
server {
  listen 80; server_name <DOMAIN>;
  root /root/getools; index index.html;
  gzip on; gzip_types text/css application/javascript application/json image/svg+xml;
  location /api/ { proxy_pass http://127.0.0.1:8090; proxy_set_header Host $host; }
  location ~* \.(js|css)$ { add_header Cache-Control "public,max-age=3600"; try_files $uri =404; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location = /changelog.html { add_header Cache-Control "no-cache"; }
  location / { try_files $uri $uri/ =404; }
}
```
```bash
ln -s /etc/nginx/sites-available/getools /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d <DOMAIN>      # TLS
```

## B. Деплой (каждый раз — ОБА шага)
`bash tools/deploy.sh "сообщение"` →
1. `git add -A` (секреты в .gitignore) + commit + `git push origin main`;
2. `rsync --delete` рабочего дерева в `~/getools/` (сервер строго = git).

Без SSH-доступа скрипт делает только git и явно пишет
«SERVER STEP ОЖИДАЕТ». После заполнения `server-access.env` —
повторный запуск синхронизирует сервер (catch-up до git).

## C. Миграция Firebase → сервер (фазами, при живом сервере)
1. **Данные (Firestore→Postgres).** Клиент: транспорт
   project-storage → HTTP `/api/kv` (GET/PUT/prefix). Экспорт
   текущего Firestore (admin SDK) → import в `kv`/`projects`.
   schema-id `raschet.project/1` НЕ меняется.
2. **Auth (Firebase Auth→сервер).** `/api/auth/*` (email+пароль
   готов). Google-вход (как было через Gmail) — Google OAuth
   (GOOGLE_CLIENT_ID/SECRET), добавляется на этом шаге.
3. **Email (Cloud Functions→SMTP).** `/api/mail` + mail_queue +
   nodemailer; `functions/` выводится из эксплуатации.
4. **Клиентский cutover** — переключение `firebase-config.js`/
   `shared/auth.js`/`js/projects.js` на серверные эндпоинты делается
   ОДНИМ согласованным деплоем ТОЛЬКО когда сервер живой и проверен
   (иначе ломается прод). До этого клиент остаётся на Firebase.

## D. Чек-лист первого SSH-подключения
- [ ] Заполнить `server-access.env` (вне git).
- [ ] A: провижининг (nginx/PG/Node/systemd/TLS/UFW).
- [ ] `psql -f server/db/schema.sql`.
- [ ] `bash tools/deploy.sh` → сервер = git (catch-up).
- [ ] `curl https://<DOMAIN>/api/health` = ok.
- [ ] Затем фазы C1→C4 (миграция + cutover), по одному с verify.
