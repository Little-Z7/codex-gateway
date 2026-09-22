import { getRouterParam } from "h3";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { userStore } from "../../../utils/gateway/auth/users";
import { listManagedContainers } from "../../../utils/gateway/provisioning/container-inventory";
import { gatewayApiError } from "../../../utils/gateway/http/errors";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const userId = Number(getRouterParam(event, "userId"));
  if (!Number.isFinite(userId)) {
    throw gatewayApiError("admin.invalidUserId", 400, "Invalid user id");
  }
  const container = (await listManagedContainers()).find((row) => row.userId === userId) ?? null;
  return {
    container,
    managedHost: userStore.getManagedHost(userId),
  };
});
