<script setup lang="ts">
import { Badge } from "@codex-gateway/ui/badge";
import type { ProvisioningDiagnostics } from "@/stores/gateway-admin";

const props = defineProps<{ provisioning: ProvisioningDiagnostics | null }>();
const { t } = useI18n();

const provisioningHints = computed(() => {
  const info = props.provisioning;
  if (!info?.enabled) {
    return [];
  }
  const hints: string[] = [];
  if (!info.dockerReachable) {
    hints.push(t("app.provisioningHintDocker"));
  }
  if (info.dockerReachable && !info.imagePresent) {
    hints.push(t("app.provisioningHintImage", { image: info.image }));
  }
  if (info.dockerReachable && !info.networkPresent) {
    hints.push(t("app.provisioningHintNetwork", { network: info.network ?? "" }));
  }
  if (!info.authFilePresent && info.modelProvider?.mode !== "custom") {
    hints.push(t("app.provisioningHintAuth"));
  }
  if (info.modelProvider?.valid === false && info.modelProvider.error) {
    hints.push(info.modelProvider.error);
  }
  return hints;
});
</script>

<template>
  <div
    v-if="provisioning?.enabled"
    data-testid="provisioning-status"
    class="space-y-1 rounded-lg border border-hairline bg-surface p-3 text-sm"
  >
    <div class="flex flex-wrap items-center gap-2 text-ink-secondary">
      <span>{{ t("app.provisioningImage") }}: {{ provisioning.image }}</span>
      <Badge :variant="provisioning.imagePresent ? 'secondary' : 'destructive'">
        {{ provisioning.imagePresent ? t("app.provisioningReady") : t("app.provisioningMissing") }}
      </Badge>
      <span>{{ t("app.provisioningNetwork") }}: {{ provisioning.network ?? "—" }}</span>
      <Badge :variant="provisioning.networkPresent ? 'secondary' : 'destructive'">
        {{
          provisioning.networkPresent ? t("app.provisioningReady") : t("app.provisioningMissing")
        }}
      </Badge>
      <span>{{ t("app.provisioningSharedAuth") }}</span>
      <Badge :variant="provisioning.authFilePresent ? 'secondary' : 'destructive'">
        {{
          provisioning.authFilePresent ? t("app.provisioningReady") : t("app.provisioningMissing")
        }}
      </Badge>
      <span>Docker</span>
      <Badge :variant="provisioning.dockerReachable ? 'secondary' : 'destructive'">
        {{
          provisioning.dockerReachable ? t("app.provisioningReady") : t("app.provisioningMissing")
        }}
      </Badge>
      <span v-if="provisioning.modelProvider">
        {{ t("app.provisioningModelProvider") }}: {{ provisioning.modelProvider.mode
        }}<template v-if="provisioning.modelProvider.mode === 'custom'"
          >/{{ provisioning.modelProvider.model ?? provisioning.modelProvider.id }}</template
        >
      </span>
      <Badge
        v-if="provisioning.modelProvider"
        :variant="provisioning.modelProvider.valid ? 'secondary' : 'destructive'"
      >
        {{
          provisioning.modelProvider.valid
            ? t("app.provisioningReady")
            : t("app.provisioningMissing")
        }}
      </Badge>
    </div>
    <p v-for="hint in provisioningHints" :key="hint" class="text-xs text-ink-muted">
      {{ hint }}
    </p>
    <p v-if="provisioning.error" class="text-xs text-destructive">{{ provisioning.error }}</p>
  </div>
</template>
