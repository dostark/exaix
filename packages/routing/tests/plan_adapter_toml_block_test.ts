/**
 * @module PlanAdapterTomlBlockTest
 * @path packages/routing/tests/plan_adapter_toml_block_test.ts
 * @description Verifies PlanAdapter.parse() transparently substitutes TOML_BLOCK:N
 *   sentinel-marked fenced ```toml action blocks into a step's actions[] array before
 *   Zod validation, while pure-JSON plans (no sentinel) continue to parse via the
 *   existing OutputValidator path unchanged (Phase 151 Step 2).
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_adapter.ts, packages/core/src/planning/toml_action_blocks.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { PlanAdapter, PlanValidationError } from "@exaix/core/planning";

Deno.test("PlanAdapter.parse: a TOML_BLOCK:1 sentinel plan parses into a Plan with a real IPlanAction[] array", () => {
  const adapter = new PlanAdapter();
  const rawContent =
    `{"title": "Add endpoint", "description": "Adds a complete-task endpoint", "steps": [{"step": 1, "title": "Implement handler", "description": "Add handleCompleteTask", "actions": "TOML_BLOCK:1"}]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
description = "Add the handler"
[params]
path = "src/api.ts"
content = '''
export function handleCompleteTask(): void {}
'''
\`\`\`
`;

  const plan = adapter.parse(rawContent);

  assertEquals(plan.steps?.[0].actions?.length, 1);
  assertEquals(plan.steps?.[0].actions?.[0].tool, "write_file");
  assertEquals(plan.steps?.[0].actions?.[0].description, "Add the handler");
  assertEquals(plan.steps?.[0].actions?.[0].params.path, "src/api.ts");
  assertEquals(plan.steps?.[0].actions?.[0].params.content, "export function handleCompleteTask(): void {}\n");
});

Deno.test("PlanAdapter.parse: a patch_file TOML_BLOCK produces an action with search/replace params, no content field", () => {
  const adapter = new PlanAdapter();
  const rawContent =
    `{"description": "Fix null guard", "steps": [{"step": 1, "title": "Patch", "description": "Add guard", "actions": "TOML_BLOCK:1"}]}

\`\`\`toml
# TOML_BLOCK:1
tool = "patch_file"
[params]
path = "src/utils.ts"
search = "return task.dueDate.slice(0, 10);"
replace = "return task.dueDate ? task.dueDate.slice(0, 10) : \\"\\";"
\`\`\`
`;

  const plan = adapter.parse(rawContent);

  assertEquals(plan.steps?.[0].actions?.[0].tool, "patch_file");
  assertEquals(plan.steps?.[0].actions?.[0].params.content, undefined);
  assertEquals(plan.steps?.[0].actions?.[0].params.search, "return task.dueDate.slice(0, 10);");
});

Deno.test("PlanAdapter.parse: a sentinel referencing a non-existent block number throws PlanValidationError naming it", () => {
  const adapter = new PlanAdapter();
  // A fenced block IS present (so extractTomlActionBlocks finds a non-empty actionsByBlock and
  // takes the TOML-block path), but under marker 1 while the envelope's sentinel points at 99 —
  // the dangling-sentinel case, distinct from "no TOML fence anywhere" (which falls through to
  // the pure-JSON path and fails PlanSchema validation on the literal sentinel string instead).
  const rawContent =
    `{"description": "Broken plan", "steps": [{"step": 1, "title": "Step", "description": "Desc", "actions": "TOML_BLOCK:99"}]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "a.ts"
content = "a"
\`\`\`
`;

  const error = assertThrows(
    () => adapter.parse(rawContent),
    PlanValidationError,
  );
  assertEquals((error as PlanValidationError).message.includes("TOML_BLOCK:99"), true);
});

Deno.test("PlanAdapter.parse: a malformed JSON envelope (after TOML extraction) still throws PlanValidationError with rawContent", () => {
  const adapter = new PlanAdapter();
  const rawContent = `{"description": "Broken", "steps": [{"actions": "TOML_BLOCK:1"

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "a.ts"
content = "a"
\`\`\`
`;

  const error = assertThrows(
    () => adapter.parse(rawContent),
    PlanValidationError,
  );
  assertEquals(typeof (error as PlanValidationError).details.rawContent, "string");
});

Deno.test("PlanAdapter.parse: metrics divergence — TOML_BLOCK path does not increment OutputValidator totalAttempts, pure-JSON path does", () => {
  const adapter = new PlanAdapter();

  const pureJson =
    `{"description": "Pure JSON plan", "steps": [{"step": 1, "title": "S", "description": "D", "actions": [{"tool": "read_file", "params": {"path": "a.ts"}}]}]}`;
  adapter.parse(pureJson);
  const afterPureJson = adapter.getValidationMetrics().totalAttempts;
  assertEquals(afterPureJson, 1);

  const tomlBlockPlan =
    `{"description": "TOML plan", "steps": [{"step": 1, "title": "S", "description": "D", "actions": "TOML_BLOCK:1"}]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "a.ts"
content = "a"
\`\`\`
`;
  adapter.parse(tomlBlockPlan);
  const afterTomlBlock = adapter.getValidationMetrics().totalAttempts;

  assertEquals(afterTomlBlock, afterPureJson);
});
