import http from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { recordFromUnknown } from "~~/shared/utils/records";

const DOCKER_API_VERSION = "v1.43";

export class DockerEngineError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "DockerEngineError";
  }
}

export class DockerEngineClient {
  constructor(private readonly socketPath: string = defaultDockerSocket()) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    const response = await new Promise<{
      statusCode: number;
      body: string;
    }>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          method,
          path: `/${DOCKER_API_VERSION}${path}`,
          headers: body === undefined ? {} : { "content-type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      request.on("error", reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
    const payload = tryParseJson(response.body);
    const message = typeof payload?.message === "string" ? payload.message : response.body.trim();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new DockerEngineError(
        message || `Docker Engine ${method} ${path} failed with ${response.statusCode}`,
        response.statusCode,
      );
    }
    return payload;
  }

  ping() {
    return this.request("GET", "/_ping");
  }

  inspectImage(name: string) {
    return this.request("GET", `/images/${encodeURIComponent(name)}/json`);
  }

  /** Pulls `fromImage:tag` when the image is not present locally. */
  async ensureImage(image: string) {
    const parts = image.split(":");
    const fromImage = parts[0] ?? image;
    const tag = parts[1] ?? "latest";
    try {
      await this.inspectImage(image);
      return;
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
    await this.requestRaw(
      "POST",
      `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
      120_000,
    );
  }

  inspectNetwork(name: string) {
    return this.request("GET", `/networks/${encodeURIComponent(name)}`);
  }

  createNetwork(input: {
    Name: string;
    Driver?: string;
    Internal?: boolean;
    Labels?: Record<string, string>;
    IPAM?: { Config: Array<{ Subnet: string; Gateway?: string }> };
  }) {
    return this.request("POST", "/networks/create", input);
  }

  removeNetwork(id: string) {
    return this.request("DELETE", `/networks/${encodeURIComponent(id)}`);
  }

  connectNetwork(networkId: string, containerId: string) {
    return this.request("POST", `/networks/${encodeURIComponent(networkId)}/connect`, {
      Container: containerId,
    });
  }

  disconnectNetwork(networkId: string, containerId: string, force = false) {
    return this.request("POST", `/networks/${encodeURIComponent(networkId)}/disconnect`, {
      Container: containerId,
      Force: force,
    });
  }

  createVolume(input: { Name: string; Labels?: Record<string, string> }) {
    return this.request("POST", "/volumes/create", input);
  }

  removeVolume(name: string, force = false) {
    return this.request("DELETE", `/volumes/${encodeURIComponent(name)}?force=${force}`);
  }

  createContainer(name: string, config: Record<string, unknown>) {
    return this.request("POST", `/containers/create?name=${encodeURIComponent(name)}`, config);
  }

  startContainer(id: string) {
    return this.request("POST", `/containers/${encodeURIComponent(id)}/start`);
  }

  stopContainer(id: string, timeoutSeconds = 10) {
    return this.request("POST", `/containers/${encodeURIComponent(id)}/stop?t=${timeoutSeconds}`);
  }

  removeContainer(id: string, options: { force?: boolean; volumes?: boolean } = {}) {
    const query = new URLSearchParams({
      force: String(options.force ?? false),
      v: String(options.volumes ?? false),
    });
    return this.request("DELETE", `/containers/${encodeURIComponent(id)}?${query}`);
  }

  inspectContainer(id: string) {
    return this.request("GET", `/containers/${encodeURIComponent(id)}/json`);
  }

  async listContainers(all = true): Promise<Array<{ Names?: unknown; State?: unknown }>> {
    const query = all ? "?all=true" : "";
    const body = await this.requestRaw("GET", `/containers/json${query}`, 8_000);
    const parsed: unknown = JSON.parse(body.toString("utf8") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { Names?: unknown; State?: unknown } =>
        typeof item === "object" && item !== null,
    );
  }

  async requestRaw(
    method: string,
    path: string,
    timeoutMs = 10_000,
    body?: Buffer,
    contentType = "application/json",
    onChunk?: (chunk: Buffer) => void,
  ): Promise<Buffer> {
    return await new Promise((resolve, reject) => {
      const request = http.request(
        { socketPath: this.socketPath, method, path: `/${DOCKER_API_VERSION}${path}` },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            onChunk?.(chunk);
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
        },
      );
      request.setTimeout(timeoutMs, () => request.destroy(new Error("Docker request timed out")));
      request.on("error", reject);
      if (body !== undefined) {
        request.setHeader("content-type", contentType);
        request.end(body);
      } else {
        request.end();
      }
    });
  }

  /**
   * Streams a (potentially multiplexed) Docker Engine API response body straight to `dest`
   * instead of buffering it in memory like `requestRaw` does. Volume backups can be hundreds of
   * MB now that the Codex standalone install lives under the user's home volume — buffering one
   * (plus the extra Buffer.concat/demux copies that used to follow) was enough to spike the
   * Gateway past its cgroup memory limit. `demuxChannel` filters the frame channel exactly like
   * `demuxDockerFrames` — 1 is stdout, 2 is stderr, undefined keeps both untouched.
   */
  async requestRawToStream(
    method: string,
    path: string,
    timeoutMs: number,
    dest: NodeJS.WritableStream,
    demuxChannel?: 1 | 2,
  ): Promise<void> {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.request(
        { socketPath: this.socketPath, method, path: `/${DOCKER_API_VERSION}${path}` },
        resolve,
      );
      request.setTimeout(timeoutMs, () => request.destroy(new Error("Docker request timed out")));
      request.on("error", reject);
      request.end();
    });
    if (demuxChannel === undefined) {
      await pipeline(response, dest);
    } else {
      await pipeline(response, createDockerFrameDemuxTransform(demuxChannel), dest);
    }
  }

  /**
   * Runs a command inside a container and resolves with its combined (demuxed) output and exit
   * code. Used for provisioning repair: appending an authorized key and probing `codex`.
   */
  async execInContainer(
    id: string,
    cmd: string[],
    user = "0",
  ): Promise<{ output: string; exitCode: number }> {
    const created = await this.request("POST", `/containers/${encodeURIComponent(id)}/exec`, {
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: user,
      Cmd: cmd,
    });
    const execId = String((created as { Id?: string } | null | undefined)?.Id ?? "");
    if (execId === "") throw new Error("Docker exec create returned no Id");
    const body = await this.requestRaw(
      "POST",
      `/exec/${encodeURIComponent(execId)}/start`,
      15_000,
      Buffer.from(JSON.stringify({ Detach: false, Tty: false })),
    );
    const inspect = await this.request("GET", `/exec/${encodeURIComponent(execId)}/json`);
    const exitCode = Number((inspect as { ExitCode?: number } | null | undefined)?.ExitCode ?? -1);
    return { output: demuxDockerLogFrames(body), exitCode };
  }

  async containerStats(id: string, timeoutMs = 5_000): Promise<DockerContainerStats | null> {
    const body = await this.requestRaw(
      "GET",
      `/containers/${encodeURIComponent(id)}/stats?stream=false`,
      timeoutMs,
    );
    return statsFromUnknown(JSON.parse(body.toString()));
  }

  async containerLogs(id: string, tail: number, timeoutMs = 10_000) {
    const body = await this.requestRaw(
      "GET",
      `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`,
      timeoutMs,
    );
    return demuxDockerLogFrames(body);
  }

  async systemDf(): Promise<{ Volumes?: DockerVolumeInfo[] } | null> {
    return await this.request("GET", "/system/df");
  }

  /**
   * Streams `POST /build` with a tar context. Returns the raw newline-delimited JSON stream the
   * daemon emits; callers parse `{stream|error}` progress lines themselves.
   */
  async buildImage(options: {
    tag: string;
    contextTar: Buffer;
    buildArgs: Record<string, string>;
    timeoutMs?: number;
    onChunk?: (chunk: Buffer) => void;
  }): Promise<string> {
    const params = new URLSearchParams({
      t: options.tag,
      buildargs: JSON.stringify(options.buildArgs),
      rm: "1",
    });
    const body = await this.requestRaw(
      "POST",
      `/build?${params}`,
      options.timeoutMs ?? 20 * 60_000,
      options.contextTar,
      "application/x-tar",
      options.onChunk,
    );
    return body.toString("utf8");
  }
}

export interface DockerContainerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number; limit?: number };
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function statsFromUnknown(value: unknown): DockerContainerStats {
  const root = recordFromUnknown(value) ?? {};
  const cpu = recordFromUnknown(root.cpu_stats);
  const preCpu = recordFromUnknown(root.precpu_stats);
  const cpuUsage = recordFromUnknown(cpu?.cpu_usage);
  const preCpuUsage = recordFromUnknown(preCpu?.cpu_usage);
  const memory = recordFromUnknown(root.memory_stats);
  return {
    cpu_stats:
      cpu === null
        ? undefined
        : {
            cpu_usage:
              cpuUsage === null
                ? undefined
                : {
                    total_usage: numberOrUndefined(cpuUsage.total_usage),
                    percpu_usage: Array.isArray(cpuUsage.percpu_usage)
                      ? cpuUsage.percpu_usage.filter(
                          (item): item is number => typeof item === "number",
                        )
                      : undefined,
                  },
            system_cpu_usage: numberOrUndefined(cpu.system_cpu_usage),
            online_cpus: numberOrUndefined(cpu.online_cpus),
          },
    precpu_stats:
      preCpu === null
        ? undefined
        : {
            cpu_usage:
              preCpuUsage === null
                ? undefined
                : { total_usage: numberOrUndefined(preCpuUsage.total_usage) },
            system_cpu_usage: numberOrUndefined(preCpu.system_cpu_usage),
          },
    memory_stats:
      memory === null
        ? undefined
        : {
            usage: numberOrUndefined(memory.usage),
            limit: numberOrUndefined(memory.limit),
          },
  };
}

export interface DockerVolumeInfo {
  Name?: string;
  UsageData?: { Size?: number };
}

/**
 * Binary-safe variant used for streamed tar archives (backups). `stream` filters the frame
 * channel — 1 is stdout, 2 is stderr; undefined keeps both.
 */
export function demuxDockerFrames(buffer: Buffer, stream?: 1 | 2): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const channel = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) break;
    if (stream === undefined || channel === stream) {
      chunks.push(buffer.subarray(offset + 8, end));
    }
    offset = end;
  }
  if (offset === 0) return buffer;
  if (offset < buffer.length) chunks.push(buffer.subarray(offset));
  return Buffer.concat(chunks);
}

/** Docker multiplexes log streams into frames: [stream(1), 0,0,0, length(4 BE)] + payload. */
export function demuxDockerLogFrames(buffer: Buffer) {
  return demuxDockerFrames(buffer).toString();
}

/**
 * Streaming counterpart to `demuxDockerFrames`: same frame format, but processes chunks
 * incrementally so memory stays bounded by one frame instead of the whole archive. Used by
 * `requestRawToStream` for volume backups.
 */
function createDockerFrameDemuxTransform(channel: 1 | 2): Transform {
  let pending: Buffer = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let offset = 0;
      while (offset + 8 <= pending.length) {
        const frameChannel = pending.readUInt8(offset);
        const length = pending.readUInt32BE(offset + 4);
        const frameEnd = offset + 8 + length;
        if (frameEnd > pending.length) break;
        if (frameChannel === channel) this.push(pending.subarray(offset + 8, frameEnd));
        offset = frameEnd;
      }
      // Copy the small leftover instead of keeping a subarray view that would pin the whole
      // (much larger) source chunk's backing buffer alive until the next frame completes.
      pending = offset > 0 ? Buffer.from(pending.subarray(offset)) : pending;
      callback();
    },
  });
}

export function defaultDockerSocket() {
  const configured = process.env.CODEX_GATEWAY_DOCKER_SOCKET?.trim();
  return configured === undefined || configured === "" ? "/var/run/docker.sock" : configured;
}

function tryParseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed));
    }
    return null;
  } catch {
    return null;
  }
}

export function isDockerNotFound(error: unknown) {
  return error instanceof DockerEngineError && error.statusCode === 404;
}
