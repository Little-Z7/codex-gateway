#!/usr/bin/env bash
# Restore a backup created by backup.sh. Stops the gateway first; run from the repo root.
# Usage: ./deploy/scripts/restore.sh data/backups/<timestamp>
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

BACKUP_DIR="$(realpath "${1:?usage: restore.sh data/backups/<timestamp>}")"
[ -d "$BACKUP_DIR" ] || { echo "backup dir not found: $BACKUP_DIR"; exit 1; }

# shellcheck source=/dev/null
[ -f .env ] && set -a && . ./.env && set +a

DB_PATH="${CODEX_GATEWAY_DB_PATH:-$ROOT/data/codex-gateway.db}"
AUTH_DIR="${CODEX_GATEWAY_SHARED_AUTH_DIR:-$ROOT/data/shared-auth}"

docker compose stop codex-gateway 2>/dev/null || true

if [ -f "$BACKUP_DIR/codex-gateway.db" ]; then
  mkdir -p "$(dirname "$DB_PATH")"
  cp "$BACKUP_DIR/codex-gateway.db" "$DB_PATH"
  rm -f "$DB_PATH-wal" "$DB_PATH-shm"
  echo "database restored"
fi

if [ -d "$BACKUP_DIR/shared-auth" ]; then
  mkdir -p "$AUTH_DIR"
  cp -a "$BACKUP_DIR/shared-auth/." "$AUTH_DIR/"
  echo "shared auth restored"
fi

if [ -d "$BACKUP_DIR/volumes" ]; then
  for archive in "$BACKUP_DIR"/volumes/codex-user-*-home.tar.gz; do
    [ -f "$archive" ] || continue
    vol="$(basename "$archive" .tar.gz)"
    docker volume create "$vol" >/dev/null
    docker run --rm -v "$vol:/dst" -v "$BACKUP_DIR/volumes:/in:ro" alpine \
      sh -c 'cd /dst && tar -xzf "/in/'"$vol"'.tar.gz"'
    echo "volume $vol restored"
  done
fi

echo "restore complete; restart with: docker compose up -d codex-gateway"
