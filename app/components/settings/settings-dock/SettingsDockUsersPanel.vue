<script setup lang="ts">
import AdminUsersPanel from "@/components/admin/users/AdminUsersPanel.vue";
import { gatewayPath } from "@/utils/gateway-url";

const { t } = useI18n();
</script>

<template>
  <div class="h-full min-h-0 space-y-3 overflow-auto p-5">
    <AdminUsersPanel />
    <p class="text-xs text-ink-muted">
      <a :href="gatewayPath('admin')" class="text-primary underline underline-offset-4">{{
        t("app.adminConsoleLink")
      }}</a>
    </p>
  </div>
</template>
