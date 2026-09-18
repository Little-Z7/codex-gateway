import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import {
  budgetDefaults,
  budgetResetAt,
  effectiveLimitsFor,
  latestBudgetResetAt,
  listUserBudgetRows,
} from "../../utils/gateway/usage/budget-store";
import { usageStore } from "../../utils/gateway/usage/usage-store";
import type { AdminUserBudgetRow, BudgetUsage } from "~~/shared/types";

const emptyUsage = (): BudgetUsage => ({
  dailyTokens: 0,
  dailyTurns: 0,
  monthlyTokens: 0,
  monthlyTurns: 0,
});

export default defineGatewayEventHandler((event) => {
  requireAdmin(event);
  const defaults = budgetDefaults();
  const rows = listUserBudgetRows();
  const usageByUser = new Map(usageStore.usageByUser().map((row) => [row.userId, row]));
  const resetAt = budgetResetAt();
  const budgets: AdminUserBudgetRow[] = userStore.listUsers().map((user) => {
    const { limits, source } = effectiveLimitsFor(rows.get(user.id) ?? null, defaults);
    const usage = usageByUser.get(user.id) ?? emptyUsage();
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      effective: { ...limits, source },
      usage,
      resetAt,
      lastResetAt: latestBudgetResetAt(user.id),
    };
  });
  return { defaults, budgets };
});
