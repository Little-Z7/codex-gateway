import { defineEventHandler } from "h3";
import { authenticateEvent } from "../utils/gateway/auth/context";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/realtime",
  // First-run bootstrap; the admin-creation endpoint itself rejects calls once a user exists.
  "/api/setup/status",
  "/api/setup/admin",
]);

export default defineEventHandler((event) => {
  // h3 mounts middleware under app.baseURL (/gw/) and strips that prefix from event.path before
  // dispatch, so paths here are app-relative. Requests outside /gw/ are owned by the preview
  // proxy in the node-server entry and never reach this middleware.
  const path = event.path;
  if (!path.startsWith("/api/") || PUBLIC_API_PATHS.has(path)) {
    return;
  }
  authenticateEvent(event);
});
