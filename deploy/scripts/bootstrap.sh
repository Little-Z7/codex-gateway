#!/usr/bin/env bash
# One-shot deployment bootstrap. Idempotent: safe to re-run; it only fills in what is missing.
# Usage: ./deploy/scripts/bootstrap.sh [admin-username] [admin-password]
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

ADMIN_USERNAME="${1:-admin}"
ADMIN_PASSWORD="${2:-}"

if [ ! -f .env ]; then
  cp .env.example .env
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if grep -q "^CODEX_GATEWAY_CONFIG_SECRET=replace-with-a-stable-random-secret" .env \
  || ! grep -q "^CODEX_GATEWAY_CONFIG_SECRET=" .env; then
  set_env CODEX_GATEWAY_CONFIG_SECRET "$(openssl rand -hex 32)"
  echo "generated CODEX_GATEWAY_CONFIG_SECRET"
fi

# Codex CLI version is pinned to the gateway's supported protocol version.
CODEX_CLI_VERSION="$(
  node --experimental-strip-types --input-type=module -e \
    "import('./server/utils/gateway/infra/codex/codex-version.ts').then(({ SUPPORTED_CODEX_VERSION }) => process.stdout.write(SUPPORTED_CODEX_VERSION))"
)"
set_env CODEX_CLI_VERSION "$CODEX_CLI_VERSION"

mkdir -p data data/shared-auth data/shared
chown 1000:1000 data/shared-auth data/shared
chmod 700 data/shared-auth

# Resolve the shared auth dir to an absolute path for compose bind mounts.
SHARED_AUTH_DIR="$(cd data/shared-auth && pwd)"
SHARED_DATA_DIR="$(cd data/shared && pwd)"
if grep -q '^CODEX_GATEWAY_SHARED_AUTH_DIR=\.' .env; then
  set_env CODEX_GATEWAY_SHARED_AUTH_DIR "$SHARED_AUTH_DIR"
fi
if grep -q '^CODEX_GATEWAY_SHARED_DATA_DIR=\.' .env; then
  set_env CODEX_GATEWAY_SHARED_DATA_DIR "$SHARED_DATA_DIR"
fi

docker network inspect codex-gateway >/dev/null 2>&1 || docker network create codex-gateway

docker compose --profile build-only build codex-gateway-user codex-gateway

if [ -n "$ADMIN_PASSWORD" ]; then
  docker compose run --rm codex-gateway \
    node scripts/create-user.mjs --admin "$ADMIN_USERNAME" "$ADMIN_PASSWORD"
else
  echo "skip admin creation: pass ./deploy/scripts/bootstrap.sh <username> <password> to create one"
fi

docker compose up -d codex-gateway
echo "gateway is up at http://localhost:${CODEX_GATEWAY_PORT:-3000}"
echo "next: ./deploy/scripts/codex-login.sh   # one-time shared Codex login"
