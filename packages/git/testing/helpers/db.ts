/**
 * @module GitTestingDb
 * @path packages/git/testing/helpers/db.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Minimal database helpers for git test support.
 */

import { DatabaseService } from "@exaix/storage-sqlite";
import type { Config } from "@exaix/schemas";

import { createMockConfig } from "./config.ts";

const ACTIVITY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_type TEXT,
    agent_role TEXT,
    runner_kind TEXT,
    action_type TEXT NOT NULL,
    target TEXT,
    payload TEXT NOT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0.0,
    timestamp DATETIME DEFAULT (datetime('now'))
  );
`;

const REVIEWS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    portal TEXT,
    branch TEXT NOT NULL,
    repository TEXT NOT NULL,
    base_branch TEXT,
    worktree_path TEXT,
    status TEXT NOT NULL,
    description TEXT NOT NULL,
    commit_sha TEXT,
    files_changed INTEGER DEFAULT 0,
    created TEXT NOT NULL,
    created_by TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    rejected_at TEXT,
    rejected_by TEXT,
    rejection_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_trace_id ON reviews(trace_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
  CREATE INDEX IF NOT EXISTS idx_reviews_portal ON reviews(portal);
  CREATE INDEX IF NOT EXISTS idx_reviews_created_by ON reviews(created_by);
  CREATE INDEX IF NOT EXISTS idx_reviews_branch ON reviews(branch);
  CREATE INDEX IF NOT EXISTS idx_reviews_repository ON reviews(repository);
`;

function initActivityTableSchema(db: DatabaseService): void {
  db.instance.exec(ACTIVITY_TABLE_SQL);
}

function initReviewsTableSchema(db: DatabaseService): void {
  db.instance.exec(REVIEWS_TABLE_SQL);
}

export async function initTestDbService(): Promise<{
  db: DatabaseService;
  config: Config;
  tempDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-git-test-" });
  const config = createMockConfig(tempDir);
  const db = new DatabaseService(config);
  initActivityTableSchema(db);
  initReviewsTableSchema(db);

  return {
    db,
    config,
    tempDir,
    cleanup: async () => {
      try {
        await db.waitForFlush();
      } catch {
        // Ignore flush errors during cleanup
      }

      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup failures
      }
    },
  };
}
