<script setup lang="ts">
import { ChevronDownIcon, Loader2Icon, SparklesIcon } from "@lucide/vue";
import { formatDurationMs } from "@/utils/item-timing";

const props = defineProps<{
  open: boolean;
  count: number;
  loading: boolean;
  activeLabel?: string | null;
  summary?: {
    fileItems: { itemId: string | null; path: string }[];
    commandCount: number;
    durationMs: number | null;
  } | null;
}>();

const emit = defineEmits<{
  toggle: [open: boolean];
}>();

const { t } = useI18n();

const label = computed(() => {
  if (props.loading) {
    return props.activeLabel != null && props.activeLabel !== ""
      ? t("app.intermediateRunningItem", { label: props.activeLabel })
      : t("app.thinking");
  }
  if (props.summary !== null && props.summary !== undefined) {
    const parts = [t("app.turnCompleted")];
    if (props.summary.fileItems.length > 0) {
      parts.push(t("app.turnFilesChanged", { count: props.summary.fileItems.length }));
    }
    if (props.summary.commandCount > 0) {
      parts.push(t("app.turnCommandsRun", { count: props.summary.commandCount }));
    }
    if (props.summary.durationMs !== null) {
      parts.push(t("app.turnDuration", { duration: formatDurationMs(props.summary.durationMs) }));
    }
    return parts.join(" · ");
  }
  return t("app.intermediateSteps");
});
</script>

<template>
  <button
    type="button"
    class="flex w-full max-w-4xl items-center gap-1.5 rounded-md px-1 py-1 text-left text-[0.875rem] text-ink-muted transition-colors hover:text-ink-secondary"
    :aria-expanded="open"
    :disabled="loading"
    :data-state="open ? 'open' : 'closed'"
    data-testid="intermediate-steps"
    @click="emit('toggle', !props.open)"
  >
    <Loader2Icon v-if="loading" class="size-3.5 shrink-0 animate-spin text-ink-muted" />
    <SparklesIcon v-else class="size-3.5 shrink-0 text-ink-faint" />
    <span class="min-w-0 flex-1 truncate" data-testid="intermediate-steps-label">{{ label }}</span>
    <ChevronDownIcon
      class="size-3.5 shrink-0 text-ink-faint transition-transform"
      :class="open ? '' : '-rotate-90'"
    />
  </button>
</template>
