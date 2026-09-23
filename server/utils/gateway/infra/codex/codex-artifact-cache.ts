import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { trimmedOrFallback, trimmedOrNull } from "~~/shared/utils/strings";

// The standalone release archive is ~130MB and is identical for every host on the same version
// and target, so it belongs next to the database (a persistent volume in production) rather than
// in a per-install temp directory. Without this every host upgrade, every newly provisioned user
// container and every gateway restart re-downloads the same bytes -- painful behind a slow
// outbound proxy and the direct cause of intermittent provisioning timeouts.
const CACHED_VERSIONS_KEPT = 2;
// A crashed gateway can leave a .part behind; anything older than this cannot belong to a live
// download (RELEASE_ASSET_TIMEOUT_MS caps a single attempt at 10 minutes).
const STALE_PART_TTL_MS = 6 * 60 * 60_000;
// version comes from parsed Codex versions and assetName from a closed platform enum, but both
// end up in a filesystem path, so keep the traversal guard explicit rather than assumed.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function codexArtifactCacheDir() {
  const override = trimmedOrNull(process.env.CODEX_GATEWAY_CODEX_ARTIFACT_CACHE_DIR);
  if (override !== null) return resolve(override);
  const databasePath = resolve(
    trimmedOrFallback(process.env.CODEX_GATEWAY_DB_PATH, "/data/codex-gateway.db"),
  );
  return join(dirname(databasePath), "codex-artifacts");
}

/** Absolute path a cached asset occupies, or null when the name cannot be trusted in a path. */
export function codexArtifactCachePath(version: string, assetName: string) {
  if (!SAFE_PATH_SEGMENT.test(version) || !SAFE_PATH_SEGMENT.test(assetName)) return null;
  return join(codexArtifactCacheDir(), version, assetName);
}

/** Creates the cache directory for one version; false when the cache is unusable (fall back). */
export async function ensureCodexArtifactCacheDir(cachePath: string) {
  try {
    await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

/** A unique target per writer so two gateway processes sharing a cache dir cannot interleave. */
export function codexArtifactPartPath(cachePath: string) {
  return `${cachePath}.${process.pid}-${randomUUID().slice(0, 8)}.part`;
}

/** Size of the cached archive when it exists and hashes to `sha256`; null otherwise. */
export async function verifyCachedArtifact(cachePath: string, sha256: string) {
  try {
    const info = await stat(cachePath);
    if (!info.isFile()) return null;
    if ((await hashFileSha256(cachePath)) !== sha256) return null;
    return info.size;
  } catch {
    return null;
  }
}

/**
 * The digest recorded alongside a cached archive. Lets an install proceed from cache when release
 * metadata is temporarily unreachable, without ever skipping verification.
 */
export async function readCachedDigest(cachePath: string) {
  try {
    const recorded = (await readFile(`${cachePath}.sha256`, "utf8")).trim().toLowerCase();
    return SHA256_HEX.test(recorded) ? recorded : null;
  } catch {
    return null;
  }
}

export async function writeCachedDigest(cachePath: string, sha256: string) {
  await writeFile(`${cachePath}.sha256`, `${sha256}\n`, { mode: 0o600 });
}

/** Drops version directories beyond the newest few, plus .part files no writer can still own. */
export async function pruneCodexArtifactCache(keepVersion: string) {
  const root = codexArtifactCacheDir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  const others: Array<{ name: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keepVersion) continue;
    try {
      others.push({ name: entry.name, mtimeMs: (await stat(join(root, entry.name))).mtimeMs });
    } catch {
      // Raced with another gateway process pruning the same shared cache directory.
    }
  }
  others.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of others.slice(CACHED_VERSIONS_KEPT - 1)) {
    await rm(join(root, stale.name), { recursive: true, force: true }).catch(() => undefined);
  }

  await prunePartFiles(join(root, keepVersion));
}

async function prunePartFiles(directory: string) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_PART_TTL_MS;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
    const absolute = join(directory, entry.name);
    try {
      if ((await stat(absolute)).mtimeMs >= cutoff) continue;
    } catch {
      continue;
    }
    await rm(absolute, { force: true }).catch(() => undefined);
  }
}

export async function hashFileSha256(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
