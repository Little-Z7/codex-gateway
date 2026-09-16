// Custom Nitro node-server entry. Same-origin browser previews share this listener: requests and
// WebSocket upgrades outside the Gateway UI prefix are routed by the preview cookie before Nitro
// sees them. Everything under the app baseURL goes to the normal Nitro pipeline.
import "#nitro-internal-pollyfills";
import { Server as HttpServer } from "node:http";
import { Server as HttpsServer } from "node:https";
import wsAdapter from "crossws/adapters/node";
import destr from "destr";
import { toNodeListener } from "h3";
import { useNitroApp, useRuntimeConfig } from "nitropack/runtime";
import {
  setupGracefulShutdown,
  startScheduleRunner,
  trapUnhandledNodeErrors,
} from "nitropack/runtime/internal";
import { handleBrowserPreviewRequest } from "../utils/gateway/browser-preview/browser-preview-proxy";
import { handleBrowserPreviewUpgrade } from "../utils/gateway/browser-preview/browser-preview-websocket";

const cert = process.env.NITRO_SSL_CERT;
const key = process.env.NITRO_SSL_KEY;
const nitroApp = useNitroApp();
const baseURL = (useRuntimeConfig().app.baseURL || "/").replace(/\/$/, "") || "/";

/** @param {string | undefined} url */
function isGatewayRequest(url) {
  if (url === undefined || url === "") return false;
  const pathname = url.startsWith("/") ? url : new URL(url, "http://gateway.invalid").pathname;
  return baseURL === "/" || pathname === baseURL || pathname.startsWith(`${baseURL}/`);
}

const nitroListener = toNodeListener(nitroApp.h3App);
/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
const requestListener = (req, res) => {
  if (isGatewayRequest(req.url)) {
    nitroListener(req, res);
    return;
  }
  void handleBrowserPreviewRequest(req, res);
};

const server =
  cert !== undefined && cert !== "" && key !== undefined && key !== ""
    ? new HttpsServer({ key, cert }, requestListener)
    : new HttpServer(requestListener);
const port = destr(process.env.NITRO_PORT || process.env.PORT) || 3000;
const host = process.env.NITRO_HOST || process.env.HOST;
const path = process.env.NITRO_UNIX_SOCKET;
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
const listener = server.listen(
  path !== undefined && path !== "" ? { path } : { port, host },
  () => {
    const protocol = cert !== undefined && cert !== "" && key !== undefined && key !== "" ? "https" : "http";
    const addressInfo = listener.address();
    if (addressInfo === null) return;
    if (typeof addressInfo === "string") {
      console.log(`Listening on unix socket ${addressInfo}`);
      return;
    }
    const url = `${protocol}://${
      addressInfo.family === "IPv6" ? `[${addressInfo.address}]` : addressInfo.address
    }:${addressInfo.port}${baseURL === "/" ? "" : baseURL}`;
    console.log(`Listening on ${url}`);
  },
);
trapUnhandledNodeErrors();
setupGracefulShutdown(listener, nitroApp);
if (import.meta._websocket === true) {
  const websocketOptions = nitroApp.h3App.websocket;
  const routerResolve = nitroApp.router?.handler?.__resolve__;
  if (typeof routerResolve === "function") {
    // h3's stack resolver returns the first matching non-root layer, so middleware mounted under
    // /gw/ (public assets, auth) would shadow /gw/api/* WebSocket routes and upgrades would
    // connect with no hooks. Resolve against the router directly so the real __websocket__
    // hooks of the matched route are used.
    websocketOptions.resolve = async (info) => {
      const url = info?.request?.url || info?.url || "/";
      const pathname = url.startsWith("/")
        ? url.split("?")[0]
        : new URL(url, "http://gateway.invalid").pathname;
      let appPath = pathname;
      if (baseURL !== "/") {
        if (pathname === baseURL) appPath = "/";
        else if (pathname.startsWith(`${baseURL}/`)) appPath = pathname.slice(baseURL.length);
      }
      const resolved = await routerResolve(appPath);
      return resolved?.handler?.__websocket__ ?? {};
    };
  }
  const { handleUpgrade } = wsAdapter(websocketOptions);
  server.on("upgrade", (req, socket, head) => {
    if (isGatewayRequest(req.url)) {
      void handleUpgrade(req, socket, head);
      return;
    }
    handleBrowserPreviewUpgrade(req, socket, head);
  });
}
if (import.meta._tasks === true) {
  startScheduleRunner();
}
export default {};
