/**
 * Joins an app-relative path ("/api/...", "popout.html") with the configured app baseURL so code
 * that bypasses Nuxt's $fetch/router baseURL handling still lands under the Gateway prefix.
 */
export function gatewayPath(path: string) {
  const base = useRuntimeConfig().app.baseURL;
  return `${base}${path.replace(/^\/+/, "")}`;
}

export function isGatewayApiPath(source: string) {
  const base = useRuntimeConfig().app.baseURL;
  return source.startsWith(`${base}api/`);
}
