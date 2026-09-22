import type { GatewayThread } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { sortThreads } from "../thread-utils/identity";
import { isAppServerSubAgentThread } from "~~/shared/runtime/app-server";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { gatewayDomainEvents } from "../domain-events";
import {
  clearActiveTerminalProcess,
  rememberActiveTerminalProcess,
} from "../thread-turns/terminal-processes";

export function registerThreadProjectionSubscribers() {
  gatewayDomainEvents.on("thread-summary-detected", (event) => {
    const projects = useGatewayCatalogStore().projects;
    useGatewayThreadActivityStore().upsertAppServerThread(event.hostId, event.thread, projects);
    // Keep the open project's thread list live: thread/started events are the realtime source,
    // so a new conversation appears in the sidebar without a manual refresh.
    const navigation = useGatewayNavigationStore();
    if (event.hostId !== navigation.selectedHostId) return;
    const thread = event.thread;
    if (isAppServerSubAgentThread(thread)) return;
    const index = navigation.threads.findIndex(
      (candidate) => String(candidate.id) === String(thread.id),
    );
    const projectId = projects.find((candidate) => candidate.remotePath === thread.cwd)?.id ?? null;
    if (index < 0 && projectId !== navigation.selectedProjectId) return;
    const existing = index >= 0 ? navigation.threads[index] : undefined;
    const next: GatewayThread = {
      ...thread,
      appServerProjectId: thread.projectId ?? null,
      hostId: event.hostId,
      projectId: existing?.projectId ?? projectId,
      pinned: existing?.pinned ?? false,
      title: existing?.title ?? null,
    };
    navigation.threads = sortThreads(
      index >= 0
        ? navigation.threads.with(index, { ...existing, ...next })
        : [...navigation.threads, next],
    );
  });
  gatewayDomainEvents.on("remote-files-changed", (event) => {
    useGatewayFileWorkspaceStore().markRemoteFilesChanged(
      event.hostId,
      event.threadId,
      event.paths,
    );
  });
  gatewayDomainEvents.on("thread-status-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadStatus(event.hostId, event.threadId, event.status, {
      turnId: event.turnId,
    });
  });
  gatewayDomainEvents.on("terminal-process-detected", rememberActiveTerminalProcess);
  gatewayDomainEvents.on("terminal-process-completed", clearActiveTerminalProcess);
  gatewayDomainEvents.on("thread-settings-detected", (event) => {
    useGatewayComposerStore().setThreadSettings(event.hostId, event.threadId, event.settings);
  });
  gatewayDomainEvents.on("thread-token-usage-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadTokenUsage(
      event.hostId,
      event.threadId,
      event.tokenUsage,
    );
  });
}
