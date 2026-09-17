<script setup lang="ts">
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  ServerIcon,
  ChartNoAxesCombinedIcon,
  Trash2Icon,
} from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import type { HostRecord } from "../sidebar-types";
import { selectedRowClass } from "../sidebar-utils";
import HostStatusIndicator from "./HostStatusIndicator.vue";
import HostMfaButton from "./HostMfaButton.vue";
import SidebarRowLabel from "../SidebarRowLabel.vue";
import HostTreeProjects from "./HostTreeProjects.vue";
import { requireHostTreeController } from "./controller";
import { useHostMfaDialog } from "@/composables/host-mfa/useHostMfaDialog";
import { useGatewayHostMfaStore } from "@/stores/gateway-host-mfa";
import { ref, watch } from "vue";

const props = defineProps<{ host: HostRecord }>();
const controller = requireHostTreeController();
const mfaDialog = useHostMfaDialog();
const mfaStore = useGatewayHostMfaStore();

function handleMfaClick(hostId: number) {
  if (mfaStore.hasPendingMfa(hostId)) {
    // This prompt came from a live SSH keyboard-interactive exchange, so no new connection is
    // needed and the code can be entered immediately after the explicit button click.
    mfaDialog.openMfaDialog(hostId);
    return;
  }
  waitingForMfaPrompt.value = true;
  mfaStore.connectMfaHost(hostId);
}

const waitingForMfaPrompt = ref(false);

// A pending request is only actionable after this click starts a fresh SSH attempt. Background
// detection must keep the button closed until the user explicitly asks to reconnect.
watch(
  () => mfaStore.hasPendingMfa(props.host.id),
  (pending) => {
    if (!pending || !waitingForMfaPrompt.value) return;
    waitingForMfaPrompt.value = false;
    mfaDialog.openMfaDialog(props.host.id);
  },
);
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-lg">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <Button
          :data-testid="`host-button-${host.id}`"
          v-bind="controller.longPressHandlers"
          variant="ghost"
          class="h-11 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-left text-[0.9375rem] font-normal hover:bg-surface"
          :class="selectedRowClass(host.id === controller.selectedHostId)"
          @click="controller.selectHost(host.id)"
        >
          <ChevronDownIcon
            v-if="controller.expandedHostIds.has(host.id)"
            class="size-3.5 shrink-0 text-ink-muted"
          />
          <ChevronRightIcon v-else class="size-3.5 shrink-0 text-ink-muted" />
          <ServerIcon class="size-4 shrink-0" />
          <SidebarRowLabel :title="host.name" :subtitle="host.sshHost">
            <template #trailing>
              <HostStatusIndicator
                :status="controller.hostConnectionStatuses[host.id]?.status ?? 'idle'"
                :label="controller.hostConnectionStatuses[host.id]?.message"
              />
              <HostMfaButton
                v-if="
                  ['mfaRequired', 'mfaConnecting'].includes(
                    controller.hostConnectionStatuses[host.id]?.status ?? '',
                  )
                "
                :host-id="host.id"
                :connecting="controller.hostConnectionStatuses[host.id]?.status === 'mfaConnecting'"
                @click="handleMfaClick"
              />
            </template>
          </SidebarRowLabel>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
        <ContextMenuItem @select="controller.monitorHost(host.id)">
          <ChartNoAxesCombinedIcon class="mr-2 size-4" />
          {{ $t("app.openHostMonitor") }}
        </ContextMenuItem>
        <ContextMenuItem @select="controller.addProject(host)">
          <FolderIcon class="mr-2 size-4" />
          {{ $t("app.addProject") }}
        </ContextMenuItem>
        <ContextMenuItem
          class="text-destructive focus:text-destructive"
          @select="controller.deleteHost(host.id)"
        >
          <Trash2Icon class="mr-2 size-4" />
          {{ $t("app.deleteHost") }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <HostTreeProjects
      v-if="controller.expandedHostIds.has(host.id)"
      class="mt-1 pl-5"
      :host="host"
    />
  </div>
</template>
