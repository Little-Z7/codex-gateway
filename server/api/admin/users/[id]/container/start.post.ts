import { getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireAdmin } from "../../../../../utils/gateway/auth/context";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";
import { userStore } from "../../../../../utils/gateway/auth/users";
import { userContainerProvisioner } from "../../../../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  requireRecord(userStore.findById(id), "User not found");
  await userContainerProvisioner.start(id);
  return { ok: true };
});
