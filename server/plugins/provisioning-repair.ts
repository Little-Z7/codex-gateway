import { userContainerProvisioner } from "../utils/gateway/provisioning/user-container-provisioner";

export default defineNitroPlugin(() => {
  // Best-effort: finish or fail interrupted provisioning rows after a gateway restart.
  void userContainerProvisioner.repairProvisioningRows().catch((error: unknown) =>
    console.warn("[gateway] provisioning repair failed", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});
