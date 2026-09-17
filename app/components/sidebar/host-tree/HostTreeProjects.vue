<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon, FolderXIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import type { HostRecord } from "../sidebar-types";
import { formatRelative } from "../sidebar-utils";
import SidebarProjectRow from "./SidebarProjectRow.vue";
import ThreadRow from "../thread-list/ThreadRow.vue";
import { requireHostTreeController } from "./controller";

const props = defineProps<{ host: HostRecord }>();
const controller = requireHostTreeController();
</script>

<template>
  <div class="min-w-0 space-y-1 overflow-hidden">
    <div
      v-for="project in controller.availableProjectsByHost.get(props.host.id) ?? []"
      :key="project.id"
      class="min-w-0 space-y-1 overflow-hidden"
    >
      <SidebarProjectRow
        :project="project"
        :expanded="controller.expandedProjectIds.has(project.id)"
        :selected="project.id === controller.selectedProjectId"
        :long-press-handlers="controller.longPressHandlers"
        @select="controller.selectProject(project.id, $event)"
        @edit="controller.editProject(project)"
        @delete="controller.deleteProject(project.id)"
        @start-thread="controller.startThreadInProject(project)"
      />
      <div
        v-if="controller.expandedProjectIds.has(project.id)"
        class="min-w-0 space-y-1 overflow-hidden pl-7"
      >
        <template
          v-if="project.id === controller.selectedProjectId && controller.projectThreads.length"
        >
          <ThreadRow
            v-for="thread in controller.projectThreads"
            :key="thread.id"
            :thread="thread"
            :test-id="`thread-button-${thread.id}`"
            :selected="String(thread.id) === String(controller.selectedThreadId)"
            :status="controller.threadRuntimeStatus(project.hostId, String(thread.id))"
            :completion-attention="
              controller.threadCompletionAttention(project.hostId, String(thread.id))
            "
            :subtitle="formatRelative(thread.updatedAt)"
            :pin-label="thread.pinned ? $t('app.unpinThread') : $t('app.pinThread')"
            :long-press-handlers="controller.longPressHandlers"
            :show-pinned-icon="thread.pinned"
            @open="
              controller.openThread(String(thread.id), {
                hostId: project.hostId,
                projectId: project.id,
              })
            "
            @toggle-pin="controller.toggleThreadPin(String(thread.id), !thread.pinned)"
            @rename="controller.rename({ ...thread, hostId: project.hostId })"
          />
        </template>
        <div
          v-else-if="project.id === controller.selectedProjectId"
          class="rounded-lg px-3 py-2 text-xs leading-5 text-ink-muted"
        >
          <div>{{ $t("app.noThreads") }}</div>
        </div>
      </div>
    </div>

    <div
      v-if="(controller.missingProjectsByHost.get(props.host.id)?.length ?? 0) > 0"
      class="space-y-1"
    >
      <Button
        :data-testid="`missing-projects-toggle-${props.host.id}`"
        variant="ghost"
        class="h-9 w-full justify-start gap-2 rounded-lg px-3 text-xs font-normal text-ink-muted hover:bg-surface"
        @click="controller.toggleMissingProjects(props.host.id)"
      >
        <ChevronDownIcon
          v-if="controller.expandedMissingProjectHostIds.has(props.host.id)"
          class="size-3.5 shrink-0"
        />
        <ChevronRightIcon v-else class="size-3.5 shrink-0" />
        <FolderXIcon class="size-4 shrink-0 text-destructive/70" />
        <span class="min-w-0 flex-1 truncate text-left">{{ $t("app.missingProjects") }}</span>
        <span class="shrink-0 tabular-nums">{{
          controller.missingProjectsByHost.get(props.host.id)?.length ?? 0
        }}</span>
      </Button>
      <div v-if="controller.expandedMissingProjectHostIds.has(props.host.id)" class="space-y-1">
        <SidebarProjectRow
          v-for="project in controller.missingProjectsByHost.get(props.host.id) ?? []"
          :key="project.id"
          :project="project"
          :expanded="false"
          :selected="project.id === controller.selectedProjectId"
          :missing="true"
          :long-press-handlers="controller.longPressHandlers"
          @edit="controller.editProject(project)"
          @delete="controller.deleteProject(project.id)"
        />
      </div>
    </div>

    <div
      v-if="
        !controller.availableProjectsByHost.get(props.host.id)?.length &&
        !controller.missingProjectsByHost.get(props.host.id)?.length
      "
      class="rounded-lg px-3 py-2 text-xs text-ink-muted"
    >
      {{ $t("app.noProjects") }}
    </div>
  </div>
</template>
