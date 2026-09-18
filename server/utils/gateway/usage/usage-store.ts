import { gatewayDatabase } from "../storage/database";
import { runtimeLog } from "../runtime/runtime-log";

export function usageDayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function usageMonthPrefixUtc(day = usageDayUtc()) {
  return day.slice(0, 7);
}

function todayUtc() {
  return usageDayUtc();
}

function bump(
  userId: number,
  model: string,
  patch: { threads?: number; turns?: number; input?: number; output?: number },
) {
  gatewayDatabase()
    .prepare(
      `INSERT INTO usage_daily (user_id, day, model, threads, turns, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day, model) DO UPDATE SET
         threads = threads + excluded.threads,
         turns = turns + excluded.turns,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         updated_at = datetime('now')`,
    )
    .run(
      userId,
      todayUtc(),
      model,
      patch.threads ?? 0,
      patch.turns ?? 0,
      patch.input ?? 0,
      patch.output ?? 0,
    );
}

export const usageStore = {
  recordThreadStarted(userId: number, model: string | null) {
    try {
      bump(userId, model ?? "unknown", { threads: 1 });
    } catch (error) {
      runtimeLog("usage record failed", {
        event: "thread.started",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  recordTurnCompleted(
    userId: number,
    model: string | null,
    usage: { inputTokens: number; outputTokens: number } | null,
  ) {
    try {
      bump(userId, model ?? "unknown", {
        turns: 1,
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
      });
    } catch (error) {
      runtimeLog("usage record failed", {
        event: "turn.completed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  query(input: { from?: string; to?: string; groupBy: "user" | "day" | "model" }) {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (input.from !== undefined) {
      conditions.push("day >= ?");
      params.push(input.from);
    }
    if (input.to !== undefined) {
      conditions.push("day <= ?");
      params.push(input.to);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const groupColumn =
      input.groupBy === "user" ? "user_id" : input.groupBy === "model" ? "model" : "day";
    const rows = gatewayDatabase()
      .prepare(
        `SELECT ${groupColumn} AS bucket,
                SUM(threads) AS threads,
                SUM(turns) AS turns,
                SUM(input_tokens) AS inputTokens,
                SUM(output_tokens) AS outputTokens
           FROM usage_daily ${where}
           GROUP BY ${groupColumn}
           ORDER BY bucket`,
      )
      .all(...params);
    return rows.map((row) => ({
      bucket: String(Reflect.get(row, "bucket") ?? ""),
      threads: Number(Reflect.get(row, "threads") ?? 0),
      turns: Number(Reflect.get(row, "turns") ?? 0),
      inputTokens: Number(Reflect.get(row, "inputTokens") ?? 0),
      outputTokens: Number(Reflect.get(row, "outputTokens") ?? 0),
    }));
  },

  usageForUser(userId: number) {
    const day = todayUtc();
    const monthPrefix = `${usageMonthPrefixUtc(day)}%`;
    const row = gatewayDatabase()
      .prepare(
        `SELECT
            COALESCE(SUM(CASE WHEN day = ? THEN turns ELSE 0 END), 0) AS dailyTurns,
            COALESCE(SUM(CASE WHEN day = ? THEN input_tokens + output_tokens ELSE 0 END), 0) AS dailyTokens,
            COALESCE(SUM(CASE WHEN day LIKE ? THEN turns ELSE 0 END), 0) AS monthlyTurns,
            COALESCE(SUM(CASE WHEN day LIKE ? THEN input_tokens + output_tokens ELSE 0 END), 0) AS monthlyTokens
           FROM usage_daily
          WHERE user_id = ?`,
      )
      .get(day, day, monthPrefix, monthPrefix, userId);
    return {
      dailyTurns: Number(Reflect.get(row ?? {}, "dailyTurns") ?? 0),
      dailyTokens: Number(Reflect.get(row ?? {}, "dailyTokens") ?? 0),
      monthlyTurns: Number(Reflect.get(row ?? {}, "monthlyTurns") ?? 0),
      monthlyTokens: Number(Reflect.get(row ?? {}, "monthlyTokens") ?? 0),
    };
  },

  usageByUser() {
    const day = todayUtc();
    const monthPrefix = `${usageMonthPrefixUtc(day)}%`;
    const rows = gatewayDatabase()
      .prepare(
        `SELECT user_id AS userId,
                COALESCE(SUM(CASE WHEN day = ? THEN turns ELSE 0 END), 0) AS dailyTurns,
                COALESCE(SUM(CASE WHEN day = ? THEN input_tokens + output_tokens ELSE 0 END), 0) AS dailyTokens,
                COALESCE(SUM(CASE WHEN day LIKE ? THEN turns ELSE 0 END), 0) AS monthlyTurns,
                COALESCE(SUM(CASE WHEN day LIKE ? THEN input_tokens + output_tokens ELSE 0 END), 0) AS monthlyTokens
           FROM usage_daily
          GROUP BY user_id`,
      )
      .all(day, day, monthPrefix, monthPrefix);
    return rows.map((row) => ({
      userId: Number(Reflect.get(row, "userId") ?? 0),
      dailyTurns: Number(Reflect.get(row, "dailyTurns") ?? 0),
      dailyTokens: Number(Reflect.get(row, "dailyTokens") ?? 0),
      monthlyTurns: Number(Reflect.get(row, "monthlyTurns") ?? 0),
      monthlyTokens: Number(Reflect.get(row, "monthlyTokens") ?? 0),
    }));
  },

  resetCurrentPeriod(userId: number) {
    const monthPrefix = `${usageMonthPrefixUtc()}%`;
    gatewayDatabase()
      .prepare(
        `UPDATE usage_daily
            SET threads = 0,
                turns = 0,
                input_tokens = 0,
                output_tokens = 0,
                updated_at = datetime('now')
          WHERE user_id = ? AND day LIKE ?`,
      )
      .run(userId, monthPrefix);
  },

  todayTotals() {
    const row = gatewayDatabase()
      .prepare(
        `SELECT COALESCE(SUM(turns), 0) AS turns,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
           FROM usage_daily WHERE day = ?`,
      )
      .get(todayUtc());
    return {
      turns: Number(Reflect.get(row ?? {}, "turns") ?? 0),
      tokens: Number(Reflect.get(row ?? {}, "tokens") ?? 0),
    };
  },
};
