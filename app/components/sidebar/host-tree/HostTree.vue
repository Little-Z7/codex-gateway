<script setup lang="ts">
import { computed, toRef } from "vue";
import HostTreeNode from "./HostTreeNode.vue";
import HostTreeProjects from "./HostTreeProjects.vue";
import HostStatusIndicator from "./HostStatusIndicator.vue";
import { HOST_TREE_CONTROLLER, type HostTreeController } from "./controller";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ controller: HostTreeController }>();
provide(HOST_TREE_CONTROLLER, toRef(props, "controller"));

const { t } = useI18n();
const auth = useAuthStore();

// A member with exactly one managed workspace does not manage connections, so the host layer is
// collapsed away; its status survives as a small line above the project list. Admins keep the
// full tree even with a single managed host.
const flatHost = computed(() => {
  const hosts = props.controller.hosts;
  return !auth.isAdmin && hosts.length === 1 && hosts[0]?.managed === true ? hosts[0] : null;
});
const flatHostStatus = computed(() =>
  flatHost.value === null
    ? null
    : (props.controller.hostConnectionStatuses[flatHost.value.id]?.status ?? "idle"),
);
</script>

<template>
  <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <template v-if="flatHost !== null">
      <div class="flex items-center gap-1.5 px-2 pb-2 text-xs text-ink-muted">
        <HostStatusIndicator :status="flatHostStatus ?? 'idle'" />
        <span class="truncate">{{ flatHost.name }}</span>
      </div>
      <HostTreeProjects :host="flatHost" />
    </template>
    <template v-else>
      <div
        v-if="auth.isAdmin || controller.hosts.length > 0"
        class="px-2 pb-2 text-sm text-ink-muted"
      >
        {{ t("app.hosts") }}
      </div>
      <div class="min-w-0 space-y-1 overflow-hidden">
        <HostTreeNode v-for="host in controller.hosts" :key="host.id" :host="host" />
      </div>
    </template>
  </section>
</template>
