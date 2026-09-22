import { createError, getRouterParam } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostStore } from "../../utils/gateway/state/hosts";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler((event) => {
  const id = Number(getRouterParam(event, "id"));
  const userId = event.context.auth!.user.id;
  const existing = requireRecord(hostStore.getWithSecret(id), "Host not found");
  if (existing.managed) {
    throw createError({
      statusCode: 403,
      data: { code: "hosts.managedReadonly" },
      statusMessage: "Forbidden",
      message: "Managed hosts are configured by an administrator",
    });
  }
  userConfigMutationService.commit(userId, () => hostStore.delete(id));
  return { ok: true };
});
