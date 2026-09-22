<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon } from "@lucide/vue";
import { formatDurationMs } from "@/utils/item-timing";

const props = defineProps<{
  fileItems: { itemId: string | null; path: string }[];
  commandCount: number;
  durationMs: number | null;
}>();

const emit = defineEmits<{
  jumpToItem: [itemId: string];
}>();

const { t } = useI18n();
const expanded = ref(false);

const durationLabel = computed(() =>
  props.durationMs === null ? null : formatDurationMs(props.durationMs),
);
</script>

<template>
  <div class="max-w-3xl text-[0.8125rem]" data-testid="turn-summary">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-ink-muted hover:text-ink-secondary"
      data-testid="turn-summary-toggle"
      @click="expanded = !expanded"
    >
      <ChevronDownIcon v-if="expanded" class="size-3.5" />
      <ChevronRightIcon v-else class="size-3.5" />
      <span>{{ t("app.turnCompleted") }}</span>
      <template v-if="fileItems.length > 0">
        <span class="text-ink-faint">·</span>
        <span>{{ t("app.turnFilesChanged", { count: fileItems.length }) }}</span>
      </template>
      <template v-if="commandCount > 0">
        <span class="text-ink-faint">·</span>
        <span>{{ t("app.turnCommandsRun", { count: commandCount }) }}</span>
      </template>
      <template v-if="durationLabel !== null">
        <span class="text-ink-faint">·</span>
        <span>{{ t("app.turnDuration", { duration: durationLabel }) }}</span>
      </template>
    </button>
    <ul v-if="expanded && fileItems.length > 0" class="mt-1 space-y-0.5 pl-6">
      <li v-for="file in fileItems" :key="file.path">
        <button
          type="button"
          class="truncate font-mono text-xs text-primary hover:underline"
          :disabled="file.itemId === null"
          @click="file.itemId !== null && emit('jumpToItem', file.itemId)"
        >
          {{ file.path }}
        </button>
      </li>
    </ul>
  </div>
</template>
