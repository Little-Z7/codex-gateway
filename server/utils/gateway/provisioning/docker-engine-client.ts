import http from "node:http";

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
