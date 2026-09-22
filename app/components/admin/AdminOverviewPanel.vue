<script setup lang="ts">
import { toast } from "@codex-gateway/ui/sonner";
import ProvisioningDiagnosticsCard from "./ProvisioningDiagnosticsCard.vue";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { overview, audit } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

onMounted(async () => {
  try {
    await Promise.all([admin.loadOverview(), admin.loadAudit({})]);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminOverviewLoadFailed"), errorLabels.value));
  }
});

function formatBytes(bytes: number | null | undefined) {
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

function formatUptime(seconds: number) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

const statCards = computed(() => {
  const info = overview.value;
  if (!info) return [];
  return [
    { label: t("app.adminStatUsers"), value: String(info.users.total) },
    { label: t("app.adminStatOnline"), value: String(info.sessions.online) },
    { label: t("app.adminStatContainersRunning"), value: String(info.containers.running) },
    {
      label: t("app.adminStatContainersTotal"),
      value: String(
        info.containers.running +
          info.containers.exited +
          info.containers.missing +
          info.containers.provisioning +
          info.containers.error,
      ),
    },
    {
      label: t("app.adminVolumesOverThreshold"),
      value: info.volumes.overThreshold === null ? "—" : String(info.volumes.overThreshold),
    },
    {
      label: t("app.adminStatTodayTurns"),
      value: String(info.usage.today.turns),
    },
    {
      label: t("app.adminStatTodayTokens"),
      value: String(info.usage.today.tokens),
    },
    {
      label: t("app.adminBudgetExceededUsers"),
      value: String(info.usage.overBudgetUsers ?? 0),
    },
  ];
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-overview">
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div
        v-for="card in statCards"
        :key="card.label"
        class="rounded-lg border border-hairline bg-surface p-4"
      >
        <div class="text-sm text-ink-muted">{{ card.label }}</div>
        <div class="mt-1 text-2xl font-semibold">{{ card.value }}</div>
      </div>
    </div>

    <ProvisioningDiagnosticsCard :provisioning="overview?.provisioning ?? null" />

    <div
      v-if="overview"
      class="rounded-lg border border-hairline bg-surface p-4 text-sm"
      data-testid="admin-gateway-info"
    >
      <div class="mb-2 font-medium">{{ t("app.adminGatewayInfo") }}</div>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-ink-secondary md:grid-cols-4">
        <div>
          <dt class="text-ink-faint">{{ t("app.adminVersion") }}</dt>
          <dd class="font-mono text-xs">{{ overview.gateway.version }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">Node</dt>
          <dd class="font-mono text-xs">{{ overview.gateway.nodeVersion }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t("app.adminUptime") }}</dt>
          <dd class="font-mono text-xs">{{ formatUptime(overview.gateway.uptimeSeconds) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t("app.adminMemory") }}</dt>
          <dd class="font-mono text-xs">
            {{ formatBytes(overview.gateway.memory.heapUsedBytes) }} /
            {{ formatBytes(overview.gateway.memory.rssBytes) }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">Codex</dt>
          <dd class="font-mono text-xs">{{ overview.codex.supportedVersion }}</dd>
        </div>
      </dl>
    </div>

    <div class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-recent-audit">
      <div class="mb-2 text-sm font-medium">{{ t("app.adminRecentAudit") }}</div>
      <div v-if="audit.entries.length === 0" class="text-sm text-ink-muted">
        {{ t("app.adminAuditEmpty") }}
      </div>
      <ul v-else class="space-y-1 text-sm">
        <li
          v-for="entry in audit.entries.slice(0, 10)"
          :key="entry.id"
          class="flex flex-wrap items-baseline gap-x-2"
        >
          <span class="font-mono text-xs text-ink-faint">
            {{ entry.createdAt.slice(0, 19).replace("T", " ") }}
          </span>
          <span class="font-medium">{{ entry.actorUsername }}</span>
          <span class="text-ink-secondary">{{ entry.action }}</span>
          <span class="text-ink-muted">{{ entry.targetLabel ?? entry.targetId ?? "" }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
