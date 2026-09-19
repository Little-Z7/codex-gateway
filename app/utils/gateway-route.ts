/**
 * First path segment under the Gateway baseURL (`/gw/`).
 * `/gw/` and `/gw/landing` are the marketing landing; `/gw/login` is sign-in.
 */
export function gatewayRouteKey(pathname: string, baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  let path = pathname;
  if (base !== "" && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length);
  }
  return path.replace(/^\/+/, "").split(/[/?#]/)[0] ?? "";
}

export function isGatewayLandingRoute(pathname: string, baseURL: string): boolean {
  const key = gatewayRouteKey(pathname, baseURL);
  return key === "" || key === "landing";
}
