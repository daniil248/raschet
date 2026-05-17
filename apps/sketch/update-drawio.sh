#!/usr/bin/env bash
# =============================================================================
# update-drawio.sh — обновление self-hosted drawio из github jgraph/drawio.
# =============================================================================
# Скачивает релиз с https://github.com/jgraph/drawio (тегированную версию),
# извлекает webapp в sketch/drawio-app/ и фиксирует версию в drawio-app/VERSION.
#
# Использование:
#   bash sketch/update-drawio.sh             # latest release
#   bash sketch/update-drawio.sh v24.7.17    # конкретный тег
#
# После запуска drawio-app/ содержит index.html + js/ + styles/ + ...
# Sketch модуль (sketch.js::resolveDrawioSrc) автоматически использует
# self-hosted версию вместо embed.diagrams.net.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/drawio-app"

# Тег: аргумент или latest.
TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "🔍 Получаем latest release tag из github jgraph/drawio…"
  TAG=$(curl -s https://api.github.com/repos/jgraph/drawio/releases/latest \
    | grep -oP '"tag_name": "\K[^"]+' || true)
  if [ -z "$TAG" ]; then
    echo "❌ Не удалось получить latest tag. Передайте явно: bash update-drawio.sh v24.7.17"
    exit 1
  fi
fi

echo "📦 drawio version: $TAG"

# URL к tarball релиза.
TARBALL="https://github.com/jgraph/drawio/archive/refs/tags/$TAG.tar.gz"
TMP_DIR=$(mktemp -d)
trap "rm -rf '$TMP_DIR'" EXIT

echo "⬇  Скачиваем $TARBALL…"
curl -fL "$TARBALL" -o "$TMP_DIR/drawio.tar.gz"

echo "📂 Распаковываем…"
tar -xzf "$TMP_DIR/drawio.tar.gz" -C "$TMP_DIR"

# Папка после распаковки: drawio-${TAG#v} (без префикса 'v')
EXTRACTED_DIR=$(ls -d "$TMP_DIR"/drawio-* | head -n 1)
WEBAPP_SRC="$EXTRACTED_DIR/src/main/webapp"

if [ ! -d "$WEBAPP_SRC" ]; then
  echo "❌ Не найден $WEBAPP_SRC в распакованном архиве"
  exit 1
fi

echo "🗑  Очищаем старую версию (если есть)…"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

echo "📋 Копируем webapp ($WEBAPP_SRC → $APP_DIR)…"
cp -R "$WEBAPP_SRC/." "$APP_DIR/"

# Записываем версию.
echo "$TAG" > "$APP_DIR/VERSION"
echo "Updated: $(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$APP_DIR/VERSION"
echo "Source: https://github.com/jgraph/drawio/releases/tag/$TAG" >> "$APP_DIR/VERSION"

# Размер.
SIZE=$(du -sh "$APP_DIR" | cut -f1)
FILES=$(find "$APP_DIR" -type f | wc -l)

echo ""
echo "✅ drawio $TAG установлен в $APP_DIR"
echo "   Файлов: $FILES, размер: $SIZE"
echo ""
echo "Sketch модуль автоматически подхватит self-hosted версию"
echo "(см. sketch/sketch.js::resolveDrawioSrc — HEAD-check на ./drawio-app/index.html)."
echo ""
echo "Не забудьте закоммитить изменения:"
echo "  git add sketch/drawio-app"
echo "  git commit -m \"sketch: update drawio to $TAG\""
