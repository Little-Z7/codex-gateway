import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  authenticatedFetch,
  E2E_MEMBER_PASSWORD,
  E2E_MEMBER_USERNAME,
  openApp,
} from "./helpers/app";

const MEMBER = { username: E2E_MEMBER_USERNAME, password: E2E_MEMBER_PASSWORD };
const REMOTE_HOST = process.env.E2E_REMOTE_HOST ?? "ssh-target";
const REMOTE_PORT = process.env.E2E_REMOTE_PORT ?? "22";
const REMOTE_USERNAME = process.env.E2E_REMOTE_USERNAME ?? "codex";
const REMOTE_PASSWORD = process.env.E2E_REMOTE_PASSWORD ?? "codex";

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

async function openSettingsDialog(page: Page) {
  await page.getByTestId("settings-toggle").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
}

async function closeSettingsDialog(page: Page) {
  const panel = page.getByTestId("settings-panel");
  if (!(await panel.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

test("admin manages users and managed hosts end to end", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const workerName = `worker1-${suffix}`.slice(0, 32);
  const workerPassword = "worker1-password-ok";

  await openApp(page);

  // The admin sees the user-management tab and creates a member.
  await openUsersTab(page);
  await page.getByTestId("admin-create-user").click();
  // This spec manages hosts manually; container auto-provisioning would replace them.
  await page.getByTestId("admin-user-provision-switch").click();
  await page.getByTestId("admin-user-username-input").fill(workerName);
  await page.getByTestId("admin-user-password-input").fill(workerPassword);
  await page.getByTestId("admin-user-create-submit").click();
  await expect(page.getByTestId(`admin-user-row-${workerName}`)).toBeVisible();

  // Assign a managed host pointing at the real SSH test container, with no proxy.
  await page.getByTestId(`admin-managed-host-${workerName}`).click();
  const managedDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByTestId("admin-managed-host-submit") });
  await managedDialog.getByLabel(/名称|Name/).fill(`managed-${suffix}`);
  await managedDialog.getByLabel(/SSH 主机|SSH host/).fill(REMOTE_HOST);
  await managedDialog.getByLabel(/用户|User/).fill(REMOTE_USERNAME);
  await managedDialog.getByLabel(/端口|Port/).fill(REMOTE_PORT);
  await managedDialog.getByLabel(/SSH 代理|SSH proxy/).fill("");
  await managedDialog.getByLabel(/认证|Auth/).click();
  await page.getByRole("option", { name: /^密码$|^Password$/ }).click();
  await managedDialog.getByLabel(/^密码$|^Password$/).fill(REMOTE_PASSWORD);
  await page.getByTestId("admin-managed-host-submit").click();
  await expect(managedDialog).toBeHidden({ timeout: 15_000 });
  await expect(
    page.getByTestId(`admin-user-row-${workerName}`).getByText(/就绪|Ready/),
  ).toBeVisible();
  await closeSettingsDialog(page);

  // The member sees the managed host read-only and cannot mutate host config.
  const workerContext = await browser.newContext();
  const workerPage = await workerContext.newPage();
  await openApp(workerPage, {
    resetConfig: false,
    credentials: { username: workerName, password: workerPassword },
  });
  await openSettingsDialog(workerPage);
  await workerPage.getByRole("tab", { name: /主机|Hosts/ }).click();
  await expect(workerPage.getByTestId("add-host-button")).toBeHidden();
  await expect(workerPage.locator('[data-testid^="managed-badge-"]')).toBeVisible();
  await closeSettingsDialog(workerPage);

  const hosts = await authenticatedFetch(workerPage, { url: "/api/hosts" }, (value) =>
    z.array(z.object({ id: z.number(), managed: z.boolean() }).loose()).parse(value),
  );
  const managedHost = hosts.find((host) => host.managed);
  expect(managedHost, "managed host visible to member").toBeTruthy();

  expect(
    (
      await apiStatus(workerPage, {
        url: `/api/hosts/${managedHost!.id}`,
        method: "PATCH",
        body: { name: "x", sshHost: "x" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await apiStatus(workerPage, {
        url: "/api/hosts",
        method: "POST",
        body: { name: "x", sshHost: "x", authMode: "password", password: "x" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await apiStatus(workerPage, {
        url: "/api/config/sync",
        method: "POST",
        body: { version: 1, hosts: [], projects: [], pinnedThreads: [] },
      })
    ).status,
  ).toBe(400);

  // The managed host actually connects: the thread list goes over real SSH.
  const threads = await apiStatus(workerPage, {
    url: `/api/threads?hostId=${managedHost!.id}`,
  });
  expect(threads.status).toBe(200);

  // Export strips managed-host secrets; re-importing the export must not erase them.
  const exportedConfig = await authenticatedFetch(
    workerPage,
    { url: "/api/config/export" },
    (value) =>
      z
        .object({
          hosts: z.array(
            z
              .object({
                id: z.number(),
                managed: z.boolean(),
                password: z.string().nullable().optional(),
                privateKey: z.string().nullable().optional(),
              })
              .loose(),
          ),
        })
        .loose()
        .parse(value),
  );
  const exportedManaged = exportedConfig.hosts.find((host) => host.managed);
  expect(exportedManaged?.password ?? null).toBeNull();
  expect(exportedManaged?.privateKey ?? null).toBeNull();
  const reimport = await apiStatus(workerPage, {
    url: "/api/config/sync",
    method: "POST",
    body: exportedConfig,
  });
  expect(reimport.status).toBe(200);
  const threadsAfterReimport = await apiStatus(workerPage, {
    url: `/api/threads?hostId=${managedHost!.id}`,
  });
  expect(threadsAfterReimport.status).toBe(200);

  // Disabling the member revokes live sessions: the open page is dropped back to login.
  await openUsersTab(page);
  await page
    .getByTestId(`admin-user-row-${workerName}`)
    .getByRole("button", { name: /禁用|Disable/ })
    .click();
  await expect(workerPage.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });

  // Deleting the member removes the row and the credentials stop working.
  await page.getByTestId(`admin-delete-user-${workerName}`).click();
  await page.getByTestId("admin-delete-confirm").click();
  await expect(page.getByTestId(`admin-user-row-${workerName}`)).toBeHidden();
  await closeSettingsDialog(page);

  const relogin = await apiStatus(workerPage, {
    url: "/api/auth/login",
    method: "POST",
    body: { username: workerName, password: workerPassword },
  });
  expect(relogin.status).toBe(401);
  await workerContext.close();

  // A plain member cannot see the admin tab or call admin APIs.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await openApp(memberPage, { credentials: MEMBER });
  await openSettingsDialog(memberPage);
  await expect(page.getByRole("tab", { name: /用户管理|User management/ })).toBeHidden();
  await expect(memberPage.getByRole("tab", { name: /用户管理|User management/ })).toBeHidden();
  expect((await apiStatus(memberPage, { url: "/api/admin/users" })).status).toBe(403);
  await memberContext.close();
});

test("assigning a managed host preserves the member's existing config", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const memberName = `keepcfg-${suffix}`;
  const memberPassword = "keepcfg-password-ok";

  await openApp(page);

  // Create a member, give it existing unmanaged config through its own sync API, then add a
  // managed host. The member's host/project/pinned rows must survive.
  const created = await authenticatedFetch(
    page,
    {
      url: "/api/admin/users",
      method: "POST",
      body: { username: memberName, password: memberPassword, role: "user", provision: false },
    },
    (value) =>
      z
        .object({ user: z.object({ id: z.number() }).loose() })
        .loose()
        .parse(value),
  );
  const memberId = created.user.id;

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await openApp(memberPage, {
    resetConfig: false,
    credentials: { username: memberName, password: memberPassword },
  });
  await authenticatedFetch(
    memberPage,
    {
      url: "/api/config/sync",
      method: "POST",
      body: {
        version: 1,
        hosts: [
          {
            id: 1,
            name: "existing-host",
            sshHost: "127.0.0.1",
            authMode: "password",
            password: "irrelevant-password",
            proxyUrl: null,
            managed: false,
          },
        ],
        projects: [{ id: 1, hostId: 1, name: "existing-project", remotePath: "/tmp" }],
        pinnedThreads: [{ hostId: 1, projectId: 1, threadId: "t-1", title: "existing pinned" }],
      },
    },
    () => undefined,
  );

  const managed = await authenticatedFetch(
    page,
    {
      url: `/api/admin/users/${memberId}/managed-host`,
      method: "PUT",
      body: {
        name: `managed-keep-${suffix}`,
        sshHost: REMOTE_HOST,
        username: REMOTE_USERNAME,
        port: Number(REMOTE_PORT),
        authMode: "password",
        password: REMOTE_PASSWORD,
        proxyUrl: null,
      },
    },
    (value) =>
      z
        .object({ host: z.object({ id: z.number() }).loose() })
        .loose()
        .parse(value),
  );
  expect(managed.host.id).toBeGreaterThan(1);

  const exported = await authenticatedFetch(memberPage, { url: "/api/config/export" }, (value) =>
    z
      .object({
        hosts: z.array(
          z.object({ id: z.number(), name: z.string(), managed: z.boolean() }).loose(),
        ),
        projects: z.array(z.object({ name: z.string() }).loose()),
        pinnedThreads: z.array(z.object({ threadId: z.string() }).loose()),
      })
      .parse(value),
  );
  expect(exported.hosts.map((host) => host.name)).toEqual(
    expect.arrayContaining(["existing-host", `managed-keep-${suffix}`]),
  );
  expect(exported.projects.map((project) => project.name)).toContain("existing-project");
  expect(exported.pinnedThreads.map((thread) => thread.threadId)).toContain("t-1");

  // Cleanup so reruns stay independent of persisted DB rows.
  await authenticatedFetch(
    page,
    { url: `/api/admin/users/${memberId}`, method: "DELETE" },
    () => undefined,
  );
  await memberContext.close();
});
