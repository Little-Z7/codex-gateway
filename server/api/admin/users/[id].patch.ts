import { createError, getRouterParam, readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { userStore } from "../../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { auditLog } from "../../../utils/gateway/audit/audit-log";

const updateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: z.enum(["admin", "user"]).optional(),
    password: z.string().min(8).optional(),
    displayName: z.string().max(64).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    mustChangePassword: z.boolean().optional(),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => updateUserSchema.parse(body));
  const target = requireRecord(userStore.findById(id), "User not found");

  const losesAdmin =
    (input.role === "user" && target.role === "admin") ||
    (input.isActive === false && target.role === "admin");
  if (losesAdmin) {
    if (id === admin.id) {
      throw createError({
        statusCode: 400,
        data: { code: "admin.selfDemotion" },
        statusMessage: "Bad Request",
        message: "You cannot disable or demote your own account",
      });
    }
    if (userStore.countActiveAdmins() <= 1) {
      throw createError({
        statusCode: 400,
        data: { code: "admin.lastAdmin" },
        statusMessage: "Bad Request",
        message: "At least one active administrator is required",
      });
    }
  }

  const user = requireRecord(userStore.updateUser(id, input), "User not found");
  auditLog.record(
    admin,
    "user.update",
    { type: "user", id, label: target.username },
    {
      isActive: input.isActive,
      role: input.role,
      passwordReset: input.password !== undefined,
      displayName: input.displayName,
      mustChangePassword: input.mustChangePassword,
    },
  );
  // Disabling or resetting credentials must drop live sessions so existing tabs and sockets die.
  if (input.isActive === false || input.password !== undefined) {
    userStore.revokeUserSessions(id);
  }
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      displayName: user.displayName,
      note: user.note,
      mustChangePassword: user.mustChangePassword,
    },
  };
});
