// Self-contained schema definition shared by the Nitro server and scripts/create-user.mjs.
// Keep this file dependency-free (node:sqlite types only) and erasable-syntax-only: the script
// loads it through Node's type stripping without a bundler or path aliases.
import type { DatabaseSync } from "node:sqlite";

// managed_hosts.status is validated in the application layer; the table itself carries no CHECK
// so new lifecycle values do not require a table rebuild.
export const MANAGED_HOST_STATUSES = [
  "ready",
  "provisioning",
  "missing",
  "error",
  "removed",
] as const;
export type ManagedHostStatus = (typeof MANAGED_HOST_STATUSES)[number];

export function migrateGatewaySchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_name TEXT,
      note TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_configs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tmux_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL,
      project_id INTEGER,
      thread_id TEXT,
      thread_title TEXT,
      session_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_created INTEGER NOT NULL,
      window_index INTEGER NOT NULL,
      window_name TEXT NOT NULL,
      pane_index INTEGER NOT NULL,
      pane_id TEXT NOT NULL,
      pane_pid INTEGER NOT NULL,
      initial_command TEXT NOT NULL,
      last_command TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'once' CHECK (mode IN ('once', 'permanent')),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
      completion_reason TEXT,
      created_at TEXT NOT NULL,
      run_started_at TEXT,
      last_checked_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      last_error_at TEXT,
      notification_sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tmux_monitors_host
      ON tmux_monitors(user_id, host_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tmux_monitors_active_location
      ON tmux_monitors(user_id, host_id, session_name, window_index, pane_index)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      target_label TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(actor_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS usage_daily (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      model TEXT NOT NULL,
      threads INTEGER NOT NULL DEFAULT 0,
      turns INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, day, model)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day);

    CREATE TABLE IF NOT EXISTS gateway_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS managed_hosts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      container_name TEXT UNIQUE,
      container_id TEXT,
      volume_name TEXT,
      ssh_public_key TEXT,
      last_error TEXT,
      memory_limit TEXT,
      cpu_limit TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_budgets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_tokens INTEGER,
      monthly_tokens INTEGER,
      daily_turns INTEGER,
      monthly_turns INTEGER,
      updated_at TEXT NOT NULL
    );
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }

  // Databases created before the CHECK constraint was dropped still enforce it; rebuild the
  // table so 'missing' and future statuses can be written.
  const managedHostsSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'managed_hosts'")
    .get();
  if (
    managedHostsSql !== undefined &&
    String(managedHostsSql.sql ?? "")
      .toUpperCase()
      .includes("CHECK")
  ) {
    db.exec(`
      BEGIN;
      CREATE TABLE managed_hosts_new (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        host_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        container_name TEXT UNIQUE,
        container_id TEXT,
        volume_name TEXT,
        ssh_public_key TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO managed_hosts_new SELECT * FROM managed_hosts;
      DROP TABLE managed_hosts;
      ALTER TABLE managed_hosts_new RENAME TO managed_hosts;
      COMMIT;
    `);
  }

  // Per-user resource quota overrides; NULL means fall back to the global env limits.
  const managedColumns = db.prepare("PRAGMA table_info(managed_hosts)").all();
  if (!managedColumns.some((column) => column.name === "memory_limit")) {
    db.exec("ALTER TABLE managed_hosts ADD COLUMN memory_limit TEXT");
  }
  if (!managedColumns.some((column) => column.name === "cpu_limit")) {
    db.exec("ALTER TABLE managed_hosts ADD COLUMN cpu_limit TEXT");
  }

  if (!userColumns.some((column) => column.name === "must_change_password")) {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
  }
  if (!userColumns.some((column) => column.name === "note")) {
    db.exec("ALTER TABLE users ADD COLUMN note TEXT");
  }
}
