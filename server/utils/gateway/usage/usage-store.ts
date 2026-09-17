import { gatewayDatabase } from "../storage/database";
import { runtimeLog } from "../runtime/runtime-log";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
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
