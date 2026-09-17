import { requireAdmin } from "../../../utils/gateway/auth/context";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import {
  cancelRecreateAll,
  recreateAllStatus,
} from "../../../utils/gateway/provisioning/image-rebuild";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  cancelRecreateAll();
  auditLog.record(
    admin,
    "container.recreate-all.cancel",
    { type: "system", id: null, label: "all user containers" },
    {},
  );
  return recreateAllStatus();
});
