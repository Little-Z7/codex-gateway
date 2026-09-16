import { createError, getQuery, getRouterParam } from "h3";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { userStore } from "../../../utils/gateway/auth/users";
import { runAsUserConfigMutation } from "../../../utils/gateway/config/target-user-mutation";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { dropGatewayMemoryState } from "../../../utils/gateway/state/memory";
import { userContainerProvisioner } from "../../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const target = requireRecord(userStore.findById(id), "User not found");
  if (id === admin.id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "You cannot delete your own account",
    });
  }
  if (target.role === "admin" && target.isActive && userStore.countActiveAdmins() <= 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "At least one active administrator is required",
    });
  }

  // Drop live sessions first so open tabs close, then deprovision the user's container (stop +
  // remove, volume optionally kept) before tearing down the user's runtime resources by
  // deleting every host through the normal config commit path — it reconciles SSH pools, runtime
  // supervisors, terminals, and preview sessions per host. The durable user row (and cascaded
  // config/managed_hosts rows) is removed afterwards.
  userStore.revokeUserSessions(id);
  const managed = userStore.getManagedHost(id);
  if (managed !== null && managed.containerName !== null) {
    await userContainerProvisioner.deprovision(id, {
      keepVolume: getQuery(event).keepVolume === "true",
    });
  }
  await runAsUserConfigMutation(id, () => {
    for (const host of hostStore.listWithSecret()) {
      hostStore.delete(host.id);
    }
  });
  dropGatewayMemoryState(id);
  userStore.deleteUser(id);
  return { ok: true };
});
