#!/usr/bin/env bash
# One-time shared Codex login. Writes auth.json into the shared auth directory so every
# provisioned user container sees the same account.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

AUTH_DIR="${CODEX_GATEWAY_SHARED_AUTH_DIR:-$ROOT/data/shared-auth}"
IMAGE="${CODEX_GATEWAY_USER_IMAGE:-codex-gateway-user:latest}"
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"

run_codex() {
  docker run --rm -it --entrypoint sh --user 1000:1000 \
    -v "$AUTH_DIR":/srv/codex-auth \
    -e CODEX_HOME=/srv/codex-auth \
    -e HOME=/tmp \
    "$IMAGE" -lc "$*"
}

if run_codex "codex login --help" 2>/dev/null | grep -q -- "--device-auth"; then
  LOGIN_CMD="codex login --device-auth"
else
  LOGIN_CMD="codex login"
fi

run_codex "$LOGIN_CMD && codex login status"

echo "shared auth ready at $AUTH_DIR/auth.json"
