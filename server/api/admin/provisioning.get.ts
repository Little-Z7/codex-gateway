import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireAdmin } from "../../utils/gateway/auth/context";
import { provisioningDiagnostics } from "../../utils/gateway/provisioning/provisioning-diagnostics";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  return await provisioningDiagnostics();
});
