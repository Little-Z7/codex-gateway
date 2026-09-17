import { requireAdmin } from "../../utils/gateway/auth/context";
import { provisioningConfig } from "../../utils/gateway/provisioning/provisioning-config";
import { provisioningDiagnostics } from "../../utils/gateway/provisioning/provisioning-diagnostics";
import { sharedAuthStatus } from "../../utils/gateway/provisioning/shared-login";
import { SUPPORTED_CODEX_VERSION } from "../../utils/gateway/infra/codex/codex-version";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { trimmedOrNull } from "~~/shared/utils/strings";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const config = provisioningConfig();
  const provider = config.modelProvider;
  return {
    provisioning: {
      enabled: config.enabled,
      userImage: config.userImage,
      dockerNetwork: config.dockerNetwork,
      dockerSocket:
        trimmedOrNull(process.env.CODEX_GATEWAY_DOCKER_SOCKET) ?? "/var/run/docker.sock",
      sharedAuthDir: config.sharedAuthDir,
      sharedAuthMount: config.sharedAuthMount,
      sharedDataDir: config.sharedDataDir,
      containerPrefix: config.containerPrefix,
      memory: config.memory,
      cpus: config.cpus,
      sandboxMode: config.sandboxMode,
      diagnostics: await provisioningDiagnostics(),
    },
    modelProvider: {
      mode: provider.mode,
      id: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      wireApi: provider.wireApi,
      model: provider.model,
      webSearch: provider.webSearch,
      apiKeyConfigured: provider.apiKey !== null,
      valid: provider.error === null,
      error: provider.error,
    },
    paths: {
      database: trimmedOrNull(process.env.CODEX_GATEWAY_DB_PATH) ?? "/data/codex-gateway.db",
    },
    runtime: {
      port: Number(trimmedOrNull(process.env.PORT) ?? 3000),
      nodeVersion: process.version,
      version: trimmedOrNull(process.env.CODEX_GATEWAY_VERSION) ?? "unknown",
      supportedCodexVersion: SUPPORTED_CODEX_VERSION,
    },
    sharedLogin: sharedAuthStatus(),
  };
});
