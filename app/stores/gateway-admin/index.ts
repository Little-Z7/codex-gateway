import { defineStore } from "pinia";
import { gatewayApi } from "@/utils/gateway-api";

export interface AdminManagedHostSummary {
  hostId: number;
  hostName: string | null;
  status: "ready" | "provisioning" | "error" | "removed";
  lastError: string | null;
}

export interface AdminContainerSummary {
  state: "running" | "exited" | "missing" | "unknown";
  name: string | null;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  managedHost: AdminManagedHostSummary | null;
  container: AdminContainerSummary | null;
}

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

export const useGatewayAdminStore = defineStore("gateway-admin", () => {
  const users = ref<AdminUserSummary[]>([]);
  const provisioning = ref<ProvisioningDiagnostics | null>(null);
  const loading = ref(false);

  async function listUsers() {
    loading.value = true;
    try {
      const response = await gatewayApi<{ users: AdminUserSummary[] }>("/api/admin/users");
      users.value = response.users;
      return response.users;
    } finally {
      loading.value = false;
    }
  }

  async function loadProvisioning() {
    provisioning.value = await gatewayApi<ProvisioningDiagnostics>("/api/admin/provisioning");
    return provisioning.value;
  }

  async function createUser(input: {
    username: string;
    password: string;
    role: string;
    provision?: boolean;
  }) {
    await gatewayApi("/api/admin/users", { method: "POST", body: input });
    await listUsers();
  }

  async function updateUser(
    userId: number,
    changes: { isActive?: boolean; role?: string; password?: string },
  ) {
    await gatewayApi(`/api/admin/users/${userId}`, { method: "PATCH", body: changes });
    await listUsers();
  }

  async function deleteUser(userId: number, options: { keepVolume?: boolean } = {}) {
    await gatewayApi(`/api/admin/users/${userId}?keepVolume=${options.keepVolume === true}`, {
      method: "DELETE",
    });
    await listUsers();
  }

  async function provisionUser(userId: number, options: { recreate?: boolean } = {}) {
    await gatewayApi(
      `/api/admin/users/${userId}/provision?recreate=${options.recreate === true ? 1 : 0}`,
      {
        method: "POST",
      },
    );
    await listUsers();
  }

  async function deprovisionUser(userId: number, options: { keepVolume?: boolean } = {}) {
    await gatewayApi(
      `/api/admin/users/${userId}/provision?keepVolume=${options.keepVolume === true}`,
      { method: "DELETE" },
    );
    await listUsers();
  }

  async function startContainer(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/container/start`, { method: "POST" });
    await listUsers();
  }

  async function stopContainer(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/container/stop`, { method: "POST" });
    await listUsers();
  }

  async function putManagedHost(userId: number, input: Record<string, unknown>) {
    await gatewayApi(`/api/admin/users/${userId}/managed-host`, { method: "PUT", body: input });
    await listUsers();
  }

  async function deleteManagedHost(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}/managed-host`, { method: "DELETE" });
    await listUsers();
  }

  return {
    users,
    provisioning,
    loading,
    listUsers,
    loadProvisioning,
    createUser,
    updateUser,
    deleteUser,
    provisionUser,
    deprovisionUser,
    startContainer,
    stopContainer,
    putManagedHost,
    deleteManagedHost,
  };
});
