import { getRouterParam, readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { defineGatewayEventHandler, gatewayApiError } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { auditLog } from "../../../../utils/gateway/audit/audit-log";
import { parseMemoryLimit } from "../../../../utils/gateway/provisioning/user-container-provisioner";

const quotaSchema = z
  .object({
    memory: z.string().nullable().optional(),
    cpus: z.string().nullable().optional(),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => quotaSchema.parse(body));
  const target = requireRecord(userStore.findById(id), "User not found");

  const memory = input.memory === undefined ? undefined : input.memory;
  const cpus = input.cpus === undefined ? undefined : input.cpus;
  if (memory !== undefined && memory !== null && parseMemoryLimit(memory) === undefined) {
    throw gatewayApiError("admin.quotaInvalid", 400, "Invalid memory limit format");
  }
  if (cpus !== undefined && cpus !== null) {
    const value = Number(cpus);
    if (!Number.isFinite(value) || value <= 0 || value > 1024) {
      throw gatewayApiError("admin.quotaInvalid", 400, "Invalid CPU limit format");
    }
  }

  const managed = userStore.getManagedHost(id);
  if (managed === null) {
    throw gatewayApiError("admin.noManagedHost", 404, "User has no managed host");
  }
  const next = {
    memoryLimit: memory === undefined ? managed.memoryLimit : memory,
    cpuLimit: cpus === undefined ? managed.cpuLimit : cpus,
  };
  userStore.setManagedHostQuota(id, next);
  auditLog.record(
    admin,
    "user.quota.update",
    { type: "user", id, label: target.username },
    { memoryLimit: next.memoryLimit, cpuLimit: next.cpuLimit },
  );
  return { quota: next };
});
