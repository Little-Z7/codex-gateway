<script setup lang="ts">
import { computed, ref } from "vue";
import { toast } from "@codex-gateway/ui/sonner";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import { useAuthStore } from "@/stores/auth";
import { formatBudgetNumber, useGatewayBudgetStore } from "@/stores/gateway-budget";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorPayload, gatewayErrorMessage } from "@/utils/gateway-error";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

const auth = useAuthStore();
const budget = useGatewayBudgetStore();
const { t, te } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t, te));
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const submitting = ref(false);

onMounted(() => {
  void budget.refresh();
});

const usageRows = computed(() => {
  const snap = budget.snapshot;
  if (snap === null) return [];
  return (
    [
      ["dailyTokens", snap.usage.dailyTokens, snap.limits.dailyTokens],
      ["dailyTurns", snap.usage.dailyTurns, snap.limits.dailyTurns],
      ["monthlyTokens", snap.usage.monthlyTokens, snap.limits.monthlyTokens],
      ["monthlyTurns", snap.usage.monthlyTurns, snap.limits.monthlyTurns],
    ] as const
  ).map(([dimension, used, limit]) => ({
    dimension,
    used,
    limit,
    percent: limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100)),
  }));
});

async function submit() {
  if (newPassword.value !== confirmPassword.value) {
    toast.error(t("app.passwordChangeMismatch"));
    return;
  }
  submitting.value = true;
  try {
    await gatewayApi("/api/auth/password", {
      method: "POST",
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    toast.success(t("app.passwordChanged"));
  } catch (error: unknown) {
    const payload = gatewayErrorPayload(error);
    toast.error(
      payload.code !== undefined && te(`errors.${payload.code}`)
        ? t(`errors.${payload.code}`)
        : messageFromError(error, t("app.passwordChangeFailed"), errorLabels.value),
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="max-w-md space-y-6" data-testid="account-settings">
    <div class="space-y-1">
      <div class="text-sm text-ink-muted">{{ t("app.accountUsername") }}</div>
      <div class="text-base font-medium text-ink">{{ auth.username }}</div>
      <div class="text-sm text-ink-muted">
        {{ auth.isAdmin ? t("app.roleAdmin") : t("app.roleUser") }}
      </div>
    </div>
    <div class="space-y-3" data-testid="account-budget">
      <div class="text-sm font-medium text-ink">{{ t("app.budgetSelfTitle") }}</div>
      <div v-for="row in usageRows" :key="row.dimension" class="space-y-1">
        <div class="flex items-center justify-between text-xs text-ink-muted">
          <span>{{ t(`app.budgetDimension.${row.dimension}`) }}</span>
          <span v-if="row.limit === null">{{ t("app.budgetUnlimited") }}</span>
          <span v-else
            >{{ formatBudgetNumber(row.used) }} / {{ formatBudgetNumber(row.limit) }}</span
          >
        </div>
        <div v-if="row.percent !== null" class="h-1.5 overflow-hidden rounded-full bg-canvas-soft">
          <div
            class="h-full rounded-full"
            :class="
              row.percent >= 100
                ? 'bg-destructive'
                : row.percent >= (budget.snapshot?.warnPercent ?? 80)
                  ? 'bg-accent-orange'
                  : 'bg-primary'
            "
            :style="{ width: `${row.percent}%` }"
          />
        </div>
      </div>
    </div>
    <form v-if="auth.selfPasswordChangeAllowed" class="space-y-4" @submit.prevent="submit">
      <div class="text-sm font-medium text-ink">{{ t("app.changePassword") }}</div>
      <div class="space-y-2">
        <Label for="account-current-password">{{ t("app.currentPassword") }}</Label>
        <Input
          id="account-current-password"
          v-model="currentPassword"
          data-testid="account-current-password"
          type="password"
          autocomplete="current-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="account-new-password">{{ t("app.newPassword") }}</Label>
        <Input
          id="account-new-password"
          v-model="newPassword"
          data-testid="account-new-password"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="account-confirm-password">{{ t("app.confirmPassword") }}</Label>
        <Input
          id="account-confirm-password"
          v-model="confirmPassword"
          data-testid="account-confirm-password"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <Button
        type="submit"
        data-testid="account-password-submit"
        :disabled="submitting || !currentPassword || newPassword.length < 8"
      >
        {{ t("app.changePassword") }}
      </Button>
    </form>
    <p v-else class="text-sm text-ink-muted" data-testid="account-password-disabled">
      {{ t("app.passwordChangeDisabled") }}
    </p>
  </section>
</template>
