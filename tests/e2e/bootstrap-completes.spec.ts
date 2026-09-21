import { expect, test, type Page } from "@playwright/test";
import {
  E2E_MEMBER_PASSWORD,
  E2E_MEMBER_USERNAME,
  E2E_PASSWORD,
  E2E_USERNAME,
  openApp,
} from "./helpers/app";

// Regression guard for the "永远显示「正在加载远端会话」" class of bug: a synchronous exception
// thrown while resetGatewayClientSession() instantiates stores (e.g. calling useI18n() inside a
// Pinia store) aborts bootstrap before refreshGatewayClient() runs, so `initializing` is never
// reset and the app-ready marker never re-attaches. lint/typecheck cannot catch this because
// useI18n is a Nuxt auto-import with no import statement to restrict, so the E2E has to.
const IGNORED_NOISE = [/dockview/i, /enterprise/i];
const BOOTSTRAP_FAILURE_SIGNATURES = [
  /SyntaxError/,
  /MUST_BE_CALL_SETUP_TOP/,
  /useI18n/,
  /TypeError/,
  /ReferenceError/,
];

function trackBootstrapFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (BOOTSTRAP_FAILURE_SIGNATURES.some((signature) => signature.test(text))) {
      failures.push(`console: ${text}`);
    }
  });
  return () => failures.filter((entry) => !IGNORED_NOISE.some((noise) => noise.test(entry)));
}

// A stuck bootstrap also never opens the realtime WebSocket, since resetGatewayClientSession()
// aborting means refreshGatewayClient() (which installs the connection) never runs. Register the
// listener before openApp() navigates so Playwright observes the socket from creation.
function trackRealtimeReady(page: Page) {
  let ready = false;
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/gw/api/realtime")) return;
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string" && frame.payload.includes('"type":"ready"')) {
        ready = true;
      }
    });
  });
  return () => ready;
}

const accounts = [
  ["admin", { username: E2E_USERNAME, password: E2E_PASSWORD }],
  ["member", { username: E2E_MEMBER_USERNAME, password: E2E_MEMBER_PASSWORD }],
] as const;

for (const [label, credentials] of accounts) {
  test(`bootstrap completes after ${label} login without a synchronous exception`, async ({
    page,
  }) => {
    const failures = trackBootstrapFailures(page);
    const realtimeReady = trackRealtimeReady(page);
    await openApp(page, { resetConfig: false, credentials });

    // While authenticated, app-ready is only rendered once `initializing` has been reset. A stuck
    // bootstrap leaves the spinner forever and never re-attaches this marker.
    await expect(page.getByTestId("app-ready")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByText("正在加载远端会话")).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(realtimeReady, { timeout: 30_000 }).toBe(true);
    expect(failures()).toEqual([]);
  });
}
