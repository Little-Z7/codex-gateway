import { useLocalStorage } from "@vueuse/core";

// Browser-local UI preferences only; connection/config truth stays server-side.
export const protocolDebugEvents = useLocalStorage<boolean>(
  "codex-gateway-pref:protocol-debug-events",
  false,
);
