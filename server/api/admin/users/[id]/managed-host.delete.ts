import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { runAsUserConfigMutation } from "../../../../utils/gateway/config/target-user-mutation";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  requireRecord(userStore.findById(id), "User not found");
  const managed = requireRecord(userStore.getManagedHost(id), "Managed host not found");

  await runAsUserConfigMutation(id, () => hostStore.delete(managed.hostId));
  userStore.deleteManagedHost(id);
  return { ok: true };
});
