<script setup lang="ts">
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
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { useAuthStore } from "@/stores/auth";
import { gatewayPath } from "@/utils/gateway-url";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const auth = useAuthStore();
const { sessions, audit, settings } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const busy = ref<number | null>(null);
const auditUserFilter = ref("");
const auditActionFilter = ref("");
const auditLoading = ref(false);

async function exportAuditCsv() {
  try {
    const params = new URLSearchParams();
    if (auditUserFilter.value !== "") params.set("userId", auditUserFilter.value);
    if (auditActionFilter.value !== "") params.set("action", auditActionFilter.value);
    const blob = await $fetch<Blob>(`/api/admin/audit/export.csv?${params}`, {
      responseType: "blob",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "audit.csv";
    a.click();
    URL.revokeObjectURL(href);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminExportFailed"), errorLabels.value));
  }
}

async function refresh() {
  try {
    await Promise.all([admin.loadSessions(), loadAuditFresh(), admin.loadSettings()]);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSessionsLoadFailed"), errorLabels.value));
  }
}

async function loadAuditFresh() {
  auditLoading.value = true;
  try {
    await admin.loadAudit({
      userId: auditUserFilter.value === "" ? undefined : Number(auditUserFilter.value),
      action: auditActionFilter.value === "" ? undefined : auditActionFilter.value,
    });
  } finally {
    auditLoading.value = false;
  }
}

async function loadMoreAudit() {
  if (audit.value.nextCursor === null) return;
  auditLoading.value = true;
  try {
    await admin.loadAudit({
      cursor: audit.value.nextCursor,
      userId: auditUserFilter.value === "" ? undefined : Number(auditUserFilter.value),
      action: auditActionFilter.value === "" ? undefined : auditActionFilter.value,
    });
  } finally {
    auditLoading.value = false;
  }
}

async function revokeSession(sessionId: number) {
  busy.value = sessionId;
  try {
    await admin.revokeSession(sessionId);
    toast.success(t("app.adminSessionRevoked"));
    await loadAuditFresh();
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSessionRevokeFailed"), errorLabels.value));
  } finally {
    busy.value = null;
  }
}

function fmt(iso: string) {
  return iso.slice(0, 19).replace("T", " ");
}

onMounted(() => void refresh());
</script>

<template>
  <div class="space-y-6" data-testid="admin-sessions">
    <section class="space-y-2">
      <div class="font-medium">{{ t("app.adminSessionsTitle") }}</div>
      <div class="rounded-lg border border-hairline bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t("app.username") }}</TableHead>
              <TableHead>{{ t("app.adminSessionCreated") }}</TableHead>
              <TableHead>{{ t("app.adminSessionLastSeen") }}</TableHead>
              <TableHead>{{ t("app.adminSessionExpires") }}</TableHead>
              <TableHead class="text-right">{{ t("app.adminUserActions") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="sessions.length === 0">
              <TableCell colspan="5" class="text-center text-ink-muted">
                {{ t("app.adminSessionsEmpty") }}
              </TableCell>
            </TableRow>
            <TableRow
              v-for="session in sessions"
              :key="session.id"
              :data-testid="`admin-session-row-${session.id}`"
            >
              <TableCell class="font-medium">
                {{ session.username }}
                <Badge v-if="session.current" variant="secondary" class="ml-1">{{
                  t("app.adminSessionCurrent")
                }}</Badge>
              </TableCell>
              <TableCell class="text-ink-secondary">{{ fmt(session.createdAt) }}</TableCell>
              <TableCell class="text-ink-secondary">{{ fmt(session.lastSeenAt) }}</TableCell>
              <TableCell class="text-ink-secondary">{{ fmt(session.expiresAt) }}</TableCell>
              <TableCell class="text-right">
                <Button
                  v-if="!session.current"
                  variant="ghost"
                  size="sm"
                  :disabled="busy === session.id"
                  :data-testid="`admin-session-revoke-${session.id}`"
                  @click="revokeSession(session.id)"
                >
                  {{ t("app.adminRevoke") }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="font-medium">{{ t("app.adminAuditTitle") }}</div>
        <div class="flex gap-2">
          <Input
            v-model="auditUserFilter"
            class="w-32"
            :placeholder="t('app.adminAuditFilterUser')"
            data-testid="admin-audit-filter-user"
            @keyup.enter="loadAuditFresh"
          />
          <Input
            v-model="auditActionFilter"
            class="w-44"
            :placeholder="t('app.adminAuditFilterAction')"
            data-testid="admin-audit-filter-action"
            @keyup.enter="loadAuditFresh"
          />
          <Button variant="outline" size="sm" :disabled="auditLoading" @click="loadAuditFresh">
            {{ t("app.adminApplyFilter") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="admin-audit-export"
            @click="exportAuditCsv"
          >
            {{ t("app.adminExportCsv") }}
          </Button>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-ink-muted">
        {{ t("app.adminAuditRetention", { days: settings?.audit.retentionDays ?? 180 }) }}
        <a
          :href="`${gatewayPath('/admin')}?tab=system`"
          class="underline underline-offset-2 hover:text-ink"
          >{{ t("app.adminAuditRetentionEdit") }}</a
        >
      </div>
      <div class="rounded-lg border border-hairline bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t("app.adminAuditTime") }}</TableHead>
              <TableHead>{{ t("app.adminAuditActor") }}</TableHead>
              <TableHead>{{ t("app.adminAuditAction") }}</TableHead>
              <TableHead>{{ t("app.adminAuditTarget") }}</TableHead>
              <TableHead>{{ t("app.adminAuditDetail") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="audit.entries.length === 0">
              <TableCell colspan="5" class="text-center text-ink-muted">
                {{ t("app.adminAuditEmpty") }}
              </TableCell>
            </TableRow>
            <TableRow v-for="entry in audit.entries" :key="entry.id">
              <TableCell class="font-mono text-xs text-ink-secondary">
                {{ fmt(entry.createdAt) }}
              </TableCell>
              <TableCell class="font-medium">{{ entry.actorUsername }}</TableCell>
              <TableCell class="text-ink-secondary">{{ entry.action }}</TableCell>
              <TableCell class="text-ink-secondary">
                {{ entry.targetLabel ?? entry.targetId ?? entry.targetType }}
              </TableCell>
              <TableCell class="font-mono text-xs text-ink-muted">
                {{ entry.detail ? JSON.stringify(entry.detail) : "—" }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <Button
        v-if="audit.nextCursor !== null"
        variant="outline"
        size="sm"
        :disabled="auditLoading"
        data-testid="admin-audit-load-more"
        @click="loadMoreAudit"
      >
        {{ t("app.adminLoadMore") }}
      </Button>
    </section>
  </div>
</template>
