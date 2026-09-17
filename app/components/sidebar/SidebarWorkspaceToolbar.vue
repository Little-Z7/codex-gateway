<script setup lang="ts">
import { ActivityIcon, ChartNoAxesCombinedIcon, GlobeIcon, TerminalIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { SidebarTrigger } from "@codex-gateway/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@codex-gateway/ui/tooltip";

defineProps<{ title: string; canLaunch: boolean; tmuxActiveCount: number }>();
const emit = defineEmits<{
  openTerminal: [];
  openBrowser: [];
  openTmux: [];
  openHostMonitor: [];
}>();
</script>

<template>
  <div class="flex h-11 shrink-0 items-center gap-1 border-b border-hairline px-3">
    <span class="min-w-0 flex-1 truncate text-sm font-semibold" :title="title">{{ title }}</span>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            data-testid="open-tmux-button"
            variant="ghost"
            class="relative size-8 shrink-0"
            :disabled="!canLaunch"
            :aria-label="$t('app.openTmuxMonitor')"
            @click="emit('openTmux')"
          >
            <ActivityIcon class="size-4" />
            <span
              v-if="tmuxActiveCount"
              class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-4 text-primary-foreground"
            >
              {{ tmuxActiveCount }}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t("app.openTmuxMonitor") }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            data-testid="open-host-monitor-button"
            variant="ghost"
            class="size-8 shrink-0"
            :disabled="!canLaunch"
            :aria-label="$t('app.openHostMonitor')"
            @click="emit('openHostMonitor')"
          >
            <ChartNoAxesCombinedIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t("app.openHostMonitor") }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            data-testid="open-terminal-button"
            variant="ghost"
            class="size-8 shrink-0"
            :disabled="!canLaunch"
            :aria-label="$t('app.openTerminal')"
            @click="emit('openTerminal')"
          >
            <TerminalIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t("app.openTerminal") }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            data-testid="open-browser-button"
            variant="ghost"
            class="size-8 shrink-0"
            :disabled="!canLaunch"
            :aria-label="$t('app.openBrowser')"
            @click="emit('openBrowser')"
          >
            <GlobeIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t("app.openBrowser") }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <SidebarTrigger
            data-testid="desktop-sidebar-collapse"
            class="size-8 shrink-0"
            :aria-label="$t('app.hideSidebar')"
          />
        </TooltipTrigger>
        <TooltipContent>{{ $t("app.hideSidebar") }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
