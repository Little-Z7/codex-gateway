import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { authenticatedFetch, openApp } from "./helpers/app";

async function apiStatus(page: Page, request: { url: string; method?: string; body?: unknown }) {
  return page.evaluate(async (request) => {
    const token = localStorage.getItem("codex-gateway-auth-token");
    const hasToken = token !== null && token !== "";
    const url = request.url.startsWith("/api/") ? `/gw${request.url}` : request.url;
    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        ...(hasToken ? { authorization: `Bearer ${token}` } : {}),
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    return { status: response.status, body: await response.text() };
  }, request);
}

async function openUsersTab(page: Page) {
  await page.getByTestId("settings-toggle").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByRole("tab", { name: /用户管理|User management/ }).click();
}

test("admin provisions a workspace container and the member uses it", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const memberName = `prov-${Date.now().toString(36)}`.slice(0, 32);
  const memberPassword = "prov-member-password-ok";

  await openApp(page);
  await openUsersTab(page);

  // Provisioning is enabled in the E2E topology: the status card and the create switch render.
  await expect(page.getByTestId("provisioning-status")).toBeVisible();

  await page.getByTestId("admin-create-user").click();
  await page.getByTestId("admin-user-username-input").fill(memberName);
  await page.getByTestId("admin-user-password-input").fill(memberPassword);
  await page.getByTestId("admin-user-create-submit").click();

  // Container creation runs in the background; the panel polls until it is ready.
  const row = page.getByTestId(`admin-user-row-${memberName}`);
  await expect(row).toBeVisible();
  const stateBadge = row.getByTestId(`container-state-${memberName}`);
  await expect(stateBadge).toBeVisible({ timeout: 30_000 });
  await expect(stateBadge).toContainText(/运行中|Running/, { timeout: 180_000 });
  await expect(row.getByText(/就绪|Ready/)).toBeVisible({ timeout: 30_000 });

  // The member sees exactly one managed host with the default workspace project.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await openApp(memberPage, {
    resetConfig: false,
    credentials: { username: memberName, password: memberPassword },
  });
  const hosts = await authenticatedFetch(memberPage, { url: "/api/hosts" }, (value) =>
    z
      .array(z.object({ id: z.number(), managed: z.boolean(), name: z.string() }).loose())
      .parse(value),
  );
  expect(hosts).toHaveLength(1);
  expect(hosts[0]!.managed).toBe(true);
  const managedHostId = hosts[0]!.id;

  await memberPage.getByTestId("settings-toggle").click();
  await memberPage.getByRole("tab", { name: /主机|Hosts/ }).click();
  await expect(memberPage.locator(`[data-testid^="managed-badge-"]`)).toBeVisible();
  await memberPage.keyboard.press("Escape");

  // The workspace project exists and the container config got the file-based auth store and
  // the full-access sandbox entrypoint defaults.
  const projects = await authenticatedFetch(memberPage, { url: "/api/projects" }, (value) =>
    z.array(z.object({ name: z.string(), remotePath: z.string() }).loose()).parse(value),
  );
  expect(projects).toEqual([
    expect.objectContaining({ name: "workspace", remotePath: "/home/dev/workspace" }),
  ]);

  const configToml = await apiStatus(memberPage, {
    url: `/api/remote/files?hostId=${managedHostId}&path=/home/dev/.codex/config.toml`,
  });
  expect(configToml.status).toBe(200);
  expect(configToml.body).toContain('cli_auth_credentials_store = "file"');
  expect(configToml.body).toContain('sandbox_mode = "danger-full-access"');

  // SSH + app-server inside the user container respond; an empty thread list is acceptable
  // without a shared Codex login.
  const threads = await apiStatus(memberPage, {
    url: `/api/threads?hostId=${managedHostId}&limit=50`,
  });
  expect(threads.status).toBe(200);

  // Container lifecycle: stop then start again through the admin UI (the users panel is still
  // open from the earlier steps).
  const memberRow = page.getByTestId(`admin-user-row-${memberName}`);
  await memberRow.getByTestId(`admin-container-toggle-${memberName}`).click();
  await expect(stateBadge).toContainText(/已停止|Exited/, { timeout: 30_000 });
  await memberRow.getByTestId(`admin-container-toggle-${memberName}`).click();
  await expect(stateBadge).toContainText(/运行中|Running/, { timeout: 60_000 });

  // Deleting the user removes the row and, with keepVolume off, the container and volume.
  await memberRow.getByTestId(`admin-delete-user-${memberName}`).click();
  await page.getByTestId("admin-delete-confirm").click();
  await expect(memberRow).toBeHidden();

  const members = await apiStatus(page, { url: "/api/admin/users" });
  expect(members.body).not.toContain(`"${memberName}"`);
  await memberContext.close();
});
