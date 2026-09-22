import { getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireAdmin } from "../../../../../utils/gateway/auth/context";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";
import { auditLog } from "../../../../../utils/gateway/audit/audit-log";
import { userStore } from "../../../../../utils/gateway/auth/users";
import { userContainerProvisioner } from "../../../../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  requireRecord(userStore.findById(id), "User not found");
  const user = requireRecord(userStore.findById(id), "User not found");
  await userContainerProvisioner.stop(id);
  auditLog.record(admin, "container.stop", { type: "container", id, label: user.username });
  return { ok: true };
});
