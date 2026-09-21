import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gatewayDatabase } from "./storage/database";
import { provisioningConfig } from "./provisioning/provisioning-config";
import { DockerEngineClient, isDockerNotFound } from "./provisioning/docker-engine-client";
import { tarTreeReadable, tarTreeToStream } from "./provisioning/tar";
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
  // Write to a temp path and rename into place only on success, matching the previous
  // write-the-whole-Buffer-at-the-end behavior: a failed export must not leave a partial/corrupt
  // "completed" tar file sitting in the backup directory.
  const tempDest = `${dest}.part`;
  try {
    await docker.startContainer(id);
    // follow=1 streams until the container exits; stdout frames carry the archive bytes. Streamed
    // straight to disk instead of buffered in memory — a volume's tar can be hundreds of MB now
    // that the Codex standalone install lives under the user's home volume.
    const fileStream = createWriteStream(tempDest);
    try {
      await docker.requestRawToStream(
        "GET",
        `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&follow=1`,
        120_000,
        fileStream,
        1,
      );
    } finally {
      fileStream.close();
    }
    const waited = await docker.request("POST", `/containers/${encodeURIComponent(id)}/wait`);
    const statusCode = Number(waited?.StatusCode ?? -1);
    if (statusCode !== 0) {
      throw new Error(`volume ${volume} export exited with status ${statusCode}`);
    }
    renameSync(tempDest, dest);
  } catch (error) {
    rmSync(tempDest, { force: true });
    throw error;
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
    await tarTreeToStream(config.sharedAuthMount, createWriteStream(join(dir, "shared-auth.tar")));
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

/**
 * A tar of the named backup directory (db + shared-auth + every volume tar), streamed lazily.
 * Building this as a single Buffer used to re-buffer everything a backup already wrote to disk —
 * including the potentially hundreds-of-MB volume tars — a second time, in memory, per download.
 */
export function backupTarStream(name: string) {
  const path = backupPath(name);
  if (path === null) return null;
  return tarTreeReadable(path);
}
