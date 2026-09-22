<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { computed } from "vue";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";
import { statusLabelKey } from "../sidebar-utils";

const props = defineProps<{
  status: ThreadRuntimeStatus;
  completionAttention?: boolean;
}>();

const { t } = useI18n();
// ChatGPT-style rows show only a spinner while running and a red dot on failure; completed
// threads render no trailing icon. completionAttention still surfaces as the same red dot so
// unviewed completions stay discoverable without a persistent badge on every row.
const visible = computed(
  () => props.status === "running" || props.status === "failed" || props.completionAttention,
);
const label = computed(() =>
  t(statusLabelKey(props.completionAttention ? "completedUnviewed" : props.status)),
);
</script>

<template>
  <span
    v-if="visible"
    class="inline-flex size-4 shrink-0 items-center justify-center"
    :aria-label="label"
    :title="label"
  >
    <Loader2Icon v-if="status === 'running'" class="size-3.5 animate-spin text-ink-muted" />
    <span v-else class="size-2 rounded-full bg-destructive" />
  </span>
</template>
