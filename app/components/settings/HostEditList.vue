<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ServerIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { HostRecord } from "~~/shared/types";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@codex-gateway/ui/collapsible";
import HostConnectionFields from "./host-connection/HostConnectionFields.vue";
import {
  hostConnectionFormFromRecord,
  hostConnectionPayload,
  type HostConnectionFormValue,
} from "./host-connection/form";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

const catalog = useGatewayCatalogStore();
const { hosts } = storeToRefs(catalog);
const { t, te } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t, te));
const expandedHostId = ref<number | null>(hosts.value[0]?.id ?? null);
const forms = ref<Record<number, HostConnectionFormValue>>({});
const savingHostId = ref<number | null>(null);
const saveErrors = ref<Record<number, string>>({});
const editableHosts = computed(() =>
  hosts.value.flatMap((host) => {
    const form = forms.value[host.id];
    return form ? [{ host, form }] : [];
  }),
);

watch(
  hosts,
  (nextHosts) => {
    for (const host of nextHosts) {
      if (!forms.value[host.id]) {
        forms.value[host.id] = hostConnectionFormFromRecord(host);
      }
    }
    for (const id of Object.keys(forms.value).map(Number)) {
      if (!nextHosts.some((host) => host.id === id)) {
        delete forms.value[id];
      }
    }
  },
  { immediate: true },
);

function toggleHost(hostId: number) {
  expandedHostId.value = expandedHostId.value === hostId ? null : hostId;
}

async function saveHost(host: HostRecord) {
  const form = forms.value[host.id];
  if (!form) return;
  savingHostId.value = host.id;
  saveErrors.value[host.id] = "";
  try {
    const updated = await catalog.updateHost(host.id, hostConnectionPayload(form));
    forms.value[host.id] = hostConnectionFormFromRecord(updated);
  } catch (error: unknown) {
    saveErrors.value[host.id] = messageFromError(error, t("app.saveHostFailed"), errorLabels.value);
  } finally {
    savingHostId.value = null;
  }
}
</script>

<template>
  <section class="space-y-2">
    <div class="text-sm font-medium text-ink-secondary">{{ t("app.editHosts") }}</div>
    <div
      v-if="!hosts.length"
      class="rounded-md border border-hairline bg-canvas-soft p-3 text-sm text-ink-secondary"
    >
      {{ t("app.noHosts") }}
    </div>
    <Collapsible
      v-for="entry in editableHosts"
      :key="entry.host.id"
      :open="expandedHostId === entry.host.id"
      class="rounded-md border border-hairline bg-surface"
    >
      <CollapsibleTrigger as-child>
        <Button
          variant="ghost"
          class="h-11 w-full justify-start gap-2 rounded-md px-3"
          @click="toggleHost(entry.host.id)"
        >
          <ChevronDownIcon
            v-if="expandedHostId === entry.host.id"
            class="size-4 shrink-0 text-ink-muted"
          />
          <ChevronRightIcon v-else class="size-4 shrink-0 text-ink-muted" />
          <ServerIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-sm">{{ entry.host.name }}</span>
            <span class="block truncate text-xs text-ink-muted">{{ entry.host.sshHost }}</span>
          </span>
          <Badge
            v-if="entry.host.managed"
            variant="secondary"
            class="shrink-0"
            :data-testid="`managed-badge-${entry.host.id}`"
          >
            {{ t("app.managedHost") }}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent class="space-y-3 border-t border-hairline p-3">
        <template v-if="entry.host.managed">
          <p class="text-xs text-ink-secondary">{{ t("app.managedHostReadonly") }}</p>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt class="text-ink-muted">{{ t("app.sshHost") }}</dt>
            <dd class="truncate">{{ entry.host.sshHost }}</dd>
            <dt v-if="entry.host.username" class="text-ink-muted">{{ t("app.user") }}</dt>
            <dd v-if="entry.host.username" class="truncate">{{ entry.host.username }}</dd>
            <dt v-if="entry.host.port" class="text-ink-muted">{{ t("app.port") }}</dt>
            <dd v-if="entry.host.port">{{ entry.host.port }}</dd>
          </dl>
        </template>
        <template v-else>
          <HostConnectionFields v-model="entry.form" />
          <div
            v-if="saveErrors[entry.host.id]"
            class="whitespace-pre-line rounded-md bg-destructive/10 p-2 text-xs text-destructive"
          >
            {{ saveErrors[entry.host.id] }}
          </div>
          <Button
            class="w-full"
            :disabled="savingHostId === entry.host.id || !entry.form.name || !entry.form.sshHost"
            @click="saveHost(entry.host)"
          >
            <CheckIcon class="size-4" />
            {{ t("app.saveHost") }}
          </Button>
        </template>
      </CollapsibleContent>
    </Collapsible>
  </section>
</template>
