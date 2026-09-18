<script setup lang="ts">
import { Clock3Icon, MessageSquareTextIcon, PinIcon, PinOffIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import { useLongPressContextMenu } from "@/composables/interactions/useLongPressContextMenu";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import { formatRelative } from "@/components/sidebar/sidebar-utils";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import NewThreadHero from "@/components/chat/NewThreadHero.vue";
import type { GatewayThread } from "~~/shared/types";

const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const { t } = useI18n();
const { selectedHostId, selectedProjectId, selectedThreadId, threads } = storeToRefs(navigation);
const { currentThread, loading } = storeToRefs(threadView);
const { longPressTriggered, longPressContextMenuHandlers } = useLongPressContextMenu();

const recentThreads = computed(() =>
  [...threads.value]
    .sort(
      (a, b) => Number(b.recencyAt || b.updatedAt || 0) - Number(a.recencyAt || a.updatedAt || 0),
    )
    .slice(0, 10),
);

function titleFor(thread: GatewayThread) {
  if (String(thread.id) === String(selectedThreadId.value) && currentThread.value) {
    return titleForThread({ ...thread, ...currentThread.value });
  }
  return titleForThread(thread);
}

function openThread(threadId: string) {
  if (longPressTriggered.value) {
    return;
  }
  void threadView.openThread(threadId, {
    hostId: selectedHostId.value ?? undefined,
    projectId: selectedProjectId.value,
  });
}
</script>

<template>
  <section
    data-testid="project-thread-list"
    class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8"
  >
    <NewThreadHero project-page>
      <ChatComposer />
    </NewThreadHero>

    <div v-if="recentThreads.length || loading" class="w-full">
      <div class="mb-2 px-1 text-xs font-medium text-ink-faint">
        {{ t("app.recentThreads") }}
      </div>
      <div class="space-y-0.5">
        <ContextMenu v-for="thread in recentThreads" :key="thread.id">
          <ContextMenuTrigger as-child>
            <Button
              variant="ghost"
              :data-testid="`project-thread-row-${thread.id}`"
              v-bind="longPressContextMenuHandlers"
              class="h-9 w-full items-center justify-start gap-3 rounded-lg px-3 text-left font-normal hover:bg-canvas-soft"
              @click="openThread(String(thread.id))"
            >
              <MessageSquareTextIcon class="size-4 shrink-0 text-ink-muted" />
              <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ titleFor(thread) }}</span>
              <span class="flex shrink-0 items-center gap-1.5 text-xs text-ink-faint">
                <Clock3Icon class="size-3.5" />
                {{ formatRelative(thread.recencyAt || thread.updatedAt) }}
              </span>
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-40">
            <ContextMenuItem
              @select="navigation.setThreadPinned(String(thread.id), !thread.pinned)"
            >
              <PinIcon v-if="!thread.pinned" class="mr-2 size-4" />
              <PinOffIcon v-else class="mr-2 size-4" />
              {{ thread.pinned ? t("app.unpinThread") : t("app.pinThread") }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <p v-if="!recentThreads.length && loading" class="px-3 py-1 text-xs text-ink-faint">
          {{ t("app.thinking") }}
        </p>
      </div>
    </div>
  </section>
</template>
