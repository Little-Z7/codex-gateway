import { existsSync, readFileSync } from "node:fs";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { join } from "node:path";
import { DockerEngineClient } from "./docker-engine-client";
import { provisioningConfig } from "./provisioning-config";

export type SharedLoginState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "pending"; url: string; code: string; startedAt: string }
  | { status: "success"; accountEmail: string | null }
  | { status: "error"; message: string };

const TIMEOUT_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 1_500;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

interface SharedLoginSession {
  containerId: string;
  startedAt: number;
  timer: NodeJS.Timeout | null;
}

let state: SharedLoginState = { status: "idle" };
let session: SharedLoginSession | null = null;

function stripAnsi(text: string) {
  return text.replace(ANSI_PATTERN, "");
}

/** Codex prints "Open this link ... <url>" then "Enter this one-time code ... <code>". */
export function parseDeviceAuthOutput(output: string): { url: string; code: string } | null {
  const clean = stripAnsi(output);
  const url = clean.match(/https:\/\/[^\s]+\/codex\/device[^\s]*/)?.[0] ?? null;
  let code: string | null = null;
  const lines = clean.split(/\r?\n/);
  const codeStep = lines.findIndex((line) => /one-time code/i.test(line));
  if (codeStep >= 0) {
    for (const line of lines.slice(codeStep + 1)) {
      const match = line.trim().match(/^([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+)$/);
      if (match) {
        code = match[1] ?? null;
        break;
      }
    }
  }
  if (url === null || code === null) {
    return null;
  }
  return { url, code };
}

async function pollLogin(docker: DockerEngineClient, active: SharedLoginSession) {
  const config = provisioningConfig();
  const authFile = config.sharedAuthDir === null ? null : join(config.sharedAuthMount, "auth.json");
  try {
    const inspect = await docker.inspectContainer(active.containerId);
    const containerState = recordFromUnknown(inspect?.State) ?? {};
    const running = containerState.Running === true;
    const exitCode = typeof containerState.ExitCode === "number" ? containerState.ExitCode : -1;

    const logs = await docker.containerLogs(active.containerId, 500).catch(() => "");
    const parsed = parseDeviceAuthOutput(logs);
    if (parsed !== null && state.status !== "success") {
      state = {
        status: "pending",
        url: parsed.url,
        code: parsed.code,
        startedAt: new Date(active.startedAt).toISOString(),
      };
    }

    const authReady = authFile !== null && existsSync(authFile);
    if (!running) {
      await finish(active, exitCode === 0 && authReady, logs);
      return;
    }
    if (authReady) {
      await finish(active, true, logs);
      return;
    }
    if (Date.now() - active.startedAt > TIMEOUT_MS) {
      await finish(active, false, "Device login timed out after 15 minutes");
      return;
    }
  } catch (error) {
    await finish(active, false, error instanceof Error ? error.message : String(error));
    return;
  }
  active.timer = setTimeout(() => void pollLogin(docker, active), POLL_INTERVAL_MS);
}

async function finish(active: SharedLoginSession, success: boolean, detail: string) {
  if (active.timer !== null) {
    clearTimeout(active.timer);
  }
  session = null;
  const docker = new DockerEngineClient();
  await docker.removeContainer(active.containerId, { force: true }).catch(() => {});
  if (success) {
    state = { status: "success", accountEmail: sharedAuthAccountEmail() };
  } else {
    const clean = stripAnsi(detail).trim();
    const message = clean.length > 500 ? clean.slice(-500) : clean;
    state = { status: "error", message: message || "Shared login failed" };
  }
}

export function sharedAuthAccountEmail() {
  const config = provisioningConfig();
  if (config.sharedAuthDir === null) {
    return null;
  }
  try {
    const raw = readFileSync(join(config.sharedAuthMount, "auth.json"), "utf8");
    const parsed = recordFromUnknown(JSON.parse(raw));
    const tokens = recordFromUnknown(parsed?.tokens);
    const idToken = tokens ? stringFromUnknown(tokens.id_token) : null;
    if (typeof idToken !== "string") {
      return null;
    }
    const payload = idToken.split(".")[1];
    if (payload === undefined) {
      return null;
    }
    const claims = recordFromUnknown(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return claims ? stringFromUnknown(claims.email) : null;
  } catch {
    return null;
  }
}

export function sharedAuthStatus() {
  const config = provisioningConfig();
  const authPath = config.sharedAuthDir === null ? null : join(config.sharedAuthMount, "auth.json");
  let present = false;
  let lastRefresh: string | null = null;
  if (authPath !== null && existsSync(authPath)) {
    present = true;
    try {
      const parsed = recordFromUnknown(JSON.parse(readFileSync(authPath, "utf8")));
      lastRefresh = parsed ? stringFromUnknown(parsed.last_refresh) : null;
    } catch {
      lastRefresh = null;
    }
  }
  return { present, accountEmail: sharedAuthAccountEmail(), lastRefresh };
}

export const sharedLogin = {
  status(): SharedLoginState & { enabled: boolean; auth: ReturnType<typeof sharedAuthStatus> } {
    return { ...state, enabled: provisioningConfig().enabled, auth: sharedAuthStatus() };
  },

  async start(): Promise<void> {
    const config = provisioningConfig();
    if (!config.enabled || config.sharedAuthDir === null) {
      throw new Error("Provisioning or the shared auth directory is not configured");
    }
    if (session !== null || state.status === "starting" || state.status === "pending") {
      throw new Error("A shared login is already in progress");
    }
    state = { status: "starting" };
    const docker = new DockerEngineClient();
    const name = `codex-gateway-shared-login-${Date.now()}`;
    try {
      const created = await docker.createContainer(name, {
        Image: config.userImage,
        User: "1000:1000",
        Env: [`CODEX_HOME=${config.sharedAuthMount}`, "HOME=/tmp"],
        // The user image entrypoint starts sshd; the login helper must run codex directly.
        Entrypoint: ["codex"],
        Cmd: ["login", "--device-auth"],
        Labels: { "codex-gateway.shared-login": "true" },
        HostConfig: {
          AutoRemove: false,
          NetworkMode: config.dockerNetwork ?? "bridge",
          Binds: [`${config.sharedAuthDir}:${config.sharedAuthMount}`],
        },
      });
      const containerId = String(created?.Id ?? created?.id);
      session = { containerId, startedAt: Date.now(), timer: null };
      await docker.startContainer(containerId);
      const active = session;
      active.timer = setTimeout(() => void pollLogin(docker, active), POLL_INTERVAL_MS);
    } catch (error) {
      session = null;
      state = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  },

  async cancel(): Promise<void> {
    if (session === null) {
      state = { status: "idle" };
      return;
    }
    const active = session;
    session = null;
    if (active.timer !== null) {
      clearTimeout(active.timer);
    }
    const docker = new DockerEngineClient();
    await docker.stopContainer(active.containerId, 5).catch(() => {});
    await docker.removeContainer(active.containerId, { force: true }).catch(() => {});
    state = { status: "idle" };
  },
};
