import { userContainerProvisioner } from "../../utils/gateway/provisioning/user-container-provisioner";

export default defineTask({
  meta: {
    name: "gateway:reconcile-containers",
    description: "Flag managed user containers that disappeared and restore rows that came back.",
  },
  async run() {
    await userContainerProvisioner.reconcileContainers();
    return { result: "ok" };
  },
});
