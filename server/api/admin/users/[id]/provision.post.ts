import { createError, getQuery, getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { userStore } from "../../../../utils/gateway/auth/users";
import { userContainerProvisioner } from "../../../../utils/gateway/provisioning/user-container-provisioner";
import { provisioningConfig } from "../../../../utils/gateway/provisioning/provisioning-config";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  if (!provisioningConfig().enabled) {
    throw createError({ statusCode: 400, statusMessage: "Provisioning is disabled" });
  }
  const id = Number(getRouterParam(event, "id"));
  const user = requireRecord(userStore.findById(id), "User not found");
  const managed = userStore.getManagedHost(id);
  const hasContainer =
    managed !== null && managed.containerName !== null && managed.status !== "removed";
  const recreate = getQuery(event).recreate === "1" || getQuery(event).recreate === "true";
  if (hasContainer && !recreate) {
    throw createError({ statusCode: 409, statusMessage: "Container already exists" });
  }
  if (hasContainer) {
    await userContainerProvisioner.deprovision(id, { keepVolume: true });
  }
  // Runs in the background; the users list surfaces status transitions.
  void userContainerProvisioner.provision(id).catch(() => {});
  return { ok: true, username: user.username };
});
