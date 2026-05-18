-- up
-- Exaix Database Schema - Complete Initialization
-- All tables and columns created at once with current schema

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
  identity_id TEXT NOT NULL,        -- Identity blueprint name
  approved_at TEXT,                 -- Approval timestamp
  approved_by TEXT,                 -- User who approved
  rejected_at TEXT,                 -- Rejection timestamp
  rejected_by TEXT,                 -- User who rejected
  rejection_reason TEXT             -- Reason for rejection
);

CREATE INDEX IF NOT EXISTS idx_reviews_trace_id ON reviews(trace_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_portal ON reviews(portal);
CREATE INDEX IF NOT EXISTS idx_reviews_identity_id ON reviews(identity_id);
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

CREATE TABLE IF NOT EXISTS provider_costs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
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

-- down
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS provider_costs;
DROP TABLE IF EXISTS pending_tool_confirmations;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS leases;
DROP TABLE IF EXISTS activity;
