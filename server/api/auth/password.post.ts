import { readValidatedBody } from "h3";
import { z } from "zod";
import { auditLog } from "../../utils/gateway/audit/audit-log";
import { loginLockout } from "../../utils/gateway/auth/login-lockout";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { securitySettings } from "../../utils/gateway/settings/model-provider";
import { userStore } from "../../utils/gateway/auth/users";
import { gatewayApiError } from "../../utils/gateway/http/errors";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export default defineEventHandler(async (event) => {
  const user = requireAuthenticatedUser(event);
  if (!securitySettings().allowSelfPasswordChange) {
    throw gatewayApiError("auth.passwordChangeDisabled", 403, "Password change is disabled");
  }
  const input = await readValidatedBody(event, (body) => passwordSchema.parse(body));
  const key = `u:${user.username}`;
  const locked = loginLockout.lockedFor(key);
  if (locked !== null) {
    throw gatewayApiError("auth.locked", 429, "Too many failed attempts; locked", {
      retryAfterSeconds: locked,
    });
  }
  if (!userStore.verifyUserPassword(user.id, input.currentPassword)) {
    loginLockout.recordFailure(key);
    throw gatewayApiError("auth.invalidCredentials", 403, "Current password is incorrect");
  }
  loginLockout.reset(key);
  userStore.changePassword(user.id, input.newPassword);
  // Other sessions die on password change; the caller keeps the token it authenticated with.
  userStore.revokeOtherUserSessions(user.id, event.context.auth?.token ?? "");
  auditLog.record({ id: user.id, username: user.username }, "user.password.change", {
    type: "user",
    id: user.id,
    label: user.username,
  });
  return { ok: true };
});
