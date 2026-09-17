import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import {
  DockerEngineClient,
  type DockerContainerStats,
} from "../../utils/gateway/provisioning/docker-engine-client";
import { provisioningConfig } from "../../utils/gateway/provisioning/provisioning-config";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";

function containerStatsSummary(stats: DockerContainerStats | null) {
  if (stats === null) {
    return { cpuPercent: null, memoryUsageBytes: null, memoryLimitBytes: null };
  }
  const cpuUsage = stats.cpu_stats?.cpu_usage?.total_usage;
  const preCpuUsage = stats.precpu_stats?.cpu_usage?.total_usage;
  const systemUsage = stats.cpu_stats?.system_cpu_usage;
  const preSystemUsage = stats.precpu_stats?.system_cpu_usage;
  const onlineCpus =
    stats.cpu_stats?.online_cpus ?? stats.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
  let cpuPercent: number | null = null;
  if (
    typeof cpuUsage === "number" &&
    typeof preCpuUsage === "number" &&
    typeof systemUsage === "number" &&
    typeof preSystemUsage === "number" &&
    systemUsage > preSystemUsage
  ) {
    cpuPercent = ((cpuUsage - preCpuUsage) / (systemUsage - preSystemUsage)) * onlineCpus * 100;
    cpuPercent = Math.round(cpuPercent * 10) / 10;
  }
  return {
    cpuPercent,
    memoryUsageBytes: stats.memory_stats?.usage ?? null,
    memoryLimitBytes: stats.memory_stats?.limit ?? null,
  };
}

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const docker = new DockerEngineClient();
  const enabled = provisioningConfig().enabled;
  const usersById = new Map(userStore.listUsers().map((user) => [user.id, user.username]));
  const rows = [...userStore.listManagedHosts().values()].filter(
    (managed) => managed.containerName !== null && managed.status !== "removed",
  );

  const containers = await Promise.all(
    rows.map(async (managed) => {
      const name = managed.containerName ?? "";
      let inspect: Record<string, unknown> | null = null;
      let stats: DockerContainerStats | null = null;
      try {
        inspect = await docker.inspectContainer(name);
      } catch {
        inspect = null;
      }
      const state = recordFromUnknown(inspect?.State);
      const running = state?.Running === true;
      const containerState = inspect === null ? "missing" : running ? "running" : "exited";
      if (containerState === "running") {
        try {
          stats = await docker.containerStats(name);
        } catch {
          stats = null;
        }
      }
      const summary = containerStatsSummary(stats);
      const config = recordFromUnknown(inspect?.Config);
      return {
        userId: managed.userId,
        username: usersById.get(managed.userId) ?? `#${managed.userId}`,
        containerName: managed.containerName,
        managedStatus: managed.status,
        state: containerState,
        startedAt: state ? stringFromUnknown(state.StartedAt) : null,
        image: config ? stringFromUnknown(config.Image) : null,
        cpuPercent: summary.cpuPercent,
        memoryUsageBytes: summary.memoryUsageBytes,
        memoryLimitBytes: summary.memoryLimitBytes,
        volumeName: managed.volumeName,
        volumeSizeBytes: null,
      };
    }),
  );
  return { enabled, containers };
});
