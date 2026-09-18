import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  AgentProviderId,
  ApprovalPolicy,
  ReasoningEffort,
  ThreadGoal,
  ThreadSettingsState,
} from "~~/shared/types";
import type { ComposerDraft } from "@/stores/gateway/types";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { selectedThreadKey } from "@/stores/gateway/thread-utils/identity";
import { createComposerActions } from "./actions/drafts";
import { createThreadGoalActions } from "./actions/goals";
import { createThreadSettingsActions } from "./actions/settings";

export const useGatewayComposerStore = defineStore("gateway-composer", () => {
  const threadSettingsByKey = ref<Record<string, ThreadSettingsState>>({});
  const dismissedPlanPromptIdsByKey = ref<Record<string, Record<string, true>>>({});
  const threadGoalsByKey = ref<Record<string, ThreadGoal>>({});
  const threadGoalObservedAtByKey = ref<Record<string, number>>({});
  const composerDraftsByKey = ref<Record<string, ComposerDraft>>({});
  // Pre-thread ("new chat" draft) settings. The app-server thread does not exist yet, so these
  // live outside threadSettingsByKey; the top-bar picker and the composer controller must share
  // one instance, hence store state rather than a composable-local ref.
  const draftModel = ref("");
  const draftEffort = ref<ReasoningEffort>("default");
  const draftApprovalMode = ref<ApprovalPolicy | "custom">("custom");
  const draftProvider = ref<AgentProviderId>("codex");
  const actions = {
    ...createComposerActions(),
    ...createThreadGoalActions(),
    ...createThreadSettingsActions(),
  };

  const selectedKey = computed(() => {
    const navigation = useGatewayNavigationStore();
    return selectedThreadKey(navigation.selectedHostId, navigation.selectedThreadId);
  });
  const selectedThreadSettings = computed(() =>
    selectedKey.value !== null ? (threadSettingsByKey.value[selectedKey.value] ?? {}) : {},
  );
  const selectedThreadCollaborationMode = computed(() =>
    selectedKey.value !== null
      ? (threadSettingsByKey.value[selectedKey.value]?.collaborationMode?.mode ?? "default")
      : "default",
  );
  const selectedThreadGoal = computed(() =>
    selectedKey.value !== null ? (threadGoalsByKey.value[selectedKey.value] ?? null) : null,
  );
  const selectedThreadGoalObservedAt = computed(() =>
    selectedKey.value !== null
      ? (threadGoalObservedAtByKey.value[selectedKey.value] ?? null)
      : null,
  );
  const selectedThreadTokenUsage = computed(() => {
    const runtime = useGatewayThreadRuntimeStore();
    return selectedKey.value !== null
      ? (runtime.threadTokenUsageByKey[selectedKey.value] ?? null)
      : null;
  });
  function resetState() {
    threadSettingsByKey.value = {};
    dismissedPlanPromptIdsByKey.value = {};
    threadGoalsByKey.value = {};
    threadGoalObservedAtByKey.value = {};
    composerDraftsByKey.value = {};
  }

  return {
    threadSettingsByKey,
    dismissedPlanPromptIdsByKey,
    draftModel,
    draftEffort,
    draftApprovalMode,
    draftProvider,
    threadGoalsByKey,
    threadGoalObservedAtByKey,
    composerDraftsByKey,
    selectedThreadSettings,
    selectedThreadCollaborationMode,
    selectedThreadGoal,
    selectedThreadGoalObservedAt,
    selectedThreadTokenUsage,
    resetState,
    ...actions,
  };
});
