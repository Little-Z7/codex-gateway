<script setup lang="ts">
import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon, ShieldIcon } from "@lucide/vue";
import { computed } from "vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import { useAuthStore } from "@/stores/auth";
import { gatewayPath } from "@/utils/gateway-url";

const emit = defineEmits<{
  settings: [];
}>();

const auth = useAuthStore();
const { t } = useI18n();
const initial = computed(() => (auth.username.trim().charAt(0) || "?").toUpperCase());
const roleLabel = computed(() => (auth.isAdmin ? t("app.roleAdmin") : t("app.roleMember")));

async function logout() {
  await auth.logout();
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-testid="sidebar-user-menu"
        class="flex h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-canvas-soft"
      >
        <span
          class="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-medium text-primary"
        >
          {{ initial }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-ink">{{ auth.username }}</span>
          <span class="block truncate text-xs text-ink-faint">{{ roleLabel }}</span>
        </span>
        <ChevronsUpDownIcon class="size-4 shrink-0 text-ink-faint" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" class="w-52">
      <DropdownMenuItem data-testid="settings-toggle" @select="emit('settings')">
        <SettingsIcon class="mr-2 size-4" />
        {{ t("app.settings") }}
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="auth.isAdmin"
        data-testid="admin-console-entry"
        @select="navigateTo(gatewayPath('admin'))"
      >
        <ShieldIcon class="mr-2 size-4" />
        {{ t("app.adminConsole") }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="sidebar-logout" @select="logout">
        <LogOutIcon class="mr-2 size-4" />
        {{ t("app.logout") }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
