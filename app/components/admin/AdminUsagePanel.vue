<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useCssVar } from "@vueuse/core";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@codex-gateway/ui/table";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayAdminStore, type AdminUsageRow } from "@/stores/gateway-admin";
import { useAuthStore } from "@/stores/auth";
import { messageFromError, errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

const { t, te } = useI18n();
const admin = useGatewayAdminStore();
const auth = useAuthStore();
const { usageRows } = storeToRefs(admin);
const errorLabels = computed(() => errorMessageLabels(t, te));

// Theme-aware palette: --chart-1..5 are recomputed on light/dark switch by useCssVar.
const chartRoot = ref<HTMLElement | null>(null);
const chartVars = [
  useCssVar("--chart-1", chartRoot),
  useCssVar("--chart-2", chartRoot),
  useCssVar("--chart-3", chartRoot),
  useCssVar("--chart-4", chartRoot),
  useCssVar("--chart-5", chartRoot),
];
const chartPalette = computed(() => {
  const colors = chartVars.map((v) => v.value).filter((v): v is string => !!v);
  return colors.length > 0 ? colors : undefined;
});
const inkMuted = useCssVar("--ink-muted", chartRoot);
const hairline = useCssVar("--hairline", chartRoot);
const axisStyle = computed(() => ({
  axisLabel: { color: inkMuted.value },
  axisLine: { lineStyle: { color: hairline.value } },
  splitLine: { lineStyle: { color: hairline.value } },
}));

const presets = [7, 30, 90] as const;
const presetDays = ref<number>(30);
const from = ref(isoDay(daysAgo(30)));
const to = ref(isoDay(new Date()));
const byUser = ref<AdminUsageRow[]>([]);
const byDay = ref<AdminUsageRow[]>([]);
const byModel = ref<AdminUsageRow[]>([]);
const loading = ref(false);

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}
function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function applyPreset(days: number) {
  presetDays.value = days;
  from.value = isoDay(daysAgo(days));
  to.value = isoDay(new Date());
  void refresh();
}

async function refresh() {
  loading.value = true;
  try {
    const range = { from: from.value, to: to.value };
    const [u, d, m] = await Promise.all([
      admin.loadUsage({ ...range, groupBy: "user" }),
      admin.loadUsage({ ...range, groupBy: "day" }),
      admin.loadUsage({ ...range, groupBy: "model" }),
    ]);
    byUser.value = u;
    byDay.value = d;
    byModel.value = m;
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminUsageLoadFailed"), errorLabels.value));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void refresh());

async function exportCsv() {
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value, groupBy: "user" });
    const blob = await $fetch<Blob>(`/api/admin/usage/export.csv?${params}`, {
      responseType: "blob",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "usage.csv";
    a.click();
    URL.revokeObjectURL(href);
  } catch (error) {
    toast.error(messageFromError(error, t("app.adminExportFailed"), errorLabels.value));
  }
}

const hasData = computed(
  () => byUser.value.length > 0 || byDay.value.length > 0 || byModel.value.length > 0,
);

const userChart = computed(() => ({
  animation: false,
  color: chartPalette.value,
  tooltip: { trigger: "axis" as const },
  grid: { left: "3%", right: "3%", top: 30, bottom: 20, containLabel: true },
  legend: { top: 0, textStyle: { color: inkMuted.value } },
  xAxis: {
    type: "category" as const,
    data: byUser.value.map((r) => r.label),
    ...axisStyle.value,
  },
  yAxis: { type: "value" as const, min: 0, ...axisStyle.value },
  series: [
    {
      name: t("app.adminUsageTurns"),
      type: "bar" as const,
      data: byUser.value.map((r) => r.turns),
    },
    {
      name: t("app.adminUsageTokens"),
      type: "bar" as const,
      data: byUser.value.map((r) => r.inputTokens + r.outputTokens),
    },
  ],
}));

const dayChart = computed(() => ({
  animation: false,
  color: chartPalette.value,
  tooltip: { trigger: "axis" as const },
  grid: { left: "3%", right: "7%", top: 30, bottom: 20, containLabel: true },
  legend: { top: 0, textStyle: { color: inkMuted.value } },
  xAxis: {
    type: "category" as const,
    data: byDay.value.map((r) => r.bucket),
    ...axisStyle.value,
  },
  yAxis: [
    {
      type: "value" as const,
      min: 0,
      name: t("app.adminUsageTurns"),
      nameTextStyle: { color: inkMuted.value },
      ...axisStyle.value,
    },
    {
      type: "value" as const,
      min: 0,
      name: t("app.adminUsageTokens"),
      nameTextStyle: { color: inkMuted.value },
      axisLabel: { color: inkMuted.value },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: t("app.adminUsageTurns"),
      type: "line" as const,
      data: byDay.value.map((r) => r.turns),
    },
    {
      name: t("app.adminUsageTokens"),
      type: "line" as const,
      yAxisIndex: 1,
      data: byDay.value.map((r) => r.inputTokens + r.outputTokens),
    },
  ],
}));

const modelChart = computed(() => ({
  animation: false,
  color: chartPalette.value,
  tooltip: { trigger: "item" as const },
  legend: { bottom: 0, textStyle: { color: inkMuted.value } },
  series: [
    {
      type: "pie" as const,
      radius: ["35%", "65%"],
      data: byModel.value.map((r) => ({
        name: r.bucket,
        value: r.inputTokens + r.outputTokens,
      })),
    },
  ],
}));
</script>

<template>
  <div ref="chartRoot" class="space-y-4" data-testid="admin-usage">
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex gap-1">
        <Button
          v-for="days in presets"
          :key="days"
          :variant="presetDays === days ? 'default' : 'outline'"
          size="sm"
          :data-testid="`admin-usage-preset-${days}`"
          @click="applyPreset(days)"
        >
          {{ t("app.adminUsagePresetDays", { days }) }}
        </Button>
      </div>
      <Input v-model="from" type="date" class="w-40" data-testid="admin-usage-from" />
      <Input v-model="to" type="date" class="w-40" data-testid="admin-usage-to" />
      <Button
        variant="outline"
        size="sm"
        :disabled="loading"
        data-testid="admin-usage-apply"
        @click="refresh"
      >
        {{ t("app.adminApplyFilter") }}
      </Button>
      <Button variant="outline" size="sm" data-testid="admin-usage-export" @click="exportCsv">
        {{ t("app.adminExportCsv") }}
      </Button>
    </div>

    <div
      v-if="!hasData && !loading"
      class="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-ink-muted"
      data-testid="admin-usage-empty"
    >
      {{ t("app.adminUsageEmpty") }}
    </div>

    <template v-else>
      <div class="grid gap-4 lg:grid-cols-3">
        <div class="rounded-lg border border-hairline bg-surface p-3">
          <div class="mb-1 text-sm font-medium">{{ t("app.adminUsageByUser") }}</div>
          <div class="h-56" data-testid="admin-usage-chart-user">
            <ClientOnly><VChart class="size-full" :option="userChart" autoresize /></ClientOnly>
          </div>
        </div>
        <div class="rounded-lg border border-hairline bg-surface p-3">
          <div class="mb-1 text-sm font-medium">{{ t("app.adminUsageByDay") }}</div>
          <div class="h-56" data-testid="admin-usage-chart-day">
            <ClientOnly><VChart class="size-full" :option="dayChart" autoresize /></ClientOnly>
          </div>
        </div>
        <div class="rounded-lg border border-hairline bg-surface p-3">
          <div class="mb-1 text-sm font-medium">{{ t("app.adminUsageByModel") }}</div>
          <div class="h-56" data-testid="admin-usage-chart-model">
            <ClientOnly><VChart class="size-full" :option="modelChart" autoresize /></ClientOnly>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-hairline bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t("app.adminUsageByUser") }}</TableHead>
              <TableHead>{{ t("app.adminUsageThreads") }}</TableHead>
              <TableHead>{{ t("app.adminUsageTurns") }}</TableHead>
              <TableHead>{{ t("app.adminUsageInputTokens") }}</TableHead>
              <TableHead>{{ t("app.adminUsageOutputTokens") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in byUser" :key="row.bucket">
              <TableCell class="font-medium">{{ row.label }}</TableCell>
              <TableCell>{{ row.threads }}</TableCell>
              <TableCell>{{ row.turns }}</TableCell>
              <TableCell>{{ row.inputTokens }}</TableCell>
              <TableCell>{{ row.outputTokens }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </template>
  </div>
</template>
