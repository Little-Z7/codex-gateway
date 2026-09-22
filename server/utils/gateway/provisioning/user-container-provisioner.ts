// ssh2 is CommonJS; `utils` is not visible to Node's named-export detection in the bundled ESM
// output, so take it off the default export.
import ssh2 from "ssh2";
import { SUPPORTED_CODEX_VERSION } from "../infra/codex/codex-version";
import { runAsUserConfigMutation } from "../config/target-user-mutation";
import { userStore } from "../auth/users";
import { hostStore } from "../state/hosts";
import { projectStore } from "../state/projects";
import { auditLog } from "../audit/audit-log";
import { runtimeLog } from "../runtime/runtime-log";
import { DockerEngineClient, isDockerNotFound } from "./docker-engine-client";
import { provisioningConfig } from "./provisioning-config";
import {
  attachInfraToUserNetwork,
  detachInfraAndRemoveUserNetwork,
  ensureUserNetwork,
  reconnectAllUserNetworks,
  userNetworkNameFor,
} from "./user-network-isolation";

export type ContainerState = "running" | "exited" | "missing" | "unknown";

const { Client, utils } = ssh2;

// ssh2's generateKeyPairSync has been observed to emit a private key that its own parser rejects
// ("Malformed OpenSSH private key"). Validate immediately and retry a few times so one bad
// generation does not fail a provisioning run.
function generateEd25519KeyPair() {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const keyPair = utils.generateKeyPairSync("ed25519");
    const parsed = utils.parseKey(keyPair.private);
    if (!(parsed instanceof Error)) {
      if (attempt > 1) {
        runtimeLog("ssh keypair regenerated after parse failure", { attempts: attempt });
      }
      return keyPair;
    }
    lastError = parsed;
  }
  runtimeLog("ssh keypair generation failed", {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw lastError instanceof Error ? lastError : new Error("ssh keypair generation failed");
}

const MANAGED_LABEL = "codex-gateway.managed";
const USER_LABEL = "codex-gateway.user";
const READY_PROBE_TIMEOUT_MS = 90_000;
const READY_PROBE_INTERVAL_MS = 2_000;

const inFlight = new Map<number, Promise<unknown>>();

/**
 * Serializes provisioning work per user. The API handlers kick these tasks in the background;
 * callers that need the outcome (deprovision before delete) await the returned promise.
 */
function enqueue<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const tracked = next.catch(() => {});
  inFlight.set(userId, tracked);
  void tracked.finally(() => {
    if (inFlight.get(userId) === tracked) inFlight.delete(userId);
  });
  return next;
}

export const userContainerProvisioner = {
  isBusy(userId: number) {
    return inFlight.has(userId);
  },

  containerNameFor(username: string) {
    return `${provisioningConfig().containerPrefix}${username}`;
  },

  volumeNameFor(username: string) {
    return `${provisioningConfig().containerPrefix}${username}-home`;
  },

  async inspect(userId: number): Promise<{ state: ContainerState; name: string | null }> {
    const managed = userStore.getManagedHost(userId);
    const name = managed?.containerName ?? null;
    if (name === null) {
      return { state: "missing", name: null };
    }
    try {
      const info = await withTimeout(new DockerEngineClient().inspectContainer(name), 3_000);
      const state = info?.State;
      const running =
        typeof state === "object" && state !== null
          ? Reflect.get(state, "Running") === true
          : false;
      return { state: running ? "running" : "exited", name };
    } catch (error) {
      if (isDockerNotFound(error)) return { state: "missing", name };
      return { state: "unknown", name };
    }
  },

  /**
   * One Docker `/containers/json` round-trip for admin list/overview instead of N inspects.
   * Falls back to per-name inspect if the list call fails.
   */
  async inspectByNames(
    names: string[],
  ): Promise<Map<string, { state: ContainerState; name: string | null }>> {
    const unique = [...new Set(names.filter((name) => name !== ""))];
    const result = new Map<string, { state: ContainerState; name: string | null }>();
    for (const name of unique) result.set(name, { state: "missing", name });
    if (unique.length === 0) return result;
    try {
      const listed = await withTimeout(new DockerEngineClient().listContainers(true), 5_000);
      const wanted = new Set(unique);
      for (const item of listed) {
        const stateRaw = typeof item.State === "string" ? item.State : "";
        const state: ContainerState = stateRaw === "running" ? "running" : "exited";
        const rawNames = Array.isArray(item.Names) ? item.Names : [];
        for (const rawName of rawNames) {
          if (typeof rawName !== "string") continue;
          const name = rawName.replace(/^\//, "");
          if (wanted.has(name)) result.set(name, { state, name });
        }
      }
      return result;
    } catch {
      const docker = new DockerEngineClient();
      await Promise.all(
        unique.map(async (name) => {
          try {
            const info = await withTimeout(docker.inspectContainer(name), 3_000);
            const state = info?.State;
            const running =
              typeof state === "object" && state !== null
                ? Reflect.get(state, "Running") === true
                : false;
            result.set(name, { state: running ? "running" : "exited", name });
          } catch (error) {
            result.set(name, {
              state: isDockerNotFound(error) ? "missing" : "unknown",
              name,
            });
          }
        }),
      );
      return result;
    }
  },

  provision(userId: number): Promise<void> {
    return enqueue(userId, () => provisionContainer(userId));
  },

  deprovision(userId: number, options: { keepVolume: boolean }): Promise<void> {
    return enqueue(userId, () => removeContainer(userId, options.keepVolume));
  },

  start(userId: number): Promise<void> {
    return enqueue(userId, async () => {
      const name = containerName(userId);
      if (name === null) return;
      await new DockerEngineClient().startContainer(name);
    });
  },

  stop(userId: number): Promise<void> {
    return enqueue(userId, async () => {
      const name = containerName(userId);
      if (name === null) return;
      try {
        await new DockerEngineClient().stopContainer(name, 10);
      } catch (error) {
        if (!isDockerNotFound(error)) throw error;
      }
    });
  },

  /** Rows left in `provisioning` after a gateway restart are either finished work that never got
   * recorded, or dead attempts. The container is the source of truth: when it is reachable and
   * `codex --version` succeeds inside it, register the workspace the same way provision() does
   * (fresh keypair installed via docker exec — the in-memory provisioning key is gone). */
  async repairProvisioningRows(): Promise<number> {
    const config = provisioningConfig();
    if (!config.enabled) return 0;
    const docker = new DockerEngineClient();
    const rows = userStore.listManagedHostsByStatus("provisioning");
    let repaired = 0;
    for (const row of rows) {
      if (row.containerName === null) {
        userStore.upsertManagedHost(row.userId, row.hostId, {
          status: "error",
          lastError: "Gateway 重启时 provisioning 未完成",
        });
        continue;
      }
      try {
        const info = await withTimeout(docker.inspectContainer(row.containerName), 5_000);
        const running = Reflect.get(recordFromUnknown(info?.State) ?? {}, "Running") === true;
        if (!running) throw new Error("container not running");
        const probe = await docker.execInContainer(row.containerName, ["codex", "--version"]);
        if (probe.exitCode !== 0) throw new Error(probe.output.trim() || "codex --version failed");

        const user = userStore.findById(row.userId);
        if (user === null) throw new Error("user removed");
        const keyPair = generateEd25519KeyPair();
        await docker.execInContainer(row.containerName, [
          "sh",
          "-c",
          `mkdir -p /home/dev/.ssh && printf '%s\n' '${keyPair.public}' >> /home/dev/.ssh/authorized_keys && chown -R dev:dev /home/dev/.ssh`,
        ]);
        const host = await registerWorkspaceHost(
          row.userId,
          row.containerName,
          row.hostId,
          keyPair.private,
        );
        userStore.upsertManagedHost(row.userId, host.id, {
          status: "ready",
          containerName: row.containerName,
          containerId: row.containerId,
          volumeName: row.volumeName,
          sshPublicKey: keyPair.public,
          networkName: row.networkName,
          networkSubnet: row.networkSubnet,
          lastError: null,
        });
        repaired += 1;
        runtimeLog("interrupted provisioning repaired after restart", {
          userId: row.userId,
          containerName: row.containerName,
        });
      } catch (error) {
        userStore.upsertManagedHost(row.userId, row.hostId, {
          status: "error",
          lastError: "Gateway 重启时 provisioning 未完成",
        });
        runtimeLog("interrupted provisioning marked error", {
          userId: row.userId,
          containerName: row.containerName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return repaired;
  },

  /** Re-attaches the Gateway's own container (and the outbound proxy container) to every
   * provisioned user's isolated network. No-op outside CODEX_GATEWAY_USER_NETWORK_ISOLATION=
   * per-user. Idempotent and cheap — safe to call on every Gateway startup and reconcile pass so
   * a *recreated* Gateway or proxy container regains access without manual intervention. */
  async reconnectUserNetworks(): Promise<void> {
    const config = provisioningConfig();
    if (!config.enabled || config.networkIsolation !== "per-user") return;
    const networks = [...userStore.listManagedHosts().values()]
      .map((row) => row.networkName)
      .filter((name): name is string => name !== null);
    if (networks.length === 0) return;
    await reconnectAllUserNetworks(new DockerEngineClient(), config, networks);
  },

  /** Periodic drift check: managed containers that vanished are flagged `missing` so the admin
   * console can offer rebuild; a row whose container came back flips back to ready. */
  async reconcileContainers(): Promise<void> {
    const config = provisioningConfig();
    if (!config.enabled) return;
    const docker = new DockerEngineClient();
    await userContainerProvisioner.reconnectUserNetworks();
    for (const row of userStore.listManagedHosts().values()) {
      if (row.status !== "ready" && row.status !== "missing" && row.status !== "error") continue;
      if (row.containerName === null) continue;
      let state: "present" | "missing";
      try {
        await withTimeout(docker.inspectContainer(row.containerName), 5_000);
        state = "present";
      } catch (error) {
        if (!isDockerNotFound(error)) {
          runtimeLog("container reconcile inspect failed", {
            userId: row.userId,
            containerName: row.containerName,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        state = "missing";
      }
      if (state === "missing" && row.status === "ready") {
        userStore.upsertManagedHost(row.userId, row.hostId, { status: "missing" });
        auditLog.record(
          null,
          "container.reconcile",
          { type: "container", id: row.containerName, label: row.containerName },
          { status: "missing" },
        );
      } else if (state === "present" && row.status === "missing") {
        userStore.upsertManagedHost(row.userId, row.hostId, { status: "ready", lastError: null });
        auditLog.record(
          null,
          "container.reconcile",
          { type: "container", id: row.containerName, label: row.containerName },
          { status: "ready" },
        );
      }
    }
  },
};

async function registerWorkspaceHost(
  userId: number,
  containerName: string,
  previousHostId: number,
  privateKey: string,
) {
  return await runAsUserConfigMutation(userId, () => {
    // Provisioning replaces any manually configured managed host for this user.
    if (previousHostId !== 0) {
      hostStore.delete(previousHostId);
    }
    const createdHost = hostStore.create({
      name: "工作区",
      sshHost: containerName,
      port: 22,
      username: "dev",
      authMode: "privateKey",
      privateKey,
      proxyUrl: null,
      managed: true,
    });
    projectStore.create({
      hostId: createdHost.id,
      name: "workspace",
      remotePath: "/home/dev/workspace",
    });
    return createdHost;
  });
}

function containerName(userId: number) {
  return userStore.getManagedHost(userId)?.containerName ?? null;
}

async function provisionContainer(userId: number) {
  const config = provisioningConfig();
  const user = userStore.findById(userId);
  if (user === null) throw new Error("User not found");
  if (config.networkIsolation === "shared" && config.dockerNetwork === null) {
    throw new Error(
      "Provisioning requires CODEX_GATEWAY_DOCKER_NETWORK when CODEX_GATEWAY_USER_NETWORK_ISOLATION=shared",
    );
  }
  // Shared ChatGPT login (mode "openai") needs the shared auth dir mounted; a shared API-key
  // provider (mode "custom") never reads /srv/codex-auth, so it must not require the directory.
  const useSharedLogin = config.modelProvider.mode === "openai";
  if (useSharedLogin && config.sharedAuthDir === null) {
    throw new Error(
      "Provisioning requires CODEX_GATEWAY_SHARED_AUTH_DIR when using the shared ChatGPT login (CODEX_GATEWAY_MODEL_PROVIDER=openai)",
    );
  }
  if (config.modelProvider.error !== null) {
    throw new Error(config.modelProvider.error);
  }
  const docker = new DockerEngineClient();
  const containerName = userContainerProvisioner.containerNameFor(user.username);
  const volumeName = userContainerProvisioner.volumeNameFor(user.username);
  const userNetworkName =
    config.networkIsolation === "per-user"
      ? userNetworkNameFor(config.containerPrefix, user.username)
      : null;
  const labels = { [MANAGED_LABEL]: "true", [USER_LABEL]: user.username };

  // Capture the existing managed host id *before* marking the row as provisioning: writing 0
  // here would orphan the old config-side host so neither the member (403) nor the admin
  // managed-host endpoints could ever remove it.
  const previousHostId = userStore.getManagedHost(userId)?.hostId ?? 0;
  userStore.upsertManagedHost(userId, previousHostId, {
    status: "provisioning",
    containerName,
    volumeName,
    networkName: userNetworkName,
    lastError: null,
  });
  let resolvedNetworkSubnet: string | null = null;
  try {
    const keyPair = generateEd25519KeyPair();
    await docker.createVolume({ Name: volumeName, Labels: labels }).catch(ignoreIfExists);

    const provider = config.modelProvider;
    const env = [
      `CODEX_GATEWAY_SSH_AUTHORIZED_KEY=${keyPair.public}`,
      `CODEX_GATEWAY_SANDBOX_MODE=${config.sandboxMode}`,
      `CODEX_GATEWAY_MODEL_PROVIDER=${provider.mode}`,
      `CODEX_GATEWAY_MODEL_PROVIDER_ID=${provider.id}`,
      `CODEX_GATEWAY_MODEL_PROVIDER_NAME=${provider.displayName}`,
      `CODEX_GATEWAY_MODEL_PROVIDER_WIRE_API=${provider.wireApi}`,
    ];
    if (provider.baseUrl !== null)
      env.push(`CODEX_GATEWAY_MODEL_PROVIDER_BASE_URL=${provider.baseUrl}`);
    // The API key travels in container Env so the entrypoint can move it into
    // /etc/profile.d (sshd does not propagate container Env to SSH sessions). Internal
    // trusted topology accepts `docker inspect` visibility.
    if (provider.apiKey !== null)
      env.push(`CODEX_GATEWAY_MODEL_PROVIDER_API_KEY=${provider.apiKey}`);
    if (provider.model !== null) env.push(`CODEX_GATEWAY_MODEL=${provider.model}`);
    if (provider.webSearch !== null) env.push(`CODEX_GATEWAY_WEB_SEARCH=${provider.webSearch}`);
    // Same outbound proxy the Gateway process itself uses (see deploy/gateway-entrypoint.sh),
    // shared here so Codex's own model-API calls inside the container can reach the internet
    // through it too. The entrypoint moves it into /etc/profile.d for the same reason as the
    // model provider API key: sshd does not propagate container Env to SSH sessions.
    if (config.outboundProxy !== null) {
      env.push(`CODEX_GATEWAY_OUTBOUND_PROXY=${config.outboundProxy}`);
      if (config.outboundNoProxy !== null)
        env.push(`CODEX_GATEWAY_OUTBOUND_NO_PROXY=${config.outboundNoProxy}`);
    }
    const binds = [`${volumeName}:/home/dev`];
    // Custom API-key providers never read /srv/codex-auth; only mount it for the shared ChatGPT
    // login path (see the validation above).
    if (useSharedLogin) binds.push(`${config.sharedAuthDir}:/srv/codex-auth:rw`);
    if (config.sharedDataDir !== null) {
      binds.push(`${config.sharedDataDir}:/data/shared:${config.sharedDataWritable ? "rw" : "ro"}`);
    }

    // "shared" (default, unchanged): every user container joins the one shared dockerNetwork.
    // "per-user": each user gets a dedicated Internal:true bridge network that only the Gateway's
    // own container and the outbound proxy container are attached to (see
    // deploy/README.zh-CN.md's "安全加固" section for what this does and does not isolate).
    let networkMode: string;
    if (userNetworkName !== null) {
      const ensured = await ensureUserNetwork(docker, {
        name: userNetworkName,
        subnetBase: config.userNetworkSubnetBase,
        startIndex: userId,
        username: user.username,
      });
      resolvedNetworkSubnet = ensured.subnet;
      await attachInfraToUserNetwork(docker, config, ensured.name);
      networkMode = ensured.name;
    } else {
      if (config.dockerNetwork === null)
        throw new Error("CODEX_GATEWAY_DOCKER_NETWORK is required");
      networkMode = config.dockerNetwork;
    }

    const hostConfig: Record<string, unknown> = {
      NetworkMode: networkMode,
      Binds: binds,
      RestartPolicy: { Name: "unless-stopped" },
      Init: true,
      PidsLimit: config.pidsLimit,
      LogConfig: {
        Type: "json-file",
        Config: {
          "max-size": config.userContainerLogMaxSize,
          "max-file": config.userContainerLogMaxFiles,
        },
      },
    };
    if (config.cgroupParent !== null) hostConfig.CgroupParent = config.cgroupParent;
    // Per-user quota overrides stored on the managed_hosts row beat the global env limits.
    const quota = userStore.getManagedHost(userId);
    const memory = quota?.memoryLimit ?? config.memory;
    const cpus = quota?.cpuLimit ?? config.cpus;
    if (memory !== null) hostConfig.Memory = parseMemoryLimit(memory);
    if (cpus !== null) hostConfig.NanoCpus = Math.round(Number(cpus) * 1e9);

    const created = await docker.createContainer(containerName, {
      Image: config.userImage,
      Hostname: containerName,
      Env: env,
      HostConfig: hostConfig,
      Labels: labels,
    });
    const containerId =
      typeof created?.Id === "string" && created.Id !== "" ? created.Id : containerName;
    await docker.startContainer(containerId);

    await waitForCodex(containerName, keyPair.private, containerId);

    const host = await registerWorkspaceHost(
      userId,
      containerName,
      previousHostId,
      keyPair.private,
    );

    userStore.upsertManagedHost(userId, host.id, {
      status: "ready",
      containerName,
      containerId,
      volumeName,
      sshPublicKey: keyPair.public,
      networkName: userNetworkName,
      networkSubnet: resolvedNetworkSubnet,
      lastError: null,
    });
    runtimeLog("user container provisioned", {
      userId,
      username: user.username,
      containerName,
      containerId,
    });
  } catch (error) {
    userStore.upsertManagedHost(userId, previousHostId, {
      status: "error",
      containerName,
      volumeName,
      networkName: userNetworkName,
      networkSubnet: resolvedNetworkSubnet,
      lastError: error instanceof Error ? error.message : String(error),
    });
    runtimeLog("user container provisioning failed", {
      userId,
      username: user.username,
      containerName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function removeContainer(userId: number, keepVolume: boolean) {
  const managed = userStore.getManagedHost(userId);
  const docker = new DockerEngineClient();
  if (managed !== null && managed.containerName !== null) {
    try {
      await docker.stopContainer(managed.containerName, 10);
    } catch (error) {
      if (!isDockerNotFound(error) && !isAlreadyStopped(error)) throw error;
    }
    try {
      await docker.removeContainer(managed.containerName, { force: true });
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
  }
  if (!keepVolume && managed !== null && managed.volumeName !== null) {
    try {
      await docker.removeVolume(managed.volumeName, true);
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
  }
  if (managed !== null && managed.hostId !== 0) {
    await runAsUserConfigMutation(userId, () => hostStore.delete(managed.hostId));
  }
  // Per-user network teardown only on a full delete. A keepVolume recreate leaves the
  // (temporarily member-less) network in place with the Gateway/proxy still attached, so the
  // subsequent re-provision finds it by name and reuses the same subnet — no churn, no gap where
  // a *new* per-user network would need probing again.
  const config = provisioningConfig();
  if (
    !keepVolume &&
    config.networkIsolation === "per-user" &&
    managed !== null &&
    managed.networkName !== null
  ) {
    const networkName = managed.networkName;
    await detachInfraAndRemoveUserNetwork(new DockerEngineClient(), config, networkName).catch(
      (error: unknown) => {
        runtimeLog("user network cleanup failed", {
          userId,
          network: networkName,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }
  if (keepVolume && managed !== null) {
    // Keep the row (and its quota overrides) so a later recreate can rebuild from it; only the
    // container identity is cleared.
    userStore.upsertManagedHost(userId, managed.hostId, {
      status: "removed",
      containerName: null,
      containerId: null,
      sshPublicKey: null,
      networkName: managed.networkName,
      networkSubnet: managed.networkSubnet,
    });
  } else {
    userStore.deleteManagedHost(userId);
  }
}

function isAlreadyStopped(error: unknown) {
  return (
    error instanceof Error && /not running|container .* is not running|304/.test(error.message)
  );
}

async function waitForCodex(containerName: string, privateKey: string, containerId: string) {
  const deadline = Date.now() + READY_PROBE_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const version = await probeCodexVersion(containerName, privateKey);
      // `codex --version` prints e.g. "codex-cli 0.155.0".
      if (version.trim().endsWith(SUPPORTED_CODEX_VERSION)) return;
      lastError = new Error(`codex --version returned ${version.trim() || "<empty>"}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(READY_PROBE_INTERVAL_MS);
  }
  throw new Error(
    `User container ${containerName} (${containerId.slice(0, 12)}) did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function probeCodexVersion(host: string, privateKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let output = "";
    const timer = setTimeout(() => {
      client.end();
      reject(new Error("readiness probe timed out"));
    }, 10_000);
    client
      .on("ready", () => {
        client.exec("codex --version", (error, stream) => {
          if (error) {
            clearTimeout(timer);
            client.end();
            reject(error);
            return;
          }
          stream
            .on("data", (chunk: Buffer) => (output += chunk.toString()))
            .on("close", () => {
              clearTimeout(timer);
              client.end();
              resolve(output);
            })
            .stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
        });
      })
      .on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      })
      .connect({ host, port: 22, username: "dev", privateKey, readyTimeout: 10_000 });
  });
}

function ignoreIfExists(error: unknown) {
  if (isDockerNotFound(error)) return null;
  if (error instanceof Error && /409|already exists/.test(error.message)) return null;
  throw error;
}

export function parseMemoryLimit(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg]i?b?)?$/i.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit.startsWith("k")
    ? 1024
    : unit.startsWith("m")
      ? 1024 ** 2
      : unit.startsWith("g")
        ? 1024 ** 3
        : 1;
  return Math.round(amount * multiplier);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error("operation timed out")), ms),
    ),
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
