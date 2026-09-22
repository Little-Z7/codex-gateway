import { requireAdmin } from "../../../utils/gateway/auth/context";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { sharedLogin } from "../../../utils/gateway/provisioning/shared-login";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  await sharedLogin.cancel();
  auditLog.record(admin, "shared-login.cancel", { type: "system", label: "shared codex auth" });
  return { ok: true };
});
