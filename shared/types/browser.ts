export interface BrowserPreviewTarget {
  hostId: number;
  projectId?: number | null;
  threadId?: string | null;
  panelId: string;
  targetUrl: string;
  allowInsecureTls?: boolean;
}

export interface BrowserPreviewSessionSnapshot extends BrowserPreviewTarget {
  sessionId: string;
  bootstrapUrl: string;
  status: "open" | "closed";
}

export type BrowserPreviewCloseReason = "replaced";

export interface BrowserPreviewResourceFailure {
  statusCode: number;
  method: string;
  path: string;
  destination: string;
  occurredAt: string;
}
