<script setup lang="ts">
import { storeToRefs } from "pinia";
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from "@lucide/vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { Switch } from "@codex-gateway/ui/switch";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayAdminStore } from "@/stores/gateway-admin";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";
import AdminBackupsCard from "./AdminBackupsCard.vue";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const { systemInfo, sharedLoginStatus, lockouts } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));
const sharedLoginBusy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Provider edit form — apiKey stays write-only; an empty field keeps the stored secret.
const providerForm = ref({
  mode: "openai" as "openai" | "custom",
  id: "",
  name: "",
  baseUrl: "",
  apiKey: "",
  wireApi: "responses",
  model: "",
  webSearch: false,
});
const providerSaving = ref(false);
const providerInitialized = ref(false);
const restartBusy = ref(false);

const securityForm = ref({
  loginMaxFailures: 5,
  lockoutMinutes: 15,
  sessionDays: 30,
  allowSelfPasswordChange: true,
});
const securitySaving = ref(false);
const securityInitialized = ref(false);

const notificationsForm = ref({ barkServerUrl: "" });
const notificationsSaving = ref(false);
const notificationsInitialized = ref(false);

// Custom providers disable web search by default; switching modes re-derives the toggle.
watch(
  () => providerForm.value.mode,
  (mode) => {
    providerForm.value.webSearch = mode === "custom";
  },
);

const auditRetentionDays = ref(180);
const auditRetentionInitialized = ref(false);

watch(
  () => systemInfo.value,
  (info) => {
    if (!info) return;
    if (!providerInitialized.value) {
      const m = info.modelProvider;
      providerForm.value = {
        mode: m.mode === "custom" ? "custom" : "openai",
        id: m.id,
        name: m.displayName,
        baseUrl: m.baseUrl ?? "",
        apiKey: "",
        wireApi: m.wireApi,
        model: m.model ?? "",
        webSearch: m.webSearch === "disabled",
      };
      providerInitialized.value = true;
    }
    if (!securityInitialized.value) {
      securityForm.value = { ...info.settings.security };
      securityInitialized.value = true;
    }
    if (!notificationsInitialized.value) {
      notificationsForm.value = { barkServerUrl: info.settings.notifications.barkServerUrl ?? "" };
      notificationsInitialized.value = true;
    }
    if (!auditRetentionInitialized.value) {
      auditRetentionDays.value = info.settings.audit.retentionDays;
      auditRetentionInitialized.value = true;
    }
  },
  { immediate: true },
);

async function saveProvider() {
  if (providerSaving.value) return;
  providerSaving.value = true;
  try {
    await admin.saveModelProvider({
      mode: providerForm.value.mode,
      id: providerForm.value.id.trim(),
      name: providerForm.value.name.trim(),
      baseUrl: providerForm.value.baseUrl.trim() === "" ? null : providerForm.value.baseUrl.trim(),
      ...(providerForm.value.apiKey === "" ? {} : { apiKey: providerForm.value.apiKey }),
      wireApi: providerForm.value.wireApi,
      model: providerForm.value.model.trim() === "" ? null : providerForm.value.model.trim(),
      webSearch: providerForm.value.webSearch ? "disabled" : null,
    });
    providerForm.value.apiKey = "";
    toast.success(t("app.adminProviderSavedRestartHint"));
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSettingsSaveFailed"), errorLabels.value));
  } finally {
    providerSaving.value = false;
  }
}

async function restartAll() {
  if (restartBusy.value) return;
  restartBusy.value = true;
  try {
    const result = await admin.restartAllContainers();
    toast.success(
      t("app.adminRestartAllDone", { restarted: result.restarted, failed: result.failures.length }),
    );
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminRestartAllFailed"), errorLabels.value));
  } finally {
    restartBusy.value = false;
  }
}

async function saveSecurity() {
  if (securitySaving.value) return;
  securitySaving.value = true;
  try {
    await admin.saveSecurity({ ...securityForm.value });
    toast.success(t("app.adminSettingsSaved"));
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSettingsSaveFailed"), errorLabels.value));
  } finally {
    securitySaving.value = false;
  }
}

async function saveAuditRetention() {
  try {
    await admin.saveAuditRetention(auditRetentionDays.value);
    toast.success(t("app.adminSettingsSaved"));
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSettingsSaveFailed"), errorLabels.value));
  }
}

async function saveNotifications() {
  if (notificationsSaving.value) return;
  notificationsSaving.value = true;
  try {
    await admin.saveNotifications({
      barkServerUrl:
        notificationsForm.value.barkServerUrl.trim() === ""
          ? null
          : notificationsForm.value.barkServerUrl.trim(),
    });
    toast.success(t("app.adminSettingsSaved"));
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSettingsSaveFailed"), errorLabels.value));
  } finally {
    notificationsSaving.value = false;
  }
}

async function refresh() {
  try {
    await Promise.all([admin.loadSystem(), admin.loadSharedLogin(), admin.loadLockouts()]);
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

async function unlock(key: string) {
  try {
    await admin.unlockLockout(key);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminSystemLoadFailed"), errorLabels.value));
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

const runtimeRows = computed(() => {
  const info = systemInfo.value;
  if (!info) return [];
  return [
    kv("app.adminVersion", info.runtime.version),
    kv("app.adminCfgPort", info.runtime.port),
    kv("app.adminCfgDbPath", info.paths.database),
    kv("app.adminCfgCodexVersion", info.runtime.supportedCodexVersion),
    kv("app.adminCfgNode", info.runtime.nodeVersion),
    kv("app.adminRuntimeWsPeers", info.runtime.websocketPeers),
    kv("app.adminRuntimeSsh", info.runtime.sshConnections),
    kv("app.adminRuntimeRpc", info.runtime.rpcSessions),
    kv("app.adminRuntimeEvents", info.runtime.gatewayEvents),
    kv(
      "app.adminRuntimeMemory",
      `${formatBytes(info.runtime.memory.heapUsedBytes)} / ${formatBytes(info.runtime.memory.rssBytes)}`,
    ),
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

      <div class="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2 lg:grid-cols-3">
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderMode") }}
          <Select v-model="providerForm.mode" data-testid="admin-provider-mode">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">openai</SelectItem>
              <SelectItem value="custom">custom</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderId") }}
          <Input v-model="providerForm.id" data-testid="admin-provider-id" />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderName") }}
          <Input v-model="providerForm.name" data-testid="admin-provider-name" />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderBaseUrl") }}
          <Input v-model="providerForm.baseUrl" data-testid="admin-provider-base-url" />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderKey") }}
          <Input
            v-model="providerForm.apiKey"
            type="password"
            :placeholder="
              systemInfo?.modelProvider.apiKeyConfigured
                ? `••••${systemInfo.modelProvider.apiKeyLast4 ?? ''}`
                : ''
            "
            autocomplete="off"
            data-testid="admin-provider-api-key"
          />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderWireApi") }}
          <Input v-model="providerForm.wireApi" data-testid="admin-provider-wire-api" />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminCfgProviderModel") }}
          <Input v-model="providerForm.model" data-testid="admin-provider-model" />
        </label>
        <label class="flex items-center gap-2 self-end text-xs text-ink-muted">
          <Switch v-model="providerForm.webSearch" data-testid="admin-provider-web-search" />
          {{ t("app.adminCfgProviderWebSearch") }}
        </label>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          :disabled="providerSaving"
          data-testid="admin-provider-save"
          @click="saveProvider"
        >
          {{ t("app.adminSettingsSave") }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="restartBusy"
          data-testid="admin-restart-all"
          @click="restartAll"
        >
          {{ t("app.adminRestartAllContainers") }}
        </Button>
        <span class="text-xs text-ink-muted">{{ t("app.adminProviderSavedRestartHint") }}</span>
      </div>
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

    <div class="rounded-lg border border-hairline bg-surface p-4" data-testid="admin-security-card">
      <div class="text-sm font-medium text-ink">{{ t("app.adminSecurity") }}</div>
      <div class="mt-1 text-xs text-ink-muted">{{ t("app.adminSecurityLockouts") }}</div>
      <ul v-if="lockouts.length" class="mt-3 space-y-2">
        <li
          v-for="entry in lockouts"
          :key="entry.key"
          class="flex items-center justify-between gap-3 text-sm"
          :data-testid="`admin-lockout-${entry.key}`"
        >
          <span class="font-mono text-ink-secondary">{{ entry.key }}</span>
          <span class="text-ink-muted">{{ entry.lockedUntil }}</span>
          <Button
            variant="outline"
            size="sm"
            :data-testid="`admin-unlock-${entry.key}`"
            @click="unlock(entry.key)"
          >
            {{ t("app.adminUnlock") }}
          </Button>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm text-ink-muted">{{ t("app.adminNoLockouts") }}</p>

      <div class="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminSecurityMaxFailures") }}
          <Input
            v-model.number="securityForm.loginMaxFailures"
            type="number"
            min="1"
            data-testid="admin-security-max-failures"
          />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminSecurityLockoutMinutes") }}
          <Input
            v-model.number="securityForm.lockoutMinutes"
            type="number"
            min="1"
            data-testid="admin-security-lockout-minutes"
          />
        </label>
        <label class="space-y-1 text-xs text-ink-muted">
          {{ t("app.adminSecuritySessionDays") }}
          <Input
            v-model.number="securityForm.sessionDays"
            type="number"
            min="1"
            data-testid="admin-security-session-days"
          />
        </label>
        <label class="flex items-center gap-2 self-end text-xs text-ink-muted">
          <Switch
            v-model="securityForm.allowSelfPasswordChange"
            data-testid="admin-security-self-password"
          />
          {{ t("app.adminSecuritySelfPassword") }}
        </label>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          :disabled="securitySaving"
          data-testid="admin-security-save"
          @click="saveSecurity"
        >
          {{ t("app.adminSettingsSave") }}
        </Button>
        <label class="flex items-center gap-2 text-xs text-ink-muted">
          {{ t("app.adminAuditRetentionDays") }}
          <Input
            v-model.number="auditRetentionDays"
            type="number"
            min="1"
            class="w-24"
            data-testid="admin-audit-retention"
          />
          <Button
            variant="outline"
            size="sm"
            data-testid="admin-audit-retention-save"
            @click="saveAuditRetention"
          >
            {{ t("app.adminSettingsSave") }}
          </Button>
        </label>
      </div>
    </div>

    <div
      class="rounded-lg border border-hairline bg-surface p-4"
      data-testid="admin-notifications-card"
    >
      <div class="text-sm font-medium">{{ t("app.adminNotificationsTitle") }}</div>
      <div class="mt-2 flex items-end gap-2">
        <label class="min-w-0 flex-1 space-y-1 text-xs text-ink-muted">
          {{ t("app.adminBarkServerUrl") }}
          <Input
            v-model="notificationsForm.barkServerUrl"
            placeholder="https://api.day.app"
            data-testid="admin-bark-server-url"
          />
        </label>
        <Button
          size="sm"
          :disabled="notificationsSaving"
          data-testid="admin-notifications-save"
          @click="saveNotifications"
        >
          {{ t("app.adminSettingsSave") }}
        </Button>
      </div>
      <p class="mt-1 text-xs text-ink-faint">{{ t("app.adminBarkServerHint") }}</p>
    </div>

    <AdminBackupsCard />
  </div>
</template>
