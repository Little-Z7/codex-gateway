<script setup lang="ts">
import { computed, ref } from "vue";
import { toast } from "@codex-gateway/ui/sonner";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorPayload, gatewayErrorMessage } from "@/utils/gateway-error";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

const auth = useAuthStore();
const { t, te } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t, te));
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const submitting = ref(false);

async function submit() {
  if (newPassword.value !== confirmPassword.value) {
    toast.error(t("app.passwordChangeMismatch"));
    return;
  }
  submitting.value = true;
  try {
    await gatewayApi("/api/auth/password", {
      method: "POST",
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    toast.success(t("app.passwordChanged"));
  } catch (error: unknown) {
    const payload = gatewayErrorPayload(error);
    toast.error(
      payload.code !== undefined && te(`errors.${payload.code}`)
        ? t(`errors.${payload.code}`)
        : messageFromError(error, t("app.passwordChangeFailed"), errorLabels.value),
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="max-w-md space-y-6" data-testid="account-settings">
    <div class="space-y-1">
      <div class="text-sm text-ink-muted">{{ t("app.accountUsername") }}</div>
      <div class="text-base font-medium text-ink">{{ auth.username }}</div>
      <div class="text-sm text-ink-muted">
        {{ auth.isAdmin ? t("app.roleAdmin") : t("app.roleUser") }}
      </div>
    </div>
    <form class="space-y-4" @submit.prevent="submit">
      <div class="text-sm font-medium text-ink">{{ t("app.changePassword") }}</div>
      <div class="space-y-2">
        <Label for="account-current-password">{{ t("app.currentPassword") }}</Label>
        <Input
          id="account-current-password"
          v-model="currentPassword"
          data-testid="account-current-password"
          type="password"
          autocomplete="current-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="account-new-password">{{ t("app.newPassword") }}</Label>
        <Input
          id="account-new-password"
          v-model="newPassword"
          data-testid="account-new-password"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="account-confirm-password">{{ t("app.confirmPassword") }}</Label>
        <Input
          id="account-confirm-password"
          v-model="confirmPassword"
          data-testid="account-confirm-password"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <Button
        type="submit"
        data-testid="account-password-submit"
        :disabled="submitting || !currentPassword || newPassword.length < 8"
      >
        {{ t("app.changePassword") }}
      </Button>
    </form>
  </section>
</template>
