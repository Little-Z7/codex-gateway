import { getQuery } from "h3";
import { requireAdmin } from "../../utils/gateway/auth/context";
import { auditLog } from "../../utils/gateway/audit/audit-log";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const query = getQuery(event);
  return auditLog.list({
    limit: query.limit === undefined ? 50 : Number(query.limit),
    cursor: query.cursor === undefined ? undefined : Number(query.cursor),
    userId: query.userId === undefined || query.userId === "" ? undefined : Number(query.userId),
    action: typeof query.action === "string" ? query.action : undefined,
  });
});
