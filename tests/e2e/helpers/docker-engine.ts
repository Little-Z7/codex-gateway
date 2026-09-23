import http from "node:http";
import { z } from "zod";

const SOCKET = process.env.E2E_DOCKER_SOCKET ?? "/var/run/docker.sock";
const API = "v1.44";

function request(method: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method, path: `/${API}${path}` }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // plain-text responses (e.g. errors) stay as strings
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error("docker request timed out")));
    req.on("error", reject);
    req.end();
  });
}

const containerListSchema = z.array(z.looseObject({ Names: z.array(z.string()) }));

async function resolveContainerName(name: string): Promise<string> {
  const res = await request("GET", `/containers/json?all=1`);
  if (res.status === 200) {
    const match = containerListSchema
      .parse(res.body)
      .find((entry) =>
        entry.Names.some(
          (n) =>
            n.replace(/^\//, "") === name ||
            n.replace(/^\//, "").endsWith(`-${name}-1`) ||
            n.replace(/^\//, "").endsWith(`_${name}_1`),
        ),
      );
    const found = match?.Names[0]?.replace(/^\//, "");
    if (found !== undefined && found !== "") return found;
  }
  return name;
}

export async function dockerRestartContainer(name: string) {
  const resolved = await resolveContainerName(name);
  const res = await request("POST", `/containers/${encodeURIComponent(resolved)}/restart`);
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`restart ${name} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

const containerInspectSchema = z.looseObject({
  HostConfig: z.looseObject({
    LogConfig: z.looseObject({ Type: z.string(), Config: z.record(z.string(), z.string()) }),
    Memory: z.number().optional(),
    NanoCpus: z.number().optional(),
    CapDrop: z.array(z.string()).nullable().optional(),
    CapAdd: z.array(z.string()).nullable().optional(),
    SecurityOpt: z.array(z.string()).nullable().optional(),
  }),
});

export async function dockerInspectContainer(name: string) {
  const res = await request("GET", `/containers/${encodeURIComponent(name)}/json`);
  if (res.status !== 200) {
    throw new Error(`inspect ${name} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return containerInspectSchema.parse(res.body);
}

export async function dockerContainerHealthy(name: string): Promise<boolean> {
  const resolved = await resolveContainerName(name);
  const res = await request("GET", `/containers/${encodeURIComponent(resolved)}/json`);
  if (res.status !== 200) return false;
  const record = z
    .looseObject({ State: z.looseObject({ Health: z.looseObject({ Status: z.string() }) }) })
    .parse(res.body);
  return record.State.Health.Status === "healthy";
}

export async function dockerContainerLogs(name: string, tail = 500): Promise<string> {
  const resolved = await resolveContainerName(name);
  const res = await request(
    "GET",
    `/containers/${encodeURIComponent(resolved)}/logs?stdout=1&stderr=1&tail=${tail}`,
  );
  return typeof res.body === "string" ? res.body : JSON.stringify(res.body);
}

const networkSettingsSchema = z.looseObject({
  NetworkSettings: z.looseObject({
    Networks: z.record(z.string(), z.looseObject({ IPAddress: z.string() })),
  }),
});

/** The container's IP address on a given Docker network (matched by network name, not ID). */
export async function dockerContainerNetworkIp(name: string, networkName: string): Promise<string> {
  const resolved = await resolveContainerName(name);
  const res = await request("GET", `/containers/${encodeURIComponent(resolved)}/json`);
  if (res.status !== 200) {
    throw new Error(`inspect ${name} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const parsed = networkSettingsSchema.parse(res.body);
  const ip = parsed.NetworkSettings.Networks[networkName]?.IPAddress;
  if (ip === undefined || ip === "") {
    throw new Error(`container ${name} has no IP on network ${networkName}`);
  }
  return ip;
}

const networkInspectSchema = z.looseObject({
  IPAM: z.looseObject({
    Config: z.array(z.looseObject({ Gateway: z.string().optional() })),
  }),
});

/** The Docker-assigned gateway (bridge) IP of a network -- the host's own address on that L2
 *  segment, reachable from any container on the network regardless of `Internal: true`. */
export async function dockerNetworkGatewayIp(networkName: string): Promise<string> {
  const res = await request("GET", `/networks/${encodeURIComponent(networkName)}`);
  if (res.status !== 200) {
    throw new Error(
      `inspect network ${networkName} failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const parsed = networkInspectSchema.parse(res.body);
  const gateway = parsed.IPAM.Config[0]?.Gateway;
  if (gateway === undefined || gateway === "") {
    throw new Error(`network ${networkName} has no gateway address`);
  }
  return gateway;
}

/**
 * Docker Engine API exec: create + start (non-detached) + inspect for the exit code, demuxing the
 * multiplexed stdout/stderr frame stream (see server/utils/gateway/provisioning/
 * docker-engine-client.ts's execInContainer for the production equivalent -- duplicated here
 * rather than imported so this file keeps its existing, deliberately self-contained raw-socket
 * style instead of depending on the Nuxt `~~/` alias resolving under the Playwright TS loader).
 */
export async function dockerExecInContainer(
  name: string,
  cmd: string[],
  user?: string,
): Promise<{ output: string; exitCode: number }> {
  const resolved = await resolveContainerName(name);
  const createSchema = z.looseObject({ Id: z.string() });
  const execBody = {
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: cmd,
    ...(user === undefined ? {} : { User: user }),
  };
  const createRes = await requestWithBody(
    "POST",
    `/containers/${encodeURIComponent(resolved)}/exec`,
    execBody,
  );
  const execId = createSchema.parse(createRes.body).Id;
  const startRes = await requestWithBody(
    "POST",
    `/exec/${encodeURIComponent(execId)}/start`,
    { Detach: false, Tty: false },
    true,
  );
  const inspectRes = await request("GET", `/exec/${encodeURIComponent(execId)}/json`);
  const inspectSchema = z.looseObject({ ExitCode: z.number().nullable() });
  const exitCode = inspectSchema.parse(inspectRes.body).ExitCode ?? -1;
  return { output: demuxDockerFrames(startRes.rawBody ?? Buffer.alloc(0)), exitCode };
}

function demuxDockerFrames(buffer: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) break;
    chunks.push(buffer.subarray(offset + 8, end));
    offset = end;
  }
  if (offset === 0) return buffer.toString();
  return Buffer.concat(chunks).toString();
}

function requestWithBody(
  method: string,
  path: string,
  body: unknown,
  raw = false,
): Promise<{ status: number; body: unknown; rawBody?: Buffer }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        socketPath: SOCKET,
        method,
        path: `/${API}${path}`,
        headers: { "content-type": "application/json", "content-length": payload.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          if (raw) {
            resolve({ status: res.statusCode ?? 0, body: rawBody.toString(), rawBody });
            return;
          }
          const text = rawBody.toString();
          let parsedBody: unknown = text;
          try {
            parsedBody = JSON.parse(text);
          } catch {
            // plain-text responses stay as strings
          }
          resolve({ status: res.statusCode ?? 0, body: parsedBody });
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error("docker request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
