import { defineStore, skipHydrate } from "pinia";
import { ref } from "vue";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";
import type { GatewayThread } from "~~/shared/types";
import type { GatewayRouteSelection } from "@/stores/gateway/route-state";
import { createThreadListActions } from "./actions/thread-list";
import { createThreadPinningActions } from "./actions/thread-pinning";

const emptySelection = (): GatewayRouteSelection => ({
  hostId: null,
  projectId: null,
  threadId: null,
  draft: false,
});

export const useGatewayNavigationStore = defineStore("gateway-navigation", () => {
  const lastOpenThread = useAccountLocalStorage<GatewayRouteSelection>(
    "last-open-thread",
    emptySelection(),
  );
  const threads = ref<GatewayThread[]>([]);
  const selectedHostId = ref<number | null>(null);
  const selectedProjectId = ref<number | null>(null);
  const selectedThreadId = ref<string | null>(null);
  // ChatGPT-style "new chat" draft: the composer targets a project but no app-server thread
  // exists until the first turn is sent. Cleared when a real thread is selected/created.
  const newThreadDraft = ref(false);
  const openingPinnedThreadKey = ref<string | null>(null);
  const actions = {
    ...createThreadListActions(),
    ...createThreadPinningActions(),
  };

  function rememberOpenThread(selection: GatewayRouteSelection) {
    lastOpenThread.value = { ...selection };
  }

  function resetState() {
    threads.value = [];
    selectedHostId.value = null;
    selectedProjectId.value = null;
    selectedThreadId.value = null;
    newThreadDraft.value = false;
    openingPinnedThreadKey.value = null;
  }

  return {
    lastOpenThread: skipHydrate(lastOpenThread),
    threads,
    selectedHostId,
    selectedProjectId,
    selectedThreadId,
    newThreadDraft,
    openingPinnedThreadKey,
    rememberOpenThread,
    resetState,
    ...actions,
  };
});
