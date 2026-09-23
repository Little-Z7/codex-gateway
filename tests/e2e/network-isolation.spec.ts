import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  dockerContainerNetworkIp,
  dockerExecInContainer,
  dockerNetworkGatewayIp,
} from "./helpers/docker-engine";

// `gateway-per-user` is a second provisioning-capable Gateway instance, configured with
// CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user (see tests/e2e/docker-compose.yml). The main
// suite's gateway-under-test stays on the default "shared" mode so its socat-based outbound-proxy
// fixture keeps working -- see CLAUDE.md's "用户容器隔离" note. The compose service name resolves
// because the test runner shares the gateway-under-test network namespace and stays on the
// compose network.
const BASE = "http://gateway-per-user:3102/gw";
const ADMIN_USERNAME = "pu-admin";
const ADMIN_PASSWORD = "pu-admin-password-ok";

async function ensureAdmin(request: APIRequestContext) {
  const status = await request.get(`${BASE}/api/setup/status`);
  expect(status.ok()).toBeTruthy();
  const parsed = z.looseObject({ needsSetup: z.boolean() }).parse(await status.json());
  if (!parsed.needsSetup) return;
  const created = await request.post(`${BASE}/api/setup/admin`, {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(created.ok()).toBeTruthy();
}

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${BASE}/api/auth/login`, { data: { username, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return z.looseObject({ token: z.string() }).parse(await res.json()).token;
}

async function authed(
  request: APIRequestContext,
  token: string,
  path: string,
  options: { method?: string; data?: unknown } = {},
) {
  return request.fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: { authorization: `Bearer ${token}` },
    data: options.data,
  });
}

const usersListSchema = z.looseObject({
  users: z.array(
    z.looseObject({
      id: z.number(),
      username: z.string(),
      managedHost: z
        .looseObject({ status: z.string(), containerName: z.string().nullable() })
        .nullable(),
    }),
  ),
});

/** True TCP reachability probe using bash's /dev/tcp redirection -- no extra tooling required
 *  inside the user-container image (it ships curl/openssh/git/tmux, not netcat). Exit code 0
 *  means the TCP handshake completed; any other code (1 for an immediate refusal/unreachable,
 *  124 for the `timeout` wrapper firing on a silently dropped SYN) means it did not. */
async function tcpReachable(containerName: string, ip: string, port: number): Promise<boolean> {
  const result = await dockerExecInContainer(containerName, [
    "timeout",
    "2",
    "bash",
    "-c",
    `echo > /dev/tcp/${ip}/${port}`,
  ]);
  return result.exitCode === 0;
}

test("per-user network isolation blocks cross-user/host access while Gateway SSH keeps working", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await ensureAdmin(request);
  const adminToken = await login(request, ADMIN_USERNAME, ADMIN_PASSWORD);

  const suffix = Date.now().toString(36);
  const memberA = { username: `iso-a-${suffix}`, password: "iso-member-password-ok" };
  const memberB = { username: `iso-b-${suffix}`, password: "iso-member-password-ok" };
  const userIds = new Map<string, number>();

  for (const member of [memberA, memberB]) {
    const res = await authed(request, adminToken, "/api/admin/users", {
      method: "POST",
      data: { username: member.username, password: member.password },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = z.looseObject({ user: z.looseObject({ id: z.number() }) }).parse(await res.json());
    userIds.set(member.username, body.user.id);
  }

  // Both containers provision through the real Docker socket -- SSH keypair, volume, per-user
  // network creation, `codex --version` readiness probe, the works. No mocking.
  const containerNames = new Map<string, string>();
  await expect
    .poll(
      async () => {
        const res = await authed(request, adminToken, "/api/admin/users");
        expect(res.ok()).toBeTruthy();
        const { users } = usersListSchema.parse(await res.json());
        let readyCount = 0;
        for (const user of users) {
          if (user.username !== memberA.username && user.username !== memberB.username) continue;
          if (user.managedHost?.status === "error") {
            throw new Error(`provisioning failed for ${user.username}`);
          }
          if (user.managedHost?.status === "ready" && user.managedHost.containerName !== null) {
            containerNames.set(user.username, user.managedHost.containerName);
            readyCount += 1;
          }
        }
        return readyCount;
      },
      { timeout: 180_000, intervals: [3_000] },
    )
    .toBe(2);

  const containerA = containerNames.get(memberA.username)!;
  const containerB = containerNames.get(memberB.username)!;
  // userNetworkNameFor(prefix, username) = `${prefix}${username}-net`, and containerNameFor
  // already is `${prefix}${username}` -- see server/utils/gateway/provisioning/
  // user-network-isolation.ts / user-container-provisioner.ts.
  const networkA = `${containerA}-net`;

  const gatewayIpOnA = await dockerContainerNetworkIp("gateway-per-user", networkA);
  const ownNetworkGatewayIpOnA = await dockerNetworkGatewayIp(networkA);
  const bIpOnItsOwnNetwork = await dockerContainerNetworkIp(containerB, `${containerB}-net`);

  // Blocked: A cannot reach B's SSH port -- they are on entirely separate, unconnected per-user
  // networks (Docker-native; no host firewall rule needed for this one).
  expect(await tcpReachable(containerA, bIpOnItsOwnNetwork, 22)).toBe(false);

  // Blocked: A cannot reach the host itself through its own network's bridge gateway IP -- this
  // is the vector `Internal: true` alone does NOT close (traffic destined for a host-owned
  // address is locally delivered, not "forwarded"); it needs the host-level INPUT rule that
  // run-in-containers.sh applies for this spec's dedicated 10.250.0.0/16 test supernet.
  expect(await tcpReachable(containerA, ownNetworkGatewayIpOnA, 22)).toBe(false);

  // Blocked: A cannot reach the Gateway's own HTTP port even though the Gateway is attached to
  // A's network (required for SSH) -- Docker has no port-level ACL between peers on one bridge,
  // so this needs the host-level DOCKER-USER rule (+ br_netfilter) run-in-containers.sh applies.
  expect(await tcpReachable(containerA, gatewayIpOnA, 3102)).toBe(false);

  // Still works: the Gateway can still reach into A over SSH through the real runtime path (login
  // as A, read a file over SFTP). Deliberately `/api/remote/files` against a real file, not
  // `/api/threads`: the latter would bootstrap the Codex app-server and, on this container's
  // first real RPC connection, trigger the standalone-layout migration download described in
  // CLAUDE.md's "Codex 版本基准" section -- exactly the kind of concurrent-download contention
  // multi-user-isolation.spec.ts's own comments warn adds tens of seconds per container and that
  // running a second isolation-focused Gateway instance alongside the rest of this regression
  // group measurably worsened. `/etc/passwd` is a plain regular file baked into every Debian
  // image (unlike `~/.codex/config.toml`, which entrypoint.sh only writes at container *boot* and
  // is absent from the raw image), so it exists immediately -- `/api/remote/files` serves file
  // *content*, not a directory listing (a directory path 422s: RemoteFileNotRegularError).
  const memberToken = await login(request, memberA.username, memberA.password);
  const hosts = await authed(request, memberToken, "/api/hosts");
  expect(hosts.ok(), await hosts.text()).toBeTruthy();
  const hostList = z
    .array(z.looseObject({ id: z.number(), managed: z.boolean() }))
    .parse(await hosts.json());
  const managedHostId = hostList.find((host) => host.managed)?.id;
  expect(managedHostId).not.toBeUndefined();
  await expect
    .poll(
      async () => {
        const file = await authed(
          request,
          memberToken,
          `/api/remote/files?hostId=${managedHostId}&path=/etc/passwd`,
        );
        return file.status();
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBe(200);

  // Cleanup: full delete exercises the deprovision path's per-user network teardown too.
  for (const username of [memberA.username, memberB.username]) {
    const id = userIds.get(username)!;
    const res = await authed(request, adminToken, `/api/admin/users/${id}`, { method: "DELETE" });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});
