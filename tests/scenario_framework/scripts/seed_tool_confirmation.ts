#!/usr/bin/env -S deno run -A
/**
 * @module ScenarioFrameworkSeedToolConfirmation
 * @path tests/scenario_framework/scripts/seed_tool_confirmation.ts
 * @description Seeds a pending tool confirmation row in the workspace database for deterministic scenario-framework approval and denial tests.
 */

import { join } from "@std/path";
import { Database } from "@db/sqlite";

const DEFAULT_CONFIRMATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const DEFAULT_TOOL_NAME = "exaix_create_request";
const DEFAULT_STEP_ID = "dynamic-create-request";
const DEFAULT_TRACE_ID = "scenario-framework-tool-confirmation";
const EXPIRY_WINDOW_MS = 10 * 60 * 1000;

function main(): void {
  const confirmationId = Deno.args[0] ?? DEFAULT_CONFIRMATION_ID;
  const workspaceRoot = Deno.cwd();
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_WINDOW_MS).toISOString();
  const db = new Database(dbPath);

  try {
    db.prepare(
      `INSERT INTO pending_tool_confirmations (
        id, tool_name, args_json, step_id, trace_id, requested_at, expires_at, approved, reason, decided_at, decided_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(
      confirmationId,
      DEFAULT_TOOL_NAME,
      JSON.stringify({ title: "Scenario denial request" }),
      DEFAULT_STEP_ID,
      DEFAULT_TRACE_ID,
      now.toISOString(),
      expiresAt,
    );

    console.log(`seeded ${confirmationId} ${DEFAULT_TOOL_NAME} ${DEFAULT_STEP_ID}`);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main();
}
