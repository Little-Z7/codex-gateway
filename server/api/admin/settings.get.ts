import { requireAdmin } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import {
  auditSettings,
  globalBarkServerUrl,
  securitySettings,
  storedModelProvider,
} from "../../utils/gateway/settings/model-provider";
import { provisioningConfig } from "../../utils/gateway/provisioning/provisioning-config";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const provider = provisioningConfig().modelProvider;
  const stored = storedModelProvider();
  return {
    modelProvider: {
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
      persisted: stored !== null,
    },
    security: securitySettings(),
    notifications: { barkServerUrl: globalBarkServerUrl() },
    audit: auditSettings(),
  };
});
