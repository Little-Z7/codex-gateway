import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { saveModelProvider } from "../../../utils/gateway/settings/model-provider";
import { provisioningConfig } from "../../../utils/gateway/provisioning/provisioning-config";

const bodySchema = z.object({
  mode: z.enum(["openai", "custom"]),
  id: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .max(64),
  name: z.string().max(64).default(""),
  baseUrl: z.string().nullable().default(null),
  apiKey: z.string().max(512).nullish(),
  wireApi: z.string().max(32).default("responses"),
  model: z.string().nullable().default(null),
  webSearch: z.enum(["disabled"]).nullable().default(null),
});

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  saveModelProvider(input);
  const provider = provisioningConfig().modelProvider;
  auditLog.record(admin, "settings.modelProvider.update", {
    type: "system",
    id: "modelProvider",
    label: "model provider",
  });
  return {
    provider: {
      mode: provider.mode,
      id: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      wireApi: provider.wireApi,
      model: provider.model,
      webSearch: provider.webSearch,
      apiKeyConfigured: provider.apiKey !== null,
      apiKeyLast4: provider.apiKey === null ? null : provider.apiKey.slice(-4),
      valid: provider.error === null,
      error: provider.error,
    },
  };
});
