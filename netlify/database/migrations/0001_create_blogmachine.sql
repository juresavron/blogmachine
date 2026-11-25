-- Durable Blog Machine content. Demo seed data is inserted once by the runtime.
CREATE TABLE IF NOT EXISTS blogmachine_sites (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE
);

CREATE TABLE IF NOT EXISTS blogmachine_posts (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE
);

CREATE TABLE IF NOT EXISTS blogmachine_publications (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  data JSONB NOT NULL,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  UNIQUE(post_id, site_id)
);

CREATE TABLE IF NOT EXISTS blogmachine_repository_changes (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE
);

CREATE TABLE IF NOT EXISTS blogmachine_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
