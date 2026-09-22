// Kept in its own spec because restarting gateway-under-test severs the test-runner's shared
// network namespace (network_mode: service:gateway-under-test) — after the restart no in-page
// fetch can reach the gateway again. This file must therefore sort after every other spec, and
// its post-restart assertions run purely over the docker socket (container health + logs).
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  dockerContainerHealthy,
  dockerContainerLogs,
  dockerRestartContainer,
} from "./helpers/docker-engine";

const GATEWAY = "gateway-under-test";

test("a gateway restart during provisioning does not leave the row stuck", async () => {
  test.setTimeout(420_000);
  const memberName = `repair-${Date.now().toString(36)}`.slice(0, 32);

  // The gateway-under-test container and the test-runner share one network namespace, so use a
  // plain request to the gateway origin — playwright's APIRequestContext resolves through the
  // pod network identically.
  const res = z.looseObject({ token: z.string() }).parse(
    await (
      await fetch("http://127.0.0.1:3100/gw/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: process.env.E2E_GATEWAY_USERNAME ?? "e2e",
          password: process.env.E2E_GATEWAY_PASSWORD ?? "codex-gateway-e2e-password",
        }),
      })
    ).json(),
  );
  const token = res.token;
  const created = await fetch("http://127.0.0.1:3100/gw/api/admin/users", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      username: memberName,
      password: "repair-member-password",
      role: "user",
      provision: true,
    }),
  });
  expect(created.status).toBe(200);

  // Restart immediately: the row is in `provisioning` while the container is being built.
  await dockerRestartContainer(GATEWAY);

  // The gateway container itself must come back healthy.
  await expect
    .poll(async () => dockerContainerHealthy(GATEWAY), {
      timeout: 120_000,
      intervals: [2_000, 3_000, 5_000],
    })
    .toBe(true);

  // The startup repair either finished the workspace (repaired) or marked the row error.
  const logs = await dockerContainerLogs(GATEWAY, 2000);
  expect(logs).toContain("interrupted provisioning");
});
