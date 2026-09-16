import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { userContainerProvisioner } from "../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const managedHosts = userStore.listManagedHosts();
  const users = await Promise.all(
    userStore.listUsers().map(async (user) => {
      const managed = managedHosts.get(user.id);
      let hostName: string | null = null;
      if (managed) {
        const host = userStore.loadConfig(user.id).hosts.find((item) => item.id === managed.hostId);
        hostName = host?.name ?? null;
      }
      const hasContainer =
        managed !== undefined && managed.containerName !== null && managed.status !== "removed";
      // Inspect is a live docker call per row; failures degrade to "unknown" inside the
      // provisioner so one broken daemon read does not fail the whole list.
      const container = hasContainer ? await userContainerProvisioner.inspect(user.id) : null;
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
        container,
      };
    }),
  );
  return { users };
});
