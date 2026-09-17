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

test("new thread UX: hero, title fallback, completion summary, Ctrl+N", async ({
  page,
  browser,
}) => {
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

    // The project expands to a "new thread" affordance; start a conversation from the sidebar.
    const projectRow = member.locator('[data-testid^="project-button-"]').first();
    if (await projectRow.isVisible()) {
      await projectRow.click();
    }
    await member.getByTestId("sidebar-new-thread").click();
    await expect(member.getByTestId("new-thread-hero")).toBeVisible({ timeout: 30_000 });

    const prompt = "ux e2e title fallback " + Date.now().toString(36);
    await member.locator('[data-testid="composer-input"]').fill(prompt);
    await member.getByTestId("send-turn-button").click();

    // The sidebar must show the first message, not the raw thread UUID.
    const sidebarRow = member.locator(`[data-testid^="thread-button-"]`, {
      hasText: prompt.slice(0, 20),
    });
    await expect(sidebarRow.first()).toBeVisible({ timeout: 15_000 });

    // The "recent activity" list must show the same fallback title, never a bare UUID.
    const recentRow = member.locator('[data-testid^="recent-thread-button-"]').first();
    await expect(recentRow).toBeVisible({ timeout: 15_000 });
    await expect(recentRow).toContainText(prompt.slice(0, 20));
    await expect(recentRow).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    // Completion summary appears once the turn settles.
    await expect(member.getByTestId("turn-summary").last()).toBeVisible({ timeout: 240_000 });

    // No raw protocol cards in the timeline.
    await expect(member.getByText(/rawResponseItem/)).toHaveCount(0);

    // Ctrl+N starts another conversation.
    await member.keyboard.press("Control+n");
    await expect(member.getByTestId("new-thread-hero")).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});
