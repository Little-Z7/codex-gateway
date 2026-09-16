import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { runWithGatewayUser } from "../../../../utils/gateway/state/memory";
import { ensureUserConfigLoaded } from "../../../../utils/gateway/http/errors";
import { hostStore } from "../../../../utils/gateway/state/hosts";

// Returns the managed host record without secrets so the admin dialog can prefill the connection
// form; secrets stay server-side and are preserved on update when the form submits nulls.
export default defineGatewayEventHandler((event) => {
  requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  requireRecord(userStore.findById(id), "User not found");
  const managed = requireRecord(userStore.getManagedHost(id), "Managed host not found");
  return runWithGatewayUser(id, () => {
    ensureUserConfigLoaded(id);
    return requireRecord(hostStore.get(managed.hostId), "Managed host not found");
  });
});
