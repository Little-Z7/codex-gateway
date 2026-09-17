import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { DockerEngineClient } from "../../../utils/gateway/provisioning/docker-engine-client";
import { listManagedContainers } from "../../../utils/gateway/provisioning/container-inventory";

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const rows = await listManagedContainers();
  const docker = new DockerEngineClient();
  const failures: Array<{ userId: number; error: string }> = [];
  let restarted = 0;
  for (const row of rows) {
    if (row.state !== "running" && row.state !== "exited") continue;
    try {
      if (row.state === "running") await docker.stopContainer(row.containerName, 10);
      await docker.startContainer(row.containerName);
      restarted += 1;
    } catch (error) {
      failures.push({
        userId: row.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  auditLog.record(
    admin,
    "container.restart-all",
    { type: "system", id: null, label: "all user containers" },
    { restarted, failures: failures.length },
  );
  return { restarted, failures };
});
