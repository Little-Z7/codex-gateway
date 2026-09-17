import { recordFromUnknown } from "~~/shared/utils/records";
import { gatewayDatabase } from "../storage/database";

export interface AuditActor {
  id: number;
  username: string;
}

export interface AuditTarget {
  type: "user" | "host" | "container" | "session" | "system";
  id?: string | number | null;
  label?: string | null;
}

export interface AuditEntry {
  id: number;
  actorUserId: number | null;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const SENSITIVE_KEYS = /password|token|secret|key|credential/i;

function sanitizeDetail(detail: Record<string, unknown> | undefined) {
  if (!detail) {
    return null;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEYS.test(key)) {
      continue;
    }
    clean[key] =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : String(value);
  }
  return clean;
}

export const auditLog = {
  record(
    actor: AuditActor | null,
    action: string,
    target: AuditTarget,
    detail?: Record<string, unknown>,
  ) {
    try {
      gatewayDatabase()
        .prepare(
          `INSERT INTO audit_log
             (actor_user_id, actor_username, action, target_type, target_id, target_label, detail_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          actor?.id ?? null,
          actor?.username ?? "system",
          action,
          target.type,
          target.id == null ? null : String(target.id),
          target.label ?? null,
          JSON.stringify(sanitizeDetail(detail)),
          new Date().toISOString(),
        );
    } catch (error) {
      console.warn("[gateway-audit] failed to record", {
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  list(options: { limit?: number; cursor?: number; userId?: number; action?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.cursor !== undefined) {
      where.push("id < ?");
      params.push(options.cursor);
    }
    if (options.userId !== undefined) {
      // Actor-side and target-side entries both belong to a user's audit trail.
      where.push("(actor_user_id = ? OR (target_type = 'user' AND target_id = ?))");
      params.push(options.userId, String(options.userId));
    }
    if (options.action !== undefined && options.action !== "") {
      where.push("action = ?");
      params.push(options.action);
    }
    const rows = gatewayDatabase()
      .prepare(
        `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, limit + 1);
    const entries = rows.slice(0, limit).map((row) => ({
      id: Number(row.id),
      actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
      actorUsername: String(row.actor_username),
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: row.target_id == null ? null : String(row.target_id),
      targetLabel: row.target_label == null ? null : String(row.target_label),
      detail:
        row.detail_json == null ? null : recordFromUnknown(JSON.parse(String(row.detail_json))),
      createdAt: String(row.created_at),
    }));
    const nextCursor = rows.length > limit ? Number(rows[limit - 1]?.id ?? rows[limit]?.id) : null;
    return { entries, nextCursor };
  },
};
