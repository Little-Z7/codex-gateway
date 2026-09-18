<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ApprovalPolicy,
  ThreadGoal,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import type { ComposerAttachment } from "@/composables/composer/useComposerDraft";
import type { ComposerFileReference } from "@/stores/gateway/types";
import type { ComposerGoalPendingAction } from "@/composables/composer/useComposerGoalControls";
import type { SlashMenuItem } from "@/composables/composer/useSlashCommands";
import AttachmentChips from "@/components/chat/composer/AttachmentChips.vue";
import ComposerLeadControls from "@/components/chat/composer/ComposerLeadControls.vue";
import ComposerModeStrip from "@/components/chat/composer/ComposerModeStrip.vue";
import ComposerTrailControls from "@/components/chat/composer/ComposerTrailControls.vue";
import SlashCommandMenu from "@/components/chat/composer/SlashCommandMenu.vue";
import ComposerEditor from "@/components/chat/composer/ComposerEditor.vue";

const editorExpanded = ref(false);

const props = defineProps<{
  emptyThread?: boolean;
  embedded?: boolean;
  modelValue: string;
  fileReferences: ComposerFileReference[];
  attachedFiles: ComposerAttachment[];
  planModeActive: boolean;
  planSummary: string;
  goalInputActive: boolean;
  goal: ThreadGoal | null;
  goalObservedAt: number | null;
  goalActionPending: ComposerGoalPendingAction | null;
  slashMenuOpen: boolean;
  filteredSlashCommands: SlashMenuItem[];
  selectedSlashCommandIndex: number;
  composerInputEnabled: boolean;
  uploadingAttachments: boolean;
  selectedThreadId: string | null;
  selectedHostId: number | null;
  selectedProjectId: number | null;
  selectedApprovalMode: ApprovalPolicy | "custom";
  selectedThreadTokenUsage: ThreadTokenUsageState | null;
  hasComposerInput: boolean;
  isThreadRunning: boolean;
  canInterruptTurn: boolean;
  canUsePrimaryAction: boolean;
  interruptingTurn: boolean;
  selectedThreadStatus: ThreadRuntimeStatus;
  sendButtonLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:fileReferences": [value: ComposerFileReference[]];
  deactivatePlan: [];
  saveGoal: [objective: string];
  stopGoal: [];
  resumeGoal: [];
  clearGoal: [];
  hoverSlashCommand: [index: number];
  selectSlashCommand: [command: SlashMenuItem];
  attachmentChange: [event: Event];
  paste: [event: ClipboardEvent];
  removeAttachment: [id: string];
  keydown: [event: KeyboardEvent];
  fileReferenceLimit: [message: string];
  primaryAction: [];
  updateSelectedApprovalMode: [mode: ApprovalPolicy | "custom"];
}>();

const stacked = computed(() => editorExpanded.value || props.attachedFiles.length > 0);

const uploadInput = ref<HTMLInputElement | null>(null);

function openAttachmentPicker() {
  uploadInput.value?.click();
}

function composerScopeKey() {
  return `${props.selectedProjectId ?? "none"}:${props.selectedThreadId ?? "new"}`;
}

function updateModelValue(value: string, sourceScopeKey: string) {
  if (sourceScopeKey === composerScopeKey()) emit("update:modelValue", value);
}

function updateFileReferences(value: ComposerFileReference[], sourceScopeKey: string) {
  if (sourceScopeKey === composerScopeKey()) emit("update:fileReferences", value);
}
</script>

<template>
  <div
    :class="
      embedded
        ? 'w-full'
        : 'shrink-0 bg-gradient-to-t from-surface via-surface to-surface/75 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:px-[clamp(1rem,3vw,2rem)] md:pb-[clamp(0.5rem,1.4vh,1rem)]'
    "
  >
    <div class="mx-auto w-full max-w-3xl">
      <ComposerModeStrip
        :plan-mode-active="planModeActive"
        :plan-summary="planSummary"
        :goal-input-active="goalInputActive"
        :goal="goal"
        :goal-observed-at="goalObservedAt"
        :goal-action-pending="goalActionPending"
        @deactivate-plan="emit('deactivatePlan')"
        @save-goal="emit('saveGoal', $event)"
        @stop-goal="emit('stopGoal')"
        @resume-goal="emit('resumeGoal')"
        @clear-goal="emit('clearGoal')"
      />
      <div
        data-testid="composer-box"
        class="composer-box relative"
        :class="{ 'is-stacked': stacked, 'has-chips': attachedFiles.length > 0 }"
      >
        <SlashCommandMenu
          class="absolute inset-x-0 bottom-full z-20"
          :open="slashMenuOpen"
          :commands="filteredSlashCommands"
          :selected-index="selectedSlashCommandIndex"
          @hover="emit('hoverSlashCommand', $event)"
          @select="emit('selectSlashCommand', $event)"
        />
        <input
          ref="uploadInput"
          class="hidden"
          type="file"
          multiple
          @change="emit('attachmentChange', $event)"
        />
        <AttachmentChips
          class="composer-chips"
          :files="attachedFiles"
          @remove="emit('removeAttachment', $event)"
        />
        <ComposerLeadControls
          class="composer-lead"
          :uploading-attachments="uploadingAttachments"
          :selected-thread-id="selectedThreadId"
          :selected-approval-mode="selectedApprovalMode"
          @attach="openAttachmentPicker"
          @update-selected-approval-mode="emit('updateSelectedApprovalMode', $event)"
        />
        <div class="composer-input">
          <ComposerEditor
            :key="composerScopeKey()"
            :model-value="modelValue"
            :references="fileReferences"
            :scope-key="composerScopeKey()"
            :host-id="selectedHostId"
            :project-id="selectedProjectId"
            :disabled="!composerInputEnabled"
            :placeholder="$t(emptyThread ? 'app.newThreadPlaceholder' : 'app.askFollowUp')"
            :limit-message="$t('app.fileReferenceLimit', { count: 10 })"
            @update:model-value="updateModelValue"
            @update:references="updateFileReferences"
            @keydown="emit('keydown', $event)"
            @paste="emit('paste', $event)"
            @limit="emit('fileReferenceLimit', $event)"
            @expand="editorExpanded = $event"
          />
        </div>
        <ComposerTrailControls
          class="composer-trail"
          :uploading-attachments="uploadingAttachments"
          :selected-thread-token-usage="selectedThreadTokenUsage"
          :has-composer-input="hasComposerInput"
          :is-thread-running="isThreadRunning"
          :can-interrupt-turn="canInterruptTurn"
          :can-use-primary-action="canUsePrimaryAction"
          :interrupting-turn="interruptingTurn"
          :selected-thread-status="selectedThreadStatus"
          :send-button-label="sendButtonLabel"
          @primary-action="emit('primaryAction')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-box {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 0.25rem;
  row-gap: 0.25rem;
  min-height: 3.25rem;
  border: 1px solid var(--hairline);
  border-radius: 1.25rem;
  background: var(--surface);
  padding: 0.375rem 0.75rem;
  box-shadow: 0 0.0625rem 0.125rem color-mix(in srgb, var(--ink) 5%, transparent);
}

@media (min-width: 48rem) {
  .composer-box {
    border-radius: 1.625rem;
  }
}

.composer-chips {
  grid-column: 1 / -1;
  grid-row: 1;
}

.composer-lead {
  grid-column: 1;
  grid-row: 1;
}

.composer-input {
  grid-column: 3;
  grid-row: 1;
  min-width: 0;
}

.composer-trail {
  grid-column: 4;
  grid-row: 1;
}

.composer-box.is-stacked .composer-input {
  grid-column: 1 / -1;
  grid-row: 1;
}

.composer-box.is-stacked .composer-lead,
.composer-box.is-stacked .composer-trail {
  grid-row: 2;
}

.composer-box.has-chips .composer-input {
  grid-column: 1 / -1;
  grid-row: 2;
}

.composer-box.has-chips .composer-lead,
.composer-box.has-chips .composer-trail {
  grid-row: 3;
}
</style>
