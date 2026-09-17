import { requireAdmin } from "../../utils/gateway/auth/context";
import { sharedLogin } from "../../utils/gateway/provisioning/shared-login";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  return sharedLogin.status();
});
