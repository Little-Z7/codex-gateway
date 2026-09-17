import { expect, test } from "@playwright/test";
import { z } from "zod";

// `gateway-fresh` boots against an empty DB volume; the compose service name resolves because the
// test runner shares the gateway-under-test network namespace and stays on the compose network.
const FRESH = "http://gateway-fresh:3101/gw";

test("first-run setup creates the admin and then becomes unavailable", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  // status reports needsSetup on the empty instance.
  const status = await request.get(`${FRESH}/api/setup/status`);
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ needsSetup: true });

  // The login screen routes to the initialization form when setup is required.
  await page.goto(`${FRESH}/`);
  await expect(page.getByTestId("setup-form")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("setup-username").fill("first-admin");
  await page.getByTestId("setup-password").fill("first-admin-password");
  await page.getByTestId("setup-submit").click();

  // Auto-login lands on the workspace.
  await expect(page).not.toHaveURL(/login/, { timeout: 30_000 });
  await expect(page.getByTestId("login-form")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-new-thread")).toBeVisible({ timeout: 30_000 });

  // Setup is now complete: status flips and the endpoint rejects further creation.
  const statusSchema = z.looseObject({ needsSetup: z.boolean() });
  await expect
    .poll(
      async () =>
        statusSchema.parse(await (await request.get(`${FRESH}/api/setup/status`)).json())
          .needsSetup,
      { timeout: 15_000 },
    )
    .toBe(false);
  const again = await request.post(`${FRESH}/api/setup/admin`, {
    data: { username: "second-admin", password: "second-admin-password" },
  });
  expect(again.status()).toBe(409);
});
