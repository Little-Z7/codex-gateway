<script setup lang="ts">
import { EllipsisIcon, PencilIcon, PinIcon, PinOffIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import type { GatewayThread } from "~~/shared/types";
import type { HostRecord, PinnedThreadRecord, SidebarThreadRow } from "../sidebar-types";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import { selectedRowClass } from "../sidebar-utils";
import ThreadStatusIndicator from "./ThreadStatusIndicator.vue";
import { groupThreadsByTime } from "./thread-time-groups";

const props = defineProps<{
  threads: GatewayThread[];
  pinnedThreads: PinnedThreadRecord[];
  hosts: HostRecord[];
  selectedThreadId: string | null;
  runtimeStatus: (hostId: number, threadId: string) => ThreadRuntimeStatus;
  completionAttention: (hostId: number, threadId: string) => boolean;
  pinnedRuntimeStatus: (thread: PinnedThreadRecord) => ThreadRuntimeStatus;
  pinnedCompletionAttention: (thread: PinnedThreadRecord) => boolean;
  longPressHandlers?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  openThread: [thread: GatewayThread];
  openPinnedThread: [thread: PinnedThreadRecord];
  togglePin: [thread: GatewayThread];
  unpin: [thread: PinnedThreadRecord];
  rename: [thread: SidebarThreadRow];
}>();

const { t } = useI18n();
const bucketLabelKeys: Record<string, string> = {
  today: "app.threadGroupToday",
  yesterday: "app.threadGroupYesterday",
  last7: "app.threadGroupLast7",
  last30: "app.threadGroupLast30",
  earlier: "app.threadGroupEarlier",
};

const THREAD_PAGE_SIZE = 25;
const visibleLimit = ref(THREAD_PAGE_SIZE);
const unpinnedThreads = computed(() => props.threads.filter((thread) => thread.pinned !== true));
const visibleUnpinned = computed(() => unpinnedThreads.value.slice(0, visibleLimit.value));
const timeGroups = computed(() => groupThreadsByTime(visibleUnpinned.value));
const hiddenThreadCount = computed(() =>
  Math.max(0, unpinnedThreads.value.length - visibleLimit.value),
);

function showMoreThreads() {
  visibleLimit.value += THREAD_PAGE_SIZE;
}

const pressHandlers = computed(() => props.longPressHandlers ?? {});
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="px-3 pt-1 text-[0.75rem] font-medium uppercase tracking-wider text-ink-faint">
      {{ t("app.threadsSection") }}
    </div>

    <div v-if="pinnedThreads.length" class="min-w-0 space-y-0.5">
      <div class="px-3 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
        {{ t("app.threadGroupPinned") }}
      </div>
      <ContextMenu v-for="thread in pinnedThreads" :key="`${thread.hostId}-${thread.threadId}`">
        <ContextMenuTrigger as-child>
          <div class="group relative">
            <Button
              :data-testid="`pinned-thread-button-${thread.threadId}`"
              v-bind="pressHandlers"
              :data-selected="
                String(thread.threadId) === String(selectedThreadId) ? 'true' : 'false'
              "
              variant="ghost"
              class="h-9 w-full min-w-0 justify-start overflow-hidden rounded-lg px-3 text-[0.875rem] font-normal hover:bg-canvas-soft"
              :class="selectedRowClass(String(thread.threadId) === String(selectedThreadId))"
              @click="emit('openPinnedThread', thread)"
            >
              <PinIcon class="size-[1.125rem] shrink-0 text-accent-orange" />
              <span class="min-w-0 flex-1 truncate text-left" :title="thread.title">{{
                thread.title
              }}</span>
              <ThreadStatusIndicator
                :status="pinnedRuntimeStatus(thread)"
                :completion-attention="pinnedCompletionAttention(thread)"
              />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
          <ContextMenuItem @select="emit('rename', thread)">
            <PencilIcon class="mr-2 size-4" />
            {{ t("app.renameThread") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('unpin', thread)">
            <PinOffIcon class="mr-2 size-4" />
            {{ t("app.unpinThread") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>

    <div v-for="group in timeGroups" :key="group.bucket" class="min-w-0 space-y-0.5">
      <div class="px-3 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
        {{ t(bucketLabelKeys[group.bucket] ?? "app.threadGroupEarlier") }}
      </div>
      <ContextMenu v-for="thread in group.threads" :key="thread.id">
        <ContextMenuTrigger as-child>
          <div class="group relative">
            <Button
              :data-testid="`thread-button-${thread.id}`"
              v-bind="pressHandlers"
              :data-selected="String(thread.id) === String(selectedThreadId) ? 'true' : 'false'"
              variant="ghost"
              class="h-9 w-full min-w-0 justify-start overflow-hidden rounded-lg px-3 text-[0.875rem] font-normal hover:bg-canvas-soft"
              :class="selectedRowClass(String(thread.id) === String(selectedThreadId))"
              @click="emit('openThread', thread)"
            >
              <span class="min-w-0 flex-1 truncate text-left" :title="titleForThread(thread)">{{
                titleForThread(thread)
              }}</span>
              <ThreadStatusIndicator
                :status="runtimeStatus(thread.hostId, String(thread.id))"
                :completion-attention="completionAttention(thread.hostId, String(thread.id))"
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :data-testid="`thread-menu-${thread.id}`"
                  class="absolute right-1 top-1/2 hidden size-7 -translate-y-1/2 rounded-md text-ink-muted group-hover:block hover:bg-surface"
                  :aria-label="t('app.threadMenu')"
                  @click.stop
                >
                  <EllipsisIcon class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem @select="emit('rename', { ...thread, hostId: thread.hostId })">
                  <PencilIcon class="mr-2 size-4" />
                  {{ t("app.renameThread") }}
                </DropdownMenuItem>
                <DropdownMenuItem @select="emit('togglePin', thread)">
                  <PinIcon class="mr-2 size-4" />
                  {{ thread.pinned ? t("app.unpinThread") : t("app.pinThread") }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
          <ContextMenuItem @select="emit('rename', { ...thread, hostId: thread.hostId })">
            <PencilIcon class="mr-2 size-4" />
            {{ t("app.renameThread") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('togglePin', thread)">
            <PinIcon class="mr-2 size-4" />
            {{ thread.pinned ? t("app.unpinThread") : t("app.pinThread") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>

    <div
      v-if="!pinnedThreads.length && !timeGroups.length"
      class="px-3 py-1 text-xs text-ink-faint"
    >
      {{ t("app.noThreads") }}
    </div>

    <button
      v-if="hiddenThreadCount > 0"
      type="button"
      data-testid="sidebar-show-more-threads"
      class="h-9 w-full rounded-lg px-3 text-left text-[0.875rem] text-ink-muted hover:bg-canvas-soft hover:text-ink"
      @click="showMoreThreads"
    >
      {{ t("app.showMoreThreads") }}
    </button>
  </div>
</template>
