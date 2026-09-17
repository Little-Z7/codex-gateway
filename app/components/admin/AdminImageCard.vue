<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Loader2Icon } from "@lucide/vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@codex-gateway/ui/dialog";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { image, rebuildStatus, recreateAll } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

const latestCheck = ref<{ version: string | null; error: string | null } | null>(null);
const checking = ref(false);
const rebuildOpen = ref(false);
const recreateBusy = ref(false);
let rebuildTimer: ReturnType<typeof setInterval> | null = null;
let recreateTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  await admin.loadImage().catch(() => {});
  await admin.loadRebuildStatus().catch(() => {});
  await admin.loadRecreateAll().catch(() => {});
}

onMounted(() => void refresh());

onUnmounted(() => {
  if (rebuildTimer !== null) clearInterval(rebuildTimer);
  if (recreateTimer !== null) clearInterval(recreateTimer);
});

async function checkLatest() {
  checking.value = true;
  try {
    latestCheck.value = await admin.checkCodexLatest();
  } catch (error) {
    latestCheck.value = {
      version: null,
      error: messageFromError(error, t("app.adminImageCheckFailed"), errorLabels.value),
    };
  } finally {
    checking.value = false;
  }
}

async function startRebuild() {
  try {
    await admin.startImageRebuild(latestCheck.value?.version ?? undefined);
    rebuildOpen.value = true;
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminRebuildFailed"), errorLabels.value));
  }
}

watch(rebuildOpen, (open) => {
  if (rebuildTimer !== null) {
    clearInterval(rebuildTimer);
    rebuildTimer = null;
  }
  if (open) {
    rebuildTimer = setInterval(() => {
      void admin
        .loadRebuildStatus()
        .then((status) => {
          if (status.status !== "running") {
            if (rebuildTimer !== null) clearInterval(rebuildTimer);
            rebuildTimer = null;
            void admin.loadImage().catch(() => {});
          }
        })
        .catch(() => {});
    }, 2_000);
  }
});

async function recreateAllContainers() {
  recreateBusy.value = true;
  try {
    await admin.startRecreateAll(10);
    recreateTimer = setInterval(() => {
      void admin
        .loadRecreateAll()
        .then((status) => {
          if (status.status !== "running") {
            if (recreateTimer !== null) clearInterval(recreateTimer);
            recreateTimer = null;
            void admin.loadContainers().catch(() => {});
            void admin.listUsers().catch(() => {});
          }
          if (status.failures.length > 0) {
            toast.error(t("app.adminRecreateAllFailures", { count: status.failures.length }));
          }
        })
        .catch(() => {});
    }, 3_000);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminRecreateAllFailed"), errorLabels.value));
  } finally {
    recreateBusy.value = false;
  }
}

async function cancelRecreate() {
  await admin.cancelRecreateAll().catch(() => {});
}
</script>

<template>
  <section class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-image-card">
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="mb-1 text-sm font-medium">{{ t("app.adminImageTitle") }}</div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
          <span class="font-mono">{{ image?.image ?? "—" }}</span>
          <Badge v-if="image?.digest" variant="secondary" :title="image.digest">{{
            image.digest.replace(/^sha256:/, "").slice(0, 12)
          }}</Badge>
          <Badge v-else-if="image && !image.present" variant="destructive">{{
            t("app.adminImageMissing")
          }}</Badge>
          <Badge v-else variant="destructive">{{ t("app.adminImageMissing") }}</Badge>
          <span v-if="image?.codexVersion">
            codex {{ image.codexVersion }}
            <Badge
              v-if="image.codexVersion !== image.supportedCodexVersion"
              variant="outline"
              class="border-amber-500/50 text-amber-600 dark:text-amber-400"
              :title="t('app.adminVersionMismatch')"
            >
              {{ t("app.adminVersionMismatchShort") }}
            </Badge>
          </span>
          <span v-if="image?.builtAt">· {{ image.builtAt.slice(0, 16).replace("T", " ") }}</span>
          <span v-else-if="image?.created"
            >· {{ image.created.slice(0, 16).replace("T", " ") }}</span
          >
        </div>
        <div v-if="latestCheck" class="mt-1 text-xs" data-testid="admin-latest-check">
          <span v-if="latestCheck.version" class="text-ink-secondary">
            {{ t("app.adminLatestCodex", { version: latestCheck.version }) }}
          </span>
          <span v-else class="text-destructive">{{ latestCheck.error }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="checking"
          data-testid="admin-check-latest"
          @click="checkLatest"
        >
          <Loader2Icon v-if="checking" class="size-4 animate-spin" />
          {{ t("app.adminCheckLatest") }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="rebuildStatus?.status === 'running'"
          data-testid="admin-rebuild-image"
          @click="startRebuild"
        >
          {{
            rebuildStatus?.status === "running"
              ? t("app.adminRebuilding")
              : t("app.adminRebuildImage")
          }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="recreateBusy || recreateAll?.status === 'running'"
          data-testid="admin-recreate-all"
          @click="recreateAllContainers"
        >
          {{ t("app.adminRecreateAll") }}
        </Button>
        <Button
          v-if="recreateAll?.status === 'running'"
          variant="ghost"
          size="sm"
          data-testid="admin-recreate-all-cancel"
          @click="cancelRecreate"
        >
          {{ t("app.adminRecreateAllCancel") }}
        </Button>
      </div>
    </div>
    <div
      v-if="recreateAll && recreateAll.status !== 'idle'"
      class="mt-2 text-xs text-ink-secondary"
      data-testid="admin-recreate-all-status"
    >
      {{
        t("app.adminRecreateAllProgress", {
          done: recreateAll.completed,
          total: recreateAll.total,
          current: recreateAll.currentUser ?? "—",
        })
      }}
      <span v-if="recreateAll.failures.length > 0" class="text-destructive">
        {{ t("app.adminRecreateAllFailures", { count: recreateAll.failures.length }) }}
      </span>
    </div>

    <Dialog v-model:open="rebuildOpen">
      <DialogContent
        class="flex h-[min(40rem,calc(100vh-4rem))] w-[min(60rem,calc(100vw-3rem))] !max-w-[min(60rem,calc(100vw-3rem))] flex-col"
        data-testid="admin-rebuild-dialog"
      >
        <DialogHeader>
          <DialogTitle>{{ t("app.adminRebuildLogTitle") }}</DialogTitle>
        </DialogHeader>
        <div class="text-xs text-ink-secondary">
          {{ t("app.adminRebuildStatus", { status: rebuildStatus?.status ?? "idle" }) }}
        </div>
        <pre
          class="min-h-0 flex-1 overflow-auto rounded-lg border border-hairline bg-canvas-soft p-3 font-mono text-xs leading-5 text-ink-secondary"
          data-testid="admin-rebuild-log"
          >{{ rebuildStatus?.lines.join("\n") ?? "" }}</pre>
      </DialogContent>
    </Dialog>
  </section>
</template>
