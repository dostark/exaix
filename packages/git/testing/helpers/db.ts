/**
 * @module GitTestingDb
 * @path packages/git/testing/helpers/db.ts
 * @description Minimal database helpers for git test support.
 */

import { DatabaseService } from "../../../../src/services/core/db.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { createMockConfig } from "./config.ts";

const ACTIVITY_TABLE_SQL = `
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
`;

function initActivityTableSchema(db: DatabaseService): void {
  db.instance.exec(ACTIVITY_TABLE_SQL);
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
