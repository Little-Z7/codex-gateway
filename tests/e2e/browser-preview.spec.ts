import { expect, test } from "./fixtures/remote-workspace";
import { openApp, reloadApp } from "./helpers/app";
import { selectSidebarThread, startRemotePreviewServer } from "./helpers/remote-codex";

async function openPreviewPanel(
  page: Parameters<typeof selectSidebarThread>[0],
  targetUrl: string,
) {
  await page.getByTestId("open-browser-button").click();
  await page.getByPlaceholder("http://localhost:3000").fill(targetUrl);
  await page.getByTestId("browser-open-submit").click();
}

test("opens a real remote HTTP and WebSocket service through the SSH preview proxy", async ({
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await openApp(page);
  const host = await remoteWorkspace.addHost(`preview-host-${Date.now()}`);
  const project = await remoteWorkspace.addProject(host.id, `preview-project-${Date.now()}`);
  const previewThreadId = await remoteWorkspace.startThread(project.id);
  const otherThreadId = await remoteWorkspace.startThread(project.id);
  await selectSidebarThread(page, previewThreadId);
  await startRemotePreviewServer(remote);

  await openPreviewPanel(page, "http://localhost:4173");
  await expect(page.getByRole("tab", { name: "localhost:4173" })).toBeVisible({ timeout: 5_000 });

  // Same-origin preview: the iframe bootstraps through /_gateway on the Gateway origin, and the
  // external-open link points at the target's path on this origin.
  const frame = page.locator('iframe[title="localhost:4173"]');
  await expect(frame).toHaveAttribute("src", /^\/_gateway\/preview\/bootstrap\?/);
  await expect(page.locator('a[target="_blank"][href="/"]').first()).toBeVisible();

  const preview = page.frameLocator('iframe[title="localhost:4173"]');
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(preview.locator("#asset")).toHaveText("remote-preview-static-asset-ok");
  await expect(preview.locator("#http")).toHaveText("remote-preview-http-ok");
  await expect(preview.locator("#ws")).toHaveText("remote-preview-websocket");
  await expect(page.getByText("404 GET /missing-preview-entry.js")).toBeVisible();

  // Switching thread scopes destroys the keyed Dockview tree. Returning recreates the iframe
  // with its original bootstrap URL, matching normal desktop/mobile workspace navigation.
  await selectSidebarThread(page, otherThreadId);
  await selectSidebarThread(page, previewThreadId);
  await page.getByRole("tab", { name: "localhost:4173" }).click();
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(preview.locator("#asset")).toHaveText("remote-preview-static-asset-ok");

  await reloadApp(page);
  await page.getByRole("tab", { name: "localhost:4173" }).click();
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("tab", { name: "localhost:4173" })
    .getByLabel(/关闭标签页|Close tab/)
    .click();
  await expect(page.getByRole("tab", { name: "localhost:4173" })).toBeHidden();
});

test("a second preview in the same browser replaces the first session binding", async ({
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await openApp(page);
  const host = await remoteWorkspace.addHost(`preview-replace-${Date.now()}`);
  const project = await remoteWorkspace.addProject(host.id, `preview-project-${Date.now()}`);
  await remoteWorkspace.startThread(project.id);
  await startRemotePreviewServer(remote);

  await openPreviewPanel(page, "http://localhost:4173");
  const firstPreview = page.frameLocator('iframe[title="localhost:4173"]');
  await expect(firstPreview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });

  // A browser can only hold one preview cookie, so activating a second panel evicts the first
  // session's binding; the evicted panel keeps its target and offers re-activation.
  await openPreviewPanel(page, "http://127.0.0.1:4173");
  await expect(page.getByRole("tab", { name: "127.0.0.1:4173" })).toBeVisible({ timeout: 5_000 });
  const secondPreview = page.frameLocator('iframe[title="127.0.0.1:4173"]');
  await expect(secondPreview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("tab", { name: "localhost:4173" }).click();
  await expect(page.getByTestId("browser-reactivate")).toBeVisible();

  await page.getByTestId("browser-reactivate").click();
  await expect(firstPreview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(firstPreview.locator("#ws")).toHaveText("remote-preview-websocket");

  // Reactivating the first panel evicts the second binding in turn.
  await page.getByRole("tab", { name: "127.0.0.1:4173" }).click();
  await expect(page.getByTestId("browser-reactivate")).toBeVisible();
});
