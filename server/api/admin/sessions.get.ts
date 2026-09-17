import { requireAdmin, tokenFromEvent } from "../../utils/gateway/auth/context";
import { gatewayDatabase } from "../../utils/gateway/storage/database";
import { hashToken } from "../../utils/gateway/storage/crypto";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const currentTokenHash = hashToken(tokenFromEvent(event));
  const rows = gatewayDatabase()
    .prepare(
      `SELECT sessions.id, sessions.user_id, users.username,
              sessions.created_at, sessions.last_seen_at, sessions.expires_at, sessions.token_hash
       FROM sessions JOIN users ON users.id = sessions.user_id
       ORDER BY sessions.last_seen_at DESC`,
    )
    .all();
  return {
    sessions: rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      username: String(row.username),
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
      expiresAt: String(row.expires_at),
      current: String(row.token_hash) === currentTokenHash,
    })),
  };
});
