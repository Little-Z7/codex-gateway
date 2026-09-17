<script setup lang="ts">
import {
  ArrowLeftIcon,
  BoxesIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  ServerIcon,
  UsersIcon,
} from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import AdminOverviewPanel from "./AdminOverviewPanel.vue";
import AdminUsersPanel from "./users/AdminUsersPanel.vue";
import AdminContainersPanel from "./AdminContainersPanel.vue";
import AdminSessionsPanel from "./AdminSessionsPanel.vue";
import AdminSystemPanel from "./AdminSystemPanel.vue";
import { gatewayPath } from "@/utils/gateway-url";

const { t } = useI18n();

type AdminTab = "overview" | "users" | "containers" | "sessions" | "system";
const tabs: { id: AdminTab; label: string; icon: Component }[] = [
  { id: "overview", label: "app.adminNavOverview", icon: LayoutDashboardIcon },
  { id: "users", label: "app.adminNavUsers", icon: UsersIcon },
  { id: "containers", label: "app.adminNavContainers", icon: BoxesIcon },
  { id: "sessions", label: "app.adminNavSessions", icon: ScrollTextIcon },
  { id: "system", label: "app.adminNavSystem", icon: ServerIcon },
];

const activeTab = ref<AdminTab>("overview");

function readTabFromLocation(): AdminTab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tabs.some((item) => item.id === tab) ? (tab as AdminTab) : "overview";
}

function selectTab(tab: AdminTab) {
  activeTab.value = tab;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(null, "", url);
}

onMounted(() => {
  activeTab.value = readTabFromLocation();
});
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-canvas text-ink" data-testid="admin-console">
    <header class="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-3 md:px-6">
      <a :href="gatewayPath('')" data-testid="admin-back-to-workspace">
        <Button variant="ghost" size="sm" class="gap-2">
          <ArrowLeftIcon class="size-4" />
          {{ t("app.adminBackToWorkspace") }}
        </Button>
      </a>
      <h1 class="text-base font-semibold">{{ t("app.adminConsoleTitle") }}</h1>
    </header>

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        class="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline bg-canvas-soft p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-testid="`admin-nav-${tab.id}`"
          class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="
            activeTab === tab.id
              ? 'bg-accent font-medium text-ink'
              : 'text-ink-secondary hover:bg-accent/60'
          "
          @click="selectTab(tab.id)"
        >
          <component :is="tab.icon" class="size-4" />
          {{ t(tab.label) }}
        </button>
      </nav>

      <main class="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <AdminOverviewPanel v-if="activeTab === 'overview'" />
        <AdminUsersPanel v-else-if="activeTab === 'users'" extended />
        <AdminContainersPanel v-else-if="activeTab === 'containers'" />
        <AdminSessionsPanel v-else-if="activeTab === 'sessions'" />
        <AdminSystemPanel v-else-if="activeTab === 'system'" />
      </main>
    </div>
  </div>
</template>
