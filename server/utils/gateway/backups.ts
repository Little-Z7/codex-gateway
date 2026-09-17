import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gatewayDatabase } from "./storage/database";
import { provisioningConfig } from "./provisioning/provisioning-config";
import {
  demuxDockerFrames,
  DockerEngineClient,
  isDockerNotFound,
} from "./provisioning/docker-engine-client";
import { tarTree } from "./provisioning/tar";
import { trimmedOrFallback } from "~~/shared/utils/strings";
import { runtimeLog } from "./runtime/runtime-log";

function databasePath() {
  return resolve(trimmedOrFallback(process.env.CODEX_GATEWAY_DB_PATH, "/data/codex-gateway.db"));
}

export function backupsDir() {
  return join(dirname(databasePath()), "backups");
}

export interface BackupInfo {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(absolute);
    else if (entry.isFile()) total += statSync(absolute).size;
  }
  return total;
}

export function listBackups(): BackupInfo[] {
  const root = backupsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(root, entry.name);
      return {
        name: entry.name,
        path,
        sizeBytes: dirSizeBytes(path),
        createdAt: statSync(path).mtime.toISOString(),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(name: string): string | null {
  // Only plain directory names are servable — no traversal.
  if (basename(name) !== name || name === "" || name === "." || name === "..") return null;
  const path = join(backupsDir(), name);
  if (!existsSync(path) || !statSync(path).isDirectory()) return null;
  return path;
}

export function deleteBackup(name: string) {
  const path = backupPath(name);
  if (path === null) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

/** Streams `tar` output out of a scratch container mounting the volume read-only. */
async function exportVolumeTar(docker: DockerEngineClient, volume: string, dest: string) {
  const containerName = `codex-gateway-backup-${Date.now()}`;
  const created = await docker.createContainer(containerName, {
    Image: "alpine:latest",
    Cmd: ["tar", "-C", "/src", "-cf", "-", "."],
    HostConfig: { Binds: [`${volume}:/src:ro`], AutoRemove: false },
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const id = typeof created?.Id === "string" ? created.Id : "";
  if (id === "") throw new Error(`backup container create returned no Id for ${volume}`);
  try {
    await docker.startContainer(id);
    // follow=1 streams until the container exits; stdout frames carry the archive bytes.
    const raw = await docker.requestRaw(
      "GET",
      `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&follow=1`,
      120_000,
    );
    const waited = await docker.request("POST", `/containers/${encodeURIComponent(id)}/wait`);
    const statusCode = Number(waited?.StatusCode ?? -1);
    if (statusCode !== 0) {
      throw new Error(`volume ${volume} export exited with status ${statusCode}`);
    }
    writeFileSync(dest, demuxDockerFrames(raw, 1));
  } finally {
    await docker.removeContainer(id, { force: true }).catch(() => {});
  }
}

export async function runBackup(): Promise<{ name: string; files: string[] }> {
  const name = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(backupsDir(), name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files: string[] = [];

  // Consistent SQLite snapshot without depending on host sqlite3 binaries.
  const dbDest = join(dir, "codex-gateway.db");
  gatewayDatabase().exec(`VACUUM INTO '${dbDest.replace(/'/g, "''")}'`);
  files.push("codex-gateway.db");

  const config = provisioningConfig();
  // The shared auth dir is mounted read-only inside the Gateway container at sharedAuthMount.
  if (existsSync(config.sharedAuthMount)) {
    writeFileSync(join(dir, "shared-auth.tar"), tarTree(config.sharedAuthMount));
    files.push("shared-auth.tar");
  }

  const docker = new DockerEngineClient();
  try {
    await docker.ensureImage("alpine:latest");
    const volumes = (await docker.request("GET", "/volumes")) as {
      Volumes?: Array<{ Name?: string }>;
    } | null;
    const prefix = config.containerPrefix;
    for (const volume of volumes?.Volumes ?? []) {
      const volumeName = volume.Name ?? "";
      if (!volumeName.startsWith(prefix) || !volumeName.endsWith("-home")) continue;
      try {
        const dest = join(dir, `${volumeName}.tar`);
        await exportVolumeTar(docker, volumeName, dest);
        files.push(`${volumeName}.tar`);
      } catch (error) {
        // A missing pull or busy volume must not discard the DB/auth backups already written.
        runtimeLog("backup volume export failed", {
          volume: volumeName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    if (!isDockerNotFound(error)) {
      runtimeLog("backup volume enumeration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, createdAt: new Date().toISOString(), files }, null, 2),
  );
  return { name, files };
}

export function backupTarStream(name: string): Buffer | null {
  const path = backupPath(name);
  if (path === null) return null;
  return tarTree(path);
}
