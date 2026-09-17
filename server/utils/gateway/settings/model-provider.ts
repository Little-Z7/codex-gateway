import { getSettingJson, setSettingJson } from "./settings";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { stringFromUnknown } from "~~/shared/utils/records";

import type { ModelProviderConfig, ModelProviderMode } from "../provisioning/provisioning-config";

function numberSetting(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

const KEY = "modelProvider";

export interface StoredModelProvider {
  mode: ModelProviderMode;
  id: string;
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  wireApi: string;
  model: string | null;
  webSearch: "disabled" | null;
}

export function storedModelProvider(): StoredModelProvider | null {
  const stored = getSettingJson(KEY);
  if (stored === null) return null;
  const mode = stringFromUnknown(stored.mode) === "custom" ? "custom" : "openai";
  return {
    mode,
    id: trimmedOrNull(stringFromUnknown(stored.id)) ?? "ollama-cloud",
    name: trimmedOrNull(stringFromUnknown(stored.name)) ?? "",
    baseUrl: trimmedOrNull(stringFromUnknown(stored.baseUrl)),
    apiKey: trimmedOrNull(stringFromUnknown(stored.apiKey)),
    wireApi: trimmedOrNull(stringFromUnknown(stored.wireApi)) ?? "responses",
    model: trimmedOrNull(stringFromUnknown(stored.model)),
    webSearch: stringFromUnknown(stored.webSearch) === "disabled" ? "disabled" : null,
  };
}

export function saveModelProvider(input: {
  mode: ModelProviderMode;
  id: string;
  name: string;
  baseUrl: string | null;
  apiKey?: string | null;
  wireApi: string;
  model: string | null;
  webSearch: "disabled" | null;
}) {
  // apiKey is write-only: when the field is absent the stored secret (if any) is kept.
  const previous = storedModelProvider();
  const apiKey =
    input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== ""
      ? input.apiKey
      : (previous?.apiKey ?? null);
  setSettingJson(KEY, {
    mode: input.mode,
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    apiKey,
    wireApi: input.wireApi,
    model: input.model,
    webSearch: input.webSearch,
  });
}

/** DB row wins over env; env wins over defaults. */
export function resolveModelProvider(envConfig: ModelProviderConfig): ModelProviderConfig {
  const stored = storedModelProvider();
  if (stored === null) return envConfig;
  const config: ModelProviderConfig = {
    mode: stored.mode,
    id: stored.id,
    displayName: stored.name !== "" ? stored.name : stored.id,
    baseUrl: stored.baseUrl,
    wireApi: stored.wireApi,
    apiKey: stored.apiKey ?? envConfig.apiKey,
    model: stored.model,
    webSearch: stored.webSearch,
    error: envConfig.error,
  };
  // Re-run the same custom-mode validation against the resolved values.
  if (config.mode === "custom") {
    config.error = null;
    if (!/^[a-z0-9_-]+$/.test(config.id)) {
      config.error = `provider id "${config.id}" must match [a-z0-9_-]+`;
    } else if (config.baseUrl === null) {
      config.error = "provider baseUrl is required for a custom provider";
    } else if (config.apiKey === null) {
      config.error = "provider apiKey is required for a custom provider";
    } else if (config.model === null) {
      config.error = "provider model is required for a custom provider";
    }
  } else {
    config.error = null;
    config.apiKey = null;
  }
  return config;
}

export interface SecuritySettings {
  loginMaxFailures: number;
  lockoutMinutes: number;
  sessionDays: number;
  allowSelfPasswordChange: boolean;
}

const SECURITY_KEY = "security";

export function securitySettings(): SecuritySettings {
  const stored = getSettingJson(SECURITY_KEY);
  const envMax = Number(process.env.CODEX_GATEWAY_LOGIN_MAX_FAILURES);
  const envLockout = Number(process.env.CODEX_GATEWAY_LOGIN_LOCKOUT_MINUTES);
  const loginMaxFailures = Math.max(
    1,
    numberSetting(stored?.loginMaxFailures) ?? (Number.isFinite(envMax) ? envMax : 5),
  );
  const lockoutMinutes = Math.max(
    1,
    numberSetting(stored?.lockoutMinutes) ?? (Number.isFinite(envLockout) ? envLockout : 15),
  );
  const sessionDays = Math.max(1, numberSetting(stored?.sessionDays) ?? 30);
  const allowSelfPasswordChange =
    typeof stored?.allowSelfPasswordChange === "boolean" ? stored.allowSelfPasswordChange : true;
  return { loginMaxFailures, lockoutMinutes, sessionDays, allowSelfPasswordChange };
}

export function saveSecuritySettings(input: Partial<SecuritySettings>) {
  const current = securitySettings();
  setSettingJson(SECURITY_KEY, { ...current, ...input });
}

const AUDIT_KEY = "audit";

export function auditSettings(): { retentionDays: number } {
  const stored = getSettingJson(AUDIT_KEY);
  return { retentionDays: Math.max(1, numberSetting(stored?.retentionDays) ?? 180) };
}

export function saveAuditRetentionDays(retentionDays: number) {
  setSettingJson(AUDIT_KEY, { retentionDays });
}

const NOTIFICATIONS_KEY = "notifications";

/** Global Bark server URL — used when a user left their own serverUrl unset. */
export function globalBarkServerUrl(): string | null {
  return trimmedOrNull(stringFromUnknown(getSettingJson(NOTIFICATIONS_KEY)?.barkServerUrl));
}

export function saveNotificationSettings(input: { barkServerUrl: string | null }) {
  setSettingJson(NOTIFICATIONS_KEY, { barkServerUrl: input.barkServerUrl });
}
