#!/bin/sh
# Wraps the Gateway's own Node process. Only job: translate the single
# CODEX_GATEWAY_OUTBOUND_PROXY config item into the low-level environment variables Node needs
# before it starts, then exec the real command unchanged.
#
# Node's global fetch() (undici) does not read http_proxy/https_proxy by default.
# NODE_USE_ENV_PROXY=1 opts a Node process into honoring them via undici's EnvHttpProxyAgent, but
# it is only read once at process start -- setting it from JavaScript after the process is already
# running has no effect (verified empirically against node:24-bookworm-slim: `process.env.x = y;
# fetch(...)` inside a running process still fails, while the same vars passed to `docker run -e`
# work). That is why this translation has to happen in a shell wrapper in front of `node`, not in
# server code. Only lowercase http_proxy/https_proxy/no_proxy are honored (also verified
# empirically); uppercase HTTP_PROXY/HTTPS_PROXY are not read by Node and are intentionally not
# set here.
#
# This covers every outbound fetch() the Gateway process makes on its own behalf: Codex standalone
# release downloads (server/utils/gateway/infra/codex/codex-artifacts.ts), the npm "latest
# version" check (server/api/admin/images/codex-latest.get.ts), and Bark push notifications
# (server/utils/gateway/notifications/bark-provider.ts). SSH/RPC traffic to hosts and user
# containers never goes through fetch(), so it is unaffected either way, and when
# CODEX_GATEWAY_OUTBOUND_PROXY is unset this script is a no-op passthrough.
set -eu

if [ -n "${CODEX_GATEWAY_OUTBOUND_PROXY:-}" ]; then
  export http_proxy="$CODEX_GATEWAY_OUTBOUND_PROXY"
  export https_proxy="$CODEX_GATEWAY_OUTBOUND_PROXY"
  # localhost/loopback always stays direct, even if CODEX_GATEWAY_OUTBOUND_NO_PROXY is unset.
  # Node's proxy matcher only supports exact hostnames/IPs and domain suffixes, not CIDR ranges
  # (also verified empirically), so whole private subnets can't be excluded here as a range --
  # list specific internal hostnames/IPs via CODEX_GATEWAY_OUTBOUND_NO_PROXY instead, or rely on
  # the upstream proxy (mihomo/Clash rule sets keep RFC1918 traffic direct by default).
  extra_no_proxy="${CODEX_GATEWAY_OUTBOUND_NO_PROXY:-}"
  export no_proxy="localhost,127.0.0.1,::1${extra_no_proxy:+,${extra_no_proxy}}"
  export NODE_USE_ENV_PROXY=1
fi

exec "$@"
