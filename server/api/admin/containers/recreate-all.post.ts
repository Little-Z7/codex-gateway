import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { userStore } from "../../../utils/gateway/auth/users";
import { defineGatewayEventHandler, gatewayApiError } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { userContainerProvisioner } from "../../../utils/gateway/provisioning/user-container-provisioner";
import { listManagedContainers } from "../../../utils/gateway/provisioning/container-inventory";
import { startRecreateAll } from "../../../utils/gateway/provisioning/image-rebuild";

const bodySchema = z
  .object({ intervalSeconds: z.number().int().min(0).max(600).optional() })
  .strict()
  .optional();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body ?? undefined)).catch(
    () => undefined,
  );
  const rows = await listManagedContainers();
  const targets = rows
    .filter((row) => row.state === "running" || row.state === "exited")
    .map((row) => row.userId);
  if (targets.length === 0) {
    throw gatewayApiError("admin.nothingToRecreate", 400, "No running or exited containers");
  }
  const usersById = new Map(userStore.listUsers().map((user) => [user.id, user.username]));
  try {
    const status = startRecreateAll(
      {
        userIds: targets,
        usernameFor: (userId) => usersById.get(userId) ?? `#${userId}`,
        deprovision: (userId) => userContainerProvisioner.deprovision(userId, { keepVolume: true }),
        provision: (userId) => userContainerProvisioner.provision(userId),
      },
      input?.intervalSeconds ?? 10,
    );
    auditLog.record(
      admin,
      "container.recreate-all",
      { type: "system", id: null, label: "all user containers" },
      { count: targets.length, intervalSeconds: input?.intervalSeconds ?? 10 },
    );
    return status;
  } catch (error) {
    if (error instanceof Error && error.message.includes("already running")) {
      throw gatewayApiError("admin.recreateBusy", 409, error.message);
    }
    throw error;
  }
});
