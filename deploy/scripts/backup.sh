#!/usr/bin/env bash
# Consistent snapshot of gateway state into data/backups/<timestamp>/:
#   - SQLite via the online `.backup` API (safe while the gateway runs)
#   - shared auth dir (CODEX_GATEWAY_SHARED_AUTH_DIR)
#   - every codex-user-*-home Docker volume as a tar archive
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

# shellcheck source=/dev/null
[ -f .env ] && set -a && . ./.env && set +a

DB_PATH="${CODEX_GATEWAY_DB_PATH:-$ROOT/data/codex-gateway.db}"
AUTH_DIR="${CODEX_GATEWAY_SHARED_AUTH_DIR:-$ROOT/data/shared-auth}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$ROOT/data/backups/$STAMP"
mkdir -p "$DEST"

# SQLite consistent snapshot. node:sqlite has no backup API yet; use the docker container's
# sqlite3 when available, else a local sqlite3, else node eval with WAL checkpoint+fs copy.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST/codex-gateway.db'"
elif docker exec codex-gateway sh -c "command -v sqlite3" >/dev/null 2>&1; then
  docker exec codex-gateway sqlite3 /data/codex-gateway.db ".backup '/tmp/backup.db'" \
    && docker cp codex-gateway:/tmp/backup.db "$DEST/codex-gateway.db"
else
  # Fallback: checkpoint WAL then copy (consistent enough for a stopped/quiet gateway).
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  ' "$DB_PATH"
  cp "$DB_PATH" "$DEST/codex-gateway.db"
fi
echo "database -> $DEST/codex-gateway.db"

if [ -d "$AUTH_DIR" ]; then
  mkdir -p "$DEST/shared-auth"
  cp -a "$AUTH_DIR/." "$DEST/shared-auth/"
  echo "shared auth -> $DEST/shared-auth"
fi

mkdir -p "$DEST/volumes"
for vol in $(docker volume ls --format '{{.Name}}' | grep '^codex-user-.*-home$' || true); do
  docker run --rm -v "$vol:/src:ro" -v "$DEST/volumes:/out" alpine \
    tar -czf "/out/$vol.tar.gz" -C /src .
  echo "volume $vol -> volumes/$vol.tar.gz"
done

echo "backup complete: $DEST"
