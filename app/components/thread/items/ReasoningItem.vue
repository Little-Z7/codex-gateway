<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { useTimestamp } from "@vueuse/core";
import { BrainIcon, ChevronDownIcon, ChevronRightIcon } from "@lucide/vue";
import { computed, watch } from "vue";
import { Loader } from "@codex-gateway/ai-elements/loader";
import { Collapsible, CollapsibleTrigger } from "@codex-gateway/ui/collapsible";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import DeferredCollapsibleContent from "@/components/common/DeferredCollapsibleContent.vue";
import { ChatStickToBottomScrollArea } from "@/components/common/chat-virtualizer";
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
  <Collapsible
    :default-open="true"
    v-slot="{ open }"
    class="max-w-4xl text-[0.875rem] leading-6 text-ink-muted"
  >
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 rounded-md py-1 text-left text-xs hover:bg-canvas-soft"
    >
      <Loader
        v-if="inProgress"
        class="size-4 shrink-0 text-primary"
        :aria-label="t('app.running')"
      />
      <BrainIcon v-else class="size-4 shrink-0" />
      <span class="flex-1">{{ inProgress ? t("app.thinking") : t("app.thought") }}</span>
      <span
        v-if="timeLabel !== null"
        class="rounded-full bg-surface/80 px-2 py-0.5 font-mono text-[0.6875rem] text-ink-secondary"
        >{{ timeLabel }}</span
      >
      <span class="rounded-full p-0.5">
        <ChevronDownIcon v-if="open" class="size-4 shrink-0 text-ink-faint" />
        <ChevronRightIcon v-else class="size-4 shrink-0 text-ink-faint" />
      </span>
    </CollapsibleTrigger>
    <!-- Keep long reasoning out of the DOM while collapsed, just like command output. Reasoning is
         prose, however, so it uses the page background and normal Markdown wrapping rather than
         the horizontally scrollable terminal treatment. Only its vertical growth is bounded. -->
    <DeferredCollapsibleContent :open="open">
      <ChatStickToBottomScrollArea
        v-if="text"
        class="mt-1 max-h-56"
        viewport-class="max-h-56"
        content-class="min-w-0 [overflow-wrap:anywhere]"
        :threshold="48"
        :follow-key="text.length"
      >
        <MarkdownContent :content="text" :streaming="inProgress" compact />
      </ChatStickToBottomScrollArea>
    </DeferredCollapsibleContent>
  </Collapsible>
</template>
