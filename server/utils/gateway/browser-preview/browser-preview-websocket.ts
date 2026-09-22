import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { browserPreviewManager, type BrowserPreviewSession } from "./browser-preview-manager";
import { readPreviewCookie } from "./browser-preview-proxy";
import { browserPreviewUpstreamConnector } from "./browser-preview-upstream-connector";
import {
  binaryFrame,
  BrowserPreviewWebSocketBridge,
  textFrame,
  type BrowserPreviewDownstream,
  type BrowserPreviewFrame,
} from "./browser-preview-websocket-bridge";

/**
 * Browser upgrades outside the Gateway UI prefix are preview traffic routed by cookie. `ws` owns
 * the HTTP upgrade handshake directly; the negotiated socket is then adapted to the small
 * downstream interface the bridge needs so the same backpressure logic works without crossws.
 */
const previewSockets = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => protocols.values().next().value ?? false,
});

export function handleBrowserPreviewUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const session = browserPreviewManager.resolve(readPreviewCookie(request.headers.cookie));
  if (session === null) {
    rejectUpgrade(socket);
    return;
  }
  previewSockets.handleUpgrade(request, socket, head, (ws) => {
    openBrowserPreviewSocket(session, request, ws);
  });
}

function openBrowserPreviewSocket(
  session: BrowserPreviewSession,
  request: IncomingMessage,
  ws: WebSocket,
) {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "preview.invalid"}`,
  );

  console.info("[browser-preview] websocket opening", {
    sessionId: session.sessionId,
    target: session.target.origin,
    path: requestUrl.pathname,
  });

  const protocols = (request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const downstream = new WsDownstream(ws);
  const bridge = new BrowserPreviewWebSocketBridge({
    downstream,
    connectUpstream: async () => {
      const upstream = await browserPreviewUpstreamConnector.openWebSocket(
        session,
        `${requestUrl.pathname}${requestUrl.search}`,
        protocols.length > 0 ? protocols : undefined,
        websocketHeaders(session.target.origin, request),
      );
      upstream.once("open", () => {
        console.info("[browser-preview] websocket upstream connected", {
          sessionId: session.sessionId,
        });
      });
      return upstream;
    },
    onBridgeError: (error) => {
      console.error("[browser-preview] websocket bridge failed", {
        sessionId: session.sessionId,
        message: error.message,
      });
    },
  });
  ws.on("message", (data: RawData, isBinary) => {
    const frame: BrowserPreviewFrame = isBinary ? binaryFrame(data) : textFrame(data);
    bridge.sendFromPeer(frame);
  });
  ws.on("close", () => bridge.closeFromPeer());
  ws.on("error", () => bridge.closeFromPeer());
  bridge.open();
}

function rejectUpgrade(socket: Duplex) {
  socket.write(
    "HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-type: text/plain\r\n\r\nBrowser preview session expired. Reopen the Browser panel.",
  );
  socket.destroy();
}

class WsDownstream implements BrowserPreviewDownstream {
  constructor(private readonly ws: WebSocket) {}

  get bufferedAmount() {
    return this.ws.bufferedAmount;
  }

  send(frame: BrowserPreviewFrame) {
    this.ws.send(frame);
  }

  close(code?: number, reason?: string) {
    this.ws.close(code, reason === undefined || reason === "" ? undefined : reason);
  }

  waitForDrain({ threshold, signal }: { threshold: number; signal: AbortSignal }) {
    // ws does not expose a public drain signal on the negotiated socket, so congestion waits poll
    // bufferedAmount; the bridge only calls this while the queue is already backing up.
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (signal.aborted || this.ws.readyState >= WebSocket.CLOSING) {
          cleanup();
          reject(new Error("Browser WebSocket drain aborted"));
          return;
        }
        if (this.ws.bufferedAmount <= threshold) {
          cleanup();
          resolve();
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Browser WebSocket drain aborted"));
      };
      const interval = setInterval(check, 20);
      const cleanup = () => {
        clearInterval(interval);
        this.ws.off("close", check);
        this.ws.off("error", check);
        signal.removeEventListener("abort", onAbort);
      };
      this.ws.on("close", check);
      this.ws.on("error", check);
      signal.addEventListener("abort", onAbort);
      check();
    });
  }
}

function websocketHeaders(targetOrigin: string, incoming: IncomingMessage) {
  const headers: Record<string, string> = {};
  const cookie = incoming.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .filter((value) => !/^(__Host-)?gateway-preview=/.test(value))
    .join("; ");
  if (cookie !== undefined && cookie !== "") headers.cookie = cookie;
  headers.origin = targetOrigin;
  const userAgent = incoming.headers["user-agent"];
  if (typeof userAgent === "string" && userAgent !== "") headers["user-agent"] = userAgent;
  return headers;
}
