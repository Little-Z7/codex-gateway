<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { useTimestamp } from "@vueuse/core";
import { BrainIcon, Loader2Icon } from "@lucide/vue";
import { computed, watch } from "vue";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import { isItemInProgress, threadItemText } from "@/utils/thread-items";
import { formatDurationMs, itemCompletedAtMs, itemStartedAtMs } from "@/utils/item-timing";

const props = defineProps<{ item: ThreadHistoryItem }>();
const { t } = useI18n();
const { timestamp: now, pause, resume } = useTimestamp({ controls: true, interval: 100 });
const text = computed(() => threadItemText(props.item));
const inProgress = computed(() => isItemInProgress(props.item));
const startedAt = computed(() => itemStartedAtMs(props.item));
const completedAt = computed(() => itemCompletedAtMs(props.item));
// The duration is only honest when both lifecycle timestamps exist: reasoning items buffered by
// the provider can arrive with startedAt ≈ completedAt, so sub-second results are hidden rather
// than shown as a misleading "0.01s". While in progress the live elapsed time is real.
const elapsedMs = computed(() => {
  if (startedAt.value === null) return null;
  if (inProgress.value) {
    return now.value - startedAt.value;
  }
  if (completedAt.value === null) return null;
  const delta = completedAt.value - startedAt.value;
  return delta >= 500 ? delta : null;
});
const timeLabel = computed(() =>
  elapsedMs.value === null ? null : formatDurationMs(elapsedMs.value),
);

watch(inProgress, (active) => (active ? resume() : pause()), { immediate: true });
</script>

<template>
  <div class="max-w-4xl text-[0.875rem] leading-6 text-ink-muted">
    <div class="flex items-start gap-2">
      <Loader2Icon v-if="inProgress" class="mt-1 size-4 shrink-0 animate-spin text-primary" />
      <BrainIcon v-else class="mt-1 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex items-center gap-2 text-xs text-ink-muted">
          <span>{{ inProgress ? t("app.thinking") : t("app.thought") }}</span>
          <span
            v-if="timeLabel !== null"
            class="rounded-full bg-surface/80 px-2 py-0.5 font-mono text-[0.6875rem] text-ink-secondary"
            >{{ timeLabel }}</span
          >
        </div>
        <MarkdownContent v-if="text" :content="text" :streaming="inProgress" compact />
      </div>
    </div>
  </div>
</template>
