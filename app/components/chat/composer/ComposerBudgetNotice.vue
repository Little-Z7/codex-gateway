<script setup lang="ts">
import { useGatewayBudgetStore } from "@/stores/gateway-budget";

const budget = useGatewayBudgetStore();
const { t } = useI18n();

const message = computed(() => {
  const hit = budget.exceeded ?? budget.warning;
  if (hit === null) return null;
  return budget.budgetMessage(
    hit.dimension,
    hit.used,
    hit.limit,
    hit.resetAt,
    budget.exceeded !== null,
  );
});
</script>

<template>
  <div
    v-if="message"
    :data-testid="budget.exceeded ? 'composer-budget-exceeded' : 'composer-budget-warning'"
    class="mb-2 rounded-xl px-3 py-2 text-sm"
    :class="
      budget.exceeded
        ? 'border border-destructive/30 bg-destructive/10 text-destructive'
        : 'border border-accent-orange/30 bg-accent-orange/10 text-ink-secondary'
    "
  >
    <span class="font-medium">{{
      budget.exceeded ? t("app.budgetBlockedTitle") : t("app.budgetWarningTitle")
    }}</span>
    {{ message }}
  </div>
</template>
