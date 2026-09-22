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
import {
  budgetDefaults,
  effectiveLimitsFor,
  listUserBudgetRows,
} from "../../utils/gateway/usage/budget-store";
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
    const inspectable = [...managedHosts.values()].filter(
      (managed) =>
        managed.status !== "provisioning" &&
        managed.status !== "error" &&
        managed.containerName !== null &&
        managed.status !== "removed",
    );
    const states = await userContainerProvisioner.inspectByNames(
      inspectable.map((managed) => managed.containerName ?? ""),
    );
    for (const managed of managedHosts.values()) {
      if (managed.status === "provisioning") {
        containerCounts.provisioning += 1;
        continue;
      }
      if (managed.status === "error") {
        containerCounts.error += 1;
        continue;
      }
      if (managed.containerName === null || managed.status === "removed") continue;
      const state = states.get(managed.containerName)?.state ?? "missing";
      if (state === "running" || state === "exited" || state === "missing") {
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
    usage: { today: usageStore.todayTotals(), overBudgetUsers: countOverBudgetUsers() },
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

function countOverBudgetUsers() {
  const defaults = budgetDefaults();
  const rows = listUserBudgetRows();
  const usageByUser = new Map(usageStore.usageByUser().map((row) => [row.userId, row]));
  let count = 0;
  for (const user of userStore.listUsers()) {
    const { limits } = effectiveLimitsFor(rows.get(user.id) ?? null, defaults);
    const usage = usageByUser.get(user.id);
    const dailyTokens = usage?.dailyTokens ?? 0;
    const monthlyTokens = usage?.monthlyTokens ?? 0;
    const dailyTurns = usage?.dailyTurns ?? 0;
    const monthlyTurns = usage?.monthlyTurns ?? 0;
    if (
      (limits.dailyTokens !== null && dailyTokens >= limits.dailyTokens) ||
      (limits.monthlyTokens !== null && monthlyTokens >= limits.monthlyTokens) ||
      (limits.dailyTurns !== null && dailyTurns >= limits.dailyTurns) ||
      (limits.monthlyTurns !== null && monthlyTurns >= limits.monthlyTurns)
    ) {
      count += 1;
    }
  }
  return count;
}
