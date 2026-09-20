<script setup lang="ts">
import { SearchIcon, ShieldIcon, SquarePenIcon } from "@lucide/vue";
import { computed, nextTick, onScopeDispose, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { SidebarFooter, SidebarTrigger } from "@codex-gateway/ui/sidebar";
import { toast } from "@codex-gateway/ui/sonner";
import SettingsPanel from "@/components/settings/SettingsPanel.vue";
import { useAuthStore } from "@/stores/auth";
import { gatewayPath } from "@/utils/gateway-url";
import { useLongPressContextMenu } from "@/composables/interactions/useLongPressContextMenu";
import { useWorkspaceLaunchActions } from "@/composables/workspace/useWorkspaceLaunchActions";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import { syncSelectedRoute } from "@/stores/gateway/thread-open/view-state";
import AddProjectDialog from "./AddProjectDialog.vue";
import HostMfaDialog from "./host-tree/HostMfaDialog.vue";
import ThreadRenameDialog from "./thread-list/ThreadRenameDialog.vue";
import SidebarProjectsSection from "./SidebarProjectsSection.vue";
import SidebarThreadsSection from "./thread-list/SidebarThreadsSection.vue";
import SidebarUserMenu from "./SidebarUserMenu.vue";
import ThreadSearchDialog from "./ThreadSearchDialog.vue";
import SidebarScrollArea from "./SidebarScrollArea.vue";
import { useSidebarTree } from "./host-tree/useSidebarTree";
import { useThreadRename } from "./thread-list/useThreadRename";
import { provideHostMfaDialog } from "@/composables/host-mfa/useHostMfaDialog";
import type { HostRecord, ProjectRecord } from "./sidebar-types";

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const bootstrap = useGatewayBootstrapStore();
const auth = useAuthStore();
const { t } = useI18n();
const showSettings = ref(false);
const showSearch = ref(false);
const projectEditor = ref<{ host: HostRecord; project: ProjectRecord | null } | null>(null);
const { longPressTriggered, longPressContextMenuHandlers } = useLongPressContextMenu();
const sidebarTree = useSidebarTree(longPressTriggered);
const threadRename = useThreadRename();
const workspaceActions = useWorkspaceLaunchActions();
const { mfaDialogHostId, closeMfaDialog } = provideHostMfaDialog();
// Inside a mobile Sheet there is no SidebarProvider, so the collapse trigger is desktop-only.
withDefaults(defineProps<{ collapsible?: boolean }>(), { collapsible: true });
const {
  hosts,
  pinnedThreads,
  threads,
  selectedHostId,
  selectedProjectId,
  selectedThreadId,
  availableProjectsByHost,
  missingProjectsByHost,
  hostConnectionStatuses,
} = sidebarTree;

const singleManagedHost = computed(() => {
  const list = hosts.value;
  return list.length === 1 && list[0]?.managed === true ? list[0] : null;
});
const selectedProject = computed(
  () => catalog.projects.find((project) => project.id === selectedProjectId.value) ?? null,
);
const projectPinnedThreads = computed(() =>
  pinnedThreads.value.filter(
    (thread) =>
      thread.hostId === selectedHostId.value &&
      (thread.projectId === null || thread.projectId === selectedProjectId.value),
  ),
);

function startNewThread() {
  if (selectedProject.value !== null) {
    sidebarTree.startThreadInProject(selectedProject.value);
    return;
  }
  const host = singleManagedHost.value ?? hosts.value[0] ?? null;
  const fallbackProject = host ? (availableProjectsByHost.value.get(host.id) ?? [])[0] : undefined;
  if (fallbackProject !== undefined) {
    sidebarTree.startThreadInProject(fallbackProject);
    return;
  }
  if (host !== null) {
    // No project selected: guide the user into the project creation dialog instead of failing.
    openAddProject(host);
    return;
  }
  // No workspace host is available at all yet: give explicit feedback instead of a silent no-op.
  toast.error(
    bootstrap.initializing ? t("app.newThreadWorkspaceLoading") : t("app.newThreadNoWorkspace"),
  );
}

onScopeDispose(gatewayDomainEvents.on("new-thread-requested", () => startNewThread()));

useEventListener(window, "keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "n") {
    event.preventDefault();
    startNewThread();
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "k") {
    event.preventDefault();
    showSearch.value = true;
  }
});

function openAddProject(host: HostRecord) {
  projectEditor.value = { host, project: null };
}

function openEditProject(project: ProjectRecord) {
  const host = hosts.value.find((item) => item.id === project.hostId);
  if (!host) {
    return;
  }
  projectEditor.value = { host, project };
}

async function openHostMonitor(host: HostRecord) {
  if (selectedHostId.value !== host.id) await catalog.selectHost(host.id);
  await nextTick();
  workspaceActions.openHostMonitor();
}

function selectProject(project: ProjectRecord, event: MouseEvent) {
  if (longPressTriggered.value) return;
  if (event.button !== 0) return;
  if (project.hostId !== selectedHostId.value) {
    void catalog.selectHost(project.hostId);
  }
  if (project.id !== selectedProjectId.value) {
    void catalog.selectProject(project.id);
  } else if (navigation.newThreadDraft || navigation.selectedThreadId !== null) {
    // Clicking the already-selected project leaves the draft/thread and shows the project page.
    navigation.newThreadDraft = false;
    navigation.selectedThreadId = null;
    syncSelectedRoute();
  }
}
</script>

<template>
  <aside
    v-bind="$attrs"
    class="relative flex h-full min-h-0 flex-col border-r border-hairline bg-canvas-soft"
  >
    <div class="flex h-12 shrink-0 items-center justify-between px-3">
      <span class="truncate text-sm font-semibold text-ink">Codex Gateway</span>
      <SidebarTrigger
        v-if="collapsible"
        data-testid="desktop-sidebar-collapse"
        :title="t('app.collapseSidebar')"
        :aria-label="t('app.collapseSidebar')"
      />
    </div>

    <div class="shrink-0 space-y-0.5 px-2 pb-2">
      <button
        type="button"
        data-testid="sidebar-new-thread"
        class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.875rem] text-ink hover:bg-surface"
        @click="startNewThread"
      >
        <SquarePenIcon class="size-[1.125rem] shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-left">{{ t("app.newThread") }}</span>
        <kbd class="text-[0.6875rem] text-ink-faint">⌘N</kbd>
      </button>
      <button
        type="button"
        data-testid="sidebar-search-threads"
        class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.875rem] text-ink hover:bg-surface"
        @click="showSearch = true"
      >
        <SearchIcon class="size-[1.125rem] shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-left">{{ t("app.searchThreads") }}</span>
        <kbd class="text-[0.6875rem] text-ink-faint">⌘K</kbd>
      </button>
    </div>

    <div class="flex min-h-0 flex-1 overflow-hidden px-2 pb-2">
      <SidebarScrollArea>
        <div class="min-w-0 max-w-full space-y-4 overflow-hidden pr-1">
          <SidebarProjectsSection
            :hosts="hosts"
            :projects-by-host="availableProjectsByHost"
            :missing-projects-by-host="missingProjectsByHost"
            :host-connection-statuses="hostConnectionStatuses"
            :selected-project-id="selectedProjectId"
            :long-press-handlers="longPressContextMenuHandlers"
            @select-project="selectProject"
            @start-thread="sidebarTree.startThreadInProject"
            @edit-project="openEditProject"
            @delete-project="(project) => catalog.deleteProject(project.id)"
            @add-project="openAddProject"
            @monitor-host="openHostMonitor"
            @delete-host="(host) => catalog.deleteHost(host.id)"
          />

          <SidebarThreadsSection
            v-if="selectedProjectId !== null"
            :threads="threads"
            :pinned-threads="projectPinnedThreads"
            :hosts="hosts"
            :selected-thread-id="selectedThreadId"
            :runtime-status="sidebarTree.threadRuntimeStatus"
            :completion-attention="sidebarTree.threadCompletionAttention"
            :pinned-runtime-status="sidebarTree.pinnedRuntimeStatus"
            :pinned-completion-attention="sidebarTree.pinnedCompletionAttention"
            :long-press-handlers="longPressContextMenuHandlers"
            @open-thread="(thread) => sidebarTree.openThread(String(thread.id))"
            @open-pinned-thread="sidebarTree.openPinnedThread"
            @toggle-pin="(thread) => navigation.setThreadPinned(String(thread.id), !thread.pinned)"
            @unpin="(thread) => navigation.setPinnedThread(thread, false)"
            @rename="threadRename.startRename"
          />
        </div>
      </SidebarScrollArea>
    </div>

    <SidebarFooter class="shrink-0 border-t border-hairline p-2">
      <button
        v-if="auth.isAdmin"
        type="button"
        data-testid="sidebar-admin-entry"
        class="mb-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.875rem] text-ink hover:bg-surface"
        @click="navigateTo(gatewayPath('admin'))"
      >
        <ShieldIcon class="size-[1.125rem] shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-left">{{ t("app.adminConsole") }}</span>
      </button>
      <SidebarUserMenu @settings="showSettings = true" />
    </SidebarFooter>

    <ThreadSearchDialog v-model:open="showSearch" />

    <Dialog v-model:open="showSettings">
      <DialogContent
        class="flex h-[min(54rem,calc(100vh-3rem))] w-[min(70rem,calc(100vw-3rem))] !max-w-[min(70rem,calc(100vw-3rem))] flex-col overflow-hidden p-0"
        data-testid="settings-dialog"
        close-button-test-id="settings-close-button"
      >
        <DialogHeader class="border-b border-hairline px-6 py-5">
          <DialogTitle class="text-lg">{{ t("app.settings") }}</DialogTitle>
          <DialogDescription>{{ t("app.settingsDescription") }}</DialogDescription>
        </DialogHeader>
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <SettingsPanel @close="showSettings = false" />
        </div>
      </DialogContent>
    </Dialog>

    <AddProjectDialog
      :open="Boolean(projectEditor)"
      :host="projectEditor?.host ?? null"
      :project="projectEditor?.project ?? null"
      @update:open="projectEditor = $event ? projectEditor : null"
    />

    <!-- Rename is a single modal workflow for desktop context-click and mobile long-press. Keep
         it outside row renderers: context menus unmount after selection, and an inline input inside
         that subtree loses focus or disappears when a mobile sidebar Sheet updates. -->
    <ThreadRenameDialog
      v-model:open="threadRename.open.value"
      v-model="threadRename.renameValue.value"
      :submitting="threadRename.submitting.value"
      @submit="threadRename.submitRename"
    />

    <HostMfaDialog
      :host-id="mfaDialogHostId"
      :open="mfaDialogHostId !== null"
      @update:open="closeMfaDialog"
    />
  </aside>
</template>
