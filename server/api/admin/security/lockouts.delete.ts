import { readValidatedBody } from "h3";
import { z } from "zod";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { loginLockout } from "../../../utils/gateway/auth/login-lockout";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

// `key` unlocks one entry; `{ all: true }` clears every counter, including not-yet-locked ones.
const unlockSchema = z.union([
  z.object({ key: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
]);

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const body = await readValidatedBody(event, (raw) => unlockSchema.parse(raw));
  if ("all" in body) {
    loginLockout.resetAll();
  } else {
    loginLockout.reset(body.key);
  }
  auditLog.record({ id: admin.id, username: admin.username }, "session.lockout.clear", {
    type: "session",
    label: "all" in body ? "*" : body.key,
  });
  return { ok: true };
});
