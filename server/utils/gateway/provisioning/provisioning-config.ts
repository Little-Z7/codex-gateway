import { trimmedOrNull } from "~~/shared/utils/strings";
import { resolveModelProvider } from "../settings/model-provider";

export type ModelProviderMode = "openai" | "custom";

export interface ModelProviderConfig {
  mode: ModelProviderMode;
  id: string;
  displayName: string;
  baseUrl: string | null;
  wireApi: string;
  apiKey: string | null;
  model: string | null;
  webSearch: "disabled" | null;
  /** Human-readable problem when custom mode is misconfigured; null when valid. */
  error: string | null;
}

const PROVIDER_ID_PATTERN = /^[a-z0-9_-]+$/;

export function modelProviderConfig(): ModelProviderConfig {
  const mode: ModelProviderMode =
    (process.env.CODEX_GATEWAY_MODEL_PROVIDER ?? "openai") === "custom" ? "custom" : "openai";
  const id = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL_PROVIDER_ID) ?? "ollama-cloud";
  const displayName = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL_PROVIDER_NAME) ?? id;
  const baseUrl = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL_PROVIDER_BASE_URL);
  const wireApi = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL_PROVIDER_WIRE_API) ?? "responses";
  const apiKey = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL_PROVIDER_API_KEY);
  const model = trimmedOrNull(process.env.CODEX_GATEWAY_MODEL);
  const webSearchEnv = trimmedOrNull(process.env.CODEX_GATEWAY_WEB_SEARCH);

  if (mode === "openai") {
    return {
      mode,
      id,
      displayName,
      baseUrl,
      wireApi,
      apiKey: null,
      model,
      webSearch: webSearchEnv === "disabled" ? "disabled" : null,
      error: null,
    };
  }

  let error: string | null = null;
  if (!PROVIDER_ID_PATTERN.test(id)) {
    error = `CODEX_GATEWAY_MODEL_PROVIDER_ID "${id}" must match [a-z0-9_-]+`;
  } else if (baseUrl === null) {
    error = "CODEX_GATEWAY_MODEL_PROVIDER_BASE_URL is required for a custom provider";
  } else if (apiKey === null) {
    error = "CODEX_GATEWAY_MODEL_PROVIDER_API_KEY is required for a custom provider";
  } else if (model === null) {
    error = "CODEX_GATEWAY_MODEL is required for a custom provider";
  }

  return {
    mode,
    id,
    displayName,
    baseUrl,
    wireApi,
    apiKey,
    model,
    webSearch: webSearchEnv === null || webSearchEnv === "disabled" ? "disabled" : null,
    error,
  };
}

export type NetworkIsolationMode = "shared" | "per-user";

export interface ProvisioningConfig {
  enabled: boolean;
  userImage: string;
  dockerNetwork: string | null;
  sharedAuthDir: string | null;
  sharedAuthMount: string;
  sharedDataDir: string | null;
  /** /data/shared is mounted read-only by default; true mounts it rw (opt-in). */
  sharedDataWritable: boolean;
  containerPrefix: string;
  memory: string | null;
  cpus: string | null;
  /** HostConfig.PidsLimit sent to Docker: a positive fork-bomb guard, or -1 for unlimited. */
  pidsLimit: number;
  /** HostConfig.CgroupParent (a systemd slice name, e.g. "codexgatewayusers.slice", under the
   *  systemd cgroup driver) so the host can cap the aggregate resource usage of every user
   *  container via `systemctl set-property <slice> ...`. Unset by default. */
  cgroupParent: string | null;
  userContainerLogMaxSize: string;
  userContainerLogMaxFiles: string;
  sandboxMode: string;
  modelProvider: ModelProviderConfig;
  /** Outbound HTTP(S) proxy shared by the Gateway process itself and every user container. */
  outboundProxy: string | null;
  /** Extra comma-separated no-proxy hosts, appended to the built-in localhost bypass. */
  outboundNoProxy: string | null;
  /** "shared" (default): every user container joins `dockerNetwork`, unchanged historical
   *  behavior. "per-user": each user gets a dedicated `Internal: true` bridge network that only
   *  the Gateway's own container and `outboundProxyContainer` are attached to — see
   *  deploy/README.zh-CN.md's "安全加固" section. */
  networkIsolation: NetworkIsolationMode;
  /** Reserved supernet (default 172.30.0.0/16) that per-user networks carve deterministic /24
   *  slots from. Only meaningful when networkIsolation is "per-user". */
  userNetworkSubnetBase: string;
  /** Gateway's own container name/ID for `docker network connect`. Defaults to os.hostname()
   *  (Docker sets a container's hostname to its own ID unless overridden), so this is normally
   *  unnecessary to set explicitly. */
  selfContainer: string | null;
  /** Outbound proxy container name, attached to every per-user network so isolated user
   *  containers keep internet access through the proxy's data port only. Required for user
   *  containers to have any egress at all when networkIsolation is "per-user". */
  outboundProxyContainer: string | null;
}

function parsePidsLimit(raw: string | null): number {
  if (raw === null) return 512;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : -1;
}

export function provisioningConfig(): ProvisioningConfig {
  const isolationRaw = trimmedOrNull(process.env.CODEX_GATEWAY_USER_NETWORK_ISOLATION);
  return {
    enabled: (process.env.CODEX_GATEWAY_PROVISIONING ?? "off") === "docker",
    userImage: trimmedOrNull(process.env.CODEX_GATEWAY_USER_IMAGE) ?? "codex-gateway-user:latest",
    dockerNetwork: trimmedOrNull(process.env.CODEX_GATEWAY_DOCKER_NETWORK),
    // Host-side path; mounted into user containers at sharedAuthMount.
    sharedAuthDir: trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_AUTH_DIR),
    // Where the shared auth dir is visible inside the Gateway container; diagnostics only.
    sharedAuthMount:
      trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_AUTH_MOUNT) ?? "/srv/codex-auth",
    sharedDataDir: trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_DATA_DIR),
    sharedDataWritable: process.env.CODEX_GATEWAY_SHARED_DATA_WRITABLE === "true",
    containerPrefix:
      trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_PREFIX) ?? "codex-user-",
    memory: trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_MEMORY),
    cpus: trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_CPUS),
    pidsLimit: parsePidsLimit(trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_PIDS)),
    cgroupParent: trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_CGROUP_PARENT),
    sandboxMode: trimmedOrNull(process.env.CODEX_GATEWAY_SANDBOX_MODE) ?? "danger-full-access",
    userContainerLogMaxSize:
      trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_LOG_MAX_SIZE) ?? "10m",
    userContainerLogMaxFiles:
      trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_LOG_MAX_FILES) ?? "3",
    modelProvider: resolveModelProvider(modelProviderConfig()),
    outboundProxy: trimmedOrNull(process.env.CODEX_GATEWAY_OUTBOUND_PROXY),
    outboundNoProxy: trimmedOrNull(process.env.CODEX_GATEWAY_OUTBOUND_NO_PROXY),
    networkIsolation: isolationRaw === "per-user" ? "per-user" : "shared",
    userNetworkSubnetBase:
      trimmedOrNull(process.env.CODEX_GATEWAY_USER_NETWORK_SUBNET_BASE) ?? "172.30.0.0/16",
    selfContainer: trimmedOrNull(process.env.CODEX_GATEWAY_SELF_CONTAINER),
    outboundProxyContainer: trimmedOrNull(process.env.CODEX_GATEWAY_OUTBOUND_PROXY_CONTAINER),
  };
}
