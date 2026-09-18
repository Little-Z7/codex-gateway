<script setup lang="ts">
import {
  ActivityIcon,
  ChartNoAxesCombinedIcon,
  EllipsisIcon,
  FolderIcon,
  GlobeIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TerminalIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@codex-gateway/ui/tooltip";
import BrowserOpenDialog from "@/components/browser/BrowserOpenDialog.vue";
import ModelEffortPicker from "@/components/chat/composer/ModelEffortPicker.vue";
import { useWorkspaceLaunchActions } from "@/composables/workspace/useWorkspaceLaunchActions";
import { useTmuxMonitorLauncher } from "@/composables/workspace/useTmuxMonitorLauncher";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { FILES_WORKSPACE_PANEL_ID } from "@/stores/gateway/workspace-panels";
import { useInjectedComposerController } from "./composer/context";
import { useThreadRename } from "@/components/sidebar/thread-list/useThreadRename";
import ThreadRenameDialog from "@/components/sidebar/thread-list/ThreadRenameDialog.vue";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";

const props = defineProps<{ layout?: "desktop" | "mobile" }>();

const controller = useInjectedComposerController();
const navigation = useGatewayNavigationStore();
const catalog = useGatewayCatalogStore();
const workspaceLayout = useGatewayWorkspaceLayoutStore();
const workspaceActions = useWorkspaceLaunchActions();
const tmuxLauncher = useTmuxMonitorLauncher();
const threadRename = useThreadRename();
const { t } = useI18n();
const browserDialogOpen = ref(false);

const { selectedThreadId, selectedHostId } = storeToRefs(navigation);
const selectedThread = computed(
  () => navigation.threads.find((thread) => String(thread.id) === selectedThreadId.value) ?? null,
);
const canLaunch = computed(() => selectedHostId.value !== null);
const canOpenFiles = computed(() => selectedThreadId.value !== null);

function openFilesPanel() {
  if (!canOpenFiles.value) return;
  workspaceLayout.requestPanelActivation(FILES_WORKSPACE_PANEL_ID);
}
</script>

<template>
  <header
    data-testid="workspace-top-bar"
    class="flex h-[3.25rem] shrink-0 items-center gap-1.5 px-2 md:px-3"
  >
    <slot name="start" />

    <ModelEffortPicker
      :models="controller.models.value"
      :loading-models="controller.loadingModels.value"
      :active-model="controller.activeModel.value"
      :active-model-label="controller.activeModelLabel.value"
      :host-default-model-label="controller.hostDefaultModelLabel.value"
      :host-default-effort-label="controller.hostDefaultEffortLabel.value"
      :active-effort-value="controller.activeEffortValue.value"
      :active-effort-compact-label="controller.activeEffortCompactLabel.value"
      :effort-options="controller.effortOptions.value"
      :label-effort-option="controller.labelEffortOption"
      :model-option-value="controller.modelOptionValue"
      :selected-provider="controller.selectedProvider.value"
      :provider-options="controller.providerOptions"
      :can-select-provider="controller.selectedThreadId.value === null"
      @select-model="controller.setSelectedModel"
      @select-effort="controller.setSelectedEffort"
      @select-provider="controller.setSelectedProvider"
    />

    <div class="ml-auto flex min-w-0 items-center justify-end gap-1">
      <slot name="end" />
      <template v-if="props.layout !== 'mobile'">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-testid="open-files-button"
                variant="ghost"
                class="size-8 shrink-0"
                :disabled="!canOpenFiles"
                :aria-label="t('app.openFilesPanel')"
                @click="openFilesPanel"
              >
                <FolderIcon class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("app.openFilesPanel") }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-testid="open-terminal-button"
                variant="ghost"
                class="size-8 shrink-0"
                :disabled="!canLaunch"
                :aria-label="t('app.openTerminal')"
                @click="workspaceActions.openTerminal"
              >
                <TerminalIcon class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("app.openTerminal") }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-testid="open-browser-button"
                variant="ghost"
                class="size-8 shrink-0"
                :disabled="!canLaunch"
                :aria-label="t('app.openBrowser')"
                @click="browserDialogOpen = true"
              >
                <GlobeIcon class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("app.openBrowser") }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-testid="open-host-monitor-button"
                variant="ghost"
                class="size-8 shrink-0"
                :disabled="!canLaunch"
                :aria-label="t('app.openHostMonitor')"
                @click="workspaceActions.openHostMonitor"
              >
                <ChartNoAxesCombinedIcon class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("app.openHostMonitor") }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-testid="open-tmux-button"
                variant="ghost"
                class="relative size-8 shrink-0"
                :disabled="!canLaunch"
                :aria-label="t('app.openTmuxMonitor')"
                @click="tmuxLauncher.open"
              >
                <ActivityIcon class="size-4" />
                <span
                  v-if="tmuxLauncher.activeCount.value"
                  class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-4 text-primary-foreground"
                >
                  {{ tmuxLauncher.activeCount.value }}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("app.openTmuxMonitor") }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </template>

      <DropdownMenu v-if="selectedThread !== null">
        <DropdownMenuTrigger as-child>
          <Button
            data-testid="thread-topbar-menu"
            variant="ghost"
            class="size-8 shrink-0"
            :aria-label="t('app.threadMenu')"
          >
            <EllipsisIcon class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuItem
            @select="
              threadRename.startRename({
                ...selectedThread,
                hostId: selectedHostId ?? 0,
              })
            "
          >
            <PencilIcon class="mr-2 size-4" />
            {{ t("app.renameThread") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @select="navigation.setThreadPinned(selectedThreadId!, !selectedThread.pinned)"
          >
            <PinIcon v-if="!selectedThread.pinned" class="mr-2 size-4" />
            <PinOffIcon v-else class="mr-2 size-4" />
            {{ selectedThread.pinned ? t("app.unpinThread") : t("app.pinThread") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <BrowserOpenDialog
      v-model:open="browserDialogOpen"
      :open-target="workspaceActions.openBrowser"
    />
    <ThreadRenameDialog
      v-model:open="threadRename.open.value"
      v-model="threadRename.renameValue.value"
      :submitting="threadRename.submitting.value"
      @submit="threadRename.submitRename"
    />
  </header>
</template>
