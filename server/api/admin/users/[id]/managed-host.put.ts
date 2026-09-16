import { getRouterParam, readValidatedBody } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { runAsUserConfigMutation } from "../../../../utils/gateway/config/target-user-mutation";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { hostCreateSchema } from "../../../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => hostCreateSchema.parse(body));
  requireRecord(userStore.findById(id), "User not found");

  const host = await runAsUserConfigMutation(id, () => {
    const managed = userStore.getManagedHost(id);
    const payload = {
      ...input,
      // Managed hosts run on the docker-internal network; the host schema's socks default must
      // never leak into a managed record.
      proxyUrl: input.proxyUrl ?? null,
      managed: true,
    };
    if (managed !== null && hostStore.getWithSecret(managed.hostId)?.managed === true) {
      return requireRecord(hostStore.update(managed.hostId, payload), "Host not found");
    }
    return hostStore.create(payload);
  });

  userStore.upsertManagedHost(id, host.id, { status: "ready", lastError: null });
  return { host };
});
