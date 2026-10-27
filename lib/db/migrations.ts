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
  `
  -- Secret contenant l'URL de la base : seule destination réseau du script dans la sandbox. Les projets existants
  -- reprennent le secret que leur script utilise (modèles Postgres et MongoDB), sinon aucun réseau.
  ALTER TABLE projects ADD COLUMN network_secret TEXT;
  UPDATE projects SET network_secret = CASE
    WHEN script LIKE '%DATABASE_URL%' THEN 'DATABASE_URL'
    WHEN script LIKE '%MONGO_URI%' THEN 'MONGO_URI'
  END;
  -- Expiration après inactivité, et dernière confirmation par code TOTP (actions sensibles).
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  ALTER TABLE sessions ADD COLUMN reauth_at TEXT;
  `,
  `
  -- Un projet = une base : son type et son URL de connexion remplacent l'environnement de secrets et le script.
  -- L'URL est reprise du secret que la sandbox ouvrait déjà au réseau (network_secret) ; un projet sans URL
  -- est désactivé. Table reconstruite (on ne peut pas supprimer une colonne de clé étrangère) : migrate()
  -- désactive les clés étrangères, sinon DROP TABLE projects supprimerait les runs en cascade.
  CREATE TABLE projects_new (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    db_kind TEXT NOT NULL CHECK (db_kind IN ('postgres', 'mongodb')),
    db_url TEXT,
    cron TEXT NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 14,
    nas_copy INTEGER NOT NULL DEFAULT 1,
    timeout_minutes INTEGER NOT NULL DEFAULT 60,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO projects_new (id, name, slug, db_kind, db_url, cron, retention_count, nas_copy, timeout_minutes, enabled, created_at, updated_at)
  SELECT p.id, p.name, p.slug,
    CASE WHEN p.network_secret = 'MONGO_URI' OR p.script LIKE '%mongodump%' THEN 'mongodb' ELSE 'postgres' END,
    s.value,
    p.cron, p.retention_count, p.nas_copy, p.timeout_minutes,
    CASE WHEN s.value IS NULL THEN 0 ELSE p.enabled END,
    p.created_at, p.updated_at
  FROM projects p
  LEFT JOIN secrets s ON s.environment_id = p.environment_id AND s.key = p.network_secret;
  DROP TABLE projects;
  ALTER TABLE projects_new RENAME TO projects;
  DROP TABLE secrets;
  DROP TABLE environments;
  `,
  `
  -- Type mysql (MySQL / MariaDB) : SQLite ne sait pas modifier une contrainte CHECK, la table est reconstruite.
  CREATE TABLE projects_new (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    db_kind TEXT NOT NULL CHECK (db_kind IN ('postgres', 'mongodb', 'mysql')),
    db_url TEXT,
    cron TEXT NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 14,
    nas_copy INTEGER NOT NULL DEFAULT 1,
    timeout_minutes INTEGER NOT NULL DEFAULT 60,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO projects_new SELECT id, name, slug, db_kind, db_url, cron, retention_count, nas_copy, timeout_minutes, enabled, created_at, updated_at
  FROM projects;
  DROP TABLE projects;
  ALTER TABLE projects_new RENAME TO projects;
  `,
];
