<script setup lang="ts">
import { ArrowLeftIcon, Loader2Icon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@codex-gateway/ui/table";
import { toast } from "@codex-gateway/ui/sonner";
import {
  useGatewayAdminStore,
  type AdminAuditEntry,
  type AdminContainerRow,
  type AdminSession,
  type AdminUserSummary,
} from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";
import AdminUserBudgetCard from "./AdminUserBudgetCard.vue";

const props = defineProps<{ userId: number }>();
const emit = defineEmits<{ back: [] }>();

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { users } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const user = computed<AdminUserSummary | null>(
  () => users.value.find((item) => item.id === props.userId) ?? null,
);

const userSessions = ref<AdminSession[]>([]);
const ONLINE_SESSION_MS = 5 * 60_000;
const onlineSessions = computed(() =>
  userSessions.value.filter(
    (item) => Date.now() - Date.parse(item.lastSeenAt) <= ONLINE_SESSION_MS,
  ),
);
const otherSessions = computed(() =>
  userSessions.value.filter((item) => Date.now() - Date.parse(item.lastSeenAt) > ONLINE_SESSION_MS),
);
const showOtherSessions = ref(false);
const revokingOthers = ref(false);
const userAudit = ref<AdminAuditEntry[]>([]);
const container = ref<AdminContainerRow | null>(null);
const threadStats = ref<{ count: number; lastActiveAt: string | null } | null>(null);
const revoking = ref<number | null>(null);

const quotaMemory = ref("");
const quotaCpus = ref("");
const quotaSaving = ref(false);
const quotaInitialized = ref(false);
const rebuilding = ref(false);
const displayName = ref("");
const note = ref("");
const profileSaving = ref(false);

watch(
  () => user.value?.id,
  () => {
    displayName.value = user.value?.displayName ?? "";
    note.value = user.value?.note ?? "";
    if (quotaInitialized.value) return;
    quotaMemory.value = user.value?.managedHost?.quota?.memory ?? "";
    quotaCpus.value = user.value?.managedHost?.quota?.cpus ?? "";
    quotaInitialized.value = true;
  },
);

function showError(error: unknown, fallback: string) {
  toast.error(messageFromError(error, fallback, errorLabels.value));
}

async function refresh() {
  await admin.listUsers().catch(() => {});
  const [sessionsResponse, auditResponse, containerResponse, threadsResponse] =
    await Promise.allSettled([
      admin.loadSessions(),
      admin.loadAudit({ userId: props.userId, cursor: undefined }),
      admin.loadUserContainer(props.userId),
      admin.loadUserThreadStats(props.userId),
    ]);
  if (sessionsResponse.status === "fulfilled") {
    userSessions.value = admin.sessions.filter((item) => item.userId === props.userId);
  }
  if (auditResponse.status === "fulfilled") {
    userAudit.value = auditResponse.value.entries.slice(0, 50);
  }
  if (containerResponse.status === "fulfilled") {
    container.value = containerResponse.value.container;
  }
  if (threadsResponse.status === "fulfilled") {
    threadStats.value = threadsResponse.value.threads;
  }
}

async function revokeOtherSessions() {
  if (revokingOthers.value || otherSessions.value.length === 0) return;
  revokingOthers.value = true;
  try {
    const targets = otherSessions.value.filter((item) => !item.current);
    const results = await Promise.allSettled(targets.map((item) => admin.revokeSession(item.id)));
    const revoked = new Set(
      targets.filter((_, index) => results[index]?.status === "fulfilled").map((item) => item.id),
    );
    userSessions.value = userSessions.value.filter((item) => !revoked.has(item.id));
    const failed = results.length - revoked.size;
    if (failed > 0) {
      toast.error(t("app.adminBulkResult", { ok: revoked.size, failed, skipped: 0 }));
    } else {
      toast.success(t("app.adminSessionsRevokedAll"));
    }
  } finally {
    revokingOthers.value = false;
  }
}

onMounted(() => void refresh());

async function revoke(sessionId: number) {
  revoking.value = sessionId;
  try {
    await admin.revokeSession(sessionId);
    userSessions.value = userSessions.value.filter((item) => item.id !== sessionId);
  } catch (error) {
    showError(error, t("app.adminSessionsRevokeFailed"));
  } finally {
    revoking.value = null;
  }
}

async function saveProfile() {
  if (profileSaving.value || user.value === null) return;
  profileSaving.value = true;
  try {
    await admin.updateUser(props.userId, {
      displayName: displayName.value,
      note: note.value,
    });
    toast.success(t("app.adminSettingsSave"));
  } catch (error) {
    showError(error, t("app.adminUserUpdateFailed"));
  } finally {
    profileSaving.value = false;
  }
}

async function saveQuota() {
  if (quotaSaving.value) return;
  quotaSaving.value = true;
  try {
    await admin.setUserQuota(props.userId, {
      memory: quotaMemory.value.trim() === "" ? null : quotaMemory.value.trim(),
      cpus: quotaCpus.value.trim() === "" ? null : quotaCpus.value.trim(),
    });
    toast.success(t("app.adminQuotaSaved"));
  } catch (error) {
    showError(error, t("app.adminQuotaSaveFailed"));
  } finally {
    quotaSaving.value = false;
  }
}

async function rebuildNow() {
  if (rebuilding.value) return;
  rebuilding.value = true;
  try {
    await admin.deprovisionUser(props.userId, { keepVolume: true });
    await admin.provisionUser(props.userId);
    await refresh();
    toast.success(t("app.adminQuotaRebuilt"));
  } catch (error) {
    showError(error, t("app.containerProvisionFailed"));
  } finally {
    rebuilding.value = false;
  }
}

function fmt(ts: string | null) {
  return ts === null ? "—" : ts.slice(0, 16).replace("T", " ");
}

function fmtBytes(bytes: number | null) {
  if (bytes == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
</script>

<template>
  <div class="space-y-4" data-testid="admin-user-detail">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" data-testid="admin-user-back" @click="emit('back')">
        <ArrowLeftIcon class="size-4" />
        {{ t("app.adminBackToList") }}
      </Button>
      <div class="font-medium">{{ user?.username ?? `#${props.userId}` }}</div>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <!-- Basic info -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-info"
      >
        <div class="mb-3 text-sm font-medium">{{ t("app.adminUserInfoTitle") }}</div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-ink-secondary">{{ t("app.username") }}</dt>
          <dd>{{ user?.username ?? "—" }}</dd>
          <dt class="text-ink-secondary">{{ t("app.adminDisplayName") }}</dt>
          <dd>
            <Input v-model="displayName" data-testid="admin-user-detail-display-name" />
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserNote") }}</dt>
          <dd>
            <Input v-model="note" data-testid="admin-user-detail-note" />
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserRole") }}</dt>
          <dd>
            <Badge :variant="user?.role === 'admin' ? 'default' : 'secondary'">
              {{ user?.role === "admin" ? t("app.roleAdmin") : t("app.roleUser") }}
            </Badge>
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserStatus") }}</dt>
          <dd>
            <Badge :variant="user?.isActive ? 'secondary' : 'destructive'">
              {{ user?.isActive ? t("app.adminUserActive") : t("app.adminUserDisabled") }}
            </Badge>
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserCreatedAt") }}</dt>
          <dd>{{ fmt(user?.createdAt ?? null) }}</dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserLastLogin") }}</dt>
          <dd>{{ fmt(user?.lastLoginAt ?? null) }}</dd>
        </dl>
        <Button
          class="mt-3"
          size="sm"
          :disabled="profileSaving"
          data-testid="admin-user-profile-save"
          @click="saveProfile"
        >
          {{ t("app.adminSettingsSave") }}
        </Button>
      </section>

      <!-- Online sessions -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-sessions"
      >
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="text-sm font-medium">{{ t("app.adminUserSessionsTitle") }}</div>
          <Button
            v-if="otherSessions.length > 0"
            variant="outline"
            size="sm"
            :disabled="revokingOthers"
            data-testid="admin-session-revoke-others"
            @click="revokeOtherSessions"
          >
            {{ t("app.adminRevokeOtherSessions", { count: otherSessions.length }) }}
          </Button>
        </div>
        <div v-if="userSessions.length === 0" class="text-sm text-ink-muted">
          {{ t("app.adminNoSessions") }}
        </div>
        <template v-else>
          <div class="mb-2 text-xs text-ink-muted">
            {{ t("app.adminSessionsOnlineTitle") }}
          </div>
          <div v-if="onlineSessions.length === 0" class="text-sm text-ink-muted">
            {{ t("app.adminNoOnlineSessions") }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="session in onlineSessions"
              :key="session.id"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="text-ink-secondary">
                #{{ session.id }} · {{ fmt(session.lastSeenAt) }}
                <Badge v-if="session.current" variant="secondary">{{
                  t("app.adminCurrentSession")
                }}</Badge>
              </span>
              <Button
                variant="ghost"
                size="sm"
                :disabled="revoking === session.id || session.current"
                :data-testid="`admin-session-revoke-${session.id}`"
                @click="revoke(session.id)"
              >
                {{ t("app.adminRevoke") }}
              </Button>
            </div>
          </div>
          <button
            v-if="otherSessions.length > 0"
            type="button"
            class="mt-3 text-xs text-ink-muted underline-offset-2 hover:underline"
            data-testid="admin-session-others-toggle"
            @click="showOtherSessions = !showOtherSessions"
          >
            {{
              t("app.adminOtherSessionsToggle", {
                count: otherSessions.length,
                state: showOtherSessions ? "−" : "+",
              })
            }}
          </button>
          <div v-if="showOtherSessions" class="mt-2 space-y-2">
            <div
              v-for="session in otherSessions"
              :key="session.id"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="text-ink-secondary">
                #{{ session.id }} · {{ fmt(session.lastSeenAt) }}
                <Badge v-if="session.current" variant="secondary">{{
                  t("app.adminCurrentSession")
                }}</Badge>
              </span>
              <Button
                variant="ghost"
                size="sm"
                :disabled="revoking === session.id || session.current"
                :data-testid="`admin-session-revoke-${session.id}`"
                @click="revoke(session.id)"
              >
                {{ t("app.adminRevoke") }}
              </Button>
            </div>
          </div>
        </template>
      </section>

      <!-- Managed host -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-host"
      >
        <div class="mb-3 text-sm font-medium">{{ t("app.managedHost") }}</div>
        <dl v-if="user?.managedHost" class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-ink-secondary">{{ t("app.adminUserHostName") }}</dt>
          <dd>{{ user.managedHost.hostName ?? `#${user.managedHost.hostId}` }}</dd>
          <dt class="text-ink-secondary">{{ t("app.container") }}</dt>
          <dd class="font-mono text-xs">{{ user.managedHost.containerName ?? "—" }}</dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserStatus") }}</dt>
          <dd>
            <Badge :variant="user.managedHost.status === 'ready' ? 'secondary' : 'destructive'">
              {{ user.managedHost.status }}
            </Badge>
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminUserLastError") }}</dt>
          <dd class="text-xs text-ink-secondary">{{ user.managedHost.lastError ?? "—" }}</dd>
        </dl>
        <div v-else class="text-sm text-ink-muted">—</div>
      </section>

      <!-- Container resources -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-container"
      >
        <div class="mb-3 text-sm font-medium">{{ t("app.adminNavContainers") }}</div>
        <dl v-if="container" class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-ink-secondary">{{ t("app.adminContainerState") }}</dt>
          <dd>
            <Badge :variant="container.state === 'running' ? 'secondary' : 'destructive'">
              {{ container.state }}
            </Badge>
          </dd>
          <dt class="text-ink-secondary">CPU</dt>
          <dd>{{ container.cpuPercent == null ? "—" : `${container.cpuPercent}%` }}</dd>
          <dt class="text-ink-secondary">{{ t("app.adminContainerMemory") }}</dt>
          <dd>
            {{ fmtBytes(container.memoryUsageBytes) }} / {{ fmtBytes(container.memoryLimitBytes) }}
          </dd>
          <dt class="text-ink-secondary">{{ t("app.adminCodexVersion") }}</dt>
          <dd class="font-mono text-xs">{{ container.codexVersion ?? "—" }}</dd>
        </dl>
        <div v-else class="text-sm text-ink-muted">—</div>
      </section>

      <AdminUserBudgetCard :user-id="props.userId" />

      <!-- Quota -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-quota"
      >
        <div class="mb-3 text-sm font-medium">{{ t("app.adminQuotaTitle") }}</div>
        <p class="mb-3 text-xs text-ink-secondary">{{ t("app.adminQuotaHint") }}</p>
        <div class="flex items-end gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-xs text-ink-secondary">{{
              t("app.adminQuotaMemory")
            }}</label>
            <Input
              v-model="quotaMemory"
              placeholder="4g"
              :disabled="user?.managedHost == null"
              data-testid="admin-quota-memory"
            />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-xs text-ink-secondary">{{
              t("app.adminQuotaCpus")
            }}</label>
            <Input
              v-model="quotaCpus"
              placeholder="2"
              :disabled="user?.managedHost == null"
              data-testid="admin-quota-cpus"
            />
          </div>
          <Button
            size="sm"
            :disabled="quotaSaving || user?.managedHost == null"
            data-testid="admin-quota-save"
            @click="saveQuota"
          >
            {{ t("app.adminQuotaSave") }}
          </Button>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <p class="flex-1 text-xs text-ink-secondary">{{ t("app.adminQuotaRebuildHint") }}</p>
          <Button
            variant="outline"
            size="sm"
            :disabled="rebuilding || user?.managedHost == null"
            data-testid="admin-quota-rebuild"
            @click="rebuildNow"
          >
            <Loader2Icon v-if="rebuilding" class="size-4 animate-spin" />
            {{ t("app.adminQuotaRebuild") }}
          </Button>
        </div>
      </section>

      <!-- Thread stats -->
      <section
        class="rounded-lg border border-hairline bg-surface p-4"
        data-testid="admin-user-threads"
      >
        <div class="mb-3 text-sm font-medium">{{ t("app.adminThreadStatsTitle") }}</div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-ink-secondary">{{ t("app.adminThreadCount") }}</dt>
          <dd>{{ threadStats?.count ?? "—" }}</dd>
          <dt class="text-ink-secondary">{{ t("app.adminThreadLastActive") }}</dt>
          <dd>{{ fmt(threadStats?.lastActiveAt ?? null) }}</dd>
        </dl>
        <p class="mt-2 text-xs text-ink-muted">{{ t("app.adminThreadStatsHint") }}</p>
      </section>
    </div>

    <!-- Audit -->
    <section
      class="rounded-lg border border-hairline bg-surface p-4"
      data-testid="admin-user-audit"
    >
      <div class="mb-3 text-sm font-medium">{{ t("app.adminUserAuditTitle") }}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t("app.adminAuditTime") }}</TableHead>
            <TableHead>{{ t("app.adminAuditActor") }}</TableHead>
            <TableHead>{{ t("app.adminAuditAction") }}</TableHead>
            <TableHead>{{ t("app.adminAuditTarget") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="userAudit.length === 0">
            <TableCell colspan="4" class="text-center text-ink-muted">
              {{ t("app.adminAuditEmpty") }}
            </TableCell>
          </TableRow>
          <TableRow v-for="entry in userAudit" :key="entry.id">
            <TableCell class="text-ink-secondary">{{ fmt(entry.createdAt) }}</TableCell>
            <TableCell>{{ entry.actorUsername }}</TableCell>
            <TableCell class="font-mono text-xs">{{ entry.action }}</TableCell>
            <TableCell class="text-ink-secondary">{{ entry.targetLabel ?? "—" }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>
  </div>
</template>
