import { requireAdmin } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { auditLog } from "../../utils/gateway/audit/audit-log";
import { runBackup } from "../../utils/gateway/backups";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const result = await runBackup();
  auditLog.record(admin, "backup.create", { type: "system", id: result.name, label: result.name });
  return result;
});
