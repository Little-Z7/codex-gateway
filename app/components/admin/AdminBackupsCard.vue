<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Loader2Icon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { useAuthStore } from "@/stores/auth";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const auth = useAuthStore();
const { backups } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));
const running = ref(false);
const deleting = ref<string | null>(null);

onMounted(() => void admin.loadBackups().catch(() => {}));

async function createBackup() {
  if (running.value) return;
  running.value = true;
  try {
    const result = await admin.createBackup();
    toast.success(t("app.adminBackupDone", { name: result.name }));
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminBackupFailed"), errorLabels.value));
  } finally {
    running.value = false;
  }
}

async function download(name: string) {
  try {
    const blob = await $fetch<Blob>(`/api/admin/backups/${encodeURIComponent(name)}/download`, {
      responseType: "blob",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${name}.tar`;
    a.click();
    URL.revokeObjectURL(href);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminBackupFailed"), errorLabels.value));
  }
}

async function remove(name: string) {
  deleting.value = name;
  try {
    await admin.deleteBackup(name);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminBackupFailed"), errorLabels.value));
  } finally {
    deleting.value = null;
  }
}

function formatBytes(bytes: number) {
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
  <div class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-backups-card">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-sm font-medium">{{ t("app.adminBackupsTitle") }}</div>
      <Button
        variant="outline"
        size="sm"
        :disabled="running"
        data-testid="admin-backup-create"
        @click="createBackup"
      >
        <Loader2Icon v-if="running" class="size-4 animate-spin" />
        {{ running ? t("app.adminBackupRunning") : t("app.adminBackupCreate") }}
      </Button>
    </div>
    <p v-if="backups.length === 0" class="text-sm text-ink-muted">
      {{ t("app.adminBackupsEmpty") }}
    </p>
    <ul v-else class="space-y-2 text-sm">
      <li
        v-for="backup in backups"
        :key="backup.name"
        class="flex items-center justify-between gap-2"
        :data-testid="`admin-backup-${backup.name}`"
      >
        <span class="min-w-0">
          <span class="font-mono text-xs text-ink-secondary">{{ backup.name }}</span>
          <span class="ml-2 text-xs text-ink-muted">{{ formatBytes(backup.sizeBytes) }}</span>
        </span>
        <span class="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            :data-testid="`admin-backup-download-${backup.name}`"
            @click="download(backup.name)"
          >
            {{ t("app.adminBackupDownload") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="deleting === backup.name"
            :data-testid="`admin-backup-delete-${backup.name}`"
            @click="remove(backup.name)"
          >
            {{ t("app.adminBackupDelete") }}
          </Button>
        </span>
      </li>
    </ul>
  </div>
</template>
