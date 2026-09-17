import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { openApp } from "./helpers/app";
import { dockerInspectContainer } from "./helpers/docker-engine";

const SUPPORTED_CODEX = "0.153.4";

const usersSchema = z.looseObject({
  users: z.array(
    z.looseObject({
      id: z.number(),
      username: z.string(),
      isActive: z.boolean(),
      managedHost: z
        .looseObject({
          status: z.string(),
          quota: z.looseObject({ memory: z.string().nullable(), cpus: z.string().nullable() }),
        })
        .nullable(),
      container: z.looseObject({ state: z.string() }).nullable(),
    }),
  ),
});

const recreateSchema = z.looseObject({
  status: z.string(),
  total: z.number(),
  completed: z.number(),
});

async function apiStatus(
  page: Page,
  request: { url: string; method?: string; body?: unknown },
): Promise<{ status: number; body: string }> {
  return page.evaluate(async (request) => {
    const token = localStorage.getItem("codex-gateway-auth-token");
    const url = request.url.startsWith("/api/") ? `/gw${request.url}` : request.url;
    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        ...(token !== null && token !== "" ? { authorization: `Bearer ${token}` } : {}),
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    return { status: response.status, body: await response.text() };
  }, request);
}

async function createUser(
  page: Page,
  username: string,
  password: string,
  provision: boolean,
): Promise<number> {
  const res = await apiStatus(page, {
    url: "/api/admin/users",
    method: "POST",
    body: { username, password, role: "user", provision },
  });
  expect(res.status, `create user ${username}`).toBe(200);
  const parsed = z
    .looseObject({ user: z.looseObject({ id: z.number() }) })
    .parse(JSON.parse(res.body));
  return parsed.user.id;
}

async function listUsers(page: Page) {
  const res = await apiStatus(page, { url: "/api/admin/users" });
  expect(res.status).toBe(200);
  return usersSchema.parse(JSON.parse(res.body)).users;
}

async function waitContainerRunning(page: Page, username: string, timeoutMs = 240_000) {
  await expect
    .poll(
      async () =>
        (await listUsers(page)).find((user) => user.username === username)?.container?.state ??
        "none",
      { timeout: timeoutMs, intervals: [3_000, 5_000, 5_000] },
    )
    .toBe("running");
  await expect
    .poll(
      async () =>
        (await listUsers(page)).find((user) => user.username === username)?.managedHost?.status,
      { timeout: 60_000, intervals: [2_000, 3_000] },
    )
    .toBe("ready");
}

test("admin user detail, quota override and bulk operations", async ({ page }) => {
  test.setTimeout(420_000);
  const suffix = Date.now().toString(36);
  const quotaUser = `cq-${suffix}`;
  const bulkA = `cb-a-${suffix}`;
  const bulkB = `cb-b-${suffix}`;

  await openApp(page);
  await page.goto("/gw/admin?tab=users");
  await expect(page.getByTestId("admin-console")).toBeVisible({ timeout: 30_000 });

  const quotaUserId = await createUser(page, quotaUser, "quota-user-password", true);
  await createUser(page, bulkA, "bulk-a-password-ok", false);
  await createUser(page, bulkB, "bulk-b-password-ok", false);
  await waitContainerRunning(page, quotaUser);

  // User detail page: every summary card renders with real data.
  await page.goto(`/gw/admin?tab=users&user=${quotaUserId}`);
  await expect(page.getByTestId("admin-user-detail")).toBeVisible();
  await expect(page.getByTestId("admin-user-info")).toContainText(quotaUser);
  await expect(page.getByTestId("admin-user-host")).toContainText(`codex-e2e-user-${quotaUser}`);
  await expect(page.getByTestId("admin-user-container")).toContainText(/running/i);
  await expect(page.getByTestId("admin-user-sessions")).toBeVisible();
  await expect(page.getByTestId("admin-user-threads")).toContainText(/runtime cache|运行时缓存/);
  await expect(page.getByTestId("admin-user-audit")).toContainText("user.create");
  await page.getByTestId("admin-user-back").click();
  await expect(page.getByTestId(`admin-user-row-${quotaUser}`)).toBeVisible();

  // Quota: PATCH, verify via /api/admin/users, recreate, verify HostConfig.Memory.
  const quotaRes = await apiStatus(page, {
    url: `/api/admin/users/${quotaUserId}/quota`,
    method: "PATCH",
    body: { memory: "1g", cpus: "1" },
  });
  expect(quotaRes.status, resBody(quotaRes)).toBe(200);
  const quotaRow = (await listUsers(page)).find((user) => user.id === quotaUserId);
  expect(quotaRow?.managedHost?.quota.memory).toBe("1g");
  expect(quotaRow?.managedHost?.quota.cpus).toBe("1");

  const recreate = await apiStatus(page, {
    url: `/api/admin/users/${quotaUserId}/provision?recreate=1`,
    method: "POST",
  });
  expect(recreate.status).toBe(200);
  await waitContainerRunning(page, quotaUser);
  const inspect = await dockerInspectContainer(`codex-e2e-user-${quotaUser}`);
  expect(inspect.HostConfig.Memory).toBe(1024 ** 3);
  expect(inspect.HostConfig.NanoCpus).toBe(1_000_000_000);

  // Bulk disable: select two members, disable both, confirm their logins now fail.
  await page.goto("/gw/admin?tab=users");
  await expect(page.getByTestId(`admin-user-select-${bulkA}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`admin-user-select-${bulkA}`).click();
  await page.getByTestId(`admin-user-select-${bulkB}`).click();
  await expect(page.getByTestId("admin-users-bulk-bar")).toBeVisible();
  await page.getByTestId("admin-bulk-disable").click();
  await expect(page.getByTestId("admin-users-bulk-bar")).toBeHidden({ timeout: 30_000 });
  for (const username of [bulkA, bulkB]) {
    const login = await apiStatus(page, {
      url: "/api/auth/login",
      method: "POST",
      body: { username, password: `${username === bulkA ? "bulk-a" : "bulk-b"}-password-ok` },
    });
    expect(login.status).toBe(401);
  }
  // Re-enable so later specs are unaffected.
  const rows = await listUsers(page);
  for (const username of [bulkA, bulkB]) {
    const user = rows.find((row) => row.username === username);
    expect(user, `row for ${username}`).toBeTruthy();
    await apiStatus(page, {
      url: `/api/admin/users/${user!.id}`,
      method: "PATCH",
      body: { isActive: true },
    });
  }
});

test("containers page shows codex versions and recreate-all completes", async ({ page }) => {
  test.setTimeout(420_000);
  await openApp(page);
  await page.goto("/gw/admin?tab=containers");
  await expect(page.getByTestId("admin-console")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("admin-image-card")).toBeVisible();

  // Container codex version equals the supported version for running containers.
  const users = await listUsers(page);
  const running = users.filter((user) => user.container?.state === "running");
  expect(running.length, "at least one running container").toBeGreaterThan(0);
  const target = running[0]!;
  await expect
    .poll(
      async () => {
        const res = await apiStatus(page, { url: "/api/admin/containers" });
        const parsed = z
          .looseObject({
            containers: z
              .array(z.looseObject({ username: z.string(), codexVersion: z.string().nullable() }))
              .nullable()
              .optional(),
          })
          .parse(JSON.parse(res.body));
        return parsed.containers?.find((row) => row.username === target.username)?.codexVersion;
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBe(SUPPORTED_CODEX);

  // Latest-version check returns either a version or a clear error (egress may be blocked).
  const latest = await apiStatus(page, { url: "/api/admin/images/codex-latest" });
  expect(latest.status).toBe(200);
  const latestBody = z
    .looseObject({ version: z.string().nullable(), error: z.string().nullable() })
    .parse(JSON.parse(latest.body));
  expect(latestBody.version !== null || latestBody.error !== null).toBe(true);

  // Rolling recreate: start with interval 0, poll until done, container returns ready.
  const start = await apiStatus(page, {
    url: "/api/admin/containers/recreate-all",
    method: "POST",
    body: { intervalSeconds: 0 },
  });
  expect(start.status, start.body).toBe(200);
  await expect
    .poll(
      async () => {
        const res = await apiStatus(page, { url: "/api/admin/containers/recreate-all" });
        return recreateSchema.parse(JSON.parse(res.body)).status;
      },
      { timeout: 360_000, intervals: [5_000, 10_000] },
    )
    .toBe("done");
  await expect
    .poll(
      async () =>
        (await listUsers(page)).find((user) => user.username === target.username)?.managedHost
          ?.status,
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe("ready");
});

function resBody(res: { body: string }) {
  return res.body.slice(0, 300);
}

const usageSchema = z.looseObject({
  rows: z.array(
    z.looseObject({
      bucket: z.string(),
      label: z.string(),
      turns: z.number(),
      threads: z.number(),
    }),
  ),
});

async function loginStatus(
  page: Page,
  username: string,
  password: string,
): Promise<{ status: number; body: string }> {
  return apiStatus(page, {
    url: "/api/auth/login",
    method: "POST",
    body: { username, password },
  });
}

test("usage statistics capture a real turn", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const suffix = Date.now().toString(36);
  const usageUser = `cu-${suffix}`;
  const usagePassword = "usage-password-ok-1234";

  await openApp(page);
  await createUser(page, usageUser, usagePassword, true);
  await waitContainerRunning(page, usageUser);

  // A real provider-backed turn from the member's workspace.
  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  try {
    await openApp(member, {
      resetConfig: false,
      credentials: { username: usageUser, password: usagePassword },
    });
    const projectRow = member.locator('[data-testid^="project-button-"]').first();
    if (await projectRow.isVisible()) await projectRow.click();
    await member.getByTestId("sidebar-new-thread").click();
    await member.locator('[data-testid="composer-input"]').fill("reply with ok");
    await expect(member.getByTestId("send-turn-button")).toBeEnabled({ timeout: 60_000 });
    await member.getByTestId("send-turn-button").click();
    await expect(member.getByTestId("turn-summary").last()).toBeVisible({ timeout: 240_000 });
  } finally {
    await ctx.close();
  }

  await expect
    .poll(
      async () => {
        const res = await apiStatus(page, { url: "/api/admin/usage?groupBy=user" });
        const rows = usageSchema.parse(JSON.parse(res.body)).rows;
        return rows.find((row) => row.label === usageUser)?.turns ?? 0;
      },
      { timeout: 30_000, intervals: [1_000, 2_000] },
    )
    .toBeGreaterThanOrEqual(1);

  const csv = await apiStatus(page, {
    url: "/api/admin/usage/export.csv?groupBy=user",
  });
  expect(csv.status).toBe(200);
  expect(csv.body.split("\n")[0]).toBe("bucket,threads,turns,input_tokens,output_tokens");
});

test("provider settings, security lockout, backups and audit csv", async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await page.goto("/gw/admin?tab=system");
  await expect(page.getByTestId("admin-provider-card")).toBeVisible({ timeout: 30_000 });

  // Provider: save the effective env-driven config back with the real provider key so the
  // persisted row is byte-identical in behaviour; assert write-only semantics (last4 only).
  const providerKey = process.env.E2E_MODEL_PROVIDER_API_KEY ?? "";
  const before = await apiStatus(page, { url: "/api/admin/settings" });
  expect(before.status).toBe(200);
  const beforeSettings = z
    .looseObject({
      modelProvider: z.looseObject({
        mode: z.string(),
        id: z.string(),
        displayName: z.string(),
        baseUrl: z.string().nullable(),
        wireApi: z.string(),
        model: z.string().nullable(),
        webSearch: z.string().nullable(),
      }),
    })
    .parse(JSON.parse(before.body));
  const saveRes = await apiStatus(page, {
    url: "/api/admin/settings/model-provider",
    method: "PUT",
    body: {
      mode: beforeSettings.modelProvider.mode,
      id: beforeSettings.modelProvider.id,
      name: beforeSettings.modelProvider.displayName,
      baseUrl: beforeSettings.modelProvider.baseUrl,
      apiKey: providerKey === "" ? null : providerKey,
      wireApi: beforeSettings.modelProvider.wireApi,
      model: beforeSettings.modelProvider.model,
      webSearch: beforeSettings.modelProvider.webSearch,
    },
  });
  expect(saveRes.status, resBody(saveRes)).toBe(200);
  const after = await apiStatus(page, { url: "/api/admin/settings" });
  const afterSettings = z
    .looseObject({
      modelProvider: z.looseObject({
        apiKeyConfigured: z.boolean(),
        apiKeyLast4: z.string().nullable(),
      }),
    })
    .parse(JSON.parse(after.body));
  // In "openai" mode the API key is not used by provisioning (shared Codex auth), so a
  // configured key is only expected for custom providers.
  const expectsKey = beforeSettings.modelProvider.mode === "custom" && providerKey !== "";
  expect(afterSettings.modelProvider.apiKeyConfigured).toBe(expectsKey);
  if (expectsKey) {
    expect(afterSettings.modelProvider.apiKeyLast4).toBe(providerKey.slice(-4));
    expect(after.body).not.toContain(providerKey);
  }
  // Audit must not leak the key.
  const auditRes = await apiStatus(page, { url: "/api/admin/audit?limit=10" });
  expect(auditRes.status).toBe(200);
  if (providerKey !== "") expect(auditRes.body).not.toContain(providerKey);

  // Security: threshold 2 → third consecutive failure returns 429.
  const secSave = await apiStatus(page, {
    url: "/api/admin/settings/security",
    method: "PUT",
    body: { loginMaxFailures: 2 },
  });
  expect(secSave.status, resBody(secSave)).toBe(200);
  const lockUser = `clock-${Date.now().toString(36)}`.slice(0, 32);
  await createUser(page, lockUser, "lock-user-password-ok", false);
  for (let i = 0; i < 2; i += 1) {
    expect((await loginStatus(page, lockUser, "wrong-password")).status).toBe(401);
  }
  expect((await loginStatus(page, lockUser, "wrong-password")).status).toBe(429);
  // Restore defaults and clear every lock (username and IP keys) so later specs are unaffected.
  await apiStatus(page, {
    url: "/api/admin/settings/security",
    method: "PUT",
    body: { loginMaxFailures: 5 },
  });
  // `all: true` also clears non-locked failure counters (e.g. the source-IP key) so the shared
  // test IP does not poison later specs.
  await apiStatus(page, {
    url: "/api/admin/security/lockouts",
    method: "DELETE",
    body: { all: true },
  });

  // Backups: create → list → download tar.
  const create = await apiStatus(page, { url: "/api/admin/backups", method: "POST" });
  expect(create.status, resBody(create)).toBe(200);
  const backupName = z.looseObject({ name: z.string() }).parse(JSON.parse(create.body)).name;
  const list = await apiStatus(page, { url: "/api/admin/backups" });
  expect(
    z
      .looseObject({ backups: z.array(z.looseObject({ name: z.string() })) })
      .parse(JSON.parse(list.body))
      .backups.some((b) => b.name === backupName),
  ).toBe(true);
  const download = await apiStatus(page, {
    url: `/api/admin/backups/${backupName}/download`,
  });
  expect(download.status).toBe(200);
  // ustar magic at offset 257.
  expect(download.body.slice(257, 262)).toBe("ustar");

  // Audit CSV export: first line is the stable header.
  const auditCsv = await apiStatus(page, { url: "/api/admin/audit/export.csv" });
  expect(auditCsv.status).toBe(200);
  expect(auditCsv.body.split("\n")[0]).toBe(
    "id,created_at,actor_user_id,actor_username,action,target_type,target_id,target_label,detail",
  );
});
