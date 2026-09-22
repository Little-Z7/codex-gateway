import { existsSync } from "node:fs";
import { DockerEngineClient } from "./docker-engine-client";
import { provisioningConfig } from "./provisioning-config";
import { tarDirectory } from "./tar";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { SUPPORTED_CODEX_VERSION } from "../infra/codex/codex-version";

export interface ImageRebuildState {
  status: "idle" | "running" | "success" | "error";
  lines: string[];
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

// One build at a time; state lives in memory so a gateway restart resets to idle.
const state: ImageRebuildState = {
  status: "idle",
  lines: [],
  startedAt: null,
  finishedAt: null,
  message: null,
};

const CONTEXT_DIR_CANDIDATES = ["/app/deploy/user-container", "deploy/user-container"];

function contextDir(): string {
  const found = CONTEXT_DIR_CANDIDATES.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error("user-container build context not mounted");
  }
  return found;
}

export function imageRebuildStatus(): ImageRebuildState {
  return { ...state, lines: [...state.lines] };
}

export async function imageInfo() {
  const config = provisioningConfig();
  const docker = new DockerEngineClient();
  try {
    const inspect = recordFromUnknown(await docker.inspectImage(config.userImage));
    if (inspect === null) throw new Error("image inspect returned nothing");
    const labels = recordFromUnknown(recordFromUnknown(inspect.Config)?.Labels) ?? {};
    const repoDigests = inspect.RepoDigests;
    return {
      image: config.userImage,
      present: true,
      digest:
        Array.isArray(repoDigests) && typeof repoDigests[0] === "string"
          ? repoDigests[0]
          : stringFromUnknown(inspect.Id),
      created: stringFromUnknown(inspect.Created),
      codexVersion: stringFromUnknown(labels["codex-gateway.codex-version"]),
      builtAt: stringFromUnknown(labels["codex-gateway.built-at"]),
      supportedCodexVersion: SUPPORTED_CODEX_VERSION,
    };
  } catch {
    return {
      image: config.userImage,
      present: false,
      digest: null,
      created: null,
      codexVersion: null,
      builtAt: null,
      supportedCodexVersion: SUPPORTED_CODEX_VERSION,
    };
  }
}

export async function startImageRebuild(options: { codexVersion?: string } = {}) {
  if (state.status === "running") {
    throw new Error("An image rebuild is already running");
  }
  const version = options.codexVersion ?? SUPPORTED_CODEX_VERSION;
  state.status = "running";
  state.lines = [];
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.message = null;

  const parseLine = (trimmed: string) => {
    const parsed = recordFromUnknown(JSON.parse(trimmed)) ?? {};
    const text =
      stringFromUnknown(parsed.stream) ??
      stringFromUnknown(parsed.status) ??
      stringFromUnknown(parsed.error);
    if (text !== null) state.lines.push(text.trimEnd());
    if (typeof parsed.error === "string") return parsed.error;
    // Daemon-level failures (bad tar, bad buildargs) arrive as a lone `{"message": …}`.
    if (
      typeof parsed.message === "string" &&
      parsed.stream === undefined &&
      parsed.status === undefined &&
      parsed.aux === undefined
    ) {
      return parsed.message;
    }
    return null;
  };

  void (async () => {
    try {
      let streamFailed: string | null = null;
      let pending = "";
      await new DockerEngineClient().buildImage({
        tag: provisioningConfig().userImage,
        contextTar: tarDirectory(contextDir()),
        buildArgs: {
          CODEX_CLI_VERSION: version,
          CODEX_GATEWAY_BUILT_AT: state.startedAt ?? "",
        },
        onChunk: (chunk) => {
          pending += chunk.toString("utf8");
          let index = pending.indexOf("\n");
          while (index >= 0) {
            const line = pending.slice(0, index).trim();
            pending = pending.slice(index + 1);
            if (line !== "") {
              const failure = parseLine(line);
              if (failure !== null) streamFailed = failure;
            }
            index = pending.indexOf("\n");
          }
        },
      });
      // The final line may lack a trailing newline; only the unparsed tail remains.
      let failed: string | null = streamFailed;
      for (const line of pending.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        const failure = parseLine(trimmed);
        if (failure !== null) failed = failure;
      }
      if (failed !== null) throw new Error(failed);
      state.status = "success";
    } catch (error) {
      state.status = "error";
      state.message = error instanceof Error ? error.message : "image build failed";
    } finally {
      state.finishedAt = new Date().toISOString();
    }
  })();
  return imageRebuildStatus();
}

export interface RecreateAllState {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  total: number;
  completed: number;
  currentUser: string | null;
  failures: { username: string; error: string }[];
  startedAt: string | null;
  finishedAt: string | null;
}

const recreateState: RecreateAllState = {
  status: "idle",
  total: 0,
  completed: 0,
  currentUser: null,
  failures: [],
  startedAt: null,
  finishedAt: null,
};
let recreateCancelled = false;

export function recreateAllStatus(): RecreateAllState {
  return { ...recreateState, failures: [...recreateState.failures] };
}

export function cancelRecreateAll() {
  recreateCancelled = true;
}

export interface RecreateAllRunner {
  userIds: number[];
  deprovision: (userId: number) => Promise<void>;
  provision: (userId: number) => Promise<void>;
  usernameFor: (userId: number) => string;
}

export function startRecreateAll(runner: RecreateAllRunner, intervalSeconds: number) {
  if (recreateState.status === "running") {
    throw new Error("A recreate-all task is already running");
  }
  recreateState.status = "running";
  recreateState.total = runner.userIds.length;
  recreateState.completed = 0;
  recreateState.failures = [];
  recreateState.currentUser = null;
  recreateState.startedAt = new Date().toISOString();
  recreateState.finishedAt = null;
  recreateCancelled = false;

  void (async () => {
    for (const userId of runner.userIds) {
      if (recreateCancelled) break;
      const username = runner.usernameFor(userId);
      recreateState.currentUser = username;
      try {
        await runner.deprovision(userId);
        await runner.provision(userId);
      } catch (error) {
        recreateState.failures.push({
          username,
          error: error instanceof Error ? error.message : "recreate failed",
        });
      }
      recreateState.completed += 1;
      if (recreateCancelled) break;
      if (recreateState.completed < recreateState.total) {
        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      }
    }
    recreateState.currentUser = null;
    recreateState.finishedAt = new Date().toISOString();
    recreateState.status = recreateCancelled ? "cancelled" : "done";
  })();
  return recreateAllStatus();
}
