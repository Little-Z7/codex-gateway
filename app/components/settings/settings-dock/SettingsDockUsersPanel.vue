<script setup lang="ts">
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@codex-gateway/ui/alert-dialog";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { Input } from "@codex-gateway/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { toast } from "@codex-gateway/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@codex-gateway/ui/table";
import type { HostRecord } from "~~/shared/types";
import HostConnectionFields from "../host-connection/HostConnectionFields.vue";
import {
  emptyHostConnectionForm,
  hostConnectionFormFromRecord,
  hostConnectionPayload,
} from "../host-connection/form";
import { useGatewayAdminStore, type AdminUserSummary } from "@/stores/gateway-admin";
import { gatewayApi } from "@/utils/gateway-api";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t } = useI18n();
const admin = useGatewayAdminStore();
const { users } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t));

const createOpen = ref(false);
const createForm = ref({ username: "", password: "", role: "user" });
const createSaving = ref(false);

const passwordTarget = ref<AdminUserSummary | null>(null);
const passwordValue = ref("");
const passwordSaving = ref(false);

const deleteTarget = ref<AdminUserSummary | null>(null);
const deleting = ref(false);

const managedTarget = ref<AdminUserSummary | null>(null);
const managedForm = ref(emptyHostConnectionForm());
const managedSaving = ref(false);

const removeManagedTarget = ref<AdminUserSummary | null>(null);
const removeManagedSaving = ref(false);

const busy = ref<number | null>(null);

onMounted(() => {
  void admin.listUsers().catch(showError);
});

function showError(error: unknown, fallback = t("app.adminUsersLoadFailed")) {
  toast.error(messageFromError(error, fallback, errorLabels.value));
}

function roleLabel(role: string) {
  return role === "admin" ? t("app.roleAdmin") : t("app.roleUser");
}

function managedStatusLabel(status: string) {
  const keys: Record<string, string> = {
    ready: "app.managedHostReady",
    provisioning: "app.managedHostProvisioning",
    error: "app.managedHostError",
    removed: "app.managedHostRemoved",
  };
  return t(keys[status] ?? "app.managedHostError");
}

async function createUser() {
  if (createSaving.value) return;
  createSaving.value = true;
  try {
    await admin.createUser(createForm.value);
    toast.success(t("app.adminUserCreated"));
    createOpen.value = false;
    createForm.value = { username: "", password: "", role: "user" };
  } catch (error) {
    showError(error, t("app.adminUserCreateFailed"));
  } finally {
    createSaving.value = false;
  }
}

async function toggleActive(user: AdminUserSummary) {
  if (busy.value !== null) return;
  busy.value = user.id;
  try {
    await admin.updateUser(user.id, { isActive: !user.isActive });
  } catch (error) {
    showError(error, t("app.adminUserUpdateFailed"));
  } finally {
    busy.value = null;
  }
}

async function resetPassword() {
  const user = passwordTarget.value;
  if (!user || passwordSaving.value) return;
  passwordSaving.value = true;
  try {
    await admin.updateUser(user.id, { password: passwordValue.value });
    toast.success(t("app.adminUserPasswordReset"));
    passwordTarget.value = null;
    passwordValue.value = "";
  } catch (error) {
    showError(error, t("app.adminUserUpdateFailed"));
  } finally {
    passwordSaving.value = false;
  }
}

async function deleteUser() {
  const user = deleteTarget.value;
  if (!user || deleting.value) return;
  deleting.value = true;
  try {
    await admin.deleteUser(user.id);
    toast.success(t("app.adminUserDeleted"));
    deleteTarget.value = null;
  } catch (error) {
    showError(error, t("app.adminUserDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

async function openManagedHost(user: AdminUserSummary) {
  managedTarget.value = user;
  managedForm.value = emptyManagedHostForm();
  if (user.managedHost === null) return;
  try {
    const host = await gatewayApi<HostRecord>(`/api/admin/users/${user.id}/managed-host`);
    managedForm.value = hostConnectionFormFromRecord(host);
  } catch (error) {
    showError(error, t("app.managedHostSaveFailed"));
  }
}

function emptyManagedHostForm() {
  const form = emptyHostConnectionForm();
  form.proxyUrl = "";
  return form;
}

async function saveManagedHost() {
  const user = managedTarget.value;
  if (!user || managedSaving.value) return;
  managedSaving.value = true;
  try {
    await admin.putManagedHost(user.id, hostConnectionPayload(managedForm.value));
    toast.success(t("app.managedHostSaved"));
    managedTarget.value = null;
  } catch (error) {
    showError(error, t("app.managedHostSaveFailed"));
  } finally {
    managedSaving.value = false;
  }
}

async function removeManagedHost() {
  const user = removeManagedTarget.value;
  if (!user || removeManagedSaving.value) return;
  removeManagedSaving.value = true;
  try {
    await admin.deleteManagedHost(user.id);
    toast.success(t("app.managedHostRemovedToast"));
    removeManagedTarget.value = null;
  } catch (error) {
    showError(error, t("app.managedHostRemoveFailed"));
  } finally {
    removeManagedSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="font-medium">{{ t("app.adminUsersTitle") }}</div>
        <p class="text-sm text-ink-secondary">{{ t("app.adminUsersDescription") }}</p>
      </div>
      <Button data-testid="admin-create-user" @click="createOpen = true">
        <PlusIcon class="size-4" />
        {{ t("app.adminCreateUser") }}
      </Button>
    </div>

    <div class="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t("app.username") }}</TableHead>
            <TableHead>{{ t("app.adminUserRole") }}</TableHead>
            <TableHead>{{ t("app.adminUserStatus") }}</TableHead>
            <TableHead>{{ t("app.managedHost") }}</TableHead>
            <TableHead>{{ t("app.adminUserCreatedAt") }}</TableHead>
            <TableHead class="text-right">{{ t("app.adminUserActions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="user in users"
            :key="user.id"
            :data-testid="`admin-user-row-${user.username}`"
          >
            <TableCell class="font-medium">{{ user.username }}</TableCell>
            <TableCell>
              <Badge :variant="user.role === 'admin' ? 'default' : 'secondary'">
                {{ roleLabel(user.role) }}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge :variant="user.isActive ? 'secondary' : 'destructive'">
                {{ user.isActive ? t("app.adminUserActive") : t("app.adminUserDisabled") }}
              </Badge>
            </TableCell>
            <TableCell>
              <template v-if="user.managedHost">
                <span class="mr-1">{{
                  user.managedHost.hostName ?? `#${user.managedHost.hostId}`
                }}</span>
                <Badge
                  :variant="user.managedHost.status === 'ready' ? 'secondary' : 'destructive'"
                  :title="user.managedHost.lastError ?? undefined"
                >
                  {{ managedStatusLabel(user.managedHost.status) }}
                </Badge>
              </template>
              <span v-else class="text-ink-muted">—</span>
            </TableCell>
            <TableCell class="text-ink-secondary">{{ user.createdAt.slice(0, 10) }}</TableCell>
            <TableCell class="text-right">
              <div class="flex flex-wrap justify-end gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  :data-testid="`admin-managed-host-${user.username}`"
                  @click="openManagedHost(user)"
                >
                  {{ t("app.configureManagedHost") }}
                </Button>
                <Button
                  v-if="user.managedHost"
                  variant="ghost"
                  size="sm"
                  @click="removeManagedTarget = user"
                >
                  {{ t("app.removeManagedHost") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="busy === user.id"
                  @click="passwordTarget = user"
                >
                  <KeyRoundIcon class="size-4" />
                  {{ t("app.adminResetPassword") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="busy === user.id"
                  @click="toggleActive(user)"
                >
                  {{ user.isActive ? t("app.adminDisableUser") : t("app.adminEnableUser") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive hover:text-destructive/80"
                  :disabled="busy === user.id"
                  :data-testid="`admin-delete-user-${user.username}`"
                  @click="deleteTarget = user"
                >
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="space-y-2 md:hidden">
      <div
        v-for="user in users"
        :key="user.id"
        class="space-y-2 rounded-lg border border-hairline bg-surface p-3"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate font-medium">{{ user.username }}</span>
          <Badge :variant="user.role === 'admin' ? 'default' : 'secondary'">
            {{ roleLabel(user.role) }}
          </Badge>
          <Badge :variant="user.isActive ? 'secondary' : 'destructive'">
            {{ user.isActive ? t("app.adminUserActive") : t("app.adminUserDisabled") }}
          </Badge>
        </div>
        <div v-if="user.managedHost" class="text-sm text-ink-secondary">
          {{ user.managedHost.hostName ?? `#${user.managedHost.hostId}` }}
          <Badge
            :variant="user.managedHost.status === 'ready' ? 'secondary' : 'destructive'"
            class="ml-1"
          >
            {{ managedStatusLabel(user.managedHost.status) }}
          </Badge>
        </div>
        <div class="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" @click="openManagedHost(user)">
            {{ t("app.configureManagedHost") }}
          </Button>
          <Button
            v-if="user.managedHost"
            variant="ghost"
            size="sm"
            @click="removeManagedTarget = user"
          >
            {{ t("app.removeManagedHost") }}
          </Button>
          <Button variant="ghost" size="sm" @click="passwordTarget = user">
            {{ t("app.adminResetPassword") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="busy === user.id"
            @click="toggleActive(user)"
          >
            {{ user.isActive ? t("app.adminDisableUser") : t("app.adminEnableUser") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive"
            :disabled="busy === user.id"
            @click="deleteTarget = user"
          >
            <Trash2Icon class="size-4" />
          </Button>
        </div>
      </div>
    </div>

    <Dialog v-model:open="createOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("app.adminCreateUser") }}</DialogTitle>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="createUser">
          <Input
            v-model="createForm.username"
            data-testid="admin-user-username-input"
            :placeholder="t('app.username')"
            autocomplete="off"
          />
          <Input
            v-model="createForm.password"
            data-testid="admin-user-password-input"
            type="password"
            :placeholder="t('app.password')"
            autocomplete="new-password"
          />
          <Select v-model="createForm.role">
            <SelectTrigger class="w-full bg-surface" :aria-label="t('app.adminUserRole')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{{ t("app.roleUser") }}</SelectItem>
              <SelectItem value="admin">{{ t("app.roleAdmin") }}</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              data-testid="admin-user-create-submit"
              :disabled="createSaving || !createForm.username || createForm.password.length < 8"
            >
              {{ t("app.adminCreateUser") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog :open="passwordTarget !== null" @update:open="(v) => !v && (passwordTarget = null)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle
            >{{ t("app.adminResetPassword") }} — {{ passwordTarget?.username }}</DialogTitle
          >
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="resetPassword">
          <Input
            v-model="passwordValue"
            data-testid="admin-reset-password-input"
            type="password"
            :placeholder="t('app.adminNewPassword')"
            autocomplete="new-password"
          />
          <DialogFooter>
            <Button :disabled="passwordSaving || passwordValue.length < 8">
              {{ t("app.adminResetPassword") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog :open="managedTarget !== null" @update:open="(v) => !v && (managedTarget = null)">
      <DialogContent class="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {{ t("app.configureManagedHost") }} — {{ managedTarget?.username }}
          </DialogTitle>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="saveManagedHost">
          <HostConnectionFields v-model="managedForm" />
          <DialogFooter>
            <Button
              data-testid="admin-managed-host-submit"
              :disabled="managedSaving || !managedForm.name || !managedForm.sshHost"
            >
              {{ t("app.saveHost") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="deleteTarget !== null" @update:open="(v) => !v && (deleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("app.adminDeleteUserTitle") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("app.adminDeleteUserDescription", { username: deleteTarget?.username ?? "" }) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">{{
            t("app.cancelFileDelete")
          }}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            :disabled="deleting"
            :data-testid="`admin-delete-confirm`"
            @click.capture="deleteUser"
          >
            {{ t("app.adminDeleteUser") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog
      :open="removeManagedTarget !== null"
      @update:open="(v) => !v && (removeManagedTarget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("app.removeManagedHost") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("app.removeManagedHostDescription", {
                username: removeManagedTarget?.username ?? "",
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="removeManagedSaving">
            {{ t("app.cancelFileDelete") }}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            :disabled="removeManagedSaving"
            @click.capture="removeManagedHost"
          >
            {{ t("app.removeManagedHost") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
