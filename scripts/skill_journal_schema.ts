#!/usr/bin/env -S deno run -A
/**
 * @module SkillJournalSchema
 * @path scripts/skill_journal_schema.ts
 * @description Idempotently installs the skill_revisions and skill_usage tables and their indexes on
 *   journals that already applied the consolidated initialization migration, without
 *   touching existing rows. Mirrors scripts/provider_costs_schema.ts.
 * @architectural-layer Infrastructure
 * @dependencies [@db/sqlite]
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts, migrations/001_init.sql]
 * Usage: imported by setup_db.ts and migrate_db.ts; not a standalone command.
 */

import type { Database } from "@db/sqlite";

const SKILL_JOURNAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_revisions (
  revision_id    TEXT PRIMARY KEY,
  content_sha256 TEXT NOT NULL,
  skill_name     TEXT NOT NULL,
  skill_md       TEXT NOT NULL,
  exaix_yaml     TEXT,
  "references"   TEXT NOT NULL,
  first_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_revisions_name ON skill_revisions (skill_name);
CREATE TABLE IF NOT EXISTS skill_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id           TEXT    NOT NULL,
  revision_id       TEXT    NOT NULL REFERENCES skill_revisions (revision_id),
  skill_name        TEXT    NOT NULL,
  trace_id          TEXT    NOT NULL,
  request_id        TEXT,
  flow_id           TEXT,
  flow_step_id      TEXT,
  agent_role        TEXT    NOT NULL,
  match_source      TEXT    NOT NULL,
  render_mode       TEXT    NOT NULL,
  submission_kind   TEXT    NOT NULL,
  round             INTEGER NOT NULL,
  attempt           INTEGER NOT NULL,
  root_kind         TEXT    NOT NULL,
  source_path       TEXT    NOT NULL,
  config_generation TEXT    NOT NULL,
  used_at           TEXT    NOT NULL,
  UNIQUE (call_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_usage_name ON skill_usage (skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_usage_trace ON skill_usage (trace_id);
`;

/** Runs only from explicit database setup/upgrade commands, outside their migration transactions. */
export function upgradeSkillJournalSchema(db: Database): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(SKILL_JOURNAL_SCHEMA_SQL);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
