import { randomBytes } from "node:crypto";
import type { GatewayConfig } from "~~/shared/types";
import { defaultGatewayConfig } from "../../../../shared/config";
import { gatewayDatabase, gatewayDatabaseExists } from "../storage/database";
import { MANAGED_HOST_STATUSES, type ManagedHostStatus } from "../storage/schema";
import { parseGatewayConfig } from "../http/validation/config";
import {
  decryptJson,
  encryptJson,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../storage/crypto";
import { sessionRevocationEvents } from "./session-events";
import { sessionActivityTracker } from "./session-activity-tracker";
import { securitySettings } from "../settings/model-provider";

export type GatewayUserRole = "admin" | "user";

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: GatewayUserRole;
  displayName?: string | null;
  mustChangePassword?: boolean;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}

export interface AdminUserRecord {
  id: number;
  username: string;
  role: GatewayUserRole;
  isActive: boolean;
  createdAt: string;
  displayName: string | null;
  note: string | null;
  mustChangePassword: boolean;
}

export interface ManagedHostRecord {
  userId: number;
  hostId: number;
  status: ManagedHostStatus;
  containerName: string | null;
  containerId: string | null;
  volumeName: string | null;
  sshPublicKey: string | null;
  lastError: string | null;
  memoryLimit: string | null;
  cpuLimit: string | null;
  /** Per-user isolated Docker network name (CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user); null
   *  in "shared" mode. */
  networkName: string | null;
  networkSubnet: string | null;
  createdAt: string;
  updatedAt: string;
}

// Session lifetime resolves through the settings layer (admin-editable; default 30 days).
function sessionDays() {
  return securitySettings().sessionDays;
}

export const userStore = {
  createUser(
    username: string,
    password: string,
    role: GatewayUserRole = "user",
    options: {
      mustChangePassword?: boolean;
      displayName?: string | null;
      note?: string | null;
    } = {},
  ) {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      throw new Error("Username is required");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const now = new Date().toISOString();
    const displayName = emptyToNull(options.displayName);
    const note = emptyToNull(options.note);
    gatewayDatabase()
      .prepare(
        `INSERT INTO users
           (username, password_hash, is_active, role, display_name, note, must_change_password, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized,
        hashPassword(password),
        role,
        displayName,
        note,
        options.mustChangePassword === true ? 1 : 0,
        now,
        now,
      );
    return this.findByUsername(normalized);
  },

  findByUsername(username: string) {
    const row = gatewayDatabase()
      .prepare(
        `SELECT id, username, password_hash, is_active, role, display_name, note, must_change_password
           FROM users WHERE username = ?`,
      )
      .get(normalizeUsername(username));
    return row
      ? {
          id: Number(row.id),
          username: String(row.username),
          passwordHash: String(row.password_hash),
          isActive: Number(row.is_active) === 1,
          role: rowRole(row.role),
          displayName: rowText(row.display_name),
          note: rowText(row.note),
          mustChangePassword: Number(row.must_change_password) === 1,
        }
      : null;
  },

  findById(id: number): AdminUserRecord | null {
    const row = gatewayDatabase()
      .prepare(
        `SELECT id, username, role, is_active, created_at, display_name, note, must_change_password
           FROM users WHERE id = ?`,
      )
      .get(id);
    return row ? adminUserFromRow(row) : null;
  },

  listUsers(): AdminUserRecord[] {
    return gatewayDatabase()
      .prepare(
        `SELECT id, username, role, is_active, created_at, display_name, note, must_change_password
           FROM users ORDER BY id ASC`,
      )
      .all()
      .map(adminUserFromRow);
  },

  countActiveAdmins(): number {
    const row = gatewayDatabase()
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1")
      .get();
    return Number(row?.count ?? 0);
  },

  updateUser(
    id: number,
    changes: {
      isActive?: boolean;
      role?: GatewayUserRole;
      password?: string;
      displayName?: string | null;
      note?: string | null;
      mustChangePassword?: boolean;
    },
  ) {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (changes.isActive !== undefined) {
      assignments.push("is_active = ?");
      values.push(changes.isActive ? 1 : 0);
    }
    if (changes.role !== undefined) {
      assignments.push("role = ?");
      values.push(changes.role);
    }
    if (changes.password !== undefined) {
      assignments.push("password_hash = ?");
      values.push(hashPassword(changes.password));
    }
    if (changes.displayName !== undefined) {
      assignments.push("display_name = ?");
      values.push(emptyToNull(changes.displayName));
    }
    if (changes.note !== undefined) {
      assignments.push("note = ?");
      values.push(emptyToNull(changes.note));
    }
    if (changes.mustChangePassword !== undefined) {
      assignments.push("must_change_password = ?");
      values.push(changes.mustChangePassword ? 1 : 0);
    }
    if (assignments.length === 0) {
      return this.findById(id);
    }
    assignments.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    gatewayDatabase()
      .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...values);
    return this.findById(id);
  },

  deleteUser(id: number) {
    this.revokeUserSessions(id);
    gatewayDatabase().prepare("DELETE FROM users WHERE id = ?").run(id);
  },

  verifyUserPassword(userId: number, password: string) {
    const row = gatewayDatabase()
      .prepare("SELECT password_hash, is_active FROM users WHERE id = ?")
      .get(userId);
    if (!row || Number(row.is_active) !== 1) return false;
    return verifyPassword(password, String(row.password_hash));
  },

  changePassword(userId: number, newPassword: string) {
    if (newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    gatewayDatabase()
      .prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
      )
      .run(hashPassword(newPassword), new Date().toISOString(), userId);
  },

  mustChangePassword(userId: number) {
    const row = gatewayDatabase()
      .prepare("SELECT must_change_password FROM users WHERE id = ?")
      .get(userId);
    return Number(row?.must_change_password ?? 0) === 1;
  },

  revokeOtherUserSessions(userId: number, keepToken: string) {
    const keepHash = keepToken === "" ? null : hashToken(keepToken);
    const rows = gatewayDatabase()
      .prepare("SELECT token_hash FROM sessions WHERE user_id = ?")
      .all(userId);
    const revoked = rows
      .map((row) => String(row.token_hash))
      .filter((tokenHash) => tokenHash !== keepHash);
    if (!revoked.length) return;
    const stmt = gatewayDatabase().prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash = ?",
    );
    for (const tokenHash of revoked) {
      stmt.run(userId, tokenHash);
      sessionActivityTracker.forget(tokenHash);
      sessionRevocationEvents.emit(tokenHash);
    }
  },

  revokeUserSessions(userId: number) {
    const rows = gatewayDatabase()
      .prepare("SELECT token_hash FROM sessions WHERE user_id = ?")
      .all(userId);
    if (!rows.length) {
      return;
    }
    gatewayDatabase().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    for (const row of rows) {
      const tokenHash = String(row.token_hash);
      sessionActivityTracker.forget(tokenHash);
      sessionRevocationEvents.emit(tokenHash);
    }
  },

  getManagedHost(userId: number): ManagedHostRecord | null {
    const row = gatewayDatabase()
      .prepare("SELECT * FROM managed_hosts WHERE user_id = ?")
      .get(userId);
    return row ? managedHostFromRow(row) : null;
  },

  listManagedHosts(): Map<number, ManagedHostRecord> {
    const rows = gatewayDatabase().prepare("SELECT * FROM managed_hosts").all();
    return new Map(rows.map((row) => [Number(row.user_id), managedHostFromRow(row)]));
  },

  listManagedHostsByStatus(status: ManagedHostStatus): ManagedHostRecord[] {
    const rows = gatewayDatabase()
      .prepare("SELECT * FROM managed_hosts WHERE status = ?")
      .all(status);
    return rows.map((row) => managedHostFromRow(row));
  },

  upsertManagedHost(
    userId: number,
    hostId: number,
    fields: Partial<
      Pick<
        ManagedHostRecord,
        | "status"
        | "containerName"
        | "containerId"
        | "volumeName"
        | "sshPublicKey"
        | "lastError"
        | "networkName"
        | "networkSubnet"
      >
    > = {},
  ) {
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare(
        `
          INSERT INTO managed_hosts
            (user_id, host_id, status, container_name, container_id, volume_name, ssh_public_key, last_error, network_name, network_subnet, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            host_id = excluded.host_id,
            status = excluded.status,
            container_name = excluded.container_name,
            container_id = excluded.container_id,
            volume_name = excluded.volume_name,
            ssh_public_key = excluded.ssh_public_key,
            last_error = excluded.last_error,
            network_name = COALESCE(excluded.network_name, managed_hosts.network_name),
            network_subnet = COALESCE(excluded.network_subnet, managed_hosts.network_subnet),
            updated_at = excluded.updated_at
        `,
      )
      .run(
        userId,
        hostId,
        assertManagedHostStatus(fields.status ?? "ready"),
        fields.containerName ?? null,
        fields.containerId ?? null,
        fields.volumeName ?? null,
        fields.sshPublicKey ?? null,
        fields.lastError ?? null,
        fields.networkName ?? null,
        fields.networkSubnet ?? null,
        now,
        now,
      );
  },

  setManagedHostQuota(
    userId: number,
    quota: { memoryLimit: string | null; cpuLimit: string | null },
  ) {
    const now = new Date().toISOString();
    const result = gatewayDatabase()
      .prepare(
        `UPDATE managed_hosts SET memory_limit = ?, cpu_limit = ?, updated_at = ? WHERE user_id = ?`,
      )
      .run(quota.memoryLimit, quota.cpuLimit, now, userId);
    return Number(result.changes) > 0;
  },

  deleteManagedHost(userId: number) {
    gatewayDatabase().prepare("DELETE FROM managed_hosts WHERE user_id = ?").run(userId);
  },

  async login(username: string, password: string): Promise<AuthSession | null> {
    const user = this.findByUsername(username);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionDays() * 86_400_000).toISOString();
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare(
        "INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(user.id, hashToken(token), expiresAt, now, now);
    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        mustChangePassword: user.mustChangePassword,
      },
    };
  },

  authenticateToken(token: string): AuthenticatedUser | null {
    if (!token) {
      return null;
    }
    const tokenHash = hashToken(token);
    const row = gatewayDatabase()
      .prepare(
        `
          SELECT users.id, users.username, users.is_active, users.role, sessions.expires_at
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.token_hash = ?
        `,
      )
      .get(tokenHash);
    if (!row || Number(row.is_active) !== 1) {
      return null;
    }
    if (Date.parse(String(row.expires_at)) <= Date.now()) {
      this.deleteToken(token);
      return null;
    }
    sessionActivityTracker.touch(tokenHash);
    return { id: Number(row.id), username: String(row.username), role: rowRole(row.role) };
  },

  deleteToken(token: string) {
    const tokenHash = hashToken(token);
    sessionActivityTracker.forget(tokenHash);
    const result = gatewayDatabase()
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);
    if (result.changes > 0) {
      sessionRevocationEvents.emit(tokenHash);
    }
  },

  deleteExpiredSessions() {
    const now = new Date().toISOString();
    const rows = gatewayDatabase()
      .prepare("SELECT token_hash FROM sessions WHERE expires_at <= ?")
      .all(now);
    if (!rows.length) {
      return 0;
    }
    const result = gatewayDatabase().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    for (const row of rows) {
      sessionRevocationEvents.emit(String(row.token_hash));
    }
    return Number(result.changes);
  },

  loadConfig(userId: number): GatewayConfig {
    const row = gatewayDatabase()
      .prepare("SELECT encrypted_config_json FROM user_configs WHERE user_id = ?")
      .get(userId);
    if (
      row === undefined ||
      row.encrypted_config_json === null ||
      row.encrypted_config_json === undefined ||
      row.encrypted_config_json === ""
    ) {
      return defaultGatewayConfig();
    }
    return {
      ...defaultGatewayConfig(),
      ...parseGatewayConfig(decryptJson(String(row.encrypted_config_json))),
    };
  },

  saveConfig(userId: number, config: GatewayConfig) {
    const encrypted = encryptJson(config);
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare(
        `
          INSERT INTO user_configs (user_id, encrypted_config_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            encrypted_config_json = excluded.encrypted_config_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(userId, encrypted, now);
  },

  listStoredConfigs(): Array<{ user: AuthenticatedUser; config: GatewayConfig }> {
    if (!gatewayDatabaseExists()) {
      return [];
    }
    const rows = gatewayDatabase()
      .prepare(
        `
          SELECT users.id, users.username, users.role, user_configs.encrypted_config_json
          FROM users
          JOIN user_configs ON user_configs.user_id = users.id
          WHERE users.is_active = 1
          ORDER BY users.id ASC
        `,
      )
      .all();
    return rows.map((row) => ({
      user: {
        id: Number(row.id),
        username: String(row.username),
        role: rowRole(row.role),
      },
      config: {
        ...defaultGatewayConfig(),
        ...parseGatewayConfig(decryptJson(String(row.encrypted_config_json))),
      },
    }));
  },
};

type SqlRow = Record<string, string | number | bigint | Uint8Array | null | undefined>;

function rowRole(value: unknown): GatewayUserRole {
  return value === "admin" ? "admin" : "user";
}

function isManagedHostStatus(value: unknown): value is ManagedHostStatus {
  return typeof value === "string" && (MANAGED_HOST_STATUSES as readonly string[]).includes(value);
}

function assertManagedHostStatus(value: string): ManagedHostStatus {
  if (!isManagedHostStatus(value)) {
    throw new Error(`Invalid managed host status: ${value}`);
  }
  return value;
}

function managedHostStatus(value: unknown): ManagedHostStatus {
  return isManagedHostStatus(value) ? value : "ready";
}

function rowText(value: string | number | bigint | Uint8Array | null | undefined) {
  return value == null ? null : String(value);
}

function adminUserFromRow(row: SqlRow): AdminUserRecord {
  return {
    id: Number(row.id),
    username: String(row.username),
    role: rowRole(row.role),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    displayName: rowText(row.display_name),
    note: rowText(row.note),
    mustChangePassword: Number(row.must_change_password) === 1,
  };
}

function emptyToNull(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function managedHostFromRow(row: SqlRow): ManagedHostRecord {
  return {
    userId: Number(row.user_id),
    hostId: Number(row.host_id),
    status: managedHostStatus(row.status),
    containerName: rowText(row.container_name),
    containerId: rowText(row.container_id),
    volumeName: rowText(row.volume_name),
    sshPublicKey: rowText(row.ssh_public_key),
    lastError: rowText(row.last_error),
    memoryLimit: rowText(row.memory_limit),
    cpuLimit: rowText(row.cpu_limit),
    networkName: rowText(row.network_name),
    networkSubnet: rowText(row.network_subnet),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}
