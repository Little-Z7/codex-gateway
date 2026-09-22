import { getRouterParam, sendStream, setResponseHeader } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler, gatewayApiError } from "../../../../utils/gateway/http/errors";
import { backupTarStream } from "../../../../utils/gateway/backups";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const name = getRouterParam(event, "name") ?? "";
  const tar = backupTarStream(name);
  if (tar === null) {
    throw gatewayApiError("admin.backupNotFound", 404, "Backup not found");
  }
  setResponseHeader(event, "content-type", "application/x-tar");
  setResponseHeader(event, "content-disposition", `attachment; filename="${name}.tar"`);
  // Streamed rather than buffered — the tar bundles every volume backup, which can add up to
  // hundreds of MB now that the Codex standalone install lives under each user's home volume.
  return sendStream(event, tar);
});
