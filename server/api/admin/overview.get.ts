import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { gatewayDatabase } from "../../utils/gateway/storage/database";
import { SUPPORTED_CODEX_VERSION } from "../../utils/gateway/infra/codex/codex-version";
import { userContainerProvisioner } from "../../utils/gateway/provisioning/user-container-provisioner";
import { provisioningDiagnostics } from "../../utils/gateway/provisioning/provisioning-diagnostics";
import { provisioningConfig } from "../../utils/gateway/provisioning/provisioning-config";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { usageStore } from "../../utils/gateway/usage/usage-store";
import { volumeWarnBytes } from "../../utils/gateway/provisioning/container-inventory";
import { DockerEngineClient } from "../../utils/gateway/provisioning/docker-engine-client";

const ONLINE_WINDOW_MS = 5 * 60_000;

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const users = userStore.listUsers();
  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const sessionRows = gatewayDatabase()
    .prepare("SELECT COUNT(*) AS total, SUM(last_seen_at >= ?) AS online FROM sessions")
    .get(onlineSince);

  const managedHosts = userStore.listManagedHosts();
  const containerCounts = { running: 0, exited: 0, missing: 0, provisioning: 0, error: 0 };
  if (provisioningConfig().enabled) {
    const inspections = await Promise.all(
      [...managedHosts.values()].map(async (managed) => {
        if (managed.status === "provisioning") return "provisioning";
        if (managed.status === "error") return "error";
        if (managed.containerName === null || managed.status === "removed") return null;
        const container = await userContainerProvisioner.inspect(managed.userId);
        return container.state;
      }),
    );
    for (const state of inspections) {
      if (state === "running" || state === "exited" || state === "missing") {
        containerCounts[state] += 1;
      } else if (state === "provisioning" || state === "error") {
        containerCounts[state] += 1;
      }
    }
  }

  return {
    users: {
      total: users.length,
      active: users.filter((user) => user.isActive).length,
      admins: users.filter((user) => user.role === "admin").length,
    },
    sessions: {
      online: Number(sessionRows?.online ?? 0),
      total: Number(sessionRows?.total ?? 0),
    },
    containers: containerCounts,
    usage: { today: usageStore.todayTotals() },
    volumes: await (async () => {
      if (!provisioningConfig().enabled) return { warnBytes: volumeWarnBytes(), overThreshold: 0 };
      try {
        const docker = new DockerEngineClient();
        const df = await docker.systemDf();
        const warnBytes = volumeWarnBytes();
        const overThreshold = (df?.Volumes ?? []).filter(
          (volume) =>
            typeof volume.Name === "string" &&
            volume.Name.endsWith("-home") &&
            typeof volume.UsageData?.Size === "number" &&
            volume.UsageData.Size > warnBytes,
        ).length;
        return { warnBytes, overThreshold };
      } catch {
        return { warnBytes: volumeWarnBytes(), overThreshold: null };
      }
    })(),
    gateway: {
      version: trimmedOrNull(process.env.CODEX_GATEWAY_VERSION) ?? "unknown",
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
    },
    codex: { supportedVersion: SUPPORTED_CODEX_VERSION },
    provisioning: await provisioningDiagnostics(),
  };
});
