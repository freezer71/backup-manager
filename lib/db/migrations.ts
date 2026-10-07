// Chaque entrée est appliquée une seule fois, dans l'ordre. Ne jamais modifier une entrée publiée :
// ajouter une nouvelle entrée à la fin.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE user (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_pending_secret TEXT,
    totp_last_step INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    totp_ok INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY,
    ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    success INTEGER NOT NULL
  );
  CREATE INDEX login_attempts_ip ON login_attempts (ip, attempted_at);
  CREATE TABLE environments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE secrets (
    id INTEGER PRIMARY KEY,
    environment_id INTEGER NOT NULL REFERENCES environments (id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (environment_id, key)
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    environment_id INTEGER REFERENCES environments (id) ON DELETE RESTRICT,
    script TEXT NOT NULL,
    cron TEXT NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 14,
    nas_copy INTEGER NOT NULL DEFAULT 1,
    timeout_minutes INTEGER NOT NULL DEFAULT 60,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    stamp TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    size_bytes INTEGER,
    files TEXT NOT NULL DEFAULT '[]',
    log TEXT NOT NULL DEFAULT '',
    nas_status TEXT NOT NULL DEFAULT 'n/a',
    nas_error TEXT,
    pruned INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX runs_project ON runs (project_id, id DESC);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE login_attempts ADD COLUMN kind TEXT NOT NULL DEFAULT 'password';
  CREATE INDEX login_attempts_kind ON login_attempts (kind, attempted_at);
  `,
  `
  CREATE TABLE trusted_devices (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  `,
  `
  ALTER TABLE runs ADD COLUMN script_ms INTEGER;
  ALTER TABLE runs ADD COLUMN nas_ms INTEGER;
  `,
];
