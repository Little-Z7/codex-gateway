#!/usr/bin/env node
import { argon2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const positionalArgs = [];
let isAdmin = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "--admin") {
    isAdmin = true;
  } else {
    positionalArgs.push(arg);
  }
}
const [usernameArg, passwordArg] = positionalArgs;
const username = (usernameArg || "").trim().toLowerCase();
const password = passwordArg || "";
const role = isAdmin ? "admin" : "user";

if (!username || !password) {
  console.error("Usage: node scripts/create-user.mjs [--admin] <username> <password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const configuredDbPath = process.env.CODEX_GATEWAY_DB_PATH;
const dbPath = resolve(
  configuredDbPath === undefined || configuredDbPath.length === 0
    ? "/data/codex-gateway.db"
    : configuredDbPath,
);
const directory = dirname(dbPath);
if (!existsSync(directory)) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS managed_hosts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready','provisioning','error','removed')),
    container_name TEXT UNIQUE,
    container_id TEXT,
    volume_name TEXT,
    ssh_public_key TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

const now = new Date().toISOString();
db.prepare(
  `
    INSERT INTO users (username, password_hash, is_active, role, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      is_active = 1,
      role = excluded.role,
      updated_at = excluded.updated_at
  `,
).run(username, hashPassword(password), role, now, now);

console.log(`User ${username} (${role}) is ready in ${dbPath}`);

function hashPassword(value) {
  const salt = randomBytes(16);
  const hash = argon2Sync("argon2id", {
    message: Buffer.from(value),
    nonce: salt,
    tagLength: 32,
    memory: 64 * 1024,
    passes: 3,
    parallelism: 1,
  });
  return `argon2id$${salt.toString("base64url")}$${Buffer.from(hash).toString("base64url")}`;
}
