import { expect, test, type Browser, type Page } from "@playwright/test";
import { z } from "zod";
import { authenticatedFetch, openApp } from "./helpers/app";

const SHARED_AUTH_PRESENT = process.env.E2E_SHARED_AUTH_PRESENT === "1";
const PROVIDER_ENABLED =
  process.env.E2E_MODEL_PROVIDER_API_KEY !== undefined &&
  process.env.E2E_MODEL_PROVIDER_API_KEY !== "";
const MODEL_READY = SHARED_AUTH_PRESENT || PROVIDER_ENABLED;

async function apiStatus(
  page: Page,
  request: { url: string; method?: string; body?: unknown; raw?: string },
) {
  return page.evaluate(async (request) => {
    const token = localStorage.getItem("codex-gateway-auth-token");
    const hasToken = token !== null && token !== "";
    const url = request.url.startsWith("/api/") ? `/gw${request.url}` : request.url;
    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        ...(hasToken ? { authorization: `Bearer ${token}` } : {}),
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...(request.raw === undefined
          ? {}
          : { "content-type": "text/plain", "x-codex-force-overwrite": "true" }),
      },
      body: request.raw ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
    });
    return { status: response.status, body: await response.text() };
  }, request);
}

async function createProvisionedMember(page: Page, username: string, password: string) {
  const created = await apiStatus(page, {
    url: "/api/admin/users",
    method: "POST",
    body: { username, password, role: "user" },
  });
  expect(created.status).toBe(200);
  return z.object({ user: z.object({ id: z.number() }).loose() }).parse(JSON.parse(created.body))
    .user.id;
}

async function waitManagedReady(page: Page, usernames: string[]) {
  await expect
    .poll(
      async () => {
        const users = await authenticatedFetch(page, { url: "/api/admin/users" }, (value) =>
          z
            .object({
              users: z.array(
                z
                  .object({
                    username: z.string(),
                    managedHost: z.object({ status: z.string() }).nullable(),
                  })
                  .loose(),
              ),
            })
            .loose()
            .parse(value),
        );
        return usernames.map(
          (name) =>
            users.users.find((user) => user.username === name)?.managedHost?.status ?? "missing",
        );
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toEqual(usernames.map(() => "ready"));
}

const hostListSchema = z.array(
  z.object({ id: z.number(), managed: z.boolean(), sshHost: z.string() }).loose(),
);

async function memberPageWithHost(browser: Browser, username: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openApp(page, { resetConfig: false, credentials: { username, password } });
  const hosts = await authenticatedFetch(page, { url: "/api/hosts" }, (value) =>
    hostListSchema.parse(value),
  );
  return { context, page, hosts };
}

test("provisioned members only see and reach their own workspace", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const nameA = `iso-a-${suffix}`.slice(0, 32);
  const nameB = `iso-b-${suffix}`.slice(0, 32);
  const password = "iso-member-password-ok";

  await openApp(page);
  const idA = await createProvisionedMember(page, nameA, password);
  const idB = await createProvisionedMember(page, nameB, password);
  await waitManagedReady(page, [nameA, nameB]);

  const a = await memberPageWithHost(browser, nameA, password);
  const b = await memberPageWithHost(browser, nameB, password);

  // Each member sees exactly one host — their own container.
  expect(a.hosts).toHaveLength(1);
  expect(b.hosts).toHaveLength(1);
  expect(a.hosts[0]!.sshHost).toBe(`codex-e2e-user-${nameA}`);
  expect(b.hosts[0]!.sshHost).toBe(`codex-e2e-user-${nameB}`);
  const aHostId = a.hosts[0]!.id;

  // Host ids are per-user config keys; any id outside A's own host must 404 rather than
  // reaching B's container.
  const foreignHostId = aHostId + 999;
  const foreignThreads = await apiStatus(a.page, {
    url: `/api/threads?hostId=${foreignHostId}&limit=50`,
  });
  expect(foreignThreads.status).toBe(404);
  const foreignFile = await apiStatus(a.page, {
    url: `/api/remote/files?hostId=${foreignHostId}&path=/home/dev/workspace`,
  });
  expect(foreignFile.status).toBe(404);

  // Shared dir: the runner seeds e2e-shared-seed.txt; A overwrites it, B sees A's content.
  const marker = `iso-marker-${suffix}`;
  const seedPath = "/data/shared/e2e-shared-seed.txt";
  const seedWrite = await apiStatus(a.page, {
    url: `/api/remote/files?hostId=${aHostId}&path=${seedPath}`,
    method: "PUT",
    raw: marker,
  });
  expect(seedWrite.status).toBe(200);
  const seedRead = await apiStatus(b.page, {
    url: `/api/remote/files?hostId=${b.hosts[0]!.id}&path=${seedPath}`,
  });
  expect(seedRead.status).toBe(200);
  expect(seedRead.body).toBe(marker);

  if (SHARED_AUTH_PRESENT) {
    // Both containers share the same Codex login through the auth.json symlink.
    const aAuth = await apiStatus(a.page, {
      url: `/api/remote/files?hostId=${aHostId}&path=/home/dev/.codex/auth.json`,
    });
    const bAuth = await apiStatus(b.page, {
      url: `/api/remote/files?hostId=${b.hosts[0]!.id}&path=/home/dev/.codex/auth.json`,
    });
    expect(aAuth.status).toBe(200);
    expect(aAuth.body).toBe(bAuth.body);
  }

  if (MODEL_READY) {
    // A creating a thread on its own container must not surface in B's list.
    const aProjects = await authenticatedFetch(a.page, { url: "/api/projects" }, (value) =>
      z.array(z.object({ id: z.number() }).loose()).parse(value),
    );
    await a.page.getByTestId(`project-button-${aProjects[0]!.id}`).click({ button: "right" });
    await a.page.getByRole("menuitem", { name: /新建/ }).click();
    await a.page.waitForFunction(
      () => new URLSearchParams(window.location.search).get("threadId") !== null,
      undefined,
      { timeout: 30_000 },
    );
    const bThreads = await authenticatedFetch(
      b.page,
      { url: `/api/threads?hostId=${b.hosts[0]!.id}&limit=50` },
      (value) =>
        z
          .object({ data: z.array(z.unknown()) })
          .loose()
          .parse(value),
    );
    expect(bThreads.data).toHaveLength(0);
  } else {
    test.info().annotations.push({
      type: "skipped",
      description:
        "No Codex credentials (neither shared login nor E2E_MODEL_PROVIDER_API_KEY): thread creation check skipped",
    });
  }

  // Home volumes are isolated: A overwrites its own config.toml (a guaranteed-writable
  // file) with a marker; B's identical path must not contain it. Done last — the write
  // intentionally clobbers A's config.
  const homeMarker = `home-marker-${suffix}`;
  const configPath = "/home/dev/.codex/config.toml";
  const configWrite = await apiStatus(a.page, {
    url: `/api/remote/files?hostId=${aHostId}&path=${configPath}`,
    method: "PUT",
    raw: homeMarker,
  });
  expect(configWrite.status).toBe(200);
  const bConfig = await apiStatus(b.page, {
    url: `/api/remote/files?hostId=${b.hosts[0]!.id}&path=${configPath}`,
  });
  expect(bConfig.status).toBe(200);
  expect(bConfig.body).not.toContain(homeMarker);
  expect(bConfig.body).toContain('cli_auth_credentials_store = "file"');

  // Cleanup: delete both members (dropping their containers and volumes).
  for (const id of [idA, idB]) {
    const removed = await apiStatus(page, { url: `/api/admin/users/${id}`, method: "DELETE" });
    expect(removed.status).toBe(200);
  }
  const remaining = await authenticatedFetch(page, { url: "/api/admin/users" }, (value) =>
    z.object({ users: z.array(z.object({ username: z.string() }).loose()) }).parse(value),
  );
  expect(remaining.users.map((user) => user.username)).not.toContain(nameA);
  expect(remaining.users.map((user) => user.username)).not.toContain(nameB);

  await a.context.close();
  await b.context.close();
});
