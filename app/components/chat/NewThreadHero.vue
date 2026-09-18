<script setup lang="ts">
import { computed } from "vue";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";

const props = defineProps<{
  /** Project-page variant shows the project name instead of the raw path only. */
  projectPage?: boolean;
}>();

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const { t } = useI18n();

const project = computed(() => projectById(catalog.projects, navigation.selectedProjectId));
const subtitle = computed(() => {
  if (props.projectPage === true) {
    return [project.value?.name, project.value?.remotePath].filter(Boolean).join(" · ");
  }
  return project.value?.remotePath ?? threadView.currentThread?.cwd ?? null;
});

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
    class="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 text-center"
  >
    <h2 class="text-[clamp(1.5rem,3vw,2rem)] font-semibold text-ink">
      {{ t("app.newChatGreeting") }}
    </h2>
    <p v-if="subtitle" class="max-w-full truncate text-xs text-ink-faint">{{ subtitle }}</p>
    <div class="w-full">
      <slot />
    </div>
    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
      <button
        v-for="example in examples"
        :key="example"
        type="button"
        class="rounded-full border border-hairline px-4 py-2 text-sm text-ink-secondary hover:bg-canvas-soft"
        @click="pickExample(example)"
      >
        {{ example }}
      </button>
    </div>
  </div>
</template>
