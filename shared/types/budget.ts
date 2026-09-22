export type BudgetDimension = "dailyTokens" | "monthlyTokens" | "dailyTurns" | "monthlyTurns";

export type BudgetSource = "user" | "default" | "unlimited";

export interface BudgetLimits {
  dailyTokens: number | null;
  monthlyTokens: number | null;
  dailyTurns: number | null;
  monthlyTurns: number | null;
}

export interface BudgetDefaults extends BudgetLimits {
  warnPercent: number;
}

export interface BudgetUsage {
  dailyTokens: number;
  dailyTurns: number;
  monthlyTokens: number;
  monthlyTurns: number;
}

export interface BudgetExceeded {
  dimension: BudgetDimension;
  used: number;
  limit: number;
  resetAt: string;
}

export interface BudgetSnapshot {
  limits: BudgetLimits;
  source: BudgetSource;
  usage: BudgetUsage;
  exceeded: BudgetExceeded | null;
  warning: BudgetExceeded | null;
  warnPercent: number;
  resetAt: { daily: string; monthly: string };
}

export interface AdminUserBudgetRow {
  userId: number;
  username: string;
  displayName: string | null;
  effective: BudgetLimits & { source: BudgetSource };
  usage: BudgetUsage;
  resetAt: { daily: string; monthly: string };
  lastResetAt: string | null;
}
