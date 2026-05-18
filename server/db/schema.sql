-- ============================================================================
-- GE Tools — серверная БД (PostgreSQL). Замена Firebase: данные + Auth + Email.
-- Принцип: клиентский шов project-storage.js (ключ → JSON) маппится 1:1 на
-- таблицу kv (owner_uid, k, v JSONB) — projectLoad/Save = GET/PUT по ключу.
-- Совместный доступ (бывш. Firestore project-doc + members) — таблица
-- projects. Письма (бывш. Cloud Functions Trigger Email) — mail_queue.
-- schema-id экспортного JSON НЕ меняется (raschet.project/1, wire-format).
-- Применяется на сервере при первом SSH-подключении (psql -f schema.sql).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- Пользователи (замена Firebase Auth) -----------------------------------
CREATE TABLE IF NOT EXISTS users (
  uid          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email        TEXT UNIQUE NOT NULL,
  name         TEXT,
  pass_hash    TEXT,                 -- bcrypt/scrypt; NULL если только OAuth
  google_sub   TEXT UNIQUE,          -- Google OAuth subject
  photo        TEXT,                 -- аватар из Google-профиля
  is_internal  BOOLEAN NOT NULL DEFAULT FALSE,
  role         TEXT,                 -- internal RBAC (manager/gip/engineer/viewer)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login   TIMESTAMPTZ
);
-- идемпотентно для уже существующей БД (Google-вход добавлен позже):
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,      -- случайный/JWT-jti
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);

-- --- KV-хранилище: зеркало клиентского LS-неймспейса (getools.*) -----------
-- Ключ k — тот же, что строит project-storage.js (projectKey/префиксы).
-- Облачная синхронизация: клиентский транспорт PUT/GET по (owner_uid,k).
CREATE TABLE IF NOT EXISTS kv (
  owner_uid   TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  k           TEXT NOT NULL,
  v           JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, k)
);
CREATE INDEX IF NOT EXISTS idx_kv_prefix ON kv (owner_uid, k text_pattern_ops);

-- --- Проекты (совместный доступ; бывш. Firestore projects/<id>) ------------
-- Метаданные + members для collab. scoped-данные проекта лежат в kv по
-- ключам getools.project.<id>.* владельца/участников (или в отдельной
-- проектной kv — финализируется при миграции реального Firestore).
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  owner_uid   TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- name/kind/entityKind/...
  members     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {uid:{email,roles[],role}}
  visibility  TEXT NOT NULL DEFAULT 'private',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_uid);
CREATE INDEX IF NOT EXISTS idx_projects_members ON projects USING gin (members);

CREATE TABLE IF NOT EXISTS access_requests (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_uid TEXT NOT NULL,
  requester_email TEXT,
  roles        JSONB NOT NULL DEFAULT '["viewer"]'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Очередь писем (замена Cloud Functions Trigger Email) ------------------
CREATE TABLE IF NOT EXISTS mail_queue (
  id          BIGSERIAL PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_html   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|error
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mail_pending ON mail_queue(status) WHERE status='pending';
