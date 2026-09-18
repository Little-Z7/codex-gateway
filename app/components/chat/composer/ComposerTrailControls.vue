<script setup lang="ts">
import { CheckIcon, Loader2Icon, SendIcon, SquareIcon } from "@lucide/vue";
import type { ThreadRuntimeStatus, ThreadTokenUsageState } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ContextUsageMeter from "@/components/chat/composer/ContextUsageMeter.vue";

defineProps<{
  uploadingAttachments: boolean;
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
  primaryAction: [];
}>();
</script>

<template>
  <div class="ml-auto flex shrink-0 items-center gap-1">
    <ContextUsageMeter compact :token-usage="selectedThreadTokenUsage" />
    <Button
      data-testid="send-turn-button"
      class="size-8 shrink-0 rounded-full bg-ink p-0 text-canvas hover:bg-ink/85"
      :aria-label="sendButtonLabel"
      :disabled="!canUsePrimaryAction || interruptingTurn"
      @click="emit('primaryAction')"
    >
      <Loader2Icon v-if="uploadingAttachments" class="size-4 animate-spin" />
      <Loader2Icon
        v-else-if="interruptingTurn || (isThreadRunning && hasComposerInput)"
        class="size-4 animate-spin"
      />
      <SendIcon v-else-if="hasComposerInput" class="size-3.5" />
      <SquareIcon v-else-if="canInterruptTurn" class="size-3 fill-current" />
      <CheckIcon v-else-if="selectedThreadStatus === 'completed'" class="size-3.5" />
      <SendIcon v-else class="size-3.5 opacity-60" />
    </Button>
  </div>
</template>
