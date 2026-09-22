import { requireAdmin } from "../../utils/gateway/auth/context";
import { listManagedContainers } from "../../utils/gateway/provisioning/container-inventory";
import { provisioningConfig } from "../../utils/gateway/provisioning/provisioning-config";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const containers = await listManagedContainers();
  return { enabled: provisioningConfig().enabled, containers };
});
