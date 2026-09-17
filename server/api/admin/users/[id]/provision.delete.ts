import { getQuery, getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { auditLog } from "../../../../utils/gateway/audit/audit-log";
import { userStore } from "../../../../utils/gateway/auth/users";
import { userContainerProvisioner } from "../../../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const user = requireRecord(userStore.findById(id), "User not found");
  const keepVolume = getQuery(event).keepVolume === "true";
  await userContainerProvisioner.deprovision(id, { keepVolume });
  auditLog.record(
    admin,
    "container.delete",
    { type: "container", id, label: user.username },
    { keepVolume },
  );
  return { ok: true };
});
