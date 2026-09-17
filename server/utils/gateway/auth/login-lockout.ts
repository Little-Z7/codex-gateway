import { trimmedOrFallback } from "~~/shared/utils/strings";

// In-memory only: a gateway restart clears the counters, which is accepted. Thresholds are env
// knobs today; C4 will move them to persisted settings without changing this API surface.
const maxFailures = Math.max(
  1,
  Number(trimmedOrFallback(process.env.CODEX_GATEWAY_LOGIN_MAX_FAILURES, "5")) || 5,
);
const lockoutMs =
  Math.max(
    1,
    Number(trimmedOrFallback(process.env.CODEX_GATEWAY_LOGIN_LOCKOUT_MINUTES, "15")) || 15,
  ) * 60_000;

type Entry = { failures: number; lockedUntil: number };

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry | null {
  const entry = entries.get(key);
  if (entry === undefined) return null;
  if (entry.lockedUntil !== 0 && entry.lockedUntil <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry;
}

export const loginLockout = {
  /** Seconds remaining on the lock for this key, or null when not locked. */
  lockedFor(key: string): number | null {
    const entry = entryFor(key);
    if (entry === null || entry.lockedUntil === 0) return null;
    return Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
  },

  recordFailure(key: string) {
    const now = Date.now();
    const existing = entryFor(key);
    const failures = (existing?.failures ?? 0) + 1;
    entries.set(key, {
      failures,
      lockedUntil: failures >= maxFailures ? now + lockoutMs : 0,
    });
  },

  reset(key: string) {
    entries.delete(key);
  },

  list() {
    const now = Date.now();
    return [...entries.entries()]
      .filter(([, entry]) => entry.lockedUntil > now)
      .map(([key, entry]) => ({
        key,
        lockedUntil: new Date(entry.lockedUntil).toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      }));
  },
};
