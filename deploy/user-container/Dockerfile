# codex-gateway user workspace container: SSH-only access for the Gateway, persistent /home/dev
# volume, shared Codex auth mounted at /srv/codex-auth by the provisioner.
FROM node:22-bookworm-slim AS node-runtime

ARG CODEX_CLI_VERSION
RUN test -n "${CODEX_CLI_VERSION}" \
  && mkdir -p /tmp/codex-node \
  && cp -a /usr/local/. /tmp/codex-node/ \
  && npm install -g --prefix /tmp/codex-node @openai/codex@${CODEX_CLI_VERSION}

FROM debian:bookworm-slim

ARG CODEX_CLI_VERSION
ARG CODEX_GATEWAY_BUILT_AT
LABEL codex-gateway.codex-version="${CODEX_CLI_VERSION}" \
      codex-gateway.built-at="${CODEX_GATEWAY_BUILT_AT}"

ARG USER_UID=1000
ARG USER_GID=1000

RUN apt-get update \
  && apt-get install -y -o Acquire::Retries=8 --no-install-recommends \
    openssh-server git tmux procps ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# `dev` deliberately has no sudo: an escape from this container should land as an unprivileged
# user, not as root. The provisioner also sets no-new-privileges, so setuid binaries (su, passwd,
# ...) cannot raise privileges either. Tools users need system-wide belong in this image.
RUN groupadd --gid ${USER_GID} dev \
  && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash dev \
  && mkdir -p /run/sshd

COPY --from=node-runtime /tmp/codex-node/ /usr/local/

RUN printf '%s\n' \
    'PasswordAuthentication no' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'AllowUsers dev' \
    'AcceptEnv CODEX_GATEWAY_*' \
    > /etc/ssh/sshd_config.d/codex-gateway.conf

COPY entrypoint.sh /usr/local/bin/codex-gateway-user-entrypoint
RUN chmod +x /usr/local/bin/codex-gateway-user-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/codex-gateway-user-entrypoint"]
