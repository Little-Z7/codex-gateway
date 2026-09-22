import { getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireAdmin } from "../../../../../utils/gateway/auth/context";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";
import { userStore } from "../../../../../utils/gateway/auth/users";
import { userContainerProvisioner } from "../../../../../utils/gateway/provisioning/user-container-provisioner";

import { auditLog } from "../../../../../utils/gateway/audit/audit-log";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  requireRecord(userStore.findById(id), "User not found");
  await userContainerProvisioner.start(id);
  auditLog.record(admin, "container.start", { type: "container", id, label: String(id) });
  return { ok: true };
});
