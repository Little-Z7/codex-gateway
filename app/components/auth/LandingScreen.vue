<script setup lang="ts">
import {
  ActivityIcon,
  AppWindowIcon,
  FolderGit2Icon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import LanguageSwitcher from "@/components/common/LanguageSwitcher.vue";
import { gatewayPath } from "@/utils/gateway-url";

const { t } = useI18n();

const features = [
  {
    icon: ShieldCheckIcon,
    titleKey: "landing.featureCredentialsTitle",
    bodyKey: "landing.featureCredentialsBody",
  },
  {
    icon: ServerIcon,
    titleKey: "landing.featureHostsTitle",
    bodyKey: "landing.featureHostsBody",
  },
  {
    icon: FolderGit2Icon,
    titleKey: "landing.featureOfficialTitle",
    bodyKey: "landing.featureOfficialBody",
  },
  {
    icon: RefreshCwIcon,
    titleKey: "landing.featureShareTitle",
    bodyKey: "landing.featureShareBody",
  },
  {
    icon: AppWindowIcon,
    titleKey: "landing.featureRecoverTitle",
    bodyKey: "landing.featureRecoverBody",
  },
  {
    icon: ActivityIcon,
    titleKey: "landing.featureOpsTitle",
    bodyKey: "landing.featureOpsBody",
  },
] as const;
</script>

<template>
  <div class="min-h-dvh bg-canvas text-ink" data-testid="landing-page">
    <header class="sticky top-0 z-10 border-b border-hairline bg-canvas/90 backdrop-blur-sm">
      <div
        class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6"
      >
        <a :href="gatewayPath('')" class="text-sm font-semibold tracking-tight text-ink">
          Codex Gateway
        </a>
        <div class="flex items-center gap-2">
          <LanguageSwitcher />
          <Button as-child size="lg" class="h-8 px-3 text-sm">
            <a :href="gatewayPath('login')" data-testid="landing-nav-login">
              {{ t("landing.navLogin") }}
            </a>
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-12 sm:px-6 sm:py-16">
      <section class="max-w-3xl space-y-5">
        <p class="text-sm font-medium text-ink-muted">{{ t("landing.eyebrow") }}</p>
        <h1 class="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {{ t("landing.title") }}
        </h1>
        <p class="max-w-2xl text-base leading-7 text-ink-secondary">
          {{ t("landing.lead") }}
        </p>
        <div class="flex flex-wrap items-center gap-3 pt-1">
          <Button as-child size="lg" class="h-10 px-5 text-sm">
            <a :href="gatewayPath('login')" data-testid="landing-login">
              {{ t("landing.cta") }}
            </a>
          </Button>
          <p class="text-sm text-ink-muted">{{ t("landing.ctaHint") }}</p>
        </div>
      </section>

      <section class="space-y-6">
        <h2 class="text-lg font-semibold text-ink">{{ t("landing.featuresTitle") }}</h2>
        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="feature in features"
            :key="feature.titleKey"
            class="rounded-2xl border border-hairline bg-surface p-5 shadow-sm"
          >
            <component :is="feature.icon" class="size-5 text-ink-secondary" />
            <h3 class="mt-3 text-sm font-semibold text-ink">{{ t(feature.titleKey) }}</h3>
            <p class="mt-2 text-sm leading-6 text-ink-muted">{{ t(feature.bodyKey) }}</p>
          </li>
        </ul>
      </section>

      <section class="space-y-6">
        <h2 class="text-lg font-semibold text-ink">{{ t("landing.howTitle") }}</h2>
        <ol class="grid gap-4 sm:grid-cols-3">
          <li class="rounded-2xl border border-hairline bg-canvas-soft p-5">
            <p class="text-xs font-medium text-ink-faint">1</p>
            <h3 class="mt-2 text-sm font-semibold text-ink">{{ t("landing.how1Title") }}</h3>
            <p class="mt-2 text-sm leading-6 text-ink-muted">{{ t("landing.how1Body") }}</p>
          </li>
          <li class="rounded-2xl border border-hairline bg-canvas-soft p-5">
            <p class="text-xs font-medium text-ink-faint">2</p>
            <h3 class="mt-2 text-sm font-semibold text-ink">{{ t("landing.how2Title") }}</h3>
            <p class="mt-2 text-sm leading-6 text-ink-muted">{{ t("landing.how2Body") }}</p>
          </li>
          <li class="rounded-2xl border border-hairline bg-canvas-soft p-5">
            <p class="text-xs font-medium text-ink-faint">3</p>
            <h3 class="mt-2 text-sm font-semibold text-ink">{{ t("landing.how3Title") }}</h3>
            <p class="mt-2 text-sm leading-6 text-ink-muted">{{ t("landing.how3Body") }}</p>
          </li>
        </ol>
      </section>
    </main>

    <footer class="border-t border-hairline">
      <div class="mx-auto flex w-full max-w-5xl px-4 py-6 sm:px-6">
        <p class="text-sm text-ink-muted">{{ t("landing.footer") }}</p>
      </div>
    </footer>
  </div>
</template>
