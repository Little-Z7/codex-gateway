import { randomBytes, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { browserPreviewEvents } from "./browser-preview-events";
import type { BrowserPreviewHttpAgent } from "./browser-preview-http-agent";
import type {
  BrowserPreviewSessionSnapshot,
  BrowserPreviewTarget,
  HostRecord,
} from "~~/shared/types";

const TICKET_TTL_MS = 60_000;

export interface BrowserPreviewSession {
  sessionId: string;
  ownerId: string;
  userId: number;
  host: HostRecord;
  target: URL;
  targetConfig: BrowserPreviewTarget;
  cookieToken: string;
  ticket: string;
  ticketExpiresAt: number;
  status: "open" | "closed";
  sockets: Set<Duplex>;
  agent: BrowserPreviewHttpAgent | null;
}

export class BrowserPreviewManager {
  private sessions = new Map<string, BrowserPreviewSession>();
  private sessionsByCookie = new Map<string, BrowserPreviewSession>();
  private tickets = new Map<string, BrowserPreviewSession>();

  open(ownerId: string, userId: number, host: HostRecord, input: BrowserPreviewTarget) {
    const target = normalizeTarget(input.targetUrl);
    const sessionId = randomUUID();
    const ticket = randomBytes(32).toString("base64url");
    const cookieToken = randomBytes(32).toString("base64url");
    const session: BrowserPreviewSession = {
      sessionId,
      ownerId,
      userId,
      host,
      target,
      targetConfig: { ...input, targetUrl: target.href },
      cookieToken,
      ticket,
      ticketExpiresAt: Date.now() + TICKET_TTL_MS,
      status: "open",
      sockets: new Set(),
      agent: null,
    };
    this.sessions.set(sessionId, session);
    this.tickets.set(ticket, session);
    return this.snapshot(session);
  }

  exchangeTicket(ticket: string, sessionId: string, cookieToken: string | undefined) {
    const session = this.tickets.get(ticket);
    if (session !== undefined) {
      this.tickets.delete(ticket);
      if (
        session.sessionId !== sessionId ||
        session.status !== "open" ||
        session.ticketExpiresAt < Date.now()
      ) {
        return null;
      }
      // A browser can only hold one preview cookie, so activating a session implicitly evicts the
      // previously active one for the same user. Sessions owned by other users are left alone:
      // their cookie simply stops resolving in this browser.
      const previous = this.resolve(cookieToken);
      if (previous !== null && previous.userId === session.userId && previous !== session) {
        this.closeSession(previous, { reason: "replaced" });
      }
      this.sessionsByCookie.set(session.cookieToken, session);
      return { cookieToken: session.cookieToken, path: initialPath(session.target) };
    }

    // Dockview may destroy and recreate an iframe while moving or restoring a panel. The iframe
    // then reloads its original bootstrap URL even though that one-time ticket was already
    // exchanged. Re-entry is allowed only when the browser presents the HttpOnly cookie issued by
    // the first exchange and all session coordinates still match. Do not make tickets reusable:
    // without the cookie, a consumed or expired ticket remains invalid.
    const cookieSession = this.resolve(cookieToken);
    if (
      cookieSession === null ||
      cookieSession.sessionId !== sessionId ||
      cookieSession.ticket !== ticket
    ) {
      return null;
    }
    return {
      cookieToken: cookieSession.cookieToken,
      path: initialPath(cookieSession.target),
    };
  }

  resolve(cookieToken: string | undefined) {
    if (cookieToken === undefined || cookieToken === "") return null;
    const session = this.sessionsByCookie.get(cookieToken);
    if (session === undefined || session.status !== "open") return null;
    return session;
  }

  setInsecureTls(userId: number, sessionId: string, allowInsecureTls: boolean) {
    const session = this.require(userId, sessionId);
    session.targetConfig.allowInsecureTls = allowInsecureTls;
    return this.snapshot(session);
  }

  trackSocket(session: BrowserPreviewSession, socket: Duplex) {
    session.sockets.add(socket);
    socket.once("close", () => session.sockets.delete(socket));
  }

  agentFor(
    session: BrowserPreviewSession,
    create: () => BrowserPreviewHttpAgent,
  ): BrowserPreviewHttpAgent {
    session.agent ??= create();
    return session.agent;
  }

  close(userId: number, sessionId: string) {
    this.closeSession(this.require(userId, sessionId));
  }

  closeOwner(ownerId: string) {
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId) this.closeSession(session);
    }
  }

  closeHost(userId: number, hostId: number) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.host.id === hostId) this.closeSession(session);
    }
  }

  private closeSession(session: BrowserPreviewSession, detail?: { reason: "replaced" }) {
    if (session.status === "closed") return;
    session.status = "closed";
    this.sessions.delete(session.sessionId);
    this.sessionsByCookie.delete(session.cookieToken);
    this.tickets.delete(session.ticket);
    session.agent?.destroy();
    session.agent = null;
    for (const socket of session.sockets) socket.destroy();
    session.sockets.clear();
    if (detail !== undefined) {
      browserPreviewEvents.publish({
        type: "session-closed",
        userId: session.userId,
        sessionId: session.sessionId,
        ownerId: session.ownerId,
        reason: detail.reason,
      });
    }
  }

  private require(userId: number, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.userId !== userId || session.status !== "open") {
      throw new Error("Browser preview session not found");
    }
    return session;
  }

  private snapshot(session: BrowserPreviewSession): BrowserPreviewSessionSnapshot {
    return {
      ...session.targetConfig,
      sessionId: session.sessionId,
      bootstrapUrl: `/_gateway/preview/bootstrap?sessionId=${encodeURIComponent(session.sessionId)}#${session.ticket}`,
      status: session.status,
    };
  }
}

export const browserPreviewManager = new BrowserPreviewManager();
export type ActiveBrowserPreviewSession = NonNullable<ReturnType<BrowserPreviewManager["resolve"]>>;

function normalizeTarget(value: string) {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const target = new URL(withProtocol);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Browser preview supports only HTTP and HTTPS URLs");
  }
  target.username = "";
  target.password = "";
  return target;
}

function initialPath(target: URL) {
  return `${target.pathname}${target.search}${target.hash}`;
}
