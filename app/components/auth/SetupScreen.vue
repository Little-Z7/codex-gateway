<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { useAuthStore } from "@/stores/auth";
import { gatewayErrorPayload, gatewayErrorMessage } from "@/utils/gateway-error";

const auth = useAuthStore();
const { t, te } = useI18n();
const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await $fetch("/api/setup/admin", {
      method: "POST",
      body: { username: username.value, password: password.value },
    });
    await auth.login({ username: username.value, password: password.value });
  } catch (caught: unknown) {
    const payload = gatewayErrorPayload(caught);
    if (payload.code !== undefined && te(`errors.${payload.code}`)) {
      error.value = t(`errors.${payload.code}`);
    } else {
      error.value = gatewayErrorMessage(caught, t("app.setupFailed"));
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
    <form
      class="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-6 shadow-xl"
      data-testid="setup-form"
      @submit.prevent="submit"
    >
      <div class="space-y-2">
        <h1 class="text-xl font-semibold text-ink">{{ t("app.setupTitle") }}</h1>
        <p class="text-sm leading-6 text-ink-muted">{{ t("app.setupDescription") }}</p>
      </div>
      <div class="mt-6 space-y-3">
        <Input
          v-model="username"
          autocomplete="username"
          :placeholder="t('app.setupAdminUsername')"
          data-testid="setup-username"
        />
        <Input
          v-model="password"
          type="password"
          autocomplete="new-password"
          :placeholder="t('app.setupAdminPassword')"
          data-testid="setup-password"
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
        :disabled="loading"
        data-testid="setup-submit"
      >
        <Loader2Icon v-if="loading" class="size-4 animate-spin" />
        {{ t("app.setupSubmit") }}
      </Button>
    </form>
  </main>
</template>
