import { readValidatedBody } from "h3";
import { z } from "zod";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { loginLockout } from "../../../utils/gateway/auth/login-lockout";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

const unlockSchema = z.object({ key: z.string().min(1) });

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const { key } = await readValidatedBody(event, (body) => unlockSchema.parse(body));
  loginLockout.reset(key);
  auditLog.record({ id: admin.id, username: admin.username }, "session.lockout.clear", {
    type: "session",
    label: key,
  });
  return { ok: true };
});
