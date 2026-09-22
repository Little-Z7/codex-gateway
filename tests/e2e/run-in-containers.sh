#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../.." && pwd)"
compose_file="$script_dir/docker-compose.yml"
project_name="${E2E_COMPOSE_PROJECT_NAME:-codex-gateway-e2e}"
compose=(docker compose --ansi never --progress quiet -p "$project_name" -f "$compose_file")

if [ "${1:-}" = "--turn" ]; then
  export E2E_CODEX_TURN=1
  shift
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

export E2E_UID="${E2E_UID:-12345}"
export E2E_GID="${E2E_GID:-12345}"
# Optional outbound HTTP(S) proxy for sandboxes/CI runners with no direct internet route. Feeds
# the same product config item gateway-under-test uses in real deployments
# (CODEX_GATEWAY_OUTBOUND_PROXY, see deploy/gateway-entrypoint.sh) plus the ssh-target-mfa
# fixture's build-time Codex release download (tests/e2e/docker-compose.yml). Empty by default --
# behavior is unchanged.
export E2E_OUTBOUND_PROXY="${E2E_OUTBOUND_PROXY:-}"
export E2E_CODEX_HOME="${E2E_CODEX_HOME:-$HOME/.codex}"
# Keep the MFA fixture on the same Codex version as the application protocol gate. The dedicated
# legacy fixtures own upgrade coverage; mixing a 130 MB upgrade into the MFA browser flow makes
# authentication timing depend on installation work that the test is not exercising.
export E2E_SUPPORTED_CODEX_VERSION="$(
  node --experimental-strip-types --input-type=module -e \
    "import('./server/utils/gateway/infra/codex/codex-version.ts').then(({ SUPPORTED_CODEX_VERSION }) => process.stdout.write(SUPPORTED_CODEX_VERSION))"
)"

# Per-user workspace containers are created by the gateway through the host Docker socket, so
# the shared auth dir lives on the host and leftovers are reaped here rather than by compose.
export E2E_SHARED_AUTH_DIR="${E2E_SHARED_AUTH_DIR:-$(mktemp -d /tmp/codex-gateway-e2e-auth.XXXXXX)}"
export E2E_SHARED_DATA_DIR="${E2E_SHARED_DATA_DIR:-$(mktemp -d /tmp/codex-gateway-e2e-data.XXXXXX)}"
mkdir -p "$E2E_SHARED_AUTH_DIR" "$E2E_SHARED_DATA_DIR"
# A pre-existing file in the shared dir lets the isolation spec prove two user containers can
# read each other's writes (PUT /api/remote/files requires an existing file).
echo "e2e-shared-seed" > "$E2E_SHARED_DATA_DIR/e2e-shared-seed.txt"
{ [ "$(id -u)" -eq 0 ] && chown -R 1000:1000 "$E2E_SHARED_DATA_DIR" \
  || sudo -n chown -R 1000:1000 "$E2E_SHARED_DATA_DIR" 2>/dev/null || true; }

# On hosts with a real Codex login, seed the shared auth dir so provisioned containers are
# immediately usable. Best effort: missing auth or permission errors must not abort the run.
export E2E_SHARED_AUTH_PRESENT=0
if [ -f "$E2E_CODEX_HOME/auth.json" ]; then
  if cp "$E2E_CODEX_HOME/auth.json" "$E2E_SHARED_AUTH_DIR/auth.json" 2>/dev/null \
    && chmod 600 "$E2E_SHARED_AUTH_DIR/auth.json" 2>/dev/null \
    && { [ "$(id -u)" -eq 0 ] && chown 1000:1000 "$E2E_SHARED_AUTH_DIR/auth.json" || sudo -n chown 1000:1000 "$E2E_SHARED_AUTH_DIR/auth.json" 2>/dev/null || true; }; then
    export E2E_SHARED_AUTH_PRESENT=1
  fi
fi

# Optional custom model provider: set E2E_MODEL_PROVIDER_API_KEY to run turn-dependent specs
# against an API-key provider instead of a shared ChatGPT login. Never echoed or committed.
if [ -n "${E2E_MODEL_PROVIDER_API_KEY:-}" ]; then
  export E2E_MODEL_PROVIDER=custom
  export E2E_MODEL_PROVIDER_ID="${E2E_MODEL_PROVIDER_ID:-ollama-cloud}"
  export E2E_MODEL_PROVIDER_BASE_URL="${E2E_MODEL_PROVIDER_BASE_URL:-https://ollama.com/v1}"
  export E2E_MODEL_PROVIDER_MODEL="${E2E_CODEX_MODEL:-gpt-oss:120b}"
  export E2E_MODEL_PROVIDER_WEB_SEARCH=disabled
  export E2E_CODEX_MODEL="$E2E_MODEL_PROVIDER_MODEL"
fi

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    "${compose[@]}" logs --no-color \
      gateway-under-test ssh-target ssh-target-legacy-node ssh-target-npm-codex \
      ssh-target-mfa >&2 || true
  fi
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  # Provisioned user containers live outside the compose project; remove them plus their volumes.
  for container in $(docker ps -aq --filter "label=codex-gateway.managed=true" \
    --filter "name=codex-e2e-user-"); do
    docker rm -f "$container" >/dev/null 2>&1 || true
  done
  for volume in $(docker volume ls -q --filter "name=codex-e2e-user-"); do
    docker volume rm -f "$volume" >/dev/null 2>&1 || true
  done
  rm -rf "$E2E_SHARED_AUTH_DIR" "$E2E_SHARED_DATA_DIR"
}
trap cleanup EXIT

docker build -t codex-gateway-e2e-user:latest \
  --build-arg "CODEX_CLI_VERSION=$E2E_SUPPORTED_CODEX_VERSION" \
  "$project_dir/deploy/user-container" >/dev/null

"${compose[@]}" build --quiet \
  build-runner ssh-target ssh-target-legacy-node ssh-target-npm-codex ssh-target-mfa
# The application server and browser runner use separate 2 GiB cgroups (the build runner gets 4
# GiB). Browser preview now routes same-origin through the gateway container itself (no separate
# ingress service), so only gateway-under-test needs to come up before the test runner.
"${compose[@]}" run --rm build-runner \
  bash -lc 'rm -rf .output .nuxt .data-e2e/* /e2e-output/* && pnpm exec nuxt build --logLevel=silent --extends ./tests/e2e/nuxt-layer && cp -a .output/. /e2e-output/ && node scripts/create-user.mjs --admin "$E2E_GATEWAY_USERNAME" "$E2E_GATEWAY_PASSWORD" && node scripts/create-user.mjs "$E2E_GATEWAY_MEMBER_USERNAME" "$E2E_GATEWAY_MEMBER_PASSWORD"'
"${compose[@]}" up -d --wait \
  gateway-under-test
"${compose[@]}" run --rm test-runner \
  bash -lc 'exec pnpm exec playwright test --reporter=dot "$@"' \
  e2e "$@"
