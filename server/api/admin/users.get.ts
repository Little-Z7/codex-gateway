import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { gatewayDatabase } from "../../utils/gateway/storage/database";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { userContainerProvisioner } from "../../utils/gateway/provisioning/user-container-provisioner";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const managedHosts = userStore.listManagedHosts();
  const onlineSince = new Date(Date.now() - 5 * 60_000).toISOString();
  const sessionStats = new Map<number, { lastLoginAt: string | null; onlineSessions: number }>();
  for (const row of gatewayDatabase()
    .prepare(
      `SELECT user_id, MAX(created_at) AS last_login_at,
              SUM(last_seen_at >= ?) AS online_sessions
       FROM sessions GROUP BY user_id`,
    )
    .all(onlineSince)) {
    sessionStats.set(Number(row.user_id), {
      lastLoginAt: row.last_login_at == null ? null : String(row.last_login_at),
      onlineSessions: Number(row.online_sessions ?? 0),
    });
  }
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
                containerName: managed.containerName,
                volumeName: managed.volumeName,
                quota: {
                  memory: managed.memoryLimit,
                  cpus: managed.cpuLimit,
                },
              },
        container,
        lastLoginAt: sessionStats.get(user.id)?.lastLoginAt ?? null,
        onlineSessions: sessionStats.get(user.id)?.onlineSessions ?? 0,
      };
    }),
  );
  return { users };
});
