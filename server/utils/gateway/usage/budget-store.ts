import { gatewayApiError } from "../http/errors";
import { getSettingJson, setSettingJson } from "../settings/settings";
import { gatewayDatabase } from "../storage/database";
import { currentGatewayUserId } from "../state/memory";
import type {
  BudgetDefaults,
  BudgetDimension,
  BudgetExceeded,
  BudgetLimits,
  BudgetSnapshot,
  BudgetSource,
  BudgetUsage,
} from "~~/shared/types";
import { usageDayUtc, usageStore } from "./usage-store";

const DEFAULTS_KEY = "budget.defaults";
const DIMENSIONS: BudgetDimension[] = [
  "dailyTurns",
  "monthlyTurns",
  "dailyTokens",
  "monthlyTokens",
];

const emptyLimits = (): BudgetLimits => ({
  dailyTokens: null,
  monthlyTokens: null,
  dailyTurns: null,
  monthlyTurns: null,
});

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function nextDayResetAt(day: string) {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function nextMonthResetAt(day: string) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const next =
    month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1));
  return next.toISOString();
}

export function budgetResetAt(day = usageDayUtc()) {
  return { daily: nextDayResetAt(day), monthly: nextMonthResetAt(day) };
}

function resetAtFor(day = usageDayUtc()) {
  return budgetResetAt(day);
}

function resetAtForDimension(
  dimension: BudgetDimension,
  resetAt: { daily: string; monthly: string },
) {
  return dimension.startsWith("daily") ? resetAt.daily : resetAt.monthly;
}

export function defaultBudgetSettings(): BudgetDefaults {
  return { ...emptyLimits(), warnPercent: 80 };
}

export function budgetDefaults(): BudgetDefaults {
  const stored = getSettingJson(DEFAULTS_KEY);
  const fallback = defaultBudgetSettings();
  if (stored === null) return fallback;
  const warnPercent = integerOrNull(stored.warnPercent);
  return {
    dailyTokens: integerOrNull(stored.dailyTokens),
    monthlyTokens: integerOrNull(stored.monthlyTokens),
    dailyTurns: integerOrNull(stored.dailyTurns),
    monthlyTurns: integerOrNull(stored.monthlyTurns),
    warnPercent:
      warnPercent === null || warnPercent < 1 || warnPercent > 100
        ? fallback.warnPercent
        : warnPercent,
  };
}

export function saveBudgetDefaults(input: BudgetDefaults) {
  setSettingJson(DEFAULTS_KEY, {
    dailyTokens: input.dailyTokens,
    monthlyTokens: input.monthlyTokens,
    dailyTurns: input.dailyTurns,
    monthlyTurns: input.monthlyTurns,
    warnPercent: input.warnPercent,
  });
}

export interface UserBudgetRow extends BudgetLimits {
  userId: number;
  updatedAt: string;
}

export function userBudgetRow(userId: number): UserBudgetRow | null {
  const row = gatewayDatabase()
    .prepare(
      `SELECT user_id, daily_tokens, monthly_tokens, daily_turns, monthly_turns, updated_at
         FROM user_budgets WHERE user_id = ?`,
    )
    .get(userId);
  if (row === undefined) return null;
  return {
    userId: Number(row.user_id),
    dailyTokens: integerOrNull(row.daily_tokens),
    monthlyTokens: integerOrNull(row.monthly_tokens),
    dailyTurns: integerOrNull(row.daily_turns),
    monthlyTurns: integerOrNull(row.monthly_turns),
    updatedAt: String(row.updated_at),
  };
}

export function listUserBudgetRows(): Map<number, UserBudgetRow> {
  const rows = gatewayDatabase()
    .prepare(
      `SELECT user_id, daily_tokens, monthly_tokens, daily_turns, monthly_turns, updated_at
         FROM user_budgets`,
    )
    .all();
  return new Map(
    rows.map((row) => {
      const parsed = {
        userId: Number(row.user_id),
        dailyTokens: integerOrNull(row.daily_tokens),
        monthlyTokens: integerOrNull(row.monthly_tokens),
        dailyTurns: integerOrNull(row.daily_turns),
        monthlyTurns: integerOrNull(row.monthly_turns),
        updatedAt: String(row.updated_at),
      };
      return [parsed.userId, parsed] as const;
    }),
  );
}

export function upsertUserBudget(userId: number, limits: BudgetLimits) {
  const now = new Date().toISOString();
  gatewayDatabase()
    .prepare(
      `INSERT INTO user_budgets
         (user_id, daily_tokens, monthly_tokens, daily_turns, monthly_turns, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         daily_tokens = excluded.daily_tokens,
         monthly_tokens = excluded.monthly_tokens,
         daily_turns = excluded.daily_turns,
         monthly_turns = excluded.monthly_turns,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      limits.dailyTokens,
      limits.monthlyTokens,
      limits.dailyTurns,
      limits.monthlyTurns,
      now,
    );
}

export function deleteUserBudget(userId: number) {
  gatewayDatabase().prepare("DELETE FROM user_budgets WHERE user_id = ?").run(userId);
}

export function effectiveLimitsFor(
  row: BudgetLimits | null,
  defaults: BudgetDefaults = budgetDefaults(),
): { limits: BudgetLimits; source: BudgetSource } {
  if (row !== null) {
    return { limits: { ...row }, source: "user" };
  }
  const limits: BudgetLimits = {
    dailyTokens: defaults.dailyTokens,
    monthlyTokens: defaults.monthlyTokens,
    dailyTurns: defaults.dailyTurns,
    monthlyTurns: defaults.monthlyTurns,
  };
  const unlimited = DIMENSIONS.every((dimension) => limits[dimension] === null);
  return { limits, source: unlimited ? "unlimited" : "default" };
}

function usageValue(usage: BudgetUsage, dimension: BudgetDimension) {
  return usage[dimension];
}

function evaluateBudget(
  limits: BudgetLimits,
  usage: BudgetUsage,
  warnPercent: number,
): { exceeded: BudgetExceeded | null; warning: BudgetExceeded | null } {
  const resetAt = resetAtFor();
  let warning: BudgetExceeded | null = null;
  for (const dimension of DIMENSIONS) {
    const limit = limits[dimension];
    if (limit === null) continue;
    const used = usageValue(usage, dimension);
    const hit = {
      dimension,
      used,
      limit,
      resetAt: resetAtForDimension(dimension, resetAt),
    };
    if (used >= limit) return { exceeded: hit, warning: null };
    if (warning === null && limit > 0 && (used / limit) * 100 >= warnPercent) {
      warning = hit;
    }
  }
  return { exceeded: null, warning };
}

export function snapshotForUser(userId: number): BudgetSnapshot {
  const defaults = budgetDefaults();
  const row = userBudgetRow(userId);
  const { limits, source } = effectiveLimitsFor(row, defaults);
  const usage = usageStore.usageForUser(userId);
  const { exceeded, warning } = evaluateBudget(limits, usage, defaults.warnPercent);
  return {
    limits,
    source,
    usage,
    exceeded,
    warning,
    warnPercent: defaults.warnPercent,
    resetAt: resetAtFor(),
  };
}

export function assertBudgetAllowsNewTurn(userId = currentGatewayUserId()) {
  if (userId === null) return;
  const snapshot = snapshotForUser(userId);
  if (snapshot.exceeded === null) return;
  throw gatewayApiError("budget.exceeded", 429, "Usage budget exceeded", {
    dimension: snapshot.exceeded.dimension,
    used: snapshot.exceeded.used,
    limit: snapshot.exceeded.limit,
    resetAt: snapshot.exceeded.resetAt,
  });
}

export function latestBudgetResetAt(userId: number): string | null {
  const row = gatewayDatabase()
    .prepare(
      `SELECT created_at FROM audit_log
        WHERE action = 'budget.reset' AND target_type = 'user' AND target_id = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(String(userId));
  return row === undefined ? null : String(row.created_at);
}
