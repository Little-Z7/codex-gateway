import { requireAdmin } from "../../../utils/gateway/auth/context";
import { loginLockout } from "../../../utils/gateway/auth/login-lockout";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler((event) => {
  requireAdmin(event);
  return { lockouts: loginLockout.list() };
});
