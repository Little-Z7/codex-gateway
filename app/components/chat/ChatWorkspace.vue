<script setup lang="ts">
import { SquarePenIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import WorkspaceDock from "./workspace-dock/WorkspaceDock.vue";
import WorkspaceTopBar from "./WorkspaceTopBar.vue";
import { provideComposerController } from "./composer/context";

const props = withDefaults(
  defineProps<{
    layout?: "desktop" | "mobile";
  }>(),
  {
    layout: "desktop",
  },
);

const { selectedHostId, selectedProjectId, selectedThreadId } = storeToRefs(
  useGatewayNavigationStore(),
);
const scopeKey = computed(() =>
  workspaceLayoutScopeKey(selectedHostId.value, selectedProjectId.value, selectedThreadId.value),
);

// Single composer controller shared by the top bar model picker and the composer itself.
provideComposerController();

function newThread() {
  gatewayDomainEvents.emit("new-thread-requested", {});
}
</script>

<template>
  <section class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
    <WorkspaceTopBar :layout="props.layout">
      <template #start><slot name="mobile-header-start" /></template>
      <template v-if="props.layout === 'mobile'" #end>
        <Button
          data-testid="new-thread-mobile-button"
          variant="ghost"
          class="size-8 shrink-0"
          :aria-label="$t('app.newThread')"
          @click="newThread"
        >
          <SquarePenIcon class="size-4" />
        </Button>
      </template>
    </WorkspaceTopBar>
    <!--
      A Dockview renderer="always" tree is intentionally persistent while panels move inside one
      workspace. It must not cross a Host/Project/Thread boundary: Dockview reuses overlay nodes by
      panel id, while Agent virtual measurements and scroll ownership are thread-scoped. Keying the
      owner lets Vue finish the old unmount before creating the target layout, instead of racing a
      removePanel()/fromJSON() transaction inside one Dockview instance.
    -->
    <WorkspaceDock :key="scopeKey" :layout="layout" class="min-h-0 flex-1" />
  </section>
</template>
