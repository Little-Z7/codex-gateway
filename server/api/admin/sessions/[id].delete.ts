import { createError, getRouterParam } from "h3";
import { requireAdmin, tokenFromEvent } from "../../../utils/gateway/auth/context";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { gatewayDatabase } from "../../../utils/gateway/storage/database";
import { hashToken } from "../../../utils/gateway/storage/crypto";
import { sessionActivityTracker } from "../../../utils/gateway/auth/session-activity-tracker";
import { sessionRevocationEvents } from "../../../utils/gateway/auth/session-events";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const row = gatewayDatabase()
    .prepare(
      `SELECT sessions.id, sessions.token_hash, sessions.user_id, users.username
       FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?`,
    )
    .get(id);
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Session not found" });
  }
  if (String(row.token_hash) === hashToken(tokenFromEvent(event))) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "You cannot revoke your current session here; sign out instead",
    });
  }
  gatewayDatabase().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  const tokenHash = String(row.token_hash);
  sessionActivityTracker.forget(tokenHash);
  sessionRevocationEvents.emit(tokenHash);
  auditLog.record(admin, "session.revoke", {
    type: "session",
    id,
    label: String(row.username),
  });
  return { ok: true };
});
