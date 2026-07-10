-- up
-- Phase 135 Step 1: Team live model-registry catalog (§5.2 — five core tables).
-- Owned by ModelRegistryService (@exaix-team/model-registry-live). All timestamps
-- epoch-ms. Empty tables ⇒ every registry read falls through to the Solo floor
-- (DefaultModelRegistry), so a Team daemon with no refresh behaves like Solo.

-- The live model catalog: one row per (provider, model). Model-granular.
CREATE TABLE IF NOT EXISTS model_catalog (
  provider          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  display_name      TEXT,
  context_window    INTEGER,              -- max input tokens
  max_output_tokens INTEGER,
  supports_thinking INTEGER NOT NULL DEFAULT 0,   -- 0/1
  supports_effort   INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT,                 -- raw provider capability blob (audit/forward-compat)
  source            TEXT    NOT NULL,     -- 'endpoint' | 'static' — where this row came from
  refreshed_at      REAL    NOT NULL,     -- epoch-ms; REAL avoids @db/sqlite's 32-bit INTEGER read truncation
  released_at       REAL,                 -- provider-declared model release (Anthropic created_at), epoch-ms
  PRIMARY KEY (provider, model)
);

-- Verified/known token prices. Separate table so pricing provenance is first-class
-- and a price refresh can run on a different cadence than the catalog refresh.
CREATE TABLE IF NOT EXISTS model_pricing (
  provider          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  input_per_mtok    REAL,                 -- USD per 1M input tokens
  output_per_mtok   REAL,                 -- USD per 1M output tokens
  cache_read_per_mtok  REAL,              -- optional (F6): discounted rate for cached-input tokens
  cache_write_per_mtok REAL,              -- optional (F6): rate for cache-creation tokens
  provenance        TEXT    NOT NULL,     -- 'endpoint' | 'static' | 'remote_static' | 'unknown'
  verified_at       REAL,                 -- epoch-ms when this price was confirmed against its source
  source_url        TEXT,                 -- doc/endpoint/catalog the price came from (audit)
  PRIMARY KEY (provider, model)
);

-- Real call latencies (populated by recordLatency; consumed by a DEFERRED feature, §10).
CREATE TABLE IF NOT EXISTS model_latency (
  provider   TEXT    NOT NULL,
  model      TEXT    NOT NULL,
  latency_ms INTEGER NOT NULL,
  recorded_at REAL    NOT NULL          -- epoch-ms
);
CREATE INDEX IF NOT EXISTS idx_latency_lookup ON model_latency (provider, model, recorded_at);

-- Per-provider rate-limit headroom (recordCall / getRateLimit).
-- NOTE (F4): self-counted. max_rpm comes from config / provider default, NOT from
-- provider response headers.
CREATE TABLE IF NOT EXISTS provider_rate_limit (
  provider   TEXT    NOT NULL PRIMARY KEY,
  remaining  INTEGER NOT NULL,
  max_rpm    INTEGER NOT NULL,       -- configured ceiling, not provider-reported
  reset_at   REAL    NOT NULL        -- epoch-ms
);

-- Refresh audit trail: every refresh attempt, its outcome, and what changed.
CREATE TABLE IF NOT EXISTS registry_refresh_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT    NOT NULL,
  kind          TEXT    NOT NULL,   -- 'catalog' | 'pricing'
  outcome       TEXT    NOT NULL,   -- 'success' | 'skipped_offline' | 'auth_error' | 'http_error' | 'parse_error'
  models_added  INTEGER NOT NULL DEFAULT 0,
  models_removed INTEGER NOT NULL DEFAULT 0,
  started_at    REAL    NOT NULL,   -- epoch-ms
  duration_ms   INTEGER NOT NULL,
  detail        TEXT               -- error message / summary (NEVER contains the API key)
);

-- down
DROP INDEX IF EXISTS idx_latency_lookup;
DROP TABLE IF EXISTS registry_refresh_audit;
DROP TABLE IF EXISTS provider_rate_limit;
DROP TABLE IF EXISTS model_latency;
DROP TABLE IF EXISTS model_pricing;
DROP TABLE IF EXISTS model_catalog;
