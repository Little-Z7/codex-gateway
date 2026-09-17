<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Loader2Icon, RefreshCwIcon } from "@lucide/vue";
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

const { t } = useI18n();
const admin = useGatewayAdminStore();
const { containers } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t));

const loading = ref(false);
const autoRefresh = ref(true);
const volumesLoaded = ref(false);
const logsFor = ref<{ userId: number; username: string } | null>(null);
const logs = ref("");
const logsTail = ref("200");
const logsLoading = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

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
  await refreshLogs();
}

async function refreshLogs() {
  if (!logsFor.value) return;
  logsLoading.value = true;
  try {
    const response = await admin.loadContainerLogs(logsFor.value.userId, Number(logsTail.value));
    logs.value = response.logs;
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
            <TableHead>{{ t("app.username") }}</TableHead>
            <TableHead>{{ t("app.container") }}</TableHead>
            <TableHead>{{ t("app.adminContainerState") }}</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>{{ t("app.adminMemory") }}</TableHead>
            <TableHead>{{ t("app.adminContainerStarted") }}</TableHead>
            <TableHead>{{ t("app.adminVolume") }}</TableHead>
            <TableHead class="text-right">{{ t("app.adminUserActions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="containers.length === 0">
            <TableCell colspan="8" class="text-center text-ink-muted">
              {{ t("app.adminContainersEmpty") }}
            </TableCell>
          </TableRow>
          <TableRow
            v-for="row in containers"
            :key="row.userId"
            :data-testid="`admin-container-row-${row.username}`"
          >
            <TableCell class="font-medium">{{ row.username }}</TableCell>
            <TableCell class="font-mono text-xs">{{ row.containerName }}</TableCell>
            <TableCell>
              <Badge :variant="stateVariant(row.state)">{{ row.state }}</Badge>
            </TableCell>
            <TableCell class="text-ink-secondary">
              {{ row.cpuPercent == null ? "—" : `${row.cpuPercent}%` }}
            </TableCell>
            <TableCell class="text-ink-secondary">
              {{ formatBytes(row.memoryUsageBytes) }} / {{ formatBytes(row.memoryLimitBytes) }}
            </TableCell>
            <TableCell class="text-ink-secondary">
              {{ row.startedAt ? row.startedAt.slice(0, 16).replace("T", " ") : "—" }}
            </TableCell>
            <TableCell class="text-ink-secondary">
              <span class="font-mono text-xs">{{ row.volumeName ?? "—" }}</span>
              <span class="ml-1">{{ formatBytes(row.volumeSizeBytes) }}</span>
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
          <Button variant="outline" size="sm" :disabled="logsLoading" @click="refreshLogs">
            <Loader2Icon v-if="logsLoading" class="size-4 animate-spin" />
            <RefreshCwIcon v-else class="size-4" />
            {{ t("app.adminRefresh") }}
          </Button>
        </div>
        <pre
          class="min-h-0 flex-1 overflow-auto rounded-lg border border-hairline bg-canvas-soft p-3 font-mono text-xs leading-5 text-ink-secondary"
          data-testid="admin-container-logs-body"
          >{{ logs }}</pre>
      </DialogContent>
    </Dialog>
  </div>
</template>
