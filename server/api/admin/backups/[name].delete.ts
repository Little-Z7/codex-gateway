import { getRouterParam } from "h3";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler, gatewayApiError } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { deleteBackup } from "../../../utils/gateway/backups";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const name = getRouterParam(event, "name") ?? "";
  if (!deleteBackup(name)) {
    throw gatewayApiError("admin.backupNotFound", 404, "Backup not found");
  }
  auditLog.record(admin, "backup.delete", { type: "system", id: name, label: name });
  return { ok: true };
});
