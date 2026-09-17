#!/usr/bin/env bash
set -euo pipefail

mkdir -p /home/codex/.ssh /home/codex/.codex /workspace
mkdir -p /home/codex/.local
chmod 700 /home/codex/.ssh
chown -R codex:"$(id -gn codex)" /home/codex/.ssh /home/codex/.local /home/codex/.codex

# sshd does not propagate container Env to SSH sessions; the login-shell profile.d drop-in is
# how the custom model provider key reaches `codex app-server` on the ssh-target fixtures.
PROFILE_FILE=/etc/profile.d/codex-gateway-model-provider.sh
if [ -n "${CODEX_GATEWAY_MODEL_PROVIDER_API_KEY:-}" ]; then
  ESCAPED_KEY="$(printf '%s' "${CODEX_GATEWAY_MODEL_PROVIDER_API_KEY}" | sed "s/'/'\\\\''/g")"
  printf "export CODEX_GATEWAY_MODEL_PROVIDER_API_KEY='%s'\n" "${ESCAPED_KEY}" > "${PROFILE_FILE}"
  chmod 644 "${PROFILE_FILE}"
else
  rm -f "${PROFILE_FILE}"
fi

if [ -x /usr/local/bin/e2e-gpu-training ]; then
  runuser -u trainer -- /usr/local/bin/e2e-gpu-training >/dev/null 2>&1 &
fi

exec /usr/sbin/sshd -D -e
