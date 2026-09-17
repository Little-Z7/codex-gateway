// ssh2 is CommonJS; `utils` is not visible to Node's named-export detection in the bundled ESM
// output, so take it off the default export.
import ssh2 from "ssh2";
import { SUPPORTED_CODEX_VERSION } from "../infra/codex/codex-version";
import { runAsUserConfigMutation } from "../config/target-user-mutation";
import { userStore } from "../auth/users";
import { hostStore } from "../state/hosts";
import { projectStore } from "../state/projects";
import { runtimeLog } from "../runtime/runtime-log";
import { DockerEngineClient, isDockerNotFound } from "./docker-engine-client";
import { provisioningConfig } from "./provisioning-config";

export type ContainerState = "running" | "exited" | "missing" | "unknown";

const { Client, utils } = ssh2;

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
};

function containerName(userId: number) {
  return userStore.getManagedHost(userId)?.containerName ?? null;
}

async function provisionContainer(userId: number) {
  const config = provisioningConfig();
  const user = userStore.findById(userId);
  if (user === null) throw new Error("User not found");
  if (config.dockerNetwork === null || config.sharedAuthDir === null) {
    throw new Error(
      "Provisioning requires CODEX_GATEWAY_DOCKER_NETWORK and CODEX_GATEWAY_SHARED_AUTH_DIR",
    );
  }
  if (config.modelProvider.error !== null) {
    throw new Error(config.modelProvider.error);
  }
  const docker = new DockerEngineClient();
  const containerName = userContainerProvisioner.containerNameFor(user.username);
  const volumeName = userContainerProvisioner.volumeNameFor(user.username);
  const labels = { [MANAGED_LABEL]: "true", [USER_LABEL]: user.username };

  // Capture the existing managed host id *before* marking the row as provisioning: writing 0
  // here would orphan the old config-side host so neither the member (403) nor the admin
  // managed-host endpoints could ever remove it.
  const previousHostId = userStore.getManagedHost(userId)?.hostId ?? 0;
  userStore.upsertManagedHost(userId, previousHostId, {
    status: "provisioning",
    containerName,
    volumeName,
    lastError: null,
  });
  try {
    const keyPair = utils.generateKeyPairSync("ed25519");
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
    const binds = [`${volumeName}:/home/dev`, `${config.sharedAuthDir}:/srv/codex-auth:rw`];
    if (config.sharedDataDir !== null) binds.push(`${config.sharedDataDir}:/data/shared:rw`);

    const hostConfig: Record<string, unknown> = {
      NetworkMode: config.dockerNetwork,
      Binds: binds,
      RestartPolicy: { Name: "unless-stopped" },
      Init: true,
    };
    if (config.memory !== null) hostConfig.Memory = parseMemoryLimit(config.memory);
    if (config.cpus !== null) hostConfig.NanoCpus = Math.round(Number(config.cpus) * 1e9);

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

    const host = await runAsUserConfigMutation(userId, () => {
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
        privateKey: keyPair.private,
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

    userStore.upsertManagedHost(userId, host.id, {
      status: "ready",
      containerName,
      containerId,
      volumeName,
      sshPublicKey: keyPair.public,
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
  userStore.deleteManagedHost(userId);
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
      // `codex --version` prints e.g. "codex-cli 0.153.4".
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

function parseMemoryLimit(value: string) {
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
