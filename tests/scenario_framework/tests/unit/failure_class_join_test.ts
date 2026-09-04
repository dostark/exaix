/**
 * @module FailureClassJoinTest
 * @path tests/scenario_framework/tests/unit/failure_class_join_test.ts
 * @description Phase 143 Step 5 — RED-first tests for the anomaly→failure_class join.
 *   `computeFailureClasses` maps `classifyTraceAnomalies` findings to distinct unrecovered
 *   `eventType` class names (recovered findings excluded per the existing recovery-pairing
 *   semantics), and `loadTraceActivities` recovers a run's trace from the workspace journal via
 *   the `request.created` marker event. `computeRunFailureClasses` is the production-shaped
 *   join (journal path → activities → classes) that the runner invokes at history-write time.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/failure_classifier.ts, packages/core/src/events/anomaly_classification.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { DomainEventType } from "@exaix/core/events";
import type { IActivityRecord } from "@exaix/core/types";
import {
  computeFailureClasses,
  computeRunFailureClasses,
  loadTraceActivities,
} from "../../runner/failure_classifier.ts";

function makeActivity(overrides: Partial<IActivityRecord>): IActivityRecord {
  return {
    id: "a",
    trace_id: "run-trace",
    actor: null,
    actor_type: null,
    agent_role: null,
    action_type: DomainEventType.McpToolExecuted,
    target: null,
    payload: "{}",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("[FailureClassJoin] unrecovered findings become distinct eventType classes", () => {
  const activities = [
    makeActivity({ action_type: DomainEventType.ExecutionFailed, target: "exec" }),
    makeActivity({ action_type: DomainEventType.McpToolFailed, target: "read_file" }),
  ];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.4, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution.failed"), true);
  assertEquals(classes.includes("mcp.tool.failed"), true);
});

Deno.test("[FailureClassJoin] recovered findings are excluded (recovery pairing semantics)", () => {
  const activities = [
    // mcp.tool.failed on target read_file, then recovered by mcp.tool.executed on the same target.
    makeActivity({
      action_type: DomainEventType.McpToolFailed,
      target: "read_file",
      timestamp: "2026-08-01T00:00:00.000Z",
    }),
    makeActivity({
      action_type: DomainEventType.McpToolExecuted,
      target: "read_file",
      timestamp: "2026-08-01T00:00:01.000Z",
    }),
    // execution.failed has no recovery pair → stays a class.
    makeActivity({ action_type: DomainEventType.ExecutionFailed, target: "exec" }),
  ];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.4, scoreThreshold: 0.5 });
  assertEquals(classes.includes("mcp.tool.failed"), false, "recovered finding must be excluded");
  assertEquals(classes.includes("execution.failed"), true);
});

Deno.test("[FailureClassJoin] loadTraceActivities recovers the run trace via request.created", () => {
  const dir = Deno.makeTempDirSync({ prefix: "failure-class-journal-" });
  const dbPath = join(dir, "journal.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE activity (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT, trace_id TEXT, actor TEXT, actor_type TEXT, agent_role TEXT,
      runner_kind TEXT, action_type TEXT, target TEXT, payload TEXT,
      prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, timestamp TEXT
    )
  `);
  const insert = db.prepare(
    `INSERT INTO activity (id, trace_id, action_type, target, payload, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run("1", "run-trace", "request.created", null, "{}", "2026-08-01T00:00:00.000Z");
  insert.run("2", "run-trace", DomainEventType.ExecutionFailed, "exec", "{}", "2026-08-01T00:00:01.000Z");
  db.close();

  try {
    const activities = loadTraceActivities(dbPath);
    assertEquals(activities.length, 2, "both trace activities loaded");
    assertEquals(activities[0].action_type, "request.created");
    assertEquals(activities[1].action_type, DomainEventType.ExecutionFailed);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[FailureClassJoin] computeRunFailureClasses joins journal trace to classes", () => {
  const dir = Deno.makeTempDirSync({ prefix: "failure-class-run-" });
  const dbPath = join(dir, "journal.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE activity (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT, trace_id TEXT, actor TEXT, actor_type TEXT, agent_role TEXT,
      runner_kind TEXT, action_type TEXT, target TEXT, payload TEXT,
      prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, timestamp TEXT
    )
  `);
  const insert = db.prepare(
    `INSERT INTO activity (id, trace_id, action_type, target, payload, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run("1", "run-trace", "request.created", null, "{}", "2026-08-01T00:00:00.000Z");
  insert.run("2", "run-trace", DomainEventType.ExecutionFailed, "exec", "{}", "2026-08-01T00:00:01.000Z");
  db.close();

  try {
    const classes = computeRunFailureClasses({ journalPath: dbPath, outcomeScore: 0.4, scoreThreshold: 0.5 });
    assertEquals(classes.includes("execution.failed"), true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
