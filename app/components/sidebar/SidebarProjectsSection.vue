<script setup lang="ts">
import {
  ChartNoAxesCombinedIcon,
  ChevronRightIcon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@codex-gateway/ui/tooltip";
type HostConnectionStatusMap = Record<
  number,
  { status: string; message?: string | null; updatedAt?: number }
>;
import type { HostRecord, ProjectRecord } from "./sidebar-types";
import { hostConnectionLabelKey, selectedRowClass } from "./sidebar-utils";
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
const expandedMissingHosts = ref(new Set<number>());
const sectionAddHost = computed(() => {
  if (props.hosts.length !== 1) return null;
  const host = props.hosts[0];
  if (host === undefined) return null;
  return showHostHeader(host) ? null : host;
});

function toggleMissingProjects(hostId: number) {
  const next = new Set(expandedMissingHosts.value);
  if (next.has(hostId)) next.delete(hostId);
  else next.add(hostId);
  expandedMissingHosts.value = next;
}

function hostOnline(hostId: number) {
  return props.hostConnectionStatuses[hostId]?.status === "connected";
}

// The host header is hidden for the common single-connected-host case, but must stay
// reachable whenever the host itself needs an action (MFA, reconnect, failure) or has
// no projects to show yet.
function showHostHeader(host: HostRecord) {
  if (multipleHosts.value) return true;
  const status = props.hostConnectionStatuses[host.id]?.status ?? "idle";
  if (status !== "connected") return true;
  return (props.projectsByHost.get(host.id) ?? []).length === 0;
}

function hostNeedsMfa(hostId: number) {
  return ["mfaRequired", "mfaConnecting"].includes(
    props.hostConnectionStatuses[hostId]?.status ?? "",
  );
}

function hostStatusTitle(hostId: number) {
  return props.hostConnectionStatuses[hostId]?.message ?? "";
}

function hostStatusLabel(hostId: number) {
  const status = props.hostConnectionStatuses[hostId]?.status ?? "idle";
  return t(hostConnectionLabelKey(status));
}
</script>

<template>
  <TooltipProvider>
    <div class="min-w-0 space-y-3">
      <div class="flex h-9 items-center gap-1 px-1">
        <div
          class="min-w-0 flex-1 px-2 text-[0.75rem] font-medium uppercase tracking-wider text-ink-faint"
        >
          {{ t("app.projectsSection") }}
        </div>
        <Tooltip v-if="sectionAddHost">
          <TooltipTrigger as-child>
            <Button
              :data-testid="`sidebar-new-project-${sectionAddHost.id}`"
              variant="ghost"
              size="icon-sm"
              class="size-7 rounded-md text-ink-muted hover:bg-canvas-soft hover:text-ink"
              :aria-label="t('app.newProject')"
              @click="emit('addProject', sectionAddHost)"
            >
              <PlusIcon class="size-[1.125rem]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("app.newProject") }}</TooltipContent>
        </Tooltip>
      </div>

      <div v-for="host in hosts" :key="host.id" class="min-w-0 space-y-0.5">
        <!-- Host sub-section header: hidden for the common single connected host so a
           single-workspace member sees a flat project list like ChatGPT's. -->
        <ContextMenu v-if="showHostHeader(host)">
          <ContextMenuTrigger as-child>
            <div
              :data-testid="`host-button-${host.id}`"
              v-bind="pressHandlers"
              class="group flex h-9 items-center gap-2 rounded-lg px-3 text-[0.875rem] font-medium text-ink-secondary hover:bg-canvas-soft"
            >
              <span
                role="img"
                class="size-1.5 shrink-0 rounded-full"
                :class="hostOnline(host.id) ? 'bg-accent-green' : 'bg-ink-faint/50'"
                :aria-label="hostStatusLabel(host.id)"
                :title="hostStatusTitle(host.id)"
              />
              <span class="min-w-0 flex-1 truncate" :title="host.sshHost">{{ host.name }}</span>
              <button
                v-if="hostNeedsMfa(host.id)"
                type="button"
                :data-testid="`host-mfa-button-${host.id}`"
                class="shrink-0 rounded-full border border-accent-orange/40 px-2 text-[0.6875rem] leading-4 text-accent-orange"
                @click.stop="openMfaDialog(host.id)"
              >
                {{ t("app.hostMfaRequired") }}
              </button>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    :data-testid="`sidebar-new-project-${host.id}`"
                    variant="ghost"
                    size="icon-sm"
                    class="size-7 rounded-md text-ink-muted hover:bg-surface hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    :aria-label="t('app.newProject')"
                    @click.stop="emit('addProject', host)"
                  >
                    <PlusIcon class="size-[1.125rem]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t("app.newProject") }}</TooltipContent>
              </Tooltip>
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
              data-project-missing="false"
              variant="ghost"
              class="h-9 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-[0.875rem] font-normal hover:bg-canvas-soft"
              :class="[
                selectedRowClass(project.id === selectedProjectId),
                showHostHeader(host) ? 'ml-3' : '',
              ]"
              @click="emit('selectProject', project, $event)"
            >
              <FolderIcon class="size-[1.125rem] shrink-0 text-ink-muted" />
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

        <template v-if="(missingProjectsByHost.get(host.id) ?? []).length > 0">
          <Button
            :data-testid="`missing-projects-toggle-${host.id}`"
            variant="ghost"
            class="h-9 w-full justify-start gap-2 rounded-lg px-3 text-sm font-normal text-ink-faint hover:bg-canvas-soft"
            :class="showHostHeader(host) ? 'ml-3' : ''"
            :aria-expanded="expandedMissingHosts.has(host.id)"
            @click="toggleMissingProjects(host.id)"
          >
            <ChevronRightIcon
              class="size-3.5 shrink-0 transition-transform"
              :class="expandedMissingHosts.has(host.id) ? 'rotate-90' : ''"
            />
            {{ t("app.missingProjects") }} ·
            {{ (missingProjectsByHost.get(host.id) ?? []).length }}
          </Button>
          <template v-if="expandedMissingHosts.has(host.id)">
            <ContextMenu
              v-for="project in missingProjectsByHost.get(host.id) ?? []"
              :key="`missing-${project.id}`"
            >
              <ContextMenuTrigger as-child>
                <Button
                  :data-testid="`project-button-${project.id}`"
                  variant="ghost"
                  class="h-9 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-sm font-normal text-ink-faint hover:bg-canvas-soft"
                  :class="showHostHeader(host) ? 'ml-3' : ''"
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
          </template>
        </template>
      </div>
    </div>
  </TooltipProvider>
</template>
