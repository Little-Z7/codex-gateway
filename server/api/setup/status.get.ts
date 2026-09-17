import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { userStore } from "../../utils/gateway/auth/users";

export default defineGatewayEventHandler(async () => {
  return { needsSetup: userStore.listUsers().length === 0 };
});
