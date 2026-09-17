<script setup lang="ts">
import { computed } from "vue";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const { t } = useI18n();

const projectPath = computed(
  () =>
    projectById(catalog.projects, navigation.selectedProjectId)?.remotePath ??
    threadView.currentThread?.cwd ??
    null,
);

const examples = computed(() => [
  t("app.newThreadExample1"),
  t("app.newThreadExample2"),
  t("app.newThreadExample3"),
]);

function pickExample(text: string) {
  gatewayDomainEvents.emit("composer-fill-requested", { text });
}
</script>

<template>
  <div
    data-testid="new-thread-hero"
    class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-4 px-4 text-center"
  >
    <h2 class="text-[clamp(1.375rem,3vw,1.75rem)] font-semibold text-ink">
      {{ t("app.newThreadHeroTitle") }}
    </h2>
    <p v-if="projectPath" class="truncate font-mono text-xs text-ink-faint">{{ projectPath }}</p>
    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
      <button
        v-for="example in examples"
        :key="example"
        type="button"
        class="rounded-full border border-hairline px-4 py-2 text-sm text-ink-secondary hover:bg-surface"
        @click="pickExample(example)"
      >
        {{ example }}
      </button>
    </div>
  </div>
</template>
