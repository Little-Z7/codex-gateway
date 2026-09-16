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
# does not exist yet: an admin can provision before running the shared login, and a dangling
# link is harmless — Codex creates the target through the symlink on first write.
if [ -d /srv/codex-auth ]; then
  ln -sfn /srv/codex-auth/auth.json "${HOME_DIR}/.codex/auth.json"
fi

CONFIG="${HOME_DIR}/.codex/config.toml"
touch "${CONFIG}"
chown "${DEV_UID}:${DEV_GID}" "${CONFIG}"
if ! grep -q '^cli_auth_credentials_store' "${CONFIG}"; then
  printf 'cli_auth_credentials_store = "file"\n' >> "${CONFIG}"
fi
if ! grep -q '^sandbox_mode' "${CONFIG}"; then
  printf 'sandbox_mode = "%s"\n' "${CODEX_GATEWAY_SANDBOX_MODE:-danger-full-access}" >> "${CONFIG}"
fi

ssh-keygen -A
exec /usr/sbin/sshd -D -e
