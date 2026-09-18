<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { Switch } from "@codex-gateway/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@codex-gateway/ui/alert-dialog";
import { toast } from "@codex-gateway/ui/sonner";
import { formatBudgetNumber, formatResetClock } from "@/stores/gateway-budget";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const props = defineProps<{ userId: number }>();
const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { budgets } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const useDefaults = ref(true);
const dailyTokens = ref("");
const monthlyTokens = ref("");
const dailyTurns = ref("");
const monthlyTurns = ref("");
const saving = ref(false);
const resetting = ref(false);
const confirmReset = ref(false);

const row = computed(() => budgets.value.find((item) => item.userId === props.userId) ?? null);

function parseLimit(value: string) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function loadForm() {
  const current = row.value;
  if (current === null) return;
  useDefaults.value = current.effective.source !== "user";
  dailyTokens.value =
    current.effective.dailyTokens === null ? "" : String(current.effective.dailyTokens);
  monthlyTokens.value =
    current.effective.monthlyTokens === null ? "" : String(current.effective.monthlyTokens);
  dailyTurns.value =
    current.effective.dailyTurns === null ? "" : String(current.effective.dailyTurns);
  monthlyTurns.value =
    current.effective.monthlyTurns === null ? "" : String(current.effective.monthlyTurns);
}

watch(row, loadForm, { immediate: true });

onMounted(() => {
  if (budgets.value.length === 0) void admin.loadBudgets().catch(() => {});
});

async function save() {
  saving.value = true;
  try {
    await admin.updateUserBudget(props.userId, {
      useDefaults: useDefaults.value,
      dailyTokens: parseLimit(dailyTokens.value),
      monthlyTokens: parseLimit(monthlyTokens.value),
      dailyTurns: parseLimit(dailyTurns.value),
      monthlyTurns: parseLimit(monthlyTurns.value),
    });
    toast.success(t("app.adminSettingsSave"));
  } catch (error: unknown) {
    toast.error(messageFromError(error, t("app.adminUsersLoadFailed"), errorLabels.value));
  } finally {
    saving.value = false;
  }
}

async function resetPeriod() {
  resetting.value = true;
  try {
    await admin.resetUserBudget(props.userId);
    confirmReset.value = false;
    toast.success(t("app.adminBudgetReset"));
  } catch (error: unknown) {
    toast.error(messageFromError(error, t("app.adminUsersLoadFailed"), errorLabels.value));
  } finally {
    resetting.value = false;
  }
}

function limitLabel(value: number | null | undefined) {
  return value === null || value === undefined
    ? t("app.budgetUnlimited")
    : formatBudgetNumber(value);
}

function setUnlimited() {
  useDefaults.value = false;
  dailyTokens.value = "";
  monthlyTokens.value = "";
  dailyTurns.value = "";
  monthlyTurns.value = "";
}
</script>

<template>
  <section class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-user-budget">
    <div class="mb-3 text-sm font-medium">{{ t("app.adminBudgetCard") }}</div>
    <div class="mb-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
      <div>
        {{ t("app.budgetDimension.dailyTokens") }}:
        {{ formatBudgetNumber(row?.usage.dailyTokens ?? 0) }}
        /
        {{ limitLabel(row?.effective.dailyTokens) }}
      </div>
      <div>
        {{ t("app.budgetDimension.monthlyTokens") }}:
        {{ formatBudgetNumber(row?.usage.monthlyTokens ?? 0) }}
        /
        {{ limitLabel(row?.effective.monthlyTokens) }}
      </div>
      <div>
        {{ t("app.budgetDimension.dailyTurns") }}: {{ row?.usage.dailyTurns ?? 0 }}
        /
        {{ limitLabel(row?.effective.dailyTurns) }}
      </div>
      <div>
        {{ t("app.budgetDimension.monthlyTurns") }}: {{ row?.usage.monthlyTurns ?? 0 }}
        /
        {{ limitLabel(row?.effective.monthlyTurns) }}
      </div>
      <div>
        {{ t("app.budgetDimension.dailyTokens") }} reset
        {{ formatResetClock(row?.resetAt.daily ?? "") }}
      </div>
      <div v-if="row?.lastResetAt" data-testid="admin-budget-last-reset">
        {{ t("app.adminBudgetReset") }} · {{ row.lastResetAt.slice(0, 16).replace("T", " ") }}
      </div>
    </div>
    <label class="mb-3 flex items-center justify-between gap-3 text-sm">
      <span>{{ t("app.adminBudgetUseDefaults") }}</span>
      <Switch v-model="useDefaults" data-testid="admin-budget-use-defaults" />
    </label>
    <div class="grid gap-3 sm:grid-cols-2" :class="useDefaults ? 'opacity-60' : ''">
      <label class="space-y-1 text-xs text-ink-muted">
        {{ t("app.budgetDimension.dailyTokens") }}
        <Input
          v-model="dailyTokens"
          :disabled="useDefaults"
          data-testid="admin-budget-daily-tokens"
        />
      </label>
      <label class="space-y-1 text-xs text-ink-muted">
        {{ t("app.budgetDimension.monthlyTokens") }}
        <Input
          v-model="monthlyTokens"
          :disabled="useDefaults"
          data-testid="admin-budget-monthly-tokens"
        />
      </label>
      <label class="space-y-1 text-xs text-ink-muted">
        {{ t("app.budgetDimension.dailyTurns") }}
        <Input
          v-model="dailyTurns"
          :disabled="useDefaults"
          data-testid="admin-budget-daily-turns"
        />
      </label>
      <label class="space-y-1 text-xs text-ink-muted">
        {{ t("app.budgetDimension.monthlyTurns") }}
        <Input
          v-model="monthlyTurns"
          :disabled="useDefaults"
          data-testid="admin-budget-monthly-turns"
        />
      </label>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <Button size="sm" :disabled="saving" data-testid="admin-budget-save" @click="save">
        {{ t("app.adminSettingsSave") }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        :disabled="useDefaults"
        data-testid="admin-budget-unlimited"
        @click="setUnlimited"
      >
        {{ t("app.adminBudgetUnlimited") }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="admin-budget-reset"
        @click="confirmReset = true"
      >
        {{ t("app.adminBudgetReset") }}
      </Button>
    </div>
    <AlertDialog v-model:open="confirmReset">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("app.adminBudgetReset") }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t("app.adminBudgetResetConfirm") }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("app.close") }}</AlertDialogCancel>
          <AlertDialogAction
            :disabled="resetting"
            data-testid="admin-budget-reset-confirm"
            @click="resetPeriod"
          >
            {{ t("app.adminBudgetReset") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
