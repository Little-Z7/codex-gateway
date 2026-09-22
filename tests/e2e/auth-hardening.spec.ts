import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/app";

const API = "/gw/api";

const loginSchema = z.looseObject({ token: z.string() });
const lockoutsSchema = z.looseObject({
  lockouts: z.array(z.looseObject({ key: z.string() })),
});
const auditSchema = z.looseObject({
  entries: z.array(z.looseObject({ action: z.string() })),
});

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { username, password } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as unknown };
}

async function adminToken(request: APIRequestContext) {
  const { status, body } = await login(request, E2E_USERNAME, E2E_PASSWORD);
  expect(status).toBe(200);
  return loginSchema.parse(body).token;
}

async function createMember(
  request: APIRequestContext,
  token: string,
  username: string,
  password: string,
) {
  const res = await request.post(`${API}/admin/users`, {
    headers: { authorization: `Bearer ${token}` },
    data: { username, password, role: "user", provision: false },
  });
  expect(res.status()).toBe(200);
}

async function authed(
  request: APIRequestContext,
  token: string,
  method: "get" | "post" | "delete",
  url: string,
  body?: unknown,
) {
  const res = await request.fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}` },
    data: body,
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as unknown };
}

test.describe.configure({ mode: "serial" });

test("password change revokes other sessions and the new password works", async ({ request }) => {
  const admin = await adminToken(request);
  const name = `pwd-${Date.now().toString(36)}`.slice(0, 30);
  const firstPassword = "first-password-ok";
  const secondPassword = "second-password-ok";
  await createMember(request, admin, name, firstPassword);

  const loginA = await login(request, name, firstPassword);
  const loginB = await login(request, name, firstPassword);
  const tokenA = loginSchema.parse(loginA.body).token;
  const tokenB = loginSchema.parse(loginB.body).token;

  // Wrong current password is rejected.
  const bad = await authed(request, tokenA, "post", `${API}/auth/password`, {
    currentPassword: "not-the-password",
    newPassword: secondPassword,
  });
  expect(bad.status).toBe(403);

  const ok = await authed(request, tokenA, "post", `${API}/auth/password`, {
    currentPassword: firstPassword,
    newPassword: secondPassword,
  });
  expect(ok.status).toBe(200);

  // The other session is revoked; the one that changed the password stays valid.
  expect((await authed(request, tokenB, "get", `${API}/auth/me`)).status).toBe(401);
  expect((await authed(request, tokenA, "get", `${API}/auth/me`)).status).toBe(200);

  expect((await login(request, name, firstPassword)).status).toBe(401);
  expect((await login(request, name, secondPassword)).status).toBe(200);
});

test("five failed logins lock the account; admin unlock restores access and audits", async ({
  request,
}) => {
  const admin = await adminToken(request);
  const name = `lock-${Date.now().toString(36)}`.slice(0, 30);
  await createMember(request, admin, name, "lock-member-password");

  for (let i = 0; i < 5; i += 1) {
    expect((await login(request, name, "wrong-password")).status).toBe(401);
  }
  const locked = await login(request, name, "lock-member-password");
  expect(locked.status).toBe(429);
  const lockedBody = z
    .looseObject({ data: z.looseObject({ retryAfterSeconds: z.number() }) })
    .parse(locked.body);
  expect(lockedBody.data.retryAfterSeconds).toBeGreaterThan(0);

  const lockouts = await authed(request, admin, "get", `${API}/admin/security/lockouts`);
  expect(lockouts.status).toBe(200);
  const entries = lockoutsSchema.parse(lockouts.body).lockouts;
  expect(entries.some((entry) => entry.key === `u:${name}`)).toBe(true);

  // Unlock every entry: the username lock plus the source-IP lock — the whole E2E topology
  // shares one client IP, so leaving it locked would break unrelated specs.
  for (const entry of entries) {
    const unlock = await authed(request, admin, "delete", `${API}/admin/security/lockouts`, {
      key: entry.key,
    });
    expect(unlock.status).toBe(200);
  }

  expect((await login(request, name, "lock-member-password")).status).toBe(200);

  const audit = await authed(
    request,
    admin,
    "get",
    `${API}/admin/audit?action=session.login.failed&limit=20`,
  );
  expect(audit.status).toBe(200);
  const rows = auditSchema.parse(audit.body).entries;
  expect(rows.some((row) => row.action === "session.login.failed")).toBe(true);
});
