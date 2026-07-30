-- up
-- Exaix Database Schema - Complete Initialization
-- The single source of truth for the journal DB schema: every table and column is
-- declared here in its current shape. There is no incremental migration history — the
-- former 002 (model registry) and 003 (provider_costs cache tokens) files were folded
-- in, and their ALTER TABLE steps became plain columns on the CREATE TABLE below.
-- Keeping the whole file to CREATE ... IF NOT EXISTS makes it idempotent, so it can be
-- re-applied over a database that a test helper already partially seeded.

-- ============================================================================
-- Activity Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_type TEXT,
  identity_id TEXT,
  agent_kind TEXT,
  action_type TEXT NOT NULL,
  target TEXT,
  payload TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0.0,
  timestamp DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_trace ON activity(trace_id);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity(actor);
CREATE INDEX IF NOT EXISTS idx_activity_identity ON activity(identity_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor_type ON activity(actor_type);
CREATE INDEX IF NOT EXISTS idx_activity_agent_kind ON activity(agent_kind);

-- ============================================================================
-- File Locking / Leases
-- ============================================================================

CREATE TABLE IF NOT EXISTS leases (
  file_path TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL,
  acquired_at DATETIME DEFAULT (datetime('now')),
  heartbeat_at DATETIME DEFAULT (datetime('now')),
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leases_expires ON leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_leases_identity ON leases(identity_id);

-- ============================================================================
-- Reviews (Git-based changes with approval workflow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,              -- UUID
  trace_id TEXT NOT NULL,           -- Link to request/plan
  portal TEXT NOT NULL,             -- Portal name
  branch TEXT NOT NULL,             -- Git branch name (feat/<desc>-<trace>)
  repository TEXT NOT NULL DEFAULT '',  -- Git repository path
  base_branch TEXT,                 -- Optional base/target branch for merge + diffs
  worktree_path TEXT,               -- Optional worktree path for worktree execution strategy
  status TEXT NOT NULL,             -- pending, approved, rejected
  description TEXT NOT NULL,        -- Description of changes
  commit_sha TEXT,                  -- Latest commit SHA from agent
  files_changed INTEGER DEFAULT 0,  -- Number of files in commit
  created TEXT NOT NULL,            -- ISO 8601 timestamp
  created_by TEXT NOT NULL,         -- Identity blueprint name that produced the review
  approved_at TEXT,                 -- Approval timestamp
  approved_by TEXT,                 -- User who approved
  rejected_at TEXT,                 -- Rejection timestamp
  rejected_by TEXT,                 -- User who rejected
  rejection_reason TEXT             -- Reason for rejection
);

CREATE INDEX IF NOT EXISTS idx_reviews_trace_id ON reviews(trace_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_portal ON reviews(portal);
CREATE INDEX IF NOT EXISTS idx_reviews_created_by ON reviews(created_by);
CREATE INDEX IF NOT EXISTS idx_reviews_branch ON reviews(branch);
CREATE INDEX IF NOT EXISTS idx_reviews_repository ON reviews(repository);

-- ============================================================================
-- Notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  proposal_id TEXT,
  trace_id TEXT,
  created_at TEXT NOT NULL,
  dismissed_at TEXT,
  metadata TEXT  -- JSON for extensibility
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_dismissed ON notifications(dismissed_at);
CREATE INDEX IF NOT EXISTS idx_notifications_proposal ON notifications(proposal_id);

-- ==========================================================================
-- Tool Confirmation Queue
-- ==========================================================================

CREATE TABLE IF NOT EXISTS pending_tool_confirmations (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  step_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved INTEGER,
  reason TEXT,
  decided_at TEXT,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_trace ON pending_tool_confirmations(trace_id);
CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_decided ON pending_tool_confirmations(decided_at);
CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_requested ON pending_tool_confirmations(requested_at);

-- ============================================================================
-- Provider Cost Tracking
-- ============================================================================
-- cost_source records HOW a row was priced (§5.5, D9): 'provider_reported'
-- (OpenRouter response cost / delegate session cost), 'registry_computed' (split
-- input/output per-Mtok), or NULL (blended estimate, library-compat path).
-- cache_read_tokens / cache_creation_tokens carry real tool-reported prompt-cache
-- usage (Claude Code CLI, opencode, session-delegate return.json). All three are
-- nullable: NULL means "not recorded", never 0, which would misread as "no cache use".

CREATE TABLE IF NOT EXISTS provider_costs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
  cost_source TEXT,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  trace_id TEXT,
  portal TEXT,
  timestamp DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_costs_provider ON provider_costs(provider);
CREATE INDEX IF NOT EXISTS idx_provider_costs_trace ON provider_costs(trace_id);
CREATE INDEX IF NOT EXISTS idx_provider_costs_portal ON provider_costs(portal);
CREATE INDEX IF NOT EXISTS idx_provider_costs_timestamp ON provider_costs(timestamp);

-- ============================================================================
-- Artifacts (Read-only agent outputs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  type TEXT NOT NULL CHECK (type IN ('analysis', 'report', 'diagram')),
  identity TEXT NOT NULL,
  portal TEXT,
  target_branch TEXT,               -- Optional target/base branch context for portal artifacts
  created TEXT NOT NULL,
  updated TEXT,
  request_id TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_identity ON artifacts(identity);
CREATE INDEX IF NOT EXISTS idx_artifacts_portal ON artifacts(portal);
CREATE INDEX IF NOT EXISTS idx_artifacts_request_id ON artifacts(request_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created DESC);

-- ============================================================================
-- Team live model registry (Phase 135, §5.2 / §5.5 / §5.8.2)
-- ============================================================================
-- Owned by ModelRegistryService (@exaix-team/model-registry-live). All timestamps are
-- epoch-ms stored as REAL, which avoids @db/sqlite's 32-bit INTEGER read truncation.
-- Empty tables ⇒ every registry read falls through to the Solo floor
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
  refreshed_at      REAL    NOT NULL,     -- epoch-ms
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

-- Real call latencies (written by recordLatency; consumed by a DEFERRED feature, §10).
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

-- Team benchmark data plane (§5.8.2). Scores are MODEL-properties, not route-properties:
-- keyed on (provider, model, benchmark), so a model scored once applies to every route
-- offering it. Empty ⇒ the top-N admission path and the `best` scorer find no scores.
CREATE TABLE IF NOT EXISTS model_benchmark (
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  benchmark       TEXT    NOT NULL,   -- e.g. 'swe_bench_verified'
  score           REAL    NOT NULL,   -- normalised 0..1 (validated at write)
  harness_version TEXT,               -- benchmark harness/version, when published
  provenance      TEXT    NOT NULL,   -- 'static' (curated) | 'remote_static' (models.dev ingest)
  measured_at     REAL    NOT NULL,   -- epoch-ms
  source_url      TEXT,               -- citable publication / dataset URL
  PRIMARY KEY (provider, model, benchmark)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_rank ON model_benchmark (benchmark, score DESC);

-- down
DROP INDEX IF EXISTS idx_benchmark_rank;
DROP TABLE IF EXISTS model_benchmark;
DROP TABLE IF EXISTS registry_refresh_audit;
DROP TABLE IF EXISTS provider_rate_limit;
DROP INDEX IF EXISTS idx_latency_lookup;
DROP TABLE IF EXISTS model_latency;
DROP TABLE IF EXISTS model_pricing;
DROP TABLE IF EXISTS model_catalog;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS provider_costs;
DROP TABLE IF EXISTS pending_tool_confirmations;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS leases;
DROP TABLE IF EXISTS activity;
