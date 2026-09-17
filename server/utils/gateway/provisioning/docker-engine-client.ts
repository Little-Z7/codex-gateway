import http from "node:http";
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

  inspectNetwork(name: string) {
    return this.request("GET", `/networks/${encodeURIComponent(name)}`);
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

  async requestRaw(
    method: string,
    path: string,
    timeoutMs = 10_000,
    body?: Buffer,
  ): Promise<Buffer> {
    return await new Promise((resolve, reject) => {
      const request = http.request(
        { socketPath: this.socketPath, method, path: `/${DOCKER_API_VERSION}${path}` },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        },
      );
      request.setTimeout(timeoutMs, () => request.destroy(new Error("Docker request timed out")));
      request.on("error", reject);
      if (body !== undefined) {
        request.setHeader("content-type", "application/json");
        request.end(body);
      } else {
        request.end();
      }
    });
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

/** Docker multiplexes log streams into frames: [stream(1), 0,0,0, length(4 BE)] + payload. */
export function demuxDockerLogFrames(buffer: Buffer) {
  const lines: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) {
      break;
    }
    lines.push(buffer.subarray(offset + 8, end));
    offset = end;
  }
  // If the buffer was not framed (e.g. TTY container), treat it as plain text.
  if (offset === 0) {
    return buffer.toString();
  }
  if (offset < buffer.length) {
    lines.push(buffer.subarray(offset));
  }
  return Buffer.concat(lines).toString();
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
