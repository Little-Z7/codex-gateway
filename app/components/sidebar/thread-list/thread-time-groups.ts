import type { GatewayThread } from "~~/shared/types";

function threadActivityAt(thread: GatewayThread) {
  return thread.recencyAt ?? thread.updatedAt ?? 0;
}

export type ThreadTimeBucket = "today" | "yesterday" | "last7" | "last30" | "earlier";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function threadTimeBucket(thread: GatewayThread): ThreadTimeBucket {
  const seconds = threadActivityAt(thread);
  if (seconds <= 0) return "earlier";
  const at = seconds * 1000;
  const today = startOfToday();
  if (at >= today) return "today";
  if (at >= today - DAY_MS) return "yesterday";
  if (at >= today - 7 * DAY_MS) return "last7";
  if (at >= today - 30 * DAY_MS) return "last30";
  return "earlier";
}

export const THREAD_TIME_BUCKETS: ThreadTimeBucket[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "earlier",
];

export function groupThreadsByTime(threads: GatewayThread[]) {
  const sorted = [...threads].sort((a, b) => threadActivityAt(b) - threadActivityAt(a));
  const groups = new Map<ThreadTimeBucket, GatewayThread[]>();
  for (const bucket of THREAD_TIME_BUCKETS) groups.set(bucket, []);
  for (const thread of sorted) groups.get(threadTimeBucket(thread))!.push(thread);
  return THREAD_TIME_BUCKETS.map((bucket) => ({
    bucket,
    threads: groups.get(bucket) ?? [],
  })).filter((group) => group.threads.length > 0);
}
