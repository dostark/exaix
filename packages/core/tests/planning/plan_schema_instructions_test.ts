/**
 * @module PlanSchemaInstructionsTest
 * @path packages/core/tests/planning/plan_schema_instructions_test.ts
 * @description Verifies the plan prompt names the tools the plan validator accepts, and no excluded tool.
 * @architectural-layer Core
 * @dependencies [@exaix/core]
 * @related-files [packages/core/src/planning/plan_adapter.ts, packages/core/src/types/enums.ts]
 */
import { assertFalse, assertStringIncludes } from "@std/assert";
import { PlanAdapter } from "../../src/planning/plan_adapter.ts";
import { EXECUTION_TOOL_NAMES, ToolName } from "../../src/types/enums.ts";

Deno.test("[plan schema instructions] name every execution tool the plan validator accepts", () => {
  const instructions = new PlanAdapter().getSchemaInstructions();
  for (const name of EXECUTION_TOOL_NAMES) {
    assertStringIncludes(instructions, name);
  }
});

Deno.test("[plan schema instructions] never point the planner at the excluded catalog tool", () => {
  const instructions = new PlanAdapter().getSchemaInstructions();
  assertFalse(instructions.includes(ToolName.LIST_AVAILABLE_TOOLS));
});
