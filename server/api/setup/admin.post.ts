import { readValidatedBody } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler, gatewayApiError } from "../../utils/gateway/http/errors";
import { auditLog } from "../../utils/gateway/audit/audit-log";
import { userStore } from "../../utils/gateway/auth/users";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
});

export default defineGatewayEventHandler(async (event) => {
  if (userStore.listUsers().length > 0) {
    throw gatewayApiError("setup.completed", 409, "Gateway already initialized");
  }
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  const user = userStore.createUser(input.username, input.password, "admin");
  if (user === null) {
    throw gatewayApiError("setup.failed", 500, "Failed to create the admin user");
  }
  auditLog.record({ id: user.id, username: user.username }, "setup.admin.create", {
    type: "user",
    id: user.id,
    label: user.username,
  });
  return { ok: true };
});
