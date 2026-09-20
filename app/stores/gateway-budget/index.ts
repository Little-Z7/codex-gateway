import { defineStore } from "pinia";
import { toast } from "@codex-gateway/ui/sonner";
import type { BudgetSnapshot } from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";

export const useGatewayBudgetStore = defineStore("gateway-budget", () => {
  const snapshot = ref<BudgetSnapshot | null>(null);
  const toastedExceeded = ref<string | null>(null);
  const { t, te } = useGatewayTranslator();

  const exceeded = computed(() => snapshot.value?.exceeded ?? null);
  const warning = computed(() => snapshot.value?.warning ?? null);

  async function refresh() {
    try {
      const response = await gatewayApi<{ usage: BudgetSnapshot }>("/api/usage/me");
      snapshot.value = response.usage;
      maybeToast();
    } catch {
      // Budget is advisory UI on top of the hard server-side intercept.
    }
  }

  function maybeToast() {
    const hit = snapshot.value?.exceeded;
    if (hit === null || hit === undefined) {
      toastedExceeded.value = null;
      return;
    }
    const key = `${hit.dimension}:${hit.resetAt}`;
    if (toastedExceeded.value === key) return;
    toastedExceeded.value = key;
    toast.error(budgetMessage(hit.dimension, hit.used, hit.limit, hit.resetAt, true));
  }

  function budgetMessage(
    dimension: string,
    used: number,
    limit: number,
    resetAt: string,
    blocking: boolean,
  ) {
    const kind = blocking ? "exceeded" : "warning";
    const specific = `errors.budget.${kind}${dimension.charAt(0).toUpperCase()}${dimension.slice(1)}`;
    const key = te(specific) ? specific : `errors.budget.${kind}`;
    return t(key, {
      used: formatBudgetNumber(used),
      limit: formatBudgetNumber(limit),
      resetAt: formatResetClock(resetAt),
    });
  }

  function reset() {
    snapshot.value = null;
    toastedExceeded.value = null;
  }

  return {
    snapshot,
    exceeded,
    warning,
    refresh,
    reset,
    budgetMessage,
  };
});

export function formatBudgetNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return String(value);
}

export function formatResetClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
