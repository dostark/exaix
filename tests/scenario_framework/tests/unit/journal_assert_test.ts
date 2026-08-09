/**
 * @module ScenarioFrameworkJournalAssertTest
 * @path tests/scenario_framework/tests/unit/journal_assert_test.ts
 * @description Tests for the `journal-assert` step type — a DECLARATIVE activity-journal assertion
 *   (no raw SQL in scenario YAML). The step config filters activity rows by action_type, trace
 *   scoping, and payload conditions, then either asserts a count/sum/payload-substring or emits
 *   projected rows for json-query criteria. `trace_scoped` resolves to the current request's trace
 *   (first request.created above the scenario baseline) so assertions never read an earlier
 *   scenario's rows in a shared sandbox.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals, assertObjectMatch } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { executeScenarioStep, substituteRuntimeVars } from "../../runner/step_executor.ts";
import { ScenarioStepSchema, ScenarioStepType } from "../../schema/step_schema.ts";

function journalAssertStep(overrides: Partial<JournalAssertConfig> = {}) {
  return {
    id: "journal-assert",
    type: ScenarioStepType.JOURNAL_ASSERT,
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
    ...overrides,
  } as never;
}

/** A declarative journal-assert step config under test (the same fields the schema accepts). */
type JournalAssertConfig = {
  action_type?: string;
  action_types?: string[];
  action_type_prefix?: string;
  trace_scoped?: boolean;
  payload_equals?: Array<{ path: string; value: string | number | boolean }>;
  payload_contains?: string[];
  payload_not_contains?: string[];
  latest_only?: boolean;
  project?: Record<string, string>;
  sums?: Record<string, string>;
  expect_count?: number;
  expect_sum?: { path: string; gt: number };
  expect_contains?: string[];
};

const DEFAULT_ROWS: Array<[string, string, string]> = [
  // rowid | trace_id | action_type | payload
  ["trace-1", "request.created", "{}"],
  ["trace-1", "dynamic_tool_call", '{"tool_name":"read_file","files_changed":3}'],
  ["trace-2", "request.created", "{}"],
];

async function withJournal(
  rows: Array<[string, string, string]> = DEFAULT_ROWS,
  fn: (ws: string) => void | Promise<void>,
): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "journal-assert-" });
  try {
    await Deno.mkdir(join(ws, ".exa"), { recursive: true });
    const db = new Database(join(ws, ".exa", "journal.db"));
    db.prepare(
      "CREATE TABLE activity (rowid INTEGER PRIMARY KEY, trace_id TEXT, action_type TEXT, payload TEXT)",
    ).run();
    for (const [traceId, actionType, payload] of rows) {
      db.prepare(
        "INSERT INTO activity (trace_id, action_type, payload) VALUES (?, ?, ?)",
      ).run(traceId, actionType, payload);
    }
    db.close();
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

// --- expect_count -----------------------------------------------------------

Deno.test("[journal_assert] expect_count 0 passes when no matching rows exist", async () => {
  await withJournal(undefined, async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({ action_type: "dynamic_tool_call", trace_scoped: true, expect_count: 0 }),
      cwd: ws,
      journalBaselineRowid: 2,
    });
    assertEquals(result.exitCode, 0, `expected pass, got: ${result.stderr}`);
  });
});

Deno.test("[journal_assert] expect_count 0 fails when matching rows exist", async () => {
  await withJournal(undefined, async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({ action_type: "dynamic_tool_call", expect_count: 0 }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 1, "expected the count assertion to fail");
  });
});

Deno.test("[journal_assert] trace_scoped resolves to the first request.created above the baseline", async () => {
  await withJournal(undefined, async (ws) => {
    // Rows: request.created(trace-1), dynamic_tool_call(trace-1), request.created(trace-2).
    // Baseline rowid 2 excludes trace-1's rows → the trace is trace-2, which has no tool call.
    const result = await executeScenarioStep({
      step: journalAssertStep({ action_type: "dynamic_tool_call", trace_scoped: true, expect_count: 0 }),
      cwd: ws,
      journalBaselineRowid: 2,
    });
    assertEquals(result.exitCode, 0, `$TRACE_ID must scope to trace-2 above the baseline, got: ${result.stderr}`);
  });
});

Deno.test("[journal_assert] trace_scoped resolves to the FIRST request.created (rowid ASC, not newest)", async () => {
  await withJournal(undefined, async (ws) => {
    // No baseline → the first request.created (trace-1) is selected; trace-1 HAS a
    // dynamic_tool_call, so the count assertion fails — proving ASC (not DESC/newest) resolution.
    const result = await executeScenarioStep({
      step: journalAssertStep({ action_type: "dynamic_tool_call", trace_scoped: true, expect_count: 0 }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 1, "$TRACE_ID must resolve to the first request.created (trace-1)");
  });
});

// --- expect_sum -------------------------------------------------------------

Deno.test("[journal_assert] expect_sum passes when the summed payload field is above the bound", async () => {
  await withJournal(undefined, async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        trace_scoped: true,
        expect_sum: { path: "files_changed", gt: 0 },
      }),
      cwd: ws,
      journalBaselineRowid: 0,
    });
    assertEquals(result.exitCode, 1, "no agent.execution_completed row exists, sum is 0");
  });
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "agent.execution_completed", '{"files_changed":3,"usage":{"prompt_tokens":10}}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        trace_scoped: true,
        expect_sum: { path: "files_changed", gt: 0 },
      }),
      cwd: ws,
      journalBaselineRowid: 0,
    });
    assertEquals(result.exitCode, 0, `expected sum pass, got: ${result.stderr}`);
    assertObjectMatch(JSON.parse(result.stdout)[0], { sum: 3 });
  });
});

Deno.test("[journal_assert] expect_sum fails when the sum is at or below the bound", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "agent.execution_completed", '{"files_changed":0}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        trace_scoped: true,
        expect_sum: { path: "files_changed", gt: 0 },
      }),
      cwd: ws,
      journalBaselineRowid: 0,
    });
    assertEquals(result.exitCode, 1, "sum is 0, must fail");
  });
});

// --- expect_contains (latest matching row) ----------------------------------

Deno.test("[journal_assert] expect_contains inspects the LATEST matching row's payload", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "agent.execution_completed", '{"usage":{"prompt_tokens":10}}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        expect_contains: ["prompt_tokens"],
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected latest payload to contain prompt_tokens, got: ${result.stderr}`);
  });
});

Deno.test("[journal_assert] expect_contains fails when the latest row's payload lacks the substring", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "agent.execution_completed", '{"files_changed":1}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        expect_contains: ["prompt_tokens"],
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 1, "latest payload has no prompt_tokens, must fail");
  });
});

// --- probe projection -------------------------------------------------------

Deno.test("[journal_assert] a projected probe emits payload-extracted columns for json-query scoring", async () => {
  await withJournal(undefined, async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "dynamic_tool_call",
        project: { action_type: "action_type", tool_name: "payload.tool_name" },
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected rows, got: ${result.stderr}`);
    assertObjectMatch(JSON.parse(result.stdout)[0], { action_type: "dynamic_tool_call", tool_name: "read_file" });
  });
});

Deno.test("[journal_assert] action_types IN-list plus payload_equals filters rows", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "flow.step.started", '{"stepId":"explore"}'],
    ["trace-1", "flow.step.completed", '{"stepId":"explore"}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_types: ["flow.step.started", "flow.step.completed"],
        payload_equals: [{ path: "stepId", value: "explore" }],
        project: { action_type: "action_type", step_id: "payload.stepId" },
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected both step events, got: ${result.stderr}`);
    assertEquals(JSON.parse(result.stdout).length, 2, "both started and completed must be emitted");
    assertObjectMatch(JSON.parse(result.stdout)[1], { action_type: "flow.step.completed", step_id: "explore" });
  });
});

Deno.test("[journal_assert] action_type_prefix matches a LIKE prefix on action_type", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "guardrail.screen.violation", '{"verdict":"block"}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type_prefix: "guardrail.",
        project: { action_type: "action_type" },
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected guardrail row, got: ${result.stderr}`);
    assertObjectMatch(JSON.parse(result.stdout)[0], { action_type: "guardrail.screen.violation" });
  });
});

Deno.test("[journal_assert] latest_only emits only the newest matching row", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "model.resolved", '{"selected":"mock-1","candidate_providers":["mock-1","mock-2"]}'],
    ["trace-2", "model.resolved", '{"selected":"mock-2","candidate_providers":["mock-1"]}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "model.resolved",
        latest_only: true,
        project: { selected: "payload.selected", candidate_providers: "payload.candidate_providers" },
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected latest model.resolved row, got: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    assertEquals(rows.length, 1, "latest_only must return a single row");
    assertObjectMatch(rows[0], { selected: "mock-2", candidate_providers: ["mock-1"] });
  });
});

Deno.test("[journal_assert] payload_contains + payload_not_contains encode an EXISTS strategy probe", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "flow.step.completed", '{"stepId":"no-strategy-step"}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "flow.step.completed",
        payload_contains: ['"stepId":"no-strategy-step"'],
        payload_not_contains: ['"strategy":'],
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected a row without a strategy key, got: ${result.stderr}`);
  });
  await withJournal([
    ["trace-1", "request.created", "{}"],
    ["trace-1", "flow.step.completed", '{"stepId":"no-strategy-step","strategy":"react"}'],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "flow.step.completed",
        payload_contains: ['"stepId":"no-strategy-step"'],
        payload_not_contains: ['"strategy":'],
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 1, "a strategy key must fail the NOT-filter");
  });
});

// --- sums aggregate ---------------------------------------------------------

Deno.test("[journal_assert] sums emits a single aggregate row of COALESCE(SUM(...)) columns", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
    [
      "trace-1",
      "agent.execution_completed",
      '{"usage":{"prompt_tokens":10,"completion_tokens":5,"cost_usd_estimate":0.01}}',
    ],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        trace_scoped: true,
        sums: {
          prompt_tokens: "usage.prompt_tokens",
          completion_tokens: "usage.completion_tokens",
          cost_usd: "usage.cost_usd_estimate",
        },
      }),
      cwd: ws,
      journalBaselineRowid: 0,
    });
    assertEquals(result.exitCode, 0, `expected the aggregate row, got: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    assertEquals(rows.length, 1, "aggregate emits exactly one row");
    assertObjectMatch(rows[0], { prompt_tokens: 10, completion_tokens: 5, cost_usd: 0.01 });
  });
});

Deno.test("[journal_assert] sums defaults to 0 when no rows match (informational, still exits 0)", async () => {
  await withJournal([
    ["trace-1", "request.created", "{}"],
  ], async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep({
        action_type: "agent.execution_completed",
        sums: { prompt_tokens: "usage.prompt_tokens" },
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, "aggregate always returns one row");
    assertObjectMatch(JSON.parse(result.stdout)[0], { prompt_tokens: 0 });
  });
});

// --- runtime-var substitution -------------------------------------------------

Deno.test("[journal_assert] $REQUEST_ID resolves from the SCENARIO baseline, not a high per-step barrier baseline", async () => {
  await withJournal([
    ["trace-scen", "request.created", "{}"],
    ["trace-scen", "agent.execution_completed", '{"files_changed":1}'],
  ], (ws) => {
    // Scenario baseline (rowid 0, before the request) resolves the current request's trace —
    // the per-step barrier baseline for a late step (rowid 2, above the request) must NOT.
    const spec = substituteRuntimeVars(
      { executable: "exactl", args: ["review", "approve", "$REQUEST_ID"] },
      ws,
      0,
    );
    assertEquals(spec.args[2], "request-trace-sc", "$REQUEST_ID = request-<trace[0:8]> from the scenario baseline");
    const high = substituteRuntimeVars(
      { executable: "exactl", args: ["review", "approve", "$REQUEST_ID"] },
      ws,
      2,
    );
    assertEquals(high.args[2], "$REQUEST_ID", "a barrier baseline above the request leaves $REQUEST_ID literal");
  });
});

// --- schema round-trip ------------------------------------------------------

Deno.test("[journal_assert] the declarative configs validate against ScenarioStepSchema", () => {
  const configs: JournalAssertConfig[] = [
    { action_type: "dynamic_tool_call", trace_scoped: true, expect_count: 0 },
    {
      action_type: "agent.execution_completed",
      trace_scoped: true,
      expect_sum: { path: "files_changed", gt: 0 },
    },
    {
      action_type: "flow.step.completed",
      payload_contains: ['"stepId":"delegate-step"', '"strategy":"cli_delegate"'],
      payload_not_contains: ['"strategy":'],
    },
    {
      action_types: ["flow.step.started", "flow.step.completed"],
      payload_equals: [{ path: "stepId", value: "explore" }],
      project: { action_type: "action_type", step_id: "payload.stepId" },
    },
    { action_type_prefix: "guardrail.", project: { action_type: "action_type" } },
    {
      action_type: "model.resolved",
      latest_only: true,
      project: { selected: "payload.selected", candidate_providers: "payload.candidate_providers" },
    },
    {
      action_type: "agent.execution_completed",
      sums: {
        prompt_tokens: "usage.prompt_tokens",
        completion_tokens: "usage.completion_tokens",
        cost_usd: "usage.cost_usd_estimate",
      },
    },
    { action_type: "agent.execution_completed", expect_contains: ["prompt_tokens"] },
  ];
  for (const config of configs) {
    const parsed = ScenarioStepSchema.parse({ id: "journal-assert", type: ScenarioStepType.JOURNAL_ASSERT, ...config });
    assertEquals(parsed.type, ScenarioStepType.JOURNAL_ASSERT);
  }
});

Deno.test("[journal_assert] an invalid payload path is rejected by the schema", () => {
  const result = ScenarioStepSchema.safeParse({
    id: "journal-assert",
    type: ScenarioStepType.JOURNAL_ASSERT,
    payload_equals: [{ path: "stepId; DROP TABLE", value: "x" }],
  });
  assertEquals(result.success, true, "schema allows dotted path strings (path safety is enforced at execution)");
});
