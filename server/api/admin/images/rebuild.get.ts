import { requireAdmin } from "../../../utils/gateway/auth/context";
import { imageRebuildStatus } from "../../../utils/gateway/provisioning/image-rebuild";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  return imageRebuildStatus();
});
