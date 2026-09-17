<script setup lang="ts">
import { storeToRefs } from "pinia";
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from "@lucide/vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t } = useI18n();
const admin = useGatewayAdminStore();
const { systemInfo, sharedLoginStatus } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t));
const sharedLoginBusy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    await Promise.all([admin.loadSystem(), admin.loadSharedLogin()]);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSystemLoadFailed"), errorLabels.value));
  }
}

async function startSharedLogin() {
  sharedLoginBusy.value = true;
  try {
    await admin.startSharedLogin();
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSharedLoginFailed"), errorLabels.value));
  } finally {
    sharedLoginBusy.value = false;
  }
}

async function cancelSharedLogin() {
  sharedLoginBusy.value = true;
  try {
    await admin.cancelSharedLogin();
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSharedLoginFailed"), errorLabels.value));
  } finally {
    sharedLoginBusy.value = false;
  }
}

async function copyCode() {
  const code = sharedLoginStatus.value?.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast.success(t("app.adminCopied"));
  } catch {
    toast.error(t("app.adminCopyFailed"));
  }
}

watch(
  () => sharedLoginStatus.value?.status,
  (status) => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (status === "starting" || status === "pending") {
      pollTimer = setInterval(() => void admin.loadSharedLogin().catch(() => {}), 2000);
    }
  },
);

onMounted(() => void refresh());
onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer);
});

function kv(label: string, value: unknown) {
  return { label: t(label), value: value == null || value === "" ? "—" : String(value) };
}

const provisioningRows = computed(() => {
  const info = systemInfo.value;
  if (!info) return [];
  const p = info.provisioning;
  return [
    kv("app.adminCfgEnabled", p.enabled),
    kv("app.provisioningImage", p.userImage),
    kv("app.provisioningNetwork", p.dockerNetwork),
    kv("app.adminCfgDockerSocket", p.dockerSocket),
    kv("app.adminCfgSharedAuthDir", p.sharedAuthDir),
    kv("app.adminCfgSharedDataDir", p.sharedDataDir),
    kv("app.adminCfgContainerPrefix", p.containerPrefix),
    kv("app.adminCfgMemory", p.memory),
    kv("app.adminCfgCpus", p.cpus),
    kv("app.adminCfgSandbox", p.sandboxMode),
  ];
});

const providerRows = computed(() => {
  const info = systemInfo.value;
  if (!info) return [];
  const m = info.modelProvider;
  return [
    kv("app.adminCfgProviderMode", m.mode),
    kv("app.adminCfgProviderId", m.id),
    kv("app.adminCfgProviderBaseUrl", m.baseUrl),
    kv("app.adminCfgProviderWireApi", m.wireApi),
    kv("app.adminCfgProviderModel", m.model),
    kv(
      "app.adminCfgProviderKey",
      m.apiKeyConfigured ? t("app.adminCfgKeyConfigured") : t("app.adminCfgKeyMissing"),
    ),
  ];
});

const runtimeRows = computed(() => {
  const info = systemInfo.value;
  if (!info) return [];
  return [
    kv("app.adminVersion", info.runtime.version),
    kv("app.adminCfgPort", info.runtime.port),
    kv("app.adminCfgDbPath", info.paths.database),
    kv("app.adminCfgCodexVersion", info.runtime.supportedCodexVersion),
    kv("app.adminCfgNode", info.runtime.nodeVersion),
  ];
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-system">
    <div class="rounded-lg border border-hairline bg-surface p-4">
      <div class="mb-2 text-sm font-medium">{{ t("app.adminCfgRuntime") }}</div>
      <dl class="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        <div v-for="row in runtimeRows" :key="String(row.label)" class="flex justify-between gap-3">
          <dt class="text-ink-muted">{{ row.label }}</dt>
          <dd class="truncate font-mono text-xs text-ink-secondary">{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <div class="rounded-lg border border-hairline bg-surface p-4">
      <div class="mb-2 text-sm font-medium">{{ t("app.adminCfgProvisioning") }}</div>
      <dl class="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        <div
          v-for="row in provisioningRows"
          :key="String(row.label)"
          class="flex justify-between gap-3"
        >
          <dt class="text-ink-muted">{{ row.label }}</dt>
          <dd class="truncate font-mono text-xs text-ink-secondary">{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <div class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-provider-card">
      <div class="mb-2 flex items-center gap-2 text-sm font-medium">
        {{ t("app.adminCfgProvider") }}
        <Badge :variant="systemInfo?.modelProvider.valid ? 'secondary' : 'destructive'">
          {{ systemInfo?.modelProvider.mode ?? "—" }}
        </Badge>
      </div>
      <dl class="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        <div
          v-for="row in providerRows"
          :key="String(row.label)"
          class="flex justify-between gap-3"
        >
          <dt class="text-ink-muted">{{ row.label }}</dt>
          <dd class="truncate font-mono text-xs text-ink-secondary">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-if="systemInfo?.modelProvider.error" class="mt-2 text-xs text-destructive">
        {{ systemInfo.modelProvider.error }}
      </p>
    </div>

    <div class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-shared-login">
      <div class="mb-2 text-sm font-medium">{{ t("app.adminSharedLoginTitle") }}</div>
      <p v-if="systemInfo?.modelProvider.mode === 'custom'" class="mb-2 text-xs text-ink-muted">
        {{ t("app.adminSharedLoginNotNeeded") }}
      </p>

      <template v-if="sharedLoginStatus">
        <div v-if="sharedLoginStatus.auth.present" class="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{{ t("app.adminSharedLoginPresent") }}</Badge>
          <span class="text-ink-secondary">{{ sharedLoginStatus.auth.accountEmail ?? "—" }}</span>
          <span class="text-xs text-ink-faint">{{ sharedLoginStatus.auth.lastRefresh ?? "" }}</span>
        </div>

        <div v-if="sharedLoginStatus.status === 'idle'" class="mt-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="sharedLoginBusy || !sharedLoginStatus.enabled"
            data-testid="admin-shared-login-start"
            @click="startSharedLogin"
          >
            {{ t("app.adminSharedLoginStart") }}
          </Button>
        </div>

        <div
          v-else-if="sharedLoginStatus.status === 'starting'"
          class="mt-2 flex items-center gap-2 text-sm text-ink-secondary"
        >
          <Loader2Icon class="size-4 animate-spin" />
          {{ t("app.adminSharedLoginStarting") }}
        </div>

        <div v-else-if="sharedLoginStatus.status === 'pending'" class="mt-2 space-y-3">
          <a
            :href="sharedLoginStatus.url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
            data-testid="admin-shared-login-url"
          >
            {{ sharedLoginStatus.url }}
            <ExternalLinkIcon class="size-3.5" />
          </a>
          <div class="flex items-center gap-3">
            <span
              class="rounded-lg border border-hairline bg-canvas-soft px-4 py-2 font-mono text-2xl tracking-widest"
              data-testid="admin-shared-login-code"
              >{{ sharedLoginStatus.code }}</span
            >
            <Button variant="outline" size="sm" @click="copyCode">
              <CopyIcon class="size-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            :disabled="sharedLoginBusy"
            data-testid="admin-shared-login-cancel"
            @click="cancelSharedLogin"
          >
            {{ t("app.adminSharedLoginCancel") }}
          </Button>
        </div>

        <div
          v-else-if="sharedLoginStatus.status === 'success'"
          class="mt-2 text-sm text-accent-green"
        >
          {{ t("app.adminSharedLoginSuccess") }}
          {{ sharedLoginStatus.accountEmail ?? "" }}
        </div>

        <div v-else-if="sharedLoginStatus.status === 'error'" class="mt-2 space-y-2">
          <p class="text-sm text-destructive" data-testid="admin-shared-login-error">
            {{ sharedLoginStatus.message }}
          </p>
          <Button variant="outline" size="sm" :disabled="sharedLoginBusy" @click="startSharedLogin">
            {{ t("app.adminSharedLoginRetry") }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
