import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

export default defineGatewayEventHandler((event) => {
  requireAdmin(event);
  const managedHosts = userStore.listManagedHosts();
  return {
    users: userStore.listUsers().map((user) => {
      const managed = managedHosts.get(user.id);
      let hostName: string | null = null;
      if (managed) {
        const host = userStore.loadConfig(user.id).hosts.find((item) => item.id === managed.hostId);
        hostName = host?.name ?? null;
      }
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        managedHost:
          managed === undefined
            ? null
            : {
                hostId: managed.hostId,
                hostName,
                status: managed.status,
                lastError: managed.lastError,
              },
      };
    }),
  };
});
