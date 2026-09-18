export interface GatewayRouteSelection {
  hostId: number | null;
  projectId: number | null;
  threadId: string | null;
  /** `?new=1` marks the ChatGPT-style draft composer: no thread exists until the first send. */
  draft: boolean;
}

function numberFromQuery(value: string | null) {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringFromQuery(value: string | null) {
  return trimmedOrNull(value);
}

export function readGatewayRouteSelection(): GatewayRouteSelection {
  if (!import.meta.client) {
    return { hostId: null, projectId: null, threadId: null, draft: false };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    hostId: numberFromQuery(params.get("hostId")),
    projectId: numberFromQuery(params.get("projectId")),
    threadId: stringFromQuery(params.get("threadId")),
    draft: params.get("new") === "1",
  };
}

export function hasGatewayRouteSelection(selection = readGatewayRouteSelection()) {
  return (
    selection.hostId !== null ||
    selection.projectId !== null ||
    selection.threadId !== null ||
    selection.draft
  );
}

export function writeGatewayRouteSelection(
  selection: Partial<GatewayRouteSelection>,
  options: { replace?: boolean } = { replace: true },
) {
  if (!import.meta.client) {
    return;
  }

  const url = new URL(window.location.href);
  setRouteParam(url, "hostId", selection.hostId);
  setRouteParam(url, "projectId", selection.projectId);
  setRouteParam(url, "threadId", selection.threadId);
  setRouteParam(url, "new", selection.draft === true ? "1" : null);

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) {
    return;
  }

  const method = options.replace === false ? "pushState" : "replaceState";
  window.history[method](window.history.state, "", nextUrl);
}

function setRouteParam(url: URL, key: string, value: string | number | null | undefined) {
  if (value == null || value === "") {
    url.searchParams.delete(key);
    return;
  }
  url.searchParams.set(key, String(value));
}
import { trimmedOrNull } from "~~/shared/utils/strings";
