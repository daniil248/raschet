#!/usr/bin/env bash
# ============================================================================
# GE Tools — ДВОЙНОЙ ДЕПЛОЙ (git + сервер Timeweb). ОБЯЗАТЕЛЬНО оба шага,
# рассинхрона быть не должно (memory:feedback_dual_deploy_server).
#   1) git push origin main  (источник истории)
#   2) rsync рабочего дерева в каталог getools/ на сервере (раздаётся nginx)
# Доступ читается ВНЕ репо: $CLAUDE_PROJ/server-access.env (не в git).
# Использование:  bash tools/deploy.sh ["сообщение коммита"]
#   - без сообщения: только синхронизирует уже закоммиченное (git push + rsync)
#   - с сообщением:  git add -A (без секретов) + commit + push + rsync
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# server-access.env вне репо (Claude project dir). Можно переопределить env-ом.
ACCESS_FILE="${GETOOLS_ACCESS_FILE:-$HOME/.claude/projects/D--Works-ClaudeProject-raschet/server-access.env}"

MSG="${1:-}"

# --- Шаг 1: git ---------------------------------------------------------------
if [ -n "$MSG" ]; then
  # Никогда не коммитим секреты — они в .gitignore; add -A безопасен.
  git add -A
  git commit -m "$MSG" || echo "[deploy] нет изменений для коммита"
fi
echo "[deploy] git push origin main..."
git push origin main

# --- Шаг 2: сервер ------------------------------------------------------------
if [ ! -f "$ACCESS_FILE" ]; then
  echo "[deploy] ⚠ SERVER STEP ОЖИДАЕТ: нет $ACCESS_FILE"
  echo "[deploy]   git запушен; сервер НЕ синхронизирован (SSH-доступ не задан)."
  echo "[deploy]   Заполните server-access.env и повторите для синка сервера."
  exit 0
fi
# shellcheck disable=SC1090
set -a; . "$ACCESS_FILE"; set +a

if [ -z "${SERVER_HOST:-}" ] || [ -z "${SERVER_USER:-}" ]; then
  echo "[deploy] ⚠ SERVER STEP ОЖИДАЕТ: SERVER_HOST/SERVER_USER пусты в access-файле."
  echo "[deploy]   git запушен; сервер НЕ синхронизирован."
  exit 0
fi

PORT="${SERVER_PORT:-22}"
DEST="${DEPLOY_PATH:-getools}"
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new"
RSH="ssh $SSH_OPTS"
if [ -n "${SERVER_SSH_KEY:-}" ]; then
  RSH="ssh -i $SERVER_SSH_KEY $SSH_OPTS"
fi

echo "[deploy] rsync → ${SERVER_USER}@${SERVER_HOST}:~/${DEST}/ ..."
# Заливаем РАБОЧЕЕ ДЕРЕВО (не .git/секреты/локальное). Сервер раздаёт nginx-ом
# каталог getools/. --delete: сервер строго = git (без рассинхрона).
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.deploy/credentials.env' \
  --exclude 'server-access.env' \
  --exclude 'node_modules/' \
  --exclude 'server/node_modules/' \
  --exclude '*.log' \
  --exclude 'tmp/' \
  --exclude '__pycache__/' \
  -e "$RSH" \
  "$REPO_ROOT/" "${SERVER_USER}@${SERVER_HOST}:~/${DEST}/"

echo "[deploy] ✓ git + сервер синхронизированы (getools/ = main)."
