import { createError, getQuery, getRouterParam } from "h3";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { DockerEngineClient } from "../../../../utils/gateway/provisioning/docker-engine-client";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const userId = Number(getRouterParam(event, "userId"));
  requireRecord(userStore.findById(userId), "User not found");
  const managed = userStore.getManagedHost(userId);
  if (managed === null || managed.containerName === null) {
    throw createError({ statusCode: 404, statusMessage: "Container not found" });
  }
  const tail = Math.min(Math.max(Number(getQuery(event).tail ?? 200) || 200, 10), 1000);
  const docker = new DockerEngineClient();
  const logs = await docker.containerLogs(managed.containerName, tail);
  return { logs, tail };
});
