import { getHeader, readValidatedBody, type H3Event } from "h3";
import { z } from "zod";
import { auditLog } from "../../utils/gateway/audit/audit-log";
import { loginLockout } from "../../utils/gateway/auth/login-lockout";
import { userStore } from "../../utils/gateway/auth/users";
import { gatewayApiError } from "../../utils/gateway/http/errors";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => loginSchema.parse(body));
  const ip = clientIp(event);
  const userAgent = (getHeader(event, "user-agent") ?? "").slice(0, 80);
  const keys = [`u:${input.username.toLowerCase()}`, `ip:${ip}`];

  // Locked by username or source IP: same response either way, no oracle.
  for (const key of keys) {
    const retryAfterSeconds = loginLockout.lockedFor(key);
    if (retryAfterSeconds !== null) {
      throw gatewayApiError("auth.locked", 429, "Too many failed attempts; locked", {
        retryAfterSeconds,
      });
    }
  }

  const session = await userStore.login(input.username, input.password);
  if (!session) {
    for (const key of keys) loginLockout.recordFailure(key);
    auditLog.record(
      null,
      "session.login.failed",
      {
        type: "session",
        label: input.username,
      },
      { ip, userAgent },
    );
    throw gatewayApiError("auth.invalidCredentials", 401, "Invalid username or password");
  }
  for (const key of keys) loginLockout.reset(key);
  auditLog.record(
    { id: session.user.id, username: session.user.username },
    "session.login",
    { type: "session", id: session.user.id, label: session.user.username },
    { ip, userAgent },
  );
  return session;
});

function clientIp(event: H3Event) {
  const forwarded = getHeader(event, "x-forwarded-for");
  if (forwarded !== undefined && forwarded.trim() !== "") {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return event.node.req.socket.remoteAddress ?? "unknown";
}
