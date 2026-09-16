import { defineStore } from "pinia";
import { gatewayApi } from "@/utils/gateway-api";

export interface AdminManagedHostSummary {
  hostId: number;
  hostName: string | null;
  status: "ready" | "provisioning" | "error" | "removed";
  lastError: string | null;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  managedHost: AdminManagedHostSummary | null;
}

export const useGatewayAdminStore = defineStore("gateway-admin", () => {
  const users = ref<AdminUserSummary[]>([]);
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

  async function createUser(input: { username: string; password: string; role: string }) {
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

  async function deleteUser(userId: number) {
    await gatewayApi(`/api/admin/users/${userId}`, { method: "DELETE" });
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
    loading,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    putManagedHost,
    deleteManagedHost,
  };
});
