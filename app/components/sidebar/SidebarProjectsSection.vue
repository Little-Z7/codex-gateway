<script setup lang="ts">
import {
  ChartNoAxesCombinedIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderXIcon,
  PencilIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
type HostConnectionStatusMap = Record<
  number,
  { status: string; message?: string | null; updatedAt?: number }
>;
import type { HostRecord, ProjectRecord } from "./sidebar-types";
import { selectedRowClass } from "./sidebar-utils";
import { useHostMfaDialog } from "@/composables/host-mfa/useHostMfaDialog";

const props = defineProps<{
  hosts: HostRecord[];
  projectsByHost: Map<number, ProjectRecord[]>;
  missingProjectsByHost: Map<number, ProjectRecord[]>;
  hostConnectionStatuses: HostConnectionStatusMap;
  selectedProjectId: number | null;
  longPressHandlers?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  selectProject: [project: ProjectRecord, event: MouseEvent];
  startThread: [project: ProjectRecord];
  editProject: [project: ProjectRecord];
  deleteProject: [project: ProjectRecord];
  addProject: [host: HostRecord];
  monitorHost: [host: HostRecord];
  deleteHost: [host: HostRecord];
}>();

const { t } = useI18n();
const { openMfaDialog } = useHostMfaDialog();
const multipleHosts = computed(() => props.hosts.length > 1);
const pressHandlers = computed(() => props.longPressHandlers ?? {});

function hostOnline(hostId: number) {
  return props.hostConnectionStatuses[hostId]?.status === "connected";
}

function hostNeedsMfa(hostId: number) {
  return ["mfaRequired", "mfaConnecting"].includes(
    props.hostConnectionStatuses[hostId]?.status ?? "",
  );
}

function hostStatusTitle(hostId: number) {
  return props.hostConnectionStatuses[hostId]?.message ?? "";
}
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="px-3 pt-1 text-[0.75rem] font-medium text-ink-faint">
      {{ t("app.projectsSection") }}
    </div>

    <div v-for="host in hosts" :key="host.id" class="min-w-0 space-y-0.5">
      <!-- Host sub-section header: only rendered when the user has more than one host, so a
           single-workspace member sees a flat project list like ChatGPT's. -->
      <ContextMenu v-if="multipleHosts">
        <ContextMenuTrigger as-child>
          <div
            :data-testid="`host-button-${host.id}`"
            v-bind="pressHandlers"
            class="flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-medium text-ink-muted hover:bg-canvas-soft"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="hostOnline(host.id) ? 'bg-accent-green' : 'bg-ink-faint/50'"
              :title="hostStatusTitle(host.id)"
            />
            <span class="min-w-0 flex-1 truncate">{{ host.name }}</span>
            <button
              v-if="hostNeedsMfa(host.id)"
              type="button"
              :data-testid="`host-mfa-button-${host.id}`"
              class="shrink-0 rounded-full border border-accent-orange/40 px-2 text-[0.6875rem] leading-4 text-accent-orange"
              @click.stop="openMfaDialog(host.id)"
            >
              {{ t("app.hostMfaRequired") }}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
          <ContextMenuItem @select="emit('monitorHost', host)">
            <ChartNoAxesCombinedIcon class="mr-2 size-4" />
            {{ t("app.openHostMonitor") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('addProject', host)">
            <FolderPlusIcon class="mr-2 size-4" />
            {{ t("app.addProject") }}
          </ContextMenuItem>
          <ContextMenuItem
            class="text-destructive focus:text-destructive"
            @select="emit('deleteHost', host)"
          >
            <Trash2Icon class="mr-2 size-4" />
            {{ t("app.deleteHost") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ContextMenu v-for="project in projectsByHost.get(host.id) ?? []" :key="project.id">
        <ContextMenuTrigger as-child>
          <Button
            :data-testid="`project-button-${project.id}`"
            v-bind="pressHandlers"
            variant="ghost"
            class="h-9 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-sm font-normal hover:bg-canvas-soft"
            :class="selectedRowClass(project.id === selectedProjectId)"
            @click="emit('selectProject', project, $event)"
          >
            <FolderIcon class="size-4 shrink-0 text-ink-muted" />
            <span class="min-w-0 flex-1 truncate text-left">{{ project.name }}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
          <ContextMenuItem @select="emit('startThread', project)">
            <SquarePenIcon class="mr-2 size-4" />
            {{ t("app.newThread") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('editProject', project)">
            <PencilIcon class="mr-2 size-4" />
            {{ t("app.editProject") }}
          </ContextMenuItem>
          <ContextMenuItem
            class="text-destructive focus:text-destructive"
            @select="emit('deleteProject', project)"
          >
            <Trash2Icon class="mr-2 size-4" />
            {{ t("app.deleteProject") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ContextMenu
        v-for="project in missingProjectsByHost.get(host.id) ?? []"
        :key="`missing-${project.id}`"
      >
        <ContextMenuTrigger as-child>
          <Button
            :data-testid="`project-button-${project.id}`"
            variant="ghost"
            class="h-9 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-sm font-normal text-ink-faint hover:bg-canvas-soft"
            data-project-missing="true"
          >
            <FolderXIcon class="size-4 shrink-0 text-destructive/70" />
            <span class="min-w-0 flex-1 truncate text-left">{{ project.name }}</span>
            <span class="text-[0.6875rem]">{{ t("app.projectDirectoryMissing") }}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
          <ContextMenuItem @select="emit('editProject', project)">
            <FolderOpenIcon class="mr-2 size-4" />
            {{ t("app.editProject") }}
          </ContextMenuItem>
          <ContextMenuItem
            class="text-destructive focus:text-destructive"
            @select="emit('deleteProject', project)"
          >
            <Trash2Icon class="mr-2 size-4" />
            {{ t("app.deleteProject") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Button
        :data-testid="`sidebar-new-project-${host.id}`"
        variant="ghost"
        class="h-9 w-full justify-start gap-2 rounded-lg px-3 text-sm font-normal text-ink-muted hover:bg-canvas-soft"
        @click="emit('addProject', host)"
      >
        <PlusIcon class="size-4 shrink-0" />
        {{ t("app.newProject") }}
      </Button>
    </div>
  </div>
</template>
