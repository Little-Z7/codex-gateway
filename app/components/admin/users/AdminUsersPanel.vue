<script setup lang="ts">
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, Trash2Icon } from "@lucide/vue";
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
import { Checkbox } from "@codex-gateway/ui/checkbox";
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
import { Switch } from "@codex-gateway/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@codex-gateway/ui/table";
import type { HostRecord } from "~~/shared/types";
import HostConnectionFields from "@/components/settings/host-connection/HostConnectionFields.vue";
import {
  emptyHostConnectionForm,
  hostConnectionFormFromRecord,
  hostConnectionPayload,
} from "@/components/settings/host-connection/form";
import { formatBudgetNumber } from "@/stores/gateway-budget";
import { useGatewayAdminStore, type AdminUserSummary } from "@/stores/gateway-admin";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

import ProvisioningDiagnosticsCard from "../ProvisioningDiagnosticsCard.vue";
import { SearchIcon, LogOutIcon } from "@lucide/vue";

const props = withDefaults(defineProps<{ extended?: boolean }>(), { extended: false });
const emit = defineEmits<{ openUser: [userId: number] }>();
const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { users, provisioning, budgets } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const createOpen = ref(false);
const createForm = ref({
  username: "",
  password: "",
  role: "user",
  provision: true,
  mustChangePassword: false,
  displayName: "",
  note: "",
});
const generatedPassword = ref("");
const sortBy = ref<"username" | "lastLogin" | "budget">("username");
const createSaving = ref(false);

const passwordTarget = ref<AdminUserSummary | null>(null);
const passwordValue = ref("");
const passwordSaving = ref(false);

const deleteTarget = ref<AdminUserSummary | null>(null);
const deleteKeepVolume = ref(false);
const deleting = ref(false);

const containerTarget = ref<AdminUserSummary | null>(null);
const containerKeepVolume = ref(false);
const containerBusy = ref(false);

const managedTarget = ref<AdminUserSummary | null>(null);
const managedForm = ref(emptyHostConnectionForm());
const managedSaving = ref(false);

const removeManagedTarget = ref<AdminUserSummary | null>(null);
const removeManagedSaving = ref(false);

const busy = ref<number | null>(null);
const search = ref("");
const roleFilter = ref("all");
const statusFilter = ref("all");
const containerFilter = ref("all");
const budgetByUser = computed(() => new Map(budgets.value.map((row) => [row.userId, row])));

function budgetUsageScore(userId: number) {
  const row = budgetByUser.value.get(userId);
  if (row === undefined) return 0;
  return row.usage.dailyTokens + row.usage.monthlyTokens + row.usage.dailyTurns * 1000;
}

function budgetExceeded(userId: number) {
  const row = budgetByUser.value.get(userId);
  if (row === undefined) return false;
  const limits = row.effective;
  return (
    (limits.dailyTokens !== null && row.usage.dailyTokens >= limits.dailyTokens) ||
    (limits.monthlyTokens !== null && row.usage.monthlyTokens >= limits.monthlyTokens) ||
    (limits.dailyTurns !== null && row.usage.dailyTurns >= limits.dailyTurns) ||
    (limits.monthlyTurns !== null && row.usage.monthlyTurns >= limits.monthlyTurns)
  );
}

function budgetBarPercent(userId: number) {
  const row = budgetByUser.value.get(userId);
  const limit = row?.effective.dailyTokens ?? row?.effective.dailyTurns ?? null;
  if (row === undefined || limit === null || limit <= 0) return 0;
  const used = row.effective.dailyTokens !== null ? row.usage.dailyTokens : row.usage.dailyTurns;
  return Math.min(100, Math.round((used / limit) * 100));
}

function budgetNear(userId: number) {
  const row = budgetByUser.value.get(userId);
  if (row === undefined || budgetExceeded(userId)) return false;
  const warn = admin.budgetDefaults?.warnPercent ?? 80;
  const check = (used: number, limit: number | null) =>
    limit !== null && limit > 0 && (used / limit) * 100 >= warn;
  return (
    check(row.usage.dailyTokens, row.effective.dailyTokens) ||
    check(row.usage.monthlyTokens, row.effective.monthlyTokens) ||
    check(row.usage.dailyTurns, row.effective.dailyTurns) ||
    check(row.usage.monthlyTurns, row.effective.monthlyTurns)
  );
}

const filteredUsers = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = users.value.filter((user) => {
    if (term !== "") {
      const haystack = [user.username, user.displayName ?? "", user.note ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (roleFilter.value !== "all" && user.role !== roleFilter.value) return false;
    if (statusFilter.value === "active" && !user.isActive) return false;
    if (statusFilter.value === "disabled" && user.isActive) return false;
    const state = user.container?.state ?? "none";
    if (containerFilter.value === "none" && state !== "none") return false;
    if (
      (containerFilter.value === "running" ||
        containerFilter.value === "exited" ||
        containerFilter.value === "missing") &&
      state !== containerFilter.value
    ) {
      return false;
    }
    return true;
  });
  return list.toSorted((left, right) => {
    if (sortBy.value === "lastLogin") {
      return (right.lastLoginAt ?? "").localeCompare(left.lastLoginAt ?? "");
    }
    if (sortBy.value === "budget") {
      return budgetUsageScore(right.id) - budgetUsageScore(left.id);
    }
    return left.username.localeCompare(right.username);
  });
});

// --- selection + bulk actions (extended/admin-console only) ---
const selected = ref<Set<number>>(new Set());
const bulkBusy = ref(false);
const bulkDeleteOpen = ref(false);
const bulkKeepVolume = ref(false);

function isSelected(id: number) {
  return selected.value.has(id);
}
function toggleSelected(id: number, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}
const allFilteredSelected = computed(
  () =>
    filteredUsers.value.length > 0 && filteredUsers.value.every((u) => selected.value.has(u.id)),
);
function toggleAllFiltered(checked: boolean) {
  const next = new Set(selected.value);
  for (const user of filteredUsers.value) {
    if (checked) next.add(user.id);
    else next.delete(user.id);
  }
  selected.value = next;
}

const auth = useAuthStore();
const currentUsername = computed(() => auth.username);
const activeAdminCount = computed(
  () => users.value.filter((u) => u.role === "admin" && u.isActive).length,
);
// A user is a safe bulk target: never self, and never the last active admin.
function bulkEligible(user: AdminUserSummary) {
  if (user.username === currentUsername.value) return false;
  if (user.role === "admin" && user.isActive && activeAdminCount.value <= 1) return false;
  return true;
}
const selectedUsers = computed(() => users.value.filter((u) => selected.value.has(u.id)));
const bulkTargets = computed(() => selectedUsers.value.filter(bulkEligible));
const bulkSkipped = computed(() => selectedUsers.value.length - bulkTargets.value.length);

async function bulkSetActive(isActive: boolean) {
  if (bulkBusy.value) return;
  bulkBusy.value = true;
  let ok = 0;
  let failed = 0;
  for (const user of bulkTargets.value) {
    try {
      await admin.updateUser(user.id, { isActive });
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  bulkBusy.value = false;
  selected.value = new Set();
  toast.success(t("app.adminBulkResult", { ok, failed, skipped: bulkSkipped.value }));
  if (failed > 0) toast.error(t("app.adminBulkPartial", { count: failed }));
}

async function bulkDelete() {
  if (bulkBusy.value) return;
  bulkBusy.value = true;
  let ok = 0;
  let failed = 0;
  for (const user of bulkTargets.value) {
    try {
      await admin.deleteUser(user.id, { keepVolume: bulkKeepVolume.value });
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  bulkBusy.value = false;
  bulkDeleteOpen.value = false;
  selected.value = new Set();
  toast.success(t("app.adminBulkResult", { ok, failed, skipped: bulkSkipped.value }));
  if (failed > 0) toast.error(t("app.adminBulkPartial", { count: failed }));
}

function exportCsv() {
  const header = [
    t("app.username"),
    t("app.adminUserRole"),
    t("app.adminUserStatus"),
    t("app.adminUserLastLogin"),
    t("app.adminUserOnlineSessions"),
    t("app.adminContainerState"),
    t("app.adminUserCreatedAt"),
  ];
  const rows = filteredUsers.value.map((user) => [
    user.username,
    user.role,
    user.isActive ? "active" : "disabled",
    user.lastLoginAt ?? "",
    String(user.onlineSessions),
    user.container?.state ?? "",
    user.createdAt,
  ]);
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `codex-gateway-users-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function forceOffline(user: AdminUserSummary) {
  busy.value = user.id;
  try {
    await admin.revokeUserSessions(user.id);
    toast.success(t("app.adminSessionsRevoked"));
  } catch (error) {
    showError(error, t("app.adminSessionsRevokeFailed"));
  } finally {
    busy.value = null;
  }
}

// While any user's container is provisioning or transitioning, refresh the list on a short
// interval so the status badge converges without a manual reload.
let pollTimer: ReturnType<typeof setTimeout> | null = null;
watch(users, () => {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (users.value.some((user) => user.managedHost?.status === "provisioning")) {
    pollTimer = setTimeout(() => void admin.listUsers().catch(() => {}), 2_000);
  }
});

onMounted(() => {
  void admin.listUsers().catch(showError);
  void admin.loadProvisioning().catch(() => {});
  void admin.loadBudgets().catch(() => {});
});

onUnmounted(() => {
  if (pollTimer !== null) clearTimeout(pollTimer);
});

function showError(error: unknown, fallback = t("app.adminUsersLoadFailed")) {
  toast.error(messageFromError(error, fallback, errorLabels.value));
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  generatedPassword.value = `${value}Aa1`;
  createForm.value.password = generatedPassword.value;
}

async function copyGeneratedPassword() {
  if (createForm.value.password === "") return;
  await navigator.clipboard.writeText(createForm.value.password);
  toast.success(t("app.adminPasswordCopied"));
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

function containerStateLabel(state: string) {
  const keys: Record<string, string> = {
    running: "app.containerRunning",
    exited: "app.containerExited",
    missing: "app.containerMissing",
    unknown: "app.containerUnknown",
  };
  return t(keys[state] ?? "app.containerUnknown");
}

function containerBadgeVariant(state: string) {
  return state === "running" ? "secondary" : state === "exited" ? "outline" : "destructive";
}

async function createUser() {
  if (createSaving.value) return;
  createSaving.value = true;
  try {
    await admin.createUser({
      username: createForm.value.username,
      password: createForm.value.password,
      role: createForm.value.role,
      provision: provisioning.value?.enabled === true && createForm.value.provision,
      mustChangePassword: createForm.value.mustChangePassword,
      displayName: createForm.value.displayName,
      note: createForm.value.note,
    });
    toast.success(t("app.adminUserCreated"));
    createOpen.value = false;
    generatedPassword.value = "";
    createForm.value = {
      username: "",
      password: "",
      role: "user",
      provision: true,
      mustChangePassword: false,
      displayName: "",
      note: "",
    };
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
    await admin.deleteUser(user.id, { keepVolume: deleteKeepVolume.value });
    toast.success(t("app.adminUserDeleted"));
    deleteTarget.value = null;
  } catch (error) {
    showError(error, t("app.adminUserDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

async function containerAction(
  user: AdminUserSummary,
  action: () => Promise<void>,
  failedKey: string,
) {
  if (busy.value !== null) return;
  busy.value = user.id;
  try {
    await action();
  } catch (error) {
    showError(error, t(failedKey));
  } finally {
    busy.value = null;
  }
}

async function removeContainer() {
  const user = containerTarget.value;
  if (!user || containerBusy.value) return;
  containerBusy.value = true;
  try {
    await admin.deprovisionUser(user.id, { keepVolume: containerKeepVolume.value });
    toast.success(t("app.containerRemovedToast"));
    containerTarget.value = null;
  } catch (error) {
    showError(error, t("app.containerRemoveFailed"));
  } finally {
    containerBusy.value = false;
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
      <div v-if="props.extended" class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div class="relative min-w-0 md:max-w-xs md:flex-1">
          <SearchIcon
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
          />
          <Input
            v-model="search"
            class="pl-9"
            :placeholder="t('app.adminUsersSearch')"
            data-testid="admin-users-search"
          />
        </div>
        <Select v-model="roleFilter" data-testid="admin-users-filter-role">
          <SelectTrigger class="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t("app.adminFilterAllRoles") }}</SelectItem>
            <SelectItem value="admin">{{ t("app.roleAdmin") }}</SelectItem>
            <SelectItem value="user">{{ t("app.roleUser") }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="statusFilter">
          <SelectTrigger class="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t("app.adminFilterAllStatus") }}</SelectItem>
            <SelectItem value="active">{{ t("app.adminUserActive") }}</SelectItem>
            <SelectItem value="disabled">{{ t("app.adminUserDisabled") }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="containerFilter" data-testid="admin-users-filter-container">
          <SelectTrigger class="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t("app.adminFilterAllContainers") }}</SelectItem>
            <SelectItem value="running">{{ t("app.containerRunning") }}</SelectItem>
            <SelectItem value="exited">{{ t("app.containerExited") }}</SelectItem>
            <SelectItem value="missing">{{ t("app.containerMissing") }}</SelectItem>
            <SelectItem value="none">{{ t("app.adminFilterNoContainer") }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="sortBy" data-testid="admin-users-sort">
          <SelectTrigger class="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="username">{{ t("app.adminSortUsername") }}</SelectItem>
            <SelectItem value="lastLogin">{{ t("app.adminSortLastLogin") }}</SelectItem>
            <SelectItem value="budget">{{ t("app.adminSortBudget") }}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" data-testid="admin-users-export-csv" @click="exportCsv">
          {{ t("app.adminExportCsv") }}
        </Button>
      </div>
      <Button data-testid="admin-create-user" @click="createOpen = true">
        <PlusIcon class="size-4" />
        {{ t("app.adminCreateUser") }}
      </Button>
    </div>

    <ProvisioningDiagnosticsCard :provisioning="provisioning" />

    <div
      v-if="props.extended && selected.size > 0"
      class="flex items-center gap-2 rounded-lg border border-hairline bg-surface p-2 text-sm"
      data-testid="admin-users-bulk-bar"
    >
      <span class="text-ink-secondary">
        {{ t("app.adminBulkSelected", { count: selected.size, skipped: bulkSkipped }) }}
      </span>
      <Button
        variant="outline"
        size="sm"
        :disabled="bulkBusy || bulkTargets.length === 0"
        data-testid="admin-bulk-enable"
        @click="bulkSetActive(true)"
      >
        {{ t("app.adminBulkEnable") }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="bulkBusy || bulkTargets.length === 0"
        data-testid="admin-bulk-disable"
        @click="bulkSetActive(false)"
      >
        {{ t("app.adminBulkDisable") }}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        :disabled="bulkBusy || bulkTargets.length === 0"
        data-testid="admin-bulk-delete"
        @click="bulkDeleteOpen = true"
      >
        {{ t("app.adminBulkDelete") }}
      </Button>
    </div>

    <div class="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead v-if="props.extended" class="w-8">
              <Checkbox
                :model-value="allFilteredSelected"
                data-testid="admin-users-select-all"
                @update:model-value="
                  (v: boolean | 'indeterminate') => toggleAllFiltered(v === true)
                "
              />
            </TableHead>
            <TableHead>{{ t("app.username") }}</TableHead>
            <TableHead>{{ t("app.adminUserRole") }}</TableHead>
            <TableHead>{{ t("app.adminUserStatus") }}</TableHead>
            <TableHead>{{ t("app.managedHost") }}</TableHead>
            <TableHead v-if="provisioning?.enabled">{{ t("app.container") }}</TableHead>
            <TableHead v-if="props.extended">{{ t("app.adminUserLastLogin") }}</TableHead>
            <TableHead v-if="props.extended">{{ t("app.adminUserOnlineSessions") }}</TableHead>
            <TableHead>{{ t("app.adminBudgetColumn") }}</TableHead>
            <TableHead>{{ t("app.adminUserCreatedAt") }}</TableHead>
            <TableHead class="text-right">{{ t("app.adminUserActions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="user in filteredUsers"
            :key="user.id"
            :data-testid="`admin-user-row-${user.username}`"
          >
            <TableCell v-if="props.extended">
              <Checkbox
                :model-value="isSelected(user.id)"
                :data-testid="`admin-user-select-${user.username}`"
                @update:model-value="
                  (v: boolean | 'indeterminate') => toggleSelected(user.id, v === true)
                "
              />
            </TableCell>
            <TableCell class="font-medium">
              <button
                v-if="props.extended"
                type="button"
                class="underline-offset-4 hover:underline"
                :data-testid="`admin-user-link-${user.username}`"
                @click="emit('openUser', user.id)"
              >
                {{ user.displayName || user.username }}
              </button>
              <template v-else>{{ user.displayName || user.username }}</template>
            </TableCell>
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
            <TableCell v-if="provisioning?.enabled">
              <Badge
                v-if="user.container"
                :variant="containerBadgeVariant(user.container.state)"
                :title="user.container.name ?? undefined"
                :data-testid="`container-state-${user.username}`"
              >
                <Loader2Icon
                  v-if="user.managedHost?.status === 'provisioning'"
                  class="size-3 animate-spin"
                />
                {{ containerStateLabel(user.container.state) }}
              </Badge>
              <span v-else class="text-ink-muted">—</span>
            </TableCell>
            <TableCell v-if="props.extended" class="text-ink-secondary">
              {{ user.lastLoginAt ? user.lastLoginAt.slice(0, 16).replace("T", " ") : "—" }}
            </TableCell>
            <TableCell v-if="props.extended" class="text-ink-secondary">
              {{ user.onlineSessions }}
            </TableCell>
            <TableCell>
              <div class="min-w-28 space-y-1" :data-testid="`admin-user-budget-${user.username}`">
                <template v-if="budgetByUser.get(user.id)?.effective.source === 'unlimited'">
                  <span class="text-xs text-ink-muted">{{ t("app.budgetUnlimited") }}</span>
                </template>
                <template v-else>
                  <div class="flex items-center justify-between gap-2 text-xs">
                    <span>{{ t("app.budgetDimension.dailyTokens") }}</span>
                    <span
                      :class="
                        budgetExceeded(user.id)
                          ? 'text-destructive'
                          : budgetNear(user.id)
                            ? 'text-accent-orange'
                            : 'text-ink-secondary'
                      "
                    >
                      {{
                        budgetByUser.get(user.id)?.effective.dailyTokens === null
                          ? t("app.budgetUnlimited")
                          : `${formatBudgetNumber(budgetByUser.get(user.id)?.usage.dailyTokens ?? 0)} / ${formatBudgetNumber(budgetByUser.get(user.id)?.effective.dailyTokens ?? 0)}`
                      }}
                    </span>
                  </div>
                  <div class="h-1 overflow-hidden rounded-full bg-canvas-soft">
                    <div
                      class="h-full rounded-full"
                      :class="
                        budgetExceeded(user.id)
                          ? 'bg-destructive'
                          : budgetNear(user.id)
                            ? 'bg-accent-orange'
                            : 'bg-primary'
                      "
                      :style="{
                        width: `${budgetBarPercent(user.id)}%`,
                      }"
                    />
                  </div>
                </template>
              </div>
            </TableCell>
            <TableCell class="text-ink-secondary">{{ user.createdAt.slice(0, 10) }}</TableCell>
            <TableCell class="text-right">
              <div class="flex flex-wrap justify-end gap-1">
                <template v-if="provisioning?.enabled">
                  <Button
                    v-if="user.container === null"
                    variant="outline"
                    size="sm"
                    :disabled="busy === user.id"
                    :data-testid="`admin-provision-${user.username}`"
                    @click="
                      containerAction(
                        user,
                        () => admin.provisionUser(user.id),
                        'app.containerProvisionFailed',
                      )
                    "
                  >
                    {{ t("app.createContainer") }}
                  </Button>
                  <template v-else>
                    <Button
                      variant="ghost"
                      size="sm"
                      :disabled="busy === user.id"
                      :data-testid="`admin-container-toggle-${user.username}`"
                      @click="
                        containerAction(
                          user,
                          () =>
                            user.container!.state === 'running'
                              ? admin.stopContainer(user.id)
                              : admin.startContainer(user.id),
                          'app.containerToggleFailed',
                        )
                      "
                    >
                      {{
                        user.container.state === "running"
                          ? t("app.stopContainer")
                          : t("app.startContainer")
                      }}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      :disabled="busy === user.id"
                      @click="
                        containerAction(
                          user,
                          () => admin.provisionUser(user.id, { recreate: true }),
                          'app.containerProvisionFailed',
                        )
                      "
                    >
                      {{ t("app.recreateContainer") }}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      :disabled="busy === user.id"
                      @click="
                        containerKeepVolume = false;
                        containerTarget = user;
                      "
                    >
                      {{ t("app.removeContainer") }}
                    </Button>
                  </template>
                </template>
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
                  v-if="props.extended"
                  variant="ghost"
                  size="sm"
                  :disabled="busy === user.id"
                  :data-testid="`admin-revoke-sessions-${user.username}`"
                  @click="forceOffline(user)"
                >
                  <LogOutIcon class="size-4" />
                  {{ t("app.adminForceOffline") }}
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
        v-for="user in filteredUsers"
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
        <div v-if="user.container" class="text-sm text-ink-secondary">
          {{ user.container.name }}
          <Badge
            :variant="containerBadgeVariant(user.container.state)"
            class="ml-1"
            :data-testid="`container-state-${user.username}`"
          >
            <Loader2Icon
              v-if="user.managedHost?.status === 'provisioning'"
              class="size-3 animate-spin"
            />
            {{ containerStateLabel(user.container.state) }}
          </Badge>
        </div>
        <div class="flex flex-wrap gap-1">
          <template v-if="provisioning?.enabled">
            <Button
              v-if="user.container === null"
              variant="outline"
              size="sm"
              :disabled="busy === user.id"
              :data-testid="`admin-provision-${user.username}`"
              @click="
                containerAction(
                  user,
                  () => admin.provisionUser(user.id),
                  'app.containerProvisionFailed',
                )
              "
            >
              {{ t("app.createContainer") }}
            </Button>
            <template v-else>
              <Button
                variant="ghost"
                size="sm"
                :disabled="busy === user.id"
                @click="
                  containerAction(
                    user,
                    () =>
                      user.container!.state === 'running'
                        ? admin.stopContainer(user.id)
                        : admin.startContainer(user.id),
                    'app.containerToggleFailed',
                  )
                "
              >
                {{
                  user.container.state === "running"
                    ? t("app.stopContainer")
                    : t("app.startContainer")
                }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="busy === user.id"
                @click="
                  containerAction(
                    user,
                    () => admin.provisionUser(user.id, { recreate: true }),
                    'app.containerProvisionFailed',
                  )
                "
              >
                {{ t("app.recreateContainer") }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="busy === user.id"
                @click="
                  containerKeepVolume = false;
                  containerTarget = user;
                "
              >
                {{ t("app.removeContainer") }}
              </Button>
            </template>
          </template>
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
            v-model="createForm.displayName"
            data-testid="admin-user-display-name-input"
            :placeholder="t('app.adminDisplayName')"
          />
          <div class="flex gap-2">
            <Input
              v-model="createForm.password"
              data-testid="admin-user-password-input"
              :type="generatedPassword ? 'text' : 'password'"
              :placeholder="t('app.password')"
              autocomplete="new-password"
              class="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              data-testid="admin-user-generate-password"
              @click="generatePassword"
            >
              {{ t("app.adminGeneratePassword") }}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="admin-user-copy-password"
              :disabled="createForm.password === ''"
              @click="copyGeneratedPassword"
            >
              <CopyIcon class="size-4" />
              {{ t("app.adminCopyPassword") }}
            </Button>
          </div>
          <Input
            v-model="createForm.note"
            data-testid="admin-user-note-input"
            :placeholder="t('app.adminUserNote')"
          />
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>{{ t("app.adminMustChangePassword") }}</span>
            <Switch
              v-model="createForm.mustChangePassword"
              data-testid="admin-user-must-change-password"
            />
          </label>
          <Select v-model="createForm.role">
            <SelectTrigger class="w-full bg-surface" :aria-label="t('app.adminUserRole')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{{ t("app.roleUser") }}</SelectItem>
              <SelectItem value="admin">{{ t("app.roleAdmin") }}</SelectItem>
            </SelectContent>
          </Select>
          <label
            v-if="provisioning?.enabled"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <span>{{ t("app.adminProvisionOnCreate") }}</span>
            <Switch v-model="createForm.provision" data-testid="admin-user-provision-switch" />
          </label>
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
        <label
          v-if="deleteTarget?.container"
          class="flex items-center justify-between gap-3 text-sm"
        >
          <span>{{ t("app.keepDataVolume") }}</span>
          <Switch v-model="deleteKeepVolume" />
        </label>
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

    <AlertDialog
      :open="containerTarget !== null"
      @update:open="(v) => !v && (containerTarget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("app.removeContainer") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("app.removeContainerDescription", {
                username: containerTarget?.username ?? "",
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>{{ t("app.keepDataVolume") }}</span>
          <Switch v-model="containerKeepVolume" />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="containerBusy">
            {{ t("app.cancelFileDelete") }}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            :disabled="containerBusy"
            :data-testid="`admin-container-remove-confirm`"
            @click.capture="removeContainer"
          >
            {{ t("app.removeContainer") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="bulkDeleteOpen">
      <AlertDialogContent data-testid="admin-bulk-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("app.adminBulkDeleteTitle") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("app.adminBulkDeleteDescription", {
                count: bulkTargets.length,
                skipped: bulkSkipped,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>{{ t("app.keepDataVolume") }}</span>
          <Switch v-model="bulkKeepVolume" data-testid="admin-bulk-keep-volume" />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("app.cancelFileDelete") }}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            :disabled="bulkBusy || bulkTargets.length === 0"
            data-testid="admin-bulk-delete-confirm"
            @click.capture="bulkDelete"
          >
            {{ t("app.adminBulkDelete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
