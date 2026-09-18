<script setup lang="ts">
import { Loader2Icon, PlusIcon } from "@lucide/vue";
import type { ApprovalPolicy } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ApprovalPolicyPicker from "@/components/chat/composer/ApprovalPolicyPicker.vue";

defineProps<{
  uploadingAttachments: boolean;
  selectedThreadId: string | null;
  selectedApprovalMode: ApprovalPolicy | "custom";
}>();

const emit = defineEmits<{
  attach: [];
  updateSelectedApprovalMode: [mode: ApprovalPolicy | "custom"];
}>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-0.5">
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="size-8 shrink-0 rounded-full text-ink-muted hover:bg-canvas-soft hover:text-ink-secondary"
      :disabled="uploadingAttachments || !selectedThreadId"
      :aria-label="$t('app.attachFile')"
      @click="emit('attach')"
    >
      <Loader2Icon v-if="uploadingAttachments" class="size-4 animate-spin" />
      <PlusIcon v-else class="size-4" />
    </Button>
    <ApprovalPolicyPicker
      :model-value="selectedApprovalMode"
      compact
      @update:model-value="emit('updateSelectedApprovalMode', $event)"
    />
  </div>
</template>
