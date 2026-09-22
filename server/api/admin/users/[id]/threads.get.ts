import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { defineGatewayEventHandler, gatewayApiError } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { runWithGatewayUser } from "../../../../utils/gateway/state/memory";
import { threadMetadataStore } from "../../../../utils/gateway/state/thread-metadata";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id)) {
    throw gatewayApiError("admin.invalidUserId", 400, "Invalid user id");
  }
  const user = requireRecord(userStore.findById(id), "User not found");
  const managed = userStore.getManagedHost(user.id);
  // Thread metadata is a per-user runtime cache; without a managed host there is nothing to
  // count, and a gateway restart may legitimately leave it empty.
  if (managed === null || managed.hostId === 0) {
    return { threads: { count: 0, lastActiveAt: null, cached: true } };
  }
  const stats = runWithGatewayUser(user.id, () => {
    const threads = threadMetadataStore.list(managed.hostId);
    return {
      count: threads.length,
      lastActiveAt:
        threads.length === 0 ? null : Math.max(...threads.map((thread) => thread.updatedAt)),
    };
  });
  return {
    threads: {
      count: stats.count,
      lastActiveAt:
        stats.lastActiveAt === null ? null : new Date(stats.lastActiveAt * 1000).toISOString(),
      cached: true,
    },
  };
});
