import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { SUPPORTED_CODEX_VERSION } from "../../../utils/gateway/infra/codex/codex-version";

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  try {
    const response = await fetch("https://registry.npmjs.org/@openai/codex/latest", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
    const body = recordFromUnknown(await response.json()) ?? {};
    const version = stringFromUnknown(body.version);
    if (version === null) throw new Error("registry response had no version field");
    return { version, current: SUPPORTED_CODEX_VERSION, error: null };
  } catch (error) {
    return {
      version: null,
      current: SUPPORTED_CODEX_VERSION,
      error: error instanceof Error ? error.message : "version check failed",
    };
  }
});
