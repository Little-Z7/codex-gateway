import { trimmedOrNull } from "~~/shared/utils/strings";

export interface ProvisioningConfig {
  enabled: boolean;
  userImage: string;
  dockerNetwork: string | null;
  sharedAuthDir: string | null;
  sharedAuthMount: string;
  sharedDataDir: string | null;
  containerPrefix: string;
  memory: string | null;
  cpus: string | null;
  sandboxMode: string;
}

export function provisioningConfig(): ProvisioningConfig {
  return {
    enabled: (process.env.CODEX_GATEWAY_PROVISIONING ?? "off") === "docker",
    userImage: trimmedOrNull(process.env.CODEX_GATEWAY_USER_IMAGE) ?? "codex-gateway-user:latest",
    dockerNetwork: trimmedOrNull(process.env.CODEX_GATEWAY_DOCKER_NETWORK),
    // Host-side path; mounted into user containers at sharedAuthMount.
    sharedAuthDir: trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_AUTH_DIR),
    // Where the shared auth dir is visible inside the Gateway container; diagnostics only.
    sharedAuthMount:
      trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_AUTH_MOUNT) ?? "/srv/codex-auth",
    sharedDataDir: trimmedOrNull(process.env.CODEX_GATEWAY_SHARED_DATA_DIR),
    containerPrefix:
      trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_PREFIX) ?? "codex-user-",
    memory: trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_MEMORY),
    cpus: trimmedOrNull(process.env.CODEX_GATEWAY_USER_CONTAINER_CPUS),
    sandboxMode: trimmedOrNull(process.env.CODEX_GATEWAY_SANDBOX_MODE) ?? "danger-full-access",
  };
}
