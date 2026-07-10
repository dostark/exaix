-- up
-- Phase 135 Step 2 (§5.5, D9): provider_costs gains a nullable cost_source column so
-- each cost record records HOW it was priced — 'provider_reported' (OpenRouter response
-- cost / delegate session cost), 'registry_computed' (split input/output per-Mtok), or
-- NULL (legacy blended estimate, library-compat path). Nullable so pre-existing rows
-- remain valid.
ALTER TABLE provider_costs ADD COLUMN cost_source TEXT;

-- down
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
