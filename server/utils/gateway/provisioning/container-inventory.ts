import { userStore } from "../auth/users";
import { DockerEngineClient, type DockerContainerStats } from "./docker-engine-client";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";

export interface AdminContainerRow {
  userId: number;
  username: string;
  containerName: string;
  managedStatus: string;
  state: "running" | "exited" | "missing";
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

export function containerStatsSummary(stats: DockerContainerStats | null) {
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

// `codex --version` inside a container is cheap but not free; cache per container identity for
// 10 minutes so the admin list stays fast while containers restart underneath.
const CODEX_VERSION_TTL_MS = 10 * 60_000;
const codexVersionCache = new Map<string, { version: string | null; at: number }>();

async function probeContainerCodexVersion(
  docker: DockerEngineClient,
  containerName: string,
): Promise<string | null> {
  const cached = codexVersionCache.get(containerName);
  if (cached !== undefined && Date.now() - cached.at < CODEX_VERSION_TTL_MS) {
    return cached.version;
  }
  let version: string | null = null;
  try {
    const probe = await docker.execInContainer(containerName, ["codex", "--version"], "dev");
    if (probe.exitCode === 0) {
      const match = /codex\s+(?:cli\s+)?([0-9]+\.[0-9]+\.[0-9]+)/i.exec(probe.output);
      version = match?.[1] ?? probe.output.trim().split(/\s+/).pop() ?? null;
    }
  } catch {
    version = null;
  }
  codexVersionCache.set(containerName, { version, at: Date.now() });
  return version;
}

export function invalidateCodexVersionCache(containerName?: string) {
  if (containerName === undefined) {
    codexVersionCache.clear();
  } else {
    codexVersionCache.delete(containerName);
  }
}

function shortDigest(imageRef: string | null) {
  if (imageRef === null) return null;
  const digest = imageRef.includes("@") ? (imageRef.split("@")[1] ?? imageRef) : imageRef;
  const hex = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return hex.length > 12 ? hex.slice(0, 12) : hex;
}

export async function listManagedContainers(): Promise<AdminContainerRow[]> {
  const docker = new DockerEngineClient();
  const usersById = new Map(userStore.listUsers().map((user) => [user.id, user.username]));
  const rows = [...userStore.listManagedHosts().values()].filter(
    (managed) => managed.containerName !== null && managed.status !== "removed",
  );

  return await Promise.all(
    rows.map(async (managed) => {
      const name = managed.containerName ?? "";
      let inspect: Record<string, unknown> | null = null;
      let stats: DockerContainerStats | null = null;
      let codexVersion: string | null = null;
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
        codexVersion = await probeContainerCodexVersion(docker, name);
      }
      const summary = containerStatsSummary(stats);
      const config = recordFromUnknown(inspect?.Config);
      return {
        userId: managed.userId,
        username: usersById.get(managed.userId) ?? `#${managed.userId}`,
        containerName: managed.containerName ?? "",
        managedStatus: managed.status,
        state: containerState,
        startedAt: state ? stringFromUnknown(state.StartedAt) : null,
        image: config ? stringFromUnknown(config.Image) : null,
        imageDigest: shortDigest(inspect ? stringFromUnknown(inspect.Image) : null),
        codexVersion,
        cpuPercent: summary.cpuPercent,
        memoryUsageBytes: summary.memoryUsageBytes,
        memoryLimitBytes: summary.memoryLimitBytes,
        volumeName: managed.volumeName,
        volumeSizeBytes: null,
      };
    }),
  );
}

export function volumeWarnBytes(): number {
  const raw = process.env.CODEX_GATEWAY_VOLUME_WARN_BYTES;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20 * 1024 ** 3;
}
