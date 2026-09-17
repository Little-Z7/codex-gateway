<script setup lang="ts">
import {
  ArrowLeftIcon,
  BoxesIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  ChartColumnIcon,
  ServerIcon,
  UsersIcon,
} from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import AdminOverviewPanel from "./AdminOverviewPanel.vue";
import AdminUsersPanel from "./users/AdminUsersPanel.vue";
import AdminUserDetailPanel from "./AdminUserDetailPanel.vue";
import AdminContainersPanel from "./AdminContainersPanel.vue";
import AdminSessionsPanel from "./AdminSessionsPanel.vue";
import AdminUsagePanel from "./AdminUsagePanel.vue";
import AdminSystemPanel from "./AdminSystemPanel.vue";
import { gatewayPath } from "@/utils/gateway-url";

const { t } = useI18n();

type AdminTab = "overview" | "users" | "containers" | "usage" | "sessions" | "system";
const tabs: { id: AdminTab; label: string; icon: Component }[] = [
  { id: "overview", label: "app.adminNavOverview", icon: LayoutDashboardIcon },
  { id: "users", label: "app.adminNavUsers", icon: UsersIcon },
  { id: "containers", label: "app.adminNavContainers", icon: BoxesIcon },
  { id: "usage", label: "app.adminNavUsage", icon: ChartColumnIcon },
  { id: "sessions", label: "app.adminNavSessions", icon: ScrollTextIcon },
  { id: "system", label: "app.adminNavSystem", icon: ServerIcon },
];

const activeTab = ref<AdminTab>("overview");
const detailUserId = ref<number | null>(null);

function readTabFromLocation(): AdminTab {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const user = params.get("user");
  detailUserId.value =
    user !== null && user !== "" && Number.isFinite(Number(user)) ? Number(user) : null;
  return tabs.some((item) => item.id === tab) ? (tab as AdminTab) : "overview";
}

function selectTab(tab: AdminTab) {
  activeTab.value = tab;
  detailUserId.value = null;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.delete("user");
  window.history.replaceState(null, "", url);
}

function openUser(userId: number) {
  detailUserId.value = userId;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "users");
  url.searchParams.set("user", String(userId));
  window.history.replaceState(null, "", url);
}

function closeUser() {
  detailUserId.value = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("user");
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
        <AdminUserDetailPanel
          v-else-if="activeTab === 'users' && detailUserId !== null"
          :user-id="detailUserId"
          @back="closeUser"
        />
        <AdminUsersPanel v-else-if="activeTab === 'users'" extended @open-user="openUser" />
        <AdminContainersPanel v-else-if="activeTab === 'containers'" />
        <AdminUsagePanel v-else-if="activeTab === 'usage'" />
        <AdminSessionsPanel v-else-if="activeTab === 'sessions'" />
        <AdminSystemPanel v-else-if="activeTab === 'system'" />
      </main>
    </div>
  </div>
</template>
