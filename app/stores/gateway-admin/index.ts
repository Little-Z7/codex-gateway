import { defineStore } from "pinia";
import { gatewayApi } from "@/utils/gateway-api";

export interface AdminLockout {
  key: string;
  lockedUntil: string;
  retryAfterSeconds: number;
}

export interface AdminManagedHostSummary {
  hostId: number;
  hostName: string | null;
  status: "ready" | "provisioning" | "error" | "missing" | "removed";
  lastError: string | null;
  containerName?: string | null;
  volumeName?: string | null;
  quota?: { memory: string | null; cpus: string | null };
}

export interface AdminContainerSummary {
  state: "running" | "exited" | "missing" | "unknown";
  name: string | null;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  managedHost: AdminManagedHostSummary | null;
  container: AdminContainerSummary | null;
  lastLoginAt: string | null;
  onlineSessions: number;
}

export interface ProvisioningDiagnostics {
  enabled: boolean;
  image: string;
  network: string | null;
  sharedAuthDir: string | null;
  sharedDataDir: string | null;
  imagePresent: boolean;
  networkPresent: boolean;
  authFilePresent: boolean;
  dockerReachable: boolean;
  modelProvider?: {
    mode: "openai" | "custom";
    id: string;
    model: string | null;
    baseUrl: string | null;
    valid: boolean;
    error: string | null;
  };
  error: string | null;
}

export interface AdminOverview {
  users: { total: number; active: number; admins: number };
  sessions: { online: number; total: number };
  containers: {
    running: number;
    exited: number;
    missing: number;
    provisioning: number;
    error: number;
  };
  gateway: {
    version: string;
    nodeVersion: string;
    uptimeSeconds: number;
    memory: { rssBytes: number; heapUsedBytes: number };
  };
  codex: { supportedVersion: string };
  provisioning: ProvisioningDiagnostics;
}

export interface AdminSession {
  id: number;
  userId: number;
  username: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AdminAuditEntry {
  id: number;
  actorUserId: number | null;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminContainerRow {
  userId: number;
  username: string;
  containerName: string;
  managedStatus: string;
  state: string;
  startedAt: string | null;
  image: string | null;
  imageDigest: string | null;
  codexVersion: string | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  volumeName: string | null;
  volumeSizeBytes: number | null;
}

export interface AdminUserImageInfo {
  image: string;
  present: boolean;
  digest: string | null;
  created: string | null;
  codexVersion: string | null;
  builtAt: string | null;
  supportedCodexVersion: string;
}

export interface ImageRebuildStatus {
  status: "idle" | "running" | "success" | "error";
  lines: string[];
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface RecreateAllStatus {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  total: number;
  completed: number;
  currentUser: string | null;
  failures: { username: string; error: string }[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AdminSystemInfo {
  provisioning: Record<string, unknown> & { diagnostics: ProvisioningDiagnostics };
  modelProvider: {
    mode: string;
    id: string;
    displayName: string;
    baseUrl: string | null;
    wireApi: string;
    model: string | null;
    webSearch: string | null;
    apiKeyConfigured: boolean;
    valid: boolean;
    error: string | null;
  };
  paths: { database: string };
  runtime: { port: number; nodeVersion: string; version: string; supportedCodexVersion: string };
  sharedLogin: { present: boolean; accountEmail: string | null; lastRefresh: string | null };
}

export interface SharedLoginStatus {
  status: "idle" | "starting" | "pending" | "success" | "error";
  url?: string;
  code?: string;
  startedAt?: string;
  accountEmail?: string | null;
  message?: string;
  enabled: boolean;
  auth: { present: boolean; accountEmail: string | null; lastRefresh: string | null };
}

export const useGatewayAdminStore = defineStore("gateway-admin", () => {
  const users = ref<AdminUserSummary[]>([]);
  const provisioning = ref<ProvisioningDiagnostics | null>(null);
  const loading = ref(false);

  async function listUsers() {
    loading.value = true;
    try {
      const response = await gatewayApi<{ users: AdminUserSummary[] }>("/api/admin/users");
      users.value = response.users;
      return response.users;
    } finally {
      loading.value = false;
    }
  }

  async function loadProvisioning() {
    provisioning.value = await gatewayApi<ProvisioningDiagnostics>("/api/admin/provisioning");
    return provisioning.value;
  }

  async function createUser(input: {
    username: string;
    password: string;
    role: string;
    provision?: boolean;
  }) {
    await gatewayApi("/api/admin/users", { method: "POST", body: input });
    await listUsers();
  }

  async function updateUser(
    userId: number,
    changes: { isActive?: boolean; role?: string; password?: string },
  ) {
    await gatewayApi(`/api/admin/users/${userId}`, { method: "PATCH", body: changes });
    await listUsers();
  }

  async function deleteUser(userId: number, options: { keepVolume?: boolean } = {}) {
    await gatewayApi(`/api/admin/users/${userId}?keepVolume=${options.keepVolume === true}`, {
      method: "DELETE",
    });
    await listUsers();
  }

  async function provisionUser(userId: number, options: { recreate?: boolean } = {}) {
    await gatewayApi(
      `/api/admin/users/${userId}/provision?recreate=${options.recreate === true ? 1 : 0}`,
      {
        method: "POST",
      },
    );
    await listUsers();
  }

  async function deprovisionUser(userId: number, options: { keepVolume?: boolean } = {}) {
    await gatewayApi(
      `/api/admin/users/${userId}/provision?keepVolume=${options.keepVolume === true}`,
      { method: "DELETE" },
    );
    await listUsers();
  }

  async function startContainer(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/container/start`, { method: "POST" });
    await listUsers();
  }

  async function stopContainer(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/container/stop`, { method: "POST" });
    await listUsers();
  }

  async function putManagedHost(userId: number, input: Record<string, unknown>) {
    await gatewayApi(`/api/admin/users/${userId}/managed-host`, { method: "PUT", body: input });
    await listUsers();
  }

  async function deleteManagedHost(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/managed-host`, { method: "DELETE" });
    await listUsers();
  }

  const overview = ref<AdminOverview | null>(null);
  const sessions = ref<AdminSession[]>([]);
  const audit = ref<{ entries: AdminAuditEntry[]; nextCursor: number | null }>({
    entries: [],
    nextCursor: null,
  });
  const containers = ref<AdminContainerRow[]>([]);
  const systemInfo = ref<AdminSystemInfo | null>(null);
  const sharedLoginStatus = ref<SharedLoginStatus | null>(null);

  async function loadOverview() {
    overview.value = await gatewayApi<AdminOverview>("/api/admin/overview");
    return overview.value;
  }

  async function loadSessions() {
    sessions.value = (
      await gatewayApi<{ sessions: AdminSession[] }>("/api/admin/sessions")
    ).sessions;
    return sessions.value;
  }

  async function revokeSession(sessionId: number) {
    await gatewayApi(`/api/admin/sessions/${sessionId}`, { method: "DELETE" });
    await loadSessions();
  }

  async function revokeUserSessions(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/sessions/revoke`, { method: "POST" });
    await loadSessions();
  }

  async function loadAudit(options: { cursor?: number; userId?: number; action?: string } = {}) {
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set("cursor", String(options.cursor));
    if (options.userId !== undefined) params.set("userId", String(options.userId));
    if (options.action !== undefined && options.action !== "") params.set("action", options.action);
    const response = await gatewayApi<{ entries: AdminAuditEntry[]; nextCursor: number | null }>(
      `/api/admin/audit?${params}`,
    );
    if (options.cursor === undefined) {
      audit.value = response;
    } else {
      audit.value = {
        entries: [...audit.value.entries, ...response.entries],
        nextCursor: response.nextCursor,
      };
    }
    return response;
  }

  async function loadContainers() {
    containers.value = (
      await gatewayApi<{ containers: AdminContainerRow[] }>("/api/admin/containers")
    ).containers;
    return containers.value;
  }

  const volumeWarnBytes = ref<number>(Infinity);
  const volumesOverThreshold = ref<number | null>(null);

  async function loadContainerVolumes() {
    const response = await gatewayApi<{
      volumes: { userId: number; volumeName: string; sizeBytes: number | null }[];
      warnBytes: number;
      overThreshold: number;
    }>("/api/admin/containers/volumes");
    volumeWarnBytes.value = response.warnBytes;
    volumesOverThreshold.value = response.overThreshold;
    const sizes = new Map(response.volumes.map((volume) => [volume.userId, volume.sizeBytes]));
    containers.value = containers.value.map((row) => ({
      ...row,
      volumeSizeBytes: sizes.get(row.userId) ?? row.volumeSizeBytes,
    }));
  }

  async function loadContainerLogs(userId: number, tail = 200) {
    return await gatewayApi<{ logs: string; tail: number }>(
      `/api/admin/containers/${userId}/logs?tail=${tail}`,
    );
  }

  async function loadSystem() {
    systemInfo.value = await gatewayApi<AdminSystemInfo>("/api/admin/system");
    return systemInfo.value;
  }

  async function loadSharedLogin() {
    sharedLoginStatus.value = await gatewayApi<SharedLoginStatus>("/api/admin/shared-login");
    return sharedLoginStatus.value;
  }

  async function startSharedLogin() {
    await gatewayApi("/api/admin/shared-login/start", { method: "POST" });
    await loadSharedLogin();
  }

  async function cancelSharedLogin() {
    await gatewayApi("/api/admin/shared-login/cancel", { method: "POST" });
    await loadSharedLogin();
  }

  const image = ref<AdminUserImageInfo | null>(null);
  const rebuildStatus = ref<ImageRebuildStatus | null>(null);
  const recreateAll = ref<RecreateAllStatus | null>(null);

  async function loadImage() {
    image.value = await gatewayApi<AdminUserImageInfo>("/api/admin/images");
    return image.value;
  }

  async function checkCodexLatest() {
    return await gatewayApi<{ version: string | null; current: string; error: string | null }>(
      "/api/admin/images/codex-latest",
    );
  }

  async function loadRebuildStatus() {
    rebuildStatus.value = await gatewayApi<ImageRebuildStatus>("/api/admin/images/rebuild");
    return rebuildStatus.value;
  }

  async function startImageRebuild(codexVersion?: string) {
    rebuildStatus.value = await gatewayApi<ImageRebuildStatus>("/api/admin/images/rebuild", {
      method: "POST",
      body: codexVersion === undefined ? {} : { codexVersion },
    });
    return rebuildStatus.value;
  }

  async function loadRecreateAll() {
    recreateAll.value = await gatewayApi<RecreateAllStatus>("/api/admin/containers/recreate-all");
    return recreateAll.value;
  }

  async function startRecreateAll(intervalSeconds = 10) {
    recreateAll.value = await gatewayApi<RecreateAllStatus>("/api/admin/containers/recreate-all", {
      method: "POST",
      body: { intervalSeconds },
    });
    return recreateAll.value;
  }

  async function cancelRecreateAll() {
    recreateAll.value = await gatewayApi<RecreateAllStatus>("/api/admin/containers/recreate-all", {
      method: "DELETE",
    });
    return recreateAll.value;
  }

  async function setUserQuota(
    userId: number,
    quota: { memory?: string | null; cpus?: string | null },
  ) {
    await gatewayApi(`/api/admin/users/${userId}/quota`, { method: "PATCH", body: quota });
    await listUsers();
  }

  async function loadUserContainer(userId: number) {
    return await gatewayApi<{
      container: AdminContainerRow | null;
      managedHost: Record<string, unknown> | null;
    }>(`/api/admin/containers/${userId}`);
  }

  async function loadUserThreadStats(userId: number) {
    return await gatewayApi<{
      threads: { count: number; lastActiveAt: string | null; cached: boolean };
    }>(`/api/admin/users/${userId}/threads`);
  }

  const lockouts = ref<AdminLockout[]>([]);
  async function loadLockouts() {
    lockouts.value = (
      await gatewayApi<{ lockouts: AdminLockout[] }>("/api/admin/security/lockouts")
    ).lockouts;
  }
  async function unlockLockout(key: string) {
    await gatewayApi("/api/admin/security/lockouts", {
      method: "DELETE",
      body: { key },
    });
    await loadLockouts();
  }

  return {
    image,
    rebuildStatus,
    recreateAll,
    volumeWarnBytes,
    volumesOverThreshold,
    loadImage,
    checkCodexLatest,
    loadRebuildStatus,
    startImageRebuild,
    loadRecreateAll,
    startRecreateAll,
    cancelRecreateAll,
    setUserQuota,
    loadUserContainer,
    loadUserThreadStats,
    lockouts,
    loadLockouts,
    unlockLockout,
    users,
    provisioning,
    overview,
    sessions,
    audit,
    containers,
    systemInfo,
    sharedLoginStatus,
    loadOverview,
    loadSessions,
    revokeSession,
    revokeUserSessions,
    loadAudit,
    loadContainers,
    loadContainerVolumes,
    loadContainerLogs,
    loadSystem,
    loadSharedLogin,
    startSharedLogin,
    cancelSharedLogin,
    loading,
    listUsers,
    loadProvisioning,
    createUser,
    updateUser,
    deleteUser,
    provisionUser,
    deprovisionUser,
    startContainer,
    stopContainer,
    putManagedHost,
    deleteManagedHost,
  };
});
