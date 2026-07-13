-- up
-- Phase 135: Team live model registry — catalog, pricing, cost-source tracking, and
-- benchmark data plane (§5.2, §5.5/D9, §5.8.2). Owned by ModelRegistryService
-- (@exaix-team/model-registry-live). All timestamps epoch-ms. Empty tables ⇒ every
-- registry read falls through to the Solo floor (DefaultModelRegistry), so a Team
-- daemon with no refresh behaves like Solo.

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

-- provider_costs gains a nullable cost_source column so each cost record records HOW
-- it was priced (§5.5, D9) — 'provider_reported' (OpenRouter response cost / delegate
-- session cost), 'registry_computed' (split input/output per-Mtok), or NULL (legacy
-- blended estimate, library-compat path). Nullable so pre-existing rows remain valid.
ALTER TABLE provider_costs ADD COLUMN cost_source TEXT;

-- Team benchmark data plane (§5.8.2 — the 6th registry table). Scores are
-- MODEL-properties, not route-properties: keyed on (provider, model, benchmark), so a
-- model scored once applies to every route offering it. Empty ⇒ the top-N admission
-- path and the `best` scorer find no scores and no-op.
CREATE TABLE IF NOT EXISTS model_benchmark (
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  benchmark       TEXT    NOT NULL,   -- e.g. 'swe_bench_verified'
  score           REAL    NOT NULL,   -- normalised 0..1 (validated at write)
  harness_version TEXT,               -- benchmark harness/version, when published
  provenance      TEXT    NOT NULL,   -- 'static' (curated) | 'remote_static' (models.dev ingest)
  measured_at     REAL    NOT NULL,   -- epoch-ms; REAL avoids 32-bit INTEGER read truncation
  source_url      TEXT,               -- citable publication / dataset URL
  PRIMARY KEY (provider, model, benchmark)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_rank ON model_benchmark (benchmark, score DESC);

-- down
DROP INDEX IF EXISTS idx_benchmark_rank;
DROP TABLE IF EXISTS model_benchmark;

-- SQLite has no DROP COLUMN before 3.35; recreate provider_costs without cost_source.
CREATE TABLE provider_costs_new (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  model TEXT,
  trace_id TEXT,
  portal TEXT,
  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
  timestamp DATETIME DEFAULT (datetime('now'))
);
INSERT INTO provider_costs_new (id, provider, requests, tokens, prompt_tokens, completion_tokens, model, trace_id, portal, estimated_cost_usd, timestamp)
  SELECT id, provider, requests, tokens, prompt_tokens, completion_tokens, model, trace_id, portal, estimated_cost_usd, timestamp FROM provider_costs;
DROP TABLE provider_costs;
ALTER TABLE provider_costs_new RENAME TO provider_costs;
CREATE INDEX IF NOT EXISTS idx_provider_costs_provider ON provider_costs(provider);
CREATE INDEX IF NOT EXISTS idx_provider_costs_trace ON provider_costs(trace_id);
CREATE INDEX IF NOT EXISTS idx_provider_costs_portal ON provider_costs(portal);
CREATE INDEX IF NOT EXISTS idx_provider_costs_timestamp ON provider_costs(timestamp);

DROP INDEX IF EXISTS idx_latency_lookup;
DROP TABLE IF EXISTS registry_refresh_audit;
DROP TABLE IF EXISTS provider_rate_limit;
DROP TABLE IF EXISTS model_latency;
DROP TABLE IF EXISTS model_pricing;
DROP TABLE IF EXISTS model_catalog;
