import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { openApp } from "./helpers/app";
import { sendTextTurn, waitForSelectedThreadId } from "./helpers/remote-codex";

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

const usageMeSchema = z
  .object({
    usage: z
      .object({
        usage: z.object({
          dailyTurns: z.number(),
          dailyTokens: z.number(),
          monthlyTurns: z.number(),
          monthlyTokens: z.number(),
        }),
        exceeded: z
          .object({
            dimension: z.string(),
            used: z.number(),
            limit: z.number(),
            resetAt: z.string(),
          })
          .nullable(),
        limits: z
          .object({
            dailyTurns: z.number().nullable(),
            dailyTokens: z.number().nullable(),
            monthlyTurns: z.number().nullable(),
            monthlyTokens: z.number().nullable(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();

async function api<T>(
  page: Page,
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
      const text = await response.text();
      let body: unknown = {};
      if (text !== "") {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = { raw: text };
        }
      }
      return { ok: response.ok, status: response.status, body };
    }, request)
    .then((result) => parse(result));
}

async function createUser(
  page: Page,
  username: string,
  password: string,
  provision: boolean,
  extra: Record<string, unknown> = {},
) {
  await api(
    page,
    {
      url: "/api/admin/users",
      method: "POST",
      body: { username, password, provision, ...extra },
    },
    (v) => v,
  );
}

async function waitForContainerReady(page: Page, username: string) {
  await expect
    .poll(
      async () => {
        const result = await api(page, { url: "/api/admin/users" }, (v) =>
          z.object({ ok: z.boolean(), body: usersSchema }).parse(v),
        );
        const user = result.body.users.find((item) => item.username === username);
        return { state: user?.container?.state ?? null, host: user?.managedHost?.status ?? null };
      },
      { timeout: 240_000, intervals: [2_000, 5_000] },
    )
    .toEqual({ state: "running", host: "ready" });
}

async function userIdFor(page: Page, username: string) {
  const result = await api(page, { url: "/api/admin/users" }, (v) =>
    z.object({ ok: z.boolean(), body: usersSchema }).parse(v),
  );
  const user = result.body.users.find((item) => item.username === username);
  expect(user).toBeTruthy();
  return user!.id;
}

test("member dailyTurns budget intercepts the second turn and reset restores sending", async ({
  page,
  browser,
}) => {
  test.setTimeout(360_000);
  const username = `budget-${Date.now().toString(36)}`.slice(0, 32);
  const password = "budget-user-password-ok";

  await openApp(page);
  await createUser(page, username, password, true);
  await waitForContainerReady(page, username);
  const memberId = await userIdFor(page, username);

  await api(
    page,
    {
      url: `/api/admin/users/${memberId}/budget`,
      method: "PUT",
      body: { dailyTurns: 1, monthlyTurns: null, dailyTokens: null, monthlyTokens: null },
    },
    (v) => v,
  );

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  try {
    await openApp(member, {
      resetConfig: false,
      credentials: { username, password },
    });
    await member.getByTestId("sidebar-new-thread").click();
    await expect(member.getByTestId("new-thread-hero")).toBeVisible({ timeout: 30_000 });
    const first = `budget first ${Date.now().toString(36)}`;
    await member.locator('[data-testid="composer-input"]').fill(first);
    await member.getByTestId("send-turn-button").click();
    await expect
      .poll(() => new URL(member.url()).searchParams.get("threadId"), { timeout: 60_000 })
      .not.toBeNull();
    await expect(member.getByTestId("send-turn-button")).toHaveAttribute(
      "aria-label",
      /已完成|Done|失败|Failed|已中断|Interrupted/,
      { timeout: 240_000 },
    );

    const usageAfterFirst = await api(member, { url: "/api/usage/me" }, (v) =>
      z.object({ ok: z.boolean(), status: z.number(), body: usageMeSchema }).parse(v),
    );
    expect(usageAfterFirst.ok).toBe(true);
    expect(usageAfterFirst.body.usage.usage.dailyTurns).toBeGreaterThanOrEqual(1);
    expect(usageAfterFirst.body.usage.exceeded?.dimension).toBe("dailyTurns");

    await expect(member.getByTestId("composer-budget-exceeded")).toBeVisible({ timeout: 30_000 });
    await expect(member.getByTestId("send-turn-button")).toBeDisabled();

    const blocked = await member.evaluate(async () => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("missing e2e driver");
      try {
        await driver.realtime.request((requestId) => ({
          type: "turn.start",
          requestId,
          hostId: driver.navigation.selectedHostId ?? 0,
          threadId: driver.navigation.selectedThreadId ?? "",
          projectId: driver.navigation.selectedProjectId ?? 0,
          text: "budget second turn should be blocked",
        }));
        return { ok: true, code: null as string | null };
      } catch (error) {
        const record = error instanceof Error ? error : new Error(String(error));
        const details =
          "details" in record && typeof record.details === "object" && record.details !== null
            ? record.details
            : {};
        const direct = "code" in record && typeof record.code === "string" ? record.code : null;
        const nested = "code" in details && typeof details.code === "string" ? details.code : null;
        return { ok: false, code: direct ?? nested };
      }
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("budget.exceeded");

    await api(page, { url: `/api/admin/users/${memberId}/budget/reset`, method: "POST" }, (v) => v);
    await member.reload({ waitUntil: "domcontentloaded" });
    await expect(
      member.getByTestId("desktop-layout").or(member.getByTestId("mobile-layout")),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(member.getByTestId("composer-budget-exceeded")).toHaveCount(0);
    await sendTextTurn(member, `budget after reset ${Date.now().toString(36)}`);
    await waitForSelectedThreadId(member);
    await expect(member.getByTestId("send-turn-button")).toHaveAttribute(
      "aria-label",
      /已完成|Done|失败|Failed|已中断|Interrupted/,
      { timeout: 240_000 },
    );

    await api(
      page,
      {
        url: `/api/admin/users/${memberId}/budget`,
        method: "PUT",
        body: { dailyTurns: null, monthlyTurns: null, dailyTokens: null, monthlyTokens: null },
      },
      (v) => v,
    );
    await member.reload({ waitUntil: "domcontentloaded" });
    await expect(member.getByTestId("composer-budget-exceeded")).toHaveCount(0);
    await sendTextTurn(member, `budget unlimited ${Date.now().toString(36)}`);
    await expect(member.getByTestId("send-turn-button")).toHaveAttribute(
      "aria-label",
      /已完成|Done|失败|Failed|已中断|Interrupted/,
      { timeout: 240_000 },
    );
  } finally {
    await ctx.close();
  }
});

test("creating a user with must-change-password forces the password screen", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const username = `pwforce-${Date.now().toString(36)}`.slice(0, 32);
  const password = "pwforce-password-ok";
  const nextPassword = "pwforce-password-new";

  await openApp(page);
  await createUser(page, username, password, false, { mustChangePassword: true });

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  try {
    await member.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(member.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });
    await member.getByTestId("login-username").fill(username);
    await member.getByTestId("login-password").fill(password);
    await member.getByTestId("login-submit").click();
    await expect(member.getByTestId("force-password-form")).toBeVisible({ timeout: 30_000 });
    await member.getByTestId("force-password-current").fill(password);
    await member.getByTestId("force-password-new").fill(nextPassword);
    await member.getByTestId("force-password-confirm").fill(nextPassword);
    await member.getByTestId("force-password-submit").click();
    await expect(member.getByTestId("force-password-form")).toBeHidden({ timeout: 30_000 });
    await expect(
      member.getByTestId("desktop-layout").or(member.getByTestId("mobile-layout")),
    ).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await ctx.close();
  }
});
