import { getRouterParam, readValidatedBody } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { runAsUserConfigMutation } from "../../../../utils/gateway/config/target-user-mutation";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { hostCreateSchema } from "../../../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../../../utils/gateway/state/hosts";

import { auditLog } from "../../../../utils/gateway/audit/audit-log";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
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
      const existing = hostStore.getWithSecret(managed.hostId);
      return requireRecord(
        hostStore.update(managed.hostId, {
          ...payload,
          // The admin form never carries stored secrets; empty fields keep the current values.
          password: input.password ?? existing?.password ?? null,
          privateKey: input.privateKey ?? existing?.privateKey ?? null,
        }),
        "Host not found",
      );
    }
    return hostStore.create(payload);
  });

  userStore.upsertManagedHost(id, host.id, { status: "ready", lastError: null });
  auditLog.record(
    admin,
    "managed-host.save",
    { type: "host", id: host.id, label: String(id) },
    { hostName: host.name },
  );
  return { host };
});
