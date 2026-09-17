import { requireAdmin } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { listBackups } from "../../utils/gateway/backups";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  return {
    backups: listBackups().map(({ name, sizeBytes, createdAt }) => ({
      name,
      sizeBytes,
      createdAt,
    })),
  };
});
