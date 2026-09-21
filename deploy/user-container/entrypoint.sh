#!/usr/bin/env bash
# Runs as root, then execs sshd. Everything here is idempotent so container restarts and
# recreates over a persistent /home/dev volume keep working.
set -euo pipefail

DEV_UID="${DEV_UID:-1000}"
DEV_GID="${DEV_GID:-1000}"
HOME_DIR=/home/dev

# First boot on an empty persistent volume: create the workspace layout and hand it to dev.
mkdir -p "${HOME_DIR}/workspace" "${HOME_DIR}/.codex" "${HOME_DIR}/.ssh"
chown -R "${DEV_UID}:${DEV_GID}" "${HOME_DIR}/workspace" "${HOME_DIR}/.codex" "${HOME_DIR}/.ssh"
chmod 700 "${HOME_DIR}/.ssh"

# The Gateway injects the per-user public key at create time.
if [ -n "${CODEX_GATEWAY_SSH_AUTHORIZED_KEY:-}" ]; then
  printf '%s\n' "${CODEX_GATEWAY_SSH_AUTHORIZED_KEY}" > "${HOME_DIR}/.ssh/authorized_keys"
  chown "${DEV_UID}:${DEV_GID}" "${HOME_DIR}/.ssh/authorized_keys"
  chmod 600 "${HOME_DIR}/.ssh/authorized_keys"
fi

# Shared Codex login: symlink rather than copy — Codex rewrites auth.json in place, so the link
# keeps pointing at the shared file every container can refresh from. Link even when auth.json
# does not exist yet: an admin can provision before running the shared login, and Codex creates
# the target through the symlink on first write. The dangling link itself is harmless, but running
# without ChatGPT auth is not side-effect free: see the remote-control block below.
if [ -d /srv/codex-auth ]; then
  ln -sfn /srv/codex-auth/auth.json "${HOME_DIR}/.codex/auth.json"
fi

# --- managed config.toml -----------------------------------------------------------
# Two marked regions are rewritten on every boot; anything outside them is preserved.
#   top block    — top-level keys (must stay before the first [table])
#   bottom block — [model_providers.<id>] table in custom provider mode
# Before rewriting we also drop stray top-level lines that set managed keys and any existing
# [model_providers.<id>] table so a user's edits cannot produce duplicate TOML keys.
CONFIG="${HOME_DIR}/.codex/config.toml"
touch "${CONFIG}"

PROVIDER_ID="${CODEX_GATEWAY_MODEL_PROVIDER_ID:-ollama-cloud}"
# Openai mode only manages the two gateway keys — user-set model/effort/provider lines must
# survive restarts (config/read is the source of project defaults). Custom mode owns all six
# keys and the provider table so user edits cannot create duplicate keys.
if [ "${CODEX_GATEWAY_MODEL_PROVIDER:-openai}" = "custom" ]; then
  TOPKEYS='cli_auth_credentials_store|sandbox_mode|model|model_provider|model_reasoning_effort|web_search'
  PROVIDER_TABLE="model_providers.${PROVIDER_ID}"
else
  TOPKEYS='cli_auth_credentials_store|sandbox_mode'
  PROVIDER_TABLE=''
fi

FILTERED="$(mktemp)"
awk -v topkeys="${TOPKEYS}" \
    -v ptable="${PROVIDER_TABLE}" '
  BEGIN { intop=1 }
  /# >>> codex-gateway managed/ { inblock=1; next }
  /# <<< codex-gateway managed/ { inblock=0; next }
  inblock { next }
  /^\[/ {
    header=$0; gsub(/[ \t]/, "", header)
    intable = (ptable != "" && header == "["ptable"]")
    intop = 0
    if (!intable) print
    next
  }
  intable { next }
  intop {
    line=$0; gsub(/[ \t]/, "", line)
    if (line ~ "^("topkeys")=") next
  }
  { print }
' "${CONFIG}" > "${FILTERED}"

SANDBOX_MODE="${CODEX_GATEWAY_SANDBOX_MODE:-danger-full-access}"
NEW_CONFIG="$(mktemp)"
{
  echo '# >>> codex-gateway managed (do not edit) >>>'
  echo 'cli_auth_credentials_store = "file"'
  printf 'sandbox_mode = "%s"\n' "${SANDBOX_MODE}"
  if [ "${CODEX_GATEWAY_MODEL_PROVIDER:-openai}" = "custom" ]; then
    printf 'model = "%s"\n' "${CODEX_GATEWAY_MODEL:-}"
    printf 'model_provider = "%s"\n' "${PROVIDER_ID}"
    printf 'model_reasoning_effort = "%s"\n' "${CODEX_GATEWAY_MODEL_REASONING_EFFORT:-medium}"
    printf 'web_search = "%s"\n' "${CODEX_GATEWAY_WEB_SEARCH:-disabled}"
  fi
  echo '# <<< codex-gateway managed <<<'
  cat "${FILTERED}"
  if [ "${CODEX_GATEWAY_MODEL_PROVIDER:-openai}" = "custom" ]; then
    echo '# >>> codex-gateway managed (do not edit) >>>'
    printf '[model_providers.%s]\n' "${PROVIDER_ID}"
    printf 'name = "%s"\n' "${CODEX_GATEWAY_MODEL_PROVIDER_NAME:-${PROVIDER_ID}}"
    printf 'base_url = "%s"\n' "${CODEX_GATEWAY_MODEL_PROVIDER_BASE_URL:-}"
    echo 'env_key = "CODEX_GATEWAY_MODEL_PROVIDER_API_KEY"'
    printf 'wire_api = "%s"\n' "${CODEX_GATEWAY_MODEL_PROVIDER_WIRE_API:-responses}"
    echo '# <<< codex-gateway managed <<<'
  fi
} > "${NEW_CONFIG}"
mv "${NEW_CONFIG}" "${CONFIG}"
rm -f "${FILTERED}"
chown "${DEV_UID}:${DEV_GID}" "${CONFIG}"

# sshd does not propagate container Env to SSH sessions, so the app-server that the Gateway
# launches through `$SHELL -l -i -c` reads the key from a login-shell profile.d drop-in.
# Keep the key out of config.toml entirely.
PROFILE_FILE=/etc/profile.d/codex-gateway-model-provider.sh
if [ "${CODEX_GATEWAY_MODEL_PROVIDER:-openai}" = "custom" ] \
  && [ -n "${CODEX_GATEWAY_MODEL_PROVIDER_API_KEY:-}" ]; then
  ESCAPED_KEY="$(printf '%s' "${CODEX_GATEWAY_MODEL_PROVIDER_API_KEY}" | sed "s/'/'\\\\''/g")"
  printf "export CODEX_GATEWAY_MODEL_PROVIDER_API_KEY='%s'\n" "${ESCAPED_KEY}" > "${PROFILE_FILE}"
  chmod 644 "${PROFILE_FILE}"
else
  rm -f "${PROFILE_FILE}"
fi

# Disable codex app-server's remote control. It pairs app-server with ChatGPT's remote-control
# relay, which Gateway never uses: browsers reach app-server only through Gateway's own SSH/RPC
# channel. Left enabled, whenever no ChatGPT auth is present (always, with an API-key provider)
# app-server retries resolving its remote-control preference once per second forever
# (codex-rs app-server-transport remote_control/websocket.rs, resolve_unknown_desired_state),
# flooding ~/.codex/logs_2.sqlite and burning CPU.
# CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED is an internal Codex marker, not a public flag:
# re-verify it still exists (codex-rs/app-server/src/main.rs) when bumping SUPPORTED_CODEX_VERSION.
# Delivered via profile.d like the provider env above, since sshd does not pass container Env into
# SSH sessions.
echo 'export CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED=1' \
  > /etc/profile.d/codex-gateway-remote-control.sh
chmod 644 /etc/profile.d/codex-gateway-remote-control.sh

ssh-keygen -A
exec /usr/sbin/sshd -D -e
