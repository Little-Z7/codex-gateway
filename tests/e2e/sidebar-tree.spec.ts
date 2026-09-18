import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { installRealtimeThreadSnapshotMock, seedGatewayThread } from "./helpers/gateway-store";
import { defaultGatewayHost, defaultGatewayProject } from "./fixtures/thread-history";

test("collapses the desktop sidebar and restores the saved layout", async ({ page }) => {
  await openApp(page);

  const sidebarGap = page.locator('[data-slot="sidebar-gap"]');
  await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
  await page.getByTestId("desktop-sidebar-collapse").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);

  await page.getByTestId("desktop-sidebar-expand").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("desktop-sidebar-collapse")).toBeVisible();
});

test("selecting a project shows its threads in the sidebar", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 101,
    projectId: null,
    host: { ...defaultGatewayHost(101), name: "Toggle Host" },
    project: {
      ...defaultGatewayProject(101, 201),
      name: "Toggle Project",
      remotePath: "/workspace/toggle",
    },
    threads: [
      {
        id: "toggle-thread",
        title: "Toggle Thread",
        pinned: false,
        updatedAt: Date.now(),
      },
    ],
  });
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.catalog.selectProject = async (projectId: number) => {
      const { navigation } = driver;
      navigation.selectedProjectId = projectId;
      navigation.selectedThreadId = null;
    };
  });

  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("project-button-201")).toBeVisible();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeHidden();
  await page.getByTestId("project-button-201").click();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeVisible();
});

test("marks completed threads as needing review until they are opened", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 102,
    projectId: 202,
    threadId: "selected-thread",
    host: { ...defaultGatewayHost(102), name: "Review Host" },
    project: {
      ...defaultGatewayProject(102, 202),
      name: "Review Project",
      remotePath: "/workspace/review",
    },
    currentThread: { id: "selected-thread", name: "Selected Thread" },
    threads: [
      {
        id: "review-thread",
        name: "Review Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
      {
        id: "selected-thread",
        name: "Selected Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    ],
    status: "completed",
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId: 102,
    snapshots: {
      "review-thread": {
        thread: { id: "review-thread", name: "Review Thread" },
        history: { thread: { id: "review-thread", turns: [] } },
        projectId: 202,
        runtimeStatus: "completed",
      },
    },
  });
  await page.evaluate(() => {
    const runtime = window.__codexGatewayE2e?.runtime;
    if (!runtime) throw new Error("Gateway E2E driver is unavailable");
    runtime.setThreadStatus(102, "review-thread", "running");
    runtime.setThreadStatus(102, "review-thread", "completed");
  });

  await expect(page.getByTestId("thread-button-review-thread")).toBeVisible();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("thread-button-review-thread").click();
  // Completed threads render no trailing status icon; opening the thread only clears the
  // unviewed red dot.
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeHidden();
});

test("groups the selected project's threads under pinned and time sections", async ({ page }) => {
  await openApp(page);
  const now = Math.floor(Date.now() / 1000);
  await seedGatewayThread(page, {
    hostId: 104,
    projectId: 204,
    threadId: null,
    host: { ...defaultGatewayHost(104), name: "Activity Host" },
    project: {
      ...defaultGatewayProject(104, 204),
      name: "Activity Project",
      remotePath: "/workspace/activity",
    },
    threads: [
      { id: "recent-main", title: "Recent main thread", pinned: false, updatedAt: now },
      {
        id: "older-main",
        title: "Older main thread",
        pinned: false,
        updatedAt: now - 10 * 24 * 3600,
      },
      {
        id: "already-pinned",
        title: "Already pinned",
        pinned: true,
        updatedAt: now - 40 * 24 * 3600,
      },
    ],
  });
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.config.gatewayConfig.pinnedThreads = [
      {
        hostId: 104,
        projectId: 204,
        threadId: "already-pinned",
        title: "Already pinned",
      },
    ];
    driver.runtime.setThreadStatus(104, "recent-main", "running");
  });

  await expect(page.getByText("已置顶", { exact: true })).toBeVisible();
  await expect(page.getByTestId("pinned-thread-button-already-pinned")).toBeVisible();
  await expect(page.getByText("今天", { exact: true })).toBeVisible();
  await expect(page.getByText("前 30 天", { exact: true })).toBeVisible();
  await expect(page.getByTestId("thread-button-recent-main")).toBeVisible();
  await expect(page.getByTestId("thread-button-older-main")).toBeVisible();
  await expect(
    page.getByTestId("thread-button-recent-main").getByLabel("运行中", { exact: true }),
  ).toBeVisible();

  const sectionOrder = await page.getByTestId("sidebar-scroll-area").evaluate((root) => {
    const text = root.textContent ?? "";
    return [text.indexOf("已置顶"), text.indexOf("今天"), text.indexOf("前 30 天")];
  });
  expect(sectionOrder[0]).toBeLessThan(sectionOrder[1]!);
  expect(sectionOrder[1]).toBeLessThan(sectionOrder[2]!);
});

test("sorts pinned threads for display without rewriting persisted pin order", async ({ page }) => {
  await openApp(page);
  const hosts = [
    { ...defaultGatewayHost(302), name: "Zulu Host" },
    { ...defaultGatewayHost(301), name: "Alpha Host" },
  ];
  const pinnedThreads = [
    { hostId: 302, projectId: null, threadId: "z-alpha", title: "Alpha Thread" },
    { hostId: 301, projectId: 401, threadId: "a-zulu", title: "Zulu Thread" },
    { hostId: 301, projectId: 401, threadId: "a-alpha-b", title: "Alpha Thread" },
    { hostId: 301, projectId: 401, threadId: "a-alpha-a", title: "Alpha Thread" },
  ];
  const projects = [defaultGatewayProject(301, 401)];
  await page.evaluate(
    ({ hosts, projects, pinnedThreads }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      driver.catalog.hosts = hosts;
      driver.catalog.projects = projects;
      driver.config.gatewayConfig.pinnedThreads = pinnedThreads;
      driver.navigation.selectedHostId = 301;
      driver.navigation.selectedProjectId = 401;
    },
    { hosts, projects, pinnedThreads },
  );

  const renderedThreadIds = await page
    .locator('[data-testid^="pinned-thread-button-"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-testid")?.replace("pinned-thread-button-", "")),
    );
  // Only the selected host's pins render in the conversation group.
  expect(renderedThreadIds).toEqual(["a-alpha-a", "a-alpha-b", "a-zulu"]);

  const storedThreadIds = await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    return driver.config.gatewayConfig.pinnedThreads.map((thread) => thread.threadId);
  });
  expect(storedThreadIds).toEqual(pinnedThreads.map((thread) => thread.threadId));
});

test("long expanded tree labels truncate without displacing trailing statuses", async ({
  page,
}) => {
  await openApp(page);
  const hostId = 103;
  const projectId = 203;
  const threadId = "long-sidebar-thread";
  const longTitle = `Long thread ${"unbroken-segment-".repeat(18)}`;
  await seedGatewayThread(page, {
    hostId,
    projectId,
    threadId: null,
    host: {
      ...defaultGatewayHost(hostId),
      name: `Long host ${"host-segment-".repeat(12)}`,
      sshHost: "very-long-hostname.example.internal",
    },
    project: {
      ...defaultGatewayProject(hostId, projectId),
      name: `Long project ${"project-segment-".repeat(12)}`,
      remotePath: "/workspace/sidebar-layout",
    },
    threads: [{ id: threadId, name: longTitle, pinned: false, updatedAt: 1 }],
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId,
    snapshots: {
      [threadId]: {
        thread: { id: threadId, name: longTitle },
        history: { thread: { id: threadId, turns: [] } },
        projectId,
        runtimeStatus: "running",
      },
    },
  });
  const extraHost = defaultGatewayHost(900);
  await page.evaluate(
    ({ hostId, threadId, extraHost }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { catalog, runtime } = driver;
      // Host sub-headers (and their status dot) render only when more than one host exists.
      catalog.hosts = [...catalog.hosts, extraHost];
      catalog.hostConnectionStatuses = { [hostId]: { status: "connected" } };
      runtime.setThreadStatus(hostId, threadId, "running");
    },
    { hostId, threadId, extraHost },
  );

  await expect(page.getByTestId(`thread-button-${threadId}`)).toBeVisible();
  await page.getByTestId(`thread-button-${threadId}`).click();
  await expect(page.getByTestId(`thread-button-${threadId}`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.getByTestId(`host-button-${hostId}`).getByLabel("已连接")).toBeVisible();
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("运行中")).toBeVisible();

  const metrics = await page.getByTestId("sidebar-scroll-area").evaluate(
    (root, { hostId, threadId, longTitle }) => {
      const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      const threadButton = root.querySelector<HTMLElement>(
        `[data-testid="thread-button-${CSS.escape(threadId)}"]`,
      );
      const title = threadButton?.querySelector<HTMLElement>(`[title="${CSS.escape(longTitle)}"]`);
      const hostStatus = root.querySelector<HTMLElement>(
        `[data-testid="host-button-${hostId}"] [aria-label="已连接"]`,
      );
      const threadStatus = threadButton?.querySelector<HTMLElement>('[aria-label="运行中"]');
      const statuses = [hostStatus, threadStatus];
      if (!viewport || !title || statuses.some((status) => !status)) {
        throw new Error("Missing sidebar layout nodes");
      }
      const viewportRect = viewport.getBoundingClientRect();
      return {
        overflow: viewport.scrollWidth - viewport.clientWidth,
        titleClipped: title.scrollWidth > title.clientWidth,
        titleOverflow: getComputedStyle(title).textOverflow,
        statusesInside: statuses.every((status) => {
          if (!status) return false;
          const rect = status.getBoundingClientRect();
          return rect.left >= viewportRect.left && rect.right <= viewportRect.right;
        }),
      };
    },
    { hostId, threadId, longTitle },
  );
  expect(metrics).toEqual({
    overflow: 0,
    titleClipped: true,
    titleOverflow: "ellipsis",
    statusesInside: true,
  });
});
