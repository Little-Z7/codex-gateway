import { createError, readValidatedBody } from "h3";
import type { GatewayConfig, HostRecord } from "~~/shared/types";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { parseGatewayConfig } from "../../utils/gateway/http/validation/config";
import { hostStore } from "../../utils/gateway/state/hosts";
import { runtimeConfigStore } from "../../utils/gateway/state/runtime-config";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const userId = event.context.auth!.user.id;
  const config = await readValidatedBody(event, parseGatewayConfig);
  const currentHosts = hostStore.listWithSecret();
  assertManagedHostsUnchanged(currentHosts, config);
  // Export strips managed-host secrets, so a payload that round-trips through export carries
  // `null` credentials. Restore the stored records before replacing state or the import would
  // erase the container keys.
  const managedById = new Map(
    currentHosts.filter((host) => host.managed).map((host) => [host.id, host]),
  );
  config.hosts = config.hosts.map((host) =>
    host.managed ? (managedById.get(host.id) ?? host) : host,
  );
  return userConfigMutationService.commit(userId, () => {
    runtimeConfigStore.replace(config);
    return runtimeConfigStore.export();
  });
});

/**
 * A full-config import must never remove, add, or edit a managed host; those are owned by the
 * admin-managed-host endpoints. Only the durable identity/connection fields participate in the
 * comparison — secrets may legitimately be absent from the payload.
 */
function assertManagedHostsUnchanged(current: HostRecord[], incoming: GatewayConfig) {
  const incomingManagedById = new Map(
    incoming.hosts.filter((host) => host.managed).map((h) => [h.id, h]),
  );
  for (const host of current.filter((item) => item.managed)) {
    const candidate = incomingManagedById.get(host.id);
    if (candidate === undefined || !sameManagedHost(host, candidate)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        message: "Managed hosts can only be changed by an administrator",
      });
    }
  }
  if (incomingManagedById.size !== current.filter((item) => item.managed).length) {
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "Managed hosts can only be changed by an administrator",
    });
  }
}

function sameManagedHost(existing: HostRecord, incoming: HostRecord) {
  return (
    existing.name === incoming.name &&
    existing.sshHost === incoming.sshHost &&
    existing.username === incoming.username &&
    existing.port === incoming.port &&
    existing.authMode === incoming.authMode &&
    existing.privateKeyPath === incoming.privateKeyPath &&
    existing.proxyUrl === incoming.proxyUrl &&
    existing.hasPassword === incoming.hasPassword
  );
}
