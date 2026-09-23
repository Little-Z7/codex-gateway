import { createWriteStream } from "node:fs";
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CodexRemotePlatform } from "./codex-platform";
import {
  codexArtifactCachePath,
  codexArtifactPartPath,
  ensureCodexArtifactCacheDir,
  hashFileSha256,
  pruneCodexArtifactCache,
  readCachedDigest,
  verifyCachedArtifact,
  writeCachedDigest,
} from "./codex-artifact-cache";
import { z } from "zod";

const ARTIFACT_IDLE_TTL_MS = 30_000;
const RELEASE_METADATA_TIMEOUT_MS = 30_000;
const RELEASE_ASSET_TIMEOUT_MS = 10 * 60_000;
// The standalone archive is ~130MB; a single mid-stream hiccup over a sandboxed outbound proxy
// (observed in practice: intermittent `fetch failed` partway through the body) previously failed
// the whole install with no retry. Bounded retry-with-backoff per URL before falling through to
// the next mirror (releases.openai.com, then GitHub) keeps the existing sha256 verification and
// partial-file cleanup unchanged and only adds resilience to transient network failures.
const DOWNLOAD_ATTEMPTS_PER_URL = 3;
const DOWNLOAD_RETRY_BACKOFF_MS = [2_000, 5_000];

export interface CodexArtifactBundle {
  releaseTarget: CodexRemotePlatform["releaseTarget"];
  standaloneArchive: {
    localPath: string;
    fileName: string;
    size: number;
    sha256: string;
    /** True when the archive came from the on-disk cache instead of a fresh download. */
    fromCache: boolean;
  };
}

interface SharedBundle {
  promise: Promise<PreparedBundle>;
  users: number;
  cleanupTimer: NodeJS.Timeout | null;
}

interface PreparedBundle {
  /** Drops scratch state once no lease holds the bundle; null for cached (retained) archives. */
  cleanup: (() => Promise<void>) | null;
  artifacts: CodexArtifactBundle;
}

export class CodexArtifactProvider {
  private readonly shared = new Map<string, SharedBundle>();

  async acquire(version: string, platform: CodexRemotePlatform) {
    const key = `${version}:${platform.releaseTarget}`;
    let entry = this.shared.get(key);
    if (entry === undefined) {
      const promise = prepareBundle(version, platform).catch((error) => {
        this.shared.delete(key);
        throw error;
      });
      entry = { promise, users: 0, cleanupTimer: null };
      this.shared.set(key, entry);
    }
    if (entry.cleanupTimer !== null) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = null;
    }
    entry.users += 1;
    try {
      const prepared = await entry.promise;
      return {
        artifacts: prepared.artifacts,
        release: () => {
          entry.users -= 1;
          if (entry.users === 0) this.scheduleCleanup(key, entry);
        },
      };
    } catch (error) {
      entry.users -= 1;
      if (entry.users === 0) this.scheduleCleanup(key, entry);
      throw error;
    }
  }

  private scheduleCleanup(key: string, entry: SharedBundle) {
    entry.cleanupTimer = setTimeout(() => {
      if (entry.users !== 0 || this.shared.get(key) !== entry) return;
      this.shared.delete(key);
      void entry.promise.then(({ cleanup }) => cleanup?.().catch(() => undefined));
    }, ARTIFACT_IDLE_TTL_MS);
    entry.cleanupTimer.unref();
  }
}

async function prepareBundle(
  version: string,
  platform: CodexRemotePlatform,
): Promise<PreparedBundle> {
  const assetName = standaloneAssetName(platform);
  const cachePath = codexArtifactCachePath(version, assetName);
  const cacheReady = cachePath !== null && (await ensureCodexArtifactCacheDir(cachePath));
  if (cachePath !== null && cacheReady) {
    return await prepareCachedBundle(version, platform, assetName, cachePath);
  }
  // Unusable cache location (unsafe name, or a data directory we cannot create/write): keep the
  // previous behavior of a throwaway temp copy rather than failing the install outright.
  artifactLog("cache unavailable, downloading to a temporary directory", { version, assetName });
  return await prepareEphemeralBundle(version, platform, assetName);
}

async function prepareCachedBundle(
  version: string,
  platform: CodexRemotePlatform,
  assetName: string,
  cachePath: string,
): Promise<PreparedBundle> {
  const release = await resolveStandaloneReleaseOrCached(version, platform, assetName, cachePath);
  const cachedSize = await verifyCachedArtifact(cachePath, release.sha256);
  if (cachedSize !== null) {
    artifactLog("cache hit", { version, assetName, sizeBytes: cachedSize });
    return {
      cleanup: null,
      artifacts: bundle(platform, cachePath, assetName, cachedSize, release.sha256, true),
    };
  }

  if (release.downloadUrls.length === 0) {
    throw new Error(
      `Codex ${version} ${assetName} is not cached and its release metadata is unreachable`,
    );
  }
  artifactLog("cache miss, downloading", { version, assetName });
  // Download beside the final name so publishing is one atomic rename, and so a concurrent writer
  // (another gateway process sharing the data volume) is never observed mid-write.
  const partPath = codexArtifactPartPath(cachePath);
  try {
    await downloadVerifiedArchive(release, partPath);
    await rename(partPath, cachePath);
    await writeCachedDigest(cachePath, release.sha256);
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const file = await stat(cachePath);
  artifactLog("cached", { version, assetName, sizeBytes: file.size });
  await pruneCodexArtifactCache(version);
  return {
    cleanup: null,
    artifacts: bundle(platform, cachePath, assetName, file.size, release.sha256, false),
  };
}

async function prepareEphemeralBundle(
  version: string,
  platform: CodexRemotePlatform,
  assetName: string,
): Promise<PreparedBundle> {
  const directory = await mkdtemp(join(tmpdir(), "codex-gateway-artifacts-"));
  const release = await resolveStandaloneRelease(version, platform, assetName);
  const archivePath = join(directory, assetName);
  try {
    await downloadVerifiedArchive(release, archivePath);
    const file = await stat(archivePath);
    return {
      cleanup: () => rm(directory, { recursive: true, force: true }),
      artifacts: bundle(platform, archivePath, assetName, file.size, release.sha256, false),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function bundle(
  platform: CodexRemotePlatform,
  localPath: string,
  fileName: string,
  size: number,
  sha256: string,
  fromCache: boolean,
): CodexArtifactBundle {
  return {
    releaseTarget: platform.releaseTarget,
    standaloneArchive: { localPath, fileName, size, sha256, fromCache },
  };
}

function artifactLog(event: string, details: Record<string, unknown>) {
  console.info("[gateway-artifacts]", { event, ...details });
}

export interface StandaloneRelease {
  assetName: string;
  downloadUrls: string[];
  sha256: string;
}

interface ReleaseAsset {
  name: string;
  digest: string;
  url: string;
}

const releaseAssetSchema = z
  .object({
    name: z.string().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    browser_download_url: z.url(),
  })
  .transform(({ name, digest, browser_download_url }) => ({
    name,
    digest,
    url: browser_download_url,
  }));

const releaseMetadataSchema = z.object({
  assets: z.array(releaseAssetSchema),
});

function standaloneAssetName(platform: CodexRemotePlatform) {
  return `codex-package-${platform.releaseTarget}.tar.gz`;
}

/**
 * Release metadata is the authority on the expected digest, but it sits behind the same outbound
 * path as the download itself. When it is temporarily unreachable and the cache already holds this
 * asset, the digest recorded when that copy was verified stands in — the archive is still hashed
 * against it, so a corrupt cache entry is still rejected; only the network round-trip is skipped.
 */
async function resolveStandaloneReleaseOrCached(
  version: string,
  platform: CodexRemotePlatform,
  assetName: string,
  cachePath: string,
): Promise<StandaloneRelease> {
  try {
    return await resolveStandaloneRelease(version, platform, assetName);
  } catch (error) {
    const recorded = await readCachedDigest(cachePath);
    if (recorded === null) throw error;
    artifactLog("release metadata unavailable, using the recorded cache digest", {
      version,
      assetName,
      message: error instanceof Error ? error.message : String(error),
    });
    return { assetName, downloadUrls: [], sha256: recorded };
  }
}

async function resolveStandaloneRelease(
  version: string,
  platform: CodexRemotePlatform,
  assetName = standaloneAssetName(platform),
): Promise<StandaloneRelease> {
  const releasesUrl = `https://releases.openai.com/codex/releases/${version}/release.json`;
  const githubUrl = `https://api.github.com/repos/openai/codex/releases/tags/rust-v${version}`;
  const metadataUrls = [releasesUrl, githubUrl];
  const assets: ReleaseAsset[] = [];
  const failures: string[] = [];

  for (const metadataUrl of metadataUrls) {
    try {
      assets.push(...(await readReleaseAssets(metadataUrl)));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const candidates = assets.filter((asset) => asset.name === assetName);
  if (candidates.length === 0) {
    throw new Error(
      [
        `Codex ${version} does not publish ${assetName}`,
        failures.length > 0 ? `Release metadata failures: ${failures.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  const sha256 = candidates[0]!.digest.slice("sha256:".length).toLowerCase();
  // releases.openai.com is preferred because the official installer uses it first. The GitHub
  // asset remains a verification-preserving fallback for temporarily unavailable infrastructure.
  return {
    assetName,
    downloadUrls: [...new Set(candidates.map(({ url }) => url))],
    sha256,
  };
}

async function readReleaseAssets(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(RELEASE_METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return releaseMetadataSchema.parse(await response.json()).assets;
}

export async function downloadVerifiedArchive(release: StandaloneRelease, outputPath: string) {
  const failures: string[] = [];
  for (const url of release.downloadUrls) {
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS_PER_URL; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(RELEASE_ASSET_TIMEOUT_MS),
        });
        if (!response.ok || response.body === null) {
          throw new Error(`HTTP ${response.status}`);
        }
        await pipeline(Readable.from(response.body), createWriteStream(outputPath));
        const actual = await hashFileSha256(outputPath);
        if (actual !== release.sha256) {
          throw new Error(`SHA-256 mismatch: expected ${release.sha256}, received ${actual}`);
        }
        return;
      } catch (error) {
        failures.push(
          `${url} (attempt ${attempt}/${DOWNLOAD_ATTEMPTS_PER_URL}): ${error instanceof Error ? error.message : String(error)}`,
        );
        // Always clear a partial/corrupt file before the next attempt or URL picks up cleanly.
        await rm(outputPath, { force: true });
        if (attempt < DOWNLOAD_ATTEMPTS_PER_URL) {
          await sleep(DOWNLOAD_RETRY_BACKOFF_MS[attempt - 1] ?? 5_000);
        }
      }
    }
  }
  throw new Error(
    `Failed to download official Codex archive ${release.assetName}: ${failures.join("; ")}`,
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
