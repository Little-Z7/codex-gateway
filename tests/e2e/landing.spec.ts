import { expect, test } from "@playwright/test";

test("unauthenticated home is a product landing page, not the login form", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("login-form")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "在浏览器里使用远端 Codex" })).toBeVisible();
  await expect(page.getByText("凭据不进浏览器")).toBeVisible();
  await expect(page.getByTestId("landing-login")).toBeVisible();

  await page.getByTestId("landing-login").click();
  await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/login(?:\/|\?|$)/);
  await expect(page.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await expect(page.getByTestId("landing-page")).toHaveCount(0);
});

test("login page stays a sign-in form and can return to the landing page", async ({ page }) => {
  await page.goto("/gw/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await page.getByTestId("login-back-to-landing").click();
  await expect(page.getByTestId("landing-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("login-form")).toHaveCount(0);
});
