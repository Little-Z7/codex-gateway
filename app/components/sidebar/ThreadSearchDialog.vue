<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@codex-gateway/ui/command";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";

const open = defineModel<boolean>("open", { required: true });

const catalog = useGatewayCatalogStore();
const activity = useGatewayThreadActivityStore();
const threadView = useGatewayThreadViewStore();
const { t } = useI18n();
const query = ref("");

const results = computed(() => {
  const term = query.value.trim().toLowerCase();
  const summaries = Object.values(activity.summariesByKey)
    .filter((summary) => !summary.isSubAgent)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const filtered =
    term === ""
      ? summaries
      : summaries.filter(
          (summary) =>
            summary.title.toLowerCase().includes(term) ||
            (summary.projectName ?? "").toLowerCase().includes(term),
        );
  return filtered.slice(0, 30);
});

function projectLabel(projectId: number | null) {
  if (projectId === null) return "";
  return catalog.projects.find((project) => project.id === projectId)?.name ?? "";
}

function hostLabel(hostId: number) {
  return catalog.hosts.find((host) => host.id === hostId)?.name ?? "";
}

async function select(threadId: string, hostId: number, projectId: number | null) {
  open.value = false;
  await threadView.openThread(threadId, { hostId, projectId });
}
</script>

<template>
  <CommandDialog v-model:open="open" data-testid="thread-search-dialog">
    <CommandInput v-model="query" :placeholder="t('app.searchThreadsPlaceholder')" />
    <CommandList>
      <CommandEmpty>{{ t("app.searchThreadsEmpty") }}</CommandEmpty>
      <CommandGroup>
        <CommandItem
          v-for="summary in results"
          :key="`${summary.hostId}-${summary.threadId}`"
          :value="`${summary.hostId}-${summary.threadId}`"
          class="flex-col items-start gap-0.5"
          @select="select(summary.threadId, summary.hostId, summary.projectId)"
        >
          <span class="w-full truncate text-sm">{{ summary.title }}</span>
          <span class="truncate text-xs text-ink-faint">
            {{
              [hostLabel(summary.hostId), projectLabel(summary.projectId)]
                .filter(Boolean)
                .join(" · ")
            }}
          </span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
