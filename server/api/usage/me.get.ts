import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { snapshotForUser } from "../../utils/gateway/usage/budget-store";

export default defineGatewayEventHandler((event) => {
  const user = requireAuthenticatedUser(event);
  return { usage: snapshotForUser(user.id) };
});
