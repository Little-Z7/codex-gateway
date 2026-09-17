import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  authenticatedFetch,
  E2E_MEMBER_PASSWORD,
  E2E_MEMBER_USERNAME,
  openApp,
} from "./helpers/app";

const overviewSchema = z.object({ users: z.object({ total: z.number() }).loose() }).loose();

async function api<T>(page: Page, url: string, parse: (value: unknown) => T): Promise<T> {
  return authenticatedFetch(page, { url }, parse);
}

async function openConsole(page: Page) {
  await page.getByTestId("admin-console-entry").click();
  await expect(page).toHaveURL(/\/gw\/admin/, { timeout: 15_000 });
  await expect(page.getByTestId("admin-console")).toBeVisible({ timeout: 30_000 });
}

async function openConsoleTab(page: Page, tab: string) {
  await page.getByTestId(`admin-nav-${tab}`).click();
  await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
}

test("admin console exposes overview, users, sessions, audit and system", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await openApp(page);
  await openConsole(page);

  // Overview numbers match the API.
  const overview = await api(page, "/api/admin/overview", (value) => overviewSchema.parse(value));
  await expect(page.getByTestId("admin-overview")).toBeVisible();
  const cards = page.getByTestId("admin-overview").locator("div.rounded-lg").first();
  await expect(page.getByTestId("admin-overview")).toContainText(String(overview.users.total));
  await expect(page.getByTestId("admin-gateway-info")).toBeVisible();
  void cards;

  // Users tab: search finds the member.
  await openConsoleTab(page, "users");
  await page.getByTestId("admin-users-search").fill(E2E_MEMBER_USERNAME);
  await expect(page.getByTestId(`admin-user-row-${E2E_MEMBER_USERNAME}`)).toBeVisible();

  // Sessions tab: own session is marked current and cannot be revoked here.
  await openConsoleTab(page, "sessions");
  await expect(page.getByTestId("admin-sessions")).toBeVisible();
  await expect(page.getByTestId("admin-sessions").getByText(/当前|Current/)).toBeVisible();

  // A member login creates a revocable session.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await openApp(memberPage, {
      credentials: { username: E2E_MEMBER_USERNAME, password: E2E_MEMBER_PASSWORD },
    });
    // Remount the tab so the session list is reloaded after the member login.
    await page.getByTestId("admin-nav-overview").click();
    await page.getByTestId("admin-nav-sessions").click();
    const memberRow = page
      .getByTestId("admin-sessions")
      .locator("tr", { hasText: E2E_MEMBER_USERNAME })
      .first();
    await expect(memberRow).toBeVisible();
    const revokeButton = memberRow.locator(`button[data-testid^="admin-session-revoke-"]`);
    await revokeButton.click();

    // The revoked member can no longer call the API.
    const status = await memberPage.evaluate(async () => {
      const token = localStorage.getItem("codex-gateway-auth-token");
      const response = await fetch("/gw/api/hosts", {
        headers: { authorization: `Bearer ${token}` },
      });
      return response.status;
    });
    expect(status).toBe(401);

    // The revocation was audited.
    await page.getByTestId("admin-audit-filter-action").fill("session.revoke");
    await page.getByRole("button", { name: /筛选|Apply/ }).click();
    await expect(
      page.getByTestId("admin-sessions").getByText("session.revoke").first(),
    ).toBeVisible();
  } finally {
    await memberContext.close();
  }

  // Containers tab: numbers render when provisioned containers exist.
  await openConsoleTab(page, "containers");
  await expect(page.getByTestId("admin-containers")).toBeVisible();
  const rows = page.locator('tr[data-testid^="admin-container-row-"]');
  if ((await rows.count()) > 0) {
    const firstRow = rows.first();
    await expect(firstRow).toContainText(/\d/);
    await firstRow.locator('button[data-testid^="admin-container-logs-"]').click();
    await expect(page.getByTestId("admin-container-logs-dialog")).toBeVisible();
    await expect(page.getByTestId("admin-container-logs-body")).not.toBeEmpty();
    await page.keyboard.press("Escape");
  }

  // System tab shows the provider mode.
  await openConsoleTab(page, "system");
  await expect(page.getByTestId("admin-system")).toBeVisible();
  await expect(page.getByTestId("admin-provider-card")).toContainText(/openai|custom/);
});

test("non-admin users are redirected away from /gw/admin", async ({ page }) => {
  await openApp(page, {
    credentials: { username: E2E_MEMBER_USERNAME, password: E2E_MEMBER_PASSWORD },
  });
  await page.goto("/gw/admin", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/gw\/admin/, { timeout: 15_000 });
  await expect(
    page.getByTestId("desktop-layout").or(page.getByTestId("mobile-layout")),
  ).toBeVisible();
});
