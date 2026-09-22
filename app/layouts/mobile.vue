<script setup lang="ts">
import { MenuIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import ChatWorkspace from "@/components/chat/ChatWorkspace.vue";
import GatewaySidebar from "@/components/sidebar/GatewaySidebar.vue";
import { Button } from "@codex-gateway/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@codex-gateway/ui/sheet";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";

const navigation = useGatewayNavigationStore();
const { selectedHostId, selectedProjectId, selectedThreadId } = storeToRefs(navigation);
const sidebarOpen = ref(false);

watch([selectedHostId, selectedProjectId, selectedThreadId], () => {
  sidebarOpen.value = false;
});
</script>

<template>
  <main
    data-testid="mobile-layout"
    class="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas-soft text-ink"
  >
    <ChatWorkspace layout="mobile">
      <template #mobile-header-start>
        <Sheet v-model:open="sidebarOpen">
          <Button
            data-testid="mobile-sidebar-toggle"
            type="button"
            variant="ghost"
            size="icon-lg"
            class="shrink-0 rounded-xl"
            :aria-label="$t('app.openSidebar')"
            @click="sidebarOpen = true"
          >
            <MenuIcon class="size-5" />
          </Button>
          <SheetContent side="left" class="w-[min(88vw,24rem)] p-0" :show-close-button="false">
            <SheetHeader class="sr-only">
              <SheetTitle>{{ $t("app.sidebar") }}</SheetTitle>
              <SheetDescription>{{ $t("app.sidebarDescription") }}</SheetDescription>
            </SheetHeader>
            <GatewaySidebar class="h-full" :collapsible="false" />
          </SheetContent>
        </Sheet>
      </template>
    </ChatWorkspace>
  </main>
</template>
