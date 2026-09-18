<script setup lang="ts">
import ComposerShell from "@/components/chat/composer/ComposerShell.vue";
import { computed } from "vue";
import { useInjectedComposerController } from "@/components/chat/composer/context";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";

const {
  activePlanSummary,
  attachedFiles,
  fileReferences,
  canInterruptTurn,
  canUsePrimaryAction,
  composerInputEnabled,
  deactivatePlanMode,
  filteredSlashCommands,
  goalActionPending,
  goalInputActive,
  handleAttachmentChange,
  handleComposerKeydown,
  handlePaste,
  handlePrimaryAction,
  hasComposerInput,
  interruptingTurn,
  isThreadRunning,
  planModeActive,
  removeAttachment,
  runSlashCommand,
  selectSlashCommandIndex,
  selectedApprovalMode,
  selectedSlashCommandIndex,
  selectedThreadGoal,
  selectedThreadGoalObservedAt,
  selectedThreadId,
  selectedHostId,
  selectedProjectId,
  selectedThreadStatus,
  selectedThreadTokenUsage,
  sendButtonLabel,
  saveSelectedThreadGoal,
  stopSelectedThreadGoal,
  resumeSelectedThreadGoal,
  clearSelectedThreadGoal,
  setSelectedApprovalMode,
  slashMenuOpen,
  turnText,
  uploadingAttachments,
  handleFileReferenceLimit,
} = useInjectedComposerController();
const threadView = useGatewayThreadViewStore();
const emptyThread = computed(() => threadView.timelineTurns.length === 0);
</script>

<template>
  <ComposerShell
    :empty-thread="emptyThread"
    :embedded="emptyThread"
    v-model="turnText"
    v-model:file-references="fileReferences"
    :attached-files="attachedFiles"
    :plan-mode-active="planModeActive"
    :plan-summary="activePlanSummary"
    :goal-input-active="goalInputActive"
    :goal="selectedThreadGoal"
    :goal-observed-at="selectedThreadGoalObservedAt"
    :goal-action-pending="goalActionPending"
    :slash-menu-open="slashMenuOpen"
    :filtered-slash-commands="filteredSlashCommands"
    :selected-slash-command-index="selectedSlashCommandIndex"
    :composer-input-enabled="composerInputEnabled"
    :uploading-attachments="uploadingAttachments"
    :selected-thread-id="selectedThreadId"
    :selected-host-id="selectedHostId"
    :selected-project-id="selectedProjectId"
    :selected-approval-mode="selectedApprovalMode"
    :selected-thread-token-usage="selectedThreadTokenUsage"
    :has-composer-input="hasComposerInput"
    :is-thread-running="isThreadRunning"
    :can-interrupt-turn="canInterruptTurn"
    :can-use-primary-action="canUsePrimaryAction"
    :interrupting-turn="interruptingTurn"
    :selected-thread-status="selectedThreadStatus"
    :send-button-label="sendButtonLabel"
    @deactivate-plan="deactivatePlanMode"
    @save-goal="saveSelectedThreadGoal"
    @stop-goal="stopSelectedThreadGoal"
    @resume-goal="resumeSelectedThreadGoal"
    @clear-goal="clearSelectedThreadGoal"
    @hover-slash-command="selectSlashCommandIndex"
    @select-slash-command="runSlashCommand"
    @attachment-change="handleAttachmentChange"
    @paste="handlePaste"
    @remove-attachment="removeAttachment"
    @keydown="handleComposerKeydown"
    @file-reference-limit="handleFileReferenceLimit"
    @primary-action="handlePrimaryAction"
    @update-selected-approval-mode="setSelectedApprovalMode"
  />
</template>
