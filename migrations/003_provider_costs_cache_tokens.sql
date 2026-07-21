-- up
-- Phase 140a Step 2: cache-token fidelity for the cost-tracking persistence layer.
-- provider_costs gains cache_read_tokens/cache_creation_tokens so real, tool-reported
-- prompt-cache usage (Claude Code CLI, opencode, session-delegate return.json) reaches
-- the same table cost_source already distinguishes tracked from computed cost in.
-- Nullable so pre-existing rows remain valid (a step that never used caching has no
-- cache figures — NULL, never 0, which would misread as "zero cache usage").
ALTER TABLE provider_costs ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE provider_costs ADD COLUMN cache_creation_tokens INTEGER;

-- down
-- SQLite has no DROP COLUMN before 3.35; recreate provider_costs without the two columns.
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
  cost_source TEXT,
  timestamp DATETIME DEFAULT (datetime('now'))
);
INSERT INTO provider_costs_new (id, provider, requests, tokens, prompt_tokens, completion_tokens, model, trace_id, portal, estimated_cost_usd, cost_source, timestamp)
  SELECT id, provider, requests, tokens, prompt_tokens, completion_tokens, model, trace_id, portal, estimated_cost_usd, cost_source, timestamp FROM provider_costs;
DROP TABLE provider_costs;
ALTER TABLE provider_costs_new RENAME TO provider_costs;
CREATE INDEX IF NOT EXISTS idx_provider_costs_provider ON provider_costs(provider);
CREATE INDEX IF NOT EXISTS idx_provider_costs_trace ON provider_costs(trace_id);
CREATE INDEX IF NOT EXISTS idx_provider_costs_portal ON provider_costs(portal);
CREATE INDEX IF NOT EXISTS idx_provider_costs_timestamp ON provider_costs(timestamp);
