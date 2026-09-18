<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorPayload, gatewayErrorMessage } from "@/utils/gateway-error";

const auth = useAuthStore();
const { t, te } = useI18n();
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  if (newPassword.value !== confirmPassword.value) {
    error.value = t("app.passwordChangeMismatch");
    return;
  }
  loading.value = true;
  try {
    await gatewayApi("/api/auth/password", {
      method: "POST",
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    await auth.refreshProfile();
  } catch (caught: unknown) {
    const payload = gatewayErrorPayload(caught);
    error.value =
      payload.code !== undefined && te(`errors.${payload.code}`)
        ? t(`errors.${payload.code}`)
        : gatewayErrorMessage(caught, t("app.passwordChangeFailed"));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
    <form
      class="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-6 shadow-xl"
      data-testid="force-password-form"
      @submit.prevent="submit"
    >
      <div class="space-y-2">
        <h1 class="text-xl font-semibold text-ink">{{ t("app.forcePasswordTitle") }}</h1>
        <p class="text-sm leading-6 text-ink-muted">{{ t("app.forcePasswordDescription") }}</p>
      </div>
      <div class="mt-6 space-y-3">
        <Input
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          :placeholder="t('app.currentPassword')"
          data-testid="force-password-current"
        />
        <Input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="t('app.newPassword')"
          data-testid="force-password-new"
        />
        <Input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="t('app.confirmPassword')"
          data-testid="force-password-confirm"
        />
      </div>
      <div
        v-if="error"
        class="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
      </div>
      <Button
        type="submit"
        class="mt-5 w-full gap-2"
        :disabled="loading || newPassword.length < 8"
        data-testid="force-password-submit"
      >
        <Loader2Icon v-if="loading" class="size-4 animate-spin" />
        {{ t("app.forcePasswordSubmit") }}
      </Button>
    </form>
  </main>
</template>
