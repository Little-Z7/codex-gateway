import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../../utils/gateway/auth/context";
import { auditLog } from "../../../../../utils/gateway/audit/audit-log";
import { userStore } from "../../../../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const user = requireRecord(userStore.findById(id), "User not found");
  userStore.revokeUserSessions(id);
  auditLog.record(admin, "user.sessions.revoke", { type: "user", id, label: user.username });
  return { ok: true };
});
