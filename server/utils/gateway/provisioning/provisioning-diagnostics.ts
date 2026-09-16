import { accessSync } from "node:fs";
import { join } from "node:path";
import { DockerEngineClient, isDockerNotFound } from "./docker-engine-client";
import { provisioningConfig } from "./provisioning-config";

export interface ProvisioningDiagnostics {
  enabled: boolean;
  image: string;
  network: string | null;
  sharedAuthDir: string | null;
  sharedDataDir: string | null;
  imagePresent: boolean;
  networkPresent: boolean;
  authFilePresent: boolean;
  dockerReachable: boolean;
  error: string | null;
}

export async function provisioningDiagnostics(): Promise<ProvisioningDiagnostics> {
  const config = provisioningConfig();
  const diagnostics: ProvisioningDiagnostics = {
    enabled: config.enabled,
    image: config.userImage,
    network: config.dockerNetwork,
    sharedAuthDir: config.sharedAuthDir,
    sharedDataDir: config.sharedDataDir,
    imagePresent: false,
    networkPresent: false,
    authFilePresent: false,
    dockerReachable: false,
    error: null,
  };
  if (!config.enabled) return diagnostics;

  const docker = new DockerEngineClient();
  try {
    await docker.ping();
    diagnostics.dockerReachable = true;
    try {
      await docker.inspectImage(config.userImage);
      diagnostics.imagePresent = true;
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
    if (config.dockerNetwork !== null) {
      try {
        await docker.inspectNetwork(config.dockerNetwork);
        diagnostics.networkPresent = true;
      } catch (error) {
        if (!isDockerNotFound(error)) throw error;
      }
    }
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
  }

  try {
    accessSync(join(config.sharedAuthMount, "auth.json"));
    diagnostics.authFilePresent = true;
  } catch {
    diagnostics.authFilePresent = false;
  }
  return diagnostics;
}
