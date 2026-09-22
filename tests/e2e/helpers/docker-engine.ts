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
