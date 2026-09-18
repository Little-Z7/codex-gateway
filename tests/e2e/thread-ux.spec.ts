import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { z } from "zod";

async function api<T>(
  page: import("@playwright/test").Page,
  request: { url: string; method?: string; body?: unknown },
  parse: (v: unknown) => T,
) {
  return page
    .evaluate(async (request) => {
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
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return response.json() as Promise<unknown>;
    }, request)
    .then(parse);
}

const usersSchema = z.object({
  users: z.array(
    z
      .object({
        id: z.number(),
        username: z.string(),
        container: z.object({ state: z.string() }).nullable().optional(),
        managedHost: z.object({ status: z.string() }).nullable().optional(),
      })
      .loose(),
  ),
});

async function createUser(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
  provision: boolean,
) {
  await api(
    page,
    { url: "/api/admin/users", method: "POST", body: { username, password, provision } },
    (v) => v,
  );
}

async function waitForContainerReady(page: import("@playwright/test").Page, username: string) {
  await expect
    .poll(
      async () => {
        const { users } = await api(page, { url: "/api/admin/users" }, (v) => usersSchema.parse(v));
        const user = users.find((u) => u.username === username);
        return { state: user?.container?.state ?? null, host: user?.managedHost?.status ?? null };
      },
      { timeout: 240_000, intervals: [2_000, 5_000] },
    )
    .toEqual({ state: "running", host: "ready" });
}

test("member without a workspace sees the empty-state hint", async ({ page, browser }) => {
  await openApp(page);
  const username = `ux-empty-${Date.now().toString(36)}`.slice(0, 32);
  await createUser(page, username, "ux-empty-password-ok", false);

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  try {
    await openApp(member, {
      resetConfig: false,
      credentials: { username, password: "ux-empty-password-ok" },
    });
    await expect(member.getByTestId("no-hosts-empty")).toBeVisible({ timeout: 30_000 });
    await expect(member.getByTestId("no-hosts-empty")).toContainText(/管理员|administrator/);
    await expect(member.getByTestId("empty-goto-admin")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("new chat draft, send, sidebar groups, search, user menu", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const username = `ux-turn-${Date.now().toString(36)}`.slice(0, 32);
  const password = "ux-turn-password-ok";

  await openApp(page);
  await createUser(page, username, password, true);
  await waitForContainerReady(page, username);

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  try {
    await openApp(member, {
      resetConfig: false,
      credentials: { username, password },
    });

    // Single managed host: flat sidebar (no host-button rows).
    await expect(member.locator('[data-testid^="host-button-"]')).toHaveCount(0);

    const threadCount = async () =>
      member.evaluate(async () => {
        const token = localStorage.getItem("codex-gateway-auth-token");
        const navigation = window.__codexGatewayE2e?.navigation;
        const hostId = navigation?.selectedHostId;
        if (hostId === null || hostId === undefined) return -1;
        const response = await fetch(`/gw/api/threads?hostId=${hostId}&limit=50`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null || !("data" in body)) return -1;
        const { data } = body as Record<string, unknown>;
        return Array.isArray(data) ? data.length : -1;
      });
    const beforeCount = await threadCount();

    // 1. "新对话" is a front-end draft: no thread row, no /api/threads growth.
    await member.getByTestId("sidebar-new-thread").click();
    await expect(member.getByTestId("new-thread-hero")).toBeVisible({ timeout: 30_000 });
    await expect(member.locator('[data-testid^="thread-button-"]')).toHaveCount(
      beforeCount < 0 ? 0 : beforeCount,
    );
    expect(await threadCount()).toBe(beforeCount);
    await expect.poll(() => new URL(member.url()).searchParams.get("new")).toBe("1");

    // 2. Sending the first message materializes the thread and sinks the composer.
    const prompt = "ux e2e title fallback " + Date.now().toString(36);
    await member.locator('[data-testid="composer-input"]').fill(prompt);
    await member.getByTestId("send-turn-button").click();
    await expect
      .poll(() => new URL(member.url()).searchParams.get("threadId"), { timeout: 60_000 })
      .not.toBeNull();
    await expect(member.getByTestId("new-thread-hero")).toBeHidden({ timeout: 60_000 });
    await expect(member.locator('[data-testid="composer-box"]').last()).toBeVisible();
    expect(await threadCount()).toBe(beforeCount + 1);

    // The sidebar shows the first message as the title, never a bare UUID. The preview lands
    // with the next thread-metadata sync, which can lag a slow first turn.
    const sidebarRow = member.locator(`[data-testid^="thread-button-"]`, {
      hasText: prompt.slice(0, 20),
    });
    await expect(sidebarRow.first()).toBeVisible({ timeout: 90_000 });

    // 3. Time-grouped conversation list: the new thread lands under "今天".
    await expect(member.getByText("对话", { exact: true })).toBeVisible();
    await expect(member.getByText("今天", { exact: true })).toBeVisible();

    // 4. Conversation search finds the thread by title.
    await member.getByTestId("sidebar-search-threads").click();
    await expect(member.getByTestId("thread-search-dialog")).toBeVisible();
    await member.getByPlaceholder(/搜索对话标题|Search chat titles/).fill(prompt.slice(0, 16));
    const searchResult = member.getByRole("option", { name: new RegExp(prompt.slice(0, 20)) });
    await expect(searchResult).toBeVisible({ timeout: 10_000 });
    await searchResult.click();
    await expect(member.getByTestId("thread-search-dialog")).toBeHidden();
    await expect
      .poll(() => new URL(member.url()).searchParams.get("threadId"), { timeout: 10_000 })
      .not.toBeNull();

    // 5. User menu exposes settings and sign-out.
    await member.getByTestId("sidebar-user-menu").click();
    await expect(member.getByTestId("settings-toggle")).toBeVisible();
    await expect(member.getByRole("menuitem", { name: /退出登录|Sign out/ })).toBeVisible();
    await member.keyboard.press("Escape");

    // Completion summary rides on the intermediate row once the turn settles.
    await expect(member.getByTestId("intermediate-steps").last()).toContainText(/已完成|Done/, {
      timeout: 240_000,
    });

    // No raw protocol cards in the timeline.
    await expect(member.getByText(/rawResponseItem/)).toHaveCount(0);

    // Ctrl+N returns to the draft hero.
    await member.keyboard.press("Control+n");
    await expect(member.getByTestId("new-thread-hero")).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});
