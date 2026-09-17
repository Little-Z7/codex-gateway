<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Loader2Icon, RefreshCwIcon } from "@lucide/vue";
import { Checkbox } from "@codex-gateway/ui/checkbox";
import AdminImageCard from "./AdminImageCard.vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@codex-gateway/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { Switch } from "@codex-gateway/ui/switch";
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
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { containers, volumeWarnBytes, image } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const loading = ref(false);
const autoRefresh = ref(true);
const volumesLoaded = ref(false);
const logsFor = ref<{ userId: number; username: string } | null>(null);
const logs = ref("");
const logsTail = ref("200");
const logsLoading = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
const followLogs = ref(false);
let followTimer: ReturnType<typeof setInterval> | null = null;
const logsEl = ref<HTMLElement | null>(null);
const seenLogLines = new Set<string>();

// --- selection + bulk container ops ---
const selected = ref<Set<number>>(new Set());
const bulkBusy = ref(false);
const selectedRows = computed(() =>
  containers.value.filter((row) => selected.value.has(row.userId)),
);
const allSelected = computed(
  () =>
    containers.value.length > 0 && containers.value.every((row) => selected.value.has(row.userId)),
);
function isSelected(userId: number) {
  return selected.value.has(userId);
}
function toggleSelected(userId: number, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(userId);
  else next.delete(userId);
  selected.value = next;
}
function toggleAll(checked: boolean) {
  const next = new Set(selected.value);
  for (const row of containers.value) {
    if (checked) next.add(row.userId);
    else next.delete(row.userId);
  }
  selected.value = next;
}
async function bulkContainerAction(action: "start" | "stop" | "recreate") {
  if (bulkBusy.value) return;
  bulkBusy.value = true;
  let ok = 0;
  let failed = 0;
  for (const row of selectedRows.value) {
    try {
      if (action === "start") await admin.startContainer(row.userId);
      else if (action === "stop") await admin.stopContainer(row.userId);
      else {
        await admin.deprovisionUser(row.userId, { keepVolume: true });
        await admin.provisionUser(row.userId);
      }
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  bulkBusy.value = false;
  selected.value = new Set();
  toast.success(t("app.adminBulkResult", { ok, failed, skipped: 0 }));
  if (failed > 0) toast.error(t("app.adminBulkPartial", { count: failed }));
  await refresh();
}

function isOversized(row: { volumeSizeBytes: number | null }) {
  return row.volumeSizeBytes !== null && row.volumeSizeBytes > volumeWarnBytes.value;
}

async function refresh(showToast = false) {
  loading.value = true;
  try {
    await admin.loadContainers();
    if (!volumesLoaded.value) {
      volumesLoaded.value = true;
      admin.loadContainerVolumes().catch(() => {});
    }
  } catch (error) {
    if (showToast) {
      toast.error(messageFromError(error, t("app.adminContainersLoadFailed"), errorLabels.value));
    }
  } finally {
    loading.value = false;
  }
}

async function openLogs(row: { userId: number; username: string }) {
  logsFor.value = row;
  logs.value = "";
  seenLogLines.clear();
  followLogs.value = false;
  await refreshLogs();
}

watch(followLogs, (enabled) => {
  if (followTimer !== null) {
    clearInterval(followTimer);
    followTimer = null;
  }
  if (enabled && logsFor.value !== null) {
    followTimer = setInterval(async () => {
      if (logsFor.value === null) return;
      try {
        const response = await admin.loadContainerLogs(
          logsFor.value.userId,
          Number(logsTail.value),
        );
        const fresh = response.logs
          .split("\n")
          .filter((line) => line !== "" && !seenLogLines.has(line));
        if (fresh.length > 0) {
          for (const line of response.logs.split("\n")) {
            if (line !== "") seenLogLines.add(line);
          }
          logs.value = `${logs.value}${logs.value.endsWith("\n") || logs.value === "" ? "" : "\n"}${fresh.join("\n")}\n`;
          await nextTick();
          logsEl.value?.scrollTo({ top: logsEl.value.scrollHeight });
        }
      } catch {
        // follow failures are transient; next tick retries
      }
    }, 2_000);
  }
});

watch(logsFor, (value) => {
  if (value === null) {
    followLogs.value = false;
    if (followTimer !== null) {
      clearInterval(followTimer);
      followTimer = null;
    }
  }
});

async function refreshLogs() {
  if (!logsFor.value) return;
  logsLoading.value = true;
  try {
    const response = await admin.loadContainerLogs(logsFor.value.userId, Number(logsTail.value));
    logs.value = response.logs;
    seenLogLines.clear();
    for (const line of response.logs.split("\n")) {
      if (line !== "") seenLogLines.add(line);
    }
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminLogsLoadFailed"), errorLabels.value));
  } finally {
    logsLoading.value = false;
  }
}

function formatBytes(bytes: number | null) {
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

function stateVariant(state: string) {
  return state === "running" ? "secondary" : state === "missing" ? "destructive" : "outline";
}

watch(autoRefresh, (enabled) => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (enabled) {
    timer = setInterval(() => void refresh(), 10_000);
  }
});

onMounted(() => {
  void refresh(true);
  timer = setInterval(() => void refresh(), 10_000);
});

onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-containers">
    <AdminImageCard />
    <div
      v-if="selected.size > 0"
      class="flex items-center gap-2 rounded-lg border border-hairline bg-surface p-2 text-sm"
      data-testid="admin-containers-bulk-bar"
    >
      <span class="text-ink-secondary">{{
        t("app.adminBulkSelected", { count: selected.size, skipped: 0 })
      }}</span>
      <Button
        variant="outline"
        size="sm"
        :disabled="bulkBusy"
        @click="bulkContainerAction('start')"
      >
        {{ t("app.adminContainerStart") }}
      </Button>
      <Button variant="outline" size="sm" :disabled="bulkBusy" @click="bulkContainerAction('stop')">
        {{ t("app.adminContainerStop") }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="bulkBusy"
        @click="bulkContainerAction('recreate')"
      >
        {{ t("app.adminRecreateKeepVolume") }}
      </Button>
    </div>
    <div class="flex items-center justify-between gap-3">
      <div class="font-medium">{{ t("app.adminNavContainers") }}</div>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-ink-secondary">
          <Switch v-model="autoRefresh" data-testid="admin-containers-autorefresh" />
          {{ t("app.adminAutoRefresh") }}
        </label>
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh(true)">
          <RefreshCwIcon :class="loading ? 'size-4 animate-spin' : 'size-4'" />
        </Button>
      </div>
    </div>

    <div class="rounded-lg border border-hairline bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-8">
              <Checkbox
                :model-value="allSelected"
                @update:model-value="(v: boolean | 'indeterminate') => toggleAll(v === true)"
              />
            </TableHead>
            <TableHead>{{ t("app.username") }}</TableHead>
            <TableHead>{{ t("app.container") }}</TableHead>
            <TableHead>{{ t("app.adminContainerState") }}</TableHead>
            <TableHead>{{ t("app.adminCodexVersion") }}</TableHead>
            <TableHead>{{ t("app.adminImageDigest") }}</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>{{ t("app.adminContainerMemory") }}</TableHead>
            <TableHead>{{ t("app.adminContainerStarted") }}</TableHead>
            <TableHead>{{ t("app.adminVolume") }}</TableHead>
            <TableHead class="text-right">{{ t("app.adminUserActions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="containers.length === 0">
            <TableCell colspan="11" class="text-center text-ink-muted">
              {{ t("app.adminContainersEmpty") }}
            </TableCell>
          </TableRow>
          <TableRow
            v-for="row in containers"
            :key="row.userId"
            :data-testid="`admin-container-row-${row.username}`"
          >
            <TableCell>
              <Checkbox
                :model-value="isSelected(row.userId)"
                :data-testid="`admin-container-select-${row.username}`"
                @update:model-value="
                  (v: boolean | 'indeterminate') => toggleSelected(row.userId, v === true)
                "
              />
            </TableCell>
            <TableCell class="font-medium">{{ row.username }}</TableCell>
            <TableCell class="font-mono text-xs">{{ row.containerName }}</TableCell>
            <TableCell>
              <Badge :variant="stateVariant(row.state)">{{ row.state }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">
              <template v-if="row.codexVersion">{{ row.codexVersion }}</template>
              <Badge
                v-if="
                  row.codexVersion !== null &&
                  image !== null &&
                  row.codexVersion !== image.supportedCodexVersion
                "
                variant="outline"
                class="ml-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
                :title="t('app.adminVersionMismatch')"
              >
                ≠
              </Badge>
              <span v-if="row.codexVersion === null" class="text-ink-muted">—</span>
            </TableCell>
            <TableCell class="font-mono text-xs text-ink-secondary">{{
              row.imageDigest ?? "—"
            }}</TableCell>
            <TableCell class="text-ink-secondary">
              {{ row.cpuPercent == null ? "—" : `${row.cpuPercent}%` }}
            </TableCell>
            <TableCell class="text-ink-secondary">
              {{ formatBytes(row.memoryUsageBytes) }} / {{ formatBytes(row.memoryLimitBytes) }}
            </TableCell>
            <TableCell class="text-ink-secondary">
              {{ row.startedAt ? row.startedAt.slice(0, 16).replace("T", " ") : "—" }}
            </TableCell>
            <TableCell class="text-ink-secondary" :class="{ 'text-destructive': isOversized(row) }">
              <span class="font-mono text-xs">{{ row.volumeName ?? "—" }}</span>
              <span class="ml-1">{{ formatBytes(row.volumeSizeBytes) }}</span>
              <span v-if="isOversized(row)" class="ml-1 text-xs">{{
                t("app.adminVolumeOver")
              }}</span>
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                :data-testid="`admin-container-logs-${row.username}`"
                @click="openLogs(row)"
              >
                {{ t("app.adminViewLogs") }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog
      :open="logsFor !== null"
      @update:open="
        (open) => {
          if (!open) logsFor = null;
        }
      "
    >
      <DialogContent
        class="flex h-[min(40rem,calc(100vh-4rem))] w-[min(60rem,calc(100vw-3rem))] !max-w-[min(60rem,calc(100vw-3rem))] flex-col"
        data-testid="admin-container-logs-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {{ t("app.adminContainerLogsTitle", { name: logsFor?.username ?? "" }) }}
          </DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-between gap-2">
          <Select v-model="logsTail" @update:model-value="refreshLogs">
            <SelectTrigger class="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="200">200</SelectItem>
              <SelectItem value="1000">1000</SelectItem>
            </SelectContent>
          </Select>
          <label class="flex items-center gap-2 text-sm text-ink-secondary">
            <Switch v-model="followLogs" data-testid="admin-logs-follow" />
            {{ t("app.adminLogsFollow") }}
          </label>
          <Button variant="outline" size="sm" :disabled="logsLoading" @click="refreshLogs">
            <Loader2Icon v-if="logsLoading" class="size-4 animate-spin" />
            <RefreshCwIcon v-else class="size-4" />
            {{ t("app.adminRefresh") }}
          </Button>
        </div>
        <pre
          ref="logsEl"
          class="min-h-0 flex-1 overflow-auto rounded-lg border border-hairline bg-canvas-soft p-3 font-mono text-xs leading-5 text-ink-secondary"
          data-testid="admin-container-logs-body"
          >{{ logs }}</pre>
      </DialogContent>
    </Dialog>
  </div>
</template>
