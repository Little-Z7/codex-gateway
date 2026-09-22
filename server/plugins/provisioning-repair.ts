import { userContainerProvisioner } from "../utils/gateway/provisioning/user-container-provisioner";

export default defineNitroPlugin(() => {
  // Best-effort: finish or fail interrupted provisioning rows after a gateway restart.
  void userContainerProvisioner.repairProvisioningRows().catch((error: unknown) =>
    console.warn("[gateway] provisioning repair failed", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  // Best-effort: a Gateway container that got recreated (not just the Node process restarted)
  // loses its previous per-user network memberships; reconnect them so SSH keeps working under
  // CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user. No-op in "shared" mode.
  void userContainerProvisioner.reconnectUserNetworks().catch((error: unknown) =>
    console.warn("[gateway] user network reconnect failed", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});
