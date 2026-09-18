<script setup lang="ts">
import { CheckIcon, Loader2Icon, PlusIcon, SendIcon, SquareIcon } from "@lucide/vue";
import type { ApprovalPolicy, ThreadRuntimeStatus, ThreadTokenUsageState } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ApprovalPolicyPicker from "@/components/chat/composer/ApprovalPolicyPicker.vue";
import ContextUsageMeter from "@/components/chat/composer/ContextUsageMeter.vue";

defineProps<{
  uploadingAttachments: boolean;
  selectedThreadId: string | null;
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
  attach: [];
  primaryAction: [];
  updateSelectedApprovalMode: [mode: ApprovalPolicy | "custom"];
}>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-1.5 pt-1 sm:flex-wrap sm:justify-between sm:gap-2">
    <div class="flex min-w-0 items-center gap-1 text-base text-ink-muted">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        class="size-9 rounded-full text-ink-muted hover:bg-canvas-soft hover:text-ink-secondary"
        :disabled="uploadingAttachments || !selectedThreadId"
        :aria-label="$t('app.attachFile')"
        @click="emit('attach')"
      >
        <Loader2Icon v-if="uploadingAttachments" class="size-5 animate-spin" />
        <PlusIcon v-else class="size-5" />
      </Button>
      <div class="composer-approval-control">
        <ApprovalPolicyPicker
          :model-value="selectedApprovalMode"
          @update:model-value="emit('updateSelectedApprovalMode', $event)"
        />
      </div>
    </div>
    <div class="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
      <ContextUsageMeter :token-usage="selectedThreadTokenUsage" />
      <Button
        data-testid="send-turn-button"
        class="size-9 shrink-0 rounded-full bg-ink p-0 text-canvas hover:bg-ink/85"
        :aria-label="sendButtonLabel"
        :disabled="!canUsePrimaryAction || interruptingTurn"
        @click="emit('primaryAction')"
      >
        <Loader2Icon v-if="uploadingAttachments" class="size-5 animate-spin" />
        <Loader2Icon
          v-else-if="interruptingTurn || (isThreadRunning && hasComposerInput)"
          class="size-5 animate-spin"
        />
        <SendIcon v-else-if="hasComposerInput" class="size-4.5" />
        <SquareIcon v-else-if="canInterruptTurn" class="size-4 fill-current" />
        <CheckIcon v-else-if="selectedThreadStatus === 'completed'" class="size-4.5" />
        <SendIcon v-else class="size-4.5 opacity-60" />
      </Button>
    </div>
  </div>
</template>

<style scoped>
.composer-approval-control {
  display: none;
}

/* Dockview can make the composer narrow while the browser viewport remains desktop-sized. Query
   the control surface itself so approval yields to model, effort, context, and send controls.
   The standard composer box tops out at 42rem (max-w-3xl minus padding); keep the cutoff
   clearly below it so rounding never hides the control at full width. */
@container (min-width: 36rem) {
  .composer-approval-control {
    display: block;
  }
}
</style>
