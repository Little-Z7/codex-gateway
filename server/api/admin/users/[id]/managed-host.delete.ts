import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { auditLog } from "../../../../utils/gateway/audit/audit-log";
import { userStore } from "../../../../utils/gateway/auth/users";
import { runAsUserConfigMutation } from "../../../../utils/gateway/config/target-user-mutation";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const user = requireRecord(userStore.findById(id), "User not found");
  const managed = requireRecord(userStore.getManagedHost(id), "Managed host not found");

  await runAsUserConfigMutation(id, () => hostStore.delete(managed.hostId));
  userStore.deleteManagedHost(id);
  auditLog.record(admin, "managed-host.remove", {
    type: "host",
    id: managed.hostId,
    label: user.username,
  });
  return { ok: true };
});
