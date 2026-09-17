import { gatewayDatabase } from "../storage/database";
import { recordFromUnknown } from "~~/shared/utils/records";

// gateway_settings rows cached in-process. Writes go through setSetting which refreshes the
// cache entry, so a read on the next line is always fresh within this Gateway process.
const cache = new Map<string, string>();

export function getSettingJson(key: string): Record<string, unknown> | null {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return recordFromUnknown(JSON.parse(cached));
  }
  const row = gatewayDatabase()
    .prepare("SELECT value_json AS value FROM gateway_settings WHERE key = ?")
    .get(key);
  const value = row === undefined ? null : String(Reflect.get(row, "value") ?? "");
  if (value !== null) cache.set(key, value);
  return value === null ? null : recordFromUnknown(JSON.parse(value));
}

export function setSettingJson(key: string, value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  gatewayDatabase()
    .prepare(
      `INSERT INTO gateway_settings (key, value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
    )
    .run(key, serialized);
  cache.set(key, serialized);
}
