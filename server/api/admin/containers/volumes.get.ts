import { requireAdmin } from "../../../utils/gateway/auth/context";
import { userStore } from "../../../utils/gateway/auth/users";
import { DockerEngineClient } from "../../../utils/gateway/provisioning/docker-engine-client";
import { volumeWarnBytes } from "../../../utils/gateway/provisioning/container-inventory";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const docker = new DockerEngineClient();
  const df = await docker.systemDf();
  const sizes = new Map<string, number>();
  for (const volume of df?.Volumes ?? []) {
    if (typeof volume.Name === "string" && typeof volume.UsageData?.Size === "number") {
      sizes.set(volume.Name, volume.UsageData.Size);
    }
  }
  const volumes = [...userStore.listManagedHosts().values()]
    .filter((managed) => managed.volumeName !== null)
    .map((managed) => ({
      userId: managed.userId,
      volumeName: managed.volumeName,
      sizeBytes: managed.volumeName === null ? null : (sizes.get(managed.volumeName) ?? null),
    }));
  const warnBytes = volumeWarnBytes();
  return {
    volumes,
    warnBytes,
    overThreshold: volumes.filter(
      (volume) => volume.sizeBytes !== null && volume.sizeBytes > warnBytes,
    ).length,
  };
});
